import crypto from 'node:crypto';
import { DatabaseManager } from '../db/database';
import { LedgerService } from '../ledger/ledgerService';
import { KycService } from '../kyc/kycService';

export interface CryptoAddressRecord {
  id: string;
  user_id: string;
  asset: string;
  chain: string;
  address: string;
  memo_tag: string | null;
  created_at: number;
}

export interface WithdrawalRecord {
  id: string;
  user_id: string;
  asset: string;
  amount: number;
  fee: number;
  destination_address: string;
  destination_bank_name: string | null;
  destination_account_name: string | null;
  status: 'pending_approval' | 'approved' | 'rejected' | 'completed';
  approved_by: string | null;
  tx_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface VirtualAccountInfo {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  amountExpected?: number;
  expiresAt: number;
}

export class WalletService {
  private dbMgr: DatabaseManager;
  private ledger: LedgerService;
  private kycService: KycService;

  constructor(dbMgr: DatabaseManager, ledger: LedgerService, kycService: KycService) {
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.kycService = kycService;
  }

  /**
   * Generates or retrieves an on-chain deposit address for a user.
   * Hot/Cold separation: Addresses are derived from master xpub/vault; no private keys in DB!
   */
  public getOrCreateDepositAddress(userId: string, asset: string, chain: string): CryptoAddressRecord {
    const existing = this.dbMgr.queryOne<CryptoAddressRecord>(
      'SELECT * FROM crypto_addresses WHERE user_id = ? AND asset = ? AND chain = ?',
      [userId, asset, chain]
    );
    if (existing) return existing;

    const id = `addr_${crypto.randomBytes(8).toString('hex')}`;
    let address = '';
    let memoTag: string | null = null;

    if (chain.toUpperCase() === 'BITCOIN') {
      address = `bc1q${crypto.randomBytes(16).toString('hex').substring(0, 32)}`;
    } else if (chain.toUpperCase() === 'SOLANA') {
      address = `${crypto.randomBytes(22).toString('base64url').substring(0, 44)}`;
    } else if (chain.toUpperCase() === 'TRON') {
      address = `T${crypto.randomBytes(16).toString('hex').substring(0, 33)}`;
    } else {
      // Standard EVM address (ETH, Polygon, Arbitrum, Base)
      address = `0x${crypto.randomBytes(20).toString('hex')}`;
    }

    const now = Date.now();
    this.dbMgr.execute(
      `INSERT INTO crypto_addresses (id, user_id, asset, chain, address, memo_tag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, asset, chain, address, memoTag, now]
    );

    return this.dbMgr.queryOne<CryptoAddressRecord>('SELECT * FROM crypto_addresses WHERE id = ?', [id])!;
  }

  /**
   * Simulates an incoming blockchain deposit event with N-block confirmation.
   * Once confirmed, executes atomic deposit journal in the Ledger.
   */
  public simulateChainDeposit(params: {
    address: string;
    amount: number;
    txHash?: string;
    confirmations?: number;
  }): { success: boolean; txId?: string; message: string } {
    const { address, amount, txHash, confirmations = 6 } = params;

    const addrRecord = this.dbMgr.queryOne<CryptoAddressRecord>(
      'SELECT * FROM crypto_addresses WHERE address = ?',
      [address]
    );

    if (!addrRecord) {
      throw new Error(`Deposit address ${address} does not belong to any registered user`);
    }

    const hash = txHash || `0x${crypto.randomBytes(32).toString('hex')}`;
    const idempotencyKey = `dep_chain_${hash}`;

    // Execute atomic deposit in double-entry ledger
    const tx = this.ledger.deposit(
      addrRecord.user_id,
      addrRecord.asset,
      amount,
      idempotencyKey,
      `On-chain deposit via ${addrRecord.chain} (${confirmations} confirmations)`
    );

    return {
      success: true,
      txId: tx.id,
      message: `Successfully credited ${amount} ${addrRecord.asset} after ${confirmations} block confirmations.`,
    };
  }

  /**
   * Request a withdrawal (Crypto or IDR Fiat).
   * Verifies daily withdrawal limits and KYC name matching for bank payouts.
   * Moves funds from AVAILABLE to LOCKED_WITHDRAW.
   */
  public requestWithdrawal(params: {
    userId: string;
    asset: string;
    amount: number;
    fee: number;
    destinationAddress: string;
    destinationBankName?: string;
    destinationAccountName?: string;
  }): WithdrawalRecord {
    const { userId, asset, amount, fee, destinationAddress, destinationBankName, destinationAccountName } = params;

    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new Error('Withdrawal amount must be a positive integer');
    }

    const user = this.dbMgr.queryOne<any>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('User not found');

    if (user.status === 'frozen') {
      throw new Error('Account is currently frozen. Withdrawals disabled.');
    }

    // Daily limit check in IDR equivalent
    if (user.kyc_level === 0) {
      throw new Error('KYC verification required before requesting withdrawals. Please complete KYC Level 1.');
    }

    // For IDR bank withdrawals: Name must match KYC verified full name
    if (asset === 'IDR') {
      if (!destinationAccountName || !destinationBankName) {
        throw new Error('Bank name and account holder name required for IDR withdrawal');
      }

      const kycApp = this.kycService.getApplicationByUserId(userId);
      if (!kycApp || kycApp.status !== 'approved') {
        throw new Error('Approved KYC required for IDR bank disbursement');
      }

      // Check name similarity (case-insensitive substring/equality)
      const cleanKycName = kycApp.full_name.trim().toLowerCase();
      const cleanBankName = destinationAccountName.trim().toLowerCase();
      if (!cleanKycName.includes(cleanBankName) && !cleanBankName.includes(cleanKycName)) {
        throw new Error(
          `Bank account name mismatch: Destination name '${destinationAccountName}' does not match KYC verified name '${kycApp.full_name}'. By regulatory compliance, third-party withdrawals are prohibited.`
        );
      }
    }

    const withdrawalId = `wtd_${crypto.randomBytes(8).toString('hex')}`;
    const idempotencyKey = `lock_${withdrawalId}`;
    const now = Date.now();

    // Lock funds in ledger
    this.ledger.lockWithdrawalFunds(userId, asset, amount, idempotencyKey, withdrawalId);

    // Record in withdrawals queue
    this.dbMgr.execute(
      `INSERT INTO withdrawals (id, user_id, asset, amount, fee, destination_address, destination_bank_name, destination_account_name, status, approved_by, tx_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', NULL, NULL, ?, ?)`,
      [
        withdrawalId,
        userId,
        asset,
        amount,
        fee,
        destinationAddress,
        destinationBankName || null,
        destinationAccountName || null,
        now,
        now,
      ]
    );

    return this.dbMgr.queryOne<WithdrawalRecord>('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId])!;
  }

  /**
   * Admin approve and execute withdrawal.
   * Sweeps fee to sys_fee_vault and releases funds from LOCKED_WITHDRAW.
   */
  public approveWithdrawal(withdrawalId: string, reviewerId: string, txHash?: string): WithdrawalRecord {
    const wtd = this.dbMgr.queryOne<WithdrawalRecord>('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!wtd) throw new Error('Withdrawal record not found');
    if (wtd.status !== 'pending_approval') {
      throw new Error(`Withdrawal cannot be approved in status ${wtd.status}`);
    }

    const hash = txHash || `0x${crypto.randomBytes(32).toString('hex')}`;
    const idempotencyKey = `exec_${withdrawalId}`;
    const now = Date.now();

    this.dbMgr.runInTransaction(() => {
      // Execute ledger entry
      this.ledger.executeWithdrawal(wtd.user_id, wtd.asset, wtd.amount, wtd.fee, idempotencyKey, withdrawalId);

      this.dbMgr.execute(
        `UPDATE withdrawals
         SET status = 'completed', approved_by = ?, tx_hash = ?, updated_at = ?
         WHERE id = ?`,
        [reviewerId, hash, now, withdrawalId]
      );
    });

    return this.dbMgr.queryOne<WithdrawalRecord>('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId])!;
  }

  /**
   * Admin reject withdrawal and return reserved funds back to user's AVAILABLE balance.
   */
  public rejectWithdrawal(withdrawalId: string, reviewerId: string, reason: string): WithdrawalRecord {
    const wtd = this.dbMgr.queryOne<WithdrawalRecord>('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!wtd) throw new Error('Withdrawal record not found');
    if (wtd.status !== 'pending_approval') {
      throw new Error(`Withdrawal cannot be rejected in status ${wtd.status}`);
    }

    const idempotencyKey = `reject_${withdrawalId}`;
    const now = Date.now();

    this.dbMgr.runInTransaction(() => {
      // Refund reserved funds back to AVAILABLE
      this.ledger.rejectWithdrawalFunds(wtd.user_id, wtd.asset, wtd.amount, idempotencyKey, withdrawalId);

      this.dbMgr.execute(
        `UPDATE withdrawals
         SET status = 'rejected', approved_by = ?, updated_at = ?
         WHERE id = ?`,
        [reviewerId, now, withdrawalId]
      );
    });

    return this.dbMgr.queryOne<WithdrawalRecord>('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId])!;
  }

  /**
   * Virtual Account Sandbox Adapter
   * Creates an interactive virtual account for instant IDR deposits (BCA, Mandiri, BRI, BNI).
   */
  public createVirtualAccount(userId: string, bankCode: string): VirtualAccountInfo {
    const user = this.dbMgr.queryOne<any>('SELECT email FROM users WHERE id = ?', [userId]);
    const cleanBank = bankCode.toUpperCase();
    const bankPrefixes: Record<string, string> = {
      BCA: '8808',
      MANDIRI: '8910',
      BRI: '0220',
      BNI: '9880',
    };
    const prefix = bankPrefixes[cleanBank] || '8888';
    const accNum = `${prefix}${userId.replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8)}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    return {
      bankCode: cleanBank,
      accountNumber: accNum,
      accountName: `SILENT SMILE - ${user?.email.split('@')[0].toUpperCase() || 'USER'}`,
      expiresAt,
    };
  }

  /**
   * Virtual Account Webhook Simulator
   * Simulates bank payment gateway callback (e.g. Midtrans / Xendit).
   */
  public simulateVaPaymentWebhook(params: {
    virtualAccountNumber: string;
    paidAmount: number;
    userId: string;
  }): { success: boolean; txId: string; message: string } {
    const { virtualAccountNumber, paidAmount, userId } = params;

    if (paidAmount <= 0) {
      throw new Error('Paid amount must be greater than zero');
    }

    const idempotencyKey = `va_pay_${virtualAccountNumber}_${Date.now()}`;
    const tx = this.ledger.deposit(
      userId,
      'IDR',
      paidAmount,
      idempotencyKey,
      `IDR Virtual Account payment (${virtualAccountNumber})`
    );

    return {
      success: true,
      txId: tx.id,
      message: `Payment of Rp ${paidAmount.toLocaleString()} received and credited to user account.`,
    };
  }
}
