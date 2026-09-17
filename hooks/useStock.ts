// hooks/useStock.ts
// ── TAMBAHAN ── Hook domain Stok & Opname (PRD §17 T-05): baca riwayat mutasi stok
// dari tabel `stock_movements` (migration 009) + aksi opname/penyesuaian manual.
// Konsumen pertama: app/components/stok/StokModule.tsx.
//
// Pembagian tanggung jawab (pola sama dengan useShifts.ts):
// - Baca: SELECT langsung dari client. Dijaga RLS `stock_movements_select_supervisor`
//   (migration 009) — kasir memang tidak boleh lihat modul ini sama sekali (PRD §5),
//   jadi kalau kasir nekat memanggil hook ini, hasilnya array kosong, bukan bocor.
// - Tulis: WAJIB lewat RPC `adjust_stock` (migration 009). Tidak ada policy INSERT
//   untuk `stock_movements` dan tidak boleh ada UPDATE `products.stock` langsung dari
//   client — kalau stok diubah dari client, jejak auditnya bisa tidak ikut tertulis
//   dan invariant "setiap perubahan stok ada mutasinya" bocor (Aturan Main #5 PRD).
//
// Catatan join `created_by`: SENGAJA tidak pakai embed PostgREST
// (`creator:profiles(full_name)`). Alasannya, di database yang dibuat lewat
// `scripts/setup-database.sql` kolom itu FK ke `profiles`, sementara versi tabel di
// migration 004 FK-nya ke `auth.users` — embed akan patah di salah satu jalur. Jadi
// nama user diambil lewat satu query terpisah ke `profiles` lalu digabung di sini
// (jumlah user sedikit, cukup murah, dan tidak bergantung pada bentuk FK).

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type StockMovementType =
  | "sale"
  | "return"
  | "void"
  | "opname"
  | "adjustment";

/** Jenis mutasi yang bisa dibuat manual dari UI (sisanya otomatis dari RPC transaksi). */
export type ManualMovementType = Extract<
  StockMovementType,
  "opname" | "adjustment"
>;

/** Label Indonesia untuk tiap jenis mutasi — dipakai tabel riwayat & filter. */
export const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  sale: "Penjualan",
  return: "Retur Masuk",
  void: "Void Transaksi",
  opname: "Opname",
  adjustment: "Penyesuaian",
};

// Baris asli tabel `stock_movements` (migration 009) + hasil join ringan.
export interface StockMovement {
  id: string;
  product_id: string | null;
  type: StockMovementType;
  qty_delta: number;
  reference_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  /** Diambil dari embed `products` — null kalau produknya sudah dihapus permanen. */
  product_name: string | null;
  product_sku: string | null;
  /** Nama user pembuat mutasi, hasil lookup manual ke `profiles` (lihat catatan atas). */
  created_by_name: string | null;
}

export interface AdjustStockResult {
  movement_id: string;
  product_id: string;
  product_name: string;
  old_stock: number;
  qty_delta: number;
  new_stock: number;
}

interface UseStockOptions {
  /** Batasi ke satu produk (kartu stok per produk). Kosong = semua produk. */
  productId?: string | null;
  /** Filter jenis mutasi. Kosong/undefined = semua jenis. */
  types?: StockMovementType[];
  /** Batas jumlah baris riwayat yang diambil. Default 100. */
  limit?: number;
}

