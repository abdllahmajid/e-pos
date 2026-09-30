// lib/midtrans/server.ts
// ── TAMBAHAN (Midtrans, langkah 2) ── Helper KHUSUS SERVER untuk pembayaran
// digital lewat Midtrans Snap. Dipakai oleh API route di app/api/midtrans/*.
//
// ATURAN PENTING
//   * File ini JANGAN PERNAH di-import dari Client Component ("use client").
//     Isinya memakai MIDTRANS_SERVER_KEY dan SUPABASE_SERVICE_ROLE_KEY yang
//     tidak boleh sampai ke browser.
//   * Kunci tidak boleh diberi prefix NEXT_PUBLIC_.
//
// ENV YANG DIBUTUHKAN (.env.local / environment hosting):
//   MIDTRANS_SERVER_KEY        Server Key dari dashboard Midtrans (rahasia)
//   MIDTRANS_CLIENT_KEY        Client Key dari dashboard Midtrans
//   MIDTRANS_IS_PRODUCTION     "true" untuk live, selain itu = sandbox
//   MIDTRANS_ORDER_PREFIX      (opsional) awalan Order ID, default "POS"
//   MIDTRANS_EXPIRY_MINUTES    (opsional) masa berlaku tagihan, default 30
//   SUPABASE_SERVICE_ROLE_KEY  sudah dipakai route create-user

import { createServerClient } from "@supabase/ssr";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────
// Tipe
// ─────────────────────────────────────────────────────────────────────

/** Status yang sudah dinormalkan (sama dengan CHECK di migration 035). */
export type DigitalPaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled";

export interface DigitalPaymentRow {
  id: string;
  order_id: string;
  cashier_id: string;
  gross_amount: number;
  snap_token: string | null;
  status: DigitalPaymentStatus;
  midtrans_status: string | null;
  payment_type: string | null;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  used_at: string | null;
}

