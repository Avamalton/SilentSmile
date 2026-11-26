import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  Check,
  Eye,
  EyeOff,
  LayoutGrid,
  RotateCcw,
  Save,
  Sliders,
  X,
} from 'lucide-react';
import {
  TradingLayoutPreferences,
  TradingLayoutPreset,
  TradingWorkspacePanelKey,
} from '../../simulation/types';
import {
  DEFAULT_TRADING_LAYOUT,
  PANEL_WIDTH_LIMITS,
  TRADING_LAYOUT_PRESETS,
  applyLayoutPreset,
  normalizeTradingLayout,
} from './tradingLayoutTypes';

interface LayoutPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  layout: TradingLayoutPreferences;
  savedLayout?: TradingLayoutPreferences;
  onChangeLayout: (next: TradingLayoutPreferences) => void;
  onSavePreferences: (toSave: TradingLayoutPreferences) => void;
  onRestoreSaved: () => void;
  onRestoreDefault: () => void;
}

const PANEL_ORDER_LABELS: Record<TradingWorkspacePanelKey, string> = {
  chart: 'Chart',
  orderBook: 'Order Book',
  recentTrades: 'Recent Trades',
  orderEntry: 'Order Entry',
};

const TOGGLEABLE_PANELS: Array<{
  key: keyof TradingLayoutPreferences['panels'];
  label: string;
  description: string;
  lockedCore?: boolean;
}> = [
  {
    key: 'marketHeader',
    label: 'Market Header',
    description: 'Pair selector, last traded price, 24h change, high/low, and volume.',
  },
  {
    key: 'chart',
    label: 'Chart Panel',
    description: 'Candlestick chart, technical indicators, timeframes, and depth view.',
    lockedCore: true,
  },
  {
    key: 'orderBook',
    label: 'Order Book Panel',
    description: 'Aggregated bids/asks, cumulative depth, spread, and imbalance.',
  },
  {
    key: 'recentTrades',
    label: 'Recent Trades Panel',
    description: 'Live market execution tape with side colors and timestamps.',
  },
  {
    key: 'orderEntry',
    label: 'Order Entry Panel',
    description: 'Buy/Sell spot order placement, balance allocation, and confirmation.',
    lockedCore: true,
  },
  {
    key: 'bottomPanel',
    label: 'Bottom Trading Panel',
    description: 'Open Orders, Order History, Trade History, and MM quotes.',
  },
  {
    key: 'tickerFooter',
    label: 'Market Ticker Footer',
    description: 'Connection state, multi-pair quick ticker, and fee schedule.',
  },
];

