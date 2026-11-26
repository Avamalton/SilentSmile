import React, { useState } from 'react';
import { useSimulation } from '../../simulation/store';
import { formatIDR, formatCrypto, formatDateTime } from '../../utils/formatters';
import { X, Clock, CheckCircle, AlertTriangle, ArrowUpRight, ArrowDownRight, Ban } from 'lucide-react';
import { OrderStatus } from '../../simulation/types';

export const OrdersPanel: React.FC = () => {
  const {
    openOrders,
    userOrders,
    userTrades,
    cancelOrderById,
    currentUser,
    restingOrders,
    clearAllWalls,
    mmActiveOrders,
    cancelAllMMOrders,
  } = useSimulation();
  const [activeTab, setActiveTab] = useState<'open' | 'history' | 'trades' | 'walls' | 'mm_orders'>('open');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const activeWalls = restingOrders.filter((o) => o.isWall);

  const handleCancel = (orderId: string) => {
    setCancellingId(orderId);
    const res = cancelOrderById(orderId);
    setCancelNotice(res.message);
    setTimeout(() => setCancelNotice(null), 3000);
    setTimeout(() => setCancellingId(null), 300);
  };

  const renderStatusBadge = (status: OrderStatus) => {
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
    <div className="flex flex-col h-full w-full glass-panel rounded-xl overflow-hidden text-xs">
      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-[#26372D] bg-[#101A15] px-4 py-2 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('open')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'open'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#26372D]'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            <span>Open Orders</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0B100E] text-[#F1F5F2] border border-[#26372D] tabular-nums">
              {openOrders.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'history'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#26372D]'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Order History ({userOrders.length})
          </button>
          <button
            onClick={() => setActiveTab('trades')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'trades'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#26372D]'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Your Trades ({userTrades.length})
          </button>
          {currentUser.role === 'market_maker' && (
            <button
              onClick={() => setActiveTab('walls')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'walls'
                  ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/40 font-semibold'
                  : 'text-[#A1ADA5] hover:text-[#34D399] hover:bg-[#192820]'
              }`}
            >
              <span>Active Walls</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0B100E] text-[#34D399] border border-[#26372D] font-mono tabular-nums">
                {activeWalls.length}
              </span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('mm_orders')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'mm_orders'
                ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/40 font-semibold'
                : 'text-[#A1ADA5] hover:text-[#34D399] hover:bg-[#192820]'
            }`}
          >
            <span>MM Bot Quotes</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0B100E] text-[#34D399] border border-[#26372D] font-mono tabular-nums">
              {mmActiveOrders.length}
            </span>
          </button>
        </div>
      </div>

      {cancelNotice && (
        <div className="px-4 py-2 bg-[#064E3B]/40 border-b border-[#10B981]/30 text-[#34D399] text-[11px] flex items-center justify-between">
          <span>{cancelNotice}</span>
          <button type="button" onClick={() => setCancelNotice(null)} className="text-[#34D399] hover:text-[#F1F5F2]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Table Content Area */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {activeTab === 'open' && (
          <>
            {openOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-[#A1ADA5]">
                <Clock className="w-8 h-8 mb-2 opacity-40 text-[#647168]" />
                <p className="text-xs">No active open orders.</p>
                <p className="text-[11px] text-[#647168] mt-1">
                  Place a limit order away from market price to see it listed here.
                </p>
              </div>
            ) : (
              <table className="w-full text-left font-mono-nums">
                <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] sticky top-0">
                  <tr>
                    <th className="py-2 px-3 font-medium">Time</th>
                    <th className="py-2 px-3 font-medium">Pair</th>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium">Side</th>
                    <th className="py-2 px-3 font-medium text-right">Price</th>
                    <th className="py-2 px-3 font-medium text-right">Amount</th>
                    <th className="py-2 px-3 font-medium text-right">Filled</th>
                    <th className="py-2 px-3 font-medium text-right">Total (IDR)</th>
                    <th className="py-2 px-3 font-medium text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26372D]/50">
                  {openOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2 px-3 text-[#A1ADA5] whitespace-nowrap text-[11px]">
                        {formatDateTime(ord.createdAt)}
                      </td>
                      <td className="py-2 px-3 font-semibold text-[#F1F5F2]">{ord.pair}</td>
                      <td className="py-2 px-3 text-[#A1ADA5] uppercase">{ord.type}</td>
                      <td className="py-2 px-3 font-semibold">
                        <span
                          className={ord.side === 'buy' ? 'text-[#10B981]' : 'text-[#EF6464]'}
                        >
                          {ord.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">{formatIDR(ord.price)}</td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">
                        {formatCrypto(ord.amount)}
                      </td>
                      <td className="py-2 px-3 text-right text-[#A1ADA5] tabular-nums">
                        {formatCrypto(ord.filledAmount)} ({((ord.filledAmount / ord.amount) * 100).toFixed(0)}%)
                      </td>
                      <td className="py-2 px-3 text-right text-[#34D399] tabular-nums">{formatIDR(ord.total)}</td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleCancel(ord.id)}
                          disabled={cancellingId === ord.id}
                          className="px-2.5 py-1 text-[11px] font-medium bg-[#EF6464]/10 hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/30 rounded transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'history' && (
          <>
            {userOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-[#A1ADA5]">
                <Clock className="w-8 h-8 mb-2 opacity-40 text-[#647168]" />
                <p className="text-xs">No orders submitted yet in this session.</p>
              </div>
            ) : (
              <table className="w-full text-left font-mono-nums">
                <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] sticky top-0">
                  <tr>
                    <th className="py-2 px-3 font-medium">Time</th>
                    <th className="py-2 px-3 font-medium">Order ID</th>
                    <th className="py-2 px-3 font-medium">Pair</th>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium">Side</th>
                    <th className="py-2 px-3 font-medium text-right">Price</th>
                    <th className="py-2 px-3 font-medium text-right">Amount</th>
                    <th className="py-2 px-3 font-medium text-right">Total (IDR)</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26372D]/50">
                  {userOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2 px-3 text-[#A1ADA5] whitespace-nowrap text-[11px]">
                        {formatDateTime(ord.createdAt)}
                      </td>
                      <td className="py-2 px-3 text-[#647168] text-[11px]">#{ord.id.slice(-6)}</td>
                      <td className="py-2 px-3 font-semibold text-[#F1F5F2]">{ord.pair}</td>
                      <td className="py-2 px-3 text-[#A1ADA5] uppercase">{ord.type}</td>
                      <td className="py-2 px-3 font-semibold">
                        <span
                          className={ord.side === 'buy' ? 'text-[#10B981]' : 'text-[#EF6464]'}
                        >
                          {ord.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">{formatIDR(ord.price)}</td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">
                        {formatCrypto(ord.amount)}
                      </td>
                      <td className="py-2 px-3 text-right text-[#34D399] tabular-nums">{formatIDR(ord.total)}</td>
                      <td className="py-2 px-3">{renderStatusBadge(ord.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'trades' && (
          <>
            {userTrades.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-[#A1ADA5]">
                <Clock className="w-8 h-8 mb-2 opacity-40 text-[#647168]" />
                <p className="text-xs">No personal trade executions recorded yet.</p>
              </div>
            ) : (
              <table className="w-full text-left font-mono-nums">
                <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] sticky top-0">
                  <tr>
                    <th className="py-2 px-3 font-medium">Time</th>
                    <th className="py-2 px-3 font-medium">Trade ID</th>
                    <th className="py-2 px-3 font-medium">Pair</th>
                    <th className="py-2 px-3 font-medium">Side</th>
                    <th className="py-2 px-3 font-medium text-right">Execution Price</th>
                    <th className="py-2 px-3 font-medium text-right">Filled Amount</th>
                    <th className="py-2 px-3 font-medium text-right">Settled Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26372D]/50">
                  {userTrades.map((trd) => (
                    <tr key={trd.id} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2 px-3 text-[#A1ADA5] whitespace-nowrap text-[11px]">
                        {formatDateTime(trd.timestamp)}
                      </td>
                      <td className="py-2 px-3 text-[#647168] text-[11px]">#{trd.id.slice(-6)}</td>
                      <td className="py-2 px-3 font-semibold text-[#F1F5F2]">{trd.pair}</td>
                      <td className="py-2 px-3 font-semibold">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            trd.side === 'buy' ? 'text-[#10B981]' : 'text-[#EF6464]'
                          }`}
                        >
                          {trd.side === 'buy' ? (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5" />
                          )}
                          {trd.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">{formatIDR(trd.price)}</td>
                      <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">
                        {formatCrypto(trd.amount)}
                      </td>
                      <td className="py-2 px-3 text-right text-[#34D399] font-medium tabular-nums">
                        {formatIDR(trd.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'walls' && (
          <>
            {activeWalls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-[#A1ADA5]">
                <Clock className="w-8 h-8 mb-2 opacity-40 text-[#647168]" />
                <p className="text-xs">No active liquidity walls deployed.</p>
                <p className="text-[11px] text-[#647168] mt-1">
                  Deploy Buy or Sell walls via the Market Maker Station or MM Bot panel.
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between p-2.5 bg-[#101A15] border-b border-[#26372D]">
                  <div className="text-[11px] text-[#34D399]">
                    Active CLOB Order Walls ({activeWalls.length} deployed)
                  </div>
                  <button
                    type="button"
                    onClick={() => clearAllWalls()}
                    className="px-2.5 py-1 text-[10.5px] font-semibold bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/30 rounded transition-colors"
                  >
                    Clear All Walls
                  </button>
                </div>
                <table className="w-full text-left font-mono-nums">
                  <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-medium">Time</th>
                      <th className="py-2 px-3 font-medium">Pair</th>
                      <th className="py-2 px-3 font-medium">Wall Type</th>
                      <th className="py-2 px-3 font-medium text-right">Price</th>
                      <th className="py-2 px-3 font-medium text-right">Remaining Qty</th>
                      <th className="py-2 px-3 font-medium text-right">Total (IDR)</th>
                      <th className="py-2 px-3 font-medium text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#26372D]/50">
                    {activeWalls.map((wall) => (
                      <tr key={wall.id} className="hover:bg-[#192820] transition-colors">
                        <td className="py-2 px-3 text-[#A1ADA5] whitespace-nowrap text-[11px]">
                          {formatDateTime(wall.createdAt)}
                        </td>
                        <td className="py-2 px-3 font-semibold text-[#F1F5F2]">{wall.pair}</td>
                        <td className="py-2 px-3 font-semibold">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              wall.side === 'buy'
                                ? 'bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30'
                                : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                            }`}
                          >
                            {wall.side === 'buy' ? 'SUPPORT (BUY WALL)' : 'RESISTANCE (SELL WALL)'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-[#F1F5F2] font-bold tabular-nums">
                          {formatIDR(wall.price)}
                        </td>
                        <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">
                          {formatCrypto(wall.remainingAmount)}
                        </td>
                        <td className="py-2 px-3 text-right text-[#34D399] font-medium tabular-nums">
                          {formatIDR(wall.remainingAmount * wall.price)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleCancel(wall.id)}
                            disabled={cancellingId === wall.id}
                            className="px-2.5 py-1 text-[11px] font-medium bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/35 rounded transition-colors disabled:opacity-50"
                          >
                            Cancel Wall
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'mm_orders' && (
          <>
            {mmActiveOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-[#A1ADA5]">
                <Clock className="w-8 h-8 mb-2 opacity-40 text-[#647168]" />
                <p className="text-xs">No active MM bot quotes currently resting in CLOB.</p>
                <p className="text-[11px] text-[#647168] mt-1">
                  Quotes appear automatically when the Market Maker Bot is enabled in MM Station or MM Matrix.
                </p>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center justify-between p-2.5 bg-[#101A15] border-b border-[#26372D] gap-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-semibold text-[#F1F5F2]">Active MM Quotes:</span>
                    <span className="font-mono text-[#34D399] font-bold tabular-nums">{mmActiveOrders.length} orders</span>
                    <span className="text-[#647168]">|</span>
                    <span className="text-[#A1ADA5]">Total Capital Frozen in CLOB:</span>
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
                    className="px-3 py-1 text-xs font-bold bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] rounded-lg transition-colors flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel All MM Orders</span>
                  </button>
                </div>
                <table className="w-full text-left font-mono-nums">
                  <thead className="bg-[#101A15] text-[11px] text-[#A1ADA5] border-b border-[#26372D] sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-medium">Pair</th>
                      <th className="py-2 px-3 font-medium">Side</th>
                      <th className="py-2 px-3 font-medium">State</th>
                      <th className="py-2 px-3 font-medium text-right">Quote Price</th>
                      <th className="py-2 px-3 font-medium text-right">Remaining Amount</th>
                      <th className="py-2 px-3 font-medium text-right">Frozen Funds</th>
                      <th className="py-2 px-3 font-medium text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#26372D]/50">
                    {mmActiveOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-[#192820] transition-colors">
                        <td className="py-2 px-3 font-semibold text-[#F1F5F2]">{ord.pair}</td>
                        <td className="py-2 px-3 font-semibold">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10.5px] font-bold ${
                              ord.side === 'buy'
                                ? 'bg-[#064E3B]/50 text-[#34D399]'
                                : 'bg-[#EF6464]/15 text-[#EF6464]'
                            }`}
                          >
                            {ord.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[#192820] text-[#34D399] border border-[#26372D]">
                            ACTIVE / FROZEN
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-[#F1F5F2] font-bold tabular-nums">
                          {formatIDR(ord.price)}
                        </td>
                        <td className="py-2 px-3 text-right text-[#F1F5F2] tabular-nums">
                          {formatCrypto(ord.remainingAmount)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[#10B981] tabular-nums">
                          {ord.side === 'buy' ? formatIDR(ord.frozenFunds || 0) : `${formatCrypto(ord.frozenFunds || 0)} Base`}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleCancel(ord.id)}
                            disabled={cancellingId === ord.id}
                            className="px-2 py-0.5 text-[10.5px] font-medium bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/35 rounded transition-colors disabled:opacity-50"
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
          </>
        )}
      </div>
    </div>
  );
};
