import { DatabaseManager } from '../db/database';

export class MetricsCollector {
  private static startTime: number = Date.now();
  private dbMgr: DatabaseManager;

  constructor(dbMgr: DatabaseManager) {
    this.dbMgr = dbMgr;
  }

  public getHealth(): Record<string, any> {
    const memory = process.memoryUsage();
    let dbStatus = 'healthy';
    try {
      this.dbMgr.queryOne('SELECT 1');
    } catch {
      dbStatus = 'unhealthy';
    }

    return {
      status: dbStatus === 'healthy' ? 'UP' : 'DOWN',
      uptimeSeconds: Math.floor((Date.now() - MetricsCollector.startTime) / 1000),
      timestamp: new Date().toISOString(),
      database: dbStatus,
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      },
    };
  }

  /**
   * Generates Prometheus exposition format (text/plain) metrics
   */
  public getPrometheusMetrics(): string {
    const lines: string[] = [];
    const uptime = Math.floor((Date.now() - MetricsCollector.startTime) / 1000);

    lines.push('# HELP process_uptime_seconds The process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${uptime}`);

    // Total orders count
    const ordersCount = this.dbMgr.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM orders');
    lines.push('# HELP exchange_orders_total Total number of orders placed.');
    lines.push('# TYPE exchange_orders_total counter');
    lines.push(`exchange_orders_total ${ordersCount?.count || 0}`);

    // Total trades count
    const tradesCount = this.dbMgr.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM trades');
    lines.push('# HELP exchange_trades_total Total number of executed trades.');
    lines.push('# TYPE exchange_trades_total counter');
    lines.push(`exchange_trades_total ${tradesCount?.count || 0}`);

    // Open orders gauge
    const openOrdersCount = this.dbMgr.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM orders WHERE status IN ('NEW', 'PARTIALLY_FILLED')`
    );
    lines.push('# HELP exchange_open_orders Total currently active open orders in matching book.');
    lines.push('# TYPE exchange_open_orders gauge');
    lines.push(`exchange_open_orders ${openOrdersCount?.count || 0}`);

    // Ledger transactions count
    const ledgerCount = this.dbMgr.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM ledger_transactions');
    lines.push('# HELP exchange_ledger_transactions_total Total immutable ledger double-entry transactions.');
    lines.push('# TYPE exchange_ledger_transactions_total counter');
    lines.push(`exchange_ledger_transactions_total ${ledgerCount?.count || 0}`);

    // Active sessions gauge
    const now = Date.now();
    const sessionsCount = this.dbMgr.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM user_sessions WHERE is_revoked = 0 AND expires_at > ?`,
      [now]
    );
    lines.push('# HELP exchange_active_sessions Currently active user sessions.');
    lines.push('# TYPE exchange_active_sessions gauge');
    lines.push(`exchange_active_sessions ${sessionsCount?.count || 0}`);

    return lines.join('\n') + '\n';
  }
}
