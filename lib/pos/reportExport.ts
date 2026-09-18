// lib/pos/reportExport.ts
// ── TAMBAHAN (T-08) ── Export Laporan ke Excel & PDF (PRD §17 T-08, §4.5).
// File terpisah dari LaporanModule.tsx sesuai rencana di komentar header
// LaporanModule.tsx — supaya file komponen itu tidak makin panjang.
//
// ═══════════════════════════════════════════════════════════════════════════
// Dua mekanisme export yang BEDA caranya, sesuai jenis datanya:
// ═══════════════════════════════════════════════════════════════════════════
// 1. **Excel (`exportReportToExcel`)** — dibangun dari DATA MENTAH (array
//    SalesSummary/DailySalesPoint/ShiftReportRow/ReceivableRow milik
//    hooks/useReports.ts), BUKAN dari DOM. Alasan: Excel harus berisi angka
//    asli yang bisa dihitung ulang oleh pemilik toko (SUM, filter, pivot) —
//    kalau diambil dari teks yang sudah diformat (`formatRupiah()` yang
//    hasilnya string "Rp 12.000"), kolom itu jadi teks, bukan angka, dan
//    tidak bisa dijumlah di Excel. Jadi di sini SENGAJA tidak reuse
//    `formatRupiah()` sama sekali untuk kolom nominal — nilai `number` mentah
//    langsung ditulis ke sel.
// 2. **PDF (`exportReportToPdf`)** — SEBALIKNYA, dibangun dari SNAPSHOT VISUAL
//    (elemen DOM yang sedang tampil di layar, lewat `html-to-image` →
//    `toPng()`), BUKAN dari data mentah. Alasan: PDF laporan ini fungsinya
//    "cetak apa yang terlihat" (badge warna status piutang, layout tabel,
//    kartu ringkasan) untuk diarsipkan/dikirim, bukan untuk diolah ulang.
//    Pola ini SAMA seperti rencana `generateReceiptImage()` untuk struk (file
//    terpisah menyusul di `printLogic.ts`) — keduanya reuse `html-to-image`
//    dengan cara yang sama, tapi tujuan akhirnya beda (unduh JPEG vs unduh
//    PDF).
//
// ── Kenapa PDF di-generate dari gambar, bukan dari teks (`jspdf` API teks
//    biasa)? ── Karena PRD §4.5/§17 T-08 eksplisit menyebut kombinasi
//    `jspdf` + `html-to-image` (bukan `jspdf` sendirian) — ini pola yang
//    sama dipakai untuk PDF struk. Menyusun ulang tabel Laporan jadi API
//    teks `jspdf` (`.text()`, `.autoTable()`, dst.) akan berarti dua sumber
//    kebenaran untuk layout yang sama (komponen React vs kode PDF manual) —
//    kalau layout tabel di LaporanModule.tsx berubah, PDF-nya harus diubah
//    manual juga, gampang lupa. Snapshot visual otomatis selalu sinkron
//    dengan yang di layar.
//
// ── Halaman multi-page ── Elemen yang di-snapshot bisa lebih tinggi dari 1
//    halaman A4 (mis. tabel Piutang panjang). Gambar hasil `toPng()` di-crop
//    per-halaman lewat `<canvas>` (bukan cuma di-scale mengecil, itu bikin
//    teks tidak kebaca) — pola potong gambar tinggi jadi beberapa halaman PDF
//    dengan lebar 100% halaman.

import { jsPDF } from "jspdf";
import { toPng } from "html-to-image";
import * as XLSX from "xlsx";
import type {
  SalesSummary,
  DailySalesPoint,
  ShiftReportRow,
  ReceivableRow,
  ReceivableStatus,
} from "@/hooks/useReports";

