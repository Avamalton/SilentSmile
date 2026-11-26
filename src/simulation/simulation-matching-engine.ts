import {
  BookOrder,
  Candle,
  MarketPair,
  MMConfig,
  Order,
  OrderBook,
  OrderBookLevel,
  OrderSide,
  OrderStatus,
  OrderType,
  TimeFrame,
  Trade,
  UserBalance,
} from './types';
import { safeRound } from '../utils/formatters';
import { aggregateOrderBook, matchOrderAgainstCLOB, updateCandlesWithRealTrade } from './clobEngine';

export interface ProgrammaticOrderInjectionParams {
  botUserId?: string;
  pair: MarketPair;
  spreadPct: number; // e.g. 0.35 (%)
  orderFrequencySeconds?: number; // e.g. 2s
  orderAmountSize: number; // base asset quantity per level
  depthLevels: number; // number of price levels per side (1-25)
  tickSize?: number;
  botBalances: Record<string, UserBalance>;
  restingOrders: BookOrder[];
  orderLedger: Order[];
  tightenSpread?: boolean;
  clearExistingBotOrders?: boolean;
}

export interface ProgrammaticOrderInjectionResult {
  placedOrders: Order[];
  newBookOrders: BookOrder[];
  executedTrades: Trade[];
  updatedRestingOrders: BookOrder[];
  updatedLedger: Order[];
  updatedBotBalances: Record<string, UserBalance>;
  totalBidsDeployed: number;
  totalAsksDeployed: number;
  bidsValueIDR: number;
  asksQtyBase: number;
  success: boolean;
  message: string;
}

/**
 * Injects automated limit orders from the Market Maker bot into the CLOB.
 * Orders are real limit orders that check against the bot's real virtual balances,
 * lock required funds/assets, interact with existing counterpart resting orders on the book,
 * execute matches when crossing occurs, and populate Level-2 order book depth.
 */