interface UseStockResult {
  movements: StockMovement[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Opname / penyesuaian manual lewat RPC `adjust_stock`.
   *
   * - type "opname": `value` = HASIL HITUNG FISIK (stok sebenarnya di rak).
   *   Selisihnya dihitung server, bukan di sini.
   * - type "adjustment": `value` = SELISIH langsung (positif = tambah,
   *   negatif = kurang), untuk barang rusak/hilang/koreksi salah input.
   *
   * `reason` wajib — divalidasi ringan di sini untuk UX, dan ditegakkan lagi di
   * RPC + check constraint tabel.
   */
  adjustStock: (params: {
    productId: string;
    type: ManualMovementType;
    value: number;
    reason: string;
  }) => Promise<AdjustStockResult>;
}

export function useStock(options: UseStockOptions = {}): UseStockResult {
  const { productId = null, types, limit = 100 } = options;

  // types adalah array — kalau dipakai langsung sebagai dependency useEffect,
  // pemanggil yang menulis literal `["opname"]` inline akan memicu fetch ulang
  // tiap render. Dikunci jadi string supaya perbandingannya by value.
  const typesKey = types && types.length > 0 ? types.slice().sort().join(",") : "";

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      let query = supabase
        .from("stock_movements")
        .select(
          "id, product_id, type, qty_delta, reference_id, reason, created_by, created_at, product:products(name, sku)",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (productId) {
        query = query.eq("product_id", productId);
      }

      if (typesKey) {
        query = query.in("type", typesKey.split(","));
      }

      const { data, error: fetchError } = await query;

      if (isCancelled) return;

      if (fetchError) {
        setError(fetchError.message || "Gagal memuat riwayat mutasi stok.");
        setMovements([]);
        setIsLoading(false);
        return;
      }

      type RawRow = Omit<
        StockMovement,
        "product_name" | "product_sku" | "created_by_name"
      > & {
        // PostgREST mengembalikan relasi to-one bisa sebagai objek atau array,
        // tergantung cara FK terbaca — ditangani dua-duanya supaya aman.
        product: { name: string; sku: string | null } | { name: string; sku: string | null }[] | null;
      };

      const rows = (data ?? []) as unknown as RawRow[];

      // Lookup nama pembuat mutasi sekali untuk semua baris (lihat catatan di
      // header file soal kenapa tidak pakai embed).
      const creatorIds = Array.from(
        new Set(rows.map((row) => row.created_by).filter((id): id is string => !!id)),
      );

      const nameById = new Map<string, string>();

      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", creatorIds);

        for (const profile of profiles ?? []) {
          if (profile.full_name) nameById.set(profile.id, profile.full_name);
        }
      }

      if (isCancelled) return;

      setMovements(
        rows.map((row) => {
          const product = Array.isArray(row.product) ? row.product[0] : row.product;

          return {
            id: row.id,
            product_id: row.product_id,
            type: row.type,
            qty_delta: Number(row.qty_delta ?? 0),
            reference_id: row.reference_id,
            reason: row.reason,
            created_by: row.created_by,
            created_at: row.created_at,
            product_name: product?.name ?? null,
            product_sku: product?.sku ?? null,
            created_by_name: row.created_by
              ? (nameById.get(row.created_by) ?? null)
              : null,
          };
        }),
      );
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [productId, typesKey, limit, reloadToken]);

  const adjustStock = useCallback(
    async ({
      productId: targetProductId,
      type,
      value,
      reason,
    }: {
      productId: string;
      type: ManualMovementType;
      value: number;
      reason: string;
    }): Promise<AdjustStockResult> => {
      // Validasi ringan untuk UX saja — yang mengikat tetap RPC `adjust_stock`
      // (permission, stok minus, alasan kosong) dan check constraint tabel.
      if (!targetProductId) {
        throw new Error("Produk belum dipilih.");
      }

      if (!reason || reason.trim() === "") {
        throw new Error("Alasan wajib diisi untuk mutasi stok manual.");
      }

      if (!Number.isInteger(value)) {
        throw new Error("Jumlah harus berupa angka bulat.");
      }

      if (type === "opname" && value < 0) {
        throw new Error("Hasil hitung fisik tidak boleh negatif.");
      }

      if (type === "adjustment" && value === 0) {
        throw new Error("Penyesuaian 0 tidak ada artinya — isi jumlah plus atau minus.");
      }

      const { data, error: rpcError } = await supabase.rpc("adjust_stock", {
        p_product_id: targetProductId,
        p_type: type,
        p_value: value,
        p_reason: reason.trim(),
      });

      if (rpcError) {
        console.error("adjust_stock RPC error:", rpcError);
        throw new Error(rpcError.message || "Gagal menyimpan mutasi stok.");
      }

      if (!data?.success) {
        throw new Error("Mutasi stok gagal disimpan.");
      }

      refetch();

      return {
        movement_id: data.movement_id,
        product_id: data.product_id,
        product_name: data.product_name,
        old_stock: Number(data.old_stock ?? 0),
        qty_delta: Number(data.qty_delta ?? 0),
        new_stock: Number(data.new_stock ?? 0),
      };
    },
    [refetch],
  );

  return { movements, isLoading, error, refetch, adjustStock };
}