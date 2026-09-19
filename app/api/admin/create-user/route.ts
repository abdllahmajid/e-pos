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
// 2. Lookup role pemanggil di `profiles` pakai client ANON biasa (tunduk RLS,
//    bukan service role) -> pastikan admin/supervisor & aktif.
// 3. Guard sama seperti UI (PengaturanAdminTab.tsx getRoleOptionsFor):
//    supervisor tidak boleh membuat user dengan role 'admin'.
// 4. Baru pakai client SERVICE ROLE untuk: (a) inviteUserByEmail, lalu
//    (b) insert baris `profiles` (bypass RLS, sengaja — sudah divalidasi di
//    langkah 1-3), dan (c) tulis activity_logs (pola sama dgn migration 016).
// 5. Kalau langkah (b) gagal setelah (a) sukses, coba rollback: hapus auth
//    user yang baru dibuat, supaya tidak ada akun auth "yatim" tanpa profile.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

type UserRole = "admin" | "supervisor" | "kasir" | "qc";

const ROLE_OPTIONS: UserRole[] = ["admin", "supervisor", "kasir", "qc"];

export async function POST(request: NextRequest) {
  // ── Validasi input dasar ──
  let body: { fullName?: string; email?: string; role?: string };
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
  const role = body.role as UserRole;

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
  if (!ROLE_OPTIONS.includes(role)) {
    return NextResponse.json(
      { error: "Role tidak valid." },
      { status: 400 },
    );
  }

  // ── Langkah 1-2: siapa yang memanggil, apa role-nya (client ANON, tunduk RLS) ──
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

  const { data: callerProfile } = await supabaseUser
    .from("profiles")
    .select("role, is_active")
    .eq("id", caller.id)
    .single();

  const callerRole = callerProfile?.role as UserRole | undefined;
  const callerActive = callerProfile?.is_active === true;

  if (!callerActive || (callerRole !== "admin" && callerRole !== "supervisor")) {
    return NextResponse.json(
      { error: "Anda tidak punya izin untuk membuat user baru." },
      { status: 403 },
    );
  }

  // ── Langkah 3: guard sama seperti UI — supervisor tidak boleh bikin admin ──
  if (callerRole === "supervisor" && role === "admin") {
    return NextResponse.json(
      { error: "Supervisor tidak bisa membuat user dengan role Admin." },
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
    role,
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
    meta: { target_name: fullName, email, role },
  });

  return NextResponse.json({
    success: true,
    user_id: newUserId,
    email,
    role,
  });
}