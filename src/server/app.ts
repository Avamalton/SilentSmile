import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import { dbManager } from './db/database';
import { runMigrations } from './db/migrations';
import { AuthService } from './auth/authService';
import { LedgerService } from './ledger/ledgerService';
import { EngineManager } from './engine/engineManager';
import { KycService } from './kyc/kycService';
import { WalletService } from './wallet/walletService';
import { ApiKeyService } from './api/apiKeyService';
import { ComplianceService } from './compliance/complianceService';
import { MetricsCollector } from './observability/metrics';
import { createApiRouter } from './routes';
import { WorkerSupervisor } from './workers';

export async function bootstrap() {
  const app = express();
  app.set('trust proxy', 1);
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Initialize DB and migrations
  await dbManager.initialize();
  await runMigrations(dbManager);

  // Initialize Core Services
  const authService = new AuthService(dbManager);
  const ledgerService = new LedgerService(dbManager);
  const kycService = new KycService(dbManager);
  const walletService = new WalletService(dbManager, ledgerService, kycService);
  const apiKeyService = new ApiKeyService(dbManager);
  const complianceService = new ComplianceService(dbManager);
  const metricsCollector = new MetricsCollector(dbManager);
  const engineManager = EngineManager.getInstance(dbManager, ledgerService);

  await engineManager.initialize();

  // Initialize and start background Market Maker workers & feed aggregators
  const workerSupervisor = WorkerSupervisor.initialize(dbManager, ledgerService, engineManager);
  try {
    const latestFx = dbManager.queryOne<any>('SELECT * FROM fx_rates ORDER BY created_at DESC LIMIT 1');
    if (latestFx && latestFx.source === 'MANUAL_ADMIN' && Number(latestFx.expires_at) > Date.now()) {
      workerSupervisor.priceAggregator.setFxRate(
        Number(latestFx.rate),
        'MANUAL_ADMIN',
        String(latestFx.updated_by || 'admin')
      );
    }
  } catch {}
  workerSupervisor.start();

  // Setup WebSocket Server for Real-Time Market Data & MM Feeds on /ws only
  // Using noServer + explicit /ws upgrade routing avoids collisions with Vite middleware/HMR upgrades
  const wss = new WebSocketServer({ noServer: true });
  const clientSubscriptions = new Map<WebSocket, Set<string>>();

  wss.on('error', (err) => {
    console.error('[WebSocketServer] Error:', err.message);
  });

  const enableViteHmr = process.env.ENABLE_HMR === 'true' && process.env.DISABLE_HMR !== 'true';

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '/';
    if (reqUrl === '/ws' || reqUrl.startsWith('/ws?')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (process.env.NODE_ENV === 'production' || !enableViteHmr) {
      socket.destroy();
    }
    // In dev mode when HMR is explicitly enabled, non-/ws upgrade requests are left for Vite
  });

  wss.on('connection', (ws: WebSocket) => {
    clientSubscriptions.set(ws, new Set());

    ws.on('error', (err) => {
      console.error('[WebSocketClient] Error:', err.message);
    });

    ws.on('message', (message: any) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.action === 'subscribe' && data.topic) {
          const subs = clientSubscriptions.get(ws);
          if (subs) subs.add(data.topic);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'subscribed', topic: data.topic }));
          }
        } else if (data.action === 'unsubscribe' && data.topic) {
          const subs = clientSubscriptions.get(ws);
          if (subs) subs.delete(data.topic);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'unsubscribed', topic: data.topic }));
          }
        } else if (data.action === 'ping') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'pong', timestamp: Date.now() }));
          }
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
    });
  });

  const broadcastWsTopic = (topic: string, data: any) => {
    const payload = JSON.stringify({ topic, data });
    for (const [ws, topics] of clientSubscriptions.entries()) {
      if (ws.readyState === WebSocket.OPEN && topics.has(topic)) {
        try {
          ws.send(payload);
        } catch {}
      }
    }
  };

  // Wire Matching Engine & Price Aggregator to broadcast through WebSockets
  engineManager.setBroadcastHandler(broadcastWsTopic);
  workerSupervisor.priceAggregator.onPriceUpdate((agg) => {
    broadcastWsTopic('mm:feeds', {
      price: agg,
      feedHealth: workerSupervisor.priceAggregator.getFeedHealth(),
    });
    broadcastWsTopic(`price_feed:${agg.symbol}`, agg);
  });
  workerSupervisor.priceAggregator.onAggregatesCleared((evt) => {
    broadcastWsTopic('mm:feeds', {
      clearedSymbols: evt.symbols,
      provider: evt.provider,
      feedHealth: workerSupervisor.priceAggregator.getFeedHealth(),
    });
  });

  // Mount API Router
  const apiRouter = createApiRouter(
    dbManager,
    authService,
    ledgerService,
    engineManager,
    kycService,
    walletService,
    apiKeyService,
    complianceService,
    metricsCollector
  );
  app.use('/api', apiRouter);

  // Seed default Demo Accounts & MM Liquidity Capital if not yet seeded
  const existingAdmin = dbManager.queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', ['admin@silentsmile.io']);
  if (!existingAdmin) {
    try {
      const admin = authService.register('admin@silentsmile.io', 'AdminPass123!', 'admin');
      ledgerService.deposit(admin.id, 'IDR', 50000000000, 'seed_admin_idr', 'Initial Capital');
      ledgerService.deposit(admin.id, 'BTC', 5000000000, 'seed_admin_btc', 'Initial Capital');
      ledgerService.deposit(admin.id, 'ETH', 500000000, 'seed_admin_eth', 'Initial Capital');
      ledgerService.deposit(admin.id, 'SOL', 50000000, 'seed_admin_sol', 'Initial Capital');
      ledgerService.deposit(admin.id, 'DNA', 50000000, 'seed_admin_dna', 'Initial Capital');
      ledgerService.deposit(admin.id, 'USDT', 50000000, 'seed_admin_usdt', 'Initial Capital');
    } catch {
      // Ignored if already registered
    }
  }

  // Ensure dedicated Market Maker account (usr_mm_01) exists in SQLite with liquidity across pairs
  const existingMm = dbManager.queryOne<{ id: string }>('SELECT id FROM users WHERE id = ?', ['usr_mm_01']);
  if (!existingMm) {
    try {
      const now = Date.now();
      dbManager.execute(
        `INSERT OR IGNORE INTO users (id, email, password_hash, role, status, kyc_level, created_at, updated_at)
         VALUES ('usr_mm_01', 'mm@silentsmile.io', 'seeded_mm_hash', 'market_maker', 'active', 2, ?, ?)`,
        [now, now]
      );
      ledgerService.deposit('usr_mm_01', 'IDR', 50000000000, 'seed_mm_idr_01', 'MM Initial Liquidity');
      ledgerService.deposit('usr_mm_01', 'BTC', 2500000000, 'seed_mm_btc_01', 'MM Initial Liquidity');
      ledgerService.deposit('usr_mm_01', 'ETH', 250000000, 'seed_mm_eth_01', 'MM Initial Liquidity');
      ledgerService.deposit('usr_mm_01', 'SOL', 50000000, 'seed_mm_sol_01', 'MM Initial Liquidity');
      ledgerService.deposit('usr_mm_01', 'DNA', 50000000, 'seed_mm_dna_01', 'MM Initial Liquidity');
      ledgerService.deposit('usr_mm_01', 'USDT', 50000000, 'seed_mm_usdt_01', 'MM Initial Liquidity');
      ledgerService.deposit('usr_mm_01', 'MOCK', 50000000, 'seed_mm_mock_01', 'MM Initial Liquidity');
    } catch {}
  }

  const existingTrader = dbManager.queryOne('SELECT id FROM users WHERE email = ?', ['trader@silentsmile.io']);
  if (!existingTrader) {
    try {
      const trader = authService.register('trader@silentsmile.io', 'TraderPass123!', 'trader');
      ledgerService.deposit(trader.id, 'IDR', 250000000, 'seed_trader_idr', 'Welcome Bonus Demo Deposit');
      ledgerService.deposit(trader.id, 'BTC', 25000000, 'seed_trader_btc', 'Welcome Bonus Demo Deposit');
      ledgerService.deposit(trader.id, 'ETH', 10000000, 'seed_trader_eth', 'Welcome Bonus Demo Deposit');
    } catch {
      // Ignored if already registered
    }
  }

  // Vite Integration in Development
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: enableViteHmr ? { server } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SilentSmile Exchange] Fullstack Server running on http://0.0.0.0:${PORT}`);
  });
}

// Auto-run bootstrap when imported or executed
bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
