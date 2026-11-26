import {
  AssetConfig,
  NetworkConfig,
  DepositAddress,
  OnChainTransaction,
  WithdrawalTransaction,
  ChainType,
  FeatureStatus,
} from './assetNetworkTypes';
import { InitialListing } from './listingTypes';

export const DEFAULT_NETWORKS: Record<string, NetworkConfig[]> = {
  IDR: [
    {
      networkId: 'idr-va-bca',
      networkName: 'BCA Virtual Account (Instant)',
      chainType: 'EVM',
      nativeCurrency: 'IDR',
      decimals: 0,
      minDeposit: 10000,
      depositConfirmations: 1,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 4500,
      minWithdrawal: 50000,
      maxDailyWithdrawal: 1000000000,
      explorerTxUrl: 'https://bankbca.co.id/transfer/status?ref={txHash}',
      explorerAddressUrl: 'https://bankbca.co.id',
    },
    {
      networkId: 'idr-va-mandiri',
      networkName: 'Mandiri Virtual Account',
      chainType: 'EVM',
      nativeCurrency: 'IDR',
      decimals: 0,
      minDeposit: 10000,
      depositConfirmations: 1,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 4500,
      minWithdrawal: 50000,
      maxDailyWithdrawal: 1000000000,
      explorerTxUrl: 'https://bankmandiri.co.id/transfer/status?ref={txHash}',
      explorerAddressUrl: 'https://bankmandiri.co.id',
    },
    {
      networkId: 'idr-qris',
      networkName: 'QRIS Real-Time National QR',
      chainType: 'EVM',
      nativeCurrency: 'IDR',
      decimals: 0,
      minDeposit: 5000,
      depositConfirmations: 1,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 2500,
      minWithdrawal: 25000,
      maxDailyWithdrawal: 20000000,
      explorerTxUrl: 'https://aspi-indonesia.or.id/qris/verify?ref={txHash}',
      explorerAddressUrl: 'https://aspi-indonesia.or.id',
    },
  ],
  BTC: [
    {
      networkId: 'btc-mainnet',
      networkName: 'Bitcoin Native (SegWit Bech32)',
      chainType: 'BITCOIN',
      nativeCurrency: 'BTC',
      decimals: 8,
      minDeposit: 0.0001,
      depositConfirmations: 2,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.0002,
      minWithdrawal: 0.0005,
      explorerTxUrl: 'https://mempool.space/tx/{txHash}',
      explorerAddressUrl: 'https://mempool.space/address/{address}',
      rpcEndpoint: 'https://bitcoin-mainnet.silent-node.internal:8332',
    },
    {
      networkId: 'btc-lightning',
      networkName: 'Lightning Network (Instant 0-Fee)',
      chainType: 'BITCOIN',
      nativeCurrency: 'BTC',
      decimals: 8,
      minDeposit: 0.00005,
      depositConfirmations: 1,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.00001,
      minWithdrawal: 0.0001,
      isMemoRequired: true,
      explorerTxUrl: 'https://1ml.com/tx/{txHash}',
      explorerAddressUrl: 'https://1ml.com',
      rpcEndpoint: 'https://ln-node.silent-node.internal:9735',
    },
  ],
  ETH: [
    {
      networkId: 'eth-mainnet',
      networkName: 'Ethereum Mainnet (ERC-20)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      decimals: 18,
      minDeposit: 0.005,
      depositConfirmations: 12,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.0015,
      minWithdrawal: 0.01,
      explorerTxUrl: 'https://etherscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://etherscan.io/address/{address}',
      rpcEndpoint: 'https://eth-mainnet.alchemyapi.io/v2/demo',
    },
    {
      networkId: 'eth-arbitrum',
      networkName: 'Arbitrum One (Low Fee L2)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      decimals: 18,
      minDeposit: 0.001,
      depositConfirmations: 20,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.0003,
      minWithdrawal: 0.005,
      explorerTxUrl: 'https://arbiscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://arbiscan.io/address/{address}',
      rpcEndpoint: 'https://arb1.arbitrum.io/rpc',
    },
    {
      networkId: 'eth-base',
      networkName: 'Base Mainnet (Coinbase L2)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      decimals: 18,
      minDeposit: 0.001,
      depositConfirmations: 15,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.0002,
      minWithdrawal: 0.005,
      explorerTxUrl: 'https://basescan.org/tx/{txHash}',
      explorerAddressUrl: 'https://basescan.org/address/{address}',
      rpcEndpoint: 'https://mainnet.base.org',
    },
  ],
  USDT: [
    {
      networkId: 'usdt-trc20',
      networkName: 'TRON (TRC-20 Fast Transfer)',
      chainType: 'TRON',
      nativeCurrency: 'TRX',
      contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      minDeposit: 1,
      depositConfirmations: 19,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 1.5,
      minWithdrawal: 10,
      explorerTxUrl: 'https://tronscan.org/#/transaction/{txHash}',
      explorerAddressUrl: 'https://tronscan.org/#/address/{address}',
      rpcEndpoint: 'https://api.trongrid.io',
    },
    {
      networkId: 'usdt-erc20',
      networkName: 'Ethereum (ERC-20 Standard)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      decimals: 6,
      minDeposit: 10,
      depositConfirmations: 12,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 4.5,
      minWithdrawal: 25,
      explorerTxUrl: 'https://etherscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://etherscan.io/address/{address}',
      rpcEndpoint: 'https://eth-mainnet.alchemyapi.io/v2/demo',
    },
    {
      networkId: 'usdt-arbitrum',
      networkName: 'Arbitrum One (L2 Low Cost)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      contractAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      decimals: 6,
      minDeposit: 2,
      depositConfirmations: 20,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.8,
      minWithdrawal: 5,
      explorerTxUrl: 'https://arbiscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://arbiscan.io/address/{address}',
      rpcEndpoint: 'https://arb1.arbitrum.io/rpc',
    },
    {
      networkId: 'usdt-solana',
      networkName: 'Solana (SPL Instant)',
      chainType: 'SOLANA',
      nativeCurrency: 'SOL',
      contractAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      decimals: 6,
      minDeposit: 1,
      depositConfirmations: 32,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 1.0,
      minWithdrawal: 5,
      explorerTxUrl: 'https://solscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://solscan.io/account/{address}',
      rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    },
    {
      networkId: 'usdt-bep20',
      networkName: 'BNB Smart Chain (BEP-20)',
      chainType: 'EVM',
      nativeCurrency: 'BNB',
      contractAddress: '0x55d398326f99059ff775485246999027b3197955',
      decimals: 18,
      minDeposit: 2,
      depositConfirmations: 15,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.8,
      minWithdrawal: 5,
      explorerTxUrl: 'https://bscscan.com/tx/{txHash}',
      explorerAddressUrl: 'https://bscscan.com/address/{address}',
      rpcEndpoint: 'https://bsc-dataseed.binance.org',
    },
  ],
  SOL: [
    {
      networkId: 'solana-mainnet',
      networkName: 'Solana Mainnet (Fast 400ms)',
      chainType: 'SOLANA',
      nativeCurrency: 'SOL',
      decimals: 9,
      minDeposit: 0.05,
      depositConfirmations: 32,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 0.005,
      minWithdrawal: 0.1,
      explorerTxUrl: 'https://solscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://solscan.io/account/{address}',
      rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    },
  ],
  DNA: [
    {
      networkId: 'dna-erc20',
      networkName: 'Ethereum (ERC-20 Hybrid Contract)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      contractAddress: '0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0',
      decimals: 2,
      minDeposit: 10,
      depositConfirmations: 12,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 25,
      minWithdrawal: 50,
      explorerTxUrl: 'https://etherscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://etherscan.io/address/{address}',
      rpcEndpoint: 'https://eth-mainnet.alchemyapi.io/v2/demo',
    },
    {
      networkId: 'dna-solana',
      networkName: 'Solana (SPL Compressed Utility)',
      chainType: 'SOLANA',
      nativeCurrency: 'SOL',
      contractAddress: 'DNAx3kP7xL9v6j2Y4bH8qF1mW5eT7rU9yZ4cV8nQ1wP',
      decimals: 2,
      minDeposit: 10,
      depositConfirmations: 32,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 10,
      minWithdrawal: 25,
      explorerTxUrl: 'https://solscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://solscan.io/account/{address}',
      rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    },
  ],
  AURORA: [
    {
      networkId: 'aurora-erc20',
      networkName: 'Ethereum (ERC-20 Initial Contract)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      contractAddress: '0xaaaa111122223333444455556666777788889999',
      decimals: 3,
      minDeposit: 1,
      depositConfirmations: 12,
      depositStatus: 'OPEN',
      withdrawalStatus: 'CLOSED', // Linked to initial listing schedule!
      withdrawalFee: 0.5,
      minWithdrawal: 5,
      explorerTxUrl: 'https://etherscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://etherscan.io/address/{address}',
      rpcEndpoint: 'https://eth-mainnet.alchemyapi.io/v2/demo',
    },
    {
      networkId: 'aurora-near',
      networkName: 'Aurora Engine (Near Protocol EVM)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      contractAddress: '0x7e44...aurora',
      decimals: 3,
      minDeposit: 0.5,
      depositConfirmations: 20,
      depositStatus: 'OPEN',
      withdrawalStatus: 'CLOSED',
      withdrawalFee: 0.1,
      minWithdrawal: 2,
      explorerTxUrl: 'https://explorer.mainnet.aurora.dev/tx/{txHash}',
      explorerAddressUrl: 'https://explorer.mainnet.aurora.dev/address/{address}',
      rpcEndpoint: 'https://mainnet.aurora.dev',
    },
  ],
  MOCK: [
    {
      networkId: 'mock-erc20',
      networkName: 'Ethereum Sepolia Testnet (ERC-20)',
      chainType: 'EVM',
      nativeCurrency: 'ETH',
      contractAddress: '0xmock99887766554433221100aabbccddeeff0011',
      decimals: 2,
      minDeposit: 5,
      depositConfirmations: 6,
      depositStatus: 'OPEN',
      withdrawalStatus: 'CLOSED',
      withdrawalFee: 2,
      minWithdrawal: 10,
      explorerTxUrl: 'https://sepolia.etherscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://sepolia.etherscan.io/address/{address}',
      rpcEndpoint: 'https://rpc.sepolia.org',
    },
  ],
};

