# PROGRESS — LCO POS

> **Buku serah terima antar-agent.** File ini WAJIB dibaca agent saat mulai
> sesi dan WAJIB ditulis ulang saat sesi berakhir (lihat PRD v1.1 §17 & §18).
> PRD: `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — acuan task ada di §17.

## Status terakhir diperbarui

2026-09-17, sesi #6 (task T-06 selesai — Dashboard asli menggantikan stub:
stat hari ini & bulan berjalan, bar omzet 7/30 hari + pie kategori terlaris
pakai `recharts`, Action List yang bisa diklik menuju modul terkait; migration
`007`/`008`/`009` juga sudah diverifikasi terbentuk di database production).

## Task selesai

- [x] T-01 — Tabel `settings` + hook `useSettings` (migration `005_settings.sql`)
- [x] T-02 — Pembayaran lengkap per metode (transfer/qris/tempo): migration `006_payment_enhance.sql` (`due_date` di `payments`, tabel `payment_proofs` multi-file); update UI modal pembayaran dan riwayat.
- [x] T-03 — Nota A6/A5 non-thermal + pilihan format cetak per transaksi (`lib/pos/printLogic.ts` dengan `printA6Nota()` via iframe tersembunyi, pilihan format di `PaymentModal.tsx`, dropdown cetak ulang di `TransactionDetailModal.tsx`).
- [x] T-04 — Shift kasir: buka/tutup, selisih kas, wajib sebelum transaksi (migration `007_shift_sessions.sql` + `008_shift_close_rpc.sql`; `hooks/useShifts.ts`; `app/components/kas/KasModule.tsx`).
- [x] T-05 — Mutasi stok & opname (migration `009_stock_movements.sql`; `hooks/useStock.ts`; `app/components/stok/StokModule.tsx`).
- [x] T-06 — Dashboard asli (`hooks/useDashboard.ts` + tulis ulang `app/components/dashboard/DashboardModule.tsx`).

## Sedang dikerjakan

- (tidak ada sesi aktif)

## ⚠️ Yang HARUS dikonfirmasi di awal sesi berikutnya

1. **`npm run build` + `npm run lint` untuk T-06 BELUM dijalankan** saat file ini
   ditulis. Agent sesi #6 tidak punya akses jaringan di lingkungannya sehingga
   `npm install` (dan karenanya build) tidak bisa dieksekusi — kode T-06 ditulis
   dengan verifikasi manual terhadap tipe-tipe yang sudah ada di repo, BUKAN
   dengan compiler. **Jalankan build dulu sebelum menambah kode baru**, supaya
   kalau ada error TypeScript ketahuan sebagai milik T-06, bukan tercampur
   pekerjaan T-07.
2. **Validasi end-to-end T-06 belum dilakukan pemilik project** — dashboard belum
   pernah dibuka dengan data asli. Yang paling perlu dilihat pertama: apakah
   angka "Omzet Hari Ini" cocok dengan penjumlahan manual riwayat transaksi hari
   itu (lihat keputusan soal status RETURN di bawah — itu bagian yang paling
   mungkin memicu pertanyaan "kok angkanya beda?").

✅ **Migration `007`, `008`, `009` sudah diverifikasi benar-benar terbentuk di
database production** (dicek pemilik project via SQL Editor di sesi #6, hasil:
tabel `shift_sessions` ada, fungsi `close_shift` ada, fungsi `adjust_stock` ada,
RLS `stock_movements` aktif — keempatnya `true`). Sesi berikutnya **tidak perlu
mengulang pengecekan ini**, cukup percaya catatan ini.

## Task berikutnya (disarankan)

- **T-07** — Halaman publik `/cek-struk` (PRD §17 Fase D, §4.9): `app/cek-struk/page.tsx`
  tanpa login; input nomor struk + tanggal; RPC `get_transaction_by_receipt`
  (buat di migration kecil) atau view + RLS `anon` read-only; tampil rincian item
  & status **tanpa harga modal**.
- Dependensi T-07 (T-06) sudah selesai. Catatan: `middleware.ts` perlu dicek
  apakah sudah mengizinkan route `/cek-struk` tanpa sesi login — PRD menulis
  "middleware sudah mengizinkan route ini", **verifikasi dulu**, jangan percaya
  begitu saja (PRD §15.4 pernah keliru soal `stock_movements`, lihat riwayat).
- Keamanan yang wajib diperhatikan di T-07: jalur `anon` tidak boleh bisa
  meng-enumerasi transaksi. Nomor struk saja tidak cukup rahasia (formatnya
  berurutan), makanya PRD minta **nomor struk + tanggal** sebagai pasangan kunci.
  Jangan bikin policy `anon select` polos di `transactions` — pakai RPC
  `security definer` yang hanya mengembalikan satu baris kalau kedua input cocok.

## Catatan penting untuk sesi berikutnya

**File yang dibuat/diubah (T-06 — Dashboard):**

- `hooks/useDashboard.ts` — **baru**. Satu hook untuk semua agregat dashboard:
  `today`/`month` (`PeriodStats`: omzet, jumlah transaksi, item terjual,
  rata-rata), `daily` (selalu 30 titik `DailyPoint`), `categories`
  (`CategorySlice[]` untuk pie), `actions` (`ActionGroup[]` untuk Action List),
  plus `isLoading`/`error`/`refetch`/`lastUpdatedAt`.
- `app/components/dashboard/DashboardModule.tsx` — **ditulis ulang total**
  (sebelumnya stub placeholder 457 byte). Hero tanggal + jam real-time
  (`font-mono`, update tiap detik), 4 kartu stat hari ini + 3 kartu bulan
  berjalan, bar chart omzet dengan toggle 7/30 hari, pie kategori terlaris
  (legenda dibuat manual, bukan `<Legend />` bawaan), Action List 3 kelompok.
- `app/page.tsx` — satu baris: `<DashboardModule />` menjadi
  `<DashboardModule onNavigate={setActiveMenu} />` supaya Action List bisa
  membawa user ke modul terkait. Prop-nya opsional, jadi komponen tetap jalan
  kalau baris ini terlewat (bedanya cuma tombol navigasi tidak muncul).
- **Tidak ada migration baru di T-06.** Sengaja — lihat keputusan di bawah.

**Definition of Done T-06 — status:**

- [x] Tidak ada lagi placeholder — stub `DashboardModule.tsx` diganti seluruhnya.
- [x] Semua angka `font-mono tabular-nums` — termasuk jam, label sumbu Y,
      persentase legenda pie, dan angka di tombol toggle 7/30 hari.
- [x] Grafik pakai `recharts` — sudah ada di `package.json` (`^3.10.1`), tidak
      perlu dependensi baru.
- [x] Action list bisa diklik menuju modul terkait — `low_stock` → menu `stok`,
      `due_receivable` → menu `riwayat`, `open_shift` → menu `kas`.

**Keputusan yang diambil sesi ini:**

- **Omzet dihitung dari status `PAID` DAN `RETURN`, bukan `PAID` saja.** Ini
  keputusan paling penting di T-06 dan paling mudah "diperbaiki" secara keliru
  oleh agent berikutnya, jadi baca alasannya: RPC `return_transaction`
  (migration 004) melakukan dua hal — membuat baris transaksi BARU berstatus
  `RETURN` dengan `total` NEGATIF, **dan** mengubah status transaksi ASLI dari
  `PAID` menjadi `RETURN`, bahkan untuk retur SEBAGIAN. Kalau difilter `PAID`
  saja, satu retur sebagian akan menghapus SELURUH omzet transaksi aslinya dari
  dashboard. Karena baris retur bernilai negatif, menjumlahkan kedua status
  justru menghasilkan omzet BERSIH yang benar. `VOID` tetap dibuang penuh
  (transaksinya dibatalkan total dan stoknya sudah dikembalikan).
- **Jumlah transaksi hanya menghitung baris penjualan**, dibedakan lewat
  `related_transaction_id` (NULL = penjualan, terisi = baris retur). Kalau baris
  retur ikut dihitung, satu penjualan yang diretur tampil sebagai 2 transaksi.
- **Agregasi dilakukan di client, tidak pakai RPC/view agregat.** Alasannya:
  volume satu toko dalam 30 hari masih kecil; menghindari objek DB baru yang
  harus diurus RLS-nya untuk sesuatu yang sifatnya murni tampilan; dan Aturan
  Main #5 PRD (logika uang server-side) berlaku untuk uang yang DITULIS/DIKUNCI
  — mis. `expected_cash` di `close_shift` yang bisa dipalsukan kasir — bukan
  untuk ringkasan read-only yang tidak jadi dasar transaksi apa pun. Bentuk
  return hook sengaja dibuat datar supaya kalau nanti datanya membengkak,
  agregasi bisa dipindah ke RPC **tanpa menyentuh komponen sama sekali**.
- **Toggle 7/30 hari tidak memanggil ulang database.** Hook selalu mengirim 30
  titik; komponen memotong array. Ganti rentang jadi instan.
- **Semua pengelompokan tanggal pakai waktu LOKAL, bukan UTC.**
  `toISOString().slice(0,10)` SALAH untuk kita — di WIB (UTC+7) transaksi jam
  00:00–07:00 akan masuk ke tanggal kemarin versi UTC. Ada helper `dateKey()`
  di hook yang memakai komponen tanggal lokal; pakai itu, jangan `toISOString`.
- **Nilai kategori di pie dihitung ulang dari `unit_price × (qty - returned_qty)`,
  bukan dari kolom `subtotal`.** `subtotal` masih memuat qty penuh sebelum retur,
  jadi kalau dipakai langsung, barang yang sudah diretur tetap terhitung penuh.
- **Join `products`/`profiles`/`categories` pakai query terpisah, bukan embed
  PostgREST.** Alasan sama seperti `useStock.ts` sesi #5: bentuk FK di database
  ini tidak seragam antara jalur `scripts/setup-database.sql` dan rantai
  migration, sehingga embed berisiko patah diam-diam di salah satu jalur.
- **Kelompok Action List yang kosong tidak dikirim ke UI sama sekali** (bukan
  dikirim dengan `count: 0`). Jadi kalau daftar kosong, artinya benar-benar tidak
  ada yang perlu ditindak — bukan gagal memuat.
- **Kegagalan query Action List tidak mematikan dashboard.** Tiap kelompok
  ditarik dalam fungsi sendiri yang `console.error` lalu mengembalikan `null`
  kalau gagal. Konsekuensi yang perlu diketahui: kalau mis. tabel `shift_sessions`
  belum ada, kelompoknya hilang diam-diam dari UI dan hanya muncul di console.
- **Hex warna grafik ditulis sebagai konstanta `CHART_COLORS` di komponen.**
  Recharts tidak bisa menerima class Tailwind, hanya string warna. Ini
  satu-satunya pengecualian yang disengaja terhadap larangan hardcode hex
  (§16.2) — nilainya HARUS sama persis dengan `app/globals.css`. Kalau tema
  berubah, ubah di dua tempat.
- **Bar hari dengan omzet negatif diwarnai coral, tidak dipaksa nol.** Omzet
  harian bisa minus kalau nilai retur di hari itu melebihi penjualan; itu kondisi
  nyata yang justru perlu kelihatan.
- **Dashboard boleh dilihat SEMUA role** (PRD §5 baris `dashboard`: kasir ✔).
  Tidak ada layar blokir di sini, beda dengan `StokModule.tsx`. Isi Action List
  otomatis menyesuaikan role lewat RLS — kasir hanya melihat shift miliknya
  sendiri karena RLS `shift_sessions` (migration 007), tanpa cek role di client.

**Utang teknis yang DIKETAHUI di T-06 (bukan bug, sudah dipertimbangkan):**

- **Piutang: semua pembayaran `TEMPO` dianggap belum lunas.** Memang belum ada
  kolom/tabel penanda pelunasan di skema — itu scope T-08 (sub-tab Piutang/Tempo).
  Begitu T-08 menambahkannya, tambahkan filternya di fungsi `loadReceivables()`
  di `hooks/useDashboard.ts`; lokasinya sudah ditandai komentar.
- **`returned_qty` menempel pada item transaksi ASLI**, sehingga retur yang
  terjadi HARI INI atas transaksi KEMARIN akan mengurangi angka "item terjual"
  di tanggal KEMARIN, bukan hari ini. Untuk ringkasan harian ini masih wajar.
  Kalau T-08 butuh pemisahan per tanggal retur, sumbernya `stock_movements`
  (`type = 'return'`), bukan `transaction_items`.
- **Filter "stok menipis" hanya mengambil produk dengan `min_stock > 0`.**
  PostgREST tidak bisa membandingkan dua kolom (`stock <= min_stock`) lewat
  filter biasa, jadi penyaringan akhir dilakukan di client dan jumlah baris
  yang ditarik ditekan dengan syarat ini. Produk tanpa ambang batas memang tidak
  pernah bisa dinyatakan "menipis" — kalau pemilik project mengharapkan produk
  ber-`min_stock` 0 ikut muncul saat stoknya habis, itu perubahan aturan bisnis,
  bukan perbaikan bug.

**File yang SENGAJA belum dibuat dan alasannya:**

- Tidak ada migration baru — semua data dashboard dibaca dari tabel yang sudah
  ada. Lihat keputusan "agregasi di client" di atas.
- Tidak ada notifikasi push FCM untuk isi Action List — "Jangan dulu" eksplisit
  di PRD §17 T-06, itu T-12.
- Tidak ada filter tanggal custom / export di dashboard — itu modul Laporan (T-08).
- Tidak ada penyembunyian kartu per role — permission matrix §5 adalah scope T-10,
  dan dashboard sendiri memang boleh dilihat semua role.
- Tidak ada Supabase Realtime untuk auto-refresh angka (§4.10) — fase 1.1.
  Sementara ini refresh manual lewat tombol "Muat Ulang".

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

**⚠️ Kaitannya dengan T-06:** kalau bug ini nanti diperbaiki dengan cara menambah
baris `transaction_items` untuk transaksi retur, **`hooks/useDashboard.ts` WAJIB
ikut disesuaikan**. Saat ini hook sengaja hanya menarik item dari transaksi
penjualan (`related_transaction_id IS NULL`) karena baris retur dipastikan tidak
punya item. Begitu baris retur punya item, "item terjual" berisiko terhitung
ganda kalau filter itu tidak diubah.

**Belum diperbaiki, bukan blocker:**

- Tidak ada bug baru ditemukan di modul lama saat mengerjakan T-06.

---

<details>
<summary>Riwayat sesi sebelumnya (T-01 s/d T-05) — diciutkan, lihat histori git kalau butuh detail lengkap</summary>

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
begitu saja, verifikasi ke database dulu.**

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
atau sebaiknya di-deprecate sekarang rantai migration sudah berjalan sampai `009`.

</details>
