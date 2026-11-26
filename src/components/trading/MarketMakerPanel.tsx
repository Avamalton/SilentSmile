import React, { useState } from 'react';
import { useSimulation } from '../../simulation/store';
import { formatIDR, formatCrypto, safeRound } from '../../utils/formatters';
import {
  Bot,
  Sliders,
  ShieldAlert,
  RotateCcw,
  Layers,
  Sparkles,
  Check,
  Zap,
  TrendingDown,
  TrendingUp,
  Trash2,
} from 'lucide-react';

export const MarketMakerPanel: React.FC = () => {
  const {
    activePair,
    orderBook,
    mmConfig,
    updateMMConfig,
    replenishLiquidity,
    clearMMOrders,
    injectOrderWall,
    cancelOrderWall,
    clearAllWalls,
    restingOrders,
  } = useSimulation();

  const [spreadBps, setSpreadBps] = useState(mmConfig.targetSpreadBps.toString());
  const [levels, setLevels] = useState(mmConfig.levelsPerSide.toString());
  const [baseQty, setBaseQty] = useState(mmConfig.baseAmountPerLevel.toString());
  const [wallBuyPrice, setWallBuyPrice] = useState(
    mmConfig.wallBuyPrice ? mmConfig.wallBuyPrice.toString() : (activePair.lastPrice * 0.97).toFixed(0)
  );
  const [wallBuyQty, setWallBuyQty] = useState(
    mmConfig.wallBuyAmount ? mmConfig.wallBuyAmount.toString() : '25000'
  );
  const [wallSellPrice, setWallSellPrice] = useState(
    mmConfig.wallSellPrice ? mmConfig.wallSellPrice.toString() : (activePair.lastPrice * 1.03).toFixed(0)
  );
  const [wallSellQty, setWallSellQty] = useState(
    mmConfig.wallSellAmount ? mmConfig.wallSellAmount.toString() : '25000'
  );

  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Calculate total MM liquidity currently resting in the book
  const activePairOrders = restingOrders.filter((o) => o.pair === activePair.id);
  const mmOrders = activePairOrders.filter((o) => o.isMM);
  const userOrdersInBook = activePairOrders.filter((o) => !o.isMM);

  const totalBidLiquidityIDR = mmOrders
    .filter((o) => o.side === 'buy')
    .reduce((acc, o) => acc + o.remainingAmount * o.price, 0);

  const totalAskLiquidityBase = mmOrders
    .filter((o) => o.side === 'sell')
    .reduce((acc, o) => acc + o.remainingAmount, 0);

  const handleApplyConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const sBps = Math.max(5, parseInt(spreadBps) || 30);
    const lvls = Math.max(3, Math.min(25, parseInt(levels) || 10));
    const bQty = Math.max(1, parseFloat(baseQty) || 500);

    updateMMConfig({
      targetSpreadBps: sBps,
      levelsPerSide: lvls,
      baseAmountPerLevel: bQty,
      wallBuyPrice: parseFloat(wallBuyPrice) || 0,
      wallBuyAmount: parseFloat(wallBuyQty) || 0,
      wallSellPrice: parseFloat(wallSellPrice) || 0,
      wallSellAmount: parseFloat(wallSellQty) || 0,
    });

    replenishLiquidity();
    setSavedNotice('MM Liquidity Orders refreshed with new parameters.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const handleApplyPreset = (type: 'tight' | 'balanced' | 'deep') => {
    if (type === 'tight') {
      setSpreadBps('15');
      setLevels('14');
      setBaseQty((activePair.id.includes('DNA') ? 1200 : 0.5).toString());
      updateMMConfig({
        targetSpreadBps: 15,
        levelsPerSide: 14,
        baseAmountPerLevel: activePair.id.includes('DNA') ? 1200 : 0.5,
      });
    } else if (type === 'balanced') {
      setSpreadBps('35');
      setLevels('12');
      setBaseQty((activePair.id.includes('DNA') ? 750 : 0.25).toString());
      updateMMConfig({
        targetSpreadBps: 35,
        levelsPerSide: 12,
        baseAmountPerLevel: activePair.id.includes('DNA') ? 750 : 0.25,
      });
    } else {
      // deep
      setSpreadBps('60');
      setLevels('18');
      setBaseQty((activePair.id.includes('DNA') ? 2500 : 1.2).toString());
      updateMMConfig({
        targetSpreadBps: 60,
        levelsPerSide: 18,
        baseAmountPerLevel: activePair.id.includes('DNA') ? 2500 : 1.2,
      });
    }
    replenishLiquidity();
    setSavedNotice(`Applied ${type.toUpperCase()} Market Maker preset.`);
    setTimeout(() => setSavedNotice(null), 2000);
  };

  const handleInjectWall = (side: 'buy' | 'sell') => {
    if (side === 'buy') {
      const price = parseFloat(wallBuyPrice);
      const amount = parseFloat(wallBuyQty);
      if (price > 0 && amount > 0) {
        injectOrderWall('buy', price, amount);
        setSavedNotice(`Injected BUY Support Wall at Rp ${price.toLocaleString('id-ID')}!`);
      }
    } else {
      const price = parseFloat(wallSellPrice);
      const amount = parseFloat(wallSellQty);
      if (price > 0 && amount > 0) {
        injectOrderWall('sell', price, amount);
        setSavedNotice(`Injected SELL Resistance Wall at Rp ${price.toLocaleString('id-ID')}!`);
      }
    }
    setTimeout(() => setSavedNotice(null), 2500);
  };

  return (
    <div className="flex flex-col h-full w-full glass-panel rounded-xl p-3 text-xs overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#26372D] mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#064E3B]/50 border border-[#10B981]/30 text-[#10B981]">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#F1F5F2] flex items-center gap-1.5">
              Liquidity Market Maker
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#192820] text-[#34D399] border border-[#26372D] font-mono">
                {activePair.id}
              </span>
            </h3>
            <span className="text-[10px] text-[#A1ADA5]">Automated Order Book Depth & Spread Provider</span>
          </div>
        </div>

        {/* Enable / Disable MM Switch */}
        <button
          type="button"
          onClick={() => updateMMConfig({ enabled: !mmConfig.enabled })}
          className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-colors ${
            mmConfig.enabled
              ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40'
              : 'bg-[#101A15] text-[#647168] border border-[#26372D]'
          }`}
        >
          {mmConfig.enabled ? 'MM ACTIVE' : 'MM OFF'}
        </button>
      </div>

      {savedNotice && (
        <div className="p-2 mb-3 rounded-lg bg-[#064E3B]/40 text-[#34D399] border border-[#10B981]/30 text-[11px] flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Live Liquidity KPI Cards */}
      <div className="grid grid-cols-2 gap-2 mb-3 font-mono-nums">
        <div className="p-2 rounded-lg bg-[#101A15] border border-[#26372D]">
          <span className="text-[10px] text-[#A1ADA5] block font-sans">Resting Bid Liquidity</span>
          <span className="text-xs font-bold text-[#10B981] tabular-nums">
            {formatIDR(totalBidLiquidityIDR)}
          </span>
          <span className="text-[10px] text-[#647168] block tabular-nums">
            {mmOrders.filter((o) => o.side === 'buy').length} buy orders
          </span>
        </div>

        <div className="p-2 rounded-lg bg-[#101A15] border border-[#26372D]">
          <span className="text-[10px] text-[#A1ADA5] block font-sans">Resting Ask Liquidity</span>
          <span className="text-xs font-bold text-[#EF6464] tabular-nums">
            {formatCrypto(totalAskLiquidityBase)} {activePair.baseAsset}
          </span>
          <span className="text-[10px] text-[#647168] block tabular-nums">
            {mmOrders.filter((o) => o.side === 'sell').length} sell orders
          </span>
        </div>
      </div>

      {/* Quick Strategy Presets */}
      <div className="mb-3">
        <label className="block text-[10.5px] font-medium text-[#A1ADA5] mb-1.5">
          Market Making Strategy Presets:
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => handleApplyPreset('tight')}
            className="py-1 px-2 rounded bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#34D399] border border-[#26372D] text-[11px] font-mono transition-colors"
          >
            Tight Spread
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset('balanced')}
            className="py-1 px-2 rounded bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#34D399] border border-[#26372D] text-[11px] font-mono transition-colors"
          >
            Balanced MM
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset('deep')}
            className="py-1 px-2 rounded bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#34D399] border border-[#26372D] text-[11px] font-mono transition-colors"
          >
            Deep Book
          </button>
        </div>
      </div>

      {/* Configuration Form */}
      <form onSubmit={handleApplyConfig} className="space-y-3 font-mono-nums">
        <div className="grid grid-cols-2 gap-2">
          {/* Target Spread */}
          <div>
            <label className="block text-[10.5px] font-medium text-[#A1ADA5] mb-1 font-sans">
              Target Spread (bps)
            </label>
            <div className="relative">
              <input
                type="number"
                min="5"
                max="500"
                value={spreadBps}
                onChange={(e) => setSpreadBps(e.target.value)}
                className="w-full glass-input rounded-lg px-2.5 py-1.5 text-xs text-[#F1F5F2] outline-none"
              />
              <span className="absolute right-2.5 top-2 text-[10px] text-[#647168]">
                {(parseInt(spreadBps || '0') / 100).toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Depth Levels */}
          <div>
            <label className="block text-[10.5px] font-medium text-[#A1ADA5] mb-1 font-sans">
              Levels per Side
            </label>
            <input
              type="number"
              min="3"
              max="25"
              value={levels}
              onChange={(e) => setLevels(e.target.value)}
              className="w-full glass-input rounded-lg px-2.5 py-1.5 text-xs text-[#F1F5F2] outline-none"
            />
          </div>
        </div>

        {/* Base Amount per level */}
        <div>
          <label className="block text-[10.5px] font-medium text-[#A1ADA5] mb-1 font-sans">
            Base Qty per Level ({activePair.baseAsset})
          </label>
          <input
            type="number"
            step="any"
            value={baseQty}
            onChange={(e) => setBaseQty(e.target.value)}
            className="w-full glass-input rounded-lg px-2.5 py-1.5 text-xs text-[#F1F5F2] outline-none"
          />
        </div>

        {/* Churn Active Toggle */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-[#101A15] border border-[#26372D]">
          <div>
            <span className="text-[11px] font-semibold text-[#F1F5F2] block font-sans">
              Auto-Churn (Live Ticks)
            </span>
            <span className="text-[10px] text-[#A1ADA5] block font-sans">
              Simulates real trades & updates candlestick chart
            </span>
          </div>
          <button
            type="button"
            onClick={() => updateMMConfig({ churnEnabled: !mmConfig.churnEnabled })}
            className={`w-9 h-5 rounded-full transition-colors relative p-0.5 ${
              mmConfig.churnEnabled ? 'bg-[#10B981]' : 'bg-[#192820] border border-[#26372D]'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-[#F1F5F2] transition-transform ${
                mmConfig.churnEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Order Wall Injector */}
        <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] space-y-2">
          <span className="text-[11px] font-semibold text-[#34D399] block font-sans flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-[#10B981]" /> Order Wall Deployment
          </span>

          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
            {/* Buy Wall */}
            <div className="space-y-1">
              <span className="text-[#10B981] font-semibold block">BUY Support Wall</span>
              <input
                type="number"
                placeholder="Price"
                value={wallBuyPrice}
                onChange={(e) => setWallBuyPrice(e.target.value)}
                className="w-full glass-input rounded px-2 py-1 text-xs text-[#F1F5F2]"
              />
              <input
                type="number"
                placeholder="Amount"
                value={wallBuyQty}
                onChange={(e) => setWallBuyQty(e.target.value)}
                className="w-full glass-input rounded px-2 py-1 text-xs text-[#F1F5F2]"
              />
              <button
                type="button"
                onClick={() => handleInjectWall('buy')}
                className="w-full py-1 rounded bg-[#064E3B]/50 hover:bg-[#064E3B]/80 text-[#34D399] border border-[#10B981]/35 text-[10px] font-bold"
              >
                Inject Buy Wall
              </button>
            </div>

            {/* Sell Wall */}
            <div className="space-y-1">
              <span className="text-[#EF6464] font-semibold block">SELL Resistance Wall</span>
              <input
                type="number"
                placeholder="Price"
                value={wallSellPrice}
                onChange={(e) => setWallSellPrice(e.target.value)}
                className="w-full glass-input rounded px-2 py-1 text-xs text-[#F1F5F2]"
              />
              <input
                type="number"
                placeholder="Amount"
                value={wallSellQty}
                onChange={(e) => setWallSellQty(e.target.value)}
                className="w-full glass-input rounded px-2 py-1 text-xs text-[#F1F5F2]"
              />
              <button
                type="button"
                onClick={() => handleInjectWall('sell')}
                className="w-full py-1 rounded bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/35 text-[10px] font-bold"
              >
                Inject Sell Wall
              </button>
            </div>
          </div>
        </div>

        {/* Active Walls for this pair with Cancel buttons */}
        {restingOrders.filter((o) => o.pair === activePair.id && o.isWall).length > 0 && (
          <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] space-y-2">
            <div className="flex items-center justify-between text-[11px] text-[#34D399] font-semibold">
              <span>Active Order Walls ({restingOrders.filter((o) => o.pair === activePair.id && o.isWall).length})</span>
              <button
                type="button"
                onClick={() => clearAllWalls(activePair.id)}
                className="text-[10px] text-[#EF6464] hover:underline"
              >
                Clear All
              </button>
            </div>
            <div className="space-y-1.5 font-mono">
              {restingOrders
                .filter((o) => o.pair === activePair.id && o.isWall)
                .map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between p-1.5 rounded bg-[#142019] border border-[#26372D] text-[11px]"
                  >
                    <div>
                      <span className={w.side === 'buy' ? 'text-[#10B981] font-bold' : 'text-[#EF6464] font-bold'}>
                        {w.side.toUpperCase()}:
                      </span>{' '}
                      <span className="text-[#F1F5F2] tabular-nums">{formatCrypto(w.remainingAmount)}</span> @{' '}
                      <span className="text-[#34D399] tabular-nums">{formatIDR(w.price)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => cancelOrderWall(w.id)}
                      className="px-2 py-0.5 rounded bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/35 text-[10px] font-semibold"
                    >
                      Cancel Wall
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1 font-sans">
          <button
            type="submit"
            className="flex-1 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Apply & Replenish</span>
          </button>
          <button
            type="button"
            onClick={() => clearMMOrders()}
            className="p-2 rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/30 transition-colors"
            title="Clear all MM orders from the book"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
};
