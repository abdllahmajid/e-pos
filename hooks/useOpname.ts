// hooks/useOpname.ts
// ── TAMBAHAN (Fase 2 perbaikan Stok & Opname) ── Hook domain sesi opname:
//   - useOpnameSessions(): daftar sesi + mulai sesi baru.
//   - useOpnameSession(id): satu sesi beserta semua itemnya + simpan hitungan,
//     selesaikan, batalkan.
//
// Semua tulis lewat RPC (migration 041): start_stock_opname, save_opname_count,
// finalize_stock_opname, cancel_stock_opname. Tidak ada INSERT/UPDATE langsung
// dari client — tabelnya memang hanya punya policy SELECT.
//
// Nama pembuat sesi diambil lewat satu query terpisah ke `profiles` (bukan
// embed), pola yang sama dengan useStock.ts.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type OpnameStatus = "draft" | "completed" | "cancelled";

/** Baris view `stock_opname_session_stats` + nama user hasil lookup. */
export interface OpnameSession {
  id: string;
  number: number;
  name: string;
  category_id: string | null;
  category_name: string | null;
  status: OpnameStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  finalized_by: string | null;
  finalized_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  item_count: number;
  counted_count: number;
  diff_count: number;
  diff_qty: number;
  diff_value: number;
  created_by_name: string | null;
  finalized_by_name: string | null;
}

/** Satu produk dalam sesi opname. */
export interface OpnameItem {
  id: string;
  session_id: string;
  product_id: string | null;
  product_name: string;
  product_sku: string | null;
  product_barcode: string | null;
  product_unit: string | null;
  cost_price: number | null;
  /** Stok sistem saat hitungan terakhir disimpan (atau saat sesi dimulai). */
  system_qty: number;
  /** Null = belum dihitung. */
  counted_qty: number | null;
  note: string | null;
  counted_at: string | null;
  /** Selisih yang diterapkan ke stok saat sesi diselesaikan. */
  applied_delta: number | null;
}

export interface FinalizeOpnameResult {
  number: number;
  item_count: number;
  counted_count: number;
  uncounted_count: number;
  adjusted_count: number;
  matched_count: number;
  skipped_count: number;
  plus_qty: number;
  minus_qty: number;
  diff_value: number;
}

export type OpnameCountMode = "set" | "add" | "clear" | "note";

/** Hasil simpan hitungan satu produk (dari respons RPC `save_opname_count`). */
export interface OpnameCountResult {
  system_qty: number;
  counted_qty: number | null;
  note: string | null;
  counted_at: string | null;
}

const MIGRATION_HINT =
  "Fitur sesi opname belum siap di database. Jalankan migration 041_stock_opname_sessions.sql di Supabase SQL Editor, lalu muat ulang halaman.";

function describeError(
  err: { message?: string; code?: string },
  fallback: string,
): string {
  const message = err.message ?? "";
  if (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "PGRST202" ||
    /stock_opname|start_stock_opname|save_opname_count|finalize_stock_opname|cancel_stock_opname/.test(
      message,
    )
  ) {
    // Pesan RPC buatan sendiri (mis. "Sesi opname #3 sudah selesai") ikut
    // cocok dengan pola di atas — bedakan dengan cek "tidak ditemukan di schema".
    if (/schema cache|does not exist|Could not find/.test(message)) {
      return MIGRATION_HINT;
    }
  }
  return message || fallback;
}

const SESSION_COLUMNS =
  "id, number, name, category_id, category_name, status, note, created_by, created_at, finalized_by, cancelled_by, finalized_at, cancelled_at, cancel_reason, item_count, counted_count, diff_count, diff_qty, diff_value";

type RawSession = Omit<
  OpnameSession,
  "created_by_name" | "finalized_by_name"
>;

async function attachNames(rows: RawSession[]): Promise<OpnameSession[]> {
  const ids = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.created_by, row.finalized_by])
        .filter((id): id is string => !!id),
    ),
  );

  const nameById = new Map<string, string>();

  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);

    for (const profile of profiles ?? []) {
      if (profile.full_name) nameById.set(profile.id, profile.full_name);
    }
  }

  return rows.map((row) => ({
    ...row,
    number: Number(row.number),
    item_count: Number(row.item_count),
    counted_count: Number(row.counted_count),
    diff_count: Number(row.diff_count),
    diff_qty: Number(row.diff_qty),
    diff_value: Number(row.diff_value),
    created_by_name: row.created_by ? (nameById.get(row.created_by) ?? null) : null,
    finalized_by_name: row.finalized_by
      ? (nameById.get(row.finalized_by) ?? null)
      : null,
  }));
}

