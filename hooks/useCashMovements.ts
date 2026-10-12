// hooks/useCashMovements.ts
// ── TAMBAHAN (migration 040) ── Kas masuk & kas keluar dari laci pada sebuah
// shift: uang yang keluar/masuk di luar penjualan (beli galon, ongkir, setor ke
// pemilik, tukar uang kecil, dst.). Tanpa pencatatan ini, uang tersebut muncul
// sebagai SELISIH KAS tanpa alasan saat tutup shift.
//
// Pembagian tanggung jawab (pola sama dengan useShifts.ts):
// - MEMBACA: SELECT langsung ke `cash_movements`, dibatasi RLS (shift milik
//   sendiri, atau role lintas-kasir).
// - MENULIS: WAJIB lewat RPC `add_cash_movement` / `void_cash_movement`
//   (security definer). Tabelnya sengaja tertutup dari insert/update/delete
//   langsung — validasi, kunci shift, dan Log Aktivitas dikerjakan server.
//
// Catatan desain: hook ini SENGAJA tidak pernah menampilkan "kas seharusnya".
// Penutupan kas di aplikasi ini "buta" (kasir menghitung uang fisik tanpa
// melihat angka seharusnya), dan pesan error server untuk kas keluar yang
// terlalu besar juga dibuat tanpa angka.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type CashMovementType = "IN" | "OUT";

export type CashInCategory = "tambah_modal" | "titipan" | "lainnya_masuk";
export type CashOutCategory =
  | "operasional"
  | "ongkir"
  | "setor_owner"
  | "belanja_stok"
  | "lainnya_keluar";
export type CashCategory = CashInCategory | CashOutCategory;

export interface CashCategoryOption {
  value: CashCategory;
  label: string;
  hint: string;
}

/** Pilihan kategori per jenis. Nilai `value` HARUS sama dengan constraint di migration 040. */
export const CASH_CATEGORIES: Record<CashMovementType, CashCategoryOption[]> = {
  IN: [
    {
      value: "tambah_modal",
      label: "Tambah modal laci",
      hint: "Uang kembalian atau tukar uang kecil dari luar laci.",
    },
    {
      value: "titipan",
      label: "Titipan uang",
      hint: "Uang titipan yang masuk ke laci bukan dari penjualan.",
    },
    {
      value: "lainnya_masuk",
      label: "Lainnya",
      hint: "Sebutkan jelas di keterangan.",
    },
  ],
  OUT: [
    {
      value: "operasional",
      label: "Biaya operasional",
      hint: "Galon, ATK, kebersihan, listrik, dan sejenisnya.",
    },
    {
      value: "ongkir",
      label: "Ongkir / transport",
      hint: "Ongkos kirim atau transport yang dibayar dari laci.",
    },
    {
      value: "setor_owner",
      label: "Setoran ke pemilik/bank",
      hint: "Uang di laci disetor ke pemilik atau bank.",
    },
    {
      value: "belanja_stok",
      label: "Belanja barang / stok",
      hint: "Barang yang dibeli langsung dengan uang laci.",
    },
    {
      value: "lainnya_keluar",
      label: "Lainnya",
      hint: "Sebutkan jelas di keterangan.",
    },
  ],
};

export function categoryLabel(category: string): string {
  for (const options of Object.values(CASH_CATEGORIES)) {
    const found = options.find((option) => option.value === category);
    if (found) return found.label;
  }
  return category;
}

// Baris asli tabel `cash_movements` (migration 040).
export interface CashMovement {
  id: string;
  shift_id: string;
  type: CashMovementType;
  amount: number;
  category: string;
  note: string;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface AddCashMovementParams {
  type: CashMovementType;
  amount: number;
  category: CashCategory;
  note: string;
}

export interface CashMovementsSummary {
  /** Total kas masuk yang BELUM dibatalkan. */
  cashIn: number;
  /** Total kas keluar yang BELUM dibatalkan. */
  cashOut: number;
  /** Jumlah catatan yang BELUM dibatalkan. */
  activeCount: number;
}

/** Ringkasan murni (tanpa React/Supabase) — catatan yang sudah dibatalkan tidak dihitung. */
export function summarizeMovements(
  movements: Pick<CashMovement, "type" | "amount" | "voided_at">[],
): CashMovementsSummary {
  let cashIn = 0;
  let cashOut = 0;
  let activeCount = 0;

  for (const m of movements) {
    if (m.voided_at) continue;
    activeCount += 1;
    if (m.type === "IN") cashIn += m.amount;
    else cashOut += m.amount;
  }

  return { cashIn, cashOut, activeCount };
}

/**
 * Validasi sisi client (cermin aturan server di add_cash_movement) — hanya
 * supaya kasir langsung melihat kesalahan isian tanpa menunggu server. Server
 * tetap yang menentukan. Mengembalikan pesan error, atau null kalau valid.
 */
export function validateCashMovement(params: {
  type: CashMovementType;
  amount: number;
  category: string;
  note: string;
}): string | null {
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return "Nominal harus lebih dari 0.";
  }
  if (params.amount > 1_000_000_000) {
    return "Nominal terlalu besar.";
  }
  if (!CASH_CATEGORIES[params.type].some((c) => c.value === params.category)) {
    return "Pilih kategori yang sesuai.";
  }
  if (params.note.trim().length < 3) {
    return "Keterangan wajib diisi (minimal 3 karakter).";
  }
  return null;
}

