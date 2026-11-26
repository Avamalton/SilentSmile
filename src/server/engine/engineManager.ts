import { DatabaseManager } from '../db/database';
import { LedgerService } from '../ledger/ledgerService';
import { MatchingEngine, MarketPairConfig, PlaceOrderCommand, EngineTradeRecord } from './matchingEngine';
import {
  KlineAggregator,
  KlineInterval,
  KLINE_INTERVALS,
  INTERVAL_SECONDS,
  CandleBar,
  FormattedCandleBar,
  CandleQueryOptions,
} from './klineAggregator';
import { OrderBookDepth } from './orderBook';

export interface MarketTicker {
  pairId: string;
  lastPrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;       // In base units
  quoteVolume24h: number;  // In quote units
  timestamp: number;
}

export type BroadcastHandler = (topic: string, data: any) => void;

export class EngineManager {
  private static instance: EngineManager | null = null;
  private dbMgr: DatabaseManager;
  private ledger: LedgerService;
  private engines: Map<string, MatchingEngine> = new Map();
  private pairConfigs: Map<string, MarketPairConfig> = new Map();
  public klineAggregator: KlineAggregator;
  private broadcastHandler: BroadcastHandler | null = null;

  constructor(dbMgr: DatabaseManager, ledger: LedgerService) {
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.klineAggregator = new KlineAggregator();
  }

  public static getInstance(dbMgr?: DatabaseManager, ledger?: LedgerService): EngineManager {
    if (!EngineManager.instance) {
      if (!dbMgr || !ledger) {
        throw new Error('DatabaseManager and LedgerService required for first initialization');
      }
      EngineManager.instance = new EngineManager(dbMgr, ledger);
    }
    return EngineManager.instance;
  }

  public setBroadcastHandler(handler: BroadcastHandler): void {
    this.broadcastHandler = handler;
  }

  private attachEngineListeners(engine: MatchingEngine, config: MarketPairConfig): void {
    engine.addListener((evt) => {
      if (evt.eventType === 'TRADE_EXECUTED') {
        const trade = evt.payload as EngineTradeRecord;
        this.processTradeEvent(trade, config, engine);
      } else if (evt.eventType === 'ORDER_ACCEPTED' || evt.eventType === 'ORDER_CANCELLED') {
        if (this.broadcastHandler) {
          this.broadcastHandler(`depth:${evt.pairId}`, engine.getDepth(25));
        }
      }
    });
  }

  private processTradeEvent(
    trade: EngineTradeRecord,
    config: MarketPairConfig,
    engine?: MatchingEngine
  ): Record<KlineInterval, FormattedCandleBar> | null {
    const updatedBars = this.klineAggregator.recordTrade(
      trade.pairId,
      trade.price,
      trade.amount,
      trade.total,
      trade.timestamp,
      trade.id
    );

    let formattedByInterval: Record<KlineInterval, FormattedCandleBar> | null = null;
    if (updatedBars) {
      const temp: Partial<Record<KlineInterval, FormattedCandleBar>> = {};
      for (const interval of KLINE_INTERVALS) {
        temp[interval] = KlineAggregator.formatBar(
          updatedBars[interval],
          config.basePrecision,
          config.quotePrecision
        );
      }
      formattedByInterval = temp as Record<KlineInterval, FormattedCandleBar>;
    }

    if (this.broadcastHandler) {
      this.broadcastHandler(`trade:${trade.pairId}`, trade);
      this.broadcastHandler(`ticker:${trade.pairId}`, this.getTicker(trade.pairId));
      if (engine) {
        this.broadcastHandler(`depth:${trade.pairId}`, engine.getDepth(25));
      }

      if (formattedByInterval) {
        for (const interval of KLINE_INTERVALS) {
          this.broadcastHandler(`kline:${trade.pairId}:${interval}`, {
            pairId: trade.pairId,
            interval,
            tradeId: trade.id,
            timestamp: trade.timestamp,
            basePrecision: config.basePrecision,
            quotePrecision: config.quotePrecision,
            candle: formattedByInterval[interval],
          });
        }
      }
    }

    return formattedByInterval;
  }

