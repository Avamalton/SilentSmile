import crypto from 'node:crypto';
import { DatabaseManager } from '../../db/database';
import { LedgerService } from '../../ledger/ledgerService';
import { EngineManager } from '../../engine/engineManager';
import { MarketPairConfig } from '../../engine/matchingEngine';
import { PriceAggregatorWorker } from '../../workers/priceAggregatorWorker';
import { PrecisionMath } from '../../ledger/PrecisionMath';
import {
  VolumeBotCheckpoint,
  VolumeBotConfig,
  VolumeBotDTO,
  VolumeBotEnvironment,
  VolumeBotExecutionMode,
  VolumeBotLogRow,
  VolumeBotOrderRow,
  VolumeBotRiskState,
  VolumeBotRow,
  VolumeBotSide,
  VolumeBotStatus,
  VolumeBotStrategy,
  VolumeBotTradeRow,
} from '../../db/types';

export interface BotActor {
  userId: string;
  role: string;
}

export interface LegacyAutoTradeInput {
  id?: string;
  targetPair: string;
  targetVolume: number;
  accumulatedVolume?: number;
  minOrderSize: number;
  maxOrderSize: number;
  intervalSeconds: number;
  executionMode: 'buy_first' | 'sell_first' | 'random';
  trendStrategy?: 'trend_up' | 'trend_down' | 'neutral';
  autoStopOnTarget?: boolean;
  enabled?: boolean;
  accountId?: string;
  environment?: VolumeBotEnvironment;
}

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultCheckpoint(): VolumeBotCheckpoint {
  return {
    nextScheduledAt: 0,
    sliceIndex: 0,
    recentOrderTimestamps: [],
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastIdempotencyNonce: 0,
    lastReferencePriceAtomic: '0',
    lastSliceRetryCount: 0,
    lastActionReason: 'INITIALIZED',
  };
}

function defaultRiskState(): VolumeBotRiskState {
  return {
    riskLocked: false,
    riskLockReason: null,
    emergencyStopped: false,
    lastRiskCheckAt: 0,
    lastBalanceAvailableBaseAtomic: '0',
    lastBalanceAvailableQuoteAtomic: '0',
    lastBalanceLockedBaseAtomic: '0',
    lastBalanceLockedQuoteAtomic: '0',
    openOrdersCount: 0,
    activeExposureQuoteAtomic: '0',
    staleDataBlocked: false,
    collarBreaches: 0,
    slippageBreaches: 0,
    balanceRejections: 0,
    stpInterceptions: 0,
  };
}

export class VolumeExecutionV2Service {
  private dbMgr: DatabaseManager;
  private ledger: LedgerService;
  private engineManager: EngineManager;
  private priceAggregator?: PriceAggregatorWorker;

  private isRunning: boolean = false;
  private loopInterval: NodeJS.Timeout | null = null;
  private processingBotIds: Set<string> = new Set();

  constructor(
    dbMgr: DatabaseManager,
    ledger: LedgerService,
    engineManager: EngineManager,
    priceAggregator?: PriceAggregatorWorker
  ) {
    this.dbMgr = dbMgr;
    this.ledger = ledger;
    this.engineManager = engineManager;
    this.priceAggregator = priceAggregator;
  }

  public setPriceAggregator(aggregator: PriceAggregatorWorker): void {
    this.priceAggregator = aggregator;
  }

  public start(intervalMs: number = 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.recoverAll().catch((err) => {
      console.error('[VolumeExecutionV2Service] Startup recovery error:', err);
    });
    this.loopInterval = setInterval(() => {
      this.executeSchedulerTick().catch((err) => {
        console.error('[VolumeExecutionV2Service] Scheduler tick error:', err);
      });
    }, Math.max(250, intervalMs));
  }

  public stop(): void {
    this.isRunning = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }

  // =========================================================================
  // AUTHORIZATION & VALIDATION HELPERS
  // =========================================================================

  private assertAuthorizedForRead(actor: BotActor, bot: VolumeBotRow): void {
    if (actor.role === 'admin' || actor.role === 'compliance') return;
    if (actor.role === 'market_maker' && (bot.owner_id === actor.userId || bot.account_id === actor.userId || bot.account_id === 'usr_mm_01')) {
      return;
    }
    if (bot.owner_id === actor.userId || bot.account_id === actor.userId) return;
    throw new Error('Forbidden: You do not have access to this volume bot');
  }

  private assertAuthorizedForWrite(actor: BotActor, bot: VolumeBotRow): void {
    if (actor.role === 'admin') return;
    if (actor.role === 'market_maker' && (bot.owner_id === actor.userId || bot.account_id === actor.userId || bot.account_id === 'usr_mm_01')) {
      return;
    }
    if (bot.owner_id === actor.userId) return;
    throw new Error('Forbidden: Insufficient privileges to modify this volume bot');
  }

  private assertAccountExists(accountId: string, executionMode: VolumeBotExecutionMode): void {
    if (executionMode === 'SIMULATION') return;
    const user = this.dbMgr.queryOne<{ id: string; status: string }>('SELECT id, status FROM users WHERE id = ?', [accountId]);
    if (!user) {
      throw new Error(`Execution account "${accountId}" does not exist for LIVE execution`);
    }
    if (user.status !== 'active') {
      throw new Error(`Execution account "${accountId}" is not active (status=${user.status})`);
    }
  }

  private getPairConfigStrict(pairId: string): MarketPairConfig {
    const resolved = this.engineManager.resolvePairId(pairId);
    if (!resolved) {
      throw new Error(`Market pair "${pairId}" is not registered`);
    }
    return this.engineManager.getPairConfig(resolved);
  }

  private normalizeAndValidateConfig(
    raw: Partial<VolumeBotConfig>,
    actor: BotActor
  ): { config: VolumeBotConfig; pair: MarketPairConfig; targetQtyAtomic: bigint } {
    if (!raw.pairId) throw new Error('pairId is required');
    const pair = this.getPairConfigStrict(raw.pairId);

    const environment: VolumeBotEnvironment = (['DEMO', 'SANDBOX', 'STAGING', 'PRODUCTION'].includes(
      String(raw.environment || 'DEMO').toUpperCase()
    )
      ? String(raw.environment || 'DEMO').toUpperCase()
      : 'DEMO') as VolumeBotEnvironment;

    const executionMode: VolumeBotExecutionMode =
      raw.executionMode === 'LIVE' ? 'LIVE' : 'SIMULATION';

    if (environment === 'PRODUCTION' && actor.role !== 'admin' && actor.role !== 'market_maker') {
      throw new Error('Forbidden: Only admin or market_maker can configure PRODUCTION bots');
    }

    const accountId = (raw.accountId || (actor.role === 'admin' ? 'usr_mm_01' : actor.userId)).trim();
    this.assertAccountExists(accountId, executionMode);

    const executionSide: VolumeBotSide = raw.executionSide === 'SELL' ? 'SELL' : 'BUY';
    const validStrategies: VolumeBotStrategy[] = [
      'TWAP',
      'VWAP',
      'ICEBERG',
      'PASSIVE_LIMIT',
      'AGGRESSIVE_LIMIT',
    ];
    const strategy: VolumeBotStrategy = validStrategies.includes(raw.strategy as VolumeBotStrategy)
      ? (raw.strategy as VolumeBotStrategy)
      : 'TWAP';

    const botName = (raw.botName || `${pair.id} ${strategy} Volume Bot`).trim();
    if (!botName) throw new Error('botName is required');

    const defaultTick = pair.quotePrecision === 0 ? '100' : PrecisionMath.formatAtomicToDecimal(1n, pair.quotePrecision);
    const defaultLot = PrecisionMath.formatAtomicToDecimal(BigInt(Math.max(1, pair.minOrderSize)), pair.basePrecision);

    const tickSizeStr = String(raw.tickSize ?? defaultTick);
    const lotSizeStr = String(raw.lotSize ?? defaultLot);
    const tickAtomic = PrecisionMath.parseDecimalToAtomic(tickSizeStr, pair.quotePrecision);
    const lotAtomic = PrecisionMath.parseDecimalToAtomic(lotSizeStr, pair.basePrecision);
    if (tickAtomic <= 0n) throw new Error('tickSize must be greater than zero');
    if (lotAtomic <= 0n) throw new Error('lotSize must be greater than zero');

    const rawTargetAtomic = PrecisionMath.parseDecimalToAtomic(raw.targetVolume ?? '0', pair.basePrecision);
    const targetQtyAtomic = PrecisionMath.normalizeQtyToLot(rawTargetAtomic, lotAtomic, 'floor');
    if (targetQtyAtomic <= 0n) throw new Error('targetVolume must be greater than zero and at least 1 lot');

    const rawMinSliceAtomic = PrecisionMath.parseDecimalToAtomic(raw.minSliceSize ?? lotSizeStr, pair.basePrecision);
    const minSliceAtomic = PrecisionMath.maxBigInt(
      BigInt(pair.minOrderSize),
      PrecisionMath.normalizeQtyToLot(rawMinSliceAtomic, lotAtomic, 'ceil')
    );

    const rawMaxSliceAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxSliceSize ?? String(raw.targetVolume ?? lotSizeStr), pair.basePrecision);
    let maxSliceAtomic = PrecisionMath.normalizeQtyToLot(rawMaxSliceAtomic, lotAtomic, 'floor');
    if (maxSliceAtomic < minSliceAtomic) maxSliceAtomic = minSliceAtomic;

