# PROGRESS — LCO POS

> **Buku serah terima antar-agent.** File ini WAJIB dibaca agent saat mulai
> sesi dan WAJIB ditulis ulang saat sesi berakhir (lihat PRD v1.1 §17 & §18).
> PRD: `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — acuan task ada di §17.

## Status terakhir diperbarui

2026-09-17, sesi #5 (task T-05 selesai — Mutasi Stok & Opname: setiap perubahan
stok sekarang punya jejak audit, opname/penyesuaian manual dengan alasan wajib,
menu **Stok & Opname** tampil di sidebar).

## Task selesai

- [x] T-01 — Tabel `settings` + hook `useSettings` (migration `005_settings.sql`)
- [x] T-02 — Pembayaran lengkap per metode (transfer/qris/tempo): migration `006_payment_enhance.sql` (`due_date` di `payments`, tabel `payment_proofs` multi-file); update UI modal pembayaran dan riwayat.
- [x] T-03 — Nota A6/A5 non-thermal + pilihan format cetak per transaksi (modifikasi `lib/pos/printLogic.ts` dengan `printA6Nota()` via iframe tersembunyi, penambahan pilihan format di `PaymentModal.tsx` sesuai `print_default` dari settings, dan dropdown cetak ulang di `TransactionDetailModal.tsx`).
- [x] T-04 — Shift kasir: buka/tutup, selisih kas, wajib sebelum transaksi (migration `007_shift_sessions.sql` + `008_shift_close_rpc.sql`; `hooks/useShifts.ts`; `app/components/kas/KasModule.tsx`; wiring `app/page.tsx` + blokir layar `KasirModule.tsx`).
- [x] T-05 — Mutasi stok & opname (migration `009_stock_movements.sql`; `hooks/useStock.ts`; `app/components/stok/StokModule.tsx`; wiring `app/components/layout/Sidebar.tsx` + `app/page.tsx`).

## Sedang dikerjakan

- (tidak ada sesi aktif)

## Task berikutnya (disarankan)

- **T-06** — Dashboard asli (menggantikan stub): `hooks/useDashboard.ts` (agregat
  omzet hari ini/bulan, jumlah transaksi, rata-rata, bar 7/30 hari, pie kategori
  terlaris, action list); tulis ulang `app/components/dashboard/DashboardModule.tsx`
  mengikuti PRD §4.8 (hero tanggal-jam real-time `font-mono`, `recharts` bar + pie,
  Action List: stok menipis, piutang jatuh tempo, shift kemarin belum tutup).
- Dependensi PRD (T-04 + T-05 + T-02) sudah semua selesai — boleh langsung mulai.
- Untuk agregat "stok menipis" di Action List: `useStock.ts` belum punya fungsi
  khusus untuk itu (baru riwayat mutasi + `adjustStock`), jadi T-06 kemungkinan
  perlu query terpisah ke `products` (`stock <= min_stock`) — bukan lewat
  `stock_movements`.

## Catatan penting untuk sesi berikutnya

**File yang dibuat/diubah (T-05 — Mutasi Stok & Opname):**

- `supabase/migrations/009_stock_movements.sql` — **bukan bikin tabel baru dari
  nol**, lihat temuan penting di bawah. Isinya: hardening tabel `stock_movements`
  (kolom, komentar), check constraint `type` (sale/return/opname/adjustment/void)
  - alasan wajib untuk opname/adjustment (dipasang `NOT VALID` lalu divalidasi di
    blok yang menangkap error — migration tidak gagal kalau ada baris lama yang
    melanggar, cukup warning); index riwayat mutasi & per-produk; **RLS baru**
    (tabel ini sebelumnya SAMA SEKALI TIDAK ada RLS-nya — lihat temuan di bawah),
    hanya `SELECT` untuk admin/supervisor, tidak ada policy insert/update/delete
    sama sekali (semua tulisan wajib lewat RPC `security definer`); RPC baru
    `adjust_stock(p_product_id, p_type, p_value, p_reason)` untuk opname (p_value =
    hasil hitung fisik) & adjustment (p_value = selisih langsung); `create_transaction`
    di-`CREATE OR REPLACE` lagi untuk menulis mutasi `'sale'` (qty_delta negatif)
    di transaksi DB yang sama dengan pengurangan stok; backfill idempotent untuk
    transaksi lama yang stoknya sudah berkurang tanpa jejak mutasi.
- `hooks/useStock.ts` — baca riwayat mutasi (filter per produk/jenis, limit
  default 100) + `adjustStock()` yang memanggil RPC. Nama pembuat mutasi (`created_by_name`)
  diambil lewat query terpisah ke `profiles`, BUKAN embed PostgREST — lihat alasan
  di bagian "Keputusan yang diambil sesi ini".
- `app/components/stok/StokModule.tsx` — kartu ringkas stok masuk/keluar (dari
  data yang sedang tampil, bukan agregat total), filter chip per jenis mutasi,
  tabel riwayat (waktu/produk/jenis/qty ±/alasan/oleh), modal Opname/Penyesuaian
  (pilih jenis → cari & pilih produk → isi jumlah dengan preview stok sebelum
  submit → alasan wajib dengan tombol alasan cepat). Layar "Akses Ditolak" untuk
  role selain admin/supervisor (PRD §5) — lapis UX, yang mengikat tetap RLS + RPC.
- `app/components/layout/Sidebar.tsx` — tambah entri "Stok & Opname" (ikon
  `Boxes`) di grup "Alat Kasir", di atas "Kas & Shift".
- `app/page.tsx` — dynamic import `StokModule` + render saat `activeMenu === "stok"`.

**Definition of Done T-05 — status:**

- [x] Setiap perubahan stok (jual/retur/opname/adjustment) punya jejak di
      `stock_movements` dengan `created_by` — `sale` dari `create_transaction`
      (baru T-05), `return`/`void` sudah dari migration `004` (T-05 hanya
      mengeraskan tabel yang menampungnya), `opname`/`adjustment` dari RPC
      `adjust_stock` baru.
- [x] Opname manual menolak alasan kosong — 3 lapis: tombol "Simpan Mutasi"
      nonaktif di UI kalau alasan kosong, RPC `adjust_stock` menolak dengan
      exception, check constraint tabel `stock_movements_manual_reason_check`.
- [~] Stok fisik di produk = akumulasi mutasi — **benar untuk PERUBAHAN stok**
  (invariant ditegakkan: tidak ada jalur update `products.stock` di luar RPC
  yang sekaligus menulis `stock_movements`), tapi TIDAK berlaku mutlak untuk
  nilai absolutnya karena stok awal produk (saat produk dibuat/diimpor) tidak
  punya baris mutasi pembuka. Rumus yang benar: `stok sekarang = stok awal +
  SUM(qty_delta)`. Sudah dicatat sebagai komentar jujur di migration 009
  bagian 7 (backfill) — kalau nanti butuh rekonstruksi penuh dari nol, perlu
  mutasi `adjustment` bersaldo awal saat produk dibuat (perubahan di modul
  Produk, di luar scope T-05).

**Belum divalidasi end-to-end oleh pemilik project** (migration `009` belum
dijalankan ke database production saat file ini ditulis) — sesi berikutnya mohon
konfirmasi dulu migration ini sudah jalan (termasuk cek WARNING dari blok validasi
constraint kalau database punya baris `stock_movements` lama yang melanggar)
sebelum lanjut ke T-06.

**TEMUAN PENTING — PRD §15.4 keliru soal tabel `stock_movements`:**

PRD menulis "tabel `stock_movements` belum ada". Itu **tidak akurat** untuk
database yang sedang berjalan:

1. `scripts/setup-database.sql` (cara database production dibuat — lihat temuan
   T-01 sesi sebelumnya) sudah membuat tabel ini, versi polos: `type` TEXT tanpa
   check, **tanpa RLS sama sekali**, tanpa index.
2. Migration `004_return_and_void.sql` punya `create table if not exists` versi
   lebih ketat, tapi karena `if not exists`, di database production blok itu
   DILEWATI — yang hidup adalah versi polos dari (1).
3. RPC `return_transaction` & `void_transaction` (004) SUDAH menulis ke tabel
   ini sejak awal (`type` = 'return'/'void'). Jadi tabelnya tidak kosong saat
   migration 009 dijalankan.

Konsekuensi keamanan yang baru ditutup sesi ini: **`stock_movements` sebelumnya
bisa dibaca (dan berpotensi ditulis/dihapus) oleh siapa pun yang login**, karena
tidak ada RLS di tabel itu sejak awal. Migration 009 menutup ini dengan RLS
`select`-only untuk admin/supervisor dan tanpa policy tulis sama sekali.

**Keputusan yang diambil sesi ini:**

- Migration 009 **tidak bikin tabel baru**, tapi mengeraskan (harden) tabel yang
  sudah ada — konsisten dengan Aturan Main #7 (idempotent), sekaligus menghindari
  migration gagal karena tabel/data sudah ada duluan.
- **Tidak pakai trigger** di `products` untuk auto-catat mutasi. Kalau dipasang,
  retur/void akan tercatat DUA KALI karena RPC-nya sudah menulis sendiri. Pola
  yang dipakai: setiap RPC yang mengubah `products.stock` WAJIB sekalian menulis
  `stock_movements` dalam transaksi DB yang sama.
- **Tidak ada policy INSERT/UPDATE/DELETE** untuk `stock_movements` sama sekali.
  Semua penulisan lewat RPC `security definer` (`create_transaction`,
  `return_transaction`, `void_transaction`, `adjust_stock`) — jejak audit tidak
  bisa dipalsukan/dihapus dari client.
- Satu RPC `adjust_stock` untuk dua jenis mutasi manual (opname & adjustment),
  bukan dua RPC terpisah — jalur tulisnya identik (kunci baris produk → hitung
  stok baru → update → catat mutasi), yang beda cuma cara menerjemahkan input
  jadi `qty_delta`. Memecah jadi dua fungsi hanya menduplikasi validasi.
- Opname dengan selisih 0 (hitungan fisik cocok dengan sistem) **tetap dicatat**
  sebagai baris `qty_delta = 0` — informasi audit "produk ini sudah diopname
  tanggal sekian dan hasilnya cocok" berharga, beda dengan "tidak pernah diopname".
- `useStock.ts` mengambil `created_by_name` lewat query terpisah ke `profiles`,
  bukan embed PostgREST (`creator:profiles(...)`), karena FK `created_by` beda
  target tergantung jalur pembuatan tabel (`profiles` di setup-database.sql vs
  `auth.users` di migration 004) — embed akan patah di salah satu jalur.
- Penyembunyian menu "Stok & Opname" untuk role kasir **sengaja belum
  dikerjakan** di Sidebar — itu bagian permission matrix PRD §5 yang scope-nya
  T-10. Kasir tetap melihat menunya tapi diblokir layar "Akses Ditolak" di
  `StokModule.tsx` (lapis UX), sementara yang benar-benar mengikat tetap RLS +
  cek role di RPC `adjust_stock`.
- Produk nonaktif (`is_active = false`) tetap muncul di daftar pilihan produk
  saat opname (`useProducts({ includeInactive: true })`) — barang nonaktif tetap
  ada fisiknya di rak dan tetap perlu diopname. Beda dengan layar Kasir yang
  hanya boleh menjual produk aktif.
- Produk jasa (`is_service` / `type = 'JASA'`) dikeluarkan total dari alur T-05
  — tidak muncul di daftar pilihan opname, dan RPC `adjust_stock` menolaknya
  dengan pesan jelas kalau tetap dicoba (mis. lewat panggilan langsung).

**File yang SENGAJA belum dibuat dan alasannya:**

- Tidak ada UI "Stok Menipis" (PRD §4.1, menu terpisah dari §4.3) — bukan bagian
  T-05, kemungkinan masuk T-06 (Dashboard Action List) atau modul sendiri nanti.
- Tidak ada opname massal/import Excel untuk banyak produk sekaligus — PRD §17
  T-05 Definition of Done hanya minta "form opname/penyesuaian dengan alasan
  wajib" per produk; bulk opname tidak diminta eksplisit.
- Tidak ada perubahan permission matrix (sembunyikan menu per role di Sidebar)
  — eksplisit scope T-10, lihat catatan di atas.

## Catatan penting sesi sebelumnya (T-04 — Shift Kasir, diciutkan referensinya)

**File yang dibuat/diubah (T-04 — Shift Kasir):**

- `supabase/migrations/007_shift_sessions.sql` — tabel `shift_sessions`
  (`cashier_id`, `opening_cash`, `closed_at`, `expected_cash`, `actual_cash`,
  `difference`, `status` OPEN/CLOSED); **unique partial index** `cashier_id WHERE
