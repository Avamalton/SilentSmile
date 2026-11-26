import { ExternalTicker, AggregatedReferencePrice, FxRateConfig } from '../../simulation/mmConsoleTypes';
import { BinanceWsHandler } from './binanceWsHandler';
import { BybitWsHandler } from './bybitWsHandler';

export type AggregatedPriceCallback = (price: AggregatedReferencePrice) => void;
export type ClearedAggregatesCallback = (event: { symbols: string[]; provider?: string; timestamp: number }) => void;

export interface PriceAggregatorOptions {
  staleThresholdMs?: number;
}

export class PriceAggregatorWorker {
  private binanceHandler: BinanceWsHandler;
  private bybitHandler: BybitWsHandler;

  private latestBinance: Map<string, ExternalTicker> = new Map();
  private latestBybit: Map<string, ExternalTicker> = new Map();
  private aggregatedCache: Map<string, AggregatedReferencePrice> = new Map();

  private listeners: Set<AggregatedPriceCallback> = new Set();
  private clearedListeners: Set<ClearedAggregatesCallback> = new Set();

  private fxRate: FxRateConfig = {
    source: 'BANK_INDONESIA',
    usdtIdrRate: 16250,
    lastUpdated: Date.now(),
    expiresAt: Date.now() + 86400000,
    updatedBy: 'system',
    isStale: false,
  };

  private aggregationInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private readonly staleThresholdMs: number;
  private clearedAggregatesCount: number = 0;
  private lastClearedAt: number | null = null;

  constructor(
    binanceHandler?: BinanceWsHandler,
    bybitHandler?: BybitWsHandler,
    options?: PriceAggregatorOptions
  ) {
    this.binanceHandler = binanceHandler || new BinanceWsHandler();
    this.bybitHandler = bybitHandler || new BybitWsHandler();
    this.staleThresholdMs = Math.max(100, options?.staleThresholdMs ?? 5000);

    this.binanceHandler.onTicker((ticker) => {
      this.latestBinance.set(ticker.symbol, ticker);
      this.recalculateSymbol(ticker.symbol);
    });

    this.bybitHandler.onTicker((ticker) => {
      this.latestBybit.set(ticker.symbol, ticker);
      this.recalculateSymbol(ticker.symbol);
    });

    this.binanceHandler.onSevered?.(() => {
      this.clearStaleAggregatesForProvider('binance', Date.now());
    });

    this.bybitHandler.onSevered?.(() => {
      this.clearStaleAggregatesForProvider('bybit', Date.now());
    });
  }

  public onPriceUpdate(cb: AggregatedPriceCallback) {
    this.listeners.add(cb);
  }

  public removePriceListener(cb: AggregatedPriceCallback) {
    this.listeners.delete(cb);
  }

  public onAggregatesCleared(cb: ClearedAggregatesCallback) {
    this.clearedListeners.add(cb);
  }

