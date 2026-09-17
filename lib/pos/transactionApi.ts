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