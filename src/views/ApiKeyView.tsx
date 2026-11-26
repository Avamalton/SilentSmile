import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import {
  KeyRound,
  Shield,
  Plus,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Code2,
  Trash2,
  Info,
  Clock,
  Globe,
} from 'lucide-react';

export const ApiKeyView: React.FC = () => {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createdKeyResult, setCreatedKeyResult] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const [form, setForm] = useState({
    permissions: ['read', 'trade'],
    ipWhitelist: '',
    rateLimitRpm: '120',
  });

  const fetchKeys = async () => {
    try {
      const res = await fetch('/api/keys');
      const data = await res.json();
      if (data.success) {
        setKeys(data.keys || []);
      }
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create API key');
      }
      setCreatedKeyResult(data.apiKey);
      setShowCreateModal(false);
      await fetchKeys();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm(`Are you sure you want to revoke key ${keyId}?`)) return;
    try {
      const res = await fetch('/api/keys/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchKeys();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-[#10B981]" />
            {t('api_title')}
          </h1>
          <p className="text-xs text-[#A1ADA5] mt-1">{t('api_desc')}</p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="py-2 px-4 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs flex items-center gap-2 transition-colors self-start"
        >
          <Plus className="w-4 h-4" />
          {t('api_create')}
        </button>
      </div>

      {/* Security Notice: Withdrawals Disabled by Policy */}
      <div className="bg-[#142019] p-4 rounded-lg border border-[#EAB866]/35 flex items-start gap-3">
        <Shield className="w-5 h-5 text-[#EAB866] shrink-0 mt-0.5" />
        <div className="text-xs text-[#A1ADA5]">
          <strong className="text-[#F1F5F2] block font-semibold">Kebijakan Kepatuhan & Keamanan:</strong>
          Izin penarikan dana (withdraw) dinonaktifkan secara permanen untuk semua API key. Penarikan dana wajib
          dilakukan secara manual melalui antarmuka pengguna dengan verifikasi 2FA untuk mencegah pencurian saldo.
        </div>
      </div>

      {/* Created Key Modal with Secret Warning */}
      {createdKeyResult && (
        <div className="bg-[#142019] p-5 sm:p-6 rounded-lg border border-[#10B981]/50 space-y-4">
          <div className="flex items-center gap-2 text-[#34D399] text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
            Kunci API Berhasil Dibuat
          </div>
          <p className="text-xs text-[#EAB866] bg-[#101A15] p-3 rounded-lg border border-[#EAB866]/35">
            {t('api_secret_warning')}
          </p>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <span className="text-[#A1ADA5] block text-[11px] mb-1">API Key ID:</span>
              <div className="flex items-center gap-2 bg-[#0B100E] border border-[#26372D] p-2.5 rounded-lg text-[#F1F5F2]">
                <span className="truncate flex-1">{createdKeyResult.keyId}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdKeyResult.keyId);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2000);
                  }}
                  className="text-[#A1ADA5] hover:text-[#F1F5F2]"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              {copiedKey && <span className="text-[10px] text-[#34D399] font-sans">{t('copied')}</span>}
            </div>

            <div>
              <span className="text-[#A1ADA5] block text-[11px] mb-1">API Secret Key (Simpan Sekarang!):</span>
              <div className="flex items-center gap-2 bg-[#0B100E] border border-[#26372D] p-2.5 rounded-lg text-[#EAB866]">
                <span className="truncate flex-1 tracking-wider">{createdKeyResult.secret}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdKeyResult.secret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 2000);
                  }}
                  className="text-[#A1ADA5] hover:text-[#F1F5F2]"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              {copiedSecret && <span className="text-[10px] text-[#34D399] font-sans">{t('copied')}</span>}
            </div>
          </div>

          <button
            onClick={() => setCreatedKeyResult(null)}
            className="py-1.5 px-4 rounded-lg bg-[#192820] hover:bg-[#26372D] border border-[#26372D] text-[#F1F5F2] text-xs font-semibold transition-colors"
          >
            Tutup & Saya Sudah Menyimpan Secret
          </button>
        </div>
      )}

      {/* List Existing Keys */}
      <div className="bg-[#142019] p-5 sm:p-6 rounded-lg border border-[#26372D] space-y-4">
        <h2 className="text-sm font-bold text-[#F1F5F2]">Kunci API Terdaftar</h2>

        {keys.length === 0 ? (
          <p className="text-xs text-[#647168] py-4 text-center">Belum ada API Key yang dibuat.</p>
        ) : (
          <div className="space-y-3">
            {keys.map((k) => {
              const perms = JSON.parse(k.permissions || '[]');
              const isActive = k.is_active === 1;

              return (
                <div
                  key={k.id}
                  className={`p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                    isActive ? 'bg-[#101A15] border-[#26372D]' : 'bg-[#0B100E]/60 border-[#26372D] opacity-50'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-[#F1F5F2] text-xs">{k.key_id}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-sans font-semibold ${
                          isActive
                            ? 'bg-[#064E3B]/45 text-[#34D399] border border-[#10B981]/35'
                            : 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/35'
                        }`}
                      >
                        {isActive ? 'ACTIVE' : 'REVOKED'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px] text-[#A1ADA5]">
                      <span>
                        Izin: <strong className="text-[#34D399]">{perms.join(', ')}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        Rate Limit: <strong className="text-[#F1F5F2] font-mono tabular-nums">{k.rate_limit_rpm} RPM</strong>
                      </span>
                      {k.ip_whitelist && (
                        <>
                          <span>·</span>
                          <span>
                            IP: <strong className="text-[#60A5FA] font-mono">{k.ip_whitelist}</strong>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <button
                      onClick={() => handleRevokeKey(k.key_id)}
                      className="py-1.5 px-3 rounded-lg bg-[#EF6464]/15 text-[#EF6464] hover:bg-[#EF6464]/25 border border-[#EF6464]/35 text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('api_revoke')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Code Signing Example */}
      <div className="bg-[#142019] p-5 rounded-lg border border-[#26372D] space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#F1F5F2]">
          <Code2 className="w-4 h-4 text-[#10B981]" />
          Contoh Autentikasi HMAC SHA-256 (Node.js)
        </div>
        <pre className="p-3 bg-[#0B100E] rounded-lg text-[11px] font-mono text-[#34D399] overflow-x-auto border border-[#26372D] leading-relaxed">
{`const crypto = require('crypto');
const timestamp = Date.now().toString();
const method = 'POST';
const path = '/api/v1/orders';
const body = JSON.stringify({ pairId: 'BTC/IDR', side: 'BUY', price: 1450000000, amount: 1000000 });

// Compute HMAC-SHA256 signature
const payload = timestamp + method + path + body;
const signature = crypto.createHmac('sha256', API_SECRET).update(payload).digest('hex');

// Send HTTP headers:
// X-API-KEY: <your-key-id>
// X-TIMESTAMP: timestamp
// X-SIGNATURE: signature`}
        </pre>
      </div>

      {/* Create Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B100E]/85 backdrop-blur-sm">
          <div className="bg-[#101A15] border border-[#26372D] rounded-xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h2 className="text-base font-bold text-[#F1F5F2]">{t('api_create')}</h2>

            <form onSubmit={handleCreateKey} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#A1ADA5] mb-1.5 font-medium">{t('api_permissions')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-[#F1F5F2]">
                    <input
                      type="checkbox"
                      checked={form.permissions.includes('read')}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.permissions, 'read']
                          : form.permissions.filter((p) => p !== 'read');
                        setForm({ ...form, permissions: next });
                      }}
                      className="rounded bg-[#0B100E] border-[#26372D] accent-[#10B981]"
                    />
                    Read (Data Pasar & Saldo)
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-[#F1F5F2]">
                    <input
                      type="checkbox"
                      checked={form.permissions.includes('trade')}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.permissions, 'trade']
                          : form.permissions.filter((p) => p !== 'trade');
                        setForm({ ...form, permissions: next });
                      }}
                      className="rounded bg-[#0B100E] border-[#26372D] accent-[#10B981]"
                    />
                    Trade (Pasang & Batal Pesanan)
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[#A1ADA5] mb-1 font-medium">{t('api_whitelist')}</label>
                <input
                  type="text"
                  placeholder="Contoh: 192.168.1.10, 203.0.113.5 (Kosongkan jika semua)"
                  value={form.ipWhitelist}
                  onChange={(e) => setForm({ ...form, ipWhitelist: e.target.value })}
                  className="w-full glass-input rounded-lg px-3 py-2 text-[#F1F5F2] placeholder-[#647168] outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-[#A1ADA5] mb-1 font-medium">{t('api_rate_limit')}</label>
                <input
                  type="number"
                  min={30}
                  max={600}
                  value={form.rateLimitRpm}
                  onChange={(e) => setForm({ ...form, rateLimitRpm: e.target.value })}
                  className="w-full glass-input rounded-lg px-3 py-2 text-[#F1F5F2] outline-none font-mono tabular-nums"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2 rounded-lg bg-[#142019] hover:bg-[#192820] border border-[#26372D] text-[#A1ADA5] font-semibold transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold transition-colors"
                >
                  {t('confirm')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
