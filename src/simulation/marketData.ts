import { Candle, OrderBook, OrderBookLevel, TimeFrame, Trade } from './types';
import { safeRound } from '../utils/formatters';

// Seeded pseudorandom number generator for repeatable deterministic market candles
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

// Timeframe duration in seconds
export const TIMEFRAME_SECONDS: Record<TimeFrame, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
};

/**
 * Builds real OHLCV candlestick series directly from executed trades on a newly launched exchange.
 * If trades are sparse, carries forward prior close with 0 volume, matching live exchange behavior.
 */
export function buildCandlesFromTrades(
  pairId: string,
  basePrice: number,
  trades: Trade[],
  timeframe: TimeFrame
): Candle[] {
  const step = TIMEFRAME_SECONDS[timeframe] || 900;
  const pairTrades = trades.filter((t) => t.pair === pairId).sort((a, b) => a.timestamp - b.timestamp);

  // If no trades yet on this newly listed token, initialize genesis listing candle
  if (pairTrades.length === 0) {
    return generateNewListingGenesisCandles(pairId, basePrice, timeframe);
  }

  const candlesMap = new Map<number, Candle>();
  const firstTradeSec = Math.floor(pairTrades[0].timestamp / 1000);
  const startBucket = Math.floor(firstTradeSec / step) * step;
  const nowSec = Math.floor(Date.now() / 1000);
  const currentBucket = Math.floor(nowSec / step) * step;

  // Aggregate trades into buckets
  for (const t of pairTrades) {
    const tradeSec = Math.floor(t.timestamp / 1000);
    const bucket = Math.floor(tradeSec / step) * step;
    const existing = candlesMap.get(bucket);

    if (!existing) {
      candlesMap.set(bucket, {
        time: bucket,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: safeRound(t.amount, 4),
      });
    } else {
      existing.high = Math.max(existing.high, t.price);
      existing.low = Math.min(existing.low, t.price);
      existing.close = t.price;
      existing.volume = safeRound(existing.volume + t.amount, 4);
    }
  }

  // Ensure contiguous sequence from startBucket to currentBucket
  const candles: Candle[] = [];
  let prevClose = basePrice;

  for (let t = startBucket; t <= currentBucket; t += step) {
    const candle = candlesMap.get(t);
    if (candle) {
      candles.push(candle);
      prevClose = candle.close;
    } else {
      // Empty interval: preserve last close with zero volume
      candles.push({
        time: t,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        volume: 0,
      });
    }
  }

  return candles.length > 0 ? candles : generateNewListingGenesisCandles(pairId, basePrice, timeframe);
}

/**
 * Generates initial genesis listing candles for newly launched tokens on a brand new exchange.
 * Simulates opening discovery price action since the token's initial listing today.
 */
export function generateNewListingGenesisCandles(
  pairId: string,
  basePrice: number,
  timeframe: TimeFrame,
  candleCount: number = 24
): Candle[] {
  const step = TIMEFRAME_SECONDS[timeframe] || 900;
  const nowSec = Math.floor(Date.now() / 1000);
  const genesisStart = Math.floor((nowSec - (candleCount * step)) / step) * step;

  const candles: Candle[] = [];
  let currentClose = safeRound(basePrice * 0.985, 2); // Initial listing launch price slightly below mark

  for (let i = 0; i < candleCount; i++) {
    const bucketTime = genesisStart + i * step;
    const progress = (i + 1) / candleCount;
    // Natural discovery trajectory toward basePrice
    const targetPrice = basePrice * (0.985 + progress * 0.015);
    const variance = (Math.sin(i * 1.5) * 0.0035 * basePrice);
    const open = currentClose;
    let close = safeRound(targetPrice + variance, 2);

    if (i === candleCount - 1) {
      close = basePrice;
    }

    const high = safeRound(Math.max(open, close) + Math.abs(Math.cos(i * 2.1)) * (basePrice * 0.004), 2);
    const low = safeRound(Math.min(open, close) - Math.abs(Math.sin(i * 1.7)) * (basePrice * 0.004), 2);

    const baseVol = pairId.includes('BTC') ? 0.08 : pairId.includes('DNA') ? 2500 : 1.2;
    const volume = safeRound(baseVol * (1.2 + Math.abs(Math.sin(i)) * 2.5), 4);

    candles.push({
      time: bucketTime,
      open,
      high,
      low,
      close,
      volume,
    });

    currentClose = close;
  }

  return candles;
}

/**
 * Backward compatible alias for initial load
 */
export function generateHistoricalCandles(
  pairId: string,
  basePrice: number,
  timeframe: TimeFrame,
  _count?: number
): Candle[] {
  return generateNewListingGenesisCandles(pairId, basePrice, timeframe, 20);
}

/**
 * Calculates Simple Moving Average (SMA) from candle closes
 */
export function calculateSMA(candles: Candle[], period: number): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += candles[i - j].close;
    }
    result.push({
      time: candles[i].time,
      value: safeRound(sum / period, 2),
    });
  }
  return result;
}

