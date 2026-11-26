import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { BookOrder } from '../src/simulation/types';
import {
  buildMarketDepthDataset,
  formatCompactIDR,
  formatCompactQty,
} from '../src/components/trading/depthChartUtils';

function makeOrder(
  id: string,
  side: 'buy' | 'sell',
  price: number,
  remainingAmount: number,
  opts: Partial<BookOrder> = {}
): BookOrder {
  return {
    id,
    userId: opts.userId || 'usr_mm_01',
    pair: opts.pair || 'BTC/IDR',
    side,
    price,
    amount: remainingAmount,
    remainingAmount,
    createdAt: Date.now(),
    isWall: opts.isWall,
    isMM: opts.isMM,
  };
}

describe('Market Depth Chart Dataset & D3 Curve Integrity', () => {
  it('accumulates bids outward from bestBid and asks outward from bestAsk in ascending price order', () => {
    const orders: BookOrder[] = [
      // Bids at 990M (bestBid), 980M (2 orders merged), 950M (wall)
      makeOrder('b1', 'buy', 990_000_000, 1.5),
      makeOrder('b2', 'buy', 980_000_000, 2.0, { userId: 'usr_trader_1' }),
      makeOrder('b3', 'buy', 980_000_000, 0.5),
      makeOrder('b4', 'buy', 950_000_000, 5.0, { isWall: true }),
      // Asks at 1010M (bestAsk), 1020M, 1050M
      makeOrder('a1', 'sell', 1_010_000_000, 1.0),
      makeOrder('a2', 'sell', 1_020_000_000, 3.0),
      makeOrder('a3', 'sell', 1_050_000_000, 4.0, { isWall: true }),
      // Other pair & filled orders must be excluded
      makeOrder('other', 'buy', 20_000_000, 100, { pair: 'ETH/IDR' }),
      makeOrder('filled', 'buy', 995_000_000, 0),
    ];

    const dataset = buildMarketDepthDataset(
      orders,
      'BTC/IDR',
      1_000_000_000,
      'usr_trader_1',
      'all',
      'base',
      4
    );

    expect(dataset.bestBid).toBe(990_000_000);
    expect(dataset.bestAsk).toBe(1_010_000_000);
    expect(dataset.midPrice).toBe(1_000_000_000);
    expect(dataset.spread).toBe(20_000_000);
    expect(dataset.spreadPercent).toBe(2);

    // Bids must be ordered ascending by price [950M, 980M, 990M]
    expect(dataset.bids.map((b) => b.price)).toEqual([950_000_000, 980_000_000, 990_000_000]);
    // Cumulative bids from bestBid outward: 1.5 at 990M -> 4.0 at 980M -> 9.0 at 950M
    expect(dataset.bids.map((b) => b.cumBase)).toEqual([9.0, 4.0, 1.5]);
    expect(dataset.bids[0].isWall).toBe(true);
    expect(dataset.bids[1].orderCount).toBe(2);
    expect(dataset.bids[1].myOrderAmount).toBe(2.0);

    // Asks must be ordered ascending by price [1010M, 1020M, 1050M]
    expect(dataset.asks.map((a) => a.price)).toEqual([1_010_000_000, 1_020_000_000, 1_050_000_000]);
    expect(dataset.asks.map((a) => a.cumBase)).toEqual([1.0, 4.0, 8.0]);
    expect(dataset.asks[2].isWall).toBe(true);

    // Bid/Ask pressure split (9 vs 8)
    expect(dataset.totalBidBase).toBe(9.0);
    expect(dataset.totalAskBase).toBe(8.0);
    expect(dataset.bidPressurePct).toBeCloseTo(52.9, 1);
    expect(dataset.askPressurePct).toBeCloseTo(47.1, 1);
  });

  it('preserves full cumulative totals and scales Y max to visible levels when zoomed to ±2%', () => {
    const orders: BookOrder[] = [
      makeOrder('b1', 'buy', 990, 2),
      makeOrder('b2', 'buy', 900, 50), // outside ±2% of 1000
      makeOrder('a1', 'sell', 1010, 3),
      makeOrder('a2', 'sell', 1100, 80), // outside ±2% of 1000
    ];

    const zoomed = buildMarketDepthDataset(orders, 'BTC/IDR', 1000, undefined, 2, 'base', 4);

    expect(zoomed.domainMin).toBeCloseTo(980, 6);
    expect(zoomed.domainMax).toBeCloseTo(1020, 6);
    expect(zoomed.visibleBidsCount).toBe(1);
    expect(zoomed.visibleAsksCount).toBe(1);
    // Only 990 (cum 2) and 1010 (cum 3) are inside ±2%, so maxCumValue = 3
    expect(zoomed.maxCumValue).toBe(3);
    // Total book liquidity remains complete
    expect(zoomed.totalBidBase).toBe(52);
    expect(zoomed.totalAskBase).toBe(83);
  });

  it('computes IDR notional cumulative quote depth accurately', () => {
    const orders: BookOrder[] = [
      makeOrder('b1', 'buy', 1_000_000, 2, { pair: 'ETH/IDR' }),
      makeOrder('b2', 'buy', 900_000, 5, { pair: 'ETH/IDR' }),
      makeOrder('a1', 'sell', 1_100_000, 1, { pair: 'ETH/IDR' }),
    ];

    const quoteDataset = buildMarketDepthDataset(
      orders,
      'ETH/IDR',
      1_050_000,
      undefined,
      'all',
      'quote',
      4
    );

    expect(quoteDataset.totalBidQuote).toBe(2_000_000 + 4_500_000);
    expect(quoteDataset.totalAskQuote).toBe(1_100_000);
    expect(quoteDataset.maxCumValue).toBe(6_500_000);
  });

  it('generates valid non-empty SVG path strings with D3 step curves', () => {
    const xScale = d3.scaleLinear().domain([90, 110]).range([0, 400]);
    const yScale = d3.scaleLinear().domain([0, 20]).range([200, 0]);

    const bidArea = d3
      .area<{ price: number; val: number }>()
      .x((d) => xScale(d.price))
      .y0(200)
      .y1((d) => yScale(d.val))
      .curve(d3.curveStepBefore);

    const askArea = d3
      .area<{ price: number; val: number }>()
      .x((d) => xScale(d.price))
      .y0(200)
      .y1((d) => yScale(d.val))
      .curve(d3.curveStepAfter);

    const bidPath = bidArea([
      { price: 90, val: 10 },
      { price: 95, val: 6 },
      { price: 99, val: 2 },
      { price: 99, val: 0 },
    ]);
    const askPath = askArea([
      { price: 101, val: 0 },
      { price: 101, val: 3 },
      { price: 105, val: 8 },
      { price: 110, val: 8 },
    ]);

    expect(bidPath).toBeTruthy();
    expect(askPath).toBeTruthy();
    expect(bidPath).toContain('M');
    expect(askPath).toContain('M');
  });

  it('handles empty order books gracefully and formats compact numbers', () => {
    const empty = buildMarketDepthDataset([], 'BTC/IDR', 1_500_000_000);
    expect(empty.bids).toHaveLength(0);
    expect(empty.asks).toHaveLength(0);
    expect(empty.midPrice).toBe(1_500_000_000);
    expect(empty.bidPressurePct).toBe(50);
    expect(empty.askPressurePct).toBe(50);

    expect(formatCompactIDR(2_500_000_000)).toBe('2.50B');
    expect(formatCompactIDR(15_250_000)).toBe('15.25M');
    expect(formatCompactIDR(42_500)).toBe('42.5K');
    expect(formatCompactQty(1250, 4)).toBe('1.25K');
  });
});
