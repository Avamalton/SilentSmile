import { AssetInfo, MarketPair, UserProfile } from './types';

export const ASSETS: Record<string, AssetInfo> = {
  IDR: {
    symbol: 'IDR',
    name: 'Indonesian Rupiah (Virtual)',
    decimals: 0,
    color: '#22D3EE',
    description: 'Virtual Indonesian Rupiah used for demo simulation transactions only.',
  },
  BTC: {
    symbol: 'BTC',
    name: 'Bitcoin (Simulated)',
    decimals: 6,
    color: '#F7931A',
    description: 'Simulated Bitcoin spot asset pegged to demonstration price data.',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum (Simulated)',
    decimals: 5,
    color: '#627EEA',
    description: 'Simulated Ethereum spot asset for decentralized application testing.',
  },
  SOL: {
    symbol: 'SOL',
    name: 'Solana (Simulated)',
    decimals: 4,
    color: '#14F195',
    description: 'Simulated high-throughput Solana network asset for demo trading.',
  },
  DNA: {
    symbol: 'DNA',
    name: 'Denata Network Asset (Simulated Local Token)',
    decimals: 2,
    isLocalToken: true,
    color: '#8B5CF6',
    description: 'Simulated Indonesian local utility token archetype for regional community ecosystem testing.',
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD (Simulated Demo)',
    decimals: 2,
    color: '#26A17B',
    description: 'Simulated USD-pegged stablecoin archetype strictly for practice.',
  },
};

export const DEFAULT_MARKETS: MarketPair[] = [
  {
    id: 'BTC/IDR',
    baseAsset: 'BTC',
    quoteAsset: 'IDR',
    name: 'Bitcoin / Rupiah',
    lastPrice: 1485600000, // Rp 1,485,600,000
    change24h: 3.42,
    high24h: 1512000000,
    low24h: 1445000000,
    volume24h: 42850000000, // Rp 42.85B
    priceDecimals: 0,
    amountDecimals: 5,
    minOrderAmount: 0.0001,
    makerFeeBps: 10, // 0.10%
    takerFeeBps: 15, // 0.15%
    isActive: true,
    isFavorite: true,
  },
  {
    id: 'ETH/IDR',
    baseAsset: 'ETH',
    quoteAsset: 'IDR',
    name: 'Ethereum / Rupiah',
    lastPrice: 52450000, // Rp 52,450,000
    change24h: -1.18,
    high24h: 53900000,
    low24h: 51800000,
    volume24h: 21600000000, // Rp 21.6B
    priceDecimals: 0,
    amountDecimals: 4,
    minOrderAmount: 0.002,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: true,
    isFavorite: true,
  },
  {
    id: 'SOL/IDR',
    baseAsset: 'SOL',
    quoteAsset: 'IDR',
    name: 'Solana / Rupiah',
    lastPrice: 2865000, // Rp 2,865,000
    change24h: 6.84,
    high24h: 2940000,
    low24h: 2680000,
    volume24h: 15200000000, // Rp 15.2B
    priceDecimals: 0,
    amountDecimals: 3,
    minOrderAmount: 0.05,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: true,
    isFavorite: false,
  },
  {
    id: 'DNA/IDR',
    baseAsset: 'DNA',
    quoteAsset: 'IDR',
    name: 'Denata Network / Rupiah (Simulated Local Token)',
    lastPrice: 14250, // Rp 14,250
    change24h: 12.35,
    high24h: 15100,
    low24h: 12600,
    volume24h: 6420000000, // Rp 6.42B
    priceDecimals: 0,
    amountDecimals: 2,
    minOrderAmount: 1,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: true,
    isFavorite: true,
  },
  {
    id: 'USDT/IDR',
    baseAsset: 'USDT',
    quoteAsset: 'IDR',
    name: 'Tether USD / Rupiah',
    lastPrice: 16180, // Rp 16,180
    change24h: 0.06,
    high24h: 16210,
    low24h: 16150,
    volume24h: 78900000000, // Rp 78.9B
    priceDecimals: 0,
    amountDecimals: 2,
    minOrderAmount: 1,
    makerFeeBps: 5,
    takerFeeBps: 10,
    isActive: true,
    isFavorite: false,
    tradingAccessStatus: 'OPEN',
  },
  {
    id: 'MOCK/IDR',
    baseAsset: 'MOCK',
    quoteAsset: 'IDR',
    name: 'Mock Token (Pre-Launch)',
    lastPrice: 25000,
    change24h: 0,
    high24h: 25000,
    low24h: 25000,
    volume24h: 0,
    priceDecimals: 0,
    amountDecimals: 2,
    minOrderAmount: 1,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: true,
    isFavorite: false,
    tradingAccessStatus: 'PREPARATION_ONLY',
    listingId: 'list_mock_01',
  },
  {
    id: 'AURORA/IDR',
    baseAsset: 'AURORA',
    quoteAsset: 'IDR',
    name: 'Aurora Protocol (Upcoming)',
    lastPrice: 85000,
    change24h: 0,
    high24h: 85000,
    low24h: 85000,
    volume24h: 0,
    priceDecimals: 0,
    amountDecimals: 2,
    minOrderAmount: 0.1,
    makerFeeBps: 10,
    takerFeeBps: 15,
    isActive: false,
    isFavorite: false,
    tradingAccessStatus: 'CLOSED',
    listingId: 'list_aurora_01',
  },
];