/** Bentuk respons status/notifikasi Midtrans (hanya field yang kita pakai). */
export interface MidtransStatusPayload {
  order_id?: string;
  status_code?: string;
  status_message?: string;
  transaction_status?: string;
  fraud_status?: string;
  gross_amount?: string;
  payment_type?: string;
  signature_key?: string;
  transaction_id?: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────
// Konfigurasi
// ─────────────────────────────────────────────────────────────────────

export interface MidtransConfig {
  serverKey: string;
  clientKey: string;
  isProduction: boolean;
  /** POST buat transaksi Snap. */
  snapApiUrl: string;
  /** Base URL Core API (status, cancel). */
  apiBaseUrl: string;
  /** URL snap.js untuk dimuat di browser. */
  snapJsUrl: string;
  orderPrefix: string;
  expiryMinutes: number;
}

export class MidtransConfigError extends Error {}

/**
 * Jenis kunci dari awalannya: "SB-Mid-server-…", "Mid-server-…" (baru) atau
 * "VT-server-…" (akun lama). Mengembalikan null kalau formatnya tidak dikenal
 * — dalam kasus itu kita tidak menebak-nebak.
 */
function midtransKeyKind(key: string): "server" | "client" | null {
  const m = key.match(/^(?:SB-)?(?:Mid|VT)-(server|client)-/i);
  return m ? (m[1].toLowerCase() as "server" | "client") : null;
}

/** Bagian awal kunci yang aman ditampilkan di log (tanpa bagian rahasia). */
function safeKeyPrefix(key: string): string {
  const m = key.match(/^(?:SB-)?(?:Mid|VT)-(?:server|client)-/i);
  return m ? m[0] : `${key.slice(0, 2)}… (format tidak dikenal)`;
}

export function getMidtransConfig(): MidtransConfig {
  const serverKey = (process.env.MIDTRANS_SERVER_KEY ?? "").trim();
  const clientKey = (process.env.MIDTRANS_CLIENT_KEY ?? "").trim();
  const isProduction =
    (process.env.MIDTRANS_IS_PRODUCTION ?? "").trim().toLowerCase() === "true";

  if (!serverKey || !clientKey) {
    throw new MidtransConfigError(
      "Midtrans belum dikonfigurasi. Isi MIDTRANS_SERVER_KEY dan MIDTRANS_CLIENT_KEY di environment.",
    );
  }

  // Kunci tertukar adalah penyebab paling umum error 401 dari Midtrans. Yang
  // lebih berbahaya: Server Key di MIDTRANS_CLIENT_KEY akan DIKIRIM ke browser.
  if (midtransKeyKind(serverKey) === "client") {
    throw new MidtransConfigError(
      "MIDTRANS_SERVER_KEY berisi Client Key. Isi dengan Server Key (…-server-…) dari dashboard Midtrans.",
    );
  }
  if (midtransKeyKind(clientKey) === "server") {
    throw new MidtransConfigError(
      "MIDTRANS_CLIENT_KEY berisi Server Key (RAHASIA). Isi dengan Client Key (…-client-…). Jangan pernah membagikan Server Key.",
    );
  }

  // Salah pasang mode/kunci. Awalan "SB-" / "VT-" PASTI kunci sandbox, jadi
  // kalau dipakai bersama MIDTRANS_IS_PRODUCTION=true itu jelas salah. Arah
  // sebaliknya (mode sandbox tetapi kunci berawalan "Mid-") HANYA diberi
  // peringatan, tidak diblokir: kunci sandbox format lama juga bisa berawalan
  // "Mid-", jadi awalan saja tidak bisa memastikan. Penentu sebenarnya adalah
  // jawaban Midtrans — pakai `node scripts/midtrans-check.mjs` untuk mengujinya.
  const isSandboxKey = /^(SB-|VT-)/i.test(serverKey);
  if (isProduction && isSandboxKey) {
    throw new MidtransConfigError(
      "MIDTRANS_IS_PRODUCTION=true tetapi MIDTRANS_SERVER_KEY adalah kunci sandbox (SB-... / VT-...).",
    );
  }
  if (!isProduction && !isSandboxKey) {
    console.warn(
      "[midtrans] Mode SANDBOX tetapi Server Key tidak berawalan SB-/VT-. Kalau Midtrans menjawab 401, kemungkinan ini kunci Production.",
    );
  }

  const rawPrefix = (process.env.MIDTRANS_ORDER_PREFIX ?? "POS").trim();
  // Order ID Midtrans hanya boleh huruf, angka, - _ ~ . dan maks 50 karakter.
  const orderPrefix =
    rawPrefix.replace(/[^A-Za-z0-9_.~-]/g, "").slice(0, 12) || "POS";

  const rawExpiry = Number(process.env.MIDTRANS_EXPIRY_MINUTES ?? 30);
  const expiryMinutes =
    Number.isFinite(rawExpiry) && rawExpiry >= 1
      ? Math.min(Math.floor(rawExpiry), 24 * 60)
      : 30;

  return {
    serverKey,
    clientKey,
    isProduction,
    snapApiUrl: isProduction
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions",
    apiBaseUrl: isProduction
      ? "https://api.midtrans.com"
      : "https://api.sandbox.midtrans.com",
    snapJsUrl: isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js",
    orderPrefix,
    expiryMinutes,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Supabase (admin + autentikasi pemanggil)
// ─────────────────────────────────────────────────────────────────────

/**
 * Client SERVICE ROLE — melewati RLS. Dipakai untuk menulis tabel
 * digital_payments (tabel itu memang tidak bisa ditulis user biasa).
 * Setiap route WAJIB memvalidasi pemanggil sendiri sebelum memakainya.
 */
export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new MidtransConfigError(
      "NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diisi.",
    );
  }
  return createSupabaseAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type CashierAuth =
  | { ok: true; userId: string; supabaseUser: SupabaseClient }
  | { ok: false; response: NextResponse };

function buildUserClient(request: NextRequest): SupabaseClient {
  const cookieStore = request.cookies;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Route ini tidak menulis cookie balik — no-op.
        },
      },
    },
  ) as unknown as SupabaseClient;
}

/**
 * Siapa yang memanggil? Baca cookie sesi (pola sama dengan
 * app/api/admin/create-user/route.ts). Kalau `requireKasirPermission`,
 * pemanggil juga harus punya permission 'kasir' (RPC has_permission,
 * migration 028/031) dan akunnya aktif.
 */
export async function authorizeCaller(
  request: NextRequest,
  options: { requireKasirPermission: boolean },
): Promise<CashierAuth> {
  const supabaseUser = buildUserClient(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user) {
    return { ok: false, response: jsonError("Belum login.", 401) };
  }

  if (options.requireKasirPermission) {
    const { data: allowed, error: permError } = await supabaseUser.rpc(
      "has_permission",
      { p_key: "kasir" },
    );
    if (permError) {
      console.error("has_permission error:", permError);
      return {
        ok: false,
        response: jsonError("Gagal memeriksa hak akses.", 500),
      };
    }
    if (allowed !== true) {
      return {
        ok: false,
        response: jsonError("Anda tidak punya akses ke menu Kasir.", 403),
      };
    }
  }

  return { ok: true, userId: user.id, supabaseUser };
}

