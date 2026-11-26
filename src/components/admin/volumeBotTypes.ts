export type VolumeBotEnvironment = 'DEMO' | 'SANDBOX' | 'STAGING' | 'PRODUCTION';
export type VolumeBotExecutionMode = 'SIMULATION' | 'LIVE';
export type VolumeBotStrategy =
  | 'TWAP'
  | 'VWAP'
  | 'ICEBERG'
  | 'PASSIVE_LIMIT'
  | 'AGGRESSIVE_LIMIT';
export type VolumeBotStatus =
  | 'DRAFT'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'COMPLETED'
  | 'RISK_LOCKED'
  | 'ERROR';
export type VolumeBotSide = 'BUY' | 'SELL';
export type VolumeBotReferenceSource = 'INTERNAL_BOOK' | 'AGGREGATED_FEED' | 'HYBRID';
export type VolumeBotPresetId =
  | 'CONSERVATIVE'
  | 'BALANCED'
  | 'PASSIVE'
  | 'TWAP'
  | 'VWAP'
  | 'ICEBERG'
  | 'CUSTOM';

export interface VolumeBotConfig {
  botName: string;
  presetId?: VolumeBotPresetId;
  pairId: string;
  accountId: string;
  environment: VolumeBotEnvironment;
  executionMode: VolumeBotExecutionMode;
  executionSide: VolumeBotSide;

  targetVolume: string;
  minSliceSize: string;
  maxSliceSize: string;
  autoStopOnTarget: boolean;
  maxOrderQty?: string;

  minIntervalMs: number;
  maxIntervalMs: number;
  executionWindowStartMs?: number | null;
  executionWindowEndMs?: number | null;
  pauseBetweenWindowsMs: number;
  maxOrdersPerMinute: number;
  orderTimeoutMs: number;
  partialFillRetryLimit: number;
  cooldownAfterFailureMs: number;

  strategy: VolumeBotStrategy;
  twapDurationMs?: number;
  vwapLookbackMinutes?: number;
  icebergVisibleRatioPct?: number;
  passiveOffsetTicks?: number;
  aggressiveMaxTicks?: number;

  referencePriceSource: VolumeBotReferenceSource;
  minPriceCollar: string;
  maxPriceCollar: string;
  maxSlippageBps: number;
  maxParticipationRateBps: number;
  staleMarketDataMaxAgeMs: number;
  tickSize: string;
  lotSize: string;

  maxBaseInventory: string;
  maxQuoteInventory: string;
  maxOrderNotional: string;
  maxCumulativeExposure: string;
  dailyExecutionLimit: string;
  maxOpenOrders: number;
  selfTradePrevention: boolean;
}

