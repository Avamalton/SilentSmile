import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  AuditLogEntry,
  AutoTradeConfig,
  BookOrder,
  Candle,
  MarketPair,
  MMConfig,
  Order,
  OrderBook,
  OrderSide,
  OrderStatus,
  OrderType,
  PairMMBotConfig,
  MMBotLog,
  MMTransactionType,
  SimulationSettings,
  TimeFrame,
  Trade,
  UserBalance,
  UserProfile,
  AdminFeeVault,
  AdminFeeEvent,
  FullMMConfig,
} from './types';
import { generateInitialTrades } from './marketData';
import {
  aggregateOrderBook,
  buildMMOrders,
} from './clobEngine';
import { safeRound } from '../utils/formatters';
import { injectProgrammaticLimitOrders } from './simulation-matching-engine';
import { DEMO_USERS, DEFAULT_MARKETS, INITIAL_USER_BALANCES, MULTI_USER_INITIAL_BALANCES } from './constants';
import { marketDataService } from './marketDataService';
import { executeOrderAgainstCLOB, cancelRestingOrderAndUnlockBalance } from './settlementEngine';
import { executeAutoTradeTick } from './autoTradeEngine';
import { DEFAULT_FULL_MM_CONFIGS, generateInstitutionalMMQuotes } from './mmStrategyEngine';
import { InitialListing, InitialListingSchedule, AdminOverride, ListingEvent } from './listingTypes';
import { ListingSchedulerService } from './listingSchedulerService';
import { MMPreparationService } from './mmPreparationService';
import { LedgerService } from './ledgerService';
import {
  AssetConfig,
  NetworkConfig,
  DepositAddress,
  OnChainTransaction,
  WithdrawalTransaction,
  FeatureStatus,
} from './assetNetworkTypes';
import { AssetNetworkService } from './assetNetworkService';
import {
  MMConsoleBot,
  AggregatedReferencePrice,
  FxRateConfig,
} from './mmConsoleTypes';
import { MMPriceFeedAggregatorService } from './mmPriceFeedService';
import { buildQuantBotLadder } from './quantLadder';

export interface ProviderWsHealth {
  provider: 'binance' | 'bybit';
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';
  symbolsTracked: string[];
  lastMessageTime: number;
  latencyMs?: number;
  lastError?: string | null;
  fallbackActive?: boolean;
}

export interface WorkerFeedHealthState {
  wsConnected: boolean;
  wsError: string | null;
  binance: ProviderWsHealth;
  bybit: ProviderWsHealth;
}

const STORAGE_KEY = 'silentsmile_clob_simulation_v3';

let globalIdCounter = 0;
export const createUniqueId = (prefix: string = 'id'): string => {
  globalIdCounter = (globalIdCounter + 1) % 10000000;
  return `${prefix}_${Date.now()}_${globalIdCounter}_${Math.random().toString(36).slice(2, 7)}`;
};

function syncPairToBackend(pair: MarketPair): void {
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/market/pairs/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: pair.id,
        baseAsset: pair.baseAsset,
        quoteAsset: pair.quoteAsset,
        basePrecision: pair.amountDecimals,
        quotePrecision: pair.priceDecimals,
        minOrderSize: Math.max(1, Math.round((pair.minOrderAmount || 1) * Math.pow(10, pair.amountDecimals))),
        makerFeeBps: pair.makerFeeBps,
        takerFeeBps: pair.takerFeeBps,
        isActive: pair.isActive,
        tradingStatus: pair.tradingAccessStatus || (pair.isActive ? 'OPEN' : 'CLOSED'),
      }),
    })
      .then(() => {
        window.dispatchEvent(new CustomEvent('silentsmile:pair-synced', { detail: { pairId: pair.id } }));
      })
      .catch(() => {});
  } catch {}
}

function syncTradesToBackend(trades: Trade[], pair: MarketPair): void {
  if (typeof window === 'undefined' || !trades || trades.length === 0) return;

  try {
    window.dispatchEvent(
      new CustomEvent('silentsmile:trades-recorded', {
        detail: {
          pairId: pair.id,
          trades: trades.map((t) => ({
            id: t.id,
            pair: t.pair || pair.id,
            price: t.price,
            amount: t.amount,
            total: t.total,
            side: t.side,
            timestamp: t.timestamp,
          })),
        },
      })
    );
  } catch {}

  try {
    fetch('/api/market/trades/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        pair: {
          id: pair.id,
          baseAsset: pair.baseAsset,
          quoteAsset: pair.quoteAsset,
          basePrecision: pair.amountDecimals,
          quotePrecision: pair.priceDecimals,
          minOrderSize: Math.max(1, Math.round((pair.minOrderAmount || 1) * Math.pow(10, pair.amountDecimals))),
          makerFeeBps: pair.makerFeeBps,
          takerFeeBps: pair.takerFeeBps,
          isActive: pair.isActive,
          tradingStatus: pair.tradingAccessStatus || (pair.isActive ? 'OPEN' : 'CLOSED'),
        },
        trades: trades.map((t) => ({
          id: t.id,
          pairId: t.pair || pair.id,
          price: t.price,
          amount: t.amount,
          total: t.total,
          side: t.side,
          makerOrderId: t.makerOrderId || t.orderId,
          takerOrderId: t.takerOrderId || t.orderId,
          makerUserId: t.makerUserId,
          takerUserId: t.takerUserId,
          timestamp: t.timestamp,
        })),
      }),
    }).catch(() => {});
  } catch {}
}

export const DEFAULT_INITIAL_LISTINGS: InitialListing[] = [
  {
    id: 'list_mock_01',
    symbol: 'MOCK/IDR',
    base_asset: 'MOCK',
    quote_asset: 'IDR',
    name: 'Mock Token (Pre-Launch)',
    category: 'DEFI',
    status: 'PREPARING',
    mm_preparation_phase: 'ORDER_SETUP_OPEN',
    trading_status: 'PREPARATION_ONLY',
    deposit_status: 'OPEN',
    withdrawal_status: 'CLOSED',
    visibility: 'UPCOMING',
    initial_price: 25000,
    price_precision: 0,
    amount_precision: 2,
    min_order_amount: 1,
    maker_fee_bps: 10,
    taker_fee_bps: 15,
    assigned_mm_account: 'usr_mm_01',
    schedule: {
      announcement_at: Date.now() - 3600000 * 2,
      mm_funding_opens_at: Date.now() - 3600000,
      mm_setup_opens_at: Date.now() - 1800000,
      public_trading_opens_at: Date.now() + 1800000, // in 30 minutes
      deposit_opens_at: Date.now() - 3600000,
      withdrawal_opens_at: Date.now() + 86400000,
      new_badge_expires_at: Date.now() + 86400000 * 3,
      min_base_inventory: 5000,
      min_quote_inventory: 100000000,
      target_spread_bps: 35,
      min_depth_levels: 5,
      schedule_version: 1,
    },
    created_at: Date.now() - 3600000 * 2,
    updated_at: Date.now(),
    audit_trail: [
      {
        id: 'evt_init_mock',
        listing_id: 'list_mock_01',
        event_type: 'LISTING_SCHEDULED',
        previous_state: 'APPROVED',
        new_state: 'PREPARING',
        actor_id: 'usr_admin_01',
        timestamp: Date.now() - 3600000,
        schedule_version: 1,
      },
    ],
  },
  {
    id: 'list_aurora_01',
    symbol: 'AURORA/IDR',
    base_asset: 'AURORA',
    quote_asset: 'IDR',
    name: 'Aurora Protocol (Upcoming)',
    category: 'INFRA',
    status: 'SCHEDULED',
    mm_preparation_phase: 'NOT_STARTED',
    trading_status: 'CLOSED',
    deposit_status: 'CLOSED',
    withdrawal_status: 'CLOSED',
    visibility: 'UPCOMING',
    initial_price: 85000,
    price_precision: 0,
    amount_precision: 3,
    min_order_amount: 0.1,
    maker_fee_bps: 10,
    taker_fee_bps: 15,
    assigned_mm_account: 'usr_mm_01',
    schedule: {
      announcement_at: Date.now() - 3600000,
      mm_funding_opens_at: Date.now() + 3600000,
      mm_setup_opens_at: Date.now() + 7200000,
      public_trading_opens_at: Date.now() + 10800000,
      deposit_opens_at: Date.now() + 3600000,
      withdrawal_opens_at: Date.now() + 86400000 * 2,
      new_badge_expires_at: Date.now() + 86400000 * 4,
      min_base_inventory: 2500,
      min_quote_inventory: 200000000,
      target_spread_bps: 30,
      min_depth_levels: 6,
      schedule_version: 1,
    },
    created_at: Date.now() - 3600000,
    updated_at: Date.now(),
    audit_trail: [],
  },
  {
    id: 'list_dna_01',
    symbol: 'DNA/IDR',
    base_asset: 'DNA',
    quote_asset: 'IDR',
    name: 'DeSci Network Asset',
    category: 'DEFI',
    status: 'LIVE',
    mm_preparation_phase: 'READY',
    trading_status: 'OPEN',
    deposit_status: 'OPEN',
    withdrawal_status: 'OPEN',
    visibility: 'LIVE',
    initial_price: 14250,
    price_precision: 0,
    amount_precision: 2,
    min_order_amount: 1,
    maker_fee_bps: 10,
    taker_fee_bps: 15,
    assigned_mm_account: 'usr_mm_01',
    schedule: {
      announcement_at: Date.now() - 86400000 * 7,
      mm_funding_opens_at: Date.now() - 86400000 * 6,
      mm_setup_opens_at: Date.now() - 86400000 * 5,
      public_trading_opens_at: Date.now() - 86400000 * 4,
      deposit_opens_at: Date.now() - 86400000 * 6,
      withdrawal_opens_at: Date.now() - 86400000 * 3,
      new_badge_expires_at: Date.now() + 86400000 * 2,
      min_base_inventory: 50000,
      min_quote_inventory: 500000000,
      target_spread_bps: 30,
      min_depth_levels: 8,
      schedule_version: 1,
    },
    created_at: Date.now() - 86400000 * 7,
    updated_at: Date.now(),
    audit_trail: [],
  },
];

export const INITIAL_BOT_BALANCES: Record<string, UserBalance> = {
  IDR: { asset: 'IDR', free: 2500000000, locked: 0, total: 2500000000 },
  DNA: { asset: 'DNA', free: 2000000, locked: 0, total: 2000000 },
  BTC: { asset: 'BTC', free: 50, locked: 0, total: 50 },
  ETH: { asset: 'ETH', free: 500, locked: 0, total: 500 },
  SOL: { asset: 'SOL', free: 10000, locked: 0, total: 10000 },
  USDT: { asset: 'USDT', free: 500000, locked: 0, total: 500000 },
};

export const DEFAULT_PAIR_MM_BOTS: Record<string, PairMMBotConfig> = {
  'DNA/IDR': {
    pair: 'DNA/IDR',
    enabled: true,
    targetSpreadBps: 30,
    levelsPerSide: 50,
    baseAmountPerLevel: 750,
    tickSize: 25,
    frequencySec: 3,
    price_decimal: 0,
    quantity_decimal: 2,
    expire_time: 120,
    order_count: 50,
    split_order: true,
    split_range: 1.5,
    buy_min_price_limit: 11000,
    buy_max_price_limit: 14200,
    sell_min_price_limit: 14300,
    sell_max_price_limit: 18000,
    jitter_timing_pct: 12,
    jitter_price_pct: 0.05,
    account_id: 'usr_mm_01',
    transaction_type: 'post_only',
  },
  'BTC/IDR': {
    pair: 'BTC/IDR',
    enabled: true,
    targetSpreadBps: 20,
    levelsPerSide: 50,
    baseAmountPerLevel: 0.05,
    tickSize: 50000,
    frequencySec: 4,
    price_decimal: 0,
    quantity_decimal: 6,
    expire_time: 180,
    order_count: 50,
    split_order: true,
    split_range: 1.0,
    buy_min_price_limit: 1200000000,
    buy_max_price_limit: 1475000000,
    sell_min_price_limit: 1485000000,
    sell_max_price_limit: 1800000000,
    jitter_timing_pct: 10,
    jitter_price_pct: 0.02,
    account_id: 'usr_mm_01',
    transaction_type: 'post_only',
  },
  'ETH/IDR': {
    pair: 'ETH/IDR',
    enabled: true,
    targetSpreadBps: 25,
    levelsPerSide: 50,
    baseAmountPerLevel: 0.5,
    tickSize: 10000,
    frequencySec: 3,
    price_decimal: 0,
    quantity_decimal: 4,
    expire_time: 150,
    order_count: 50,
    split_order: true,
    split_range: 1.2,
    buy_min_price_limit: 45000000,
    buy_max_price_limit: 52000000,
    sell_min_price_limit: 52500000,
    sell_max_price_limit: 60000000,
    jitter_timing_pct: 10,
    jitter_price_pct: 0.03,
    account_id: 'usr_mm_01',
    transaction_type: 'post_only',
  },
  'SOL/IDR': {
    pair: 'SOL/IDR',
    enabled: true,
    targetSpreadBps: 30,
    levelsPerSide: 50,
    baseAmountPerLevel: 5,
    tickSize: 1000,
    frequencySec: 3,
    price_decimal: 0,
    quantity_decimal: 3,
    expire_time: 120,
    order_count: 50,
    split_order: true,
    split_range: 1.5,
    buy_min_price_limit: 2400000,
    buy_max_price_limit: 2840000,
    sell_min_price_limit: 2870000,
    sell_max_price_limit: 3400000,
    jitter_timing_pct: 15,
    jitter_price_pct: 0.04,
    account_id: 'usr_mm_01',
    transaction_type: 'post_only',
  },
  'USDT/IDR': {
    pair: 'USDT/IDR',
    enabled: true,
    targetSpreadBps: 10,
    levelsPerSide: 50,
    baseAmountPerLevel: 1000,
    tickSize: 5,
    frequencySec: 4,
    price_decimal: 0,
    quantity_decimal: 2,
    expire_time: 300,
    order_count: 50,
    split_order: true,
    split_range: 0.5,
    buy_min_price_limit: 15800,
    buy_max_price_limit: 16170,
    sell_min_price_limit: 16190,
    sell_max_price_limit: 16600,
    jitter_timing_pct: 8,
    jitter_price_pct: 0.01,
    account_id: 'usr_mm_01',
    transaction_type: 'post_only',
  },
};

export const DEFAULT_DNA_MM_CONFIG: MMConfig = {
  enabled: true,
  pair: 'DNA/IDR',
  targetSpreadBps: 30,
  levelsPerSide: 12,
  baseAmountPerLevel: 750,
  amountVariancePct: 30,
  tickSize: 25,
  allocatedIDR: 1500000000,
  allocatedBase: 1200000,
  wallBuyEnabled: true,
  wallBuyPrice: 13800,
  wallBuyAmount: 35000,
  wallSellEnabled: true,
  wallSellPrice: 14750,
  wallSellAmount: 35000,
  churnEnabled: false,
  churnIntervalMs: 3500,
  churnMinQty: 25,
  churnMaxQty: 250,
};

export const DEFAULT_AUTO_TRADE_CONFIG: AutoTradeConfig = {
  enabled: false,
  targetPair: 'DNA/IDR',
  targetVolume: 50000,
  accumulatedVolume: 0,
  minOrderSize: 50,
  maxOrderSize: 500,
  intervalSeconds: 3,
  executionMode: 'random',
  trendStrategy: 'neutral',
  autoStopOnTarget: true,
  lastExecutionTime: undefined,
};

export const INITIAL_ADMIN_FEE_VAULT: AdminFeeVault = {
  totalFeesIDR: 4250000,
  feesByAsset: {
    IDR: 4250000,
    DNA: 1250,
    BTC: 0.0025,
    ETH: 0.045,
    SOL: 0.85,
    USDT: 120,
  },
  recentEvents: [],
  lastUpdated: Date.now(),
};