// ── Util nama file ───────────────────────────────────────────────────────────
// Dipakai untuk Excel & PDF supaya konsisten: "Laporan-LCO-POS_2026-09-18.xlsx".
// Rentang tanggal (bisa berisi "—" dari DateFilterBar) sengaja TIDAK dimasukkan
// apa adanya ke nama file — karakter itu tidak valid di banyak filesystem
// (terutama Windows). Nama file cukup pakai tanggal EKSPOR (bukan rentang
// laporan, yang sudah ada tertulis DI DALAM file-nya sendiri baris "Rentang").
function buildFileBaseName(prefix: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${prefix}_${year}-${month}-${day}_${hour}${minute}`;
}

// ── Label status piutang (versi teks polos untuk Excel — badge warna di UI
//    tidak relevan di sel spreadsheet). ──
const RECEIVABLE_STATUS_LABEL: Record<ReceivableStatus, string> = {
  LUNAS: "Lunas",
  JATUH_TEMPO: "Jatuh Tempo",
  BELUM_LUNAS: "Belum Lunas",
};

// `due_date`/`settled_at` dari Supabase: kolom `date` polos ("YYYY-MM-DD") vs
// `timestamptz` ISO penuh. Parse manual komponen tanggal, JANGAN
// `new Date(value)` langsung kalau `value` cuma "YYYY-MM-DD" — itu diparse
// sebagai UTC tengah malam, bisa mundur 1 hari saat ditampilkan di WIB. Pola
// sama persis seperti `formatDateOnly()`/`parseDateInputValue()` di
// LaporanModule.tsx, sengaja diduplikasi kecil di sini (bukan di-export dari
// situ) supaya file ini tidak punya dependency balik ke komponen React.
function formatDateOnlyForSheet(value: string | null): string {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

function formatDateTimeForSheet(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Export Excel
// ═══════════════════════════════════════════════════════════════════════════

export interface ReportExcelPayload {
  /** Label rentang tanggal yang SEDANG ditampilkan di UI, mis. "18 Sep 2026 — 18 Sep 2026". */
  dateRangeLabel: string;
  summary: SalesSummary;
  daily: DailySalesPoint[];
  shifts: ShiftReportRow[];
  receivables: ReceivableRow[];
}

/**
 * Export 1 file Excel (`.xlsx`) berisi 4 sheet: Ringkasan, Harian-Bulanan,
 * Per Shift, Piutang-Tempo. Memicu unduhan langsung di browser lewat
 * `XLSX.writeFile` (tidak butuh server — semua diproses di client, sama
 * seperti pola export lain yang sudah ada di ekosistem Langitan.co).
 *
 * Sengaja SATU file 4 sheet, bukan 4 file terpisah — pemilik toko biasanya
 * mau lihat semuanya sekaligus per rentang tanggal yang sama, bukan
 * download-download berkali-kali.
 */
export function exportReportToExcel(payload: ReportExcelPayload): void {
  const { dateRangeLabel, summary, daily, shifts, receivables } = payload;
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Ringkasan ──
  const ringkasanRows: (string | number)[][] = [
    ["Laporan LCO POS"],
    ["Rentang Tanggal", dateRangeLabel],
    ["Diekspor Pada", formatDateTimeForSheet(new Date().toISOString())],
    [],
    ["Omzet", summary.revenue],
    ["Jumlah Transaksi", summary.transactionCount],
    ["Item Terjual", summary.itemsSold],
    ["Rata-rata / Transaksi", summary.averageTicket],
  ];
  const wsRingkasan = XLSX.utils.aoa_to_sheet(ringkasanRows);
  wsRingkasan["!cols"] = [{ wch: 24 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsRingkasan, "Ringkasan");

  // ── Sheet 2: Harian/Bulanan ──
  const dailyRows: (string | number)[][] = [
    ["Tanggal", "Omzet", "Jumlah Transaksi"],
    ...daily.map((point) => [point.label, point.revenue, point.transactionCount]),
  ];
  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
  wsDaily["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsDaily, "Harian-Bulanan");

  // ── Sheet 3: Per Shift ──
  // Kolom "Kas Diharapkan"/"Kas Fisik" sengaja ikut disertakan (tidak tampil
  // di tabel UI LaporanModule.tsx) — berguna untuk audit manual di Excel,
  // dan datanya sudah ada di ShiftReportRow tanpa query tambahan.
  const shiftRows: (string | number)[][] = [
    [
      "Kasir",
      "Dibuka",
      "Ditutup",
      "Status",
      "Modal Awal",
      "Kas Diharapkan",
      "Kas Fisik",
      "Selisih",
    ],
    ...shifts.map((shift) => [
      shift.cashier_name ?? "-",
      formatDateTimeForSheet(shift.opened_at),
      shift.closed_at ? formatDateTimeForSheet(shift.closed_at) : "-",
      shift.status === "OPEN" ? "Belum Ditutup" : "Selesai",
      shift.opening_cash,
      shift.expected_cash ?? "-",
      shift.actual_cash ?? "-",
      shift.difference ?? "-",
    ]),
  ];
  const wsShift = XLSX.utils.aoa_to_sheet(shiftRows);
  wsShift["!cols"] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsShift, "Per Shift");

  // ── Sheet 4: Piutang/Tempo ──
  const piutangRows: (string | number)[][] = [
    ["Struk", "Pelanggan", "Jatuh Tempo", "Nominal", "Status", "Dilunasi Pada"],
    ...receivables.map((row) => [
      row.receipt_no,
      row.customer_name ?? "-",
      formatDateOnlyForSheet(row.due_date),
      row.amount,
      RECEIVABLE_STATUS_LABEL[row.status],
      row.settled_at ? formatDateTimeForSheet(row.settled_at) : "-",
    ]),
  ];
  const wsPiutang = XLSX.utils.aoa_to_sheet(piutangRows);
  wsPiutang["!cols"] = [
    { wch: 20 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsPiutang, "Piutang-Tempo");

  XLSX.writeFile(wb, `${buildFileBaseName("Laporan-LCO-POS")}.xlsx`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Export PDF (snapshot visual, lihat catatan desain di header file)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Snapshot elemen DOM `element` (biasanya container 1 sub-tab Laporan yang
 * sedang aktif) jadi gambar PNG lewat `html-to-image`, lalu susun jadi PDF
 * A4 (potrait) lewat `jspdf`. Kalau gambarnya lebih tinggi dari 1 halaman
 * A4, otomatis dipotong (BUKAN diperkecil paksa jadi 1 halaman — itu bikin
 * teks tabel panjang jadi tidak kebaca) jadi beberapa halaman berurutan.
 *
 * `element` WAJIB elemen yang sedang terlihat (tidak `display: none`) —
 * `html-to-image` tidak bisa merender elemen yang tidak punya ukuran layout.
 * Pemanggil (LaporanModule.tsx) bertanggung jawab memberi `ref` ke container
 * tab yang sedang aktif, BUKAN ke seluruh halaman (supaya sidebar/filter
 * tanggal tidak ikut ter-screenshot).
 */
export async function exportReportToPdf(
  element: HTMLElement,
  options: { title: string; dateRangeLabel: string },
): Promise<void> {
  // `backgroundColor` wajib diisi eksplisit — elemen aslinya transparan di
  // atas `bg-zinc-100`/`bg-zinc-950` (lihat className LaporanModule.tsx), dan
  // PNG transparan akan tampil hitam polos kalau dark mode aktif saat
  // di-embed ke PDF (PDF tidak punya konsep "latar belakang halaman OS").
  // `pixelRatio: 2` supaya teks tabel tetap tajam saat dicetak/di-zoom,
  // bukan blur seperti screenshot resolusi layar mentah.
  const dataUrl = await toPng(element, {
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    cacheBust: true,
  });

  const image = await loadImage(dataUrl);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidthMm = pageWidth - margin * 2;
  const usableHeightMm = pageHeight - margin * 2 - 12; // sisakan ruang judul di halaman 1

  // mm per px gambar, dihitung dari lebar supaya gambar selalu pas lebar halaman.
  const mmPerPx = usableWidthMm / image.width;
  const usableHeightPx = usableHeightMm / mmPerPx;

  pdf.setFontSize(11);
  pdf.text(options.title, margin, margin + 4);
  pdf.setFontSize(8);
  pdf.setTextColor(120);
  pdf.text(options.dateRangeLabel, margin, margin + 9);
  pdf.setTextColor(0);

  let renderedPx = 0;
  let pageIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Browser ini tidak mendukung <canvas> — export PDF tidak bisa dilanjutkan.");
  }

  while (renderedPx < image.height) {
    // Halaman pertama sedikit lebih pendek (dikurangi ruang judul di atas).
    const availablePx = pageIndex === 0 ? usableHeightPx : usableHeightPx + 12 / mmPerPx;
    const sliceHeightPx = Math.min(availablePx, image.height - renderedPx);

    canvas.height = sliceHeightPx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      image,
      0,
      renderedPx,
      image.width,
      sliceHeightPx,
      0,
      0,
      image.width,
      sliceHeightPx,
    );

    const sliceDataUrl = canvas.toDataURL("image/png");
    const sliceHeightMm = sliceHeightPx * mmPerPx;
    const topMm = pageIndex === 0 ? margin + 13 : margin;

    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(sliceDataUrl, "PNG", margin, topMm, usableWidthMm, sliceHeightMm);

    renderedPx += sliceHeightPx;
    pageIndex += 1;
  }

  pdf.save(`${buildFileBaseName("Laporan-LCO-POS")}.pdf`);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Gagal memuat gambar hasil render laporan untuk PDF."));
    image.src = dataUrl;
  });
}