export interface VolumeBotDTO {
  id: string;
  name: string;
  ownerId: string;
  accountId: string;
  pairId: string;
  baseAsset: string;
  quoteAsset: string;
  basePrecision: number;
  quotePrecision: number;
  environment: VolumeBotEnvironment;
  executionMode: VolumeBotExecutionMode;
  executionSide: VolumeBotSide;
  strategy: VolumeBotStrategy;
  status: VolumeBotStatus;
  enabled: boolean;
  configVersion: number;
  config: VolumeBotConfig;
  metrics: {
    targetVolume: string;
    targetQtyAtomic: string;
    executedVolume: string;
    executedQtyAtomic: string;
    remainingVolume: string;
    remainingQtyAtomic: string;
    completionPct: number;
    executedQuoteNotional: string;
    executedQuoteAtomic: string;
    averageFillPrice: string;
    averageFillPriceAtomic: string;
    totalFees: string;
    totalFeesAtomic: string;
    dailyExecutedQuote: string;
    dailyExecutedQuoteAtomic: string;
    submittedOrdersCount: number;
    acceptedOrdersCount: number;
    partialFillsCount: number;
    filledOrdersCount: number;
    cancelledOrdersCount: number;
    rejectedOrdersCount: number;
    expiredOrdersCount: number;
    totalTradesCount: number;
    averageSlippageBps: number;
    openOrdersCount: number;
  };
  riskState: {
    riskLocked: boolean;
    riskLockReason: string | null;
    emergencyStopped: boolean;
    lastRiskCheckAt: number;
    lastBalanceAvailableBaseAtomic: string;
    lastBalanceAvailableQuoteAtomic: string;
    lastBalanceLockedBaseAtomic: string;
    lastBalanceLockedQuoteAtomic: string;
    openOrdersCount: number;
    activeExposureQuoteAtomic: string;
    staleDataBlocked: boolean;
    collarBreaches: number;
    slippageBreaches: number;
    balanceRejections: number;
    stpInterceptions: number;
  };
  checkpoint: {
    nextScheduledAt: number;
    sliceIndex: number;
    consecutiveFailures: number;
    lastActionReason: string;
  };
  emergencyStopped: boolean;
  lastExecutionAt: number | null;
  lastError: string | null;
  migratedFromLegacyId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PairLike {
  id: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number;
  priceDecimals: number;
  amountDecimals: number;
  minOrderAmount: number;
}

export const VOLUME_BOT_PRESETS: Array<{
  id: VolumeBotPresetId;
  label: string;
  description: string;
  strategy: VolumeBotStrategy;
}> = [
  {
    id: 'CONSERVATIVE',
    label: 'Conservative Execution',
    description: 'Low participation, tight slippage collar, slower cadence.',
    strategy: 'TWAP',
  },
  {
    id: 'BALANCED',
    label: 'Balanced Execution',
    description: 'Moderate slice sizing and balanced slippage protection.',
    strategy: 'TWAP',
  },
  {
    id: 'PASSIVE',
    label: 'Passive Execution',
    description: 'Rests limit orders inside BBO without crossing spread.',
    strategy: 'PASSIVE_LIMIT',
  },
  {
    id: 'TWAP',
    label: 'TWAP Execution',
    description: 'Uniform time-weighted slicing over target duration.',
    strategy: 'TWAP',
  },
  {
    id: 'VWAP',
    label: 'VWAP Execution',
    description: 'Adapts slice sizes to genuine historical trade volume.',
    strategy: 'VWAP',
  },
  {
    id: 'ICEBERG',
    label: 'Iceberg Execution',
    description: 'Reveals bounded clips and replenishes after fill.',
    strategy: 'ICEBERG',
  },
  {
    id: 'CUSTOM',
    label: 'Custom Configuration',
    description: 'Manual institutional parameter overrides.',
    strategy: 'AGGRESSIVE_LIMIT',
  },
];

function formatNum(val: number, decimals: number): string {
  if (!Number.isFinite(val) || val <= 0) return '0';
  return val.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

export function buildPresetVolumeConfig(
  presetId: VolumeBotPresetId,
  pair: PairLike,
  accountId: string = 'usr_mm_01'
): VolumeBotConfig {
  const minLot = Math.max(pair.minOrderAmount || 0.0001, Math.pow(10, -pair.amountDecimals));
  const defaultTick = pair.priceDecimals === 0 ? (pair.lastPrice >= 1000000 ? 1000 : 25) : Math.pow(10, -pair.priceDecimals);
  const refPrice = Math.max(1, pair.lastPrice || 10000);
  const minCollar = Math.round(refPrice * 0.9);
  const maxCollar = Math.round(refPrice * 1.1);

  const baseTarget = Math.max(minLot * 20, minLot * (presetId === 'CONSERVATIVE' ? 20 : 40));
  const smallSlice = minLot;
  const medSlice = Math.max(minLot * 3, baseTarget * 0.1);
  const largeSlice = Math.max(minLot * 5, baseTarget * 0.25);

  const base: VolumeBotConfig = {
    botName: `${pair.id} ${presetId} Execution`,
    presetId,
    pairId: pair.id,
    accountId,
    environment: 'DEMO',
    executionMode: 'SIMULATION',
    executionSide: 'BUY',
    targetVolume: formatNum(baseTarget, pair.amountDecimals),
    minSliceSize: formatNum(smallSlice, pair.amountDecimals),
    maxSliceSize: formatNum(medSlice, pair.amountDecimals),
    autoStopOnTarget: true,
    maxOrderQty: formatNum(largeSlice, pair.amountDecimals),
    minIntervalMs: 4000,
    maxIntervalMs: 8000,
    executionWindowStartMs: null,
    executionWindowEndMs: null,
    pauseBetweenWindowsMs: 0,
    maxOrdersPerMinute: 12,
    orderTimeoutMs: 30000,
    partialFillRetryLimit: 3,
    cooldownAfterFailureMs: 5000,
    strategy: 'TWAP',
    twapDurationMs: 300000,
    vwapLookbackMinutes: 30,
    icebergVisibleRatioPct: 20,
    passiveOffsetTicks: 1,
    aggressiveMaxTicks: 2,
    referencePriceSource: 'HYBRID',
    minPriceCollar: formatNum(minCollar, pair.priceDecimals),
    maxPriceCollar: formatNum(maxCollar, pair.priceDecimals),
    maxSlippageBps: 75,
    maxParticipationRateBps: 2500,
    staleMarketDataMaxAgeMs: 30000,
    tickSize: formatNum(defaultTick, pair.priceDecimals),
    lotSize: formatNum(minLot, pair.amountDecimals),
    maxBaseInventory: '0',
    maxQuoteInventory: '0',
    maxOrderNotional: formatNum(Math.round(refPrice * largeSlice * 1.5), pair.priceDecimals),
    maxCumulativeExposure: formatNum(Math.round(refPrice * baseTarget * 1.5), pair.priceDecimals),
    dailyExecutionLimit: formatNum(Math.round(refPrice * baseTarget * 2), pair.priceDecimals),
    maxOpenOrders: 4,
    selfTradePrevention: true,
  };

  if (presetId === 'CONSERVATIVE') {
    return {
      ...base,
      strategy: 'TWAP',
      minIntervalMs: 10000,
      maxIntervalMs: 20000,
      maxOrdersPerMinute: 6,
      maxSlippageBps: 25,
      maxParticipationRateBps: 1500,
      maxOpenOrders: 2,
      twapDurationMs: 600000,
    };
  }
  if (presetId === 'PASSIVE') {
    return {
      ...base,
      strategy: 'PASSIVE_LIMIT',
      passiveOffsetTicks: 2,
      maxSlippageBps: 40,
      orderTimeoutMs: 45000,
      maxOpenOrders: 5,
    };
  }
  if (presetId === 'VWAP') {
    return {
      ...base,
      strategy: 'VWAP',
      vwapLookbackMinutes: 60,
      maxParticipationRateBps: 2000,
      maxSlippageBps: 60,
    };
  }
  if (presetId === 'ICEBERG') {
    return {
      ...base,
      strategy: 'ICEBERG',
      icebergVisibleRatioPct: 15,
      maxOpenOrders: 1,
      maxSlippageBps: 50,
    };
  }
  if (presetId === 'CUSTOM') {
    return {
      ...base,
      strategy: 'AGGRESSIVE_LIMIT',
      aggressiveMaxTicks: 2,
      maxSlippageBps: 100,
    };
  }
  return base;
}
