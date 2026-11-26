import { WebSocket } from 'ws';

export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type WsConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export interface ManagedWebSocketLike {
  readyState: number;
  on(event: string, listener: (...args: any[]) => void): any;
  removeAllListeners?(event?: string): any;
  send(data: any, cb?: (err?: Error) => void): any;
  ping?(data?: any, mask?: boolean, cb?: (err?: Error) => void): any;
  terminate?(): any;
  close?(code?: number, data?: string | Buffer): any;
}

export interface WsErrorContext {
  phase: 'connect' | 'socket' | 'unexpected-response' | 'send' | 'heartbeat' | 'watchdog';
  readyState: number | null;
  attempt: number;
  severedDurationMs: number;
  timestamp: number;
}

export interface WsSeveredEvent {
  provider: string;
  severedSince: number;
  severedDurationMs: number;
  lastError: string | null;
}

export interface WsMiddlewareMetrics {
  provider: string;
  status: WsConnectionStatus;
  readyState: number | null;
  retryAttempt: number;
  nextRetryDelayMs: number;
  totalErrors: number;
  totalReconnects: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastOpenAt: number | null;
  lastMessageAt: number;
  severedSince: number | null;
  severedDurationMs: number;
  isSeveredTooLong: boolean;
}

export interface WsClientMiddlewareOptions {
  provider: string;
  urlFactory: () => string;
  socketFactory?: (url: string) => ManagedWebSocketLike;
  initialRetryDelayMs?: number;
  backoffMultiplier?: number;
  maxRetryDelayMs?: number;
  severedThresholdMs?: number;
  watchdogIntervalMs?: number;
  heartbeatIntervalMs?: number;
  connectTimeoutMs?: number;
  onOpen?: (ws: ManagedWebSocketLike) => void;
  onMessage?: (data: any) => void;
  onHeartbeat?: (ws: ManagedWebSocketLike) => void;
  onError?: (err: Error, context: WsErrorContext) => void;
  onSeveredTooLong?: (event: WsSeveredEvent) => void;
  onRecover?: (info: { provider: string; timestamp: number }) => void;
}

export class WsClientMiddleware {
  private readonly provider: string;
  private readonly urlFactory: () => string;
  private readonly socketFactory: (url: string) => ManagedWebSocketLike;
  private readonly initialRetryDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly maxRetryDelayMs: number;
  private readonly severedThresholdMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly connectTimeoutMs: number;

  private readonly onOpenCb?: (ws: ManagedWebSocketLike) => void;
  private readonly onMessageCb?: (data: any) => void;
  private readonly onHeartbeatCb?: (ws: ManagedWebSocketLike) => void;
  private readonly onErrorCb?: (err: Error, context: WsErrorContext) => void;
  private readonly onSeveredTooLongCb?: (event: WsSeveredEvent) => void;
  private readonly onRecoverCb?: (info: { provider: string; timestamp: number }) => void;

  private ws: ManagedWebSocketLike | null = null;
  private isRunning = false;
  private status: WsConnectionStatus = 'DISCONNECTED';

