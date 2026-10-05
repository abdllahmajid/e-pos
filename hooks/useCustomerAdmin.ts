// hooks/useCustomerAdmin.ts
// ── TAMBAHAN (menu Pelanggan, migration 035) ── Hook data untuk layar
// manajemen pelanggan (PelangganModule.tsx). SENGAJA terpisah dari
// hooks/useCustomers.ts (dipakai Kasir): hook Kasir ringan & hanya memuat
// pelanggan aktif, sedangkan layar ini butuh semua kolom profil, pelanggan
// yang diarsipkan, statistik belanja, dan riwayat.
//
// Statistik (jumlah transaksi, total belanja, piutang) datang dari RPC
// `get_customer_stats` — keterkaitan transaksi <-> pelanggan dihitung di
// database (no. HP / nama unik), lihat header migration 035.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string | null;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerStats {
  trxCount: number;
  totalSpent: number;
  lastTrxAt: string | null;
  outstanding: number;
}

export type CustomerWithStats = CustomerRecord & CustomerStats;

// Pendaftaran sederhana ala member minimarket: no. HP wajib, nama opsional.
export interface CustomerFormValues {
  phone: string;
  name: string;
}

export interface CustomerTransaction {
  id: string;
  receipt_no: string;
  status: string;
  total: number;
  created_at: string;
  methods: string;
  tempo_outstanding: number;
}

export interface PointLog {
  id: string;
  type: "adjust" | "redeem";
  points_delta: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
}

const CUSTOMER_COLUMNS =
  "id, name, phone, loyalty_points, is_active, created_at, updated_at";

const EMPTY_STATS: CustomerStats = {
  trxCount: 0,
  totalSpent: 0,
  lastTrxAt: null,
  outstanding: 0,
};

/** Samakan dengan public.normalize_phone() di database (format 62xxx). */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

/**
 * Pelanggan "tanpa nama": nama kosong saat daftar → disimpan sama dengan
 * no. HP (kolom `name` NOT NULL & dipakai Kasir). UI menampilkannya sebagai
 * "Tanpa nama" supaya tidak terlihat nomor dua kali.
 */
export function isNamelessCustomer(c: Pick<CustomerRecord, "name" | "phone">): boolean {
  const nameDigits = normalizePhone(c.name);
  return nameDigits !== "" && nameDigits === normalizePhone(c.phone);
}

function toPayload(values: CustomerFormValues) {
  const phone = values.phone.trim();
  if (!phone) throw new Error("No. HP wajib diisi.");
  if (!/^[+\d\s().-]+$/.test(phone)) {
    throw new Error("No. HP hanya boleh berisi angka.");
  }
  if (normalizePhone(phone).length < 9) {
    throw new Error("No. HP terlalu pendek.");
  }

  return {
    phone,
    // Nama kosong → pakai no. HP (lihat isNamelessCustomer).
    name: values.name.trim() || phone,
  };
}

