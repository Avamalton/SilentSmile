import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Copy,
  History,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Square,
  StepForward,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useSimulation } from '../../simulation/store';
import { formatDateTime } from '../../utils/formatters';
import { VolumeBotConfigModal } from './VolumeBotConfigModal';
import {
  VolumeBotConfig,
  VolumeBotDTO,
  VolumeBotEnvironment,
  VolumeBotExecutionMode,
} from './volumeBotTypes';

interface VolumeBotHistoryPayload {
  orders: any[];
  trades: any[];
  simEvents: any[];
  configVersions: any[];
}

const ACCESS_TOKEN_KEY = 'ss_vbot_access_token';
const REFRESH_TOKEN_KEY = 'ss_vbot_refresh_token';

function readStoredToken(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredToken(key: string, value: string | null): void {
  try {
    if (value) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {}
}

export const VolumeBotConsoleTab: React.FC<{ onSuccessNotice?: (msg: string) => void }> = ({
  onSuccessNotice,
}) => {
  const { markets, currentUser, autoTradeBots } = useSimulation();

  const [bots, setBots] = useState<VolumeBotDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>('admin@silentsmile.io');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loggingIn, setLoggingIn] = useState<boolean>(false);
  const accessTokenRef = useRef<string | null>(readStoredToken(ACCESS_TOKEN_KEY));

  const [envFilter, setEnvFilter] = useState<'ALL' | VolumeBotEnvironment>('ALL');
  const [modeFilter, setModeFilter] = useState<'ALL' | VolumeBotExecutionMode>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [configModalOpen, setConfigModalOpen] = useState<boolean>(false);
  const [editingBot, setEditingBot] = useState<VolumeBotDTO | null>(null);

  const [historyBot, setHistoryBot] = useState<VolumeBotDTO | null>(null);
  const [historyTab, setHistoryTab] = useState<'trades' | 'orders' | 'logs' | 'versions'>('trades');
  const [historyData, setHistoryData] = useState<VolumeBotHistoryPayload>({
    orders: [],
    trades: [],
    simEvents: [],
    configVersions: [],
  });
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  const notify = useCallback(
    (msg: string) => {
      if (onSuccessNotice) onSuccessNotice(msg);
    },
    [onSuccessNotice]
  );

  const persistSessionTokens = useCallback((nextAccess: string | null, nextRefresh?: string | null) => {
    accessTokenRef.current = nextAccess;
    writeStoredToken(ACCESS_TOKEN_KEY, nextAccess);
    if (nextRefresh !== undefined) {
      writeStoredToken(REFRESH_TOKEN_KEY, nextRefresh);
    }
  }, []);

  const operatorFetch = useCallback(
    async (input: string, init: RequestInit = {}, tokenOverride?: string): Promise<Response> => {
      const currentToken = tokenOverride ?? accessTokenRef.current ?? readStoredToken(ACCESS_TOKEN_KEY);
      const buildHeaders = (tok: string | null) => {
        const headers = new Headers(init.headers || {});
        if (tok) {
          headers.set('Authorization', `Bearer ${tok}`);
        }
        return headers;
      };

      let res = await fetch(input, {
        ...init,
        headers: buildHeaders(currentToken),
        credentials: 'include',
      });

      if (res.status === 401 && !tokenOverride) {
        const storedRefresh = readStoredToken(REFRESH_TOKEN_KEY);
        if (storedRefresh) {
          try {
            const refreshRes = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ refreshToken: storedRefresh }),
            });
            const refreshData = await refreshRes.json();
            if (refreshRes.ok && refreshData.accessToken) {
              persistSessionTokens(refreshData.accessToken, refreshData.refreshToken || storedRefresh);
              res = await fetch(input, {
                ...init,
                headers: buildHeaders(refreshData.accessToken),
                credentials: 'include',
              });
              return res;
            }
          } catch {}
        }
        persistSessionTokens(null, null);
      }

      return res;
    },
    [persistSessionTokens]
  );

  const fetchBots = useCallback(
    async (tokenOverride?: string) => {
      try {
        const res = await operatorFetch('/api/volume-execution-v2/bots', {}, tokenOverride);
        if (res.status === 401 || res.status === 403) {
          if (res.status === 403) {
            try {
              const errBody = await res.json();
              setAuthError(errBody.error || 'Admin or Market Maker role required');
            } catch {}
          }
          setAuthRequired(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (data.success) {
          setBots(data.bots || []);
          setAuthRequired(false);
          setAuthError(null);
          setErrorMsg(null);
        } else {
          setErrorMsg(data.error || 'Failed to load volume bots');
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Network error loading volume bots');
      } finally {
        setLoading(false);
      }
    },
    [operatorFetch]
  );

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  useEffect(() => {
    if (authRequired) return;
    const timer = setInterval(() => {
      fetchBots();
    }, 2500);
    return () => clearInterval(timer);
  }, [authRequired, fetchBots]);

  const handleOperatorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }
      if (!data.accessToken) {
        setAuthError('Login did not return an operator access token (2FA may be required).');
        return;
      }
      persistSessionTokens(data.accessToken, data.refreshToken || null);
      setAuthRequired(false);
      setLoginPassword('');
      await fetchBots(data.accessToken);
      notify(`Operator session authenticated (${data.user?.email})`);
    } catch (err: any) {
      setAuthError(err?.message || 'Login request failed');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSaveConfig = async (config: VolumeBotConfig, deployImmediately: boolean) => {
    if (editingBot) {
      const res = await operatorFetch(`/api/volume-execution-v2/bots/${editingBot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update bot');
      notify(`Updated ${data.bot.name} (v${data.bot.configVersion})`);
    } else {
      const res = await operatorFetch('/api/volume-execution-v2/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, deploy: deployImmediately }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create bot');
      notify(`Created ${data.bot.name} (${data.bot.status})`);
    }
    setEditingBot(null);
    await fetchBots();
  };

  const runBotAction = async (
    botId: string,
    action: 'deploy' | 'start' | 'pause' | 'resume' | 'stop' | 'emergency-stop' | 'tick' | 'clone'
  ) => {
    setErrorMsg(null);
    const res = await operatorFetch(`/api/volume-execution-v2/bots/${botId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      setAuthRequired(true);
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      setErrorMsg(data.error || `Action ${action} failed`);
      return;
    }
    await fetchBots();
    notify(`Bot ${action.toUpperCase()} completed (${data.bot?.status || 'OK'})`);
  };

  const handleDeleteBot = async (bot: VolumeBotDTO) => {
    setErrorMsg(null);
    const res = await operatorFetch(`/api/volume-execution-v2/bots/${bot.id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setErrorMsg(data.error || 'Failed to delete bot');
      return;
    }
    await fetchBots();
    notify(`Deleted ${bot.name} and cancelled bot-owned open orders`);
  };

  const handleMigrateLegacy = async () => {
    if (!autoTradeBots || autoTradeBots.length === 0) return;
    setErrorMsg(null);
    const res = await operatorFetch('/api/volume-execution-v2/bots/migrate-legacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bots: autoTradeBots.map((b) => ({
          id: `legacy_${b.targetPair}`,
          targetPair: b.targetPair,
          targetVolume: b.targetVolume,
          minOrderSize: b.minOrderSize,
          maxOrderSize: b.maxOrderSize,
          intervalSeconds: b.intervalSeconds,
          executionMode: b.executionMode,
          autoStopOnTarget: b.autoStopOnTarget,
          environment: 'DEMO',
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setErrorMsg(data.error || 'Legacy migration failed');
      return;
    }
    await fetchBots();
    notify(`Migrated ${data.bots?.length || 0} legacy Auto-Trade configuration(s) into Volume Execution V2`);
  };

  const openHistoryModal = async (bot: VolumeBotDTO) => {
    setHistoryBot(bot);
    setHistoryTab('trades');
    setLoadingHistory(true);
    try {
      const [histRes, logsRes] = await Promise.all([
        operatorFetch(`/api/volume-execution-v2/bots/${bot.id}/history?limit=100`),
        operatorFetch(`/api/volume-execution-v2/bots/${bot.id}/logs?limit=100`),
      ]);
      const [histJson, logsJson] = await Promise.all([histRes.json(), logsRes.json()]);
      if (histJson.success) {
        setHistoryData({
          orders: histJson.orders || [],
          trades: histJson.trades || [],
          simEvents: histJson.simEvents || [],
          configVersions: histJson.configVersions || [],
        });
      }
      if (logsJson.success) {
        setHistoryLogs(logsJson.logs || []);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load bot history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleRollbackVersion = async (botId: string, configVersion: number) => {
    const res = await operatorFetch(`/api/volume-execution-v2/bots/${botId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configVersion }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setErrorMsg(data.error || 'Config rollback failed');
      return;
    }
    await fetchBots();
    setHistoryBot(data.bot);
    await openHistoryModal(data.bot);
    notify(`Rolled back ${data.bot.name} to snapshot v${configVersion}`);
  };

  const filteredBots = useMemo(() => {
    return bots.filter((b) => {
      if (envFilter !== 'ALL' && b.environment !== envFilter) return false;
      if (modeFilter !== 'ALL' && b.executionMode !== modeFilter) return false;
      return true;
    });
  }, [bots, envFilter, modeFilter]);

  const runningCount = useMemo(() => bots.filter((b) => b.status === 'RUNNING').length, [bots]);
  const riskLockedCount = useMemo(() => bots.filter((b) => b.status === 'RISK_LOCKED').length, [bots]);
  const totalTrades = useMemo(
    () => bots.reduce((sum, b) => sum + (b.metrics?.totalTradesCount || 0), 0),
    [bots]
  );

  if (authRequired) {
    return (
      <div className="p-6 rounded-xl bg-[#142019] border border-[#26372D] max-w-lg mx-auto space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#10B981]/30">
            <Lock className="w-5 h-5 text-[#10B981]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#F1F5F2]">
              Volume Execution V2 Operator Authentication
            </h3>
            <p className="text-xs text-[#A1ADA5] mt-1">
              Authoritative bot lifecycle, risk limits, and LIVE ledger execution require an authenticated Admin or Market Maker backend session.
            </p>
          </div>
        </div>

        {authError && (
          <div className="p-2.5 rounded-lg bg-[#EF6464]/15 border border-[#EF6464]/40 text-xs text-[#EF6464]">
            {authError}
          </div>
        )}

        <form onSubmit={handleOperatorLogin} className="space-y-3 text-xs">
          <div>
            <label className="block text-[#A1ADA5] font-semibold mb-1">Operator Email</label>
            <input
              type="email"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
            />
          </div>
          <div>
            <label className="block text-[#A1ADA5] font-semibold mb-1">Password</label>
            <input
              type="password"
              required
              placeholder="Enter operator password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#101A15] border border-[#26372D] focus:border-[#10B981] outline-none text-[#F1F5F2] font-mono"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-[#647168] font-mono">
              Seeded dev admin: admin@silentsmile.io
            </span>
            <button
              type="submit"
              disabled={loggingIn}
              className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] disabled:opacity-50 text-[#0B100E] font-bold"
            >
              {loggingIn ? 'Authenticating...' : 'Sign In Session'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top KPI & Control Header */}
      <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#F1F5F2] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#10B981]" />
              Volume Execution & Liquidity Management Bots (V2)
            </h3>
            <p className="text-xs text-[#A1ADA5] mt-0.5">
              Server-authoritative BigInt execution • Zero wash trading • Isolated SIMULATION vs LIVE Matching Engine
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {autoTradeBots.length > 0 && (
              <button
                type="button"
                onClick={handleMigrateLegacy}
                className="px-3 py-2 rounded-lg bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#EAB866] font-semibold flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Migrate Legacy ({autoTradeBots.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                void fetchBots();
              }}
              className="px-3 py-2 rounded-lg bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingBot(null);
                setConfigModalOpen(true);
              }}
              className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>New Volume Bot</span>
            </button>
          </div>
        </div>

        {/* Summary Strip & Isolation Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#26372D] text-xs">
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <span className="text-[#A1ADA5]">
              Bots: <strong className="text-[#F1F5F2]">{bots.length}</strong>
            </span>
            <span className="text-[#A1ADA5]">
              Running: <strong className="text-[#34D399]">{runningCount}</strong>
            </span>
            <span className="text-[#A1ADA5]">
              Verified Trades: <strong className="text-[#F1F5F2]">{totalTrades}</strong>
            </span>
            {riskLockedCount > 0 && (
              <span className="text-[#EF6464]">
                Risk Locked: <strong>{riskLockedCount}</strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono text-[11px]"
            >
              <option value="ALL">ENV: ALL</option>
              <option value="DEMO">ENV: DEMO</option>
              <option value="SANDBOX">ENV: SANDBOX</option>
              <option value="STAGING">ENV: STAGING</option>
              <option value="PRODUCTION">ENV: PRODUCTION</option>
            </select>

            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg bg-[#101A15] border border-[#26372D] text-[#F1F5F2] font-mono text-[11px]"
            >
              <option value="ALL">MODE: ALL</option>
              <option value="SIMULATION">MODE: SIMULATION</option>
              <option value="LIVE">MODE: LIVE</option>
            </select>
          </div>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-[#EF6464]/15 border border-[#EF6464]/40 text-xs text-[#EF6464] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Bot Cards Grid */}
      {loading ? (
        <div className="p-8 rounded-xl bg-[#142019] border border-[#26372D] text-center text-xs text-[#A1ADA5]">
          Loading authoritative Volume Execution Engine state...
        </div>
      ) : filteredBots.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#142019] border border-[#26372D] text-center space-y-3">
          <p className="text-sm font-semibold text-[#F1F5F2]">No Volume Execution Bots Configured</p>
          <p className="text-xs text-[#A1ADA5] max-w-md mx-auto">
            Create an institutional TWAP, VWAP, Iceberg, Passive Limit, or Aggressive Limit execution bot with server-side BigInt risk guards.
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingBot(null);
              setConfigModalOpen(true);
            }}
            className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Create Volume Bot</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredBots.map((bot) => {
            const pct = Math.min(100, Math.max(0, bot.metrics.completionPct || 0));
            const isRunning = bot.status === 'RUNNING';
            const isPaused = bot.status === 'PAUSED';
            const isDraft = bot.status === 'DRAFT';

            const statusBadgeClass =
              bot.status === 'RUNNING'
                ? 'bg-[#064E3B]/60 text-[#34D399] border-[#10B981]/40'
                : bot.status === 'COMPLETED'
                ? 'bg-[#60A5FA]/15 text-[#60A5FA] border-[#60A5FA]/40'
                : bot.status === 'RISK_LOCKED' || bot.status === 'ERROR'
                ? 'bg-[#EF6464]/15 text-[#EF6464] border-[#EF6464]/40'
                : bot.status === 'PAUSED'
                ? 'bg-[#EAB866]/15 text-[#EAB866] border-[#EAB866]/40'
                : 'bg-[#101A15] text-[#A1ADA5] border-[#26372D]';

            return (
              <div
                key={bot.id}
                className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-3.5"
              >
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-[#F1F5F2]">{bot.name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#101A15] border border-[#26372D] font-mono text-[10px] font-bold text-[#F1F5F2]">
                        {bot.pairId}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${
                          bot.executionSide === 'BUY'
                            ? 'bg-[#064E3B]/40 text-[#34D399] border-[#10B981]/30'
                            : 'bg-[#EF6464]/15 text-[#EF6464] border-[#EF6464]/30'
                        }`}
                      >
                        {bot.executionSide} • {bot.strategy}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] font-mono text-[#A1ADA5]">
                      <span>Acct: {bot.accountId}</span>
                      <span>• v{bot.configVersion}</span>
                      <span>• Env: {bot.environment}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded border font-bold ${
                          bot.executionMode === 'LIVE'
                            ? 'bg-[#EF6464]/15 text-[#EF6464] border-[#EF6464]/40'
                            : 'bg-[#EAB866]/10 text-[#EAB866] border-[#EAB866]/30'
                        }`}
                      >
                        {bot.executionMode}
                      </span>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded border font-mono text-[10.5px] font-bold ${statusBadgeClass}`}>
                    {bot.status}
                  </span>
                </div>

                {/* Executed-Trade Progress Bar */}
                <div className="p-3 rounded-lg bg-[#101A15] border border-[#26372D] space-y-1.5 tabular-nums">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-[#A1ADA5]">
                      Executed Volume ({pct.toFixed(2)}%)
                    </span>
                    <span className="text-[#34D399] font-bold">
                      {bot.metrics.executedVolume} / {bot.metrics.targetVolume} {bot.baseAsset}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#142019] border border-[#26372D] overflow-hidden">
                    <div
                      className="h-full bg-[#10B981] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10.5px] font-mono text-[#647168]">
                    <span>
                      Remaining: {bot.metrics.remainingVolume} {bot.baseAsset}
                    </span>
                    <span>
                      Notional: {bot.metrics.executedQuoteNotional} {bot.quoteAsset}
                    </span>
                  </div>
                </div>

                {/* Primary + Performance + Risk Grid */}
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums">
                  <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D]">
                    <div className="text-[10px] text-[#647168] uppercase">Primary</div>
                    <div className="mt-1 space-y-0.5 text-[#A1ADA5]">
                      <div className="flex justify-between">
                        <span>Avg Fill</span>
                        <span className="text-[#F1F5F2]">{bot.metrics.averageFillPrice || '0'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Fees</span>
                        <span className="text-[#F1F5F2]">{bot.metrics.totalFees || '0'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Trades</span>
                        <span className="text-[#34D399] font-bold">{bot.metrics.totalTradesCount}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D]">
                    <div className="text-[10px] text-[#647168] uppercase">Orders</div>
                    <div className="mt-1 space-y-0.5 text-[#A1ADA5]">
                      <div className="flex justify-between">
                        <span>Sub / Acc</span>
                        <span className="text-[#F1F5F2]">
                          {bot.metrics.submittedOrdersCount}/{bot.metrics.acceptedOrdersCount}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Fill / Part</span>
                        <span className="text-[#34D399]">
                          {bot.metrics.filledOrdersCount}/{bot.metrics.partialFillsCount}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Canc / Exp</span>
                        <span className="text-[#EAB866]">
                          {bot.metrics.cancelledOrdersCount}/{bot.metrics.expiredOrdersCount}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D]">
                    <div className="text-[10px] text-[#647168] uppercase">Risk</div>
                    <div className="mt-1 space-y-0.5 text-[#A1ADA5]">
                      <div className="flex justify-between">
                        <span>Open Ord</span>
                        <span className="text-[#F1F5F2]">
                          {bot.metrics.openOrdersCount}/{bot.config.maxOpenOrders}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Slippage</span>
                        <span className="text-[#EAB866]">{bot.metrics.averageSlippageBps} bps</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Breaches</span>
                        <span className="text-[#EF6464]">
                          {bot.riskState.collarBreaches +
                            bot.riskState.slippageBreaches +
                            bot.riskState.balanceRejections}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Risk Lock / Last Error */}
                {(bot.lastError || bot.riskState.riskLockReason) && (
                  <div className="p-2 rounded-lg bg-[#EF6464]/10 border border-[#EF6464]/30 text-[11px] font-mono text-[#EF6464] truncate">
                    {bot.riskState.riskLockReason || bot.lastError}
                  </div>
                )}

                {/* Control Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#26372D] text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isDraft && (
                      <button
                        type="button"
                        onClick={() => runBotAction(bot.id, 'deploy')}
                        className="px-2.5 py-1 rounded-lg bg-[#064E3B] hover:bg-[#10B981] text-[#F1F5F2] hover:text-[#0B100E] font-bold"
                      >
                        Deploy
                      </button>
                    )}

                    {!isRunning && !isDraft && bot.status !== 'COMPLETED' && (
                      <button
                        type="button"
                        onClick={() => runBotAction(bot.id, isPaused ? 'resume' : 'start')}
                        className="px-2.5 py-1 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold flex items-center gap-1"
                      >
                        <Play className="w-3 h-3" />
                        <span>{isPaused ? 'Resume' : 'Start'}</span>
                      </button>
                    )}

                    {isRunning && (
                      <>
                        <button
                          type="button"
                          onClick={() => runBotAction(bot.id, 'pause')}
                          className="px-2.5 py-1 rounded-lg bg-[#EAB866]/20 hover:bg-[#EAB866]/30 text-[#EAB866] border border-[#EAB866]/40 font-bold flex items-center gap-1"
                        >
                          <Pause className="w-3 h-3" />
                          <span>Pause</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => runBotAction(bot.id, 'tick')}
                          className="px-2 py-1 rounded-lg bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#34D399] font-semibold flex items-center gap-1"
                          title="Trigger one immediate scheduler cycle"
                        >
                          <StepForward className="w-3 h-3" />
                          <span>Step</span>
                        </button>
                      </>
                    )}

                    {(isRunning || isPaused) && (
                      <button
                        type="button"
                        onClick={() => runBotAction(bot.id, 'stop')}
                        className="px-2.5 py-1 rounded-lg bg-[#101A15] hover:bg-[#EF6464]/20 text-[#EF6464] border border-[#EF6464]/40 font-bold flex items-center gap-1"
                      >
                        <Square className="w-3 h-3" />
                        <span>Stop</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => runBotAction(bot.id, 'emergency-stop')}
                      className="px-2 py-1 rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/40 font-bold flex items-center gap-1"
                      title="Emergency Stop & Cancel Bot Orders"
                    >
                      <ShieldAlert className="w-3 h-3" />
                      <span>E-Stop</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openHistoryModal(bot)}
                      className="px-2 py-1 rounded-lg bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2] flex items-center gap-1"
                    >
                      <History className="w-3 h-3" />
                      <span>History</span>
                    </button>
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => {
                        setEditingBot(bot);
                        setConfigModalOpen(true);
                      }}
                      className="px-2 py-1 rounded-lg bg-[#101A15] hover:bg-[#192820] disabled:opacity-40 border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2]"
                      title={isRunning ? 'Pause bot before editing' : 'Edit Config'}
                    >
                      <Sliders className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => runBotAction(bot.id, 'clone')}
                      className="px-2 py-1 rounded-lg bg-[#101A15] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2]"
                      title="Clone Bot"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBot(bot)}
                      className="px-2 py-1 rounded-lg bg-[#101A15] hover:bg-[#EF6464]/20 border border-[#26372D] text-[#A1ADA5] hover:text-[#EF6464]"
                      title="Delete Bot"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Config Modal */}
      <VolumeBotConfigModal
        isOpen={configModalOpen}
        editingBot={editingBot}
        markets={markets}
        defaultAccountId={currentUser?.role === 'market_maker' ? currentUser.id : 'usr_mm_01'}
        onClose={() => {
          setConfigModalOpen(false);
          setEditingBot(null);
        }}
        onSubmit={handleSaveConfig}
      />

      {/* Execution History & Logs Modal */}
      {historyBot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-[#142019] border border-[#26372D] shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#101A15] border-b border-[#26372D]">
              <div>
                <h4 className="text-sm font-bold text-[#F1F5F2] flex items-center gap-2">
                  <History className="w-4 h-4 text-[#10B981]" />
                  Execution History & Logs — {historyBot.name} ({historyBot.executionMode})
                </h4>
                <p className="text-[11px] text-[#A1ADA5] font-mono">
                  {historyBot.pairId} • Executed: {historyBot.metrics.executedVolume}/{historyBot.metrics.targetVolume}{' '}
                  {historyBot.baseAsset}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryBot(null)}
                className="p-1.5 rounded-lg bg-[#142019] border border-[#26372D] text-[#A1ADA5] hover:text-[#F1F5F2]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 px-5 py-2.5 bg-[#101A15] border-b border-[#26372D] text-xs font-semibold">
              {(
                [
                  { id: 'trades', label: `Trades (${historyData.trades.length})` },
                  { id: 'orders', label: `Orders (${historyData.orders.length})` },
                  { id: 'logs', label: `Activity Logs (${historyLogs.length})` },
                  { id: 'versions', label: `Config Versions (${historyData.configVersions.length})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setHistoryTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg transition-colors ${
                    historyTab === t.id
                      ? 'bg-[#10B981] text-[#0B100E]'
                      : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 text-xs font-mono">
              {loadingHistory ? (
                <div className="text-center py-8 text-[#A1ADA5]">Loading execution records...</div>
              ) : historyTab === 'trades' ? (
                historyData.trades.length === 0 ? (
                  <div className="text-center py-8 text-[#647168]">
                    No verified fills recorded yet. Submitted/cancelled orders never count as volume.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {historyData.trades.map((tr: any) => (
                      <div
                        key={tr.id}
                        className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] flex flex-wrap items-center justify-between gap-2 tabular-nums"
                      >
                        <div>
                          <span className="text-[#34D399] font-bold">{tr.trade_id}</span>
                          <span className="ml-2 text-[#A1ADA5]">Order: {tr.order_id}</span>
                        </div>
                        <div className="text-[#F1F5F2]">
                          QtyAtomic: {tr.amount_atomic} @ PriceAtomic: {tr.price_atomic} • Slip: {tr.slippage_bps} bps
                        </div>
                        <div className="text-[#647168] text-[10.5px]">{formatDateTime(tr.timestamp)}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : historyTab === 'orders' ? (
                historyData.orders.length === 0 ? (
                  <div className="text-center py-8 text-[#647168]">No bot orders submitted yet.</div>
                ) : (
                  <div className="space-y-2">
                    {historyData.orders.map((ord: any) => (
                      <div
                        key={ord.id}
                        className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] flex flex-wrap items-center justify-between gap-2 tabular-nums"
                      >
                        <div>
                          <span className="text-[#F1F5F2] font-bold">{ord.id}</span>
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-[#142019] border border-[#26372D] text-[10px]">
                            {ord.status}
                          </span>
                        </div>
                        <div className="text-[#A1ADA5]">
                          Filled {ord.filled_amount_atomic}/{ord.amount_atomic} @ {ord.price_atomic}
                        </div>
                        <div className="text-[#647168] text-[10.5px]">{formatDateTime(ord.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : historyTab === 'logs' ? (
                historyLogs.length === 0 ? (
                  <div className="text-center py-8 text-[#647168]">No activity logs recorded.</div>
                ) : (
                  <div className="space-y-2">
                    {historyLogs.map((lg: any) => (
                      <div key={lg.id} className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] space-y-1">
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-bold ${
                              lg.level === 'RISK' || lg.level === 'ERROR'
                                ? 'text-[#EF6464]'
                                : lg.level === 'EXECUTION'
                                ? 'text-[#34D399]'
                                : 'text-[#EAB866]'
                            }`}
                          >
                            [{lg.level}] {lg.event_type}
                          </span>
                          <span className="text-[#647168] text-[10.5px]">{formatDateTime(lg.timestamp)}</span>
                        </div>
                        <div className="text-[#F1F5F2] font-sans">{lg.message}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  {historyData.configVersions.map((ver: any) => (
                    <div
                      key={ver.id}
                      className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="text-[#F1F5F2] font-bold">v{ver.config_version}</span>
                        <span className="ml-2 text-[#A1ADA5]">{ver.reason}</span>
                        <span className="ml-2 text-[#647168]">by {ver.changed_by}</span>
                      </div>
                      <button
                        type="button"
                        disabled={historyBot.status === 'RUNNING'}
                        onClick={() => handleRollbackVersion(historyBot.id, ver.config_version)}
                        className="px-2.5 py-1 rounded bg-[#142019] hover:bg-[#192820] disabled:opacity-40 border border-[#26372D] text-[#34D399] flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Rollback</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
