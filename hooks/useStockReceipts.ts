// hooks/useStockReceipts.ts
// ── TAMBAHAN (Fase 3 perbaikan Stok & Opname) ── Hook domain Barang Masuk
// (penerimaan barang):
//   - useStockReceipts(): daftar dokumen + catat barang masuk baru.
//   - useStockReceipt(id): satu dokumen beserta barisnya + pembatalan.
//
// Semua tulis lewat RPC (migration 042): receive_stock, void_stock_receipt.
// Tidak ada INSERT/UPDATE langsung dari client — tabelnya hanya punya policy
// SELECT. Nama pencatat diambil lewat satu query terpisah ke `profiles` (bukan
// embed), pola yang sama dengan useStock.ts / useOpname.ts.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export type ReceiptStatus = "completed" | "voided";

export interface StockReceipt {
  id: string;
  number: number;
  /** Tanggal terima, "YYYY-MM-DD" (kolom date polos — jangan diparse dengan new Date()). */
  received_at: string;
  supplier: string | null;
  reference_no: string | null;
  note: string | null;
  status: ReceiptStatus;
  item_count: number;
  total_qty: number;
  total_cost: number;
  cost_updated: boolean;
  created_by: string | null;
  created_at: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by_name: string | null;
  voided_by_name: string | null;
}

export interface StockReceiptItem {
  id: string;
  receipt_id: string;
  product_id: string | null;
  product_name: string;
  product_sku: string | null;
  product_unit: string | null;
  qty: number;
  unit_cost: number | null;
}

export interface ReceiveLine {
  productId: string;
  qty: number;
  /** Null = harga beli tidak diisi. */
  unitCost: number | null;
}

export interface ReceiveStockParams {
  /** "YYYY-MM-DD"; kosong = hari ini (WIB, ditentukan server). */
  receivedAt: string;
  supplier: string;
  referenceNo: string;
  note: string;
  lines: ReceiveLine[];
  /** Ganti harga modal produk dengan harga beli (hanya baris yang diisi harga belinya). */
  updateCost: boolean;
}

export interface ReceiveStockResult {
  receiptId: string;
  number: number;
  itemCount: number;
  totalQty: number;
  totalCost: number;
}

const MIGRATION_HINT =
  "Fitur barang masuk belum siap di database. Jalankan migration 042_stock_receipts.sql di Supabase SQL Editor, lalu muat ulang halaman.";

function describeError(
  err: { message?: string; code?: string },
  fallback: string,
): string {
  const message = err.message ?? "";
  if (
    (err.code === "42P01" ||
      err.code === "PGRST205" ||
      err.code === "PGRST202" ||
      /stock_receipt|receive_stock|void_stock_receipt/.test(message)) &&
    /schema cache|does not exist|Could not find/.test(message)
  ) {
    return MIGRATION_HINT;
  }
  return message || fallback;
}

const RECEIPT_COLUMNS =
  "id, number, received_at, supplier, reference_no, note, status, item_count, total_qty, total_cost, cost_updated, created_by, created_at, voided_by, voided_at, void_reason";

type RawReceipt = Omit<StockReceipt, "created_by_name" | "voided_by_name">;

async function attachNames(rows: RawReceipt[]): Promise<StockReceipt[]> {
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
    created_by_name: row.created_by ? (nameById.get(row.created_by) ?? null) : null,
    voided_by_name: row.voided_by ? (nameById.get(row.voided_by) ?? null) : null,
  }));
}

// =====================================================================
// Daftar barang masuk
// =====================================================================