status = 'OPEN'` supaya satu shift aktif per kasir ditegakkan DI DATABASE (bukan
  cuma UI); RLS (kasir baca/tulis shift sendiri, admin/supervisor baca semua +
  update semua untuk force-close); FK `transactions.shift_id -> shift_sessions.id`
  (kolom `shift_id` sendiri sudah ada dari migration 001, sekarang baru diberi FK);
  `create_transaction` di-`CREATE OR REPLACE` lagi — cari shift `OPEN` milik
  `auth.uid()`, **tolak transaksi kalau tidak ada** (pesan jelas ke kasir), isi
  `shift_id` ke transaksi.
- `supabase/migrations/008_shift_close_rpc.sql` — RPC `close_shift(p_shift_id,
p_actual_cash)`. Sengaja RPC terpisah (bukan `UPDATE` langsung dari client)
  karena `expected_cash` = agregasi `opening_cash + SUM(payments.amount WHERE
method='CASH' AND transactions.status='PAID')` — logika uang wajib dihitung
  server-side (Aturan Main #5 PRD), supaya kasir tidak bisa kirim `expected_cash`
  palsu untuk menutupi selisih kas. Kasir cuma kirim `actual_cash` (hasil hitung
  fisik pecahan). RPC mengunci `expected_cash`/`difference`/`closed_at`/`status`.
  Buka shift (`opening_cash`) TIDAK pakai RPC — insert langsung dari client sudah
  cukup aman (dijaga RLS insert + unique index).
- `hooks/useShifts.ts` — baca `activeShift` (shift `OPEN` milik user login) +
  `history` (30 shift `CLOSED` terakhir); `openShift(openingCash)` insert langsung
  (menerjemahkan error `unique_violation` Postgres jadi pesan Indonesia); `closeShift
