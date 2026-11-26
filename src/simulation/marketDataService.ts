import { Candle, TimeFrame, Trade } from './types';
import { safeRound } from '../utils/formatters';

export const TIMEFRAME_SECONDS: Record<TimeFrame, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
};

export const SUPPORTED_TIMEFRAMES: TimeFrame[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

export type CandleListener = (event: {
  pairId: string;
  timeframe: TimeFrame;
  candle: Candle;
  isNewCandle: boolean;
  candles: Candle[];
}) => void;

class MarketDataService {
  // Key: `${pairId}:${timeframe}` -> Candle[]
  private candleStorage = new Map<string, Candle[]>();
  private listeners: Set<CandleListener> = new Set();
  private storageKey = 'silentsmile_candles_v2';

  constructor() {
    this.hydrateFromStorage();
  }

  private getKey(pairId: string, timeframe: TimeFrame): string {
    return `${pairId}:${timeframe}`;
  }

  /**
   * Retrieves OHLCV historical candle sequence for pair & timeframe.
   * If history is empty, generates deterministic bootstrap historical sequence.
   */
  public getCandles(pairId: string, timeframe: TimeFrame, currentPrice?: number): Candle[] {
    const key = this.getKey(pairId, timeframe);
    const existing = this.candleStorage.get(key);

    if (existing && existing.length > 0) {
      return [...existing];
    }

    // Bootstrap deterministic historical sequence if none exists
    const base = currentPrice && currentPrice > 0 ? currentPrice : 14250;
    const bootstrapped = this.generateBootstrapHistory(pairId, base, timeframe, 48);
    this.candleStorage.set(key, bootstrapped);
    this.saveToStorage();
    return [...bootstrapped];
  }

  /**
   * Returns the most recent active candle
   */
  public getLatestCandle(pairId: string, timeframe: TimeFrame): Candle | null {
    const list = this.getCandles(pairId, timeframe);
    return list.length > 0 ? list[list.length - 1] : null;
  }

  /**
   * Ingests a genuine executed trade into all timeframes.
   * Updates the active candle or appends a new candle when the interval rolls over.
   * Earlier candles are permanently preserved.
   */
  public processTrade(trade: Trade): {
    timeframe: TimeFrame;
    candle: Candle;
    isNewCandle: boolean;
  }[] {
    const results: { timeframe: TimeFrame; candle: Candle; isNewCandle: boolean }[] = [];
    const tradeSec = Math.floor(trade.timestamp / 1000);

    for (const tf of SUPPORTED_TIMEFRAMES) {
      const step = TIMEFRAME_SECONDS[tf] || 900;
      const bucketTime = Math.floor(tradeSec / step) * step;
      const key = this.getKey(trade.pair, tf);
      let list = this.candleStorage.get(key);

      if (!list || list.length === 0) {
        list = this.generateBootstrapHistory(trade.pair, trade.price, tf, 48);
        this.candleStorage.set(key, list);
      }

      const lastCandle = list[list.length - 1];
      let isNew = false;
      let activeCandle: Candle;

      if (!lastCandle || bucketTime > lastCandle.time) {
        // Interval rolled over -> Append new candle
        const openPrice = lastCandle ? lastCandle.close : trade.price;
        activeCandle = {
          time: bucketTime,
          open: openPrice,
          high: Math.max(openPrice, trade.price),
          low: Math.min(openPrice, trade.price),
          close: trade.price,
          volume: safeRound(trade.amount, 4),
        };
        list.push(activeCandle);
        isNew = true;
      } else if (bucketTime === lastCandle.time) {
        // Within same interval -> Update existing candle
        lastCandle.high = Math.max(lastCandle.high, trade.price);
        lastCandle.low = Math.min(lastCandle.low, trade.price);
        lastCandle.close = trade.price;
        lastCandle.volume = safeRound(lastCandle.volume + trade.amount, 4);
        activeCandle = lastCandle;
        isNew = false;
      } else {
        // Older timestamp trade (rare in simulator) -> find matching bucket or update close
        const found = list.find((c) => c.time === bucketTime);
        if (found) {
          found.high = Math.max(found.high, trade.price);
          found.low = Math.min(found.low, trade.price);
          found.close = trade.price;
          found.volume = safeRound(found.volume + trade.amount, 4);
          activeCandle = found;
        } else {
          activeCandle = lastCandle;
        }
      }

      // Limit memory retention to 300 candles per timeframe
      if (list.length > 300) {
        list.splice(0, list.length - 300);
      }

      results.push({ timeframe: tf, candle: { ...activeCandle }, isNewCandle: isNew });

      // Notify external chart subscribers
      for (const listener of this.listeners) {
        try {
          listener({
            pairId: trade.pair,
            timeframe: tf,
            candle: { ...activeCandle },
            isNewCandle: isNew,
            candles: [...list],
          });
        } catch (e) {
          console.error('Error in candle listener', e);
        }
      }
    }

    this.saveToStorage();
    return results;
  }

  /**
   * Subscribes to real-time candle updates
   */
  public subscribe(listener: CandleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resets candle history for testing or simulation restart
   */
  public resetHistory(defaultMarkets?: { id: string; lastPrice: number }[]): void {
    this.candleStorage.clear();
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {}

    if (defaultMarkets) {
      for (const m of defaultMarkets) {
        for (const tf of SUPPORTED_TIMEFRAMES) {
          this.getCandles(m.id, tf, m.lastPrice);
        }
      }
    }
  }

  /**
   * Generates continuous ascending bootstrap candles leading up to the current timestamp
   */
  private generateBootstrapHistory(
    pairId: string,
    currentPrice: number,
    timeframe: TimeFrame,
    candleCount: number = 48
  ): Candle[] {
    const step = TIMEFRAME_SECONDS[timeframe] || 900;
    const nowSec = Math.floor(Date.now() / 1000);
    const currentBucket = Math.floor(nowSec / step) * step;
    const startBucket = currentBucket - (candleCount - 1) * step;

    const candles: Candle[] = [];
    const volatilityPct = pairId.includes('BTC') ? 0.003 : pairId.includes('DNA') ? 0.008 : 0.005;
    const startPrice = safeRound(currentPrice * 0.965, 2);
    let prevClose = startPrice;

    for (let i = 0; i < candleCount; i++) {
      const bucketTime = startBucket + i * step;
      const progress = (i + 1) / candleCount;
      const target = startPrice + (currentPrice - startPrice) * progress;
      const wave = Math.sin(i * 0.75) * (currentPrice * volatilityPct);

      const open = prevClose;
      let close = safeRound(target + wave, 2);

      // Final candle closes at currentPrice
      if (i === candleCount - 1) {
        close = currentPrice;
      }

      const high = safeRound(
        Math.max(open, close) + Math.abs(Math.cos(i * 1.3)) * (currentPrice * volatilityPct * 0.7),
        2
      );
      const low = safeRound(
        Math.min(open, close) - Math.abs(Math.sin(i * 1.1)) * (currentPrice * volatilityPct * 0.7),
        2
      );

      const baseVol = pairId.includes('BTC') ? 0.05 : pairId.includes('DNA') ? 1800 : 0.8;
      const volume = safeRound(baseVol * (1 + Math.abs(Math.sin(i * 0.9)) * 2), 4);

      candles.push({
        time: bucketTime,
        open,
        high,
        low,
        close,
        volume,
      });

      prevClose = close;
    }

    return candles;
  }

  private saveToStorage(): void {
    try {
      const raw: Record<string, Candle[]> = {};
      for (const [k, v] of this.candleStorage.entries()) {
        raw[k] = v;
      }
      localStorage.setItem(this.storageKey, JSON.stringify(raw));
    } catch (e) {
      // Ignore quota errors
    }
  }

  private hydrateFromStorage(): void {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v) && v.length > 0) {
              this.candleStorage.set(k, v as Candle[]);
            }
          }
        }
      }
    } catch (e) {}
  }
}

export const marketDataService = new MarketDataService();
