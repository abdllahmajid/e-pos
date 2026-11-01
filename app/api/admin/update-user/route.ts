// app/api/admin/update-user/route.ts
//
// ── BARU (migration 038, izin per user) ── Simpan perubahan satu user:
// nama, email kontak, role (label), dan hak akses per modul — satu langkah,
// sama seperti PATCH /api/users di aplikasi Monitoring Konveksi.
//
//   PATCH { id, fullName, password?, roles[], permissions }
//   (email login TIDAK bisa diubah, sama dengan Konveksi; `password` opsional —
//   diisi = password user diganti langsung oleh admin, kosong = tidak berubah)
//
// Penulisan ke `profiles` terjadi DI SINI (service role) setelah semua aturan
// lolos; trigger `enforce_profiles_role_change` di database menegakkan aturan
// yang sama untuk jalur lain (defense in depth). Aturan:
//   1. Pemanggil harus punya izin pengaturan_admin.edit (atau Super Admin).
//   2. Hanya Super Admin yang boleh memberi/mencabut role Super Admin atau
//      mengubah akun yang sudah Super Admin.
//   3. Super Admin terakhir tidak bisa diturunkan.
//   4. Selain Super Admin: tidak boleh mengubah role/izin AKUN SENDIRI, dan
//      hanya boleh MENAMBAH izin yang ia sendiri punya (mengurangi boleh).

import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminCaller, fail } from "@/lib/supabase/adminApi";
import { normalizeRoles } from "@/lib/pos/roles";
import { sanitizePermissions } from "@/lib/pos/permissionModules";
import { findPermissionEscalation, permissionsEqual } from "@/lib/pos/permissionRules";

export async function PATCH(request: NextRequest) {
  let body: { id?: string; fullName?: string; password?: string; roles?: unknown; permissions?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Body request tidak valid (bukan JSON).", 400);
  }

  const id = (body.id ?? "").trim();
  const fullName = (body.fullName ?? "").trim();
  const password = body.password ?? "";
  const roles = normalizeRoles(body.roles);
  const permissions = sanitizePermissions(body.permissions);

  if (!id) return fail("id user wajib.", 400);
  if (!fullName) return fail("Nama tidak boleh kosong.", 400);
  if (password && password.length < 8) return fail("Password minimal 8 karakter.", 400);
  if (roles.length === 0) return fail("Pilih minimal satu role.", 400);

  const auth = await authorizeAdminCaller(request, "edit");
  if ("response" in auth) return auth.response;
  const { callerId, callerIsSuperAdmin, callerPermissions, supabaseAdmin } = auth;

  const { data: target } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, roles, permissions")
    .eq("id", id)
    .maybeSingle();
  if (!target) return fail("User tidak ditemukan.", 404);

  const oldRoles: string[] = Array.isArray(target.roles) ? target.roles : [];
  const wasSuper = oldRoles.includes("super_admin");
  const willBeSuper = roles.includes("super_admin");
  const currentPerms = sanitizePermissions(target.permissions);
  const rolesChanged = [...oldRoles].sort().join(",") !== [...roles].sort().join(",");
  const permsChanged = !permissionsEqual(permissions, currentPerms);

  if ((wasSuper || willBeSuper) && !callerIsSuperAdmin && (rolesChanged || permsChanged)) {
    return fail("Hanya Super Admin yang boleh mengubah akun atau role Super Admin.", 403);
  }

  if (password && wasSuper && !callerIsSuperAdmin) {
    return fail("Hanya Super Admin yang boleh mengganti password akun Super Admin.", 403);
  }

  if (wasSuper && !willBeSuper) {
    const { count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .neq("id", id)
      .eq("is_active", true)
      .contains("roles", ["super_admin"]);
    if ((count ?? 0) === 0) return fail("Tidak bisa menurunkan Super Admin terakhir.", 409);
  }

  if (!callerIsSuperAdmin) {
    if (id === callerId && (rolesChanged || permsChanged)) {
      return fail("Anda tidak bisa mengubah role atau izin akun Anda sendiri.", 403);
    }
    const over = findPermissionEscalation(permissions, currentPerms, callerPermissions);
    if (over) return fail(`Anda tidak bisa memberi izin yang tidak Anda miliki: ${over}`, 403);
  }

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({
      full_name: fullName,
      roles,
      permissions,
    })
    .eq("id", id);

  if (updateError) return fail(updateError.message || "Gagal menyimpan perubahan user.", 500);

  if (password) {
    const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
    if (pwError) return fail(pwError.message || "Profil tersimpan, tetapi password gagal diganti.", 500);
    await supabaseAdmin.from("activity_logs").insert({
      user_id: callerId,
      action: "user_password_change",
      entity: "user",
      entity_id: id,
      meta: { target_name: fullName },
    });
  }

  if (rolesChanged || permsChanged) {
    await supabaseAdmin.from("activity_logs").insert({
      user_id: callerId,
      action: "user_access_change",
      entity: "user",
      entity_id: id,
      meta: {
        target_name: fullName,
        old_roles: oldRoles,
        new_roles: roles,
        permissions_changed: permsChanged,
      },
    });
  }

  return NextResponse.json({ success: true });
}
