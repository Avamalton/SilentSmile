import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookmarkCheck,
  Bot,
  ChevronDown,
  ChevronUp,
  Columns,
  Eye,
  GripVertical,
  LayoutGrid,
  Rocket,
  Save,
  Sliders,
} from 'lucide-react';
import { MarketHeader } from '../components/trading/MarketHeader';
import { TradingChart } from '../components/trading/TradingChart';
import { OrderBook } from '../components/trading/OrderBook';
import { RecentTradesPanel } from '../components/trading/RecentTradesPanel';
import { OrderForm } from '../components/trading/OrderForm';
import { OrdersPanel } from '../components/trading/OrdersPanel';
import { MarketTickerFooter } from '../components/trading/MarketTickerFooter';
import { MarketSentimentIndicator } from '../components/trading/MarketSentimentIndicator';
import { LayoutPreferencesModal } from '../components/trading/LayoutPreferencesModal';
import {
  DEFAULT_TRADING_LAYOUT,
  PANEL_WIDTH_LIMITS,
  TRADING_LAYOUT_PRESETS,
  applyLayoutPreset,
  clampNumericRange,
  normalizeTradingLayout,
  reorderWorkspacePanels,
} from '../components/trading/tradingLayoutTypes';
import { useSimulation } from '../simulation/store';
import {
  TradingLayoutPreferences,
  TradingLayoutPreset,
  TradingWorkspacePanelKey,
} from '../simulation/types';
import { useRouter } from '../router';
import { formatIDR } from '../utils/formatters';

type ViewportTier = 'mobile' | 'tablet' | 'desktop';
type MobileTab = 'chart' | 'book' | 'trades' | 'trade' | 'orders';

