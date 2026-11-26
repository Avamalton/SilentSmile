import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  Lock,
  Unlock,
  RefreshCw,
  Clock,
  ArrowUpRight,
  Database,
  FileSpreadsheet,
} from 'lucide-react';

export const AdminCompliancePanel: React.FC<{ onSuccessNotice?: (msg: string) => void }> = ({
  onSuccessNotice,
}) => {
  const [subTab, setSubTab] = useState<'kyc' | 'withdrawals' | 'users' | 'aml' | 'audit'>('kyc');
  const [kycPending, setKycPending] = useState<any[]>([]);
  const [withdrawalsPending, setWithdrawalsPending] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [amlAlerts, setAmlAlerts] = useState<any[]>([]);
  const [ledgerAuditResult, setLedgerAuditResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [kycRes, wtdRes, usersRes, amlRes] = await Promise.all([
        fetch('/api/admin/kyc/pending'),
        fetch('/api/admin/withdrawals/pending'),
        fetch('/api/admin/users'),
        fetch('/api/admin/compliance-alerts'),
      ]);

      const [kycData, wtdData, usersData, amlData] = await Promise.all([
        kycRes.json(),
        wtdRes.json(),
        usersRes.json(),
        amlRes.json(),
      ]);

      if (kycData.success) setKycPending(kycData.applications || []);
      if (wtdData.success) setWithdrawalsPending(wtdData.withdrawals || []);
      if (usersData.success) setUsers(usersData.users || []);
      if (amlData.success) setAmlAlerts(amlData.alerts || []);
    } catch (err) {
      console.error('Failed to fetch compliance data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const handleReviewKyc = async (applicationId: string, decision: 'approved' | 'rejected') => {
    let rejectReason: string | undefined;
    if (decision === 'rejected') {
      const input = prompt('Alasan penolakan KYC:');
      if (!input) return;
      rejectReason = input;
    }

    try {
      const res = await fetch('/api/admin/kyc/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, decision, rejectReason }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccessNotice?.(`Aplikasi KYC berhasil di-${decision === 'approved' ? 'setujui' : 'tolak'}.`);
        fetchAdminData();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleApproveWithdrawal = async (withdrawalId: string) => {
    try {
      const res = await fetch('/api/admin/withdrawals/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalId }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccessNotice?.(`Penarikan ${withdrawalId} berhasil disetujui & dieksekusi di ledger!`);
        fetchAdminData();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRejectWithdrawal = async (withdrawalId: string) => {
    const reason = prompt('Alasan penolakan penarikan dana:');
    if (!reason) return;
    try {
      const res = await fetch('/api/admin/withdrawals/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalId, reason }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccessNotice?.(`Penarikan ${withdrawalId} ditolak. Saldo dikembalikan ke Available.`);
        fetchAdminData();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggleFreezeUser = async (userId: string, currentStatus: string) => {
    const endpoint = currentStatus === 'frozen' ? '/api/admin/users/unfreeze' : '/api/admin/users/freeze';
    const reason = prompt(`Alasan ${currentStatus === 'frozen' ? 'membuka pembekuan' : 'membekukan'} akun:`);
    if (!reason) return;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId, reason }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccessNotice?.(data.message);
        fetchAdminData();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRunLedgerAudit = async () => {
    try {
      const res = await fetch('/api/admin/ledger-audit');
      const data = await res.json();
      if (data.success) {
        setLedgerAuditResult(data.audit);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub Tabs */}
      <div className="flex flex-wrap gap-2 pb-2 border-b border-[#26372D] text-xs">
        <button
          onClick={() => setSubTab('kyc')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
            subTab === 'kyc'
              ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/35'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Antrean KYC ({kycPending.length})</span>
        </button>

        <button
          onClick={() => setSubTab('withdrawals')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
            subTab === 'withdrawals'
              ? 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/35'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <ArrowUpRight className="w-4 h-4" />
          <span>Persetujuan Penarikan ({withdrawalsPending.length})</span>
        </button>

        <button
          onClick={() => setSubTab('users')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
            subTab === 'users'
              ? 'bg-[#192820] text-[#F1F5F2] border border-[#10B981]/35'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>Kontrol Akun & Freeze ({users.length})</span>
        </button>

        <button
          onClick={() => setSubTab('aml')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
            subTab === 'aml'
              ? 'bg-[#EAB866]/15 text-[#EAB866] border border-[#EAB866]/35'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>Peringatan AML ({amlAlerts.length})</span>
        </button>

        <button
          onClick={() => setSubTab('audit')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
            subTab === 'audit'
              ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/35'
              : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Audit Integritas Ledger & Ekspor</span>
        </button>
      </div>

      {/* 1. KYC Reviews */}
      {subTab === 'kyc' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-xs text-[#A1ADA5]">
            <span>Aplikasi KYC yang membutuhkan persetujuan manual administrator:</span>
            <button onClick={fetchAdminData} className="hover:text-[#F1F5F2] flex items-center gap-1 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Segarkan
            </button>
          </div>

          {kycPending.length === 0 ? (
            <p className="text-xs text-[#647168] py-6 text-center">Tidak ada aplikasi KYC yang tertunda.</p>
          ) : (
            <div className="space-y-3">
              {kycPending.map((app) => (
                <div key={app.id} className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-3 text-xs">
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <div>
                      <strong className="text-[#F1F5F2] text-sm">{app.full_name}</strong>
                      <div className="text-[#A1ADA5] font-mono text-[11px] tabular-nums">
                        NIK: {app.id_number} · Ref: {app.vendor_reference}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReviewKyc(app.id, 'approved')}
                        className="py-1.5 px-3 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold flex items-center gap-1 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Setujui (Approve)
                      </button>
                      <button
                        onClick={() => handleReviewKyc(app.id, 'rejected')}
                        className="py-1.5 px-3 rounded-lg bg-[#EF6464]/15 text-[#EF6464] hover:bg-[#EF6464]/25 border border-[#EF6464]/30 font-semibold flex items-center gap-1 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Tolak (Reject)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#26372D]">
                    <div>
                      <span className="text-[10px] text-[#A1ADA5] block mb-1">Dokumen KTP:</span>
                      <img src={app.id_card_url} alt="KTP" className="w-32 h-20 object-cover rounded border border-[#26372D]" />
                    </div>
                    <div>
                      <span className="text-[10px] text-[#A1ADA5] block mb-1">Foto Selfie:</span>
                      <img src={app.selfie_url} alt="Selfie" className="w-20 h-20 object-cover rounded-full border border-[#26372D]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Withdrawals Queue */}
      {subTab === 'withdrawals' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-xs text-[#A1ADA5]">
            <span>Antrean verifikasi penarikan dana (Fiat IDR & Kripto):</span>
            <button onClick={fetchAdminData} className="hover:text-[#F1F5F2] flex items-center gap-1 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Segarkan
            </button>
          </div>

          {withdrawalsPending.length === 0 ? (
            <p className="text-xs text-[#647168] py-6 text-center">Tidak ada penarikan dalam antrean persetujuan.</p>
          ) : (
            <div className="space-y-3">
              {withdrawalsPending.map((w) => (
                <div key={w.id} className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-2 text-xs">
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <div>
                      <strong className="text-[#F1F5F2] text-sm font-mono tabular-nums">
                        {w.asset === 'IDR' ? `Rp ${w.amount.toLocaleString()}` : `${w.amount / 100000000} ${w.asset}`}
                      </strong>
                      <span className="text-[10px] text-[#A1ADA5] block font-mono">
                        User: {w.email || w.user_id} · KYC Level: {w.kyc_level}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApproveWithdrawal(w.id)}
                        className="py-1.5 px-3 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold flex items-center gap-1 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Eksekusi Payout
                      </button>
                      <button
                        onClick={() => handleRejectWithdrawal(w.id)}
                        className="py-1.5 px-3 rounded-lg bg-[#EF6464]/15 text-[#EF6464] hover:bg-[#EF6464]/25 border border-[#EF6464]/30 font-semibold flex items-center gap-1 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Tolak & Kembalikan
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#101A15] border border-[#26372D] font-mono text-[11px] text-[#F1F5F2]">
                    <div>Tujuan: {w.destination_bank_name ? `${w.destination_bank_name} - ${w.destination_account_name} (${w.destination_address})` : w.destination_address}</div>
                    <div className="text-[#647168] text-[10px] tabular-nums">Biaya Dipotong: {w.fee} {w.asset}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. User Management & Freeze Controls */}
      {subTab === 'users' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-[#26372D] bg-[#142019]">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead className="bg-[#101A15] text-[#A1ADA5] border-b border-[#26372D]">
                <tr>
                  <th className="py-2.5 px-3">Email / ID</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">KYC</th>
                  <th className="py-2.5 px-3">2FA</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26372D]">
                {users.map((u) => {
                  const isFrozen = u.status === 'frozen';
                  return (
                    <tr key={u.id} className="hover:bg-[#192820] transition-colors">
                      <td className="py-2.5 px-3">
                        <strong className="text-[#F1F5F2] font-sans">{u.email}</strong>
                        <span className="block text-[10px] text-[#647168]">{u.id}</span>
                      </td>
                      <td className="py-2.5 px-3 text-[#60A5FA] uppercase">{u.role}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isFrozen
                              ? 'bg-[#EF6464]/15 text-[#EF6464] border border-[#EF6464]/30'
                              : 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30'
                          }`}
                        >
                          {u.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[#F1F5F2]">Level {u.kyc_level}</td>
                      <td className="py-2.5 px-3 text-[#A1ADA5]">{u.totp_enabled ? 'Aktif' : 'Nonaktif'}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleToggleFreezeUser(u.id, u.status)}
                          className={`py-1 px-2.5 rounded text-[11px] font-sans font-semibold flex items-center gap-1 ml-auto border transition-colors ${
                            isFrozen
                              ? 'bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30 hover:bg-[#10B981]/25'
                              : 'bg-[#EF6464]/15 text-[#EF6464] border-[#EF6464]/30 hover:bg-[#EF6464]/25'
                          }`}
                        >
                          {isFrozen ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          {isFrozen ? 'Buka Freeze' : 'Bekukan Akun'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. AML Alerts */}
      {subTab === 'aml' && (
        <div className="space-y-3">
          <p className="text-xs text-[#A1ADA5]">Peringatan otomatis transaksi mencurigakan dan ambang batas risiko:</p>
          {amlAlerts.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] text-center text-xs text-[#34D399] flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
              Tidak ada aktivitas transaksi mencurigakan yang terdeteksi saat ini.
            </div>
          ) : (
            <div className="space-y-2">
              {amlAlerts.map((a) => (
                <div key={a.id} className="p-3 rounded-xl bg-[#EF6464]/10 border border-[#EF6464]/30 text-xs flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-[#EF6464] shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex justify-between items-center">
                      <strong className="text-[#F1F5F2] font-semibold">{a.type}</strong>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#EF6464]/20 text-[#EF6464] font-bold">
                        {a.severity}
                      </span>
                    </div>
                    <p className="text-[#A1ADA5] mt-0.5">{a.description}</p>
                    <span className="text-[10px] text-[#647168] font-mono mt-1 block">User: {a.userId}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Ledger Integrity Audit & Regulatory CSV Exports */}
      {subTab === 'audit' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-3">
            <h3 className="text-xs font-bold text-[#F1F5F2] uppercase tracking-wider flex items-center gap-2">
              <Database className="w-4 h-4 text-[#10B981]" />
              Audit Integritas Buku Besar (Double-Entry Invariance Check)
            </h3>
            <p className="text-xs text-[#A1ADA5]">
              Menjalankan verifikasi formal bahwa semua mutasi jurnal bernilai seimbang (Σ Debit = Σ Credit = 0)
              dan seluruh saldo rekening sama persis dengan total penjumlahan entri mutasi.
            </p>
            <button
              onClick={handleRunLedgerAudit}
              className="py-2 px-4 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold text-xs flex items-center gap-2 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Jalankan Audit Integritas
            </button>

            {ledgerAuditResult && (
              <div
                className={`p-3 rounded-lg border text-xs font-mono mt-2 tabular-nums ${
                  ledgerAuditResult.isValid
                    ? 'bg-[#064E3B]/30 border-[#10B981]/40 text-[#34D399]'
                    : 'bg-[#EF6464]/10 border-[#EF6464]/40 text-[#EF6464]'
                }`}
              >
                <div>Hasil: {ledgerAuditResult.isValid ? '✓ LEDGER KONSISTEN & SEIMBANG' : '✗ TERJADI KETIDAKSEIMBANGAN'}</div>
                <div className="text-[11px] text-[#A1ADA5] mt-1">
                  Transaksi Terverifikasi: {ledgerAuditResult.transactionCount} | Rekening Diperiksa: {ledgerAuditResult.accountCount}
                </div>
                {ledgerAuditResult.errors.length > 0 && (
                  <div className="mt-2 text-[#EF6464] text-[10px]">
                    Errors: {ledgerAuditResult.errors.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-[#142019] border border-[#26372D] space-y-3">
            <h3 className="text-xs font-bold text-[#F1F5F2] uppercase tracking-wider flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#10B981]" />
              Ekspor Laporan Kepatuhan Regulasi (OJK / Bappebti CSV)
            </h3>
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/admin/compliance-report?type=TRADES"
                download
                className="py-2 px-3 rounded-lg bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] text-xs font-semibold flex items-center gap-1.5 border border-[#26372D] transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#10B981]" /> Unduh Laporan Transaksi (Trades CSV)
              </a>
              <a
                href="/api/admin/compliance-report?type=LEDGER"
                download
                className="py-2 px-3 rounded-lg bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] text-xs font-semibold flex items-center gap-1.5 border border-[#26372D] transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#60A5FA]" /> Unduh Mutasi Jurnal (Ledger Entries CSV)
              </a>
              <a
                href="/api/admin/compliance-report?type=AUDIT"
                download
                className="py-2 px-3 rounded-lg bg-[#192820] hover:bg-[#26372D] text-[#F1F5F2] text-xs font-semibold flex items-center gap-1.5 border border-[#26372D] transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#EAB866]" /> Unduh Log Audit Keamanan (Audit CSV)
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
