// hooks/useTrash.ts
// ── TAMBAHAN ── Hook domain Sampah (PRD §17 T-09): baca produk & transaksi
// yang sudah di-soft-delete (`deleted_at IS NOT NULL`), untuk halaman Sampah
// (menu LAINNYA → "Sampah", PRD §4.1, admin only — PRD §5 baris `trash`).
//
// SENGAJA dipisah dari `hooks/useProducts.ts` dan `hooks/useTransactions.ts`
// (bukan ditambah opsi `includeDeleted` di sana): kedua hook itu dipakai di
// jalur UTAMA aplikasi (Kasir, Riwayat Transaksi, Dashboard, Laporan) dan
// query-nya sudah cukup berat (join kategori / payments / count item).
// Menambah cabang logika "kalau includeDeleted, balik filter-nya" di situ
// cuma menambah risiko salah pakai di tempat yang salah (mis. lupa set
// includeDeleted=false lalu produk terhapus muncul di katalog Kasir).
// Query di sini SENGAJA ringan (field seperlunya untuk daftar Sampah saja),
// tidak reuse shape `ProductWithCategory`/`TransactionListItem`.
//
// Tulis (restore): reuse `restoreProduct()` dari `lib/pos/productLogic.ts`
// dan `restoreTransaction()` dari `lib/pos/transactionApi.ts` — RPC-nya
// sendiri (migration 014) sudah menegakkan admin-only, hook ini tidak
// mengecek role lagi (biar satu sumber kebenaran permission ada di database).

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { restoreProduct as restoreProductRpc } from "@/lib/pos/productLogic";
import { restoreTransaction as restoreTransactionRpc } from "@/lib/pos/transactionApi";
import type { ProductType } from "@/lib/pos/types";

const supabase = createClient();

export interface TrashedProduct {
  id: string;
  name: string;
  sku: string;
  type: ProductType;
  sell_price: number;
  stock: number;
  photo_url: string | null;
  deleted_at: string;
}

export interface TrashedTransaction {
  id: string;
  receipt_no: string;
  status: "PAID" | "VOID" | "RETURN";
  total: number;
  customer_name: string | null;
  created_at: string;
  deleted_at: string;
}

interface UseTrashResult {
  products: TrashedProduct[];
  transactions: TrashedTransaction[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Pulihkan produk dari Sampah. Melempar Error kalau gagal (mis. bukan admin). */
  restoreProduct: (productId: string) => Promise<void>;
  /** Pulihkan transaksi dari Sampah. Melempar Error kalau gagal (mis. bukan admin). */
  restoreTransaction: (transactionId: string) => Promise<void>;
}

export function useTrash(): UseTrashResult {
  const [products, setProducts] = useState<TrashedProduct[]>([]);
  const [transactions, setTransactions] = useState<TrashedTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const [productsRes, transactionsRes] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, sku, type, sell_price, stock, photo_url, deleted_at")
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false }),
        supabase
          .from("transactions")
          .select("id, receipt_no, status, total, customer_name, created_at, deleted_at")
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false }),
      ]);

      if (isCancelled) return;

      // Dua sumber independen — kalau salah satu gagal, yang lain tetap
      // ditampilkan (bukan all-or-nothing), supaya satu tabel bermasalah
      // tidak membuat seluruh halaman Sampah kosong.
      const errors = [productsRes.error, transactionsRes.error].filter(
        (e): e is NonNullable<typeof e> => !!e,
      );

      if (errors.length > 0) {
        setError(errors.map((e) => e.message).join(" / "));
      }

      setProducts((productsRes.data ?? []) as TrashedProduct[]);
      setTransactions((transactionsRes.data ?? []) as TrashedTransaction[]);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  const restoreProduct = useCallback(
    async (productId: string) => {
      const result = await restoreProductRpc(productId);

      if (!result.success) {
        throw new Error(result.error);
      }

      refetch();
    },
    [refetch],
  );

  const restoreTransaction = useCallback(
    async (transactionId: string) => {
      await restoreTransactionRpc(transactionId);
      refetch();
    },
    [refetch],
  );

  return {
    products,
    transactions,
    isLoading,
    error,
    refetch,
    restoreProduct,
    restoreTransaction,
  };
}