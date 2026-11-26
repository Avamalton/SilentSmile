import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { AuthService } from '../src/server/auth/authService';
import { LedgerService } from '../src/server/ledger/ledgerService';
import { MatchingEngine, MarketPairConfig } from '../src/server/engine/matchingEngine';
import { KycService } from '../src/server/kyc/kycService';
import { WalletService } from '../src/server/wallet/walletService';

describe('E2E Lifecycle: Deposit -> Order -> Match -> Settle -> Withdraw', () => {
  let dbMgr: DatabaseManager;
  let authService: AuthService;
  let ledgerService: LedgerService;
  let kycService: KycService;
  let walletService: WalletService;
  let engine: MatchingEngine;

  const pairConfig: MarketPairConfig = {
    id: 'BTC/IDR',
    baseAsset: 'BTC',
    quoteAsset: 'IDR',
    basePrecision: 8,
    quotePrecision: 0,
    minOrderSize: 10000,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: 1,
    tradingStatus: 'OPEN',
  };

  beforeEach(async () => {
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);

    authService = new AuthService(dbMgr);
    ledgerService = new LedgerService(dbMgr);
    kycService = new KycService(dbMgr);
    walletService = new WalletService(dbMgr, ledgerService, kycService);
    engine = new MatchingEngine(pairConfig, dbMgr, ledgerService);
  });

  it('runs complete lifecycle from deposit through trading, matching, settlement, and KYC withdrawal', async () => {
    // 1. Register Alice (Buyer) and Bob (Seller)
    const alice = authService.register('alice@exchange.test', 'PassAlice123!');
    const bob = authService.register('bob@exchange.test', 'PassBob123!');

    // 2. Deposit Funds
    // Alice deposits 1,500,000,000 IDR via Virtual Account
    const vaAlice = walletService.createVirtualAccount(alice.id, 'BCA');
    walletService.simulateVaPaymentWebhook({
      virtualAccountNumber: vaAlice.accountNumber,
      paidAmount: 1500000000,
      userId: alice.id,
    });

    // Bob deposits 1.0 BTC (100,000,000 sats) via on-chain blockchain deposit
    const btcAddressBob = walletService.getOrCreateDepositAddress(bob.id, 'BTC', 'Bitcoin');
    walletService.simulateChainDeposit({
      address: btcAddressBob.address,
      amount: 100000000,
      confirmations: 6,
    });

    expect(ledgerService.getBalance(alice.id, 'IDR').available).toBe(1500000000);
    expect(ledgerService.getBalance(bob.id, 'BTC').available).toBe(100000000);

    // 3. Bob places Sell Limit Order: 0.5 BTC at 1,400,000,000 IDR
    // Locks 50,000,000 sats in Bob's LOCKED_ORDER
    const sellRes = await engine.submitOrder({
      userId: bob.id,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 1400000000,
      amount: 50000000,
    });
    expect(sellRes.status).toBe('NEW');
    expect(ledgerService.getBalance(bob.id, 'BTC').lockedOrder).toBe(50000000);

    // 4. Alice places Buy Limit Order matching Bob's order: 0.5 BTC at 1,400,000,000 IDR
    // Total Quote Cost: (1,400,000,000 * 50,000,000) / 10^8 = 700,000,000 IDR
    const buyRes = await engine.submitOrder({
      userId: alice.id,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 1400000000,
      amount: 50000000,
    });
    expect(buyRes.status).toBe('FILLED');
    expect(buyRes.fills.length).toBe(1);

    // 5. Verify Settlement:
    // Alice receives: 50,000,000 - 15 bps (75,000 sats fee) = 49,925,000 sats BTC
    const aliceBtc = ledgerService.getBalance(alice.id, 'BTC');
    expect(aliceBtc.available).toBe(49925000);

    // Bob receives: 700,000,000 - 10 bps (700,000 IDR fee) = 699,300,000 IDR
    const bobIdr = ledgerService.getBalance(bob.id, 'IDR');
    expect(bobIdr.available).toBe(699300000);

    // Fee vault received: 75,000 sats BTC + 700,000 IDR
    expect(ledgerService.getBalance('sys_fee_vault', 'BTC').available).toBe(75000);
    expect(ledgerService.getBalance('sys_fee_vault', 'IDR').available).toBe(700000);

    // 6. Complete KYC for Bob so Bob can withdraw IDR to his bank account
    const kycApp = kycService.submitApplication({
      userId: bob.id,
      fullName: 'Bob Pratama',
      idNumber: '3171012345678901',
      idCardUrl: 'http://img.ktp.test/bob.jpg',
      selfieUrl: 'http://img.selfie.test/bob.jpg',
    });

    // Admin approves KYC
    kycService.reviewApplication({
      applicationId: kycApp.id,
      reviewerId: 'admin',
      decision: 'approved',
    });

    // 7. Bob initiates IDR Withdrawal to Bank Account
    // Account name must match KYC ('Bob Pratama')
    const withdrawal = walletService.requestWithdrawal({
      userId: bob.id,
      asset: 'IDR',
      amount: 500000000,
      fee: 10000,
      destinationAddress: '1234567890',
      destinationBankName: 'BCA',
      destinationAccountName: 'Bob Pratama',
    });

    expect(withdrawal.status).toBe('pending_approval');
    expect(ledgerService.getBalance(bob.id, 'IDR').lockedWithdraw).toBe(500000000);

    // 8. Admin approves & executes withdrawal
    const completedWtd = walletService.approveWithdrawal(withdrawal.id, 'admin');
    expect(completedWtd.status).toBe('completed');
    expect(ledgerService.getBalance(bob.id, 'IDR').lockedWithdraw).toBe(0);

    // 9. Full double-entry ledger audit verification
    const audit = ledgerService.verifyLedgerIntegrity();
    expect(audit.isValid).toBe(true);
    expect(audit.errors).toHaveLength(0);
  });
});
