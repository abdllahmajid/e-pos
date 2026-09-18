# PROGRESS — LCO POS

> **Buku serah terima antar-agent.** File ini WAJIB dibaca agent saat mulai
> sesi dan WAJIB ditulis ulang saat sesi berakhir (lihat PRD v1.1 §17 & §18).
> PRD: `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — acuan task ada di §17.

## Status terakhir diperbarui

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
10. **BELUM disambungkan: tombol "Kirim WA" langsung di layar Kasir setelah
    bayar** (PRD §4.2 "Setelah bayar: ... kirim struk via WhatsApp", §4.7).
    Ini **BUKAN cuma soal nge-import fungsi** — dicek langsung ke
    `PaymentModal.tsx`/`KasirModule.tsx`/`transactionApi.ts`: **tidak ada
    input nomor HP pelanggan sama sekali di form pembayaran manapun**
    (`customerName` cuma dikumpulkan untuk metode TEMPO, tidak ada field
    telepon). Kolom `customer_phone` MEMANG sudah ada di tabel `transactions`
    (migration `001`) dan sudah dibaca `getTransactionDetail()` — itu
    sebabnya poin 9 di atas bisa langsung jalan untuk Riwayat Transaksi — tapi
    `create_transaction` RPC dan `CreateTransactionParams`
    (`transactionApi.ts`) **tidak pernah mengirim nilainya**, jadi kolom itu
    SELALU `null` untuk transaksi baru. Menambah tombol "Kirim WA" di layar
    sukses bayar tanpa nomor HP pelanggan cuma akan selalu jatuh ke fallback
    "buka wa.me tanpa nomor" — teknisnya bisa, tapi tidak sesuai maksud PRD
    ("kirim ke WhatsApp **pelanggan**"). Diputuskan TIDAK dikerjakan
    setengah-setengah di sesi ini — lihat "Task berikutnya" untuk urutan yang
    disarankan (field HP dulu, baru tombolnya).

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
- [~] **T-08 — Laporan** (PRD §17 Fase E, §4.5, §4.7) — **sebagian besar
  selesai, TAPI belum 100%**, jangan dicentang penuh:
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
  - [ ] **BELUM: tombol "Kirim WA" di layar Kasir setelah bayar** (PRD §4.2/§4.7).
        Butuh field nomor HP pelanggan di `PaymentModal.tsx` dulu — kolom
        `customer_phone` di database SELALU `null` untuk transaksi baru saat
        ini karena `create_transaction` RPC tidak pernah menerima nilainya.
        Detail lengkap di poin 10, bagian "Yang dikerjakan sesi ini" di atas.

## Sedang dikerjakan

- (tidak ada sesi aktif)

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

## Task berikutnya (disarankan)

- **Jalankan checklist "Yang HARUS dikonfirmasi" di atas dulu** (build asli,
  end-to-end `/cek-struk` + Kasir/Riwayat/Dashboard + Laporan + Export/Kirim
  WA yang baru) — sebaiknya sebelum menambah task baru lagi, supaya utang
  verifikasi tidak menumpuk. Export & Kirim WA KHUSUSNYA belum pernah dicoba
  sama sekali di browser sungguhan.
- **Baru kalau mau menuntaskan T-08 100%** (bukan wajib fase 1, PRD §4.2/§4.7
  menyebutnya tapi tidak eksplisit jadi Acceptance Criteria Kasir): tambah
  field nomor HP pelanggan di `PaymentModal.tsx` (opsional, semua metode
  bayar — bukan cuma TEMPO), alirkan ke `createTransaction()`
  (`transactionApi.ts`) → `create_transaction` RPC (migration baru, tambah
  parameter `p_customer_phone`) → kolom `customer_phone` yang sudah ada di
  tabel `transactions`. Baru setelah itu tombol "Kirim WA" di layar sukses
  bayar (`KasirModule.tsx`) benar-benar berguna — reuse
  `shareReceiptViaWhatsApp()` yang sudah ada, sama seperti di
  `TransactionDetailModal.tsx`.
- Beres-beres lint pra-eksisting (13 error, salah satunya di
  `TransactionDetailModal.tsx` — sudah tercatat sejak poin 4/"Yang HARUS
  dikonfirmasi" #2, TIDAK bertambah karena perubahan poin 9 di atas) — bukan
  blocker, tapi bikin `npm run lint` tidak bisa dipakai sebagai sinyal "ada
  regresi baru" selama masih penuh dengan error lama yang bercampur.

## Catatan penting untuk sesi berikutnya

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