function getViewportTier(): ViewportTier {
  if (typeof window === 'undefined') return 'desktop';
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

export const TradingTerminalView: React.FC = () => {
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const {
    currentUser,
    activePair,
    initialListings,
    settings,
    updateSettings,
    openOrders,
  } = useSimulation();
  const { navigate } = useRouter();
  const [now, setNow] = useState(Date.now());
  const [viewportTier, setViewportTier] = useState<ViewportTier>(() => getViewportTier());
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart');
  const [prefsModalOpen, setPrefsModalOpen] = useState(false);
  const [draggedPanel, setDraggedPanel] = useState<TradingWorkspacePanelKey | null>(null);
  const [dragOverPanel, setDragOverPanel] = useState<TradingWorkspacePanelKey | null>(null);
  const [layoutToast, setLayoutToast] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setViewportTier(getViewportTier());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const layout = useMemo(
    () => normalizeTradingLayout(settings.tradingLayout),
    [settings.tradingLayout]
  );
  const savedLayout = useMemo(
    () =>
      settings.savedTradingLayout
        ? normalizeTradingLayout(settings.savedTradingLayout)
        : undefined,
    [settings.savedTradingLayout]
  );

  const isLayoutDirty = useMemo(() => {
    if (!savedLayout) return false;
    const stripMeta = (l: TradingLayoutPreferences) => ({
      ...l,
      updatedAt: undefined,
    });
    return JSON.stringify(stripMeta(layout)) !== JSON.stringify(stripMeta(savedLayout));
  }, [layout, savedLayout]);

  const showToast = useCallback((msg: string) => {
    setLayoutToast(msg);
    setTimeout(() => setLayoutToast(null), 2200);
  }, []);

  const handleLayoutChange = useCallback(
    (next: TradingLayoutPreferences) => {
      updateSettings({ tradingLayout: normalizeTradingLayout(next) });
    },
    [updateSettings]
  );

  const handleSelectPreset = useCallback(
    (preset: TradingLayoutPreset) => {
      const next = applyLayoutPreset(preset);
      handleLayoutChange(next);
      showToast(`Applied ${TRADING_LAYOUT_PRESETS[preset].label} layout`);
    },
    [handleLayoutChange, showToast]
  );

  const handleSavePreferences = useCallback(
    (toSave: TradingLayoutPreferences) => {
      const normalized = normalizeTradingLayout({
        ...toSave,
        updatedAt: Date.now(),
      });
      updateSettings({
        tradingLayout: normalized,
        savedTradingLayout: normalized,
      });
      showToast('Layout preferences saved');
    },
    [updateSettings, showToast]
  );

  const handleRestoreSaved = useCallback(() => {
    if (!savedLayout) return;
    handleLayoutChange(normalizeTradingLayout(savedLayout));
    showToast('Restored saved layout');
  }, [savedLayout, handleLayoutChange, showToast]);

  const handleRestoreDefault = useCallback(() => {
    handleLayoutChange(normalizeTradingLayout(DEFAULT_TRADING_LAYOUT));
    showToast('Restored Classic Pro default');
  }, [handleLayoutChange, showToast]);

  const togglePanelCollapse = useCallback(
    (key: 'chart' | 'orderBook' | 'recentTrades' | 'orderEntry' | 'bottomPanel') => {
      handleLayoutChange({
        ...layout,
        collapsedPanels: {
          ...layout.collapsedPanels,
          [key]: !layout.collapsedPanels[key],
        },
        updatedAt: Date.now(),
      });
    },
    [layout, handleLayoutChange]
  );

  const togglePanelVisibility = useCallback(
    (key: keyof TradingLayoutPreferences['panels']) => {
      if (key === 'chart' || key === 'orderEntry') return;
      handleLayoutChange({
        ...layout,
        panels: {
          ...layout.panels,
          [key]: !layout.panels[key],
        },
        updatedAt: Date.now(),
      });
    },
    [layout, handleLayoutChange]
  );

  // Drag-to-resize state & refs
  const workspaceRef = useRef<HTMLDivElement>(null);
  const marketStackRef = useRef<HTMLDivElement>(null);

  const startWidthResize = useCallback(
    (
      target: 'orderBookWidthPx' | 'recentTradesWidthPx' | 'orderEntryWidthPx',
      direction: -1 | 1,
      e: React.MouseEvent
    ) => {
      e.preventDefault();
      const startX = e.clientX;
      const startVal = layout[target];
      const limits =
        target === 'orderBookWidthPx'
          ? PANEL_WIDTH_LIMITS.orderBook
          : target === 'recentTradesWidthPx'
          ? PANEL_WIDTH_LIMITS.recentTrades
          : PANEL_WIDTH_LIMITS.orderEntry;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = (moveEvent.clientX - startX) * direction;
        const clamped = clampNumericRange(startVal + delta, limits.min, limits.max, startVal);
        handleLayoutChange({
          ...layout,
          [target]: clamped,
          updatedAt: Date.now(),
        });
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [layout, handleLayoutChange]
  );

  const startVerticalStackResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = marketStackRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const relativeY = moveEvent.clientY - rect.top;
        const pct = clampNumericRange(
          (relativeY / rect.height) * 100,
          PANEL_WIDTH_LIMITS.splitPct.min,
          PANEL_WIDTH_LIMITS.splitPct.max,
          layout.orderBookTradesSplitPct
        );
        handleLayoutChange({
          ...layout,
          orderBookTradesSplitPct: pct,
          updatedAt: Date.now(),
        });
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [layout, handleLayoutChange]
  );

  const startHeightResize = useCallback(
    (target: 'workspaceHeightPx' | 'bottomPanelHeightPx', e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startVal = layout[target];
      const limits =
        target === 'workspaceHeightPx'
          ? PANEL_WIDTH_LIMITS.workspaceHeight
          : PANEL_WIDTH_LIMITS.bottomPanelHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientY - startY;
        const clamped = clampNumericRange(startVal + delta, limits.min, limits.max, startVal);
        handleLayoutChange({
          ...layout,
          [target]: clamped,
          updatedAt: Date.now(),
        });
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [layout, handleLayoutChange]
  );

  // Drag-and-drop non-destructive column reordering via CSS order
  const handleDropPanel = useCallback(
    (targetKey: TradingWorkspacePanelKey) => {
      if (!draggedPanel || draggedPanel === targetKey) {
        setDraggedPanel(null);
        setDragOverPanel(null);
        return;
      }
      const nextOrder = reorderWorkspacePanels(layout.panelOrder, draggedPanel, targetKey);
      handleLayoutChange({
        ...layout,
        panelOrder: nextOrder,
        updatedAt: Date.now(),
      });
      setDraggedPanel(null);
      setDragOverPanel(null);
    },
    [draggedPanel, layout, handleLayoutChange]
  );

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

  const isCompactPreset = layout.preset === 'compact_pro';
  const isSeparateTradesColumn =
    layout.preset === 'multi_panel' &&
    viewportTier === 'desktop' &&
    typeof window !== 'undefined' &&
    window.innerWidth >= 1280;

  // Compute CSS flex order numbers cleanly from layout.panelOrder
  const getColumnOrder = (key: TradingWorkspacePanelKey): number => {
    const idx = layout.panelOrder.indexOf(key);
    return idx === -1 ? 99 : idx;
  };

  // In stacked mode (Classic / Chart Focus / Compact), OrderBook & RecentTrades share a market column
  const marketColumnOrder = Math.min(getColumnOrder('orderBook'), getColumnOrder('recentTrades'));
  const showMarketColumn = layout.panels.orderBook || layout.panels.recentTrades;

  return (
    <div className="flex flex-col gap-2.5 min-h-[calc(100vh-5rem)]">
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
                <strong className="text-[#F1F5F2]">Upcoming Market:</strong> Public trading opens once countdown expires and the 11-point readiness checklist passes. Order matching is isolated from premature public execution.
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
                type="button"
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
              <strong className="text-[#F1F5F2]">DMM Control Active:</strong> You are managing the Central Limit Order Book for{' '}
              <span className="font-mono text-[#34D399] font-semibold">{activePair.id}</span>. Order placement here injects resting quotes directly into the CLOB.
            </span>
          </div>
          <button
            type="button"
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
            type="button"
            onClick={() => navigate('/admin')}
            className="px-3 py-1.5 rounded-lg bg-[#192820] hover:bg-[#26372D]/60 text-[#F1F5F2] border border-[#26372D] font-semibold text-xs transition-colors flex items-center gap-1.5 shrink-0"
          >
            <span>Admin Governance</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. Market Header */}
      {layout.panels.marketHeader && <MarketHeader />}

      {/* Workspace Control Strip (Presets, Quick Visibility, Drag Hint, Layout Preferences) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#101A15] border border-[#26372D] text-[11px]">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[#647168] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 mr-1">
            <Columns className="w-3.5 h-3.5 text-[#10B981]" />
            <span className="hidden sm:inline">Workspace:</span>
          </span>
          {(Object.keys(TRADING_LAYOUT_PRESETS) as TradingLayoutPreset[]).map((presetKey) => {
            const p = TRADING_LAYOUT_PRESETS[presetKey];
            const active = layout.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPreset(p.id)}
                className={`px-2 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#192820] text-[#34D399] border border-[#10B981]/40 font-semibold'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#142019]'
                }`}
                title={p.description}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap ml-auto">
          {!layout.panels.marketHeader && (
            <button
              type="button"
              onClick={() => togglePanelVisibility('marketHeader')}
              className="px-2 py-1 rounded-md bg-[#192820] text-[#EAB866] border border-[#EAB866]/35 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <Eye className="w-3 h-3" />
              <span>Show Header ({activePair.id})</span>
            </button>
          )}

          {/* Quick visibility switches on Desktop */}
          <div className="hidden xl:flex items-center gap-1 border-r border-[#26372D] pr-2 mr-0.5">
            {(
              [
                { key: 'orderBook', label: 'Book' },
                { key: 'recentTrades', label: 'Trades' },
                { key: 'bottomPanel', label: 'Orders' },
                { key: 'tickerFooter', label: 'Ticker' },
              ] as const
            ).map((item) => {
              const shown = layout.panels[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => togglePanelVisibility(item.key)}
                  aria-pressed={shown}
                  className={`px-2 py-0.5 rounded text-[10.5px] border transition-colors whitespace-nowrap shrink-0 ${
                    shown
                      ? 'bg-[#142019] border-[#26372D] text-[#F1F5F2]'
                      : 'bg-[#0B100E] border-[#26372D] text-[#647168] hover:text-[#A1ADA5]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {layoutToast && (
            <span className="text-[10.5px] text-[#34D399] font-medium flex items-center gap-1 whitespace-nowrap">
              <BookmarkCheck className="w-3.5 h-3.5" />
              {layoutToast}
            </span>
          )}

          {isLayoutDirty && (
            <button
              type="button"
              onClick={() => handleSavePreferences(layout)}
              className="px-2.5 py-1 rounded-md bg-[#064E3B]/60 hover:bg-[#064E3B] text-[#34D399] border border-[#10B981]/40 font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              title="Save modified workspace dimensions & visibility"
            >
              <Save className="w-3 h-3" />
              <span>Save</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setPrefsModalOpen(true)}
            className="px-2.5 py-1 rounded-md bg-[#192820] hover:bg-[#064E3B]/50 text-[#F1F5F2] hover:text-[#34D399] border border-[#26372D] hover:border-[#10B981]/40 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Layout Preferences</span>
          </button>
        </div>
      </div>

      {/* Market Sentiment Order Book Depth Bar */}
      <MarketSentimentIndicator />

      {/* =================================================================== */}
      {/* DESKTOP WORKSPACE (>= 1024px): Configurable Resizable Multi-Column  */}
      {/* =================================================================== */}
      {viewportTier === 'desktop' && (
        <>
          <div
            ref={workspaceRef}
            className="flex items-stretch gap-2 w-full min-w-0"
            style={{
              height: layout.collapsedPanels.chart
                ? 'auto'
                : `${layout.workspaceHeightPx}px`,
            }}
          >
            {/* COLUMN: CHART (Flexible primary column) */}
            <div
              style={{ order: getColumnOrder('chart') }}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedPanel && draggedPanel !== 'chart') setDragOverPanel('chart');
              }}
              onDragLeave={() => setDragOverPanel(null)}
              onDrop={() => handleDropPanel('chart')}
              className={`flex-1 min-w-[340px] min-h-0 flex flex-col relative rounded-xl transition-shadow ${
                dragOverPanel === 'chart' ? 'ring-1 ring-[#10B981]' : ''
              }`}
            >
              {/* Drag / Collapse Micro-Handle */}
              <div
                draggable
                onDragStart={() => setDraggedPanel('chart')}
                onDragEnd={() => {
                  setDraggedPanel(null);
                  setDragOverPanel(null);
                }}
                className="flex items-center justify-between px-2.5 py-1 bg-[#101A15] border border-b-0 border-[#26372D] rounded-t-xl text-[10px] text-[#647168] cursor-grab active:cursor-grabbing select-none shrink-0"
                title="Drag column header onto another column to reorder workspace"
              >
                <span className="flex items-center gap-1 text-[#A1ADA5] font-medium">
                  <GripVertical className="w-3 h-3 text-[#647168]" />
                  Chart · {activePair.id}
                </span>
                <button
                  type="button"
                  onClick={() => togglePanelCollapse('chart')}
                  className="p-0.5 rounded hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2]"
                  title={layout.collapsedPanels.chart ? 'Expand Chart' : 'Collapse Chart'}
                  aria-label={layout.collapsedPanels.chart ? 'Expand Chart' : 'Collapse Chart'}
                >
                  {layout.collapsedPanels.chart ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {!layout.collapsedPanels.chart && (
                <div className="flex-1 min-h-0 [&>div]:rounded-t-none">
                  <TradingChart onSelectPrice={(price) => setSelectedPrice(price)} />
                </div>
              )}
            </div>

            {/* MULTI-PANEL MODE: Independent Order Book + Independent Recent Trades Columns */}
            {isSeparateTradesColumn ? (
              <>
                {layout.panels.orderBook && (
                  <div
                    style={{
                      order: getColumnOrder('orderBook'),
                      width: `${layout.orderBookWidthPx}px`,
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedPanel && draggedPanel !== 'orderBook') setDragOverPanel('orderBook');
                    }}
                    onDragLeave={() => setDragOverPanel(null)}
                    onDrop={() => handleDropPanel('orderBook')}
                    className={`shrink-0 min-h-0 flex relative ${
                      dragOverPanel === 'orderBook' ? 'ring-1 ring-[#10B981] rounded-xl' : ''
                    }`}
                  >
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize Order Book column"
                      onMouseDown={(e) =>
                        startWidthResize(
                          'orderBookWidthPx',
                          getColumnOrder('orderBook') < getColumnOrder('chart') ? 1 : -1,
                          e
                        )
                      }
                      className={`w-1.5 cursor-col-resize hover:bg-[#10B981]/40 rounded transition-colors shrink-0 ${
                        getColumnOrder('orderBook') < getColumnOrder('chart')
                          ? 'order-last ml-0.5 -mr-1.5'
                          : '-ml-1.5 mr-0.5'
                      }`}
                      title="Drag to resize Order Book width"
                    />
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                      <div
                        draggable
                        onDragStart={() => setDraggedPanel('orderBook')}
                        onDragEnd={() => {
                          setDraggedPanel(null);
                          setDragOverPanel(null);
                        }}
                        className="flex items-center justify-between px-2.5 py-1 bg-[#101A15] border border-b-0 border-[#26372D] rounded-t-xl text-[10px] text-[#647168] cursor-grab active:cursor-grabbing select-none shrink-0"
                        title="Drag column header to reorder"
                      >
                        <span className="flex items-center gap-1 text-[#A1ADA5] font-medium">
                          <GripVertical className="w-3 h-3 text-[#647168]" />
                          Order Book
                        </span>
                      </div>
                      <div className="flex-1 min-h-0 [&>div]:rounded-t-none">
                        <OrderBook
                          onSelectPrice={(price) => setSelectedPrice(price)}
                          collapsed={Boolean(layout.collapsedPanels.orderBook)}
                          onToggleCollapse={() => togglePanelCollapse('orderBook')}
                          compact={isCompactPreset}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {layout.panels.recentTrades && (
                  <div
                    style={{
                      order: getColumnOrder('recentTrades'),
                      width: `${layout.recentTradesWidthPx}px`,
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedPanel && draggedPanel !== 'recentTrades') setDragOverPanel('recentTrades');
                    }}
                    onDragLeave={() => setDragOverPanel(null)}
                    onDrop={() => handleDropPanel('recentTrades')}
                    className={`shrink-0 min-h-0 flex relative ${
                      dragOverPanel === 'recentTrades' ? 'ring-1 ring-[#10B981] rounded-xl' : ''
                    }`}
                  >
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize Recent Trades column"
                      onMouseDown={(e) =>
                        startWidthResize(
                          'recentTradesWidthPx',
                          getColumnOrder('recentTrades') < getColumnOrder('chart') ? 1 : -1,
                          e
                        )
                      }
                      className={`w-1.5 cursor-col-resize hover:bg-[#10B981]/40 rounded transition-colors shrink-0 ${
                        getColumnOrder('recentTrades') < getColumnOrder('chart')
                          ? 'order-last ml-0.5 -mr-1.5'
                          : '-ml-1.5 mr-0.5'
                      }`}
                      title="Drag to resize Recent Trades width"
                    />
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                      <div
                        draggable
                        onDragStart={() => setDraggedPanel('recentTrades')}
                        onDragEnd={() => {
                          setDraggedPanel(null);
                          setDragOverPanel(null);
                        }}
                        className="flex items-center justify-between px-2.5 py-1 bg-[#101A15] border border-b-0 border-[#26372D] rounded-t-xl text-[10px] text-[#647168] cursor-grab active:cursor-grabbing select-none shrink-0"
                        title="Drag column header to reorder"
                      >
                        <span className="flex items-center gap-1 text-[#A1ADA5] font-medium">
                          <GripVertical className="w-3 h-3 text-[#647168]" />
                          Market Tape
                        </span>
                      </div>
                      <div className="flex-1 min-h-0 [&>div]:rounded-t-none">
                        <RecentTradesPanel
                          onSelectPrice={(price) => setSelectedPrice(price)}
                          collapsed={Boolean(layout.collapsedPanels.recentTrades)}
                          onToggleCollapse={() => togglePanelCollapse('recentTrades')}
                          compact={isCompactPreset}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* STACKED MARKET COLUMN (Classic Pro / Chart Focus / Compact Pro) */
              showMarketColumn && (
                <div
                  style={{
                    order: marketColumnOrder,
                    width: `${layout.orderBookWidthPx}px`,
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedPanel && draggedPanel !== 'orderBook') setDragOverPanel('orderBook');
                  }}
                  onDragLeave={() => setDragOverPanel(null)}
                  onDrop={() => handleDropPanel('orderBook')}
                  className={`shrink-0 min-h-0 flex relative ${
                    dragOverPanel === 'orderBook' ? 'ring-1 ring-[#10B981] rounded-xl' : ''
                  }`}
                >
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize Order Book & Trades column"
                    onMouseDown={(e) =>
                      startWidthResize(
                        'orderBookWidthPx',
                        marketColumnOrder < getColumnOrder('chart') ? 1 : -1,
                        e
                      )
                    }
                    className={`w-1.5 cursor-col-resize hover:bg-[#10B981]/40 rounded transition-colors shrink-0 ${
                      marketColumnOrder < getColumnOrder('chart')
                        ? 'order-last ml-0.5 -mr-1.5'
                        : '-ml-1.5 mr-0.5'
                    }`}
                    title="Drag to resize Market Column width"
                  />

                  <div ref={marketStackRef} className="flex-1 min-w-0 min-h-0 flex flex-col">
                    <div
                      draggable
                      onDragStart={() => setDraggedPanel('orderBook')}
                      onDragEnd={() => {
                        setDraggedPanel(null);
                        setDragOverPanel(null);
                      }}
                      className="flex items-center justify-between px-2.5 py-1 bg-[#101A15] border border-b-0 border-[#26372D] rounded-t-xl text-[10px] text-[#647168] cursor-grab active:cursor-grabbing select-none shrink-0"
                      title="Drag column header to swap with Chart or Order Entry"
                    >
                      <span className="flex items-center gap-1 text-[#A1ADA5] font-medium">
                        <GripVertical className="w-3 h-3 text-[#647168]" />
                        {layout.panels.orderBook && layout.panels.recentTrades
                          ? 'Order Book & Trades'
                          : layout.panels.orderBook
                          ? 'Order Book'
                          : 'Recent Trades'}
                      </span>
                    </div>

                    <div className="flex-1 min-h-0 flex flex-col">
                      {layout.panels.orderBook && (
                        <div
                          className="min-h-0 flex flex-col [&>div]:rounded-t-none"
                          style={{
                            height: layout.collapsedPanels.orderBook
                              ? 'auto'
                              : layout.panels.recentTrades && !layout.collapsedPanels.recentTrades
                              ? `${layout.orderBookTradesSplitPct}%`
                              : '100%',
                          }}
                        >
                          <OrderBook
                            onSelectPrice={(price) => setSelectedPrice(price)}
                            collapsed={Boolean(layout.collapsedPanels.orderBook)}
                            onToggleCollapse={() => togglePanelCollapse('orderBook')}
                            compact={isCompactPreset}
                          />
                        </div>
                      )}

                      {layout.panels.orderBook &&
                        layout.panels.recentTrades &&
                        !layout.collapsedPanels.orderBook &&
                        !layout.collapsedPanels.recentTrades && (
                          <div
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label="Resize Order Book and Recent Trades split"
                            onMouseDown={startVerticalStackResize}
                            className="h-2 cursor-row-resize flex items-center justify-center group shrink-0"
                            title="Drag to resize Order Book vs Recent Trades height"
                          >
                            <span className="w-10 h-0.5 rounded-full bg-[#26372D] group-hover:bg-[#10B981] transition-colors" />
                          </div>
                        )}

                      {layout.panels.recentTrades && (
                        <div className="flex-1 min-h-0 flex flex-col">
                          <RecentTradesPanel
                            onSelectPrice={(price) => setSelectedPrice(price)}
                            collapsed={Boolean(layout.collapsedPanels.recentTrades)}
                            onToggleCollapse={() => togglePanelCollapse('recentTrades')}
                            compact={isCompactPreset}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            )}

            {/* COLUMN: ORDER ENTRY */}
            <div
              style={{
                order: getColumnOrder('orderEntry'),
                width: `${layout.orderEntryWidthPx}px`,
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedPanel && draggedPanel !== 'orderEntry') setDragOverPanel('orderEntry');
              }}
              onDragLeave={() => setDragOverPanel(null)}
              onDrop={() => handleDropPanel('orderEntry')}
              className={`shrink-0 min-h-0 flex relative ${
                dragOverPanel === 'orderEntry' ? 'ring-1 ring-[#10B981] rounded-xl' : ''
              }`}
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Order Entry column"
                onMouseDown={(e) =>
                  startWidthResize(
                    'orderEntryWidthPx',
                    getColumnOrder('orderEntry') < getColumnOrder('chart') ? 1 : -1,
                    e
                  )
                }
                className={`w-1.5 cursor-col-resize hover:bg-[#10B981]/40 rounded transition-colors shrink-0 ${
                  getColumnOrder('orderEntry') < getColumnOrder('chart')
                    ? 'order-last ml-0.5 -mr-1.5'
                    : '-ml-1.5 mr-0.5'
                }`}
                title="Drag to resize Order Entry width"
              />
              <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                <div
                  draggable
                  onDragStart={() => setDraggedPanel('orderEntry')}
                  onDragEnd={() => {
                    setDraggedPanel(null);
                    setDragOverPanel(null);
                  }}
                  className="flex items-center justify-between px-2.5 py-1 bg-[#101A15] border border-b-0 border-[#26372D] rounded-t-xl text-[10px] text-[#647168] cursor-grab active:cursor-grabbing select-none shrink-0"
                  title="Drag column header to reorder workspace"
                >
                  <span className="flex items-center gap-1 text-[#A1ADA5] font-medium">
                    <GripVertical className="w-3 h-3 text-[#647168]" />
                    Order Entry
                  </span>
                  <button
                    type="button"
                    onClick={() => togglePanelCollapse('orderEntry')}
                    className="p-0.5 rounded hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2]"
                    title={layout.collapsedPanels.orderEntry ? 'Expand Order Entry' : 'Collapse Order Entry'}
                    aria-label={layout.collapsedPanels.orderEntry ? 'Expand Order Entry' : 'Collapse Order Entry'}
                  >
                    {layout.collapsedPanels.orderEntry ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronUp className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                {!layout.collapsedPanels.orderEntry && (
                  <div className="flex-1 min-h-0 [&>div]:rounded-t-none">
                    <OrderForm selectedPrice={selectedPrice} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Horizontal Workspace Height Resize Handle */}
          {!layout.collapsedPanels.chart && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize main trading workspace height"
              onMouseDown={(e) => startHeightResize('workspaceHeightPx', e)}
              className="h-1.5 -my-1 cursor-row-resize flex items-center justify-center group"
              title="Drag vertically to resize main trading panels height"
            >
              <span className="w-16 h-0.5 rounded-full bg-[#26372D] group-hover:bg-[#10B981] transition-colors" />
            </div>
          )}

          {/* 6. Bottom Trading Panel */}
          {layout.panels.bottomPanel && (
            <div className="flex flex-col">
              <div className="flex items-center justify-between px-3 py-1 bg-[#101A15] border border-b-0 border-[#26372D] rounded-t-xl text-[10.5px] text-[#A1ADA5]">
                <span className="font-medium">
                  Execution Ledger & Open Orders ({openOrders.length} active)
                </span>
                <button
                  type="button"
                  onClick={() => togglePanelCollapse('bottomPanel')}
                  className="p-0.5 rounded hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] flex items-center gap-1"
                >
                  <span>{layout.collapsedPanels.bottomPanel ? 'Expand' : 'Collapse'}</span>
                  {layout.collapsedPanels.bottomPanel ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {!layout.collapsedPanels.bottomPanel && (
                <>
                  <div
                    className="min-h-[200px] [&>div]:rounded-t-none"
                    style={{ height: `${layout.bottomPanelHeightPx}px` }}
                  >
                    <OrdersPanel />
                  </div>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize bottom orders panel height"
                    onMouseDown={(e) => startHeightResize('bottomPanelHeightPx', e)}
                    className="h-1.5 mt-0.5 cursor-row-resize flex items-center justify-center group"
                    title="Drag vertically to resize bottom trading panel height"
                  >
                    <span className="w-16 h-0.5 rounded-full bg-[#26372D] group-hover:bg-[#10B981] transition-colors" />
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* =================================================================== */}
      {/* TABLET WORKSPACE (768px - 1023px): Clean 2-Row Adaptive Layout      */}
      {/* =================================================================== */}
      {viewportTier === 'tablet' && (
        <>
          <div className="h-[420px] min-h-[380px] w-full">
            <TradingChart onSelectPrice={(price) => setSelectedPrice(price)} />
          </div>

          <div className="grid grid-cols-12 gap-2.5">
            {layout.panels.orderBook && (
              <div
                className={`${
                  layout.panels.recentTrades ? 'col-span-4' : 'col-span-7'
                } h-[460px]`}
              >
                <OrderBook
                  onSelectPrice={(price) => setSelectedPrice(price)}
                  compact={isCompactPreset}
                />
              </div>
            )}

            {layout.panels.recentTrades && (
              <div
                className={`${
                  layout.panels.orderBook ? 'col-span-3' : 'col-span-7'
                } h-[460px]`}
              >
                <RecentTradesPanel
                  onSelectPrice={(price) => setSelectedPrice(price)}
                  compact={isCompactPreset}
                />
              </div>
            )}

            <div
              className={`${
                !layout.panels.orderBook && !layout.panels.recentTrades
                  ? 'col-span-12'
                  : 'col-span-5'
              } min-h-[420px]`}
            >
              <OrderForm selectedPrice={selectedPrice} />
            </div>
          </div>

          {layout.panels.bottomPanel && (
            <div className="h-[270px] min-h-[240px]">
              <OrdersPanel />
            </div>
          )}
        </>
      )}

      {/* =================================================================== */}
      {/* MOBILE WORKSPACE (< 768px): Deliberate Tabbed Exchange Navigation   */}
      {/* =================================================================== */}
      {viewportTier === 'mobile' && (
        <>
          <div
            className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-[#101A15] border border-[#26372D]"
            role="tablist"
            aria-label="Mobile trading views"
          >
            {(
              [
                { id: 'chart', label: 'Chart' },
                { id: 'book', label: 'Book' },
                { id: 'trades', label: 'Trades' },
                { id: 'trade', label: 'Trade' },
                { id: 'orders', label: `Orders${openOrders.length ? ` (${openOrders.length})` : ''}` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mobileTab === tab.id}
                onClick={() => setMobileTab(tab.id)}
                className={`py-2 px-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap truncate ${
                  mobileTab === tab.id
                    ? 'bg-[#192820] text-[#34D399] border border-[#10B981]/40'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mobileTab === 'chart' && (
            <div className="h-[400px] min-h-[360px]">
              <TradingChart onSelectPrice={(price) => setSelectedPrice(price)} />
            </div>
          )}

          {mobileTab === 'book' && (
            <div className="h-[480px] min-h-[420px]">
              <OrderBook
                onSelectPrice={(price) => {
                  setSelectedPrice(price);
                  setMobileTab('trade');
                }}
                compact
              />
            </div>
          )}

          {mobileTab === 'trades' && (
            <div className="h-[460px] min-h-[380px]">
              <RecentTradesPanel
                onSelectPrice={(price) => {
                  setSelectedPrice(price);
                  setMobileTab('trade');
                }}
                compact
              />
            </div>
          )}

          {mobileTab === 'trade' && (
            <div className="min-h-[420px]">
              <OrderForm selectedPrice={selectedPrice} />
            </div>
          )}

          {mobileTab === 'orders' && (
            <div className="h-[420px] min-h-[360px]">
              <OrdersPanel />
            </div>
          )}
        </>
      )}

      {/* 7. Market Ticker Footer */}
      {layout.panels.tickerFooter && <MarketTickerFooter />}

      {/* Layout Preferences Modal */}
      <LayoutPreferencesModal
        isOpen={prefsModalOpen}
        onClose={() => setPrefsModalOpen(false)}
        layout={layout}
        savedLayout={savedLayout}
        onChangeLayout={handleLayoutChange}
        onSavePreferences={handleSavePreferences}
        onRestoreSaved={handleRestoreSaved}
        onRestoreDefault={handleRestoreDefault}
      />
    </div>
  );
};
