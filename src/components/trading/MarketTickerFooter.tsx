import React from 'react';
import { Wifi, WifiOff, PauseCircle } from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { formatIDR, formatPercentage } from '../../utils/formatters';
import { formatOrderBookPrice } from './orderBookUtils';

export const MarketTickerFooter: React.FC = () => {
  const { markets, activePair, selectPair, workerFeedHealth, settings } = useSimulation();

  const isPaused = settings.engineSpeed === 'paused';
  const hasLiveFeed =
    workerFeedHealth.wsConnected ||
    workerFeedHealth.binance.status === 'CONNECTED' ||
    workerFeedHealth.bybit.status === 'CONNECTED';

  const statusLabel = isPaused
    ? 'Engine Paused'
    : hasLiveFeed
    ? 'Stream Connected'
    : 'REST Feed Active';

  const statusColorClass = isPaused
    ? 'text-[#EAB866]'
    : hasLiveFeed
    ? 'text-[#10B981]'
    : 'text-[#A1ADA5]';

  return (
    <footer
      aria-label="Market ticker footer"
      className="w-full bg-[#101A15] border border-[#26372D] rounded-xl px-3 py-1.5 flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 text-[11px] shrink-0"
    >
      {/* Connection Status */}
      <div className={`flex items-center gap-1.5 shrink-0 font-medium ${statusColorClass}`}>
        {isPaused ? (
          <PauseCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : hasLiveFeed ? (
          <Wifi className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="whitespace-nowrap">{statusLabel}</span>
      </div>

      {/* Horizontal Clickable Market Ticker */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {markets.map((m) => {
          const isSelected = m.id === activePair.id;
          const isPositive = m.change24h >= 0;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => selectPair(m.id)}
              className={`flex items-center gap-2 px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                isSelected
                  ? 'bg-[#192820] border-[#10B981]/45 text-[#F1F5F2]'
                  : 'bg-[#0B100E]/60 border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#142019]'
              }`}
              title={`Switch active market to ${m.id}`}
            >
              <span className="font-semibold text-[10.5px]">{m.baseAsset}/{m.quoteAsset}</span>
              <span className="font-mono text-[10.5px] text-[#F1F5F2]">
                {formatOrderBookPrice(m.lastPrice, m)}
              </span>
              <span
                className={`font-mono text-[10px] font-medium ${
                  isPositive ? 'text-[#34D399]' : 'text-[#EF6464]'
                }`}
              >
                {formatPercentage(m.change24h)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Pair Fee & Volume Metadata */}
      <div className="hidden md:flex items-center gap-3 shrink-0 text-[#A1ADA5] tabular-nums whitespace-nowrap">
        <span>
          24h Vol:{' '}
          <span className="text-[#F1F5F2] font-medium">
            {formatIDR(activePair.volume24h, true)}
          </span>
        </span>
        <span className="text-[#26372D]">|</span>
        <span>
          Maker {(activePair.makerFeeBps / 100).toFixed(2)}% / Taker{' '}
          {(activePair.takerFeeBps / 100).toFixed(2)}%
        </span>
      </div>
    </footer>
  );
};
