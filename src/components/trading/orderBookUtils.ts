import { BookOrder, MarketPair } from '../../simulation/types';
import { safeRound } from '../../utils/formatters';

export type OrderBookDepthLimit = 5 | 10 | 20 | 50;
export type OrderBookViewMode = 'both' | 'bids' | 'asks';

export const DEPTH_LEVEL_OPTIONS: readonly OrderBookDepthLimit[] = [5, 10, 20, 50] as const;
export const STANDARD_PRICE_AGGREGATION_OPTIONS: readonly number[] = [
  0.00001,
  0.0001,
  0.001,
  0.005,
  0.01,
] as const;

export interface GroupedOrderBookLevel {
  price: number;
  amount: number;
  total: number;
  depthPercent: number;
  orderCount: number;
  myOrderAmount?: number;
  isWall?: boolean;
  isBest: boolean;
}

export interface AggregatedBookSnapshot {
  /** Sorted ascending by price: [bestAsk ... highestVisibleAsk] */
  asks: GroupedOrderBookLevel[];
  /** Sorted descending by price: [bestBid ... lowestVisibleBid] */
  bids: GroupedOrderBookLevel[];
  /** Actual ungrouped best bid across all active resting buy orders (null if none) */
  rawBestBid: number | null;
  /** Actual ungrouped best ask across all active resting sell orders (null if none) */
  rawBestAsk: number | null;
  /** Actual ungrouped mid-price (null if either side has no resting liquidity) */
  midPrice: number | null;
  /** Actual ungrouped absolute spread = rawBestAsk - rawBestBid (null if either side empty) */
  spread: number | null;
  /** Actual ungrouped spread percentage = (spread / midPrice) * 100 (null if either side empty) */
  spreadPercent: number | null;
  /** Cumulative visible bid quantity across displayed levels */
  visibleBidTotal: number;
  /** Cumulative visible ask quantity across displayed levels */
  visibleAskTotal: number;
  /** Visible buy liquidity share (0-100) or null if total visible liquidity is zero */
  bidImbalancePct: number | null;
  /** Visible sell liquidity share (0-100) or null if total visible liquidity is zero */
  askImbalancePct: number | null;
  totalRestingBidLevels: number;
  totalRestingAskLevels: number;
  totalRestingOrdersCount: number;
}

function getDecimalPlaces(num: number): number {
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (Math.floor(num) === num) return 0;
  const str = num.toExponential();
  if (str.includes('e-')) {
    const exp = parseInt(str.split('e-')[1], 10);
    return Math.min(8, Math.max(0, exp));
  }
  const parts = num.toString().split('.');
  return parts[1] ? Math.min(8, parts[1].length) : 0;
}

/**
 * Infers the base native tick size for a market pair.
 */
export function getPairNativeTick(pair: MarketPair, configuredTick?: number): number {
  if (configuredTick && configuredTick > 0) {
    return configuredTick;
  }
  if (pair.priceDecimals > 0) {
    return safeRound(Math.pow(10, -pair.priceDecimals), pair.priceDecimals);
  }
  if (pair.id.includes('BTC')) return 50000;
  if (pair.id.includes('ETH')) return 10000;
  if (pair.id.includes('SOL')) return 1000;
  if (pair.id.includes('USDT')) return 5;
  if (pair.id.includes('DNA')) return 25;
  if (pair.lastPrice >= 100_000_000) return 50000;
  if (pair.lastPrice >= 10_000_000) return 10000;
  if (pair.lastPrice >= 500_000) return 1000;
  if (pair.lastPrice >= 50_000) return 250;
  if (pair.lastPrice >= 1_000) return 25;
  return 1;
}

/**
 * Generates clean, institutional price-grouping interval options adapted
 * strictly to the active trading pair's tick size and price precision.
 */
export function getPriceGroupingOptions(pair: MarketPair, configuredTick?: number): number[] {
  const nativeTick = getPairNativeTick(pair, configuredTick);

  if (pair.priceDecimals >= 2) {
    const minStep = safeRound(Math.pow(10, -pair.priceDecimals), pair.priceDecimals);
    const standardDecimalLadder = [0.00001, 0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1];
    const filtered = standardDecimalLadder.filter((step) => step >= minStep - 1e-12);
    const result = filtered.slice(0, 5);
    if (result.length > 0 && Math.abs(result[0] - minStep) > 1e-12) {
      result.unshift(minStep);
    }
    return Array.from(new Set(result.map((v) => safeRound(v, Math.max(pair.priceDecimals, getDecimalPlaces(v)))))).slice(0, 5);
  }

  if (pair.priceDecimals === 1) {
    return [0.1, 0.5, 1, 5, 10];
  }

  // IDR-quoted integer precision pairs: clean institutional multiples of native tick
  const multipliers = nativeTick % 25 === 0 || nativeTick === 5 ? [1, 2, 4, 10, 20] : [1, 2, 5, 10, 25];
  const steps = multipliers.map((mult) => Math.max(1, Math.round(nativeTick * mult)));
  return Array.from(new Set(steps));
}

