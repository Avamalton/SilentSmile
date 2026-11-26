# SILENTSMILE EXCHANGE

## Revised Master Prompt --- Initial Listing Lifecycle, MM Preparation & Market Launch

> **Tujuan dokumen:** Instruksi implementasi untuk AI coding agent yang
> bekerja pada repository SilentSmile Exchange yang sudah ada. Dokumen
> ini mempertahankan kebutuhan produk asli pada bagian **Lampiran A**,
> tetapi menambahkan aturan implementasi, invariant, urutan kerja,
> kriteria kelulusan, dan definisi kegagalan yang wajib dipatuhi.
>
> **Aturan prioritas:** Bagian revisi ini menambahkan batasan dan
> memperjelas implementasi. Jika ada konflik antara implementasi yang
> sudah ada dan asumsi baru, audit repository terlebih dahulu. Jangan
> menghapus perilaku yang ada atau mengarang arsitektur. Jika kebutuhan
> bisnis pada Lampiran A bertentangan dengan keamanan, integritas
> ledger, atau konsistensi data, jangan diam-diam memilih salah satu:
> dokumentasikan konflik, pilih perilaku fail-closed yang paling aman,
> lalu jelaskan keputusan tersebut dalam laporan.

------------------------------------------------------------------------

# BAGIAN I --- INSTRUKSI UTAMA UNTUK AGENT

## 1. Peran dan hasil yang diharapkan

Bertindak sebagai arsitek CEX, backend engineer, trading-engine
engineer, database engineer, security engineer, QA engineer, dan
frontend engineer senior.

Implementasikan sistem listing awal pada **repository yang ada**. Jangan
membuat ulang aplikasi, mengganti stack, atau membuat mockup terpisah.
Gunakan komponen, model, service, autentikasi, storage, wallet, ledger,
matching engine, dan design system yang benar-benar ditemukan di
repository.

Semua aset, saldo, deposit, withdrawal, dan trade tetap **simulasi**.
Jangan menghubungkan dana pelanggan, blockchain, atau withdrawal
sungguhan.

**Jangan menyatakan pekerjaan selesai hanya karena kode sudah ditulis
atau UI terlihat benar.** Pekerjaan hanya boleh dinyatakan selesai jika
acceptance criteria yang relevan sudah diuji, hasil tes/build
benar-benar dijalankan, dan keterbatasan dilaporkan secara jujur.

## 2. Aturan anti-ambiguitas yang tidak boleh dilanggar

1.  **Audit sebelum mengubah kode.** Buktikan lokasi model, service,
    API, database, scheduler, wallet, ledger, order book, MM bot, UI,
    dan tes berdasarkan file yang benar-benar ada.
2.  **Tidak boleh mengarang.** Jangan mengasumsikan framework, tabel,
    route, library, job queue, atau service yang tidak ditemukan.
3.  **Gunakan satu sumber kebenaran.** Jangan menambahkan status
    listing, saldo, order, atau market kedua yang bertentangan dengan
    model yang sudah ada.
4.  **Semua aturan penting ditegakkan di server/service tepercaya.** UI
    hanya mencerminkan status otoritatif. Menyembunyikan tombol bukan
    kontrol keamanan.
5.  **Fail closed.** Jika status, permission, jadwal, ledger,
    reservation, atau readiness tidak dapat diverifikasi, tolak operasi
    sensitif dan berikan error yang dapat ditindaklanjuti.
6.  **Jangan mengubah perilaku finansial secara diam-diam.** Semua
    perubahan pada saldo, reservation, order, trade, atau ledger harus
    melalui mekanisme domain yang benar dan tercatat.
7.  **Idempotensi wajib.** Retry, timeout, refresh, restart, dan
    pemanggilan berulang tidak boleh menggandakan alokasi, jurnal,
    order, launch, atau event.
8.  **Jangan menyamakan waktu countdown dengan izin operasi.** Countdown
    hanya presentasi; semua operasi memeriksa state dan waktu
    otoritatif.
9.  **Jangan menghapus tes atau melemahkan validasi agar build lolos.**
    Perbaiki penyebab kegagalan dan laporkan tes yang tidak dapat
    dijalankan.
10. **Jangan mengklaim atomicity yang tidak didukung arsitektur.** Jika
    database dan matching engine tidak berada dalam satu transaksi,
    desain protokol konsistensi, idempotensi, dan rekonsiliasi yang
    eksplisit.
11. **Jangan menambah infrastruktur berlebihan.** Gunakan pola yang
    cocok dengan stack aktual. Jangan memasukkan distributed queue,
    service baru, atau dependensi besar tanpa kebutuhan dan alasan
    terukur.
12. **Jangan menandai placeholder sebagai implementasi selesai.**
    Tombol, field, pengaturan, dan status harus berfungsi end-to-end
    atau ditandai secara eksplisit sebagai belum diimplementasikan.

## 3. Cara menangani ambiguitas dan konflik

Untuk setiap keputusan yang belum ditentukan oleh kebutuhan atau
repository:

-   Cari pola yang sudah ada dan konsisten di proyek.
-   Jika pola yang ada aman dan memenuhi kebutuhan, gunakan pola
    tersebut.
-   Jika ada beberapa pilihan yang valid, pilih perubahan terkecil yang
    aman dan dokumentasikan alasan serta konsekuensinya.
-   Jika keputusan memengaruhi uang simulasi, akses, urutan eksekusi,
    atau integritas data dan tidak dapat dipastikan, **jangan menebak**.
    Pertahankan operasi dalam keadaan tertutup, tambahkan TODO/decision
    record yang spesifik, dan laporkan blocker.
-   Jangan menunggu konfirmasi untuk pekerjaan rutin yang dapat
    diputuskan dari bukti repository. Tetap lanjutkan bagian aman yang
    tidak bergantung pada blocker.
-   Jangan menyembunyikan konflik spesifikasi. Cantumkan lokasi, pilihan
    yang tersedia, keputusan sementara, dan dampaknya.

Setiap asumsi yang memengaruhi hasil harus ditulis dalam `docs/` atau
lokasi dokumentasi yang mengikuti konvensi repository. Jangan membuat
dokumentasi duplikat jika lokasi yang sesuai sudah tersedia.

------------------------------------------------------------------------

# BAGIAN II --- URUTAN IMPLEMENTASI WAJIB DAN GATES

Implementasi wajib dilakukan dalam tujuh tahap berurutan. Setiap tahap
harus menghasilkan bukti dan **lulus gate sebelum tahap berikutnya
dimulai**. Jika gate gagal, perbaiki tahap tersebut terlebih dahulu.
Jangan melanjutkan dengan menganggap kegagalan sebagai warning yang
boleh diabaikan.

## Tahap 1 --- Audit repository dan rencana berbasis bukti

### Tugas

-   Periksa struktur proyek, package scripts, stack, entry points,
    konfigurasi, migration, dan testing framework.
-   Telusuri market pair, listing/status, auth/RBAC, wallet/balance,
    ledger, order/reservation, CLOB/matching engine, MM bot, market
    data/candles, persistence, scheduler, Admin UI, public Spot UI, dan
    semua tes terkait.
