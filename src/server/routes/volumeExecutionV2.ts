import { Router, Request, Response } from 'express';
import { DatabaseManager } from '../db/database';
import { AuthService } from '../auth/authService';
import { createAuthMiddleware } from '../auth/authMiddleware';
import { ComplianceService } from '../compliance/complianceService';
import { VolumeExecutionV2Service, BotActor } from '../services/bots/VolumeExecutionV2Service';

function getActor(req: Request): BotActor {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
  };
}

function handleRouteError(res: Response, err: any): void {
  const msg = err?.message || 'Internal error';
  const status = msg.startsWith('Forbidden')
    ? 403
    : msg.includes('not found')
    ? 404
    : msg.includes('Unauthorized')
    ? 401
    : 400;
  res.status(status).json({ success: false, error: msg });
}

export function createVolumeExecutionV2Router(
  dbMgr: DatabaseManager,
  authService: AuthService,
  complianceService: ComplianceService,
  getVolumeService: () => VolumeExecutionV2Service
): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(authService);

  const requireBotOperatorRole = (req: Request, res: Response, next: () => void) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
      return;
    }
    if (req.user.role !== 'admin' && req.user.role !== 'market_maker') {
      res.status(403).json({
        success: false,
        error: 'Forbidden: Market Maker or Admin role required for Volume Execution Engine',
      });
      return;
    }
    next();
  };

  const logAudit = (req: Request, action: string, resource: string, payload?: any) => {
    const actorId = req.user?.userId || 'anonymous';
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    complianceService.logAudit(actorId, action, resource, payload, ip);
  };

  // =========================================================================
  // AUTHORITATIVE V2 ROUTES (/api/volume-execution-v2/*)
  // =========================================================================

  router.get('/bots', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bots = svc.listBots(getActor(req), {
        environment: req.query.environment as string | undefined,
        executionMode: req.query.executionMode as string | undefined,
        pairId: req.query.pairId as string | undefined,
      });
      res.json({ success: true, bots });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const deploy = Boolean(req.body?.deploy);
      const bot = svc.createBot(req.body || {}, getActor(req), { deploy });
      logAudit(req, 'VOLUME_BOT_CREATE', `vbot:${bot.id}`, {
        pairId: bot.pairId,
        strategy: bot.strategy,
        executionMode: bot.executionMode,
        environment: bot.environment,
      });
      dbMgr.saveToFile();
      res.status(201).json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/migrate-legacy', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const legacyItems = Array.isArray(req.body?.bots) ? req.body.bots : [req.body];
      const migrated = legacyItems
        .filter((item: any) => item && item.targetPair)
        .map((item: any) => svc.migrateLegacyAutoTradeBot(item, getActor(req)));
      logAudit(req, 'VOLUME_BOT_MIGRATE_LEGACY', 'vbot:batch', { count: migrated.length });
      dbMgr.saveToFile();
      res.json({ success: true, bots: migrated });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.put('/bots/:id', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = svc.updateBot(req.params.id, req.body || {}, getActor(req));
      logAudit(req, 'VOLUME_BOT_UPDATE', `vbot:${bot.id}`, { configVersion: bot.configVersion });
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/rollback', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const targetVersion = Number(req.body?.configVersion);
      if (!Number.isInteger(targetVersion) || targetVersion < 1) {
        return res.status(400).json({ success: false, error: 'Valid configVersion integer is required' });
      }
      const bot = svc.rollbackBotConfig(req.params.id, targetVersion, getActor(req));
      logAudit(req, 'VOLUME_BOT_ROLLBACK', `vbot:${bot.id}`, { targetVersion, newVersion: bot.configVersion });
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/deploy', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = svc.deployBot(req.params.id, getActor(req));
      logAudit(req, 'VOLUME_BOT_DEPLOY', `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/start', requireAuth, requireBotOperatorRole, async (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.startBot(req.params.id, getActor(req));
      logAudit(req, 'VOLUME_BOT_START', `vbot:${bot.id}`, { executionMode: bot.executionMode });
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/pause', requireAuth, requireBotOperatorRole, async (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.pauseBot(req.params.id, getActor(req));
      logAudit(req, 'VOLUME_BOT_PAUSE', `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/resume', requireAuth, requireBotOperatorRole, async (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.resumeBot(req.params.id, getActor(req));
      logAudit(req, 'VOLUME_BOT_RESUME', `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/stop', requireAuth, requireBotOperatorRole, async (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.stopBot(req.params.id, getActor(req), req.body?.reason || 'OPERATOR_STOP');
      logAudit(req, 'VOLUME_BOT_STOP', `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/emergency-stop', requireAuth, requireBotOperatorRole, async (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = await svc.emergencyStopBot(req.params.id, getActor(req), req.body?.reason || 'OPERATOR_EMERGENCY_STOP');
      logAudit(req, 'VOLUME_BOT_EMERGENCY_STOP', `vbot:${bot.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/tick', requireAuth, requireBotOperatorRole, async (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const actor = getActor(req);
      svc.getBotById(req.params.id, actor); // ownership check
      const bot = await svc.executeBotCycle(req.params.id);
      dbMgr.saveToFile();
      res.json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.post('/bots/:id/clone', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = svc.cloneBot(req.params.id, getActor(req));
      logAudit(req, 'VOLUME_BOT_CLONE', `vbot:${bot.id}`, { sourceBotId: req.params.id });
      dbMgr.saveToFile();
      res.status(201).json({ success: true, bot });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.delete('/bots/:id', requireAuth, requireBotOperatorRole, async (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      await svc.deleteBot(req.params.id, getActor(req));
      logAudit(req, 'VOLUME_BOT_DELETE', `vbot:${req.params.id}`);
      dbMgr.saveToFile();
      res.json({ success: true, message: 'Volume bot deleted and bot-owned open orders cancelled' });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.get('/bots/:id/status', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = svc.getBotById(req.params.id, getActor(req));
      res.json({
        success: true,
        status: bot.status,
        enabled: bot.enabled,
        executionMode: bot.executionMode,
        environment: bot.environment,
        emergencyStopped: bot.emergencyStopped,
        checkpoint: bot.checkpoint,
        lastError: bot.lastError,
        bot,
      });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.get('/bots/:id/stats', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = svc.getBotById(req.params.id, getActor(req));
      res.json({ success: true, metrics: bot.metrics });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.get('/bots/:id/history', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const limit = Number(req.query.limit) || 100;
      const history = svc.getBotHistory(req.params.id, getActor(req), limit);
      res.json({ success: true, ...history });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.get('/bots/:id/risk', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const bot = svc.getBotById(req.params.id, getActor(req));
      res.json({ success: true, riskState: bot.riskState });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  router.get('/bots/:id/logs', requireAuth, requireBotOperatorRole, (req: Request, res: Response) => {
    try {
      const svc = getVolumeService();
      const limit = Number(req.query.limit) || 100;
      const logs = svc.getBotLogs(req.params.id, getActor(req), limit);
      res.json({ success: true, logs });
    } catch (err: any) {
      handleRouteError(res, err);
    }
  });

  return router;
}

/**
 * MM Console Adapter Router mounted at /api/mm/volume-bot/*
 * Delegates cleanly to the same single authoritative VolumeExecutionV2Service.
 */
export function createMMConsoleVolumeBotAdapter(
  dbMgr: DatabaseManager,
  authService: AuthService,
  complianceService: ComplianceService,
  getVolumeService: () => VolumeExecutionV2Service
): Router {
  const router = Router();
  const v2Router = createVolumeExecutionV2Router(dbMgr, authService, complianceService, getVolumeService);

  // Alias legacy `/api/mm/volume-bot/create` -> `/bots`
  router.post('/create', (req: Request, res: Response, next) => {
    req.url = '/bots';
    v2Router(req, res, next);
  });

  // Alias `/api/mm/volume-bot/*` -> V2 router routes (`/bots`, `/bots/:id`, etc.)
  router.use('/', v2Router);
  return router;
}
