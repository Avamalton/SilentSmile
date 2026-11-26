import { executeOrder, cancelOrder, validateOrderFunds } from '../matchingEngine';
import { matchOrderAgainstCLOB, buildMMOrders, aggregateOrderBook } from '../clobEngine';
import { injectProgrammaticLimitOrders } from '../simulation-matching-engine';
import { BookOrder, MarketPair, MMConfig, UserBalance } from '../types';

/**
 * SilentSmile Exchange - Matching Engine, CLOB & MM Test Suite
 */
export function runMatchingEngineTests(): { total: number; passed: number; failures: string[] } {
  const failures: string[] = [];
  let total = 0;
  let passed = 0;

  const mockPair: MarketPair = {
    id: 'BTC/IDR',
    baseAsset: 'BTC',
    quoteAsset: 'IDR',
    name: 'Bitcoin / Rupiah',
    lastPrice: 1500000000,
    change24h: 2.5,
    high24h: 1520000000,
    low24h: 1480000000,
    volume24h: 50000000000,
    priceDecimals: 0,
    amountDecimals: 5,
    minOrderAmount: 0.0001,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: true,
  };

  const initialBalances: Record<string, UserBalance> = {
    IDR: { asset: 'IDR', free: 500000000, locked: 0, total: 500000000 },
    BTC: { asset: 'BTC', free: 0.5, locked: 0, total: 0.5 },
  };

  // Test 1: Validation rejects insufficient balance
  total++;
  const validationRes = validateOrderFunds('buy', 'limit', 1.0, 1500000000, mockPair, initialBalances);
  if (!validationRes.valid) {
    passed++;
  } else {
    failures.push('Test 1 Failed: Validation should reject buy order exceeding free IDR balance');
  }

  // Test 2: Validation rejects amount below minimum order size
  total++;
  const minRes = validateOrderFunds('buy', 'limit', 0.00001, 1500000000, mockPair, initialBalances);
  if (!minRes.valid) {
    passed++;
  } else {
    failures.push('Test 2 Failed: Validation should reject order below minimum order size');
  }

  // Test 3: Market buy immediately executes and settles balances
  total++;
  const buyRes = executeOrder('user_1', mockPair, 'buy', 'market', 0.1, 1500000000, initialBalances);
  if (
    buyRes.success &&
    buyRes.order.status === 'filled' &&
    buyRes.updatedBalances['BTC'].free > initialBalances['BTC'].free &&
    buyRes.updatedBalances['IDR'].free < initialBalances['IDR'].free
  ) {
    passed++;
  } else {
    failures.push('Test 3 Failed: Market buy should fill immediately and adjust balances');
  }

  // Test 4: Limit buy away from market reserves funds on book
  total++;
  const limitBuyRes = executeOrder('user_1', mockPair, 'buy', 'limit', 0.1, 1400000000, initialBalances);
  if (
    limitBuyRes.success &&
    limitBuyRes.order.status === 'open' &&
    limitBuyRes.updatedBalances['IDR'].locked > 0 &&
    limitBuyRes.updatedBalances['IDR'].free < initialBalances['IDR'].free
  ) {
    passed++;
  } else {
    failures.push('Test 4 Failed: Limit buy below market price should reserve locked funds on book');
  }

  // Test 5: Cancelling limit order restores locked funds to free balance
  total++;
  const cancelRes = cancelOrder(limitBuyRes.order, mockPair, limitBuyRes.updatedBalances);
  if (
    cancelRes.success &&
    cancelRes.updatedOrder.status === 'cancelled' &&
    cancelRes.updatedBalances['IDR'].locked === 0 &&
    cancelRes.updatedBalances['IDR'].free === initialBalances['IDR'].free
  ) {
    passed++;
  } else {
    failures.push('Test 5 Failed: Order cancellation should restore locked funds back to free balance');
  }

  // Test 6: CLOB Matching on DNA/IDR with Market Maker Liquidity
  total++;
  const dnaPair: MarketPair = {
    id: 'DNA/IDR',
    baseAsset: 'DNA',
    quoteAsset: 'IDR',
    name: 'Denata Network Asset',
    lastPrice: 14250,
    change24h: 5.2,
    high24h: 14800,
    low24h: 13900,
    volume24h: 1500000000,
    priceDecimals: 0,
    amountDecimals: 2,
    minOrderAmount: 1,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: true,
  };

  const mmConfig: MMConfig = {
    enabled: true,
    pair: 'DNA/IDR',
    targetSpreadBps: 30, // 0.3%
    levelsPerSide: 10,
    baseAmountPerLevel: 500,
    amountVariancePct: 20,
    tickSize: 25,
    allocatedIDR: 200000000,
    allocatedBase: 50000,
    wallBuyEnabled: true,
    wallBuyPrice: 13800,
    wallBuyAmount: 25000,
    wallSellEnabled: true,
    wallSellPrice: 14700,
    wallSellAmount: 25000,
    churnEnabled: true,
    churnIntervalMs: 3000,
    churnMinQty: 10,
    churnMaxQty: 100,
  };

  const dnaMMOrders = buildMMOrders(dnaPair, 14250, mmConfig);
  const book = aggregateOrderBook(dnaMMOrders, 'DNA/IDR', 'usr_trader_01');

  if (book.bids.length > 0 && book.asks.length > 0 && book.spread > 0) {
    passed++;
  } else {
    failures.push('Test 6 Failed: MM should build 2-sided order book with positive spread');
  }

  // Test 7: User Market Buy fills against real resting Ask in CLOB
  total++;
  const dnaBalances: Record<string, UserBalance> = {
    IDR: { asset: 'IDR', free: 50000000, locked: 0, total: 50000000 },
    DNA: { asset: 'DNA', free: 0, locked: 0, total: 0 },
  };

  const clobBuyResult = matchOrderAgainstCLOB(
    'usr_trader_01',
    dnaPair,
    'buy',
    'market',
    200,
    14250,
    [...dnaMMOrders],
    dnaBalances
  );

  if (
    clobBuyResult.success &&
    clobBuyResult.order.status === 'filled' &&
    clobBuyResult.trades.length > 0 &&
    clobBuyResult.updatedBalances['DNA'].free === 200
  ) {
    passed++;
  } else {
    failures.push('Test 7 Failed: Market buy in CLOB should fill against real resting MM asks');
  }

  // Test 8: User Limit Buy rests in book and is identified with myOrderAmount
  total++;
  const clobLimitResult = matchOrderAgainstCLOB(
    'usr_trader_01',
    dnaPair,
    'buy',
    'limit',
    1000,
    14100, // below best bid
    [...dnaMMOrders],
    dnaBalances
  );

  if (clobLimitResult.restingBookOrder) {
    const updatedBook = aggregateOrderBook(
      [...dnaMMOrders, clobLimitResult.restingBookOrder],
      'DNA/IDR',
      'usr_trader_01'
    );
    const myLevel = updatedBook.bids.find((b) => b.price === 14100);
    if (myLevel && myLevel.myOrderAmount === 1000) {
      passed++;
    } else {
      failures.push('Test 8 Failed: Resting order was not identified as user order in aggregated book');
    }
  } else {
    failures.push('Test 8 Failed: Limit buy below market should generate resting BookOrder');
  }

  // Test 9: Programmatic Limit Order Injection with Bot Balance Check
  total++;
  const botTestBalances: Record<string, UserBalance> = {
    IDR: { asset: 'IDR', free: 250000000, locked: 0, total: 250000000 },
    DNA: { asset: 'DNA', free: 100000, locked: 0, total: 100000 },
  };

  const injResult = injectProgrammaticLimitOrders({
    botUserId: 'bot_market_maker',
    pair: dnaPair,
    spreadPct: 0.35,
    orderFrequencySeconds: 2,
    orderAmountSize: 500,
    depthLevels: 8,
    botBalances: botTestBalances,
    restingOrders: [],
    orderLedger: [],
  });

  if (
    injResult.success &&
    injResult.placedOrders.length === 16 &&
    injResult.newBookOrders.length === 16 &&
    injResult.updatedBotBalances['IDR'].locked > 0 &&
    injResult.updatedBotBalances['DNA'].locked > 0
  ) {
    passed++;
  } else {
    failures.push('Test 9 Failed: Programmatic limit order injection should place real limit orders and reserve bot balances');
  }

  return { total, passed, failures };
}

