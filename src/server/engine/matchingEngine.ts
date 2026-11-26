import crypto from 'node:crypto';
import { DatabaseManager } from '../db/database';
import { LedgerService } from '../ledger/ledgerService';
import { computeTradeTotal, calculateBpsFee } from '../ledger/integerMath';
import { OrderBook, BookOrder, OrderSide, OrderType, OrderStatus, OrderBookDepth } from './orderBook';

export interface MarketPairConfig {
  id: string;
  baseAsset: string;
  quoteAsset: string;
  basePrecision: number;
  quotePrecision: number;
  minOrderSize: number;
  makerFeeBps: number;
  takerFeeBps: number;
  isActive: number;
  tradingStatus: 'OPEN' | 'HALTED';
}

export interface PlaceOrderCommand {
  orderId?: string;
  clientOrderId?: string;
  userId: string;
  side: OrderSide;
  orderType: OrderType;
  price: number;              // In quote integer units (0 for MARKET buy/sell if using best available)
  amount: number;             // In base integer units
}

export interface EngineTradeRecord {
  id: string;
  pairId: string;
  price: number;
  amount: number;
  total: number;
  side: OrderSide;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  makerFee: number;
  takerFee: number;
  timestamp: number;
}

export interface EngineEventRecord {
  seqId: number;
  pairId: string;
  eventType: string;
  payload: any;
  timestamp: number;
}

export class MatchingEngine {
  public pairConfig: MarketPairConfig;
  public book: OrderBook;
  private dbMgr: DatabaseManager;
  private ledger: LedgerService;
  private commandQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue: boolean = false;
  private listeners: Array<(event: EngineEventRecord) => void> = [];

  constructor(pairConfig: MarketPairConfig, dbMgr: DatabaseManager, ledger: LedgerService) {
    this.pairConfig = pairConfig;
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.book = new OrderBook(pairConfig.id);
  }

  public addListener(listener: (event: EngineEventRecord) => void): void {
    this.listeners.push(listener);
  }

