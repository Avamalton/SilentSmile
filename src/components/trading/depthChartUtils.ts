import { BookOrder } from '../../simulation/types';
import { safeRound } from '../../utils/formatters';

export type DepthRangePct = 'all' | 1 | 2 | 5 | 10;
export type DepthUnitMode = 'base' | 'quote';

export interface DepthPoint {
  side: 'buy' | 'sell';
  price: number;
  amount: number;        // Quantity at this price level (base asset)
  cumBase: number;       // Cumulative quantity from best price outward (base asset)
  cumQuote: number;      // Cumulative notional value from best price outward (IDR)
  orderCount: number;
  myOrderAmount: number;
  isWall: boolean;
  pctFromMid: number;    // Percentage distance from midPrice (negative for bids, positive for asks)
}

export interface MarketDepthDataset {
  bids: DepthPoint[]; // Sorted ascending by price: [lowestBid ... bestBid]
  asks: DepthPoint[]; // Sorted ascending by price: [bestAsk ... highestAsk]
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  totalBidBase: number;
  totalAskBase: number;
  totalBidQuote: number;
  totalAskQuote: number;
  bidPressurePct: number;
  askPressurePct: number;
  domainMin: number;
  domainMax: number;
  maxCumValue: number;
  visibleBidsCount: number;
  visibleAsksCount: number;
}

/**
 * Builds cumulative market depth curves directly from CLOB resting orders.
 * Cumulative pressure is always summed outward from bestBid / bestAsk BEFORE
 * applying any zoom range filter so zoomed views preserve true cumulative depth.
 */
