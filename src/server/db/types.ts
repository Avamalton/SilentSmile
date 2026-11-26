/**
 * Authoritative Database & Volume Execution V2 Type Definitions
 */

export type VolumeBotEnvironment = 'DEMO' | 'SANDBOX' | 'STAGING' | 'PRODUCTION';
export type VolumeBotExecutionMode = 'SIMULATION' | 'LIVE';
export type VolumeBotStrategy =
  | 'TWAP'
  | 'VWAP'
  | 'ICEBERG'
  | 'PASSIVE_LIMIT'
  | 'AGGRESSIVE_LIMIT';
export type VolumeBotStatus =
  | 'DRAFT'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'COMPLETED'
  | 'RISK_LOCKED'
  | 'ERROR';
export type VolumeBotSide = 'BUY' | 'SELL';
export type VolumeBotReferenceSource = 'INTERNAL_BOOK' | 'AGGREGATED_FEED' | 'HYBRID';
export type VolumeBotOrderStatus =
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export type VolumeBotPresetId =
  | 'CONSERVATIVE'
  | 'BALANCED'
  | 'PASSIVE'
  | 'TWAP'
  | 'VWAP'
  | 'ICEBERG'
  | 'CUSTOM';

export interface VolumeBotConfig {
  // A. General Configuration
  botName: string;
  presetId?: VolumeBotPresetId;
  pairId: string;
  accountId: string;
  environment: VolumeBotEnvironment;
  executionMode: VolumeBotExecutionMode;
  executionSide: VolumeBotSide;

  // B. Execution Target (stored as human decimal strings & parsed via PrecisionMath)
  targetVolume: string;        // Total base asset target (e.g. "1.50000000")
  minSliceSize: string;        // Min base qty per slice
  maxSliceSize: string;        // Max base qty per slice
  autoStopOnTarget: boolean;
  maxOrderQty?: string;        // Pair/bot cap per slice

  // C. Execution Scheduling
  minIntervalMs: number;
  maxIntervalMs: number;
  executionWindowStartMs?: number | null;
  executionWindowEndMs?: number | null;
  pauseBetweenWindowsMs: number;
  maxOrdersPerMinute: number;
  orderTimeoutMs: number;
  partialFillRetryLimit: number;
  cooldownAfterFailureMs: number;

  // D. Execution Strategies
  strategy: VolumeBotStrategy;
  twapDurationMs?: number;          // Total TWAP horizon
  vwapLookbackMinutes?: number;     // Historical trade lookback for VWAP
  icebergVisibleRatioPct?: number;  // 1..100% visible clip ratio
  passiveOffsetTicks?: number;      // Ticks away from BBO for PASSIVE_LIMIT
  aggressiveMaxTicks?: number;      // Ticks across spread capped by maxSlippageBps

  // E. Price Protection
  referencePriceSource: VolumeBotReferenceSource;
  minPriceCollar: string;           // Quote decimal string ("0" = unset)
  maxPriceCollar: string;           // Quote decimal string ("0" = unset)
  maxSlippageBps: number;           // e.g. 50 = 0.50%
  maxParticipationRateBps: number;  // Max % of visible opposite depth or recent volume (e.g. 2500 = 25%)
  staleMarketDataMaxAgeMs: number;  // Reject if reference feed older than this (when using feed)
  tickSize: string;                 // Quote decimal string (e.g. "1000" IDR)
  lotSize: string;                  // Base decimal string (e.g. "0.0001")

  // F. Inventory & Risk Management
  maxBaseInventory: string;         // Max base asset held on bot account (decimal string)
  maxQuoteInventory: string;        // Max quote asset held on bot account (decimal string)
  maxOrderNotional: string;         // Max quote notional per single order
  maxCumulativeExposure: string;    // Max cumulative executed quote notional
  dailyExecutionLimit: string;      // Max daily executed quote notional
  maxOpenOrders: number;            // Max concurrent resting bot-owned orders
  selfTradePrevention: boolean;     // Always enforced; true by default
}