interface UseCashMovementsResult {
  /** Semua catatan shift ini (termasuk yang dibatalkan), terbaru dulu. */
  movements: CashMovement[];
  summary: CashMovementsSummary;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Catat kas masuk/keluar pada shift AKTIF user. Melempar Error (pesan server) kalau ditolak. */
  addMovement: (params: AddCashMovementParams) => Promise<void>;
  /** Batalkan satu catatan (alasan wajib). Hanya bisa selama shift masih OPEN. */
  voidMovement: (id: string, reason: string) => Promise<void>;
}

export function useCashMovements(shiftId: string | null): UseCashMovementsResult {
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      if (!shiftId) {
        setMovements([]);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("cash_movements")
        .select(
          "id, shift_id, type, amount, category, note, created_by, created_at, voided_at, void_reason",
        )
        .eq("shift_id", shiftId)
        .order("created_at", { ascending: false });

      if (isCancelled) return;

      if (fetchError) {
        setError(fetchError.message || "Gagal memuat catatan kas.");
        setMovements([]);
        setIsLoading(false);
        return;
      }

      setMovements(
        ((data ?? []) as CashMovement[]).map((row) => ({
          ...row,
          amount: Number(row.amount),
        })),
      );
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [shiftId, reloadToken]);

  const addMovement = useCallback(
    async (params: AddCashMovementParams) => {
      const problem = validateCashMovement(params);
      if (problem) throw new Error(problem);

      const { data, error: rpcError } = await supabase.rpc("add_cash_movement", {
        p_type: params.type,
        p_amount: params.amount,
        p_category: params.category,
        p_note: params.note.trim(),
      });

      if (rpcError) {
        console.error("add_cash_movement RPC error:", rpcError);
        throw new Error(rpcError.message || "Gagal mencatat kas.");
      }
      if (!data?.success) {
        throw new Error("Catatan kas gagal disimpan.");
      }

      refetch();
    },
    [refetch],
  );

  const voidMovement = useCallback(
    async (id: string, reason: string) => {
      if (reason.trim().length < 3) {
        throw new Error("Alasan pembatalan wajib diisi (minimal 3 karakter).");
      }

      const { data, error: rpcError } = await supabase.rpc("void_cash_movement", {
        p_id: id,
        p_reason: reason.trim(),
      });

      if (rpcError) {
        console.error("void_cash_movement RPC error:", rpcError);
        throw new Error(rpcError.message || "Gagal membatalkan catatan kas.");
      }
      if (!data?.success) {
        throw new Error("Catatan kas gagal dibatalkan.");
      }

      refetch();
    },
    [refetch],
  );

  const summary = useMemo(() => summarizeMovements(movements), [movements]);

  return {
    movements,
    summary,
    isLoading,
    error,
    refetch,
    addMovement,
    voidMovement,
  };
}

// ---------------------------------------------------------------------
// Total kas masuk/keluar per shift (untuk tabel riwayat shift & laporan)
// ---------------------------------------------------------------------

export interface ShiftCashTotals {
  cashIn: number;
  cashOut: number;
}

const ID_CHUNK = 150;

/** Ambil & jumlahkan kas masuk/keluar (yang belum dibatalkan) untuk banyak shift sekaligus. */
export async function fetchCashTotalsByShift(
  shiftIds: string[],
): Promise<Record<string, ShiftCashTotals>> {
  const totals: Record<string, ShiftCashTotals> = {};
  for (const id of shiftIds) totals[id] = { cashIn: 0, cashOut: 0 };

  for (let i = 0; i < shiftIds.length; i += ID_CHUNK) {
    const ids = shiftIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from("cash_movements")
      .select("shift_id, type, amount")
      .in("shift_id", ids)
      .is("voided_at", null);

    if (error) throw new Error(error.message || "Gagal memuat kas masuk/keluar.");

    for (const row of (data ?? []) as {
      shift_id: string;
      type: CashMovementType;
      amount: number;
    }[]) {
      const bucket = totals[row.shift_id];
      if (!bucket) continue;
      if (row.type === "IN") bucket.cashIn += Number(row.amount);
      else bucket.cashOut += Number(row.amount);
    }
  }

  return totals;
}

/** Hook tipis di atas fetchCashTotalsByShift — gagal memuat TIDAK memblokir tampilan (angka kosong). */
export function useCashTotalsByShift(
  shiftIds: string[],
): Record<string, ShiftCashTotals> {
  const [totals, setTotals] = useState<Record<string, ShiftCashTotals>>({});
  // Kunci stabil supaya array baru dengan isi sama tidak memicu ulang efek.
  const key = shiftIds.join(",");

  useEffect(() => {
    if (!key) return;

    let isCancelled = false;

    fetchCashTotalsByShift(key.split(","))
      .then((result) => {
        if (!isCancelled) setTotals(result);
      })
      .catch((err) => {
        console.error("useCashTotalsByShift error:", err);
        if (!isCancelled) setTotals({});
      });

    return () => {
      isCancelled = true;
    };
  }, [key]);

  // Tanpa shift sama sekali -> kosong, tanpa setState sinkron di dalam efek.
  return key ? totals : {};
}
