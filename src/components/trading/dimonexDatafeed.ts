import {
  BackendInterval,
  CandleSecondsBar,
  DatafeedConnectionStatus,
  IDatafeedChartApi,
  ResolutionString,
  TVBar,
  TVDatafeedConfiguration,
  TVErrorCallback,
  TVHistoryCallback,
  TVLibrarySymbolInfo,
  TVPeriodParams,
  TVSearchSymbolResultItem,
  TVSubscribeBarsCallback,
} from './chartTypes';

export interface BackendMarketPair {
  id: string;
  base_asset: string;
  quote_asset: string;
  base_precision: number;
  quote_precision: number;
  min_order_size: number;
  maker_fee_bps?: number;
  taker_fee_bps?: number;
  is_active: number;
  trading_status?: string;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((ev?: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onerror: ((ev?: any) => void) | null;
  onclose: ((ev?: any) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface DimonexDatafeedOptions {
  apiBaseUrl?: string;
  wsUrl?: string;
  fetchFn?: typeof fetch;
  wsFactory?: (url: string) => WebSocketLike;
}

export const SUPPORTED_RESOLUTIONS: ResolutionString[] = ['1', '5', '15', '60', '240', '1D'];

export const RESOLUTION_TO_INTERVAL: Record<string, BackendInterval> = {
  '1': '1m',
  '1m': '1m',
  '5': '5m',
  '5m': '5m',
  '15': '15m',
  '15m': '15m',
  '60': '1h',
  '1h': '1h',
  '240': '4h',
  '4h': '4h',
  '1D': '1d',
  'D': '1d',
  '1d': '1d',
};

export const INTERVAL_TO_SECONDS: Record<BackendInterval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export function resolutionToInterval(resolution: string): BackendInterval {
  const clean = String(resolution || '').trim();
  const mapped = RESOLUTION_TO_INTERVAL[clean] || RESOLUTION_TO_INTERVAL[clean.toUpperCase()];
  if (!mapped) {
    throw new Error(`Unsupported chart resolution: ${resolution}`);
  }
  return mapped;
}

export function normalizePairSymbol(rawSymbol: string): string {
  const clean = decodeURIComponent(String(rawSymbol || ''))
    .trim()
    .replace(/^SILENTSMILE:/i, '')
    .toUpperCase();

  if (clean.includes('/')) return clean;
  if (clean.includes('_')) return clean.replace(/_/g, '/');
  if (clean.includes('-')) return clean.replace(/-/g, '/');
  if (clean.endsWith('IDR') && clean.length > 3) {
    return `${clean.slice(0, -3)}/IDR`;
  }
  if (clean.endsWith('USDT') && clean.length > 4) {
    return `${clean.slice(0, -4)}/USDT`;
  }
  return clean;
}

interface BarSubscriptionEntry {
  subscriberUID: string;
  pairId: string;
  interval: BackendInterval;
  basePrecision: number;
  quotePrecision: number;
  klineTopic: string;
  tradeTopic: string;
  onTick: TVSubscribeBarsCallback;
  onResetCache?: () => void;
}

export class DimonexDatafeed implements IDatafeedChartApi {
  private readonly apiBaseUrl: string;
  private readonly wsUrlOverride?: string;
  private readonly fetchFn: typeof fetch;
  private readonly wsFactory?: (url: string) => WebSocketLike;

  private pairsCache: BackendMarketPair[] = [];
  private pairsCacheAt = 0;

  private ws: WebSocketLike | null = null;
  private wsStatus: DatafeedConnectionStatus = 'IDLE';
  private wsStatusListeners = new Set<(status: DatafeedConnectionStatus) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private isDisposed = false;

  private subscriptions = new Map<string, BarSubscriptionEntry>();
  private subscribedTopics = new Set<string>();
  private lastBarByStream = new Map<string, CandleSecondsBar>();
  private seenStreamTradeIds = new Set<string>();
  private static readonly MAX_SEEN_IDS = 5000;

  private localTradeListener: ((ev: Event) => void) | null = null;
  private localPairSyncListener: (() => void) | null = null;

  constructor(options: DimonexDatafeedOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? '').replace(/\/$/, '');
    this.wsUrlOverride = options.wsUrl;
    this.fetchFn = options.fetchFn || ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.wsFactory = options.wsFactory;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.localTradeListener = (ev: Event) => {
        const detail = (ev as CustomEvent)?.detail;
        if (detail && Array.isArray(detail.trades)) {
          this.ingestLocalTrades(detail.pairId, detail.trades);
        }
      };
      this.localPairSyncListener = () => {
        this.pairsCache = [];
        this.pairsCacheAt = 0;
      };
      window.addEventListener('silentsmile:trades-recorded', this.localTradeListener);
      window.addEventListener('silentsmile:pair-synced', this.localPairSyncListener);
    }
  }

  public getConnectionStatus(): DatafeedConnectionStatus {
    return this.wsStatus;
  }

  public onConnectionStatusChange(cb: (status: DatafeedConnectionStatus) => void): () => void {
    this.wsStatusListeners.add(cb);
    cb(this.wsStatus);
    return () => {
      this.wsStatusListeners.delete(cb);
    };
  }

  private setWsStatus(next: DatafeedConnectionStatus): void {
    if (this.wsStatus === next) return;
    this.wsStatus = next;
    for (const cb of this.wsStatusListeners) {
      try {
        cb(next);
      } catch {}
    }
  }

  public onReady(callback: (configuration: TVDatafeedConfiguration) => void): void {
    const config: TVDatafeedConfiguration = {
      supported_resolutions: [...SUPPORTED_RESOLUTIONS],
      exchanges: [
        {
          value: 'SILENTSMILE',
          name: 'SILENT SMILE',
          desc: 'SILENT SMILE Spot Exchange (WIB)',
        },
      ],
      symbols_types: [
        {
          name: 'Crypto Spot',
          value: 'crypto',
        },
      ],
      supports_marks: false,
      supports_timescale_marks: false,
      supports_time: true,
    };

    setTimeout(() => callback(config), 0);
  }

  public searchSymbols(
    userInput: string,
    exchange: string,
    _symbolType: string,
    onResult: (items: TVSearchSymbolResultItem[]) => void
  ): void {
    if (exchange && exchange.toUpperCase() !== 'SILENTSMILE') {
      setTimeout(() => onResult([]), 0);
      return;
    }

    this.fetchActivePairs()
      .then((pairs) => {
        const q = (userInput || '').trim().toUpperCase();
        const filtered = pairs.filter((p) => {
          if (!q) return true;
          return (
            p.id.toUpperCase().includes(q) ||
            p.base_asset.toUpperCase().includes(q) ||
            p.quote_asset.toUpperCase().includes(q)
          );
        });

        const results: TVSearchSymbolResultItem[] = filtered.map((p) => ({
          symbol: p.id,
          full_name: `SILENTSMILE:${p.id}`,
          description: `${p.base_asset} / ${p.quote_asset} Spot`,
          exchange: 'SILENTSMILE',
          ticker: p.id,
          type: 'crypto',
        }));

        onResult(results);
      })
      .catch(() => {
        onResult([]);
      });
  }

  public resolveSymbol(
    symbolName: string,
    onResolve: (symbolInfo: TVLibrarySymbolInfo) => void,
    onError: TVErrorCallback
  ): void {
    const normalized = normalizePairSymbol(symbolName);
    this.fetchActivePairs()
      .then((pairs) => {
        const compactTarget = normalized.replace(/[-_/]/g, '');
        const pair = pairs.find(
          (p) =>
            p.id.toUpperCase() === normalized ||
            p.id.replace(/[-_/]/g, '').toUpperCase() === compactTarget
        );

        if (!pair) {
          onError(`Unknown symbol: ${symbolName}`);
          return;
        }

        const quotePrec = Number.isFinite(Number(pair.quote_precision)) ? Number(pair.quote_precision) : 0;
        const basePrec = Number.isFinite(Number(pair.base_precision)) ? Number(pair.base_precision) : 8;
        const pricescale = Math.pow(10, Math.max(0, quotePrec));

        const info: TVLibrarySymbolInfo = {
          ticker: pair.id,
          name: pair.id,
          full_name: `SILENTSMILE:${pair.id}`,
          description: `${pair.base_asset} / ${pair.quote_asset} Spot`,
          type: 'crypto',
          session: '24x7',
          timezone: 'Asia/Jakarta',
          exchange: 'SILENTSMILE',
          listed_exchange: 'SILENTSMILE',
          minmov: 1,
          pricescale,
          has_intraday: true,
          has_daily: true,
          has_weekly_and_monthly: false,
          supported_resolutions: [...SUPPORTED_RESOLUTIONS],
          volume_precision: basePrec,
          data_status: 'streaming',
          currency_code: pair.quote_asset,
          original_currency_code: pair.quote_asset,
          base_precision: basePrec,
          quote_precision: quotePrec,
        };

        setTimeout(() => onResolve(info), 0);
      })
      .catch((err: any) => {
        setTimeout(() => onError(err?.message || `Failed to resolve ${symbolName}`), 0);
      });
  }

  public async fetchHistoricalCandlesSeconds(
    pairId: string,
    resolution: ResolutionString | string,
    periodParams?: Partial<TVPeriodParams>
  ): Promise<{
    pairId: string;
    interval: BackendInterval;
    bars: CandleSecondsBar[];
    noData: boolean;
    nextTime?: number;
    basePrecision: number;
    quotePrecision: number;
  }> {
    const interval = resolutionToInterval(resolution);
    const canonicalPair = normalizePairSymbol(pairId);

    const params = new URLSearchParams();
    params.set('interval', interval);
    if (periodParams?.from !== undefined && Number.isFinite(periodParams.from)) {
      params.set('from', String(Math.floor(periodParams.from)));
    }
    if (periodParams?.to !== undefined && Number.isFinite(periodParams.to)) {
      params.set('to', String(Math.floor(periodParams.to)));
    }
    if (periodParams?.countBack !== undefined && Number.isFinite(periodParams.countBack)) {
      params.set('countBack', String(Math.max(1, Math.floor(periodParams.countBack))));
    } else {
      params.set('limit', '300');
    }

    const url = `${this.apiBaseUrl}/api/market/klines/${encodeURIComponent(canonicalPair)}?${params.toString()}`;
    const res = await this.fetchFn(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching historical candles for ${canonicalPair}`);
    }

    const json = await res.json();
    if (!json || json.success === false) {
      throw new Error(json?.error || `Failed to load candles for ${canonicalPair}`);
    }

    const rawCandles: any[] = Array.isArray(json.candles) ? json.candles : [];
    const deduped = new Map<number, CandleSecondsBar>();

    for (const c of rawCandles) {
      const timeSec = Math.floor(Number(c.time));
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      const volume = Number(c.volume ?? 0);

      if (
        !Number.isFinite(timeSec) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        continue;
      }

      deduped.set(timeSec, {
        time: timeSec,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        count: typeof c.count === 'number' ? c.count : undefined,
      });
    }

    const sortedBars = Array.from(deduped.values()).sort((a, b) => a.time - b.time);

    if (sortedBars.length > 0) {
      const streamKey = `${json.pairId || canonicalPair}:${interval}`;
      const newest = sortedBars[sortedBars.length - 1];
      const existingNewest = this.lastBarByStream.get(streamKey);
      if (!existingNewest || newest.time >= existingNewest.time) {
        this.lastBarByStream.set(streamKey, { ...newest });
      }
    }

    return {
      pairId: json.pairId || canonicalPair,
      interval,
      bars: sortedBars,
      noData: sortedBars.length === 0 || Boolean(json.noData),
      nextTime: typeof json.nextTime === 'number' ? json.nextTime : undefined,
      basePrecision: typeof json.basePrecision === 'number' ? json.basePrecision : 8,
      quotePrecision: typeof json.quotePrecision === 'number' ? json.quotePrecision : 0,
    };
  }

  public getBars(
    symbolInfo: TVLibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: TVPeriodParams,
    onResult: TVHistoryCallback,
    onError: TVErrorCallback
  ): void {
    const pairId = symbolInfo.ticker || symbolInfo.name;
    this.fetchHistoricalCandlesSeconds(pairId, resolution, periodParams)
      .then((res) => {
        if (res.bars.length === 0) {
          onResult([], {
            noData: res.nextTime === undefined,
            nextTime: res.nextTime !== undefined ? res.nextTime * 1000 : undefined,
          });
          return;
        }

        // Official TradingView Datafeed API requires Bar.time in Unix milliseconds
        const tvBars: TVBar[] = res.bars.map((b) => ({
          time: b.time * 1000,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));

        onResult(tvBars, { noData: false });
      })
      .catch((err: any) => {
        onError(err?.message || 'Failed to load historical OHLCV bars');
      });
  }

  public subscribeBars(
    symbolInfo: TVLibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: TVSubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void
  ): void {
    const pairId = normalizePairSymbol(symbolInfo.ticker || symbolInfo.name);
    const interval = resolutionToInterval(resolution);
    const klineTopic = `kline:${pairId}:${interval}`;
    const tradeTopic = `trade:${pairId}`;

    const entry: BarSubscriptionEntry = {
      subscriberUID: listenerGuid,
      pairId,
      interval,
      basePrecision: symbolInfo.base_precision ?? symbolInfo.volume_precision ?? 8,
      quotePrecision:
        symbolInfo.quote_precision ??
        (symbolInfo.pricescale > 1 ? Math.round(Math.log10(symbolInfo.pricescale)) : 0),
      klineTopic,
      tradeTopic,
      onTick,
      onResetCache: onResetCacheNeededCallback,
    };

    this.subscriptions.set(listenerGuid, entry);
    this.ensureWebSocketConnected();
    this.sendTopicAction('subscribe', klineTopic);
    this.sendTopicAction('subscribe', tradeTopic);
  }

  public unsubscribeBars(listenerGuid: string): void {
    const existing = this.subscriptions.get(listenerGuid);
    if (!existing) return;

    this.subscriptions.delete(listenerGuid);

    // Only unsubscribe from topics when no other subscriber uses them
    const stillUsesKline = Array.from(this.subscriptions.values()).some(
      (s) => s.klineTopic === existing.klineTopic
    );
    const stillUsesTrade = Array.from(this.subscriptions.values()).some(
      (s) => s.tradeTopic === existing.tradeTopic
    );

    if (!stillUsesKline) {
      this.sendTopicAction('unsubscribe', existing.klineTopic);
    }
    if (!stillUsesTrade) {
      this.sendTopicAction('unsubscribe', existing.tradeTopic);
    }

    if (this.subscriptions.size === 0) {
      this.closeWebSocket();
    }
  }

  /**
   * Convenience subscription returning Unix-seconds bars for Lightweight Charts (DimonexChart).
   */
  public subscribeCandlesSeconds(
    pairId: string,
    resolution: ResolutionString,
    onBarSeconds: (bar: CandleSecondsBar) => void,
    subscriberUID: string,
    precisions?: { basePrecision?: number; quotePrecision?: number }
  ): () => void {
    const normalized = normalizePairSymbol(pairId);
    const basePrec = precisions?.basePrecision ?? 8;
    const quotePrec = precisions?.quotePrecision ?? 0;

    const symbolInfo: TVLibrarySymbolInfo = {
      ticker: normalized,
      name: normalized,
      full_name: `SILENTSMILE:${normalized}`,
      description: normalized,
      type: 'crypto',
      session: '24x7',
      timezone: 'Asia/Jakarta',
      exchange: 'SILENTSMILE',
      listed_exchange: 'SILENTSMILE',
      minmov: 1,
      pricescale: Math.pow(10, quotePrec),
      has_intraday: true,
      has_daily: true,
      supported_resolutions: [...SUPPORTED_RESOLUTIONS],
      volume_precision: basePrec,
      data_status: 'streaming',
      base_precision: basePrec,
      quote_precision: quotePrec,
    };

    this.subscribeBars(
      symbolInfo,
      resolution,
      (tvBar) => {
        onBarSeconds({
          time: Math.floor(tvBar.time / 1000),
          open: tvBar.open,
          high: tvBar.high,
          low: tvBar.low,
          close: tvBar.close,
          volume: tvBar.volume ?? 0,
        });
      },
      subscriberUID,
      () => {}
    );

    return () => {
      this.unsubscribeBars(subscriberUID);
    };
  }

  public destroy(): void {
    this.isDisposed = true;
    this.subscriptions.clear();
    this.subscribedTopics.clear();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      if (this.localTradeListener) {
        window.removeEventListener('silentsmile:trades-recorded', this.localTradeListener);
        this.localTradeListener = null;
      }
      if (this.localPairSyncListener) {
        window.removeEventListener('silentsmile:pair-synced', this.localPairSyncListener);
        this.localPairSyncListener = null;
      }
    }
    this.closeWebSocket();
  }

  private async fetchActivePairs(): Promise<BackendMarketPair[]> {
    const now = Date.now();
    if (this.pairsCache.length > 0 && now - this.pairsCacheAt < 15000) {
      return this.pairsCache;
    }

    const res = await this.fetchFn(`${this.apiBaseUrl}/api/market/pairs`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading market pairs`);
    }
    const json = await res.json();
    const pairs: BackendMarketPair[] = Array.isArray(json.pairs) ? json.pairs : [];
    this.pairsCache = pairs;
    this.pairsCacheAt = now;
    return pairs;
  }

  private resolveWsUrl(): string {
    if (this.wsUrlOverride) return this.wsUrlOverride;
    if (typeof window !== 'undefined' && window.location) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws`;
    }
    return 'ws://localhost:3000/ws';
  }

  private ensureWebSocketConnected(): void {
    if (this.isDisposed) return;
    if (this.ws && (this.ws.readyState === 1 || this.ws.readyState === 0)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const wsUrl = this.resolveWsUrl();
    this.setWsStatus(this.reconnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING');

    let socket: WebSocketLike;
    try {
      socket = this.wsFactory
        ? this.wsFactory(wsUrl)
        : (new WebSocket(wsUrl) as unknown as WebSocketLike);
      this.ws = socket;
    } catch {
      this.setWsStatus('ERROR');
      this.scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (this.ws !== socket || this.isDisposed) return;
      this.reconnectAttempt = 0;
      this.setWsStatus('CONNECTED');

      // Resubscribe all active topics on open / reconnect
      this.subscribedTopics.clear();
      for (const sub of this.subscriptions.values()) {
        this.sendTopicAction('subscribe', sub.klineTopic);
        this.sendTopicAction('subscribe', sub.tradeTopic);
      }
    };

    socket.onmessage = (evt) => {
      if (this.ws !== socket || this.isDisposed) return;
      try {
        const msg = JSON.parse(String(evt.data));
        this.handleWsMessage(msg);
      } catch {}
    };

    socket.onerror = () => {
      if (this.ws !== socket || this.isDisposed) return;
      this.setWsStatus('ERROR');
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.subscribedTopics.clear();

      if (this.isDisposed || this.subscriptions.size === 0) {
        this.setWsStatus('DISCONNECTED');
        return;
      }

      this.setWsStatus('RECONNECTING');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.isDisposed || this.subscriptions.size === 0 || this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 16000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureWebSocketConnected();
    }, delay);
  }

  private sendTopicAction(action: 'subscribe' | 'unsubscribe', topic: string): void {
    if (action === 'subscribe' && this.subscribedTopics.has(topic)) return;
    if (action === 'unsubscribe' && !this.subscribedTopics.has(topic)) return;

    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ action, topic }));
        if (action === 'subscribe') this.subscribedTopics.add(topic);
        else this.subscribedTopics.delete(topic);
      } catch {}
    }
  }

  private closeWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribedTopics.clear();
    if (this.ws) {
      const s = this.ws;
      this.ws = null;
      try {
        s.onopen = null;
        s.onmessage = null;
        s.onerror = null;
        s.onclose = null;
        s.close();
      } catch {}
    }
    this.setWsStatus('DISCONNECTED');
  }

  private markTradeIdSeen(streamKey: string, tradeId?: string): boolean {
    if (!tradeId) return false;
    const dedupeKey = `${streamKey}:${tradeId}`;
    if (this.seenStreamTradeIds.has(dedupeKey)) {
      return true;
    }
    if (this.seenStreamTradeIds.size >= DimonexDatafeed.MAX_SEEN_IDS) {
      const oldest = this.seenStreamTradeIds.values().next().value;
      if (oldest) this.seenStreamTradeIds.delete(oldest);
    }
    this.seenStreamTradeIds.add(dedupeKey);
    return false;
  }

  private handleWsMessage(msg: any): void {
    if (!msg || !msg.topic || !msg.data) return;

    const topic = String(msg.topic);

    // 1. Direct server-aggregated kline event: `kline:BTC/IDR:15m`
    if (topic.startsWith('kline:')) {
      const payload = msg.data;
      const candle = payload.candle;
      if (!candle) return;

      const streamKey = `${payload.pairId}:${payload.interval}`;
      if (this.markTradeIdSeen(streamKey, payload.tradeId)) {
        return; // Duplicate WS event ignored
      }

      const barSec: CandleSecondsBar = {
        time: Math.floor(Number(candle.time)),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume ?? 0),
        count: typeof candle.count === 'number' ? candle.count : undefined,
      };

      const prev = this.lastBarByStream.get(streamKey);
      if (prev && barSec.time < prev.time) {
        return; // Ignore out-of-order historical tick so active bar isn't rolled back
      }

      this.lastBarByStream.set(streamKey, barSec);
      const tvBar: TVBar = {
        time: barSec.time * 1000,
        open: barSec.open,
        high: barSec.high,
        low: barSec.low,
        close: barSec.close,
        volume: barSec.volume,
      };

      for (const sub of this.subscriptions.values()) {
        if (sub.klineTopic === topic) {
          sub.onTick(tvBar);
        }
      }
      return;
    }

    // 2. Trade stream fallback: `trade:BTC/IDR` (if trade wasn't already processed via `kline:*`)
    if (topic.startsWith('trade:')) {
      const trade = msg.data;
      const tradeId = trade.id ? String(trade.id) : undefined;
      const rawPrice = Number(trade.price);
      const rawAmount = Number(trade.amount);
      const tsMs = Number(trade.timestamp || Date.now());
      if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(rawAmount)) return;

      for (const sub of this.subscriptions.values()) {
        if (sub.tradeTopic !== topic) continue;

        const streamKey = `${sub.pairId}:${sub.interval}`;
        if (this.markTradeIdSeen(streamKey, tradeId)) {
          continue; // Already applied (either by kline:* or duplicate trade WS frame)
        }

        const price =
          sub.quotePrecision > 0 ? rawPrice / Math.pow(10, sub.quotePrecision) : rawPrice;
        const volumeDelta =
          sub.basePrecision > 0 ? rawAmount / Math.pow(10, sub.basePrecision) : rawAmount;

        const stepSec = INTERVAL_TO_SECONDS[sub.interval];
        const bucketSec = Math.floor(Math.floor(tsMs / 1000) / stepSec) * stepSec;
        const prev = this.lastBarByStream.get(streamKey);

        if (prev && bucketSec < prev.time) {
          continue; // Out-of-order stale trade
        }

        let nextBar: CandleSecondsBar;
        if (!prev || bucketSec > prev.time) {
          const openPrice = prev ? prev.close : price;
          nextBar = {
            time: bucketSec,
            open: openPrice,
            high: Math.max(openPrice, price),
            low: Math.min(openPrice, price),
            close: price,
            volume: volumeDelta,
          };
        } else {
          nextBar = {
            time: prev.time,
            open: prev.open,
            high: Math.max(prev.high, price),
            low: Math.min(prev.low, price),
            close: price,
            volume: prev.volume + volumeDelta,
          };
        }

        this.lastBarByStream.set(streamKey, nextBar);
        sub.onTick({
          time: nextBar.time * 1000,
          open: nextBar.open,
          high: nextBar.high,
          low: nextBar.low,
          close: nextBar.close,
          volume: nextBar.volume,
        });
      }
    }
  }

  /**
   * Instant local bridge for executed matching-engine trades already expressed in human units.
   * Deduplicates strictly by tradeId so WebSocket kline/trade frames never double-count.
   */
  public ingestLocalTrades(
    pairId: string,
    trades: Array<{ id?: string; pair?: string; price: number; amount: number; timestamp?: number }>
  ): void {
    if (this.isDisposed || !trades || trades.length === 0) return;
    const normalizedPair = normalizePairSymbol(pairId);

    for (const trade of trades) {
      const targetPair = normalizePairSymbol(trade.pair || normalizedPair);
      const price = Number(trade.price);
      const amount = Number(trade.amount);
      const tsMs = Number(trade.timestamp || Date.now());
      const tradeId = trade.id ? String(trade.id) : undefined;
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      for (const sub of this.subscriptions.values()) {
        if (sub.pairId !== targetPair) continue;

        const streamKey = `${sub.pairId}:${sub.interval}`;
        if (this.markTradeIdSeen(streamKey, tradeId)) {
          continue;
        }

        const stepSec = INTERVAL_TO_SECONDS[sub.interval];
        const bucketSec = Math.floor(Math.floor(tsMs / 1000) / stepSec) * stepSec;
        const prev = this.lastBarByStream.get(streamKey);

        if (prev && bucketSec < prev.time) {
          continue;
        }

        let nextBar: CandleSecondsBar;
        if (!prev || bucketSec > prev.time) {
          const openPrice = prev ? prev.close : price;
          nextBar = {
            time: bucketSec,
            open: openPrice,
            high: Math.max(openPrice, price),
            low: Math.min(openPrice, price),
            close: price,
            volume: amount,
          };
        } else {
          nextBar = {
            time: prev.time,
            open: prev.open,
            high: Math.max(prev.high, price),
            low: Math.min(prev.low, price),
            close: price,
            volume: prev.volume + amount,
          };
        }

        this.lastBarByStream.set(streamKey, nextBar);
        sub.onTick({
          time: nextBar.time * 1000,
          open: nextBar.open,
          high: nextBar.high,
          low: nextBar.low,
          close: nextBar.close,
          volume: nextBar.volume,
        });
      }
    }
  }
}

// ============================================================
// Technical Indicator Calculations (Genuine Client Computation)
// ============================================================

export function computeSMA(bars: CandleSecondsBar[], period: number): { time: number; value: number }[] {
  if (bars.length < period || period <= 0) return [];
  const out: { time: number; value: number }[] = [];
  let windowSum = 0;
  for (let i = 0; i < bars.length; i++) {
    windowSum += bars[i].close;
    if (i >= period) {
      windowSum -= bars[i - period].close;
    }
    if (i >= period - 1) {
      out.push({ time: bars[i].time, value: windowSum / period });
    }
  }
  return out;
}

export function computeEMA(bars: CandleSecondsBar[], period: number): { time: number; value: number }[] {
  if (bars.length < period || period <= 0) return [];
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].close;
  }
  let ema = sum / period;
  const out: { time: number; value: number }[] = [{ time: bars[period - 1].time, value: ema }];
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    out.push({ time: bars[i].time, value: ema });
  }
  return out;
}

export function computeBollingerBands(
  bars: CandleSecondsBar[],
  period: number = 20,
  stdDevMultiplier: number = 2
): {
  upper: { time: number; value: number }[];
  middle: { time: number; value: number }[];
  lower: { time: number; value: number }[];
} {
  if (bars.length < period || period <= 1) {
    return { upper: [], middle: [], lower: [] };
  }
  const upper: { time: number; value: number }[] = [];
  const middle: { time: number; value: number }[] = [];
  const lower: { time: number; value: number }[] = [];

  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += bars[i - j].close;
    }
    const mean = sum / period;
    let sqDiff = 0;
    for (let j = 0; j < period; j++) {
      const diff = bars[i - j].close - mean;
      sqDiff += diff * diff;
    }
    const std = Math.sqrt(sqDiff / period);
    const t = bars[i].time;
    middle.push({ time: t, value: mean });
    upper.push({ time: t, value: mean + stdDevMultiplier * std });
    lower.push({ time: t, value: mean - stdDevMultiplier * std });
  }

  return { upper, middle, lower };
}

export function computeRSI(bars: CandleSecondsBar[], period: number = 14): { time: number; value: number }[] {
  if (bars.length <= period || period <= 0) return [];
  const out: { time: number; value: number }[] = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out.push({ time: bars[period].time, value: firstRsi });

  for (let i = period + 1; i < bars.length; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: bars[i].time, value: rsi });
  }

  return out;
}

export function computeMACD(
  bars: CandleSecondsBar[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): {
  macd: { time: number; value: number }[];
  signal: { time: number; value: number }[];
  histogram: { time: number; value: number; color: string }[];
} {
  const fastEma = computeEMA(bars, fastPeriod);
  const slowEma = computeEMA(bars, slowPeriod);
  if (fastEma.length === 0 || slowEma.length === 0) {
    return { macd: [], signal: [], histogram: [] };
  }

  const fastMap = new Map<number, number>(fastEma.map((p) => [p.time, p.value]));
  const macdLine: { time: number; value: number }[] = [];

  for (const s of slowEma) {
    const fVal = fastMap.get(s.time);
    if (fVal !== undefined) {
      macdLine.push({ time: s.time, value: fVal - s.value });
    }
  }

  if (macdLine.length < signalPeriod) {
    return { macd: macdLine, signal: [], histogram: [] };
  }

  const k = 2 / (signalPeriod + 1);
  let sum = 0;
  for (let i = 0; i < signalPeriod; i++) sum += macdLine[i].value;
  let sig = sum / signalPeriod;

  const signalOut: { time: number; value: number }[] = [
    { time: macdLine[signalPeriod - 1].time, value: sig },
  ];
  const histOut: { time: number; value: number; color: string }[] = [
    {
      time: macdLine[signalPeriod - 1].time,
      value: macdLine[signalPeriod - 1].value - sig,
      color: macdLine[signalPeriod - 1].value - sig >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(244,63,94,0.55)',
    },
  ];

  for (let i = signalPeriod; i < macdLine.length; i++) {
    sig = macdLine[i].value * k + sig * (1 - k);
    const diff = macdLine[i].value - sig;
    signalOut.push({ time: macdLine[i].time, value: sig });
    histOut.push({
      time: macdLine[i].time,
      value: diff,
      color: diff >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(244,63,94,0.55)',
    });
  }

  return { macd: macdLine, signal: signalOut, histogram: histOut };
}

export function toHeikinAshi(bars: CandleSecondsBar[]): CandleSecondsBar[] {
  if (bars.length === 0) return [];
  const result: CandleSecondsBar[] = [];
  let prevOpen = (bars[0].open + bars[0].close) / 2;
  let prevClose = (bars[0].open + bars[0].high + bars[0].low + bars[0].close) / 4;

  result.push({
    time: bars[0].time,
    open: prevOpen,
    high: bars[0].high,
    low: bars[0].low,
    close: prevClose,
    volume: bars[0].volume,
    count: bars[0].count,
  });

  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = (prevOpen + prevClose) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);

    result.push({
      time: b.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: b.volume,
      count: b.count,
    });

    prevOpen = haOpen;
    prevClose = haClose;
  }

  return result;
}
