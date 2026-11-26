import { describe, it, expect } from 'vitest';
import { ListingLifecycleService } from '../src/simulation/listingLifecycleService';
import { Listing, ListingSchedule } from '../src/simulation/listingTypes';

describe('Gate 2: Listing Lifecycle & State Machine', () => {
  const baseListing: Listing = {
    id: 'list_test_01',
    market_id: 'NEX/IDR',
    status: 'DRAFT',
    mm_phase: 'NOT_STARTED',
    trading_status: 'CLOSED',
    deposit_status: 'CLOSED',
    withdrawal_status: 'CLOSED',
    public_visibility: 'HIDDEN',
    assigned_mm_account: 'usr_mm_01',
    version: 1,
    created_at: 10000,
    updated_at: 10000,
  };

  const adminCtx = { actorId: 'usr_admin_01', actorRole: 'admin' as const };
  const traderCtx = { actorId: 'usr_trader_01', actorRole: 'trader' as const };

  it('rejects unauthorized trader trying to approve listing', () => {
    const res = ListingLifecycleService.transitionListing(baseListing, 'UNDER_REVIEW', traderCtx);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Only admin or system/);
  });

  it('allows DRAFT -> UNDER_REVIEW -> APPROVED workflow', () => {
    const res1 = ListingLifecycleService.transitionListing(baseListing, 'UNDER_REVIEW', adminCtx);
    expect(res1.success).toBe(true);
    expect(res1.listing.status).toBe('UNDER_REVIEW');
    expect(res1.listing.version).toBe(2);

    const res2 = ListingLifecycleService.transitionListing(res1.listing, 'APPROVED', adminCtx);
    expect(res2.success).toBe(true);
    expect(res2.listing.status).toBe('APPROVED');
    // Invariant: APPROVED does NOT open trading or make it publicly live
    expect(res2.listing.trading_status).toBe('CLOSED');
    expect(res2.listing.public_visibility).toBe('HIDDEN');
  });

  it('rejects APPROVED -> SCHEDULED if schedule is missing or invalid', () => {
    const approvedListing: Listing = {
      ...baseListing,
      status: 'APPROVED',
      version: 2,
    };

    // Missing schedule
    const resNoSchedule = ListingLifecycleService.transitionListing(approvedListing, 'SCHEDULED', adminCtx);
    expect(resNoSchedule.success).toBe(false);
    expect(resNoSchedule.error).toMatch(/explicit listing schedule/);

    // Invalid timeline (funding after trading)
    const invalidSchedule: ListingSchedule = {
      id: 'sch_01',
      listing_id: approvedListing.id,
      market_id: 'NEX/IDR',
      timezone: 'Asia/Jakarta',
      scheduled_listing_at: 100000,
      trading_opens_at: 100000,
      mm_funding_opens_at: 110000, // Invalid: after trading!
      mm_setup_opens_at: 95000,
      new_badge_expires_at: 200000,
      deposit_opens_at: 110000,
      withdrawal_opens_at: 110000,
      minimum_mm_base_inventory: 100,
      minimum_mm_quote_inventory: 1000000,
      minimum_bid_depth: 5,
      minimum_ask_depth: 5,
      maximum_initial_spread_pct: 1.5,
      schedule_version: 1,
      created_by: 'usr_admin_01',
      created_at: 5000,
      updated_at: 5000,
    };

    const resInvalid = ListingLifecycleService.transitionListing(
      approvedListing,
      'SCHEDULED',
      { ...adminCtx, timestamp: 50000 },
      invalidSchedule
    );
    expect(resInvalid.success).toBe(false);
    expect(resInvalid.error).toMatch(/mm_funding_opens_at must be before or equal to trading_opens_at/);
  });

  it('allows APPROVED -> SCHEDULED with valid schedule and sets public_visibility = UPCOMING', () => {
    const approvedListing: Listing = {
      ...baseListing,
      status: 'APPROVED',
      version: 2,
    };

    const validSchedule: ListingSchedule = {
      id: 'sch_01',
      listing_id: approvedListing.id,
      market_id: 'NEX/IDR',
      timezone: 'Asia/Jakarta',
      scheduled_listing_at: 100000,
      trading_opens_at: 100000,
      mm_funding_opens_at: 80000,
      mm_setup_opens_at: 90000,
      new_badge_expires_at: 186400000,
      deposit_opens_at: 105000,
      withdrawal_opens_at: 105000,
      minimum_mm_base_inventory: 100,
      minimum_mm_quote_inventory: 1000000,
      minimum_bid_depth: 5,
      minimum_ask_depth: 5,
      maximum_initial_spread_pct: 1.5,
      schedule_version: 1,
      created_by: 'usr_admin_01',
      created_at: 5000,
      updated_at: 5000,
    };

    const res = ListingLifecycleService.transitionListing(
      approvedListing,
      'SCHEDULED',
      { ...adminCtx, timestamp: 50000 },
      validSchedule
    );

    expect(res.success).toBe(true);
    expect(res.listing.status).toBe('SCHEDULED');
    expect(res.listing.public_visibility).toBe('UPCOMING');
    expect(res.listing.trading_status).toBe('CLOSED'); // trading remains closed
  });

  it('cannot transition CANCELLED listing to LIVE', () => {
    const cancelledListing: Listing = {
      ...baseListing,
      status: 'CANCELLED',
      version: 5,
    };

    const res = ListingLifecycleService.transitionListing(cancelledListing, 'LIVE', adminCtx);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Illegal state transition/);
  });

  it('verifies independent feature access for deposit and withdrawal', () => {
    let listing: Listing = { ...baseListing, status: 'LIVE', trading_status: 'OPEN' };

    // Deposit opens independently
    const depRes = ListingLifecycleService.updateFeatureAccess(listing, 'deposit', 'OPEN', adminCtx);
    expect(depRes.success).toBe(true);
    listing = depRes.listing;
    expect(listing.deposit_status).toBe('OPEN');
    expect(listing.withdrawal_status).toBe('CLOSED');

    // Withdrawal remains closed until explicitly opened
    const wthRes = ListingLifecycleService.updateFeatureAccess(listing, 'withdrawal', 'OPEN', adminCtx);
    expect(wthRes.success).toBe(true);
    listing = wthRes.listing;
    expect(listing.withdrawal_status).toBe('OPEN');
  });

  it('validates NEW badge active condition and expiration', () => {
    const liveListing: Listing = {
      ...baseListing,
      status: 'LIVE',
      trading_status: 'OPEN',
      new_badge_expires_at: 100000,
    };

    expect(ListingLifecycleService.isNewBadgeActive(liveListing, 90000)).toBe(true);
    expect(ListingLifecycleService.isNewBadgeActive(liveListing, 105000)).toBe(false);

    // Non-live listing does not show new badge even if expiry is future
    const preparingListing: Listing = { ...liveListing, status: 'PREPARING' };
    expect(ListingLifecycleService.isNewBadgeActive(preparingListing, 90000)).toBe(false);
  });
});