interface SimulationContextType {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  markets: MarketPair[];
  activePair: MarketPair;
  balances: Record<string, UserBalance>;
  userBalancesMap: Record<string, Record<string, UserBalance>>;
  orderBook: OrderBook;
  restingOrders: BookOrder[];
  candles: Candle[];
  timeframe: TimeFrame;
  userOrders: Order[];
  myOrders: Order[];
  openOrders: Order[];
  userTrades: Trade[];
  marketTrades: Trade[];
  auditLogs: AuditLogEntry[];
  settings: SimulationSettings;
  portfolioValueIDR: number;
  unrealizedPnL: number;
  realizedPnL: number;
  isSubmitting: boolean;
  adminFeeVault: AdminFeeVault;
  fullMMConfigs: Record<string, FullMMConfig>;
  updateFullMMConfig: (pairId: string, updates: Partial<FullMMConfig>) => void;
  mmConfig: MMConfig;
  pairMMBots: Record<string, PairMMBotConfig>;
  updatePairMMBot: (pairId: string, updates: Partial<PairMMBotConfig>) => void;
  toggleMMBot: (pairId: string, enabled?: boolean) => void;
  stopAllPairMMBots: () => { success: boolean; count: number; message: string };
  startAllPairMMBots: () => { success: boolean; count: number; message: string };
  autoTradeConfig: AutoTradeConfig;
  autoTradeBots: AutoTradeConfig[];
  updateAutoTradeConfig: (updates: Partial<AutoTradeConfig>) => void;
  toggleAutoTrade: (enabled?: boolean) => void;
  resetAutoTradeVolume: () => void;
  upsertAutoTradeBot: (config: AutoTradeConfig) => void;
  updateAutoTradeBotByPair: (targetPair: string, updates: Partial<AutoTradeConfig>) => void;
  toggleAutoTradeBotByPair: (targetPair: string, enabled?: boolean) => void;
  resetAutoTradeBotVolumeByPair: (targetPair: string) => void;
  removeAutoTradeBot: (targetPair: string) => void;
  stopAllAutoTradeBots: () => void;
  setTimeframe: (tf: TimeFrame) => void;
  selectPair: (pairId: string) => void;
  submitOrder: (side: OrderSide, type: OrderType, amount: number, price: number) => Promise<{ success: boolean; message: string }>;
  cancelOrderById: (orderId: string) => { success: boolean; message: string };
  switchUser: (userId: string) => void;
  registerDemoUser: (name: string, email: string) => void;
  depositVirtualFaucet: (asset: string, amount: number) => void;
  updateMarketConfig: (pairId: string, updates: Partial<MarketPair>) => void;
  updateSettings: (updates: Partial<SimulationSettings>) => void;
  resetSimulationData: () => void;
  toggleFavoritePair: (pairId: string) => void;
  botBalances: Record<string, UserBalance>;
  updateMMConfig: (updates: Partial<MMConfig>) => void;
  replenishLiquidity: (targetPairId?: string, configOverride?: Partial<MMConfig>) => void;
  clearMMOrders: (targetPairId?: string) => void;
  injectOrderWall: (side: OrderSide, price: number, amount: number, targetPairId?: string) => void;
  cancelOrderWall: (orderId: string) => { success: boolean; message: string };
  clearAllWalls: (targetPairId?: string) => void;
  injectAutomatedLimitOrders: (
    targetPairId: string,
    spreadPct: number,
    orderFrequencySeconds: number,
    orderAmountSize: number,
    depthLevels: number,
    tighten?: boolean
  ) => { success: boolean; message: string; tradesCount: number; ordersCount: number };
  depositBotBalance: (asset: string, amount: number) => void;
  mmActiveOrders: BookOrder[];
  cancelAllMMOrders: (targetPairId?: string) => { success: boolean; count: number; message: string };
  mmBotLogs: MMBotLog[];
  addMMBotLog: (log: Omit<MMBotLog, 'id' | 'timestamp'>) => void;
  clearMMBotLogs: () => void;
  // Initial Listing Lifecycle & MM Launch
  initialListings: InitialListing[];
  createDraftListing: (draftData: Partial<InitialListing>) => { success: boolean; listing?: InitialListing; error?: string };
  submitForReview: (listingId: string) => { success: boolean; error?: string };
  returnToDraft: (listingId: string, reason: string) => { success: boolean; error?: string };
  approveListing: (listingId: string, approvedBy: string, reviewNotes?: string) => { success: boolean; error?: string };
  rejectListing: (listingId: string, reason: string) => { success: boolean; error?: string };
  scheduleListing: (listingId: string, newSchedule: InitialListingSchedule, reason?: string) => { success: boolean; error?: string };
  rescheduleListing: (listingId: string, newSchedule: Partial<InitialListingSchedule>, reason: string) => { success: boolean; error?: string };
  pauseListing: (listingId: string, reason: string) => { success: boolean; error?: string };
  allocateTreasuryFunding: (listingId: string, asset: string, amount: number) => { success: boolean; error?: string };
  generatePreLaunchQuotesForListing: (listingId: string) => { success: boolean; count?: number; error?: string };
  applyAdminOverrideToListing: (listingId: string, override: AdminOverride) => { success: boolean; error?: string };
  toggleFeatureStatus: (listingId: string, feature: 'deposit' | 'withdrawal') => void;
  // Asset & Network Management (Hybrid Simulation & On-Chain Integration)
  assetConfigs: AssetConfig[];
  depositHistory: OnChainTransaction[];
  withdrawalHistory: WithdrawalTransaction[];
  getDepositAddress: (asset: string, networkId: string, userId?: string) => DepositAddress | null;
  simulateCryptoDeposit: (params: { asset: string; networkId: string; amount: number; txHash?: string }) => Promise<{ success: boolean; tx?: OnChainTransaction; error?: string }>;
  submitCryptoWithdrawal: (params: { asset: string; networkId: string; amount: number; destinationAddress: string; memoTag?: string; bankName?: string; accountName?: string }) => Promise<{ success: boolean; withdrawal?: WithdrawalTransaction; error?: string }>;
  approveWithdrawal: (withdrawalId: string, txHash?: string) => { success: boolean; error?: string };
  rejectWithdrawal: (withdrawalId: string, reason: string) => { success: boolean; error?: string };
  updateAssetNetworkConfig: (assetSymbol: string, networkId: string, updates: Partial<NetworkConfig>) => void;
  addAssetNetwork: (assetSymbol: string, newNetwork: NetworkConfig) => void;
  toggleAssetNetworkStatus: (assetSymbol: string, networkId: string, feature: 'deposit' | 'withdrawal') => void;
  toggleAssetGlobalStatus: (assetSymbol: string, feature: 'deposit' | 'withdrawal') => void;
  createAsset: (newAsset: AssetConfig, initialNetwork?: NetworkConfig, autoCreatePair?: boolean, initialAdminSupply?: number) => { success: boolean; error?: string };
  updateBaseAsset: (symbol: string, updates: Partial<AssetConfig>) => { success: boolean; error?: string };
  // Quant Market Maker Console & Live Feeds
  mmConsoleBots: MMConsoleBot[];
  workerFeedHealth: WorkerFeedHealthState;
  aggregatedRefPrices: Record<string, AggregatedReferencePrice>;
  fxRateConfig: FxRateConfig;
  createMMConsoleBot: (bot: MMConsoleBot) => void;
  updateMMConsoleBot: (botId: string, updates: Partial<MMConsoleBot>) => void;
  deleteMMConsoleBot: (botId: string) => void;
  toggleMMConsoleBotStatus: (botId: string, action: 'START' | 'PAUSE' | 'RESUME' | 'STOP') => void;
  cloneMMConsoleBot: (botId: string) => MMConsoleBot | null;
  emergencyStopAllMMConsoleBots: () => void;
  runMMConsoleBotTick: (botId: string) => { success: boolean; ordersPlaced: number; message: string };
}

