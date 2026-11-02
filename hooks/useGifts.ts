// hooks/useGifts.ts
// ── TAMBAHAN (migration 044) ── Hook domain Hadiah & Oleh-oleh:
//   - useGifts(): daftar dokumen hadiah (per rentang tanggal) + catat hadiah baru.
//   - useGift(id): satu dokumen beserta barisnya + pembatalan.
//
// Semua tulis lewat RPC (give_gift, void_gift). Tidak ada INSERT/UPDATE
// langsung dari client — tabelnya hanya punya policy SELECT. Pola yang sama
// dengan hooks/useStockReceipts.ts.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type GiftStatus = "completed" | "voided";

export type GiftCategory = "kyai" | "tamu_pondok" | "tamu_toko" | "lainnya";

export const GIFT_CATEGORY_LABEL: Record<GiftCategory, string> = {
  kyai: "Bapak Kiyai / Pengasuh",
  tamu_pondok: "Tamu Pondok",
  tamu_toko: "Tamu Toko",
  lainnya: "Lainnya",
};

export const GIFT_CATEGORIES: GiftCategory[] = [
  "kyai",
  "tamu_pondok",
  "tamu_toko",
  "lainnya",
];

export interface GiftRecord {
  id: string;
  number: number;
  /** Tanggal hadiah, "YYYY-MM-DD" (kolom date polos — jangan diparse dengan new Date()). */
  given_at: string;
  recipient_name: string;
  recipient_category: GiftCategory;
  occasion: string | null;
  note: string | null;
  status: GiftStatus;
  item_count: number;
  total_qty: number;
  /** Beban hadiah: qty x harga modal saat dicatat. */
  total_cost: number;
  /** Nilai jika dijual (info saja, bukan angka pembukuan). */
  total_retail: number;
  created_by: string | null;
  created_at: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by_name: string | null;
  voided_by_name: string | null;
}

export interface GiftItem {
  id: string;
  gift_id: string;
  product_id: string | null;
  product_name: string;
  product_sku: string | null;
  product_unit: string | null;
  qty: number;
  unit_cost: number;
  unit_price: number;
}

export interface GiveGiftLine {
  productId: string;
  qty: number;
}

export interface GiveGiftParams {
  /** "YYYY-MM-DD"; kosong = hari ini (WIB, ditentukan server). */
  givenAt: string;
  recipientName: string;
  recipientCategory: GiftCategory;
  occasion: string;
  note: string;
  lines: GiveGiftLine[];
}

export interface GiveGiftResult {
  giftId: string;
  number: number;
  itemCount: number;
  totalQty: number;
  totalCost: number;
}

const MIGRATION_HINT =
  "Fitur hadiah belum siap di database. Jalankan migration 044_gifts.sql di Supabase SQL Editor, lalu muat ulang halaman.";

function describeError(
  err: { message?: string; code?: string },
  fallback: string,
): string {
  const message = err.message ?? "";
  if (
    (err.code === "42P01" ||
      err.code === "PGRST205" ||
      err.code === "PGRST202" ||
      /gift_record|give_gift|void_gift/.test(message)) &&
    /schema cache|does not exist|Could not find/.test(message)
  ) {
    return MIGRATION_HINT;
  }
  return message || fallback;
}

const GIFT_COLUMNS =
  "id, number, given_at, recipient_name, recipient_category, occasion, note, status, item_count, total_qty, total_cost, total_retail, created_by, created_at, voided_by, voided_at, void_reason";

type RawGift = Omit<GiftRecord, "created_by_name" | "voided_by_name">;

async function attachNames(rows: RawGift[]): Promise<GiftRecord[]> {
  const ids = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.created_by, row.voided_by])
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
    total_qty: Number(row.total_qty),
    total_cost: Number(row.total_cost),
    total_retail: Number(row.total_retail),
    created_by_name: row.created_by
      ? (nameById.get(row.created_by) ?? null)
      : null,
    voided_by_name: row.voided_by
      ? (nameById.get(row.voided_by) ?? null)
      : null,
  }));
}

// =====================================================================
// Daftar hadiah
// =====================================================================

interface UseGiftsOptions {
  /** "YYYY-MM-DD" (inklusif). Kosong = tanpa batas bawah. */
  dateFrom?: string;
  /** "YYYY-MM-DD" (inklusif). Kosong = tanpa batas atas. */
  dateTo?: string;
}

