import { describe, it, expect } from 'vitest';
import { executeOrderAgainstCLOB, cancelRestingOrderAndUnlockBalance } from '../src/simulation/settlementEngine';
import { BookOrder, MarketPair, UserBalance } from '../src/simulation/types';

const mockPair: MarketPair = {
  id: 'DNA/IDR',
  baseAsset: 'DNA',
  quoteAsset: 'IDR',
  name: 'DNA / Rupiah',
  lastPrice: 14000,
  change24h: 2.5,
  high24h: 15000,
  low24h: 13500,
  volume24h: 500000000,
  priceDecimals: 0,
  amountDecimals: 2,
  minOrderAmount: 1,
  makerFeeBps: 10, // 0.10%
  takerFeeBps: 15, // 0.15%
  isActive: true,
};

describe('Order Settlement Engine', () => {
  it('places a limit order and locks the correct balance', () => {
    const restingOrders: BookOrder[] = [];
    const balancesMap: Record<string, Record<string, UserBalance>> = {
      user_1: {
        IDR: { asset: 'IDR', free: 10000000, locked: 0, total: 10000000 },
        DNA: { asset: 'DNA', free: 0, locked: 0, total: 0 },
      },
    };

    const result = executeOrderAgainstCLOB(
      'user_1',
      mockPair,
      'buy',
      'limit',
      100, // 100 DNA @ 14000 = 1,400,000 IDR
      14000,
      restingOrders,
      balancesMap
    );

    expect(result.success).toBe(true);
    expect(result.updatedRestingOrders.length).toBe(1);
    const resting = result.updatedRestingOrders[0];
    expect(resting.remainingAmount).toBe(100);

    const userBal = result.updatedUserBalancesMap['user_1'];
    // Total locked should be >= 1,400,000 IDR (including fee reserve)
    expect(userBal['IDR'].locked).toBeGreaterThanOrEqual(1400000);
    expect(userBal['IDR'].free).toBeLessThan(10000000);
    expect(userBal['IDR'].total).toBe(userBal['IDR'].free + userBal['IDR'].locked);
  });

  it('rejects order when user has insufficient balance', () => {
    const balancesMap: Record<string, Record<string, UserBalance>> = {
      user_1: {
        IDR: { asset: 'IDR', free: 500, locked: 0, total: 500 }, // Only 500 IDR
        DNA: { asset: 'DNA', free: 0, locked: 0, total: 0 },
      },
    };

    const result = executeOrderAgainstCLOB(
      'user_1',
      mockPair,
      'buy',
      'limit',
      100,
      14000,
      [],
      balancesMap
    );

    expect(result.success).toBe(false);
    expect(result.order.status).toBe('rejected');
    expect(result.message).toContain('Insufficient');
  });

  it('atomically executes a match and settles both buyer and seller balances', () => {
    // Maker has an active Ask (selling 50 DNA @ 14000)
    const restingAsk: BookOrder = {
      id: 'ask_1',
      userId: 'maker_user',
      pair: 'DNA/IDR',
      side: 'sell',
      price: 14000,
      amount: 50,
      remainingAmount: 50,
      createdAt: Date.now() - 5000,
      isFrozen: true,
      frozenFunds: 50,
    };

    const balancesMap: Record<string, Record<string, UserBalance>> = {
      taker_user: {
        IDR: { asset: 'IDR', free: 5000000, locked: 0, total: 5000000 },
        DNA: { asset: 'DNA', free: 0, locked: 0, total: 0 },
      },
      maker_user: {
        IDR: { asset: 'IDR', free: 0, locked: 0, total: 0 },
        DNA: { asset: 'DNA', free: 10, locked: 50, total: 60 }, // 50 locked in ask_1
      },
    };

    const result = executeOrderAgainstCLOB(
      'taker_user',
      mockPair,
      'buy',
      'limit',
      50,
      14000,
      [restingAsk],
      balancesMap
    );

    expect(result.success).toBe(true);
    expect(result.trades.length).toBe(1);
    expect(result.order.status).toBe('filled');

    // Taker received 50 DNA
    const takerBal = result.updatedUserBalancesMap['taker_user'];
    expect(takerBal['DNA'].free).toBe(50);
    // Taker IDR debited (50 * 14000 = 700000 + fee)
    expect(takerBal['IDR'].free).toBeLessThanOrEqual(5000000 - 700000);

    // Maker had locked DNA consumed
    const makerBal = result.updatedUserBalancesMap['maker_user'];
    expect(makerBal['DNA'].locked).toBe(0);
    // Maker received IDR proceeds (700000 - maker fee)
    expect(makerBal['IDR'].free).toBeGreaterThan(695000);

    // Fee event generated
    expect(result.feeEvents.length).toBe(1);
    expect(result.feeEvents[0].makerFee).toBeGreaterThan(0);
    expect(result.feeEvents[0].takerFee).toBeGreaterThan(0);
  });

  it('releases locked reservation exactly once upon order cancellation', () => {
    const restingOrder: BookOrder = {
      id: 'ord_cancel_test',
      userId: 'user_1',
      pair: 'DNA/IDR',
      side: 'buy',
      price: 14000,
      amount: 10,
      remainingAmount: 10,
      createdAt: Date.now(),
    };

    const balancesMap: Record<string, Record<string, UserBalance>> = {
      user_1: {
        IDR: { asset: 'IDR', free: 1000000, locked: 140140, total: 1140140 },
        DNA: { asset: 'DNA', free: 0, locked: 0, total: 0 },
      },
    };

    const res = cancelRestingOrderAndUnlockBalance('ord_cancel_test', [restingOrder], balancesMap, 10);
    expect(res.success).toBe(true);
    expect(res.updatedRestingOrders.length).toBe(0);

    const userBal = res.updatedBalancesMap['user_1'];
    expect(userBal['IDR'].locked).toBe(0);
    expect(userBal['IDR'].free).toBe(1140140);
  });
});
