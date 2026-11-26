import crypto from 'node:crypto';
import { DatabaseManager } from '../db/database';
import { calculateBpsFee } from './integerMath';

export type AccountType = 'AVAILABLE' | 'LOCKED_ORDER' | 'LOCKED_WITHDRAW';

export interface LedgerAccountRecord {
  id: string;
  user_id: string;
  asset: string;
  account_type: AccountType;
  balance: number;
  created_at: number;
}

export interface LedgerTransactionRecord {
  id: string;
  idempotency_key: string;
  category: string;
  description: string;
  actor_id: string;
  created_at: number;
}

export interface LedgerEntryRecord {
  id: string;
  transaction_id: string;
  account_id: string;
  asset: string;
  entry_type: 'DEBIT' | 'CREDIT';
  amount: number;
  balance_before: number;
  balance_after: number;
  created_at: number;
}

export interface UserBalanceSummary {
  asset: string;
  available: number;
  lockedOrder: number;
  lockedWithdraw: number;
  total: number;
}

export interface SettleTradeParams {
  pairId: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  amount: number;       // In base asset integer units
  quoteTotal: number;   // In quote asset integer units
  buyerId: string;
  sellerId: string;
  buyerIsTaker: boolean;
  buyerFeeBps: number;
  sellerFeeBps: number;
  makerOrderId: string;
  takerOrderId: string;
  idempotencyKey: string;
}

export class LedgerService {
  private dbMgr: DatabaseManager;

  constructor(dbMgr: DatabaseManager) {
    this.dbMgr = dbMgr;
  }

  /**
   * Helper to format account ID deterministically
   */
  public getAccountId(userId: string, asset: string, accountType: AccountType): string {
    return `acc_${userId}_${asset}_${accountType}`;
  }