export const LayoutPreferencesModal: React.FC<LayoutPreferencesModalProps> = ({
  isOpen,
  onClose,
  layout,
  savedLayout,
  onChangeLayout,
  onSavePreferences,
  onRestoreSaved,
  onRestoreDefault,
}) => {
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: TradingLayoutPreset) => {
    onChangeLayout(applyLayoutPreset(preset));
  };

  const handleTogglePanel = (key: keyof TradingLayoutPreferences['panels']) => {
    if (key === 'chart' || key === 'orderEntry') return;
    onChangeLayout(
      normalizeTradingLayout({
        ...layout,
        panels: {
          ...layout.panels,
          [key]: !layout.panels[key],
        },
        updatedAt: Date.now(),
      })
    );
  };

  const handleMovePanelOrder = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= layout.panelOrder.length) return;
    const nextOrder = [...layout.panelOrder];
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(targetIndex, 0, moved);
    onChangeLayout(
      normalizeTradingLayout({
        ...layout,
        panelOrder: nextOrder,
        updatedAt: Date.now(),
      })
    );
  };

  const handleDimensionChange = (
    field:
      | 'orderBookWidthPx'
      | 'recentTradesWidthPx'
      | 'orderEntryWidthPx'
      | 'workspaceHeightPx'
      | 'bottomPanelHeightPx'
      | 'orderBookTradesSplitPct',
    value: number
  ) => {
    onChangeLayout(
      normalizeTradingLayout({
        ...layout,
        [field]: value,
        updatedAt: Date.now(),
      })
    );
  };

  const handleSaveClick = () => {
    onSavePreferences(layout);
    setSavedNotice('Workspace preferences saved to your profile.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const handleRestoreSavedClick = () => {
    if (!savedLayout) return;
    onRestoreSaved();
    setSavedNotice('Restored your saved layout preferences.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const handleRestoreDefaultClick = () => {
    onRestoreDefault();
    setSavedNotice('Restored Classic Pro default layout.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="layout-prefs-title"
    >
      <div className="w-full max-w-3xl rounded-xl bg-[#101A15] border border-[#26372D] shadow-2xl max-h-[90vh] flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#26372D] bg-[#142019] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#064E3B]/50 border border-[#10B981]/30 flex items-center justify-center shrink-0">
              <LayoutGrid className="w-4 h-4 text-[#10B981]" />
            </div>
            <div>
              <h2 id="layout-prefs-title" className="text-sm font-bold text-[#F1F5F2]">
                Trading Layout Preferences
              </h2>
              <p className="text-[11px] text-[#A1ADA5]">
                Configure workspace presets, visible panels, column order, and panel dimensions.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] transition-colors"
            aria-label="Close layout preferences"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {savedNotice && (
            <div className="px-3 py-2 rounded-lg bg-[#064E3B]/45 border border-[#10B981]/35 text-[#34D399] flex items-center gap-2 text-xs font-medium">
              <BookmarkCheck className="w-4 h-4 shrink-0" />
              <span>{savedNotice}</span>
            </div>
          )}

          {/* 1. Layout Presets */}
          <section>
            <h3 className="text-xs font-semibold text-[#F1F5F2] uppercase tracking-wider mb-2.5">
              Workspace Presets
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(Object.keys(TRADING_LAYOUT_PRESETS) as TradingLayoutPreset[]).map((presetKey) => {
                const preset = TRADING_LAYOUT_PRESETS[presetKey];
                const isActive = layout.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      isActive
                        ? 'bg-[#192820] border-[#10B981]/50 text-[#F1F5F2]'
                        : 'bg-[#142019] border-[#26372D] text-[#A1ADA5] hover:border-[#364E40] hover:text-[#F1F5F2]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-[#F1F5F2]">{preset.label}</span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#34D399]">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#A1ADA5] mt-1 leading-relaxed">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Show / Hide Supported Panels */}
          <section>
            <h3 className="text-xs font-semibold text-[#F1F5F2] uppercase tracking-wider mb-2.5">
              Panel Visibility
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TOGGLEABLE_PANELS.map((item) => {
                const visible = layout.panels[item.key];
                return (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#142019] border border-[#26372D]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-[#F1F5F2] truncate">{item.label}</span>
                        {item.lockedCore && (
                          <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[#192820] text-[#34D399] border border-[#26372D] shrink-0">
                            Core
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-[#A1ADA5] truncate mt-0.5">{item.description}</p>
                    </div>

                    <button
                      type="button"
                      disabled={item.lockedCore}
                      onClick={() => handleTogglePanel(item.key)}
                      aria-pressed={visible}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 shrink-0 transition-colors ${
                        item.lockedCore
                          ? 'bg-[#192820] border-[#26372D] text-[#647168] cursor-not-allowed'
                          : visible
                          ? 'bg-[#064E3B]/50 border-[#10B981]/40 text-[#34D399]'
                          : 'bg-[#0B100E] border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2]'
                      }`}
                    >
                      {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      <span>{visible ? 'Shown' : 'Hidden'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. Column Ordering */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-semibold text-[#F1F5F2] uppercase tracking-wider">
                Desktop Column Arrangement
              </h3>
              <span className="text-[10.5px] text-[#A1ADA5]">
                Preserves active chart & form state
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {layout.panelOrder.map((panelKey, idx) => (
                <div
                  key={panelKey}
                  className="p-2.5 rounded-lg bg-[#142019] border border-[#26372D] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] text-[#647168] tabular-nums">Column {idx + 1}</div>
                    <div className="font-semibold text-[#F1F5F2] truncate">
                      {PANEL_ORDER_LABELS[panelKey]}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMovePanelOrder(idx, -1)}
                      className="p-1 rounded bg-[#0B100E] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] disabled:opacity-35"
                      title="Move column left"
                      aria-label={`Move ${PANEL_ORDER_LABELS[panelKey]} left`}
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === layout.panelOrder.length - 1}
                      onClick={() => handleMovePanelOrder(idx, 1)}
                      className="p-1 rounded bg-[#0B100E] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] disabled:opacity-35"
                      title="Move column right"
                      aria-label={`Move ${PANEL_ORDER_LABELS[panelKey]} right`}
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Panel Dimensions */}
          <section>
            <div className="flex items-center gap-1.5 mb-2.5">
              <Sliders className="w-3.5 h-3.5 text-[#10B981]" />
              <h3 className="text-xs font-semibold text-[#F1F5F2] uppercase tracking-wider">
                Panel Widths & Heights
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-[#142019] border border-[#26372D]">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#A1ADA5]">Order Book Width</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">{layout.orderBookWidthPx}px</span>
                </div>
                <input
                  type="range"
                  min={PANEL_WIDTH_LIMITS.orderBook.min}
                  max={PANEL_WIDTH_LIMITS.orderBook.max}
                  step={5}
                  value={layout.orderBookWidthPx}
                  onChange={(e) => handleDimensionChange('orderBookWidthPx', Number(e.target.value))}
                  className="w-full accent-[#10B981]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#A1ADA5]">Order Entry Width</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">{layout.orderEntryWidthPx}px</span>
                </div>
                <input
                  type="range"
                  min={PANEL_WIDTH_LIMITS.orderEntry.min}
                  max={PANEL_WIDTH_LIMITS.orderEntry.max}
                  step={5}
                  value={layout.orderEntryWidthPx}
                  onChange={(e) => handleDimensionChange('orderEntryWidthPx', Number(e.target.value))}
                  className="w-full accent-[#10B981]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#A1ADA5]">Recent Trades Column Width</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">{layout.recentTradesWidthPx}px</span>
                </div>
                <input
                  type="range"
                  min={PANEL_WIDTH_LIMITS.recentTrades.min}
                  max={PANEL_WIDTH_LIMITS.recentTrades.max}
                  step={5}
                  value={layout.recentTradesWidthPx}
                  onChange={(e) => handleDimensionChange('recentTradesWidthPx', Number(e.target.value))}
                  className="w-full accent-[#10B981]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#A1ADA5]">Main Workspace Height</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">{layout.workspaceHeightPx}px</span>
                </div>
                <input
                  type="range"
                  min={PANEL_WIDTH_LIMITS.workspaceHeight.min}
                  max={PANEL_WIDTH_LIMITS.workspaceHeight.max}
                  step={10}
                  value={layout.workspaceHeightPx}
                  onChange={(e) => handleDimensionChange('workspaceHeightPx', Number(e.target.value))}
                  className="w-full accent-[#10B981]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#A1ADA5]">Bottom Orders Panel Height</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">{layout.bottomPanelHeightPx}px</span>
                </div>
                <input
                  type="range"
                  min={PANEL_WIDTH_LIMITS.bottomPanelHeight.min}
                  max={PANEL_WIDTH_LIMITS.bottomPanelHeight.max}
                  step={10}
                  value={layout.bottomPanelHeightPx}
                  onChange={(e) => handleDimensionChange('bottomPanelHeightPx', Number(e.target.value))}
                  className="w-full accent-[#10B981]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#A1ADA5]">Book / Trades Stack Split</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">{layout.orderBookTradesSplitPct}%</span>
                </div>
                <input
                  type="range"
                  min={PANEL_WIDTH_LIMITS.splitPct.min}
                  max={PANEL_WIDTH_LIMITS.splitPct.max}
                  step={2}
                  value={layout.orderBookTradesSplitPct}
                  onChange={(e) => handleDimensionChange('orderBookTradesSplitPct', Number(e.target.value))}
                  className="w-full accent-[#10B981]"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-[#26372D] bg-[#142019] shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRestoreDefaultClick}
              className="px-3 py-1.5 rounded-lg bg-[#0B100E] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D] font-medium flex items-center gap-1.5 transition-colors"
              title={`Reset to ${DEFAULT_TRADING_LAYOUT.preset} defaults`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore Default</span>
            </button>

            <button
              type="button"
              onClick={handleRestoreSavedClick}
              disabled={!savedLayout}
              className="px-3 py-1.5 rounded-lg bg-[#0B100E] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <BookmarkCheck className="w-3.5 h-3.5" />
              <span>Restore Saved</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveClick}
              className="px-3.5 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Preferences</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
