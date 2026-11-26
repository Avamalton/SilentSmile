import React, { useState } from 'react';
import { useSimulation } from '../simulation/store';
import { formatIDR, formatCrypto, formatDateTime } from '../utils/formatters';
import { History, Shield, ArrowUpRight, ArrowDownRight, Activity, Search } from 'lucide-react';

export const HistoryView: React.FC = () => {
  const { userTrades, auditLogs } = useSimulation();
  const [activeTab, setActiveTab] = useState<'trades' | 'audit'>('trades');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAuditLogs = auditLogs.filter(
    (log) =>
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actor.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
          Trade & Account Activity
          <span className="text-xs px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-mono">
            Audit Ledger
          </span>
        </h1>
        <p className="text-xs text-[#A1ADA5] mt-0.5">
          Immutable demonstration record of all executed trades, matching events, and session audit logs.
        </p>
      </div>

      {/* Main Container */}
      <div className="glass-panel rounded-xl p-4 flex flex-col gap-4">
        {/* Tab switch and search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#26372D]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('trades')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'trades'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              <span>Executed Trades</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0B100E] border border-[#26372D] tabular-nums">
                {userTrades.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'audit'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              <span>Audit & Event Log</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0B100E] border border-[#26372D] tabular-nums">
                {auditLogs.length}
              </span>
            </button>
          </div>

          {activeTab === 'audit' && (
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#647168] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Filter audit logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full glass-input rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#F1F5F2] placeholder-[#647168] outline-none"
              />
            </div>
          )}
        </div>

        {/* Content */}
        {activeTab === 'trades' ? (
          <div className="overflow-x-auto">
            {userTrades.length === 0 ? (
              <div className="py-16 text-center text-[#A1ADA5] flex flex-col items-center">
                <Activity className="w-8 h-8 opacity-40 mb-2" />
                <p className="text-xs">No trade executions logged yet.</p>
                <p className="text-[11px] text-[#647168] mt-1">
                  Place and fill a market or limit order to view executed trade records.
                </p>
              </div>
            ) : (
              <table className="w-full text-left font-mono-nums text-xs">
                <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
                  <tr>
                    <th className="py-2.5 px-3">Date & Time</th>
                    <th className="py-2.5 px-3">Trade ID</th>
                    <th className="py-2.5 px-3">Pair</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Execution Price</th>
                    <th className="py-2.5 px-3 text-right">Filled Amount</th>
                    <th className="py-2.5 px-3 text-right">Total (IDR)</th>
                    <th className="py-2.5 px-3 text-center">Liquidity Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26372D]/50">
                  {userTrades.map((t) => (
                    <tr key={t.id} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2.5 px-3 text-[#A1ADA5] text-[11px] whitespace-nowrap">
                        {formatDateTime(t.timestamp)}
                      </td>
                      <td className="py-2.5 px-3 text-[#647168] font-mono text-[11px]">
                        #{t.id.slice(-6)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#F1F5F2]">{t.pair}</td>
                      <td className="py-2.5 px-3 font-bold">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            t.side === 'buy' ? 'text-[#10B981]' : 'text-[#EF6464]'
                          }`}
                        >
                          {t.side === 'buy' ? (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5" />
                          )}
                          {t.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#F1F5F2] font-medium tabular-nums">
                        {formatIDR(t.price)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#F1F5F2] tabular-nums">
                        {formatCrypto(t.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-[#34D399] tabular-nums">
                        {formatIDR(t.total)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 text-[10.5px] rounded ${
                            t.isMaker
                              ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30'
                              : 'bg-[#101A15] text-[#A1ADA5] border border-[#26372D]'
                          }`}
                        >
                          {t.isMaker ? 'MAKER' : 'TAKER'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {filteredAuditLogs.length === 0 ? (
              <div className="py-16 text-center text-[#647168]">
                No audit events found.
              </div>
            ) : (
              <table className="w-full text-left font-mono-nums text-xs">
                <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Actor</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Target</th>
                    <th className="py-2.5 px-3">Event Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26372D]/50">
                  {filteredAuditLogs.map((log, idx) => (
                    <tr key={`${log.id || 'log'}-${idx}`} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2.5 px-3 text-[#A1ADA5] text-[11px] whitespace-nowrap">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#F1F5F2]">{log.actor}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10.5px] bg-[#192820] text-[#34D399] border border-[#26372D] font-mono">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[#A1ADA5]">{log.target}</td>
                      <td className="py-2.5 px-3 text-[#F1F5F2] font-sans">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
