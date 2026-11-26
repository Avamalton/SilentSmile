import React, { useState } from 'react';
import { useSimulation } from '../../simulation/store';
import { formatIDR, formatCrypto, formatPercentage, formatTime } from '../../utils/formatters';
import { ArrowDown, ArrowUp, Layers, Bot, Shield, Zap } from 'lucide-react';
import { MarketMakerPanel } from './MarketMakerPanel';

interface OrderBookProps {
  onSelectPrice?: (price: number) => void;
}

export const OrderBook: React.FC<OrderBookProps> = ({ onSelectPrice }) => {
  const { activePair, orderBook, marketTrades, mmConfig, currentUser } = useSimulation();
  const [activeTab, setActiveTab] = useState<'book' | 'trades' | 'mm'>('book');
  const [viewMode, setViewMode] = useState<'both' | 'bids' | 'asks'>('both');

  const latestTrade = marketTrades[0];
  const isUp = latestTrade ? latestTrade.side === 'buy' : activePair.change24h >= 0;

  // Filter asks and bids based on viewMode
  const displayedAsks =
    viewMode === 'bids'
      ? []
      : viewMode === 'both'
      ? orderBook.asks.slice(-7)
      : orderBook.asks.slice(-14);

  const displayedBids =
    viewMode === 'asks'
      ? []
      : viewMode === 'both'
      ? orderBook.bids.slice(0, 7)
      : orderBook.bids.slice(0, 14);

  return (
    <div className="flex flex-col h-full w-full glass-panel rounded-xl overflow-hidden text-xs">
      {/* Header Tabs: Order Book vs Recent Trades vs MM Bot (MM role only) */}
      <div className="flex items-center justify-between border-b border-[#26372D] bg-[#101A15] px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('book')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
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
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
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
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
                activeTab === 'mm'
                  ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/35 font-semibold'
                  : 'text-[#A1ADA5] hover:text-[#34D399] hover:bg-[#192820]'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>MM Bot</span>
            </button>
          )}
        </div>

        {/* View Mode Icons */}
        {activeTab === 'book' && (
          <div className="flex items-center gap-1 bg-[#0B100E] rounded p-0.5 border border-[#26372D]">
            <button
              type="button"
              onClick={() => setViewMode('both')}
              className={`p-1 rounded ${
                viewMode === 'both' ? 'bg-[#192820] text-[#34D399]' : 'text-[#647168] hover:text-[#A1ADA5]'
              }`}
              title="Combined Order Book"
              aria-label="Combined Order Book"
            >
              <div className="w-3.5 h-3 flex flex-col justify-between">
                <span className="w-full h-1 bg-[#EF6464] rounded-[1px]"></span>
                <span className="w-full h-1 bg-[#10B981] rounded-[1px]"></span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('bids')}
              className={`p-1 rounded ${
                viewMode === 'bids' ? 'bg-[#192820] text-[#10B981]' : 'text-[#647168] hover:text-[#A1ADA5]'
              }`}
              title="Bids Only"
              aria-label="Bids Only"
            >
              <div className="w-3.5 h-3 flex flex-col justify-end">
                <span className="w-full h-2.5 bg-[#10B981] rounded-[1px]"></span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('asks')}
              className={`p-1 rounded ${
                viewMode === 'asks' ? 'bg-[#192820] text-[#EF6464]' : 'text-[#647168] hover:text-[#A1ADA5]'
              }`}
              title="Asks Only"
              aria-label="Asks Only"
            >
              <div className="w-3.5 h-3 flex flex-col justify-start">
                <span className="w-full h-2.5 bg-[#EF6464] rounded-[1px]"></span>
              </div>
            </button>
          </div>
        )}
      </div>

      {activeTab === 'book' ? (
        <div className="flex flex-col flex-1 min-h-0 font-mono-nums">
          {/* Column Header */}
          <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] font-medium text-[#A1ADA5] border-b border-[#26372D] bg-[#101A15]">
            <span>Price (IDR)</span>
            <span className="text-right">Size ({activePair.baseAsset})</span>
            <span className="text-right">Total</span>
          </div>

          {/* Asks (Sells) - rendered in muted institutional red */}
          <div className="flex flex-col justify-end overflow-hidden flex-1 px-1 py-0.5">
            {displayedAsks.map((ask, idx) => (
              <div
                key={`ask-${idx}-${ask.price}`}
                onClick={() => onSelectPrice && onSelectPrice(ask.price)}
                className={`group relative grid grid-cols-3 px-2 py-0.5 text-[11.5px] cursor-pointer hover:bg-[#192820] rounded transition-colors ${
                  ask.myOrderAmount ? 'bg-[#064E3B]/25 border-l-2 border-[#10B981]' : ''
                }`}
                title={`Click to fill limit price. ${ask.orderCount} order(s) at this level.${
                  ask.myOrderAmount ? ` You have ${ask.myOrderAmount} ${activePair.baseAsset} resting here.` : ''
                }`}
              >
                {/* Subtle red depth bar in background */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-[#EF6464]/15 pointer-events-none transition-all duration-300 rounded-r-[2px]"
                  style={{ width: `${ask.depthPercent}%` }}
                />

                <span className="text-[#EF6464] font-medium z-10 flex items-center gap-1 tabular-nums">
                  {formatIDR(ask.price)}
                  {ask.myOrderAmount && (
                    <span className="px-1 py-0.1 rounded bg-[#064E3B] text-[#34D399] text-[8.5px] font-bold border border-[#10B981]/40 font-sans">
                      YOU
                    </span>
                  )}
                  {ask.isWall && (
                    <span className="px-1 py-0.1 rounded bg-[#EAB866]/20 text-[#EAB866] text-[8.5px] font-bold border border-[#EAB866]/40 font-sans">
                      WALL
                    </span>
                  )}
                </span>
                <span className="text-right text-[#F1F5F2] z-10 tabular-nums">
                  {formatCrypto(ask.amount, activePair.amountDecimals)}
                </span>
                <span className="text-right text-[#647168] z-10 tabular-nums">
                  {formatCrypto(ask.total, activePair.amountDecimals)}
                </span>
              </div>
            ))}
          </div>

          {/* Middle Spread & Last Price Bar */}
          <div className="flex items-center justify-between px-3 py-1.5 my-0.5 bg-[#0B100E] border-y border-[#26372D]">
            <div className="flex items-center gap-1.5">
              <span
                className={`text-sm font-bold flex items-center tabular-nums ${
                  isUp ? 'text-[#10B981]' : 'text-[#EF6464]'
                }`}
              >
                {isUp ? (
                  <ArrowUp className="w-3.5 h-3.5 inline mr-0.5" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 inline mr-0.5" />
                )}
                {formatIDR(activePair.lastPrice)}
              </span>
              <span className="text-[11px] text-[#647168] tabular-nums">
                {activePair.change24h >= 0 ? '+' : ''}
                {activePair.change24h.toFixed(2)}%
              </span>
            </div>
            <div className="text-[11px] text-[#A1ADA5]">
              Spread:{' '}
              <span className="text-[#F1F5F2] font-medium tabular-nums">
                {formatIDR(orderBook.spread)}
              </span>{' '}
              <span className="text-[#647168] tabular-nums">({orderBook.spreadPercent}%)</span>
            </div>
          </div>

          {/* Bids (Buys) - rendered in emerald */}
          <div className="flex flex-col justify-start overflow-hidden flex-1 px-1 py-0.5">
            {displayedBids.map((bid, idx) => (
              <div
                key={`bid-${idx}-${bid.price}`}
                onClick={() => onSelectPrice && onSelectPrice(bid.price)}
                className={`group relative grid grid-cols-3 px-2 py-0.5 text-[11.5px] cursor-pointer hover:bg-[#192820] rounded transition-colors ${
                  bid.myOrderAmount ? 'bg-[#064E3B]/25 border-l-2 border-[#10B981]' : ''
                }`}
                title={`Click to fill limit price. ${bid.orderCount} order(s) at this level.${
                  bid.myOrderAmount ? ` You have ${bid.myOrderAmount} ${activePair.baseAsset} resting here.` : ''
                }`}
              >
                {/* Subtle emerald depth bar in background */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-[#10B981]/15 pointer-events-none transition-all duration-300 rounded-r-[2px]"
                  style={{ width: `${bid.depthPercent}%` }}
                />

                <span className="text-[#10B981] font-medium z-10 flex items-center gap-1 tabular-nums">
                  {formatIDR(bid.price)}
                  {bid.myOrderAmount && (
                    <span className="px-1 py-0.1 rounded bg-[#064E3B] text-[#34D399] text-[8.5px] font-bold border border-[#10B981]/40 font-sans">
                      YOU
                    </span>
                  )}
                  {bid.isWall && (
                    <span className="px-1 py-0.1 rounded bg-[#EAB866]/20 text-[#EAB866] text-[8.5px] font-bold border border-[#EAB866]/40 font-sans">
                      WALL
                    </span>
                  )}
                </span>
                <span className="text-right text-[#F1F5F2] z-10 tabular-nums">
                  {formatCrypto(bid.amount, activePair.amountDecimals)}
                </span>
                <span className="text-right text-[#647168] z-10 tabular-nums">
                  {formatCrypto(bid.total, activePair.amountDecimals)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : activeTab === 'trades' ? (
        /* Market Trades View */
        <div className="flex flex-col flex-1 min-h-0 font-mono-nums">
          <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] font-medium text-[#A1ADA5] border-b border-[#26372D] bg-[#101A15]">
            <span>Price (IDR)</span>
            <span className="text-right">Size ({activePair.baseAsset})</span>
            <span className="text-right">Time</span>
          </div>

          <div className="flex flex-col overflow-y-auto flex-1 px-1 py-1 divide-y divide-[#26372D]/40">
            {marketTrades.map((trade) => (
              <div
                key={trade.id}
                className="grid grid-cols-3 px-2 py-1 text-[11.5px] hover:bg-[#192820] rounded transition-colors tabular-nums"
              >
                <span
                  className={
                    trade.side === 'buy'
                      ? 'text-[#10B981] font-medium'
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
            ))}
          </div>
        </div>
      ) : (
        /* Market Maker Bot View */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MarketMakerPanel />
        </div>
      )}
    </div>
  );
};
