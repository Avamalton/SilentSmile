import { ExternalTicker } from '../../simulation/mmConsoleTypes';
import {
  ManagedWebSocketLike,
  WS_READY_STATE,
  WsClientMiddleware,
  WsSeveredEvent,
} from './wsClientMiddleware';

export type TickerCallback = (ticker: ExternalTicker) => void;
export type SeveredCallback = (event: WsSeveredEvent) => void;

export interface ExternalWsHandlerOptions {
  socketFactory?: (url: string) => ManagedWebSocketLike;
  initialRetryDelayMs?: number;
  backoffMultiplier?: number;
  maxRetryDelayMs?: number;
  severedThresholdMs?: number;
  watchdogIntervalMs?: number;
  heartbeatIntervalMs?: number;
  connectTimeoutMs?: number;
}

export class BinanceWsHandler {
  private symbols: string[] = [
    'btcusdt',
    'ethusdt',
    'solusdt',
    'bnbusdt',
    'dogeusdt',
    'xrpusdt',
    'adausdt',
    'avaxusdt',
    'linkusdt',
  ];
  private middleware: WsClientMiddleware;
  private lastMessageTime: number = 0;
  private lastLatencyMs: number = 35;
  private onTickerCallbacks: Set<TickerCallback> = new Set();
  private onSeveredCallbacks: Set<SeveredCallback> = new Set();

  constructor(symbols?: string[], options?: ExternalWsHandlerOptions) {
    if (symbols && symbols.length > 0) {
      this.symbols = symbols.map((s) => s.toLowerCase().replace(/[-_/]/g, ''));
    }

    this.middleware = new WsClientMiddleware({
      provider: 'binance',
      urlFactory: () => {
        const streamNames = this.symbols.map((s) => `${s}@bookTicker`).join('/');
        return `wss://stream.binance.com:9443/stream?streams=${streamNames}`;
      },
      socketFactory: options?.socketFactory,
      initialRetryDelayMs: options?.initialRetryDelayMs ?? 1000,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? 30000,
      severedThresholdMs: options?.severedThresholdMs ?? 5000,
      watchdogIntervalMs: options?.watchdogIntervalMs ?? 1000,
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 30000,
      connectTimeoutMs: options?.connectTimeoutMs ?? 8000,
      onOpen: () => {
        this.lastMessageTime = Date.now();
      },
      onMessage: (data: any) => {
        this.lastMessageTime = Date.now();
        try {
          const parsed = JSON.parse(data.toString());
          const payload = parsed.data || parsed;
          this.handleRawTicker(payload);
        } catch {}
      },
      onHeartbeat: (ws) => {
        if (ws.readyState === WS_READY_STATE.OPEN && typeof ws.ping === 'function') {
          ws.ping();
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

  public onTicker(cb: TickerCallback) {
    this.onTickerCallbacks.add(cb);
  }

  public removeTickerListener(cb: TickerCallback) {
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
      provider: 'binance' as const,
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

  private handleRawTicker(p: any) {
    if (!p || !p.s) return;
    const sym = String(p.s).toUpperCase();
    const bidPrice = parseFloat(p.b);
    const askPrice = parseFloat(p.a);
    if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || bidPrice <= 0 || askPrice <= 0) return;

    const midPrice = (bidPrice + askPrice) / 2;
    const now = Date.now();
    const eventTime = Number(p.E || p.T || 0);
    const latency = eventTime > 0 ? Math.max(1, now - eventTime) : 22;
    this.lastLatencyMs = latency;

    const ticker: ExternalTicker = {
      provider: 'binance',
      symbol: sym,
      bidPrice,
      askPrice,
      lastPrice: midPrice,
      volume24h: 1500000000,
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
