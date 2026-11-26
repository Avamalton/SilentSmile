import { BookOrder, MarketPair } from '../../simulation/types';
import { safeRound } from '../../utils/formatters';
import { buildEnhancedOrderBook, getPairNativeTick, OrderBookDepthLimit } from './orderBookUtils';

export type MarketSentimentBias =
  | 'Strongly Bullish'
  | 'Bullish'
  | 'Neutral'
  | 'Bearish'
  | 'Strongly Bearish'
  | 'Unavailable';

export interface MarketSentimentSnapshot {
  pairId: string;
  depthLimit: OrderBookDepthLimit;
  bullishPct: number | null;
  bearishPct: number | null;
  bias: MarketSentimentBias;
  bidDepthBase: number;
  askDepthBase: number;
  bidDepthNotional: number;
  askDepthNotional: number;
  bidLevelsAnalyzed: number;
  askLevelsAnalyzed: number;
  rawBestBid: number | null;
  rawBestAsk: number | null;
}

/**
 * Analyzes recent (nearest-to-market) resting order book depth up to `depthLimit` levels
 * per side and computes Bullish (buy support) vs Bearish (sell resistance) pressure %.
 */
export function computeMarketSentiment(params: {
  restingOrders: BookOrder[];
  pair: MarketPair;
  currentUserId?: string;
  configuredTick?: number;
  depthLimit?: OrderBookDepthLimit;
  now?: number;
}): MarketSentimentSnapshot {
  const {
    restingOrders,
    pair,
    currentUserId,
    configuredTick,
    depthLimit = 20,
    now = Date.now(),
  } = params;

  const nativeTick = getPairNativeTick(pair, configuredTick);
  const book = buildEnhancedOrderBook({
    restingOrders,
    pair,
    currentUserId,
    groupSize: nativeTick,
    depthLimit,
    now,
  });

  const bidDepthBase = book.visibleBidTotal;
  const askDepthBase = book.visibleAskTotal;

  const bidDepthNotional = book.bids.reduce((sum, lvl) => sum + lvl.price * lvl.amount, 0);
  const askDepthNotional = book.asks.reduce((sum, lvl) => sum + lvl.price * lvl.amount, 0);
  const totalNotional = bidDepthNotional + askDepthNotional;

  if (totalNotional <= 0) {
    return {
      pairId: pair.id,
      depthLimit,
      bullishPct: null,
      bearishPct: null,
      bias: 'Unavailable',
      bidDepthBase: 0,
      askDepthBase: 0,
      bidDepthNotional: 0,
      askDepthNotional: 0,
      bidLevelsAnalyzed: 0,
      askLevelsAnalyzed: 0,
      rawBestBid: book.rawBestBid,
      rawBestAsk: book.rawBestAsk,
    };
  }

  const bullishPct = safeRound((bidDepthNotional / totalNotional) * 100, 1);
  const bearishPct = safeRound(100 - bullishPct, 1);

  let bias: MarketSentimentBias = 'Neutral';
  if (bullishPct >= 62) {
    bias = 'Strongly Bullish';
  } else if (bullishPct >= 53) {
    bias = 'Bullish';
  } else if (bullishPct <= 38) {
    bias = 'Strongly Bearish';
  } else if (bullishPct <= 47) {
    bias = 'Bearish';
  }

  return {
    pairId: pair.id,
    depthLimit,
    bullishPct,
    bearishPct,
    bias,
    bidDepthBase,
    askDepthBase,
    bidDepthNotional: Math.round(bidDepthNotional),
    askDepthNotional: Math.round(askDepthNotional),
    bidLevelsAnalyzed: book.bids.length,
    askLevelsAnalyzed: book.asks.length,
    rawBestBid: book.rawBestBid,
    rawBestAsk: book.rawBestAsk,
  };
}
