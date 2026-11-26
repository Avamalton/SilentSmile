import React, { useMemo, useState } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { formatCrypto, formatIDR } from '../../utils/formatters';
import { OrderBookDepthLimit } from './orderBookUtils';
import { computeMarketSentiment, MarketSentimentBias } from './marketSentimentUtils';

const SENTIMENT_DEPTH_OPTIONS: readonly OrderBookDepthLimit[] = [10, 20, 50] as const;

function getBiasTextColor(bias: MarketSentimentBias): string {
  switch (bias) {
    case 'Strongly Bullish':
    case 'Bullish':
      return 'text-[#34D399]';
    case 'Strongly Bearish':
    case 'Bearish':
      return 'text-[#EF6464]';
    case 'Neutral':
      return 'text-[#EAB866]';
    default:
      return 'text-[#647168]';
  }
}

export const MarketSentimentIndicator: React.FC = () => {
  const { activePair, restingOrders, pairMMBots, currentUser } = useSimulation();
  const [depthLimit, setDepthLimit] = useState<OrderBookDepthLimit>(20);

  const configuredTick = pairMMBots[activePair.id]?.tickSize;

  const sentiment = useMemo(
    () =>
      computeMarketSentiment({
        restingOrders,
        pair: activePair,
        currentUserId: currentUser.id,
        configuredTick,
        depthLimit,
      }),
    [restingOrders, activePair, currentUser.id, configuredTick, depthLimit]
  );

  const hasLiquidity = sentiment.bullishPct !== null && sentiment.bearishPct !== null;
  const bullishPct = sentiment.bullishPct ?? 50;
  const bearishPct = sentiment.bearishPct ?? 50;
  const biasColor = getBiasTextColor(sentiment.bias);

  return (
    <section
      aria-label="Market Sentiment Indicator"
      className="w-full rounded-xl bg-[#142019] border border-[#26372D] px-3 py-2 text-xs flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
    >
      {/* Left: Label, Bias Status & Depth Window Selector */}
      <div className="flex items-center justify-between lg:justify-start gap-3 shrink-0">
        <div className="flex items-center gap-2">
          {sentiment.bias === 'Bullish' || sentiment.bias === 'Strongly Bullish' ? (
            <TrendingUp className="w-3.5 h-3.5 text-[#10B981] shrink-0" aria-hidden="true" />
          ) : sentiment.bias === 'Bearish' || sentiment.bias === 'Strongly Bearish' ? (
            <TrendingDown className="w-3.5 h-3.5 text-[#EF6464] shrink-0" aria-hidden="true" />
          ) : (
            <Minus className="w-3.5 h-3.5 text-[#EAB866] shrink-0" aria-hidden="true" />
          )}

          <span className="font-semibold text-[#F1F5F2] whitespace-nowrap">
            Market Sentiment
          </span>
          <span className="text-[#26372D]">|</span>
          <span className={`font-semibold whitespace-nowrap ${biasColor}`} data-testid="sentiment-bias">
            {sentiment.bias}
          </span>
        </div>

        {/* Depth Level Selector (10 / 20 / 50 levels) */}
        <div
          className="flex items-center bg-[#0B100E] border border-[#26372D] rounded p-0.5 shrink-0"
          role="group"
          aria-label="Sentiment order book depth window"
        >
          {SENTIMENT_DEPTH_OPTIONS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setDepthLimit(lvl)}
              aria-pressed={depthLimit === lvl}
              className={`px-1.5 py-0.5 text-[10px] font-mono-nums rounded-[3px] transition-colors whitespace-nowrap shrink-0 ${
                depthLimit === lvl
                  ? 'bg-[#192820] text-[#34D399] font-semibold'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
              title={`Analyze nearest ${lvl} aggregated bid/ask levels`}
            >
              {lvl}L
            </button>
          ))}
        </div>
      </div>

      {/* Center / Right: Bullish vs Bearish Percentage Bar & Depth Breakdown */}
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        {/* Bullish Metrics */}
        <div className="flex items-center justify-between sm:justify-start gap-1.5 shrink-0 tabular-nums">
          <span className="text-[#34D399] font-semibold whitespace-nowrap" data-testid="sentiment-bullish-pct">
            Bullish {hasLiquidity ? `${bullishPct.toFixed(1)}%` : '—'}
          </span>
          {hasLiquidity && (
            <span
              className="text-[10.5px] text-[#A1ADA5] font-mono-nums whitespace-nowrap hidden xl:inline"
              title={`Bid Notional: ${formatIDR(sentiment.bidDepthNotional)}`}
            >
              ({formatCrypto(sentiment.bidDepthBase, activePair.amountDecimals)} {activePair.baseAsset})
            </span>
          )}
        </div>

        {/* Percentage Progress Bar */}
        <div
          className="flex-1 min-w-[120px] h-2 bg-[#0B100E] rounded-[3px] overflow-hidden flex border border-[#26372D]"
          role="progressbar"
          aria-label="Bullish versus Bearish order book depth ratio"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hasLiquidity ? bullishPct : 50}
          title={
            hasLiquidity
              ? `Top ${depthLimit} levels — Bids: ${formatIDR(sentiment.bidDepthNotional)} (${sentiment.bidLevelsAnalyzed} lvls) vs Asks: ${formatIDR(sentiment.askDepthNotional)} (${sentiment.askLevelsAnalyzed} lvls)`
              : 'Insufficient resting order book liquidity to compute sentiment'
          }
        >
          {hasLiquidity ? (
            <>
              <div
                className="h-full bg-[#10B981] transition-all duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${bullishPct}%` }}
              />
              <div
                className="h-full bg-[#EF6464] transition-all duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${bearishPct}%` }}
              />
            </>
          ) : (
            <div className="h-full w-full bg-[#192820]" />
          )}
        </div>

        {/* Bearish Metrics */}
        <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0 tabular-nums">
          {hasLiquidity && (
            <span
              className="text-[10.5px] text-[#A1ADA5] font-mono-nums whitespace-nowrap hidden xl:inline"
              title={`Ask Notional: ${formatIDR(sentiment.askDepthNotional)}`}
            >
              ({formatCrypto(sentiment.askDepthBase, activePair.amountDecimals)} {activePair.baseAsset})
            </span>
          )}
          <span className="text-[#EF6464] font-semibold whitespace-nowrap" data-testid="sentiment-bearish-pct">
            {hasLiquidity ? `${bearishPct.toFixed(1)}%` : '—'} Bearish
          </span>
        </div>
      </div>
    </section>
  );
};
