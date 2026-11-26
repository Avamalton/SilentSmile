import {
  TradingLayoutPanelsVisibility,
  TradingLayoutPreferences,
  TradingLayoutPreset,
  TradingWorkspacePanelKey,
} from '../../simulation/types';

export interface LayoutPresetDefinition {
  id: TradingLayoutPreset;
  label: string;
  description: string;
  defaults: Omit<TradingLayoutPreferences, 'updatedAt'>;
}

export const PANEL_WIDTH_LIMITS = {
  orderBook: { min: 240, max: 420 },
  recentTrades: { min: 200, max: 360 },
  orderEntry: { min: 250, max: 400 },
  workspaceHeight: { min: 440, max: 760 },
  bottomPanelHeight: { min: 200, max: 440 },
  splitPct: { min: 35, max: 78 },
} as const;

export const DEFAULT_PANEL_ORDER: TradingWorkspacePanelKey[] = [
  'chart',
  'orderBook',
  'recentTrades',
  'orderEntry',
];

export const DEFAULT_TRADING_LAYOUT: TradingLayoutPreferences = {
  preset: 'classic_pro',
  panels: {
    marketHeader: true,
    chart: true,
    orderBook: true,
    recentTrades: true,
    orderEntry: true,
    bottomPanel: true,
    tickerFooter: true,
  },
  collapsedPanels: {},
  panelOrder: [...DEFAULT_PANEL_ORDER],
  orderBookWidthPx: 290,
  recentTradesWidthPx: 240,
  orderEntryWidthPx: 295,
  workspaceHeightPx: 580,
  bottomPanelHeightPx: 270,
  orderBookTradesSplitPct: 64,
};

export const TRADING_LAYOUT_PRESETS: Record<TradingLayoutPreset, LayoutPresetDefinition> = {
  classic_pro: {
    id: 'classic_pro',
    label: 'Classic Pro',
    description: 'Balanced Binance-style desk with chart, order book, recent trades, and order entry.',
    defaults: {
      preset: 'classic_pro',
      panels: {
        marketHeader: true,
        chart: true,
        orderBook: true,
        recentTrades: true,
        orderEntry: true,
        bottomPanel: true,
        tickerFooter: true,
      },
      collapsedPanels: {},
      panelOrder: ['chart', 'orderBook', 'recentTrades', 'orderEntry'],
      orderBookWidthPx: 290,
      recentTradesWidthPx: 240,
      orderEntryWidthPx: 295,
      workspaceHeightPx: 580,
      bottomPanelHeightPx: 270,
      orderBookTradesSplitPct: 64,
    },
  },
  chart_focus: {
    id: 'chart_focus',
    label: 'Chart Focus',
    description: 'Expanded candlestick workspace with compact market depth and order execution.',
    defaults: {
      preset: 'chart_focus',
      panels: {
        marketHeader: true,
        chart: true,
        orderBook: true,
        recentTrades: false,
        orderEntry: true,
        bottomPanel: true,
        tickerFooter: true,
      },
      collapsedPanels: {},
      panelOrder: ['chart', 'orderBook', 'recentTrades', 'orderEntry'],
      orderBookWidthPx: 265,
      recentTradesWidthPx: 220,
      orderEntryWidthPx: 275,
      workspaceHeightPx: 640,
      bottomPanelHeightPx: 220,
      orderBookTradesSplitPct: 68,
    },
  },
  compact_pro: {
    id: 'compact_pro',
    label: 'Compact Pro',
    description: 'High-density institutional terminal sized for maximum screen economy.',
    defaults: {
      preset: 'compact_pro',
      panels: {
        marketHeader: true,
        chart: true,
        orderBook: true,
        recentTrades: true,
        orderEntry: true,
        bottomPanel: true,
        tickerFooter: true,
      },
      collapsedPanels: {},
      panelOrder: ['chart', 'orderBook', 'recentTrades', 'orderEntry'],
      orderBookWidthPx: 268,
      recentTradesWidthPx: 215,
      orderEntryWidthPx: 270,
      workspaceHeightPx: 500,
      bottomPanelHeightPx: 220,
      orderBookTradesSplitPct: 62,
    },
  },
  multi_panel: {
    id: 'multi_panel',
    label: 'Multi Panel',
    description: 'Four-column pro layout placing Chart, Order Book, Recent Trades, and Order Entry side by side.',
    defaults: {
      preset: 'multi_panel',
      panels: {
        marketHeader: true,
        chart: true,
        orderBook: true,
        recentTrades: true,
        orderEntry: true,
        bottomPanel: true,
        tickerFooter: true,
      },
      collapsedPanels: {},
      panelOrder: ['chart', 'orderBook', 'recentTrades', 'orderEntry'],
      orderBookWidthPx: 275,
      recentTradesWidthPx: 230,
      orderEntryWidthPx: 280,
      workspaceHeightPx: 610,
      bottomPanelHeightPx: 280,
      orderBookTradesSplitPct: 64,
    },
  },
};

