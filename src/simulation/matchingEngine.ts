import { Order, OrderSide, OrderType, Trade, UserBalance, MarketPair, BookOrder } from './types';
import { safeRound } from '../utils/formatters';

export interface MatchingResult {
  order: Order;
  trades: Trade[];
  updatedBalances: Record<string, UserBalance>;
  success: boolean;
  message: string;
}

/**
 * Validates whether user has sufficient free balance for an order
 */
export function validateOrderFunds(
  side: OrderSide,
  type: OrderType,
  amount: number,
  price: number,
  pair: MarketPair,
  balances: Record<string, UserBalance>
): { valid: boolean; error?: string; requiredFunds: number } {
  if (amount <= 0 || isNaN(amount)) {
    return { valid: false, error: 'Order amount must be greater than zero.', requiredFunds: 0 };
  }
  if (amount < pair.minOrderAmount) {
    return {
      valid: false,
      error: `Minimum order amount for ${pair.id} is ${pair.minOrderAmount} ${pair.baseAsset}.`,
      requiredFunds: 0,
    };
  }

  if (side === 'buy') {
    const executionPrice = type === 'limit' ? price : pair.lastPrice;
    if (type === 'limit' && (price <= 0 || isNaN(price))) {
      return { valid: false, error: 'Limit price must be greater than zero.', requiredFunds: 0 };
    }
    const orderCost = amount * executionPrice;
    const feeRate = (type === 'limit' ? pair.makerFeeBps : pair.takerFeeBps) / 10000;
    const estimatedFee = orderCost * feeRate;
    const totalRequiredIDR = Math.ceil(orderCost + estimatedFee);

    const idrBalance = balances['IDR']?.free || 0;
    if (idrBalance < totalRequiredIDR) {
      return {
        valid: false,
        error: `Insufficient virtual IDR balance. Required: Rp ${totalRequiredIDR.toLocaleString('id-ID')}, Available: Rp ${Math.floor(idrBalance).toLocaleString('id-ID')}.`,
        requiredFunds: totalRequiredIDR,
      };
    }
    return { valid: true, requiredFunds: totalRequiredIDR };
  } else {
    // Sell side: needs base asset (BTC, ETH, etc.)
    const baseBalance = balances[pair.baseAsset]?.free || 0;
    if (baseBalance < amount) {
      return {
        valid: false,
        error: `Insufficient virtual ${pair.baseAsset} balance. Required: ${amount} ${pair.baseAsset}, Available: ${baseBalance} ${pair.baseAsset}.`,
        requiredFunds: amount,
      };
    }
    return { valid: true, requiredFunds: amount };
  }
}

/**
 * Executes or queues an order through the matching engine
 */
