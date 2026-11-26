import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from '../router';
import { useSimulation } from '../simulation/store';
import { formatIDR, formatPercentage } from '../utils/formatters';
import { generateSparkline } from '../simulation/marketData';
import {
  Coins,
  Search,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUpDown,
  ExternalLink,
  Rocket,
  Clock,
  Sparkles,
  Lock,
  CheckCircle2,
} from 'lucide-react';
import { ListingSchedulerService } from '../simulation/listingSchedulerService';

export const MarketsView: React.FC = () => {
  const { navigate } = useRouter();
  const { markets, selectPair, toggleFavoritePair, initialListings } = useSimulation();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'favorites' | 'local'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'change' | 'volume'>('volume');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [now, setNow] = useState(Date.now());

  // 1-second live clock for accurate countdown timers
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter Active Markets: Only markets whose trading is fully OPEN / LIVE
  const filteredMarkets = useMemo(() => {
    let result = markets.filter((m) => {
      const listing = initialListings.find((l) => l.symbol === m.id);
      if (listing) {
        return listing.status === 'LIVE' || listing.visibility === 'LIVE';
      }
      return m.tradingAccessStatus === 'OPEN' || m.isActive;
    });

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
      );
    }
    if (activeFilter === 'favorites') {
      result = result.filter((m) => m.isFavorite);
    } else if (activeFilter === 'local') {
      result = result.filter((m) => m.baseAsset === 'DNA');
    }

    result.sort((a, b) => {
      let vA = 0;
      let vB = 0;
      if (sortBy === 'name') return sortDir === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
      if (sortBy === 'price') {
        vA = a.lastPrice;
        vB = b.lastPrice;
      } else if (sortBy === 'change') {
        vA = a.change24h;
        vB = b.change24h;
      } else if (sortBy === 'volume') {
        vA = a.volume24h;
        vB = b.volume24h;
      }
      return sortDir === 'desc' ? vB - vA : vA - vB;
    });

    return result;
  }, [markets, initialListings, searchQuery, activeFilter, sortBy, sortDir]);

  // Upcoming Listings (SCHEDULED or PREPARING or APPROVED with schedule)
  const upcomingListings = useMemo(() => {
    return initialListings.filter(
      (l) =>
        (l.status === 'SCHEDULED' || l.status === 'PREPARING' || l.status === 'POSTPONED') &&
        l.visibility !== 'HIDDEN'
    );
  }, [initialListings]);

  const toggleSort = (col: 'name' | 'price' | 'change' | 'volume') => {
    if (sortBy === col) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const formatCountdown = (diffSec: number) => {
    if (diffSec <= 0) return '00:00:00 (LAUNCHING)';
    const h = Math.floor(diffSec / 3600);
    const m = Math.floor((diffSec % 3600) / 60);
    const s = diffSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
            Spot Markets
            <span className="text-xs px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-mono">
              IDR Base
            </span>
          </h1>
          <p className="text-xs text-[#A1ADA5] mt-0.5">
            Simulated institutional order matching on central limit order book (CLOB) with rupiah pairs.
          </p>
        </div>
      </div>

      {/* Upcoming Listings & Launch Countdown Section */}
      {upcomingListings.length > 0 && (
        <div className="glass-panel rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Rocket className="w-5 h-5 text-[#10B981]" />
              <h2 className="text-sm sm:text-base font-bold text-[#F1F5F2]">Upcoming Token Listings & MM Preparation</h2>
              <span className="text-[10px] px-2.5 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-mono font-semibold">
                SCHEDULED
              </span>
            </div>
            <span className="text-xs text-[#A1ADA5]">
              Live countdown active &bull; Public trading isolated until launch
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingListings.map((listing) => {
              const diffSec = Math.max(0, Math.floor((listing.schedule.public_trading_opens_at - now) / 1000));
              const launchDate = new Date(listing.schedule.public_trading_opens_at);

              return (
                <div
                  key={listing.id}
                  onClick={() => {
                    selectPair(listing.symbol);
                    navigate('/trade');
                  }}
                  className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] hover:border-[#10B981]/50 cursor-pointer transition-colors flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#F1F5F2] text-base">{listing.symbol}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#192820] text-[#34D399] border border-[#26372D]">
                        {listing.category}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-[#EAB866] bg-[#EAB866]/10 px-2.5 py-1 rounded-lg border border-[#EAB866]/25 flex items-center gap-1.5 tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      {formatCountdown(diffSec)}
                    </span>
                  </div>

                  <div className="text-xs text-[#A1ADA5] font-medium">{listing.name}</div>

                  <div className="p-2.5 rounded-lg bg-[#0B100E] border border-[#26372D] text-[11px] flex flex-col gap-1 text-[#A1ADA5] font-mono">
                    <div className="flex justify-between">
                      <span>Launch (WIB):</span>
                      <span className="text-[#F1F5F2]">{launchDate.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Launch (UTC):</span>
                      <span className="text-[#A1ADA5]">{launchDate.toUTCString().slice(17, 25)} UTC</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-[#26372D] text-[#34D399]">
                      <span>MM Phase:</span>
                      <span className="font-semibold">{listing.mm_preparation_phase}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#26372D]">
                    <span className="text-[#A1ADA5]">
                      Ref Price: <strong className="text-[#F1F5F2] font-mono tabular-nums">{formatIDR(listing.initial_price)}</strong>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#A1ADA5]">
                        Deposit: <strong className={listing.deposit_status === 'OPEN' ? 'text-[#10B981]' : 'text-[#647168]'}>{listing.deposit_status}</strong>
                      </span>
                      <span className="text-[10px] text-[#A1ADA5]">
                        Withdraw: <strong className={listing.withdrawal_status === 'OPEN' ? 'text-[#10B981]' : 'text-[#647168]'}>{listing.withdrawal_status}</strong>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Active Markets Table Card */}
      <div className="glass-panel rounded-xl p-5 flex flex-col gap-4 border border-[#26372D]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 bg-[#101A15] rounded-lg p-1 border border-[#26372D]">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeFilter === 'all'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              Active Markets ({filteredMarkets.length})
            </button>
            <button
              onClick={() => setActiveFilter('favorites')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeFilter === 'favorites'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              Favorites
            </button>
            <button
              onClick={() => setActiveFilter('local')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeFilter === 'local'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              Local Tokens (DNA)
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#647168] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search active markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full glass-input rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#F1F5F2] placeholder-[#647168] outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono-nums text-xs">
            <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
              <tr>
                <th className="py-2.5 px-3 w-8"></th>
                <th
                  onClick={() => toggleSort('name')}
                  className="py-2.5 px-3 font-medium cursor-pointer hover:text-[#F1F5F2]"
                >
                  <span className="inline-flex items-center gap-1">
                    Pair <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th
                  onClick={() => toggleSort('price')}
                  className="py-2.5 px-3 font-medium text-right cursor-pointer hover:text-[#F1F5F2]"
                >
                  <span className="inline-flex items-center gap-1">
                    Simulated Price <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th
                  onClick={() => toggleSort('change')}
                  className="py-2.5 px-3 font-medium text-right cursor-pointer hover:text-[#F1F5F2]"
                >
                  <span className="inline-flex items-center gap-1">
                    24h Change <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-3 font-medium text-right hidden sm:table-cell">24h High</th>
                <th className="py-2.5 px-3 font-medium text-right hidden sm:table-cell">24h Low</th>
                <th
                  onClick={() => toggleSort('volume')}
                  className="py-2.5 px-3 font-medium text-right cursor-pointer hover:text-[#F1F5F2]"
                >
                  <span className="inline-flex items-center gap-1">
                    24h Volume <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-3 font-medium text-center hidden md:table-cell">7D Trend</th>
                <th className="py-2.5 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#26372D]/50">
              {filteredMarkets.map((m) => {
                const isUp = m.change24h >= 0;
                const sparklinePoints = generateSparkline(m.lastPrice, m.change24h);
                const min = Math.min(...sparklinePoints);
                const max = Math.max(...sparklinePoints);
                const range = max - min || 1;
                const pointsSvg = sparklinePoints
                  .map((pt, i) => {
                    const x = (i / (sparklinePoints.length - 1)) * 80;
                    const y = 24 - ((pt - min) / range) * 20;
                    return `${x},${y}`;
                  })
                  .join(' ');

                const listing = initialListings.find((l) => l.symbol === m.id);
                const isNew = listing ? ListingSchedulerService.isNewBadgeActive(listing, now) : false;

                return (
                  <tr
                    key={m.id}
                    className="hover:bg-[#192820] transition-colors cursor-pointer"
                    onClick={() => {
                      selectPair(m.id);
                      navigate('/trade');
                    }}
                  >
                    <td
                      className="py-3 px-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoritePair(m.id);
                      }}
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          m.isFavorite
                            ? 'fill-[#EAB866] text-[#EAB866]'
                            : 'text-[#647168] hover:text-[#EAB866]'
                        }`}
                      />
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-bold text-[#F1F5F2] flex items-center gap-1.5 flex-wrap">
                        {m.id}
                        {m.baseAsset === 'DNA' && (
                          <span className="text-[10px] px-1.5 rounded bg-[#192820] text-[#34D399] border border-[#26372D]">
                            Local Archetype
                          </span>
                        )}
                        {isNew && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/35 font-mono font-bold flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" /> NEW
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#A1ADA5] font-sans">{m.name}</div>
                    </td>

                    <td className="py-3 px-3 text-right font-bold text-[#F1F5F2] tabular-nums">
                      {formatIDR(m.lastPrice)}
                    </td>

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

                    <td className="py-3 px-3 text-right text-[#F1F5F2] hidden sm:table-cell tabular-nums">
                      {formatIDR(m.high24h)}
                    </td>

                    <td className="py-3 px-3 text-right text-[#A1ADA5] hidden sm:table-cell tabular-nums">
                      {formatIDR(m.low24h)}
                    </td>

                    <td className="py-3 px-3 text-right text-[#F1F5F2] tabular-nums">
                      {formatIDR(m.volume24h, true)}
                    </td>

                    <td className="py-3 px-3 text-center hidden md:table-cell">
                      <svg className="w-20 h-6 inline-block overflow-visible" viewBox="0 0 80 24">
                        <polyline
                          fill="none"
                          stroke={isUp ? '#10B981' : '#EF6464'}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={pointsSvg}
                        />
                      </svg>
                    </td>

                    <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          selectPair(m.id);
                          navigate('/trade');
                        }}
                        className="px-3 py-1 bg-[#101A15] hover:bg-[#064E3B]/60 text-[#F1F5F2] hover:text-[#34D399] border border-[#26372D] hover:border-[#10B981]/40 rounded-md text-xs font-medium transition-colors"
                      >
                        Trade Now
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
