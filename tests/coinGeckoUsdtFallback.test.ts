import { describe, it, expect, vi } from 'vitest';
import { CoinGeckoUsdtService } from '../src/server/workers/coinGeckoUsdtService';
import { PriceAggregatorWorker } from '../src/server/workers/priceAggregatorWorker';
import { ExternalTicker } from '../src/simulation/mmConsoleTypes';

function createMockWsHandler() {
  const tickerListeners = new Set<(t: ExternalTicker) => void>();
  const severedListeners = new Set<() => void>();
  return {
    onTicker: (cb: (t: ExternalTicker) => void) => tickerListeners.add(cb),
    removeTickerListener: (cb: (t: ExternalTicker) => void) => tickerListeners.delete(cb),
    onSevered: (cb: () => void) => severedListeners.add(cb),
    emitTicker: (t: ExternalTicker) => {
      tickerListeners.forEach((cb) => cb(t));
    },
    start: vi.fn(),
    stop: vi.fn(),
    evaluateConnectionHealth: vi.fn(),
    getStatus: () => ({
      provider: 'binance' as const,
      status: 'DISCONNECTED',
      readyState: 3,
      symbolsTracked: [],
      lastMessageTime: 0,
      latencyMs: 0,
      lastError: null,
      retryAttempt: 0,
      nextRetryDelayMs: 0,
      totalErrors: 0,
      severedSince: null,
      severedDurationMs: 0,
      isSeveredTooLong: false,
      fallbackActive: false,
    }),
  };
}

describe('CoinGecko USDT Fallback Service & Aggregator Integration', () => {
  it('fetches and validates USDT IDR & USD prices from CoinGecko', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tether: {
          idr: 16342.5,
          usd: 1.0002,
          last_updated_at: Math.floor(Date.now() / 1000),
        },
      }),
    } as unknown as Response);

    const service = new CoinGeckoUsdtService({ fetchFn: mockFetch as any });
    const quote = await service.fetchUsdtPrice(true);

    expect(quote).not.toBeNull();
    expect(quote!.idrPrice).toBe(16342.5);
    expect(quote!.usdPrice).toBe(1.0002);
    expect(service.getStatus().status).toBe('ACTIVE');
  });

  it('retains last valid quote when CoinGecko returns HTTP 429 or invalid data', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tether: { idr: 16410, usd: 0.9999 },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({}),
      } as unknown as Response);

    const service = new CoinGeckoUsdtService({
      fetchFn: mockFetch as any,
      minRefreshIntervalMs: 1000,
      backoffMs: 60000,
    });

    const first = await service.fetchUsdtPrice(true);
    expect(first?.idrPrice).toBe(16410);

    const afterRateLimit = await service.fetchUsdtPrice(true);
    expect(afterRateLimit?.idrPrice).toBe(16410);
    expect(service.getStatus().status).toBe('BACKOFF');
    expect(service.getStatus().lastError).toContain('429');
  });

  it('updates PriceAggregatorWorker USDTIDR & USDTUSD using CoinGecko fallback when Binance/Bybit lacks USDTIDR', async () => {
    const binance = createMockWsHandler();
    const bybit = createMockWsHandler();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tether: {
          idr: 16488,
          usd: 1.0001,
          last_updated_at: Math.floor(Date.now() / 1000),
        },
      }),
    } as unknown as Response);

    const cg = new CoinGeckoUsdtService({ fetchFn: mockFetch as any });
    const aggregator = new PriceAggregatorWorker(binance as any, bybit as any, {
      coinGeckoService: cg,
    });

    const fx = await aggregator.refreshUsdtFromCoinGecko(true);
    expect(fx.source).toBe('COINGECKO_FEED');
    expect(fx.usdtIdrRate).toBe(16488);

    const usdtIdr = aggregator.getAggregatedPrice('USDTIDR');
    expect(usdtIdr).toBeDefined();
    expect(usdtIdr!.finalPrice).toBe(16488);
    expect(usdtIdr!.primaryProvider).toBe('coingecko');
    expect(usdtIdr!.status).toBe('FRESH');

    const usdtUsd = aggregator.getAggregatedPrice('USDTUSD');
    expect(usdtUsd).toBeDefined();
    expect(usdtUsd!.finalPrice).toBe(1.0001);
    expect(usdtUsd!.primaryProvider).toBe('coingecko');
  });

  it('preserves active MANUAL_ADMIN FX override and direct exchange USDTIDR feed priority over CoinGecko fallback', async () => {
    const binance = createMockWsHandler();
    const bybit = createMockWsHandler();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tether: { idr: 16500, usd: 1.0 },
      }),
    } as unknown as Response);

    const cg = new CoinGeckoUsdtService({ fetchFn: mockFetch as any });
    const aggregator = new PriceAggregatorWorker(binance as any, bybit as any, {
      coinGeckoService: cg,
    });

    // Admin sets explicit manual override
    aggregator.setFxRate(16900, 'MANUAL_ADMIN', 'usr_admin_01');
    const fxAfterCg = await aggregator.refreshUsdtFromCoinGecko(true);
    expect(fxAfterCg.source).toBe('MANUAL_ADMIN');
    expect(fxAfterCg.usdtIdrRate).toBe(16900);
    expect(aggregator.getAggregatedPrice('USDTIDR')?.primaryProvider).toBe('manual');

    // If Binance emits a live USDTIDR ticker, live exchange ticker wins over fallback
    binance.emitTicker({
      provider: 'binance',
      symbol: 'USDTIDR',
      lastPrice: 16520,
      bidPrice: 16518,
      askPrice: 16522,
      volume24h: 500000,
      timestamp: Date.now(),
      latencyMs: 25,
    });
    const liveFeed = aggregator.getAggregatedPrice('USDTIDR');
    expect(liveFeed?.primaryProvider).toBe('binance');
    expect(liveFeed?.finalPrice).toBe(16520);
  });
});
