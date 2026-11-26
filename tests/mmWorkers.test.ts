import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { LedgerService } from '../src/server/ledger/ledgerService';
import { EngineManager } from '../src/server/engine/engineManager';
import { BinanceWsHandler } from '../src/server/workers/binanceWsHandler';
import { BybitWsHandler } from '../src/server/workers/bybitWsHandler';
import { PriceAggregatorWorker } from '../src/server/workers/priceAggregatorWorker';
import { MMBotWorker } from '../src/server/workers/mmBotWorker';
import {
  ManagedWebSocketLike,
  WS_READY_STATE,
  WsClientMiddleware,
} from '../src/server/workers/wsClientMiddleware';
import { ExternalTicker } from '../src/simulation/mmConsoleTypes';

class MockWebSocket extends EventEmitter implements ManagedWebSocketLike {
  public readyState: number = WS_READY_STATE.CONNECTING;
  public sentMessages: any[] = [];
  public terminated = false;

  send(data: any, cb?: (err?: Error) => void) {
    this.sentMessages.push(data);
    if (cb) cb();
  }

  ping() {}

  terminate() {
    this.terminated = true;
    this.readyState = WS_READY_STATE.CLOSED;
  }

  close() {
    this.readyState = WS_READY_STATE.CLOSED;
    this.emit('close', 1000, Buffer.from('normal'));
  }

  simulateOpen() {
    this.readyState = WS_READY_STATE.OPEN;
    this.emit('open');
  }

