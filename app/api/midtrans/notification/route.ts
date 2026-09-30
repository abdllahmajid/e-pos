// app/api/midtrans/notification/route.ts
// ── TAMBAHAN (Midtrans, langkah 5) ── Webhook: Midtrans memanggil URL ini
// setiap status pembayaran berubah (lunas, kedaluwarsa, dibatalkan, dst.).
//
// SETEL DI DASHBOARD MIDTRANS:
//   Settings -> Configuration -> Payment Notification URL
//   https://DOMAIN-ANDA/api/midtrans/notification
// (Untuk development di localhost, Midtrans tidak bisa menjangkau alamat
// lokal — pakai tunnel seperti ngrok, atau andalkan cek status di browser.)
//
// Route ini PUBLIK (dipanggil server Midtrans, tanpa cookie login), jadi
// path-nya didaftarkan di PUBLIC_PATHS middleware.ts. Keamanannya:
//   1. signature_key diverifikasi memakai Server Key — permintaan palsu ditolak.
//   2. Setelah signature valid, status DIAMBIL ULANG dari API Midtrans
//      (praktik yang dianjurkan Midtrans) dan itulah yang disimpan, bukan
//      isi kiriman mentah. Kalau pengambilan ulang gagal, isi kiriman yang
//      signature-nya valid dipakai sebagai cadangan.
//
// Aturan respons: 2xx = "sudah diterima" (Midtrans berhenti mengulang).
// Order yang tidak dikenal tetap dijawab 200 supaya Midtrans tidak
// mengulang tanpa henti (mis. tes notifikasi dari dashboard).

import { NextResponse, type NextRequest } from "next/server";
import {
  applyMidtransStatus,
  getAdminClient,
  getMidtransConfig,
  getMidtransStatus,
  jsonError,
  MidtransConfigError,
  verifyMidtransSignature,
  type MidtransStatusPayload,
} from "@/lib/midtrans/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: MidtransStatusPayload;
  try {
    payload = (await request.json()) as MidtransStatusPayload;
  } catch {
    return jsonError("Body bukan JSON.", 400);
  }

  let cfg;
  let admin;
  try {
    cfg = getMidtransConfig();
    admin = getAdminClient();
  } catch (err) {
    if (err instanceof MidtransConfigError) {
      console.error("[midtrans/notification] konfigurasi:", err.message);
      // 500 supaya Midtrans mengulang setelah konfigurasi diperbaiki.
      return jsonError("Server belum dikonfigurasi.", 500);
    }
    throw err;
  }

  if (!verifyMidtransSignature(payload, cfg.serverKey)) {
    console.warn(
      "[midtrans/notification] signature tidak valid untuk order",
      payload.order_id,
    );
    return jsonError("Signature tidak valid.", 403);
  }

  const orderId = String(payload.order_id);

  try {
    let effective: MidtransStatusPayload = payload;
    try {
      const remote = await getMidtransStatus(cfg, orderId);
      if (remote) effective = { ...remote, order_id: orderId };
    } catch (err) {
      console.error(
        "[midtrans/notification] ambil ulang status gagal, pakai kiriman:",
        err,
      );
    }

    const row = await applyMidtransStatus(admin, effective);
    if (!row) {
      console.warn("[midtrans/notification] order tidak dikenal:", orderId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[midtrans/notification] gagal memproses:", err);
    // 500 => Midtrans akan mengirim ulang notifikasi ini nanti.
    return jsonError("Gagal memproses notifikasi.", 500);
  }
}