export function executeOrder(
  userId: string,
  pair: MarketPair,
  side: OrderSide,
  type: OrderType,
  amount: number,
  limitPrice: number,
  balances: Record<string, UserBalance>,
  existingOpenOrders: Order[] = []
): MatchingResult {
  const validation = validateOrderFunds(side, type, amount, limitPrice, pair, balances);
  if (!validation.valid) {
    const rejectedOrder: Order = {
      id: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId,
      pair: pair.id,
      side,
      type,
      price: type === 'limit' ? limitPrice : pair.lastPrice,
      amount,
      filledAmount: 0,
      remainingAmount: amount,
      total: Math.round(amount * (type === 'limit' ? limitPrice : pair.lastPrice)),
      fee: 0,
      status: 'rejected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return {
      order: rejectedOrder,
      trades: [],
      updatedBalances: balances,
      success: false,
      message: validation.error || 'Order rejected.',
    };
  }

  // Clone balance state safely
  const updatedBalances: Record<string, UserBalance> = {};
  for (const k of Object.keys(balances)) {
    updatedBalances[k] = { ...balances[k] };
  }

  const now = Date.now();
  const orderId = `ord_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const trades: Trade[] = [];

  const feeBps = type === 'limit' ? pair.makerFeeBps : pair.takerFeeBps;
  const feeRate = feeBps / 10000;

  if (type === 'market') {
    // Market orders fill immediately against simulated liquidity at market price
    const executionPrice = pair.lastPrice;
    const totalValue = Math.round(amount * executionPrice);
    const fee = Math.round(totalValue * feeRate);

    if (side === 'buy') {
      const totalDebit = totalValue + fee;
      updatedBalances['IDR'].free = Math.max(0, updatedBalances['IDR'].free - totalDebit);
      updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;

      if (!updatedBalances[pair.baseAsset]) {
        updatedBalances[pair.baseAsset] = { asset: pair.baseAsset, free: 0, locked: 0, total: 0 };
      }
      updatedBalances[pair.baseAsset].free = safeRound(updatedBalances[pair.baseAsset].free + amount, 6);
      updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);
    } else {
      // Sell
      updatedBalances[pair.baseAsset].free = safeRound(Math.max(0, updatedBalances[pair.baseAsset].free - amount), 6);
      updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);

      const netIDRCredit = totalValue - fee;
      updatedBalances['IDR'].free = Math.round(updatedBalances['IDR'].free + netIDRCredit);
      updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;
    }

    const trade: Trade = {
      id: `trd_${now}_${Math.random().toString(36).substring(2, 7)}`,
      pair: pair.id,
      price: executionPrice,
      amount,
      total: totalValue,
      side,
      timestamp: now,
      orderId,
    };
    trades.push(trade);

    const filledOrder: Order = {
      id: orderId,
      userId,
      pair: pair.id,
      side,
      type: 'market',
      price: executionPrice,
      amount,
      filledAmount: amount,
      remainingAmount: 0,
      total: totalValue,
      fee,
      status: 'filled',
      createdAt: now,
      updatedAt: now,
      trades: [trade.id],
    };

    return {
      order: filledOrder,
      trades,
      updatedBalances,
      success: true,
      message: `Market ${side.toUpperCase()} order for ${amount} ${pair.baseAsset} filled at Rp ${executionPrice.toLocaleString('id-ID')}.`,
    };
  } else {
    // Limit order logic
    // Check if limit price immediately crosses the book (e.g. limit buy >= lastPrice or limit sell <= lastPrice)
    const isImmediateFill = (side === 'buy' && limitPrice >= pair.lastPrice) || (side === 'sell' && limitPrice <= pair.lastPrice);

    if (isImmediateFill) {
      // Execute immediately as taker fill at best current price
      const executionPrice = side === 'buy' ? Math.min(limitPrice, pair.lastPrice) : Math.max(limitPrice, pair.lastPrice);
      const totalValue = Math.round(amount * executionPrice);
      const fee = Math.round(totalValue * feeRate);

      if (side === 'buy') {
        const totalDebit = totalValue + fee;
        updatedBalances['IDR'].free = Math.max(0, updatedBalances['IDR'].free - totalDebit);
        updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;

        if (!updatedBalances[pair.baseAsset]) {
          updatedBalances[pair.baseAsset] = { asset: pair.baseAsset, free: 0, locked: 0, total: 0 };
        }
        updatedBalances[pair.baseAsset].free = safeRound(updatedBalances[pair.baseAsset].free + amount, 6);
        updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);
      } else {
        // Sell
        updatedBalances[pair.baseAsset].free = safeRound(Math.max(0, updatedBalances[pair.baseAsset].free - amount), 6);
        updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);

        const netIDRCredit = totalValue - fee;
        updatedBalances['IDR'].free = Math.round(updatedBalances['IDR'].free + netIDRCredit);
        updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;
      }

      const trade: Trade = {
        id: `trd_${now}_${Math.random().toString(36).substring(2, 7)}`,
        pair: pair.id,
        price: executionPrice,
        amount,
        total: totalValue,
        side,
        timestamp: now,
        orderId,
      };
      trades.push(trade);

      const filledOrder: Order = {
        id: orderId,
        userId,
        pair: pair.id,
        side,
        type: 'limit',
        price: limitPrice,
        amount,
        filledAmount: amount,
        remainingAmount: 0,
        total: totalValue,
        fee,
        status: 'filled',
        createdAt: now,
        updatedAt: now,
        trades: [trade.id],
      };

      return {
        order: filledOrder,
        trades,
        updatedBalances,
        success: true,
        message: `Limit ${side.toUpperCase()} order for ${amount} ${pair.baseAsset} immediately filled at Rp ${executionPrice.toLocaleString('id-ID')}.`,
      };
    } else {
      // Place limit order into the open book: reserve balance
      const totalValue = Math.round(amount * limitPrice);
      const fee = Math.round(totalValue * feeRate);

      if (side === 'buy') {
        const reserveAmount = totalValue + fee;
        updatedBalances['IDR'].free = Math.max(0, updatedBalances['IDR'].free - reserveAmount);
        updatedBalances['IDR'].locked = Math.round(updatedBalances['IDR'].locked + reserveAmount);
      } else {
        // Sell
        updatedBalances[pair.baseAsset].free = safeRound(Math.max(0, updatedBalances[pair.baseAsset].free - amount), 6);
        updatedBalances[pair.baseAsset].locked = safeRound(updatedBalances[pair.baseAsset].locked + amount, 6);
      }

      const openOrder: Order = {
        id: orderId,
        userId,
        pair: pair.id,
        side,
        type: 'limit',
        price: limitPrice,
        amount,
        filledAmount: 0,
        remainingAmount: amount,
        total: totalValue,
        fee,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };

      return {
        order: openOrder,
        trades: [],
        updatedBalances,
        success: true,
        message: `Limit ${side.toUpperCase()} order for ${amount} ${pair.baseAsset} at Rp ${limitPrice.toLocaleString('id-ID')} placed on book. Funds reserved.`,
      };
    }
  }
}

/**
 * Cancels an open or partially filled limit order and unreserves locked funds
 */
export function cancelOrder(
  order: Order,
  pair: MarketPair,
  balances: Record<string, UserBalance>
): { updatedOrder: Order; updatedBalances: Record<string, UserBalance>; success: boolean; message: string } {
  if (order.status !== 'open' && order.status !== 'partially_filled') {
    return {
      updatedOrder: order,
      updatedBalances: balances,
      success: false,
      message: `Order #${order.id} is already ${order.status} and cannot be cancelled.`,
    };
  }

  const updatedBalances: Record<string, UserBalance> = {};
  for (const k of Object.keys(balances)) {
    updatedBalances[k] = { ...balances[k] };
  }

  const unfilledAmount = order.remainingAmount;
  const feeRate = pair.makerFeeBps / 10000;

  if (order.side === 'buy') {
    const unreserveIDR = Math.ceil(unfilledAmount * order.price * (1 + feeRate));
    updatedBalances['IDR'].locked = Math.max(0, updatedBalances['IDR'].locked - unreserveIDR);
    updatedBalances['IDR'].free = Math.round(updatedBalances['IDR'].free + unreserveIDR);
    updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;
  } else {
    // Sell
    if (updatedBalances[pair.baseAsset]) {
      updatedBalances[pair.baseAsset].locked = safeRound(Math.max(0, updatedBalances[pair.baseAsset].locked - unfilledAmount), 6);
      updatedBalances[pair.baseAsset].free = safeRound(updatedBalances[pair.baseAsset].free + unfilledAmount, 6);
      updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);
    }
  }

  const updatedOrder: Order = {
    ...order,
    status: 'cancelled',
    updatedAt: Date.now(),
  };

  return {
    updatedOrder,
    updatedBalances,
    success: true,
    message: `Order #${order.id.slice(-6)} cancelled successfully. Reserved funds restored to free balance.`,
  };
}