  public async initialize(): Promise<void> {
    const pairs = this.dbMgr.query<any>('SELECT * FROM market_pairs');
    for (const p of pairs) {
      const config: MarketPairConfig = {
        id: p.id,
        baseAsset: p.base_asset,
        quoteAsset: p.quote_asset,
        basePrecision: p.base_precision,
        quotePrecision: p.quote_precision,
        minOrderSize: p.min_order_size,
        makerFeeBps: p.maker_fee_bps,
        takerFeeBps: p.taker_fee_bps,
        isActive: p.is_active,
        tradingStatus: p.trading_status || 'OPEN',
      };

      const engine = new MatchingEngine(config, this.dbMgr, this.ledger);
      await engine.recover();
      this.attachEngineListeners(engine, config);

      this.engines.set(config.id, engine);
      this.pairConfigs.set(config.id, config);
    }

    // Seed recent trades into Kline aggregator (ordered chronologically with trade IDs for dedupe)
    const recentTrades = this.dbMgr.query<any>(
      'SELECT id, pair_id, price, amount, total, timestamp FROM trades ORDER BY timestamp ASC LIMIT 10000'
    );
    this.klineAggregator.seedFromTrades(recentTrades);
  }

  public async ensurePairRegistered(pairInput: {
    id: string;
    baseAsset?: string;
    quoteAsset?: string;
    basePrecision?: number;
    quotePrecision?: number;
    minOrderSize?: number;
    makerFeeBps?: number;
    takerFeeBps?: number;
    isActive?: boolean | number;
    tradingStatus?: string;
  }): Promise<MarketPairConfig> {
    const normalizedId = decodeURIComponent(pairInput.id || '')
      .trim()
      .replace(/^SILENTSMILE:/i, '')
      .replace(/[-_]/g, '/')
      .toUpperCase();

    const existingResolved = this.resolvePairId(normalizedId);
    if (existingResolved) {
      const existingCfg = this.pairConfigs.get(existingResolved)!;
      if (pairInput.isActive !== undefined || pairInput.tradingStatus !== undefined) {
        const nextActive =
          pairInput.isActive !== undefined ? (pairInput.isActive ? 1 : 0) : existingCfg.isActive;
        const nextStatus: 'OPEN' | 'HALTED' =
          pairInput.tradingStatus === 'HALTED'
            ? 'HALTED'
            : pairInput.tradingStatus
              ? 'OPEN'
              : existingCfg.tradingStatus;
        existingCfg.isActive = nextActive;
        existingCfg.tradingStatus = nextStatus;
        this.dbMgr.execute(
          'UPDATE market_pairs SET is_active = ?, trading_status = ? WHERE id = ?',
          [nextActive, nextStatus, existingCfg.id]
        );
      }
      return existingCfg;
    }

    const parts = normalizedId.split('/');
    const baseAsset = (pairInput.baseAsset || parts[0] || normalizedId).toUpperCase();
    const quoteAsset = (pairInput.quoteAsset || parts[1] || 'IDR').toUpperCase();
    const basePrecision = Number.isFinite(Number(pairInput.basePrecision))
      ? Number(pairInput.basePrecision)
      : 4;
    const quotePrecision = Number.isFinite(Number(pairInput.quotePrecision))
      ? Number(pairInput.quotePrecision)
      : 0;
    const minOrderSize = Math.max(1, Math.round(Number(pairInput.minOrderSize) || 1));
    const makerFeeBps = Number.isFinite(Number(pairInput.makerFeeBps))
      ? Number(pairInput.makerFeeBps)
      : 10;
    const takerFeeBps = Number.isFinite(Number(pairInput.takerFeeBps))
      ? Number(pairInput.takerFeeBps)
      : 15;
    const isActive = pairInput.isActive === false || pairInput.isActive === 0 ? 0 : 1;
    const tradingStatus: 'OPEN' | 'HALTED' = pairInput.tradingStatus === 'HALTED' ? 'HALTED' : 'OPEN';

    this.dbMgr.execute(
      `INSERT OR IGNORE INTO market_pairs (id, base_asset, quote_asset, base_precision, quote_precision, min_order_size, maker_fee_bps, taker_fee_bps, is_active, trading_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedId,
        baseAsset,
        quoteAsset,
        basePrecision,
        quotePrecision,
        minOrderSize,
        makerFeeBps,
        takerFeeBps,
        isActive,
        tradingStatus,
      ]
    );

    const config: MarketPairConfig = {
      id: normalizedId,
      baseAsset,
      quoteAsset,
      basePrecision,
      quotePrecision,
      minOrderSize,
      makerFeeBps,
      takerFeeBps,
      isActive,
      tradingStatus,
    };

    const engine = new MatchingEngine(config, this.dbMgr, this.ledger);
    await engine.recover();
    this.attachEngineListeners(engine, config);

    this.engines.set(config.id, engine);
    this.pairConfigs.set(config.id, config);
    return config;
  }

  /**
   * Persists a real executed matching-engine trade (in human price/amount units) into SQLite `trades`,
   * aggregates it across all Kline intervals using exact integer/BigInt arithmetic, and broadcasts via WS.
   */
  public async recordExecutedTrade(input: {
    id: string;
    pairId: string;
    price: number;
    amount: number;
    total?: number;
    side: string;
    makerOrderId?: string;
    takerOrderId?: string;
    makerUserId?: string;
    takerUserId?: string;
    makerFee?: number;
    takerFee?: number;
    timestamp?: number;
    pairMeta?: {
      baseAsset?: string;
      quoteAsset?: string;
      basePrecision?: number;
      quotePrecision?: number;
      minOrderSize?: number;
      makerFeeBps?: number;
      takerFeeBps?: number;
      isActive?: boolean | number;
      tradingStatus?: string;
    };
  }): Promise<{
    recorded: boolean;
    tradeId: string;
    pairId: string;
    candlesByInterval: Record<KlineInterval, FormattedCandleBar> | null;
  }> {
    const cfg = await this.ensurePairRegistered({
      id: input.pairId,
      ...(input.pairMeta || {}),
    });

    const tradeId = String(input.id || `trd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const existingRow = this.dbMgr.queryOne<{ id: string }>('SELECT id FROM trades WHERE id = ?', [tradeId]);
    if (existingRow) {
      return {
        recorded: false,
        tradeId,
        pairId: cfg.id,
        candlesByInterval: null,
      };
    }

    const quoteScale = Math.pow(10, Math.max(0, cfg.quotePrecision));
    const baseScale = Math.pow(10, Math.max(0, cfg.basePrecision));

    const humanPrice = Number(input.price);
    const humanAmount = Number(input.amount);
    if (!Number.isFinite(humanPrice) || humanPrice <= 0 || !Number.isFinite(humanAmount) || humanAmount <= 0) {
      throw new Error(`Invalid trade price/amount for ${cfg.id}`);
    }

    const priceInt = Math.max(1, Math.round(humanPrice * quoteScale));
    const amountInt = Math.max(1, Math.round(humanAmount * baseScale));
    const humanTotal = input.total !== undefined && Number.isFinite(Number(input.total))
      ? Number(input.total)
      : humanPrice * humanAmount;
    const totalInt = Math.max(1, Math.round(humanTotal * quoteScale));
    const tsMs = Number.isFinite(Number(input.timestamp)) ? Math.floor(Number(input.timestamp)) : Date.now();
    const normSide = String(input.side || 'buy').toLowerCase() === 'sell' ? 'SELL' : 'BUY';

    const makerOrderId = String(input.makerOrderId || `ord_m_${tradeId}`);
    const takerOrderId = String(input.takerOrderId || `ord_t_${tradeId}`);
    const makerUserId = String(input.makerUserId || 'usr_mm_01');
    const takerUserId = String(input.takerUserId || 'usr_trader_01');
    const makerFee = Math.max(0, Math.round(Number(input.makerFee || 0) * quoteScale));
    const takerFee = Math.max(0, Math.round(Number(input.takerFee || 0) * quoteScale));

    this.dbMgr.execute(
      `INSERT OR IGNORE INTO trades (id, pair_id, price, amount, total, side, maker_order_id, taker_order_id, maker_user_id, taker_user_id, maker_fee, taker_fee, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tradeId,
        cfg.id,
        priceInt,
        amountInt,
        totalInt,
        normSide,
        makerOrderId,
        takerOrderId,
        makerUserId,
        takerUserId,
        makerFee,
        takerFee,
        tsMs,
      ]
    );

    const engineTrade: EngineTradeRecord = {
      id: tradeId,
      pairId: cfg.id,
      price: priceInt,
      amount: amountInt,
      total: totalInt,
      side: normSide,
      makerOrderId,
      takerOrderId,
      makerUserId,
      takerUserId,
      makerFee,
      takerFee,
      timestamp: tsMs,
    };

    const candlesByInterval = this.processTradeEvent(engineTrade, cfg, this.engines.get(cfg.id));

    return {
      recorded: true,
      tradeId,
      pairId: cfg.id,
      candlesByInterval,
    };
  }

  public resolvePairId(rawSymbol: string): string | null {
    const cleaned = decodeURIComponent(rawSymbol || '')
      .trim()
      .replace(/^SILENTSMILE:/i, '')
      .toUpperCase();

    if (this.engines.has(cleaned)) return cleaned;

    const normalized = cleaned.replace(/[-_]/g, '/');
    if (this.engines.has(normalized)) return normalized;

    const compact = cleaned.replace(/[-_/]/g, '');
    for (const pairId of this.engines.keys()) {
      if (pairId.replace(/[-_/]/g, '').toUpperCase() === compact) {
        return pairId;
      }
    }
    return null;
  }

  public getPairConfig(pairId: string): MarketPairConfig {
    const resolved = this.resolvePairId(pairId) || pairId;
    const cfg = this.pairConfigs.get(resolved);
    if (!cfg) {
      throw new Error(`Market pair ${pairId} not found`);
    }
    return cfg;
  }

  public getEngine(pairId: string): MatchingEngine {
    const resolved = this.resolvePairId(pairId) || pairId;
    const engine = this.engines.get(resolved);
    if (!engine) {
      throw new Error(`Trading engine for pair ${pairId} not found`);
    }
    return engine;
  }

  public async submitOrder(pairId: string, cmd: PlaceOrderCommand): Promise<any> {
    const engine = this.getEngine(pairId);
    return engine.submitOrder(cmd);
  }

  public async cancelOrder(pairId: string, orderId: string, userId: string): Promise<boolean> {
    const engine = this.getEngine(pairId);
    return engine.cancelOrder(orderId, userId);
  }

  public getDepth(pairId: string, levels: number = 20): OrderBookDepth {
    const engine = this.getEngine(pairId);
    return engine.getDepth(levels);
  }

  public getRecentTrades(pairId: string, limit: number = 50): EngineTradeRecord[] {
    const resolved = this.resolvePairId(pairId) || pairId;
    return this.dbMgr.query<EngineTradeRecord>(
      'SELECT * FROM trades WHERE pair_id = ? ORDER BY timestamp DESC LIMIT ?',
      [resolved, limit]
    );
  }

  public getCandles(pairId: string, interval: KlineInterval = '1m', limit: number = 300): CandleBar[] {
    const resolved = this.resolvePairId(pairId) || pairId;
    return this.klineAggregator.getCandles(resolved, interval, limit);
  }

  /**
   * Returns precision-formatted OHLCV candles in Unix seconds directly from SQLite trades
   * with full historical range pagination (from/to/countBack/limit) and zero floating-point math.
   */
  public getFormattedCandles(
    pairId: string,
    interval: KlineInterval = '1m',
    options: CandleQueryOptions = {}
  ): {
    pairId: string;
    interval: KlineInterval;
    basePrecision: number;
    quotePrecision: number;
    candles: FormattedCandleBar[];
    noData: boolean;
    nextTime?: number;
  } {
    const cfg = this.getPairConfig(pairId);
    const resolvedId = cfg.id;
    const stepSec = INTERVAL_SECONDS[interval];
    const limit = Math.min(1000, Math.max(1, options.countBack || options.limit || 300));

    // When explicit fromSec/toSec range is supplied, query SQLite directly aligned to bucket boundaries
    if (options.fromSec !== undefined || options.toSec !== undefined) {
      const fromBucketSec =
        options.fromSec !== undefined ? Math.floor(options.fromSec / stepSec) * stepSec : 0;
      const toBucketEndSec =
        options.toSec !== undefined
          ? Math.floor(options.toSec / stepSec) * stepSec + stepSec - 1
          : Math.floor(Date.now() / 1000) + stepSec;

      const rows = this.dbMgr.query<any>(
        `SELECT id, pair_id, price, amount, total, timestamp
         FROM trades
         WHERE pair_id = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
        [resolvedId, fromBucketSec * 1000, toBucketEndSec * 1000 + 999]
      );

      let formatted = KlineAggregator.aggregateTradeRows(
        rows,
        interval,
        cfg.basePrecision,
        cfg.quotePrecision
      );

      if (options.fromSec !== undefined) {
        formatted = formatted.filter((b) => b.time >= fromBucketSec);
      }
      if (options.toSec !== undefined) {
        formatted = formatted.filter((b) => b.time <= options.toSec!);
      }

      if (formatted.length > limit) {
        formatted = formatted.slice(-limit);
      }

      let nextTime: number | undefined;
      if (formatted.length === 0 && options.fromSec !== undefined) {
        const olderTrade = this.dbMgr.queryOne<{ timestamp: number }>(
          'SELECT timestamp FROM trades WHERE pair_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1',
          [resolvedId, fromBucketSec * 1000]
        );
        if (olderTrade) {
          nextTime = KlineAggregator.getBucketSec(olderTrade.timestamp, interval);
        }
      }

      return {
        pairId: resolvedId,
        interval,
        basePrecision: cfg.basePrecision,
        quotePrecision: cfg.quotePrecision,
        candles: formatted,
        noData: formatted.length === 0,
        nextTime,
      };
    }

    // Default latest window: use in-memory aggregator (already seeded from DB) or query DB if empty
    let rawBars = this.klineAggregator.getCandlesRange(resolvedId, interval, options);
    if (rawBars.length === 0) {
      const dbRows = this.dbMgr.query<any>(
        'SELECT id, pair_id, price, amount, total, timestamp FROM trades WHERE pair_id = ? ORDER BY timestamp ASC LIMIT 5000',
        [resolvedId]
      );
      if (dbRows.length > 0) {
        this.klineAggregator.seedFromTrades(dbRows);
        rawBars = this.klineAggregator.getCandlesRange(resolvedId, interval, options);
      }
    }

    const candles = rawBars.map((b) =>
      KlineAggregator.formatBar(b, cfg.basePrecision, cfg.quotePrecision)
    );

    return {
      pairId: resolvedId,
      interval,
      basePrecision: cfg.basePrecision,
      quotePrecision: cfg.quotePrecision,
      candles,
      noData: candles.length === 0,
    };
  }

