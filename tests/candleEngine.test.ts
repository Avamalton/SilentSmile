import { describe, it, expect, beforeEach } from 'vitest';
import { marketDataService } from '../src/simulation/marketDataService';
import { Trade } from '../src/simulation/types';

describe('Historical Candlestick Engine', () => {
  beforeEach(() => {
    marketDataService.resetHistory();
  });

  it('preserves earlier candles when a new trade arrives', () => {
    const pair = 'DNA/IDR';
    const initialCandles = marketDataService.getCandles(pair, '15m', 14250);
    const initialCount = initialCandles.length;
    expect(initialCount).toBeGreaterThan(10);

    const now = Date.now();
    const trade: Trade = {
      id: 'test_trd_1',
      pair,
      price: 14500,
      amount: 100,
      total: 1450000,
      side: 'buy',
      timestamp: now,
    };

    marketDataService.processTrade(trade);
    const updatedCandles = marketDataService.getCandles(pair, '15m', 14250);

    // Candle count must either be same (updated last) or incremented (new interval), never reset to 1
    expect(updatedCandles.length).toBeGreaterThanOrEqual(initialCount);
    const lastCandle = updatedCandles[updatedCandles.length - 1];
    expect(lastCandle.close).toBe(14500);
  });

  it('aggregates multiple trades in the same interval correctly (OHLCV)', () => {
    const pair = 'BTC/IDR';
    const now = Date.now();

    const t1: Trade = { id: 't1', pair, price: 1400000000, amount: 0.1, total: 140000000, side: 'buy', timestamp: now };
    const t2: Trade = { id: 't2', pair, price: 1450000000, amount: 0.2, total: 290000000, side: 'buy', timestamp: now + 500 };
    const t3: Trade = { id: 't3', pair, price: 1380000000, amount: 0.15, total: 207000000, side: 'sell', timestamp: now + 1000 };
    const t4: Trade = { id: 't4', pair, price: 1420000000, amount: 0.05, total: 71000000, side: 'buy', timestamp: now + 1500 };

    marketDataService.processTrade(t1);
    marketDataService.processTrade(t2);
    marketDataService.processTrade(t3);
    marketDataService.processTrade(t4);

    const candles = marketDataService.getCandles(pair, '15m', 1400000000);
    const latest = candles[candles.length - 1];

    expect(latest.high).toBeGreaterThanOrEqual(1450000000);
    expect(latest.low).toBeLessThanOrEqual(1380000000);
    expect(latest.close).toBe(1420000000);
  });

  it('creates a new candle when trade occurs in a new interval', () => {
    const pair = 'ETH/IDR';
    const now = Date.now();
    const t1: Trade = { id: 't1', pair, price: 50000000, amount: 1, total: 50000000, side: 'buy', timestamp: now };
    marketDataService.processTrade(t1);

    const candlesBefore = marketDataService.getCandles(pair, '15m', 50000000);
    const countBefore = candlesBefore.length;

    // Advance by 16 minutes (960 seconds), crossing into the next interval
    const t2: Trade = { id: 't2', pair, price: 52000000, amount: 1.5, total: 78000000, side: 'buy', timestamp: now + 960 * 1000 };
    marketDataService.processTrade(t2);

    const candlesAfter = marketDataService.getCandles(pair, '15m', 50000000);
    expect(candlesAfter.length).toBeGreaterThan(countBefore);
  });

  it('maintains independent, isolated histories across different trading pairs', () => {
    const btcCandles = marketDataService.getCandles('BTC/IDR', '15m', 1485600000);
    const dnaCandles = marketDataService.getCandles('DNA/IDR', '15m', 14250);

    expect(btcCandles[btcCandles.length - 1].close).toBeGreaterThan(1000000000);
    expect(dnaCandles[dnaCandles.length - 1].close).toBeLessThan(100000);
  });

  it('guarantees strictly ascending timestamps for all historical candles', () => {
    const candles = marketDataService.getCandles('DNA/IDR', '15m', 14250);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
    }
  });
});
