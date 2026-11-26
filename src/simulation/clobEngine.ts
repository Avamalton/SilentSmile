import {
  BookOrder,
  Candle,
  MarketPair,
  MMConfig,
  PairMMBotConfig,
  Order,
  OrderBook,
  OrderBookLevel,
  OrderSide,
  OrderType,
  TimeFrame,
  Trade,
  UserBalance,
} from './types';
import { safeRound } from '../utils/formatters';

export interface CLOBMatchingResult {
  order: Order;
  trades: Trade[];
  restingBookOrder?: BookOrder;
  removedBookOrderIds: string[];
  updatedRestingOrders: BookOrder[];
  updatedBalances: Record<string, UserBalance>;
  success: boolean;
  message: string;
  executionPrice: number;
}

/**
 * Aggregates individual resting BookOrders into Level-2 OrderBook levels
 */
export function aggregateOrderBook(
  restingOrders: BookOrder[],
  pairId: string,
  currentUserId?: string,
  maxLevels: number = 15
): OrderBook {
  const pairOrders = restingOrders.filter((o) => o.pair === pairId && o.remainingAmount > 0);

  // Group bids and asks by exact price
  const bidsMap = new Map<number, { amount: number; count: number; myAmount: number; isWall: boolean }>();
  const asksMap = new Map<number, { amount: number; count: number; myAmount: number; isWall: boolean }>();

  for (const ord of pairOrders) {
    const map = ord.side === 'buy' ? bidsMap : asksMap;
    const existing = map.get(ord.price) || { amount: 0, count: 0, myAmount: 0, isWall: false };
    existing.amount = safeRound(existing.amount + ord.remainingAmount, 4);
    existing.count += 1;
    if (ord.isWall) existing.isWall = true;
    if (currentUserId && ord.userId === currentUserId) {
      existing.myAmount = safeRound(existing.myAmount + ord.remainingAmount, 4);
    }
    map.set(ord.price, existing);
  }

  // Sort Bids: highest price first
  const sortedBidPrices = Array.from(bidsMap.keys()).sort((a, b) => b - a).slice(0, maxLevels);
  let cumBidTotal = 0;
  const bids: OrderBookLevel[] = sortedBidPrices.map((price) => {
    const data = bidsMap.get(price)!;
    cumBidTotal = safeRound(cumBidTotal + data.amount, 4);
    return {
      price,
      amount: data.amount,
      total: cumBidTotal,
      depthPercent: 0,
      orderCount: data.count,
      myOrderAmount: data.myAmount > 0 ? data.myAmount : undefined,
      isWall: data.isWall,
    };
  });

  // Sort Asks: lowest price first
  const sortedAskPrices = Array.from(asksMap.keys()).sort((a, b) => a - b).slice(0, maxLevels);
  let cumAskTotal = 0;
  const asks: OrderBookLevel[] = sortedAskPrices.map((price) => {
    const data = asksMap.get(price)!;
    cumAskTotal = safeRound(cumAskTotal + data.amount, 4);
    return {
      price,
      amount: data.amount,
      total: cumAskTotal,
      depthPercent: 0,
      orderCount: data.count,
      myOrderAmount: data.myAmount > 0 ? data.myAmount : undefined,
      isWall: data.isWall,
    };
  });

  // Calculate visual depth percentages
  const maxBidTotal = bids[bids.length - 1]?.total || 1;
  const maxAskTotal = asks[asks.length - 1]?.total || 1;

  bids.forEach((b) => {
    b.depthPercent = Math.min(100, Math.round((b.total / maxBidTotal) * 100));
  });
  asks.forEach((a) => {
    a.depthPercent = Math.min(100, Math.round((a.total / maxAskTotal) * 100));
  });

  const bestBid = bids[0]?.price || 0;
  const bestAsk = asks[0]?.price || 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestAsk + bestBid) / 2 : bestBid || bestAsk || 1;
  const spreadPercent = safeRound((spread / midPrice) * 100, 3);

  return {
    asks: asks.reverse(), // Highest ask down to lowest ask for display
    bids,
    spread,
    spreadPercent,
    lastUpdated: Date.now(),
    restingOrdersCount: pairOrders.length,
  };
}

/**
 * Matches an incoming Order against the real resting BookOrders in the CLOB
 */