/**
 * Returns the full set of selectable price aggregation intervals for the UI dropdown,
 * always including 0.00001, 0.0001, 0.001, 0.005, and 0.01 alongside pair-native tick steps.
 */
export function getAllPriceAggregationOptions(pair: MarketPair, configuredTick?: number): number[] {
  const pairSteps = getPriceGroupingOptions(pair, configuredTick);
  return Array.from(new Set([...STANDARD_PRICE_AGGREGATION_OPTIONS, ...pairSteps])).sort((a, b) => a - b);
}

/**
 * Computes conservative price bucket without modifying underlying resting orders.
 * Bids floor down to bucket boundary; Asks ceil up so grouped sides never cross
 * when rawBestBid < rawBestAsk.
 */
export function snapPriceToGroup(
  price: number,
  side: 'buy' | 'sell',
  groupSize: number,
  precisionDecimals: number
): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(groupSize) || groupSize <= 0) {
    return safeRound(price, precisionDecimals);
  }
  if (groupSize < 1 && Number.isInteger(price)) {
    return safeRound(price, precisionDecimals);
  }

  const eps = 1e-9;
  const ratio = price / groupSize;
  const bucketIndex = side === 'buy' ? Math.floor(ratio + eps) : Math.ceil(ratio - eps);
  const grouped = Math.max(groupSize, bucketIndex * groupSize);
  return safeRound(grouped, precisionDecimals);
}

/**
 * Pure presentation-layer Level-2 aggregator.
 * Aggregates resting orders into price intervals, preserves exact raw spread,
 * sorts asks lowest->highest and bids highest->lowest, accumulates cumulative depth,
 * scales visible depth bars, and computes visible bid/ask imbalance.
 */
