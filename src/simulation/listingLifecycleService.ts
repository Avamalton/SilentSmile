import {
  Listing,
  ListingEvent,
  ListingSchedule,
  ListingStatus,
  MMPreparationPhase,
  TradingAccessStatus,
  FeatureAccessStatus,
  PublicMarketVisibility,
  LaunchReadinessReport,
} from './listingTypes';

export interface TransitionContext {
  actorId: string;
  actorRole: 'admin' | 'market_maker' | 'trader' | 'system';
  timestamp?: number;
  reason?: string;
  metadata?: Record<string, any>;
}

export class ListingLifecycleService {
  /**
   * Validate that schedule timestamps are coherent and in chronological sequence:
   * mm_funding_opens_at <= mm_setup_opens_at < trading_opens_at
   */
  static validateScheduleTimeline(schedule: Partial<ListingSchedule>, currentTime: number): { isValid: boolean; error?: string } {
    if (!schedule.scheduled_listing_at || schedule.scheduled_listing_at <= currentTime) {
      return { isValid: false, error: 'scheduled_listing_at must be in the future.' };
    }
    if (!schedule.trading_opens_at || schedule.trading_opens_at <= currentTime) {
      return { isValid: false, error: 'trading_opens_at must be in the future.' };
    }
    if (schedule.mm_funding_opens_at === undefined || schedule.mm_funding_opens_at > schedule.trading_opens_at) {
      return { isValid: false, error: 'mm_funding_opens_at must be before or equal to trading_opens_at.' };
    }
    if (schedule.mm_setup_opens_at === undefined || schedule.mm_setup_opens_at < schedule.mm_funding_opens_at) {
      return { isValid: false, error: 'mm_setup_opens_at must be after or equal to mm_funding_opens_at.' };
    }
    if (schedule.mm_setup_opens_at > schedule.trading_opens_at) {
      return { isValid: false, error: 'mm_setup_opens_at must not be after trading_opens_at.' };
    }
    if (schedule.deposit_opens_at !== undefined && schedule.deposit_opens_at < schedule.trading_opens_at) {
      return { isValid: false, error: 'deposit_opens_at cannot open before trading_opens_at.' };
    }
    if (schedule.withdrawal_opens_at !== undefined && schedule.withdrawal_opens_at < schedule.trading_opens_at) {
      return { isValid: false, error: 'withdrawal_opens_at cannot open before trading_opens_at.' };
    }
    return { isValid: true };
  }

