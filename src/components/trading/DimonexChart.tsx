import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineSeries,
  LogicalRange,
  createChart,
} from 'lightweight-charts';
import {
  Activity,
  Bookmark,
  BookmarkPlus,
  CandlestickChart,
  Expand,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Wifi,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { TimeFrame } from '../../simulation/types';
import { formatCrypto, formatIDR } from '../../utils/formatters';
import {
  CandleSecondsBar,
  ChartDrawing,
  ChartPreferences,
  ChartSeriesStyle,
  DatafeedConnectionStatus,
  DrawingPoint,
  DrawingToolType,
  IndicatorKey,
  RESOLUTION_TO_TIMEFRAME,
  ResolutionString,
  SavedChartLayout,
  TIMEFRAME_TO_RESOLUTION,
} from './chartTypes';
import {
  DimonexDatafeed,
  computeBollingerBands,
  computeEMA,
  computeMACD,
  computeRSI,
  computeSMA,
  toHeikinAshi,
} from './dimonexDatafeed';

export interface DimonexChartProps {
  pairId: string;
  timeframe: TimeFrame;
  onTimeframeChange: (tf: TimeFrame) => void;
  datafeed: DimonexDatafeed;
  preferences: ChartPreferences;
  onUpdatePreferences: (updater: (prev: ChartPreferences) => ChartPreferences) => void;
  modeSwitcherSlot?: React.ReactNode;
}

const TIMEFRAMES: { label: string; value: TimeFrame }[] = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1D', value: '1D' },
];

const SERIES_STYLES: { id: ChartSeriesStyle; label: string }[] = [
  { id: 'candlestick', label: 'Candles' },
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'heikin_ashi', label: 'Heikin Ashi' },
];

