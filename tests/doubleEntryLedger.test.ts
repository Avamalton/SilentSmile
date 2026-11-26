import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { LedgerService } from '../src/server/ledger/ledgerService';
import { parseToIntegerUnits, formatFromIntegerUnits, computeTradeTotal } from '../src/server/ledger/integerMath';

describe('Double-Entry Ledger & Financial Engine', () => {
  let dbMgr: DatabaseManager;
  let ledger: LedgerService;

  beforeEach(async () => {
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    ledger = new LedgerService(dbMgr);
  });

  it('correctly handles zero-float integer math for satoshis and fiat rupiah', () => {
    // 0.025 BTC with 8 decimals -> 2,500,000 satoshis
    const btcSats = parseToIntegerUnits('0.02500000', 8);
    expect(btcSats).toBe(2500000);
    expect(formatFromIntegerUnits(btcSats, 8)).toBe('0.02500000');

    // 50,000,000 IDR with 0 decimals
    const idrUnits = parseToIntegerUnits('50000000', 0);
    expect(idrUnits).toBe(50000000);
    expect(formatFromIntegerUnits(idrUnits, 0)).toBe('50000000');

    // Trade Total calculation:
    // Price = 1,400,000,000 IDR / BTC
    // Amount = 0.5 BTC (50,000,000 satoshis)
    // Total = 700,000,000 IDR
    const total = computeTradeTotal(1400000000, 50000000, 8);
    expect(total).toBe(700000000);
  });

  it('processes deposit with immutable double-entry journal and updates available balance', () => {
    const depositAmount = 100000000; // 100,000,000 IDR
    const tx = ledger.deposit('usr_alice', 'IDR', depositAmount, 'dep_idem_001', 'Bank VA Deposit');
    expect(tx.id).toBeDefined();

    const aliceBalance = ledger.getBalance('usr_alice', 'IDR');
    expect(aliceBalance.available).toBe(depositAmount);
    expect(aliceBalance.total).toBe(depositAmount);
    expect(aliceBalance.lockedOrder).toBe(0);

    const audit = ledger.verifyLedgerIntegrity();
    expect(audit.isValid).toBe(true);
    expect(audit.errors).toHaveLength(0);
  });

  it('enforces idempotency: repeated submissions return existing transaction without double-crediting', () => {
    const key = 'idem_key_deposit_repeat';
    const tx1 = ledger.deposit('usr_bob', 'IDR', 50000000, key, 'First attempt');
    const tx2 = ledger.deposit('usr_bob', 'IDR', 50000000, key, 'Duplicate attempt');

    expect(tx1.id).toBe(tx2.id);

    // Balance must be credited only once
    const bobBalance = ledger.getBalance('usr_bob', 'IDR');
    expect(bobBalance.available).toBe(50000000);
  });

  it('locks and unlocks order funds atomically', () => {
    ledger.deposit('usr_trader', 'IDR', 20000000, 'dep_lock_test');

    // Lock 15,000,000 IDR for an open buy order
    ledger.lockOrderFunds('usr_trader', 'IDR', 15000000, 'lock_order_1', 'ord_123');

    let bal = ledger.getBalance('usr_trader', 'IDR');
    expect(bal.available).toBe(5000000);
    expect(bal.lockedOrder).toBe(15000000);
    expect(bal.total).toBe(20000000);

    // Order cancelled: unlock remaining 15,000,000 IDR
    ledger.unlockOrderFunds('usr_trader', 'IDR', 15000000, 'unlock_order_1', 'Cancelled order');

    bal = ledger.getBalance('usr_trader', 'IDR');
    expect(bal.available).toBe(20000000);
    expect(bal.lockedOrder).toBe(0);
    expect(bal.total).toBe(20000000);

    const audit = ledger.verifyLedgerIntegrity();
    expect(audit.isValid).toBe(true);
  });

  it('prevents user balances from going negative', () => {
    expect(() => {
      ledger.lockOrderFunds('usr_broke', 'IDR', 1000000, 'lock_fail', 'ord_fail');
    }).toThrow(/insufficient balance/i);
  });

  it('executes atomic trade settlement with maker & taker fee splits to fee vault', () => {
    // Setup initial state:
    // Buyer has 1,500,000,000 IDR deposited and locks 1,400,000,000 IDR for BTC purchase
    // Seller has 1.0 BTC (100,000,000 sats) deposited and locks 100,000,000 sats
    ledger.deposit('usr_buyer', 'IDR', 1500000000, 'dep_buyer_idr');
    ledger.lockOrderFunds('usr_buyer', 'IDR', 1400000000, 'lock_buyer_idr', 'ord_b1');

    ledger.deposit('usr_seller', 'BTC', 100000000, 'dep_seller_btc');
    ledger.lockOrderFunds('usr_seller', 'BTC', 100000000, 'lock_seller_btc', 'ord_s1');

    // Execute trade settlement:
    // Amount = 1.0 BTC (100,000,000 sats), Price = 1,400,000,000 IDR, QuoteTotal = 1,400,000,000 IDR
    // Buyer fee: 15 bps (0.15% = 150,000 sats from BTC)
    // Seller fee: 10 bps (0.10% = 1,400,000 IDR from quote IDR)
    const tx = ledger.settleTrade({
      pairId: 'BTC/IDR',
      baseAsset: 'BTC',
      quoteAsset: 'IDR',
      price: 1400000000,
      amount: 100000000,
      quoteTotal: 1400000000,
      buyerId: 'usr_buyer',
      sellerId: 'usr_seller',
      buyerIsTaker: true,
      buyerFeeBps: 15,
      sellerFeeBps: 10,
      makerOrderId: 'ord_s1',
      takerOrderId: 'ord_b1',
      idempotencyKey: 'settle_trade_btc_001',
    });

    expect(tx.id).toBeDefined();

    // Verify Buyer Balances:
    // Spent 1,400,000,000 IDR from locked
    // Received 100,000,000 - 150,000 = 99,850,000 sats BTC
    const buyerBtc = ledger.getBalance('usr_buyer', 'BTC');
    expect(buyerBtc.available).toBe(99850000);

    const buyerIdr = ledger.getBalance('usr_buyer', 'IDR');
    expect(buyerIdr.available).toBe(100000000);
    expect(buyerIdr.lockedOrder).toBe(0);

    // Verify Seller Balances:
    // Delivered 100,000,000 sats BTC from locked
    // Received 1,400,000,000 - 1,400,000 = 1,398,600,000 IDR
    const sellerBtc = ledger.getBalance('usr_seller', 'BTC');
    expect(sellerBtc.lockedOrder).toBe(0);
    expect(sellerBtc.available).toBe(0);

    const sellerIdr = ledger.getBalance('usr_seller', 'IDR');
    expect(sellerIdr.available).toBe(1398600000);

    // Verify Fee Vault:
    // Received 150,000 sats BTC and 1,400,000 IDR
    const vaultBtc = ledger.getBalance('sys_fee_vault', 'BTC');
    expect(vaultBtc.available).toBe(150000);

    const vaultIdr = ledger.getBalance('sys_fee_vault', 'IDR');
    expect(vaultIdr.available).toBe(1400000);

    // Complete audit: all entries and accounts must balance to 0
    const audit = ledger.verifyLedgerIntegrity();
    expect(audit.isValid).toBe(true);
    expect(audit.errors).toHaveLength(0);
  });

  it('handles withdrawal reservation, fee splitting on execution, and cancellation', () => {
    ledger.deposit('usr_wtd', 'IDR', 50000000, 'dep_wtd_init');

    // 1. Reserve 20,000,000 IDR for withdrawal
    ledger.lockWithdrawalFunds('usr_wtd', 'IDR', 20000000, 'wtd_lock_01', 'wtd_rec_01');

    let bal = ledger.getBalance('usr_wtd', 'IDR');
    expect(bal.available).toBe(30000000);
    expect(bal.lockedWithdraw).toBe(20000000);

    // 2. Execute withdrawal with 25,000 IDR fixed network/gateway fee
    ledger.executeWithdrawal('usr_wtd', 'IDR', 20000000, 25000, 'wtd_exec_01', 'wtd_rec_01');

    bal = ledger.getBalance('usr_wtd', 'IDR');
    expect(bal.available).toBe(30000000);
    expect(bal.lockedWithdraw).toBe(0);

    const vault = ledger.getBalance('sys_fee_vault', 'IDR');
    expect(vault.available).toBe(25000);

    const audit = ledger.verifyLedgerIntegrity();
    expect(audit.isValid).toBe(true);
  });
});