-   Temukan seluruh jalur yang dapat mengubah saldo, membuat/membatalkan
    order, membuka trading, mengaktifkan deposit/withdrawal, atau
    mengubah listing.
-   Identifikasi apakah aplikasi browser-only, backend-backed, atau
    hybrid. Jangan menganggap localStorage sebagai database multi-user
    atau scheduler durable.
-   Catat kondisi awal: tes yang lulus/gagal, build, masalah yang sudah
    ada, dan keterbatasan lingkungan.
-   Buat peta dependensi serta rencana file yang akan diubah.

### Deliverables

1.  Ringkasan arsitektur aktual dengan path file.
2.  Peta aliran data untuk saldo, order, listing, dan scheduler.
3.  Daftar model/service yang dapat digunakan ulang.
4.  Daftar risiko dan konflik spesifikasi.
5.  Rencana implementasi berurutan dengan acceptance criteria.

### Gate 1 --- Wajib lulus

-   Tes baseline dan build dijalankan jika tersedia; hasil dicatat
    secara akurat.
-   Setiap klaim arsitektur didukung path file atau bukti kode.
-   Tidak ada perubahan fitur sebelum audit dan rencana tersedia.
-   Tidak ada keputusan stack atau schema yang hanya berdasarkan asumsi.

Jika test/build tidak dapat dijalankan karena environment, catat
perintah, output/error, dan alasan; jangan mengklaim lulus.

## Tahap 2 --- Domain model, lifecycle, dan state machine

### Tugas

-   Tetapkan satu model kanonis untuk listing, schedule, MM preparation,
    market access, public visibility, dan NEW badge, dengan reuse model
    yang sudah ada bila sesuai.
-   Buat state-transition matrix yang eksplisit.
-   Semua perubahan state harus melewati satu lifecycle/domain service,
    bukan tersebar dalam komponen UI, timer, dan handler API yang
    berbeda.
-   Gunakan validasi server-side dan optimistic concurrency/version
    check sesuai kemampuan stack.
-   Bedakan status proses listing dari status perdagangan, deposit,
    withdrawal, dan visibilitas publik.
-   Definisikan state yang terminal dan aturan apakah state dapat
    dipulihkan.

### State-transition matrix minimum

Untuk setiap transisi, dokumentasikan:

  -----------------------------------------------------------------------
  Field                               Ketentuan
  ----------------------------------- -----------------------------------
  State awal dan akhir                Harus eksplisit; wildcard transisi
                                      tidak diperbolehkan

  Pemicu                              Aktor atau event yang memulai
                                      transisi

  Permission                          Role dan scope yang diwajibkan

  Preconditions                       Jadwal, konfigurasi, inventory,
                                      engine health, dan readiness yang
                                      diperlukan

  Mutasi                              Data yang berubah dalam transaksi

  Side effects                        Event, job, order, reservation, dan
                                      notifikasi yang terkait

  Idempotency                         Cara mengenali pemrosesan yang sama

  Failure behavior                    Apakah rollback, retry, kompensasi,
                                      atau tetap tertutup

  Audit                               Actor/system identity, waktu,
                                      versi, alasan, correlation ID
  -----------------------------------------------------------------------

### Definisi yang harus diputuskan dan didokumentasikan

-   Arti `COMPLETED`: apakah proses listing selesai sementara market
    tetap `LIVE`, atau berarti market berhenti. Jangan memakai status
    yang ambigu.
-   Perbedaan `PAUSED`, `POSTPONED`, `CANCELLED`, dan `HALTED`.
-   Apakah `scheduled_listing_at` dan `trading_opens_at` adalah
    timestamp yang sama. Jika berbeda, definisikan maknanya dan
    urutannya.
-   Aturan pemulihan setelah pause/halt serta aturan reschedule sesudah
    jadwal terlewati.
-   Sumber waktu otoritatif dan cara membandingkan timestamp.
-   Transisi yang diizinkan bagi Admin, MM, Trader, dan scheduler.

### Gate 2 --- Wajib lulus

-   Unit test untuk seluruh transisi yang diizinkan dan ditolak.
-   Tes memastikan approval tidak membuka trading, deposit, atau
    withdrawal.
-   Tes memastikan listing tanpa jadwal tidak terlihat sebagai upcoming
    atau live.
-   Tes memastikan listing cancelled tidak dapat diluncurkan oleh job
    lama.
-   Tes memastikan versi state/schedule yang usang ditolak.
-   Tidak ada komponen UI yang dapat mengubah status sensitif dengan
    melewati domain service.

## Tahap 3 --- Ledger, balance, reservation, dan MM inventory

Tahap ini harus lulus sebelum membangun workflow MM yang bergantung pada
saldo.

### Invariant finansial wajib

1.  Semua mutasi finansial dicatat melalui ledger/domain service yang
    otoritatif.
2.  Jurnal double-entry harus seimbang per transaksi dan aset sesuai
    model akuntansi proyek. Jangan mengasumsikan debit/kredit lintas
    aset dapat saling mengimbangi.
3.  Jurnal yang sudah diposting tidak boleh diedit atau dihapus untuk
    mengubah sejarah. Koreksi dilakukan melalui reversal/adjustment yang
    tercatat.
4.  Setiap transaksi mempunyai ID unik dan idempotency key untuk
    mencegah posting ganda.
5.  Saldo tersedia tidak boleh negatif kecuali ada kebijakan eksplisit
    yang sudah ada dan disetujui untuk simulator.
6.  Reservation tidak boleh melebihi dana yang dapat direservasi.
7.  Dana yang sudah direservasi tidak boleh dihitung sebagai available
    inventory.
8.  Satu unit inventory tidak boleh dialokasikan dua kali untuk beberapa
    listing.
9.  Source debit, target credit, jurnal, dan referensi listing harus
    konsisten dalam satu transaksi database jika didukung.
10. Jika arsitektur tidak mendukung satu transaksi atomik, gunakan pola
    yang sudah sesuai dengan stack, status operasi yang eksplisit,
    idempotent retry, dan reconciliation. Jangan menyebutnya atomic jika
    tidak.
11. Gunakan integer unit terkecil atau tipe decimal yang sesuai untuk
    aset. Jangan gunakan floating-point biner untuk perhitungan uang.
12. Precision, tick size, quantity step, fee, minimum notional,
    rounding, dan fee asset harus konsisten dengan aturan order engine
    yang sudah ada.

### Tugas

-   Audit seluruh jalur mutasi balance dan reservation.
-   Implementasikan atau gunakan kembali transfer virtual treasury → MM
    dengan source account, target account, asset, amount, listing ID,
    actor, timestamp, idempotency key, dan ledger reference.
-   Pastikan inventory awal simulator berasal dari proses bootstrap/seed
    yang eksplisit dan tercatat sebagai demo inventory; tidak boleh
    diciptakan lewat perubahan UI.
-   Tetapkan formula minimum inventory dan kebutuhan bid/ask depth.
    Gunakan konfigurasi yang tersimpan dan divalidasi, bukan angka yang
    ditulis berbeda di berbagai komponen.
