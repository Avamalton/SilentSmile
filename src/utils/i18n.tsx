import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'id' | 'en';

const translations: Record<Language, Record<string, string>> = {
  id: {
    // Brand
    brand_name: 'SilentSmile Exchange',
    brand_tagline: 'Platform Perdagangan Aset Kripto Terpercaya Indonesia',
    
    // Nav
    nav_home: 'Beranda',
    nav_trade: 'Trading',
    nav_markets: 'Pasar',
    nav_wallet: 'Dompet & Saldo',
    nav_orders: 'Pesanan',
    nav_history: 'Riwayat',
    nav_kyc: 'Verifikasi KYC',
    nav_security: 'Keamanan',
    nav_api: 'API Key',
    nav_admin: 'Admin Panel',
    nav_login: 'Masuk',
    nav_register: 'Daftar',
    nav_logout: 'Keluar',

    // Common
    loading: 'Memuat...',
    save: 'Simpan',
    cancel: 'Batal',
    confirm: 'Konfirmasi',
    status: 'Status',
    action: 'Aksi',
    date: 'Tanggal',
    amount: 'Jumlah',
    price: 'Harga',
    total: 'Total',
    balance: 'Saldo',
    available: 'Tersedia',
    locked: 'Terkunci',
    success: 'Berhasil',
    error: 'Terjadi Kesalahan',
    copied: 'Tersalin ke clipboard!',

    // Trading Terminal
    trade_buy: 'Beli',
    trade_sell: 'Jual',
    order_type_limit: 'Limit',
    order_type_market: 'Pasar (Instant)',
    order_book: 'Buku Pesanan (Order Book)',
    recent_trades: 'Transaksi Terkini',
    chart: 'Grafik Interaktif',
    open_orders: 'Pesanan Terbuka',
    order_history: 'Riwayat Pesanan',
    no_open_orders: 'Tidak ada pesanan aktif',
    no_trades: 'Belum ada transaksi',
    order_placed: 'Pesanan berhasil ditempatkan',
    order_cancelled: 'Pesanan berhasil dibatalkan',
    price_idr: 'Harga (IDR)',
    amount_base: 'Jumlah',
    maker_fee: 'Biaya Maker',
    taker_fee: 'Biaya Taker',
    est_total: 'Perkiraan Total',

    // Wallet
    wallet_title: 'Dompet & Saldo Portofolio',
    wallet_desc: 'Semua saldo dikelola melalui ledger ganda (double-entry) immutable tanpa floating point.',
    deposit: 'Setor Dana (Deposit)',
    withdraw: 'Tarik Dana (Withdraw)',
    deposit_idr_va: 'Setor Rupiah via Virtual Account',
    deposit_crypto: 'Setor Aset Kripto',
    va_instruction: 'Transfer ke nomor Virtual Account berikut dari m-Banking atau ATM:',
    simulate_payment: 'Simulasikan Pembayaran VA',
    simulate_chain_deposit: 'Simulasikan Deposit Blockchain (6 Blok)',
    withdraw_request: 'Permintaan Penarikan Dana',
    destination_address: 'Alamat Tujuan / Rekening Bank',
    bank_name: 'Nama Bank',
    account_holder_name: 'Nama Pemilik Rekening (Wajib Sama dengan KYC)',
    daily_limit_remaining: 'Sisa Limit Penarikan Harian',
    withdrawal_fee: 'Biaya Penarikan',
    net_payout: 'Total Diterima',
    submit_withdraw: 'Kirim Permintaan Penarikan',

    // KYC
    kyc_title: 'Verifikasi Identitas (KYC)',
    kyc_desc: 'Sesuai regulasi Bappebti & OJK, verifikasi identitas diperlukan untuk membuka batas penarikan dana.',
    kyc_level_0: 'Level 0 (Belum Terverifikasi)',
    kyc_level_1: 'Level 1 (Terverifikasi KTP & Selfie)',
    kyc_full_name: 'Nama Lengkap (Sesuai KTP)',
    kyc_nik: 'Nomor Induk Kependudukan (NIK)',
    kyc_ktp_photo: 'Foto KTP / Paspor',
    kyc_selfie_photo: 'Foto Selfie dengan KTP',
    kyc_submit: 'Kirim Verifikasi KYC',
    kyc_pending_notice: 'Dokumen Anda sedang ditinjau oleh tim kepatuhan atau adaptor Sumsub.',
    kyc_approved_notice: 'Selamat! Akun Anda telah terverifikasi Level 1.',
    kyc_sumsub_simulator: 'Simulator Webhook Sumsub (Sandbox)',

    // Security
    security_title: 'Pengaturan Keamanan Akun',
    totp_2fa_title: 'Autentikasi Dua Langkah (2FA TOTP)',
    totp_2fa_desc: 'Gunakan Google Authenticator atau Authy untuk mengamankan akun dari pembobolan.',
    totp_enable: 'Aktifkan 2FA',
    totp_disable: 'Nonaktifkan 2FA',
    totp_scan_qr: 'Pindai kode QR atau salin kunci rahasia berikut:',
    totp_enter_code: 'Masukkan 6-digit kode OTP:',
    active_sessions: 'Daftar Sesi & Perangkat Aktif',
    revoke_session: 'Cabut Akses Sesi Ini',
    revoke_all_sessions: 'Cabut Semua Sesi Lain',
    brute_force_info: 'Proteksi Anti-Brute-Force aktif: 5 kali gagal login akan mengunci akun selama 15 menit.',

    // API Key
    api_title: 'Manajemen Public API Key',
    api_desc: 'Akses pasar dan buat pesanan melalui API terprogram dengan autentikasi HMAC SHA-256.',
    api_create: 'Buat API Key Baru',
    api_key_id: 'Key ID',
    api_secret: 'API Secret',
    api_secret_warning: 'PENTING: Salin dan simpan secret ini sekarang. Secret tidak akan pernah ditampilkan lagi demi keamanan!',
    api_permissions: 'Izin Akses (Permissions)',
    api_whitelist: 'IP Whitelist (Opsional, pisahkan dengan koma)',
    api_rate_limit: 'Batas Permintaan (RPM)',
    api_revoke: 'Nonaktifkan Kunci',

    // Admin & Compliance
    admin_title: 'Panel Kontrol Admin & Kepatuhan',
    admin_users: 'Manajemen Pengguna',
    admin_kyc_review: 'Peninjauan KYC',
    admin_withdrawals: 'Antrean Persetujuan Penarikan',
    admin_pairs: 'Kontrol Pasar & Biaya',
    admin_compliance: 'Pemantauan Risiko & Audit AML',
    freeze_user: 'Bekukan Akun',
    unfreeze_user: 'Buka Pembekuan',
    approve: 'Setujui',
    reject: 'Tolak',
    halt_trading: 'Hentikan Trading (Halt)',
    resume_trading: 'Buka Trading (Resume)',
    export_report: 'Ekspor Laporan Regulasi (CSV)',
    ledger_integrity: 'Audit Integritas Buku Besar (Ledger)',
  },

  en: {
    // Brand
    brand_name: 'SilentSmile Exchange',
    brand_tagline: 'Indonesia’s High-Performance Digital Asset Spot Exchange',

    // Nav
    nav_home: 'Home',
    nav_trade: 'Trade',
    nav_markets: 'Markets',
    nav_wallet: 'Wallet & Balances',
    nav_orders: 'Orders',
    nav_history: 'History',
    nav_kyc: 'KYC Verification',
    nav_security: 'Security',
    nav_api: 'API Keys',
    nav_admin: 'Admin Panel',
    nav_login: 'Login',
    nav_register: 'Register',
    nav_logout: 'Logout',

    // Common
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    status: 'Status',
    action: 'Action',
    date: 'Date',
    amount: 'Amount',
    price: 'Price',
    total: 'Total',
    balance: 'Balance',
    available: 'Available',
    locked: 'Locked',
    success: 'Success',
    error: 'An Error Occurred',
    copied: 'Copied to clipboard!',

    // Trading Terminal
    trade_buy: 'Buy',
    trade_sell: 'Sell',
    order_type_limit: 'Limit',
    order_type_market: 'Market (Instant)',
    order_book: 'Order Book',
    recent_trades: 'Recent Trades',
    chart: 'Interactive Chart',
    open_orders: 'Open Orders',
    order_history: 'Order History',
    no_open_orders: 'No open orders',
    no_trades: 'No trades yet',
    order_placed: 'Order placed successfully',
    order_cancelled: 'Order successfully cancelled',
    price_idr: 'Price (IDR)',
    amount_base: 'Amount',
    maker_fee: 'Maker Fee',
    taker_fee: 'Taker Fee',
    est_total: 'Estimated Total',

    // Wallet
    wallet_title: 'Portfolio & Balance Ledger',
    wallet_desc: 'All balances are managed via an immutable double-entry ledger without floating point math.',
    deposit: 'Deposit Funds',
    withdraw: 'Withdraw Funds',
    deposit_idr_va: 'Deposit IDR via Virtual Account',
    deposit_crypto: 'Deposit Cryptocurrency',
    va_instruction: 'Transfer to the following Virtual Account number via online banking or ATM:',
    simulate_payment: 'Simulate VA Payment Webhook',
    simulate_chain_deposit: 'Simulate Blockchain Deposit (6 Blocks)',
    withdraw_request: 'Withdrawal Request',
    destination_address: 'Destination Address / Bank Account',
    bank_name: 'Bank Name',
    account_holder_name: 'Account Holder Name (Must match KYC name)',
    daily_limit_remaining: 'Remaining Daily Withdrawal Limit',
    withdrawal_fee: 'Withdrawal Fee',
    net_payout: 'Net Payout',
    submit_withdraw: 'Submit Withdrawal Request',

    // KYC
    kyc_title: 'Identity Verification (KYC)',
    kyc_desc: 'In compliance with Bappebti & regulatory guidelines, identity verification is required to unlock withdrawal limits.',
    kyc_level_0: 'Level 0 (Unverified)',
    kyc_level_1: 'Level 1 (ID & Biometrics Verified)',
    kyc_full_name: 'Full Name (As on Government ID)',
    kyc_nik: 'National ID Number (NIK)',
    kyc_ktp_photo: 'ID Card / Passport Photo',
    kyc_selfie_photo: 'Selfie with ID Card',
    kyc_submit: 'Submit KYC Application',
    kyc_pending_notice: 'Your documents are being reviewed by compliance or the Sumsub verification adapter.',
    kyc_approved_notice: 'Congratulations! Your account is verified at Level 1.',
    kyc_sumsub_simulator: 'Sumsub Webhook Simulator (Sandbox)',

    // Security
    security_title: 'Account Security Settings',
    totp_2fa_title: 'Two-Factor Authentication (2FA TOTP)',
    totp_2fa_desc: 'Protect your account using Google Authenticator or Authy to prevent unauthorized access.',
    totp_enable: 'Enable 2FA',
    totp_disable: 'Disable 2FA',
    totp_scan_qr: 'Scan this QR code or copy the secret key below:',
    totp_enter_code: 'Enter 6-digit OTP code:',
    active_sessions: 'Active Sessions & Device Registry',
    revoke_session: 'Revoke This Session',
    revoke_all_sessions: 'Revoke All Other Sessions',
    brute_force_info: 'Anti-Brute-Force protection active: 5 consecutive failed logins will lock the account for 15 minutes.',

    // API Key
    api_title: 'Public API Key Management',
    api_desc: 'Access market data and trade programmatically via HMAC SHA-256 signed requests.',
    api_create: 'Generate New API Key',
    api_key_id: 'Key ID',
    api_secret: 'API Secret',
    api_secret_warning: 'IMPORTANT: Save this secret key now. For your security, it will never be displayed again!',
    api_permissions: 'Permissions',
    api_whitelist: 'IP Whitelist (Optional, comma-separated)',
    api_rate_limit: 'Rate Limit (RPM)',
    api_revoke: 'Revoke Key',

    // Admin & Compliance
    admin_title: 'Admin Control Panel & Compliance',
    admin_users: 'User Management',
    admin_kyc_review: 'KYC Reviews',
    admin_withdrawals: 'Withdrawal Approvals',
    admin_pairs: 'Pair Management & Fees',
    admin_compliance: 'Risk Monitoring & AML Audits',
    freeze_user: 'Freeze Account',
    unfreeze_user: 'Unfreeze Account',
    approve: 'Approve',
    reject: 'Reject',
    halt_trading: 'Halt Trading',
    resume_trading: 'Resume Trading',
    export_report: 'Export Regulatory Report (CSV)',
    ledger_integrity: 'Ledger Double-Entry Audit',
  },
};

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  language: 'id',
  setLanguage: () => {},
  t: (key: string) => key,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('silentsmile_lang');
    return saved === 'en' || saved === 'id' ? saved : 'id';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('silentsmile_lang', lang);
  };

  const t = (key: string): string => {
    return translations[language][key] || translations['en'][key] || key;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useTranslation = () => useContext(I18nContext);
