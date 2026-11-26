import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FULL_MM_CONFIGS,
  validateFullMMConfig,
  generateInstitutionalMMQuotes,
} from '../src/simulation/mmStrategyEngine';
import { FullMMConfig, MarketPair } from '../src/simulation/types';

const mockPair: MarketPair = {
  id: 'DNA/IDR',
  baseAsset: 'DNA',
  quoteAsset: 'IDR',
  name: 'DNA / Rupiah',
  lastPrice: 14250,
  change24h: 3.2,
  high24h: 15000,
  low24h: 13500,
  volume24h: 500000000,
  priceDecimals: 0,
  amountDecimals: 2,
  minOrderAmount: 1,
  makerFeeBps: 10,
  takerFeeBps: 15,
  isActive: true,
};

describe('Market Maker Strategy Engine', () => {
  it('validates configuration and catches out-of-bounds parameters', () => {
    const validConfig = DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
    const validResult = validateFullMMConfig(validConfig);
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors.length).toBe(0);

    const invalidConfig: FullMMConfig = {
      ...validConfig,
      cs_price_decimal: 15, // Out of bounds
      cs_total_budget_idr: -5000, // Negative budget
      cs_walk_max_levels: 50, // Exceeds max 30
    };

    const invalidResult = validateFullMMConfig(invalidConfig);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('generates two-sided passive ladder when enabled', () => {
    const config = DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
    const quotes = generateInstitutionalMMQuotes(mockPair, config, []);

    expect(quotes.length).toBeGreaterThan(0);
    const bids = quotes.filter((q) => q.side === 'buy');
    const asks = quotes.filter((q) => q.side === 'sell');

    expect(bids.length).toBeGreaterThan(0);
    expect(asks.length).toBeGreaterThan(0);

    // Highest bid must be strictly less than lowest ask (passive spread maintained)
    const highestBid = Math.max(...bids.map((b) => b.price));
    const lowestAsk = Math.min(...asks.map((a) => a.price));
    expect(highestBid).toBeLessThan(lowestAsk);
  });

  it('respects Emergency Stop and produces zero orders', () => {
    const config: FullMMConfig = {
      ...DEFAULT_FULL_MM_CONFIGS['DNA/IDR'],
      emergency_stop: true,
    };

    const quotes = generateInstitutionalMMQuotes(mockPair, config, []);
    expect(quotes.length).toBe(0);
  });

  it('respects Halted / Inactive market and produces zero orders', () => {
    const haltedPair: MarketPair = { ...mockPair, isActive: false };
    const config = DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];

    const quotes = generateInstitutionalMMQuotes(haltedPair, config, []);
    expect(quotes.length).toBe(0);
  });

  it('adjusts ladder according to Directional Skew (Up vs Down)', () => {
    const upConfig: FullMMConfig = {
      ...DEFAULT_FULL_MM_CONFIGS['DNA/IDR'],
      cs_direction: 'Up',
    };
    const downConfig: FullMMConfig = {
      ...DEFAULT_FULL_MM_CONFIGS['DNA/IDR'],
      cs_direction: 'Down',
    };

    const upQuotes = generateInstitutionalMMQuotes(mockPair, upConfig, []);
    const downQuotes = generateInstitutionalMMQuotes(mockPair, downConfig, []);

    const upBids = upQuotes.filter((q) => q.side === 'buy');
    const downBids = downQuotes.filter((q) => q.side === 'buy');

    // Total buy volume in 'Up' stance should be greater than 'Down' stance (support building)
    const upBidVol = upBids.reduce((sum, b) => sum + b.amount, 0);
    const downBidVol = downBids.reduce((sum, b) => sum + b.amount, 0);

    expect(upBidVol).toBeGreaterThan(downBidVol);
  });
});
