import React, { useState } from 'react';
import { useSimulation } from '../simulation/store';
import { MarketMakerPanel } from '../components/admin/MarketMakerPanel';
import { MarketMakerConsolePanel } from '../components/admin/MarketMakerConsolePanel';
import {
  Bot,
  Sliders,
  ShieldCheck,
  Activity,
  Layers,
  Coins,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Check,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { useRouter } from '../router';

export const MarketMakerView: React.FC = () => {
  const { currentUser, switchUser, activePair, markets } = useSimulation();
  const { navigate } = useRouter();
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [stationTab, setStationTab] = useState<'console' | 'classic'>('console');

  const isMM = currentUser.role === 'market_maker';

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto">
      {!isMM && (
        <div className="p-3 rounded-lg bg-[#142019] border border-[#26372D] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#A1ADA5]">
            <Bot className="w-4 h-4 text-[#10B981] shrink-0" />
            <span>
              Currently viewing in preview mode as <strong className="text-[#F1F5F2]">{currentUser.name}</strong> ({currentUser.role}). Full DMM parameters and order walls are active.
            </span>
          </div>
          <button
            onClick={() => switchUser('usr_mm_01')}
            className="px-3.5 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs transition-colors flex items-center gap-1.5"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Switch to DMM Account (Nexus Liquidity Bot)</span>
          </button>
        </div>
      )}

      {/* 1. Market Maker Dedicated Station Header */}
      <div className="bg-[#142019] rounded-lg p-5 border border-[#26372D]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-lg bg-[#101A15] border border-[#10B981]/40 flex items-center justify-center shrink-0">
              <Bot className="w-6 h-6 text-[#10B981]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2]">
                  Market Maker Station & Quant Console
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/35 font-mono font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
                  DMM ROLE ACTIVE
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#101A15] text-[#A1ADA5] border border-[#26372D] font-medium">
                  Binance / Bybit Feed Aggregator
                </span>
              </div>
              <p className="text-xs text-[#A1ADA5] mt-1">
                External price feeds, cross-market reference mapping, automated depth quoting, FX USDT/IDR conversion, and cryptographic audit.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#101A15] border border-[#26372D] text-xs font-semibold">
              <button
                onClick={() => setStationTab('console')}
                className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                  stationTab === 'console'
                    ? 'bg-[#10B981] text-[#0B100E]'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Quant MM Console</span>
              </button>
              <button
                onClick={() => setStationTab('classic')}
                className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                  stationTab === 'classic'
                    ? 'bg-[#10B981] text-[#0B100E]'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Order Walls & Matrix</span>
              </button>
            </div>

            <button
              onClick={() => navigate('/trade')}
              className="px-3.5 py-2 rounded-lg bg-[#101A15] hover:bg-[#192820] text-xs font-semibold text-[#34D399] border border-[#26372D] flex items-center gap-1.5 transition-colors"
            >
              <span>Spot Terminal</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {statusNotice && (
        <div className="p-3 rounded-lg bg-[#064E3B]/35 text-[#34D399] border border-[#10B981]/35 text-xs flex items-center gap-2.5">
          <Check className="w-4 h-4 text-[#10B981] shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* 2. Embedded Station Components */}
      {stationTab === 'console' ? (
        <MarketMakerConsolePanel onSuccessNotice={(msg) => setStatusNotice(msg)} />
      ) : (
        <MarketMakerPanel onSuccessNotice={(msg) => setStatusNotice(msg)} />
      )}
    </div>
  );
};
