// hooks/useCategories.ts
// ── TAMBAHAN ── Hook domain Kategori: fetch data asli dari Supabase untuk chip filter di Kasir & CRUD di Produk.
// ── KOREKSI ── Ganti dari client lama (@/lib/supabase, localStorage-based) ke client
// cookie-based (@/lib/supabase/client) supaya sesi login ikut terbawa & auth.uid() valid.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Category } from "@/lib/pos/types";

const supabase = createClient();

interface UseCategoriesResult {
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Hanya kategori aktif, diurutkan sesuai sort_order (posisi chip mengikuti pengaturan admin)
    const { data, error: fetchError } = await supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setCategories([]);
    } else {
      setCategories((data ?? []) as Category[]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  return { categories, isLoading, error, refetch: fetchCategories };
}