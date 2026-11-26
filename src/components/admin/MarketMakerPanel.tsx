import React, { useState, useMemo, useEffect } from 'react';
import { useSimulation } from '../../simulation/store';
import { formatIDR, formatCrypto, safeRound, formatDateTime } from '../../utils/formatters';
import {
  Sliders,
  Zap,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  Trash2,
  Sparkles,
  Coins,
  ArrowRight,
  PlusCircle,
  Play,
  Pause,
  Layers,
  ShieldCheck,
  Check,
  Activity,
  Bot,
  Target,
  Compass,
  X,
  AlertTriangle,
  RotateCcw,
  Table2,
  Square,
} from 'lucide-react';
import { aggregateOrderBook } from '../../simulation/clobEngine';
import { MarketPair, OrderSide, PairMMBotConfig, AutoTradeConfig } from '../../simulation/types';
import { MMConfigTable } from './MMConfigTable';

interface MarketMakerPanelProps {
  onSuccessNotice?: (msg: string) => void;
}

export const MarketMakerPanel: React.FC<MarketMakerPanelProps> = ({ onSuccessNotice }) => {
  const {
    markets,
    restingOrders,
    botBalances,
    injectAutomatedLimitOrders,
    depositBotBalance,
    clearMMOrders,
    injectOrderWall,
    cancelOrderWall,
    clearAllWalls,
    pairMMBots,
    fullMMConfigs,
    updatePairMMBot,
    toggleMMBot,
    stopAllPairMMBots,
    startAllPairMMBots,
    updateMarketConfig,
    autoTradeConfig,
    autoTradeBots,
    updateAutoTradeConfig,
    toggleAutoTrade,
    resetAutoTradeVolume,
    upsertAutoTradeBot,
    toggleAutoTradeBotByPair,
    resetAutoTradeBotVolumeByPair,
    removeAutoTradeBot,
    stopAllAutoTradeBots,
    replenishLiquidity,
    activePair,
  } = useSimulation();

  // Navigation Sub-Tabs within the MM Station (Defaulting to Institutional Matrix Setup)
  const [activeSection, setActiveSection] = useState<'matrix' | 'pair_bots' | 'auto_trade' | 'walls' | 'precision'>('matrix');

  // Precision / Custom Injection Form State
  const [selectedPairId, setSelectedPairId] = useState<string>('DNA/IDR');
  const selectedPair = useMemo(
    () => markets.find((m) => m.id === selectedPairId) || markets[0],
    [markets, selectedPairId]
  );

  const [spreadPct, setSpreadPct] = useState<number>(0.35);
  const [frequencySec, setFrequencySec] = useState<number>(2.5);
  const [autoLoopActive, setAutoLoopActive] = useState<boolean>(false);
  const [orderAmount, setOrderAmount] = useState<number>(750);
  const [depthLevels, setDepthLevels] = useState<number>(10);

  // Wall configuration
  const [wallPairId, setWallPairId] = useState<string>('DNA/IDR');
  const wallPair = useMemo(
    () => markets.find((m) => m.id === wallPairId) || markets[0],
    [markets, wallPairId]
  );
  const [wallBuyPrice, setWallBuyPrice] = useState<number>(() => Math.round(wallPair.lastPrice * 0.97));
  const [wallBuyQty, setWallBuyQty] = useState<number>(35000);
  const [wallSellPrice, setWallSellPrice] = useState<number>(() => Math.round(wallPair.lastPrice * 1.03));
  const [wallSellQty, setWallSellQty] = useState<number>(35000);

  // Status message within the panel
  const [panelNotice, setPanelNotice] = useState<string | null>(null);

  const triggerNotice = (msg: string) => {
    setPanelNotice(msg);
    if (onSuccessNotice) onSuccessNotice(msg);
    setTimeout(() => setPanelNotice(null), 3500);
  };

  // Active Walls on the CLOB
  const activeWalls = useMemo(() => restingOrders.filter((o) => o.isWall), [restingOrders]);

  // High-Frequency automated limit order injection loop for precision mode
  useEffect(() => {
    if (!autoLoopActive) return;
    const intervalMs = Math.max(1000, frequencySec * 1000);
    const timer = setInterval(() => {
      injectAutomatedLimitOrders(selectedPairId, spreadPct, frequencySec, orderAmount, depthLevels);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [
    autoLoopActive,
    selectedPairId,
    spreadPct,
    frequencySec,
    orderAmount,
    depthLevels,
    injectAutomatedLimitOrders,
  ]);

  // Real-time Order Book for selected pair
  const currentPairBook = useMemo(() => {
    return aggregateOrderBook(restingOrders, selectedPair.id, undefined, 12);
  }, [restingOrders, selectedPair.id]);

  // Inventory balance tracking
  const botIDR = botBalances['IDR'] || { asset: 'IDR', free: 0, locked: 0, total: 0 };
  const botBase = botBalances[selectedPair.baseAsset] || {
    asset: selectedPair.baseAsset,
    free: 0,
    locked: 0,
    total: 0,
  };

  // Calculate live capital requirements
  const requiredBidsIDR = useMemo(() => {
    let sum = 0;
    const mid = selectedPair.lastPrice;
    for (let i = 0; i < depthLevels; i++) {
      const p = mid * (1 - spreadPct / 200 - i * 0.002);
      sum += p * orderAmount;
    }
    return Math.round(sum);
  }, [selectedPair.lastPrice, spreadPct, depthLevels, orderAmount]);

  const requiredAsksBase = useMemo(() => {
    return safeRound(orderAmount * depthLevels, selectedPair.amountDecimals);
  }, [orderAmount, depthLevels, selectedPair.amountDecimals]);

  const hasSufficientIDR = botIDR.free >= requiredBidsIDR;
  const hasSufficientBase = botBase.free >= requiredAsksBase;

  // Manual Trigger: Inject Real Limit Orders Now
  const handleManualInject = (e: React.FormEvent) => {
    e.preventDefault();
    const result = injectAutomatedLimitOrders(
      selectedPairId,
      spreadPct,
      frequencySec,
      orderAmount,
      depthLevels
    );
    triggerNotice(
      `Injected real limit orders into ${selectedPairId} (${result.ordersCount} resting quotes placed, ${result.tradesCount} matches executed against CLOB ledger).`
    );
  };

  // Action: Tighten Spread Now
  const handleTightenSpreadNow = () => {
    const tightSpread = 0.1;
    setSpreadPct(tightSpread);
    const result = injectAutomatedLimitOrders(
      selectedPairId,
      tightSpread,
      frequencySec,
      orderAmount,
      depthLevels,
      true
    );
    triggerNotice(
      `Tightened ${selectedPairId} spread to 0.10%! Injected ${result.ordersCount} tight quotes (${result.tradesCount} crossing trades filled).`
    );
  };

  // Action: Inject Wall Orders
  const handleDeployBuyWall = () => {
    if (wallBuyPrice <= 0 || wallBuyQty <= 0) return;
    injectOrderWall('buy', wallBuyPrice, wallBuyQty, wallPairId);
    triggerNotice(
      `Support Buy Wall deployed on ${wallPairId} at ${formatIDR(wallBuyPrice)} for ${formatCrypto(wallBuyQty)} ${wallPair.baseAsset}.`
    );
  };

  const handleDeploySellWall = () => {
    if (wallSellPrice <= 0 || wallSellQty <= 0) return;
    injectOrderWall('sell', wallSellPrice, wallSellQty, wallPairId);
    triggerNotice(
      `Resistance Sell Wall deployed on ${wallPairId} at ${formatIDR(wallSellPrice)} for ${formatCrypto(wallSellQty)} ${wallPair.baseAsset}.`
    );
  };

  // Action: Cancel Single Wall
  const handleCancelWall = (wallId: string) => {
    const res = cancelOrderWall(wallId);
    if (res.success) {
      triggerNotice(res.message);
    }
  };

  // Action: Clear All Walls
  const handleClearAllWalls = () => {
    clearAllWalls();
    triggerNotice('All active support/resistance liquidity walls cleared from order book.');
  };

  // Action: Wipe Quotes
  const handleClearMMPair = () => {
    clearMMOrders(selectedPairId);
    triggerNotice(`All active MM quotes wiped for ${selectedPairId}. Walls preserved.`);
  };

  // Auto-Trade Volume Progress Calculation
  const autoTradeProgressPct = useMemo(() => {
    if (!autoTradeConfig.targetVolume || autoTradeConfig.targetVolume <= 0) return 0;
    return Math.min(100, Math.round((autoTradeConfig.accumulatedVolume / autoTradeConfig.targetVolume) * 100));
  }, [autoTradeConfig.accumulatedVolume, autoTradeConfig.targetVolume]);

  const runningAutoTradeCount = useMemo(
    () => autoTradeBots.filter((b) => b.enabled).length,
    [autoTradeBots]
  );

  return (
    <div className="space-y-6">
      {/* 1. Station Header Bar */}
      <div className="rounded-xl p-5 border border-[#26372D] bg-[#142019]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#064E3B]/40 border border-[#10B981]/40 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 text-[#10B981]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#F1F5F2] tracking-tight">
                  Market Maker Algorithmic Station
                </h3>
                <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
                  MM EXCLUSIVE WORKSPACE
                </span>
              </div>
              <p className="text-xs text-[#A1ADA5] mt-0.5">
                Centralized management for Pair-specific MM Bots (1 Bot : 1 Pair), targeted Auto-Trade Bot with volume limits, and order wall lifecycle controls.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#101A15] border border-[#26372D] text-xs font-mono text-[#A1ADA5] tabular-nums">
              <span className="text-[#647168]">Active Walls:</span>
              <span className="font-bold text-[#34D399]">{activeWalls.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#101A15] border border-[#26372D] text-xs font-mono text-[#A1ADA5]">
              <span className="text-[#647168]">Auto-Trade:</span>
              <span className={`font-bold ${autoTradeConfig.enabled ? 'text-[#10B981]' : 'text-[#647168]'}`}>
                {autoTradeConfig.enabled ? 'ACTIVE' : 'IDLE'}
              </span>
            </div>
          </div>
        </div>

        {panelNotice && (
          <div className="mt-4 p-3 rounded-lg bg-[#064E3B]/40 border border-[#10B981]/40 text-[#34D399] text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-[#10B981] shrink-0" />
            <span>{panelNotice}</span>
          </div>
        )}
      </div>

      {/* 2. MM Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#26372D] pb-2">
        <button
          type="button"
          onClick={() => setActiveSection('matrix')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border ${
            activeSection === 'matrix'
              ? 'bg-[#10B981] text-[#0B100E] border-[#10B981]'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] border-transparent'
          }`}
        >
          <Table2 className="w-4 h-4" />
          <span>Institutional MM Matrix (cs_*)</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
              activeSection === 'matrix'
                ? 'bg-[#0B100E]/20 text-[#0B100E]'
                : 'bg-[#101A15] text-[#34D399]'
            }`}
          >
            SETUP & PARAMS
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('pair_bots')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border ${
            activeSection === 'pair_bots'
              ? 'bg-[#10B981] text-[#0B100E] border-[#10B981]'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] border-transparent'
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>1 Bot : 1 Pair Manager</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${
              activeSection === 'pair_bots'
                ? 'bg-[#0B100E]/20 text-[#0B100E]'
                : 'bg-[#101A15] text-[#A1ADA5]'
            }`}
          >
            {markets.length} Pairs
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('auto_trade')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border ${
            activeSection === 'auto_trade'
              ? 'bg-[#10B981] text-[#0B100E] border-[#10B981]'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] border-transparent'
          }`}
        >
          <Target className="w-4 h-4" />
          <span>Configurable Auto-Trade Bot</span>
          {autoTradeConfig.enabled && (
            <span
              className={`w-2 h-2 rounded-full ${
                activeSection === 'auto_trade' ? 'bg-[#0B100E]' : 'bg-[#10B981]'
              }`}
            ></span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('walls')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border ${
            activeSection === 'walls'
              ? 'bg-[#10B981] text-[#0B100E] border-[#10B981]'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] border-transparent'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Order Walls Manager & Cancel</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${
              activeSection === 'walls'
                ? 'bg-[#0B100E]/20 text-[#0B100E]'
                : 'bg-[#101A15] text-[#EAB866]'
            }`}
          >
            {activeWalls.length} Active
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('precision')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border ${
            activeSection === 'precision'
              ? 'bg-[#10B981] text-[#0B100E] border-[#10B981]'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] border-transparent'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Precision CLOB Calibrator</span>
        </button>
      </div>

      {/* Institutional MM Matrix (cs_*) Setup Panel */}
      {activeSection === 'matrix' && (
        <MMConfigTable onSuccessNotice={(msg) => triggerNotice(msg)} />
      )}

      {/* 3. Section 1: Pair MM Bots Matrix (1 Bot 1 Pair) */}
      {activeSection === 'pair_bots' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-[#26372D] bg-[#142019]">
            <div>
              <h4 className="text-sm font-bold text-[#F1F5F2] flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#10B981]" />
                Dedicated Pair Liquidity Bots (1 Bot per 1 Pair)
              </h4>
              <p className="text-xs text-[#A1ADA5] mt-1">
                Each market pair operates its own independent Market Maker Bot. Start, stop, edit spread/depth/quantity, or replenish resting quotes per pair.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const res = startAllPairMMBots();
                  triggerNotice(res.message);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#064E3B]/50 hover:bg-[#064E3B]/70 text-[#34D399] border border-[#10B981]/40 flex items-center gap-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-[#10B981] text-[#10B981]" />
                <span>Start All Bots</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const res = stopAllPairMMBots();
                  triggerNotice(res.message);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/40 flex items-center gap-1.5 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-[#EF6464] text-[#EF6464]" />
                <span>Stop All Bots</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const activeTargets = markets.filter(
                    (m) =>
                      m.isActive &&
                      (pairMMBots[m.id]?.enabled ?? true) &&
                      (fullMMConfigs[m.id]?.enabled ?? true) &&
                      !(fullMMConfigs[m.id]?.emergency_stop)
                  );
                  if (activeTargets.length === 0) {
                    triggerNotice('Tidak ada bot pair yang aktif. Klik Start Bot terlebih dahulu.');
                    return;
                  }
                  activeTargets.forEach((m) => replenishLiquidity(m.id));
                  triggerNotice(`Replenished liquidity for ${activeTargets.length} active trading pairs.`);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Replenish Active Pairs</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {markets.map((pair) => {
              const fallbackTick =
                pair.lastPrice >= 100000000 ? 50000 : pair.lastPrice >= 10000000 ? 10000 : pair.lastPrice >= 100000 ? 500 : 25;
              const fallbackQty = Math.max(
                pair.minOrderAmount || 0.0001,
                pair.lastPrice >= 100000000 ? 0.05 : pair.lastPrice >= 1000000 ? 1 : 50
              );
              const botConfig: PairMMBotConfig = pairMMBots[pair.id] || {
                pair: pair.id,
                enabled: pair.isActive,
                targetSpreadBps: 30,
                levelsPerSide: 10,
                baseAmountPerLevel: fallbackQty,
                tickSize: fallbackTick,
                frequencySec: 3,
              };
              const isEmergencyStopped = Boolean(fullMMConfigs[pair.id]?.emergency_stop);
              const isBotRunning =
                botConfig.enabled &&
                (fullMMConfigs[pair.id]?.enabled ?? true) &&
                !isEmergencyStopped;

              const pairBotOrdersCount = restingOrders.filter(
                (o) => o.pair === pair.id && o.isMM && !o.isWall && !o.userId.startsWith('bot_console_')
              ).length;
              const quantConsoleOrdersCount = restingOrders.filter(
                (o) => o.pair === pair.id && o.isMM && !o.isWall && o.userId.startsWith('bot_console_')
              ).length;
              const pairWallsCount = restingOrders.filter(
                (o) => o.pair === pair.id && o.isWall
              ).length;

              return (
                <DedicatedPairBotCard
                  key={pair.id}
                  pair={pair}
                  botConfig={botConfig}
                  isBotRunning={isBotRunning}
                  isEmergencyStopped={isEmergencyStopped}
                  pairBotOrdersCount={pairBotOrdersCount}
                  quantConsoleOrdersCount={quantConsoleOrdersCount}
                  pairWallsCount={pairWallsCount}
                  onToggle={(nextState) => {
                    toggleMMBot(pair.id, nextState);
                    if (nextState && !pair.isActive) {
                      triggerNotice(
                        `Bot ${pair.id} diset ke RUNNING, namun market sedang CLOSED. Klik "Open Market" untuk mulai menempatkan order.`
                      );
                    } else {
                      triggerNotice(
                        `MM Bot for ${pair.id} is now ${nextState ? 'RUNNING' : 'STOPPED (Quotes cleared)'}.`
                      );
                    }
                  }}
                  onUpdateParams={(updates) => {
                    updatePairMMBot(pair.id, updates);
                    triggerNotice(`Updated parameters for ${pair.id} bot.`);
                  }}
                  onReplenish={() => {
                    if (!pair.isActive) {
                      triggerNotice(`Market ${pair.id} sedang CLOSED. Aktifkan market terlebih dahulu untuk menempatkan quotes.`);
                      return;
                    }
                    replenishLiquidity(pair.id);
                    triggerNotice(`Replenished CLOB liquidity quotes for ${pair.id}.`);
                  }}
                  onClearQuotes={() => {
                    clearMMOrders(pair.id);
                    triggerNotice(`Cleared Dedicated Pair MM quotes for ${pair.id}. Walls preserved.`);
                  }}
                  onActivateMarket={() => {
                    updateMarketConfig(pair.id, { isActive: true, tradingAccessStatus: 'OPEN' });
                    triggerNotice(`Market ${pair.id} diaktifkan (OPEN).`);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Section 2: Configurable Multi-Pair Auto-Trade Bots (Target Volume, Trend Strategy, Auto-Stop) */}
      {activeSection === 'auto_trade' && (
        <div className="rounded-xl p-5 border border-[#26372D] bg-[#142019] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#26372D]">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                  <Target className="w-5 h-5 text-[#10B981]" />
                  Targeted Auto-Trade Execution Bot ({runningAutoTradeCount} Running / {autoTradeBots.length} Configured)
                </h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-bold border ${
                    autoTradeConfig.enabled
                      ? 'bg-[#064E3B]/50 text-[#34D399] border-[#10B981]/40'
                      : 'bg-[#101A15] text-[#647168] border-[#26372D]'
                  }`}
                >
                  {autoTradeConfig.targetPair}: {autoTradeConfig.enabled ? '● RUNNING' : '○ STOPPED'}
                </span>
              </div>
              <p className="text-xs text-[#A1ADA5] mt-1">
                Jalankan beberapa Auto-Trade Bot secara bersamaan pada pair berbeda (BTC/IDR, ETH/IDR, DNA/IDR, SOL/IDR, dll) dengan target volume, bias eksekusi, dan auto-stop independen.
              </p>
            </div>

            {/* Main Toggle & Fleet Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {runningAutoTradeCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    stopAllAutoTradeBots();
                    triggerNotice('Seluruh Targeted Auto-Trade Bot dihentikan.');
                  }}
                  className="px-3.5 py-2 rounded-lg text-xs font-bold bg-[#101A15] hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/40 flex items-center gap-1.5 transition-colors"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop All ({runningAutoTradeCount})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  upsertAutoTradeBot({ ...autoTradeConfig, enabled: true });
                  triggerNotice(`Bot Auto-Trade ${autoTradeConfig.targetPair} disimpan & dijalankan!`);
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-[#064E3B] hover:bg-[#10B981] text-[#F1F5F2] hover:text-[#0B100E] border border-[#10B981]/40 flex items-center gap-1.5 transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Simpan & Run {autoTradeConfig.targetPair}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  toggleAutoTrade();
                  triggerNotice(
                    `Auto-Trade Bot (${autoTradeConfig.targetPair}) is now ${!autoTradeConfig.enabled ? 'ACTIVE' : 'STOPPED'}.`
                  );
                }}
                className={`px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${
                  autoTradeConfig.enabled
                    ? 'bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E]'
                    : 'bg-[#10B981] hover:bg-[#34D399] text-[#0B100E]'
                }`}
              >
                {autoTradeConfig.enabled ? (
                  <>
                    <Pause className="w-4 h-4 fill-current" />
                    <span>Stop {autoTradeConfig.targetPair}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start {autoTradeConfig.targetPair}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#064E3B]/25 border border-[#10B981]/30 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[#A1ADA5]">
              <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0" />
              <span>
                <strong className="text-[#F1F5F2]">Volume Execution V2 Engine Ready:</strong> Gunakan tab{' '}
                <strong className="text-[#34D399]">Quant MM Console → Volume Bots (V2)</strong> untuk eksekusi server-authoritative (TWAP, VWAP, Iceberg, Passive/Aggressive Limit, BigInt precision, &amp; full risk guard) serta migrasi bot legacy 1-klik.
              </span>
            </div>
          </div>

          {/* Multi-Pair Active Auto-Trade Fleet List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#F1F5F2] flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#10B981]" />
                Multi-Pair Auto-Trade Bot Fleet ({autoTradeBots.length} Pair Terkonfigurasi)
              </span>
              <span className="text-[11px] text-[#A1ADA5] font-mono">
                Klik Edit pada kartu untuk ubah parameter pair tersebut
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {autoTradeBots.map((bot) => {
                const pct =
                  bot.targetVolume > 0
                    ? Math.min(100, Math.round((bot.accumulatedVolume / bot.targetVolume) * 100))
                    : 0;
                const isSelected = autoTradeConfig.targetPair === bot.targetPair;
                const baseSym = bot.targetPair.split('/')[0];

                return (
                  <div
                    key={bot.targetPair}
                    className={`p-3.5 rounded-xl border transition-colors space-y-2.5 ${
                      isSelected
                        ? 'bg-[#192820] border-[#10B981]/60'
                        : 'bg-[#101A15] border-[#26372D] hover:border-[#10B981]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#F1F5F2] font-mono text-xs">{bot.targetPair}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                            bot.enabled
                              ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30'
                              : 'bg-[#142019] text-[#647168] border border-[#26372D]'
                          }`}
                        >
                          {bot.enabled ? 'RUNNING' : 'STOPPED'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[#A1ADA5] tabular-nums">
                        {bot.intervalSeconds}s • {bot.executionMode.toUpperCase()}
                      </span>
                    </div>

                    <div className="space-y-1 text-[11px] font-mono tabular-nums">
                      <div className="flex justify-between text-[#A1ADA5]">
                        <span>Progress ({pct}%)</span>
                        <span className="text-[#F1F5F2]">
                          {formatCrypto(bot.accumulatedVolume)} / {formatCrypto(bot.targetVolume)} {baseSym}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#142019] border border-[#26372D] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#10B981] transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-[#647168]">
                        <span>Size: {bot.minOrderSize}–{bot.maxOrderSize} {baseSym}</span>
                        {bot.lastReason && <span className="text-[#EAB866]">{bot.lastReason}</span>}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-[#26372D] text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            toggleAutoTradeBotByPair(bot.targetPair);
                            triggerNotice(
                              `Bot Auto-Trade ${bot.targetPair} ${!bot.enabled ? 'STARTED' : 'STOPPED'}.`
                            );
                          }}
                          className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors ${
                            bot.enabled
                              ? 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30 hover:bg-[#EF6464]/25'
                              : 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 hover:bg-[#064E3B]/70'
                          }`}
                        >
                          {bot.enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          <span>{bot.enabled ? 'Stop' : 'Start'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => updateAutoTradeConfig({ targetPair: bot.targetPair })}
                          className="px-2 py-1 rounded-lg bg-[#142019] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] font-semibold"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => resetAutoTradeBotVolumeByPair(bot.targetPair)}
                          className="px-2 py-1 rounded-lg bg-[#142019] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] font-semibold"
                          title="Reset counter volume"
                        >
                          Reset
                        </button>
                      </div>
                      {autoTradeBots.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            removeAutoTradeBot(bot.targetPair);
                            triggerNotice(`Bot Auto-Trade ${bot.targetPair} dihapus.`);
                          }}
                          className="p-1 rounded-lg bg-[#142019] hover:bg-[#EF6464]/20 border border-[#26372D] text-[#A1ADA5] hover:text-[#EF6464]"
                          title="Hapus Bot Pair"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Volume Target Progress Card for Selected Editor Pair */}
          <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] space-y-3 tabular-nums">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-sans text-[#A1ADA5] font-semibold">Selected Pair Progress ({autoTradeConfig.targetPair}):</span>
                <span className="text-[#34D399] font-bold font-mono">
                  {formatCrypto(autoTradeConfig.accumulatedVolume)} / {formatCrypto(autoTradeConfig.targetVolume)}{' '}
                  {autoTradeConfig.targetPair.split('/')[0]}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-bold font-mono">
                  {autoTradeProgressPct}%
                </span>
              </div>

              <div className="flex items-center gap-3">
                {autoTradeConfig.autoStopOnTarget && (
                  <span className="text-[11px] font-sans text-[#34D399] flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Auto-Stop Active on 100%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    resetAutoTradeVolume();
                    triggerNotice(`Accumulated auto-trade volume reset to 0 for ${autoTradeConfig.targetPair}.`);
                  }}
                  className="px-2.5 py-1 text-[11px] rounded bg-[#142019] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D] transition-colors"
                >
                  Reset Counter
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-3 bg-[#142019] rounded-full overflow-hidden p-0.5 border border-[#26372D]">
              <div
                className="h-full bg-[#10B981] rounded-full transition-all duration-300"
                style={{ width: `${autoTradeProgressPct}%` }}
              ></div>
            </div>
          </div>

          {/* Form Settings Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* Setting 1: Target Pair */}
            <div className="p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] space-y-2">
              <label className="block font-semibold text-[#A1ADA5]">Target Trading Pair</label>
              <select
                value={autoTradeConfig.targetPair}
                onChange={(e) => updateAutoTradeConfig({ targetPair: e.target.value })}
                className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] rounded-lg px-3 py-2 text-xs text-[#F1F5F2] font-semibold cursor-pointer outline-none"
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#101A15] text-[#F1F5F2]">
                    {m.id} ({m.name})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#647168]">
                Memilih pair lain otomatis menambahkan/membuka konfigurasi bot khusus pair tersebut tanpa mematikan bot pair lain.
              </p>
            </div>

            {/* Setting 2: Target Volume & Auto-Stop */}
            <div className="p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] space-y-2">
              <label className="block font-semibold text-[#A1ADA5]">
                Target Volume ({autoTradeConfig.targetPair.split('/')[0]})
              </label>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={autoTradeConfig.targetVolume}
                onChange={(e) =>
                  updateAutoTradeConfig({
                    targetVolume: Math.max(0.0001, parseFloat(e.target.value) || 1),
                  })
                }
                className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] rounded-lg px-3 py-2 text-xs font-mono text-[#34D399] outline-none tabular-nums"
              />
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={autoTradeConfig.autoStopOnTarget}
                  onChange={(e) => updateAutoTradeConfig({ autoStopOnTarget: e.target.checked })}
                  className="accent-[#10B981] w-3.5 h-3.5 rounded cursor-pointer"
                />
                <span className="text-[11px] text-[#A1ADA5] font-medium">
                  Auto-stop when target volume reached
                </span>
              </label>
            </div>

            {/* Setting 3: Execution Mode (Buy First / Sell First / Random) */}
            <div className="p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] space-y-2">
              <label className="block font-semibold text-[#A1ADA5]">Order Execution Bias</label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: 'buy_first', label: 'Buy First (85%)' },
                  { id: 'sell_first', label: 'Sell First (85%)' },
                  { id: 'random', label: 'Random (50/50)' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() =>
                      updateAutoTradeConfig({
                        executionMode: mode.id as AutoTradeConfig['executionMode'],
                      })
                    }
                    className={`py-2 px-1 text-[10.5px] font-semibold rounded-lg text-center transition-colors border ${
                      autoTradeConfig.executionMode === mode.id
                        ? 'bg-[#064E3B]/50 text-[#34D399] border-[#10B981]/40'
                        : 'bg-[#142019] text-[#A1ADA5] border-[#26372D] hover:text-[#F1F5F2]'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-[#647168]">
                {autoTradeConfig.executionMode === 'buy_first'
                  ? 'Heavy buyer bias: aggressively lifts asks.'
                  : autoTradeConfig.executionMode === 'sell_first'
                  ? 'Heavy seller bias: aggressively hits bids.'
                  : 'Balanced churn: randomized buy and sell crossing.'}
              </p>
            </div>

            {/* Setting 4: Trend Strategy */}
            <div className="p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] space-y-2">
              <label className="block font-semibold text-[#A1ADA5]">Trend Strategy</label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: 'trend_up', label: 'Trend UP ↗' },
                  { id: 'trend_down', label: 'Trend DOWN ↘' },
                  { id: 'neutral', label: 'Range ~' },
                ].map((strat) => (
                  <button
                    key={strat.id}
                    type="button"
                    onClick={() =>
                      updateAutoTradeConfig({
                        trendStrategy: strat.id as AutoTradeConfig['trendStrategy'],
                      })
                    }
                    className={`py-2 px-1 text-[10.5px] font-semibold rounded-lg text-center transition-colors border ${
                      autoTradeConfig.trendStrategy === strat.id ||
                      (strat.id === 'neutral' && (autoTradeConfig.trendStrategy as string) === 'range_neutral')
                        ? 'bg-[#60A5FA]/15 text-[#60A5FA] border-[#60A5FA]/40'
                        : 'bg-[#142019] text-[#A1ADA5] border-[#26372D] hover:text-[#F1F5F2]'
                    }`}
                  >
                    {strat.label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-[#647168]">
                {autoTradeConfig.trendStrategy === 'trend_up'
                  ? 'Pushes market price higher tick-by-tick.'
                  : autoTradeConfig.trendStrategy === 'trend_down'
                  ? 'Pushes market price downward tick-by-tick.'
                  : 'Keeps price stable within mid-market spread.'}
              </p>
            </div>

            {/* Setting 5: Order Size Min / Max */}
            <div className="p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] space-y-2">
              <label className="block font-semibold text-[#A1ADA5]">
                Order Size Range ({autoTradeConfig.targetPair.split('/')[0]})
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-[#647168]">Min Size</span>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={autoTradeConfig.minOrderSize}
                    onChange={(e) =>
                      updateAutoTradeConfig({
                        minOrderSize: Math.max(0.0001, parseFloat(e.target.value) || 0.001),
                      })
                    }
                    className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none rounded px-2 py-1 font-mono text-[#F1F5F2] tabular-nums"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-[#647168]">Max Size</span>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={autoTradeConfig.maxOrderSize}
                    onChange={(e) =>
                      updateAutoTradeConfig({
                        maxOrderSize: Math.max(
                          autoTradeConfig.minOrderSize,
                          parseFloat(e.target.value) || autoTradeConfig.minOrderSize
                        ),
                      })
                    }
                    className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none rounded px-2 py-1 font-mono text-[#F1F5F2] tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Setting 6: Execution Interval */}
            <div className="p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] space-y-2">
              <label className="block font-semibold text-[#A1ADA5] tabular-nums">
                Execution Interval (Seconds): {autoTradeConfig.intervalSeconds}s
              </label>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={autoTradeConfig.intervalSeconds}
                onChange={(e) =>
                  updateAutoTradeConfig({
                    intervalSeconds: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-[#10B981] h-1.5 bg-[#142019] rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[#647168] font-mono">
                <span>1s (HFT)</span>
                <span>3s (Standard)</span>
                <span>10s (Relaxed)</span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#101A15] border border-[#26372D] flex items-center gap-2 text-xs text-[#A1ADA5]">
            <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0" />
            <span>
              Real MM Matching: All trades executed by every pair bot are bona fide market taker transactions executed against resting quotes in the CLOB. Each bot runs independently on its selected order book and persists real-time OHLCV candles.
            </span>
          </div>
        </div>
      )}

      {/* 5. Section 3: Active Order Walls Manager & Cancellation */}
      {activeSection === 'walls' && (
        <div className="space-y-5">
          {/* Top Banner & Info */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-[#EAB866]/30 bg-[#142019]">
            <div>
              <h4 className="text-sm font-bold text-[#F1F5F2] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#EAB866]" />
                Active Order Walls Lifecycle & Cancellation
              </h4>
              <p className="text-xs text-[#A1ADA5] mt-1">
                Order walls are heavy resting limit orders placed on the CLOB to establish strong support or resistance. Every active wall can be cancelled immediately below, removing it from the order book.
              </p>
            </div>
            {activeWalls.length > 0 && (
              <button
                type="button"
                onClick={handleClearAllWalls}
                className="px-3.5 py-2 rounded-lg text-xs font-bold bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Clear All Active Walls</span>
              </button>
            )}
          </div>

          {/* Active Walls Table */}
          <div className="bg-[#142019] rounded-xl overflow-hidden border border-[#26372D] text-xs">
            <div className="p-3 bg-[#101A15] border-b border-[#26372D] flex items-center justify-between font-sans">
              <span className="font-bold text-[#F1F5F2] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                Resting Order Walls in Order Book ({activeWalls.length})
              </span>
              <span className="text-[11px] text-[#A1ADA5] font-mono">
                Preserved across algorithmic quote replenishments
              </span>
            </div>

            {activeWalls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[#647168] space-y-2">
                <Layers className="w-8 h-8 opacity-40 text-[#10B981]" />
                <p className="text-xs font-semibold text-[#F1F5F2]">No active order walls currently deployed.</p>
                <p className="text-[11px] text-[#A1ADA5] max-w-md text-center">
                  Deploy a Buy Wall (Support) or Sell Wall (Resistance) using the form below to protect a price level.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left tabular-nums">
                  <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] font-sans">
                    <tr>
                      <th className="py-2.5 px-3.5 font-medium">Time</th>
                      <th className="py-2.5 px-3.5 font-medium">Pair</th>
                      <th className="py-2.5 px-3.5 font-medium">Type</th>
                      <th className="py-2.5 px-3.5 font-medium text-right">Wall Price</th>
                      <th className="py-2.5 px-3.5 font-medium text-right">Remaining Amount</th>
                      <th className="py-2.5 px-3.5 font-medium text-right">Total (IDR)</th>
                      <th className="py-2.5 px-3.5 font-medium text-center font-sans">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#26372D]/60 font-mono">
                    {activeWalls.map((wall) => (
                      <tr key={wall.id} className="hover:bg-[#192820]/60 transition-colors">
                        <td className="py-2.5 px-3.5 text-[#A1ADA5] whitespace-nowrap text-[11px]">
                          {formatDateTime(wall.createdAt)}
                        </td>
                        <td className="py-2.5 px-3.5 font-bold text-[#F1F5F2]">{wall.pair}</td>
                        <td className="py-2.5 px-3.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-sans ${
                              wall.side === 'buy'
                                ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30'
                                : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                            }`}
                          >
                            {wall.side === 'buy' ? 'SUPPORT (BUY WALL)' : 'RESISTANCE (SELL WALL)'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-bold text-[#F1F5F2]">
                          {formatIDR(wall.price)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right text-[#A1ADA5]">
                          {formatCrypto(wall.remainingAmount)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right text-[#34D399] font-medium">
                          {formatIDR(wall.remainingAmount * wall.price)}
                        </td>
                        <td className="py-2.5 px-3.5 text-center font-sans">
                          <button
                            type="button"
                            onClick={() => handleCancelWall(wall.id)}
                            className="px-3 py-1 bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/40 rounded-lg text-xs font-semibold transition-colors"
                          >
                            Cancel Wall
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Wall Deployer Form */}
          <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#26372D]">
              <span className="font-bold text-sm text-[#F1F5F2] flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-[#10B981]" />
                Deploy New Support / Resistance Order Wall
              </span>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#A1ADA5]">Target Pair:</span>
                <select
                  value={wallPairId}
                  onChange={(e) => {
                    const pId = e.target.value;
                    setWallPairId(pId);
                    const p = markets.find((m) => m.id === pId) || markets[0];
                    setWallBuyPrice(Math.round(p.lastPrice * 0.97));
                    setWallSellPrice(Math.round(p.lastPrice * 1.03));
                  }}
                  className="bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg px-2.5 py-1 text-xs font-semibold text-[#F1F5F2]"
                >
                  {markets.map((m) => (
                    <option key={m.id} value={m.id} className="bg-[#101A15] text-[#F1F5F2]">
                      {m.id} (Mark: {formatIDR(m.lastPrice)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Buy Wall Deployer */}
              <div className="p-4 rounded-xl bg-[#101A15] border border-[#10B981]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#10B981] flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" />
                    Deploy Support Wall (Buy)
                  </span>
                  <span className="text-[10px] text-[#34D399] font-mono">Bids Floor</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-[#A1ADA5] block mb-1">Price (IDR)</label>
                    <input
                      type="number"
                      value={wallBuyPrice}
                      onChange={(e) => setWallBuyPrice(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg px-2.5 py-1.5 font-mono text-[#F1F5F2] text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#A1ADA5] block mb-1">
                      Quantity ({wallPair.baseAsset})
                    </label>
                    <input
                      type="number"
                      value={wallBuyQty}
                      onChange={(e) => setWallBuyQty(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg px-2.5 py-1.5 font-mono text-[#F1F5F2] text-xs tabular-nums"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-[#A1ADA5] flex justify-between font-mono tabular-nums">
                  <span>Approx Value:</span>
                  <span className="text-[#34D399] font-bold">{formatIDR(wallBuyPrice * wallBuyQty)}</span>
                </div>
                <button
                  type="button"
                  onClick={handleDeployBuyWall}
                  className="w-full py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg text-xs transition-colors"
                >
                  Deploy Buy Wall
                </button>
              </div>

              {/* Sell Wall Deployer */}
              <div className="p-4 rounded-xl bg-[#101A15] border border-[#EF6464]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#EF6464] flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4" />
                    Deploy Resistance Wall (Sell)
                  </span>
                  <span className="text-[10px] text-[#EF6464] font-mono">Asks Ceiling</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-[#A1ADA5] block mb-1">Price (IDR)</label>
                    <input
                      type="number"
                      value={wallSellPrice}
                      onChange={(e) => setWallSellPrice(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg px-2.5 py-1.5 font-mono text-[#F1F5F2] text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#A1ADA5] block mb-1">
                      Quantity ({wallPair.baseAsset})
                    </label>
                    <input
                      type="number"
                      value={wallSellQty}
                      onChange={(e) => setWallSellQty(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-[#142019] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg px-2.5 py-1.5 font-mono text-[#F1F5F2] text-xs tabular-nums"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-[#A1ADA5] flex justify-between font-mono tabular-nums">
                  <span>Approx Value:</span>
                  <span className="text-[#EF6464] font-bold">{formatIDR(wallSellPrice * wallSellQty)}</span>
                </div>
                <button
                  type="button"
                  onClick={handleDeploySellWall}
                  className="w-full py-2 bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] font-bold rounded-lg text-xs transition-colors"
                >
                  Deploy Sell Wall
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Section 4: Precision CLOB Calibrator & Real Order Book Preview */}
      {activeSection === 'precision' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Form Fields */}
          <form onSubmit={handleManualInject} className="lg:col-span-7 bg-[#142019] border border-[#26372D] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#26372D]">
              <span className="text-xs font-bold text-[#F1F5F2] uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#10B981]" />
                Precision CLOB Parameters
              </span>
              <span className="text-[11px] font-mono text-[#34D399] tabular-nums">
                Total Orders: {depthLevels * 2} ({depthLevels} Bids / {depthLevels} Asks)
              </span>
            </div>

            {/* Trading Pair */}
            <div>
              <label className="block text-xs font-semibold text-[#A1ADA5] mb-1 flex items-center justify-between">
                <span>Trading Pair (Market)</span>
                <span className="text-[11px] font-mono text-[#34D399] tabular-nums">
                  Mark: {formatIDR(selectedPair.lastPrice)}
                </span>
              </label>
              <select
                value={selectedPairId}
                onChange={(e) => setSelectedPairId(e.target.value)}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] rounded-lg px-3 py-2 text-xs text-[#F1F5F2] outline-none font-semibold cursor-pointer"
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#101A15] text-[#F1F5F2]">
                    {m.id} — {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Spread % */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-[#A1ADA5] mb-1 tabular-nums">
                <span>Price Spread (%)</span>
                <span className="font-mono text-[#34D399] font-bold">{spreadPct}%</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0.05"
                  max="3.0"
                  step="0.05"
                  value={spreadPct}
                  onChange={(e) => setSpreadPct(parseFloat(e.target.value))}
                  className="flex-1 accent-[#10B981] h-1.5 bg-[#101A15] rounded-lg cursor-pointer"
                />
                <input
                  type="number"
                  step="0.05"
                  min="0.01"
                  max="10.0"
                  value={spreadPct}
                  onChange={(e) => setSpreadPct(Math.max(0.01, parseFloat(e.target.value) || 0.1))}
                  className="w-20 bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg px-2.5 py-1 text-xs text-right font-mono text-[#F1F5F2] tabular-nums"
                />
              </div>
            </div>

            {/* Amount Size */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-[#A1ADA5] mb-1 tabular-nums">
                <span>Order Amount Size ({selectedPair.baseAsset} per Level)</span>
                <span className="font-mono text-[#34D399] font-bold">
                  {formatCrypto(orderAmount)} {selectedPair.baseAsset}
                </span>
              </div>
              <input
                type="number"
                step={selectedPair.id.includes('BTC') ? '0.01' : '10'}
                min="0.0001"
                value={orderAmount}
                onChange={(e) => setOrderAmount(Math.max(0.0001, parseFloat(e.target.value) || 1))}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] rounded-lg px-3 py-2 text-xs font-mono text-[#F1F5F2] outline-none tabular-nums"
              />
            </div>

            {/* Depth Levels */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-[#A1ADA5] mb-1 tabular-nums">
                <span>Order Depth Levels (Per Side)</span>
                <span className="font-mono text-[#34D399] font-bold">{depthLevels} Levels</span>
              </div>
              <input
                type="range"
                min="3"
                max="20"
                step="1"
                value={depthLevels}
                onChange={(e) => setDepthLevels(parseInt(e.target.value, 10))}
                className="w-full accent-[#10B981] h-1.5 bg-[#101A15] rounded-lg cursor-pointer"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 py-2.5 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Inject Real Limit Quotes ({selectedPairId})</span>
              </button>

              <button
                type="button"
                onClick={() => setAutoLoopActive((v) => !v)}
                className={`px-3.5 py-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  autoLoopActive
                    ? 'bg-[#064E3B]/50 text-[#34D399] border-[#10B981]/40'
                    : 'bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] border-[#26372D]'
                }`}
              >
                {autoLoopActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{autoLoopActive ? 'Auto-Loop ON' : 'Auto-Loop OFF'}</span>
              </button>

              <button
                type="button"
                onClick={handleClearMMPair}
                className="px-3.5 py-2.5 rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                title="Wipe active MM quotes"
              >
                <Trash2 className="w-4 h-4" />
                <span>Wipe Quotes</span>
              </button>
            </div>
          </form>

          {/* Right Column: Live Book */}
          <div className="lg:col-span-5 bg-[#142019] border border-[#26372D] rounded-xl p-4 flex flex-col justify-between tabular-nums text-xs">
            <div>
              <div className="flex items-center justify-between pb-2.5 border-b border-[#26372D] mb-3 font-sans">
                <span className="font-bold text-[#F1F5F2] flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-[#10B981]" />
                  Live Order Book ({selectedPairId})
                </span>
                <span className="text-[10px] text-[#A1ADA5] font-mono">
                  Mid: {formatIDR(selectedPair.lastPrice)}
                </span>
              </div>

              {/* Asks (Sells) */}
              <div className="space-y-1 mb-2">
                <div className="text-[10px] text-[#647168] font-sans uppercase flex justify-between">
                  <span>Top Asks (Sells)</span>
                  <span>Amount / Total</span>
                </div>
                {currentPairBook.asks.slice(-6).map((ask, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center py-1 px-2 rounded bg-[#EF6464]/10 border-l-2 border-[#EF6464]/70 text-[11px] font-mono"
                  >
                    <span className="text-[#EF6464] font-semibold flex items-center gap-1">
                      {formatIDR(ask.price)}
                      {ask.isWall && (
                        <span className="text-[8px] px-1 bg-[#EAB866]/20 text-[#EAB866] rounded font-sans">
                          WALL
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[#F1F5F2]">{formatCrypto(ask.amount)}</span>
                      <span className="text-[#647168] text-[10px]">{formatCrypto(ask.total)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Spread Bar */}
              <div className="py-1.5 px-2.5 my-2 bg-[#101A15] border-y border-[#26372D] flex justify-between items-center text-[10.5px]">
                <span className="text-[#A1ADA5] font-sans flex items-center gap-1">
                  <span>Spread:</span>
                  <span className="font-mono text-[#F1F5F2]">{formatIDR(currentPairBook.spread)}</span>
                </span>
                <span className="text-[#34D399] font-bold font-mono">
                  {currentPairBook.spreadPercent}%
                </span>
              </div>

              {/* Bids (Buys) */}
              <div className="space-y-1">
                <div className="text-[10px] text-[#647168] font-sans uppercase flex justify-between">
                  <span>Top Bids (Buys)</span>
                  <span>Amount / Total</span>
                </div>
                {currentPairBook.bids.slice(0, 6).map((bid, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center py-1 px-2 rounded bg-[#10B981]/10 border-l-2 border-[#10B981]/70 text-[11px] font-mono"
                  >
                    <span className="text-[#10B981] font-semibold flex items-center gap-1">
                      {formatIDR(bid.price)}
                      {bid.isWall && (
                        <span className="text-[8px] px-1 bg-[#EAB866]/20 text-[#EAB866] rounded font-sans">
                          WALL
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[#F1F5F2]">{formatCrypto(bid.amount)}</span>
                      <span className="text-[#647168] text-[10px]">{formatCrypto(bid.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-[#26372D] text-[10.5px] text-[#A1ADA5] font-sans mt-3 space-y-1">
              <div className="flex items-center gap-1 text-[#10B981] font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Real CLOB Matching Engine</span>
              </div>
              <div>
                All quotes generated by MM are genuine Limit Orders in the CLOB matching with user orders with price-time priority.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface DedicatedPairBotCardProps {
  pair: MarketPair;
  botConfig: PairMMBotConfig;
  isBotRunning: boolean;
  isEmergencyStopped: boolean;
  pairBotOrdersCount: number;
  quantConsoleOrdersCount: number;
  pairWallsCount: number;
  onToggle: (nextState: boolean) => void;
  onUpdateParams: (updates: Partial<PairMMBotConfig>) => void;
  onReplenish: () => void;
  onClearQuotes: () => void;
  onActivateMarket: () => void;
}

const DedicatedPairBotCard: React.FC<DedicatedPairBotCardProps> = ({
  pair,
  botConfig,
  isBotRunning,
  isEmergencyStopped,
  pairBotOrdersCount,
  quantConsoleOrdersCount,
  pairWallsCount,
  onToggle,
  onUpdateParams,
  onReplenish,
  onClearQuotes,
  onActivateMarket,
}) => {
  const [spreadText, setSpreadText] = useState<string>(String(botConfig.targetSpreadBps));
  const [levelsText, setLevelsText] = useState<string>(String(botConfig.levelsPerSide));
  const [qtyText, setQtyText] = useState<string>(String(botConfig.baseAmountPerLevel));
  const [tickText, setTickText] = useState<string>(String(botConfig.tickSize || 25));

  useEffect(() => {
    setSpreadText(String(botConfig.targetSpreadBps));
  }, [botConfig.targetSpreadBps]);

  useEffect(() => {
    setLevelsText(String(botConfig.levelsPerSide));
  }, [botConfig.levelsPerSide]);

  useEffect(() => {
    setQtyText(String(botConfig.baseAmountPerLevel));
  }, [botConfig.baseAmountPerLevel]);

  useEffect(() => {
    setTickText(String(botConfig.tickSize || 25));
  }, [botConfig.tickSize]);

  const parsedSpread = Number(spreadText);
  const parsedLevels = Number(levelsText);
  const parsedQty = Number(qtyText);
  const parsedTick = Number(tickText);

  const isDirty =
    (Number.isFinite(parsedSpread) && parsedSpread !== botConfig.targetSpreadBps) ||
    (Number.isFinite(parsedLevels) && parsedLevels !== botConfig.levelsPerSide) ||
    (Number.isFinite(parsedQty) && parsedQty !== botConfig.baseAmountPerLevel) ||
    (Number.isFinite(parsedTick) && parsedTick !== (botConfig.tickSize || 25));

  const commitDraftParams = () => {
    const safeSpread =
      Number.isFinite(parsedSpread) && parsedSpread >= 1
        ? Math.min(2500, Math.round(parsedSpread))
        : botConfig.targetSpreadBps;
    const safeLevels =
      Number.isFinite(parsedLevels) && parsedLevels >= 1
        ? Math.max(1, Math.min(25, Math.round(parsedLevels)))
        : botConfig.levelsPerSide;
    const minAmt = pair.minOrderAmount || 0.0001;
    const safeQty =
      Number.isFinite(parsedQty) && parsedQty > 0
        ? Math.max(minAmt, parsedQty)
        : botConfig.baseAmountPerLevel;
    const safeTick =
      Number.isFinite(parsedTick) && parsedTick >= 1
        ? Math.round(parsedTick)
        : botConfig.tickSize || 25;

    setSpreadText(String(safeSpread));
    setLevelsText(String(safeLevels));
    setQtyText(String(safeQty));
    setTickText(String(safeTick));

    if (
      safeSpread !== botConfig.targetSpreadBps ||
      safeLevels !== botConfig.levelsPerSide ||
      safeQty !== botConfig.baseAmountPerLevel ||
      safeTick !== (botConfig.tickSize || 25)
    ) {
      onUpdateParams({
        targetSpreadBps: safeSpread,
        levelsPerSide: safeLevels,
        baseAmountPerLevel: safeQty,
        tickSize: safeTick,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraftParams();
    }
  };

  const displaySpreadBps = Number.isFinite(parsedSpread) && parsedSpread > 0 ? parsedSpread : botConfig.targetSpreadBps;

  return (
    <div
      className={`rounded-md p-4 border transition-colors ${
        isBotRunning && pair.isActive
          ? 'border-[#10B981]/40 bg-[#192820]'
          : 'border-[#26372D] bg-[#142019]'
      }`}
    >
      {/* Card Header: Pair info and toggle */}
      <div className="flex items-center justify-between pb-3 border-b border-[#26372D] gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded bg-[#101A15] border border-[#26372D] flex items-center justify-center font-semibold text-xs text-[#F1F5F2] shrink-0">
            {pair.baseAsset.slice(0, 3)}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-[#F1F5F2] flex flex-wrap items-center gap-1.5">
              <span>{pair.id}</span>
              {pair.id === 'DNA/IDR' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/30 font-mono">
                  TEST COIN
                </span>
              )}
              {!pair.isActive && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#EAB866]/10 text-[#EAB866] border border-[#EAB866]/30 font-mono">
                  MARKET CLOSED
                </span>
              )}
              {isEmergencyStopped && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#EF6464]/10 text-[#EF6464] border border-[#EF6464]/30 font-mono">
                  E-STOP
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#A1ADA5] truncate">
              Last: {formatIDR(pair.lastPrice)}
            </div>
          </div>
        </div>

        {/* Enable / Stop Bot Toggle */}
        <button
          type="button"
          onClick={() => {
            if (isDirty) commitDraftParams();
            onToggle(!isBotRunning);
          }}
          className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 ${
            isBotRunning
              ? 'bg-[#064E3B] hover:bg-[#10B981]/25 text-[#34D399] border border-[#10B981]/40'
              : 'bg-[#EF6464]/10 hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/30'
          }`}
        >
          {isBotRunning ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
              <span>RUNNING</span>
            </>
          ) : (
            <>
              <Square className="w-3 h-3 fill-[#EF6464] text-[#EF6464]" />
              <span>STOPPED</span>
            </>
          )}
        </button>
      </div>

      {/* Market Closed Warning Banner */}
      {!pair.isActive && (
        <div className="mt-3 p-2 rounded bg-[#EAB866]/10 border border-[#EAB866]/30 flex items-center justify-between gap-2 text-[11px] text-[#EAB866]">
          <span>Market pair sedang nonaktif / pre-launch.</span>
          <button
            type="button"
            onClick={onActivateMarket}
            className="px-2 py-0.5 rounded bg-[#EAB866] hover:bg-[#EAB866]/90 text-[#0B100E] font-semibold text-[10px] whitespace-nowrap shrink-0 transition-colors"
          >
            Open Market
          </button>
        </div>
      )}

      {/* Bot Parameters (Free-typing draft inputs + Enter/Blur/Apply commit) */}
      <div className="py-3 space-y-2.5 text-xs tabular-nums">
        <div className="flex items-center justify-between text-[#F1F5F2]">
          <span className="text-[#A1ADA5] text-[11px] font-sans">Target Spread:</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              step="1"
              value={spreadText}
              onChange={(e) => setSpreadText(e.target.value)}
              onBlur={commitDraftParams}
              onKeyDown={handleKeyDown}
              aria-label={`Target Spread bps for ${pair.id}`}
              className="w-16 bg-[#101A15] border border-[#26372D] focus:border-[#10B981] focus:outline-none rounded px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-[#34D399]"
            />
            <span className="text-[11px] font-mono tabular-nums text-[#A1ADA5]">
              bps ({(displaySpreadBps / 100).toFixed(2)}%)
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[#F1F5F2]">
          <span className="text-[#A1ADA5] text-[11px] font-sans">Depth Levels / Side:</span>
          <input
            type="number"
            min="1"
            max="25"
            step="1"
            value={levelsText}
            onChange={(e) => setLevelsText(e.target.value)}
            onBlur={commitDraftParams}
            onKeyDown={handleKeyDown}
            aria-label={`Depth Levels for ${pair.id}`}
            className="w-16 bg-[#101A15] border border-[#26372D] focus:border-[#10B981] focus:outline-none rounded px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-[#F1F5F2]"
          />
        </div>

        <div className="flex items-center justify-between text-[#F1F5F2]">
          <span className="text-[#A1ADA5] text-[11px] font-sans">Base Qty / Level ({pair.baseAsset}):</span>
          <input
            type="number"
            min={pair.minOrderAmount || 0.0001}
            step="any"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={commitDraftParams}
            onKeyDown={handleKeyDown}
            aria-label={`Base Qty for ${pair.id}`}
            className="w-24 bg-[#101A15] border border-[#26372D] focus:border-[#10B981] focus:outline-none rounded px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-[#F1F5F2]"
          />
        </div>

        <div className="flex items-center justify-between text-[#F1F5F2]">
          <span className="text-[#A1ADA5] text-[11px] font-sans">Tick Size (IDR):</span>
          <input
            type="number"
            min="1"
            step="1"
            value={tickText}
            onChange={(e) => setTickText(e.target.value)}
            onBlur={commitDraftParams}
            onKeyDown={handleKeyDown}
            aria-label={`Tick Size for ${pair.id}`}
            className="w-24 bg-[#101A15] border border-[#26372D] focus:border-[#10B981] focus:outline-none rounded px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-[#F1F5F2]"
          />
        </div>

        {/* Stats & Order Counts */}
        <div className="pt-2 border-t border-[#26372D] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[#A1ADA5] font-sans">
            <span>Pair Bot Quotes:</span>
            <span className="font-mono tabular-nums text-[#F1F5F2] font-semibold">{pairBotOrdersCount} orders</span>
          </div>
          {quantConsoleOrdersCount > 0 && (
            <div className="flex items-center justify-between text-[11px] text-[#EAB866] font-sans">
              <span>Quant Console Quotes:</span>
              <span className="font-mono tabular-nums font-semibold">{quantConsoleOrdersCount} orders</span>
            </div>
          )}
          {pairWallsCount > 0 && (
            <div className="flex items-center justify-between text-[11px] text-[#60A5FA] font-sans">
              <span>Active Walls:</span>
              <span className="font-mono tabular-nums font-semibold text-[#EAB866]">{pairWallsCount} walls</span>
            </div>
          )}
        </div>
      </div>

      {/* Card Actions */}
      <div className="pt-3 border-t border-[#26372D] flex flex-wrap items-center gap-2">
        {isBotRunning ? (
          <button
            type="button"
            onClick={() => onToggle(false)}
            className="px-3 py-1.5 rounded bg-[#EF6464]/10 hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/30 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
          >
            <Square className="w-3 h-3 fill-[#EF6464] text-[#EF6464]" />
            <span>Stop Bot</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (isDirty) commitDraftParams();
              onToggle(true);
            }}
            className="px-3 py-1.5 rounded bg-[#10B981]/15 hover:bg-[#10B981]/25 text-[#34D399] border border-[#10B981]/30 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
          >
            <Play className="w-3 h-3 fill-[#34D399] text-[#34D399]" />
            <span>Start Bot</span>
          </button>
        )}

        {isDirty && (
          <button
            type="button"
            onClick={commitDraftParams}
            className="px-2.5 py-1.5 rounded bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
          >
            <Check className="w-3 h-3" />
            <span>Apply</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (isDirty) commitDraftParams();
            onReplenish();
          }}
          className="flex-1 py-1.5 rounded bg-[#101A15] hover:bg-[#192820] text-xs font-semibold text-[#34D399] border border-[#26372D] flex items-center justify-center gap-1 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Replenish</span>
        </button>
        <button
          type="button"
          onClick={onClearQuotes}
          className="p-1.5 rounded bg-[#EF6464]/10 hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/30 transition-colors"
          title={`Clear MM Quotes for ${pair.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
