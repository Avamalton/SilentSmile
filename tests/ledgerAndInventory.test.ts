import { describe, it, expect, beforeEach } from 'vitest';
import { LedgerService } from '../src/simulation/ledgerService';
import { UserBalance } from '../src/simulation/types';

describe('Tahap 3 - Ledger, Balance, Reservation & MM Inventory Service', () => {
  beforeEach(() => {
    LedgerService.clearHistory();
  });

  const createInitialBalances = (): Record<string, Record<string, UserBalance>> => ({
    usr_treasury_01: {
      USDT: { asset: 'USDT', free: 1000000, locked: 0, total: 1000000 },
      BTC: { asset: 'BTC', free: 100, locked: 0, total: 100 },
      ETH: { asset: 'ETH', free: 500, locked: 0, total: 500 },
    },
    usr_mm_01: {
      USDT: { asset: 'USDT', free: 5000, locked: 0, total: 5000 },
      BTC: { asset: 'BTC', free: 0.5, locked: 0, total: 0.5 },
    },
    usr_trader_01: {
      USDT: { asset: 'USDT', free: 10000, locked: 0, total: 10000 },
      BTC: { asset: 'BTC', free: 1.0, locked: 0, total: 1.0 },
    },
  });

  it('allocates virtual treasury to MM with valid double-entry balance updates', () => {
    const initial = createInitialBalances();
    const result = LedgerService.allocateTreasuryToMM({
      sourceAccount: 'usr_treasury_01',
      targetMMAccount: 'usr_mm_01',
      asset: 'USDT',
      amount: 50000,
      listingId: 'list_eth_usdt_01',
      actorId: 'admin_sys',
      idempotencyKey: 'alloc_001',
      userBalancesMap: initial,
    });

    expect(result.success).toBe(true);
    expect(result.transaction).toBeDefined();
    expect(result.transaction?.status).toBe('POSTED');

    // Treasury was debited
    expect(result.updatedBalancesMap.usr_treasury_01.USDT.free).toBe(950000);
    expect(result.updatedBalancesMap.usr_treasury_01.USDT.total).toBe(950000);

    // MM was credited
    expect(result.updatedBalancesMap.usr_mm_01.USDT.free).toBe(55000);
    expect(result.updatedBalancesMap.usr_mm_01.USDT.total).toBe(55000);

    // Uninvolved trader untouched
    expect(result.updatedBalancesMap.usr_trader_01.USDT.free).toBe(10000);

    // Check reconciliation
    const recon = LedgerService.reconcileLedger(initial, [result.transaction!], result.updatedBalancesMap);
    expect(recon.isReconciled).toBe(true);
    expect(recon.mismatches).toHaveLength(0);
  });

  it('enforces idempotency and rejects duplicate allocations', () => {
    const initial = createInitialBalances();
    const result1 = LedgerService.allocateTreasuryToMM({
      sourceAccount: 'usr_treasury_01',
      targetMMAccount: 'usr_mm_01',
      asset: 'BTC',
      amount: 5,
      listingId: 'list_btc_usdt_01',
      actorId: 'admin_sys',
      idempotencyKey: 'alloc_btc_001',
      userBalancesMap: initial,
    });
    expect(result1.success).toBe(true);

    // Attempt second allocation with same idempotency key
    const result2 = LedgerService.allocateTreasuryToMM({
      sourceAccount: 'usr_treasury_01',
      targetMMAccount: 'usr_mm_01',
      asset: 'BTC',
      amount: 5,
      listingId: 'list_btc_usdt_01',
      actorId: 'admin_sys',
      idempotencyKey: 'alloc_btc_001',
      userBalancesMap: result1.updatedBalancesMap,
    });

    expect(result2.success).toBe(false);
    expect(result2.error).toContain('Duplicate transaction detected');
    // Balance must not have changed further
    expect(result2.updatedBalancesMap.usr_treasury_01.BTC.free).toBe(95);
  });

  it('rejects allocation when treasury has insufficient free balance', () => {
    const initial = createInitialBalances();
    const result = LedgerService.allocateTreasuryToMM({
      sourceAccount: 'usr_treasury_01',
      targetMMAccount: 'usr_mm_01',
      asset: 'BTC',
      amount: 99999, // Way more than 100 BTC
      listingId: 'list_btc_usdt_01',
      actorId: 'admin_sys',
      idempotencyKey: 'alloc_excess',
      userBalancesMap: initial,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient available funds in treasury');
  });

  it('isolates user orders and trades strictly by user account ID', () => {
    const allOrders = [
      { id: 'ord_1', userId: 'usr_trader_01', symbol: 'BTC-USDT', side: 'BUY' },
      { id: 'ord_2', userId: 'usr_mm_01', symbol: 'BTC-USDT', side: 'SELL' },
      { id: 'ord_3', userId: 'usr_trader_02', symbol: 'ETH-USDT', side: 'BUY' },
      { id: 'ord_4', userId: 'usr_trader_01', symbol: 'ETH-USDT', side: 'SELL' },
    ];

    const trader1Orders = LedgerService.filterOrdersByUser(allOrders, 'usr_trader_01');
    expect(trader1Orders.map((o) => o.id)).toEqual(['ord_1', 'ord_4']);

    const mmOrders = LedgerService.filterOrdersByUser(allOrders, 'usr_mm_01');
    expect(mmOrders.map((o) => o.id)).toEqual(['ord_2']);

    const allTrades = [
      {
        id: 'trd_1',
        makerUserId: 'usr_mm_01',
        takerUserId: 'usr_trader_01',
        makerOrderId: 'ord_2',
        takerOrderId: 'ord_1',
        price: 65000,
      },
      {
        id: 'trd_2',
        makerUserId: 'usr_mm_01',
        takerUserId: 'usr_trader_02',
        makerOrderId: 'ord_2',
        takerOrderId: 'ord_3',
        price: 65100,
      },
      {
        id: 'trd_3',
        makerUserId: 'usr_trader_03',
        takerUserId: 'usr_trader_04',
        makerOrderId: 'ord_x',
        takerOrderId: 'ord_y',
        price: 3500,
      },
    ];

    const trader1OrderIds = new Set(trader1Orders.map((o) => o.id));
    const trader1Trades = LedgerService.filterTradesByUser(allTrades, 'usr_trader_01', trader1OrderIds);

    expect(trader1Trades).toHaveLength(1);
    expect(trader1Trades[0].id).toBe('trd_1');

    const mmOrderIds = new Set(mmOrders.map((o) => o.id));
    const mmTrades = LedgerService.filterTradesByUser(allTrades, 'usr_mm_01', mmOrderIds);
    expect(mmTrades).toHaveLength(2);
    expect(mmTrades.map((t) => t.id)).toEqual(['trd_1', 'trd_2']);
  });
});
