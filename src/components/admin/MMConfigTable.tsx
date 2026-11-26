import React, { useState, useMemo } from 'react';
import { useSimulation } from '../../simulation/store';
import { FullMMConfig, MMDirection, MMDumpAction, MMTargetSource, MMStrategyMode, TimeFrame } from '../../simulation/types';
import { formatIDR, safeRound } from '../../utils/formatters';
import {
  Sliders,
  ShieldAlert,
  Download,
  Upload,
  RotateCcw,
  Check,
  AlertTriangle,
  Play,
  Pause,
  Save,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { DEFAULT_FULL_MM_CONFIGS, validateFullMMConfig } from '../../simulation/mmStrategyEngine';

interface MMConfigTableProps {
  onSuccessNotice?: (msg: string) => void;
}

export const MMConfigTable: React.FC<MMConfigTableProps> = ({ onSuccessNotice }) => {
  const {
    markets,
    fullMMConfigs,
    updateFullMMConfig,
    activePair,
  } = useSimulation();

  const [selectedPairId, setSelectedPairId] = useState<string>(activePair.id || 'DNA/IDR');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [editingConfig, setEditingConfig] = useState<FullMMConfig>(() => {
    return fullMMConfigs[selectedPairId] || DEFAULT_FULL_MM_CONFIGS[selectedPairId] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
  });
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // When selected pair changes, load its config
  const currentSavedConfig = useMemo(() => {
    return fullMMConfigs[selectedPairId] || DEFAULT_FULL_MM_CONFIGS[selectedPairId] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
  }, [fullMMConfigs, selectedPairId]);

  const handlePairChange = (newPairId: string) => {
    setSelectedPairId(newPairId);
    const cfg = fullMMConfigs[newPairId] || DEFAULT_FULL_MM_CONFIGS[newPairId] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
    setEditingConfig({ ...cfg });
    setDirtyFields(new Set());
    setValidationErrors([]);
  };

  const handleFieldChange = (key: keyof FullMMConfig, value: any) => {
    setEditingConfig((prev) => {
      const next = { ...prev, [key]: value };
      const validation = validateFullMMConfig(next);
      setValidationErrors(validation.errors);
      return next;
    });
    setDirtyFields((prev) => new Set(prev).add(key));
  };

  const handleSaveAll = () => {
    const validation = validateFullMMConfig(editingConfig);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      return;
    }
    updateFullMMConfig(selectedPairId, editingConfig);
    setDirtyFields(new Set());
    setValidationErrors([]);
    const msg = `Market Maker configuration saved successfully for ${selectedPairId}.`;
    setNotice(msg);
    if (onSuccessNotice) onSuccessNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const handleResetSingleField = (key: keyof FullMMConfig) => {
    const def = DEFAULT_FULL_MM_CONFIGS[selectedPairId] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
    const defaultVal = (def as any)[key];
    handleFieldChange(key, defaultVal);
  };

  const handleResetAllToDefaults = () => {
    const def = DEFAULT_FULL_MM_CONFIGS[selectedPairId] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
    setEditingConfig({ ...def });
    updateFullMMConfig(selectedPairId, { ...def });
    setDirtyFields(new Set());
    setValidationErrors([]);
    setNotice(`Reset all parameters to institutional defaults for ${selectedPairId}.`);
    setTimeout(() => setNotice(null), 3000);
  };

  const handleApplyPreset = (presetType: 'tight' | 'support' | 'bullish' | 'neutral') => {
    let presetPatch: Partial<FullMMConfig> = {};
    const currentPrice = editingConfig.cs_target_price || 14250;
    if (presetType === 'tight') {
      presetPatch = {
        cs_max_book_spread_pct: 0.25,
        cs_dead_zone_pct: 0.1,
        cs_direction: 'Neutral',
        strategy_mode: 'spread_capture',
        quote_interval_ms: 2000,
        cs_walk_max_levels: 8,
      };
    } else if (presetType === 'support') {
      presetPatch = {
        cs_direction: 'Up',
        buy_min_price_limit: Math.round(currentPrice * 0.90),
        buy_max_price_limit: Math.round(currentPrice * 0.995),
        sell_min_price_limit: Math.round(currentPrice * 1.005),
        sell_max_price_limit: Math.round(currentPrice * 1.15),
        cs_support_budget_idr: Math.round(editingConfig.cs_total_budget_idr * 0.6),
        cs_volume_ratio: 1.5,
      };
    } else if (presetType === 'bullish') {
      presetPatch = {
        cs_direction: 'Up',
        cs_target_premium_pct: 0.5,
        cs_max_step_percent: 1.2,
        strategy_mode: 'inventory_skew',
      };
    } else if (presetType === 'neutral') {
      presetPatch = {
        cs_direction: 'Neutral',
        cs_target_premium_pct: 0.0,
        cs_max_book_spread_pct: 1.0,
        strategy_mode: 'passive_grid',
        cs_walk_max_levels: 10,
      };
    }

    setEditingConfig((prev) => ({ ...prev, ...presetPatch }));
    setDirtyFields((prev) => {
      const next = new Set(prev);
      Object.keys(presetPatch).forEach((k) => next.add(k));
      return next;
    });
    setNotice(`Applied institutional preset: ${presetType.toUpperCase()}. Review values below and click Save.`);
    setTimeout(() => setNotice(null), 3500);
  };

  const handleEmergencyStop = () => {
    const updated = {
      ...editingConfig,
      emergency_stop: !editingConfig.emergency_stop,
      lifecycle_state: (!editingConfig.emergency_stop ? 'STOPPED' : 'RUNNING') as any,
    };
    setEditingConfig(updated);
    updateFullMMConfig(selectedPairId, updated);
    setNotice(
      updated.emergency_stop
        ? `EMERGENCY STOP ENGAGED: MM quotes halted for ${selectedPairId}.`
        : `Emergency stop disengaged for ${selectedPairId}.`
    );
    setTimeout(() => setNotice(null), 3500);
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(editingConfig, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `mm_config_${selectedPairId.replace('/', '_')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJSON = () => {
    try {
      const parsed = JSON.parse(importJsonText);
      const validation = validateFullMMConfig(parsed);
      if (!validation.isValid) {
        alert('Invalid configuration format:\n' + validation.errors.join('\n'));
        return;
      }
      setEditingConfig(parsed);
      updateFullMMConfig(selectedPairId, parsed);
      setImportModalOpen(false);
      setImportJsonText('');
      setNotice('Imported and applied MM configuration from JSON.');
      setTimeout(() => setNotice(null), 3500);
    } catch (e) {
      alert('Failed to parse JSON. Please check syntax.');
    }
  };

  // Definitions for all parameters
  const PARAMETER_DEFINITIONS: {
    key: keyof FullMMConfig;
    label: string;
    category: 'core' | 'budget' | 'walk' | 'risk' | 'ops' | 'limits';
    type: 'number' | 'text' | 'boolean' | 'select';
    options?: string[];
    description: string;
    unit?: string;
  }[] = [
    // Core parameters (cs_*)
    {
      key: 'cs_price_decimal',
      label: 'Price Decimal Precision',
      category: 'core',
      type: 'number',
      description: 'Allowed decimal places for quoting prices on this market.',
    },
    {
      key: 'cs_quantity_decimal',
      label: 'Quantity Decimal Precision',
      category: 'core',
      type: 'number',
      description: 'Allowed quantity precision for order sizes.',
    },
    {
      key: 'cs_direction',
      label: 'Directional Skew',
      category: 'core',
      type: 'select',
      options: ['Up', 'Down', 'Neutral'],
      description: 'Market-making directional stance (adjusts bid/ask spread & depth asymmetry).',
    },
    {
      key: 'cs_target_price',
      label: 'Target Reference Price',
      category: 'core',
      type: 'number',
      unit: 'IDR',
      description: 'Target or reference price used when target source is set to static.',
    },
    {
      key: 'cs_target_source',
      label: 'Reference Source',
      category: 'core',
      type: 'select',
      options: ['mid_price', 'static', 'order_book'],
      description: 'Dynamic reference quote source for pricing the order ladder.',
    },
    {
      key: 'cs_target_premium_pct',
      label: 'Target Premium / Discount',
      category: 'core',
      type: 'number',
      unit: '%',
      description: 'Percentage premium or discount applied to reference price.',
    },
    {
      key: 'cs_duration_hours',
      label: 'Strategy Duration',
      category: 'core',
      type: 'number',
      unit: 'Hours',
      description: 'Maximum runtime for quoting lifecycle before requiring operator review.',
    },
    {
      key: 'cs_timeframe',
      label: 'Evaluation Timeframe',
      category: 'core',
      type: 'select',
      options: ['1m', '5m', '15m', '1h', '4h', '1D'],
      description: 'Market-data evaluation timeframe for volatility and trend checks.',
    },
    {
      key: 'cs_max_step_percent',
      label: 'Max Price Step',
      category: 'core',
      type: 'number',
      unit: '%',
      description: 'Maximum permitted price movement between ladder adjustments.',
    },
    {
      key: 'cs_dead_zone_pct',
      label: 'Dead Zone Range',
      category: 'core',
      type: 'number',
      unit: '%',
      description: 'No-adjustment price buffer around target to eliminate quote flickering.',
    },
    {
      key: 'cs_flip_hysteresis_candles',
      label: 'Flip Hysteresis Confirmation',
      category: 'core',
      type: 'number',
      unit: 'Candles',
      description: 'Consecutive candle intervals required before direction switch is accepted.',
    },
    {
      key: 'cs_max_book_spread_pct',
      label: 'Max Book Spread Limit',
      category: 'core',
      type: 'number',
      unit: '%',
      description: 'Hard ceiling on the maximum permitted spread between best bid and ask.',
    },

    // Budget & Inventory
    {
      key: 'cs_total_budget_idr',
      label: 'Total Strategy Budget',
      category: 'budget',
      type: 'number',
      unit: 'IDR',
      description: 'Hard upper ceiling for all quote capital allocated to this market.',
    },
    {
      key: 'cs_nudge_budget_idr',
      label: 'Nudge Budget Allocation',
      category: 'budget',
      type: 'number',
      unit: 'IDR',
      description: 'Budget reserved for small fine-tuning quote adjustments at the top of book.',
    },
    {
      key: 'cs_support_budget_idr',
      label: 'Support Budget Allocation',
      category: 'budget',
      type: 'number',
      unit: 'IDR',
      description: 'Budget reserved for deep liquidity and passive bids placement.',
    },
    {
      key: 'cs_volume_ratio',
      label: 'Target Volume Ratio',
      category: 'budget',
      type: 'number',
      description: 'Multiplier for quoted book depth scaling relative to base volume.',
    },
    {
      key: 'max_order_notional_idr',
      label: 'Max Single Order Notional',
      category: 'budget',
      type: 'number',
      unit: 'IDR',
      description: 'Maximum permitted notional value for any individual MM order.',
    },
    {
      key: 'max_daily_spend_idr',
      label: 'Max Daily Spend Limit',
      category: 'budget',
      type: 'number',
      unit: 'IDR',
      description: 'Cumulative 24-hour limit on capital deployed by the bot.',
    },

    // Walk-Book & Quoting
    {
      key: 'cs_walk_book',
      label: 'Walk-Book Multi-Level Quoting',
      category: 'walk',
      type: 'boolean',
      description: 'Enables controlled multi-level passive order placement across the book.',
    },
    {
      key: 'cs_walk_max_levels',
      label: 'Walk-Book Max Levels',
      category: 'walk',
      type: 'number',
      description: 'Maximum depth levels populated on each side of the order book.',
    },
    {
      key: 'cs_walk_max_slippage_pct',
      label: 'Walk-Book Max Slippage',
      category: 'walk',
      type: 'number',
      unit: '%',
      description: 'Maximum price deviation permitted for deep walk-book levels.',
    },
    {
      key: 'cs_orphan_cancel_seconds',
      label: 'Orphan Order Timeout',
      category: 'walk',
      type: 'number',
      unit: 'Sec',
      description: 'Time before stale or out-of-range orders are reconciled and cancelled.',
    },
    {
      key: 'quote_interval_ms',
      label: 'Quoting Frequency Interval',
      category: 'walk',
      type: 'number',
      unit: 'ms',
      description: 'Interval between periodic order book inventory sweeps.',
    },

    // Risk Controls
    {
      key: 'cs_dump_threshold_percent',
      label: 'Dump Detection Threshold',
      category: 'risk',
      type: 'number',
      unit: '%',
      description: 'Rapid price drop threshold that triggers automated defensive posture.',
    },
    {
      key: 'cs_dump_action',
      label: 'Dump Response Policy',
      category: 'risk',
      type: 'select',
      options: ['pause', 'cancel_orders', 'reprice', 'alert'],
      description: 'Automated policy invoked upon dump detection.',
    },
    {
      key: 'stop_loss_percent',
      label: 'Stop Loss Threshold',
      category: 'risk',
      type: 'number',
      unit: '%',
      description: 'Inventory loss threshold triggering immediate quote cancellation.',
    },
    {
      key: 'max_drawdown_percent',
      label: 'Max Strategy Drawdown',
      category: 'risk',
      type: 'number',
      unit: '%',
      description: 'Maximum allowable portfolio drawdown before bot enters ERROR halt.',
    },

    // Operations & Lifecycle
    {
      key: 'enabled',
      label: 'Bot Enabled Status',
      category: 'ops',
      type: 'boolean',
      description: 'Master operational toggle for this trading pair.',
    },
    {
      key: 'strategy_mode',
      label: 'Strategy Algorithm Mode',
      category: 'ops',
      type: 'select',
      options: ['passive_grid', 'spread_capture', 'inventory_skew'],
      description: 'Core algorithm behavior for positioning liquidity.',
    },
    {
      key: 'min_order_quantity',
      label: 'Min Order Quantity',
      category: 'ops',
      type: 'number',
      description: 'Smallest order slice generated for ladder levels.',
    },
    {
      key: 'max_order_quantity',
      label: 'Max Order Quantity',
      category: 'ops',
      type: 'number',
      description: 'Largest order slice generated for ladder levels.',
    },

    // Price Bounds & Execution Jitter (Anti-Mental)
    {
      key: 'buy_min_price_limit',
      label: 'Support Hard Floor (Min Buy Price)',
      category: 'limits',
      type: 'number',
      unit: 'IDR',
      description: 'Absolute minimum price floor below which MM bids will never be quoted.',
    },
    {
      key: 'buy_max_price_limit',
      label: 'Support Hard Ceiling (Max Buy Price)',
      category: 'limits',
      type: 'number',
      unit: 'IDR',
      description: 'Maximum price ceiling for bids, preventing buying above configured support.',
    },
    {
      key: 'sell_min_price_limit',
      label: 'Resistance Hard Floor (Min Sell Price)',
      category: 'limits',
      type: 'number',
      unit: 'IDR',
      description: 'Minimum price floor for asks, preventing dumping below resistance.',
    },
    {
      key: 'sell_max_price_limit',
      label: 'Resistance Hard Ceiling (Max Sell Price)',
      category: 'limits',
      type: 'number',
      unit: 'IDR',
      description: 'Maximum allowable quote price ceiling for resistance sell orders.',
    },
    {
      key: 'expire_time',
      label: 'Order Expire TTL',
      category: 'limits',
      type: 'number',
      unit: 'Sec',
      description: 'Time-to-live expiration in seconds before orders are automatically refreshed.',
    },
    {
      key: 'order_count',
      label: 'Target Quoting Order Count',
      category: 'limits',
      type: 'number',
      description: 'Desired number of quoting orders per side in the active book.',
    },
    {
      key: 'split_order',
      label: 'Tranche Split Order',
      category: 'limits',
      type: 'boolean',
      description: 'Splits individual quote blocks into randomized multi-tranche sizes.',
    },
    {
      key: 'split_range',
      label: 'Split Range Depth',
      category: 'limits',
      type: 'number',
      unit: '%',
      description: 'Percentage depth range across which tranche slices are distributed.',
    },
    {
      key: 'jitter_timing_pct',
      label: 'Timing Jitter Latency',
      category: 'limits',
      type: 'number',
      unit: '%',
      description: 'Randomized timing jitter percentage added between quote sweeps.',
    },
    {
      key: 'jitter_price_pct',
      label: 'Price Spacing Jitter',
      category: 'limits',
      type: 'number',
      unit: '%',
      description: 'Micro-spread price jitter percentage preventing front-running.',
    },
    {
      key: 'transaction_type',
      label: 'Transaction Order Type',
      category: 'limits',
      type: 'select',
      options: ['post_only', 'limit', 'ioc'],
      description: 'Execution enforcement flag (post_only guarantees maker fee status).',
    },
    {
      key: 'account_id',
      label: 'Designated Bot Account ID',
      category: 'limits',
      type: 'text',
      description: 'Trading simulator account identity executing the MM orders.',
    },
  ];

  const filteredParams = useMemo(() => {
    if (activeCategory === 'all') return PARAMETER_DEFINITIONS;
    return PARAMETER_DEFINITIONS.filter((p) => p.category === activeCategory);
  }, [activeCategory]);

  return (
    <div className="flex flex-col gap-4">
      {/* Top Controls: Pair Selector & Action Bar */}
      <div className="p-4 rounded-xl border border-[#26372D] flex flex-wrap items-center justify-between gap-3 bg-[#142019]">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-[#A1ADA5]">Target Trading Pair:</label>
          <div className="flex items-center gap-1.5 bg-[#101A15] rounded-lg p-1 border border-[#26372D]">
            {markets.map((m) => (
              <button
                key={m.id}
                onClick={() => handlePairChange(m.id)}
                className={`px-3 py-1 rounded-md text-xs font-mono font-bold transition-colors ${
                  selectedPairId === m.id
                    ? 'bg-[#10B981] text-[#0B100E]'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
                }`}
              >
                {m.id}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Emergency Stop Button */}
          <button
            onClick={handleEmergencyStop}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold font-mono flex items-center gap-1.5 transition-colors ${
              editingConfig.emergency_stop
                ? 'bg-[#10B981] hover:bg-[#34D399] text-[#0B100E]'
                : 'bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E]'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>{editingConfig.emergency_stop ? 'RESUME BOT (DISENGAGE)' : 'EMERGENCY STOP'}</span>
          </button>

          {/* Export JSON */}
          <button
            onClick={handleExportJSON}
            className="px-2.5 py-1.5 bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] rounded-lg text-xs font-medium flex items-center gap-1 border border-[#26372D] transition-colors"
            title="Export JSON Config"
          >
            <Download className="w-3.5 h-3.5 text-[#34D399]" />
            <span>Export</span>
          </button>

          {/* Import JSON */}
          <button
            onClick={() => setImportModalOpen(true)}
            className="px-2.5 py-1.5 bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] rounded-lg text-xs font-medium flex items-center gap-1 border border-[#26372D] transition-colors"
            title="Import JSON Config"
          >
            <Upload className="w-3.5 h-3.5 text-[#60A5FA]" />
            <span>Import</span>
          </button>

          {/* Reset All */}
          <button
            onClick={handleResetAllToDefaults}
            className="px-2.5 py-1.5 bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] rounded-lg text-xs font-medium flex items-center gap-1 border border-[#26372D] transition-colors"
            title="Reset to Factory Defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Defaults</span>
          </button>

          {/* Save Changes */}
          <button
            onClick={handleSaveAll}
            disabled={dirtyFields.size === 0 || validationErrors.length > 0}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
              dirtyFields.size > 0 && validationErrors.length === 0
                ? 'bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] border border-[#10B981]'
                : 'bg-[#192820] text-[#647168] border border-[#26372D] cursor-not-allowed'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>Save Config {dirtyFields.size > 0 ? `(${dirtyFields.size})` : ''}</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-lg bg-[#064E3B]/40 border border-[#10B981]/40 text-[#34D399] text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-[#10B981] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="p-3 rounded-lg bg-[#EF6464]/10 border border-[#EF6464]/40 text-[#EF6464] text-xs flex flex-col gap-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-4 h-4 text-[#EF6464] shrink-0" />
            <span>Validation Checks Failed:</span>
          </div>
          <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-[#EF6464]">
            {validationErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Institutional Strategy Presets Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[#101A15] border border-[#26372D] text-xs">
        <div className="flex items-center gap-1.5 text-[#A1ADA5]">
          <Sparkles className="w-3.5 h-3.5 text-[#EAB866]" />
          <span className="font-semibold text-[#F1F5F2]">1-Click Institutional Presets:</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleApplyPreset('tight')}
            className="px-2.5 py-1 rounded-lg bg-[#142019] hover:bg-[#192820] text-[#60A5FA] border border-[#60A5FA]/30 text-[11px] font-semibold transition-colors flex items-center gap-1"
          >
            <span>⚡ Tight 0.25% Spread</span>
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset('support')}
            className="px-2.5 py-1 rounded-lg bg-[#064E3B]/30 hover:bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 text-[11px] font-semibold transition-colors flex items-center gap-1"
          >
            <span>🛡️ Floor Protection Wall</span>
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset('bullish')}
            className="px-2.5 py-1 rounded-lg bg-[#142019] hover:bg-[#192820] text-[#EAB866] border border-[#EAB866]/30 text-[11px] font-semibold transition-colors flex items-center gap-1"
          >
            <span>📈 Bullish Skew (Up)</span>
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset('neutral')}
            className="px-2.5 py-1 rounded-lg bg-[#142019] hover:bg-[#192820] text-[#F1F5F2] border border-[#26372D] text-[11px] font-semibold transition-colors flex items-center gap-1"
          >
            <span>⚖️ Neutral Passive Grid</span>
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 border-b border-[#26372D] pb-2 text-xs overflow-x-auto">
        {[
          { id: 'all', label: 'All Parameters' },
          { id: 'core', label: 'Core Quoting & Direction (cs_*)' },
          { id: 'limits', label: 'Price Limits & Jitter (Anti-Mental)' },
          { id: 'budget', label: 'Budget & Inventory' },
          { id: 'walk', label: 'Walk-Book & Quoting' },
          { id: 'risk', label: 'Risk & Dump Guard' },
          { id: 'ops', label: 'Operations & Strategy' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat.id
                ? 'bg-[#064E3B]/50 text-[#34D399] font-semibold border border-[#10B981]/40'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* High-Density Parameters Table */}
      <div className="bg-[#142019] rounded-xl border border-[#26372D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Parameter Key</th>
                <th className="py-2.5 px-3">Human Label & Purpose</th>
                <th className="py-2.5 px-3">Saved Value</th>
                <th className="py-2.5 px-3 min-w-[200px]">Live Input Value</th>
                <th className="py-2.5 px-3 text-center">Unit</th>
                <th className="py-2.5 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#26372D]/60">
              {filteredParams.map((param) => {
                const isDirty = dirtyFields.has(param.key);
                const savedVal = (currentSavedConfig as any)[param.key];
                const liveVal = (editingConfig as any)[param.key];

                return (
                  <tr
                    key={param.key}
                    className={`hover:bg-[#192820]/60 transition-colors ${
                      isDirty ? 'bg-[#064E3B]/20' : ''
                    }`}
                  >
                    {/* Key */}
                    <td className="py-2.5 px-3 font-mono font-bold text-[#34D399]">
                      {param.key}
                    </td>

                    {/* Description */}
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[#F1F5F2]">{param.label}</div>
                      <div className="text-[10.5px] text-[#A1ADA5] leading-tight mt-0.5">
                        {param.description}
                      </div>
                    </td>

                    {/* Saved Value */}
                    <td className="py-2.5 px-3 font-mono text-[#A1ADA5] tabular-nums">
                      {typeof savedVal === 'boolean'
                        ? savedVal
                          ? 'true'
                          : 'false'
                        : typeof savedVal === 'number'
                        ? savedVal.toLocaleString('id-ID')
                        : String(savedVal)}
                    </td>

                    {/* Input Control */}
                    <td className="py-2.5 px-3">
                      {param.type === 'boolean' ? (
                        <button
                          onClick={() => handleFieldChange(param.key, !liveVal)}
                          className={`px-3 py-1 rounded text-xs font-mono font-bold transition-colors ${
                            liveVal
                              ? 'bg-[#10B981] text-[#0B100E]'
                              : 'bg-[#101A15] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D]'
                          }`}
                        >
                          {liveVal ? 'ENABLED (TRUE)' : 'DISABLED (FALSE)'}
                        </button>
                      ) : param.type === 'select' && param.options ? (
                        <select
                          value={liveVal}
                          onChange={(e) => handleFieldChange(param.key, e.target.value)}
                          className="rounded px-2 py-1 text-xs font-mono bg-[#101A15] text-[#F1F5F2] border border-[#26372D] w-full focus:border-[#10B981] outline-none"
                        >
                          {param.options.map((opt) => (
                            <option key={opt} value={opt} className="bg-[#101A15] text-[#F1F5F2]">
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={param.type === 'number' ? 'number' : 'text'}
                          value={liveVal !== undefined ? liveVal : ''}
                          onChange={(e) =>
                            handleFieldChange(
                              param.key,
                              param.type === 'number' ? Number(e.target.value) : e.target.value
                            )
                          }
                          className={`rounded px-2.5 py-1 text-xs font-mono bg-[#101A15] text-[#F1F5F2] border w-full outline-none tabular-nums ${
                            isDirty
                              ? 'border-[#10B981] ring-1 ring-[#10B981]/30'
                              : 'border-[#26372D] focus:border-[#10B981]'
                          }`}
                        />
                      )}
                    </td>

                    {/* Unit */}
                    <td className="py-2.5 px-3 text-center text-[#647168] text-[11px] font-mono">
                      {param.unit || '—'}
                    </td>

                    {/* Reset Action */}
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => handleResetSingleField(param.key)}
                        className="p-1 hover:bg-[#192820] rounded text-[#647168] hover:text-[#F1F5F2] transition-colors"
                        title="Reset to default"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import Modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B100E]/80 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-xl p-5 border border-[#26372D] bg-[#142019] flex flex-col gap-3">
            <h3 className="text-sm font-bold text-[#F1F5F2] flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#10B981]" />
              <span>Import Market Maker JSON Configuration</span>
            </h3>
            <p className="text-xs text-[#A1ADA5]">
              Paste valid JSON representing the MarketMaker configuration for {selectedPairId}.
            </p>
            <textarea
              rows={10}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Paste JSON here..."
              className="w-full rounded-lg p-3 font-mono text-xs text-[#F1F5F2] bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setImportModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleImportJSON}
                className="px-4 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] text-xs font-bold"
              >
                Apply Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