  private retryAttempt = 0;
  private nextRetryDelayMs: number;
  private totalErrors = 0;
  private totalReconnects = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private lastOpenAt: number | null = null;
  private lastMessageAt = 0;
  private connectingStartedAt: number | null = null;
  private severedSince: number | null = null;
  private isSeveredTooLong = false;

  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(options: WsClientMiddlewareOptions) {
    this.provider = options.provider;
    this.urlFactory = options.urlFactory;
    this.socketFactory =
      options.socketFactory ||
      ((url: string) =>
        new WebSocket(url, {
          handshakeTimeout: options.connectTimeoutMs ?? 8000,
        }) as unknown as ManagedWebSocketLike);

    this.initialRetryDelayMs = Math.max(50, options.initialRetryDelayMs ?? 1000);
    this.backoffMultiplier = Math.max(1.1, options.backoffMultiplier ?? 2);
    this.maxRetryDelayMs = Math.max(this.initialRetryDelayMs, options.maxRetryDelayMs ?? 30000);
    this.severedThresholdMs = Math.max(100, options.severedThresholdMs ?? 5000);
    this.watchdogIntervalMs = Math.max(50, options.watchdogIntervalMs ?? 1000);
    this.heartbeatIntervalMs = Math.max(500, options.heartbeatIntervalMs ?? 20000);
    this.connectTimeoutMs = Math.max(200, options.connectTimeoutMs ?? 10000);
    this.nextRetryDelayMs = this.initialRetryDelayMs;

    this.onOpenCb = options.onOpen;
    this.onMessageCb = options.onMessage;
    this.onHeartbeatCb = options.onHeartbeat;
    this.onErrorCb = options.onError;
    this.onSeveredTooLongCb = options.onSeveredTooLong;
    this.onRecoverCb = options.onRecover;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const now = Date.now();
    this.severedSince = now;
    this.isSeveredTooLong = false;
    this.startWatchdog();
    this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.clearWatchdogTimer();
    this.cleanupSocket(true);
    this.status = 'DISCONNECTED';
    this.connectingStartedAt = null;
    this.severedSince = null;
    this.isSeveredTooLong = false;
    this.retryAttempt = 0;
    this.nextRetryDelayMs = this.initialRetryDelayMs;
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public getReadyState(): number | null {
    return this.ws ? this.ws.readyState : null;
  }

  public getCurrentSocket(): ManagedWebSocketLike | null {
    return this.ws;
  }

  public safeSend(data: string | Buffer): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_READY_STATE.OPEN) {
      const stateLabel = ws ? ws.readyState : 'null';
      this.handleSocketError(
        new Error(`WebSocket send aborted (${this.provider}): readyState=${stateLabel} is not OPEN`),
        'send'
      );
      return false;
    }

