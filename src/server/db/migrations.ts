import { DatabaseManager } from './database';

export const SCHEMA_SQL = `
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

export async function runMigrations(dbMgr: DatabaseManager): Promise<void> {
  const db = dbMgr.getDb();
  db.run(SCHEMA_SQL);

  // Initialize System Accounts if not present
  const now = Date.now();
  const systemAccounts = [
    { userId: 'sys_treasury', asset: 'IDR' },
    { userId: 'sys_treasury', asset: 'BTC' },
    { userId: 'sys_treasury', asset: 'ETH' },
    { userId: 'sys_treasury', asset: 'SOL' },
    { userId: 'sys_treasury', asset: 'DNA' },
    { userId: 'sys_treasury', asset: 'USDT' },
    { userId: 'sys_fee_vault', asset: 'IDR' },
    { userId: 'sys_fee_vault', asset: 'BTC' },
    { userId: 'sys_fee_vault', asset: 'ETH' },
    { userId: 'sys_fee_vault', asset: 'SOL' },
    { userId: 'sys_fee_vault', asset: 'DNA' },
    { userId: 'sys_fee_vault', asset: 'USDT' },
  ];

  for (const acc of systemAccounts) {
    const id = `acc_${acc.userId}_${acc.asset}_AVAILABLE`;
    const existing = dbMgr.queryOne('SELECT id FROM ledger_accounts WHERE id = ?', [id]);
    if (!existing) {
      dbMgr.execute(
        `INSERT INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
         VALUES (?, ?, ?, 'AVAILABLE', 0, ?)`,
        [id, acc.userId, acc.asset, now]
      );
    }
  }

  // Initialize Market Pairs if empty
  const pairCount = dbMgr.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM market_pairs');
  if (!pairCount || pairCount.count === 0) {
    const defaultPairs = [
      { id: 'BTC/IDR', base: 'BTC', quote: 'IDR', basePrec: 8, quotePrec: 0, minSize: 10000, maker: 10, taker: 15 },
      { id: 'ETH/IDR', base: 'ETH', quote: 'IDR', basePrec: 6, quotePrec: 0, minSize: 100000, maker: 10, taker: 15 },
      { id: 'SOL/IDR', base: 'SOL', quote: 'IDR', basePrec: 4, quotePrec: 0, minSize: 1000000, maker: 10, taker: 15 },
      { id: 'DNA/IDR', base: 'DNA', quote: 'IDR', basePrec: 2, quotePrec: 0, minSize: 1000000, maker: 10, taker: 15 },
      { id: 'USDT/IDR', base: 'USDT', quote: 'IDR', basePrec: 2, quotePrec: 0, minSize: 100, maker: 5, taker: 10 },
    ];

    for (const p of defaultPairs) {
      dbMgr.execute(
        `INSERT INTO market_pairs (id, base_asset, quote_asset, base_precision, quote_precision, min_order_size, maker_fee_bps, taker_fee_bps, is_active, trading_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'OPEN')`,
        [p.id, p.base, p.quote, p.basePrec, p.quotePrec, p.minSize, p.maker, p.taker]
      );
    }
  }

  // Initialize Initial Listings if empty
  const listingCount = dbMgr.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM listings');
  if (!listingCount || listingCount.count === 0) {
    const initialListingsSeed = [
      {
        id: 'list_mock_01',
        market_id: 'MOCK/IDR',
        base: 'MOCK',
        quote: 'IDR',
        status: 'PREPARING',
        mm_phase: 'ORDER_SETUP_OPEN',
        trading_status: 'PREPARATION_ONLY',
        deposit_status: 'OPEN',
        withdrawal_status: 'CLOSED',
        public_visibility: 'UPCOMING',
        assigned_mm: 'usr_mm_01',
        price: 25000,
        sch_at: now - 3600000 * 2,
        mm_fund_at: now - 3600000,
        mm_setup_at: now - 1800000,
        trade_at: now + 1800000,
        badge_at: now + 86400000 * 3,
        dep_at: now - 3600000,
        wth_at: now + 86400000,
        min_base: 5000,
        min_quote: 100000000,
        spread: 0.35,
      },
      {
        id: 'list_aurora_01',
        market_id: 'AURORA/IDR',
        base: 'AURORA',
        quote: 'IDR',
        status: 'SCHEDULED',
        mm_phase: 'NOT_STARTED',
        trading_status: 'CLOSED',
        deposit_status: 'CLOSED',
        withdrawal_status: 'CLOSED',
        public_visibility: 'UPCOMING',
        assigned_mm: 'usr_mm_01',
        price: 15000,
        sch_at: now - 3600000,
        mm_fund_at: now + 3600000,
        mm_setup_at: now + 7200000,
        trade_at: now + 10800000,
        badge_at: now + 10800000 + 86400000 * 3,
        dep_at: now + 3600000,
        wth_at: now + 86400000 * 2,
        min_base: 2000,
        min_quote: 50000000,
        spread: 0.40,
      },
    ];

    for (const l of initialListingsSeed) {
      // Ensure market_pairs row exists
      const pairExists = dbMgr.queryOne('SELECT id FROM market_pairs WHERE id = ?', [l.market_id]);
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
          l.id, l.market_id, l.status, l.mm_phase, l.trading_status, l.deposit_status, l.withdrawal_status,
          l.public_visibility, l.assigned_mm, l.price, l.sch_at, l.sch_at, l.badge_at, l.sch_at, now
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
          `sch_${l.id}`, l.id, l.market_id, l.sch_at, l.mm_fund_at, l.mm_setup_at, l.trade_at,
          l.badge_at, l.dep_at, l.wth_at, l.min_base, l.min_quote, l.spread, l.sch_at, now
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

  // Ensure all Base Asset columns exist in assets table
  try {
    const assetCols = dbMgr.query<any>("PRAGMA table_info(assets)").map((c: any) => c.name);
    const newCols = [
      { name: 'primary_chain', type: 'TEXT' },
      { name: 'token_standard', type: 'TEXT' },
      { name: 'contract_address', type: 'TEXT' },
      { name: 'total_supply', type: 'REAL' },
      { name: 'max_supply', type: 'REAL' },
      { name: 'circulating_supply', type: 'REAL' },
      { name: 'description', type: 'TEXT' },
      { name: 'website_url', type: 'TEXT' },
      { name: 'whitepaper_url', type: 'TEXT' },
      { name: 'explorer_url', type: 'TEXT' },
      { name: 'genesis_date', type: 'TEXT' },
      { name: 'initial_price', type: 'REAL' },
      { name: 'status', type: "TEXT DEFAULT 'ACTIVE'" },
    ];
    for (const col of newCols) {
      if (!assetCols.includes(col.name)) {
        dbMgr.execute(`ALTER TABLE assets ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  } catch (e) {}

  // Initialize Assets & Networks if empty
  const assetCount = dbMgr.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM assets');
  if (!assetCount || assetCount.count === 0) {
    const assetsSeed = [
      {
        id: 'ast_idr',
        symbol: 'IDR',
        name: 'Rupiah Indonesia (Virtual)',
        decimals: 0,
        category: 'FIAT',
        color: '#22D3EE',
        listingId: null,
        primaryChain: 'Bank Indonesia / National Settlement',
        tokenStandard: 'Fiat / Virtual Account & QRIS',
        contractAddress: 'Bank Indonesia BI-FAST & QRIS Gateway',
        totalSupply: 1000000000000,
        maxSupply: null,
        circulatingSupply: 1000000000000,
        description: 'Mata uang fiat resmi Republik Indonesia untuk deposit instan via Virtual Account Bank (BCA, Mandiri) dan QRIS.',
        websiteUrl: 'https://www.bi.go.id',
        whitepaperUrl: null,
        explorerUrl: null,
        genesisDate: '1945-10-30',
        initialPrice: 1,
        status: 'ACTIVE',
      },
      {
        id: 'ast_btc',
        symbol: 'BTC',
        name: 'Bitcoin (Spot)',
        decimals: 8,
        category: 'CRYPTO',
        color: '#F7931A',
        listingId: null,
        primaryChain: 'Bitcoin Native (UTXO)',
        tokenStandard: 'Native (SegWit & Lightning)',
        contractAddress: 'Layer 1 Genesis Blockchain',
        totalSupply: 19780000,
        maxSupply: 21000000,
        circulatingSupply: 19780000,
        description: 'Aset kripto terdesentralisasi pertama di dunia dan penyimpan nilai digital dengan pasokan terbatas 21 Juta BTC.',
        websiteUrl: 'https://bitcoin.org',
        whitepaperUrl: 'https://bitcoin.org/bitcoin.pdf',
        explorerUrl: 'https://mempool.space',
        genesisDate: '2009-01-03',
        initialPrice: 1550000000,
        status: 'ACTIVE',
      },
      {
        id: 'ast_eth',
        symbol: 'ETH',
        name: 'Ethereum (Spot)',
        decimals: 18,
        category: 'CRYPTO',
        color: '#627EEA',
        listingId: null,
        primaryChain: 'Ethereum Mainnet (EVM)',
        tokenStandard: 'Native / ERC-20 Standard Parent',
        contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        totalSupply: 120250000,
        maxSupply: null,
        circulatingSupply: 120250000,
        description: 'Platform komputasi terdesentralisasi dunia untuk smart contract, DeFi, dan ekosistem aplikasi Web3 global.',
        websiteUrl: 'https://ethereum.org',
        whitepaperUrl: 'https://ethereum.org/en/whitepaper/',
        explorerUrl: 'https://etherscan.io',
        genesisDate: '2015-07-30',
        initialPrice: 42500000,
        status: 'ACTIVE',
      },
      {
        id: 'ast_usdt',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        category: 'CRYPTO',
        color: '#26A17B',
        listingId: null,
        primaryChain: 'TRON / Ethereum Multichain',
        tokenStandard: 'TRC-20 / ERC-20 / SPL',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        totalSupply: 118000000000,
        maxSupply: null,
        circulatingSupply: 118000000000,
        description: 'Stablecoin terbesar di dunia terpatok 1:1 terhadap Dolar AS yang didukung oleh cadangan kas dan surat berharga.',
        websiteUrl: 'https://tether.to',
        whitepaperUrl: 'https://tether.to/en/transparency/',
        explorerUrl: 'https://tronscan.org',
        genesisDate: '2014-10-06',
        initialPrice: 16200,
        status: 'ACTIVE',
      },
      {
        id: 'ast_sol',
        symbol: 'SOL',
        name: 'Solana (Spot)',
        decimals: 9,
        category: 'CRYPTO',
        color: '#14F195',
        listingId: null,
        primaryChain: 'Solana (Sealevel Engine)',
        tokenStandard: 'Native (SPL Token)',
        contractAddress: 'So11111111111111111111111111111111111111112',
        totalSupply: 585000000,
        maxSupply: null,
        circulatingSupply: 468000000,
        description: 'Blockchain Layer 1 berkecepatan tinggi dengan mekanisme Proof of History untuk throughput transaksi hingga ribuan TPS.',
        websiteUrl: 'https://solana.com',
        whitepaperUrl: 'https://solana.com/solana-whitepaper.pdf',
        explorerUrl: 'https://solscan.io',
        genesisDate: '2020-03-16',
        initialPrice: 2850000,
        status: 'ACTIVE',
      },
      {
        id: 'ast_dna',
        symbol: 'DNA',
        name: 'Denata Network Asset',
        decimals: 2,
        category: 'TOKEN',
        color: '#8B5CF6',
        listingId: null,
        primaryChain: 'Ethereum (ERC-20)',
        tokenStandard: 'ERC-20',
        contractAddress: '0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0',
        totalSupply: 500000000,
        maxSupply: 1000000000,
        circulatingSupply: 150000000,
        description: 'Denata Network Asset: Native utility dan governance token ekosistem likuiditas SilentSmile Exchange.',
        websiteUrl: 'https://denata.network',
        whitepaperUrl: 'https://denata.network/whitepaper',
        explorerUrl: 'https://etherscan.io/token/0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0',
        genesisDate: '2024-01-15',
        initialPrice: 14500,
        status: 'ACTIVE',
      },
      {
        id: 'ast_aurora',
        symbol: 'AURORA',
        name: 'Aurora Protocol',
        decimals: 3,
        category: 'TOKEN',
        color: '#A855F7',
        listingId: 'list_aurora_01',
        primaryChain: 'Ethereum (ERC-20)',
        tokenStandard: 'ERC-20',
        contractAddress: '0xaaaa111122223333444455556666777788889999',
        totalSupply: 1000000000,
        maxSupply: 1000000000,
        circulatingSupply: 250000000,
        description: 'Aurora Protocol token untuk smart contract layer dan integrasi komputasi terdesentralisasi.',
        websiteUrl: 'https://aurora.internal',
        whitepaperUrl: null,
        explorerUrl: 'https://etherscan.io',
        genesisDate: '2025-06-01',
        initialPrice: 12500,
        status: 'ACTIVE',
      },
      {
        id: 'ast_mock',
        symbol: 'MOCK',
        name: 'Mock Genesis Asset',
        decimals: 2,
        category: 'TOKEN',
        color: '#EC4899',
        listingId: 'list_mock_01',
        primaryChain: 'Ethereum Sepolia (ERC-20)',
        tokenStandard: 'ERC-20 Testnet',
        contractAddress: '0xmock99887766554433221100aabbccddeeff0011',
        totalSupply: 50000000,
        maxSupply: 50000000,
        circulatingSupply: 10000000,
        description: 'Mock Genesis Asset untuk simulasi stress-testing matching engine dan initial listing.',
        websiteUrl: null,
        whitepaperUrl: null,
        explorerUrl: 'https://sepolia.etherscan.io',
        genesisDate: '2026-01-01',
        initialPrice: 2000,
        status: 'ACTIVE',
      },
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
          a.id, a.symbol, a.name, a.decimals, a.category, a.color, a.listingId,
          a.primaryChain, a.tokenStandard, a.contractAddress, a.totalSupply, a.maxSupply, a.circulatingSupply,
          a.description, a.websiteUrl, a.whitepaperUrl, a.explorerUrl, a.genesisDate, a.initialPrice, a.status,
          now, now
        ]
      );
    }

    const networksSeed = [
      // IDR
      { assetId: 'ast_idr', netId: 'idr-va-bca', name: 'BCA Virtual Account', chain: 'EVM', curr: 'IDR', contract: null, dec: 0, minDep: 10000, conf: 1, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 4500, minWtd: 50000, memo: 0, txUrl: 'https://bankbca.co.id/ref/{txHash}', addrUrl: 'https://bankbca.co.id', rpc: null },
      { assetId: 'ast_idr', netId: 'idr-qris', name: 'QRIS Real-Time National QR', chain: 'EVM', curr: 'IDR', contract: null, dec: 0, minDep: 5000, conf: 1, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 2500, minWtd: 25000, memo: 0, txUrl: 'https://aspi.or.id/{txHash}', addrUrl: 'https://aspi.or.id', rpc: null },
      // BTC
      { assetId: 'ast_btc', netId: 'btc-mainnet', name: 'Bitcoin Native (SegWit)', chain: 'BITCOIN', curr: 'BTC', contract: null, dec: 8, minDep: 0.0001, conf: 2, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 0.0002, minWtd: 0.0005, memo: 0, txUrl: 'https://mempool.space/tx/{txHash}', addrUrl: 'https://mempool.space/address/{address}', rpc: 'https://bitcoin-mainnet.silent-node.internal:8332' },
      { assetId: 'ast_btc', netId: 'btc-lightning', name: 'Lightning Network (Instant)', chain: 'BITCOIN', curr: 'BTC', contract: null, dec: 8, minDep: 0.00005, conf: 1, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 0.00001, minWtd: 0.0001, memo: 1, txUrl: 'https://1ml.com/tx/{txHash}', addrUrl: 'https://1ml.com', rpc: null },
      // ETH
      { assetId: 'ast_eth', netId: 'eth-mainnet', name: 'Ethereum Mainnet (ERC-20)', chain: 'EVM', curr: 'ETH', contract: null, dec: 18, minDep: 0.005, conf: 12, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 0.0015, minWtd: 0.01, memo: 0, txUrl: 'https://etherscan.io/tx/{txHash}', addrUrl: 'https://etherscan.io/address/{address}', rpc: 'https://eth-mainnet.alchemyapi.io/v2/demo' },
      { assetId: 'ast_eth', netId: 'eth-arbitrum', name: 'Arbitrum One (L2 Low Cost)', chain: 'EVM', curr: 'ETH', contract: null, dec: 18, minDep: 0.001, conf: 20, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 0.0003, minWtd: 0.005, memo: 0, txUrl: 'https://arbiscan.io/tx/{txHash}', addrUrl: 'https://arbiscan.io/address/{address}', rpc: 'https://arb1.arbitrum.io/rpc' },
      // USDT
      { assetId: 'ast_usdt', netId: 'usdt-trc20', name: 'TRON (TRC-20)', chain: 'TRON', curr: 'TRX', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', dec: 6, minDep: 1, conf: 19, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 1.5, minWtd: 10, memo: 0, txUrl: 'https://tronscan.org/#/transaction/{txHash}', addrUrl: 'https://tronscan.org/#/address/{address}', rpc: 'https://api.trongrid.io' },
      { assetId: 'ast_usdt', netId: 'usdt-erc20', name: 'Ethereum (ERC-20)', chain: 'EVM', curr: 'ETH', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', dec: 6, minDep: 10, conf: 12, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 4.5, minWtd: 25, memo: 0, txUrl: 'https://etherscan.io/tx/{txHash}', addrUrl: 'https://etherscan.io/address/{address}', rpc: 'https://eth-mainnet.alchemyapi.io/v2/demo' },
      { assetId: 'ast_usdt', netId: 'usdt-arbitrum', name: 'Arbitrum One (ERC-20 L2)', chain: 'EVM', curr: 'ETH', contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', dec: 6, minDep: 1, conf: 20, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 0.8, minWtd: 5, memo: 0, txUrl: 'https://arbiscan.io/tx/{txHash}', addrUrl: 'https://arbiscan.io/address/{address}', rpc: 'https://arb1.arbitrum.io/rpc' },
      { assetId: 'ast_usdt', netId: 'usdt-solana', name: 'Solana (SPL)', chain: 'SOLANA', curr: 'SOL', contract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', dec: 6, minDep: 1, conf: 32, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 1.0, minWtd: 5, memo: 0, txUrl: 'https://solscan.io/tx/{txHash}', addrUrl: 'https://solscan.io/account/{address}', rpc: 'https://api.mainnet-beta.solana.com' },
      // SOL
      { assetId: 'ast_sol', netId: 'solana-mainnet', name: 'Solana Mainnet', chain: 'SOLANA', curr: 'SOL', contract: null, dec: 9, minDep: 0.05, conf: 32, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 0.005, minWtd: 0.1, memo: 0, txUrl: 'https://solscan.io/tx/{txHash}', addrUrl: 'https://solscan.io/account/{address}', rpc: 'https://api.mainnet-beta.solana.com' },
      // DNA
      { assetId: 'ast_dna', netId: 'dna-erc20', name: 'Ethereum (ERC-20)', chain: 'EVM', curr: 'ETH', contract: '0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0', dec: 2, minDep: 10, conf: 12, depStatus: 'OPEN', wtdStatus: 'OPEN', fee: 25, minWtd: 50, memo: 0, txUrl: 'https://etherscan.io/tx/{txHash}', addrUrl: 'https://etherscan.io/address/{address}', rpc: 'https://eth-mainnet.alchemyapi.io/v2/demo' },
      // AURORA
      { assetId: 'ast_aurora', netId: 'aurora-erc20', name: 'Ethereum (ERC-20)', chain: 'EVM', curr: 'ETH', contract: '0xaaaa111122223333444455556666777788889999', dec: 3, minDep: 1, conf: 12, depStatus: 'OPEN', wtdStatus: 'CLOSED', fee: 0.5, minWtd: 5, memo: 0, txUrl: 'https://etherscan.io/tx/{txHash}', addrUrl: 'https://etherscan.io/address/{address}', rpc: null },
      // MOCK
      { assetId: 'ast_mock', netId: 'mock-erc20', name: 'Ethereum Sepolia (ERC-20)', chain: 'EVM', curr: 'ETH', contract: '0xmock99887766554433221100aabbccddeeff0011', dec: 2, minDep: 5, conf: 6, depStatus: 'OPEN', wtdStatus: 'CLOSED', fee: 2, minWtd: 10, memo: 0, txUrl: 'https://sepolia.etherscan.io/tx/{txHash}', addrUrl: 'https://sepolia.etherscan.io/address/{address}', rpc: null },
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
          `net_${n.assetId}_${n.netId}`, n.assetId, n.netId, n.name, n.chain, n.curr, n.contract,
          n.dec, n.minDep, n.conf, n.depStatus, n.wtdStatus, n.fee, n.minWtd, n.memo, n.txUrl,
          n.addrUrl, n.rpc, now, now
        ]
      );
    }
  }

  dbMgr.saveToFile();
}
