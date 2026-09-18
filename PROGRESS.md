# PROGRESS — LCO POS

> **Buku serah terima antar-agent.** File ini WAJIB dibaca agent saat mulai
> sesi dan WAJIB ditulis ulang saat sesi berakhir (lihat PRD v1.1 §17 & §18).
> PRD: `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — acuan task ada di §17.

## Status terakhir diperbarui

2026-09-17, sesi #7 (task T-07 selesai — halaman publik `/cek-struk`: RPC
`get_transaction_by_receipt` SECURITY DEFINER di migration `010`, form nomor
struk + tanggal, tampilan status & rincian item tanpa harga modal. **Ditemukan
celah keamanan besar di luar scope T-07** — lihat bagian ⚠️ di bawah, ini
prioritas paling tinggi untuk sesi berikutnya, lebih tinggi dari lanjut ke T-08).

## Task selesai

- [x] T-01 — Tabel `settings` + hook `useSettings` (migration `005_settings.sql`)
- [x] T-02 — Pembayaran lengkap per metode (transfer/qris/tempo): migration `006_payment_enhance.sql` (`due_date` di `payments`, tabel `payment_proofs` multi-file); update UI modal pembayaran dan riwayat.
- [x] T-03 — Nota A6/A5 non-thermal + pilihan format cetak per transaksi (`lib/pos/printLogic.ts` dengan `printA6Nota()` via iframe tersembunyi, pilihan format di `PaymentModal.tsx`, dropdown cetak ulang di `TransactionDetailModal.tsx`).
- [x] T-04 — Shift kasir: buka/tutup, selisih kas, wajib sebelum transaksi (migration `007_shift_sessions.sql` + `008_shift_close_rpc.sql`; `hooks/useShifts.ts`; `app/components/kas/KasModule.tsx`).
- [x] T-05 — Mutasi stok & opname (migration `009_stock_movements.sql`; `hooks/useStock.ts`; `app/components/stok/StokModule.tsx`).
- [x] T-06 — Dashboard asli (`hooks/useDashboard.ts` + tulis ulang `app/components/dashboard/DashboardModule.tsx`).
- [x] T-07 — Halaman publik `/cek-struk` (`app/cek-struk/page.tsx`; RPC `get_transaction_by_receipt` di migration `010_public_receipt_lookup.sql`).

## Sedang dikerjakan

- (tidak ada sesi aktif)

## ⚠️⚠️ TEMUAN KEAMANAN KRITIS — belum diperbaiki, BUKAN scope T-07, PRIORITAS TERTINGGI

Saat menyiapkan RPC `get_transaction_by_receipt` untuk T-07, ditemukan bahwa
tabel **`transactions`, `transaction_items`, dan `payments` sampai saat ini
belum pernah mengaktifkan RLS sama sekali**, di migration manapun (beda dengan
`stock_movements`, `shift_sessions`, `payment_proofs` yang sudah punya RLS
sejak sesi-sesi sebelumnya). Privilege default Supabase memberi role
`anon`/`authenticated` akses langsung ke tabel baru selama RLS belum
diaktifkan — artinya **seluruh isi ketiga tabel itu (semua transaksi toko,
bukan cuma yang dicari lewat `/cek-struk`) berisiko bisa dibaca langsung lewat
PostgREST (`/rest/v1/transactions`, dst.) tanpa login sama sekali**, di luar
jalur RPC manapun.

RPC T-07 sendiri **aman** — `SECURITY DEFINER` bypass RLS secara sengaja dan
sudah divalidasi ketat (nomor struk + tanggal harus cocok, satu baris saja).
Tapi RPC ini menutup satu jalur, bukan sumber masalahnya. Sumber masalahnya
ada di tabelnya sendiri.

**Kenapa belum diperbaiki di sesi ini:** menambah RLS ke 3 tabel itu sekarang
butuh policy lengkap per role (kasir hanya lihat transaksi miliknya sendiri
atau semua? supervisor/admin lihat semua — lihat matrix permission §5 PRD)
yang belum dirancang di PRD secara eksplisit untuk level tabel (baru ada di
level menu/modul). Kalau ditambah asal-asalan tercampur T-07, berisiko
mematahkan seluruh modul yang sudah jalan (Kasir checkout, Riwayat Transaksi,
Dashboard, halaman baru `/cek-struk` ini sendiri) karena semuanya baca dari
3 tabel ini lewat client biasa (`authenticated`), bukan cuma lewat RPC.

**Rekomendasi untuk sesi berikutnya — kerjakan SEBELUM T-08:**

1. Buat migration terpisah (`011_transactions_rls.sql` atau serupa) khusus
   untuk ini — jangan dicampur task lain.
2. Rancang dulu policy per role mengikuti §5 PRD: kasir → `select` transaksi
   yang dia buat sendiri (`cashier_id = auth.uid()`) atau via `shift_id`
   miliknya; supervisor/admin → `select` semua. `insert`/`update` tetap wajib
   lewat RPC (`create_transaction`, `return_transaction`, dst.) yang sudah
   `SECURITY DEFINER` — jangan buka policy `insert`/`update` langsung ke
   `authenticated` supaya aturan main §18.5 (logika uang di RPC) tidak bisa
   dilewati dari client.
3. Setelah RLS aktif, **uji ulang halaman `/cek-struk` secara end-to-end**
   (buka di browser tanpa login) — RPC-nya `SECURITY DEFINER` jadi seharusnya
   tetap jalan normal walau RLS `transactions` sudah aktif, tapi ini WAJIB
   diverifikasi langsung, jangan diasumsikan.
4. Uji juga modul yang sudah ada (Kasir, Riwayat, Dashboard) tidak patah
   setelah RLS diaktifkan — ini bagian paling berisiko dari perbaikan ini.

## Yang HARUS dikonfirmasi di awal sesi berikutnya

1. **`npm run build` + `npm run lint` untuk T-07 BELUM dijalankan** saat file
   ini ditulis — agent sesi #7 tidak punya akses jaringan (`npm install` tidak
   bisa dieksekusi). Kode `app/cek-struk/page.tsx` sudah diverifikasi manual
   terhadap tipe di `lib/pos/cartLogic.ts` (`formatRupiah`) dan konvensi warna
   di `app/globals.css` (`lco-teal`/`lco-green`/`lco-coral`/`lco-mustard`
   semuanya ada), tapi belum lewat compiler. **Jalankan build dulu.**
2. Migration `010_public_receipt_lookup.sql` **belum dijalankan ke database
   production** — baru berupa file migration. Perlu dieksekusi lewat SQL
   Editor Supabase (atau `scripts/migrate.ts` kalau jalurnya lewat situ)
   sebelum halaman `/cek-struk` benar-benar bisa dites end-to-end.
3. Halaman `/cek-struk` belum pernah dibuka di browser oleh pemilik project.
   Setelah migration `010` jalan, coba cek satu struk asli (nomor + tanggal
   yang benar) DAN satu percobaan salah (nomor benar tanggal salah, nomor
   salah) — pastikan pesan gagalnya sama persis untuk kedua kasus (sengaja,
   lihat komentar di migration).

## Task berikutnya (disarankan)

- **Perbaiki temuan keamanan RLS di atas dulu** (`011_transactions_rls.sql`) —
  ini bukan task bernomor di PRD §17, tapi risikonya lebih tinggi dari
  menunda T-08. Utang ini sudah ada sejak sebelum T-01 (bukan disebabkan oleh
  T-07), tapi baru ketahuan sekarang.
- **T-08 — Laporan + PDF struk/WA + export** (PRD §17 Fase E, §4.5, §4.7):
  isi `app/components/laporan/LaporanModule.tsx` dengan sub-tab Per Shift,
  Harian/Bulanan, **Piutang/Tempo** (status Lunas/Belum/Jatuh Tempo, tandai
  lunas + upload bukti — catatan: skema belum ada kolom "lunas", lihat utang
  teknis T-06 di bawah); filter tanggal custom + preset; export Excel (`xlsx`)
  & PDF (`jspdf` + `html-to-image`); `printLogic.ts` ditambah
  `generateReceiptImage()` untuk share WA. Dependensi (T-02, T-04, T-06) sudah
  selesai semua.

## Catatan penting untuk sesi berikutnya

**File yang dibuat/diubah (T-07 — Halaman publik `/cek-struk`):**

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
  `/cek-struk` di `PUBLIC_PATHS` (diverifikasi langsung baca file, bukan
  percaya begitu saja ke PRD/PROGRESS lama, sesuai pesan peringatan sesi #6).

**Definition of Done T-07 — status:**

- [x] Struk asli bisa diverifikasi publik — form nomor struk + tanggal →
      RPC → tampil status & rincian.
- [ ] **"anon tidak bisa lihat data lain (cek dengan RLS)" — BELUM bisa
      dicentang penuh.** Jalur RPC-nya sendiri sudah aman (lihat desain di
      bawah), tapi ini butuh diverifikasi bersamaan dengan perbaikan temuan
      RLS di atas, karena keduanya menyentuh tabel yang sama. Jangan centang
      sampai `011_transactions_rls.sql` selesai dan diuji.

**Keputusan yang diambil sesi ini:**

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

## Bug ditemukan (BELUM diperbaiki, bukan blocker) — baris Retur tidak punya rincian item

Saat pemilik project cek fitur Retur: RPC `return_transaction` (migration `004`,
dibuat sebelum sesi T-01) membuat baris transaksi baru berstatus `RETURN` (nomor
`LCO-RTR/...`) untuk tiap retur, tapi **tidak pernah insert baris ke
`transaction_items` untuk transaksi retur itu sendiri** — cuma nominal refund
yang tersimpan. Akibatnya di modal detail, baris Retur cuma tampil total uang
tanpa daftar barang. **Halaman `/cek-struk` (T-07) mewarisi keterbatasan yang
sama** kalau pelanggan mencari langsung nomor `LCO-RTR/...`: bagian "Rincian
Barang" akan tampil "Tidak ada rincian barang untuk struk ini" (bukan error —
RPC memang mengembalikan array kosong, UI sudah menangani array kosong).

Info barang yang diretur **sebenarnya tetap ada** — tersimpan sebagai
`returned_qty` di `transaction_items` milik transaksi ASLI (bukan baris Retur),
dan sudah tampil di UI sebagai label "X sudah diretur" per item saat cari
nomor struk ASLI-nya (baik di modal detail internal maupun di `/cek-struk`).
Jadi bukan data hilang, cuma baris Retur-nya sendiri tidak "self-contained".

**Belum diperbaiki atas keputusan pemilik project** (dikonfirmasi langsung, bukan
diabaikan begitu saja) — kalau mau dikerjakan nanti: RPC `return_transaction`
perlu insert baris `transaction_items` untuk `v_return_id` juga, lalu
`TransactionDetailModal.tsx` DAN RPC `get_transaction_by_receipt` (T-07)
otomatis akan menampilkannya karena keduanya sudah pakai `items` apa adanya.

**⚠️ Kaitannya dengan T-06:** kalau bug ini nanti diperbaiki dengan cara menambah
baris `transaction_items` untuk transaksi retur, **`hooks/useDashboard.ts` WAJIB
ikut disesuaikan**. Saat ini hook sengaja hanya menarik item dari transaksi
penjualan (`related_transaction_id IS NULL`) karena baris retur dipastikan tidak
punya item. Begitu baris retur punya item, "item terjual" berisiko terhitung
ganda kalau filter itu tidak diubah.

**Belum diperbaiki, bukan blocker (sesi #7):**

- Tidak ada bug baru ditemukan di modul lama saat mengerjakan T-07, di luar
  temuan keamanan RLS yang sudah dicatat terpisah di atas (itu bukan bug baru
  yang _disebabkan_ T-07, tapi celah lama yang baru ketahuan saat menulis RPC
  T-07 dan memeriksa privilege tabel terkait).

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
