import React, { useState } from 'react';
import { useSimulation } from '../simulation/store';
import { MMConfigTable } from '../components/admin/MMConfigTable';
import { useRouter } from '../router';
import { formatIDR, formatCrypto } from '../utils/formatters';
import {
  Table2,
  Bot,
  Sliders,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Layers,
  ArrowRight,
  ExternalLink,
  Coins,
  Check,
  Zap,
} from 'lucide-react';

export const MMConfigView: React.FC = () => {
  const {
    currentUser,
    switchUser,
    activePair,
    markets,
    selectPair,
    fullMMConfigs,
    restingOrders,
    botBalances,
  } = useSimulation();

  const { navigate } = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  const isMM = currentUser.role === 'market_maker';
  const isAdmin = currentUser.role === 'admin';

  const currentConfig = fullMMConfigs[activePair.id];
  const mmOrdersCount = restingOrders.filter(
    (o) => o.pair === activePair.id && o.isMM && !o.isWall
  ).length;
  const mmWallsCount = restingOrders.filter(
    (o) => o.pair === activePair.id && o.isWall
  ).length;

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto pb-10">
      {/* 1. Executive Role Banner (Allowing immediate role preview/switch) */}
      {!isMM && !isAdmin && (
        <div className="p-3 rounded-lg bg-[#142019] border border-[#26372D] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#A1ADA5]">
            <Bot className="w-4 h-4 text-[#10B981] shrink-0" />
            <span>
              You are currently configuring the Market Maker engine as <strong className="text-[#F1F5F2]">{currentUser.name}</strong> ({currentUser.role}). All simulation changes are active and saved in real-time.
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

      {/* 2. Executive Hero Banner */}
      <div className="bg-[#142019] rounded-lg p-5 border border-[#26372D]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-lg bg-[#101A15] border border-[#10B981]/40 flex items-center justify-center shrink-0">
              <Table2 className="w-6 h-6 text-[#10B981]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2]">
                  Institutional Market Maker Configuration (MMConfigTable)
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/35 font-mono font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
                  SETUP & MATRIX ACTIVE
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#101A15] text-[#A1ADA5] border border-[#26372D] font-medium">
                  CLOB ALGO ENGINE (cs_*)
                </span>
              </div>
              <p className="text-xs text-[#A1ADA5] mt-1 max-w-3xl">
                Configure institutional parameters (price/quantity precision, target source, directional skew, walk-the-book depth, dead zones, and strict support/resistance boundaries). Changes are deterministically propagated to the central limit order book.
              </p>
            </div>
          </div>

          {/* Quick Route Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate('/trade')}
              className="px-3.5 py-2 rounded-lg bg-[#101A15] hover:bg-[#192820] text-xs font-semibold text-[#34D399] border border-[#26372D] flex items-center gap-1.5 transition-colors"
            >
              <span>Spot Trading Terminal</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigate('/mm')}
              className="px-3.5 py-2 rounded-lg bg-[#064E3B]/50 hover:bg-[#064E3B]/75 text-xs font-semibold text-[#F1F5F2] border border-[#10B981]/40 flex items-center gap-1.5 transition-colors"
            >
              <Bot className="w-3.5 h-3.5 text-[#10B981]" />
              <span>Full MM Station</span>
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-lg bg-[#064E3B]/35 text-[#34D399] border border-[#10B981]/35 text-xs flex items-center gap-2.5">
          <Check className="w-4 h-4 text-[#10B981] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* 3. Live Algorithmic Telemetry Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-lg border border-[#26372D] bg-[#142019] flex flex-col gap-1">
          <span className="text-[11px] text-[#A1ADA5] font-medium">Selected Market</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold font-mono text-[#34D399]">{activePair.id}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums">
              {formatIDR(activePair.lastPrice)}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-[#26372D] bg-[#142019] flex flex-col gap-1">
          <span className="text-[11px] text-[#A1ADA5] font-medium">Lifecycle Status</span>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                currentConfig?.emergency_stop
                  ? 'bg-[#EF6464]'
                  : currentConfig?.enabled
                  ? 'bg-[#10B981]'
                  : 'bg-[#EAB866]'
              }`}
            ></span>
            <span className="text-xs font-bold font-mono text-[#F1F5F2]">
              {currentConfig?.emergency_stop ? 'EMERGENCY STOP' : currentConfig?.lifecycle_state || 'RUNNING'}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-[#26372D] bg-[#142019] flex flex-col gap-1">
          <span className="text-[11px] text-[#A1ADA5] font-medium">Directional Stance</span>
          <div className="flex items-center gap-1.5">
            {currentConfig?.cs_direction === 'Up' ? (
              <TrendingUp className="w-3.5 h-3.5 text-[#10B981]" />
            ) : currentConfig?.cs_direction === 'Down' ? (
              <TrendingDown className="w-3.5 h-3.5 text-[#EF6464]" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-[#34D399]" />
            )}
            <span className="text-xs font-bold font-mono text-[#F1F5F2]">
              {currentConfig?.cs_direction || 'Neutral'} Skew
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-[#26372D] bg-[#142019] flex flex-col gap-1">
          <span className="text-[11px] text-[#A1ADA5] font-medium">Active Book Quotes</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold font-mono tabular-nums text-[#34D399]">
              {mmOrdersCount} Quotes
            </span>
            {mmWallsCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/30 font-mono tabular-nums">
                +{mmWallsCount} Walls
              </span>
            )}
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-[#26372D] bg-[#142019] flex flex-col gap-1">
          <span className="text-[11px] text-[#A1ADA5] font-medium">Total Strategy Budget</span>
          <div className="text-xs font-bold font-mono tabular-nums text-[#10B981]">
            {formatIDR(currentConfig?.cs_total_budget_idr || 1000000000)}
          </div>
        </div>
      </div>

      {/* 4. The Core MMConfigTable Component */}
      <MMConfigTable onSuccessNotice={(msg) => setNotice(msg)} />
    </div>
  );
};
