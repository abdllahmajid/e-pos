// app/components/stok/stokExport.ts
// ── TAMBAHAN (Fase 3 perbaikan Stok & Opname) ── Ekspor Excel untuk menu Stok:
//   - exportOpnameToExcel : hasil satu sesi opname (ringkasan + detail per produk).
//   - exportStockToExcel  : daftar Stok Saat Ini (sesuai filter yang sedang tampil).
//   - exportMovementsToExcel : Riwayat Mutasi (semua baris sesuai filter, bukan hanya halaman tampil).
//
// Mengikuti pola lib/pos/reportExport.ts: dibangun dari DATA MENTAH, bukan teks
// yang sudah diformat — kolom jumlah & rupiah ditulis sebagai ANGKA asli supaya
// bisa dijumlah/difilter/di-pivot di Excel. Semua diproses di browser.

import * as XLSX from "xlsx";
import type { OpnameItem, OpnameSession } from "@/hooks/useOpname";
import type { StockMovement } from "@/hooks/useStock";
import type { ProductWithCategory } from "@/hooks/useProducts";
import { OPNAME_STATUS_LABEL, computeOpnameStats, itemDiff } from "./opnameUtils";
import { STOCK_STATUS_LABEL, getStockStatus } from "./stokUtils";

type Cell = string | number | null;

