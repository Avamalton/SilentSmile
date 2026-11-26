import React, { useState, useEffect } from 'react';
import { MarketHeader } from '../components/trading/MarketHeader';
import { TradingChart } from '../components/trading/TradingChart';
import { OrderBook } from '../components/trading/OrderBook';
import { OrderForm } from '../components/trading/OrderForm';
import { OrdersPanel } from '../components/trading/OrdersPanel';
import { useSimulation } from '../simulation/store';
import { useRouter } from '../router';
import { Bot, Sliders, ArrowRight, Clock, Rocket, AlertTriangle, ShieldCheck } from 'lucide-react';
import { formatIDR } from '../utils/formatters';

export const TradingTerminalView: React.FC = () => {
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const { currentUser, activePair, initialListings } = useSimulation();
  const { navigate } = useRouter();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeListing = initialListings.find((l) => l.symbol === activePair.id);
  const isUnlaunched = activeListing && activeListing.status !== 'LIVE';
  const diffSec = activeListing
    ? Math.max(0, Math.floor((activeListing.schedule.public_trading_opens_at - now) / 1000))
    : 0;

  const formatCountdown = (seconds: number) => {
    if (seconds <= 0) return '00:00:00 (Awaiting Readiness Verification)';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-3 min-h-[calc(100vh-5rem)]">
      {/* Unlaunched Market Banner */}
      {isUnlaunched && activeListing && (
        <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] text-xs text-[#F1F5F2] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#064E3B]/40 border border-[#10B981]/30 flex items-center justify-center shrink-0">
              <Rocket className="w-5 h-5 text-[#10B981]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[#F1F5F2]">{activeListing.symbol}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] font-mono font-semibold border border-[#EAB866]/30">
                  {activeListing.status} ({activeListing.mm_preparation_phase})
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#192820] text-[#A1ADA5] border border-[#26372D] font-mono-nums">
                  Ref: {formatIDR(activeListing.initial_price)}
                </span>
              </div>
              <p className="text-[#A1ADA5] text-xs mt-1">
                <strong className="text-[#F1F5F2]">Upcoming Market:</strong> Public trading opens once countdown expires and the 11-point readiness checklist passes.
                Order matching is isolated from premature public execution.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <div className="text-right">
              <div className="text-[10px] text-[#A1ADA5] font-medium">Public Trading Opens In:</div>
              <div className="text-base font-mono font-bold text-[#EAB866] tracking-wider tabular-nums">
                {formatCountdown(diffSec)}
              </div>
            </div>

            {currentUser.role === 'admin' && (
              <button
                onClick={() => navigate('/admin')}
                className="px-3 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs transition-colors flex items-center gap-1.5"
              >
                <span>Manage Listing</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Role Notice for Market Maker */}
      {currentUser.role === 'market_maker' && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[#142019] border border-[#26372D] text-xs text-[#A1ADA5]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#064E3B]/40 border border-[#10B981]/30 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-[#10B981]" />
            </div>
            <span>
              <strong className="text-[#F1F5F2]">DMM Control Active:</strong> You are managing the Central Limit Order Book for <span className="font-mono text-[#34D399] font-semibold">{activePair.id}</span>. Order placement here injects resting quotes directly into the CLOB.
            </span>
          </div>
          <button
            onClick={() => navigate('/mm')}
            className="px-3 py-1.5 rounded-lg bg-[#192820] hover:bg-[#064E3B]/60 text-[#34D399] border border-[#26372D] hover:border-[#10B981]/40 font-semibold text-xs transition-colors flex items-center gap-1.5 shrink-0"
          >
            <span>Open MM Bot Station</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Role Notice for Exchange Admin */}
      {currentUser.role === 'admin' && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[#142019] border border-[#26372D] text-xs text-[#A1ADA5]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#192820] border border-[#26372D] flex items-center justify-center shrink-0">
              <Sliders className="w-3.5 h-3.5 text-[#60A5FA]" />
            </div>
            <span>
              <strong className="text-[#F1F5F2]">Exchange Administrator:</strong> Supervising live matching engine settlement. Test real spot orders or switch to trader accounts to evaluate liquidity absorption.
            </span>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="px-3 py-1.5 rounded-lg bg-[#192820] hover:bg-[#26372D]/60 text-[#F1F5F2] border border-[#26372D] font-semibold text-xs transition-colors flex items-center gap-1.5 shrink-0"
          >
            <span>Admin Governance</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. Market Header with 24h stats and Pair Selector */}
      <MarketHeader />

      {/* 2. Main Pro-Trader Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-[500px]">
        {/* Candlestick / Depth Chart (7 cols on Desktop) */}
        <div className="lg:col-span-7 h-[420px] lg:h-full min-h-[400px]">
          <TradingChart onSelectPrice={(price) => setSelectedPrice(price)} />
        </div>

        {/* Order Book (2.5 cols on Desktop) */}
        <div className="lg:col-span-3 h-[420px] lg:h-full min-h-[380px]">
          <OrderBook onSelectPrice={(price) => setSelectedPrice(price)} />
        </div>

        {/* Buy / Sell Order Form (2.5 cols on Desktop) */}
        <div className="lg:col-span-2 h-auto lg:h-full min-h-[380px]">
          <OrderForm selectedPrice={selectedPrice} />
        </div>
      </div>

      {/* 3. Bottom Tabs: Open Orders, Order History, Trades */}
      <div className="h-72 min-h-[260px]">
        <OrdersPanel />
      </div>
    </div>
  );
};
