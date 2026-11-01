// app/api/admin/create-user/route.ts
//
// Endpoint server-side "Tambah User" di Pengaturan > Pengguna.
//
// ── REVISI (migration 038, izin per user) ── Sebelumnya body-nya
// `{ fullName, email, roleId }` dan hak akses ikut dari role dinamis. Sekarang
// `{ fullName, email, roles[], permissions }`: role hanya label, izin disimpan
// langsung di profil user (sama dengan aplikasi Monitoring Konveksi).
//
// KENAPA HARUS API ROUTE: membuat user = insert ke `auth.users` (GoTrue), satu-
// satunya jalur resmi adalah Supabase Admin API dengan SUPABASE_SERVICE_ROLE_KEY
// (lihat lib/supabase/adminApi.ts). Route ini SENDIRI yang wajib memvalidasi
// pemanggil sebelum memakai kunci itu — kalau tidak, jadi celah privilege-escalation.
//
// Aturan:
//   1. Pemanggil harus punya izin pengaturan_admin.create (atau Super Admin).
//   2. Hanya Super Admin yang boleh membuat akun ber-role Super Admin.
//   3. Selain Super Admin, izin user baru tidak boleh melebihi izin pemanggil
//      (dibandingkan dengan izin bawaan user baru).
//   4. REVISI: tidak ada email undangan lagi (sama dengan Konveksi). Admin
//      mengisi EMAIL + PASSWORD (min. 8 karakter) saat membuat user; akun auth
//      langsung aktif (email dianggap terverifikasi) dan user bisa login dengan
//      kredensial itu. Kalau menulis profil gagal, akun auth dibatalkan (rollback).

import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminCaller, fail } from "@/lib/supabase/adminApi";
import { DEFAULT_ROLES, normalizeRoles } from "@/lib/pos/roles";
import { DEFAULT_PERMISSIONS, sanitizePermissions } from "@/lib/pos/permissionModules";
import { findPermissionEscalation } from "@/lib/pos/permissionRules";

export async function POST(request: NextRequest) {
  let body: { fullName?: string; email?: string; password?: string; roles?: unknown; permissions?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Body request tidak valid (bukan JSON).", 400);
  }

  const fullName = (body.fullName ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const roles = body.roles === undefined ? [...DEFAULT_ROLES] : normalizeRoles(body.roles);
  const permissions = sanitizePermissions(body.permissions ?? DEFAULT_PERMISSIONS);

  if (!fullName) return fail("Nama wajib diisi.", 400);
  if (!email || !email.includes("@")) return fail("Email tidak valid.", 400);
  if (password.length < 8) return fail("Password minimal 8 karakter.", 400);
  if (roles.length === 0) return fail("Pilih minimal satu role.", 400);

  const auth = await authorizeAdminCaller(request, "create");
  if ("response" in auth) return auth.response;
  const { callerId, callerIsSuperAdmin, callerPermissions, supabaseAdmin } = auth;

  if (roles.includes("super_admin") && !callerIsSuperAdmin) {
    return fail("Hanya Super Admin yang boleh membuat akun Super Admin.", 403);
  }

  if (!callerIsSuperAdmin) {
    const over = findPermissionEscalation(permissions, DEFAULT_PERMISSIONS, callerPermissions);
    if (over) return fail(`Anda tidak bisa memberi izin yang tidak Anda miliki: ${over}`, 403);
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created?.user) {
    const msg = createError?.message ?? "";
    return fail(
      /already|registered|exists/i.test(msg)
        ? "Email ini sudah terdaftar. Gunakan email lain."
        : msg || "Gagal membuat akun user.",
      400,
    );
  }

  const newUserId = created.user.id;

  const { error: profileError } = await supabaseAdmin.from("profiles").insert({
    id: newUserId,
    full_name: fullName,
    email,
    roles,
    permissions,
    is_active: true,
  });

  if (profileError) {
    // Rollback: jangan tinggalkan akun auth tanpa profile.
    await supabaseAdmin.auth.admin.deleteUser(newUserId);
    return fail(
      "Akun dibuat tapi gagal menyimpan data profile, user dibatalkan: " + profileError.message,
      500,
    );
  }

  await supabaseAdmin.from("activity_logs").insert({
    user_id: callerId,
    action: "user_create",
    entity: "user",
    entity_id: newUserId,
    meta: { target_name: fullName, email, roles },
  });

  return NextResponse.json({ success: true, user_id: newUserId, email, roles });
}
