import React, { useState, useEffect } from 'react';
import { useSimulation } from '../../simulation/store';
import { OrderSide, OrderType } from '../../simulation/types';
import { formatIDR, formatCrypto, safeRound } from '../../utils/formatters';
import { AlertCircle, CheckCircle2, ShieldCheck, Wallet, ArrowRight } from 'lucide-react';

interface OrderFormProps {
  selectedPrice?: number | null;
}

export const OrderForm: React.FC<OrderFormProps> = ({ selectedPrice }) => {
  const { activePair, balances, submitOrder, isSubmitting, currentUser } = useSimulation();
  const isTradingBlocked = (activePair.tradingAccessStatus && activePair.tradingAccessStatus !== 'OPEN') && currentUser.role !== 'market_maker';

  const [side, setSide] = useState<OrderSide>('buy');
  const [type, setType] = useState<OrderType>('limit');
  const [priceInput, setPriceInput] = useState<string>(activePair.lastPrice.toString());
  const [amountInput, setAmountInput] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // When selectedPrice is clicked in order book, pre-fill price input
  useEffect(() => {
    if (selectedPrice && selectedPrice > 0) {
      setPriceInput(selectedPrice.toString());
    }
  }, [selectedPrice]);

  // Keep price updated when switching pairs if user hasn't typed
  useEffect(() => {
    setPriceInput(activePair.lastPrice.toString());
    setAmountInput('');
    setStatusMessage(null);
  }, [activePair.id]);

  const priceNum = type === 'market' ? activePair.lastPrice : parseFloat(priceInput) || 0;
  const amountNum = parseFloat(amountInput) || 0;
  const totalIDR = Math.round(amountNum * priceNum);

  // Fee calculation
  const feeBps = type === 'limit' ? activePair.makerFeeBps : activePair.takerFeeBps;
  const estimatedFee = Math.round(totalIDR * (feeBps / 10000));
  const estimatedNetTotal = side === 'buy' ? totalIDR + estimatedFee : Math.max(0, totalIDR - estimatedFee);

  // Balances
  const availableIDR = balances['IDR']?.free || 0;
  const availableBase = balances[activePair.baseAsset]?.free || 0;

  // Percentage slider / buttons handler
  const handlePercentClick = (percent: number) => {
    if (side === 'buy') {
      const budget = (availableIDR * (percent / 100)) / (1 + feeBps / 10000);
      if (priceNum > 0) {
        const calculatedAmount = safeRound(budget / priceNum, activePair.amountDecimals);
        setAmountInput(calculatedAmount.toString());
      }
    } else {
      const calculatedAmount = safeRound(availableBase * (percent / 100), activePair.amountDecimals);
      setAmountInput(calculatedAmount.toString());
    }
  };

  // Validation
  let validationError: string | null = null;
  if (amountNum <= 0) {
    validationError = 'Enter a valid amount';
  } else if (amountNum < activePair.minOrderAmount) {
    validationError = `Min order is ${activePair.minOrderAmount} ${activePair.baseAsset}`;
  } else if (type === 'limit' && priceNum <= 0) {
    validationError = 'Enter a valid limit price';
  } else if (side === 'buy' && estimatedNetTotal > availableIDR) {
    validationError = 'Insufficient virtual IDR balance';
  } else if (side === 'sell' && amountNum > availableBase) {
    validationError = `Insufficient virtual ${activePair.baseAsset} balance`;
  }

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError || isSubmitting) return;
    setShowConfirmModal(true);
  };

  const handleExecuteConfirmedOrder = async () => {
    setShowConfirmModal(false);
    setStatusMessage(null);

    const result = await submitOrder(side, type, amountNum, priceNum);
    if (result.success) {
      setStatusMessage({ type: 'success', text: result.message });
      setAmountInput('');
    } else {
      setStatusMessage({ type: 'error', text: result.message });
    }
  };

  return (
    <div className="flex flex-col h-full w-full glass-panel rounded-xl p-3 text-xs overflow-y-auto">
      {/* Side Selector Tabs (Buy / Sell) */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#101A15] rounded-lg border border-[#26372D] mb-3">
        <button
          type="button"
          onClick={() => {
            setSide('buy');
            setStatusMessage(null);
          }}
          className={`py-2 text-xs font-semibold rounded-md transition-colors ${
            side === 'buy'
              ? 'bg-[#10B981] text-[#0B100E]'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          Buy {activePair.baseAsset}
        </button>
        <button
          type="button"
          onClick={() => {
            setSide('sell');
            setStatusMessage(null);
          }}
          className={`py-2 text-xs font-semibold rounded-md transition-colors ${
            side === 'sell'
              ? 'bg-[#EF6464] text-[#0B100E]'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          Sell {activePair.baseAsset}
        </button>
      </div>

      {/* Order Type Tabs (Limit / Market) */}
      <div className="flex items-center gap-1 mb-3">
        <button
          type="button"
          onClick={() => setType('limit')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            type === 'limit'
              ? 'bg-[#192820] text-[#34D399] border border-[#10B981]/35'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          Limit
        </button>
        <button
          type="button"
          onClick={() => setType('market')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            type === 'market'
              ? 'bg-[#192820] text-[#34D399] border border-[#10B981]/35'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          Market
        </button>
      </div>

      {/* Available Virtual Balance Bar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 mb-3 rounded-lg bg-[#101A15] border border-[#26372D] text-[#A1ADA5] font-mono-nums">
        <span className="flex items-center gap-1.5 text-[#A1ADA5] text-[11px]">
          <Wallet className="w-3.5 h-3.5 text-[#10B981]" />
          Avail:
        </span>
        <span className="font-semibold text-[#F1F5F2] tabular-nums">
          {side === 'buy'
            ? formatIDR(availableIDR)
            : `${formatCrypto(availableBase, activePair.amountDecimals)} ${activePair.baseAsset}`}
        </span>
      </div>

      {/* Order Inputs Form */}
      <form onSubmit={handleOpenConfirm} className="flex flex-col gap-3">
        {/* Limit Price Input */}
        {type === 'limit' ? (
          <div>
            <label className="block text-[11px] font-medium text-[#A1ADA5] mb-1">
              Order Price (IDR)
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="1"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0"
                className="w-full glass-input rounded-lg px-3 py-2 pr-14 text-sm font-mono-nums text-[#F1F5F2] placeholder-[#647168] outline-none transition-colors"
                required
              />
              <span className="absolute right-3 top-2.5 text-xs font-mono font-medium text-[#A1ADA5]">
                IDR
              </span>
            </div>
          </div>
        ) : (
          <div className="p-2 rounded-lg bg-[#101A15] border border-[#26372D] text-[11.5px] text-[#A1ADA5]">
            Market orders execute instantly at the best available simulated order book price.
          </div>
        )}

        {/* Amount Input */}
        <div>
          <label className="block text-[11px] font-medium text-[#A1ADA5] mb-1">
            Amount ({activePair.baseAsset})
          </label>
          <div className="relative">
            <input
              type="number"
              step="any"
              min="0"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={`Min ${activePair.minOrderAmount}`}
              className="w-full glass-input rounded-lg px-3 py-2 pr-16 text-sm font-mono-nums text-[#F1F5F2] placeholder-[#647168] outline-none transition-colors"
              required
            />
            <span className="absolute right-3 top-2.5 text-xs font-mono font-medium text-[#A1ADA5]">
              {activePair.baseAsset}
            </span>
          </div>
        </div>

        {/* Percentage Quick Shortcuts */}
        <div className="grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercentClick(pct)}
              className="py-1 bg-[#101A15] hover:bg-[#192820] text-[#A1ADA5] hover:text-[#34D399] border border-[#26372D] rounded text-[11px] font-mono transition-colors"
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Order Summary & Fee breakdown */}
        <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] space-y-1.5 font-mono-nums text-[11.5px]">
          <div className="flex justify-between text-[#A1ADA5]">
            <span>Order Value:</span>
            <span className="text-[#F1F5F2] tabular-nums">{formatIDR(totalIDR)}</span>
          </div>
          <div className="flex justify-between text-[#A1ADA5]">
            <span>Est. Fee ({feeBps / 100}%):</span>
            <span className="text-[#F1F5F2] tabular-nums">{formatIDR(estimatedFee)}</span>
          </div>
          <div className="flex justify-between text-[#F1F5F2] font-semibold pt-1 border-t border-[#26372D]">
            <span>Estimated Total:</span>
            <span className="text-[#34D399] tabular-nums">{formatIDR(estimatedNetTotal)}</span>
          </div>
        </div>

        {/* Validation error message if any */}
        {amountNum > 0 && validationError && (
          <div className="flex items-center gap-1.5 text-[#EF6464] text-[11px] px-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Status notification toast */}
        {statusMessage && (
          <div
            className={`flex items-start gap-1.5 p-2 rounded-lg text-[11.5px] border ${
              statusMessage.type === 'success'
                ? 'bg-[#064E3B]/40 text-[#34D399] border-[#10B981]/30'
                : 'bg-[#EF6464]/10 text-[#EF6464] border-[#EF6464]/30'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#10B981] mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-[#EF6464] mt-0.5" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {isTradingBlocked && (
          <div className="flex items-center gap-1.5 p-2 rounded-lg bg-[#EAB866]/10 border border-[#EAB866]/30 text-[#EAB866] text-[11px]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#EAB866]" />
            <span>Market in MM Preparation Mode. Public trading will open shortly.</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!!validationError || isSubmitting || isTradingBlocked}
          className={`w-full py-2.5 rounded-lg font-semibold text-xs tracking-wide transition-colors flex items-center justify-center gap-1.5 ${
            isTradingBlocked
              ? 'bg-[#192820] text-[#647168] cursor-not-allowed border border-[#26372D]'
              : side === 'buy'
              ? 'bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] disabled:bg-[#192820] disabled:text-[#647168]'
              : 'bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] disabled:bg-[#192820] disabled:text-[#647168]'
          }`}
        >
          {isSubmitting ? (
            'Processing...'
          ) : isTradingBlocked ? (
            'Public Trading Closed (MM Prep)'
          ) : (
            <>
              {side === 'buy' ? 'Buy' : 'Sell'} {activePair.baseAsset}
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </form>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl p-5 bg-[#101A15] border border-[#26372D] shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-5 h-5 text-[#10B981]" />
              <h3 className="text-sm font-semibold text-[#F1F5F2]">Confirm Simulated Order</h3>
            </div>

            <p className="text-xs text-[#A1ADA5] mb-4">
              Please review the order details before placing it in the simulation matching engine.
            </p>

            <div className="space-y-2 p-3 bg-[#142019] rounded-lg border border-[#26372D] text-xs font-mono-nums mb-4">
              <div className="flex justify-between">
                <span className="text-[#A1ADA5]">Market Pair:</span>
                <span className="font-semibold text-[#F1F5F2]">{activePair.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1ADA5]">Order Action:</span>
                <span className={side === 'buy' ? 'text-[#10B981] font-bold' : 'text-[#EF6464] font-bold'}>
                  {type.toUpperCase()} {side.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1ADA5]">Amount:</span>
                <span className="text-[#F1F5F2] tabular-nums">
                  {amountNum} {activePair.baseAsset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1ADA5]">Execution Price:</span>
                <span className="text-[#F1F5F2] tabular-nums">{formatIDR(priceNum)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1ADA5]">Simulated Fee:</span>
                <span className="text-[#F1F5F2] tabular-nums">{formatIDR(estimatedFee)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#26372D] text-[#34D399] font-semibold">
                <span>Total Value:</span>
                <span className="tabular-nums">{formatIDR(estimatedNetTotal)}</span>
              </div>
            </div>

            <div className="p-2 mb-4 rounded bg-[#EAB866]/10 border border-[#EAB866]/25 text-[11px] text-[#EAB866]">
              Notice: This is a simulation trade with demo balances. No actual currency or blockchain assets are involved.
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-2 text-xs font-medium text-[#A1ADA5] hover:text-[#F1F5F2] bg-[#142019] hover:bg-[#192820] border border-[#26372D] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteConfirmedOrder}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                  side === 'buy'
                    ? 'bg-[#10B981] hover:bg-[#34D399] text-[#0B100E]'
                    : 'bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E]'
                }`}
              >
                Confirm Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
