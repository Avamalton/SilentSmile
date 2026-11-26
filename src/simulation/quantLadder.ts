import { MMConsoleBot } from './mmConsoleTypes';
import { safeRound } from '../utils/formatters';

export interface QuantLadderLevel {
  level: number;
  side: 'buy' | 'sell';
  offsetBps: number;
  price: number;
  quantity: number;
  totalValue: number;
}

export interface QuantLadderResult {
  refCurrent: number;
  targetCalculatedMid: number;
  bestBid: number;
  bestAsk: number;
  effectiveSpreadBps: number;
  bidLevels: QuantLadderLevel[];
  askLevels: QuantLadderLevel[];
  totalBidValue: number;
  totalAskQty: number;
  totalAskValue: number;
  warning?: string;
}

export interface BuildQuantLadderParams {
  bot: Pick<
    MMConsoleBot,
    'strategy' | 'mapping' | 'depthConfig' | 'riskProfile' | 'targetSpreadBps'
  >;
  refCurrent: number;
  fxRateIdr: number;
  pairLastPrice: number;
  amountDecimals: number;
  priceDecimals?: number;
  deterministic?: boolean;
}

function roundToPrecision(val: number, decimals: number): number {
  const factor = Math.pow(10, Math.max(0, decimals));
  return Math.round(val * factor) / factor;
}