-   Tentukan kapan inventory di-reserve, dilepas, atau dipindahkan saat
    order dibuat, diubah, dibatalkan, dieksekusi, listing ditunda, atau
    listing dibatalkan.
-   Buat rekonsiliasi antara ledger, balance projection, dan open-order
    reservations.
-   Jangan otomatis mengembalikan dana yang mungkin sudah terpakai.
    Refund/release harus mengikuti state operasi yang dapat dibuktikan.

### Gate 3 --- Wajib lulus

-   Tes saldo cukup dan tidak cukup.
-   Tes duplicate request/idempotency.
-   Tes concurrent transfer dari saldo sumber yang sama.
-   Tes rollback saat salah satu langkah gagal.
-   Tes debit dan credit sesuai jurnal dan asset.
-   Tes balance/reservation reconciliation.
-   Tes order create/cancel/partial fill/full fill terhadap reservation.
-   Tes bahwa inventory yang sudah direservasi untuk listing A tidak
    dihitung lagi untuk listing B.
-   Tes presisi dan rounding tanpa floating-point drift yang tidak
    diperbolehkan.
-   Seluruh invariant finansial lulus sebelum Tahap 4 dimulai.

## Tahap 4 --- MM preparation dan pre-launch order book

### Tugas

-   Pisahkan window funding dan order setup.
-   Hanya MM yang ditugaskan untuk listing tersebut yang boleh melakukan
    operasi terkait.
-   Gunakan akun, inventory, ledger, order validation, dan reservation
    yang nyata di simulator.
-   Isolasi pre-launch MM order agar tidak dapat dieksekusi oleh public
    trader atau MM lain sebelum launch, kecuali ada auction mechanism
    yang memang sudah dirancang dan diuji.
-   Terapkan market/asset ownership checks pada setiap operasi, termasuk
    direct API calls.
-   Tentukan aturan cancel/amend, expiry, underfunding, dan kehilangan
    authorization saat preparation.
-   Jangan membuat order book liquidity palsu, trade palsu, candle
    palsu, atau volume palsu.

### Gate 4 --- Wajib lulus

-   MM tidak bisa funding sebelum window atau setup order sebelum
    waktunya.
-   Trader biasa tidak bisa place/cancel/execute pre-launch MM order.
-   MM yang tidak ditugaskan tidak bisa mengakses listing.
-   Invalid/underfunded order ditolak tanpa meninggalkan reservation
    bocor.
-   Cancel, amend, partial fill, dan expiry menjaga ledger serta
    reservation.
-   Order valid mempertahankan ID, timestamp/prioritas yang sesuai,
    remaining quantity, dan reservation ketika masuk ke live book.
-   Tes regresi matching engine yang lama tetap lulus.

## Tahap 5 --- Launch scheduler, readiness gate, dan recovery

### Tugas

-   Scheduler hanya memicu evaluasi; lifecycle service tetap menjadi
    otoritas untuk transisi.
-   Simpan schedule/version di persistence yang sesuai. Jangan
    mengandalkan React interval atau in-memory timeout sebagai
    satu-satunya mekanisme.
-   Pada startup/recovery, reconcile schedule tersimpan dan proses
    overdue transition secara idempotent.
-   Reschedule, postpone, cancel, pause, dan perubahan konfigurasi harus
    membuat job lama tidak berlaku melalui version/state checks.
-   Tentukan batas retry, backoff, timeout, dead-letter/failed state
    bila relevan dengan stack, serta prosedur operator.
-   Gunakan locking/concurrency control yang cocok dengan persistence
    aktual.
-   Simpan event penting secara durable. Jika event harus dikirim
    setelah commit dan stack membutuhkannya, gunakan transactional
    outbox atau pola ekuivalen yang sudah cocok dengan arsitektur.
-   Jangan menganggap satu transaksi database dapat atomik dengan
    matching engine eksternal.

### Launch protocol yang wajib didefinisikan

1.  Ambil lock atau mekanisme concurrency yang sesuai.
2.  Baca ulang listing, market, schedule version, dan status terkini.
3.  Pastikan waktu otoritatif sudah mencapai jadwal.
4.  Jalankan seluruh readiness checks.
5.  Validasi order MM dan reservation terhadap ledger.
6.  Siapkan perubahan order book dan state transition sesuai kemampuan
    engine.
7.  Commit state yang otoritatif dan simpan event durable.
8.  Publikasikan state setelah commit; event duplikat harus aman.
9.  Jika langkah lintas komponen gagal, market harus tetap tidak dapat
    diperdagangkan publik sampai reconciliation menyatakan konsisten.
10. Jalankan reconciliation untuk mendeteksi dan memperbaiki kondisi
    setengah selesai tanpa membuat order/trade/ledger ganda.

Jika langkah 6--8 tidak bisa dilakukan dalam satu transaksi,
dokumentasikan protocol, failure points, recovery, dan kompensasinya.
Jangan mengklaim distributed atomicity.

### Readiness minimum

-   Listing approved dan schedule valid.
-   Waktu launch tercapai.
-   Listing tidak cancelled/postponed/paused.
-   Market dan asset configuration valid.
-   Trading engine sehat.
-   MM inventory cukup sesuai policy.
-   Ledger dan order reservations reconcile.
-   Semua order eligible, benar market/owner/phase, dan tidak melanggar
    limit.
-   Risk controls aktif.
-   Tidak ada halt atau suspension yang melarang trading.
-   Semua optional policy yang dikonfigurasi sebagai mandatory telah
    lulus.

Jika gagal, jangan membuka trading. Simpan alasan, status delayed/paused
yang sesuai, diagnostics, dan action yang dapat dilakukan operator.
Override harus eksplisit, dibatasi permission, meminta alasan, diaudit,
dan tidak boleh menonaktifkan invariant finansial atau keamanan.

### Gate 5 --- Wajib lulus

-   Dua scheduler/worker memproses listing yang sama secara bersamaan.
-   Crash sebelum dan sesudah commit.
-   Timeout setelah commit dan retry.
-   Restart ketika ada jadwal overdue.
-   Reschedule/cancel ketika job lama sedang berjalan.
-   Readiness gagal pada setiap pemeriksaan penting.
-   Tidak ada launch ganda, event ganda yang menyebabkan efek ganda,
    order activation ganda, atau trade/candle palsu.
-   Public order entry tetap tertutup selama state belum konsisten.

## Tahap 6 --- Admin UI, public Spot UI, API, dan sinkronisasi

### Tugas

-   Integrasikan fitur ke design system dan komponen yang sudah ada.
-   UI membaca state otoritatif dan menampilkan status aktual, bukan
    status optimistis dari countdown.
-   Semua tombol dan pengaturan harus tersambung ke API/domain service
    dan menampilkan error nyata.
-   Terapkan loading, empty, stale-data, error, delayed launch, paused,
    cancelled, dan permission-denied states.
-   Countdown menggunakan waktu server/service yang tersedia, mengoreksi
    delay respons, berhenti di nol, lalu meminta state otoritatif
    terbaru.
