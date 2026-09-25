// app/api/admin/create-user/route.ts
// ── TAMBAHAN ── Endpoint server-side untuk "Tambah User" di Pengaturan Admin
// (PRD §17 T-10, permintaan lanjutan setelah MVP — sebelumnya SENGAJA ditunda
// dengan keputusan "user dibuat via dashboard/invite", sekarang dipindah ke
// dalam app).
//
// KENAPA HARUS API ROUTE (bukan RPC Postgres seperti admin_update_user_role
// dkk di migration 016)? Membuat user = insert ke `auth.users`, dikelola
// GoTrue (Supabase Auth), BUKAN tabel biasa yang bisa disentuh RPC SQL biasa.
// Satu-satunya jalur resmi adalah Supabase Admin API
// (`supabase.auth.admin.inviteUserByEmail`), yang WAJIB pakai
// `SUPABASE_SERVICE_ROLE_KEY` — kunci ini bisa bypass SEMUA RLS, jadi:
//   - HANYA boleh dipakai di sini (kode server, jalan di Node runtime Next.js)
//   - TIDAK BOLEH PERNAH diberi prefix NEXT_PUBLIC_ dan tidak boleh dikirim
//     ke client dengan cara apa pun
//   - Route ini SENDIRI yang wajib memvalidasi permission pemanggil (siapa
//     yang sedang login lewat cookie sesi) SEBELUM memanggil Admin API —
//     kalau tidak, endpoint ini jadi celah privilege-escalation.
//
// Alur:
// 1. Baca cookie sesi pemanggil (pola sama seperti middleware.ts) -> siapa dia.
// 2. Cek permission pemanggil pakai RPC `has_permission`/`current_role_level`
//    lewat client ANON biasa (tunduk RLS, bukan service role) -> pastikan
//    punya permission 'pengaturan_admin' & aktif. (── REVISI migration 028:
//    sebelumnya cek `role === 'admin' || role === 'supervisor'` langsung dari
//    kolom `profiles.role` — sekarang lewat 2 RPC yang sama dipakai RLS &
//    RPC admin_update_user_role/admin_set_user_active, supaya SATU sumber
//    kebenaran, bukan logic permission yang diketik ulang di 3 tempat.)
// 3. Guard hierarki: role TUJUAN levelnya harus >= level pemanggil (── REVISI
//    migration 028: generalisasi dari guard lama "supervisor tidak boleh
//    membuat user dengan role admin" — sekarang berlaku untuk level berapa
//    pun, bukan cuma admin/supervisor).
// 4. Baru pakai client SERVICE ROLE untuk: (a) inviteUserByEmail, lalu
//    (b) insert baris `profiles` (bypass RLS, sengaja — sudah divalidasi di
//    langkah 1-3), dan (c) tulis activity_logs (pola sama dgn migration 016).
// 5. Kalau langkah (b) gagal setelah (a) sukses, coba rollback: hapus auth
//    user yang baru dibuat, supaya tidak ada akun auth "yatim" tanpa profile.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  // ── Validasi input dasar ──
  let body: { fullName?: string; email?: string; roleId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body request tidak valid (bukan JSON)." },
      { status: 400 },
    );
  }

  const fullName = (body.fullName ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const roleId = (body.roleId ?? "").trim();

  if (!fullName) {
    return NextResponse.json(
      { error: "Nama wajib diisi." },
      { status: 400 },
    );
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Email tidak valid." },
      { status: 400 },
    );
  }
  if (!roleId) {
    return NextResponse.json(
      { error: "Role wajib dipilih." },
      { status: 400 },
    );
  }

  // ── Langkah 1: siapa yang memanggil (client ANON, tunduk RLS) ──
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
    },
  );

  const {
    data: { user: caller },
  } = await supabaseUser.auth.getUser();

  if (!caller) {
    return NextResponse.json(
      { error: "Anda harus login untuk melakukan ini." },
      { status: 401 },
    );
  }

  // ── Langkah 2: permission (RPC has_permission — SECURITY DEFINER, sudah
  // otomatis mengembalikan false kalau caller tidak aktif, lihat definisinya
  // di migration 028). Dipanggil lewat client ANON (bukan admin) supaya
  // auth.uid() di dalam fungsi itu benar-benar merujuk ke pemanggil sesi ini.
  const { data: canManageUsers, error: permError } = await supabaseUser.rpc(
    "has_permission",
    { p_key: "pengaturan_admin" },
  );

  if (permError || !canManageUsers) {
    return NextResponse.json(
      { error: "Anda tidak punya izin untuk membuat user baru." },
      { status: 403 },
    );
  }

  // ── Langkah 3: guard hierarki — role tujuan levelnya harus >= level caller ──
  const { data: callerLevel } = await supabaseUser.rpc("current_role_level");

  const { data: targetRole, error: targetRoleError } = await supabaseUser
    .from("roles")
    .select("id, level")
    .eq("id", roleId)
    .single();

  if (targetRoleError || !targetRole) {
    return NextResponse.json(
      { error: "Role tujuan tidak ditemukan." },
      { status: 400 },
    );
  }

  if (typeof callerLevel === "number" && targetRole.level < callerLevel) {
    return NextResponse.json(
      {
        error:
          "Anda tidak bisa memberikan role dengan level lebih tinggi dari level Anda sendiri.",
      },
      { status: 403 },
    );
  }

  // ── Langkah 4: pakai service role, hanya mulai dari sini ──
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY belum diset di environment server. Tambahkan dulu ke .env.local (lokal) / environment variables (hosting), lalu restart server.",
      },
      { status: 500 },
    );
  }

  const supabaseAdmin = createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: inviteData, error: inviteError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      // ── TAMBAHAN ── Tanpa ini, Supabase mengarahkan link undangan langsung
      // ke Site URL (root app) tanpa lewat app/auth/callback/route.ts, dan
      // kode di URL akan ditolak middleware.ts sebelum sempat ditukar jadi
      // sesi (lihat komentar header route.ts callback). `?next=` di sini
      // yang menentukan halaman TUJUAN setelah sesi terbentuk.
      redirectTo: `${request.nextUrl.origin}/auth/callback?next=/set-password`,
    });

  if (inviteError || !inviteData?.user) {
    return NextResponse.json(
      {
        error:
          inviteError?.message ??
          "Gagal mengundang user baru lewat Supabase Auth.",
      },
      { status: 400 },
    );
  }

  const newUserId = inviteData.user.id;

  const { error: profileError } = await supabaseAdmin.from("profiles").insert({
    id: newUserId,
    full_name: fullName,
    role_id: roleId,
    is_active: true,
  });

  if (profileError) {
    // Rollback: jangan tinggalkan akun auth tanpa profile.
    await supabaseAdmin.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      {
        error:
          "Undangan terkirim tapi gagal menyimpan data profile, user dibatalkan: " +
          profileError.message,
      },
      { status: 500 },
    );
  }

  // Log aktivitas — pola sama seperti RPC admin_update_user_role (migration 016).
  await supabaseAdmin.from("activity_logs").insert({
    user_id: caller.id,
    action: "user_create",
    entity: "user",
    entity_id: newUserId,
    meta: { target_name: fullName, email, role_id: roleId },
  });

  return NextResponse.json({
    success: true,
    user_id: newUserId,
    email,
    role_id: roleId,
  });
}