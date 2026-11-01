// hooks/useStock.ts
// ── REVISI (Fase 1 perbaikan Stok & Opname) ── Hook domain Stok & Opname:
// baca kartu stok dari view `stock_ledger` (migration 037) + total masuk/keluar
// dari RPC `stock_movement_summary` + aksi opname/penyesuaian manual.
//
// Perubahan dari versi sebelumnya:
// - Baca dari view `stock_ledger` (bukan tabel `stock_movements` + embed produk).
//   View itu sudah membawa nama/SKU/satuan produk dan `stock_after` (saldo stok
//   sesudah mutasi), jadi tidak perlu embed PostgREST lagi.
// - Filter tanggal + produk + jenis, dan paging (bukan lagi "150 baris terakhir").
// - `summary` (stok masuk / keluar / jumlah mutasi) dihitung di database untuk
//   SELURUH baris yang cocok dengan filter, bukan dijumlah dari baris yang tampil.
//
// Yang TIDAK berubah:
// - Tulis tetap WAJIB lewat RPC `adjust_stock` (migration 009/031). Tidak ada
//   UPDATE `products.stock` langsung dari client.
// - Nama pembuat mutasi tetap diambil lewat satu query terpisah ke `profiles`
//   (bukan embed), karena bentuk FK `created_by` tidak seragam antar database.

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

// Satu baris kartu stok (view `stock_ledger`, migration 037).
export interface StockMovement {
  id: string;
  product_id: string | null;
  type: StockMovementType;
  qty_delta: number;
  reference_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  /** Null kalau produknya sudah dihapus permanen. */
  product_name: string | null;
  product_sku: string | null;
  product_unit: string | null;
  /** Saldo stok SESUDAH mutasi ini. Null kalau produk sudah dihapus permanen. */
  stock_after: number | null;
  /** Saldo stok SEBELUM mutasi ini (= stock_after - qty_delta). */
  stock_before: number | null;
  /** Nama user pembuat mutasi, hasil lookup manual ke `profiles`. */
  created_by_name: string | null;
}

export interface StockSummary {
  masuk: number;
  keluar: number;
  jumlah: number;
}

export interface AdjustStockResult {
  movement_id: string;
  product_id: string;
  product_name: string;
  old_stock: number;
  qty_delta: number;
  new_stock: number;
}

export const STOCK_PAGE_SIZE = 50;

interface UseStockOptions {
  /** Batasi ke satu produk (kartu stok per produk). Kosong = semua produk. */
  productId?: string | null;
  /** Filter jenis mutasi. Kosong/undefined = semua jenis. */
  types?: StockMovementType[];
  /** Tanggal awal (YYYY-MM-DD, zona waktu perangkat), inklusif. Kosong = tanpa batas. */
  dateFrom?: string;
  /** Tanggal akhir (YYYY-MM-DD, zona waktu perangkat), inklusif. Kosong = tanpa batas. */
  dateTo?: string;
  /** Halaman, mulai dari 0. */
  page?: number;
  /** Jumlah baris per halaman. Default 50. */
  pageSize?: number;
}

