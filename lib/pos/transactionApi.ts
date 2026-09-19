import { createClient } from "@/lib/supabase/client";
import { CartItem } from "./types";
import imageCompression from "browser-image-compression";

const supabase = createClient();

export type PaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "QRIS"
  | "TEMPO";

// ── TAMBAHAN (021, T-11 bagian 2) ── Satu baris pembayaran untuk split payment.
// Bentuk ini SAMA dengan elemen `p_payments` di RPC create_transaction (migration
// 021), hanya nama field di-camelCase-kan. Arti `amount` di sini = porsi tagihan
// yang dilunasi lewat metode ini (BUKAN uang yang diserahkan) — untuk uang yang
// diserahkan pelanggan pada baris CASH pakai `receivedAmount`.
export interface SplitPaymentLine {
  method: PaymentMethod;
  amount: number;
  /** Wajib untuk CASH, >= amount. Diabaikan untuk metode lain. */
  receivedAmount?: number;
  /** Wajib untuk TEMPO, format "YYYY-MM-DD". Diabaikan untuk metode lain. */
  dueDate?: string;
}

// Batas ini harus sama dengan batas di RPC (array 1-4 baris, tiap metode 1x).
export const MAX_SPLIT_PAYMENT_LINES = 4;

/**
 * ── TAMBAHAN (021) ── Validasi ringan split payment, dipakai createTransaction()
 * DAN (nanti) PaymentModal.tsx supaya tombol Bayar/pesan error konsisten dengan
 * yang akan ditolak server. Mengembalikan pesan error, atau null kalau valid.
 * Validasi SEBENARNYA yang tidak bisa dilewati tetap di RPC (Aturan Main #5).
 *
 * `customerName` hanya dipakai untuk aturan "TEMPO wajib nama pelanggan".
 */
export function validateSplitPayments(
  total: number,
  lines: SplitPaymentLine[],
  customerName?: string,
): string | null {
  if (lines.length === 0) {
    return "Rincian pembayaran masih kosong.";
  }
  if (lines.length > MAX_SPLIT_PAYMENT_LINES) {
    return `Maksimal ${MAX_SPLIT_PAYMENT_LINES} metode pembayaran per transaksi.`;
  }
  if (total <= 0) {
    return "Split pembayaran hanya untuk transaksi dengan total lebih dari nol.";
  }

  const seen = new Set<PaymentMethod>();
  let sum = 0;

  for (const line of lines) {
    if (seen.has(line.method)) {
      return `Metode ${line.method} dipakai lebih dari sekali.`;
    }
    seen.add(line.method);

    if (!Number.isInteger(line.amount) || line.amount <= 0) {
      return `Nominal ${line.method} harus bilangan bulat lebih dari nol.`;
    }
    sum += line.amount;

    if (line.method === "CASH") {
      if (
        line.receivedAmount === undefined ||
        line.receivedAmount < line.amount
      ) {
        return "Uang tunai yang diterima kurang dari porsi tunai.";
      }
    }

    if (line.method === "TEMPO" && !line.dueDate) {
      return "Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO.";
    }
  }

  if (sum !== total) {
    return sum < total
      ? "Jumlah pembayaran masih kurang dari total."
      : "Jumlah pembayaran melebihi total.";
  }

  if (seen.has("TEMPO") && !customerName?.trim()) {
    return "Nama pelanggan wajib diisi untuk pembayaran TEMPO.";
  }

  return null;
}

// Bagian pembayaran dipisah jadi 2 bentuk yang saling eksklusif (TAMBAHAN 021):
// - Tunggal (perilaku lama, dipakai KasirModule.tsx hari ini): paymentMethod + paymentAmount.
// - Split: `payments` (1-4 baris). Kalau `payments` diisi, paymentMethod/paymentAmount/
//   receivedAmount/dueDate top-level TIDAK boleh diisi — jatuh tempo & uang diterima
//   ada di masing-masing baris.
interface SinglePaymentParams {
  paymentMethod: PaymentMethod;
  paymentAmount: number;
  receivedAmount?: number;