  /**
   * Transitions listing to a new lifecycle state enforcing invariant business rules
   */
  static transitionListing(
    listing: Listing,
    targetStatus: ListingStatus,
    ctx: TransitionContext,
    schedule?: ListingSchedule
  ): { success: boolean; listing: Listing; event: ListingEvent; error?: string } {
    const now = ctx.timestamp ?? Date.now();

    // 1. Authorization check
    if (ctx.actorRole !== 'admin' && ctx.actorRole !== 'system') {
      return {
        success: false,
        listing,
        event: this.createEvent(listing, 'TRANSITION_DENIED', listing.status, listing.status, ctx, { error: 'Unauthorized role' }),
        error: `Only admin or system can transition listing status (got: ${ctx.actorRole}).`,
      };
    }

    // 2. State-Transition Matrix Validation
    const from = listing.status;
    let allowed = false;

    switch (from) {
      case 'DRAFT':
        allowed = targetStatus === 'UNDER_REVIEW' || targetStatus === 'CANCELLED';
        break;
      case 'UNDER_REVIEW':
        allowed = targetStatus === 'APPROVED' || targetStatus === 'DRAFT' || targetStatus === 'CANCELLED';
        break;
      case 'APPROVED':
        allowed = targetStatus === 'SCHEDULED' || targetStatus === 'DRAFT' || targetStatus === 'CANCELLED';
        break;
      case 'SCHEDULED':
        allowed = targetStatus === 'PREPARING' || targetStatus === 'POSTPONED' || targetStatus === 'CANCELLED' || targetStatus === 'LIVE';
        break;
      case 'PREPARING':
        allowed = targetStatus === 'LIVE' || targetStatus === 'POSTPONED' || targetStatus === 'PAUSED' || targetStatus === 'CANCELLED';
        break;
      case 'LIVE':
        allowed = targetStatus === 'COMPLETED' || targetStatus === 'PAUSED' || targetStatus === 'CANCELLED';
        break;
      case 'PAUSED':
        allowed = targetStatus === 'PREPARING' || targetStatus === 'LIVE' || targetStatus === 'CANCELLED' || targetStatus === 'POSTPONED';
        break;
      case 'POSTPONED':
        allowed = targetStatus === 'SCHEDULED' || targetStatus === 'DRAFT' || targetStatus === 'CANCELLED';
        break;
      case 'COMPLETED':
      case 'CANCELLED':
        // Terminal states
        allowed = false;
        break;
    }

    if (!allowed) {
      return {
        success: false,
        listing,
        event: this.createEvent(listing, 'INVALID_TRANSITION', from, targetStatus, ctx, { from, targetStatus }),
        error: `Illegal state transition from ${from} to ${targetStatus}.`,
      };
    }

    // 3. Preconditions checking per target state
    if (targetStatus === 'SCHEDULED') {
      if (!schedule) {
        return {
          success: false,
          listing,
          event: this.createEvent(listing, 'SCHEDULE_MISSING', from, targetStatus, ctx),
          error: 'An approved market must have an explicit listing schedule before it can become SCHEDULED.',
        };
      }
      const timelineCheck = this.validateScheduleTimeline(schedule, now);
      if (!timelineCheck.isValid) {
        return {
          success: false,
          listing,
          event: this.createEvent(listing, 'SCHEDULE_INVALID', from, targetStatus, ctx, { reason: timelineCheck.error }),
          error: timelineCheck.error,
        };
      }
    }

    // 4. Compute independent dimensions based on target state
    const nextTradingStatus: TradingAccessStatus =
      targetStatus === 'LIVE'
        ? 'OPEN'
        : targetStatus === 'PREPARING'
        ? 'PREPARATION_ONLY'
        : targetStatus === 'PAUSED'
        ? 'HALTED'
        : 'CLOSED';

    const nextVisibility: PublicMarketVisibility =
      targetStatus === 'LIVE' || targetStatus === 'COMPLETED'
        ? 'LIVE'
        : targetStatus === 'SCHEDULED' || targetStatus === 'PREPARING'
        ? 'UPCOMING'
        : targetStatus === 'PAUSED'
        ? 'HALTED'
        : 'HIDDEN';

    const nextMMPhase: MMPreparationPhase =
      targetStatus === 'PREPARING'
        ? listing.mm_phase === 'NOT_STARTED'
          ? 'FUNDING_OPEN'
          : listing.mm_phase
        : targetStatus === 'LIVE'
        ? 'READY'
        : targetStatus === 'CANCELLED'
        ? 'FAILED'
        : listing.mm_phase;

    const nextBadgeExpiry =
      targetStatus === 'LIVE' && schedule?.new_badge_expires_at
        ? schedule.new_badge_expires_at
        : listing.new_badge_expires_at;

    const updatedListing: Listing = {
      ...listing,
      status: targetStatus,
      trading_status: nextTradingStatus,
      public_visibility: nextVisibility,
      mm_phase: nextMMPhase,
      approved_by: targetStatus === 'APPROVED' ? ctx.actorId : listing.approved_by,
      approved_at: targetStatus === 'APPROVED' ? now : listing.approved_at,
      scheduled_at: targetStatus === 'SCHEDULED' ? now : listing.scheduled_at,
      actual_launch_at: targetStatus === 'LIVE' ? now : listing.actual_launch_at,
      new_badge_expires_at: nextBadgeExpiry,
      review_notes: ctx.reason ?? listing.review_notes,
      version: listing.version + 1,
      updated_at: now,
    };

    const event = this.createEvent(updatedListing, `TRANSITION_TO_${targetStatus}`, from, targetStatus, ctx, {
      trading_status: nextTradingStatus,
      public_visibility: nextVisibility,
      mm_phase: nextMMPhase,
    });

    return {
      success: true,
      listing: updatedListing,
      event,
    };
  }

  /**
   * Helper to evaluate whether a market's NEW badge is currently active
   */
  static isNewBadgeActive(listing: Listing, currentTime: number = Date.now()): boolean {
    if (listing.status !== 'LIVE' && listing.status !== 'COMPLETED') {
      return false;
    }
    if (!listing.new_badge_expires_at) return false;
    return currentTime < listing.new_badge_expires_at;
  }

  /**
   * Update feature-specific access (Deposit or Withdrawal) independently
   */
  static updateFeatureAccess(
    listing: Listing,
    feature: 'deposit' | 'withdrawal',
    targetStatus: FeatureAccessStatus,
    ctx: TransitionContext
  ): { success: boolean; listing: Listing; event: ListingEvent; error?: string } {
    if (ctx.actorRole !== 'admin' && ctx.actorRole !== 'system') {
      return {
        success: false,
        listing,
        event: this.createEvent(listing, 'FEATURE_ACCESS_DENIED', listing[feature === 'deposit' ? 'deposit_status' : 'withdrawal_status'], targetStatus, ctx),
        error: `Unauthorized to change ${feature} access.`,
      };
    }

    const prev = feature === 'deposit' ? listing.deposit_status : listing.withdrawal_status;
    const now = ctx.timestamp ?? Date.now();

    const updatedListing: Listing = {
      ...listing,
      [feature === 'deposit' ? 'deposit_status' : 'withdrawal_status']: targetStatus,
      version: listing.version + 1,
      updated_at: now,
    };

    const event = this.createEvent(
      updatedListing,
      `${feature.toUpperCase()}_STATUS_${targetStatus}`,
      prev,
      targetStatus,
      ctx
    );

    return {
      success: true,
      listing: updatedListing,
      event,
    };
  }

  private static createEvent(
    listing: Listing,
    type: string,
    previousState: string,
    newState: string,
    ctx: TransitionContext,
    meta?: Record<string, any>
  ): ListingEvent {
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      listing_id: listing.id,
      event_type: type,
      previous_state: previousState,
      new_state: newState,
      actor_id: ctx.actorId,
      timestamp: ctx.timestamp ?? Date.now(),
      schedule_version: listing.version,
      metadata: {
        reason: ctx.reason,
        ...ctx.metadata,
        ...meta,
      },
    };
  }
}