import { describe, it, expect } from 'vitest';

describe('Legacy Matching Engine Verification', () => {
  it('passes all simulation matching engine regression tests', () => {
    const res = runMatchingEngineTests();
    expect(res.failures).toEqual([]);
    expect(res.passed).toBe(res.total);
  });

  it('ignores non-wall resting orders and respects isWall boundaries in buildMMOrders', () => {
    const auroraPair: MarketPair = {
      id: 'AURORA/IDR',
      baseAsset: 'AURORA',
      quoteAsset: 'IDR',
      name: 'Aurora Token / Rupiah',
      lastPrice: 1250000,
      change24h: 0,
      high24h: 1260000,
      low24h: 1240000,
      volume24h: 0,
      priceDecimals: 0,
      amountDecimals: 3,
      minOrderAmount: 0.01,
      makerFeeBps: 10,
      takerFeeBps: 15,
      isActive: true,
    };

    const existingBookOrders: BookOrder[] = [
      // Regular MM non-wall orders near midPrice should NOT block new quotes
      {
        id: 'mm_old_ask_1',
        userId: 'usr_mm_01',
        pair: 'AURORA/IDR',
        side: 'sell',
        price: 1240000,
        amount: 5,
        remainingAmount: 5,
        createdAt: Date.now(),
        isMM: true,
        isWall: false,
      },
      {
        id: 'mm_old_bid_1',
        userId: 'usr_mm_01',
        pair: 'AURORA/IDR',
        side: 'buy',
        price: 1260000,
        amount: 5,
        remainingAmount: 5,
        createdAt: Date.now(),
        isMM: true,
        isWall: false,
      },
      // True walls outside the spread MUST be respected
      {
        id: 'wall_buy_1',
        userId: 'usr_mm_01',
        pair: 'AURORA/IDR',
        side: 'buy',
        price: 1200000,
        amount: 100,
        remainingAmount: 100,
        createdAt: Date.now(),
        isMM: true,
        isWall: true,
      },
      {
        id: 'wall_sell_1',
        userId: 'usr_mm_01',
        pair: 'AURORA/IDR',
        side: 'sell',
        price: 1300000,
        amount: 100,
        remainingAmount: 100,
        createdAt: Date.now(),
        isMM: true,
        isWall: true,
      },
    ];

    const quotes = buildMMOrders(
      auroraPair,
      1250000,
      {
        targetSpreadBps: 40,
        levelsPerSide: 6,
        baseAmountPerLevel: 2.5,
        tickSize: 1000,
      },
      existingBookOrders
    );

    const bids = quotes.filter((q) => q.side === 'buy');
    const asks = quotes.filter((q) => q.side === 'sell');
    expect(bids.length).toBe(6);
    expect(asks.length).toBe(6);
    expect(Math.max(...bids.map((b) => b.price))).toBeLessThan(1250000);
    expect(Math.min(...asks.map((a) => a.price))).toBeGreaterThan(1250000);
    expect(bids.every((b) => b.price < 1300000)).toBe(true);
    expect(asks.every((a) => a.price > 1200000)).toBe(true);
  });
});