-   Market hanya masuk Active Markets jika status otoritatif memang
    mengizinkan.
-   Deposit dan withdrawal mempunyai status, readiness, dan guard
    independen.
-   NEW badge hanya metadata presentasi dan tidak memengaruhi
    permission.
-   Chart/candlestick menggunakan executed trades yang sah saja.

### Keamanan UI/API

-   Validasi input di server/service; frontend validation hanya bantuan
    UX.
-   Cek role, account ownership, MM assignment, market scope, state, dan
    waktu pada setiap endpoint operasi sensitif.
-   Terapkan CSRF protection jika relevan dengan model auth, rate
    limiting untuk operasi sensitif, serta validasi payload sesuai
    stack.
-   Hindari membocorkan saldo atau data akun lain lewat response, error,
    log, atau query yang tidak terotorisasi.
-   Jangan menyimpan secret di frontend atau repository.
-   Jangan menganggap ID dari client membuktikan kepemilikan resource.

### Gate 6 --- Wajib lulus

-   End-to-end test dari create → review → schedule → MM funding → MM
    setup → launch → deposit/withdrawal opening.
-   Direct API tests membuktikan UI tidak bisa dilewati untuk melakukan
    operasi terlarang.
-   Refresh, route change, stale response, dan countdown zero tidak
    menampilkan state palsu.
-   Error dan readiness failure terlihat jelas dan tidak membuat status
    optimistis.
-   Semua pengaturan admin yang ditampilkan benar-benar berfungsi atau
    dilabeli belum diimplementasikan.

## Tahap 7 --- Pengujian integrasi, regresi, build, dan delivery

### Test suite minimum

-   Unit tests untuk domain transition, validation, calculation,
    precision, idempotency, dan permission.
-   Integration tests untuk database, ledger, reservation, order engine,
    scheduler, dan event handling.
-   End-to-end tests untuk workflow listing dari awal sampai fitur akses
    terpisah.
-   Concurrency/failure-injection tests untuk race, restart, timeout,
    duplicate request, dan partial failure.
-   Security tests untuk privilege escalation, object-level
    authorization, direct API bypass, dan akses MM lintas listing.
-   Regression tests untuk fitur exchange yang sudah ada.
-   Build/typecheck/lint/test sesuai scripts yang tersedia di
    repository.

### Gate 7 --- Wajib lulus sebelum menyatakan selesai

-   Semua acceptance test kritis lulus.
-   Build/typecheck lulus bila tersedia.
-   Tidak ada regresi yang diperkenalkan oleh perubahan ini.
-   Tidak ada error kritis yang disembunyikan atau diabaikan.
-   Migration dan rollback/forward-compatibility diperiksa sesuai stack.
-   Final diff diperiksa untuk file yang tidak relevan, secret, debug
    code, fake data, dan dependency yang tidak perlu.
-   Hasil tes harus berasal dari eksekusi nyata. Jangan menebak atau
    memalsukan output.

Jika suatu tes gagal, perbaiki dan ulangi. Jika tidak dapat dijalankan
karena keterbatasan environment, laporkan sebagai **NOT RUN**, bukan
PASS.

------------------------------------------------------------------------

# BAGIAN III --- INVARIANT GLOBAL DAN KONTRAK PENERIMAAN

Invariant berikut berlaku pada semua tahap dan mengalahkan kemudahan UI
atau scheduler:

1.  `APPROVED` bukan `LIVE`.
2.  Pair dibuat tidak otomatis dipublikasikan, diperdagangkan, atau
    membuka deposit/withdrawal.
3.  Upcoming listing tidak menerima public order.
4.  Countdown nol tidak mengotorisasi operasi.
5.  Status public trading, deposit, dan withdrawal independen.
6.  Pre-launch MM order tidak dapat dieksekusi publik.
7.  Tidak ada saldo, order book liquidity, trade, volume, atau candle
    yang difabrikasi.
8.  Semua mutasi finansial dapat ditelusuri ke transaksi dan jurnal yang
    konsisten.
9.  Duplicate request tidak menghasilkan efek finansial ganda.
10. State transition dan administrative override dapat diaudit.
11. Stale job tidak dapat mengubah listing dengan schedule version lama.
12. Market tidak dibuka publik jika readiness gagal atau state lintas
    komponen belum konsisten.
13. Reservation dan ledger harus reconcile setelah
    create/cancel/amend/fill/launch/failure.
14. NEW badge tidak mengubah trading permission.
15. Tidak ada API sensitif yang hanya dilindungi oleh frontend.
16. Jika keadaan tidak diketahui, operasi sensitif ditolak sampai
    reconciliation atau pemeriksaan otoritatif selesai.

## Kontrak audit dan observability

Gunakan pola yang sesuai dengan stack aktual untuk mencatat: -
event/operation ID dan correlation ID; - listing ID, market ID, schedule
version; - actor atau system identity; - state sebelum dan sesudah; -
waktu kejadian dan waktu pemrosesan; - hasil, reason code, serta error
yang aman untuk ditampilkan; - referensi transaksi ledger/order jika
relevan.

Jangan memasukkan password, token, secret, atau data sensitif yang tidak
diperlukan ke log. Audit trail harus dibatasi aksesnya dan tidak boleh
dapat dimanipulasi melalui UI biasa.

Tambahkan metrics/health indicators yang proporsional dengan arsitektur:
overdue schedules, failed readiness, launch retries, reconciliation
mismatch, ledger invariant failure, dan scheduler lag. Jika
observability tidak tersedia, dokumentasikan solusi minimum yang sesuai
dengan proyek.

## Kontrak error

Gunakan format error konsisten sesuai pola API yang ada. Minimal,
bedakan: - invalid input/configuration; - permission denied; - invalid
lifecycle transition; - schedule stale/version conflict; - insufficient
inventory/balance; - readiness failed; - operation already
processed/idempotent replay; - temporary dependency/engine failure; -
reconciliation required.

Error harus actionable tetapi tidak membocorkan data rahasia. Jangan
mengubah error menjadi sukses palsu agar UI terlihat mulus.

------------------------------------------------------------------------

# BAGIAN IV --- FORMAT LAPORAN SETIAP TAHAP

Setelah setiap tahap, tulis laporan singkat dengan format:

1.  **Status:** PASS / FAIL / BLOCKED.
2.  **Perubahan:** file dan komponen yang benar-benar diubah.
3.  **Bukti:** perintah tes/build yang dijalankan dan hasil aktual.
4.  **Acceptance criteria:** tiap kriteria PASS/FAIL/NOT RUN.
5.  **Risiko tersisa:** termasuk failure mode yang belum tertangani.
6.  **Keputusan/asumsi:** keputusan baru dan alasan berbasis repository.
7.  **Gate:** lanjut hanya jika semua kriteria wajib tahap tersebut
    PASS.

