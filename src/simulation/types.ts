export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';

export type TimeFrame = '1m' | '5m' | '15m' | '1h' | '4h' | '1D';

export interface AssetInfo {
  symbol: string;
  name: string;
  decimals: number;
  isLocalToken?: boolean;
  color: string;
  icon?: string;
  description: string;
}

export interface MarketPair {
  id: string; // e.g. 'BTC/IDR'
  baseAsset: string; // e.g. 'BTC'
  quoteAsset: string; // 'IDR'
  name: string;
  lastPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  priceDecimals: number;
  amountDecimals: number;
  minOrderAmount: number;
  makerFeeBps: number; // e.g. 10 (0.10%)
  takerFeeBps: number; // e.g. 15 (0.15%)
  isActive: boolean;
  isFavorite?: boolean;
  tradingAccessStatus?: 'CLOSED' | 'PREPARATION_ONLY' | 'OPEN' | 'HALTED';
  listingId?: string;
}

export type MMTransactionType = 'limit' | 'post_only' | 'ioc';

export interface MMBotLog {
  id: string;
  timestamp: number;
  pair: string;
  action: string;
  type: 'buy' | 'sell' | 'system' | 'cancel' | 'wall' | 'guard';
  price?: number;
  amount?: number;
  orderId?: string;
  details: string;
}

export interface BookOrder {
  id: string;
  userId: string;
  pair: string;
  side: OrderSide;
  price: number;
  amount: number;
  remainingAmount: number;
  createdAt: number;
  isMM?: boolean;
  isWall?: boolean;
  isFrozen?: boolean;
  frozenFunds?: number; // locked IDR (for bids) or locked base units (for asks)
  expiresAt?: number;
  transactionType?: MMTransactionType;
  isPreLaunch?: boolean;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
  total: number;
  depthPercent: number; // 0 to 100 for visual depth bar
  orderCount: number;
  myOrderAmount?: number;
  isWall?: boolean;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadPercent: number;
  lastUpdated: number;
  restingOrdersCount: number;
}

export type AutoTradeExecutionMode = 'buy_first' | 'sell_first' | 'random';
export type AutoTradeTrendStrategy = 'trend_up' | 'trend_down' | 'neutral';

export interface AutoTradeConfig {
  id?: string;
  enabled: boolean;
  targetPair: string;
  targetVolume: number; // target volume in base units
  accumulatedVolume: number; // accumulated volume executed
  minOrderSize: number;
  maxOrderSize: number;
  intervalSeconds: number;
  executionMode: AutoTradeExecutionMode; // buy_first | sell_first | random
  trendStrategy: AutoTradeTrendStrategy; // trend_up | trend_down | neutral
  autoStopOnTarget: boolean;
  lastExecutionTime?: number;
  lastReason?: string;
}

export interface PairMMBotConfig {
  pair: string;
  enabled: boolean;
  targetSpreadBps: number; // e.g. 30 = 0.3%
  levelsPerSide: number; // e.g. 10
  baseAmountPerLevel: number;
  tickSize: number;
  frequencySec: number;
  lastRun?: number;

  // Institutional Parameters requested by user
  price_decimal?: number; // e.g. 0 for IDR, 2 for USDT
  quantity_decimal?: number; // e.g. 2 for DNA, 4 for ETH, 6 for BTC
  expire_time?: number; // TTL in seconds (0 = GTC)
  order_count?: number; // total orders per side
  split_order?: boolean; // whether to split orders into tranches
  split_range?: number; // split range percentage (e.g. 1.5%)
  buy_min_price_limit?: number; // hard floor for buy orders
  buy_max_price_limit?: number; // hard ceiling for buy orders (prevents mental above support)
  sell_min_price_limit?: number; // hard floor for sell orders (prevents mental below resistance)
  sell_max_price_limit?: number; // hard ceiling for sell orders
  jitter_timing_pct?: number; // random timing offset (e.g. 15%)
  jitter_price_pct?: number; // random price spacing variation (e.g. 0.05%)
  account_id?: string; // account ID for bot (e.g. 'usr_mm_01')
  transaction_type?: MMTransactionType; // limit | post_only | ioc
}