interface UseGiftsResult {
  gifts: GiftRecord[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  giveGift: (params: GiveGiftParams) => Promise<GiveGiftResult>;
}

export function useGifts(options: UseGiftsOptions = {}): UseGiftsResult {
  const { dateFrom = "", dateTo = "" } = options;

  const [gifts, setGifts] = useState<GiftRecord[]>([]);
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
        .from("gift_records")
        .select(GIFT_COLUMNS)
        .order("given_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);

      if (dateFrom) query = query.gte("given_at", dateFrom);
      if (dateTo) query = query.lte("given_at", dateTo);

      const { data, error: fetchError } = await query;

      if (isCancelled) return;

      if (fetchError) {
        setError(describeError(fetchError, "Gagal memuat daftar hadiah."));
        setGifts([]);
        setIsLoading(false);
        return;
      }

      const rows = await attachNames((data ?? []) as unknown as RawGift[]);

      if (isCancelled) return;

      setGifts(rows);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [dateFrom, dateTo, reloadToken]);

  const giveGift = useCallback(
    async ({
      givenAt,
      recipientName,
      recipientCategory,
      occasion,
      note,
      lines,
    }: GiveGiftParams): Promise<GiveGiftResult> => {
      // Validasi ringan untuk UX — yang mengikat tetap RPC `give_gift`.
      if (recipientName.trim() === "") {
        throw new Error("Nama penerima wajib diisi.");
      }

      if (lines.length === 0) {
        throw new Error("Isi minimal satu produk yang dihadiahkan.");
      }

      for (const line of lines) {
        if (!Number.isInteger(line.qty) || line.qty <= 0) {
          throw new Error("Jumlah harus berupa angka bulat lebih dari 0.");
        }
      }

      const { data, error: rpcError } = await supabase.rpc("give_gift", {
        p_given_at: givenAt || null,
        p_recipient_name: recipientName.trim(),
        p_recipient_category: recipientCategory,
        p_occasion: occasion.trim() || null,
        p_note: note.trim() || null,
        p_items: lines.map((line) => ({
          product_id: line.productId,
          qty: line.qty,
        })),
      });

      if (rpcError) {
        console.error("give_gift RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal menyimpan hadiah."));
      }

      if (!data?.success) {
        throw new Error("Hadiah gagal disimpan.");
      }

      refetch();

      return {
        giftId: data.gift_id as string,
        number: Number(data.number),
        itemCount: Number(data.item_count),
        totalQty: Number(data.total_qty),
        totalCost: Number(data.total_cost),
      };
    },
    [refetch],
  );

  return { gifts, isLoading, error, refetch, giveGift };
}

// =====================================================================
// Satu dokumen + barisnya
// =====================================================================

interface UseGiftResult {
  gift: GiftRecord | null;
  items: GiftItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  voidGift: (reason: string) => Promise<void>;
}

export function useGift(giftId: string): UseGiftResult {
  const [gift, setGift] = useState<GiftRecord | null>(null);
  const [items, setItems] = useState<GiftItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const { data: row, error: giftError } = await supabase
        .from("gift_records")
        .select(GIFT_COLUMNS)
        .eq("id", giftId)
        .maybeSingle();

      if (isCancelled) return;

      if (giftError || !row) {
        setError(
          giftError
            ? describeError(giftError, "Gagal memuat hadiah.")
            : "Hadiah tidak ditemukan.",
        );
        setIsLoading(false);
        return;
      }

      const { data: itemRows, error: itemsError } = await supabase
        .from("gift_record_items")
        .select(
          "id, gift_id, product_id, product_name, product_sku, product_unit, qty, unit_cost, unit_price",
        )
        .eq("gift_id", giftId)
        .order("product_name", { ascending: true })
        .order("id", { ascending: true })
        .limit(500);

      if (isCancelled) return;

      if (itemsError) {
        setError(describeError(itemsError, "Gagal memuat baris hadiah."));
        setIsLoading(false);
        return;
      }

      const [withNames] = await attachNames([row as unknown as RawGift]);

      if (isCancelled) return;

      setGift(withNames);
      setItems(
        ((itemRows ?? []) as unknown as GiftItem[]).map((item) => ({
          ...item,
          qty: Number(item.qty),
          unit_cost: Number(item.unit_cost),
          unit_price: Number(item.unit_price),
        })),
      );
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [giftId, reloadToken]);

  const voidGift = useCallback(
    async (reason: string): Promise<void> => {
      if (!reason || reason.trim() === "") {
        throw new Error("Alasan pembatalan wajib diisi.");
      }

      const { data, error: rpcError } = await supabase.rpc("void_gift", {
        p_gift_id: giftId,
        p_reason: reason.trim(),
      });

      if (rpcError) {
        console.error("void_gift RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal membatalkan hadiah."));
      }

      if (!data?.success) {
        throw new Error("Hadiah gagal dibatalkan.");
      }

      refetch();
    },
    [giftId, refetch],
  );

  return { gift, items, isLoading, error, refetch, voidGift };
}