const INDICATOR_CATALOG: { key: IndicatorKey; name: string; category: string; desc: string }[] = [
  { key: 'VOLUME', name: 'Volume', category: 'Volume', desc: 'Executed trade quantity histogram' },
  { key: 'EMA9', name: 'EMA (9)', category: 'Trend', desc: '9-period Exponential Moving Average' },
  { key: 'EMA21', name: 'EMA (21)', category: 'Trend', desc: '21-period Exponential Moving Average' },
  { key: 'SMA7', name: 'SMA (7)', category: 'Trend', desc: '7-period Simple Moving Average' },
  { key: 'SMA25', name: 'SMA (25)', category: 'Trend', desc: '25-period Simple Moving Average' },
  { key: 'BB', name: 'Bollinger Bands (20, 2)', category: 'Volatility', desc: '20-period SMA ± 2σ envelope' },
  { key: 'RSI', name: 'RSI (14)', category: 'Momentum', desc: '14-period Relative Strength Index sub-pane' },
  { key: 'MACD', name: 'MACD (12, 26, 9)', category: 'Momentum', desc: 'Moving Average Convergence Divergence sub-pane' },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const DRAWINGS_STORAGE_KEY = 'silentsmile_chart_drawings_v1';

function formatJakartaTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function loadSavedDrawings(): ChartDrawing[] {
  try {
    const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const DimonexChart: React.FC<DimonexChartProps> = ({
  pairId,
  timeframe,
  onTimeframeChange,
  datafeed,
  preferences,
  onUpdatePreferences,
  modeSwitcherSlot,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const overlaySeriesRefs = useRef<Record<string, ISeriesApi<any>>>({});
  const rsiSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const macdRefs = useRef<{
    macd?: ISeriesApi<any>;
    signal?: ISeriesApi<any>;
    hist?: ISeriesApi<any>;
  }>({});

  const barsRef = useRef<CandleSecondsBar[]>([]);
  const paginationLockRef = useRef(false);
  const noMoreHistoryRef = useRef(false);
  const precisionsRef = useRef({ basePrecision: 8, quotePrecision: 0 });

  const [bars, setBars] = useState<CandleSecondsBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<DatafeedConnectionStatus>(datafeed.getConnectionStatus());
  const [reloadNonce, setReloadNonce] = useState(0);

  const [activeTool, setActiveTool] = useState<DrawingToolType>('cursor');
  const [pendingPoint, setPendingPoint] = useState<DrawingPoint | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>(() => loadSavedDrawings());
  const [drawingRenderTick, setDrawingRenderTick] = useState(0);

  const [showIndicatorModal, setShowIndicatorModal] = useState(false);
  const [indicatorQuery, setIndicatorQuery] = useState('');
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const [showLayoutsPopover, setShowLayoutsPopover] = useState(false);
  const [layoutNameInput, setLayoutNameInput] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [hoveredOhlcv, setHoveredOhlcv] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timeLabel: string;
  } | null>(null);

  const resolution: ResolutionString = TIMEFRAME_TO_RESOLUTION[timeframe] || '15';
  const pairDrawings = useMemo(
    () => drawings.filter((d) => d.pairId === pairId),
    [drawings, pairId]
  );

  // Persist drawings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify(drawings));
    } catch {}
  }, [drawings]);

  // Monitor genuine WebSocket connection status
  useEffect(() => {
    return datafeed.onConnectionStatusChange(setWsStatus);
  }, [datafeed]);

  // Listen to native fullscreen exit
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Push all indicator & price data cleanly into Lightweight Charts series
  const syncSeriesData = useCallback(
    (sourceBars: CandleSecondsBar[]) => {
      const main = mainSeriesRef.current;
      if (!main) return;

      if (sourceBars.length === 0) {
        main.setData([]);
        volumeSeriesRef.current?.setData([]);
        Object.values(overlaySeriesRefs.current).forEach((s) => s.setData([]));
        rsiSeriesRef.current?.setData([]);
        macdRefs.current.macd?.setData([]);
        macdRefs.current.signal?.setData([]);
        macdRefs.current.hist?.setData([]);
        return;
      }

      const displayBars =
        preferences.seriesStyle === 'heikin_ashi' ? toHeikinAshi(sourceBars) : sourceBars;

      if (preferences.seriesStyle === 'line' || preferences.seriesStyle === 'area') {
        main.setData(displayBars.map((b) => ({ time: b.time as any, value: b.close })));
      } else {
        main.setData(
          displayBars.map((b) => ({
            time: b.time as any,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          }))
        );
      }

      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(
          sourceBars.map((b) => ({
            time: b.time as any,
            value: b.volume,
            color: b.close >= b.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 100, 100, 0.35)',
          }))
        );
      }

      if (overlaySeriesRefs.current.EMA9) {
        overlaySeriesRefs.current.EMA9.setData(
          computeEMA(sourceBars, 9).map((p) => ({ time: p.time as any, value: p.value }))
        );
      }
      if (overlaySeriesRefs.current.EMA21) {
        overlaySeriesRefs.current.EMA21.setData(
          computeEMA(sourceBars, 21).map((p) => ({ time: p.time as any, value: p.value }))
        );
      }
      if (overlaySeriesRefs.current.SMA7) {
        overlaySeriesRefs.current.SMA7.setData(
          computeSMA(sourceBars, 7).map((p) => ({ time: p.time as any, value: p.value }))
        );
      }
      if (overlaySeriesRefs.current.SMA25) {
        overlaySeriesRefs.current.SMA25.setData(
          computeSMA(sourceBars, 25).map((p) => ({ time: p.time as any, value: p.value }))
        );
      }
      if (
        overlaySeriesRefs.current.BB_UPPER &&
        overlaySeriesRefs.current.BB_MID &&
        overlaySeriesRefs.current.BB_LOWER
      ) {
        const bb = computeBollingerBands(sourceBars, 20, 2);
        overlaySeriesRefs.current.BB_UPPER.setData(bb.upper.map((p) => ({ time: p.time as any, value: p.value })));
        overlaySeriesRefs.current.BB_MID.setData(bb.middle.map((p) => ({ time: p.time as any, value: p.value })));
        overlaySeriesRefs.current.BB_LOWER.setData(bb.lower.map((p) => ({ time: p.time as any, value: p.value })));
      }

      if (rsiSeriesRef.current) {
        rsiSeriesRef.current.setData(
          computeRSI(sourceBars, 14).map((p) => ({ time: p.time as any, value: p.value }))
        );
      }

      if (macdRefs.current.macd && macdRefs.current.signal && macdRefs.current.hist) {
        const macdData = computeMACD(sourceBars, 12, 26, 9);
        macdRefs.current.macd.setData(macdData.macd.map((p) => ({ time: p.time as any, value: p.value })));
        macdRefs.current.signal.setData(macdData.signal.map((p) => ({ time: p.time as any, value: p.value })));
        macdRefs.current.hist.setData(macdData.histogram.map((p) => ({ time: p.time as any, value: p.value, color: p.color })));
      }
    },
    [preferences.seriesStyle]
  );

  // Build / rebuild Lightweight Chart instance when visual structure changes
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    overlaySeriesRefs.current = {};
    rsiSeriesRef.current = null;
    macdRefs.current = {};
    volumeSeriesRef.current = null;
    mainSeriesRef.current = null;

    const chart = createChart(container, {
      width: container.clientWidth || 640,
      height: container.clientHeight || 420,
      layout: {
        background: { type: ColorType.Solid, color: '#0B100E' },
        textColor: '#A1ADA5',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: {
          color: preferences.showGrid ? 'rgba(38, 55, 45, 0.55)' : 'transparent',
        },
        horzLines: {
          color: preferences.showGrid ? 'rgba(38, 55, 45, 0.55)' : 'transparent',
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(16, 185, 129, 0.45)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#192820',
        },
        horzLine: {
          color: 'rgba(16, 185, 129, 0.45)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#192820',
        },
      },
      localization: {
        timeFormatter: (time: any) => formatJakartaTime(Number(time)),
      },
      rightPriceScale: {
        borderColor: '#26372D',
        autoScale: preferences.autoScale,
        scaleMargins: {
          top: 0.08,
          bottom: preferences.indicators.includes('VOLUME') ? 0.22 : 0.08,
        },
      },
      timeScale: {
        borderColor: '#26372D',
        timeVisible: true,
        secondsVisible: resolution === '1',
      },
    });

    chartRef.current = chart;

    // Main Price Series
    let mainSeries: ISeriesApi<any>;
    if (preferences.seriesStyle === 'bars') {
      mainSeries = chart.addSeries(BarSeries, {
        upColor: '#10B981',
        downColor: '#EF6464',
      });
    } else if (preferences.seriesStyle === 'line') {
      mainSeries = chart.addSeries(LineSeries, {
        color: '#10B981',
        lineWidth: 2,
      });
    } else if (preferences.seriesStyle === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: '#10B981',
        topColor: 'rgba(16, 185, 129, 0.28)',
        bottomColor: 'rgba(16, 185, 129, 0.02)',
        lineWidth: 2,
      });
    } else {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10B981',
        downColor: '#EF6464',
        borderVisible: false,
        wickUpColor: '#10B981',
        wickDownColor: '#EF6464',
      });
    }
    mainSeriesRef.current = mainSeries;

    // Volume Overlay
    if (preferences.indicators.includes('VOLUME')) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volumeSeriesRef.current = volSeries;
    }

    // Price Overlay Indicators
    if (preferences.indicators.includes('EMA9')) {
      overlaySeriesRefs.current.EMA9 = chart.addSeries(LineSeries, {
        color: '#38BDF8',
        lineWidth: 1,
        title: 'EMA 9',
      });
    }
    if (preferences.indicators.includes('EMA21')) {
      overlaySeriesRefs.current.EMA21 = chart.addSeries(LineSeries, {
        color: '#FB923C',
        lineWidth: 1,
        title: 'EMA 21',
      });
    }
    if (preferences.indicators.includes('SMA7')) {
      overlaySeriesRefs.current.SMA7 = chart.addSeries(LineSeries, {
        color: '#FBBF24',
        lineWidth: 1,
        title: 'SMA 7',
      });
    }
    if (preferences.indicators.includes('SMA25')) {
      overlaySeriesRefs.current.SMA25 = chart.addSeries(LineSeries, {
        color: '#A78BFA',
        lineWidth: 1,
        title: 'SMA 25',
      });
    }
    if (preferences.indicators.includes('BB')) {
      overlaySeriesRefs.current.BB_UPPER = chart.addSeries(LineSeries, {
        color: 'rgba(56, 189, 248, 0.65)',
        lineWidth: 1,
        title: 'BB Upper',
      });
      overlaySeriesRefs.current.BB_MID = chart.addSeries(LineSeries, {
        color: 'rgba(148, 163, 184, 0.55)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Basis',
      });
      overlaySeriesRefs.current.BB_LOWER = chart.addSeries(LineSeries, {
        color: 'rgba(56, 189, 248, 0.65)',
        lineWidth: 1,
        title: 'BB Lower',
      });
    }

    // Dedicated Sub-Panes for RSI & MACD (Lightweight Charts v5 native panes)
    if (preferences.indicators.includes('RSI')) {
      const rsiPane = chart.addPane();
      rsiPane.setHeight(92);
      const rsiSeries = rsiPane.addSeries(LineSeries, {
        color: '#C084FC',
        lineWidth: 2,
        title: 'RSI(14)',
      });
      rsiSeries.createPriceLine({
        price: 70,
        color: 'rgba(244, 63, 94, 0.4)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'OB 70',
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: 'rgba(34, 197, 94, 0.4)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'OS 30',
      });
      rsiSeriesRef.current = rsiSeries;
    }

    if (preferences.indicators.includes('MACD')) {
      const macdPane = chart.addPane();
      macdPane.setHeight(96);
      macdRefs.current.hist = macdPane.addSeries(HistogramSeries, {
        title: 'Hist',
      });
      macdRefs.current.macd = macdPane.addSeries(LineSeries, {
        color: '#22D3EE',
        lineWidth: 1,
        title: 'MACD',
      });
      macdRefs.current.signal = macdPane.addSeries(LineSeries, {
        color: '#F59E0B',
        lineWidth: 1,
        title: 'Signal',
      });
    }

    // Crosshair move -> OHLCV bar update
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !mainSeriesRef.current) {
        setHoveredOhlcv(null);
        return;
      }
      const timeSec = Number(param.time);
      const matched = barsRef.current.find((b) => b.time === timeSec);
      const pData = param.seriesData.get(mainSeriesRef.current) as any;
      if (matched) {
        setHoveredOhlcv({
          open: matched.open,
          high: matched.high,
          low: matched.low,
          close: matched.close,
          volume: matched.volume,
          timeLabel: `${formatJakartaTime(timeSec)} WIB`,
        });
      } else if (pData) {
        const val = pData.close ?? pData.value ?? 0;
        setHoveredOhlcv({
          open: pData.open ?? val,
          high: pData.high ?? val,
          low: pData.low ?? val,
          close: val,
          volume: 0,
          timeLabel: `${formatJakartaTime(timeSec)} WIB`,
        });
      }
    });

    // Historical Pagination + SVG Drawing Reposition on pan/zoom
    const onRangeChange = (range: LogicalRange | null) => {
      setDrawingRenderTick((t) => t + 1);
      if (!range || paginationLockRef.current || noMoreHistoryRef.current) return;
      if (range.from < 5 && barsRef.current.length > 0) {
        paginationLockRef.current = true;
        const earliest = barsRef.current[0].time;
        datafeed
          .fetchHistoricalCandlesSeconds(pairId, resolution, {
            to: earliest - 1,
            countBack: 200,
          })
          .then((res) => {
            if (res.bars.length === 0) {
              noMoreHistoryRef.current = true;
              return;
            }
            const mergedMap = new Map<number, CandleSecondsBar>();
            for (const b of res.bars) mergedMap.set(b.time, b);
            for (const b of barsRef.current) mergedMap.set(b.time, b);
            const merged = Array.from(mergedMap.values()).sort((a, b) => a.time - b.time);
            barsRef.current = merged;
            setBars(merged);
            syncSeriesData(merged);
          })
          .catch(() => {})
          .finally(() => {
            paginationLockRef.current = false;
          });
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);

    // ResizeObserver for responsive container fit
    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current && container) {
        chartRef.current.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
        setDrawingRenderTick((t) => t + 1);
      }
    });
    resizeObserver.observe(container);

    // Populate immediately if bars already loaded
    if (barsRef.current.length > 0) {
      syncSeriesData(barsRef.current);
      chart.timeScale().fitContent();
    }

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [
    preferences.seriesStyle,
    preferences.indicators,
    preferences.showGrid,
    preferences.autoScale,
    resolution,
    pairId,
    datafeed,
    syncSeriesData,
  ]);

  // Load real historical candles & subscribe to live WebSocket updates whenever pairId / timeframe changes
  useEffect(() => {
    let cancelled = false;
    noMoreHistoryRef.current = false;
    paginationLockRef.current = false;
    setLoading(true);
    setErrorMsg(null);
    setPendingPoint(null);

    const subscriberUID = `dimonex_pro_${pairId}_${resolution}`;

    const run = async () => {
      try {
        const res = await datafeed.fetchHistoricalCandlesSeconds(pairId, resolution, {
          countBack: 300,
        });
        if (cancelled) return;

        precisionsRef.current = {
          basePrecision: res.basePrecision,
          quotePrecision: res.quotePrecision,
        };
        barsRef.current = res.bars;
        setBars(res.bars);
        syncSeriesData(res.bars);
        if (res.bars.length > 0 && chartRef.current) {
          chartRef.current.timeScale().fitContent();
        }
        setLoading(false);
        setDrawingRenderTick((t) => t + 1);
      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err?.message || 'Failed to load market candles');
        setLoading(false);
      }
    };

    run();

    const unsubscribe = datafeed.subscribeCandlesSeconds(
      pairId,
      resolution,
      (liveBar) => {
        if (cancelled) return;
        const current = barsRef.current;
        const last = current[current.length - 1];

        let updatedList: CandleSecondsBar[];
        if (!last || liveBar.time > last.time) {
          updatedList = [...current, liveBar];
        } else if (liveBar.time === last.time) {
          updatedList = [...current.slice(0, -1), liveBar];
        } else {
          return; // Out-of-order stale bar ignored
        }

        const hadZeroBars = current.length === 0;
        barsRef.current = updatedList;
        setBars(updatedList);
        syncSeriesData(updatedList);
        if (hadZeroBars && updatedList.length > 0 && chartRef.current) {
          chartRef.current.timeScale().fitContent();
        }
        setDrawingRenderTick((t) => t + 1);
      },
      subscriberUID,
      precisionsRef.current
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [pairId, resolution, datafeed, reloadNonce, syncSeriesData]);

  // Interactive Drawing Click Handler on Canvas Overlay
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'cursor' || !chartRef.current || !mainSeriesRef.current || !chartContainerRef.current) {
      return;
    }

    const rect = chartContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const price = mainSeriesRef.current.coordinateToPrice(y);
    const timeRaw = chartRef.current.timeScale().coordinateToTime(x);
    if (price === null || timeRaw === null) return;

    const point: DrawingPoint = {
      time: Number(timeRaw),
      price: Number(price),
    };

    if (activeTool === 'hline') {
      const next: ChartDrawing = {
        id: `drw_${Date.now()}`,
        pairId,
        type: 'hline',
        points: [point],
        color: '#10B981',
        createdAt: Date.now(),
      };
      setDrawings((prev) => [...prev, next]);
      setActiveTool('cursor');
      return;
    }

    if (!pendingPoint) {
      setPendingPoint(point);
      return;
    }

    const next: ChartDrawing = {
      id: `drw_${Date.now()}`,
      pairId,
      type: activeTool,
      points: [pendingPoint, point],
      color: activeTool === 'fib_retracement' ? '#EAB866' : '#34D399',
      createdAt: Date.now(),
    };
    setDrawings((prev) => [...prev, next]);
    setPendingPoint(null);
    setActiveTool('cursor');
  };

  const handleZoomIn = () => {
    const ts = chartRef.current?.timeScale();
    const vr = ts?.getVisibleLogicalRange();
    if (ts && vr) {
      const span = vr.to - vr.from;
      ts.setVisibleLogicalRange({ from: vr.from + span * 0.15, to: vr.to - span * 0.15 });
    }
  };

  const handleZoomOut = () => {
    const ts = chartRef.current?.timeScale();
    const vr = ts?.getVisibleLogicalRange();
    if (ts && vr) {
      const span = vr.to - vr.from;
      ts.setVisibleLogicalRange({ from: vr.from - span * 0.15, to: vr.to + span * 0.15 });
    }
  };

  const handleFitContent = () => {
    chartRef.current?.timeScale().fitContent();
  };

  const toggleAutoscale = () => {
    const nextVal = !preferences.autoScale;
    onUpdatePreferences((prev) => ({ ...prev, autoScale: nextVal }));
    chartRef.current?.priceScale('right').applyOptions({ autoScale: nextVal });
  };

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      try {
        if (rootRef.current?.requestFullscreen) {
          await rootRef.current.requestFullscreen();
        }
      } catch {}
      setIsFullscreen(true);
    } else {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {}
      setIsFullscreen(false);
    }
  };

  const toggleIndicator = (key: IndicatorKey) => {
    onUpdatePreferences((prev) => {
      const exists = prev.indicators.includes(key);
      return {
        ...prev,
        indicators: exists ? prev.indicators.filter((k) => k !== key) : [...prev.indicators, key],
      };
    });
  };

  const handleSaveLayout = () => {
    const name = layoutNameInput.trim() || `Layout ${preferences.layouts.length + 1}`;
    const newLayout: SavedChartLayout = {
      id: `lay_${Date.now()}`,
      name,
      savedAt: Date.now(),
      resolution,
      seriesStyle: preferences.seriesStyle,
      indicators: [...preferences.indicators],
      autoScale: preferences.autoScale,
      showGrid: preferences.showGrid,
    };
    onUpdatePreferences((prev) => ({
      ...prev,
      activeLayoutName: name,
      layouts: [newLayout, ...prev.layouts.slice(0, 9)],
    }));
    setLayoutNameInput('');
    setShowLayoutsPopover(false);
  };

  const handleApplyLayout = (layout: SavedChartLayout) => {
    onUpdatePreferences((prev) => ({
      ...prev,
      seriesStyle: layout.seriesStyle,
      indicators: [...layout.indicators],
      autoScale: layout.autoScale,
      showGrid: layout.showGrid,
      activeLayoutName: layout.name,
    }));
    const tf = RESOLUTION_TO_TIMEFRAME[layout.resolution];
    if (tf && tf !== timeframe) {
      onTimeframeChange(tf);
    }
    setShowLayoutsPopover(false);
  };

  const latestBar = bars[bars.length - 1];
  const displayOhlcv =
    hoveredOhlcv ||
    (latestBar
      ? {
          open: latestBar.open,
          high: latestBar.high,
          low: latestBar.low,
          close: latestBar.close,
          volume: latestBar.volume,
          timeLabel: `${formatJakartaTime(latestBar.time)} WIB`,
        }
      : null);
  const isUp = displayOhlcv ? displayOhlcv.close >= displayOhlcv.open : true;

  // Compute pixel coordinates for SVG drawing overlay on pan/zoom/resize
  const renderedDrawings = useMemo(() => {
    void drawingRenderTick;
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const width = chartContainerRef.current?.clientWidth || 0;
    if (!chart || !series || width === 0) return [];

    const ts = chart.timeScale();
    return pairDrawings.map((d) => {
      if (d.type === 'hline') {
        const y = series.priceToCoordinate(d.points[0].price);
        return { drawing: d, coords: y !== null ? [{ x: 0, y }, { x: width, y }] : [] };
      }
      if (d.points.length < 2) return { drawing: d, coords: [] };
      const x1 = ts.timeToCoordinate(d.points[0].time as any);
      const y1 = series.priceToCoordinate(d.points[0].price);
      const x2 = ts.timeToCoordinate(d.points[1].time as any);
      const y2 = series.priceToCoordinate(d.points[1].price);
      if (x1 === null || y1 === null || x2 === null || y2 === null) {
        return { drawing: d, coords: [] };
      }
      return { drawing: d, coords: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
    });
  }, [pairDrawings, drawingRenderTick]);

  const filteredIndicators = useMemo(() => {
    const q = indicatorQuery.trim().toLowerCase();
    if (!q) return INDICATOR_CATALOG;
    return INDICATOR_CATALOG.filter(
      (i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)
    );
  }, [indicatorQuery]);

  return (
    <div
      ref={rootRef}
      className={`flex flex-col w-full glass-panel rounded-xl overflow-hidden relative ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none bg-[#0B100E] h-screen' : 'h-full'
      }`}
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 border-b border-[#26372D] bg-[#101A15] gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {modeSwitcherSlot}

          {/* Timeframe Selector */}
          <div className="flex items-center bg-[#0B100E] rounded-lg p-0.5 border border-[#26372D]">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                type="button"
                onClick={() => onTimeframeChange(tf.value)}
                className={`px-2 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  timeframe === tf.value
                    ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40 font-semibold'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Series Style Selector */}
          <div className="hidden md:flex items-center bg-[#0B100E] rounded-lg p-0.5 border border-[#26372D]">
            {SERIES_STYLES.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => onUpdatePreferences((prev) => ({ ...prev, seriesStyle: st.id }))}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  preferences.seriesStyle === st.id
                    ? 'bg-[#192820] text-[#F1F5F2] border border-[#26372D]'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Controls: Indicators, Layouts, Settings, WS Status, Zoom/Fullscreen */}
        <div className="flex items-center gap-1.5 relative">
          <button
            type="button"
            onClick={() => {
              setShowIndicatorModal((v) => !v);
              setShowSettingsPopover(false);
              setShowLayoutsPopover(false);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-[#0B100E] hover:bg-[#192820] text-[#F1F5F2] border border-[#26372D] whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Indicators ({preferences.indicators.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowLayoutsPopover((v) => !v);
              setShowIndicatorModal(false);
              setShowSettingsPopover(false);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-[#0B100E] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D] whitespace-nowrap shrink-0"
            title="Save or Restore Chart Layout"
          >
            <Bookmark className="w-3.5 h-3.5 text-[#EAB866]" />
            <span className="hidden sm:inline">Layouts</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowSettingsPopover((v) => !v);
              setShowIndicatorModal(false);
              setShowLayoutsPopover(false);
            }}
            className="p-1.5 rounded-lg bg-[#0B100E] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D]"
            title="Chart Settings"
            aria-label="Chart Settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>

          {/* Genuine Datafeed WS Status (never fake) */}
          <div
            className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded-lg border whitespace-nowrap shrink-0 ${
              wsStatus === 'CONNECTED'
                ? 'border-[#10B981]/35 bg-[#064E3B]/40 text-[#34D399]'
                : wsStatus === 'CONNECTING' || wsStatus === 'RECONNECTING'
                ? 'border-[#EAB866]/35 bg-[#EAB866]/10 text-[#EAB866]'
                : 'border-[#26372D] bg-[#0B100E] text-[#647168]'
            }`}
            title={`WebSocket Stream Status: ${wsStatus}`}
          >
            {wsStatus === 'CONNECTED' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>{wsStatus}</span>
          </div>

          <div className="flex items-center gap-0.5 bg-[#0B100E] rounded-lg p-0.5 border border-[#26372D]">
            <button
              type="button"
              onClick={toggleAutoscale}
              className={`px-1.5 py-1 text-[10px] font-mono rounded transition-colors ${
                preferences.autoScale ? 'bg-[#064E3B]/60 text-[#34D399]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
              title="Toggle Autoscale"
            >
              AUTO
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] rounded"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] rounded"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFitContent}
              className="p-1 text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] rounded"
              title="Fit Content"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1 text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] rounded"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Series Style Bar */}
      <div className="flex md:hidden items-center gap-1 px-3 py-1.5 border-b border-[#26372D] bg-[#101A15] overflow-x-auto">
        {SERIES_STYLES.map((st) => (
          <button
            key={st.id}
            type="button"
            onClick={() => onUpdatePreferences((prev) => ({ ...prev, seriesStyle: st.id }))}
            className={`px-2 py-0.5 text-[11px] rounded whitespace-nowrap shrink-0 ${
              preferences.seriesStyle === st.id
                ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40'
                : 'text-[#A1ADA5] bg-[#0B100E]'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {/* Indicator Search Popover */}
      {showIndicatorModal && (
        <div className="absolute right-3 top-12 z-40 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[#26372D] bg-[#192820] shadow-2xl p-3 space-y-2.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#101A15] border border-[#26372D]">
            <Search className="w-3.5 h-3.5 text-[#A1ADA5]" />
            <input
              type="text"
              value={indicatorQuery}
              onChange={(e) => setIndicatorQuery(e.target.value)}
              placeholder="Search indicators (EMA, RSI, MACD, BB)..."
              className="w-full bg-transparent text-xs text-[#F1F5F2] placeholder-[#647168] focus:outline-none"
            />
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-[#26372D]">
            {filteredIndicators.map((ind) => {
              const enabled = preferences.indicators.includes(ind.key);
              return (
                <button
                  key={ind.key}
                  type="button"
                  onClick={() => toggleIndicator(ind.key)}
                  className="w-full flex items-center justify-between py-2 px-1.5 text-left hover:bg-[#142019] rounded transition-colors"
                >
                  <div>
                    <div className="text-xs font-medium text-[#F1F5F2]">{ind.name}</div>
                    <div className="text-[11px] text-[#A1ADA5]">{ind.desc}</div>
                  </div>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                      enabled ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/30' : 'bg-[#101A15] text-[#647168]'
                    }`}
                  >
                    {enabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Save / Restore Layout Popover */}
      {showLayoutsPopover && (
        <div className="absolute right-3 top-12 z-40 w-72 rounded-xl border border-[#26372D] bg-[#192820] shadow-2xl p-3 space-y-2.5 text-xs">
          <div className="font-semibold text-[#F1F5F2]">Chart Layouts</div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={layoutNameInput}
              onChange={(e) => setLayoutNameInput(e.target.value)}
              placeholder="Layout name..."
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] placeholder-[#647168] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSaveLayout}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#10B981] text-[#0B100E] font-semibold hover:bg-[#34D399]"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-[#26372D]">
            {preferences.layouts.length === 0 ? (
              <div className="py-3 text-center text-[#647168]">No saved layouts yet</div>
            ) : (
              preferences.layouts.map((lay) => (
                <div key={lay.id} className="flex items-center justify-between py-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleApplyLayout(lay)}
                    className="text-left flex-1 hover:text-[#34D399] truncate"
                  >
                    <div className="font-medium text-[#F1F5F2] truncate">{lay.name}</div>
                    <div className="text-[10px] text-[#A1ADA5] font-mono">
                      {lay.resolution} · {lay.seriesStyle} · {lay.indicators.length} ind
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdatePreferences((prev) => ({
                        ...prev,
                        layouts: prev.layouts.filter((item) => item.id !== lay.id),
                      }))
                    }
                    className="p-1 text-[#647168] hover:text-[#EF6464]"
                    title="Delete Layout"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Chart Settings Popover */}
      {showSettingsPopover && (
        <div className="absolute right-3 top-12 z-40 w-64 rounded-xl border border-[#26372D] bg-[#192820] shadow-2xl p-3 space-y-2.5 text-xs">
          <div className="font-semibold text-[#F1F5F2]">Chart Settings</div>
          <label className="flex items-center justify-between py-1 cursor-pointer">
            <span className="text-[#A1ADA5]">Show Grid Lines</span>
            <input
              type="checkbox"
              checked={preferences.showGrid}
              onChange={(e) =>
                onUpdatePreferences((prev) => ({ ...prev, showGrid: e.target.checked }))
              }
            />
          </label>
          <label className="flex items-center justify-between py-1 cursor-pointer">
            <span className="text-[#A1ADA5]">Auto-Scale Price Axis</span>
            <input
              type="checkbox"
              checked={preferences.autoScale}
              onChange={toggleAutoscale}
            />
          </label>
          <div className="flex items-center justify-between py-1 text-[#A1ADA5]">
            <span>Timezone</span>
            <span className="font-mono text-[#F1F5F2]">Asia/Jakarta (WIB)</span>
          </div>
        </div>
      )}

      {/* OHLCV Live Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 bg-[#101A15] border-b border-[#26372D] text-xs font-mono tabular-nums">
        <span className="text-[#F1F5F2] font-bold">
          {pairId} <span className="text-[#647168] font-normal">[{timeframe}]</span>
        </span>
        {displayOhlcv ? (
          <>
            <span className="text-[#A1ADA5]">
              O: <span className={isUp ? 'text-[#10B981]' : 'text-[#EF6464]'}>{formatIDR(displayOhlcv.open)}</span>
            </span>
            <span className="text-[#A1ADA5]">
              H: <span className="text-[#10B981]">{formatIDR(displayOhlcv.high)}</span>
            </span>
            <span className="text-[#A1ADA5]">
              L: <span className="text-[#EF6464]">{formatIDR(displayOhlcv.low)}</span>
            </span>
            <span className="text-[#A1ADA5]">
              C: <span className={isUp ? 'text-[#10B981]' : 'text-[#EF6464]'}>{formatIDR(displayOhlcv.close)}</span>
            </span>
            <span className="text-[#A1ADA5]">
              Vol: <span className="text-[#34D399]">{formatCrypto(displayOhlcv.volume, 4)}</span>
            </span>
            <span className="text-[#647168] text-[11px] ml-auto">{displayOhlcv.timeLabel}</span>
          </>
        ) : (
          <span className="text-[#647168] text-[11px]">Asia/Jakarta (WIB) · Awaiting executed trades</span>
        )}
      </div>

      {/* Main Chart + Left Drawing Toolbar */}
      <div className="flex flex-1 min-h-[360px] relative">
        {/* Vertical Drawing Toolbar */}
        <div className="flex flex-col items-center gap-1 p-1.5 border-r border-[#26372D] bg-[#101A15] shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTool('cursor');
              setPendingPoint(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'cursor'
                ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
            title="Crosshair / Pan"
          >
            <MousePointer className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTool('trendline');
              setPendingPoint(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'trendline'
                ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
            title="Trendline (Click 2 points)"
          >
            <TrendingUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTool('hline');
              setPendingPoint(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'hline'
                ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
            title="Horizontal Price Line"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTool('fib_retracement');
              setPendingPoint(null);
            }}
            className={`p-2 rounded-lg transition-colors ${
              activeTool === 'fib_retracement'
                ? 'bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/35'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
            }`}
            title="Fibonacci Retracement (Click 2 swing points)"
          >
            <Activity className="w-3.5 h-3.5" />
          </button>

          <div className="w-5 border-t border-[#26372D] my-1" />

          <button
            type="button"
            onClick={() => {
              const lastForPair = [...pairDrawings].pop();
              if (lastForPair) {
                setDrawings((prev) => prev.filter((d) => d.id !== lastForPair.id));
              }
            }}
            disabled={pairDrawings.length === 0}
            className="p-2 rounded-lg text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] disabled:opacity-30"
            title="Undo Last Drawing"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setDrawings((prev) => prev.filter((d) => d.pairId !== pairId))}
            disabled={pairDrawings.length === 0}
            className="p-2 rounded-lg text-[#A1ADA5] hover:text-[#EF6464] hover:bg-[#192820] disabled:opacity-30"
            title="Clear All Drawings"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Chart Canvas + Drawing SVG Layer + States */}
        <div className="relative flex-1 w-full h-full overflow-hidden">
          <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />

          {/* Active Drawing Capture Layer when a drawing tool is armed */}
          {activeTool !== 'cursor' && (
            <div
              onClick={handleOverlayClick}
              className="absolute inset-0 z-20 cursor-crosshair"
              title={
                activeTool === 'hline'
                  ? 'Click on chart to place Horizontal Line'
                  : pendingPoint
                  ? 'Click second point to complete drawing'
                  : 'Click first point on chart'
              }
            >
              <div className="m-2 inline-block px-2.5 py-1 rounded bg-[#142019] border border-[#10B981]/40 text-[11px] font-mono text-[#34D399]">
                {activeTool === 'hline'
                  ? 'Click chart to place Horizontal Line'
                  : pendingPoint
                  ? 'Click end point to finish'
                  : `Click start point (${activeTool === 'fib_retracement' ? 'Fibonacci' : 'Trendline'})`}
              </div>
            </div>
          )}

          {/* SVG Price-Time Anchored Drawings Overlay */}
          {renderedDrawings.length > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
              {renderedDrawings.map(({ drawing, coords }) => {
                if (coords.length < 2) return null;
                if (drawing.type === 'hline') {
                  return (
                    <g key={drawing.id}>
                      <line
                        x1={coords[0].x}
                        y1={coords[0].y}
                        x2={coords[1].x}
                        y2={coords[1].y}
                        stroke={drawing.color}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                      <text
                        x={12}
                        y={coords[0].y - 4}
                        fill={drawing.color}
                        fontSize={10}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {formatIDR(drawing.points[0].price)}
                      </text>
                    </g>
                  );
                }
                if (drawing.type === 'trendline') {
                  return (
                    <g key={drawing.id}>
                      <line
                        x1={coords[0].x}
                        y1={coords[0].y}
                        x2={coords[1].x}
                        y2={coords[1].y}
                        stroke={drawing.color}
                        strokeWidth={2}
                      />
                      <circle cx={coords[0].x} cy={coords[0].y} r={3.5} fill={drawing.color} />
                      <circle cx={coords[1].x} cy={coords[1].y} r={3.5} fill={drawing.color} />
                    </g>
                  );
                }
                // Fibonacci Retracement
                const startPrice = drawing.points[0].price;
                const endPrice = drawing.points[1].price;
                const yStart = coords[0].y;
                const yEnd = coords[1].y;
                const xMin = Math.min(coords[0].x, coords[1].x);
                const xMax = Math.max(coords[0].x, coords[1].x, xMin + 140);
                return (
                  <g key={drawing.id}>
                    {FIB_LEVELS.map((lvl) => {
                      const y = yStart + (yEnd - yStart) * lvl;
                      const priceVal = startPrice + (endPrice - startPrice) * lvl;
                      return (
                        <g key={`${drawing.id}_${lvl}`}>
                          <line
                            x1={xMin}
                            y1={y}
                            x2={xMax}
                            y2={y}
                            stroke={lvl === 0.618 || lvl === 0.5 ? '#EAB866' : 'rgba(234, 184, 102, 0.55)'}
                            strokeWidth={1}
                            strokeDasharray={lvl === 0 || lvl === 1 ? undefined : '3 3'}
                          />
                          <text
                            x={xMin + 4}
                            y={y - 3}
                            fill="#EAB866"
                            fontSize={10}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {(lvl * 100).toFixed(1)}% ({formatIDR(priceVal)})
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          )}

          {/* Loading State */}
          {loading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0B100E]/90 text-[#F1F5F2] gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#10B981]" />
              <span className="text-xs font-mono">Loading {pairId} OHLCV history...</span>
            </div>
          )}

          {/* Error State */}
          {!loading && errorMsg && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0B100E]/95 p-4 text-center gap-3">
              <div className="text-xs font-semibold text-[#EF6464]">{errorMsg}</div>
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="px-3.5 py-1.5 rounded-lg bg-[#142019] hover:bg-[#192820] text-xs text-[#F1F5F2] border border-[#26372D]"
              >
                Retry Loading Candles
              </button>
            </div>
          )}

          {/* Empty Market State (when SQLite has 0 executed trades for this pair) */}
          {!loading && !errorMsg && bars.length === 0 && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B100E]/85 p-6 text-center gap-2.5 pointer-events-auto">
              <CandlestickChart className="w-8 h-8 text-[#647168]" />
              <div className="text-sm font-semibold text-[#F1F5F2]">No Executed Trades Yet for {pairId}</div>
              <p className="text-xs text-[#A1ADA5] max-w-md leading-relaxed">
                OHLCV candles are constructed strictly from executed matching-engine trades. Place a spot order or start a Market Maker bot to generate live candles.
              </p>
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#142019] hover:bg-[#192820] text-xs text-[#34D399] border border-[#26372D]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Feed</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
