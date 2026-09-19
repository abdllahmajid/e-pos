# PROGRESS — LCO POS

> **Buku serah terima antar-agent.** File ini WAJIB dibaca agent saat mulai
> sesi dan WAJIB ditulis ulang saat sesi berakhir (lihat PRD v1.1 §17 & §18).
> PRD: `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — acuan task ada di §17.

## Status terakhir diperbarui

2026-09-19, sesi #15. **T-11 bagian 2 (Split payment) — RPC baru dibuat,
`KasirModule.tsx` di-wire, migration DIJALANKAN ke production DAN
DIKONFIRMASI berjalan lancar oleh pemilik project.** Sesi ini juga
**meluruskan klaim yang keliru dari sesi #14**: sesi #14 mencatat sudah
membuat `019_held_orders.sql` (T-11) dan menggeser migration T-10 jadi
`020_profiles_update_admin_lock.sql` supaya tidak bentrok lagi — **tapi
isi zip project yang sebenarnya diserahkan ke sesi ini TETAP
`019_hold_orders.sql`** (ejaan "hold", bukan "held" seperti yang dicatat
sesi #14) **DAN `019_profiles_update_admin_lock.sql`, DUA-DUANYA MASIH
BERNOMOR `019`.** Tidak ada file bernama `020_*` di repo yang diserahkan ke
sesi ini sama sekali. Kemungkinan besar sesi #14 memang menulis file dengan
nama yang benar, tapi export/commit ke repo yang diserahkan ke sesi
berikutnya gagal sebagian — pola yang SAMA PERSIS dengan migration `015`
yang pernah hilang (sesi #10→#11). **Tabrakan nomor migration `019` yang
ditemukan sesi #13 JADI BELUM SELESAI**, meski sesi #14 mencatat dirinya
sudah menyelesaikannya. Lihat "Yang HARUS dikonfirmasi" poin 15 (baru).

Yang dikerjakan sesi ini:

1. **`supabase/migrations/021_split_payment.sql` — baru.** `CREATE OR
REPLACE FUNCTION create_transaction` menambah parameter
   `p_payments jsonb default null` untuk split payment (T-11 bagian 2, PRD
   §17 Fase G / §12 fase 1.1). Kalau `p_payments` diisi (array 1-4 baris
   `{method, amount, received_amount, due_date}`), RPC memvalidasi ulang di
   server — jumlah baris, tiap metode maksimal sekali, total `amount` harus
   PERSIS sama dengan `p_total`, CASH wajib `received_amount >= amount`,
   TEMPO wajib `due_date` + nama pelanggan (Aturan Main #5, PRD §18: logika
   uang wajib di RPC, bukan cuma client) — lalu insert SATU baris `payments`
   per elemen array (tabel `payments` memang sudah didesain 1-ke-banyak
   sejak migration 006). Kalau `p_payments` NULL, perilaku identik migration
   013 (satu metode, tidak ada perubahan). Hasil RPC menambah field
   `payments` (array `{payment_id, method, amount}`, urut sesuai input)
   supaya `PaymentModal.tsx` bisa menempelkan bukti transfer/QRIS ke baris
   yang benar. Detail keputusan desain lengkap ada di komentar header file.
   ⚠️ **Temuan saat mengerjakan ini**: `lib/pos/transactionApi.ts` dan
   `app/components/kasir/PaymentModal.tsx` **SUDAH LEBIH DULU lengkap
   menulis SELURUH alur split payment sisi client** (tipe
   `SplitPaymentLine`, `validateSplitPayments()`, mode "Split Bayar" penuh
   di UI) SEBELUM sesi ini — semuanya sudah menandai diri "TAMBAHAN (021)"
   di komentar, menunggu migration `021` ini dibuat. **TIDAK ADA jejak sesi
   manapun di file ini yang mencatat siapa/kapan kode client itu ditulis** —
   pola yang SAMA PERSIS dengan temuan T-11 bagian 1&3 di sesi #13. Lihat
   "Yang HARUS dikonfirmasi" poin 13 (masih berlaku, sekarang juga mencakup
   split payment, bukan cuma hold order/barcode).
2. **`app/components/kasir/KasirModule.tsx`** — 3 perubahan: (a) import tipe
   `SplitPaymentLine`/`CreatedPayment` dari `transactionApi.ts`; (b) handler
   baru `handleConfirmSplitPayment` (pola sama seperti `handleConfirmPayment`
   yang sudah ada: simpan transaksi → cetak struk → simpan `lastReceipt` →
   kosongkan keranjang; `paidAmount` struk = jumlah semua baris pembayaran,
   `method` struk digabung jadi label seperti "Tunai + Transfer" lewat
   konstanta baru `SPLIT_METHOD_LABELS`); (c) prop
   `onConfirmSplitPayment={handleConfirmSplitPayment}` disambungkan ke
   `<PaymentModal>` — **SEBELUM perubahan ini prop tersebut TIDAK PERNAH
   dikirim sama sekali**, jadi pilihan "Split Bayar" (yang UI-nya sudah
   lengkap sejak sebelum sesi ini, lihat poin 1) belum pernah bisa muncul di
   layar Kasir manapun sampai sesi ini.
3. **Migration `021` sudah dijalankan pemilik project ke Supabase production
   DAN sudah diuji coba langsung — dikonfirmasi "berjalan dengan lancar".**
   Ini bagian T-11 PERTAMA sejak audit sesi #13 yang statusnya benar-benar
   terverifikasi end-to-end di sesi yang sama dengan penulisan kodenya
   (biasanya menggantung 1-2 sesi seperti migration 013/019/020 sebelumnya).
   **Detail kombinasi yang SUDAH dicoba TIDAK dirinci pemilik project** —
   mis. belum jelas apakah sudah dicoba split 3-4 metode sekaligus, upload
   bukti BANK_TRANSFER+QRIS bersamaan dalam satu transaksi split, atau TEMPO
   sebagai salah satu baris split (bukan satu-satunya metode). **Jangan
   asumsikan SEMUA kombinasi sudah teruji hanya dari konfirmasi umum ini** —
   lihat "Yang HARUS dikonfirmasi" poin 16 (baru).
4. **Verifikasi kode sesi ini** (jaringan tersedia): `npm install` berhasil.
   `tsc --noEmit` penuh: cuma 1 error pra-eksisting (`app/layout.tsx:20`
   `LayoutProps`, sama seperti tercatat sejak sesi #8) — **tidak ada error
   baru** dari `KasirModule.tsx`. `eslint` khusus `KasirModule.tsx`: **0
   error, 0 warning**. Migration `021` (SQL) tidak bisa di-lint dari sandbox
   ini (sama seperti migration lain, tidak ada koneksi database) — tapi
   SUDAH diverifikasi jalan di production oleh pemilik project (lihat poin
   3), beda dari kebanyakan migration sesi-sesi sebelumnya yang biasanya
   berhenti di "baru file, belum dieksekusi".

<details>
<summary>Detail sesi #14 (rekonstruksi migration `held_orders` T-11 & migration T-10 penggeseran nomor — ⚠️ menurut sesi #15, isi repo yang sebenarnya TIDAK cocok dengan klaim entri ini, lihat "Status terakhir diperbarui" sesi #15 di atas) — diciutkan</summary>

2026-09-19, sesi #14. **Perbaikan atas Temuan 1 & 2 sesi #13 — 2 file
migration baru dibuat: `019_held_orders.sql` (T-11 bagian 1) dan
`020_profiles_update_admin_lock.sql` (T-10, digeser dari nomor `019` yang
lama supaya tidak bentrok).** ⚠️ **File-nya sudah dibuat & disertakan ke
repo, TAPI BELUM SATU PUN DIJALANKAN ke database manapun** (sandbox ini
tetap tidak punya akses ke Supabase production, sama seperti semua sesi
sebelumnya) — status "diperbaiki" di judul ini artinya "kodenya sudah
ditulis", BUKAN "sudah aktif di database". Pemilik project WAJIB menjalankan
kedua file ini secara berurutan (`019` dulu, baru `020`) lewat SQL Editor
Supabase sebelum fitur Tunda & pengaman anti-privilege-escalation T-10
benar-benar berfungsi. Lihat "Yang HARUS dikonfirmasi" poin 14.

1. **`supabase/migrations/019_held_orders.sql` — baru (rekonstruksi).**
   Tabel `held_orders` (`id`, `cashier_id`, `label`, `items` jsonb,
   `item_count`, `subtotal`, `created_at`) + RLS select/insert/delete
   terbatas ke baris milik kasir sendiri (`cashier_id = auth.uid()`), tidak
   ada policy update (baris held order tidak pernah di-UPDATE, cuma
   insert lalu delete). Disusun ULANG murni dari membaca
   `hooks/useHoldOrders.ts` baris-per-baris (interface `HeldOrder`, kolom
   apa yang di-select/insert, cara resume & delete) — **BUKAN dari file SQL
   asli yang sudah hilang**, jadi ada kemungkinan detail kecil (index
   tambahan, constraint check lain) dari versi asli yang tidak tertangkap.
   Nomor `019` SENGAJA dipertahankan (bukan digeser) karena
   `hooks/useHoldOrders.ts` sudah 3x menyebut "migration 019" verbatim di
   komentarnya — menggeser nomor ini berarti harus mengedit 3 baris komentar
   TypeScript, lebih berisiko daripada menggeser migration T-10 yang tidak
   di-hardcode di kode manapun (lihat poin 2). Detail keputusan desain
   lengkap ada di komentar header file itu sendiri, tidak diulang di sini.
2. **`supabase/migrations/020_profiles_update_admin_lock.sql` — baru
   (bukan rekonstruksi tebakan — isi PERSIS mengikuti deskripsi detail di
   entri sesi #12 poin 4 di bawah, cuma penomoran file yang berubah dari
   `019` ke `020`).** Mengganti policy `profiles_update_admin_supervisor`
   (migration 018) dengan `profiles_update_admin_supervisor_locked`:
   supervisor tidak lolos USING (baris SEBELUM update) maupun WITH CHECK
   (baris SESUDAH update) untuk baris `role = 'admin'`, berlaku kolom
   apapun yang diubah — bukan cuma role/is_active seperti trigger
   `enforce_profiles_role_change` (migration 018) yang TIDAK diubah/dihapus
   di sini, tetap jadi penjaga kedua (defense in depth). Admin tidak kena
   batasan tambahan apa pun.
3. **Tidak ada perubahan kode frontend/TypeScript sesi ini** — cuma 2 file
   SQL baru. `PengaturanAdminTab.tsx`, `hooks/useAdminUsers.ts`,
   `hooks/useHoldOrders.ts`, `KasirModule.tsx`, `BarcodeScanModal.tsx`
   semuanya sudah benar dari sesi-sesi sebelumnya — murni migration
   database yang menyusul, sama pola dengan sesi #11 (migration 015).
4. **Belum bisa diverifikasi dari sandbox ini**: kedua file SQL baru
   **tidak bisa di-lint/dijalankan dari sini** (tidak ada koneksi ke
   database Supabase manapun) — cuma diperiksa manual (dibaca ulang,
   dicocokkan lagi terhadap `hooks/useHoldOrders.ts` dan migration 018
   yang sudah ada). `tsc --noEmit` & `eslint` tidak relevan untuk sesi ini
   (tidak ada file `.ts`/`.tsx` yang diubah).

</details>

<details>
<summary>Detail sesi #13 (audit — tabrakan migration `019` & T-11 bagian 1/3 ditemukan tanpa catatan) — diciutkan</summary>

2026-09-19, sesi #13. **Audit verifikasi (TIDAK ADA perubahan kode) —
ditemukan tabrakan penomoran migration `019` (dua isi berbeda, KEDUANYA
hilang dari repo) DAN pekerjaan T-11 bagian 1 & 3 yang sama sekali belum
pernah tercatat di file ini.** Sesi ini murni membandingkan isi
`PROGRESS.md` terhadap PRD §17 dan kode sungguhan di zip project (`npm
install` + `tsc --noEmit` + `eslint` dijalankan penuh, jaringan tersedia) —
**tidak menulis/mengubah satu baris kode maupun migration pun**, cuma
memperbarui catatan ini supaya sesi berikutnya tidak salah asumsi.

**Temuan 1 — tabrakan nomor migration `019` (PALING KRITIS):** Sesi #12
mencatat `019_profiles_update_admin_lock.sql` (kunci profil admin dari
supervisor, lihat detail sesi #12 di bawah). Tapi kode `hooks/useHoldOrders.ts`
(lihat Temuan 2) menyebut **migration `019` yang ISINYA SAMA SEKALI BEDA** —
`CREATE TABLE held_orders` + policy `held_orders_insert_own` untuk fitur
Hold Order/Tunda. **Kedua file migration `019` ini SAMA-SAMA TIDAK ADA di
repo/zip** yang diserahkan ke sesi ini (`find . -iname "*019*"` di root
project: kosong) — dicek juga `scripts/setup-database.sql` dan
`scripts/migrate.ts` untuk isi `held_orders`, tidak ada jejak sama sekali.
Ini pola yang SAMA seperti migration `015` yang hilang (sesi #10→#11, lihat
detail sesi #11 di bawah), tapi sekarang dua sesi/pekerjaan berbeda
kebetulan memakai nomor yang sama untuk isi yang berbeda — **jangan asumsikan
salah satu "menang" atau salah satu "yang benar"**, kemungkinan besar
KEDUANYA perlu dibuat ulang, dengan nomor BERBEDA (mis. `019` untuk salah
satu, `020` untuk yang lain — tentukan urutan berdasarkan dependency:
`held_orders` (T-11) tidak bergantung pada `profiles_update_admin_lock`
(T-10) atau sebaliknya, jadi urutan bebas, tapi JANGAN pakai nomor yang
sama untuk keduanya lagi). Lihat "Yang HARUS dikonfirmasi" poin 12.

**Temuan 2 — T-11 bagian 1 (Hold Order/"Tunda") & bagian 3 (Scan barcode
kamera) SUDAH ADA DI KODE, TIDAK PERNAH TERCATAT di file ini sebelumnya:**
PRD §17 menempatkan T-11 di "Fase G — setelah MVP stabil" (fase 1.1/2.0,
bukan bagian alur T-01→T-10 utama), jadi wajar kalau belum "waktunya"
dikerjakan menurut urutan PRD — **tapi kodenya SUDAH ADA dan sudah
tersambung ke UI**, dan tidak ada satu pun jejak sesi (baik di histori sesi
manapun di file ini) yang menyebut siapa yang mengerjakan atau kapan. Yang
ditemukan lewat pembacaan kode langsung (bukan dari catatan sesi manapun):

- **`hooks/useHoldOrders.ts` (baru, belum tercatat)** — hook penuh untuk
  tunda/lanjutkan/hapus pesanan (`holdOrder()`, `resumeHeldOrder()`),
  ber-komentar header "PRD §17 T-11, bagian 1 dari 3". Baca tabel
  `held_orders` yang skemanya disebut ada di "migration 019" — lihat Temuan
  1, migration itu TIDAK ADA di repo. `resumeHeldOrder()` sengaja
  memvalidasi ulang stok terkini (bukan asumsi stok sama seperti saat
  ditunda) dan melaporkan `skippedItems` untuk produk yang sudah
  dihapus/nonaktif/stok kurang, tanpa membatalkan seluruh resume.
- **`app/components/kasir/BarcodeScanModal.tsx` (baru, belum tercatat)** —
  modal scan barcode pakai kamera (`html5-qrcode`, sudah ada di
  `package.json` dependencies), ber-komentar header "T-11 bagian 3".
  Komentar kode mencatat sendiri sebuah koreksi desain: versi pertama
  auto-start kamera lewat `useEffect` saat modal dibuka ternyata gagal di
  banyak browser mobile (Safari iOS, sebagian Chrome Android PWA) karena
  `getUserMedia()` harus dipicu LANGSUNG dari user gesture (tap), bukan dari
  efek React — sudah diperbaiki di versi yang ada sekarang (kamera start
  dari tap tombol eksplisit, bukan otomatis).
- **`app/components/kasir/KasirModule.tsx` — sudah diwiring** (bukan file
  baru, tapi berubah signifikan tanpa tercatat): tombol/modal "Tunda", modal
  daftar held order (lanjutkan/hapus), tombol/modal scan barcode kamera,
  semuanya sudah ada di JSX dan handler-nya (lihat komentar "TAMBAHAN (T-11
  bagian 1)" dan "(T-11 bagian 3)" tersebar di file ini).
- **T-11 bagian 2 (split payment) BELUM ada jejak kode sama sekali** — cuma
  bagian 1 & 3 yang sudah dikerjakan. T-12 (FCM/PWA/cron) dan T-13
  (backup/offline) juga belum ada jejak kode (dicek: tidak ada
  `firebase`/`manifest.json`/`api/backup`/IndexedDB di luar komentar "Jangan
  dulu" yang memang sudah lama ada di `DashboardModule.tsx`).

⚠️ **Konsekuensi paling penting dari kedua temuan di atas**: modul Kasir
(`KasirModule.tsx`) sekarang **memanggil tabel `held_orders` yang tidak
pernah ada di database manapun** (migration-nya hilang) — kalau frontend
sesi #12/#13 ini di-deploy ke production TANPA migration `held_orders`
dibuat ulang dan dijalankan lebih dulu, **fitur "Tunda" akan gagal total
begitu dipakai** (query ke tabel yang tidak ada → error), sama persis
seperti kasus migration `013` yang pernah kejadian (sesi #9). Ini BUKAN
regresi dari sesi #12/#13 — kemungkinan besar sudah jadi masalah sejak
sebelumnya, cuma baru ketahuan sekarang karena inilah audit pertama yang
membandingkan isi kode terhadap isi `PROGRESS.md` secara menyeluruh.

**Verifikasi kode sesi ini** (jaringan tersedia, tanpa akses
database/browser — kendala sama seperti sesi-sesi sebelumnya):
`npm install` berhasil. `tsc --noEmit` penuh: **cuma 1 error**, sama persis
seperti yang sudah tercatat sejak sesi #8 (`app/layout.tsx:20`
`LayoutProps`) — tidak ada error baru, termasuk di file-file T-11 yang baru
ketahuan sesi ini. `eslint .` (seluruh project, bukan cuma file yang
diubah): **17 error, 8 warning** — angka ini BEDA dari "13 error + 6
warning" yang tercatat di "Yang HARUS dikonfirmasi" poin 2 (sesi #8), tapi
**bukan regresi** — selisihnya berasal dari file-file yang belum ada saat
lint terakhir dijalankan penuh (`PengaturanTokoTab.tsx`,
`hooks/useAdminUsers.ts`, `hooks/useHoldOrders.ts`,
`BarcodeScanModal.tsx`, plus makin banyak temuan di
`DashboardModule.tsx`), semuanya pola `react-hooks/set-state-in-effect`
atau `no-explicit-any` yang SAMA seperti yang sudah dicatat sebagai
pra-eksisting, bukan pola baru. 3 file spesifik yang diubah sesi #12
(`Sidebar.tsx`, `PengaturanModule.tsx`, `PengaturanAdminTab.tsx`) sendiri
tetap **0 error, 0 warning** kalau di-lint terpisah — detail sesi #12 di
bawah masih akurat untuk bagian itu.

</details>

<details>
<summary>Detail sesi #12 (T-10 — akses dilonggarkan ke admin+supervisor, celah RLS ditutup, verifikasi kode) — diciutkan</summary>

2026-09-19, sesi #12. **T-10 (Pengaturan Admin) — akses dilonggarkan ke
admin+supervisor, celah RLS ditutup, verifikasi kode.** Sesi ini melanjutkan
pekerjaan T-10 yang SEBELUMNYA sudah dibangun (migration
`016_admin_user_management.sql`, `017_profiles_email.sql`,
`app/components/pengaturan/*`, `hooks/useAdminUsers.ts`, wiring
`Sidebar.tsx`/`page.tsx`) dan percakapan lanjutan soal akses supervisor
(migration `018_pengaturan_supervisor_access.sql`, sudah dibuat) — tapi
`PROGRESS.md` ini sendiri **TIDAK SEMPAT ditulis ulang** sebelum sesi itu
terputus (pola yang sama sudah terjadi 3x sebelumnya di sesi #5/#7/#8, lihat
histori di bawah — kali ini basi untuk T-10 utuh, bukan cuma satu migration).

Root cause pemicu revisi akses: pemilik project (yang JADI penguji
sehari-hari) login dengan akun ber-role `supervisor`, langsung diblokir layar
"Akses Ditolak" walau menu Pengaturan sudah muncul di Sidebar — sesuai desain
SEMULA (admin-only murni, PRD §5 baris `settings`). Keputusan pemilik project
(dikonfirmasi langsung, pola sama dengan migration `015`): longgarkan ke
admin+supervisor, DENGAN 2 pengaman tambahan (supervisor tidak bisa
sentuh/promosikan akun admin) karena modul ini beda kelas risiko dari
Sampah/Log Aktivitas (bisa ubah role user lain & pengaturan toko).

⚠️ Sesi ini (seperti kebanyakan sesi sebelumnya) dikerjakan TANPA akses ke
database Supabase production maupun browser sungguhan. BEDA dari kebanyakan
sesi: `npm install` dan akses jaringan TERSEDIA PENUH sesi ini (lihat poin 6
di bawah) — tapi tetap tidak ada cara menjalankan migration SQL atau membuka
UI di browser dari sandbox ini, keduanya tetap wajib dilakukan pemilik
project sendiri.

Yang dikerjakan sesi ini:

1. **`app/components/layout/Sidebar.tsx`** — menu "Pengaturan" (grup
   "Administrasi"): `roles` diganti dari `["admin"]` jadi
   `["admin", "supervisor"]`, konsisten dengan migration `018`. Komentar
   header disesuaikan.
2. **`app/components/pengaturan/PengaturanModule.tsx`** — gate akses
   `canAccessSettings` diganti dari `role === "admin"` jadi
   `role === "admin" || role === "supervisor"`. Pesan layar "Akses Ditolak"
   disesuaikan. **Ini file yang bikin pemilik project masih diblokir padahal
   menu sudah muncul** — Sidebar (poin 1, sebelum diubah sesi ini) dan
   Module ini sebelumnya TIDAK SINKRON dengan migration `018`: backend sudah
   melonggarkan, tapi 2 gate frontend ini masih admin-only murni.
3. **`app/components/pengaturan/PengaturanAdminTab.tsx`** — tambahan
   pengaman UI untuk baris user ber-role admin KETIKA yang login supervisor
   (mencerminkan pengaman A/B migration `018` di sisi tampilan, bukan cuma
   menunggu error RPC):
   - Dropdown role & tombol nonaktifkan: `disabled` + tooltip penjelasan.
   - Opsi "Admin" disembunyikan dari dropdown role kalau pemanggil
     supervisor (fungsi baru `getRoleOptionsFor()`) — supervisor tidak bisa
     lihat/pilih opsi itu sama sekali untuk baris manapun.
   - **Tambahan di luar rencana awal, ditemukan saat review**: tombol Edit
     (nama/email) & Kirim Reset Password JUGA dikunci untuk baris admin
     kalau pemanggil supervisor — lihat root cause di poin 4.
4. **`supabase/migrations/019_profiles_update_admin_lock.sql` — baru.**
   Menutup celah keamanan yang ditemukan saat review poin 3: pengaman
   migration `018` ("supervisor tidak bisa sentuh akun admin") HANYA
   ditegakkan lewat trigger `enforce_profiles_role_change`, yang baris
   pertamanya `if new.role = old.role and new.is_active = old.is_active then
return new` — SAMA SEKALI TIDAK JALAN kalau yang diubah cuma
   `full_name`/`email` (jalur `updateUserContact` di `hooks/useAdminUsers.ts`,
   pakai `.update()` langsung, bukan RPC). Policy
   `profiles_update_admin_supervisor` (migration `018`) mengizinkan update
   baris SIAPA PUN tanpa syarat kolom. **Risiko konkret**: supervisor ganti
   email akun admin ke email yang dia kuasai → klik "Kirim Reset Password"
   (`supabase.auth.resetPasswordForEmail`, API Auth terpisah dari RLS —
   memang terbuka untuk email manapun, itu bukan bagian yang bocor) → link
   reset terkirim ke email yang sudah diganti → pengambilalihan akun admin.
   **BELUM PERNAH TERJADI/DILAPORKAN** — murni temuan defensif saat review
   kode, BUKAN insiden nyata. Perbaikan: policy
   `profiles_update_admin_supervisor` diganti — supervisor sekarang tidak
   lolos USING/WITH CHECK sama sekali untuk baris yang `role = 'admin'`
   (SEBELUM maupun SESUDAH update), berlaku untuk kolom APAPUN, tidak
   bergantung trigger lagi. Admin tidak terkena batasan tambahan apa pun.
5. **Permintaan terpisah dari pemilik project**: naikkan role akun pemilik
   sendiri (saat ini `supervisor`) jadi `admin` langsung — dianggap
   perbaikan yang lebih rapi untuk akun pemilik aplikasi dibanding terus
   bergantung pada jalur pelonggaran supervisor. **Bukan migration**
   (perubahan data satu baris, bukan skema/policy) — diberi 2 query SQL
   Editor manual ke pemilik project: SELECT untuk cari `id` akun, lalu
   `alter table ... disable trigger profiles_enforce_role_change` + `update
profiles set role='admin'` + `enable trigger` lagi (trigger perlu
   dimatikan sebentar karena `enforce_profiles_role_change` mengecek
   `auth.uid()` yang NULL di konteks SQL Editor, akan menolak update kalau
   trigger aktif). **Belum dikonfirmasi sudah dijalankan pemilik project** —
   lihat "Yang HARUS dikonfirmasi" poin 10.
6. **Verifikasi kode** (jaringan tersedia sesi ini, TANPA akses
   database/browser — lihat peringatan di atas): `npm install` **berhasil**
   (tidak seperti beberapa sesi sebelumnya yang kadang tidak punya jaringan).
   `tsc --noEmit` **penuh satu project**: bersih untuk ke-3 file yang diubah,
   1 error pra-eksisting tidak terkait (`app/layout.tsx:20` `LayoutProps` —
   sudah tercatat sejak sesi #8, butuh `next build`/`next dev` untuk generate
   types, tidak tersentuh sesi ini). `eslint` khusus 3 file yang diubah
   (`Sidebar.tsx`, `PengaturanModule.tsx`, `PengaturanAdminTab.tsx`): **0
   error, 0 warning**. Migration `019` (SQL) tidak bisa di-lint dari sandbox
   ini (tidak ada koneksi ke database Supabase manapun) — cuma diperiksa
   manual (dibaca ulang), belum pernah dijalankan ke database manapun sama
   sekali, termasuk staging.

⚠️ **Status T-10 dasar (migration 016/017, komponen Pengaturan) SEBELUM sesi
ini**: dikerjakan sesi terpisah yang terputus SEBELUM sempat menulis
`PROGRESS.md` — riwayatnya TIDAK ADA di file ini sebelum sesi #12
menuliskannya sekarang (retroaktif, dari hasil membaca kode yang sudah ada
di repo/zip, BUKAN dari catatan sesi itu sendiri karena catatannya memang
tidak pernah dibuat). **Kemungkinan ada detail keputusan desain dari sesi
itu yang hilang** (sama seperti migration `015` yang filenya sempat hilang
di sesi #10→#11) — kalau menemukan perilaku T-10 yang tidak dijelaskan di
sini, jangan asumsikan itu bug, cek dulu kode
`PengaturanTokoTab.tsx`/`hooks/useAdminUsers.ts` langsung.

</details>

<details>
<summary>Detail sesi #11 (bug fix Log Aktivitas kosong untuk supervisor, migration <code>015</code> dibuat ulang & dieksekusi) — diciutkan</summary>

2026-09-18, sesi #11. **Bug fix: halaman Log Aktivitas tampil kosong untuk
akun supervisor walau void/retur sudah kejadian dan tersimpan di database.**
Root cause: **file migration `015` yang menurut catatan sesi #10 "sudah
dibuat" ternyata TIDAK ADA di repo/zip yang diserahkan ke sesi ini** — cuma
disebut di `PROGRESS.md`, isinya sendiri hilang (kemungkinan tidak sempat
di-commit/di-export sebelum sesi #10 terputus). Akibatnya RLS
`activity_logs` di database production **masih versi migration `014`
(select admin-only)**, padahal `LogAktivitasModule.tsx` (juga dibuat sesi
#10) sudah mengizinkan **admin+supervisor** membuka halamannya di sisi
frontend. Kombinasi ini membuat: akun supervisor bisa MEMBUKA halaman
(gate frontend lolos), tapi query `activity_logs` pulang 0 baris (RLS
database menolak diam-diam, sesuai desain `useActivityLogs.ts` yang memang
"kalau non-admin, hasilnya array kosong, bukan bocor error") — makanya
gejalanya "kosong tanpa pesan error", bukan crash.

Dikonfirmasi lewat data: transaksi void yang dicoba pemilik project
**sudah tercatat benar** di `activity_logs` sejak awal (dicek pemilik
project langsung via SQL Editor, RLS Supabase SQL Editor bypass RLS) — jadi
RPC `void_transaction` (migration 014) sama sekali tidak bermasalah, murni
soal siapa yang boleh MEMBACA baris yang sudah benar tersimpan itu.

**Perbaikan:** file migration `015_trash_supervisor_access.sql` dibuat
ulang (isi disusun ulang dari deskripsi di `PROGRESS.md` sesi #10 — RLS
`activity_logs` select admin+supervisor, plus 4 RPC Sampah
`soft_delete_product`/`restore_product`/`soft_delete_transaction`/
`restore_transaction` role check dilonggarkan dari `<> 'admin'` menjadi
`not in ('admin', 'supervisor')`, isi lain disalin persis dari migration
014). **Sudah dijalankan ke production oleh pemilik project sendiri langsung
dari SQL Editor** (bukan cuma file lagi kali ini) — **dikonfirmasi lewat
pengujian langsung di browser**: akun supervisor buka halaman Log
Aktivitas, entri `void_transaction` yang tadi kosong sekarang muncul.

⚠️ Sesi ini **tetap dikerjakan tanpa akses langsung ke database/browser** di
sisi agent (sandbox) — semua verifikasi "migration sudah jalan" dan "UI
sudah benar" di atas didapat dari **pemilik project yang menjalankan sendiri
query & pengujian**, bukan dari agent. Polanya sama seperti sesi-sesi
sebelumnya, dicatat di sini supaya jelas siapa yang sudah memverifikasi apa.

**Masih belum diketahui: status migration `013`** (field No. HP kasir, dari
sesi #9) — sudah dibuatkan query pengecekan
(`scripts/check_migrations_013_014_015.sql`, ikut dibuat sesi ini) tapi
pemilik project baru share hasil untuk bagian `activity_logs`-nya saja,
belum hasil kolom `status` untuk ketiga migration termasuk 013. **JANGAN
anggap migration 013 sudah jalan hanya karena 014/015 terbukti jalan** —
cek dulu pakai script itu di awal sesi berikutnya, lihat "Yang HARUS
dikonfirmasi" poin 7 (masih berlaku, belum tertutup).

Yang dikerjakan sesi ini:

1. **`supabase/migrations/015_trash_supervisor_access.sql` — dibuat ulang**
   (file hilang dari repo, lihat root cause di atas). Isi: `drop
policy`/`create policy activity_logs_select_admin_supervisor` (select
   admin+supervisor, menggantikan `activity_logs_select_admin` dari migration
   014), dan `create or replace function` untuk 4 RPC Sampah dengan baris
   cek role diubah jadi `not in ('admin', 'supervisor')`, isi lain identik
   migration 014. **Sudah dieksekusi ke production** (dikonfirmasi pemilik
   project) dan **sudah diverifikasi lewat pengujian browser** (lihat di
   atas) — beda dari kebanyakan migration sesi-sesi sebelumnya yang biasanya
   berhenti di "baru file, belum dieksekusi".
2. **`scripts/check_migrations_013_014_015.sql` — baru.** Query read-only
   untuk SQL Editor: cek apakah migration 013/014/015 sudah benar-benar
   berlaku di database (bukan cuma ada sebagai file), plus tampilkan isi
   `activity_logs` terbaru sebagai bukti data tersimpan. Berguna untuk
   sesi-sesi berikutnya supaya tidak perlu tebak-tebak status migration
   lagi — tinggal jalankan.
3. Tidak ada perubahan kode frontend sesi ini — `LogAktivitasModule.tsx`,
   `Sidebar.tsx`, `page.tsx` dari sesi #10 semuanya sudah benar dari awal,
   murni migration database yang menyusul.

</details>

<details>
<summary>Detail sesi #10 (keputusan akses Sampah/Log Aktivitas admin+supervisor; migration <code>015</code> awal, filenya sempat hilang — lihat root cause sesi #11 di atas) — diciutkan</summary>

2026-09-18, sesi #10. **Menuntaskan keputusan akses Sampah/Log Aktivitas**
yang sempat menggantung dari sesi sebelumnya (sesi ini melanjutkan
percakapan yang terputus tepat di titik menunggu konfirmasi pemilik
project). Keputusan **final, dikonfirmasi langsung pemilik project**: menu
Sampah & (nanti) Log Aktivitas dibuka untuk **admin+supervisor**, bukan
admin-only seperti tertulis di PRD §5 asli — sengaja menyimpang, alasan &
konsekuensi keamanannya dicatat di komentar header migration `015` (RPC
`soft_delete_product`/`restore_product`/`soft_delete_transaction`/
`restore_transaction` satu fungsi dipakai untuk hapus DAN pulih, jadi
melonggarkan restore otomatis melonggarkan delete juga).

⚠️ **Sesi ini JUGA dikerjakan TANPA akses ke database Supabase production
maupun browser sungguhan** (sandbox, sama seperti sesi #9). Migration `015`
**BARU FILE, BELUM DIEKSEKUSI** — dan migration `013` dari sesi #9 kemungkinan
besar **JUGA MASIH BELUM DIEKSEKUSI** (tidak ada indikasi lain di riwayat
project), jadi ada 2 migration menumpuk yang wajib dijalankan sebelum deploy
frontend terbaru. Lihat "Yang HARUS dikonfirmasi" poin 7 & 9.

⚠️ **Catatan tambahan dari sesi #11**: migration `015` yang disebut "baru
file" di paragraf di atas ternyata **filenya hilang sebelum sempat sampai
ke sesi #11** — cuma deskripsinya yang tersisa di catatan sesi ini. Sudah
dibuat ulang & dieksekusi di sesi #11, lihat entri sesi #11 di atas.

Yang dikerjakan sesi ini:

1. **`supabase/migrations/015_trash_supervisor_access.sql` — baru.**
   `CREATE OR REPLACE FUNCTION` untuk ke-4 RPC migration `014`, isi lain
   disalin persis, HANYA baris cek role yang berubah dari `<> 'admin'`
   menjadi `not in ('admin', 'supervisor')`. Ditambah RLS `activity_logs`:
   drop policy `activity_logs_select_admin`, buat
   `activity_logs_select_admin_supervisor` (select admin+supervisor). Insert/
   update/delete `activity_logs` TETAP tanpa policy sama sekali (tidak
   berubah dari migration 014) — semua tulisan tetap wajib lewat RPC
   `security definer`. RPC `void_transaction`/`return_transaction`/
   `adjust_stock` TIDAK disentuh (sudah admin+supervisor sejak awal).
2. **`app/components/sampah/SampahModule.tsx`** — `isAdmin` diganti
   `canAccessTrash` (`admin || supervisor`), dipakai di gate layar blokir.
   Pesan "Akses Ditolak" & komentar header disesuaikan.
3. **`app/components/produk/ProdukModule.tsx`** — tombol "Hapus" produk:
   `isAdmin` diganti `canDeleteProduct` (`admin || supervisor`), konsisten
   dengan RPC `soft_delete_product` yang sudah dilonggarkan di poin 1
   (supaya tidak ada tombol yang sengaja disembunyikan padahal backend sudah
   mengizinkan).
4. Verifikasi kode (bukan di database/browser — lihat peringatan di atas):
   `npm install` (jaringan tersedia), `tsc --noEmit` **penuh satu project,
   bersih** untuk ke-2 file yang diubah (satu error pra-eksisting tidak
   terkait, sama seperti sesi #8/#9: `app/layout.tsx:20` `LayoutProps`).
   `eslint` khusus 2 file yang diubah: **0 error**, 2 warning
   `no-img-element` (satu di antaranya, `SampahModule.tsx:270`, BARU
   ketahuan sesi ini karena file ini belum ada saat lint penuh terakhir di
   sesi #8 — bukan disebabkan perubahan role sesi ini, letaknya di elemen
   `<img>` foto produk di daftar Sampah, tidak tersentuh sesi ini sama
   sekali; warning satunya di `ProdukModule.tsx:441` sudah pra-eksisting
   sejak sesi #8).
5. **Belum dikerjakan (di luar scope keputusan yang diminta sesi ini)**:
   UI Log Aktivitas (`LogAktivitasModule.tsx`) sendiri belum dibuat — baru
   RLS-nya yang disiapkan (poin 1) supaya sudah konsisten begitu modulnya
   dibangun. Perbaikan blink `LaporanModule.tsx` (`!isAuthLoading &&
!canViewReports` tanpa layar Memuat terpisah, pola sama seperti bug yang
   diperbaiki di `SampahModule.tsx` sesi sebelumnya) **juga belum
   dikerjakan** — sempat ditawarkan agent sebelum sesi ini terputus, belum
   dikonfirmasi pemilik project, jangan dikerjakan asal tanpa tanya dulu.

<details>
<summary>Detail sesi #9 (T-08 100% selesai — field No. HP + Kirim WA Kasir) — diciutkan</summary>

2026-09-18, sesi #9. **Menuntaskan poin 10 dari sesi #8**: tombol "Kirim WA"
di layar Kasir setelah bayar (PRD §4.2/§4.7), yang sebelumnya sengaja TIDAK
dikerjakan setengah-setengah karena butuh field nomor HP pelanggan dulu.
Dengan ini **T-08 (Laporan) sekarang 100% selesai**, tiga checkbox-nya
tercentang penuh — lihat "Task selesai" di bawah. Narasi detail sesi #8
(termasuk 9 poin lain yang sudah lebih dulu selesai) diciutkan ke
`<details>` di bawah, sama seperti pola T-07 di histori file ini.

⚠️ **Sesi ini dikerjakan oleh agent TANPA akses ke database Supabase
production maupun browser sungguhan** (lingkungan sandbox, sama seperti
kendala sesi-sesi sebelumnya untuk pengujian browser). Artinya:
migration baru **BARU FILE, BELUM DIEKSEKUSI** ke production, dan alur
field HP + tombol Kirim WA **BELUM PERNAH DICOBA di browser sama sekali**
oleh siapa pun (agent maupun pemilik project). Jangan anggap task ini
benar-benar "selesai" dalam arti operasional sebelum kedua hal itu
dilakukan — lihat "Yang HARUS dikonfirmasi" poin 7 & 8.

Yang dikerjakan sesi ini:

1. **`supabase/migrations/013_transaction_customer_phone.sql` — baru.**
   `CREATE OR REPLACE FUNCTION create_transaction(...)` menambah parameter
   `p_customer_phone text default null`, ditambahkan di **akhir** daftar
   parameter (aman untuk `create or replace function` — tidak mengubah
   urutan/tipe parameter lama, tidak mem-break pemanggil yang belum kirim
   nilainya). Kolom `transactions.customer_phone` **sudah ada** sejak
   migration `001` (dan sudah dibaca `getTransactionDetail()` untuk Riwayat
   Transaksi) — migration ini murni menyambungkan RPC-nya, **tidak ada
   perubahan skema tabel apa pun**. Isi logika lain di fungsi disalin persis
   dari migration `009` (tidak ada perubahan logika lain yang tidak
   disengaja). **BELUM DIEKSEKUSI ke production** — lihat peringatan di atas.
2. **`lib/pos/transactionApi.ts`** — `CreateTransactionParams` dapat field
   baru `customerPhone?: string` (opsional untuk SEMUA metode bayar, bukan
   cuma TEMPO — sesuai PRD §4.2). `createTransaction()` mengirim
   `p_customer_phone: params.customerPhone?.trim() || null` ke RPC.
3. **`app/components/kasir/PaymentModal.tsx`**:
   - Field baru "No. HP" (opsional): untuk CASH/TRANSFER/QRIS muncul sebagai
     blok "Nama + No. HP" opsional (field Nama di sini BARU — sebelumnya
     `customerName` cuma dikumpulkan untuk TEMPO); untuk TEMPO ditambahkan
     sebagai field HP opsional di samping Nama (wajib) & Jatuh Tempo (wajib)
     yang sudah ada.
   - `onConfirmPayment` sekarang mengirim `customerPhone` ke parent lewat
     parameter `extra`.
   - **Layar sukses dirombak**: sebelumnya auto-tutup lewat `setTimeout`
     (900ms, atau 2500ms kalau ada `proofWarning`) — **dihapus total**,
     terlalu cepat untuk kasir sempat menekan apa pun, dan tidak sesuai PRD
     §4.2 yang minta "kirim struk via WhatsApp" DAN "opsi transaksi baru"
     sebagai dua aksi eksplisit. Sekarang layar sukses tetap terbuka sampai
     kasir menekan salah satu dari 2 tombol baru: **"Kirim Struk via
     WhatsApp"** (tampil hanya kalau parent memberi prop baru
     `onSendWhatsApp`, dengan state sending/sent/error sendiri — gagal di
     sini TIDAK ditampilkan seperti transaksi gagal, karena uang & stok
     sudah tersimpan benar) dan **"Transaksi Baru"** (efeknya sama seperti
     `onClose` lama).
   - Modal ini **sengaja TIDAK** import `printLogic.ts` sendiri — parent
     (KasirModule) yang tahu bentuk `ReceiptData` lengkap dan memanggil
     `shareReceiptViaWhatsApp()`; PaymentModal cuma urus UI status tombol.
4. **`app/components/kasir/KasirModule.tsx`**:
   - Import `shareReceiptViaWhatsApp` + tipe `ReceiptData` dari
     `printLogic.ts`.
   - State baru `lastReceipt`/`lastCustomerPhone` — menyimpan struk
     transaksi TERAKHIR yang sukses dibayar, karena tombol Kirim WA baru bisa
     ditekan SETELAH `handleConfirmPayment` selesai (bukan closure atas
     parameter fungsi itu).
   - `handleConfirmPayment` meneruskan `customerPhone` ke `createTransaction()`
     dan mengisi state di atas.
   - Handler baru `handleSendWhatsApp()` — dipanggil `PaymentModal` lewat
     `onSendWhatsApp`, memanggil `shareReceiptViaWhatsApp(lastReceipt,
lastCustomerPhone)`.
5. **Verifikasi kode** (bukan di database/browser — lihat peringatan di
   atas): `npm install` (jaringan tersedia sesi ini), `tsc --noEmit` **penuh
   satu project, bersih** untuk ke-4 file yang diubah (satu error pra-eksisting
   tidak terkait, `app/layout.tsx:20` `LayoutProps` — butuh `next build`/`next
dev` untuk generate types Next.js, tidak tersentuh sesi ini). `eslint`
   khusus tiap file yang diubah: `transactionApi.ts` & `KasirModule.tsx`
   bersih total (0 error/warning); `PaymentModal.tsx` ada 1 error,
   **pra-eksisting** (`react-hooks/set-state-in-effect` di `useEffect` reset
   form saat `isOpen` berubah — sudah tercatat di histori sesi #8 sebagai
   bagian dari 13 error lint lama, cuma baris nomornya bergeser karena state
   baru ditambah di atasnya).

<details>
<summary>Detail sesi #8 (T-08 Laporan, RLS <code>011</code>/<code>012</code> dikonfirmasi jalan) — diciutkan, T-08 sudah 100% selesai per sesi #9</summary>

2026-09-18, sesi #8. **Sesi ini melanjutkan pekerjaan sesi sebelumnya yang
terputus di tengah jalan** — saat sesi #8 mulai, kode `hooks/useReports.ts`,
`app/components/laporan/LaporanModule.tsx`, migration `011_transactions_rls.sql`
(perbaikan RLS, ditandai prioritas tertinggi di sesi #7), dan migration
`012_receivables_settlement.sql` **ternyata sudah lengkap ditulis**, walau
`PROGRESS.md` yang diwariskan masih menyebut semua itu "belum dikerjakan" —
PROGRESS.md-nya sendiri belum sempat ditulis ulang sebelum sesi sebelumnya
terputus. Pelajaran untuk sesi berikutnya: **kalau PROGRESS.md bilang sesuatu
"belum ada", cek dulu file/migration-nya langsung, jangan percaya begitu saja**
(pelajaran yang sama sudah dicatat 2 kali sebelumnya di sesi #5 dan #7, lihat
histori di bawah — sekarang kejadian lagi dengan bentuk berbeda: kali ini
bukan PRD yang salah, tapi PROGRESS.md-nya sendiri yang basi).

Yang dikerjakan sesi ini:

1. `app/components/layout/Sidebar.tsx` diganti pemilik project sendiri (bukan
   agent) — menambah grup menu baru "Laporan" (key `laporan`).
2. `app/page.tsx` disambungkan: dynamic import `LaporanModule` + baris render
   `activeMenu === "laporan"`. Sebelum ini, klik menu Laporan menampilkan
   layar kosong (menu-nya ada, tapi tidak ada JSX yang merender modulnya).
3. **Migration `011` dan `012` sudah dieksekusi ke database production**
   (dikonfirmasi langsung oleh pemilik project — bukan cuma file lagi).
4. Verifikasi kode (bukan di database, lihat bagian "Yang HARUS dikonfirmasi"
   untuk yang belum diverifikasi): `npm install` (jaringan tersedia sesi ini,
   beda dengan sesi #7), `tsc --noEmit` **bersih, tanpa error**. `npm run
build` (`next build`) **gagal, tapi HANYA karena sandbox agent sesi ini
   tidak bisa akses `fonts.googleapis.com`** (dipakai `next/font/google` di
   `app/layout.tsx` untuk font Geist) — bukan bug di kode manapun, termasuk
   bukan disebabkan perubahan sesi ini. **WAJIB dicoba `npm run build` dari
   mesin pemilik project sendiri** (yang punya akses internet normal) sebelum
   percaya build benar-benar hijau. `npm run lint` menemukan 13 error + 6
   warning, hampir semua **pra-eksisting di file-file lama** (`useCategories.ts`,
   `useProducts.ts`, `useSettings.ts`, `PaymentModal.tsx`, `KategoriModule.tsx`,
   `TransactionDetailModal.tsx`, `useTransactions.ts`, `transactionApi.ts`) dan
   BUKAN disebabkan sesi ini — kemungkinan besar baru ketahuan sekarang karena
   ini kali pertama `npm install` berhasil jalan di sesi manapun (sesi #7 juga
   tidak punya akses jaringan). Detail lengkap ada di bagian "Yang HARUS
   dikonfirmasi" di bawah, termasuk **1 error yang ADA di file baru T-08**
   (`hooks/useReports.ts` baris 516).
5. **`lib/pos/reportExport.ts` — baru.** `exportReportToExcel()` (1 file
   `.xlsx`, 4 sheet: Ringkasan/Harian-Bulanan/Per Shift/Piutang-Tempo, dari
   data mentah `useReports.ts` — nominal ditulis sebagai `number`, BUKAN
   string `formatRupiah()`, supaya tetap bisa dihitung di Excel) dan
   `exportReportToPdf()` (snapshot DOM tab aktif lewat `html-to-image` →
   `toPng()`, disusun ke PDF A4 lewat `jspdf`, dipotong otomatis ke beberapa
   halaman kalau kontennya lebih tinggi dari 1 halaman — BUKAN diperkecil
   paksa, supaya teks tabel tetap kebaca).
6. **`app/components/laporan/LaporanModule.tsx` — tombol "Export" yang
   sebelumnya `disabled` sekarang tersambung** ke `reportExport.ts` lewat
   dropdown 2 pilihan: "Excel (semua sub-tab)" dan "PDF (tab aktif saja)".
   Ditambah `reportContentRef` yang membungkus KONTEN TAB AKTIF saja (bukan
   filter tanggal/tombol tab) sebagai target snapshot PDF.
7. Verifikasi untuk poin 5 & 6: `tsc --noEmit` dan `npx eslint` **khusus 2
   file itu** (bukan full project ulang) — keduanya bersih, tidak menambah
   error baru ke 13 error lint pra-eksisting yang sudah dicatat di poin 4.
   **Belum dicoba di browser sungguhan** (unduh Excel/PDF asli belum
   diverifikasi manual oleh siapa pun) — lihat "Yang HARUS dikonfirmasi".
8. **`lib/pos/printLogic.ts` — ditambah `generateReceiptImage()` dan
   `shareReceiptViaWhatsApp()`.** Pola sama seperti `exportReportToPdf()` di
   poin 5 (snapshot elemen DOM lewat `html-to-image`, elemen ditempel
   off-screen — `position: fixed; left: -9999px`, BUKAN `display: none`,
   supaya tetap punya ukuran layout untuk di-snapshot — bukan dibuat
   `display: none`), tapi outputnya JPEG (bukan PNG) dari template struk baru
   yang dibangun manual (bukan reuse `printThermalReceipt`/`printA6Nota` —
   dua fungsi itu menulis ke iframe lalu `window.print()`, hasilnya kertas
   fisik bukan file). `shareReceiptViaWhatsApp()` coba **Web Share API**
   (`navigator.share` dengan `files`) dulu supaya gambar terlampir langsung
   di HP; kalau tidak didukung (umumnya desktop), **fallback**: unduh JPEG
   otomatis + buka `wa.me` dengan teks siap-kirim (nomor pelanggan disanitasi
   ke format `62xxx`) — kasir lampirkan gambarnya manual, karena `wa.me`
   TIDAK punya parameter attachment file (keterbatasan resmi WhatsApp, bukan
   bug). `tsc --noEmit` & `npx eslint` khusus file ini bersih.
9. **`app/components/transaksi/TransactionDetailModal.tsx` — tombol "Kirim
   WA" baru**, ditaruh sebelah dropdown "Cetak Ulang" di footer modal detail
   transaksi (Riwayat Transaksi). Manggil `shareReceiptViaWhatsApp()` dari
   poin 8, pakai `detail.customer_phone` yang SUDAH ada dari
   `getTransactionDetail()` (`transactionApi.ts`, tidak perlu perubahan
   backend). Tombol tetap aktif walau `customer_phone` kosong (transaksi lama
   yang pelanggannya tidak isi no. HP) — fallback `wa.me` tanpa nomor tujuan
   membuka layar pilih kontak manual, bukan gagal/disembunyikan.
   `handleReprint()` di-refactor sedikit (object struk dipisah ke
   `buildReceiptData()`) supaya dipakai ulang oleh handler WA baru, tanpa
   duplikasi. `tsc --noEmit` & `npx eslint` khusus file ini bersih (1 error
   lint yang muncul, `react-hooks/set-state-in-effect` di `useEffect` baris
   ~107, **pra-eksisting** — sudah tercatat juga di poin 4/"Yang HARUS
   dikonfirmasi" #2 sebagai bagian dari 13 error lama, tidak disentuh sesi
   ini).
10. **Saat itu BELUM disambungkan: tombol "Kirim WA" langsung di layar Kasir
    setelah bayar** (PRD §4.2 "Setelah bayar: ... kirim struk via WhatsApp",
    §4.7). Alasan saat itu: **tidak ada input nomor HP pelanggan sama sekali
    di form pembayaran manapun** (`customerName` cuma dikumpulkan untuk
    metode TEMPO, tidak ada field telepon) — kolom `customer_phone` MEMANG
    sudah ada di tabel `transactions` (migration `001`) dan sudah dibaca
    `getTransactionDetail()`, tapi `create_transaction` RPC dan
    `CreateTransactionParams` (`transactionApi.ts`) tidak pernah mengirim
    nilainya. **✅ SUDAH DISELESAIKAN di sesi #9** — lihat entri sesi #9 di
    atas (migration `013`, field HP di `PaymentModal.tsx`, tombol Kirim WA di
    layar sukses `KasirModule.tsx`).

</details>

## Task selesai

- [x] T-01 — Tabel `settings` + hook `useSettings` (migration `005_settings.sql`)
- [x] T-02 — Pembayaran lengkap per metode (transfer/qris/tempo): migration `006_payment_enhance.sql` (`due_date` di `payments`, tabel `payment_proofs` multi-file); update UI modal pembayaran dan riwayat.
- [x] T-03 — Nota A6/A5 non-thermal + pilihan format cetak per transaksi (`lib/pos/printLogic.ts` dengan `printA6Nota()` via iframe tersembunyi, pilihan format di `PaymentModal.tsx`, dropdown cetak ulang di `TransactionDetailModal.tsx`).
- [x] T-04 — Shift kasir: buka/tutup, selisih kas, wajib sebelum transaksi (migration `007_shift_sessions.sql` + `008_shift_close_rpc.sql`; `hooks/useShifts.ts`; `app/components/kas/KasModule.tsx`).
- [x] T-05 — Mutasi stok & opname (migration `009_stock_movements.sql`; `hooks/useStock.ts`; `app/components/stok/StokModule.tsx`).
- [x] T-06 — Dashboard asli (`hooks/useDashboard.ts` + tulis ulang `app/components/dashboard/DashboardModule.tsx`).
- [x] T-07 — Halaman publik `/cek-struk` (`app/cek-struk/page.tsx`; RPC `get_transaction_by_receipt` di migration `010_public_receipt_lookup.sql`).
- [x] **Perbaikan keamanan RLS** (migration `011_transactions_rls.sql`) — RLS
      aktif di `transactions`/`transaction_items`/`payments`, `select` untuk
      semua user login aktif, tanpa policy insert/update langsung (semua
      tulisan tetap wajib lewat RPC). **Sudah dijalankan ke production.**
      Lihat "Yang HARUS dikonfirmasi" untuk status pengujian end-to-end-nya.
- [x] **T-08 — Laporan** (PRD §17 Fase E, §4.5, §4.7) — **100% selesai
      secara kode per sesi #9.** ⚠️ Beberapa bagian **belum pernah diuji di
      browser sungguhan oleh siapa pun** (lihat "Yang HARUS dikonfirmasi" poin
      6, 7, 8) — jangan baca centang ini sebagai "sudah terverifikasi jalan",
      cuma "sudah lengkap ditulis & lolos type-check/lint":
  - [x] Sub-tab Harian/Bulanan, Per Shift, Piutang/Tempo (`hooks/useReports.ts`,
        `app/components/laporan/LaporanModule.tsx`), filter tanggal preset +
        custom, tandai lunas piutang lewat RPC `settle_receivable` (migration
        `012_receivables_settlement.sql`), menu Sidebar + routing `page.tsx`.
  - [x] **Export Excel & PDF** — `lib/pos/reportExport.ts` (`exportReportToExcel`/
        `exportReportToPdf`) sudah dibuat dan tersambung ke dropdown "Export"
        di `LaporanModule.tsx`. **Belum dicoba di browser sungguhan** (lihat
        "Yang HARUS dikonfirmasi").
  - [x] **`generateReceiptImage()` + `shareReceiptViaWhatsApp()`** — sudah ada
        di `lib/pos/printLogic.ts`, dan sudah tersambung ke tombol "Kirim WA"
        di `TransactionDetailModal.tsx` (Riwayat Transaksi). **Belum dicoba di
        browser sungguhan** (Web Share API maupun fallback `wa.me`) — lihat
        "Yang HARUS dikonfirmasi".
  - [x] **Tombol "Kirim WA" di layar Kasir setelah bayar** (PRD §4.2/§4.7) —
        **selesai di sesi #9**. Field nomor HP pelanggan (opsional, semua
        metode bayar) di `PaymentModal.tsx`, dialirkan lewat
        `createTransaction()` → RPC `create_transaction` (migration
        `013_transaction_customer_phone.sql`, parameter baru
        `p_customer_phone`) → kolom `transactions.customer_phone`. Layar
        sukses `PaymentModal.tsx` dirombak (auto-close dihapus) supaya ada
        tombol eksplisit "Kirim Struk via WhatsApp" & "Transaksi Baru".
        **Migration `013` BARU FILE, BELUM dieksekusi ke production — dan
        alur ini belum pernah dicoba di browser sama sekali** — lihat "Yang
        HARUS dikonfirmasi" poin 7 & 8, WAJIB dilakukan sebelum menganggap
        fitur ini benar-benar jalan.
- [x] **T-09 — Sampah & Log Aktivitas** (PRD §17 Fase F) — soft-delete/restore
      produk & transaksi (`app/components/sampah/SampahModule.tsx`, RPC
      `soft_delete_product`/`restore_product`/`soft_delete_transaction`/
      `restore_transaction` di migration `014_activity_logs_and_trash.sql`) +
      halaman Log Aktivitas (`app/components/log-aktivitas/LogAktivitasModule.tsx`,
      tabel `activity_logs`). Akses admin+supervisor (migration
      `015_trash_supervisor_access.sql`, keputusan sadar pemilik project,
      menyimpang PRD §5). **Migration 014 & 015 sudah dieksekusi ke production
      dan diverifikasi lewat pengujian browser langsung oleh pemilik project**
      (sesi #10/#11) — satu-satunya task yang statusnya benar-benar
      terverifikasi end-to-end sejauh ini di file ini, bukan cuma lolos
      type-check. (Entri ini seharusnya sudah ditambahkan sejak sesi #11,
      baru ditambal sesi #12 — lihat catatan "PROGRESS.md basi" di sesi #12.)
- [x] **T-10 — Pengaturan Admin** (PRD §17 Fase G, §4.1, §11) — sub-tab "Toko
      & Struk" (`PengaturanTokoTab.tsx`, edit `settings` dari T-01) +
      "Pengaturan Admin" (`PengaturanAdminTab.tsx`, kelola user: ubah role,
      aktifkan/nonaktifkan, edit kontak, reset password — migration
      `016_admin_user_management.sql`/`017_profiles_email.sql`). Akses
      direvisi dari admin-only jadi **admin+supervisor** (migration
      `018_pengaturan_supervisor_access.sql`, sesi #12), dengan pengaman:
      supervisor tidak bisa sentuh/promosikan akun admin (role, status,
      MAUPUN kontak — migration `020_profiles_update_admin_lock.sql`, dibuat
      sesi #14, **digeser dari nomor `019` yang tadinya bentrok dengan
      migration `held_orders` milik T-11**, lihat Temuan 1 sesi #13). ⚠️
      **Migration `020` ini sudah ditulis tapi BELUM DIKONFIRMASI dijalankan
      ke database manapun** (sandbox sesi #14 tidak punya akses Supabase,
      sama seperti 016/017/018 yang statusnya juga masih menggantung) — jadi
      pengaman "supervisor tidak bisa ubah kontak akun admin" **BELUM AKTIF
      di production sampai file ini benar-benar dijalankan**. Modul ini juga
      belum pernah dibuka di browser sungguhan sama sekali (baik oleh agent
      maupun pemilik project) — lihat "Yang HARUS dikonfirmasi" poin 9, 11, 14. Jangan baca centang ini sebagai "sudah jalan", cuma "sudah lengkap
      ditulis & lolos review manual".
- [ ] **T-11 — Fase 1.1/2.0 (PRD §17 Fase G, "setelah MVP stabil")** — status
      **SEBAGIAN, ditemukan lewat audit kode sesi #13, TIDAK ADA riwayat sesi
      manapun sebelum #13 yang mencatat pengerjaannya**:
  - [x] (kode ada, migration `019_hold_orders.sql` ADA di repo per sesi #15,
        TAPI status jalan-atau-belum di database TIDAK DIKONFIRMASI sesi
        ini — lihat "Yang HARUS dikonfirmasi" poin 15) **Bagian 1 — Hold
        order/"Tunda"**: `hooks/useHoldOrders.ts` + wiring penuh di
        `KasirModule.tsx` (tombol Tunda, modal daftar held order, resume
        dengan validasi ulang stok). Bergantung tabel `held_orders`.
        **Fitur ini akan gagal total kalau dipakai sebelum migration
        `019_hold_orders.sql` benar-benar dieksekusi ke production** — belum
        ada konfirmasi baru soal ini sejak sesi #14.
  - [x] (kode ada, tidak butuh migration) **Bagian 3 — Scan barcode kamera**:
        `app/components/kasir/BarcodeScanModal.tsx` (`html5-qrcode`) + wiring
        di `KasirModule.tsx`. Tidak menyentuh database, jadi kemungkinan
        besar sudah bisa dipakai langsung setelah build — **tapi belum
        pernah dicoba di browser/HP sungguhan sama sekali** sejauh yang
        tercatat di file ini.
  - [x] **Bagian 2 — Split payment: SELESAI & DIKONFIRMASI JALAN sesi #15.**
        `supabase/migrations/021_split_payment.sql` (RPC `create_transaction`
        menerima `p_payments`) + wiring `onConfirmSplitPayment` di
        `KasirModule.tsx` — migration sudah dijalankan ke production dan
        diuji coba langsung oleh pemilik project ("berjalan dengan lancar").
        Ini satu-satunya bagian T-11 yang statusnya benar-benar
        terverifikasi end-to-end. Detail kombinasi yang SUDAH dicoba tidak
        dirinci pemilik project — lihat "Yang HARUS dikonfirmasi" poin 16.
- [ ] T-12 (FCM/cron/PWA) & T-13 (backup/offline) — belum ada jejak kode
      sama sekali (dicek ulang sesi #13: tidak ada `firebase`,
      `manifest.json`, `api/backup`, atau pemakaian IndexedDB di luar
      komentar "Jangan dulu" yang memang sudah lama ada di
      `DashboardModule.tsx`).

## Sedang dikerjakan

- (tidak ada sesi aktif — tapi lihat Temuan 2 sesi #13: ada kode T-11 yang
  jelas PERNAH dikerjakan seseorang/sesi lain tanpa pernah tercatat di sini,
  jadi "tidak ada sesi aktif" tidak sama dengan "tidak ada pekerjaan yang
  menggantung tanpa catatan")

## ✅ Temuan keamanan RLS sesi #7 — SUDAH DIPERBAIKI (migration `011`)

Ringkasan (detail keputusan desain lengkap ada di komentar header migration
`011_transactions_rls.sql` itu sendiri, tidak diulang di sini): tabel
`transactions`, `transaction_items`, `payments` sekarang RLS aktif, `select`
untuk semua user login aktif (bukan dibatasi per-kasir — sengaja, dikonfirmasi
pemilik project, supaya Dashboard & modul lain yang sudah baca "semua
transaksi" tidak berubah perilaku), tanpa policy insert/update sama sekali
(semua tulisan tetap wajib lewat RPC `SECURITY DEFINER` yang sudah ada). RPC
publik `get_transaction_by_receipt` (T-07) tidak terpengaruh (`SECURITY
DEFINER`, bypass RLS by design).

**Migration sudah dijalankan ke production** (dikonfirmasi pemilik project sesi
ini). **Belum dikonfirmasi:** pengujian end-to-end setelah RLS aktif — lihat
poin 2 & 3 di bagian "Yang HARUS dikonfirmasi" di bawah, JANGAN anggap otomatis
aman hanya karena migration-nya sudah jalan tanpa error SQL.

## Yang HARUS dikonfirmasi di awal sesi berikutnya

1. **`npm run build` (`next build`) penuh belum pernah sukses di lingkungan
   manapun.** Di sandbox sesi ini, `tsc --noEmit` bersih (tidak ada type
   error) dan `next build` gagal HANYA pada tahap fetch font Google
   (`fonts.googleapis.com` diblokir jaringan sandbox) — bukan error kode.
   **Jalankan `npm run build` dari mesin dengan akses internet normal (mis.
   MacBook pemilik project) untuk konfirmasi build benar-benar hijau
   end-to-end**, termasuk tahap yang tidak bisa diuji dari sandbox ini
   (bundling font, dsb).
2. **`npm run lint` menemukan 13 error + 6 warning** — daftar lengkap:
   `react-hooks/set-state-in-effect` di `PaymentModal.tsx`,
   `KategoriModule.tsx`, `TransactionDetailModal.tsx`, `useCategories.ts`,
   `useProducts.ts`, `useSettings.ts` (pola `setState` langsung di body
   `useEffect`, dianggap error oleh versi `eslint-config-next`/plugin
   react-hooks yang ter-install sekarang); `@typescript-eslint/no-explicit-any`
   di `useTransactions.ts:114` dan `transactionApi.ts:242,263`; warning
   `no-img-element` di `ProdukModule.tsx` dan unused var `Boxes` di
   `StokModule.tsx`. **Semua itu pra-eksisting, bukan disebabkan sesi ini** —
   baru ketahuan sekarang karena ini kemungkinan besar kali pertama `npm
install`+`npm run lint` berhasil jalan penuh (sesi-sesi sebelumnya sering
   tidak punya akses jaringan). **Satu error ADA di file T-08 yang baru**:
   `hooks/useReports.ts:516` — `useMemo` dependency array
   `[dateRange.start.getTime(), dateRange.end.getTime()]` ditolak aturan
   "dependency list harus ekspresi sederhana". Tidak menghalangi build/type
   check (cuma lint), tapi sebaiknya dibereskan (opsi: pindahkan
   `.getTime()` ke variabel terpisah sebelum dependency array) di sesi
   terpisah — jangan campur dengan task lain, dan jangan asal "perbaiki
   semua 13 error lint" tanpa diminta karena itu menyentuh banyak file lama
   di luar scope T-08.
3. **Uji ulang halaman `/cek-struk` secara end-to-end** (buka di browser
   tanpa login) sekarang migration `011` sudah aktif di production — RPC-nya
   `SECURITY DEFINER` seharusnya tetap jalan normal, tapi ini **belum
   dikonfirmasi diuji langsung**, jangan diasumsikan.
4. **Uji modul Kasir (checkout), Riwayat Transaksi, dan Dashboard** tidak
   patah setelah RLS `011` aktif — bagian paling berisiko dari migration itu,
   dan **belum dikonfirmasi diuji**.
5. **Uji modul Laporan (T-08) end-to-end di browser** — belum pernah dibuka
   pemilik project sejauh yang diketahui sesi ini: cek 3 sub-tab (Harian/
   Bulanan, Per Shift, Piutang/Tempo), coba tandai satu piutang TEMPO lunas
   (RPC `settle_receivable`), dan pastikan filter preset/custom tanggal
   berfungsi.
6. **Uji Export Excel/PDF (`reportExport.ts`) & tombol "Kirim WA"
   (`printLogic.ts`/`TransactionDetailModal.tsx`) di browser sungguhan —
   BELUM PERNAH sama sekali**, baik oleh agent (sandbox tidak punya UI
   browser) maupun pemilik project:
   - Export Excel: unduh beneran, buka file-nya, cek 4 sheet & nominal masih
     `number` (bisa di-SUM), bukan teks.
   - Export PDF: unduh beneran, cek potongan halaman kalau tabel Piutang
     panjang (harus lanjut ke halaman berikutnya, bukan diperkecil sampai
     tidak kebaca).
   - Kirim WA: coba dari **HP** (jalur `navigator.share` — harusnya langsung
     buka sheet share OS dengan gambar terlampir, pilih WhatsApp) DAN dari
     **browser desktop** (jalur fallback — harusnya JPEG otomatis terunduh +
     tab `wa.me` baru terbuka). Untuk transaksi yang `customer_phone`-nya
     `null` (semua transaksi baru saat ini — lihat poin 10 di atas), pastikan
     fallback `wa.me` **tanpa** nomor (`https://wa.me/?text=...`) benar-benar
     membuka layar pilih kontak WhatsApp, bukan error/blank.
7. **Jalankan migration `013_transaction_customer_phone.sql` ke Supabase
   production** — sampai ini dijalankan, `create_transaction` RPC di
   production masih versi lama (tanpa parameter `p_customer_phone`), dan
   **transaksi baru dari layar Kasir akan GAGAL total** kalau frontend sesi
   #9 di-deploy duluan tanpa migration ini (RPC lama tidak kenal parameter
   `p_customer_phone` yang sekarang selalu dikirim `transactionApi.ts` —
   Postgres/PostgREST akan menolak pemanggilan dengan parameter tak
   dikenal). **Migration ini WAJIB dijalankan SEBELUM/BERSAMAAN deploy
   frontend sesi #9**, bukan setelahnya.
8. **Uji field No. HP + tombol "Kirim WA" di layar Kasir end-to-end di
   browser sungguhan — BELUM PERNAH sama sekali** (sesi #9 dikerjakan tanpa
   akses browser/database, lihat catatan di awal entri sesi #9):
   - Isi No. HP pelanggan (opsional) untuk masing-masing dari 4 metode bayar,
     selesaikan transaksi, pastikan kolom `customer_phone` di database
     benar-benar terisi (bukan `null`) untuk transaksi BARU (beda dari
     sebelumnya yang selalu `null`).
   - Di layar sukses: coba tombol "Kirim Struk via WhatsApp" dari **HP**
     (harus langsung masuk jalur Web Share) dan dari **desktop** (harus
     jalur fallback unduh + buka tab `wa.me` dengan nomor pelanggan yang
     baru diisi — bukan `wa.me/` kosong seperti kasus lama).
   - Coba juga TANPA isi No. HP sama sekali — pastikan tombol tetap
     berfungsi (fallback ke `wa.me/` tanpa nomor tujuan, sama seperti
     perilaku tombol "Kirim WA" di Riwayat Transaksi yang sudah ada).
   - Pastikan "Transaksi Baru" tetap menutup modal & mereset form seperti
     perilaku lama (efeknya seharusnya sama, cuma sekarang dipicu klik
     eksplisit, bukan `setTimeout`).
9. **Jalankan migration `016_admin_user_management.sql`,
   `017_profiles_email.sql`, `018_pengaturan_supervisor_access.sql`, dan
   `020_profiles_update_admin_lock.sql` ke Supabase production — SEMUANYA,
   berurutan sesuai nomor** (⚠️ nomor migration terakhir DIGESER dari `019`
   jadi `020` di sesi #14, lihat poin 12 & entri sesi #14 di atas — kalau
   masih menyimpan referensi lama ke "019" untuk migration ini di catatan
   lain, itu sudah usang). Sampai ini dijalankan, modul Pengaturan (T-10)
   tidak akan berfungsi sama sekali di production (RPC/kolom/policy yang
   dipakai kode belum ada atau masih versi lama) — mirip situasi migration
   `013` di poin 7, tapi untuk 4 file migration sekaligus. **Jalankan juga
   `019_held_orders.sql` (T-11) di urutan yang sama** — walau secara teknis
   independen dari 4 migration T-10 ini, keduanya sama-sama menggantung
   sejak sesi #14 dan sama-sama harus beres sebelum deploy (lihat poin 14).
10. **Konfirmasi apakah 2 query SQL manual (poin 5, entri sesi #12) untuk
    naikkan role akun pemilik project dari supervisor ke admin sudah
    dijalankan.** Kalau sudah, akun itu sekarang admin — jangan asumsikan
    masih supervisor di sesi berikutnya tanpa mengecek dulu.
11. **Uji modul Pengaturan end-to-end di browser — BELUM PERNAH sama
    sekali**, baik oleh agent maupun pemilik project:
    - Login sebagai admin: cek kedua sub-tab, ubah setting toko (PPN dll),
      ubah role/status user lain (termasuk coba promosikan seseorang jadi
      admin), edit kontak, kirim reset password.
    - Login sebagai supervisor (kalau masih ada akun ber-role ini setelah
      poin 10): pastikan baris admin di tabel user benar-benar terkunci di
      UI (dropdown, tombol nonaktifkan, Edit, Reset Password semuanya
      disabled) DAN coba juga panggil `.update()`/RPC langsung lewat
      Supabase client (bukan cuma lewat UI) ke baris admin — pastikan
      benar-benar ditolak RLS (migration `020`, bukan `019` lagi — lihat
      poin 9). **Ini yang paling penting diuji**, karena tombol disabled di
      UI tidak menjamin database juga menolak kalau migration `020` belum
      dijalankan.
12. **✅ SUDAH DIKERJAKAN sesi #14 (sebelumnya poin ini berbunyi "buat ulang
    kedua file migration yang bentrok"): kedua file sudah dibuat**
    (`019_held_orders.sql` untuk T-11 bagian 1, `020_profiles_update_admin_lock.sql`
    untuk T-10, lihat entri sesi #14 di atas). **Yang TERSISA**: keduanya
    belum dijalankan ke database manapun (lihat poin 9 & 14), dan
    `019_held_orders.sql` masih berstatus REKONSTRUKSI dari kode TypeScript
    (bukan file asli yang sudah hilang) — kemungkinan ada detail kecil yang
    meleset, lihat komentar header file itu sendiri sebelum menjalankannya
    ke production.
13. **Cari tahu siapa/sesi mana yang mengerjakan T-11 bagian 1 & 3** (kalau
    memang bukan sesi lokal/luar `PROGRESS.md`, misalnya dikerjakan
    langsung oleh pemilik project sendiri di MacBook tanpa lewat sesi agent
    yang menulis catatan ini) — supaya jelas apakah ada keputusan desain
    lain dari pekerjaan itu yang juga belum tercatat, sama seperti pola
    "keputusan desain hilang" yang sudah beberapa kali kejadian di file ini
    (migration 015, T-10 dasar sebelum sesi #12). Kalau ternyata pemilik
    project sendiri yang mengerjakannya via alat lain (mis. Claude Code
    langsung di terminal/MacBook tanpa sesi yang menuliskan PROGRESS.md),
    catat itu di sini supaya polanya diketahui, bukan dianggap misteri lagi.
    **Masih berlaku sepenuhnya setelah sesi #14** — sesi #14 cuma menulis
    migration yang hilang, tidak menjawab pertanyaan siapa yang menulis
    kode T-11 asalnya.
14. **⚠️ BARU (sesi #14), PALING MENDESAK sekarang: jalankan
    `019_held_orders.sql` DAN `020_profiles_update_admin_lock.sql` ke
    Supabase production** (bisa urutan bebas relatif satu sama lain — dua
    migration ini independen, tidak saling bergantung — tapi `020` tetap
    harus SESUDAH `018`, dan `019` boleh kapan saja). **Sebelum kedua file
    ini dijalankan, JANGAN deploy frontend dari zip/repo ini ke
    production**: fitur "Tunda" di Kasir akan gagal total (tabel
    `held_orders` belum ada), dan pengaman anti-privilege-escalation T-10
    (poin 4, sesi #12) tidak benar-benar aktif di database walau kode
    frontend sudah berperilaku seolah-olah aktif. Setelah dijalankan, uji
    juga: coba fitur Tunda dari 2 akun kasir berbeda pada produk yang sama
    (pastikan validasi stok ulang saat resume bekerja, lihat komentar
    desain di `019_held_orders.sql`), dan ulangi pengujian poin 11 khusus
    untuk memastikan policy `profiles_update_admin_supervisor_locked`
    (bukan lagi `profiles_update_admin_supervisor` yang lama) yang aktif.
15. **⚠️ BARU (sesi #15) — poin 9, 11, 12, dan 14 DI ATAS SEMUANYA MERUJUK KE
    FILE `020_profiles_update_admin_lock.sql` YANG TIDAK ADA DI REPO.** Sesi
    #15 mengecek langsung isi zip project yang diserahkan: migration T-10
    masih bernama `019_profiles_update_admin_lock.sql`, dan migration T-11
    bagian 1 bernama `019_hold_orders.sql` (bukan `019_held_orders.sql`
    seperti tercatat sesi #14) — **tabrakan nomor `019` yang ditemukan sesi
    #13 BELUM SELESAI**, meski sesi #14 mencatat dirinya sudah
    menyelesaikannya. Kemungkinan besar sesi #14 memang sempat menulis file
    dengan nama `019_held_orders.sql`/`020_profiles_update_admin_lock.sql`,
    tapi yang ter-commit/ter-export ke repo yang diserahkan ke sesi
    berikutnya adalah versi SEBELUM penggeseran nomor (pola yang sama
    seperti migration `015` yang pernah hilang total, sesi #10→#11). **Sesi
    ini TIDAK memperbaiki penggeseran nomornya** (di luar scope permintaan
    sesi #15, yang fokus ke split payment) — cuma meluruskan catatan supaya
    sesi berikutnya tidak salah asumsi. **Sebelum menjalankan migration T-10
    apa pun ke production, cek dulu isi file yang benar-benar ada di repo
    saat itu** (`ls supabase/migrations | grep 019`), jangan percaya begitu
    saja ke nomor yang disebut di poin 9/11/12/14 atau di baris "Task
    selesai" untuk T-10. Kalau memang mau menuntaskan penggeseran nomor,
    ingat migration `019_hold_orders.sql` (T-11) TIDAK BOLEH ikut digeser —
    `hooks/useHoldOrders.ts` sudah 3x menyebut "migration 019" verbatim di
    komentarnya (lihat entri sesi #14 di atas) — yang perlu digeser cuma
    migration T-10-nya, jadi `019_profiles_update_admin_lock.sql` →
    `020_profiles_update_admin_lock.sql`.
16. **⚠️ BARU (sesi #15) — split payment (migration `021`) sudah dikonfirmasi
    jalan secara UMUM, tapi kombinasi spesifik berikut BELUM DIPASTIKAN
    sudah dicoba** (pemilik project cuma bilang "berjalan dengan lancar",
    tanpa rincian skenario):
    - Split 3-4 metode sekaligus dalam satu transaksi (bukan cuma 2).
    - Upload bukti untuk BANK_TRANSFER **dan** QRIS bersamaan dalam satu
      transaksi split (`handleProcessSplitPayment` di `PaymentModal.tsx`
      menempelkan bukti ke baris `payment_id` masing-masing lewat
      `uploadPaymentProofs()` — belum ada konfirmasi jalur ini teruji untuk
      > 1 baris bukti sekaligus).
    - TEMPO sebagai SALAH SATU baris split (bukan satu-satunya metode) —
      pastikan baris `payments` untuk TEMPO tetap muncul di Laporan
      Piutang (T-08, `hooks/useReports.ts`) sama seperti TEMPO tunggal,
      karena query piutang kemungkinan memfilter `method = 'TEMPO'` di
      tabel `payments` (per-baris), bukan per-transaksi — kalau begitu
      seharusnya otomatis benar, tapi belum ada yang mengecek langsung.
    - Coba juga transaksi split GAGAL sebagian (mis. jumlah baris tidak
      pas dengan total) benar-benar ditolak RPC dengan pesan yang jelas,
      bukan cuma divalidasi di client.
      Tidak menghalangi pekerjaan berikutnya, tapi jangan anggap split
      payment "100% teruji" hanya dari konfirmasi umum sesi #15 ini.

## Task berikutnya (disarankan)

- **✅ Split payment (migration `021` + wiring `KasirModule.tsx`) sudah
  SELESAI & TERKONFIRMASI JALAN sesi #15** — bukan prioritas lagi, tapi
  lihat poin 16 ("Yang HARUS dikonfirmasi") untuk kombinasi skenario yang
  belum tentu ikut teruji (split 3-4 metode, upload bukti ganda, TEMPO di
  dalam split, dst).
- **Prioritas TERTINGGI sekarang: BERESKAN tabrakan nomor migration `019`
  (poin 15, "Yang HARUS dikonfirmasi", BARU sesi #15) SEBELUM menjalankan
  migration T-10 apa pun.** Sesi #14 mencatat dirinya sudah menggeser
  migration T-10 jadi `020_profiles_update_admin_lock.sql` supaya tidak
  bentrok dengan `019_hold_orders.sql` (T-11) — **tapi itu TIDAK BENAR
  untuk repo yang ada sekarang**, kedua file masih sama-sama bernomor
  `019`. Cek dulu `ls supabase/migrations | grep 019` di awal sesi
  berikutnya, JANGAN percaya begitu saja ke nomor `020` yang disebut di
  beberapa tempat lain di file ini (poin 9/11/12/14 "Yang HARUS
  dikonfirmasi", dan baris "Task selesai" T-10) — semuanya sudah usang
  menurut temuan sesi #15. Migration `019_hold_orders.sql` (T-11) TIDAK
  BOLEH ikut digeser (`hooks/useHoldOrders.ts` sudah hardcode "migration
  019" di komentarnya) — yang perlu digeser cuma migration T-10-nya jadi
  `020_profiles_update_admin_lock.sql`, BARU dijalankan ke production
  sesudah `019_hold_orders.sql`/`018` (urutan bebas relatif satu sama lain
  seperti dicatat sesi #14, tapi `020` tetap harus SESUDAH `018`).
- Setelah nomor migration-nya benar-benar beres & dijalankan: jalankan juga
  `016`–`018` kalau memang belum (poin 9, "Yang HARUS dikonfirmasi") DAN uji
  modul Pengaturan end-to-end di browser (poin 11), **DAN uji fitur Tunda +
  scan barcode kamera di Kasir end-to-end** (poin 14 — skenario minimal yang
  harus dicoba sudah disebutkan di poin itu). Setelah itu, konfirmasi juga
  apakah role akun pemilik project sudah dinaikkan ke admin (poin 10) supaya
  sesi berikutnya tidak salah asumsi soal role akun yang dipakai testing.
- **Migration `013` (sesi #9, field HP customer) MASIH belum dikonfirmasi
  jalan** — sudah menggantung sejak sesi #9, disebutkan lagi di sesi
  #10/#11, dan sesi #12/#13/#14/#15 TIDAK menambah info baru soal ini.
  Jangan lupakan ini hanya karena perhatian sekarang tertuju ke T-10/T-11 —
  lihat poin 7 di "Yang HARUS dikonfirmasi".
- Setelah checklist verifikasi T-10/T-11 & migration lama beres: **T-10
  adalah task terakhir yang tercantum eksplisit di ALUR UTAMA PRD §17**, dan
  T-11 (Fase G/"setelah MVP stabil") sekarang **kodenya sudah lengkap
  ketiga bagiannya** (hold order, barcode, split payment) — tinggal
  verifikasi browser + beres-beres migration di atas. Kalau semua itu sudah
  beres, cek PRD §17 langsung untuk task/fase berikutnya (T-12 FCM/cron/PWA
  atau T-13 backup/offline, keduanya belum ada jejak kode sama sekali per
  sesi #13) — jangan asumsikan urutan dari file ini saja, PROGRESS.md
  beberapa kali terbukti basi soal ini (lihat catatan "PROGRESS.md basi" di
  beberapa sesi, termasuk sesi #12, dan dua kali salah catat migration `019`
  di sesi #13 & #15).
- Beres-beres lint pra-eksisting (13 error dari sesi #8, salah satunya di
  `TransactionDetailModal.tsx` — sudah tercatat sejak poin 4/"Yang HARUS
  dikonfirmasi" #2 di histori sesi #8, TIDAK bertambah karena perubahan sesi
  #9 maupun #12; 1 error TAMBAHAN pra-eksisting juga ada di
  `PaymentModal.tsx` per sesi #9 — lihat poin 5 di entri sesi #9; sesi #13
  mencatat jumlah totalnya sudah berubah jadi 17 error/8 warning karena
  file-file baru, tapi pola errornya sama, bukan regresi) — bukan blocker,
  tapi bikin `npm run lint` tidak bisa dipakai sebagai sinyal "ada regresi
  baru" selama masih penuh dengan error lama yang bercampur.

## Catatan penting untuk sesi berikutnya

**File yang dibuat sesi #14 (lihat entri sesi #14 di atas untuk detail
lengkap) — BELUM SATU PUN dijalankan ke database manapun:**

- `supabase/migrations/019_held_orders.sql` — **baru, rekonstruksi.** Tabel
  `held_orders` + RLS select/insert/delete milik-sendiri, untuk T-11 bagian
  1 (Hold Order/"Tunda"). Nomor `019` dipertahankan karena sudah di-hardcode
  di komentar `hooks/useHoldOrders.ts`.
- `supabase/migrations/020_profiles_update_admin_lock.sql` — **baru**,
  penomoran ulang dari yang sebelumnya disebut "019" di catatan sesi #12
  (lihat Catatan sesi #12 di bawah — nama file YANG SEBENARNYA DIBUAT sesi
  #14 beda dari yang disebut sesi #12, karena sesi #12 sendiri TIDAK PERNAH
  benar-benar menuliskan file-nya ke repo, cuma menulis rencana isinya di
  `PROGRESS.md`. Isi SQL-nya sama persis dengan rencana sesi #12, cuma nama
  filenya baru resmi ada sekarang dengan nomor yang benar).

**File yang dibuat/diubah sesi #12:**

- `app/components/layout/Sidebar.tsx` — menu "Pengaturan" (grup
  "Administrasi") `roles` diganti `["admin"]` → `["admin", "supervisor"]`
  (lihat poin 1, entri sesi #12).
- `app/components/pengaturan/PengaturanModule.tsx` — gate akses
  `canAccessSettings` diganti admin-only → admin+supervisor, pesan "Akses
  Ditolak" disesuaikan (lihat poin 2).
- `app/components/pengaturan/PengaturanAdminTab.tsx` — pengaman UI untuk
  baris admin kalau pemanggil supervisor: dropdown role, tombol nonaktifkan,
  Edit, dan Reset Password semuanya `disabled` + tooltip; opsi "Admin"
  disembunyikan dari dropdown role untuk supervisor lewat fungsi baru
  `getRoleOptionsFor()` (lihat poin 3).
- ⚠️ Sesi #12 MENGAKU sudah membuat `supabase/migrations/019_profiles_update_admin_lock.sql`
  (poin 4) — **tapi file itu TIDAK ADA di repo/zip yang diaudit sesi #13**
  (lihat Temuan 1). Isinya baru benar-benar ditulis ke repo sesi #14, DENGAN
  nomor berbeda (`020`, bukan `019` — lihat "File yang dibuat sesi #14" di
  atas), karena nomor `019` ternyata sudah dipakai kode T-11 untuk keperluan
  lain. Jangan cari file bernama persis `019_profiles_update_admin_lock.sql`
  di repo — yang ada sekarang namanya `020_profiles_update_admin_lock.sql`.
- Tidak ada perubahan ke `hooks/useAdminUsers.ts`, `PengaturanTokoTab.tsx`,
  migration `016`/`017`/`018` — semuanya dari sesi sebelumnya (yang tidak
  sempat menulis PROGRESS.md, lihat peringatan di entri sesi #12 di atas)
  dan sudah benar dari awal, sesi ini murni menyambung yang kurang.

**File yang dibuat/diubah sesi #9:**

- `supabase/migrations/013_transaction_customer_phone.sql` — **baru**.
  Parameter `p_customer_phone` di RPC `create_transaction` (lihat poin 1,
  entri sesi #9 di atas). **BELUM DIEKSEKUSI ke production.**
- `lib/pos/transactionApi.ts` — `CreateTransactionParams.customerPhone` +
  dikirim sebagai `p_customer_phone` ke RPC (lihat poin 2).
- `app/components/kasir/PaymentModal.tsx` — field No. HP opsional (semua
  metode), layar sukses dirombak dengan tombol "Kirim Struk via WhatsApp" +
  "Transaksi Baru" menggantikan auto-close `setTimeout` (lihat poin 3).
- `app/components/kasir/KasirModule.tsx` — state `lastReceipt`/
  `lastCustomerPhone`, handler `handleSendWhatsApp()`, prop `onSendWhatsApp`
  ke `PaymentModal` (lihat poin 4).

**File yang dibuat/diubah sesi #8:**

- `app/components/layout/Sidebar.tsx` — diganti pemilik project (grup menu
  "Laporan", key `laporan`).
- `app/page.tsx` — dynamic import `LaporanModule` + render
  `activeMenu === "laporan"`.
- `lib/pos/reportExport.ts` — **baru**. `exportReportToExcel()` +
  `exportReportToPdf()` (lihat poin 5).
- `app/components/laporan/LaporanModule.tsx` — tombol Export disambungkan ke
  `reportExport.ts` (lihat poin 6).
- `lib/pos/printLogic.ts` — ditambah `generateReceiptImage()` +
  `shareReceiptViaWhatsApp()` (lihat poin 8). Fungsi lama
  (`printThermalReceipt`/`printA6Nota`) TIDAK diubah.
- `app/components/transaksi/TransactionDetailModal.tsx` — tombol "Kirim WA"
  baru + `handleReprint()` di-refactor jadi pakai `buildReceiptData()` (lihat
  poin 9).
- Tidak ada migration baru sesi ini — `011` dan `012` sudah ada sebagai file
  dari sesi sebelumnya, sesi ini hanya mengonfirmasi keduanya sudah dieksekusi
  ke production.

Detail lengkap T-07 (RPC `get_transaction_by_receipt`, keputusan desain,
utang teknis) dipindah ke histori sesi diciutkan di bawah — sudah tidak
menjadi task aktif sejak RLS `011` menyusul dan diverifikasi.

## Bug ditemukan (BELUM diperbaiki, bukan blocker) — baris Retur tidak punya rincian item

Saat pemilik project cek fitur Retur: RPC `return_transaction` (migration `004`,
dibuat sebelum sesi T-01) membuat baris transaksi baru berstatus `RETURN` (nomor
`LCO-RTR/...`) untuk tiap retur, tapi **tidak pernah insert baris ke
`transaction_items` untuk transaksi retur itu sendiri** — cuma nominal refund
yang tersimpan. Akibatnya di modal detail, baris Retur cuma tampil total uang
tanpa daftar barang. Halaman `/cek-struk` (T-07) mewarisi keterbatasan yang
sama kalau pelanggan mencari langsung nomor `LCO-RTR/...`.

Info barang yang diretur **sebenarnya tetap ada** — tersimpan sebagai
`returned_qty` di `transaction_items` milik transaksi ASLI, dan sudah tampil
di UI sebagai label "X sudah diretur" per item.

**Belum diperbaiki atas keputusan pemilik project** (dikonfirmasi langsung) —
kalau mau dikerjakan nanti: RPC `return_transaction` perlu insert baris
`transaction_items` untuk `v_return_id` juga; **kalau ini dikerjakan,
`hooks/useDashboard.ts` DAN `hooks/useReports.ts` (T-08, filter item yang sama)
WAJIB ikut disesuaikan** supaya item terjual tidak terhitung ganda.

<details>
<summary>Detail T-07 (Halaman publik <code>/cek-struk</code>) — diciutkan, sudah bukan task aktif</summary>

**File yang dibuat/diubah:**

- `supabase/migrations/010_public_receipt_lookup.sql` — **baru**. RPC
  `get_transaction_by_receipt(p_receipt_no text, p_date date) returns jsonb`,
  `SECURITY DEFINER`. Tidak menambah policy `anon select` apapun di tabel
  manapun. `revoke all` dari `public` lalu `grant execute` eksplisit hanya ke
  `anon, authenticated` supaya tidak ada hak lain yang ikut menempel ke role
  lain secara tidak sengaja.
- `app/cek-struk/page.tsx` — **baru**. Halaman client component berdiri
  sendiri (tidak pakai `hooks/useAuth` atau komponen modul internal manapun).
  Satu-satunya sumber data adalah RPC di atas lewat `createClient()` dari
  `@/lib/supabase/client` (sesuai Aturan Main §18.4).
- Tidak ada perubahan di `middleware.ts` — sudah lebih dulu mengizinkan
  `/cek-struk` di `PUBLIC_PATHS`.

**Definition of Done T-07 — status:**

- [x] Struk asli bisa diverifikasi publik — form nomor struk + tanggal →
      RPC → tampil status & rincian.
- [x] "anon tidak bisa lihat data lain (cek dengan RLS)" — migration `011`
      sudah jalan di production. **Pengujian end-to-end-nya sendiri belum
      dikonfirmasi** — lihat poin 3 di "Yang HARUS dikonfirmasi" di atas.

**Keputusan yang diambil sesi T-07:**

- **Kunci pencarian: nomor struk + tanggal, bukan nomor struk saja.** Format
  nomor struk berurutan (`LCO-STR/26/09/000123`), jadi tanpa pasangan tanggal
  orang bisa mencoba nomor urut satu-satu (enumerasi). Dua kunci membuat
  brute-force tidak praktis untuk pemakaian normal.
- **Pesan gagal generik untuk kedua kasus gagal** (nomor salah ATAUPUN nomor
  benar tapi tanggal salah): "Struk tidak ditemukan...". Kalau pesannya beda,
  itu sendiri jadi celah untuk menebak nomor struk yang valid satu per satu
  (timing/response-based enumeration).
- **Field yang dikembalikan RPC sengaja TIDAK menyertakan** `cost_price`
  (PRD §4.9 eksplisit "tanpa harga modal" — dan sebenarnya amannya lebih
  tinggi dari itu: `transaction_items` memang tidak pernah menyimpan
  `cost_price` sama sekali, cuma snapshot `unit_price` jual, jadi tidak ada
  kolom harga modal yang bisa "kebocoran" dari tabel manapun), `cashier_name`,
  `customer_phone`, atau rincian pembayaran (nomor referensi transfer, bukti
  foto). Yang dikembalikan hanya metode pembayarannya (label CASH/TRANSFER/
  QRIS/TEMPO), bukan detailnya.
- **Perbandingan tanggal pakai `(created_at AT TIME ZONE 'Asia/Jakarta')::date`,
  bukan `::date` mentah dari timestamptz UTC.** Pola sama persis dengan
  `dateKey()` di `hooks/useDashboard.ts` (T-06): di WIB (UTC+7), transaksi jam
  00:00–07:00 akan salah tanggal kalau dibaca sebagai UTC.
- **Status "Sudah Diretur (Sebagian/Penuh)" dibedakan dari "Nota Retur" di
  UI**, walau keduanya sama-sama status `RETURN` di database. Dibedakan lewat
  `is_return_row` (`related_transaction_id IS NOT NULL` = baris retur itu
  sendiri, nomor `LCO-RTR/...`; `NULL` = transaksi asli yang sudah diretur).
  Tanpa ini pelanggan bisa bingung membaca badge status.
- **RPC dipanggil lewat `supabase.rpc()` di client component biasa** (bukan
  API route Next.js) — konsisten dengan pola RPC lain di codebase ini
  (`create_transaction`, `close_shift`, `adjust_stock`, dst. semuanya dipanggil
  langsung dari hook/komponen client, bukan lewat `/api/*`).

**Utang teknis / hal yang SENGAJA belum dikerjakan di T-07:**

- **Tidak ada rate limiting di level aplikasi untuk RPC ini.** Supabase punya
  rate limit bawaan di level project, tapi tidak ada throttle tambahan
  khusus endpoint ini (mis. per-IP). Kombinasi nomor struk + tanggal sudah
  membuat brute-force tidak praktis untuk penyerang biasa, tapi ini bukan
  jaminan matematis terhadap penyerang yang sabar/terdistribusi. Dicatat
  sebagai kemungkinan pengerjaan lanjutan, bukan blocker fase 1.
- **Tidak ada tombol cetak/unduh struk dari halaman publik ini** — PRD §4.9
  hanya minta "tampil status & rincian", bukan cetak ulang. Kalau nanti
  diminta, bisa reuse `lib/pos/printLogic.ts` (`printA6Nota()`), tapi perlu
  dicek dulu apakah fungsi itu mengasumsikan ada sesi login (kemungkinan
  tidak, tapi belum diverifikasi).
- **Tidak ada link balik ke halaman ini dari struk/nota yang dicetak
  kasir** (mis. QR code atau URL tercetak di footer). Bisa jadi penambahan
  kecil di `printLogic.ts`, tapi di luar scope T-07 seperti ditulis di PRD.

**Belum diperbaiki, bukan blocker (sesi #7):**

- Tidak ada bug baru ditemukan di modul lama saat mengerjakan T-07, di luar
  temuan keamanan RLS (sudah diperbaiki migration `011`, lihat bagian atas).

</details>

---

<details>
<summary>Riwayat sesi sebelumnya (T-01 s/d T-06) — diciutkan, lihat histori git kalau butuh detail lengkap</summary>

**T-06 (selesai):** Dashboard asli. `hooks/useDashboard.ts` (agregat
`today`/`month`/`daily`/`categories`/`actions`) + tulis ulang total
`DashboardModule.tsx` (sebelumnya stub 457 byte). Keputusan kunci: omzet
dihitung dari status `PAID` **dan** `RETURN` (baris retur bernilai negatif,
menjumlahkan keduanya menghasilkan omzet bersih yang benar — kalau difilter
`PAID` saja, retur sebagian akan menghapus seluruh omzet transaksi aslinya).
Jumlah transaksi hanya menghitung baris penjualan (`related_transaction_id
IS NULL`). Agregasi di client (bukan RPC) — volume toko masih kecil, dan ini
ringkasan read-only, bukan uang yang ditulis/dikunci. Semua pengelompokan
tanggal pakai waktu lokal WIB lewat helper `dateKey()`, bukan
`toISOString()`. Utang teknis: piutang TEMPO belum ada penanda lunas (scope
T-08); `returned_qty` menempel di tanggal transaksi asli, bukan tanggal
retur.

**T-05 (selesai):** Mutasi stok & opname. Migration `009_stock_movements.sql`
**bukan bikin tabel baru** — mengeraskan tabel `stock_movements` yang ternyata
sudah ada dari `scripts/setup-database.sql` dalam versi polos (tanpa RLS sama
sekali — celah keamanan yang baru ditutup sesi itu). Isinya: check constraint
`type`, alasan wajib untuk opname/adjustment, index, RLS `select`-only untuk
admin/supervisor **tanpa policy insert/update/delete sama sekali** (semua tulisan
wajib lewat RPC `security definer`), RPC baru `adjust_stock`, dan
`create_transaction` di-`CREATE OR REPLACE` supaya menulis mutasi `'sale'`.
Keputusan kunci: **tidak pakai trigger** di `products` (retur/void akan tercatat
dua kali karena RPC-nya sudah menulis sendiri); polanya "setiap RPC yang mengubah
`products.stock` WAJIB sekalian menulis `stock_movements` dalam transaksi DB yang
sama". Catatan jujur: stok absolut ≠ akumulasi mutasi, karena stok awal produk
tidak punya baris mutasi pembuka (rumus benar: `stok awal + SUM(qty_delta)`).

**⚠️ TEMUAN T-05 yang masih relevan:** PRD §15.4 menulis "tabel `stock_movements`
belum ada" — **itu tidak akurat**. Pelajaran umumnya: **jangan percaya §15 PRD
begitu saja, verifikasi ke database dulu.** (Pelajaran yang sama berlaku lagi di
T-07: PRD §17 T-07 menulis "middleware sudah mengizinkan route ini" — kali ini
**benar**, sudah diverifikasi langsung baca `middleware.ts`, bukan diasumsikan.)

**T-04 (selesai):** Shift kasir. Migration `007_shift_sessions.sql` (unique
partial index supaya satu shift aktif per kasir ditegakkan DI DATABASE, bukan
cuma UI) + `008_shift_close_rpc.sql` (RPC `close_shift`; `expected_cash` dihitung
server-side supaya kasir tidak bisa mengirim angka palsu untuk menutupi selisih
kas — kasir hanya mengirim `actual_cash` hasil hitung pecahan). Buka shift TIDAK
pakai RPC (insert langsung sudah aman, dijaga RLS + unique index).
RLS `shift_sessions`: admin/supervisor bisa SELECT + UPDATE semua shift,
disiapkan untuk force-close, walau UI-nya belum dibuat.
Sengaja tidak dikerjakan: setoran ke bank (`cash_movements` belum ada tabelnya),
cetak laporan shift A6/PDF, monitoring realtime antar-kasir.

**T-03 (selesai):** Nota A6/A5 via iframe tersembunyi, pilihan format cetak di
modal pembayaran, dropdown cetak ulang di riwayat transaksi.

**T-02 (selesai):** 4 metode pembayaran end-to-end (CASH/BANK_TRANSFER/QRIS/TEMPO),
migration `006_payment_enhance.sql` (enum `payment_method` diperbaiki, `due_date`,
tabel `payment_proofs` multi-file + Storage bucket), badge "Piutang" di riwayat.

**T-01 (selesai):** Tabel `settings` key-value + `hooks/useSettings.ts`, breakdown
PPN di keranjang/PaymentModal/struk mengikuti `ppn_enabled`/`ppn_rate`.

**⚠️ Temuan T-01 (sudah diperbaiki):** Database production ternyata dibuat lewat
`scripts/setup-database.sql`, BUKAN rantai migration — migration `001`, `003`,
`004` belum pernah jalan (sudah dieksekusi manual sesi itu), dan `profiles.id`
user pertama sempat tidak sama dengan `auth.users.id` (sudah diperbaiki, id benar:
`529a51e9-6a54-4857-b1ae-a227b76e2dde`). **Catatan masih berlaku**: kalau ada user
baru ditambahkan manual ke `profiles`, WAJIB isi `id` persis sama dengan
`auth.users.id` dari Supabase Dashboard → Authentication → Users.

**Belum diputuskan**: apakah `scripts/setup-database.sql` masih relevan dipakai
atau sebaiknya di-deprecate sekarang rantai migration sudah berjalan sampai `010`.

</details>
