import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { formatCrypto, formatTime } from '../../utils/formatters';
import { formatOrderBookPrice } from './orderBookUtils';

interface RecentTradesPanelProps {
  onSelectPrice?: (price: number) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  compact?: boolean;
}

export const RecentTradesPanel: React.FC<RecentTradesPanelProps> = ({
  onSelectPrice,
  collapsed = false,
  onToggleCollapse,
  compact = false,
}) => {
  const { activePair, marketTrades } = useSimulation();

  return (
    <div className="flex flex-col h-full w-full bg-[#142019] border border-[#26372D] rounded-xl overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#26372D] bg-[#101A15] px-2.5 py-1.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[#F1F5F2] truncate">
            Recent Trades
          </span>
          <span className="text-[10px] font-mono text-[#A1ADA5] truncate">
            {activePair.id}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-[#647168] tabular-nums whitespace-nowrap">
            {marketTrades.length} fills
          </span>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1 rounded text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] transition-colors"
              title={collapsed ? 'Expand Recent Trades' : 'Collapse Recent Trades'}
              aria-label={collapsed ? 'Expand Recent Trades' : 'Collapse Recent Trades'}
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="flex flex-col flex-1 min-h-0 font-mono-nums">
          {/* Column Headers */}
          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.85fr)] px-2.5 py-1 text-[10.5px] font-medium text-[#A1ADA5] border-b border-[#26372D] bg-[#101A15] font-sans shrink-0">
            <span className="truncate">Price ({activePair.quoteAsset})</span>
            <span className="text-right truncate pl-1">Size ({activePair.baseAsset})</span>
            <span className="text-right truncate pl-1">Time</span>
          </div>

          {/* Executions Feed */}
          <div className="flex-1 min-h-0 overflow-y-auto px-1 py-0.5 divide-y divide-[#26372D]/30">
            {marketTrades.length > 0 ? (
              marketTrades.map((trade) => (
                <button
                  key={trade.id}
                  type="button"
                  onClick={() => onSelectPrice?.(trade.price)}
                  className={`w-full grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.85fr)] items-center px-1.5 ${
                    compact ? 'py-[2.5px]' : 'py-[3.5px]'
                  } text-[11px] hover:bg-[#192820] rounded transition-colors tabular-nums text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#10B981]`}
                  title={`Click to fill order price ${formatOrderBookPrice(trade.price, activePair)}`}
                >
                  <span
                    className={`truncate font-medium ${
                      trade.side === 'buy' ? 'text-[#34D399]' : 'text-[#EF6464]'
                    }`}
                  >
                    {formatOrderBookPrice(trade.price, activePair)}
                  </span>
                  <span className="text-right text-[#F1F5F2] truncate pl-1">
                    {formatCrypto(trade.amount, activePair.amountDecimals)}
                  </span>
                  <span className="text-right text-[#647168] truncate pl-1">
                    {formatTime(trade.timestamp)}
                  </span>
                </button>
              ))
            ) : (
              <div className="flex items-center justify-center h-full min-h-[120px] text-[11px] text-[#647168] font-sans">
                No recent trades recorded for {activePair.id}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
