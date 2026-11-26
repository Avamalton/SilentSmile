import React, { useEffect, useState } from 'react';
import {
  X,
  ShieldAlert,
  Sliders,
  Target,
  Clock,
  Layers,
  ShieldCheck,
  Wallet,
  Sparkles,
} from 'lucide-react';
import {
  PairLike,
  VOLUME_BOT_PRESETS,
  VolumeBotConfig,
  VolumeBotDTO,
  VolumeBotEnvironment,
  VolumeBotExecutionMode,
  VolumeBotPresetId,
  VolumeBotReferenceSource,
  VolumeBotSide,
  VolumeBotStrategy,
  buildPresetVolumeConfig,
} from './volumeBotTypes';

interface VolumeBotConfigModalProps {
  isOpen: boolean;
  editingBot: VolumeBotDTO | null;
  markets: PairLike[];
  defaultAccountId: string;
  onClose: () => void;
  onSubmit: (config: VolumeBotConfig, deployImmediately: boolean) => Promise<void>;
}

export const VolumeBotConfigModal: React.FC<VolumeBotConfigModalProps> = ({
  isOpen,
  editingBot,
  markets,
  defaultAccountId,
  onClose,
  onSubmit,
}) => {
  const defaultPair = markets[0] || {
    id: 'BTC/IDR',
    baseAsset: 'BTC',
    quoteAsset: 'IDR',
    lastPrice: 1485600000,
    priceDecimals: 0,
    amountDecimals: 5,
    minOrderAmount: 0.0001,
  };

  const [config, setConfig] = useState<VolumeBotConfig>(() =>
    buildPresetVolumeConfig('BALANCED', defaultPair, defaultAccountId)
  );
  const [deployImmediately, setDeployImmediately] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingBot) {
      setConfig({ ...editingBot.config });
      setDeployImmediately(false);
    } else {
      setConfig(buildPresetVolumeConfig('BALANCED', defaultPair, defaultAccountId));
      setDeployImmediately(true);
    }
  }, [isOpen, editingBot, defaultAccountId]);

  if (!isOpen) return null;

  const selectedPair = markets.find((m) => m.id === config.pairId) || defaultPair;

  const applyPreset = (presetId: VolumeBotPresetId) => {
    const next = buildPresetVolumeConfig(presetId, selectedPair, config.accountId || defaultAccountId);
    setConfig((prev) => ({
      ...next,
      environment: prev.environment,
      executionMode: prev.executionMode,
      executionSide: prev.executionSide,
      accountId: prev.accountId,
    }));
  };

  const handlePairChange = (pairId: string) => {
    const nextPair = markets.find((m) => m.id === pairId) || defaultPair;
    const preset = config.presetId || 'BALANCED';
    const adapted = buildPresetVolumeConfig(preset, nextPair, config.accountId || defaultAccountId);
    setConfig((prev) => ({
      ...adapted,
      botName: editingBot ? prev.botName : `${nextPair.id} ${preset} Execution`,
      environment: prev.environment,
      executionMode: prev.executionMode,
      executionSide: prev.executionSide,
      accountId: prev.accountId,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(config, deployImmediately);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save Volume Execution Bot configuration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-xl bg-[#142019] border border-[#26372D] shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#101A15] border-b border-[#26372D] shrink-0">
          <div>
            <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#10B981]" />
              {editingBot ? `Edit Volume Bot: ${editingBot.name}` : 'Configure Volume Execution & Liquidity Bot'}
            </h3>
            <p className="text-xs text-[#A1ADA5] mt-0.5">
              Zero-float BigInt precision • Legitimate CLOB execution • Trade-record verified accounting
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#142019] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-5 text-xs">
          {/* Preset Selector */}
          <div className="p-3.5 rounded-lg bg-[#101A15] border border-[#26372D] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#F1F5F2] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#10B981]" />
                Configuration Presets (Auto-Adapts to {selectedPair.id} Tick/Lot)
              </span>
              <span className="font-mono text-[11px] text-[#A1ADA5] tabular-nums">
                Active: {config.presetId || 'CUSTOM'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {VOLUME_BOT_PRESETS.map((p) => {
                const active = config.presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    title={p.description}
                    className={`px-2.5 py-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-[#064E3B]/50 border-[#10B981] text-[#F1F5F2]'
                        : 'bg-[#142019] border-[#26372D] text-[#A1ADA5] hover:border-[#10B981]/50 hover:text-[#F1F5F2]'
                    }`}
                  >
                    <div className="font-bold text-[11px] truncate">{p.label.replace(' Execution', '')}</div>
                    <div className="text-[10px] text-[#647168] font-mono truncate">{p.strategy}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {config.executionMode === 'LIVE' && (
            <div className="p-3 rounded-lg bg-[#EF6464]/10 border border-[#EF6464]/40 text-[#EF6464] flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">LIVE EXECUTION MODE ENABLED</div>
                <div className="text-[11px] text-[#F1F5F2]/85 mt-0.5">
                  Orders will be submitted directly to the authoritative Matching Engine using real ledger balances on account{' '}
                  <code className="font-mono font-bold">{config.accountId}</code>. No artificial balance injection is permitted.
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-[#EF6464]/15 border border-[#EF6464]/40 text-[#EF6464] font-semibold">
              {error}
            </div>
          )}

          {/* A. General Configuration */}
          <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-3">
            <h4 className="font-bold text-[#F1F5F2] uppercase tracking-wider text-[11px] border-b border-[#26372D] pb-2">
              A. General Configuration
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Bot Name</label>
                <input
                  type="text"
                  required
                  value={config.botName}
                  onChange={(e) => setConfig({ ...config, botName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2]"
                />
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Trading Pair</label>
                <select
                  value={config.pairId}
                  onChange={(e) => handlePairChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono font-bold"
                >
                  {markets.map((m) => (
                    <option key={m.id} value={m.id} className="bg-[#142019]">
                      {m.id} ({m.baseAsset}/{m.quoteAsset})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Execution Account ID</label>
                <input
                  type="text"
                  required
                  value={config.accountId}
                  onChange={(e) => setConfig({ ...config, accountId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
                />
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Environment Isolation</label>
                <select
                  value={config.environment}
                  onChange={(e) =>
                    setConfig({ ...config, environment: e.target.value as VolumeBotEnvironment })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono font-bold"
                >
                  <option value="DEMO">DEMO</option>
                  <option value="SANDBOX">SANDBOX</option>
                  <option value="STAGING">STAGING</option>
                  <option value="PRODUCTION">PRODUCTION</option>
                </select>
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Execution Mode</label>
                <select
                  value={config.executionMode}
                  onChange={(e) =>
                    setConfig({ ...config, executionMode: e.target.value as VolumeBotExecutionMode })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono font-bold"
                >
                  <option value="SIMULATION">SIMULATION (Isolated — Zero Ledger Mutation)</option>
                  <option value="LIVE">LIVE (Real Matching Engine & Ledger)</option>
                </select>
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Execution Side</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['BUY', 'SELL'] as VolumeBotSide[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setConfig({ ...config, executionSide: side })}
                      className={`py-2 rounded-lg font-mono font-bold border transition-colors ${
                        config.executionSide === side
                          ? side === 'BUY'
                            ? 'bg-[#064E3B] border-[#10B981] text-[#34D399]'
                            : 'bg-[#EF6464]/20 border-[#EF6464] text-[#EF6464]'
                          : 'bg-[#142019] border-[#26372D] text-[#A1ADA5]'
                      }`}
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* B. Execution Target */}
          <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-3">
            <h4 className="font-bold text-[#F1F5F2] uppercase tracking-wider text-[11px] border-b border-[#26372D] pb-2 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-[#10B981]" />
              B. Execution Target ({selectedPair.baseAsset})
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Target Volume ({selectedPair.baseAsset})
                </label>
                <input
                  type="text"
                  required
                  value={config.targetVolume}
                  onChange={(e) => setConfig({ ...config, targetVolume: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#34D399] font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Min Slice Size ({selectedPair.baseAsset})
                </label>
                <input
                  type="text"
                  required
                  value={config.minSliceSize}
                  onChange={(e) => setConfig({ ...config, minSliceSize: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
                />
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Max Slice Size ({selectedPair.baseAsset})
                </label>
                <input
                  type="text"
                  required
                  value={config.maxSliceSize}
                  onChange={(e) => setConfig({ ...config, maxSliceSize: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
                />
              </div>

              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Max Order Qty ({selectedPair.baseAsset})
                </label>
                <input
                  type="text"
                  value={config.maxOrderQty || ''}
                  onChange={(e) => setConfig({ ...config, maxOrderQty: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-[#A1ADA5] cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoStopOnTarget}
                onChange={(e) => setConfig({ ...config, autoStopOnTarget: e.target.checked })}
                className="accent-[#10B981]"
              />
              <span>Auto-stop and cancel resting orders when 100% of target volume is executed from verified trades</span>
            </label>
          </div>

          {/* C. Execution Scheduling */}
          <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-3">
            <h4 className="font-bold text-[#F1F5F2] uppercase tracking-wider text-[11px] border-b border-[#26372D] pb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#10B981]" />
              C. Execution Scheduling & Rate Controls
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 tabular-nums">
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Min Interval (ms)</label>
                <input
                  type="number"
                  min={250}
                  value={config.minIntervalMs}
                  onChange={(e) => setConfig({ ...config, minIntervalMs: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Max Interval (ms)</label>
                <input
                  type="number"
                  min={250}
                  value={config.maxIntervalMs}
                  onChange={(e) => setConfig({ ...config, maxIntervalMs: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Max Orders / Min</label>
                <input
                  type="number"
                  min={1}
                  value={config.maxOrdersPerMinute}
                  onChange={(e) => setConfig({ ...config, maxOrdersPerMinute: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Order Timeout (ms)</label>
                <input
                  type="number"
                  min={1000}
                  value={config.orderTimeoutMs}
                  onChange={(e) => setConfig({ ...config, orderTimeoutMs: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Partial Retry Limit</label>
                <input
                  type="number"
                  min={0}
                  value={config.partialFillRetryLimit}
                  onChange={(e) => setConfig({ ...config, partialFillRetryLimit: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Failure Cooldown (ms)</label>
                <input
                  type="number"
                  min={0}
                  value={config.cooldownAfterFailureMs}
                  onChange={(e) => setConfig({ ...config, cooldownAfterFailureMs: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
            </div>
          </div>

          {/* D. Execution Strategies */}
          <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-3">
            <h4 className="font-bold text-[#F1F5F2] uppercase tracking-wider text-[11px] border-b border-[#26372D] pb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#10B981]" />
              D. Execution Strategy
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Algorithmic Strategy</label>
                <select
                  value={config.strategy}
                  onChange={(e) =>
                    setConfig({ ...config, strategy: e.target.value as VolumeBotStrategy, presetId: 'CUSTOM' })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono font-bold"
                >
                  <option value="TWAP">TWAP (Time-Weighted Average Price)</option>
                  <option value="VWAP">VWAP (Volume-Weighted Historical Profile)</option>
                  <option value="ICEBERG">ICEBERG (Hidden Reserve + Visible Clips)</option>
                  <option value="PASSIVE_LIMIT">PASSIVE_LIMIT (BBO Offset Maker)</option>
                  <option value="AGGRESSIVE_LIMIT">AGGRESSIVE_LIMIT (Slippage-Capped Taker)</option>
                </select>
              </div>

              {config.strategy === 'TWAP' && (
                <div>
                  <label className="block text-[#A1ADA5] font-semibold mb-1">TWAP Horizon (ms)</label>
                  <input
                    type="number"
                    min={1000}
                    value={config.twapDurationMs ?? 300000}
                    onChange={(e) => setConfig({ ...config, twapDurationMs: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                  />
                </div>
              )}

              {config.strategy === 'VWAP' && (
                <div>
                  <label className="block text-[#A1ADA5] font-semibold mb-1">VWAP Lookback (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    value={config.vwapLookbackMinutes ?? 30}
                    onChange={(e) => setConfig({ ...config, vwapLookbackMinutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                  />
                </div>
              )}

              {config.strategy === 'ICEBERG' && (
                <div>
                  <label className="block text-[#A1ADA5] font-semibold mb-1">Iceberg Visible Ratio (%)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={config.icebergVisibleRatioPct ?? 20}
                    onChange={(e) => setConfig({ ...config, icebergVisibleRatioPct: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                  />
                </div>
              )}

              {config.strategy === 'PASSIVE_LIMIT' && (
                <div>
                  <label className="block text-[#A1ADA5] font-semibold mb-1">Passive Offset (Ticks)</label>
                  <input
                    type="number"
                    min={0}
                    value={config.passiveOffsetTicks ?? 1}
                    onChange={(e) => setConfig({ ...config, passiveOffsetTicks: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                  />
                </div>
              )}

              {config.strategy === 'AGGRESSIVE_LIMIT' && (
                <div>
                  <label className="block text-[#A1ADA5] font-semibold mb-1">Aggressive Max Ticks</label>
                  <input
                    type="number"
                    min={0}
                    value={config.aggressiveMaxTicks ?? 2}
                    onChange={(e) => setConfig({ ...config, aggressiveMaxTicks: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                  />
                </div>
              )}
            </div>
          </div>

          {/* E. Price Protection */}
          <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-3">
            <h4 className="font-bold text-[#F1F5F2] uppercase tracking-wider text-[11px] border-b border-[#26372D] pb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
              E. Price Protection & Precision Guards
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Reference Price Source</label>
                <select
                  value={config.referencePriceSource}
                  onChange={(e) =>
                    setConfig({ ...config, referencePriceSource: e.target.value as VolumeBotReferenceSource })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                >
                  <option value="HYBRID">HYBRID (Feed + Book)</option>
                  <option value="INTERNAL_BOOK">INTERNAL_BOOK</option>
                  <option value="AGGREGATED_FEED">AGGREGATED_FEED</option>
                </select>
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Min Price Collar ({selectedPair.quoteAsset})
                </label>
                <input
                  type="text"
                  value={config.minPriceCollar}
                  onChange={(e) => setConfig({ ...config, minPriceCollar: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Max Price Collar ({selectedPair.quoteAsset})
                </label>
                <input
                  type="text"
                  value={config.maxPriceCollar}
                  onChange={(e) => setConfig({ ...config, maxPriceCollar: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Max Slippage (bps)</label>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={config.maxSlippageBps}
                  onChange={(e) => setConfig({ ...config, maxSlippageBps: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#EAB866] font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Max Participation (bps)</label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={config.maxParticipationRateBps}
                  onChange={(e) => setConfig({ ...config, maxParticipationRateBps: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Stale Data Max Age (ms)</label>
                <input
                  type="number"
                  min={1000}
                  value={config.staleMarketDataMaxAgeMs}
                  onChange={(e) => setConfig({ ...config, staleMarketDataMaxAgeMs: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Tick Size ({selectedPair.quoteAsset})
                </label>
                <input
                  type="text"
                  required
                  value={config.tickSize}
                  onChange={(e) => setConfig({ ...config, tickSize: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Lot Size ({selectedPair.baseAsset})
                </label>
                <input
                  type="text"
                  required
                  value={config.lotSize}
                  onChange={(e) => setConfig({ ...config, lotSize: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
            </div>
          </div>

          {/* F. Inventory & Risk Management */}
          <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-3">
            <h4 className="font-bold text-[#F1F5F2] uppercase tracking-wider text-[11px] border-b border-[#26372D] pb-2 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-[#10B981]" />
              F. Inventory, Exposure & Risk Limits (0 = No Extra Cap Beyond Account Balance)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 tabular-nums">
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Max Base Inv ({selectedPair.baseAsset})
                </label>
                <input
                  type="text"
                  value={config.maxBaseInventory}
                  onChange={(e) => setConfig({ ...config, maxBaseInventory: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Max Quote Inv ({selectedPair.quoteAsset})
                </label>
                <input
                  type="text"
                  value={config.maxQuoteInventory}
                  onChange={(e) => setConfig({ ...config, maxQuoteInventory: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Max Order Notional ({selectedPair.quoteAsset})
                </label>
                <input
                  type="text"
                  value={config.maxOrderNotional}
                  onChange={(e) => setConfig({ ...config, maxOrderNotional: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Max Cumul. Exposure ({selectedPair.quoteAsset})
                </label>
                <input
                  type="text"
                  value={config.maxCumulativeExposure}
                  onChange={(e) => setConfig({ ...config, maxCumulativeExposure: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">
                  Daily Limit ({selectedPair.quoteAsset})
                </label>
                <input
                  type="text"
                  value={config.dailyExecutionLimit}
                  onChange={(e) => setConfig({ ...config, dailyExecutionLimit: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
              <div>
                <label className="block text-[#A1ADA5] font-semibold mb-1">Max Open Orders</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={config.maxOpenOrders}
                  onChange={(e) => setConfig({ ...config, maxOpenOrders: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="inline-flex items-center gap-1.5 text-[#34D399] font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                Self-Trade Prevention (STP): ENFORCED ON SERVER
              </span>

              {!editingBot && (
                <label className="inline-flex items-center gap-2 text-[#A1ADA5] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deployImmediately}
                    onChange={(e) => setDeployImmediately(e.target.checked)}
                    className="accent-[#10B981]"
                  />
                  <span>Deploy immediately to READY status upon creation</span>
                </label>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#26372D]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] disabled:opacity-50 text-[#0B100E] font-bold transition-colors"
            >
              {submitting ? 'Saving...' : editingBot ? 'Save Configuration' : 'Create Volume Bot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
