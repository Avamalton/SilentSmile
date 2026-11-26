import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { LedgerService } from '../src/server/ledger/ledgerService';
import { MatchingEngine, MarketPairConfig } from '../src/server/engine/matchingEngine';

describe('Matching Engine with Price-Time Priority & STP', () => {
  let dbMgr: DatabaseManager;
  let ledger: LedgerService;
  let engine: MatchingEngine;

  const btcPairConfig: MarketPairConfig = {
    id: 'BTC/IDR',
    baseAsset: 'BTC',
    quoteAsset: 'IDR',
    basePrecision: 8,
    quotePrecision: 0,
    minOrderSize: 10000, // 0.0001 BTC
    makerFeeBps: 10,     // 0.10%
    takerFeeBps: 15,     // 0.15%
    isActive: 1,
    tradingStatus: 'OPEN',
  };

  beforeEach(async () => {
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    ledger = new LedgerService(dbMgr);
    engine = new MatchingEngine(btcPairConfig, dbMgr, ledger);
  });

  it('maintains strict price-time priority in order book', async () => {
    // Deposit funds for sellers
    ledger.deposit('usr_seller1', 'BTC', 100000000, 'dep_s1');
    ledger.deposit('usr_seller2', 'BTC', 100000000, 'dep_s2');
    ledger.deposit('usr_seller3', 'BTC', 100000000, 'dep_s3');

    // Place 3 sell limit orders:
    // S1 at 1,500,000,000 IDR (t1)
    // S2 at 1,480,000,000 IDR (t2 - better price!)
    // S3 at 1,480,000,000 IDR (t3 - same price as S2, but later timestamp)
    await engine.submitOrder({
      userId: 'usr_seller1',
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1500000000,
      amount: 10000000, // 0.1 BTC
    });

    await engine.submitOrder({
      userId: 'usr_seller2',
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1480000000,
      amount: 10000000, // 0.1 BTC
    });

    await engine.submitOrder({
      userId: 'usr_seller3',
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1480000000,
      amount: 10000000, // 0.1 BTC
    });

    // Check ask book ordering
    expect(engine.book.asks.length).toBe(3);
    // Best ask should be S2 (1,480,000,000, earlier timestamp)
    expect(engine.book.asks[0].userId).toBe('usr_seller2');
    expect(engine.book.asks[0].price).toBe(1480000000);
    // Second should be S3 (1,480,000,000, later timestamp)
    expect(engine.book.asks[1].userId).toBe('usr_seller3');
    // Third should be S1 (1,500,000,000)
    expect(engine.book.asks[2].userId).toBe('usr_seller1');
  });

  it('executes partial fills and completes orders across multiple price levels', async () => {
    // Seller 1 sells 0.05 BTC at 1,400,000,000 IDR
    ledger.deposit('usr_seller1', 'BTC', 5000000, 'dep_s1_part');
    await engine.submitOrder({
      userId: 'usr_seller1',
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1400000000,
      amount: 5000000,
    });

    // Seller 2 sells 0.05 BTC at 1,420,000,000 IDR
    ledger.deposit('usr_seller2', 'BTC', 5000000, 'dep_s2_part');
    await engine.submitOrder({
      userId: 'usr_seller2',
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1420000000,
      amount: 5000000,
    });

    // Buyer places limit order to buy 0.08 BTC at up to 1,420,000,000 IDR
    // Total cost locked: (1,420,000,000 * 8,000,000) / 10^8 = 113,600,000 IDR
    ledger.deposit('usr_buyer', 'IDR', 200000000, 'dep_buyer_sweep');

    const result = await engine.submitOrder({
      userId: 'usr_buyer',
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1420000000,
      amount: 8000000, // 0.08 BTC
    });

    // Expect 2 fills:
    // Fill 1: 0.05 BTC from S1 @ 1,400,000,000 IDR
    // Fill 2: 0.03 BTC from S2 @ 1,420,000,000 IDR
    expect(result.fills.length).toBe(2);
    expect(result.fills[0].amount).toBe(5000000);
    expect(result.fills[0].price).toBe(1400000000);
    expect(result.fills[1].amount).toBe(3000000);
    expect(result.fills[1].price).toBe(1420000000);
    expect(result.status).toBe('FILLED');

    // S2 should have 0.02 BTC remaining in ask book
    expect(engine.book.asks.length).toBe(1);
    expect(engine.book.asks[0].remainingAmount).toBe(2000000);

    // Verify ledger integrity
    const audit = ledger.verifyLedgerIntegrity();
    expect(audit.isValid).toBe(true);
  });

  it('enforces Self-Trade Prevention (STP) to prevent wash trading', async () => {
    // User Alice places sell order
    ledger.deposit('usr_alice', 'BTC', 10000000, 'dep_stp_btc');
    ledger.deposit('usr_alice', 'IDR', 200000000, 'dep_stp_idr');

    await engine.submitOrder({
      userId: 'usr_alice',
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1400000000,
      amount: 10000000,
    });

    expect(engine.book.asks.length).toBe(1);

    // Alice now attempts to buy her own resting order
    const res = await engine.submitOrder({
      userId: 'usr_alice',
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1400000000,
      amount: 5000000,
    });

    // STP should have cancelled the resting maker order to prevent self-trade
    expect(res.fills.length).toBe(0);
    // Resting order removed
    expect(engine.book.asks.length).toBe(0);

    // Verify ledger integrity after STP
    const audit = ledger.verifyLedgerIntegrity();
    expect(audit.isValid).toBe(true);
  });

  it('persists event sourcing logs for deterministic replay and recovery', async () => {
    ledger.deposit('usr_rec_seller', 'BTC', 20000000, 'dep_rec');
    await engine.submitOrder({
      userId: 'usr_rec_seller',
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1450000000,
      amount: 10000000,
    });

    // Check events table in DB
    const events = dbMgr.query('SELECT * FROM engine_events WHERE pair_id = ?', ['BTC/IDR']);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event_type).toBe('ORDER_ACCEPTED');

    // Simulate crash and restart: create fresh engine instance
    const recoveredEngine = new MatchingEngine(btcPairConfig, dbMgr, ledger);
    await recoveredEngine.recover();

    // Recovered engine should have reconstructed the order book
    expect(recoveredEngine.book.asks.length).toBe(1);
    expect(recoveredEngine.book.asks[0].price).toBe(1450000000);
    expect(recoveredEngine.book.asks[0].remainingAmount).toBe(10000000);
  });
});
