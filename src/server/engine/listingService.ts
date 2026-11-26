import { DatabaseManager } from '../db/database';
import { LedgerService } from '../ledger/ledgerService';
import { EngineManager } from '../engine/engineManager';

export interface CreatePairDraftParams {
  baseAsset: string;
  quoteAsset: string;
  symbol: string;
  name: string;
  category?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  tickSize?: number;
  quantityStepSize?: number;
  minQuantity?: number;
  minNotional?: number;
  makerFeeBps?: number;
  takerFeeBps?: number;
  initialPrice?: number;
  assignedMMAccount?: string;
  notes?: string;
  actorId: string;
}

export interface ScheduleListingParams {
  timezone?: string;
  scheduledListingAt: number;
  mmFundingOpensAt: number;
  mmSetupOpensAt: number;
  tradingOpensAt: number;
  depositOpensAt: number;
  withdrawalOpensAt: number;
  newBadgeExpiresAt?: number;
  minBaseInventory: number;
  minQuoteInventory: number;
  minBidDepth?: number;
  minAskDepth?: number;
  maxInitialSpreadPct?: number;
  reason?: string;
  actorId: string;
}

export class ListingService {
  constructor(
    private dbMgr: DatabaseManager,
    private ledgerService: LedgerService,
    private engineManager: EngineManager
  ) {}

  public getAllListings() {
    const listings = this.dbMgr.query<any>(`
      SELECT l.*, 
             s.timezone, s.scheduled_listing_at, s.mm_funding_opens_at, s.mm_setup_opens_at,
             s.trading_opens_at, s.deposit_opens_at, s.withdrawal_opens_at,
             s.minimum_mm_base_inventory, s.minimum_mm_quote_inventory,
             s.minimum_bid_depth, s.minimum_ask_depth, s.maximum_initial_spread_pct,
             s.schedule_version, s.reschedule_reason
      FROM listings l
      LEFT JOIN listing_schedules s ON l.id = s.listing_id
      ORDER BY l.created_at DESC
    `);

    return listings.map((l) => ({
      ...l,
      schedule: {
        announcement_at: l.scheduled_at || l.created_at,
        mm_funding_opens_at: l.mm_funding_opens_at,
        mm_setup_opens_at: l.mm_setup_opens_at,
        public_trading_opens_at: l.trading_opens_at,
        deposit_opens_at: l.deposit_opens_at,
        withdrawal_opens_at: l.withdrawal_opens_at,
        new_badge_expires_at: l.new_badge_expires_at,
        min_base_inventory: l.minimum_mm_base_inventory,
        min_quote_inventory: l.minimum_mm_quote_inventory,
        target_spread_bps: Math.round((l.maximum_initial_spread_pct || 0.4) * 100),
        min_depth_levels: l.minimum_bid_depth || 5,
        schedule_version: l.schedule_version || 1,
      },
    }));
  }

  public getListingById(id: string) {
    const listing = this.dbMgr.queryOne<any>(`
      SELECT l.*, 
             s.timezone, s.scheduled_listing_at, s.mm_funding_opens_at, s.mm_setup_opens_at,
             s.trading_opens_at, s.deposit_opens_at, s.withdrawal_opens_at,
             s.minimum_mm_base_inventory, s.minimum_mm_quote_inventory,
             s.minimum_bid_depth, s.minimum_ask_depth, s.maximum_initial_spread_pct,
             s.schedule_version, s.reschedule_reason
      FROM listings l
      LEFT JOIN listing_schedules s ON l.id = s.listing_id
      WHERE l.id = ?
    `, [id]);

    if (!listing) return null;

    const events = this.dbMgr.query<any>(`
      SELECT * FROM listing_events WHERE listing_id = ? ORDER BY timestamp DESC
    `, [id]);

    return {
      ...listing,
      audit_trail: events,
      schedule: {
        announcement_at: listing.scheduled_at || listing.created_at,
        mm_funding_opens_at: listing.mm_funding_opens_at,
        mm_setup_opens_at: listing.mm_setup_opens_at,
        public_trading_opens_at: listing.trading_opens_at,
        deposit_opens_at: listing.deposit_opens_at,
        withdrawal_opens_at: listing.withdrawal_opens_at,
        new_badge_expires_at: listing.new_badge_expires_at,
        min_base_inventory: listing.minimum_mm_base_inventory,
        min_quote_inventory: listing.minimum_mm_quote_inventory,
        target_spread_bps: Math.round((listing.maximum_initial_spread_pct || 0.4) * 100),
        min_depth_levels: listing.minimum_bid_depth || 5,
        schedule_version: listing.schedule_version || 1,
      },
    };
  }

