// app/components/stok/opnameUtils.ts
// Helper murni untuk tampilan sesi opname (Fase 2): label & warna status,
// dan hitung ringkasan selisih dari daftar item.

import type { OpnameItem, OpnameStatus } from "@/hooks/useOpname";

export const OPNAME_STATUS_LABEL: Record<OpnameStatus, string> = {
  draft: "Berjalan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export function opnameStatusColorClass(status: OpnameStatus): string {
  switch (status) {
    case "draft":
      return "text-lco-mustard";
    case "completed":
      return "text-lco-green dark:text-lco-teal";
    case "cancelled":
      return "text-zinc-500 dark:text-zinc-400";
  }
}

/** Selisih satu item; null kalau belum dihitung. */
export function itemDiff(item: OpnameItem): number | null {
  return item.counted_qty === null ? null : item.counted_qty - item.system_qty;
}

export interface OpnameStats {
  total: number;
  counted: number;
  uncounted: number;
  /** Produk yang dihitung dan hasilnya sama dengan stok sistem. */
  matched: number;
  /** Produk yang dihitung dan hasilnya berbeda. */
  withDiff: number;
  plusQty: number;
  minusQty: number;
  /** Selisih bersih dalam rupiah (harga modal). Negatif = kerugian. */
  diffValue: number;
}

export function computeOpnameStats(items: OpnameItem[]): OpnameStats {
  const stats: OpnameStats = {
    total: items.length,
    counted: 0,
    uncounted: 0,
    matched: 0,
    withDiff: 0,
    plusQty: 0,
    minusQty: 0,
    diffValue: 0,
  };

  for (const item of items) {
    const diff = itemDiff(item);

    if (diff === null) {
      stats.uncounted += 1;
      continue;
    }

    stats.counted += 1;

    if (diff === 0) {
      stats.matched += 1;
      continue;
    }

    stats.withDiff += 1;
    if (diff > 0) stats.plusQty += diff;
    else stats.minusQty += -diff;
    stats.diffValue += diff * (item.cost_price ?? 0);
  }

  return stats;
}