  /**
   * ── TAMBAHAN (T-02) ── Tanggal jatuh tempo, format "YYYY-MM-DD".
   * Wajib diisi kalau paymentMethod === "TEMPO" (divalidasi ringan di sini untuk UX,
   * tapi validasi SEBENARNYA yang tidak bisa dilewati ada di RPC create_transaction —
   * lihat migration 006_payment_enhance.sql, sesuai Aturan Main #5).
   */
  dueDate?: string;

  payments?: undefined;
}

interface SplitPaymentParams {
  payments: SplitPaymentLine[];

  paymentMethod?: undefined;
  paymentAmount?: undefined;
  receivedAmount?: undefined;
  dueDate?: undefined;
}

interface CreateTransactionBaseParams {
  items: CartItem[];

  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;

  customerName?: string;
  notes?: string;

  /**
   * ── TAMBAHAN (013) ── Nomor HP pelanggan, opsional untuk SEMUA metode bayar
   * (PRD §4.2 "Identitas pelanggan (opsional per transaksi): nama + no. HP"),
   * bukan hanya TEMPO. Dipakai fitur "Kirim WA" di layar sukses Kasir
   * (lib/pos/printLogic.ts → shareReceiptViaWhatsApp()). Disimpan apa adanya,
   * tanpa normalisasi format — sanitasi ke format wa.me terjadi saat KIRIM,
   * bukan saat SIMPAN (lihat komentar migration 013).
   */
  customerPhone?: string;
}

export type CreateTransactionParams = CreateTransactionBaseParams &
  (SinglePaymentParams | SplitPaymentParams);

// ── TAMBAHAN (021) ── Satu baris pembayaran yang baru tersimpan, dari hasil RPC.
// PaymentModal memakai `payment_id` ini untuk menempelkan bukti transfer/QRIS ke
// baris yang benar (satu transaksi split bisa punya beberapa baris non-tunai).
export interface CreatedPayment {
  payment_id: string;
  method: PaymentMethod;
  amount: number;
}

export interface CreateTransactionResult {
  success: boolean;
  transaction_id: string;
  receipt_no: string;
  /** Baris pembayaran PERTAMA. Untuk pembayaran tunggal = satu-satunya baris. */
  payment_id: string;
  /** ── TAMBAHAN (021) ── Semua baris pembayaran, urut sesuai input. */
  payments: CreatedPayment[];
  /** Total kembalian dari semua baris CASH (0 kalau tidak ada). */
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