  public removeAggregatesClearedListener(cb: ClearedAggregatesCallback) {
    this.clearedListeners.delete(cb);
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.binanceHandler.start();
    this.bybitHandler.start();

    // Regular interval to evaluate connection severance, clear stale aggregates, and publish continuous stream
    this.aggregationInterval = setInterval(() => {
      this.recalculateAll();
    }, 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    this.binanceHandler.stop();
    this.bybitHandler.stop();
  }

  public setFxRate(newRate: number, source: FxRateConfig['source'] = 'MANUAL_ADMIN', updatedBy: string = 'admin') {
    this.fxRate = {
      source,
      usdtIdrRate: newRate,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 86400000,
      updatedBy,
      isStale: false,
    };
    this.recalculateAll();
  }

  public getFxRate(): FxRateConfig {
    const isStale = Date.now() > this.fxRate.expiresAt;
    return { ...this.fxRate, isStale };
  }

  public getAggregatedPrice(symbol: string): AggregatedReferencePrice | undefined {
    const cleanSym = symbol.toUpperCase().replace(/[-_/]/g, '');
    return this.aggregatedCache.get(cleanSym);
  }

  public getAllAggregatedPrices(): AggregatedReferencePrice[] {
    return Array.from(this.aggregatedCache.values());
  }

  public getFeedHealth() {
    return {
      binance: this.binanceHandler.getStatus(),
      bybit: this.bybitHandler.getStatus(),
      activeSymbolsCount: this.aggregatedCache.size,
      fxRate: this.getFxRate(),
      staleThresholdMs: this.staleThresholdMs,
      clearedAggregatesCount: this.clearedAggregatesCount,
      lastClearedAt: this.lastClearedAt,
    };
  }

  /**
   * Clears all cached price ticks and recomputes/purges stale aggregated entries
   * for a provider whose WebSocket connection has been severed beyond the threshold.
   */
  public clearStaleAggregatesForProvider(provider: 'binance' | 'bybit', now: number = Date.now()): number {
    const tickerMap = provider === 'binance' ? this.latestBinance : this.latestBybit;
    const affectedSymbols = new Set<string>(tickerMap.keys());

    for (const [sym, agg] of this.aggregatedCache.entries()) {
      if (agg.primaryProvider === provider || agg.secondaryProvider === provider) {
        affectedSymbols.add(sym);
      }
    }

    if (affectedSymbols.size === 0) return 0;

    tickerMap.clear();
    const clearedSymbols: string[] = [];

    for (const sym of affectedSymbols) {
      const existed = this.aggregatedCache.has(sym);
      this.recalculateSymbol(sym, now);
      if (existed && !this.aggregatedCache.has(sym)) {
        clearedSymbols.push(sym);
      }
    }

    if (clearedSymbols.length > 0) {
      this.clearedAggregatesCount += clearedSymbols.length;
      this.lastClearedAt = now;
      for (const cb of this.clearedListeners) {
        try {
          cb({ symbols: clearedSymbols, provider, timestamp: now });
        } catch {}
      }
    }

    return clearedSymbols.length;
  }

  /**
   * Evaluates provider WebSocket health and clears stale price aggregates whenever
   * a connection remains severed (non-OPEN) for more than maxAgeMs (default 5000ms).
   */
  public clearStaleAggregates(maxAgeMs: number = this.staleThresholdMs, now: number = Date.now()): number {
    this.binanceHandler.evaluateConnectionHealth?.(now);
    this.bybitHandler.evaluateConnectionHealth?.(now);

    const binanceStatus = this.binanceHandler.getStatus();
    const bybitStatus = this.bybitHandler.getStatus();

    let totalCleared = 0;

    if (binanceStatus.isSeveredTooLong || binanceStatus.severedDurationMs > maxAgeMs) {
      totalCleared += this.clearStaleAggregatesForProvider('binance', now);
    }

    if (bybitStatus.isSeveredTooLong || bybitStatus.severedDurationMs > maxAgeMs) {
      totalCleared += this.clearStaleAggregatesForProvider('bybit', now);
    }

    // Also purge any lingering tickers whose age > maxAgeMs while their provider socket is not CONNECTED
    const affected = new Set<string>();
    if (binanceStatus.status !== 'CONNECTED') {
      for (const [sym, ticker] of this.latestBinance.entries()) {
        if (now - ticker.timestamp > maxAgeMs) {
          this.latestBinance.delete(sym);
          affected.add(sym);
        }
      }
    }
    if (bybitStatus.status !== 'CONNECTED') {
      for (const [sym, ticker] of this.latestBybit.entries()) {
        if (now - ticker.timestamp > maxAgeMs) {
          this.latestBybit.delete(sym);
          affected.add(sym);
        }
      }
    }

    // Sweep external entries directly from aggregatedCache if still older than maxAgeMs with no live feed
    for (const [sym, agg] of this.aggregatedCache.entries()) {
      if (agg.primaryProvider === 'internal') continue;
      if (!this.latestBinance.has(sym) && !this.latestBybit.has(sym) && now - agg.lastUpdated > maxAgeMs) {
        affected.add(sym);
      }
    }

    const extraCleared: string[] = [];
    for (const sym of affected) {
      const existed = this.aggregatedCache.has(sym);
      this.recalculateSymbol(sym, now);
      if (existed && !this.aggregatedCache.has(sym)) {
        extraCleared.push(sym);
      }
    }

    if (extraCleared.length > 0) {
      totalCleared += extraCleared.length;
      this.clearedAggregatesCount += extraCleared.length;
      this.lastClearedAt = now;
      for (const cb of this.clearedListeners) {
        try {
          cb({ symbols: extraCleared, timestamp: now });
        } catch {}
      }
    }

    return totalCleared;
  }

  private recalculateSymbol(symbol: string, now: number = Date.now()) {
    const cleanSym = symbol.toUpperCase().replace(/[-_/]/g, '');
    const binance = this.latestBinance.get(cleanSym);
    const bybit = this.latestBybit.get(cleanSym);

    if (!binance && !bybit) {
      this.aggregatedCache.delete(cleanSym);
      return;
    }

    let agg: AggregatedReferencePrice;

    if (binance && !bybit) {
      const isStale = now - binance.timestamp > 15000;
      agg = {
        symbol: cleanSym,
        primaryPrice: binance.lastPrice,
        finalPrice: binance.lastPrice,
        bidPrice: binance.bidPrice,
        askPrice: binance.askPrice,
        spreadBps: Math.round(((binance.askPrice - binance.bidPrice) / binance.lastPrice) * 10000),
        primaryProvider: 'binance',
        confidenceScore: isStale ? 35 : 80,
        status: isStale ? 'STALE' : 'FRESH',
        lastUpdated: binance.timestamp,
        rejectionReason: isStale ? 'Binance feed data age exceeded 15s threshold' : undefined,
        sourceCount: 1,
      };
    } else if (!binance && bybit) {
      const isStale = now - bybit.timestamp > 15000;
      agg = {
        symbol: cleanSym,
        primaryPrice: bybit.lastPrice,
        finalPrice: bybit.lastPrice,
        bidPrice: bybit.bidPrice,
        askPrice: bybit.askPrice,
        spreadBps: Math.round(((bybit.askPrice - bybit.bidPrice) / bybit.lastPrice) * 10000),
        primaryProvider: 'bybit',
        confidenceScore: isStale ? 35 : 80,
        status: isStale ? 'STALE' : 'FRESH',
        lastUpdated: bybit.timestamp,
        rejectionReason: isStale ? 'Bybit feed data age exceeded 15s threshold' : undefined,
        sourceCount: 1,
      };
    } else {
      // Both providers active
      const p1 = binance!.lastPrice;
      const p2 = bybit!.lastPrice;
      const avg = (p1 + p2) / 2;
      const deviationBps = Math.abs((p1 - p2) / avg) * 10000;
      const maxAge = Math.max(now - binance!.timestamp, now - bybit!.timestamp);

      if (maxAge > 20000) {
        agg = {
          symbol: cleanSym,
          primaryPrice: p1,
          secondaryPrice: p2,
          finalPrice: avg,
          bidPrice: Math.min(binance!.bidPrice, bybit!.bidPrice),
          askPrice: Math.max(binance!.askPrice, bybit!.askPrice),
          spreadBps: Math.round(deviationBps),
          primaryProvider: 'binance',
          secondaryProvider: 'bybit',
          confidenceScore: 30,
          status: 'STALE',
          lastUpdated: Math.max(binance!.timestamp, bybit!.timestamp),
          rejectionReason: 'Exceeded maximum allowable data age (>20s)',
          sourceCount: 2,
        };
      } else if (deviationBps > 250) {
        // Outlier deviation (> 2.5%)
        agg = {
          symbol: cleanSym,
          primaryPrice: p1,
          secondaryPrice: p2,
          finalPrice: p1, // Default conservative
          bidPrice: binance!.bidPrice,
          askPrice: binance!.askPrice,
          spreadBps: Math.round(deviationBps),
          primaryProvider: 'binance',
          secondaryProvider: 'bybit',
          confidenceScore: 50,
          status: 'DISPUTED',
          lastUpdated: Math.max(binance!.timestamp, bybit!.timestamp),
          rejectionReason: `Excessive deviation between Binance and Bybit: ${deviationBps.toFixed(1)} bps`,
          sourceCount: 2,
        };
      } else {
        // High confidence weighted average (Binance 60%, Bybit 40%)
        const rawFinal = p1 * 0.6 + p2 * 0.4;
        const factor = rawFinal < 10 ? 10000 : 100;
        const finalPrice = Math.round(rawFinal * factor) / factor;
        const bidPrice = Math.round((binance!.bidPrice * 0.6 + bybit!.bidPrice * 0.4) * factor) / factor;
        const askPrice = Math.round((binance!.askPrice * 0.6 + bybit!.askPrice * 0.4) * factor) / factor;

        agg = {
          symbol: cleanSym,
          primaryPrice: p1,
          secondaryPrice: p2,
          finalPrice,
          bidPrice,
          askPrice,
          spreadBps: Math.round(((askPrice - bidPrice) / finalPrice) * 10000),
          primaryProvider: 'binance',
          secondaryProvider: 'bybit',
          confidenceScore: 98,
          status: 'FRESH',
          lastUpdated: Math.max(binance!.timestamp, bybit!.timestamp),
          sourceCount: 2,
        };
      }
    }

    this.aggregatedCache.set(cleanSym, agg);

    for (const listener of this.listeners) {
      try {
        listener(agg);
      } catch {}
    }
  }

  private recalculateAll() {
    const now = Date.now();
    this.clearStaleAggregates(this.staleThresholdMs, now);

    const symbols = new Set([
      ...Array.from(this.latestBinance.keys()),
      ...Array.from(this.latestBybit.keys()),
    ]);
    for (const sym of symbols) {
      this.recalculateSymbol(sym, now);
    }

    // Keep USDTIDR reference price synced to FX rate
    const rate = this.fxRate.usdtIdrRate || 16250;
    const usdtIdrAgg: AggregatedReferencePrice = {
      symbol: 'USDTIDR',
      primaryPrice: rate,
      secondaryPrice: rate - 2,
      finalPrice: rate,
      bidPrice: rate - 5,
      askPrice: rate + 5,
      spreadBps: 6,
      primaryProvider: 'internal',
      confidenceScore: 99,
      status: this.getFxRate().isStale ? 'STALE' : 'FRESH',
      lastUpdated: now,
      sourceCount: 1,
    };
    this.aggregatedCache.set('USDTIDR', usdtIdrAgg);
    for (const listener of this.listeners) {
      try {
        listener(usdtIdrAgg);
      } catch {}
    }
  }
}