    if (raw.maxOrderQty !== undefined && raw.maxOrderQty !== '') {
      const maxOrderQtyAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxOrderQty, pair.basePrecision);
      if (maxOrderQtyAtomic > 0n && maxOrderQtyAtomic < minSliceAtomic) {
        throw new Error('maxOrderQty cannot be smaller than minSliceSize');
      }
    }

    const minIntervalMs = Math.max(250, Math.trunc(Number(raw.minIntervalMs ?? 3000)));
    const maxIntervalMs = Math.max(minIntervalMs, Math.trunc(Number(raw.maxIntervalMs ?? Math.max(minIntervalMs, 8000))));
    const maxOrdersPerMinute = Math.max(1, Math.min(600, Math.trunc(Number(raw.maxOrdersPerMinute ?? 20))));
    const orderTimeoutMs = Math.max(1000, Math.trunc(Number(raw.orderTimeoutMs ?? 30000)));
    const partialFillRetryLimit = Math.max(0, Math.min(20, Math.trunc(Number(raw.partialFillRetryLimit ?? 3))));
    const cooldownAfterFailureMs = Math.max(0, Math.trunc(Number(raw.cooldownAfterFailureMs ?? 5000)));
    const pauseBetweenWindowsMs = Math.max(0, Math.trunc(Number(raw.pauseBetweenWindowsMs ?? 0)));

    const minCollarAtomic = PrecisionMath.parseDecimalToAtomic(raw.minPriceCollar ?? '0', pair.quotePrecision);
    const maxCollarAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxPriceCollar ?? '0', pair.quotePrecision);
    if (minCollarAtomic > 0n && maxCollarAtomic > 0n && minCollarAtomic > maxCollarAtomic) {
      throw new Error('minPriceCollar cannot exceed maxPriceCollar');
    }

    const maxSlippageBps = Math.max(1, Math.min(5000, Math.trunc(Number(raw.maxSlippageBps ?? 100))));
    const maxParticipationRateBps = Math.max(1, Math.min(10000, Math.trunc(Number(raw.maxParticipationRateBps ?? 3000))));
    const staleMarketDataMaxAgeMs = Math.max(1000, Math.trunc(Number(raw.staleMarketDataMaxAgeMs ?? 30000)));

    const maxOpenOrders = Math.max(1, Math.min(100, Math.trunc(Number(raw.maxOpenOrders ?? 5))));
    const maxOrderNotionalAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxOrderNotional ?? '0', pair.quotePrecision);
    const maxCumulativeExposureAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxCumulativeExposure ?? '0', pair.quotePrecision);
    const dailyExecutionLimitAtomic = PrecisionMath.parseDecimalToAtomic(raw.dailyExecutionLimit ?? '0', pair.quotePrecision);
    const maxBaseInventoryAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxBaseInventory ?? '0', pair.basePrecision);
    const maxQuoteInventoryAtomic = PrecisionMath.parseDecimalToAtomic(raw.maxQuoteInventory ?? '0', pair.quotePrecision);

    const config: VolumeBotConfig = {
      botName,
      presetId: raw.presetId || 'CUSTOM',
      pairId: pair.id,
      accountId,
      environment,
      executionMode,
      executionSide,
      targetVolume: PrecisionMath.formatAtomicToDecimal(targetQtyAtomic, pair.basePrecision, true),
      minSliceSize: PrecisionMath.formatAtomicToDecimal(minSliceAtomic, pair.basePrecision, true),
      maxSliceSize: PrecisionMath.formatAtomicToDecimal(maxSliceAtomic, pair.basePrecision, true),
      autoStopOnTarget: raw.autoStopOnTarget !== false,
      maxOrderQty: raw.maxOrderQty ? String(raw.maxOrderQty) : undefined,
      minIntervalMs,
      maxIntervalMs,
      executionWindowStartMs: raw.executionWindowStartMs ?? null,
      executionWindowEndMs: raw.executionWindowEndMs ?? null,
      pauseBetweenWindowsMs,
      maxOrdersPerMinute,
      orderTimeoutMs,
      partialFillRetryLimit,
      cooldownAfterFailureMs,
      strategy,
      twapDurationMs: Math.max(minIntervalMs, Math.trunc(Number(raw.twapDurationMs ?? 300000))),
      vwapLookbackMinutes: Math.max(1, Math.trunc(Number(raw.vwapLookbackMinutes ?? 30))),
      icebergVisibleRatioPct: Math.max(1, Math.min(100, Math.trunc(Number(raw.icebergVisibleRatioPct ?? 20)))),
      passiveOffsetTicks: Math.max(0, Math.trunc(Number(raw.passiveOffsetTicks ?? 1))),
      aggressiveMaxTicks: Math.max(0, Math.trunc(Number(raw.aggressiveMaxTicks ?? 2))),
      referencePriceSource: (['INTERNAL_BOOK', 'AGGREGATED_FEED', 'HYBRID'].includes(
        String(raw.referencePriceSource || 'HYBRID')
      )
        ? raw.referencePriceSource
        : 'HYBRID') as VolumeBotConfig['referencePriceSource'],
      minPriceCollar: PrecisionMath.formatAtomicToDecimal(minCollarAtomic, pair.quotePrecision, true),
      maxPriceCollar: PrecisionMath.formatAtomicToDecimal(maxCollarAtomic, pair.quotePrecision, true),
      maxSlippageBps,
      maxParticipationRateBps,
      staleMarketDataMaxAgeMs,
      tickSize: PrecisionMath.formatAtomicToDecimal(tickAtomic, pair.quotePrecision, true),
      lotSize: PrecisionMath.formatAtomicToDecimal(lotAtomic, pair.basePrecision, true),
      maxBaseInventory: PrecisionMath.formatAtomicToDecimal(maxBaseInventoryAtomic, pair.basePrecision, true),
      maxQuoteInventory: PrecisionMath.formatAtomicToDecimal(maxQuoteInventoryAtomic, pair.quotePrecision, true),
      maxOrderNotional: PrecisionMath.formatAtomicToDecimal(maxOrderNotionalAtomic, pair.quotePrecision, true),
      maxCumulativeExposure: PrecisionMath.formatAtomicToDecimal(maxCumulativeExposureAtomic, pair.quotePrecision, true),
      dailyExecutionLimit: PrecisionMath.formatAtomicToDecimal(dailyExecutionLimitAtomic, pair.quotePrecision, true),
      maxOpenOrders,
      selfTradePrevention: true,
    };

    return { config, pair, targetQtyAtomic };
  }

  // =========================================================================
  // CRUD, LIFECYCLE, CLONE, MIGRATION & VERSION ROLLBACK
  // =========================================================================

  public createBot(rawConfig: Partial<VolumeBotConfig>, actor: BotActor, options?: { deploy?: boolean; migratedFromLegacyId?: string }): VolumeBotDTO {
    const { config, pair, targetQtyAtomic } = this.normalizeAndValidateConfig(rawConfig, actor);
    const botId = `vbot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    const status: VolumeBotStatus = options?.deploy ? 'READY' : 'DRAFT';
    const checkpoint = defaultCheckpoint();
    const riskState = defaultRiskState();

    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `INSERT INTO volume_bots (
          id, name, owner_id, account_id, pair_id, environment, execution_mode, execution_side,
          strategy, status, enabled, config_version, config_json, target_qty_atomic, remaining_qty_atomic,
          executed_qty_atomic, executed_quote_atomic, total_fees_atomic, weighted_price_num_atomic,
          daily_executed_quote_atomic, daily_reset_day, checkpoint_json, risk_state_json,
          migrated_from_legacy_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, '0', '0', '0', '0', '0', ?, ?, ?, ?, ?, ?)`,
        [
          botId,
          config.botName,
          actor.userId,
          config.accountId,
          pair.id,
          config.environment,
          config.executionMode,
          config.executionSide,
          config.strategy,
          status,
          JSON.stringify(config),
          targetQtyAtomic.toString(),
          targetQtyAtomic.toString(),
          currentUtcDay(),
          JSON.stringify(checkpoint),
          JSON.stringify(riskState),
          options?.migratedFromLegacyId || null,
          now,
          now,
        ]
      );

      this.saveConfigVersionSnapshot(botId, 1, config, actor.userId, options?.migratedFromLegacyId ? 'MIGRATED_FROM_LEGACY' : 'INITIAL_CREATE');
      this.insertLog(botId, config.executionMode, 'INFO', 'BOT_CREATED', `Volume Bot "${config.botName}" created on ${pair.id} (${config.executionMode}/${config.environment})`, {
        strategy: config.strategy,
        targetVolume: config.targetVolume,
      });
    });

    return this.getBotById(botId, actor);
  }

  public updateBot(botId: string, rawConfig: Partial<VolumeBotConfig>, actor: BotActor): VolumeBotDTO {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status === 'RUNNING') {
      throw new Error('Pause or stop the bot before editing configuration');
    }

    const existingConfig = this.parseConfig(row);
    const merged: Partial<VolumeBotConfig> = { ...existingConfig, ...rawConfig };
    const { config, pair, targetQtyAtomic } = this.normalizeAndValidateConfig(merged, actor);

    const executedQtyAtomic = PrecisionMath.safeBigInt(row.executed_qty_atomic);
    const remainingQtyAtomic =
      targetQtyAtomic > executedQtyAtomic ? targetQtyAtomic - executedQtyAtomic : 0n;
    const nextVersion = row.config_version + 1;
    const now = Date.now();

    let nextStatus: VolumeBotStatus = row.status;
    if (row.status === 'COMPLETED' && remainingQtyAtomic > 0n) {
      nextStatus = 'READY';
    }

    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `UPDATE volume_bots
         SET name = ?, account_id = ?, pair_id = ?, environment = ?, execution_mode = ?,
             execution_side = ?, strategy = ?, status = ?, config_version = ?, config_json = ?,
             target_qty_atomic = ?, remaining_qty_atomic = ?, updated_at = ?
         WHERE id = ?`,
        [
          config.botName,
          config.accountId,
          pair.id,
          config.environment,
          config.executionMode,
          config.executionSide,
          config.strategy,
          nextStatus,
          nextVersion,
          JSON.stringify(config),
          targetQtyAtomic.toString(),
          remainingQtyAtomic.toString(),
          now,
          botId,
        ]
      );
      this.saveConfigVersionSnapshot(botId, nextVersion, config, actor.userId, 'CONFIG_UPDATED');
      this.insertLog(botId, config.executionMode, 'INFO', 'BOT_CONFIG_UPDATED', `Configuration updated to v${nextVersion}`, {
        strategy: config.strategy,
        targetVolume: config.targetVolume,
      });
    });

    return this.getBotById(botId, actor);
  }

  public rollbackBotConfig(botId: string, targetVersion: number, actor: BotActor): VolumeBotDTO {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status === 'RUNNING') {
      throw new Error('Pause or stop the bot before rolling back configuration');
    }

    const snap = this.dbMgr.queryOne<{ config_json: string }>(
      'SELECT config_json FROM volume_bot_config_versions WHERE bot_id = ? AND config_version = ?',
      [botId, targetVersion]
    );
    if (!snap) {
      throw new Error(`Configuration version v${targetVersion} not found for bot ${botId}`);
    }

    const parsed = JSON.parse(snap.config_json) as Partial<VolumeBotConfig>;
    const updated = this.updateBot(botId, parsed, actor);
    this.insertLog(botId, updated.executionMode, 'WARN', 'CONFIG_ROLLBACK', `Rolled back configuration from snapshot v${targetVersion}`, {
      restoredVersion: targetVersion,
      newVersion: updated.configVersion,
    });
    return updated;
  }

  public deployBot(botId: string, actor: BotActor): VolumeBotDTO {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status === 'RUNNING') {
      throw new Error('Bot is already RUNNING');
    }

    const config = this.parseConfig(row);
    this.assertAccountExists(row.account_id, row.execution_mode);

    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'READY', emergency_stopped = 0, last_error = NULL, updated_at = ? WHERE id = ?`,
      [Date.now(), botId]
    );
    this.insertLog(botId, config.executionMode, 'INFO', 'BOT_DEPLOYED', `Bot deployed and ready on ${row.pair_id}`);
    return this.getBotById(botId, actor);
  }

  public async startBot(botId: string, actor: BotActor): Promise<VolumeBotDTO> {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);

    const config = this.parseConfig(row);
    this.assertAccountExists(row.account_id, row.execution_mode);

    const remaining = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
    if (config.autoStopOnTarget && remaining <= 0n) {
      throw new Error('Target volume is already completed. Increase targetVolume or clone bot to start again.');
    }

    const riskState = this.parseRiskState(row);
    riskState.riskLocked = false;
    riskState.riskLockReason = null;
    riskState.emergencyStopped = false;

    const checkpoint = this.parseCheckpoint(row);
    checkpoint.cooldownUntil = 0;
    checkpoint.consecutiveFailures = 0;
    checkpoint.nextScheduledAt = 0;
    checkpoint.lastActionReason = 'STARTED';

    this.dbMgr.execute(
      `UPDATE volume_bots
       SET status = 'RUNNING', enabled = 1, emergency_stopped = 0, last_error = NULL,
           checkpoint_json = ?, risk_state_json = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(checkpoint), JSON.stringify(riskState), Date.now(), botId]
    );
    this.insertLog(botId, config.executionMode, 'INFO', 'BOT_STARTED', `Bot started in ${config.executionMode} mode (${config.strategy})`);

    return this.getBotById(botId, actor);
  }

  public async pauseBot(botId: string, actor: BotActor): Promise<VolumeBotDTO> {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);

    const cancelledCount = await this.cancelBotOwnedOpenOrders(row, 'BOT_PAUSED');
    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'PAUSED', enabled = 0, updated_at = ? WHERE id = ?`,
      [Date.now(), botId]
    );
    this.insertLog(botId, row.execution_mode, 'INFO', 'BOT_PAUSED', `Bot paused (cancelled ${cancelledCount} bot-owned open orders)`);
    return this.getBotById(botId, actor);
  }

  public async resumeBot(botId: string, actor: BotActor): Promise<VolumeBotDTO> {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    if (row.status !== 'PAUSED' && row.status !== 'READY' && row.status !== 'STOPPED' && row.status !== 'RISK_LOCKED') {
      throw new Error(`Cannot resume bot from status ${row.status}`);
    }
    return this.startBot(botId, actor);
  }

  public async stopBot(botId: string, actor: BotActor, reason: string = 'BOT_STOPPED'): Promise<VolumeBotDTO> {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);

    const cancelledCount = await this.cancelBotOwnedOpenOrders(row, reason);
    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'STOPPED', enabled = 0, updated_at = ? WHERE id = ?`,
      [Date.now(), botId]
    );
    this.insertLog(botId, row.execution_mode, 'INFO', 'BOT_STOPPED', `Bot stopped (${reason}); cancelled ${cancelledCount} bot-owned open orders`);
    return this.getBotById(botId, actor);
  }

  public async emergencyStopBot(botId: string, actor: BotActor, reason: string = 'OPERATOR_EMERGENCY_STOP'): Promise<VolumeBotDTO> {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);

    const cancelledCount = await this.cancelBotOwnedOpenOrders(row, reason);
    const riskState = this.parseRiskState(row);
    riskState.emergencyStopped = true;
    riskState.riskLocked = true;
    riskState.riskLockReason = reason;

    this.dbMgr.execute(
      `UPDATE volume_bots
       SET status = 'STOPPED', enabled = 0, emergency_stopped = 1, last_error = ?,
           risk_state_json = ?, updated_at = ?
       WHERE id = ?`,
      [reason, JSON.stringify(riskState), Date.now(), botId]
    );
    this.insertLog(botId, row.execution_mode, 'RISK', 'EMERGENCY_STOP', `Emergency stop triggered: ${reason} (cancelled ${cancelledCount} bot-owned orders)`);
    return this.getBotById(botId, actor);
  }

  public cloneBot(botId: string, actor: BotActor): VolumeBotDTO {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    const cfg = this.parseConfig(row);
    return this.createBot(
      {
        ...cfg,
        botName: `${cfg.botName} (Clone)`,
      },
      actor,
      { deploy: false }
    );
  }

  public async deleteBot(botId: string, actor: BotActor): Promise<void> {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForWrite(actor, row);
    await this.cancelBotOwnedOpenOrders(row, 'BOT_DELETED');
    this.dbMgr.execute('DELETE FROM volume_bots WHERE id = ?', [botId]);
  }

  public migrateLegacyAutoTradeBot(input: LegacyAutoTradeInput, actor: BotActor): VolumeBotDTO {
    const legacyKey = input.id || `legacy_${input.targetPair}`;
    const existing = this.dbMgr.queryOne<VolumeBotRow>(
      'SELECT * FROM volume_bots WHERE migrated_from_legacy_id = ?',
      [legacyKey]
    );
    if (existing) {
      return this.toDTO(existing);
    }

    const pair = this.getPairConfigStrict(input.targetPair);
    const side: VolumeBotSide = input.executionMode === 'sell_first' ? 'SELL' : 'BUY';
    const intervalMs = Math.max(1000, Math.round((input.intervalSeconds || 3) * 1000));
    const defaultLot = PrecisionMath.formatAtomicToDecimal(BigInt(pair.minOrderSize), pair.basePrecision);
    const defaultTick = pair.quotePrecision === 0 ? '100' : PrecisionMath.formatAtomicToDecimal(1n, pair.quotePrecision);

    const created = this.createBot(
      {
        botName: `${pair.id} Volume Bot (Migrated)`,
        presetId: 'CUSTOM',
        pairId: pair.id,
        accountId: input.accountId || (actor.role === 'admin' ? 'usr_mm_01' : actor.userId),
        environment: input.environment || 'DEMO',
        executionMode: 'SIMULATION',
        executionSide: side,
        targetVolume: String(input.targetVolume || 1),
        minSliceSize: String(Math.max(Number(defaultLot), input.minOrderSize || Number(defaultLot))),
        maxSliceSize: String(Math.max(input.maxOrderSize || 0.1, input.minOrderSize || Number(defaultLot))),
        autoStopOnTarget: input.autoStopOnTarget !== false,
        minIntervalMs: intervalMs,
        maxIntervalMs: intervalMs + 1000,
        pauseBetweenWindowsMs: 0,
        maxOrdersPerMinute: 30,
        orderTimeoutMs: 30000,
        partialFillRetryLimit: 3,
        cooldownAfterFailureMs: 5000,
        strategy: 'TWAP',
        twapDurationMs: Math.max(intervalMs * 10, 60000),
        referencePriceSource: 'HYBRID',
        minPriceCollar: '0',
        maxPriceCollar: '0',
        maxSlippageBps: 800,
        maxParticipationRateBps: 5000,
        staleMarketDataMaxAgeMs: 60000,
        tickSize: defaultTick,
        lotSize: defaultLot,
        maxBaseInventory: '0',
        maxQuoteInventory: '0',
        maxOrderNotional: '0',
        maxCumulativeExposure: '0',
        dailyExecutionLimit: '0',
        maxOpenOrders: 5,
        selfTradePrevention: true,
      },
      actor,
      { deploy: true, migratedFromLegacyId: legacyKey }
    );

    return created;
  }

  // =========================================================================
  // READS & QUERIES
  // =========================================================================

  public listBots(actor: BotActor, filters?: { environment?: string; executionMode?: string; pairId?: string }): VolumeBotDTO[] {
    let sql = 'SELECT * FROM volume_bots WHERE 1=1';
    const params: any[] = [];

    if (actor.role !== 'admin' && actor.role !== 'compliance') {
      if (actor.role === 'market_maker') {
        sql += " AND (owner_id = ? OR account_id = ? OR account_id = 'usr_mm_01')";
        params.push(actor.userId, actor.userId);
      } else {
        sql += ' AND (owner_id = ? OR account_id = ?)';
        params.push(actor.userId, actor.userId);
      }
    }

    if (filters?.environment) {
      sql += ' AND environment = ?';
      params.push(filters.environment.toUpperCase());
    }
    if (filters?.executionMode) {
      sql += ' AND execution_mode = ?';
      params.push(filters.executionMode.toUpperCase());
    }
    if (filters?.pairId) {
      sql += ' AND pair_id = ?';
      params.push(filters.pairId);
    }

    sql += ' ORDER BY updated_at DESC';
    const rows = this.dbMgr.query<VolumeBotRow>(sql, params);
    return rows.map((r) => this.toDTO(r));
  }

  public getBotById(botId: string, actor: BotActor): VolumeBotDTO {
    let row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    if (row.execution_mode === 'LIVE') {
      this.reconcileBotOrdersAndTradesSync(row, this.getPairConfigStrict(row.pair_id), Date.now());
      row = this.getRowStrict(botId);
    }
    return this.toDTO(row);
  }

  public getBotHistory(botId: string, actor: BotActor, limit: number = 100) {
    let row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    if (row.execution_mode === 'LIVE') {
      this.reconcileBotOrdersAndTradesSync(row, this.getPairConfigStrict(row.pair_id), Date.now());
    }
    const safeLimit = Math.max(1, Math.min(500, limit));

    const orders = this.dbMgr.query<VolumeBotOrderRow>(
      'SELECT * FROM volume_bot_orders WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?',
      [botId, safeLimit]
    );
    const trades = this.dbMgr.query<VolumeBotTradeRow>(
      'SELECT * FROM volume_bot_trades WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ?',
      [botId, safeLimit]
    );
    const simEvents = this.dbMgr.query<any>(
      'SELECT * FROM volume_bot_sim_events WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ?',
      [botId, safeLimit]
    );
    const configVersions = this.dbMgr.query<any>(
      'SELECT id, bot_id, config_version, changed_by, reason, created_at FROM volume_bot_config_versions WHERE bot_id = ? ORDER BY config_version DESC LIMIT 50',
      [botId]
    );

    return { orders, trades, simEvents, configVersions };
  }

  public getBotLogs(botId: string, actor: BotActor, limit: number = 100): VolumeBotLogRow[] {
    const row = this.getRowStrict(botId);
    this.assertAuthorizedForRead(actor, row);
    const safeLimit = Math.max(1, Math.min(500, limit));
    return this.dbMgr.query<VolumeBotLogRow>(
      'SELECT * FROM volume_bot_logs WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ?',
      [botId, safeLimit]
    );
  }

  // =========================================================================
  // AUTHORITATIVE SCHEDULER & EXECUTION CYCLE
  // =========================================================================

  public async executeSchedulerTick(nowMs: number = Date.now()): Promise<void> {
    const runningBots = this.dbMgr.query<VolumeBotRow>(
      "SELECT * FROM volume_bots WHERE status = 'RUNNING' AND enabled = 1 AND emergency_stopped = 0"
    );
    for (const botRow of runningBots) {
      await this.executeBotCycle(botRow.id, nowMs);
    }
  }

  public async executeBotCycle(botId: string, nowMs: number = Date.now()): Promise<VolumeBotDTO> {
    if (this.processingBotIds.has(botId)) {
      return this.toDTO(this.getRowStrict(botId));
    }
    this.processingBotIds.add(botId);

    try {
      let row = this.getRowStrict(botId);
      if (row.status !== 'RUNNING' || !row.enabled || row.emergency_stopped) {
        return this.toDTO(row);
      }

      const config = this.parseConfig(row);
      const pair = this.getPairConfigStrict(row.pair_id);
      const checkpoint = this.parseCheckpoint(row);
      const riskState = this.parseRiskState(row);

      // 0. Daily limit rollover check
      const today = currentUtcDay();
      if (row.daily_reset_day !== today) {
        this.dbMgr.execute(
          "UPDATE volume_bots SET daily_executed_quote_atomic = '0', daily_reset_day = ?, updated_at = ? WHERE id = ?",
          [today, nowMs, botId]
        );
        row = this.getRowStrict(botId);
      }

      // 1. Reconcile existing open orders & trades from authoritative DB BEFORE computing next slice
      await this.reconcileBotOrdersAndTrades(row, pair, nowMs);
      row = this.getRowStrict(botId);

      // 2. Check target completion (strictly from persisted executed trades)
      const remainingQty = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
      if (config.autoStopOnTarget && remainingQty <= 0n) {
        await this.cancelBotOwnedOpenOrders(row, 'TARGET_COMPLETED');
        this.dbMgr.execute(
          `UPDATE volume_bots SET status = 'COMPLETED', enabled = 0, updated_at = ? WHERE id = ?`,
          [nowMs, botId]
        );
        this.insertLog(botId, row.execution_mode, 'EXECUTION', 'TARGET_COMPLETED', 'Target execution volume reached 100% from verified trade records');
        return this.toDTO(this.getRowStrict(botId));
      }

      // 3. Cancel expired bot-owned orders & track partial fill retries
      await this.expireTimedOutOrders(row, config, checkpoint, riskState, nowMs);
      row = this.getRowStrict(botId);

      // Check partial fill retry limit
      if (checkpoint.lastSliceRetryCount > config.partialFillRetryLimit && config.partialFillRetryLimit > 0) {
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        await this.lockBotRisk(row, riskState, `PARTIAL_FILL_RETRY_LIMIT_EXCEEDED (${checkpoint.lastSliceRetryCount}/${config.partialFillRetryLimit})`, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }

      // 4. Market trading status check
      if (!pair.isActive || pair.tradingStatus !== 'OPEN') {
        checkpoint.lastActionReason = `MARKET_NOT_OPEN (${pair.tradingStatus})`;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }

      // 5. Execution window & cooldown checks
      if (config.executionWindowStartMs && nowMs < config.executionWindowStartMs) {
        checkpoint.lastActionReason = 'BEFORE_EXECUTION_WINDOW';
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      if (config.executionWindowEndMs && nowMs > config.executionWindowEndMs) {
        await this.cancelBotOwnedOpenOrders(row, 'EXECUTION_WINDOW_ENDED');
        this.dbMgr.execute("UPDATE volume_bots SET status = 'PAUSED', enabled = 0, updated_at = ? WHERE id = ?", [nowMs, botId]);
        this.insertLog(botId, row.execution_mode, 'INFO', 'WINDOW_ENDED', 'Execution window ended; bot paused');
        return this.toDTO(this.getRowStrict(botId));
      }
      if (checkpoint.cooldownUntil > nowMs) {
        checkpoint.lastActionReason = 'COOLDOWN_ACTIVE';
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }
      if (checkpoint.nextScheduledAt > nowMs) {
        return this.toDTO(row);
      }

      // 6. Rate limit check (maxOrdersPerMinute)
      const oneMinuteAgo = nowMs - 60000;
      checkpoint.recentOrderTimestamps = (checkpoint.recentOrderTimestamps || []).filter((ts) => ts >= oneMinuteAgo);
      if (checkpoint.recentOrderTimestamps.length >= config.maxOrdersPerMinute) {
        checkpoint.lastActionReason = 'RATE_LIMIT_MAX_ORDERS_PER_MIN';
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }

      // 7. Open orders cap check
      const openBotOrders = this.getOpenBotOrders(botId);
      riskState.openOrdersCount = openBotOrders.length;
      if (openBotOrders.length >= config.maxOpenOrders) {
        checkpoint.lastActionReason = `MAX_OPEN_ORDERS_REACHED (${openBotOrders.length}/${config.maxOpenOrders})`;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }

      // For ICEBERG, wait until active visible clip resolves before placing next clip
      if (config.strategy === 'ICEBERG' && openBotOrders.length > 0) {
        checkpoint.lastActionReason = 'ICEBERG_WAITING_VISIBLE_CLIP';
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        return this.toDTO(this.getRowStrict(botId));
      }

      // 8. Reference price & stale data protection
      const refCheck = this.resolveReferencePriceAtomic(pair, config, nowMs);
      if (!refCheck.ok || refCheck.priceAtomic <= 0n) {
        if (refCheck.stale) riskState.staleDataBlocked = true;
        checkpoint.lastActionReason = refCheck.reason;
        checkpoint.cooldownUntil = nowMs + config.cooldownAfterFailureMs;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        this.insertLog(botId, row.execution_mode, 'RISK', 'REF_PRICE_BLOCKED', refCheck.reason);
        return this.toDTO(this.getRowStrict(botId));
      }
      riskState.staleDataBlocked = false;
      const refPriceAtomic = refCheck.priceAtomic;
      checkpoint.lastReferencePriceAtomic = refPriceAtomic.toString();

      // 9. Determine strategy slice size & limit price
      const plan = this.planStrategySlice(row, config, pair, refPriceAtomic, openBotOrders, nowMs);
      if (!plan.ok) {
        if (plan.riskCode === 'COLLAR') riskState.collarBreaches += 1;
        if (plan.riskCode === 'SLIPPAGE') riskState.slippageBreaches += 1;
        if (plan.riskCode === 'STP') riskState.stpInterceptions += 1;
        checkpoint.lastActionReason = plan.reason;
        checkpoint.nextScheduledAt = nowMs + this.computeNextDelayMs(config, checkpoint.sliceIndex);
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        this.insertLog(botId, row.execution_mode, plan.riskCode ? 'RISK' : 'WARN', plan.riskCode || 'SLICE_SKIPPED', plan.reason);
        return this.toDTO(this.getRowStrict(botId));
      }

      // 10. Pre-trade Risk, Exposure, Inventory & Balance checks (ZERO artificial balance injection!)
      const riskDecision = this.checkPreTradeRiskAndBalances(
        row,
        config,
        pair,
        plan.orderPriceAtomic,
        plan.sliceQtyAtomic,
        openBotOrders,
        riskState,
        nowMs
      );
      if (!riskDecision.ok) {
        const formattedReason = `[${riskDecision.code}] ${riskDecision.reason}`;
        checkpoint.consecutiveFailures += 1;
        checkpoint.cooldownUntil = nowMs + config.cooldownAfterFailureMs;
        checkpoint.lastActionReason = formattedReason;
        this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);
        if (riskDecision.hardLock) {
          await this.lockBotRisk(row, riskState, formattedReason, nowMs);
        } else {
          this.insertLog(botId, row.execution_mode, 'RISK', riskDecision.code, formattedReason);
        }
        return this.toDTO(this.getRowStrict(botId));
      }

      // 11. Submit order via Idempotency Key (SIMULATION isolated vs LIVE MatchingEngine)
      checkpoint.sliceIndex += 1;
      checkpoint.lastIdempotencyNonce += 1;
      const idempotencyKey = `vbot_${botId}_v${row.config_version}_s${checkpoint.sliceIndex}_n${checkpoint.lastIdempotencyNonce}`;

      await this.submitPlannedSliceOrder({
        row,
        config,
        pair,
        orderPriceAtomic: plan.orderPriceAtomic,
        sliceQtyAtomic: plan.sliceQtyAtomic,
        refPriceAtomic,
        idempotencyKey,
        checkpoint,
        riskState,
        nowMs,
      });

      // Schedule next cycle
      checkpoint.consecutiveFailures = 0;
      checkpoint.recentOrderTimestamps.push(nowMs);
      checkpoint.nextScheduledAt = nowMs + this.computeNextDelayMs(config, checkpoint.sliceIndex);
      checkpoint.lastActionReason = 'ORDER_SUBMITTED';

      this.saveCheckpointAndRisk(botId, checkpoint, riskState, nowMs);

      // Re-check completion immediately if fills completed target
      const refreshed = this.getRowStrict(botId);
      if (config.autoStopOnTarget && PrecisionMath.safeBigInt(refreshed.remaining_qty_atomic) <= 0n) {
        await this.cancelBotOwnedOpenOrders(refreshed, 'TARGET_COMPLETED');
        this.dbMgr.execute("UPDATE volume_bots SET status = 'COMPLETED', enabled = 0, updated_at = ? WHERE id = ?", [nowMs, botId]);
        this.insertLog(botId, refreshed.execution_mode, 'EXECUTION', 'TARGET_COMPLETED', 'Target volume completed 100%');
      }

      return this.toDTO(this.getRowStrict(botId));
    } finally {
      this.processingBotIds.delete(botId);
    }
  }

  // =========================================================================
  // ORDER SUBMISSION (IDEMPOTENT, SIMULATION-ISOLATED, LIVE-ENGINE)
  // =========================================================================

  public async submitIdempotentOrderForBot(params: {
    botId: string;
    idempotencyKey: string;
    priceAtomic: bigint;
    amountAtomic: bigint;
    nowMs?: number;
  }): Promise<{ order: VolumeBotOrderRow; duplicate: boolean }> {
    const existing = this.dbMgr.queryOne<VolumeBotOrderRow>(
      'SELECT * FROM volume_bot_orders WHERE idempotency_key = ?',
      [params.idempotencyKey]
    );
    if (existing) {
      return { order: existing, duplicate: true };
    }

    const row = this.getRowStrict(params.botId);
    const config = this.parseConfig(row);
    const pair = this.getPairConfigStrict(row.pair_id);
    const checkpoint = this.parseCheckpoint(row);
    const riskState = this.parseRiskState(row);
    const nowMs = params.nowMs ?? Date.now();
    const refCheck = this.resolveReferencePriceAtomic(pair, config, nowMs);
    const refPriceAtomic = refCheck.priceAtomic > 0n ? refCheck.priceAtomic : params.priceAtomic;

    await this.submitPlannedSliceOrder({
      row,
      config,
      pair,
      orderPriceAtomic: params.priceAtomic,
      sliceQtyAtomic: params.amountAtomic,
      refPriceAtomic,
      idempotencyKey: params.idempotencyKey,
      checkpoint,
      riskState,
      nowMs,
    });

    const created = this.dbMgr.queryOne<VolumeBotOrderRow>(
      'SELECT * FROM volume_bot_orders WHERE idempotency_key = ?',
      [params.idempotencyKey]
    );
    if (!created) throw new Error('Order persistence failed');
    return { order: created, duplicate: false };
  }

  private async submitPlannedSliceOrder(params: {
    row: VolumeBotRow;
    config: VolumeBotConfig;
    pair: MarketPairConfig;
    orderPriceAtomic: bigint;
    sliceQtyAtomic: bigint;
    refPriceAtomic: bigint;
    idempotencyKey: string;
    checkpoint: VolumeBotCheckpoint;
    riskState: VolumeBotRiskState;
    nowMs: number;
  }): Promise<void> {
    const { row, config, pair, orderPriceAtomic, sliceQtyAtomic, refPriceAtomic, idempotencyKey, nowMs } = params;

    // Idempotency guard
    const dup = this.dbMgr.queryOne<VolumeBotOrderRow>(
      'SELECT * FROM volume_bot_orders WHERE idempotency_key = ?',
      [idempotencyKey]
    );
    if (dup) return;

    const expiresAt = nowMs + config.orderTimeoutMs;

    if (row.execution_mode === 'SIMULATION') {
      // Strictly isolated SIMULATION: NEVER touch ledger_accounts, orders, or real trades!
      const simOrderId = `simord_${crypto.randomBytes(8).toString('hex')}`;
      this.dbMgr.execute(
        `INSERT INTO volume_bot_orders (
          id, bot_id, idempotency_key, pair_id, execution_mode, side, order_type,
          price_atomic, amount_atomic, filled_amount_atomic, remaining_amount_atomic,
          status, retry_count, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'SIMULATION', ?, 'LIMIT', ?, ?, '0', ?, 'ACCEPTED', 0, ?, ?, ?)`,
        [
          simOrderId,
          row.id,
          idempotencyKey,
          pair.id,
          row.execution_side,
          orderPriceAtomic.toString(),
          sliceQtyAtomic.toString(),
          sliceQtyAtomic.toString(),
          expiresAt,
          nowMs,
          nowMs,
        ]
      );

      this.dbMgr.execute(
        'UPDATE volume_bots SET submitted_orders_count = submitted_orders_count + 1, accepted_orders_count = accepted_orders_count + 1, last_execution_at = ?, updated_at = ? WHERE id = ?',
        [nowMs, nowMs, row.id]
      );

      // Evaluate simulated fill strictly against read-only book liquidity (without mutating real book/ledger!)
      const simMatch = this.evaluateSimulatedMatch(pair, row.execution_side, orderPriceAtomic, sliceQtyAtomic, row.account_id);
      if (simMatch.filledAtomic > 0n) {
        const simTradeId = `simtrd_${crypto.randomBytes(8).toString('hex')}`;
        const feeBps = simMatch.isTaker ? pair.takerFeeBps : pair.makerFeeBps;
        const feeAsset = row.execution_side === 'BUY' ? pair.baseAsset : pair.quoteAsset;
        const feeBaseSource = row.execution_side === 'BUY' ? simMatch.filledAtomic : simMatch.quoteTotalAtomic;
        const { feeAtomic } = PrecisionMath.calculateFeeBpsAtomic(feeBaseSource, feeBps);
        const slippageBps = Number(PrecisionMath.computePriceDeviationBps(simMatch.execPriceAtomic, refPriceAtomic));

        this.dbMgr.runInTransaction(() => {
          const remainingAfter = sliceQtyAtomic - simMatch.filledAtomic;
          const nextOrdStatus = remainingAfter === 0n ? 'FILLED' : 'PARTIALLY_FILLED';
          this.dbMgr.execute(
            `UPDATE volume_bot_orders
             SET filled_amount_atomic = ?, remaining_amount_atomic = ?, status = ?, updated_at = ?
             WHERE id = ?`,
            [simMatch.filledAtomic.toString(), remainingAfter.toString(), nextOrdStatus, nowMs, simOrderId]
          );
          this.dbMgr.execute(
            `INSERT INTO volume_bot_sim_events (
              id, bot_id, pair_id, event_type, side, price_atomic, amount_atomic, quote_total_atomic,
              fee_atomic, order_id, trade_id, details_json, timestamp
            ) VALUES (?, ?, ?, 'SIM_FILL', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `simevt_${crypto.randomBytes(8).toString('hex')}`,
              row.id,
              pair.id,
              row.execution_side,
              simMatch.execPriceAtomic.toString(),
              simMatch.filledAtomic.toString(),
              simMatch.quoteTotalAtomic.toString(),
              feeAtomic.toString(),
              simOrderId,
              simTradeId,
              JSON.stringify({ strategy: config.strategy, referencePriceAtomic: refPriceAtomic.toString() }),
              nowMs,
            ]
          );
          this.recordBotTradeAtomic({
            botId: row.id,
            tradeId: simTradeId,
            orderId: simOrderId,
            pairId: pair.id,
            executionMode: 'SIMULATION',
            side: row.execution_side,
            priceAtomic: simMatch.execPriceAtomic,
            amountAtomic: simMatch.filledAtomic,
            quoteTotalAtomic: simMatch.quoteTotalAtomic,
            feeAtomic,
            feeAsset,
            slippageBps,
            timestamp: nowMs,
            orderStatusAfter: nextOrdStatus,
          });
        });

        this.insertLog(
          row.id,
          'SIMULATION',
          'EXECUTION',
          'SIM_TRADE_EXECUTED',
          `[SIM] Filled ${PrecisionMath.formatAtomicToDecimal(simMatch.filledAtomic, pair.basePrecision, true)} ${pair.baseAsset} @ ${PrecisionMath.formatAtomicToDecimal(simMatch.execPriceAtomic, pair.quotePrecision, true)} ${pair.quoteAsset}`,
          { orderId: simOrderId, tradeId: simTradeId, slippageBps }
        );
      } else {
        this.insertLog(
          row.id,
          'SIMULATION',
          'INFO',
          'SIM_ORDER_RESTING',
          `[SIM] Placed resting ${row.execution_side} LIMIT ${PrecisionMath.formatAtomicToDecimal(sliceQtyAtomic, pair.basePrecision, true)} ${pair.baseAsset} @ ${PrecisionMath.formatAtomicToDecimal(orderPriceAtomic, pair.quotePrecision, true)}`,
          { orderId: simOrderId }
        );
      }
      return;
    }

    // LIVE Execution through single authoritative MatchingEngine -> LedgerService
    const engine = this.engineManager.getEngine(pair.id);
    const liveOrderId = `vord_${crypto.randomBytes(8).toString('hex')}`;

    this.dbMgr.execute(
      `INSERT INTO volume_bot_orders (
        id, bot_id, idempotency_key, pair_id, execution_mode, side, order_type,
        price_atomic, amount_atomic, filled_amount_atomic, remaining_amount_atomic,
        status, retry_count, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'LIVE', ?, 'LIMIT', ?, ?, '0', ?, 'SUBMITTED', 0, ?, ?, ?)`,
      [
        liveOrderId,
        row.id,
        idempotencyKey,
        pair.id,
        row.execution_side,
        orderPriceAtomic.toString(),
        sliceQtyAtomic.toString(),
        sliceQtyAtomic.toString(),
        expiresAt,
        nowMs,
        nowMs,
      ]
    );
    this.dbMgr.execute(
      'UPDATE volume_bots SET submitted_orders_count = submitted_orders_count + 1, last_execution_at = ?, updated_at = ? WHERE id = ?',
      [nowMs, nowMs, row.id]
    );

    try {
      const result = await engine.submitOrder({
        orderId: liveOrderId,
        clientOrderId: idempotencyKey,
        userId: row.account_id,
        side: row.execution_side,
        orderType: 'LIMIT',
        price: Number(orderPriceAtomic),
        amount: Number(sliceQtyAtomic),
      });

      const mappedStatus =
        result.status === 'NEW'
          ? 'ACCEPTED'
          : result.status === 'PARTIALLY_FILLED'
          ? 'PARTIALLY_FILLED'
          : result.status === 'FILLED'
          ? 'FILLED'
          : result.status === 'CANCELLED'
          ? 'CANCELLED'
          : 'REJECTED';

      const dbOrder = this.dbMgr.queryOne<any>('SELECT filled_amount, remaining_amount FROM orders WHERE id = ?', [liveOrderId]);
      const filledAtomic = dbOrder ? PrecisionMath.safeBigInt(dbOrder.filled_amount) : 0n;
      const remainingAtomic = dbOrder ? PrecisionMath.safeBigInt(dbOrder.remaining_amount) : sliceQtyAtomic;

      this.dbMgr.runInTransaction(() => {
        this.dbMgr.execute(
          `UPDATE volume_bot_orders
           SET status = ?, filled_amount_atomic = ?, remaining_amount_atomic = ?, updated_at = ?
           WHERE id = ?`,
          [mappedStatus, filledAtomic.toString(), remainingAtomic.toString(), nowMs, liveOrderId]
        );
        this.dbMgr.execute(
          'UPDATE volume_bots SET accepted_orders_count = accepted_orders_count + 1, updated_at = ? WHERE id = ?',
          [nowMs, row.id]
        );

        for (const fill of result.fills) {
          const fillPriceAtomic = PrecisionMath.safeBigInt(fill.price);
          const fillAmountAtomic = PrecisionMath.safeBigInt(fill.amount);
          const fillTotalAtomic = PrecisionMath.safeBigInt(fill.total);
          const fillFeeAtomic = PrecisionMath.safeBigInt(fill.takerFee);
          const feeAsset = row.execution_side === 'BUY' ? pair.baseAsset : pair.quoteAsset;
          const slippageBps = Number(PrecisionMath.computePriceDeviationBps(fillPriceAtomic, refPriceAtomic));

          this.recordBotTradeAtomic({
            botId: row.id,
            tradeId: fill.id,
            orderId: liveOrderId,
            pairId: pair.id,
            executionMode: 'LIVE',
            side: row.execution_side,
            priceAtomic: fillPriceAtomic,
            amountAtomic: fillAmountAtomic,
            quoteTotalAtomic: fillTotalAtomic,
            feeAtomic: fillFeeAtomic,
            feeAsset,
            slippageBps,
            timestamp: fill.timestamp,
            orderStatusAfter: mappedStatus,
          });
        }
      });

      this.insertLog(
        row.id,
        'LIVE',
        result.fills.length > 0 ? 'EXECUTION' : 'INFO',
        result.fills.length > 0 ? 'LIVE_ORDER_FILLED' : 'LIVE_ORDER_ACCEPTED',
        `Order ${liveOrderId} -> ${mappedStatus} (${result.fills.length} fills)`,
        { orderId: liveOrderId, filledAtomic: filledAtomic.toString(), status: mappedStatus }
      );
    } catch (err: any) {
      const msg = err?.message || 'MatchingEngine order rejected';
      this.dbMgr.execute(
        `UPDATE volume_bot_orders SET status = 'REJECTED', last_error = ?, updated_at = ? WHERE id = ?`,
        [msg, nowMs, liveOrderId]
      );
      this.dbMgr.execute(
        'UPDATE volume_bots SET rejected_orders_count = rejected_orders_count + 1, last_error = ?, updated_at = ? WHERE id = ?',
        [msg, nowMs, row.id]
      );
      this.insertLog(row.id, 'LIVE', 'ERROR', 'LIVE_ORDER_REJECTED', msg, { orderId: liveOrderId });
      throw err;
    }
  }

  // =========================================================================
  // TRADE DEDUPLICATION & ACCOUNTING (STRICTLY TRADE-DRIVEN)
  // =========================================================================

  /**
   * Records a trade atomically ONLY ONCE per (botId, tradeId, executionMode).
   * Submitted/open/cancelled/rejected orders never call this and never increment executed volume.
   */
  public recordBotTradeAtomic(params: {
    botId: string;
    tradeId: string;
    orderId: string;
    pairId: string;
    executionMode: VolumeBotExecutionMode;
    side: VolumeBotSide;
    priceAtomic: bigint;
    amountAtomic: bigint;
    quoteTotalAtomic: bigint;
    feeAtomic: bigint;
    feeAsset: string;
    slippageBps: number;
    timestamp: number;
    orderStatusAfter?: string;
  }): boolean {
    if (params.amountAtomic <= 0n) return false;

    const existing = this.dbMgr.queryOne<{ id: string }>(
      'SELECT id FROM volume_bot_trades WHERE bot_id = ? AND trade_id = ? AND execution_mode = ?',
      [params.botId, params.tradeId, params.executionMode]
    );
    if (existing) {
      return false; // Duplicate trade prevented!
    }

    const bot = this.getRowStrict(params.botId);
    const targetAtomic = PrecisionMath.safeBigInt(bot.target_qty_atomic);
    const prevExecutedAtomic = PrecisionMath.safeBigInt(bot.executed_qty_atomic);
    const prevExecutedQuote = PrecisionMath.safeBigInt(bot.executed_quote_atomic);
    const prevTotalFees = PrecisionMath.safeBigInt(bot.total_fees_atomic);
    const prevWeightedNum = PrecisionMath.safeBigInt(bot.weighted_price_num_atomic);
    const prevDailyQuote =
      bot.daily_reset_day === currentUtcDay() ? PrecisionMath.safeBigInt(bot.daily_executed_quote_atomic) : 0n;
    const prevSlippageSum = PrecisionMath.safeBigInt(bot.total_slippage_bps_sum);

    const nextExecutedAtomic = prevExecutedAtomic + params.amountAtomic;
    const nextRemainingAtomic = targetAtomic > nextExecutedAtomic ? targetAtomic - nextExecutedAtomic : 0n;
    const nextExecutedQuote = prevExecutedQuote + params.quoteTotalAtomic;
    const nextTotalFees = prevTotalFees + params.feeAtomic;
    const nextWeightedNum = prevWeightedNum + params.priceAtomic * params.amountAtomic;
    const nextDailyQuote = prevDailyQuote + params.quoteTotalAtomic;
    const nextSlippageSum = prevSlippageSum + BigInt(Math.max(0, Math.trunc(params.slippageBps)));

    const partialDelta = params.orderStatusAfter === 'PARTIALLY_FILLED' ? 1 : 0;
    const filledDelta = params.orderStatusAfter === 'FILLED' ? 1 : 0;

    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `INSERT INTO volume_bot_trades (
          id, trade_id, bot_id, order_id, pair_id, execution_mode, side,
          price_atomic, amount_atomic, quote_total_atomic, fee_atomic, fee_asset, slippage_bps, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `vbtrd_${crypto.randomBytes(8).toString('hex')}`,
          params.tradeId,
          params.botId,
          params.orderId,
          params.pairId,
          params.executionMode,
          params.side,
          params.priceAtomic.toString(),
          params.amountAtomic.toString(),
          params.quoteTotalAtomic.toString(),
          params.feeAtomic.toString(),
          params.feeAsset,
          Math.max(0, Math.trunc(params.slippageBps)),
          params.timestamp,
        ]
      );

      this.dbMgr.execute(
        `UPDATE volume_bots
         SET executed_qty_atomic = ?, remaining_qty_atomic = ?, executed_quote_atomic = ?,
             total_fees_atomic = ?, weighted_price_num_atomic = ?, daily_executed_quote_atomic = ?,
             daily_reset_day = ?, total_trades_count = total_trades_count + 1,
             partial_fills_count = partial_fills_count + ?, filled_orders_count = filled_orders_count + ?,
             total_slippage_bps_sum = ?, last_execution_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          nextExecutedAtomic.toString(),
          nextRemainingAtomic.toString(),
          nextExecutedQuote.toString(),
          nextTotalFees.toString(),
          nextWeightedNum.toString(),
          nextDailyQuote.toString(),
          currentUtcDay(),
          partialDelta,
          filledDelta,
          nextSlippageSum.toString(),
          params.timestamp,
          Date.now(),
          params.botId,
        ]
      );
    });

    return true;
  }

  // =========================================================================
  // STRATEGY SLICING, PRICE PROTECTION, RISK & BALANCE CHECKS
  // =========================================================================

  private resolveReferencePriceAtomic(
    pair: MarketPairConfig,
    config: VolumeBotConfig,
    nowMs: number
  ): { ok: boolean; priceAtomic: bigint; reason: string; stale?: boolean } {
    const engine = this.engineManager.getEngine(pair.id);
    const depth = engine.getDepth(5);
    const bestBid = depth.bids[0]?.price || 0;
    const bestAsk = depth.asks[0]?.price || 0;

    let bookMidAtomic = 0n;
    if (bestBid > 0 && bestAsk > 0) {
      bookMidAtomic = (BigInt(bestBid) + BigInt(bestAsk)) / 2n;
    } else if (bestBid > 0) {
      bookMidAtomic = BigInt(bestBid);
    } else if (bestAsk > 0) {
      bookMidAtomic = BigInt(bestAsk);
    } else {
      const lastTrade = this.dbMgr.queryOne<{ price: number }>(
        'SELECT price FROM trades WHERE pair_id = ? ORDER BY timestamp DESC LIMIT 1',
        [pair.id]
      );
      if (lastTrade && lastTrade.price > 0) {
        bookMidAtomic = BigInt(Math.trunc(lastTrade.price));
      }
    }

    if (config.referencePriceSource === 'INTERNAL_BOOK') {
      if (bookMidAtomic <= 0n) {
        return { ok: false, priceAtomic: 0n, reason: 'INTERNAL_BOOK_NO_REFERENCE_PRICE' };
      }
      return { ok: true, priceAtomic: bookMidAtomic, reason: 'INTERNAL_BOOK_MID' };
    }

    // Check aggregated external feed if available
    const refSymbol = `${pair.baseAsset}USDT`;
    const agg = this.priceAggregator?.getAggregatedPrice(refSymbol);
    const fxCfg = this.priceAggregator?.getFxRate();
    const fxRate = fxCfg && fxCfg.usdtIdrRate > 0 ? fxCfg.usdtIdrRate : 16250;

    if (agg && agg.finalPrice > 0) {
      const ageMs = nowMs - agg.lastUpdated;
      const fxStale = pair.quoteAsset === 'IDR' && Boolean(fxCfg?.isStale);
      if (ageMs > config.staleMarketDataMaxAgeMs || agg.status === 'STALE' || agg.status === 'INVALID' || fxStale) {
        if (config.referencePriceSource === 'AGGREGATED_FEED') {
          return {
            ok: false,
            priceAtomic: 0n,
            stale: true,
            reason: `STALE_REFERENCE_DATA (age=${ageMs}ms > max=${config.staleMarketDataMaxAgeMs}ms, fxStale=${fxStale})`,
          };
        }
      } else {
        const quoteMultiplier = pair.quoteAsset === 'IDR' ? fxRate : 1;
        const estimatedQuote = (agg.finalPrice * quoteMultiplier).toFixed(pair.quotePrecision);
        const feedAtomic = PrecisionMath.parseDecimalToAtomic(estimatedQuote, pair.quotePrecision);
        if (feedAtomic > 0n) {
          return { ok: true, priceAtomic: feedAtomic, reason: 'AGGREGATED_FEED' };
        }
      }
    } else if (config.referencePriceSource === 'AGGREGATED_FEED') {
      return {
        ok: false,
        priceAtomic: 0n,
        stale: true,
        reason: `AGGREGATED_FEED_UNAVAILABLE (${refSymbol})`,
      };
    }

    if (bookMidAtomic > 0n) {
      return { ok: true, priceAtomic: bookMidAtomic, reason: 'HYBRID_BOOK_FALLBACK' };
    }
    return { ok: false, priceAtomic: 0n, reason: 'NO_VALID_REFERENCE_PRICE' };
  }

  private planStrategySlice(
    row: VolumeBotRow,
    config: VolumeBotConfig,
    pair: MarketPairConfig,
    refPriceAtomic: bigint,
    openBotOrders: VolumeBotOrderRow[],
    nowMs: number
  ): { ok: boolean; orderPriceAtomic: bigint; sliceQtyAtomic: bigint; reason: string; riskCode?: string } {
    const tickAtomic = PrecisionMath.parseDecimalToAtomic(config.tickSize, pair.quotePrecision);
    const lotAtomic = PrecisionMath.parseDecimalToAtomic(config.lotSize, pair.basePrecision);
    const minSliceAtomic = PrecisionMath.parseDecimalToAtomic(config.minSliceSize, pair.basePrecision);
    const maxSliceAtomic = PrecisionMath.parseDecimalToAtomic(config.maxSliceSize, pair.basePrecision);
    const remainingQtyAtomic = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
    const openLockedBase = openBotOrders.reduce(
      (sum, o) => sum + PrecisionMath.safeBigInt(o.remaining_amount_atomic),
      0n
    );

    let effectiveRemaining =
      remainingQtyAtomic > openLockedBase ? remainingQtyAtomic - openLockedBase : remainingQtyAtomic;
    if (effectiveRemaining <= 0n) {
      return { ok: false, orderPriceAtomic: 0n, sliceQtyAtomic: 0n, reason: 'REMAINING_QTY_COVERED_BY_OPEN_ORDERS' };
    }

    // Strategy-specific slice quantity
    let rawSliceAtomic = minSliceAtomic;
    if (config.strategy === 'TWAP') {
      const avgInterval = Math.max(500, Math.trunc((config.minIntervalMs + config.maxIntervalMs) / 2));
      const totalSlices = Math.max(1, Math.trunc((config.twapDurationMs || 300000) / avgInterval));
      const targetPerSlice = PrecisionMath.safeBigInt(row.target_qty_atomic) / BigInt(totalSlices);
      rawSliceAtomic = PrecisionMath.maxBigInt(minSliceAtomic, PrecisionMath.minBigInt(maxSliceAtomic, targetPerSlice));
    } else if (config.strategy === 'VWAP') {
      const lookbackMs = (config.vwapLookbackMinutes || 30) * 60000;
      const recentMarketTrades = this.dbMgr.query<{ amount: number }>(
        'SELECT amount FROM trades WHERE pair_id = ? AND timestamp >= ?',
        [pair.id, nowMs - lookbackMs]
      );
      if (recentMarketTrades.length > 0) {
        let totalVolAtomic = 0n;
        for (const t of recentMarketTrades) {
          totalVolAtomic += PrecisionMath.safeBigInt(t.amount);
        }
        const participationCap = (totalVolAtomic * BigInt(config.maxParticipationRateBps)) / 10000n;
        const avgSlice = totalVolAtomic / BigInt(Math.max(1, recentMarketTrades.length));
        const vwapTarget = PrecisionMath.minBigInt(participationCap > 0n ? participationCap : maxSliceAtomic, avgSlice > 0n ? avgSlice : minSliceAtomic);
        rawSliceAtomic = PrecisionMath.maxBigInt(minSliceAtomic, PrecisionMath.minBigInt(maxSliceAtomic, vwapTarget));
      } else {
        // Safe uniform fallback when genuine market trade history is empty
        rawSliceAtomic = minSliceAtomic;
      }
    } else if (config.strategy === 'ICEBERG') {
      const ratioBps = BigInt(Math.max(1, Math.min(100, config.icebergVisibleRatioPct || 20)) * 100);
      const clip = (effectiveRemaining * ratioBps) / 10000n;
      rawSliceAtomic = PrecisionMath.maxBigInt(minSliceAtomic, PrecisionMath.minBigInt(maxSliceAtomic, clip));
    } else {
      // PASSIVE_LIMIT / AGGRESSIVE_LIMIT
      const span = maxSliceAtomic - minSliceAtomic;
      if (span > 0n) {
        const entropy = BigInt(nowMs) + BigInt(row.submitted_orders_count + 1) * 7919n;
        rawSliceAtomic = PrecisionMath.deterministicBigIntInRange(minSliceAtomic, maxSliceAtomic, entropy);
      } else {
        rawSliceAtomic = minSliceAtomic;
      }
    }

    // Clamp to remaining & pair maxOrderQty & lotSize
    let sliceQtyAtomic = PrecisionMath.minBigInt(rawSliceAtomic, effectiveRemaining);
    if (config.maxOrderQty) {
      const maxOrderQtyAtomic = PrecisionMath.parseDecimalToAtomic(config.maxOrderQty, pair.basePrecision);
      if (maxOrderQtyAtomic > 0n) {
        sliceQtyAtomic = PrecisionMath.minBigInt(sliceQtyAtomic, maxOrderQtyAtomic);
      }
    }
    sliceQtyAtomic = PrecisionMath.normalizeQtyToLot(sliceQtyAtomic, lotAtomic, 'floor');
    if (sliceQtyAtomic < BigInt(pair.minOrderSize)) {
      if (effectiveRemaining >= BigInt(pair.minOrderSize) && effectiveRemaining <= maxSliceAtomic) {
        sliceQtyAtomic = PrecisionMath.normalizeQtyToLot(effectiveRemaining, lotAtomic, 'floor');
      }
    }
    if (sliceQtyAtomic < BigInt(pair.minOrderSize) || sliceQtyAtomic <= 0n) {
      return { ok: false, orderPriceAtomic: 0n, sliceQtyAtomic: 0n, reason: 'SLICE_BELOW_MIN_ORDER_SIZE' };
    }

    // Read current book for BBO, STP, and participation rate check
    const engine = this.engineManager.getEngine(pair.id);
    const oppositeBook = row.execution_side === 'BUY' ? engine.book.asks : engine.book.bids;
    const sameBook = row.execution_side === 'BUY' ? engine.book.bids : engine.book.asks;

    const bestOppositeNonSelf = oppositeBook.find((o) => o.userId !== row.account_id);
    const bestOppositeAny = oppositeBook[0];
    const bestSame = sameBook[0];

    let targetPriceAtomic = refPriceAtomic;
    if (config.strategy === 'PASSIVE_LIMIT') {
      const anchor = bestSame ? BigInt(bestSame.price) : refPriceAtomic;
      const offsetTicks = Math.max(0, config.passiveOffsetTicks ?? 1);
      targetPriceAtomic =
        row.execution_side === 'BUY'
          ? PrecisionMath.applyTickOffsetAtomic(anchor, tickAtomic, -offsetTicks)
          : PrecisionMath.applyTickOffsetAtomic(anchor, tickAtomic, offsetTicks);

      // Ensure passive order does not cross opposite BBO
      if (bestOppositeAny) {
        const oppPrice = BigInt(bestOppositeAny.price);
        if (row.execution_side === 'BUY' && targetPriceAtomic >= oppPrice) {
          targetPriceAtomic = oppPrice > tickAtomic ? oppPrice - tickAtomic : oppPrice;
        } else if (row.execution_side === 'SELL' && targetPriceAtomic <= oppPrice) {
          targetPriceAtomic = oppPrice + tickAtomic;
        }
      }
    } else if (config.strategy === 'AGGRESSIVE_LIMIT') {
      if (!bestOppositeAny) {
        // No opposite liquidity -> place inside slippage cap at reference price
        targetPriceAtomic = refPriceAtomic;
      } else if (!bestOppositeNonSelf) {
        return {
          ok: false,
          orderPriceAtomic: 0n,
          sliceQtyAtomic: 0n,
          riskCode: 'STP',
          reason: 'SELF_TRADE_PREVENTION: Only own-account orders exist on opposite book',
        };
      } else {
        const aggTicks = Math.max(0, config.aggressiveMaxTicks ?? 1);
        const oppPrice = BigInt(bestOppositeNonSelf.price);
        targetPriceAtomic =
          row.execution_side === 'BUY'
            ? PrecisionMath.applyTickOffsetAtomic(oppPrice, tickAtomic, aggTicks)
            : PrecisionMath.applyTickOffsetAtomic(oppPrice, tickAtomic, -aggTicks);
      }
    } else {
      // TWAP / VWAP / ICEBERG: if opposite non-self liquidity exists within slippage cap, take up to slippage cap; else rest near ref
      if (bestOppositeNonSelf) {
        const oppPrice = BigInt(bestOppositeNonSelf.price);
        const dev = PrecisionMath.computePriceDeviationBps(oppPrice, refPriceAtomic);
        if (dev <= BigInt(config.maxSlippageBps)) {
          targetPriceAtomic = oppPrice;
        } else {
          return {
            ok: false,
            orderPriceAtomic: 0n,
            sliceQtyAtomic: 0n,
            riskCode: 'SLIPPAGE',
            reason: `MAX_SLIPPAGE_EXCEEDED: best opposite ${oppPrice} deviates ${dev} bps > limit ${config.maxSlippageBps} bps from ref ${refPriceAtomic}`,
          };
        }
      } else if (bestOppositeAny && bestOppositeAny.userId === row.account_id) {
        // Avoid crossing own resting quotes on TWAP/VWAP/ICEBERG
        targetPriceAtomic =
          row.execution_side === 'BUY'
            ? PrecisionMath.minBigInt(refPriceAtomic, BigInt(bestOppositeAny.price) > tickAtomic ? BigInt(bestOppositeAny.price) - tickAtomic : refPriceAtomic)
            : PrecisionMath.maxBigInt(refPriceAtomic, BigInt(bestOppositeAny.price) + tickAtomic);
      }
    }

    const orderPriceAtomic = PrecisionMath.normalizePriceToTick(
      targetPriceAtomic,
      tickAtomic,
      row.execution_side === 'BUY' ? 'floor' : 'ceil'
    );
    if (orderPriceAtomic <= 0n) {
      return { ok: false, orderPriceAtomic: 0n, sliceQtyAtomic: 0n, reason: 'NORMALIZED_PRICE_ZERO' };
    }

    // Price collar check
    const minCollarAtomic = PrecisionMath.parseDecimalToAtomic(config.minPriceCollar || '0', pair.quotePrecision);
    const maxCollarAtomic = PrecisionMath.parseDecimalToAtomic(config.maxPriceCollar || '0', pair.quotePrecision);
    if (minCollarAtomic > 0n && orderPriceAtomic < minCollarAtomic) {
      return {
        ok: false,
        orderPriceAtomic: 0n,
        sliceQtyAtomic: 0n,
        riskCode: 'COLLAR',
        reason: `PRICE_COLLAR_BREACH: price ${orderPriceAtomic} < minPriceCollar ${minCollarAtomic}`,
      };
    }
    if (maxCollarAtomic > 0n && orderPriceAtomic > maxCollarAtomic) {
      return {
        ok: false,
        orderPriceAtomic: 0n,
        sliceQtyAtomic: 0n,
        riskCode: 'COLLAR',
        reason: `PRICE_COLLAR_BREACH: price ${orderPriceAtomic} > maxPriceCollar ${maxCollarAtomic}`,
      };
    }

    // Slippage check against reference price
    const deviationBps = PrecisionMath.computePriceDeviationBps(orderPriceAtomic, refPriceAtomic);
    if (deviationBps > BigInt(config.maxSlippageBps)) {
      return {
        ok: false,
        orderPriceAtomic: 0n,
        sliceQtyAtomic: 0n,
        riskCode: 'SLIPPAGE',
        reason: `MAX_SLIPPAGE_EXCEEDED: orderPrice ${orderPriceAtomic} deviates ${deviationBps} bps > max ${config.maxSlippageBps} bps`,
      };
    }

    // Participation rate check when crossing non-self opposite book
    if (bestOppositeNonSelf && config.maxParticipationRateBps < 10000) {
      const crossingOpposite =
        (row.execution_side === 'BUY' && BigInt(bestOppositeNonSelf.price) <= orderPriceAtomic) ||
        (row.execution_side === 'SELL' && BigInt(bestOppositeNonSelf.price) >= orderPriceAtomic);
      if (crossingOpposite) {
        let eligibleDepthAtomic = 0n;
        for (const o of oppositeBook) {
          if (o.userId === row.account_id) continue;
          const p = BigInt(o.price);
          if ((row.execution_side === 'BUY' && p <= orderPriceAtomic) || (row.execution_side === 'SELL' && p >= orderPriceAtomic)) {
            eligibleDepthAtomic += BigInt(o.remainingAmount);
          }
        }
        const maxParticipate = PrecisionMath.normalizeQtyToLot(
          (eligibleDepthAtomic * BigInt(config.maxParticipationRateBps)) / 10000n,
          lotAtomic,
          'floor'
        );
        if (maxParticipate >= BigInt(pair.minOrderSize) && sliceQtyAtomic > maxParticipate) {
          sliceQtyAtomic = maxParticipate;
        }
      }
    }

    return { ok: true, orderPriceAtomic, sliceQtyAtomic, reason: 'PLANNED' };
  }

  private checkPreTradeRiskAndBalances(
    row: VolumeBotRow,
    config: VolumeBotConfig,
    pair: MarketPairConfig,
    orderPriceAtomic: bigint,
    sliceQtyAtomic: bigint,
    openBotOrders: VolumeBotOrderRow[],
    riskState: VolumeBotRiskState,
    nowMs: number
  ): { ok: boolean; code: string; reason: string; hardLock?: boolean } {
    const sliceNotionalAtomic = PrecisionMath.computeQuoteNotionalAtomic(orderPriceAtomic, sliceQtyAtomic, pair.basePrecision);

    // 1. Max Order Notional
    const maxOrderNotionalAtomic = PrecisionMath.parseDecimalToAtomic(config.maxOrderNotional || '0', pair.quotePrecision);
    if (maxOrderNotionalAtomic > 0n && sliceNotionalAtomic > maxOrderNotionalAtomic) {
      return {
        ok: false,
        code: 'MAX_ORDER_NOTIONAL_EXCEEDED',
        reason: `Order notional ${sliceNotionalAtomic} exceeds maxOrderNotional ${maxOrderNotionalAtomic}`,
      };
    }

    // 2. Active Open Exposure + Cumulative Exposure Limit
    let openExposureQuote = 0n;
    for (const o of openBotOrders) {
      openExposureQuote += PrecisionMath.computeQuoteNotionalAtomic(
        PrecisionMath.safeBigInt(o.price_atomic),
        PrecisionMath.safeBigInt(o.remaining_amount_atomic),
        pair.basePrecision
      );
    }
    riskState.activeExposureQuoteAtomic = openExposureQuote.toString();

    const executedQuoteAtomic = PrecisionMath.safeBigInt(row.executed_quote_atomic);
    const maxCumulativeExposureAtomic = PrecisionMath.parseDecimalToAtomic(config.maxCumulativeExposure || '0', pair.quotePrecision);
    if (
      maxCumulativeExposureAtomic > 0n &&
      executedQuoteAtomic + openExposureQuote + sliceNotionalAtomic > maxCumulativeExposureAtomic
    ) {
      return {
        ok: false,
        code: 'MAX_CUMULATIVE_EXPOSURE_REACHED',
        reason: `Cumulative exposure limit reached (${executedQuoteAtomic + openExposureQuote + sliceNotionalAtomic} > ${maxCumulativeExposureAtomic})`,
        hardLock: true,
      };
    }

    // 3. Daily Execution Limit
    const dailyExecutedAtomic = PrecisionMath.safeBigInt(row.daily_executed_quote_atomic);
    const dailyLimitAtomic = PrecisionMath.parseDecimalToAtomic(config.dailyExecutionLimit || '0', pair.quotePrecision);
    if (dailyLimitAtomic > 0n && dailyExecutedAtomic + sliceNotionalAtomic > dailyLimitAtomic) {
      return {
        ok: false,
        code: 'DAILY_EXECUTION_LIMIT_REACHED',
        reason: `Daily execution limit reached (${dailyExecutedAtomic + sliceNotionalAtomic} > ${dailyLimitAtomic})`,
        hardLock: true,
      };
    }

    // 4. Ledger Balance & Inventory Cap Check
    riskState.lastRiskCheckAt = nowMs;
    if (row.execution_mode === 'LIVE') {
      const baseBal = this.ledger.getBalance(row.account_id, pair.baseAsset);
      const quoteBal = this.ledger.getBalance(row.account_id, pair.quoteAsset);

      const availBase = BigInt(baseBal.available);
      const availQuote = BigInt(quoteBal.available);
      const lockedBase = BigInt(baseBal.lockedOrder);
      const lockedQuote = BigInt(quoteBal.lockedOrder);

      riskState.lastBalanceAvailableBaseAtomic = availBase.toString();
      riskState.lastBalanceAvailableQuoteAtomic = availQuote.toString();
      riskState.lastBalanceLockedBaseAtomic = lockedBase.toString();
      riskState.lastBalanceLockedQuoteAtomic = lockedQuote.toString();

      if (row.execution_side === 'BUY' && availQuote < sliceNotionalAtomic) {
        riskState.balanceRejections += 1;
        return {
          ok: false,
          code: 'INSUFFICIENT_QUOTE_BALANCE',
          reason: `Insufficient ${pair.quoteAsset} balance on ${row.account_id}: available=${availQuote}, required=${sliceNotionalAtomic}`,
          hardLock: true,
        };
      }
      if (row.execution_side === 'SELL' && availBase < sliceQtyAtomic) {
        riskState.balanceRejections += 1;
        return {
          ok: false,
          code: 'INSUFFICIENT_BASE_BALANCE',
          reason: `Insufficient ${pair.baseAsset} balance on ${row.account_id}: available=${availBase}, required=${sliceQtyAtomic}`,
          hardLock: true,
        };
      }

      const maxBaseInv = PrecisionMath.parseDecimalToAtomic(config.maxBaseInventory || '0', pair.basePrecision);
      if (maxBaseInv > 0n && row.execution_side === 'BUY' && BigInt(baseBal.total) + sliceQtyAtomic > maxBaseInv) {
        return {
          ok: false,
          code: 'MAX_BASE_INVENTORY_CAP',
          reason: `Base inventory cap exceeded: total=${baseBal.total} + slice=${sliceQtyAtomic} > maxBaseInventory=${maxBaseInv}`,
          hardLock: true,
        };
      }

      const maxQuoteInv = PrecisionMath.parseDecimalToAtomic(config.maxQuoteInventory || '0', pair.quotePrecision);
      if (maxQuoteInv > 0n && row.execution_side === 'SELL' && BigInt(quoteBal.total) + sliceNotionalAtomic > maxQuoteInv) {
        return {
          ok: false,
          code: 'MAX_QUOTE_INVENTORY_CAP',
          reason: `Quote inventory cap exceeded: total=${quoteBal.total} + notional=${sliceNotionalAtomic} > maxQuoteInventory=${maxQuoteInv}`,
          hardLock: true,
        };
      }
    } else {
      // SIMULATION inventory caps (no ledger mutation)
      const maxBaseInv = PrecisionMath.parseDecimalToAtomic(config.maxBaseInventory || '0', pair.basePrecision);
      const executedBase = PrecisionMath.safeBigInt(row.executed_qty_atomic);
      if (maxBaseInv > 0n && row.execution_side === 'BUY' && executedBase + sliceQtyAtomic > maxBaseInv) {
        return {
          ok: false,
          code: 'MAX_BASE_INVENTORY_CAP',
          reason: `[SIM] Base inventory cap exceeded: ${executedBase + sliceQtyAtomic} > ${maxBaseInv}`,
          hardLock: true,
        };
      }
      const maxQuoteInv = PrecisionMath.parseDecimalToAtomic(config.maxQuoteInventory || '0', pair.quotePrecision);
      if (maxQuoteInv > 0n && row.execution_side === 'SELL' && executedQuoteAtomic + sliceNotionalAtomic > maxQuoteInv) {
        return {
          ok: false,
          code: 'MAX_QUOTE_INVENTORY_CAP',
          reason: `[SIM] Quote inventory cap exceeded: ${executedQuoteAtomic + sliceNotionalAtomic} > ${maxQuoteInv}`,
          hardLock: true,
        };
      }
    }

    return { ok: true, code: 'OK', reason: 'RISK_PASSED' };
  }

  // =========================================================================
  // RECONCILIATION, EXPIRY & CANCEL-ONLY-BOT-OWNED ORDERS
  // =========================================================================

  public async recoverAll(): Promise<void> {
    const bots = this.dbMgr.query<VolumeBotRow>('SELECT * FROM volume_bots');
    const now = Date.now();
    for (const bot of bots) {
      try {
        const pair = this.getPairConfigStrict(bot.pair_id);
        await this.reconcileBotOrdersAndTrades(bot, pair, now);
        if (bot.status !== 'RUNNING' || bot.emergency_stopped) {
          await this.cancelBotOwnedOpenOrders(bot, 'STARTUP_RECONCILE_STOPPED_BOT');
        }
      } catch (err) {
        console.error(`[VolumeExecutionV2Service] Recovery error for bot ${bot.id}:`, err);
      }
    }
  }

  private async reconcileBotOrdersAndTrades(row: VolumeBotRow, pair: MarketPairConfig, nowMs: number): Promise<void> {
    this.reconcileBotOrdersAndTradesSync(row, pair, nowMs);
  }

  private reconcileBotOrdersAndTradesSync(row: VolumeBotRow, pair: MarketPairConfig, nowMs: number): void {
    if (row.execution_mode !== 'LIVE') return;

    const botOrders = this.dbMgr.query<VolumeBotOrderRow>(
      "SELECT * FROM volume_bot_orders WHERE bot_id = ? AND execution_mode = 'LIVE' AND status IN ('SUBMITTED', 'ACCEPTED', 'PARTIALLY_FILLED')",
      [row.id]
    );

    for (const botOrd of botOrders) {
      const dbOrd = this.dbMgr.queryOne<any>('SELECT * FROM orders WHERE id = ?', [botOrd.id]);
      if (!dbOrd) continue;

      const mappedStatus =
        dbOrd.status === 'NEW'
          ? 'ACCEPTED'
          : dbOrd.status === 'PARTIALLY_FILLED'
          ? 'PARTIALLY_FILLED'
          : dbOrd.status === 'FILLED'
          ? 'FILLED'
          : dbOrd.status === 'CANCELLED'
          ? 'CANCELLED'
          : 'REJECTED';

      const filledAtomic = PrecisionMath.safeBigInt(dbOrd.filled_amount);
      const remainingAtomic = PrecisionMath.safeBigInt(dbOrd.remaining_amount);

      if (
        mappedStatus !== botOrd.status ||
        filledAtomic.toString() !== botOrd.filled_amount_atomic ||
        remainingAtomic.toString() !== botOrd.remaining_amount_atomic
      ) {
        this.dbMgr.execute(
          'UPDATE volume_bot_orders SET status = ?, filled_amount_atomic = ?, remaining_amount_atomic = ?, updated_at = ? WHERE id = ?',
          [mappedStatus, filledAtomic.toString(), remainingAtomic.toString(), nowMs, botOrd.id]
        );
      }

      // Sync any unrecorded trades from authoritative `trades` table without double counting
      const engineTrades = this.dbMgr.query<any>(
        'SELECT * FROM trades WHERE taker_order_id = ? OR maker_order_id = ?',
        [botOrd.id, botOrd.id]
      );
      for (const t of engineTrades) {
        const isMaker = t.maker_order_id === botOrd.id;
        const fee = isMaker ? t.maker_fee : t.taker_fee;
        const feeAsset = botOrd.side === 'BUY' ? pair.baseAsset : pair.quoteAsset;
        this.recordBotTradeAtomic({
          botId: row.id,
          tradeId: t.id,
          orderId: botOrd.id,
          pairId: pair.id,
          executionMode: 'LIVE',
          side: botOrd.side,
          priceAtomic: PrecisionMath.safeBigInt(t.price),
          amountAtomic: PrecisionMath.safeBigInt(t.amount),
          quoteTotalAtomic: PrecisionMath.safeBigInt(t.total),
          feeAtomic: PrecisionMath.safeBigInt(fee),
          feeAsset,
          slippageBps: 0,
          timestamp: t.timestamp,
          orderStatusAfter: mappedStatus,
        });
      }
    }
  }

  private async expireTimedOutOrders(
    row: VolumeBotRow,
    _config: VolumeBotConfig,
    checkpoint: VolumeBotCheckpoint,
    _riskState: VolumeBotRiskState,
    nowMs: number
  ): Promise<void> {
    const expiredOrders = this.dbMgr.query<VolumeBotOrderRow>(
      `SELECT * FROM volume_bot_orders
       WHERE bot_id = ? AND status IN ('SUBMITTED', 'ACCEPTED', 'PARTIALLY_FILLED')
       AND expires_at IS NOT NULL AND expires_at <= ?`,
      [row.id, nowMs]
    );

    if (expiredOrders.length === 0) return;
    const engine = row.execution_mode === 'LIVE' ? this.engineManager.getEngine(row.pair_id) : null;

    for (const ord of expiredOrders) {
      if (engine) {
        try {
          await engine.cancelOrder(ord.id, row.account_id);
        } catch {}
      }

      const isPartial = PrecisionMath.safeBigInt(ord.filled_amount_atomic) > 0n;
      if (isPartial) {
        checkpoint.lastSliceRetryCount += 1;
      }

      this.dbMgr.runInTransaction(() => {
        this.dbMgr.execute(
          `UPDATE volume_bot_orders SET status = 'EXPIRED', retry_count = retry_count + 1, updated_at = ? WHERE id = ?`,
          [nowMs, ord.id]
        );
        this.dbMgr.execute(
          'UPDATE volume_bots SET expired_orders_count = expired_orders_count + 1, cancelled_orders_count = cancelled_orders_count + 1, updated_at = ? WHERE id = ?',
          [nowMs, row.id]
        );
      });
      this.insertLog(row.id, row.execution_mode, 'WARN', 'ORDER_EXPIRED', `Order ${ord.id} timed out and expired`, {
        orderId: ord.id,
        filledAtomic: ord.filled_amount_atomic,
        partialRetryCount: checkpoint.lastSliceRetryCount,
      });
    }

    this.saveCheckpointAndRisk(row.id, checkpoint, _riskState, nowMs);
  }

  /**
   * Cancels ONLY orders belonging explicitly to this bot in `volume_bot_orders`.
   * Never touches manual orders or other bots' orders on the same account.
   */
  public async cancelBotOwnedOpenOrders(row: VolumeBotRow, reason: string): Promise<number> {
    const openOrders = this.getOpenBotOrders(row.id);
    if (openOrders.length === 0) return 0;

    let cancelled = 0;
    const now = Date.now();
    const engine = row.execution_mode === 'LIVE' ? this.engineManager.getEngine(row.pair_id) : null;

    for (const ord of openOrders) {
      if (engine) {
        try {
          await engine.cancelOrder(ord.id, row.account_id);
        } catch {}
      }
      this.dbMgr.execute(
        `UPDATE volume_bot_orders SET status = 'CANCELLED', last_error = ?, updated_at = ? WHERE id = ? AND bot_id = ?`,
        [reason, now, ord.id, row.id]
      );
      cancelled += 1;
    }

    if (cancelled > 0) {
      this.dbMgr.execute(
        'UPDATE volume_bots SET cancelled_orders_count = cancelled_orders_count + ?, updated_at = ? WHERE id = ?',
        [cancelled, now, row.id]
      );
    }

    return cancelled;
  }

  private async lockBotRisk(row: VolumeBotRow, riskState: VolumeBotRiskState, reason: string, nowMs: number): Promise<void> {
    await this.cancelBotOwnedOpenOrders(row, reason);
    riskState.riskLocked = true;
    riskState.riskLockReason = reason;
    this.dbMgr.execute(
      `UPDATE volume_bots SET status = 'RISK_LOCKED', enabled = 0, last_error = ?, risk_state_json = ?, updated_at = ? WHERE id = ?`,
      [reason, JSON.stringify(riskState), nowMs, row.id]
    );
    this.insertLog(row.id, row.execution_mode, 'RISK', 'BOT_RISK_LOCKED', reason);
  }

  // =========================================================================
  // SIMULATION MATCH EVALUATOR (READ-ONLY BOOK SNAPSHOT, ZERO MUTATION)
  // =========================================================================

  private evaluateSimulatedMatch(
    pair: MarketPairConfig,
    side: VolumeBotSide,
    orderPriceAtomic: bigint,
    sliceQtyAtomic: bigint,
    botAccountId: string
  ): { filledAtomic: bigint; execPriceAtomic: bigint; quoteTotalAtomic: bigint; isTaker: boolean } {
    const engine = this.engineManager.getEngine(pair.id);
    const oppositeBook = side === 'BUY' ? engine.book.asks : engine.book.bids;

    let remaining = sliceQtyAtomic;
    let totalFilled = 0n;
    let totalQuote = 0n;
    let weightedNum = 0n;

    for (const level of oppositeBook) {
      if (level.userId === botAccountId) continue; // STP check even in simulation
      const levelPrice = BigInt(level.price);
      const crosses = side === 'BUY' ? levelPrice <= orderPriceAtomic : levelPrice >= orderPriceAtomic;
      if (!crosses) break;

      const avail = BigInt(level.remainingAmount);
      const take = PrecisionMath.minBigInt(remaining, avail);
      if (take <= 0n) continue;

      const notional = PrecisionMath.computeQuoteNotionalAtomic(levelPrice, take, pair.basePrecision);
      totalFilled += take;
      totalQuote += notional;
      weightedNum += levelPrice * take;
      remaining -= take;
      if (remaining <= 0n) break;
    }

    if (totalFilled === 0n) {
      return { filledAtomic: 0n, execPriceAtomic: 0n, quoteTotalAtomic: 0n, isTaker: false };
    }

    const avgPrice = PrecisionMath.computeWeightedAveragePrice(weightedNum, totalFilled);
    return { filledAtomic: totalFilled, execPriceAtomic: avgPrice, quoteTotalAtomic: totalQuote, isTaker: true };
  }

  // =========================================================================
  // SERIALIZATION & HELPERS
  // =========================================================================

  private getRowStrict(botId: string): VolumeBotRow {
    const row = this.dbMgr.queryOne<VolumeBotRow>('SELECT * FROM volume_bots WHERE id = ?', [botId]);
    if (!row) throw new Error(`Volume bot "${botId}" not found`);
    return row;
  }

  private getOpenBotOrders(botId: string): VolumeBotOrderRow[] {
    return this.dbMgr.query<VolumeBotOrderRow>(
      `SELECT * FROM volume_bot_orders WHERE bot_id = ? AND status IN ('SUBMITTED', 'ACCEPTED', 'PARTIALLY_FILLED') ORDER BY created_at ASC`,
      [botId]
    );
  }

  private parseConfig(row: VolumeBotRow): VolumeBotConfig {
    return JSON.parse(row.config_json) as VolumeBotConfig;
  }

  private parseCheckpoint(row: VolumeBotRow): VolumeBotCheckpoint {
    try {
      return { ...defaultCheckpoint(), ...(JSON.parse(row.checkpoint_json || '{}') || {}) };
    } catch {
      return defaultCheckpoint();
    }
  }

  private parseRiskState(row: VolumeBotRow): VolumeBotRiskState {
    try {
      return { ...defaultRiskState(), ...(JSON.parse(row.risk_state_json || '{}') || {}) };
    } catch {
      return defaultRiskState();
    }
  }

  private saveCheckpointAndRisk(
    botId: string,
    checkpoint: VolumeBotCheckpoint,
    riskState: VolumeBotRiskState,
    nowMs: number
  ): void {
    this.dbMgr.execute(
      'UPDATE volume_bots SET checkpoint_json = ?, risk_state_json = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(checkpoint), JSON.stringify(riskState), nowMs, botId]
    );
  }

  private saveConfigVersionSnapshot(
    botId: string,
    version: number,
    config: VolumeBotConfig,
    changedBy: string,
    reason: string
  ): void {
    this.dbMgr.execute(
      `INSERT INTO volume_bot_config_versions (id, bot_id, config_version, config_json, changed_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `vcfg_${crypto.randomBytes(8).toString('hex')}`,
        botId,
        version,
        JSON.stringify(config),
        changedBy,
        reason,
        Date.now(),
      ]
    );
  }

  private insertLog(
    botId: string,
    executionMode: VolumeBotExecutionMode,
    level: VolumeBotLogRow['level'],
    eventType: string,
    message: string,
    details?: Record<string, any>
  ): void {
    this.dbMgr.execute(
      `INSERT INTO volume_bot_logs (id, bot_id, execution_mode, level, event_type, message, details_json, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `vblog_${crypto.randomBytes(8).toString('hex')}`,
        botId,
        executionMode,
        level,
        eventType,
        message,
        details ? JSON.stringify(details) : null,
        Date.now(),
      ]
    );
  }

  private computeNextDelayMs(config: VolumeBotConfig, seed: number): number {
    if (config.maxIntervalMs <= config.minIntervalMs) return config.minIntervalMs;
    const span = config.maxIntervalMs - config.minIntervalMs;
    const offset = (seed * 2654435761) % (span + 1);
    return config.minIntervalMs + Math.abs(offset);
  }

  public toDTO(row: VolumeBotRow): VolumeBotDTO {
    const pair = this.getPairConfigStrict(row.pair_id);
    const config = this.parseConfig(row);
    const checkpoint = this.parseCheckpoint(row);
    const riskState = this.parseRiskState(row);
    const openOrdersCount = this.getOpenBotOrders(row.id).length;
    riskState.openOrdersCount = openOrdersCount;

    const targetAtomic = PrecisionMath.safeBigInt(row.target_qty_atomic);
    const executedAtomic = PrecisionMath.safeBigInt(row.executed_qty_atomic);
    const remainingAtomic = PrecisionMath.safeBigInt(row.remaining_qty_atomic);
    const executedQuoteAtomic = PrecisionMath.safeBigInt(row.executed_quote_atomic);
    const totalFeesAtomic = PrecisionMath.safeBigInt(row.total_fees_atomic);
    const weightedNumAtomic = PrecisionMath.safeBigInt(row.weighted_price_num_atomic);
    const dailyQuoteAtomic =
      row.daily_reset_day === currentUtcDay() ? PrecisionMath.safeBigInt(row.daily_executed_quote_atomic) : 0n;

    const avgFillAtomic = PrecisionMath.computeWeightedAveragePrice(weightedNumAtomic, executedAtomic);
    const completionPct =
      targetAtomic > 0n
        ? Number((PrecisionMath.minBigInt(targetAtomic, executedAtomic) * 10000n) / targetAtomic) / 100
        : 0;

    const slippageSum = PrecisionMath.safeBigInt(row.total_slippage_bps_sum);
    const avgSlippageBps =
      row.total_trades_count > 0 ? Number(slippageSum / BigInt(row.total_trades_count)) : 0;

    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      accountId: row.account_id,
      pairId: row.pair_id,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      basePrecision: pair.basePrecision,
      quotePrecision: pair.quotePrecision,
      environment: row.environment,
      executionMode: row.execution_mode,
      executionSide: row.execution_side,
      strategy: row.strategy,
      status: row.status,
      enabled: Boolean(row.enabled),
      configVersion: row.config_version,
      config,
      metrics: {
        targetVolume: PrecisionMath.formatAtomicToDecimal(targetAtomic, pair.basePrecision, true),
        targetQtyAtomic: targetAtomic.toString(),
        executedVolume: PrecisionMath.formatAtomicToDecimal(executedAtomic, pair.basePrecision, true),
        executedQtyAtomic: executedAtomic.toString(),
        remainingVolume: PrecisionMath.formatAtomicToDecimal(remainingAtomic, pair.basePrecision, true),
        remainingQtyAtomic: remainingAtomic.toString(),
        completionPct,
        executedQuoteNotional: PrecisionMath.formatAtomicToDecimal(executedQuoteAtomic, pair.quotePrecision, true),
        executedQuoteAtomic: executedQuoteAtomic.toString(),
        averageFillPrice: PrecisionMath.formatAtomicToDecimal(avgFillAtomic, pair.quotePrecision, true),
        averageFillPriceAtomic: avgFillAtomic.toString(),
        totalFees: PrecisionMath.formatAtomicToDecimal(totalFeesAtomic, pair.quotePrecision, true),
        totalFeesAtomic: totalFeesAtomic.toString(),
        dailyExecutedQuote: PrecisionMath.formatAtomicToDecimal(dailyQuoteAtomic, pair.quotePrecision, true),
        dailyExecutedQuoteAtomic: dailyQuoteAtomic.toString(),
        submittedOrdersCount: row.submitted_orders_count,
        acceptedOrdersCount: row.accepted_orders_count,
        partialFillsCount: row.partial_fills_count,
        filledOrdersCount: row.filled_orders_count,
        cancelledOrdersCount: row.cancelled_orders_count,
        rejectedOrdersCount: row.rejected_orders_count,
        expiredOrdersCount: row.expired_orders_count,
        totalTradesCount: row.total_trades_count,
        averageSlippageBps: avgSlippageBps,
        openOrdersCount,
      },
      riskState,
      checkpoint,
      emergencyStopped: Boolean(row.emergency_stopped),
      lastExecutionAt: row.last_execution_at,
      lastError: row.last_error,
      migratedFromLegacyId: row.migrated_from_legacy_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