export class AssetNetworkService {
  /**
   * Generates a deterministic on-chain address for asset and network
   */
  public static generateDeterministicAddress(asset: string, networkId: string, userId: string): DepositAddress {
    const assetNetworks = DEFAULT_NETWORKS[asset] || [];
    const network = assetNetworks.find((n) => n.networkId === networkId) || {
      networkId,
      networkName: networkId,
      chainType: networkId.toLowerCase().includes('sol')
        ? 'SOLANA'
        : networkId.toLowerCase().includes('btc')
        ? 'BITCOIN'
        : networkId.toLowerCase().includes('trc')
        ? 'TRON'
        : 'EVM',
      nativeCurrency: 'ETH',
      decimals: 18,
      minDeposit: 1,
      depositConfirmations: 12,
      depositStatus: 'OPEN',
      withdrawalStatus: 'OPEN',
      withdrawalFee: 1,
      minWithdrawal: 1,
      explorerTxUrl: 'https://etherscan.io/tx/{txHash}',
      explorerAddressUrl: 'https://etherscan.io/address/{address}',
    } as NetworkConfig;

    return this.generateDepositAddress(userId, asset, network);
  }

  /**
   * Generates a deterministic on-chain address for a user, asset, and network
   */
  public static generateDepositAddress(userId: string, asset: string, network: NetworkConfig): DepositAddress {
    // Deterministic pseudo-hashing based on userId + asset + networkId
    let hash = 0;
    const seed = `${userId}:${asset}:${network.networkId}:silentsmile_salt_2026`;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    const userSlice = userId.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'usr001';

    let address = '';
    let memoTag: string | undefined = undefined;

    switch (network.chainType) {
      case 'BITCOIN':
        address = `bc1q8sm${userSlice}${hex}f89k2p7x01z`;
        if (network.isMemoRequired) {
          memoTag = `${Math.abs(hash % 900000) + 100000}`;
        }
        break;
      case 'SOLANA':
        address = `SSm${userSlice}9x${hex}7KbPqRt2X1mY4zL9wF3vN8`;
        break;
      case 'TRON':
        address = `TSSm${userSlice}8x${hex}7KbPqRt2X1mY4zL9wF`.slice(0, 34);
        break;
      case 'EVM':
      default: {
        const hexHash = Math.abs(hash).toString(16).padStart(8, '0');
        let hash2 = 0;
        const seed2 = `evm:${network.networkId}:${asset}:${userId}`;
        for (let i = 0; i < seed2.length; i++) {
          hash2 = (hash2 << 5) - hash2 + seed2.charCodeAt(i);
          hash2 |= 0;
        }
        const hexHash2 = Math.abs(hash2).toString(16).padStart(8, '0');
        const userCleanHex = userSlice.split('').map((c) => (c.charCodeAt(0) % 16).toString(16)).join('');
        const rawHex = `${userCleanHex}${hexHash}${hexHash2}94d882a6b29c5b728d1b53049f86d9327ac05511`.slice(0, 40);
        address = `0x${rawHex}`;
        break;
      }
    }

    return {
      userId,
      asset,
      networkId: network.networkId,
      chainType: network.chainType,
      address,
      memoTag,
      createdAt: Date.now(),
    };
  }

