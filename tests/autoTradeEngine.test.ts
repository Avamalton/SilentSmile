import { describe, it, expect } from 'vitest';
import { executeAutoTradeTick } from '../src/simulation/autoTradeEngine';
import { AutoTradeConfig, BookOrder, MarketPair, UserBalance } from '../src/simulation/types';

const mockPair: MarketPair = {
  id: 'DNA/IDR',
  baseAsset: 'DNA',
  quoteAsset: 'IDR',
  name: 'DNA / Rupiah',
  lastPrice: 14000,
  change24h: 1.0,
  high24h: 14500,
  low24h: 13800,
  volume24h: 100000000,
  priceDecimals: 0,
  amountDecimals: 2,
  minOrderAmount: 1,
  makerFeeBps: 10,
  takerFeeBps: 15,
  isActive: true,
};

const baseAutoConfig: AutoTradeConfig = {
  enabled: true,
  targetPair: 'DNA/IDR',
  targetVolume: 5000,
  accumulatedVolume: 0,
  minOrderSize: 10,
  maxOrderSize: 50,
  intervalSeconds: 3,
  executionMode: 'buy_first',
  trendStrategy: 'trend_up',
  autoStopOnTarget: true,
};

describe('Auto Trade Bot Engine', () => {
  it('returns NO_LIQUIDITY when no opposite-side resting orders exist in CLOB', () => {
    // Only buy orders exist in CLOB, but bot wants to buy
    const restingBidsOnly: BookOrder[] = [
      {
        id: 'bid_1',
        userId: 'other_user',
        pair: 'DNA/IDR',
        side: 'buy',
        price: 13900,
        amount: 100,
        remainingAmount: 100,
        createdAt: Date.now(),
      },
    ];

    const balancesMap: Record<string, Record<string, UserBalance>> = {
      usr_mm_01: {
        IDR: { asset: 'IDR', free: 1000000000, locked: 0, total: 1000000000 },
        DNA: { asset: 'DNA', free: 10000, locked: 0, total: 10000 },
      },
    };

    // Bot configured to buy_first (needs asks)
    const result = executeAutoTradeTick(
      baseAutoConfig,
      mockPair,
      restingBidsOnly,
      balancesMap,
      'usr_mm_01'
    );

    expect(result.executed).toBe(false);
    expect(result.reason).toBe('NO_LIQUIDITY');
  });

  it('halts execution when target volume is reached and autoStopOnTarget is true', () => {
    const configReached: AutoTradeConfig = {
      ...baseAutoConfig,
      targetVolume: 1000,
      accumulatedVolume: 1000,
    };

    const result = executeAutoTradeTick(
      configReached,
      mockPair,
      [],
      {},
      'usr_mm_01'
    );

    expect(result.executed).toBe(false);
    expect(result.reason).toBe('TARGET_VOLUME_REACHED');
  });

  it('prevents execution when market is halted / inactive', () => {
    const haltedPair: MarketPair = { ...mockPair, isActive: false };

    const result = executeAutoTradeTick(
      baseAutoConfig,
      haltedPair,
      [],
      {},
      'usr_mm_01'
    );

    expect(result.executed).toBe(false);
    expect(result.reason).toBe('MARKET_HALTED');
  });

  it('executes strictly against real counterparty resting order and updates volume', () => {
    const restingAsk: BookOrder = {
      id: 'ask_counterpart',
      userId: 'external_seller',
      pair: 'DNA/IDR',
      side: 'sell',
      price: 14000,
      amount: 50,
      remainingAmount: 50,
      createdAt: Date.now(),
    };

    const balancesMap: Record<string, Record<string, UserBalance>> = {
      usr_mm_01: {
        IDR: { asset: 'IDR', free: 50000000, locked: 0, total: 50000000 },
        DNA: { asset: 'DNA', free: 0, locked: 0, total: 0 },
      },
      external_seller: {
        IDR: { asset: 'IDR', free: 0, locked: 0, total: 0 },
        DNA: { asset: 'DNA', free: 0, locked: 50, total: 50 },
      },
    };

    const result = executeAutoTradeTick(
      baseAutoConfig,
      mockPair,
      [restingAsk],
      balancesMap,
      'usr_mm_01'
    );

    expect(result.executed).toBe(true);
    expect(result.trade).toBeDefined();
    expect(result.trade?.price).toBe(14000);
    expect(result.accumulatedVolumeDelta).toBeGreaterThan(0);
    expect(result.accumulatedVolumeDelta).toBeLessThanOrEqual(50);
  });

  it('executes multiple pair configs independently across different order books without state interference', () => {
    const btcPair: MarketPair = {
      id: 'BTC/IDR',
      baseAsset: 'BTC',
      quoteAsset: 'IDR',
      name: 'Bitcoin / Rupiah',
      lastPrice: 1320000000,
      change24h: 0.5,
      high24h: 1350000000,
      low24h: 1300000000,
      volume24h: 5000000000,
      priceDecimals: 0,
      amountDecimals: 6,
      minOrderAmount: 0.0001,
      makerFeeBps: 10,
      takerFeeBps: 15,
      isActive: true,
    };

    const restingOrders: BookOrder[] = [
      {
        id: 'ask_dna_1',
        userId: 'maker_a',
        pair: 'DNA/IDR',
        side: 'sell',
        price: 14000,
        amount: 100,
        remainingAmount: 100,
        createdAt: Date.now(),
      },
      {
        id: 'bid_btc_1',
        userId: 'maker_b',
        pair: 'BTC/IDR',
        side: 'buy',
        price: 1320000000,
        amount: 0.25,
        remainingAmount: 0.25,
        createdAt: Date.now(),
      },
    ];

    const balancesMap: Record<string, Record<string, UserBalance>> = {
      usr_autotrader_01: {
        IDR: { asset: 'IDR', free: 5000000000, locked: 0, total: 5000000000 },
        DNA: { asset: 'DNA', free: 10000, locked: 0, total: 10000 },
        BTC: { asset: 'BTC', free: 5, locked: 0, total: 5 },
      },
      maker_a: {
        IDR: { asset: 'IDR', free: 0, locked: 0, total: 0 },
        DNA: { asset: 'DNA', free: 0, locked: 100, total: 100 },
      },
      maker_b: {
        IDR: { asset: 'IDR', free: 0, locked: 500000000, total: 500000000 },
        BTC: { asset: 'BTC', free: 0, locked: 0, total: 0 },
      },
    };

    const dnaBot: AutoTradeConfig = { ...baseAutoConfig, id: 'bot_dna', targetPair: 'DNA/IDR', executionMode: 'buy_first' };
    const btcBot: AutoTradeConfig = {
      ...baseAutoConfig,
      id: 'bot_btc',
      targetPair: 'BTC/IDR',
      executionMode: 'sell_first',
      minOrderSize: 0.01,
      maxOrderSize: 0.05,
      targetVolume: 1,
    };

    // Chained multi-pair execution as performed by SimulationProvider scheduler
    const r1 = executeAutoTradeTick(dnaBot, mockPair, restingOrders, balancesMap, 'usr_autotrader_01');
    expect(r1.executed).toBe(true);
    expect(r1.trade?.pair).toBe('DNA/IDR');

    const r2 = executeAutoTradeTick(btcBot, btcPair, r1.updatedRestingOrders, r1.updatedBalancesMap, 'usr_autotrader_01');
    expect(r2.executed).toBe(true);
    expect(r2.trade?.pair).toBe('BTC/IDR');
    expect(r2.accumulatedVolumeDelta).toBeGreaterThanOrEqual(0.01);
    expect(r2.accumulatedVolumeDelta).toBeLessThanOrEqual(0.05);
  });
});
