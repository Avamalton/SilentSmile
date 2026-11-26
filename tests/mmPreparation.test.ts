import { describe, it, expect } from 'vitest';
import { MMPreparationService } from '../src/simulation/mmPreparationService';
import { InitialListing } from '../src/simulation/listingTypes';
import { BookOrder, MarketPair, UserBalance } from '../src/simulation/types';
import { executeOrderAgainstCLOB } from '../src/simulation/settlementEngine';

describe('Tahap 4 - MM Preparation & Pre-Launch CLOB Isolation', () => {
  const mockListing: InitialListing = {
    id: 'list_test_01',
    symbol: 'MOCK/IDR',
    base_asset: 'MOCK',
    quote_asset: 'IDR',
    name: 'Mock Token',
    category: 'DEFI',
    status: 'PREPARING',
    mm_preparation_phase: 'NOT_STARTED',
    trading_status: 'PREPARATION_ONLY',
    deposit_status: 'CLOSED',
    withdrawal_status: 'CLOSED',
    visibility: 'UPCOMING',
    initial_price: 50000,
    price_precision: 0,
    amount_precision: 2,
    min_order_amount: 0.1,
    maker_fee_bps: 10,
    taker_fee_bps: 15,
    schedule: {
      announcement_at: 1000,
      mm_funding_opens_at: 2000,
      mm_setup_opens_at: 3000,
      public_trading_opens_at: 4000,
      deposit_opens_at: 2000,
      withdrawal_opens_at: 5000,
      new_badge_expires_at: 8000,
      min_base_inventory: 100,
      min_quote_inventory: 5000000,
      target_spread_bps: 30,
      min_depth_levels: 3,
      schedule_version: 1,
    },
    created_at: 1000,
    updated_at: 1000,
    audit_trail: [],
  };

  it('correctly transitions MM preparation phases based on time and inventory', () => {
    const emptyBalances: Record<string, UserBalance> = {
      MOCK: { asset: 'MOCK', free: 0, locked: 0, total: 0 },
      IDR: { asset: 'IDR', free: 0, locked: 0, total: 0 },
    };
    const fundedBalances: Record<string, UserBalance> = {
      MOCK: { asset: 'MOCK', free: 200, locked: 0, total: 200 },
      IDR: { asset: 'IDR', free: 10000000, locked: 0, total: 10000000 },
    };

    // 1. Before funding opens (t = 1500)
    const res1 = MMPreparationService.evaluatePhase(mockListing, emptyBalances, [], 1500);
    expect(res1.nextPhase).toBe('NOT_STARTED');

    // 2. Funding opens, no funds yet (t = 2500)
    const res2 = MMPreparationService.evaluatePhase(mockListing, emptyBalances, [], 2500);
    expect(res2.nextPhase).toBe('FUNDING_OPEN');

    // 3. Funding opens, funds allocated (t = 2500)
    const res3 = MMPreparationService.evaluatePhase(mockListing, fundedBalances, [], 2500);
    expect(res3.nextPhase).toBe('FUNDING_COMPLETE');

    // 4. Setup window reached (t = 3500) without resting orders
    const res4 = MMPreparationService.evaluatePhase(mockListing, fundedBalances, [], 3500);
    expect(res4.nextPhase).toBe('ORDER_SETUP_OPEN');

    // 5. Setup window with valid quotes
    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing: mockListing,
      mmUserId: 'usr_mm_01',
      targetSpreadBps: 30,
      levelsCount: 5,
      baseVolumePerLevel: 2,
      currentTime: 3500,
    });
    const res5 = MMPreparationService.evaluatePhase(mockListing, fundedBalances, quotes, 3500);
    expect(res5.nextPhase).toBe('READY');

    // 6. Launch time passed without quotes (t = 4500)
    const res6 = MMPreparationService.evaluatePhase(mockListing, fundedBalances, [], 4500);
    expect(res6.nextPhase).toBe('FAILED');
  });

  it('generates pre-launch quotes tagged with isPreLaunch and valid spread', () => {
    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing: mockListing,
      mmUserId: 'usr_mm_01',
      targetSpreadBps: 40,
      levelsCount: 4,
      baseVolumePerLevel: 5,
    });

    expect(quotes.length).toBe(8); // 4 bids + 4 asks
    quotes.forEach((q) => {
      expect(q.isPreLaunch).toBe(true);
      expect(q.isMM).toBe(true);
      expect(q.pair).toBe('MOCK/IDR');
    });

    const bids = quotes.filter((q) => q.side === 'buy');
    const asks = quotes.filter((q) => q.side === 'sell');
    expect(bids[0].price).toBeLessThan(asks[0].price); // No cross
  });

  it('blocks public traders during PREPARATION_ONLY and allows MM', () => {
    const mockPair: MarketPair = {
      id: 'MOCK/IDR',
      baseAsset: 'MOCK',
      quoteAsset: 'IDR',
      name: 'Mock Pair',
      lastPrice: 50000,
      change24h: 0,
      high24h: 50000,
      low24h: 50000,
      volume24h: 0,
      priceDecimals: 0,
      amountDecimals: 2,
      minOrderAmount: 0.1,
      makerFeeBps: 10,
      takerFeeBps: 15,
      isActive: true,
      tradingAccessStatus: 'PREPARATION_ONLY',
    };

    const publicCheck = MMPreparationService.canUserTrade(mockPair, 'usr_trader_01', false);
    expect(publicCheck.allowed).toBe(false);
    expect(publicCheck.reason).toContain('MM Preparation mode');

    const mmCheck = MMPreparationService.canUserTrade(mockPair, 'usr_mm_01', true);
    expect(mmCheck.allowed).toBe(true);
  });

  it('enforces CLOB pre-launch isolation preventing public orders from crossing pre-launch quotes', () => {
    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing: mockListing,
      mmUserId: 'usr_mm_01',
      targetSpreadBps: 40,
      levelsCount: 3,
      baseVolumePerLevel: 5,
      currentTime: 3000,
    });

    const pair: MarketPair = {
      id: 'MOCK/IDR',
      baseAsset: 'MOCK',
      quoteAsset: 'IDR',
      name: 'Mock Pair',
      lastPrice: 50000,
      change24h: 0,
      high24h: 50000,
      low24h: 50000,
      volume24h: 0,
      priceDecimals: 0,
      amountDecimals: 2,
      minOrderAmount: 0.1,
      makerFeeBps: 10,
      takerFeeBps: 15,
      isActive: true,
      tradingAccessStatus: 'PREPARATION_ONLY',
    };

    const balances = {
      usr_trader_01: {
        IDR: { asset: 'IDR', free: 10000000, locked: 0, total: 10000000 },
        MOCK: { asset: 'MOCK', free: 0, locked: 0, total: 0 },
      },
      usr_mm_01: {
        IDR: { asset: 'IDR', free: 10000000, locked: 0, total: 10000000 },
        MOCK: { asset: 'MOCK', free: 50, locked: 0, total: 50 },
      },
    };

    // Public trader attempts to place a buy order during PREPARATION_ONLY
    const publicResult = executeOrderAgainstCLOB(
      'usr_trader_01',
      pair,
      'buy',
      'limit',
      1,
      60000,
      quotes,
      balances
    );

    // Rejected by validation gate
    expect(publicResult.success).toBe(false);
    expect(publicResult.trades).toHaveLength(0);
    expect(publicResult.message).toContain('preparation only');
  });

  it('unlocks pre-launch orders when listing transitions to LIVE', () => {
    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing: mockListing,
      mmUserId: 'usr_mm_01',
      levelsCount: 2,
    });
    expect(quotes[0].isPreLaunch).toBe(true);

    const unlocked = MMPreparationService.unlockPreLaunchOrders(quotes, 'MOCK/IDR');
    expect(unlocked[0].isPreLaunch).toBe(false);
    expect(unlocked[1].isPreLaunch).toBe(false);
  });
});
