import React, { useState, useMemo } from 'react';
import { useSimulation } from '../simulation/store';
import { formatIDR, formatCrypto, formatDateTime } from '../utils/formatters';
import { Order, OrderStatus } from '../simulation/types';
import {
  ListOrdered,
  Clock,
  CheckCircle,
  AlertTriangle,
  Ban,
  Search,
  Filter,
  Eye,
  X,
  Bot,
  Table2,
} from 'lucide-react';

export const OrdersView: React.FC = () => {
  const { userOrders, openOrders, markets, cancelOrderById, mmActiveOrders, cancelAllMMOrders } = useSimulation();

  const [activeTab, setActiveTab] = useState<'open' | 'all' | 'mm'>('open');
  const [pairFilter, setPairFilter] = useState('ALL');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [inspectOrder, setInspectOrder] = useState<Order | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const handleCancelOrder = (orderId: string) => {
    const res = cancelOrderById(orderId);
    setCancelNotice(res.message);
    setTimeout(() => setCancelNotice(null), 3500);
  };

  const displayedOrders = useMemo(() => {
    let list = activeTab === 'open' ? openOrders : userOrders;

    if (pairFilter !== 'ALL') {
      list = list.filter((o) => o.pair === pairFilter);
    }
    if (sideFilter !== 'ALL') {
      list = list.filter((o) => o.side === sideFilter.toLowerCase());
    }
    if (statusFilter !== 'ALL' && activeTab === 'all') {
      list = list.filter((o) => o.status === statusFilter.toLowerCase());
    }

    return list;
  }, [activeTab, openOrders, userOrders, pairFilter, sideFilter, statusFilter]);

  const renderStatus = (status: OrderStatus) => {
    switch (status) {
      case 'filled':
        return (
          <span className="inline-flex items-center gap-1 text-[#10B981] font-medium">
            <CheckCircle className="w-3 h-3" /> Filled
          </span>
        );
      case 'open':
        return (
          <span className="inline-flex items-center gap-1 text-[#60A5FA] font-medium">
            <Clock className="w-3 h-3" /> Open
          </span>
        );
      case 'partially_filled':
        return (
          <span className="inline-flex items-center gap-1 text-[#EAB866] font-medium">
            <AlertTriangle className="w-3 h-3" /> Partial
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 text-[#647168]">
            <Ban className="w-3 h-3" /> Cancelled
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 text-[#EF6464]">
            <AlertTriangle className="w-3 h-3" /> Rejected
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
          Order Management
          <span className="text-xs px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30 font-mono">
            Virtual Terminal
          </span>
        </h1>
        <p className="text-xs text-[#A1ADA5] mt-0.5">
          Review, filter, inspect, and cancel active simulated spot orders.
        </p>
      </div>

      {cancelNotice && (
        <div className="p-3 rounded-xl bg-[#064E3B]/40 border border-[#10B981]/35 text-[#34D399] text-xs flex items-center justify-between">
          <span>{cancelNotice}</span>
          <button type="button" onClick={() => setCancelNotice(null)} className="text-[#34D399] hover:text-[#F1F5F2]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Table Card */}
      <div className="glass-panel rounded-xl p-4 flex flex-col gap-4">
        {/* Navigation Tabs and Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#26372D]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab('open')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'open'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              <span>Active Open Orders</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0B100E] border border-[#26372D] tabular-nums">
                {openOrders.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'all'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              All Order History ({userOrders.length})
            </button>
            <button
              onClick={() => setActiveTab('mm')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'mm'
                  ? 'bg-[#064E3B]/60 text-[#34D399] font-semibold border border-[#10B981]/40'
                  : 'text-[#A1ADA5] hover:text-[#34D399] hover:bg-[#192820]'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-[#10B981]" />
              <span>MM Bot Active / Frozen Orders</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0B100E] text-[#34D399] border border-[#26372D] font-mono font-bold tabular-nums">
                {mmActiveOrders.length}
              </span>
            </button>
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Pair filter */}
            <select
              value={pairFilter}
              onChange={(e) => setPairFilter(e.target.value)}
              className="glass-input rounded-lg px-2.5 py-1 text-[#F1F5F2] outline-none"
            >
              <option value="ALL" className="bg-[#101A15]">All Pairs</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#101A15]">
                  {m.id}
                </option>
              ))}
            </select>

            {/* Side filter */}
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value)}
              className="glass-input rounded-lg px-2.5 py-1 text-[#F1F5F2] outline-none"
            >
              <option value="ALL" className="bg-[#101A15]">All Sides</option>
              <option value="BUY" className="bg-[#101A15]">Buy Only</option>
              <option value="SELL" className="bg-[#101A15]">Sell Only</option>
            </select>

            {/* Status filter if All History */}
            {activeTab === 'all' && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="glass-input rounded-lg px-2.5 py-1 text-[#F1F5F2] outline-none"
              >
                <option value="ALL" className="bg-[#101A15]">All Statuses</option>
                <option value="FILLED" className="bg-[#101A15]">Filled</option>
                <option value="OPEN" className="bg-[#101A15]">Open</option>
                <option value="CANCELLED" className="bg-[#101A15]">Cancelled</option>
                <option value="REJECTED" className="bg-[#101A15]">Rejected</option>
              </select>
            )}
          </div>
        </div>

        {/* Table Content */}
        {activeTab === 'mm' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between p-3 rounded-xl bg-[#101A15] border border-[#26372D] gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-[#F1F5F2]">Active MM Quotes in CLOB:</span>
                <span className="font-mono text-[#34D399] font-bold tabular-nums">{mmActiveOrders.length} orders</span>
                <span className="text-[#647168]">|</span>
                <span className="text-[#A1ADA5]">Total Capital Frozen:</span>
                <span className="font-mono text-[#10B981] font-bold tabular-nums">
                  {formatIDR(
                    mmActiveOrders.reduce(
                      (acc, o) => acc + (o.side === 'buy' ? (o.frozenFunds || 0) : o.remainingAmount * o.price),
                      0
                    )
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const res = cancelAllMMOrders();
                  setCancelNotice(res.message);
                  setTimeout(() => setCancelNotice(null), 3500);
                }}
                className="px-3.5 py-1.5 text-xs font-bold bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] rounded-lg transition-colors flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel All MM Quotes</span>
              </button>
            </div>

            {mmActiveOrders.length === 0 ? (
              <div className="py-16 text-center text-[#A1ADA5] flex flex-col items-center">
                <Bot className="w-8 h-8 opacity-40 mb-2 text-[#10B981]" />
                <p className="text-xs">No active Market Maker bot orders currently resting in the book.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono-nums text-xs">
                  <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
                    <tr>
                      <th className="py-2.5 px-3">Date & Time</th>
                      <th className="py-2.5 px-3">Pair</th>
                      <th className="py-2.5 px-3">Side</th>
                      <th className="py-2.5 px-3">State</th>
                      <th className="py-2.5 px-3 text-right">Order Price</th>
                      <th className="py-2.5 px-3 text-right">Remaining Amount</th>
                      <th className="py-2.5 px-3 text-right">Frozen Funds</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#26372D]/50">
                    {mmActiveOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-[#192820] transition-colors">
                        <td className="py-2.5 px-3 text-[#A1ADA5] text-[11px] whitespace-nowrap">
                          {formatDateTime(ord.createdAt)}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#F1F5F2]">{ord.pair}</td>
                        <td className="py-2.5 px-3 font-bold">
                          <span className={ord.side === 'buy' ? 'text-[#10B981]' : 'text-[#EF6464]'}>
                            {ord.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#192820] text-[#34D399] border border-[#26372D]">
                            ACTIVE / FROZEN
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#F1F5F2] font-bold tabular-nums">
                          {formatIDR(ord.price)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#F1F5F2] tabular-nums">
                          {formatCrypto(ord.remainingAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#10B981] tabular-nums">
                          {ord.side === 'buy' ? formatIDR(ord.frozenFunds || 0) : `${formatCrypto(ord.frozenFunds || 0)} Base`}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(ord.id)}
                            className="px-2 py-0.5 text-[10.5px] rounded bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/30 transition-colors"
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {displayedOrders.length === 0 ? (
              <div className="py-16 text-center text-[#A1ADA5] flex flex-col items-center">
                <ListOrdered className="w-8 h-8 opacity-40 mb-2" />
                <p className="text-xs">No orders match current criteria.</p>
              </div>
            ) : (
              <table className="w-full text-left font-mono-nums text-xs">
                <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D]">
                  <tr>
                    <th className="py-2.5 px-3">Date & Time</th>
                    <th className="py-2.5 px-3">Order ID</th>
                    <th className="py-2.5 px-3">Pair</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Order Price</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3 text-right">Filled</th>
                    <th className="py-2.5 px-3 text-right">Total (IDR)</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26372D]/50">
                  {displayedOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2.5 px-3 text-[#A1ADA5] text-[11px] whitespace-nowrap">
                        {formatDateTime(ord.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 text-[#647168] font-mono text-[11px]">
                        #{ord.id.slice(-6)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#F1F5F2]">{ord.pair}</td>
                      <td className="py-2.5 px-3 text-[#A1ADA5] uppercase">{ord.type}</td>
                      <td className="py-2.5 px-3 font-bold">
                        <span
                          className={ord.side === 'buy' ? 'text-[#10B981]' : 'text-[#EF6464]'}
                        >
                          {ord.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#F1F5F2] tabular-nums">
                        {formatIDR(ord.price)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#F1F5F2] tabular-nums">
                        {formatCrypto(ord.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#A1ADA5] tabular-nums">
                        {formatCrypto(ord.filledAmount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#34D399] tabular-nums">
                        {formatIDR(ord.total)}
                      </td>
                      <td className="py-2.5 px-3">{renderStatus(ord.status)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setInspectOrder(ord)}
                            className="p-1 rounded text-[#A1ADA5] hover:text-[#34D399] hover:bg-[#192820]"
                            title="View Order Breakdown"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {(ord.status === 'open' || ord.status === 'partially_filled') && (
                            <button
                              onClick={() => handleCancelOrder(ord.id)}
                              className="px-2 py-0.5 text-[10.5px] rounded bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/30 transition-colors"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      {inspectOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl p-5 bg-[#101A15] border border-[#26372D] shadow-2xl font-mono-nums">
            <div className="flex items-center justify-between pb-3 border-b border-[#26372D] mb-3">
              <h3 className="text-sm font-semibold text-[#F1F5F2] flex items-center gap-2">
                Order #{inspectOrder.id}
              </h3>
              <button
                onClick={() => setInspectOrder(null)}
                className="p-1 text-[#A1ADA5] hover:text-[#F1F5F2]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Pair:</span>
                <span className="font-semibold text-[#F1F5F2]">{inspectOrder.pair}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Side / Type:</span>
                <span className={inspectOrder.side === 'buy' ? 'text-[#10B981] font-bold' : 'text-[#EF6464] font-bold'}>
                  {inspectOrder.type.toUpperCase()} {inspectOrder.side.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Status:</span>
                <span>{renderStatus(inspectOrder.status)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Order Price:</span>
                <span className="text-[#F1F5F2] tabular-nums">{formatIDR(inspectOrder.price)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Requested Quantity:</span>
                <span className="text-[#F1F5F2] tabular-nums">{formatCrypto(inspectOrder.amount)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Filled Quantity:</span>
                <span className="text-[#F1F5F2] tabular-nums">{formatCrypto(inspectOrder.filledAmount)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Simulated Fee:</span>
                <span className="text-[#F1F5F2] tabular-nums">{formatIDR(inspectOrder.fee)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#26372D]/50">
                <span className="text-[#A1ADA5]">Gross Total (IDR):</span>
                <span className="text-[#34D399] font-bold tabular-nums">{formatIDR(inspectOrder.total)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#A1ADA5]">Timestamp:</span>
                <span className="text-[#A1ADA5] text-[11px]">{formatDateTime(inspectOrder.createdAt)}</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#26372D] flex justify-end">
              <button
                onClick={() => setInspectOrder(null)}
                className="px-4 py-2 bg-[#142019] hover:bg-[#192820] text-[#F1F5F2] border border-[#26372D] rounded-lg text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