/**
 * Checks open orders against incoming market price ticks to trigger fills
 */
export function matchOpenOrdersOnPriceTick(
  openOrders: Order[],
  pair: MarketPair,
  newPrice: number,
  balances: Record<string, UserBalance>
): { updatedOrders: Order[]; newTrades: Trade[]; updatedBalances: Record<string, UserBalance> } {
  let hasChanges = false;
  const updatedBalances: Record<string, UserBalance> = {};
  for (const k of Object.keys(balances)) {
    updatedBalances[k] = { ...balances[k] };
  }

  const updatedOrders: Order[] = [];
  const newTrades: Trade[] = [];

  for (const order of openOrders) {
    if (order.pair !== pair.id || (order.status !== 'open' && order.status !== 'partially_filled')) {
      updatedOrders.push(order);
      continue;
    }

    const shouldFill = (order.side === 'buy' && newPrice <= order.price) || (order.side === 'sell' && newPrice >= order.price);

    if (shouldFill) {
      hasChanges = true;
      const fillAmount = order.remainingAmount;
      const fillPrice = order.price;
      const totalValue = Math.round(fillAmount * fillPrice);
      const fee = Math.round(totalValue * (pair.makerFeeBps / 10000));
      const now = Date.now();

      if (order.side === 'buy') {
        const reservedTotal = Math.ceil(fillAmount * order.price * (1 + pair.makerFeeBps / 10000));
        updatedBalances['IDR'].locked = Math.max(0, updatedBalances['IDR'].locked - reservedTotal);
        // Any slight difference in rounding returned to free
        const diff = reservedTotal - (totalValue + fee);
        if (diff > 0) {
          updatedBalances['IDR'].free = Math.round(updatedBalances['IDR'].free + diff);
        }
        updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;

        if (!updatedBalances[pair.baseAsset]) {
          updatedBalances[pair.baseAsset] = { asset: pair.baseAsset, free: 0, locked: 0, total: 0 };
        }
        updatedBalances[pair.baseAsset].free = safeRound(updatedBalances[pair.baseAsset].free + fillAmount, 6);
        updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);
      } else {
        // Sell
        if (updatedBalances[pair.baseAsset]) {
          updatedBalances[pair.baseAsset].locked = safeRound(Math.max(0, updatedBalances[pair.baseAsset].locked - fillAmount), 6);
          updatedBalances[pair.baseAsset].total = safeRound(updatedBalances[pair.baseAsset].free + updatedBalances[pair.baseAsset].locked, 6);
        }
        const netCredit = totalValue - fee;
        updatedBalances['IDR'].free = Math.round(updatedBalances['IDR'].free + netCredit);
        updatedBalances['IDR'].total = updatedBalances['IDR'].free + updatedBalances['IDR'].locked;
      }

      const trade: Trade = {
        id: `trd_${now}_${Math.random().toString(36).substring(2, 7)}`,
        pair: pair.id,
        price: fillPrice,
        amount: fillAmount,
        total: totalValue,
        side: order.side,
        timestamp: now,
        isMaker: true,
        orderId: order.id,
      };
      newTrades.push(trade);

      updatedOrders.push({
        ...order,
        filledAmount: order.amount,
        remainingAmount: 0,
        status: 'filled',
        updatedAt: now,
        trades: [...(order.trades || []), trade.id],
      });
    } else {
      updatedOrders.push(order);
    }
  }

  return {
    updatedOrders,
    newTrades,
    updatedBalances: hasChanges ? updatedBalances : balances,
  };
}

