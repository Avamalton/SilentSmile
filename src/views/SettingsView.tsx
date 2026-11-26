import React, { useState } from 'react';
import { useSimulation } from '../simulation/store';
import {
  Settings,
  Cpu,
  Sliders,
  RotateCcw,
  Volume2,
  VolumeX,
  Eye,
  Check,
  AlertTriangle,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, resetSimulationData, currentUser } = useSimulation();

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleUpdate = (updates: any) => {
    updateSettings(updates);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1500);
  };

  const handleConfirmReset = () => {
    resetSimulationData();
    setResetModalOpen(false);
  };

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
          Simulation & Terminal Settings
        </h1>
        <p className="text-xs text-[#A1ADA5] mt-0.5">
          Configure matching engine parameters, display options, and simulation environment preferences.
        </p>
      </div>

      {savedNotice && (
        <div className="p-2.5 rounded-lg bg-[#064E3B]/35 text-[#34D399] border border-[#10B981]/30 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-[#10B981]" />
          Settings saved to local storage.
        </div>
      )}

      {/* 1. Simulation Engine Speed & Dynamics */}
      <div className="bg-[#142019] border border-[#26372D] rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2.5 border-b border-[#26372D]">
          <Cpu className="w-4 h-4 text-[#10B981]" />
          <h2 className="text-sm font-semibold text-[#F1F5F2]">Matching Engine & Tick Dynamics</h2>
        </div>

        {/* Engine Speed */}
        <div>
          <label className="block text-xs font-medium text-[#A1ADA5] mb-1.5">
            Simulation Clock Speed
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { id: 'fast', label: 'Fast (1.2s)' },
              { id: 'normal', label: 'Normal (2.2s)' },
              { id: 'slow', label: 'Slow (4.0s)' },
              { id: 'paused', label: 'Paused' },
            ].map((sp) => (
              <button
                key={sp.id}
                type="button"
                onClick={() => handleUpdate({ engineSpeed: sp.id })}
                className={`py-2 px-3 rounded-lg text-xs font-mono font-medium border transition-colors ${
                  settings.engineSpeed === sp.id
                    ? 'bg-[#064E3B]/50 text-[#34D399] border-[#10B981]/50'
                    : 'bg-[#101A15] text-[#A1ADA5] border-[#26372D] hover:text-[#F1F5F2] hover:bg-[#192820]'
                }`}
              >
                {sp.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#647168] mt-1">
            Controls how frequently synthetic background trades occur and prices update.
          </p>
        </div>

        {/* Synthetic Volatility */}
        <div>
          <label className="block text-xs font-medium text-[#A1ADA5] mb-1.5">
            Synthetic Volatility Factor
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'low', label: 'Low (~0.06%)' },
              { id: 'normal', label: 'Normal (~0.15%)' },
              { id: 'high', label: 'High (~0.35%)' },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => handleUpdate({ volatility: v.id })}
                className={`py-2 px-3 rounded-lg text-xs font-mono font-medium border transition-colors ${
                  settings.volatility === v.id
                    ? 'bg-[#064E3B]/50 text-[#34D399] border-[#10B981]/50'
                    : 'bg-[#101A15] text-[#A1ADA5] border-[#26372D] hover:text-[#F1F5F2] hover:bg-[#192820]'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Visual & Display Preferences */}
      <div className="bg-[#142019] border border-[#26372D] rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2.5 border-b border-[#26372D]">
          <Eye className="w-4 h-4 text-[#10B981]" />
          <h2 className="text-sm font-semibold text-[#F1F5F2]">Display & Interface Options</h2>
        </div>

        {/* Moving Averages */}
        <div className="flex items-center justify-between py-1">
          <div>
            <div className="text-xs font-medium text-[#F1F5F2]">Show Moving Averages (MA7 & MA25)</div>
            <div className="text-[11px] text-[#647168]">Overlay trend indicators on the trading candlestick chart</div>
          </div>
          <button
            type="button"
            onClick={() => handleUpdate({ showMovingAverages: !settings.showMovingAverages })}
            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
              settings.showMovingAverages
                ? 'bg-[#10B981] border-[#10B981]'
                : 'bg-[#101A15] border-[#26372D]'
            }`}
          >
            <div
              className={`w-4.5 h-4.5 rounded-full bg-[#F1F5F2] transition-transform ${
                settings.showMovingAverages ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Auto Refresh Order Book */}
        <div className="flex items-center justify-between py-2 border-t border-[#26372D]/70">
          <div>
            <div className="text-xs font-medium text-[#F1F5F2]">Auto-Update Order Book Depth</div>
            <div className="text-[11px] text-[#647168]">Regenerate live bids/asks dynamically with tick fluctuations</div>
          </div>
          <button
            type="button"
            onClick={() => handleUpdate({ autoRefreshBook: !settings.autoRefreshBook })}
            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
              settings.autoRefreshBook
                ? 'bg-[#10B981] border-[#10B981]'
                : 'bg-[#101A15] border-[#26372D]'
            }`}
          >
            <div
              className={`w-4.5 h-4.5 rounded-full bg-[#F1F5F2] transition-transform ${
                settings.autoRefreshBook ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Sound Simulation */}
        <div className="flex items-center justify-between py-2 border-t border-[#26372D]/70">
          <div className="flex items-center gap-2">
            <div>
              <div className="text-xs font-medium text-[#F1F5F2]">Simulated Audio Feedback</div>
              <div className="text-[11px] text-[#647168]">Audio chime on order fills and cancellations</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleUpdate({ soundEnabled: !settings.soundEnabled })}
            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
              settings.soundEnabled
                ? 'bg-[#10B981] border-[#10B981]'
                : 'bg-[#101A15] border-[#26372D]'
            }`}
          >
            <div
              className={`w-4.5 h-4.5 rounded-full bg-[#F1F5F2] transition-transform ${
                settings.soundEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 3. Demo Data Management (Reset Environment) */}
      <div className="bg-[#142019] rounded-lg p-5 border border-[#EF6464]/30 space-y-3">
        <div className="flex items-center gap-2 pb-2.5 border-b border-[#26372D]">
          <RotateCcw className="w-4 h-4 text-[#EF6464]" />
          <h2 className="text-sm font-semibold text-[#EF6464]">Reset Demo Environment</h2>
        </div>
        <p className="text-xs text-[#A1ADA5] leading-relaxed">
          Restore initial seeded virtual balances (Rp 500M IDR, 0.45 BTC, 4.2 ETH, etc.), clear all open orders, and purge trade history back to clean sandbox state.
        </p>

        <button
          type="button"
          onClick={() => setResetModalOpen(true)}
          className="px-4 py-2 bg-[#EF6464]/10 hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/30 rounded-lg text-xs font-semibold transition-colors"
        >
          Reset Simulation Data...
        </button>
      </div>

      {/* Confirmation Modal */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B100E]/85 backdrop-blur-sm">
          <div className="bg-[#101A15] w-full max-w-sm rounded-lg p-5 border border-[#EF6464]/40 shadow-2xl">
            <div className="flex items-center gap-2 text-[#EF6464] mb-2">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-[#F1F5F2]">Confirm Reset</h3>
            </div>
            <p className="text-xs text-[#A1ADA5] mb-4">
              Are you sure you want to reset all simulated balances and orders back to baseline? This cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="flex-1 py-2 text-xs text-[#A1ADA5] hover:text-[#F1F5F2] bg-[#142019] border border-[#26372D] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="flex-1 py-2 text-xs font-semibold bg-[#EF6464] hover:bg-[#EF6464]/90 text-[#0B100E] rounded-lg transition-colors"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
