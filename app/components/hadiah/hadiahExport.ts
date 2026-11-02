// app/components/hadiah/hadiahExport.ts
// ── TAMBAHAN (migration 044) ── Ekspor Excel rekap Hadiah & Oleh-oleh untuk
// pembukuan. Dibangun dari DATA MENTAH: kolom jumlah & rupiah ditulis sebagai
// ANGKA asli supaya bisa dijumlah/difilter/di-pivot di Excel. Diproses di
// browser (pola yang sama dengan app/components/stok/stokExport.ts).
//
// Hadiah berstatus "Dibatalkan" tetap ditampilkan (untuk jejak audit) tapi
// TIDAK dihitung di total beban.

import * as XLSX from "xlsx";
import {
  GIFT_CATEGORY_LABEL,
  type GiftRecord,
} from "@/hooks/useGifts";

type Cell = string | number | null;

function buildFileBaseName(prefix: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${prefix}_${year}-${month}-${day}`;
}

function formatDateOnlyForSheet(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

export function exportGiftsToExcel(
  gifts: GiftRecord[],
  periodLabel: string,
): void {
  const active = gifts.filter((gift) => gift.status === "completed");

  const totalCost = active.reduce((sum, gift) => sum + gift.total_cost, 0);
  const totalRetail = active.reduce((sum, gift) => sum + gift.total_retail, 0);
  const totalQty = active.reduce((sum, gift) => sum + gift.total_qty, 0);

  // ---- Sheet 1: Ringkasan ----
  const summaryRows: Cell[][] = [
    ["Rekap Hadiah & Oleh-oleh"],
    ["Periode", periodLabel],
    [],
    ["Jumlah pemberian", active.length],
    ["Total unit", totalQty],
    ["Total beban hadiah (harga modal)", totalCost],
    ["Nilai jika dijual (info)", totalRetail],
    [],
    ["Per kategori penerima", "Pemberian", "Unit", "Beban (Modal)"],
  ];

  for (const [key, label] of Object.entries(GIFT_CATEGORY_LABEL)) {
    const rows = active.filter((gift) => gift.recipient_category === key);
    summaryRows.push([
      label,
      rows.length,
      rows.reduce((sum, gift) => sum + gift.total_qty, 0),
      rows.reduce((sum, gift) => sum + gift.total_cost, 0),
    ]);
  }

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 12 }, { wch: 18 }];

  // ---- Sheet 2: Daftar hadiah ----
  const header: Cell[] = [
    "No. Hadiah",
    "Tanggal",
    "Penerima",
    "Kategori",
    "Keperluan",
    "Catatan",
    "Jumlah Produk",
    "Total Unit",
    "Beban (Modal)",
    "Nilai Jika Dijual",
    "Status",
    "Dicatat Oleh",
  ];

  const listRows: Cell[][] = [header];

  for (const gift of gifts) {
    listRows.push([
      gift.number,
      formatDateOnlyForSheet(gift.given_at),
      gift.recipient_name,
      GIFT_CATEGORY_LABEL[gift.recipient_category],
      gift.occasion,
      gift.note,
      gift.item_count,
      gift.total_qty,
      gift.total_cost,
      gift.total_retail,
      gift.status === "voided" ? "Dibatalkan" : "Selesai",
      gift.created_by_name,
    ]);
  }

  const listSheet = XLSX.utils.aoa_to_sheet(listRows);
  listSheet["!cols"] = [
    { wch: 11 },
    { wch: 14 },
    { wch: 26 },
    { wch: 22 },
    { wch: 28 },
    { wch: 28 },
    { wch: 14 },
    { wch: 11 },
    { wch: 16 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Ringkasan");
  XLSX.utils.book_append_sheet(workbook, listSheet, "Daftar Hadiah");

  XLSX.writeFile(workbook, `${buildFileBaseName("hadiah-oleh-oleh")}.xlsx`);
}