interface UseCustomerAdminResult {
  customers: CustomerWithStats[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createCustomer: (values: CustomerFormValues) => Promise<void>;
  updateCustomer: (id: string, values: CustomerFormValues) => Promise<void>;
  setActive: (id: string, active: boolean) => Promise<void>;
  adjustPoints: (id: string, delta: number, reason: string) => Promise<void>;
  fetchTransactions: (id: string) => Promise<CustomerTransaction[]>;
  fetchPointLogs: (id: string) => Promise<PointLog[]>;
}

export function useCustomerAdmin(): UseCustomerAdminResult {
  const [customers, setCustomers] = useState<CustomerWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const [customerRes, statsRes] = await Promise.all([
        supabase
          .from("customers")
          .select(CUSTOMER_COLUMNS)
          .order("name", { ascending: true }),
        supabase.rpc("get_customer_stats"),
      ]);

      if (isCancelled) return;

      if (customerRes.error) {
        setError(customerRes.error.message || "Gagal memuat data pelanggan.");
        setCustomers([]);
        setIsLoading(false);
        return;
      }

      // Statistik gagal (mis. permission belum ada) tidak boleh menjatuhkan
      // seluruh daftar — tampilkan pelanggan dengan statistik kosong.
      const statsMap = new Map<string, CustomerStats>();
      if (!statsRes.error) {
        for (const row of (statsRes.data ?? []) as Array<{
          customer_id: string;
          trx_count: number | string;
          total_spent: number | string;
          last_trx_at: string | null;
          outstanding: number | string;
        }>) {
          statsMap.set(row.customer_id, {
            trxCount: Number(row.trx_count),
            totalSpent: Number(row.total_spent),
            lastTrxAt: row.last_trx_at,
            outstanding: Number(row.outstanding),
          });
        }
      }

      setCustomers(
        ((customerRes.data ?? []) as CustomerRecord[]).map((c) => ({
          ...c,
          ...(statsMap.get(c.id) ?? EMPTY_STATS),
        })),
      );
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  const createCustomer = useCallback(
    async (values: CustomerFormValues) => {
      const payload = toPayload(values);
      const { data: userData } = await supabase.auth.getUser();

      const { error: insertError } = await supabase
        .from("customers")
        .insert({ ...payload, created_by: userData.user?.id ?? null });

      if (insertError) {
        throw new Error(insertError.message || "Gagal menambah pelanggan.");
      }
      refetch();
    },
    [refetch],
  );

  const updateCustomer = useCallback(
    async (id: string, values: CustomerFormValues) => {
      const payload = toPayload(values);

      const { data, error: updateError } = await supabase
        .from("customers")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");

      if (updateError) {
        throw new Error(updateError.message || "Gagal menyimpan perubahan.");
      }
      // RLS yang menolak UPDATE tidak melempar error — hanya 0 baris.
      if (!data || data.length === 0) {
        throw new Error("Perubahan ditolak. Anda tidak punya izin mengubah pelanggan.");
      }
      refetch();
    },
    [refetch],
  );

  const setActive = useCallback(
    async (id: string, active: boolean) => {
      const { error: rpcError } = await supabase.rpc("set_customer_active", {
        p_customer_id: id,
        p_active: active,
      });
      if (rpcError) {
        throw new Error(rpcError.message || "Gagal mengubah status pelanggan.");
      }
      refetch();
    },
    [refetch],
  );

  const adjustPoints = useCallback(
    async (id: string, delta: number, reason: string) => {
      const { error: rpcError } = await supabase.rpc("adjust_customer_points", {
        p_customer_id: id,
        p_delta: delta,
        p_reason: reason,
      });
      if (rpcError) {
        throw new Error(rpcError.message || "Gagal menyesuaikan poin.");
      }
      refetch();
    },
    [refetch],
  );

  const fetchTransactions = useCallback(
    async (id: string): Promise<CustomerTransaction[]> => {
      const { data, error: rpcError } = await supabase.rpc(
        "get_customer_transactions",
        { p_customer_id: id },
      );
      if (rpcError) {
        throw new Error(rpcError.message || "Gagal memuat riwayat transaksi.");
      }
      return ((data ?? []) as Array<CustomerTransaction & { total: number | string; tempo_outstanding: number | string }>).map(
        (row) => ({
          ...row,
          total: Number(row.total),
          tempo_outstanding: Number(row.tempo_outstanding),
        }),
      );
    },
    [],
  );

  const fetchPointLogs = useCallback(async (id: string): Promise<PointLog[]> => {
    const { data, error: fetchError } = await supabase
      .from("customer_point_logs")
      .select("id, type, points_delta, balance_after, reason, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (fetchError) {
      throw new Error(fetchError.message || "Gagal memuat riwayat poin.");
    }
    return (data ?? []) as PointLog[];
  }, []);

  return {
    customers,
    isLoading,
    error,
    refetch,
    createCustomer,
    updateCustomer,
    setActive,
    adjustPoints,
    fetchTransactions,
    fetchPointLogs,
  };
}