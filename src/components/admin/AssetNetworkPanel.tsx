import React, { useState, useMemo } from 'react';
import {
  Layers,
  CheckCircle2,
  XCircle,
  PlusCircle,
  ShieldAlert,
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Edit2,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Globe,
  Settings,
  Lock,
  Unlock,
  Coins,
} from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { AssetConfig, NetworkConfig, ChainType, FeatureStatus } from '../../simulation/assetNetworkTypes';
import { formatCrypto, formatIDR, formatDateTime } from '../../utils/formatters';

export const AssetNetworkPanel: React.FC<{ onSuccessNotice?: (msg: string) => void }> = ({
  onSuccessNotice,
}) => {
  const {
    assetConfigs,
    initialListings,
    toggleAssetGlobalStatus,
    toggleAssetNetworkStatus,
    updateAssetNetworkConfig,
    addAssetNetwork,
    withdrawalHistory,
    approveWithdrawal,
    rejectWithdrawal,
    createAsset,
    updateBaseAsset,
  } = useSimulation();

  const [activeSubTab, setActiveSubTab] = useState<'matrix' | 'withdrawals' | 'add_network' | 'create_asset' | 'edit_asset'>('matrix');
  const [selectedAssetSymbol, setSelectedAssetSymbol] = useState<string>('USDT');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // New base asset form state
  const [newAssetSymbol, setNewAssetSymbol] = useState<string>('');
  const [newAssetName, setNewAssetName] = useState<string>('');
  const [newAssetCategory, setNewAssetCategory] = useState<'TOKEN' | 'CRYPTO' | 'FIAT' | 'DEFI' | 'RWA'>('TOKEN');
  const [newAssetDecimals, setNewAssetDecimals] = useState<number>(18);
  const [newAssetColor, setNewAssetColor] = useState<string>('#8B5CF6');
  const [newAssetPrimaryChain, setNewAssetPrimaryChain] = useState<string>('Ethereum (ERC-20)');
  const [newAssetTokenStandard, setNewAssetTokenStandard] = useState<string>('ERC-20');
  const [newAssetContract, setNewAssetContract] = useState<string>('');
  const [newAssetTotalSupply, setNewAssetTotalSupply] = useState<number>(1000000000);
  const [newAssetMaxSupply, setNewAssetMaxSupply] = useState<string>('1000000000');
  const [newAssetCirculating, setNewAssetCirculating] = useState<number>(250000000);
  const [newAssetDesc, setNewAssetDesc] = useState<string>('');
  const [newAssetWebsite, setNewAssetWebsite] = useState<string>('');
  const [newAssetWhitepaper, setNewAssetWhitepaper] = useState<string>('');
  const [newAssetExplorer, setNewAssetExplorer] = useState<string>('');
  const [newAssetGenesis, setNewAssetGenesis] = useState<string>(new Date().toISOString().slice(0, 10));
  const [newAssetInitialPrice, setNewAssetInitialPrice] = useState<number>(10000);
  const [newAssetAllocAdmin, setNewAssetAllocAdmin] = useState<number>(5000000);
  const [newAssetAutoPair, setNewAssetAutoPair] = useState<boolean>(true);

  // Edit base asset state
  const [editTotalSupply, setEditTotalSupply] = useState<number>(1000000000);
  const [editMaxSupply, setEditMaxSupply] = useState<string>('');
  const [editCirculating, setEditCirculating] = useState<number>(250000000);
  const [editDesc, setEditDesc] = useState<string>('');
  const [editWebsite, setEditWebsite] = useState<string>('');
  const [editWhitepaper, setEditWhitepaper] = useState<string>('');
  const [editContract, setEditContract] = useState<string>('');
  const [editChain, setEditChain] = useState<string>('');
  const [editStandard, setEditStandard] = useState<string>('');

  // New network form state
  const [newNetAsset, setNewNetAsset] = useState<string>('USDT');
  const [newNetId, setNewNetId] = useState<string>('');
  const [newNetName, setNewNetName] = useState<string>('');
  const [newNetChain, setNewNetChain] = useState<ChainType>('EVM');
  const [newNetContract, setNewNetContract] = useState<string>('');
  const [newNetDecimals, setNewNetDecimals] = useState<number>(18);
  const [newNetMinDeposit, setNewNetMinDeposit] = useState<number>(1);
  const [newNetConfirmations, setNewNetConfirmations] = useState<number>(12);
  const [newNetWithdrawalFee, setNewNetWithdrawalFee] = useState<number>(1);
  const [newNetMinWithdrawal, setNewNetMinWithdrawal] = useState<number>(5);
  const [newNetRpc, setNewNetRpc] = useState<string>('');

  const currentAsset = useMemo(() => {
    return assetConfigs.find((a) => a.symbol === selectedAssetSymbol) || assetConfigs[0];
  }, [assetConfigs, selectedAssetSymbol]);

  const pendingWithdrawals = useMemo(() => {
    return withdrawalHistory.filter((w) => w.status === 'pending');
  }, [withdrawalHistory]);

  const triggerNotice = (msg: string) => {
    setStatusNotice(msg);
    if (onSuccessNotice) onSuccessNotice(msg);
    setTimeout(() => setStatusNotice(null), 3000);
  };

  const handleToggleGlobal = (symbol: string, feature: 'deposit' | 'withdrawal') => {
    toggleAssetGlobalStatus(symbol, feature);
    triggerNotice(`Status ${feature.toUpperCase()} global untuk ${symbol} berhasil diperbarui.`);
  };

  const handleToggleNetwork = (symbol: string, networkId: string, feature: 'deposit' | 'withdrawal') => {
    toggleAssetNetworkStatus(symbol, networkId, feature);
    triggerNotice(`Status ${feature.toUpperCase()} untuk jaringan ${networkId} pada ${symbol} berhasil diperbarui.`);
  };

  const handleApprove = (id: string) => {
    const res = approveWithdrawal(id);
    if (res.success) {
      triggerNotice(`Penarikan ${id} disetujui & disiarkan ke rantai on-chain.`);
    } else {
      alert(res.error || 'Gagal menyetujui penarikan.');
    }
  };

  const handleReject = (id: string) => {
    const reason = prompt('Masukkan alasan penolakan penarikan:', 'Verifikasi AML / Kepatuhan rekening belum sesuai.');
    if (!reason) return;
    const res = rejectWithdrawal(id, reason);
    if (res.success) {
      triggerNotice(`Penarikan ${id} ditolak dan saldo dikembalikan ke akun pengguna.`);
    } else {
      alert(res.error || 'Gagal menolak penarikan.');
    }
  };

  const handleCreateNetwork = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNetId.trim() || !newNetName.trim()) {
      alert('Network ID dan Network Name wajib diisi.');
      return;
    }

    const netConfig: NetworkConfig = {
      networkId: newNetId.trim().toLowerCase(),
      networkName: newNetName.trim(),
      chainType: newNetChain,
      nativeCurrency: newNetChain === 'EVM' ? 'ETH' : newNetChain === 'SOLANA' ? 'SOL' : 'TRX',
      contractAddress: newNetContract.trim() || undefined,
      decimals: Number(newNetDecimals),
      minDeposit: Number(newNetMinDeposit),
      depositConfirmations: Number(newNetConfirmations),
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: Number(newNetWithdrawalFee),
      minWithdrawal: Number(newNetMinWithdrawal),
      rpcEndpoint: newNetRpc.trim() || undefined,
      explorerTxUrl: newNetChain === 'EVM' ? 'https://etherscan.io/tx/{txHash}' : 'https://solscan.io/tx/{txHash}',
      explorerAddressUrl: newNetChain === 'EVM' ? 'https://etherscan.io/address/{address}' : 'https://solscan.io/account/{address}',
    };

    addAssetNetwork(newNetAsset, netConfig);
    triggerNotice(`Jaringan baru ${netConfig.networkName} berhasil ditambahkan ke ${newNetAsset}.`);
    setSelectedAssetSymbol(newNetAsset);
    setActiveSubTab('matrix');

    // Reset inputs
    setNewNetId('');
    setNewNetName('');
    setNewNetContract('');
    setNewNetRpc('');
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#F1F5F2] flex items-center gap-2">
            Asset & Multi-Network Management Console
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30 font-mono font-bold">
              CROSS-CHAIN MATRIX & LISTING SYNC
            </span>
          </h2>
          <p className="text-xs text-[#A1ADA5] mt-1 max-w-2xl">
            Kelola matriks jaringan transfer multichain (EVM, Bitcoin SegWit/LN, Solana SPL, TRON TRC-20), kontrol status setor/tarik sinkron dengan jadwal Initial Listing, dan tinjau antrean persetujuan penarikan pengguna.
          </p>
        </div>

        {/* Quick Sub-Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[#101A15] border border-[#26372D] text-xs font-semibold">
          <button
            onClick={() => setActiveSubTab('matrix')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'matrix'
                ? 'bg-[#10B981] text-[#0B100E] font-bold'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Katalog & Jaringan Aset</span>
          </button>
          <button
            onClick={() => setActiveSubTab('withdrawals')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'withdrawals'
                ? 'bg-[#10B981] text-[#0B100E] font-bold'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Persetujuan Penarikan</span>
            {pendingWithdrawals.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EAB866] text-[#0B100E] font-mono font-bold tabular-nums">
                {pendingWithdrawals.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('create_asset')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'create_asset'
                ? 'bg-[#10B981] text-[#0B100E] font-bold'
                : 'text-[#34D399] hover:text-[#F1F5F2] bg-[#192820] border border-[#10B981]/30'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>+ Buat Base Asset Baru</span>
          </button>
          <button
            onClick={() => setActiveSubTab('add_network')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'add_network'
                ? 'bg-[#10B981] text-[#0B100E] font-bold'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Tambah Jaringan</span>
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="p-2.5 rounded-lg bg-[#064E3B]/30 text-[#34D399] border border-[#10B981]/35 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* View 1: Asset Matrix & Networks */}
      {activeSubTab === 'matrix' && (
        <div className="space-y-4">
          {/* Asset Selector Badges */}
          <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-[#26372D]">
            {assetConfigs.map((asset) => {
              const isSelected = asset.symbol === currentAsset?.symbol;
              const hasListing = Boolean(asset.listingId);

              return (
                <button
                  key={asset.symbol}
                  onClick={() => setSelectedAssetSymbol(asset.symbol)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 border ${
                    isSelected
                      ? 'bg-[#192820] border-[#10B981] text-[#F1F5F2]'
                      : 'bg-[#142019] border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2]'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: asset.color }}
                  />
                  <span>{asset.symbol}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] text-[#A1ADA5] font-mono tabular-nums">
                    {asset.networks.length} net
                  </span>
                  {hasListing && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/30 font-mono">
                      LISTING
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Current Asset Overview Card */}
          {currentAsset && (
            <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-[#F1F5F2]"
                  style={{ backgroundColor: currentAsset.color }}
                >
                  {currentAsset.symbol.slice(0, 3)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                    {currentAsset.name} ({currentAsset.symbol})
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#192820] text-[#A1ADA5] border border-[#26372D] font-mono">
                      {currentAsset.category}
                    </span>
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[#A1ADA5]">
                    <span>Presisi: {currentAsset.decimals} desimal</span>
                    <span>•</span>
                    <span>Total Jaringan Aktif: {currentAsset.networks.length}</span>
                    {currentAsset.listingId && (
                      <>
                        <span>•</span>
                        <span className="text-[#EAB866] font-semibold">
                          Terkait Listing #{currentAsset.listingId}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Global Asset Status Toggles & Edit Action */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => {
                    setEditTotalSupply(currentAsset.totalSupply || 1000000000);
                    setEditMaxSupply(currentAsset.maxSupply !== null && currentAsset.maxSupply !== undefined ? String(currentAsset.maxSupply) : '');
                    setEditCirculating(currentAsset.circulatingSupply || 250000000);
                    setEditDesc(currentAsset.description || '');
                    setEditWebsite(currentAsset.websiteUrl || '');
                    setEditWhitepaper(currentAsset.whitepaperUrl || '');
                    setEditContract(currentAsset.contractAddress || '');
                    setEditChain(currentAsset.primaryChain || 'Ethereum (ERC-20)');
                    setEditStandard(currentAsset.tokenStandard || 'ERC-20');
                    setActiveSubTab('edit_asset');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#192820] hover:bg-[#26372D] border border-[#10B981]/35 text-[#34D399] text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit Base Asset & Supply</span>
                </button>

                <div className="flex items-center gap-3 bg-[#101A15] p-2.5 rounded-xl border border-[#26372D] text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[#A1ADA5]">Global Deposit:</span>
                    <button
                      onClick={() => handleToggleGlobal(currentAsset.symbol, 'deposit')}
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors flex items-center gap-1 ${
                        currentAsset.depositStatus === 'OPEN'
                          ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30'
                          : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                      }`}
                    >
                      {currentAsset.depositStatus === 'OPEN' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      <span>{currentAsset.depositStatus}</span>
                    </button>
                  </div>

                  <div className="h-4 w-px bg-[#26372D]" />

                  <div className="flex items-center gap-2">
                    <span className="text-[#A1ADA5]">Global Withdrawal:</span>
                    <button
                      onClick={() => handleToggleGlobal(currentAsset.symbol, 'withdrawal')}
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors flex items-center gap-1 ${
                        currentAsset.withdrawalStatus === 'OPEN'
                          ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30'
                          : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                      }`}
                    >
                      {currentAsset.withdrawalStatus === 'OPEN' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      <span>{currentAsset.withdrawalStatus}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Base Asset Technical Specs & Tokenomics Ribbon */}
          {currentAsset && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 p-3.5 rounded-xl bg-[#101A15] border border-[#26372D] text-xs">
              <div className="space-y-1">
                <span className="text-[11px] text-[#A1ADA5]">Primary Chain</span>
                <p className="font-bold text-[#F1F5F2] truncate" title={currentAsset.primaryChain || 'N/A'}>
                  {currentAsset.primaryChain || 'EVM / Native'}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-[#A1ADA5]">Token Standard</span>
                <p className="font-bold text-[#60A5FA] font-mono truncate">
                  {currentAsset.tokenStandard || 'Native'}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-[#A1ADA5]">Total Supply</span>
                <p className="font-bold text-[#10B981] font-mono tabular-nums">
                  {currentAsset.totalSupply ? Number(currentAsset.totalSupply).toLocaleString('id-ID') : 'Unlimited'}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-[#A1ADA5]">Max Supply</span>
                <p className="font-bold text-[#F1F5F2] font-mono tabular-nums">
                  {currentAsset.maxSupply ? Number(currentAsset.maxSupply).toLocaleString('id-ID') : 'No Hard Cap'}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-[#A1ADA5]">Sirkulasi Aset</span>
                <p className="font-bold text-[#EAB866] font-mono tabular-nums">
                  {currentAsset.circulatingSupply ? Number(currentAsset.circulatingSupply).toLocaleString('id-ID') : 'N/A'}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-[#A1ADA5]">Smart Contract</span>
                <p className="font-mono text-[10px] text-[#A1ADA5] truncate" title={currentAsset.contractAddress || 'Genesis Native'}>
                  {currentAsset.contractAddress ? `${currentAsset.contractAddress.slice(0, 8)}...${currentAsset.contractAddress.slice(-6)}` : 'Native L1'}
                </p>
              </div>
            </div>
          )}

          {/* Networks Table */}
          <div className="overflow-x-auto rounded-xl border border-[#26372D] bg-[#142019]">
            <table className="w-full text-left text-xs text-[#F1F5F2] tabular-nums">
              <thead className="bg-[#101A15] text-[11px] font-semibold text-[#A1ADA5] uppercase tracking-wider border-b border-[#26372D]">
                <tr>
                  <th className="py-3 px-4">Nama Jaringan & Chain</th>
                  <th className="py-3 px-3">Kontrak Token / Identifier</th>
                  <th className="py-3 px-3 text-center">Konfirmasi</th>
                  <th className="py-3 px-3 text-right">Min Setor</th>
                  <th className="py-3 px-3 text-right">Biaya Tarik (Fee)</th>
                  <th className="py-3 px-3 text-right">Min Tarik</th>
                  <th className="py-3 px-3 text-center">Setor</th>
                  <th className="py-3 px-3 text-center">Tarik</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26372D]">
                {currentAsset?.networks.map((net) => (
                  <tr key={net.networkId} className="hover:bg-[#192820] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#F1F5F2]">{net.networkName}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[#A1ADA5] font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-[#192820] text-[#A1ADA5] border border-[#26372D]">
                          {net.chainType}
                        </span>
                        <span>ID: {net.networkId}</span>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      {net.contractAddress ? (
                        <code className="text-[#F1F5F2] font-mono text-[11px] block truncate max-w-[180px]">
                          {net.contractAddress}
                        </code>
                      ) : (
                        <span className="text-[#647168] italic">Native Coin ({net.nativeCurrency})</span>
                      )}
                      {net.rpcEndpoint && (
                        <span className="text-[10px] text-[#60A5FA] font-mono block truncate max-w-[180px]">
                          RPC: {net.rpcEndpoint}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center font-mono text-[#F1F5F2]">
                      {net.depositConfirmations} blok
                    </td>

                    <td className="py-3 px-3 text-right font-mono text-[#34D399]">
                      {net.minDeposit} {currentAsset.symbol}
                    </td>

                    <td className="py-3 px-3 text-right font-mono text-[#EAB866]">
                      {net.withdrawalFee} {currentAsset.symbol}
                    </td>

                    <td className="py-3 px-3 text-right font-mono text-[#F1F5F2]">
                      {net.minWithdrawal} {currentAsset.symbol}
                    </td>

                    {/* Deposit Toggle */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => handleToggleNetwork(currentAsset.symbol, net.networkId, 'deposit')}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-colors ${
                          net.depositStatus === 'OPEN'
                            ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30 hover:bg-[#10B981]/25'
                            : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30 hover:bg-[#EF6464]/25'
                        }`}
                      >
                        {net.depositStatus}
                      </button>
                    </td>

                    {/* Withdrawal Toggle */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => handleToggleNetwork(currentAsset.symbol, net.networkId, 'withdrawal')}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-colors ${
                          net.withdrawalStatus === 'OPEN'
                            ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30 hover:bg-[#10B981]/25'
                            : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30 hover:bg-[#EF6464]/25'
                        }`}
                      >
                        {net.withdrawalStatus}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* View 2: Pending Withdrawal Approvals */}
      {activeSubTab === 'withdrawals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#F1F5F2] flex items-center gap-2">
              Antrean Persetujuan Penarikan Dana (Withdrawal Queue)
              <span className="text-xs px-2 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/30 font-mono tabular-nums">
                {pendingWithdrawals.length} menunggu tindakan
              </span>
            </h3>
            <p className="text-xs text-[#A1ADA5]">
              Penarikan yang disetujui akan mendebit saldo terkunci di buku besar dan menyiarkan txHash on-chain.
            </p>
          </div>

          {pendingWithdrawals.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-[#142019] border border-[#26372D] text-xs text-[#647168]">
              Tidak ada antrean penarikan yang menunggu persetujuan admin.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingWithdrawals.map((wtd) => (
                <div
                  key={wtd.id}
                  className="p-4 rounded-xl bg-[#142019] border border-[#26372D] flex flex-wrap items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#F1F5F2] font-mono text-sm tabular-nums">
                        {wtd.amount} {wtd.asset}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#60A5FA]/15 text-[#60A5FA] border border-[#60A5FA]/30 font-mono font-semibold">
                        {wtd.networkName}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/30 font-mono font-semibold">
                        PENDING APPROVAL
                      </span>
                    </div>

                    <div className="text-[#A1ADA5] text-[11px] font-mono space-y-0.5 tabular-nums">
                      <div>User ID: <strong className="text-[#F1F5F2]">{wtd.userId}</strong></div>
                      <div>Tujuan: <code className="text-[#34D399]">{wtd.destinationAddress}</code></div>
                      {wtd.memoTag && <div>Memo: <strong className="text-[#EAB866]">{wtd.memoTag}</strong></div>}
                      <div>
                        Gross: {wtd.amount} • Fee: {wtd.networkFee} • Net Dikirim:{' '}
                        <strong className="text-[#F1F5F2]">{wtd.netAmount} {wtd.asset}</strong>
                      </div>
                      <div className="text-[#647168]">{formatDateTime(wtd.createdAt)}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReject(wtd.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/30 text-xs font-semibold transition-colors flex items-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Tolak & Kembalikan Saldo</span>
                    </button>
                    <button
                      onClick={() => handleApprove(wtd.id)}
                      className="px-3.5 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] text-xs font-bold transition-colors flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Setujui & Siarkan Tx</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View 3: Add Network Form */}
      {activeSubTab === 'add_network' && (
        <div className="p-5 rounded-xl bg-[#142019] border border-[#26372D] max-w-2xl">
          <h3 className="text-sm font-bold text-[#F1F5F2] mb-1 flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-[#10B981]" />
            Konfigurasi Jaringan Baru untuk Aset
          </h3>
          <p className="text-xs text-[#A1ADA5] mb-4">
            Tambahkan jalur rantai blockchain (misal Arbitrum, Base, Polygon, Solana, atau Lightning) ke aset token atau listing yang ada.
          </p>

          <form onSubmit={handleCreateNetwork} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Target Aset</label>
                <select
                  value={newNetAsset}
                  onChange={(e) => setNewNetAsset(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
                >
                  {assetConfigs.map((a) => (
                    <option key={a.symbol} value={a.symbol} className="bg-[#101A15] text-[#F1F5F2]">
                      {a.symbol} - {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Tipe Rantai (Chain Type)</label>
                <select
                  value={newNetChain}
                  onChange={(e) => setNewNetChain(e.target.value as ChainType)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
                >
                  <option value="EVM" className="bg-[#101A15] text-[#F1F5F2]">EVM (Ethereum / Arbitrum / Base / BSC / Polygon)</option>
                  <option value="SOLANA" className="bg-[#101A15] text-[#F1F5F2]">Solana (SPL)</option>
                  <option value="BITCOIN" className="bg-[#101A15] text-[#F1F5F2]">Bitcoin (SegWit / Taproot / Lightning)</option>
                  <option value="TRON" className="bg-[#101A15] text-[#F1F5F2]">TRON (TRC-20)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Network ID (Identifier unik)</label>
                <input
                  type="text"
                  required
                  placeholder="contoh: usdt-arbitrum atau aurora-solana"
                  value={newNetId}
                  onChange={(e) => setNewNetId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Nama Jaringan (Tampil di UI)</label>
                <input
                  type="text"
                  required
                  placeholder="contoh: Arbitrum One (L2 Low Fee)"
                  value={newNetName}
                  onChange={(e) => setNewNetName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">
                Alamat Kontrak Smart Contract (Kosongkan jika native coin)
              </label>
              <input
                type="text"
                placeholder="0x... atau Base58 address"
                value={newNetContract}
                onChange={(e) => setNewNetContract(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono focus:border-[#10B981] outline-none"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Min Deposit</label>
                <input
                  type="number"
                  step="any"
                  value={newNetMinDeposit}
                  onChange={(e) => setNewNetMinDeposit(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Blok Konfirmasi</label>
                <input
                  type="number"
                  value={newNetConfirmations}
                  onChange={(e) => setNewNetConfirmations(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Fee Penarikan</label>
                <input
                  type="number"
                  step="any"
                  value={newNetWithdrawalFee}
                  onChange={(e) => setNewNetWithdrawalFee(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Min Penarikan</label>
                <input
                  type="number"
                  step="any"
                  value={newNetMinWithdrawal}
                  onChange={(e) => setNewNetMinWithdrawal(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">RPC Node Endpoint (On-Chain Ready)</label>
              <input
                type="text"
                placeholder="https://arb1.arbitrum.io/rpc atau internal node"
                value={newNetRpc}
                onChange={(e) => setNewNetRpc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono focus:border-[#10B981] outline-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveSubTab('matrix')}
                className="px-4 py-2 rounded-lg bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D]"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold transition-colors"
              >
                Simpan & Aktifkan Jaringan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* View 4: Create Base Asset Form */}
      {activeSubTab === 'create_asset' && (
        <div className="p-5 rounded-xl bg-[#142019] border border-[#26372D] space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
            <div>
              <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#10B981]" />
                Base Asset Creation & Tokenomics Setup
              </h3>
              <p className="text-xs text-[#A1ADA5] mt-0.5">
                Tambahkan instrumen aset dasar baru ke database exchange, tentukan pasokan token (total & max supply), kontrak smart contract, dan terbitkan secara instan ke buku order spot.
              </p>
            </div>
            <button
              onClick={() => setActiveSubTab('matrix')}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D]"
            >
              Kembali ke Katalog
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newAssetSymbol.trim() || !newAssetName.trim()) {
                alert('Simbol Ticker dan Nama Aset wajib diisi.');
                return;
              }

              const sym = newAssetSymbol.trim().toUpperCase();
              const maxSupVal = newAssetMaxSupply.trim() ? Number(newAssetMaxSupply) : null;

              const res = createAsset(
                {
                  symbol: sym,
                  name: newAssetName.trim(),
                  decimals: Number(newAssetDecimals),
                  category: newAssetCategory,
                  color: newAssetColor,
                  depositStatus: 'OPEN',
                  withdrawalStatus: 'OPEN',
                  primaryChain: newAssetPrimaryChain,
                  tokenStandard: newAssetTokenStandard,
                  contractAddress: newAssetContract.trim() || undefined,
                  totalSupply: Number(newAssetTotalSupply),
                  maxSupply: maxSupVal,
                  circulatingSupply: Number(newAssetCirculating),
                  description: newAssetDesc.trim(),
                  websiteUrl: newAssetWebsite.trim() || undefined,
                  whitepaperUrl: newAssetWhitepaper.trim() || undefined,
                  explorerUrl: newAssetExplorer.trim() || undefined,
                  genesisDate: newAssetGenesis,
                  initialPrice: Number(newAssetInitialPrice),
                  status: 'ACTIVE',
                  networks: [],
                },
                {
                  networkId: `${sym.toLowerCase()}-primary`,
                  networkName: `${newAssetPrimaryChain} (${sym} Native)`,
                  chainType: newAssetPrimaryChain.toLowerCase().includes('sol')
                    ? 'SOLANA'
                    : newAssetPrimaryChain.toLowerCase().includes('tron')
                    ? 'TRON'
                    : newAssetPrimaryChain.toLowerCase().includes('btc')
                    ? 'BITCOIN'
                    : 'EVM',
                  nativeCurrency: newAssetPrimaryChain.toLowerCase().includes('sol') ? 'SOL' : 'ETH',
                  contractAddress: newAssetContract.trim() || undefined,
                  decimals: Number(newAssetDecimals),
                  minDeposit: 1,
                  depositConfirmations: 12,
                  depositStatus: 'OPEN',
                  withdrawalStatus: 'OPEN',
                  withdrawalFee: 0.1,
                  minWithdrawal: 1,
                  explorerTxUrl: 'https://etherscan.io/tx/{txHash}',
                  explorerAddressUrl: 'https://etherscan.io/address/{address}',
                },
                newAssetAutoPair,
                Number(newAssetAllocAdmin)
              );

              if (res.success) {
                triggerNotice(`Base Asset ${sym} (${newAssetName}) berhasil dibuat dan terintegrasi ke database!`);
                setSelectedAssetSymbol(sym);
                setActiveSubTab('matrix');
              } else {
                alert(res.error || 'Gagal membuat aset baru.');
              }
            }}
            className="space-y-4 text-xs"
          >
            {/* Row 1: Symbol & Name */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">
                  Ticker Symbol <span className="text-[#EF6464]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. SML, HYPER, AURORA"
                  value={newAssetSymbol}
                  onChange={(e) => setNewAssetSymbol(e.target.value.toUpperCase())}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono uppercase font-bold focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">
                  Nama Lengkap Aset <span className="text-[#EF6464]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Smile Chain Native Token"
                  value={newAssetName}
                  onChange={(e) => setNewAssetName(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Kategori Aset</label>
                <select
                  value={newAssetCategory}
                  onChange={(e) => setNewAssetCategory(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
                >
                  <option value="TOKEN" className="bg-[#101A15] text-[#F1F5F2]">TOKEN (Utility / Governance)</option>
                  <option value="CRYPTO" className="bg-[#101A15] text-[#F1F5F2]">CRYPTO (L1 Native)</option>
                  <option value="DEFI" className="bg-[#101A15] text-[#F1F5F2]">DEFI (Protocol Yield / DEX)</option>
                  <option value="RWA" className="bg-[#101A15] text-[#F1F5F2]">RWA (Real World Asset Tokenized)</option>
                  <option value="FIAT" className="bg-[#101A15] text-[#F1F5F2]">FIAT (Virtual Currency)</option>
                </select>
              </div>
            </div>

            {/* Row 2: Token Supply & Circulation */}
            <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] space-y-3">
              <h4 className="font-bold text-[#F1F5F2] text-xs flex items-center gap-2">
                <Coins className="w-3.5 h-3.5 text-[#EAB866]" />
                Tokenomics & Pasokan Suplai
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">
                    Total Supply (Pasokan Total Saat Ini)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newAssetTotalSupply}
                    onChange={(e) => setNewAssetTotalSupply(Number(e.target.value))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#34D399] font-mono font-bold tabular-nums focus:border-[#10B981] outline-none"
                  />
                  <span className="text-[10px] text-[#647168] mt-1 block">
                    Jumlah total unit token yang telah di-mint/diterbitkan.
                  </span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">
                    Max Supply (Batas Keras Maksimal)
                  </label>
                  <input
                    type="text"
                    placeholder="Kosongkan jika tak terbatas (unlimited)"
                    value={newAssetMaxSupply}
                    onChange={(e) => setNewAssetMaxSupply(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                  />
                  <span className="text-[10px] text-[#647168] mt-1 block">
                    Hard cap absolut suplai seumur hidup token (seperti 21M pada BTC).
                  </span>
                </div>

                <div>
                  <label className="block font-semibold text-[#A1ADA5] mb-1">
                    Circulating Supply (Beredar di Publik)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newAssetCirculating}
                    onChange={(e) => setNewAssetCirculating(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#EAB866] font-mono tabular-nums focus:border-[#10B981] outline-none"
                  />
                  <span className="text-[10px] text-[#647168] mt-1 block">
                    Estimasi pasokan yang sudah aktif diperdagangkan di pasar.
                  </span>
                </div>
              </div>
            </div>

            {/* Row 3: Chain & Smart Contract Details */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Primary Blockchain</label>
                <input
                  type="text"
                  placeholder="e.g. Ethereum (ERC-20), Solana, Arbitrum"
                  value={newAssetPrimaryChain}
                  onChange={(e) => setNewAssetPrimaryChain(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Token Standard</label>
                <input
                  type="text"
                  placeholder="e.g. ERC-20, SPL, TRC-20, Native"
                  value={newAssetTokenStandard}
                  onChange={(e) => setNewAssetTokenStandard(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Desimal Presisi</label>
                <input
                  type="number"
                  min="0"
                  max="18"
                  value={newAssetDecimals}
                  onChange={(e) => setNewAssetDecimals(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Brand Color Hex</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newAssetColor}
                    onChange={(e) => setNewAssetColor(e.target.value)}
                    className="w-9 h-9 rounded-lg bg-transparent cursor-pointer border border-[#26372D] p-0.5"
                  />
                  <input
                    type="text"
                    value={newAssetColor}
                    onChange={(e) => setNewAssetColor(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono uppercase focus:border-[#10B981] outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">Smart Contract Address</label>
              <input
                type="text"
                placeholder="0x... atau mint address (kosongkan jika aset native L1)"
                value={newAssetContract}
                onChange={(e) => setNewAssetContract(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono focus:border-[#10B981] outline-none"
              />
            </div>

            {/* Row 4: Initial Price & Auto Market Pair */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3.5 rounded-xl bg-[#101A15] border border-[#26372D]">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">
                  Harga Patokan Awal (IDR)
                </label>
                <input
                  type="number"
                  step="any"
                  value={newAssetInitialPrice}
                  onChange={(e) => setNewAssetInitialPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#34D399] font-mono font-bold tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">
                  Alokasi Faucet Kas Admin (Unit)
                </label>
                <input
                  type="number"
                  step="any"
                  value={newAssetAllocAdmin}
                  onChange={(e) => setNewAssetAllocAdmin(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#142019] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>

              <div className="flex items-center gap-3 pt-4">
                <input
                  type="checkbox"
                  id="auto_pair"
                  checked={newAssetAutoPair}
                  onChange={(e) => setNewAssetAutoPair(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#10B981] bg-[#142019] border-[#26372D]"
                />
                <label htmlFor="auto_pair" className="text-[#F1F5F2] font-semibold cursor-pointer">
                  Otomatis buat Spot Market Pair ({newAssetSymbol || 'TOKEN'}/IDR)
                </label>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">Deskripsi Proyek & Aset</label>
              <textarea
                rows={2}
                placeholder="Jelaskan kegunaan, ekosistem, dan arsitektur token ini..."
                value={newAssetDesc}
                onChange={(e) => setNewAssetDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#26372D]">
              <button
                type="button"
                onClick={() => setActiveSubTab('matrix')}
                className="px-4 py-2 rounded-lg bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D]"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold transition-colors flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Simpan & Buat Base Asset</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* View 5: Edit Base Asset Form */}
      {activeSubTab === 'edit_asset' && currentAsset && (
        <div className="p-5 rounded-xl bg-[#142019] border border-[#26372D] space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
            <div>
              <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-[#10B981]" />
                Edit Parameter Base Asset: {currentAsset.name} ({currentAsset.symbol})
              </h3>
              <p className="text-xs text-[#A1ADA5] mt-0.5">
                Perbarui total supply, max supply, sirkulasi suplai, smart contract address, dan metadata fundamental token.
              </p>
            </div>
            <button
              onClick={() => setActiveSubTab('matrix')}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D]"
            >
              Kembali
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const maxSupVal = editMaxSupply.trim() ? Number(editMaxSupply) : null;
              const res = updateBaseAsset(currentAsset.symbol, {
                totalSupply: Number(editTotalSupply),
                maxSupply: maxSupVal,
                circulatingSupply: Number(editCirculating),
                description: editDesc,
                websiteUrl: editWebsite.trim() || undefined,
                whitepaperUrl: editWhitepaper.trim() || undefined,
                contractAddress: editContract.trim() || undefined,
                primaryChain: editChain,
                tokenStandard: editStandard,
              });

              if (res.success) {
                triggerNotice(`Parameter Base Asset ${currentAsset.symbol} berhasil diperbarui di database!`);
                setActiveSubTab('matrix');
              } else {
                alert(res.error || 'Gagal memperbarui base asset.');
              }
            }}
            className="space-y-4 text-xs"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">
                  Total Supply (Pasokan Saat Ini)
                </label>
                <input
                  type="number"
                  step="any"
                  value={editTotalSupply}
                  onChange={(e) => setEditTotalSupply(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#34D399] font-mono font-bold tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">
                  Max Supply (Batas Maksimal)
                </label>
                <input
                  type="text"
                  placeholder="Kosongkan jika unlimited"
                  value={editMaxSupply}
                  onChange={(e) => setEditMaxSupply(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">
                  Circulating Supply (Beredar)
                </label>
                <input
                  type="number"
                  step="any"
                  value={editCirculating}
                  onChange={(e) => setEditCirculating(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#EAB866] font-mono tabular-nums focus:border-[#10B981] outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Primary Chain</label>
                <input
                  type="text"
                  value={editChain}
                  onChange={(e) => setEditChain(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Token Standard</label>
                <input
                  type="text"
                  value={editStandard}
                  onChange={(e) => setEditStandard(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono focus:border-[#10B981] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#A1ADA5] mb-1">Smart Contract Address</label>
                <input
                  type="text"
                  value={editContract}
                  onChange={(e) => setEditContract(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono focus:border-[#10B981] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#A1ADA5] mb-1">Deskripsi Aset</label>
              <textarea
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] focus:border-[#10B981] outline-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#26372D]">
              <button
                type="button"
                onClick={() => setActiveSubTab('matrix')}
                className="px-4 py-2 rounded-lg bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D]"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold transition-colors"
              >
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