Jangan berhenti hanya dengan membuat rencana. Setelah Gate 1 lulus,
lanjutkan secara mandiri melalui tahap berikutnya. Jika gate gagal,
perbaiki tahap saat ini sebelum maju. Jika blocker eksternal membuat tes
tertentu mustahil dijalankan, lanjutkan hanya pekerjaan yang aman dan
tidak bergantung pada blocker tersebut, serta jangan menyatakan tahap
lulus penuh.

## Final delivery report wajib memuat

-   Ringkasan arsitektur yang ditemukan.
-   Root causes dan masalah lama yang relevan.
-   Diagram lifecycle dan state-transition matrix.
-   Daftar file yang berubah.
-   Perubahan schema/migration/persistence.
-   Invariant ledger dan strategi reconciliation.
-   Protokol launch dan recovery.
-   Matriks role/permission.
-   Daftar acceptance test dengan PASS/FAIL/NOT RUN.
-   Hasil aktual typecheck, lint, test, dan build.
-   Instruksi verifikasi manual.
-   Keterbatasan simulator/browser-only.
-   Risiko yang belum diselesaikan dan alasan.

------------------------------------------------------------------------

# BAGIAN V --- DEFINISI SELESAI

Fitur hanya boleh dinyatakan **IMPLEMENTED** jika: - semua kebutuhan
wajib pada Lampiran A yang relevan telah terintegrasi ke aplikasi
aktual; - semua tujuh gate lulus atau pengecualian eksplisit dilaporkan
tanpa mengklaim selesai penuh; - tidak ada jalur bypass untuk permission
atau lifecycle; - saldo, ledger, reservations, dan order book
konsisten; - scheduler aman terhadap retry, stale job, restart, dan
konkurensi sesuai kemampuan arsitektur; - build dan tes aktual
dilaporkan; - UI tidak menggunakan fake data untuk menyamarkan fungsi
yang belum ada.

Gunakan status laporan: - **IMPLEMENTED:** implementasi dan acceptance
tests yang relevan terbukti lulus. - **PARTIALLY IMPLEMENTED:** sebagian
alur tersedia, tetapi ada kriteria yang belum terpenuhi. - **NOT
IMPLEMENTED:** belum tersedia. - **NOT VERIFIED:** kode ada, tetapi
belum ada bukti pengujian yang cukup. - **BLOCKED:** tidak dapat
dilanjutkan karena dependency atau keputusan yang belum tersedia.

------------------------------------------------------------------------

# LAMPIRAN A --- KEBUTUHAN PRODUK ASLI

Bagian berikut mempertahankan spesifikasi kebutuhan produk awal sebagai
cakupan fungsional. Baca bersama Bagian I--V di atas; aturan audit,
tahap implementasi, invariant, gate, dan pembuktian pada bagian revisi
tetap wajib dipatuhi.

------------------------------------------------------------------------

SILENTSMILE EXCHANGE

COMPLETE INITIAL LISTING SCHEDULER, MARKET LAUNCH & MARKET MAKER
PREPARATION SYSTEM

1.  ROLE AND OBJECTIVE

Act as a Senior Centralized Exchange (CEX) Architect, Backend Engineer,
Trading Engine Engineer, Database Architect, and Frontend Developer.

You are working on an existing project named SilentSmile Exchange.

The application already has an exchange UI, market selector, simulated
spot trading, order book, candlestick chart, order engine, simulated
wallets, admin panel, and Market Maker Bot components.

Your assignment is to implement a complete, reliable, database-backed
Initial Listing Lifecycle System.

Do not rebuild the project from scratch.

First inspect the existing repository, identify the current
architecture, and reuse the existing components, types, storage,
authentication, trading engine, wallet, ledger, and UI wherever
possible.

The final result must provide a coherent workflow from creating a market
pair through scheduled listing, pre-launch MM preparation, public
trading launch, and delayed public deposit/withdrawal availability.

All assets, balances, deposits, withdrawals, and trades must remain
simulated. However, every virtual financial operation must be recorded
and reconciled. A virtual balance must be real within the simulator's
accounting model, not an arbitrary number displayed by the UI.

Do not connect to real customer funds or real blockchain withdrawals.

2.  NON-NEGOTIABLE BUSINESS RULES

Implement these rules throughout the system:

Creating a market pair does not automatically list it.

Approval does not automatically make a market publicly visible.

An approved market must have an explicit listing schedule before it can
become an upcoming listing.

An upcoming market must not accept public orders.

MM funding access and MM order-placement access must have separate
opening times.

MM preparation orders must use actual recorded virtual inventory and the
existing CLOB infrastructure.

Public users must not execute trades against pre-launch MM orders.

At the scheduled listing time, the system must verify operational
readiness before opening public trading.

Valid pre-launch MM orders must be preserved when the market launches.

The public Spot interface must display an upcoming listing and countdown
before launch.

A listing that is not live must never appear as an ordinary active
trading market.

The NEW badge must be separate from the market's trading status.

Public trading, deposit, and withdrawal must have independent status and
permission checks.

Reaching a countdown of zero must never be sufficient by itself to
authorize a financial operation.

Rescheduling, pausing, postponing, or cancelling a listing must
invalidate or reconcile obsolete scheduled actions.

Every administrative state change and virtual financial transfer must be
auditable.

No fake fills, fake order-book liquidity, fabricated balances, or
fictitious trade volume are allowed.

Every setting exposed in the admin UI must either work or be explicitly
marked as not implemented.

3.  START WITH A REPOSITORY AUDIT

Before writing code, inspect:

Project structure and package scripts.

Existing database schema and migrations.

Authentication and authorization.

Asset registry and market-pair configuration.

Existing AdminView and listing management.

Market selector and public Spot page.

Market detail and trading page.

Order-entry components.

Matching engine and order book.

Wallet and balance model.

Ledger or transaction history.

Market Maker Bot configuration and runtime.

Chart and market-data service.

Persistence and scheduling mechanisms.

Existing tests.

Search the entire repository for existing market creation, market
status, listing status, deposit status, withdrawal status, and bot
scheduling implementations.

Do not introduce duplicate state models if an existing equivalent
already exists.

Create an implementation plan based on the actual repository, then
proceed with the implementation without waiting for another
confirmation.

If the project is browser-only, preserve the current simulator
architecture while introducing clear service boundaries and persistent
local demo data. Do not claim that localStorage provides secure
multi-user or production-grade scheduling.

4.  DOMAIN MODEL AND STATUS SEPARATION

Do not use a single status field to control every aspect of a listing.

Represent the following concepts independently.

A. Listing lifecycle

Suggested states:

DRAFT

UNDER_REVIEW

APPROVED

SCHEDULED

PREPARING

LIVE

COMPLETED

PAUSED

POSTPONED

CANCELLED

PREPARING is an operational listing phase. It may contain MM funding and
order-book preparation subphases.

Do not use APPROVED as a synonym for LIVE.

B. MM preparation phase

Suggested states:

NOT_STARTED

FUNDING_OPEN

FUNDING_COMPLETE

ORDER_SETUP_OPEN

READY

FAILED

EXPIRED

C. Trading access

Suggested statuses:

CLOSED

PREPARATION_ONLY

OPEN

HALTED

D. Deposit access

Suggested statuses:

CLOSED

OPEN

SUSPENDED

E. Withdrawal access

Suggested statuses:

CLOSED

OPEN

SUSPENDED

F. Public market visibility

Suggested visibility states:

HIDDEN

UPCOMING

LIVE

HALTED

G. NEW badge

Store a separate new_badge_expires_at timestamp.

The NEW badge must not control trading permission.

These concepts must be represented in types and persisted state, and all
transitions must pass through a centralized lifecycle service.

5.  PHASE A --- CREATE MARKET PAIR

Extend the existing market creation workflow.

The administrator must be able to configure:

Base asset.

Quote asset.

Market symbol.

Market ID.

Price precision.

Quantity precision.

Tick size.

Quantity step size.

Minimum quantity.

Minimum order notional.

Maker fee.

Taker fee.

Market status.

Initial listing status.

Authorized Market Maker account or group.

Optional listing notes.

Example:

Base asset: ABC Quote asset: USDT Market: ABC/USDT

Validate:

Both assets exist.

Asset identifiers are valid.

The market pair is unique.

Base and quote assets are different.

Precision and step-size settings are valid.

Fees are within configured limits.

Minimum order constraints are consistent.

The selected MM account exists and is authorized.

Creating the pair must create a market configuration only.

It must not automatically:

Publish the pair as an active market.

Open trading.

Open deposits.

Open withdrawals.

Generate an order book with fake liquidity.

Start the MM bot.

Create executed trades or candles.

Default the new pair to DRAFT and hidden from public active markets.

6.  PHASE B --- REVIEW AND APPROVAL

Implement a controlled review workflow.

The admin may:

Submit for review.

Approve.

Reject.

Return to draft.

Add review notes.

Record:

Reviewer ID.

Review timestamp.

Previous status.

New status.

Reason.

Relevant configuration version.

Approval must only indicate that the market has passed the approval
process.

After approval:

Keep public trading disabled.

Keep deposits disabled.

Keep withdrawals disabled.

Do not show the pair as an active market.

Enable the Schedule Listing action.

The pair may only become visible in the upcoming-listings area after a
valid schedule has been saved and confirmed.

7.  PHASE C --- LISTING SCHEDULE PLANNER

Build a dedicated scheduling interface in the admin panel.

The schedule must be configurable per market.

Required schedule fields

listing_id

market_id

timezone

scheduled_listing_at

mm_funding_opens_at

mm_setup_opens_at

trading_opens_at

new_badge_expires_at

public_deposit_opens_at

public_withdrawal_opens_at

schedule_version

created_by

created_at

updated_at

reschedule_reason

Store canonical timestamps in UTC and preserve the selected timezone for
display.

Default the UI timezone to Asia/Jakarta, while allowing the
administrator to select another supported timezone.

Configurable offsets

Allow the administrator to configure:

MM funding lead time.

MM order-setup lead time.

NEW badge duration.

Public deposit delay after launch.

Public withdrawal delay after launch.

Example defaults:

MM funding opens 30 minutes before listing.

MM order setup opens 15 minutes before listing.

Trading opens at the scheduled listing time.

Public deposits open 10 minutes after launch.

Public withdrawals open 10 minutes after launch.

NEW badge remains visible for 24 hours.

These are configurable defaults, not hardcoded business rules.

Timeline preview

Before confirming a schedule, display:

Listing date and time.

Local timezone.

Corresponding UTC timestamp.

MM funding opening.

MM setup opening.

Public trading opening.

Deposit opening.

Withdrawal opening.

NEW badge expiry.

Time remaining until each stage.

Validate that the timeline is internally consistent.

The MM setup window must open after MM funding begins and before public
trading opens.

The listing schedule must be in the future when initially confirmed.

If the listing is rescheduled, recalculate dependent timestamps and show
a confirmation preview before saving.

Do not allow schedule changes to silently leave obsolete timers or jobs
active.

8.  PHASE D --- UPCOMING LISTINGS AND COUNTDOWN

Update the public Spot market interface.

Visibility rules

DRAFT:

Hidden from public markets.

UNDER_REVIEW:

Hidden from public markets.

APPROVED without a schedule:

Hidden from public markets.

SCHEDULED:

Visible only in the upcoming-listings area.

PREPARING:

Visible as an upcoming listing with the current preparation phase.

LIVE:

Visible as an active trading market.

HALTED:

Visible only according to the existing market-halt policy, with trading
disabled.

CANCELLED or POSTPONED:

Must not appear as a live market.

Show a clear status in the upcoming-listings area only when appropriate.

Upcoming listing card

Display:

Base and quote asset symbols.

Asset names and existing icon assets.

Listing date and time.

Timezone.

Countdown timer.

Listing phase.

Trading status.

Deposit status.

Withdrawal status.

Use labels such as:

UPCOMING

MM FUNDING

MM ORDER SETUP

INITIAL LISTING

NEW

TRADING LIVE

DEPOSIT CLOSED

WITHDRAWAL CLOSED

POSTPONED

PAUSED

Do not introduce unrelated redesigns. Preserve the existing SilentSmile
design system.

Countdown behavior

The countdown must:

Use an authoritative server or simulator-service timestamp.

Update every second for presentation.

Survive browser refresh.

Survive route changes.

Use the correct market's schedule.

Handle delayed API responses.

Stop at zero.

Refresh the authoritative listing state when it reaches zero.

Show a postponed or delayed state if the listing has not actually
opened.

The browser countdown is only a display.

It must never independently enable order placement, deposit, or
withdrawal.

If the scheduler is late, the UI must display the actual lifecycle state
rather than claiming that the market is live.

9.  PHASE E --- MM FUNDING WINDOW

At mm_funding_opens_at, enable funding operations only for authorized MM
accounts assigned to the listing.

Before that time, funding for this listing must be rejected unless an
explicitly authorized administrative operation is used.

The MM dashboard must show:

Listing and market pair.

Funding-window opening and deadline.

Time remaining.

Base-asset available balance.

Quote-asset available balance.

Locked balances.

Required base inventory.

Required quote inventory.

Inventory readiness.

Funding history.

Allocation transaction IDs.

Failed funding attempts and reasons.

Simulated treasury

Use a dedicated simulator treasury or another explicitly defined source
account.

All virtual allocation operations must be recorded.

For an allocation:

Verify the source account has sufficient available balance.

Verify the target MM account is authorized.

Verify the asset and listing are valid.

Debit the source account.

Credit the target account.

Record balanced ledger entries.

Record the actor, amount, asset, timestamp, and listing ID.

Commit the operation atomically.

Reject duplicate requests using an idempotency key.

Do not simply assign a balance in React state.

Do not create inventory by increasing a user's balance without an
accounting entry.

Any initial simulated treasury inventory must be explicitly initialized
and recorded as demo inventory.

If the treasury has insufficient inventory, show an actionable error and
keep readiness false.

MM inventory requirements

For ABC/USDT:

Base inventory supports ABC sell orders.

Quote inventory supports ABC buy orders.

Calculate inventory readiness from actual available and reserved
balances.