export function buildMarketDepthDataset(
  restingOrders: BookOrder[],
  pairId: string,
  fallbackLastPrice: number,
  currentUserId?: string,
  rangePct: DepthRangePct = 'all',
  unitMode: DepthUnitMode = 'base',
  amountDecimals: number = 4
): MarketDepthDataset {
  const pairOrders = restingOrders.filter(
    (o) => o.pair === pairId && o.remainingAmount > 0
  );

  const bidsMap = new Map<
    number,
    { amount: number; count: number; myAmount: number; isWall: boolean }
  >();
  const asksMap = new Map<
    number,
    { amount: number; count: number; myAmount: number; isWall: boolean }
  >();

  for (const ord of pairOrders) {
    const map = ord.side === 'buy' ? bidsMap : asksMap;
    const prev = map.get(ord.price) || {
      amount: 0,
      count: 0,
      myAmount: 0,
      isWall: false,
    };
    prev.amount = safeRound(prev.amount + ord.remainingAmount, amountDecimals);
    prev.count += 1;
    if (ord.isWall) prev.isWall = true;
    if (currentUserId && ord.userId === currentUserId) {
      prev.myAmount = safeRound(prev.myAmount + ord.remainingAmount, amountDecimals);
    }
    map.set(ord.price, prev);
  }

  // Sort bids descending (bestBid first) to accumulate outward
  const bidPricesDesc = Array.from(bidsMap.keys()).sort((a, b) => b - a);
  // Sort asks ascending (bestAsk first) to accumulate outward
  const askPricesAsc = Array.from(asksMap.keys()).sort((a, b) => a - b);

  const bestBid = bidPricesDesc[0] || 0;
  const bestAsk = askPricesAsc[0] || 0;
  const midPrice =
    bestBid > 0 && bestAsk > 0
      ? (bestBid + bestAsk) / 2
      : bestBid || bestAsk || fallbackLastPrice || 1;
  const spread = bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
  const spreadPercent = midPrice > 0 ? safeRound((spread / midPrice) * 100, 3) : 0;

  // Accumulate bids from bestBid -> lowestBid
  let cumBidBase = 0;
  let cumBidQuote = 0;
  const bidsDesc: DepthPoint[] = bidPricesDesc.map((price) => {
    const entry = bidsMap.get(price)!;
    cumBidBase = safeRound(cumBidBase + entry.amount, amountDecimals);
    cumBidQuote += price * entry.amount;
    return {
      side: 'buy',
      price,
      amount: entry.amount,
      cumBase: cumBidBase,
      cumQuote: Math.round(cumBidQuote),
      orderCount: entry.count,
      myOrderAmount: entry.myAmount,
      isWall: entry.isWall,
      pctFromMid: midPrice > 0 ? ((price - midPrice) / midPrice) * 100 : 0,
    };
  });

  // Accumulate asks from bestAsk -> highestAsk
  let cumAskBase = 0;
  let cumAskQuote = 0;
  const asksAsc: DepthPoint[] = askPricesAsc.map((price) => {
    const entry = asksMap.get(price)!;
    cumAskBase = safeRound(cumAskBase + entry.amount, amountDecimals);
    cumAskQuote += price * entry.amount;
    return {
      side: 'sell',
      price,
      amount: entry.amount,
      cumBase: cumAskBase,
      cumQuote: Math.round(cumAskQuote),
      orderCount: entry.count,
      myOrderAmount: entry.myAmount,
      isWall: entry.isWall,
      pctFromMid: midPrice > 0 ? ((price - midPrice) / midPrice) * 100 : 0,
    };
  });

  // Reverse bids so X-axis is strictly ascending [lowestBid ... bestBid]
  const allBidsAsc = bidsDesc.reverse();

  const totalBidBase = cumBidBase;
  const totalAskBase = cumAskBase;
  const totalBidQuote = Math.round(cumBidQuote);
  const totalAskQuote = Math.round(cumAskQuote);

  const totalMetricSum =
    unitMode === 'quote'
      ? totalBidQuote + totalAskQuote
      : totalBidBase + totalAskBase;

  const bidPressurePct =
    totalMetricSum > 0
      ? safeRound(
          ((unitMode === 'quote' ? totalBidQuote : totalBidBase) / totalMetricSum) * 100,
          1
        )
      : 50;
  const askPressurePct = totalMetricSum > 0 ? safeRound(100 - bidPressurePct, 1) : 50;

  // Compute X-axis domain
  let domainMin: number;
  let domainMax: number;

  if (rangePct === 'all') {
    const lowestBid = allBidsAsc[0]?.price;
    const highestAsk = asksAsc[asksAsc.length - 1]?.price;

    if (lowestBid !== undefined && highestAsk !== undefined) {
      const leftSpan = Math.max(midPrice - lowestBid, midPrice * 0.002);
      const rightSpan = Math.max(highestAsk - midPrice, midPrice * 0.002);
      const maxSpan = Math.max(leftSpan, rightSpan) * 1.04;
      domainMin = Math.max(0, midPrice - maxSpan);
      domainMax = midPrice + maxSpan;
    } else if (lowestBid !== undefined) {
      const span = Math.max(midPrice - lowestBid, midPrice * 0.01) * 1.08;
      domainMin = Math.max(0, midPrice - span);
      domainMax = midPrice + span;
    } else if (highestAsk !== undefined) {
      const span = Math.max(highestAsk - midPrice, midPrice * 0.01) * 1.08;
      domainMin = Math.max(0, midPrice - span);
      domainMax = midPrice + span;
    } else {
      domainMin = Math.max(0, midPrice * 0.98);
      domainMax = midPrice * 1.02;
    }
  } else {
    const pctFrac = rangePct / 100;
    domainMin = Math.max(0, midPrice * (1 - pctFrac));
    domainMax = midPrice * (1 + pctFrac);
  }

  // Filter visible points (keeping 1 point just outside boundary if available so steps clip seamlessly)
  const visibleBids = allBidsAsc.filter((b) => b.price >= domainMin && b.price <= domainMax);
  const visibleAsks = asksAsc.filter((a) => a.price >= domainMin && a.price <= domainMax);

  const metricOf = (p: DepthPoint) => (unitMode === 'quote' ? p.cumQuote : p.cumBase);

  // Include boundary step outside domainMin for bids & outside domainMax for asks in Y max calculation
  const bidMaxVisible = visibleBids.reduce((m, p) => Math.max(m, metricOf(p)), 0);
  const askMaxVisible = visibleAsks.reduce((m, p) => Math.max(m, metricOf(p)), 0);
  const maxCumValue = Math.max(bidMaxVisible, askMaxVisible, 1e-9);

  return {
    bids: allBidsAsc,
    asks: asksAsc,
    bestBid,
    bestAsk,
    midPrice,
    spread,
    spreadPercent,
    totalBidBase,
    totalAskBase,
    totalBidQuote,
    totalAskQuote,
    bidPressurePct,
    askPressurePct,
    domainMin,
    domainMax,
    maxCumValue,
    visibleBidsCount: visibleBids.length,
    visibleAsksCount: visibleAsks.length,
  };
}

/**
 * Formats compact IDR values for axis ticks & summary metrics (e.g. 1.25M, 420.5K, 2.4B).
 */
export function formatCompactIDR(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Formats compact base quantities for axis ticks.
 */
export function formatCompactQty(value: number, decimals: number = 4): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  if (abs >= 10) return value.toFixed(Math.min(2, decimals));
  return Number(value.toFixed(Math.min(4, decimals))).toString();
}