(actualCash)` panggil RPC `close_shift`, hasil (`expected_cash`/`cash_sales`/
  `difference`) dikembalikan apa adanya dari server.
- `app/components/kas/KasModule.tsx` — kartu status shift (buka/aktif), modal Buka
  Shift (input modal awal, default dari `settings.shiftDefaultCash`), modal Tutup
  Shift (input jumlah lembar per pecahan Rupiah 100rb→100 perak → total kas fisik
  dihitung live → submit ke `closeShift` → tampil ringkasan kas seharusnya vs kas
  fisik vs selisih, warna teal/coral/mustard mengikuti pola "status = teks
  berwarna" tema LCO Flat), tabel riwayat shift.
- `app/page.tsx` — tambah grup menu sidebar "Alat Kasir" berisi "Kas & Shift"
  (render `KasModule`); `KasirModule` sekarang menerima prop `onNavigateToShift`
  untuk pindah ke menu itu dari layar blokir.
- `app/components/kasir/KasirModule.tsx` — tambah pengecekan `useShifts().activeShift`;
  kalau belum ada shift aktif (dan tidak sedang loading), SELURUH layar Kasir
  diganti layar blokir "Shift Belum Dibuka" + tombol "Buka Shift Sekarang". Ini
  cuma lapis UX — validasi yang tidak bisa dilewati tetap di RPC (lihat 007).

**Definition of Done T-04 — status:**

- [x] Kasir tidak bisa transaksi sebelum buka shift — diblokir 2 lapis: UI
      (`KasirModule.tsx` tidak render layar transaksi) dan RPC
      (`create_transaction` menolak dengan exception kalau tidak ada shift `OPEN`).
- [x] Tutup shift menghitung selisih dari pecahan — `CloseShiftModal` di
      `KasModule.tsx` (input pecahan → total kas fisik) dikirim ke RPC
      `close_shift`, selisih dihitung & dikunci di server.
- [x] `shift_id` terisi di transaksi — RPC `create_transaction` sekarang
      meng-insert `shift_id` hasil pencarian shift aktif kasir.
- [x] Hanya 1 shift aktif per kasir — ditolak DI DATABASE lewat unique partial
      index `shift_sessions_one_open_per_cashier`, bukan cuma dicek di UI/hook.

**Belum divalidasi end-to-end oleh pemilik project** (migration `007` & `008`
belum dijalankan ke database production saat file ini ditulis) — sesi berikutnya
mohon konfirmasi dulu bahwa kedua migration sudah dieksekusi sebelum lanjut ke
T-05, supaya kalau ada error runtime dari T-04 (mis. FK `transactions_shift_id_fkey`
bentrok dengan data lama yang shift_id-nya sudah terisi tapi tidak valid) bisa
ketahuan lebih awal, bukan tercampur dengan pekerjaan T-05.

**Keputusan yang diambil sesi ini:**

- `status` di `shift_sessions` pakai `text + check` (bukan enum Postgres baru),
  konsisten dengan pola `transactions.status` yang juga `text`.
- RLS `shift_sessions`: admin/supervisor bisa SELECT + UPDATE semua shift (bukan
  cuma milik sendiri) — disiapkan untuk force-close shift yang lupa ditutup dan
  untuk fitur monitoring admin di §4.6, walau UI monitoring-nya sendiri belum
  dibuat (itu bagian dashboard/laporan, T-06/T-08).
- Setoran ke bank (`cash_movements`) **sengaja tidak dikerjakan** — eksplisit
  "Jangan dulu" di PRD §17 T-04. Tabel `cash_movements` dari skema §6 belum ada
  sama sekali, menyusul kalau task setoran dikerjakan.
- Cetak laporan shift A6/PDF (disebut di §4.6) **sengaja tidak dikerjakan** — di
  luar Definition of Done T-04. Kalau dikerjakan nanti, reuse pola
  `printA6Nota()` di `lib/pos/printLogic.ts` (sudah ada dari T-03).
- Monitoring realtime semua shift kasir lain oleh admin **sengaja tidak
  dikerjakan** — eksplisit fase 1.1 di PRD §17 T-04 "Jangan dulu".

**File yang SENGAJA belum dibuat dan alasannya:**

- Tidak ada tabel `cash_movements` — scope setoran kas, "Jangan dulu" di T-04.
- Tidak ada UI admin untuk melihat/force-close shift kasir lain — RLS-nya sudah
  disiapkan (lihat di atas), tapi komponennya menyusul di Laporan (T-08) atau
  Dashboard (T-06), bukan scope KasModule.tsx.

## Bug ditemukan (BELUM diperbaiki, bukan blocker) — baris Retur tidak punya rincian item

Saat pemilik project cek fitur Retur: RPC `return_transaction` (migration `004`,
dibuat sebelum sesi T-01) membuat baris transaksi baru berstatus `RETURN` (nomor
`LCO-RTR/...`) untuk tiap retur, tapi **tidak pernah insert baris ke
`transaction_items` untuk transaksi retur itu sendiri** — cuma nominal refund
yang tersimpan. Akibatnya di modal detail, baris Retur cuma tampil total uang
tanpa daftar barang.

Info barang yang diretur **sebenarnya tetap ada** — tersimpan sebagai
`returned_qty` di `transaction_items` milik transaksi ASLI (bukan baris Retur),
dan sudah tampil di UI sebagai label "X sudah diretur" per item saat buka detail
transaksi asli. Jadi bukan data hilang, cuma baris Retur-nya sendiri tidak
"self-contained".

**Belum diperbaiki atas keputusan pemilik project** (dikonfirmasi langsung, bukan
diabaikan begitu saja) — kalau mau dikerjakan nanti: RPC `return_transaction`
perlu insert baris `transaction_items` untuk `v_return_id` juga, lalu
`TransactionDetailModal.tsx` otomatis akan menampilkannya karena sudah pakai
`detail.items` apa adanya.

**Belum diperbaiki, bukan blocker:**

- Tidak ada bug baru ditemukan di modul lama saat mengerjakan T-04.

---

<details>
<summary>Riwayat sesi sebelumnya (T-01 s/d T-03) — diciutkan, lihat histori git kalau butuh detail lengkap</summary>

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
atau sebaiknya di-deprecate sekarang rantai migration sudah berjalan sampai `008`.

</details>
