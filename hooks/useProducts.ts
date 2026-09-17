// hooks/useProducts.ts
// ── TAMBAHAN ── Hook domain Produk: fetch data asli dari Supabase, menggantikan DUMMY_PRODUCTS di KasirModule.
// ── KOREKSI ── Tambah opsi includeInactive: layar Kasir hanya boleh menampilkan produk aktif,
// tapi layar admin Produk wajib bisa melihat & mengelola produk nonaktif juga (agar bisa diaktifkan kembali).
// Tanpa opsi ini, produk yang dinonaktifkan admin akan hilang total dari daftar admin — tidak bisa dikelola lagi.
// ── KOREKSI ── Ganti dari client lama (@/lib/supabase, localStorage-based) ke client
// cookie-based (@/lib/supabase/client) supaya sesi login ikut terbawa & auth.uid() valid.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Category, Product } from "@/lib/pos/types";

const supabase = createClient();

// Produk hasil query, sudah di-join dengan kategorinya (untuk chip filter & label kategori)
export interface ProductWithCategory extends Product {
  category: Category | null;
}

interface UseProductsOptions {
  /**
   * false (default) → hanya produk aktif, dipakai layar Kasir.
   * true → semua produk (aktif & nonaktif), dipakai layar admin Produk.
   * Soft-deleted (deleted_at terisi) selalu dikecualikan di kedua mode.
   */
  includeInactive?: boolean;
}

interface UseProductsResult {
  products: ProductWithCategory[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useProducts(
  options: UseProductsOptions = {},
): UseProductsResult {
  const { includeInactive = false } = options;

  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    let query = supabase
      .from("products")
      .select("*, category:categories(*)")
      .is("deleted_at", null)
      .order("name", { ascending: true });

    // Kasir (PRD §4.2): katalog hanya boleh menampilkan produk aktif.
    // Admin Produk (PRD §4.3): wajib melihat semua, termasuk nonaktif, untuk dikelola.
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      setProducts([]);
    } else {
      setProducts((data ?? []) as ProductWithCategory[]);
    }

    setIsLoading(false);
  }, [includeInactive]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // refetch dipakai manual setelah transaksi sukses, supaya angka stok di katalog langsung update
  return { products, isLoading, error, refetch: fetchProducts };
}