export interface MMConfig {
  enabled: boolean;
  pair: string;
  targetSpreadBps: number; // e.g. 30 = 0.3%
  levelsPerSide: number; // e.g. 8 to 20
  baseAmountPerLevel: number; // e.g. 500 DNA
  amountVariancePct: number; // e.g. 30%
  tickSize: number; // e.g. 25 IDR for DNA
  allocatedIDR: number; // MM IDR balance
  allocatedBase: number; // MM Base balance (e.g. DNA)
  wallBuyEnabled: boolean;
  wallBuyPrice: number; // specific price or offset
  wallBuyAmount: number; // large support wall
  wallSellEnabled: boolean;
  wallSellPrice: number;
  wallSellAmount: number; // large resistance wall
  churnEnabled: boolean; // active churn for candle tick generation
  churnIntervalMs: number; // e.g. 3000ms
  churnMinQty: number;
  churnMaxQty: number;

  // Advanced optional parameters
  price_decimal?: number;
  quantity_decimal?: number;
  expire_time?: number;
  order_count?: number;
  split_order?: boolean;
  split_range?: number;
  buy_min_price_limit?: number;
  buy_max_price_limit?: number;
  sell_min_price_limit?: number;
  sell_max_price_limit?: number;
  jitter_timing_pct?: number;
  jitter_price_pct?: number;
  account_id?: string;
  transaction_type?: MMTransactionType;
}

export interface Order {
  id: string;
  userId: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  price: number; // For limit, or target execution for market
  amount: number;
  filledAmount: number;
  remainingAmount: number;
  total: number; // in IDR
  fee: number; // in IDR
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  isMM?: boolean;
  isWall?: boolean;
  isFrozen?: boolean;
  frozenFunds?: number;
  expiresAt?: number;
  transactionType?: MMTransactionType;
  trades?: string[]; // IDs of trades generated
}

export interface Trade {
  id: string;
  pair: string;
  price: number;
  amount: number;
  total: number;
  side: OrderSide;
  timestamp: number;
  isMaker?: boolean;
  orderId?: string;
  makerOrderId?: string;
  takerOrderId?: string;
  makerUserId?: string;
  takerUserId?: string;
  makerFee?: number;
  takerFee?: number;
  makerFeeAsset?: string;
  takerFeeAsset?: string;
}

export interface AdminFeeEvent {
  id: string;
  timestamp: number;
  tradeId: string;
  pair: string;
  makerFee: number;
  makerFeeAsset: string;
  takerFee: number;
  takerFeeAsset: string;
  makerUserId: string;
  takerUserId: string;
  volume: number;
  price: number;
}

export interface AdminFeeVault {
  totalFeesIDR: number;
  feesByAsset: Record<string, number>;
  recentEvents: AdminFeeEvent[];
  lastUpdated: number;
}

export type MMDirection = 'Up' | 'Down' | 'Neutral';
export type MMDumpAction = 'pause' | 'cancel_orders' | 'reprice' | 'alert';
export type MMTargetSource = 'static' | 'mid_price' | 'sma' | 'order_book';
export type MMStrategyMode = 'passive_grid' | 'spread_capture' | 'inventory_skew';
export type MMBotLifecycle = 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'ERROR';

