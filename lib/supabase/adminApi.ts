// lib/supabase/adminApi.ts
//
// ── MIGRATION 038 ── Helper server-side bersama untuk route /api/admin/*
// (create-user & update-user). Tugasnya: siapa yang memanggil, apakah ia
// berwenang, dan apa izin/role-nya (dipakai aturan "tidak boleh memberi izin
// yang tidak dimiliki"). SERVER ONLY — memakai SUPABASE_SERVICE_ROLE_KEY,
// yang TIDAK BOLEH diberi prefix NEXT_PUBLIC_ dan tidak boleh sampai ke client.
//
// Pola sama dengan route create-user sebelumnya: identitas pemanggil dibaca
// dari cookie sesi lewat client ANON (tunduk RLS), izin dicek lewat RPC
// `has_permission_action` (satu sumber kebenaran dengan RLS & RPC lain), dan
// baru setelah semua lolos dipakai client SERVICE ROLE untuk menulis.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { sanitizePermissions, type UserPermissions } from "@/lib/pos/permissionModules";

export const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

export interface AdminCaller {
  callerId: string;
  callerIsSuperAdmin: boolean;
  callerPermissions: UserPermissions;
  /** Client ANON milik pemanggil (tunduk RLS) — untuk RPC pengecekan izin. */
  supabaseUser: SupabaseClient;
  /** Client SERVICE ROLE — bypass RLS, pakai hanya setelah otorisasi lolos. */
  supabaseAdmin: SupabaseClient;
}

/**
 * Validasi pemanggil untuk aksi `create` / `edit` pada modul pengaturan_admin.
 * Mengembalikan `{ response }` (siap dikirim) bila ditolak.
 */
export async function authorizeAdminCaller(
  request: NextRequest,
  action: "create" | "edit",
): Promise<{ response: NextResponse } | AdminCaller> {
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
    return { response: fail("Anda harus login untuk melakukan ini.", 401) };
  }

  // RPC SECURITY DEFINER: otomatis false kalau caller tidak aktif; Super Admin selalu true.
  const { data: allowed, error: permError } = await supabaseUser.rpc("has_permission_action", {
    p_key: "pengaturan_admin",
    p_action: action,
  });
  if (permError || !allowed) {
    return {
      response: fail(
        action === "create"
          ? "Anda tidak punya izin untuk membuat user baru."
          : "Anda tidak punya izin untuk mengubah user.",
        403,
      ),
    };
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return {
      response: fail(
        "SUPABASE_SERVICE_ROLE_KEY belum diset di environment server. Tambahkan dulu ke .env.local (lokal) / environment variables (hosting), lalu restart server.",
        500,
      ),
    };
  }

  const supabaseAdmin = createSupabaseAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("roles, permissions")
    .eq("id", caller.id)
    .single();

  const roles: string[] = Array.isArray(callerProfile?.roles) ? callerProfile.roles : [];

  return {
    callerId: caller.id,
    callerIsSuperAdmin: roles.includes("super_admin"),
    callerPermissions: sanitizePermissions(callerProfile?.permissions),
    supabaseUser,
    supabaseAdmin,
  };
}
