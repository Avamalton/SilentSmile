import { describe, it, expect } from 'vitest';
import { BookOrder, MarketPair } from '../src/simulation/types';
import { buildMMOrders } from '../src/simulation/clobEngine';
import {
  buildEnhancedOrderBook,
  formatGroupingStepLabel,
  formatOrderBookPrice,
  getPriceGroupingOptions,
  snapPriceToGroup,
} from '../src/components/trading/orderBookUtils';

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
    pair: opts.pair || 'DNA/IDR',
    side,
    price,
    amount: remainingAmount,
    remainingAmount,
    createdAt: Date.now(),
    isWall: opts.isWall,
    isMM: opts.isMM,
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

const decimalPair: MarketPair = {
  id: 'TOKEN/USD',
  baseAsset: 'TOKEN',
  quoteAsset: 'USD',
  name: 'Decimal Test Pair',
  lastPrice: 100.04,
  change24h: 1.2,
  high24h: 101,
  low24h: 99,
  volume24h: 500000,
  priceDecimals: 5,
  amountDecimals: 2,
  minOrderAmount: 1,
  makerFeeBps: 10,
  takerFeeBps: 15,
  isActive: true,
};

describe('Professional Order Book & Market Depth Enhancement', () => {
  it('sorts asks ascending from bestAsk and bids descending from bestBid with exact cumulative totals', () => {
    const orders: BookOrder[] = [
      // Prompt illustrative ask levels: 100.05 (120), 100.06 (250), 100.07 (180)
      makeOrder('a3', 'sell', 100.07, 180, { pair: 'TOKEN/USD' }),
      makeOrder('a1', 'sell', 100.05, 120, { pair: 'TOKEN/USD' }),
      makeOrder('a2', 'sell', 100.06, 250, { pair: 'TOKEN/USD' }),
      // Bid levels: 100.03 (100), 100.02 (150), 100.01 (200)
      makeOrder('b3', 'buy', 100.01, 200, { pair: 'TOKEN/USD' }),
      makeOrder('b1', 'buy', 100.03, 100, { pair: 'TOKEN/USD' }),
      makeOrder('b2', 'buy', 100.02, 150, { pair: 'TOKEN/USD' }),
    ];

    const snapshot = buildEnhancedOrderBook({
      restingOrders: orders,
      pair: decimalPair,
      groupSize: 0.01,
      depthLimit: 10,
    });

    expect(snapshot.asks.map((a) => a.price)).toEqual([100.05, 100.06, 100.07]);
    expect(snapshot.asks.map((a) => a.total)).toEqual([120, 370, 550]);
    expect(snapshot.asks[0].isBest).toBe(true);
    expect(snapshot.asks[1].isBest).toBe(false);

    expect(snapshot.bids.map((b) => b.price)).toEqual([100.03, 100.02, 100.01]);
    expect(snapshot.bids.map((b) => b.total)).toEqual([100, 250, 450]);
    expect(snapshot.bids[0].isBest).toBe(true);
    expect(snapshot.bids[1].isBest).toBe(false);

    // Depth bars scale dynamically up to 100% on visible deepest row
    expect(snapshot.asks[2].depthPercent).toBe(100);
    expect(snapshot.bids[2].depthPercent).toBe(100);
    expect(snapshot.asks[0].depthPercent).toBeCloseTo((120 / 550) * 100, 1);

    // Visible imbalance: Bid 450 vs Ask 550 -> 45.0% Bid / 55.0% Ask
    expect(snapshot.visibleBidTotal).toBe(450);
    expect(snapshot.visibleAskTotal).toBe(550);
    expect(snapshot.bidImbalancePct).toBe(45);
    expect(snapshot.askImbalancePct).toBe(55);
  });

  it('groups orders cleanly into selected intervals without floating-point drift or modifying underlying orders', () => {
    const rawOrders: BookOrder[] = [
      makeOrder('b1', 'buy', 14230, 100),
      makeOrder('b2', 'buy', 14210, 200),
      makeOrder('b3', 'buy', 14180, 50),
      makeOrder('a1', 'sell', 14270, 120),
      makeOrder('a2', 'sell', 14295, 80),
      makeOrder('a3', 'sell', 14340, 300),
    ];
    const originalPrices = rawOrders.map((o) => o.price);

    const grouped = buildEnhancedOrderBook({
      restingOrders: rawOrders,
      pair: dnaPair,
      groupSize: 100,
      depthLimit: 10,
    });

    // Underlying resting order prices remain completely untouched
    expect(rawOrders.map((o) => o.price)).toEqual(originalPrices);

    // Bids floor to 100s: 14230 & 14210 -> 14200 (300); 14180 -> 14100 (50)
    expect(grouped.bids.map((b) => [b.price, b.amount, b.total])).toEqual([
      [14200, 300, 300],
      [14100, 50, 350],
    ]);

    // Asks ceil to 100s: 14270 & 14295 -> 14300 (200); 14340 -> 14400 (300)
    expect(grouped.asks.map((a) => [a.price, a.amount, a.total])).toEqual([
      [14300, 200, 200],
      [14400, 300, 500],
    ]);

    // Exact spread MUST still use actual raw best bid (14230) and raw best ask (14270) = 40
    expect(grouped.rawBestBid).toBe(14230);
    expect(grouped.rawBestAsk).toBe(14270);
    expect(grouped.spread).toBe(40);

    // Floating-point decimal bucketing safety (e.g., 0.0003 at step 0.0001)
    expect(snapPriceToGroup(0.0003, 'buy', 0.0001, 5)).toBe(0.0003);
    expect(snapPriceToGroup(0.0003, 'sell', 0.0001, 5)).toBe(0.0003);
    expect(snapPriceToGroup(0.0054, 'buy', 0.005, 5)).toBe(0.005);
    expect(snapPriceToGroup(0.0054, 'sell', 0.005, 5)).toBe(0.01);
  });

  it('applies depth level limits (5, 10, 20, 50) independently without faking missing liquidity', () => {
    const orders: BookOrder[] = [];
    for (let i = 1; i <= 30; i++) {
      orders.push(makeOrder(`b_${i}`, 'buy', 14200 - i * 25, 10));
    }
    for (let i = 1; i <= 12; i++) {
      orders.push(makeOrder(`a_${i}`, 'sell', 14300 + i * 25, 10));
    }

    const depth5 = buildEnhancedOrderBook({
      restingOrders: orders,
      pair: dnaPair,
      groupSize: 25,
      depthLimit: 5,
    });
    expect(depth5.bids).toHaveLength(5);
    expect(depth5.asks).toHaveLength(5);
    expect(depth5.visibleBidTotal).toBe(50);
    expect(depth5.visibleAskTotal).toBe(50);

    const depth50 = buildEnhancedOrderBook({
      restingOrders: orders,
      pair: dnaPair,
      groupSize: 25,
      depthLimit: 50,
    });
    // Must show exact available levels (30 bids, 12 asks) and NEVER fabricate fake rows
    expect(depth50.bids).toHaveLength(30);
    expect(depth50.asks).toHaveLength(12);
    expect(depth50.visibleBidTotal).toBe(300);
    expect(depth50.visibleAskTotal).toBe(120);
  });

  it('handles one-sided and completely empty order books safely for spread and imbalance', () => {
    const empty = buildEnhancedOrderBook({
      restingOrders: [],
      pair: dnaPair,
      groupSize: 25,
      depthLimit: 10,
    });
    expect(empty.rawBestBid).toBeNull();
    expect(empty.rawBestAsk).toBeNull();
    expect(empty.spread).toBeNull();
    expect(empty.spreadPercent).toBeNull();
    expect(empty.bidImbalancePct).toBeNull();
    expect(empty.askImbalancePct).toBeNull();

    const bidsOnly = buildEnhancedOrderBook({
      restingOrders: [makeOrder('b1', 'buy', 14200, 100)],
      pair: dnaPair,
      groupSize: 25,
      depthLimit: 10,
    });
    expect(bidsOnly.rawBestBid).toBe(14200);
    expect(bidsOnly.rawBestAsk).toBeNull();
    expect(bidsOnly.spread).toBeNull();
    expect(bidsOnly.spreadPercent).toBeNull();
    expect(bidsOnly.bidImbalancePct).toBe(100);
    expect(bidsOnly.askImbalancePct).toBe(0);
  });

  it('adapts price grouping options to pair tick size & precision and formats cleanly', () => {
    expect(getPriceGroupingOptions(decimalPair)).toEqual([0.00001, 0.0001, 0.001, 0.005, 0.01]);
    expect(getPriceGroupingOptions(dnaPair, 25)).toEqual([25, 50, 100, 250, 500]);

    const btcPair: MarketPair = { ...dnaPair, id: 'BTC/IDR', lastPrice: 1485600000 };
    expect(getPriceGroupingOptions(btcPair, 50000)).toEqual([50000, 100000, 200000, 500000, 1000000]);

    expect(formatOrderBookPrice(14250, dnaPair)).toContain('14.250');
    expect(formatOrderBookPrice(100.05, decimalPair, 0.01)).toBe('100.05000');
    expect(formatGroupingStepLabel(0.0001, decimalPair)).toBe('0.00010');
  });

  it('supports generating 50 levels per side cleanly in buildMMOrders without crossing', () => {
    const quotes = buildMMOrders(dnaPair, 14250, {
      targetSpreadBps: 30,
      levelsPerSide: 50,
      baseAmountPerLevel: 500,
      tickSize: 25,
      buy_min_price_limit: 11000,
      buy_max_price_limit: 14200,
      sell_min_price_limit: 14300,
      sell_max_price_limit: 18000,
    });

    const bids = quotes.filter((q) => q.side === 'buy');
    const asks = quotes.filter((q) => q.side === 'sell');
    expect(bids).toHaveLength(50);
    expect(asks).toHaveLength(50);
    expect(Math.max(...bids.map((b) => b.price))).toBeLessThan(Math.min(...asks.map((a) => a.price)));
  });

  it('always includes 0.00001, 0.0001, 0.001, 0.005, and 0.01 aggregation intervals and recalculates cumulative depth without mutating raw orders', async () => {
    const utils = await import('../src/components/trading/orderBookUtils');
    expect(utils.STANDARD_PRICE_AGGREGATION_OPTIONS).toEqual([0.00001, 0.0001, 0.001, 0.005, 0.01]);

    const dnaOptions = utils.getAllPriceAggregationOptions(dnaPair, 25);
    const decOptions = utils.getAllPriceAggregationOptions(decimalPair);

    for (const step of [0.00001, 0.0001, 0.001, 0.005, 0.01]) {
      expect(dnaOptions).toContain(step);
      expect(decOptions).toContain(step);
    }

    const rawDecimalOrders: BookOrder[] = [
      makeOrder('db1', 'buy', 1.00021, 50, { pair: 'TOKEN/USD' }),
      makeOrder('db2', 'buy', 1.00029, 75, { pair: 'TOKEN/USD' }),
      makeOrder('db3', 'buy', 0.99941, 100, { pair: 'TOKEN/USD' }),
      makeOrder('da1', 'sell', 1.00112, 40, { pair: 'TOKEN/USD' }),
      makeOrder('da2', 'sell', 1.0049, 60, { pair: 'TOKEN/USD' }),
    ];
    const snapshotBefore = rawDecimalOrders.map((o) => ({ price: o.price, remainingAmount: o.remainingAmount }));

    const grouped001 = buildEnhancedOrderBook({
      restingOrders: rawDecimalOrders,
      pair: decimalPair,
      groupSize: 0.001,
      depthLimit: 10,
    });
    expect(grouped001.bids.map((b) => [b.price, b.amount, b.total])).toEqual([
      [1.0, 125, 125],
      [0.999, 100, 225],
    ]);
    expect(grouped001.asks.map((a) => [a.price, a.amount, a.total])).toEqual([
      [1.002, 40, 40],
      [1.005, 60, 100],
    ]);

    const grouped005 = buildEnhancedOrderBook({
      restingOrders: rawDecimalOrders,
      pair: decimalPair,
      groupSize: 0.005,
      depthLimit: 10,
    });
    expect(grouped005.bids.map((b) => [b.price, b.amount, b.total])).toEqual([
      [1.0, 125, 125],
      [0.995, 100, 225],
    ]);
    expect(grouped005.asks.map((a) => [a.price, a.amount, a.total])).toEqual([[1.005, 100, 100]]);

    // Ensure original orders were never mutated across re-aggregations
    expect(rawDecimalOrders.map((o) => ({ price: o.price, remainingAmount: o.remainingAmount }))).toEqual(
      snapshotBefore
    );
  });
});
