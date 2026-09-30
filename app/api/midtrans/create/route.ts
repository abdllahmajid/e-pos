// app/api/midtrans/create/route.ts
// ── TAMBAHAN (Midtrans, langkah 3) ── Membuat order pembayaran digital.
//
// Dipanggil browser saat kasir memilih "Digital" lalu menekan Bayar.
// Alur:
//   1. Pastikan pemanggil login + punya permission 'kasir'.
//   2. Validasi nominal.
//   3. (Opsional) pakai ulang order pending yang sama — supaya kasir yang
//      menutup popup lalu menekan Bayar lagi TIDAK membuat order kedua
//      (order pertama bisa saja sudah dibayar pelanggan).
//   4. Catat baris digital_payments (pending) DULU, baru minta token ke
//      Midtrans. Urutan ini disengaja: kalau pencatatan gagal, tidak ada
//      order Midtrans yang bisa dibayar tanpa jejak di database kita.
//   5. Kembalikan token Snap + client key + URL snap.js ke browser.
//
// Body JSON:
//   { amount: number (rupiah, bulat > 0),
//     customerName?: string, customerPhone?: string,
//     reuseOrderId?: string }

import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeCaller,
  createSnapTransaction,
  generateOrderId,
  getAdminClient,
  getMidtransConfig,
  jsonError,
  MidtransConfigError,
  type DigitalPaymentRow,
} from "@/lib/midtrans/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Batas kewajaran supaya salah ketik nol tidak menagih miliaran.
const MAX_AMOUNT = 500_000_000;

export async function POST(request: NextRequest) {
  const auth = await authorizeCaller(request, { requireKasirPermission: true });
  if (!auth.ok) return auth.response;

  let body: {
    amount?: unknown;
    customerName?: unknown;
    customerPhone?: unknown;
    reuseOrderId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request tidak valid (bukan JSON).", 400);
  }

  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return jsonError("Nominal harus bilangan bulat lebih dari 0.", 400);
  }
  if (amount > MAX_AMOUNT) {
    return jsonError("Nominal melebihi batas pembayaran digital.", 400);
  }

  const customerName =
    typeof body.customerName === "string"
      ? body.customerName.trim().slice(0, 100)
      : "";
  const customerPhone =
    typeof body.customerPhone === "string"
      ? body.customerPhone.replace(/[^\d+]/g, "").slice(0, 20)
      : "";

  let cfg;
  let admin;
  try {
    cfg = getMidtransConfig();
    admin = getAdminClient();
  } catch (err) {
    if (err instanceof MidtransConfigError) {
      console.error("[midtrans/create] konfigurasi:", err.message);
      return jsonError(err.message, 500);
    }
    throw err;
  }

  // Saklar di Pengaturan: kalau pembayaran digital dimatikan, tolak order BARU.
  // (status/cancel/notification sengaja tidak dicek: order yang sudah berjalan
  // tetap harus bisa dilunasi/dibatalkan.) Gagal baca = anggap nonaktif.
  const { data: toggleRow, error: toggleError } = await admin
    .from("settings")
    .select("value")
    .eq("key", "digital_payment_enabled")
    .maybeSingle();
  if (toggleError || toggleRow?.value !== true) {
    return jsonError(
      "Pembayaran digital sedang dinonaktifkan. Aktifkan di Pengaturan > Toko & Struk.",
      403,
    );
  }

  const expiryMs = cfg.expiryMinutes * 60_000;

  const respond = (row: DigitalPaymentRow, token: string, reused: boolean) =>
    NextResponse.json({
      orderId: row.order_id,
      token,
      clientKey: cfg.clientKey,
      snapJsUrl: cfg.snapJsUrl,
      amount: Number(row.gross_amount),
      expiresAt: new Date(
        new Date(row.created_at).getTime() + expiryMs,
      ).toISOString(),
      reused,
    });

  // ── Pakai ulang order pending milik kasir ini (kalau masih layak) ──
  if (typeof body.reuseOrderId === "string" && body.reuseOrderId.trim()) {
    const { data: existing } = await admin
      .from("digital_payments")
      .select("*")
      .eq("order_id", body.reuseOrderId.trim())
      .maybeSingle();

    const row = existing as DigitalPaymentRow | null;
    if (
      row &&
      row.cashier_id === auth.userId &&
      row.status === "pending" &&
      row.transaction_id === null &&
      row.snap_token &&
      Number(row.gross_amount) === amount &&
      // sisakan 1 menit supaya tidak membuka tagihan yang hampir habis
      Date.now() < new Date(row.created_at).getTime() + expiryMs - 60_000
    ) {
      return respond(row, row.snap_token, true);
    }
  }

  // ── Catat dulu di database ──
  const orderId = generateOrderId(cfg.orderPrefix);
  const { data: inserted, error: insertError } = await admin
    .from("digital_payments")
    .insert({
      order_id: orderId,
      cashier_id: auth.userId,
      gross_amount: amount,
      status: "pending",
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    console.error("[midtrans/create] insert gagal:", insertError);
    return jsonError("Gagal mencatat pembayaran digital.", 500);
  }
  const row = inserted as DigitalPaymentRow;

  // ── Minta token ke Midtrans ──
  try {
    const { token } = await createSnapTransaction(cfg, {
      orderId,
      amount,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
    });

    const { error: tokenError } = await admin
      .from("digital_payments")
      .update({ snap_token: token, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (tokenError) {
      // Tidak fatal: token tetap kita kirim; hanya fitur "pakai ulang" yang hilang.
      console.error("[midtrans/create] simpan token gagal:", tokenError);
    }

    return respond({ ...row, snap_token: token }, token, false);
  } catch (err) {
    console.error("[midtrans/create] Midtrans error:", err);
    await admin
      .from("digital_payments")
      .update({
        status: "failed",
        midtrans_status: "snap_error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return jsonError(
      err instanceof Error
        ? `Midtrans: ${err.message}`
        : "Gagal membuat pembayaran di Midtrans.",
      502,
    );
  }
}