  // ── TAMBAHAN (021) ── Cabang split payment. Validasi ringan di client
  // (validateSplitPayments), lalu SEMUA data pembayaran dikirim lewat p_payments.
  const splitLines = params.payments;
  if (splitLines) {
    const splitError = validateSplitPayments(
      params.total,
      splitLines,
      params.customerName,
    );
    if (splitError) throw new Error(splitError);
  } else {
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

    // ── TAMBAHAN (T-02) ── Validasi ringan UX untuk TEMPO — gagal cepat di client
    // sebelum roundtrip ke server. RPC tetap validasi ulang (wajib, bukan opsional).
    if (params.paymentMethod === "TEMPO") {
      if (!params.customerName || !params.customerName.trim()) {
        throw new Error("Nama pelanggan wajib diisi untuk pembayaran TEMPO.");
      }
      if (!params.dueDate) {
        throw new Error("Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO.");
      }
    }
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
    // ── KOREKSI (021) ── Pembayaran tunggal: field lama dikirim seperti biasa.
    // Split: field lama TIDAK dikirim (RPC mengabaikannya kalau p_payments ada,
    // dan mengirim `null` ke p_payment_method — enum NOT NULL default 'CASH' —
    // akan menimpa default-nya jadi NULL, jadi lebih aman dihilangkan).
    ...(splitLines
      ? {
          p_payments: splitLines.map((line) => ({
            method: line.method,
            amount: line.amount,
            received_amount:
              line.method === "CASH" ? (line.receivedAmount ?? null) : null,
            due_date: line.method === "TEMPO" ? (line.dueDate ?? null) : null,
          })),
        }
      : {
          p_payment_method: params.paymentMethod,
          p_payment_amount: params.paymentAmount,
          p_received_amount: params.receivedAmount ?? null,
          p_due_date: params.dueDate ?? null,
        }),
    // ── TAMBAHAN (013) ── lihat komentar CreateTransactionParams.customerPhone
    // di atas. Named parameter, jadi ditambahkan di akhir daftar RPC di sini
    // tidak bergantung urutan parameter di definisi SQL-nya.
    p_customer_phone: params.customerPhone?.trim() || null,
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
    // ── TAMBAHAN (021) ── `payments` baru ada setelah migration 021 dijalankan.
    // Fallback ke 1 baris dari `payment_id` supaya kode tetap jalan kalau RPC
    // masih versi lama (mis. migration belum dieksekusi di environment tertentu).
    payments: Array.isArray(data.payments)
      ? data.payments.map((p: any) => ({
          payment_id: p.payment_id,
          method: p.method,
          amount: Number(p.amount ?? 0),
        }))
      : [
          {
            payment_id: data.payment_id,
            method: params.paymentMethod ?? "CASH",
            amount: params.paymentAmount ?? params.total,
          },
        ],
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

// ── TAMBAHAN (T-02) ── Metadata 1 file bukti pembayaran (baris `payment_proofs`).
export interface PaymentProof {
  id: string;
  file_url: string;
  file_name: string | null;
  created_at: string;
}

export interface TransactionDetailPayment {
  id: string;
  method: PaymentMethod | string;
  amount: number;
  received_amount: number | null;
  change_amount: number | null;
  reference_no: string | null;
  notes: string | null;
  /** ── TAMBAHAN (T-02) ── Jatuh tempo, hanya terisi untuk method TEMPO. */
  due_date: string | null;
  /** ── TAMBAHAN (T-02) ── Bukti transfer/QRIS, bisa lebih dari 1 file. */
  proofs: PaymentProof[];
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
        id, method, amount, received_amount, change_amount, reference_no, notes, due_date,
        payment_proofs ( id, file_url, file_name, created_at )
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
    // ── TAMBAHAN (T-02) ── PostgREST mengembalikan nama relasi asli (`payment_proofs`),
    // di-map ke `proofs` di sini supaya nama field di TransactionDetailPayment tetap
    // ringkas & tidak bocor nama tabel ke konsumen (TransactionDetailModal.tsx).
    payments: (row.payments ?? []).map((p: any) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      received_amount: p.received_amount,
      change_amount: p.change_amount,
      reference_no: p.reference_no,
      notes: p.notes,
      due_date: p.due_date,
      proofs: p.payment_proofs ?? [],
    })),
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

// ── TAMBAHAN (T-09) ── Soft-delete & restore transaksi, lewat RPC
// `soft_delete_transaction` / `restore_transaction` (migration 014).
// Admin-only (ditegakkan di dalam RPC — lihat komentar header migration 014
// poin 4). BERBEDA dari voidTransaction() di atas: ini TIDAK mengubah status
// maupun mengembalikan stok, murni menyembunyikan baris dari tampilan normal
// (Riwayat Transaksi, Dashboard, Laporan — semua query itu sudah
// `.is("deleted_at", null)`). Dipakai halaman Sampah untuk memulihkan, dan
// (menyusul) tombol "Hapus" di Riwayat Transaksi/TransactionDetailModal.

export interface DeleteTransactionParams {
  transactionId: string;
  /** Opsional — beda dari void yang mewajibkan alasan. */
  reason?: string;
}

/** Pindahkan transaksi ke Sampah (isi `deleted_at`). Admin only. */
export async function deleteTransaction(
  params: DeleteTransactionParams,
): Promise<{ success: boolean; transaction_id: string }> {
  const { data, error } = await supabase.rpc("soft_delete_transaction", {
    p_transaction_id: params.transactionId,
    p_reason: params.reason?.trim() || null,
  });

  if (error) {
    console.error("soft_delete_transaction RPC error:", error);
    throw new Error(error.message || "Gagal menghapus transaksi.");
  }

  if (!data?.success) {
    throw new Error("Transaksi gagal dihapus.");
  }

  return { success: true, transaction_id: data.transaction_id };
}

/** Pulihkan transaksi dari Sampah (kosongkan `deleted_at`). Admin only. */
export async function restoreTransaction(
  transactionId: string,
): Promise<{ success: boolean; transaction_id: string }> {
  const { data, error } = await supabase.rpc("restore_transaction", {
    p_transaction_id: transactionId,
  });

  if (error) {
    console.error("restore_transaction RPC error:", error);
    throw new Error(error.message || "Gagal memulihkan transaksi.");
  }

  if (!data?.success) {
    throw new Error("Transaksi gagal dipulihkan.");
  }

  return { success: true, transaction_id: data.transaction_id };
}

// ── TAMBAHAN (T-02) ── Upload bukti pembayaran (transfer/QRIS) ke Storage bucket
// "payment-proofs" (migration 006_payment_enhance.sql), lalu simpan metadatanya ke
// tabel payment_proofs. Dipanggil dari PaymentModal.tsx SETELAH createTransaction()
// sukses dan payment_id sudah didapat — supaya bukti selalu terikat ke payment yang
// benar-benar tersimpan (tidak upload dulu baru transaksi gagal, jadi file nyasar).

export interface UploadPaymentProofResult {
  id: string;
  fileUrl: string;
}

/**
 * Kompresi gambar (browser-image-compression, sesuai PRD §7 util) lalu upload ke
 * Storage. Kalau file bukan gambar (jarang, tapi bukti bisa juga PDF hasil screenshot
 * transfer di beberapa bank), lewati kompresi dan upload apa adanya.
 */
async function compressIfImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  try {
    return await imageCompression(file, {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1600,
      useWebWorker: true,
    });
  } catch (err) {
    // Kompresi gagal (mis. format tidak didukung browser) — upload file asli saja
    // daripada gagal total. Ukuran lebih besar masih lebih baik daripada tidak ada bukti.
    console.error("Kompresi bukti pembayaran gagal, upload file asli:", err);
    return file;
  }
}

