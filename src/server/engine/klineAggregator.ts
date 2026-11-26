import { formatFromIntegerUnits } from '../ledger/integerMath';

export interface CandleBar {
  time: number;            // Unix timestamp in seconds
  open: number;            // Atomic quote integer units
  high: number;            // Atomic quote integer units
  low: number;             // Atomic quote integer units
  close: number;           // Atomic quote integer units
  volume: number;          // Atomic base integer units (backwards-compatible numeric summary)
  quoteVolume: number;     // Atomic quote integer units
  volumeAtomic: bigint;    // Exact BigInt base units
  quoteVolumeAtomic: bigint; // Exact BigInt quote units
  count: number;           // Number of executed trades in this bar
}

export interface FormattedCandleBar {
  time: number;            // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  openStr: string;
  highStr: string;
  lowStr: string;
  closeStr: string;
  volumeStr: string;
  quoteVolumeStr: string;
  count: number;
}

export type KlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const KLINE_INTERVALS: KlineInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export const INTERVAL_SECONDS: Record<KlineInterval, number> = {
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
};

export interface CandleQueryOptions {
  fromSec?: number;
  toSec?: number;
  countBack?: number;
  limit?: number;
}

export interface RawTradeRow {
  id?: string;
  pair_id: string;
  price: number;
  amount: number;
  total: number;
  timestamp: number;
}

export class KlineAggregator {
  // Map of `${pairId}:${interval}` -> Map<bucketSec, CandleBar>
  private candles: Map<string, Map<number, CandleBar>> = new Map();
  // Deduplication set for trade IDs so duplicate WS/replay events never double-count OHLCV
  private processedTradeIds: Set<string> = new Set();
  private static readonly MAX_TRACKED_TRADE_IDS = 50000;

  constructor() {}

  public static isValidInterval(val: string): val is KlineInterval {
    return (KLINE_INTERVALS as string[]).includes(val);
  }

  public static getBucketSec(timestampMs: number, interval: KlineInterval): number {
    const stepSec = INTERVAL_SECONDS[interval];
    const tsSec = Math.floor(timestampMs / 1000);
    return Math.floor(tsSec / stepSec) * stepSec;
  }

  public static formatBar(bar: CandleBar, basePrecision: number, quotePrecision: number): FormattedCandleBar {
    const openStr = formatFromIntegerUnits(bar.open, quotePrecision);
    const highStr = formatFromIntegerUnits(bar.high, quotePrecision);
    const lowStr = formatFromIntegerUnits(bar.low, quotePrecision);
    const closeStr = formatFromIntegerUnits(bar.close, quotePrecision);
    const volumeStr = formatFromIntegerUnits(bar.volumeAtomic, basePrecision);
    const quoteVolumeStr = formatFromIntegerUnits(bar.quoteVolumeAtomic, quotePrecision);

    return {
      time: bar.time,
      open: Number(openStr),
      high: Number(highStr),
      low: Number(lowStr),
      close: Number(closeStr),
      volume: Number(volumeStr),
      quoteVolume: Number(quoteVolumeStr),
      openStr,
      highStr,
      lowStr,
      closeStr,
      volumeStr,
      quoteVolumeStr,
      count: bar.count,
    };
  }

  /**
   * Pure aggregation over a sorted/unsorted list of executed trade rows using integer/BigInt math.
   * Used for deterministic historical pagination directly from SQLite trades.
   */
  public static aggregateTradeRows(
    trades: RawTradeRow[],
    interval: KlineInterval,
    basePrecision: number,
    quotePrecision: number
  ): FormattedCandleBar[] {
    if (!trades || trades.length === 0) return [];

    const buckets = new Map<number, CandleBar>();
    const seen = new Set<string>();
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (const t of sorted) {
      if (t.id) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
      }

      const priceInt = Math.trunc(Number(t.price));
      const amountInt = Math.trunc(Number(t.amount));
      const totalInt = Math.trunc(Number(t.total));
      if (!Number.isFinite(priceInt) || priceInt <= 0 || amountInt < 0) continue;

      const bucketSec = KlineAggregator.getBucketSec(t.timestamp, interval);
      const existing = buckets.get(bucketSec);

      if (!existing) {
        const volBig = BigInt(amountInt);
        const quoteVolBig = BigInt(Math.max(0, totalInt));
        buckets.set(bucketSec, {
          time: bucketSec,
          open: priceInt,
          high: priceInt,
          low: priceInt,
          close: priceInt,
          volume: Number(volBig),
          quoteVolume: Number(quoteVolBig),
          volumeAtomic: volBig,
          quoteVolumeAtomic: quoteVolBig,
          count: 1,
        });
      } else {
        if (priceInt > existing.high) existing.high = priceInt;
        if (priceInt < existing.low) existing.low = priceInt;
        existing.close = priceInt;
        existing.volumeAtomic += BigInt(amountInt);
        existing.quoteVolumeAtomic += BigInt(Math.max(0, totalInt));
        existing.volume = Number(existing.volumeAtomic);
        existing.quoteVolume = Number(existing.quoteVolumeAtomic);
        existing.count += 1;
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.time - b.time)
      .map((bar) => KlineAggregator.formatBar(bar, basePrecision, quotePrecision));
  }

