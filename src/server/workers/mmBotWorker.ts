import { DatabaseManager } from '../db/database';
import { LedgerService } from '../ledger/ledgerService';
import { EngineManager } from '../engine/engineManager';
import { PriceAggregatorWorker } from './priceAggregatorWorker';
import { MMConsoleBot } from '../../simulation/mmConsoleTypes';
import { buildQuantBotLadder } from '../../simulation/quantLadder';

export class MMBotWorker {
  private dbMgr: DatabaseManager;
  private ledger: LedgerService;
  private engineManager: EngineManager;
  private priceAggregator: PriceAggregatorWorker;

  private isRunning: boolean = false;
  private loopInterval: NodeJS.Timeout | null = null;
  private botExecutionTimes: Map<string, number> = new Map();
  private botActiveOrderIds: Map<string, Set<string>> = new Map();

  constructor(
    dbMgr: DatabaseManager,
    ledger: LedgerService,
    engineManager: EngineManager,
    priceAggregator: PriceAggregatorWorker
  ) {
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.engineManager = engineManager;
    this.priceAggregator = priceAggregator;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Check bots every 1000ms
    this.loopInterval = setInterval(() => {
      this.executeCycle().catch((err) => {
        console.error('[MMBotWorker] Execution cycle error:', err);
      });
    }, 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }

  public async cancelOrdersForBot(botId: string, userId: string, pairId: string): Promise<number> {
    return this.cancelExistingBotOrders(botId, userId, pairId);
  }

  public async executeCycle(): Promise<void> {
    if (!this.isRunning) return;

    // Load all configured bots so we can run RUNNING ones and purge stopped/paused ones if needed
    const allRows = this.dbMgr.query<any>('SELECT * FROM mm_bots');
    if (!allRows || allRows.length === 0) return;

    for (const row of allRows) {
      try {
        const bot = this.hydrateBot(row);
        if (bot.status !== 'RUNNING' || bot.riskProfile?.killSwitchActive) {
          // If bot is not running anymore but still tracked as having active orders, purge them cleanly
          if (this.botActiveOrderIds.has(bot.id) || (bot.activeOpenOrdersCount || 0) > 0) {
            const normalizedPair = bot.targetMarketSymbol.replace('_', '/');
            const pairRow = this.dbMgr.queryOne<any>(
              'SELECT id FROM market_pairs WHERE id = ? OR id = ? OR REPLACE(id, "/", "_") = ?',
              [bot.targetMarketSymbol, normalizedPair, bot.targetMarketSymbol]
            );
            if (pairRow) {
              await this.cancelExistingBotOrders(bot.id, bot.accountId, pairRow.id);
              this.dbMgr.execute(
                'UPDATE mm_bots SET active_open_orders_count = 0, total_bid_exposure = 0, total_ask_exposure = 0, updated_at = ? WHERE id = ?',
                [Date.now(), bot.id]
              );
            }
          }
          continue;
        }

        await this.processBot(bot);
      } catch (err: any) {
        console.error(`[MMBotWorker] Error processing bot ${row.id}:`, err);
        try {
          this.dbMgr.execute(
            'UPDATE mm_bots SET error_message = ?, updated_at = ? WHERE id = ?',
            [err?.message || 'Worker execution error', Date.now(), row.id]
          );
        } catch {}
      }
    }
  }

  private hydrateBot(row: any): MMConsoleBot {
    const parseJson = (val: any) => {
      if (!val) return {};
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    };

    return {
      id: row.id,
      name: row.name,
      strategy: row.strategy,
      accountId: row.account_id,
      apiKeyId: row.api_key_id,
      targetMarketSymbol: row.target_market_symbol || row.target_pair,
      mapping: parseJson(row.mapping_config_json || row.mapping_config),
      depthConfig: parseJson(row.depth_config_json || row.depth_config),
      riskProfile: parseJson(row.risk_profile_json || row.risk_profile),
      status: row.status,
      dryRun: Boolean(row.dry_run),
      minRepriceIntervalMs: row.min_reprice_interval_ms ?? 2000,
      minPriceChangeBps: row.min_price_change_bps ?? 10,
      targetSpreadBps: row.target_spread_bps ?? 20,
      activeOpenOrdersCount: row.active_open_orders_count ?? row.active_orders_count ?? 0,
      totalBidExposure: row.total_bid_exposure ?? 0,
      totalAskExposure: row.total_ask_exposure ?? 0,
      currentBaseInventory: row.current_base_inventory ?? row.current_inventory_base ?? 0,
      currentQuoteInventory: row.current_quote_inventory ?? row.current_inventory_quote ?? 0,
      realizedPnl: row.realized_pnl ?? 0,
      unrealizedPnl: row.unrealized_pnl ?? 0,
      dailyTurnover: row.daily_turnover ?? 0,
      version: row.version || 1,
      createdBy: row.created_by || 'admin',
      createdAt: row.created_at || Date.now(),
      updatedAt: row.updated_at || Date.now(),
    };
  }

  private async processBot(bot: MMConsoleBot): Promise<void> {
    const now = Date.now();
    const lastRun = this.botExecutionTimes.get(bot.id) || 0;

    // Respect explicit 0 delay via nullish coalescing
    const minDelay = Math.max(0, bot.depthConfig?.delayMinMs ?? bot.minRepriceIntervalMs ?? 1500);
    const maxDelay = Math.max(minDelay, bot.depthConfig?.delayMaxMs ?? Math.max(minDelay, 4000));
    const randomizedDelay =
      maxDelay > minDelay ? minDelay + Math.floor(Math.random() * (maxDelay - minDelay)) : minDelay;

    if (lastRun > 0 && now - lastRun < randomizedDelay) {
      return;
    }
    this.botExecutionTimes.set(bot.id, now);

    // Get reference asset price
    const refSymbol = bot.mapping?.referenceMarketSymbol || 'BTCUSDT';
    const refAgg = this.priceAggregator.getAggregatedPrice(refSymbol);
    if (!refAgg || refAgg.status === 'INVALID' || refAgg.status === 'STALE' || refAgg.finalPrice <= 0) {
      this.dbMgr.execute(
        'UPDATE mm_bots SET error_message = ?, updated_at = ? WHERE id = ?',
        [`Waiting for valid reference feed (${refSymbol})`, now, bot.id]
      );
      return;
    }

    // Get Pair configuration from database
    const targetSymbolNormalized = bot.targetMarketSymbol.replace('_', '/');
    const pairRow = this.dbMgr.queryOne<any>(
      'SELECT * FROM market_pairs WHERE id = ? OR id = ? OR REPLACE(id, "/", "_") = ?',
      [bot.targetMarketSymbol, targetSymbolNormalized, bot.targetMarketSymbol]
    );
    if (!pairRow || !pairRow.is_active) {
      this.dbMgr.execute(
        'UPDATE mm_bots SET error_message = ?, updated_at = ? WHERE id = ?',
        [`Market pair ${bot.targetMarketSymbol} inactive or missing`, now, bot.id]
      );
      return;
    }

    const fxRate = this.priceAggregator.getFxRate();

    // Anti-Stacking protection: Cancel stale orders from this bot BEFORE reading available balances
    if (bot.riskProfile?.antiStackingActive ?? true) {
      await this.cancelExistingBotOrders(bot.id, bot.accountId, pairRow.id);
    }

    // Check balances (atomic -> human units)
    const basePrec = pairRow.base_precision !== undefined && pairRow.base_precision !== null ? Number(pairRow.base_precision) : 8;
    const quotePrec = pairRow.quote_precision !== undefined && pairRow.quote_precision !== null ? Number(pairRow.quote_precision) : 0;
    const baseBalRec = this.ledger.getBalance(bot.accountId, pairRow.base_asset);
    const quoteBalRec = this.ledger.getBalance(bot.accountId, pairRow.quote_asset);
    let remainingBaseBalance = (baseBalRec?.available || 0) / Math.pow(10, basePrec);
    let remainingQuoteBalance = (quoteBalRec?.available || 0) / Math.pow(10, quotePrec);

    const maxInventoryBase = bot.riskProfile?.maxInventoryBase ?? 1000;

    const ladder = buildQuantBotLadder({
      bot,
      refCurrent: refAgg.finalPrice,
      fxRateIdr: fxRate.usdtIdrRate || 18200,
      pairLastPrice: pairRow.last_price || 1000000000,
      amountDecimals: basePrec,
      priceDecimals: quotePrec,
      deterministic: false,
    });

    const newOrdersPlaced: string[] = [];
    let totalBidPlacedValue = 0;
    let totalAskPlacedQty = 0;
    let totalAskPlacedValue = 0;
    let lastError: string | null = ladder.warning || null;

    if (bot.dryRun) {
      // Dry-run mode simulates metrics without submitting orders to MatchingEngine
      this.dbMgr.execute(
        'UPDATE mm_bots SET last_repriced_at = ?, error_message = ?, updated_at = ? WHERE id = ?',
        [now, lastError, now, bot.id]
      );
      return;
    }

    // Place Bid Ladder (respecting maxInventoryBase & maxTotalBidValue)
    for (const bidLevel of ladder.bidLevels) {
      if (remainingBaseBalance >= maxInventoryBase) break;

      const orderValue = bidLevel.price * bidLevel.quantity;
      if (orderValue > remainingQuoteBalance) {
        lastError = `Insufficient ${pairRow.quote_asset} balance for Bid L${bidLevel.level}`;
        break;
      }

      const atomicAmount = Math.round(bidLevel.quantity * Math.pow(10, basePrec));
      if (atomicAmount < (pairRow.min_order_size || 1)) continue;

      try {
        const orderResult = await this.engineManager.submitOrder(pairRow.id, {
          userId: bot.accountId,
          side: 'BUY',
          orderType: 'LIMIT',
          price: Math.round(bidLevel.price * Math.pow(10, quotePrec)),
          amount: atomicAmount,
        });

        if (orderResult && orderResult.orderId) {
          newOrdersPlaced.push(orderResult.orderId);
          totalBidPlacedValue += orderValue;
          remainingQuoteBalance -= orderValue;
        }
      } catch (err: any) {
        lastError = err?.message || 'Bid order submission failed';
      }
    }

    // Place Ask Ladder (respecting maxTotalAskQty)
    for (const askLevel of ladder.askLevels) {
      if (askLevel.quantity > remainingBaseBalance) {
        lastError = `Insufficient ${pairRow.base_asset} balance for Ask L${askLevel.level}`;
        break;
      }

      const atomicAmount = Math.round(askLevel.quantity * Math.pow(10, basePrec));
      if (atomicAmount < (pairRow.min_order_size || 1)) continue;

      try {
        const orderResult = await this.engineManager.submitOrder(pairRow.id, {
          userId: bot.accountId,
          side: 'SELL',
          orderType: 'LIMIT',
          price: Math.round(askLevel.price * Math.pow(10, quotePrec)),
          amount: atomicAmount,
        });

        if (orderResult && orderResult.orderId) {
          newOrdersPlaced.push(orderResult.orderId);
          totalAskPlacedQty += askLevel.quantity;
          totalAskPlacedValue += askLevel.price * askLevel.quantity;
          remainingBaseBalance -= askLevel.quantity;
        }
      } catch (err: any) {
        lastError = err?.message || 'Ask order submission failed';
      }
    }

    // Record tracked orders
    let activeSet = this.botActiveOrderIds.get(bot.id);
    if (!activeSet) {
      activeSet = new Set();
      this.botActiveOrderIds.set(bot.id, activeSet);
    }
    for (const oid of newOrdersPlaced) {
      activeSet.add(oid);
    }

    const activeRow = this.dbMgr.queryOne<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM orders WHERE user_id = ? AND pair_id = ? AND status IN ('NEW', 'OPEN', 'PARTIALLY_FILLED')",
      [bot.accountId, pairRow.id]
    );

    // Update bot operational metrics in database
    this.dbMgr.execute(
      `UPDATE mm_bots
       SET active_open_orders_count = ?,
           total_bid_exposure = ?,
           total_ask_exposure = ?,
           current_base_inventory = ?,
           current_quote_inventory = ?,
           last_repriced_at = ?,
           error_message = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        activeRow ? activeRow.cnt : activeSet.size,
        Math.round(totalBidPlacedValue),
        Math.round(totalAskPlacedValue),
        remainingBaseBalance,
        remainingQuoteBalance,
        now,
        lastError,
        now,
        bot.id,
      ]
    );
  }

  private async cancelExistingBotOrders(botId: string, userId: string, pairId: string): Promise<number> {
    const existingOrders = this.dbMgr.query<any>(
      "SELECT id FROM orders WHERE user_id = ? AND pair_id = ? AND status IN ('NEW', 'OPEN', 'PARTIALLY_FILLED')",
      [userId, pairId]
    );

    let cancelled = 0;
    for (const ord of existingOrders) {
      try {
        await this.engineManager.cancelOrder(pairId, ord.id, userId);
        cancelled++;
      } catch {}
    }

    this.botActiveOrderIds.delete(botId);
    return cancelled;
  }
}
