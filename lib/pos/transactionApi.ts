import { createClient } from "@/lib/supabase/client";
import { CartItem } from "./types";

const supabase = createClient();

export type PaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "QRIS"
  | "TEMPO";

export interface CreateTransactionParams {
  items: CartItem[];

  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;

  paymentMethod: PaymentMethod;
  paymentAmount: number;
  receivedAmount?: number;

  customerName?: string;
  notes?: string;
}

export interface CreateTransactionResult {
  success: boolean;
  transaction_id: string;
  receipt_no: string;
  payment_id: string;
  change_amount: number;
}

/**
 * Menyimpan transaksi melalui PostgreSQL RPC.
 *
 * Penting:
 * - Frontend tidak mengurangi stok secara manual.
 * - Frontend tidak INSERT ke transactions/items/payments secara terpisah.
 * - Semua proses dilakukan oleh RPC create_transaction secara atomic.
 *
 * ── KOREKSI ── Sebelumnya file ini import `supabase` dari `@/lib/supabase`, yaitu
 * client lama (createClient polos dari @supabase/supabase-js) yang simpan sesi di
 * localStorage. Client itu TIDAK sinkron dengan sesi login yang dipakai middleware
 * Auth (cookie-based, dari @supabase/ssr) — akibatnya auth.uid() di RPC selalu NULL
 * walau user sudah login, sehingga cashier_id tidak pernah terisi. Sekarang pakai
 * createClient() dari @/lib/supabase/client supaya sesi login ikut terbawa ke RPC.
 */
export async function createTransaction(
  params: CreateTransactionParams,
): Promise<CreateTransactionResult> {
  if (params.items.length === 0) {
    throw new Error("Keranjang masih kosong.");
  }

  if (params.total < 0) {
    throw new Error("Total transaksi tidak valid.");
  }

  if (params.paymentAmount < 0) {
    throw new Error("Nominal pembayaran tidak valid.");
  }

  if (
    params.paymentMethod === "CASH" &&
    (params.receivedAmount === undefined ||
      params.receivedAmount < params.total)
  ) {
    throw new Error("Nominal uang tunai tidak mencukupi.");
  }

  const rpcItems = params.items.map((item) => ({
    product_id: item.product.id,
    qty: item.qty,
    unit_price: item.product.sell_price,
    discount: 0,
    subtotal: item.product.sell_price * item.qty,
  }));

  const { data, error } = await supabase.rpc("create_transaction", {
    p_items: rpcItems,
    p_subtotal: params.subtotal,
    p_discount: params.discount ?? 0,
    p_tax: params.tax ?? 0,
    p_total: params.total,
    p_customer_name: params.customerName ?? null,
    p_notes: params.notes ?? null,
    p_payment_method: params.paymentMethod,
    p_payment_amount: params.paymentAmount,
    p_received_amount: params.receivedAmount ?? null,
  });

  if (error) {
    console.error("create_transaction RPC error:", error);
    throw new Error(error.message || "Gagal menyimpan transaksi.");
  }

  if (!data?.success) {
    throw new Error("Transaksi gagal disimpan.");
  }

  return {
    success: true,
    transaction_id: data.transaction_id,
    receipt_no: data.receipt_no,
    payment_id: data.payment_id,
    change_amount: Number(data.change_amount ?? 0),
  };
}

// ── TAMBAHAN ── Detail transaksi + Retur + Void.
// Menyusul RPC `void_transaction` & `return_transaction` di migration
// 004_return_and_void.sql. Konvensi sama dengan createTransaction() di atas:
// validasi ringan di frontend, validasi berat (permission, status, sisa qty)
// tetap di RPC (SECURITY DEFINER) supaya tidak bisa dilewati dari client.

export type TransactionStatus = "PAID" | "VOID" | "RETURN";

export interface TransactionDetailItem {
  id: string;
  product_id: string | null;
  sku: string | null;
  product_name: string;
  unit: string | null;
  qty: number;
  returned_qty: number;
  unit_price: number;
  discount: number;
  subtotal: number;
}

export interface TransactionDetailPayment {
  id: string;
  method: PaymentMethod | string;
  amount: number;
  received_amount: number | null;
  change_amount: number | null;
  reference_no: string | null;
  notes: string | null;
}

