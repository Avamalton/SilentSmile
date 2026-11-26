import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRADING_LAYOUT,
  PANEL_WIDTH_LIMITS,
  TRADING_LAYOUT_PRESETS,
  applyLayoutPreset,
  normalizeTradingLayout,
  reorderWorkspacePanels,
} from '../src/components/trading/tradingLayoutTypes';

describe('Trading Terminal Layout Preferences', () => {
  it('defines all four required layout presets cleanly', () => {
    expect(Object.keys(TRADING_LAYOUT_PRESETS)).toEqual([
      'classic_pro',
      'chart_focus',
      'compact_pro',
      'multi_panel',
    ]);

    const classic = applyLayoutPreset('classic_pro');
    expect(classic.preset).toBe('classic_pro');
    expect(classic.panels.orderBook).toBe(true);
    expect(classic.panels.recentTrades).toBe(true);

    const chartFocus = applyLayoutPreset('chart_focus');
    expect(chartFocus.preset).toBe('chart_focus');
    expect(chartFocus.panels.recentTrades).toBe(false);
    expect(chartFocus.workspaceHeightPx).toBeGreaterThan(classic.workspaceHeightPx);

    const compactPro = applyLayoutPreset('compact_pro');
    expect(compactPro.preset).toBe('compact_pro');
    expect(compactPro.workspaceHeightPx).toBeLessThan(classic.workspaceHeightPx);

    const multiPanel = applyLayoutPreset('multi_panel');
    expect(multiPanel.preset).toBe('multi_panel');
    expect(multiPanel.panels.chart).toBe(true);
    expect(multiPanel.panels.orderBook).toBe(true);
    expect(multiPanel.panels.recentTrades).toBe(true);
    expect(multiPanel.panels.orderEntry).toBe(true);
  });

  it('protects core trading panels (chart & orderEntry) from being hidden while allowing toggleable panels', () => {
    const normalized = normalizeTradingLayout({
      preset: 'classic_pro',
      panels: {
        marketHeader: false,
        chart: false,
        orderBook: false,
        recentTrades: false,
        orderEntry: false,
        bottomPanel: false,
        tickerFooter: false,
      },
    });

    expect(normalized.panels.chart).toBe(true);
    expect(normalized.panels.orderEntry).toBe(true);
    expect(normalized.panels.marketHeader).toBe(false);
    expect(normalized.panels.orderBook).toBe(false);
    expect(normalized.panels.recentTrades).toBe(false);
    expect(normalized.panels.bottomPanel).toBe(false);
    expect(normalized.panels.tickerFooter).toBe(false);
  });

  it('clamps invalid or extreme panel dimensions to safe layout limits', () => {
    const clamped = normalizeTradingLayout({
      orderBookWidthPx: 40,
      recentTradesWidthPx: 999,
      orderEntryWidthPx: -20,
      workspaceHeightPx: 9999,
      bottomPanelHeightPx: 12,
      orderBookTradesSplitPct: 120,
    });

    expect(clamped.orderBookWidthPx).toBe(PANEL_WIDTH_LIMITS.orderBook.min);
    expect(clamped.recentTradesWidthPx).toBe(PANEL_WIDTH_LIMITS.recentTrades.max);
    expect(clamped.orderEntryWidthPx).toBe(PANEL_WIDTH_LIMITS.orderEntry.min);
    expect(clamped.workspaceHeightPx).toBe(PANEL_WIDTH_LIMITS.workspaceHeight.max);
    expect(clamped.bottomPanelHeightPx).toBe(PANEL_WIDTH_LIMITS.bottomPanelHeight.min);
    expect(clamped.orderBookTradesSplitPct).toBe(PANEL_WIDTH_LIMITS.splitPct.max);
  });

  it('reorders workspace columns safely and sanitizes corrupted persisted panel orders', () => {
    const swapped = reorderWorkspacePanels(
      ['chart', 'orderBook', 'recentTrades', 'orderEntry'],
      'orderBook',
      'chart'
    );
    expect(swapped).toEqual(['orderBook', 'chart', 'recentTrades', 'orderEntry']);

    const sanitized = normalizeTradingLayout({
      panelOrder: ['orderEntry', 'chart', 'orderEntry'] as any,
    });
    expect(sanitized.panelOrder).toEqual(['orderEntry', 'chart', 'orderBook', 'recentTrades']);
  });

  it('round-trips JSON persistence cleanly matching DEFAULT_TRADING_LAYOUT defaults', () => {
    const serialized = JSON.stringify(DEFAULT_TRADING_LAYOUT);
    const restored = normalizeTradingLayout(JSON.parse(serialized));
    expect(restored.preset).toBe(DEFAULT_TRADING_LAYOUT.preset);
    expect(restored.panels).toEqual(DEFAULT_TRADING_LAYOUT.panels);
    expect(restored.panelOrder).toEqual(DEFAULT_TRADING_LAYOUT.panelOrder);
    expect(restored.orderBookWidthPx).toBe(DEFAULT_TRADING_LAYOUT.orderBookWidthPx);
  });
});
