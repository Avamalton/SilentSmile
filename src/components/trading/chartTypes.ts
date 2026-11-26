import { TimeFrame } from '../../simulation/types';

export type ChartMode = 'SILENT_SMILE_PRO' | 'TRADINGVIEW_ADVANCED' | 'MARKET_DEPTH';

export type ResolutionString = '1' | '5' | '15' | '60' | '240' | '1D';

export type BackendInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type ChartSeriesStyle = 'candlestick' | 'bars' | 'line' | 'area' | 'heikin_ashi';

export type IndicatorKey =
  | 'VOLUME'
  | 'EMA9'
  | 'EMA21'
  | 'SMA7'
  | 'SMA25'
  | 'BB'
  | 'RSI'
  | 'MACD';

export type DrawingToolType = 'cursor' | 'trendline' | 'hline' | 'fib_retracement';

export interface DrawingPoint {
  time: number;  // Unix seconds
  price: number; // Quote price
}

export interface ChartDrawing {
  id: string;
  pairId: string;
  type: Exclude<DrawingToolType, 'cursor'>;
  points: DrawingPoint[];
  color: string;
  label?: string;
  createdAt: number;
}

export interface SavedChartLayout {
  id: string;
  name: string;
  savedAt: number;
  resolution: ResolutionString;
  seriesStyle: ChartSeriesStyle;
  indicators: IndicatorKey[];
  autoScale: boolean;
  showGrid: boolean;
}

export interface ChartPreferences {
  mode: ChartMode;
  seriesStyle: ChartSeriesStyle;
  indicators: IndicatorKey[];
  autoScale: boolean;
  showGrid: boolean;
  timezone: 'Asia/Jakarta';
  activeLayoutName: string;
  layouts: SavedChartLayout[];
}

export type DatafeedConnectionStatus =
  | 'IDLE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'ERROR';

export interface CandleSecondsBar {
  time: number;   // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  count?: number;
}

// ============================================================
// Official TradingView Advanced Charts (Charting Library) API
// ============================================================

export interface TVExchange {
  value: string;
  name: string;
  desc: string;
}

export interface TVSymbolType {
  name: string;
  value: string;
}

export interface TVDatafeedConfiguration {
  supported_resolutions: ResolutionString[];
  exchanges?: TVExchange[];
  symbols_types?: TVSymbolType[];
  supports_marks?: boolean;
  supports_timescale_marks?: boolean;
  supports_time?: boolean;
}

export interface TVSearchSymbolResultItem {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker?: string;
  type: string;
}

export interface TVLibrarySymbolInfo {
  ticker?: string;
  name: string;
  full_name: string;
  description: string;
  type: string;
  session: string;
  timezone: string;
  exchange: string;
  listed_exchange: string;
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_daily: boolean;
  has_weekly_and_monthly?: boolean;
  supported_resolutions: ResolutionString[];
  volume_precision: number;
  data_status: 'streaming' | 'endofday' | 'pulsed' | 'delayed_streaming';
  currency_code?: string;
  original_currency_code?: string;
  base_precision?: number;
  quote_precision?: number;
}

/**
 * TradingView Datafeed API requires Bar.time in Unix milliseconds.
 */
export interface TVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TVPeriodParams {
  from: number; // Unix seconds
  to: number;   // Unix seconds
  countBack?: number;
  firstDataRequest: boolean;
}

export interface TVHistoryMetadata {
  noData?: boolean;
  nextTime?: number; // Unix milliseconds
}

export type TVHistoryCallback = (bars: TVBar[], meta?: TVHistoryMetadata) => void;
export type TVSubscribeBarsCallback = (bar: TVBar) => void;
export type TVErrorCallback = (reason: string) => void;

export interface IDatafeedChartApi {
  onReady: (callback: (configuration: TVDatafeedConfiguration) => void) => void;
  searchSymbols: (
    userInput: string,
    exchange: string,
    symbolType: string,
    onResult: (items: TVSearchSymbolResultItem[]) => void
  ) => void;
  resolveSymbol: (
    symbolName: string,
    onResolve: (symbolInfo: TVLibrarySymbolInfo) => void,
    onError: TVErrorCallback
  ) => void;
  getBars: (
    symbolInfo: TVLibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: TVPeriodParams,
    onResult: TVHistoryCallback,
    onError: TVErrorCallback
  ) => void;
  subscribeBars: (
    symbolInfo: TVLibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: TVSubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void
  ) => void;
  unsubscribeBars: (listenerGuid: string) => void;
}

export interface TVWidgetOptions {
  symbol: string;
  interval: ResolutionString;
  container: HTMLElement | string;
  datafeed: IDatafeedChartApi;
  library_path: string;
  locale: string;
  timezone?: string;
  theme?: 'light' | 'dark';
  autosize?: boolean;
  fullscreen?: boolean;
  disabled_features?: string[];
  enabled_features?: string[];
  studies_overrides?: Record<string, any>;
  overrides?: Record<string, any>;
  charts_storage_api_version?: '1.0' | '1.1';
  client_id?: string;
  user_id?: string;
  save_load_adapter?: {
    getAllCharts: () => Promise<any[]>;
    removeChart: (id: string) => Promise<void>;
    saveChart: (chartData: any) => Promise<string>;
    getChartContent: (id: string) => Promise<string>;
  };
}

export interface IChartingLibraryWidget {
  onChartReady: (callback: () => void) => void;
  activeChart: () => {
    setSymbol: (symbol: string, callback?: () => void) => void;
    setResolution: (resolution: ResolutionString, callback?: () => void) => void;
    createStudy: (name: string, forceOverlay?: boolean, lock?: boolean, inputs?: any[]) => Promise<any>;
  };
  setSymbol: (symbol: string, interval: ResolutionString, callback?: () => void) => void;
  remove: () => void;
}

export interface TradingViewNamespace {
  widget: new (options: TVWidgetOptions) => IChartingLibraryWidget;
  version?: () => string;
}

export interface TradingViewLibraryAvailability {
  status: 'checking' | 'available' | 'license_required' | 'error';
  libraryPath: string;
  scriptUrl: string;
  version?: string;
  reason?: string;
}

export const TIMEFRAME_TO_RESOLUTION: Record<TimeFrame, ResolutionString> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1D': '1D',
};

export const RESOLUTION_TO_TIMEFRAME: Record<ResolutionString, TimeFrame> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  '1D': '1D',
};