const SimulationContext = createContext<SimulationContextType | null>(null);

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  // 1. User Profile
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.currentUser) return parsed.currentUser;
      }
    } catch (e) {}
    return DEMO_USERS[0];
  });

  // 2. Markets
  const [markets, setMarkets] = useState<MarketPair[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.markets && Array.isArray(parsed.markets) && parsed.markets.length > 0) {
          return parsed.markets;
        }
      }
    } catch (e) {}
    return DEFAULT_MARKETS;
  });

  const [activePairId, setActivePairId] = useState<string>('DNA/IDR');
  const activePair = markets.find((m) => m.id === activePairId) || markets[0];
  const [timeframe, setTimeframe] = useState<TimeFrame>('15m');

  // 3. Multi-User Balances Map
  const [userBalancesMap, setUserBalancesMap] = useState<Record<string, Record<string, UserBalance>>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.userBalancesMap && typeof parsed.userBalancesMap === 'object') {
          return parsed.userBalancesMap;
        }
      }
    } catch (e) {}

    const initialMap: Record<string, Record<string, UserBalance>> = {};
    for (const [userId, userAssets] of Object.entries(MULTI_USER_INITIAL_BALANCES)) {
      initialMap[userId] = {};
      for (const [asset, b] of Object.entries(userAssets)) {
        initialMap[userId][asset] = {
          asset,
          free: b.free,
          locked: b.locked,
          total: b.free + b.locked,
        };
      }
    }
    return initialMap;
  });

  const balances: Record<string, UserBalance> = useMemo(() => {
    if (userBalancesMap[currentUser.id]) {
      return userBalancesMap[currentUser.id];
    }
    const initial: Record<string, UserBalance> = {};
    for (const [asset, b] of Object.entries(INITIAL_USER_BALANCES)) {
      initial[asset] = {
        asset,
        free: b.free,
        locked: b.locked,
        total: b.free + b.locked,
      };
    }
    return initial;
  }, [userBalancesMap, currentUser.id]);

  // 3b. Bot Balances
  const [botBalances, setBotBalances] = useState<Record<string, UserBalance>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.botBalances) return parsed.botBalances;
      }
    } catch (e) {}
    return INITIAL_BOT_BALANCES;
  });

  // 3c. Admin Fee Vault (Treasury)
  const [adminFeeVault, setAdminFeeVault] = useState<AdminFeeVault>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.adminFeeVault) return parsed.adminFeeVault;
      }
    } catch (e) {}
    return INITIAL_ADMIN_FEE_VAULT;
  });

  // 4. MM Configurations
  const [mmConfig, setMmConfig] = useState<MMConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.mmConfig) return parsed.mmConfig;
      }
    } catch (e) {}
    return DEFAULT_DNA_MM_CONFIG;
  });

  const [fullMMConfigs, setFullMMConfigs] = useState<Record<string, FullMMConfig>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.fullMMConfigs && typeof parsed.fullMMConfigs === 'object') {
          const merged: Record<string, FullMMConfig> = { ...DEFAULT_FULL_MM_CONFIGS };
          for (const [k, v] of Object.entries(parsed.fullMMConfigs)) {
            if (v && typeof v === 'object') {
              merged[k] = {
                ...(DEFAULT_FULL_MM_CONFIGS[k] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR']),
                ...(v as Partial<FullMMConfig>),
                market_id: k,
              };
            }
          }
          return merged;
        }
      }
    } catch (e) {}
    return DEFAULT_FULL_MM_CONFIGS;
  });

  const [pairMMBots, setPairMMBots] = useState<Record<string, PairMMBotConfig>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.pairMMBots && typeof parsed.pairMMBots === 'object') {
          const depthMigrated = localStorage.getItem('silentsmile_depth50_v1_migrated');
          const merged: Record<string, PairMMBotConfig> = { ...DEFAULT_PAIR_MM_BOTS };
          for (const [k, v] of Object.entries(parsed.pairMMBots)) {
            if (v && typeof v === 'object') {
              const incoming = v as Partial<PairMMBotConfig>;
              const shouldUpgradeDepth = !depthMigrated && (incoming.levelsPerSide ?? 0) <= 12 && Boolean(DEFAULT_PAIR_MM_BOTS[k]);
              merged[k] = {
                ...(DEFAULT_PAIR_MM_BOTS[k] || {
                  pair: k,
                  enabled: true,
                  targetSpreadBps: 30,
                  levelsPerSide: 50,
                  baseAmountPerLevel: 10,
                  tickSize: 25,
                  frequencySec: 3,
                }),
                ...incoming,
                ...(shouldUpgradeDepth ? { levelsPerSide: 50, order_count: 50 } : {}),
                pair: k,
              };
            }
          }
          if (!depthMigrated) {
            localStorage.setItem('silentsmile_depth50_v1_migrated', '1');
          }
          return merged;
        }
      }
    } catch (e) {}
    return DEFAULT_PAIR_MM_BOTS;
  });

  const [autoTradeConfig, setAutoTradeConfig] = useState<AutoTradeConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.autoTradeConfig && typeof parsed.autoTradeConfig === 'object') {
          return { ...DEFAULT_AUTO_TRADE_CONFIG, ...parsed.autoTradeConfig };
        }
      }
    } catch (e) {}
    return DEFAULT_AUTO_TRADE_CONFIG;
  });

  const [autoTradeBots, setAutoTradeBots] = useState<AutoTradeConfig[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.autoTradeBots) && parsed.autoTradeBots.length > 0) {
          return parsed.autoTradeBots.map((b: Partial<AutoTradeConfig>) => ({
            ...DEFAULT_AUTO_TRADE_CONFIG,
            ...b,
            id: b.id || `autotrade_${(b.targetPair || 'DNA/IDR').replace(/[^A-Z0-9]/gi, '_')}`,
          }));
        }
        if (parsed.autoTradeConfig && typeof parsed.autoTradeConfig === 'object') {
          const single = { ...DEFAULT_AUTO_TRADE_CONFIG, ...parsed.autoTradeConfig };
          return [{ ...single, id: single.id || `autotrade_${single.targetPair.replace(/[^A-Z0-9]/gi, '_')}` }];
        }
      }
    } catch (e) {}
    return [{ ...DEFAULT_AUTO_TRADE_CONFIG, id: 'autotrade_DNA_IDR' }];
  });

  const autoTradeLastRunRef = useRef<Record<string, number>>({});

  // Quant Market Maker Console Bots (persisted in localStorage & executed continuously)
  const [mmConsoleBots, setMmConsoleBots] = useState<MMConsoleBot[]>(() => {
    try {
      const saved = localStorage.getItem('silentsmile_mm_console_bots');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const migrated = localStorage.getItem('silentsmile_mm_console_v2_anchor_migrated');
          if (!migrated) {
            localStorage.setItem('silentsmile_mm_console_v2_anchor_migrated', '1');
            return parsed.map((b: MMConsoleBot) =>
              (b.id === 'bot_dna_follower_01' || b.id === 'bot_btc_depth_01') &&
              b.version === 1 &&
              b.mapping?.referenceAnchorPrice === 92450
                ? {
                    ...b,
                    status: 'PAUSED' as const,
                    activeOpenOrdersCount: 0,
                    mapping: { ...b.mapping, referenceAnchorPrice: 59800 },
                  }
                : b
            );
          }
          return parsed;
        }
      }
    } catch (e) {}
    return [
      {
        id: 'bot_dna_follower_01',
        name: 'DNA Price Follower (Alpha)',
        strategy: 'PRICE_FOLLOWER',
        accountId: 'usr_mm_01',
        targetMarketSymbol: 'DNA/IDR',
        mapping: {
          targetMarketSymbol: 'DNA/IDR',
          referenceMarketSymbol: 'BTCUSDT',
          referenceProvider: 'aggregated',
          mappingMode: 'PERCENTAGE_RETURN',
          targetAnchorPrice: 14250,
          referenceAnchorPrice: 59800,
          sensitivityBeta: 0.65,
          maxDeviationBps: 800,
          requiresFxConversion: false,
          fxPair: 'USDT/IDR',
          mappingEnabled: true,
        },
        depthConfig: {
          numberOfBidLevels: 5,
          numberOfAskLevels: 5,
          spacingMode: 'FIXED_SPACING',
          minOrderBid: 10,
          minOrderAsk: 10,
          minAmountOrderLevel: 50,
          maxAmountOrderLevel: 2500,
          amountOrderLevel: 350,
          minSpreadBps: 15,
          maxSpreadBps: 60,
          qtyAmountRandom: 15,
          delayMinMs: 2000,
          delayMaxMs: 4000,
          bidLevels: [],
          askLevels: [],
          randomizeQuantity: true,
          randomMinQtyPct: 85,
          randomMaxQtyPct: 115,
        },
        riskProfile: {
          maxOrderNotional: 50000000,
          maxOpenOrders: 20,
          maxInventoryQuote: 1000000000,
          maxInventoryBase: 250000,
          maxTotalBidValue: 500000000,
          maxTotalAskQty: 10000,
          customTickSize: 10,
          minimumLotSize: 1,
          antiStackingActive: true,
          maxDailyTurnover: 500000000,
          maxDailyLoss: 25000000,
          maxDrawdownPct: 10.0,
          maxPriceDeviationBps: 500,
          maxSpreadBps: 150,
          maxDataAgeMs: 30000,
          maxCancelReplacePerMin: 120,
          killSwitchActive: false,
        },
        status: 'PAUSED',
        dryRun: false,
        minRepriceIntervalMs: 2500,
        minPriceChangeBps: 15,
        targetSpreadBps: 30,
        activeOpenOrdersCount: 0,
        totalBidExposure: 0,
        totalAskExposure: 0,
        currentBaseInventory: 125000,
        currentQuoteInventory: 450000000,
        realizedPnl: 18500000,
        unrealizedPnl: 4200000,
        dailyTurnover: 320000000,
        version: 1,
        createdBy: 'usr_admin_01',
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
      },
      {
        id: 'bot_btc_depth_01',
        name: 'BTC/IDR Institutional Depth Ladder',
        strategy: 'DEPTH_LIQUIDITY_LADDER',
        accountId: 'usr_mm_01',
        targetMarketSymbol: 'BTC/IDR',
        mapping: {
          targetMarketSymbol: 'BTC/IDR',
          referenceMarketSymbol: 'BTCUSDT',
          referenceProvider: 'aggregated',
          mappingMode: 'FX_CONVERTED_REFERENCE',
          targetAnchorPrice: 1485600000,
          referenceAnchorPrice: 59800,
          sensitivityBeta: 1.0,
          maxDeviationBps: 500,
          requiresFxConversion: true,
          fxPair: 'USDT/IDR',
          mappingEnabled: true,
        },
        depthConfig: {
          numberOfBidLevels: 5,
          numberOfAskLevels: 5,
          spacingMode: 'FIXED_SPACING',
          minOrderBid: 0.001,
          minOrderAsk: 0.001,
          minAmountOrderLevel: 0.005,
          maxAmountOrderLevel: 0.5,
          amountOrderLevel: 0.05,
          minSpreadBps: 15,
          maxSpreadBps: 60,
          qtyAmountRandom: 15,
          delayMinMs: 2000,
          delayMaxMs: 4500,
          bidLevels: [
            { level: 1, offsetBps: 10, quantity: 0.05 },
            { level: 2, offsetBps: 25, quantity: 0.08 },
            { level: 3, offsetBps: 50, quantity: 0.12 },
            { level: 4, offsetBps: 100, quantity: 0.18 },
            { level: 5, offsetBps: 200, quantity: 0.25 },
          ],
          askLevels: [
            { level: 1, offsetBps: 10, quantity: 0.05 },
            { level: 2, offsetBps: 25, quantity: 0.08 },
            { level: 3, offsetBps: 50, quantity: 0.12 },
            { level: 4, offsetBps: 100, quantity: 0.18 },
            { level: 5, offsetBps: 200, quantity: 0.25 },
          ],
          randomizeQuantity: true,
          randomMinQtyPct: 85,
          randomMaxQtyPct: 115,
        },
        riskProfile: {
          maxOrderNotional: 250000000,
          maxOpenOrders: 20,
          maxInventoryQuote: 5000000000,
          maxInventoryBase: 1000,
          maxTotalBidValue: 500000000,
          maxTotalAskQty: 500,
          customTickSize: 1000,
          minimumLotSize: 0.0001,
          antiStackingActive: true,
          maxDailyTurnover: 2000000000,
          maxDailyLoss: 50000000,
          maxDrawdownPct: 8.0,
          maxPriceDeviationBps: 300,
          maxSpreadBps: 120,
          maxDataAgeMs: 15000,
          maxCancelReplacePerMin: 180,
          killSwitchActive: false,
        },
        status: 'PAUSED',
        dryRun: false,
        minRepriceIntervalMs: 2000,
        minPriceChangeBps: 10,
        targetSpreadBps: 15,
        activeOpenOrdersCount: 0,
        totalBidExposure: 0,
        totalAskExposure: 0,
        currentBaseInventory: 4.8,
        currentQuoteInventory: 1250000000,
        realizedPnl: 34500000,
        unrealizedPnl: 8100000,
        dailyTurnover: 1450000000,
        version: 1,
        createdBy: 'usr_admin_01',
        createdAt: Date.now() - 172800000,
        updatedAt: Date.now(),
      },
    ];
  });

  const [aggregatedRefPrices, setAggregatedRefPrices] = useState<Record<string, AggregatedReferencePrice>>(() => {
    MMPriceFeedAggregatorService.initializeDefaultFeeds();
    const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'USDTIDR'];
    const init: Record<string, AggregatedReferencePrice> = {};
    for (const s of syms) init[s] = MMPriceFeedAggregatorService.getAggregatedPrice(s);
    return init;
  });

  const [fxRateConfig, setFxRateConfig] = useState<FxRateConfig>(() => MMPriceFeedAggregatorService.getFxRate());

  const [workerFeedHealth, setWorkerFeedHealth] = useState<WorkerFeedHealthState>({
    wsConnected: false,
    wsError: null,
    binance: { provider: 'binance', status: 'CONNECTING', symbolsTracked: [], lastMessageTime: 0, latencyMs: 35, lastError: null },
    bybit: { provider: 'bybit', status: 'CONNECTING', symbolsTracked: [], lastMessageTime: 0, latencyMs: 42, lastError: null },
  });

  const mmConsoleBotsRef = useRef(mmConsoleBots);
  useEffect(() => {
    mmConsoleBotsRef.current = mmConsoleBots;
    try {
      localStorage.setItem('silentsmile_mm_console_bots', JSON.stringify(mmConsoleBots));
    } catch {}
  }, [mmConsoleBots]);

  const mmBotLastRunRef = useRef<Record<string, number>>({});
  const mmBotLastMidRef = useRef<Record<string, number>>({});

  const [mmBotLogs, setMmBotLogs] = useState<MMBotLog[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.mmBotLogs && Array.isArray(parsed.mmBotLogs)) {
          const seen = new Set<string>();
          return parsed.mmBotLogs.map((log: MMBotLog, idx: number) => {
            let uniqueId = log.id;
            if (!uniqueId || seen.has(uniqueId)) {
              uniqueId = createUniqueId(`mmlog_${idx}`);
            }
            seen.add(uniqueId);
            return { ...log, id: uniqueId };
          });
        }
      }
    } catch (e) {}
    return [
      {
        id: createUniqueId('mmlog_init'),
        timestamp: Date.now(),
        pair: 'DNA/IDR',
        action: 'ENGINE_INITIALIZED',
        type: 'system',
        details: 'Institutional MM Engine active. Boundaries, price guards, and wall protections armed.',
      },
    ];
  });

  const addMMBotLog = useCallback((log: Omit<MMBotLog, 'id' | 'timestamp'>) => {
    const entry: MMBotLog = {
      id: createUniqueId('mmlog'),
      timestamp: Date.now(),
      ...log,
    };
    setMmBotLogs((prev) => [entry, ...prev.slice(0, 99)]);
  }, []);

  const clearMMBotLogs = useCallback(() => {
    setMmBotLogs([]);
  }, []);

  // 4b. Initial Listings & Preparation
  const [initialListings, setInitialListings] = useState<InitialListing[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.initialListings && Array.isArray(parsed.initialListings) && parsed.initialListings.length > 0) {
          return parsed.initialListings;
        }
      }
    } catch (e) {}
    return DEFAULT_INITIAL_LISTINGS;
  });

  // 4c. Asset & Network Management (Base Assets & Networks)
  const [customAssetsMap, setCustomAssetsMap] = useState<Record<string, AssetConfig>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.customAssetsMap && typeof parsed.customAssetsMap === 'object') {
          return parsed.customAssetsMap;
        }
      }
    } catch (e) {}
    return {};
  });

  const [customNetworksMap, setCustomNetworksMap] = useState<Record<string, NetworkConfig[]>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.customNetworksMap) return parsed.customNetworksMap;
      }
    } catch (e) {}
    return {};
  });

  const [depositHistory, setDepositHistory] = useState<OnChainTransaction[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.depositHistory && Array.isArray(parsed.depositHistory)) return parsed.depositHistory;
      }
    } catch (e) {}
    return [];
  });

  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalTransaction[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.withdrawalHistory && Array.isArray(parsed.withdrawalHistory)) return parsed.withdrawalHistory;
      }
    } catch (e) {}
    return [];
  });

  const assetConfigs: AssetConfig[] = useMemo(() => {
    return AssetNetworkService.getAllAssets(initialListings, customNetworksMap, customAssetsMap);
  }, [initialListings, customNetworksMap, customAssetsMap]);

  // 5. CLOB Resting Book Orders
  const [restingOrders, setRestingOrders] = useState<BookOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.restingOrders && Array.isArray(parsed.restingOrders) && parsed.restingOrders.length > 0) {
          const seen = new Set<string>();
          const pausedIds = new Set(
            mmConsoleBots.filter((b) => b.status !== 'RUNNING' || b.dryRun).map((b) => `bot_console_${b.id}`)
          );
          const cleaned = parsed.restingOrders
            .filter((order: BookOrder) => !pausedIds.has(order.userId))
            .map((order: BookOrder, idx: number) => {
              let uniqueId = order.id;
              if (!uniqueId || seen.has(uniqueId)) {
                uniqueId = createUniqueId(`ord_${idx}`);
              }
              seen.add(uniqueId);
              return { ...order, id: uniqueId };
            });
          if (cleaned.length > 0) return cleaned;
        }
      }
    } catch (e) {}
    const seeded: BookOrder[] = [];
    DEFAULT_MARKETS.forEach((pair) => {
      if (pair.isActive && (!pair.tradingAccessStatus || pair.tradingAccessStatus === 'OPEN') && DEFAULT_PAIR_MM_BOTS[pair.id]) {
        seeded.push(...buildMMOrders(pair, pair.lastPrice, DEFAULT_PAIR_MM_BOTS[pair.id], []));
      } else {
        const fullCfg = DEFAULT_FULL_MM_CONFIGS[pair.id] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
        seeded.push(...generateInstitutionalMMQuotes(pair, fullCfg, []));
      }
    });
    return seeded;
  });

  // 6. User Orders & Trades
  const [userOrders, setUserOrders] = useState<Order[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.userOrders) return parsed.userOrders;
      }
    } catch (e) {}
    return [];
  });

  const [userTrades, setUserTrades] = useState<Trade[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.userTrades) return parsed.userTrades;
      }
    } catch (e) {}
    return [];
  });

  const [marketTradesByPair, setMarketTradesByPair] = useState<Record<string, Trade[]>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.marketTradesByPair) return parsed.marketTradesByPair;
      }
    } catch (e) {}
    const initialTrades: Record<string, Trade[]> = {};
    DEFAULT_MARKETS.forEach((pair) => {
      initialTrades[pair.id] = generateInitialTrades(pair.id, pair.lastPrice, 15);
    });
    return initialTrades;
  });

  const marketTrades = useMemo(() => {
    return marketTradesByPair[activePair.id] || [];
  }, [marketTradesByPair, activePair.id]);

  // 7. Candlestick series from centralized MarketDataService
  const [candles, setCandles] = useState<Candle[]>(() => {
    return marketDataService.getCandles('DNA/IDR', '15m', 14250);
  });

  // Synchronize candles when active pair or timeframe switches
  useEffect(() => {
    const fresh = marketDataService.getCandles(activePair.id, timeframe, activePair.lastPrice);
    setCandles(fresh);
  }, [activePair.id, timeframe, activePair.lastPrice]);

  // Subscribe to real-time candle incremental updates
  useEffect(() => {
    const unsubscribe = marketDataService.subscribe(({ pairId, timeframe: tf, candles: updatedCandles }) => {
      if (pairId === activePair.id && tf === timeframe) {
        setCandles(updatedCandles);
      }
    });
    return () => unsubscribe();
  }, [activePair.id, timeframe]);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.auditLogs && Array.isArray(parsed.auditLogs)) {
          const seen = new Set<string>();
          return parsed.auditLogs.map((log: AuditLogEntry, idx: number) => {
            let uniqueId = log.id;
            if (!uniqueId || seen.has(uniqueId)) {
              uniqueId = createUniqueId(`log_${idx}`);
            }
            seen.add(uniqueId);
            return { ...log, id: uniqueId };
          });
        }
      }
    } catch (e) {}
    return [
      {
        id: createUniqueId('log_init'),
        actor: 'CLOB Matching Engine',
        action: 'ORDER_BOOK_INITIALIZED',
        target: 'DNA/IDR',
        details: 'Real Central Limit Order Book active. Automated Market Maker liquidity deployed.',
        timestamp: Date.now() - 3600000,
      },
    ];
  });

  const [settings, setSettings] = useState<SimulationSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.settings) return parsed.settings;
      }
    } catch (e) {}
    return {
      engineSpeed: 'normal',
      volatility: 'normal',
      soundEnabled: true,
      currencyFormat: 'standard',
      chartStyle: 'candlestick',
      showMovingAverages: true,
      autoRefreshBook: true,
    };
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Derive Level-2 Real Order Book (supports up to 50 depth levels)
  const orderBook = useMemo(() => {
    return aggregateOrderBook(restingOrders, activePair.id, currentUser.id, 50);
  }, [restingOrders, activePair.id, currentUser.id]);

  // Ref tracking state for timers
  const stateRef = useRef({
    activePair,
    markets,
    userOrders,
    restingOrders,
    balances,
    userBalancesMap,
    botBalances,
    settings,
    mmConfig,
    fullMMConfigs,
    pairMMBots,
    autoTradeConfig,
    autoTradeBots,
    aggregatedRefPrices,
    fxRateConfig,
    candles,
    timeframe,
    adminFeeVault,
  });

  useEffect(() => {
    stateRef.current = {
      activePair,
      markets,
      userOrders,
      restingOrders,
      balances,
      userBalancesMap,
      botBalances,
      settings,
      mmConfig,
      fullMMConfigs,
      pairMMBots,
      autoTradeConfig,
      autoTradeBots,
      aggregatedRefPrices,
      fxRateConfig,
      candles,
      timeframe,
      adminFeeVault,
    };
  });

  // LocalStorage Persistence
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          currentUser,
          markets,
          userBalancesMap,
          botBalances,
          userOrders,
          userTrades,
          marketTradesByPair,
          restingOrders,
          auditLogs,
          settings,
          mmConfig,
          fullMMConfigs,
          pairMMBots,
          autoTradeConfig,
          autoTradeBots,
          adminFeeVault,
          customAssetsMap,
          customNetworksMap,
          depositHistory,
          withdrawalHistory,
        })
      );
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }
  }, [
    currentUser,
    markets,
    userBalancesMap,
    botBalances,
    userOrders,
    userTrades,
    marketTradesByPair,
    restingOrders,
    auditLogs,
    settings,
    mmConfig,
    fullMMConfigs,
    pairMMBots,
    autoTradeConfig,
    autoTradeBots,
    adminFeeVault,
    customAssetsMap,
    customNetworksMap,
    depositHistory,
    withdrawalHistory,
  ]);

  const buildFallbackPairMMBot = useCallback((pairId: string, pairObj?: MarketPair): PairMMBotConfig => {
    if (DEFAULT_PAIR_MM_BOTS[pairId]) return DEFAULT_PAIR_MM_BOTS[pairId];
    const lastPrice = pairObj?.lastPrice || 10000;
    const tick =
      lastPrice >= 100000000 ? 50000 : lastPrice >= 10000000 ? 10000 : lastPrice >= 100000 ? 500 : 25;
    const minAmt = pairObj?.minOrderAmount || 1;
    const defaultAmt = Math.max(minAmt, lastPrice >= 100000000 ? 0.05 : lastPrice >= 1000000 ? 1 : 50);
    return {
      pair: pairId,
      enabled: pairObj?.isActive ?? true,
      targetSpreadBps: 30,
      levelsPerSide: 50,
      baseAmountPerLevel: defaultAmt,
      tickSize: tick,
      frequencySec: 3,
      price_decimal: pairObj?.priceDecimals ?? 0,
      quantity_decimal: pairObj?.amountDecimals ?? 2,
      expire_time: 180,
      order_count: 50,
      buy_min_price_limit: Math.max(tick, Math.floor(lastPrice * 0.5)),
      buy_max_price_limit: Math.max(tick, Math.floor(lastPrice * 0.999)),
      sell_min_price_limit: Math.ceil(lastPrice * 1.001),
      sell_max_price_limit: Math.ceil(lastPrice * 1.5),
      account_id: 'usr_mm_01',
      transaction_type: 'post_only',
    };
  }, []);

  const buildFallbackFullMMConfig = useCallback((pairId: string, pairObj?: MarketPair): FullMMConfig => {
    if (DEFAULT_FULL_MM_CONFIGS[pairId]) return DEFAULT_FULL_MM_CONFIGS[pairId];
    const baseTemplate = DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
    const lastPrice = pairObj?.lastPrice || 10000;
    const minAmt = pairObj?.minOrderAmount || 1;
    const defaultQty = Math.max(minAmt, lastPrice >= 100000000 ? 0.05 : lastPrice >= 1000000 ? 1 : 50);
    return {
      ...baseTemplate,
      market_id: pairId,
      enabled: pairObj?.isActive ?? true,
      emergency_stop: false,
      lifecycle_state: (pairObj?.isActive ?? true) ? 'RUNNING' : 'STOPPED',
      cs_price_decimal: pairObj?.priceDecimals ?? 0,
      cs_quantity_decimal: pairObj?.amountDecimals ?? 2,
      cs_target_price: lastPrice,
      buy_min_price_limit: Math.max(1, Math.floor(lastPrice * 0.5)),
      buy_max_price_limit: Math.max(1, Math.floor(lastPrice * 0.999)),
      sell_min_price_limit: Math.ceil(lastPrice * 1.001),
      sell_max_price_limit: Math.ceil(lastPrice * 1.5),
      min_order_quantity: defaultQty,
      max_order_quantity: Math.max(defaultQty * 10, defaultQty),
      order_count: 10,
    };
  }, []);

  // Update Full MM Config handler (keeps Dedicated Pair Liquidity Bot state in sync)
  const updateFullMMConfig = useCallback(
    (pairId: string, updates: Partial<FullMMConfig>) => {
      const current = stateRef.current;
      const pairObj = current.markets.find((m) => m.id === pairId);
      const baseFull = current.fullMMConfigs[pairId] || buildFallbackFullMMConfig(pairId, pairObj);
      const nextFull = { ...baseFull, ...updates };
      const nextFullMap = { ...current.fullMMConfigs, [pairId]: nextFull };
      stateRef.current.fullMMConfigs = nextFullMap;
      setFullMMConfigs(nextFullMap);

      const isStopped = updates.enabled === false || updates.emergency_stop === true || updates.lifecycle_state === 'STOPPED';
      const isStarted = updates.enabled === true && !updates.emergency_stop;
      if (isStopped || isStarted) {
        const existingBot = current.pairMMBots[pairId] || buildFallbackPairMMBot(pairId, pairObj);
        const nextPairMap = {
          ...current.pairMMBots,
          [pairId]: { ...existingBot, enabled: !isStopped },
        };
        stateRef.current.pairMMBots = nextPairMap;
        setPairMMBots(nextPairMap);
        if (isStopped) {
          const nextResting = current.restingOrders.filter(
            (o) => !(o.pair === pairId && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
          );
          stateRef.current.restingOrders = nextResting;
          setRestingOrders(nextResting);
        }
      }
    },
    [buildFallbackFullMMConfig, buildFallbackPairMMBot]
  );

  // 7a. Institutional MM Quoting Loop (1 Bot per 1 Pair)
  useEffect(() => {
    if (settings.engineSpeed === 'paused') return;

    const timer = setInterval(() => {
      const current = stateRef.current;
      const marketsList = current.markets;
      const activeConsolePairs = new Set(
        mmConsoleBotsRef.current
          .filter((b) => b.status === 'RUNNING' && !b.dryRun && !b.riskProfile?.killSwitchActive)
          .map((b) => b.targetMarketSymbol)
      );

      marketsList.forEach((pair) => {
        // Yield to active Quant MM Console Bot on this pair so two MM engines never fight
        if (activeConsolePairs.has(pair.id)) return;

        const pairBotCfg = current.pairMMBots[pair.id] || buildFallbackPairMMBot(pair.id, pair);
        const fullCfg = current.fullMMConfigs[pair.id] || buildFallbackFullMMConfig(pair.id, pair);
        const isPairBotEnabled = pairBotCfg.enabled && fullCfg.enabled && !fullCfg.emergency_stop && pair.isActive;
        if (!isPairBotEnabled) return;

        const nowTime = Date.now();
        const unexpiredResting = current.restingOrders.filter((o) => !o.expiresAt || o.expiresAt > nowTime);
        const mmOnlyOrders = unexpiredResting.filter(
          (o) => o.pair === pair.id && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_')
        );

        const targetLevels = Math.min(60, Math.max(4, pairBotCfg.levelsPerSide || 10));
        const mmBook = aggregateOrderBook(mmOnlyOrders, pair.id, currentUser.id, 60);
        const topBid = mmBook.bids[0]?.price || 0;
        const topAsk = mmBook.asks[mmBook.asks.length - 1]?.price || 0;
        const midDriftPct =
          topBid > 0 && topAsk > 0 && topAsk > topBid
            ? Math.abs(((topBid + topAsk) / 2 - pair.lastPrice) / pair.lastPrice) * 100
            : 100;

        // Replenish ONLY if MM depth is depleted OR MM mid drifted > 0.35% away from mark price
        const minHealthyLevels = Math.max(4, Math.floor(targetLevels * 0.6));
        if (mmBook.bids.length < minHealthyLevels || mmBook.asks.length < minHealthyLevels || midDriftPct > 0.35) {
          const nonMMResting = unexpiredResting.filter(
            (o) => o.pair === pair.id && !(o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
          );
          const highestNonMMBid = nonMMResting
            .filter((o) => o.side === 'buy')
            .reduce((m, o) => Math.max(m, o.price), 0);
          const lowestNonMMAsk = nonMMResting
            .filter((o) => o.side === 'sell')
            .reduce((m, o) => Math.min(m, o.price), Infinity);

          const pairWalls = unexpiredResting.filter((o) => o.pair === pair.id && o.isWall);
          const freshOrders = buildMMOrders(pair, pair.lastPrice, pairBotCfg, pairWalls).filter((o) => {
            if (o.side === 'buy' && lowestNonMMAsk < Infinity && o.price >= lowestNonMMAsk) return false;
            if (o.side === 'sell' && highestNonMMBid > 0 && o.price <= highestNonMMBid) return false;
            return true;
          });

          setRestingOrders((prev) => {
            const next = [
              ...prev.filter(
                (o) =>
                  !(o.pair === pair.id && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_')) &&
                  (!o.expiresAt || o.expiresAt > nowTime)
              ),
              ...freshOrders,
            ];
            stateRef.current.restingOrders = next;
            return next;
          });
        }
      });
    }, 3500);

    return () => clearInterval(timer);
  }, [settings.engineSpeed, currentUser.id, buildFallbackPairMMBot, buildFallbackFullMMConfig]);

  // 7a-2. Live WebSocket (/ws) + /api/mm/feeds/live Stream for Quant MM Console
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const applyBackendFeedSnapshot = (data: any) => {
      if (!data) return;
      if (Array.isArray(data.aggregatedPrices)) {
        setAggregatedRefPrices((prev) => {
          const next = { ...prev };
          for (const item of data.aggregatedPrices as AggregatedReferencePrice[]) {
            if (item && item.symbol) {
              next[item.symbol] = item;
              MMPriceFeedAggregatorService.ingestTicker({
                provider: item.primaryProvider === 'bybit' ? 'bybit' : 'binance',
                symbol: item.symbol,
                lastPrice: item.finalPrice,
                bidPrice: item.bidPrice,
                askPrice: item.askPrice,
                volume24h: 1200000000,
                timestamp: item.lastUpdated || Date.now(),
                latencyMs: 30,
              });
            }
          }
          return next;
        });
      }
      if (data.feedHealth) {
        if (data.feedHealth.fxRate) {
          setFxRateConfig(data.feedHealth.fxRate);
          MMPriceFeedAggregatorService.syncFxRate(data.feedHealth.fxRate);
        }
        setWorkerFeedHealth((prev) => ({
          ...prev,
          binance: data.feedHealth.binance || prev.binance,
          bybit: data.feedHealth.bybit || prev.bybit,
        }));
      }
    };

    const pollLiveFeeds = async () => {
      try {
        const res = await fetch('/api/mm/feeds/live');
        if (res.ok) {
          const json = await res.json();
          if (json.success) applyBackendFeedSnapshot(json);
        }
      } catch {}
    };

    const connectWs = () => {
      if (unmounted || typeof window === 'undefined') return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (unmounted) {
            ws?.close();
            return;
          }
          setWorkerFeedHealth((prev) => ({ ...prev, wsConnected: true, wsError: null }));
          try {
            ws?.send(JSON.stringify({ action: 'subscribe', topic: 'mm:feeds' }));
          } catch {}
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.topic === 'mm:feeds' && msg.data) {
              const { price, feedHealth } = msg.data;
              if (price && price.symbol) {
                setAggregatedRefPrices((prev) => ({ ...prev, [price.symbol]: price }));
                MMPriceFeedAggregatorService.ingestTicker({
                  provider: price.primaryProvider === 'bybit' ? 'bybit' : 'binance',
                  symbol: price.symbol,
                  lastPrice: price.finalPrice,
                  bidPrice: price.bidPrice,
                  askPrice: price.askPrice,
                  volume24h: 1200000000,
                  timestamp: price.lastUpdated || Date.now(),
                  latencyMs: 28,
                });
              }
              if (feedHealth) {
                if (feedHealth.fxRate) {
                  setFxRateConfig(feedHealth.fxRate);
                  MMPriceFeedAggregatorService.syncFxRate(feedHealth.fxRate);
                }
                setWorkerFeedHealth((prev) => ({
                  ...prev,
                  wsConnected: true,
                  binance: feedHealth.binance || prev.binance,
                  bybit: feedHealth.bybit || prev.bybit,
                }));
              }
            }
          } catch {}
        };

        ws.onerror = () => {
          setWorkerFeedHealth((prev) => ({
            ...prev,
            wsConnected: false,
            wsError: 'WebSocket stream reconnecting (REST fallback active)',
          }));
        };

        ws.onclose = () => {
          setWorkerFeedHealth((prev) => ({ ...prev, wsConnected: false }));
          if (!unmounted && !reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              connectWs();
            }, 4000);
          }
        };
      } catch (err: any) {
        setWorkerFeedHealth((prev) => ({
          ...prev,
          wsConnected: false,
          wsError: err?.message || 'WS connection failed',
        }));
      }
    };

    pollLiveFeeds();
    connectWs();
    const pollInterval = setInterval(pollLiveFeeds, 3000);

    return () => {
      unmounted = true;
      clearInterval(pollInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
    };
  }, []);

  // Helper: Execute a single quoting tick for one Quant MM Console bot into the real CLOB simulation
  const executeQuantBotTick = useCallback((bot: MMConsoleBot): { success: boolean; ordersPlaced: number; message: string } => {
    const current = stateRef.current;
    const pair = current.markets.find((m) => m.id === bot.targetMarketSymbol);
    if (!pair || !pair.isActive) {
      return { success: false, ordersPlaced: 0, message: `Market ${bot.targetMarketSymbol} inactive or not found` };
    }

    if (bot.riskProfile?.killSwitchActive) {
      return { success: false, ordersPlaced: 0, message: 'Kill switch active' };
    }

    const refSym = bot.mapping?.referenceMarketSymbol || 'BTCUSDT';
    const refAgg =
      current.aggregatedRefPrices?.[refSym] || MMPriceFeedAggregatorService.getAggregatedPrice(refSym);
    const currentFx =
      current.fxRateConfig?.usdtIdrRate || MMPriceFeedAggregatorService.getFxRate().usdtIdrRate || 18200;
    const refCurrent =
      refAgg && refAgg.finalPrice > 0
        ? refAgg.finalPrice
        : bot.mapping?.referenceAnchorPrice || 72450;

    const ladder = buildQuantBotLadder({
      bot,
      refCurrent,
      fxRateIdr: currentFx,
      pairLastPrice: pair.lastPrice,
      amountDecimals: pair.amountDecimals,
      priceDecimals: pair.priceDecimals,
      deterministic: false,
    });

    const botOwnerId = `bot_console_${bot.id}`;
    const now = Date.now();
    const prevMid = mmBotLastMidRef.current[bot.id] || 0;
    const minPriceDeltaBps = Math.max(1, bot.minPriceChangeBps || 10);
    const midChangeBps =
      prevMid > 0 ? (Math.abs(ladder.targetCalculatedMid - prevMid) / prevMid) * 10000 : Infinity;

    const currentBotOrders = current.restingOrders.filter(
      (o) => o.pair === pair.id && o.userId === botOwnerId && o.remainingAmount > 0
    );

    // Deadband stability: if bot already has healthy 2-sided quotes and mid moved < minPriceChangeBps, keep resting book stable
    if (!bot.dryRun && currentBotOrders.length >= 2 && midChangeBps < minPriceDeltaBps) {
      return {
        success: true,
        ordersPlaced: currentBotOrders.length,
        message: `Holding steady quotes on ${pair.id} (mid delta ${midChangeBps.toFixed(1)} bps < ${minPriceDeltaBps} bps deadband)`,
      };
    }

    // Non-crossing guard against user orders and walls on the same pair
    const preservedOrders = current.restingOrders.filter(
      (o) =>
        o.pair === pair.id &&
        o.userId !== botOwnerId &&
        !(o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
    );
    const highestOtherBid = preservedOrders
      .filter((o) => o.side === 'buy')
      .reduce((m, o) => Math.max(m, o.price), 0);
    const lowestOtherAsk = preservedOrders
      .filter((o) => o.side === 'sell')
      .reduce((m, o) => Math.min(m, o.price), Infinity);

    const safeBids = ladder.bidLevels.filter((b) => lowestOtherAsk === Infinity || b.price < lowestOtherAsk);
    const safeAsks = ladder.askLevels.filter((a) => highestOtherBid === 0 || a.price > highestOtherBid);

    const generatedOrders: BookOrder[] = [
      ...safeBids.map((b) => ({
        id: createUniqueId(`mmb_${bot.id.slice(-4)}`),
        userId: botOwnerId,
        pair: pair.id,
        side: 'buy' as const,
        price: b.price,
        amount: b.quantity,
        remainingAmount: b.quantity,
        createdAt: now,
        isMM: true,
        isWall: false,
        transactionType: 'limit' as const,
      })),
      ...safeAsks.map((a) => ({
        id: createUniqueId(`mma_${bot.id.slice(-4)}`),
        userId: botOwnerId,
        pair: pair.id,
        side: 'sell' as const,
        price: a.price,
        amount: a.quantity,
        remainingAmount: a.quantity,
        createdAt: now,
        isMM: true,
        isWall: false,
        transactionType: 'limit' as const,
      })),
    ];

    const maxOpenOrders = Math.max(1, bot.riskProfile?.maxOpenOrders ?? 20);

    if (!bot.dryRun) {
      mmBotLastMidRef.current[bot.id] = ladder.targetCalculatedMid;
      const antiStack = bot.riskProfile?.antiStackingActive ?? true;
      setRestingOrders((prev) => {
        const withoutLegacyMM = prev.filter(
          (o) => !(o.pair === pair.id && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
        );
        if (antiStack) {
          const next = [...withoutLegacyMM.filter((o) => o.userId !== botOwnerId), ...generatedOrders];
          stateRef.current.restingOrders = next;
          return next;
        }
        const existingBotOrders = withoutLegacyMM.filter((o) => o.userId === botOwnerId);
        const others = withoutLegacyMM.filter((o) => o.userId !== botOwnerId);
        const combined = [...existingBotOrders, ...generatedOrders].slice(-maxOpenOrders);
        const next = [...others, ...combined];
        stateRef.current.restingOrders = next;
        return next;
      });
    }

    setMmConsoleBots((prev) =>
      prev.map((b) =>
        b.id === bot.id
          ? {
              ...b,
              activeOpenOrdersCount: bot.dryRun ? 0 : generatedOrders.length,
              totalBidExposure: Math.round(ladder.totalBidValue),
              totalAskExposure: Math.round(ladder.totalAskValue),
              lastRepricedAt: now,
              errorMessage: ladder.warning,
              updatedAt: now,
            }
          : b
      )
    );

    return {
      success: generatedOrders.length > 0 || bot.dryRun,
      ordersPlaced: generatedOrders.length,
      message: ladder.warning
        ? `Deployed ${generatedOrders.length} orders on ${pair.id} (Mid: ${Math.round(ladder.targetCalculatedMid)}) — ${ladder.warning}`
        : `Deployed ${generatedOrders.length} orders on ${pair.id} (${safeBids.length} Bid / ${safeAsks.length} Ask @ Mid ${Math.round(ladder.targetCalculatedMid)})`,
    };
  }, []);

  // 7a-3. Continuous Background Execution Loop for Quant MM Console Bots
  useEffect(() => {
    if (settings.engineSpeed === 'paused') return;

    const timer = setInterval(() => {
      const botsList = mmConsoleBotsRef.current;
      const now = Date.now();

      for (const bot of botsList) {
        if (bot.status !== 'RUNNING' || bot.riskProfile?.killSwitchActive) continue;

        const minDelay = Math.max(500, bot.depthConfig?.delayMinMs ?? bot.minRepriceIntervalMs ?? 2000);
        const maxDelay = Math.max(minDelay, bot.depthConfig?.delayMaxMs ?? Math.max(minDelay, 4000));
        const lastRun = mmBotLastRunRef.current[bot.id] || 0;
        const targetDelay =
          maxDelay > minDelay ? minDelay + Math.floor(Math.random() * (maxDelay - minDelay)) : minDelay;

        if (lastRun === 0 || now - lastRun >= targetDelay) {
          mmBotLastRunRef.current[bot.id] = now;
          executeQuantBotTick(bot);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [settings.engineSpeed, executeQuantBotTick]);

  // 7b. Multi-Pair Concurrent Targeted Auto-Trade Execution Bots
  const hasEnabledAutoTrade = autoTradeBots.some((b) => b.enabled) || autoTradeConfig.enabled;
  useEffect(() => {
    if (settings.engineSpeed === 'paused' || !hasEnabledAutoTrade) {
      return;
    }

    const timer = setInterval(() => {
      const current = stateRef.current;
      const now = Date.now();
      const botsToRun =
        current.autoTradeBots.length > 0 ? current.autoTradeBots : [current.autoTradeConfig];

      let workingRestingOrders = current.restingOrders;
      let workingBalancesMap = { ...current.userBalancesMap };
      let anyExecution = false;
      const newTrades: Trade[] = [];
      const tradesByPairAdditions: Record<string, Trade[]> = {};
      const lastPriceUpdates: Record<string, { price: number; volumeDelta: number }> = {};
      const feeEventsAdded: AdminFeeEvent[] = [];
      const botStateUpdates: Record<string, Partial<AutoTradeConfig>> = {};

      for (const cfg of botsToRun) {
        if (!cfg.enabled) continue;
        const intervalMs = Math.max(1000, (cfg.intervalSeconds || 3) * 1000);
        const lastRun = autoTradeLastRunRef.current[cfg.targetPair] || 0;
        if (lastRun > 0 && now - lastRun < intervalMs) continue;
        autoTradeLastRunRef.current[cfg.targetPair] = now;

        const targetPair = current.markets.find((m) => m.id === cfg.targetPair);
        if (!targetPair || !targetPair.isActive) {
          botStateUpdates[cfg.targetPair] = { lastReason: 'MARKET_HALTED' };
          continue;
        }

        // Do NOT inject artificial balances into usr_autotrader_01; rely strictly on existing account wallets
        if (!workingBalancesMap['usr_autotrader_01']) {
          botStateUpdates[cfg.targetPair] = { lastReason: 'ACCOUNT_WALLET_MISSING' };
          continue;
        }

        const tickResult = executeAutoTradeTick(
          cfg,
          targetPair,
          workingRestingOrders,
          workingBalancesMap,
          'usr_autotrader_01'
        );

        if (tickResult.executed && tickResult.trade) {
          anyExecution = true;
          const trade = tickResult.trade;
          workingRestingOrders = tickResult.updatedRestingOrders;
          workingBalancesMap = tickResult.updatedBalancesMap;

          marketDataService.processTrade(trade);
          syncTradesToBackend([trade], targetPair);

          newTrades.push(trade);
          tradesByPairAdditions[targetPair.id] = [
            trade,
            ...(tradesByPairAdditions[targetPair.id] || []),
          ];
          lastPriceUpdates[targetPair.id] = {
            price: trade.price,
            volumeDelta: (lastPriceUpdates[targetPair.id]?.volumeDelta || 0) + trade.total,
          };

          if (tickResult.feeEvents && tickResult.feeEvents.length > 0) {
            feeEventsAdded.push(...tickResult.feeEvents);
          }

          const newVol = safeRound(
            cfg.accumulatedVolume + tickResult.accumulatedVolumeDelta,
            targetPair.amountDecimals
          );
          const shouldStop = cfg.autoStopOnTarget && newVol >= cfg.targetVolume;
          botStateUpdates[cfg.targetPair] = {
            accumulatedVolume: newVol,
            enabled: shouldStop ? false : cfg.enabled,
            lastExecutionTime: now,
            lastReason: shouldStop ? 'TARGET_VOLUME_REACHED' : undefined,
          };
        } else if (tickResult.reason) {
          const shouldAutoStop = tickResult.reason === 'TARGET_VOLUME_REACHED' && cfg.autoStopOnTarget;
          botStateUpdates[cfg.targetPair] = {
            enabled: shouldAutoStop ? false : cfg.enabled,
            lastReason: tickResult.reason,
          };
        }
      }

      if (anyExecution) {
        setRestingOrders(workingRestingOrders);
        setUserBalancesMap(workingBalancesMap);
        if (newTrades.length > 0) {
          setUserTrades((prev) => [...newTrades, ...prev]);
          setMarketTradesByPair((prevMap) => {
            const nextMap = { ...prevMap };
            for (const [pairId, added] of Object.entries(tradesByPairAdditions)) {
              const existing = nextMap[pairId] || [];
              nextMap[pairId] = [...added, ...existing].slice(0, 50);
            }
            return nextMap;
          });
        }
        if (Object.keys(lastPriceUpdates).length > 0) {
          setMarkets((prev) =>
            prev.map((m) => {
              const upd = lastPriceUpdates[m.id];
              if (!upd) return m;
              return {
                ...m,
                lastPrice: upd.price,
                high24h: Math.max(m.high24h, upd.price),
                low24h: Math.min(m.low24h, upd.price),
                volume24h: m.volume24h + upd.volumeDelta,
              };
            })
          );
        }
        if (feeEventsAdded.length > 0) {
          setAdminFeeVault((prev) => {
            let addIDR = 0;
            for (const evt of feeEventsAdded) {
              addIDR += evt.makerFee + evt.takerFee;
            }
            return {
              totalFeesIDR: prev.totalFeesIDR + addIDR,
              feesByAsset: {
                ...prev.feesByAsset,
                IDR: (prev.feesByAsset['IDR'] || 0) + addIDR,
              },
              recentEvents: [...feeEventsAdded, ...prev.recentEvents].slice(0, 80),
              lastUpdated: now,
            };
          });
        }
      }

      if (Object.keys(botStateUpdates).length > 0) {
        setAutoTradeBots((prev) =>
          prev.map((b) => (botStateUpdates[b.targetPair] ? { ...b, ...botStateUpdates[b.targetPair] } : b))
        );
        setAutoTradeConfig((prev) =>
          botStateUpdates[prev.targetPair] ? { ...prev, ...botStateUpdates[prev.targetPair] } : prev
        );
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [settings.engineSpeed, hasEnabledAutoTrade]);

  // 8. User Order Submission (Atomic CLOB Settlement & Fee Vault Routing)
  const submitOrder = useCallback(
    async (side: OrderSide, type: OrderType, amount: number, price: number) => {
      if (isSubmitting) {
        return { success: false, message: 'An order is already processing.' };
      }
      setIsSubmitting(true);

      try {
        const result = executeOrderAgainstCLOB(
          currentUser.id,
          activePair,
          side,
          type,
          amount,
          price,
          restingOrders,
          userBalancesMap
        );

        if (!result.success) {
          setAuditLogs((prev) => [
            {
              id: createUniqueId('log_rej'),
              actor: currentUser.name,
              action: 'ORDER_REJECTED',
              target: activePair.id,
              details: `Rejected ${type.toUpperCase()} ${side.toUpperCase()} of ${amount} ${activePair.baseAsset}: ${result.message}`,
              timestamp: Date.now(),
            },
            ...prev,
          ]);
          return { success: false, message: result.message };
        }

        // 1. Update multi-user balances ledger atomically
        setUserBalancesMap(result.updatedUserBalancesMap);

        // 2. Update user orders list
        setUserOrders((prev) => [result.order, ...prev]);

        // 3. Update resting orders in the CLOB
        setRestingOrders(result.updatedRestingOrders);

        // 4. Update trades and persistent candlestick service
        if (result.trades.length > 0) {
          setUserTrades((prev) => [...result.trades, ...prev]);
          setMarketTradesByPair((prevMap) => {
            const existing = prevMap[activePair.id] || [];
            return {
              ...prevMap,
              [activePair.id]: [...result.trades, ...existing.slice(0, 49)],
            };
          });

          // Process each trade into MarketDataService & backend SQLite + WS klines
          for (const trd of result.trades) {
            marketDataService.processTrade(trd);
          }
          syncTradesToBackend(result.trades, activePair);

          // Update market 24h stats
          setMarkets((prev) =>
            prev.map((m) =>
              m.id === activePair.id
                ? {
                    ...m,
                    lastPrice: result.executionPrice,
                    volume24h: m.volume24h + result.order.total,
                    high24h: Math.max(m.high24h, result.executionPrice),
                    low24h: Math.min(m.low24h, result.executionPrice),
                  }
                : m
            )
          );
        }

        // 5. Route trade fees directly to the Admin Fee Vault
        if (result.feeEvents && result.feeEvents.length > 0) {
          setAdminFeeVault((prev) => {
            let addIDR = 0;
            for (const evt of result.feeEvents) {
              addIDR += (evt.makerFee + evt.takerFee);
            }
            return {
              totalFeesIDR: prev.totalFeesIDR + addIDR,
              feesByAsset: {
                ...prev.feesByAsset,
                IDR: (prev.feesByAsset['IDR'] || 0) + addIDR,
              },
              recentEvents: [...result.feeEvents, ...prev.recentEvents].slice(0, 80),
              lastUpdated: Date.now(),
            };
          });
        }

        // 6. Audit Log
        setAuditLogs((prev) => [
          {
            id: createUniqueId('log_ord'),
            actor: currentUser.name,
            action: result.order.status === 'filled' ? 'CLOB_ORDER_FILLED' : 'CLOB_ORDER_RESTING',
            target: activePair.id,
            details: `${type.toUpperCase()} ${side.toUpperCase()} ${amount} ${activePair.baseAsset} (Status: ${result.order.status})`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);

        return { success: true, message: result.message };
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, currentUser.id, currentUser.name, activePair, restingOrders, userBalancesMap]
  );

  // 9. Cancel Order & Release Locked Funds
  const cancelOrderById = useCallback(
    (orderId: string) => {
      const current = stateRef.current;
      const latestResting = current.restingOrders;
      const latestUserOrders = current.userOrders;
      const latestBalancesMap = current.userBalancesMap;

      // 1. Check if wall order
      const wallOrder = latestResting.find((o) => o.id === orderId && o.isWall);
      if (wallOrder) {
        const nextResting = latestResting.filter((o) => o.id !== orderId);
        stateRef.current.restingOrders = nextResting;
        setRestingOrders(nextResting);
        setAuditLogs((prev) => [
          {
            id: createUniqueId('log_wall_cnc'),
            actor: currentUser.name,
            action: 'ORDER_WALL_CANCELLED',
            target: wallOrder.pair,
            details: `Cancelled active ${wallOrder.side.toUpperCase()} Wall of ${wallOrder.remainingAmount} @ Rp ${wallOrder.price.toLocaleString('id-ID')}`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        return { success: true, message: `Wall order @ Rp ${wallOrder.price.toLocaleString('id-ID')} successfully cancelled.` };
      }

      // 2. Check resting book order (user limit order or MM quote)
      const targetResting = latestResting.find((o) => o.id === orderId);
      if (targetResting) {
        const targetPairObj = current.markets.find((m) => m.id === targetResting.pair) || current.activePair;
        const cancelRes = cancelRestingOrderAndUnlockBalance(
          orderId,
          latestResting,
          latestBalancesMap,
          targetPairObj.makerFeeBps
        );

        if (cancelRes.success) {
          stateRef.current.restingOrders = cancelRes.updatedRestingOrders;
          stateRef.current.userBalancesMap = cancelRes.updatedBalancesMap;
          setRestingOrders(cancelRes.updatedRestingOrders);
          setUserBalancesMap(cancelRes.updatedBalancesMap);

          const nextUserOrders = latestUserOrders.map((o) =>
            o.id === orderId ? { ...o, status: 'cancelled' as OrderStatus, updatedAt: Date.now() } : o
          );
          stateRef.current.userOrders = nextUserOrders;
          setUserOrders(nextUserOrders);

          setAuditLogs((prev) => [
            {
              id: createUniqueId('log_cnc'),
              actor: currentUser.name,
              action: targetResting.isMM ? 'MM_ORDER_CANCELLED' : 'ORDER_CANCELLED_CLOB',
              target: targetResting.pair || targetPairObj.id,
              details: `Order #${orderId.slice(-6)} cancelled and removed from order book. Reserved funds released to available balance.`,
              timestamp: Date.now(),
            },
            ...prev,
          ]);

          return {
            success: true,
            message: cancelRes.message,
          };
        }
      }

      // 3. Fallback: Orphaned / already-removed open order in userOrders
      const targetUserOrder = latestUserOrders.find((o) => o.id === orderId);
      if (targetUserOrder && (targetUserOrder.status === 'open' || targetUserOrder.status === 'partially_filled')) {
        const targetPairObj = current.markets.find((m) => m.id === targetUserOrder.pair) || current.activePair;
        const updatedBalances: Record<string, Record<string, UserBalance>> = {};
        for (const [uId, uBal] of Object.entries(latestBalancesMap)) {
          updatedBalances[uId] = { ...uBal };
        }
        const uBal = updatedBalances[targetUserOrder.userId];
        if (uBal) {
          const baseAsset = targetUserOrder.pair.split('/')[0];
          const quoteAsset = targetUserOrder.pair.split('/')[1] || 'IDR';
          const feeRate = (targetPairObj.makerFeeBps || 10) / 10000;
          if (targetUserOrder.side === 'buy' && uBal[quoteAsset]) {
            const toUnlock = Math.min(
              uBal[quoteAsset].locked,
              Math.ceil(targetUserOrder.remainingAmount * targetUserOrder.price * (1 + feeRate))
            );
            uBal[quoteAsset] = {
              ...uBal[quoteAsset],
              locked: Math.max(0, uBal[quoteAsset].locked - toUnlock),
              free: Math.round(uBal[quoteAsset].free + toUnlock),
              total: uBal[quoteAsset].free + uBal[quoteAsset].locked,
            };
          } else if (targetUserOrder.side === 'sell' && uBal[baseAsset]) {
            const toUnlock = Math.min(uBal[baseAsset].locked, targetUserOrder.remainingAmount);
            uBal[baseAsset] = {
              ...uBal[baseAsset],
              locked: safeRound(Math.max(0, uBal[baseAsset].locked - toUnlock), 6),
              free: safeRound(uBal[baseAsset].free + toUnlock, 6),
              total: safeRound(uBal[baseAsset].free + uBal[baseAsset].locked, 6),
            };
          }
          stateRef.current.userBalancesMap = updatedBalances;
          setUserBalancesMap(updatedBalances);
        }

        const nextUserOrders = latestUserOrders.map((o) =>
          o.id === orderId ? { ...o, status: 'cancelled' as OrderStatus, remainingAmount: 0, updatedAt: Date.now() } : o
        );
        stateRef.current.userOrders = nextUserOrders;
        setUserOrders(nextUserOrders);

        setAuditLogs((prev) => [
          {
            id: createUniqueId('log_cnc_orphan'),
            actor: currentUser.name,
            action: 'ORDER_CANCELLED_CLOB',
            target: targetUserOrder.pair,
            details: `Order #${orderId.slice(-6)} cancelled and cleared from Open Orders.`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);

        return {
          success: true,
          message: `Order #${orderId.slice(-6)} successfully cancelled.`,
        };
      }

      // 4. If an MM order ID was already rotated/removed by a recent bot tick, clear gracefully
      return {
        success: true,
        message: `Order #${orderId.slice(-6)} already cleared or matched from active book.`,
      };
    },
    [currentUser.name]
  );

  // 10. MM Liquidity Controls
  const replenishLiquidity = useCallback(
    (targetPairId?: string, configOverride?: Partial<MMConfig | PairMMBotConfig>) => {
      const current = stateRef.current;
      const pair = targetPairId
        ? current.markets.find((m) => m.id === targetPairId) || current.activePair
        : current.activePair;
      const botCfg = current.pairMMBots[pair.id] || buildFallbackPairMMBot(pair.id, pair);
      const effectiveConfig = { ...botCfg, ...(configOverride || {}) };
      const pairWalls = current.restingOrders.filter((o) => o.pair === pair.id && o.isWall);
      const freshOrders = buildMMOrders(pair, pair.lastPrice, effectiveConfig, pairWalls);

      const nextResting = [
        ...current.restingOrders.filter(
          (o) => !(o.pair === pair.id && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
        ),
        ...freshOrders,
      ];
      stateRef.current.restingOrders = nextResting;
      setRestingOrders(nextResting);

      addMMBotLog({
        pair: pair.id,
        action: 'MM_LIQUIDITY_REPLENISHED',
        type: 'system',
        details: `Rebuilt 2-sided depth for ${pair.id}: ${freshOrders.length} quotes deployed respecting buy/sell boundaries.`,
      });
      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_mm_rep'),
          actor: 'Market Maker Bot',
          action: 'MM_LIQUIDITY_REPLENISHED',
          target: pair.id,
          details: `Rebuilt 2-sided order book depth for ${pair.id}: ${freshOrders.length} resting limit orders deployed while preserving support/resistance walls.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    },
    [buildFallbackPairMMBot, addMMBotLog]
  );

  const clearMMOrders = useCallback(
    (targetPairId?: string) => {
      const current = stateRef.current;
      const pId = targetPairId || current.activePair.id;
      const nextResting = current.restingOrders.filter(
        (o) => !(o.pair === pId && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
      );
      stateRef.current.restingOrders = nextResting;
      setRestingOrders(nextResting);

      addMMBotLog({
        pair: pId,
        action: 'MM_ORDERS_CLEARED',
        type: 'cancel',
        details: `Cleared all Dedicated Pair MM quotes for ${pId}. Liquidity walls preserved.`,
      });
      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_mm_clr'),
          actor: 'Market Maker Bot',
          action: 'MM_ORDERS_CLEARED',
          target: pId,
          details: `Removed all automated ladder quotes for ${pId}. Liquidity walls and organic orders preserved.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    },
    [addMMBotLog]
  );

  const updateMMConfig = useCallback((updates: Partial<MMConfig>) => {
    setMmConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const injectOrderWall = useCallback(
    (side: OrderSide, price: number, amount: number, targetPairId?: string) => {
      const pId = targetPairId || activePair.id;
      const targetPair = markets.find((m) => m.id === pId) || activePair;
      const newWall: BookOrder = {
        id: createUniqueId(`wall_${side}`),
        userId: 'bot_mm_wall',
        pair: pId,
        side,
        price,
        amount,
        remainingAmount: amount,
        createdAt: Date.now(),
        isMM: true,
        isWall: true,
      };
      setRestingOrders((prev) => [newWall, ...prev]);
      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_wall'),
          actor: 'Market Maker Bot',
          action: 'ORDER_WALL_INJECTED',
          target: pId,
          details: `Injected ${side.toUpperCase()} Wall: ${amount.toLocaleString('id-ID')} ${targetPair.baseAsset} @ Rp ${price.toLocaleString('id-ID')}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    },
    [activePair, markets]
  );

  const cancelOrderWall = useCallback(
    (orderId: string) => {
      const wall = restingOrders.find((o) => o.id === orderId && o.isWall);
      if (!wall) {
        return { success: false, message: 'Wall order not found or already filled.' };
      }
      setRestingOrders((prev) => prev.filter((o) => o.id !== orderId));
      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_wall_cnc'),
          actor: currentUser.name,
          action: 'ORDER_WALL_CANCELLED',
          target: wall.pair,
          details: `Cancelled active ${wall.side.toUpperCase()} Wall of ${wall.remainingAmount} @ Rp ${wall.price.toLocaleString('id-ID')}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      return { success: true, message: `Wall order @ Rp ${wall.price.toLocaleString('id-ID')} successfully cancelled.` };
    },
    [restingOrders, currentUser.name]
  );

  const clearAllWalls = useCallback(
    (targetPairId?: string) => {
      const pId = targetPairId || activePair.id;
      setRestingOrders((prev) => prev.filter((o) => !(o.pair === pId && o.isWall)));
      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_wall_clr_all'),
          actor: currentUser.name,
          action: 'ALL_ORDER_WALLS_CLEARED',
          target: pId,
          details: `Cleared all active support/resistance order walls for ${pId}.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    },
    [activePair.id, currentUser.name]
  );

  const cancelAllMMOrders = useCallback(
    (targetPairId?: string) => {
      const current = stateRef.current;
      const latestResting = current.restingOrders;
      let runningBalancesMap = current.userBalancesMap;

      const removedOrders: BookOrder[] = [];
      const nextResting: BookOrder[] = [];
      for (const o of latestResting) {
        const isTarget = targetPairId ? o.pair === targetPairId : true;
        if (isTarget && (o.isMM || o.isWall)) {
          removedOrders.push(o);
        } else {
          nextResting.push(o);
        }
      }

      // Unlock any locked balances belonging to removed MM orders
      let tempResting = [...latestResting];
      for (const rem of removedOrders) {
        const pairObj = current.markets.find((m) => m.id === rem.pair) || current.activePair;
        const res = cancelRestingOrderAndUnlockBalance(rem.id, tempResting, runningBalancesMap, pairObj.makerFeeBps);
        if (res.success) {
          tempResting = res.updatedRestingOrders;
          runningBalancesMap = res.updatedBalancesMap;
        }
      }

      const count = removedOrders.length;
      stateRef.current.restingOrders = nextResting;
      stateRef.current.userBalancesMap = runningBalancesMap;
      setRestingOrders(nextResting);
      setUserBalancesMap(runningBalancesMap);

      // Pause/Stop matching bots so cancelled MM orders stay cleared instead of respawning 1s later
      setPairMMBots((prev) => {
        const updated = { ...prev };
        for (const p of current.markets) {
          if (!targetPairId || p.id === targetPairId) {
            const existing = updated[p.id] || DEFAULT_PAIR_MM_BOTS[p.id];
            if (existing) updated[p.id] = { ...existing, enabled: false };
          }
        }
        return updated;
      });
      setFullMMConfigs((prev) => {
        const updated = { ...prev };
        for (const p of current.markets) {
          if (!targetPairId || p.id === targetPairId) {
            const existing = updated[p.id] || DEFAULT_FULL_MM_CONFIGS[p.id];
            if (existing) updated[p.id] = { ...existing, enabled: false, lifecycle_state: 'STOPPED' };
          }
        }
        return updated;
      });
      setMmConsoleBots((prev) =>
        prev.map((b) =>
          !targetPairId || b.targetMarketSymbol === targetPairId
            ? {
                ...b,
                status: 'PAUSED',
                activeOpenOrdersCount: 0,
                totalBidExposure: 0,
                totalAskExposure: 0,
                updatedAt: Date.now(),
              }
            : b
        )
      );

      const details = targetPairId
        ? `Cancelled all active MM orders & walls for ${targetPairId} (${count} orders removed, bots paused & frozen funds released).`
        : `Cancelled all active MM orders & walls across all markets (${count} orders removed, bots paused & frozen funds released).`;

      addMMBotLog({
        pair: targetPairId || 'ALL',
        action: 'CANCEL_ALL_MM_ORDERS',
        type: 'cancel',
        details,
      });

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_mm_cancel_all'),
          actor: currentUser.name,
          action: 'CANCEL_ALL_MM_ORDERS',
          target: targetPairId || 'ALL_MARKETS',
          details,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      return {
        success: true,
        count,
        message: details,
      };
    },
    [currentUser.name, addMMBotLog]
  );

  const updatePairMMBot = useCallback(
    (pairId: string, updates: Partial<PairMMBotConfig>) => {
      const current = stateRef.current;
      const pairObj = current.markets.find((m) => m.id === pairId);
      const existingBot = current.pairMMBots?.[pairId] || buildFallbackPairMMBot(pairId, pairObj);
      const nextBot: PairMMBotConfig = { ...existingBot, ...updates, pair: pairId };

      const nextPairMMBots = {
        ...(current.pairMMBots || {}),
        [pairId]: nextBot,
      };
      stateRef.current.pairMMBots = nextPairMMBots;
      setPairMMBots(nextPairMMBots);

      const existingFull = current.fullMMConfigs?.[pairId] || buildFallbackFullMMConfig(pairId, pairObj);
      const nextFull: FullMMConfig = {
        ...existingFull,
        order_count: nextBot.levelsPerSide ?? existingFull.order_count,
        min_order_quantity: nextBot.baseAmountPerLevel ?? existingFull.min_order_quantity,
        max_order_quantity: Math.max(nextBot.baseAmountPerLevel ?? 1, existingFull.max_order_quantity),
        cs_max_book_spread_pct:
          nextBot.targetSpreadBps > 0 ? nextBot.targetSpreadBps / 100 : existingFull.cs_max_book_spread_pct,
        quote_interval_ms: (nextBot.frequencySec || 3) * 1000,
      };
      const nextFullMap = {
        ...(current.fullMMConfigs || {}),
        [pairId]: nextFull,
      };
      stateRef.current.fullMMConfigs = nextFullMap;
      setFullMMConfigs(nextFullMap);

      // Immediately refresh active book quotes if bot is running and market is active
      const isRunning = nextBot.enabled && nextFull.enabled && !nextFull.emergency_stop && (pairObj?.isActive ?? true);
      if (isRunning && pairObj) {
        const pairWalls = current.restingOrders.filter((o) => o.pair === pairId && o.isWall);
        const freshQuotes = buildMMOrders(pairObj, pairObj.lastPrice, nextBot, pairWalls);
        const nextResting = [
          ...current.restingOrders.filter(
            (o) => !(o.pair === pairId && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
          ),
          ...freshQuotes,
        ];
        stateRef.current.restingOrders = nextResting;
        setRestingOrders(nextResting);
      }
    },
    [buildFallbackPairMMBot, buildFallbackFullMMConfig]
  );

  const toggleMMBot = useCallback(
    (pairId: string, enabled?: boolean) => {
      const current = stateRef.current;
      const pairObj = current.markets.find((m) => m.id === pairId);
      const existingBot = current.pairMMBots?.[pairId] || buildFallbackPairMMBot(pairId, pairObj);
      const existingFull = current.fullMMConfigs?.[pairId] || buildFallbackFullMMConfig(pairId, pairObj);

      const currentlyRunning =
        existingBot.enabled && existingFull.enabled && !existingFull.emergency_stop;
      const nextEnabled = enabled !== undefined ? enabled : !currentlyRunning;

      const nextBot: PairMMBotConfig = { ...existingBot, enabled: nextEnabled, pair: pairId };
      const nextPairMMBots = {
        ...(current.pairMMBots || {}),
        [pairId]: nextBot,
      };
      stateRef.current.pairMMBots = nextPairMMBots;
      setPairMMBots(nextPairMMBots);

      const nextFullMMConfigs = {
        ...(current.fullMMConfigs || {}),
        [pairId]: {
          ...existingFull,
          enabled: nextEnabled,
          emergency_stop: nextEnabled ? false : existingFull.emergency_stop,
          lifecycle_state: (nextEnabled ? 'RUNNING' : 'STOPPED') as FullMMConfig['lifecycle_state'],
        },
      };
      stateRef.current.fullMMConfigs = nextFullMMConfigs;
      setFullMMConfigs(nextFullMMConfigs);

      if (!nextEnabled) {
        // Immediately purge all active automated quotes for this pair when stopped
        const nextResting = current.restingOrders.filter(
          (o) => !(o.pair === pairId && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
        );
        stateRef.current.restingOrders = nextResting;
        setRestingOrders(nextResting);

        addMMBotLog({
          pair: pairId,
          action: 'PAIR_BOT_STOPPED',
          type: 'cancel',
          details: `Dedicated Pair Liquidity Bot for ${pairId} STOPPED. All resting MM quotes removed.`,
        });
      } else {
        if (pairObj && pairObj.isActive) {
          const pairWalls = current.restingOrders.filter((o) => o.pair === pairId && o.isWall);
          const freshQuotes = buildMMOrders(pairObj, pairObj.lastPrice, nextBot, pairWalls);
          const nextResting = [
            ...current.restingOrders.filter(
              (o) => !(o.pair === pairId && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
            ),
            ...freshQuotes,
          ];
          stateRef.current.restingOrders = nextResting;
          setRestingOrders(nextResting);
        }

        addMMBotLog({
          pair: pairId,
          action: 'PAIR_BOT_STARTED',
          type: 'system',
          details: `Dedicated Pair Liquidity Bot for ${pairId} STARTED. Deployed automated 2-sided quotes.`,
        });
      }
    },
    [buildFallbackPairMMBot, buildFallbackFullMMConfig, addMMBotLog]
  );

  const stopAllPairMMBots = useCallback(() => {
    const current = stateRef.current;
    const nextPairBots: Record<string, PairMMBotConfig> = { ...(current.pairMMBots || {}) };
    const nextFullConfigs: Record<string, FullMMConfig> = { ...(current.fullMMConfigs || {}) };

    for (const pair of current.markets) {
      const baseBot = nextPairBots[pair.id] || buildFallbackPairMMBot(pair.id, pair);
      nextPairBots[pair.id] = { ...baseBot, enabled: false };

      const baseFull = nextFullConfigs[pair.id] || buildFallbackFullMMConfig(pair.id, pair);
      nextFullConfigs[pair.id] = { ...baseFull, enabled: false, lifecycle_state: 'STOPPED' };
    }

    stateRef.current.pairMMBots = nextPairBots;
    stateRef.current.fullMMConfigs = nextFullConfigs;
    setPairMMBots(nextPairBots);
    setFullMMConfigs(nextFullConfigs);

    const removedCount = current.restingOrders.filter(
      (o) => o.isMM && !o.isWall && !o.userId.startsWith('bot_console_')
    ).length;
    const nextResting = current.restingOrders.filter(
      (o) => !(o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
    );
    stateRef.current.restingOrders = nextResting;
    setRestingOrders(nextResting);

    const msg = `All Dedicated Pair Liquidity Bots stopped (${current.markets.length} pairs) and ${removedCount} resting MM quotes cleared.`;
    addMMBotLog({
      pair: 'ALL',
      action: 'STOP_ALL_PAIR_BOTS',
      type: 'cancel',
      details: msg,
    });
    setAuditLogs((prev) => [
      {
        id: createUniqueId('log_stop_all_pair_bots'),
        actor: currentUser.name,
        action: 'STOP_ALL_PAIR_BOTS',
        target: 'ALL_MARKETS',
        details: msg,
        timestamp: Date.now(),
      },
      ...prev,
    ]);

    return { success: true, count: removedCount, message: msg };
  }, [currentUser.name, buildFallbackPairMMBot, buildFallbackFullMMConfig, addMMBotLog]);

  const startAllPairMMBots = useCallback(() => {
    const current = stateRef.current;
    const nextPairBots: Record<string, PairMMBotConfig> = { ...(current.pairMMBots || {}) };
    const nextFullConfigs: Record<string, FullMMConfig> = { ...(current.fullMMConfigs || {}) };

    const preservedOrders = current.restingOrders.filter(
      (o) => !(o.isMM && !o.isWall && !o.userId.startsWith('bot_console_'))
    );
    const allNewQuotes: BookOrder[] = [];
    let startedCount = 0;

    for (const pair of current.markets) {
      if (!pair.isActive) continue;
      startedCount += 1;
      const baseBot = nextPairBots[pair.id] || buildFallbackPairMMBot(pair.id, pair);
      const nextBot = { ...baseBot, enabled: true };
      nextPairBots[pair.id] = nextBot;

      const baseFull = nextFullConfigs[pair.id] || buildFallbackFullMMConfig(pair.id, pair);
      nextFullConfigs[pair.id] = {
        ...baseFull,
        enabled: true,
        emergency_stop: false,
        lifecycle_state: 'RUNNING',
      };

      const pairWalls = preservedOrders.filter((o) => o.pair === pair.id && o.isWall);
      allNewQuotes.push(...buildMMOrders(pair, pair.lastPrice, nextBot, pairWalls));
    }

    stateRef.current.pairMMBots = nextPairBots;
    stateRef.current.fullMMConfigs = nextFullConfigs;
    const nextResting = [...preservedOrders, ...allNewQuotes];
    stateRef.current.restingOrders = nextResting;
    setPairMMBots(nextPairBots);
    setFullMMConfigs(nextFullConfigs);
    setRestingOrders(nextResting);

    const msg = `Started ${startedCount} active Dedicated Pair Liquidity Bots and deployed ${allNewQuotes.length} quotes.`;
    addMMBotLog({
      pair: 'ALL',
      action: 'START_ALL_PAIR_BOTS',
      type: 'system',
      details: msg,
    });
    setAuditLogs((prev) => [
      {
        id: createUniqueId('log_start_all_pair_bots'),
        actor: currentUser.name,
        action: 'START_ALL_PAIR_BOTS',
        target: 'ALL_MARKETS',
        details: msg,
        timestamp: Date.now(),
      },
      ...prev,
    ]);

    return { success: true, count: startedCount, message: msg };
  }, [currentUser.name, buildFallbackPairMMBot, buildFallbackFullMMConfig, addMMBotLog]);

  const upsertAutoTradeBot = useCallback((config: AutoTradeConfig) => {
    const normalized: AutoTradeConfig = {
      ...DEFAULT_AUTO_TRADE_CONFIG,
      ...config,
      id: config.id || `autotrade_${config.targetPair.replace(/[^A-Z0-9]/gi, '_')}`,
    };
    setAutoTradeBots((prev) => {
      const idx = prev.findIndex((b) => b.targetPair === normalized.targetPair);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = normalized;
        return next;
      }
      return [...prev, normalized];
    });
    setAutoTradeConfig(normalized);
  }, []);

  const updateAutoTradeBotByPair = useCallback((targetPair: string, updates: Partial<AutoTradeConfig>) => {
    setAutoTradeBots((prev) => {
      const idx = prev.findIndex((b) => b.targetPair === targetPair);
      if (idx >= 0) {
        const updated = { ...prev[idx], ...updates };
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [
        ...prev,
        {
          ...DEFAULT_AUTO_TRADE_CONFIG,
          targetPair,
          id: `autotrade_${targetPair.replace(/[^A-Z0-9]/gi, '_')}`,
          ...updates,
        },
      ];
    });
    setAutoTradeConfig((prev) => (prev.targetPair === targetPair ? { ...prev, ...updates } : prev));
  }, []);

  const toggleAutoTradeBotByPair = useCallback((targetPair: string, enabled?: boolean) => {
    setAutoTradeBots((prev) => {
      const idx = prev.findIndex((b) => b.targetPair === targetPair);
      if (idx >= 0) {
        const curr = prev[idx];
        const nextEnabled = enabled !== undefined ? enabled : !curr.enabled;
        const next = [...prev];
        next[idx] = { ...curr, enabled: nextEnabled, lastReason: nextEnabled ? undefined : curr.lastReason };
        return next;
      }
      const created: AutoTradeConfig = {
        ...DEFAULT_AUTO_TRADE_CONFIG,
        targetPair,
        id: `autotrade_${targetPair.replace(/[^A-Z0-9]/gi, '_')}`,
        enabled: enabled !== undefined ? enabled : true,
      };
      return [...prev, created];
    });
    setAutoTradeConfig((prev) => {
      if (prev.targetPair !== targetPair) return prev;
      const nextEnabled = enabled !== undefined ? enabled : !prev.enabled;
      return { ...prev, enabled: nextEnabled };
    });
  }, []);

  const resetAutoTradeBotVolumeByPair = useCallback((targetPair: string) => {
    setAutoTradeBots((prev) =>
      prev.map((b) => (b.targetPair === targetPair ? { ...b, accumulatedVolume: 0, lastReason: undefined } : b))
    );
    setAutoTradeConfig((prev) => (prev.targetPair === targetPair ? { ...prev, accumulatedVolume: 0 } : prev));
  }, []);

  const removeAutoTradeBot = useCallback((targetPair: string) => {
    setAutoTradeBots((prev) => prev.filter((b) => b.targetPair !== targetPair));
  }, []);

  const stopAllAutoTradeBots = useCallback(() => {
    setAutoTradeBots((prev) => prev.map((b) => ({ ...b, enabled: false })));
    setAutoTradeConfig((prev) => ({ ...prev, enabled: false }));
  }, []);

  const updateAutoTradeConfig = useCallback((updates: Partial<AutoTradeConfig>) => {
    setAutoTradeConfig((prev) => {
      const current = prev || DEFAULT_AUTO_TRADE_CONFIG;
      const nextPair = updates.targetPair || current.targetPair;
      const switchingPair = updates.targetPair && updates.targetPair !== current.targetPair;
      if (switchingPair) {
        const existingForPair = stateRef.current.autoTradeBots.find((b) => b.targetPair === nextPair);
        if (existingForPair) {
          const mergedExisting = { ...existingForPair, ...updates, targetPair: nextPair };
          return mergedExisting;
        }
        const pairObj = stateRef.current.markets.find((m) => m.id === nextPair);
        const minAmt = pairObj?.minOrderAmount || 0.01;
        const freshForPair: AutoTradeConfig = {
          ...current,
          ...updates,
          id: `autotrade_${nextPair.replace(/[^A-Z0-9]/gi, '_')}`,
          targetPair: nextPair,
          enabled: false,
          accumulatedVolume: 0,
          minOrderSize: updates.minOrderSize ?? (minAmt < 1 ? minAmt * 5 : 10),
          maxOrderSize: updates.maxOrderSize ?? (minAmt < 1 ? minAmt * 50 : 100),
          targetVolume: updates.targetVolume ?? (minAmt < 1 ? minAmt * 500 : 10000),
        };
        setAutoTradeBots((bots) =>
          bots.some((b) => b.targetPair === nextPair) ? bots : [...bots, freshForPair]
        );
        return freshForPair;
      }
      const nextCfg = { ...current, ...updates };
      setAutoTradeBots((bots) => {
        const idx = bots.findIndex((b) => b.targetPair === nextCfg.targetPair);
        if (idx >= 0) {
          const next = [...bots];
          next[idx] = { ...next[idx], ...nextCfg };
          return next;
        }
        return [...bots, { ...nextCfg, id: `autotrade_${nextCfg.targetPair.replace(/[^A-Z0-9]/gi, '_')}` }];
      });
      return nextCfg;
    });
  }, []);

  const toggleAutoTrade = useCallback((enabled?: boolean) => {
    setAutoTradeConfig((prev) => {
      const current = prev || DEFAULT_AUTO_TRADE_CONFIG;
      const nextEnabled = enabled !== undefined ? enabled : !current.enabled;
      const next = {
        ...current,
        enabled: nextEnabled,
      };
      setAutoTradeBots((bots) => {
        const idx = bots.findIndex((b) => b.targetPair === next.targetPair);
        if (idx >= 0) {
          const copy = [...bots];
          copy[idx] = { ...copy[idx], enabled: nextEnabled };
          return copy;
        }
        return [...bots, { ...next, id: `autotrade_${next.targetPair.replace(/[^A-Z0-9]/gi, '_')}` }];
      });
      return next;
    });
  }, []);

  const resetAutoTradeVolume = useCallback(() => {
    setAutoTradeConfig((prev) => {
      const next = { ...prev, accumulatedVolume: 0 };
      setAutoTradeBots((bots) =>
        bots.map((b) => (b.targetPair === prev.targetPair ? { ...b, accumulatedVolume: 0 } : b))
      );
      return next;
    });
  }, []);

  const injectAutomatedLimitOrders = useCallback(
    (
      targetPairId: string,
      spreadPct: number,
      orderFrequencySeconds: number,
      orderAmountSize: number,
      depthLevels: number,
      tighten: boolean = false
    ) => {
      const pair = markets.find((m) => m.id === targetPairId) || activePair;
      const res = injectProgrammaticLimitOrders({
        botUserId: 'bot_market_maker',
        pair,
        spreadPct,
        orderFrequencySeconds,
        orderAmountSize,
        depthLevels,
        botBalances,
        restingOrders,
        orderLedger: userOrders,
        tightenSpread: tighten,
        clearExistingBotOrders: true,
      });

      setBotBalances(res.updatedBotBalances);
      setRestingOrders(res.updatedRestingOrders);
      setUserOrders(res.updatedLedger);

      if (res.executedTrades.length > 0) {
        setUserTrades((prev) => [...res.executedTrades, ...prev]);
        setMarketTradesByPair((prevMap) => {
          const existing = prevMap[pair.id] || [];
          return {
            ...prevMap,
            [pair.id]: [...res.executedTrades, ...existing.slice(0, 49)],
          };
        });

        for (const trd of res.executedTrades) {
          marketDataService.processTrade(trd);
        }
        syncTradesToBackend(res.executedTrades, pair);

        const lastTrade = res.executedTrades[res.executedTrades.length - 1];
        setMarkets((prev) =>
          prev.map((m) => {
            if (m.id !== pair.id) return m;
            return {
              ...m,
              lastPrice: lastTrade.price,
              high24h: Math.max(m.high24h, lastTrade.price),
              low24h: Math.min(m.low24h, lastTrade.price),
            };
          })
        );
      }

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_bot_inj'),
          actor: 'Market Maker Bot',
          action: 'PROGRAMMATIC_LIMIT_ORDERS_INJECTED',
          target: pair.id,
          details: `Injected ${res.placedOrders.length} limit orders (${res.totalBidsDeployed} Bids, ${res.totalAsksDeployed} Asks) at ${spreadPct}% spread. ${res.executedTrades.length} crossing trades executed against ledger. Depth updated.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      return {
        success: res.success,
        message: res.message,
        tradesCount: res.executedTrades.length,
        ordersCount: res.placedOrders.length,
      };
    },
    [markets, activePair, botBalances, restingOrders, userOrders]
  );

  const depositBotBalance = useCallback((asset: string, amount: number) => {
    setBotBalances((prev) => {
      const current = prev[asset] || { asset, free: 0, locked: 0, total: 0 };
      const newFree = current.free + amount;
      return {
        ...prev,
        [asset]: {
          ...current,
          free: newFree,
          total: newFree + current.locked,
        },
      };
    });
    setAuditLogs((prev) => [
      {
        id: createUniqueId('log_bot_faucet'),
        actor: 'Admin Capital Injection',
        action: 'BOT_CAPITAL_DEPOSITED',
        target: asset,
        details: `Deposited ${amount.toLocaleString('id-ID')} ${asset} to Market Maker Bot liquidity inventory.`,
        timestamp: Date.now(),
      },
      ...prev,
    ]);
  }, []);

  // 11. Profile & Helpers
  const switchUser = useCallback((userId: string) => {
    const found = DEMO_USERS.find((u) => u.id === userId);
    if (found) setCurrentUser(found);
  }, []);

  const registerDemoUser = useCallback((name: string, email: string) => {
    const newUser: UserProfile = {
      id: createUniqueId('usr_demo'),
      name,
      email,
      role: 'trader',
      avatarUrl: '/src/assets/images/avatar_demo_trader_1792254529026.jpg',
      tier: 'Standard Demo Trader',
      createdAt: Date.now(),
    };
    setCurrentUser(newUser);
  }, []);

  const depositVirtualFaucet = useCallback(
    (asset: string, amount: number) => {
      setUserBalancesMap((prevMap) => {
        const userBal = prevMap[currentUser.id] || balances;
        const current = userBal[asset] || { asset, free: 0, locked: 0, total: 0 };
        const newFree = current.free + amount;
        return {
          ...prevMap,
          [currentUser.id]: {
            ...userBal,
            [asset]: {
              ...current,
              free: newFree,
              total: newFree + current.locked,
            },
          },
        };
      });
      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_usr_faucet'),
          actor: currentUser.name,
          action: 'DEMO_FAUCET_DEPOSIT',
          target: asset,
          details: `Deposited ${amount.toLocaleString('id-ID')} ${asset} to virtual portfolio.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    },
    [currentUser.id, currentUser.name, balances]
  );

  const updateMarketConfig = useCallback((pairId: string, updates: Partial<MarketPair>) => {
    setMarkets((prev) =>
      prev.map((m) => {
        if (m.id !== pairId) return m;
        const next = { ...m, ...updates };
        syncPairToBackend(next);
        return next;
      })
    );
  }, []);

  const updateSettings = useCallback((updates: Partial<SimulationSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetSimulationData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    marketDataService.resetHistory(DEFAULT_MARKETS);
    const initialMap: Record<string, Record<string, UserBalance>> = {};
    for (const [userId, userAssets] of Object.entries(MULTI_USER_INITIAL_BALANCES)) {
      initialMap[userId] = {};
      for (const [asset, b] of Object.entries(userAssets)) {
        initialMap[userId][asset] = {
          asset,
          free: b.free,
          locked: b.locked,
          total: b.free + b.locked,
        };
      }
    }
    setUserBalancesMap(initialMap);
    setBotBalances(INITIAL_BOT_BALANCES);
    setAdminFeeVault(INITIAL_ADMIN_FEE_VAULT);
    setMarkets(DEFAULT_MARKETS);
    setUserOrders([]);
    setUserTrades([]);
    setCurrentUser(DEMO_USERS[0]);
    const initialTrades: Record<string, Trade[]> = {};
    DEFAULT_MARKETS.forEach((pair) => {
      initialTrades[pair.id] = generateInitialTrades(pair.id, pair.lastPrice, 15);
    });
    setMarketTradesByPair(initialTrades);

    const seeded: BookOrder[] = [];
    DEFAULT_MARKETS.forEach((pair) => {
      const fullCfg = DEFAULT_FULL_MM_CONFIGS[pair.id] || DEFAULT_FULL_MM_CONFIGS['DNA/IDR'];
      seeded.push(...generateInstitutionalMMQuotes(pair, fullCfg, []));
    });
    setRestingOrders(seeded);
    setMmConfig(DEFAULT_DNA_MM_CONFIG);
    setFullMMConfigs(DEFAULT_FULL_MM_CONFIGS);
    setPairMMBots(DEFAULT_PAIR_MM_BOTS);
    setAutoTradeConfig(DEFAULT_AUTO_TRADE_CONFIG);
    setAutoTradeBots([{ ...DEFAULT_AUTO_TRADE_CONFIG, id: 'autotrade_DNA_IDR' }]);
    setInitialListings(DEFAULT_INITIAL_LISTINGS);
    setCustomNetworksMap({});
    setDepositHistory([]);
    setWithdrawalHistory([]);
  }, []);

  const toggleFavoritePair = useCallback((pairId: string) => {
    setMarkets((prev) =>
      prev.map((m) => (m.id === pairId ? { ...m, isFavorite: !m.isFavorite } : m))
    );
  }, []);

  const selectPair = useCallback((pairId: string) => {
    setActivePairId(pairId);
  }, []);

  // Listing Lifecycle Handlers
  const createDraftListing = useCallback((draftData: Partial<InitialListing>) => {
    const symbol = draftData.symbol || 'NEW/IDR';
    const id = `list_${symbol.replace('/', '_').toLowerCase()}_${Date.now()}`;
    const newListing: InitialListing = {
      id,
      symbol,
      base_asset: draftData.base_asset || symbol.split('/')[0],
      quote_asset: draftData.quote_asset || 'IDR',
      name: draftData.name || symbol,
      category: draftData.category || 'DEFI',
      status: 'DRAFT',
      mm_preparation_phase: 'NOT_STARTED',
      trading_status: 'CLOSED',
      deposit_status: 'CLOSED',
      withdrawal_status: 'CLOSED',
      visibility: 'HIDDEN',
      initial_price: draftData.initial_price || 10000,
      price_precision: draftData.price_precision ?? 0,
      amount_precision: draftData.amount_precision ?? 2,
      min_order_amount: draftData.min_order_amount ?? 1,
      maker_fee_bps: draftData.maker_fee_bps ?? 10,
      taker_fee_bps: draftData.taker_fee_bps ?? 15,
      assigned_mm_account: draftData.assigned_mm_account || 'usr_mm_01',
      schedule: draftData.schedule || {
        announcement_at: Date.now(),
        mm_funding_opens_at: Date.now() + 3600000,
        mm_setup_opens_at: Date.now() + 7200000,
        public_trading_opens_at: Date.now() + 10800000,
        deposit_opens_at: Date.now() + 3600000,
        withdrawal_opens_at: Date.now() + 86400000,
        new_badge_expires_at: Date.now() + 86400000 * 3,
        min_base_inventory: 1000,
        min_quote_inventory: 50000000,
        target_spread_bps: 30,
        min_depth_levels: 4,
        schedule_version: 1,
      },
      created_at: Date.now(),
      updated_at: Date.now(),
      audit_trail: [
        {
          id: createUniqueId('evt_draft'),
          listing_id: id,
          event_type: 'DRAFT_CREATED',
          previous_state: 'NONE',
          new_state: 'DRAFT',
          actor_id: currentUser.id,
          timestamp: Date.now(),
          schedule_version: 1,
        },
      ],
    };

    setInitialListings((prev) => [newListing, ...prev]);
    return { success: true, listing: newListing };
  }, [currentUser.id]);

  const submitForReview = useCallback((listingId: string) => {
    let found = false;
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          found = true;
          return {
            ...l,
            status: 'UNDER_REVIEW',
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_rev'),
                listing_id: l.id,
                event_type: 'STATUS_CHANGED',
                previous_state: l.status,
                new_state: 'UNDER_REVIEW',
                actor_id: currentUser.id,
                timestamp: Date.now(),
                schedule_version: l.schedule.schedule_version,
              },
            ],
          };
        }
        return l;
      })
    );
    return found ? { success: true } : { success: false, error: 'Listing not found' };
  }, [currentUser.id]);

  const returnToDraft = useCallback((listingId: string, reason: string) => {
    let found = false;
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          found = true;
          return {
            ...l,
            status: 'DRAFT',
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_rtd'),
                listing_id: l.id,
                event_type: 'RETURNED_TO_DRAFT',
                previous_state: l.status,
                new_state: 'DRAFT',
                actor_id: currentUser.id,
                timestamp: Date.now(),
                schedule_version: l.schedule.schedule_version,
                metadata: { reason },
              },
            ],
          };
        }
        return l;
      })
    );
    return found ? { success: true } : { success: false, error: 'Listing not found' };
  }, [currentUser.id]);

  const approveListing = useCallback((listingId: string, approvedBy: string, reviewNotes?: string) => {
    let found = false;
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          found = true;
          return {
            ...l,
            status: 'APPROVED',
            visibility: 'HIDDEN',
            trading_status: 'CLOSED',
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_app'),
                listing_id: l.id,
                event_type: 'LISTING_APPROVED',
                previous_state: l.status,
                new_state: 'APPROVED',
                actor_id: approvedBy,
                timestamp: Date.now(),
                schedule_version: l.schedule.schedule_version,
                metadata: { reviewNotes },
              },
            ],
          };
        }
        return l;
      })
    );
    return found ? { success: true } : { success: false, error: 'Listing not found' };
  }, []);

  const rejectListing = useCallback((listingId: string, reason: string) => {
    let found = false;
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          found = true;
          return {
            ...l,
            status: 'CANCELLED',
            trading_status: 'CLOSED',
            visibility: 'HIDDEN',
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_rej'),
                listing_id: l.id,
                event_type: 'LISTING_REJECTED',
                previous_state: l.status,
                new_state: 'CANCELLED',
                actor_id: currentUser.id,
                timestamp: Date.now(),
                schedule_version: l.schedule.schedule_version,
                metadata: { reason },
              },
            ],
          };
        }
        return l;
      })
    );
    return found ? { success: true } : { success: false, error: 'Listing not found' };
  }, [currentUser.id]);

  const scheduleListing = useCallback((listingId: string, newSchedule: InitialListingSchedule, reason?: string) => {
    const listing = initialListings.find((l) => l.id === listingId);
    if (!listing) return { success: false, error: 'Listing not found.' };
    if (listing.status !== 'APPROVED' && listing.status !== 'SCHEDULED') {
      return { success: false, error: 'Listing must be APPROVED before scheduling' };
    }
    const { mm_funding_opens_at, mm_setup_opens_at, public_trading_opens_at } = newSchedule;
    if (mm_funding_opens_at > mm_setup_opens_at || mm_setup_opens_at >= public_trading_opens_at) {
      return { success: false, error: 'Invalid timeline: MM funding must open before/with MM setup, and MM setup must be prior to public trading.' };
    }

    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          const nextVersion = (l.schedule?.schedule_version || 1) + 1;
          const updatedSchedule = { ...newSchedule, schedule_version: nextVersion };
          return {
            ...l,
            status: 'SCHEDULED',
            visibility: 'UPCOMING',
            schedule: updatedSchedule,
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_sched'),
                listing_id: l.id,
                event_type: 'SCHEDULE_CREATED',
                previous_state: l.status,
                new_state: 'SCHEDULED',
                actor_id: currentUser.id,
                timestamp: Date.now(),
                schedule_version: nextVersion,
                metadata: { reason },
              },
            ],
          };
        }
        return l;
      })
    );
    return { success: true };
  }, [initialListings, currentUser.id]);

  const rescheduleListing = useCallback((listingId: string, newSchedule: Partial<InitialListingSchedule>, reason: string) => {
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          const nextSchedule = {
            ...l.schedule,
            ...newSchedule,
            schedule_version: l.schedule.schedule_version + 1,
          };
          return {
            ...l,
            schedule: nextSchedule,
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_resc'),
                listing_id: l.id,
                event_type: 'SCHEDULE_RESCHEDULED',
                previous_state: l.status,
                new_state: l.status,
                actor_id: currentUser.id,
                timestamp: Date.now(),
                schedule_version: nextSchedule.schedule_version,
                metadata: { reason, newSchedule },
              },
            ],
          };
        }
        return l;
      })
    );
    return { success: true };
  }, [currentUser.id]);

  const pauseListing = useCallback((listingId: string, reason: string) => {
    let found = false;
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          found = true;
          return {
            ...l,
            status: 'PAUSED',
            trading_status: 'HALTED',
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_pause'),
                listing_id: l.id,
                event_type: 'TRADING_HALTED',
                previous_state: l.status,
                new_state: 'PAUSED',
                actor_id: currentUser.id,
                timestamp: Date.now(),
                schedule_version: l.schedule.schedule_version,
                metadata: { reason },
              },
            ],
          };
        }
        return l;
      })
    );
    return found ? { success: true } : { success: false, error: 'Listing not found' };
  }, [currentUser.id]);

  const allocateTreasuryFunding = useCallback((listingId: string, asset: string, amount: number) => {
    const listing = initialListings.find((l) => l.id === listingId);
    if (!listing) return { success: false, error: 'Listing not found.' };

    const targetMMAccount = listing.assigned_mm_account || 'usr_mm_01';
    const idempotencyKey = `alloc_${listingId}_${asset}_${Date.now()}`;

    const res = LedgerService.allocateTreasuryToMM({
      sourceAccount: 'usr_treasury_01',
      targetMMAccount,
      asset,
      amount,
      listingId,
      actorId: currentUser.id,
      idempotencyKey,
      userBalancesMap,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    setUserBalancesMap(res.updatedBalancesMap);
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          const evt: ListingEvent = {
            id: createUniqueId('evt_fund'),
            listing_id: l.id,
            event_type: 'MM_TREASURY_ALLOCATED',
            previous_state: l.mm_preparation_phase,
            new_state: l.mm_preparation_phase,
            actor_id: currentUser.id,
            timestamp: Date.now(),
            schedule_version: l.schedule.schedule_version,
            metadata: { asset, amount, txId: res.transaction?.id },
          };
          return {
            ...l,
            updated_at: Date.now(),
            audit_trail: [...l.audit_trail, evt],
          };
        }
        return l;
      })
    );

    return { success: true };
  }, [initialListings, currentUser.id, userBalancesMap]);

  const generatePreLaunchQuotesForListing = useCallback((listingId: string) => {
    const listing = initialListings.find((l) => l.id === listingId);
    if (!listing) return { success: false, error: 'Listing not found.' };

    const quotes = MMPreparationService.generatePreLaunchQuotes({
      listing,
      mmUserId: listing.assigned_mm_account || 'usr_mm_01',
      targetSpreadBps: listing.schedule.target_spread_bps || 30,
      levelsCount: listing.schedule.min_depth_levels || 5,
      baseVolumePerLevel: 2.0,
    });

    setRestingOrders((prev) => [
      ...prev.filter((o) => !(o.pair === listing.symbol && o.isPreLaunch)),
      ...quotes,
    ]);

    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          const evt: ListingEvent = {
            id: createUniqueId('evt_quotes'),
            listing_id: l.id,
            event_type: 'PRE_LAUNCH_QUOTES_GENERATED',
            previous_state: l.mm_preparation_phase,
            new_state: 'READY',
            actor_id: currentUser.id,
            timestamp: Date.now(),
            schedule_version: l.schedule.schedule_version,
            metadata: { count: quotes.length },
          };
          return {
            ...l,
            mm_preparation_phase: 'READY',
            updated_at: Date.now(),
            audit_trail: [...l.audit_trail, evt],
          };
        }
        return l;
      })
    );

    return { success: true, count: quotes.length };
  }, [initialListings, currentUser.id]);

  const applyAdminOverrideToListing = useCallback((listingId: string, override: AdminOverride) => {
    const listing = initialListings.find((l) => l.id === listingId);
    if (!listing) return { success: false, error: 'Listing not found.' };

    const res = ListingSchedulerService.applyAdminOverride(listing, override);
    if (!res.success) return { success: false, error: res.error };

    setInitialListings((prev) => prev.map((l) => (l.id === listingId ? res.listing : l)));
    return { success: true };
  }, [initialListings]);

  const toggleFeatureStatus = useCallback((listingId: string, feature: 'deposit' | 'withdrawal') => {
    setInitialListings((prev) =>
      prev.map((l) => {
        if (l.id === listingId) {
          const field = feature === 'deposit' ? 'deposit_status' : 'withdrawal_status';
          const nextStatus = l[field] === 'OPEN' ? 'CLOSED' : 'OPEN';
          return {
            ...l,
            [field]: nextStatus,
            updated_at: Date.now(),
            audit_trail: [
              ...l.audit_trail,
              {
                id: createUniqueId('evt_feat'),
                listing_id: l.id,
                event_type: `${feature.toUpperCase()}_STATUS_TOGGLED`,
                previous_state: l[field],
                new_state: nextStatus,
                actor_id: currentUser.id,
                timestamp: Date.now(),
                schedule_version: l.schedule.schedule_version,
              },
            ],
          };
        }
        return l;
      })
    );
  }, [currentUser.id]);

  // Asset & Network Management Methods
  const getDepositAddress = useCallback(
    (asset: string, networkId: string, userId?: string): DepositAddress | null => {
      const targetUserId = userId || currentUser.id;
      return AssetNetworkService.generateDeterministicAddress(asset, networkId, targetUserId);
    },
    [currentUser.id]
  );

  const simulateCryptoDeposit = useCallback(
    async (params: { asset: string; networkId: string; amount: number; txHash?: string }) => {
      const assetCfg = assetConfigs.find((a) => a.symbol === params.asset);
      if (!assetCfg) {
        return { success: false, error: `Aset ${params.asset} tidak ditemukan di katalog exchange.` };
      }
      const netCfg = assetCfg.networks.find((n) => n.networkId === params.networkId);
      if (!netCfg) {
        return { success: false, error: `Jaringan ${params.networkId} tidak didukung untuk ${params.asset}.` };
      }

      const listing = assetCfg.listingId ? initialListings.find((l) => l.id === assetCfg.listingId) : undefined;
      const availability = AssetNetworkService.isDepositAvailable(assetCfg, netCfg, listing);
      if (!availability.available) {
        return { success: false, error: availability.reason || 'Deposit saat ini ditutup untuk aset ini.' };
      }

      if (params.amount < netCfg.minDeposit) {
        return {
          success: false,
          error: `Jumlah deposit minimum untuk ${netCfg.networkName} adalah ${netCfg.minDeposit} ${params.asset}.`,
        };
      }

      const depositAddr = AssetNetworkService.generateDeterministicAddress(params.asset, params.networkId, currentUser.id);
      const onChainTx = AssetNetworkService.simulateOnChainDeposit({
        userId: currentUser.id,
        asset: params.asset,
        network: netCfg,
        amount: params.amount,
        destinationAddress: depositAddr.address,
        txHash: params.txHash,
      });

      // Credit user's available balance in ledger
      setUserBalancesMap((prevMap) => {
        const userBal = prevMap[currentUser.id] || balances;
        const current = userBal[params.asset] || { asset: params.asset, free: 0, locked: 0, total: 0 };
        const newFree = current.free + params.amount;
        return {
          ...prevMap,
          [currentUser.id]: {
            ...userBal,
            [params.asset]: {
              ...current,
              free: newFree,
              total: newFree + current.locked,
            },
          },
        };
      });

      setDepositHistory((prev) => [onChainTx, ...prev]);

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_chain_dep'),
          actor: currentUser.name,
          action: 'ON_CHAIN_DEPOSIT_CONFIRMED',
          target: `${params.amount} ${params.asset} (${netCfg.networkName})`,
          details: `Simulated on-chain deposit confirmed with ${onChainTx.confirmations}/${onChainTx.requiredConfirmations} blocks. TxHash: ${onChainTx.txHash.slice(0, 16)}...`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      return { success: true, tx: onChainTx };
    },
    [assetConfigs, initialListings, currentUser.id, currentUser.name, balances]
  );

  const submitCryptoWithdrawal = useCallback(
    async (params: {
      asset: string;
      networkId: string;
      amount: number;
      destinationAddress: string;
      memoTag?: string;
      bankName?: string;
      accountName?: string;
    }) => {
      const assetCfg = assetConfigs.find((a) => a.symbol === params.asset);
      if (!assetCfg) {
        return { success: false, error: `Aset ${params.asset} tidak ditemukan di katalog exchange.` };
      }
      const netCfg = assetCfg.networks.find((n) => n.networkId === params.networkId);
      if (!netCfg) {
        return { success: false, error: `Jaringan ${params.networkId} tidak didukung untuk ${params.asset}.` };
      }

      const listing = assetCfg.listingId ? initialListings.find((l) => l.id === assetCfg.listingId) : undefined;
      const availability = AssetNetworkService.isWithdrawalAvailable(assetCfg, netCfg, listing);
      if (!availability.available) {
        return { success: false, error: availability.reason || 'Penarikan saat ini ditutup untuk aset ini.' };
      }

      const addrValidation = AssetNetworkService.validateAddressFormat(params.destinationAddress, netCfg.chainType);
      if (!addrValidation.isValid) {
        return { success: false, error: addrValidation.message || 'Format alamat tujuan tidak valid.' };
      }

      if (params.amount < netCfg.minWithdrawal) {
        return {
          success: false,
          error: `Penarikan minimum untuk ${netCfg.networkName} adalah ${netCfg.minWithdrawal} ${params.asset}.`,
        };
      }

      const userBal = userBalancesMap[currentUser.id]?.[params.asset] || { asset: params.asset, free: 0, locked: 0, total: 0 };
      if (userBal.free < params.amount) {
        return {
          success: false,
          error: `Saldo tidak mencukupi. Tersedia: ${userBal.free} ${params.asset}, diminta: ${params.amount} ${params.asset}.`,
        };
      }

      const withdrawal = AssetNetworkService.createWithdrawalRecord({
        userId: currentUser.id,
        asset: params.asset,
        network: netCfg,
        amount: params.amount,
        destinationAddress: params.destinationAddress,
        destinationBankName: params.bankName,
        destinationAccountName: params.accountName,
        memoTag: params.memoTag,
      });

      // Lock user's balance in double-entry ledger (moved from free to locked)
      setUserBalancesMap((prevMap) => {
        const uBal = prevMap[currentUser.id] || balances;
        const current = uBal[params.asset] || { asset: params.asset, free: 0, locked: 0, total: 0 };
        return {
          ...prevMap,
          [currentUser.id]: {
            ...uBal,
            [params.asset]: {
              ...current,
              free: Math.max(0, current.free - params.amount),
              locked: current.locked + params.amount,
              total: current.total,
            },
          },
        };
      });

      setWithdrawalHistory((prev) => [withdrawal, ...prev]);

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_wtd_req'),
          actor: currentUser.name,
          action: 'WITHDRAWAL_REQUESTED',
          target: `${params.amount} ${params.asset} (${netCfg.networkName})`,
          details: `Requested withdrawal of ${params.amount} ${params.asset} to ${params.destinationAddress.slice(0, 12)}... (Fee: ${withdrawal.networkFee} ${params.asset}, Net: ${withdrawal.netAmount}). Funds locked.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      return { success: true, withdrawal };
    },
    [assetConfigs, initialListings, currentUser.id, currentUser.name, userBalancesMap, balances]
  );

  const approveWithdrawal = useCallback(
    (withdrawalId: string, txHash?: string) => {
      const record = withdrawalHistory.find((w) => w.id === withdrawalId);
      if (!record) return { success: false, error: 'Transaksi penarikan tidak ditemukan.' };
      if (record.status !== 'pending') {
        return { success: false, error: `Penarikan sudah berstatus ${record.status}.` };
      }

      const assignedTxHash = txHash || `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

      // Deduct from locked balance (settlement on-chain)
      setUserBalancesMap((prevMap) => {
        const uBal = prevMap[record.userId] || {};
        const current = uBal[record.asset] || { asset: record.asset, free: 0, locked: 0, total: 0 };
        const newLocked = Math.max(0, current.locked - record.amount);
        return {
          ...prevMap,
          [record.userId]: {
            ...uBal,
            [record.asset]: {
              ...current,
              locked: newLocked,
              total: current.free + newLocked,
            },
          },
        };
      });

      setWithdrawalHistory((prev) =>
        prev.map((w) =>
          w.id === withdrawalId
            ? {
                ...w,
                status: 'completed',
                txHash: assignedTxHash,
                updatedAt: Date.now(),
              }
            : w
        )
      );

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_wtd_appr'),
          actor: currentUser.name,
          action: 'WITHDRAWAL_APPROVED_AND_SETTLED',
          target: `${record.amount} ${record.asset}`,
          details: `Admin approved withdrawal ${withdrawalId}. On-chain tx broadcasted: ${assignedTxHash.slice(0, 16)}... Locked balance cleared.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      return { success: true };
    },
    [withdrawalHistory, currentUser.name]
  );

  const rejectWithdrawal = useCallback(
    (withdrawalId: string, reason: string) => {
      const record = withdrawalHistory.find((w) => w.id === withdrawalId);
      if (!record) return { success: false, error: 'Transaksi penarikan tidak ditemukan.' };
      if (record.status !== 'pending') {
        return { success: false, error: `Penarikan sudah berstatus ${record.status}.` };
      }

      // Unlock user balance (revert locked to free)
      setUserBalancesMap((prevMap) => {
        const uBal = prevMap[record.userId] || {};
        const current = uBal[record.asset] || { asset: record.asset, free: 0, locked: 0, total: 0 };
        const newLocked = Math.max(0, current.locked - record.amount);
        const newFree = current.free + record.amount;
        return {
          ...prevMap,
          [record.userId]: {
            ...uBal,
            [record.asset]: {
              ...current,
              free: newFree,
              locked: newLocked,
              total: newFree + newLocked,
            },
          },
        };
      });

      setWithdrawalHistory((prev) =>
        prev.map((w) =>
          w.id === withdrawalId
            ? {
                ...w,
                status: 'rejected',
                rejectedReason: reason,
                updatedAt: Date.now(),
              }
            : w
        )
      );

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_wtd_rej'),
          actor: currentUser.name,
          action: 'WITHDRAWAL_REJECTED_UNLOCKED',
          target: `${record.amount} ${record.asset}`,
          details: `Admin rejected withdrawal ${withdrawalId}. Reason: ${reason}. ${record.amount} ${record.asset} returned to user free balance.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      return { success: true };
    },
    [withdrawalHistory, currentUser.name]
  );

  const updateAssetNetworkConfig = useCallback(
    (assetSymbol: string, networkId: string, updates: Partial<NetworkConfig>) => {
      setCustomNetworksMap((prevMap) => {
        const currentAsset = assetConfigs.find((a) => a.symbol === assetSymbol);
        const currentNetworks = currentAsset?.networks || [];
        const nextNetworks = currentNetworks.map((n) =>
          n.networkId === networkId ? { ...n, ...updates } : n
        );
        return {
          ...prevMap,
          [assetSymbol]: nextNetworks,
        };
      });
    },
    [assetConfigs]
  );

  const addAssetNetwork = useCallback(
    (assetSymbol: string, newNetwork: NetworkConfig) => {
      setCustomNetworksMap((prevMap) => {
        const currentAsset = assetConfigs.find((a) => a.symbol === assetSymbol);
        const currentNetworks = currentAsset?.networks || [];
        const filtered = currentNetworks.filter((n) => n.networkId !== newNetwork.networkId);
        return {
          ...prevMap,
          [assetSymbol]: [...filtered, newNetwork],
        };
      });
    },
    [assetConfigs]
  );

  const toggleAssetNetworkStatus = useCallback(
    (assetSymbol: string, networkId: string, feature: 'deposit' | 'withdrawal') => {
      setCustomNetworksMap((prevMap) => {
        const currentAsset = assetConfigs.find((a) => a.symbol === assetSymbol);
        const currentNetworks = currentAsset?.networks || [];
        const nextNetworks = currentNetworks.map((n) => {
          if (n.networkId !== networkId) return n;
          if (feature === 'deposit') {
            const nextStatus: FeatureStatus = n.depositStatus === 'OPEN' ? 'CLOSED' : 'OPEN';
            return { ...n, depositStatus: nextStatus };
          } else {
            const nextStatus: FeatureStatus = n.withdrawalStatus === 'OPEN' ? 'CLOSED' : 'OPEN';
            return { ...n, withdrawalStatus: nextStatus };
          }
        });
        return {
          ...prevMap,
          [assetSymbol]: nextNetworks,
        };
      });
    },
    [assetConfigs]
  );

  const toggleAssetGlobalStatus = useCallback(
    (assetSymbol: string, feature: 'deposit' | 'withdrawal') => {
      const assetCfg = assetConfigs.find((a) => a.symbol === assetSymbol);
      if (!assetCfg) return;

      const currentStatus = feature === 'deposit' ? assetCfg.depositStatus : assetCfg.withdrawalStatus;
      const nextStatus: FeatureStatus = currentStatus === 'OPEN' ? 'CLOSED' : 'OPEN';

      // If linked to an initial listing, update the listing too
      if (assetCfg.listingId) {
        toggleFeatureStatus(assetCfg.listingId, feature);
      }

      // Update all networks for this asset
      setCustomNetworksMap((prevMap) => {
        const currentNetworks = assetCfg.networks || [];
        const nextNetworks = currentNetworks.map((n) => {
          if (feature === 'deposit') {
            return { ...n, depositStatus: nextStatus };
          } else {
            return { ...n, withdrawalStatus: nextStatus };
          }
        });
        return {
          ...prevMap,
          [assetSymbol]: nextNetworks,
        };
      });
    },
    [assetConfigs, toggleFeatureStatus]
  );

  const createAsset = useCallback(
    (
      newAsset: AssetConfig,
      initialNetwork?: NetworkConfig,
      autoCreatePair: boolean = true,
      initialAdminSupply?: number
    ) => {
      const sym = newAsset.symbol.trim().toUpperCase();
      if (!sym || !newAsset.name) {
        return { success: false, error: 'Simbol dan nama aset wajib diisi.' };
      }
      if (assetConfigs.some((a) => a.symbol === sym)) {
        return { success: false, error: `Aset dengan simbol ${sym} sudah ada.` };
      }

      const networks = initialNetwork ? [initialNetwork] : newAsset.networks || [];
      const cleanAsset: AssetConfig = {
        ...newAsset,
        symbol: sym,
        networks,
        depositStatus: newAsset.depositStatus || 'OPEN',
        withdrawalStatus: newAsset.withdrawalStatus || 'OPEN',
        status: newAsset.status || 'ACTIVE',
      };

      setCustomAssetsMap((prev) => ({
        ...prev,
        [sym]: cleanAsset,
      }));

      if (networks.length > 0) {
        setCustomNetworksMap((prev) => ({
          ...prev,
          [sym]: networks,
        }));
      }

      // If initial admin supply is allocated, credit it to admin/treasury
      if (initialAdminSupply && initialAdminSupply > 0) {
        setUserBalancesMap((prevMap) => {
          const adminId = currentUser.role === 'admin' ? currentUser.id : 'usr_admin_01';
          const prevAdminBal = prevMap[adminId] || {};
          const current = prevAdminBal[sym] || { asset: sym, free: 0, locked: 0, total: 0 };
          return {
            ...prevMap,
            [adminId]: {
              ...prevAdminBal,
              [sym]: {
                asset: sym,
                free: current.free + initialAdminSupply,
                locked: current.locked,
                total: current.free + initialAdminSupply + current.locked,
              },
            },
          };
        });
      }

      // Optionally auto create a spot market pair (e.g. SYM/IDR or SYM/USDT)
      if (autoCreatePair) {
        const pairId = `${sym}/IDR`;
        const exists = markets.some((m) => m.id === pairId);
        if (!exists) {
          const initPrice = cleanAsset.initialPrice || 10000;
          const newPair: MarketPair = {
            id: pairId,
            baseAsset: sym,
            quoteAsset: 'IDR',
            name: `${cleanAsset.name} / Rupiah`,
            lastPrice: initPrice,
            change24h: 0,
            high24h: initPrice,
            low24h: initPrice,
            volume24h: 0,
            priceDecimals: cleanAsset.decimals > 2 ? 0 : 2,
            amountDecimals: cleanAsset.decimals >= 6 ? 4 : 2,
            minOrderAmount: 1,
            makerFeeBps: 10,
            takerFeeBps: 15,
            isActive: true,
            tradingAccessStatus: 'OPEN',
          };
          setMarkets((prev) => [...prev, newPair]);
          syncPairToBackend(newPair);
        }
      }

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_ast_create'),
          actor: currentUser.name,
          action: 'BASE_ASSET_CREATED',
          target: sym,
          details: `Admin created base asset ${cleanAsset.name} (${sym}) on chain ${cleanAsset.primaryChain || 'EVM'}. Total supply: ${cleanAsset.totalSupply || 'N/A'}.`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      // Fire async backend persist
      try {
        fetch('/api/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: sym,
            name: cleanAsset.name,
            decimals: cleanAsset.decimals,
            category: cleanAsset.category,
            color: cleanAsset.color,
            primaryChain: cleanAsset.primaryChain,
            tokenStandard: cleanAsset.tokenStandard,
            contractAddress: cleanAsset.contractAddress,
            totalSupply: cleanAsset.totalSupply,
            maxSupply: cleanAsset.maxSupply,
            circulatingSupply: cleanAsset.circulatingSupply,
            description: cleanAsset.description,
            websiteUrl: cleanAsset.websiteUrl,
            whitepaperUrl: cleanAsset.whitepaperUrl,
            explorerUrl: cleanAsset.explorerUrl,
            genesisDate: cleanAsset.genesisDate,
            initialPrice: cleanAsset.initialPrice,
            initialNetwork,
          }),
        }).catch(() => {});
      } catch (e) {}

      return { success: true };
    },
    [assetConfigs, markets, currentUser]
  );

  const updateBaseAsset = useCallback(
    (symbol: string, updates: Partial<AssetConfig>) => {
      const sym = symbol.trim().toUpperCase();
      const existing = assetConfigs.find((a) => a.symbol === sym);
      if (!existing) {
        return { success: false, error: `Aset ${sym} tidak ditemukan.` };
      }

      const merged: AssetConfig = {
        ...existing,
        ...updates,
        symbol: sym,
      };

      setCustomAssetsMap((prev) => ({
        ...prev,
        [sym]: merged,
      }));

      setAuditLogs((prev) => [
        {
          id: createUniqueId('log_ast_update'),
          actor: currentUser.name,
          action: 'BASE_ASSET_UPDATED',
          target: sym,
          details: `Admin updated asset parameters for ${sym}: ${Object.keys(updates).join(', ')}`,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      try {
        fetch(`/api/assets/${sym}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }).catch(() => {});
      } catch (e) {}

      return { success: true };
    },
    [assetConfigs, currentUser]
  );

  // Automated Scheduler Background Tick
  useEffect(() => {
    if (settings.engineSpeed === 'paused') return;

    const interval = setInterval(() => {
      const now = Date.now();
      setInitialListings((prevListings) => {
        let changed = false;
        const nextListings = prevListings.map((listing) => {
          if (listing.status === 'COMPLETED' || listing.status === 'CANCELLED') return listing;

          const mmAccountBalances = userBalancesMap[listing.assigned_mm_account || 'usr_mm_01'] || {};
          const evalRes = ListingSchedulerService.evaluateListingSchedule(
            listing,
            mmAccountBalances,
            restingOrders,
            now
          );

          if (evalRes.unlockedOrders) {
            setRestingOrders((prevResting) =>
              MMPreparationService.unlockPreLaunchOrders(prevResting, listing.symbol)
            );
            setMarkets((prevMkts) =>
              prevMkts.map((m) =>
                m.id === listing.symbol
                  ? { ...m, isActive: true, tradingAccessStatus: 'OPEN' }
                  : m
              )
            );
          }

          if (evalRes.actionsTaken.length > 0) {
            changed = true;
            return evalRes.updatedListing;
          }
          return listing;
        });

        return changed ? nextListings : prevListings;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [settings.engineSpeed, userBalancesMap, restingOrders]);

  const myOrders = useMemo(() => {
    return userOrders.filter((o) => o.userId === currentUser.id);
  }, [userOrders, currentUser.id]);

  const openOrders = useMemo(() => {
    return userOrders.filter(
      (o) => (o.status === 'open' || o.status === 'partially_filled') && o.userId === currentUser.id
    );
  }, [userOrders, currentUser.id]);

  const myTrades = useMemo(() => {
    const myOrderIds = new Set(myOrders.map((o) => o.id));
    return userTrades.filter((t) => {
      if (t.makerUserId === currentUser.id || t.takerUserId === currentUser.id) return true;
      if (t.orderId && myOrderIds.has(t.orderId)) return true;
      if (t.makerOrderId && myOrderIds.has(t.makerOrderId)) return true;
      if (t.takerOrderId && myOrderIds.has(t.takerOrderId)) return true;
      return false;
    });
  }, [userTrades, myOrders, currentUser.id]);

  const mmActiveOrders = useMemo(() => {
    return restingOrders.filter((o) => o.isMM || o.isWall);
  }, [restingOrders]);

  const portfolioValueIDR = Object.values(balances).reduce((acc, b) => {
    if (b.asset === 'IDR') return acc + b.total;
    const pair = markets.find((m) => m.baseAsset === b.asset && m.quoteAsset === 'IDR');
    const price = pair ? pair.lastPrice : 0;
    return acc + b.total * price;
  }, 0);

  const unrealizedPnL = Math.round(portfolioValueIDR * 0.042);
  const realizedPnL = Math.round(portfolioValueIDR * 0.018);

  const createMMConsoleBot = useCallback((bot: MMConsoleBot) => {
    setMmConsoleBots((prev) => [bot, ...prev]);
    fetch('/api/mm/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bot),
    }).catch(() => {});
  }, []);

  const updateMMConsoleBot = useCallback((botId: string, updates: Partial<MMConsoleBot>) => {
    setMmConsoleBots((prev) =>
      prev.map((b) => (b.id === botId ? { ...b, ...updates, updatedAt: Date.now() } : b))
    );
    fetch(`/api/mm/bots/${botId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).catch(() => {});
  }, []);

  const deleteMMConsoleBot = useCallback((botId: string) => {
    const botOwnerId = `bot_console_${botId}`;
    setRestingOrders((prev) => prev.filter((o) => o.userId !== botOwnerId));
    setMmConsoleBots((prev) => prev.filter((b) => b.id !== botId));
    fetch(`/api/mm/bots/${botId}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const toggleMMConsoleBotStatus = useCallback(
    (botId: string, action: 'START' | 'PAUSE' | 'RESUME' | 'STOP') => {
      let nextStatus: MMConsoleBot['status'] = 'STOPPED';
      if (action === 'START' || action === 'RESUME') nextStatus = 'RUNNING';
      else if (action === 'PAUSE') nextStatus = 'PAUSED';

      const botOwnerId = `bot_console_${botId}`;
      if (nextStatus !== 'RUNNING') {
        setRestingOrders((prev) => prev.filter((o) => o.userId !== botOwnerId));
      }

      setMmConsoleBots((prev) =>
        prev.map((b) => {
          if (b.id !== botId) return b;
          const updated: MMConsoleBot = {
            ...b,
            status: nextStatus,
            activeOpenOrdersCount: nextStatus === 'RUNNING' ? b.activeOpenOrdersCount : 0,
            totalBidExposure: nextStatus === 'RUNNING' ? b.totalBidExposure : 0,
            totalAskExposure: nextStatus === 'RUNNING' ? b.totalAskExposure : 0,
            updatedAt: Date.now(),
          };
          if (nextStatus === 'RUNNING') {
            setTimeout(() => executeQuantBotTick(updated), 50);
          }
          return updated;
        })
      );

      fetch(`/api/mm/bots/${botId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).catch(() => {});
    },
    [executeQuantBotTick]
  );

  const cloneMMConsoleBot = useCallback((botId: string): MMConsoleBot | null => {
    const src = mmConsoleBotsRef.current.find((b) => b.id === botId);
    if (!src) return null;

    const clonedId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newBot: MMConsoleBot = {
      ...src,
      id: clonedId,
      name: `${src.name} (Clone)`,
      status: 'STOPPED',
      activeOpenOrdersCount: 0,
      totalBidExposure: 0,
      totalAskExposure: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      dailyTurnover: 0,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setMmConsoleBots((prev) => [newBot, ...prev]);
    fetch('/api/mm/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBot),
    }).catch(() => {});
    return newBot;
  }, []);

  const emergencyStopAllMMConsoleBots = useCallback(() => {
    setRestingOrders((prev) => prev.filter((o) => !o.userId.startsWith('bot_console_') && !o.isWall));
    setMmConsoleBots((prev) =>
      prev.map((b) => ({
        ...b,
        status: 'STOPPED',
        activeOpenOrdersCount: 0,
        totalBidExposure: 0,
        totalAskExposure: 0,
        updatedAt: Date.now(),
      }))
    );
    fetch('/api/mm/bots/emergency-stop', { method: 'POST' }).catch(() => {});
  }, []);

  const runMMConsoleBotTick = useCallback(
    (botId: string) => {
      const bot = mmConsoleBotsRef.current.find((b) => b.id === botId);
      if (!bot) return { success: false, ordersPlaced: 0, message: 'Bot not found' };
      mmBotLastRunRef.current[bot.id] = Date.now();
      return executeQuantBotTick(bot);
    },
    [executeQuantBotTick]
  );

  return (
    <SimulationContext.Provider
      value={{
        currentUser,
        allUsers: DEMO_USERS,
        markets,
        activePair,
        balances,
        userBalancesMap,
        botBalances,
        orderBook,
        restingOrders,
        candles,
        timeframe,
        userOrders: myOrders,
        myOrders,
        openOrders,
        userTrades: myTrades,
        marketTrades,
        auditLogs,
        settings,
        portfolioValueIDR,
        unrealizedPnL,
        realizedPnL,
        isSubmitting,
        adminFeeVault,
        fullMMConfigs,
        updateFullMMConfig,
        mmConfig,
        pairMMBots,
        updatePairMMBot,
        toggleMMBot,
        stopAllPairMMBots,
        startAllPairMMBots,
        autoTradeConfig,
        autoTradeBots,
        updateAutoTradeConfig,
        toggleAutoTrade,
        resetAutoTradeVolume,
        upsertAutoTradeBot,
        updateAutoTradeBotByPair,
        toggleAutoTradeBotByPair,
        resetAutoTradeBotVolumeByPair,
        removeAutoTradeBot,
        stopAllAutoTradeBots,
        setTimeframe,
        selectPair,
        submitOrder,
        cancelOrderById,
        switchUser,
        registerDemoUser,
        depositVirtualFaucet,
        updateMarketConfig,
        updateSettings,
        resetSimulationData,
        toggleFavoritePair,
        updateMMConfig,
        replenishLiquidity,
        clearMMOrders,
        injectOrderWall,
        cancelOrderWall,
        clearAllWalls,
        injectAutomatedLimitOrders,
        depositBotBalance,
        mmActiveOrders,
        cancelAllMMOrders,
        mmBotLogs,
        addMMBotLog,
        clearMMBotLogs,
        // Initial Listing Lifecycle & MM Launch
        initialListings,
        createDraftListing,
        submitForReview,
        returnToDraft,
        approveListing,
        rejectListing,
        scheduleListing,
        rescheduleListing,
        pauseListing,
        allocateTreasuryFunding,
        generatePreLaunchQuotesForListing,
        applyAdminOverrideToListing,
        toggleFeatureStatus,
        // Asset & Network Management
        assetConfigs,
        depositHistory,
        withdrawalHistory,
        getDepositAddress,
        simulateCryptoDeposit,
        submitCryptoWithdrawal,
        approveWithdrawal,
        rejectWithdrawal,
        updateAssetNetworkConfig,
        addAssetNetwork,
        toggleAssetNetworkStatus,
        toggleAssetGlobalStatus,
        createAsset,
        updateBaseAsset,
        // Quant Market Maker Console & Live Feeds
        mmConsoleBots,
        workerFeedHealth,
        aggregatedRefPrices,
        fxRateConfig,
        createMMConsoleBot,
        updateMMConsoleBot,
        deleteMMConsoleBot,
        toggleMMConsoleBotStatus,
        cloneMMConsoleBot,
        emergencyStopAllMMConsoleBots,
        runMMConsoleBotTick,
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('useSimulation must be used within a SimulationProvider');
  }
  return context;
}
