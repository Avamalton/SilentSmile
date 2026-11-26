import { describe, it, expect } from 'vitest';
import { ListingSchedulerService } from '../src/simulation/listingSchedulerService';
import { InitialListing } from '../src/simulation/listingTypes';
import { BookOrder, UserBalance } from '../src/simulation/types';

describe('Tahap 5 - Launch Scheduler & Readiness Gate', () => {
  const createBaseListing = (): InitialListing => ({
    id: 'list_launch_01',
    symbol: 'ABC/IDR',
    base_asset: 'ABC',
    quote_asset: 'IDR',
    name: 'Alpha Beta Coin',
    category: 'DEFI',
    status: 'PREPARING',
    mm_preparation_phase: 'READY',
    trading_status: 'PREPARATION_ONLY',
    deposit_status: 'CLOSED',
    withdrawal_status: 'CLOSED',
    visibility: 'UPCOMING',
    initial_price: 10000,
    price_precision: 0,
    amount_precision: 2,
    min_order_amount: 1,
    maker_fee_bps: 10,
    taker_fee_bps: 15,
    schedule: {
      announcement_at: 1000,
      mm_funding_opens_at: 2000,
      mm_setup_opens_at: 3000,
      public_trading_opens_at: 4000,
      deposit_opens_at: 2500,
      withdrawal_opens_at: 5000,
      new_badge_expires_at: 8000,
      min_base_inventory: 100,
      min_quote_inventory: 5000000,
      target_spread_bps: 40,
      min_depth_levels: 3,
      schedule_version: 1,
    },
    created_at: 1000,
    updated_at: 1000,
    audit_trail: [],
  });

  const fundedBalances: Record<string, UserBalance> = {
    ABC: { asset: 'ABC', free: 500, locked: 0, total: 500 },
    IDR: { asset: 'IDR', free: 20000000, locked: 0, total: 20000000 },
  };

  const validRestingOrders: BookOrder[] = [
    { id: 'b1', userId: 'usr_mm_01', pair: 'ABC/IDR', side: 'buy', price: 9980, amount: 10, remainingAmount: 10, createdAt: 3500 },
    { id: 'b2', userId: 'usr_mm_01', pair: 'ABC/IDR', side: 'buy', price: 9950, amount: 10, remainingAmount: 10, createdAt: 3500 },
    { id: 'b3', userId: 'usr_mm_01', pair: 'ABC/IDR', side: 'buy', price: 9900, amount: 10, remainingAmount: 10, createdAt: 3500 },
    { id: 'a1', userId: 'usr_mm_01', pair: 'ABC/IDR', side: 'sell', price: 10020, amount: 10, remainingAmount: 10, createdAt: 3500 },
    { id: 'a2', userId: 'usr_mm_01', pair: 'ABC/IDR', side: 'sell', price: 10050, amount: 10, remainingAmount: 10, createdAt: 3500 },
    { id: 'a3', userId: 'usr_mm_01', pair: 'ABC/IDR', side: 'sell', price: 10100, amount: 10, remainingAmount: 10, createdAt: 3500 },
  ];

  it('passes readiness checklist when all criteria are satisfied at public launch time', () => {
    const listing = createBaseListing();
    const report = ListingSchedulerService.evaluateReadinessChecklist(
      listing,
      fundedBalances,
      validRestingOrders,
      4000
    );

    expect(report.isReady).toBe(true);
    expect(report.failures).toHaveLength(0);
  });

  it('fails readiness checklist when MM inventory is deficient', () => {
    const listing = createBaseListing();
    const poorBalances: Record<string, UserBalance> = {
      ABC: { asset: 'ABC', free: 5, locked: 0, total: 5 }, // Needs 100
      IDR: { asset: 'IDR', free: 1000, locked: 0, total: 1000 }, // Needs 5,000,000
    };

    const report = ListingSchedulerService.evaluateReadinessChecklist(
      listing,
      poorBalances,
      validRestingOrders,
      4000
    );

    expect(report.isReady).toBe(false);
    expect(report.failures.some((f) => f.includes('MM inventory deficient'))).toBe(true);
  });

  it('allows authorized admin override with audit reason to bypass specific failed gates', () => {
    const listing = createBaseListing();
    const poorBalances: Record<string, UserBalance> = {
      ABC: { asset: 'ABC', free: 5, locked: 0, total: 5 },
      IDR: { asset: 'IDR', free: 1000, locked: 0, total: 1000 },
    };

    // Override with invalid short reason should fail
    const invalidOverride = ListingSchedulerService.applyAdminOverride(listing, {
      actor_id: 'admin_1',
      timestamp: 3900,
      reason: 'ok',
      bypass_gates: ['mm_inventory'],
    });
    expect(invalidOverride.success).toBe(false);

    // Valid override with clear reason
    const validOverride = ListingSchedulerService.applyAdminOverride(listing, {
      actor_id: 'admin_lead',
      timestamp: 3900,
      reason: 'Approved testnet launch with external liquidity provider',
      bypass_gates: ['mm_inventory'],
    });
    expect(validOverride.success).toBe(true);

    const report = ListingSchedulerService.evaluateReadinessChecklist(
      validOverride.listing,
      poorBalances,
      validRestingOrders,
      4000
    );

    expect(report.isReady).toBe(true);
    expect(report.diagnostics.bypassedCount).toBe(1);
  });

  it('handles automated milestone transitions and fail-closed postponement', () => {
    const listing = createBaseListing();

    // 1. At t=2600 (past deposit_opens_at 2500, but before trading open)
    const result1 = ListingSchedulerService.evaluateListingSchedule(
      listing,
      fundedBalances,
      validRestingOrders,
      2600
    );
    expect(result1.updatedListing.deposit_status).toBe('OPEN');
    expect(result1.updatedListing.status).toBe('PREPARING');
    expect(result1.updatedListing.trading_status).toBe('PREPARATION_ONLY');

    // 2. At t=4000 with valid conditions -> launches LIVE!
    const result2 = ListingSchedulerService.evaluateListingSchedule(
      result1.updatedListing,
      fundedBalances,
      validRestingOrders,
      4000
    );
    expect(result2.updatedListing.status).toBe('LIVE');
    expect(result2.updatedListing.trading_status).toBe('OPEN');
    expect(result2.unlockedOrders).toBe(true);

    // 3. Fail-closed test: If checklist fails at t=4000, postpones instead of launching
    const failingListing = createBaseListing();
    const resultFail = ListingSchedulerService.evaluateListingSchedule(
      failingListing,
      { ABC: { asset: 'ABC', free: 0, locked: 0, total: 0 }, IDR: { asset: 'IDR', free: 0, locked: 0, total: 0 } },
      [],
      4000
    );
    expect(resultFail.updatedListing.status).toBe('POSTPONED');
    expect(resultFail.updatedListing.trading_status).toBe('CLOSED');
    expect(resultFail.unlockedOrders).toBe(false);
  });

  it('evaluates NEW badge validity correctly based on expiration milestone', () => {
    const listing = createBaseListing();
    listing.status = 'LIVE';

    expect(ListingSchedulerService.isNewBadgeActive(listing, 4500)).toBe(true);
    expect(ListingSchedulerService.isNewBadgeActive(listing, 8000)).toBe(false);
    expect(ListingSchedulerService.isNewBadgeActive(listing, 9000)).toBe(false);
  });
});
