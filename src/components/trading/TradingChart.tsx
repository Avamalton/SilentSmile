import React, { useEffect, useMemo, useState } from 'react';
import { useSimulation } from '../../simulation/store';
import { ChartMode, ChartPreferences } from './chartTypes';
import { DimonexDatafeed } from './dimonexDatafeed';
import { DimonexChart } from './DimonexChart';
import { TradingViewChart } from './TradingViewChart';
import { MarketDepthChart } from './MarketDepthChart';
import { TimeFrame } from '../../simulation/types';

const PREFS_STORAGE_KEY = 'silentsmile_chart_preferences_v1';

const DEFAULT_PREFERENCES: ChartPreferences = {
  mode: 'SILENT_SMILE_PRO',
  seriesStyle: 'candlestick',
  indicators: ['VOLUME', 'EMA9', 'EMA21'],
  autoScale: true,
  showGrid: true,
  timezone: 'Asia/Jakarta',
  activeLayoutName: 'Default',
  layouts: [],
};

function loadPreferences(): ChartPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      indicators: Array.isArray(parsed?.indicators) ? parsed.indicators : DEFAULT_PREFERENCES.indicators,
      layouts: Array.isArray(parsed?.layouts) ? parsed.layouts : [],
      timezone: 'Asia/Jakarta',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

const TIMEFRAMES: { label: string; value: TimeFrame }[] = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1D', value: '1D' },
];

interface TradingChartProps {
  onSelectPrice?: (price: number) => void;
}

export const TradingChart: React.FC<TradingChartProps> = ({ onSelectPrice }) => {
  const { activePair, timeframe, setTimeframe } = useSimulation();
  const [preferences, setPreferences] = useState<ChartPreferences>(() => loadPreferences());

  // Persist user chart preferences cleanly
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(preferences));
    } catch {}
  }, [preferences]);

  // Shared custom SILENT SMILE Datafeed instance (closed on unmount)
  const datafeed = useMemo(() => new DimonexDatafeed(), []);
  useEffect(() => {
    return () => {
      datafeed.destroy();
    };
  }, [datafeed]);

  const setMode = (mode: ChartMode) => {
    setPreferences((prev) => ({ ...prev, mode }));
  };

  const modeSwitcher = (
    <div className="flex items-center bg-[#0B100E] rounded-lg p-0.5 border border-[#26372D] shrink-0">
      <button
        type="button"
        onClick={() => setMode('SILENT_SMILE_PRO')}
        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
          preferences.mode === 'SILENT_SMILE_PRO'
            ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40 font-semibold'
            : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
        }`}
      >
        SILENT SMILE Pro
      </button>
      <button
        type="button"
        onClick={() => setMode('TRADINGVIEW_ADVANCED')}
        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
          preferences.mode === 'TRADINGVIEW_ADVANCED'
            ? 'bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/35 font-semibold'
            : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
        }`}
      >
        TradingView
      </button>
      <button
        type="button"
        onClick={() => setMode('MARKET_DEPTH')}
        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
          preferences.mode === 'MARKET_DEPTH'
            ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40 font-semibold'
            : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
        }`}
      >
        Depth
      </button>
    </div>
  );

  if (preferences.mode === 'MARKET_DEPTH') {
    return (
      <MarketDepthChart
        modeSwitcherSlot={modeSwitcher}
        onSelectPrice={onSelectPrice}
      />
    );
  }

  if (preferences.mode === 'TRADINGVIEW_ADVANCED') {
    return (
      <div className="flex flex-col h-full w-full glass-panel rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between px-3 py-2 border-b border-[#26372D] bg-[#101A15] gap-2">
          <div className="flex items-center gap-2">
            {modeSwitcher}
            <div className="flex items-center bg-[#0B100E] rounded-lg p-0.5 border border-[#26372D]">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  type="button"
                  onClick={() => setTimeframe(tf.value)}
                  className={`px-2 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    timeframe === tf.value
                      ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40 font-semibold'
                      : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs font-mono text-[#A1ADA5]">
            {activePair.id} · Asia/Jakarta (WIB)
          </span>
        </div>

        <TradingViewChart
          pairId={activePair.id}
          timeframe={timeframe}
          datafeed={datafeed}
          onFallbackToPro={() => setMode('SILENT_SMILE_PRO')}
        />
      </div>
    );
  }

  return (
    <DimonexChart
      pairId={activePair.id}
      timeframe={timeframe}
      onTimeframeChange={setTimeframe}
      datafeed={datafeed}
      preferences={preferences}
      onUpdatePreferences={setPreferences}
      modeSwitcherSlot={modeSwitcher}
    />
  );
};