  public createMarketPairDraft(params: CreatePairDraftParams) {
    const base = params.baseAsset.trim().toUpperCase();
    const quote = params.quoteAsset.trim().toUpperCase();
    const symbol = `${base}/${quote}`;

    if (!base || !quote) {
      throw new Error('Both base and quote assets must be specified.');
    }
    if (base === quote) {
      throw new Error('Base and quote asset cannot be the same asset.');
    }

    const existing = this.dbMgr.queryOne('SELECT id FROM market_pairs WHERE id = ?', [symbol]);
    if (existing) {
      throw new Error(`Market pair ${symbol} already exists.`);
    }

    const now = Date.now();
    const listingId = `list_${base.toLowerCase()}_${Date.now()}`;
    const initialPrice = params.initialPrice || 10000;

    this.dbMgr.transaction(() => {
      // 1. Create inactive market_pair row
      this.dbMgr.execute(
        `INSERT INTO market_pairs (
          id, base_asset, quote_asset, base_precision, quote_precision, min_order_size,
          maker_fee_bps, taker_fee_bps, is_active, trading_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'CLOSED')`,
        [
          symbol,
          base,
          quote,
          params.quantityPrecision ?? 2,
          params.pricePrecision ?? 0,
          params.minQuantity ?? 1,
          params.makerFeeBps ?? 10,
          params.takerFeeBps ?? 15,
        ]
      );

      // 2. Create listing row in DRAFT
      this.dbMgr.execute(
        `INSERT INTO listings (
          id, market_id, status, mm_phase, trading_status, deposit_status, withdrawal_status,
          public_visibility, assigned_mm_account, initial_price, price_precision, amount_precision,
          min_order_amount, maker_fee_bps, taker_fee_bps, review_notes, version, created_at, updated_at
        ) VALUES (?, ?, 'DRAFT', 'NOT_STARTED', 'CLOSED', 'CLOSED', 'CLOSED', 'HIDDEN', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          listingId,
          symbol,
          params.assignedMMAccount || 'usr_mm_01',
          initialPrice,
          params.pricePrecision ?? 0,
          params.quantityPrecision ?? 2,
          params.minQuantity ?? 1,
          params.makerFeeBps ?? 10,
          params.takerFeeBps ?? 15,
          params.notes || '',
          now,
          now,
        ]
      );

      // 3. Audit Event
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, 'MARKET_PAIR_CREATED', 'NONE', 'DRAFT', ?, ?, 1, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          params.actorId,
          now,
          JSON.stringify({ symbol, base, quote, initialPrice }),
        ]
      );
    });

    return this.getListingById(listingId);
  }

  public reviewListing(listingId: string, action: 'submit' | 'approve' | 'reject' | 'draft', reviewerId: string, reason?: string) {
    const listing = this.dbMgr.queryOne<any>('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');

    const from = listing.status;
    let target = from;

    if (action === 'submit') {
      if (from !== 'DRAFT') throw new Error(`Cannot submit listing from ${from}`);
      target = 'UNDER_REVIEW';
    } else if (action === 'approve') {
      if (from !== 'UNDER_REVIEW') throw new Error(`Cannot approve listing from ${from}`);
      target = 'APPROVED';
    } else if (action === 'reject') {
      target = 'CANCELLED';
    } else if (action === 'draft') {
      target = 'DRAFT';
    }

    const now = Date.now();
    this.dbMgr.transaction(() => {
      this.dbMgr.execute(
        `UPDATE listings SET status = ?, approved_by = ?, approved_at = ?, review_notes = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [target, action === 'approve' ? reviewerId : listing.approved_by, action === 'approve' ? now : listing.approved_at, reason || listing.review_notes, now, listingId]
      );

      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          `LISTING_${action.toUpperCase()}`,
          from,
          target,
          reviewerId,
          now,
          listing.version + 1,
          JSON.stringify({ reason }),
        ]
      );
    });

    return this.getListingById(listingId);
  }

  public scheduleListing(listingId: string, params: ScheduleListingParams) {
    const listing = this.dbMgr.queryOne<any>('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');

    if (listing.status !== 'APPROVED' && listing.status !== 'SCHEDULED' && listing.status !== 'POSTPONED') {
      throw new Error(`Cannot schedule listing with status ${listing.status}. Must be APPROVED first.`);
    }

    const now = Date.now();
    // Validate timeline sequence
    if (params.mmFundingOpensAt > params.tradingOpensAt) {
      throw new Error('MM funding open time must be before or equal to trading open time.');
    }
    if (params.mmSetupOpensAt < params.mmFundingOpensAt) {
      throw new Error('MM setup open time must be after or equal to MM funding open time.');
    }
    if (params.mmSetupOpensAt > params.tradingOpensAt) {
      throw new Error('MM setup open time cannot be after trading open time.');
    }

    const scheduleId = `sch_${listingId}`;
    const tz = params.timezone || 'Asia/Jakarta';
    const badgeExpiry = params.newBadgeExpiresAt || (params.tradingOpensAt + 86400000 * 3);

    this.dbMgr.transaction(() => {
      // Upsert schedule
      this.dbMgr.execute(`DELETE FROM listing_schedules WHERE listing_id = ?`, [listingId]);
      this.dbMgr.execute(
        `INSERT INTO listing_schedules (
          id, listing_id, market_id, timezone, scheduled_listing_at, mm_funding_opens_at,
          mm_setup_opens_at, trading_opens_at, new_badge_expires_at, deposit_opens_at,
          withdrawal_opens_at, minimum_mm_base_inventory, minimum_mm_quote_inventory,
          minimum_bid_depth, minimum_ask_depth, maximum_initial_spread_pct, schedule_version,
          created_by, created_at, updated_at, reschedule_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scheduleId,
          listingId,
          listing.market_id,
          tz,
          params.scheduledListingAt,
          params.mmFundingOpensAt,
          params.mmSetupOpensAt,
          params.tradingOpensAt,
          badgeExpiry,
          params.depositOpensAt,
          params.withdrawalOpensAt,
          params.minBaseInventory,
          params.minQuoteInventory,
          params.minBidDepth || 5,
          params.minAskDepth || 5,
          params.maxInitialSpreadPct || 0.40,
          listing.version + 1,
          params.actorId,
          now,
          now,
          params.reason || '',
        ]
      );

      // Update listing state to SCHEDULED and visibility to UPCOMING
      this.dbMgr.execute(
        `UPDATE listings SET status = 'SCHEDULED', public_visibility = 'UPCOMING', scheduled_at = ?, new_badge_expires_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [params.scheduledListingAt, badgeExpiry, now, listingId]
      );

      // Audit Event
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, 'LISTING_SCHEDULED', ?, 'SCHEDULED', ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          listing.status,
          params.actorId,
          now,
          listing.version + 1,
          JSON.stringify({ params }),
        ]
      );
    });

    return this.getListingById(listingId);
  }

  public allocateTreasuryFunding(listingId: string, asset: string, amount: number, actorId: string, idempotencyKey: string) {
    const listing = this.dbMgr.queryOne<any>('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');

    const targetAccount = listing.assigned_mm_account || 'usr_mm_01';
    const sourceAccount = 'sys_treasury';
    const now = Date.now();

    // Check duplicate idempotency
    const existingAlloc = this.dbMgr.queryOne('SELECT id FROM inventory_allocations WHERE idempotency_key = ?', [idempotencyKey]);
    if (existingAlloc) {
      throw new Error(`Allocation with key ${idempotencyKey} has already been processed.`);
    }

    let txId = '';
    this.dbMgr.transaction(() => {
      // Execute double-entry transfer via ledgerService
      const tx = this.ledgerService.transfer(
        sourceAccount,
        targetAccount,
        asset,
        amount,
        idempotencyKey,
        `MM Treasury Capital Allocation for ${listing.market_id}`,
        actorId
      );
      txId = tx.id;

      // Record in inventory_allocations
      const allocId = `alloc_${now}_${Math.random().toString(36).slice(2, 6)}`;
      this.dbMgr.execute(
        `INSERT INTO inventory_allocations (
          id, listing_id, source_account, target_account, asset, amount, actor_id, idempotency_key, tx_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [allocId, listingId, sourceAccount, targetAccount, asset, amount, actorId, idempotencyKey, txId, now]
      );

      // Audit Event
      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, 'MM_TREASURY_ALLOCATED', ?, ?, ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          listing.mm_phase,
          listing.mm_phase,
          actorId,
          now,
          listing.version,
          JSON.stringify({ asset, amount, txId, targetAccount }),
        ]
      );
    });

    return { success: true, txId };
  }

  public toggleFeatureAccess(listingId: string, feature: 'deposit' | 'withdrawal', status: 'OPEN' | 'CLOSED' | 'SUSPENDED', actorId: string) {
    const listing = this.dbMgr.queryOne<any>('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (!listing) throw new Error('Listing not found');

    const col = feature === 'deposit' ? 'deposit_status' : 'withdrawal_status';
    const prev = listing[col];
    const now = Date.now();

    this.dbMgr.transaction(() => {
      this.dbMgr.execute(
        `UPDATE listings SET ${col} = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [status, now, listingId]
      );

      this.dbMgr.execute(
        `INSERT INTO listing_events (
          id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `evt_${now}_${Math.random().toString(36).slice(2, 6)}`,
          listingId,
          `${feature.toUpperCase()}_STATUS_${status}`,
          prev,
          status,
          actorId,
          now,
          listing.version + 1,
          JSON.stringify({ feature, status }),
        ]
      );
    });

    return this.getListingById(listingId);
  }

  public reconcileSchedules(currentTime: number = Date.now()) {
    const listings = this.getAllListings();
    const transitions: any[] = [];

    for (const l of listings) {
      if (l.status === 'COMPLETED' || l.status === 'CANCELLED') continue;
      const sch = l.schedule;
      if (!sch) continue;

      // 1. Preparation window transition (SCHEDULED -> PREPARING)
      if (l.status === 'SCHEDULED' && currentTime >= sch.mm_funding_opens_at && currentTime < sch.public_trading_opens_at) {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(
            `UPDATE listings SET status = 'PREPARING', mm_phase = 'FUNDING_OPEN', trading_status = 'PREPARATION_ONLY', version = version + 1, updated_at = ? WHERE id = ?`,
            [currentTime, l.id]
          );
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'TRANSITION_TO_PREPARING', 'SCHEDULED', 'PREPARING', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: 'TRANSITION_TO_PREPARING' });
      }

      // 2. Deposit Auto-Open
      if (currentTime >= sch.deposit_opens_at && l.deposit_status === 'CLOSED') {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(`UPDATE listings SET deposit_status = 'OPEN', version = version + 1, updated_at = ? WHERE id = ?`, [currentTime, l.id]);
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'DEPOSIT_AUTO_OPENED', 'CLOSED', 'OPEN', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: 'DEPOSIT_AUTO_OPENED' });
      }

      // 3. Withdrawal Auto-Open
      if (currentTime >= sch.withdrawal_opens_at && l.withdrawal_status === 'CLOSED') {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(`UPDATE listings SET withdrawal_status = 'OPEN', version = version + 1, updated_at = ? WHERE id = ?`, [currentTime, l.id]);
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'WITHDRAWAL_AUTO_OPENED', 'CLOSED', 'OPEN', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: 'WITHDRAWAL_AUTO_OPENED' });
      }

      // 4. Public launch at trading_opens_at
      if ((l.status === 'SCHEDULED' || l.status === 'PREPARING') && currentTime >= sch.public_trading_opens_at) {
        this.dbMgr.transaction(() => {
          this.dbMgr.execute(
            `UPDATE listings SET status = 'LIVE', mm_phase = 'READY', trading_status = 'OPEN', public_visibility = 'LIVE', actual_launch_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
            [currentTime, currentTime, l.id]
          );
          this.dbMgr.execute(
            `UPDATE market_pairs SET is_active = 1, trading_status = 'OPEN' WHERE id = ?`,
            [l.market_id]
          );
          this.dbMgr.execute(
            `INSERT INTO listing_events (id, listing_id, event_type, previous_state, new_state, actor_id, timestamp, schedule_version)
             VALUES (?, ?, 'MARKET_LAUNCHED_LIVE', ?, 'LIVE', 'system_scheduler', ?, ?)`,
            [`evt_${currentTime}_${Math.random().toString(36).slice(2, 6)}`, l.id, l.status, currentTime, l.version + 1]
          );
        });
        transitions.push({ listingId: l.id, action: 'MARKET_LAUNCHED_LIVE' });
      }
    }

    return transitions;
  }
}
