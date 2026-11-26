import { UserBalance } from './types';
import { safeRound } from '../utils/formatters';

export interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  asset: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  timestamp: number;
}

export interface LedgerTransaction {
  id: string;
  idempotencyKey: string;
  listingId?: string;
  category: 'TREASURY_MM_ALLOCATION' | 'ORDER_LOCK' | 'ORDER_RELEASE' | 'TRADE_SETTLEMENT' | 'FAUCET';
  sourceAccount: string;
  targetAccount: string;
  asset: string;
  amount: number;
  actorId: string;
  timestamp: number;
  status: 'POSTED' | 'REJECTED';
  rejectionReason?: string;
  entries: LedgerEntry[];
}

export class LedgerService {
  private static processedIdempotencyKeys = new Set<string>();
  private static transactionHistory: LedgerTransaction[] = [];

  static clearHistory() {
    this.processedIdempotencyKeys.clear();
    this.transactionHistory = [];
  }

  static getHistory(): LedgerTransaction[] {
    return [...this.transactionHistory];
  }

  /**
   * Double-Entry Virtual Treasury Allocation to MM
   */
  static allocateTreasuryToMM(params: {
    sourceAccount: string;
    targetMMAccount: string;
    asset: string;
    amount: number;
    listingId: string;
    actorId: string;
    idempotencyKey: string;
    userBalancesMap: Record<string, Record<string, UserBalance>>;
    timestamp?: number;
  }): {
    success: boolean;
    updatedBalancesMap: Record<string, Record<string, UserBalance>>;
    transaction?: LedgerTransaction;
    error?: string;
  } {
    const {
      sourceAccount,
      targetMMAccount,
      asset,
      amount,
      listingId,
      actorId,
      idempotencyKey,
      userBalancesMap,
      timestamp = Date.now(),
    } = params;

    // 1. Idempotency check
    if (this.processedIdempotencyKeys.has(idempotencyKey)) {
      return {
        success: false,
        updatedBalancesMap: userBalancesMap,
        error: `Duplicate transaction detected (idempotency key: ${idempotencyKey}).`,
      };
    }

    // 2. Amount sanity
    if (amount <= 0 || !Number.isFinite(amount)) {
      return {
        success: false,
        updatedBalancesMap: userBalancesMap,
        error: `Invalid allocation amount: ${amount}. Must be a positive finite number.`,
      };
    }

    // 3. Source account balance check
    const sourceUserAssets = userBalancesMap[sourceAccount] || {};
    const sourceBalance = sourceUserAssets[asset] || { asset, free: 0, locked: 0, total: 0 };

    if (sourceBalance.free < amount) {
      return {
        success: false,
        updatedBalancesMap: userBalancesMap,
        error: `Insufficient available funds in treasury account ${sourceAccount}. Available: ${sourceBalance.free} ${asset}, requested: ${amount} ${asset}.`,
      };
    }

    // 4. Target account check
    const targetUserAssets = userBalancesMap[targetMMAccount] || {};
    const targetBalance = targetUserAssets[asset] || { asset, free: 0, locked: 0, total: 0 };

    // 5. Atomic Double-entry mutations
    const sourceBefore = sourceBalance.free;
    const sourceAfter = safeRound(sourceBefore - amount, 6);

    const targetBefore = targetBalance.free;
    const targetAfter = safeRound(targetBefore + amount, 6);

    const txId = `ltx_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;

    const debitEntry: LedgerEntry = {
      id: `ent_deb_${txId}`,
      transactionId: txId,
      accountId: sourceAccount,
      asset,
      type: 'DEBIT',
      amount,
      balanceBefore: sourceBefore,
      balanceAfter: sourceAfter,
      timestamp,
    };

    const creditEntry: LedgerEntry = {
      id: `ent_crd_${txId}`,
      transactionId: txId,
      accountId: targetMMAccount,
      asset,
      type: 'CREDIT',
      amount,
      balanceBefore: targetBefore,
      balanceAfter: targetAfter,
      timestamp,
    };

    // Deep copy balances map
    const nextMap: Record<string, Record<string, UserBalance>> = JSON.parse(JSON.stringify(userBalancesMap));

    if (!nextMap[sourceAccount]) nextMap[sourceAccount] = {};
    nextMap[sourceAccount][asset] = {
      asset,
      free: sourceAfter,
      locked: sourceBalance.locked,
      total: safeRound(sourceAfter + sourceBalance.locked, 6),
    };

    if (!nextMap[targetMMAccount]) nextMap[targetMMAccount] = {};
    nextMap[targetMMAccount][asset] = {
      asset,
      free: targetAfter,
      locked: targetBalance.locked,
      total: safeRound(targetAfter + targetBalance.locked, 6),
    };

    const tx: LedgerTransaction = {
      id: txId,
      idempotencyKey,
      listingId,
      category: 'TREASURY_MM_ALLOCATION',
      sourceAccount,
      targetAccount: targetMMAccount,
      asset,
      amount,
      actorId,
      timestamp,
      status: 'POSTED',
      entries: [debitEntry, creditEntry],
    };

    this.processedIdempotencyKeys.add(idempotencyKey);
    this.transactionHistory.push(tx);

    return {
      success: true,
      updatedBalancesMap: nextMap,
      transaction: tx,
    };
  }

  /**
   * Reconciles recorded ledger entries with calculated user balances
   */
  static reconcileLedger(
    initialBalances: Record<string, Record<string, UserBalance>>,
    transactions: LedgerTransaction[],
    currentBalances: Record<string, Record<string, UserBalance>>
  ): { isReconciled: boolean; mismatches: string[] } {
    const mismatches: string[] = [];

    // Calculate expected balances by summing transactions over initialBalances
    const calculated: Record<string, Record<string, number>> = {};

    for (const [userId, assets] of Object.entries(initialBalances)) {
      calculated[userId] = {};
      for (const [asset, bal] of Object.entries(assets)) {
        calculated[userId][asset] = bal.free;
      }
    }

    for (const tx of transactions) {
      if (tx.status !== 'POSTED') continue;
      for (const entry of tx.entries) {
        if (!calculated[entry.accountId]) calculated[entry.accountId] = {};
        if (calculated[entry.accountId][entry.asset] === undefined) {
          calculated[entry.accountId][entry.asset] = 0;
        }
        if (entry.type === 'DEBIT') {
          calculated[entry.accountId][entry.asset] = safeRound(calculated[entry.accountId][entry.asset] - entry.amount, 6);
        } else {
          calculated[entry.accountId][entry.asset] = safeRound(calculated[entry.accountId][entry.asset] + entry.amount, 6);
        }
      }
    }

    for (const [userId, assets] of Object.entries(currentBalances)) {
      for (const [asset, b] of Object.entries(assets)) {
        const expected = calculated[userId]?.[asset] ?? 0;
        // Compare with tolerance for floating artifacts
        if (Math.abs(expected - b.free) > 0.0001) {
          mismatches.push(`Account ${userId} ${asset} mismatch: expected free ${expected}, got ${b.free}`);
        }
      }
    }

    return {
      isReconciled: mismatches.length === 0,
      mismatches,
    };
  }

  /**
   * Filters orders specifically for the logged in user
   */
  static filterOrdersByUser(orders: any[], userId: string): any[] {
    return orders.filter((o) => o.userId === userId);
  }

  /**
   * Filters trades specifically for the logged in user
   */
  static filterTradesByUser(trades: any[], userId: string, userOrderIds: Set<string>): any[] {
    return trades.filter((t) => {
      if (t.makerUserId === userId || t.takerUserId === userId) return true;
      if (t.orderId && userOrderIds.has(t.orderId)) return true;
      if (t.makerOrderId && userOrderIds.has(t.makerOrderId)) return true;
      if (t.takerOrderId && userOrderIds.has(t.takerOrderId)) return true;
      return false;
    });
  }
}
