import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import {
  Shield,
  Smartphone,
  Key,
  Laptop,
  CheckCircle2,
  AlertTriangle,
  Lock,
  RefreshCw,
  LogOut,
  Copy,
  QrCode,
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [user, setUser] = useState<any>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchSecurityData = async () => {
    try {
      const [userRes, sesRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/auth/sessions'),
      ]);
      const userData = await userRes.json();
      const sesData = await sesRes.json();

      if (userData.success) setUser(userData.user);
      if (sesData.success) {
        setSessions(sesData.sessions || []);
        setCurrentSessionId(sesData.currentSessionId || '');
      }
    } catch (err) {
      console.error('Failed to load security settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecurityData();
  }, []);

  const handleStart2FASetup = async () => {
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTotpSetup(data);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleEnable2FA = async () => {
    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to verify OTP code');
      }
      setMessage({ type: 'success', text: '2FA TOTP successfully activated!' });
      setTotpSetup(null);
      setTotpCode('');
      await fetchSecurityData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleDisable2FA = async () => {
    const code = prompt('Enter your 6-digit 2FA code to disable 2FA:');
    if (!code) return;
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid 2FA code');
      }
      setMessage({ type: 'success', text: '2FA has been disabled.' });
      await fetchSecurityData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch('/api/auth/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: 'Session successfully revoked.' });
        await fetchSecurityData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const copySecret = () => {
    if (!totpSetup) return;
    navigator.clipboard.writeText(totpSetup.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const is2faActive = user?.totp_enabled === 1;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#10B981]" />
          {t('security_title')}
        </h1>
        <p className="text-xs text-[#A1ADA5] mt-1">
          Kelola perlindungan login, autentikasi dua faktor, dan pantau sesi perangkat aktif.
        </p>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-[#064E3B]/35 border-[#10B981]/40 text-[#34D399]'
              : 'bg-[#EF6464]/10 border-[#EF6464]/40 text-[#EF6464]'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* Anti-Brute-Force Banner */}
      <div className="bg-[#142019] p-4 rounded-lg border border-[#10B981]/30 flex items-start gap-3">
        <div className="p-2 rounded-lg bg-[#064E3B]/50 border border-[#10B981]/30 text-[#10B981] shrink-0">
          <Lock className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xs font-bold text-[#F1F5F2] uppercase tracking-wider">Perlindungan Anti-Brute-Force Aktif</h2>
          <p className="text-[11px] text-[#A1ADA5] mt-0.5">{t('brute_force_info')}</p>
        </div>
      </div>

      {/* 2FA TOTP Card */}
      <div className="bg-[#142019] p-5 sm:p-6 rounded-lg border border-[#26372D] space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#101A15] text-[#10B981] border border-[#26372D] flex items-center justify-center">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#F1F5F2]">{t('totp_2fa_title')}</h2>
              <p className="text-xs text-[#A1ADA5]">{t('totp_2fa_desc')}</p>
            </div>
          </div>

          <span
            className={`text-[10px] font-mono px-2.5 py-1 rounded border font-semibold flex items-center gap-1.5 ${
              is2faActive
                ? 'bg-[#064E3B]/45 text-[#34D399] border-[#10B981]/40'
                : 'bg-[#101A15] text-[#A1ADA5] border-[#26372D]'
            }`}
          >
            {is2faActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
            {is2faActive ? 'AKTIF' : 'NONAKTIF'}
          </span>
        </div>

        {!is2faActive ? (
          <div>
            {!totpSetup ? (
              <button
                onClick={handleStart2FASetup}
                className="py-2 px-4 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs transition-colors"
              >
                {t('totp_enable')}
              </button>
            ) : (
              <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-4">
                <div className="text-xs font-semibold text-[#F1F5F2] flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-[#10B981]" />
                  {t('totp_scan_qr')}
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-center">
                  <div className="p-3 bg-[#F1F5F2] rounded-lg border border-[#26372D]">
                    {/* SVG standard QR Representation */}
                    <div className="w-32 h-32 bg-[#0B100E] p-2 flex items-center justify-center text-center text-[10px] text-[#34D399] font-mono break-all leading-tight rounded">
                      [QR CODE]
                      <br />
                      SilentSmile 2FA
                    </div>
                  </div>

                  <div className="space-y-2 flex-1 w-full">
                    <span className="text-[11px] text-[#A1ADA5]">Secret Key (Manual Entry):</span>
                    <div className="flex items-center gap-2 bg-[#0B100E] border border-[#26372D] p-2 rounded-lg font-mono text-xs text-[#34D399]">
                      <span className="truncate flex-1 tracking-widest">{totpSetup.secret}</span>
                      <button onClick={copySecret} className="text-[#A1ADA5] hover:text-[#F1F5F2] p-1">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    {copied && <span className="text-[10px] text-[#34D399]">{t('copied')}</span>}

                    <div className="pt-2">
                      <label className="block text-[11px] text-[#A1ADA5] mb-1">{t('totp_enter_code')}</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="000000"
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, ''))}
                          className="w-32 bg-[#0B100E] border border-[#26372D] rounded-lg px-3 py-1.5 text-center font-mono text-base tracking-widest text-[#F1F5F2] outline-none focus:border-[#10B981]"
                        />
                        <button
                          onClick={handleEnable2FA}
                          disabled={totpCode.length !== 6}
                          className="py-1.5 px-4 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs disabled:opacity-40 transition-colors"
                        >
                          Verifikasi & Aktifkan
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#A1ADA5]">
              Akun Anda dilindungi dengan TOTP. Kode 6-digit diminta setiap kali login dari perangkat baru.
            </p>
            <button
              onClick={handleDisable2FA}
              className="py-1.5 px-3 rounded-lg bg-[#EF6464]/15 text-[#EF6464] hover:bg-[#EF6464]/25 border border-[#EF6464]/40 text-xs font-semibold transition-colors"
            >
              {t('totp_disable')}
            </button>
          </div>
        )}
      </div>

      {/* Active Sessions List */}
      <div className="bg-[#142019] p-5 sm:p-6 rounded-lg border border-[#26372D] space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#26372D]">
          <div className="flex items-center gap-2">
            <Laptop className="w-5 h-5 text-[#10B981]" />
            <h2 className="text-sm font-bold text-[#F1F5F2]">{t('active_sessions')}</h2>
          </div>
          <span className="text-xs text-[#A1ADA5] font-mono tabular-nums">{sessions.length} Sesi Terdaftar</span>
        </div>

        <div className="space-y-2">
          {sessions.map((ses) => {
            const isCurrent = ses.id === currentSessionId;
            const isRevoked = ses.is_revoked === 1;

            return (
              <div
                key={ses.id}
                className={`p-3 rounded-lg border flex items-center justify-between text-xs ${
                  isCurrent
                    ? 'bg-[#064E3B]/20 border-[#10B981]/40'
                    : isRevoked
                    ? 'bg-[#0B100E]/60 border-[#26372D] opacity-50'
                    : 'bg-[#101A15] border-[#26372D]'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-[#F1F5F2]">
                    <span>{ses.device_name || 'Browser'}</span>
                    {isCurrent && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/30">
                        PERANGKAT INI
                      </span>
                    )}
                    {isRevoked && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30">
                        DICABUT
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#A1ADA5] font-mono">
                    IP: {ses.ip_address} · Dibuat: {new Date(ses.created_at).toLocaleString()}
                  </div>
                </div>

                {!isRevoked && !isCurrent && (
                  <button
                    onClick={() => handleRevokeSession(ses.id)}
                    className="py-1 px-2.5 rounded-lg bg-[#EF6464]/15 text-[#EF6464] hover:bg-[#EF6464]/25 border border-[#EF6464]/30 text-[11px] font-semibold transition-colors"
                  >
                    Cabut Sesi
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
