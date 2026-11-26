export interface CoinGeckoUsdtQuote {
  idrPrice: number;
  usdPrice: number;
  lastUpdated: number;
  fetchedAt: number;
}

export interface CoinGeckoUsdtStatus {
  provider: 'coingecko';
  status: 'IDLE' | 'ACTIVE' | 'BACKOFF' | 'ERROR';
  lastQuote: CoinGeckoUsdtQuote | null;
  lastFetchAt: number | null;
  lastError: string | null;
  consecutiveErrors: number;
  nextRetryAt: number | null;
}

export interface CoinGeckoUsdtServiceOptions {
  fetchFn?: typeof fetch;
  endpointUrl?: string;
  timeoutMs?: number;
  minRefreshIntervalMs?: number;
  backoffMs?: number;
}

const DEFAULT_COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr,usd&include_last_updated_at=true';

export class CoinGeckoUsdtService {
  private readonly fetchFn: typeof fetch;
  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private readonly minRefreshIntervalMs: number;
  private readonly backoffMs: number;

  private lastQuote: CoinGeckoUsdtQuote | null = null;
  private lastFetchAt: number | null = null;
  private lastError: string | null = null;
  private consecutiveErrors: number = 0;
  private nextRetryAt: number | null = null;
  private inFlightPromise: Promise<CoinGeckoUsdtQuote | null> | null = null;

  constructor(options?: CoinGeckoUsdtServiceOptions) {
    this.fetchFn = options?.fetchFn || fetch;
    this.endpointUrl = options?.endpointUrl || DEFAULT_COINGECKO_URL;
    this.timeoutMs = Math.max(1000, options?.timeoutMs ?? 5000);
    this.minRefreshIntervalMs = Math.max(1000, options?.minRefreshIntervalMs ?? 30000);
    this.backoffMs = Math.max(5000, options?.backoffMs ?? 120000);
  }

  public getLatestQuote(): CoinGeckoUsdtQuote | null {
    return this.lastQuote ? { ...this.lastQuote } : null;
  }

  public getStatus(): CoinGeckoUsdtStatus {
    const now = Date.now();
    let status: CoinGeckoUsdtStatus['status'] = 'IDLE';
    if (this.nextRetryAt && now < this.nextRetryAt) {
      status = 'BACKOFF';
    } else if (this.lastError && !this.lastQuote) {
      status = 'ERROR';
    } else if (this.lastQuote) {
      status = 'ACTIVE';
    }

    return {
      provider: 'coingecko',
      status,
      lastQuote: this.getLatestQuote(),
      lastFetchAt: this.lastFetchAt,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors,
      nextRetryAt: this.nextRetryAt,
    };
  }

  /**
   * Fetches latest Tether (USDT) price in IDR & USD from CoinGecko public API.
   * Respects minRefreshIntervalMs & rate-limit backoff, and keeps the last valid
   * quote cached if CoinGecko temporarily errors.
   */
  public async fetchUsdtPrice(force: boolean = false): Promise<CoinGeckoUsdtQuote | null> {
    const now = Date.now();

    if (this.nextRetryAt && now < this.nextRetryAt) {
      return this.getLatestQuote();
    }

    if (!force && this.lastQuote && this.lastFetchAt && now - this.lastFetchAt < this.minRefreshIntervalMs) {
      return this.getLatestQuote();
    }

    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = this.performFetch().finally(() => {
      this.inFlightPromise = null;
    });

    return this.inFlightPromise;
  }

  private async performFetch(): Promise<CoinGeckoUsdtQuote | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(this.endpointUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SilentSmileExchange/1.0',
        },
        signal: controller.signal,
      });

      this.lastFetchAt = Date.now();

      if (response.status === 429) {
        this.consecutiveErrors += 1;
        this.lastError = 'CoinGecko rate limited (HTTP 429)';
        this.nextRetryAt = Date.now() + this.backoffMs;
        return this.getLatestQuote();
      }

      if (!response.ok) {
        this.consecutiveErrors += 1;
        this.lastError = `CoinGecko HTTP ${response.status}`;
        if (this.consecutiveErrors >= 3) {
          this.nextRetryAt = Date.now() + this.backoffMs;
        }
        return this.getLatestQuote();
      }

      const payload: any = await response.json();
      const tether = payload?.tether;
      const rawIdr = Number(tether?.idr);
      const rawUsd = Number(tether?.usd);
      const rawUpdatedSec = Number(tether?.last_updated_at);

      if (!Number.isFinite(rawIdr) || rawIdr < 10000 || rawIdr > 25000) {
        this.consecutiveErrors += 1;
        this.lastError = `Invalid CoinGecko USDT/IDR price: ${tether?.idr}`;
        return this.getLatestQuote();
      }

      const validUsd = Number.isFinite(rawUsd) && rawUsd >= 0.5 && rawUsd <= 1.5 ? rawUsd : 1.0;
      const now = Date.now();
      const lastUpdated =
        Number.isFinite(rawUpdatedSec) && rawUpdatedSec > 0 ? rawUpdatedSec * 1000 : now;

      this.lastQuote = {
        idrPrice: Math.round(rawIdr * 100) / 100,
        usdPrice: Math.round(validUsd * 10000) / 10000,
        lastUpdated,
        fetchedAt: now,
      };
      this.lastError = null;
      this.consecutiveErrors = 0;
      this.nextRetryAt = null;

      return this.getLatestQuote();
    } catch (err: any) {
      this.lastFetchAt = Date.now();
      this.consecutiveErrors += 1;
      this.lastError = err?.name === 'AbortError' ? 'CoinGecko request timeout' : (err?.message || 'CoinGecko fetch error');
      if (this.consecutiveErrors >= 3) {
        this.nextRetryAt = Date.now() + Math.min(this.backoffMs, 60000);
      }
      return this.getLatestQuote();
    } finally {
      clearTimeout(timer);
    }
  }
}
