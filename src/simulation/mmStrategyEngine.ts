import {
  BookOrder,
  FullMMConfig,
  MarketPair,
  OrderSide,
} from './types';
import { safeRound } from '../utils/formatters';

export const DEFAULT_FULL_MM_CONFIGS: Record<string, FullMMConfig> = {
  'DNA/IDR': {
    cs_price_decimal: 0,
    cs_quantity_decimal: 2,
    cs_direction: 'Neutral',
    cs_target_price: 14250,
    cs_duration_hours: 24,
    cs_timeframe: '15m',
    cs_max_step_percent: 1.5,
    cs_nudge_budget_idr: 50000000,
    cs_support_budget_idr: 250000000,
    cs_volume_ratio: 1.2,
    cs_dump_threshold_percent: 5.0,
    cs_dump_action: 'pause',
    cs_walk_book: true,
    cs_walk_max_levels: 10,
    cs_walk_max_slippage_pct: 3.0,
    cs_orphan_cancel_seconds: 120,
    cs_target_source: 'mid_price',
    cs_target_premium_pct: 0.0,
    cs_dead_zone_pct: 0.25,
    cs_flip_hysteresis_candles: 3,
    cs_total_budget_idr: 1000000000,
    cs_max_book_spread_pct: 1.5,

    enabled: true,
    market_id: 'DNA/IDR',
    strategy_mode: 'passive_grid',
    quote_interval_ms: 3000,
    max_order_notional_idr: 25000000,
    max_open_orders: 20,
    max_daily_spend_idr: 500000000,
    max_inventory_idr: 1500000000,
    max_inventory_quantity: 500000,
    min_order_quantity: 50,
    max_order_quantity: 2500,
    cooldown_seconds: 2,
    stop_loss_percent: 10.0,
    max_drawdown_percent: 15.0,
    emergency_stop: false,
    lifecycle_state: 'RUNNING',
    last_run_at: Date.now(),

    // User-configured bounds & execution
    buy_min_price_limit: 12500,
    buy_max_price_limit: 14200,
    sell_min_price_limit: 14300,
    sell_max_price_limit: 16500,
    expire_time: 120,
    order_count: 10,
    split_order: true,
    split_range: 1.5,
    jitter_timing_pct: 10,
    jitter_price_pct: 0.05,
    account_id: 'usr_mm_01',
    transaction_type: 'post_only',

    allocated_budget_idr: 1000000000,
    spent_budget_idr: 0,
    reserved_quote_idr: 300000000,
    reserved_base_qty: 25000,
    realized_pnl_idr: 0,
    total_trades_count: 0,
  },
  'BTC/IDR': {
    cs_price_decimal: 0,
    cs_quantity_decimal: 5,
    cs_direction: 'Neutral',
    cs_target_price: 1485600000,
    cs_duration_hours: 48,
    cs_timeframe: '15m',
    cs_max_step_percent: 0.8,
    cs_nudge_budget_idr: 150000000,
    cs_support_budget_idr: 750000000,
    cs_volume_ratio: 1.0,
    cs_dump_threshold_percent: 3.5,
    cs_dump_action: 'reprice',
    cs_walk_book: true,
    cs_walk_max_levels: 10,
    cs_walk_max_slippage_pct: 2.0,
    cs_orphan_cancel_seconds: 180,
    cs_target_source: 'mid_price',
    cs_target_premium_pct: 0.0,
    cs_dead_zone_pct: 0.15,
    cs_flip_hysteresis_candles: 2,
    cs_total_budget_idr: 2500000000,
    cs_max_book_spread_pct: 1.0,

    enabled: true,
    market_id: 'BTC/IDR',
    strategy_mode: 'passive_grid',
    quote_interval_ms: 3500,
    max_order_notional_idr: 100000000,
    max_open_orders: 20,
    max_daily_spend_idr: 1000000000,
    max_inventory_idr: 3000000000,
    max_inventory_quantity: 5,
    min_order_quantity: 0.001,
    max_order_quantity: 0.15,
    cooldown_seconds: 3,
    stop_loss_percent: 7.0,
    max_drawdown_percent: 10.0,
    emergency_stop: false,
    lifecycle_state: 'RUNNING',
    last_run_at: Date.now(),

    allocated_budget_idr: 2500000000,
    spent_budget_idr: 0,
    reserved_quote_idr: 750000000,
    reserved_base_qty: 0.5,
    realized_pnl_idr: 0,
    total_trades_count: 0,
  },
  'ETH/IDR': {
    cs_price_decimal: 0,
    cs_quantity_decimal: 4,
    cs_direction: 'Neutral',
    cs_target_price: 52450000,
    cs_duration_hours: 24,
    cs_timeframe: '15m',
    cs_max_step_percent: 1.0,
    cs_nudge_budget_idr: 80000000,
    cs_support_budget_idr: 400000000,
    cs_volume_ratio: 1.1,
    cs_dump_threshold_percent: 4.0,
    cs_dump_action: 'pause',
    cs_walk_book: true,
    cs_walk_max_levels: 10,
    cs_walk_max_slippage_pct: 2.5,
    cs_orphan_cancel_seconds: 150,
    cs_target_source: 'mid_price',
    cs_target_premium_pct: 0.0,
    cs_dead_zone_pct: 0.2,
    cs_flip_hysteresis_candles: 3,
    cs_total_budget_idr: 1500000000,
    cs_max_book_spread_pct: 1.2,

    enabled: true,
    market_id: 'ETH/IDR',
    strategy_mode: 'passive_grid',
    quote_interval_ms: 3500,
    max_order_notional_idr: 50000000,
    max_open_orders: 20,
    max_daily_spend_idr: 600000000,
    max_inventory_idr: 2000000000,
    max_inventory_quantity: 40,
    min_order_quantity: 0.02,
    max_order_quantity: 1.2,
    cooldown_seconds: 2,
    stop_loss_percent: 8.0,
    max_drawdown_percent: 12.0,
    emergency_stop: false,
    lifecycle_state: 'RUNNING',
    last_run_at: Date.now(),

    allocated_budget_idr: 1500000000,
    spent_budget_idr: 0,
    reserved_quote_idr: 400000000,
    reserved_base_qty: 8,
    realized_pnl_idr: 0,
    total_trades_count: 0,
  },
  'SOL/IDR': {
    cs_price_decimal: 0,
    cs_quantity_decimal: 3,
    cs_direction: 'Neutral',
    cs_target_price: 2865000,
    cs_duration_hours: 24,
    cs_timeframe: '15m',
    cs_max_step_percent: 1.2,
    cs_nudge_budget_idr: 50000000,
    cs_support_budget_idr: 250000000,
    cs_volume_ratio: 1.2,
    cs_dump_threshold_percent: 5.0,
    cs_dump_action: 'pause',
    cs_walk_book: true,
    cs_walk_max_levels: 10,
    cs_walk_max_slippage_pct: 3.0,
    cs_orphan_cancel_seconds: 120,
    cs_target_source: 'mid_price',
    cs_target_premium_pct: 0.0,
    cs_dead_zone_pct: 0.25,
    cs_flip_hysteresis_candles: 2,
    cs_total_budget_idr: 1000000000,
    cs_max_book_spread_pct: 1.5,

    enabled: true,
    market_id: 'SOL/IDR',
    strategy_mode: 'passive_grid',
    quote_interval_ms: 3000,
    max_order_notional_idr: 25000000,
    max_open_orders: 20,
    max_daily_spend_idr: 400000000,
    max_inventory_idr: 1200000000,
    max_inventory_quantity: 400,
    min_order_quantity: 0.2,
    max_order_quantity: 10,
    cooldown_seconds: 2,
    stop_loss_percent: 10.0,
    max_drawdown_percent: 15.0,
    emergency_stop: false,
    lifecycle_state: 'RUNNING',
    last_run_at: Date.now(),

    allocated_budget_idr: 1000000000,
    spent_budget_idr: 0,
    reserved_quote_idr: 250000000,
    reserved_base_qty: 85,
    realized_pnl_idr: 0,
    total_trades_count: 0,
  },
  'USDT/IDR': {
    cs_price_decimal: 0,
    cs_quantity_decimal: 2,
    cs_direction: 'Neutral',
    cs_target_price: 16180,
    cs_duration_hours: 72,
    cs_timeframe: '1h',
    cs_max_step_percent: 0.3,
    cs_nudge_budget_idr: 100000000,
    cs_support_budget_idr: 500000000,
    cs_volume_ratio: 1.0,
    cs_dump_threshold_percent: 1.5,
    cs_dump_action: 'alert',
    cs_walk_book: true,
    cs_walk_max_levels: 8,
    cs_walk_max_slippage_pct: 1.0,
    cs_orphan_cancel_seconds: 300,
    cs_target_source: 'mid_price',
    cs_target_premium_pct: 0.0,
    cs_dead_zone_pct: 0.05,
    cs_flip_hysteresis_candles: 3,
    cs_total_budget_idr: 2000000000,
    cs_max_book_spread_pct: 0.5,

    enabled: true,
    market_id: 'USDT/IDR',
    strategy_mode: 'passive_grid',
    quote_interval_ms: 4000,
    max_order_notional_idr: 50000000,
    max_open_orders: 16,
    max_daily_spend_idr: 800000000,
    max_inventory_idr: 2500000000,
    max_inventory_quantity: 150000,
    min_order_quantity: 25,
    max_order_quantity: 3000,
    cooldown_seconds: 3,
    stop_loss_percent: 2.0,
    max_drawdown_percent: 5.0,
    emergency_stop: false,
    lifecycle_state: 'RUNNING',
    last_run_at: Date.now(),

    allocated_budget_idr: 2000000000,
    spent_budget_idr: 0,
    reserved_quote_idr: 500000000,
    reserved_base_qty: 30000,
    realized_pnl_idr: 0,
    total_trades_count: 0,
  },
};

