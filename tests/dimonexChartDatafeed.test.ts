import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { LedgerService } from '../src/server/ledger/ledgerService';
import { EngineManager } from '../src/server/engine/engineManager';
import { KlineAggregator } from '../src/server/engine/klineAggregator';
import {
  DimonexDatafeed,
  WebSocketLike,
  computeBollingerBands,
  computeEMA,
  computeMACD,
  computeRSI,
  computeSMA,
  resolutionToInterval,
  toHeikinAshi,
} from '../src/components/trading/dimonexDatafeed';
import { TVBar } from '../src/components/trading/chartTypes';

class MockDatafeedSocket implements WebSocketLike {
  public readyState = 0; // CONNECTING
  public sent: string[] = [];
  public closed = false;
  public onopen: ((ev?: any) => void) | null = null;
  public onmessage: ((ev: { data: any }) => void) | null = null;
  public onerror: ((ev?: any) => void) | null = null;
  public onclose: ((ev?: any) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(payload: any): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe('SILENT SMILE Chart Datafeed & Backend OHLCV Integrity', () => {
  let dbMgr: DatabaseManager;
  let ledger: LedgerService;
  let engineManager: EngineManager;
  let broadcasts: Array<{ topic: string; data: any }>;

  const makerId = 'chart-test-maker';
  const takerId = 'chart-test-taker';

  beforeEach(async () => {
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    ledger = new LedgerService(dbMgr);
    engineManager = new EngineManager(dbMgr, ledger);
    broadcasts = [];
    engineManager.setBroadcastHandler((topic, data) => {
      broadcasts.push({ topic, data });
    });
    await engineManager.initialize();

    const now = Date.now();
    dbMgr.execute(
      `INSERT OR IGNORE INTO users (id, email, password_hash, role, status, kyc_level, created_at, updated_at)
       VALUES (?, ?, 'h', 'trader', 'active', 2, ?, ?)`,
      [makerId, 'maker_chart@silentsmile.io', now, now]
    );
    dbMgr.execute(
      `INSERT OR IGNORE INTO users (id, email, password_hash, role, status, kyc_level, created_at, updated_at)
       VALUES (?, ?, 'h', 'trader', 'active', 2, ?, ?)`,
      [takerId, 'taker_chart@silentsmile.io', now, now]
    );

    ledger.deposit(makerId, 'BTC', 5 * 100_000_000, 'dep_c_btc_m', 'Test capital');
    ledger.deposit(makerId, 'ETH', 20 * 1_000_000, 'dep_c_eth_m', 'Test capital');
    ledger.deposit(takerId, 'IDR', 10_000_000_000, 'dep_c_idr_t', 'Test capital');
    ledger.deposit(takerId, 'BTC', 2 * 100_000_000, 'dep_c_btc_t', 'Test capital');
  });

  function createBackendBackedDatafeed(socketsOut?: MockDatafeedSocket[]) {
    const fetchFn: typeof fetch = async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      const parsed = new URL(urlStr, 'http://localhost:3000');

      if (parsed.pathname === '/api/market/pairs') {
        const pairs = dbMgr.query('SELECT * FROM market_pairs WHERE is_active = 1');
        return new Response(
          JSON.stringify({
            success: true,
            exchange: 'SILENTSMILE',
            timezone: 'Asia/Jakarta',
            pairs,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (parsed.pathname.startsWith('/api/market/klines/')) {
        const pairRaw = parsed.pathname.replace('/api/market/klines/', '');
        const pairId = decodeURIComponent(pairRaw);
        const interval = (parsed.searchParams.get('interval') || '1m') as any;
        const from = parsed.searchParams.get('from');
        const to = parsed.searchParams.get('to');
        const countBack = parsed.searchParams.get('countBack');
        const limit = parsed.searchParams.get('limit');

        const result = engineManager.getFormattedCandles(pairId, interval, {
          fromSec: from !== null ? Number(from) : undefined,
          toSec: to !== null ? Number(to) : undefined,
          countBack: countBack !== null ? Number(countBack) : undefined,
          limit: limit !== null ? Number(limit) : undefined,
        });
        return new Response(JSON.stringify({ success: true, ...result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404 });
    };

    const wsFactory = socketsOut
      ? () => {
          const s = new MockDatafeedSocket();
          socketsOut.push(s);
          return s;
        }
      : undefined;

    return new DimonexDatafeed({ fetchFn, wsFactory });
  }

  it('1. resolves symbols with Asia/Jakarta timezone, IDR currency, and searchSymbols', async () => {
    const datafeed = createBackendBackedDatafeed();

    const readyCfg = await new Promise<any>((resolve) => datafeed.onReady(resolve));
    expect(readyCfg.supported_resolutions).toEqual(['1', '5', '15', '60', '240', '1D']);
    expect(readyCfg.exchanges[0].value).toBe('SILENTSMILE');

    const searchResults = await new Promise<any[]>((resolve) =>
      datafeed.searchSymbols('BTC', 'SILENTSMILE', 'crypto', resolve)
    );
    expect(searchResults.some((s) => s.symbol === 'BTC/IDR')).toBe(true);

    const btcInfo = await new Promise<any>((resolve, reject) =>
      datafeed.resolveSymbol('SILENTSMILE:BTC/IDR', resolve, reject)
    );
    expect(btcInfo.ticker).toBe('BTC/IDR');
    expect(btcInfo.timezone).toBe('Asia/Jakarta');
    expect(btcInfo.currency_code).toBe('IDR');
    expect(btcInfo.pricescale).toBe(1);
    expect(btcInfo.volume_precision).toBe(8);
    expect(btcInfo.session).toBe('24x7');

    await expect(
      new Promise((resolve, reject) => datafeed.resolveSymbol('UNKNOWN/XYZ', resolve, reject))
    ).rejects.toContain('Unknown symbol');

    datafeed.destroy();
  });

  it('2. builds real OHLCV strictly from executed trades with zero mock bars on empty markets', async () => {
    const datafeed = createBackendBackedDatafeed();
    const symbolInfo = await new Promise<any>((resolve, reject) =>
      datafeed.resolveSymbol('BTC/IDR', resolve, reject)
    );

    // Empty market must return noData: true (never mock candles)
    const emptyRes = await new Promise<{ bars: TVBar[]; meta: any }>((resolve, reject) =>
      datafeed.getBars(
        symbolInfo,
        '15',
        { from: 0, to: Math.floor(Date.now() / 1000), countBack: 50, firstDataRequest: true },
        (bars, meta) => resolve({ bars, meta }),
        reject
      )
    );
    expect(emptyRes.bars).toHaveLength(0);
    expect(emptyRes.meta.noData).toBe(true);

    // Execute real trades through MatchingEngine
    await engineManager.submitOrder('BTC/IDR', {
      userId: makerId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1450000000,
      amount: 25_000_000, // 0.25 BTC
    });
    await engineManager.submitOrder('BTC/IDR', {
      userId: takerId,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1450000000,
      amount: 25_000_000, // 0.25 BTC
    });

    await engineManager.submitOrder('BTC/IDR', {
      userId: makerId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1465000000,
      amount: 25_000_000, // 0.25 BTC
    });
    await engineManager.submitOrder('BTC/IDR', {
      userId: takerId,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1465000000,
      amount: 25_000_000, // 0.25 BTC
    });

    const liveRes = await new Promise<{ bars: TVBar[]; meta: any }>((resolve, reject) =>
      datafeed.getBars(
        symbolInfo,
        '15',
        { from: 0, to: Math.floor(Date.now() / 1000) + 60, countBack: 50, firstDataRequest: true },
        (bars, meta) => resolve({ bars, meta }),
        reject
      )
    );

    expect(liveRes.meta.noData).toBe(false);
    expect(liveRes.bars.length).toBeGreaterThanOrEqual(1);
    const bar = liveRes.bars[liveRes.bars.length - 1];
    expect(bar.open).toBe(1450000000);
    expect(bar.high).toBe(1465000000);
    expect(bar.low).toBe(1450000000);
    expect(bar.close).toBe(1465000000);
    // 0.25 + 0.25 = 0.50 BTC exact (zero floating drift)
    expect(bar.volume).toBe(0.5);

    datafeed.destroy();
  });

  it('3. converts all timeframes accurately including 4h aggregation', () => {
    expect(resolutionToInterval('1')).toBe('1m');
    expect(resolutionToInterval('5')).toBe('5m');
    expect(resolutionToInterval('15')).toBe('15m');
    expect(resolutionToInterval('60')).toBe('1h');
    expect(resolutionToInterval('240')).toBe('4h');
    expect(resolutionToInterval('1D')).toBe('1d');
    expect(() => resolutionToInterval('3W')).toThrow();

    const agg = new KlineAggregator();
    const baseMs = 1_700_000_000_000;
    // Two trades 2 hours apart fall inside same 4h bucket if aligned, or let's use exact aligned epoch
    const fourHourMs = 4 * 3600 * 1000;
    const alignedStart = Math.floor(baseMs / fourHourMs) * fourHourMs;

    agg.recordTrade('BTC/IDR', 1400000000, 10_000_000, 140000000, alignedStart + 1000, 'trd_1');
    agg.recordTrade('BTC/IDR', 1420000000, 20_000_000, 284000000, alignedStart + 2 * 3600 * 1000, 'trd_2');
    agg.recordTrade('BTC/IDR', 1430000000, 10_000_000, 143000000, alignedStart + fourHourMs + 5000, 'trd_3');

    const bars4h = agg.getCandles('BTC/IDR', '4h', 10);
    expect(bars4h).toHaveLength(2);
    expect(bars4h[0].open).toBe(1400000000);
    expect(bars4h[0].close).toBe(1420000000);
    expect(bars4h[0].volumeAtomic).toBe(30_000_000n);
    expect(bars4h[1].open).toBe(1430000000);
  });

  it('4 & 5. streams real-time WS candle updates and prevents duplicate trade processing', async () => {
    const sockets: MockDatafeedSocket[] = [];
    const datafeed = createBackendBackedDatafeed(sockets);
    const symbolInfo = await new Promise<any>((resolve, reject) =>
      datafeed.resolveSymbol('BTC/IDR', resolve, reject)
    );

    const receivedTicks: TVBar[] = [];
    datafeed.subscribeBars(
      symbolInfo,
      '15',
      (bar) => receivedTicks.push(bar),
      'sub_1',
      () => {}
    );

    expect(sockets).toHaveLength(1);
    sockets[0].simulateOpen();
    expect(datafeed.getConnectionStatus()).toBe('CONNECTED');
    expect(sockets[0].sent.some((s) => s.includes('kline:BTC/IDR:15m'))).toBe(true);

    // Execute real trade on EngineManager -> verify kline broadcast event generated
    await engineManager.submitOrder('BTC/IDR', {
      userId: makerId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10_000_000,
    });
    await engineManager.submitOrder('BTC/IDR', {
      userId: takerId,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10_000_000,
    });

    const klineEvt = broadcasts.find((b) => b.topic === 'kline:BTC/IDR:15m');
    expect(klineEvt).toBeDefined();

    // Deliver the server kline event TWICE (simulating WS duplicate frame)
    sockets[0].simulateMessage({ topic: 'kline:BTC/IDR:15m', data: klineEvt!.data });
    sockets[0].simulateMessage({ topic: 'kline:BTC/IDR:15m', data: klineEvt!.data });

    expect(receivedTicks).toHaveLength(1);
    expect(receivedTicks[0].close).toBe(1500000000);
    expect(receivedTicks[0].volume).toBe(0.1);

    // Backend duplicate protection check on KlineAggregator directly
    const agg = new KlineAggregator();
    const first = agg.recordTrade('BTC/IDR', 1500000000, 10_000_000, 150000000, Date.now(), 'dup_trd_99');
    const second = agg.recordTrade('BTC/IDR', 1500000000, 10_000_000, 150000000, Date.now(), 'dup_trd_99');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(agg.getCandles('BTC/IDR', '15m')[0].volumeAtomic).toBe(10_000_000n);

    datafeed.destroy();
  });

  it('6. supports historical pagination with from/to/countBack across persisted SQLite trades', async () => {
    const datafeed = createBackendBackedDatafeed();
    const stepMs = 15 * 60 * 1000;
    const baseMs = Math.floor((Date.now() - 10 * stepMs) / stepMs) * stepMs;

    // Insert 6 historical trades across 6 separate 15m buckets in SQLite
    for (let i = 0; i < 6; i++) {
      const ordBuy = `ord_p_b_${i}`;
      const ordSell = `ord_p_s_${i}`;
      const ts = baseMs + i * stepMs + 5000;
      dbMgr.execute(
        `INSERT INTO orders (id, user_id, pair_id, side, order_type, price, amount, filled_amount, remaining_amount, status, created_at, updated_at)
         VALUES (?, ?, 'BTC/IDR', 'BUY', 'LIMIT', ?, 10000000, 10000000, 0, 'FILLED', ?, ?)`,
        [ordBuy, takerId, 1400000000 + i * 1000000, ts, ts]
      );
      dbMgr.execute(
        `INSERT INTO orders (id, user_id, pair_id, side, order_type, price, amount, filled_amount, remaining_amount, status, created_at, updated_at)
         VALUES (?, ?, 'BTC/IDR', 'SELL', 'LIMIT', ?, 10000000, 10000000, 0, 'FILLED', ?, ?)`,
        [ordSell, makerId, 1400000000 + i * 1000000, ts, ts]
      );
      dbMgr.execute(
        `INSERT INTO trades (id, pair_id, price, amount, total, side, maker_order_id, taker_order_id, maker_user_id, taker_user_id, maker_fee, taker_fee, timestamp)
         VALUES (?, 'BTC/IDR', ?, 10000000, 140000000, 'BUY', ?, ?, ?, ?, 0, 0, ?)`,
        [`trd_hist_${i}`, 1400000000 + i * 1000000, ordSell, ordBuy, makerId, takerId, ts]
      );
    }

    const symbolInfo = await new Promise<any>((resolve, reject) =>
      datafeed.resolveSymbol('BTC/IDR', resolve, reject)
    );

    const midSec = Math.floor((baseMs + 3 * stepMs) / 1000);
    const pageRecent = await new Promise<TVBar[]>((resolve, reject) =>
      datafeed.getBars(
        symbolInfo,
        '15',
        { from: midSec, to: Math.floor((baseMs + 6 * stepMs) / 1000), countBack: 3, firstDataRequest: true },
        (bars) => resolve(bars),
        reject
      )
    );
    const pageOlder = await new Promise<TVBar[]>((resolve, reject) =>
      datafeed.getBars(
        symbolInfo,
        '15',
        { from: Math.floor(baseMs / 1000), to: pageRecent[0].time / 1000 - 1, countBack: 3, firstDataRequest: false },
        (bars) => resolve(bars),
        reject
      )
    );

    expect(pageRecent.length).toBe(3);
    expect(pageOlder.length).toBe(3);
    // Strict non-overlapping ascending timestamps across pages
    expect(pageOlder[pageOlder.length - 1].time).toBeLessThan(pageRecent[0].time);

    datafeed.destroy();
  });

  it('7 & 9. isolates pair switching and manages WebSocket subscription lifecycle cleanly', async () => {
    const sockets: MockDatafeedSocket[] = [];
    const datafeed = createBackendBackedDatafeed(sockets);

    // Execute one trade on ETH/IDR and one on BTC/IDR
    await engineManager.submitOrder('BTC/IDR', {
      userId: makerId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1450000000,
      amount: 10_000_000,
    });
    await engineManager.submitOrder('BTC/IDR', {
      userId: takerId,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1450000000,
      amount: 10_000_000,
    });
    await engineManager.submitOrder('ETH/IDR', {
      userId: makerId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 52000000,
      amount: 500_000,
    });
    await engineManager.submitOrder('ETH/IDR', {
      userId: takerId,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 52000000,
      amount: 500_000,
    });

    const btcInfo = await new Promise<any>((r, e) => datafeed.resolveSymbol('BTC/IDR', r, e));
    const ethInfo = await new Promise<any>((r, e) => datafeed.resolveSymbol('ETH/IDR', r, e));

    const btcBars = await datafeed.fetchHistoricalCandlesSeconds('BTC/IDR', '15');
    const ethBars = await datafeed.fetchHistoricalCandlesSeconds('ETH/IDR', '15');

    expect(btcBars.bars[0].close).toBe(1450000000);
    expect(ethBars.bars[0].close).toBe(52000000);

    // Subscribe BTC/IDR then switch (unsubscribe BTC, subscribe ETH)
    datafeed.subscribeBars(btcInfo, '15', () => {}, 'sub_btc', () => {});
    sockets[0].simulateOpen();
    expect(sockets[0].sent.some((m) => m.includes('"topic":"kline:BTC/IDR:15m"'))).toBe(true);

    datafeed.subscribeBars(ethInfo, '15', () => {}, 'sub_eth', () => {});
    datafeed.unsubscribeBars('sub_btc');
    expect(sockets[0].sent.some((m) => m.includes('"action":"unsubscribe"') && m.includes('kline:BTC/IDR:15m'))).toBe(true);
    expect(sockets[0].closed).toBe(false); // ETH subscription still active

    // Unsubscribe last listener -> closes socket cleanly
    datafeed.unsubscribeBars('sub_eth');
    expect(sockets[0].closed).toBe(true);
    expect(datafeed.getConnectionStatus()).toBe('DISCONNECTED');

    datafeed.destroy();
  });

  it('8 & 10. keeps historical + realtime candles consistent without resetting earlier bars and computes real indicators', async () => {
    const sockets: MockDatafeedSocket[] = [];
    const datafeed = createBackendBackedDatafeed(sockets);
    const stepSec = 900;
    const bucket1 = Math.floor((Date.now() - 2 * stepSec * 1000) / 1000 / stepSec) * stepSec;
    const bucket2 = bucket1 + stepSec;

    // Trade in historical bucket 1
    const t1Ts = bucket1 * 1000 + 2000;
    dbMgr.execute(
      `INSERT INTO orders (id, user_id, pair_id, side, order_type, price, amount, filled_amount, remaining_amount, status, created_at, updated_at)
       VALUES ('ob1', ?, 'BTC/IDR', 'BUY', 'LIMIT', 1400000000, 10000000, 10000000, 0, 'FILLED', ?, ?)`,
      [takerId, t1Ts, t1Ts]
    );
    dbMgr.execute(
      `INSERT INTO orders (id, user_id, pair_id, side, order_type, price, amount, filled_amount, remaining_amount, status, created_at, updated_at)
       VALUES ('os1', ?, 'BTC/IDR', 'SELL', 'LIMIT', 1400000000, 10000000, 10000000, 0, 'FILLED', ?, ?)`,
      [makerId, t1Ts, t1Ts]
    );
    dbMgr.execute(
      `INSERT INTO trades (id, pair_id, price, amount, total, side, maker_order_id, taker_order_id, maker_user_id, taker_user_id, maker_fee, taker_fee, timestamp)
       VALUES ('trd_b1', 'BTC/IDR', 1400000000, 10000000, 140000000, 'BUY', 'os1', 'ob1', ?, ?, 0, 0, ?)`,
      [makerId, takerId, t1Ts]
    );

    // Fetch historical candles
    const hist = await datafeed.fetchHistoricalCandlesSeconds('BTC/IDR', '15');
    expect(hist.bars).toHaveLength(1);
    expect(hist.bars[0].time).toBe(bucket1);

    // Subscribe realtime and simulate bucket 2 arriving incrementally without wiping bucket 1
    const liveUpdates: any[] = [];
    const unsub = datafeed.subscribeCandlesSeconds('BTC/IDR', '15', (b) => liveUpdates.push(b), 'sub_cons');
    sockets[0].simulateOpen();
    sockets[0].simulateMessage({
      topic: 'kline:BTC/IDR:15m',
      data: {
        pairId: 'BTC/IDR',
        interval: '15m',
        tradeId: 'trd_b2_live',
        candle: { time: bucket2, open: 1410000000, high: 1415000000, low: 1408000000, close: 1412000000, volume: 0.2 },
      },
    });
    // Out-of-order older candle (earlier than bucket2) must be rejected so active candle is not overwritten
    sockets[0].simulateMessage({
      topic: 'kline:BTC/IDR:15m',
      data: {
        pairId: 'BTC/IDR',
        interval: '15m',
        tradeId: 'trd_stale_old',
        candle: { time: bucket1, open: 1390000000, high: 1390000000, low: 1390000000, close: 1390000000, volume: 0.1 },
      },
    });

    expect(liveUpdates).toHaveLength(1);
    expect(liveUpdates[0].time).toBe(bucket2);

    // Cleanup lifecycle
    unsub();
    expect(sockets[0].closed).toBe(true);
    datafeed.destroy();

    // Verify genuine indicator math & Heikin Ashi calculations
    const sampleBars = Array.from({ length: 40 }, (_, i) => ({
      time: 1_700_000_000 + i * 900,
      open: 1400 + i * 5,
      high: 1410 + i * 5,
      low: 1395 + i * 5,
      close: 1405 + i * 5,
      volume: 10 + i,
    }));
    expect(computeSMA(sampleBars, 7).length).toBe(34);
    expect(computeEMA(sampleBars, 9).length).toBe(32);
    const bb = computeBollingerBands(sampleBars, 20, 2);
    expect(bb.upper.length).toBe(21);
    expect(bb.upper[0].value).toBeGreaterThan(bb.middle[0].value);
    expect(bb.lower[0].value).toBeLessThan(bb.middle[0].value);
    const rsi = computeRSI(sampleBars, 14);
    expect(rsi.length).toBe(26);
    expect(rsi[rsi.length - 1].value).toBeGreaterThan(50);
    const macd = computeMACD(sampleBars, 12, 26, 9);
    expect(macd.macd.length).toBe(15);
    expect(macd.signal.length).toBe(7);
    const ha = toHeikinAshi(sampleBars);
    expect(ha).toHaveLength(40);
  });

  it('8. persists real-time executed trades into SQLite and deduplicates local bridge vs WS kline updates', async () => {
    const sockets: MockDatafeedSocket[] = [];
    const datafeed = createBackendBackedDatafeed(sockets);

    const liveBars: any[] = [];
    const unsub = datafeed.subscribeCandlesSeconds(
      'CUSTOM/IDR',
      '15',
      (bar) => liveBars.push(bar),
      'sub_custom_realtime'
    );
    sockets[0].simulateOpen();

    const ts = Date.now();
    // 1. Simulate instant client bridge firing when spot trade executes
    datafeed.ingestLocalTrades('CUSTOM/IDR', [
      { id: 'trd_rt_sync_1', pair: 'CUSTOM/IDR', price: 25500, amount: 12.5, timestamp: ts },
    ]);
    expect(liveBars).toHaveLength(1);
    expect(liveBars[0].close).toBe(25500);
    expect(liveBars[0].volume).toBe(12.5);

    // 2. Persist the exact same trade via EngineManager.recordExecutedTrade (SQLite + WS broadcast)
    const rec = await engineManager.recordExecutedTrade({
      id: 'trd_rt_sync_1',
      pairId: 'CUSTOM/IDR',
      price: 25500,
      amount: 12.5,
      side: 'buy',
      timestamp: ts,
      pairMeta: {
        baseAsset: 'CUSTOM',
        quoteAsset: 'IDR',
        basePrecision: 2,
        quotePrecision: 0,
        isActive: true,
        tradingStatus: 'OPEN',
      },
    });
    expect(rec.recorded).toBe(true);

    // Re-delivering the WS kline event for trd_rt_sync_1 must be deduplicated cleanly
    const klineEvt = broadcasts.find((b) => b.topic === 'kline:CUSTOM/IDR:15m' && b.data?.tradeId === 'trd_rt_sync_1');
    expect(klineEvt).toBeDefined();
    sockets[0].simulateMessage({ topic: 'kline:CUSTOM/IDR:15m', data: klineEvt!.data });
    expect(liveBars).toHaveLength(1);

    // 3. Duplicate recordExecutedTrade call with same tradeId is idempotent
    const dup = await engineManager.recordExecutedTrade({
      id: 'trd_rt_sync_1',
      pairId: 'CUSTOM/IDR',
      price: 25500,
      amount: 12.5,
      side: 'buy',
      timestamp: ts,
    });
    expect(dup.recorded).toBe(false);

    // 4. Reloading historical OHLCV from SQLite returns exact persisted candle across intervals
    const hist15m = await datafeed.fetchHistoricalCandlesSeconds('CUSTOM/IDR', '15');
    const hist1m = await datafeed.fetchHistoricalCandlesSeconds('CUSTOM/IDR', '1');
    expect(hist15m.bars).toHaveLength(1);
    expect(hist15m.bars[0].close).toBe(25500);
    expect(hist15m.bars[0].volume).toBe(12.5);
    expect(hist1m.bars).toHaveLength(1);
    expect(hist1m.bars[0].volume).toBe(12.5);

    unsub();
    datafeed.destroy();
  });
});
