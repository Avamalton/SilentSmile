import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import {
  ShieldCheck,
  AlertTriangle,
  Upload,
  User,
  CreditCard,
  Camera,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Zap,
} from 'lucide-react';

export const KycView: React.FC = () => {
  const { t } = useTranslation();
  const [kycData, setKycData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    idNumber: '',
    idCardUrl: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=600&auto=format&fit=crop&q=60',
    selfieUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=60',
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchKycStatus = async () => {
    try {
      const res = await fetch('/api/kyc/me');
      const data = await res.json();
      if (data.success) {
        setKycData(data);
      }
    } catch (err) {
      console.error('Failed to load KYC status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKycStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit KYC application');
      }
      setMessage({ type: 'success', text: 'KYC application submitted successfully!' });
      await fetchKycStatus();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulateSumsub = async (decision: 'GREEN' | 'RED') => {
    if (!kycData?.application?.vendor_reference) return;
    try {
      const res = await fetch('/api/kyc/sumsub-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorReference: kycData.application.vendor_reference,
          reviewResult: decision,
          moderationComment: decision === 'RED' ? 'Facial mismatch detected in selfie' : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `Sumsub Webhook Simulated: ${decision === 'GREEN' ? 'Approved' : 'Rejected'}` });
        await fetchKycStatus();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const app = kycData?.application;
  const isApproved = app?.status === 'approved' || kycData?.kycLevel >= 1;
  const isPending = app?.status === 'pending';
  const isRejected = app?.status === 'rejected';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F2] flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-[#10B981]" />
          {t('kyc_title')}
        </h1>
        <p className="text-xs text-[#A1ADA5] mt-1">{t('kyc_desc')}</p>
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

      {/* KYC Tier Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`bg-[#142019] p-4 rounded-lg border ${isApproved ? 'border-[#10B981]/40 bg-[#064E3B]/15' : 'border-[#26372D]'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#A1ADA5]">Level 0 (Unverified)</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#101A15] border border-[#26372D] text-[#A1ADA5]">
              {isApproved ? 'Surpassed' : 'Current'}
            </span>
          </div>
          <div className="text-sm font-bold text-[#F1F5F2] font-mono tabular-nums">Rp 0 / Hari</div>
          <p className="text-[11px] text-[#647168] mt-1">Penarikan dana dinonaktifkan hingga identitas diverifikasi.</p>
        </div>

        <div className={`bg-[#142019] p-4 rounded-lg border ${isApproved ? 'border-[#10B981]/50 bg-[#064E3B]/20' : 'border-[#26372D]'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#34D399]">Level 1 (ID & Selfie Verified)</span>
            {isApproved && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#064E3B]/50 text-[#34D399] border border-[#10B981]/40 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Aktif
              </span>
            )}
          </div>
          <div className="text-sm font-bold text-[#F1F5F2] font-mono tabular-nums">Rp 100.000.000 / Hari</div>
          <p className="text-[11px] text-[#A1ADA5] mt-1">Batas penarikan penuh untuk Virtual Account & aset kripto.</p>
        </div>
      </div>

      {/* Application Status Banner */}
      {isApproved && (
        <div className="bg-[#142019] p-6 rounded-lg border border-[#10B981]/40 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#064E3B]/50 border border-[#10B981]/40 text-[#10B981] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-[#F1F5F2]">{t('kyc_approved_notice')}</h2>
          <p className="text-xs text-[#A1ADA5] max-w-md mx-auto">
            Nama resmi: <strong className="text-[#F1F5F2]">{app?.full_name}</strong> · NIK: <strong className="text-[#F1F5F2] font-mono">{app?.id_number}</strong>
          </p>
        </div>
      )}

      {isPending && (
        <div className="bg-[#142019] p-6 rounded-lg border border-[#EAB866]/40 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#EAB866]/15 border border-[#EAB866]/35 text-[#EAB866] flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#F1F5F2]">Verifikasi Sedang Ditinjau (Pending)</h2>
              <p className="text-xs text-[#A1ADA5] mt-0.5">{t('kyc_pending_notice')}</p>
              <div className="mt-2 text-[11px] font-mono text-[#EAB866]">
                Sumsub Ref: {app?.vendor_reference}
              </div>
            </div>
          </div>

          {/* Sumsub Webhook Simulator Interactive Box */}
          <div className="p-4 rounded-lg bg-[#101A15] border border-[#26372D] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F1F5F2]">
                <Zap className="w-4 h-4 text-[#10B981]" />
                {t('kyc_sumsub_simulator')}
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#064E3B]/40 text-[#34D399] border border-[#10B981]/30">
                Sandbox Mode
              </span>
            </div>
            <p className="text-[11px] text-[#A1ADA5]">
              Sebagai penguji, Anda dapat langsung mensimulasikan respons webhook otomatis dari penyedia KYC (Sumsub) untuk menguji persetujuan atau penolakan seketika:
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleSimulateSumsub('GREEN')}
                className="flex-1 py-2 px-3 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Simulasikan Approve (GREEN)
              </button>
              <button
                onClick={() => handleSimulateSumsub('RED')}
                className="flex-1 py-2 px-3 rounded-lg bg-[#EF6464]/15 hover:bg-[#EF6464]/25 text-[#EF6464] border border-[#EF6464]/40 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Simulasikan Reject (RED)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submission Form (Only shown if unverified or rejected) */}
      {(!app || isRejected) && (
        <form onSubmit={handleSubmit} className="bg-[#142019] p-5 sm:p-6 rounded-lg border border-[#26372D] space-y-5">
          {isRejected && (
            <div className="p-3 rounded-lg bg-[#EF6464]/10 border border-[#EF6464]/40 text-[#EF6464] text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Verifikasi sebelumnya ditolak: {app?.reject_reason || 'Dokumen tidak jelas'}. Silakan ajukan ulang.</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1ADA5] mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#10B981]" />
                {t('kyc_full_name')}
              </label>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Contoh: Budi Santoso"
                className="w-full glass-input rounded-lg px-3 py-2 text-xs text-[#F1F5F2] placeholder-[#647168] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1ADA5] mb-1.5 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-[#10B981]" />
                {t('kyc_nik')}
              </label>
              <input
                type="text"
                required
                value={form.idNumber}
                onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
                placeholder="16-digit nomor NIK KTP"
                className="w-full glass-input rounded-lg px-3 py-2 text-xs text-[#F1F5F2] placeholder-[#647168] outline-none font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1ADA5] mb-1.5 flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-[#10B981]" />
                {t('kyc_ktp_photo')}
              </label>
              <div className="p-3 rounded-lg border border-[#26372D] bg-[#101A15] flex items-center gap-3">
                <img src={form.idCardUrl} alt="KTP Preview" className="w-16 h-10 object-cover rounded border border-[#26372D]" />
                <span className="text-[11px] text-[#A1ADA5] truncate flex-1">Foto KTP siap diverifikasi</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1ADA5] mb-1.5 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-[#10B981]" />
                {t('kyc_selfie_photo')}
              </label>
              <div className="p-3 rounded-lg border border-[#26372D] bg-[#101A15] flex items-center gap-3">
                <img src={form.selfieUrl} alt="Selfie Preview" className="w-10 h-10 object-cover rounded-full border border-[#26372D]" />
                <span className="text-[11px] text-[#A1ADA5] truncate flex-1">Foto Selfie wajah siap diverifikasi</span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {t('kyc_submit')}
          </button>
        </form>
      )}
    </div>
  );
};
