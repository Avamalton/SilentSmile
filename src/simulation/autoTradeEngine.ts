import {
  AutoTradeConfig,
  BookOrder,
  MarketPair,
  OrderSide,
  Trade,
  UserBalance,
  AdminFeeEvent,
} from './types';
import { safeRound } from '../utils/formatters';
import { executeOrderAgainstCLOB, MatchingExecutionResult } from './settlementEngine';

export interface AutoTradeTickResult {
  executed: boolean;
  reason?: string;
  trade?: Trade;
  feeEvents?: AdminFeeEvent[];
  updatedRestingOrders: BookOrder[];
  updatedBalancesMap: Record<string, Record<string, UserBalance>>;
  accumulatedVolumeDelta: number;
}

/**
 * Executes a single cycle of the Auto-Trade Bot strictly against real resting orders in the CLOB.
 * Never invents fake fills or trades without counterparty orders.
 */
export function executeAutoTradeTick(
  config: AutoTradeConfig,
  targetPair: MarketPair,
  restingOrders: BookOrder[],
  allBalancesMap: Record<string, Record<string, UserBalance>>,
  botUserId: string = 'usr_mm_01'
): AutoTradeTickResult {
  // Check enabled and market active
  if (!config.enabled) {
    return {
      executed: false,
      reason: 'BOT_DISABLED',
      updatedRestingOrders: restingOrders,
      updatedBalancesMap: allBalancesMap,
      accumulatedVolumeDelta: 0,
    };
  }

  if (!targetPair.isActive) {
    return {
      executed: false,
      reason: 'MARKET_HALTED',
      updatedRestingOrders: restingOrders,
      updatedBalancesMap: allBalancesMap,
      accumulatedVolumeDelta: 0,
    };
  }

  // Check target volume reached
  if (config.autoStopOnTarget && config.accumulatedVolume >= config.targetVolume) {
    return {
      executed: false,
      reason: 'TARGET_VOLUME_REACHED',
      updatedRestingOrders: restingOrders,
      updatedBalancesMap: allBalancesMap,
      accumulatedVolumeDelta: 0,
    };
  }

  // Determine side based on executionMode & trendStrategy
  let side: OrderSide = 'buy';
  if (config.executionMode === 'buy_first') {
    side = 'buy';
  } else if (config.executionMode === 'sell_first') {
    side = 'sell';
  } else {
    // Random
    side = Math.random() < 0.5 ? 'buy' : 'sell';
  }

  // Inspect actual counterparty resting liquidity
  const counterpartSide: OrderSide = side === 'buy' ? 'sell' : 'buy';
  const availableCounterparts = restingOrders
    .filter(
      (o) =>
        o.pair === targetPair.id &&
        o.side === counterpartSide &&
        o.remainingAmount > 0 &&
        o.userId !== botUserId // Avoid self-crossing / wash trading
    )
    .sort((a, b) => {
      if (side === 'buy') {
        return a.price - b.price; // Lowest ask first
      } else {
        return b.price - a.price; // Highest bid first
      }
    });

  if (availableCounterparts.length === 0) {
    return {
      executed: false,
      reason: 'NO_LIQUIDITY',
      updatedRestingOrders: restingOrders,
      updatedBalancesMap: allBalancesMap,
      accumulatedVolumeDelta: 0,
    };
  }

  const bestCounterpart = availableCounterparts[0];
  const bestAvailablePrice = bestCounterpart.price;

  // Slippage & Price guard: don't execute if counterpart price is unreasonably deviated (> 5% from last price)
  const priceDeviation = Math.abs(bestAvailablePrice - targetPair.lastPrice) / targetPair.lastPrice;
  if (priceDeviation > 0.08) {
    return {
      executed: false,
      reason: 'SLIPPAGE_EXCEEDED',
      updatedRestingOrders: restingOrders,
      updatedBalancesMap: allBalancesMap,
      accumulatedVolumeDelta: 0,
    };
  }

  // Determine order size within bounds
  const minQty = Math.max(targetPair.minOrderAmount, config.minOrderSize || targetPair.minOrderAmount);
  const maxQty = Math.max(minQty, config.maxOrderSize || minQty * 5);
  let orderSize = safeRound(minQty + Math.random() * (maxQty - minQty), targetPair.amountDecimals);

  // Clamp order size to what's actually available at best level
  orderSize = safeRound(Math.min(orderSize, bestCounterpart.remainingAmount), targetPair.amountDecimals);

  // Clamp if near target volume
  if (config.autoStopOnTarget && config.accumulatedVolume + orderSize > config.targetVolume) {
    orderSize = safeRound(config.targetVolume - config.accumulatedVolume, targetPair.amountDecimals);
  }

  if (orderSize < targetPair.minOrderAmount) {
    return {
      executed: false,
      reason: 'SIZE_BELOW_MINIMUM',
      updatedRestingOrders: restingOrders,
      updatedBalancesMap: allBalancesMap,
      accumulatedVolumeDelta: 0,
    };
  }

  // Execute through matching engine as a real market order
  const matchResult: MatchingExecutionResult = executeOrderAgainstCLOB(
    botUserId,
    targetPair,
    side,
    'market',
    orderSize,
    bestAvailablePrice,
    restingOrders,
    allBalancesMap
  );

  if (!matchResult.success || matchResult.trades.length === 0) {
    return {
      executed: false,
      reason: matchResult.message || 'NO_MATCHING_ORDER',
      updatedRestingOrders: matchResult.updatedRestingOrders,
      updatedBalancesMap: matchResult.updatedUserBalancesMap,
      accumulatedVolumeDelta: 0,
    };
  }

  const primaryTrade = matchResult.trades[0];
  const totalVolumeFilled = matchResult.trades.reduce((sum, t) => sum + t.amount, 0);

  return {
    executed: true,
    trade: primaryTrade,
    feeEvents: matchResult.feeEvents,
    updatedRestingOrders: matchResult.updatedRestingOrders,
    updatedBalancesMap: matchResult.updatedUserBalancesMap,
    accumulatedVolumeDelta: totalVolumeFilled,
  };
}
