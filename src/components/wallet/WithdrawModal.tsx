import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ArrowUpRight,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ExternalLink,
  Layers,
  Info,
  Building2,
} from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { AssetConfig, NetworkConfig, WithdrawalTransaction } from '../../simulation/assetNetworkTypes';
import { AssetNetworkService } from '../../simulation/assetNetworkService';
import { formatCrypto, formatIDR, formatDateTime } from '../../utils/formatters';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAsset?: string;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  defaultAsset = 'USDT',
}) => {
  const {
    currentUser,
    balances,
    assetConfigs,
    initialListings,
    submitCryptoWithdrawal,
    withdrawalHistory,
  } = useSimulation();

  const [selectedAssetSymbol, setSelectedAssetSymbol] = useState<string>(defaultAsset);
  const [selectedNetworkId, setSelectedNetworkId] = useState<string>('');
  const [withdrawAmountInput, setWithdrawAmountInput] = useState<string>('');
  const [destinationAddress, setDestinationAddress] = useState<string>('');
  const [memoTag, setMemoTag] = useState<string>('');
  const [bankName, setBankName] = useState<string>('BCA');
  const [accountName, setAccountName] = useState<string>(currentUser.name);
  const [activeTab, setActiveTab] = useState<'withdraw' | 'history'>('withdraw');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successWithdrawal, setSuccessWithdrawal] = useState<WithdrawalTransaction | null>(null);

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

  // Initial listing check
  const linkedListing = useMemo(() => {
    if (!currentAsset?.listingId) return null;
    return initialListings.find((l) => l.id === currentAsset.listingId) || null;
  }, [currentAsset, initialListings]);

  // Check withdrawal availability (listing schedule & manual toggle)
  const withdrawalAvailability = useMemo(() => {
    if (!currentAsset || !currentNetwork) {
      return { available: false, reason: 'Aset atau jaringan tidak valid.' };
    }

    if (currentAsset.withdrawalStatus === 'CLOSED' || currentAsset.withdrawalStatus === 'SUSPENDED') {
      return { available: false, reason: `Penarikan ${currentAsset.symbol} saat ini ditangguhkan oleh pengelola exchange.` };
    }

    if (currentNetwork.withdrawalStatus === 'CLOSED' || currentNetwork.withdrawalStatus === 'SUSPENDED') {
      return { available: false, reason: `Penarikan via jaringan ${currentNetwork.networkName} saat ini ditutup untuk pemeliharaan.` };
    }

    if (linkedListing) {
      if (linkedListing.withdrawal_status === 'CLOSED') {
        const opensAt = linkedListing.schedule.withdrawal_opens_at;
        const now = Date.now();
        if (opensAt > now) {
          const diffMs = opensAt - now;
          const hours = Math.floor(diffMs / 3600000);
          const mins = Math.floor((diffMs % 3600000) / 60000);
          return {
            available: false,
            reason: `Penarikan ${currentAsset.symbol} dijadwalkan buka dalam ${hours}j ${mins}m (${new Date(opensAt).toLocaleString('id-ID')}).`,
            opensAt,
          };
        }
        return { available: false, reason: `Penarikan ${currentAsset.symbol} saat ini belum dibuka sesuai jadwal initial listing.` };
      }
    }

    return { available: true };
  }, [currentAsset, currentNetwork, linkedListing]);

  // User available balance
  const userBalance = useMemo(() => {
    return balances[selectedAssetSymbol] || { asset: selectedAssetSymbol, free: 0, locked: 0, total: 0 };
  }, [balances, selectedAssetSymbol]);

  // Fee calculation
  const networkFee = currentNetwork ? currentNetwork.withdrawalFee : 0;
  const parsedAmount = parseFloat(withdrawAmountInput) || 0;
  const netAmount = Math.max(0, parsedAmount - networkFee);

  // Address validation
  const addressValidation = useMemo(() => {
    if (!destinationAddress.trim()) return { isValid: true };
    if (!currentNetwork) return { isValid: true };
    if (currentAsset?.category === 'FIAT') {
      return { isValid: destinationAddress.trim().length >= 8 };
    }
    return AssetNetworkService.validateAddressFormat(destinationAddress, currentNetwork.chainType);
  }, [destinationAddress, currentNetwork, currentAsset]);

  const handleSetPercentage = (pct: number) => {
    const calculated = (userBalance.free * pct) / 100;
    const rounded = currentAsset?.decimals ? parseFloat(calculated.toFixed(currentAsset.decimals)) : Math.floor(calculated);
    setWithdrawAmountInput(String(rounded));
  };

  const handleSubmitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessWithdrawal(null);

    if (!currentAsset || !currentNetwork) return;

    if (!destinationAddress.trim()) {
      setErrorMessage(currentAsset.category === 'FIAT' ? 'Masukkan nomor rekening tujuan.' : 'Masukkan alamat wallet tujuan.');
      return;
    }

    if (!addressValidation.isValid) {
      setErrorMessage(addressValidation.message || 'Alamat tujuan tidak valid untuk jaringan yang dipilih.');
      return;
    }

    if (parsedAmount <= 0) {
      setErrorMessage('Masukkan jumlah penarikan yang valid.');
      return;
    }

    if (parsedAmount < currentNetwork.minWithdrawal) {
      setErrorMessage(`Penarikan minimum untuk ${currentNetwork.networkName} adalah ${currentNetwork.minWithdrawal} ${currentAsset.symbol}.`);
      return;
    }

    if (parsedAmount > userBalance.free) {
      setErrorMessage(`Saldo tidak mencukupi. Tersedia: ${userBalance.free} ${currentAsset.symbol}.`);
      return;
    }

    if (netAmount <= 0) {
      setErrorMessage(`Jumlah penarikan harus lebih besar dari biaya jaringan (${networkFee} ${currentAsset.symbol}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitCryptoWithdrawal({
        asset: currentAsset.symbol,
        networkId: currentNetwork.networkId,
        amount: parsedAmount,
        destinationAddress: destinationAddress.trim(),
        memoTag: memoTag.trim() || undefined,
        bankName: currentAsset.category === 'FIAT' ? bankName : undefined,
        accountName: currentAsset.category === 'FIAT' ? accountName : undefined,
      });

      if (res.success && res.withdrawal) {
        setSuccessWithdrawal(res.withdrawal);
        setWithdrawAmountInput('');
        setDestinationAddress('');
        setMemoTag('');
      } else {
        setErrorMessage(res.error || 'Gagal mengajukan penarikan.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B100E]/85 backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-xl border border-[#26372D] bg-[#101A15] text-[#F1F5F2] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#26372D] flex items-center justify-between bg-[#142019]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#064E3B]/50 border border-[#10B981]/35 flex items-center justify-center text-[#10B981]">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#F1F5F2] flex items-center gap-2">
                Tarik Dana / Withdrawal Aset Kripto
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/45 text-[#34D399] border border-[#10B981]/30 font-mono">
                  DOUBLE-ENTRY LEDGER LOCK
                </span>
              </h2>
              <p className="text-xs text-[#A1ADA5]">
                Pencairan dana aman dengan validasi sintaks chain dan reservasi saldo
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
            onClick={() => setActiveTab('withdraw')}
            className={`pb-2.5 font-medium border-b-2 transition-colors ${
              activeTab === 'withdraw'
                ? 'border-[#10B981] text-[#34D399] font-semibold'
                : 'border-transparent text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Formulir Penarikan
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-[#10B981] text-[#34D399] font-semibold'
                : 'border-transparent text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Antrean Penarikan
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#142019] border border-[#26372D] text-[#A1ADA5] font-mono tabular-nums">
              {withdrawalHistory.length}
            </span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {activeTab === 'withdraw' ? (
            <form onSubmit={handleSubmitWithdrawal} className="space-y-4">
              {/* Asset Selection */}
              <div>
                <label className="block text-xs font-semibold text-[#A1ADA5] uppercase tracking-wider mb-2">
                  1. Pilih Aset yang Ditarik
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {assetConfigs.map((asset) => {
                    const isSelected = asset.symbol === currentAsset?.symbol;
                    const isListed = Boolean(asset.listingId);
                    const isWtdClosed = asset.withdrawalStatus === 'CLOSED';
                    const bal = balances[asset.symbol]?.free || 0;

                    return (
                      <button
                        key={asset.symbol}
                        type="button"
                        onClick={() => {
                          setSelectedAssetSymbol(asset.symbol);
                          setErrorMessage(null);
                          setSuccessWithdrawal(null);
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
                        <span className="text-[10px] text-[#A1ADA5] font-mono tabular-nums mt-0.5 truncate max-w-full">
                          {asset.category === 'FIAT' ? formatIDR(bal) : formatCrypto(bal, asset.decimals)}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          {isListed && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] font-mono">
                              LISTED
                            </span>
                          )}
                          {isWtdClosed && (
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
                    <Clock className="w-4 h-4" />
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
                      Status penarikan listing:{' '}
                      <strong className={linkedListing.withdrawal_status === 'OPEN' ? 'text-[#10B981]' : 'text-[#EF6464]'}>
                        {linkedListing.withdrawal_status}
                      </strong>
                      {' • '}
                      Jadwal buka penarikan:{' '}
                      <span className="text-[#F1F5F2] font-mono">
                        {new Date(linkedListing.schedule.withdrawal_opens_at).toLocaleString('id-ID')}
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {/* Withdrawal Locked Alert */}
              {!withdrawalAvailability.available ? (
                <div className="p-4 rounded-lg bg-[#EF6464]/10 border border-[#EF6464]/40 text-xs text-[#F1F5F2] flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#EF6464] shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-[#EF6464]">Penarikan Saat Ini Ditutup</h4>
                    <p className="mt-1 text-[#A1ADA5]">{withdrawalAvailability.reason}</p>
                    <p className="mt-2 text-[11px] text-[#647168]">
                      Penarikan aset initial listing biasanya baru dibuka 24 jam setelah public trading live untuk menjaga likuiditas pasar awal.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Network Selection */}
                  {currentAsset && currentAsset.networks.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-[#A1ADA5] uppercase tracking-wider mb-2">
                        2. Pilih Jaringan Penarikan (Network)
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {currentAsset.networks.map((net) => {
                          const isNetSelected = net.networkId === currentNetwork?.networkId;
                          const isNetClosed = net.withdrawalStatus === 'CLOSED';

                          return (
                            <button
                              key={net.networkId}
                              type="button"
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
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5] font-mono tabular-nums">
                                  Fee: {net.withdrawalFee} {currentAsset.symbol}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-[11px] text-[#A1ADA5] font-mono tabular-nums">
                                <span>Chain: {net.chainType}</span>
                                <span>Min: {net.minWithdrawal} {currentAsset.symbol}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Destination Address Input */}
                  <div>
                    <label className="block text-xs font-semibold text-[#A1ADA5] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>3. Alamat Tujuan Transfer ({currentNetwork?.chainType || 'Address'})</span>
                      {destinationAddress && !addressValidation.isValid && (
                        <span className="text-[#EF6464] text-[11px] lowercase font-normal flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Format salah
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={destinationAddress}
                      onChange={(e) => setDestinationAddress(e.target.value)}
                      placeholder={
                        currentAsset?.category === 'FIAT'
                          ? 'Nomor rekening bank tujuan (contoh: 8820129381)'
                          : currentNetwork?.chainType === 'EVM'
                          ? '0x...'
                          : currentNetwork?.chainType === 'BITCOIN'
                          ? 'bc1... atau 1...'
                          : currentNetwork?.chainType === 'SOLANA'
                          ? 'Solana Base58 Address...'
                          : 'T... (TRON Address)'
                      }
                      className={`w-full px-3.5 py-2.5 rounded-lg bg-[#0B100E] border text-xs font-mono text-[#F1F5F2] focus:outline-none transition-colors ${
                        destinationAddress && !addressValidation.isValid
                          ? 'border-[#EF6464] focus:border-[#EF6464]'
                          : 'border-[#26372D] focus:border-[#10B981]'
                      }`}
                    />
                    {destinationAddress && !addressValidation.isValid && addressValidation.message && (
                      <p className="mt-1 text-[11px] text-[#EF6464]">{addressValidation.message}</p>
                    )}
                  </div>

                  {/* Memo/Tag if required */}
                  {currentNetwork?.isMemoRequired && (
                    <div>
                      <label className="block text-xs font-semibold text-[#EAB866] uppercase tracking-wider mb-1">
                        Memo / Tag Transfer (Diperlukan)
                      </label>
                      <input
                        type="text"
                        value={memoTag}
                        onChange={(e) => setMemoTag(e.target.value)}
                        placeholder="Masukkan memo / destination tag jika exchange penerima mewajibkan"
                        className="w-full px-3.5 py-2 rounded-lg glass-input text-xs font-mono text-[#F1F5F2] focus:outline-none"
                      />
                    </div>
                  )}

                  {/* Amount & Percentage Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[#A1ADA5] uppercase tracking-wider">
                        4. Jumlah Penarikan
                      </label>
                      <span className="text-xs text-[#A1ADA5]">
                        Saldo Tersedia:{' '}
                        <strong className="text-[#F1F5F2] font-mono tabular-nums">
                          {currentAsset?.category === 'FIAT'
                            ? formatIDR(userBalance.free)
                            : formatCrypto(userBalance.free, currentAsset?.decimals || 4)}{' '}
                          {currentAsset?.symbol}
                        </strong>
                      </span>
                    </div>

                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        value={withdrawAmountInput}
                        onChange={(e) => setWithdrawAmountInput(e.target.value)}
                        placeholder={`Min: ${currentNetwork?.minWithdrawal || 0} ${currentAsset?.symbol}`}
                        className="w-full px-3.5 py-2.5 rounded-lg glass-input text-xs font-mono tabular-nums text-[#F1F5F2] focus:outline-none"
                      />
                      <span className="absolute right-3.5 top-2.5 text-xs font-bold text-[#A1ADA5]">
                        {currentAsset?.symbol}
                      </span>
                    </div>

                    {/* Percentage buttons */}
                    <div className="flex items-center gap-1.5 mt-2">
                      {[25, 50, 75, 100].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => handleSetPercentage(pct)}
                          className="flex-1 py-1 rounded-lg bg-[#142019] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] text-[11px] font-mono tabular-nums transition-colors"
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Settlement Breakdown Card */}
                  <div className="p-3.5 rounded-lg bg-[#142019] border border-[#26372D] text-xs space-y-2">
                    <div className="flex items-center justify-between text-[#A1ADA5]">
                      <span>Jumlah Penarikan (Gross):</span>
                      <span className="text-[#F1F5F2] font-mono tabular-nums">
                        {parsedAmount} {currentAsset?.symbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#A1ADA5]">
                      <span>Biaya Jaringan ({currentNetwork?.networkName}):</span>
                      <span className="text-[#EAB866] font-mono tabular-nums">
                        -{networkFee} {currentAsset?.symbol}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-[#26372D] flex items-center justify-between font-bold">
                      <span className="text-[#F1F5F2]">Jumlah Bersih Diterima:</span>
                      <span className="text-[#10B981] text-sm font-mono tabular-nums">
                        {netAmount} {currentAsset?.symbol}
                      </span>
                    </div>
                  </div>

                  {/* Error banner */}
                  {errorMessage && (
                    <div className="p-2.5 rounded-lg bg-[#EF6464]/10 text-[#EF6464] border border-[#EF6464]/35 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-[#EF6464]" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {/* Success banner */}
                  {successWithdrawal && (
                    <div className="p-3.5 rounded-lg bg-[#064E3B]/30 border border-[#10B981]/40 text-xs text-[#F1F5F2] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#F1F5F2] flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                          Permintaan Penarikan Berhasil Diajukan!
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#064E3B]/60 text-[#34D399] font-mono">
                          STATUS: PENDING APPROVAL
                        </span>
                      </div>
                      <p className="text-[#A1ADA5] text-[11px]">
                        Saldo sebesar{' '}
                        <strong className="text-[#F1F5F2] font-mono tabular-nums">
                          {successWithdrawal.amount} {successWithdrawal.asset}
                        </strong>{' '}
                        telah dipindahkan ke status <span className="text-[#34D399] font-mono">LOCKED_WITHDRAW</span> di buku besar. Tim Compliance exchange akan memverifikasi dan menyiarkan transaksi ke jaringan.
                      </p>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isSubmitting || !withdrawalAvailability.available}
                    className="w-full py-3 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>Konfirmasi dan Kunci Penarikan</span>
                  </button>
                </>
              )}
            </form>
          ) : (
            /* Withdrawal History Tab */
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-[#A1ADA5] mb-1">
                <span>Daftar Pengajuan Penarikan Akun</span>
                <span className="font-mono tabular-nums">{withdrawalHistory.length} total pengajuan</span>
              </div>

              {withdrawalHistory.length === 0 ? (
                <div className="p-8 text-center rounded-lg bg-[#142019] border border-[#26372D] text-xs text-[#647168]">
                  Belum ada riwayat penarikan dana.
                </div>
              ) : (
                <div className="space-y-2">
                  {withdrawalHistory.map((wtd) => (
                    <div
                      key={wtd.id}
                      className="p-3.5 rounded-lg bg-[#142019] border border-[#26372D] hover:border-[#10B981]/30 transition-colors flex items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                            wtd.status === 'completed'
                              ? 'bg-[#064E3B]/45 text-[#10B981]'
                              : wtd.status === 'rejected'
                              ? 'bg-[#EF6464]/15 text-[#EF6464]'
                              : 'bg-[#60A5FA]/15 text-[#60A5FA]'
                          }`}
                        >
                          ↑
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#F1F5F2] font-mono tabular-nums text-sm">
                              -{wtd.amount} {wtd.asset}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5]">
                              {wtd.networkName}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#647168] font-mono mt-0.5">
                            Tujuan: {wtd.destinationAddress.slice(0, 14)}... • {formatDateTime(wtd.createdAt)}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                            wtd.status === 'completed'
                              ? 'bg-[#064E3B]/45 text-[#34D399]'
                              : wtd.status === 'rejected'
                              ? 'bg-[#EF6464]/15 text-[#EF6464]'
                              : 'bg-[#60A5FA]/15 text-[#60A5FA]'
                          }`}
                        >
                          {wtd.status.toUpperCase()}
                        </span>
                        {wtd.txHash && (
                          <div className="mt-1">
                            <span className="text-[11px] text-[#A1ADA5] font-mono">
                              Tx: {wtd.txHash.slice(0, 10)}...
                            </span>
                          </div>
                        )}
                        {wtd.rejectedReason && (
                          <p className="text-[10px] text-[#EF6464] mt-1 max-w-[200px] truncate">
                            {wtd.rejectedReason}
                          </p>
                        )}
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
            <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0" />
            <span>Semua penarikan melewati perlindungan AML dan rekonsiliasi buku besar otomatis.</span>
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