Do not count locked funds as freely available.

Do not count the same inventory twice across multiple scheduled
listings.

If inventory is shared across listings, reserve or allocate it
explicitly.

10. PHASE F --- MM PRE-LAUNCH ORDER-BOOK SETUP

At mm_setup_opens_at, enable pre-launch limit orders for authorized MM
accounts.

Before the setup window:

MM funding may be permitted according to its own window.

MM order placement remains disabled.

During the setup window:

MM may place limit buy orders.

MM may place limit sell orders.

MM may cancel or amend eligible MM orders.

Orders must use the existing CLOB validation and reservation rules.

Required balances must be locked.

Each order must have a real simulated order ID.

Remaining quantities must be tracked.

All operations must be recorded.

Ordinary users must not be able to:

Place orders.

Execute against the pre-launch book.

Cancel MM orders.

Access MM funding operations.

Pre-launch matching isolation

MM orders must not execute against one another during the preparation
phase unless a separately designed auction mechanism explicitly permits
it.

For the initial implementation, use an isolated pre-launch order
collection or a matching-engine phase guard.

At launch:

Verify every eligible MM order.

Verify the order's market and ownership.

Verify remaining quantity.

Verify corresponding reserved balance.

Preserve order IDs and timestamps.

Transfer valid orders into the live order book atomically.

Keep the appropriate price-time priority.

Enable public order placement only after the live-market transition
commits.

Do not discard valid prepared orders and generate replacements.

Do not fabricate trade executions when activating the prepared order
book.

If the existing engine cannot safely support this, implement the
smallest compatible change and add regression tests.

11. PHASE G --- LAUNCH READINESS GATE

Before public trading opens, evaluate an explicit readiness checklist.

Required checks:

Listing has been approved.

A valid schedule exists.

The scheduled trading time has arrived.

The listing has not been cancelled or postponed.

The market configuration is valid.

Base and quote assets are active.

The trading engine is healthy.

The MM funding phase has completed or an authorized waiver exists.

Required MM inventory is available.

All required order reservations reconcile with the ledger.

MM orders belong to the correct market and authorized account.

The order book contains only valid orders.

The market is not halted.

Required risk controls are active.

Optional policy checks:

Minimum bid depth.

Minimum ask depth.

Maximum initial spread.

Maximum inventory concentration.

Maximum permitted quote exposure.

Allow admins to configure which optional checks are mandatory.

Failed readiness

If any required check fails:

Do not open public trading.

Do not enable public order entry.

Preserve valid MM preparation orders.

Set the listing to a clear delayed or paused state.

Record failed checks and diagnostic information.

Show the reasons in the admin interface.

Permit an authorized operator to retry, postpone, or cancel the launch.

Do not bypass readiness checks simply because the countdown reaches
zero.

12. PHASE H --- PUBLIC TRADING LAUNCH

At trading_opens_at, if all readiness checks pass:

Acquire the appropriate lifecycle lock.

Revalidate the current listing version and status.

Revalidate the market and MM orders.

Activate eligible MM orders in the live book.

Atomically update the market to LIVE.

Set trading_status = OPEN.

Set public visibility to LIVE.

Enable eligible public order placement.

Publish the new authoritative market state.

Record the actual launch timestamp.

Record the launch event in the audit log.

Display the NEW badge until its configured expiry.

Prevent duplicate launch processing if the scheduler runs twice.

Do not create fake trades or synthetic chart candles at launch.

The opening price must follow the existing exchange pricing and matching
policy. If an opening auction is introduced, document its rules
separately rather than silently inventing an opening price.

NEW badge behavior

The NEW badge is presentation metadata.

It must:

Appear when the market becomes live.

Expire at new_badge_expires_at.

Remain independent of trading permissions.

Remain independent of deposit and withdrawal status.

Survive page refresh.

Not be reset on every frontend render.

13. PHASE I --- DEPOSIT AND WITHDRAWAL OPENING

Deposit and withdrawal must have separate schedules and status fields.

At the configured opening time, evaluate the relevant operational
readiness checks.

Do not automatically enable either feature merely because the market is
trading.

Simulated deposit readiness

Validate:

Deposit feature is scheduled to open.

Listing is live, unless an explicitly defined policy says otherwise.

Asset and network configuration are valid in the simulator.

The virtual deposit mechanism is operational.

The funding source and ledger operation are defined.

No deposit suspension or risk hold is active.

Simulated withdrawal readiness

Validate:

Withdrawal feature is scheduled to open.

Listing and asset are eligible.

The virtual withdrawal mechanism is operational.

Available balance and reservation rules are correct.

No suspension or risk hold is active.

If checks pass, change the corresponding status to OPEN.

If checks fail, keep the feature CLOSED or SUSPENDED as appropriate and
record the reason.

Deposits and withdrawals may open at different times.

Admin must be able to suspend either feature independently after launch.

User-facing states

Before opening:

Show DEPOSIT CLOSED or WITHDRAWAL CLOSED.

Explain the scheduled opening time where appropriate.

Display a countdown when there is a valid future schedule.

Disable the action in the UI.

Reject direct API calls through the authoritative guard.

After opening:

Enable the relevant action only for eligible accounts.

Continue to enforce balance, permission, and risk validation.

All virtual deposits and withdrawals must create auditable ledger
entries. Do not treat a frontend balance update as a completed financial
operation.

14. DATABASE AND PERSISTENCE

Inspect the existing persistence architecture first.

Reuse existing entities where possible.

Introduce or extend models for:

Listing

id

market_id

status

approved_by

approved_at

scheduled_at

actual_launch_at

new_badge_expires_at

created_at

updated_at

version

ListingSchedule

id

listing_id

timezone

mm_funding_opens_at

mm_setup_opens_at

trading_opens_at

deposit_opens_at

withdrawal_opens_at

minimum_mm_base_inventory

minimum_mm_quote_inventory

minimum_bid_depth

minimum_ask_depth

maximum_initial_spread_pct

schedule_version

created_by

created_at

MarketAccess

market_id

trading_status

deposit_status

withdrawal_status

public_visibility

updated_at

ListingEvent

id

listing_id

event_type

previous_state

new_state

actor_id

timestamp

schedule_version

metadata

InventoryAllocation

Reuse the existing ledger and balance models. Associate allocation
transactions with a listing ID, source account, target MM account,
asset, amount, actor, and idempotency key.

Use the existing order table for MM orders where possible. Add a phase
or listing reference only if needed to isolate pre-launch orders safely.

Ensure foreign keys, uniqueness constraints, and atomic transaction
boundaries are used where the current database supports them.

If the application is currently localStorage-only, create a compatible
versioned persistence model for the simulator and clearly document its
limitations. Do not claim that localStorage is an authoritative shared
database.

15. SCHEDULER RELIABILITY

Implement a centralized lifecycle scheduler or reconciliation service.

The scheduler must:

Reconcile persisted schedules on startup.

Detect overdue transitions.

Process eligible transitions idempotently.

Use the authoritative clock.

Prevent duplicate launch events.

Prevent duplicate treasury allocations.

