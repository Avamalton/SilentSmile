import React, { useState, useMemo, useEffect } from 'react';
import { useSimulation } from '../../simulation/store';
import { InitialListing, AdminOverride, InitialListingSchedule } from '../../simulation/listingTypes';
import { formatIDR, formatDateTime } from '../../utils/formatters';
import {
  Rocket,
  CheckCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Coins,
  ArrowRight,
  Plus,
  Zap,
  Lock,
  Unlock,
  Check,
  X,
  Sliders,
  DollarSign,
  Calendar,
  FileText,
  Layers,
  Activity,
  History,
  Send,
  CornerUpLeft,
  Ban,
  Pause,
  Globe,
} from 'lucide-react';
import { MMPreparationService } from '../../simulation/mmPreparationService';
import { ListingSchedulerService } from '../../simulation/listingSchedulerService';

type AdminTab =
  | 'calendar'
  | 'creation'
  | 'review'
  | 'schedule'
  | 'funding'
  | 'setup'
  | 'checklist'
  | 'features'
  | 'audit';

export const InitialListingPanel: React.FC = () => {
  const {
    currentUser,
    initialListings,
    createDraftListing,
    submitForReview,
    returnToDraft,
    approveListing,
    rejectListing,
    scheduleListing,
    rescheduleListing,
    pauseListing,
    allocateTreasuryFunding,
    generatePreLaunchQuotesForListing,
    applyAdminOverrideToListing,
    toggleFeatureStatus,
    userBalancesMap,
    restingOrders,
    selectPair,
  } = useSimulation();

  const [activeTab, setActiveTab] = useState<AdminTab>('calendar');
  const [selectedListingId, setSelectedListingId] = useState<string>(
    initialListings[0]?.id || 'list_mock_01'
  );
  const [timezone, setTimezone] = useState<'WIB' | 'UTC'>('WIB');

  // Pair Creation Form State
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [newBaseAsset, setNewBaseAsset] = useState('');
  const [newQuoteAsset, setNewQuoteAsset] = useState('IDR');
  const [newCategory, setNewCategory] = useState('DEFI');
  const [newInitialPrice, setNewInitialPrice] = useState('25000');
  const [newPriceDecimals, setNewPriceDecimals] = useState('0');
  const [newAmountDecimals, setNewAmountDecimals] = useState('2');
  const [newMinOrderAmount, setNewMinOrderAmount] = useState('1');
  const [newMakerFeeBps, setNewMakerFeeBps] = useState('10');
  const [newTakerFeeBps, setNewTakerFeeBps] = useState('15');
  const [newAssignedMM, setNewAssignedMM] = useState('usr_mm_01');

  // Review & Schedule Modal / Input State
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [returnDraftReason, setReturnDraftReason] = useState('');
  const [pauseReason, setPauseReason] = useState('');

  // Schedule Planner State
  const [schedAnnouncementOffsetMin, setSchedAnnouncementOffsetMin] = useState('0');
  const [schedFundingOffsetMin, setSchedFundingOffsetMin] = useState('30');
  const [schedSetupOffsetMin, setSchedSetupOffsetMin] = useState('60');
  const [schedTradingOffsetMin, setSchedTradingOffsetMin] = useState('90');
  const [schedDepositOffsetMin, setSchedDepositOffsetMin] = useState('30');
  const [schedWithdrawalOffsetHours, setSchedWithdrawalOffsetHours] = useState('24');
  const [schedNewBadgeDays, setSchedNewBadgeDays] = useState('3');
  const [schedMinBaseInv, setSchedMinBaseInv] = useState('5000');
  const [schedMinQuoteInv, setSchedMinQuoteInv] = useState('100000000');
  const [schedTargetSpreadBps, setSchedTargetSpreadBps] = useState('30');
  const [schedMinDepthLevels, setSchedMinDepthLevels] = useState('5');

  // Override modal
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideGates, setOverrideGates] = useState<string[]>(['mm_inventory', 'book_depth']);

  // Treasury funding input
  const [fundAsset, setFundAsset] = useState<'base' | 'quote'>('quote');
  const [fundAmount, setFundAmount] = useState<string>('50000000');

  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // 1-second live clock for accurate countdowns
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeListing = useMemo(() => {
    return initialListings.find((l) => l.id === selectedListingId) || initialListings[0];
  }, [initialListings, selectedListingId]);

  const mmBalances = useMemo(() => {
    const mmId = activeListing?.assigned_mm_account || 'usr_mm_01';
    return userBalancesMap[mmId] || {};
  }, [userBalancesMap, activeListing]);

  const treasuryBalances = useMemo(() => {
    return userBalancesMap['usr_treasury_01'] || {};
  }, [userBalancesMap]);

  // Evaluate readiness metrics & checklist
  const metrics = useMemo(() => {
    if (!activeListing) return null;
    return MMPreparationService.evaluateMetrics(activeListing, mmBalances, restingOrders);
  }, [activeListing, mmBalances, restingOrders]);

  const readinessReport = useMemo(() => {
    if (!activeListing) return null;
    return ListingSchedulerService.evaluateReadinessChecklist(
      activeListing,
      mmBalances,
      restingOrders,
      now
    );
  }, [activeListing, mmBalances, restingOrders, now]);

  const timeToTrading = activeListing
    ? Math.max(0, Math.floor((activeListing.schedule.public_trading_opens_at - now) / 1000))
    : 0;

  const showToast = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3500);
  };

  const formatCountdown = (seconds: number) => {
    if (seconds <= 0) return '00:00:00 (PASSED / LIVE)';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatTimezoneDate = (timestamp: number) => {
    const d = new Date(timestamp);
    if (timezone === 'UTC') {
      return d.toUTCString();
    }
    return `${d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`;
  };

  // 1. Create Pair Draft
  const handleCreatePairDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol || !newName || !newBaseAsset) {
      alert('Please fill out all mandatory pair creation fields.');
      return;
    }

    const formattedSymbol = newSymbol.includes('/')
      ? newSymbol.toUpperCase()
      : `${newSymbol.toUpperCase()}/${newQuoteAsset.toUpperCase()}`;

    const res = createDraftListing({
      symbol: formattedSymbol,
      name: newName,
      base_asset: newBaseAsset.toUpperCase(),
      quote_asset: newQuoteAsset.toUpperCase(),
      category: newCategory,
      initial_price: Number(newInitialPrice) || 25000,
      price_precision: Number(newPriceDecimals) || 0,
      amount_precision: Number(newAmountDecimals) || 2,
      min_order_amount: Number(newMinOrderAmount) || 1,
      maker_fee_bps: Number(newMakerFeeBps) || 10,
      taker_fee_bps: Number(newTakerFeeBps) || 15,
      assigned_mm_account: newAssignedMM || 'usr_mm_01',
    });

    if (res.success && res.listing) {
      setSelectedListingId(res.listing.id);
      setActiveTab('review');
      showToast(`Market pair draft ${res.listing.symbol} created in DRAFT (HIDDEN) state.`);
    } else {
      alert(res.error || 'Failed to create market pair draft');
    }
  };

  // 2. Submit for Review
  const handleSubmitForReview = (listingId: string) => {
    const res = submitForReview(listingId);
    if (res.success) {
      showToast('Listing application submitted for administrative review.');
    } else {
      alert(res.error);
    }
  };

  // 3. Return to Draft
  const handleReturnToDraft = (listingId: string) => {
    const reason = returnDraftReason || 'Returned by admin for specification adjustments.';
    const res = returnToDraft(listingId, reason);
    if (res.success) {
      setReturnDraftReason('');
      showToast('Listing returned to DRAFT state.');
    } else {
      alert(res.error);
    }
  };

  // 4. Approve Listing
  const handleApprove = (listingId: string) => {
    const notes = reviewNotes || 'Approved by Exchange Risk Committee for initial listing.';
    const res = approveListing(listingId, currentUser.name, notes);
    if (res.success) {
      setReviewNotes('');
      showToast('Listing APPROVED! Visibility remains HIDDEN until schedule is configured.');
    } else {
      alert(res.error);
    }
  };

  // 5. Reject Listing
  const handleReject = (listingId: string) => {
    const reason = rejectReason || 'Listing rejected by administrator.';
    const res = rejectListing(listingId, reason);
    if (res.success) {
      setRejectReason('');
      showToast('Listing REJECTED and marked CANCELLED.');
    } else {
      alert(res.error);
    }
  };

  // 6. Schedule Listing
  const handleApplySchedule = (listingId: string) => {
    const annOffset = (Number(schedAnnouncementOffsetMin) || 0) * 60 * 1000;
    const fundOffset = (Number(schedFundingOffsetMin) || 30) * 60 * 1000;
    const setupOffset = (Number(schedSetupOffsetMin) || 60) * 60 * 1000;
    const tradingOffset = (Number(schedTradingOffsetMin) || 90) * 60 * 1000;
    const depOffset = (Number(schedDepositOffsetMin) || 30) * 60 * 1000;
    const wthOffset = (Number(schedWithdrawalOffsetHours) || 24) * 3600 * 1000;
    const badgeOffset = (Number(schedNewBadgeDays) || 3) * 86400 * 1000;

    const baseTime = Date.now();
    const newSched: InitialListingSchedule = {
      announcement_at: baseTime + annOffset,
      mm_funding_opens_at: baseTime + fundOffset,
      mm_setup_opens_at: baseTime + setupOffset,
      public_trading_opens_at: baseTime + tradingOffset,
      deposit_opens_at: baseTime + depOffset,
      withdrawal_opens_at: baseTime + wthOffset,
      new_badge_expires_at: baseTime + tradingOffset + badgeOffset,
      min_base_inventory: Number(schedMinBaseInv) || 5000,
      min_quote_inventory: Number(schedMinQuoteInv) || 100000000,
      target_spread_bps: Number(schedTargetSpreadBps) || 30,
      min_depth_levels: Number(schedMinDepthLevels) || 5,
      schedule_version: (activeListing?.schedule.schedule_version || 1) + 1,
    };

    const res = scheduleListing(listingId, newSched, 'Configured via Schedule Planner');
    if (res.success) {
      showToast(`Listing scheduled! Transitioned to SCHEDULED (UPCOMING).`);
    } else {
      alert(res.error);
    }
  };

  // 7. Pause Listing
  const handlePause = (listingId: string) => {
    const reason = pauseReason || 'Emergency admin halt for market alignment.';
    const res = pauseListing(listingId, reason);
    if (res.success) {
      setPauseReason('');
      showToast('Trading access SUSPENDED and listing HALTED.');
    } else {
      alert(res.error);
    }
  };

  // 8. Allocate Treasury Capital
  const handleAllocateCapital = () => {
    if (!activeListing) return;
    const asset = fundAsset === 'base' ? activeListing.base_asset : activeListing.quote_asset;
    const amount = Number(fundAmount);
    if (!amount || amount <= 0) {
      alert('Please enter a valid allocation amount.');
      return;
    }

    const res = allocateTreasuryFunding(activeListing.id, asset, amount);
    if (res.success) {
      showToast(`Allocated ${amount.toLocaleString()} ${asset} to MM via balanced double-entry ledger.`);
    } else {
      alert(res.error);
    }
  };

  // 9. Generate Quotes
  const handleGenerateQuotes = () => {
    if (!activeListing) return;
    const res = generatePreLaunchQuotesForListing(activeListing.id);
    if (res.success) {
      showToast(`Deployed ${res.count} resting pre-launch quotes with strict isolation.`);
    } else {
      alert(res.error);
    }
  };

  // 10. Admin Override
  const handleApplyOverride = () => {
    if (!activeListing) return;
    if (!overrideReason.trim() || overrideReason.trim().length < 5) {
      alert('Mandatory audited reason (minimum 5 characters) is required for override.');
      return;
    }

    const override: AdminOverride = {
      actor_id: currentUser.id,
      timestamp: Date.now(),
      reason: overrideReason,
      bypass_gates: overrideGates,
    };

    const res = applyAdminOverrideToListing(activeListing.id, override);
    if (res.success) {
      setShowOverrideModal(false);
      showToast(`Executive admin override applied to ${activeListing.symbol}.`);
    } else {
      alert(res.error);
    }
  };

  return (
    <div className="flex flex-col gap-5 text-[#F1F5F2]">
      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-[#064E3B]/30 border border-[#10B981]/40 text-[#34D399] text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-[#10B981] shrink-0" />
          <span className="font-medium">{actionNotice}</span>
        </div>
      )}

      {/* Top Header & Listing Selector Bar */}
      <div className="bg-[#142019] p-4 rounded-xl border border-[#26372D] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[#A1ADA5] font-semibold uppercase tracking-wider">Active Listing:</span>
          {initialListings.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelectedListingId(l.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border ${
                l.id === selectedListingId
                  ? 'bg-[#192820] text-[#F1F5F2] border-[#10B981]'
                  : 'bg-[#101A15] text-[#A1ADA5] hover:text-[#F1F5F2] border-[#26372D]'
              }`}
            >
              <span>{l.symbol}</span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase ${
                  l.status === 'LIVE'
                    ? 'bg-[#10B981]/15 text-[#34D399]'
                    : l.status === 'PREPARING'
                    ? 'bg-[#EAB866]/15 text-[#EAB866]'
                    : l.status === 'SCHEDULED'
                    ? 'bg-[#60A5FA]/15 text-[#60A5FA]'
                    : l.status === 'APPROVED'
                    ? 'bg-[#192820] text-[#34D399]'
                    : 'bg-[#192820] text-[#A1ADA5]'
                }`}
              >
                {l.status}
              </span>
            </button>
          ))}
        </div>

        {/* Global Controls: Timezone Toggle & Action Buttons */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[#101A15] rounded-lg p-1 border border-[#26372D] text-xs">
            <button
              onClick={() => setTimezone('WIB')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                timezone === 'WIB' ? 'bg-[#10B981] text-[#0B100E] font-bold' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              WIB (UTC+7)
            </button>
            <button
              onClick={() => setTimezone('UTC')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                timezone === 'UTC' ? 'bg-[#10B981] text-[#0B100E] font-bold' : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              UTC
            </button>
          </div>

          <button
            onClick={() => setActiveTab('creation')}
            className="px-3 py-1.5 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Pair Draft</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation Header */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[#26372D] text-xs">
        {[
          { id: 'calendar', label: 'Listing Calendar', icon: Calendar },
          { id: 'creation', label: 'Pair Creation', icon: Plus },
          { id: 'review', label: 'Review & Approval', icon: FileText },
          { id: 'schedule', label: 'Schedule Planner', icon: Clock },
          { id: 'funding', label: 'MM Funding', icon: Coins },
          { id: 'setup', label: 'Pre-Launch Setup', icon: Sliders },
          { id: 'checklist', label: 'Readiness Gates', icon: ShieldCheck },
          { id: 'features', label: 'Deposit & Withdrawal', icon: Layers },
          { id: 'audit', label: 'Audit Trail', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as AdminTab)}
              className={`px-3.5 py-2 rounded-t-lg font-semibold flex items-center gap-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-[#142019] text-[#34D399] border-t-2 border-[#10B981]'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#142019]/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: CALENDAR & OVERVIEW */}
      {activeTab === 'calendar' && (
        <div className="flex flex-col gap-5">
          {/* Active Listing Hero Card */}
          {activeListing && (
            <div className="rounded-xl p-5 border border-[#10B981]/30 bg-[#142019]">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#26372D]">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-[#F1F5F2]">{activeListing.symbol}</h2>
                    <span className="text-xs px-2.5 py-0.5 rounded bg-[#192820] text-[#F1F5F2] border border-[#26372D]">
                      {activeListing.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30 font-mono">
                      {activeListing.category}
                    </span>
                  </div>
                  <p className="text-xs text-[#A1ADA5] mt-1">
                    Initial Reference Price:{' '}
                    <strong className="text-[#F1F5F2] font-mono tabular-nums">{formatIDR(activeListing.initial_price)}</strong> | Base: {activeListing.base_asset} / Quote: {activeListing.quote_asset}
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-[11px] text-[#A1ADA5]">Public Launch In</div>
                  <div className="text-xl font-mono tabular-nums font-bold text-[#EAB866] tracking-wider">
                    {formatCountdown(timeToTrading)}
                  </div>
                  <div className="text-[10px] text-[#647168] font-mono mt-0.5 tabular-nums">
                    {formatTimezoneDate(activeListing.schedule.public_trading_opens_at)}
                  </div>
                </div>
              </div>

              {/* Status Indicators */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                <div className="bg-[#101A15] p-3 rounded-lg border border-[#26372D]">
                  <div className="text-[10px] text-[#A1ADA5]">Lifecycle State</div>
                  <div className="text-xs font-semibold text-[#F1F5F2] mt-1 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${activeListing.status === 'LIVE' ? 'bg-[#10B981]' : 'bg-[#EAB866]'}`}></span>
                    {activeListing.status}
                  </div>
                </div>

                <div className="bg-[#101A15] p-3 rounded-lg border border-[#26372D]">
                  <div className="text-[10px] text-[#A1ADA5]">MM Preparation Phase</div>
                  <div className="text-xs font-semibold text-[#34D399] mt-1">
                    {activeListing.mm_preparation_phase}
                  </div>
                </div>

                <div className="bg-[#101A15] p-3 rounded-lg border border-[#26372D]">
                  <div className="text-[10px] text-[#A1ADA5]">Trading Access</div>
                  <div className="text-xs font-semibold text-[#60A5FA] mt-1">
                    {activeListing.trading_status}
                  </div>
                </div>

                <div className="bg-[#101A15] p-3 rounded-lg border border-[#26372D]">
                  <div className="text-[10px] text-[#A1ADA5]">Public Visibility</div>
                  <div className="text-xs font-semibold text-[#34D399] mt-1">
                    {activeListing.visibility}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* All Listings Calendar Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialListings.map((listing) => {
              const diffSec = Math.max(0, Math.floor((listing.schedule.public_trading_opens_at - now) / 1000));
              const isSelected = listing.id === selectedListingId;

              return (
                <div
                  key={listing.id}
                  onClick={() => setSelectedListingId(listing.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-colors flex flex-col gap-3 ${
                    isSelected
                      ? 'border-[#10B981] bg-[#192820]'
                      : 'border-[#26372D] hover:border-[#10B981]/50 bg-[#142019]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#F1F5F2] text-base">{listing.symbol}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101A15] text-[#A1ADA5] border border-[#26372D]">
                          {listing.category}
                        </span>
                      </div>
                      <div className="text-xs text-[#A1ADA5] mt-0.5">{listing.name}</div>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
                        listing.status === 'LIVE'
                          ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30'
                          : listing.status === 'PREPARING'
                          ? 'bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/30'
                          : 'bg-[#101A15] text-[#A1ADA5] border border-[#26372D]'
                      }`}
                    >
                      {listing.status}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] text-xs flex flex-col gap-1.5 tabular-nums">
                    <div className="flex justify-between text-[#A1ADA5]">
                      <span>Launch In:</span>
                      <span className="font-mono font-bold text-[#EAB866]">{formatCountdown(diffSec)}</span>
                    </div>
                    <div className="flex justify-between text-[#647168] text-[11px]">
                      <span>Target Time:</span>
                      <span className="font-mono">{new Date(listing.schedule.public_trading_opens_at).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#A1ADA5] pt-1">
                    <span>Deposit: <strong className={listing.deposit_status === 'OPEN' ? 'text-[#34D399]' : 'text-[#647168]'}>{listing.deposit_status}</strong></span>
                    <span>Withdrawal: <strong className={listing.withdrawal_status === 'OPEN' ? 'text-[#34D399]' : 'text-[#647168]'}>{listing.withdrawal_status}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: MARKET PAIR CREATION */}
      {activeTab === 'creation' && (
        <div className="bg-[#142019] rounded-xl p-6 border border-[#26372D] max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#26372D]">
            <Plus className="w-5 h-5 text-[#10B981]" />
            <div>
              <h3 className="text-base font-bold text-[#F1F5F2]">Create New Market Pair Draft</h3>
              <p className="text-xs text-[#A1ADA5]">
                Creating a market pair does <strong>NOT</strong> list it automatically. Default state is <span className="font-mono text-[#EAB866]">DRAFT (HIDDEN)</span>.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreatePairDraft} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="text-[#A1ADA5] font-medium">Base Asset Ticker *</label>
              <input
                type="text"
                value={newBaseAsset}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setNewBaseAsset(val);
                  setNewSymbol(`${val}/${newQuoteAsset}`);
                }}
                placeholder="e.g. SOLARA"
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono uppercase"
                required
              />
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Quote Asset *</label>
              <select
                value={newQuoteAsset}
                onChange={(e) => {
                  setNewQuoteAsset(e.target.value);
                  setNewSymbol(`${newBaseAsset}/${e.target.value}`);
                }}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1"
              >
                <option value="IDR" className="bg-[#101A15] text-[#F1F5F2]">IDR (Indonesian Rupiah)</option>
                <option value="USDT" className="bg-[#101A15] text-[#F1F5F2]">USDT</option>
              </select>
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Pair Symbol *</label>
              <input
                type="text"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. SOLARA/IDR"
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono uppercase"
                required
              />
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Project Name *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Solara Energy Protocol"
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1"
                required
              />
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1"
              >
                <option value="DEFI" className="bg-[#101A15] text-[#F1F5F2]">DeFi</option>
                <option value="INFRA" className="bg-[#101A15] text-[#F1F5F2]">Infrastructure</option>
                <option value="LAYER1" className="bg-[#101A15] text-[#F1F5F2]">Layer 1 / Layer 2</option>
                <option value="AI" className="bg-[#101A15] text-[#F1F5F2]">AI & Big Data</option>
                <option value="GAMING" className="bg-[#101A15] text-[#F1F5F2]">Gaming & Metaverse</option>
              </select>
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Initial Reference Price (IDR)</label>
              <input
                type="number"
                value={newInitialPrice}
                onChange={(e) => setNewInitialPrice(e.target.value)}
                placeholder="e.g. 25000"
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Price Decimals (Precision)</label>
              <input
                type="number"
                value={newPriceDecimals}
                onChange={(e) => setNewPriceDecimals(e.target.value)}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Amount Decimals (Step Size)</label>
              <input
                type="number"
                value={newAmountDecimals}
                onChange={(e) => setNewAmountDecimals(e.target.value)}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Maker Fee (bps)</label>
              <input
                type="number"
                value={newMakerFeeBps}
                onChange={(e) => setNewMakerFeeBps(e.target.value)}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[#A1ADA5] font-medium">Taker Fee (bps)</label>
              <input
                type="number"
                value={newTakerFeeBps}
                onChange={(e) => setNewTakerFeeBps(e.target.value)}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono tabular-nums"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-[#A1ADA5] font-medium">Assigned Market Maker Account</label>
              <select
                value={newAssignedMM}
                onChange={(e) => setNewAssignedMM(e.target.value)}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] mt-1 font-mono"
              >
                <option value="usr_mm_01" className="bg-[#101A15] text-[#F1F5F2]">usr_mm_01 (Institutional Primary Market Maker)</option>
                <option value="usr_mm_02" className="bg-[#101A15] text-[#F1F5F2]">usr_mm_02 (Secondary Liquidity Bot)</option>
              </select>
            </div>

            <div className="md:col-span-2 flex justify-end gap-3 pt-4 border-t border-[#26372D]">
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Save Pair Draft (DRAFT State)</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: REVIEW & APPROVAL */}
      {activeTab === 'review' && activeListing && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
              <div>
                <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#10B981]" />
                  <span>Review & Approval Workflow: {activeListing.symbol}</span>
                </h3>
                <p className="text-xs text-[#A1ADA5] mt-0.5">
                  Controlled administrative lifecycle transitions from proposal to execution.
                </p>
              </div>

              <span className="text-xs font-mono px-2.5 py-1 rounded bg-[#101A15] border border-[#26372D] font-semibold text-[#F1F5F2]">
                Status: {activeListing.status}
              </span>
            </div>

            {/* Invariant Note */}
            <div className="p-3 rounded-lg bg-[#60A5FA]/10 border border-[#60A5FA]/30 text-xs text-[#F1F5F2]">
              <strong className="text-[#60A5FA]">Non-Negotiable Invariant:</strong> Approval does <strong>NOT</strong> make the listing publicly visible or live! An approved listing keeps trading closed and visibility hidden, enabling the Schedule Planner.
            </div>

            {/* Workflow Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {activeListing.status === 'DRAFT' && (
                <button
                  onClick={() => handleSubmitForReview(activeListing.id)}
                  className="px-4 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg text-xs flex items-center gap-2 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit for Review (UNDER_REVIEW)</span>
                </button>
              )}

              {activeListing.status === 'UNDER_REVIEW' && (
                <>
                  <button
                    onClick={() => handleApprove(activeListing.id)}
                    className="px-4 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg text-xs flex items-center gap-2 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Approve Listing (APPROVED)</span>
                  </button>

                  <button
                    onClick={() => handleReturnToDraft(activeListing.id)}
                    className="px-4 py-2 bg-[#EAB866] hover:bg-[#EAB866]/90 text-[#0B100E] font-bold rounded-lg text-xs flex items-center gap-2 transition-colors"
                  >
                    <CornerUpLeft className="w-3.5 h-3.5" />
                    <span>Return to Draft</span>
                  </button>

                  <button
                    onClick={() => handleReject(activeListing.id)}
                    className="px-4 py-2 bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] font-bold rounded-lg text-xs flex items-center gap-2 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reject Application</span>
                  </button>
                </>
              )}

              {activeListing.status === 'APPROVED' && (
                <button
                  onClick={() => setActiveTab('schedule')}
                  className="px-4 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg text-xs flex items-center gap-2 transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Configure Schedule in Planner &rarr;</span>
                </button>
              )}

              {activeListing.status !== 'PAUSED' && activeListing.status !== 'CANCELLED' && activeListing.status !== 'DRAFT' && (
                <button
                  onClick={() => handlePause(activeListing.id)}
                  className="px-3.5 py-2 bg-[#192820] hover:bg-[#EF6464]/15 hover:text-[#EF6464] text-[#A1ADA5] font-medium rounded-lg text-xs border border-[#26372D] flex items-center gap-1.5 transition-colors ml-auto"
                >
                  <Pause className="w-3.5 h-3.5 text-[#EAB866]" />
                  <span>Emergency Halt / Pause</span>
                </button>
              )}
            </div>

            {/* Review Notes Input */}
            <div className="pt-3 border-t border-[#26372D]">
              <label className="text-xs text-[#A1ADA5]">Committee Review Notes (Recorded in Immutable Audit Trail)</label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Enter formal risk assessment rationale and approval comments..."
                rows={3}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-xs text-[#F1F5F2] mt-1"
              />
            </div>
          </div>

          {/* Quick Details Sidebar */}
          <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-3 text-xs">
            <h4 className="font-semibold text-[#F1F5F2]">Application Specifications</h4>
            <div className="space-y-2 text-[#A1ADA5] tabular-nums">
              <div className="flex justify-between border-b border-[#26372D] pb-1">
                <span>Listing ID:</span>
                <span className="font-mono text-[#F1F5F2]">{activeListing.id}</span>
              </div>
              <div className="flex justify-between border-b border-[#26372D] pb-1">
                <span>Created At:</span>
                <span className="font-mono text-[#F1F5F2]">{formatTimezoneDate(activeListing.created_at)}</span>
              </div>
              <div className="flex justify-between border-b border-[#26372D] pb-1">
                <span>Assigned MM:</span>
                <span className="font-mono text-[#34D399]">{activeListing.assigned_mm_account}</span>
              </div>
              <div className="flex justify-between border-b border-[#26372D] pb-1">
                <span>Min Order Qty:</span>
                <span className="font-mono text-[#F1F5F2]">{activeListing.min_order_amount} {activeListing.base_asset}</span>
              </div>
              <div className="flex justify-between border-b border-[#26372D] pb-1">
                <span>Maker / Taker Fees:</span>
                <span className="font-mono text-[#F1F5F2]">{activeListing.maker_fee_bps} / {activeListing.taker_fee_bps} bps</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SCHEDULE PLANNER */}
      {activeTab === 'schedule' && activeListing && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
              <div>
                <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#10B981]" />
                  <span>Listing Schedule Planner & Lead Times</span>
                </h3>
                <p className="text-xs text-[#A1ADA5] mt-0.5">
                  Configure window openings and readiness targets. Setting schedule transitions to <strong className="text-[#60A5FA]">SCHEDULED (UPCOMING)</strong>.
                </p>
              </div>

              <span className="text-xs font-mono text-[#34D399] bg-[#10B981]/15 px-2.5 py-1 rounded border border-[#10B981]/30">
                Schedule v{activeListing.schedule.schedule_version}
              </span>
            </div>

            {/* Quick Offset Presets */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-[#A1ADA5]">Quick Presets:</span>
              <button
                type="button"
                onClick={() => {
                  setSchedAnnouncementOffsetMin('0');
                  setSchedFundingOffsetMin('15');
                  setSchedSetupOffsetMin('30');
                  setSchedTradingOffsetMin('45');
                  setSchedDepositOffsetMin('15');
                }}
                className="px-2.5 py-1 rounded bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] border border-[#26372D]"
              >
                Fast Launch (+45m)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSchedAnnouncementOffsetMin('0');
                  setSchedFundingOffsetMin('30');
                  setSchedSetupOffsetMin('60');
                  setSchedTradingOffsetMin('120');
                  setSchedDepositOffsetMin('30');
                }}
                className="px-2.5 py-1 rounded bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] border border-[#26372D]"
              >
                Standard (+2h)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSchedAnnouncementOffsetMin('0');
                  setSchedFundingOffsetMin('360');
                  setSchedSetupOffsetMin('720');
                  setSchedTradingOffsetMin('1440');
                  setSchedDepositOffsetMin('360');
                }}
                className="px-2.5 py-1 rounded bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] border border-[#26372D]"
              >
                Next Day (+24h)
              </button>
            </div>

            {/* Milestone Offsets Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-[#A1ADA5] font-medium">MM Funding Opens (Minutes from now)</label>
                <input
                  type="number"
                  value={schedFundingOffsetMin}
                  onChange={(e) => setSchedFundingOffsetMin(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>

              <div>
                <label className="text-[#A1ADA5] font-medium">MM Order Setup Opens (Minutes from now)</label>
                <input
                  type="number"
                  value={schedSetupOffsetMin}
                  onChange={(e) => setSchedSetupOffsetMin(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>

              <div>
                <label className="text-[#A1ADA5] font-medium">Public Trading Opens (Minutes from now) *</label>
                <input
                  type="number"
                  value={schedTradingOffsetMin}
                  onChange={(e) => setSchedTradingOffsetMin(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>

              <div>
                <label className="text-[#A1ADA5] font-medium">Deposit Opens (Minutes from now)</label>
                <input
                  type="number"
                  value={schedDepositOffsetMin}
                  onChange={(e) => setSchedDepositOffsetMin(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>

              <div>
                <label className="text-[#A1ADA5] font-medium">Withdrawal Opens (Hours from now)</label>
                <input
                  type="number"
                  value={schedWithdrawalOffsetHours}
                  onChange={(e) => setSchedWithdrawalOffsetHours(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>

              <div>
                <label className="text-[#A1ADA5] font-medium">NEW Badge Expiry (Days from launch)</label>
                <input
                  type="number"
                  value={schedNewBadgeDays}
                  onChange={(e) => setSchedNewBadgeDays(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>

              <div>
                <label className="text-[#A1ADA5] font-medium">Min MM Base Inventory</label>
                <input
                  type="number"
                  value={schedMinBaseInv}
                  onChange={(e) => setSchedMinBaseInv(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>

              <div>
                <label className="text-[#A1ADA5] font-medium">Min MM Quote Inventory (IDR)</label>
                <input
                  type="number"
                  value={schedMinQuoteInv}
                  onChange={(e) => setSchedMinQuoteInv(e.target.value)}
                  className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none rounded-lg p-2.5 text-[#F1F5F2] font-mono tabular-nums mt-1"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[#26372D]">
              <button
                type="button"
                onClick={() => handleApplySchedule(activeListing.id)}
                className="px-5 py-2.5 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg transition-colors flex items-center gap-2 text-xs"
              >
                <Clock className="w-4 h-4" />
                <span>Save Schedule & Activate UPCOMING Status</span>
              </button>
            </div>
          </div>

          {/* Timeline Visual Preview */}
          <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
            <h4 className="text-sm font-semibold text-[#F1F5F2] flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#10B981]" />
              <span>Timeline Preview ({timezone})</span>
            </h4>

            <div className="relative pl-6 border-l-2 border-[#26372D] flex flex-col gap-4 text-xs">
              <div className="relative">
                <span className={`absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full border-2 ${now >= activeListing.schedule.announcement_at ? 'bg-[#10B981] border-[#142019]' : 'bg-[#192820] border-[#647168]'}`}></span>
                <span className="font-semibold text-[#F1F5F2] block">Announcement</span>
                <span className="text-[#A1ADA5] font-mono text-[11px]">{formatTimezoneDate(activeListing.schedule.announcement_at)}</span>
              </div>

              <div className="relative">
                <span className={`absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full border-2 ${now >= activeListing.schedule.mm_funding_opens_at ? 'bg-[#10B981] border-[#142019]' : 'bg-[#192820] border-[#647168]'}`}></span>
                <span className="font-semibold text-[#F1F5F2] block">MM Funding Opens</span>
                <span className="text-[#A1ADA5] font-mono text-[11px]">{formatTimezoneDate(activeListing.schedule.mm_funding_opens_at)}</span>
              </div>

              <div className="relative">
                <span className={`absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full border-2 ${now >= activeListing.schedule.mm_setup_opens_at ? 'bg-[#10B981] border-[#142019]' : 'bg-[#192820] border-[#647168]'}`}></span>
                <span className="font-semibold text-[#F1F5F2] block">MM Order Setup Window</span>
                <span className="text-[#A1ADA5] font-mono text-[11px]">{formatTimezoneDate(activeListing.schedule.mm_setup_opens_at)}</span>
              </div>

              <div className="relative">
                <span className={`absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full border-2 ${now >= activeListing.schedule.public_trading_opens_at ? 'bg-[#10B981] border-[#142019]' : 'bg-[#EAB866] border-[#142019]'}`}></span>
                <span className="font-semibold text-[#EAB866] block">Public Trading (Goes LIVE)</span>
                <span className="text-[#EAB866] font-mono font-bold text-[11px]">{formatTimezoneDate(activeListing.schedule.public_trading_opens_at)}</span>
              </div>

              <div className="relative">
                <span className={`absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full border-2 ${now >= activeListing.schedule.new_badge_expires_at ? 'bg-[#647168] border-[#142019]' : 'bg-[#60A5FA] border-[#142019]'}`}></span>
                <span className="font-semibold text-[#60A5FA] block">NEW Badge Dismissal</span>
                <span className="text-[#A1ADA5] font-mono text-[11px]">{formatTimezoneDate(activeListing.schedule.new_badge_expires_at)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: MM FUNDING DASHBOARD */}
      {activeTab === 'funding' && activeListing && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
              <div>
                <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                  <Coins className="w-5 h-5 text-[#10B981]" />
                  <span>Market Maker Virtual Treasury Funding</span>
                </h3>
                <p className="text-xs text-[#A1ADA5] mt-0.5">
                  Real double-entry allocation from Central Treasury to Designated MM. No fake balances.
                </p>
              </div>

              <span className="text-xs font-mono text-[#60A5FA] bg-[#60A5FA]/10 px-2.5 py-1 rounded border border-[#60A5FA]/25">
                MM: {activeListing.assigned_mm_account}
              </span>
            </div>

            {/* Inventory Progress Bars */}
            <div className="space-y-4 bg-[#101A15] p-4 rounded-xl border border-[#26372D] text-xs">
              <div>
                <div className="flex justify-between text-[#A1ADA5] mb-1.5 text-xs font-medium">
                  <span>Base Token Inventory ({activeListing.base_asset})</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">
                    {(metrics?.baseInventory || 0).toLocaleString()} / {activeListing.schedule.min_base_inventory.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-[#192820] h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${metrics?.isInventorySufficient ? 'bg-[#10B981]' : 'bg-[#EAB866]'}`}
                    style={{
                      width: `${Math.min(100, ((metrics?.baseInventory || 0) / (activeListing.schedule.min_base_inventory || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#A1ADA5] mb-1.5 text-xs font-medium">
                  <span>Quote Inventory (IDR)</span>
                  <span className="font-mono text-[#F1F5F2] tabular-nums">
                    {formatIDR(metrics?.quoteInventory || 0)} / {formatIDR(activeListing.schedule.min_quote_inventory)}
                  </span>
                </div>
                <div className="w-full bg-[#192820] h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${metrics?.isInventorySufficient ? 'bg-[#10B981]' : 'bg-[#EAB866]'}`}
                    style={{
                      width: `${Math.min(100, ((metrics?.quoteInventory || 0) / (activeListing.schedule.min_quote_inventory || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Treasury Allocation Form */}
            <div className="flex flex-col gap-3 pt-3 border-t border-[#26372D] text-xs">
              <span className="text-[#F1F5F2] font-semibold">Execute Treasury Capital Injection</span>
              <div className="flex items-center gap-3">
                <select
                  value={fundAsset}
                  onChange={(e) => setFundAsset(e.target.value as any)}
                  className="bg-[#101A15] border border-[#26372D] rounded-lg px-3 py-2 text-xs text-[#F1F5F2]"
                >
                  <option value="quote" className="bg-[#101A15] text-[#F1F5F2]">Quote Asset (IDR)</option>
                  <option value="base" className="bg-[#101A15] text-[#F1F5F2]">Base Asset ({activeListing.base_asset})</option>
                </select>
                <input
                  type="number"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  className="flex-1 bg-[#101A15] border border-[#26372D] rounded-lg px-3 py-2 text-xs text-[#F1F5F2] font-mono tabular-nums"
                  placeholder="Amount..."
                />
                <button
                  onClick={handleAllocateCapital}
                  className="px-5 py-2 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>Transfer to MM</span>
                </button>
              </div>
            </div>
          </div>

          {/* Treasury Vault Status Sidebar */}
          <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4 text-xs">
            <h4 className="font-semibold text-[#F1F5F2]">Treasury Account Overview</h4>
            <div className="space-y-3 bg-[#101A15] p-3.5 rounded-xl border border-[#26372D] font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="text-[#A1ADA5]">IDR Free:</span>
                <span className="text-[#34D399] font-bold">{formatIDR(treasuryBalances['IDR']?.free || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1ADA5]">{activeListing.base_asset} Free:</span>
                <span className="text-[#F1F5F2] font-bold">{(treasuryBalances[activeListing.base_asset]?.free || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#101A15] border border-[#26372D] text-[#A1ADA5] text-[11px] space-y-1">
              <div>&bull; Double-entry transfer ensures exact balance preservation.</div>
              <div>&bull; Idempotency prevents double funding errors.</div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: PRE-LAUNCH ORDER BOOK SETUP */}
      {activeTab === 'setup' && activeListing && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
              <div>
                <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-[#10B981]" />
                  <span>Pre-Launch Central Limit Order Book Setup</span>
                </h3>
                <p className="text-xs text-[#A1ADA5] mt-0.5">
                  Inject resting limit orders into CLOB with isolation tags prior to launch.
                </p>
              </div>

              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#EAB866]/10 border border-[#EAB866]/25 text-[#EAB866] text-xs font-semibold">
                <Lock className="w-3.5 h-3.5" />
                <span>Isolated Pre-Launch</span>
              </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-3 gap-3 text-xs bg-[#101A15] p-4 rounded-xl border border-[#26372D] font-mono tabular-nums">
              <div>
                <div className="text-[10px] text-[#A1ADA5] uppercase">Bid Depth</div>
                <div className="text-lg font-bold text-[#10B981] mt-0.5">
                  {metrics?.bidDepth || 0} / {activeListing.schedule.min_depth_levels}
                </div>
              </div>

              <div>
                <div className="text-[10px] text-[#A1ADA5] uppercase">Ask Depth</div>
                <div className="text-lg font-bold text-[#EF6464] mt-0.5">
                  {metrics?.askDepth || 0} / {activeListing.schedule.min_depth_levels}
                </div>
              </div>

              <div>
                <div className="text-[10px] text-[#A1ADA5] uppercase">Initial Spread</div>
                <div className="text-lg font-bold text-[#EAB866] mt-0.5">
                  {metrics?.spreadBps === 99999 ? 'No Depth' : `${(metrics?.spreadBps || 0) / 100}%`}
                </div>
              </div>
            </div>

            {/* Deploy Ladder Button */}
            <button
              onClick={handleGenerateQuotes}
              className="w-full py-3 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <Zap className="w-4 h-4" />
              <span>Deploy Multi-Level Resting Ladder Quotes for {activeListing.symbol}</span>
            </button>
          </div>

          {/* Isolation & Protection Guarantee Sidebar */}
          <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-3 text-xs">
            <h4 className="font-semibold text-[#F1F5F2] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#10B981]" />
              <span>Matching Isolation Guard</span>
            </h4>
            <p className="text-[#A1ADA5] text-[11.5px]">
              Pre-launch orders carry <code className="text-[#34D399] bg-[#101A15] px-1 py-0.5 rounded border border-[#26372D]">isPreLaunch: true</code>.
              The matching engine strictly rejects any public crossing attempts until the market officially passes all 11 launch gates.
            </p>
            <div className="p-3 rounded-lg bg-[#064E3B]/30 border border-[#10B981]/30 text-[#34D399] text-[11px]">
              At launch, valid resting orders are atomically preserved and unlocked into the live order book with absolute price-time priority.
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: LAUNCH READINESS CHECKLIST */}
      {activeTab === 'checklist' && activeListing && (
        <div className="flex flex-col gap-5">
          <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
              <div>
                <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#10B981]" />
                  <span>11-Point Launch Readiness Gate Checklist</span>
                </h3>
                <p className="text-xs text-[#A1ADA5] mt-0.5">
                  Deterministic pre-launch verification. All 11 gates must pass or be audited-overridden before trading opens.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowOverrideModal(true)}
                  className="px-3 py-1.5 bg-[#EAB866]/15 hover:bg-[#EAB866]/25 text-[#EAB866] border border-[#EAB866]/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Admin Override</span>
                </button>

                <span
                  className={`px-3 py-1 rounded-lg text-xs font-bold font-mono ${
                    readinessReport?.isReady
                      ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30'
                      : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                  }`}
                >
                  {readinessReport?.isReady ? 'READY TO LAUNCH' : 'GATE BLOCKED'}
                </span>
              </div>
            </div>

            {/* Checklist Grid */}
            {readinessReport && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                {Object.entries(readinessReport.checks).map(([gateName, passed]) => (
                  <div
                    key={gateName}
                    className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${
                      passed
                        ? 'bg-[#064E3B]/20 border-[#10B981]/30 text-[#F1F5F2]'
                        : 'bg-[#EF6464]/10 border-[#EF6464]/30 text-[#EF6464]'
                    }`}
                  >
                    <div>
                      <span className="font-mono text-xs font-semibold block">{gateName}</span>
                      <span className="text-[10px] text-[#A1ADA5]">
                        {gateName === 'isApproved' && 'Governance approval confirmed'}
                        {gateName === 'hasValidSchedule' && 'Timeline validated'}
                        {gateName === 'timeReached' && 'Trading open timestamp reached'}
                        {gateName === 'notHaltedOrCancelled' && 'Market not paused or cancelled'}
                        {gateName === 'marketActive' && 'Pair initialized in system'}
                        {gateName === 'engineHealthy' && 'Matching engine online'}
                        {gateName === 'mmFunded' && 'MM funded with capital'}
                        {gateName === 'mmInventorySufficient' && 'Inventory meets threshold'}
                        {gateName === 'ledgerReconciled' && 'Balanced ledger confirmed'}
                        {gateName === 'ordersValid' && 'Depth levels deployed'}
                        {gateName === 'spreadAcceptable' && 'Spread within allowable bps'}
                      </span>
                    </div>

                    {passed ? (
                      <span className="flex items-center gap-1 text-[#10B981] text-xs font-bold shrink-0">
                        <Check className="w-4 h-4" /> PASS
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[#EF6464] text-xs font-bold shrink-0">
                        <X className="w-4 h-4" /> FAIL
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {readinessReport && readinessReport.failures.length > 0 && (
              <div className="p-4 rounded-xl bg-[#EF6464]/10 border border-[#EF6464]/35 text-[#F1F5F2] text-xs">
                <div className="font-semibold flex items-center gap-1.5 mb-1.5 text-[#EF6464]">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Launch Blocking Failures:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1 text-[11.5px] text-[#A1ADA5]">
                  {readinessReport.failures.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 8: INDEPENDENT DEPOSIT & WITHDRAWAL SCHEDULE */}
      {activeTab === 'features' && activeListing && (
        <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
            <div>
              <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#10B981]" />
                <span>Deposit & Withdrawal Access Management</span>
              </h3>
              <p className="text-xs text-[#A1ADA5] mt-0.5">
                Deposit and withdrawal operate on independent schedules, readiness checks, and status fields.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Deposit Box */}
            <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-[#F1F5F2]">Deposit Access</span>
                <span
                  className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                    activeListing.deposit_status === 'OPEN'
                      ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30'
                      : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                  }`}
                >
                  {activeListing.deposit_status}
                </span>
              </div>
              <p className="text-[#A1ADA5] text-[11px]">
                Scheduled Open: <strong className="text-[#F1F5F2] font-mono">{formatTimezoneDate(activeListing.schedule.deposit_opens_at)}</strong>
              </p>
              <button
                onClick={() => toggleFeatureStatus(activeListing.id, 'deposit')}
                className="mt-2 py-2 px-3 rounded-lg bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] font-semibold text-xs border border-[#26372D] transition-colors"
              >
                Toggle Deposit ({activeListing.deposit_status === 'OPEN' ? 'Close' : 'Open'})
              </button>
            </div>

            {/* Withdrawal Box */}
            <div className="p-4 rounded-xl bg-[#101A15] border border-[#26372D] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-[#F1F5F2]">Withdrawal Access</span>
                <span
                  className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                    activeListing.withdrawal_status === 'OPEN'
                      ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30'
                      : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                  }`}
                >
                  {activeListing.withdrawal_status}
                </span>
              </div>
              <p className="text-[#A1ADA5] text-[11px]">
                Scheduled Open: <strong className="text-[#F1F5F2] font-mono">{formatTimezoneDate(activeListing.schedule.withdrawal_opens_at)}</strong>
              </p>
              <button
                onClick={() => toggleFeatureStatus(activeListing.id, 'withdrawal')}
                className="mt-2 py-2 px-3 rounded-lg bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] font-semibold text-xs border border-[#26372D] transition-colors"
              >
                Toggle Withdrawal ({activeListing.withdrawal_status === 'OPEN' ? 'Close' : 'Open'})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 9: AUDIT STREAM */}
      {activeTab === 'audit' && activeListing && (
        <div className="bg-[#142019] rounded-xl p-5 border border-[#26372D] flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
            <div>
              <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
                <History className="w-4 h-4 text-[#10B981]" />
                <span>Immutable Listing Audit Trail: {activeListing.symbol}</span>
              </h3>
              <p className="text-xs text-[#A1ADA5] mt-0.5">
                Every administrative lifecycle change, schedule update, and override is permanently audited.
              </p>
            </div>
            <span className="text-xs text-[#A1ADA5] font-mono tabular-nums">
              {activeListing.audit_trail?.length || 0} Events Recorded
            </span>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {activeListing.audit_trail && activeListing.audit_trail.length > 0 ? (
              activeListing.audit_trail
                .slice()
                .reverse()
                .map((evt, idx) => (
                  <div
                    key={`${evt.id || 'evt'}-${idx}`}
                    className="p-3 rounded-xl bg-[#101A15] border border-[#26372D] text-xs flex flex-col gap-1"
                  >
                    <div className="flex justify-between items-center text-[#34D399] font-mono text-[11px]">
                      <span className="font-bold">{evt.event_type}</span>
                      <span className="text-[#647168]">{formatTimezoneDate(evt.timestamp)}</span>
                    </div>
                    <div className="text-[#A1ADA5]">
                      Actor: <strong className="text-[#F1F5F2]">{evt.actor_id}</strong> | State Transition:{' '}
                      <span className="text-[#EAB866] font-mono">{evt.previous_state}</span> &rarr;{' '}
                      <span className="text-[#34D399] font-mono">{evt.new_state}</span> (v{evt.schedule_version})
                    </div>
                    {evt.metadata && (
                      <pre className="text-[10px] text-[#A1ADA5] bg-[#0B100E] border border-[#26372D] p-2 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(evt.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
            ) : (
              <p className="text-xs text-[#647168] py-4 text-center">No audit events recorded for this listing yet.</p>
            )}
          </div>
        </div>
      )}

      {/* Admin Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="p-6 rounded-2xl border border-[#EAB866]/40 bg-[#142019] max-w-md w-full flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
              <h3 className="text-sm font-bold text-[#EAB866] flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                <span>Executive Admin Override</span>
              </h3>
              <button onClick={() => setShowOverrideModal(false)} className="text-[#A1ADA5] hover:text-[#F1F5F2]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#A1ADA5]">
              Administrative override bypasses launch gate validation failures. An audited entry will be permanently appended to the immutable log.
            </p>

            <div className="flex flex-col gap-2 text-xs">
              <label className="text-[#A1ADA5] font-medium">Bypass Gates:</label>
              <div className="space-y-1.5">
                {[
                  { id: 'mm_inventory', label: 'Bypass MM Minimum Inventory Requirement' },
                  { id: 'book_depth', label: 'Bypass Minimum Depth Levels' },
                  { id: 'spread', label: 'Bypass Max Allowable Spread BPS' },
                  { id: 'time_reached', label: 'Bypass Scheduled Launch Timestamp Gate' },
                ].map((gate) => (
                  <label key={gate.id} className="flex items-center gap-2 text-[#F1F5F2] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideGates.includes(gate.id)}
                      onChange={(e) => {
                        if (e.target.checked) setOverrideGates([...overrideGates, gate.id]);
                        else setOverrideGates(overrideGates.filter((g) => g !== gate.id));
                      }}
                      className="rounded bg-[#101A15] border-[#26372D] accent-[#10B981]"
                    />
                    <span>{gate.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-[#A1ADA5] font-medium">Mandatory Audited Reason *</label>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why gates are being bypassed (e.g. approved external institutional testnet liquidity provider)..."
                rows={3}
                className="w-full bg-[#101A15] border border-[#26372D] focus:border-[#EAB866] outline-none rounded-lg p-2.5 text-xs text-[#F1F5F2] mt-1"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#26372D]">
              <button
                type="button"
                onClick={() => setShowOverrideModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-[#192820] text-[#A1ADA5] hover:text-[#F1F5F2] border border-[#26372D] text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyOverride}
                className="px-4 py-1.5 rounded-lg bg-[#EAB866] hover:bg-[#EAB866]/90 text-[#0B100E] font-bold text-xs"
              >
                Confirm & Apply Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
