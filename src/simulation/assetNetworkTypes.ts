export type ChainType = 'EVM' | 'BITCOIN' | 'SOLANA' | 'TRON';

export type FeatureStatus = 'OPEN' | 'CLOSED' | 'SUSPENDED';

export interface NetworkConfig {
  networkId: string;
  networkName: string;
  chainType: ChainType;
  nativeCurrency: string;
  contractAddress?: string;
  decimals: number;
  minDeposit: number;
  depositConfirmations: number;
  depositStatus: FeatureStatus;
  withdrawalStatus: FeatureStatus;
  withdrawalFee: number;
  minWithdrawal: number;
  maxDailyWithdrawal?: number;
  isMemoRequired?: boolean;
  explorerTxUrl: string;
  explorerAddressUrl: string;
  rpcEndpoint?: string;
}

export type AssetCategory = 'FIAT' | 'CRYPTO' | 'TOKEN' | 'MEME' | 'RWA' | 'DEFI';

export interface AssetConfig {
  symbol: string;
  name: string;
  decimals: number;
  category: AssetCategory;
  color: string;
  listingId?: string;
  depositStatus: FeatureStatus;
  withdrawalStatus: FeatureStatus;
  depositOpensAt?: number;
  withdrawalOpensAt?: number;
  networks: NetworkConfig[];

  // Base Asset Specific Management Details
  primaryChain?: string;
  tokenStandard?: string;
  contractAddress?: string;
  totalSupply?: number;
  maxSupply?: number | null;
  circulatingSupply?: number;
  description?: string;
  websiteUrl?: string;
  whitepaperUrl?: string;
  explorerUrl?: string;
  genesisDate?: string;
  initialPrice?: number;
  status?: 'ACTIVE' | 'DELISTED' | 'HALTED';
}

export interface DepositAddress {
  userId: string;
  asset: string;
  networkId: string;
  chainType?: ChainType;
  address: string;
  memoTag?: string;
  createdAt: number;
}

export interface OnChainTransaction {
  id: string;
  userId: string;
  asset: string;
  networkId: string;
  networkName: string;
  address: string;
  memoTag?: string;
  amount: number;
  txHash: string;
  confirmations: number;
  requiredConfirmations: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  explorerUrl: string;
}

export interface WithdrawalTransaction {
  id: string;
  userId: string;
  asset: string;
  networkId: string;
  networkName: string;
  destinationAddress: string;
  destinationBankName?: string;
  destinationAccountName?: string;
  memoTag?: string;
  amount: number;
  fee: number;
  networkFee?: number;
  netAmount: number;
  status: 'pending' | 'pending_approval' | 'approved' | 'rejected' | 'completed';
  txHash?: string;
  approvedBy?: string;
  rejectReason?: string;
  rejectedReason?: string;
  createdAt: number;
  updatedAt: number;
  explorerUrl?: string;
}
