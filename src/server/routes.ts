import { Router, Request, Response } from 'express';
import { DatabaseManager } from './db/database';
import { AuthService } from './auth/authService';
import { createAuthMiddleware } from './auth/authMiddleware';
import { LedgerService } from './ledger/ledgerService';
import { EngineManager } from './engine/engineManager';
import { KycService } from './kyc/kycService';
import { WalletService } from './wallet/walletService';
import { ApiKeyService } from './api/apiKeyService';
import { ComplianceService } from './compliance/complianceService';
import { MetricsCollector } from './observability/metrics';
import { KlineAggregator, KlineInterval } from './engine/klineAggregator';
import { ListingService } from './engine/listingService';
import { WorkerSupervisor } from './workers';
import { VolumeExecutionV2Service } from './services/bots/VolumeExecutionV2Service';
import {
  createVolumeExecutionV2Router,
  createMMConsoleVolumeBotAdapter,
} from './routes/volumeExecutionV2';

export function createApiRouter(
  dbMgr: DatabaseManager,
  authService: AuthService,
  ledgerService: LedgerService,
  engineManager: EngineManager,
  kycService: KycService,
  walletService: WalletService,
  apiKeyService: ApiKeyService,
  complianceService: ComplianceService,
  metricsCollector: MetricsCollector
): Router {
  const router = Router();
  const listingService = new ListingService(dbMgr, ledgerService, engineManager);
  const { requireAuth, requireRole, requireKyc } = createAuthMiddleware(authService);

  // Helper for audit logging
  const logAudit = (req: Request, action: string, resource: string, payload?: any) => {
    const actorId = req.user?.userId || 'anonymous';
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    complianceService.logAudit(actorId, action, resource, payload, ip);
  };

  // ==========================================
  // 1. OBSERVABILITY & SYSTEM
  // ==========================================
  router.get('/health', (_req: Request, res: Response) => {
    res.json(metricsCollector.getHealth());
  });

  router.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metricsCollector.getPrometheusMetrics());
  });

  // ==========================================
  // 2. AUTHENTICATION & SESSIONS
  // ==========================================
  router.post('/auth/register', (req: Request, res: Response) => {
    try {
      const { email, password, role } = req.body;
      const user = authService.register(email, password, role);
      logAudit(req, 'USER_REGISTER', `user:${user.id}`, { email });
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  const setAuthTokenCookie = (req: Request, res: Response, token: string) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      maxAge: 900000,
    });
  };

  router.post('/auth/login', (req: Request, res: Response) => {
    try {
      const { email, password, totpCode } = req.body;
      const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Unknown';

      const result = authService.login(email, password, ip, userAgent, totpCode);

      if (result.accessToken) {
        setAuthTokenCookie(req, res, result.accessToken);
        logAudit(req, 'USER_LOGIN', `user:${result.user?.id}`, { email, ip });
      }

      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(401).json({ success: false, error: err.message });
    }
  });

  router.post('/auth/login-2fa', (req: Request, res: Response) => {
    try {
      const { tempToken, totpCode } = req.body;
      const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Unknown';

      const result = authService.complete2FALogin(tempToken, totpCode, ip, userAgent);
      if (result.accessToken) {
        setAuthTokenCookie(req, res, result.accessToken);
        logAudit(req, 'USER_LOGIN_2FA', `user:${result.user?.id}`, { ip });
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(401).json({ success: false, error: err.message });
    }
  });

  router.post('/auth/refresh', (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;
      const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Unknown';

      const tokens = authService.refreshTokens(refreshToken, ip, userAgent);
      setAuthTokenCookie(req, res, tokens.accessToken);
      res.json({ success: true, ...tokens });
    } catch (err: any) {
      res.status(401).json({ success: false, error: err.message });
    }
  });

  router.get('/auth/me', requireAuth, (req: Request, res: Response) => {
    const user = authService.getUserById(req.user!.userId);
    res.json({ success: true, user });
  });

  router.post('/auth/logout', requireAuth, (req: Request, res: Response) => {
    authService.revokeSession(req.user!.userId, req.user!.sessionId);
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie('token', { httpOnly: true, secure: isHttps, sameSite: isHttps ? 'none' : 'lax' });
    res.json({ success: true, message: 'Logged out successfully' });
  });

  router.get('/auth/sessions', requireAuth, (req: Request, res: Response) => {
    const sessions = authService.listSessions(req.user!.userId);
    res.json({ success: true, sessions, currentSessionId: req.user!.sessionId });
  });

  router.post('/auth/sessions/revoke', requireAuth, (req: Request, res: Response) => {
    const { sessionId } = req.body;
    authService.revokeSession(req.user!.userId, sessionId);
    res.json({ success: true, message: 'Session revoked' });
  });

  router.post('/auth/2fa/setup', requireAuth, (req: Request, res: Response) => {
    const result = authService.setup2FA(req.user!.userId);
    res.json({ success: true, ...result });
  });

  router.post('/auth/2fa/enable', requireAuth, (req: Request, res: Response) => {
    const { code } = req.body;
    authService.enable2FA(req.user!.userId, code);
    logAudit(req, '2FA_ENABLED', `user:${req.user!.userId}`);
    res.json({ success: true, message: '2FA enabled successfully' });
  });

  router.post('/auth/2fa/disable', requireAuth, (req: Request, res: Response) => {
    const { code } = req.body;
    authService.disable2FA(req.user!.userId, code);
    logAudit(req, '2FA_DISABLED', `user:${req.user!.userId}`);
    res.json({ success: true, message: '2FA disabled successfully' });
  });

  // ==========================================
  // 3. MARKET DATA (PUBLIC)
  // ==========================================
  router.get('/market/pairs', (_req: Request, res: Response) => {
    const pairs = dbMgr.query('SELECT * FROM market_pairs ORDER BY is_active DESC, id ASC');
    res.json({
      success: true,
      exchange: 'SILENTSMILE',
      timezone: 'Asia/Jakarta',
      supportedResolutions: ['1', '5', '15', '60', '240', '1D'],
      pairs,
    });
  });

  router.post('/market/pairs/sync', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      if (!body.id) {
        return res.status(400).json({ success: false, error: 'Pair id is required' });
      }
      const cfg = await engineManager.ensurePairRegistered({
        id: String(body.id),
        baseAsset: body.baseAsset,
        quoteAsset: body.quoteAsset,
        basePrecision: body.basePrecision,
        quotePrecision: body.quotePrecision,
        minOrderSize: body.minOrderSize,
        makerFeeBps: body.makerFeeBps,
        takerFeeBps: body.takerFeeBps,
        isActive: body.isActive,
        tradingStatus: body.tradingStatus,
      });
      dbMgr.saveToFile();
      res.json({ success: true, pair: cfg });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/market/symbol/:pair', (req: Request, res: Response) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const cfg = engineManager.getPairConfig(pairId);
      res.json({
        success: true,
        symbol: {
          id: cfg.id,
          ticker: cfg.id,
          name: cfg.id,
          description: `${cfg.baseAsset} / ${cfg.quoteAsset} Spot`,
          exchange: 'SILENTSMILE',
          timezone: 'Asia/Jakarta',
          currencyCode: cfg.quoteAsset,
          baseAsset: cfg.baseAsset,
          quoteAsset: cfg.quoteAsset,
          basePrecision: cfg.basePrecision,
          quotePrecision: cfg.quotePrecision,
          minOrderSize: cfg.minOrderSize,
          tradingStatus: cfg.tradingStatus,
          supportedResolutions: ['1', '5', '15', '60', '240', '1D'],
        },
      });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.get('/market/tickers', (_req: Request, res: Response) => {
    const tickers = engineManager.getAllTickers();
    res.json({ success: true, tickers });
  });

  router.get('/market/ticker/:pair', (req: Request, res: Response) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const ticker = engineManager.getTicker(pairId);
      res.json({ success: true, ticker });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.get('/market/depth/:pair', (req: Request, res: Response) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const limit = parseInt(req.query.limit as string, 10) || 25;
      const depth = engineManager.getDepth(pairId, limit);
      res.json({ success: true, depth });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.get('/market/trades/:pair', (req: Request, res: Response) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const trades = engineManager.getRecentTrades(pairId, limit);
      res.json({ success: true, trades });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.get('/market/klines/:pair', (req: Request, res: Response) => {
    try {
      const pairId = decodeURIComponent(req.params.pair);
      const rawInterval = String(req.query.interval || '1m').trim();
      const normalizedInterval = rawInterval === '1D' ? '1d' : rawInterval;
      if (!KlineAggregator.isValidInterval(normalizedInterval)) {
        return res.status(400).json({
          success: false,
          error: `Unsupported interval "${rawInterval}". Supported: 1m, 5m, 15m, 1h, 4h, 1d`,
        });
      }

      const fromSec = req.query.from !== undefined ? Number(req.query.from) : undefined;
      const toSec = req.query.to !== undefined ? Number(req.query.to) : undefined;
      const countBack = req.query.countBack !== undefined ? parseInt(String(req.query.countBack), 10) : undefined;
      const limit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : 300;

      const result = engineManager.getFormattedCandles(pairId, normalizedInterval, {
        fromSec: fromSec !== undefined && Number.isFinite(fromSec) ? fromSec : undefined,
        toSec: toSec !== undefined && Number.isFinite(toSec) ? toSec : undefined,
        countBack: countBack !== undefined && Number.isFinite(countBack) ? countBack : undefined,
        limit: Number.isFinite(limit) ? limit : 300,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.post('/market/trades/record', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const pairMeta = body.pair && typeof body.pair === 'object' ? body.pair : undefined;
      const rawTrades: any[] = Array.isArray(body.trades)
        ? body.trades
        : body.pairId && body.price && body.amount
        ? [body]
        : [];

      if (rawTrades.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid executed trades supplied' });
      }

      const results = [];
      let recordedCount = 0;

      for (const trd of rawTrades) {
        const targetPairId = trd.pairId || trd.pair || pairMeta?.id;
        if (!targetPairId) continue;

        const r = await engineManager.recordExecutedTrade({
          id: String(trd.id || `trd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
          pairId: String(targetPairId),
          price: Number(trd.price),
          amount: Number(trd.amount),
          total: trd.total !== undefined ? Number(trd.total) : undefined,
          side: String(trd.side || 'buy'),
          makerOrderId: trd.makerOrderId,
          takerOrderId: trd.takerOrderId,
          makerUserId: trd.makerUserId,
          takerUserId: trd.takerUserId,
          makerFee: trd.makerFee,
          takerFee: trd.takerFee,
          timestamp: trd.timestamp !== undefined ? Number(trd.timestamp) : Date.now(),
          pairMeta,
        });
        if (r.recorded) recordedCount += 1;
        results.push(r);
      }

      if (recordedCount > 0) {
        dbMgr.saveToFile();
      }

      res.json({
        success: true,
        recordedCount,
        results,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 4. TRADING ORDERS (AUTHENTICATED)
  // ==========================================
  router.post('/orders', requireAuth, async (req: Request, res: Response) => {
    try {
      const { pairId, side, orderType, price, amount, clientOrderId } = req.body;
      const result = await engineManager.submitOrder(pairId, {
        userId: req.user!.userId,
        side,
        orderType,
        price: parseInt(price, 10),
        amount: parseInt(amount, 10),
        clientOrderId,
      });

      logAudit(req, 'PLACE_ORDER', `order:${result.orderId}`, { pairId, side, orderType, price, amount });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/orders/cancel', requireAuth, async (req: Request, res: Response) => {
    try {
      const { pairId, orderId } = req.body;
      await engineManager.cancelOrder(pairId, orderId, req.user!.userId);
      logAudit(req, 'CANCEL_ORDER', `order:${orderId}`, { pairId });
      res.json({ success: true, message: 'Order successfully cancelled' });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/orders/open', requireAuth, (req: Request, res: Response) => {
    const pairId = req.query.pairId ? decodeURIComponent(req.query.pairId as string) : null;
    let sql = `SELECT * FROM orders WHERE user_id = ? AND status IN ('NEW', 'PARTIALLY_FILLED')`;
    const params: any[] = [req.user!.userId];

    if (pairId) {
      sql += ' AND pair_id = ?';
      params.push(pairId);
    }
    sql += ' ORDER BY created_at DESC';

    const orders = dbMgr.query(sql, params);
    res.json({ success: true, orders });
  });

  router.get('/orders/history', requireAuth, (req: Request, res: Response) => {
    const orders = dbMgr.query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.user!.userId]
    );
    res.json({ success: true, orders });
  });

  // ==========================================
  // 5. WALLET & PAYMENTS (AUTHENTICATED)
  // ==========================================
  router.get('/wallet/balances', requireAuth, (req: Request, res: Response) => {
    const balances = ledgerService.getAllBalances(req.user!.userId);
    res.json({ success: true, balances });
  });

  router.get('/wallet/deposit/crypto-address', requireAuth, (req: Request, res: Response) => {
    try {
      const asset = (req.query.asset as string) || 'BTC';
      const chain = (req.query.chain as string) || 'Bitcoin';
      const address = walletService.getOrCreateDepositAddress(req.user!.userId, asset, chain);
      res.json({ success: true, address });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/wallet/deposit/simulate-chain', requireAuth, (req: Request, res: Response) => {
    try {
      const { address, amount, confirmations } = req.body;
      const result = walletService.simulateChainDeposit({
        address,
        amount: parseInt(amount, 10),
        confirmations: confirmations || 6,
      });
      logAudit(req, 'SIMULATE_CHAIN_DEPOSIT', `address:${address}`, { amount });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/wallet/deposit/va-create', requireAuth, (req: Request, res: Response) => {
    try {
      const { bankCode } = req.body;
      const va = walletService.createVirtualAccount(req.user!.userId, bankCode || 'BCA');
      res.json({ success: true, virtualAccount: va });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/wallet/deposit/va-simulate-webhook', requireAuth, (req: Request, res: Response) => {
    try {
      const { virtualAccountNumber, amount } = req.body;
      const result = walletService.simulateVaPaymentWebhook({
        virtualAccountNumber,
        paidAmount: parseInt(amount, 10),
        userId: req.user!.userId,
      });
      logAudit(req, 'SIMULATE_VA_PAYMENT', `va:${virtualAccountNumber}`, { amount });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/wallet/withdraw', requireAuth, (req: Request, res: Response) => {
    try {
      const { asset, amount, fee, destinationAddress, destinationBankName, destinationAccountName } = req.body;
      const result = walletService.requestWithdrawal({
        userId: req.user!.userId,
        asset,
        amount: parseInt(amount, 10),
        fee: parseInt(fee || '0', 10),
        destinationAddress,
        destinationBankName,
        destinationAccountName,
      });

      logAudit(req, 'REQUEST_WITHDRAWAL', `withdrawal:${result.id}`, { asset, amount, destinationAddress });
      res.json({ success: true, withdrawal: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/wallet/withdrawals', requireAuth, (req: Request, res: Response) => {
    const list = dbMgr.query(
      'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user!.userId]
    );
    res.json({ success: true, withdrawals: list });
  });

  router.get('/wallet/admin/withdrawals', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    const list = dbMgr.query(
      `SELECT w.*, u.email as user_email, u.name as user_name
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       ORDER BY w.created_at DESC LIMIT 100`
    );
    res.json({ success: true, withdrawals: list });
  });

  router.post('/wallet/withdrawals/:id/approve', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { txHash } = req.body;
      const result = walletService.approveWithdrawal(req.params.id, req.user!.userId, txHash);
      logAudit(req, 'APPROVE_WITHDRAWAL', `withdrawal:${req.params.id}`, { txHash });
      res.json({ success: true, withdrawal: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/wallet/withdrawals/:id/reject', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      const result = walletService.rejectWithdrawal(req.params.id, req.user!.userId, reason || 'Rejected by administrator');
      logAudit(req, 'REJECT_WITHDRAWAL', `withdrawal:${req.params.id}`, { reason });
      res.json({ success: true, withdrawal: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 5b. ASSET & NETWORK MANAGEMENT
  // ==========================================
  router.get('/assets', (_req: Request, res: Response) => {
    try {
      const assets = dbMgr.query<any>(
        `SELECT a.*, l.status as listing_status, l.deposit_status as listing_deposit_status, l.withdrawal_status as listing_withdrawal_status
         FROM assets a
         LEFT JOIN listings l ON a.listing_id = l.id
         ORDER BY a.category ASC, a.symbol ASC`
      );

      const networks = dbMgr.query<any>(
        `SELECT * FROM asset_networks ORDER BY asset_id ASC, network_name ASC`
      );

      const result = assets.map((a) => {
        const assetNets = networks.filter((n) => n.asset_id === a.id);
        return {
          ...a,
          networks: assetNets,
        };
      });

      res.json({ success: true, assets: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/assets/:symbol/networks', (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const asset = dbMgr.queryOne<any>('SELECT * FROM assets WHERE symbol = ?', [symbol]);
      if (!asset) {
        return res.status(404).json({ success: false, error: 'Asset not found' });
      }

      const networks = dbMgr.query<any>(
        'SELECT * FROM asset_networks WHERE asset_id = ? ORDER BY network_name ASC',
        [asset.id]
      );
      res.json({ success: true, asset, networks });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/assets/:symbol/networks', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const asset = dbMgr.queryOne<any>('SELECT * FROM assets WHERE symbol = ?', [symbol]);
      if (!asset) {
        return res.status(404).json({ success: false, error: 'Asset not found' });
      }

      const {
        networkId,
        networkName,
        chainType,
        nativeCurrency,
        contractAddress,
        decimals,
        minDeposit,
        depositConfirmations,
        depositStatus,
        withdrawalStatus,
        withdrawalFee,
        minWithdrawal,
        maxDailyWithdrawal,
        isMemoRequired,
        explorerTxUrl,
        explorerAddressUrl,
        rpcEndpoint,
      } = req.body;

      const now = Date.now();
      const id = `net_${asset.id}_${networkId}`;

      dbMgr.execute(
        `INSERT INTO asset_networks (
          id, asset_id, network_id, network_name, chain_type, native_currency, contract_address,
          decimals, min_deposit, deposit_confirmations, deposit_status, withdrawal_status,
          withdrawal_fee, min_withdrawal, max_daily_withdrawal, is_memo_required,
          explorer_tx_url, explorer_address_url, rpc_endpoint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, network_id) DO UPDATE SET
          network_name = excluded.network_name,
          chain_type = excluded.chain_type,
          native_currency = excluded.native_currency,
          contract_address = excluded.contract_address,
          decimals = excluded.decimals,
          min_deposit = excluded.min_deposit,
          deposit_confirmations = excluded.deposit_confirmations,
          deposit_status = excluded.deposit_status,
          withdrawal_status = excluded.withdrawal_status,
          withdrawal_fee = excluded.withdrawal_fee,
          min_withdrawal = excluded.min_withdrawal,
          max_daily_withdrawal = excluded.max_daily_withdrawal,
          is_memo_required = excluded.is_memo_required,
          explorer_tx_url = excluded.explorer_tx_url,
          explorer_address_url = excluded.explorer_address_url,
          rpc_endpoint = excluded.rpc_endpoint,
          updated_at = excluded.updated_at`,
        [
          id, asset.id, networkId, networkName, chainType || 'EVM', nativeCurrency || symbol, contractAddress || null,
          decimals || 18, minDeposit || 0, depositConfirmations || 12, depositStatus || 'OPEN', withdrawalStatus || 'OPEN',
          withdrawalFee || 0, minWithdrawal || 0, maxDailyWithdrawal || null, isMemoRequired ? 1 : 0,
          explorerTxUrl || '', explorerAddressUrl || '', rpcEndpoint || null, now, now
        ]
      );

      logAudit(req, 'CONFIG_ASSET_NETWORK', `asset:${symbol}:${networkId}`, { networkName, chainType, withdrawalFee });
      const updated = dbMgr.queryOne('SELECT * FROM asset_networks WHERE id = ?', [id]);
      res.json({ success: true, network: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/assets/:symbol/toggle-status', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const { feature, status, networkId } = req.body;
      const asset = dbMgr.queryOne<any>('SELECT * FROM assets WHERE symbol = ?', [symbol]);
      if (!asset) return res.status(404).json({ success: false, error: 'Asset not found' });

      const now = Date.now();
      if (networkId) {
        const field = feature === 'deposit' ? 'deposit_status' : 'withdrawal_status';
        dbMgr.execute(
          `UPDATE asset_networks SET ${field} = ?, updated_at = ? WHERE asset_id = ? AND network_id = ?`,
          [status, now, asset.id, networkId]
        );
      } else {
        const field = feature === 'deposit' ? 'deposit_enabled' : 'withdrawal_enabled';
        const val = status === 'OPEN' || status === 1 ? 1 : 0;
        dbMgr.execute(`UPDATE assets SET ${field} = ?, updated_at = ? WHERE id = ?`, [val, now, asset.id]);
      }

      logAudit(req, 'TOGGLE_ASSET_STATUS', `asset:${symbol}`, { feature, status, networkId });
      res.json({ success: true, message: `Status updated successfully for ${symbol}` });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/wallet/ledger-entries', requireAuth, (req: Request, res: Response) => {
    const entries = dbMgr.query(
      `SELECT e.*, t.category, t.description
       FROM ledger_entries e
       JOIN ledger_accounts a ON e.account_id = a.id
       JOIN ledger_transactions t ON e.transaction_id = t.id
       WHERE a.user_id = ?
       ORDER BY e.created_at DESC LIMIT 100`,
      [req.user!.userId]
    );
    res.json({ success: true, entries });
  });

  // ==========================================
  // 6. KYC VERIFICATION (AUTHENTICATED)
  // ==========================================
  router.get('/kyc/me', requireAuth, (req: Request, res: Response) => {
    const app = kycService.getApplicationByUserId(req.user!.userId);
    const user = authService.getUserById(req.user!.userId);
    res.json({ success: true, application: app, kycLevel: user?.kyc_level || 0 });
  });

  router.post('/kyc/submit', requireAuth, (req: Request, res: Response) => {
    try {
      const { fullName, idNumber, idCardUrl, selfieUrl } = req.body;
      const app = kycService.submitApplication({
        userId: req.user!.userId,
        fullName,
        idNumber,
        idCardUrl,
        selfieUrl,
      });
      logAudit(req, 'SUBMIT_KYC', `kyc:${app.id}`, { fullName, idNumber });
      res.json({ success: true, application: app });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/kyc/sumsub-webhook', (req: Request, res: Response) => {
    try {
      const { vendorReference, reviewResult, moderationComment } = req.body;
      const result = kycService.simulateSumsubWebhook({
        vendorReference,
        reviewResult,
        moderationComment,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 7. PUBLIC API KEYS (AUTHENTICATED)
  // ==========================================
  router.post('/keys/create', requireAuth, (req: Request, res: Response) => {
    try {
      const { permissions, ipWhitelist, rateLimitRpm } = req.body;
      const key = apiKeyService.createApiKey(
        req.user!.userId,
        permissions,
        ipWhitelist,
        parseInt(rateLimitRpm || '120', 10)
      );
      logAudit(req, 'CREATE_API_KEY', `key:${key.keyId}`);
      res.json({ success: true, apiKey: key });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/keys', requireAuth, (req: Request, res: Response) => {
    const keys = apiKeyService.listApiKeys(req.user!.userId);
    res.json({ success: true, keys });
  });

  router.post('/keys/revoke', requireAuth, (req: Request, res: Response) => {
    const { keyId } = req.body;
    apiKeyService.revokeApiKey(req.user!.userId, keyId);
    logAudit(req, 'REVOKE_API_KEY', `key:${keyId}`);
    res.json({ success: true, message: 'API key revoked' });
  });

  // ==========================================
  // 8. ADMIN PANEL & COMPLIANCE (ROLE: ADMIN)
  // ==========================================
  router.get('/admin/users', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    const users = dbMgr.query(
      'SELECT id, email, role, status, kyc_level, totp_enabled, daily_withdraw_limit_idr, created_at FROM users ORDER BY created_at DESC LIMIT 200'
    );
    res.json({ success: true, users });
  });

  router.post('/admin/users/freeze', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    const { targetUserId, reason } = req.body;
    complianceService.freezeAccount(targetUserId, reason || 'Compliance Hold', req.user!.userId, req.ip);
    res.json({ success: true, message: `Account ${targetUserId} has been frozen` });
  });

  router.post('/admin/users/unfreeze', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    const { targetUserId, reason } = req.body;
    complianceService.unfreezeAccount(targetUserId, reason || 'Hold Released', req.user!.userId, req.ip);
    res.json({ success: true, message: `Account ${targetUserId} has been un-frozen` });
  });

  router.get('/admin/kyc/pending', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    const pending = kycService.getPendingApplications();
    res.json({ success: true, applications: pending });
  });

  router.post('/admin/kyc/review', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { applicationId, decision, rejectReason } = req.body;
      const updated = kycService.reviewApplication({
        applicationId,
        reviewerId: req.user!.userId,
        decision,
        rejectReason,
      });
      logAudit(req, 'REVIEW_KYC', `kyc:${applicationId}`, { decision, rejectReason });
      res.json({ success: true, application: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/admin/withdrawals/pending', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    const pending = dbMgr.query(
      `SELECT w.*, u.email, u.kyc_level
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.status = 'pending_approval' ORDER BY w.created_at ASC`
    );
    res.json({ success: true, withdrawals: pending });
  });

  router.post('/admin/withdrawals/approve', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { withdrawalId, txHash } = req.body;
      const updated = walletService.approveWithdrawal(withdrawalId, req.user!.userId, txHash);
      logAudit(req, 'APPROVE_WITHDRAWAL', `withdrawal:${withdrawalId}`, { txHash });
      res.json({ success: true, withdrawal: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/admin/withdrawals/reject', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { withdrawalId, reason } = req.body;
      const updated = walletService.rejectWithdrawal(withdrawalId, req.user!.userId, reason || 'Rejected by admin');
      logAudit(req, 'REJECT_WITHDRAWAL', `withdrawal:${withdrawalId}`, { reason });
      res.json({ success: true, withdrawal: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/admin/pairs/halt', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    const { pairId, status } = req.body;
    engineManager.setTradingStatus(pairId, status);
    logAudit(req, 'HALT_PAIR', `pair:${pairId}`, { status });
    res.json({ success: true, message: `Pair ${pairId} status updated to ${status}` });
  });

  router.post('/admin/pairs/fees', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    const { pairId, makerBps, takerBps } = req.body;
    engineManager.updateFees(pairId, parseInt(makerBps, 10), parseInt(takerBps, 10));
    logAudit(req, 'UPDATE_FEES', `pair:${pairId}`, { makerBps, takerBps });
    res.json({ success: true, message: `Pair ${pairId} fees updated to ${makerBps}/${takerBps} bps` });
  });

  router.get('/admin/audit-logs', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    const logs = complianceService.getAuditLogs(100);
    res.json({ success: true, logs });
  });

  router.get('/admin/compliance-alerts', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    const alerts = complianceService.scanSuspiciousActivities();
    res.json({ success: true, alerts });
  });

  router.get('/admin/compliance-report', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    const type = ((req.query.type as string) || 'TRADES').toUpperCase() as 'TRADES' | 'LEDGER' | 'AUDIT';
    const csvData = complianceService.generateComplianceReport(type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=compliance_${type.toLowerCase()}_${Date.now()}.csv`);
    res.send(csvData);
  });

  router.get('/admin/ledger-audit', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    const audit = ledgerService.verifyLedgerIntegrity();
    res.json({ success: true, audit });
  });

  // ==========================================
  // 9. INITIAL LISTING & SCHEDULER SYSTEM
  // ==========================================
  router.get('/listings', (_req: Request, res: Response) => {
    try {
      const listings = listingService.getAllListings();
      res.json({ success: true, listings });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/listings/:id', (req: Request, res: Response) => {
    try {
      const listing = listingService.getListingById(req.params.id);
      if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
      res.json({ success: true, listing });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/listings/pair', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const listing = listingService.createMarketPairDraft({
        ...req.body,
        actorId: req.user!.userId,
      });
      logAudit(req, 'CREATE_MARKET_PAIR', `pair:${listing.market_id}`, req.body);
      res.json({ success: true, listing });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/listings/:id/review', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { action, reason } = req.body;
      const listing = listingService.reviewListing(req.params.id, action, req.user!.userId, reason);
      logAudit(req, `LISTING_REVIEW_${action.toUpperCase()}`, `listing:${req.params.id}`, { reason });
      res.json({ success: true, listing });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/listings/:id/schedule', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const listing = listingService.scheduleListing(req.params.id, {
        ...req.body,
        actorId: req.user!.userId,
      });
      logAudit(req, 'SCHEDULE_LISTING', `listing:${req.params.id}`, req.body);
      res.json({ success: true, listing });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/listings/:id/allocate-funding', requireAuth, (req: Request, res: Response) => {
    try {
      if (req.user?.role !== 'admin' && req.user?.role !== 'market_maker') {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }
      const { asset, amount, idempotencyKey } = req.body;
      const result = listingService.allocateTreasuryFunding(
        req.params.id,
        asset,
        parseInt(amount, 10),
        req.user!.userId,
        idempotencyKey || `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      );
      logAudit(req, 'ALLOCATE_MM_FUNDING', `listing:${req.params.id}`, { asset, amount });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/listings/:id/toggle-access', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { feature, status } = req.body;
      const listing = listingService.toggleFeatureAccess(req.params.id, feature, status, req.user!.userId);
      logAudit(req, 'TOGGLE_FEATURE_ACCESS', `listing:${req.params.id}`, { feature, status });
      res.json({ success: true, listing });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/listings/reconcile', (_req: Request, res: Response) => {
    try {
      const transitions = listingService.reconcileSchedules();
      res.json({ success: true, transitions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 10. ASSET & NETWORK MANAGEMENT (BASE ASSET & CREATION)
  // ==========================================
  router.get('/assets', (_req: Request, res: Response) => {
    try {
      const assets = dbMgr.query<any>('SELECT * FROM assets ORDER BY created_at ASC');
      const networks = dbMgr.query<any>('SELECT * FROM asset_networks ORDER BY created_at ASC');

      const fullAssets = assets.map((a: any) => ({
        ...a,
        networks: networks.filter((n: any) => n.asset_id === a.id),
      }));

      res.json({ success: true, assets: fullAssets });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/assets', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const {
        symbol,
        name,
        decimals,
        category,
        color,
        primaryChain,
        tokenStandard,
        contractAddress,
        totalSupply,
        maxSupply,
        circulatingSupply,
        description,
        websiteUrl,
        whitepaperUrl,
        explorerUrl,
        genesisDate,
        initialPrice,
        initialNetwork,
      } = req.body;

      if (!symbol || !name) {
        return res.status(400).json({ success: false, error: 'Simbol dan nama aset wajib diisi.' });
      }

      const cleanSymbol = symbol.trim().toUpperCase();
      const existing = dbMgr.queryOne('SELECT id FROM assets WHERE symbol = ?', [cleanSymbol]);
      if (existing) {
        return res.status(400).json({ success: false, error: `Aset dengan simbol ${cleanSymbol} sudah terdaftar.` });
      }

      const assetId = `ast_${cleanSymbol.toLowerCase()}`;
      const now = Date.now();

      dbMgr.execute(
        `INSERT INTO assets (
          id, symbol, name, decimals, category, color, deposit_enabled, withdrawal_enabled,
          primary_chain, token_standard, contract_address, total_supply, max_supply, circulating_supply,
          description, website_url, whitepaper_url, explorer_url, genesis_date, initial_price, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [
          assetId,
          cleanSymbol,
          name.trim(),
          Number(decimals ?? 18),
          category || 'TOKEN',
          color || '#A855F7',
          primaryChain || 'Ethereum (ERC-20)',
          tokenStandard || 'ERC-20',
          contractAddress || null,
          Number(totalSupply ?? 1000000000),
          maxSupply !== undefined && maxSupply !== null ? Number(maxSupply) : null,
          Number(circulatingSupply ?? (totalSupply ? Number(totalSupply) * 0.25 : 250000000)),
          description || null,
          websiteUrl || null,
          whitepaperUrl || null,
          explorerUrl || null,
          genesisDate || new Date().toISOString().slice(0, 10),
          Number(initialPrice ?? 10000),
          now,
          now,
        ]
      );

      // If initial network is provided, create it
      if (initialNetwork) {
        const netId = initialNetwork.networkId || `${cleanSymbol.toLowerCase()}-default`;
        dbMgr.execute(
          `INSERT INTO asset_networks (
            id, asset_id, network_id, network_name, chain_type, native_currency, contract_address,
            decimals, min_deposit, deposit_confirmations, deposit_status, withdrawal_status,
            withdrawal_fee, min_withdrawal, is_memo_required, explorer_tx_url, explorer_address_url,
            rpc_endpoint, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `net_${assetId}_${netId}`,
            assetId,
            netId,
            initialNetwork.networkName || `${primaryChain || 'Default'} Network`,
            initialNetwork.chainType || 'EVM',
            initialNetwork.nativeCurrency || 'ETH',
            contractAddress || null,
            Number(decimals ?? 18),
            Number(initialNetwork.minDeposit ?? 1),
            Number(initialNetwork.depositConfirmations ?? 12),
            Number(initialNetwork.withdrawalFee ?? 0.1),
            Number(initialNetwork.minWithdrawal ?? 1),
            initialNetwork.isMemoRequired ? 1 : 0,
            initialNetwork.explorerTxUrl || 'https://etherscan.io/tx/{txHash}',
            initialNetwork.explorerAddressUrl || 'https://etherscan.io/address/{address}',
            initialNetwork.rpcEndpoint || null,
            now,
            now,
          ]
        );
      }

      logAudit(req, 'CREATE_BASE_ASSET', `asset:${cleanSymbol}`, { symbol: cleanSymbol, name });
      dbMgr.saveToFile();

      res.json({
        success: true,
        asset: {
          id: assetId,
          symbol: cleanSymbol,
          name: name.trim(),
          primaryChain,
          tokenStandard,
          contractAddress,
          totalSupply,
          circulatingSupply,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/assets/:symbol', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const existing = dbMgr.queryOne<any>('SELECT * FROM assets WHERE symbol = ?', [symbol]);
      if (!existing) {
        return res.status(404).json({ success: false, error: `Aset ${symbol} tidak ditemukan.` });
      }

      const {
        name,
        category,
        color,
        primaryChain,
        tokenStandard,
        contractAddress,
        totalSupply,
        maxSupply,
        circulatingSupply,
        description,
        websiteUrl,
        whitepaperUrl,
        explorerUrl,
        genesisDate,
        initialPrice,
        status,
      } = req.body;

      const now = Date.now();
      dbMgr.execute(
        `UPDATE assets SET
          name = COALESCE(?, name),
          category = COALESCE(?, category),
          color = COALESCE(?, color),
          primary_chain = COALESCE(?, primary_chain),
          token_standard = COALESCE(?, token_standard),
          contract_address = COALESCE(?, contract_address),
          total_supply = COALESCE(?, total_supply),
          max_supply = ?,
          circulating_supply = COALESCE(?, circulating_supply),
          description = COALESCE(?, description),
          website_url = COALESCE(?, website_url),
          whitepaper_url = COALESCE(?, whitepaper_url),
          explorer_url = COALESCE(?, explorer_url),
          genesis_date = COALESCE(?, genesis_date),
          initial_price = COALESCE(?, initial_price),
          status = COALESCE(?, status),
          updated_at = ?
         WHERE symbol = ?`,
        [
          name,
          category,
          color,
          primaryChain,
          tokenStandard,
          contractAddress,
          totalSupply !== undefined ? Number(totalSupply) : null,
          maxSupply !== undefined ? (maxSupply === null ? null : Number(maxSupply)) : existing.max_supply,
          circulatingSupply !== undefined ? Number(circulatingSupply) : null,
          description,
          websiteUrl,
          whitepaperUrl,
          explorerUrl,
          genesisDate,
          initialPrice !== undefined ? Number(initialPrice) : null,
          status,
          now,
          symbol,
        ]
      );

      logAudit(req, 'UPDATE_BASE_ASSET', `asset:${symbol}`, req.body);
      dbMgr.saveToFile();

      res.json({ success: true, message: `Aset ${symbol} berhasil diperbarui.` });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/assets/:symbol/networks', (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const networks = dbMgr.query(
        'SELECT an.* FROM asset_networks an JOIN assets a ON an.asset_id = a.id WHERE a.symbol = ?',
        [symbol]
      );
      res.json({ success: true, networks });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/assets/:symbol/networks', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const asset = dbMgr.queryOne<any>('SELECT id FROM assets WHERE symbol = ?', [symbol]);
      if (!asset) return res.status(404).json({ success: false, error: 'Aset tidak ditemukan' });

      const n = req.body;
      const now = Date.now();
      dbMgr.execute(
        `INSERT OR REPLACE INTO asset_networks (
          id, asset_id, network_id, network_name, chain_type, native_currency, contract_address,
          decimals, min_deposit, deposit_confirmations, deposit_status, withdrawal_status,
          withdrawal_fee, min_withdrawal, is_memo_required, explorer_tx_url, explorer_address_url,
          rpc_endpoint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `net_${asset.id}_${n.networkId}`,
          asset.id,
          n.networkId,
          n.networkName,
          n.chainType,
          n.nativeCurrency,
          n.contractAddress || null,
          n.decimals || 18,
          n.minDeposit || 0,
          n.depositConfirmations || 12,
          n.depositStatus || 'OPEN',
          n.withdrawalStatus || 'OPEN',
          n.withdrawalFee || 0,
          n.minWithdrawal || 0,
          n.isMemoRequired ? 1 : 0,
          n.explorerTxUrl,
          n.explorerAddressUrl,
          n.rpcEndpoint || null,
          now,
          now,
        ]
      );
      dbMgr.saveToFile();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/assets/:symbol/toggle-status', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const { feature, enabled } = req.body;
      const col = feature === 'deposit' ? 'deposit_enabled' : 'withdrawal_enabled';
      dbMgr.execute(`UPDATE assets SET ${col} = ?, updated_at = ? WHERE symbol = ?`, [
        enabled ? 1 : 0,
        Date.now(),
        symbol,
      ]);
      dbMgr.saveToFile();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/wallet/admin/withdrawals', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    try {
      const withdrawals = dbMgr.query('SELECT * FROM ledger_transactions WHERE transaction_type = ? ORDER BY timestamp DESC LIMIT 100', ['WITHDRAWAL']);
      res.json({ success: true, withdrawals });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 11. MARKET MAKER CONSOLE & RISK ENGINE
  // ==========================================
  router.get('/mm/bots', requireAuth, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      let bots: any[];
      if (user.role === 'admin') {
        bots = dbMgr.query('SELECT * FROM mm_bots ORDER BY updated_at DESC');
      } else {
        bots = dbMgr.query('SELECT * FROM mm_bots WHERE account_id = ? ORDER BY updated_at DESC', [user.userId]);
      }

      const parsed = bots.map((b) => ({
        ...b,
        mapping: JSON.parse(b.mapping_config_json || '{}'),
        depthConfig: b.depth_config_json ? JSON.parse(b.depth_config_json) : undefined,
        riskProfile: JSON.parse(b.risk_profile_json || '{}'),
      }));
      res.json({ success: true, bots: parsed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/mm/bots', requireAuth, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role !== 'admin' && user.role !== 'market_maker') {
        return res.status(403).json({ success: false, error: 'Unauthorized: Market Maker or Admin role required' });
      }

      const {
        id: requestedId,
        name,
        strategy,
        accountId,
        targetMarketSymbol,
        mapping,
        depthConfig,
        riskProfile,
        minRepriceIntervalMs,
        minPriceChangeBps,
        targetSpreadBps,
        dryRun,
        apiKeyId,
        status: initialStatus,
      } = req.body;

      if (!name || !targetMarketSymbol) {
        return res.status(400).json({ success: false, error: 'Bot name and target market symbol are required' });
      }

      const botId = requestedId || `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = Date.now();
      const targetAccountId = accountId || (user.role === 'admin' ? 'usr_mm_01' : user.userId);
      const botStatus = initialStatus === 'RUNNING' ? 'RUNNING' : 'STOPPED';

      dbMgr.execute(
        `INSERT OR REPLACE INTO mm_bots (
          id, name, strategy, account_id, api_key_id, target_market_symbol,
          mapping_config_json, depth_config_json, risk_profile_json, status,
          dry_run, min_reprice_interval_ms, min_price_change_bps, target_spread_bps,
          version, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          botId,
          name.trim(),
          strategy || 'DEPTH_LIQUIDITY_LADDER',
          targetAccountId,
          apiKeyId || null,
          targetMarketSymbol,
          JSON.stringify(mapping || {}),
          depthConfig ? JSON.stringify(depthConfig) : null,
          JSON.stringify(riskProfile || {}),
          botStatus,
          dryRun ? 1 : 0,
          minRepriceIntervalMs ?? 2500,
          minPriceChangeBps ?? 15,
          targetSpreadBps ?? 25,
          user.userId,
          now,
          now,
        ]
      );

      logAudit(req, 'CREATE_MM_BOT', `bot:${botId}`, { name, targetMarketSymbol });
      dbMgr.saveToFile();

      res.json({ success: true, botId, message: 'Bot successfully created and configured' });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/mm/bots/:id', requireAuth, (req: Request, res: Response) => {
    try {
      const bot = dbMgr.queryOne<any>('SELECT * FROM mm_bots WHERE id = ?', [req.params.id]);
      if (!bot) return res.status(404).json({ success: false, error: 'Bot not found' });

      const {
        name,
        strategy,
        targetMarketSymbol,
        mapping,
        depthConfig,
        riskProfile,
        minRepriceIntervalMs,
        minPriceChangeBps,
        targetSpreadBps,
        dryRun,
      } = req.body;

      dbMgr.execute(
        `UPDATE mm_bots
         SET name = COALESCE(?, name),
             strategy = COALESCE(?, strategy),
             target_market_symbol = COALESCE(?, target_market_symbol),
             mapping_config_json = COALESCE(?, mapping_config_json),
             depth_config_json = COALESCE(?, depth_config_json),
             risk_profile_json = COALESCE(?, risk_profile_json),
             min_reprice_interval_ms = COALESCE(?, min_reprice_interval_ms),
             min_price_change_bps = COALESCE(?, min_price_change_bps),
             target_spread_bps = COALESCE(?, target_spread_bps),
             dry_run = COALESCE(?, dry_run),
             version = version + 1,
             updated_at = ?
         WHERE id = ?`,
        [
          name ? name.trim() : null,
          strategy || null,
          targetMarketSymbol || null,
          mapping ? JSON.stringify(mapping) : null,
          depthConfig ? JSON.stringify(depthConfig) : null,
          riskProfile ? JSON.stringify(riskProfile) : null,
          minRepriceIntervalMs !== undefined ? Number(minRepriceIntervalMs) : null,
          minPriceChangeBps !== undefined ? Number(minPriceChangeBps) : null,
          targetSpreadBps !== undefined ? Number(targetSpreadBps) : null,
          dryRun !== undefined ? (dryRun ? 1 : 0) : null,
          Date.now(),
          req.params.id,
        ]
      );

      logAudit(req, 'UPDATE_MM_BOT', `bot:${req.params.id}`, { name, targetMarketSymbol });
      dbMgr.saveToFile();
      res.json({ success: true, message: 'Bot configuration updated' });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/mm/bots/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const bot = dbMgr.queryOne<any>('SELECT * FROM mm_bots WHERE id = ?', [req.params.id]);
      if (!bot) return res.status(404).json({ success: false, error: 'Bot not found' });

      try {
        const supervisor = WorkerSupervisor.getInstance();
        await supervisor.mmBotWorker.cancelOrdersForBot(bot.id, bot.account_id, bot.target_market_symbol);
      } catch {}

      dbMgr.execute('DELETE FROM mm_bots WHERE id = ?', [req.params.id]);
      logAudit(req, 'DELETE_MM_BOT', `bot:${req.params.id}`, { name: bot.name });
      dbMgr.saveToFile();
      res.json({ success: true, message: 'Bot deleted' });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/mm/bots/:id/lifecycle', requireAuth, async (req: Request, res: Response) => {
    try {
      const { action } = req.body; // 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'EMERGENCY_STOP'
      const bot = dbMgr.queryOne<any>('SELECT * FROM mm_bots WHERE id = ?', [req.params.id]);
      if (!bot) return res.status(404).json({ success: false, error: 'Bot not found' });

      let nextStatus = bot.status;
      if (action === 'START' || action === 'RESUME') nextStatus = 'RUNNING';
      else if (action === 'PAUSE') nextStatus = 'PAUSED';
      else if (action === 'STOP' || action === 'EMERGENCY_STOP') nextStatus = 'STOPPED';

      if (nextStatus !== 'RUNNING') {
        try {
          const supervisor = WorkerSupervisor.getInstance();
          await supervisor.mmBotWorker.cancelOrdersForBot(bot.id, bot.account_id, bot.target_market_symbol);
        } catch {}
      }

      dbMgr.execute(
        'UPDATE mm_bots SET status = ?, active_open_orders_count = CASE WHEN ? != \'RUNNING\' THEN 0 ELSE active_open_orders_count END, error_message = NULL, updated_at = ? WHERE id = ?',
        [nextStatus, nextStatus, Date.now(), req.params.id]
      );

      if (nextStatus === 'RUNNING') {
        try {
          const supervisor = WorkerSupervisor.getInstance();
          supervisor.mmBotWorker.executeCycle().catch(() => {});
        } catch {}
      }

      logAudit(req, `MM_BOT_${action}`, `bot:${req.params.id}`, { previousStatus: bot.status, nextStatus });
      dbMgr.saveToFile();

      res.json({ success: true, status: nextStatus, message: `Bot status updated to ${nextStatus}` });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/mm/bots/emergency-stop', requireAuth, async (req: Request, res: Response) => {
    try {
      const runningBots = dbMgr.query<any>("SELECT * FROM mm_bots WHERE status = 'RUNNING'");
      try {
        const supervisor = WorkerSupervisor.getInstance();
        for (const bot of runningBots) {
          await supervisor.mmBotWorker.cancelOrdersForBot(bot.id, bot.account_id, bot.target_market_symbol);
        }
      } catch {}

      dbMgr.execute(
        "UPDATE mm_bots SET status = 'STOPPED', active_open_orders_count = 0, total_bid_exposure = 0, total_ask_exposure = 0, updated_at = ?",
        [Date.now()]
      );
      logAudit(req, 'GLOBAL_EMERGENCY_STOP', 'mm_bots:all', { stoppedCount: runningBots.length });
      dbMgr.saveToFile();
      res.json({ success: true, stoppedCount: runningBots.length });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/mm/bots/:id/clone', requireAuth, (req: Request, res: Response) => {
    try {
      const sourceBot = dbMgr.queryOne<any>('SELECT * FROM mm_bots WHERE id = ?', [req.params.id]);
      if (!sourceBot) return res.status(404).json({ success: false, error: 'Source bot not found' });

      const newBotId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = Date.now();
      const clonedName = `${sourceBot.name} (Clone)`;

      dbMgr.execute(
        `INSERT INTO mm_bots (
          id, name, strategy, account_id, api_key_id, target_market_symbol,
          mapping_config_json, depth_config_json, risk_profile_json, status,
          dry_run, min_reprice_interval_ms, min_price_change_bps, target_spread_bps,
          version, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'STOPPED', ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          newBotId,
          clonedName,
          sourceBot.strategy,
          sourceBot.account_id || req.user!.userId,
          sourceBot.target_market_symbol,
          sourceBot.mapping_config_json,
          sourceBot.depth_config_json,
          sourceBot.risk_profile_json,
          sourceBot.dry_run,
          sourceBot.min_reprice_interval_ms,
          sourceBot.min_price_change_bps,
          sourceBot.target_spread_bps,
          req.user!.userId,
          now,
          now,
        ]
      );

      logAudit(req, 'CLONE_MM_BOT', `bot:${newBotId}`, { sourceBotId: req.params.id });
      dbMgr.saveToFile();

      res.json({ success: true, botId: newBotId, message: `Bot successfully cloned as ${clonedName}` });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/mm/fx-rate', (_req: Request, res: Response) => {
    try {
      const latestFx = dbMgr.queryOne<any>('SELECT * FROM fx_rates ORDER BY created_at DESC LIMIT 1');
      res.json({
        success: true,
        rate: latestFx ? latestFx.rate : 16250,
        source: latestFx ? latestFx.source : 'BANK_INDONESIA',
        expiresAt: latestFx ? latestFx.expires_at : Date.now() + 86400000,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/mm/fx-rate', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { rate, source, durationHours } = req.body;
      const numRate = Number(rate);
      if (!numRate || numRate < 10000 || numRate > 25000) {
        return res.status(400).json({ success: false, error: 'Nilai kurs tidak wajar (wajib Rp 10.000 - Rp 25.000)' });
      }

      const now = Date.now();
      const expiresAt = now + (durationHours || 24) * 3600000;
      dbMgr.execute(
        'INSERT INTO fx_rates (id, source, pair, rate, expires_at, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`fx_${now}`, source || 'MANUAL_ADMIN', 'USDT/IDR', numRate, expiresAt, req.user!.userId, now]
      );

      try {
        const supervisor = WorkerSupervisor.getInstance();
        supervisor.priceAggregator.setFxRate(numRate, source || 'MANUAL_ADMIN', req.user!.userId);
      } catch {}

      logAudit(req, 'SET_MANUAL_FX_RATE', 'USDT/IDR', { rate: numRate, source, expiresAt });
      dbMgr.saveToFile();

      res.json({ success: true, rate: numRate, expiresAt });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/mm/cryptographic-audit', requireAuth, (req: Request, res: Response) => {
    try {
      const logs = dbMgr.query('SELECT * FROM cryptographic_audit_logs ORDER BY log_index DESC LIMIT 100');
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/mm/feeds/live', (_req: Request, res: Response) => {
    try {
      const supervisor = WorkerSupervisor.getInstance();
      res.json({ success: true, ...supervisor.getStatus() });
    } catch (err: any) {
      res.status(503).json({
        success: false,
        isRunning: false,
        error: err.message,
      });
    }
  });

  router.get('/mm/workers/status', requireAuth, (_req: Request, res: Response) => {
    try {
      const supervisor = WorkerSupervisor.getInstance();
      res.json({ success: true, ...supervisor.getStatus() });
    } catch (err: any) {
      res.status(503).json({
        success: false,
        isRunning: false,
        message: 'Workers supervisor unavailable',
        error: err.message,
      });
    }
  });

  // ==========================================
  // 12. VOLUME EXECUTION V2 ENGINE & MM CONSOLE ADAPTER
  // ==========================================
  let fallbackVolumeService: VolumeExecutionV2Service | null = null;
  const getVolumeService = (): VolumeExecutionV2Service => {
    try {
      return WorkerSupervisor.getInstance().volumeExecutionService;
    } catch {
      if (!fallbackVolumeService) {
        fallbackVolumeService = new VolumeExecutionV2Service(dbMgr, ledgerService, engineManager);
      }
      return fallbackVolumeService;
    }
  };

  router.use(
    '/volume-execution-v2',
    createVolumeExecutionV2Router(dbMgr, authService, complianceService, getVolumeService)
  );
  router.use(
    '/mm/volume-bot',
    createMMConsoleVolumeBotAdapter(dbMgr, authService, complianceService, getVolumeService)
  );

  return router;
}
