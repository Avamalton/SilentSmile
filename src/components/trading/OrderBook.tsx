import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, ChevronDown, ChevronUp } from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { MarketPair } from '../../simulation/types';
import { formatCrypto, formatIDR, formatTime } from '../../utils/formatters';
import { MarketMakerPanel } from './MarketMakerPanel';
import {
  buildEnhancedOrderBook,
  DEPTH_LEVEL_OPTIONS,
  formatGroupingStepLabel,
  formatOrderBookPrice,
  getAllPriceAggregationOptions,
  getPriceGroupingOptions,
  GroupedOrderBookLevel,
  OrderBookDepthLimit,
  OrderBookViewMode,
  STANDARD_PRICE_AGGREGATION_OPTIONS,
} from './orderBookUtils';

interface OrderBookProps {
  onSelectPrice?: (price: number) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  compact?: boolean;
}

interface OrderBookRowProps {
  side: 'buy' | 'sell';
  level: GroupedOrderBookLevel;
  pair: MarketPair;
  groupSize: number;
  onSelectPrice?: (price: number) => void;
}

const OrderBookRow: React.FC<OrderBookRowProps> = memo(
  ({ side, level, pair, groupSize, onSelectPrice }) => {
    const prevAmountRef = useRef<number | null>(null);
    const [flashState, setFlashState] = useState<'none' | 'up' | 'down'>('none');

    useEffect(() => {
      const prev = prevAmountRef.current;
      prevAmountRef.current = level.amount;

      if (prev === null || prev === level.amount) return;

      setFlashState(level.amount > prev ? 'up' : 'down');
      const timer = setTimeout(() => setFlashState('none'), 240);
      return () => clearTimeout(timer);
    }, [level.amount]);

    const isAsk = side === 'sell';
    const priceText = formatOrderBookPrice(level.price, pair, groupSize);
    const sizeText = formatCrypto(level.amount, pair.amountDecimals);
    const totalText = formatCrypto(level.total, pair.amountDecimals);
    const scaleX = Math.max(0, Math.min(1, level.depthPercent / 100));

    const barColorClass = isAsk ? 'bg-[#54252B]/75' : 'bg-[#123C2D]/85';
    const priceColorClass = isAsk ? 'text-[#EF6464]' : 'text-[#34D399]';
    const bestRowBg = level.isBest
      ? isAsk
        ? 'bg-[#54252B]/20'
        : 'bg-[#123C2D]/25'
      : '';
    const ownOrderBg = level.myOrderAmount ? 'bg-[#064E3B]/25' : '';
    const flashBg =
      flashState === 'up'
        ? isAsk
          ? 'bg-[#EF6464]/15'
          : 'bg-[#34D399]/15'
        : flashState === 'down'
        ? 'bg-[#F1F5F2]/8'
        : '';

    return (
      <button
        type="button"
        onClick={() => onSelectPrice?.(level.price)}
        className={`group relative w-full grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.95fr)] items-center px-2.5 py-[3px] text-[11px] leading-[1.35] text-left cursor-pointer hover:bg-[#192820] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#10B981] transition-colors duration-150 ${bestRowBg} ${ownOrderBg}`}
        title={`${isAsk ? 'Ask' : 'Bid'} @ ${priceText} · ${level.orderCount} order(s) · Cumulative: ${totalText} ${pair.baseAsset}${
          level.myOrderAmount ? ` · Your resting order: ${formatCrypto(level.myOrderAmount, pair.amountDecimals)} ${pair.baseAsset}` : ''
        }`}
        aria-label={`${level.isBest ? `Best ${isAsk ? 'ask' : 'bid'} ` : ''}${priceText}, size ${sizeText}, cumulative ${totalText}`}
      >
        {/* Horizontal liquidity depth bar (compositor transform only) */}
        <span
          aria-hidden="true"
          className={`absolute inset-y-[1px] right-0 w-full origin-right pointer-events-none transition-transform duration-200 ease-out motion-reduce:transition-none ${barColorClass}`}
          style={{ transform: `scaleX(${scaleX})` }}
        />

        {/* Subtle row-only quantity change highlight */}
        <span
          aria-hidden="true"
          className={`absolute inset-0 pointer-events-none transition-opacity duration-200 motion-reduce:transition-none ${flashBg} ${
            flashState === 'none' ? 'opacity-0' : 'opacity-100'
          }`}
        />

        {/* Price + inline semantic markers (zero pill clutter) */}
        <span className={`relative z-10 flex items-center gap-1 font-medium tabular-nums truncate ${priceColorClass}`}>
          <span className="truncate">{priceText}</span>
          {level.isBest && (
            <span
              className={`shrink-0 text-[8.5px] font-semibold tracking-wider uppercase px-1 py-[0.5px] rounded-[2px] border font-sans ${
                isAsk
                  ? 'text-[#EF6464] border-[#EF6464]/35 bg-[#54252B]/40'
                  : 'text-[#34D399] border-[#34D399]/35 bg-[#123C2D]/50'
              }`}
            >
              Best
            </span>
          )}
          {level.myOrderAmount && (
            <span className="shrink-0 text-[8.5px] font-semibold uppercase px-1 py-[0.5px] rounded-[2px] bg-[#064E3B] text-[#34D399] border border-[#10B981]/40 font-sans">
              You
            </span>
          )}
          {level.isWall && (
            <span className="shrink-0 text-[8.5px] font-semibold uppercase px-1 py-[0.5px] rounded-[2px] bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/35 font-sans">
              Wall
            </span>
          )}
        </span>

        {/* Level Quantity */}
        <span className="relative z-10 text-right text-[#F1F5F2] tabular-nums truncate pl-1">
          {sizeText}
        </span>

        {/* Cumulative Quantity */}
        <span className="relative z-10 text-right text-[#A1ADA5] tabular-nums truncate pl-1">
          {totalText}
        </span>
      </button>
    );
  }
);