export async function uploadPaymentProof(
  paymentId: string,
  file: File,
  // ── TAMBAHAN (T-08) ── 'payment' (default) = bukti saat checkout, tidak
  // berubah untuk pemanggil lama (PaymentModal.tsx). 'settlement' = bukti
  // pelunasan piutang TEMPO, dipakai LaporanModule.tsx (kolom proof_type,
  // migration 012_receivables_settlement.sql).
  proofType: "payment" | "settlement" = "payment",
): Promise<UploadPaymentProofResult> {
  if (!paymentId) {
    throw new Error("payment_id tidak valid untuk upload bukti pembayaran.");
  }

  const compressed = await compressIfImage(file);

  const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : "";
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${paymentId}/${uniqueSuffix}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("payment-proofs")
    .upload(path, compressed, {
      contentType: compressed.type || file.type || undefined,
      upsert: false,
    });

  if (uploadError) {
    console.error("Upload bukti pembayaran error:", uploadError);
    throw new Error(uploadError.message || "Gagal mengunggah bukti pembayaran.");
  }

  const { data: publicUrlData } = supabase.storage
    .from("payment-proofs")
    .getPublicUrl(path);

  const { data, error } = await supabase
    .from("payment_proofs")
    .insert({
      payment_id: paymentId,
      file_url: publicUrlData.publicUrl,
      file_name: file.name,
      file_size: compressed.size,
      proof_type: proofType,
    })
    .select("id, file_url")
    .single();

  if (error) {
    console.error("Simpan metadata bukti pembayaran error:", error);
    throw new Error(
      error.message || "Bukti terunggah tapi gagal disimpan datanya.",
    );
  }

  return { id: data.id, fileUrl: data.file_url };
}

/**
 * Upload beberapa bukti sekaligus. Berhenti di file pertama yang gagal — sengaja
 * TIDAK "best effort lanjut" supaya user tahu persis file mana yang gagal (pesan
 * error dari uploadPaymentProof sudah spesifik per file).
 */
export async function uploadPaymentProofs(
  paymentId: string,
  files: File[],
  proofType: "payment" | "settlement" = "payment",
): Promise<UploadPaymentProofResult[]> {
  const results: UploadPaymentProofResult[] = [];

  for (const file of files) {
    results.push(await uploadPaymentProof(paymentId, file, proofType));
  }

  return results;
}