export function injectProgrammaticLimitOrders(
  params: ProgrammaticOrderInjectionParams
): ProgrammaticOrderInjectionResult {
  const {
    botUserId = 'bot_market_maker',
    pair,
    spreadPct,
    orderAmountSize,
    depthLevels,
    botBalances,
    restingOrders,
    orderLedger,
    tightenSpread = false,
    clearExistingBotOrders = false,
  } = params;

  const now = Date.now();
  const tickSize = params.tickSize || (pair.id.includes('DNA') ? 25 : pair.id.includes('BTC') ? 50000 : 250);

  // Clone bot balances
  const updatedBotBalances: Record<string, UserBalance> = {};
  for (const k of Object.keys(botBalances)) {
    updatedBotBalances[k] = { ...botBalances[k] };
  }
  if (!updatedBotBalances['IDR']) {
    updatedBotBalances['IDR'] = { asset: 'IDR', free: 500000000, locked: 0, total: 500000000 };
  }
  if (!updatedBotBalances[pair.baseAsset]) {
    updatedBotBalances[pair.baseAsset] = { asset: pair.baseAsset, free: 500000, locked: 0, total: 500000 };
  }

  // Determine starting resting orders list — ALWAYS PRESERVE WALL ORDERS (isWall === true)
  let currentResting = clearExistingBotOrders
    ? restingOrders.filter((o) => !(o.pair === pair.id && o.isMM && !o.isWall))
    : [...restingOrders];

  let currentLedger = [...orderLedger];
  const executedTrades: Trade[] = [];
  const placedOrders: Order[] = [];
  const newBookOrders: BookOrder[] = [];
  const newBookOrderIds = new Set<string>();

  // Determine reference mid price
  const activeBook = aggregateOrderBook(currentResting, pair.id);
  const bestBid = activeBook.bids[0]?.price || 0;
  const bestAsk = activeBook.asks[activeBook.asks.length - 1]?.price || 0;
  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : pair.lastPrice;

  // Effective spread percentage
  const effectiveSpreadPct = tightenSpread ? Math.max(0.05, spreadPct * 0.5) : spreadPct;
  const halfSpread = Math.max(tickSize, Math.round((midPrice * (effectiveSpreadPct / 100)) / 2));

  let totalBidsDeployed = 0;
  let totalAsksDeployed = 0;
  let bidsValueIDR = 0;
  let asksQtyBase = 0;

  // Calculate top of book with guaranteed non-overlapping spread (never jump or self-cross)
  let topBidPrice = Math.floor((midPrice - halfSpread) / tickSize) * tickSize;
  let topAskPrice = Math.ceil((midPrice + halfSpread) / tickSize) * tickSize;
  if (topAskPrice <= topBidPrice) {
    topAskPrice = topBidPrice + tickSize;
  }

  // 1. GENERATE BUY LADDER (Real Limit Buys)
  for (let i = 0; i < depthLevels; i++) {
    const price = topBidPrice - i * tickSize;
    if (price <= 0) break;

    // Amount variation per level
    const variance = 1 + ((Math.sin(i * 1.3) * 20) / 100);
    const amount = safeRound(orderAmountSize * variance + (i * 0.1 * orderAmountSize), pair.amountDecimals);
    const orderCost = Math.round(price * amount);

    // Verify bot has sufficient free IDR balance
    if (updatedBotBalances['IDR'].free < orderCost) {
      break; // Bot ran out of free IDR liquidity
    }

    // Deduct free IDR and lock for limit order
    updatedBotBalances['IDR'].free = Math.max(0, updatedBotBalances['IDR'].free - orderCost);
    updatedBotBalances['IDR'].locked = Math.round(updatedBotBalances['IDR'].locked + orderCost);

    const orderId = `ord_bot_bid_${pair.id.replace('/', '')}_${price}_${now}_${i}`;
    let remainingAmount = amount;
    let filledAmount = 0;

    // Check crossing with existing Asks (Sell orders on book, excluding newly generated bot orders from this run)
    const crossingAsks = currentResting
      .filter((o) => o.pair === pair.id && o.side === 'sell' && o.remainingAmount > 0 && o.price <= price && !newBookOrderIds.has(o.id))
      .sort((a, b) => (a.price !== b.price ? a.price - b.price : a.createdAt - b.createdAt));

    for (const ask of crossingAsks) {
      if (remainingAmount <= 0) break;
      const matchQty = safeRound(Math.min(remainingAmount, ask.remainingAmount), pair.amountDecimals);
      if (matchQty <= 0) continue;

      const tradePrice = ask.price;
      const tradeTotal = Math.round(matchQty * tradePrice);

      // Settle trade: bot receives base asset, bot releases locked IDR
      updatedBotBalances['IDR'].locked = Math.max(0, updatedBotBalances['IDR'].locked - tradeTotal);
      updatedBotBalances['IDR'].total = updatedBotBalances['IDR'].free + updatedBotBalances['IDR'].locked;

      updatedBotBalances[pair.baseAsset].free = safeRound(updatedBotBalances[pair.baseAsset].free + matchQty, pair.amountDecimals);
      updatedBotBalances[pair.baseAsset].total = safeRound(updatedBotBalances[pair.baseAsset].free + updatedBotBalances[pair.baseAsset].locked, pair.amountDecimals);

      // Decrement resting ask
      ask.remainingAmount = safeRound(ask.remainingAmount - matchQty, pair.amountDecimals);
      remainingAmount = safeRound(remainingAmount - matchQty, pair.amountDecimals);
      filledAmount = safeRound(filledAmount + matchQty, pair.amountDecimals);

      const trade: Trade = {
        id: `trd_cross_${now}_${Math.random().toString(36).substring(2, 6)}`,
        pair: pair.id,
        price: tradePrice,
        amount: matchQty,
        total: tradeTotal,
        side: 'buy',
        timestamp: now,
        orderId,
      };
      executedTrades.push(trade);

      // Update counterpart in ledger if exists
      currentLedger = currentLedger.map((ord) => {
        if (ord.id === ask.id) {
          const newFilled = safeRound(ord.filledAmount + matchQty, pair.amountDecimals);
          const newRem = safeRound(ord.amount - newFilled, pair.amountDecimals);
          return {
            ...ord,
            filledAmount: newFilled,
            remainingAmount: newRem,
            status: newRem <= 0 ? 'filled' : 'partially_filled',
            updatedAt: now,
          };
        }
        return ord;
      });
    }

    // Clean up fully matched resting orders
    currentResting = currentResting.filter((o) => o.remainingAmount > 0);

    const isFullyFilled = remainingAmount <= 0;
    const isPartial = filledAmount > 0 && remainingAmount > 0;

    const limitOrder: Order = {
      id: orderId,
      userId: botUserId,
      pair: pair.id,
      side: 'buy',
      type: 'limit',
      price,
      amount,
      filledAmount,
      remainingAmount,
      total: orderCost,
      fee: 0,
      status: isFullyFilled ? 'filled' : isPartial ? 'partially_filled' : 'open',
      createdAt: now - i * 150,
      updatedAt: now,
    };
    placedOrders.push(limitOrder);

    // If order has remaining amount, it rests in the CLOB
    if (remainingAmount > 0) {
      const bookOrder: BookOrder = {
        id: orderId,
        userId: botUserId,
        pair: pair.id,
        side: 'buy',
        price,
        amount,
        remainingAmount,
        createdAt: now - i * 150,
        isMM: true,
      };
      newBookOrders.push(bookOrder);
      newBookOrderIds.add(orderId);
      currentResting.push(bookOrder);
    }

    totalBidsDeployed++;
    bidsValueIDR += orderCost;
  }

  // 2. GENERATE SELL LADDER (Real Limit Asks)
  for (let i = 0; i < depthLevels; i++) {
    const price = topAskPrice + i * tickSize;

    const variance = 1 + ((Math.cos(i * 1.3) * 20) / 100);
    const amount = safeRound(orderAmountSize * variance + (i * 0.1 * orderAmountSize), pair.amountDecimals);

    // Verify bot has sufficient free base asset balance
    if (updatedBotBalances[pair.baseAsset].free < amount) {
      break; // Bot ran out of free base asset
    }

    // Deduct free base asset and lock for limit order
    updatedBotBalances[pair.baseAsset].free = safeRound(updatedBotBalances[pair.baseAsset].free - amount, pair.amountDecimals);
    updatedBotBalances[pair.baseAsset].locked = safeRound(updatedBotBalances[pair.baseAsset].locked + amount, pair.amountDecimals);

    const orderId = `ord_bot_ask_${pair.id.replace('/', '')}_${price}_${now}_${i}`;
    let remainingAmount = amount;
    let filledAmount = 0;

    // Check crossing with existing Bids (Buy orders on book, excluding newly generated bot orders from this run)
    const crossingBids = currentResting
      .filter((o) => o.pair === pair.id && o.side === 'buy' && o.remainingAmount > 0 && o.price >= price && !newBookOrderIds.has(o.id))
      .sort((a, b) => (a.price !== b.price ? b.price - a.price : a.createdAt - b.createdAt));

    for (const bid of crossingBids) {
      if (remainingAmount <= 0) break;
      const matchQty = safeRound(Math.min(remainingAmount, bid.remainingAmount), pair.amountDecimals);
      if (matchQty <= 0) continue;

      const tradePrice = bid.price;
      const tradeTotal = Math.round(matchQty * tradePrice);

      // Settle trade: bot receives IDR, bot releases locked base asset
      updatedBotBalances[pair.baseAsset].locked = safeRound(Math.max(0, updatedBotBalances[pair.baseAsset].locked - matchQty), pair.amountDecimals);
      updatedBotBalances[pair.baseAsset].total = safeRound(updatedBotBalances[pair.baseAsset].free + updatedBotBalances[pair.baseAsset].locked, pair.amountDecimals);

      updatedBotBalances['IDR'].free = Math.round(updatedBotBalances['IDR'].free + tradeTotal);
      updatedBotBalances['IDR'].total = updatedBotBalances['IDR'].free + updatedBotBalances['IDR'].locked;

      // Decrement resting bid
      bid.remainingAmount = safeRound(bid.remainingAmount - matchQty, pair.amountDecimals);
      remainingAmount = safeRound(remainingAmount - matchQty, pair.amountDecimals);
      filledAmount = safeRound(filledAmount + matchQty, pair.amountDecimals);

      const trade: Trade = {
        id: `trd_cross_${now}_${Math.random().toString(36).substring(2, 6)}`,
        pair: pair.id,
        price: tradePrice,
        amount: matchQty,
        total: tradeTotal,
        side: 'sell',
        timestamp: now,
        orderId,
      };
      executedTrades.push(trade);

      // Update counterpart in ledger if exists
      currentLedger = currentLedger.map((ord) => {
        if (ord.id === bid.id) {
          const newFilled = safeRound(ord.filledAmount + matchQty, pair.amountDecimals);
          const newRem = safeRound(ord.amount - newFilled, pair.amountDecimals);
          return {
            ...ord,
            filledAmount: newFilled,
            remainingAmount: newRem,
            status: newRem <= 0 ? 'filled' : 'partially_filled',
            updatedAt: now,
          };
        }
        return ord;
      });
    }

    currentResting = currentResting.filter((o) => o.remainingAmount > 0);

    const isFullyFilled = remainingAmount <= 0;
    const isPartial = filledAmount > 0 && remainingAmount > 0;

    const limitOrder: Order = {
      id: orderId,
      userId: botUserId,
      pair: pair.id,
      side: 'sell',
      type: 'limit',
      price,
      amount,
      filledAmount,
      remainingAmount,
      total: Math.round(amount * price),
      fee: 0,
      status: isFullyFilled ? 'filled' : isPartial ? 'partially_filled' : 'open',
      createdAt: now - i * 150,
      updatedAt: now,
    };
    placedOrders.push(limitOrder);

    if (remainingAmount > 0) {
      const bookOrder: BookOrder = {
        id: orderId,
        userId: botUserId,
        pair: pair.id,
        side: 'sell',
        price,
        amount,
        remainingAmount,
        createdAt: now - i * 150,
        isMM: true,
      };
      newBookOrders.push(bookOrder);
      newBookOrderIds.add(orderId);
      currentResting.push(bookOrder);
    }

    totalAsksDeployed++;
    asksQtyBase = safeRound(asksQtyBase + amount, pair.amountDecimals);
  }

  // Prepend new orders to ledger
  currentLedger = [...placedOrders, ...currentLedger];

  const msg = `Programmatically injected ${placedOrders.length} real limit orders (${totalBidsDeployed} bids, ${totalAsksDeployed} asks) into ${pair.id} CLOB. Depth and balances updated in real-time.`;

  return {
    placedOrders,
    newBookOrders,
    executedTrades,
    updatedRestingOrders: currentResting,
    updatedLedger: currentLedger,
    updatedBotBalances,
    totalBidsDeployed,
    totalAsksDeployed,
    bidsValueIDR,
    asksQtyBase,
    success: true,
    message: msg,
  };
}

/**
 * Re-exports everything from matchingEngine and clobEngine for convenience
 */
export * from './clobEngine';
export * from './matchingEngine';
