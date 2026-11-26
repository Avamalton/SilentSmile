import { describe, it, expect, beforeEach } from 'vitest';
import { AssetNetworkService } from '../src/simulation/assetNetworkService';
import { InitialListing, InitialListingSchedule } from '../src/simulation/listingTypes';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';

describe('Asset & Network Management System (Hybrid Simulation & On-Chain Architecture)', () => {
  const sampleSchedule: InitialListingSchedule = {
    announcement_at: 100000,
    mm_funding_opens_at: 120000,
    mm_setup_opens_at: 150000,
    public_trading_opens_at: 200000,
    deposit_opens_at: 120000, // opens at 120,000
    withdrawal_opens_at: 300000, // opens at 300,000
    new_badge_expires_at: 500000,
    min_base_inventory: 1000,
    min_quote_inventory: 50000000,
    target_spread_bps: 30,
    min_depth_levels: 4,
    schedule_version: 1,
  };

  const sampleListing: InitialListing = {
    id: 'list_test_pair_solara',
    symbol: 'SOLARA/IDR',
    base_asset: 'SOLARA',
    quote_asset: 'IDR',
    name: 'Solara Protocol',
    category: 'DEFI',
    status: 'PREPARING',
    mm_preparation_phase: 'NOT_STARTED',
    trading_status: 'CLOSED',
    deposit_status: 'CLOSED',
    withdrawal_status: 'CLOSED',
    visibility: 'UPCOMING',
    initial_price: 25000,
    price_precision: 0,
    amount_precision: 2,
    min_order_amount: 1,
    maker_fee_bps: 10,
    taker_fee_bps: 15,
    assigned_mm_account: 'usr_mm_01',
    schedule: sampleSchedule,
    created_at: 90000,
    updated_at: 90000,
    audit_trail: [],
  };

  describe('1. Deterministic Address Generation Across Chains', () => {
    it('generates a valid EVM address starting with 0x for Ethereum/Arbitrum/Base', () => {
      const addr = AssetNetworkService.generateDeterministicAddress('USDT', 'usdt-erc20', 'usr_demo_01');
      expect(addr.address.startsWith('0x')).toBe(true);
      expect(addr.address.length).toBe(42);
      expect(addr.chainType).toBe('EVM');
    });

    it('generates a valid Bitcoin Bech32 address starting with bc1', () => {
      const addr = AssetNetworkService.generateDeterministicAddress('BTC', 'btc-mainnet', 'usr_demo_01');
      expect(addr.address.startsWith('bc1q')).toBe(true);
      expect(addr.chainType).toBe('BITCOIN');
    });

    it('generates a valid Solana address', () => {
      const addr = AssetNetworkService.generateDeterministicAddress('SOL', 'solana-mainnet', 'usr_demo_01');
      expect(addr.address.length).toBeGreaterThanOrEqual(32);
      expect(addr.chainType).toBe('SOLANA');
    });

    it('generates a valid TRON address starting with T for TRC-20', () => {
      const addr = AssetNetworkService.generateDeterministicAddress('USDT', 'usdt-trc20', 'usr_demo_01');
      expect(addr.address.startsWith('T')).toBe(true);
      expect(addr.address.length).toBe(34);
      expect(addr.chainType).toBe('TRON');
    });

    it('produces identical deterministic addresses for the same user, asset, and network', () => {
      const addr1 = AssetNetworkService.generateDeterministicAddress('USDT', 'usdt-arbitrum', 'usr_trader_42');
      const addr2 = AssetNetworkService.generateDeterministicAddress('USDT', 'usdt-arbitrum', 'usr_trader_42');
      expect(addr1.address).toBe(addr2.address);
    });

    it('produces distinct deposit addresses for different user IDs (isolated user accounting)', () => {
      const addrAlice = AssetNetworkService.generateDeterministicAddress('ETH', 'eth-mainnet', 'usr_alice');
      const addrBob = AssetNetworkService.generateDeterministicAddress('ETH', 'eth-mainnet', 'usr_bob');
      expect(addrAlice.address).not.toBe(addrBob.address);
    });
  });

  describe('2. Address Format Validation by Chain Type', () => {
    it('validates EVM addresses accurately', () => {
      const validEvm = '0xdac17f958d2ee523a2206206994597c13d831ec7';
      const invalidEvm = '0xinvalid_evm_not_hex';
      const shortEvm = '0x12345';

      expect(AssetNetworkService.validateAddressFormat(validEvm, 'EVM').isValid).toBe(true);
      expect(AssetNetworkService.validateAddressFormat(invalidEvm, 'EVM').isValid).toBe(false);
      expect(AssetNetworkService.validateAddressFormat(shortEvm, 'EVM').isValid).toBe(false);
    });

    it('validates Bitcoin addresses accurately', () => {
      const validBech32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
      const validLegacy = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
      const invalidBtc = 'invalid_btc_address';

      expect(AssetNetworkService.validateAddressFormat(validBech32, 'BITCOIN').isValid).toBe(true);
      expect(AssetNetworkService.validateAddressFormat(validLegacy, 'BITCOIN').isValid).toBe(true);
      expect(AssetNetworkService.validateAddressFormat(invalidBtc, 'BITCOIN').isValid).toBe(false);
    });

    it('validates Solana Base58 addresses accurately', () => {
      const validSol = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
      const invalidSol = 'Solana with spaces and 0 O I l forbidden chars!';

      expect(AssetNetworkService.validateAddressFormat(validSol, 'SOLANA').isValid).toBe(true);
      expect(AssetNetworkService.validateAddressFormat(invalidSol, 'SOLANA').isValid).toBe(false);
    });

    it('validates TRON addresses accurately', () => {
      const validTron = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
      const invalidTron = '0x71C...not_tron';

      expect(AssetNetworkService.validateAddressFormat(validTron, 'TRON').isValid).toBe(true);
      expect(AssetNetworkService.validateAddressFormat(invalidTron, 'TRON').isValid).toBe(false);
    });
  });

  describe('3. Dynamic Asset Catalog Harmonization with Initial Listings', () => {
    it('returns core exchange assets and provisions dynamic networks for initial listed tokens', () => {
      const assets = AssetNetworkService.getAllAssets([sampleListing]);
      const symbols = assets.map((a) => a.symbol);

      expect(symbols).toContain('IDR');
      expect(symbols).toContain('BTC');
      expect(symbols).toContain('ETH');
      expect(symbols).toContain('USDT');
      expect(symbols).toContain('SOL');
      expect(symbols).toContain('DNA');
      expect(symbols).toContain('SOLARA');

      const solara = assets.find((a) => a.symbol === 'SOLARA');
      expect(solara).toBeDefined();
      expect(solara?.listingId).toBe(sampleListing.id);
      expect(solara?.networks.length).toBeGreaterThanOrEqual(2);
      expect(solara?.networks.some((n) => n.chainType === 'EVM')).toBe(true);
      expect(solara?.networks.some((n) => n.chainType === 'SOLANA')).toBe(true);
    });

    it('synchronizes deposit and withdrawal availability with initial listing schedule', () => {
      const assets = AssetNetworkService.getAllAssets([sampleListing]);
      const solara = assets.find((a) => a.symbol === 'SOLARA')!;
      const evmNet = solara.networks.find((n) => n.chainType === 'EVM')!;

      // At timestamp 100,000 (before deposit_opens_at 120,000)
      const depBefore = AssetNetworkService.isDepositAvailable(solara, evmNet, sampleListing, 100000);
      expect(depBefore.available).toBe(false);
      expect(depBefore.reason).toContain('dijadwalkan buka');

      // Update listing to OPEN deposit after 120,000
      const openListing: InitialListing = {
        ...sampleListing,
        deposit_status: 'OPEN',
      };
      const depAfter = AssetNetworkService.isDepositAvailable(solara, evmNet, openListing, 125000);
      expect(depAfter.available).toBe(true);

      // At timestamp 250,000 (before withdrawal_opens_at 300,000)
      const wtdBefore = AssetNetworkService.isWithdrawalAvailable(solara, evmNet, openListing, 250000);
      expect(wtdBefore.available).toBe(false);
      expect(wtdBefore.reason).toContain('dijadwalkan buka');

      // Update listing to OPEN withdrawal after 300,000
      const liveListing: InitialListing = {
        ...openListing,
        withdrawal_status: 'OPEN',
      };
      const wtdAfter = AssetNetworkService.isWithdrawalAvailable(solara, evmNet, liveListing, 350000);
      expect(wtdAfter.available).toBe(true);
    });
  });

  describe('4. Simulated On-Chain Deposit Execution', () => {
    it('creates on-chain transaction record with confirmations, txHash, and explorer url', () => {
      const assets = AssetNetworkService.getAllAssets([sampleListing]);
      const usdt = assets.find((a) => a.symbol === 'USDT')!;
      const trc20 = usdt.networks.find((n) => n.networkId === 'usdt-trc20')!;

      const tx = AssetNetworkService.simulateOnChainDeposit({
        userId: 'usr_trader_01',
        asset: 'USDT',
        network: trc20,
        amount: 250,
        destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      });

      expect(tx.id.startsWith('ctx_')).toBe(true);
      expect(tx.status).toBe('confirmed');
      expect(tx.confirmations).toBe(trc20.depositConfirmations);
      expect(tx.explorerUrl).toContain('tronscan.org');
      expect(tx.amount).toBe(250);
    });
  });

  describe('5. Withdrawal Record & Double-Entry Ledger Preparation', () => {
    it('computes net receive amount subtracting network fee', () => {
      const assets = AssetNetworkService.getAllAssets([sampleListing]);
      const eth = assets.find((a) => a.symbol === 'ETH')!;
      const arbitrum = eth.networks.find((n) => n.networkId === 'eth-arbitrum')!;

      const record = AssetNetworkService.createWithdrawalRecord({
        userId: 'usr_trader_01',
        asset: 'ETH',
        network: arbitrum,
        amount: 2.5,
        destinationAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      });

      expect(record.status).toBe('pending');
      expect(record.networkFee).toBe(arbitrum.withdrawalFee);
      expect(record.netAmount).toBe(2.5 - arbitrum.withdrawalFee);
      expect(record.destinationAddress).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7');
    });
  });

  describe('6. SQLite Database Storage for Assets & Networks', () => {
    it('migrates and seeds assets table with core and initial listing assets', async () => {
      const dbMgr = DatabaseManager.createIsolated(':memory:');
      await dbMgr.initialize();
      await runMigrations(dbMgr);

      const rows = dbMgr.query<any>('SELECT * FROM assets');
      const symbols = rows.map((r) => r.symbol);

      expect(symbols).toContain('IDR');
      expect(symbols).toContain('BTC');
      expect(symbols).toContain('ETH');
      expect(symbols).toContain('USDT');
      expect(symbols).toContain('SOL');
      expect(symbols).toContain('DNA');
      expect(symbols).toContain('AURORA');
      expect(symbols).toContain('MOCK');
    });

    it('migrates and seeds asset_networks table with multichain entries', async () => {
      const dbMgr = DatabaseManager.createIsolated(':memory:');
      await dbMgr.initialize();
      await runMigrations(dbMgr);

      const usdtNetworks = dbMgr.query<any>(
        'SELECT an.* FROM asset_networks an JOIN assets a ON an.asset_id = a.id WHERE a.symbol = ?',
        ['USDT']
      );

      expect(usdtNetworks.length).toBeGreaterThanOrEqual(4);
      const netIds = usdtNetworks.map((n) => n.network_id);
      expect(netIds).toContain('usdt-trc20');
      expect(netIds).toContain('usdt-erc20');
      expect(netIds).toContain('usdt-arbitrum');
      expect(netIds).toContain('usdt-solana');
    });
  });
});