export const DEMO_USERS: UserProfile[] = [
  {
    id: 'usr_trader_01',
    name: 'Arya Pratama',
    email: 'arya.pratama@demo.silentsmile.io',
    role: 'trader',
    avatarUrl: '/src/assets/images/avatar_demo_trader_1792254529026.jpg',
    tier: 'Retail Swing Trader',
    createdAt: Date.now() - 86400000 * 45,
  },
  {
    id: 'usr_trader_02',
    name: 'Budi Santoso',
    email: 'budi.santoso@demo.silentsmile.io',
    role: 'trader',
    avatarUrl: '/src/assets/images/avatar_demo_trader_1792254529026.jpg',
    tier: 'DNA Local Whale & Ecosystem Angel',
    createdAt: Date.now() - 86400000 * 90,
  },
  {
    id: 'usr_mm_01',
    name: 'Nexus Liquidity Bot',
    email: 'mm.nexus@liquidity.silentsmile.io',
    role: 'market_maker',
    avatarUrl: '/src/assets/images/avatar_demo_admin_1792254528764.jpg',
    tier: 'Designated Market Maker (DMM)',
    createdAt: Date.now() - 86400000 * 120,
  },
  {
    id: 'usr_admin_01',
    name: 'Dr. Sarah Danubrata',
    email: 'sarah.danubrata@silentsmile.io',
    role: 'admin',
    avatarUrl: '/src/assets/images/avatar_demo_admin_1792254528764.jpg',
    tier: 'Exchange Systems Administrator',
    createdAt: Date.now() - 86400000 * 180,
  },
  {
    id: 'usr_autotrader_01',
    name: 'Algorithmic Flow Bot',
    email: 'flow.algo@bots.silentsmile.io',
    role: 'trader',
    avatarUrl: '/src/assets/images/avatar_demo_trader_1792254529026.jpg',
    tier: 'Quantitative Flow & Volume Taker',
    createdAt: Date.now() - 86400000 * 30,
  },
  {
    id: 'usr_treasury_01',
    name: 'Exchange Treasury Vault',
    email: 'treasury@silentsmile.io',
    role: 'admin',
    avatarUrl: '/src/assets/images/avatar_demo_admin_1792254528764.jpg',
    tier: 'Virtual Reserve Liquidity Provider',
    createdAt: Date.now() - 86400000 * 365,
  },
];

export const MULTI_USER_INITIAL_BALANCES: Record<string, Record<string, { free: number; locked: number }>> = {
  usr_trader_01: {
    // Retail trader: Modest IDR, small crypto holdings, moderate DNA
    IDR: { free: 85000000, locked: 0 }, // Rp 85,000,000
    BTC: { free: 0.045, locked: 0 },
    ETH: { free: 0.85, locked: 0 },
    SOL: { free: 8.5, locked: 0 },
    DNA: { free: 15000, locked: 0 },
    USDT: { free: 1800, locked: 0 },
  },
  usr_trader_02: {
    // DNA Local Whale: Huge DNA stash, significant IDR capital
    IDR: { free: 420000000, locked: 0 }, // Rp 420,000,000
    BTC: { free: 0.18, locked: 0 },
    ETH: { free: 2.5, locked: 0 },
    SOL: { free: 25.0, locked: 0 },
    DNA: { free: 450000, locked: 0 }, // 450,000 DNA local tokens!
    USDT: { free: 12500, locked: 0 },
  },
  usr_mm_01: {
    // Designated Market Maker: Massive liquidity pool dedicated to quoting order book depth & walls
    IDR: { free: 3500000000, locked: 0 }, // Rp 3,500,000,000
    BTC: { free: 25.0, locked: 0 },
    ETH: { free: 250.0, locked: 0 },
    SOL: { free: 2500.0, locked: 0 },
    DNA: { free: 2500000, locked: 0 }, // 2.5 Million DNA tokens
    USDT: { free: 750000, locked: 0 },
    MOCK: { free: 1000, locked: 0 },
    AURORA: { free: 500, locked: 0 },
  },
  usr_admin_01: {
    // Exchange Systems Admin: Large test reserve
    IDR: { free: 5000000000, locked: 0 }, // Rp 5,000,000,000
    BTC: { free: 5.0, locked: 0 },
    ETH: { free: 50.0, locked: 0 },
    SOL: { free: 500.0, locked: 0 },
    DNA: { free: 1000000, locked: 0 }, // 1,000,000 DNA
    USDT: { free: 250000, locked: 0 },
    MOCK: { free: 10000, locked: 0 },
    AURORA: { free: 5000, locked: 0 },
  },
  usr_autotrader_01: {
    // Algorithmic Flow Bot: Capital pool to cross resting MM quotes without polluting user history
    IDR: { free: 5000000000, locked: 0 }, // Rp 5,000,000,000
    BTC: { free: 50.0, locked: 0 },
    ETH: { free: 500.0, locked: 0 },
    SOL: { free: 5000.0, locked: 0 },
    DNA: { free: 500000, locked: 0 },
    USDT: { free: 500000, locked: 0 },
    MOCK: { free: 20000, locked: 0 },
    AURORA: { free: 10000, locked: 0 },
  },
  usr_treasury_01: {
    // Exchange Virtual Treasury: Capital reserve used to fund new token initial MM liquidity allocations
    IDR: { free: 50000000000, locked: 0 }, // Rp 50,000,000,000
    BTC: { free: 1000.0, locked: 0 },
    ETH: { free: 10000.0, locked: 0 },
    SOL: { free: 100000.0, locked: 0 },
    DNA: { free: 50000000, locked: 0 }, // 50,000,000 DNA
    USDT: { free: 10000000, locked: 0 },
    MOCK: { free: 5000000, locked: 0 },
    AURORA: { free: 2500000, locked: 0 },
  },
};

export const INITIAL_USER_BALANCES: Record<string, { free: number; locked: number }> =
  MULTI_USER_INITIAL_BALANCES['usr_trader_01'];

