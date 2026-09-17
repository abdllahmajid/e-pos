"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client"; // ganti sesuai path client Supabase project kamu

// ── Enum ini HARUS sinkron persis dengan enum Postgres `payment_method` & `transaction_status`.
// Kalau backend menambah nilai baru, update di sini juga.
export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "QRIS" | "TEMPO";
export type TransactionStatus = "PAID" | "VOID" | "RETURN";

export interface TransactionPayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  received_amount: number | null;
  change_amount: number | null;
  reference_no: string | null;
  notes: string | null;
}

export interface TransactionListItem {
  id: string;
  receipt_no: string;
  status: TransactionStatus;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  customer_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Jumlah baris item (jenis produk) dalam transaksi ini — bukan total qty. */
  item_count: number;
  payments: TransactionPayment[];
  // ── TAMBAHAN ── kolom hasil migration 001_add_missing_transaction_columns.sql.
  // Selalu NULL sampai sistem Auth+role (cashier_id) dan Kas & Shift (shift_id)
  // benar-benar dibangun — jangan andalkan field ini untuk logic apapun dulu.
  cashier_id: string | null;
  shift_id: string | null;
  customer_phone: string | null;
  void_reason: string | null;
}

interface UseTransactionsResult {
  transactions: TransactionListItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTransactions(): UseTransactionsResult {
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;
    const supabase = createClient();

    async function load() {
      setIsLoading(true);
      setError(null);

      // `transaction_items ( count )` memakai fitur count-aggregate embed dari PostgREST/Supabase:
      // hasilnya berupa array 1 elemen [{ count: N }], BUKAN daftar item itu sendiri.
      // Ini query ringan (tidak menarik semua baris item) — cocok untuk daftar/riwayat.
      const { data, error: fetchError } = await supabase
        .from("transactions")
        .select(
          `
          id,
          receipt_no,
          status,
          subtotal,
          discount,
          tax,
          total,
          customer_name,
          customer_phone,
          notes,
          created_at,
          updated_at,
          cashier_id,
          shift_id,
          void_reason,
          payments (
            id,
            method,
            amount,
            received_amount,
            change_amount,
            reference_no,
            notes
          ),
          transaction_items ( count )
        `
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (isCancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setTransactions([]);
        setIsLoading(false);
        return;
      }

      const mapped: TransactionListItem[] = (data ?? []).map((row: any) => ({
        id: row.id,
        receipt_no: row.receipt_no,
        status: row.status,
        subtotal: row.subtotal,
        discount: row.discount,
        tax: row.tax,
        total: row.total,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
        item_count: row.transaction_items?.[0]?.count ?? 0,
        payments: row.payments ?? [],
        cashier_id: row.cashier_id,
        shift_id: row.shift_id,
        void_reason: row.void_reason,
      }));

      setTransactions(mapped);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  return { transactions, isLoading, error, refetch };
}