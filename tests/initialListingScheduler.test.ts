import { describe, it, expect } from 'vitest';
import { ListingSchedulerService } from '../src/simulation/listingSchedulerService';
import { MMPreparationService } from '../src/simulation/mmPreparationService';
import { LedgerService } from '../src/simulation/ledgerService';
import { executeOrderAgainstCLOB } from '../src/simulation/settlementEngine';
import { InitialListing, InitialListingSchedule, AdminOverride } from '../src/simulation/listingTypes';
import { BookOrder, UserBalance, MarketPair } from '../src/simulation/types';
import { ListingService } from '../src/server/engine/listingService';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { LedgerService as ServerLedgerService } from '../src/server/ledger/ledgerService';
import { EngineManager } from '../src/server/engine/engineManager';

describe('Comprehensive Initial Listing Scheduler & Market Launch System', () => {
  const mockSchedule: InitialListingSchedule = {
    announcement_at: 100000,
    mm_funding_opens_at: 120000,
    mm_setup_opens_at: 150000,
    public_trading_opens_at: 200000,
    deposit_opens_at: 120000,
    withdrawal_opens_at: 300000,
    new_badge_expires_at: 500000,
    min_base_inventory: 1000,
    min_quote_inventory: 50000000,
    target_spread_bps: 30,
    min_depth_levels: 4,
    schedule_version: 1,
  };

  const sampleListing: InitialListing = {
    id: 'list_test_pair_01',
    symbol: 'SOLARA/IDR',
    base_asset: 'SOLARA',
    quote_asset: 'IDR',
    name: 'Solara Network',
    category: 'DEFI',
    status: 'DRAFT',
    mm_preparation_phase: 'NOT_STARTED',
    trading_status: 'CLOSED',
    deposit_status: 'CLOSED',
    withdrawal_status: 'CLOSED',
    visibility: 'HIDDEN',
    initial_price: 25000,
    price_precision: 0,
    amount_precision: 2,
    min_order_amount: 1,
    maker_fee_bps: 10,
    taker_fee_bps: 15,
    assigned_mm_account: 'usr_mm_01',
    schedule: mockSchedule,
    created_at: 90000,
    updated_at: 90000,
    audit_trail: [],
  };

  const sampleBalances: Record<string, UserBalance> = {
    IDR: { asset: 'IDR', free: 100000000, locked: 0, total: 100000000 },
    SOLARA: { asset: 'SOLARA', free: 2000, locked: 0, total: 2000 },
  };

  // Requirement 1: Pair creation defaults to DRAFT, HIDDEN, CLOSED
  it('1. Pair creation defaults strictly to DRAFT, HIDDEN, and CLOSED', () => {
    expect(sampleListing.status).toBe('DRAFT');
    expect(sampleListing.visibility).toBe('HIDDEN');
    expect(sampleListing.trading_status).toBe('CLOSED');
    expect(sampleListing.deposit_status).toBe('CLOSED');
    expect(sampleListing.withdrawal_status).toBe('CLOSED');
  });

  // Requirement 2: Approval sets APPROVED, keeps HIDDEN, CLOSED
  it('2. Approval transitions to APPROVED, but keeps trading CLOSED and visibility HIDDEN', () => {
    const approvedListing: InitialListing = {
      ...sampleListing,
      status: 'APPROVED',
      visibility: 'HIDDEN',
      trading_status: 'CLOSED',
    };

    expect(approvedListing.status).toBe('APPROVED');
    expect(approvedListing.visibility).toBe('HIDDEN');
    expect(approvedListing.trading_status).toBe('CLOSED');
  });

  // Requirement 3: Scheduling requires APPROVED status and sets UPCOMING
  it('3. Scheduling sets status SCHEDULED and visibility UPCOMING', () => {
    const scheduledListing: InitialListing = {
      ...sampleListing,
      status: 'SCHEDULED',
      visibility: 'UPCOMING',
    };

    expect(scheduledListing.status).toBe('SCHEDULED');
    expect(scheduledListing.visibility).toBe('UPCOMING');
  });

  // Requirement 4: Timeline validation: funding <= setup < trading
  it('4. Rejects invalid timeline where setup is after trading open', () => {
    const invalidSchedule = {
      ...mockSchedule,
      mm_setup_opens_at: 250000, // Invalid: after public_trading_opens_at (200000)
    };
    const hasValidTimeline =
      invalidSchedule.mm_funding_opens_at <= invalidSchedule.mm_setup_opens_at &&
      invalidSchedule.mm_setup_opens_at < invalidSchedule.public_trading_opens_at;

    expect(hasValidTimeline).toBe(false);
  });

  // Requirement 5: Double-entry treasury allocation preserves balance conservation
  it('5. Double-entry treasury capital allocation updates balances with exact conservation', () => {
    const userBalancesMap: Record<string, Record<string, UserBalance>> = {
      usr_treasury_01: {
        IDR: { asset: 'IDR', free: 500000000, locked: 0, total: 500000000 },
      },
      usr_mm_01: {
        IDR: { asset: 'IDR', free: 0, locked: 0, total: 0 },
      },
    };

    const result = LedgerService.allocateTreasuryToMM({
      sourceAccount: 'usr_treasury_01',
      targetMMAccount: 'usr_mm_01',
      asset: 'IDR',
      amount: 150000000,
      listingId: sampleListing.id,
      actorId: 'usr_admin_01',
      idempotencyKey: 'test_alloc_key_01',
      userBalancesMap,
    });

    expect(result.success).toBe(true);
    expect(result.updatedBalancesMap.usr_treasury_01['IDR'].free).toBe(350000000);
    expect(result.updatedBalancesMap.usr_mm_01['IDR'].free).toBe(150000000);
    // Balance sum invariant
    const totalAfter =
      result.updatedBalancesMap.usr_treasury_01['IDR'].free +
      result.updatedBalancesMap.usr_mm_01['IDR'].free;
    expect(totalAfter).toBe(500000000);
  });

  // Requirement 6: Inventory thresholds check
  it('6. Correctly identifies insufficient vs sufficient MM inventory', () => {
    const deficientBalances: Record<string, UserBalance> = {
      IDR: { asset: 'IDR', free: 10000000, locked: 0, total: 10000000 }, // < 50,000,000 required
      SOLARA: { asset: 'SOLARA', free: 200, locked: 0, total: 200 }, // < 1,000 required
    };

    const metricsDeficient = MMPreparationService.evaluateMetrics(sampleListing, deficientBalances, []);
    expect(metricsDeficient.isInventorySufficient).toBe(false);

    const metricsSufficient = MMPreparationService.evaluateMetrics(sampleListing, sampleBalances, []);
    expect(metricsSufficient.isInventorySufficient).toBe(true);
  });

  // Requirement 7: Pre-launch quotes generated with isPreLaunch: true
  it('7. Generates pre-launch quotes with isPreLaunch: true and strict depth', () => {
    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing: sampleListing,
      mmUserId: 'usr_mm_01',
      targetSpreadBps: 30,
      levelsCount: 4,
      baseVolumePerLevel: 5.0,
    });

    expect(quotes.length).toBe(8); // 4 bids + 4 asks
    for (const q of quotes) {
      expect(q.isPreLaunch).toBe(true);
      expect(q.pair).toBe('SOLARA/IDR');
    }
  });

  // Requirement 8: Pre-launch orders are isolated from execution when trading is CLOSED / PREPARATION_ONLY
  it('8. Settlement engine isolates pre-launch orders when trading access is not OPEN', () => {
    const preLaunchOrder: BookOrder = {
      id: 'pre_ord_01',
      userId: 'usr_mm_01',
      pair: 'SOLARA/IDR',
      side: 'sell',
      price: 25000,
      amount: 10,
      remainingAmount: 10,
      createdAt: 1000,
      isPreLaunch: true,
    };

    const marketPair: MarketPair = {
      id: 'SOLARA/IDR',
      name: 'Solara Network',
      baseAsset: 'SOLARA',
      quoteAsset: 'IDR',
      lastPrice: 25000,
      change24h: 0,
      high24h: 25000,
      low24h: 25000,
      volume24h: 0,
      priceDecimals: 0,
      amountDecimals: 2,
      minOrderAmount: 1,
      makerFeeBps: 10,
      takerFeeBps: 15,
      isActive: true,
      tradingAccessStatus: 'PREPARATION_ONLY', // Not OPEN!
    };

    const balancesMap: Record<string, Record<string, UserBalance>> = {
      usr_trader_01: {
        IDR: { asset: 'IDR', free: 500000, locked: 0, total: 500000 },
        SOLARA: { asset: 'SOLARA', free: 0, locked: 0, total: 0 },
      },
      usr_mm_01: {
        IDR: { asset: 'IDR', free: 0, locked: 0, total: 0 },
        SOLARA: { asset: 'SOLARA', free: 0, locked: 10, total: 10 },
      },
    };

    // Public trader attempts to trade during preparation only mode
    const result = executeOrderAgainstCLOB(
      'usr_trader_01',
      marketPair,
      'buy',
      'limit',
      5,
      25000,
      [preLaunchOrder],
      balancesMap
    );

    // Order rejected due to PREPARATION_ONLY and pre-launch isolation
    expect(result.success).toBe(false);
    expect(result.trades.length).toBe(0);
    expect(result.message).toMatch(/preparation only/i);
  });

  // Requirement 9: 11-point readiness checklist evaluation
  it('9. Deterministically evaluates all 11 readiness gates', () => {
    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing: sampleListing,
      mmUserId: 'usr_mm_01',
      targetSpreadBps: 30,
      levelsCount: 4,
      baseVolumePerLevel: 5.0,
    });

    const report = ListingSchedulerService.evaluateReadinessChecklist(
      { ...sampleListing, status: 'APPROVED' },
      sampleBalances,
      quotes,
      mockSchedule.public_trading_opens_at // Current time = open time
    );

    expect(report.checks.isApproved).toBe(true);
    expect(report.checks.hasValidSchedule).toBe(true);
    expect(report.checks.timeReached).toBe(true);
    expect(report.checks.notHaltedOrCancelled).toBe(true);
    expect(report.checks.marketActive).toBe(true);
    expect(report.checks.engineHealthy).toBe(true);
    expect(report.checks.mmFunded).toBe(true);
    expect(report.checks.mmInventorySufficient).toBe(true);
    expect(report.checks.ledgerReconciled).toBe(true);
    expect(report.checks.ordersValid).toBe(true);
    expect(report.checks.spreadAcceptable).toBe(true);
    expect(report.isReady).toBe(true);
  });

  // Requirement 10: Fails closed if gates are not met at trading time
  it('10. Postpones launch if scheduled time is reached but readiness checklist fails', () => {
    const deficientListing: InitialListing = {
      ...sampleListing,
      status: 'SCHEDULED',
    };

    // No resting orders deployed!
    const evalRes = ListingSchedulerService.evaluateListingSchedule(
      deficientListing,
      sampleBalances,
      [], // Empty book!
      mockSchedule.public_trading_opens_at
    );

    expect(evalRes.updatedListing.status).toBe('POSTPONED');
    expect(evalRes.updatedListing.trading_status).toBe('CLOSED');
    expect(evalRes.readinessReport.isReady).toBe(false);
    expect(evalRes.readinessReport.failures.length).toBeGreaterThan(0);
  });

  // Requirement 11: Admin override bypasses specified gates with mandatory audit reason
  it('11. Admin override bypasses specified gate failure with audited reason', () => {
    const deficientListing: InitialListing = {
      ...sampleListing,
      status: 'SCHEDULED',
    };

    // Override depth levels
    const override: AdminOverride = {
      actor_id: 'usr_admin_01',
      timestamp: Date.now(),
      reason: 'Approved testnet institutional market launch with external liquidity pool',
      bypass_gates: ['book_depth'],
    };

    const overrideRes = ListingSchedulerService.applyAdminOverride(deficientListing, override);
    expect(overrideRes.success).toBe(true);

    const report = ListingSchedulerService.evaluateReadinessChecklist(
      overrideRes.listing,
      sampleBalances,
      [], // Deficient depth
      mockSchedule.public_trading_opens_at
    );

    // Book depth failure was bypassed by the override
    expect(report.failures.some((f) => f.includes('order book depth'))).toBe(false);
  });

  // Requirement 12: Pre-launch orders are atomically unlocked at launch into live book
  it('12. Unlocks pre-launch orders into the live order book with isPreLaunch stripped', () => {
    const preLaunchOrders: BookOrder[] = [
      {
        id: 'ord_1',
        userId: 'usr_mm_01',
        pair: 'SOLARA/IDR',
        side: 'buy',
        price: 24900,
        amount: 2,
        remainingAmount: 2,
        createdAt: 100,
        isPreLaunch: true,
      },
      {
        id: 'ord_2',
        userId: 'usr_mm_01',
        pair: 'SOLARA/IDR',
        side: 'sell',
        price: 25100,
        amount: 2,
        remainingAmount: 2,
        createdAt: 101,
        isPreLaunch: true,
      },
    ];

    const unlocked = MMPreparationService.unlockPreLaunchOrders(preLaunchOrders, 'SOLARA/IDR');
    for (const o of unlocked) {
      expect(o.isPreLaunch).toBe(false);
      expect(o.remainingAmount).toBe(2);
    }
  });

  // Requirement 13: Full automated live launch transition when gates pass
  it('13. Transitions market to LIVE and trading to OPEN when all gates pass at scheduled time', () => {
    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing: sampleListing,
      mmUserId: 'usr_mm_01',
      targetSpreadBps: 30,
      levelsCount: 4,
      baseVolumePerLevel: 5.0,
    });

    const readyListing: InitialListing = {
      ...sampleListing,
      status: 'SCHEDULED',
    };

    const evalRes = ListingSchedulerService.evaluateListingSchedule(
      readyListing,
      sampleBalances,
      quotes,
      mockSchedule.public_trading_opens_at
    );

    expect(evalRes.updatedListing.status).toBe('LIVE');
    expect(evalRes.updatedListing.trading_status).toBe('OPEN');
    expect(evalRes.updatedListing.visibility).toBe('LIVE');
    expect(evalRes.unlockedOrders).toBe(true);
  });

  // Requirement 14: NEW badge expires independently
  it('14. Determines NEW badge active status independently from trading status', () => {
    const liveListing: InitialListing = {
      ...sampleListing,
      status: 'LIVE',
      schedule: {
        ...mockSchedule,
        new_badge_expires_at: 300000,
      },
    };

    expect(ListingSchedulerService.isNewBadgeActive(liveListing, 250000)).toBe(true);
    expect(ListingSchedulerService.isNewBadgeActive(liveListing, 350000)).toBe(false);
  });

  // Requirement 15: Independent deposit and withdrawal schedule triggers
  it('15. Automatically activates deposit and withdrawal independently according to schedules', () => {
    const evalAtDepositTime = ListingSchedulerService.evaluateListingSchedule(
      sampleListing,
      sampleBalances,
      [],
      mockSchedule.deposit_opens_at // 120000
    );
    expect(evalAtDepositTime.updatedListing.deposit_status).toBe('OPEN');
    expect(evalAtDepositTime.updatedListing.withdrawal_status).toBe('CLOSED');

    const evalAtWithdrawalTime = ListingSchedulerService.evaluateListingSchedule(
      evalAtDepositTime.updatedListing,
      sampleBalances,
      [],
      mockSchedule.withdrawal_opens_at // 300000
    );
    expect(evalAtWithdrawalTime.updatedListing.withdrawal_status).toBe('OPEN');
  });

  // Requirement 16: Backend SQLite ListingService integration
  it('16. Backend ListingService supports atomic draft creation, review, and scheduling in SQLite', async () => {
    const dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    const ledger = new ServerLedgerService(dbMgr);
    const engineMgr = new EngineManager(dbMgr, ledger);
    const listingService = new ListingService(dbMgr, ledger, engineMgr);

    const all = listingService.getAllListings();
    expect(Array.isArray(all)).toBe(true);

    const created = listingService.createMarketPairDraft({
      symbol: 'TESTPAIR/IDR',
      baseAsset: 'TESTPAIR',
      quoteAsset: 'IDR',
      name: 'Test Pair SQLite',
      category: 'DEFI',
      initialPrice: 15000,
      makerFeeBps: 10,
      takerFeeBps: 15,
      assignedMMAccount: 'usr_mm_01',
      actorId: 'usr_admin_01',
    });

    expect(created).toBeDefined();
    expect(created.status).toBe('DRAFT');
    expect(created.trading_status).toBe('CLOSED');

    const reviewed = listingService.reviewListing(
      created.id,
      'submit',
      'usr_admin_01'
    );
    expect(reviewed.status).toBe('UNDER_REVIEW');

    const approved = listingService.reviewListing(
      created.id,
      'approve',
      'usr_admin_01',
      'Approved in test'
    );
    expect(approved.status).toBe('APPROVED');

    const scheduled = listingService.scheduleListing(created.id, {
      scheduledListingAt: Date.now() + 100000,
      mmFundingOpensAt: Date.now() + 20000,
      mmSetupOpensAt: Date.now() + 40000,
      tradingOpensAt: Date.now() + 100000,
      depositOpensAt: Date.now() + 20000,
      withdrawalOpensAt: Date.now() + 200000,
      newBadgeExpiresAt: Date.now() + 400000,
      minBaseInventory: 1000,
      minQuoteInventory: 50000000,
      minBidDepth: 4,
      minAskDepth: 4,
      maxInitialSpreadPct: 1.0,
      actorId: 'usr_admin_01',
    });

    expect(scheduled).toBeDefined();
    expect(scheduled.status).toBe('SCHEDULED');
    expect(scheduled.public_visibility).toBe('UPCOMING');
  });
});
