import React from 'react';
import { useSimulation } from '../../simulation/store';
import { formatIDR, formatCrypto, formatDateTime } from '../../utils/formatters';
import { Vault, Coins, TrendingUp, ShieldCheck, ArrowDownRight, Layers } from 'lucide-react';

export const AdminFeeVaultPanel: React.FC = () => {
  const { adminFeeVault, markets } = useSimulation();

  return (
    <div className="flex flex-col gap-5">
      {/* Vault Hero Overview */}
      <div className="rounded-xl p-5 border border-[#10B981]/30 bg-[#142019]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center text-[#10B981]">
              <Vault className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-[#F1F5F2] tracking-tight">Exchange Treasury & Fee Vault</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30">
                  REAL-TIME ACCRUAL
                </span>
              </div>
              <p className="text-xs text-[#A1ADA5] mt-1 max-w-xl">
                All maker and taker trading fees collected from manual orders, liquidity fills, and automated trading flow directly into this authoritative vault in real time.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end bg-[#101A15] px-5 py-3 rounded-xl border border-[#10B981]/25">
            <span className="text-[11px] text-[#A1ADA5] uppercase tracking-wider font-semibold">
              Total Accrued Fee Revenue
            </span>
            <span className="text-2xl font-bold font-mono tabular-nums text-[#34D399]">
              {formatIDR(adminFeeVault.totalFeesIDR)}
            </span>
            <span className="text-[10px] text-[#10B981] font-mono mt-0.5 tabular-nums">
              Across {adminFeeVault.recentEvents.length} executed trade fills
            </span>
          </div>
        </div>
      </div>

      {/* Asset Allocation Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-xl border border-[#26372D] bg-[#142019]">
          <div className="text-[11px] font-medium text-[#A1ADA5] flex items-center gap-1.5 mb-1">
            <Coins className="w-3.5 h-3.5 text-[#10B981]" />
            <span>IDR Revenue</span>
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-[#F1F5F2]">
            {formatIDR(adminFeeVault.totalFeesIDR)}
          </div>
          <div className="text-[10px] text-[#647168] mt-0.5">Fiat Quote Fees</div>
        </div>

        {markets.map((m) => {
          const tokenAmount = adminFeeVault.feesByAsset[m.baseAsset] || 0;
          return (
            <div key={m.id} className="p-4 rounded-xl border border-[#26372D] bg-[#142019]">
              <div className="text-[11px] font-medium text-[#A1ADA5] flex items-center justify-between mb-1">
                <span>{m.baseAsset} Pool</span>
                <span className="text-[10px] text-[#60A5FA] font-mono">{m.id}</span>
              </div>
              <div className="text-base font-bold font-mono tabular-nums text-[#34D399]">
                {formatCrypto(tokenAmount, m.amountDecimals)} {m.baseAsset}
              </div>
              <div className="text-[10px] text-[#647168] mt-0.5 font-mono tabular-nums">
                Valued @ ~{formatIDR(tokenAmount * m.lastPrice)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Fee Settlement Stream */}
      <div className="rounded-xl border border-[#26372D] bg-[#142019] p-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#26372D] mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#10B981]" />
            <h3 className="text-sm font-bold text-[#F1F5F2]">Real-Time Fee Collection Stream</h3>
            <span className="text-[11px] text-[#A1ADA5] font-mono tabular-nums">
              ({adminFeeVault.recentEvents.length} events logged)
            </span>
          </div>
          <div className="text-[11px] font-mono text-[#A1ADA5] flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Cryptographically Verified In-Memory Ledger</span>
          </div>
        </div>

        {adminFeeVault.recentEvents.length === 0 ? (
          <div className="py-12 text-center text-[#647168] text-xs">
            No trade fees accrued yet. Submit an order or activate Auto-Trade / MM bot to view live fee collection.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[380px] overflow-y-auto rounded-lg border border-[#26372D]">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] sticky top-0">
                <tr>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Trade ID</th>
                  <th className="py-2.5 px-3">Pair</th>
                  <th className="py-2.5 px-3 text-right">Trade Volume</th>
                  <th className="py-2.5 px-3 text-right">Execution Price</th>
                  <th className="py-2.5 px-3 text-right text-[#10B981]">Maker Fee</th>
                  <th className="py-2.5 px-3 text-right text-[#60A5FA]">Taker Fee</th>
                  <th className="py-2.5 px-3 text-right font-bold text-[#34D399]">Total Vault Inflow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26372D]">
                {adminFeeVault.recentEvents.map((evt) => {
                  const totalFee = evt.makerFee + evt.takerFee;
                  return (
                    <tr key={evt.id} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2 px-3 text-[#A1ADA5] text-[11px]">
                        {formatDateTime(evt.timestamp)}
                      </td>
                      <td className="py-2 px-3 text-[#A1ADA5] font-mono text-[11px]">
                        {evt.tradeId.slice(-8)}
                      </td>
                      <td className="py-2 px-3 font-semibold text-[#F1F5F2]">{evt.pair}</td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2]">
                        {formatCrypto(evt.volume, 4)}
                      </td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2]">
                        {formatIDR(evt.price)}
                      </td>
                      <td className="py-2 px-3 text-right text-[#10B981] font-mono">
                        {formatIDR(evt.makerFee)}
                      </td>
                      <td className="py-2 px-3 text-right text-[#60A5FA] font-mono">
                        {formatIDR(evt.takerFee)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-[#34D399] font-mono">
                        +{formatIDR(totalFee)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