export function matchOrderAgainstCLOB(
  userId: string,
  pair: MarketPair,
  side: OrderSide,
  type: OrderType,
  amount: number,
  limitPrice: number,
  restingOrders: BookOrder[],
  balances: Record<string, UserBalance>
): CLOBMatchingResult {
  const now = Date.now();
  const orderId = `ord_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const trades: Trade[] = [];
  const removedBookOrderIds: string[] = [];

  // Deep clone balances
  const updatedBalances: Record<string, UserBalance> = {};
  for (const k of Object.keys(balances)) {
    updatedBalances[k] = { ...balances[k] };
  }

  // Pre-validate funds
  const feeRate = (type === 'limit' ? pair.makerFeeBps : pair.takerFeeBps) / 10000;
  if (side === 'buy') {
    const maxExecutionPrice = type === 'limit' ? limitPrice : pair.lastPrice * 1.15;
    const estimatedCost = Math.ceil(amount * maxExecutionPrice * (1 + feeRate));
    if ((updatedBalances['IDR']?.free || 0) < estimatedCost) {
      return {
        order: {
          id: orderId,
          userId,
          pair: pair.id,
          side,
          type,
          price: limitPrice,
          amount,
          filledAmount: 0,
          remainingAmount: amount,
          total: Math.round(amount * limitPrice),
          fee: 0,
          status: 'rejected',
          createdAt: now,
          updatedAt: now,
        },
        trades: [],
        removedBookOrderIds: [],
        updatedRestingOrders: restingOrders,
        updatedBalances: balances,
        success: false,
        message: `Insufficient virtual IDR balance. Need ~Rp ${estimatedCost.toLocaleString('id-ID')}.`,
        executionPrice: limitPrice,
      };
    }
  } else {
    // Sell
    if ((updatedBalances[pair.baseAsset]?.free || 0) < amount) {
      return {
        order: {
          id: orderId,
          userId,
          pair: pair.id,
          side,
          type,
          price: limitPrice,
          amount,
          filledAmount: 0,
          remainingAmount: amount,
          total: Math.round(amount * limitPrice),
          fee: 0,
          status: 'rejected',
          createdAt: now,
          updatedAt: now,
        },
        trades: [],
        removedBookOrderIds: [],
        updatedRestingOrders: restingOrders,
        updatedBalances: balances,
        success: false,
        message: `Insufficient virtual ${pair.baseAsset} balance. Need ${amount} ${pair.baseAsset}.`,
        executionPrice: limitPrice,
      };
    }
  }

  // Deep clone all resting orders into a map so we maintain accurate, non-mutated state
  const workingRestingMap = new Map<string, BookOrder>();
  for (const o of restingOrders) {
    workingRestingMap.set(o.id, { ...o });
  }

  // Sort counterpart orders:
  // If Buy: we match against Asks (lowest price first, then earliest timestamp)
  // If Sell: we match against Bids (highest price first, then earliest timestamp)
  const counterpartSide = side === 'buy' ? 'sell' : 'buy';
  const candidateOrders = Array.from(workingRestingMap.values())
    .filter((o) => o.pair === pair.id && o.side === counterpartSide && o.remainingAmount > 0)
    .sort((a, b) => {
      if (side === 'buy') {
        if (a.price !== b.price) return a.price - b.price;
      } else {
        if (a.price !== b.price) return b.price - a.price;
      }
      return a.createdAt - b.createdAt;
    });

  let remainingToFill = amount;
  let filledTotalIDR = 0;
  let filledAmount = 0;

  // Attempt matching against resting orders
  for (const resting of candidateOrders) {
    if (remainingToFill <= 0) break;

    // Price crossing check:
    // Buy limit can only match asks <= limitPrice
    // Sell limit can only match bids >= limitPrice
    if (type === 'limit') {
      if (side === 'buy' && resting.price > limitPrice) break;
      if (side === 'sell' && resting.price < limitPrice) break;
    }

    const matchQty = safeRound(Math.min(remainingToFill, resting.remainingAmount), 6);
    if (matchQty <= 0) continue;

    const matchPrice = resting.price;
    const matchTotal = Math.round(matchQty * matchPrice);
    const fee = Math.round(matchTotal * feeRate);

    // Apply settlement
    if (side === 'buy') {
      // Taker buys: debit IDR, credit base
      const totalDebit = matchTotal + fee;
      updatedBalances['IDR'].free = Math.max(0, updatedBalances['IDR'].free - totalDebit);
      updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;

      if (!updatedBalances[pair.baseAsset]) {
        updatedBalances[pair.baseAsset] = { asset: pair.baseAsset, free: 0, locked: 0, total: 0 };
      }
      updatedBalances[pair.baseAsset].free = safeRound(updatedBalances[pair.baseAsset].free + matchQty, 6);
      updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);
    } else {
      // Taker sells: debit base, credit IDR
      updatedBalances[pair.baseAsset].free = safeRound(Math.max(0, updatedBalances[pair.baseAsset].free - matchQty), 6);
      updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);

      const netCredit = matchTotal - fee;
      updatedBalances['IDR'].free = Math.round(updatedBalances['IDR'].free + netCredit);
      updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;
    }

    // Deduct from resting order in working map
    const targetResting = workingRestingMap.get(resting.id);
    if (targetResting) {
      targetResting.remainingAmount = safeRound(targetResting.remainingAmount - matchQty, 6);
      if (targetResting.remainingAmount <= 0) {
        removedBookOrderIds.push(resting.id);
        workingRestingMap.delete(resting.id);
      }
    }

    remainingToFill = safeRound(remainingToFill - matchQty, 6);
    filledAmount = safeRound(filledAmount + matchQty, 6);
    filledTotalIDR += matchTotal;

    const tradeId = `trd_${now}_${Math.random().toString(36).substring(2, 6)}`;
    trades.push({
      id: tradeId,
      pair: pair.id,
      price: matchPrice,
      amount: matchQty,
      total: matchTotal,
      side,
      timestamp: now,
      orderId,
      isMaker: false,
    });
  }

  // Average execution price
  const avgExecutionPrice = filledAmount > 0 ? Math.round(filledTotalIDR / filledAmount) : limitPrice;
  const isFilled = remainingToFill <= 0;
  const isPartial = filledAmount > 0 && remainingToFill > 0;

  let restingBookOrder: BookOrder | undefined = undefined;

  if (type === 'limit' && remainingToFill > 0) {
    // The unfilled remainder rests directly in the Level-2 order book!
    restingBookOrder = {
      id: orderId,
      userId,
      pair: pair.id,
      side,
      price: limitPrice,
      amount,
      remainingAmount: remainingToFill,
      createdAt: now,
    };

    // Lock user balance for the resting portion
    if (side === 'buy') {
      const lockAmount = Math.ceil(remainingToFill * limitPrice * (1 + feeRate));
      updatedBalances['IDR'].free = Math.max(0, updatedBalances['IDR'].free - lockAmount);
      updatedBalances['IDR'].locked = Math.round(updatedBalances['IDR'].locked + lockAmount);
    } else {
      updatedBalances[pair.baseAsset].free = safeRound(Math.max(0, updatedBalances[pair.baseAsset].free - remainingToFill), 6);
      updatedBalances[pair.baseAsset].locked = safeRound(updatedBalances[pair.baseAsset].locked + remainingToFill, 6);
    }
  }

  // Assemble clean final resting orders array
  const updatedRestingOrders = Array.from(workingRestingMap.values());
  if (restingBookOrder) {
    updatedRestingOrders.push(restingBookOrder);
  }

  const orderStatus = isFilled ? 'filled' : isPartial ? 'partially_filled' : type === 'market' ? 'cancelled' : 'open';

  const order: Order = {
    id: orderId,
    userId,
    pair: pair.id,
    side,
    type,
    price: type === 'limit' ? limitPrice : avgExecutionPrice,
    amount,
    filledAmount,
    remainingAmount: remainingToFill,
    total: filledTotalIDR || Math.round(amount * limitPrice),
    fee: Math.round(filledTotalIDR * feeRate),
    status: orderStatus,
    createdAt: now,
    updatedAt: now,
    trades: trades.map((t) => t.id),
  };

  let msg = '';
  if (isFilled) {
    msg = `Filled ${amount} ${pair.baseAsset} at avg Rp ${avgExecutionPrice.toLocaleString('id-ID')}.`;
  } else if (isPartial) {
    msg = `Partially filled ${filledAmount} ${pair.baseAsset} at avg Rp ${avgExecutionPrice.toLocaleString('id-ID')}. Remainder placed on order book.`;
  } else if (type === 'limit') {
    msg = `Limit ${side.toUpperCase()} placed on order book: ${amount} ${pair.baseAsset} @ Rp ${limitPrice.toLocaleString('id-ID')}. Funds reserved.`;
  } else {
    msg = `Market order completed with available liquidity: ${filledAmount} ${pair.baseAsset} filled.`;
  }

  return {
    order,
    trades,
    restingBookOrder,
    removedBookOrderIds,
    updatedRestingOrders,
    updatedBalances,
    success: true,
    message: msg,
    executionPrice: avgExecutionPrice,
  };
}

/**
 * Creates / replenishes active Market Maker liquidity orders for a pair
 * Enforces price boundaries (buy_min/max, sell_min/max), active wall protection,
 * price jitter, and frozen fund accounting to eliminate unconfigured price jumps.
 */
export function buildMMOrders(
  pair: MarketPair,
  midPrice: number,
  config: Partial<PairMMBotConfig> & {
    targetSpreadBps: number;
    levelsPerSide?: number;
    baseAmountPerLevel: number;
    tickSize?: number;
    amountVariancePct?: number;
  },
  existingWalls?: BookOrder[]
): BookOrder[] {
  const orders: BookOrder[] = [];
  const now = Date.now();

  const tick = Math.max(1, config.tickSize || (pair.lastPrice > 1000000 ? 1000 : 25));
  const halfSpread = Math.max(tick, Math.round((midPrice * (config.targetSpreadBps / 10000)) / 2));
  const minAmt = pair.minOrderAmount || 0.0001;
  const baseQty = Math.max(minAmt, config.baseAmountPerLevel || minAmt);
  const levels = Math.max(1, Math.min(30, config.levelsPerSide || config.order_count || 10));
  const priceDecimals = config.price_decimal !== undefined ? config.price_decimal : pair.priceDecimals;
  const amountDecimals = config.quantity_decimal !== undefined ? config.quantity_decimal : pair.amountDecimals;
  const accountId = config.account_id || 'usr_mm_01';
  const txType = config.transaction_type || 'post_only';
  const expireSec = config.expire_time || 0;
  const expiresAt = expireSec > 0 ? now + expireSec * 1000 : undefined;
  const jitterPricePct = (config.jitter_price_pct || 0) / 100;

  // Active Wall Guard Boundaries (strictly only isWall orders)
  const pairWalls = existingWalls
    ? existingWalls.filter((w) => w.isWall && w.pair === pair.id && w.remainingAmount > 0)
    : [];
  const buyWalls = pairWalls.filter((w) => w.side === 'buy');
  const sellWalls = pairWalls.filter((w) => w.side === 'sell');
  const highestBuyWallPrice = buyWalls.length > 0 ? Math.max(...buyWalls.map((w) => w.price)) : 0;
  const lowestSellWallPrice = sellWalls.length > 0 ? Math.min(...sellWalls.map((w) => w.price)) : Infinity;

  // 1. Generate Bid Ladder (Buys)
  let currentBidPrice = Math.floor((midPrice - halfSpread) / tick) * tick;
  if (currentBidPrice <= 0) currentBidPrice = tick;

  // Guard against exceeding buy_max_price_limit (if valid relative to midPrice) or lowest sell wall
  if (config.buy_max_price_limit && config.buy_max_price_limit > 0 && config.buy_min_price_limit && config.buy_max_price_limit > config.buy_min_price_limit) {
    if (midPrice >= config.buy_min_price_limit && midPrice <= (config.sell_max_price_limit || Infinity)) {
      currentBidPrice = Math.min(currentBidPrice, config.buy_max_price_limit);
    }
  }
  if (lowestSellWallPrice < Infinity) {
    currentBidPrice = Math.min(currentBidPrice, lowestSellWallPrice - tick);
  }

  let prevBidPrice = Infinity;
  for (let i = 0; i < levels; i++) {
    let price = currentBidPrice - i * tick;

    // Apply jitter strictly within monotonic bounds so levels never invert or cross
    if (jitterPricePct > 0 && i > 0) {
      const jitterOffset = Math.sin(i * 3.7) * Math.min(jitterPricePct * price, tick * 0.45);
      price = Math.floor((price + jitterOffset) / tick) * tick;
    }
    if (price >= prevBidPrice) {
      price = prevBidPrice - tick;
    }
    if (price >= midPrice) {
      price = Math.floor((midPrice - tick) / tick) * tick;
    }
    price = safeRound(price, priceDecimals);
    if (price <= 0) break;

    // Hard Boundaries Checks when midPrice is within configured range
    if (
      config.buy_min_price_limit &&
      config.buy_min_price_limit > 0 &&
      midPrice > config.buy_min_price_limit &&
      price < config.buy_min_price_limit
    ) {
      continue;
    }
    if (price >= lowestSellWallPrice) {
      continue; // Strictly protect resistance wall from being crossed
    }
    prevBidPrice = price;

    // Amount variation per level
    const variance = 1 + ((Math.sin(i * 1.5) * (config.amountVariancePct || 20)) / 100);
    const amount = Math.max(minAmt, safeRound(baseQty * variance + i * 0.15 * baseQty, amountDecimals));
    const frozenFunds = Math.round(price * amount);

    orders.push({
      id: `mm_bid_${pair.id.replace('/', '')}_${i}_${price}_${now}`,
      userId: accountId,
      pair: pair.id,
      side: 'buy',
      price,
      amount,
      remainingAmount: amount,
      createdAt: now - i * 1000,
      isMM: true,
      isFrozen: true,
      frozenFunds,
      expiresAt,
      transactionType: txType,
    });
  }

  // 2. Generate Ask Ladder (Sells)
  let currentAskPrice = Math.ceil((midPrice + halfSpread) / tick) * tick;
  const highestGeneratedBid = prevBidPrice < Infinity ? currentBidPrice : 0;
  if (highestGeneratedBid > 0 && currentAskPrice <= highestGeneratedBid) {
    currentAskPrice = highestGeneratedBid + tick;
  }

  // Guard against dropping below sell_min_price_limit (if valid relative to midPrice) or highest buy wall
  if (config.sell_min_price_limit && config.sell_min_price_limit > 0 && config.sell_max_price_limit && config.sell_max_price_limit > config.sell_min_price_limit) {
    if (midPrice >= (config.buy_min_price_limit || 0) && midPrice <= config.sell_max_price_limit) {
      currentAskPrice = Math.max(currentAskPrice, config.sell_min_price_limit);
    }
  }
  if (highestBuyWallPrice > 0) {
    currentAskPrice = Math.max(currentAskPrice, highestBuyWallPrice + tick);
  }

  let prevAskPrice = 0;
  for (let i = 0; i < levels; i++) {
    let price = currentAskPrice + i * tick;

    // Apply jitter strictly within monotonic bounds so levels never invert or cross
    if (jitterPricePct > 0 && i > 0) {
      const jitterOffset = Math.cos(i * 3.7) * Math.min(jitterPricePct * price, tick * 0.45);
      price = Math.ceil((price + jitterOffset) / tick) * tick;
    }
    if (prevAskPrice > 0 && price <= prevAskPrice) {
      price = prevAskPrice + tick;
    }
    if (price <= midPrice) {
      price = Math.ceil((midPrice + tick) / tick) * tick;
    }
    price = safeRound(price, priceDecimals);

    // Hard Boundaries Checks when midPrice is within configured range
    if (
      config.sell_max_price_limit &&
      config.sell_max_price_limit > 0 &&
      midPrice < config.sell_max_price_limit &&
      price > config.sell_max_price_limit
    ) {
      continue;
    }
    if (price <= highestBuyWallPrice) {
      continue; // Strictly protect support wall from being crossed
    }
    prevAskPrice = price;

    const variance = 1 + ((Math.cos(i * 1.5) * (config.amountVariancePct || 20)) / 100);
    const amount = Math.max(minAmt, safeRound(baseQty * variance + i * 0.15 * baseQty, amountDecimals));
    const frozenFunds = amount;

    orders.push({
      id: `mm_ask_${pair.id.replace('/', '')}_${i}_${price}_${now}`,
      userId: accountId,
      pair: pair.id,
      side: 'sell',
      price,
      amount,
      remainingAmount: amount,
      createdAt: now - i * 1000,
      isMM: true,
      isFrozen: true,
      frozenFunds,
      expiresAt,
      transactionType: txType,
    });
  }

  return orders;
}

/**
 * Updates Candlestick series with an executed trade tick
 */
export function updateCandlesWithRealTrade(
  candles: Candle[],
  trade: Trade,
  timeframe: TimeFrame
): Candle[] {
  if (!candles || candles.length === 0) {
    return [
      {
        time: Math.floor(trade.timestamp / 1000),
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.amount,
      },
    ];
  }

  const tfSeconds: Record<TimeFrame, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
    '1D': 86400,
  };

  const step = tfSeconds[timeframe];
  const tradeSec = Math.floor(trade.timestamp / 1000);
  const candleStartTime = Math.floor(tradeSec / step) * step;

  const lastCandle = { ...candles[candles.length - 1] };

  if (lastCandle.time === candleStartTime) {
    // Current candle active: update high, low, close, volume
    lastCandle.high = Math.max(lastCandle.high, trade.price);
    lastCandle.low = Math.min(lastCandle.low, trade.price);
    lastCandle.close = trade.price;
    lastCandle.volume = safeRound(lastCandle.volume + trade.amount, 4);
    return [...candles.slice(0, -1), lastCandle];
  } else if (tradeSec > lastCandle.time) {
    // New timeframe bucket: append new candle
    const newCandle: Candle = {
      time: candleStartTime,
      open: lastCandle.close,
      high: Math.max(lastCandle.close, trade.price),
      low: Math.min(lastCandle.close, trade.price),
      close: trade.price,
      volume: trade.amount,
    };
    return [...candles, newCandle];
  }

  return candles;
}
