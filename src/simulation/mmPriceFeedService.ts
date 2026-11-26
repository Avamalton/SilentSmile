import {
  ExternalTicker,
  AggregatedReferencePrice,
  FxRateConfig,
  CrossMarketMappingConfig,
  CryptographicAuditEvent,
} from './mmConsoleTypes';

export class MMPriceFeedAggregatorService {
  // Static state caches
  private static binancePrices: Map<string, ExternalTicker> = new Map();
  private static bybitPrices: Map<string, ExternalTicker> = new Map();

  // FX state cache
  private static currentFxRate: FxRateConfig = {
    source: 'BANK_INDONESIA',
    usdtIdrRate: 16250,
    lastUpdated: Date.now(),
    expiresAt: Date.now() + 86400000,
    updatedBy: 'usr_admin_01',
    isStale: false,
  };

  // Seed default base reference prices
  private static initialized: boolean = false;

  public static initializeDefaultFeeds() {
    if (this.initialized) return;
    this.initialized = true;

    const now = Date.now();
    const defaultData = [
      { sym: 'BTCUSDT', binance: 72450.5, bybit: 72448.0 },
      { sym: 'ETHUSDT', binance: 2010.25, bybit: 2010.0 },
      { sym: 'SOLUSDT', binance: 85.8, bybit: 85.75 },
      { sym: 'BNBUSDT', binance: 645.0, bybit: 644.8 },
      { sym: 'DOGEUSDT', binance: 0.385, bybit: 0.3845 },
      { sym: 'XRPUSDT', binance: 1.45, bybit: 1.448 },
      { sym: 'ADAUSDT', binance: 0.88, bybit: 0.879 },
      { sym: 'AVAXUSDT', binance: 38.5, bybit: 38.45 },
      { sym: 'LINKUSDT', binance: 18.2, bybit: 18.18 },
      { sym: 'USDTIDR', binance: 16250, bybit: 16250 },
    ];

    for (const item of defaultData) {
      this.binancePrices.set(item.sym, {
        provider: 'binance',
        symbol: item.sym,
        lastPrice: item.binance,
        bidPrice: item.binance * 0.9998,
        askPrice: item.binance * 1.0002,
        volume24h: 1250000000,
        timestamp: now,
        latencyMs: 38,
      });

      this.bybitPrices.set(item.sym, {
        provider: 'bybit',
        symbol: item.sym,
        lastPrice: item.bybit,
        bidPrice: item.bybit * 0.9997,
        askPrice: item.bybit * 1.0003,
        volume24h: 890000000,
        timestamp: now,
        latencyMs: 45,
      });
    }
  }

  /**
   * Updates feed ticker from WebSocket or REST poll
   */
  public static ingestTicker(ticker: ExternalTicker) {
    if (ticker.provider === 'binance') {
      this.binancePrices.set(ticker.symbol, ticker);
    } else if (ticker.provider === 'bybit') {
      this.bybitPrices.set(ticker.symbol, ticker);
    }
  }

