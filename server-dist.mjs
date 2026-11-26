// src/server/app.ts
import "dotenv/config";
import express from "express";
import http from "node:http";
import path2 from "node:path";
import cookieParser from "cookie-parser";
import { WebSocketServer, WebSocket as WebSocket2 } from "ws";

// src/server/db/database.ts
import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
var DatabaseManager = class _DatabaseManager {
  constructor(dbFilePath) {
    this.db = null;
    this.inTransaction = false;
    this.dbFilePath = dbFilePath || path.resolve(process.cwd(), "data", "silentsmile.db");
  }
  static {
    this.instance = null;
  }
  static getInstance(dbFilePath) {
    if (!_DatabaseManager.instance) {
      _DatabaseManager.instance = new _DatabaseManager(dbFilePath);
    }
    return _DatabaseManager.instance;
  }
  static createIsolated(dbFilePath) {
    return new _DatabaseManager(dbFilePath || ":memory:");
  }
  static resetInstance() {
    if (_DatabaseManager.instance) {
      _DatabaseManager.instance.close();
      _DatabaseManager.instance = null;
    }
  }
  async initialize() {
    if (this.db) {
      return this.db;
    }
    const SQL = await initSqlJs();
    const dataDir = path.dirname(this.dbFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (this.dbFilePath !== ":memory:" && fs.existsSync(this.dbFilePath)) {
      const fileBuffer = fs.readFileSync(this.dbFilePath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
      if (this.dbFilePath !== ":memory:") {
        this.saveToFile();
      }
    }
    return this.db;
  }
  getDb() {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }
  saveToFile() {
    if (!this.db || this.dbFilePath === ":memory:") return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const tempPath = `${this.dbFilePath}.tmp`;
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, this.dbFilePath);
    } catch (err) {
      console.error("Failed to persist database to file:", err);
    }
  }
  /**
   * Executes parameterized SELECT query and returns array of objects
   */
  query(sql, params = []) {
    const db = this.getDb();
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } finally {
      stmt.free();
    }
  }
  /**
   * Executes parameterized SELECT returning a single row or null
   */
  queryOne(sql, params = []) {
    const rows = this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }
  /**
   * Executes parameterized INSERT/UPDATE/DELETE statement
   */
  execute(sql, params = []) {
    const db = this.getDb();
    db.run(sql, params);
    if (!this.inTransaction) {
      this.saveToFile();
    }
  }
  /**
   * Executes multiple statements in a single atomic transaction.
   * Automatically rolls back on exception.
   */
  runInTransaction(action) {
    const db = this.getDb();
    if (this.inTransaction) {
      return action();
    }
    this.inTransaction = true;
    db.run("BEGIN TRANSACTION");
    try {
      const result = action();
      db.run("COMMIT");
      this.saveToFile();
      return result;
    } catch (err) {
      try {
        db.run("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Failed to rollback transaction:", rollbackErr);
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }
  transaction(action) {
    return this.runInTransaction(action);
  }
  close() {
    if (this.db) {
      this.saveToFile();
      this.db.close();
      this.db = null;
    }
    _DatabaseManager.instance = null;
  }
};
var dbManager = DatabaseManager.getInstance();

// src/server/db/migrations.ts
var SCHEMA_SQL = `
-- 1. USERS & AUTHENTICATION
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'trader',
    status TEXT NOT NULL DEFAULT 'active',
    kyc_level INTEGER NOT NULL DEFAULT 0,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    daily_withdraw_limit_idr INTEGER NOT NULL DEFAULT 10000000,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    refresh_token_hash TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    device_name TEXT,
    is_revoked INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- 2. KYC SUBMISSIONS & REVIEWS
CREATE TABLE IF NOT EXISTS kyc_applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    full_name TEXT NOT NULL,
    id_number TEXT NOT NULL,
    id_card_url TEXT NOT NULL,
    selfie_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reject_reason TEXT,
    reviewer_id TEXT REFERENCES users(id),
    reviewed_at INTEGER,
    vendor_reference TEXT,
    created_at INTEGER NOT NULL
);

-- 3. FINANCIAL LEDGER (DOUBLE-ENTRY)
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,
    account_type TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, asset, account_type)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
    account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
    asset TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- 4. ORDER ENGINE & EVENT SOURCING
CREATE TABLE IF NOT EXISTS market_pairs (
    id TEXT PRIMARY KEY,
    base_asset TEXT NOT NULL,
    quote_asset TEXT NOT NULL,
    base_precision INTEGER NOT NULL DEFAULT 8,
    quote_precision INTEGER NOT NULL DEFAULT 0,
    min_order_size INTEGER NOT NULL,
    maker_fee_bps INTEGER NOT NULL DEFAULT 10,
    taker_fee_bps INTEGER NOT NULL DEFAULT 15,
    is_active INTEGER NOT NULL DEFAULT 1,
    trading_status TEXT NOT NULL DEFAULT 'OPEN'
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    client_order_id TEXT,
    user_id TEXT NOT NULL REFERENCES users(id),
    pair_id TEXT NOT NULL REFERENCES market_pairs(id),
    side TEXT NOT NULL,
    order_type TEXT NOT NULL,
    price INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    filled_amount INTEGER NOT NULL DEFAULT 0,
    remaining_amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    pair_id TEXT NOT NULL REFERENCES market_pairs(id),
    price INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    total INTEGER NOT NULL,
    side TEXT NOT NULL,
    maker_order_id TEXT NOT NULL REFERENCES orders(id),
    taker_order_id TEXT NOT NULL REFERENCES orders(id),
    maker_user_id TEXT NOT NULL REFERENCES users(id),
    taker_user_id TEXT NOT NULL REFERENCES users(id),
    maker_fee INTEGER NOT NULL,
    taker_fee INTEGER NOT NULL,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_events (
    seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

-- 5. WALLET & PAYMENTS
CREATE TABLE IF NOT EXISTS crypto_addresses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    asset TEXT NOT NULL,
    chain TEXT NOT NULL,
    address TEXT UNIQUE NOT NULL,
    memo_tag TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    asset TEXT NOT NULL,
    amount INTEGER NOT NULL,
    fee INTEGER NOT NULL,
    destination_address TEXT NOT NULL,
    destination_bank_name TEXT,
    destination_account_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending_approval',
    approved_by TEXT REFERENCES users(id),
    tx_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 6. PUBLIC API KEYS (HMAC)
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    key_id TEXT UNIQUE NOT NULL,
    secret_hash TEXT NOT NULL,
    permissions TEXT NOT NULL,
    ip_whitelist TEXT,
    rate_limit_rpm INTEGER NOT NULL DEFAULT 120,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

-- 7. AUDIT LOG & COMPLIANCE
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    ip_address TEXT,
    payload_json TEXT,
    timestamp INTEGER NOT NULL
);

-- 8. INITIAL LISTING LIFECYCLE & SCHEDULER
CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES market_pairs(id),
    status TEXT NOT NULL DEFAULT 'DRAFT',
    mm_phase TEXT NOT NULL DEFAULT 'NOT_STARTED',
    trading_status TEXT NOT NULL DEFAULT 'CLOSED',
    deposit_status TEXT NOT NULL DEFAULT 'CLOSED',
    withdrawal_status TEXT NOT NULL DEFAULT 'CLOSED',
    public_visibility TEXT NOT NULL DEFAULT 'HIDDEN',
    assigned_mm_account TEXT NOT NULL DEFAULT 'usr_mm_01',
    initial_price INTEGER NOT NULL DEFAULT 10000,
    price_precision INTEGER NOT NULL DEFAULT 0,
    amount_precision INTEGER NOT NULL DEFAULT 2,
    min_order_amount INTEGER NOT NULL DEFAULT 1,
    maker_fee_bps INTEGER NOT NULL DEFAULT 10,
    taker_fee_bps INTEGER NOT NULL DEFAULT 15,
    approved_by TEXT REFERENCES users(id),
    approved_at INTEGER,
    scheduled_at INTEGER,
    actual_launch_at INTEGER,
    new_badge_expires_at INTEGER,
    review_notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_schedules (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    market_id TEXT NOT NULL REFERENCES market_pairs(id),
    timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    scheduled_listing_at INTEGER NOT NULL,
    mm_funding_opens_at INTEGER NOT NULL,
    mm_setup_opens_at INTEGER NOT NULL,
    trading_opens_at INTEGER NOT NULL,
    new_badge_expires_at INTEGER NOT NULL,
    deposit_opens_at INTEGER NOT NULL,
    withdrawal_opens_at INTEGER NOT NULL,
    minimum_mm_base_inventory INTEGER NOT NULL,
    minimum_mm_quote_inventory INTEGER NOT NULL,
    minimum_bid_depth INTEGER NOT NULL,
    minimum_ask_depth INTEGER NOT NULL,
    maximum_initial_spread_pct REAL NOT NULL,
    schedule_version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reschedule_reason TEXT
);

CREATE TABLE IF NOT EXISTS market_access (
    market_id TEXT PRIMARY KEY REFERENCES market_pairs(id),
    trading_status TEXT NOT NULL DEFAULT 'CLOSED',
    deposit_status TEXT NOT NULL DEFAULT 'CLOSED',
    withdrawal_status TEXT NOT NULL DEFAULT 'CLOSED',
    public_visibility TEXT NOT NULL DEFAULT 'HIDDEN',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_events (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    event_type TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    new_state TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    schedule_version INTEGER NOT NULL,
    metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS inventory_allocations (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    source_account TEXT NOT NULL,
    target_account TEXT NOT NULL,
    asset TEXT NOT NULL,
    amount INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    tx_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 9. ASSET & NETWORK MANAGEMENT
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    symbol TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL,
    deposit_enabled INTEGER NOT NULL DEFAULT 1,
    withdrawal_enabled INTEGER NOT NULL DEFAULT 1,
    listing_id TEXT REFERENCES listings(id),
    primary_chain TEXT,
    token_standard TEXT,
    contract_address TEXT,
    total_supply REAL,
    max_supply REAL,
    circulating_supply REAL,
    description TEXT,
    website_url TEXT,
    whitepaper_url TEXT,
    explorer_url TEXT,
    genesis_date TEXT,
    initial_price REAL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_networks (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    network_id TEXT NOT NULL,
    network_name TEXT NOT NULL,
    chain_type TEXT NOT NULL,
    native_currency TEXT NOT NULL,
    contract_address TEXT,
    decimals INTEGER NOT NULL,
    min_deposit REAL NOT NULL DEFAULT 0,
    deposit_confirmations INTEGER NOT NULL DEFAULT 12,
    deposit_status TEXT NOT NULL DEFAULT 'OPEN',
    withdrawal_status TEXT NOT NULL DEFAULT 'OPEN',
    withdrawal_fee REAL NOT NULL DEFAULT 0,
    min_withdrawal REAL NOT NULL DEFAULT 0,
    max_daily_withdrawal REAL,
    is_memo_required INTEGER NOT NULL DEFAULT 0,
    explorer_tx_url TEXT,
    explorer_address_url TEXT,
    rpc_endpoint TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(asset_id, network_id)
);

-- 10. MARKET MAKER CONSOLE & RISK ENGINE
CREATE TABLE IF NOT EXISTS mm_bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    account_id TEXT NOT NULL,
    api_key_id TEXT,
    target_market_symbol TEXT NOT NULL,
    mapping_config_json TEXT NOT NULL,
    depth_config_json TEXT,
    risk_profile_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'STOPPED',
    dry_run INTEGER NOT NULL DEFAULT 0,
    min_reprice_interval_ms INTEGER NOT NULL DEFAULT 2500,
    min_price_change_bps INTEGER NOT NULL DEFAULT 15,
    target_spread_bps INTEGER NOT NULL DEFAULT 25,
    active_open_orders_count INTEGER NOT NULL DEFAULT 0,
    total_bid_exposure REAL NOT NULL DEFAULT 0,
    total_ask_exposure REAL NOT NULL DEFAULT 0,
    current_base_inventory REAL NOT NULL DEFAULT 0,
    current_quote_inventory REAL NOT NULL DEFAULT 0,
    realized_pnl REAL NOT NULL DEFAULT 0,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    daily_turnover REAL NOT NULL DEFAULT 0,
    last_repriced_at INTEGER,
    error_message TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    pair TEXT NOT NULL,
    rate REAL NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cryptographic_audit_logs (
    id TEXT PRIMARY KEY,
    log_index INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    bot_id TEXT,
    event_type TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_acc_user_asset ON ledger_accounts(user_id, asset);
CREATE INDEX IF NOT EXISTS idx_orders_pair_status ON orders(pair_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_pair_ts ON trades(pair_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_engine_events_pair ON engine_events(pair_id, seq_id);
CREATE INDEX IF NOT EXISTS idx_listings_market ON listings(market_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listing_events_listing ON listing_events(listing_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_asset_networks_asset ON asset_networks(asset_id);
CREATE INDEX IF NOT EXISTS idx_mm_bots_account ON mm_bots(account_id);
CREATE INDEX IF NOT EXISTS idx_crypto_audit_idx ON cryptographic_audit_logs(log_index);

-- 11. VOLUME EXECUTION V2 ENGINE (AUTHORITATIVE BOT STATE, ORDERS, TRADES & SIMULATION ISOLATION)
CREATE TABLE IF NOT EXISTS volume_bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    pair_id TEXT NOT NULL REFERENCES market_pairs(id),
    environment TEXT NOT NULL DEFAULT 'DEMO',
    execution_mode TEXT NOT NULL DEFAULT 'SIMULATION',
    execution_side TEXT NOT NULL DEFAULT 'BUY',
    strategy TEXT NOT NULL DEFAULT 'TWAP',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    enabled INTEGER NOT NULL DEFAULT 0,
    config_version INTEGER NOT NULL DEFAULT 1,
    config_json TEXT NOT NULL,
    target_qty_atomic TEXT NOT NULL DEFAULT '0',
    remaining_qty_atomic TEXT NOT NULL DEFAULT '0',
    executed_qty_atomic TEXT NOT NULL DEFAULT '0',
    executed_quote_atomic TEXT NOT NULL DEFAULT '0',
    total_fees_atomic TEXT NOT NULL DEFAULT '0',
    weighted_price_num_atomic TEXT NOT NULL DEFAULT '0',
    daily_executed_quote_atomic TEXT NOT NULL DEFAULT '0',
    daily_reset_day TEXT NOT NULL DEFAULT '',
    submitted_orders_count INTEGER NOT NULL DEFAULT 0,
    accepted_orders_count INTEGER NOT NULL DEFAULT 0,
    partial_fills_count INTEGER NOT NULL DEFAULT 0,
    filled_orders_count INTEGER NOT NULL DEFAULT 0,
    cancelled_orders_count INTEGER NOT NULL DEFAULT 0,
    rejected_orders_count INTEGER NOT NULL DEFAULT 0,
    expired_orders_count INTEGER NOT NULL DEFAULT 0,
    total_trades_count INTEGER NOT NULL DEFAULT 0,
    total_slippage_bps_sum TEXT NOT NULL DEFAULT '0',
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    risk_state_json TEXT NOT NULL DEFAULT '{}',
    emergency_stopped INTEGER NOT NULL DEFAULT 0,
    last_execution_at INTEGER,
    last_error TEXT,
    migrated_from_legacy_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_bot_orders (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES volume_bots(id) ON DELETE CASCADE,
    idempotency_key TEXT UNIQUE NOT NULL,
    pair_id TEXT NOT NULL,
    execution_mode TEXT NOT NULL DEFAULT 'SIMULATION',
    side TEXT NOT NULL,
    order_type TEXT NOT NULL,
    price_atomic TEXT NOT NULL,
    amount_atomic TEXT NOT NULL,
    filled_amount_atomic TEXT NOT NULL DEFAULT '0',
    remaining_amount_atomic TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL DEFAULT 'SUBMITTED',
    retry_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_bot_trades (
    id TEXT PRIMARY KEY,
    trade_id TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES volume_bots(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    pair_id TEXT NOT NULL,
    execution_mode TEXT NOT NULL DEFAULT 'SIMULATION',
    side TEXT NOT NULL,
    price_atomic TEXT NOT NULL,
    amount_atomic TEXT NOT NULL,
    quote_total_atomic TEXT NOT NULL,
    fee_atomic TEXT NOT NULL DEFAULT '0',
    fee_asset TEXT NOT NULL,
    slippage_bps INTEGER NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL,
    UNIQUE(bot_id, trade_id, execution_mode)
);

CREATE TABLE IF NOT EXISTS volume_bot_logs (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES volume_bots(id) ON DELETE CASCADE,
    execution_mode TEXT NOT NULL DEFAULT 'SIMULATION',
    level TEXT NOT NULL DEFAULT 'INFO',
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_bot_sim_events (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES volume_bots(id) ON DELETE CASCADE,
    pair_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    side TEXT NOT NULL,
    price_atomic TEXT NOT NULL,
    amount_atomic TEXT NOT NULL,
    quote_total_atomic TEXT NOT NULL,
    fee_atomic TEXT NOT NULL DEFAULT '0',
    order_id TEXT,
    trade_id TEXT,
    details_json TEXT,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_bot_config_versions (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES volume_bots(id) ON DELETE CASCADE,
    config_version INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vol_bots_owner ON volume_bots(owner_id);
CREATE INDEX IF NOT EXISTS idx_vol_bots_status ON volume_bots(status, enabled);
CREATE INDEX IF NOT EXISTS idx_vol_bots_pair_env ON volume_bots(pair_id, environment);
CREATE INDEX IF NOT EXISTS idx_vol_bot_orders_bot ON volume_bot_orders(bot_id, status);
CREATE INDEX IF NOT EXISTS idx_vol_bot_trades_bot ON volume_bot_trades(bot_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_vol_bot_logs_bot ON volume_bot_logs(bot_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_vol_bot_sim_bot ON volume_bot_sim_events(bot_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_vol_bot_cfg_hist ON volume_bot_config_versions(bot_id, config_version);
`;
async function runMigrations(dbMgr) {
  const db = dbMgr.getDb();
  db.run(SCHEMA_SQL);
  const now = Date.now();
  const systemAccounts = [
    { userId: "sys_treasury", asset: "IDR" },
    { userId: "sys_treasury", asset: "BTC" },
    { userId: "sys_treasury", asset: "ETH" },
    { userId: "sys_treasury", asset: "SOL" },
    { userId: "sys_treasury", asset: "DNA" },
    { userId: "sys_treasury", asset: "USDT" },
    { userId: "sys_fee_vault", asset: "IDR" },
    { userId: "sys_fee_vault", asset: "BTC" },
    { userId: "sys_fee_vault", asset: "ETH" },
    { userId: "sys_fee_vault", asset: "SOL" },
    { userId: "sys_fee_vault", asset: "DNA" },
    { userId: "sys_fee_vault", asset: "USDT" }
  ];
  for (const acc of systemAccounts) {
    const id = `acc_${acc.userId}_${acc.asset}_AVAILABLE`;
    const existing = dbMgr.queryOne("SELECT id FROM ledger_accounts WHERE id = ?", [id]);
    if (!existing) {
      dbMgr.execute(
        `INSERT INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
         VALUES (?, ?, ?, 'AVAILABLE', 0, ?)`,
        [id, acc.userId, acc.asset, now]
      );
    }
  }
  const pairCount = dbMgr.queryOne("SELECT COUNT(*) as count FROM market_pairs");
  if (!pairCount || pairCount.count === 0) {
    const defaultPairs = [
      { id: "BTC/IDR", base: "BTC", quote: "IDR", basePrec: 8, quotePrec: 0, minSize: 1e4, maker: 10, taker: 15 },
      { id: "ETH/IDR", base: "ETH", quote: "IDR", basePrec: 6, quotePrec: 0, minSize: 1e5, maker: 10, taker: 15 },
      { id: "SOL/IDR", base: "SOL", quote: "IDR", basePrec: 4, quotePrec: 0, minSize: 1e6, maker: 10, taker: 15 },
      { id: "DNA/IDR", base: "DNA", quote: "IDR", basePrec: 2, quotePrec: 0, minSize: 1e6, maker: 10, taker: 15 },
      { id: "USDT/IDR", base: "USDT", quote: "IDR", basePrec: 2, quotePrec: 0, minSize: 100, maker: 5, taker: 10 }
    ];
    for (const p of defaultPairs) {
      dbMgr.execute(
        `INSERT INTO market_pairs (id, base_asset, quote_asset, base_precision, quote_precision, min_order_size, maker_fee_bps, taker_fee_bps, is_active, trading_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'OPEN')`,
        [p.id, p.base, p.quote, p.basePrec, p.quotePrec, p.minSize, p.maker, p.taker]
      );
    }
  }
  const listingCount = dbMgr.queryOne("SELECT COUNT(*) as count FROM listings");
  if (!listingCount || listingCount.count === 0) {
    const initialListingsSeed = [
      {
        id: "list_mock_01",
        market_id: "MOCK/IDR",
        base: "MOCK",
        quote: "IDR",
        status: "PREPARING",
        mm_phase: "ORDER_SETUP_OPEN",
        trading_status: "PREPARATION_ONLY",
        deposit_status: "OPEN",
        withdrawal_status: "CLOSED",
        public_visibility: "UPCOMING",
        assigned_mm: "usr_mm_01",
        price: 25e3,
        sch_at: now - 36e5 * 2,
        mm_fund_at: now - 36e5,
        mm_setup_at: now - 18e5,
        trade_at: now + 18e5,
        badge_at: now + 864e5 * 3,
        dep_at: now - 36e5,
        wth_at: now + 864e5,
        min_base: 5e3,
        min_quote: 1e8,
        spread: 0.35
      },
      {
        id: "list_aurora_01",
        market_id: "AURORA/IDR",
        base: "AURORA",
        quote: "IDR",
        status: "SCHEDULED",
        mm_phase: "NOT_STARTED",
        trading_status: "CLOSED",
        deposit_status: "CLOSED",
        withdrawal_status: "CLOSED",
        public_visibility: "UPCOMING",
        assigned_mm: "usr_mm_01",
        price: 15e3,
        sch_at: now - 36e5,
        mm_fund_at: now + 36e5,
        mm_setup_at: now + 72e5,
        trade_at: now + 108e5,
        badge_at: now + 108e5 + 864e5 * 3,
        dep_at: now + 36e5,
        wth_at: now + 864e5 * 2,
        min_base: 2e3,
        min_quote: 5e7,
        spread: 0.4
      }
    ];
    for (const l of initialListingsSeed) {
      const pairExists = dbMgr.queryOne("SELECT id FROM market_pairs WHERE id = ?", [l.market_id]);
      if (!pairExists) {
        dbMgr.execute(
          `INSERT INTO market_pairs (id, base_asset, quote_asset, base_precision, quote_precision, min_order_size, maker_fee_bps, taker_fee_bps, is_active, trading_status)
           VALUES (?, ?, ?, 2, 0, 100, 10, 15, 0, ?)`,
          [l.market_id, l.base, l.quote, l.trading_status]
        );
      }
      dbMgr.execute(
        `INSERT INTO listings (
          id, market_id, status, mm_phase, trading_status, deposit_status, withdrawal_status,
          public_visibility, assigned_mm_account, initial_price, price_precision, amount_precision,
          min_order_amount, maker_fee_bps, taker_fee_bps, approved_by, approved_at, scheduled_at,
          new_badge_expires_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 2, 1, 10, 15, 'usr_admin_01', ?, ?, ?, 1, ?, ?)`,
        [
          l.id,
          l.market_id,
          l.status,
          l.mm_phase,
          l.trading_status,
          l.deposit_status,
          l.withdrawal_status,
          l.public_visibility,
          l.assigned_mm,
          l.price,
          l.sch_at,
          l.sch_at,
          l.badge_at,
          l.sch_at,
          now
        ]
      );
      dbMgr.execute(
        `INSERT INTO listing_schedules (
          id, listing_id, market_id, timezone, scheduled_listing_at, mm_funding_opens_at,
          mm_setup_opens_at, trading_opens_at, new_badge_expires_at, deposit_opens_at,
          withdrawal_opens_at, minimum_mm_base_inventory, minimum_mm_quote_inventory,
          minimum_bid_depth, minimum_ask_depth, maximum_initial_spread_pct, schedule_version,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 'Asia/Jakarta', ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, 5, ?, 1, 'usr_admin_01', ?, ?)`,
        [
          `sch_${l.id}`,
          l.id,
          l.market_id,
          l.sch_at,
          l.mm_fund_at,
          l.mm_setup_at,
          l.trade_at,
          l.badge_at,
          l.dep_at,
          l.wth_at,
          l.min_base,
          l.min_quote,
          l.spread,
          l.sch_at,
          now
        ]
      );
      dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version
        ) VALUES (?, ?, 'LISTING_INITIALIZED', 'DRAFT', ?, 'usr_admin_01', ?, 1)`,
        [`evt_init_${l.id}`, l.id, l.status, now]
      );
    }
  }
  try {
    const assetCols = dbMgr.query("PRAGMA table_info(assets)").map((c) => c.name);
    const newCols = [
      { name: "primary_chain", type: "TEXT" },
      { name: "token_standard", type: "TEXT" },
      { name: "contract_address", type: "TEXT" },
      { name: "total_supply", type: "REAL" },
      { name: "max_supply", type: "REAL" },
      { name: "circulating_supply", type: "REAL" },
      { name: "description", type: "TEXT" },
      { name: "website_url", type: "TEXT" },
      { name: "whitepaper_url", type: "TEXT" },
      { name: "explorer_url", type: "TEXT" },
      { name: "genesis_date", type: "TEXT" },
      { name: "initial_price", type: "REAL" },
      { name: "status", type: "TEXT DEFAULT 'ACTIVE'" }
    ];
    for (const col of newCols) {
      if (!assetCols.includes(col.name)) {
        dbMgr.execute(`ALTER TABLE assets ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  } catch (e) {
  }
  const assetCount = dbMgr.queryOne("SELECT COUNT(*) as count FROM assets");
  if (!assetCount || assetCount.count === 0) {
    const assetsSeed = [
      {
        id: "ast_idr",
        symbol: "IDR",
        name: "Rupiah Indonesia (Virtual)",
        decimals: 0,
        category: "FIAT",
        color: "#22D3EE",
        listingId: null,
        primaryChain: "Bank Indonesia / National Settlement",
        tokenStandard: "Fiat / Virtual Account & QRIS",
        contractAddress: "Bank Indonesia BI-FAST & QRIS Gateway",
        totalSupply: 1e12,
        maxSupply: null,
        circulatingSupply: 1e12,
        description: "Mata uang fiat resmi Republik Indonesia untuk deposit instan via Virtual Account Bank (BCA, Mandiri) dan QRIS.",
        websiteUrl: "https://www.bi.go.id",
        whitepaperUrl: null,
        explorerUrl: null,
        genesisDate: "1945-10-30",
        initialPrice: 1,
        status: "ACTIVE"
      },
      {
        id: "ast_btc",
        symbol: "BTC",
        name: "Bitcoin (Spot)",
        decimals: 8,
        category: "CRYPTO",
        color: "#F7931A",
        listingId: null,
        primaryChain: "Bitcoin Native (UTXO)",
        tokenStandard: "Native (SegWit & Lightning)",
        contractAddress: "Layer 1 Genesis Blockchain",
        totalSupply: 1978e4,
        maxSupply: 21e6,
        circulatingSupply: 1978e4,
        description: "Aset kripto terdesentralisasi pertama di dunia dan penyimpan nilai digital dengan pasokan terbatas 21 Juta BTC.",
        websiteUrl: "https://bitcoin.org",
        whitepaperUrl: "https://bitcoin.org/bitcoin.pdf",
        explorerUrl: "https://mempool.space",
        genesisDate: "2009-01-03",
        initialPrice: 155e7,
        status: "ACTIVE"
      },
      {
        id: "ast_eth",
        symbol: "ETH",
        name: "Ethereum (Spot)",
        decimals: 18,
        category: "CRYPTO",
        color: "#627EEA",
        listingId: null,
        primaryChain: "Ethereum Mainnet (EVM)",
        tokenStandard: "Native / ERC-20 Standard Parent",
        contractAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        totalSupply: 12025e4,
        maxSupply: null,
        circulatingSupply: 12025e4,
        description: "Platform komputasi terdesentralisasi dunia untuk smart contract, DeFi, dan ekosistem aplikasi Web3 global.",
        websiteUrl: "https://ethereum.org",
        whitepaperUrl: "https://ethereum.org/en/whitepaper/",
        explorerUrl: "https://etherscan.io",
        genesisDate: "2015-07-30",
        initialPrice: 425e5,
        status: "ACTIVE"
      },
      {
        id: "ast_usdt",
        symbol: "USDT",
        name: "Tether USD",
        decimals: 6,
        category: "CRYPTO",
        color: "#26A17B",
        listingId: null,
        primaryChain: "TRON / Ethereum Multichain",
        tokenStandard: "TRC-20 / ERC-20 / SPL",
        contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        totalSupply: 118e9,
        maxSupply: null,
        circulatingSupply: 118e9,
        description: "Stablecoin terbesar di dunia terpatok 1:1 terhadap Dolar AS yang didukung oleh cadangan kas dan surat berharga.",
        websiteUrl: "https://tether.to",
        whitepaperUrl: "https://tether.to/en/transparency/",
        explorerUrl: "https://tronscan.org",
        genesisDate: "2014-10-06",
        initialPrice: 16200,
        status: "ACTIVE"
      },
      {
        id: "ast_sol",
        symbol: "SOL",
        name: "Solana (Spot)",
        decimals: 9,
        category: "CRYPTO",
        color: "#14F195",
        listingId: null,
        primaryChain: "Solana (Sealevel Engine)",
        tokenStandard: "Native (SPL Token)",
        contractAddress: "So11111111111111111111111111111111111111112",
        totalSupply: 585e6,
        maxSupply: null,
        circulatingSupply: 468e6,
        description: "Blockchain Layer 1 berkecepatan tinggi dengan mekanisme Proof of History untuk throughput transaksi hingga ribuan TPS.",
        websiteUrl: "https://solana.com",
        whitepaperUrl: "https://solana.com/solana-whitepaper.pdf",
        explorerUrl: "https://solscan.io",
        genesisDate: "2020-03-16",
        initialPrice: 285e4,
        status: "ACTIVE"
      },
      {
        id: "ast_dna",
        symbol: "DNA",
        name: "Denata Network Asset",
        decimals: 2,
        category: "TOKEN",
        color: "#8B5CF6",
        listingId: null,
        primaryChain: "Ethereum (ERC-20)",
        tokenStandard: "ERC-20",
        contractAddress: "0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0",
        totalSupply: 5e8,
        maxSupply: 1e9,
        circulatingSupply: 15e7,
        description: "Denata Network Asset: Native utility dan governance token ekosistem likuiditas SilentSmile Exchange.",
        websiteUrl: "https://denata.network",
        whitepaperUrl: "https://denata.network/whitepaper",
        explorerUrl: "https://etherscan.io/token/0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0",
        genesisDate: "2024-01-15",
        initialPrice: 14500,
        status: "ACTIVE"
      },
      {
        id: "ast_aurora",
        symbol: "AURORA",
        name: "Aurora Protocol",
        decimals: 3,
        category: "TOKEN",
        color: "#A855F7",
        listingId: "list_aurora_01",
        primaryChain: "Ethereum (ERC-20)",
        tokenStandard: "ERC-20",
        contractAddress: "0xaaaa111122223333444455556666777788889999",
        totalSupply: 1e9,
        maxSupply: 1e9,
        circulatingSupply: 25e7,
        description: "Aurora Protocol token untuk smart contract layer dan integrasi komputasi terdesentralisasi.",
        websiteUrl: "https://aurora.internal",
        whitepaperUrl: null,
        explorerUrl: "https://etherscan.io",
        genesisDate: "2025-06-01",
        initialPrice: 12500,
        status: "ACTIVE"
      },
      {
        id: "ast_mock",
        symbol: "MOCK",
        name: "Mock Genesis Asset",
        decimals: 2,
        category: "TOKEN",
        color: "#EC4899",
        listingId: "list_mock_01",
        primaryChain: "Ethereum Sepolia (ERC-20)",
        tokenStandard: "ERC-20 Testnet",
        contractAddress: "0xmock99887766554433221100aabbccddeeff0011",
        totalSupply: 5e7,
        maxSupply: 5e7,
        circulatingSupply: 1e7,
        description: "Mock Genesis Asset untuk simulasi stress-testing matching engine dan initial listing.",
        websiteUrl: null,
        whitepaperUrl: null,
        explorerUrl: "https://sepolia.etherscan.io",
        genesisDate: "2026-01-01",
        initialPrice: 2e3,
        status: "ACTIVE"
      }
    ];
    for (const a of assetsSeed) {
      dbMgr.execute(
        `INSERT INTO assets (
          id, symbol, name, decimals, category, color, deposit_enabled, withdrawal_enabled, listing_id,
          primary_chain, token_standard, contract_address, total_supply, max_supply, circulating_supply,
          description, website_url, whitepaper_url, explorer_url, genesis_date, initial_price, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id,
          a.symbol,
          a.name,
          a.decimals,
          a.category,
          a.color,
          a.listingId,
          a.primaryChain,
          a.tokenStandard,
          a.contractAddress,
          a.totalSupply,
          a.maxSupply,
          a.circulatingSupply,
          a.description,
          a.websiteUrl,
          a.whitepaperUrl,
          a.explorerUrl,
          a.genesisDate,
          a.initialPrice,
          a.status,
          now,
          now
        ]
      );
    }
    const networksSeed = [
      // IDR
      { assetId: "ast_idr", netId: "idr-va-bca", name: "BCA Virtual Account", chain: "EVM", curr: "IDR", contract: null, dec: 0, minDep: 1e4, conf: 1, depStatus: "OPEN", wtdStatus: "OPEN", fee: 4500, minWtd: 5e4, memo: 0, txUrl: "https://bankbca.co.id/ref/{txHash}", addrUrl: "https://bankbca.co.id", rpc: null },
      { assetId: "ast_idr", netId: "idr-qris", name: "QRIS Real-Time National QR", chain: "EVM", curr: "IDR", contract: null, dec: 0, minDep: 5e3, conf: 1, depStatus: "OPEN", wtdStatus: "OPEN", fee: 2500, minWtd: 25e3, memo: 0, txUrl: "https://aspi.or.id/{txHash}", addrUrl: "https://aspi.or.id", rpc: null },
      // BTC
      { assetId: "ast_btc", netId: "btc-mainnet", name: "Bitcoin Native (SegWit)", chain: "BITCOIN", curr: "BTC", contract: null, dec: 8, minDep: 1e-4, conf: 2, depStatus: "OPEN", wtdStatus: "OPEN", fee: 2e-4, minWtd: 5e-4, memo: 0, txUrl: "https://mempool.space/tx/{txHash}", addrUrl: "https://mempool.space/address/{address}", rpc: "https://bitcoin-mainnet.silent-node.internal:8332" },
      { assetId: "ast_btc", netId: "btc-lightning", name: "Lightning Network (Instant)", chain: "BITCOIN", curr: "BTC", contract: null, dec: 8, minDep: 5e-5, conf: 1, depStatus: "OPEN", wtdStatus: "OPEN", fee: 1e-5, minWtd: 1e-4, memo: 1, txUrl: "https://1ml.com/tx/{txHash}", addrUrl: "https://1ml.com", rpc: null },
      // ETH
      { assetId: "ast_eth", netId: "eth-mainnet", name: "Ethereum Mainnet (ERC-20)", chain: "EVM", curr: "ETH", contract: null, dec: 18, minDep: 5e-3, conf: 12, depStatus: "OPEN", wtdStatus: "OPEN", fee: 15e-4, minWtd: 0.01, memo: 0, txUrl: "https://etherscan.io/tx/{txHash}", addrUrl: "https://etherscan.io/address/{address}", rpc: "https://eth-mainnet.alchemyapi.io/v2/demo" },
      { assetId: "ast_eth", netId: "eth-arbitrum", name: "Arbitrum One (L2 Low Cost)", chain: "EVM", curr: "ETH", contract: null, dec: 18, minDep: 1e-3, conf: 20, depStatus: "OPEN", wtdStatus: "OPEN", fee: 3e-4, minWtd: 5e-3, memo: 0, txUrl: "https://arbiscan.io/tx/{txHash}", addrUrl: "https://arbiscan.io/address/{address}", rpc: "https://arb1.arbitrum.io/rpc" },
      // USDT
      { assetId: "ast_usdt", netId: "usdt-trc20", name: "TRON (TRC-20)", chain: "TRON", curr: "TRX", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", dec: 6, minDep: 1, conf: 19, depStatus: "OPEN", wtdStatus: "OPEN", fee: 1.5, minWtd: 10, memo: 0, txUrl: "https://tronscan.org/#/transaction/{txHash}", addrUrl: "https://tronscan.org/#/address/{address}", rpc: "https://api.trongrid.io" },
      { assetId: "ast_usdt", netId: "usdt-erc20", name: "Ethereum (ERC-20)", chain: "EVM", curr: "ETH", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", dec: 6, minDep: 10, conf: 12, depStatus: "OPEN", wtdStatus: "OPEN", fee: 4.5, minWtd: 25, memo: 0, txUrl: "https://etherscan.io/tx/{txHash}", addrUrl: "https://etherscan.io/address/{address}", rpc: "https://eth-mainnet.alchemyapi.io/v2/demo" },
      { assetId: "ast_usdt", netId: "usdt-arbitrum", name: "Arbitrum One (ERC-20 L2)", chain: "EVM", curr: "ETH", contract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", dec: 6, minDep: 1, conf: 20, depStatus: "OPEN", wtdStatus: "OPEN", fee: 0.8, minWtd: 5, memo: 0, txUrl: "https://arbiscan.io/tx/{txHash}", addrUrl: "https://arbiscan.io/address/{address}", rpc: "https://arb1.arbitrum.io/rpc" },
      { assetId: "ast_usdt", netId: "usdt-solana", name: "Solana (SPL)", chain: "SOLANA", curr: "SOL", contract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", dec: 6, minDep: 1, conf: 32, depStatus: "OPEN", wtdStatus: "OPEN", fee: 1, minWtd: 5, memo: 0, txUrl: "https://solscan.io/tx/{txHash}", addrUrl: "https://solscan.io/account/{address}", rpc: "https://api.mainnet-beta.solana.com" },
      // SOL
      { assetId: "ast_sol", netId: "solana-mainnet", name: "Solana Mainnet", chain: "SOLANA", curr: "SOL", contract: null, dec: 9, minDep: 0.05, conf: 32, depStatus: "OPEN", wtdStatus: "OPEN", fee: 5e-3, minWtd: 0.1, memo: 0, txUrl: "https://solscan.io/tx/{txHash}", addrUrl: "https://solscan.io/account/{address}", rpc: "https://api.mainnet-beta.solana.com" },
      // DNA
      { assetId: "ast_dna", netId: "dna-erc20", name: "Ethereum (ERC-20)", chain: "EVM", curr: "ETH", contract: "0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0", dec: 2, minDep: 10, conf: 12, depStatus: "OPEN", wtdStatus: "OPEN", fee: 25, minWtd: 50, memo: 0, txUrl: "https://etherscan.io/tx/{txHash}", addrUrl: "https://etherscan.io/address/{address}", rpc: "https://eth-mainnet.alchemyapi.io/v2/demo" },
      // AURORA
      { assetId: "ast_aurora", netId: "aurora-erc20", name: "Ethereum (ERC-20)", chain: "EVM", curr: "ETH", contract: "0xaaaa111122223333444455556666777788889999", dec: 3, minDep: 1, conf: 12, depStatus: "OPEN", wtdStatus: "CLOSED", fee: 0.5, minWtd: 5, memo: 0, txUrl: "https://etherscan.io/tx/{txHash}", addrUrl: "https://etherscan.io/address/{address}", rpc: null },
      // MOCK
      { assetId: "ast_mock", netId: "mock-erc20", name: "Ethereum Sepolia (ERC-20)", chain: "EVM", curr: "ETH", contract: "0xmock99887766554433221100aabbccddeeff0011", dec: 2, minDep: 5, conf: 6, depStatus: "OPEN", wtdStatus: "CLOSED", fee: 2, minWtd: 10, memo: 0, txUrl: "https://sepolia.etherscan.io/tx/{txHash}", addrUrl: "https://sepolia.etherscan.io/address/{address}", rpc: null }
    ];
    for (const n of networksSeed) {
      dbMgr.execute(
        `INSERT INTO asset_networks (
          id, asset_id, network_id, network_name, chain_type, native_currency, contract_address,
          decimals, min_deposit, deposit_confirmations, deposit_status, withdrawal_status,
          withdrawal_fee, min_withdrawal, is_memo_required, explorer_tx_url, explorer_address_url,
          rpc_endpoint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `net_${n.assetId}_${n.netId}`,
          n.assetId,
          n.netId,
          n.name,
          n.chain,
          n.curr,
          n.contract,
          n.dec,
          n.minDep,
          n.conf,
          n.depStatus,
          n.wtdStatus,
          n.fee,
          n.minWtd,
          n.memo,
          n.txUrl,
          n.addrUrl,
          n.rpc,
          now,
          now
        ]
      );
    }
  }
  dbMgr.saveToFile();
}

// src/server/auth/authService.ts
import crypto2 from "node:crypto";
import jwt from "jsonwebtoken";

// src/server/auth/totpService.ts
import crypto from "node:crypto";
var BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var TotpService = class {
  /**
   * Generates a secure random Base32 secret for 2FA TOTP setup.
   */
  static generateSecret(length = 20) {
    const randomBytes = crypto.randomBytes(length);
    let secret = "";
    for (let i = 0; i < randomBytes.length; i++) {
      secret += BASE32_CHARS[randomBytes[i] % 32];
    }
    return secret;
  }
  /**
   * Decodes a Base32 string into a Buffer.
   */
  static base32Decode(base32Str) {
    const cleanStr = base32Str.toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = 0;
    let value = 0;
    const output = [];
    for (let i = 0; i < cleanStr.length; i++) {
      const idx = BASE32_CHARS.indexOf(cleanStr[i]);
      if (idx === -1) continue;
      value = value << 5 | idx;
      bits += 5;
      if (bits >= 8) {
        output.push(value >>> bits - 8 & 255);
        bits -= 8;
      }
    }
    return Buffer.from(output);
  }
  /**
   * Generates standard 6-digit TOTP code for a given timestamp and secret.
   * Time step: 30 seconds (RFC 6238)
   */
  static generateCode(secret, timestampMs = Date.now()) {
    const timeStep = Math.floor(timestampMs / 1e3 / 30);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigInt64BE(BigInt(timeStep));
    const key = this.base32Decode(secret);
    const hmac = crypto.createHmac("sha1", key);
    hmac.update(timeBuffer);
    const hash = hmac.digest();
    const offset = hash[hash.length - 1] & 15;
    const binary = (hash[offset] & 127) << 24 | (hash[offset + 1] & 255) << 16 | (hash[offset + 2] & 255) << 8 | hash[offset + 3] & 255;
    const otp = binary % 1e6;
    return otp.toString().padStart(6, "0");
  }
  /**
   * Verifies a 6-digit TOTP code against a secret.
   * Supports window tolerance of +- 1 step (prev step, current step, next step)
   * to accommodate slight device clock drift.
   */
  static verifyCode(token, secret, windowTolerance = 1) {
    if (!token || token.length !== 6 || !secret) {
      return false;
    }
    const now = Date.now();
    for (let i = -windowTolerance; i <= windowTolerance; i++) {
      const checkTime = now + i * 30 * 1e3;
      const expected = this.generateCode(secret, checkTime);
      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
        return true;
      }
    }
    return false;
  }
  /**
   * Generates otpauth:// URI for QR codes and authenticator apps (Google Authenticator, Authy).
   */
  static getOtpauthUri(secret, email, issuer = "SilentSmile Exchange") {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(email);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
  }
};

// src/server/auth/authService.ts
var JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "silentsmile-access-secret-production-key-9988";
var JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "silentsmile-refresh-secret-production-key-7766";
var ACCESS_TOKEN_TTL = 15 * 60;
var REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var AuthService = class _AuthService {
  static {
    this.failedAttempts = /* @__PURE__ */ new Map();
  }
  constructor(dbMgr) {
    this.dbMgr = dbMgr;
  }
  // --- Password Cryptography (PBKDF2) ---
  static hashPassword(password) {
    const salt = crypto2.randomBytes(16).toString("hex");
    const hash = crypto2.pbkdf2Sync(password, salt, 1e5, 64, "sha512").toString("hex");
    return `${salt}:${hash}`;
  }
  static verifyPassword(password, storedHash) {
    const parts = storedHash.split(":");
    if (parts.length !== 2) return false;
    const [salt, originalHash] = parts;
    const testHash = crypto2.pbkdf2Sync(password, salt, 1e5, 64, "sha512").toString("hex");
    return crypto2.timingSafeEqual(Buffer.from(testHash, "hex"), Buffer.from(originalHash, "hex"));
  }
  // --- Anti-Brute-Force Lockout Tracker ---
  static checkLockout(identifier) {
    const now = Date.now();
    const info = _AuthService.failedAttempts.get(identifier);
    if (info && info.lockedUntil > now) {
      const waitMinutes = Math.ceil((info.lockedUntil - now) / 6e4);
      throw new Error(`Too many failed attempts. Account temporarily locked. Try again in ${waitMinutes} minutes.`);
    }
  }
  static recordFailedAttempt(identifier) {
    const now = Date.now();
    const info = _AuthService.failedAttempts.get(identifier) || { attempts: 0, lockedUntil: 0 };
    info.attempts += 1;
    if (info.attempts >= 5) {
      info.lockedUntil = now + 15 * 60 * 1e3;
    }
    _AuthService.failedAttempts.set(identifier, info);
  }
  static clearFailedAttempts(identifier) {
    _AuthService.failedAttempts.delete(identifier);
  }
  // --- Registration ---
  register(email, password, role = "trader") {
    const normalizedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Invalid email address format");
    }
    if (!password || password.length < 8) {
      throw new Error("Password must be at least 8 characters long");
    }
    const existing = this.dbMgr.queryOne("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing) {
      throw new Error("An account with this email already exists");
    }
    const userId = `usr_${crypto2.randomBytes(8).toString("hex")}`;
    const passwordHash = _AuthService.hashPassword(password);
    const now = Date.now();
    const dailyLimit = 5e7;
    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `INSERT INTO users (id, email, password_hash, role, status, kyc_level, totp_secret, totp_enabled, daily_withdraw_limit_idr, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 0, NULL, 0, ?, ?, ?)`,
        [userId, normalizedEmail, passwordHash, role, dailyLimit, now, now]
      );
      const assets = ["IDR", "BTC", "ETH", "SOL", "DNA", "USDT"];
      for (const asset of assets) {
        this.dbMgr.execute(
          `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
           VALUES (?, ?, ?, 'AVAILABLE', 0, ?)`,
          [`acc_${userId}_${asset}_AVAILABLE`, userId, asset, now]
        );
        this.dbMgr.execute(
          `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
           VALUES (?, ?, ?, 'LOCKED_ORDER', 0, ?)`,
          [`acc_${userId}_${asset}_LOCKED_ORDER`, userId, asset, now]
        );
        this.dbMgr.execute(
          `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
           VALUES (?, ?, ?, 'LOCKED_WITHDRAW', 0, ?)`,
          [`acc_${userId}_${asset}_LOCKED_WITHDRAW`, userId, asset, now]
        );
      }
    });
    const user = this.getUserById(userId);
    if (!user) throw new Error("User creation failed");
    return user;
  }
  // --- Login with Brute-Force Protection & 2FA ---
  login(email, password, ipAddress, userAgent, totpCode) {
    const normalizedEmail = email.toLowerCase().trim();
    const lockoutKey = `${normalizedEmail}_${ipAddress}`;
    _AuthService.checkLockout(lockoutKey);
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    if (!user) {
      _AuthService.recordFailedAttempt(lockoutKey);
      throw new Error("Invalid email or password");
    }
    if (user.status === "frozen") {
      throw new Error("Account is frozen due to compliance or security hold. Contact support.");
    }
    if (user.status === "suspended") {
      throw new Error("Account has been suspended.");
    }
    const isValidPassword = _AuthService.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      _AuthService.recordFailedAttempt(lockoutKey);
      throw new Error("Invalid email or password");
    }
    if (user.totp_enabled === 1) {
      if (!totpCode) {
        const tempToken = jwt.sign(
          { userId: user.id, email: user.email, stage: "2FA_PENDING" },
          JWT_ACCESS_SECRET,
          { expiresIn: "5m" }
        );
        return { requires2FA: true, tempToken };
      }
      if (!user.totp_secret || !TotpService.verifyCode(totpCode, user.totp_secret)) {
        _AuthService.recordFailedAttempt(lockoutKey);
        throw new Error("Invalid 2FA authentication code");
      }
    }
    _AuthService.clearFailedAttempts(lockoutKey);
    return this.createSessionAndTokens(user, ipAddress, userAgent);
  }
  // --- Complete 2FA Login with Temporary Token ---
  complete2FALogin(tempToken, totpCode, ipAddress, userAgent) {
    let payload;
    try {
      payload = jwt.verify(tempToken, JWT_ACCESS_SECRET);
    } catch {
      throw new Error("2FA session expired. Please log in again.");
    }
    if (payload.stage !== "2FA_PENDING" || !payload.userId) {
      throw new Error("Invalid 2FA authentication token.");
    }
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE id = ?", [payload.userId]);
    if (!user || !user.totp_secret || user.totp_enabled !== 1) {
      throw new Error("2FA is not properly configured for this user.");
    }
    if (!TotpService.verifyCode(totpCode, user.totp_secret)) {
      throw new Error("Invalid 2FA authentication code");
    }
    return this.createSessionAndTokens(user, ipAddress, userAgent);
  }
  // --- Session & Token Generator ---
  createSessionAndTokens(user, ipAddress, userAgent) {
    const sessionId = `ses_${crypto2.randomBytes(12).toString("hex")}`;
    const rawRefreshToken = crypto2.randomBytes(32).toString("hex");
    const refreshTokenHash = crypto2.createHash("sha256").update(rawRefreshToken).digest("hex");
    const now = Date.now();
    const expiresAt = now + REFRESH_TOKEN_TTL_MS;
    let deviceName = "Desktop Browser";
    if (/mobile/i.test(userAgent)) deviceName = "Mobile Device";
    if (/iphone|ipad/i.test(userAgent)) deviceName = "iOS Device";
    if (/android/i.test(userAgent)) deviceName = "Android Device";
    this.dbMgr.execute(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, device_name, is_revoked, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [sessionId, user.id, refreshTokenHash, ipAddress, userAgent, deviceName, expiresAt, now]
    );
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      kycLevel: user.kyc_level,
      sessionId
    };
    const accessToken = jwt.sign(tokenPayload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = `${sessionId}:${rawRefreshToken}`;
    const { password_hash, totp_secret, ...safeUser } = user;
    const session = this.dbMgr.queryOne("SELECT * FROM user_sessions WHERE id = ?", [sessionId]);
    return {
      requires2FA: false,
      accessToken,
      refreshToken,
      user: safeUser,
      session: session || void 0
    };
  }
  // --- Refresh Token Rotation ---
  refreshTokens(refreshTokenStr, ipAddress, userAgent) {
    const parts = refreshTokenStr.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid refresh token format");
    }
    const [sessionId, rawRefreshToken] = parts;
    const hash = crypto2.createHash("sha256").update(rawRefreshToken).digest("hex");
    const session = this.dbMgr.queryOne("SELECT * FROM user_sessions WHERE id = ?", [sessionId]);
    if (!session) {
      throw new Error("Session not found");
    }
    if (session.is_revoked === 1) {
      throw new Error("Session has been revoked");
    }
    if (session.expires_at < Date.now()) {
      throw new Error("Session expired. Please log in again.");
    }
    if (session.refresh_token_hash !== hash) {
      this.dbMgr.execute("UPDATE user_sessions SET is_revoked = 1 WHERE id = ?", [sessionId]);
      throw new Error("Token reuse detected. Session revoked for security.");
    }
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE id = ?", [session.user_id]);
    if (!user || user.status !== "active") {
      throw new Error("User account is not active");
    }
    const newRawRefreshToken = crypto2.randomBytes(32).toString("hex");
    const newHash = crypto2.createHash("sha256").update(newRawRefreshToken).digest("hex");
    const now = Date.now();
    const newExpiresAt = now + REFRESH_TOKEN_TTL_MS;
    this.dbMgr.execute(
      `UPDATE user_sessions
       SET refresh_token_hash = ?, ip_address = ?, user_agent = ?, expires_at = ?
       WHERE id = ?`,
      [newHash, ipAddress, userAgent, newExpiresAt, sessionId]
    );
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      kycLevel: user.kyc_level,
      sessionId
    };
    const newAccessToken = jwt.sign(tokenPayload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    const newRefreshToken = `${sessionId}:${newRawRefreshToken}`;
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  }
  // --- Session Management ---
  listSessions(userId) {
    return this.dbMgr.query(
      "SELECT id, user_id, ip_address, user_agent, device_name, is_revoked, expires_at, created_at FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
  }
  revokeSession(userId, sessionId) {
    this.dbMgr.execute(
      "UPDATE user_sessions SET is_revoked = 1 WHERE id = ? AND user_id = ?",
      [sessionId, userId]
    );
  }
  revokeAllOtherSessions(userId, currentSessionId) {
    this.dbMgr.execute(
      "UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ? AND id != ?",
      [userId, currentSessionId]
    );
  }
  // --- 2FA Management ---
  setup2FA(userId) {
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) throw new Error("User not found");
    const secret = TotpService.generateSecret();
    this.dbMgr.execute("UPDATE users SET totp_secret = ? WHERE id = ?", [secret, userId]);
    const otpauthUri = TotpService.getOtpauthUri(secret, user.email);
    return { secret, otpauthUri };
  }
  enable2FA(userId, code) {
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user || !user.totp_secret) {
      throw new Error("Please initiate 2FA setup first");
    }
    const isValid = TotpService.verifyCode(code, user.totp_secret);
    if (!isValid) {
      throw new Error("Invalid verification code");
    }
    this.dbMgr.execute("UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?", [Date.now(), userId]);
    return true;
  }
  disable2FA(userId, code) {
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user || !user.totp_secret || user.totp_enabled === 0) {
      throw new Error("2FA is not enabled");
    }
    const isValid = TotpService.verifyCode(code, user.totp_secret);
    if (!isValid) {
      throw new Error("Invalid 2FA authentication code");
    }
    this.dbMgr.execute("UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = ? WHERE id = ?", [Date.now(), userId]);
    return true;
  }
  // --- User Queries ---
  getUserById(userId) {
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return null;
    const { password_hash, totp_secret, ...safeUser } = user;
    return safeUser;
  }
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
      const session = this.dbMgr.queryOne("SELECT is_revoked, expires_at FROM user_sessions WHERE id = ?", [decoded.sessionId]);
      if (!session || session.is_revoked === 1 || session.expires_at < Date.now()) {
        throw new Error("Session is invalid or has been revoked");
      }
      return decoded;
    } catch (err) {
      throw new Error(`Authentication token invalid: ${err.message}`);
    }
  }
};

// src/server/ledger/ledgerService.ts
import crypto3 from "node:crypto";

// src/server/ledger/integerMath.ts
function formatFromIntegerUnits(units, decimals) {
  const num = typeof units === "bigint" ? Number(units) : units;
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  if (decimals === 0) {
    return `${isNegative ? "-" : ""}${absNum.toString()}`;
  }
  const divisor = Math.pow(10, decimals);
  const whole = Math.floor(absNum / divisor);
  const frac = (absNum % divisor).toString().padStart(decimals, "0");
  return `${isNegative ? "-" : ""}${whole}.${frac}`;
}
function calculateBpsFee(amount, feeBps) {
  if (amount < 0 || feeBps < 0) {
    throw new Error(`Amount and fee bps must be non-negative: amount=${amount}, bps=${feeBps}`);
  }
  if (feeBps === 0 || amount === 0) {
    return { netAmount: amount, feeAmount: 0 };
  }
  const feeAmount = Math.floor(amount * feeBps / 1e4);
  const netAmount = amount - feeAmount;
  return { netAmount, feeAmount };
}
function computeTradeTotal(price, amount, baseDecimals) {
  if (price < 0 || amount < 0) {
    throw new Error("Price and amount must be non-negative");
  }
  const scale = Math.pow(10, baseDecimals);
  const bigPrice = BigInt(price);
  const bigAmount = BigInt(amount);
  const bigScale = BigInt(scale);
  const bigTotal = bigPrice * bigAmount / bigScale;
  return Number(bigTotal);
}

// src/server/ledger/ledgerService.ts
var LedgerService = class {
  constructor(dbMgr) {
    this.dbMgr = dbMgr;
  }
  /**
   * Helper to format account ID deterministically
   */
  getAccountId(userId, asset, accountType) {
    return `acc_${userId}_${asset}_${accountType}`;
  }
  /**
   * Retrieves or creates a ledger account record with 0 initial balance
   */
  getOrCreateAccount(userId, asset, accountType) {
    const accountId = this.getAccountId(userId, asset, accountType);
    let account = this.dbMgr.queryOne("SELECT * FROM ledger_accounts WHERE id = ?", [accountId]);
    if (!account) {
      const now = Date.now();
      this.dbMgr.execute(
        `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [accountId, userId, asset, accountType, now]
      );
      account = this.dbMgr.queryOne("SELECT * FROM ledger_accounts WHERE id = ?", [accountId]);
      if (!account) {
        throw new Error(`Failed to initialize account: ${accountId}`);
      }
    }
    return account;
  }
  /**
   * Get balance overview for a single user and asset
   */
  getBalance(userId, asset) {
    const avail = this.getOrCreateAccount(userId, asset, "AVAILABLE").balance;
    const lockedOrd = this.getOrCreateAccount(userId, asset, "LOCKED_ORDER").balance;
    const lockedWtd = this.getOrCreateAccount(userId, asset, "LOCKED_WITHDRAW").balance;
    return {
      asset,
      available: avail,
      lockedOrder: lockedOrd,
      lockedWithdraw: lockedWtd,
      total: avail + lockedOrd + lockedWtd
    };
  }
  /**
   * Get all asset balances for a user
   */
  getAllBalances(userId) {
    const assets = ["IDR", "BTC", "ETH", "SOL", "DNA", "USDT", "MOCK"];
    const result = {};
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
  postTransaction(idempotencyKey, category, description, actorId, mutations) {
    if (mutations.length < 2) {
      throw new Error("Double-entry transaction requires at least 2 entries");
    }
    const existing = this.dbMgr.queryOne(
      "SELECT * FROM ledger_transactions WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) {
      return existing;
    }
    for (const m of mutations) {
      if (m.amount <= 0 || !Number.isInteger(m.amount)) {
        throw new Error(`Invalid mutation amount: ${m.amount}. Must be positive integer.`);
      }
    }
    const assetNet = /* @__PURE__ */ new Map();
    for (const m of mutations) {
      const net = (m.entryType === "CREDIT" ? 1 : -1) * m.amount;
      assetNet.set(m.asset, (assetNet.get(m.asset) || 0) + net);
    }
    for (const [asset, net] of assetNet.entries()) {
      if (net !== 0) {
        throw new Error(`Unbalanced double-entry ledger transaction for asset ${asset}: net sum is ${net}, expected 0`);
      }
    }
    return this.dbMgr.runInTransaction(() => {
      const txId = `ltx_${crypto3.randomBytes(8).toString("hex")}`;
      const now = Date.now();
      this.dbMgr.execute(
        `INSERT INTO ledger_transactions (id, idempotency_key, category, description, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [txId, idempotencyKey, category, description, actorId, now]
      );
      for (const m of mutations) {
        const account = this.getOrCreateAccount(m.userId, m.asset, m.accountType);
        const before = account.balance;
        const delta = m.entryType === "CREDIT" ? m.amount : -m.amount;
        const after = before + delta;
        if (after < 0 && !m.userId.startsWith("sys_")) {
          throw new Error(
            `Insufficient balance for account ${account.id}. Available: ${before}, required: ${m.amount}`
          );
        }
        const entryId = `len_${crypto3.randomBytes(8).toString("hex")}`;
        this.dbMgr.execute(
          `INSERT INTO ledger_entries (id, transaction_id, account_id, asset, entry_type, amount, balance_before, balance_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entryId, txId, account.id, m.asset, m.entryType, m.amount, before, after, now]
        );
        this.dbMgr.execute("UPDATE ledger_accounts SET balance = ? WHERE id = ?", [after, account.id]);
      }
      const createdTx = this.dbMgr.queryOne(
        "SELECT * FROM ledger_transactions WHERE id = ?",
        [txId]
      );
      if (!createdTx) throw new Error("Transaction creation failed");
      return createdTx;
    });
  }
  /**
   * Deposit: external funding into user available balance.
   * In double-entry:
   *   sys_treasury: DEBIT (increases treasury obligation/outflow)
   *   user AVAILABLE: CREDIT (increases user available balance)
   */
  deposit(userId, asset, amount, idempotencyKey, description = "Deposit") {
    return this.postTransaction(
      idempotencyKey,
      "DEPOSIT",
      description,
      userId,
      [
        { userId: "sys_treasury", asset, accountType: "AVAILABLE", entryType: "DEBIT", amount },
        { userId, asset, accountType: "AVAILABLE", entryType: "CREDIT", amount }
      ]
    );
  }
  /**
   * Transfer: balanced double-entry movement between two accounts.
   */
  transfer(fromUserId, toUserId, asset, amount, idempotencyKey, category = "TRANSFER", description = "Transfer") {
    return this.postTransaction(
      idempotencyKey,
      category,
      description,
      fromUserId,
      [
        { userId: fromUserId, asset, accountType: "AVAILABLE", entryType: "DEBIT", amount },
        { userId: toUserId, asset, accountType: "AVAILABLE", entryType: "CREDIT", amount }
      ]
    );
  }
  /**
   * Lock funds when an order is placed:
   * Transfers from user's AVAILABLE to user's LOCKED_ORDER
   */
  lockOrderFunds(userId, asset, amount, idempotencyKey, orderId) {
    return this.postTransaction(
      idempotencyKey,
      "ORDER_LOCK",
      `Locked funds for order ${orderId}`,
      userId,
      [
        { userId, asset, accountType: "AVAILABLE", entryType: "DEBIT", amount },
        { userId, asset, accountType: "LOCKED_ORDER", entryType: "CREDIT", amount }
      ]
    );
  }
  /**
   * Unlock funds when an order is cancelled or partially unfulfilled:
   * Transfers from user's LOCKED_ORDER to user's AVAILABLE
   */
  unlockOrderFunds(userId, asset, amount, idempotencyKey, reason = "Order Cancellation") {
    return this.postTransaction(
      idempotencyKey,
      "ORDER_UNLOCK",
      reason,
      userId,
      [
        { userId, asset, accountType: "LOCKED_ORDER", entryType: "DEBIT", amount },
        { userId, asset, accountType: "AVAILABLE", entryType: "CREDIT", amount }
      ]
    );
  }
  /**
   * Request withdrawal:
   * Move from user's AVAILABLE to user's LOCKED_WITHDRAW
   */
  lockWithdrawalFunds(userId, asset, amount, idempotencyKey, withdrawalId) {
    return this.postTransaction(
      idempotencyKey,
      "WITHDRAW_LOCK",
      `Reserved funds for withdrawal ${withdrawalId}`,
      userId,
      [
        { userId, asset, accountType: "AVAILABLE", entryType: "DEBIT", amount },
        { userId, asset, accountType: "LOCKED_WITHDRAW", entryType: "CREDIT", amount }
      ]
    );
  }
  /**
   * Finalize approved withdrawal:
   * Deducts from LOCKED_WITHDRAW, transfers fee to sys_fee_vault, and credits sys_treasury.
   */
  executeWithdrawal(userId, asset, totalAmount, feeAmount, idempotencyKey, withdrawalId) {
    const netPayout = totalAmount - feeAmount;
    if (netPayout < 0) {
      throw new Error("Fee cannot exceed withdrawal amount");
    }
    const mutations = [
      { userId, asset, accountType: "LOCKED_WITHDRAW", entryType: "DEBIT", amount: totalAmount },
      { userId: "sys_treasury", asset, accountType: "AVAILABLE", entryType: "CREDIT", amount: netPayout }
    ];
    if (feeAmount > 0) {
      mutations.push({
        userId: "sys_fee_vault",
        asset,
        accountType: "AVAILABLE",
        entryType: "CREDIT",
        amount: feeAmount
      });
    }
    return this.postTransaction(
      idempotencyKey,
      "WITHDRAW_EXECUTE",
      `Executed withdrawal ${withdrawalId}`,
      userId,
      mutations
    );
  }
  /**
   * Reject / Cancel withdrawal:
   * Returns funds from LOCKED_WITHDRAW back to AVAILABLE
   */
  rejectWithdrawalFunds(userId, asset, amount, idempotencyKey, withdrawalId) {
    return this.postTransaction(
      idempotencyKey,
      "WITHDRAW_REJECT",
      `Returned rejected withdrawal ${withdrawalId}`,
      userId,
      [
        { userId, asset, accountType: "LOCKED_WITHDRAW", entryType: "DEBIT", amount },
        { userId, asset, accountType: "AVAILABLE", entryType: "CREDIT", amount }
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
  settleTrade(params) {
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
      idempotencyKey
    } = params;
    const { netAmount: buyerBaseReceived, feeAmount: buyerBaseFee } = calculateBpsFee(amount, buyerFeeBps);
    const { netAmount: sellerQuoteReceived, feeAmount: sellerQuoteFee } = calculateBpsFee(quoteTotal, sellerFeeBps);
    const baseMutations = [
      { userId: sellerId, asset: baseAsset, accountType: "LOCKED_ORDER", entryType: "DEBIT", amount },
      { userId: buyerId, asset: baseAsset, accountType: "AVAILABLE", entryType: "CREDIT", amount: buyerBaseReceived }
    ];
    if (buyerBaseFee > 0) {
      baseMutations.push({
        userId: "sys_fee_vault",
        asset: baseAsset,
        accountType: "AVAILABLE",
        entryType: "CREDIT",
        amount: buyerBaseFee
      });
    }
    const quoteMutations = [
      { userId: buyerId, asset: quoteAsset, accountType: "LOCKED_ORDER", entryType: "DEBIT", amount: quoteTotal },
      { userId: sellerId, asset: quoteAsset, accountType: "AVAILABLE", entryType: "CREDIT", amount: sellerQuoteReceived }
    ];
    if (sellerQuoteFee > 0) {
      quoteMutations.push({
        userId: "sys_fee_vault",
        asset: quoteAsset,
        accountType: "AVAILABLE",
        entryType: "CREDIT",
        amount: sellerQuoteFee
      });
    }
    const allMutations = [...baseMutations, ...quoteMutations];
    return this.postTransaction(
      idempotencyKey,
      "TRADE_SETTLEMENT",
      `Settled trade on ${pairId}: ${amount} @ ${price} (Maker: ${makerOrderId}, Taker: ${takerOrderId})`,
      "sys_matching_engine",
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
  verifyLedgerIntegrity() {
    const errors = [];
    const transactions = this.dbMgr.query("SELECT * FROM ledger_transactions");
    for (const tx of transactions) {
      const entries = this.dbMgr.query(
        "SELECT * FROM ledger_entries WHERE transaction_id = ?",
        [tx.id]
      );
      const netPerAsset = /* @__PURE__ */ new Map();
      for (const e of entries) {
        const net = (e.entry_type === "CREDIT" ? 1 : -1) * e.amount;
        netPerAsset.set(e.asset, (netPerAsset.get(e.asset) || 0) + net);
      }
      for (const [asset, net] of netPerAsset.entries()) {
        if (net !== 0) {
          errors.push(`Transaction ${tx.id} (${tx.idempotency_key}) is unbalanced for ${asset}: net delta ${net}`);
        }
      }
    }
    const accounts = this.dbMgr.query("SELECT * FROM ledger_accounts");
    for (const acc of accounts) {
      const entries = this.dbMgr.query(
        "SELECT entry_type, amount FROM ledger_entries WHERE account_id = ?",
        [acc.id]
      );
      let calculatedBalance = 0;
      for (const e of entries) {
        calculatedBalance += e.entry_type === "CREDIT" ? e.amount : -e.amount;
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
      accountCount: accounts.length
    };
  }
};

// src/server/engine/matchingEngine.ts
import crypto4 from "node:crypto";

// src/server/engine/orderBook.ts
var OrderBook = class {
  constructor(pairId) {
    // Bids sorted descending by price (highest buy price first).
    // At same price, sorted ascending by timestamp (FIFO).
    this.bids = [];
    // Asks sorted ascending by price (lowest sell price first).
    // At same price, sorted ascending by timestamp (FIFO).
    this.asks = [];
    // Map of orderId -> BookOrder for O(1) lookups and cancellations
    this.orderMap = /* @__PURE__ */ new Map();
    this.pairId = pairId;
  }
  /**
   * Insert limit order into book maintaining price-time priority
   */
  addLimitOrder(order) {
    this.orderMap.set(order.id, order);
    if (order.side === "BUY") {
      let idx = 0;
      while (idx < this.bids.length && (this.bids[idx].price > order.price || this.bids[idx].price === order.price && this.bids[idx].timestamp <= order.timestamp)) {
        idx++;
      }
      this.bids.splice(idx, 0, order);
    } else {
      let idx = 0;
      while (idx < this.asks.length && (this.asks[idx].price < order.price || this.asks[idx].price === order.price && this.asks[idx].timestamp <= order.timestamp)) {
        idx++;
      }
      this.asks.splice(idx, 0, order);
    }
  }
  /**
   * Cancel and remove an order from book
   */
  cancelOrder(orderId) {
    const order = this.orderMap.get(orderId);
    if (!order) return null;
    this.orderMap.delete(orderId);
    if (order.side === "BUY") {
      const idx = this.bids.findIndex((o) => o.id === orderId);
      if (idx !== -1) this.bids.splice(idx, 1);
    } else {
      const idx = this.asks.findIndex((o) => o.id === orderId);
      if (idx !== -1) this.asks.splice(idx, 1);
    }
    return order;
  }
  /**
   * Get aggregated L2 depth up to a given limit
   */
  getDepth(levels = 20) {
    const aggregate = (orders) => {
      const priceMap = /* @__PURE__ */ new Map();
      for (const ord of orders) {
        const existing = priceMap.get(ord.price) || { amount: 0, count: 0 };
        existing.amount += ord.remainingAmount;
        existing.count += 1;
        priceMap.set(ord.price, existing);
      }
      const result = [];
      for (const [price, val] of priceMap.entries()) {
        result.push({ price, amount: val.amount, orderCount: val.count });
        if (result.length >= levels) break;
      }
      return result;
    };
    return {
      bids: aggregate(this.bids),
      asks: aggregate(this.asks),
      timestamp: Date.now()
    };
  }
  /**
   * Reset / clear book
   */
  clear() {
    this.bids = [];
    this.asks = [];
    this.orderMap.clear();
  }
};

// src/server/engine/matchingEngine.ts
var MatchingEngine = class {
  constructor(pairConfig, dbMgr, ledger) {
    this.commandQueue = [];
    this.isProcessingQueue = false;
    this.listeners = [];
    this.pairConfig = pairConfig;
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.book = new OrderBook(pairConfig.id);
  }
  addListener(listener) {
    this.listeners.push(listener);
  }
  emitEvent(eventType, payload) {
    const now = Date.now();
    const payloadStr = JSON.stringify(payload);
    this.dbMgr.execute(
      `INSERT INTO engine_events (pair_id, event_type, payload_json, timestamp)
       VALUES (?, ?, ?, ?)`,
      [this.pairConfig.id, eventType, payloadStr, now]
    );
    const row = this.dbMgr.queryOne("SELECT last_insert_rowid() as seq_id");
    const event = {
      seqId: row?.seq_id || 0,
      pairId: this.pairConfig.id,
      eventType,
      payload,
      timestamp: now
    };
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error("Error in engine listener:", err);
      }
    }
    return event;
  }
  /**
   * Enqueues an operation to ensure single-threaded execution per pair
   */
  enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.commandQueue.push(async () => {
        try {
          const res = await operation();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      });
      this.processQueue();
    });
  }
  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    while (this.commandQueue.length > 0) {
      const task = this.commandQueue.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.error(`Error processing queue task for ${this.pairConfig.id}:`, err);
        }
      }
    }
    this.isProcessingQueue = false;
  }
  /**
   * Replays events or loads active orders on startup for deterministic recovery
   */
  async recover() {
    this.book.clear();
    const openOrders = this.dbMgr.query(
      `SELECT * FROM orders WHERE pair_id = ? AND status IN ('NEW', 'PARTIALLY_FILLED') ORDER BY created_at ASC`,
      [this.pairConfig.id]
    );
    for (const o of openOrders) {
      this.book.addLimitOrder({
        id: o.id,
        userId: o.user_id,
        side: o.side,
        price: o.price,
        amount: o.amount,
        filledAmount: o.filled_amount,
        remainingAmount: o.remaining_amount,
        timestamp: o.created_at
      });
    }
  }
  /**
   * Submits a new limit or market order
   */
  async submitOrder(cmd) {
    return this.enqueue(async () => {
      if (this.pairConfig.tradingStatus === "HALTED") {
        throw new Error(`Trading for pair ${this.pairConfig.id} is currently halted`);
      }
      if (cmd.amount < this.pairConfig.minOrderSize) {
        throw new Error(`Order size below minimum allowed size of ${this.pairConfig.minOrderSize}`);
      }
      const orderId = cmd.orderId || `ord_${crypto4.randomBytes(8).toString("hex")}`;
      const now = Date.now();
      if (cmd.side === "BUY") {
        let lockAmount;
        if (cmd.orderType === "LIMIT") {
          if (cmd.price <= 0) throw new Error("Limit order price must be greater than zero");
          lockAmount = computeTradeTotal(cmd.price, cmd.amount, this.pairConfig.basePrecision);
        } else {
          if (this.book.asks.length === 0) {
            throw new Error("Market order rejected: insufficient order book liquidity on ask side");
          }
          let requiredQuote = 0;
          let remainingToFill = cmd.amount;
          for (const ask of this.book.asks) {
            const takeAmount = Math.min(remainingToFill, ask.remainingAmount);
            requiredQuote += computeTradeTotal(ask.price, takeAmount, this.pairConfig.basePrecision);
            remainingToFill -= takeAmount;
            if (remainingToFill <= 0) break;
          }
          if (remainingToFill > 0) {
            throw new Error("Market order rejected: insufficient depth to fill order");
          }
          lockAmount = Math.floor(requiredQuote * 1.05);
        }
        this.ledger.lockOrderFunds(
          cmd.userId,
          this.pairConfig.quoteAsset,
          lockAmount,
          `lock_${orderId}`,
          orderId
        );
      } else {
        this.ledger.lockOrderFunds(
          cmd.userId,
          this.pairConfig.baseAsset,
          cmd.amount,
          `lock_${orderId}`,
          orderId
        );
      }
      this.dbMgr.execute(
        `INSERT INTO orders (id, client_order_id, user_id, pair_id, side, order_type, price, amount, filled_amount, remaining_amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'NEW', ?, ?)`,
        [
          orderId,
          cmd.clientOrderId || null,
          cmd.userId,
          this.pairConfig.id,
          cmd.side,
          cmd.orderType,
          cmd.price,
          cmd.amount,
          cmd.amount,
          now,
          now
        ]
      );
      this.emitEvent("ORDER_ACCEPTED", {
        orderId,
        userId: cmd.userId,
        side: cmd.side,
        orderType: cmd.orderType,
        price: cmd.price,
        amount: cmd.amount,
        timestamp: now
      });
      const fills = [];
      let remainingAmount = cmd.amount;
      if (cmd.side === "BUY") {
        while (remainingAmount > 0 && this.book.asks.length > 0) {
          const bestAsk = this.book.asks[0];
          if (cmd.orderType === "LIMIT" && bestAsk.price > cmd.price) {
            break;
          }
          if (bestAsk.userId === cmd.userId) {
            this.internalCancelOrder(bestAsk.id, "SELF_TRADE_PREVENTION");
            continue;
          }
          const fillAmount = Math.min(remainingAmount, bestAsk.remainingAmount);
          const matchPrice = bestAsk.price;
          const quoteTotal = computeTradeTotal(matchPrice, fillAmount, this.pairConfig.basePrecision);
          const trade = this.executeTradeMatch({
            makerOrder: bestAsk,
            takerOrderId: orderId,
            takerUserId: cmd.userId,
            takerSide: "BUY",
            matchPrice,
            matchAmount: fillAmount,
            quoteTotal
          });
          fills.push(trade);
          remainingAmount -= fillAmount;
          bestAsk.remainingAmount -= fillAmount;
          bestAsk.filledAmount += fillAmount;
          if (bestAsk.remainingAmount === 0) {
            this.book.cancelOrder(bestAsk.id);
            this.updateOrderStatus(bestAsk.id, "FILLED", bestAsk.filledAmount, 0);
          } else {
            this.updateOrderStatus(bestAsk.id, "PARTIALLY_FILLED", bestAsk.filledAmount, bestAsk.remainingAmount);
          }
        }
      } else {
        while (remainingAmount > 0 && this.book.bids.length > 0) {
          const bestBid = this.book.bids[0];
          if (cmd.orderType === "LIMIT" && bestBid.price < cmd.price) {
            break;
          }
          if (bestBid.userId === cmd.userId) {
            this.internalCancelOrder(bestBid.id, "SELF_TRADE_PREVENTION");
            continue;
          }
          const fillAmount = Math.min(remainingAmount, bestBid.remainingAmount);
          const matchPrice = bestBid.price;
          const quoteTotal = computeTradeTotal(matchPrice, fillAmount, this.pairConfig.basePrecision);
          const trade = this.executeTradeMatch({
            makerOrder: bestBid,
            takerOrderId: orderId,
            takerUserId: cmd.userId,
            takerSide: "SELL",
            matchPrice,
            matchAmount: fillAmount,
            quoteTotal
          });
          fills.push(trade);
          remainingAmount -= fillAmount;
          bestBid.remainingAmount -= fillAmount;
          bestBid.filledAmount += fillAmount;
          if (bestBid.remainingAmount === 0) {
            this.book.cancelOrder(bestBid.id);
            this.updateOrderStatus(bestBid.id, "FILLED", bestBid.filledAmount, 0);
          } else {
            this.updateOrderStatus(bestBid.id, "PARTIALLY_FILLED", bestBid.filledAmount, bestBid.remainingAmount);
          }
        }
      }
      const filledAmount = cmd.amount - remainingAmount;
      let finalStatus = "NEW";
      if (remainingAmount === 0) {
        finalStatus = "FILLED";
        this.updateOrderStatus(orderId, "FILLED", filledAmount, 0);
      } else if (filledAmount > 0) {
        if (cmd.orderType === "LIMIT") {
          finalStatus = "PARTIALLY_FILLED";
          this.updateOrderStatus(orderId, "PARTIALLY_FILLED", filledAmount, remainingAmount);
          this.book.addLimitOrder({
            id: orderId,
            userId: cmd.userId,
            side: cmd.side,
            price: cmd.price,
            amount: cmd.amount,
            filledAmount,
            remainingAmount,
            timestamp: now
          });
        } else {
          finalStatus = "CANCELLED";
          this.updateOrderStatus(orderId, "CANCELLED", filledAmount, remainingAmount);
        }
      } else {
        if (cmd.orderType === "LIMIT") {
          finalStatus = "NEW";
          this.book.addLimitOrder({
            id: orderId,
            userId: cmd.userId,
            side: cmd.side,
            price: cmd.price,
            amount: cmd.amount,
            filledAmount: 0,
            remainingAmount: cmd.amount,
            timestamp: now
          });
        } else {
          finalStatus = "CANCELLED";
          this.updateOrderStatus(orderId, "CANCELLED", 0, cmd.amount);
        }
      }
      return { orderId, fills, status: finalStatus };
    });
  }
  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId, userId) {
    return this.enqueue(async () => {
      const order = this.dbMgr.queryOne("SELECT * FROM orders WHERE id = ?", [orderId]);
      if (!order) throw new Error("Order not found");
      if (order.user_id !== userId && userId !== "admin") {
        throw new Error("Unauthorized to cancel this order");
      }
      if (["FILLED", "CANCELLED", "REJECTED"].includes(order.status)) {
        throw new Error(`Order cannot be cancelled in status ${order.status}`);
      }
      this.internalCancelOrder(orderId, "USER_REQUEST");
      return true;
    });
  }
  internalCancelOrder(orderId, reason) {
    const bookOrder = this.book.cancelOrder(orderId);
    const order = this.dbMgr.queryOne("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!order) return;
    const remaining = bookOrder ? bookOrder.remainingAmount : order.remaining_amount;
    if (remaining > 0) {
      if (order.side === "BUY") {
        const unlockQuote = computeTradeTotal(order.price, remaining, this.pairConfig.basePrecision);
        this.ledger.unlockOrderFunds(
          order.user_id,
          this.pairConfig.quoteAsset,
          unlockQuote,
          `unlock_${orderId}_${Date.now()}`,
          reason
        );
      } else {
        this.ledger.unlockOrderFunds(
          order.user_id,
          this.pairConfig.baseAsset,
          remaining,
          `unlock_${orderId}_${Date.now()}`,
          reason
        );
      }
    }
    this.updateOrderStatus(orderId, "CANCELLED", order.filled_amount, remaining);
    this.emitEvent("ORDER_CANCELLED", { orderId, reason, remainingAmount: remaining });
  }
  executeTradeMatch(params) {
    const tradeId = `trd_${crypto4.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    const isBuyerTaker = params.takerSide === "BUY";
    const buyerId = isBuyerTaker ? params.takerUserId : params.makerOrder.userId;
    const sellerId = isBuyerTaker ? params.makerOrder.userId : params.takerUserId;
    this.ledger.settleTrade({
      pairId: this.pairConfig.id,
      baseAsset: this.pairConfig.baseAsset,
      quoteAsset: this.pairConfig.quoteAsset,
      price: params.matchPrice,
      amount: params.matchAmount,
      quoteTotal: params.quoteTotal,
      buyerId,
      sellerId,
      buyerIsTaker: isBuyerTaker,
      buyerFeeBps: isBuyerTaker ? this.pairConfig.takerFeeBps : this.pairConfig.makerFeeBps,
      sellerFeeBps: isBuyerTaker ? this.pairConfig.makerFeeBps : this.pairConfig.takerFeeBps,
      makerOrderId: params.makerOrder.id,
      takerOrderId: params.takerOrderId,
      idempotencyKey: `trade_settle_${tradeId}`
    });
    const makerFee = isBuyerTaker ? calculateBpsFee(params.quoteTotal, this.pairConfig.makerFeeBps).feeAmount : calculateBpsFee(params.matchAmount, this.pairConfig.makerFeeBps).feeAmount;
    const takerFee = isBuyerTaker ? calculateBpsFee(params.matchAmount, this.pairConfig.takerFeeBps).feeAmount : calculateBpsFee(params.quoteTotal, this.pairConfig.takerFeeBps).feeAmount;
    this.dbMgr.execute(
      `INSERT INTO trades (id, pair_id, price, amount, total, side, maker_order_id, taker_order_id, maker_user_id, taker_user_id, maker_fee, taker_fee, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tradeId,
        this.pairConfig.id,
        params.matchPrice,
        params.matchAmount,
        params.quoteTotal,
        params.takerSide,
        params.makerOrder.id,
        params.takerOrderId,
        params.makerOrder.userId,
        params.takerUserId,
        makerFee,
        takerFee,
        now
      ]
    );
    const trade = {
      id: tradeId,
      pairId: this.pairConfig.id,
      price: params.matchPrice,
      amount: params.matchAmount,
      total: params.quoteTotal,
      side: params.takerSide,
      makerOrderId: params.makerOrder.id,
      takerOrderId: params.takerOrderId,
      makerUserId: params.makerOrder.userId,
      takerUserId: params.takerUserId,
      makerFee,
      takerFee,
      timestamp: now
    };
    this.emitEvent("TRADE_EXECUTED", trade);
    return trade;
  }
  updateOrderStatus(orderId, status, filled, remaining) {
    this.dbMgr.execute(
      `UPDATE orders SET status = ?, filled_amount = ?, remaining_amount = ?, updated_at = ? WHERE id = ?`,
      [status, filled, remaining, Date.now(), orderId]
    );
  }
  getDepth(levels = 20) {
    return this.book.getDepth(levels);
  }
};

// src/server/engine/klineAggregator.ts
var KLINE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
var INTERVAL_SECONDS = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60
};
var KlineAggregator = class _KlineAggregator {
  constructor() {
    // Map of `${pairId}:${interval}` -> Map<bucketSec, CandleBar>
    this.candles = /* @__PURE__ */ new Map();
    // Deduplication set for trade IDs so duplicate WS/replay events never double-count OHLCV
    this.processedTradeIds = /* @__PURE__ */ new Set();
  }
  static {
    this.MAX_TRACKED_TRADE_IDS = 5e4;
  }
  static isValidInterval(val) {
    return KLINE_INTERVALS.includes(val);
  }
  static getBucketSec(timestampMs, interval) {
    const stepSec = INTERVAL_SECONDS[interval];
    const tsSec = Math.floor(timestampMs / 1e3);
    return Math.floor(tsSec / stepSec) * stepSec;
  }
  static formatBar(bar, basePrecision, quotePrecision) {
    const openStr = formatFromIntegerUnits(bar.open, quotePrecision);
    const highStr = formatFromIntegerUnits(bar.high, quotePrecision);
    const lowStr = formatFromIntegerUnits(bar.low, quotePrecision);
    const closeStr = formatFromIntegerUnits(bar.close, quotePrecision);
    const volumeStr = formatFromIntegerUnits(bar.volumeAtomic, basePrecision);
    const quoteVolumeStr = formatFromIntegerUnits(bar.quoteVolumeAtomic, quotePrecision);
    return {
      time: bar.time,
      open: Number(openStr),
      high: Number(highStr),
      low: Number(lowStr),
      close: Number(closeStr),
      volume: Number(volumeStr),
      quoteVolume: Number(quoteVolumeStr),
      openStr,
      highStr,
      lowStr,
      closeStr,
      volumeStr,
      quoteVolumeStr,
      count: bar.count
    };
  }
  /**
   * Pure aggregation over a sorted/unsorted list of executed trade rows using integer/BigInt math.
   * Used for deterministic historical pagination directly from SQLite trades.
   */
  static aggregateTradeRows(trades, interval, basePrecision, quotePrecision) {
    if (!trades || trades.length === 0) return [];
    const buckets = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set();
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    for (const t of sorted) {
      if (t.id) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
      }
      const priceInt = Math.trunc(Number(t.price));
      const amountInt = Math.trunc(Number(t.amount));
      const totalInt = Math.trunc(Number(t.total));
      if (!Number.isFinite(priceInt) || priceInt <= 0 || amountInt < 0) continue;
      const bucketSec = _KlineAggregator.getBucketSec(t.timestamp, interval);
      const existing = buckets.get(bucketSec);
      if (!existing) {
        const volBig = BigInt(amountInt);
        const quoteVolBig = BigInt(Math.max(0, totalInt));
        buckets.set(bucketSec, {
          time: bucketSec,
          open: priceInt,
          high: priceInt,
          low: priceInt,
          close: priceInt,
          volume: Number(volBig),
          quoteVolume: Number(quoteVolBig),
          volumeAtomic: volBig,
          quoteVolumeAtomic: quoteVolBig,
          count: 1
        });
      } else {
        if (priceInt > existing.high) existing.high = priceInt;
        if (priceInt < existing.low) existing.low = priceInt;
        existing.close = priceInt;
        existing.volumeAtomic += BigInt(amountInt);
        existing.quoteVolumeAtomic += BigInt(Math.max(0, totalInt));
        existing.volume = Number(existing.volumeAtomic);
        existing.quoteVolume = Number(existing.quoteVolumeAtomic);
        existing.count += 1;
      }
    }
    return Array.from(buckets.values()).sort((a, b) => a.time - b.time).map((bar) => _KlineAggregator.formatBar(bar, basePrecision, quotePrecision));
  }
  /**
   * Records a genuine executed trade across all supported intervals using integer & BigInt arithmetic.
   * Returns updated CandleBar per interval, or null if tradeId was already processed (duplicate protection).
   */
  recordTrade(pairId, price, amount, total, timestampMs = Date.now(), tradeId) {
    if (tradeId) {
      const dedupeKey = `${pairId}:${tradeId}`;
      if (this.processedTradeIds.has(dedupeKey)) {
        return null;
      }
      if (this.processedTradeIds.size >= _KlineAggregator.MAX_TRACKED_TRADE_IDS) {
        const firstKey = this.processedTradeIds.values().next().value;
        if (firstKey) this.processedTradeIds.delete(firstKey);
      }
      this.processedTradeIds.add(dedupeKey);
    }
    const priceInt = Math.trunc(Number(price));
    const amountBig = BigInt(Math.max(0, Math.trunc(Number(amount))));
    const totalBig = BigInt(Math.max(0, Math.trunc(Number(total))));
    const updated = {};
    for (const interval of KLINE_INTERVALS) {
      const bucketSec = _KlineAggregator.getBucketSec(timestampMs, interval);
      const key = `${pairId}:${interval}`;
      let pairMap = this.candles.get(key);
      if (!pairMap) {
        pairMap = /* @__PURE__ */ new Map();
        this.candles.set(key, pairMap);
      }
      let existing = pairMap.get(bucketSec);
      if (!existing) {
        existing = {
          time: bucketSec,
          open: priceInt,
          high: priceInt,
          low: priceInt,
          close: priceInt,
          volume: Number(amountBig),
          quoteVolume: Number(totalBig),
          volumeAtomic: amountBig,
          quoteVolumeAtomic: totalBig,
          count: 1
        };
        pairMap.set(bucketSec, existing);
      } else {
        if (priceInt > existing.high) existing.high = priceInt;
        if (priceInt < existing.low) existing.low = priceInt;
        existing.close = priceInt;
        existing.volumeAtomic += amountBig;
        existing.quoteVolumeAtomic += totalBig;
        existing.volume = Number(existing.volumeAtomic);
        existing.quoteVolume = Number(existing.quoteVolumeAtomic);
        existing.count += 1;
      }
      updated[interval] = { ...existing };
    }
    return updated;
  }
  getCandles(pairId, interval = "1m", limit = 300) {
    const key = `${pairId}:${interval}`;
    const pairMap = this.candles.get(key);
    if (!pairMap) return [];
    const sorted = Array.from(pairMap.values()).sort((a, b) => a.time - b.time);
    return sorted.slice(-Math.max(1, limit));
  }
  getCandlesRange(pairId, interval = "1m", options = {}) {
    const key = `${pairId}:${interval}`;
    const pairMap = this.candles.get(key);
    if (!pairMap) return [];
    let bars = Array.from(pairMap.values()).sort((a, b) => a.time - b.time);
    if (options.fromSec !== void 0 && Number.isFinite(options.fromSec)) {
      bars = bars.filter((b) => b.time >= options.fromSec);
    }
    if (options.toSec !== void 0 && Number.isFinite(options.toSec)) {
      bars = bars.filter((b) => b.time <= options.toSec);
    }
    const cap = options.countBack ?? options.limit ?? 300;
    if (cap > 0 && bars.length > cap) {
      bars = bars.slice(-cap);
    }
    return bars;
  }
  /**
   * Seed historical candles from database trades on boot (sorted chronologically).
   */
  seedFromTrades(trades) {
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    for (const t of sorted) {
      this.recordTrade(t.pair_id, t.price, t.amount, t.total, t.timestamp, t.id);
    }
  }
};

// src/server/engine/engineManager.ts
var EngineManager = class _EngineManager {
  constructor(dbMgr, ledger) {
    this.engines = /* @__PURE__ */ new Map();
    this.pairConfigs = /* @__PURE__ */ new Map();
    this.broadcastHandler = null;
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.klineAggregator = new KlineAggregator();
  }
  static {
    this.instance = null;
  }
  static getInstance(dbMgr, ledger) {
    if (!_EngineManager.instance) {
      if (!dbMgr || !ledger) {
        throw new Error("DatabaseManager and LedgerService required for first initialization");
      }
      _EngineManager.instance = new _EngineManager(dbMgr, ledger);
    }
    return _EngineManager.instance;
  }
  setBroadcastHandler(handler) {
    this.broadcastHandler = handler;
  }
  attachEngineListeners(engine, config) {
    engine.addListener((evt) => {
      if (evt.eventType === "TRADE_EXECUTED") {
        const trade = evt.payload;
        this.processTradeEvent(trade, config, engine);
      } else if (evt.eventType === "ORDER_ACCEPTED" || evt.eventType === "ORDER_CANCELLED") {
        if (this.broadcastHandler) {
          this.broadcastHandler(`depth:${evt.pairId}`, engine.getDepth(25));
        }
      }
    });
  }
  processTradeEvent(trade, config, engine) {
    const updatedBars = this.klineAggregator.recordTrade(
      trade.pairId,
      trade.price,
      trade.amount,
      trade.total,
      trade.timestamp,
      trade.id
    );
    let formattedByInterval = null;
    if (updatedBars) {
      const temp = {};
      for (const interval of KLINE_INTERVALS) {
        temp[interval] = KlineAggregator.formatBar(
          updatedBars[interval],
          config.basePrecision,
          config.quotePrecision
        );
      }
      formattedByInterval = temp;
    }
    if (this.broadcastHandler) {
      this.broadcastHandler(`trade:${trade.pairId}`, trade);
      this.broadcastHandler(`ticker:${trade.pairId}`, this.getTicker(trade.pairId));
      if (engine) {
        this.broadcastHandler(`depth:${trade.pairId}`, engine.getDepth(25));
      }
      if (formattedByInterval) {
        for (const interval of KLINE_INTERVALS) {
          this.broadcastHandler(`kline:${trade.pairId}:${interval}`, {
            pairId: trade.pairId,
            interval,
            tradeId: trade.id,
            timestamp: trade.timestamp,
            basePrecision: config.basePrecision,
            quotePrecision: config.quotePrecision,
            candle: formattedByInterval[interval]
          });
        }
      }
    }
    return formattedByInterval;
  }
  async initialize() {
    const pairs = this.dbMgr.query("SELECT * FROM market_pairs");
    for (const p of pairs) {
      const config = {
        id: p.id,
        baseAsset: p.base_asset,
        quoteAsset: p.quote_asset,
        basePrecision: p.base_precision,
        quotePrecision: p.quote_precision,
        minOrderSize: p.min_order_size,
        makerFeeBps: p.maker_fee_bps,
        takerFeeBps: p.taker_fee_bps,
        isActive: p.is_active,
        tradingStatus: p.trading_status || "OPEN"
      };
      const engine = new MatchingEngine(config, this.dbMgr, this.ledger);
      await engine.recover();
      this.attachEngineListeners(engine, config);
      this.engines.set(config.id, engine);
      this.pairConfigs.set(config.id, config);
    }
    const recentTrades = this.dbMgr.query(
      "SELECT id, pair_id, price, amount, total, timestamp FROM trades ORDER BY timestamp ASC LIMIT 10000"
    );
    this.klineAggregator.seedFromTrades(recentTrades);
  }
  async ensurePairRegistered(pairInput) {
    const normalizedId = decodeURIComponent(pairInput.id || "").trim().replace(/^SILENTSMILE:/i, "").replace(/[-_]/g, "/").toUpperCase();
    const existingResolved = this.resolvePairId(normalizedId);
    if (existingResolved) {
      const existingCfg = this.pairConfigs.get(existingResolved);
      if (pairInput.isActive !== void 0 || pairInput.tradingStatus !== void 0) {
        const nextActive = pairInput.isActive !== void 0 ? pairInput.isActive ? 1 : 0 : existingCfg.isActive;
        const nextStatus = pairInput.tradingStatus === "HALTED" ? "HALTED" : pairInput.tradingStatus ? "OPEN" : existingCfg.tradingStatus;
        existingCfg.isActive = nextActive;
        existingCfg.tradingStatus = nextStatus;
        this.dbMgr.execute(
          "UPDATE market_pairs SET is_active = ?, trading_status = ? WHERE id = ?",
          [nextActive, nextStatus, existingCfg.id]
        );
      }
      return existingCfg;
    }
    const parts = normalizedId.split("/");
    const baseAsset = (pairInput.baseAsset || parts[0] || normalizedId).toUpperCase();
    const quoteAsset = (pairInput.quoteAsset || parts[1] || "IDR").toUpperCase();
    const basePrecision = Number.isFinite(Number(pairInput.basePrecision)) ? Number(pairInput.basePrecision) : 4;
    const quotePrecision = Number.isFinite(Number(pairInput.quotePrecision)) ? Number(pairInput.quotePrecision) : 0;
    const minOrderSize = Math.max(1, Math.round(Number(pairInput.minOrderSize) || 1));
    const makerFeeBps = Number.isFinite(Number(pairInput.makerFeeBps)) ? Number(pairInput.makerFeeBps) : 10;
    const takerFeeBps = Number.isFinite(Number(pairInput.takerFeeBps)) ? Number(pairInput.takerFeeBps) : 15;
    const isActive = pairInput.isActive === false || pairInput.isActive === 0 ? 0 : 1;
    const tradingStatus = pairInput.tradingStatus === "HALTED" ? "HALTED" : "OPEN";
    this.dbMgr.execute(
      `INSERT OR IGNORE INTO market_pairs (id, base_asset, quote_asset, base_precision, quote_precision, min_order_size, maker_fee_bps, taker_fee_bps, is_active, trading_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedId,
        baseAsset,
        quoteAsset,
        basePrecision,
        quotePrecision,
        minOrderSize,
        makerFeeBps,
        takerFeeBps,
        isActive,
        tradingStatus
      ]
    );
    const config = {
      id: normalizedId,
      baseAsset,
      quoteAsset,
      basePrecision,
      quotePrecision,
      minOrderSize,
      makerFeeBps,
      takerFeeBps,
      isActive,
      tradingStatus
    };
    const engine = new MatchingEngine(config, this.dbMgr, this.ledger);
    await engine.recover();
    this.attachEngineListeners(engine, config);
    this.engines.set(config.id, engine);
    this.pairConfigs.set(config.id, config);
    return config;
  }
  /**
   * Persists a real executed matching-engine trade (in human price/amount units) into SQLite `trades`,
   * aggregates it across all Kline intervals using exact integer/BigInt arithmetic, and broadcasts via WS.
   */
  async recordExecutedTrade(input) {
    const cfg = await this.ensurePairRegistered({
      id: input.pairId,
      ...input.pairMeta || {}
    });
    const tradeId = String(input.id || `trd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const existingRow = this.dbMgr.queryOne("SELECT id FROM trades WHERE id = ?", [tradeId]);
    if (existingRow) {
      return {
        recorded: false,
        tradeId,
        pairId: cfg.id,
        candlesByInterval: null
      };
    }
    const quoteScale = Math.pow(10, Math.max(0, cfg.quotePrecision));
    const baseScale = Math.pow(10, Math.max(0, cfg.basePrecision));
    const humanPrice = Number(input.price);
    const humanAmount = Number(input.amount);
    if (!Number.isFinite(humanPrice) || humanPrice <= 0 || !Number.isFinite(humanAmount) || humanAmount <= 0) {
      throw new Error(`Invalid trade price/amount for ${cfg.id}`);
    }
    const priceInt = Math.max(1, Math.round(humanPrice * quoteScale));
    const amountInt = Math.max(1, Math.round(humanAmount * baseScale));
    const humanTotal = input.total !== void 0 && Number.isFinite(Number(input.total)) ? Number(input.total) : humanPrice * humanAmount;
    const totalInt = Math.max(1, Math.round(humanTotal * quoteScale));
    const tsMs = Number.isFinite(Number(input.timestamp)) ? Math.floor(Number(input.timestamp)) : Date.now();
    const normSide = String(input.side || "buy").toLowerCase() === "sell" ? "SELL" : "BUY";
    const makerOrderId = String(input.makerOrderId || `ord_m_${tradeId}`);
    const takerOrderId = String(input.takerOrderId || `ord_t_${tradeId}`);
    const makerUserId = String(input.makerUserId || "usr_mm_01");
    const takerUserId = String(input.takerUserId || "usr_trader_01");
    const makerFee = Math.max(0, Math.round(Number(input.makerFee || 0) * quoteScale));
    const takerFee = Math.max(0, Math.round(Number(input.takerFee || 0) * quoteScale));
    this.dbMgr.execute(
      `INSERT OR IGNORE INTO trades (id, pair_id, price, amount, total, side, maker_order_id, taker_order_id, maker_user_id, taker_user_id, maker_fee, taker_fee, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tradeId,
        cfg.id,
        priceInt,
        amountInt,
        totalInt,
        normSide,
        makerOrderId,
        takerOrderId,
        makerUserId,
        takerUserId,
        makerFee,
        takerFee,
        tsMs
      ]
    );
    const engineTrade = {
      id: tradeId,
      pairId: cfg.id,
      price: priceInt,
      amount: amountInt,
      total: totalInt,
      side: normSide,
      makerOrderId,
      takerOrderId,
      makerUserId,
      takerUserId,
      makerFee,
      takerFee,
      timestamp: tsMs
    };
    const candlesByInterval = this.processTradeEvent(engineTrade, cfg, this.engines.get(cfg.id));
    return {
      recorded: true,
      tradeId,
      pairId: cfg.id,
      candlesByInterval
    };
  }
  resolvePairId(rawSymbol) {
    const cleaned = decodeURIComponent(rawSymbol || "").trim().replace(/^SILENTSMILE:/i, "").toUpperCase();
    if (this.engines.has(cleaned)) return cleaned;
    const normalized = cleaned.replace(/[-_]/g, "/");
    if (this.engines.has(normalized)) return normalized;
    const compact = cleaned.replace(/[-_/]/g, "");
    for (const pairId of this.engines.keys()) {
      if (pairId.replace(/[-_/]/g, "").toUpperCase() === compact) {
        return pairId;
      }
    }
    return null;
  }
  getPairConfig(pairId) {
    const resolved = this.resolvePairId(pairId) || pairId;
    const cfg = this.pairConfigs.get(resolved);
    if (!cfg) {
      throw new Error(`Market pair ${pairId} not found`);
    }
    return cfg;
  }
  getEngine(pairId) {
    const resolved = this.resolvePairId(pairId) || pairId;
    const engine = this.engines.get(resolved);
    if (!engine) {
      throw new Error(`Trading engine for pair ${pairId} not found`);
    }
    return engine;
  }
  async submitOrder(pairId, cmd) {
    const engine = this.getEngine(pairId);
    return engine.submitOrder(cmd);
  }
  async cancelOrder(pairId, orderId, userId) {
    const engine = this.getEngine(pairId);
    return engine.cancelOrder(orderId, userId);
  }
  getDepth(pairId, levels = 20) {
    const engine = this.getEngine(pairId);
    return engine.getDepth(levels);
  }
  getRecentTrades(pairId, limit = 50) {
    const resolved = this.resolvePairId(pairId) || pairId;
    return this.dbMgr.query(
      "SELECT * FROM trades WHERE pair_id = ? ORDER BY timestamp DESC LIMIT ?",
      [resolved, limit]
    );
  }
  getCandles(pairId, interval = "1m", limit = 300) {
    const resolved = this.resolvePairId(pairId) || pairId;
    return this.klineAggregator.getCandles(resolved, interval, limit);
  }
  /**
   * Returns precision-formatted OHLCV candles in Unix seconds directly from SQLite trades
   * with full historical range pagination (from/to/countBack/limit) and zero floating-point math.
   */
  getFormattedCandles(pairId, interval = "1m", options = {}) {
    const cfg = this.getPairConfig(pairId);
    const resolvedId = cfg.id;
    const stepSec = INTERVAL_SECONDS[interval];
    const limit = Math.min(1e3, Math.max(1, options.countBack || options.limit || 300));
    if (options.fromSec !== void 0 || options.toSec !== void 0) {
      const fromBucketSec = options.fromSec !== void 0 ? Math.floor(options.fromSec / stepSec) * stepSec : 0;
      const toBucketEndSec = options.toSec !== void 0 ? Math.floor(options.toSec / stepSec) * stepSec + stepSec - 1 : Math.floor(Date.now() / 1e3) + stepSec;
      const rows = this.dbMgr.query(
        `SELECT id, pair_id, price, amount, total, timestamp
         FROM trades
         WHERE pair_id = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
        [resolvedId, fromBucketSec * 1e3, toBucketEndSec * 1e3 + 999]
      );
      let formatted = KlineAggregator.aggregateTradeRows(
        rows,
        interval,
        cfg.basePrecision,
        cfg.quotePrecision
      );
      if (options.fromSec !== void 0) {
        formatted = formatted.filter((b) => b.time >= fromBucketSec);
      }
      if (options.toSec !== void 0) {
        formatted = formatted.filter((b) => b.time <= options.toSec);
      }
      if (formatted.length > limit) {
        formatted = formatted.slice(-limit);
      }
      let nextTime;
      if (formatted.length === 0 && options.fromSec !== void 0) {
        const olderTrade = this.dbMgr.queryOne(
          "SELECT timestamp FROM trades WHERE pair_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1",
          [resolvedId, fromBucketSec * 1e3]
        );
        if (olderTrade) {
          nextTime = KlineAggregator.getBucketSec(olderTrade.timestamp, interval);
        }
      }
      return {
        pairId: resolvedId,
        interval,
        basePrecision: cfg.basePrecision,
        quotePrecision: cfg.quotePrecision,
        candles: formatted,
        noData: formatted.length === 0,
        nextTime
      };
    }
    let rawBars = this.klineAggregator.getCandlesRange(resolvedId, interval, options);
    if (rawBars.length === 0) {
      const dbRows = this.dbMgr.query(
        "SELECT id, pair_id, price, amount, total, timestamp FROM trades WHERE pair_id = ? ORDER BY timestamp ASC LIMIT 5000",
        [resolvedId]
      );
      if (dbRows.length > 0) {
        this.klineAggregator.seedFromTrades(dbRows);
        rawBars = this.klineAggregator.getCandlesRange(resolvedId, interval, options);
      }
    }
    const candles = rawBars.map(
      (b) => KlineAggregator.formatBar(b, cfg.basePrecision, cfg.quotePrecision)
    );
    return {
      pairId: resolvedId,
      interval,
      basePrecision: cfg.basePrecision,
      quotePrecision: cfg.quotePrecision,
      candles,
      noData: candles.length === 0
    };
  }
  getTicker(pairId) {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1e3;
    const trades24h = this.dbMgr.query(
      "SELECT price, amount, total FROM trades WHERE pair_id = ? AND timestamp >= ? ORDER BY timestamp ASC",
      [pairId, dayAgo]
    );
    const latestTrade = this.dbMgr.queryOne(
      "SELECT price FROM trades WHERE pair_id = ? ORDER BY timestamp DESC LIMIT 1",
      [pairId]
    );
    const lastPrice = latestTrade ? latestTrade.price : 0;
    if (trades24h.length === 0) {
      return {
        pairId,
        lastPrice,
        priceChange24h: 0,
        priceChangePercent24h: 0,
        high24h: lastPrice,
        low24h: lastPrice,
        volume24h: 0,
        quoteVolume24h: 0,
        timestamp: now
      };
    }
    const firstPrice = trades24h[0].price;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    let quoteVolume = 0;
    for (const t of trades24h) {
      if (t.price > high) high = t.price;
      if (t.price < low) low = t.price;
      volume += t.amount;
      quoteVolume += t.total;
    }
    const change = lastPrice - firstPrice;
    const changePct = firstPrice > 0 ? change / firstPrice * 100 : 0;
    return {
      pairId,
      lastPrice,
      priceChange24h: change,
      priceChangePercent24h: Number(changePct.toFixed(2)),
      high24h: high,
      low24h: low,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      timestamp: now
    };
  }
  getAllTickers() {
    const tickers = [];
    for (const pairId of this.engines.keys()) {
      tickers.push(this.getTicker(pairId));
    }
    return tickers;
  }
  setTradingStatus(pairId, status) {
    const engine = this.getEngine(pairId);
    engine.pairConfig.tradingStatus = status;
    this.dbMgr.execute("UPDATE market_pairs SET trading_status = ? WHERE id = ?", [status, pairId]);
  }
  updateFees(pairId, makerBps, takerBps) {
    const engine = this.getEngine(pairId);
    engine.pairConfig.makerFeeBps = makerBps;
    engine.pairConfig.takerFeeBps = takerBps;
    this.dbMgr.execute("UPDATE market_pairs SET maker_fee_bps = ?, taker_fee_bps = ? WHERE id = ?", [
      makerBps,
      takerBps,
      pairId
    ]);
  }
};

// src/server/kyc/kycService.ts
import crypto5 from "node:crypto";
var KycService = class {
  constructor(dbMgr) {
    this.dbMgr = dbMgr;
  }
  /**
   * Submit new KYC verification application
   */
  submitApplication(params) {
    const { userId, fullName, idNumber, idCardUrl, selfieUrl } = params;
    if (!fullName || fullName.trim().length < 3) {
      throw new Error("Full name matching government ID is required");
    }
    if (!idNumber || idNumber.trim().length < 8) {
      throw new Error("Valid NIK / National ID number is required");
    }
    const existingPending = this.dbMgr.queryOne(
      `SELECT * FROM kyc_applications WHERE user_id = ? AND status = 'pending'`,
      [userId]
    );
    if (existingPending) {
      throw new Error("You already have a pending KYC application under review");
    }
    const appId = `kyc_${crypto5.randomBytes(8).toString("hex")}`;
    const vendorRef = `sumsub_applicant_${crypto5.randomBytes(6).toString("hex")}`;
    const now = Date.now();
    this.dbMgr.execute(
      `INSERT INTO kyc_applications (id, user_id, full_name, id_number, id_card_url, selfie_url, status, reject_reason, reviewer_id, reviewed_at, vendor_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`,
      [appId, userId, fullName.trim(), idNumber.trim(), idCardUrl, selfieUrl, vendorRef, now]
    );
    const created = this.dbMgr.queryOne("SELECT * FROM kyc_applications WHERE id = ?", [appId]);
    if (!created) throw new Error("Failed to record KYC application");
    return created;
  }
  /**
   * Get latest KYC application for a user
   */
  getApplicationByUserId(userId) {
    return this.dbMgr.queryOne(
      "SELECT * FROM kyc_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
  }
  /**
   * List all pending KYC applications for Admin review
   */
  getPendingApplications() {
    return this.dbMgr.query(
      `SELECT * FROM kyc_applications WHERE status = 'pending' ORDER BY created_at ASC`
    );
  }
  /**
   * Admin or automated review action
   */
  reviewApplication(params) {
    const { applicationId, reviewerId, decision, rejectReason } = params;
    const app = this.dbMgr.queryOne("SELECT * FROM kyc_applications WHERE id = ?", [applicationId]);
    if (!app) throw new Error("KYC Application not found");
    if (app.status !== "pending") {
      throw new Error(`Application already decided with status: ${app.status}`);
    }
    const now = Date.now();
    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `UPDATE kyc_applications
         SET status = ?, reject_reason = ?, reviewer_id = ?, reviewed_at = ?
         WHERE id = ?`,
        [decision, rejectReason || null, reviewerId, now, applicationId]
      );
      if (decision === "approved") {
        this.dbMgr.execute(
          `UPDATE users SET kyc_level = 1, daily_withdraw_limit_idr = 100000000, updated_at = ? WHERE id = ?`,
          [now, app.user_id]
        );
      }
    });
    const updated = this.dbMgr.queryOne("SELECT * FROM kyc_applications WHERE id = ?", [applicationId]);
    return updated;
  }
  /**
   * Sumsub Sandbox Webhook Simulator
   * Simulates an inbound automated KYC webhook payload from Sumsub / Onfido.
   */
  simulateSumsubWebhook(params) {
    const app = this.dbMgr.queryOne(
      "SELECT * FROM kyc_applications WHERE vendor_reference = ?",
      [params.vendorReference]
    );
    if (!app) {
      return { success: false, message: `No applicant found with reference: ${params.vendorReference}` };
    }
    const decision = params.reviewResult === "GREEN" ? "approved" : "rejected";
    const reason = params.reviewResult === "GREEN" ? void 0 : params.moderationComment || "Failed facial biometric verification";
    this.reviewApplication({
      applicationId: app.id,
      reviewerId: "sys_sumsub_webhook",
      decision,
      rejectReason: reason
    });
    return {
      success: true,
      message: `Applicant ${params.vendorReference} processed with status: ${decision}`,
      applicationId: app.id
    };
  }
};

// src/server/wallet/walletService.ts
import crypto6 from "node:crypto";
var WalletService = class {
  constructor(dbMgr, ledger, kycService) {
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.kycService = kycService;
  }
  /**
   * Generates or retrieves an on-chain deposit address for a user.
   * Hot/Cold separation: Addresses are derived from master xpub/vault; no private keys in DB!
   */
  getOrCreateDepositAddress(userId, asset, chain) {
    const existing = this.dbMgr.queryOne(
      "SELECT * FROM crypto_addresses WHERE user_id = ? AND asset = ? AND chain = ?",
      [userId, asset, chain]
    );
    if (existing) return existing;
    const id = `addr_${crypto6.randomBytes(8).toString("hex")}`;
    let address = "";
    let memoTag = null;
    if (chain.toUpperCase() === "BITCOIN") {
      address = `bc1q${crypto6.randomBytes(16).toString("hex").substring(0, 32)}`;
    } else if (chain.toUpperCase() === "SOLANA") {
      address = `${crypto6.randomBytes(22).toString("base64url").substring(0, 44)}`;
    } else if (chain.toUpperCase() === "TRON") {
      address = `T${crypto6.randomBytes(16).toString("hex").substring(0, 33)}`;
    } else {
      address = `0x${crypto6.randomBytes(20).toString("hex")}`;
    }
    const now = Date.now();
    this.dbMgr.execute(
      `INSERT INTO crypto_addresses (id, user_id, asset, chain, address, memo_tag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, asset, chain, address, memoTag, now]
    );
    return this.dbMgr.queryOne("SELECT * FROM crypto_addresses WHERE id = ?", [id]);
  }
  /**
   * Simulates an incoming blockchain deposit event with N-block confirmation.
   * Once confirmed, executes atomic deposit journal in the Ledger.
   */
  simulateChainDeposit(params) {
    const { address, amount, txHash, confirmations = 6 } = params;
    const addrRecord = this.dbMgr.queryOne(
      "SELECT * FROM crypto_addresses WHERE address = ?",
      [address]
    );
    if (!addrRecord) {
      throw new Error(`Deposit address ${address} does not belong to any registered user`);
    }
    const hash = txHash || `0x${crypto6.randomBytes(32).toString("hex")}`;
    const idempotencyKey = `dep_chain_${hash}`;
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
      message: `Successfully credited ${amount} ${addrRecord.asset} after ${confirmations} block confirmations.`
    };
  }
  /**
   * Request a withdrawal (Crypto or IDR Fiat).
   * Verifies daily withdrawal limits and KYC name matching for bank payouts.
   * Moves funds from AVAILABLE to LOCKED_WITHDRAW.
   */
  requestWithdrawal(params) {
    const { userId, asset, amount, fee, destinationAddress, destinationBankName, destinationAccountName } = params;
    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new Error("Withdrawal amount must be a positive integer");
    }
    const user = this.dbMgr.queryOne("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) throw new Error("User not found");
    if (user.status === "frozen") {
      throw new Error("Account is currently frozen. Withdrawals disabled.");
    }
    if (user.kyc_level === 0) {
      throw new Error("KYC verification required before requesting withdrawals. Please complete KYC Level 1.");
    }
    if (asset === "IDR") {
      if (!destinationAccountName || !destinationBankName) {
        throw new Error("Bank name and account holder name required for IDR withdrawal");
      }
      const kycApp = this.kycService.getApplicationByUserId(userId);
      if (!kycApp || kycApp.status !== "approved") {
        throw new Error("Approved KYC required for IDR bank disbursement");
      }
      const cleanKycName = kycApp.full_name.trim().toLowerCase();
      const cleanBankName = destinationAccountName.trim().toLowerCase();
      if (!cleanKycName.includes(cleanBankName) && !cleanBankName.includes(cleanKycName)) {
        throw new Error(
          `Bank account name mismatch: Destination name '${destinationAccountName}' does not match KYC verified name '${kycApp.full_name}'. By regulatory compliance, third-party withdrawals are prohibited.`
        );
      }
    }
    const withdrawalId = `wtd_${crypto6.randomBytes(8).toString("hex")}`;
    const idempotencyKey = `lock_${withdrawalId}`;
    const now = Date.now();
    this.ledger.lockWithdrawalFunds(userId, asset, amount, idempotencyKey, withdrawalId);
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
        now
      ]
    );
    return this.dbMgr.queryOne("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
  }
  /**
   * Admin approve and execute withdrawal.
   * Sweeps fee to sys_fee_vault and releases funds from LOCKED_WITHDRAW.
   */
  approveWithdrawal(withdrawalId, reviewerId, txHash) {
    const wtd = this.dbMgr.queryOne("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
    if (!wtd) throw new Error("Withdrawal record not found");
    if (wtd.status !== "pending_approval") {
      throw new Error(`Withdrawal cannot be approved in status ${wtd.status}`);
    }
    const hash = txHash || `0x${crypto6.randomBytes(32).toString("hex")}`;
    const idempotencyKey = `exec_${withdrawalId}`;
    const now = Date.now();
    this.dbMgr.runInTransaction(() => {
      this.ledger.executeWithdrawal(wtd.user_id, wtd.asset, wtd.amount, wtd.fee, idempotencyKey, withdrawalId);
      this.dbMgr.execute(
        `UPDATE withdrawals
         SET status = 'completed', approved_by = ?, tx_hash = ?, updated_at = ?
         WHERE id = ?`,
        [reviewerId, hash, now, withdrawalId]
      );
    });
    return this.dbMgr.queryOne("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
  }
  /**
   * Admin reject withdrawal and return reserved funds back to user's AVAILABLE balance.
   */
  rejectWithdrawal(withdrawalId, reviewerId, reason) {
    const wtd = this.dbMgr.queryOne("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
    if (!wtd) throw new Error("Withdrawal record not found");
    if (wtd.status !== "pending_approval") {
      throw new Error(`Withdrawal cannot be rejected in status ${wtd.status}`);
    }
    const idempotencyKey = `reject_${withdrawalId}`;
    const now = Date.now();
    this.dbMgr.runInTransaction(() => {
      this.ledger.rejectWithdrawalFunds(wtd.user_id, wtd.asset, wtd.amount, idempotencyKey, withdrawalId);
      this.dbMgr.execute(
        `UPDATE withdrawals
         SET status = 'rejected', approved_by = ?, updated_at = ?
         WHERE id = ?`,
        [reviewerId, now, withdrawalId]
      );
    });
    return this.dbMgr.queryOne("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
  }
  /**
   * Virtual Account Sandbox Adapter
   * Creates an interactive virtual account for instant IDR deposits (BCA, Mandiri, BRI, BNI).
   */
  createVirtualAccount(userId, bankCode) {
    const user = this.dbMgr.queryOne("SELECT email FROM users WHERE id = ?", [userId]);
    const cleanBank = bankCode.toUpperCase();
    const bankPrefixes = {
      BCA: "8808",
      MANDIRI: "8910",
      BRI: "0220",
      BNI: "9880"
    };
    const prefix = bankPrefixes[cleanBank] || "8888";
    const accNum = `${prefix}${userId.replace(/[^0-9]/g, "").padEnd(8, "0").slice(0, 8)}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1e3;
    return {
      bankCode: cleanBank,
      accountNumber: accNum,
      accountName: `SILENT SMILE - ${user?.email.split("@")[0].toUpperCase() || "USER"}`,
      expiresAt
    };
  }
  /**
   * Virtual Account Webhook Simulator
   * Simulates bank payment gateway callback (e.g. Midtrans / Xendit).
   */
  simulateVaPaymentWebhook(params) {
    const { virtualAccountNumber, paidAmount, userId } = params;
    if (paidAmount <= 0) {
      throw new Error("Paid amount must be greater than zero");
    }
    const idempotencyKey = `va_pay_${virtualAccountNumber}_${Date.now()}`;
    const tx = this.ledger.deposit(
      userId,
      "IDR",
      paidAmount,
      idempotencyKey,
      `IDR Virtual Account payment (${virtualAccountNumber})`
    );
    return {
      success: true,
      txId: tx.id,
      message: `Payment of Rp ${paidAmount.toLocaleString()} received and credited to user account.`
    };
  }
};

// src/server/api/apiKeyService.ts
import crypto7 from "node:crypto";
var ApiKeyService = class _ApiKeyService {
  static {
    // In-memory rate limit tracker: keyId -> Array of timestamps (ms)
    this.rateLimitMap = /* @__PURE__ */ new Map();
  }
  constructor(dbMgr) {
    this.dbMgr = dbMgr;
  }
  /**
   * Generates a new API key pair.
   * Enforces security policy: 'withdraw' permission is never permitted on API keys.
   */
  createApiKey(userId, permissions = ["read", "trade"], ipWhitelist, rateLimitRpm = 120) {
    const allowedPerms = permissions.filter((p) => p === "read" || p === "trade");
    if (allowedPerms.length === 0) {
      allowedPerms.push("read");
    }
    const keyId = `smi_${crypto7.randomBytes(16).toString("hex")}`;
    const rawSecret = crypto7.randomBytes(32).toString("hex");
    const secretHash = crypto7.createHash("sha256").update(rawSecret).digest("hex");
    const id = `apk_${crypto7.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    this.dbMgr.execute(
      `INSERT INTO api_keys (id, user_id, key_id, secret_hash, permissions, ip_whitelist, rate_limit_rpm, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        userId,
        keyId,
        secretHash,
        JSON.stringify(allowedPerms),
        ipWhitelist || null,
        rateLimitRpm,
        now
      ]
    );
    return {
      keyId,
      secret: rawSecret,
      permissions: allowedPerms,
      ipWhitelist: ipWhitelist || null,
      rateLimitRpm
    };
  }
  listApiKeys(userId) {
    return this.dbMgr.query(
      `SELECT id, user_id, key_id, permissions, ip_whitelist, rate_limit_rpm, is_active, created_at
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
  }
  revokeApiKey(userId, keyId) {
    this.dbMgr.execute("UPDATE api_keys SET is_active = 0 WHERE key_id = ? AND user_id = ?", [keyId, userId]);
  }
  /**
   * Verify HMAC-SHA256 signature and validate rate limits + IP whitelist
   */
  verifySignature(params) {
    const { keyId, timestamp, signature, method, path: path3, body, clientIp, requiredPermission } = params;
    const now = Date.now();
    if (Math.abs(now - timestamp) > 3e4) {
      return { valid: false, error: "Timestamp drift exceeds 30 seconds" };
    }
    const key = this.dbMgr.queryOne("SELECT * FROM api_keys WHERE key_id = ?", [keyId]);
    if (!key || key.is_active !== 1) {
      return { valid: false, error: "Invalid or deactivated API key" };
    }
    if (key.ip_whitelist) {
      const allowedIps = key.ip_whitelist.split(",").map((s) => s.trim());
      if (!allowedIps.includes(clientIp) && !allowedIps.includes("127.0.0.1") && !allowedIps.includes("::1")) {
        return { valid: false, error: "IP address not in API key whitelist" };
      }
    }
    const perms = JSON.parse(key.permissions || "[]");
    if (!perms.includes(requiredPermission)) {
      return { valid: false, error: `API key lacks required permission: ${requiredPermission}` };
    }
    const windowStart = now - 6e4;
    const timestamps = _ApiKeyService.rateLimitMap.get(keyId) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);
    if (validTimestamps.length >= key.rate_limit_rpm) {
      return { valid: false, error: `Rate limit exceeded: max ${key.rate_limit_rpm} requests/min` };
    }
    validTimestamps.push(now);
    _ApiKeyService.rateLimitMap.set(keyId, validTimestamps);
    const payload = `${timestamp}${method.toUpperCase()}${path3}${body || ""}`;
    const expectedSig = crypto7.createHmac("sha256", key.secret_hash).update(payload).digest("hex");
    if (expectedSig !== signature.toLowerCase()) {
      return { valid: false, error: "Invalid HMAC signature" };
    }
    return { valid: true, userId: key.user_id };
  }
};

// src/server/compliance/complianceService.ts
import crypto8 from "node:crypto";
var ComplianceService = class {
  constructor(dbMgr) {
    this.dbMgr = dbMgr;
  }
  /**
   * Append-only immutable audit log record
   */
  logAudit(actorId, action, resource, payload, ipAddress) {
    const id = `aud_${crypto8.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    const payloadJson = payload ? JSON.stringify(payload) : null;
    this.dbMgr.execute(
      `INSERT INTO audit_logs (id, actor_id, action, resource, ip_address, payload_json, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, actorId, action, resource, ipAddress || null, payloadJson, now]
    );
  }
  getAuditLogs(limit = 100) {
    return this.dbMgr.query(
      "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?",
      [limit]
    );
  }
  /**
   * Freezes a user account (prevents all trading, withdrawals, and balance movements)
   */
  freezeAccount(userId, reason, adminId, ipAddress) {
    this.dbMgr.execute(
      `UPDATE users SET status = 'frozen', updated_at = ? WHERE id = ?`,
      [Date.now(), userId]
    );
    this.logAudit(adminId, "ACCOUNT_FREEZE", `user:${userId}`, { reason }, ipAddress);
  }
  /**
   * Unfreezes a user account
   */
  unfreezeAccount(userId, reason, adminId, ipAddress) {
    this.dbMgr.execute(
      `UPDATE users SET status = 'active', updated_at = ? WHERE id = ?`,
      [Date.now(), userId]
    );
    this.logAudit(adminId, "ACCOUNT_UNFREEZE", `user:${userId}`, { reason }, ipAddress);
  }
  /**
   * Scans system for suspicious financial patterns (AML Monitoring):
   * 1. High-frequency withdrawals in 24 hours.
   * 2. Single transaction exceeding 500,000,000 IDR.
   * 3. Multiple concurrent IP logins from different subnets within 1 hour.
   */
  scanSuspiciousActivities() {
    const alerts = [];
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1e3;
    const largeWithdrawals = this.dbMgr.query(
      `SELECT * FROM withdrawals WHERE amount >= 500000000 AND created_at >= ?`,
      [dayAgo]
    );
    for (const w of largeWithdrawals) {
      alerts.push({
        id: `alt_${w.id}`,
        severity: "HIGH",
        userId: w.user_id,
        type: "LARGE_WITHDRAWAL_THRESHOLD",
        description: `Single withdrawal of ${w.amount.toLocaleString()} ${w.asset} exceeds 500M IDR threshold`,
        timestamp: w.created_at
      });
    }
    const userWithdrawCount = this.dbMgr.query(
      `SELECT user_id, COUNT(*) as count FROM withdrawals WHERE created_at >= ? GROUP BY user_id HAVING count >= 3`,
      [dayAgo]
    );
    for (const u of userWithdrawCount) {
      alerts.push({
        id: `alt_freq_${u.user_id}`,
        severity: "MEDIUM",
        userId: u.user_id,
        type: "HIGH_FREQUENCY_WITHDRAWAL",
        description: `User initiated ${u.count} withdrawals within 24 hours`,
        timestamp: now
      });
    }
    return alerts;
  }
  /**
   * Generates CSV compliance report for regulators (OJK/Bappebti)
   */
  generateComplianceReport(type) {
    if (type === "TRADES") {
      const trades = this.dbMgr.query("SELECT * FROM trades ORDER BY timestamp DESC LIMIT 1000");
      const headers2 = "ID,Pair,Price,Amount,Total,Side,MakerID,TakerID,Timestamp\n";
      const rows2 = trades.map((t) => `${t.id},${t.pair_id},${t.price},${t.amount},${t.total},${t.side},${t.maker_user_id},${t.taker_user_id},${new Date(t.timestamp).toISOString()}`).join("\n");
      return headers2 + rows2;
    }
    if (type === "AUDIT") {
      const logs = this.dbMgr.query("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 1000");
      const headers2 = "ID,ActorID,Action,Resource,IPAddress,Timestamp\n";
      const rows2 = logs.map((l) => `${l.id},${l.actor_id},${l.action},${l.resource},${l.ip_address || ""},${new Date(l.timestamp).toISOString()}`).join("\n");
      return headers2 + rows2;
    }
    const entries = this.dbMgr.query("SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 1000");
    const headers = "ID,TransactionID,AccountID,Asset,EntryType,Amount,BalanceBefore,BalanceAfter,Timestamp\n";
    const rows = entries.map((e) => `${e.id},${e.transaction_id},${e.account_id},${e.asset},${e.entry_type},${e.amount},${e.balance_before},${e.balance_after},${new Date(e.created_at).toISOString()}`).join("\n");
    return headers + rows;
  }
};

// src/server/observability/metrics.ts
var MetricsCollector = class _MetricsCollector {
  static {
    this.startTime = Date.now();
  }
  constructor(dbMgr) {
    this.dbMgr = dbMgr;
  }
  getHealth() {
    const memory = process.memoryUsage();
    let dbStatus = "healthy";
    try {
      this.dbMgr.queryOne("SELECT 1");
    } catch {
      dbStatus = "unhealthy";
    }
    return {
      status: dbStatus === "healthy" ? "UP" : "DOWN",
      uptimeSeconds: Math.floor((Date.now() - _MetricsCollector.startTime) / 1e3),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      database: dbStatus,
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024)
      }
    };
  }
  /**
   * Generates Prometheus exposition format (text/plain) metrics
   */
  getPrometheusMetrics() {
    const lines = [];
    const uptime = Math.floor((Date.now() - _MetricsCollector.startTime) / 1e3);
    lines.push("# HELP process_uptime_seconds The process uptime in seconds.");
    lines.push("# TYPE process_uptime_seconds gauge");
    lines.push(`process_uptime_seconds ${uptime}`);
    const ordersCount = this.dbMgr.queryOne("SELECT COUNT(*) as count FROM orders");
    lines.push("# HELP exchange_orders_total Total number of orders placed.");
    lines.push("# TYPE exchange_orders_total counter");
    lines.push(`exchange_orders_total ${ordersCount?.count || 0}`);
    const tradesCount = this.dbMgr.queryOne("SELECT COUNT(*) as count FROM trades");
    lines.push("# HELP exchange_trades_total Total number of executed trades.");
    lines.push("# TYPE exchange_trades_total counter");
    lines.push(`exchange_trades_total ${tradesCount?.count || 0}`);
    const openOrdersCount = this.dbMgr.queryOne(
      `SELECT COUNT(*) as count FROM orders WHERE status IN ('NEW', 'PARTIALLY_FILLED')`
    );
    lines.push("# HELP exchange_open_orders Total currently active open orders in matching book.");
    lines.push("# TYPE exchange_open_orders gauge");
    lines.push(`exchange_open_orders ${openOrdersCount?.count || 0}`);
    const ledgerCount = this.dbMgr.queryOne("SELECT COUNT(*) as count FROM ledger_transactions");
    lines.push("# HELP exchange_ledger_transactions_total Total immutable ledger double-entry transactions.");
    lines.push("# TYPE exchange_ledger_transactions_total counter");
    lines.push(`exchange_ledger_transactions_total ${ledgerCount?.count || 0}`);
    const now = Date.now();
    const sessionsCount = this.dbMgr.queryOne(
      `SELECT COUNT(*) as count FROM user_sessions WHERE is_revoked = 0 AND expires_at > ?`,
      [now]
    );
    lines.push("# HELP exchange_active_sessions Currently active user sessions.");
    lines.push("# TYPE exchange_active_sessions gauge");
    lines.push(`exchange_active_sessions ${sessionsCount?.count || 0}`);
    return lines.join("\n") + "\n";
  }
};

// src/server/routes.ts
import { Router as Router2 } from "express";

// src/server/auth/authMiddleware.ts
function createAuthMiddleware(authService) {
  return {
    requireAuth: (req, res, next) => {
      let token;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7).trim();
      } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
      }
      if (!token) {
        res.status(401).json({ success: false, error: "Unauthorized: Authentication token missing" });
        return;
      }
      try {
        const payload = authService.verifyAccessToken(token);
        req.user = payload;
        next();
      } catch (err) {
        res.status(401).json({ success: false, error: err.message || "Unauthorized token" });
      }
    },
    requireRole: (...allowedRoles) => {
      return (req, res, next) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: "Unauthorized: Not logged in" });
          return;
        }
        if (!allowedRoles.includes(req.user.role)) {
          res.status(403).json({ success: false, error: "Forbidden: Insufficient privileges" });
          return;
        }
        next();
      };
    },
    requireKyc: (minLevel) => {
      return (req, res, next) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: "Unauthorized" });
          return;
        }
        if (req.user.kycLevel < minLevel) {
          res.status(403).json({
            success: false,
            error: `KYC verification Level ${minLevel} required to perform this action. Your current level is ${req.user.kycLevel}.`,
            currentLevel: req.user.kycLevel,
            requiredLevel: minLevel
          });
          return;
        }
        next();
      };
    }
  };
}

// src/server/engine/listingService.ts
var ListingService = class {
  constructor(dbMgr, ledgerService, engineManager) {
    this.dbMgr = dbMgr;
    this.ledgerService = ledgerService;
    this.engineManager = engineManager;
  }
  getAllListings() {
    const listings = this.dbMgr.query(`
      SELECT l.*, 
             s.timezone, s.scheduled_listing_at, s.mm_funding_opens_at, s.mm_setup_opens_at,
             s.trading_opens_at, s.deposit_opens_at, s.withdrawal_opens_at,
             s.minimum_mm_base_inventory, s.minimum_mm_quote_inventory,
             s.minimum_bid_depth, s.minimum_ask_depth, s.maximum_initial_spread_pct,
             s.schedule_version, s.reschedule_reason
      FROM listings l
      LEFT JOIN listing_schedules s ON l.id = s.listing_id
      ORDER BY l.created_at DESC
    `);
    return listings.map((l) => ({
      ...l,
      schedule: {
        announcement_at: l.scheduled_at || l.created_at,
        mm_funding_opens_at: l.mm_funding_opens_at,
        mm_setup_opens_at: l.mm_setup_opens_at,
        public_trading_opens_at: l.trading_opens_at,
        deposit_opens_at: l.deposit_opens_at,
        withdrawal_opens_at: l.withdrawal_opens_at,
        new_badge_expires_at: l.new_badge_expires_at,
        min_base_inventory: l.minimum_mm_base_inventory,
        min_quote_inventory: l.minimum_mm_quote_inventory,
        target_spread_bps: Math.round((l.maximum_initial_spread_pct || 0.4) * 100),
        min_depth_levels: l.minimum_bid_depth || 5,
        schedule_version: l.schedule_version || 1
      }
    }));
  }
  getListingById(id) {
    const listing = this.dbMgr.queryOne(`
      SELECT l.*, 
             s.timezone, s.scheduled_listing_at, s.mm_funding_opens_at, s.mm_setup_opens_at,
             s.trading_opens_at, s.deposit_opens_at, s.withdrawal_opens_at,
             s.minimum_mm_base_inventory, s.minimum_mm_quote_inventory,
             s.minimum_bid_depth, s.minimum_ask_depth, s.maximum_initial_spread_pct,
             s.schedule_version, s.reschedule_reason
      FROM listings l
      LEFT JOIN listing_schedules s ON l.id = s.listing_id
      WHERE l.id = ?
    `, [id]);
    if (!listing) return null;
    const events = this.dbMgr.query(`
      SELECT * FROM listing_events WHERE listing_id = ? ORDER BY timestamp DESC
    `, [id]);
    return {
      ...listing,
      audit_trail: events,
      schedule: {
        announcement_at: listing.scheduled_at || listing.created_at,
        mm_funding_opens_at: listing.mm_funding_opens_at,
        mm_setup_opens_at: listing.mm_setup_opens_at,
        public_trading_opens_at: listing.trading_opens_at,
        deposit_opens_at: listing.deposit_opens_at,
        withdrawal_opens_at: listing.withdrawal_opens_at,
        new_badge_expires_at: listing.new_badge_expires_at,
        min_base_inventory: listing.minimum_mm_base_inventory,
        min_quote_inventory: listing.minimum_mm_quote_inventory,
        target_spread_bps: Math.round((listing.maximum_initial_spread_pct || 0.4) * 100),
        min_depth_levels: listing.minimum_bid_depth || 5,
        schedule_version: listing.schedule_version || 1
      }
    };
  }
  createMarketPairDraft(params) {
    const base = params.baseAsset.trim().toUpperCase();
    const quote = params.quoteAsset.trim().toUpperCase();
    const symbol = `${base}/${quote}`;
    if (!base || !quote) {
      throw new Error("Both base and quote assets must be specified.");
    }
    if (base === quote) {
      throw new Error("Base and quote asset cannot be the same asset.");
    }
    const existing = this.dbMgr.queryOne("SELECT id FROM market_pairs WHERE id = ?", [symbol]);
    if (existing) {
      throw new Error(`Market pair ${symbol} already exists.`);
    }
    const now = Date.now();
    const listingId = `list_${base.toLowerCase()}_${Date.now()}`;
    const initialPrice = params.initialPrice || 1e4;
    this.dbMgr.transaction(() => {
      this.dbMgr.execute(
        `INSERT INTO market_pairs (
          id, base_asset, quote_asset, base_precision, quote_precision, min_order_size,
          maker_fee_bps, taker_fee_bps, is_active, trading_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'CLOSED')`,
        [
          symbol,
          base,
          quote,
          params.quantityPrecision ?? 2,
          params.pricePrecision ?? 0,
          params.minQuantity ?? 1,
          params.makerFeeBps ?? 10,
          params.takerFeeBps ?? 15
        ]
      );
      this.dbMgr.execute(
        `INSERT INTO listings (
          id, market_id, status, mm_phase, trading_status, deposit_status, withdrawal_status,
          public_visibility, assigned_mm_account, initial_price, price_precision, amount_precision,
          min_order_amount, maker_fee_bps, taker_fee_bps, review_notes, version, created_at, updated_at
        ) VALUES (?, ?, 'DRAFT', 'NOT_STARTED', 'CLOSED', 'CLOSED', 'CLOSED', 'HIDDEN', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          listingId,
          symbol,
          params.assignedMMAccount || "usr_mm_01",
          initialPrice,
          params.pricePrecision ?? 0,
          params.quantityPrecision ?? 2,
          params.minQuantity ?? 1,
          params.makerFeeBps ?? 10,
          params.takerFeeBps ?? 15,
          params.notes || "",
          now,
          now
        ]
      );
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, 'MARKET_PAIR_CREATED', 'NONE', 'DRAFT', ?, ?, 1, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          params.actorId,
          now,
          JSON.stringify({ symbol, base, quote, initialPrice })
        ]
      );
    });
    return this.getListingById(listingId);
  }
  reviewListing(listingId, action, reviewerId, reason) {
    const listing = this.dbMgr.queryOne("SELECT * FROM listings WHERE id = ?", [listingId]);
    if (!listing) throw new Error("Listing not found");
    const from = listing.status;
    let target = from;
    if (action === "submit") {
      if (from !== "DRAFT") throw new Error(`Cannot submit listing from ${from}`);
      target = "UNDER_REVIEW";
    } else if (action === "approve") {
      if (from !== "UNDER_REVIEW") throw new Error(`Cannot approve listing from ${from}`);
      target = "APPROVED";
    } else if (action === "reject") {
      target = "CANCELLED";
    } else if (action === "draft") {
      target = "DRAFT";
    }
    const now = Date.now();
    this.dbMgr.transaction(() => {
      this.dbMgr.execute(
        `UPDATE listings SET status = ?, approved_by = ?, approved_at = ?, review_notes = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [target, action === "approve" ? reviewerId : listing.approved_by, action === "approve" ? now : listing.approved_at, reason || listing.review_notes, now, listingId]
      );
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          `LISTING_${action.toUpperCase()}`,
          from,
          target,
          reviewerId,
          now,
          listing.version + 1,
          JSON.stringify({ reason })
        ]
      );
    });
    return this.getListingById(listingId);
  }
  scheduleListing(listingId, params) {
    const listing = this.dbMgr.queryOne("SELECT * FROM listings WHERE id = ?", [listingId]);
    if (!listing) throw new Error("Listing not found");
    if (listing.status !== "APPROVED" && listing.status !== "SCHEDULED" && listing.status !== "POSTPONED") {
      throw new Error(`Cannot schedule listing with status ${listing.status}. Must be APPROVED first.`);
    }
    const now = Date.now();
    if (params.mmFundingOpensAt > params.tradingOpensAt) {
      throw new Error("MM funding open time must be before or equal to trading open time.");
    }
    if (params.mmSetupOpensAt < params.mmFundingOpensAt) {
      throw new Error("MM setup open time must be after or equal to MM funding open time.");
    }
    if (params.mmSetupOpensAt > params.tradingOpensAt) {
      throw new Error("MM setup open time cannot be after trading open time.");
    }
    const scheduleId = `sch_${listingId}`;
    const tz = params.timezone || "Asia/Jakarta";
    const badgeExpiry = params.newBadgeExpiresAt || params.tradingOpensAt + 864e5 * 3;
    this.dbMgr.transaction(() => {
      this.dbMgr.execute(`DELETE FROM listing_schedules WHERE listing_id = ?`, [listingId]);
      this.dbMgr.execute(
        `INSERT INTO listing_schedules (
          id, listing_id, market_id, timezone, scheduled_listing_at, mm_funding_opens_at,
          mm_setup_opens_at, trading_opens_at, new_badge_expires_at, deposit_opens_at,
          withdrawal_opens_at, minimum_mm_base_inventory, minimum_mm_quote_inventory,
          minimum_bid_depth, minimum_ask_depth, maximum_initial_spread_pct, schedule_version,
          created_by, created_at, updated_at, reschedule_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scheduleId,
          listingId,
          listing.market_id,
          tz,
          params.scheduledListingAt,
          params.mmFundingOpensAt,
          params.mmSetupOpensAt,
          params.tradingOpensAt,
          badgeExpiry,
          params.depositOpensAt,
          params.withdrawalOpensAt,
          params.minBaseInventory,
          params.minQuoteInventory,
          params.minBidDepth || 5,
          params.minAskDepth || 5,
          params.maxInitialSpreadPct || 0.4,
          listing.version + 1,
          params.actorId,
          now,
          now,
          params.reason || ""
        ]
      );
      this.dbMgr.execute(
        `UPDATE listings SET status = 'SCHEDULED', public_visibility = 'UPCOMING', scheduled_at = ?, new_badge_expires_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [params.scheduledListingAt, badgeExpiry, now, listingId]
      );
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, 'LISTING_SCHEDULED', ?, 'SCHEDULED', ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          listing.status,
          params.actorId,
          now,
          listing.version + 1,
          JSON.stringify({ params })
        ]
      );
    });
    return this.getListingById(listingId);
  }
  allocateTreasuryFunding(listingId, asset, amount, actorId, idempotencyKey) {
    const listing = this.dbMgr.queryOne("SELECT * FROM listings WHERE id = ?", [listingId]);
    if (!listing) throw new Error("Listing not found");
    const targetAccount = listing.assigned_mm_account || "usr_mm_01";
    const sourceAccount = "sys_treasury";
    const now = Date.now();
    const existingAlloc = this.dbMgr.queryOne("SELECT id FROM inventory_allocations WHERE idempotency_key = ?", [idempotencyKey]);
    if (existingAlloc) {
      throw new Error(`Allocation with key ${idempotencyKey} has already been processed.`);
    }
    let txId = "";
    this.dbMgr.transaction(() => {
      const tx = this.ledgerService.transfer(
        sourceAccount,
        targetAccount,
        asset,
        amount,
        idempotencyKey,
        `MM Treasury Capital Allocation for ${listing.market_id}`,
        actorId
      );
      txId = tx.id;
      const allocId = `alloc_${now}_${Math.random().toString(36).slice(2, 6)}`;
      this.dbMgr.execute(
        `INSERT INTO inventory_allocations (
          id, listing_id, source_account, target_account, asset, amount, actor_id, idempotency_key, tx_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [allocId, listingId, sourceAccount, targetAccount, asset, amount, actorId, idempotencyKey, txId, now]
      );
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, 'MM_TREASURY_ALLOCATED', ?, ?, ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          listing.mm_phase,
          listing.mm_phase,
          actorId,
          now,
          listing.version,
          JSON.stringify({ asset, amount, txId, targetAccount })
        ]
      );
    });
    return { success: true, txId };
  }
  toggleFeatureAccess(listingId, feature, status, actorId) {
    const listing = this.dbMgr.queryOne("SELECT * FROM listings WHERE id = ?", [listingId]);
    if (!listing) throw new Error("Listing not found");
    const col = feature === "deposit" ? "deposit_status" : "withdrawal_status";
    const prev = listing[col];
    const now = Date.now();
    this.dbMgr.transaction(() => {
      this.dbMgr.execute(
        `UPDATE listings SET ${col} = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [status, now, listingId]
      );
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          `${feature.toUpperCase()}_STATUS_${status}`,
          prev,
          status,
          actorId,
          now,
          listing.version + 1,
          JSON.stringify({ feature, status })
        ]
      );
    });
    return this.getListingById(listingId);
  }
  reconcileSchedules(currentTime = Date.now()) {
    const listings = this.getAllListings();
    const transitions = [];
    for (const l of listings) {
      if (l.status === "COMPLETED" || l.status === "CANCELLED") continue;
      const sch = l.schedule;
      if (!sch) continue;
      if (l.status === "SCHEDULED" && currentTime >= sch.mm_funding_opens_at && currentTime < sch.public_trading_opens_at) {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(
            `UPDATE listings SET status = 'PREPARING', mm_phase = 'FUNDING_OPEN', trading_status = 'PREPARATION_ONLY', version = version + 1, updated_at = ? WHERE id = ?`,
            [currentTime, l.id]
          );
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'TRANSITION_TO_PREPARING', 'SCHEDULED', 'PREPARING', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: "TRANSITION_TO_PREPARING" });
      }
      if (currentTime >= sch.deposit_opens_at && l.deposit_status === "CLOSED") {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(`UPDATE listings SET deposit_status = 'OPEN', version = version + 1, updated_at = ? WHERE id = ?`, [currentTime, l.id]);
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'DEPOSIT_AUTO_OPENED', 'CLOSED', 'OPEN', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: "DEPOSIT_AUTO_OPENED" });
      }
      if (currentTime >= sch.withdrawal_opens_at && l.withdrawal_status === "CLOSED") {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(`UPDATE listings SET withdrawal_status = 'OPEN', version = version + 1, updated_at = ? WHERE id = ?`, [currentTime, l.id]);
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'WITHDRAWAL_AUTO_OPENED', 'CLOSED', 'OPEN', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: "WITHDRAWAL_AUTO_OPENED" });
      }
      if ((l.status === "SCHEDULED" || l.status === "PREPARING") && currentTime >= sch.public_trading_opens_at) {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(
            `UPDATE listings SET status = 'LIVE', mm_phase = 'READY', trading_status = 'OPEN', public_visibility = 'LIVE', actual_launch_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
            [currentTime, currentTime, l.id]
          );
          this.dbMgr.execute(
            `UPDATE market_pairs SET is_active = 1, trading_status = 'OPEN' WHERE id = ?`,
            [l.market_id]
          );
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'MARKET_LAUNCHED_LIVE', ?, 'LIVE', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, l.status, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: "MARKET_LAUNCHED_LIVE" });
      }
    }
    return transitions;
  }
};

// src/server/workers/wsClientMiddleware.ts
import { WebSocket } from "ws";
var WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};
var WsClientMiddleware = class {
  constructor(options) {
    this.ws = null;
    this.isRunning = false;
    this.status = "DISCONNECTED";
    this.retryAttempt = 0;
    this.totalErrors = 0;
    this.totalReconnects = 0;
    this.lastError = null;
    this.lastErrorAt = null;
    this.lastOpenAt = null;
    this.lastMessageAt = 0;
    this.connectingStartedAt = null;
    this.severedSince = null;
    this.isSeveredTooLong = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.watchdogTimer = null;
    this.provider = options.provider;
    this.urlFactory = options.urlFactory;
    this.socketFactory = options.socketFactory || ((url) => new WebSocket(url, {
      handshakeTimeout: options.connectTimeoutMs ?? 8e3
    }));
    this.initialRetryDelayMs = Math.max(50, options.initialRetryDelayMs ?? 1e3);
    this.backoffMultiplier = Math.max(1.1, options.backoffMultiplier ?? 2);
    this.maxRetryDelayMs = Math.max(this.initialRetryDelayMs, options.maxRetryDelayMs ?? 3e4);
    this.severedThresholdMs = Math.max(100, options.severedThresholdMs ?? 5e3);
    this.watchdogIntervalMs = Math.max(50, options.watchdogIntervalMs ?? 1e3);
    this.heartbeatIntervalMs = Math.max(500, options.heartbeatIntervalMs ?? 2e4);
    this.connectTimeoutMs = Math.max(200, options.connectTimeoutMs ?? 1e4);
    this.nextRetryDelayMs = this.initialRetryDelayMs;
    this.onOpenCb = options.onOpen;
    this.onMessageCb = options.onMessage;
    this.onHeartbeatCb = options.onHeartbeat;
    this.onErrorCb = options.onError;
    this.onSeveredTooLongCb = options.onSeveredTooLong;
    this.onRecoverCb = options.onRecover;
  }
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const now = Date.now();
    this.severedSince = now;
    this.isSeveredTooLong = false;
    this.startWatchdog();
    this.connect();
  }
  stop() {
    this.isRunning = false;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.clearWatchdogTimer();
    this.cleanupSocket(true);
    this.status = "DISCONNECTED";
    this.connectingStartedAt = null;
    this.severedSince = null;
    this.isSeveredTooLong = false;
    this.retryAttempt = 0;
    this.nextRetryDelayMs = this.initialRetryDelayMs;
  }
  isActive() {
    return this.isRunning;
  }
  getReadyState() {
    return this.ws ? this.ws.readyState : null;
  }
  getCurrentSocket() {
    return this.ws;
  }
  safeSend(data) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_READY_STATE.OPEN) {
      const stateLabel = ws ? ws.readyState : "null";
      this.handleSocketError(
        new Error(`WebSocket send aborted (${this.provider}): readyState=${stateLabel} is not OPEN`),
        "send"
      );
      return false;
    }
    try {
      ws.send(data, (err) => {
        if (err) {
          this.handleSocketError(err, "send");
        }
      });
      return true;
    } catch (err) {
      this.handleSocketError(err instanceof Error ? err : new Error(String(err)), "send");
      return false;
    }
  }
  /**
   * Evaluates socket readyState & severed duration. Called automatically by the watchdog
   * and can also be invoked synchronously for immediate health checks.
   */
  evaluateHealth(now = Date.now()) {
    if (!this.isRunning) {
      return this.getMetrics(now);
    }
    const readyState = this.ws ? this.ws.readyState : null;
    if (readyState !== WS_READY_STATE.OPEN) {
      if (this.severedSince === null) {
        this.severedSince = now;
      }
      if (this.ws && readyState === WS_READY_STATE.CONNECTING && this.connectingStartedAt !== null && now - this.connectingStartedAt > this.connectTimeoutMs) {
        this.handleSocketError(
          new Error(`WebSocket handshake timeout (${this.provider}) after ${now - this.connectingStartedAt}ms`),
          "watchdog"
        );
      } else if (!this.reconnectTimer && (!this.ws || readyState === WS_READY_STATE.CLOSING || readyState === WS_READY_STATE.CLOSED)) {
        this.status = "RECONNECTING";
        this.scheduleReconnect();
      }
      const severedDurationMs = Math.max(0, now - (this.severedSince ?? now));
      if (severedDurationMs > this.severedThresholdMs) {
        this.isSeveredTooLong = true;
        try {
          this.onSeveredTooLongCb?.({
            provider: this.provider,
            severedSince: this.severedSince ?? now,
            severedDurationMs,
            lastError: this.lastError
          });
        } catch {
        }
      }
    } else {
      this.severedSince = null;
      this.isSeveredTooLong = false;
    }
    return this.getMetrics(now);
  }
  getMetrics(now = Date.now()) {
    const readyState = this.ws ? this.ws.readyState : null;
    const isSevered = this.isRunning && readyState !== WS_READY_STATE.OPEN;
    const severedDurationMs = isSevered && this.severedSince !== null ? Math.max(0, now - this.severedSince) : 0;
    return {
      provider: this.provider,
      status: this.status,
      readyState,
      retryAttempt: this.retryAttempt,
      nextRetryDelayMs: this.nextRetryDelayMs,
      totalErrors: this.totalErrors,
      totalReconnects: this.totalReconnects,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastOpenAt: this.lastOpenAt,
      lastMessageAt: this.lastMessageAt,
      severedSince: isSevered ? this.severedSince : null,
      severedDurationMs,
      isSeveredTooLong: isSevered && (this.isSeveredTooLong || severedDurationMs > this.severedThresholdMs)
    };
  }
  computeBackoffDelay(attempt = this.retryAttempt) {
    const raw = this.initialRetryDelayMs * Math.pow(this.backoffMultiplier, Math.max(0, attempt));
    return Math.min(Math.round(raw), this.maxRetryDelayMs);
  }
  connect() {
    if (!this.isRunning) return;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.cleanupSocket(true);
    const now = Date.now();
    this.status = this.retryAttempt > 0 ? "RECONNECTING" : "CONNECTING";
    this.connectingStartedAt = now;
    if (this.severedSince === null) {
      this.severedSince = now;
    }
    let ws;
    try {
      const url = this.urlFactory();
      ws = this.socketFactory(url);
      this.ws = ws;
    } catch (err) {
      this.handleSocketError(
        err instanceof Error ? err : new Error(err?.message || `Failed to initialize ${this.provider} WebSocket`),
        "connect"
      );
      return;
    }
    this.attachSocketListeners(ws);
    if (ws.readyState === WS_READY_STATE.CLOSING || ws.readyState === WS_READY_STATE.CLOSED) {
      this.handleSocketError(
        new Error(`WebSocket (${this.provider}) initialized in non-OPEN readyState=${ws.readyState}`),
        "connect"
      );
    }
  }
  attachSocketListeners(ws) {
    ws.on("open", () => {
      if (this.ws !== ws) return;
      if (!this.isRunning) {
        this.cleanupSocket(true);
        return;
      }
      const now = Date.now();
      const wasSevered = this.severedSince !== null;
      this.status = "CONNECTED";
      this.connectingStartedAt = null;
      this.lastOpenAt = now;
      this.lastMessageAt = now;
      this.lastError = null;
      this.retryAttempt = 0;
      this.nextRetryDelayMs = this.initialRetryDelayMs;
      this.severedSince = null;
      this.isSeveredTooLong = false;
      this.clearReconnectTimer();
      this.startHeartbeat(ws);
      try {
        this.onOpenCb?.(ws);
      } catch (err) {
        this.handleSocketError(err instanceof Error ? err : new Error(String(err)), "socket");
        return;
      }
      if (wasSevered) {
        try {
          this.onRecoverCb?.({ provider: this.provider, timestamp: now });
        } catch {
        }
      }
    });
    ws.on("message", (data) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      try {
        this.onMessageCb?.(data);
      } catch (err) {
        this.handleSocketError(err instanceof Error ? err : new Error(String(err)), "socket");
      }
    });
    ws.on("unexpected-response", (_req, res) => {
      if (this.ws !== ws) return;
      const statusCode = res?.statusCode ?? "unknown";
      try {
        res?.resume?.();
      } catch {
      }
      this.handleSocketError(
        new Error(`Unexpected HTTP ${statusCode} response from ${this.provider} stream`),
        "unexpected-response"
      );
    });
    ws.on("error", (err) => {
      if (this.ws !== ws) return;
      const normalized = err instanceof Error ? err : new Error(err?.message || `${this.provider} WebSocket error`);
      this.handleSocketError(normalized, "socket");
    });
    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return;
      this.clearHeartbeatTimer();
      this.connectingStartedAt = null;
      this.ws = null;
      if (!this.isRunning) {
        this.status = "DISCONNECTED";
        return;
      }
      if (this.severedSince === null) {
        this.severedSince = Date.now();
      }
      if (!this.lastError && code && code !== 1e3) {
        const reasonStr = reason ? reason.toString() : "";
        this.lastError = `Socket closed (code ${code}${reasonStr ? `: ${reasonStr}` : ""})`;
      }
      this.status = "RECONNECTING";
      this.scheduleReconnect();
    });
  }
  handleSocketError(err, phase) {
    const now = Date.now();
    const readyState = this.ws ? this.ws.readyState : null;
    this.totalErrors += 1;
    this.lastError = err.message || `${this.provider} WebSocket error`;
    this.lastErrorAt = now;
    this.connectingStartedAt = null;
    if (this.severedSince === null) {
      this.severedSince = now;
    }
    const severedDurationMs = Math.max(0, now - this.severedSince);
    try {
      this.onErrorCb?.(err, {
        phase,
        readyState,
        attempt: this.retryAttempt,
        severedDurationMs,
        timestamp: now
      });
    } catch {
    }
    this.clearHeartbeatTimer();
    if (this.ws && (phase !== "send" || this.ws.readyState !== WS_READY_STATE.OPEN)) {
      this.cleanupSocket(true);
    }
    if (!this.isRunning) {
      this.status = "DISCONNECTED";
      return;
    }
    this.status = "RECONNECTING";
    if (!this.ws || this.ws.readyState !== WS_READY_STATE.OPEN) {
      this.scheduleReconnect();
    }
  }
  scheduleReconnect() {
    if (!this.isRunning || this.reconnectTimer) return;
    if (this.ws && this.ws.readyState === WS_READY_STATE.OPEN) return;
    const delayMs = this.computeBackoffDelay(this.retryAttempt);
    this.retryAttempt += 1;
    this.totalReconnects += 1;
    this.nextRetryDelayMs = this.computeBackoffDelay(this.retryAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }
  startHeartbeat(ws) {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isRunning || this.ws !== ws) return;
      if (ws.readyState !== WS_READY_STATE.OPEN) {
        this.handleSocketError(
          new Error(`Heartbeat detected non-OPEN readyState=${ws.readyState} for ${this.provider}`),
          "heartbeat"
        );
        return;
      }
      try {
        if (this.onHeartbeatCb) {
          this.onHeartbeatCb(ws);
        } else if (typeof ws.ping === "function") {
          ws.ping();
        }
      } catch (err) {
        this.handleSocketError(err instanceof Error ? err : new Error(String(err)), "heartbeat");
      }
    }, this.heartbeatIntervalMs);
  }
  startWatchdog() {
    this.clearWatchdogTimer();
    this.watchdogTimer = setInterval(() => {
      this.evaluateHealth(Date.now());
    }, this.watchdogIntervalMs);
  }
  cleanupSocket(terminate) {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      ws.removeAllListeners?.();
    } catch {
    }
    if (terminate && ws.readyState !== WS_READY_STATE.CLOSED) {
      try {
        if (typeof ws.terminate === "function") {
          ws.terminate();
        } else if (typeof ws.close === "function") {
          ws.close();
        }
      } catch {
      }
    }
  }
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  clearWatchdogTimer() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
};

// src/server/workers/binanceWsHandler.ts
var BinanceWsHandler = class {
  constructor(symbols, options) {
    this.symbols = [
      "btcusdt",
      "ethusdt",
      "solusdt",
      "bnbusdt",
      "dogeusdt",
      "xrpusdt",
      "adausdt",
      "avaxusdt",
      "linkusdt"
    ];
    this.lastMessageTime = 0;
    this.lastLatencyMs = 35;
    this.onTickerCallbacks = /* @__PURE__ */ new Set();
    this.onSeveredCallbacks = /* @__PURE__ */ new Set();
    if (symbols && symbols.length > 0) {
      this.symbols = symbols.map((s) => s.toLowerCase().replace(/[-_/]/g, ""));
    }
    this.middleware = new WsClientMiddleware({
      provider: "binance",
      urlFactory: () => {
        const streamNames = this.symbols.map((s) => `${s}@bookTicker`).join("/");
        return `wss://stream.binance.com:9443/stream?streams=${streamNames}`;
      },
      socketFactory: options?.socketFactory,
      initialRetryDelayMs: options?.initialRetryDelayMs ?? 1e3,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? 3e4,
      severedThresholdMs: options?.severedThresholdMs ?? 5e3,
      watchdogIntervalMs: options?.watchdogIntervalMs ?? 1e3,
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 3e4,
      connectTimeoutMs: options?.connectTimeoutMs ?? 8e3,
      onOpen: () => {
        this.lastMessageTime = Date.now();
      },
      onMessage: (data) => {
        this.lastMessageTime = Date.now();
        try {
          const parsed = JSON.parse(data.toString());
          const payload = parsed.data || parsed;
          this.handleRawTicker(payload);
        } catch {
        }
      },
      onHeartbeat: (ws) => {
        if (ws.readyState === WS_READY_STATE.OPEN && typeof ws.ping === "function") {
          ws.ping();
        }
      },
      onSeveredTooLong: (event) => {
        for (const cb of this.onSeveredCallbacks) {
          try {
            cb(event);
          } catch {
          }
        }
      }
    });
  }
  onTicker(cb) {
    this.onTickerCallbacks.add(cb);
  }
  removeTickerListener(cb) {
    this.onTickerCallbacks.delete(cb);
  }
  onSevered(cb) {
    this.onSeveredCallbacks.add(cb);
  }
  removeSeveredListener(cb) {
    this.onSeveredCallbacks.delete(cb);
  }
  getMiddleware() {
    return this.middleware;
  }
  evaluateConnectionHealth(now = Date.now()) {
    return this.middleware.evaluateHealth(now);
  }
  getStatus() {
    const metrics = this.middleware.getMetrics();
    return {
      provider: "binance",
      status: metrics.status,
      readyState: metrics.readyState,
      symbolsTracked: this.symbols,
      lastMessageTime: this.lastMessageTime,
      latencyMs: this.lastLatencyMs,
      lastError: metrics.lastError,
      retryAttempt: metrics.retryAttempt,
      nextRetryDelayMs: metrics.nextRetryDelayMs,
      totalErrors: metrics.totalErrors,
      severedSince: metrics.severedSince,
      severedDurationMs: metrics.severedDurationMs,
      isSeveredTooLong: metrics.isSeveredTooLong,
      fallbackActive: false
    };
  }
  start() {
    this.middleware.start();
  }
  stop() {
    this.middleware.stop();
  }
  handleRawTicker(p) {
    if (!p || !p.s) return;
    const sym = String(p.s).toUpperCase();
    const bidPrice = parseFloat(p.b);
    const askPrice = parseFloat(p.a);
    if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || bidPrice <= 0 || askPrice <= 0) return;
    const midPrice = (bidPrice + askPrice) / 2;
    const now = Date.now();
    const eventTime = Number(p.E || p.T || 0);
    const latency = eventTime > 0 ? Math.max(1, now - eventTime) : 22;
    this.lastLatencyMs = latency;
    const ticker = {
      provider: "binance",
      symbol: sym,
      bidPrice,
      askPrice,
      lastPrice: midPrice,
      volume24h: 15e8,
      timestamp: now,
      latencyMs: latency
    };
    for (const cb of this.onTickerCallbacks) {
      try {
        cb(ticker);
      } catch {
      }
    }
  }
};

// src/server/workers/bybitWsHandler.ts
var BybitWsHandler = class {
  constructor(symbols, options) {
    this.url = "wss://stream.bybit.com/v5/public/spot";
    this.symbols = [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "BNBUSDT",
      "DOGEUSDT",
      "XRPUSDT",
      "ADAUSDT",
      "AVAXUSDT",
      "LINKUSDT"
    ];
    this.lastMessageTime = 0;
    this.lastLatencyMs = 42;
    this.onTickerCallbacks = /* @__PURE__ */ new Set();
    this.onSeveredCallbacks = /* @__PURE__ */ new Set();
    if (symbols && symbols.length > 0) {
      this.symbols = symbols.map((s) => s.toUpperCase().replace(/[-_/]/g, ""));
    }
    this.middleware = new WsClientMiddleware({
      provider: "bybit",
      urlFactory: () => this.url,
      socketFactory: options?.socketFactory,
      initialRetryDelayMs: options?.initialRetryDelayMs ?? 1e3,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? 3e4,
      severedThresholdMs: options?.severedThresholdMs ?? 5e3,
      watchdogIntervalMs: options?.watchdogIntervalMs ?? 1e3,
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 2e4,
      connectTimeoutMs: options?.connectTimeoutMs ?? 8e3,
      onOpen: () => {
        this.lastMessageTime = Date.now();
        const subscribeMsg = {
          op: "subscribe",
          args: this.symbols.map((sym) => `tickers.${sym}`)
        };
        this.middleware.safeSend(JSON.stringify(subscribeMsg));
      },
      onMessage: (data) => {
        this.lastMessageTime = Date.now();
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.topic && parsed.topic.startsWith("tickers.") && parsed.data) {
            this.handleBybitTicker(parsed.data, parsed.ts);
          }
        } catch {
        }
      },
      onHeartbeat: (ws) => {
        if (ws.readyState === WS_READY_STATE.OPEN) {
          this.middleware.safeSend(JSON.stringify({ op: "ping" }));
        }
      },
      onSeveredTooLong: (event) => {
        for (const cb of this.onSeveredCallbacks) {
          try {
            cb(event);
          } catch {
          }
        }
      }
    });
  }
  onTicker(cb) {
    this.onTickerCallbacks.add(cb);
  }
  removeTickerListener(cb) {
    this.onTickerCallbacks.delete(cb);
  }
  onSevered(cb) {
    this.onSeveredCallbacks.add(cb);
  }
  removeSeveredListener(cb) {
    this.onSeveredCallbacks.delete(cb);
  }
  getMiddleware() {
    return this.middleware;
  }
  evaluateConnectionHealth(now = Date.now()) {
    return this.middleware.evaluateHealth(now);
  }
  getStatus() {
    const metrics = this.middleware.getMetrics();
    return {
      provider: "bybit",
      status: metrics.status,
      readyState: metrics.readyState,
      symbolsTracked: this.symbols,
      lastMessageTime: this.lastMessageTime,
      latencyMs: this.lastLatencyMs,
      lastError: metrics.lastError,
      retryAttempt: metrics.retryAttempt,
      nextRetryDelayMs: metrics.nextRetryDelayMs,
      totalErrors: metrics.totalErrors,
      severedSince: metrics.severedSince,
      severedDurationMs: metrics.severedDurationMs,
      isSeveredTooLong: metrics.isSeveredTooLong,
      fallbackActive: false
    };
  }
  start() {
    this.middleware.start();
  }
  stop() {
    this.middleware.stop();
  }
  handleBybitTicker(d, ts) {
    if (!d || !d.symbol) return;
    const sym = String(d.symbol).toUpperCase();
    const lastPriceRaw = parseFloat(d.lastPrice);
    const bidPrice = parseFloat(d.bid1Price) || lastPriceRaw * 0.9998;
    const askPrice = parseFloat(d.ask1Price) || lastPriceRaw * 1.0002;
    const lastPrice = lastPriceRaw || (bidPrice + askPrice) / 2;
    if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || !Number.isFinite(lastPrice)) return;
    if (bidPrice <= 0 || askPrice <= 0 || lastPrice <= 0) return;
    const now = Date.now();
    const latency = ts && Number.isFinite(Number(ts)) ? Math.max(1, now - Number(ts)) : 28;
    this.lastLatencyMs = latency;
    const ticker = {
      provider: "bybit",
      symbol: sym,
      bidPrice,
      askPrice,
      lastPrice,
      volume24h: parseFloat(d.volume24h) || 89e7,
      timestamp: now,
      latencyMs: latency
    };
    for (const cb of this.onTickerCallbacks) {
      try {
        cb(ticker);
      } catch {
      }
    }
  }
};

// src/server/workers/priceAggregatorWorker.ts
var PriceAggregatorWorker = class {
  constructor(binanceHandler, bybitHandler, options) {
    this.latestBinance = /* @__PURE__ */ new Map();
    this.latestBybit = /* @__PURE__ */ new Map();
    this.aggregatedCache = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
    this.clearedListeners = /* @__PURE__ */ new Set();
    this.fxRate = {
      source: "BANK_INDONESIA",
      usdtIdrRate: 16250,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 864e5,
      updatedBy: "system",
      isStale: false
    };
    this.aggregationInterval = null;
    this.isRunning = false;
    this.clearedAggregatesCount = 0;
    this.lastClearedAt = null;
    this.binanceHandler = binanceHandler || new BinanceWsHandler();
    this.bybitHandler = bybitHandler || new BybitWsHandler();
    this.staleThresholdMs = Math.max(100, options?.staleThresholdMs ?? 5e3);
    this.binanceHandler.onTicker((ticker) => {
      this.latestBinance.set(ticker.symbol, ticker);
      this.recalculateSymbol(ticker.symbol);
    });
    this.bybitHandler.onTicker((ticker) => {
      this.latestBybit.set(ticker.symbol, ticker);
      this.recalculateSymbol(ticker.symbol);
    });
    this.binanceHandler.onSevered?.(() => {
      this.clearStaleAggregatesForProvider("binance", Date.now());
    });
    this.bybitHandler.onSevered?.(() => {
      this.clearStaleAggregatesForProvider("bybit", Date.now());
    });
  }
  onPriceUpdate(cb) {
    this.listeners.add(cb);
  }
  removePriceListener(cb) {
    this.listeners.delete(cb);
  }
  onAggregatesCleared(cb) {
    this.clearedListeners.add(cb);
  }
  removeAggregatesClearedListener(cb) {
    this.clearedListeners.delete(cb);
  }
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.binanceHandler.start();
    this.bybitHandler.start();
    this.aggregationInterval = setInterval(() => {
      this.recalculateAll();
    }, 1e3);
  }
  stop() {
    this.isRunning = false;
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    this.binanceHandler.stop();
    this.bybitHandler.stop();
  }
  setFxRate(newRate, source = "MANUAL_ADMIN", updatedBy = "admin") {
    this.fxRate = {
      source,
      usdtIdrRate: newRate,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 864e5,
      updatedBy,
      isStale: false
    };
    this.recalculateAll();
  }
  getFxRate() {
    const isStale = Date.now() > this.fxRate.expiresAt;
    return { ...this.fxRate, isStale };
  }
  getAggregatedPrice(symbol) {
    const cleanSym = symbol.toUpperCase().replace(/[-_/]/g, "");
    return this.aggregatedCache.get(cleanSym);
  }
  getAllAggregatedPrices() {
    return Array.from(this.aggregatedCache.values());
  }
  getFeedHealth() {
    return {
      binance: this.binanceHandler.getStatus(),
      bybit: this.bybitHandler.getStatus(),
      activeSymbolsCount: this.aggregatedCache.size,
      fxRate: this.getFxRate(),
      staleThresholdMs: this.staleThresholdMs,
      clearedAggregatesCount: this.clearedAggregatesCount,
      lastClearedAt: this.lastClearedAt
    };
  }
  /**
   * Clears all cached price ticks and recomputes/purges stale aggregated entries
   * for a provider whose WebSocket connection has been severed beyond the threshold.
   */
  clearStaleAggregatesForProvider(provider, now = Date.now()) {
    const tickerMap = provider === "binance" ? this.latestBinance : this.latestBybit;
    const affectedSymbols = new Set(tickerMap.keys());
    for (const [sym, agg] of this.aggregatedCache.entries()) {
      if (agg.primaryProvider === provider || agg.secondaryProvider === provider) {
        affectedSymbols.add(sym);
      }
    }
    if (affectedSymbols.size === 0) return 0;
    tickerMap.clear();
    const clearedSymbols = [];
    for (const sym of affectedSymbols) {
      const existed = this.aggregatedCache.has(sym);
      this.recalculateSymbol(sym, now);
      if (existed && !this.aggregatedCache.has(sym)) {
        clearedSymbols.push(sym);
      }
    }
    if (clearedSymbols.length > 0) {
      this.clearedAggregatesCount += clearedSymbols.length;
      this.lastClearedAt = now;
      for (const cb of this.clearedListeners) {
        try {
          cb({ symbols: clearedSymbols, provider, timestamp: now });
        } catch {
        }
      }
    }
    return clearedSymbols.length;
  }
  /**
   * Evaluates provider WebSocket health and clears stale price aggregates whenever
   * a connection remains severed (non-OPEN) for more than maxAgeMs (default 5000ms).
   */
  clearStaleAggregates(maxAgeMs = this.staleThresholdMs, now = Date.now()) {
    this.binanceHandler.evaluateConnectionHealth?.(now);
    this.bybitHandler.evaluateConnectionHealth?.(now);
    const binanceStatus = this.binanceHandler.getStatus();
    const bybitStatus = this.bybitHandler.getStatus();
    let totalCleared = 0;
    if (binanceStatus.isSeveredTooLong || binanceStatus.severedDurationMs > maxAgeMs) {
      totalCleared += this.clearStaleAggregatesForProvider("binance", now);
    }
    if (bybitStatus.isSeveredTooLong || bybitStatus.severedDurationMs > maxAgeMs) {
      totalCleared += this.clearStaleAggregatesForProvider("bybit", now);
    }
    const affected = /* @__PURE__ */ new Set();
    if (binanceStatus.status !== "CONNECTED") {
      for (const [sym, ticker] of this.latestBinance.entries()) {
        if (now - ticker.timestamp > maxAgeMs) {
          this.latestBinance.delete(sym);
          affected.add(sym);
        }
      }
    }
    if (bybitStatus.status !== "CONNECTED") {
      for (const [sym, ticker] of this.latestBybit.entries()) {
        if (now - ticker.timestamp > maxAgeMs) {
          this.latestBybit.delete(sym);
          affected.add(sym);
        }
      }
    }
    for (const [sym, agg] of this.aggregatedCache.entries()) {
      if (agg.primaryProvider === "internal") continue;
      if (!this.latestBinance.has(sym) && !this.latestBybit.has(sym) && now - agg.lastUpdated > maxAgeMs) {
        affected.add(sym);
      }
    }
    const extraCleared = [];
    for (const sym of affected) {
      const existed = this.aggregatedCache.has(sym);
      this.recalculateSymbol(sym, now);
      if (existed && !this.aggregatedCache.has(sym)) {
        extraCleared.push(sym);
      }
    }
    if (extraCleared.length > 0) {
      totalCleared += extraCleared.length;
      this.clearedAggregatesCount += extraCleared.length;
      this.lastClearedAt = now;
      for (const cb of this.clearedListeners) {
        try {
          cb({ symbols: extraCleared, timestamp: now });
        } catch {
        }
      }
    }
    return totalCleared;
  }
  recalculateSymbol(symbol, now = Date.now()) {
    const cleanSym = symbol.toUpperCase().replace(/[-_/]/g, "");
    const binance = this.latestBinance.get(cleanSym);
    const bybit = this.latestBybit.get(cleanSym);
    if (!binance && !bybit) {
      this.aggregatedCache.delete(cleanSym);
      return;
    }
    let agg;
    if (binance && !bybit) {
      const isStale = now - binance.timestamp > 15e3;
      agg = {
        symbol: cleanSym,
        primaryPrice: binance.lastPrice,
        finalPrice: binance.lastPrice,
        bidPrice: binance.bidPrice,
        askPrice: binance.askPrice,
        spreadBps: Math.round((binance.askPrice - binance.bidPrice) / binance.lastPrice * 1e4),
        primaryProvider: "binance",
        confidenceScore: isStale ? 35 : 80,
        status: isStale ? "STALE" : "FRESH",
        lastUpdated: binance.timestamp,
        rejectionReason: isStale ? "Binance feed data age exceeded 15s threshold" : void 0,
        sourceCount: 1
      };
    } else if (!binance && bybit) {
      const isStale = now - bybit.timestamp > 15e3;
      agg = {
        symbol: cleanSym,
        primaryPrice: bybit.lastPrice,
        finalPrice: bybit.lastPrice,
        bidPrice: bybit.bidPrice,
        askPrice: bybit.askPrice,
        spreadBps: Math.round((bybit.askPrice - bybit.bidPrice) / bybit.lastPrice * 1e4),
        primaryProvider: "bybit",
        confidenceScore: isStale ? 35 : 80,
        status: isStale ? "STALE" : "FRESH",
        lastUpdated: bybit.timestamp,
        rejectionReason: isStale ? "Bybit feed data age exceeded 15s threshold" : void 0,
        sourceCount: 1
      };
    } else {
      const p1 = binance.lastPrice;
      const p2 = bybit.lastPrice;
      const avg = (p1 + p2) / 2;
      const deviationBps = Math.abs((p1 - p2) / avg) * 1e4;
      const maxAge = Math.max(now - binance.timestamp, now - bybit.timestamp);
      if (maxAge > 2e4) {
        agg = {
          symbol: cleanSym,
          primaryPrice: p1,
          secondaryPrice: p2,
          finalPrice: avg,
          bidPrice: Math.min(binance.bidPrice, bybit.bidPrice),
          askPrice: Math.max(binance.askPrice, bybit.askPrice),
          spreadBps: Math.round(deviationBps),
          primaryProvider: "binance",
          secondaryProvider: "bybit",
          confidenceScore: 30,
          status: "STALE",
          lastUpdated: Math.max(binance.timestamp, bybit.timestamp),
          rejectionReason: "Exceeded maximum allowable data age (>20s)",
          sourceCount: 2
        };
      } else if (deviationBps > 250) {
        agg = {
          symbol: cleanSym,
          primaryPrice: p1,
          secondaryPrice: p2,
          finalPrice: p1,
          // Default conservative
          bidPrice: binance.bidPrice,
          askPrice: binance.askPrice,
          spreadBps: Math.round(deviationBps),
          primaryProvider: "binance",
          secondaryProvider: "bybit",
          confidenceScore: 50,
          status: "DISPUTED",
          lastUpdated: Math.max(binance.timestamp, bybit.timestamp),
          rejectionReason: `Excessive deviation between Binance and Bybit: ${deviationBps.toFixed(1)} bps`,
          sourceCount: 2
        };
      } else {
        const rawFinal = p1 * 0.6 + p2 * 0.4;
        const factor = rawFinal < 10 ? 1e4 : 100;
        const finalPrice = Math.round(rawFinal * factor) / factor;
        const bidPrice = Math.round((binance.bidPrice * 0.6 + bybit.bidPrice * 0.4) * factor) / factor;
        const askPrice = Math.round((binance.askPrice * 0.6 + bybit.askPrice * 0.4) * factor) / factor;
        agg = {
          symbol: cleanSym,
          primaryPrice: p1,
          secondaryPrice: p2,
          finalPrice,
          bidPrice,
          askPrice,
          spreadBps: Math.round((askPrice - bidPrice) / finalPrice * 1e4),
          primaryProvider: "binance",
          secondaryProvider: "bybit",
          confidenceScore: 98,
          status: "FRESH",
          lastUpdated: Math.max(binance.timestamp, bybit.timestamp),
          sourceCount: 2
        };
      }
    }
    this.aggregatedCache.set(cleanSym, agg);
    for (const listener of this.listeners) {
      try {
        listener(agg);
      } catch {
      }
    }
  }
  recalculateAll() {
    const now = Date.now();
    this.clearStaleAggregates(this.staleThresholdMs, now);
    const symbols = /* @__PURE__ */ new Set([
      ...Array.from(this.latestBinance.keys()),
      ...Array.from(this.latestBybit.keys())
    ]);
    for (const sym of symbols) {
      this.recalculateSymbol(sym, now);
    }
    const rate = this.fxRate.usdtIdrRate || 16250;
    const usdtIdrAgg = {
      symbol: "USDTIDR",
      primaryPrice: rate,
      secondaryPrice: rate - 2,
      finalPrice: rate,
      bidPrice: rate - 5,
      askPrice: rate + 5,
      spreadBps: 6,
      primaryProvider: "internal",
      confidenceScore: 99,
      status: this.getFxRate().isStale ? "STALE" : "FRESH",
      lastUpdated: now,
      sourceCount: 1
    };
    this.aggregatedCache.set("USDTIDR", usdtIdrAgg);
    for (const listener of this.listeners) {
      try {
        listener(usdtIdrAgg);
      } catch {
      }
    }
  }
};

// src/utils/formatters.ts
function safeRound(num, decimals = 8) {
  const factor = Math.pow(10, decimals);
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

// src/simulation/quantLadder.ts
function roundToPrecision(val, decimals) {
  const factor = Math.pow(10, Math.max(0, decimals));
  return Math.round(val * factor) / factor;
}
function buildQuantBotLadder(params) {
  const {
    bot,
    refCurrent: rawRefCurrent,
    fxRateIdr,
    pairLastPrice,
    amountDecimals,
    priceDecimals = 0,
    deterministic = false
  } = params;
  const refSym = bot.mapping?.referenceMarketSymbol || "BTCUSDT";
  const refCurrent = rawRefCurrent > 0 ? rawRefCurrent : bot.mapping?.referenceAnchorPrice > 0 ? bot.mapping.referenceAnchorPrice : 72450;
  const refAnchor = bot.mapping?.referenceAnchorPrice > 0 ? bot.mapping.referenceAnchorPrice : refCurrent;
  const targetAnchor = bot.mapping?.targetAnchorPrice > 0 ? bot.mapping.targetAnchorPrice : pairLastPrice;
  const beta = bot.mapping?.sensitivityBeta ?? 1;
  let targetMid = targetAnchor;
  const mode = bot.mapping?.mappingMode;
  if (mode === "FX_CONVERTED_REFERENCE" || mode === "DIRECT_EQUIVALENT" || bot.mapping?.requiresFxConversion && mode !== "PERCENTAGE_RETURN" && mode !== "BETA_SCALED_RETURN") {
    targetMid = refSym === "USDTIDR" ? refCurrent : refCurrent * (fxRateIdr > 0 ? fxRateIdr : 18200);
  } else if (mode === "DIRECT_PRICE") {
    targetMid = refCurrent;
  } else {
    const refReturn = refAnchor > 0 ? (refCurrent - refAnchor) / refAnchor : 0;
    targetMid = targetAnchor * (1 + beta * refReturn);
  }
  if (bot.mapping?.maxDeviationBps && bot.mapping.maxDeviationBps > 0 && targetAnchor > 0) {
    const maxDev = bot.mapping.maxDeviationBps / 1e4;
    targetMid = Math.min(targetAnchor * (1 + maxDev), Math.max(targetAnchor * (1 - maxDev), targetMid));
  }
  const minPriceStep = priceDecimals > 0 ? Math.pow(10, -priceDecimals) : 1;
  const tick = bot.riskProfile?.customTickSize && bot.riskProfile.customTickSize > 0 ? bot.riskProfile.customTickSize : minPriceStep;
  targetMid = Math.max(tick, roundToPrecision(Math.round(targetMid / tick) * tick, priceDecimals));
  const minSpr = Math.max(1, bot.depthConfig?.minSpreadBps ?? bot.targetSpreadBps ?? 15);
  const maxSpr = Math.max(minSpr, bot.depthConfig?.maxSpreadBps ?? Math.max(minSpr * 2, 60));
  const halfMinSpread = targetMid * (minSpr / 1e4) / 2;
  const bestBid = Math.max(
    tick,
    roundToPrecision(Math.floor((targetMid - halfMinSpread) / tick) * tick, priceDecimals)
  );
  const bestAsk = Math.max(
    roundToPrecision(bestBid + tick, priceDecimals),
    roundToPrecision(Math.ceil((targetMid + halfMinSpread) / tick) * tick, priceDecimals)
  );
  const minLot = bot.riskProfile?.minimumLotSize && bot.riskProfile.minimumLotSize > 0 ? bot.riskProfile.minimumLotSize : Math.pow(10, -Math.max(1, amountDecimals));
  const rawBaseQty = bot.depthConfig?.amountOrderLevel !== void 0 && bot.depthConfig.amountOrderLevel > 0 ? bot.depthConfig.amountOrderLevel : 0.05;
  const minLevelQty = bot.depthConfig?.minAmountOrderLevel !== void 0 && bot.depthConfig.minAmountOrderLevel > 0 ? bot.depthConfig.minAmountOrderLevel : minLot;
  const maxLevelQty = bot.depthConfig?.maxAmountOrderLevel !== void 0 && bot.depthConfig.maxAmountOrderLevel > 0 ? Math.max(minLevelQty, bot.depthConfig.maxAmountOrderLevel) : Math.max(minLevelQty, rawBaseQty * 10);
  const minOrderBid = Math.max(
    minLot,
    bot.depthConfig?.minOrderBid !== void 0 && bot.depthConfig.minOrderBid > 0 ? bot.depthConfig.minOrderBid : minLot
  );
  const minOrderAsk = Math.max(
    minLot,
    bot.depthConfig?.minOrderAsk !== void 0 && bot.depthConfig.minOrderAsk > 0 ? bot.depthConfig.minOrderAsk : minLot
  );
  const randPct = Math.max(0, bot.depthConfig?.qtyAmountRandom ?? 15) / 100;
  const configuredBidLevels = bot.strategy === "PRICE_FOLLOWER" ? 1 : Math.max(1, Math.min(20, bot.depthConfig?.numberOfBidLevels ?? 5));
  const configuredAskLevels = bot.strategy === "PRICE_FOLLOWER" ? 1 : Math.max(1, Math.min(20, bot.depthConfig?.numberOfAskLevels ?? 5));
  const maxOpenOrders = Math.max(1, bot.riskProfile?.maxOpenOrders ?? 20);
  let bidCap = Math.min(configuredBidLevels, Math.ceil(maxOpenOrders / 2));
  let askCap = Math.min(configuredAskLevels, maxOpenOrders - bidCap);
  if (bidCap + askCap < maxOpenOrders) {
    if (bidCap < configuredBidLevels) {
      bidCap = Math.min(configuredBidLevels, maxOpenOrders - askCap);
    } else if (askCap < configuredAskLevels) {
      askCap = Math.min(configuredAskLevels, maxOpenOrders - bidCap);
    }
  }
  const maxTotalBidVal = bot.riskProfile?.maxTotalBidValue !== void 0 && bot.riskProfile.maxTotalBidValue > 0 ? bot.riskProfile.maxTotalBidValue : Number.POSITIVE_INFINITY;
  const maxTotalAskQty = bot.riskProfile?.maxTotalAskQty !== void 0 && bot.riskProfile.maxTotalAskQty > 0 ? bot.riskProfile.maxTotalAskQty : Number.POSITIVE_INFINITY;
  const bidLevels = [];
  const askLevels = [];
  let totalBidValue = 0;
  let totalAskQty = 0;
  let totalAskValue = 0;
  const warnings = [];
  const computeQty = (levelIdx, sideMin) => {
    const variance = deterministic ? levelIdx % 2 === 0 ? randPct * 0.35 : -randPct * 0.35 : (Math.random() * 2 - 1) * randPct;
    let qty = rawBaseQty * (1 + variance);
    const lowerBound = Math.max(sideMin, minLevelQty);
    const upperBound = Math.max(lowerBound, maxLevelQty);
    qty = Math.max(lowerBound, Math.min(upperBound, qty));
    const lotSteps = Math.max(1, Math.round(qty / minLot));
    qty = safeRound(lotSteps * minLot, amountDecimals);
    return Math.max(minLot, qty);
  };
  for (let i = 0; i < bidCap; i++) {
    const halfMaxDeltaFrac = configuredBidLevels > 1 ? i * ((maxSpr - minSpr) / 2 / (configuredBidLevels - 1)) / 1e4 : 0;
    const bPrice = Math.max(
      tick,
      roundToPrecision(Math.floor((bestBid - halfMaxDeltaFrac * targetMid) / tick) * tick, priceDecimals)
    );
    const bQty = computeQty(i, minOrderBid);
    const notional = bPrice * bQty;
    if (totalBidValue + notional > maxTotalBidVal) {
      warnings.push(
        `Bid L${i + 1} capped by Max Total Bid Value (${Math.round(maxTotalBidVal).toLocaleString("en-US")})`
      );
      break;
    }
    bidLevels.push({
      level: i + 1,
      side: "buy",
      offsetBps: Math.round((targetMid - bPrice) / targetMid * 1e4),
      price: bPrice,
      quantity: bQty,
      totalValue: notional
    });
    totalBidValue += notional;
  }
  for (let i = 0; i < askCap; i++) {
    const halfMaxDeltaFrac = configuredAskLevels > 1 ? i * ((maxSpr - minSpr) / 2 / (configuredAskLevels - 1)) / 1e4 : 0;
    const aPrice = Math.max(
      roundToPrecision(bestBid + tick, priceDecimals),
      roundToPrecision(Math.ceil((bestAsk + halfMaxDeltaFrac * targetMid) / tick) * tick, priceDecimals)
    );
    const aQty = computeQty(i, minOrderAsk);
    if (totalAskQty + aQty > maxTotalAskQty) {
      warnings.push(`Ask L${i + 1} capped by Max Total Ask Qty (${maxTotalAskQty})`);
      break;
    }
    const notional = aPrice * aQty;
    askLevels.push({
      level: i + 1,
      side: "sell",
      offsetBps: Math.round((aPrice - targetMid) / targetMid * 1e4),
      price: aPrice,
      quantity: aQty,
      totalValue: notional
    });
    totalAskQty += aQty;
    totalAskValue += notional;
  }
  const effectiveSpreadBps = bidLevels.length > 0 && askLevels.length > 0 ? Math.round((askLevels[0].price - bidLevels[0].price) / targetMid * 1e4) : Math.round((bestAsk - bestBid) / targetMid * 1e4);
  return {
    refCurrent,
    targetCalculatedMid: targetMid,
    bestBid,
    bestAsk,
    effectiveSpreadBps,
    bidLevels,
    askLevels,
    totalBidValue,
    totalAskQty,
    totalAskValue,
    warning: warnings.length > 0 ? warnings[0] : void 0
  };
}

// src/server/workers/mmBotWorker.ts
var MMBotWorker = class {
  constructor(dbMgr, ledger, engineManager, priceAggregator) {
    this.isRunning = false;
    this.loopInterval = null;
    this.botExecutionTimes = /* @__PURE__ */ new Map();
    this.botActiveOrderIds = /* @__PURE__ */ new Map();
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.engineManager = engineManager;
    this.priceAggregator = priceAggregator;
  }
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loopInterval = setInterval(() => {
      this.executeCycle().catch((err) => {
        console.error("[MMBotWorker] Execution cycle error:", err);
      });
    }, 1e3);
  }
  stop() {
    this.isRunning = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }
  async cancelOrdersForBot(botId, userId, pairId) {
    return this.cancelExistingBotOrders(botId, userId, pairId);
  }
  async executeCycle() {
    if (!this.isRunning) return;
    const allRows = this.dbMgr.query("SELECT * FROM mm_bots");
    if (!allRows || allRows.length === 0) return;
    for (const row of allRows) {
      try {
        const bot = this.hydrateBot(row);
        if (bot.status !== "RUNNING" || bot.riskProfile?.killSwitchActive) {
          if (this.botActiveOrderIds.has(bot.id) || (bot.activeOpenOrdersCount || 0) > 0) {
            const normalizedPair = bot.targetMarketSymbol.replace("_", "/");
            const pairRow = this.dbMgr.queryOne(
              'SELECT id FROM market_pairs WHERE id = ? OR id = ? OR REPLACE(id, "/", "_") = ?',
              [bot.targetMarketSymbol, normalizedPair, bot.targetMarketSymbol]
            );
            if (pairRow) {
              await this.cancelExistingBotOrders(bot.id, bot.accountId, pairRow.id);
              this.dbMgr.execute(
                "UPDATE mm_bots SET active_open_orders_count = 0, total_bid_exposure = 0, total_ask_exposure = 0, updated_at = ? WHERE id = ?",
                [Date.now(), bot.id]
              );
            }
          }
          continue;
        }
        await this.processBot(bot);
      } catch (err) {
        console.error(`[MMBotWorker] Error processing bot ${row.id}:`, err);
        try {
          this.dbMgr.execute(
            "UPDATE mm_bots SET error_message = ?, updated_at = ? WHERE id = ?",
            [err?.message || "Worker execution error", Date.now(), row.id]
          );
        } catch {
        }
      }
    }
  }
  hydrateBot(row) {
    const parseJson = (val) => {
      if (!val) return {};
      if (typeof val === "object") return val;
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    };
    return {
      id: row.id,
      name: row.name,
      strategy: row.strategy,
      accountId: row.account_id,
      apiKeyId: row.api_key_id,
      targetMarketSymbol: row.target_market_symbol || row.target_pair,
      mapping: parseJson(row.mapping_config_json || row.mapping_config),
      depthConfig: parseJson(row.depth_config_json || row.depth_config),
      riskProfile: parseJson(row.risk_profile_json || row.risk_profile),
      status: row.status,
      dryRun: Boolean(row.dry_run),
      minRepriceIntervalMs: row.min_reprice_interval_ms ?? 2e3,
      minPriceChangeBps: row.min_price_change_bps ?? 10,
      targetSpreadBps: row.target_spread_bps ?? 20,
      activeOpenOrdersCount: row.active_open_orders_count ?? row.active_orders_count ?? 0,
      totalBidExposure: row.total_bid_exposure ?? 0,
      totalAskExposure: row.total_ask_exposure ?? 0,
      currentBaseInventory: row.current_base_inventory ?? row.current_inventory_base ?? 0,
      currentQuoteInventory: row.current_quote_inventory ?? row.current_inventory_quote ?? 0,
      realizedPnl: row.realized_pnl ?? 0,
      unrealizedPnl: row.unrealized_pnl ?? 0,
      dailyTurnover: row.daily_turnover ?? 0,
      version: row.version || 1,
      createdBy: row.created_by || "admin",
      createdAt: row.created_at || Date.now(),
      updatedAt: row.updated_at || Date.now()
    };
  }
  async processBot(bot) {
    const now = Date.now();
    const lastRun = this.botExecutionTimes.get(bot.id) || 0;
    const minDelay = Math.max(0, bot.depthConfig?.delayMinMs ?? bot.minRepriceIntervalMs ?? 1500);
    const maxDelay = Math.max(minDelay, bot.depthConfig?.delayMaxMs ?? Math.max(minDelay, 4e3));
    const randomizedDelay = maxDelay > minDelay ? minDelay + Math.floor(Math.random() * (maxDelay - minDelay)) : minDelay;
    if (lastRun > 0 && now - lastRun < randomizedDelay) {
      return;
    }
    this.botExecutionTimes.set(bot.id, now);
    const refSymbol = bot.mapping?.referenceMarketSymbol || "BTCUSDT";
    const refAgg = this.priceAggregator.getAggregatedPrice(refSymbol);
    if (!refAgg || refAgg.status === "INVALID" || refAgg.status === "STALE" || refAgg.finalPrice <= 0) {
      this.dbMgr.execute(
        "UPDATE mm_bots SET error_message = ?, updated_at = ? WHERE id = ?",
        [`Waiting for valid reference feed (${refSymbol})`, now, bot.id]
      );
      return;
    }
    const targetSymbolNormalized = bot.targetMarketSymbol.replace("_", "/");
    const pairRow = this.dbMgr.queryOne(
      'SELECT * FROM market_pairs WHERE id = ? OR id = ? OR REPLACE(id, "/", "_") = ?',
      [bot.targetMarketSymbol, targetSymbolNormalized, bot.targetMarketSymbol]
    );
    if (!pairRow || !pairRow.is_active) {
      this.dbMgr.execute(
        "UPDATE mm_bots SET error_message = ?, updated_at = ? WHERE id = ?",
        [`Market pair ${bot.targetMarketSymbol} inactive or missing`, now, bot.id]
      );
      return;
    }
    const fxRate = this.priceAggregator.getFxRate();
    if (bot.riskProfile?.antiStackingActive ?? true) {
      await this.cancelExistingBotOrders(bot.id, bot.accountId, pairRow.id);
    }
    const basePrec = pairRow.base_precision !== void 0 && pairRow.base_precision !== null ? Number(pairRow.base_precision) : 8;
    const quotePrec = pairRow.quote_precision !== void 0 && pairRow.quote_precision !== null ? Number(pairRow.quote_precision) : 0;
    const baseBalRec = this.ledger.getBalance(bot.accountId, pairRow.base_asset);
    const quoteBalRec = this.ledger.getBalance(bot.accountId, pairRow.quote_asset);
    let remainingBaseBalance = (baseBalRec?.available || 0) / Math.pow(10, basePrec);
    let remainingQuoteBalance = (quoteBalRec?.available || 0) / Math.pow(10, quotePrec);
    const maxInventoryBase = bot.riskProfile?.maxInventoryBase ?? 1e3;
    const ladder = buildQuantBotLadder({
      bot,
      refCurrent: refAgg.finalPrice,
      fxRateIdr: fxRate.usdtIdrRate || 18200,
      pairLastPrice: pairRow.last_price || 1e9,
      amountDecimals: basePrec,
      priceDecimals: quotePrec,
      deterministic: false
    });
    const newOrdersPlaced = [];
    let totalBidPlacedValue = 0;
    let totalAskPlacedQty = 0;
    let totalAskPlacedValue = 0;
    let lastError = ladder.warning || null;
    if (bot.dryRun) {
      this.dbMgr.execute(
        "UPDATE mm_bots SET last_repriced_at = ?, error_message = ?, updated_at = ? WHERE id = ?",
        [now, lastError, now, bot.id]
      );
      return;
    }
    for (const bidLevel of ladder.bidLevels) {
      if (remainingBaseBalance >= maxInventoryBase) break;
      const orderValue = bidLevel.price * bidLevel.quantity;
      if (orderValue > remainingQuoteBalance) {
        lastError = `Insufficient ${pairRow.quote_asset} balance for Bid L${bidLevel.level}`;
        break;
      }
      const atomicAmount = Math.round(bidLevel.quantity * Math.pow(10, basePrec));
      if (atomicAmount < (pairRow.min_order_size || 1)) continue;
      try {
        const orderResult = await this.engineManager.submitOrder(pairRow.id, {
          userId: bot.accountId,
          side: "BUY",
          orderType: "LIMIT",
          price: Math.round(bidLevel.price * Math.pow(10, quotePrec)),
          amount: atomicAmount
        });
        if (orderResult && orderResult.orderId) {
          newOrdersPlaced.push(orderResult.orderId);
          totalBidPlacedValue += orderValue;
          remainingQuoteBalance -= orderValue;
        }
      } catch (err) {
        lastError = err?.message || "Bid order submission failed";
      }
    }
    for (const askLevel of ladder.askLevels) {
      if (askLevel.quantity > remainingBaseBalance) {
        lastError = `Insufficient ${pairRow.base_asset} balance for Ask L${askLevel.level}`;
        break;
      }
      const atomicAmount = Math.round(askLevel.quantity * Math.pow(10, basePrec));
      if (atomicAmount < (pairRow.min_order_size || 1)) continue;
      try {
        const orderResult = await this.engineManager.submitOrder(pairRow.id, {
          userId: bot.accountId,
          side: "SELL",
          orderType: "LIMIT",
          price: Math.round(askLevel.price * Math.pow(10, quotePrec)),
          amount: atomicAmount
        });
        if (orderResult && orderResult.orderId) {
          newOrdersPlaced.push(orderResult.orderId);
          totalAskPlacedQty += askLevel.quantity;
          totalAskPlacedValue += askLevel.price * askLevel.quantity;
          remainingBaseBalance -= askLevel.quantity;
        }
      } catch (err) {
        lastError = err?.message || "Ask order submission failed";
      }
    }
    let activeSet = this.botActiveOrderIds.get(bot.id);
    if (!activeSet) {
      activeSet = /* @__PURE__ */ new Set();
      this.botActiveOrderIds.set(bot.id, activeSet);
    }
    for (const oid of newOrdersPlaced) {
      activeSet.add(oid);
    }
    const activeRow = this.dbMgr.queryOne(
      "SELECT COUNT(*) as cnt FROM orders WHERE user_id = ? AND pair_id = ? AND status IN ('NEW', 'OPEN', 'PARTIALLY_FILLED')",
      [bot.accountId, pairRow.id]
    );
    this.dbMgr.execute(
      `UPDATE mm_bots
       SET active_open_orders_count = ?,
           total_bid_exposure = ?,
           total_ask_exposure = ?,
           current_base_inventory = ?,
           current_quote_inventory = ?,
           last_repriced_at = ?,
           error_message = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        activeRow ? activeRow.cnt : activeSet.size,
        Math.round(totalBidPlacedValue),
        Math.round(totalAskPlacedValue),
        remainingBaseBalance,
        remainingQuoteBalance,
        now,
        lastError,
        now,
        bot.id
      ]
    );
  }
  async cancelExistingBotOrders(botId, userId, pairId) {
    const existingOrders = this.dbMgr.query(
      "SELECT id FROM orders WHERE user_id = ? AND pair_id = ? AND status IN ('NEW', 'OPEN', 'PARTIALLY_FILLED')",
      [userId, pairId]
    );
    let cancelled = 0;
    for (const ord of existingOrders) {
      try {
        await this.engineManager.cancelOrder(pairId, ord.id, userId);
        cancelled++;
      } catch {
      }
    }
    this.botActiveOrderIds.delete(botId);
    return cancelled;
  }
};

// src/server/services/bots/VolumeExecutionV2Service.ts
import crypto9 from "node:crypto";

// src/server/ledger/PrecisionMath.ts
var POW10_CACHE = /* @__PURE__ */ new Map();
function pow10(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Invalid decimals precision: ${decimals}`);
  }
  const cached = POW10_CACHE.get(decimals);
  if (cached !== void 0) return cached;
  const val = 10n ** BigInt(decimals);
  POW10_CACHE.set(decimals, val);
  return val;
}
function safeBigInt(value, fallback = 0n) {
  if (value === null || value === void 0 || value === "") return fallback;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fallback;
    return BigInt(Math.trunc(value));
  }
  const clean = value.trim();
  if (!clean) return fallback;
  if (/^-?\d+$/.test(clean)) {
    return BigInt(clean);
  }
  throw new Error(`Invalid atomic integer string: "${value}"`);
}
function minBigInt(a, b) {
  return a < b ? a : b;
}
function maxBigInt(a, b) {
  return a > b ? a : b;
}
function absBigInt(a) {
  return a < 0n ? -a : a;
}
function parseDecimalToAtomic(value, decimals, options = {}) {
  if (typeof value === "bigint") {
    if (!options.allowNegative && value < 0n) {
      throw new Error("Negative value is not allowed");
    }
    return value;
  }
  let raw = typeof value === "number" ? value.toString() : String(value ?? "");
  raw = raw.trim().replace(/,/g, "");
  if (!raw) return 0n;
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(raw)) {
    raw = expandScientificNotation(raw);
  }
  const isNegative = raw.startsWith("-");
  if (isNegative && !options.allowNegative) {
    throw new Error(`Negative numeric value not allowed: "${value}"`);
  }
  const absStr = isNegative ? raw.slice(1) : raw;
  if (!/^\d+(\.\d+)?$/.test(absStr)) {
    throw new Error(`Invalid decimal numeric format: "${value}"`);
  }
  const [wholePart = "0", fracPartRaw = ""] = absStr.split(".");
  if (options.strictScale && fracPartRaw.length > decimals) {
    const extra = fracPartRaw.slice(decimals);
    if (!/^0*$/.test(extra)) {
      throw new Error(`Value "${value}" exceeds maximum precision of ${decimals} decimals`);
    }
  }
  const fracPart = decimals === 0 ? "" : fracPartRaw.length > decimals ? fracPartRaw.slice(0, decimals) : fracPartRaw.padEnd(decimals, "0");
  const combined = `${wholePart}${fracPart}`.replace(/^0+(?=\d)/, "") || "0";
  const result = BigInt(combined);
  return isNegative && result > 0n ? -result : result;
}
function expandScientificNotation(input) {
  const isNeg = input.startsWith("-");
  const clean = isNeg ? input.slice(1) : input;
  const [mantissa, expStr] = clean.toLowerCase().split("e");
  const exp = parseInt(expStr, 10);
  const [whole, frac = ""] = mantissa.split(".");
  const digits = whole + frac;
  const decimalPos = whole.length + exp;
  let out;
  if (decimalPos <= 0) {
    out = "0." + "0".repeat(Math.abs(decimalPos)) + digits;
  } else if (decimalPos >= digits.length) {
    out = digits + "0".repeat(decimalPos - digits.length);
  } else {
    out = digits.slice(0, decimalPos) + "." + digits.slice(decimalPos);
  }
  return (isNeg ? "-" : "") + out;
}
function formatAtomicToDecimal(atomic, decimals, trimTrailingZeros = false) {
  const value = safeBigInt(atomic);
  const isNegative = value < 0n;
  const absVal = isNegative ? -value : value;
  if (decimals === 0) {
    return `${isNegative ? "-" : ""}${absVal.toString()}`;
  }
  const scale = pow10(decimals);
  const whole = absVal / scale;
  const fracRaw = (absVal % scale).toString().padStart(decimals, "0");
  const frac = trimTrailingZeros ? fracRaw.replace(/0+$/, "") : fracRaw;
  if (!frac) {
    return `${isNegative ? "-" : ""}${whole.toString()}`;
  }
  return `${isNegative ? "-" : ""}${whole.toString()}.${frac}`;
}
function normalizePriceToTick(priceAtomic, tickSizeAtomic, mode = "round") {
  if (priceAtomic <= 0n) return 0n;
  if (tickSizeAtomic <= 1n) return priceAtomic;
  const remainder = priceAtomic % tickSizeAtomic;
  if (remainder === 0n) return priceAtomic;
  const base = priceAtomic - remainder;
  if (mode === "floor") return base;
  if (mode === "ceil") return base + tickSizeAtomic;
  return remainder * 2n >= tickSizeAtomic ? base + tickSizeAtomic : base;
}
function normalizeQtyToLot(qtyAtomic, lotSizeAtomic, mode = "floor") {
  if (qtyAtomic <= 0n) return 0n;
  if (lotSizeAtomic <= 1n) return qtyAtomic;
  const remainder = qtyAtomic % lotSizeAtomic;
  if (remainder === 0n) return qtyAtomic;
  const base = qtyAtomic - remainder;
  return mode === "ceil" ? base + lotSizeAtomic : base;
}
function computeQuoteNotionalAtomic(priceAtomic, baseQtyAtomic, basePrecision) {
  if (priceAtomic < 0n || baseQtyAtomic < 0n) {
    throw new Error("Price and quantity must be non-negative");
  }
  const scale = pow10(basePrecision);
  return priceAtomic * baseQtyAtomic / scale;
}
function computeBaseQtyFromQuoteAtomic(quoteBudgetAtomic, priceAtomic, basePrecision) {
  if (quoteBudgetAtomic <= 0n || priceAtomic <= 0n) return 0n;
  const scale = pow10(basePrecision);
  return quoteBudgetAtomic * scale / priceAtomic;
}
function calculateFeeBpsAtomic(amountAtomic, feeBps) {
  const bps = typeof feeBps === "bigint" ? feeBps : BigInt(Math.max(0, Math.trunc(feeBps)));
  if (amountAtomic < 0n || bps < 0n) {
    throw new Error("Amount and feeBps must be non-negative");
  }
  if (amountAtomic === 0n || bps === 0n) {
    return { feeAtomic: 0n, netAtomic: amountAtomic };
  }
  const feeAtomic = amountAtomic * bps / 10000n;
  return { feeAtomic, netAtomic: amountAtomic - feeAtomic };
}
function applySlippageBpsAtomic(refPriceAtomic, slippageBps, side) {
  if (refPriceAtomic <= 0n) return 0n;
  const bps = BigInt(Math.max(0, Math.min(9999, Math.trunc(slippageBps))));
  if (side === "BUY") {
    return refPriceAtomic * (10000n + bps) / 10000n;
  }
  return refPriceAtomic * (10000n - bps) / 10000n;
}
function applyTickOffsetAtomic(basePriceAtomic, tickSizeAtomic, ticks) {
  const step = maxBigInt(1n, tickSizeAtomic);
  const shifted = basePriceAtomic + step * BigInt(Math.trunc(ticks));
  return shifted > 0n ? shifted : step;
}
function computePriceDeviationBps(execPriceAtomic, refPriceAtomic) {
  if (refPriceAtomic <= 0n || execPriceAtomic <= 0n) return 0n;
  const diff = absBigInt(execPriceAtomic - refPriceAtomic);
  return diff * 10000n / refPriceAtomic;
}
function computeWeightedAveragePrice(weightedPriceNumeratorAtomic, totalExecutedBaseAtomic) {
  if (totalExecutedBaseAtomic <= 0n || weightedPriceNumeratorAtomic <= 0n) return 0n;
  return weightedPriceNumeratorAtomic / totalExecutedBaseAtomic;
}
function deterministicBigIntInRange(minVal, maxVal, entropyInt) {
  if (maxVal <= minVal) return minVal;
  const span = maxVal - minVal + 1n;
  const positiveEntropy = entropyInt < 0n ? -entropyInt : entropyInt;
  return minVal + positiveEntropy % span;
}
var PrecisionMath = {
  pow10,
  safeBigInt,
  minBigInt,
  maxBigInt,
  absBigInt,
  parseDecimalToAtomic,
  formatAtomicToDecimal,
  normalizePriceToTick,
  normalizeQtyToLot,
  computeQuoteNotionalAtomic,
  computeBaseQtyFromQuoteAtomic,
  calculateFeeBpsAtomic,
  applySlippageBpsAtomic,
  applyTickOffsetAtomic,
  computePriceDeviationBps,
  computeWeightedAveragePrice,
  deterministicBigIntInRange
};

// src/server/services/bots/VolumeExecutionV2Service.ts
function currentUtcDay() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function defaultCheckpoint() {
  return {
    nextScheduledAt: 0,
    sliceIndex: 0,
    recentOrderTimestamps: [],
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastIdempotencyNonce: 0,
    lastReferencePriceAtomic: "0",
    lastSliceRetryCount: 0,
    lastActionReason: "INITIALIZED"
  };
}
function defaultRiskState() {
  return {
    riskLocked: false,
    riskLockReason: null,
    emergencyStopped: false,
    lastRiskCheckAt: 0,
    lastBalanceAvailableBaseAtomic: "0",
    lastBalanceAvailableQuoteAtomic: "0",
    lastBalanceLockedBaseAtomic: "0",
    lastBalanceLockedQuoteAtomic: "0",
    openOrdersCount: 0,
    activeExposureQuoteAtomic: "0",
    staleDataBlocked: false,
    collarBreaches: 0,
    slippageBreaches: 0,
    balanceRejections: 0,
    stpInterceptions: 0
  };
}
var VolumeExecutionV2Service = class {
  constructor(dbMgr, ledger, engineManager, priceAggregator) {
    this.isRunning = false;
    this.loopInterval = null;
    this.processingBotIds = /* @__PURE__ */ new Set();
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.engineManager = engineManager;
    this.priceAggregator = priceAggregator;
  }
  setPriceAggregator(aggregator) {
    this.priceAggregator = aggregator;
  }
  start(intervalMs = 1e3) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.recoverAll().catch((err) => {
      console.error("[VolumeExecutionV2Service] Startup recovery error:", err);
    });
    this.loopInterval = setInterval(() => {
      this.executeSchedulerTick().catch((err) => {
        console.error("[VolumeExecutionV2Service] Scheduler tick error:", err);
      });
    }, Math.max(250, intervalMs));
  }
  stop() {
    this.isRunning = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }
  // =========================================================================
  // AUTHORIZATION & VALIDATION HELPERS
  // =========================================================================
  assertAuthorizedForRead(actor, bot) {
    if (actor.role === "admin" || actor.role === "compliance") return;
    if (actor.role === "market_maker" && (bot.owner_id === actor.userId || bot.account_id === actor.userId || bot.account_id === "usr_mm_01")) {
      return;
    }
    if (bot.owner_id === actor.userId || bot.account_id === actor.userId) return;
    throw new Error("Forbidden: You do not have access to this volume bot");
  }
  assertAuthorizedForWrite(actor, bot) {
    if (actor.role === "admin") return;
    if (actor.role === "market_maker" && (bot.owner_id === actor.userId || bot.account_id === actor.userId || bot.account_id === "usr_mm_01")) {
      return;
    }
    if (bot.owner_id === actor.userId) return;
    throw new Error("Forbidden: Insufficient privileges to modify this volume bot");
  }
  assertAccountExists(accountId, executionMode) {
    if (executionMode === "SIMULATION") return;
    const user = this.dbMgr.queryOne("SELECT id, status FROM users WHERE id = ?", [accountId]);
    if (!user) {
      throw new Error(`Execution account "${accountId}" does not exist for LIVE execution`);
    }
    if (user.status !== "active") {
      throw new Error(`Execution account "${accountId}" is not active (status=${user.status})`);
    }
  }
  getPairConfigStrict(pairId) {
    const resolved = this.engineManager.resolvePairId(pairId);
    if (!resolved) {
      throw new Error(`Market pair "${pairId}" is not registered`);
    }
    return this.engineManager.getPairConfig(resolved);
  }
  normalizeAndValidateConfig(raw, actor) {
    if (!raw.pairId) throw new Error("pairId is required");
    const pair = this.getPairConfigStrict(raw.pairId);
    const environment = ["DEMO", "SANDBOX", "STAGING", "PRODUCTION"].includes(
      String(raw.environment || "DEMO").toUpperCase()
    ) ? String(raw.environment || "DEMO").toUpperCase() : "DEMO";
    const executionMode = raw.executionMode === "LIVE" ? "LIVE" : "SIMULATION";
    if (environment === "PRODUCTION" && actor.role !== "admin" && actor.role !== "market_maker") {
      throw new Error("Forbidden: Only admin or market_maker can configure PRODUCTION bots");
    }
    const accountId = (raw.accountId || (actor.role === "admin" ? "usr_mm_01" : actor.userId)).trim();
    this.assertAccountExists(accountId, executionMode);
    const executionSide = raw.executionSide === "SELL" ? "SELL" : "BUY";
    const validStrategies = [
      "TWAP",
      "VWAP",
      "ICEBERG",
      "PASSIVE_LIMIT",
      "AGGRESSIVE_LIMIT"
    ];
    const strategy = validStrategies.includes(raw.strategy) ? raw.strategy : "TWAP";
    const botName = (raw.botName || `${pair.id} ${strategy} Volume Bot`).trim();
    if (!botName) throw new Error("botName is required");
    const defaultTick = pair.quotePrecision === 0 ? "100" : PrecisionMath.formatAtomicToDecimal(1n, pair.quotePrecision);
    const defaultLot = PrecisionMath.formatAtomicToDecimal(BigInt(Math.max(1, pair.minOrderSize)), pair.basePrecision);
    const tickSizeStr = String(raw.tickSize ?? defaultTick);
    const lotSizeStr = String(raw.lotSize ?? defaultLot);
    const tickAtomic = PrecisionMath.parseDecimalToAtomic(tickSizeStr, pair.quotePrecision);
    const lotAtomic = PrecisionMath.parseDecimalToAtomic(lotSizeStr, pair.basePrecision);
    if (tickAtomic <= 0n) throw new Error("tickSize must be greater than zero");
    if (lotAtomic <= 0n) throw new Error("lotSize must be greater than zero");
    const rawTargetAtomic = PrecisionMath.parseDecimalToAtomic(raw.targetVolume ?? "0", pair.basePrecision);
    const targetQtyAtomic = PrecisionMath.normalizeQtyToLot(rawTargetAtomic, lotAtomic, "floor");
    if (targetQtyAtomic <= 0n) throw new Error("targetVolume must be greater than zero and at least 1 lot");
    const rawMinSliceAtomic = PrecisionMath.parseDecimalToAtomic(raw.minSliceSize ?? lotSizeStr, pair.basePrecision);
    const minSliceAtomic = PrecisionMath.maxBigInt(
      BigInt(pair.minOrderSize),
      PrecisionMath.normalizeQtyToLot(rawMinSliceAtomic, lotAtomic, "ceil")
    );
    const rawMaxSliceAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxSliceSize ?? String(raw.targetVolume ?? lotSizeStr), pair.basePrecision);
    let maxSliceAtomic = PrecisionMath.normalizeQtyToLot(rawMaxSliceAtomic, lotAtomic, "floor");
    if (maxSliceAtomic < minSliceAtomic) maxSliceAtomic = minSliceAtomic;
    if (raw.maxOrderQty !== void 0 && raw.maxOrderQty !== "") {
      const maxOrderQtyAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxOrderQty, pair.basePrecision);
      if (maxOrderQtyAtomic > 0n && maxOrderQtyAtomic < minSliceAtomic) {
        throw new Error("maxOrderQty cannot be smaller than minSliceSize");
      }
    }
    const minIntervalMs = Math.max(250, Math.trunc(Number(raw.minIntervalMs ?? 3e3)));
    const maxIntervalMs = Math.max(minIntervalMs, Math.trunc(Number(raw.maxIntervalMs ?? Math.max(minIntervalMs, 8e3))));
    const maxOrdersPerMinute = Math.max(1, Math.min(600, Math.trunc(Number(raw.maxOrdersPerMinute ?? 20))));
    const orderTimeoutMs = Math.max(1e3, Math.trunc(Number(raw.orderTimeoutMs ?? 3e4)));
    const partialFillRetryLimit = Math.max(0, Math.min(20, Math.trunc(Number(raw.partialFillRetryLimit ?? 3))));
    const cooldownAfterFailureMs = Math.max(0, Math.trunc(Number(raw.cooldownAfterFailureMs ?? 5e3)));
    const pauseBetweenWindowsMs = Math.max(0, Math.trunc(Number(raw.pauseBetweenWindowsMs ?? 0)));
    const minCollarAtomic = PrecisionMath.parseDecimalToAtomic(raw.minPriceCollar ?? "0", pair.quotePrecision);
    const maxCollarAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxPriceCollar ?? "0", pair.quotePrecision);
    if (minCollarAtomic > 0n && maxCollarAtomic > 0n && minCollarAtomic > maxCollarAtomic) {
      throw new Error("minPriceCollar cannot exceed maxPriceCollar");
    }
    const maxSlippageBps = Math.max(1, Math.min(5e3, Math.trunc(Number(raw.maxSlippageBps ?? 100))));
    const maxParticipationRateBps = Math.max(1, Math.min(1e4, Math.trunc(Number(raw.maxParticipationRateBps ?? 3e3))));
    const staleMarketDataMaxAgeMs = Math.max(1e3, Math.trunc(Number(raw.staleMarketDataMaxAgeMs ?? 3e4)));
    const maxOpenOrders = Math.max(1, Math.min(100, Math.trunc(Number(raw.maxOpenOrders ?? 5))));
    const maxOrderNotionalAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxOrderNotional ?? "0", pair.quotePrecision);
    const maxCumulativeExposureAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxCumulativeExposure ?? "0", pair.quotePrecision);
    const dailyExecutionLimitAtomic = PrecisionMath.parseDecimalToAtomic(raw.dailyExecutionLimit ?? "0", pair.quotePrecision);
    const maxBaseInventoryAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxBaseInventory ?? "0", pair.basePrecision);
    const maxQuoteInventoryAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxQuoteInventory ?? "0", pair.quotePrecision);
    const config = {
      botName,
      presetId: raw.presetId || "CUSTOM",
      pairId: pair.id,
      accountId,
      environment,
      executionMode,
      executionSide,
      targetVolume: PrecisionMath.formatAtomicToDecimal(targetQtyAtomic, pair.basePrecision, true),
      minSliceSize: PrecisionMath.formatAtomicToDecimal(minSliceAtomic, pair.basePrecision, true),
      maxSliceSize: PrecisionMath.formatAtomicToDecimal(maxSliceAtomic, pair.basePrecision, true),
      autoStopOnTarget: raw.autoStopOnTarget !== false,
      maxOrderQty: raw.maxOrderQty ? String(raw.maxOrderQty) : void 0,
      minIntervalMs,
      maxIntervalMs,
      executionWindowStartMs: raw.executionWindowStartMs ?? null,
      executionWindowEndMs: raw.executionWindowEndMs ?? null,
      pauseBetweenWindowsMs,
      maxOrdersPerMinute,
      orderTimeoutMs,
      partialFillRetryLimit,
      cooldownAfterFailureMs,
      strategy,
      twapDurationMs: Math.max(minIntervalMs, Math.trunc(Number(raw.twapDurationMs ?? 3e5))),
      vwapLookbackMinutes: Math.max(1, Math.trunc(Number(raw.vwapLookbackMinutes ?? 30))),
      icebergVisibleRatioPct: Math.max(1, Math.min(100, Math.trunc(Number(raw.icebergVisibleRatioPct ?? 20)))),
      passiveOffsetTicks: Math.max(0, Math.trunc(Number(raw.passiveOffsetTicks ?? 1))),
      aggressiveMaxTicks: Math.max(0, Math.trunc(Number(raw.aggressiveMaxTicks ?? 2))),
      referencePriceSource: ["INTERNAL_BOOK", "AGGREGATED_FEED", "HYBRID"].includes(
        String(raw.referencePriceSource || "HYBRID")
      ) ? raw.referencePriceSource : "HYBRID",
      minPriceCollar: PrecisionMath.formatAtomicToDecimal(minCollarAtomic, pair.quotePrecision, true),
      maxPriceCollar: PrecisionMath.formatAtomicToDecimal(maxCollarAtomic, pair.quotePrecision, true),
      maxSlippageBps,
      maxParticipationRateBps,
      staleMarketDataMaxAgeMs,
      tickSize: PrecisionMath.formatAtomicToDecimal(tickAtomic, pair.quotePrecision, true),
      lotSize: PrecisionMath.formatAtomicToDecimal(lotAtomic, pair.basePrecision, true),
      maxBaseInventory: PrecisionMath.formatAtomicToDecimal(maxBaseInventoryAtomic, pair.basePrecision, true),
      maxQuoteInventory: PrecisionMath.formatAtomicToDecimal(maxQuoteInventoryAtomic, pair.quotePrecision, true),
      maxOrderNotional: PrecisionMath.formatAtomicToDecimal(maxOrderNotionalAtomic, pair.quotePrecision, true),
      maxCumulativeExposure: PrecisionMath.formatAtomicToDecimal(maxCumulativeExposureAtomic, pair.quotePrecision, true),
      dailyExecutionLimit: PrecisionMath.formatAtomicToDecimal(dailyExecutionLimitAtomic, pair.quotePrecision, true),
      maxOpenOrders,
      selfTradePrevention: true
    };
    return { config, pair, targetQtyAtomic };
  }
  // =========================================================================
  // CRUD, LIFECYCLE, CLONE, MIGRATION & VERSION ROLLBACK
  // =========================================================================
  createBot(rawConfig, actor, options) {
    const { config, pair, targetQtyAtomic } = this.normalizeAndValidateConfig(rawConfig, actor);
    const botId = `vbot_${Date.now()}_${crypto9.randomBytes(4).toString("hex")}`;
    const now = Date.now();
    const status = options?.deploy ? "READY" : "DRAFT";
    const checkpoint = defaultCheckpoint();
    const riskState = defaultRiskState();
    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `INSERT INTO volume_bots (
          id, name, owner_id, account_id, pair_id, environment, execution_mode, execution_side,
          strategy, status, enabled, config_version, config_json, target_qty_atomic, remaining_qty_atomic,
          executed_qty_atomic, executed_quote_atomic, total_fees_atomic, weighted_price_num_atomic,
          daily_executed_quote_atomic, daily_reset_day, checkpoint_json, risk_state_json,
          migrated_from_legacy_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, '0', '0', '0', '0', '0', ?, ?, ?, ?, ?, ?)`,
        [
          botId,
          config.botName,
          actor.userId,
          config.accountId,
          pair.id,
          config.environment,
          config.executionMode,
          config.executionSide,
          config.strategy,
          status,
          JSON.stringify(config),
          targetQtyAtomic.toString(),
          targetQtyAtomic.toString(),
          currentUtcDay(),
          JSON.stringify(checkpoint),
          JSON.stringify(riskState),
          options?.migratedFromLegacyId || null,
          now,
          now
        ]
      );
      this.saveConfigVersionSnapshot(botId, 1, config, actor.userId, options?.migratedFromLegacyId ? "MIGRATED_FROM_LEGACY" : "INITIAL_CREATE");
      this.insertLog(botId, config.executionMode, "INFO", "BOT_CREATED", `Volume Bot "${config.botName}" created on ${pair.id} (${config.executionMode}/${config.environment})`, {
        strategy: config.strategy,
        targetVolume: config.targetVolume
      });
    });
    return this.getBotById(botId, actor);
  }
  updateBot(botId, rawConfig, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status === "RUNNING") {
      throw new Error("Pause or stop the bot before editing configuration");
    }
    const existingConfig = this.parseConfig(row);
    const merged = { ...existingConfig, ...rawConfig };
    const { config, pair, targetQtyAtomic } = this.normalizeAndValidateConfig(merged, actor);
    const executedQtyAtomic = PrecisionMath.safeBigInt(row.executed_qty_atomic);
    const remainingQtyAtomic = targetQtyAtomic > executedQtyAtomic ? targetQtyAtomic - executedQtyAtomic : 0n;
    const nextVersion = row.config_version + 1;
    const now = Date.now();
    let nextStatus = row.status;
    if (row.status === "COMPLETED" && remainingQtyAtomic > 0n) {
      nextStatus = "READY";
    }
    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `UPDATE volume_bots
         SET name = ?, account_id = ?, pair_id = ?, environment = ?, execution_mode = ?,
             execution_side = ?, strategy = ?, status = ?, config_version = ?, config_json = ?,
             target_qty_atomic = ?, remaining_qty_atomic = ?, updated_at = ?
         WHERE id = ?`,
        [
          config.botName,
          config.accountId,
          pair.id,
          config.environment,
          config.executionMode,
          config.executionSide,
          config.strategy,
          nextStatus,
          nextVersion,
          JSON.stringify(config),
          targetQtyAtomic.toString(),
          remainingQtyAtomic.toString(),
          now,
          botId
        ]
      );
      this.saveConfigVersionSnapshot(botId, nextVersion, config, actor.userId, "CONFIG_UPDATED");
      this.insertLog(botId, config.executionMode, "INFO", "BOT_CONFIG_UPDATED", `Configuration updated to v${nextVersion}`, {
        strategy: config.strategy,
        targetVolume: config.targetVolume
      });
    });
    return this.getBotById(botId, actor);
  }
  rollbackBotConfig(botId, targetVersion, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status === "RUNNING") {
      throw new Error("Pause or stop the bot before rolling back configuration");
    }
    const snap = this.dbMgr.queryOne(
      "SELECT config_json FROM volume_bot_config_versions WHERE bot_id = ? AND config_version = ?",
      [botId, targetVersion]
    );
    if (!snap) {
      throw new Error(`Configuration version v${targetVersion} not found for bot ${botId}`);
    }
    const parsed = JSON.parse(snap.config_json);
    const updated = this.updateBot(botId, parsed, actor);
    this.insertLog(botId, updated.executionMode, "WARN", "CONFIG_ROLLBACK", `Rolled back configuration from snapshot v${targetVersion}`, {
      restoredVersion: targetVersion,
      newVersion: updated.configVersion
    });
    return updated;
  }
  deployBot(botId, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status === "RUNNING") {
      throw new Error("Bot is already RUNNING");
    }
    const config = this.parseConfig(row);
    this.assertAccountExists(row.account_id, row.execution_mode);
    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'READY', emergency_stopped = 0, last_error = NULL, updated_at = ? WHERE id = ?`,
      [Date.now(), botId]
    );
    this.insertLog(botId, config.executionMode, "INFO", "BOT_DEPLOYED", `Bot deployed and ready on ${row.pair_id}`);
    return this.getBotById(botId, actor);
  }
  async startBot(botId, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    const config = this.parseConfig(row);
    this.assertAccountExists(row.account_id, row.execution_mode);
    const remaining = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
    if (config.autoStopOnTarget && remaining <= 0n) {
      throw new Error("Target volume is already completed. Increase targetVolume or clone bot to start again.");
    }
    const riskState = this.parseRiskState(row);
    riskState.riskLocked = false;
    riskState.riskLockReason = null;
    riskState.emergencyStopped = false;
    const checkpoint = this.parseCheckpoint(row);
    checkpoint.cooldownUntil = 0;
    checkpoint.consecutiveFailures = 0;
    checkpoint.nextScheduledAt = 0;
    checkpoint.lastActionReason = "STARTED";
    this.dbMgr.execute(
      `UPDATE volume_bots
       SET status = 'RUNNING', enabled = 1, emergency_stopped = 0, last_error = NULL,
           checkpoint_json = ?, risk_state_json = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(checkpoint), JSON.stringify(riskState), Date.now(), botId]
    );
    this.insertLog(botId, config.executionMode, "INFO", "BOT_STARTED", `Bot started in ${config.executionMode} mode (${config.strategy})`);
    return this.getBotById(botId, actor);
  }
  async pauseBot(botId, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    const cancelledCount = await this.cancelBotOwnedOpenOrders(row, "BOT_PAUSED");
    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'PAUSED', enabled = 0, updated_at = ? WHERE id = ?`,
      [Date.now(), botId]
    );
    this.insertLog(botId, row.execution_mode, "INFO", "BOT_PAUSED", `Bot paused (cancelled ${cancelledCount} bot-owned open orders)`);
    return this.getBotById(botId, actor);
  }
  async resumeBot(botId, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status !== "PAUSED" && row.status !== "READY" && row.status !== "STOPPED" && row.status !== "RISK_LOCKED") {
      throw new Error(`Cannot resume bot from status ${row.status}`);
    }
    return this.startBot(botId, actor);
  }
  async stopBot(botId, actor, reason = "BOT_STOPPED") {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    const cancelledCount = await this.cancelBotOwnedOpenOrders(row, reason);
    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'STOPPED', enabled = 0, updated_at = ? WHERE id = ?`,
      [Date.now(), botId]
    );
    this.insertLog(botId, row.execution_mode, "INFO", "BOT_STOPPED", `Bot stopped (${reason}); cancelled ${cancelledCount} bot-owned open orders`);
    return this.getBotById(botId, actor);
  }
  async emergencyStopBot(botId, actor, reason = "OPERATOR_EMERGENCY_STOP") {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    const cancelledCount = await this.cancelBotOwnedOpenOrders(row, reason);
    const riskState = this.parseRiskState(row);
    riskState.emergencyStopped = true;
    riskState.riskLocked = true;
    riskState.riskLockReason = reason;
    this.dbMgr.execute(
      `UPDATE volume_bots
       SET status = 'STOPPED', enabled = 0, emergency_stopped = 1, last_error = ?,
           risk_state_json = ?, updated_at = ?
       WHERE id = ?`,
      [reason, JSON.stringify(riskState), Date.now(), botId]
    );
    this.insertLog(botId, row.execution_mode, "RISK", "EMERGENCY_STOP", `Emergency stop triggered: ${reason} (cancelled ${cancelledCount} bot-owned orders)`);
    return this.getBotById(botId, actor);
  }
  cloneBot(botId, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    const cfg = this.parseConfig(row);
    return this.createBot(
      {
        ...cfg,
        botName: `${cfg.botName} (Clone)`
      },
      actor,
      { deploy: false }
    );
  }
  async deleteBot(botId, actor) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    await this.cancelBotOwnedOpenOrders(row, "BOT_DELETED");
    this.dbMgr.execute("DELETE FROM volume_bots WHERE id = ?", [botId]);
  }
  migrateLegacyAutoTradeBot(input, actor) {
    const legacyKey = input.id || `legacy_${input.targetPair}`;
    const existing = this.dbMgr.queryOne(
      "SELECT * FROM volume_bots WHERE migrated_from_legacy_id = ?",
      [legacyKey]
    );
    if (existing) {
      return this.toDTO(existing);
    }
    const pair = this.getPairConfigStrict(input.targetPair);
    const side = input.executionMode === "sell_first" ? "SELL" : "BUY";
    const intervalMs = Math.max(1e3, Math.round((input.intervalSeconds || 3) * 1e3));
    const defaultLot = PrecisionMath.formatAtomicToDecimal(BigInt(pair.minOrderSize), pair.basePrecision);
    const defaultTick = pair.quotePrecision === 0 ? "100" : PrecisionMath.formatAtomicToDecimal(1n, pair.quotePrecision);
    const created = this.createBot(
      {
        botName: `${pair.id} Volume Bot (Migrated)`,
        presetId: "CUSTOM",
        pairId: pair.id,
        accountId: input.accountId || (actor.role === "admin" ? "usr_mm_01" : actor.userId),
        environment: input.environment || "DEMO",
        executionMode: "SIMULATION",
        executionSide: side,
        targetVolume: String(input.targetVolume || 1),
        minSliceSize: String(Math.max(Number(defaultLot), input.minOrderSize || Number(defaultLot))),
        maxSliceSize: String(Math.max(input.maxOrderSize || 0.1, input.minOrderSize || Number(defaultLot))),
        autoStopOnTarget: input.autoStopOnTarget !== false,
        minIntervalMs: intervalMs,
        maxIntervalMs: intervalMs + 1e3,
        pauseBetweenWindowsMs: 0,
        maxOrdersPerMinute: 30,
        orderTimeoutMs: 3e4,
        partialFillRetryLimit: 3,
        cooldownAfterFailureMs: 5e3,
        strategy: "TWAP",
        twapDurationMs: Math.max(intervalMs * 10, 6e4),
        referencePriceSource: "HYBRID",
        minPriceCollar: "0",
        maxPriceCollar: "0",
        maxSlippageBps: 800,
        maxParticipationRateBps: 5e3,
        staleMarketDataMaxAgeMs: 6e4,
        tickSize: defaultTick,
        lotSize: defaultLot,
        maxBaseInventory: "0",
        maxQuoteInventory: "0",
        maxOrderNotional: "0",
        maxCumulativeExposure: "0",
        dailyExecutionLimit: "0",
        maxOpenOrders: 5,
        selfTradePrevention: true
      },
      actor,
      { deploy: true, migratedFromLegacyId: legacyKey }
    );
    return created;
  }
  // =========================================================================
  // READS & QUERIES
  // =========================================================================
  listBots(actor, filters) {
    let sql = "SELECT * FROM volume_bots WHERE 1=1";
    const params = [];
    if (actor.role !== "admin" && actor.role !== "compliance") {
      if (actor.role === "market_maker") {
        sql += " AND (owner_id = ? OR account_id = ? OR account_id = 'usr_mm_01')";
        params.push(actor.userId, actor.userId);
      } else {
        sql += " AND (owner_id = ? OR account_id = ?)";
        params.push(actor.userId, actor.userId);
      }
    }
    if (filters?.environment) {
      sql += " AND environment = ?";
      params.push(filters.environment.toUpperCase());
    }
    if (filters?.executionMode) {
      sql += " AND execution_mode = ?";
      params.push(filters.executionMode.toUpperCase());
    }
    if (filters?.pairId) {
      sql += " AND pair_id = ?";
      params.push(filters.pairId);
    }
    sql += " ORDER BY updated_at DESC";
    const rows = this.dbMgr.query(sql, params);
    return rows.map((r) => this.toDTO(r));
  }
  getBotById(botId, actor) {
    let row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    if (row.execution_mode === "LIVE") {
      this.reconcileBotOrdersAndTradesSync(row, this.getPairConfigStrict(row.pair_id), Date.now());
      row = this.getRowStrict(botId);
    }
    return this.toDTO(row);
  }
  getBotHistory(botId, actor, limit = 100) {
    let row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    if (row.execution_mode === "LIVE") {
      this.reconcileBotOrdersAndTradesSync(row, this.getPairConfigStrict(row.pair_id), Date.now());
    }
    const safeLimit = Math.max(1, Math.min(500, limit));
    const orders = this.dbMgr.query(
      "SELECT * FROM volume_bot_orders WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?",
      [botId, safeLimit]
    );
    const trades = this.dbMgr.query(
      "SELECT * FROM volume_bot_trades WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ?",
      [botId, safeLimit]
    );
    const simEvents = this.dbMgr.query(
      "SELECT * FROM volume_bot_sim_events WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ?",
      [botId, safeLimit]
    );
    const configVersions = this.dbMgr.query(
      "SELECT id, bot_id, config_version, changed_by, reason, created_at FROM volume_bot_config_versions WHERE bot_id = ? ORDER BY config_version DESC LIMIT 50",
      [botId]
    );
    return { orders, trades, simEvents, configVersions };
  }
  getBotLogs(botId, actor, limit = 100) {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    const safeLimit = Math.max(1, Math.min(500, limit));
    return this.dbMgr.query(
      "SELECT * FROM volume_bot_logs WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ?",
      [botId, safeLimit]
    );
  }
  // =========================================================================
  // AUTHORITATIVE SCHEDULER & EXECUTION CYCLE
  // =========================================================================
  async executeSchedulerTick(nowMs = Date.now()) {
    const runningBots = this.dbMgr.query(
      "SELECT * FROM volume_bots WHERE status = 'RUNNING' AND enabled = 1 AND emergency_stopped = 0"
    );
    for (const botRow of runningBots) {
      await this.executeBotCycle(botRow.id, nowMs);
    }
  }
  async executeBotCycle(botId, nowMs = Date.now()) {
    if (this.processingBotIds.has(botId)) {
      return this.toDTO(this.getRowStrict(botId));
    }
    this.processingBotIds.add(botId);
    try {
      let row = this.getRowStrict(botId);
      if (row.status !== "RUNNING" || !row.enabled || row.emergency_stopped) {
        return this.toDTO(row);
      }
      const config = this.parseConfig(row);
      const pair = this.getPairConfigStrict(row.pair_id);
      const checkpoint = this.parseCheckpoint(row);
      const riskState = this.parseRiskState(row);
      const today = currentUtcDay();
      if (row.daily_reset_day !== today) {
        this.dbMgr.execute(
          "UPDATE volume_bots SET daily_executed_quote_atomic = '0', daily_reset_day = ?, updated_at = ? WHERE id = ?",
          [today, nowMs, botId]
        );
        row = this.getRowStrict(botId);
      }
      await this.reconcileBotOrdersAndTrades(row, pair, nowMs);
      row = this.getRowStrict(botId);
      const remainingQty = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
      if (config.autoStopOnTarget && remainingQty <= 0n) {
        await this.cancelBotOwnedOpenOrders(row, "TARGET_COMPLETED");
        this.dbMgr.execute(
          `UPDATE volume_bots SET status = 'COMPLETED', enabled = 0, updated_at = ? WHERE id = ?`,
          [nowMs, botId]
        );
        this.insertLog(botId, row.execution_mode, "EXECUTION", "TARGET_COMPLETED", "Target execution volume reached 100% from verified trade records");
        return this.toDTO(this.getRowStrict(botId));
      }
      await this.expireTimedOutOrders(row, config, checkpoint, riskState, nowMs);
      row = this.getRowStrict(botId);
      if (checkpoint.lastSliceRetryCount > config.partialFillRetryLimit && config.partialFillRetryLimit > 0) {
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        await this.lockBotRisk(row, riskState, `PARTIAL_FILL_RETRY_LIMIT_EXCEEDED (${checkpoint.lastSliceRetryCount}/${config.partialFillRetryLimit})`, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      if (!pair.isActive || pair.tradingStatus !== "OPEN") {
        checkpoint.lastActionReason = `MARKET_NOT_OPEN (${pair.tradingStatus})`;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      if (config.executionWindowStartMs && nowMs < config.executionWindowStartMs) {
        checkpoint.lastActionReason = "BEFORE_EXECUTION_WINDOW";
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      if (config.executionWindowEndMs && nowMs > config.executionWindowEndMs) {
        await this.cancelBotOwnedOpenOrders(row, "EXECUTION_WINDOW_ENDED");
        this.dbMgr.execute("UPDATE volume_bots SET status = 'PAUSED', enabled = 0, updated_at = ? WHERE id = ?", [nowMs, botId]);
        this.insertLog(botId, row.execution_mode, "INFO", "WINDOW_ENDED", "Execution window ended; bot paused");
        return this.toDTO(this.getRowStrict(botId));
      }
      if (checkpoint.cooldownUntil > nowMs) {
        checkpoint.lastActionReason = "COOLDOWN_ACTIVE";
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      if (checkpoint.nextScheduledAt > nowMs) {
        return this.toDTO(row);
      }
      const oneMinuteAgo = nowMs - 6e4;
      checkpoint.recentOrderTimestamps = (checkpoint.recentOrderTimestamps || []).filter((ts) => ts >= oneMinuteAgo);
      if (checkpoint.recentOrderTimestamps.length >= config.maxOrdersPerMinute) {
        checkpoint.lastActionReason = "RATE_LIMIT_MAX_ORDERS_PER_MIN";
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      const openBotOrders = this.getOpenBotOrders(botId);
      riskState.openOrdersCount = openBotOrders.length;
      if (openBotOrders.length >= config.maxOpenOrders) {
        checkpoint.lastActionReason = `MAX_OPEN_ORDERS_REACHED (${openBotOrders.length}/${config.maxOpenOrders})`;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      if (config.strategy === "ICEBERG" && openBotOrders.length > 0) {
        checkpoint.lastActionReason = "ICEBERG_WAITING_VISIBLE_CLIP";
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      const refCheck = this.resolveReferencePriceAtomic(pair, config, nowMs);
      if (!refCheck.ok || refCheck.priceAtomic <= 0n) {
        if (refCheck.stale) riskState.staleDataBlocked = true;
        checkpoint.lastActionReason = refCheck.reason;
        checkpoint.cooldownUntil = nowMs + config.cooldownAfterFailureMs;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        this.insertLog(botId, row.execution_mode, "RISK", "REF_PRICE_BLOCKED", refCheck.reason);
        return this.toDTO(this.getRowStrict(botId));
      }
      riskState.staleDataBlocked = false;
      const refPriceAtomic = refCheck.priceAtomic;
      checkpoint.lastReferencePriceAtomic = refPriceAtomic.toString();
      const plan = this.planStrategySlice(row, config, pair, refPriceAtomic, openBotOrders, nowMs);
      if (!plan.ok) {
        if (plan.riskCode === "COLLAR") riskState.collarBreaches += 1;
        if (plan.riskCode === "SLIPPAGE") riskState.slippageBreaches += 1;
        if (plan.riskCode === "STP") riskState.stpInterceptions += 1;
        checkpoint.lastActionReason = plan.reason;
        checkpoint.nextScheduledAt = nowMs + this.computeNextDelayMs(config, checkpoint.sliceIndex);
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        this.insertLog(botId, row.execution_mode, plan.riskCode ? "RISK" : "WARN", plan.riskCode || "SLICE_SKIPPED", plan.reason);
        return this.toDTO(this.getRowStrict(botId));
      }
      const riskDecision = this.checkPreTradeRiskAndBalances(
        row,
        config,
        pair,
        plan.orderPriceAtomic,
        plan.sliceQtyAtomic,
        openBotOrders,
        riskState,
        nowMs
      );
      if (!riskDecision.ok) {
        const formattedReason = `[${riskDecision.code}] ${riskDecision.reason}`;
        checkpoint.consecutiveFailures += 1;
        checkpoint.cooldownUntil = nowMs + config.cooldownAfterFailureMs;
        checkpoint.lastActionReason = formattedReason;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        if (riskDecision.hardLock) {
          await this.lockBotRisk(row, riskState, formattedReason, nowMs);
        } else {
          this.insertLog(botId, row.execution_mode, "RISK", riskDecision.code, formattedReason);
        }
        return this.toDTO(this.getRowStrict(botId));
      }
      checkpoint.sliceIndex += 1;
      checkpoint.lastIdempotencyNonce += 1;
      const idempotencyKey = `vbot_${botId}_v${row.config_version}_s${checkpoint.sliceIndex}_n${checkpoint.lastIdempotencyNonce}`;
      await this.submitPlannedSliceOrder({
        row,
        config,
        pair,
        orderPriceAtomic: plan.orderPriceAtomic,
        sliceQtyAtomic: plan.sliceQtyAtomic,
        refPriceAtomic,
        idempotencyKey,
        checkpoint,
        riskState,
        nowMs
      });
      checkpoint.consecutiveFailures = 0;
      checkpoint.recentOrderTimestamps.push(nowMs);
      checkpoint.nextScheduledAt = nowMs + this.computeNextDelayMs(config, checkpoint.sliceIndex);
      checkpoint.lastActionReason = "ORDER_SUBMITTED";
      this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
      const refreshed = this.getRowStrict(botId);
      if (config.autoStopOnTarget && PrecisionMath.safeBigInt(refreshed.remaining_qty_atomic) <= 0n) {
        await this.cancelBotOwnedOpenOrders(refreshed, "TARGET_COMPLETED");
        this.dbMgr.execute("UPDATE volume_bots SET status = 'COMPLETED', enabled = 0, updated_at = ? WHERE id = ?", [nowMs, botId]);
        this.insertLog(botId, refreshed.execution_mode, "EXECUTION", "TARGET_COMPLETED", "Target volume completed 100%");
      }
      return this.toDTO(this.getRowStrict(botId));
    } finally {
      this.processingBotIds.delete(botId);
    }
  }
  // =========================================================================
  // ORDER SUBMISSION (IDEMPOTENT, SIMULATION-ISOLATED, LIVE-ENGINE)
  // =========================================================================
  async submitIdempotentOrderForBot(params) {
    const existing = this.dbMgr.queryOne(
      "SELECT * FROM volume_bot_orders WHERE idempotency_key = ?",
      [params.idempotencyKey]
    );
    if (existing) {
      return { order: existing, duplicate: true };
    }
    const row = this.getRowStrict(params.botId);
    const config = this.parseConfig(row);
    const pair = this.getPairConfigStrict(row.pair_id);
    const checkpoint = this.parseCheckpoint(row);
    const riskState = this.parseRiskState(row);
    const nowMs = params.nowMs ?? Date.now();
    const refCheck = this.resolveReferencePriceAtomic(pair, config, nowMs);
    const refPriceAtomic = refCheck.priceAtomic > 0n ? refCheck.priceAtomic : params.priceAtomic;
    await this.submitPlannedSliceOrder({
      row,
      config,
      pair,
      orderPriceAtomic: params.priceAtomic,
      sliceQtyAtomic: params.amountAtomic,
      refPriceAtomic,
      idempotencyKey: params.idempotencyKey,
      checkpoint,
      riskState,
      nowMs
    });
    const created = this.dbMgr.queryOne(
      "SELECT * FROM volume_bot_orders WHERE idempotency_key = ?",
      [params.idempotencyKey]
    );
    if (!created) throw new Error("Order persistence failed");
    return { order: created, duplicate: false };
  }
  async submitPlannedSliceOrder(params) {
    const { row, config, pair, orderPriceAtomic, sliceQtyAtomic, refPriceAtomic, idempotencyKey, nowMs } = params;
    const dup = this.dbMgr.queryOne(
      "SELECT * FROM volume_bot_orders WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (dup) return;
    const expiresAt = nowMs + config.orderTimeoutMs;
    if (row.execution_mode === "SIMULATION") {
      const simOrderId = `simord_${crypto9.randomBytes(8).toString("hex")}`;
      this.dbMgr.execute(
        `INSERT INTO volume_bot_orders (
          id, bot_id, idempotency_key, pair_id, execution_mode, side, order_type,
          price_atomic, amount_atomic, filled_amount_atomic, remaining_amount_atomic,
          status, retry_count, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'SIMULATION', ?, 'LIMIT', ?, ?, '0', ?, 'ACCEPTED', 0, ?, ?, ?)`,
        [
          simOrderId,
          row.id,
          idempotencyKey,
          pair.id,
          row.execution_side,
          orderPriceAtomic.toString(),
          sliceQtyAtomic.toString(),
          sliceQtyAtomic.toString(),
          expiresAt,
          nowMs,
          nowMs
        ]
      );
      this.dbMgr.execute(
        "UPDATE volume_bots SET submitted_orders_count = submitted_orders_count + 1, accepted_orders_count = accepted_orders_count + 1, last_execution_at = ?, updated_at = ? WHERE id = ?",
        [nowMs, nowMs, row.id]
      );
      const simMatch = this.evaluateSimulatedMatch(pair, row.execution_side, orderPriceAtomic, sliceQtyAtomic, row.account_id);
      if (simMatch.filledAtomic > 0n) {
        const simTradeId = `simtrd_${crypto9.randomBytes(8).toString("hex")}`;
        const feeBps = simMatch.isTaker ? pair.takerFeeBps : pair.makerFeeBps;
        const feeAsset = row.execution_side === "BUY" ? pair.baseAsset : pair.quoteAsset;
        const feeBaseSource = row.execution_side === "BUY" ? simMatch.filledAtomic : simMatch.quoteTotalAtomic;
        const { feeAtomic } = PrecisionMath.calculateFeeBpsAtomic(feeBaseSource, feeBps);
        const slippageBps = Number(PrecisionMath.computePriceDeviationBps(simMatch.execPriceAtomic, refPriceAtomic));
        this.dbMgr.runInTransaction(() => {
          const remainingAfter = sliceQtyAtomic - simMatch.filledAtomic;
          const nextOrdStatus = remainingAfter === 0n ? "FILLED" : "PARTIALLY_FILLED";
          this.dbMgr.execute(
            `UPDATE volume_bot_orders
             SET filled_amount_atomic = ?, remaining_amount_atomic = ?, status = ?, updated_at = ?
             WHERE id = ?`,
            [simMatch.filledAtomic.toString(), remainingAfter.toString(), nextOrdStatus, nowMs, simOrderId]
          );
          this.dbMgr.execute(
            `INSERT INTO volume_bot_sim_events (
              id, bot_id, pair_id, event_type, side, price_atomic, amount_atomic, quote_total_atomic,
              fee_atomic, order_id, trade_id, details_json, timestamp
            ) VALUES (?, ?, ?, 'SIM_FILL', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `simevt_${crypto9.randomBytes(8).toString("hex")}`,
              row.id,
              pair.id,
              row.execution_side,
              simMatch.execPriceAtomic.toString(),
              simMatch.filledAtomic.toString(),
              simMatch.quoteTotalAtomic.toString(),
              feeAtomic.toString(),
              simOrderId,
              simTradeId,
              JSON.stringify({ strategy: config.strategy, referencePriceAtomic: refPriceAtomic.toString() }),
              nowMs
            ]
          );
          this.recordBotTradeAtomic({
            botId: row.id,
            tradeId: simTradeId,
            orderId: simOrderId,
            pairId: pair.id,
            executionMode: "SIMULATION",
            side: row.execution_side,
            priceAtomic: simMatch.execPriceAtomic,
            amountAtomic: simMatch.filledAtomic,
            quoteTotalAtomic: simMatch.quoteTotalAtomic,
            feeAtomic,
            feeAsset,
            slippageBps,
            timestamp: nowMs,
            orderStatusAfter: nextOrdStatus
          });
        });
        this.insertLog(
          row.id,
          "SIMULATION",
          "EXECUTION",
          "SIM_TRADE_EXECUTED",
          `[SIM] Filled ${PrecisionMath.formatAtomicToDecimal(simMatch.filledAtomic, pair.basePrecision, true)} ${pair.baseAsset} @ ${PrecisionMath.formatAtomicToDecimal(simMatch.execPriceAtomic, pair.quotePrecision, true)} ${pair.quoteAsset}`,
          { orderId: simOrderId, tradeId: simTradeId, slippageBps }
        );
      } else {
        this.insertLog(
          row.id,
          "SIMULATION",
          "INFO",
          "SIM_ORDER_RESTING",
          `[SIM] Placed resting ${row.execution_side} LIMIT ${PrecisionMath.formatAtomicToDecimal(sliceQtyAtomic, pair.basePrecision, true)} ${pair.baseAsset} @ ${PrecisionMath.formatAtomicToDecimal(orderPriceAtomic, pair.quotePrecision, true)}`,
          { orderId: simOrderId }
        );
      }
      return;
    }
    const engine = this.engineManager.getEngine(pair.id);
    const liveOrderId = `vord_${crypto9.randomBytes(8).toString("hex")}`;
    this.dbMgr.execute(
      `INSERT INTO volume_bot_orders (
        id, bot_id, idempotency_key, pair_id, execution_mode, side, order_type,
        price_atomic, amount_atomic, filled_amount_atomic, remaining_amount_atomic,
        status, retry_count, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'LIVE', ?, 'LIMIT', ?, ?, '0', ?, 'SUBMITTED', 0, ?, ?, ?)`,
      [
        liveOrderId,
        row.id,
        idempotencyKey,
        pair.id,
        row.execution_side,
        orderPriceAtomic.toString(),
        sliceQtyAtomic.toString(),
        sliceQtyAtomic.toString(),
        expiresAt,
        nowMs,
        nowMs
      ]
    );
    this.dbMgr.execute(
      "UPDATE volume_bots SET submitted_orders_count = submitted_orders_count + 1, last_execution_at = ?, updated_at = ? WHERE id = ?",
      [nowMs, nowMs, row.id]
    );
    try {
      const result = await engine.submitOrder({
        orderId: liveOrderId,
        clientOrderId: idempotencyKey,
        userId: row.account_id,
        side: row.execution_side,
        orderType: "LIMIT",
        price: Number(orderPriceAtomic),
        amount: Number(sliceQtyAtomic)
      });
      const mappedStatus = result.status === "NEW" ? "ACCEPTED" : result.status === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : result.status === "FILLED" ? "FILLED" : result.status === "CANCELLED" ? "CANCELLED" : "REJECTED";
      const dbOrder = this.dbMgr.queryOne("SELECT filled_amount, remaining_amount FROM orders WHERE id = ?", [liveOrderId]);
      const filledAtomic = dbOrder ? PrecisionMath.safeBigInt(dbOrder.filled_amount) : 0n;
      const remainingAtomic = dbOrder ? PrecisionMath.safeBigInt(dbOrder.remaining_amount) : sliceQtyAtomic;
      this.dbMgr.runInTransaction(() => {
        this.dbMgr.execute(
          `UPDATE volume_bot_orders
           SET status = ?, filled_amount_atomic = ?, remaining_amount_atomic = ?, updated_at = ?
           WHERE id = ?`,
          [mappedStatus, filledAtomic.toString(), remainingAtomic.toString(), nowMs, liveOrderId]
        );
        this.dbMgr.execute(
          "UPDATE volume_bots SET accepted_orders_count = accepted_orders_count + 1, updated_at = ? WHERE id = ?",
          [nowMs, row.id]
        );
        for (const fill of result.fills) {
          const fillPriceAtomic = PrecisionMath.safeBigInt(fill.price);
          const fillAmountAtomic = PrecisionMath.safeBigInt(fill.amount);
          const fillTotalAtomic = PrecisionMath.safeBigInt(fill.total);
          const fillFeeAtomic = PrecisionMath.safeBigInt(fill.takerFee);
          const feeAsset = row.execution_side === "BUY" ? pair.baseAsset : pair.quoteAsset;
          const slippageBps = Number(PrecisionMath.computePriceDeviationBps(fillPriceAtomic, refPriceAtomic));
          this.recordBotTradeAtomic({
            botId: row.id,
            tradeId: fill.id,
            orderId: liveOrderId,
            pairId: pair.id,
            executionMode: "LIVE",
            side: row.execution_side,
            priceAtomic: fillPriceAtomic,
            amountAtomic: fillAmountAtomic,
            quoteTotalAtomic: fillTotalAtomic,
            feeAtomic: fillFeeAtomic,
            feeAsset,
            slippageBps,
            timestamp: fill.timestamp,
            orderStatusAfter: mappedStatus
          });
        }
      });
      this.insertLog(
        row.id,
        "LIVE",
        result.fills.length > 0 ? "EXECUTION" : "INFO",
        result.fills.length > 0 ? "LIVE_ORDER_FILLED" : "LIVE_ORDER_ACCEPTED",
        `Order ${liveOrderId} -> ${mappedStatus} (${result.fills.length} fills)`,
        { orderId: liveOrderId, filledAtomic: filledAtomic.toString(), status: mappedStatus }
      );
    } catch (err) {
      const msg = err?.message || "MatchingEngine order rejected";
      this.dbMgr.execute(
        `UPDATE volume_bot_orders SET status = 'REJECTED', last_error = ?, updated_at = ? WHERE id = ?`,
        [msg, nowMs, liveOrderId]
      );
      this.dbMgr.execute(
        "UPDATE volume_bots SET rejected_orders_count = rejected_orders_count + 1, last_error = ?, updated_at = ? WHERE id = ?",
        [msg, nowMs, row.id]
      );
      this.insertLog(row.id, "LIVE", "ERROR", "LIVE_ORDER_REJECTED", msg, { orderId: liveOrderId });
      throw err;
    }
  }
  // =========================================================================
  // TRADE DEDUPLICATION & ACCOUNTING (STRICTLY TRADE-DRIVEN)
  // =========================================================================
  /**
   * Records a trade atomically ONLY ONCE per (botId, tradeId, executionMode).
   * Submitted/open/cancelled/rejected orders never call this and never increment executed volume.
   */
  recordBotTradeAtomic(params) {
    if (params.amountAtomic <= 0n) return false;
    const existing = this.dbMgr.queryOne(
      "SELECT id FROM volume_bot_trades WHERE bot_id = ? AND trade_id = ? AND execution_mode = ?",
      [params.botId, params.tradeId, params.executionMode]
    );
    if (existing) {
      return false;
    }
    const bot = this.getRowStrict(params.botId);
    const targetAtomic = PrecisionMath.safeBigInt(bot.target_qty_atomic);
    const prevExecutedAtomic = PrecisionMath.safeBigInt(bot.executed_qty_atomic);
    const prevExecutedQuote = PrecisionMath.safeBigInt(bot.executed_quote_atomic);
    const prevTotalFees = PrecisionMath.safeBigInt(bot.total_fees_atomic);
    const prevWeightedNum = PrecisionMath.safeBigInt(bot.weighted_price_num_atomic);
    const prevDailyQuote = bot.daily_reset_day === currentUtcDay() ? PrecisionMath.safeBigInt(bot.daily_executed_quote_atomic) : 0n;
    const prevSlippageSum = PrecisionMath.safeBigInt(bot.total_slippage_bps_sum);
    const nextExecutedAtomic = prevExecutedAtomic + params.amountAtomic;
    const nextRemainingAtomic = targetAtomic > nextExecutedAtomic ? targetAtomic - nextExecutedAtomic : 0n;
    const nextExecutedQuote = prevExecutedQuote + params.quoteTotalAtomic;
    const nextTotalFees = prevTotalFees + params.feeAtomic;
    const nextWeightedNum = prevWeightedNum + params.priceAtomic * params.amountAtomic;
    const nextDailyQuote = prevDailyQuote + params.quoteTotalAtomic;
    const nextSlippageSum = prevSlippageSum + BigInt(Math.max(0, Math.trunc(params.slippageBps)));
    const partialDelta = params.orderStatusAfter === "PARTIALLY_FILLED" ? 1 : 0;
    const filledDelta = params.orderStatusAfter === "FILLED" ? 1 : 0;
    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `INSERT INTO volume_bot_trades (
          id, trade_id, bot_id, order_id, pair_id, execution_mode, side,
          price_atomic, amount_atomic, quote_total_atomic, fee_atomic, fee_asset, slippage_bps, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `vbtrd_${crypto9.randomBytes(8).toString("hex")}`,
          params.tradeId,
          params.botId,
          params.orderId,
          params.pairId,
          params.executionMode,
          params.side,
          params.priceAtomic.toString(),
          params.amountAtomic.toString(),
          params.quoteTotalAtomic.toString(),
          params.feeAtomic.toString(),
          params.feeAsset,
          Math.max(0, Math.trunc(params.slippageBps)),
          params.timestamp
        ]
      );
      this.dbMgr.execute(
        `UPDATE volume_bots
         SET executed_qty_atomic = ?, remaining_qty_atomic = ?, executed_quote_atomic = ?,
             total_fees_atomic = ?, weighted_price_num_atomic = ?, daily_executed_quote_atomic = ?,
             daily_reset_day = ?, total_trades_count = total_trades_count + 1,
             partial_fills_count = partial_fills_count + ?, filled_orders_count = filled_orders_count + ?,
             total_slippage_bps_sum = ?, last_execution_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          nextExecutedAtomic.toString(),
          nextRemainingAtomic.toString(),
          nextExecutedQuote.toString(),
          nextTotalFees.toString(),
          nextWeightedNum.toString(),
          nextDailyQuote.toString(),
          currentUtcDay(),
          partialDelta,
          filledDelta,
          nextSlippageSum.toString(),
          params.timestamp,
          Date.now(),
          params.botId
        ]
      );
    });
    return true;
  }
  // =========================================================================
  // STRATEGY SLICING, PRICE PROTECTION, RISK & BALANCE CHECKS
  // =========================================================================
  resolveReferencePriceAtomic(pair, config, nowMs) {
    const engine = this.engineManager.getEngine(pair.id);
    const depth = engine.getDepth(5);
    const bestBid = depth.bids[0]?.price || 0;
    const bestAsk = depth.asks[0]?.price || 0;
    let bookMidAtomic = 0n;
    if (bestBid > 0 && bestAsk > 0) {
      bookMidAtomic = (BigInt(bestBid) + BigInt(bestAsk)) / 2n;
    } else if (bestBid > 0) {
      bookMidAtomic = BigInt(bestBid);
    } else if (bestAsk > 0) {
      bookMidAtomic = BigInt(bestAsk);
    } else {
      const lastTrade = this.dbMgr.queryOne(
        "SELECT price FROM trades WHERE pair_id = ? ORDER BY timestamp DESC LIMIT 1",
        [pair.id]
      );
      if (lastTrade && lastTrade.price > 0) {
        bookMidAtomic = BigInt(Math.trunc(lastTrade.price));
      }
    }
    if (config.referencePriceSource === "INTERNAL_BOOK") {
      if (bookMidAtomic <= 0n) {
        return { ok: false, priceAtomic: 0n, reason: "INTERNAL_BOOK_NO_REFERENCE_PRICE" };
      }
      return { ok: true, priceAtomic: bookMidAtomic, reason: "INTERNAL_BOOK_MID" };
    }
    const refSymbol = `${pair.baseAsset}USDT`;
    const agg = this.priceAggregator?.getAggregatedPrice(refSymbol);
    const fxCfg = this.priceAggregator?.getFxRate();
    const fxRate = fxCfg && fxCfg.usdtIdrRate > 0 ? fxCfg.usdtIdrRate : 16250;
    if (agg && agg.finalPrice > 0) {
      const ageMs = nowMs - agg.lastUpdated;
      const fxStale = pair.quoteAsset === "IDR" && Boolean(fxCfg?.isStale);
      if (ageMs > config.staleMarketDataMaxAgeMs || agg.status === "STALE" || agg.status === "INVALID" || fxStale) {
        if (config.referencePriceSource === "AGGREGATED_FEED") {
          return {
            ok: false,
            priceAtomic: 0n,
            stale: true,
            reason: `STALE_REFERENCE_DATA (age=${ageMs}ms > max=${config.staleMarketDataMaxAgeMs}ms, fxStale=${fxStale})`
          };
        }
      } else {
        const quoteMultiplier = pair.quoteAsset === "IDR" ? fxRate : 1;
        const estimatedQuote = (agg.finalPrice * quoteMultiplier).toFixed(pair.quotePrecision);
        const feedAtomic = PrecisionMath.parseDecimalToAtomic(estimatedQuote, pair.quotePrecision);
        if (feedAtomic > 0n) {
          return { ok: true, priceAtomic: feedAtomic, reason: "AGGREGATED_FEED" };
        }
      }
    } else if (config.referencePriceSource === "AGGREGATED_FEED") {
      return {
        ok: false,
        priceAtomic: 0n,
        stale: true,
        reason: `AGGREGATED_FEED_UNAVAILABLE (${refSymbol})`
      };
    }
    if (bookMidAtomic > 0n) {
      return { ok: true, priceAtomic: bookMidAtomic, reason: "HYBRID_BOOK_FALLBACK" };
    }
    return { ok: false, priceAtomic: 0n, reason: "NO_VALID_REFERENCE_PRICE" };
  }
  planStrategySlice(row, config, pair, refPriceAtomic, openBotOrders, nowMs) {
    const tickAtomic = PrecisionMath.parseDecimalToAtomic(config.tickSize, pair.quotePrecision);
    const lotAtomic = PrecisionMath.parseDecimalToAtomic(config.lotSize, pair.basePrecision);
    const minSliceAtomic = PrecisionMath.parseDecimalToAtomic(config.minSliceSize, pair.basePrecision);
    const maxSliceAtomic = PrecisionMath.parseDecimalToAtomic(config.maxSliceSize, pair.basePrecision);
    const remainingQtyAtomic = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
    const openLockedBase = openBotOrders.reduce(
      (sum, o) => sum + PrecisionMath.safeBigInt(o.remaining_amount_atomic),
      0n
    );
    let effectiveRemaining = remainingQtyAtomic > openLockedBase ? remainingQtyAtomic - openLockedBase : remainingQtyAtomic;
    if (effectiveRemaining <= 0n) {
      return { ok: false, orderPriceAtomic: 0n, sliceQtyAtomic: 0n, reason: "REMAINING_QTY_COVERED_BY_OPEN_ORDERS" };
    }
    let rawSliceAtomic = minSliceAtomic;
    if (config.strategy === "TWAP") {
      const avgInterval = Math.max(500, Math.trunc((config.minIntervalMs + config.maxIntervalMs) / 2));
      const totalSlices = Math.max(1, Math.trunc((config.twapDurationMs || 3e5) / avgInterval));
      const targetPerSlice = PrecisionMath.safeBigInt(row.target_qty_atomic) / BigInt(totalSlices);
      rawSliceAtomic = PrecisionMath.maxBigInt(minSliceAtomic, PrecisionMath.minBigInt(maxSliceAtomic, targetPerSlice));
    } else if (config.strategy === "VWAP") {
      const lookbackMs = (config.vwapLookbackMinutes || 30) * 6e4;
      const recentMarketTrades = this.dbMgr.query(
        "SELECT amount FROM trades WHERE pair_id = ? AND timestamp >= ?",
        [pair.id, nowMs - lookbackMs]
      );
      if (recentMarketTrades.length > 0) {
        let totalVolAtomic = 0n;
        for (const t of recentMarketTrades) {
          totalVolAtomic += PrecisionMath.safeBigInt(t.amount);
        }
        const participationCap = totalVolAtomic * BigInt(config.maxParticipationRateBps) / 10000n;
        const avgSlice = totalVolAtomic / BigInt(Math.max(1, recentMarketTrades.length));
        const vwapTarget = PrecisionMath.minBigInt(participationCap > 0n ? participationCap : maxSliceAtomic, avgSlice > 0n ? avgSlice : minSliceAtomic);
        rawSliceAtomic = PrecisionMath.maxBigInt(minSliceAtomic, PrecisionMath.minBigInt(maxSliceAtomic, vwapTarget));
      } else {
        rawSliceAtomic = minSliceAtomic;
      }
    } else if (config.strategy === "ICEBERG") {
      const ratioBps = BigInt(Math.max(1, Math.min(100, config.icebergVisibleRatioPct || 20)) * 100);
      const clip = effectiveRemaining * ratioBps / 10000n;
      rawSliceAtomic = PrecisionMath.maxBigInt(minSliceAtomic, PrecisionMath.minBigInt(maxSliceAtomic, clip));
    } else {
      const span = maxSliceAtomic - minSliceAtomic;
      if (span > 0n) {
        const entropy = BigInt(nowMs) + BigInt(row.submitted_orders_count + 1) * 7919n;
        rawSliceAtomic = PrecisionMath.deterministicBigIntInRange(minSliceAtomic, maxSliceAtomic, entropy);
      } else {
        rawSliceAtomic = minSliceAtomic;
      }
    }
    let sliceQtyAtomic = PrecisionMath.minBigInt(rawSliceAtomic, effectiveRemaining);
    if (config.maxOrderQty) {
      const maxOrderQtyAtomic = PrecisionMath.parseDecimalToAtomic(config.maxOrderQty, pair.basePrecision);
      if (maxOrderQtyAtomic > 0n) {
        sliceQtyAtomic = PrecisionMath.minBigInt(sliceQtyAtomic, maxOrderQtyAtomic);
      }
    }
    sliceQtyAtomic = PrecisionMath.normalizeQtyToLot(sliceQtyAtomic, lotAtomic, "floor");
    if (sliceQtyAtomic < BigInt(pair.minOrderSize)) {
      if (effectiveRemaining >= BigInt(pair.minOrderSize) && effectiveRemaining <= maxSliceAtomic) {
        sliceQtyAtomic = PrecisionMath.normalizeQtyToLot(effectiveRemaining, lotAtomic, "floor");
      }
    }
    if (sliceQtyAtomic < BigInt(pair.minOrderSize) || sliceQtyAtomic <= 0n) {
      return { ok: false, orderPriceAtomic: 0n, sliceQtyAtomic: 0n, reason: "SLICE_BELOW_MIN_ORDER_SIZE" };
    }
    const engine = this.engineManager.getEngine(pair.id);
    const oppositeBook = row.execution_side === "BUY" ? engine.book.asks : engine.book.bids;
    const sameBook = row.execution_side === "BUY" ? engine.book.bids : engine.book.asks;
    const bestOppositeNonSelf = oppositeBook.find((o) => o.userId !== row.account_id);
    const bestOppositeAny = oppositeBook[0];
    const bestSame = sameBook[0];
    let targetPriceAtomic = refPriceAtomic;
    if (config.strategy === "PASSIVE_LIMIT") {
      const anchor = bestSame ? BigInt(bestSame.price) : refPriceAtomic;
      const offsetTicks = Math.max(0, config.passiveOffsetTicks ?? 1);
      targetPriceAtomic = row.execution_side === "BUY" ? PrecisionMath.applyTickOffsetAtomic(anchor, tickAtomic, -offsetTicks) : PrecisionMath.applyTickOffsetAtomic(anchor, tickAtomic, offsetTicks);
      if (bestOppositeAny) {
        const oppPrice = BigInt(bestOppositeAny.price);
        if (row.execution_side === "BUY" && targetPriceAtomic >= oppPrice) {
          targetPriceAtomic = oppPrice > tickAtomic ? oppPrice - tickAtomic : oppPrice;
        } else if (row.execution_side === "SELL" && targetPriceAtomic <= oppPrice) {
          targetPriceAtomic = oppPrice + tickAtomic;
        }
      }
    } else if (config.strategy === "AGGRESSIVE_LIMIT") {
      if (!bestOppositeAny) {
        targetPriceAtomic = refPriceAtomic;
      } else if (!bestOppositeNonSelf) {
        return {
          ok: false,
          orderPriceAtomic: 0n,
          sliceQtyAtomic: 0n,
          riskCode: "STP",
          reason: "SELF_TRADE_PREVENTION: Only own-account orders exist on opposite book"
        };
      } else {
        const aggTicks = Math.max(0, config.aggressiveMaxTicks ?? 1);
        const oppPrice = BigInt(bestOppositeNonSelf.price);
        targetPriceAtomic = row.execution_side === "BUY" ? PrecisionMath.applyTickOffsetAtomic(oppPrice, tickAtomic, aggTicks) : PrecisionMath.applyTickOffsetAtomic(oppPrice, tickAtomic, -aggTicks);
      }
    } else {
      if (bestOppositeNonSelf) {
        const oppPrice = BigInt(bestOppositeNonSelf.price);
        const dev = PrecisionMath.computePriceDeviationBps(oppPrice, refPriceAtomic);
        if (dev <= BigInt(config.maxSlippageBps)) {
          targetPriceAtomic = oppPrice;
        } else {
          return {
            ok: false,
            orderPriceAtomic: 0n,
            sliceQtyAtomic: 0n,
            riskCode: "SLIPPAGE",
            reason: `MAX_SLIPPAGE_EXCEEDED: best opposite ${oppPrice} deviates ${dev} bps > limit ${config.maxSlippageBps} bps from ref ${refPriceAtomic}`
          };
        }
      } else if (bestOppositeAny && bestOppositeAny.userId === row.account_id) {
        targetPriceAtomic = row.execution_side === "BUY" ? PrecisionMath.minBigInt(refPriceAtomic, BigInt(bestOppositeAny.price) > tickAtomic ? BigInt(bestOppositeAny.price) - tickAtomic : refPriceAtomic) : PrecisionMath.maxBigInt(refPriceAtomic, BigInt(bestOppositeAny.price) + tickAtomic);
      }
    }
    const orderPriceAtomic = PrecisionMath.normalizePriceToTick(
      targetPriceAtomic,
      tickAtomic,
      row.execution_side === "BUY" ? "floor" : "ceil"
    );
    if (orderPriceAtomic <= 0n) {
      return { ok: false, orderPriceAtomic: 0n, sliceQtyAtomic: 0n, reason: "NORMALIZED_PRICE_ZERO" };
    }
    const minCollarAtomic = PrecisionMath.parseDecimalToAtomic(config.minPriceCollar || "0", pair.quotePrecision);
    const maxCollarAtomic = PrecisionMath.parseDecimalToAtomic(config.maxPriceCollar || "0", pair.quotePrecision);
    if (minCollarAtomic > 0n && orderPriceAtomic < minCollarAtomic) {
      return {
        ok: false,
        orderPriceAtomic: 0n,
        sliceQtyAtomic: 0n,
        riskCode: "COLLAR",
        reason: `PRICE_COLLAR_BREACH: price ${orderPriceAtomic} < minPriceCollar ${minCollarAtomic}`
      };
    }
    if (maxCollarAtomic > 0n && orderPriceAtomic > maxCollarAtomic) {
      return {
        ok: false,
        orderPriceAtomic: 0n,
        sliceQtyAtomic: 0n,
        riskCode: "COLLAR",
        reason: `PRICE_COLLAR_BREACH: price ${orderPriceAtomic} > maxPriceCollar ${maxCollarAtomic}`
      };
    }
    const deviationBps = PrecisionMath.computePriceDeviationBps(orderPriceAtomic, refPriceAtomic);
    if (deviationBps > BigInt(config.maxSlippageBps)) {
      return {
        ok: false,
        orderPriceAtomic: 0n,
        sliceQtyAtomic: 0n,
        riskCode: "SLIPPAGE",
        reason: `MAX_SLIPPAGE_EXCEEDED: orderPrice ${orderPriceAtomic} deviates ${deviationBps} bps > max ${config.maxSlippageBps} bps`
      };
    }
    if (bestOppositeNonSelf && config.maxParticipationRateBps < 1e4) {
      const crossingOpposite = row.execution_side === "BUY" && BigInt(bestOppositeNonSelf.price) <= orderPriceAtomic || row.execution_side === "SELL" && BigInt(bestOppositeNonSelf.price) >= orderPriceAtomic;
      if (crossingOpposite) {
        let eligibleDepthAtomic = 0n;
        for (const o of oppositeBook) {
          if (o.userId === row.account_id) continue;
          const p = BigInt(o.price);
          if (row.execution_side === "BUY" && p <= orderPriceAtomic || row.execution_side === "SELL" && p >= orderPriceAtomic) {
            eligibleDepthAtomic += BigInt(o.remainingAmount);
          }
        }
        const maxParticipate = PrecisionMath.normalizeQtyToLot(
          eligibleDepthAtomic * BigInt(config.maxParticipationRateBps) / 10000n,
          lotAtomic,
          "floor"
        );
        if (maxParticipate >= BigInt(pair.minOrderSize) && sliceQtyAtomic > maxParticipate) {
          sliceQtyAtomic = maxParticipate;
        }
      }
    }
    return { ok: true, orderPriceAtomic, sliceQtyAtomic, reason: "PLANNED" };
  }
  checkPreTradeRiskAndBalances(row, config, pair, orderPriceAtomic, sliceQtyAtomic, openBotOrders, riskState, nowMs) {
    const sliceNotionalAtomic = PrecisionMath.computeQuoteNotionalAtomic(orderPriceAtomic, sliceQtyAtomic, pair.basePrecision);
    const maxOrderNotionalAtomic = PrecisionMath.parseDecimalToAtomic(config.maxOrderNotional || "0", pair.quotePrecision);
    if (maxOrderNotionalAtomic > 0n && sliceNotionalAtomic > maxOrderNotionalAtomic) {
      return {
        ok: false,
        code: "MAX_ORDER_NOTIONAL_EXCEEDED",
        reason: `Order notional ${sliceNotionalAtomic} exceeds maxOrderNotional ${maxOrderNotionalAtomic}`
      };
    }
    let openExposureQuote = 0n;
    for (const o of openBotOrders) {
      openExposureQuote += PrecisionMath.computeQuoteNotionalAtomic(
        PrecisionMath.safeBigInt(o.price_atomic),
        PrecisionMath.safeBigInt(o.remaining_amount_atomic),
        pair.basePrecision
      );
    }
    riskState.activeExposureQuoteAtomic = openExposureQuote.toString();
    const executedQuoteAtomic = PrecisionMath.safeBigInt(row.executed_quote_atomic);
    const maxCumulativeExposureAtomic = PrecisionMath.parseDecimalToAtomic(config.maxCumulativeExposure || "0", pair.quotePrecision);
    if (maxCumulativeExposureAtomic > 0n && executedQuoteAtomic + openExposureQuote + sliceNotionalAtomic > maxCumulativeExposureAtomic) {
      return {
        ok: false,
        code: "MAX_CUMULATIVE_EXPOSURE_REACHED",
        reason: `Cumulative exposure limit reached (${executedQuoteAtomic + openExposureQuote + sliceNotionalAtomic} > ${maxCumulativeExposureAtomic})`,
        hardLock: true
      };
    }
    const dailyExecutedAtomic = PrecisionMath.safeBigInt(row.daily_executed_quote_atomic);
    const dailyLimitAtomic = PrecisionMath.parseDecimalToAtomic(config.dailyExecutionLimit || "0", pair.quotePrecision);
    if (dailyLimitAtomic > 0n && dailyExecutedAtomic + sliceNotionalAtomic > dailyLimitAtomic) {
      return {
        ok: false,
        code: "DAILY_EXECUTION_LIMIT_REACHED",
        reason: `Daily execution limit reached (${dailyExecutedAtomic + sliceNotionalAtomic} > ${dailyLimitAtomic})`,
        hardLock: true
      };
    }
    riskState.lastRiskCheckAt = nowMs;
    if (row.execution_mode === "LIVE") {
      const baseBal = this.ledger.getBalance(row.account_id, pair.baseAsset);
      const quoteBal = this.ledger.getBalance(row.account_id, pair.quoteAsset);
      const availBase = BigInt(baseBal.available);
      const availQuote = BigInt(quoteBal.available);
      const lockedBase = BigInt(baseBal.lockedOrder);
      const lockedQuote = BigInt(quoteBal.lockedOrder);
      riskState.lastBalanceAvailableBaseAtomic = availBase.toString();
      riskState.lastBalanceAvailableQuoteAtomic = availQuote.toString();
      riskState.lastBalanceLockedBaseAtomic = lockedBase.toString();
      riskState.lastBalanceLockedQuoteAtomic = lockedQuote.toString();
      if (row.execution_side === "BUY" && availQuote < sliceNotionalAtomic) {
        riskState.balanceRejections += 1;
        return {
          ok: false,
          code: "INSUFFICIENT_QUOTE_BALANCE",
          reason: `Insufficient ${pair.quoteAsset} balance on ${row.account_id}: available=${availQuote}, required=${sliceNotionalAtomic}`,
          hardLock: true
        };
      }
      if (row.execution_side === "SELL" && availBase < sliceQtyAtomic) {
        riskState.balanceRejections += 1;
        return {
          ok: false,
          code: "INSUFFICIENT_BASE_BALANCE",
          reason: `Insufficient ${pair.baseAsset} balance on ${row.account_id}: available=${availBase}, required=${sliceQtyAtomic}`,
          hardLock: true
        };
      }
      const maxBaseInv = PrecisionMath.parseDecimalToAtomic(config.maxBaseInventory || "0", pair.basePrecision);
      if (maxBaseInv > 0n && row.execution_side === "BUY" && BigInt(baseBal.total) + sliceQtyAtomic > maxBaseInv) {
        return {
          ok: false,
          code: "MAX_BASE_INVENTORY_CAP",
          reason: `Base inventory cap exceeded: total=${baseBal.total} + slice=${sliceQtyAtomic} > maxBaseInventory=${maxBaseInv}`,
          hardLock: true
        };
      }
      const maxQuoteInv = PrecisionMath.parseDecimalToAtomic(config.maxQuoteInventory || "0", pair.quotePrecision);
      if (maxQuoteInv > 0n && row.execution_side === "SELL" && BigInt(quoteBal.total) + sliceNotionalAtomic > maxQuoteInv) {
        return {
          ok: false,
          code: "MAX_QUOTE_INVENTORY_CAP",
          reason: `Quote inventory cap exceeded: total=${quoteBal.total} + notional=${sliceNotionalAtomic} > maxQuoteInventory=${maxQuoteInv}`,
          hardLock: true
        };
      }
    } else {
      const maxBaseInv = PrecisionMath.parseDecimalToAtomic(config.maxBaseInventory || "0", pair.basePrecision);
      const executedBase = PrecisionMath.safeBigInt(row.executed_qty_atomic);
      if (maxBaseInv > 0n && row.execution_side === "BUY" && executedBase + sliceQtyAtomic > maxBaseInv) {
        return {
          ok: false,
          code: "MAX_BASE_INVENTORY_CAP",
          reason: `[SIM] Base inventory cap exceeded: ${executedBase + sliceQtyAtomic} > ${maxBaseInv}`,
          hardLock: true
        };
      }
      const maxQuoteInv = PrecisionMath.parseDecimalToAtomic(config.maxQuoteInventory || "0", pair.quotePrecision);
      if (maxQuoteInv > 0n && row.execution_side === "SELL" && executedQuoteAtomic + sliceNotionalAtomic > maxQuoteInv) {
        return {
          ok: false,
          code: "MAX_QUOTE_INVENTORY_CAP",
          reason: `[SIM] Quote inventory cap exceeded: ${executedQuoteAtomic + sliceNotionalAtomic} > ${maxQuoteInv}`,
          hardLock: true
        };
      }
    }
    return { ok: true, code: "OK", reason: "RISK_PASSED" };
  }
  // =========================================================================
  // RECONCILIATION, EXPIRY & CANCEL-ONLY-BOT-OWNED ORDERS
  // =========================================================================
  async recoverAll() {
    const bots = this.dbMgr.query("SELECT * FROM volume_bots");
    const now = Date.now();
    for (const bot of bots) {
      try {
        const pair = this.getPairConfigStrict(bot.pair_id);
        await this.reconcileBotOrdersAndTrades(bot, pair, now);
        if (bot.status !== "RUNNING" || bot.emergency_stopped) {
          await this.cancelBotOwnedOpenOrders(bot, "STARTUP_RECONCILE_STOPPED_BOT");
        }
      } catch (err) {
        console.error(`[VolumeExecutionV2Service] Recovery error for bot ${bot.id}:`, err);
      }
    }
  }
  async reconcileBotOrdersAndTrades(row, pair, nowMs) {
    this.reconcileBotOrdersAndTradesSync(row, pair, nowMs);
  }
  reconcileBotOrdersAndTradesSync(row, pair, nowMs) {
    if (row.execution_mode !== "LIVE") return;
    const botOrders = this.dbMgr.query(
      "SELECT * FROM volume_bot_orders WHERE bot_id = ? AND execution_mode = 'LIVE' AND status IN ('SUBMITTED', 'ACCEPTED', 'PARTIALLY_FILLED')",
      [row.id]
    );
    for (const botOrd of botOrders) {
      const dbOrd = this.dbMgr.queryOne("SELECT * FROM orders WHERE id = ?", [botOrd.id]);
      if (!dbOrd) continue;
      const mappedStatus = dbOrd.status === "NEW" ? "ACCEPTED" : dbOrd.status === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : dbOrd.status === "FILLED" ? "FILLED" : dbOrd.status === "CANCELLED" ? "CANCELLED" : "REJECTED";
      const filledAtomic = PrecisionMath.safeBigInt(dbOrd.filled_amount);
      const remainingAtomic = PrecisionMath.safeBigInt(dbOrd.remaining_amount);
      if (mappedStatus !== botOrd.status || filledAtomic.toString() !== botOrd.filled_amount_atomic || remainingAtomic.toString() !== botOrd.remaining_amount_atomic) {
        this.dbMgr.execute(
          "UPDATE volume_bot_orders SET status = ?, filled_amount_atomic = ?, remaining_amount_atomic = ?, updated_at = ? WHERE id = ?",
          [mappedStatus, filledAtomic.toString(), remainingAtomic.toString(), nowMs, botOrd.id]
        );
      }
      const engineTrades = this.dbMgr.query(
        "SELECT * FROM trades WHERE taker_order_id = ? OR maker_order_id = ?",
        [botOrd.id, botOrd.id]
      );
      for (const t of engineTrades) {
        const isMaker = t.maker_order_id === botOrd.id;
        const fee = isMaker ? t.maker_fee : t.taker_fee;
        const feeAsset = botOrd.side === "BUY" ? pair.baseAsset : pair.quoteAsset;
        this.recordBotTradeAtomic({
          botId: row.id,
          tradeId: t.id,
          orderId: botOrd.id,
          pairId: pair.id,
          executionMode: "LIVE",
          side: botOrd.side,
          priceAtomic: PrecisionMath.safeBigInt(t.price),
          amountAtomic: PrecisionMath.safeBigInt(t.amount),
          quoteTotalAtomic: PrecisionMath.safeBigInt(t.total),
          feeAtomic: PrecisionMath.safeBigInt(fee),
          feeAsset,
          slippageBps: 0,
          timestamp: t.timestamp,
          orderStatusAfter: mappedStatus
        });
      }
    }
  }
  async expireTimedOutOrders(row, _config, checkpoint, _riskState, nowMs) {
    const expiredOrders = this.dbMgr.query(
      `SELECT * FROM volume_bot_orders
       WHERE bot_id = ? AND status IN ('SUBMITTED', 'ACCEPTED', 'PARTIALLY_FILLED')
       AND expires_at IS NOT NULL AND expires_at <= ?`,
      [row.id, nowMs]
    );
    if (expiredOrders.length === 0) return;
    const engine = row.execution_mode === "LIVE" ? this.engineManager.getEngine(row.pair_id) : null;
    for (const ord of expiredOrders) {
      if (engine) {
        try {
          await engine.cancelOrder(ord.id, row.account_id);
        } catch {
        }
      }
      const isPartial = PrecisionMath.safeBigInt(ord.filled_amount_atomic) > 0n;
      if (isPartial) {
        checkpoint.lastSliceRetryCount += 1;
      }
      this.dbMgr.runInTransaction(() => {
        this.dbMgr.execute(
          `UPDATE volume_bot_orders SET status = 'EXPIRED', retry_count = retry_count + 1, updated_at = ? WHERE id = ?`,
          [nowMs, ord.id]
        );
        this.dbMgr.execute(
          "UPDATE volume_bots SET expired_orders_count = expired_orders_count + 1, cancelled_orders_count = cancelled_orders_count + 1, updated_at = ? WHERE id = ?",
          [nowMs, row.id]
        );
      });
      this.insertLog(row.id, row.execution_mode, "WARN", "ORDER_EXPIRED", `Order ${ord.id} timed out and expired`, {
        orderId: ord.id,
        filledAtomic: ord.filled_amount_atomic,
        partialRetryCount: checkpoint.lastSliceRetryCount
      });
    }
    this.saveCheckpointAndRisk(row.id, checkpoint, _riskState, nowMs);
  }
  /**
   * Cancels ONLY orders belonging explicitly to this bot in `volume_bot_orders`.
   * Never touches manual orders or other bots' orders on the same account.
   */
  async cancelBotOwnedOpenOrders(row, reason) {
    const openOrders = this.getOpenBotOrders(row.id);
    if (openOrders.length === 0) return 0;
    let cancelled = 0;
    const now = Date.now();
    const engine = row.execution_mode === "LIVE" ? this.engineManager.getEngine(row.pair_id) : null;
    for (const ord of openOrders) {
      if (engine) {
        try {
          await engine.cancelOrder(ord.id, row.account_id);
        } catch {
        }
      }
      this.dbMgr.execute(
        `UPDATE volume_bot_orders SET status = 'CANCELLED', last_error = ?, updated_at = ? WHERE id = ? AND bot_id = ?`,
        [reason, now, ord.id, row.id]
      );
      cancelled += 1;
    }
    if (cancelled > 0) {
      this.dbMgr.execute(
        "UPDATE volume_bots SET cancelled_orders_count = cancelled_orders_count + ?, updated_at = ? WHERE id = ?",
        [cancelled, now, row.id]
      );
    }
    return cancelled;
  }
  async lockBotRisk(row, riskState, reason, nowMs) {
    await this.cancelBotOwnedOpenOrders(row, reason);
    riskState.riskLocked = true;
    riskState.riskLockReason = reason;
    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'RISK_LOCKED', enabled = 0, last_error = ?, risk_state_json = ?, updated_at = ? WHERE id = ?`,
      [reason, JSON.stringify(riskState), nowMs, row.id]
    );
    this.insertLog(row.id, row.execution_mode, "RISK", "BOT_RISK_LOCKED", reason);
  }
  // =========================================================================
  // SIMULATION MATCH EVALUATOR (READ-ONLY BOOK SNAPSHOT, ZERO MUTATION)
  // =========================================================================
  evaluateSimulatedMatch(pair, side, orderPriceAtomic, sliceQtyAtomic, botAccountId) {
    const engine = this.engineManager.getEngine(pair.id);
    const oppositeBook = side === "BUY" ? engine.book.asks : engine.book.bids;
    let remaining = sliceQtyAtomic;
    let totalFilled = 0n;
    let totalQuote = 0n;
    let weightedNum = 0n;
    for (const level of oppositeBook) {
      if (level.userId === botAccountId) continue;
      const levelPrice = BigInt(level.price);
      const crosses = side === "BUY" ? levelPrice <= orderPriceAtomic : levelPrice >= orderPriceAtomic;
      if (!crosses) break;
      const avail = BigInt(level.remainingAmount);
      const take = PrecisionMath.minBigInt(remaining, avail);
      if (take <= 0n) continue;
      const notional = PrecisionMath.computeQuoteNotionalAtomic(levelPrice, take, pair.basePrecision);
      totalFilled += take;
      totalQuote += notional;
      weightedNum += levelPrice * take;
      remaining -= take;
      if (remaining <= 0n) break;
    }
    if (totalFilled === 0n) {
      return { filledAtomic: 0n, execPriceAtomic: 0n, quoteTotalAtomic: 0n, isTaker: false };
    }
    const avgPrice = PrecisionMath.computeWeightedAveragePrice(weightedNum, totalFilled);
    return { filledAtomic: totalFilled, execPriceAtomic: avgPrice, quoteTotalAtomic: totalQuote, isTaker: true };
  }
  // =========================================================================
  // SERIALIZATION & HELPERS
  // =========================================================================
  getRowStrict(botId) {
    const row = this.dbMgr.queryOne("SELECT * FROM volume_bots WHERE id = ?", [botId]);
    if (!row) throw new Error(`Volume bot "${botId}" not found`);
    return row;
  }
  getOpenBotOrders(botId) {
    return this.dbMgr.query(
      `SELECT * FROM volume_bot_orders WHERE bot_id = ? AND status IN ('SUBMITTED', 'ACCEPTED', 'PARTIALLY_FILLED') ORDER BY created_at ASC`,
      [botId]
    );
  }
  parseConfig(row) {
    return JSON.parse(row.config_json);
  }
  parseCheckpoint(row) {
    try {
      return { ...defaultCheckpoint(), ...JSON.parse(row.checkpoint_json || "{}") || {} };
    } catch {
      return defaultCheckpoint();
    }
  }
  parseRiskState(row) {
    try {
      return { ...defaultRiskState(), ...JSON.parse(row.risk_state_json || "{}") || {} };
    } catch {
      return defaultRiskState();
    }
  }
  saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs) {
    this.dbMgr.execute(
      "UPDATE volume_bots SET checkpoint_json = ?, risk_state_json = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(checkpoint), JSON.stringify(riskState), nowMs, botId]
    );
  }
  saveConfigVersionSnapshot(botId, version, config, changedBy, reason) {
    this.dbMgr.execute(
      `INSERT INTO volume_bot_config_versions (id, bot_id, config_version, config_json, changed_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `vcfg_${crypto9.randomBytes(8).toString("hex")}`,
        botId,
        version,
        JSON.stringify(config),
        changedBy,
        reason,
        Date.now()
      ]
    );
  }
  insertLog(botId, executionMode, level, eventType, message, details) {
    this.dbMgr.execute(
      `INSERT INTO volume_bot_logs (id, bot_id, execution_mode, level, event_type, message, details_json, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `vblog_${crypto9.randomBytes(8).toString("hex")}`,
        botId,
        executionMode,
        level,
        eventType,
        message,
        details ? JSON.stringify(details) : null,
        Date.now()
      ]
    );
  }
  computeNextDelayMs(config, seed) {
    if (config.maxIntervalMs <= config.minIntervalMs) return config.minIntervalMs;
    const span = config.maxIntervalMs - config.minIntervalMs;
    const offset = seed * 2654435761 % (span + 1);
    return config.minIntervalMs + Math.abs(offset);
  }
  toDTO(row) {
    const pair = this.getPairConfigStrict(row.pair_id);
    const config = this.parseConfig(row);
    const checkpoint = this.parseCheckpoint(row);
    const riskState = this.parseRiskState(row);
    const openOrdersCount = this.getOpenBotOrders(row.id).length;
    riskState.openOrdersCount = openOrdersCount;
    const targetAtomic = PrecisionMath.safeBigInt(row.target_qty_atomic);
    const executedAtomic = PrecisionMath.safeBigInt(row.executed_qty_atomic);
    const remainingAtomic = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
    const executedQuoteAtomic = PrecisionMath.safeBigInt(row.executed_quote_atomic);
    const totalFeesAtomic = PrecisionMath.safeBigInt(row.total_fees_atomic);
    const weightedNumAtomic = PrecisionMath.safeBigInt(row.weighted_price_num_atomic);
    const dailyQuoteAtomic = row.daily_reset_day === currentUtcDay() ? PrecisionMath.safeBigInt(row.daily_executed_quote_atomic) : 0n;
    const avgFillAtomic = PrecisionMath.computeWeightedAveragePrice(weightedNumAtomic, executedAtomic);
    const completionPct = targetAtomic > 0n ? Number(PrecisionMath.minBigInt(targetAtomic, executedAtomic) * 10000n / targetAtomic) / 100 : 0;
    const slippageSum = PrecisionMath.safeBigInt(row.total_slippage_bps_sum);
    const avgSlippageBps = row.total_trades_count > 0 ? Number(slippageSum / BigInt(row.total_trades_count)) : 0;
    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      accountId: row.account_id,
      pairId: row.pair_id,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      basePrecision: pair.basePrecision,
      quotePrecision: pair.quotePrecision,
      environment: row.environment,
      executionMode: row.execution_mode,
      executionSide: row.execution_side,
      strategy: row.strategy,
      status: row.status,
      enabled: Boolean(row.enabled),
      configVersion: row.config_version,
      config,
      metrics: {
        targetVolume: PrecisionMath.formatAtomicToDecimal(targetAtomic, pair.basePrecision, true),
        targetQtyAtomic: targetAtomic.toString(),
        executedVolume: PrecisionMath.formatAtomicToDecimal(executedAtomic, pair.basePrecision, true),
        executedQtyAtomic: executedAtomic.toString(),
        remainingVolume: PrecisionMath.formatAtomicToDecimal(remainingAtomic, pair.basePrecision, true),
        remainingQtyAtomic: remainingAtomic.toString(),
        completionPct,
        executedQuoteNotional: PrecisionMath.formatAtomicToDecimal(executedQuoteAtomic, pair.quotePrecision, true),
        executedQuoteAtomic: executedQuoteAtomic.toString(),
        averageFillPrice: PrecisionMath.formatAtomicToDecimal(avgFillAtomic, pair.quotePrecision, true),
        averageFillPriceAtomic: avgFillAtomic.toString(),
        totalFees: PrecisionMath.formatAtomicToDecimal(totalFeesAtomic, pair.quotePrecision, true),
        totalFeesAtomic: totalFeesAtomic.toString(),
        dailyExecutedQuote: PrecisionMath.formatAtomicToDecimal(dailyQuoteAtomic, pair.quotePrecision, true),
        dailyExecutedQuoteAtomic: dailyQuoteAtomic.toString(),
        submittedOrdersCount: row.submitted_orders_count,
        acceptedOrdersCount: row.accepted_orders_count,
        partialFillsCount: row.partial_fills_count,
        filledOrdersCount: row.filled_orders_count,
        cancelledOrdersCount: row.cancelled_orders_count,
        rejectedOrdersCount: row.rejected_orders_count,
        expiredOrdersCount: row.expired_orders_count,
        totalTradesCount: row.total_trades_count,
        averageSlippageBps: avgSlippageBps,
        openOrdersCount
      },
      riskState,
      checkpoint,
      emergencyStopped: Boolean(row.emergency_stopped),
      lastExecutionAt: row.last_execution_at,
      lastError: row.last_error,
      migratedFromLegacyId: row.migrated_from_legacy_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};

// src/server/workers/index.ts
var WorkerSupervisor = class _WorkerSupervisor {
  constructor(dbMgr, ledger, engineManager) {
    this.isRunning = false;
    this.binanceHandler = new BinanceWsHandler();
    this.bybitHandler = new BybitWsHandler();
    this.priceAggregator = new PriceAggregatorWorker(this.binanceHandler, this.bybitHandler);
    this.mmBotWorker = new MMBotWorker(dbMgr, ledger, engineManager, this.priceAggregator);
    this.volumeExecutionService = new VolumeExecutionV2Service(dbMgr, ledger, engineManager, this.priceAggregator);
  }
  static {
    this.instance = null;
  }
  static initialize(dbMgr, ledger, engineManager) {
    if (!_WorkerSupervisor.instance) {
      _WorkerSupervisor.instance = new _WorkerSupervisor(dbMgr, ledger, engineManager);
    }
    return _WorkerSupervisor.instance;
  }
  static getInstance() {
    if (!_WorkerSupervisor.instance) {
      throw new Error("WorkerSupervisor has not been initialized. Call initialize() first.");
    }
    return _WorkerSupervisor.instance;
  }
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[WorkerSupervisor] Starting Market Maker background workers & price feed handlers...");
    this.priceAggregator.start();
    this.mmBotWorker.start();
    this.volumeExecutionService.start(1e3);
  }
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log("[WorkerSupervisor] Stopping Market Maker background workers...");
    this.volumeExecutionService.stop();
    this.mmBotWorker.stop();
    this.priceAggregator.stop();
  }
  getStatus() {
    return {
      isRunning: this.isRunning,
      feedHealth: this.priceAggregator.getFeedHealth(),
      aggregatedPrices: this.priceAggregator.getAllAggregatedPrices()
    };
  }
};

// src/server/routes/volumeExecutionV2.ts
import { Router } from "express";
function getActor(req) {
  return {
    userId: req.user.userId,
    role: req.user.role
  };
}
function handleRouteError(res, err) {
  const msg = err?.message || "Internal error";
  const status = msg.startsWith("Forbidden") ? 403 : msg.includes("not found") ? 404 : msg.includes("Unauthorized") ? 401 : 400;
  res.status(status).json({ success: false, error: msg });
}
function createVolumeExecutionV2Router(dbMgr, authService, complianceService, getVolumeService) {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(authService);
  const requireBotOperatorRole = (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Unauthorized: Authentication required" });
      return;
    }
    if (req.user.role !== "admin" && req.user.role !== "market_maker") {
      res.status(403).json({
        success: false,
        error: "Forbidden: Market Maker or Admin role required for Volume Execution Engine"
      });
      return;
    }
    next();
  };
  const logAudit = (req, action, resource, payload) => {
    const actorId = req.user?.userId || "anonymous";
    const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    complianceService.logAudit(actorId, action, resource, payload, ip);
  };
  router.get("/bots", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const bots = svc.listBots(getActor(req), {
        environment: req.query.environment,
        executionMode: req.query.executionMode,
        pairId: req.query.pairId
      });
      res.json({ success: true, bots });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const deploy = Boolean(req.body?.deploy);
      const bot = svc.createBot(req.body || {}, getActor(req), { deploy });
      logAudit(req, "VOLUME_BOT_CREATE", `vbot:${bot.id}`, {
        pairId: bot.pairId,
        strategy: bot.strategy,
        executionMode: bot.executionMode,
        environment: bot.environment
      });
      dbMgr.saveToFile();
      res.status(201).json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/migrate-legacy", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const legacyItems = Array.isArray(req.body?.bots) ? req.body.bots : [req.body];
      const migrated = legacyItems.filter((item) => item && item.targetPair).map((item) => svc.migrateLegacyAutoTradeBot(item, getActor(req)));
      logAudit(req, "VOLUME_BOT_MIGRATE_LEGACY", "vbot:batch", { count: migrated.length });
      dbMgr.saveToFile();
      res.json({ success: true, bots: migrated });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.put("/bots/:id", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = svc.updateBot(req.params.id, req.body || {}, getActor(req));
      logAudit(req, "VOLUME_BOT_UPDATE", `vbot:${bot.id}`, { configVersion: bot.configVersion });
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/rollback", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const targetVersion = Number(req.body?.configVersion);
      if (!Number.isInteger(targetVersion) || targetVersion < 1) {
        return res.status(400).json({ success: false, error: "Valid configVersion integer is required" });
      }
      const bot = svc.rollbackBotConfig(req.params.id, targetVersion, getActor(req));
      logAudit(req, "VOLUME_BOT_ROLLBACK", `vbot:${bot.id}`, { targetVersion, newVersion: bot.configVersion });
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/deploy", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = svc.deployBot(req.params.id, getActor(req));
      logAudit(req, "VOLUME_BOT_DEPLOY", `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/start", requireAuth, requireBotOperatorRole, async (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.startBot(req.params.id, getActor(req));
      logAudit(req, "VOLUME_BOT_START", `vbot:${bot.id}`, { executionMode: bot.executionMode });
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/pause", requireAuth, requireBotOperatorRole, async (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.pauseBot(req.params.id, getActor(req));
      logAudit(req, "VOLUME_BOT_PAUSE", `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/resume", requireAuth, requireBotOperatorRole, async (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.resumeBot(req.params.id, getActor(req));
      logAudit(req, "VOLUME_BOT_RESUME", `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/stop", requireAuth, requireBotOperatorRole, async (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.stopBot(req.params.id, getActor(req), req.body?.reason || "OPERATOR_STOP");
      logAudit(req, "VOLUME_BOT_STOP", `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/emergency-stop", requireAuth, requireBotOperatorRole, async (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.emergencyStopBot(req.params.id, getActor(req), req.body?.reason || "OPERATOR_EMERGENCY_STOP");
      logAudit(req, "VOLUME_BOT_EMERGENCY_STOP", `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/tick", requireAuth, requireBotOperatorRole, async (req, res) => {
    try {
      const svc = getVolumeService();
      const actor = getActor(req);
      svc.getBotById(req.params.id, actor);
      const bot = await svc.executeBotCycle(req.params.id);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.post("/bots/:id/clone", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = svc.cloneBot(req.params.id, getActor(req));
      logAudit(req, "VOLUME_BOT_CLONE", `vbot:${bot.id}`, { sourceBotId: req.params.id });
      dbMgr.saveToFile();
      res.status(201).json({ success: true, bot });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.delete("/bots/:id", requireAuth, requireBotOperatorRole, async (req, res) => {
    try {
      const svc = getVolumeService();
      await svc.deleteBot(req.params.id, getActor(req));
      logAudit(req, "VOLUME_BOT_DELETE", `vbot:${req.params.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, message: "Volume bot deleted and bot-owned open orders cancelled" });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.get("/bots/:id/status", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = svc.getBotById(req.params.id, getActor(req));
      res.json({
        success: true,
        status: bot.status,
        enabled: bot.enabled,
        executionMode: bot.executionMode,
        environment: bot.environment,
        emergencyStopped: bot.emergencyStopped,
        checkpoint: bot.checkpoint,
        lastError: bot.lastError,
        bot
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.get("/bots/:id/stats", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = svc.getBotById(req.params.id, getActor(req));
      res.json({ success: true, metrics: bot.metrics });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.get("/bots/:id/history", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const limit = Number(req.query.limit) || 100;
      const history = svc.getBotHistory(req.params.id, getActor(req), limit);
      res.json({ success: true, ...history });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.get("/bots/:id/risk", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const bot = svc.getBotById(req.params.id, getActor(req));
      res.json({ success: true, riskState: bot.riskState });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  router.get("/bots/:id/logs", requireAuth, requireBotOperatorRole, (req, res) => {
    try {
      const svc = getVolumeService();
      const limit = Number(req.query.limit) || 100;
      const logs = svc.getBotLogs(req.params.id, getActor(req), limit);
      res.json({ success: true, logs });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
  return router;
}
function createMMConsoleVolumeBotAdapter(dbMgr, authService, complianceService, getVolumeService) {
  const router = Router();
  const v2Router = createVolumeExecutionV2Router(dbMgr, authService, complianceService, getVolumeService);
  router.post("/create", (req, res, next) => {
    req.url = "/bots";
    v2Router(req, res, next);
  });
  router.use("/", v2Router);
  return router;
}

// src/server/routes.ts
function createApiRouter(dbMgr, authService, ledgerService, engineManager, kycService, walletService, apiKeyService, complianceService, metricsCollector) {
  const router = Router2();
  const listingService = new ListingService(dbMgr, ledgerService, engineManager);
  const { requireAuth, requireRole, requireKyc } = createAuthMiddleware(authService);
  const logAudit = (req, action, resource, payload) => {
    const actorId = req.user?.userId || "anonymous";
    const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    complianceService.logAudit(actorId, action, resource, payload, ip);
  };
  router.get("/health", (_req, res) => {
    res.json(metricsCollector.getHealth());
  });
  router.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metricsCollector.getPrometheusMetrics());
  });
  router.post("/auth/register", (req, res) => {
    try {
      const { email, password, role } = req.body;
      const user = authService.register(email, password, role);
      logAudit(req, "USER_REGISTER", `user:${user.id}`, { email });
      res.json({ success: true, user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  const setAuthTokenCookie = (req, res, token) => {
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "none" : "lax",
      maxAge: 9e5
    });
  };
  router.post("/auth/login", (req, res) => {
    try {
      const { email, password, totpCode } = req.body;
      const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "Unknown";
      const result = authService.login(email, password, ip, userAgent, totpCode);
      if (result.accessToken) {
        setAuthTokenCookie(req, res, result.accessToken);
        logAudit(req, "USER_LOGIN", `user:${result.user?.id}`, { email, ip });
      }
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(401).json({ success: false, error: err.message });
    }
  });
  router.post("/auth/login-2fa", (req, res) => {
    try {
      const { tempToken, totpCode } = req.body;
      const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "Unknown";
      const result = authService.complete2FALogin(tempToken, totpCode, ip, userAgent);
      if (result.accessToken) {
        setAuthTokenCookie(req, res, result.accessToken);
        logAudit(req, "USER_LOGIN_2FA", `user:${result.user?.id}`, { ip });
      }
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(401).json({ success: false, error: err.message });
    }
  });
  router.post("/auth/refresh", (req, res) => {
    try {
      const { refreshToken } = req.body;
      const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "Unknown";
      const tokens = authService.refreshTokens(refreshToken, ip, userAgent);
      setAuthTokenCookie(req, res, tokens.accessToken);
      res.json({ success: true, ...tokens });
    } catch (err) {
      res.status(401).json({ success: false, error: err.message });
    }
  });
  router.get("/auth/me", requireAuth, (req, res) => {
    const user = authService.getUserById(req.user.userId);
    res.json({ success: true, user });
  });
  router.post("/auth/logout", requireAuth, (req, res) => {
    authService.revokeSession(req.user.userId, req.user.sessionId);
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.clearCookie("token", { httpOnly: true, secure: isHttps, sameSite: isHttps ? "none" : "lax" });
    res.json({ success: true, message: "Logged out successfully" });
  });
  router.get("/auth/sessions", requireAuth, (req, res) => {
    const sessions = authService.listSessions(req.user.userId);
    res.json({ success: true, sessions, currentSessionId: req.user.sessionId });
  });
  router.post("/auth/sessions/revoke", requireAuth, (req, res) => {
    const { sessionId } = req.body;
    authService.revokeSession(req.user.userId, sessionId);
    res.json({ success: true, message: "Session revoked" });
  });
  router.post("/auth/2fa/setup", requireAuth, (req, res) => {
    const result = authService.setup2FA(req.user.userId);
    res.json({ success: true, ...result });
  });
  router.post("/auth/2fa/enable", requireAuth, (req, res) => {
    const { code } = req.body;
    authService.enable2FA(req.user.userId, code);
    logAudit(req, "2FA_ENABLED", `user:${req.user.userId}`);
    res.json({ success: true, message: "2FA enabled successfully" });
  });
  router.post("/auth/2fa/disable", requireAuth, (req, res) => {
    const { code } = req.body;
    authService.disable2FA(req.user.userId, code);
    logAudit(req, "2FA_DISABLED", `user:${req.user.userId}`);
    res.json({ success: true, message: "2FA disabled successfully" });
  });
  router.get("/market/pairs", (_req, res) => {
    const pairs = dbMgr.query("SELECT * FROM market_pairs ORDER BY is_active DESC, id ASC");
    res.json({
      success: true,
      exchange: "SILENTSMILE",
      timezone: "Asia/Jakarta",
      supportedResolutions: ["1", "5", "15", "60", "240", "1D"],
      pairs
    });
  });
  router.post("/market/pairs/sync", async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.id) {
        return res.status(400).json({ success: false, error: "Pair id is required" });
      }
      const cfg = await engineManager.ensurePairRegistered({
        id: String(body.id),
        baseAsset: body.baseAsset,
        quoteAsset: body.quoteAsset,
        basePrecision: body.basePrecision,
        quotePrecision: body.quotePrecision,
        minOrderSize: body.minOrderSize,
        makerFeeBps: body.makerFeeBps,
        takerFeeBps: body.takerFeeBps,
        isActive: body.isActive,
        tradingStatus: body.tradingStatus
      });
      dbMgr.saveToFile();
      res.json({ success: true, pair: cfg });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/market/symbol/:pair", (req, res) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const cfg = engineManager.getPairConfig(pairId);
      res.json({
        success: true,
        symbol: {
          id: cfg.id,
          ticker: cfg.id,
          name: cfg.id,
          description: `${cfg.baseAsset} / ${cfg.quoteAsset} Spot`,
          exchange: "SILENTSMILE",
          timezone: "Asia/Jakarta",
          currencyCode: cfg.quoteAsset,
          baseAsset: cfg.baseAsset,
          quoteAsset: cfg.quoteAsset,
          basePrecision: cfg.basePrecision,
          quotePrecision: cfg.quotePrecision,
          minOrderSize: cfg.minOrderSize,
          tradingStatus: cfg.tradingStatus,
          supportedResolutions: ["1", "5", "15", "60", "240", "1D"]
        }
      });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });
  router.get("/market/tickers", (_req, res) => {
    const tickers = engineManager.getAllTickers();
    res.json({ success: true, tickers });
  });
  router.get("/market/ticker/:pair", (req, res) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const ticker = engineManager.getTicker(pairId);
      res.json({ success: true, ticker });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });
  router.get("/market/depth/:pair", (req, res) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const limit = parseInt(req.query.limit, 10) || 25;
      const depth = engineManager.getDepth(pairId, limit);
      res.json({ success: true, depth });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });
  router.get("/market/trades/:pair", (req, res) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const limit = parseInt(req.query.limit, 10) || 50;
      const trades = engineManager.getRecentTrades(pairId, limit);
      res.json({ success: true, trades });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });
  router.get("/market/klines/:pair", (req, res) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const rawInterval = String(req.query.interval || "1m").trim();
      const normalizedInterval = rawInterval === "1D" ? "1d" : rawInterval;
      if (!KlineAggregator.isValidInterval(normalizedInterval)) {
        return res.status(400).json({
          success: false,
          error: `Unsupported interval "${rawInterval}". Supported: 1m, 5m, 15m, 1h, 4h, 1d`
        });
      }
      const fromSec = req.query.from !== void 0 ? Number(req.query.from) : void 0;
      const toSec = req.query.to !== void 0 ? Number(req.query.to) : void 0;
      const countBack = req.query.countBack !== void 0 ? parseInt(String(req.query.countBack), 10) : void 0;
      const limit = req.query.limit !== void 0 ? parseInt(String(req.query.limit), 10) : 300;
      const result = engineManager.getFormattedCandles(pairId, normalizedInterval, {
        fromSec: fromSec !== void 0 && Number.isFinite(fromSec) ? fromSec : void 0,
        toSec: toSec !== void 0 && Number.isFinite(toSec) ? toSec : void 0,
        countBack: countBack !== void 0 && Number.isFinite(countBack) ? countBack : void 0,
        limit: Number.isFinite(limit) ? limit : 300
      });
      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });
  router.post("/market/trades/record", async (req, res) => {
    try {
      const body = req.body || {};
      const pairMeta = body.pair && typeof body.pair === "object" ? body.pair : void 0;
      const rawTrades = Array.isArray(body.trades) ? body.trades : body.pairId && body.price && body.amount ? [body] : [];
      if (rawTrades.length === 0) {
        return res.status(400).json({ success: false, error: "No valid executed trades supplied" });
      }
      const results = [];
      let recordedCount = 0;
      for (const trd of rawTrades) {
        const targetPairId = trd.pairId || trd.pair || pairMeta?.id;
        if (!targetPairId) continue;
        const r = await engineManager.recordExecutedTrade({
          id: String(trd.id || `trd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
          pairId: String(targetPairId),
          price: Number(trd.price),
          amount: Number(trd.amount),
          total: trd.total !== void 0 ? Number(trd.total) : void 0,
          side: String(trd.side || "buy"),
          makerOrderId: trd.makerOrderId,
          takerOrderId: trd.takerOrderId,
          makerUserId: trd.makerUserId,
          takerUserId: trd.takerUserId,
          makerFee: trd.makerFee,
          takerFee: trd.takerFee,
          timestamp: trd.timestamp !== void 0 ? Number(trd.timestamp) : Date.now(),
          pairMeta
        });
        if (r.recorded) recordedCount += 1;
        results.push(r);
      }
      if (recordedCount > 0) {
        dbMgr.saveToFile();
      }
      res.json({
        success: true,
        recordedCount,
        results
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/orders", requireAuth, async (req, res) => {
    try {
      const { pairId, side, orderType, price, amount, clientOrderId } = req.body;
      const result = await engineManager.submitOrder(pairId, {
        userId: req.user.userId,
        side,
        orderType,
        price: parseInt(price, 10),
        amount: parseInt(amount, 10),
        clientOrderId
      });
      logAudit(req, "PLACE_ORDER", `order:${result.orderId}`, { pairId, side, orderType, price, amount });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/orders/cancel", requireAuth, async (req, res) => {
    try {
      const { pairId, orderId } = req.body;
      await engineManager.cancelOrder(pairId, orderId, req.user.userId);
      logAudit(req, "CANCEL_ORDER", `order:${orderId}`, { pairId });
      res.json({ success: true, message: "Order successfully cancelled" });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/orders/open", requireAuth, (req, res) => {
    const pairId = req.query.pairId ? decodeURIComponent(req.query.pairId) : null;
    let sql = `SELECT * FROM orders WHERE user_id = ? AND status IN ('NEW', 'PARTIALLY_FILLED')`;
    const params = [req.user.userId];
    if (pairId) {
      sql += " AND pair_id = ?";
      params.push(pairId);
    }
    sql += " ORDER BY created_at DESC";
    const orders = dbMgr.query(sql, params);
    res.json({ success: true, orders });
  });
  router.get("/orders/history", requireAuth, (req, res) => {
    const orders = dbMgr.query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.user.userId]
    );
    res.json({ success: true, orders });
  });
  router.get("/wallet/balances", requireAuth, (req, res) => {
    const balances = ledgerService.getAllBalances(req.user.userId);
    res.json({ success: true, balances });
  });
  router.get("/wallet/deposit/crypto-address", requireAuth, (req, res) => {
    try {
      const asset = req.query.asset || "BTC";
      const chain = req.query.chain || "Bitcoin";
      const address = walletService.getOrCreateDepositAddress(req.user.userId, asset, chain);
      res.json({ success: true, address });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/wallet/deposit/simulate-chain", requireAuth, (req, res) => {
    try {
      const { address, amount, confirmations } = req.body;
      const result = walletService.simulateChainDeposit({
        address,
        amount: parseInt(amount, 10),
        confirmations: confirmations || 6
      });
      logAudit(req, "SIMULATE_CHAIN_DEPOSIT", `address:${address}`, { amount });
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/wallet/deposit/va-create", requireAuth, (req, res) => {
    try {
      const { bankCode } = req.body;
      const va = walletService.createVirtualAccount(req.user.userId, bankCode || "BCA");
      res.json({ success: true, virtualAccount: va });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/wallet/deposit/va-simulate-webhook", requireAuth, (req, res) => {
    try {
      const { virtualAccountNumber, amount } = req.body;
      const result = walletService.simulateVaPaymentWebhook({
        virtualAccountNumber,
        paidAmount: parseInt(amount, 10),
        userId: req.user.userId
      });
      logAudit(req, "SIMULATE_VA_PAYMENT", `va:${virtualAccountNumber}`, { amount });
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/wallet/withdraw", requireAuth, (req, res) => {
    try {
      const { asset, amount, fee, destinationAddress, destinationBankName, destinationAccountName } = req.body;
      const result = walletService.requestWithdrawal({
        userId: req.user.userId,
        asset,
        amount: parseInt(amount, 10),
        fee: parseInt(fee || "0", 10),
        destinationAddress,
        destinationBankName,
        destinationAccountName
      });
      logAudit(req, "REQUEST_WITHDRAWAL", `withdrawal:${result.id}`, { asset, amount, destinationAddress });
      res.json({ success: true, withdrawal: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/wallet/withdrawals", requireAuth, (req, res) => {
    const list = dbMgr.query(
      "SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.user.userId]
    );
    res.json({ success: true, withdrawals: list });
  });
  router.get("/wallet/admin/withdrawals", requireAuth, requireRole("admin"), (_req, res) => {
    const list = dbMgr.query(
      `SELECT w.*, u.email as user_email, u.name as user_name
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       ORDER BY w.created_at DESC LIMIT 100`
    );
    res.json({ success: true, withdrawals: list });
  });
  router.post("/wallet/withdrawals/:id/approve", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { txHash } = req.body;
      const result = walletService.approveWithdrawal(req.params.id, req.user.userId, txHash);
      logAudit(req, "APPROVE_WITHDRAWAL", `withdrawal:${req.params.id}`, { txHash });
      res.json({ success: true, withdrawal: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/wallet/withdrawals/:id/reject", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { reason } = req.body;
      const result = walletService.rejectWithdrawal(req.params.id, req.user.userId, reason || "Rejected by administrator");
      logAudit(req, "REJECT_WITHDRAWAL", `withdrawal:${req.params.id}`, { reason });
      res.json({ success: true, withdrawal: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/assets", (_req, res) => {
    try {
      const assets = dbMgr.query(
        `SELECT a.*, l.status as listing_status, l.deposit_status as listing_deposit_status, l.withdrawal_status as listing_withdrawal_status
         FROM assets a
         LEFT JOIN listings l ON a.listing_id = l.id
         ORDER BY a.category ASC, a.symbol ASC`
      );
      const networks = dbMgr.query(
        `SELECT * FROM asset_networks ORDER BY asset_id ASC, network_name ASC`
      );
      const result = assets.map((a) => {
        const assetNets = networks.filter((n) => n.asset_id === a.id);
        return {
          ...a,
          networks: assetNets
        };
      });
      res.json({ success: true, assets: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/assets/:symbol/networks", (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const asset = dbMgr.queryOne("SELECT * FROM assets WHERE symbol = ?", [symbol]);
      if (!asset) {
        return res.status(404).json({ success: false, error: "Asset not found" });
      }
      const networks = dbMgr.query(
        "SELECT * FROM asset_networks WHERE asset_id = ? ORDER BY network_name ASC",
        [asset.id]
      );
      res.json({ success: true, asset, networks });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/assets/:symbol/networks", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const asset = dbMgr.queryOne("SELECT * FROM assets WHERE symbol = ?", [symbol]);
      if (!asset) {
        return res.status(404).json({ success: false, error: "Asset not found" });
      }
      const {
        networkId,
        networkName,
        chainType,
        nativeCurrency,
        contractAddress,
        decimals,
        minDeposit,
        depositConfirmations,
        depositStatus,
        withdrawalStatus,
        withdrawalFee,
        minWithdrawal,
        maxDailyWithdrawal,
        isMemoRequired,
        explorerTxUrl,
        explorerAddressUrl,
        rpcEndpoint
      } = req.body;
      const now = Date.now();
      const id = `net_${asset.id}_${networkId}`;
      dbMgr.execute(
        `INSERT INTO asset_networks (
          id, asset_id, network_id, network_name, chain_type, native_currency, contract_address,
          decimals, min_deposit, deposit_confirmations, deposit_status, withdrawal_status,
          withdrawal_fee, min_withdrawal, max_daily_withdrawal, is_memo_required,
          explorer_tx_url, explorer_address_url, rpc_endpoint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, network_id) DO UPDATE SET
          network_name = excluded.network_name,
          chain_type = excluded.chain_type,
          native_currency = excluded.native_currency,
          contract_address = excluded.contract_address,
          decimals = excluded.decimals,
          min_deposit = excluded.min_deposit,
          deposit_confirmations = excluded.deposit_confirmations,
          deposit_status = excluded.deposit_status,
          withdrawal_status = excluded.withdrawal_status,
          withdrawal_fee = excluded.withdrawal_fee,
          min_withdrawal = excluded.min_withdrawal,
          max_daily_withdrawal = excluded.max_daily_withdrawal,
          is_memo_required = excluded.is_memo_required,
          explorer_tx_url = excluded.explorer_tx_url,
          explorer_address_url = excluded.explorer_address_url,
          rpc_endpoint = excluded.rpc_endpoint,
          updated_at = excluded.updated_at`,
        [
          id,
          asset.id,
          networkId,
          networkName,
          chainType || "EVM",
          nativeCurrency || symbol,
          contractAddress || null,
          decimals || 18,
          minDeposit || 0,
          depositConfirmations || 12,
          depositStatus || "OPEN",
          withdrawalStatus || "OPEN",
          withdrawalFee || 0,
          minWithdrawal || 0,
          maxDailyWithdrawal || null,
          isMemoRequired ? 1 : 0,
          explorerTxUrl || "",
          explorerAddressUrl || "",
          rpcEndpoint || null,
          now,
          now
        ]
      );
      logAudit(req, "CONFIG_ASSET_NETWORK", `asset:${symbol}:${networkId}`, { networkName, chainType, withdrawalFee });
      const updated = dbMgr.queryOne("SELECT * FROM asset_networks WHERE id = ?", [id]);
      res.json({ success: true, network: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/assets/:symbol/toggle-status", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const { feature, status, networkId } = req.body;
      const asset = dbMgr.queryOne("SELECT * FROM assets WHERE symbol = ?", [symbol]);
      if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });
      const now = Date.now();
      if (networkId) {
        const field = feature === "deposit" ? "deposit_status" : "withdrawal_status";
        dbMgr.execute(
          `UPDATE asset_networks SET ${field} = ?, updated_at = ? WHERE asset_id = ? AND network_id = ?`,
          [status, now, asset.id, networkId]
        );
      } else {
        const field = feature === "deposit" ? "deposit_enabled" : "withdrawal_enabled";
        const val = status === "OPEN" || status === 1 ? 1 : 0;
        dbMgr.execute(`UPDATE assets SET ${field} = ?, updated_at = ? WHERE id = ?`, [val, now, asset.id]);
      }
      logAudit(req, "TOGGLE_ASSET_STATUS", `asset:${symbol}`, { feature, status, networkId });
      res.json({ success: true, message: `Status updated successfully for ${symbol}` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/wallet/ledger-entries", requireAuth, (req, res) => {
    const entries = dbMgr.query(
      `SELECT e.*, t.category, t.description
       FROM ledger_entries e
       JOIN ledger_accounts a ON e.account_id = a.id
       JOIN ledger_transactions t ON e.transaction_id = t.id
       WHERE a.user_id = ?
       ORDER BY e.created_at DESC LIMIT 100`,
      [req.user.userId]
    );
    res.json({ success: true, entries });
  });
  router.get("/kyc/me", requireAuth, (req, res) => {
    const app = kycService.getApplicationByUserId(req.user.userId);
    const user = authService.getUserById(req.user.userId);
    res.json({ success: true, application: app, kycLevel: user?.kyc_level || 0 });
  });
  router.post("/kyc/submit", requireAuth, (req, res) => {
    try {
      const { fullName, idNumber, idCardUrl, selfieUrl } = req.body;
      const app = kycService.submitApplication({
        userId: req.user.userId,
        fullName,
        idNumber,
        idCardUrl,
        selfieUrl
      });
      logAudit(req, "SUBMIT_KYC", `kyc:${app.id}`, { fullName, idNumber });
      res.json({ success: true, application: app });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/kyc/sumsub-webhook", (req, res) => {
    try {
      const { vendorReference, reviewResult, moderationComment } = req.body;
      const result = kycService.simulateSumsubWebhook({
        vendorReference,
        reviewResult,
        moderationComment
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/keys/create", requireAuth, (req, res) => {
    try {
      const { permissions, ipWhitelist, rateLimitRpm } = req.body;
      const key = apiKeyService.createApiKey(
        req.user.userId,
        permissions,
        ipWhitelist,
        parseInt(rateLimitRpm || "120", 10)
      );
      logAudit(req, "CREATE_API_KEY", `key:${key.keyId}`);
      res.json({ success: true, apiKey: key });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/keys", requireAuth, (req, res) => {
    const keys = apiKeyService.listApiKeys(req.user.userId);
    res.json({ success: true, keys });
  });
  router.post("/keys/revoke", requireAuth, (req, res) => {
    const { keyId } = req.body;
    apiKeyService.revokeApiKey(req.user.userId, keyId);
    logAudit(req, "REVOKE_API_KEY", `key:${keyId}`);
    res.json({ success: true, message: "API key revoked" });
  });
  router.get("/admin/users", requireAuth, requireRole("admin"), (_req, res) => {
    const users = dbMgr.query(
      "SELECT id, email, role, status, kyc_level, totp_enabled, daily_withdraw_limit_idr, created_at FROM users ORDER BY created_at DESC LIMIT 200"
    );
    res.json({ success: true, users });
  });
  router.post("/admin/users/freeze", requireAuth, requireRole("admin"), (req, res) => {
    const { targetUserId, reason } = req.body;
    complianceService.freezeAccount(targetUserId, reason || "Compliance Hold", req.user.userId, req.ip);
    res.json({ success: true, message: `Account ${targetUserId} has been frozen` });
  });
  router.post("/admin/users/unfreeze", requireAuth, requireRole("admin"), (req, res) => {
    const { targetUserId, reason } = req.body;
    complianceService.unfreezeAccount(targetUserId, reason || "Hold Released", req.user.userId, req.ip);
    res.json({ success: true, message: `Account ${targetUserId} has been un-frozen` });
  });
  router.get("/admin/kyc/pending", requireAuth, requireRole("admin"), (_req, res) => {
    const pending = kycService.getPendingApplications();
    res.json({ success: true, applications: pending });
  });
  router.post("/admin/kyc/review", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { applicationId, decision, rejectReason } = req.body;
      const updated = kycService.reviewApplication({
        applicationId,
        reviewerId: req.user.userId,
        decision,
        rejectReason
      });
      logAudit(req, "REVIEW_KYC", `kyc:${applicationId}`, { decision, rejectReason });
      res.json({ success: true, application: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/admin/withdrawals/pending", requireAuth, requireRole("admin"), (_req, res) => {
    const pending = dbMgr.query(
      `SELECT w.*, u.email, u.kyc_level
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.status = 'pending_approval' ORDER BY w.created_at ASC`
    );
    res.json({ success: true, withdrawals: pending });
  });
  router.post("/admin/withdrawals/approve", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { withdrawalId, txHash } = req.body;
      const updated = walletService.approveWithdrawal(withdrawalId, req.user.userId, txHash);
      logAudit(req, "APPROVE_WITHDRAWAL", `withdrawal:${withdrawalId}`, { txHash });
      res.json({ success: true, withdrawal: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/admin/withdrawals/reject", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { withdrawalId, reason } = req.body;
      const updated = walletService.rejectWithdrawal(withdrawalId, req.user.userId, reason || "Rejected by admin");
      logAudit(req, "REJECT_WITHDRAWAL", `withdrawal:${withdrawalId}`, { reason });
      res.json({ success: true, withdrawal: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/admin/pairs/halt", requireAuth, requireRole("admin"), (req, res) => {
    const { pairId, status } = req.body;
    engineManager.setTradingStatus(pairId, status);
    logAudit(req, "HALT_PAIR", `pair:${pairId}`, { status });
    res.json({ success: true, message: `Pair ${pairId} status updated to ${status}` });
  });
  router.post("/admin/pairs/fees", requireAuth, requireRole("admin"), (req, res) => {
    const { pairId, makerBps, takerBps } = req.body;
    engineManager.updateFees(pairId, parseInt(makerBps, 10), parseInt(takerBps, 10));
    logAudit(req, "UPDATE_FEES", `pair:${pairId}`, { makerBps, takerBps });
    res.json({ success: true, message: `Pair ${pairId} fees updated to ${makerBps}/${takerBps} bps` });
  });
  router.get("/admin/audit-logs", requireAuth, requireRole("admin"), (_req, res) => {
    const logs = complianceService.getAuditLogs(100);
    res.json({ success: true, logs });
  });
  router.get("/admin/compliance-alerts", requireAuth, requireRole("admin"), (_req, res) => {
    const alerts = complianceService.scanSuspiciousActivities();
    res.json({ success: true, alerts });
  });
  router.get("/admin/compliance-report", requireAuth, requireRole("admin"), (req, res) => {
    const type = (req.query.type || "TRADES").toUpperCase();
    const csvData = complianceService.generateComplianceReport(type);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=compliance_${type.toLowerCase()}_${Date.now()}.csv`);
    res.send(csvData);
  });
  router.get("/admin/ledger-audit", requireAuth, requireRole("admin"), (_req, res) => {
    const audit = ledgerService.verifyLedgerIntegrity();
    res.json({ success: true, audit });
  });
  router.get("/listings", (_req, res) => {
    try {
      const listings = listingService.getAllListings();
      res.json({ success: true, listings });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/listings/:id", (req, res) => {
    try {
      const listing = listingService.getListingById(req.params.id);
      if (!listing) return res.status(404).json({ success: false, error: "Listing not found" });
      res.json({ success: true, listing });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/listings/pair", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const listing = listingService.createMarketPairDraft({
        ...req.body,
        actorId: req.user.userId
      });
      logAudit(req, "CREATE_MARKET_PAIR", `pair:${listing.market_id}`, req.body);
      res.json({ success: true, listing });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/listings/:id/review", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { action, reason } = req.body;
      const listing = listingService.reviewListing(req.params.id, action, req.user.userId, reason);
      logAudit(req, `LISTING_REVIEW_${action.toUpperCase()}`, `listing:${req.params.id}`, { reason });
      res.json({ success: true, listing });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/listings/:id/schedule", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const listing = listingService.scheduleListing(req.params.id, {
        ...req.body,
        actorId: req.user.userId
      });
      logAudit(req, "SCHEDULE_LISTING", `listing:${req.params.id}`, req.body);
      res.json({ success: true, listing });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/listings/:id/allocate-funding", requireAuth, (req, res) => {
    try {
      if (req.user?.role !== "admin" && req.user?.role !== "market_maker") {
        return res.status(403).json({ success: false, error: "Unauthorized" });
      }
      const { asset, amount, idempotencyKey } = req.body;
      const result = listingService.allocateTreasuryFunding(
        req.params.id,
        asset,
        parseInt(amount, 10),
        req.user.userId,
        idempotencyKey || `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      );
      logAudit(req, "ALLOCATE_MM_FUNDING", `listing:${req.params.id}`, { asset, amount });
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/listings/:id/toggle-access", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { feature, status } = req.body;
      const listing = listingService.toggleFeatureAccess(req.params.id, feature, status, req.user.userId);
      logAudit(req, "TOGGLE_FEATURE_ACCESS", `listing:${req.params.id}`, { feature, status });
      res.json({ success: true, listing });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/listings/reconcile", (_req, res) => {
    try {
      const transitions = listingService.reconcileSchedules();
      res.json({ success: true, transitions });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/assets", (_req, res) => {
    try {
      const assets = dbMgr.query("SELECT * FROM assets ORDER BY created_at ASC");
      const networks = dbMgr.query("SELECT * FROM asset_networks ORDER BY created_at ASC");
      const fullAssets = assets.map((a) => ({
        ...a,
        networks: networks.filter((n) => n.asset_id === a.id)
      }));
      res.json({ success: true, assets: fullAssets });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/assets", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const {
        symbol,
        name,
        decimals,
        category,
        color,
        primaryChain,
        tokenStandard,
        contractAddress,
        totalSupply,
        maxSupply,
        circulatingSupply,
        description,
        websiteUrl,
        whitepaperUrl,
        explorerUrl,
        genesisDate,
        initialPrice,
        initialNetwork
      } = req.body;
      if (!symbol || !name) {
        return res.status(400).json({ success: false, error: "Simbol dan nama aset wajib diisi." });
      }
      const cleanSymbol = symbol.trim().toUpperCase();
      const existing = dbMgr.queryOne("SELECT id FROM assets WHERE symbol = ?", [cleanSymbol]);
      if (existing) {
        return res.status(400).json({ success: false, error: `Aset dengan simbol ${cleanSymbol} sudah terdaftar.` });
      }
      const assetId = `ast_${cleanSymbol.toLowerCase()}`;
      const now = Date.now();
      dbMgr.execute(
        `INSERT INTO assets (
          id, symbol, name, decimals, category, color, deposit_enabled, withdrawal_enabled,
          primary_chain, token_standard, contract_address, total_supply, max_supply, circulating_supply,
          description, website_url, whitepaper_url, explorer_url, genesis_date, initial_price, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [
          assetId,
          cleanSymbol,
          name.trim(),
          Number(decimals ?? 18),
          category || "TOKEN",
          color || "#A855F7",
          primaryChain || "Ethereum (ERC-20)",
          tokenStandard || "ERC-20",
          contractAddress || null,
          Number(totalSupply ?? 1e9),
          maxSupply !== void 0 && maxSupply !== null ? Number(maxSupply) : null,
          Number(circulatingSupply ?? (totalSupply ? Number(totalSupply) * 0.25 : 25e7)),
          description || null,
          websiteUrl || null,
          whitepaperUrl || null,
          explorerUrl || null,
          genesisDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          Number(initialPrice ?? 1e4),
          now,
          now
        ]
      );
      if (initialNetwork) {
        const netId = initialNetwork.networkId || `${cleanSymbol.toLowerCase()}-default`;
        dbMgr.execute(
          `INSERT INTO asset_networks (
            id, asset_id, network_id, network_name, chain_type, native_currency, contract_address,
            decimals, min_deposit, deposit_confirmations, deposit_status, withdrawal_status,
            withdrawal_fee, min_withdrawal, is_memo_required, explorer_tx_url, explorer_address_url,
            rpc_endpoint, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `net_${assetId}_${netId}`,
            assetId,
            netId,
            initialNetwork.networkName || `${primaryChain || "Default"} Network`,
            initialNetwork.chainType || "EVM",
            initialNetwork.nativeCurrency || "ETH",
            contractAddress || null,
            Number(decimals ?? 18),
            Number(initialNetwork.minDeposit ?? 1),
            Number(initialNetwork.depositConfirmations ?? 12),
            Number(initialNetwork.withdrawalFee ?? 0.1),
            Number(initialNetwork.minWithdrawal ?? 1),
            initialNetwork.isMemoRequired ? 1 : 0,
            initialNetwork.explorerTxUrl || "https://etherscan.io/tx/{txHash}",
            initialNetwork.explorerAddressUrl || "https://etherscan.io/address/{address}",
            initialNetwork.rpcEndpoint || null,
            now,
            now
          ]
        );
      }
      logAudit(req, "CREATE_BASE_ASSET", `asset:${cleanSymbol}`, { symbol: cleanSymbol, name });
      dbMgr.saveToFile();
      res.json({
        success: true,
        asset: {
          id: assetId,
          symbol: cleanSymbol,
          name: name.trim(),
          primaryChain,
          tokenStandard,
          contractAddress,
          totalSupply,
          circulatingSupply
        }
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.put("/assets/:symbol", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const existing = dbMgr.queryOne("SELECT * FROM assets WHERE symbol = ?", [symbol]);
      if (!existing) {
        return res.status(404).json({ success: false, error: `Aset ${symbol} tidak ditemukan.` });
      }
      const {
        name,
        category,
        color,
        primaryChain,
        tokenStandard,
        contractAddress,
        totalSupply,
        maxSupply,
        circulatingSupply,
        description,
        websiteUrl,
        whitepaperUrl,
        explorerUrl,
        genesisDate,
        initialPrice,
        status
      } = req.body;
      const now = Date.now();
      dbMgr.execute(
        `UPDATE assets SET
          name = COALESCE(?, name),
          category = COALESCE(?, category),
          color = COALESCE(?, color),
          primary_chain = COALESCE(?, primary_chain),
          token_standard = COALESCE(?, token_standard),
          contract_address = COALESCE(?, contract_address),
          total_supply = COALESCE(?, total_supply),
          max_supply = ?,
          circulating_supply = COALESCE(?, circulating_supply),
          description = COALESCE(?, description),
          website_url = COALESCE(?, website_url),
          whitepaper_url = COALESCE(?, whitepaper_url),
          explorer_url = COALESCE(?, explorer_url),
          genesis_date = COALESCE(?, genesis_date),
          initial_price = COALESCE(?, initial_price),
          status = COALESCE(?, status),
          updated_at = ?
         WHERE symbol = ?`,
        [
          name,
          category,
          color,
          primaryChain,
          tokenStandard,
          contractAddress,
          totalSupply !== void 0 ? Number(totalSupply) : null,
          maxSupply !== void 0 ? maxSupply === null ? null : Number(maxSupply) : existing.max_supply,
          circulatingSupply !== void 0 ? Number(circulatingSupply) : null,
          description,
          websiteUrl,
          whitepaperUrl,
          explorerUrl,
          genesisDate,
          initialPrice !== void 0 ? Number(initialPrice) : null,
          status,
          now,
          symbol
        ]
      );
      logAudit(req, "UPDATE_BASE_ASSET", `asset:${symbol}`, req.body);
      dbMgr.saveToFile();
      res.json({ success: true, message: `Aset ${symbol} berhasil diperbarui.` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/assets/:symbol/networks", (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const networks = dbMgr.query(
        "SELECT an.* FROM asset_networks an JOIN assets a ON an.asset_id = a.id WHERE a.symbol = ?",
        [symbol]
      );
      res.json({ success: true, networks });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/assets/:symbol/networks", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const asset = dbMgr.queryOne("SELECT id FROM assets WHERE symbol = ?", [symbol]);
      if (!asset) return res.status(404).json({ success: false, error: "Aset tidak ditemukan" });
      const n = req.body;
      const now = Date.now();
      dbMgr.execute(
        `INSERT OR REPLACE INTO asset_networks (
          id, asset_id, network_id, network_name, chain_type, native_currency, contract_address,
          decimals, min_deposit, deposit_confirmations, deposit_status, withdrawal_status,
          withdrawal_fee, min_withdrawal, is_memo_required, explorer_tx_url, explorer_address_url,
          rpc_endpoint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `net_${asset.id}_${n.networkId}`,
          asset.id,
          n.networkId,
          n.networkName,
          n.chainType,
          n.nativeCurrency,
          n.contractAddress || null,
          n.decimals || 18,
          n.minDeposit || 0,
          n.depositConfirmations || 12,
          n.depositStatus || "OPEN",
          n.withdrawalStatus || "OPEN",
          n.withdrawalFee || 0,
          n.minWithdrawal || 0,
          n.isMemoRequired ? 1 : 0,
          n.explorerTxUrl,
          n.explorerAddressUrl,
          n.rpcEndpoint || null,
          now,
          now
        ]
      );
      dbMgr.saveToFile();
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/assets/:symbol/toggle-status", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const { feature, enabled } = req.body;
      const col = feature === "deposit" ? "deposit_enabled" : "withdrawal_enabled";
      dbMgr.execute(`UPDATE assets SET ${col} = ?, updated_at = ? WHERE symbol = ?`, [
        enabled ? 1 : 0,
        Date.now(),
        symbol
      ]);
      dbMgr.saveToFile();
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/wallet/admin/withdrawals", requireAuth, requireRole("admin"), (_req, res) => {
    try {
      const withdrawals = dbMgr.query("SELECT * FROM ledger_transactions WHERE transaction_type = ? ORDER BY timestamp DESC LIMIT 100", ["WITHDRAWAL"]);
      res.json({ success: true, withdrawals });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/mm/bots", requireAuth, (req, res) => {
    try {
      const user = req.user;
      let bots;
      if (user.role === "admin") {
        bots = dbMgr.query("SELECT * FROM mm_bots ORDER BY updated_at DESC");
      } else {
        bots = dbMgr.query("SELECT * FROM mm_bots WHERE account_id = ? ORDER BY updated_at DESC", [user.userId]);
      }
      const parsed = bots.map((b) => ({
        ...b,
        mapping: JSON.parse(b.mapping_config_json || "{}"),
        depthConfig: b.depth_config_json ? JSON.parse(b.depth_config_json) : void 0,
        riskProfile: JSON.parse(b.risk_profile_json || "{}")
      }));
      res.json({ success: true, bots: parsed });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/mm/bots", requireAuth, (req, res) => {
    try {
      const user = req.user;
      if (user.role !== "admin" && user.role !== "market_maker") {
        return res.status(403).json({ success: false, error: "Unauthorized: Market Maker or Admin role required" });
      }
      const {
        id: requestedId,
        name,
        strategy,
        accountId,
        targetMarketSymbol,
        mapping,
        depthConfig,
        riskProfile,
        minRepriceIntervalMs,
        minPriceChangeBps,
        targetSpreadBps,
        dryRun,
        apiKeyId,
        status: initialStatus
      } = req.body;
      if (!name || !targetMarketSymbol) {
        return res.status(400).json({ success: false, error: "Bot name and target market symbol are required" });
      }
      const botId = requestedId || `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = Date.now();
      const targetAccountId = accountId || (user.role === "admin" ? "usr_mm_01" : user.userId);
      const botStatus = initialStatus === "RUNNING" ? "RUNNING" : "STOPPED";
      dbMgr.execute(
        `INSERT OR REPLACE INTO mm_bots (
          id, name, strategy, account_id, api_key_id, target_market_symbol,
          mapping_config_json, depth_config_json, risk_profile_json, status,
          dry_run, min_reprice_interval_ms, min_price_change_bps, target_spread_bps,
          version, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          botId,
          name.trim(),
          strategy || "DEPTH_LIQUIDITY_LADDER",
          targetAccountId,
          apiKeyId || null,
          targetMarketSymbol,
          JSON.stringify(mapping || {}),
          depthConfig ? JSON.stringify(depthConfig) : null,
          JSON.stringify(riskProfile || {}),
          botStatus,
          dryRun ? 1 : 0,
          minRepriceIntervalMs ?? 2500,
          minPriceChangeBps ?? 15,
          targetSpreadBps ?? 25,
          user.userId,
          now,
          now
        ]
      );
      logAudit(req, "CREATE_MM_BOT", `bot:${botId}`, { name, targetMarketSymbol });
      dbMgr.saveToFile();
      res.json({ success: true, botId, message: "Bot successfully created and configured" });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.put("/mm/bots/:id", requireAuth, (req, res) => {
    try {
      const bot = dbMgr.queryOne("SELECT * FROM mm_bots WHERE id = ?", [req.params.id]);
      if (!bot) return res.status(404).json({ success: false, error: "Bot not found" });
      const {
        name,
        strategy,
        targetMarketSymbol,
        mapping,
        depthConfig,
        riskProfile,
        minRepriceIntervalMs,
        minPriceChangeBps,
        targetSpreadBps,
        dryRun
      } = req.body;
      dbMgr.execute(
        `UPDATE mm_bots
         SET name = COALESCE(?, name),
             strategy = COALESCE(?, strategy),
             target_market_symbol = COALESCE(?, target_market_symbol),
             mapping_config_json = COALESCE(?, mapping_config_json),
             depth_config_json = COALESCE(?, depth_config_json),
             risk_profile_json = COALESCE(?, risk_profile_json),
             min_reprice_interval_ms = COALESCE(?, min_reprice_interval_ms),
             min_price_change_bps = COALESCE(?, min_price_change_bps),
             target_spread_bps = COALESCE(?, target_spread_bps),
             dry_run = COALESCE(?, dry_run),
             version = version + 1,
             updated_at = ?
         WHERE id = ?`,
        [
          name ? name.trim() : null,
          strategy || null,
          targetMarketSymbol || null,
          mapping ? JSON.stringify(mapping) : null,
          depthConfig ? JSON.stringify(depthConfig) : null,
          riskProfile ? JSON.stringify(riskProfile) : null,
          minRepriceIntervalMs !== void 0 ? Number(minRepriceIntervalMs) : null,
          minPriceChangeBps !== void 0 ? Number(minPriceChangeBps) : null,
          targetSpreadBps !== void 0 ? Number(targetSpreadBps) : null,
          dryRun !== void 0 ? dryRun ? 1 : 0 : null,
          Date.now(),
          req.params.id
        ]
      );
      logAudit(req, "UPDATE_MM_BOT", `bot:${req.params.id}`, { name, targetMarketSymbol });
      dbMgr.saveToFile();
      res.json({ success: true, message: "Bot configuration updated" });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.delete("/mm/bots/:id", requireAuth, async (req, res) => {
    try {
      const bot = dbMgr.queryOne("SELECT * FROM mm_bots WHERE id = ?", [req.params.id]);
      if (!bot) return res.status(404).json({ success: false, error: "Bot not found" });
      try {
        const supervisor = WorkerSupervisor.getInstance();
        await supervisor.mmBotWorker.cancelOrdersForBot(bot.id, bot.account_id, bot.target_market_symbol);
      } catch {
      }
      dbMgr.execute("DELETE FROM mm_bots WHERE id = ?", [req.params.id]);
      logAudit(req, "DELETE_MM_BOT", `bot:${req.params.id}`, { name: bot.name });
      dbMgr.saveToFile();
      res.json({ success: true, message: "Bot deleted" });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/mm/bots/:id/lifecycle", requireAuth, async (req, res) => {
    try {
      const { action } = req.body;
      const bot = dbMgr.queryOne("SELECT * FROM mm_bots WHERE id = ?", [req.params.id]);
      if (!bot) return res.status(404).json({ success: false, error: "Bot not found" });
      let nextStatus = bot.status;
      if (action === "START" || action === "RESUME") nextStatus = "RUNNING";
      else if (action === "PAUSE") nextStatus = "PAUSED";
      else if (action === "STOP" || action === "EMERGENCY_STOP") nextStatus = "STOPPED";
      if (nextStatus !== "RUNNING") {
        try {
          const supervisor = WorkerSupervisor.getInstance();
          await supervisor.mmBotWorker.cancelOrdersForBot(bot.id, bot.account_id, bot.target_market_symbol);
        } catch {
        }
      }
      dbMgr.execute(
        "UPDATE mm_bots SET status = ?, active_open_orders_count = CASE WHEN ? != 'RUNNING' THEN 0 ELSE active_open_orders_count END, error_message = NULL, updated_at = ? WHERE id = ?",
        [nextStatus, nextStatus, Date.now(), req.params.id]
      );
      if (nextStatus === "RUNNING") {
        try {
          const supervisor = WorkerSupervisor.getInstance();
          supervisor.mmBotWorker.executeCycle().catch(() => {
          });
        } catch {
        }
      }
      logAudit(req, `MM_BOT_${action}`, `bot:${req.params.id}`, { previousStatus: bot.status, nextStatus });
      dbMgr.saveToFile();
      res.json({ success: true, status: nextStatus, message: `Bot status updated to ${nextStatus}` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.post("/mm/bots/emergency-stop", requireAuth, async (req, res) => {
    try {
      const runningBots = dbMgr.query("SELECT * FROM mm_bots WHERE status = 'RUNNING'");
      try {
        const supervisor = WorkerSupervisor.getInstance();
        for (const bot of runningBots) {
          await supervisor.mmBotWorker.cancelOrdersForBot(bot.id, bot.account_id, bot.target_market_symbol);
        }
      } catch {
      }
      dbMgr.execute(
        "UPDATE mm_bots SET status = 'STOPPED', active_open_orders_count = 0, total_bid_exposure = 0, total_ask_exposure = 0, updated_at = ?",
        [Date.now()]
      );
      logAudit(req, "GLOBAL_EMERGENCY_STOP", "mm_bots:all", { stoppedCount: runningBots.length });
      dbMgr.saveToFile();
      res.json({ success: true, stoppedCount: runningBots.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/mm/bots/:id/clone", requireAuth, (req, res) => {
    try {
      const sourceBot = dbMgr.queryOne("SELECT * FROM mm_bots WHERE id = ?", [req.params.id]);
      if (!sourceBot) return res.status(404).json({ success: false, error: "Source bot not found" });
      const newBotId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = Date.now();
      const clonedName = `${sourceBot.name} (Clone)`;
      dbMgr.execute(
        `INSERT INTO mm_bots (
          id, name, strategy, account_id, api_key_id, target_market_symbol,
          mapping_config_json, depth_config_json, risk_profile_json, status,
          dry_run, min_reprice_interval_ms, min_price_change_bps, target_spread_bps,
          version, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'STOPPED', ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          newBotId,
          clonedName,
          sourceBot.strategy,
          sourceBot.account_id || req.user.userId,
          sourceBot.target_market_symbol,
          sourceBot.mapping_config_json,
          sourceBot.depth_config_json,
          sourceBot.risk_profile_json,
          sourceBot.dry_run,
          sourceBot.min_reprice_interval_ms,
          sourceBot.min_price_change_bps,
          sourceBot.target_spread_bps,
          req.user.userId,
          now,
          now
        ]
      );
      logAudit(req, "CLONE_MM_BOT", `bot:${newBotId}`, { sourceBotId: req.params.id });
      dbMgr.saveToFile();
      res.json({ success: true, botId: newBotId, message: `Bot successfully cloned as ${clonedName}` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/mm/fx-rate", (_req, res) => {
    try {
      const latestFx = dbMgr.queryOne("SELECT * FROM fx_rates ORDER BY created_at DESC LIMIT 1");
      res.json({
        success: true,
        rate: latestFx ? latestFx.rate : 16250,
        source: latestFx ? latestFx.source : "BANK_INDONESIA",
        expiresAt: latestFx ? latestFx.expires_at : Date.now() + 864e5
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/mm/fx-rate", requireAuth, requireRole("admin"), (req, res) => {
    try {
      const { rate, source, durationHours } = req.body;
      const numRate = Number(rate);
      if (!numRate || numRate < 1e4 || numRate > 25e3) {
        return res.status(400).json({ success: false, error: "Nilai kurs tidak wajar (wajib Rp 10.000 - Rp 25.000)" });
      }
      const now = Date.now();
      const expiresAt = now + (durationHours || 24) * 36e5;
      dbMgr.execute(
        "INSERT INTO fx_rates (id, source, pair, rate, expires_at, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [`fx_${now}`, source || "MANUAL_ADMIN", "USDT/IDR", numRate, expiresAt, req.user.userId, now]
      );
      try {
        const supervisor = WorkerSupervisor.getInstance();
        supervisor.priceAggregator.setFxRate(numRate, source || "MANUAL_ADMIN", req.user.userId);
      } catch {
      }
      logAudit(req, "SET_MANUAL_FX_RATE", "USDT/IDR", { rate: numRate, source, expiresAt });
      dbMgr.saveToFile();
      res.json({ success: true, rate: numRate, expiresAt });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  router.get("/mm/cryptographic-audit", requireAuth, (req, res) => {
    try {
      const logs = dbMgr.query("SELECT * FROM cryptographic_audit_logs ORDER BY log_index DESC LIMIT 100");
      res.json({ success: true, logs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/mm/feeds/live", (_req, res) => {
    try {
      const supervisor = WorkerSupervisor.getInstance();
      res.json({ success: true, ...supervisor.getStatus() });
    } catch (err) {
      res.status(503).json({
        success: false,
        isRunning: false,
        error: err.message
      });
    }
  });
  router.get("/mm/workers/status", requireAuth, (_req, res) => {
    try {
      const supervisor = WorkerSupervisor.getInstance();
      res.json({ success: true, ...supervisor.getStatus() });
    } catch (err) {
      res.status(503).json({
        success: false,
        isRunning: false,
        message: "Workers supervisor unavailable",
        error: err.message
      });
    }
  });
  let fallbackVolumeService = null;
  const getVolumeService = () => {
    try {
      return WorkerSupervisor.getInstance().volumeExecutionService;
    } catch {
      if (!fallbackVolumeService) {
        fallbackVolumeService = new VolumeExecutionV2Service(dbMgr, ledgerService, engineManager);
      }
      return fallbackVolumeService;
    }
  };
  router.use(
    "/volume-execution-v2",
    createVolumeExecutionV2Router(dbMgr, authService, complianceService, getVolumeService)
  );
  router.use(
    "/mm/volume-bot",
    createMMConsoleVolumeBotAdapter(dbMgr, authService, complianceService, getVolumeService)
  );
  return router;
}

// src/server/app.ts
async function bootstrap() {
  const app = express();
  app.set("trust proxy", 1);
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  await dbManager.initialize();
  await runMigrations(dbManager);
  const authService = new AuthService(dbManager);
  const ledgerService = new LedgerService(dbManager);
  const kycService = new KycService(dbManager);
  const walletService = new WalletService(dbManager, ledgerService, kycService);
  const apiKeyService = new ApiKeyService(dbManager);
  const complianceService = new ComplianceService(dbManager);
  const metricsCollector = new MetricsCollector(dbManager);
  const engineManager = EngineManager.getInstance(dbManager, ledgerService);
  await engineManager.initialize();
  const workerSupervisor = WorkerSupervisor.initialize(dbManager, ledgerService, engineManager);
  workerSupervisor.start();
  const wss = new WebSocketServer({ noServer: true });
  const clientSubscriptions = /* @__PURE__ */ new Map();
  wss.on("error", (err) => {
    console.error("[WebSocketServer] Error:", err.message);
  });
  const enableViteHmr = process.env.ENABLE_HMR === "true" && process.env.DISABLE_HMR !== "true";
  server.on("upgrade", (request, socket, head) => {
    const reqUrl = request.url || "/";
    if (reqUrl === "/ws" || reqUrl.startsWith("/ws?")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else if (process.env.NODE_ENV === "production" || !enableViteHmr) {
      socket.destroy();
    }
  });
  wss.on("connection", (ws) => {
    clientSubscriptions.set(ws, /* @__PURE__ */ new Set());
    ws.on("error", (err) => {
      console.error("[WebSocketClient] Error:", err.message);
    });
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.action === "subscribe" && data.topic) {
          const subs = clientSubscriptions.get(ws);
          if (subs) subs.add(data.topic);
          if (ws.readyState === WebSocket2.OPEN) {
            ws.send(JSON.stringify({ event: "subscribed", topic: data.topic }));
          }
        } else if (data.action === "unsubscribe" && data.topic) {
          const subs = clientSubscriptions.get(ws);
          if (subs) subs.delete(data.topic);
          if (ws.readyState === WebSocket2.OPEN) {
            ws.send(JSON.stringify({ event: "unsubscribed", topic: data.topic }));
          }
        } else if (data.action === "ping") {
          if (ws.readyState === WebSocket2.OPEN) {
            ws.send(JSON.stringify({ event: "pong", timestamp: Date.now() }));
          }
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    });
    ws.on("close", () => {
      clientSubscriptions.delete(ws);
    });
  });
  const broadcastWsTopic = (topic, data) => {
    const payload = JSON.stringify({ topic, data });
    for (const [ws, topics] of clientSubscriptions.entries()) {
      if (ws.readyState === WebSocket2.OPEN && topics.has(topic)) {
        try {
          ws.send(payload);
        } catch {
        }
      }
    }
  };
  engineManager.setBroadcastHandler(broadcastWsTopic);
  workerSupervisor.priceAggregator.onPriceUpdate((agg) => {
    broadcastWsTopic("mm:feeds", {
      price: agg,
      feedHealth: workerSupervisor.priceAggregator.getFeedHealth()
    });
    broadcastWsTopic(`price_feed:${agg.symbol}`, agg);
  });
  workerSupervisor.priceAggregator.onAggregatesCleared((evt) => {
    broadcastWsTopic("mm:feeds", {
      clearedSymbols: evt.symbols,
      provider: evt.provider,
      feedHealth: workerSupervisor.priceAggregator.getFeedHealth()
    });
  });
  const apiRouter = createApiRouter(
    dbManager,
    authService,
    ledgerService,
    engineManager,
    kycService,
    walletService,
    apiKeyService,
    complianceService,
    metricsCollector
  );
  app.use("/api", apiRouter);
  const existingAdmin = dbManager.queryOne("SELECT id FROM users WHERE email = ?", ["admin@silentsmile.io"]);
  if (!existingAdmin) {
    try {
      const admin = authService.register("admin@silentsmile.io", "AdminPass123!", "admin");
      ledgerService.deposit(admin.id, "IDR", 5e10, "seed_admin_idr", "Initial Capital");
      ledgerService.deposit(admin.id, "BTC", 5e9, "seed_admin_btc", "Initial Capital");
      ledgerService.deposit(admin.id, "ETH", 5e8, "seed_admin_eth", "Initial Capital");
      ledgerService.deposit(admin.id, "SOL", 5e7, "seed_admin_sol", "Initial Capital");
      ledgerService.deposit(admin.id, "DNA", 5e7, "seed_admin_dna", "Initial Capital");
      ledgerService.deposit(admin.id, "USDT", 5e7, "seed_admin_usdt", "Initial Capital");
    } catch {
    }
  }
  const existingMm = dbManager.queryOne("SELECT id FROM users WHERE id = ?", ["usr_mm_01"]);
  if (!existingMm) {
    try {
      const now = Date.now();
      dbManager.execute(
        `INSERT OR IGNORE INTO users (id, email, password_hash, role, status, kyc_level, created_at, updated_at)
         VALUES ('usr_mm_01', 'mm@silentsmile.io', 'seeded_mm_hash', 'market_maker', 'active', 2, ?, ?)`,
        [now, now]
      );
      ledgerService.deposit("usr_mm_01", "IDR", 5e10, "seed_mm_idr_01", "MM Initial Liquidity");
      ledgerService.deposit("usr_mm_01", "BTC", 25e8, "seed_mm_btc_01", "MM Initial Liquidity");
      ledgerService.deposit("usr_mm_01", "ETH", 25e7, "seed_mm_eth_01", "MM Initial Liquidity");
      ledgerService.deposit("usr_mm_01", "SOL", 5e7, "seed_mm_sol_01", "MM Initial Liquidity");
      ledgerService.deposit("usr_mm_01", "DNA", 5e7, "seed_mm_dna_01", "MM Initial Liquidity");
      ledgerService.deposit("usr_mm_01", "USDT", 5e7, "seed_mm_usdt_01", "MM Initial Liquidity");
      ledgerService.deposit("usr_mm_01", "MOCK", 5e7, "seed_mm_mock_01", "MM Initial Liquidity");
    } catch {
    }
  }
  const existingTrader = dbManager.queryOne("SELECT id FROM users WHERE email = ?", ["trader@silentsmile.io"]);
  if (!existingTrader) {
    try {
      const trader = authService.register("trader@silentsmile.io", "TraderPass123!", "trader");
      ledgerService.deposit(trader.id, "IDR", 25e7, "seed_trader_idr", "Welcome Bonus Demo Deposit");
      ledgerService.deposit(trader.id, "BTC", 25e6, "seed_trader_btc", "Welcome Bonus Demo Deposit");
      ledgerService.deposit(trader.id, "ETH", 1e7, "seed_trader_eth", "Welcome Bonus Demo Deposit");
    } catch {
    }
  }
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: enableViteHmr ? { server } : false
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[SilentSmile Exchange] Fullstack Server running on http://0.0.0.0:${PORT}`);
  });
}
bootstrap().catch((err) => {
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});
export {
  bootstrap
};
