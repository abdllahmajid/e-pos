// app/components/stok/stokUtils.ts
// Helper tampilan bersama untuk menu Stok & Opname (tab Stok Saat Ini, tab
// Riwayat Mutasi, dan modal Opname). Sengaja murni (tanpa React) supaya mudah
// dipakai ulang dan dites.

import type { StockMovementType } from "@/hooks/useStock";

const numberFormatter = new Intl.NumberFormat("id-ID");

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatRupiah(value: number): string {
  return rupiahFormatter.format(value);
}

/**
 * Format kolom `date` polos ("YYYY-MM-DD"). Komponen tanggal diparse manual:
 * `new Date("2026-11-01")` dibaca sebagai UTC tengah malam dan bisa mundur satu
 * hari saat ditampilkan di WIB.
 */
export function formatDateOnly(value: string | null): string {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "+5" / "-3" / "0" — tanda eksplisit supaya arah mutasi langsung terbaca. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${formatNumber(delta)}`;
  if (delta < 0) return `-${formatNumber(Math.abs(delta))}`;
  return "0";
}

export function deltaColorClass(delta: number): string {
  if (delta > 0) return "text-lco-green dark:text-lco-teal";
  if (delta < 0) return "text-lco-coral";
  return "text-zinc-500 dark:text-zinc-400";
}

export function movementTypeColorClass(type: StockMovementType): string {
  switch (type) {
    case "sale":
      return "text-zinc-700 dark:text-zinc-300";
    case "return":
    case "void":
    case "stock_in":
      return "text-lco-green dark:text-lco-teal";
    case "initial":
      return "text-zinc-500 dark:text-zinc-400";
    case "opname":
      return "text-sky-700 dark:text-sky-400";
    case "adjustment":
    case "gift":
      return "text-lco-mustard";
  }
}

export type StockStatus = "habis" | "menipis" | "aman";

/**
 * Status stok satu produk. Aturannya disamakan dengan penanda "stok menipis"
 * di ProdukModule (stok <= stok minimum) supaya dua layar tidak saling
 * bertentangan, ditambah pemisahan "habis" (stok 0) yang lebih mendesak.
 */
export function getStockStatus(stock: number, minStock: number): StockStatus {
  if (stock <= 0) return "habis";
  if (stock <= minStock) return "menipis";
  return "aman";
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  habis: "Habis",
  menipis: "Menipis",
  aman: "Aman",
};

export function stockStatusColorClass(status: StockStatus): string {
  switch (status) {
    case "habis":
      return "text-lco-coral";
    case "menipis":
      return "text-lco-mustard";
    case "aman":
      return "text-lco-green dark:text-lco-teal";
  }
}

/** Format YYYY-MM-DD dari Date menurut zona waktu perangkat (bukan UTC). */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
