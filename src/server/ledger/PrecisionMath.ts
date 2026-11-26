/**
 * Zero-Float BigInt Precision Math for Financial & Volume Execution Operations
 *
 * All prices, quantities, fees, notional values, exposure, balances, and
 * cumulative executed volume are computed strictly in atomic integer units
 * via BigInt. All persisted / serialized values use decimal strings so
 * large 18-decimal or high-value IDR figures never suffer IEEE-754 precision loss.
 */

const POW10_CACHE = new Map<number, bigint>();

export function pow10(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Invalid decimals precision: ${decimals}`);
  }
  const cached = POW10_CACHE.get(decimals);
  if (cached !== undefined) return cached;
  const val = 10n ** BigInt(decimals);
  POW10_CACHE.set(decimals, val);
  return val;
}

export function safeBigInt(value: string | number | bigint | null | undefined, fallback: bigint = 0n): bigint {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return BigInt(Math.trunc(value));
  }
  const clean = value.trim();
  if (!clean) return fallback;
  if (/^-?\d+$/.test(clean)) {
    return BigInt(clean);
  }
  throw new Error(`Invalid atomic integer string: "${value}"`);
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function absBigInt(a: bigint): bigint {
  return a < 0n ? -a : a;
}

/**
 * Pure string-based parser from human decimal (e.g. "0.01500000" or "1485600000")
 * into BigInt atomic units without using floating-point multiplication.
 */
export function parseDecimalToAtomic(
  value: string | number | bigint,
  decimals: number,
  options: { strictScale?: boolean; allowNegative?: boolean } = {}
): bigint {
  if (typeof value === 'bigint') {
    if (!options.allowNegative && value < 0n) {
      throw new Error('Negative value is not allowed');
    }
    return value;
  }

  let raw = typeof value === 'number' ? value.toString() : String(value ?? '');
  raw = raw.trim().replace(/,/g, '');
  if (!raw) return 0n;

  // Handle scientific notation if converted from number (e.g. "1e-7")
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(raw)) {
    raw = expandScientificNotation(raw);
  }

  const isNegative = raw.startsWith('-');
  if (isNegative && !options.allowNegative) {
    throw new Error(`Negative numeric value not allowed: "${value}"`);
  }
  const absStr = isNegative ? raw.slice(1) : raw;

  if (!/^\d+(\.\d+)?$/.test(absStr)) {
    throw new Error(`Invalid decimal numeric format: "${value}"`);
  }

  const [wholePart = '0', fracPartRaw = ''] = absStr.split('.');
  if (options.strictScale && fracPartRaw.length > decimals) {
    const extra = fracPartRaw.slice(decimals);
    if (!/^0*$/.test(extra)) {
      throw new Error(`Value "${value}" exceeds maximum precision of ${decimals} decimals`);
    }
  }

  const fracPart =
    decimals === 0
      ? ''
      : fracPartRaw.length > decimals
      ? fracPartRaw.slice(0, decimals)
      : fracPartRaw.padEnd(decimals, '0');

  const combined = `${wholePart}${fracPart}`.replace(/^0+(?=\d)/, '') || '0';
  const result = BigInt(combined);
  return isNegative && result > 0n ? -result : result;
}

function expandScientificNotation(input: string): string {
  const isNeg = input.startsWith('-');
  const clean = isNeg ? input.slice(1) : input;
  const [mantissa, expStr] = clean.toLowerCase().split('e');
  const exp = parseInt(expStr, 10);
  const [whole, frac = ''] = mantissa.split('.');
  const digits = whole + frac;
  const decimalPos = whole.length + exp;

  let out: string;
  if (decimalPos <= 0) {
    out = '0.' + '0'.repeat(Math.abs(decimalPos)) + digits;
  } else if (decimalPos >= digits.length) {
    out = digits + '0'.repeat(decimalPos - digits.length);
  } else {
    out = digits.slice(0, decimalPos) + '.' + digits.slice(decimalPos);
  }
  return (isNeg ? '-' : '') + out;
}

/**
 * Formats BigInt atomic units into an exact human-readable decimal string.
 */
export function formatAtomicToDecimal(
  atomic: bigint | string | number,
  decimals: number,
  trimTrailingZeros: boolean = false
): string {
  const value = safeBigInt(atomic);
  const isNegative = value < 0n;
  const absVal = isNegative ? -value : value;

  if (decimals === 0) {
    return `${isNegative ? '-' : ''}${absVal.toString()}`;
  }

  const scale = pow10(decimals);
  const whole = absVal / scale;
  const fracRaw = (absVal % scale).toString().padStart(decimals, '0');
  const frac = trimTrailingZeros ? fracRaw.replace(/0+$/, '') : fracRaw;

  if (!frac) {
    return `${isNegative ? '-' : ''}${whole.toString()}`;
  }
  return `${isNegative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Normalizes a price in quote atomic units to an exact multiple of tickSizeAtomic.
 */
export function normalizePriceToTick(
  priceAtomic: bigint,
  tickSizeAtomic: bigint,
  mode: 'floor' | 'ceil' | 'round' = 'round'
): bigint {
  if (priceAtomic <= 0n) return 0n;
  if (tickSizeAtomic <= 1n) return priceAtomic;

  const remainder = priceAtomic % tickSizeAtomic;
  if (remainder === 0n) return priceAtomic;

  const base = priceAtomic - remainder;
  if (mode === 'floor') return base;
  if (mode === 'ceil') return base + tickSizeAtomic;

  // Half-up rounding
  return remainder * 2n >= tickSizeAtomic ? base + tickSizeAtomic : base;
}

/**
 * Normalizes a base quantity in base atomic units to an exact multiple of lotSizeAtomic.
 */
export function normalizeQtyToLot(
  qtyAtomic: bigint,
  lotSizeAtomic: bigint,
  mode: 'floor' | 'ceil' = 'floor'
): bigint {
  if (qtyAtomic <= 0n) return 0n;
  if (lotSizeAtomic <= 1n) return qtyAtomic;

  const remainder = qtyAtomic % lotSizeAtomic;
  if (remainder === 0n) return qtyAtomic;

  const base = qtyAtomic - remainder;
  return mode === 'ceil' ? base + lotSizeAtomic : base;
}

/**
 * Computes exact quote notional atomic units:
 * quoteAtomic = (priceAtomic * baseQtyAtomic) / 10^basePrecision
 */
export function computeQuoteNotionalAtomic(
  priceAtomic: bigint,
  baseQtyAtomic: bigint,
  basePrecision: number
): bigint {
  if (priceAtomic < 0n || baseQtyAtomic < 0n) {
    throw new Error('Price and quantity must be non-negative');
  }
  const scale = pow10(basePrecision);
  return (priceAtomic * baseQtyAtomic) / scale;
}

/**
 * Computes inverse base quantity from a quote notional budget and price:
 * baseQtyAtomic = (quoteBudgetAtomic * 10^basePrecision) / priceAtomic
 */
export function computeBaseQtyFromQuoteAtomic(
  quoteBudgetAtomic: bigint,
  priceAtomic: bigint,
  basePrecision: number
): bigint {
  if (quoteBudgetAtomic <= 0n || priceAtomic <= 0n) return 0n;
  const scale = pow10(basePrecision);
  return (quoteBudgetAtomic * scale) / priceAtomic;
}

/**
 * Computes fee in basis points (1 bps = 1/10000).
 */
export function calculateFeeBpsAtomic(
  amountAtomic: bigint,
  feeBps: bigint | number
): { feeAtomic: bigint; netAtomic: bigint } {
  const bps = typeof feeBps === 'bigint' ? feeBps : BigInt(Math.max(0, Math.trunc(feeBps)));
  if (amountAtomic < 0n || bps < 0n) {
    throw new Error('Amount and feeBps must be non-negative');
  }
  if (amountAtomic === 0n || bps === 0n) {
    return { feeAtomic: 0n, netAtomic: amountAtomic };
  }
  const feeAtomic = (amountAtomic * bps) / 10000n;
  return { feeAtomic, netAtomic: amountAtomic - feeAtomic };
}

/**
 * Applies maximum slippage bps to a reference price:
 * - BUY ceiling = refPrice * (10000 + bps) / 10000
 * - SELL floor  = refPrice * (10000 - bps) / 10000
 */
export function applySlippageBpsAtomic(
  refPriceAtomic: bigint,
  slippageBps: number,
  side: 'BUY' | 'SELL'
): bigint {
  if (refPriceAtomic <= 0n) return 0n;
  const bps = BigInt(Math.max(0, Math.min(9999, Math.trunc(slippageBps))));
  if (side === 'BUY') {
    return (refPriceAtomic * (10000n + bps)) / 10000n;
  }
  return (refPriceAtomic * (10000n - bps)) / 10000n;
}

/**
 * Applies signed tick offset (positive or negative) to a price.
 */
export function applyTickOffsetAtomic(
  basePriceAtomic: bigint,
  tickSizeAtomic: bigint,
  ticks: number
): bigint {
  const step = maxBigInt(1n, tickSizeAtomic);
  const shifted = basePriceAtomic + step * BigInt(Math.trunc(ticks));
  return shifted > 0n ? shifted : step;
}

/**
 * Computes absolute deviation in basis points between an execution price and reference price.
 */
export function computePriceDeviationBps(execPriceAtomic: bigint, refPriceAtomic: bigint): bigint {
  if (refPriceAtomic <= 0n || execPriceAtomic <= 0n) return 0n;
  const diff = absBigInt(execPriceAtomic - refPriceAtomic);
  return (diff * 10000n) / refPriceAtomic;
}

/**
 * Computes exact average fill price from accumulated (priceAtomic * baseQtyAtomic) numerator
 * and total filled baseQtyAtomic.
 */
export function computeWeightedAveragePrice(
  weightedPriceNumeratorAtomic: bigint,
  totalExecutedBaseAtomic: bigint
): bigint {
  if (totalExecutedBaseAtomic <= 0n || weightedPriceNumeratorAtomic <= 0n) return 0n;
  return weightedPriceNumeratorAtomic / totalExecutedBaseAtomic;
}

/**
 * Deterministic BigInt pseudo-random integer in [min, max] inclusive using seed hash.
 * Safe for slice jitter without floating-point arithmetic.
 */
export function deterministicBigIntInRange(minVal: bigint, maxVal: bigint, entropyInt: bigint): bigint {
  if (maxVal <= minVal) return minVal;
  const span = maxVal - minVal + 1n;
  const positiveEntropy = entropyInt < 0n ? -entropyInt : entropyInt;
  return minVal + (positiveEntropy % span);
}

export const PrecisionMath = {
  pow10,
  safeBigInt,
  minBigInt,
  maxBigInt,
  absBigInt,
  parseDecimalToAtomic,
  formatAtomicToDecimal,
  normalizePriceToTick,
  normalizeQtyToLot,
  computeQuoteNotionalAtomic,
  computeBaseQtyFromQuoteAtomic,
  calculateFeeBpsAtomic,
  applySlippageBpsAtomic,
  applyTickOffsetAtomic,
  computePriceDeviationBps,
  computeWeightedAveragePrice,
  deterministicBigIntInRange,
};

export default PrecisionMath;