OrderBookRow.displayName = 'OrderBookRow';

export const OrderBook: React.FC<OrderBookProps> = ({
  onSelectPrice,
  collapsed = false,
  onToggleCollapse,
  compact = false,
}) => {
  const { activePair, restingOrders, marketTrades, pairMMBots, currentUser } = useSimulation();

  const [activeTab, setActiveTab] = useState<'book' | 'trades' | 'mm'>('book');
  const [viewMode, setViewMode] = useState<OrderBookViewMode>('both');
  const [depthLimit, setDepthLimit] = useState<OrderBookDepthLimit>(compact ? 5 : 10);

  const configuredTick = pairMMBots[activePair.id]?.tickSize;
  const groupingOptions = useMemo(
    () => getPriceGroupingOptions(activePair, configuredTick),
    [activePair, configuredTick]
  );
  const allAggregationOptions = useMemo(
    () => getAllPriceAggregationOptions(activePair, configuredTick),
    [activePair, configuredTick]
  );

  const [selectedGroupSize, setSelectedGroupSize] = useState<number>(() => groupingOptions[0]);

  // Reset selected price grouping cleanly to pair's native tick when active pair changes
  useEffect(() => {
    setSelectedGroupSize(groupingOptions[0]);
  }, [activePair.id, groupingOptions]);

  const effectiveGroupSize = allAggregationOptions.includes(selectedGroupSize)
    ? selectedGroupSize
    : groupingOptions[0];

  const snapshot = useMemo(
    () =>
      buildEnhancedOrderBook({
        restingOrders,
        pair: activePair,
        currentUserId: currentUser.id,
        groupSize: effectiveGroupSize,
        depthLimit,
      }),
    [restingOrders, activePair, currentUser.id, effectiveGroupSize, depthLimit]
  );

  // Display asks ordered from highest visible ask down to Best Ask (immediately above center bar)
  const asksForDisplay = useMemo(() => [...snapshot.asks].reverse(), [snapshot.asks]);
  const bidsForDisplay = snapshot.bids;

  const latestTrade = marketTrades[0];
  const isUp = latestTrade ? latestTrade.side === 'buy' : activePair.change24h >= 0;

  // Scroll containers: preserve user scroll position during live ticks,
  // only anchor asks near Best Ask when switching pair/viewMode/depthLimit.
  const askScrollRef = useRef<HTMLDivElement>(null);
  const bidScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (askScrollRef.current) {
      askScrollRef.current.scrollTop = askScrollRef.current.scrollHeight;
    }
    if (bidScrollRef.current) {
      bidScrollRef.current.scrollTop = 0;
    }
  }, [activePair.id, viewMode, depthLimit, activeTab]);

  // If currentUser switches away from market_maker while MM tab is selected, fall back cleanly
  useEffect(() => {
    if (activeTab === 'mm' && currentUser.role !== 'market_maker') {
      setActiveTab('book');
    }
  }, [activeTab, currentUser.role]);

  const renderMarketPriceCenter = () => (
    <div className="shrink-0 bg-[#0B100E] border-y border-[#26372D] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelectPrice?.(activePair.lastPrice)}
          className="flex items-center gap-1.5 text-left hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#10B981] rounded"
          title="Last traded market price — click to populate order form"
        >
          <span
            className={`text-sm font-bold flex items-center gap-0.5 tabular-nums whitespace-nowrap ${
              isUp ? 'text-[#34D399]' : 'text-[#EF6464]'
            }`}
          >
            {isUp ? (
              <ArrowUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
            {formatOrderBookPrice(activePair.lastPrice, activePair)}
          </span>
          <span
            className={`text-[10.5px] font-medium tabular-nums whitespace-nowrap ${
              activePair.change24h >= 0 ? 'text-[#34D399]' : 'text-[#EF6464]'
            }`}
          >
            {activePair.change24h >= 0 ? '+' : ''}
            {activePair.change24h.toFixed(2)}%
          </span>
        </button>

        {/* Exact Market Spread (from actual raw best bid & best ask) */}
        <div className="text-right text-[10.5px] text-[#A1ADA5] tabular-nums whitespace-nowrap">
          {snapshot.spread !== null && snapshot.spreadPercent !== null ? (
            <span>
              Spread{' '}
              <span className="text-[#F1F5F2] font-medium">
                {formatOrderBookPrice(snapshot.spread, activePair)}
              </span>{' '}
              <span className="text-[#647168]">({snapshot.spreadPercent.toFixed(3)}%)</span>
            </span>
          ) : (
            <span className="text-[#647168]" title="Both bid and ask liquidity are required to compute spread">
              Spread — Unavailable
            </span>
          )}
        </div>
      </div>

      {/* Best Bid / Best Ask Reference Strip */}
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[#A1ADA5] tabular-nums">
        <span className="truncate">
          Best Bid:{' '}
          <span className="text-[#34D399] font-medium">
            {snapshot.rawBestBid !== null
              ? formatOrderBookPrice(snapshot.rawBestBid, activePair)
              : 'Unavailable'}
          </span>
        </span>
        <span className="truncate text-right">
          Best Ask:{' '}
          <span className="text-[#EF6464] font-medium">
            {snapshot.rawBestAsk !== null
              ? formatOrderBookPrice(snapshot.rawBestAsk, activePair)
              : 'Unavailable'}
          </span>
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full bg-[#142019] border border-[#26372D] rounded-xl overflow-hidden text-xs">
      {/* Primary Header Row: Navigation Tabs & View Mode Switcher */}
      <div className="flex items-center justify-between gap-2 border-b border-[#26372D] bg-[#101A15] px-2.5 py-1.5 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('book')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'book'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#26372D]'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Order Book
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('trades')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'trades'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#26372D]'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Trades
          </button>
          {currentUser.role === 'market_maker' && (
            <button
              type="button"
              onClick={() => setActiveTab('mm')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
                activeTab === 'mm'
                  ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/35 font-semibold'
                  : 'text-[#A1ADA5] hover:text-[#34D399] hover:bg-[#192820]'
              }`}
            >
              <Bot className="w-3.5 h-3.5 shrink-0" />
              <span>MM Bot</span>
            </button>
          )}
        </div>

        {/* Display Mode Controls & Optional Collapse Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          {activeTab === 'book' && !collapsed && (
            <div className="flex items-center gap-0.5 bg-[#0B100E] rounded p-0.5 border border-[#26372D] shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('both')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'both' ? 'bg-[#192820] text-[#34D399]' : 'text-[#647168] hover:text-[#A1ADA5]'
                }`}
                title="Combined Asks & Bids"
                aria-label="Combined Order Book"
                aria-pressed={viewMode === 'both'}
              >
                <div className="w-3.5 h-3 flex flex-col justify-between">
                  <span className="w-full h-1 bg-[#EF6464] rounded-[1px]" />
                  <span className="w-full h-1 bg-[#34D399] rounded-[1px]" />
                </div>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('bids')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'bids' ? 'bg-[#192820] text-[#34D399]' : 'text-[#647168] hover:text-[#A1ADA5]'
                }`}
                title="Bids Only"
                aria-label="Bids Only"
                aria-pressed={viewMode === 'bids'}
              >
                <div className="w-3.5 h-3 flex flex-col justify-end">
                  <span className="w-full h-2.5 bg-[#34D399] rounded-[1px]" />
                </div>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('asks')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'asks' ? 'bg-[#192820] text-[#EF6464]' : 'text-[#647168] hover:text-[#A1ADA5]'
                }`}
                title="Asks Only"
                aria-label="Asks Only"
                aria-pressed={viewMode === 'asks'}
              >
                <div className="w-3.5 h-3 flex flex-col justify-start">
                  <span className="w-full h-2.5 bg-[#EF6464] rounded-[1px]" />
                </div>
              </button>
            </div>
          )}

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1 rounded text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] transition-colors"
              title={collapsed ? 'Expand Order Book' : 'Collapse Order Book'}
              aria-label={collapsed ? 'Expand Order Book' : 'Collapse Order Book'}
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
      {/* Sub-Header Controls: Depth Level Selector & Price Grouping Selector */}
      {activeTab === 'book' && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-[#26372D] bg-[#0B100E]/70 shrink-0">
          {/* Depth Level Selector (5 / 10 / 20 / 50) */}
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] text-[#A1ADA5] whitespace-nowrap shrink-0 hidden sm:inline">
              Depth
            </span>
            <div
              className="flex items-center bg-[#101A15] border border-[#26372D] rounded p-0.5"
              role="group"
              aria-label="Order book depth levels"
            >
              {DEPTH_LEVEL_OPTIONS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setDepthLimit(lvl)}
                  aria-pressed={depthLimit === lvl}
                  className={`px-1.5 py-0.5 text-[10.5px] font-mono-nums rounded-[3px] transition-colors whitespace-nowrap shrink-0 ${
                    depthLimit === lvl
                      ? 'bg-[#192820] text-[#34D399] font-semibold'
                      : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          {/* Price Grouping Selector */}
          <div className="flex items-center gap-1.5 shrink-0">
            <label
              htmlFor="ob-price-grouping"
              className="text-[10px] text-[#A1ADA5] whitespace-nowrap shrink-0"
            >
              Group
            </label>
            <select
              id="ob-price-grouping"
              aria-label="Price aggregation interval"
              value={effectiveGroupSize}
              onChange={(e) => setSelectedGroupSize(Number(e.target.value))}
              className="bg-[#101A15] text-[#F1F5F2] border border-[#26372D] hover:border-[#364E40] focus:border-[#10B981] focus:outline-none rounded px-1.5 py-0.5 text-[10.5px] font-mono-nums cursor-pointer"
            >
              {activePair.priceDecimals === 0 ? (
                <>
                  <optgroup label="Pair Tick Intervals" className="bg-[#101A15] text-[#A1ADA5]">
                    {groupingOptions.map((step) => (
                      <option key={`tick-${step}`} value={step} className="bg-[#101A15] text-[#F1F5F2]">
                        {formatGroupingStepLabel(step, activePair)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Precision Intervals" className="bg-[#101A15] text-[#A1ADA5]">
                    {STANDARD_PRICE_AGGREGATION_OPTIONS.map((step) => (
                      <option key={`dec-${step}`} value={step} className="bg-[#101A15] text-[#F1F5F2]">
                        {formatGroupingStepLabel(step, activePair)}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                allAggregationOptions.map((step) => (
                  <option key={step} value={step} className="bg-[#101A15] text-[#F1F5F2]">
                    {formatGroupingStepLabel(step, activePair)}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      )}

      {activeTab === 'book' ? (
        <div className="flex flex-col flex-1 min-h-0 font-mono-nums">
          {/* Column Header */}
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.95fr)] px-2.5 py-1 text-[10.5px] font-medium text-[#A1ADA5] border-b border-[#26372D] bg-[#101A15] font-sans shrink-0">
            <span className="truncate">Price ({activePair.quoteAsset})</span>
            <span className="text-right truncate pl-1">Size ({activePair.baseAsset})</span>
            <span className="text-right truncate pl-1">Cumulative</span>
          </div>

          {/* Ask Side — Sell Liquidity (above market price) */}
          {(viewMode === 'both' || viewMode === 'asks') && (
            <div
              ref={askScrollRef}
              className="flex-1 min-h-0 overflow-y-auto bg-[#142019]"
              aria-label="Ask orders"
            >
              <div className="min-h-full flex flex-col justify-end py-0.5">
                {asksForDisplay.length > 0 ? (
                  asksForDisplay.map((ask) => (
                    <OrderBookRow
                      key={`ask-${ask.price}`}
                      side="sell"
                      level={ask}
                      pair={activePair}
                      groupSize={effectiveGroupSize}
                      onSelectPrice={onSelectPrice}
                    />
                  ))
                ) : (
                  <div className="flex items-center justify-center py-6 text-[11px] text-[#647168] font-sans">
                    No resting ask liquidity
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Market Price Center */}
          {renderMarketPriceCenter()}

          {/* Bid Side — Buy Liquidity (below market price) */}
          {(viewMode === 'both' || viewMode === 'bids') && (
            <div
              ref={bidScrollRef}
              className="flex-1 min-h-0 overflow-y-auto bg-[#142019]"
              aria-label="Bid orders"
            >
              <div className="flex flex-col justify-start py-0.5">
                {bidsForDisplay.length > 0 ? (
                  bidsForDisplay.map((bid) => (
                    <OrderBookRow
                      key={`bid-${bid.price}`}
                      side="buy"
                      level={bid}
                      pair={activePair}
                      groupSize={effectiveGroupSize}
                      onSelectPrice={onSelectPrice}
                    />
                  ))
                ) : (
                  <div className="flex items-center justify-center py-6 text-[11px] text-[#647168] font-sans">
                    No resting buy liquidity
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bid / Ask Displayed-Depth Imbalance Indicator */}
          <div
            className="shrink-0 bg-[#101A15] border-t border-[#26372D] px-2.5 py-1.5"
            title="Displayed-depth ratio calculated from visible aggregated bid/ask cumulative quantities — descriptive only, not a prediction of market direction."
          >
            <div className="flex items-center justify-between text-[10px] mb-1 tabular-nums">
              {snapshot.bidImbalancePct !== null && snapshot.askImbalancePct !== null ? (
                <>
                  <span className="text-[#34D399] font-semibold">
                    Bid {snapshot.bidImbalancePct.toFixed(1)}%
                  </span>
                  <span className="text-[#647168] font-sans text-[9.5px] truncate px-1">
                    Visible Depth ({snapshot.bids.length}B / {snapshot.asks.length}A)
                  </span>
                  <span className="text-[#EF6464] font-semibold">
                    {snapshot.askImbalancePct.toFixed(1)}% Ask
                  </span>
                </>
              ) : (
                <span className="text-[#647168] font-sans w-full text-center">
                  Displayed Depth Imbalance — Unavailable (no visible liquidity)
                </span>
              )}
            </div>

            {snapshot.bidImbalancePct !== null && snapshot.askImbalancePct !== null ? (
              <div className="w-full h-1.5 bg-[#0B100E] rounded-[2px] overflow-hidden flex border border-[#26372D]/70">
                <div
                  className="h-full bg-[#10B981] transition-all duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${snapshot.bidImbalancePct}%` }}
                />
                <div
                  className="h-full bg-[#EF6464] transition-all duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${snapshot.askImbalancePct}%` }}
                />
              </div>
            ) : (
              <div className="w-full h-1.5 bg-[#0B100E] rounded-[2px] border border-[#26372D]/70" />
            )}
          </div>
        </div>
      ) : activeTab === 'trades' ? (
        /* Market Trades View (preserved) */
        <div className="flex flex-col flex-1 min-h-0 font-mono-nums">
          <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] font-medium text-[#A1ADA5] border-b border-[#26372D] bg-[#101A15] font-sans">
            <span>Price ({activePair.quoteAsset})</span>
            <span className="text-right">Size ({activePair.baseAsset})</span>
            <span className="text-right">Time</span>
          </div>

          <div className="flex flex-col overflow-y-auto flex-1 px-1 py-1 divide-y divide-[#26372D]/40">
            {marketTrades.length > 0 ? (
              marketTrades.map((trade) => (
                <div
                  key={trade.id}
                  onClick={() => onSelectPrice?.(trade.price)}
                  className="grid grid-cols-3 px-2 py-1 text-[11px] hover:bg-[#192820] rounded transition-colors tabular-nums cursor-pointer"
                >
                  <span
                    className={
                      trade.side === 'buy'
                        ? 'text-[#34D399] font-medium'
                        : 'text-[#EF6464] font-medium'
                    }
                  >
                    {formatIDR(trade.price)}
                  </span>
                  <span className="text-right text-[#F1F5F2]">
                    {formatCrypto(trade.amount, activePair.amountDecimals)}
                  </span>
                  <span className="text-right text-[#647168]">
                    {formatTime(trade.timestamp)}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-center py-8 text-[11px] text-[#647168] font-sans">
                No recent trades recorded
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Market Maker Bot View (preserved) */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MarketMakerPanel />
        </div>
      )}
        </>
      )}
    </div>
  );
};