    try {
      ws.send(data, (err?: Error) => {
        if (err) {
          this.handleSocketError(err, 'send');
        }
      });
      return true;
    } catch (err: any) {
      this.handleSocketError(err instanceof Error ? err : new Error(String(err)), 'send');
      return false;
    }
  }

  /**
   * Evaluates socket readyState & severed duration. Called automatically by the watchdog
   * and can also be invoked synchronously for immediate health checks.
   */
  public evaluateHealth(now: number = Date.now()): WsMiddlewareMetrics {
    if (!this.isRunning) {
      return this.getMetrics(now);
    }

    const readyState = this.ws ? this.ws.readyState : null;
    if (readyState !== WS_READY_STATE.OPEN) {
      if (this.severedSince === null) {
        this.severedSince = now;
      }

      // Detect stalled CONNECTING sockets that never open or emit error
      if (
        this.ws &&
        readyState === WS_READY_STATE.CONNECTING &&
        this.connectingStartedAt !== null &&
        now - this.connectingStartedAt > this.connectTimeoutMs
      ) {
        this.handleSocketError(
          new Error(`WebSocket handshake timeout (${this.provider}) after ${now - this.connectingStartedAt}ms`),
          'watchdog'
        );
      } else if (!this.reconnectTimer && (!this.ws || readyState === WS_READY_STATE.CLOSING || readyState === WS_READY_STATE.CLOSED)) {
        // Trigger exponential backoff retry whenever readyState is not OPEN and no retry is queued
        this.status = 'RECONNECTING';
        this.scheduleReconnect();
      }

      const severedDurationMs = Math.max(0, now - (this.severedSince ?? now));
      if (severedDurationMs > this.severedThresholdMs) {
        this.isSeveredTooLong = true;
        try {
          this.onSeveredTooLongCb?.({
            provider: this.provider,
            severedSince: this.severedSince ?? now,
            severedDurationMs,
            lastError: this.lastError,
          });
        } catch {}
      }
    } else {
      this.severedSince = null;
      this.isSeveredTooLong = false;
    }

    return this.getMetrics(now);
  }

  public getMetrics(now: number = Date.now()): WsMiddlewareMetrics {
    const readyState = this.ws ? this.ws.readyState : null;
    const isSevered = this.isRunning && readyState !== WS_READY_STATE.OPEN;
    const severedDurationMs =
      isSevered && this.severedSince !== null ? Math.max(0, now - this.severedSince) : 0;

    return {
      provider: this.provider,
      status: this.status,
      readyState,
      retryAttempt: this.retryAttempt,
      nextRetryDelayMs: this.nextRetryDelayMs,
      totalErrors: this.totalErrors,
      totalReconnects: this.totalReconnects,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastOpenAt: this.lastOpenAt,
      lastMessageAt: this.lastMessageAt,
      severedSince: isSevered ? this.severedSince : null,
      severedDurationMs,
      isSeveredTooLong: isSevered && (this.isSeveredTooLong || severedDurationMs > this.severedThresholdMs),
    };
  }

  public computeBackoffDelay(attempt: number = this.retryAttempt): number {
    const raw = this.initialRetryDelayMs * Math.pow(this.backoffMultiplier, Math.max(0, attempt));
    return Math.min(Math.round(raw), this.maxRetryDelayMs);
  }

  private connect(): void {
    if (!this.isRunning) return;

    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.cleanupSocket(true);

    const now = Date.now();
    this.status = this.retryAttempt > 0 ? 'RECONNECTING' : 'CONNECTING';
    this.connectingStartedAt = now;
    if (this.severedSince === null) {
      this.severedSince = now;
    }

    let ws: ManagedWebSocketLike;
    try {
      const url = this.urlFactory();
      ws = this.socketFactory(url);
      this.ws = ws;
    } catch (err: any) {
      this.handleSocketError(
        err instanceof Error ? err : new Error(err?.message || `Failed to initialize ${this.provider} WebSocket`),
        'connect'
      );
      return;
    }

    this.attachSocketListeners(ws);

    // If a custom/mock socket was created already in a failed/closed readyState, trigger recovery immediately
    if (ws.readyState === WS_READY_STATE.CLOSING || ws.readyState === WS_READY_STATE.CLOSED) {
      this.handleSocketError(
        new Error(`WebSocket (${this.provider}) initialized in non-OPEN readyState=${ws.readyState}`),
        'connect'
      );
    }
  }

  private attachSocketListeners(ws: ManagedWebSocketLike): void {
    ws.on('open', () => {
      if (this.ws !== ws) return;
      if (!this.isRunning) {
        this.cleanupSocket(true);
        return;
      }

      const now = Date.now();
      const wasSevered = this.severedSince !== null;

      this.status = 'CONNECTED';
      this.connectingStartedAt = null;
      this.lastOpenAt = now;
      this.lastMessageAt = now;
      this.lastError = null;
      this.retryAttempt = 0;
      this.nextRetryDelayMs = this.initialRetryDelayMs;
      this.severedSince = null;
      this.isSeveredTooLong = false;
      this.clearReconnectTimer();

      this.startHeartbeat(ws);

      try {
        this.onOpenCb?.(ws);
      } catch (err: any) {
        this.handleSocketError(err instanceof Error ? err : new Error(String(err)), 'socket');
        return;
      }

      if (wasSevered) {
        try {
          this.onRecoverCb?.({ provider: this.provider, timestamp: now });
        } catch {}
      }
    });

    ws.on('message', (data: any) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      try {
        this.onMessageCb?.(data);
      } catch (err: any) {
        this.handleSocketError(err instanceof Error ? err : new Error(String(err)), 'socket');
      }
    });

    ws.on('unexpected-response', (_req: any, res: any) => {
      if (this.ws !== ws) return;
      const statusCode = res?.statusCode ?? 'unknown';
      try {
        res?.resume?.();
      } catch {}
      this.handleSocketError(
        new Error(`Unexpected HTTP ${statusCode} response from ${this.provider} stream`),
        'unexpected-response'
      );
    });

    ws.on('error', (err: any) => {
      if (this.ws !== ws) return;
      const normalized = err instanceof Error ? err : new Error(err?.message || `${this.provider} WebSocket error`);
      this.handleSocketError(normalized, 'socket');
    });

    ws.on('close', (code?: number, reason?: Buffer | string) => {
      if (this.ws !== ws) return;
      this.clearHeartbeatTimer();
      this.connectingStartedAt = null;
      this.ws = null;

      if (!this.isRunning) {
        this.status = 'DISCONNECTED';
        return;
      }

      if (this.severedSince === null) {
        this.severedSince = Date.now();
      }
      if (!this.lastError && code && code !== 1000) {
        const reasonStr = reason ? reason.toString() : '';
        this.lastError = `Socket closed (code ${code}${reasonStr ? `: ${reasonStr}` : ''})`;
      }
      this.status = 'RECONNECTING';
      this.scheduleReconnect();
    });
  }

  private handleSocketError(err: Error, phase: WsErrorContext['phase']): void {
    const now = Date.now();
    const readyState = this.ws ? this.ws.readyState : null;

    this.totalErrors += 1;
    this.lastError = err.message || `${this.provider} WebSocket error`;
    this.lastErrorAt = now;
    this.connectingStartedAt = null;

    if (this.severedSince === null) {
      this.severedSince = now;
    }

    const severedDurationMs = Math.max(0, now - this.severedSince);

    try {
      this.onErrorCb?.(err, {
        phase,
        readyState,
        attempt: this.retryAttempt,
        severedDurationMs,
        timestamp: now,
      });
    } catch {}

    this.clearHeartbeatTimer();

    // Terminate unhealthy socket if not OPEN (or on socket/unexpected-response failure)
    if (this.ws && (phase !== 'send' || this.ws.readyState !== WS_READY_STATE.OPEN)) {
      this.cleanupSocket(true);
    }

    if (!this.isRunning) {
      this.status = 'DISCONNECTED';
      return;
    }

    this.status = 'RECONNECTING';
    if (!this.ws || this.ws.readyState !== WS_READY_STATE.OPEN) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning || this.reconnectTimer) return;
    if (this.ws && this.ws.readyState === WS_READY_STATE.OPEN) return;

    const delayMs = this.computeBackoffDelay(this.retryAttempt);
    this.retryAttempt += 1;
    this.totalReconnects += 1;
    this.nextRetryDelayMs = this.computeBackoffDelay(this.retryAttempt);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private startHeartbeat(ws: ManagedWebSocketLike): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isRunning || this.ws !== ws) return;
      if (ws.readyState !== WS_READY_STATE.OPEN) {
        this.handleSocketError(
          new Error(`Heartbeat detected non-OPEN readyState=${ws.readyState} for ${this.provider}`),
          'heartbeat'
        );
        return;
      }

      try {
        if (this.onHeartbeatCb) {
          this.onHeartbeatCb(ws);
        } else if (typeof ws.ping === 'function') {
          ws.ping();
        }
      } catch (err: any) {
        this.handleSocketError(err instanceof Error ? err : new Error(String(err)), 'heartbeat');
      }
    }, this.heartbeatIntervalMs);
  }

  private startWatchdog(): void {
    this.clearWatchdogTimer();
    this.watchdogTimer = setInterval(() => {
      this.evaluateHealth(Date.now());
    }, this.watchdogIntervalMs);
  }

  private cleanupSocket(terminate: boolean): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    try {
      ws.removeAllListeners?.();
    } catch {}

    if (terminate && ws.readyState !== WS_READY_STATE.CLOSED) {
      try {
        if (typeof ws.terminate === 'function') {
          ws.terminate();
        } else if (typeof ws.close === 'function') {
          ws.close();
        }
      } catch {}
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearWatchdogTimer(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
