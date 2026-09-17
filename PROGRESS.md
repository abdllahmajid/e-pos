# PROGRESS — LCO POS

> **Buku serah terima antar-agent.** File ini WAJIB dibaca agent saat mulai
> sesi dan WAJIB ditulis ulang saat sesi berakhir (lihat PRD v1.1 §17 & §18).
> PRD: `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — acuan task ada di §17.

## Status terakhir diperbarui

2026-09-17, sesi #4 (task T-04 selesai — Shift Kasir: buka/tutup shift, hitung
pecahan uang → selisih kas otomatis dari RPC, satu shift aktif per kasir ditegakkan
di database, layar Kasir terkunci total sampai kasir buka shift).

## Task selesai

- [x] T-01 — Tabel `settings` + hook `useSettings` (migration `005_settings.sql`)
- [x] T-02 — Pembayaran lengkap per metode (transfer/qris/tempo): migration `006_payment_enhance.sql` (`due_date` di `payments`, tabel `payment_proofs` multi-file); update UI modal pembayaran dan riwayat.
- [x] T-03 — Nota A6/A5 non-thermal + pilihan format cetak per transaksi (modifikasi `lib/pos/printLogic.ts` dengan `printA6Nota()` via iframe tersembunyi, penambahan pilihan format di `PaymentModal.tsx` sesuai `print_default` dari settings, dan dropdown cetak ulang di `TransactionDetailModal.tsx`).
- [x] T-04 — Shift kasir: buka/tutup, selisih kas, wajib sebelum transaksi (migration `007_shift_sessions.sql` + `008_shift_close_rpc.sql`; `hooks/useShifts.ts`; `app/components/kas/KasModule.tsx`; wiring `app/page.tsx` + blokir layar `KasirModule.tsx`).

## Sedang dikerjakan

- (tidak ada sesi aktif)

## Task berikutnya (disarankan)

- **T-05** — Mutasi stok & opname (`stock_movements`): migration `009_stock_movements.sql`
  (tabel sesuai §6: `type` sale/return/opname/adjustment, `qty_delta`, `reference_id`,
  `reason` wajib untuk manual, `created_by`; RLS); `hooks/useStock.ts`; menu **Stok &
  Opname** di sidebar + komponen (`app/components/stok/`) — riwayat mutasi, form
  opname/penyesuaian dengan alasan wajib.
- Pastikan RPC `create_transaction` (003→006→007) dan `return_transaction` (004) juga
  ditambah untuk menulis baris `stock_movements` (bisa jadi migration terpisah kalau
  belum masuk ke `009`, sesuai saran PRD §17 T-05 — "buat migration
  `009_stock_movements_backfill_trigger.sql` kalau belum").
- Boleh mulai dikerjakan; dependensi (T-04) sudah selesai.

## Catatan penting untuk sesi berikutnya

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