export interface FullMMConfig {
  // A. Core parameters (cs_*)
  cs_price_decimal: number;
  cs_quantity_decimal: number;
  cs_direction: MMDirection;
  cs_target_price: number;
  cs_duration_hours: number;
  cs_timeframe: TimeFrame;
  cs_max_step_percent: number;
  cs_nudge_budget_idr: number;
  cs_support_budget_idr: number;
  cs_volume_ratio: number;
  cs_dump_threshold_percent: number;
  cs_dump_action: MMDumpAction;
  cs_walk_book: boolean;
  cs_walk_max_levels: number;
  cs_walk_max_slippage_pct: number;
  cs_orphan_cancel_seconds: number;
  cs_target_source: MMTargetSource;
  cs_target_premium_pct: number;
  cs_dead_zone_pct: number;
  cs_flip_hysteresis_candles: number;
  cs_total_budget_idr: number;
  cs_max_book_spread_pct: number;

  // B. Additional operational parameters
  enabled: boolean;
  market_id: string;
  strategy_mode: MMStrategyMode;
  quote_interval_ms: number;
  max_order_notional_idr: number;
  max_open_orders: number;
  max_daily_spend_idr: number;
  max_inventory_idr: number;
  max_inventory_quantity: number;
  min_order_quantity: number;
  max_order_quantity: number;
  cooldown_seconds: number;
  stop_loss_percent: number;
  max_drawdown_percent: number;
  emergency_stop: boolean;
  lifecycle_state: MMBotLifecycle;
  last_run_at?: number;
  last_error?: string;

  // Price Limits & Support/Resistance Bounds (Prevents out-of-range quotes)
  buy_min_price_limit?: number; // hard floor for bids
  buy_max_price_limit?: number; // hard ceiling for bids
  sell_min_price_limit?: number; // hard floor for asks
  sell_max_price_limit?: number; // hard ceiling for asks

  // Order Execution & Jitter
  expire_time?: number; // TTL in seconds
  order_count?: number; // target quote count
  split_order?: boolean; // tranche splitting
  split_range?: number; // tranche range percentage
  jitter_timing_pct?: number; // timing jitter %
  jitter_price_pct?: number; // price spacing jitter %
  account_id?: string; // MM execution account
  transaction_type?: string; // post_only | limit | ioc

  // Tracking accounting
  allocated_budget_idr: number;
  spent_budget_idr: number;
  reserved_quote_idr: number;
  reserved_base_qty: number;
  realized_pnl_idr: number;
  total_trades_count: number;
}

export interface Candle {
  time: number; // unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UserBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'trader' | 'admin' | 'market_maker';
  avatarUrl: string;
  tier: string;
  createdAt: number;
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  details: string;
  timestamp: number;
}

export type TradingLayoutPreset = 'classic_pro' | 'chart_focus' | 'compact_pro' | 'multi_panel';
export type TradingWorkspacePanelKey = 'chart' | 'orderBook' | 'recentTrades' | 'orderEntry';

export interface TradingLayoutPanelsVisibility {
  marketHeader: boolean;
  chart: boolean;
  orderBook: boolean;
  recentTrades: boolean;
  orderEntry: boolean;
  bottomPanel: boolean;
  tickerFooter: boolean;
}

export interface TradingLayoutPreferences {
  preset: TradingLayoutPreset;
  panels: TradingLayoutPanelsVisibility;
  collapsedPanels: Partial<Record<keyof TradingLayoutPanelsVisibility, boolean>>;
  panelOrder: TradingWorkspacePanelKey[];
  orderBookWidthPx: number;
  recentTradesWidthPx: number;
  orderEntryWidthPx: number;
  workspaceHeightPx: number;
  bottomPanelHeightPx: number;
  orderBookTradesSplitPct: number;
  updatedAt?: number;
}

export interface SimulationSettings {
  engineSpeed: 'normal' | 'fast' | 'slow' | 'paused';
  volatility: 'low' | 'normal' | 'high';
  soundEnabled: boolean;
  currencyFormat: 'standard' | 'compact';
  chartStyle: 'candlestick' | 'hollow' | 'line';
  showMovingAverages: boolean;
  autoRefreshBook: boolean;
  tradingLayout?: TradingLayoutPreferences;
  savedTradingLayout?: TradingLayoutPreferences;
}