export function buildEnhancedOrderBook(params: {
  restingOrders: BookOrder[];
  pair: MarketPair;
  currentUserId?: string;
  groupSize: number;
  depthLimit: OrderBookDepthLimit;
  now?: number;
}): AggregatedBookSnapshot {
  const { restingOrders, pair, currentUserId, groupSize, depthLimit, now = Date.now() } = params;

  const activeOrders = restingOrders.filter(
    (o) =>
      o.pair === pair.id &&
      o.remainingAmount > 0 &&
      o.price > 0 &&
      (!o.expiresAt || o.expiresAt > now)
  );

  // 1. Compute exact raw Best Bid, Best Ask & Spread BEFORE grouping or slicing
  let rawBestBid: number | null = null;
  let rawBestAsk: number | null = null;

  for (const ord of activeOrders) {
    if (ord.side === 'buy') {
      rawBestBid = rawBestBid === null ? ord.price : Math.max(rawBestBid, ord.price);
    } else {
      rawBestAsk = rawBestAsk === null ? ord.price : Math.min(rawBestAsk, ord.price);
    }
  }

  const hasBothSides = rawBestBid !== null && rawBestAsk !== null;
  const midPrice = hasBothSides ? (rawBestBid! + rawBestAsk!) / 2 : null;
  const spread = hasBothSides ? safeRound(rawBestAsk! - rawBestBid!, pair.priceDecimals) : null;
  const spreadPercent =
    hasBothSides && spread !== null && midPrice && midPrice > 0
      ? safeRound((spread / midPrice) * 100, 3)
      : null;

  // 2. Group quantities into selected price buckets
  const effectiveDecimals = Math.max(pair.priceDecimals, getDecimalPlaces(groupSize));
  const bidsMap = new Map<number, { amount: number; count: number; myAmount: number; isWall: boolean }>();
  const asksMap = new Map<number, { amount: number; count: number; myAmount: number; isWall: boolean }>();

  for (const ord of activeOrders) {
    const groupedPrice = snapPriceToGroup(ord.price, ord.side, groupSize, effectiveDecimals);
    const map = ord.side === 'buy' ? bidsMap : asksMap;
    const prev = map.get(groupedPrice) || { amount: 0, count: 0, myAmount: 0, isWall: false };

    prev.amount = safeRound(prev.amount + ord.remainingAmount, pair.amountDecimals);
    prev.count += 1;
    if (ord.isWall) prev.isWall = true;
    if (currentUserId && ord.userId === currentUserId) {
      prev.myAmount = safeRound(prev.myAmount + ord.remainingAmount, pair.amountDecimals);
    }
    map.set(groupedPrice, prev);
  }

  // 3. Sort and slice independently by depthLimit
  // Asks: lowest ask (bestAsk) -> highest ask
  const allAskPricesAsc = Array.from(asksMap.keys()).sort((a, b) => a - b);
  const visibleAskPrices = allAskPricesAsc.slice(0, depthLimit);

  // Bids: highest bid (bestBid) -> lowest bid
  const allBidPricesDesc = Array.from(bidsMap.keys()).sort((a, b) => b - a);
  const visibleBidPrices = allBidPricesDesc.slice(0, depthLimit);

  // 4. Accumulate cumulative quantities independently from best price outward
  let cumAsk = 0;
  const asks: GroupedOrderBookLevel[] = visibleAskPrices.map((price, idx) => {
    const data = asksMap.get(price)!;
    cumAsk = safeRound(cumAsk + data.amount, pair.amountDecimals);
    return {
      price,
      amount: data.amount,
      total: cumAsk,
      depthPercent: 0,
      orderCount: data.count,
      myOrderAmount: data.myAmount > 0 ? data.myAmount : undefined,
      isWall: data.isWall,
      isBest: idx === 0,
    };
  });

  let cumBid = 0;
  const bids: GroupedOrderBookLevel[] = visibleBidPrices.map((price, idx) => {
    const data = bidsMap.get(price)!;
    cumBid = safeRound(cumBid + data.amount, pair.amountDecimals);
    return {
      price,
      amount: data.amount,
      total: cumBid,
      depthPercent: 0,
      orderCount: data.count,
      myOrderAmount: data.myAmount > 0 ? data.myAmount : undefined,
      isWall: data.isWall,
      isBest: idx === 0,
    };
  });

  // 5. Scale horizontal depth bars dynamically based on visible cumulative depth
  const visibleAskTotal = asks.length > 0 ? asks[asks.length - 1].total : 0;
  const visibleBidTotal = bids.length > 0 ? bids[bids.length - 1].total : 0;

  if (visibleAskTotal > 0) {
    for (const row of asks) {
      row.depthPercent = Math.min(100, safeRound((row.total / visibleAskTotal) * 100, 2));
    }
  }
  if (visibleBidTotal > 0) {
    for (const row of bids) {
      row.depthPercent = Math.min(100, safeRound((row.total / visibleBidTotal) * 100, 2));
    }
  }

  // 6. Compute Bid / Ask Imbalance from visible aggregated depth
  const totalVisible = visibleBidTotal + visibleAskTotal;
  const bidImbalancePct =
    totalVisible > 0 ? safeRound((visibleBidTotal / totalVisible) * 100, 1) : null;
  const askImbalancePct =
    bidImbalancePct !== null ? safeRound(100 - bidImbalancePct, 1) : null;

  return {
    asks,
    bids,
    rawBestBid,
    rawBestAsk,
    midPrice,
    spread,
    spreadPercent,
    visibleBidTotal,
    visibleAskTotal,
    bidImbalancePct,
    askImbalancePct,
    totalRestingBidLevels: allBidPricesDesc.length,
    totalRestingAskLevels: allAskPricesAsc.length,
    totalRestingOrdersCount: activeOrders.length,
  };
}

/**
 * Formats prices cleanly for the Order Book respecting pair precision and grouping steps.
 */
export function formatOrderBookPrice(
  price: number,
  pair: Pick<MarketPair, 'priceDecimals' | 'quoteAsset'>,
  groupSize?: number
): string {
  if (!Number.isFinite(price)) return '—';
  const hasFraction = Math.abs(price - Math.round(price)) > 1e-9;
  const decimals =
    pair.priceDecimals > 0
      ? Math.max(pair.priceDecimals, groupSize ? getDecimalPlaces(groupSize) : 0)
      : hasFraction && groupSize
      ? getDecimalPlaces(groupSize)
      : 0;

  if (decimals === 0) {
    const formatted = new Intl.NumberFormat('id-ID', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(Math.round(price));
    return pair.quoteAsset === 'IDR' ? `Rp ${formatted}` : formatted;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
  return pair.quoteAsset === 'IDR' ? `Rp ${formatted}` : formatted;
}

/**
 * Formats compact grouping labels for the tick selector dropdown.
 */
export function formatGroupingStepLabel(
  step: number,
  pair: Pick<MarketPair, 'priceDecimals' | 'quoteAsset'>
): string {
  const stepDecimals = getDecimalPlaces(step);
  if (step < 1) {
    const decimals = Math.max(pair.priceDecimals, stepDecimals);
    return step.toFixed(decimals);
  }
  const decimals = Math.max(pair.priceDecimals, stepDecimals);
  if (decimals > 0) {
    return step.toFixed(decimals);
  }
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0,
  }).format(step);
}