Prevent duplicate MM order activation.

Handle rescheduling.

Handle postponement.

Handle cancellation.

Handle application restart.

Record failed actions and retry safely.

Avoid uncontrolled intervals created by React components.

Do not make frontend timers responsible for opening markets.

For a browser-only simulator, use one centralized scheduling service and
persisted state, while documenting that scheduling is reliable only
while the simulator execution environment is running or when
reconciliation next occurs.

For a backend implementation, use durable scheduled jobs or a periodic
reconciliation worker backed by persistent data.

Never assume an in-memory timeout is durable across server restarts.

16. ROLE-BASED ACCESS CONTROL

Enforce permissions at the service or API boundary.

Admin

Can:

Create market pairs.

Review and approve listings.

Create schedules.

Reschedule, postpone, or cancel listings.

Configure readiness policies.

Allocate simulator inventory through ledger transactions.

Inspect MM readiness.

Pause or resume eligible markets.

Inspect audit logs.

Market Maker

Can:

View assigned listings.

Access funding during the authorized funding window.

Allocate or transfer eligible virtual inventory.

Place and cancel eligible MM limit orders during setup.

View order reservations and readiness.

Trade under the normal rules after the market becomes live.

Cannot:

Approve their own listing unless explicitly authorized.

Bypass market readiness.

Modify the public listing schedule without permission.

Spend funds they do not own or control.

Ordinary Trader

Can:

View scheduled upcoming listings.

View countdown and phase information.

Trade only after public trading opens.

Deposit only when deposit access opens.

Withdraw only when withdrawal access opens.

Cannot:

Access MM funding.

Place pre-launch orders.

Trade before the official launch.

Access another user's balances.

Bypass permissions through direct API calls.

17. ADMIN UI

Implement the feature within the existing SilentSmile admin design.

Create these sections:

Market Pair Creation.

Listing Review and Approval.

Listing Schedule Planner.

Upcoming Listing Calendar.

MM Funding Dashboard.

MM Inventory Readiness.

MM Pre-launch Order Book.

Launch Readiness Checklist.

Deposit and Withdrawal Schedule.

Listing Audit Logs.

The schedule planner should show a clear horizontal timeline or vertical
event list.

Display:

Scheduled time.

Current phase.

Remaining time.

MM funding status.

MM order setup status.

Inventory readiness.

Order-book readiness.

Trading readiness.

Deposit status.

Withdrawal status.

Last transition result.

Include explicit confirmation before:

Approving a listing.

Confirming a schedule.

Rescheduling.

Postponing.

Cancelling.

Opening trading manually.

Opening deposits or withdrawals manually.

Emergency stop.

Never allow the admin interface to silently bypass the underlying state
machine.

18. PUBLIC SPOT UI

Update the existing Spot market page without replacing the overall
design.

Separate the page into:

Active Markets.

Upcoming Listings.

Only LIVE markets belong in the normal active-trading list.

Upcoming cards must display:

Pair name.

Scheduled listing time.

Countdown.

Current preparation phase.

Trading access status.

Deposit access status.

Withdrawal access status.

When a user opens an upcoming market detail page:

Keep the pair identity visible.

Show a countdown.

Disable public order entry.

Disable deposit and withdrawal when closed.

Explain that the market has not launched.

Avoid presenting synthetic data as real execution history.

Avoid showing pre-launch MM orders as publicly executable liquidity.

When launch succeeds:

Update the market to LIVE.

Show the NEW badge.

Enable trading.

Keep deposit and withdrawal independently guarded.

Use existing chart components and market-data services. Do not create
fake candle history just to make an upcoming market appear active.

19. EVENT-DRIVEN SYNCHRONIZATION

Use a consistent state-transition event flow:

Schedule reached → Lifecycle readiness check → State transition → MM
order activation if appropriate → Trading access update → Public market
visibility update → UI and market-data notification

For deposit and withdrawal:

Schedule reached → Feature-specific readiness check → Access status
transition → User-facing status update

For all financial operations:

Validated operation → Ledger transaction → Balance update → Audit event
→ UI refresh

Use the project's existing state management or event architecture. Do
not introduce distributed infrastructure unnecessarily.

Ensure the chart consumes executed trades only. Scheduling events, MM
quotes, and order-book updates must not generate candles or traded
volume.

20. REQUIRED TESTS

Write tests using the project's existing testing framework.

Market creation and approval

Creating a pair leaves it hidden and inactive.

Approval does not publish it as a live market.

Approved-but-unscheduled markets remain hidden.

Invalid pairs are rejected.

Duplicate markets are rejected.

Scheduling

Valid schedules can be created.

Invalid timelines are rejected.

Timezones are handled correctly.

Countdown survives refresh.

Rescheduling invalidates old schedule versions.

Cancelled listings cannot launch.

Delayed scheduler runs are idempotent.

MM funding

Funding is rejected before the authorized window.

MM funding opens at the correct time.

Unauthorized accounts cannot allocate inventory.

Insufficient treasury inventory causes rejection.

Allocations update source and destination balances.

Ledger entries reconcile.

Duplicate allocation requests cannot double-credit balances.

MM preparation

MM orders are rejected before setup opens.

MM orders are accepted during the setup window.

Public orders are rejected before launch.

Pre-launch MM orders do not execute prematurely.

Invalid and underfunded orders are rejected.

Valid order IDs and reservations survive launch.

Public launch

Trading remains closed before scheduled launch.

Failed readiness prevents launch.

Valid readiness enables trading.

Direct order API calls cannot bypass the launch gate.

Launch does not generate fake trades or candles.

NEW badge expires independently.

Deposit and withdrawal

Each feature follows its own schedule.

Deposit can remain closed while trading is open.

Withdrawal can remain closed while trading is open.

Readiness failure keeps the relevant feature closed.

Direct operations are rejected while access is closed.

Simulated balance operations are recorded and reconciled.

Recovery and concurrency

Restart does not duplicate launch transitions.

Duplicate scheduler execution does not duplicate operations.

Concurrent launch attempts cannot corrupt the state.

Rescheduling and cancellation invalidate stale jobs.

Ledger and open-order reservations remain consistent.

21. BUILD AND DELIVERY REQUIREMENTS

After implementation:

Run TypeScript type checking.

Run existing tests.

Add and run new tests.

Run the production build.

Fix regressions introduced by the changes.

Inspect the final diff.

Document any limitations.

Provide a final implementation report containing:

Root-cause findings from the existing code.

Lifecycle architecture.

State-transition diagram.

Modified files.

Database or persistence changes.

Scheduling rules and default offsets.

Role permission matrix.

Actual test results.

Actual build results.

Manual verification instructions.

Known limitations.

Do not report successful tests or builds unless they were actually
executed.

Do not replace the existing project with a mockup, a static UI, or
disconnected sample data.

The completed feature must be integrated into the existing SilentSmile
Exchange codebase and use its actual simulated trading, order-book,
account, and ledger logic.

Begin by auditing the repository, then implement and verify the complete
feature.

------------------------------------------------------------------------

# END OF REVISED MASTER PROMPT