  private emitEvent(eventType: string, payload: any): EngineEventRecord {
    const now = Date.now();
    const payloadStr = JSON.stringify(payload);

    this.dbMgr.execute(
      `INSERT INTO engine_events (pair_id, event_type, payload_json, timestamp)
       VALUES (?, ?, ?, ?)`,
      [this.pairConfig.id, eventType, payloadStr, now]
    );

    const row = this.dbMgr.queryOne<{ seq_id: number }>('SELECT last_insert_rowid() as seq_id');
    const event: EngineEventRecord = {
      seqId: row?.seq_id || 0,
      pairId: this.pairConfig.id,
      eventType,
      payload,
      timestamp: now,
    };

    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error('Error in engine listener:', err);
      }
    }

    return event;
  }

  /**
   * Enqueues an operation to ensure single-threaded execution per pair
   */
  public enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.commandQueue.push(async () => {
        try {
          const res = await operation();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.commandQueue.length > 0) {
      const task = this.commandQueue.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.error(`Error processing queue task for ${this.pairConfig.id}:`, err);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Replays events or loads active orders on startup for deterministic recovery
   */
  public async recover(): Promise<void> {
    this.book.clear();
    const openOrders = this.dbMgr.query<any>(
      `SELECT * FROM orders WHERE pair_id = ? AND status IN ('NEW', 'PARTIALLY_FILLED') ORDER BY created_at ASC`,
      [this.pairConfig.id]
    );

    for (const o of openOrders) {
      this.book.addLimitOrder({
        id: o.id,
        userId: o.user_id,
        side: o.side as OrderSide,
        price: o.price,
        amount: o.amount,
        filledAmount: o.filled_amount,
        remainingAmount: o.remaining_amount,
        timestamp: o.created_at,
      });
    }
  }

  /**
   * Submits a new limit or market order
   */
  public async submitOrder(cmd: PlaceOrderCommand): Promise<{ orderId: string; fills: EngineTradeRecord[]; status: OrderStatus }> {
    return this.enqueue(async () => {
      if (this.pairConfig.tradingStatus === 'HALTED') {
        throw new Error(`Trading for pair ${this.pairConfig.id} is currently halted`);
      }
      if (cmd.amount < this.pairConfig.minOrderSize) {
        throw new Error(`Order size below minimum allowed size of ${this.pairConfig.minOrderSize}`);
      }

      const orderId = cmd.orderId || `ord_${crypto.randomBytes(8).toString('hex')}`;
      const now = Date.now();

      // Lock user funds in ledger BEFORE inserting order into matching engine
      if (cmd.side === 'BUY') {
        let lockAmount: number;
        if (cmd.orderType === 'LIMIT') {
          if (cmd.price <= 0) throw new Error('Limit order price must be greater than zero');
          lockAmount = computeTradeTotal(cmd.price, cmd.amount, this.pairConfig.basePrecision);
        } else {
          // MARKET BUY: Calculate estimated cost from ask side depth
          if (this.book.asks.length === 0) {
            throw new Error('Market order rejected: insufficient order book liquidity on ask side');
          }
          // Use worst acceptable ask price with 5% slippage buffer to lock quote funds
          let requiredQuote = 0;
          let remainingToFill = cmd.amount;
          for (const ask of this.book.asks) {
            const takeAmount = Math.min(remainingToFill, ask.remainingAmount);
            requiredQuote += computeTradeTotal(ask.price, takeAmount, this.pairConfig.basePrecision);
            remainingToFill -= takeAmount;
            if (remainingToFill <= 0) break;
          }
          if (remainingToFill > 0) {
            throw new Error('Market order rejected: insufficient depth to fill order');
          }
          lockAmount = Math.floor(requiredQuote * 1.05); // 5% slippage buffer
        }

        this.ledger.lockOrderFunds(
          cmd.userId,
          this.pairConfig.quoteAsset,
          lockAmount,
          `lock_${orderId}`,
          orderId
        );
      } else {
        // SELL: Lock base currency (e.g. BTC)
        this.ledger.lockOrderFunds(
          cmd.userId,
          this.pairConfig.baseAsset,
          cmd.amount,
          `lock_${orderId}`,
          orderId
        );
      }

      // Record initial order state in DB
      this.dbMgr.execute(
        `INSERT INTO orders (id, client_order_id, user_id, pair_id, side, order_type, price, amount, filled_amount, remaining_amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'NEW', ?, ?)`,
        [
          orderId,
          cmd.clientOrderId || null,
          cmd.userId,
          this.pairConfig.id,
          cmd.side,
          cmd.orderType,
          cmd.price,
          cmd.amount,
          cmd.amount,
          now,
          now,
        ]
      );

      this.emitEvent('ORDER_ACCEPTED', {
        orderId,
        userId: cmd.userId,
        side: cmd.side,
        orderType: cmd.orderType,
        price: cmd.price,
        amount: cmd.amount,
        timestamp: now,
      });

      // Match against book
      const fills: EngineTradeRecord[] = [];
      let remainingAmount = cmd.amount;

      if (cmd.side === 'BUY') {
        while (remainingAmount > 0 && this.book.asks.length > 0) {
          const bestAsk = this.book.asks[0];

          // For limit orders, price must satisfy: ask.price <= cmd.price
          if (cmd.orderType === 'LIMIT' && bestAsk.price > cmd.price) {
            break;
          }

          // Self-Trade Prevention (STP): Prevent matching against self orders
          if (bestAsk.userId === cmd.userId) {
            // Cancel the resting maker order of the same user to prevent self-trade
            this.internalCancelOrder(bestAsk.id, 'SELF_TRADE_PREVENTION');
            continue;
          }

          const fillAmount = Math.min(remainingAmount, bestAsk.remainingAmount);
          const matchPrice = bestAsk.price;
          const quoteTotal = computeTradeTotal(matchPrice, fillAmount, this.pairConfig.basePrecision);

          const trade = this.executeTradeMatch({
            makerOrder: bestAsk,
            takerOrderId: orderId,
            takerUserId: cmd.userId,
            takerSide: 'BUY',
            matchPrice,
            matchAmount: fillAmount,
            quoteTotal,
          });

          fills.push(trade);

          remainingAmount -= fillAmount;
          bestAsk.remainingAmount -= fillAmount;
          bestAsk.filledAmount += fillAmount;

          if (bestAsk.remainingAmount === 0) {
            this.book.cancelOrder(bestAsk.id);
            this.updateOrderStatus(bestAsk.id, 'FILLED', bestAsk.filledAmount, 0);
          } else {
            this.updateOrderStatus(bestAsk.id, 'PARTIALLY_FILLED', bestAsk.filledAmount, bestAsk.remainingAmount);
          }
        }
      } else {
        // SELL
        while (remainingAmount > 0 && this.book.bids.length > 0) {
          const bestBid = this.book.bids[0];

          // For limit orders, price must satisfy: bid.price >= cmd.price
          if (cmd.orderType === 'LIMIT' && bestBid.price < cmd.price) {
            break;
          }

          // Self-Trade Prevention (STP)
          if (bestBid.userId === cmd.userId) {
            this.internalCancelOrder(bestBid.id, 'SELF_TRADE_PREVENTION');
            continue;
          }

          const fillAmount = Math.min(remainingAmount, bestBid.remainingAmount);
          const matchPrice = bestBid.price;
          const quoteTotal = computeTradeTotal(matchPrice, fillAmount, this.pairConfig.basePrecision);

          const trade = this.executeTradeMatch({
            makerOrder: bestBid,
            takerOrderId: orderId,
            takerUserId: cmd.userId,
            takerSide: 'SELL',
            matchPrice,
            matchAmount: fillAmount,
            quoteTotal,
          });

          fills.push(trade);

          remainingAmount -= fillAmount;
          bestBid.remainingAmount -= fillAmount;
          bestBid.filledAmount += fillAmount;

          if (bestBid.remainingAmount === 0) {
            this.book.cancelOrder(bestBid.id);
            this.updateOrderStatus(bestBid.id, 'FILLED', bestBid.filledAmount, 0);
          } else {
            this.updateOrderStatus(bestBid.id, 'PARTIALLY_FILLED', bestBid.filledAmount, bestBid.remainingAmount);
          }
        }
      }

      // Update Taker Order Status
      const filledAmount = cmd.amount - remainingAmount;
      let finalStatus: OrderStatus = 'NEW';

      if (remainingAmount === 0) {
        finalStatus = 'FILLED';
        this.updateOrderStatus(orderId, 'FILLED', filledAmount, 0);
      } else if (filledAmount > 0) {
        if (cmd.orderType === 'LIMIT') {
          finalStatus = 'PARTIALLY_FILLED';
          this.updateOrderStatus(orderId, 'PARTIALLY_FILLED', filledAmount, remainingAmount);
          this.book.addLimitOrder({
            id: orderId,
            userId: cmd.userId,
            side: cmd.side,
            price: cmd.price,
            amount: cmd.amount,
            filledAmount,
            remainingAmount,
            timestamp: now,
          });
        } else {
          // Unfilled market orders are expired / cancelled
          finalStatus = 'CANCELLED';
          this.updateOrderStatus(orderId, 'CANCELLED', filledAmount, remainingAmount);
        }
      } else {
        // No fills
        if (cmd.orderType === 'LIMIT') {
          finalStatus = 'NEW';
          this.book.addLimitOrder({
            id: orderId,
            userId: cmd.userId,
            side: cmd.side,
            price: cmd.price,
            amount: cmd.amount,
            filledAmount: 0,
            remainingAmount: cmd.amount,
            timestamp: now,
          });
        } else {
          finalStatus = 'CANCELLED';
          this.updateOrderStatus(orderId, 'CANCELLED', 0, cmd.amount);
        }
      }

      return { orderId, fills, status: finalStatus };
    });
  }

  /**
   * Cancel an existing order
   */
  public async cancelOrder(orderId: string, userId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const order = this.dbMgr.queryOne<any>('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (!order) throw new Error('Order not found');
      if (order.user_id !== userId && userId !== 'admin') {
        throw new Error('Unauthorized to cancel this order');
      }
      if (['FILLED', 'CANCELLED', 'REJECTED'].includes(order.status)) {
        throw new Error(`Order cannot be cancelled in status ${order.status}`);
      }

      this.internalCancelOrder(orderId, 'USER_REQUEST');
      return true;
    });
  }

  private internalCancelOrder(orderId: string, reason: string): void {
    const bookOrder = this.book.cancelOrder(orderId);
    const order = this.dbMgr.queryOne<any>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return;

    const remaining = bookOrder ? bookOrder.remainingAmount : order.remaining_amount;

    // Return remaining locked balance to user's AVAILABLE account
    if (remaining > 0) {
      if (order.side === 'BUY') {
        const unlockQuote = computeTradeTotal(order.price, remaining, this.pairConfig.basePrecision);
        this.ledger.unlockOrderFunds(
          order.user_id,
          this.pairConfig.quoteAsset,
          unlockQuote,
          `unlock_${orderId}_${Date.now()}`,
          reason
        );
      } else {
        this.ledger.unlockOrderFunds(
          order.user_id,
          this.pairConfig.baseAsset,
          remaining,
          `unlock_${orderId}_${Date.now()}`,
          reason
        );
      }
    }

    this.updateOrderStatus(orderId, 'CANCELLED', order.filled_amount, remaining);
    this.emitEvent('ORDER_CANCELLED', { orderId, reason, remainingAmount: remaining });
  }

  private executeTradeMatch(params: {
    makerOrder: BookOrder;
    takerOrderId: string;
    takerUserId: string;
    takerSide: OrderSide;
    matchPrice: number;
    matchAmount: number;
    quoteTotal: number;
  }): EngineTradeRecord {
    const tradeId = `trd_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    const isBuyerTaker = params.takerSide === 'BUY';
    const buyerId = isBuyerTaker ? params.takerUserId : params.makerOrder.userId;
    const sellerId = isBuyerTaker ? params.makerOrder.userId : params.takerUserId;

    // Settle in atomic Ledger
    this.ledger.settleTrade({
      pairId: this.pairConfig.id,
      baseAsset: this.pairConfig.baseAsset,
      quoteAsset: this.pairConfig.quoteAsset,
      price: params.matchPrice,
      amount: params.matchAmount,
      quoteTotal: params.quoteTotal,
      buyerId,
      sellerId,
      buyerIsTaker: isBuyerTaker,
      buyerFeeBps: isBuyerTaker ? this.pairConfig.takerFeeBps : this.pairConfig.makerFeeBps,
      sellerFeeBps: isBuyerTaker ? this.pairConfig.makerFeeBps : this.pairConfig.takerFeeBps,
      makerOrderId: params.makerOrder.id,
      takerOrderId: params.takerOrderId,
      idempotencyKey: `trade_settle_${tradeId}`,
    });

    const makerFee = isBuyerTaker
      ? calculateBpsFee(params.quoteTotal, this.pairConfig.makerFeeBps).feeAmount
      : calculateBpsFee(params.matchAmount, this.pairConfig.makerFeeBps).feeAmount;

    const takerFee = isBuyerTaker
      ? calculateBpsFee(params.matchAmount, this.pairConfig.takerFeeBps).feeAmount
      : calculateBpsFee(params.quoteTotal, this.pairConfig.takerFeeBps).feeAmount;

    this.dbMgr.execute(
      `INSERT INTO trades (id, pair_id, price, amount, total, side, maker_order_id, taker_order_id, maker_user_id, taker_user_id, maker_fee, taker_fee, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tradeId,
        this.pairConfig.id,
        params.matchPrice,
        params.matchAmount,
        params.quoteTotal,
        params.takerSide,
        params.makerOrder.id,
        params.takerOrderId,
        params.makerOrder.userId,
        params.takerUserId,
        makerFee,
        takerFee,
        now,
      ]
    );

    const trade: EngineTradeRecord = {
      id: tradeId,
      pairId: this.pairConfig.id,
      price: params.matchPrice,
      amount: params.matchAmount,
      total: params.quoteTotal,
      side: params.takerSide,
      makerOrderId: params.makerOrder.id,
      takerOrderId: params.takerOrderId,
      makerUserId: params.makerOrder.userId,
      takerUserId: params.takerUserId,
      makerFee,
      takerFee,
      timestamp: now,
    };

    this.emitEvent('TRADE_EXECUTED', trade);
    return trade;
  }

  private updateOrderStatus(orderId: string, status: OrderStatus, filled: number, remaining: number): void {
    this.dbMgr.execute(
      `UPDATE orders SET status = ?, filled_amount = ?, remaining_amount = ?, updated_at = ? WHERE id = ?`,
      [status, filled, remaining, Date.now(), orderId]
    );
  }

  public getDepth(levels: number = 20): OrderBookDepth {
    return this.book.getDepth(levels);
  }
}
