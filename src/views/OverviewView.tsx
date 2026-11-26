import React, { useState, useMemo } from 'react';
import { useRouter } from '../router';
import { useSimulation } from '../simulation/store';
import { formatIDR, formatPercentage } from '../utils/formatters';
import { generateSparkline } from '../simulation/marketData';
import {
  TrendingUp,
  Wallet,
  Activity,
  Star,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Coins,
  ShieldCheck,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react';

export const OverviewView: React.FC = () => {
  const { navigate } = useRouter();
  const { markets, portfolioValueIDR, balances, unrealizedPnL, selectPair, toggleFavoritePair } =
    useSimulation();

  const [activeFilter, setActiveFilter] = useState<'all' | 'favorites' | 'gainers' | 'losers' | 'local'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'price' | 'change' | 'volume'>('volume');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const availableIDR = balances['IDR']?.free || 0;

  // Filtered and sorted markets
  const processedMarkets = useMemo(() => {
    let result = [...markets];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
      );
    }

    // Category filter
    if (activeFilter === 'favorites') {
      result = result.filter((m) => m.isFavorite);
    } else if (activeFilter === 'gainers') {
      result = result.filter((m) => m.change24h > 0);
    } else if (activeFilter === 'losers') {
      result = result.filter((m) => m.change24h < 0);
    } else if (activeFilter === 'local') {
      result = result.filter((m) => m.baseAsset === 'DNA');
    }

    // Sorting
    result.sort((a, b) => {
      let valA = 0;
      let valB = 0;
      if (sortBy === 'price') {
        valA = a.lastPrice;
        valB = b.lastPrice;
      } else if (sortBy === 'change') {
        valA = a.change24h;
        valB = b.change24h;
      } else if (sortBy === 'volume') {
        valA = a.volume24h;
        valB = b.volume24h;
      }
      return sortDirection === 'desc' ? valB - valA : valA - valB;
    });

    return result;
  }, [markets, searchQuery, activeFilter, sortBy, sortDirection]);

  const handleSortToggle = (col: 'price' | 'change' | 'volume') => {
    if (sortBy === col) {
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(col);
      setSortDirection('desc');
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto">
      {/* 1. Top Hero Section with Key Virtual Metrics */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
              Market Overview
              <span className="text-xs px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-mono font-normal">
                Spot IDR
              </span>
            </h1>
            <p className="text-xs text-[#A1ADA5] mt-0.5">
              Simulated spot trading pairs with continuous deterministic order matching.
            </p>
          </div>

          <button
            onClick={() => navigate('/trade')}
            className="px-4 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
          >
            Open Trading Terminal
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* 4 Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[#A1ADA5] text-xs flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-[#10B981]" /> Total Virtual Valuation
            </span>
            <div className="mt-2">
              <div className="text-lg sm:text-xl font-bold font-mono text-[#F1F5F2] tabular-nums">
                {formatIDR(portfolioValueIDR)}
              </div>
              <div className="text-[11px] text-[#647168] mt-0.5">Calculated at current mark prices</div>
            </div>
          </div>

          <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[#A1ADA5] text-xs flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-[#10B981]" /> Available Virtual IDR
            </span>
            <div className="mt-2">
              <div className="text-lg sm:text-xl font-bold font-mono text-[#34D399] tabular-nums">
                {formatIDR(availableIDR)}
              </div>
              <div className="text-[11px] text-[#647168] mt-0.5">Free balance ready for spot buys</div>
            </div>
          </div>

          <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[#A1ADA5] text-xs flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[#10B981]" /> Simulated Daily P&L
            </span>
            <div className="mt-2">
              <div className="text-lg sm:text-xl font-bold font-mono text-[#10B981] flex items-center gap-1 tabular-nums">
                <ArrowUpRight className="w-4 h-4 text-[#10B981]" />
                +{formatIDR(unrealizedPnL)}
              </div>
              <div className="text-[11px] text-[#34D399] font-mono mt-0.5 tabular-nums">+4.20% demo return</div>
            </div>
          </div>

          <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[#A1ADA5] text-xs flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[#EAB866]" /> Active IDR Markets
            </span>
            <div className="mt-2">
              <div className="text-lg sm:text-xl font-bold font-mono text-[#F1F5F2] tabular-nums">
                {markets.length} Spot Pairs
              </div>
              <div className="text-[11px] text-[#EAB866] font-mono mt-0.5">1 Local Community Token</div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Interactive Market Table & Controls */}
      <div className="glass-panel rounded-xl p-4 flex flex-col gap-4">
        {/* Filter Bar and Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Segmented Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1 bg-[#101A15] rounded-lg p-1 border border-[#26372D]">
            {(
              [
                { id: 'all', label: 'All Pairs' },
                { id: 'favorites', label: 'Favorites' },
                { id: 'gainers', label: 'Top Gainers' },
                { id: 'losers', label: 'Top Losers' },
                { id: 'local', label: 'Local Tokens' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeFilter === tab.id
                    ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#647168] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by pair or asset name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full glass-input rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#F1F5F2] placeholder-[#647168] outline-none"
            />
          </div>
        </div>

        {/* Markets Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono-nums text-xs">
            <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
              <tr>
                <th className="py-2.5 px-3 font-medium w-8"></th>
                <th className="py-2.5 px-3 font-medium">Market Pair</th>
                <th
                  onClick={() => handleSortToggle('price')}
                  className="py-2.5 px-3 font-medium text-right cursor-pointer hover:text-[#F1F5F2]"
                >
                  <span className="inline-flex items-center gap-1">
                    Simulated Price <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th
                  onClick={() => handleSortToggle('change')}
                  className="py-2.5 px-3 font-medium text-right cursor-pointer hover:text-[#F1F5F2]"
                >
                  <span className="inline-flex items-center gap-1">
                    24h Change <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-3 font-medium text-right hidden sm:table-cell">24h High / Low</th>
                <th
                  onClick={() => handleSortToggle('volume')}
                  className="py-2.5 px-3 font-medium text-right cursor-pointer hover:text-[#F1F5F2]"
                >
                  <span className="inline-flex items-center gap-1">
                    24h Volume (IDR) <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-3 font-medium text-center hidden md:table-cell">7D Trend</th>
                <th className="py-2.5 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#26372D]/50">
              {processedMarkets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#647168]">
                    No markets matched your filter criteria.
                  </td>
                </tr>
              ) : (
                processedMarkets.map((m) => {
                  const isUp = m.change24h >= 0;
                  const sparklinePoints = generateSparkline(m.lastPrice, m.change24h);
                  const min = Math.min(...sparklinePoints);
                  const max = Math.max(...sparklinePoints);
                  const range = max - min || 1;

                  // Create SVG sparkline points
                  const pointsSvg = sparklinePoints
                    .map((pt, i) => {
                      const x = (i / (sparklinePoints.length - 1)) * 90;
                      const y = 26 - ((pt - min) / range) * 22;
                      return `${x},${y}`;
                    })
                    .join(' ');

                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-[#192820] transition-colors cursor-pointer group"
                      onClick={() => {
                        selectPair(m.id);
                        navigate('/trade');
                      }}
                    >
                      {/* Favorite Button */}
                      <td
                        className="py-3 px-3"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavoritePair(m.id);
                        }}
                      >
                        <Star
                          className={`w-3.5 h-3.5 transition-colors ${
                            m.isFavorite
                              ? 'fill-[#EAB866] text-[#EAB866]'
                              : 'text-[#647168] hover:text-[#EAB866]'
                          }`}
                        />
                      </td>

                      {/* Pair Symbol & Name */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#192820] flex items-center justify-center font-bold text-xs text-[#34D399] border border-[#26372D]">
                            {m.baseAsset.slice(0, 3)}
                          </div>
                          <div>
                            <div className="font-bold text-[#F1F5F2] flex items-center gap-1.5">
                              {m.id}
                              {m.baseAsset === 'DNA' && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#192820] text-[#34D399] border border-[#26372D]">
                                  Local
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#A1ADA5] font-sans">{m.name}</div>
                          </div>
                        </div>
                      </td>

                      {/* Last Price */}
                      <td className="py-3 px-3 text-right font-bold text-[#F1F5F2] tabular-nums">
                        {formatIDR(m.lastPrice)}
                      </td>

                      {/* 24h Change */}
                      <td className="py-3 px-3 text-right font-semibold tabular-nums">
                        <span
                          className={`inline-flex items-center gap-0.5 ${
                            isUp ? 'text-[#10B981]' : 'text-[#EF6464]'
                          }`}
                        >
                          {isUp ? (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5" />
                          )}
                          {formatPercentage(m.change24h)}
                        </span>
                      </td>

                      {/* 24h High / Low */}
                      <td className="py-3 px-3 text-right text-[#A1ADA5] text-[11px] hidden sm:table-cell tabular-nums">
                        <div>H: {formatIDR(m.high24h)}</div>
                        <div className="text-[#647168]">L: {formatIDR(m.low24h)}</div>
                      </td>

                      {/* 24h Volume */}
                      <td className="py-3 px-3 text-right text-[#F1F5F2] tabular-nums">
                        {formatIDR(m.volume24h, true)}
                      </td>

                      {/* Mini Sparkline */}
                      <td className="py-3 px-3 text-center hidden md:table-cell">
                        <svg className="w-24 h-7 inline-block overflow-visible" viewBox="0 0 90 28">
                          <polyline
                            fill="none"
                            stroke={isUp ? '#10B981' : '#EF6464'}
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={pointsSvg}
                          />
                        </svg>
                      </td>

                      {/* Trade Action Button */}
                      <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            selectPair(m.id);
                            navigate('/trade');
                          }}
                          className="px-3 py-1 bg-[#101A15] hover:bg-[#064E3B]/60 text-[#F1F5F2] hover:text-[#34D399] border border-[#26372D] hover:border-[#10B981]/40 rounded-md text-xs font-medium transition-colors"
                        >
                          Trade
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
