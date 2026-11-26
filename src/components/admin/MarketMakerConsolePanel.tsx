import React, { useState, useEffect, useMemo } from 'react';
import { useSimulation } from '../../simulation/store';
import {
  ExternalTicker,
  AggregatedReferencePrice,
  FxRateConfig,
  MMConsoleBot,
  CryptographicAuditEvent,
} from '../../simulation/mmConsoleTypes';
import { MMPriceFeedAggregatorService } from '../../simulation/mmPriceFeedService';
import { buildQuantBotLadder } from '../../simulation/quantLadder';
import { formatIDR, formatCrypto, formatDateTime } from '../../utils/formatters';
import { VolumeBotConsoleTab } from './VolumeBotConsoleTab';
import {
  Bot,
  Zap,
  Activity,
  Layers,
  ArrowRight,
  ShieldCheck,
  Check,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Play,
  Pause,
  Copy,
  Trash2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  Filter,
  Sliders,
  Compass,
  FileCheck2,
  Lock,
  Eye,
  Clock,
  CheckCircle2,
  Coins,
} from 'lucide-react';

export const MarketMakerConsolePanel: React.FC<{ onSuccessNotice?: (msg: string) => void }> = ({
  onSuccessNotice,
}) => {
  const {
    currentUser,
    markets,
    clearAllWalls,
    mmConsoleBots: bots,
    workerFeedHealth,
    aggregatedRefPrices: aggregatedPrices,
    fxRateConfig: fxRate,
    createMMConsoleBot,
    updateMMConsoleBot,
    deleteMMConsoleBot,
    toggleMMConsoleBotStatus,
    cloneMMConsoleBot,
    emergencyStopAllMMConsoleBots,
    runMMConsoleBotTick,
  } = useSimulation();

  const [activeTab, setActiveTab] = useState<'overview' | 'bots' | 'volume_bots' | 'wizard' | 'feeds' | 'fx_calc' | 'audit'>('overview');
  const [notice, setNotice] = useState<string | null>(null);

  const triggerNotice = (msg: string) => {
    setNotice(msg);
    if (onSuccessNotice) onSuccessNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  // Bot management now lives in SimulationProvider (`mmConsoleBots`) so bots execute continuously across all routes.

  // 3. Cryptographic Audit Chain State
  const [auditChain, setAuditChain] = useState<CryptographicAuditEvent[]>([
    {
      id: 'audit_genesis_00',
      index: 0,
      actorId: 'usr_admin_01',
      actorRole: 'admin',
      eventType: 'GENESIS_AUDIT_BLOCK',
      previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      currentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      timestamp: Date.now() - 86400000,
      payload: { system: 'SilentSmile Exchange MM Console', version: '2.5.0' },
      signatureVerified: true,
    },
  ]);

  // Append new audit event helper
  const recordAuditEvent = async (eventType: string, payload: Record<string, any>, botId?: string) => {
    const prevEntry = auditChain[auditChain.length - 1];
    const newEntry = await MMPriceFeedAggregatorService.createCryptographicAuditEntry({
      actorId: currentUser.id,
      actorRole: currentUser.role,
      botId,
      eventType,
      payload,
      previousHash: prevEntry ? prevEntry.currentHash : undefined,
      index: auditChain.length,
    });

    setAuditChain((prev) => [newEntry, ...prev]);
  };

  // Bot Lifecycle actions backed by SimulationProvider + live CLOB engine
  const handleBotStatus = (botId: string, action: 'START' | 'PAUSE' | 'RESUME' | 'STOP') => {
    const nextStatus =
      action === 'START' || action === 'RESUME'
        ? 'RUNNING'
        : action === 'PAUSE'
        ? 'PAUSED'
        : 'STOPPED';

    toggleMMConsoleBotStatus(botId, action);
    recordAuditEvent(`BOT_${action}`, { botId, action, nextStatus }, botId);
    triggerNotice(`Bot ${botId} status diubah ke ${nextStatus}`);
  };

  const handleRunBotTickNow = (botId: string) => {
    const res = runMMConsoleBotTick(botId);
    recordAuditEvent('BOT_MANUAL_TICK', { botId, ...res }, botId);
    triggerNotice(res.message);
  };

  const handleDeleteBot = (botId: string, botName: string) => {
    deleteMMConsoleBot(botId);
    recordAuditEvent('BOT_DELETED', { botId, botName }, botId);
    triggerNotice(`Bot ${botName} dihapus & order aktifnya dibatalkan.`);
  };

  const handleCloneBot = (botId: string) => {
    const newBot = cloneMMConsoleBot(botId);
    if (!newBot) return;
    recordAuditEvent('BOT_CLONED', { sourceBotId: botId, newBotId: newBot.id, clonedName: newBot.name }, newBot.id);
    triggerNotice(`Bot berhasil di-clone sebagai ${newBot.name} (Status awal: STOPPED).`);
  };

  const handleEmergencyStopAll = () => {
    emergencyStopAllMMConsoleBots();
    clearAllWalls();
    recordAuditEvent('GLOBAL_EMERGENCY_STOP', { actor: currentUser.name, reason: 'Operator Emergency Kill Switch' });
    triggerNotice('GLOBAL EMERGENCY STOP: Seluruh bot dinonaktifkan dan order bot dibersihkan.');
  };

  // Bot Wizard State
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [wizPair, setWizPair] = useState<string>('BTC/IDR');
  const [wizName, setWizName] = useState<string>('BTC/IDR Dynamic Liquidity Bot');
  const [wizStrategy, setWizStrategy] = useState<'PRICE_FOLLOWER' | 'DEPTH_LIQUIDITY_LADDER'>('DEPTH_LIQUIDITY_LADDER');
  const [wizRefSymbol, setWizRefSymbol] = useState<string>('BTCUSDT');
  const [wizMappingMode, setWizMappingMode] = useState<any>('PERCENTAGE_RETURN');
  const [wizTargetAnchor, setWizTargetAnchor] = useState<number>(1500000000);
  const [wizRefAnchor, setWizRefAnchor] = useState<number>(72450);
  const [wizBeta, setWizBeta] = useState<number>(1.0);
  const [wizMaxDeviationBps, setWizMaxDeviationBps] = useState<number>(800);
  const [wizSpreadBps, setWizSpreadBps] = useState<number>(20);

  // Wizard Ladder & Level Tuning State
  const [wizBidLevels, setWizBidLevels] = useState<number>(5);
  const [wizAskLevels, setWizAskLevels] = useState<number>(5);
  const [wizMinOrderBid, setWizMinOrderBid] = useState<number>(0.001);
  const [wizMinOrderAsk, setWizMinOrderAsk] = useState<number>(0.001);
  const [wizMinAmountOrderLevel, setWizMinAmountOrderLevel] = useState<number>(0.005);
  const [wizMaxAmountOrderLevel, setWizMaxAmountOrderLevel] = useState<number>(0.5);
  const [wizAmountOrderLevel, setWizAmountOrderLevel] = useState<number>(0.05);
  const [wizMinSpreadBps, setWizMinSpreadBps] = useState<number>(15);
  const [wizMaxSpreadBps, setWizMaxSpreadBps] = useState<number>(60);
  const [wizQtyAmountRandom, setWizQtyAmountRandom] = useState<number>(15);
  const [wizDelayMinMs, setWizDelayMinMs] = useState<number>(1500);
  const [wizDelayMaxMs, setWizDelayMaxMs] = useState<number>(4500);

  // Wizard Inventory Controls & Risk Management
  const [wizMaxInventoryBase, setWizMaxInventoryBase] = useState<number>(1000.0);
  const [wizMaxTotalBidValue, setWizMaxTotalBidValue] = useState<number>(500000000);
  const [wizMaxTotalAskQty, setWizMaxTotalAskQty] = useState<number>(500.0);
  const [wizMaxOpenOrders, setWizMaxOpenOrders] = useState<number>(20);
  const [wizCustomTickSize, setWizCustomTickSize] = useState<number>(10);
  const [wizMinimumLotSize, setWizMinimumLotSize] = useState<number>(0.0001);
  const [wizAntiStackingActive, setWizAntiStackingActive] = useState<boolean>(true);

  // Dynamic Base & Quote Asset helper
  const wizBaseAsset = wizPair.split('/')[0] || 'BTC';
  const wizQuoteAsset = wizPair.split('/')[1] || 'IDR';
  const wizPairObj = useMemo(() => markets.find((m) => m.id === wizPair) || markets[0], [markets, wizPair]);

  const handleOpenNewWizard = () => {
    setEditingBotId(null);
    setActiveTab('wizard');
  };

  const handleEditBot = (bot: MMConsoleBot) => {
    setEditingBotId(bot.id);
    setWizPair(bot.targetMarketSymbol);
    setWizName(bot.name);
    setWizStrategy(bot.strategy === 'PRICE_FOLLOWER' ? 'PRICE_FOLLOWER' : 'DEPTH_LIQUIDITY_LADDER');
    setWizRefSymbol(bot.mapping?.referenceMarketSymbol || 'BTCUSDT');
    setWizMappingMode(bot.mapping?.mappingMode || 'PERCENTAGE_RETURN');
    setWizTargetAnchor(bot.mapping?.targetAnchorPrice ?? 1500000000);
    setWizRefAnchor(bot.mapping?.referenceAnchorPrice ?? 72450);
    setWizBeta(bot.mapping?.sensitivityBeta ?? 1.0);
    setWizMaxDeviationBps(bot.mapping?.maxDeviationBps ?? 800);
    setWizBidLevels(bot.depthConfig?.numberOfBidLevels ?? 5);
    setWizAskLevels(bot.depthConfig?.numberOfAskLevels ?? 5);
    setWizMinOrderBid(bot.depthConfig?.minOrderBid ?? 0.001);
    setWizMinOrderAsk(bot.depthConfig?.minOrderAsk ?? 0.001);
    setWizMinAmountOrderLevel(bot.depthConfig?.minAmountOrderLevel ?? 0.005);
    setWizMaxAmountOrderLevel(bot.depthConfig?.maxAmountOrderLevel ?? 0.5);
    setWizAmountOrderLevel(bot.depthConfig?.amountOrderLevel ?? 0.05);
    setWizMinSpreadBps(bot.depthConfig?.minSpreadBps ?? bot.targetSpreadBps ?? 15);
    setWizMaxSpreadBps(bot.depthConfig?.maxSpreadBps ?? 60);
    setWizQtyAmountRandom(bot.depthConfig?.qtyAmountRandom ?? 15);
    setWizDelayMinMs(bot.depthConfig?.delayMinMs ?? bot.minRepriceIntervalMs ?? 1500);
    setWizDelayMaxMs(bot.depthConfig?.delayMaxMs ?? 4500);
    setWizMaxInventoryBase(bot.riskProfile?.maxInventoryBase ?? 1000);
    setWizMaxTotalBidValue(bot.riskProfile?.maxTotalBidValue ?? 500000000);
    setWizMaxTotalAskQty(bot.riskProfile?.maxTotalAskQty ?? 500);
    setWizMaxOpenOrders(bot.riskProfile?.maxOpenOrders ?? 20);
    setWizCustomTickSize(bot.riskProfile?.customTickSize ?? 10);
    setWizMinimumLotSize(bot.riskProfile?.minimumLotSize ?? 0.0001);
    setWizAntiStackingActive(bot.riskProfile?.antiStackingActive ?? true);
    setActiveTab('wizard');
  };

  // Live Real-Time Order Ladder Preview (Pratinjau Tangga Order) using shared quantLadder engine
  const previewLadder = useMemo(() => {
    const agg = aggregatedPrices[wizRefSymbol] || MMPriceFeedAggregatorService.getAggregatedPrice(wizRefSymbol);
    const refCurrent = agg && agg.finalPrice > 0 ? agg.finalPrice : (wizRefAnchor || 72450);
    const safeMinSpr = Math.max(1, Number(wizMinSpreadBps) || 15);
    const safeMaxSpr = Math.max(safeMinSpr, Number(wizMaxSpreadBps) || safeMinSpr);
    const safeMinLot = Math.max(0.000001, Number(wizMinimumLotSize) || 0.0001);
    const safeBaseQty = Math.max(safeMinLot, Number(wizAmountOrderLevel) || 0.05);
    const safeMinLvl = Math.max(safeMinLot, Number(wizMinAmountOrderLevel) || safeMinLot);
    const safeMaxLvl = Math.max(safeMinLvl, Number(wizMaxAmountOrderLevel) || safeBaseQty);

    const res = buildQuantBotLadder({
      bot: {
        strategy: wizStrategy,
        targetSpreadBps: safeMinSpr,
        mapping: {
          targetMarketSymbol: wizPair,
          referenceMarketSymbol: wizRefSymbol,
          referenceProvider: 'aggregated',
          mappingMode: wizMappingMode,
          targetAnchorPrice: Number(wizTargetAnchor),
          referenceAnchorPrice: Number(wizRefAnchor),
          sensitivityBeta: Number(wizBeta),
          maxDeviationBps: Number(wizMaxDeviationBps),
          requiresFxConversion: wizMappingMode === 'FX_CONVERTED_REFERENCE',
          fxPair: 'USDT/IDR',
          mappingEnabled: true,
        },
        depthConfig: {
          numberOfBidLevels: Math.max(1, Math.min(20, Number(wizBidLevels) || 5)),
          numberOfAskLevels: Math.max(1, Math.min(20, Number(wizAskLevels) || 5)),
          spacingMode: 'FIXED_SPACING',
          bidLevels: [],
          askLevels: [],
          randomizeQuantity: (wizQtyAmountRandom ?? 0) > 0,
          randomMinQtyPct: Math.max(0, 100 - (wizQtyAmountRandom ?? 15)),
          randomMaxQtyPct: 100 + (wizQtyAmountRandom ?? 15),
          minOrderBid: Number(wizMinOrderBid) || safeMinLot,
          minOrderAsk: Number(wizMinOrderAsk) || safeMinLot,
          minAmountOrderLevel: safeMinLvl,
          maxAmountOrderLevel: safeMaxLvl,
          amountOrderLevel: safeBaseQty,
          minSpreadBps: safeMinSpr,
          maxSpreadBps: safeMaxSpr,
          qtyAmountRandom: Math.max(0, Number(wizQtyAmountRandom ?? 15)),
          delayMinMs: Math.max(0, Number(wizDelayMinMs ?? 1500)),
          delayMaxMs: Math.max(0, Number(wizDelayMaxMs ?? 4500)),
        },
        riskProfile: {
          maxOrderNotional: Number(wizMaxTotalBidValue) / 5,
          maxOpenOrders: Math.max(1, Number(wizMaxOpenOrders) || 20),
          maxInventoryQuote: Number(wizMaxTotalBidValue) * 2,
          maxInventoryBase: Number(wizMaxInventoryBase) || 1000,
          maxTotalBidValue: Number(wizMaxTotalBidValue) || 500000000,
          maxTotalAskQty: Number(wizMaxTotalAskQty) || 500,
          customTickSize: Number(wizCustomTickSize) || 1,
          minimumLotSize: safeMinLot,
          antiStackingActive: Boolean(wizAntiStackingActive),
          maxDailyTurnover: 5000000000,
          maxDailyLoss: 50000000,
          maxDrawdownPct: 10,
          maxPriceDeviationBps: 500,
          maxSpreadBps: safeMaxSpr * 2,
          maxDataAgeMs: 30000,
          maxCancelReplacePerMin: 120,
          killSwitchActive: false,
        },
      },
      refCurrent,
      fxRateIdr: fxRate.usdtIdrRate || 18200,
      pairLastPrice: wizPairObj?.lastPrice || Number(wizTargetAnchor) || 1500000000,
      amountDecimals: wizPairObj?.amountDecimals ?? 4,
      priceDecimals: wizPairObj?.priceDecimals ?? 0,
      deterministic: true,
    });

    return {
      ...res,
      totalBidVal: res.totalBidValue,
    };
  }, [
    wizStrategy,
    wizPair,
    wizPairObj,
    wizRefSymbol,
    aggregatedPrices,
    wizRefAnchor,
    wizTargetAnchor,
    wizBeta,
    wizMaxDeviationBps,
    wizMappingMode,
    fxRate,
    wizCustomTickSize,
    wizMinSpreadBps,
    wizMaxSpreadBps,
    wizBidLevels,
    wizAskLevels,
    wizAmountOrderLevel,
    wizMinAmountOrderLevel,
    wizMaxAmountOrderLevel,
    wizMinimumLotSize,
    wizQtyAmountRandom,
    wizDelayMinMs,
    wizDelayMaxMs,
    wizMinOrderBid,
    wizMinOrderAsk,
    wizMaxOpenOrders,
    wizMaxInventoryBase,
    wizMaxTotalBidValue,
    wizMaxTotalAskQty,
    wizAntiStackingActive,
  ]);

  const handleCreateBot = (e: React.FormEvent) => {
    e.preventDefault();
    const safeMinDelay = Math.max(0, Number(wizDelayMinMs ?? 0));
    const safeMaxDelay = Math.max(safeMinDelay, Number(wizDelayMaxMs ?? safeMinDelay));
    const safeMinSpr = Math.max(1, Number(wizMinSpreadBps) || 1);
    const safeMaxSpr = Math.max(safeMinSpr, Number(wizMaxSpreadBps) || safeMinSpr);
    const safeMinLot = Math.max(0.000001, Number(wizMinimumLotSize) || 0.0001);
    const safeMinAmt = Math.max(safeMinLot, Number(wizMinAmountOrderLevel) || safeMinLot);
    const safeMaxAmt = Math.max(safeMinAmt, Number(wizMaxAmountOrderLevel) || safeMinAmt);
    const safeBidLvls = wizStrategy === 'PRICE_FOLLOWER' ? 1 : Math.max(1, Math.min(20, Number(wizBidLevels) || 5));
    const safeAskLvls = wizStrategy === 'PRICE_FOLLOWER' ? 1 : Math.max(1, Math.min(20, Number(wizAskLevels) || 5));
    const safeRandPct = Math.max(0, Number(wizQtyAmountRandom ?? 0));

    const sharedMapping = {
      targetMarketSymbol: wizPair,
      referenceMarketSymbol: wizRefSymbol,
      referenceProvider: 'aggregated' as const,
      mappingMode: wizMappingMode,
      targetAnchorPrice: Number(wizTargetAnchor),
      referenceAnchorPrice: Number(wizRefAnchor),
      sensitivityBeta: Number(wizBeta),
      maxDeviationBps: Number(wizMaxDeviationBps),
      requiresFxConversion: wizMappingMode === 'FX_CONVERTED_REFERENCE',
      fxPair: 'USDT/IDR' as const,
      mappingEnabled: true,
    };

    const sharedDepthConfig = {
      numberOfBidLevels: safeBidLvls,
      numberOfAskLevels: safeAskLvls,
      spacingMode: 'FIXED_SPACING' as const,
      minOrderBid: Number(wizMinOrderBid) || safeMinLot,
      minOrderAsk: Number(wizMinOrderAsk) || safeMinLot,
      minAmountOrderLevel: safeMinAmt,
      maxAmountOrderLevel: safeMaxAmt,
      amountOrderLevel: Number(wizAmountOrderLevel) || safeMinAmt,
      minSpreadBps: safeMinSpr,
      maxSpreadBps: safeMaxSpr,
      qtyAmountRandom: safeRandPct,
      delayMinMs: safeMinDelay,
      delayMaxMs: safeMaxDelay,
      bidLevels: previewLadder.bidLevels.map((b) => ({
        level: b.level,
        offsetBps: b.offsetBps,
        quantity: b.quantity,
        price: b.price,
      })),
      askLevels: previewLadder.askLevels.map((a) => ({
        level: a.level,
        offsetBps: a.offsetBps,
        quantity: a.quantity,
        price: a.price,
      })),
      randomizeQuantity: safeRandPct > 0,
      randomMinQtyPct: Math.max(0, 100 - safeRandPct),
      randomMaxQtyPct: 100 + safeRandPct,
    };

    const sharedRiskProfile = {
      maxOrderNotional: Number(wizMaxTotalBidValue) / Math.max(1, safeBidLvls),
      maxOpenOrders: Math.max(1, Number(wizMaxOpenOrders) || 20),
      maxInventoryQuote: Number(wizMaxTotalBidValue) * 2,
      maxInventoryBase: Number(wizMaxInventoryBase) || 1000,
      maxTotalBidValue: Number(wizMaxTotalBidValue),
      maxTotalAskQty: Number(wizMaxTotalAskQty),
      customTickSize: Number(wizCustomTickSize) || 1,
      minimumLotSize: safeMinLot,
      antiStackingActive: Boolean(wizAntiStackingActive),
      maxDailyTurnover: 5000000000,
      maxDailyLoss: 50000000,
      maxDrawdownPct: 10.0,
      maxPriceDeviationBps: 500,
      maxSpreadBps: safeMaxSpr * 2,
      maxDataAgeMs: 30000,
      maxCancelReplacePerMin: 120,
      killSwitchActive: false,
    };

    if (editingBotId) {
      updateMMConsoleBot(editingBotId, {
        name: wizName.trim() || `${wizPair} MM Bot`,
        strategy: wizStrategy,
        targetMarketSymbol: wizPair,
        mapping: sharedMapping,
        depthConfig: sharedDepthConfig,
        riskProfile: sharedRiskProfile,
        minRepriceIntervalMs: Math.max(500, safeMinDelay),
        targetSpreadBps: safeMinSpr,
      });
      setTimeout(() => runMMConsoleBotTick(editingBotId), 50);
      recordAuditEvent('BOT_UPDATED_VIA_WIZARD', { botId: editingBotId, name: wizName, pair: wizPair }, editingBotId);
      triggerNotice(`Konfigurasi Bot ${wizName} diperbarui & langsung diterapkan pada ${wizPair}.`);
      setEditingBotId(null);
      setActiveTab('bots');
      return;
    }

    const newBotId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newBot: MMConsoleBot = {
      id: newBotId,
      name: wizName.trim() || `${wizPair} MM Bot`,
      strategy: wizStrategy,
      accountId: currentUser.role === 'market_maker' ? currentUser.id : 'usr_mm_01',
      targetMarketSymbol: wizPair,
      mapping: sharedMapping,
      depthConfig: sharedDepthConfig,
      riskProfile: sharedRiskProfile,
      status: 'RUNNING',
      dryRun: false,
      minRepriceIntervalMs: Math.max(500, safeMinDelay),
      minPriceChangeBps: 10,
      targetSpreadBps: safeMinSpr,
      activeOpenOrdersCount: 0,
      totalBidExposure: 0,
      totalAskExposure: 0,
      currentBaseInventory: 0,
      currentQuoteInventory: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      dailyTurnover: 0,
      version: 1,
      createdBy: currentUser.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    createMMConsoleBot(newBot);
    setTimeout(() => runMMConsoleBotTick(newBot.id), 50);
    recordAuditEvent('BOT_CREATED_VIA_WIZARD', { botId: newBotId, name: newBot.name, pair: wizPair }, newBotId);
    triggerNotice(`Bot ${newBot.name} disimpan & langsung aktif mengutip order pada ${wizPair}!`);
    setActiveTab('bots');
  };

  // FX Interactive Calculator State
  const [calcBaseCrypto, setCalcBaseCrypto] = useState<'BTC' | 'ETH' | 'SOL'>('BTC');
  const [calcUsdtPrice, setCalcUsdtPrice] = useState<number>(72450.5);
  const [calcFxRate, setCalcFxRate] = useState<number>(18200);
  const calculatedIdr = useMemo(() => calcUsdtPrice * calcFxRate, [calcUsdtPrice, calcFxRate]);

  return (
    <div className="space-y-5">
      {/* 1. Header with Global Metrics and Emergency Kill Switch */}
      <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#064E3B]/40 border border-[#10B981]/40 flex items-center justify-center text-[#10B981]">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#F1F5F2] flex items-center gap-2">
              SilentSmile Market Maker Console
              <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-mono">
                EXTERNAL AGGREGATOR LIVE
              </span>
            </h2>
            <p className="text-xs text-[#A1ADA5] mt-0.5">
              Multi-Exchange Binance & Bybit Aggregator, Cross-Market Reference Mapping, FX Engine, and Real CLOB Liquidity Bots.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleEmergencyStopAll}
            className="px-3.5 py-1.5 rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/40 text-xs font-bold transition-colors flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-[#EF6464]" />
            <span>Emergency Kill Switch</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-2.5 rounded-xl bg-[#064E3B]/40 text-[#34D399] border border-[#10B981]/40 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-[#10B981] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* 2. Sub-Tab Navigation Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[#101A15] border border-[#26372D] text-xs font-semibold">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'overview' ? 'bg-[#10B981] text-[#0B100E]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Overview & Aggregator Status</span>
        </button>

        <button
          onClick={() => setActiveTab('bots')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'bots' ? 'bg-[#10B981] text-[#0B100E]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>MM Quoting Bots ({bots.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('volume_bots')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'volume_bots' ? 'bg-[#10B981] text-[#0B100E]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Volume Bots (V2)</span>
        </button>

        <button
          onClick={() => setActiveTab('wizard')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'wizard' ? 'bg-[#10B981] text-[#0B100E]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Bot Configuration Wizard</span>
        </button>

        <button
          onClick={() => setActiveTab('feeds')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'feeds' ? 'bg-[#10B981] text-[#0B100E]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>External Price Monitor</span>
        </button>

        <button
          onClick={() => setActiveTab('fx_calc')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'fx_calc' ? 'bg-[#10B981] text-[#0B100E]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>FX Interactive Calculator</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'audit' ? 'bg-[#10B981] text-[#0B100E]' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          <span>Cryptographic Audit Log</span>
        </button>
      </div>

      {activeTab === 'volume_bots' && (
        <VolumeBotConsoleTab onSuccessNotice={triggerNotice} />
      )}

      {/* VIEW 1: OVERVIEW & AGGREGATOR STATUS */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Key KPI Ribbon */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-[#142019] border border-[#26372D] space-y-1">
              <span className="text-[11px] text-[#A1ADA5]">Active Quoting Bots</span>
              <p className="text-xl font-bold text-[#F1F5F2] font-mono tabular-nums">
                {bots.filter((b) => b.status === 'RUNNING').length} / {bots.length}
              </p>
              <span className="text-[10px] text-[#34D399]">Real CLOB Order Book</span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#142019] border border-[#26372D] space-y-1">
              <span className="text-[11px] text-[#A1ADA5]">Total Bid Exposure</span>
              <p className="text-xl font-bold text-[#10B981] font-mono tabular-nums">
                {formatIDR(bots.reduce((acc, b) => acc + (b.status === 'RUNNING' ? b.totalBidExposure : 0), 0))}
              </p>
              <span className="text-[10px] text-[#A1ADA5]">Active Book Support</span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#142019] border border-[#26372D] space-y-1">
              <span className="text-[11px] text-[#A1ADA5]">Total Ask Exposure</span>
              <p className="text-xl font-bold text-[#EF6464] font-mono tabular-nums">
                {formatIDR(bots.reduce((acc, b) => acc + (b.status === 'RUNNING' ? b.totalAskExposure : 0), 0))}
              </p>
              <span className="text-[10px] text-[#A1ADA5]">Active Book Resistance</span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#142019] border border-[#26372D] space-y-1">
              <span className="text-[11px] text-[#A1ADA5]">USDT/IDR FX Conversion</span>
              <p className="text-xl font-bold text-[#60A5FA] font-mono tabular-nums">
                Rp {fxRate.usdtIdrRate.toLocaleString('id-ID')}
              </p>
              <span className="text-[10px] text-[#A1ADA5]">Source: {fxRate.source}</span>
            </div>
          </div>

          {/* Aggregated Feeds Table */}
          <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-3">
            <h3 className="font-bold text-[#F1F5F2] text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#EAB866]" />
              Live Multi-Exchange Reference Feeds (Binance Spot & Bybit Spot)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-[#26372D] text-[#A1ADA5] font-mono">
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-3">Aggregated Final</th>
                    <th className="py-2 px-3">Primary (Binance)</th>
                    <th className="py-2 px-3">Secondary (Bybit)</th>
                    <th className="py-2 px-3">Spread Bps</th>
                    <th className="py-2 px-3">Confidence</th>
                    <th className="py-2 px-3">Feed Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26372D]/60 font-mono">
                  {Object.values(aggregatedPrices).map((p) => {
                    const decimals = p.finalPrice < 10 ? 4 : 2;
                    const prefix = p.symbol === 'USDTIDR' ? 'Rp ' : '$';
                    return (
                      <tr key={p.symbol} className="hover:bg-[#192820]/60 transition-colors">
                        <td className="py-2.5 px-3 font-bold text-[#F1F5F2]">{p.symbol}</td>
                        <td className="py-2.5 px-3 text-[#34D399] font-bold">
                          {prefix}{p.finalPrice.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
                        </td>
                        <td className="py-2.5 px-3 text-[#A1ADA5]">
                          <span>
                            {prefix}{p.primaryPrice.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
                          </span>
                          {p.primaryProvider === 'coingecko' && (
                            <span className="ml-1.5 text-[10px] text-[#60A5FA]">(CoinGecko)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[#A1ADA5]">
                          {p.secondaryPrice
                            ? `${prefix}${p.secondaryPrice.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
                            : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-[#A1ADA5]">{p.spreadBps} bps</td>
                        <td className="py-2.5 px-3">
                          <span className="text-[#10B981] font-bold">{p.confidenceScore}%</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] ${
                              p.status === 'FRESH'
                                ? 'bg-[#064E3B]/40 text-[#34D399] border-[#10B981]/30'
                                : 'bg-[#EAB866]/15 text-[#EAB866] border-[#EAB866]/30'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: BOT MANAGEMENT & CLONING */}
      {activeTab === 'bots' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-[#F1F5F2] text-sm flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#10B981]" />
              Automated Market Maker Fleet ({bots.length} Configured)
            </h3>
            <button
              onClick={handleOpenNewWizard}
              className="px-3 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold text-xs flex items-center gap-1.5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>+ Buat Bot Baru</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bots.map((bot) => {
              const isRunning = bot.status === 'RUNNING';
              const isPaused = bot.status === 'PAUSED';

              return (
                <div
                  key={bot.id}
                  className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-3.5 hover:border-[#10B981]/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-[#F1F5F2] text-sm flex items-center gap-2">
                        {bot.name}
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5] font-mono">
                          {bot.strategy}
                        </span>
                      </h4>
                      <span className="text-xs text-[#A1ADA5] font-mono">Target Market: {bot.targetMarketSymbol}</span>
                    </div>

                    <span
                      className={`text-[10px] px-2.5 py-1 rounded font-bold font-mono border ${
                        isRunning
                          ? 'bg-[#064E3B]/50 text-[#34D399] border-[#10B981]/40'
                          : isPaused
                          ? 'bg-[#EAB866]/15 text-[#EAB866] border-[#EAB866]/40'
                          : 'bg-[#101A15] text-[#647168] border-[#26372D]'
                      }`}
                    >
                      {bot.status}
                    </span>
                  </div>

                  {/* Mapping Details */}
                  <div className="p-3 rounded-lg bg-[#101A15] border border-[#26372D] space-y-1 text-xs">
                    <div className="flex justify-between text-[#A1ADA5]">
                      <span>Reference Symbol:</span>
                      <span className="text-[#34D399] font-mono font-bold">{bot.mapping.referenceMarketSymbol}</span>
                    </div>
                    <div className="flex justify-between text-[#A1ADA5]">
                      <span>Mapping Mode:</span>
                      <span className="text-[#F1F5F2] font-mono">{bot.mapping.mappingMode}</span>
                    </div>
                    <div className="flex justify-between text-[#A1ADA5]">
                      <span>Sensitivity (Beta):</span>
                      <span className="text-[#60A5FA] font-mono font-bold tabular-nums">{bot.mapping.sensitivityBeta}x</span>
                    </div>
                    <div className="flex justify-between text-[#A1ADA5]">
                      <span>Target Spread:</span>
                      <span className="text-[#EAB866] font-mono tabular-nums">{bot.targetSpreadBps} bps</span>
                    </div>
                  </div>

                  {/* Operational Metrics, Exposure & PnL */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D]">
                      <span className="text-[10px] text-[#A1ADA5] block">Open Orders</span>
                      <span className="font-mono text-[#F1F5F2] font-bold tabular-nums">
                        {bot.activeOpenOrdersCount || 0} / {bot.riskProfile?.maxOpenOrders || 20}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D]">
                      <span className="text-[10px] text-[#A1ADA5] block">Bid Exposure</span>
                      <span className="font-mono text-[#10B981] font-bold tabular-nums">
                        {formatIDR(bot.totalBidExposure || 0)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D]">
                      <span className="text-[10px] text-[#A1ADA5] block">Ask Exposure</span>
                      <span className="font-mono text-[#EF6464] font-bold tabular-nums">
                        {formatIDR(bot.totalAskExposure || 0)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D]">
                      <span className="text-[10px] text-[#A1ADA5] block">Last Reprice</span>
                      <span className="font-mono text-[#60A5FA] font-bold tabular-nums">
                        {bot.lastRepricedAt ? new Date(bot.lastRepricedAt).toLocaleTimeString('id-ID') : '-'}
                      </span>
                    </div>
                  </div>

                  {bot.errorMessage && (
                    <div className="p-2 rounded-lg bg-[#EF6464]/10 border border-[#EF6464]/40 text-[11px] text-[#EF6464] flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#EF6464] shrink-0" />
                      <span>{bot.errorMessage}</span>
                    </div>
                  )}

                  {/* Operational Controls */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#26372D]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isRunning ? (
                        <button
                          onClick={() => handleBotStatus(bot.id, 'PAUSE')}
                          className="px-2.5 py-1.5 rounded-lg bg-[#EAB866]/15 hover:bg-[#EAB866]/25 text-[#EAB866] border border-[#EAB866]/40 text-xs font-semibold flex items-center gap-1 transition-colors"
                        >
                          <Pause className="w-3 h-3" />
                          <span>Pause</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleBotStatus(bot.id, 'START')}
                          className="px-2.5 py-1.5 rounded-lg bg-[#064E3B]/50 hover:bg-[#064E3B]/70 text-[#34D399] border border-[#10B981]/40 text-xs font-semibold flex items-center gap-1 transition-colors"
                        >
                          <Play className="w-3 h-3" />
                          <span>Start</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleBotStatus(bot.id, 'STOP')}
                        className="px-2.5 py-1.5 rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/40 text-xs font-semibold transition-colors"
                      >
                        Stop
                      </button>

                      <button
                        onClick={() => handleRunBotTickNow(bot.id)}
                        title="Eksekusi 1 siklus reprice order secara manual sekarang"
                        className="px-2.5 py-1.5 rounded-lg bg-[#60A5FA]/15 hover:bg-[#60A5FA]/25 text-[#60A5FA] border border-[#60A5FA]/40 text-xs font-semibold flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Run Tick</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleEditBot(bot)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#101A15] hover:bg-[#192820] text-[#34D399] text-xs font-semibold flex items-center gap-1.5 transition-colors border border-[#26372D]"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleCloneBot(bot.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#101A15] hover:bg-[#192820] text-[#F1F5F2] text-xs font-semibold flex items-center gap-1.5 transition-colors border border-[#26372D]"
                      >
                        <Copy className="w-3 h-3 text-[#A1ADA5]" />
                        <span>Clone</span>
                      </button>
                      <button
                        onClick={() => handleDeleteBot(bot.id, bot.name)}
                        title="Hapus Bot"
                        className="p-1.5 rounded-lg bg-[#101A15] hover:bg-[#EF6464]/20 text-[#A1ADA5] hover:text-[#EF6464] border border-[#26372D] hover:border-[#EF6464]/40 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: BOT CONFIGURATION WIZARD */}
      {activeTab === 'wizard' && (
        <div className="p-5 rounded-xl bg-[#142019] border border-[#26372D] space-y-4">
          <div className="pb-3 border-b border-[#26372D]">
            <h3 className="font-bold text-[#F1F5F2] text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#10B981]" />
              Bot Configuration Wizard
            </h3>
            <p className="text-xs text-[#A1ADA5] mt-0.5">
              Hubungkan pasangan token di SilentSmile Exchange dengan harga acuan eksternal menggunakan formula Cross-Market Mapping & sensitivitas Beta.
            </p>
          </div>

          <form onSubmit={handleCreateBot} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Nama Bot Identitas</label>
                <input
                  type="text"
                  value={wizName}
                  onChange={(e) => setWizName(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Target Exchange Market Pair</label>
                <select
                  value={wizPair}
                  onChange={(e) => {
                    setWizPair(e.target.value);
                    const p = markets.find((m) => m.id === e.target.value);
                    if (p) setWizTargetAnchor(p.lastPrice);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
                >
                  {markets.map((m) => (
                    <option key={m.id} value={m.id} className="bg-[#101A15] text-[#F1F5F2]">
                      {m.id} (Last: {formatIDR(m.lastPrice)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Strategi Bot</label>
                <select
                  value={wizStrategy}
                  onChange={(e) => setWizStrategy(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2]"
                >
                  <option value="PRICE_FOLLOWER" className="bg-[#101A15] text-[#F1F5F2]">Price Follower (Benchmark Ref)</option>
                  <option value="DEPTH_LIQUIDITY_LADDER" className="bg-[#101A15] text-[#F1F5F2]">Depth & Liquidity Ladder</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Reference Asset / Feed</label>
                <select
                  value={wizRefSymbol}
                  onChange={(e) => {
                    setWizRefSymbol(e.target.value);
                    const agg = aggregatedPrices[e.target.value];
                    if (agg) setWizRefAnchor(agg.finalPrice);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
                >
                  <option value="BTCUSDT" className="bg-[#101A15] text-[#F1F5F2]">BTC/USDT (Bitcoin Spot Feed)</option>
                  <option value="ETHUSDT" className="bg-[#101A15] text-[#F1F5F2]">ETH/USDT (Ethereum Spot Feed)</option>
                  <option value="SOLUSDT" className="bg-[#101A15] text-[#F1F5F2]">SOL/USDT (Solana Spot Feed)</option>
                  <option value="BNBUSDT" className="bg-[#101A15] text-[#F1F5F2]">BNB/USDT (BNB Spot Feed)</option>
                  <option value="DOGEUSDT" className="bg-[#101A15] text-[#F1F5F2]">DOGE/USDT (Dogecoin Spot Feed)</option>
                  <option value="XRPUSDT" className="bg-[#101A15] text-[#F1F5F2]">XRP/USDT (Ripple Spot Feed)</option>
                  <option value="ADAUSDT" className="bg-[#101A15] text-[#F1F5F2]">ADA/USDT (Cardano Spot Feed)</option>
                  <option value="AVAXUSDT" className="bg-[#101A15] text-[#F1F5F2]">AVAX/USDT (Avalanche Spot Feed)</option>
                  <option value="LINKUSDT" className="bg-[#101A15] text-[#F1F5F2]">LINK/USDT (Chainlink Spot Feed)</option>
                  <option value="USDTIDR" className="bg-[#101A15] text-[#F1F5F2]">USDT/IDR (Tether Official Rupiah FX)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Mapping Mode</label>
                <select
                  value={wizMappingMode}
                  onChange={(e) => setWizMappingMode(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2]"
                >
                  <option value="PERCENTAGE_RETURN" className="bg-[#101A15] text-[#F1F5F2]">PERCENTAGE_RETURN (Anchor-Based Return)</option>
                  <option value="BETA_SCALED_RETURN" className="bg-[#101A15] text-[#F1F5F2]">BETA_SCALED_RETURN (Scaled Elasticity)</option>
                  <option value="FX_CONVERTED_REFERENCE" className="bg-[#101A15] text-[#F1F5F2]">FX_CONVERTED_REFERENCE (USDT x Kurs IDR)</option>
                  <option value="DIRECT_PRICE" className="bg-[#101A15] text-[#F1F5F2]">DIRECT_PRICE (Mirroring 1:1)</option>
                </select>
              </div>
            </div>

            {/* 1. Anchor Prices & Relative Sensitivity */}
            <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] space-y-3">
              <h4 className="font-bold text-[#F1F5F2] text-xs flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-[#10B981]" />
                Parameter Anchor & Sensitivitas Relatif
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Target Anchor Price</label>
                  <input
                    type="number"
                    step="any"
                    value={wizTargetAnchor}
                    onChange={(e) => setWizTargetAnchor(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#34D399] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Harga jangkar aset lokal exchange</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Reference Anchor Price</label>
                  <input
                    type="number"
                    step="any"
                    value={wizRefAnchor}
                    onChange={(e) => setWizRefAnchor(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Harga jangkar pasar acuan eksternal</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Sensitivity Beta (β)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={wizBeta}
                    onChange={(e) => setWizBeta(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#60A5FA] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#A1ADA5]">1% ref move = {wizBeta}% target move</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Max Deviation Bps</label>
                  <input
                    type="number"
                    value={wizMaxDeviationBps}
                    onChange={(e) => setWizMaxDeviationBps(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EAB866] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Batas toleransi deviasi ({((wizMaxDeviationBps || 0) / 100).toFixed(1)}%)</span>
                </div>
              </div>
            </div>

            {/* 2. Order Level & Liquidity Ladder Parameters */}
            <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] space-y-3">
              <h4 className="font-bold text-[#F1F5F2] text-xs flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-[#34D399]" />
                  Spesifikasi Order Level & Tangga Likuiditas (Ladder & Pricing Engine)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30">
                  {wizStrategy === 'PRICE_FOLLOWER' ? '1 BID & 1 ASK LEVEL' : `${wizBidLevels} BID & ${wizAskLevels} ASK LEVELS`}
                </span>
              </h4>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Jumlah Level Bid</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    disabled={wizStrategy === 'PRICE_FOLLOWER'}
                    value={wizStrategy === 'PRICE_FOLLOWER' ? 1 : wizBidLevels}
                    onChange={(e) => setWizBidLevels(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#10B981] font-mono font-bold disabled:opacity-50 tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Tangga order beli</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Jumlah Level Ask</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    disabled={wizStrategy === 'PRICE_FOLLOWER'}
                    value={wizStrategy === 'PRICE_FOLLOWER' ? 1 : wizAskLevels}
                    onChange={(e) => setWizAskLevels(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EF6464] font-mono font-bold disabled:opacity-50 tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Tangga order jual</span>
                </div>
                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Min Order Bid ({wizBaseAsset})</label>
                  <input
                    type="number"
                    step="any"
                    value={wizMinOrderBid}
                    onChange={(e) => setWizMinOrderBid(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#10B981] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Ukuran beli minimum</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Min Order Ask ({wizBaseAsset})</label>
                  <input
                    type="number"
                    step="any"
                    value={wizMinOrderAsk}
                    onChange={(e) => setWizMinOrderAsk(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EF6464] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Ukuran jual minimum</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Min Amount Level ({wizBaseAsset})</label>
                  <input
                    type="number"
                    step="any"
                    value={wizMinAmountOrderLevel}
                    onChange={(e) => setWizMinAmountOrderLevel(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Volume level terendah</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Max Amount Level ({wizBaseAsset})</label>
                  <input
                    type="number"
                    step="any"
                    value={wizMaxAmountOrderLevel}
                    onChange={(e) => setWizMaxAmountOrderLevel(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Volume level tertinggi</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Amount Order Level ({wizBaseAsset})</label>
                  <input
                    type="number"
                    step="any"
                    value={wizAmountOrderLevel}
                    onChange={(e) => setWizAmountOrderLevel(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#34D399] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Base quote quantity</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Min Spread (bps)</label>
                  <input
                    type="number"
                    value={wizMinSpreadBps}
                    onChange={(e) => setWizMinSpreadBps(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EAB866] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Spread paling ketat Level 1</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Max Spread (bps)</label>
                  <input
                    type="number"
                    value={wizMaxSpreadBps}
                    onChange={(e) => setWizMaxSpreadBps(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EAB866] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Spread terlebar Level 5</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Qty Amount Random (%)</label>
                  <input
                    type="number"
                    value={wizQtyAmountRandom}
                    onChange={(e) => setWizQtyAmountRandom(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#60A5FA] font-mono font-bold tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Variasi random volume per level</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Delay Min (ms)</label>
                  <input
                    type="number"
                    step="100"
                    value={wizDelayMinMs}
                    onChange={(e) => setWizDelayMinMs(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Jeda eksekusi terendah</span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">Delay Max (ms)</label>
                  <input
                    type="number"
                    step="100"
                    value={wizDelayMaxMs}
                    onChange={(e) => setWizDelayMaxMs(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168]">Jeda eksekusi tertinggi</span>
                </div>
              </div>
            </div>

            {/* 3. Parameter Manajemen Inventaris & Batas Risiko (Inventory Controls) */}
            <div className="p-4 rounded-xl bg-[#101A15] border border-[#EAB866]/30 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-[#EAB866] text-xs flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#EAB866]" />
                    Parameter Manajemen Inventaris & Batas Risiko (Inventory Controls)
                  </h4>
                  <p className="text-[11px] text-[#A1ADA5] mt-0.5">Proteksi Saldo & Volume Bursa</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#064E3B]/50 border border-[#10B981]/40 text-[#34D399] cursor-pointer font-bold text-xs select-none">
                    <input
                      type="checkbox"
                      checked={wizAntiStackingActive}
                      onChange={(e) => setWizAntiStackingActive(e.target.checked)}
                      className="rounded accent-[#10B981]"
                    />
                    <span>✓ Anti-Numpuk / Anti-Stacking Aktif</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-2.5 rounded-lg bg-[#142019] border border-[#26372D]">
                  <label className="block text-[11px] font-semibold text-[#A1ADA5] mb-0.5">
                    Max Inventory ({wizBaseAsset})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={wizMaxInventoryBase}
                    onChange={(e) => setWizMaxInventoryBase(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono font-bold text-xs tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168] mt-0.5 block">Batas stok koin dasar</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#142019] border border-[#26372D]">
                  <label className="block text-[11px] font-semibold text-[#A1ADA5] mb-0.5">
                    Max Total Bid Value ({wizQuoteAsset})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={wizMaxTotalBidValue}
                    onChange={(e) => setWizMaxTotalBidValue(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#10B981] font-mono font-bold text-xs tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168] mt-0.5 block">Total komitmen beli</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#142019] border border-[#26372D]">
                  <label className="block text-[11px] font-semibold text-[#A1ADA5] mb-0.5">
                    Max Total Ask Qty ({wizBaseAsset})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={wizMaxTotalAskQty}
                    onChange={(e) => setWizMaxTotalAskQty(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EF6464] font-mono font-bold text-xs tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168] mt-0.5 block">Total komitmen jual</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#142019] border border-[#26372D]">
                  <label className="block text-[11px] font-semibold text-[#A1ADA5] mb-0.5">Max Open Orders</label>
                  <input
                    type="number"
                    value={wizMaxOpenOrders}
                    onChange={(e) => setWizMaxOpenOrders(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#34D399] font-mono font-bold text-xs tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168] mt-0.5 block">Order aktif maksimum</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#142019] border border-[#26372D]">
                  <label className="block text-[11px] font-semibold text-[#A1ADA5] mb-0.5">Custom Tick Size (Opsional)</label>
                  <input
                    type="number"
                    step="any"
                    value={wizCustomTickSize}
                    onChange={(e) => setWizCustomTickSize(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EAB866] font-mono font-bold text-xs tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168] mt-0.5 block">Kelipatan harga minimum (tick size)</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#142019] border border-[#26372D]">
                  <label className="block text-[11px] font-semibold text-[#A1ADA5] mb-0.5">Minimum Lot Size</label>
                  <input
                    type="number"
                    step="any"
                    value={wizMinimumLotSize}
                    onChange={(e) => setWizMinimumLotSize(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#60A5FA] font-mono font-bold text-xs tabular-nums"
                  />
                  <span className="text-[10px] text-[#647168] mt-0.5 block">Satuan ukuran terkecil per order</span>
                </div>
              </div>
            </div>

            {/* 4. Preview Pratinjau Tangga Order */}
            <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#26372D]">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#10B981]" />
                  <h4 className="font-bold text-[#F1F5F2] text-xs uppercase tracking-wider">
                    Pratinjau Tangga Order (Order Ladder Preview)
                  </h4>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/50 border border-[#10B981]/30 text-[#34D399] font-mono">
                    {wizPair} • {wizRefSymbol}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                  <span className="text-[#A1ADA5]">
                    Ref Price: <span className="text-[#F1F5F2] font-bold">${previewLadder.refCurrent.toLocaleString()}</span>
                  </span>
                  <span className="text-[#A1ADA5]">
                    Calculated Mid: <span className="text-[#34D399] font-bold">{formatIDR(previewLadder.targetCalculatedMid)}</span>
                  </span>
                  <span className="text-[#A1ADA5]">
                    Spread: <span className="text-[#EAB866] font-bold">{previewLadder.effectiveSpreadBps} bps</span>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Tangga Beli (Bids) */}
                <div className="p-3 rounded-lg bg-[#142019] border border-[#10B981]/25">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#26372D] text-[11px] font-bold text-[#10B981]">
                    <span>TANGGA BELI (BID LADDER)</span>
                    <span className="font-mono text-[#A1ADA5] tabular-nums">
                      Total: {formatIDR(previewLadder.totalBidVal)}
                    </span>
                  </div>
                  <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                    {previewLadder.bidLevels.map((b) => {
                      const maxTotal = previewLadder.totalBidVal || 1;
                      const widthPct = Math.min(100, Math.round((b.totalValue / maxTotal) * 100));
                      return (
                        <div
                          key={`bid-${b.level}`}
                          className="relative flex items-center justify-between px-2.5 py-1.5 rounded bg-[#101A15] border border-[#10B981]/20 overflow-hidden"
                        >
                          <div
                            className="absolute left-0 top-0 bottom-0 bg-[#10B981]/10 pointer-events-none"
                            style={{ width: `${widthPct}%` }}
                          />
                          <div className="relative flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-[#064E3B] text-[#34D399] text-[10px] font-bold">
                              L{b.level}
                            </span>
                            <span className="text-[#A1ADA5] text-[10px]">-{b.offsetBps} bps</span>
                            <span className="text-[#10B981] font-bold">{formatIDR(b.price)}</span>
                          </div>
                          <div className="relative flex items-center gap-3">
                            <span className="text-[#F1F5F2]">{b.quantity} {wizBaseAsset}</span>
                            <span className="text-[#A1ADA5] text-[10px]">{formatIDR(b.totalValue)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tangga Jual (Asks) */}
                <div className="p-3 rounded-lg bg-[#142019] border border-[#EF6464]/25">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#26372D] text-[11px] font-bold text-[#EF6464]">
                    <span>TANGGA JUAL (ASK LADDER)</span>
                    <span className="font-mono text-[#A1ADA5] tabular-nums">
                      Total: {previewLadder.totalAskQty.toFixed(4)} {wizBaseAsset}
                    </span>
                  </div>
                  <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                    {previewLadder.askLevels.map((a) => {
                      const maxQty = previewLadder.totalAskQty || 1;
                      const widthPct = Math.min(100, Math.round((a.quantity / maxQty) * 100));
                      return (
                        <div
                          key={`ask-${a.level}`}
                          className="relative flex items-center justify-between px-2.5 py-1.5 rounded bg-[#101A15] border border-[#EF6464]/20 overflow-hidden"
                        >
                          <div
                            className="absolute right-0 top-0 bottom-0 bg-[#EF6464]/10 pointer-events-none"
                            style={{ width: `${widthPct}%` }}
                          />
                          <div className="relative flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-[#EF6464]/20 text-[#EF6464] text-[10px] font-bold">
                              L{a.level}
                            </span>
                            <span className="text-[#A1ADA5] text-[10px]">+{a.offsetBps} bps</span>
                            <span className="text-[#EF6464] font-bold">{formatIDR(a.price)}</span>
                          </div>
                          <div className="relative flex items-center gap-3">
                            <span className="text-[#F1F5F2]">{a.quantity} {wizBaseAsset}</span>
                            <span className="text-[#A1ADA5] text-[10px]">{formatIDR(a.totalValue)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Protection & Sizing Footer Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[10px] text-[#A1ADA5] border-t border-[#26372D] font-mono tabular-nums">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[#34D399] font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                    Anti-Numpuk Aktif (Auto-Purge Stale Orders)
                  </span>
                  <span>Tick Size: {wizCustomTickSize} IDR</span>
                  <span>Min Lot: {wizMinimumLotSize} {wizBaseAsset}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>Komitmen Beli: {formatIDR(previewLadder.totalBidVal)} / {formatIDR(wizMaxTotalBidValue)}</span>
                  <span>Komitmen Jual: {previewLadder.totalAskQty.toFixed(4)} / {wizMaxTotalAskQty} {wizBaseAsset}</span>
                </div>
              </div>
            </div>

            {previewLadder.warning && (
              <div className="p-2.5 rounded-lg bg-[#EAB866]/10 border border-[#EAB866]/40 text-xs text-[#EAB866] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#EAB866] shrink-0" />
                <span>{previewLadder.warning} — Sesuaikan Max Total Bid Value / Max Open Orders jika ingin seluruh level aktif.</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#26372D]">
              <button
                type="button"
                onClick={() => {
                  setEditingBotId(null);
                  setActiveTab('bots');
                }}
                className="px-4 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] transition-colors"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold transition-colors flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>{editingBotId ? 'Update Konfigurasi Bot' : 'Simpan Konfigurasi Bot'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* VIEW 4: EXTERNAL PRICE MONITOR */}
      {activeTab === 'feeds' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-[#F1F5F2] text-sm flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#EAB866]" />
                WebSocket Connection Health & Provider Metrics
              </h3>
              <span
                className={`text-[10px] px-2.5 py-1 rounded font-mono border ${
                  workerFeedHealth.wsConnected
                    ? 'bg-[#064E3B]/50 text-[#34D399] border-[#10B981]/30'
                    : 'bg-[#EAB866]/15 text-[#EAB866] border-[#EAB866]/30'
                }`}
              >
                Internal WS (/ws): {workerFeedHealth.wsConnected ? 'CONNECTED' : 'REST SYNC ACTIVE'}
              </span>
            </div>

            {workerFeedHealth.wsError && !workerFeedHealth.wsConnected && (
              <div className="p-2.5 rounded-lg bg-[#EAB866]/10 border border-[#EAB866]/30 text-xs text-[#EAB866] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#EAB866] shrink-0" />
                <span>{workerFeedHealth.wsError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['binance', 'bybit'] as const).map((providerKey) => {
                const info = workerFeedHealth[providerKey];
                const isConnected = info.status === 'CONNECTED';
                const isReconnecting = info.status === 'RECONNECTING' || info.status === 'CONNECTING';
                const endpoint =
                  providerKey === 'binance'
                    ? 'wss://stream.binance.com:9443/ws'
                    : 'wss://stream.bybit.com/v5/public/spot';
                const title = providerKey === 'binance' ? 'Binance Spot WebSocket' : 'Bybit Spot WebSocket';

                return (
                  <div key={providerKey} className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#F1F5F2] flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            isConnected
                              ? 'bg-[#10B981]'
                              : isReconnecting
                              ? 'bg-[#EAB866]'
                              : 'bg-[#EF6464]'
                          }`}
                        ></span>
                        {title}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono tabular-nums ${
                          isConnected
                            ? 'bg-[#064E3B]/50 text-[#34D399]'
                            : isReconnecting
                            ? 'bg-[#EAB866]/20 text-[#EAB866]'
                            : 'bg-[#EF6464]/20 text-[#EF6464]'
                        }`}
                      >
                        {info.status} ({info.latencyMs ?? 0}ms)
                      </span>
                    </div>
                    <p className="text-xs text-[#A1ADA5]">
                      Endpoint: <code className="text-[#F1F5F2]">{endpoint}</code>
                    </p>
                    <div className="text-xs text-[#A1ADA5] flex flex-wrap justify-between gap-2 pt-1 tabular-nums">
                      <span>Pairs Tracked: {info.symbolsTracked.length}</span>
                      <span>Mode: {info.fallbackActive ? 'Simulated Failover' : 'Live Upstream WS'}</span>
                      <span>
                        Last Tick:{' '}
                        {info.lastMessageTime > 0
                          ? new Date(info.lastMessageTime).toLocaleTimeString('id-ID')
                          : 'Waiting...'}
                      </span>
                    </div>
                    {info.lastError && (
                      <p className="text-[11px] text-[#EAB866] font-mono truncate" title={info.lastError}>
                        Note: {info.lastError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 5: FX INTERACTIVE CALCULATOR */}
      {activeTab === 'fx_calc' && (
        <div className="p-5 rounded-xl bg-[#142019] border border-[#26372D] space-y-4">
          <div className="pb-3 border-b border-[#26372D]">
            <h3 className="font-bold text-[#F1F5F2] text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#10B981]" />
              USDT/IDR FX Conversion Simulator & Calculator
            </h3>
            <p className="text-xs text-[#A1ADA5] mt-0.5">
              Simulasi perhitungan kurs silang aset kripto (USDT x FX Rate) untuk memastikan konsistensi konversi IDR sebelum diserap oleh bot.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#064E3B]/30 border border-[#10B981]/30 text-xs font-mono text-[#34D399]">
            Formula Baku: <strong>{calcBaseCrypto}/IDR = {calcBaseCrypto}/USDT × USDT/IDR</strong>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">Pilih Aset Acuan</label>
              <select
                value={calcBaseCrypto}
                onChange={(e) => {
                  const c = e.target.value as any;
                  setCalcBaseCrypto(c);
                  if (c === 'BTC') setCalcUsdtPrice(22450.5);
                  if (c === 'ETH') setCalcUsdtPrice(2010.25);
                  if (c === 'SOL') setCalcUsdtPrice(85.8);
                }}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-bold"
              >
                <option value="BTC" className="bg-[#101A15] text-[#F1F5F2]">Bitcoin (BTC/USDT)</option>
                <option value="ETH" className="bg-[#101A15] text-[#F1F5F2]">Ethereum (ETH/USDT)</option>
                <option value="SOL" className="bg-[#101A15] text-[#F1F5F2]">Solana (SOL/USDT)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">Harga Acuan USDT</label>
              <input
                type="number"
                step="any"
                value={calcUsdtPrice}
                onChange={(e) => setCalcUsdtPrice(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#34D399] font-mono font-bold tabular-nums"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">Kurs USDT/IDR</label>
              <input
                type="number"
                step="any"
                value={calcFxRate}
                onChange={(e) => setCalcFxRate(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#EAB866] font-mono font-bold tabular-nums"
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] flex items-center justify-between">
            <div>
              <span className="text-xs text-[#A1ADA5] block">Hasil Estimasi Nilai IDR:</span>
              <p className="text-2xl font-bold text-[#10B981] font-mono mt-0.5 tabular-nums">
                {formatIDR(calculatedIdr)}
              </p>
            </div>
            <span className="text-[10px] text-[#A1ADA5] font-mono tabular-nums">
              Timestamp: {formatDateTime(Date.now())}
            </span>
          </div>
        </div>
      )}

      {/* VIEW 6: CRYPTOGRAPHIC AUDIT LOG */}
      {activeTab === 'audit' && (
        <div className="p-5 rounded-xl bg-[#142019] border border-[#26372D] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
            <div>
              <h3 className="font-bold text-[#F1F5F2] text-base flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-[#10B981]" />
                Cryptographic Audit Log (SHA-256 Hash Chained)
              </h3>
              <p className="text-xs text-[#A1ADA5] mt-0.5">
                Setiap event modifikasi parameter bot, status reprice, dan eksekusi dicatat dalam rantai hash SHA-256 yang tamper-evident.
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-[#064E3B]/50 text-[#34D399] font-mono border border-[#10B981]/40">
              CHAIN VERIFIED: OK
            </span>
          </div>

          <div className="space-y-3">
            {auditChain.map((ev) => (
              <div key={ev.id} className="p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] text-xs space-y-1.5 font-mono">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#F1F5F2]">
                    #{ev.index} • {ev.eventType}
                  </span>
                  <span className="text-[#A1ADA5] text-[11px] tabular-nums">{formatDateTime(ev.timestamp)}</span>
                </div>
                <div className="text-[11px] text-[#A1ADA5]">
                  <span>Actor: {ev.actorId} ({ev.actorRole})</span>
                  {ev.botId && <span className="ml-3">• Bot: {ev.botId}</span>}
                </div>
                <div className="p-2 rounded bg-[#142019] text-[10px] text-[#A1ADA5] break-all space-y-0.5 border border-[#26372D]">
                  <div>Prev Hash: <span className="text-[#647168]">{ev.previousHash}</span></div>
                  <div>Curr Hash: <span className="text-[#34D399] font-bold">{ev.currentHash}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
