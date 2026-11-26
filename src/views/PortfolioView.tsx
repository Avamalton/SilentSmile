import React, { useState } from 'react';
import { useRouter } from '../router';
import { useSimulation } from '../simulation/store';
import { ASSETS } from '../simulation/constants';
import { formatIDR, formatCrypto } from '../utils/formatters';
import { useTranslation } from '../utils/i18n';
import {
  Wallet,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownLeft,
  PlusCircle,
  TrendingUp,
  Lock,
  Coins,
  Check,
  Users,
  Building2,
  QrCode,
  Copy,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { DepositModal } from '../components/wallet/DepositModal';
import { WithdrawModal } from '../components/wallet/WithdrawModal';

export const PortfolioView: React.FC = () => {
  const { navigate } = useRouter();
  const { t } = useTranslation();
  const {
    currentUser,
    allUsers,
    switchUser,
    balances,
    markets,
    portfolioValueIDR,
    unrealizedPnL,
    depositVirtualFaucet,
    selectPair,
  } = useSimulation();

  // Faucet Modal state
  const [faucetOpen, setFaucetOpen] = useState(false);
  const [faucetAsset, setFaucetAsset] = useState('IDR');
  const [faucetAmount, setFaucetAmount] = useState('100000000');
  const [faucetSuccess, setFaucetSuccess] = useState(false);

  // Deposit & Withdrawal Modal state (Multi-Chain & Initial Listing Connected)
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [activeModalAsset, setActiveModalAsset] = useState<string>('USDT');

  // Compute holdings breakdown with valuations and percentages
  const holdings = Object.values(balances).map((b) => {
    const assetMeta = ASSETS[b.asset] || {
      name: b.asset,
      decimals: 2,
      color: '#94A3B8',
    };

    let markPrice = 1;
    if (b.asset !== 'IDR') {
      const pair = markets.find((m) => m.baseAsset === b.asset && m.quoteAsset === 'IDR');
      markPrice = pair ? pair.lastPrice : 0;
    }

    const valueIDR = b.total * markPrice;
    const allocationPct = portfolioValueIDR > 0 ? (valueIDR / portfolioValueIDR) * 100 : 0;

    return {
      ...b,
      name: assetMeta.name,
      decimals: assetMeta.decimals,
      color: assetMeta.color,
      markPrice,
      valueIDR,
      allocationPct,
    };
  });

  holdings.sort((a, b) => b.valueIDR - a.valueIDR);

  const totalLockedIDR = holdings.reduce((acc, h) => acc + h.locked * h.markPrice, 0);
  const totalFreeIDR = balances['IDR']?.free || 0;

  const handleClaimFaucet = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(faucetAmount);
    if (amt > 0) {
      depositVirtualFaucet(faucetAsset, amt);
      setFaucetSuccess(true);
      setTimeout(() => {
        setFaucetSuccess(false);
        setFaucetOpen(false);
      }, 1200);
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto">
      {/* 1. Portfolio Header & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
            {t('wallet_title')}
            <span className="text-xs px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-mono">
              Live Double-Entry Ledger
            </span>
          </h1>
          <p className="text-xs text-[#A1ADA5] mt-0.5">{t('wallet_desc')}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Deposit Button */}
          <button
            onClick={() => {
              setActiveModalAsset('USDT');
              setDepositOpen(true);
            }}
            className="px-3.5 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold rounded-lg text-xs flex items-center gap-2 transition-colors"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>{t('deposit')}</span>
          </button>

          {/* Withdraw Button */}
          <button
            onClick={() => {
              setActiveModalAsset('USDT');
              setWithdrawOpen(true);
            }}
            className="px-3.5 py-2 bg-[#142019] hover:bg-[#192820] text-[#EF6464] border border-[#EF6464]/35 font-semibold rounded-lg text-xs flex items-center gap-2 transition-colors"
          >
            <ArrowUpRight className="w-4 h-4 text-[#EF6464]" />
            <span>{t('withdraw')}</span>
          </button>

          {/* Faucet Button */}
          <button
            onClick={() => setFaucetOpen(true)}
            className="px-3 py-2 bg-[#142019] hover:bg-[#192820] text-[#34D399] border border-[#26372D] hover:border-[#10B981]/40 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
          >
            <PlusCircle className="w-4 h-4 text-[#10B981]" />
            <span className="hidden sm:inline">Demo Faucet</span>
          </button>
        </div>
      </div>

      {/* Multi-Account Real Exchange Test Switcher */}
      <div className="glass-panel rounded-xl p-4 border border-[#26372D]">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#26372D]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.name}
                className="w-10 h-10 rounded-full border-2 border-[#10B981] object-cover"
              />
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#10B981] border-2 border-[#101A15] rounded-full"></span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#F1F5F2]">{currentUser.name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-medium">
                  {currentUser.tier || (currentUser.role === 'admin' ? 'Administrator' : 'Trader')}
                </span>
                {currentUser.role === 'admin' && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#192820] text-[#60A5FA] border border-[#26372D] font-semibold">
                    Admin Privileges
                  </span>
                )}
              </div>
              <div className="text-xs text-[#A1ADA5]">{currentUser.email} • Distinct Isolated Portfolio</div>
            </div>
          </div>

          <div className="text-xs text-[#A1ADA5] flex items-center gap-1.5 font-medium">
            <Users className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Exchange Account Switcher (Real Sandbox):</span>
          </div>
        </div>

        {/* Account Selection Chips */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3">
          {allUsers.map((user) => {
            const isActive = user.id === currentUser.id;
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => switchUser(user.id)}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                  isActive
                    ? 'bg-[#064E3B]/40 border-[#10B981]/50'
                    : 'bg-[#101A15] border-[#26372D] hover:border-[#10B981]/30 hover:bg-[#192820]'
                }`}
              >
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className={`w-8 h-8 rounded-full object-cover shrink-0 ${
                    isActive ? 'border border-[#10B981]' : 'opacity-75'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold truncate ${isActive ? 'text-[#34D399]' : 'text-[#F1F5F2]'}`}>
                      {user.name}
                    </span>
                    {isActive && (
                      <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0"></span>
                    )}
                  </div>
                  <div className="text-[10px] text-[#A1ADA5] truncate">
                    {user.tier || (user.role === 'admin' ? 'Exchange Admin' : 'Trader')}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mandatory Prominent Non-Real Disclaimer */}
      <div className="p-3 rounded-xl bg-[#EAB866]/10 border border-[#EAB866]/25 text-xs text-[#EAB866] flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 text-[#EAB866] shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Demo portfolio only: </span>
          Semua nominal dan transaksi dijalankan pada simulasi ledger ganda tertutup tanpa risiko aset riil.
        </div>
      </div>

      {/* 2. Top Metric KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-panel rounded-xl p-4">
          <span className="text-xs text-[#A1ADA5] flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-[#10B981]" /> Total Simulated Value
          </span>
          <div className="text-xl font-bold font-mono text-[#F1F5F2] mt-2 tabular-nums">
            {formatIDR(portfolioValueIDR)}
          </div>
          <div className="text-[11px] text-[#647168] mt-0.5">Mark-to-market spot IDR</div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <span className="text-xs text-[#A1ADA5] flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-[#10B981]" /> Available Virtual IDR
          </span>
          <div className="text-xl font-bold font-mono text-[#34D399] mt-2 tabular-nums">
            {formatIDR(totalFreeIDR)}
          </div>
          <div className="text-[11px] text-[#647168] mt-0.5">Unencumbered purchasing power</div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <span className="text-xs text-[#A1ADA5] flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-[#EAB866]" /> Locked in Open Orders
          </span>
          <div className="text-xl font-bold font-mono text-[#EAB866] mt-2 tabular-nums">
            {formatIDR(totalLockedIDR)}
          </div>
          <div className="text-[11px] text-[#647168] mt-0.5">Reserved by pending limit orders</div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <span className="text-xs text-[#A1ADA5] flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-[#10B981]" /> Simulated Unrealized P&L
          </span>
          <div className="text-xl font-bold font-mono text-[#10B981] mt-2 flex items-center gap-1 tabular-nums">
            <ArrowUpRight className="w-4 h-4 text-[#10B981]" />
            +{formatIDR(unrealizedPnL)}
          </div>
          <div className="text-[11px] text-[#34D399] font-mono mt-0.5 tabular-nums">+4.2% Simulated ROI</div>
        </div>
      </div>

      {/* 3. Asset Allocation and Holdings Breakdown Table */}
      <div className="glass-panel rounded-xl p-5 border border-[#26372D]">
        <h2 className="text-sm font-bold text-[#F1F5F2] mb-3">Rincian Saldo Akun (Ledger Breakdown)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#26372D] text-[#A1ADA5] text-left">
                <th className="pb-2.5 font-medium">Aset</th>
                <th className="pb-2.5 font-medium">Tersedia (Available)</th>
                <th className="pb-2.5 font-medium">Terkunci Pesanan (Locked)</th>
                <th className="pb-2.5 font-medium">Total Saldo</th>
                <th className="pb-2.5 font-medium">Nilai IDR</th>
                <th className="pb-2.5 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#26372D]/50 font-mono">
              {holdings.map((h) => (
                <tr key={h.asset} className="hover:bg-[#192820] transition-colors">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: h.color }}></span>
                      <strong className="text-[#F1F5F2] font-sans">{h.asset}</strong>
                      <span className="text-[11px] text-[#647168] font-sans hidden sm:inline">{h.name}</span>
                    </div>
                  </td>
                  <td className="py-3 text-[#34D399] tabular-nums">
                    {h.asset === 'IDR' ? formatIDR(h.free) : formatCrypto(h.free, h.decimals)}
                  </td>
                  <td className="py-3 text-[#EAB866] tabular-nums">
                    {h.asset === 'IDR' ? formatIDR(h.locked) : formatCrypto(h.locked, h.decimals)}
                  </td>
                  <td className="py-3 text-[#F1F5F2] font-bold tabular-nums">
                    {h.asset === 'IDR' ? formatIDR(h.total) : formatCrypto(h.total, h.decimals)}
                  </td>
                  <td className="py-3 text-[#34D399] font-sans tabular-nums">
                    {formatIDR(h.valueIDR)}
                  </td>
                  <td className="py-3 text-right font-sans">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => {
                          setActiveModalAsset(h.asset);
                          setDepositOpen(true);
                        }}
                        className="px-2 py-1 rounded bg-[#064E3B]/50 hover:bg-[#064E3B]/80 text-[#34D399] border border-[#10B981]/30 text-[11px] font-semibold transition-colors flex items-center gap-1"
                        title={`Setor ${h.asset}`}
                      >
                        <ArrowDownLeft className="w-3 h-3 text-[#10B981]" />
                        <span>Setor</span>
                      </button>
                      <button
                        onClick={() => {
                          setActiveModalAsset(h.asset);
                          setWithdrawOpen(true);
                        }}
                        className="px-2 py-1 rounded bg-[#EF6464]/10 hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/30 text-[11px] font-semibold transition-colors flex items-center gap-1"
                        title={`Tarik ${h.asset}`}
                      >
                        <ArrowUpRight className="w-3 h-3 text-[#EF6464]" />
                        <span>Tarik</span>
                      </button>
                      <button
                        onClick={() => {
                          const pair = markets.find((m) => m.baseAsset === h.asset && m.quoteAsset === 'IDR');
                          if (pair) {
                            selectPair(pair.id);
                            navigate('/trade');
                          }
                        }}
                        className="px-2 py-1 rounded bg-[#101A15] hover:bg-[#192820] text-[#34D399] border border-[#26372D] hover:border-[#10B981]/40 text-[11px] font-semibold transition-colors"
                      >
                        Trade
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Interactive Deposit Modal (Multi-Chain & Listing Connected) */}
      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        defaultAsset={activeModalAsset}
      />

      {/* 5. Interactive Withdrawal Modal (Multi-Chain & Listing Connected) */}
      <WithdrawModal
        isOpen={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        defaultAsset={activeModalAsset}
      />

      {/* 6. Virtual Faucet Modal */}
      {faucetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl p-5 bg-[#101A15] border border-[#26372D] shadow-2xl">
            <h3 className="text-sm font-semibold text-[#F1F5F2] flex items-center gap-2 mb-2">
              <PlusCircle className="w-4 h-4 text-[#10B981]" />
              Virtual Demonstration Faucet
            </h3>
            <p className="text-xs text-[#A1ADA5] mb-4">
              Instantly credit your virtual account with practice funds to test high-volume spot orders.
            </p>

            <form onSubmit={handleClaimFaucet} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[#A1ADA5] mb-1">
                  Choose Virtual Asset
                </label>
                <select
                  value={faucetAsset}
                  onChange={(e) => {
                    const ast = e.target.value;
                    setFaucetAsset(ast);
                    if (ast === 'IDR') setFaucetAmount('100000000');
                    else if (ast === 'BTC') setFaucetAmount('1');
                    else if (ast === 'ETH') setFaucetAmount('10');
                    else if (ast === 'SOL') setFaucetAmount('50');
                    else if (ast === 'DNA') setFaucetAmount('100000');
                    else setFaucetAmount('5000');
                  }}
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs text-[#F1F5F2] outline-none"
                >
                  <option value="IDR" className="bg-[#101A15]">Virtual IDR (Indonesian Rupiah)</option>
                  <option value="BTC" className="bg-[#101A15]">Simulated Bitcoin (BTC)</option>
                  <option value="ETH" className="bg-[#101A15]">Simulated Ethereum (ETH)</option>
                  <option value="SOL" className="bg-[#101A15]">Simulated Solana (SOL)</option>
                  <option value="DNA" className="bg-[#101A15]">Denata Network (DNA Local Token)</option>
                  <option value="USDT" className="bg-[#101A15]">Simulated Tether (USDT)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#A1ADA5] mb-1">
                  Amount to Credit
                </label>
                <input
                  type="number"
                  step="any"
                  value={faucetAmount}
                  onChange={(e) => setFaucetAmount(e.target.value)}
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono text-[#F1F5F2] outline-none"
                  required
                />
              </div>

              {faucetSuccess && (
                <div className="p-2 rounded bg-[#064E3B]/40 text-[#34D399] border border-[#10B981]/30 text-xs flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-[#10B981]" />
                  Successfully credited demo balance!
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFaucetOpen(false)}
                  className="flex-1 py-2 text-xs text-[#A1ADA5] hover:text-[#F1F5F2] bg-[#142019] border border-[#26372D] rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-xs font-semibold bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] rounded-lg"
                >
                  Claim Virtual Funds
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