interface UseStockResult {
  movements: StockMovement[];
  /** Jumlah SELURUH baris yang cocok dengan filter (bukan cuma halaman ini). */
  totalCount: number;
  /** Total masuk/keluar/jumlah untuk filter yang sama. Null selagi memuat / gagal. */
  summary: StockSummary | null;
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

/** Awal hari (zona waktu perangkat) dari string YYYY-MM-DD, dalam ISO UTC. */
function startOfDayIso(dateStr: string | undefined): string | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Awal HARI BERIKUTNYA — dipakai sebagai batas atas eksklusif untuk "sampai tanggal". */
function startOfNextDayIso(dateStr: string | undefined): string | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

const MIGRATION_HINT =
  "Kartu stok belum siap di database. Jalankan migration 037_stock_ledger.sql di Supabase SQL Editor, lalu muat ulang halaman.";

function describeLoadError(err: { message?: string; code?: string }): string {
  const message = err.message ?? "";
  if (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "PGRST202" ||
    /stock_ledger|stock_movement_summary/.test(message)
  ) {
    return MIGRATION_HINT;
  }
  return message || "Gagal memuat riwayat mutasi stok.";
}

export function useStock(options: UseStockOptions = {}): UseStockResult {
  const {
    productId = null,
    types,
    dateFrom = "",
    dateTo = "",
    page = 0,
    pageSize = STOCK_PAGE_SIZE,
  } = options;

  // types adalah array — kalau dipakai langsung sebagai dependency useEffect,
  // pemanggil yang menulis literal `["opname"]` inline akan memicu fetch ulang
  // tiap render. Dikunci jadi string supaya perbandingannya by value.
  const typesKey = types && types.length > 0 ? types.slice().sort().join(",") : "";

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  // ---------------- Baris kartu stok (per halaman) ----------------
  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const fromIso = startOfDayIso(dateFrom);
      const toIso = startOfNextDayIso(dateTo);
      const rangeStart = page * pageSize;

      let query = supabase
        .from("stock_ledger")
        .select(
          "id, product_id, type, qty_delta, reference_id, reason, created_by, created_at, product_name, product_sku, product_unit, stock_after",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(rangeStart, rangeStart + pageSize - 1);

      if (productId) query = query.eq("product_id", productId);
      if (typesKey) query = query.in("type", typesKey.split(","));
      if (fromIso) query = query.gte("created_at", fromIso);
      if (toIso) query = query.lt("created_at", toIso);

      const { data, error: fetchError, count } = await query;

      if (isCancelled) return;

      if (fetchError) {
        // Halaman di luar jumlah data (mis. data berkurang sesudah filter
        // berubah) bukan error sungguhan — tampilkan kosong, pemanggil yang
        // mengembalikan ke halaman pertama.
        if (fetchError.code === "PGRST103") {
          setMovements([]);
          setTotalCount(0);
          setIsLoading(false);
          return;
        }

        setError(describeLoadError(fetchError));
        setMovements([]);
        setTotalCount(0);
        setIsLoading(false);
        return;
      }

      type RawRow = Omit<
        StockMovement,
        "created_by_name" | "stock_before"
      >;

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
          const qtyDelta = Number(row.qty_delta ?? 0);
          const stockAfter =
            row.stock_after === null || row.stock_after === undefined
              ? null
              : Number(row.stock_after);

          return {
            id: row.id,
            product_id: row.product_id,
            type: row.type,
            qty_delta: qtyDelta,
            reference_id: row.reference_id,
            reason: row.reason,
            created_by: row.created_by,
            created_at: row.created_at,
            product_name: row.product_name ?? null,
            product_sku: row.product_sku ?? null,
            product_unit: row.product_unit ?? null,
            stock_after: stockAfter,
            stock_before: stockAfter === null ? null : stockAfter - qtyDelta,
            created_by_name: row.created_by
              ? (nameById.get(row.created_by) ?? null)
              : null,
          };
        }),
      );
      setTotalCount(count ?? rows.length);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [productId, typesKey, dateFrom, dateTo, page, pageSize, reloadToken]);

  // ---------------- Ringkasan (seluruh baris sesuai filter) ----------------
  // Sengaja tidak bergantung pada `page`: total tidak berubah saat pindah halaman.
  useEffect(() => {
    let isCancelled = false;

    async function loadSummary() {
      const { data, error: rpcError } = await supabase.rpc(
        "stock_movement_summary",
        {
          p_from: startOfDayIso(dateFrom),
          p_to: startOfNextDayIso(dateTo),
          p_product_id: productId,
          p_types: typesKey ? typesKey.split(",") : null,
        },
      );

      if (isCancelled) return;

      if (rpcError || !data) {
        // Kegagalan ringkasan tidak menimpa error utama — kartu cukup tampil "-".
        setSummary(null);
        return;
      }

      setSummary({
        masuk: Number(data.masuk ?? 0),
        keluar: Number(data.keluar ?? 0),
        jumlah: Number(data.jumlah ?? 0),
      });
    }

    loadSummary();

    return () => {
      isCancelled = true;
    };
  }, [productId, typesKey, dateFrom, dateTo, reloadToken]);

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

  return {
    movements,
    totalCount,
    summary,
    isLoading,
    error,
    refetch,
    adjustStock,
  };
}
