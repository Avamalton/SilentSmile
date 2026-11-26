export type ListingStatus =
  | 'DRAFT'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PREPARING'
  | 'LIVE'
  | 'COMPLETED'
  | 'PAUSED'
  | 'POSTPONED'
  | 'CANCELLED';

export type MMPreparationPhase =
  | 'NOT_STARTED'
  | 'FUNDING_OPEN'
  | 'FUNDING_COMPLETE'
  | 'ORDER_SETUP_OPEN'
  | 'READY'
  | 'FAILED'
  | 'EXPIRED';

export type TradingAccessStatus = 'CLOSED' | 'PREPARATION_ONLY' | 'OPEN' | 'HALTED';

export type FeatureAccessStatus = 'CLOSED' | 'OPEN' | 'SUSPENDED';

export type PublicMarketVisibility = 'HIDDEN' | 'UPCOMING' | 'LIVE' | 'HALTED';

export interface ListingSchedule {
  id: string;
  listing_id: string;
  market_id: string;
  timezone: string; // e.g. 'Asia/Jakarta' (UTC+7)
  scheduled_listing_at: number; // UTC ms
  mm_funding_opens_at: number; // UTC ms
  mm_setup_opens_at: number; // UTC ms
  trading_opens_at: number; // UTC ms
  new_badge_expires_at: number; // UTC ms
  deposit_opens_at: number; // UTC ms
  withdrawal_opens_at: number; // UTC ms

  // Thresholds and requirements
  minimum_mm_base_inventory: number;
  minimum_mm_quote_inventory: number;
  minimum_bid_depth: number;
  minimum_ask_depth: number;
  maximum_initial_spread_pct: number;

  schedule_version: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  reschedule_reason?: string;
}

export interface Listing {
  id: string;
  market_id: string;
  status: ListingStatus;
  mm_phase: MMPreparationPhase;
  trading_status: TradingAccessStatus;
  deposit_status: FeatureAccessStatus;
  withdrawal_status: FeatureAccessStatus;
  public_visibility: PublicMarketVisibility;
  assigned_mm_account: string;

  approved_by?: string;
  approved_at?: number;
  scheduled_at?: number;
  actual_launch_at?: number;
  new_badge_expires_at?: number;
  review_notes?: string;

  version: number;
  created_at: number;
  updated_at: number;
}

export interface ListingEvent {
  id: string;
  listing_id: string;
  event_type: string;
  previous_state: string;
  new_state: string;
  actor_id: string;
  timestamp: number;
  schedule_version: number;
  metadata?: Record<string, any>;
}

export interface LaunchReadinessReport {
  isReady: boolean;
  timestamp: number;
  checks: {
    isApproved: boolean;
    hasValidSchedule: boolean;
    timeReached: boolean;
    notHaltedOrCancelled: boolean;
    marketActive: boolean;
    engineHealthy: boolean;
    mmFunded: boolean;
    mmInventorySufficient: boolean;
    ledgerReconciled: boolean;
    ordersValid: boolean;
    spreadAcceptable: boolean;
  };
  failures: string[];
  diagnostics: Record<string, any>;
}

export interface InitialListingSchedule {
  announcement_at: number;
  mm_funding_opens_at: number;
  mm_setup_opens_at: number;
  public_trading_opens_at: number;
  deposit_opens_at: number;
  withdrawal_opens_at: number;
  new_badge_expires_at: number;
  min_base_inventory: number;
  min_quote_inventory: number;
  target_spread_bps: number;
  min_depth_levels: number;
  schedule_version: number;
}

export interface AdminOverride {
  actor_id: string;
  timestamp: number;
  reason: string;
  bypass_gates: string[];
}

export interface InitialListing {
  id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  name: string;
  category: string;
  status: ListingStatus;
  mm_preparation_phase: MMPreparationPhase;
  trading_status: TradingAccessStatus;
  deposit_status: FeatureAccessStatus;
  withdrawal_status: FeatureAccessStatus;
  visibility: PublicMarketVisibility;
  initial_price: number;
  price_precision: number;
  amount_precision: number;
  min_order_amount: number;
  maker_fee_bps: number;
  taker_fee_bps: number;
  assigned_mm_account?: string;
  schedule: InitialListingSchedule;
  admin_override?: AdminOverride;
  created_at: number;
  updated_at: number;
  audit_trail: ListingEvent[];
}