describe('OrderBook stability & non-crossing guarantees', () => {
  it('keeps buildMMOrders bids strictly descending and asks strictly ascending even with large jitter_price_pct', () => {
    const btcPair: MarketPair = {
      id: 'BTC/IDR',
      baseAsset: 'BTC',
      quoteAsset: 'IDR',
      name: 'Bitcoin / Rupiah',
      lastPrice: 1485600000,
      change24h: 0.5,
      high24h: 1500000000,
      low24h: 1470000000,
      volume24h: 10000000000,
      priceDecimals: 0,
      amountDecimals: 5,
      minOrderAmount: 0.0001,
      makerFeeBps: 10,
      takerFeeBps: 15,
      isActive: true,
    };

    const quotes = buildMMOrders(btcPair, 1485600000, {
      targetSpreadBps: 12,
      levelsPerSide: 10,
      baseAmountPerLevel: 0.05,
      tickSize: 50000,
      jitter_price_pct: 5, // Previously could scramble levels by ±297k vs 50k tick
    });

    const bids = quotes.filter((q) => q.side === 'buy').map((b) => b.price);
    const asks = quotes.filter((q) => q.side === 'sell').map((a) => a.price);
    expect(bids.length).toBe(10);
    expect(asks.length).toBe(10);
    for (let i = 1; i < bids.length; i++) {
      expect(bids[i]).toBeLessThan(bids[i - 1]);
    }
    for (let i = 1; i < asks.length; i++) {
      expect(asks[i]).toBeGreaterThan(asks[i - 1]);
    }
    expect(Math.max(...bids)).toBeLessThan(Math.min(...asks));
    expect(Math.max(...bids)).toBeLessThan(1485600000);
    expect(Math.min(...asks)).toBeGreaterThan(1485600000);
  });

  it('injectProgrammaticLimitOrders anchors near true bestBid/bestAsk mid rather than highest ask', () => {
    const pair: MarketPair = {
      id: 'ETH/IDR',
      baseAsset: 'ETH',
      quoteAsset: 'IDR',
      name: 'Ethereum / Rupiah',
      lastPrice: 36500000,
      change24h: 0.2,
      high24h: 37000000,
      low24h: 36000000,
      volume24h: 500000000,
      priceDecimals: 0,
      amountDecimals: 4,
      minOrderAmount: 0.001,
      makerFeeBps: 10,
      takerFeeBps: 15,
      isActive: true,
    };

    const seedOrders: BookOrder[] = [
      { id: 'b1', userId: 'u1', pair: 'ETH/IDR', side: 'buy', price: 36490000, amount: 1, remainingAmount: 1, createdAt: 1 },
      { id: 'a1', userId: 'u2', pair: 'ETH/IDR', side: 'sell', price: 36510000, amount: 1, remainingAmount: 1, createdAt: 1 },
      { id: 'a_far', userId: 'u3', pair: 'ETH/IDR', side: 'sell', price: 50000000, amount: 1, remainingAmount: 1, createdAt: 1 },
    ];

    const res = injectProgrammaticLimitOrders({
      pair,
      botUserId: 'mm_test',
      botBalances: {
        IDR: { asset: 'IDR', free: 5000000000, locked: 0, total: 5000000000 },
        ETH: { asset: 'ETH', free: 100, locked: 0, total: 100 },
      },
      restingOrders: seedOrders,
      orderLedger: [],
      spreadPct: 0.2,
      depthLevels: 5,
      orderAmountSize: 0.5,
      tickSize: 10000,
      clearExistingBotOrders: false,
    });

    const mmAsks = res.newBookOrders.filter((o) => o.side === 'sell').map((o) => o.price);
    const minMMAsk = Math.min(...mmAsks);
    // Previously bestAsk picked 50,000,000 instead of 36,510,000, jumping minMMAsk to ~43M
    expect(minMMAsk).toBeLessThan(37000000);
  });
});

