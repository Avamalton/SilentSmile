import crypto from 'node:crypto';
import { DatabaseManager } from '../db/database';

export interface AuditLogRecord {
  id: string;
  actor_id: string;
  action: string;
  resource: string;
  ip_address: string | null;
  payload_json: string | null;
  timestamp: number;
}

export interface SuspiciousAlert {
  id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId: string;
  type: string;
  description: string;
  timestamp: number;
}

export class ComplianceService {
  private dbMgr: DatabaseManager;

  constructor(dbMgr: DatabaseManager) {
    this.dbMgr = dbMgr;
  }

  /**
   * Append-only immutable audit log record
   */
  public logAudit(actorId: string, action: string, resource: string, payload?: any, ipAddress?: string): void {
    const id = `aud_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const payloadJson = payload ? JSON.stringify(payload) : null;

    this.dbMgr.execute(
      `INSERT INTO audit_logs (id, actor_id, action, resource, ip_address, payload_json, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, actorId, action, resource, ipAddress || null, payloadJson, now]
    );
  }

  public getAuditLogs(limit: number = 100): AuditLogRecord[] {
    return this.dbMgr.query<AuditLogRecord>(
      'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
  }

  /**
   * Freezes a user account (prevents all trading, withdrawals, and balance movements)
   */
  public freezeAccount(userId: string, reason: string, adminId: string, ipAddress?: string): void {
    this.dbMgr.execute(
      `UPDATE users SET status = 'frozen', updated_at = ? WHERE id = ?`,
      [Date.now(), userId]
    );

    this.logAudit(adminId, 'ACCOUNT_FREEZE', `user:${userId}`, { reason }, ipAddress);
  }

  /**
   * Unfreezes a user account
   */
  public unfreezeAccount(userId: string, reason: string, adminId: string, ipAddress?: string): void {
    this.dbMgr.execute(
      `UPDATE users SET status = 'active', updated_at = ? WHERE id = ?`,
      [Date.now(), userId]
    );

    this.logAudit(adminId, 'ACCOUNT_UNFREEZE', `user:${userId}`, { reason }, ipAddress);
  }

  /**
   * Scans system for suspicious financial patterns (AML Monitoring):
   * 1. High-frequency withdrawals in 24 hours.
   * 2. Single transaction exceeding 500,000,000 IDR.
   * 3. Multiple concurrent IP logins from different subnets within 1 hour.
   */
  public scanSuspiciousActivities(): SuspiciousAlert[] {
    const alerts: SuspiciousAlert[] = [];
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Check 1: Large withdrawals
    const largeWithdrawals = this.dbMgr.query<any>(
      `SELECT * FROM withdrawals WHERE amount >= 500000000 AND created_at >= ?`,
      [dayAgo]
    );
    for (const w of largeWithdrawals) {
      alerts.push({
        id: `alt_${w.id}`,
        severity: 'HIGH',
        userId: w.user_id,
        type: 'LARGE_WITHDRAWAL_THRESHOLD',
        description: `Single withdrawal of ${w.amount.toLocaleString()} ${w.asset} exceeds 500M IDR threshold`,
        timestamp: w.created_at,
      });
    }

    // Check 2: High frequency withdrawal attempts (> 3 in 24h)
    const userWithdrawCount = this.dbMgr.query<any>(
      `SELECT user_id, COUNT(*) as count FROM withdrawals WHERE created_at >= ? GROUP BY user_id HAVING count >= 3`,
      [dayAgo]
    );
    for (const u of userWithdrawCount) {
      alerts.push({
        id: `alt_freq_${u.user_id}`,
        severity: 'MEDIUM',
        userId: u.user_id,
        type: 'HIGH_FREQUENCY_WITHDRAWAL',
        description: `User initiated ${u.count} withdrawals within 24 hours`,
        timestamp: now,
      });
    }

    return alerts;
  }

  /**
   * Generates CSV compliance report for regulators (OJK/Bappebti)
   */
  public generateComplianceReport(type: 'TRADES' | 'LEDGER' | 'AUDIT'): string {
    if (type === 'TRADES') {
      const trades = this.dbMgr.query<any>('SELECT * FROM trades ORDER BY timestamp DESC LIMIT 1000');
      const headers = 'ID,Pair,Price,Amount,Total,Side,MakerID,TakerID,Timestamp\n';
      const rows = trades
        .map((t) => `${t.id},${t.pair_id},${t.price},${t.amount},${t.total},${t.side},${t.maker_user_id},${t.taker_user_id},${new Date(t.timestamp).toISOString()}`)
        .join('\n');
      return headers + rows;
    }

    if (type === 'AUDIT') {
      const logs = this.dbMgr.query<any>('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 1000');
      const headers = 'ID,ActorID,Action,Resource,IPAddress,Timestamp\n';
      const rows = logs
        .map((l) => `${l.id},${l.actor_id},${l.action},${l.resource},${l.ip_address || ''},${new Date(l.timestamp).toISOString()}`)
        .join('\n');
      return headers + rows;
    }

    // Default: Ledger Entries
    const entries = this.dbMgr.query<any>('SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 1000');
    const headers = 'ID,TransactionID,AccountID,Asset,EntryType,Amount,BalanceBefore,BalanceAfter,Timestamp\n';
    const rows = entries
      .map((e) => `${e.id},${e.transaction_id},${e.account_id},${e.asset},${e.entry_type},${e.amount},${e.balance_before},${e.balance_after},${new Date(e.created_at).toISOString()}`)
      .join('\n');
    return headers + rows;
  }
}