/**
 * Validates full market maker bot configuration
 */
export function validateFullMMConfig(config: FullMMConfig): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.cs_price_decimal < 0 || config.cs_price_decimal > 8) {
    errors.push('cs_price_decimal must be between 0 and 8.');
  }
  if (config.cs_quantity_decimal < 0 || config.cs_quantity_decimal > 8) {
    errors.push('cs_quantity_decimal must be between 0 and 8.');
  }
  if (config.cs_target_price <= 0 || !Number.isFinite(config.cs_target_price)) {
    errors.push('cs_target_price must be a positive number.');
  }
  if (config.cs_duration_hours <= 0) {
    errors.push('cs_duration_hours must be greater than 0.');
  }
  if (config.cs_total_budget_idr <= 0) {
    errors.push('cs_total_budget_idr must be greater than 0.');
  }
  if (config.cs_nudge_budget_idr < 0 || config.cs_support_budget_idr < 0) {
    errors.push('Sub-budgets cannot be negative.');
  }
  if (config.cs_nudge_budget_idr + config.cs_support_budget_idr > config.cs_total_budget_idr) {
    errors.push('Sum of nudge and support budgets exceeds cs_total_budget_idr.');
  }
  if (config.cs_walk_max_levels < 1 || config.cs_walk_max_levels > 30) {
    errors.push('cs_walk_max_levels must be between 1 and 30.');
  }
  if (config.cs_max_book_spread_pct <= 0 || config.cs_max_book_spread_pct > 25) {
    errors.push('cs_max_book_spread_pct must be between 0.01% and 25%.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generates bounded, deterministic market-making orders adhering to all institutional constraints.
 */
export function generateInstitutionalMMQuotes(
  pair: MarketPair,
  config: FullMMConfig,
  existingOrders: BookOrder[],
  botUserId: string = 'usr_mm_01'
): BookOrder[] {
  // Check lifecycle
  if (!config.enabled || config.emergency_stop || config.lifecycle_state === 'STOPPED' || config.lifecycle_state === 'PAUSED') {
    return [];
  }
  if (!pair.isActive) {
    return [];
  }

  const now = Date.now();
  const tick = pair.id.includes('BTC') ? 50000 : pair.id.includes('DNA') ? 25 : pair.lastPrice > 1000000 ? 1000 : 5;
  const priceDecimals = config.cs_price_decimal;
  const amountDecimals = config.cs_quantity_decimal;

  // 1. Calculate reference quote center
  let quoteCenter = pair.lastPrice;
  if (config.cs_target_source === 'static' && config.cs_target_price > 0) {
    quoteCenter = config.cs_target_price;
  } else if (config.cs_target_source === 'mid_price') {
    quoteCenter = pair.lastPrice;
  }

  // Apply premium / discount
  if (config.cs_target_premium_pct !== 0) {
    quoteCenter = quoteCenter * (1 + config.cs_target_premium_pct / 100);
  }

  // 2. Dead zone check
  const deadZoneAmount = quoteCenter * (config.cs_dead_zone_pct / 100);
  if (Math.abs(pair.lastPrice - quoteCenter) < deadZoneAmount) {
    quoteCenter = pair.lastPrice;
  }

  // 3. Directional skew
  let bidSpreadMult = 1.0;
  let askSpreadMult = 1.0;
  let bidVolMult = 1.0;
  let askVolMult = 1.0;

  if (config.cs_direction === 'Up') {
    bidSpreadMult = 0.7; // Tighter bids
    askSpreadMult = 1.3; // Wider asks
    bidVolMult = 1.5;    // Higher support depth
    askVolMult = 0.8;
  } else if (config.cs_direction === 'Down') {
    bidSpreadMult = 1.3;
    askSpreadMult = 0.7;
    bidVolMult = 0.8;
    askVolMult = 1.5;    // Higher resistance depth
  }

  // Half-spread
  const baseSpreadPct = Math.min(config.cs_max_book_spread_pct, Math.max(0.2, (pair.takerFeeBps * 2) / 100));
  const baseHalfSpread = Math.max(tick, Math.round((quoteCenter * (baseSpreadPct / 200))));

  const levels = config.cs_walk_book ? Math.min(config.cs_walk_max_levels, config.max_open_orders / 2) : 5;
  const baseOrderQty = (config.min_order_quantity + config.max_order_quantity) / 2;

  // Wall protection
  const existingWalls = existingOrders.filter((o) => o.pair === pair.id && o.isWall && o.remainingAmount > 0);
  const highestBuyWall = existingWalls.filter((w) => w.side === 'buy').reduce((max, w) => Math.max(max, w.price), 0);
  const lowestSellWall = existingWalls.filter((w) => w.side === 'sell').reduce((min, w) => Math.min(min, w.price), Infinity);

  const generatedOrders: BookOrder[] = [];
  const expireSec = config.cs_orphan_cancel_seconds || 120;
  const expiresAt = now + expireSec * 1000;

  // 1. Generate Bids (Buy ladder)
  const bestBid = Math.floor((quoteCenter - baseHalfSpread * bidSpreadMult) / tick) * tick;
  let currentBid = bestBid;

  if (lowestSellWall < Infinity) {
    currentBid = Math.min(currentBid, lowestSellWall - tick);
  }

  for (let i = 0; i < levels; i++) {
    const levelPrice = safeRound(currentBid - i * tick, priceDecimals);
    if (levelPrice <= 0) break;
    if (levelPrice >= lowestSellWall) continue; // Wall collision protection

    // Strict user-configured support price bounds (prevents price wandering / mental)
    if (config.buy_min_price_limit && levelPrice < config.buy_min_price_limit) continue;
    if (config.buy_max_price_limit && levelPrice > config.buy_max_price_limit) continue;

    const variance = 1 + Math.sin(i * 1.4) * 0.25;
    let qty = safeRound(baseOrderQty * bidVolMult * variance * config.cs_volume_ratio, amountDecimals);
    let notional = Math.round(levelPrice * qty);
    if (notional > config.max_order_notional_idr) {
      qty = safeRound(Math.floor(config.max_order_notional_idr / levelPrice), amountDecimals);
      notional = Math.round(levelPrice * qty);
    }
    if (qty < pair.minOrderAmount) continue;

    generatedOrders.push({
      id: `mm_bid_${pair.id.replace('/', '')}_${i}_${levelPrice}_${now}`,
      userId: botUserId,
      pair: pair.id,
      side: 'buy',
      price: levelPrice,
      amount: qty,
      remainingAmount: qty,
      createdAt: now - i * 500,
      isMM: true,
      isFrozen: true,
      frozenFunds: notional,
      expiresAt,
      transactionType: 'post_only',
    });
  }

  // 2. Generate Asks (Sell ladder)
  const bestAsk = Math.ceil((quoteCenter + baseHalfSpread * askSpreadMult) / tick) * tick;
  let currentAsk = bestAsk;

  if (highestBuyWall > 0) {
    currentAsk = Math.max(currentAsk, highestBuyWall + tick);
  }

  for (let i = 0; i < levels; i++) {
    const levelPrice = safeRound(currentAsk + i * tick, priceDecimals);
    if (levelPrice <= 0) break;
    if (levelPrice <= highestBuyWall) continue; // Wall collision protection

    // Strict user-configured resistance price bounds (prevents price wandering / mental)
    if (config.sell_min_price_limit && levelPrice < config.sell_min_price_limit) continue;
    if (config.sell_max_price_limit && levelPrice > config.sell_max_price_limit) continue;

    const variance = 1 + Math.cos(i * 1.4) * 0.25;
    let qty = safeRound(baseOrderQty * askVolMult * variance * config.cs_volume_ratio, amountDecimals);
    let notional = Math.round(levelPrice * qty);
    if (notional > config.max_order_notional_idr) {
      qty = safeRound(Math.floor(config.max_order_notional_idr / levelPrice), amountDecimals);
      notional = Math.round(levelPrice * qty);
    }
    if (qty < pair.minOrderAmount) continue;

    generatedOrders.push({
      id: `mm_ask_${pair.id.replace('/', '')}_${i}_${levelPrice}_${now}`,
      userId: botUserId,
      pair: pair.id,
      side: 'sell',
      price: levelPrice,
      amount: qty,
      remainingAmount: qty,
      createdAt: now - i * 500,
      isMM: true,
      isFrozen: true,
      frozenFunds: qty,
      expiresAt,
      transactionType: 'post_only',
    });
  }

  return generatedOrders;
}
