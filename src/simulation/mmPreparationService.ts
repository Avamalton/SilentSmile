import { InitialListing, MMPreparationPhase, TradingAccessStatus } from './listingTypes';
import { BookOrder, MarketPair, UserBalance } from './types';
import { safeRound } from '../utils/formatters';

export interface MMMetrics {
  baseInventory: number;
  quoteInventory: number;
  bidDepth: number;
  askDepth: number;
  spreadBps: number;
  isInventorySufficient: boolean;
  isDepthSufficient: boolean;
  isSpreadSufficient: boolean;
}

export class MMPreparationService {
  /**
   * Evaluates current market maker inventory and order book status against readiness criteria
   */
  static evaluateMetrics(
    listing: InitialListing,
    mmBalances: Record<string, UserBalance>,
    restingOrders: BookOrder[]
  ): MMMetrics {
    const baseAsset = listing.base_asset;
    const quoteAsset = listing.quote_asset;

    const baseBal = mmBalances[baseAsset]?.free || 0;
    const quoteBal = mmBalances[quoteAsset]?.free || 0;

    const schedule = listing.schedule;
    const isInventorySufficient =
      baseBal >= schedule.min_base_inventory && quoteBal >= schedule.min_quote_inventory;

    // Filter resting orders for this pair placed by MM
    const pairOrders = restingOrders.filter((o) => o.pair === listing.symbol && o.remainingAmount > 0);
    const bids = pairOrders.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price);
    const asks = pairOrders.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price);

    const bidDepth = bids.length;
    const askDepth = asks.length;
    const isDepthSufficient = bidDepth >= 3 && askDepth >= 3;

    let spreadBps = 99999;
    if (bids.length > 0 && asks.length > 0) {
      const bestBid = bids[0].price;
      const bestAsk = asks[0].price;
      const mid = (bestBid + bestAsk) / 2;
      if (mid > 0 && bestAsk >= bestBid) {
        spreadBps = Math.round(((bestAsk - bestBid) / mid) * 10000);
      }
    }

    // Acceptable pre-launch spread: <= 200 bps (2.0%)
    const isSpreadSufficient = spreadBps <= 200;

    return {
      baseInventory: baseBal,
      quoteInventory: quoteBal,
      bidDepth,
      askDepth,
      spreadBps,
      isInventorySufficient,
      isDepthSufficient,
      isSpreadSufficient,
    };
  }

  /**
   * Deterministically transitions the MM preparation phase based on time and metrics
   */
  static evaluatePhase(
    listing: InitialListing,
    mmBalances: Record<string, UserBalance>,
    restingOrders: BookOrder[],
    currentTime: number = Date.now()
  ): {
    nextPhase: MMPreparationPhase;
    reason: string;
    metrics: MMMetrics;
  } {
    const metrics = this.evaluateMetrics(listing, mmBalances, restingOrders);
    const schedule = listing.schedule;

    // Before funding opens
    if (currentTime < schedule.mm_funding_opens_at) {
      return {
        nextPhase: 'NOT_STARTED',
        reason: 'Current time is before MM funding window opens.',
        metrics,
      };
    }

    // Between funding open and setup open
    if (currentTime >= schedule.mm_funding_opens_at && currentTime < schedule.mm_setup_opens_at) {
      if (metrics.isInventorySufficient) {
        return {
          nextPhase: 'FUNDING_COMPLETE',
          reason: 'MM accounts have met minimum inventory requirements.',
          metrics,
        };
      }
      return {
        nextPhase: 'FUNDING_OPEN',
        reason: 'MM funding window is active, awaiting capital allocation.',
        metrics,
      };
    }

    // Setup window (between mm_setup_opens_at and public_trading_opens_at)
    if (currentTime >= schedule.mm_setup_opens_at && currentTime < schedule.public_trading_opens_at) {
      if (!metrics.isInventorySufficient) {
        return {
          nextPhase: 'FUNDING_OPEN',
          reason: 'Setup open reached but MM inventory remains deficient.',
          metrics,
        };
      }

      if (metrics.isDepthSufficient && metrics.isSpreadSufficient) {
        return {
          nextPhase: 'READY',
          reason: 'MM resting quotes and inventory satisfy all pre-launch readiness gates.',
          metrics,
        };
      }

      return {
        nextPhase: 'ORDER_SETUP_OPEN',
        reason: 'MM quote setup window is active, resting quotes need to meet depth and spread requirements.',
        metrics,
      };
    }

    // Past public trading open
    if (currentTime >= schedule.public_trading_opens_at) {
      if (metrics.isInventorySufficient && metrics.isDepthSufficient && metrics.isSpreadSufficient) {
        return {
          nextPhase: 'READY',
          reason: 'Market is ready for public launch.',
          metrics,
        };
      }
      return {
        nextPhase: 'FAILED',
        reason: 'Public launch time reached without meeting required MM inventory and order book depth.',
        metrics,
      };
    }

    return {
      nextPhase: listing.mm_preparation_phase,
      reason: 'No change in MM preparation phase.',
      metrics,
    };
  }

  /**
   * Generates initial pre-launch resting quotes for an MM account
   */
  static generatePreLaunchQuotes(params: {
    listing: InitialListing;
    mmUserId: string;
    targetSpreadBps?: number;
    levelsCount?: number;
    baseVolumePerLevel?: number;
    currentTime?: number;
  }): BookOrder[] {
    const {
      listing,
      mmUserId,
      targetSpreadBps = 30, // 0.30%
      levelsCount = 5,
      baseVolumePerLevel = 1.0,
      currentTime = Date.now(),
    } = params;

    const basePrice = listing.initial_price > 0 ? listing.initial_price : 100000;
    const halfSpread = (basePrice * (targetSpreadBps / 10000)) / 2;

    const quotes: BookOrder[] = [];

    // Bids (buy)
    for (let i = 0; i < levelsCount; i++) {
      const stepPct = 0.002 * (i + 1);
      const price = safeRound(basePrice - halfSpread - basePrice * stepPct, listing.price_precision);
      const amount = safeRound(baseVolumePerLevel * (1 + i * 0.15), listing.amount_precision);
      quotes.push({
        id: `mm_pre_bid_${listing.symbol}_${i}_${currentTime}`,
        userId: mmUserId,
        pair: listing.symbol,
        side: 'buy',
        price,
        amount,
        remainingAmount: amount,
        createdAt: currentTime,
        isMM: true,
        isPreLaunch: true,
      });
    }

    // Asks (sell)
    for (let i = 0; i < levelsCount; i++) {
      const stepPct = 0.002 * (i + 1);
      const price = safeRound(basePrice + halfSpread + basePrice * stepPct, listing.price_precision);
      const amount = safeRound(baseVolumePerLevel * (1 + i * 0.15), listing.amount_precision);
      quotes.push({
        id: `mm_pre_ask_${listing.symbol}_${i}_${currentTime}`,
        userId: mmUserId,
        pair: listing.symbol,
        side: 'sell',
        price,
        amount,
        remainingAmount: amount,
        createdAt: currentTime,
        isMM: true,
        isPreLaunch: true,
      });
    }

    return quotes;
  }

  /**
   * Guards public trading during preparation: public users cannot trade unless OPEN
   */
  static canUserTrade(
    pair: MarketPair,
    userId: string,
    isMMUser: boolean
  ): { allowed: boolean; reason?: string } {
    const status = pair.tradingAccessStatus || (pair.isActive ? 'OPEN' : 'CLOSED');

    if (status === 'CLOSED') {
      return { allowed: false, reason: `Trading is closed for ${pair.id}.` };
    }

    if (status === 'HALTED') {
      return { allowed: false, reason: `Trading for ${pair.id} has been halted.` };
    }

    if (status === 'PREPARATION_ONLY') {
      if (!isMMUser) {
        return {
          allowed: false,
          reason: `Trading for ${pair.id} is in MM Preparation mode. Public trading is not yet open.`,
        };
      }
      return { allowed: true };
    }

    // OPEN
    return { allowed: true };
  }

  /**
   * Guards against crossing pre-launch orders before public launch
   */
  static canMatchOrder(
    restingOrder: BookOrder,
    marketTradingStatus: TradingAccessStatus = 'OPEN',
    isTakerMM: boolean = false
  ): boolean {
    if (restingOrder.isPreLaunch) {
      if (marketTradingStatus !== 'OPEN') {
        // Pre-launch orders cannot be matched by anyone prior to OPEN
        return false;
      }
    }
    return true;
  }

  /**
   * Unlocks pre-launch orders when a listing transitions to LIVE
   */
  static unlockPreLaunchOrders(restingOrders: BookOrder[], symbol: string): BookOrder[] {
    return restingOrders.map((o) => {
      if (o.pair === symbol && o.isPreLaunch) {
        return { ...o, isPreLaunch: false };
      }
      return o;
    });
  }
}