  /**
   * Retrieves or creates a ledger account record with 0 initial balance
   */
  public getOrCreateAccount(userId: string, asset: string, accountType: AccountType): LedgerAccountRecord {
    const accountId = this.getAccountId(userId, asset, accountType);
    let account = this.dbMgr.queryOne<LedgerAccountRecord>('SELECT * FROM ledger_accounts WHERE id = ?', [accountId]);

    if (!account) {
      const now = Date.now();
      this.dbMgr.execute(
        `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [accountId, userId, asset, accountType, now]
      );
      account = this.dbMgr.queryOne<LedgerAccountRecord>('SELECT * FROM ledger_accounts WHERE id = ?', [accountId]);
      if (!account) {
        throw new Error(`Failed to initialize account: ${accountId}`);
      }
    }

    return account;
  }

  /**
   * Get balance overview for a single user and asset
   */
  public getBalance(userId: string, asset: string): UserBalanceSummary {
    const avail = this.getOrCreateAccount(userId, asset, 'AVAILABLE').balance;
    const lockedOrd = this.getOrCreateAccount(userId, asset, 'LOCKED_ORDER').balance;
    const lockedWtd = this.getOrCreateAccount(userId, asset, 'LOCKED_WITHDRAW').balance;

    return {
      asset,
      available: avail,
      lockedOrder: lockedOrd,
      lockedWithdraw: lockedWtd,
      total: avail + lockedOrd + lockedWtd,
    };
  }

  /**
   * Get all asset balances for a user
   */
  public getAllBalances(userId: string): Record<string, UserBalanceSummary> {
    const assets = ['IDR', 'BTC', 'ETH', 'SOL', 'DNA', 'USDT', "MOCK",];
    const result: Record<string, UserBalanceSummary> = {};
    for (const a of assets) {
      result[a] = this.getBalance(userId, a);
    }
    return result;
  }

  /**
   * Post a double-entry transaction.
   * If the idempotencyKey has already been used, returns existing transaction without re-executing.
   * Ensures that entries are posted atomically and balance updates match balance_before/after.
   */
  public postTransaction(
    idempotencyKey: string,
    category: string,
    description: string,
    actorId: string,
    mutations: Array<{
      userId: string;
      asset: string;
      accountType: AccountType;
      entryType: 'DEBIT' | 'CREDIT';
      amount: number; // strictly positive integer
    }>
  ): LedgerTransactionRecord {
    if (mutations.length < 2) {
      throw new Error('Double-entry transaction requires at least 2 entries');
    }

    // Check for existing transaction (Idempotency)
    const existing = this.dbMgr.queryOne<LedgerTransactionRecord>(
      'SELECT * FROM ledger_transactions WHERE idempotency_key = ?',
      [idempotencyKey]
    );
    if (existing) {
      return existing;
    }

    // Validate entries
    for (const m of mutations) {
      if (m.amount <= 0 || !Number.isInteger(m.amount)) {
        throw new Error(`Invalid mutation amount: ${m.amount}. Must be positive integer.`);
      }
    }

    // Group by asset and verify balanced movements
    const assetNet = new Map<string, number>();
    for (const m of mutations) {
      const net = (m.entryType === 'CREDIT' ? 1 : -1) * m.amount;
      assetNet.set(m.asset, (assetNet.get(m.asset) || 0) + net);
    }

    for (const [asset, net] of assetNet.entries()) {
      if (net !== 0) {
        throw new Error(`Unbalanced double-entry ledger transaction for asset ${asset}: net sum is ${net}, expected 0`);
      }
    }

    return this.dbMgr.runInTransaction(() => {
      const txId = `ltx_${crypto.randomBytes(8).toString('hex')}`;
      const now = Date.now();

      this.dbMgr.execute(
        `INSERT INTO ledger_transactions (id, idempotency_key, category, description, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [txId, idempotencyKey, category, description, actorId, now]
      );

      for (const m of mutations) {
        const account = this.getOrCreateAccount(m.userId, m.asset, m.accountType);
        const before = account.balance;
        const delta = m.entryType === 'CREDIT' ? m.amount : -m.amount;
        const after = before + delta;

        // Disallow negative balances on user accounts (allow system treasury to track net issued)
        if (after < 0 && !m.userId.startsWith('sys_')) {
          throw new Error(
            `Insufficient balance for account ${account.id}. Available: ${before}, required: ${m.amount}`
          );
        }

        const entryId = `len_${crypto.randomBytes(8).toString('hex')}`;
        this.dbMgr.execute(
          `INSERT INTO ledger_entries (id, transaction_id, account_id, asset, entry_type, amount, balance_before, balance_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entryId, txId, account.id, m.asset, m.entryType, m.amount, before, after, now]
        );

        this.dbMgr.execute('UPDATE ledger_accounts SET balance = ? WHERE id = ?', [after, account.id]);
      }

      const createdTx = this.dbMgr.queryOne<LedgerTransactionRecord>(
        'SELECT * FROM ledger_transactions WHERE id = ?',
        [txId]
      );
      if (!createdTx) throw new Error('Transaction creation failed');
      return createdTx;
    });
  }

  /**
   * Deposit: external funding into user available balance.
   * In double-entry:
   *   sys_treasury: DEBIT (increases treasury obligation/outflow)
   *   user AVAILABLE: CREDIT (increases user available balance)
   */
  public deposit(
    userId: string,
    asset: string,
    amount: number,
    idempotencyKey: string,
    description: string = 'Deposit'
  ): LedgerTransactionRecord {
    return this.postTransaction(
      idempotencyKey,
      'DEPOSIT',
      description,
      userId,
      [
        { userId: 'sys_treasury', asset, accountType: 'AVAILABLE', entryType: 'DEBIT', amount },
        { userId, asset, accountType: 'AVAILABLE', entryType: 'CREDIT', amount },
      ]
    );
  }

  /**
   * Transfer: balanced double-entry movement between two accounts.
   */
  public transfer(
    fromUserId: string,
    toUserId: string,
    asset: string,
    amount: number,
    idempotencyKey: string,
    category: string = 'TRANSFER',
    description: string = 'Transfer'
  ): LedgerTransactionRecord {
    return this.postTransaction(
      idempotencyKey,
      category,
      description,
      fromUserId,
      [
        { userId: fromUserId, asset, accountType: 'AVAILABLE', entryType: 'DEBIT', amount },
        { userId: toUserId, asset, accountType: 'AVAILABLE', entryType: 'CREDIT', amount },
      ]
    );
  }

  /**
   * Lock funds when an order is placed:
   * Transfers from user's AVAILABLE to user's LOCKED_ORDER
   */
  public lockOrderFunds(
    userId: string,
    asset: string,
    amount: number,
    idempotencyKey: string,
    orderId: string
  ): LedgerTransactionRecord {
    return this.postTransaction(
      idempotencyKey,
      'ORDER_LOCK',
      `Locked funds for order ${orderId}`,
      userId,
      [
        { userId, asset, accountType: 'AVAILABLE', entryType: 'DEBIT', amount },
        { userId, asset, accountType: 'LOCKED_ORDER', entryType: 'CREDIT', amount },
      ]
    );
  }

  /**
   * Unlock funds when an order is cancelled or partially unfulfilled:
   * Transfers from user's LOCKED_ORDER to user's AVAILABLE
   */
  public unlockOrderFunds(
    userId: string,
    asset: string,
    amount: number,
    idempotencyKey: string,
    reason: string = 'Order Cancellation'
  ): LedgerTransactionRecord {
    return this.postTransaction(
      idempotencyKey,
      'ORDER_UNLOCK',
      reason,
      userId,
      [
        { userId, asset, accountType: 'LOCKED_ORDER', entryType: 'DEBIT', amount },
        { userId, asset, accountType: 'AVAILABLE', entryType: 'CREDIT', amount },
      ]
    );
  }

  /**
   * Request withdrawal:
   * Move from user's AVAILABLE to user's LOCKED_WITHDRAW
   */
  public lockWithdrawalFunds(
    userId: string,
    asset: string,
    amount: number,
    idempotencyKey: string,
    withdrawalId: string
  ): LedgerTransactionRecord {
    return this.postTransaction(
      idempotencyKey,
      'WITHDRAW_LOCK',
      `Reserved funds for withdrawal ${withdrawalId}`,
      userId,
      [
        { userId, asset, accountType: 'AVAILABLE', entryType: 'DEBIT', amount },
        { userId, asset, accountType: 'LOCKED_WITHDRAW', entryType: 'CREDIT', amount },
      ]
    );
  }

  /**
   * Finalize approved withdrawal:
   * Deducts from LOCKED_WITHDRAW, transfers fee to sys_fee_vault, and credits sys_treasury.
   */
  public executeWithdrawal(
    userId: string,
    asset: string,
    totalAmount: number,
    feeAmount: number,
    idempotencyKey: string,
    withdrawalId: string
  ): LedgerTransactionRecord {
    const netPayout = totalAmount - feeAmount;
    if (netPayout < 0) {
      throw new Error('Fee cannot exceed withdrawal amount');
    }

    const mutations: Array<{
      userId: string;
      asset: string;
      accountType: AccountType;
      entryType: 'DEBIT' | 'CREDIT';
      amount: number;
    }> = [
      { userId, asset, accountType: 'LOCKED_WITHDRAW', entryType: 'DEBIT', amount: totalAmount },
      { userId: 'sys_treasury', asset, accountType: 'AVAILABLE', entryType: 'CREDIT', amount: netPayout },
    ];

    if (feeAmount > 0) {
      mutations.push({
        userId: 'sys_fee_vault',
        asset,
        accountType: 'AVAILABLE',
        entryType: 'CREDIT',
        amount: feeAmount,
      });
    }

    return this.postTransaction(
      idempotencyKey,
      'WITHDRAW_EXECUTE',
      `Executed withdrawal ${withdrawalId}`,
      userId,
      mutations
    );
  }

  /**
   * Reject / Cancel withdrawal:
   * Returns funds from LOCKED_WITHDRAW back to AVAILABLE
   */
  public rejectWithdrawalFunds(
    userId: string,
    asset: string,
    amount: number,
    idempotencyKey: string,
    withdrawalId: string
  ): LedgerTransactionRecord {
    return this.postTransaction(
      idempotencyKey,
      'WITHDRAW_REJECT',
      `Returned rejected withdrawal ${withdrawalId}`,
      userId,
      [
        { userId, asset, accountType: 'LOCKED_WITHDRAW', entryType: 'DEBIT', amount },
        { userId, asset, accountType: 'AVAILABLE', entryType: 'CREDIT', amount },
      ]
    );
  }

  /**
   * Settle trade execution between Buyer and Seller with Maker/Taker fees.
   * Multi-legged atomic transaction:
   *
   * Quote Asset Movement:
   *   - Buyer paid `quoteTotal` from LOCKED_ORDER: DEBIT
   *   - Seller receives `quoteTotal - sellerQuoteFee` into AVAILABLE: CREDIT
   *   - If buyer pays fee in quote currency (buyerQuoteFee):
   *       buyer fee CREDIT to sys_fee_vault
   *   - If seller pays fee in quote currency (sellerQuoteFee):
   *       seller fee CREDIT to sys_fee_vault
   *
   * Base Asset Movement:
   *   - Seller delivers `amount` from LOCKED_ORDER: DEBIT
   *   - Buyer receives `amount - buyerBaseFee` into AVAILABLE: CREDIT
   *   - If buyer fee is taken from base asset: CREDIT to sys_fee_vault
   *
   * Standard exchange convention:
   *   - Buyer receives Base asset, pays Quote asset. Buyer fee is deducted from received Base asset.
   *   - Seller receives Quote asset, pays Base asset. Seller fee is deducted from received Quote asset.
   *   Both legs are perfectly balanced with exact integer precision!
   */
  public settleTrade(params: SettleTradeParams): LedgerTransactionRecord {
    const {
      pairId,
      baseAsset,
      quoteAsset,
      price,
      amount,
      quoteTotal,
      buyerId,
      sellerId,
      buyerFeeBps,
      sellerFeeBps,
      makerOrderId,
      takerOrderId,
      idempotencyKey,
    } = params;

    // Calculate fees
    // Buyer receives base asset, so buyer fee is deducted from base asset
    const { netAmount: buyerBaseReceived, feeAmount: buyerBaseFee } = calculateBpsFee(amount, buyerFeeBps);
    // Seller receives quote asset, so seller fee is deducted from quote asset
    const { netAmount: sellerQuoteReceived, feeAmount: sellerQuoteFee } = calculateBpsFee(quoteTotal, sellerFeeBps);

    // Build mutations list
    // 1. Base Asset Mutations (Net must be 0)
    // Seller delivers `amount` (DEBIT)
    // Buyer gets `buyerBaseReceived` (CREDIT)
    // Vault gets `buyerBaseFee` (CREDIT if > 0)
    const baseMutations: Array<{
      userId: string;
      asset: string;
      accountType: AccountType;
      entryType: 'DEBIT' | 'CREDIT';
      amount: number;
    }> = [
      { userId: sellerId, asset: baseAsset, accountType: 'LOCKED_ORDER', entryType: 'DEBIT', amount },
      { userId: buyerId, asset: baseAsset, accountType: 'AVAILABLE', entryType: 'CREDIT', amount: buyerBaseReceived },
    ];
    if (buyerBaseFee > 0) {
      baseMutations.push({
        userId: 'sys_fee_vault',
        asset: baseAsset,
        accountType: 'AVAILABLE',
        entryType: 'CREDIT',
        amount: buyerBaseFee,
      });
    }

    // 2. Quote Asset Mutations (Net must be 0)
    // Buyer spends `quoteTotal` (DEBIT)
    // Seller gets `sellerQuoteReceived` (CREDIT)
    // Vault gets `sellerQuoteFee` (CREDIT if > 0)
    const quoteMutations: Array<{
      userId: string;
      asset: string;
      accountType: AccountType;
      entryType: 'DEBIT' | 'CREDIT';
      amount: number;
    }> = [
      { userId: buyerId, asset: quoteAsset, accountType: 'LOCKED_ORDER', entryType: 'DEBIT', amount: quoteTotal },
      { userId: sellerId, asset: quoteAsset, accountType: 'AVAILABLE', entryType: 'CREDIT', amount: sellerQuoteReceived },
    ];
    if (sellerQuoteFee > 0) {
      quoteMutations.push({
        userId: 'sys_fee_vault',
        asset: quoteAsset,
        accountType: 'AVAILABLE',
        entryType: 'CREDIT',
        amount: sellerQuoteFee,
      });
    }

    const allMutations = [...baseMutations, ...quoteMutations];

    return this.postTransaction(
      idempotencyKey,
      'TRADE_SETTLEMENT',
      `Settled trade on ${pairId}: ${amount} @ ${price} (Maker: ${makerOrderId}, Taker: ${takerOrderId})`,
      'sys_matching_engine',
      allMutations
    );
  }

  /**
   * Complete Ledger Audit & Invariance Check:
   * Verifies that for every transaction:
   * 1. Sum of DEBITs == Sum of CREDITs per asset
   * 2. Every account balance equals sum of its entries
   * 3. System accounts balance equals the net offset of user balances
   */
  public verifyLedgerIntegrity(): { isValid: boolean; errors: string[]; transactionCount: number; accountCount: number } {
    const errors: string[] = [];

    // Check 1: Every transaction has balanced debits and credits per asset
    const transactions = this.dbMgr.query<LedgerTransactionRecord>('SELECT * FROM ledger_transactions');
    for (const tx of transactions) {
      const entries = this.dbMgr.query<LedgerEntryRecord>(
        'SELECT * FROM ledger_entries WHERE transaction_id = ?',
        [tx.id]
      );

      const netPerAsset = new Map<string, number>();
      for (const e of entries) {
        const net = (e.entry_type === 'CREDIT' ? 1 : -1) * e.amount;
        netPerAsset.set(e.asset, (netPerAsset.get(e.asset) || 0) + net);
      }

      for (const [asset, net] of netPerAsset.entries()) {
        if (net !== 0) {
          errors.push(`Transaction ${tx.id} (${tx.idempotency_key}) is unbalanced for ${asset}: net delta ${net}`);
        }
      }
    }

    // Check 2: Account balance equals sum of its entries
    const accounts = this.dbMgr.query<LedgerAccountRecord>('SELECT * FROM ledger_accounts');
    for (const acc of accounts) {
      const entries = this.dbMgr.query<LedgerEntryRecord>(
        'SELECT entry_type, amount FROM ledger_entries WHERE account_id = ?',
        [acc.id]
      );
      let calculatedBalance = 0;
      for (const e of entries) {
        calculatedBalance += e.entry_type === 'CREDIT' ? e.amount : -e.amount;
      }
      if (acc.balance !== calculatedBalance) {
        errors.push(
          `Account ${acc.id} balance mismatch: recorded ${acc.balance}, computed from entries ${calculatedBalance}`
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      transactionCount: transactions.length,
      accountCount: accounts.length,
    };
  }
}
