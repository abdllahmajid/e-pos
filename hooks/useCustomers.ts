// hooks/useCustomers.ts
// ── TAMBAHAN (Kasir: pelanggan + poin loyalitas) ── Konsumen tabel `customers`
// & fungsi `redeem_loyalty_points` (migration 033_customers_loyalty.sql).
// Dipakai satu-satunya oleh app/components/kasir/KasirModule.tsx untuk fitur
// "Memilih Pelanggan (Opsional)" di flow Kasir yang baru.
//
// Pola sengaja disamakan dengan hooks/useProducts.ts (search dilakukan di
// CLIENT dari daftar yang sudah dimuat, bukan query per-keystroke ke server)
// — jumlah pelanggan toko kecil/menengah tidak akan sampai bikin ini berat,
// dan ini menghindari race condition/debounce yang tidak perlu.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  loyalty_points: number;
}

interface UseCustomersResult {
  customers: Customer[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Tambah pelanggan baru (dipakai kalau pencarian tidak menemukan nama yang dicari). */
  addCustomer: (name: string, phone?: string) => Promise<Customer>;
  /**
   * Kurangi poin pelanggan secara atomik lewat RPC `redeem_loyalty_points`.
   * Panggil ini SETELAH transaksi berhasil disimpan, bukan sebelumnya —
   * supaya poin tidak berkurang kalau pembayarannya sendiri gagal.
   */
  redeemPoints: (customerId: string, points: number) => Promise<void>;
}

export function useCustomers(): UseCustomersResult {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("customers")
        .select("id, name, phone, loyalty_points")
        .order("name", { ascending: true });

      if (isCancelled) return;

      if (fetchError) {
        setError(fetchError.message || "Gagal memuat data pelanggan.");
        setCustomers([]);
        setIsLoading(false);
        return;
      }

      setCustomers((data ?? []) as Customer[]);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  const addCustomer = useCallback(
    async (name: string, phone?: string): Promise<Customer> => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Nama pelanggan wajib diisi.");
      }

      const { data, error: insertError } = await supabase
        .from("customers")
        .insert({ name: trimmedName, phone: phone?.trim() || null })
        .select("id, name, phone, loyalty_points")
        .single();

      if (insertError || !data) {
        throw new Error(insertError?.message || "Gagal menambah pelanggan.");
      }

      refetch();
      return data as Customer;
    },
    [refetch],
  );

  const redeemPoints = useCallback(
    async (customerId: string, points: number) => {
      if (points <= 0) return;

      const { error: rpcError } = await supabase.rpc(
        "redeem_loyalty_points",
        { p_customer_id: customerId, p_points: points },
      );

      if (rpcError) {
        throw new Error(rpcError.message || "Gagal memakai poin loyalitas.");
      }

      refetch();
    },
    [refetch],
  );

  return { customers, isLoading, error, refetch, addCustomer, redeemPoints };
}