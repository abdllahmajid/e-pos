// hooks/useActivityLogs.ts
// ── TAMBAHAN ── Hook domain Log Aktivitas (PRD §17 T-09): baca tabel
// `activity_logs` (migration 014) untuk halaman Log Aktivitas (menu LAINNYA →
// "Log Aktivitas", PRD §4.1). Read-only murni — tidak ada fungsi tulis di sini
// karena semua baris `activity_logs` HANYA boleh ditulis dari dalam RPC
// security definer (void_transaction, return_transaction, adjust_stock,
// soft_delete_product, restore_product, soft_delete_transaction,
// restore_transaction — lihat migration 014). Tidak ada dan sengaja tidak ada
// cara menulis activity_logs langsung dari client.
//
// Pola sama dengan hooks/useStock.ts (T-05): kolom `user_id` DIJAMIN FK ke
// `profiles.id` (bukan `auth.users.id` seperti sebagian tabel lama), jadi
// sebenarnya aman pakai embed PostgREST langsung. Tapi lookup nama tetap
// dipisah manual (bukan `user:profiles(full_name)`) supaya konsisten dengan
// pola yang sudah dipakai di seluruh codebase ini untuk tabel audit sejenis,
// dan supaya tidak bergantung pada Supabase berhasil mendeteksi arah relasi
// FK secara otomatis.
//
// RLS `activity_logs` (migration 014): select admin-only. Kalau non-admin
// memanggil hook ini, hasilnya array kosong (bukan bocor) — sama seperti pola
// `useStock.ts` untuk modul yang dibatasi role.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type ActivityLogAction =
  | "void_transaction"
  | "return_transaction"
  | "stock_opname"
  | "stock_adjustment"
  | "product_delete"
  | "product_restore"
  | "transaction_delete"
  | "transaction_restore";

export type ActivityLogEntity = "transaction" | "product";

/** Label Indonesia per action — dipakai tabel Log Aktivitas & filter dropdown. */
export const ACTIVITY_ACTION_LABEL: Record<ActivityLogAction, string> = {
  void_transaction: "Void Transaksi",
  return_transaction: "Retur Transaksi",
  stock_opname: "Opname Stok",
  stock_adjustment: "Penyesuaian Stok",
  product_delete: "Hapus Produk",
  product_restore: "Pulihkan Produk",
  transaction_delete: "Hapus Transaksi",
  transaction_restore: "Pulihkan Transaksi",
};

/** Warna chip ringkas: merah untuk aksi "menghilangkan", hijau untuk "mengembalikan", abu untuk netral. */
export function activityActionTone(
  action: string,
): "destructive" | "positive" | "neutral" {
  if (action === "product_restore" || action === "transaction_restore") {
    return "positive";
  }

  if (
    action === "product_delete" ||
    action === "transaction_delete" ||
    action === "void_transaction"
  ) {
    return "destructive";
  }

  return "neutral";
}

// Baris asli tabel `activity_logs` (migration 014) + hasil lookup ringan.
export interface ActivityLog {
  id: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  /** Nama user pelaku, hasil lookup manual ke `profiles` (lihat catatan atas). */
  user_name: string | null;
}

interface UseActivityLogsOptions {
  /** Filter entitas. Kosong/undefined = semua entitas. */
  entity?: ActivityLogEntity | null;
  /** Filter user pelaku. Kosong/undefined = semua user. */
  userId?: string | null;
  /** Filter satu atau beberapa jenis aksi. Kosong/undefined = semua aksi. */
  actions?: ActivityLogAction[];
  /** Batas jumlah baris yang diambil. Default 200. */
  limit?: number;
}

interface UseActivityLogsResult {
  logs: ActivityLog[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useActivityLogs(
  options: UseActivityLogsOptions = {},
): UseActivityLogsResult {
  const { entity = null, userId = null, actions, limit = 200 } = options;

  // actions adalah array — dikunci jadi string supaya aman dipakai sebagai
  // dependency useEffect (pola sama dengan `typesKey` di useStock.ts).
  const actionsKey =
    actions && actions.length > 0 ? actions.slice().sort().join(",") : "";

  const [logs, setLogs] = useState<ActivityLog[]>([]);
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
        .from("activity_logs")
        .select("id, user_id, action, entity, entity_id, meta, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (entity) {
        query = query.eq("entity", entity);
      }

      if (userId) {
        query = query.eq("user_id", userId);
      }

      if (actionsKey) {
        query = query.in("action", actionsKey.split(","));
      }

      const { data, error: fetchError } = await query;

      if (isCancelled) return;

      if (fetchError) {
        setError(fetchError.message || "Gagal memuat log aktivitas.");
        setLogs([]);
        setIsLoading(false);
        return;
      }

      type RawRow = Omit<ActivityLog, "user_name">;
      const rows = (data ?? []) as unknown as RawRow[];

      const userIds = Array.from(
        new Set(rows.map((row) => row.user_id).filter((id): id is string => !!id)),
      );

      const nameById = new Map<string, string>();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        for (const profile of profiles ?? []) {
          if (profile.full_name) nameById.set(profile.id, profile.full_name);
        }
      }

      if (isCancelled) return;

      setLogs(
        rows.map((row) => ({
          ...row,
          user_name: row.user_id ? (nameById.get(row.user_id) ?? null) : null,
        })),
      );
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [entity, userId, actionsKey, limit, reloadToken]);

  return { logs, isLoading, error, refetch };
}

/** Daftar user unik (id + nama) untuk mengisi dropdown filter "User" di UI Log Aktivitas. */
export function useActivityLogUsers() {
  const [users, setUsers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name", { ascending: true });

      if (isCancelled) return;

      setUsers(data ?? []);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, []);

  return { users, isLoading };
}