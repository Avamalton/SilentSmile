import { ExternalTicker } from '../../simulation/mmConsoleTypes';
import { ExternalWsHandlerOptions, SeveredCallback } from './binanceWsHandler';
import { WS_READY_STATE, WsClientMiddleware } from './wsClientMiddleware';

export type BybitTickerCallback = (ticker: ExternalTicker) => void;

export class BybitWsHandler {
  private url: string = 'wss://stream.bybit.com/v5/public/spot';
  private symbols: string[] = [
    'BTCUSDT',
    'ETHUSDT',
    'SOLUSDT',
    'BNBUSDT',
    'DOGEUSDT',
    'XRPUSDT',
    'ADAUSDT',
    'AVAXUSDT',
    'LINKUSDT',
  ];
  private middleware: WsClientMiddleware;
  private lastMessageTime: number = 0;
  private lastLatencyMs: number = 42;
  private onTickerCallbacks: Set<BybitTickerCallback> = new Set();
  private onSeveredCallbacks: Set<SeveredCallback> = new Set();

  constructor(symbols?: string[], options?: ExternalWsHandlerOptions) {
    if (symbols && symbols.length > 0) {
      this.symbols = symbols.map((s) => s.toUpperCase().replace(/[-_/]/g, ''));
    }

    this.middleware = new WsClientMiddleware({
      provider: 'bybit',
      urlFactory: () => this.url,
      socketFactory: options?.socketFactory,
      initialRetryDelayMs: options?.initialRetryDelayMs ?? 1000,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? 30000,
      severedThresholdMs: options?.severedThresholdMs ?? 5000,
      watchdogIntervalMs: options?.watchdogIntervalMs ?? 1000,
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 20000,
      connectTimeoutMs: options?.connectTimeoutMs ?? 8000,
      onOpen: () => {
        this.lastMessageTime = Date.now();
        const subscribeMsg = {
          op: 'subscribe',
          args: this.symbols.map((sym) => `tickers.${sym}`),
        };
        this.middleware.safeSend(JSON.stringify(subscribeMsg));
      },
      onMessage: (data: any) => {
        this.lastMessageTime = Date.now();
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.topic && parsed.topic.startsWith('tickers.') && parsed.data) {
            this.handleBybitTicker(parsed.data, parsed.ts);
          }
        } catch {}
      },
      onHeartbeat: (ws) => {
        if (ws.readyState === WS_READY_STATE.OPEN) {
          this.middleware.safeSend(JSON.stringify({ op: 'ping' }));
        }
      },
      onSeveredTooLong: (event) => {
        for (const cb of this.onSeveredCallbacks) {
          try {
            cb(event);
          } catch {}
        }
      },
    });
  }

  public onTicker(cb: BybitTickerCallback) {
    this.onTickerCallbacks.add(cb);
  }

  public removeTickerListener(cb: BybitTickerCallback) {
    this.onTickerCallbacks.delete(cb);
  }

  public onSevered(cb: SeveredCallback) {
    this.onSeveredCallbacks.add(cb);
  }

  public removeSeveredListener(cb: SeveredCallback) {
    this.onSeveredCallbacks.delete(cb);
  }

  public getMiddleware(): WsClientMiddleware {
    return this.middleware;
  }

  public evaluateConnectionHealth(now: number = Date.now()) {
    return this.middleware.evaluateHealth(now);
  }

  public getStatus() {
    const metrics = this.middleware.getMetrics();
    return {
      provider: 'bybit' as const,
      status: metrics.status,
      readyState: metrics.readyState,
      symbolsTracked: this.symbols,
      lastMessageTime: this.lastMessageTime,
      latencyMs: this.lastLatencyMs,
      lastError: metrics.lastError,
      retryAttempt: metrics.retryAttempt,
      nextRetryDelayMs: metrics.nextRetryDelayMs,
      totalErrors: metrics.totalErrors,
      severedSince: metrics.severedSince,
      severedDurationMs: metrics.severedDurationMs,
      isSeveredTooLong: metrics.isSeveredTooLong,
      fallbackActive: false,
    };
  }

  public start() {
    this.middleware.start();
  }

  public stop() {
    this.middleware.stop();
  }

  private handleBybitTicker(d: any, ts?: number) {
    if (!d || !d.symbol) return;
    const sym = String(d.symbol).toUpperCase();
    const lastPriceRaw = parseFloat(d.lastPrice);
    const bidPrice = parseFloat(d.bid1Price) || lastPriceRaw * 0.9998;
    const askPrice = parseFloat(d.ask1Price) || lastPriceRaw * 1.0002;
    const lastPrice = lastPriceRaw || (bidPrice + askPrice) / 2;
    if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || !Number.isFinite(lastPrice)) return;
    if (bidPrice <= 0 || askPrice <= 0 || lastPrice <= 0) return;

    const now = Date.now();
    const latency = ts && Number.isFinite(Number(ts)) ? Math.max(1, now - Number(ts)) : 28;
    this.lastLatencyMs = latency;

    const ticker: ExternalTicker = {
      provider: 'bybit',
      symbol: sym,
      bidPrice,
      askPrice,
      lastPrice,
      volume24h: parseFloat(d.volume24h) || 890000000,
      timestamp: now,
      latencyMs: latency,
    };

    for (const cb of this.onTickerCallbacks) {
      try {
        cb(ticker);
      } catch {}
    }
  }
}