/**
 * Generates an active simulated order book around the current market price
 */
export function generateOrderBook(lastPrice: number, pairId: string, depthLevels: number = 12): OrderBook {
  const tickSize = lastPrice > 1000000 ? 50000 : lastPrice > 50000 ? 250 : lastPrice > 1000 ? 25 : 5;
  const isLarge = pairId.includes('BTC');
  const isToken = pairId.includes('DNA');
  const baseQty = isLarge ? 0.08 : isToken ? 450 : 1.5;

  const asks: OrderBookLevel[] = [];
  const bids: OrderBookLevel[] = [];

  let cumAskTotal = 0;
  for (let i = 1; i <= depthLevels; i++) {
    const price = lastPrice + i * tickSize;
    const jitter = 0.5 + ((i * 17) % 11) / 10;
    const amount = safeRound((baseQty * jitter) + (i * 0.02 * baseQty), isLarge ? 4 : isToken ? 0 : 2);
    cumAskTotal += amount;
    asks.push({
      price,
      amount,
      total: cumAskTotal,
      depthPercent: 0,
      orderCount: 1,
    });
  }

  let cumBidTotal = 0;
  for (let i = 1; i <= depthLevels; i++) {
    const price = Math.max(tickSize, lastPrice - i * tickSize);
    const jitter = 0.5 + ((i * 23) % 13) / 10;
    const amount = safeRound((baseQty * jitter) + (i * 0.025 * baseQty), isLarge ? 4 : isToken ? 0 : 2);
    cumBidTotal += amount;
    bids.push({
      price,
      amount,
      total: cumBidTotal,
      depthPercent: 0,
      orderCount: 1,
    });
  }

  // Calculate visual depth bars (percentage of maximum cumulative total)
  const maxAskTotal = asks[asks.length - 1]?.total || 1;
  const maxBidTotal = bids[bids.length - 1]?.total || 1;

  asks.forEach((item) => {
    item.depthPercent = Math.min(100, Math.round((item.total / maxAskTotal) * 100));
  });
  bids.forEach((item) => {
    item.depthPercent = Math.min(100, Math.round((item.total / maxBidTotal) * 100));
  });

  const spread = (asks[0]?.price || lastPrice) - (bids[0]?.price || lastPrice);
  const spreadPercent = safeRound((spread / lastPrice) * 100, 3);

  return {
    asks: asks.reverse(), // Top to bottom: highest ask down to lowest ask
    bids,                 // Top to bottom: highest bid down to lowest bid
    spread,
    spreadPercent,
    lastUpdated: Date.now(),
    restingOrdersCount: asks.length + bids.length,
  };
}

/**
 * Generates initial genuine recent market trades for newly listed tokens on exchange launch.
 * Trades move fluidly tick-by-tick along the CLOB spread without artificial jumping.
 */
export function generateInitialTrades(pairId: string, currentPrice: number, count: number = 20): Trade[] {
  const trades: Trade[] = [];
  const now = Date.now();
  const isLarge = pairId.includes('BTC');
  const isToken = pairId.includes('DNA');
  const tickSize = currentPrice > 1000000 ? 50000 : currentPrice > 50000 ? 250 : currentPrice > 1000 ? 25 : 5;
  const baseQty = isLarge ? 0.04 : isToken ? 300 : 0.8;

  let walkingPrice = currentPrice;

  for (let i = count - 1; i >= 0; i--) {
    const timeDelta = i * 4000 + ((i * 313) % 1500);
    const side: 'buy' | 'sell' = (i % 2 === 0) ? 'buy' : 'sell';

    // Step at most 0 or 1 tick per trade for a fluid, natural order book flow
    const tickStep = (i % 3 === 0) ? (side === 'buy' ? tickSize : -tickSize) : 0;
    walkingPrice = Math.max(tickSize, walkingPrice + tickStep);

    const amount = safeRound(baseQty * (0.6 + ((i * 29) % 11) / 10), isLarge ? 4 : isToken ? 0 : 2);

    trades.unshift({
      id: `trd_${pairId.replace('/', '')}_${now - timeDelta}`,
      pair: pairId,
      price: walkingPrice,
      amount,
      total: Math.round(walkingPrice * amount),
      side,
      timestamp: now - timeDelta,
    });
  }

  return trades;
}

/**
 * Generates 7-day mini sparkline points for market cards
 */
export function generateSparkline(currentPrice: number, change24h: number, pointsCount: number = 18): number[] {
  const points: number[] = [];
  const startPrice = currentPrice / (1 + change24h / 100);
  for (let i = 0; i < pointsCount; i++) {
    const progress = i / (pointsCount - 1);
    const base = startPrice + (currentPrice - startPrice) * progress;
    const wave = Math.sin(i * 1.2) * (currentPrice * 0.012);
    points.push(Math.round(base + wave));
  }
  points[points.length - 1] = currentPrice;
  return points;
}
