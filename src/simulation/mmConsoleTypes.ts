export interface ExternalTicker {
  provider: 'binance' | 'bybit';
  symbol: string; // e.g. BTCUSDT
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  volume24h: number;
  high24h?: number;
  low24h?: number;
  timestamp: number;
  latencyMs: number;
}

export interface AggregatedReferencePrice {
  symbol: string; // e.g. BTCUSDT, ETHUSDT, SOLUSDT, USDTIDR
  primaryPrice: number;
  secondaryPrice?: number;
  finalPrice: number;
  bidPrice: number;
  askPrice: number;
  spreadBps: number;
  primaryProvider: 'binance' | 'bybit' | 'internal' | 'manual';
  secondaryProvider?: 'binance' | 'bybit' | 'internal' | 'manual';
  confidenceScore: number; // 0 - 100%
  status: 'FRESH' | 'STALE' | 'DISPUTED' | 'OUTLIER' | 'DEVIATION_HIGH' | 'INVALID';
  lastUpdated: number;
  rejectionReason?: string;
  sourceCount: number;
}

export interface FxRateConfig {
  source: 'MANUAL_ADMIN' | 'COINGECKO_FEED' | 'BINANCE_P2P' | 'BANK_INDONESIA';
  usdtIdrRate: number;
  lastUpdated: number;
  expiresAt: number;
  updatedBy: string;
  isStale: boolean;
}

export type ReferenceMappingMode =
  | 'DIRECT_PRICE'
  | 'PERCENTAGE_RETURN'
  | 'BETA_SCALED_RETURN'
  | 'MANUAL_ANCHOR'
  | 'FX_CONVERTED_REFERENCE';

export interface CrossMarketMappingConfig {
  targetMarketSymbol: string; // e.g. DNA/IDR or SOL/IDR
  referenceMarketSymbol: string; // e.g. BTCUSDT or ETHUSDT
  referenceProvider: 'aggregated' | 'binance' | 'bybit';
  mappingMode: ReferenceMappingMode;
  targetAnchorPrice: number;
  referenceAnchorPrice: number;
  sensitivityBeta: number; // e.g. 0.5, 1.0, 1.5
  maxDeviationBps: number; // e.g. 500 (5%)
  requiresFxConversion: boolean; // if reference is USDT but target is IDR
  fxPair: 'USDT/IDR';
  mappingEnabled: boolean;
  lastCalculatedPrice?: number;
  lastCalculationTimestamp?: number;
}

export type MMConsoleBotStrategy = 'PRICE_FOLLOWER' | 'DEPTH_LIQUIDITY_LADDER' | 'SPREAD_CAPTURE';

export type MMBotExecutionStatus =
  | 'DRAFT'
  | 'CONFIGURED'
  | 'VALIDATING'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR'
  | 'RISK_LOCKED';

export interface DepthLadderLevel {
  level: number;
  offsetBps: number;
  quantity: number;
  price?: number;
}

export interface DepthLadderConfig {
  numberOfBidLevels: number;
  numberOfAskLevels: number;
  spacingMode: 'FIXED_SPACING' | 'CUSTOM_SPACING' | 'VOLATILITY_ADAPTIVE_SPACING';
  bidLevels: DepthLadderLevel[];
  askLevels: DepthLadderLevel[];
  randomizeQuantity: boolean;
  randomMinQtyPct: number; // e.g. 80%
  randomMaxQtyPct: number; // e.g. 120%

  // Wizard tuning parameters
  minOrderBid?: number;
  minOrderAsk?: number;
  minAmountOrderLevel?: number;
  maxAmountOrderLevel?: number;
  amountOrderLevel?: number;
  minSpreadBps?: number;
  maxSpreadBps?: number;
  qtyAmountRandom?: number; // Variation % e.g. 15%
  delayMinMs?: number; // Min reprice delay in ms
  delayMaxMs?: number; // Max reprice delay in ms
}

export interface MMRiskProfile {
  maxOrderNotional: number; // in quote currency e.g. IDR
  maxOpenOrders: number;
  maxInventoryQuote: number;
  maxInventoryBase: number;

  // Inventory & Safety controls
  maxTotalBidValue?: number; // e.g. 500,000,000 IDR Total komitmen beli
  maxTotalAskQty?: number; // e.g. 500.0 BTC Total komitmen jual
  customTickSize?: number; // e.g. 10 IDR Kelipatan harga minimum (tick size)
  minimumLotSize?: number; // e.g. 0.0001 BTC Satuan ukuran terkecil per order
  antiStackingActive?: boolean; // Anti-Numpuk / Anti-Stacking Aktif

  maxDailyTurnover: number;
  maxDailyLoss: number;
  maxDrawdownPct: number;
  maxPriceDeviationBps: number;
  maxSpreadBps: number;
  maxDataAgeMs: number;
  maxCancelReplacePerMin: number;
  killSwitchActive: boolean;
}

export interface MMConsoleBot {
  id: string;
  name: string;
  strategy: MMConsoleBotStrategy;
  accountId: string; // e.g. usr_mm_01
  apiKeyId?: string; // Bot's scoped API key
  targetMarketSymbol: string; // e.g. DNA/IDR
  mapping: CrossMarketMappingConfig;
  depthConfig?: DepthLadderConfig;
  riskProfile: MMRiskProfile;
  status: MMBotExecutionStatus;
  dryRun: boolean;

  // Repricing tuning
  minRepriceIntervalMs: number; // e.g. 2500ms
  minPriceChangeBps: number; // e.g. 15 bps (0.15%)
  targetSpreadBps: number; // e.g. 25 bps (0.25%)

  // Operational metrics
  activeOpenOrdersCount: number;
  totalBidExposure: number;
  totalAskExposure: number;
  currentBaseInventory: number;
  currentQuoteInventory: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dailyTurnover: number;
  lastRepricedAt?: number;
  errorMessage?: string;

  // Metadata
  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface CryptographicAuditEvent {
  id: string;
  index: number;
  actorId: string;
  actorRole: string;
  botId?: string;
  eventType: string;
  previousHash: string;
  currentHash: string;
  timestamp: number;
  payload: Record<string, any>;
  configVersion?: number;
  signatureVerified?: boolean;
}