  public getTicker(pairId: string): MarketTicker {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const trades24h = this.dbMgr.query<any>(
      'SELECT price, amount, total FROM trades WHERE pair_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
      [pairId, dayAgo]
    );

    const latestTrade = this.dbMgr.queryOne<any>(
      'SELECT price FROM trades WHERE pair_id = ? ORDER BY timestamp DESC LIMIT 1',
      [pairId]
    );

    const lastPrice = latestTrade ? latestTrade.price : 0;

    if (trades24h.length === 0) {
      return {
        pairId,
        lastPrice,
        priceChange24h: 0,
        priceChangePercent24h: 0,
        high24h: lastPrice,
        low24h: lastPrice,
        volume24h: 0,
        quoteVolume24h: 0,
        timestamp: now,
      };
    }

    const firstPrice = trades24h[0].price;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    let quoteVolume = 0;

    for (const t of trades24h) {
      if (t.price > high) high = t.price;
      if (t.price < low) low = t.price;
      volume += t.amount;
      quoteVolume += t.total;
    }

    const change = lastPrice - firstPrice;
    const changePct = firstPrice > 0 ? ((change / firstPrice) * 100) : 0;

    return {
      pairId,
      lastPrice,
      priceChange24h: change,
      priceChangePercent24h: Number(changePct.toFixed(2)),
      high24h: high,
      low24h: low,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      timestamp: now,
    };
  }

  public getAllTickers(): MarketTicker[] {
    const tickers: MarketTicker[] = [];
    for (const pairId of this.engines.keys()) {
      tickers.push(this.getTicker(pairId));
    }
    return tickers;
  }

  public setTradingStatus(pairId: string, status: 'OPEN' | 'HALTED'): void {
    const engine = this.getEngine(pairId);
    engine.pairConfig.tradingStatus = status;
    this.dbMgr.execute('UPDATE market_pairs SET trading_status = ? WHERE id = ?', [status, pairId]);
  }

  public updateFees(pairId: string, makerBps: number, takerBps: number): void {
    const engine = this.getEngine(pairId);
    engine.pairConfig.makerFeeBps = makerBps;
    engine.pairConfig.takerFeeBps = takerBps;
    this.dbMgr.execute('UPDATE market_pairs SET maker_fee_bps = ?, taker_fee_bps = ? WHERE id = ?', [
      makerBps,
      takerBps,
      pairId,
    ]);
  }
}