  simulateMessage(payload: any) {
    this.emit('message', typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  simulateError(message: string) {
    this.emit('error', new Error(message));
  }

  simulateUnexpectedResponse(statusCode: number) {
    this.emit('unexpected-response', {}, { statusCode, resume: () => {} });
  }

  simulateDrop(code = 1006, reason = 'abnormal closure') {
    this.readyState = WS_READY_STATE.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }
}

describe('Market Maker Workers Infrastructure', () => {
  let dbMgr: DatabaseManager;
  let ledger: LedgerService;
  let engineManager: EngineManager;

  beforeEach(async () => {
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    ledger = new LedgerService(dbMgr);
    engineManager = new EngineManager(dbMgr, ledger);
    await engineManager.initialize();
  });

  describe('BinanceWsHandler & BybitWsHandler', () => {
    it('initializes and reports correct initial status and symbols', () => {
      const binance = new BinanceWsHandler(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
      const bybit = new BybitWsHandler(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);

      const bStatus = binance.getStatus();
      expect(bStatus.provider).toBe('binance');
      expect(bStatus.status).toBe('DISCONNECTED');
      expect(bStatus.symbolsTracked).toContain('btcusdt');

      const byStatus = bybit.getStatus();
      expect(byStatus.provider).toBe('bybit');
      expect(byStatus.status).toBe('DISCONNECTED');
      expect(byStatus.symbolsTracked).toContain('BTCUSDT');

      binance.stop();
      bybit.stop();
    });

    it('registers and invokes ticker listeners', () => {
      const binance = new BinanceWsHandler();
      let receivedTicker: ExternalTicker | null = null;

      const listener = (ticker: ExternalTicker) => {
        receivedTicker = ticker;
      };

      binance.onTicker(listener);

      // Simulate a raw ticker feed invocation through private handler simulation
      const mockTicker: ExternalTicker = {
        provider: 'binance',
        symbol: 'BTCUSDT',
        bidPrice: 92400,
        askPrice: 92410,
        lastPrice: 92405,
        volume24h: 1200000000,
        timestamp: Date.now(),
        latencyMs: 25,
      };

      // Trigger via listener check
      binance['onTickerCallbacks'].forEach((cb) => cb(mockTicker));
      expect(receivedTicker).toEqual(mockTicker);

      binance.removeTickerListener(listener);
      binance.stop();
    });
  });

  describe('WsClientMiddleware Error Handling & Exponential Backoff', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('catches socket errors, HTTP unexpected responses, factory exceptions, and non-OPEN sends cleanly', () => {
      const sockets: MockWebSocket[] = [];
      let throwOnCreate = false;
      const caughtErrors: Array<{ msg: string; phase: string }> = [];

      const mw = new WsClientMiddleware({
        provider: 'binance',
        urlFactory: () => 'wss://mock.binance/ws',
        socketFactory: () => {
          if (throwOnCreate) {
            throw new Error('DNS resolution failed');
          }
          const sock = new MockWebSocket();
          sockets.push(sock);
          return sock;
        },
        initialRetryDelayMs: 500,
        backoffMultiplier: 2,
        maxRetryDelayMs: 8000,
        severedThresholdMs: 5000,
        watchdogIntervalMs: 500,
        onError: (err, ctx) => {
          caughtErrors.push({ msg: err.message, phase: ctx.phase });
        },
      });

      mw.start();
      expect(sockets).toHaveLength(1);

      // 1. Attempting safeSend while readyState is CONNECTING (not OPEN)
      const sendOk = mw.safeSend('{"ping":1}');
      expect(sendOk).toBe(false);
      expect(caughtErrors[0].phase).toBe('send');
      expect(caughtErrors[0].msg).toContain('is not OPEN');

      // 2. Retry fires after 500ms -> emits socket 'error' event without throwing
      vi.advanceTimersByTime(500);
      expect(sockets).toHaveLength(2);
      sockets[1].simulateError('ECONNRESET socket hang up');
      expect(sockets[1].terminated).toBe(true);
      expect(caughtErrors.some((e) => e.phase === 'socket' && e.msg.includes('ECONNRESET'))).toBe(true);

      // 3. Next retry fires after 1000ms -> emits HTTP 451 unexpected-response
      vi.advanceTimersByTime(1000);
      expect(sockets).toHaveLength(3);
      sockets[2].simulateUnexpectedResponse(451);
      expect(caughtErrors.some((e) => e.phase === 'unexpected-response' && e.msg.includes('451'))).toBe(true);

      // 4. Synchronous factory throw during retry -> caught in 'connect' phase
      throwOnCreate = true;
      vi.advanceTimersByTime(2000);
      expect(caughtErrors.some((e) => e.phase === 'connect' && e.msg.includes('DNS resolution failed'))).toBe(true);
      expect(mw.getMetrics().totalErrors).toBeGreaterThanOrEqual(4);

      mw.stop();
    });

    it('performs exponential backoff retries when readyState is not OPEN and resets upon OPEN', () => {
      const connectTimestamps: number[] = [];
      const sockets: MockWebSocket[] = [];

      const mw = new WsClientMiddleware({
        provider: 'bybit',
        urlFactory: () => 'wss://mock.bybit/ws',
        socketFactory: () => {
          connectTimestamps.push(Date.now());
          const sock = new MockWebSocket();
          sockets.push(sock);
          return sock;
        },
        initialRetryDelayMs: 1000,
        backoffMultiplier: 2,
        maxRetryDelayMs: 4000,
        severedThresholdMs: 5000,
        watchdogIntervalMs: 1000,
      });

      const t0 = Date.now();
      mw.start();
      expect(connectTimestamps).toEqual([t0]);

      // Socket 0 fails immediately -> attempt 1 scheduled for +1000ms
      sockets[0].simulateDrop(1006, 'network down');
      expect(mw.getMetrics().retryAttempt).toBe(1);
      expect(mw.getMetrics().nextRetryDelayMs).toBe(2000);

      vi.advanceTimersByTime(999);
      expect(sockets).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(2); // t0 + 1000ms

      // Socket 1 transitions to CLOSED silently (readyState !== OPEN) -> watchdog catches it & schedules +2000ms
      sockets[1].readyState = WS_READY_STATE.CLOSED;
      vi.advanceTimersByTime(1000); // watchdog runs -> schedules attempt 2 (+2000ms)
      expect(mw.getMetrics().retryAttempt).toBe(2);
      expect(mw.getMetrics().nextRetryDelayMs).toBe(4000);

      vi.advanceTimersByTime(1999);
      expect(sockets).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(3); // t0 + 4000ms

      // Socket 2 fails -> capped at maxRetryDelayMs (4000ms)
      sockets[2].simulateDrop(1006, 'still down');
      expect(mw.getMetrics().retryAttempt).toBe(3);
      expect(mw.getMetrics().nextRetryDelayMs).toBe(4000);

      vi.advanceTimersByTime(4000);
      expect(sockets).toHaveLength(4);

      // Socket 3 opens -> backoff resets cleanly to initial values
      sockets[3].simulateOpen();
      const metrics = mw.getMetrics();
      expect(metrics.status).toBe('CONNECTED');
      expect(metrics.readyState).toBe(WS_READY_STATE.OPEN);
      expect(metrics.retryAttempt).toBe(0);
      expect(metrics.nextRetryDelayMs).toBe(1000);
      expect(metrics.severedSince).toBeNull();
      expect(metrics.isSeveredTooLong).toBe(false);

      mw.stop();
    });
  });

  describe('PriceAggregatorWorker', () => {
    it('aggregates prices from multiple providers with weighted average', () => {
      const binance = new BinanceWsHandler();
      const bybit = new BybitWsHandler();
      const aggregator = new PriceAggregatorWorker(binance, bybit);

      const now = Date.now();
      const bTicker: ExternalTicker = {
        provider: 'binance',
        symbol: 'BTCUSDT',
        bidPrice: 90000,
        askPrice: 90010,
        lastPrice: 90005,
        volume24h: 1500000000,
        timestamp: now,
        latencyMs: 20,
      };

      const byTicker: ExternalTicker = {
        provider: 'bybit',
        symbol: 'BTCUSDT',
        bidPrice: 90020,
        askPrice: 90030,
        lastPrice: 90025,
        volume24h: 800000000,
        timestamp: now,
        latencyMs: 30,
      };

      // Emit ticks into aggregator
      binance['onTickerCallbacks'].forEach((cb) => cb(bTicker));
      bybit['onTickerCallbacks'].forEach((cb) => cb(byTicker));

      const agg = aggregator.getAggregatedPrice('BTCUSDT');
      expect(agg).toBeDefined();
      expect(agg?.status).toBe('FRESH');
      expect(agg?.sourceCount).toBe(2);
      // Weighted average: 90005 * 0.6 + 90025 * 0.4 = 54003 + 36010 = 90013
      expect(agg?.finalPrice).toBe(90013);
      expect(agg?.confidenceScore).toBe(98);

      aggregator.stop();
    });

    it('flags outlier deviation as DISPUTED when providers diverge > 250 bps', () => {
      const binance = new BinanceWsHandler();
      const bybit = new BybitWsHandler();
      const aggregator = new PriceAggregatorWorker(binance, bybit);

      const now = Date.now();
      const bTicker: ExternalTicker = {
        provider: 'binance',
        symbol: 'ETHUSDT',
        bidPrice: 3000,
        askPrice: 3002,
        lastPrice: 3001,
        volume24h: 100000000,
        timestamp: now,
        latencyMs: 20,
      };

      // Bybit price is >3% higher (3100 vs 3001, >320 bps)
      const byTicker: ExternalTicker = {
        provider: 'bybit',
        symbol: 'ETHUSDT',
        bidPrice: 3100,
        askPrice: 3102,
        lastPrice: 3101,
        volume24h: 100000000,
        timestamp: now,
        latencyMs: 20,
      };

      binance['onTickerCallbacks'].forEach((cb) => cb(bTicker));
      bybit['onTickerCallbacks'].forEach((cb) => cb(byTicker));

      const agg = aggregator.getAggregatedPrice('ETHUSDT');
      expect(agg).toBeDefined();
      expect(agg?.status).toBe('DISPUTED');
      expect(agg?.rejectionReason).toContain('Excessive deviation');

      aggregator.stop();
    });

    it('updates and converts USDT/IDR FX rates correctly', () => {
      const aggregator = new PriceAggregatorWorker();
      aggregator.setFxRate(16350, 'BANK_INDONESIA', 'superadmin');

      const fx = aggregator.getFxRate();
      expect(fx.usdtIdrRate).toBe(16350);
      expect(fx.source).toBe('BANK_INDONESIA');
      expect(fx.updatedBy).toBe('superadmin');
      expect(fx.isStale).toBe(false);

      aggregator.stop();
    });

    it('clears stale price aggregates when WebSocket connections remain severed for > 5 seconds and recovers cleanly on reconnect', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      try {
        const binanceSockets: MockWebSocket[] = [];
        const bybitSockets: MockWebSocket[] = [];

        const binance = new BinanceWsHandler(['BTC/USDT'], {
          socketFactory: () => {
            const s = new MockWebSocket();
            binanceSockets.push(s);
            return s;
          },
          initialRetryDelayMs: 2000,
          maxRetryDelayMs: 16000,
          severedThresholdMs: 5000,
          watchdogIntervalMs: 500,
        });

        const bybit = new BybitWsHandler(['BTC/USDT'], {
          socketFactory: () => {
            const s = new MockWebSocket();
            bybitSockets.push(s);
            return s;
          },
          initialRetryDelayMs: 2000,
          maxRetryDelayMs: 16000,
          severedThresholdMs: 5000,
          watchdogIntervalMs: 500,
        });

        const aggregator = new PriceAggregatorWorker(binance, bybit, { staleThresholdMs: 5000 });
        aggregator.start();

        // Both providers connect and publish fresh BTCUSDT ticks
        binanceSockets[0].simulateOpen();
        bybitSockets[0].simulateOpen();

        binanceSockets[0].simulateMessage({
          stream: 'btcusdt@bookTicker',
          data: { s: 'BTCUSDT', b: '95000', a: '95010', E: Date.now() },
        });
        bybitSockets[0].simulateMessage({
          topic: 'tickers.BTCUSDT',
          ts: Date.now(),
          data: { symbol: 'BTCUSDT', bid1Price: '95020', ask1Price: '95030', lastPrice: '95025' },
        });

        expect(aggregator.getAggregatedPrice('BTCUSDT')?.status).toBe('FRESH');
        expect(aggregator.getAggregatedPrice('BTCUSDT')?.sourceCount).toBe(2);

        // Sever Binance first; Bybit remains healthy
        binanceSockets[0].simulateError('Binance upstream drop');

        // At 4s (< 5s): Binance not yet flagged severed >5s
        vi.advanceTimersByTime(4000);
        expect(binance.getStatus().isSeveredTooLong).toBe(false);

        // Advance past 5s (to 5.5s): Binance stale ticker cleared, BTCUSDT falls back cleanly to Bybit-only
        vi.advanceTimersByTime(1500);
        expect(binance.getStatus().isSeveredTooLong).toBe(true);
        const bybitOnlyAgg = aggregator.getAggregatedPrice('BTCUSDT');
        expect(bybitOnlyAgg).toBeDefined();
        expect(bybitOnlyAgg?.primaryProvider).toBe('bybit');
        expect(bybitOnlyAgg?.sourceCount).toBe(1);

        // Now sever Bybit as well and advance past 5s
        bybitSockets[0].simulateDrop(1006, 'Bybit severed');
        vi.advanceTimersByTime(5500);

        expect(bybit.getStatus().isSeveredTooLong).toBe(true);
        // Both feeds severed >5s -> stale BTCUSDT aggregate is completely cleared
        expect(aggregator.getAggregatedPrice('BTCUSDT')).toBeUndefined();
        expect(aggregator.getFeedHealth().clearedAggregatesCount).toBeGreaterThanOrEqual(1);

        // Advance timers to let the scheduled exponential backoff retry instantiate a fresh socket
        vi.advanceTimersByTime(4000);
        const latestBinanceSock = binance.getMiddleware().getCurrentSocket() as MockWebSocket;
        expect(latestBinanceSock).toBeTruthy();
        latestBinanceSock.simulateOpen();
        latestBinanceSock.simulateMessage({
          stream: 'btcusdt@bookTicker',
          data: { s: 'BTCUSDT', b: '95100', a: '95110', E: Date.now() },
        });

        const recovered = aggregator.getAggregatedPrice('BTCUSDT');
        expect(recovered).toBeDefined();
        expect(recovered?.status).toBe('FRESH');
        expect(recovered?.primaryProvider).toBe('binance');
        expect(binance.getStatus().isSeveredTooLong).toBe(false);

        aggregator.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('MMBotWorker Execution & Risk Controls', () => {
    let priceAggregator: PriceAggregatorWorker;
    let mmWorker: MMBotWorker;
    const testBotUserId = 'mm-bot-user-1';

    beforeEach(async () => {
      // Create user and give initial balance
      dbMgr.execute(
        `INSERT OR IGNORE INTO users (id, email, password_hash, role, status, kyc_level, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 2, ?, ?)`,
        [testBotUserId, 'bot1@silentsmile.io', 'hash', 'MM', Date.now(), Date.now()]
      );

      // Deposit 10 BTC (in satoshis: 10 * 1e8) and 1,000,000,000 IDR into bot account
      ledger.deposit(testBotUserId, 'BTC', 10 * 100000000, 'dep_bot_btc_01', 'Initial bot base balance');
      ledger.deposit(testBotUserId, 'IDR', 1000000000, 'dep_bot_idr_01', 'Initial bot quote balance');

      priceAggregator = new PriceAggregatorWorker();
      priceAggregator.setFxRate(16000, 'BANK_INDONESIA', 'system');

      // Populate aggregated price for BTCUSDT
      const dummyBtcTicker: ExternalTicker = {
        provider: 'binance',
        symbol: 'BTCUSDT',
        bidPrice: 65000,
        askPrice: 65010,
        lastPrice: 65000,
        volume24h: 100000000,
        timestamp: Date.now(),
        latencyMs: 15,
      };
      priceAggregator['latestBinance'].set('BTCUSDT', dummyBtcTicker);
      priceAggregator['recalculateSymbol']('BTCUSDT');

      mmWorker = new MMBotWorker(dbMgr, ledger, engineManager, priceAggregator);
    });

    afterEach(() => {
      mmWorker.stop();
      priceAggregator.stop();
    });

    it('executes bot cycle, applies anti-stacking, and enforces custom tick size & minimum lot size', async () => {
      // Insert a test bot with custom tick size = 10, min lot = 0.001, antiStackingActive = true
      const botId = 'test-mm-bot-btc-idr';
      dbMgr.execute(
        `INSERT INTO mm_bots (
          id, name, strategy, account_id, target_market_symbol, status, dry_run,
          mapping_config_json, depth_config_json, risk_profile_json, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          botId,
          'BTC-IDR Depth Bot',
          'DEPTH_LIQUIDITY',
          testBotUserId,
          'BTC/IDR',
          'RUNNING',
          0,
          JSON.stringify({
            referenceMarketSymbol: 'BTCUSDT',
            mappingMode: 'DIRECT_EQUIVALENT',
            requiresFxConversion: true,
            sensitivityBeta: 1.0,
            referenceAnchorPrice: 65000,
            targetAnchorPrice: 1040000000,
          }),
          JSON.stringify({
            numberOfBidLevels: 3,
            numberOfAskLevels: 3,
            minSpreadBps: 15,
            maxSpreadBps: 50,
            amountOrderLevel: 0.05,
            minAmountOrderLevel: 0.01,
            maxAmountOrderLevel: 0.1,
            qtyAmountRandom: 0, // no random variance for deterministic test
            delayMinMs: 0,
            delayMaxMs: 0,
          }),
          JSON.stringify({
            maxInventoryBase: 100,
            maxTotalBidValue: 500000000,
            maxTotalAskQty: 50,
            maxOpenOrders: 10,
            customTickSize: 10,
            minimumLotSize: 0.001,
            antiStackingActive: true,
          }),
          'superadmin',
          Date.now(),
          Date.now(),
        ]
      );

      // Start worker and run 1 execution cycle
      mmWorker['isRunning'] = true;
      await mmWorker.executeCycle();

      // Check that orders have been placed in matching engine
      const orders = dbMgr.query<any>(
        "SELECT * FROM orders WHERE user_id = ? AND pair_id = 'BTC/IDR' AND status IN ('NEW', 'OPEN', 'PARTIALLY_FILLED')",
        [testBotUserId]
      );

      expect(orders.length).toBeGreaterThan(0);
      expect(orders.length).toBeLessThanOrEqual(6); // 3 bids + 3 asks

      // Check tick size quantization (all prices must be multiple of 10)
      for (const ord of orders) {
        expect(ord.price % 10).toBe(0);
      }

      // Check Anti-Stacking: running another cycle should purge old orders and create fresh ones without accumulating
      const firstCycleOrderIds = orders.map((o) => o.id);
      await mmWorker.executeCycle();

      const secondCycleOrders = dbMgr.query<any>(
        "SELECT * FROM orders WHERE user_id = ? AND pair_id = 'BTC/IDR' AND status IN ('NEW', 'OPEN', 'PARTIALLY_FILLED')",
        [testBotUserId]
      );

      // None of the old order IDs should still be OPEN
      const secondCycleOrderIds = secondCycleOrders.map((o) => o.id);
      const overlap = firstCycleOrderIds.filter((id) => secondCycleOrderIds.includes(id));
      expect(overlap.length).toBe(0);
    });
  });
});