function buildFileBaseName(prefix: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${prefix}_${year}-${month}-${day}_${hour}${minute}`;
}

function formatDateTimeForSheet(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Beri format ribuan (#,##0) pada kolom angka tertentu, mulai dari baris data pertama. */
function applyNumberFormat(
  sheet: XLSX.WorkSheet,
  columnIndexes: number[],
  firstDataRow: number,
  lastDataRow: number,
): void {
  for (let row = firstDataRow; row <= lastDataRow; row += 1) {
    for (const col of columnIndexes) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && cell.t === "n") cell.z = "#,##0";
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Hasil sesi opname
// ═══════════════════════════════════════════════════════════════════════════

export function exportOpnameToExcel(
  session: OpnameSession,
  items: OpnameItem[],
): void {
  const stats = computeOpnameStats(items);
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Ringkasan ──
  const summaryRows: Cell[][] = [
    [`Opname #${session.number}`, session.name],
    ["Status", OPNAME_STATUS_LABEL[session.status]],
    ["Cakupan", session.category_name ?? "Semua produk berstok"],
    ["Dibuat", formatDateTimeForSheet(session.created_at)],
    ["Dibuat oleh", session.created_by_name ?? "-"],
    ["Diselesaikan", formatDateTimeForSheet(session.finalized_at)],
    ["Catatan", session.note ?? "-"],
    ["Diekspor pada", formatDateTimeForSheet(new Date().toISOString())],
    [],
    ["Total produk", stats.total],
    ["Sudah dihitung", stats.counted],
    ["Belum dihitung", stats.uncounted],
    ["Cocok dengan stok sistem", stats.matched],
    ["Ada selisih", stats.withDiff],
    ["Stok lebih (unit)", stats.plusQty],
    ["Stok kurang (unit)", stats.minusQty],
    ["Selisih nilai (Rp, harga modal)", stats.diffValue],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 32 }, { wch: 36 }];
  applyNumberFormat(summarySheet, [1], 9, summaryRows.length - 1);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Ringkasan");

  // ── Sheet 2: Detail per produk ──
  const header: Cell[] = [
    "No",
    "SKU",
    "Barcode",
    "Produk",
    "Satuan",
    "Stok Sistem",
    "Hitung Fisik",
    "Selisih",
    "Harga Modal",
    "Nilai Selisih",
    "Catatan",
    "Diterapkan ke Stok",
  ];

  const detailRows: Cell[][] = items.map((item, index) => {
    const diff = itemDiff(item);

    return [
      index + 1,
      item.product_sku ?? "",
      item.product_barcode ?? "",
      item.product_name,
      item.product_unit ?? "",
      item.system_qty,
      item.counted_qty,
      diff,
      item.cost_price,
      diff === null || item.cost_price === null ? null : diff * item.cost_price,
      item.note ?? "",
      item.applied_delta,
    ];
  });

  const detailSheet = XLSX.utils.aoa_to_sheet([header, ...detailRows]);
  detailSheet["!cols"] = [
    { wch: 5 },
    { wch: 16 },
    { wch: 18 },
    { wch: 36 },
    { wch: 9 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 28 },
    { wch: 18 },
  ];
  applyNumberFormat(detailSheet, [5, 6, 7, 8, 9, 11], 1, detailRows.length);
  XLSX.utils.book_append_sheet(wb, detailSheet, "Detail");

  XLSX.writeFile(
    wb,
    `${buildFileBaseName(`Opname-${session.number}`)}.xlsx`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Stok Saat Ini
// ═══════════════════════════════════════════════════════════════════════════

export function exportStockToExcel(products: ProductWithCategory[]): void {
  const header: Cell[] = [
    "No",
    "SKU",
    "Barcode",
    "Produk",
    "Kategori",
    "Satuan",
    "Stok",
    "Stok Minimum",
    "Status",
    "Harga Modal",
    "Nilai Persediaan",
  ];

  const rows: Cell[][] = products.map((product, index) => {
    const status = getStockStatus(product.stock, product.min_stock);

    return [
      index + 1,
      product.sku ?? "",
      product.barcode ?? "",
      product.name,
      product.category?.name ?? "",
      product.unit ?? "",
      product.stock,
      product.min_stock,
      STOCK_STATUS_LABEL[status],
      product.cost_price,
      product.cost_price === null
        ? null
        : Math.max(product.stock, 0) * product.cost_price,
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = [
    { wch: 5 },
    { wch: 16 },
    { wch: 18 },
    { wch: 36 },
    { wch: 18 },
    { wch: 9 },
    { wch: 10 },
    { wch: 14 },
    { wch: 11 },
    { wch: 14 },
    { wch: 18 },
  ];
  applyNumberFormat(sheet, [6, 7, 9, 10], 1, rows.length);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Stok");
  XLSX.writeFile(wb, `${buildFileBaseName("Stok")}.xlsx`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Riwayat Mutasi
// ═══════════════════════════════════════════════════════════════════════════

export interface MovementsExportMeta {
  /** Baris "label, nilai" yang menjelaskan filter aktif — ditulis di sheet Ringkasan. */
  filterLines: [string, string][];
  /** True kalau data lebih banyak dari batas ekspor dan sisanya tidak ikut. */
  truncated: boolean;
  /** Label jenis mutasi (dikirim pemanggil supaya file ini tidak bergantung pada hook). */
  typeLabels: Record<string, string>;
}

export function exportMovementsToExcel(
  rows: StockMovement[],
  meta: MovementsExportMeta,
): void {
  let masuk = 0;
  let keluar = 0;

  for (const row of rows) {
    if (row.qty_delta > 0) masuk += row.qty_delta;
    else if (row.qty_delta < 0) keluar += -row.qty_delta;
  }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Ringkasan ──
  const summaryRows: Cell[][] = [
    ["Riwayat Mutasi Stok"],
    ["Diekspor pada", formatDateTimeForSheet(new Date().toISOString())],
    [],
    ...meta.filterLines,
    [],
    ["Jumlah mutasi", rows.length],
    ["Stok masuk (unit)", masuk],
    ["Stok keluar (unit)", keluar],
  ];

  if (meta.truncated) {
    summaryRows.push([]);
    summaryRows.push([
      "Catatan",
      "Data lebih banyak dari batas ekspor; hanya baris terbaru yang ikut. Persempit filter untuk sisanya.",
    ]);
  }

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Ringkasan");

  // ── Sheet 2: Mutasi ──
  const header: Cell[] = [
    "No",
    "Waktu",
    "Produk",
    "SKU",
    "Jenis",
    "Qty",
    "Stok Sebelum",
    "Stok Sesudah",
    "Alasan",
    "Oleh",
  ];

  // Waktu ditulis sebagai tanggal asli Excel (bukan teks) supaya bisa diurutkan
  // dan difilter per tanggal di Excel.
  const body: (string | number | Date | null)[][] = rows.map((row, index) => [
    index + 1,
    new Date(row.created_at),
    row.product_name ?? "Produk dihapus",
    row.product_sku ?? "",
    meta.typeLabels[row.type] ?? row.type,
    row.qty_delta,
    row.stock_before,
    row.stock_after,
    row.reason ?? "",
    row.created_by_name ?? "",
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body], { cellDates: true });
  sheet["!cols"] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 34 },
    { wch: 16 },
    { wch: 16 },
    { wch: 8 },
    { wch: 13 },
    { wch: 13 },
    { wch: 36 },
    { wch: 18 },
  ];
  applyNumberFormat(sheet, [5, 6, 7], 1, body.length);

  for (let rowIndex = 1; rowIndex <= body.length; rowIndex += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 1 })];
    if (cell) cell.z = "dd/mm/yyyy hh:mm";
  }

  XLSX.utils.book_append_sheet(wb, sheet, "Mutasi");
  XLSX.writeFile(wb, `${buildFileBaseName("Riwayat-Mutasi")}.xlsx`);
}
