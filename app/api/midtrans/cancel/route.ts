// app/api/midtrans/cancel/route.ts
// ── TAMBAHAN (Midtrans, langkah 4) ── Batalkan order pembayaran digital yang
// belum dibayar (kasir menekan "Batalkan" di layar menunggu pembayaran).
//
// Kenapa perlu dibatalkan di Midtrans, bukan cuma ditutup di layar? Tanpa itu,
// pelanggan yang sudah mengantongi nomor VA masih bisa membayar sesudah kasir
// membatalkan — uangnya masuk tanpa ada transaksi di POS.
//
// Urutan yang aman:
//   1. Minta Midtrans membatalkan order.
//   2. Tanya status terakhir dan terapkan. Kalau ternyata SUDAH lunas di
//      detik-detik terakhir, hasilnya 'paid' dan browser diberi tahu
//      (kasir lanjut menyimpan transaksi, bukan membatalkan).
//   3. Kalau masih pending (mis. pelanggan belum pernah memilih metode
//      bayar sehingga Midtrans belum punya ordernya), tandai 'cancelled'
//      di database sendiri supaya RPC menolak order ini.
//
// POST /api/midtrans/cancel   body: { orderId: string }
// Respons: sama seperti /api/midtrans/status

import { NextResponse, type NextRequest } from "next/server";
import {
  applyMidtransStatus,
  authorizeCaller,
  cancelMidtransOrder,
  getAdminClient,
  getMidtransConfig,
  getMidtransStatus,
  jsonError,
  MidtransConfigError,
  toClientState,
  type DigitalPaymentRow,
} from "@/lib/midtrans/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authorizeCaller(request, { requireKasirPermission: false });
  if (!auth.ok) return auth.response;

  let body: { orderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request tidak valid (bukan JSON).", 400);
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return jsonError("orderId wajib diisi.", 400);

  let admin;
  let cfg;
  try {
    admin = getAdminClient();
    cfg = getMidtransConfig();
  } catch (err) {
    if (err instanceof MidtransConfigError) {
      return jsonError(err.message, 500);
    }
    throw err;
  }

  const { data, error } = await admin
    .from("digital_payments")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    console.error("[midtrans/cancel] baca gagal:", error);
    return jsonError("Gagal membaca pembayaran.", 500);
  }

  let row = data as DigitalPaymentRow | null;
  if (!row || row.cashier_id !== auth.userId) {
    return jsonError("Order pembayaran tidak ditemukan.", 404);
  }

  // Sudah final (lunas / gagal / kedaluwarsa / sudah dibatalkan): tidak ada
  // yang dibatalkan, cukup laporkan keadaan sebenarnya.
  if (row.status !== "pending") {
    return NextResponse.json(toClientState(row));
  }

  try {
    // Hasil cancel sengaja tidak dipakai langsung — 404/412 di sini wajar
    // (order belum ada / sudah tidak bisa dibatalkan). Kebenaran diambil dari
    // status terakhir di langkah berikutnya.
    await cancelMidtransOrder(cfg, orderId);

    const remote = await getMidtransStatus(cfg, orderId);
    if (remote) {
      const updated = await applyMidtransStatus(admin, {
        ...remote,
        order_id: orderId,
      });
      if (updated) row = updated;
    }
  } catch (err) {
    console.error("[midtrans/cancel] Midtrans error:", err);
    // Lanjut ke penandaan lokal di bawah; kalau nanti uang tetap masuk,
    // webhook akan menandainya 'paid' dan terlihat sebagai order yatim.
  }

  if (row.status === "pending") {
    const { data: cancelled, error: cancelError } = await admin
      .from("digital_payments")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (cancelError) {
      console.error("[midtrans/cancel] tandai batal gagal:", cancelError);
      return jsonError("Gagal membatalkan pembayaran.", 500);
    }
    if (cancelled) {
      row = cancelled as DigitalPaymentRow;
    } else {
      // Statusnya berubah di antara dua langkah (mis. webhook 'paid' masuk
      // tepat sekarang) — baca ulang supaya browser menerima keadaan sebenarnya.
      const { data: fresh } = await admin
        .from("digital_payments")
        .select("*")
        .eq("id", row.id)
        .maybeSingle();
      if (fresh) row = fresh as DigitalPaymentRow;
    }
  }

  return NextResponse.json(toClientState(row));
}