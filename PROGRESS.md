# PROGRESS — LCO POS

> **Buku serah terima antar-agent.** File ini WAJIB dibaca agent saat mulai
> sesi dan WAJIB ditulis ulang saat sesi berakhir (lihat PRD v1.1 §17 & §18).
> PRD: `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — acuan task ada di §17.

## Status terakhir diperbarui

2026-09-17, sesi #3 (task T-03 selesai & tervalidasi — fungsi cetak Nota A6/A5 via _iframe_ tersembunyi sudah aktif; pilihan format cetak struk/nota di modal pembayaran serta dropdown cetak ulang di riwayat transaksi berjalan sempurna).

## Task selesai

- [x] T-01 — Tabel `settings` + hook `useSettings` (migration `005_settings.sql`)
- [x] T-02 — Pembayaran lengkap per metode (transfer/qris/tempo): migration `006_payment_enhance.sql` (`due_date` di `payments`, tabel `payment_proofs` multi-file); update UI modal pembayaran dan riwayat.
- [x] T-03 — Nota A6/A5 non-thermal + pilihan format cetak per transaksi (modifikasi `lib/pos/printLogic.ts` dengan `printA6Nota()` via iframe tersembunyi, penambahan pilihan format di `PaymentModal.tsx` sesuai `print_default` dari settings, dan dropdown cetak ulang di `TransactionDetailModal.tsx`).

## Sedang dikerjakan

- (tidak ada sesi aktif)

## Task berikutnya (disarankan)

- **T-04** — Shift kasir: buka/tutup, selisih kas, wajib sebelum transaksi (migration `007_shift_sessions.sql`). Boleh mulai dikerjakan.
- Pastikan RPC `create_transaction` siap di-update untuk menyertakan validasi `shift_id` sesuai syarat T-04 di PRD.

## Catatan penting untuk sesi berikutnya

**File yang dibuat/diubah (Tambahan T-03):**

- `lib/pos/printLogic.ts` — Penambahan fungsi `printA6Nota` untuk menangani printer dokumen biasa via kertas A6 atau A5 tanpa `@media print` di halaman global.
- `app/components/kasir/KasirModule.tsx` — `handleConfirmPayment` sekarang membawa prop `printFormat` untuk menentukan fungsi cetak mana yang akan dipanggil.
- `app/components/kasir/PaymentModal.tsx` — Penambahan pilihan tombol format cetak di UI modal pembayaran (dengan atribut `type="button"` yang benar agar tidak mentrigger _submit_ form).
- `app/components/transaksi/TransactionDetailModal.tsx` — Mengubah tombol tunggal "Cetak Ulang Struk" menjadi menu dropdown interaktif yang mendukung pencetakan "Struk Thermal" maupun "Nota Kertas".

**Definition of Done T-03 — status:**

- [x] Satu transaksi bisa dicetak dalam format Thermal atau Nota A6/A5.
- [x] Pilihan default mengikuti `posSettings.printDefault` dari database.
- [x] Fungsi cetak menggunakan _iframe_ tersembunyi sehingga tampilan global tidak terganggu.
- [x] Riwayat bisa mencetak ulang bukti dalam kedua format tersebut.

**File yang dibuat/diubah (Tambahan T-02):**

- `supabase/migrations/006_payment_enhance.sql` — Menambah enum `BANK_TRANSFER`, `TEMPO`, kolom `due_date`, tabel `payment_proofs` multi-file, Storage bucket `payment-proofs`, dan RLS.
- `lib/pos/transactionApi.ts` — Validasi `TEMPO`, sinkronisasi tipe `PaymentMethod`, fungsi `uploadPaymentProofs`.
- `app/components/kasir/PaymentModal.tsx` & `KasirModule.tsx` — UI 4 metode pembayaran, input `TEMPO`, dan handling await RPC.
- `app/components/transaksi/TransactionDetailModal.tsx` — Galeri grid untuk merender file bukti pembayaran dari Storage & display `due_date`.
- `app/components/transaksi/TransactionHistoryModule.tsx` — Label badge "Piutang" untuk transaksi metode `TEMPO`.

**Definition of Done T-02 — status:**

- [x] Bisa checkout 4 metode end-to-end.
- [x] Bukti transfer tersimpan di Storage & metadata masuk `payment_proofs`. Tampil di `TransactionDetailModal`.
- [x] Transaksi TEMPO wajib input nama pelanggan & tanggal jatuh tempo, dan muncul dengan label piutang di riwayat.

**File yang dibuat (T-01):**

- `supabase/migrations/005_settings.sql` — tabel `settings` (key-value, `value jsonb`),
  RLS (SELECT: semua user aktif; INSERT/UPDATE/DELETE: admin only), seed 12 key
  persis sesuai PRD §17 T-01 (`nama_toko`, `alamat`, `telepon`, `footer_struk`,
  `ppn_enabled`, `ppn_rate`, `rounding`, `shift_default_cash`, `print_default`,
  `paper_nota`, `paper_thermal`, `show_cost_price`). Idempotent (`if not exists`,
  `on conflict do nothing`, `drop policy if exists`).
- `hooks/useSettings.ts` — fetch semua baris `settings`, parse ke objek `Settings`
  (camelCase, typed), fallback ke `DEFAULT_SETTINGS` kalau fetch gagal/belum selesai
  (supaya Kasir tidak pernah crash), plus `updateSetting()` untuk dipakai T-10 nanti
  (ditolak RLS kalau bukan admin).

**File yang diubah (supaya DoD T-01 benar-benar terpenuhi, bukan cuma tabel+hook nganggur):**

- `app/components/kasir/KasirModule.tsx` — `tax` sekarang dihitung dari
  `settings.ppnEnabled`/`settings.ppnRate` (sebelumnya hardcode `0`); baris
  "Pajak (PPN x%)" ditambahkan di ringkasan keranjang (tampil hanya kalau `tax > 0`);
  `subtotal` & `tax` diteruskan ke `PaymentModal`.
- `app/components/kasir/PaymentModal.tsx` — props baru `subtotal` & `tax` (wajib,
  bukan optional — cuma 1 pemanggil yaitu KasirModule); breakdown Subtotal/Pajak
  ditampilkan di atas "Total Tagihan", baris Pajak cuma render kalau `tax > 0`.
- `lib/pos/printLogic.ts` **TIDAK diubah** — `printThermalReceipt()` sudah lebih
  dulu punya logic `tax > 0 ? tampilkan baris Pajak : sembunyikan`, jadi begitu
  `tax` yang dikirim dari KasirModule bukan lagi selalu `0`, struk otomatis ikut benar.
- `lib/pos/transactionApi.ts` **TIDAK diubah** — sudah menerima & meneruskan
  `tax` ke RPC `create_transaction` (`p_tax`), tidak ada perubahan dibutuhkan.

**Definition of Done T-01 — status:**

- [x] Setting terbaca di client (`useSettings`, fallback aman kalau gagal).
- [x] Mengubah `ppn_enabled` di database langsung memengaruhi baris pajak di
      PaymentModal (breakdown Subtotal/Pajak/Total) dan struk (`printThermalReceipt`),
      serta di ringkasan keranjang.
- [x] **Sudah divalidasi end-to-end oleh pemilik project** — transaksi berhasil
      tersimpan setelah masalah data di bawah ini diperbaiki.

## ⚠️ Temuan penting sesi ini: migration & data tidak konsisten (BUKAN dari T-01)

Saat verifikasi T-01, ketahuan database production **tidak dibuat lewat rantai
migration** `001`→`004`, melainkan (sepertinya) lewat `scripts/setup-database.sql`
(skrip setup master lama) secara langsung. Akibatnya:

1. **Migration `001`, `003`, `004` belum pernah jalan** — fungsi RPC
   `create_transaction`, `void_transaction`, `return_transaction` tidak ada sama
   sekali di database (walau tabel-tabel dasarnya sudah ada dari setup-database.sql).
   **Sudah diperbaiki**: ketiga migration itu dijalankan manual sesi ini (isinya
   TIDAK diubah, cuma dieksekusi).
2. **`profiles.id` untuk user pertama (Abdullah Majid, role supervisor) tidak sama
   dengan `auth.users.id`-nya** — kemungkinan waktu insert manual pertama kali,
   placeholder `'PASTE-USER-UID-DISINI'` (lihat komentar migration `002`) diisi
   UUID yang salah/acak, bukan UID asli dari Supabase Auth. Ini bikin SEMUA
   transaksi gagal dengan FK violation di `cashier_id` (RPC `create_transaction`
   pakai `auth.uid()` untuk isi `cashier_id`, dan `auth.uid()` tidak pernah cocok
   dengan `profiles.id` yang salah itu).
   **Sudah diperbaiki**: insert baris `profiles` baru dengan `id` yang benar
   (`529a51e9-6a54-4857-b1ae-a227b76e2dde`), pindahkan referensi FK dari
   `stock_movements.created_by` & `transactions.cashier_id` ke id baru, lalu hapus
   baris lama. **PENTING kalau ada user lain ditambahkan manual ke `profiles` ke
   depannya: WAJIB isi `id`-nya persis sama dengan `auth.users.id`, cek dulu lewat
   Supabase Dashboard → Authentication → Users, jangan pakai UUID acak.**

**Untuk sesi berikutnya**: sebelum lanjut T-04, cek dulu apakah `scripts/setup-database.sql`
masih relevan dipakai atau sebaiknya di-deprecate/dihapus sekarang rantai migration
sudah berjalan.

## Bug ditemukan (BELUM diperbaiki, bukan blocker) — baris Retur tidak punya rincian item

Saat pemilik project cek fitur Retur: RPC `return_transaction` (migration `004`,
dibuat sebelum sesi T-01 ini) membuat baris transaksi baru berstatus `RETURN`
(nomor `LCO-RTR/...`) untuk tiap retur, tapi **tidak pernah insert baris ke
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
perlu insert baris `transaction_items` untuk `v_return_id` juga, lalu `TransactionDetailModal.tsx`
otomatis akan menampilkannya karena sudah pakai `detail.items` apa adanya.

**Keputusan yang diambil sesi ini:**

- `value` di tabel `settings` disimpan sebagai `jsonb` (bukan banyak kolom nullable
  per setting) supaya tabel key-value generik seperti disebut PRD §6, dan tipe asli
  (boolean/number/string) otomatis ke-decode oleh `supabase-js` tanpa parsing manual.
- RLS baca: **semua role aktif** (bukan cuma admin) — kasir butuh baca `ppn_enabled`/
  `ppn_rate` saat transaksi jalan. RLS tulis: admin only, sesuai matrix permission §5.
- Tidak menambah field breakdown pajak ke `lib/pos/cartLogic.ts` — perhitungan pajak
  cukup 2 baris (`Math.round(subtotal * rate / 100)`) langsung di `KasirModule.tsx`.
- Tidak menyentuh halaman Pengaturan UI sama sekali (persis "Jangan dulu" di §17) —
  `updateSetting()` di hook disiapkan tapi belum dipanggil dari komponen manapun.

**File yang SENGAJA belum dibuat dan alasannya:**

- Tidak ada komponen `PengaturanModule.tsx` / menu "Pengaturan" di sidebar — itu
  scope T-10, depend on T-01 (sudah selesai) + T-09 (belum).

**Belum diperbaiki, bukan blocker:**

- Tidak ada bug baru ditemukan di modul lama saat mengerjakan T-01, T-02, maupun T-03.
