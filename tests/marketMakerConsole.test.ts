import { describe, it, expect, beforeEach } from 'vitest';
import {
  MMPriceFeedAggregatorService,
  createCryptographicAuditEntry,
  verifyAuditLogIntegrity,
} from '../src/simulation/mmPriceFeedService';
import {
  MMConsoleBot,
  ExternalTicker,
  FxRateConfig,
  CrossMarketMappingConfig,
  CryptographicAuditEvent,
} from '../src/simulation/mmConsoleTypes';
import { AssetNetworkService } from '../src/simulation/assetNetworkService';
import { buildQuantBotLadder } from '../src/simulation/quantLadder';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';

describe('SilentSmile Market Maker Console — Master Test Suite', () => {
  let dbMgr: DatabaseManager;

  beforeEach(async () => {
    // Reset and initialize isolated database instance for testing
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
  });

  describe('1. External Price Feed & Multi-Exchange Aggregator', () => {
    it('aggregates multi-exchange price feeds with weighted median/average correctly', () => {
      const now = Date.now();
      const binanceTicker: any = {
        exchange: 'BINANCE_SPOT',
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        bidPrice: 65000,
        askPrice: 65010,
        midPrice: 65005,
        lastPrice: 65004,
        volume24h: 15000,
        timestamp: now,
        status: 'LIVE',
      };

      const bybitTicker: any = {
        exchange: 'BYBIT_SPOT',
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        bidPrice: 65020,
        askPrice: 65030,
        midPrice: 65025,
        lastPrice: 65022,
        volume24h: 10000,
        timestamp: now,
        status: 'LIVE',
      };

      const aggregated = MMPriceFeedAggregatorService.calculateAggregatedPrice(
        [binanceTicker, bybitTicker],
        { maxStalenessMs: 10000, outlierThresholdPercent: 2.0 }
      );

      expect(aggregated).toBeDefined();
      expect(aggregated.baseAsset).toBe('BTC');
      expect(aggregated.quoteAsset).toBe('USDT');
      expect(aggregated.sourcesCount).toBe(2);
      expect(aggregated.isFresh).toBe(true);
      // Mid price must lie between Binance (65005) and Bybit (65025)
      expect(aggregated.aggregatedMid).toBeGreaterThanOrEqual(65005);
      expect(aggregated.aggregatedMid).toBeLessThanOrEqual(65025);
      expect(aggregated.hasOutliers).toBe(false);
    });

    it('rejects stale external tickers beyond maxStalenessMs threshold', () => {
      const now = Date.now();
      const staleTicker: any = {
        exchange: 'BINANCE_SPOT',
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        bidPrice: 65000,
        askPrice: 65010,
        midPrice: 65005,
        lastPrice: 65004,
        volume24h: 1000,
        timestamp: now - 30000, // 30 seconds ago (stale)
        status: 'LIVE',
      };

      const liveTicker: any = {
        exchange: 'BYBIT_SPOT',
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        bidPrice: 65020,
        askPrice: 65030,
        midPrice: 65025,
        lastPrice: 65022,
        volume24h: 1000,
        timestamp: now - 500, // 500ms ago (fresh)
        status: 'LIVE',
      };

      const aggregated = MMPriceFeedAggregatorService.calculateAggregatedPrice(
        [staleTicker, liveTicker],
        { maxStalenessMs: 5000, outlierThresholdPercent: 2.0 }
      );

      // Only the live ticker should be included in the valid price sources
      expect(aggregated.sourcesCount).toBe(1);
      expect(aggregated.aggregatedMid).toBe(65025);
    });

    it('detects and flags price outliers when exchange prices diverge significantly', () => {
      const now = Date.now();
      const standardTicker: any = {
        exchange: 'BINANCE_SPOT',
        symbol: 'ETHUSDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        bidPrice: 3500,
        askPrice: 3502,
        midPrice: 3501,
        lastPrice: 3501,
        volume24h: 20000,
        timestamp: now,
        status: 'LIVE',
      };

      // Dislocated price (e.g. flash dump or erroneous API feed)
      const aberrantTicker: any = {
        exchange: 'BYBIT_SPOT',
        symbol: 'ETHUSDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        bidPrice: 2800, // ~20% deviation
        askPrice: 2805,
        midPrice: 2802.5,
        lastPrice: 2802,
        volume24h: 100,
        timestamp: now,
        status: 'LIVE',
      };

      const aggregated = MMPriceFeedAggregatorService.calculateAggregatedPrice(
        [standardTicker, aberrantTicker],
        { maxStalenessMs: 10000, outlierThresholdPercent: 5.0 }
      );

      expect(aggregated.hasOutliers).toBe(true);
      expect(aggregated.outlierExchanges).toContain('BYBIT_SPOT');
    });
  });

  describe('2. USDT/IDR FX Conversion Engine', () => {
    it('correctly converts foreign asset price to IDR pair (BTC/IDR = BTC/USDT * USDT/IDR)', () => {
      const btcUsdtPrice = 65000;
      const fxRate: any = {
        pair: 'USDT/IDR',
        rate: 16250,
        source: 'MANUAL',
        lastUpdated: Date.now(),
        validUntil: Date.now() + 600000,
        tolerancePercent: 3.0,
      };

      const convertedPrice = MMPriceFeedAggregatorService.convertPriceWithFx(
        btcUsdtPrice,
        'USDT',
        'IDR',
        fxRate
      );

      // 65,000 * 16,250 = 1,056,250,000 IDR
      expect(convertedPrice.convertedPrice).toBe(1056250000);
      expect(convertedPrice.effectiveFxRate).toBe(16250);
      expect(convertedPrice.isValid).toBe(true);
    });

    it('rejects conversion and flags invalid when FX rate is expired', () => {
      const btcUsdtPrice = 65000;
      const expiredFxRate: any = {
        pair: 'USDT/IDR',
        rate: 16250,
        source: 'MANUAL',
        lastUpdated: Date.now() - 700000,
        validUntil: Date.now() - 100000, // Expired 100 seconds ago
        tolerancePercent: 3.0,
      };

      const convertedPrice = MMPriceFeedAggregatorService.convertPriceWithFx(
        btcUsdtPrice,
        'USDT',
        'IDR',
        expiredFxRate
      );

      expect(convertedPrice.isValid).toBe(false);
      expect(convertedPrice.errorReason).toContain('EXPIRED');
    });

    it('validates manual FX updates to ensure positive and realistic rates', () => {
      expect(() => {
        MMPriceFeedAggregatorService.validateFxRateInput(-1000);
      }).toThrow();

      expect(() => {
        MMPriceFeedAggregatorService.validateFxRateInput(0);
      }).toThrow();

      const validRate = MMPriceFeedAggregatorService.validateFxRateInput(16300);
      expect(validRate).toBe(16300);
    });
  });

  describe('3. Cross-Market Reference Mapping Engine', () => {
    it('implements percentage return mapping: targetPrice = targetAnchor * (1 + beta * (refPrice/refAnchor - 1))', () => {
      const mappingConfig: any = {
        targetPair: 'SOLARA/IDR',
        referenceAsset: 'BTC/USDT',
        targetAnchorPrice: 25000, // SOLARA initial anchor at 25,000 IDR
        referenceAnchorPrice: 60000, // BTC/USDT anchor at $60,000
        sensitivityBeta: 1.5, // 1.5x beta (high-beta altcoin)
        maxPriceDeviationPercent: 15.0,
      };

      // Case A: BTC moves +10% from $60,000 to $66,000
      // Expected return for SOLARA = 1.5 * 10% = +15%
      // Expected targetPrice = 25,000 * 1.15 = 28,750 IDR
      const currentRefPriceA = 66000;
      const resultA = MMPriceFeedAggregatorService.calculateMappedPrice(
        currentRefPriceA,
        mappingConfig
      );

      expect(resultA.targetPrice).toBe(28750);
      expect(resultA.appliedPercentageReturn).toBeCloseTo(0.15, 4);
      expect(resultA.withinSafetyBounds).toBe(true);

      // Case B: BTC drops -5% from $60,000 to $57,000
      // Expected return for SOLARA = 1.5 * (-5%) = -7.5%
      // Expected targetPrice = 25,000 * (1 - 0.075) = 23,125 IDR
      const currentRefPriceB = 57000;
      const resultB = MMPriceFeedAggregatorService.calculateMappedPrice(
        currentRefPriceB,
        mappingConfig
      );

      expect(resultB.targetPrice).toBe(23125);
      expect(resultB.appliedPercentageReturn).toBeCloseTo(-0.075, 4);
      expect(resultB.withinSafetyBounds).toBe(true);
    });

    it('triggers deviation guardrail when price moves outside maximum allowed boundary', () => {
      const mappingConfig: any = {
        targetPair: 'SOLARA/IDR',
        referenceAsset: 'BTC/USDT',
        targetAnchorPrice: 25000,
        referenceAnchorPrice: 60000,
        sensitivityBeta: 2.0,
        maxPriceDeviationPercent: 10.0, // Strict 10% max cap
      };

      // Reference moves +10%, so with beta 2.0, move would be +20%, exceeding 10% cap
      const currentRefPrice = 66000;
      const result = MMPriceFeedAggregatorService.calculateMappedPrice(
        currentRefPrice,
        mappingConfig
      );

      expect(result.withinSafetyBounds).toBe(false);
      expect(result.targetPrice).toBe(27500); // Clamped at 25,000 * 1.10
      expect(result.clamped).toBe(true);
    });
  });

  describe('4. Bot Lifecycle, Configuration & Cloning Invariants', () => {
    const baseBot: any = {
      id: 'mm_bot_alpha_01',
      name: 'Alpha BTC/IDR Liquidity Provider',
      pair: 'BTC/IDR',
      strategy: 'DEPTH_LIQUIDITY',
      status: 'RUNNING',
      assignedAccount: 'usr_mm_01',
      ladderConfig: {
        levels: 5,
        bidSpreadBps: 20,
        askSpreadBps: 20,
        levelSpacingBps: 10,
        baseOrderSize: 0.05,
        sizeMultiplier: 1.2,
        randomizePercentage: 10,
      },
      mappingConfig: {
        targetPair: 'BTC/IDR',
        referenceAsset: 'BTC/USDT',
        targetAnchorPrice: 1000000000,
        referenceAnchorPrice: 65000,
        sensitivityBeta: 1.0,
        maxPriceDeviationPercent: 10.0,
      },
      riskProfile: {
        maxInventoryBase: 5.0,
        maxInventoryQuote: 5000000000,
        stopLossDeviationPercent: 5.0,
        killSwitchEnabled: true,
        maxDrawdownPercent: 3.0,
      },
      activeOrdersCount: 10,
      currentInventoryBase: 1.5,
      currentInventoryQuote: 1500000000,
      createdAt: 100000,
      updatedAt: 105000,
    };

    it('clones bot with deep-copied parameters, new unique ID, and isolated STOPPED initial state', () => {
      const cloned = MMPriceFeedAggregatorService.cloneBot(baseBot, 'usr_mm_02');

      // 1. Invariant: Unique ID
      expect(cloned.id).not.toBe(baseBot.id);
      expect(cloned.id.startsWith('mm_bot_')).toBe(true);

      // 2. Invariant: Isolated initial state
      expect(cloned.status).toBe('STOPPED');
      expect(cloned.activeOrdersCount).toBe(0);
      expect(cloned.currentInventoryBase).toBe(0);
      expect(cloned.currentInventoryQuote).toBe(0);

      // 3. Invariant: Preserved trading parameters & risk limits
      expect(cloned.pair).toBe(baseBot.pair);
      expect(cloned.strategy).toBe(baseBot.strategy);
      expect(cloned.ladderConfig.levels).toBe(baseBot.ladderConfig.levels);
      expect(cloned.ladderConfig.bidSpreadBps).toBe(baseBot.ladderConfig.bidSpreadBps);
      expect(cloned.riskProfile.maxInventoryBase).toBe(baseBot.riskProfile.maxInventoryBase);

      // 4. Invariant: Deep copy (modifying clone does not mutate original)
      cloned.ladderConfig.bidSpreadBps = 50;
      expect(baseBot.ladderConfig.bidSpreadBps).toBe(20);
    });

    it('enforces valid lifecycle state transitions', () => {
      let bot = { ...baseBot, status: 'CONFIGURED' as const, activeOrdersCount: 0 };

      // CONFIGURED -> RUNNING
      bot = MMPriceFeedAggregatorService.transitionBotState(bot, 'RUNNING');
      expect(bot.status).toBe('RUNNING');

      // RUNNING -> PAUSED
      bot = MMPriceFeedAggregatorService.transitionBotState(bot, 'PAUSED');
      expect(bot.status).toBe('PAUSED');

      // PAUSED -> RUNNING (Resume)
      bot = MMPriceFeedAggregatorService.transitionBotState(bot, 'RUNNING');
      expect(bot.status).toBe('RUNNING');

      // RUNNING -> STOPPED (Cancels active orders)
      bot = MMPriceFeedAggregatorService.transitionBotState(bot, 'STOPPED');
      expect(bot.status).toBe('STOPPED');
      expect(bot.activeOrdersCount).toBe(0);
    });
  });

  describe('5. Cryptographic Hash-Chained Audit Trail', () => {
    it('generates deterministic SHA-256 hash chains across audit events', () => {
      const initialPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const event1: any = createCryptographicAuditEntry({
        previousHash: initialPrevHash,
        botId: 'mm_bot_alpha_01',
        action: 'START_BOT',
        actor: 'usr_mm_01',
        timestamp: 1700000001000,
        payload: { pair: 'BTC/IDR', levels: 5 },
      });

      expect(event1.hash).toBeDefined();
      expect(event1.hash.length).toBe(64); // SHA-256 hex string length
      expect(event1.previousHash).toBe(initialPrevHash);

      const event2: any = createCryptographicAuditEntry({
        previousHash: event1.hash,
        botId: 'mm_bot_alpha_01',
        action: 'UPDATE_LADDER',
        actor: 'usr_mm_01',
        timestamp: 1700000002000,
        payload: { bidSpreadBps: 25 },
      });

      expect(event2.previousHash).toBe(event1.hash);
      expect(event2.hash).not.toBe(event1.hash);

      const event3: any = createCryptographicAuditEntry({
        previousHash: event2.hash,
        botId: 'mm_bot_alpha_01',
        action: 'STOP_BOT',
        actor: 'usr_mm_01',
        timestamp: 1700000003000,
        payload: { reason: 'KILL_SWITCH_TRIPPED' },
      });

      // Verify chain integrity
      const verification = verifyAuditLogIntegrity([event1, event2, event3], initialPrevHash);
      expect(verification.isValid).toBe(true);
      expect(verification.tamperedIndex).toBeNull();
    });

    it('detects tampering if any historical audit entry is altered', () => {
      const initialPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const event1: any = createCryptographicAuditEntry({
        previousHash: initialPrevHash,
        botId: 'mm_bot_alpha_01',
        action: 'START_BOT',
        actor: 'usr_mm_01',
        timestamp: 1700000001000,
        payload: { pair: 'BTC/IDR' },
      });

      const event2: any = createCryptographicAuditEntry({
        previousHash: event1.hash,
        botId: 'mm_bot_alpha_01',
        action: 'UPDATE_LADDER',
        actor: 'usr_mm_01',
        timestamp: 1700000002000,
        payload: { bidSpreadBps: 25 },
      });

      // Malicious actor modifies event1 payload in database
      const tamperedEvent1 = {
        ...event1,
        payload: { pair: 'BTC/IDR', secretlyInsertedKey: true },
      };

      const verification = verifyAuditLogIntegrity([tamperedEvent1, event2], initialPrevHash);
      expect(verification.isValid).toBe(false);
      expect(verification.tamperedIndex).toBe(0);
    });
  });

  describe('6. Base Asset Management & Creation with Database Integration', () => {
    it('creates a new base asset with complete tokenomics and stores it in the database', () => {
      const db = DatabaseManager.getInstance();

      // Create new base asset
      const newAsset = {
        symbol: 'SMILE',
        name: 'SilentSmile Ecosystem Token',
        category: 'DEFI' as const,
        primaryChain: 'Ethereum' as const,
        tokenStandard: 'ERC-20' as const,
        contractAddress: '0x71C8000000000000000000000000000000000099',
        totalSupply: 100000000,
        maxSupply: 100000000,
        circulatingSupply: 25000000,
        precision: 4,
        minWithdrawal: 10,
        withdrawalFee: 2,
        depositEnabled: true,
        withdrawEnabled: true,
        description: 'Native governance token of the SilentSmile institutional DEX platform.',
        websiteUrl: 'https://silentsmile.exchange',
        whitepaperUrl: 'https://silentsmile.exchange/whitepaper.pdf',
        explorerUrl: 'https://etherscan.io/token/0x71C8000000000000000000000000000000000099',
        genesisDate: '2026-11-01',
        initialPrice: 5000,
        status: 'ACTIVE' as const,
      };

      // Insert via SQLite database manager
      dbMgr.execute(
        `INSERT INTO assets (
          id, symbol, name, decimals, category, color,
          deposit_enabled, withdrawal_enabled, primary_chain, token_standard,
          contract_address, total_supply, max_supply, circulating_supply,
          description, website_url, whitepaper_url, explorer_url, genesis_date,
          initial_price, status, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )`,
        [
          'asset_smile',
          newAsset.symbol,
          newAsset.name,
          newAsset.precision,
          newAsset.category,
          '#6366F1',
          newAsset.depositEnabled ? 1 : 0,
          newAsset.withdrawEnabled ? 1 : 0,
          newAsset.primaryChain,
          newAsset.tokenStandard,
          newAsset.contractAddress,
          newAsset.totalSupply,
          newAsset.maxSupply,
          newAsset.circulatingSupply,
          newAsset.description,
          newAsset.websiteUrl,
          newAsset.whitepaperUrl,
          newAsset.explorerUrl,
          newAsset.genesisDate,
          newAsset.initialPrice,
          newAsset.status,
          Date.now(),
          Date.now(),
        ]
      );

      // Verify query returns full tokenomics
      const queried = dbMgr.queryOne<any>('SELECT * FROM assets WHERE symbol = ?', ['SMILE']);
      expect(queried).toBeDefined();
      expect(queried?.symbol).toBe('SMILE');
      expect(queried?.name).toBe('SilentSmile Ecosystem Token');
      expect(queried?.total_supply).toBe(100000000);
      expect(queried?.max_supply).toBe(100000000);
      expect(queried?.circulating_supply).toBe(25000000);
      expect(queried?.contract_address).toBe('0x71C8000000000000000000000000000000000099');
      expect(queried?.primary_chain).toBe('Ethereum');
      expect(queried?.token_standard).toBe('ERC-20');
      expect(queried?.initial_price).toBe(5000);
    });

    it('AssetNetworkService seamlessly handles base asset retrieval and default networks', () => {
      const allAssets = AssetNetworkService.getAllAssets();
      expect(allAssets.length).toBeGreaterThan(0);

      const btc = allAssets.find((a) => a.symbol === 'BTC');
      expect(btc).toBeDefined();
      expect(btc?.primaryChain).toContain('Bitcoin');
      expect(btc?.totalSupply).toBe(19780000);
      expect(btc?.maxSupply).toBe(21000000);

      const networks = AssetNetworkService.getNetworksForAsset('BTC');
      expect(networks.length).toBeGreaterThanOrEqual(1);
      expect(networks.some((n) => n.chainType === 'BITCOIN')).toBe(true);
    });
  });

  describe('7. Quant Bot Ladder Builder Config Parity', () => {
    it('places balanced Bid and Ask levels within maxOpenOrders with exact 0% random quantities and configured spreads', () => {
      const botConfig: Pick<MMConsoleBot, 'strategy' | 'mapping' | 'depthConfig' | 'riskProfile' | 'targetSpreadBps'> = {
        strategy: 'DEPTH_LIQUIDITY_LADDER',
        targetSpreadBps: 20,
        mapping: {
          targetMarketSymbol: 'BTC/IDR',
          referenceMarketSymbol: 'BTCUSDT',
          referenceProvider: 'aggregated',
          mappingMode: 'FX_CONVERTED_REFERENCE',
          targetAnchorPrice: 1320000000,
          referenceAnchorPrice: 72450,
          sensitivityBeta: 1.0,
          maxDeviationBps: 1000,
          requiresFxConversion: true,
          fxPair: 'USDT/IDR',
          mappingEnabled: true,
        },
        depthConfig: {
          numberOfBidLevels: 5,
          numberOfAskLevels: 5,
          spacingMode: 'FIXED_SPACING',
          bidLevels: [],
          askLevels: [],
          randomizeQuantity: false,
          randomMinQtyPct: 100,
          randomMaxQtyPct: 100,
          minOrderBid: 0.01,
          minOrderAsk: 0.01,
          minAmountOrderLevel: 0.01,
          maxAmountOrderLevel: 0.2,
          amountOrderLevel: 0.05,
          minSpreadBps: 20,
          maxSpreadBps: 80,
          qtyAmountRandom: 0,
        },
        riskProfile: {
          maxOrderNotional: 1000000000,
          maxOpenOrders: 6, // Must balance 3 Bids + 3 Asks instead of 5 Bids + 1 Ask!
          maxInventoryQuote: 5000000000,
          maxInventoryBase: 100,
          maxTotalBidValue: 1000000000,
          maxTotalAskQty: 10,
          customTickSize: 100,
          minimumLotSize: 0.001,
          antiStackingActive: true,
          maxDailyTurnover: 5000000000,
          maxDailyLoss: 50000000,
          maxDrawdownPct: 10,
          maxPriceDeviationBps: 1000,
          maxSpreadBps: 200,
          maxDataAgeMs: 30000,
          maxCancelReplacePerMin: 120,
          killSwitchActive: false,
        },
      };

      const res = buildQuantBotLadder({
        bot: botConfig,
        refCurrent: 72450,
        fxRateIdr: 18200,
        pairLastPrice: 1318590000,
        amountDecimals: 4,
        priceDecimals: 0,
      });

      // Must balance maxOpenOrders = 6 into 3 Bids and 3 Asks
      expect(res.bidLevels).toHaveLength(3);
      expect(res.askLevels).toHaveLength(3);

      // Exact qtyAmountRandom: 0 must produce exact amountOrderLevel = 0.05 on every level
      for (const b of res.bidLevels) {
        expect(b.quantity).toBe(0.05);
        expect(b.price % 100).toBe(0);
      }
      for (const a of res.askLevels) {
        expect(a.quantity).toBe(0.05);
        expect(a.price % 100).toBe(0);
      }
      expect(res.effectiveSpreadBps).toBeGreaterThanOrEqual(19);
      expect(res.effectiveSpreadBps).toBeLessThanOrEqual(22);
    });

    it('surfaces warning cleanly when maxTotalBidValue caps configured bid levels', () => {
      const botConfig: Pick<MMConsoleBot, 'strategy' | 'mapping' | 'depthConfig' | 'riskProfile' | 'targetSpreadBps'> = {
        strategy: 'DEPTH_LIQUIDITY_LADDER',
        targetSpreadBps: 15,
        mapping: {
          targetMarketSymbol: 'BTC/IDR',
          referenceMarketSymbol: 'BTCUSDT',
          referenceProvider: 'aggregated',
          mappingMode: 'DIRECT_PRICE',
          targetAnchorPrice: 1300000000,
          referenceAnchorPrice: 1300000000,
          sensitivityBeta: 1.0,
          maxDeviationBps: 0,
          requiresFxConversion: false,
          fxPair: 'USDT/IDR',
          mappingEnabled: true,
        },
        depthConfig: {
          numberOfBidLevels: 5,
          numberOfAskLevels: 5,
          spacingMode: 'FIXED_SPACING',
          bidLevels: [],
          askLevels: [],
          randomizeQuantity: false,
          randomMinQtyPct: 100,
          randomMaxQtyPct: 100,
          amountOrderLevel: 0.5,
          qtyAmountRandom: 0,
          minSpreadBps: 15,
          maxSpreadBps: 60,
        },
        riskProfile: {
          maxOrderNotional: 500000000,
          maxOpenOrders: 10,
          maxInventoryQuote: 500000000,
          maxInventoryBase: 100,
          maxTotalBidValue: 500000000, // 0.5 BTC @ 1.3B IDR = 650M > 500M cap!
          maxTotalAskQty: 50,
          customTickSize: 10,
          minimumLotSize: 0.0001,
          antiStackingActive: true,
          maxDailyTurnover: 5000000000,
          maxDailyLoss: 50000000,
          maxDrawdownPct: 10,
          maxPriceDeviationBps: 1000,
          maxSpreadBps: 200,
          maxDataAgeMs: 30000,
          maxCancelReplacePerMin: 120,
          killSwitchActive: false,
        },
      };

      const res = buildQuantBotLadder({
        bot: botConfig,
        refCurrent: 1300000000,
        fxRateIdr: 18200,
        pairLastPrice: 1300000000,
        amountDecimals: 4,
      });

      expect(res.bidLevels).toHaveLength(0);
      expect(res.askLevels).toHaveLength(5);
      expect(res.warning).toContain('Max Total Bid Value');
    });
  });
});
