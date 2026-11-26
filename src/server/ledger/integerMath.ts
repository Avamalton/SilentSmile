/**
 * Zero-Float Precision Integer Math for Financial Operations
 * Ensures all currency units (Crypto satoshis/base units and IDR integer rupiah)
 * are calculated with exact integer arithmetic, eliminating IEEE-754 floating point errors.
 */

export const ASSET_DECIMALS: Record<string, number> = {
  IDR: 0,      // Rupiah is whole integer units
  BTC: 8,      // 1 BTC = 100,000,000 satoshis
  ETH: 6,      // 1 ETH = 1,000,000 micro-units
  SOL: 4,      // 1 SOL = 10,000 micro-units
  DNA: 2,      // 1 DNA = 100 units
  USDT: 2,  
  MOCK: 4,   // 1 USDT = 100 cents
};

/**
 * Converts a decimal string representation (e.g. "0.01500000" or "500000") to integer base units.
 */
export function parseToIntegerUnits(val: string | number, decimals: number): number {
  if (typeof val === 'number') {
    val = val.toString();
  }
  const clean = val.trim();
  if (!clean || clean === '0') return 0;

  const isNegative = clean.startsWith('-');
  const absStr = isNegative ? clean.substring(1) : clean;

  const parts = absStr.split('.');
  const wholePart = parts[0] || '0';
  let fracPart = parts[1] || '';

  if (fracPart.length > decimals) {
    fracPart = fracPart.substring(0, decimals);
  } else {
    fracPart = fracPart.padEnd(decimals, '0');
  }

  const combined = decimals === 0 ? wholePart : `${wholePart}${fracPart}`;
  const parsed = parseInt(combined, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid numeric input for parsing integer units: ${val}`);
  }

  return isNegative ? -parsed : parsed;
}

/**
 * Formats an integer base unit representation to a human-readable string.
 */
export function formatFromIntegerUnits(units: number | bigint, decimals: number): string {
  const num = typeof units === 'bigint' ? Number(units) : units;
  const isNegative = num < 0;
  const absNum = Math.abs(num);

  if (decimals === 0) {
    return `${isNegative ? '-' : ''}${absNum.toString()}`;
  }

  const divisor = Math.pow(10, decimals);
  const whole = Math.floor(absNum / divisor);
  const frac = (absNum % divisor).toString().padStart(decimals, '0');

  // Strip trailing zeros after decimal if desirable, or keep exact precision
  return `${isNegative ? '-' : ''}${whole}.${frac}`;
}

/**
 * Calculates fee based on basis points (1 bps = 0.01% = 1/10000).
 * Uses ceiling or standard integer division to ensure exchange does not undercharge.
 */
export function calculateBpsFee(amount: number, feeBps: number): { netAmount: number; feeAmount: number } {
  if (amount < 0 || feeBps < 0) {
    throw new Error(`Amount and fee bps must be non-negative: amount=${amount}, bps=${feeBps}`);
  }
  if (feeBps === 0 || amount === 0) {
    return { netAmount: amount, feeAmount: 0 };
  }

  // Multiply first, then integer divide by 10,000 (standard basis points)
  // We use Math.floor for fee (or Math.max(1, Math.floor) if min fee)
  const feeAmount = Math.floor((amount * feeBps) / 10000);
  const netAmount = amount - feeAmount;

  return { netAmount, feeAmount };
}

/**
 * Multiplies price (in quote integer units) by base amount (in base integer units)
 * to compute quote total.
 * Example:
 * BTC/IDR:
 *   Price = 1,450,000,000 IDR (per 1 BTC)
 *   Amount = 50,000,000 (0.50 BTC, with 8 decimals)
 *   Total IDR = (1,450,000,000 * 50,000,000) / 10^8 = 725,000,000 IDR
 */
export function computeTradeTotal(price: number, amount: number, baseDecimals: number): number {
  if (price < 0 || amount < 0) {
    throw new Error('Price and amount must be non-negative');
  }
  const scale = Math.pow(10, baseDecimals);
  // Use BigInt to prevent 64-bit integer overflow during multiplication
  const bigPrice = BigInt(price);
  const bigAmount = BigInt(amount);
  const bigScale = BigInt(scale);
  const bigTotal = (bigPrice * bigAmount) / bigScale;

  return Number(bigTotal);
}