export interface VolumeBotRow {
  id: string;
  name: string;
  owner_id: string;
  account_id: string;
  pair_id: string;
  environment: VolumeBotEnvironment;
  execution_mode: VolumeBotExecutionMode;
  execution_side: VolumeBotSide;
  strategy: VolumeBotStrategy;
  status: VolumeBotStatus;
  enabled: number;
  config_version: number;
  config_json: string;
  target_qty_atomic: string;
  remaining_qty_atomic: string;
  executed_qty_atomic: string;
  executed_quote_atomic: string;
  total_fees_atomic: string;
  weighted_price_num_atomic: string;
  daily_executed_quote_atomic: string;
  daily_reset_day: string;
  submitted_orders_count: number;
  accepted_orders_count: number;
  partial_fills_count: number;
  filled_orders_count: number;
  cancelled_orders_count: number;
  rejected_orders_count: number;
  expired_orders_count: number;
  total_trades_count: number;
  total_slippage_bps_sum: string;
  checkpoint_json: string;
  risk_state_json: string;
  emergency_stopped: number;
  last_execution_at: number | null;
  last_error: string | null;
  migrated_from_legacy_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface VolumeBotOrderRow {
  id: string;
  bot_id: string;
  idempotency_key: string;
  pair_id: string;
  execution_mode: VolumeBotExecutionMode;
  side: VolumeBotSide;
  order_type: 'LIMIT' | 'MARKET';
  price_atomic: string;
  amount_atomic: string;
  filled_amount_atomic: string;
  remaining_amount_atomic: string;
  status: VolumeBotOrderStatus;
  retry_count: number;
  expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface VolumeBotTradeRow {
  id: string;
  trade_id: string;
  bot_id: string;
  order_id: string;
  pair_id: string;
  execution_mode: VolumeBotExecutionMode;
  side: VolumeBotSide;
  price_atomic: string;
  amount_atomic: string;
  quote_total_atomic: string;
  fee_atomic: string;
  fee_asset: string;
  slippage_bps: number;
  timestamp: number;
}

export interface VolumeBotLogRow {
  id: string;
  bot_id: string;
  execution_mode: VolumeBotExecutionMode;
  level: 'INFO' | 'WARN' | 'ERROR' | 'EXECUTION' | 'RISK';
  event_type: string;
  message: string;
  details_json: string | null;
  timestamp: number;
}

export interface VolumeBotCheckpoint {
  nextScheduledAt: number;
  sliceIndex: number;
  recentOrderTimestamps: number[];
  consecutiveFailures: number;
  cooldownUntil: number;
  lastIdempotencyNonce: number;
  lastReferencePriceAtomic: string;
  lastSliceRetryCount: number;
  lastActionReason: string;
}

export interface VolumeBotRiskState {
  riskLocked: boolean;
  riskLockReason: string | null;
  emergencyStopped: boolean;
  lastRiskCheckAt: number;
  lastBalanceAvailableBaseAtomic: string;
  lastBalanceAvailableQuoteAtomic: string;
  lastBalanceLockedBaseAtomic: string;
  lastBalanceLockedQuoteAtomic: string;
  openOrdersCount: number;
  activeExposureQuoteAtomic: string;
  staleDataBlocked: boolean;
  collarBreaches: number;
  slippageBreaches: number;
  balanceRejections: number;
  stpInterceptions: number;
}

export interface VolumeBotDTO {
  id: string;
  name: string;
  ownerId: string;
  accountId: string;
  pairId: string;
  baseAsset: string;
  quoteAsset: string;
  basePrecision: number;
  quotePrecision: number;
  environment: VolumeBotEnvironment;
  executionMode: VolumeBotExecutionMode;
  executionSide: VolumeBotSide;
  strategy: VolumeBotStrategy;
  status: VolumeBotStatus;
  enabled: boolean;
  configVersion: number;
  config: VolumeBotConfig;
  metrics: {
    targetVolume: string;
    targetQtyAtomic: string;
    executedVolume: string;
    executedQtyAtomic: string;
    remainingVolume: string;
    remainingQtyAtomic: string;
    completionPct: number;
    executedQuoteNotional: string;
    executedQuoteAtomic: string;
    averageFillPrice: string;
    averageFillPriceAtomic: string;
    totalFees: string;
    totalFeesAtomic: string;
    dailyExecutedQuote: string;
    dailyExecutedQuoteAtomic: string;
    submittedOrdersCount: number;
    acceptedOrdersCount: number;
    partialFillsCount: number;
    filledOrdersCount: number;
    cancelledOrdersCount: number;
    rejectedOrdersCount: number;
    expiredOrdersCount: number;
    totalTradesCount: number;
    averageSlippageBps: number;
    openOrdersCount: number;
  };
  riskState: VolumeBotRiskState;
  checkpoint: VolumeBotCheckpoint;
  emergencyStopped: boolean;
  lastExecutionAt: number | null;
  lastError: string | null;
  migratedFromLegacyId: string | null;
  createdAt: number;
  updatedAt: number;
}