  /**
   * Validates if an address matches chain syntax
   */
  public static validateAddressFormat(address: string, chainType: ChainType): { isValid: boolean; message?: string } {
    return this.validateDestinationAddress(address, chainType);
  }

  /**
   * Validates if a destination address conforms to the chain's syntax
   */
  public static validateDestinationAddress(address: string, chainType: ChainType): { isValid: boolean; message?: string } {
    if (!address || address.trim().length === 0) {
      return { isValid: false, message: 'Alamat tujuan penarikan tidak boleh kosong.' };
    }

    const trimmed = address.trim();

    switch (chainType) {
      case 'EVM':
        if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
          return { isValid: false, message: 'Alamat EVM harus diawali 0x dan terdiri dari 42 karakter heksadesimal.' };
        }
        break;
      case 'BITCOIN':
        if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(trimmed)) {
          return { isValid: false, message: 'Alamat Bitcoin tidak valid (wajib diawali 1, 3, atau bc1).' };
        }
        break;
      case 'SOLANA':
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
          return { isValid: false, message: 'Alamat Solana Base58 tidak valid (32-44 karakter alfanumerik).' };
        }
        break;
      case 'TRON':
        if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) {
          return { isValid: false, message: 'Alamat TRON tidak valid (wajib diawali huruf T dan 34 karakter).' };
        }
        break;
    }

    return { isValid: true };
  }

  /**
   * Harmonizes dynamic initial listings with the Asset & Network catalog
   */
  public static getAllAssets(
    initialListings: InitialListing[] = [],
    customNetworksMap?: Record<string, NetworkConfig[]>,
    customAssetsMap?: Record<string, AssetConfig>
  ): AssetConfig[] {
    const assetsMap: Record<string, AssetConfig> = {
      IDR: {
        symbol: 'IDR',
        name: 'Rupiah Indonesia (Virtual)',
        decimals: 0,
        category: 'FIAT',
        color: '#22D3EE',
        depositStatus: 'OPEN',
        withdrawalStatus: 'OPEN',
        primaryChain: 'Bank Indonesia / National Settlement',
        tokenStandard: 'Fiat / Virtual Account & QRIS',
        contractAddress: 'Bank Indonesia BI-FAST & QRIS Gateway',
        totalSupply: 1000000000000,
        maxSupply: null,
        circulatingSupply: 1000000000000,
        description: 'Mata uang fiat resmi Republik Indonesia untuk deposit instan via Virtual Account Bank (BCA, Mandiri) dan QRIS.',
        websiteUrl: 'https://www.bi.go.id',
        status: 'ACTIVE',
        networks: customNetworksMap?.['IDR'] || DEFAULT_NETWORKS['IDR'],
      },
      BTC: {
        symbol: 'BTC',
        name: 'Bitcoin (Spot)',
        decimals: 8,
        category: 'CRYPTO',
        color: '#F7931A',
        depositStatus: 'OPEN',
        withdrawalStatus: 'OPEN',
        primaryChain: 'Bitcoin Native (UTXO)',
        tokenStandard: 'Native (SegWit & Lightning)',
        contractAddress: 'Layer 1 Genesis Blockchain',
        totalSupply: 19780000,
        maxSupply: 21000000,
        circulatingSupply: 19780000,
        description: 'Aset kripto terdesentralisasi pertama di dunia dan penyimpan nilai digital dengan pasokan terbatas 21 Juta BTC.',
        websiteUrl: 'https://bitcoin.org',
        whitepaperUrl: 'https://bitcoin.org/bitcoin.pdf',
        explorerUrl: 'https://mempool.space',
        genesisDate: '2009-01-03',
        initialPrice: 1550000000,
        status: 'ACTIVE',
        networks: customNetworksMap?.['BTC'] || DEFAULT_NETWORKS['BTC'],
      },
      ETH: {
        symbol: 'ETH',
        name: 'Ethereum (Spot)',
        decimals: 18,
        category: 'CRYPTO',
        color: '#627EEA',
        depositStatus: 'OPEN',
        withdrawalStatus: 'OPEN',
        primaryChain: 'Ethereum Mainnet (EVM)',
        tokenStandard: 'Native / ERC-20 Standard Parent',
        contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        totalSupply: 120250000,
        maxSupply: null,
        circulatingSupply: 120250000,
        description: 'Platform komputasi terdesentralisasi dunia untuk smart contract, DeFi, dan ekosistem aplikasi Web3 global.',
        websiteUrl: 'https://ethereum.org',
        whitepaperUrl: 'https://ethereum.org/en/whitepaper/',
        explorerUrl: 'https://etherscan.io',
        genesisDate: '2015-07-30',
        initialPrice: 42500000,
        status: 'ACTIVE',
        networks: customNetworksMap?.['ETH'] || DEFAULT_NETWORKS['ETH'],
      },
      USDT: {
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        category: 'CRYPTO',
        color: '#26A17B',
        depositStatus: 'OPEN',
        withdrawalStatus: 'OPEN',
        primaryChain: 'TRON / Ethereum Multichain',
        tokenStandard: 'TRC-20 / ERC-20 / SPL',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        totalSupply: 118000000000,
        maxSupply: null,
        circulatingSupply: 118000000000,
        description: 'Stablecoin terbesar di dunia terpatok 1:1 terhadap Dolar AS yang didukung oleh cadangan kas dan surat berharga.',
        websiteUrl: 'https://tether.to',
        whitepaperUrl: 'https://tether.to/en/transparency/',
        explorerUrl: 'https://tronscan.org',
        genesisDate: '2014-10-06',
        initialPrice: 16200,
        status: 'ACTIVE',
        networks: customNetworksMap?.['USDT'] || DEFAULT_NETWORKS['USDT'],
      },
      SOL: {
        symbol: 'SOL',
        name: 'Solana (Spot)',
        decimals: 9,
        category: 'CRYPTO',
        color: '#14F195',
        depositStatus: 'OPEN',
        withdrawalStatus: 'OPEN',
        primaryChain: 'Solana (Sealevel Engine)',
        tokenStandard: 'Native (SPL Token)',
        contractAddress: 'So11111111111111111111111111111111111111112',
        totalSupply: 585000000,
        maxSupply: null,
        circulatingSupply: 468000000,
        description: 'Blockchain Layer 1 berkecepatan tinggi dengan mekanisme Proof of History untuk throughput transaksi hingga ribuan TPS.',
        websiteUrl: 'https://solana.com',
        whitepaperUrl: 'https://solana.com/solana-whitepaper.pdf',
        explorerUrl: 'https://solscan.io',
        genesisDate: '2020-03-16',
        initialPrice: 2850000,
        status: 'ACTIVE',
        networks: customNetworksMap?.['SOL'] || DEFAULT_NETWORKS['SOL'],
      },
      DNA: {
        symbol: 'DNA',
        name: 'Denata Network Asset (Local Token)',
        decimals: 2,
        category: 'TOKEN',
        color: '#8B5CF6',
        depositStatus: 'OPEN',
        withdrawalStatus: 'OPEN',
        primaryChain: 'Ethereum (ERC-20)',
        tokenStandard: 'ERC-20',
        contractAddress: '0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0',
        totalSupply: 500000000,
        maxSupply: 1000000000,
        circulatingSupply: 150000000,
        description: 'Denata Network Asset: Native utility dan governance token ekosistem likuiditas SilentSmile Exchange.',
        websiteUrl: 'https://denata.network',
        whitepaperUrl: 'https://denata.network/whitepaper',
        explorerUrl: 'https://etherscan.io/token/0x8894dB58F6961c0Fe908fF878D32dF88d752B3C0',
        genesisDate: '2024-01-15',
        initialPrice: 14500,
        status: 'ACTIVE',
        networks: customNetworksMap?.['DNA'] || DEFAULT_NETWORKS['DNA'],
      },
    };

    // Apply any custom created assets first
    if (customAssetsMap) {
      for (const [sym, customAsset] of Object.entries(customAssetsMap)) {
        if (!assetsMap[sym]) {
          assetsMap[sym] = {
            ...customAsset,
            networks: customNetworksMap?.[sym] || customAsset.networks || [],
          };
        } else {
          assetsMap[sym] = {
            ...assetsMap[sym],
            ...customAsset,
            networks: customNetworksMap?.[sym] || assetsMap[sym].networks,
          };
        }
      }
    }

    // Dynamically integrate assets from initial listings
    for (const listing of initialListings) {
      const baseAsset = listing.base_asset || listing.symbol.split('/')[0];
      if (!baseAsset || baseAsset === 'IDR') continue;

      const listingDepStatus: FeatureStatus = listing.deposit_status || 'CLOSED';
      const listingWtdStatus: FeatureStatus = listing.withdrawal_status || 'CLOSED';

      if (!assetsMap[baseAsset]) {
        // Synthesize dynamic asset configuration
        const networks = customNetworksMap?.[baseAsset] || DEFAULT_NETWORKS[baseAsset] || [
          {
            networkId: `${baseAsset.toLowerCase()}-erc20`,
            networkName: `Ethereum Mainnet (${baseAsset} ERC-20)`,
            chainType: 'EVM',
            nativeCurrency: 'ETH',
            contractAddress: `0x${baseAsset.toLowerCase()}000000000000000000000000000000000001`,
            decimals: listing.amount_precision ?? 2,
            minDeposit: 1,
            depositConfirmations: 12,
            depositStatus: listingDepStatus,
            withdrawalStatus: listingWtdStatus,
            withdrawalFee: 0.1,
            minWithdrawal: 1,
            explorerTxUrl: 'https://etherscan.io/tx/{txHash}',
            explorerAddressUrl: 'https://etherscan.io/address/{address}',
            rpcEndpoint: 'https://eth-mainnet.alchemyapi.io/v2/demo',
          },
          {
            networkId: `${baseAsset.toLowerCase()}-solana`,
            networkName: `Solana Network (${baseAsset} SPL)`,
            chainType: 'SOLANA',
            nativeCurrency: 'SOL',
            contractAddress: `Sol${baseAsset}TokenMintAddress1111111111111111111111`,
            decimals: listing.amount_precision ?? 2,
            minDeposit: 1,
            depositConfirmations: 32,
            depositStatus: listingDepStatus,
            withdrawalStatus: listingWtdStatus,
            withdrawalFee: 0.05,
            minWithdrawal: 1,
            explorerTxUrl: 'https://solscan.io/tx/{txHash}',
            explorerAddressUrl: 'https://solscan.io/account/{address}',
            rpcEndpoint: 'https://api.mainnet-beta.solana.com',
          },
        ];

        assetsMap[baseAsset] = {
          symbol: baseAsset,
          name: listing.name || `${baseAsset} Token`,
          decimals: listing.amount_precision ?? 2,
          category: 'TOKEN',
          color: '#A855F7',
          listingId: listing.id,
          depositStatus: listingDepStatus,
          withdrawalStatus: listingWtdStatus,
          depositOpensAt: listing.schedule?.deposit_opens_at,
          withdrawalOpensAt: listing.schedule?.withdrawal_opens_at,
          primaryChain: 'Ethereum (ERC-20) / Solana (SPL)',
          tokenStandard: 'ERC-20 & SPL Hybrid',
          contractAddress: `0x${baseAsset.toLowerCase()}000000000000000000000000000000000001`,
          totalSupply: 1000000000,
          maxSupply: 1000000000,
          circulatingSupply: 250000000,
          description: `Token resmi untuk proyek initial listing ${listing.name || baseAsset} di SilentSmile Exchange.`,
          initialPrice: listing.initial_price || 10000,
          status: 'ACTIVE',
          networks,
        };
      } else {
        // Link listing schedule to existing asset config
        assetsMap[baseAsset].listingId = listing.id;
        assetsMap[baseAsset].depositStatus = listingDepStatus;
        assetsMap[baseAsset].withdrawalStatus = listingWtdStatus;
        assetsMap[baseAsset].depositOpensAt = listing.schedule?.deposit_opens_at;
        assetsMap[baseAsset].withdrawalOpensAt = listing.schedule?.withdrawal_opens_at;
        if (!assetsMap[baseAsset].initialPrice && listing.initial_price) {
          assetsMap[baseAsset].initialPrice = listing.initial_price;
        }

        // Apply listing feature statuses down to networks if listing is CLOSED/SUSPENDED
        assetsMap[baseAsset].networks = assetsMap[baseAsset].networks.map((net) => ({
          ...net,
          depositStatus: listingDepStatus === 'CLOSED' ? 'CLOSED' : net.depositStatus,
          withdrawalStatus: listingWtdStatus === 'CLOSED' ? 'CLOSED' : net.withdrawalStatus,
        }));
      }
    }

    return Object.values(assetsMap);
  }

  /**
   * Retrieves active networks configured for a given asset symbol
   */
  public static getNetworksForAsset(symbol: string): NetworkConfig[] {
    const assets = this.getAllAssets();
    const asset = assets.find((a) => a.symbol.toUpperCase() === symbol.toUpperCase());
    return asset?.networks || DEFAULT_NETWORKS[symbol.toUpperCase()] || [];
  }

  /**
   * Generates a simulated transaction hash
   */
  public static generateSimulatedTxHash(chainType: ChainType): string {
    const chars = '0123456789abcdef';
    let res = '';
    for (let i = 0; i < 64; i++) {
      res += chars[Math.floor(Math.random() * chars.length)];
    }
    return chainType === 'SOLANA' ? res.slice(0, 44) : `0x${res}`;
  }

  /**
   * Evaluates if deposit is available for an asset and network given current listing schedule
   */
  public static isDepositAvailable(
    asset: AssetConfig,
    network: NetworkConfig,
    listing?: InitialListing,
    now: number = Date.now()
  ): { available: boolean; reason?: string; opensAt?: number } {
    if (listing) {
      if (listing.deposit_status === 'CLOSED') {
        const opensAt = listing.schedule?.deposit_opens_at || 0;
        if (opensAt > now) {
          const diffMs = opensAt - now;
          const hours = Math.floor(diffMs / 3600000);
          const mins = Math.floor((diffMs % 3600000) / 60000);
          return {
            available: false,
            reason: `Deposit ${asset.symbol} dijadwalkan buka dalam ${hours}j ${mins}m (${new Date(opensAt).toLocaleTimeString('id-ID')}).`,
            opensAt,
          };
        }
        return { available: false, reason: `Deposit ${asset.symbol} saat ini belum dibuka sesuai jadwal initial listing.` };
      }
      if (listing.deposit_status === 'SUSPENDED') {
        return { available: false, reason: `Deposit ${asset.symbol} saat ini ditangguhkan oleh pengelola exchange.` };
      }
      if (network.depositStatus === 'SUSPENDED') {
        return { available: false, reason: `Deposit via jaringan ${network.networkName} saat ini ditutup untuk pemeliharaan.` };
      }
      return { available: true };
    }

    if (asset.depositStatus === 'CLOSED' || asset.depositStatus === 'SUSPENDED') {
      return { available: false, reason: `Deposit ${asset.symbol} saat ini ditangguhkan oleh pengelola exchange.` };
    }
    if (network.depositStatus === 'CLOSED' || network.depositStatus === 'SUSPENDED') {
      return { available: false, reason: `Deposit via jaringan ${network.networkName} saat ini ditutup untuk pemeliharaan.` };
    }
    return { available: true };
  }

  /**
   * Evaluates if withdrawal is available for an asset and network given current listing schedule
   */
  public static isWithdrawalAvailable(
    asset: AssetConfig,
    network: NetworkConfig,
    listing?: InitialListing,
    now: number = Date.now()
  ): { available: boolean; reason?: string; opensAt?: number } {
    if (listing) {
      if (listing.withdrawal_status === 'CLOSED') {
        const opensAt = listing.schedule?.withdrawal_opens_at || 0;
        if (opensAt > now) {
          const diffMs = opensAt - now;
          const hours = Math.floor(diffMs / 3600000);
          const mins = Math.floor((diffMs % 3600000) / 60000);
          return {
            available: false,
            reason: `Penarikan ${asset.symbol} dijadwalkan buka dalam ${hours}j ${mins}m (${new Date(opensAt).toLocaleTimeString('id-ID')}).`,
            opensAt,
          };
        }
        return { available: false, reason: `Penarikan ${asset.symbol} saat ini belum dibuka sesuai jadwal initial listing.` };
      }
      if (listing.withdrawal_status === 'SUSPENDED') {
        return { available: false, reason: `Penarikan ${asset.symbol} saat ini ditangguhkan oleh pengelola exchange.` };
      }
      if (network.withdrawalStatus === 'SUSPENDED') {
        return { available: false, reason: `Penarikan via jaringan ${network.networkName} saat ini ditutup untuk pemeliharaan.` };
      }
      return { available: true };
    }

    if (asset.withdrawalStatus === 'CLOSED' || asset.withdrawalStatus === 'SUSPENDED') {
      return { available: false, reason: `Penarikan ${asset.symbol} saat ini ditangguhkan oleh pengelola exchange.` };
    }
    if (network.withdrawalStatus === 'CLOSED' || network.withdrawalStatus === 'SUSPENDED') {
      return { available: false, reason: `Penarikan via jaringan ${network.networkName} saat ini ditutup untuk pemeliharaan.` };
    }
    return { available: true };
  }

  /**
   * Alias for simulating an on-chain deposit
   */
  public static simulateOnChainDeposit(params: {
    userId: string;
    asset: string;
    network: NetworkConfig;
    amount: number;
    destinationAddress: string;
    txHash?: string;
  }): OnChainTransaction {
    return this.createSimulatedOnChainDeposit(params);
  }

  /**
   * Simulates an on-chain deposit event
   */
  public static createSimulatedOnChainDeposit(params: {
    userId: string;
    asset: string;
    network: NetworkConfig;
    amount: number;
    destinationAddress: string;
    txHash?: string;
  }): OnChainTransaction {
    const txHash = params.txHash || this.generateSimulatedTxHash(params.network.chainType);
    const explorerUrl = params.network.explorerTxUrl.replace('{txHash}', txHash);

    return {
      id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: params.userId,
      asset: params.asset,
      networkId: params.network.networkId,
      networkName: params.network.networkName,
      address: params.destinationAddress,
      amount: params.amount,
      txHash,
      confirmations: params.network.depositConfirmations,
      requiredConfirmations: params.network.depositConfirmations,
      status: 'confirmed',
      timestamp: Date.now(),
      explorerUrl,
    };
  }

  /**
   * Creates a withdrawal transaction record
   */
  public static createWithdrawalRecord(params: {
    userId: string;
    asset: string;
    network: NetworkConfig;
    destinationAddress: string;
    destinationBankName?: string;
    destinationAccountName?: string;
    bankName?: string;
    accountName?: string;
    memoTag?: string;
    amount: number;
    fee?: number;
    networkFee?: number;
  }): WithdrawalTransaction {
    const fee = params.fee ?? params.networkFee ?? params.network.withdrawalFee;
    const netAmount = Math.max(0, params.amount - fee);
    const txHash = this.generateSimulatedTxHash(params.network.chainType);
    const explorerUrl = params.network.explorerTxUrl.replace('{txHash}', txHash);

    return {
      id: `wtd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: params.userId,
      asset: params.asset,
      networkId: params.network.networkId,
      networkName: params.network.networkName,
      destinationAddress: params.destinationAddress,
      destinationBankName: params.destinationBankName || params.bankName,
      destinationAccountName: params.destinationAccountName || params.accountName,
      memoTag: params.memoTag,
      amount: params.amount,
      fee,
      networkFee: fee,
      netAmount,
      status: 'pending',
      txHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      explorerUrl,
    };
  }
}