export interface TransactionDetail {
  id: string;
  receipt_no: string;
  status: TransactionStatus;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  void_reason: string | null;
  related_transaction_id: string | null;
  cashier_name: string | null;
  created_at: string;
  items: TransactionDetailItem[];
  payments: TransactionDetailPayment[];
}

/**
 * Ambil detail lengkap 1 transaksi (item + pembayaran + nama kasir) untuk modal
 * "Lihat Detail & Cetak", dasar Retur, dan cetak ulang struk.
 *
 * Tidak lewat RPC — query langsung dengan embed relasi PostgREST, aman karena
 * RLS tetap berlaku (butuh sesi login yang sama dengan yang dipakai middleware).
 */
export async function getTransactionDetail(
  transactionId: string,
): Promise<TransactionDetail> {
  const { data, error } = await supabase
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
      void_reason,
      related_transaction_id,
      created_at,
      cashier:profiles!cashier_id ( full_name ),
      transaction_items (
        id, product_id, sku, product_name, unit,
        qty, returned_qty, unit_price, discount, subtotal
      ),
      payments (
        id, method, amount, received_amount, change_amount, reference_no, notes
      )
    `,
    )
    .eq("id", transactionId)
    .single();

  if (error) {
    console.error("getTransactionDetail error:", error);
    throw new Error(error.message || "Gagal memuat detail transaksi.");
  }

  const row: any = data;

  return {
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
    void_reason: row.void_reason,
    related_transaction_id: row.related_transaction_id,
    cashier_name: row.cashier?.full_name ?? null,
    created_at: row.created_at,
    items: row.transaction_items ?? [],
    payments: row.payments ?? [],
  };
}

export interface ReturnTransactionParams {
  transactionId: string;
  /** Setidaknya 1 item, qty <= (item.qty - item.returned_qty). */
  items: { transactionItemId: string; qty: number }[];
  reason: string;
}

export interface ReturnTransactionResult {
  success: boolean;
  return_transaction_id: string;
  receipt_no: string;
  refund_amount: number;
}

/** Retur sebagian/penuh — hanya boleh dipanggil oleh admin/supervisor (dicek ulang di RPC). */
export async function returnTransaction(
  params: ReturnTransactionParams,
): Promise<ReturnTransactionResult> {
  if (params.items.length === 0) {
    throw new Error("Pilih minimal 1 item untuk diretur.");
  }
  if (!params.reason || !params.reason.trim()) {
    throw new Error("Alasan retur wajib diisi.");
  }

  const { data, error } = await supabase.rpc("return_transaction", {
    p_transaction_id: params.transactionId,
    p_items: params.items.map((item) => ({
      transaction_item_id: item.transactionItemId,
      qty: item.qty,
    })),
    p_reason: params.reason.trim(),
  });

  if (error) {
    console.error("return_transaction RPC error:", error);
    throw new Error(error.message || "Gagal memproses retur.");
  }

  if (!data?.success) {
    throw new Error("Retur gagal diproses.");
  }

  return {
    success: true,
    return_transaction_id: data.return_transaction_id,
    receipt_no: data.receipt_no,
    refund_amount: Number(data.refund_amount ?? 0),
  };
}

export interface VoidTransactionParams {
  transactionId: string;
  reason: string;
}

/** Void (batal) transaksi penuh — hanya boleh dipanggil oleh admin/supervisor (dicek ulang di RPC). */
export async function voidTransaction(
  params: VoidTransactionParams,
): Promise<{ success: boolean; transaction_id: string }> {
  if (!params.reason || !params.reason.trim()) {
    throw new Error("Alasan void wajib diisi.");
  }

  const { data, error } = await supabase.rpc("void_transaction", {
    p_transaction_id: params.transactionId,
    p_reason: params.reason.trim(),
  });

  if (error) {
    console.error("void_transaction RPC error:", error);
    throw new Error(error.message || "Gagal membatalkan transaksi.");
  }

  if (!data?.success) {
    throw new Error("Void gagal diproses.");
  }

  return { success: true, transaction_id: data.transaction_id };
}