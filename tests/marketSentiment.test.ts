import { describe, it, expect } from 'vitest';
import { BookOrder, MarketPair } from '../src/simulation/types';
import { computeMarketSentiment } from '../src/components/trading/marketSentimentUtils';

function makeOrder(
  id: string,
  side: 'buy' | 'sell',
  price: number,
  remainingAmount: number,
  opts: Partial<BookOrder> = {}
): BookOrder {
  return {
    id,
    userId: 'usr_mm_01',
    pair: opts.pair || 'DNA/IDR',
    side,
    price,
    amount: remainingAmount,
    remainingAmount,
    createdAt: Date.now(),
    expiresAt: opts.expiresAt,
  };
}

const dnaPair: MarketPair = {
  id: 'DNA/IDR',
  baseAsset: 'DNA',
  quoteAsset: 'IDR',
  name: 'Denata Network / Rupiah',
  lastPrice: 14250,
  change24h: 2.5,
  high24h: 14500,
  low24h: 14000,
  volume24h: 100000000,
  priceDecimals: 0,
  amountDecimals: 2,
  minOrderAmount: 1,
  makerFeeBps: 10,
  takerFeeBps: 15,
  isActive: true,
};

describe('Market Sentiment Order Book Depth Indicator', () => {
  it('detects Strongly Bullish / Bullish sentiment when bid depth dominates resting liquidity', () => {
    const orders: BookOrder[] = [
      makeOrder('b1', 'buy', 14200, 300),
      makeOrder('b2', 'buy', 14175, 200),
      makeOrder('a1', 'sell', 14300, 100),
    ];

    const res = computeMarketSentiment({
      restingOrders: orders,
      pair: dnaPair,
      configuredTick: 25,
      depthLimit: 20,
    });

    expect(res.bullishPct).not.toBeNull();
    expect(res.bearishPct).not.toBeNull();
    expect(res.bullishPct! + res.bearishPct!).toBeCloseTo(100, 1);
    expect(res.bullishPct!).toBeGreaterThan(80);
    expect(res.bias).toBe('Strongly Bullish');
    expect(res.bidLevelsAnalyzed).toBe(2);
    expect(res.askLevelsAnalyzed).toBe(1);
  });

  it('detects Strongly Bearish / Bearish sentiment when ask depth dominates resting liquidity', () => {
    const orders: BookOrder[] = [
      makeOrder('b1', 'buy', 14200, 100),
      makeOrder('a1', 'sell', 14300, 200),
      makeOrder('a2', 'sell', 14325, 250),
    ];

    const res = computeMarketSentiment({
      restingOrders: orders,
      pair: dnaPair,
      configuredTick: 25,
      depthLimit: 20,
    });

    expect(res.bearishPct!).toBeGreaterThan(80);
    expect(res.bullishPct! + res.bearishPct!).toBeCloseTo(100, 1);
    expect(res.bias).toBe('Strongly Bearish');
  });

  it('reports Neutral when bid and ask depth notional are closely balanced', () => {
    const orders: BookOrder[] = [
      makeOrder('b1', 'buy', 14200, 100),
      makeOrder('a1', 'sell', 14300, 100),
    ];

    const res = computeMarketSentiment({
      restingOrders: orders,
      pair: dnaPair,
      configuredTick: 25,
      depthLimit: 20,
    });

    expect(res.bias).toBe('Neutral');
    expect(res.bullishPct!).toBeGreaterThan(47);
    expect(res.bullishPct!).toBeLessThan(53);
  });

  it('respects depthLimit window, isolates active pair, and ignores expired orders', () => {
    const now = Date.now();
    const orders: BookOrder[] = [];
    // 15 bid levels; deep huge bid on level 15 should be excluded when depthLimit=10
    for (let i = 0; i < 14; i++) {
      orders.push(makeOrder(`b_${i}`, 'buy', 14200 - i * 25, 10));
    }
    orders.push(makeOrder('b_deep_whale', 'buy', 13000, 10000));
    orders.push(makeOrder('b_expired', 'buy', 14225, 99999, { expiresAt: now - 5000 }));
    orders.push(makeOrder('b_other_pair', 'buy', 900000000, 50, { pair: 'BTC/IDR' }));

    for (let i = 0; i < 10; i++) {
      orders.push(makeOrder(`a_${i}`, 'sell', 14300 + i * 25, 20));
    }

    const top10 = computeMarketSentiment({
      restingOrders: orders,
      pair: dnaPair,
      configuredTick: 25,
      depthLimit: 10,
      now,
    });
    expect(top10.bidLevelsAnalyzed).toBe(10);
    expect(top10.askLevelsAnalyzed).toBe(10);
    expect(top10.bias).toBe('Strongly Bearish');

    const top20 = computeMarketSentiment({
      restingOrders: orders,
      pair: dnaPair,
      configuredTick: 25,
      depthLimit: 20,
      now,
    });
    expect(top20.bidLevelsAnalyzed).toBe(15);
    expect(top20.bias).toBe('Strongly Bullish');
  });

  it('returns Unavailable safely when order book has no resting liquidity', () => {
    const res = computeMarketSentiment({
      restingOrders: [],
      pair: dnaPair,
      depthLimit: 20,
    });

    expect(res.bias).toBe('Unavailable');
    expect(res.bullishPct).toBeNull();
    expect(res.bearishPct).toBeNull();
  });
});
