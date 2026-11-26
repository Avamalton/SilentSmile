import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { LedgerService } from '../src/server/ledger/ledgerService';
import { EngineManager } from '../src/server/engine/engineManager';
import { PrecisionMath } from '../src/server/ledger/PrecisionMath';
import { VolumeExecutionV2Service, BotActor } from '../src/server/services/bots/VolumeExecutionV2Service';
import { AuthService } from '../src/server/auth/authService';
import { VolumeBotConfig } from '../src/server/db/types';

describe('Volume Execution V2 Engine — Institutional Authoritative Suite', () => {
  let dbMgr: DatabaseManager;
  let ledger: LedgerService;
  let engineManager: EngineManager;
  let authService: AuthService;
  let volumeService: VolumeExecutionV2Service;

  const adminActor: BotActor = { userId: 'usr_admin_bot', role: 'admin' };
  const mmActor: BotActor = { userId: 'usr_mm_test', role: 'market_maker' };
  const traderActor: BotActor = { userId: 'usr_trader_test', role: 'trader' };
  const counterActorId = 'usr_counter_01';

  function baseConfig(overrides: Partial<VolumeBotConfig> = {}): Partial<VolumeBotConfig> {
    return {
      botName: 'BTC/IDR Test Volume Bot',
      pairId: 'BTC/IDR',
      accountId: mmActor.userId,
      environment: 'DEMO',
      executionMode: 'LIVE',
      executionSide: 'BUY',
      targetVolume: '0.05000000',
      minSliceSize: '0.01000000',
      maxSliceSize: '0.02000000',
      autoStopOnTarget: true,
      minIntervalMs: 500,
      maxIntervalMs: 500,
      pauseBetweenWindowsMs: 0,
      maxOrdersPerMinute: 60,
      orderTimeoutMs: 30000,
      partialFillRetryLimit: 3,
      cooldownAfterFailureMs: 1000,
      strategy: 'AGGRESSIVE_LIMIT',
      aggressiveMaxTicks: 0,
      passiveOffsetTicks: 1,
      icebergVisibleRatioPct: 20,
      referencePriceSource: 'INTERNAL_BOOK',
      minPriceCollar: '1000000000',
      maxPriceCollar: '2000000000',
      maxSlippageBps: 200,
      maxParticipationRateBps: 10000,
      staleMarketDataMaxAgeMs: 30000,
      tickSize: '1000',
      lotSize: '0.00010000',
      maxBaseInventory: '0',
      maxQuoteInventory: '0',
      maxOrderNotional: '0',
      maxCumulativeExposure: '0',
      dailyExecutionLimit: '0',
      maxOpenOrders: 5,
      selfTradePrevention: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    DatabaseManager.resetInstance();
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    ledger = new LedgerService(dbMgr);
    authService = new AuthService(dbMgr);

    // Seed active test users
    const now = Date.now();
    for (const u of [
      { id: adminActor.userId, email: 'admin.test@silentsmile.io', role: 'admin' },
      { id: mmActor.userId, email: 'mm.test@silentsmile.io', role: 'market_maker' },
      { id: traderActor.userId, email: 'trader.test@silentsmile.io', role: 'trader' },
      { id: counterActorId, email: 'counter.test@silentsmile.io', role: 'trader' },
    ]) {
      dbMgr.execute(
        `INSERT OR IGNORE INTO users (id, email, password_hash, role, status, kyc_level, created_at, updated_at)
         VALUES (?, ?, 'hash', ?, 'active', 2, ?, ?)`,
        [u.id, u.email, u.role, now, now]
      );
    }

    // Fund counterparty and MM test account legitimately
    ledger.deposit(mmActor.userId, 'IDR', 500000000, 'dep_mm_idr');
    ledger.deposit(mmActor.userId, 'BTC', 100000000, 'dep_mm_btc');
    ledger.deposit(counterActorId, 'IDR', 500000000, 'dep_cnt_idr');
    ledger.deposit(counterActorId, 'BTC', 200000000, 'dep_cnt_btc');

    engineManager = new EngineManager(dbMgr, ledger);
    await engineManager.initialize();
    volumeService = new VolumeExecutionV2Service(dbMgr, ledger, engineManager);
  });

  it('1. Zero-fill volume accounting: open, cancelled, and rejected orders never increment executed volume', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    // Seed a resting ask at 1,500,000,000 so reference price is valid
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000,
    });

    const bot = volumeService.createBot(
      baseConfig({
        strategy: 'PASSIVE_LIMIT',
        passiveOffsetTicks: 5,
        targetVolume: '0.05000000',
        minSliceSize: '0.01000000',
        maxSliceSize: '0.01000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);

    // Execute cycle places a passive resting bid below best ask -> 0 fills
    const afterTick = await volumeService.executeBotCycle(bot.id);
    expect(afterTick.metrics.submittedOrdersCount).toBe(1);
    expect(afterTick.metrics.acceptedOrdersCount).toBe(1);
    expect(afterTick.metrics.totalTradesCount).toBe(0);
    expect(afterTick.metrics.executedQtyAtomic).toBe('0');
    expect(afterTick.metrics.executedVolume).toBe('0');

    // Stop bot -> cancels the resting order; still 0 executed volume
    const afterStop = await volumeService.stopBot(bot.id, mmActor);
    expect(afterStop.metrics.cancelledOrdersCount).toBe(1);
    expect(afterStop.metrics.executedQtyAtomic).toBe('0');
  });

  it('2. Partial-fill accounting: only actual filled trade quantity counts toward executed volume', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    // Counterparty sells only 0.004 BTC (400,000 sats) at 1,500,000,000
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 400000,
    });

    const bot = volumeService.createBot(
      baseConfig({
        targetVolume: '0.05000000',
        minSliceSize: '0.01000000',
        maxSliceSize: '0.01000000',
        maxParticipationRateBps: 10000,
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);

    const after = await volumeService.executeBotCycle(bot.id);
    expect(after.metrics.totalTradesCount).toBe(1);
    expect(after.metrics.executedQtyAtomic).toBe('400000'); // 0.004 BTC filled, NOT 0.01 BTC ordered
    expect(after.metrics.remainingQtyAtomic).toBe('4600000');
    expect(after.metrics.partialFillsCount).toBe(1);
    expect(after.metrics.openOrdersCount).toBe(1);
  });

  it('3. Duplicate trade prevention: recording the same trade_id twice never double-counts', async () => {
    const bot = volumeService.createBot(baseConfig(), mmActor, { deploy: true });

    const first = volumeService.recordBotTradeAtomic({
      botId: bot.id,
      tradeId: 'trd_dedupe_001',
      orderId: 'ord_dedupe_001',
      pairId: 'BTC/IDR',
      executionMode: 'LIVE',
      side: 'BUY',
      priceAtomic: 1500000000n,
      amountAtomic: 1000000n,
      quoteTotalAtomic: 15000000n,
      feeAtomic: 1500n,
      feeAsset: 'BTC',
      slippageBps: 0,
      timestamp: Date.now(),
      orderStatusAfter: 'FILLED',
    });
    const second = volumeService.recordBotTradeAtomic({
      botId: bot.id,
      tradeId: 'trd_dedupe_001',
      orderId: 'ord_dedupe_001',
      pairId: 'BTC/IDR',
      executionMode: 'LIVE',
      side: 'BUY',
      priceAtomic: 1500000000n,
      amountAtomic: 1000000n,
      quoteTotalAtomic: 15000000n,
      feeAtomic: 1500n,
      feeAsset: 'BTC',
      slippageBps: 0,
      timestamp: Date.now(),
      orderStatusAfter: 'FILLED',
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const fetched = volumeService.getBotById(bot.id, mmActor);
    expect(fetched.metrics.executedQtyAtomic).toBe('1000000');
    expect(fetched.metrics.totalTradesCount).toBe(1);
  });

  it('4. BigInt precision & decimal string serialization: 18-decimal precision without float drift', () => {
    const qtyAtomic = PrecisionMath.parseDecimalToAtomic('0.123456789012345678', 18);
    expect(qtyAtomic).toBe(123456789012345678n);
    expect(PrecisionMath.formatAtomicToDecimal(qtyAtomic, 18)).toBe('0.123456789012345678');

    const priceAtomic = PrecisionMath.parseDecimalToAtomic('52450000', 0);
    const notional = PrecisionMath.computeQuoteNotionalAtomic(priceAtomic, qtyAtomic, 18);
    expect(notional).toBe((52450000n * 123456789012345678n) / 10n ** 18n);

    const fee = PrecisionMath.calculateFeeBpsAtomic(1000000000000000000n, 15);
    expect(fee.feeAtomic).toBe(1500000000000000n);
    expect(fee.netAtomic).toBe(998500000000000000n);
  });

  it('5. Tick and lot normalization: enforces exact tick multiples and lot boundaries', () => {
    const normalizedPriceFloor = PrecisionMath.normalizePriceToTick(1485600750n, 1000n, 'floor');
    const normalizedPriceCeil = PrecisionMath.normalizePriceToTick(1485600250n, 1000n, 'ceil');
    expect(normalizedPriceFloor).toBe(1485600000n);
    expect(normalizedPriceCeil).toBe(1485601000n);

    const normalizedLot = PrecisionMath.normalizeQtyToLot(1234567n, 10000n, 'floor');
    expect(normalizedLot).toBe(1230000n);
  });

  it('6. Insufficient balance protection: LIVE mode risk-locks on insufficient balance without injecting funds', async () => {
    const poorUser = 'usr_poor_01';
    const now = Date.now();
    dbMgr.execute(
      `INSERT INTO users (id, email, password_hash, role, status, kyc_level, created_at, updated_at)
       VALUES (?, 'poor@silentsmile.io', 'h', 'market_maker', 'active', 2, ?, ?)`,
      [poorUser, now, now]
    );
    ledger.deposit(poorUser, 'IDR', 1000, 'dep_poor_only_1000'); // Only 1,000 IDR

    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 5000000,
    });

    const bot = volumeService.createBot(
      baseConfig({
        accountId: poorUser,
        targetVolume: '0.02000000',
        minSliceSize: '0.01000000',
        maxSliceSize: '0.01000000',
      }),
      adminActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, adminActor);
    const res = await volumeService.executeBotCycle(bot.id);

    expect(res.status).toBe('RISK_LOCKED');
    expect(res.riskState.balanceRejections).toBeGreaterThan(0);
    expect(res.metrics.executedQtyAtomic).toBe('0');
    // Verify balance was NOT inflated
    expect(ledger.getBalance(poorUser, 'IDR').available).toBe(1000);
  });

  it('7. Insufficient inventory cap: enforces maxBaseInventory cap before BUY execution', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 5000000,
    });

    // mmActor already holds 1.0 BTC (`100000000`), cap maxBaseInventory to 0.5 BTC
    const bot = volumeService.createBot(
      baseConfig({
        maxBaseInventory: '0.50000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);
    const res = await volumeService.executeBotCycle(bot.id);

    expect(res.status).toBe('RISK_LOCKED');
    expect(res.lastError).toContain('MAX_BASE_INVENTORY_CAP');
    expect(res.metrics.executedQtyAtomic).toBe('0');
  });

  it('8. Self-trade prevention: refuses to cross own-account opposite resting orders', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    // mmActor posts the ONLY ask on the book
    await engine.submitOrder({
      userId: mmActor.userId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 5000000,
    });

    const bot = volumeService.createBot(
      baseConfig({
        strategy: 'AGGRESSIVE_LIMIT',
        executionSide: 'BUY',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);
    const res = await volumeService.executeBotCycle(bot.id);

    expect(res.riskState.stpInterceptions).toBe(1);
    expect(res.metrics.totalTradesCount).toBe(0);
    expect(res.metrics.executedQtyAtomic).toBe('0');
  });

  it('9. Maximum slippage enforcement & price collar rejection', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    // Bid @ 1,000,000,000 and Ask @ 1,400,000,000 -> mid = 1,200,000,000; ask deviates 1,666 bps from mid!
    await engine.submitOrder({
      userId: counterActorId,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1000000000,
      amount: 5000000,
    });
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1400000000,
      amount: 5000000,
    });

    const botSlippage = volumeService.createBot(
      baseConfig({
        strategy: 'AGGRESSIVE_LIMIT',
        maxSlippageBps: 100, // 1% max slippage
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(botSlippage.id, mmActor);
    const slipRes = await volumeService.executeBotCycle(botSlippage.id);
    expect(slipRes.riskState.slippageBreaches).toBe(1);
    expect(slipRes.metrics.totalTradesCount).toBe(0);

    // Price collar rejection (maxPriceCollar = 1,300,000,000 < ask 1,400,000,000)
    const botCollar = volumeService.createBot(
      baseConfig({
        strategy: 'AGGRESSIVE_LIMIT',
        maxSlippageBps: 5000,
        minPriceCollar: '1000000000',
        maxPriceCollar: '1300000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(botCollar.id, mmActor);
    const collarRes = await volumeService.executeBotCycle(botCollar.id);
    expect(collarRes.riskState.collarBreaches).toBe(1);
    expect(collarRes.metrics.totalTradesCount).toBe(0);
  });

  it('10. Maximum cumulative exposure limit blocks orders beyond total quote cap', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000,
    });

    // Slice = 0.01 BTC @ 1.5B = 15,000,000 IDR; set maxCumulativeExposure = 20,000,000 IDR
    const bot = volumeService.createBot(
      baseConfig({
        targetVolume: '0.05000000',
        minSliceSize: '0.01000000',
        maxSliceSize: '0.01000000',
        minIntervalMs: 250,
        maxIntervalMs: 250,
        maxCumulativeExposure: '20000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);

    const t1 = await volumeService.executeBotCycle(bot.id, Date.now());
    expect(t1.metrics.executedQuoteAtomic).toBe('15000000');

    // Second slice would reach 30,000,000 > 20,000,000 -> RISK_LOCKED
    const t2 = await volumeService.executeBotCycle(bot.id, Date.now() + 1000);
    expect(t2.status).toBe('RISK_LOCKED');
    expect(t2.lastError).toContain('MAX_CUMULATIVE_EXPOSURE_REACHED');
    expect(t2.metrics.executedQuoteAtomic).toBe('15000000');
  });

  it('11. Daily execution limit blocks trades exceeding daily quote budget', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000,
    });

    const bot = volumeService.createBot(
      baseConfig({
        targetVolume: '0.05000000',
        minSliceSize: '0.01000000',
        maxSliceSize: '0.01000000',
        minIntervalMs: 250,
        maxIntervalMs: 250,
        dailyExecutionLimit: '18000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);

    const t1 = await volumeService.executeBotCycle(bot.id, Date.now());
    expect(t1.metrics.dailyExecutedQuoteAtomic).toBe('15000000');

    const t2 = await volumeService.executeBotCycle(bot.id, Date.now() + 1000);
    expect(t2.status).toBe('RISK_LOCKED');
    expect(t2.lastError).toContain('DAILY_EXECUTION_LIMIT_REACHED');
  });

  it('12. Order timeout & expiry cancellation cancels resting bot order and unlocks ledger funds', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000,
    });

    const initialAvail = ledger.getBalance(mmActor.userId, 'IDR').available;
    const t0 = 1_700_000_000_000;

    const bot = volumeService.createBot(
      baseConfig({
        strategy: 'PASSIVE_LIMIT',
        passiveOffsetTicks: 5,
        orderTimeoutMs: 2000,
        minIntervalMs: 5000,
        maxIntervalMs: 5000,
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);

    const res1 = await volumeService.executeBotCycle(bot.id, t0);
    expect(res1.metrics.openOrdersCount).toBe(1);
    expect(ledger.getBalance(mmActor.userId, 'IDR').lockedOrder).toBeGreaterThan(0);

    // Advance clock past orderTimeoutMs (2000ms) but before nextScheduledAt
    const res2 = await volumeService.executeBotCycle(bot.id, t0 + 2500);
    expect(res2.metrics.expiredOrdersCount).toBe(1);
    expect(res2.metrics.openOrdersCount).toBe(0);
    expect(ledger.getBalance(mmActor.userId, 'IDR').lockedOrder).toBe(0);
    expect(ledger.getBalance(mmActor.userId, 'IDR').available).toBe(initialAvail);
  });

  it('13. Partial fill retry limit transitions bot to RISK_LOCKED after exceeding retry threshold', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    // Partial fill 0.002 BTC at 1,500,000,000, leaving 0.008 BTC resting
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 200000,
    });

    const t0 = 1_700_000_100_000;
    const bot = volumeService.createBot(
      baseConfig({
        targetVolume: '0.05000000',
        minSliceSize: '0.01000000',
        maxSliceSize: '0.01000000',
        minIntervalMs: 2000,
        maxIntervalMs: 2000,
        orderTimeoutMs: 1500,
        partialFillRetryLimit: 1,
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);

    // Cycle 1: places 0.01 BTC, partial fill 0.002 -> resting 0.008 (expires t0+1500)
    await volumeService.executeBotCycle(bot.id, t0);
    // At t0+1600: order 1 expires (retryCount=1), nextScheduledAt is t0+2000 so no new order yet
    await volumeService.executeBotCycle(bot.id, t0 + 1600);
    // Now add thin counterparty 0.001 SELL and run Cycle 2 at t0+2000 -> partial fill 0.001, resting 0.009 (expires t0+3500)
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 100000,
    });
    await volumeService.executeBotCycle(bot.id, t0 + 2000);
    // Cycle 3 at t0+4000: expires second partial order -> retryCount=2 > limit=1 -> RISK_LOCKED
    const res3 = await volumeService.executeBotCycle(bot.id, t0 + 4000);
    expect(res3.status).toBe('RISK_LOCKED');
    expect(res3.lastError).toContain('PARTIAL_FILL_RETRY_LIMIT_EXCEEDED');
  });

  it('14. Stop cancels ONLY bot-owned orders and leaves manual/other orders on the same account untouched', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    // Manual order placed directly by mmActor on the same account
    const manualOrd = await engine.submitOrder({
      userId: mmActor.userId,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1400000000,
      amount: 1000000,
    });

    // Counterparty ask so reference price exists
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 5000000,
    });

    const bot = volumeService.createBot(
      baseConfig({
        strategy: 'PASSIVE_LIMIT',
        passiveOffsetTicks: 5,
        maxSlippageBps: 500,
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);
    await volumeService.executeBotCycle(bot.id);

    // Both manual order and bot order are active in the book
    expect(engine.book.orderMap.has(manualOrd.orderId)).toBe(true);
    expect(engine.book.bids.length).toBe(2);

    const stopped = await volumeService.stopBot(bot.id, mmActor);
    expect(stopped.metrics.openOrdersCount).toBe(0);
    expect(stopped.metrics.cancelledOrdersCount).toBe(1);
    // Manual order MUST remain untouched in book and DB!
    expect(engine.book.orderMap.has(manualOrd.orderId)).toBe(true);
    const manualRow = dbMgr.queryOne<any>('SELECT status FROM orders WHERE id = ?', [manualOrd.orderId]);
    expect(manualRow.status).toBe('NEW');
  });

  it('15. Restart recovery & order/trade reconciliation restores state without double-counting', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000,
    });

    const bot = volumeService.createBot(
      baseConfig({
        strategy: 'PASSIVE_LIMIT',
        passiveOffsetTicks: 5,
        minSliceSize: '0.01000000',
        maxSliceSize: '0.01000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(bot.id, mmActor);
    const afterPlace = await volumeService.executeBotCycle(bot.id);
    expect(afterPlace.metrics.openOrdersCount).toBe(1);

    const hist = volumeService.getBotHistory(bot.id, mmActor);
    const botOrdId = hist.orders[0].id;
    const botOrdPrice = Number(hist.orders[0].price_atomic);

    // Simulate counterparty crossing bot's resting passive order while bot worker isn't running
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: botOrdPrice,
      amount: 1000000,
    });

    // Simulate server restart: fresh EngineManager & fresh VolumeExecutionV2Service
    const restartedEngineMgr = new EngineManager(dbMgr, ledger);
    await restartedEngineMgr.initialize();
    const restartedVolumeSvc = new VolumeExecutionV2Service(dbMgr, ledger, restartedEngineMgr);
    await restartedVolumeSvc.recoverAll();

    const recovered = restartedVolumeSvc.getBotById(bot.id, mmActor);
    expect(recovered.metrics.executedQtyAtomic).toBe('1000000');
    expect(recovered.metrics.totalTradesCount).toBe(1);

    // Calling recoverAll() again must remain idempotent (zero double-counting)
    await restartedVolumeSvc.recoverAll();
    const recoveredAgain = restartedVolumeSvc.getBotById(bot.id, mmActor);
    expect(recoveredAgain.metrics.executedQtyAtomic).toBe('1000000');
    expect(recoveredAgain.metrics.totalTradesCount).toBe(1);
    expect(botOrdId).toBeTruthy();
  });

  it('16. Idempotent order submission: duplicate idempotencyKey returns existing order without placing twice', async () => {
    const bot = volumeService.createBot(
      baseConfig({ executionMode: 'SIMULATION' }),
      mmActor,
      { deploy: true }
    );

    const first = await volumeService.submitIdempotentOrderForBot({
      botId: bot.id,
      idempotencyKey: 'idem_fixed_key_01',
      priceAtomic: 1500000000n,
      amountAtomic: 1000000n,
    });
    const second = await volumeService.submitIdempotentOrderForBot({
      botId: bot.id,
      idempotencyKey: 'idem_fixed_key_01',
      priceAtomic: 1500000000n,
      amountAtomic: 1000000n,
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(volumeService.getBotById(bot.id, mmActor).metrics.submittedOrdersCount).toBe(1);
  });

  it('17. SIMULATION isolation: never mutates ledger_accounts, orders, or real trades tables', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000,
    });

    const mmIdrBefore = ledger.getBalance(mmActor.userId, 'IDR').available;
    const mmBtcBefore = ledger.getBalance(mmActor.userId, 'BTC').available;
    const realOrdersBefore = dbMgr.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM orders')!.c;
    const realTradesBefore = dbMgr.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM trades')!.c;

    const simBot = volumeService.createBot(
      baseConfig({
        executionMode: 'SIMULATION',
        environment: 'SANDBOX',
        strategy: 'AGGRESSIVE_LIMIT',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(simBot.id, mmActor);
    const afterSim = await volumeService.executeBotCycle(simBot.id);

    expect(afterSim.executionMode).toBe('SIMULATION');
    expect(afterSim.metrics.totalTradesCount).toBe(1);
    expect(BigInt(afterSim.metrics.executedQtyAtomic)).toBeGreaterThan(0n);

    // Real ledger, real orders, and real trades MUST remain untouched!
    expect(ledger.getBalance(mmActor.userId, 'IDR').available).toBe(mmIdrBefore);
    expect(ledger.getBalance(mmActor.userId, 'BTC').available).toBe(mmBtcBefore);
    expect(dbMgr.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM orders')!.c).toBe(realOrdersBefore);
    expect(dbMgr.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM trades')!.c).toBe(realTradesBefore);
    expect(ledger.verifyLedgerIntegrity().isValid).toBe(true);
  });

  it('18. Authorization, ownership, config rollback, and legacy migration', async () => {
    const bot = volumeService.createBot(baseConfig({ targetVolume: '0.05000000' }), mmActor, { deploy: true });

    // Unowned trader cannot read or stop mmActor's bot
    expect(() => volumeService.getBotById(bot.id, traderActor)).toThrow(/Forbidden/);
    await expect(volumeService.stopBot(bot.id, traderActor)).rejects.toThrow(/Forbidden/);

    // Update config to v2 and rollback to v1
    const v2 = volumeService.updateBot(bot.id, { targetVolume: '0.10000000' }, mmActor);
    expect(v2.configVersion).toBe(2);
    expect(v2.metrics.targetVolume).toBe('0.1');

    const rolled = volumeService.rollbackBotConfig(bot.id, 1, mmActor);
    expect(rolled.configVersion).toBe(3);
    expect(rolled.metrics.targetVolume).toBe('0.05');

    // Legacy migration preserves source mapping without duplication
    const mig1 = volumeService.migrateLegacyAutoTradeBot(
      {
        id: 'legacy_BTC/IDR',
        targetPair: 'BTC/IDR',
        targetVolume: 0.25,
        minOrderSize: 0.005,
        maxOrderSize: 0.02,
        intervalSeconds: 4,
        executionMode: 'buy_first',
        autoStopOnTarget: true,
      },
      adminActor
    );
    const mig2 = volumeService.migrateLegacyAutoTradeBot(
      {
        id: 'legacy_BTC/IDR',
        targetPair: 'BTC/IDR',
        targetVolume: 0.25,
        minOrderSize: 0.005,
        maxOrderSize: 0.02,
        intervalSeconds: 4,
        executionMode: 'buy_first',
      },
      adminActor
    );
    expect(mig1.id).toBe(mig2.id);
    expect(mig1.migratedFromLegacyId).toBe('legacy_BTC/IDR');

    authService.register('mm.jwt.test@silentsmile.io', 'SecurePass123!', 'admin');
    const loginRes = await authService.login('mm.jwt.test@silentsmile.io', 'SecurePass123!', '127.0.0.1', 'Vitest');
    expect(loginRes.accessToken).toBeTruthy();
    const verified = authService.verifyAccessToken(loginRes.accessToken!);
    expect(verified.email).toBe('mm.jwt.test@silentsmile.io');
    expect(verified.role).toBe('admin');
  });

  it('19. TWAP, VWAP, and ICEBERG strategies slice orders accurately and enforce clip waiting', async () => {
    const engine = engineManager.getEngine('BTC/IDR');
    await engine.submitOrder({
      userId: counterActorId,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000,
    });

    const twap = volumeService.createBot(
      baseConfig({
        strategy: 'TWAP',
        executionMode: 'SIMULATION',
        twapDurationMs: 10000,
        minIntervalMs: 2000,
        maxIntervalMs: 2000,
        targetVolume: '0.05000000',
        minSliceSize: '0.00500000',
        maxSliceSize: '0.02000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(twap.id, mmActor);
    const twapAfter = await volumeService.executeBotCycle(twap.id);
    expect(twapAfter.metrics.executedQtyAtomic).toBe('1000000');

    const vwap = volumeService.createBot(
      baseConfig({
        strategy: 'VWAP',
        executionMode: 'SIMULATION',
        vwapLookbackMinutes: 30,
        targetVolume: '0.05000000',
        minSliceSize: '0.00500000',
        maxSliceSize: '0.02000000',
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(vwap.id, mmActor);
    const vwapAfter = await volumeService.executeBotCycle(vwap.id);
    expect(BigInt(vwapAfter.metrics.executedQtyAtomic)).toBeGreaterThan(0n);

    const iceberg = volumeService.createBot(
      baseConfig({
        strategy: 'ICEBERG',
        executionMode: 'LIVE',
        icebergVisibleRatioPct: 20,
        targetVolume: '0.05000000',
        minSliceSize: '0.00500000',
        maxSliceSize: '0.02000000',
        maxSlippageBps: 500,
        minIntervalMs: 100,
        maxIntervalMs: 100,
      }),
      mmActor,
      { deploy: true }
    );
    await volumeService.startBot(iceberg.id, mmActor);
    const ice1 = await volumeService.executeBotCycle(iceberg.id, 1_700_000_000_000);
    expect(ice1.metrics.executedQtyAtomic).toBe('1000000');
  });
});