// =====================================================================
// Daftar sesi
// =====================================================================

interface UseOpnameSessionsResult {
  sessions: OpnameSession[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Mulai sesi baru. Mengembalikan id sesi supaya layar bisa langsung membukanya. */
  startSession: (params: {
    name: string;
    categoryId: string | null;
    note: string;
  }) => Promise<{ sessionId: string; number: number; itemCount: number }>;
}

export function useOpnameSessions(): UseOpnameSessionsResult {
  const [sessions, setSessions] = useState<OpnameSession[]>([]);
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
        .from("stock_opname_session_stats")
        .select(SESSION_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(200);

      if (isCancelled) return;

      if (fetchError) {
        setError(describeError(fetchError, "Gagal memuat daftar sesi opname."));
        setSessions([]);
        setIsLoading(false);
        return;
      }

      const rows = await attachNames((data ?? []) as unknown as RawSession[]);

      if (isCancelled) return;

      setSessions(rows);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  const startSession = useCallback(
    async ({
      name,
      categoryId,
      note,
    }: {
      name: string;
      categoryId: string | null;
      note: string;
    }) => {
      const { data, error: rpcError } = await supabase.rpc(
        "start_stock_opname",
        {
          p_name: name.trim() || null,
          p_category_id: categoryId,
          p_note: note.trim() || null,
        },
      );

      if (rpcError) {
        console.error("start_stock_opname RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal memulai sesi opname."));
      }

      if (!data?.success) {
        throw new Error("Sesi opname gagal dibuat.");
      }

      refetch();

      return {
        sessionId: data.session_id as string,
        number: Number(data.number),
        itemCount: Number(data.item_count),
      };
    },
    [refetch],
  );

  return { sessions, isLoading, error, refetch, startSession };
}

// =====================================================================
// Satu sesi + itemnya
// =====================================================================

const ITEM_COLUMNS =
  "id, session_id, product_id, product_name, product_sku, product_barcode, product_unit, cost_price, system_qty, counted_qty, note, counted_at, applied_delta";

// PostgREST membatasi satu respons (default 1000 baris), sedangkan satu sesi
// "semua produk" bisa lebih banyak — ambil bertahap sampai habis.
const ITEM_PAGE = 1000;

interface UseOpnameSessionResult {
  session: OpnameSession | null;
  items: OpnameItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Simpan hitungan satu produk.
   * - "set": isi hasil hitung fisik (qty wajib).
   * - "add": tambah ke hitungan sekarang (mis. scan +1).
   * - "clear": hapus hitungan (kembali "belum dihitung").
   * - "note": ubah catatan saja (hitungan tidak disentuh).
   * Daftar `items` ikut diperbarui otomatis. Mengembalikan angka terbaru
   * produk itu; melempar Error kalau ditolak.
   */
  saveCount: (params: {
    productId: string;
    mode: OpnameCountMode;
    qty?: number;
    note?: string;
  }) => Promise<OpnameCountResult>;
  finalize: () => Promise<FinalizeOpnameResult>;
  cancel: (reason: string) => Promise<void>;
}

export function useOpnameSession(sessionId: string): UseOpnameSessionResult {
  const [session, setSession] = useState<OpnameSession | null>(null);
  const [items, setItems] = useState<OpnameItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const { data: sessionRow, error: sessionError } = await supabase
        .from("stock_opname_session_stats")
        .select(SESSION_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle();

      if (isCancelled) return;

      if (sessionError || !sessionRow) {
        setError(
          sessionError
            ? describeError(sessionError, "Gagal memuat sesi opname.")
            : "Sesi opname tidak ditemukan.",
        );
        setIsLoading(false);
        return;
      }

      const collected: OpnameItem[] = [];
      let from = 0;

      for (;;) {
        const { data: page, error: itemsError } = await supabase
          .from("stock_opname_items")
          .select(ITEM_COLUMNS)
          .eq("session_id", sessionId)
          .order("product_name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + ITEM_PAGE - 1);

        if (isCancelled) return;

        if (itemsError) {
          setError(describeError(itemsError, "Gagal memuat produk sesi opname."));
          setIsLoading(false);
          return;
        }

        const rows = (page ?? []) as unknown as OpnameItem[];
        collected.push(...rows);

        if (rows.length < ITEM_PAGE) break;
        from += ITEM_PAGE;
      }

      const [withNames] = await attachNames([sessionRow as unknown as RawSession]);

      if (isCancelled) return;

      setSession(withNames);
      setItems(
        collected.map((item) => ({
          ...item,
          system_qty: Number(item.system_qty),
          counted_qty:
            item.counted_qty === null ? null : Number(item.counted_qty),
          cost_price: item.cost_price === null ? null : Number(item.cost_price),
          applied_delta:
            item.applied_delta === null ? null : Number(item.applied_delta),
        })),
      );
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [sessionId, reloadToken]);

  const saveCount = useCallback(
    async ({
      productId,
      mode,
      qty,
      note,
    }: {
      productId: string;
      mode: OpnameCountMode;
      qty?: number;
      note?: string;
    }): Promise<OpnameCountResult> => {
      if ((mode === "set" || mode === "add") && !Number.isInteger(qty)) {
        throw new Error("Jumlah harus berupa angka bulat.");
      }

      const { data, error: rpcError } = await supabase.rpc("save_opname_count", {
        p_session_id: sessionId,
        p_product_id: productId,
        p_mode: mode,
        p_qty: mode === "set" || mode === "add" ? qty : null,
        p_note: note ?? null,
      });

      if (rpcError) {
        console.error("save_opname_count RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal menyimpan hitungan."));
      }

      if (!data?.success) {
        throw new Error("Hitungan gagal disimpan.");
      }

      const result: OpnameCountResult = {
        system_qty: Number(data.system_qty),
        counted_qty:
          data.counted_qty === null || data.counted_qty === undefined
            ? null
            : Number(data.counted_qty),
        note: (data.note as string | null) ?? null,
        counted_at: (data.counted_at as string | null) ?? null,
      };

      setItems((prev) =>
        prev.map((item) =>
          item.product_id === productId ? { ...item, ...result } : item,
        ),
      );

      return result;
    },
    [sessionId],
  );

  const finalize = useCallback(async (): Promise<FinalizeOpnameResult> => {
    const { data, error: rpcError } = await supabase.rpc(
      "finalize_stock_opname",
      { p_session_id: sessionId },
    );

    if (rpcError) {
      console.error("finalize_stock_opname RPC error:", rpcError);
      throw new Error(describeError(rpcError, "Gagal menyelesaikan opname."));
    }

    if (!data?.success) {
      throw new Error("Sesi opname gagal diselesaikan.");
    }

    refetch();

    return {
      number: Number(data.number),
      item_count: Number(data.item_count),
      counted_count: Number(data.counted_count),
      uncounted_count: Number(data.uncounted_count),
      adjusted_count: Number(data.adjusted_count),
      matched_count: Number(data.matched_count),
      skipped_count: Number(data.skipped_count),
      plus_qty: Number(data.plus_qty),
      minus_qty: Number(data.minus_qty),
      diff_value: Number(data.diff_value),
    };
  }, [sessionId, refetch]);

  const cancel = useCallback(
    async (reason: string): Promise<void> => {
      if (!reason || reason.trim() === "") {
        throw new Error("Alasan pembatalan wajib diisi.");
      }

      const { data, error: rpcError } = await supabase.rpc(
        "cancel_stock_opname",
        { p_session_id: sessionId, p_reason: reason.trim() },
      );

      if (rpcError) {
        console.error("cancel_stock_opname RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal membatalkan sesi opname."));
      }

      if (!data?.success) {
        throw new Error("Sesi opname gagal dibatalkan.");
      }

      refetch();
    },
    [sessionId, refetch],
  );

  return {
    session,
    items,
    isLoading,
    error,
    refetch,
    saveCount,
    finalize,
    cancel,
  };
}