// ─────────────────────────────────────────────────────────────────────
// Panggilan ke API Midtrans
// ─────────────────────────────────────────────────────────────────────

interface MidtransHttpResult {
  httpStatus: number;
  json: Record<string, unknown> | null;
}

async function midtransRequest(
  method: "GET" | "POST",
  url: string,
  serverKey: string,
  body?: unknown,
): Promise<MidtransHttpResult> {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      // Midtrans memakai Basic Auth: Server Key sebagai username, password kosong.
      Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { httpStatus: res.status, json };
}

/** Buat Order ID unik. Contoh: POS-1789887932168-483920 (maks 50 karakter). */
export function generateOrderId(prefix: string): string {
  const rand = randomInt(100000, 1000000);
  return `${prefix}-${Date.now()}-${rand}`.slice(0, 50);
}

export interface CreateSnapParams {
  orderId: string;
  amount: number;
  customerName?: string;
  customerPhone?: string;
}

/** Minta token Snap ke Midtrans. Melempar Error kalau Midtrans menolak. */
export async function createSnapTransaction(
  cfg: MidtransConfig,
  params: CreateSnapParams,
): Promise<{ token: string; redirectUrl: string | null }> {
  const payload: Record<string, unknown> = {
    transaction_details: {
      order_id: params.orderId,
      gross_amount: params.amount,
    },
    // Satu baris rincian supaya tombol "Details" di Snap menampilkan sesuatu.
    // Total item HARUS sama dengan gross_amount (aturan Midtrans).
    item_details: [
      {
        id: "POS",
        price: params.amount,
        quantity: 1,
        name: "Pembayaran di kasir",
      },
    ],
    expiry: { unit: "minutes", duration: cfg.expiryMinutes },
  };

  if (params.customerName || params.customerPhone) {
    payload.customer_details = {
      ...(params.customerName ? { first_name: params.customerName } : {}),
      ...(params.customerPhone ? { phone: params.customerPhone } : {}),
    };
  }

  const { httpStatus, json } = await midtransRequest(
    "POST",
    cfg.snapApiUrl,
    cfg.serverKey,
    payload,
  );

  const token = typeof json?.token === "string" ? json.token : null;
  if (httpStatus >= 200 && httpStatus < 300 && token) {
    return {
      token,
      redirectUrl:
        typeof json?.redirect_url === "string" ? json.redirect_url : null,
    };
  }

  if (httpStatus === 401) {
    console.error(
      `[midtrans] 401 dari Midtrans. mode=${cfg.isProduction ? "production" : "sandbox"}, ` +
        `server key awalan=${safeKeyPrefix(cfg.serverKey)}, panjang=${cfg.serverKey.length} karakter.`,
    );
    throw new Error(
      "Kunci Midtrans ditolak (401). Pastikan MIDTRANS_SERVER_KEY adalah Server Key dari environment (Sandbox/Production) yang sama dengan MIDTRANS_IS_PRODUCTION, lalu restart server. Jalankan `node scripts/midtrans-check.mjs` untuk mendiagnosa.",
    );
  }

  const messages = Array.isArray(json?.error_messages)
    ? (json!.error_messages as unknown[]).map(String).join("; ")
    : "";
  throw new Error(
    messages || `Midtrans menolak permintaan (HTTP ${httpStatus}).`,
  );
}

/**
 * Ambil status order dari Midtrans. Mengembalikan null kalau order belum ada
 * di sisi Midtrans — normal untuk Snap: order baru "lahir" saat pelanggan
 * memilih metode pembayaran, jadi sebelum itu status API menjawab 404.
 */
export async function getMidtransStatus(
  cfg: MidtransConfig,
  orderId: string,
): Promise<MidtransStatusPayload | null> {
  const { httpStatus, json } = await midtransRequest(
    "GET",
    `${cfg.apiBaseUrl}/v2/${encodeURIComponent(orderId)}/status`,
    cfg.serverKey,
  );

  if (!json) {
    throw new Error(`Respons status Midtrans tidak terbaca (HTTP ${httpStatus}).`);
  }
  const statusCode = String(json.status_code ?? httpStatus);
  if (httpStatus === 404 || statusCode === "404") return null;
  if (statusCode === "401" || httpStatus === 401) {
    throw new Error("Midtrans menolak kunci (401). Periksa MIDTRANS_SERVER_KEY.");
  }
  return json as MidtransStatusPayload;
}

