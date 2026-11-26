import React, { useState } from 'react';
import { useSimulation } from '../simulation/store';
import { formatIDR, formatDateTime } from '../utils/formatters';
import {
  ShieldAlert,
  Bot,
  RotateCcw,
  Check,
  Vault,
  Table2,
  Rocket,
  Layers,
  Cpu,
} from 'lucide-react';
import { MarketMakerPanel } from '../components/admin/MarketMakerPanel';
import { AdminFeeVaultPanel } from '../components/admin/AdminFeeVaultPanel';
import { MMConfigTable } from '../components/admin/MMConfigTable';
import { InitialListingPanel } from '../components/admin/InitialListingPanel';
import { AdminCompliancePanel } from '../components/admin/AdminCompliancePanel';
import { AssetNetworkPanel } from '../components/admin/AssetNetworkPanel';
import { MarketMakerConsolePanel } from '../components/admin/MarketMakerConsolePanel';

export const AdminView: React.FC = () => {
  const {
    currentUser,
    switchUser,
    markets,
    updateMarketConfig,
    settings,
    updateSettings,
    auditLogs,
    resetSimulationData,
    adminFeeVault,
  } = useSimulation();

  const [activeTab, setActiveTab] = useState<'markets' | 'engine' | 'audit' | 'mm' | 'vault' | 'mm_matrix' | 'listing_lifecycle' | 'compliance' | 'asset_networks' | 'mm_console'>('asset_networks');
  const [editingPair, setEditingPair] = useState<string | null>(null);

  const [makerFeeInput, setMakerFeeInput] = useState<number>(10);
  const [takerFeeInput, setTakerFeeInput] = useState<number>(15);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const isAdmin = currentUser.role === 'admin';

  const handleSavePairConfig = (pairId: string) => {
    updateMarketConfig(pairId, {
      makerFeeBps: Number(makerFeeInput),
      takerFeeBps: Number(takerFeeInput),
    });
    setEditingPair(null);
    setStatusNotice(`Updated fee schedules for ${pairId}.`);
    setTimeout(() => setStatusNotice(null), 2000);
  };

  const handleToggleMarketStatus = (pairId: string, currentStatus: boolean) => {
    updateMarketConfig(pairId, { isActive: !currentStatus });
    setStatusNotice(`${pairId} status set to ${!currentStatus ? 'ACTIVE' : 'HALTED'}.`);
    setTimeout(() => setStatusNotice(null), 2000);
  };

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto">
      {!isAdmin && (
        <div className="p-3 rounded-lg bg-[#142019] border border-[#26372D] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#A1ADA5]">
            <ShieldAlert className="w-4 h-4 text-[#EAB866] shrink-0" />
            <span>
              Currently viewing in preview mode as <strong className="text-[#F1F5F2]">{currentUser.name}</strong> ({currentUser.role}).
            </span>
          </div>
          <button
            onClick={() => switchUser('usr_admin_01')}
            className="px-3 py-1 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs transition-colors"
          >
            Switch to Admin Account (Dr. Sarah)
          </button>
        </div>
      )}

      {/* Header with Institutional Admin Skin */}
      <div className="bg-[#142019] rounded-lg p-5 border border-[#26372D] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex flex-wrap items-center gap-2">
            Exchange Administration Console
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/35 font-mono font-bold">
              ADMIN ROLE ACTIVE
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#101A15] text-[#A1ADA5] border border-[#26372D] font-medium">
              GOVERNANCE & AUDIT
            </span>
          </h1>
          <p className="text-xs text-[#A1ADA5] mt-1 max-w-2xl">
            Supervise newly listed token pairs, exchange trading fees, and real-time CLOB engine settlement. Order book liquidity strategy is operated by the Designated Market Maker (<strong className="text-[#34D399]">Nexus Liquidity Bot</strong>).
          </p>
        </div>

        <button
          onClick={() => setConfirmResetOpen(true)}
          className="px-3.5 py-2 bg-[#EF6464]/10 hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/35 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Exchange State</span>
        </button>
      </div>

      {statusNotice && (
        <div className="p-2.5 rounded-lg bg-[#064E3B]/35 text-[#34D399] border border-[#10B981]/35 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-[#10B981] shrink-0" />
          {statusNotice}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-[#142019] border border-[#26372D] rounded-lg p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5 pb-3 border-b border-[#26372D] text-xs">
          <button
            onClick={() => setActiveTab('compliance')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'compliance'
                ? 'bg-[#064E3B]/50 text-[#F1F5F2] font-semibold border border-[#10B981]/50'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-[#10B981]" />
            <span>KYC, Withdrawals & AML Compliance</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#34D399] font-mono">
              NEW OPS
            </span>
          </button>

          <button
            onClick={() => setActiveTab('asset_networks')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'asset_networks'
                ? 'bg-[#064E3B]/50 text-[#F1F5F2] font-semibold border border-[#10B981]/50'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            <Layers className="w-4 h-4 text-[#10B981]" />
            <span>Asset & Network Management</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5] font-mono">
              MULTICHAIN
            </span>
          </button>

          <button
            onClick={() => setActiveTab('listing_lifecycle')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'listing_lifecycle'
                ? 'bg-[#064E3B]/50 text-[#F1F5F2] font-semibold border border-[#10B981]/50'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            <Rocket className="w-4 h-4 text-[#10B981]" />
            <span>Initial Listing Lifecycle & MM Launch</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5] font-mono">
              STAGE 1-7
            </span>
          </button>

          <button
            onClick={() => setActiveTab('vault')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'vault'
                ? 'bg-[#064E3B]/50 text-[#F1F5F2] font-semibold border border-[#10B981]/50'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            <Vault className="w-4 h-4 text-[#10B981]" />
            <span>Exchange Fee Vault</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#34D399] font-mono tabular-nums">
              {formatIDR(adminFeeVault.totalFeesIDR)}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('mm_console')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'mm_console'
                ? 'bg-[#064E3B]/50 text-[#F1F5F2] font-semibold border border-[#10B981]/50'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            <Cpu className="w-4 h-4 text-[#EAB866]" />
            <span>Quant MM Console</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#EAB866] font-mono">
              PRO ALGO
            </span>
          </button>

          <button
            onClick={() => setActiveTab('mm_matrix')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'mm_matrix'
                ? 'bg-[#064E3B]/50 text-[#F1F5F2] font-semibold border border-[#10B981]/50'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            <Table2 className="w-4 h-4 text-[#10B981]" />
            <span>Institutional MM Matrix (cs_*)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5] font-mono">
              CONFIG TABLE
            </span>
          </button>

          <button
            onClick={() => setActiveTab('mm')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'mm'
                ? 'bg-[#064E3B]/50 text-[#F1F5F2] font-semibold border border-[#10B981]/50'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            <Bot className="w-4 h-4 text-[#10B981]" />
            <span>Market Maker Bot Control</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5]">DMM</span>
          </button>

          <button
            onClick={() => setActiveTab('markets')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === 'markets'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#10B981]/40'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            Token Listing & Fee Governance
          </button>

          <button
            onClick={() => setActiveTab('engine')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === 'engine'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#10B981]/40'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            Engine Speed & Tuning
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === 'audit'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#10B981]/40'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            Live Audit Stream ({auditLogs.length})
          </button>
        </div>

        {/* Tab: Asset & Multi-Network Management */}
        {activeTab === 'asset_networks' && (
          <AssetNetworkPanel onSuccessNotice={(msg) => setStatusNotice(msg)} />
        )}

        {/* Tab: Compliance, KYC & Withdrawals */}
        {activeTab === 'compliance' && (
          <AdminCompliancePanel onSuccessNotice={(msg) => setStatusNotice(msg)} />
        )}

        {/* Tab: Initial Listing Lifecycle & MM Launch */}
        {activeTab === 'listing_lifecycle' && <InitialListingPanel />}

        {/* Tab: Exchange Fee Vault */}
        {activeTab === 'vault' && <AdminFeeVaultPanel />}

        {/* Tab: Institutional MM Matrix (cs_*) */}
        {activeTab === 'mm_matrix' && (
          <MMConfigTable onSuccessNotice={(msg) => setStatusNotice(msg)} />
        )}

        {/* Tab: Quant Market Maker Console & Feed Aggregator */}
        {activeTab === 'mm_console' && <MarketMakerConsolePanel />}

        {/* Tab: Comprehensive Market Maker Bot Component */}
        {activeTab === 'mm' && (
          <MarketMakerPanel onSuccessNotice={(msg) => setStatusNotice(msg)} />
        )}

        {/* Tab 2: Market & Fee Config */}
        {activeTab === 'markets' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono-nums text-xs">
              <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
                <tr>
                  <th className="py-2.5 px-3">Pair ID</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Last Mark Price</th>
                  <th className="py-2.5 px-3 text-right">Maker Fee (bps)</th>
                  <th className="py-2.5 px-3 text-right">Taker Fee (bps)</th>
                  <th className="py-2.5 px-3 text-right">Min Order Size</th>
                  <th className="py-2.5 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26372D]/60">
                {markets.map((m) => (
                  <tr key={m.id} className="hover:bg-[#192820] transition-colors">
                    <td className="py-3 px-3 font-bold text-[#F1F5F2]">{m.id}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          m.isActive
                            ? 'bg-[#064E3B]/45 text-[#34D399] border border-[#10B981]/30'
                            : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                        }`}
                      >
                        {m.isActive ? 'ACTIVE' : 'HALTED'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-[#F1F5F2] tabular-nums">
                      {formatIDR(m.lastPrice)}
                    </td>
                    <td className="py-3 px-3 text-right text-[#34D399] tabular-nums">
                      {editingPair === m.id ? (
                        <input
                          type="number"
                          value={makerFeeInput}
                          onChange={(e) => setMakerFeeInput(Number(e.target.value))}
                          className="w-16 glass-input rounded px-1.5 py-0.5 text-right font-mono"
                        />
                      ) : (
                        `${m.makerFeeBps} bps (${(m.makerFeeBps / 100).toFixed(2)}%)`
                      )}
                    </td>
                    <td className="py-3 px-3 text-right text-[#34D399] tabular-nums">
                      {editingPair === m.id ? (
                        <input
                          type="number"
                          value={takerFeeInput}
                          onChange={(e) => setMakerFeeInput(Number(e.target.value))}
                          className="w-16 glass-input rounded px-1.5 py-0.5 text-right font-mono"
                        />
                      ) : (
                        `${m.takerFeeBps} bps (${(m.takerFeeBps / 100).toFixed(2)}%)`
                      )}
                    </td>
                    <td className="py-3 px-3 text-right text-[#A1ADA5] tabular-nums">
                      {m.minOrderAmount} {m.baseAsset}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {editingPair === m.id ? (
                          <>
                            <button
                              onClick={() => handleSavePairConfig(m.id)}
                              className="px-2 py-0.5 rounded bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-[10.5px] transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingPair(null)}
                              className="px-2 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5] text-[10.5px]"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingPair(m.id);
                                setMakerFeeInput(m.makerFeeBps);
                                setTakerFeeInput(m.takerFeeBps);
                              }}
                              className="px-2 py-0.5 rounded bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#F1F5F2] text-[10.5px] transition-colors"
                            >
                              Edit Fees
                            </button>
                            <button
                              onClick={() => handleToggleMarketStatus(m.id, m.isActive)}
                              className={`px-2 py-0.5 rounded text-[10.5px] border transition-colors ${
                                m.isActive
                                  ? 'bg-[#EF6464]/10 text-[#EF6464] border-[#EF6464]/30'
                                  : 'bg-[#064E3B]/40 text-[#34D399] border-[#10B981]/30'
                              }`}
                            >
                              {m.isActive ? 'Halt Trading' : 'Resume Trading'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Synthetic Engine Tuning */}
        {activeTab === 'engine' && (
          <div className="space-y-4 max-w-xl">
            <div>
              <label className="block text-xs font-semibold text-[#A1ADA5] mb-1">
                Engine Clock Speed
              </label>
              <div className="flex gap-2">
                {(['fast', 'normal', 'slow', 'paused'] as const).map((spd) => (
                  <button
                    key={spd}
                    onClick={() => updateSettings({ engineSpeed: spd })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase border transition-colors ${
                      settings.engineSpeed === spd
                        ? 'bg-[#10B981] text-[#0B100E] border-[#10B981] font-bold'
                        : 'bg-[#101A15] text-[#A1ADA5] border-[#26372D] hover:text-[#F1F5F2]'
                    }`}
                  >
                    {spd}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#A1ADA5] mb-1">
                Market Fluctuation Volatility
              </label>
              <div className="flex gap-2">
                {(['low', 'normal', 'high'] as const).map((vol) => (
                  <button
                    key={vol}
                    onClick={() => updateSettings({ volatility: vol })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase border transition-colors ${
                      settings.volatility === vol
                        ? 'bg-[#10B981] text-[#0B100E] border-[#10B981] font-bold'
                        : 'bg-[#101A15] text-[#A1ADA5] border-[#26372D] hover:text-[#F1F5F2]'
                    }`}
                  >
                    {vol}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Live Audit */}
        {activeTab === 'audit' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono-nums text-xs">
              <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
                <tr>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Actor</th>
                  <th className="py-2 px-3">Action</th>
                  <th className="py-2 px-3">Target</th>
                  <th className="py-2 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26372D]/60">
                {auditLogs.map((log, idx) => (
                  <tr key={`${log.id || 'log'}-${idx}`} className="hover:bg-[#192820] transition-colors">
                    <td className="py-2 px-3 text-[#647168] text-[11px] whitespace-nowrap">
                      {formatDateTime(log.timestamp)}
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#F1F5F2]">{log.actor}</td>
                    <td className="py-2 px-3 text-[#34D399]">{log.action}</td>
                    <td className="py-2 px-3 text-[#A1ADA5]">{log.target}</td>
                    <td className="py-2 px-3 text-[#A1ADA5]">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B100E]/85 backdrop-blur-sm">
          <div className="bg-[#101A15] w-full max-w-sm rounded-lg p-5 border border-[#EF6464]/45 shadow-2xl">
            <h3 className="text-sm font-bold text-[#EF6464] mb-2">Reset All Simulation Records</h3>
            <p className="text-xs text-[#A1ADA5] mb-4">
              This will restore initial baseline balances, default markets, and wipe all order and trade histories. Proceed?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmResetOpen(false)}
                className="flex-1 py-2 text-xs text-[#A1ADA5] hover:text-[#F1F5F2] bg-[#142019] border border-[#26372D] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  resetSimulationData();
                  setConfirmResetOpen(false);
                }}
                className="flex-1 py-2 text-xs font-semibold bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] rounded-lg transition-colors"
              >
                Confirm Full Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
