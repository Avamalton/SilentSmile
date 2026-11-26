import React, { useState } from 'react';
import { useRouter } from '../router';
import { useSimulation } from '../simulation/store';
import { DEMO_USERS } from '../simulation/constants';
import { UserCheck, ShieldCheck, ArrowRight, UserPlus, LogIn } from 'lucide-react';

export const AuthView: React.FC<{ initialMode?: 'login' | 'register' }> = ({
  initialMode = 'login',
}) => {
  const { navigate } = useRouter();
  const { switchUser, registerDemoUser, currentUser } = useSimulation();

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');

  const handleQuickLogin = (userId: string) => {
    switchUser(userId);
    navigate('/trade');
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (regName.trim() && regEmail.trim()) {
      registerDemoUser(regName.trim(), regEmail.trim());
      navigate('/trade');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-8rem)] p-4">
      <div className="bg-[#142019] w-full max-w-md rounded-xl p-6 sm:p-8 border border-[#26372D] shadow-2xl relative">
        {/* Brand header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto rounded-lg bg-[#101A15] border border-[#10B981]/40 mb-3 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-[#10B981]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 14c4 4 12 4 16 0" />
              <path d="M7 9h.01" />
              <path d="M17 9h.01" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[#F1F5F2]">SILENT SMILE</h1>
          <p className="text-xs text-[#A1ADA5] mt-1">
            Simulated IDR Trading Environment • No Real Funds
          </p>
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 p-1 bg-[#101A15] rounded-lg border border-[#26372D] mb-6 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`py-2 rounded-md transition-colors ${
              mode === 'login'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#26372D]'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Quick Demo Sign-In
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`py-2 rounded-md transition-colors ${
              mode === 'register'
                ? 'bg-[#192820] text-[#34D399] font-semibold border border-[#26372D]'
                : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
            }`}
          >
            Create Demo Profile
          </button>
        </div>

        {mode === 'login' ? (
          <div className="space-y-4">
            <p className="text-xs text-[#A1ADA5]">
              Select one of the pre-configured simulation roles to immediately enter the trading terminal:
            </p>

            <div className="space-y-2.5">
              {DEMO_USERS.map((user) => (
                <div
                  key={user.id}
                  onClick={() => handleQuickLogin(user.id)}
                  className={`group flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    currentUser.id === user.id
                      ? 'bg-[#064E3B]/30 border-[#10B981]/50'
                      : 'bg-[#101A15] border-[#26372D] hover:bg-[#192820] hover:border-[#10B981]/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={user.avatarUrl}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-[#26372D]"
                    />
                    <div>
                      <div className="font-semibold text-xs text-[#F1F5F2] flex items-center gap-1.5">
                        {user.name}
                        {user.role === 'admin' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/30">
                            Admin Role
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#A1ADA5] font-mono">{user.tier}</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="p-1.5 rounded-lg bg-[#142019] border border-[#26372D] group-hover:border-[#10B981]/40 text-[#A1ADA5] group-hover:text-[#34D399] transition-colors"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={handleRegister} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#A1ADA5] mb-1">
                Demo Trader Name
              </label>
              <input
                type="text"
                placeholder="e.g. Budi Santoso"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs text-[#F1F5F2] outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1ADA5] mb-1">
                Virtual Email
              </label>
              <input
                type="email"
                placeholder="budi@example.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs text-[#F1F5F2] outline-none"
                required
              />
            </div>

            <div className="p-2.5 rounded-lg bg-[#064E3B]/25 border border-[#10B981]/30 text-[11px] text-[#34D399]">
              New demo accounts are automatically credited with Rp 500,000,000 simulated IDR and multi-asset reserves.
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" />
              <span>Create Practice Account</span>
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-[#26372D] text-center">
          <p className="text-[11px] text-[#647168]">
            No real phone numbers, passwords, or personal credentials required.
          </p>
        </div>
      </div>
    </div>
  );
};