export interface InjectedBotOrdersResult {
  newOrders: Order[];
  newBookOrders: BookOrder[];
}

/**
 * Programmatic High-Frequency Order Injection for Admin Market Maker Bot:
 * Generates and injects genuine limit orders into the matching engine and CLOB.
 * Each order is a real limit order in the ledger with order IDs, timestamps,
 * amounts, and prices that interact with the matching engine.
 */
export function injectBotLimitOrders(
  botUserId: string,
  pair: MarketPair,
  midPrice: number,
  spreadPct: number, // e.g. 0.35 = 0.35%
  depthLevels: number, // e.g. 10 levels each side
  orderAmountSize: number, // e.g. 750 DNA
  tickSize: number = 25,
  variancePct: number = 25
): InjectedBotOrdersResult {
  const now = Date.now();
  const newOrders: Order[] = [];
  const newBookOrders: BookOrder[] = [];

  const spreadFraction = spreadPct / 100;
  const halfSpread = Math.max(tickSize, Math.round((midPrice * spreadFraction) / 2));

  // 1. Injected Real Limit Bids (Buys)
  const topBidPrice = Math.floor((midPrice - halfSpread) / tickSize) * tickSize;
  for (let i = 0; i < depthLevels; i++) {
    const price = topBidPrice - i * tickSize;
    if (price <= 0) break;

    const variance = 1 + ((Math.sin(i * 1.4) * variancePct) / 100);
    const amount = safeRound(orderAmountSize * variance + (i * 0.1 * orderAmountSize), pair.amountDecimals);
    const orderId = `ord_bot_bid_${pair.id.replace('/', '')}_${price}_${now}_${i}`;

    const limitOrder: Order = {
      id: orderId,
      userId: botUserId,
      pair: pair.id,
      side: 'buy',
      type: 'limit',
      price,
      amount,
      filledAmount: 0,
      remainingAmount: amount,
      total: Math.round(amount * price),
      fee: 0,
      status: 'open',
      createdAt: now - (i * 250),
      updatedAt: now - (i * 250),
    };

    const bookOrder: BookOrder = {
      id: orderId,
      userId: botUserId,
      pair: pair.id,
      side: 'buy',
      price,
      amount,
      remainingAmount: amount,
      createdAt: now - (i * 250),
      isMM: true,
    };

    newOrders.push(limitOrder);
    newBookOrders.push(bookOrder);
  }

  // 2. Injected Real Limit Asks (Sells)
  const topAskPrice = Math.ceil((midPrice + halfSpread) / tickSize) * tickSize;
  for (let i = 0; i < depthLevels; i++) {
    const price = topAskPrice + i * tickSize;

    const variance = 1 + ((Math.cos(i * 1.4) * variancePct) / 100);
    const amount = safeRound(orderAmountSize * variance + (i * 0.1 * orderAmountSize), pair.amountDecimals);
    const orderId = `ord_bot_ask_${pair.id.replace('/', '')}_${price}_${now}_${i}`;

    const limitOrder: Order = {
      id: orderId,
      userId: botUserId,
      pair: pair.id,
      side: 'sell',
      type: 'limit',
      price,
      amount,
      filledAmount: 0,
      remainingAmount: amount,
      total: Math.round(amount * price),
      fee: 0,
      status: 'open',
      createdAt: now - (i * 250),
      updatedAt: now - (i * 250),
    };

    const bookOrder: BookOrder = {
      id: orderId,
      userId: botUserId,
      pair: pair.id,
      side: 'sell',
      price,
      amount,
      remainingAmount: amount,
      createdAt: now - (i * 250),
      isMM: true,
    };

    newOrders.push(limitOrder);
    newBookOrders.push(bookOrder);
  }

  return { newOrders, newBookOrders };
}

/**
 * Injects a single targeted real programmatic limit order (e.g. wall or precision quote)
 */
export function injectSingleProgrammaticOrder(
  botUserId: string,
  pair: MarketPair,
  side: OrderSide,
  price: number,
  amount: number,
  isWall: boolean = false
): { order: Order; bookOrder: BookOrder } {
  const now = Date.now();
  const orderId = `ord_bot_${side}_${price}_${now}_${Math.random().toString(36).substring(2, 6)}`;

  const order: Order = {
    id: orderId,
    userId: botUserId,
    pair: pair.id,
    side,
    type: 'limit',
    price,
    amount,
    filledAmount: 0,
    remainingAmount: amount,
    total: Math.round(amount * price),
    fee: 0,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };

  const bookOrder: BookOrder = {
    id: orderId,
    userId: botUserId,
    pair: pair.id,
    side,
    price,
    amount,
    remainingAmount: amount,
    createdAt: now,
    isMM: true,
    isWall,
  };

  return { order, bookOrder };
}

