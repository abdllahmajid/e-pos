// app/api/midtrans/status/route.ts
// ── TAMBAHAN (Midtrans, langkah 4) ── Cek status pembayaran digital.
//
// Dipanggil browser berkala (polling) selagi kasir menunggu pelanggan bayar,
// dan saat kasir menekan "Cek status". Kalau order masih pending di database,
// route ini bertanya langsung ke Midtrans (tidak menunggu webhook) lalu
// menyimpan hasilnya. Kalau sudah final (paid/failed/expired/cancelled),
// cukup jawab dari database.
//
// GET /api/midtrans/status?order_id=POS-...
// Respons: { orderId, status, midtransStatus, paymentType, amount, used }

import { NextResponse, type NextRequest } from "next/server";
import {
  applyMidtransStatus,
  authorizeCaller,
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

export async function GET(request: NextRequest) {
  const auth = await authorizeCaller(request, { requireKasirPermission: false });
  if (!auth.ok) return auth.response;

  const orderId = request.nextUrl.searchParams.get("order_id")?.trim();
  if (!orderId) return jsonError("Parameter order_id wajib diisi.", 400);

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
    console.error("[midtrans/status] baca gagal:", error);
    return jsonError("Gagal membaca status pembayaran.", 500);
  }

  let row = data as DigitalPaymentRow | null;
  // Hanya pemilik order yang boleh melihat statusnya.
  if (!row || row.cashier_id !== auth.userId) {
    return jsonError("Order pembayaran tidak ditemukan.", 404);
  }

  if (row.status === "pending") {
    try {
      const remote = await getMidtransStatus(cfg, orderId);
      // remote null = pelanggan belum memilih metode pembayaran; tetap pending.
      if (remote) {
        const updated = await applyMidtransStatus(admin, {
          ...remote,
          order_id: orderId,
        });
        if (updated) row = updated;
      }
    } catch (err) {
      // Gagal bertanya ke Midtrans bukan berarti pembayaran gagal — jawab apa
      // adanya dari database, browser akan mencoba lagi pada polling berikutnya.
      console.error("[midtrans/status] Midtrans error:", err);
    }
  }

  return NextResponse.json(toClientState(row));
}