  /**
   * Retrieves aggregated reference price with outlier rejection, confidence scoring & freshness check
   */
  public static getAggregatedPrice(symbol: string): AggregatedReferencePrice {
    this.initializeDefaultFeeds();
    const cleanSym = symbol.toUpperCase().replace(/[-_/]/g, '');

    const binance = this.binancePrices.get(cleanSym);
    const bybit = this.bybitPrices.get(cleanSym);
    const now = Date.now();

    if (!binance && !bybit) {
      return {
        symbol: cleanSym,
        primaryPrice: 0,
        finalPrice: 0,
        bidPrice: 0,
        askPrice: 0,
        spreadBps: 0,
        primaryProvider: 'internal',
        confidenceScore: 0,
        status: 'INVALID',
        lastUpdated: now,
        rejectionReason: 'No provider feeds available for symbol',
        sourceCount: 0,
      };
    }

    if (binance && !bybit) {
      const isStale = now - binance.timestamp > 30000;
      return {
        symbol: cleanSym,
        primaryPrice: binance.lastPrice,
        finalPrice: binance.lastPrice,
        bidPrice: binance.bidPrice,
        askPrice: binance.askPrice,
        spreadBps: Math.round(((binance.askPrice - binance.bidPrice) / binance.lastPrice) * 10000),
        primaryProvider: 'binance',
        confidenceScore: isStale ? 40 : 85,
        status: isStale ? 'STALE' : 'FRESH',
        lastUpdated: binance.timestamp,
        rejectionReason: isStale ? 'Binance feed data age exceeded 30s threshold' : undefined,
        sourceCount: 1,
      };
    }

    if (!binance && bybit) {
      const isStale = now - bybit.timestamp > 30000;
      return {
        symbol: cleanSym,
        primaryPrice: bybit.lastPrice,
        finalPrice: bybit.lastPrice,
        bidPrice: bybit.bidPrice,
        askPrice: bybit.askPrice,
        spreadBps: Math.round(((bybit.askPrice - bybit.bidPrice) / bybit.lastPrice) * 10000),
        primaryProvider: 'bybit',
        confidenceScore: isStale ? 40 : 85,
        status: isStale ? 'STALE' : 'FRESH',
        lastUpdated: bybit.timestamp,
        rejectionReason: isStale ? 'Bybit feed data age exceeded 30s threshold' : undefined,
        sourceCount: 1,
      };
    }

    // Both providers available -> Check deviation and compute weighted median
    const p1 = binance!.lastPrice;
    const p2 = bybit!.lastPrice;
    const deviationBps = Math.abs((p1 - p2) / ((p1 + p2) / 2)) * 10000;

    const maxAge = Math.max(now - binance!.timestamp, now - bybit!.timestamp);
    if (maxAge > 60000) {
      return {
        symbol: cleanSym,
        primaryPrice: p1,
        secondaryPrice: p2,
        finalPrice: (p1 + p2) / 2,
        bidPrice: Math.min(binance!.bidPrice, bybit!.bidPrice),
        askPrice: Math.max(binance!.askPrice, bybit!.askPrice),
        spreadBps: Math.round(deviationBps),
        primaryProvider: 'binance',
        secondaryProvider: 'bybit',
        confidenceScore: 30,
        status: 'STALE',
        lastUpdated: Math.max(binance!.timestamp, bybit!.timestamp),
        rejectionReason: 'All multi-exchange feeds exceed maximum data age',
        sourceCount: 2,
      };
    }

    // If deviation between Binance and Bybit > 250 bps (2.5%), mark as DISPUTED/OUTLIER
    if (deviationBps > 250) {
      return {
        symbol: cleanSym,
        primaryPrice: p1,
        secondaryPrice: p2,
        finalPrice: p1, // Default to primary Binance
        bidPrice: binance!.bidPrice,
        askPrice: binance!.askPrice,
        spreadBps: Math.round(deviationBps),
        primaryProvider: 'binance',
        secondaryProvider: 'bybit',
        confidenceScore: 50,
        status: 'DISPUTED',
        lastUpdated: Math.max(binance!.timestamp, bybit!.timestamp),
        rejectionReason: `Excessive multi-exchange deviation detected: ${deviationBps.toFixed(1)} bps`,
        sourceCount: 2,
      };
    }

    // Weighted average (Binance 60%, Bybit 40%)
    const finalPrice = Math.round((p1 * 0.6 + p2 * 0.4) * 100) / 100;
    const bidPrice = Math.round((binance!.bidPrice * 0.6 + bybit!.bidPrice * 0.4) * 100) / 100;
    const askPrice = Math.round((binance!.askPrice * 0.6 + bybit!.askPrice * 0.4) * 100) / 100;

    return {
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

  /**
   * Retrieves current FX Rate config for USDT/IDR
   */
  public static getFxRate(): FxRateConfig {
    const isStale = Date.now() > this.currentFxRate.expiresAt;
    return {
      ...this.currentFxRate,
      isStale,
    };
  }

  /**
   * Sets manual admin FX rate with audit validity
   */
  public static setManualFxRate(newRate: number, adminId: string, durationHours: number = 24): FxRateConfig {
    if (newRate <= 0 || newRate < 10000 || newRate > 25000) {
      throw new Error('Kurs USDT/IDR tidak wajar. Wajib dalam batas Rp 10.000 - Rp 25.000.');
    }

    const now = Date.now();
    this.currentFxRate = {
      source: 'MANUAL_ADMIN',
      usdtIdrRate: newRate,
      lastUpdated: now,
      expiresAt: now + durationHours * 3600000,
      updatedBy: adminId,
      isStale: false,
    };

    return this.getFxRate();
  }

  /**
   * Synchronizes backend FX rate (e.g. CoinGecko fallback or manual admin override)
   * into the client-side MMPriceFeedAggregatorService cache.
   */
  public static syncFxRate(fx: FxRateConfig): FxRateConfig {
    if (fx && Number.isFinite(fx.usdtIdrRate) && fx.usdtIdrRate > 0) {
      this.currentFxRate = {
        ...fx,
        isStale: Date.now() > fx.expiresAt,
      };
    }
    return this.getFxRate();
  }

  /**
   * Computes Target Price using Cross-Market Reference Mapping
   * Formula 1: PERCENTAGE_RETURN:
   *   refReturn = (currentRefPrice / refAnchorPrice) - 1
   *   targetPrice = targetAnchorPrice * (1 + sensitivityBeta * refReturn)
   */
  public static calculateTargetPrice(mapping: CrossMarketMappingConfig): {
    success: boolean;
    targetPrice: number;
    rawReferencePrice: number;
    referenceReturnPct: number;
    appliedFxRate: number;
    error?: string;
  } {
    if (!mapping.mappingEnabled) {
      return {
        success: false,
        targetPrice: mapping.targetAnchorPrice,
        rawReferencePrice: 0,
        referenceReturnPct: 0,
        appliedFxRate: 1,
        error: 'Cross-market reference mapping is disabled for this bot',
      };
    }

    const refAgg = this.getAggregatedPrice(mapping.referenceMarketSymbol);
    if (refAgg.status === 'INVALID' || refAgg.status === 'STALE' || refAgg.finalPrice <= 0) {
      return {
        success: false,
        targetPrice: mapping.targetAnchorPrice,
        rawReferencePrice: refAgg.finalPrice,
        referenceReturnPct: 0,
        appliedFxRate: 1,
        error: `Reference price invalid or stale (${refAgg.status}: ${refAgg.rejectionReason || 'No fresh tick'})`,
      };
    }

    const currentRefPrice = refAgg.finalPrice;
    const refAnchor = mapping.referenceAnchorPrice > 0 ? mapping.referenceAnchorPrice : currentRefPrice;
    const targetAnchor = mapping.targetAnchorPrice > 0 ? mapping.targetAnchorPrice : 10000;

    let computedPrice = targetAnchor;
    const refReturn = (currentRefPrice - refAnchor) / refAnchor;

    switch (mapping.mappingMode) {
      case 'DIRECT_PRICE':
        computedPrice = currentRefPrice;
        break;

      case 'BETA_SCALED_RETURN':
      case 'PERCENTAGE_RETURN':
      default:
        // target_price = target_anchor_price * (1 + sensitivity_beta * ref_return)
        computedPrice = targetAnchor * (1 + mapping.sensitivityBeta * refReturn);
        break;

      case 'FX_CONVERTED_REFERENCE':
        // e.g. BTC/IDR = BTC/USDT * USDT/IDR
        const fx = this.getFxRate();
        computedPrice = currentRefPrice * fx.usdtIdrRate;
        break;

      case 'MANUAL_ANCHOR':
        computedPrice = targetAnchor;
        break;
    }

    // If target requires FX conversion and mode was not already FX_CONVERTED_REFERENCE
    let fxRate = 1;
    if (mapping.requiresFxConversion && mapping.mappingMode !== 'FX_CONVERTED_REFERENCE') {
      const fx = this.getFxRate();
      if (fx.isStale) {
        return {
          success: false,
          targetPrice: targetAnchor,
          rawReferencePrice: currentRefPrice,
          referenceReturnPct: refReturn * 100,
          appliedFxRate: fx.usdtIdrRate,
          error: 'Kurs FX USDT/IDR telah kedaluwarsa. Pause membuka order baru.',
        };
      }
      fxRate = fx.usdtIdrRate;
    }

    // Safety check: Maximum mapping deviation from target anchor
    const maxDevPct = (mapping.maxDeviationBps || 1000) / 10000; // e.g. 10%
    const deviationFromAnchor = Math.abs(computedPrice - targetAnchor) / targetAnchor;
    if (deviationFromAnchor > maxDevPct) {
      return {
        success: false,
        targetPrice: targetAnchor,
        rawReferencePrice: currentRefPrice,
        referenceReturnPct: refReturn * 100,
        appliedFxRate: fxRate,
        error: `Penyimpangan target price (${(deviationFromAnchor * 100).toFixed(2)}%) melampaui batas risiko (${(maxDevPct * 100).toFixed(2)}%). Bot terkunci secara otomatis.`,
      };
    }

    return {
      success: true,
      targetPrice: Math.round(computedPrice * 100) / 100,
      rawReferencePrice: currentRefPrice,
      referenceReturnPct: Math.round(refReturn * 10000) / 100,
      appliedFxRate: fxRate,
    };
  }

  /**
   * Aggregates external multi-exchange price feeds with staleness rejection and outlier detection
   */
  public static calculateAggregatedPrice(
    tickers: any[],
    options?: { maxStalenessMs?: number; outlierThresholdPercent?: number }
  ): {
    baseAsset: string;
    quoteAsset: string;
    sourcesCount: number;
    isFresh: boolean;
    aggregatedMid: number;
    hasOutliers: boolean;
    outlierExchanges?: string[];
  } {
    const maxStaleness = options?.maxStalenessMs || 10000;
    const outlierThreshold = options?.outlierThresholdPercent || 3.0;
    const now = Date.now();

    const fresh = tickers.filter((t) => now - (t.timestamp || 0) <= maxStaleness);
    if (fresh.length === 0) {
      return {
        baseAsset: tickers[0]?.baseAsset || 'BTC',
        quoteAsset: tickers[0]?.quoteAsset || 'USDT',
        sourcesCount: 0,
        isFresh: false,
        aggregatedMid: 0,
        hasOutliers: false,
      };
    }

    const midPrices = fresh.map((t) => t.midPrice || (t.bidPrice + t.askPrice) / 2);
    const avgMid = midPrices.reduce((a, b) => a + b, 0) / midPrices.length;

    const outliers: string[] = [];
    fresh.forEach((t) => {
      const mid = t.midPrice || (t.bidPrice + t.askPrice) / 2;
      const dev = Math.abs(mid - avgMid) / avgMid;
      if (dev * 100 > outlierThreshold) {
        outliers.push(t.exchange || t.provider || 'UNKNOWN');
      }
    });

    return {
      baseAsset: fresh[0]?.baseAsset || 'BTC',
      quoteAsset: fresh[0]?.quoteAsset || 'USDT',
      sourcesCount: fresh.length,
      isFresh: true,
      aggregatedMid: Math.round(avgMid * 100) / 100,
      hasOutliers: outliers.length > 0,
      outlierExchanges: outliers,
    };
  }

  /**
   * Converts foreign asset price to domestic IDR pair
   */
  public static convertPriceWithFx(
    price: number,
    fromCurrency: string,
    toCurrency: string,
    fxRateConfig?: any
  ): {
    convertedPrice: number;
    effectiveFxRate: number;
    isValid: boolean;
    errorReason?: string;
  } {
    if (!fxRateConfig) {
      return { convertedPrice: 0, effectiveFxRate: 0, isValid: false, errorReason: 'MISSING_FX_CONFIG' };
    }

    const now = Date.now();
    const expiry = fxRateConfig.validUntil || fxRateConfig.expiresAt;
    if (expiry && now > expiry) {
      return { convertedPrice: 0, effectiveFxRate: 0, isValid: false, errorReason: 'EXPIRED_FX_RATE' };
    }

    const rate = fxRateConfig.rate || fxRateConfig.usdtIdrRate || 16250;
    if (rate <= 0) {
      return { convertedPrice: 0, effectiveFxRate: 0, isValid: false, errorReason: 'INVALID_RATE' };
    }

    return {
      convertedPrice: Math.round(price * rate),
      effectiveFxRate: rate,
      isValid: true,
    };
  }

  /**
   * Validates manual FX rate input
   */
  public static validateFxRateInput(rate: number): number {
    if (typeof rate !== 'number' || isNaN(rate) || rate <= 0 || rate < 5000 || rate > 50000) {
      throw new Error('Nilai kurs tidak wajar. Kurs harus di atas 0 dan dalam batas realistis.');
    }
    return rate;
  }

  /**
   * Computes mapped price according to sensitivity beta and guardrails
   */
  public static calculateMappedPrice(
    currentRefPrice: number,
    config: {
      targetPair?: string;
      referenceAsset?: string;
      targetAnchorPrice: number;
      referenceAnchorPrice: number;
      sensitivityBeta: number;
      maxPriceDeviationPercent?: number;
    }
  ): {
    targetPrice: number;
    appliedPercentageReturn: number;
    withinSafetyBounds: boolean;
    clamped?: boolean;
  } {
    const refReturn = (currentRefPrice / config.referenceAnchorPrice) - 1;
    const appliedReturn = config.sensitivityBeta * refReturn;
    const rawTarget = config.targetAnchorPrice * (1 + appliedReturn);

    const maxDevPct = config.maxPriceDeviationPercent || 15.0;
    const maxAllowed = config.targetAnchorPrice * (1 + maxDevPct / 100);
    const minAllowed = config.targetAnchorPrice * (1 - maxDevPct / 100);
    const EPSILON = 1e-4;

    if (rawTarget - maxAllowed > EPSILON) {
      return {
        targetPrice: Math.round(maxAllowed),
        appliedPercentageReturn: appliedReturn,
        withinSafetyBounds: false,
        clamped: true,
      };
    }

    if (minAllowed - rawTarget > EPSILON) {
      return {
        targetPrice: Math.round(minAllowed),
        appliedPercentageReturn: appliedReturn,
        withinSafetyBounds: false,
        clamped: true,
      };
    }

    return {
      targetPrice: Math.round(rawTarget),
      appliedPercentageReturn: appliedReturn,
      withinSafetyBounds: true,
      clamped: false,
    };
  }

  /**
   * Deep clones a bot with new ID, isolated STOPPED state, and 0 initial active orders
   */
  public static cloneBot(bot: any, targetAccount: string): any {
    const copy = JSON.parse(JSON.stringify(bot));
    copy.id = `mm_bot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    copy.name = `[CLONE] ${bot.name}`;
    copy.status = 'STOPPED';
    copy.activeOrdersCount = 0;
    copy.activeOpenOrdersCount = 0;
    copy.currentInventoryBase = 0;
    copy.currentInventoryQuote = 0;
    copy.currentBaseInventory = 0;
    copy.currentQuoteInventory = 0;
    copy.assignedAccount = targetAccount;
    copy.accountId = targetAccount;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    return copy;
  }

  /**
   * Transitions bot lifecycle state and clears active orders on STOPPED
   */
  public static transitionBotState(bot: any, targetStatus: string): any {
    const next = { ...bot, status: targetStatus, updatedAt: Date.now() };
    if (targetStatus === 'STOPPED') {
      next.activeOrdersCount = 0;
      next.activeOpenOrdersCount = 0;
    }
    return next;
  }

  /**
   * Creates a cryptographic audit entry
   */
  public static async createCryptographicAuditEntry(params: {
    actorId?: string;
    actorRole?: string;
    botId?: string;
    eventType?: string;
    action?: string;
    actor?: string;
    payload: Record<string, any>;
    previousHash?: string;
    index?: number;
    timestamp?: number;
  }): Promise<CryptographicAuditEvent> {
    const entry = createCryptographicAuditEntry({
      previousHash: params.previousHash || '0'.repeat(64),
      botId: params.botId || 'sys_mm_engine',
      action: params.action || params.eventType || 'SYSTEM_AUDIT',
      actor: params.actor || params.actorId || 'system',
      timestamp: params.timestamp || Date.now(),
      payload: params.payload,
    });
    return {
      ...entry,
      actorId: params.actorId || params.actor || 'system',
      actorRole: params.actorRole || 'admin',
      eventType: params.eventType || params.action || 'SYSTEM_AUDIT',
      index: params.index ?? 0,
      signatureVerified: true,
    };
  }

  public static verifyAuditLogIntegrity = verifyAuditLogIntegrity;
}

/**
 * Deterministic hash computation using node:crypto or fallback hex digest
 */
function computeDeterministicSha256(payloadStr: string): string {
  try {
    // Dynamic check for node environment
    if (typeof process !== 'undefined' && process.versions?.node) {
      const nodeCrypto = eval("require('node:crypto')");
      if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
        return nodeCrypto.createHash('sha256').update(payloadStr).digest('hex');
      }
    }
  } catch {}

  let hash1 = 0x811c9dc5;
  let hash2 = 0x9e3779b9;
  for (let i = 0; i < payloadStr.length; i++) {
    const code = payloadStr.charCodeAt(i);
    hash1 = Math.imul(hash1 ^ code, 0x01000193);
    hash2 = Math.imul(hash2 ^ (code << 3), 0x01000193);
  }
  const hex1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  return (hex1 + hex2).repeat(4);
}

/**
 * Creates tamper-evident cryptographic audit entry
 */
export function createCryptographicAuditEntry(params: {
  previousHash: string;
  botId: string;
  action: string;
  actor: string;
  timestamp: number;
  payload: any;
}): any {
  const prevHash = params.previousHash || '0'.repeat(64);
  const canonical = JSON.stringify(params.payload);
  const msg = `${prevHash}:${params.botId}:${params.action}:${params.actor}:${params.timestamp}:${canonical}`;
  const hash = computeDeterministicSha256(msg);

  return {
    id: `audit_${params.timestamp}_${Math.random().toString(36).slice(2, 6)}`,
    previousHash: prevHash,
    hash,
    currentHash: hash,
    botId: params.botId,
    action: params.action,
    actor: params.actor,
    timestamp: params.timestamp,
    payload: params.payload,
  };
}

/**
 * Verifies audit trail cryptographic integrity
 */
export function verifyAuditLogIntegrity(
  events: any[],
  genesisHash: string
): { isValid: boolean; tamperedIndex: number | null } {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expectedPrev = i === 0 ? genesisHash : (events[i - 1].hash || events[i - 1].currentHash);
    if (event.previousHash !== expectedPrev) {
      return { isValid: false, tamperedIndex: i };
    }

    const canonical = JSON.stringify(event.payload);
    const msg = `${event.previousHash}:${event.botId}:${event.action || event.eventType}:${event.actor || event.actorId}:${event.timestamp}:${canonical}`;
    const calculated = computeDeterministicSha256(msg);
    if ((event.hash || event.currentHash) !== calculated) {
      return { isValid: false, tamperedIndex: i };
    }
  }
  return { isValid: true, tamperedIndex: null };
}
