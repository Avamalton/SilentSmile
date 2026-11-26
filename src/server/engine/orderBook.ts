export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type OrderStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface BookOrder {
  id: string;
  userId: string;
  side: OrderSide;
  price: number;              // In quote integer units
  amount: number;             // In base integer units
  filledAmount: number;
  remainingAmount: number;
  timestamp: number;
}

export interface MatchResult {
  makerOrder: BookOrder;
  takerOrder: BookOrder;
  matchPrice: number;
  matchAmount: number;
  quoteTotal: number;
  makerFilled: boolean;
  takerFilled: boolean;
}

export interface OrderBookDepthLevel {
  price: number;
  amount: number;
  orderCount: number;
}

export interface OrderBookDepth {
  bids: OrderBookDepthLevel[]; // sorted descending by price
  asks: OrderBookDepthLevel[]; // sorted ascending by price
  timestamp: number;
}

export class OrderBook {
  public pairId: string;
  // Bids sorted descending by price (highest buy price first).
  // At same price, sorted ascending by timestamp (FIFO).
  public bids: BookOrder[] = [];
  // Asks sorted ascending by price (lowest sell price first).
  // At same price, sorted ascending by timestamp (FIFO).
  public asks: BookOrder[] = [];
  // Map of orderId -> BookOrder for O(1) lookups and cancellations
  public orderMap: Map<string, BookOrder> = new Map();

  constructor(pairId: string) {
    this.pairId = pairId;
  }

  /**
   * Insert limit order into book maintaining price-time priority
   */
  public addLimitOrder(order: BookOrder): void {
    this.orderMap.set(order.id, order);

    if (order.side === 'BUY') {
      // Insert into bids: highest price first, earlier timestamp first
      let idx = 0;
      while (
        idx < this.bids.length &&
        (this.bids[idx].price > order.price ||
          (this.bids[idx].price === order.price && this.bids[idx].timestamp <= order.timestamp))
      ) {
        idx++;
      }
      this.bids.splice(idx, 0, order);
    } else {
      // Insert into asks: lowest price first, earlier timestamp first
      let idx = 0;
      while (
        idx < this.asks.length &&
        (this.asks[idx].price < order.price ||
          (this.asks[idx].price === order.price && this.asks[idx].timestamp <= order.timestamp))
      ) {
        idx++;
      }
      this.asks.splice(idx, 0, order);
    }
  }

  /**
   * Cancel and remove an order from book
   */
  public cancelOrder(orderId: string): BookOrder | null {
    const order = this.orderMap.get(orderId);
    if (!order) return null;

    this.orderMap.delete(orderId);

    if (order.side === 'BUY') {
      const idx = this.bids.findIndex((o) => o.id === orderId);
      if (idx !== -1) this.bids.splice(idx, 1);
    } else {
      const idx = this.asks.findIndex((o) => o.id === orderId);
      if (idx !== -1) this.asks.splice(idx, 1);
    }

    return order;
  }

  /**
   * Get aggregated L2 depth up to a given limit
   */
  public getDepth(levels: number = 20): OrderBookDepth {
    const aggregate = (orders: BookOrder[]): OrderBookDepthLevel[] => {
      const priceMap = new Map<number, { amount: number; count: number }>();
      for (const ord of orders) {
        const existing = priceMap.get(ord.price) || { amount: 0, count: 0 };
        existing.amount += ord.remainingAmount;
        existing.count += 1;
        priceMap.set(ord.price, existing);
      }

      const result: OrderBookDepthLevel[] = [];
      for (const [price, val] of priceMap.entries()) {
        result.push({ price, amount: val.amount, orderCount: val.count });
        if (result.length >= levels) break;
      }
      return result;
    };

    return {
      bids: aggregate(this.bids),
      asks: aggregate(this.asks),
      timestamp: Date.now(),
    };
  }

  /**
   * Reset / clear book
   */
  public clear(): void {
    this.bids = [];
    this.asks = [];
    this.orderMap.clear();
  }
}
