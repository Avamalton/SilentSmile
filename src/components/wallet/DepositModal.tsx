import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  QrCode,
  ExternalLink,
  ShieldAlert,
  ArrowDownLeft,
  Clock,
  Sparkles,
  Info,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { AssetConfig, NetworkConfig, OnChainTransaction } from '../../simulation/assetNetworkTypes';
import { formatCrypto, formatIDR, formatDateTime } from '../../utils/formatters';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAsset?: string;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  defaultAsset = 'USDT',
}) => {
  const {
    currentUser,
    assetConfigs,
    initialListings,
    getDepositAddress,
    simulateCryptoDeposit,
    depositHistory,
  } = useSimulation();

  const [selectedAssetSymbol, setSelectedAssetSymbol] = useState<string>(defaultAsset);
  const [selectedNetworkId, setSelectedNetworkId] = useState<string>('');
  const [depositAmountInput, setDepositAmountInput] = useState<string>('');
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [activeTab, setActiveTab] = useState<'deposit' | 'history'>('deposit');

  // Simulation animation state
  const [isSimulating, setIsSimulating] = useState(false);
  const [simConfirmations, setSimConfirmations] = useState(0);
  const [simSuccessTx, setSimSuccessTx] = useState<OnChainTransaction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync defaultAsset when opened
  useEffect(() => {
    if (isOpen && defaultAsset) {
      setSelectedAssetSymbol(defaultAsset);
    }
  }, [isOpen, defaultAsset]);

  const currentAsset: AssetConfig | undefined = useMemo(() => {
    return assetConfigs.find((a) => a.symbol === selectedAssetSymbol) || assetConfigs[0];
  }, [assetConfigs, selectedAssetSymbol]);

  // Synchronize network selection when asset changes
  useEffect(() => {
    if (currentAsset && currentAsset.networks.length > 0) {
      const exists = currentAsset.networks.some((n) => n.networkId === selectedNetworkId);
      if (!exists) {
        setSelectedNetworkId(currentAsset.networks[0].networkId);
      }
    }
  }, [currentAsset, selectedNetworkId]);

  const currentNetwork: NetworkConfig | undefined = useMemo(() => {
    if (!currentAsset) return undefined;
    return currentAsset.networks.find((n) => n.networkId === selectedNetworkId) || currentAsset.networks[0];
  }, [currentAsset, selectedNetworkId]);

  // Connected Initial Listing check
  const linkedListing = useMemo(() => {
    if (!currentAsset?.listingId) return null;
    return initialListings.find((l) => l.id === currentAsset.listingId) || null;
  }, [currentAsset, initialListings]);

  // Check deposit availability (listing schedule & manual toggle)
  const depositAvailability = useMemo(() => {
    if (!currentAsset || !currentNetwork) {
      return { available: false, reason: 'Aset atau jaringan tidak valid.' };
    }

    if (currentAsset.depositStatus === 'CLOSED' || currentAsset.depositStatus === 'SUSPENDED') {
      return { available: false, reason: `Deposit ${currentAsset.symbol} saat ini ditangguhkan oleh pengelola exchange.` };
    }

    if (currentNetwork.depositStatus === 'CLOSED' || currentNetwork.depositStatus === 'SUSPENDED') {
      return { available: false, reason: `Deposit via jaringan ${currentNetwork.networkName} saat ini ditutup untuk pemeliharaan.` };
    }

    if (linkedListing) {
      if (linkedListing.deposit_status === 'CLOSED') {
        const opensAt = linkedListing.schedule.deposit_opens_at;
        const now = Date.now();
        if (opensAt > now) {
          const diffMs = opensAt - now;
          const hours = Math.floor(diffMs / 3600000);
          const mins = Math.floor((diffMs % 3600000) / 60000);
          return {
            available: false,
            reason: `Deposit ${currentAsset.symbol} dijadwalkan buka dalam ${hours}j ${mins}m (${new Date(opensAt).toLocaleTimeString('id-ID')}).`,
            opensAt,
          };
        }
        return { available: false, reason: `Deposit ${currentAsset.symbol} saat ini belum dibuka sesuai jadwal initial listing.` };
      }
    }

    return { available: true };
  }, [currentAsset, currentNetwork, linkedListing]);

  // Deterministic Address
  const depositAddressInfo = useMemo(() => {
    if (!currentAsset || !currentNetwork) return null;
    return getDepositAddress(currentAsset.symbol, currentNetwork.networkId, currentUser.id);
  }, [currentAsset, currentNetwork, getDepositAddress, currentUser.id]);

  const handleCopy = (text: string, type: 'addr' | 'memo') => {
    navigator.clipboard.writeText(text);
    if (type === 'addr') {
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 2000);
    } else {
      setCopiedMemo(true);
      setTimeout(() => setCopiedMemo(false), 2000);
    }
  };

  // Run On-chain Simulation
  const handleSimulateDeposit = async () => {
    if (!currentAsset || !currentNetwork || !depositAddressInfo) return;
    setErrorMessage(null);
    setSimSuccessTx(null);

    const amount = parseFloat(depositAmountInput);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage('Masukkan jumlah deposit simulasi yang valid.');
      return;
    }

    if (amount < currentNetwork.minDeposit) {
      setErrorMessage(`Deposit minimum untuk ${currentNetwork.networkName} adalah ${currentNetwork.minDeposit} ${currentAsset.symbol}.`);
      return;
    }

    setIsSimulating(true);
    setSimConfirmations(1);

    // Animate confirmations (e.g. 1 -> 6 -> required)
    const requiredConf = currentNetwork.depositConfirmations;
    const stepDuration = 350;

    const timer1 = setTimeout(() => {
      setSimConfirmations(Math.min(Math.floor(requiredConf / 2) + 1, requiredConf));
    }, stepDuration);

    const timer2 = setTimeout(async () => {
      setSimConfirmations(requiredConf);

      const res = await simulateCryptoDeposit({
        asset: currentAsset.symbol,
        networkId: currentNetwork.networkId,
        amount,
      });

      setIsSimulating(false);
      if (res.success && res.tx) {
        setSimSuccessTx(res.tx);
        setDepositAmountInput('');
      } else {
        setErrorMessage(res.error || 'Gagal mengeksekusi deposit simulasi.');
      }
    }, stepDuration * 2);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B100E]/85 backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-xl border border-[#26372D] bg-[#101A15] text-[#F1F5F2] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#26372D] flex items-center justify-between bg-[#142019]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#064E3B]/50 border border-[#10B981]/35 flex items-center justify-center text-[#10B981]">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#F1F5F2] flex items-center gap-2">
                Setor Dana / Deposit Aset Kripto
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/45 text-[#34D399] border border-[#10B981]/30 font-mono">
                  HYBRID ON-CHAIN
                </span>
              </h2>
              <p className="text-xs text-[#A1ADA5]">
                Alamat deposit deterministik & simulasi blok konfirmasi real-time
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-4 px-6 pt-3 border-b border-[#26372D] text-xs bg-[#101A15]">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`pb-2.5 font-medium border-b-2 transition-colors ${
              activeTab === 'deposit'
                ? 'border-[#10B981] text-[#34D399] font-semibold'
                : 'border-transparent text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Instruksi & Alamat Setor
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-[#10B981] text-[#34D399] font-semibold'
                : 'border-transparent text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Riwayat Setor On-Chain
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#142019] border border-[#26372D] text-[#A1ADA5] font-mono tabular-nums">
              {depositHistory.length}
            </span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {activeTab === 'deposit' ? (
            <>
              {/* Asset Selection */}
              <div>
                <label className="block text-xs font-semibold text-[#A1ADA5] uppercase tracking-wider mb-2">
                  1. Pilih Aset Kripto / Token
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {assetConfigs.map((asset) => {
                    const isSelected = asset.symbol === currentAsset?.symbol;
                    const isListed = Boolean(asset.listingId);
                    const isDepositClosed = asset.depositStatus === 'CLOSED';

                    return (
                      <button
                        key={asset.symbol}
                        onClick={() => {
                          setSelectedAssetSymbol(asset.symbol);
                          setErrorMessage(null);
                          setSimSuccessTx(null);
                        }}
                        className={`p-2.5 rounded-lg border flex flex-col items-center justify-center text-center transition-colors ${
                          isSelected
                            ? 'bg-[#064E3B]/35 border-[#10B981] text-[#F1F5F2]'
                            : 'bg-[#142019] border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
                        }`}
                      >
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white mb-1"
                          style={{ backgroundColor: asset.color }}
                        >
                          {asset.symbol.slice(0, 3)}
                        </div>
                        <span className="text-xs font-bold text-[#F1F5F2]">{asset.symbol}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          {isListed && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] font-mono">
                              LISTED
                            </span>
                          )}
                          {isDepositClosed && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-[#EF6464]/15 text-[#EF6464]">
                              LOCK
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Connected Initial Listing Status Banner */}
              {linkedListing && (
                <div className="p-3.5 rounded-lg bg-[#142019] border border-[#EAB866]/35 flex items-start gap-3 text-xs">
                  <div className="w-8 h-8 rounded-lg bg-[#EAB866]/15 border border-[#EAB866]/30 flex items-center justify-center text-[#EAB866] shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#F1F5F2]">
                        Initial Listing: {linkedListing.name} ({linkedListing.symbol})
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#EAB866] font-mono text-[10px]">
                        Status: {linkedListing.status}
                      </span>
                    </div>
                    <p className="text-[#A1ADA5] mt-1">
                      Status deposit listing:{' '}
                      <strong className={linkedListing.deposit_status === 'OPEN' ? 'text-[#10B981]' : 'text-[#EF6464]'}>
                        {linkedListing.deposit_status}
                      </strong>
                      {' • '}
                      Jadwal buka deposit:{' '}
                      <span className="text-[#F1F5F2] font-mono">
                        {new Date(linkedListing.schedule.deposit_opens_at).toLocaleString('id-ID')}
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {/* Deposit Closed Alert */}
              {!depositAvailability.available ? (
                <div className="p-4 rounded-lg bg-[#EF6464]/10 border border-[#EF6464]/40 text-xs text-[#F1F5F2] flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#EF6464] shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-[#EF6464]">Deposit Saat Ini Ditutup</h4>
                    <p className="mt-1 text-[#A1ADA5]">{depositAvailability.reason}</p>
                    <p className="mt-2 text-[11px] text-[#647168]">
                      Pengelola exchange dan Initial Listing Manager mengendalikan akses deposit ini sesuai jadwal peluncuran pasar terkoordinasi.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Network Selection */}
                  {currentAsset && currentAsset.networks.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-[#A1ADA5] uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span>2. Pilih Jaringan Transfer (Network)</span>
                        <span className="text-[#647168] lowercase font-normal">
                          {currentAsset.networks.length} jaringan tersedia
                        </span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {currentAsset.networks.map((net) => {
                          const isNetSelected = net.networkId === currentNetwork?.networkId;
                          const isNetClosed = net.depositStatus === 'CLOSED';

                          return (
                            <button
                              key={net.networkId}
                              disabled={isNetClosed}
                              onClick={() => setSelectedNetworkId(net.networkId)}
                              className={`p-3 rounded-lg border text-left transition-colors flex flex-col justify-between ${
                                isNetSelected
                                  ? 'bg-[#064E3B]/35 border-[#10B981] text-[#F1F5F2]'
                                  : isNetClosed
                                  ? 'bg-[#142019]/40 border-[#26372D] opacity-50 cursor-not-allowed text-[#647168]'
                                  : 'bg-[#142019] border-[#26372D] text-[#A1ADA5] hover:border-[#10B981]/40 hover:bg-[#192820]'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-xs text-[#F1F5F2]">
                                  {net.networkName}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5] font-mono">
                                  {net.chainType}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-[11px] text-[#A1ADA5] font-mono tabular-nums">
                                <span>Konfirmasi: {net.depositConfirmations} blok</span>
                                <span>Min: {net.minDeposit} {currentAsset.symbol}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Deposit Address Box */}
                  {depositAddressInfo && currentNetwork && (
                    <div className="p-4 rounded-lg bg-[#142019] border border-[#26372D] flex flex-col gap-4">
                      <div className="flex flex-col sm:flex-row items-center gap-5">
                        {/* SVG QR Code Simulation */}
                        <div className="p-3 bg-[#F1F5F2] rounded-lg border border-[#26372D] shrink-0">
                          <svg
                            className="w-28 h-28 text-[#0B100E]"
                            viewBox="0 0 100 100"
                            fill="currentColor"
                          >
                            <rect width="100" height="100" fill="white" />
                            <path d="M10 10h30v30h-30z M15 15h20v20h-20z M20 20h10v10h-10z" fill="black" />
                            <path d="M60 10h30v30h-30z M65 15h20v20h-20z M70 20h10v10h-10z" fill="black" />
                            <path d="M10 60h30v30h-30z M15 65h20v20h-20z M20 70h10v10h-10z" fill="black" />
                            <circle cx="50" cy="50" r="10" fill="#10B981" />
                            <rect x="45" y="15" width="10" height="20" fill="black" />
                            <rect x="15" y="45" width="20" height="10" fill="black" />
                            <rect x="55" y="55" width="20" height="20" fill="black" />
                            <rect x="75" y="60" width="15" height="10" fill="black" />
                            <rect x="60" y="80" width="30" height="10" fill="black" />
                          </svg>
                        </div>

                        {/* Address Strings & Copy */}
                        <div className="flex-1 w-full space-y-3">
                          <div>
                            <span className="text-[11px] font-semibold text-[#A1ADA5] block mb-1">
                              Alamat Deposit ({currentNetwork.networkName})
                            </span>
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#0B100E] border border-[#26372D] text-xs font-mono text-[#34D399] break-all select-all">
                              <span className="flex-1">{depositAddressInfo.address}</span>
                              <button
                                onClick={() => handleCopy(depositAddressInfo.address, 'addr')}
                                className="p-1.5 rounded-md bg-[#142019] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] transition-colors shrink-0"
                                title="Salin Alamat"
                              >
                                {copiedAddr ? <Check className="w-4 h-4 text-[#10B981]" /> : <Copy className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          {/* Memo / Tag if required */}
                          {depositAddressInfo.memoTag && (
                            <div>
                              <span className="text-[11px] font-semibold text-[#EAB866] block mb-1 flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Memo / Tag (Wajib Disertakan!)
                              </span>
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-[#EAB866]/10 border border-[#EAB866]/35 text-xs font-mono text-[#EAB866]">
                                <span className="flex-1 font-bold">{depositAddressInfo.memoTag}</span>
                                <button
                                  onClick={() => handleCopy(depositAddressInfo.memoTag!, 'memo')}
                                  className="p-1 rounded bg-[#142019] hover:bg-[#192820] border border-[#EAB866]/30 text-[#EAB866]"
                                >
                                  {copiedMemo ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Contract Address if token */}
                          {currentNetwork.contractAddress && (
                            <div className="text-[11px] text-[#A1ADA5] flex items-center gap-1.5">
                              <span>Kontrak Token:</span>
                              <code className="text-[#F1F5F2] font-mono">
                                {currentNetwork.contractAddress.slice(0, 10)}...{currentNetwork.contractAddress.slice(-8)}
                              </code>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Interactive On-Chain Simulation Form */}
                      <div className="mt-2 pt-4 border-t border-[#26372D]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-[#34D399] flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-[#10B981]" />
                            Simulasi Transaksi On-Chain (Interactive Sandbox)
                          </span>
                          <span className="text-[11px] text-[#647168]">
                            Instant ledger balance settlement
                          </span>
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              step="any"
                              value={depositAmountInput}
                              onChange={(e) => setDepositAmountInput(e.target.value)}
                              placeholder={`Contoh: 100 ${currentAsset?.symbol}`}
                              className="w-full px-3 py-2 rounded-lg glass-input text-[#F1F5F2] text-xs font-mono tabular-nums focus:outline-none"
                              disabled={isSimulating}
                            />
                            <span className="absolute right-3 top-2 text-xs font-bold text-[#A1ADA5]">
                              {currentAsset?.symbol}
                            </span>
                          </div>

                          {/* Quick amounts */}
                          <div className="flex items-center gap-1 text-[11px]">
                            {[10, 50, 100, 500].map((amt) => (
                              <button
                                key={amt}
                                type="button"
                                onClick={() => setDepositAmountInput(String(amt))}
                                className="px-2 py-1.5 rounded-lg bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] font-mono tabular-nums transition-colors"
                              >
                                +{amt}
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            disabled={isSimulating}
                            onClick={handleSimulateDeposit}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 ${
                              isSimulating
                                ? 'bg-[#064E3B] text-[#34D399] cursor-wait'
                                : 'bg-[#10B981] hover:bg-[#34D399] text-[#0B100E]'
                            }`}
                          >
                            {isSimulating ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Konfirmasi ({simConfirmations}/{currentNetwork.depositConfirmations})</span>
                              </>
                            ) : (
                              <>
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                                <span>Kirim Setoran</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Error message */}
                        {errorMessage && (
                          <div className="mt-2.5 p-2 rounded-lg bg-[#EF6464]/10 text-[#EF6464] border border-[#EF6464]/35 text-xs flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-[#EF6464]" />
                            <span>{errorMessage}</span>
                          </div>
                        )}

                        {/* Success card */}
                        {simSuccessTx && (
                          <div className="mt-3 p-3 rounded-lg bg-[#064E3B]/30 border border-[#10B981]/40 text-xs text-[#F1F5F2] space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#F1F5F2] flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                                Deposit Berhasil Dikonfirmasi!
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/60 text-[#34D399] font-mono">
                                {simSuccessTx.confirmations}/{simSuccessTx.requiredConfirmations} BLOCKS CONFIRMED
                              </span>
                            </div>
                            <p className="text-[#A1ADA5] text-[11px]">
                              Saldo sebesar{' '}
                              <strong className="text-[#F1F5F2] font-mono tabular-nums">
                                {simSuccessTx.amount} {simSuccessTx.asset}
                              </strong>{' '}
                              telah dikreditkan langsung ke portfolio akun Anda via double-entry ledger.
                            </p>
                            <div className="flex items-center gap-2 pt-1 text-[11px] text-[#A1ADA5]">
                              <span>TxHash:</span>
                              <a
                                href={simSuccessTx.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#60A5FA] hover:underline flex items-center gap-1 font-mono"
                              >
                                {simSuccessTx.txHash.slice(0, 16)}...{simSuccessTx.txHash.slice(-8)}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            /* Deposit History Tab */
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-[#A1ADA5] mb-1">
                <span>Catatan Transaksi Setoran On-Chain Terakhir</span>
                <span className="font-mono tabular-nums">{depositHistory.length} total deposit</span>
              </div>

              {depositHistory.length === 0 ? (
                <div className="p-8 text-center rounded-lg bg-[#142019] border border-[#26372D] text-xs text-[#647168]">
                  Belum ada riwayat setoran on-chain tercatat. Lakukan simulasi deposit di tab instruksi.
                </div>
              ) : (
                <div className="space-y-2">
                  {depositHistory.map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3 rounded-lg bg-[#142019] border border-[#26372D] hover:border-[#10B981]/30 transition-colors flex items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#064E3B]/45 text-[#10B981] flex items-center justify-center font-bold">
                          ↓
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#F1F5F2] font-mono tabular-nums text-sm">
                              +{tx.amount} {tx.asset}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5]">
                              {tx.networkName}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#647168] font-mono">
                            {formatDateTime(tx.timestamp)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/45 text-[#34D399] border border-[#10B981]/30 font-mono font-semibold">
                            {tx.status.toUpperCase()}
                          </span>
                          <div className="mt-1">
                            <a
                              href={tx.explorerUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-[#60A5FA] hover:underline flex items-center gap-1 font-mono justify-end"
                            >
                              {tx.txHash.slice(0, 10)}...
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#26372D] bg-[#142019] flex items-center justify-between text-xs text-[#A1ADA5]">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Info className="w-4 h-4 text-[#A1ADA5] shrink-0" />
            <span>Kirim hanya aset yang sesuai ke jaringan yang dipilih untuk mencegah kehilangan dana.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#192820] hover:bg-[#26372D] border border-[#26372D] text-[#F1F5F2] font-medium text-xs transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
