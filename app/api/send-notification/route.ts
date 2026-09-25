// app/api/send-notification/route.ts
// ── TAMBAHAN ── Endpoint server-side untuk kirim push notification FCM
// (PRD §17 T-12, bagian "FCM"). Logika kirim yang sesungguhnya ada di
// `lib/notifications/sendPush.ts` (dipisah supaya bisa dipakai ulang lewat
// import biasa dari `/api/cron/daily-summary`, T-12 bagian lain — lihat
// komentar header file itu untuk alasan lengkap).
//
// ── Kenapa pemanggil dibatasi admin+supervisor SAJA (bukan semua user) ──
// Endpoint ini bisa mengirim notifikasi ke USER MANA PUN by `targetUserId`
// (dibaca dari `profiles.fcm_token` lewat service role, bypass RLS — lihat
// `sendPush.ts`). Kalau dibiarkan bisa dipanggil kasir biasa, seorang kasir
// bisa mengirim notifikasi PALSU (judul/isi bebas) ke device kasir/admin lain
// atas nama sistem — bukan celah keamanan data (tidak bocorkan apa pun),
// tapi jelas celah PENYALAHGUNAAN (spam/social engineering lewat notifikasi
// yang tampak resmi). Pola pembatasan role sama persis dengan
// `app/api/admin/create-user/route.ts`: validasi cookie sesi pemanggil DULU
// pakai client ANON (tunduk RLS), baru lanjut ke logika inti kalau lolos.
//
// ── REVISI (migration 028/030) ── Baris `.select("role, is_active")` di
// bawah TADINYA baca kolom `profiles.role` (enum lama), yang sudah dihapus
// total sejak migration 028 — kelewat waktu 7 modul frontend dibereskan,
// baru ketahuan waktu scan project-wide. Endpoint ini TIDAK dipetakan ke
// permission_key manapun di katalog `permissions` (bukan menu, murni
// keputusan "staf cukup senior boleh kirim notifikasi sistem" — lihat
// alasan di atas), jadi gate-nya digeneralisasi pakai `current_role_level()`
// (RPC yang sama dipakai hierarki admin_update_user_role di migration 028),
// BUKAN `has_permission()`. Threshold `<= 1` dipilih supaya perilaku persis
// sama dengan sebelumnya untuk 4 role bawaan (Admin level 0, Supervisor
// level 1 lolos; Kasir/QC level 2 tidak) — kalau nanti pemilik project bikin
// role custom yang levelnya sengaja ditaruh 0/1, role itu ikut lolos juga
// (konsisten dengan makna "level" di seluruh sistem: makin kecil, makin
// senior/dipercaya).
//
// ── Kenapa BUKAN dibatasi "cuma bisa kirim ke diri sendiri" ──
// Kalau begitu endpoint ini tidak berguna sama sekali — semua notifikasi
// yang bisa dibayangkan PRD (mis. "ada transaksi TEMPO baru, admin dikasih
// tahu", "shift ditutup dengan selisih kas, supervisor dikasih tahu") justru
// SELALU dari satu user ke user LAIN. Makanya batasannya di LEVEL role
// pemanggil, bukan di HUBUNGAN pemanggil-target.
//
// ── Belum dikerjakan sesi ini (di luar scope langkah ini) ──
// - Belum ada pemanggil sungguhan (KasirModule.tsx dkk belum ada yang
//   `fetch("/api/send-notification")` otomatis setelah event tertentu) —
//   endpoint ini baru infrastrukturnya, wiring ke event nyata (transaksi
//   TEMPO baru, shift selisih, dst.) menyusul, PRD §17 T-12 tidak merinci
//   event mana saja jadi belum diasumsikan sendiri di sini.
// - Belum ada rate limiting — risikonya rendah (endpoint sudah dibatasi
//   level role cukup senior saja, bukan publik), tapi dicatat sebagai utang
//   teknis kalau nanti dipakai untuk broadcast massal.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { sendPushToUser } from "@/lib/notifications/sendPush";

// Ambang batas level yang boleh kirim notifikasi — 0 (Admin) & 1 (Supervisor)
// di seed bawaan migration 028, lihat catatan REVISI di atas.
const MIN_CALLER_LEVEL = 1;

export async function POST(request: NextRequest) {
  // ── Validasi input dasar ──
  let body: { targetUserId?: string; title?: string; body?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body request tidak valid (bukan JSON)." },
      { status: 400 }
    );
  }

  const targetUserId = (body.targetUserId ?? "").trim();
  const title = (body.title ?? "").trim();
  const notifBody = (body.body ?? "").trim();
  const url = body.url?.trim() || undefined;

  if (!targetUserId) {
    return NextResponse.json(
      { error: "targetUserId wajib diisi." },
      { status: 400 }
    );
  }
  if (!title || !notifBody) {
    return NextResponse.json(
      { error: "title dan body wajib diisi." },
      { status: 400 }
    );
  }

  // ── Siapa yang memanggil, level role-nya berapa (client ANON, tunduk RLS) ──
  // Pola sama persis app/api/admin/create-user/route.ts: RPC `current_role_level`
  // (SECURITY DEFINER, migration 028) — otomatis NULL kalau caller tidak aktif/
  // tidak ditemukan, jadi tidak perlu query `is_active` terpisah lagi seperti
  // versi lama.
  const cookieStore = request.cookies;
  const supabaseUser = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Route ini tidak perlu menulis cookie balik — no-op.
        },
      },
    }
  );

  const {
    data: { user: caller },
  } = await supabaseUser.auth.getUser();

  if (!caller) {
    return NextResponse.json(
      { error: "Anda harus login untuk melakukan ini." },
      { status: 401 }
    );
  }

  const { data: callerLevel, error: levelError } =
    await supabaseUser.rpc("current_role_level");

  if (
    levelError ||
    typeof callerLevel !== "number" ||
    callerLevel > MIN_CALLER_LEVEL
  ) {
    return NextResponse.json(
      { error: "Anda tidak punya izin untuk mengirim notifikasi." },
      { status: 403 }
    );
  }

  // ── Logika inti — lihat lib/notifications/sendPush.ts ──
  const result = await sendPushToUser(targetUserId, {
    title,
    body: notifBody,
    url,
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  // "no_token" & "invalid_token_cleared" SENGAJA dikembalikan sebagai 200
  // (bukan 4xx/5xx) — dari sudut pandang pemanggil endpoint ini, "user
  // target belum/tidak lagi bisa menerima push" bukan kegagalan REQUEST-nya,
  // cuma keadaan wajar yang wajib bisa dibedakan (lihat komentar
  // SendPushResult di sendPush.ts) tanpa membuat pemanggil menganggap ada
  // yang error di sisi mereka.
  return NextResponse.json({ success: true, status: result.status });
}