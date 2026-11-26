/**
 * SilentSmile Exchange - Financial Formatting Utilities
 * Handles deterministic formatting for IDR, crypto tokens, percentages, and timestamps.
 */

export function formatIDR(amount: number, compact: boolean = false): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return 'Rp 0';
  }

  if (compact && Math.abs(amount) >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(2)} Miliar`;
  }
  if (compact && Math.abs(amount) >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(2)} Juta`;
  }

  // Indonesian Rupiah standard locale formatting with dot as thousand separator
  const rounded = Math.round(amount);
  const formatted = new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(rounded);

  return `Rp ${formatted}`;
}

export function formatCrypto(amount: number, decimals: number = 4): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return '0';
  }

  // Preserve significant digits without trailing float noise
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Math.min(2, decimals),
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatPercentage(percent: number, withSign: boolean = true): string {
  if (isNaN(percent) || percent === null || percent === undefined) {
    return '0.00%';
  }
  const sign = withSign && percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('id-ID', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function safeRound(num: number, decimals: number = 8): number {
  const factor = Math.pow(10, decimals);
  return Math.round((num + Number.EPSILON) * factor) / factor;
}