export function buildQuantBotLadder(params: BuildQuantLadderParams): QuantLadderResult {
  const {
    bot,
    refCurrent: rawRefCurrent,
    fxRateIdr,
    pairLastPrice,
    amountDecimals,
    priceDecimals = 0,
    deterministic = false,
  } = params;

  const refSym = bot.mapping?.referenceMarketSymbol || 'BTCUSDT';
  const refCurrent =
    rawRefCurrent > 0
      ? rawRefCurrent
      : bot.mapping?.referenceAnchorPrice > 0
      ? bot.mapping.referenceAnchorPrice
      : 72450;
  const refAnchor = bot.mapping?.referenceAnchorPrice > 0 ? bot.mapping.referenceAnchorPrice : refCurrent;
  const targetAnchor = bot.mapping?.targetAnchorPrice > 0 ? bot.mapping.targetAnchorPrice : pairLastPrice;
  const beta = bot.mapping?.sensitivityBeta ?? 1.0;

  let targetMid = targetAnchor;
  const mode = bot.mapping?.mappingMode as string | undefined;

  if (
    mode === 'FX_CONVERTED_REFERENCE' ||
    mode === 'DIRECT_EQUIVALENT' ||
    (bot.mapping?.requiresFxConversion && mode !== 'PERCENTAGE_RETURN' && mode !== 'BETA_SCALED_RETURN')
  ) {
    targetMid = refSym === 'USDTIDR' ? refCurrent : refCurrent * (fxRateIdr > 0 ? fxRateIdr : 18200);
  } else if (mode === 'DIRECT_PRICE') {
    targetMid = refCurrent;
  } else {
    const refReturn = refAnchor > 0 ? (refCurrent - refAnchor) / refAnchor : 0;
    targetMid = targetAnchor * (1 + beta * refReturn);
  }

  if (bot.mapping?.maxDeviationBps && bot.mapping.maxDeviationBps > 0 && targetAnchor > 0) {
    const maxDev = bot.mapping.maxDeviationBps / 10000;
    targetMid = Math.min(targetAnchor * (1 + maxDev), Math.max(targetAnchor * (1 - maxDev), targetMid));
  }

  const minPriceStep = priceDecimals > 0 ? Math.pow(10, -priceDecimals) : 1;
  const tick =
    bot.riskProfile?.customTickSize && bot.riskProfile.customTickSize > 0
      ? bot.riskProfile.customTickSize
      : minPriceStep;

  targetMid = Math.max(tick, roundToPrecision(Math.round(targetMid / tick) * tick, priceDecimals));

  const minSpr = Math.max(1, bot.depthConfig?.minSpreadBps ?? bot.targetSpreadBps ?? 15);
  const maxSpr = Math.max(minSpr, bot.depthConfig?.maxSpreadBps ?? Math.max(minSpr * 2, 60));
  const halfMinSpread = (targetMid * (minSpr / 10000)) / 2;

  const bestBid = Math.max(
    tick,
    roundToPrecision(Math.floor((targetMid - halfMinSpread) / tick) * tick, priceDecimals)
  );
  const bestAsk = Math.max(
    roundToPrecision(bestBid + tick, priceDecimals),
    roundToPrecision(Math.ceil((targetMid + halfMinSpread) / tick) * tick, priceDecimals)
  );

  const minLot =
    bot.riskProfile?.minimumLotSize && bot.riskProfile.minimumLotSize > 0
      ? bot.riskProfile.minimumLotSize
      : Math.pow(10, -Math.max(1, amountDecimals));

  const rawBaseQty =
    bot.depthConfig?.amountOrderLevel !== undefined && bot.depthConfig.amountOrderLevel > 0
      ? bot.depthConfig.amountOrderLevel
      : 0.05;
  const minLevelQty =
    bot.depthConfig?.minAmountOrderLevel !== undefined && bot.depthConfig.minAmountOrderLevel > 0
      ? bot.depthConfig.minAmountOrderLevel
      : minLot;
  const maxLevelQty =
    bot.depthConfig?.maxAmountOrderLevel !== undefined && bot.depthConfig.maxAmountOrderLevel > 0
      ? Math.max(minLevelQty, bot.depthConfig.maxAmountOrderLevel)
      : Math.max(minLevelQty, rawBaseQty * 10);

  const minOrderBid = Math.max(
    minLot,
    bot.depthConfig?.minOrderBid !== undefined && bot.depthConfig.minOrderBid > 0
      ? bot.depthConfig.minOrderBid
      : minLot
  );
  const minOrderAsk = Math.max(
    minLot,
    bot.depthConfig?.minOrderAsk !== undefined && bot.depthConfig.minOrderAsk > 0
      ? bot.depthConfig.minOrderAsk
      : minLot
  );

  // Use nullish coalescing so explicit 0% random variance is respected strictly
  const randPct = Math.max(0, bot.depthConfig?.qtyAmountRandom ?? 15) / 100;

  const configuredBidLevels =
    bot.strategy === 'PRICE_FOLLOWER'
      ? 1
      : Math.max(1, Math.min(20, bot.depthConfig?.numberOfBidLevels ?? 5));
  const configuredAskLevels =
    bot.strategy === 'PRICE_FOLLOWER'
      ? 1
      : Math.max(1, Math.min(20, bot.depthConfig?.numberOfAskLevels ?? 5));

  const maxOpenOrders = Math.max(1, bot.riskProfile?.maxOpenOrders ?? 20);

  // Split maxOpenOrders evenly between Bid and Ask so one side never starves the other
  let bidCap = Math.min(configuredBidLevels, Math.ceil(maxOpenOrders / 2));
  let askCap = Math.min(configuredAskLevels, maxOpenOrders - bidCap);
  if (bidCap + askCap < maxOpenOrders) {
    if (bidCap < configuredBidLevels) {
      bidCap = Math.min(configuredBidLevels, maxOpenOrders - askCap);
    } else if (askCap < configuredAskLevels) {
      askCap = Math.min(configuredAskLevels, maxOpenOrders - bidCap);
    }
  }

  const maxTotalBidVal =
    bot.riskProfile?.maxTotalBidValue !== undefined && bot.riskProfile.maxTotalBidValue > 0
      ? bot.riskProfile.maxTotalBidValue
      : Number.POSITIVE_INFINITY;
  const maxTotalAskQty =
    bot.riskProfile?.maxTotalAskQty !== undefined && bot.riskProfile.maxTotalAskQty > 0
      ? bot.riskProfile.maxTotalAskQty
      : Number.POSITIVE_INFINITY;

  const bidLevels: QuantLadderLevel[] = [];
  const askLevels: QuantLadderLevel[] = [];
  let totalBidValue = 0;
  let totalAskQty = 0;
  let totalAskValue = 0;
  const warnings: string[] = [];

  const computeQty = (levelIdx: number, sideMin: number) => {
    const variance = deterministic
      ? levelIdx % 2 === 0
        ? randPct * 0.35
        : -randPct * 0.35
      : (Math.random() * 2 - 1) * randPct;
    let qty = rawBaseQty * (1 + variance);
    const lowerBound = Math.max(sideMin, minLevelQty);
    const upperBound = Math.max(lowerBound, maxLevelQty);
    qty = Math.max(lowerBound, Math.min(upperBound, qty));
    // Round to minimum lot size and asset decimals cleanly
    const lotSteps = Math.max(1, Math.round(qty / minLot));
    qty = safeRound(lotSteps * minLot, amountDecimals);
    return Math.max(minLot, qty);
  };

  for (let i = 0; i < bidCap; i++) {
    // Interpolate half-spread from minSpr/2 (L1) to maxSpr/2 (LN)
    const halfMaxDeltaFrac =
      configuredBidLevels > 1
        ? (i * ((maxSpr - minSpr) / 2 / (configuredBidLevels - 1))) / 10000
        : 0;
    const bPrice = Math.max(
      tick,
      roundToPrecision(Math.floor((bestBid - halfMaxDeltaFrac * targetMid) / tick) * tick, priceDecimals)
    );
    const bQty = computeQty(i, minOrderBid);
    const notional = bPrice * bQty;

    if (totalBidValue + notional > maxTotalBidVal) {
      warnings.push(
        `Bid L${i + 1} capped by Max Total Bid Value (${Math.round(maxTotalBidVal).toLocaleString('en-US')})`
      );
      break;
    }

    bidLevels.push({
      level: i + 1,
      side: 'buy',
      offsetBps: Math.round(((targetMid - bPrice) / targetMid) * 10000),
      price: bPrice,
      quantity: bQty,
      totalValue: notional,
    });
    totalBidValue += notional;
  }

  for (let i = 0; i < askCap; i++) {
    const halfMaxDeltaFrac =
      configuredAskLevels > 1
        ? (i * ((maxSpr - minSpr) / 2 / (configuredAskLevels - 1))) / 10000
        : 0;
    const aPrice = Math.max(
      roundToPrecision(bestBid + tick, priceDecimals),
      roundToPrecision(Math.ceil((bestAsk + halfMaxDeltaFrac * targetMid) / tick) * tick, priceDecimals)
    );
    const aQty = computeQty(i, minOrderAsk);

    if (totalAskQty + aQty > maxTotalAskQty) {
      warnings.push(`Ask L${i + 1} capped by Max Total Ask Qty (${maxTotalAskQty})`);
      break;
    }

    const notional = aPrice * aQty;
    askLevels.push({
      level: i + 1,
      side: 'sell',
      offsetBps: Math.round(((aPrice - targetMid) / targetMid) * 10000),
      price: aPrice,
      quantity: aQty,
      totalValue: notional,
    });
    totalAskQty += aQty;
    totalAskValue += notional;
  }

  const effectiveSpreadBps =
    bidLevels.length > 0 && askLevels.length > 0
      ? Math.round(((askLevels[0].price - bidLevels[0].price) / targetMid) * 10000)
      : Math.round(((bestAsk - bestBid) / targetMid) * 10000);

  return {
    refCurrent,
    targetCalculatedMid: targetMid,
    bestBid,
    bestAsk,
    effectiveSpreadBps,
    bidLevels,
    askLevels,
    totalBidValue,
    totalAskQty,
    totalAskValue,
    warning: warnings.length > 0 ? warnings[0] : undefined,
  };
}
