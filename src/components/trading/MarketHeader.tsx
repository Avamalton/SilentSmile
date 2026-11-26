import React, { useState, useRef, useEffect } from 'react';
import { useSimulation } from '../../simulation/store';
import { formatIDR, formatCrypto, formatPercentage } from '../../utils/formatters';
import { Star, ChevronDown, ArrowUpRight, ArrowDownRight, Sparkles, Check, Bot, Table2, Sliders, ExternalLink } from 'lucide-react';
import { MarketMakerPanel } from './MarketMakerPanel';
import { MMConfigTable } from '../admin/MMConfigTable';
import { useRouter } from '../../router';
import { ListingSchedulerService } from '../../simulation/listingSchedulerService';

export const MarketHeader: React.FC = () => {
  const { currentUser, activePair, markets, selectPair, toggleFavoritePair, initialListings } = useSimulation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mmModalOpen, setMmModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'matrix' | 'quick'>('matrix');
  const { navigate } = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isPositive = activePair.change24h >= 0;

  return (
    <div className="glass-panel rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-y-2 gap-x-6 relative z-30">
      {/* Pair Selector Dropdown */}
      <div className="relative flex items-center" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => toggleFavoritePair(activePair.id)}
          className="p-1.5 text-[#A1ADA5] hover:text-[#EAB866] hover:bg-[#192820] rounded-lg transition-colors mr-1"
          title="Toggle Favorite"
          aria-label="Toggle Favorite"
        >
          <Star
            className={`w-4 h-4 ${activePair.isFavorite ? 'fill-[#EAB866] text-[#EAB866]' : 'text-[#647168]'}`}
          />
        </button>

        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2.5 hover:bg-[#192820] px-2 py-1.5 rounded-lg transition-colors group text-left"
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
        >
          <div className="flex flex-col text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-[#F1F5F2] tracking-tight">
                {activePair.baseAsset}
              </span>
              <span className="text-xs font-semibold text-[#A1ADA5]">/{activePair.quoteAsset}</span>
              {activePair.baseAsset === 'DNA' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#192820] text-[#34D399] border border-[#26372D] font-medium">
                  Local Token
                </span>
              )}
              {activePair.tradingAccessStatus === 'PREPARATION_ONLY' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/35 font-mono font-bold">
                  MM PREP
                </span>
              )}
              {initialListings.some(
                (l) => l.symbol === activePair.id && ListingSchedulerService.isNewBadgeActive(l)
              ) && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/35 font-mono font-bold flex items-center gap-0.5">
                  <Sparkles className="w-2.5 h-2.5" /> NEW
                </span>
              )}
            </div>
            <span className="text-[11px] text-[#A1ADA5] truncate max-w-[150px]">
              {activePair.name}
            </span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[#A1ADA5] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Dropdown Menu */}
        {dropdownOpen && (
          <div className="absolute left-0 top-full mt-2 w-72 glass-dropdown rounded-xl p-2 z-50">
            <div className="px-2 py-1.5 text-[11px] font-medium text-[#A1ADA5] border-b border-[#26372D] flex justify-between">
              <span>Select Market Pair</span>
              <span>24h Change</span>
            </div>
            <div className="mt-1 max-h-64 overflow-y-auto divide-y divide-[#26372D]/50">
              {markets.map((m) => {
                const isSelected = m.id === activePair.id;
                const mUp = m.change24h >= 0;
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      selectPair(m.id);
                      setDropdownOpen(false);
                    }}
                    className={`flex items-center justify-between px-2.5 py-2 hover:bg-[#142019] rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#064E3B]/40 border-l-2 border-[#10B981]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Star
                        className={`w-3.5 h-3.5 ${m.isFavorite ? 'fill-[#EAB866] text-[#EAB866]' : 'text-[#647168]'}`}
                      />
                      <div>
                        <div className="font-semibold text-[#F1F5F2] text-xs flex items-center gap-1">
                          {m.id}
                          {m.baseAsset === 'DNA' && (
                            <span className="text-[9px] px-1 bg-[#142019] text-[#34D399] border border-[#26372D] rounded">
                              Sim
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#A1ADA5] font-mono-nums">
                          {formatIDR(m.lastPrice)}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`text-xs font-mono font-medium tabular-nums ${mUp ? 'text-[#10B981]' : 'text-[#EF6464]'}`}
                    >
                      {formatPercentage(m.change24h)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 24h Metrics Strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono-nums text-xs">
        {/* Last Price */}
        <div className="flex flex-col">
          <span className="text-[10.5px] text-[#A1ADA5] font-sans">Simulated Price</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-lg font-bold tracking-tight tabular-nums ${isPositive ? 'text-[#10B981]' : 'text-[#EF6464]'}`}
            >
              {formatIDR(activePair.lastPrice)}
            </span>
          </div>
        </div>

        {/* 24h Change */}
        <div className="flex flex-col">
          <span className="text-[10.5px] text-[#A1ADA5] font-sans">24h Change</span>
          <span
            className={`font-semibold text-xs flex items-center gap-0.5 tabular-nums ${
              isPositive ? 'text-[#10B981]' : 'text-[#EF6464]'
            }`}
          >
            {isPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {formatPercentage(activePair.change24h)}
          </span>
        </div>

        {/* 24h High */}
        <div className="flex flex-col hidden sm:flex">
          <span className="text-[10.5px] text-[#A1ADA5] font-sans">24h High</span>
          <span className="text-[#F1F5F2] font-medium text-xs tabular-nums">{formatIDR(activePair.high24h)}</span>
        </div>

        {/* 24h Low */}
        <div className="flex flex-col hidden sm:flex">
          <span className="text-[10.5px] text-[#A1ADA5] font-sans">24h Low</span>
          <span className="text-[#F1F5F2] font-medium text-xs tabular-nums">{formatIDR(activePair.low24h)}</span>
        </div>

        {/* 24h Volume */}
        <div className="flex flex-col">
          <span className="text-[10.5px] text-[#A1ADA5] font-sans">24h Volume (IDR)</span>
          <span className="text-[#F1F5F2] font-medium text-xs tabular-nums">
            {formatIDR(activePair.volume24h, true)}
          </span>
        </div>

        {/* MM Liquidity Bot Quick Access */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={() => {
              setModalTab('matrix');
              setMmModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#192820] hover:bg-[#064E3B]/50 text-[#34D399] border border-[#26372D] hover:border-[#10B981]/40 text-xs font-semibold transition-colors"
            title="Open Institutional Market Maker Configuration (MMConfigTable)"
          >
            <Table2 className="w-3.5 h-3.5 text-[#10B981]" />
            <span className="hidden sm:inline">MM Matrix Setup (cs_*)</span>
            <span className="sm:hidden">MM Matrix</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setModalTab('quick');
              setMmModalOpen(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D] text-xs font-medium transition-colors"
            title="Quick Bot Calibration & Walls"
          >
            <Bot className="w-3.5 h-3.5 text-[#10B981]" />
            <span className="hidden md:inline">Quick Tools</span>
          </button>
        </div>
      </div>

      {/* Market Maker Configuration Modal (MMConfigTable & Quick Tuning) */}
      {mmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-xl p-5 border border-[#26372D] shadow-2xl relative max-h-[92vh] flex flex-col bg-[#101A15]">
            <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-[#26372D] gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#064E3B]/50 border border-[#10B981]/30 flex items-center justify-center">
                  <Table2 className="w-4 h-4 text-[#10B981]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#F1F5F2] flex items-center gap-2">
                    Institutional Market Maker Configuration (MMConfigTable)
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#192820] text-[#34D399] border border-[#26372D] font-mono">
                      {activePair.id}
                    </span>
                  </h3>
                  <p className="text-[11px] text-[#A1ADA5]">
                    Real-time CLOB parameter matrix, price limits, and algorithmic liquidity controls.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMmModalOpen(false);
                    navigate('/mm-config');
                  }}
                  className="px-2.5 py-1 bg-[#142019] hover:bg-[#192820] text-[#34D399] border border-[#26372D] rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                  title="Open Dedicated Full Page Matrix"
                >
                  <span>Fullscreen Matrix</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setMmModalOpen(false)}
                  className="text-[#A1ADA5] hover:text-[#F1F5F2] p-1 rounded-lg hover:bg-[#192820]"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#26372D] text-xs shrink-0">
              <button
                type="button"
                onClick={() => setModalTab('matrix')}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors ${
                  modalTab === 'matrix'
                    ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/40'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>MMConfigTable Matrix (cs_*)</span>
              </button>
              <button
                type="button"
                onClick={() => setModalTab('quick')}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors ${
                  modalTab === 'quick'
                    ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/40'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Quick Spread & Walls</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto pr-1">
              {modalTab === 'matrix' ? (
                <MMConfigTable />
              ) : (
                <MarketMakerPanel />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