  /**
   * Records a genuine executed trade across all supported intervals using integer & BigInt arithmetic.
   * Returns updated CandleBar per interval, or null if tradeId was already processed (duplicate protection).
   */
  public recordTrade(
    pairId: string,
    price: number,
    amount: number,
    total: number,
    timestampMs: number = Date.now(),
    tradeId?: string
  ): Record<KlineInterval, CandleBar> | null {
    if (tradeId) {
      const dedupeKey = `${pairId}:${tradeId}`;
      if (this.processedTradeIds.has(dedupeKey)) {
        return null;
      }
      if (this.processedTradeIds.size >= KlineAggregator.MAX_TRACKED_TRADE_IDS) {
        const firstKey = this.processedTradeIds.values().next().value;
        if (firstKey) this.processedTradeIds.delete(firstKey);
      }
      this.processedTradeIds.add(dedupeKey);
    }

    const priceInt = Math.trunc(Number(price));
    const amountBig = BigInt(Math.max(0, Math.trunc(Number(amount))));
    const totalBig = BigInt(Math.max(0, Math.trunc(Number(total))));

    const updated: Partial<Record<KlineInterval, CandleBar>> = {};

    for (const interval of KLINE_INTERVALS) {
      const bucketSec = KlineAggregator.getBucketSec(timestampMs, interval);
      const key = `${pairId}:${interval}`;

      let pairMap = this.candles.get(key);
      if (!pairMap) {
        pairMap = new Map();
        this.candles.set(key, pairMap);
      }

      let existing = pairMap.get(bucketSec);
      if (!existing) {
        existing = {
          time: bucketSec,
          open: priceInt,
          high: priceInt,
          low: priceInt,
          close: priceInt,
          volume: Number(amountBig),
          quoteVolume: Number(totalBig),
          volumeAtomic: amountBig,
          quoteVolumeAtomic: totalBig,
          count: 1,
        };
        pairMap.set(bucketSec, existing);
      } else {
        if (priceInt > existing.high) existing.high = priceInt;
        if (priceInt < existing.low) existing.low = priceInt;
        existing.close = priceInt;
        existing.volumeAtomic += amountBig;
        existing.quoteVolumeAtomic += totalBig;
        existing.volume = Number(existing.volumeAtomic);
        existing.quoteVolume = Number(existing.quoteVolumeAtomic);
        existing.count += 1;
      }

      updated[interval] = { ...existing };
    }

    return updated as Record<KlineInterval, CandleBar>;
  }

  public getCandles(pairId: string, interval: KlineInterval = '1m', limit: number = 300): CandleBar[] {
    const key = `${pairId}:${interval}`;
    const pairMap = this.candles.get(key);
    if (!pairMap) return [];

    const sorted = Array.from(pairMap.values()).sort((a, b) => a.time - b.time);
    return sorted.slice(-Math.max(1, limit));
  }

  public getCandlesRange(
    pairId: string,
    interval: KlineInterval = '1m',
    options: CandleQueryOptions = {}
  ): CandleBar[] {
    const key = `${pairId}:${interval}`;
    const pairMap = this.candles.get(key);
    if (!pairMap) return [];

    let bars = Array.from(pairMap.values()).sort((a, b) => a.time - b.time);

    if (options.fromSec !== undefined && Number.isFinite(options.fromSec)) {
      bars = bars.filter((b) => b.time >= options.fromSec!);
    }
    if (options.toSec !== undefined && Number.isFinite(options.toSec)) {
      bars = bars.filter((b) => b.time <= options.toSec!);
    }

    const cap = options.countBack ?? options.limit ?? 300;
    if (cap > 0 && bars.length > cap) {
      bars = bars.slice(-cap);
    }
    return bars;
  }

  /**
   * Seed historical candles from database trades on boot (sorted chronologically).
   */
  public seedFromTrades(trades: RawTradeRow[]): void {
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    for (const t of sorted) {
      this.recordTrade(t.pair_id, t.price, t.amount, t.total, t.timestamp, t.id);
    }
  }
}
