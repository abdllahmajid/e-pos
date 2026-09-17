// hooks/useShifts.ts
// ── TAMBAHAN ── Hook domain Shift Kasir (PRD §17 T-04): baca shift aktif & riwayat
// milik user yang sedang login dari tabel `shift_sessions` (migration 007), plus
// aksi buka/tutup shift. Konsumen pertama: app/components/kas/KasModule.tsx, dan
// KasirModule.tsx (untuk cek "sudah punya shift aktif?" sebelum layar transaksi
// bisa dipakai — lihat Definition of Done T-04).
//
// Pembagian tanggung jawab (pola sama dengan useSettings.ts):
// - openShift(): INSERT langsung dari client. Aman tanpa RPC karena `opening_cash`
//   murni input kasir, dijaga RLS `shift_sessions_insert_own` (migration 007) +
//   unique index satu-shift-aktif-per-kasir di DB (bukan cuma dicek di sini).
// - closeShift(): WAJIB lewat RPC `close_shift` (migration 008) — `expected_cash`
//   dihitung server-side dari data payments/transactions asli, client cuma kirim
//   `actual_cash` (hasil hitung fisik pecahan uang). Lihat Aturan Main #5 PRD.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type ShiftStatus = "OPEN" | "CLOSED";

// Baris asli tabel `shift_sessions` (migration 007).
export interface ShiftSession {
  id: string;
  cashier_id: string;
  opened_at: string;
  opening_cash: number;
  closed_at: string | null;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
  status: ShiftStatus;
}

export interface CloseShiftResult {
  shift_id: string;
  opening_cash: number;
  cash_sales: number;
  expected_cash: number;
  actual_cash: number;
  difference: number;
}

interface UseShiftsResult {
  /** Shift milik user login yang statusnya masih OPEN, atau null kalau belum buka shift. */
  activeShift: ShiftSession | null;
  /** Riwayat shift (status CLOSED) milik user login, terbaru dulu. Maks 30 baris. */
  history: ShiftSession[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Buka shift baru dengan modal awal `openingCash`. Ditolak (Error) kalau user
   * masih punya shift OPEN lain — pesan diambil dari unique_violation Postgres,
   * diterjemahkan ke Bahasa Indonesia di sini supaya UI tidak perlu urus itu.
   */
  openShift: (openingCash: number) => Promise<void>;
  /**
   * Tutup shift yang sedang aktif. `actualCash` = hasil hitung fisik pecahan uang
   * kasir. Selisih (`difference`) dihitung oleh RPC `close_shift`, bukan di sini.
   */
  closeShift: (actualCash: number) => Promise<CloseShiftResult>;
}

export function useShifts(): UseShiftsResult {
  const [activeShift, setActiveShift] = useState<ShiftSession | null>(null);
  const [history, setHistory] = useState<ShiftSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // Belum login — bukan kondisi error, cukup kosongkan state (pola sama
        // seperti hook lain saat sesi belum siap).
        if (!isCancelled) {
          setActiveShift(null);
          setHistory([]);
          setIsLoading(false);
        }
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("shift_sessions")
        .select(
          "id, cashier_id, opened_at, opening_cash, closed_at, expected_cash, actual_cash, difference, status",
        )
        .eq("cashier_id", user.id)
        .order("opened_at", { ascending: false })
        .limit(30);

      if (isCancelled) return;

      if (fetchError) {
        setError(fetchError.message || "Gagal memuat data shift.");
        setActiveShift(null);
        setHistory([]);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as ShiftSession[];
      setActiveShift(rows.find((row) => row.status === "OPEN") ?? null);
      setHistory(rows.filter((row) => row.status === "CLOSED"));
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  const openShift = useCallback(
    async (openingCash: number) => {
      if (openingCash < 0) {
        throw new Error("Modal awal kas tidak boleh negatif.");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
      }

      const { error: insertError } = await supabase
        .from("shift_sessions")
        .insert({
          cashier_id: user.id,
          opening_cash: openingCash,
        });

      if (insertError) {
        // Kode 23505 = unique_violation. Ini yang dilempar unique index
        // `shift_sessions_one_open_per_cashier` (migration 007) kalau user
        // masih punya shift OPEN lain — beri pesan yang jelas, bukan pesan
        // teknis Postgres apa adanya.
        if (insertError.code === "23505") {
          throw new Error(
            "Anda masih memiliki shift yang belum ditutup. Tutup shift itu dulu sebelum membuka yang baru.",
          );
        }
        throw new Error(insertError.message || "Gagal membuka shift.");
      }

      refetch();
    },
    [refetch],
  );

  const closeShift = useCallback(
    async (actualCash: number): Promise<CloseShiftResult> => {
      if (!activeShift) {
        throw new Error("Tidak ada shift aktif untuk ditutup.");
      }

      if (actualCash < 0) {
        throw new Error("Nominal kas fisik tidak boleh negatif.");
      }

      const { data, error: rpcError } = await supabase.rpc("close_shift", {
        p_shift_id: activeShift.id,
        p_actual_cash: actualCash,
      });

      if (rpcError) {
        console.error("close_shift RPC error:", rpcError);
        throw new Error(rpcError.message || "Gagal menutup shift.");
      }

      if (!data?.success) {
        throw new Error("Shift gagal ditutup.");
      }

      refetch();

      return {
        shift_id: data.shift_id,
        opening_cash: Number(data.opening_cash ?? 0),
        cash_sales: Number(data.cash_sales ?? 0),
        expected_cash: Number(data.expected_cash ?? 0),
        actual_cash: Number(data.actual_cash ?? 0),
        difference: Number(data.difference ?? 0),
      };
    },
    [activeShift, refetch],
  );

  return {
    activeShift,
    history,
    isLoading,
    error,
    refetch,
    openShift,
    closeShift,
  };
}