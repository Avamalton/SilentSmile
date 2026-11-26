import { DatabaseManager } from '../db/database';
import { LedgerService } from '../ledger/ledgerService';
import { EngineManager } from '../engine/engineManager';
import { BinanceWsHandler } from './binanceWsHandler';
import { BybitWsHandler } from './bybitWsHandler';
import { PriceAggregatorWorker } from './priceAggregatorWorker';
import { MMBotWorker } from './mmBotWorker';
import { VolumeExecutionV2Service } from '../services/bots/VolumeExecutionV2Service';

export { BinanceWsHandler } from './binanceWsHandler';
export { BybitWsHandler } from './bybitWsHandler';
export { PriceAggregatorWorker } from './priceAggregatorWorker';
export { MMBotWorker } from './mmBotWorker';
export { VolumeExecutionV2Service } from '../services/bots/VolumeExecutionV2Service';
export { WsClientMiddleware, WS_READY_STATE } from './wsClientMiddleware';

export class WorkerSupervisor {
  private static instance: WorkerSupervisor | null = null;

  public binanceHandler: BinanceWsHandler;
  public bybitHandler: BybitWsHandler;
  public priceAggregator: PriceAggregatorWorker;
  public mmBotWorker: MMBotWorker;
  public volumeExecutionService: VolumeExecutionV2Service;

  private isRunning: boolean = false;

  private constructor(dbMgr: DatabaseManager, ledger: LedgerService, engineManager: EngineManager) {
    this.binanceHandler = new BinanceWsHandler();
    this.bybitHandler = new BybitWsHandler();
    this.priceAggregator = new PriceAggregatorWorker(this.binanceHandler, this.bybitHandler);
    this.mmBotWorker = new MMBotWorker(dbMgr, ledger, engineManager, this.priceAggregator);
    this.volumeExecutionService = new VolumeExecutionV2Service(dbMgr, ledger, engineManager, this.priceAggregator);
  }

  public static initialize(dbMgr: DatabaseManager, ledger: LedgerService, engineManager: EngineManager): WorkerSupervisor {
    if (!WorkerSupervisor.instance) {
      WorkerSupervisor.instance = new WorkerSupervisor(dbMgr, ledger, engineManager);
    }
    return WorkerSupervisor.instance;
  }

  public static getInstance(): WorkerSupervisor {
    if (!WorkerSupervisor.instance) {
      throw new Error('WorkerSupervisor has not been initialized. Call initialize() first.');
    }
    return WorkerSupervisor.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[WorkerSupervisor] Starting Market Maker background workers & price feed handlers...');
    this.priceAggregator.start();
    this.mmBotWorker.start();
    this.volumeExecutionService.start(1000);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log('[WorkerSupervisor] Stopping Market Maker background workers...');
    this.volumeExecutionService.stop();
    this.mmBotWorker.stop();
    this.priceAggregator.stop();
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      feedHealth: this.priceAggregator.getFeedHealth(),
      aggregatedPrices: this.priceAggregator.getAllAggregatedPrices(),
    };
  }
}