/** Batalkan order di Midtrans. Hasilnya informatif; error diabaikan pemanggil. */
export async function cancelMidtransOrder(
  cfg: MidtransConfig,
  orderId: string,
): Promise<MidtransHttpResult> {
  return midtransRequest(
    "POST",
    `${cfg.apiBaseUrl}/v2/${encodeURIComponent(orderId)}/cancel`,
    cfg.serverKey,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Status: pemetaan, signature, dan penerapan ke database
// ─────────────────────────────────────────────────────────────────────

/**
 * Ubah status Midtrans jadi status aplikasi. Mengembalikan null kalau status
 * tidak boleh mengubah apa pun (mis. refund/chargeback setelah lunas — uang
 * sudah tercatat sebagai transaksi, refund ditangani manual).
 */
export function mapMidtransStatus(
  payload: MidtransStatusPayload,
): DigitalPaymentStatus | null {
  const ts = payload.transaction_status;
  const fraud = payload.fraud_status;

  switch (ts) {
    case "settlement":
      return "paid";
    case "capture":
      // Kartu: capture + fraud accept = lunas; challenge = tunggu review.
      if (fraud === "deny") return "failed";
      return fraud === "challenge" ? "pending" : "paid";
    case "pending":
    case "authorize":
      return "pending";
    case "deny":
    case "failure":
      return "failed";
    case "cancel":
      return "cancelled";
    case "expire":
      return "expired";
    default:
      // refund, partial_refund, chargeback, dst.
      return null;
  }
}

/** Cek signature_key notifikasi: sha512(order_id + status_code + gross_amount + serverKey). */
export function verifyMidtransSignature(
  payload: MidtransStatusPayload,
  serverKey: string,
): boolean {
  const { order_id, status_code, gross_amount, signature_key } = payload;
  if (!order_id || !status_code || !gross_amount || !signature_key) {
    return false;
  }
  const expected = createHash("sha512")
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature_key), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Terapkan status dari Midtrans ke baris digital_payments. Dipakai bersama
 * oleh webhook, cek status, dan pembatalan supaya aturannya SATU tempat:
 *   - 'paid' tidak pernah diturunkan lagi (uang sudah diterima).
 *   - Status akhir (failed/expired/cancelled) tidak kembali ke 'pending'.
 *   - 'paid' boleh menimpa status akhir: kalau uang benar-benar masuk setelah
 *     order dibatalkan/kedaluwarsa di sisi kita, itu harus terlihat sebagai
 *     'paid' (transaction_id masih kosong = perlu ditindaklanjuti), bukan
 *     hilang diam-diam.
 *   - Nominal dari Midtrans harus sama dengan nominal order kita; kalau beda,
 *     JANGAN ditandai lunas.
 * Mengembalikan baris terbaru, atau null kalau order tidak dikenal.
 */
export async function applyMidtransStatus(
  admin: SupabaseClient,
  payload: MidtransStatusPayload,
): Promise<DigitalPaymentRow | null> {
  const orderId = payload.order_id;
  if (!orderId) return null;

  const { data: row, error: readError } = await admin
    .from("digital_payments")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Gagal membaca digital_payments: ${readError.message}`);
  }
  if (!row) return null;

  const current = row as DigitalPaymentRow;
  let next = mapMidtransStatus(payload);

  if (next === "paid") {
    const paidAmount = Number(payload.gross_amount);
    if (
      !Number.isFinite(paidAmount) ||
      Math.round(paidAmount) !== Number(current.gross_amount)
    ) {
      console.error(
        `[midtrans] Nominal tidak cocok untuk ${orderId}: Midtrans=${payload.gross_amount}, order=${current.gross_amount}. Tidak ditandai lunas.`,
      );
      next = null;
    }
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    midtrans_status: payload.transaction_status ?? current.midtrans_status,
    payment_type: payload.payment_type ?? current.payment_type,
    raw_notification: payload,
    updated_at: now,
  };

  const canChange =
    next !== null &&
    next !== current.status &&
    current.status !== "paid" &&
    (next === "paid" || current.status === "pending");

  if (canChange && next) {
    update.status = next;
    if (next === "paid") update.paid_at = now;
  }

  const { data: updated, error: updateError } = await admin
    .from("digital_payments")
    .update(update)
    .eq("id", current.id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(`Gagal memperbarui digital_payments: ${updateError.message}`);
  }
  return updated as DigitalPaymentRow;
}

/** Bentuk yang dikirim ke browser (tanpa token & payload mentah). */
export function toClientState(row: DigitalPaymentRow) {
  return {
    orderId: row.order_id,
    status: row.status,
    midtransStatus: row.midtrans_status,
    paymentType: row.payment_type,
    amount: Number(row.gross_amount),
    used: row.transaction_id !== null,
  };
}