export function clampNumericRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Normalizes and validates persisted or partial layout preferences.
 * Guarantees essential trading panels (chart, orderEntry) cannot be accidentally disabled.
 */
export function normalizeTradingLayout(
  raw?: Partial<TradingLayoutPreferences> | null
): TradingLayoutPreferences {
  const presetId: TradingLayoutPreset =
    raw?.preset && raw.preset in TRADING_LAYOUT_PRESETS ? raw.preset : 'classic_pro';
  const base = TRADING_LAYOUT_PRESETS[presetId].defaults;

  const validKeys: TradingWorkspacePanelKey[] = ['chart', 'orderBook', 'recentTrades', 'orderEntry'];
  const incomingOrder = Array.isArray(raw?.panelOrder)
    ? raw.panelOrder.filter((k): k is TradingWorkspacePanelKey => validKeys.includes(k))
    : [];
  const mergedOrder = Array.from(new Set([...incomingOrder, ...base.panelOrder]));

  const panels: TradingLayoutPanelsVisibility = {
    marketHeader: raw?.panels?.marketHeader ?? base.panels.marketHeader,
    chart: true, // Core panel protected from accidental removal
    orderBook: raw?.panels?.orderBook ?? base.panels.orderBook,
    recentTrades: raw?.panels?.recentTrades ?? base.panels.recentTrades,
    orderEntry: true, // Core panel protected from accidental removal
    bottomPanel: raw?.panels?.bottomPanel ?? base.panels.bottomPanel,
    tickerFooter: raw?.panels?.tickerFooter ?? base.panels.tickerFooter,
  };

  return {
    preset: presetId,
    panels,
    collapsedPanels: raw?.collapsedPanels && typeof raw.collapsedPanels === 'object' ? { ...raw.collapsedPanels } : {},
    panelOrder: mergedOrder,
    orderBookWidthPx: clampNumericRange(
      raw?.orderBookWidthPx ?? base.orderBookWidthPx,
      PANEL_WIDTH_LIMITS.orderBook.min,
      PANEL_WIDTH_LIMITS.orderBook.max,
      base.orderBookWidthPx
    ),
    recentTradesWidthPx: clampNumericRange(
      raw?.recentTradesWidthPx ?? base.recentTradesWidthPx,
      PANEL_WIDTH_LIMITS.recentTrades.min,
      PANEL_WIDTH_LIMITS.recentTrades.max,
      base.recentTradesWidthPx
    ),
    orderEntryWidthPx: clampNumericRange(
      raw?.orderEntryWidthPx ?? base.orderEntryWidthPx,
      PANEL_WIDTH_LIMITS.orderEntry.min,
      PANEL_WIDTH_LIMITS.orderEntry.max,
      base.orderEntryWidthPx
    ),
    workspaceHeightPx: clampNumericRange(
      raw?.workspaceHeightPx ?? base.workspaceHeightPx,
      PANEL_WIDTH_LIMITS.workspaceHeight.min,
      PANEL_WIDTH_LIMITS.workspaceHeight.max,
      base.workspaceHeightPx
    ),
    bottomPanelHeightPx: clampNumericRange(
      raw?.bottomPanelHeightPx ?? base.bottomPanelHeightPx,
      PANEL_WIDTH_LIMITS.bottomPanelHeight.min,
      PANEL_WIDTH_LIMITS.bottomPanelHeight.max,
      base.bottomPanelHeightPx
    ),
    orderBookTradesSplitPct: clampNumericRange(
      raw?.orderBookTradesSplitPct ?? base.orderBookTradesSplitPct,
      PANEL_WIDTH_LIMITS.splitPct.min,
      PANEL_WIDTH_LIMITS.splitPct.max,
      base.orderBookTradesSplitPct
    ),
    updatedAt: raw?.updatedAt,
  };
}

export function applyLayoutPreset(preset: TradingLayoutPreset): TradingLayoutPreferences {
  const def = TRADING_LAYOUT_PRESETS[preset] || TRADING_LAYOUT_PRESETS.classic_pro;
  return normalizeTradingLayout({
    ...def.defaults,
    panels: { ...def.defaults.panels },
    collapsedPanels: {},
    panelOrder: [...def.defaults.panelOrder],
    updatedAt: Date.now(),
  });
}

export function reorderWorkspacePanels(
  currentOrder: TradingWorkspacePanelKey[],
  sourceKey: TradingWorkspacePanelKey,
  targetKey: TradingWorkspacePanelKey
): TradingWorkspacePanelKey[] {
  if (sourceKey === targetKey) return currentOrder;
  const next = [...currentOrder];
  const fromIdx = next.indexOf(sourceKey);
  const toIdx = next.indexOf(targetKey);
  if (fromIdx === -1 || toIdx === -1) return currentOrder;
  next[fromIdx] = targetKey;
  next[toIdx] = sourceKey;
  return next;
}