interface UseStockReceiptsResult {
  receipts: StockReceipt[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  receiveStock: (params: ReceiveStockParams) => Promise<ReceiveStockResult>;
}

export function useStockReceipts(): UseStockReceiptsResult {
  const [receipts, setReceipts] = useState<StockReceipt[]>([]);
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
        .from("stock_receipts")
        .select(RECEIPT_COLUMNS)
        .order("received_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);

      if (isCancelled) return;

      if (fetchError) {
        setError(describeError(fetchError, "Gagal memuat daftar barang masuk."));
        setReceipts([]);
        setIsLoading(false);
        return;
      }

      const rows = await attachNames((data ?? []) as unknown as RawReceipt[]);

      if (isCancelled) return;

      setReceipts(rows);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  const receiveStock = useCallback(
    async ({
      receivedAt,
      supplier,
      referenceNo,
      note,
      lines,
      updateCost,
    }: ReceiveStockParams): Promise<ReceiveStockResult> => {
      // Validasi ringan untuk UX — yang mengikat tetap RPC `receive_stock`.
      if (lines.length === 0) {
        throw new Error("Isi minimal satu produk yang masuk.");
      }

      for (const line of lines) {
        if (!Number.isInteger(line.qty) || line.qty <= 0) {
          throw new Error("Jumlah harus berupa angka bulat lebih dari 0.");
        }
        if (
          line.unitCost !== null &&
          (!Number.isInteger(line.unitCost) || line.unitCost < 0)
        ) {
          throw new Error("Harga beli harus berupa angka bulat 0 atau lebih.");
        }
      }

      const { data, error: rpcError } = await supabase.rpc("receive_stock", {
        p_received_at: receivedAt || null,
        p_supplier: supplier.trim() || null,
        p_reference_no: referenceNo.trim() || null,
        p_note: note.trim() || null,
        p_items: lines.map((line) => ({
          product_id: line.productId,
          qty: line.qty,
          unit_cost: line.unitCost,
        })),
        p_update_cost: updateCost,
      });

      if (rpcError) {
        console.error("receive_stock RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal menyimpan barang masuk."));
      }

      if (!data?.success) {
        throw new Error("Barang masuk gagal disimpan.");
      }

      refetch();

      return {
        receiptId: data.receipt_id as string,
        number: Number(data.number),
        itemCount: Number(data.item_count),
        totalQty: Number(data.total_qty),
        totalCost: Number(data.total_cost),
      };
    },
    [refetch],
  );

  return { receipts, isLoading, error, refetch, receiveStock };
}

// =====================================================================
// Satu dokumen + barisnya
// =====================================================================

interface UseStockReceiptResult {
  receipt: StockReceipt | null;
  items: StockReceiptItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  voidReceipt: (reason: string) => Promise<void>;
}

export function useStockReceipt(receiptId: string): UseStockReceiptResult {
  const [receipt, setReceipt] = useState<StockReceipt | null>(null);
  const [items, setItems] = useState<StockReceiptItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const { data: row, error: receiptError } = await supabase
        .from("stock_receipts")
        .select(RECEIPT_COLUMNS)
        .eq("id", receiptId)
        .maybeSingle();

      if (isCancelled) return;

      if (receiptError || !row) {
        setError(
          receiptError
            ? describeError(receiptError, "Gagal memuat barang masuk.")
            : "Barang masuk tidak ditemukan.",
        );
        setIsLoading(false);
        return;
      }

      const { data: itemRows, error: itemsError } = await supabase
        .from("stock_receipt_items")
        .select(
          "id, receipt_id, product_id, product_name, product_sku, product_unit, qty, unit_cost",
        )
        .eq("receipt_id", receiptId)
        .order("product_name", { ascending: true })
        .order("id", { ascending: true })
        .limit(1000);

      if (isCancelled) return;

      if (itemsError) {
        setError(describeError(itemsError, "Gagal memuat baris barang masuk."));
        setIsLoading(false);
        return;
      }

      const [withNames] = await attachNames([row as unknown as RawReceipt]);

      if (isCancelled) return;

      setReceipt(withNames);
      setItems(
        ((itemRows ?? []) as unknown as StockReceiptItem[]).map((item) => ({
          ...item,
          qty: Number(item.qty),
          unit_cost: item.unit_cost === null ? null : Number(item.unit_cost),
        })),
      );
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [receiptId, reloadToken]);

  const voidReceipt = useCallback(
    async (reason: string): Promise<void> => {
      if (!reason || reason.trim() === "") {
        throw new Error("Alasan pembatalan wajib diisi.");
      }

      const { data, error: rpcError } = await supabase.rpc(
        "void_stock_receipt",
        { p_receipt_id: receiptId, p_reason: reason.trim() },
      );

      if (rpcError) {
        console.error("void_stock_receipt RPC error:", rpcError);
        throw new Error(
          describeError(rpcError, "Gagal membatalkan barang masuk."),
        );
      }

      if (!data?.success) {
        throw new Error("Barang masuk gagal dibatalkan.");
      }

      refetch();
    },
    [receiptId, refetch],
  );

  return { receipt, items, isLoading, error, refetch, voidReceipt };
}
