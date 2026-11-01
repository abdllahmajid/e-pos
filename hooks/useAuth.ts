"use client";

import { useEffect, useState } from "react";
// ⚠️ GANTI path ini setelah kamu ketemu lokasi asli file Supabase client di project kamu.
import { createClient } from "@/lib/supabase/client";
import { MODULE_KEYS, resolvePermissions } from "@/lib/pos/permissionModules";
import { getUserRoles, roleLabel } from "@/lib/pos/roles";

// ── KOREKSI (bug: "selalu rendering" / risiko rate limit auth) ── Dipindah
// ke scope MODUL (dipanggil sekali saat file ini pertama kali diimpor),
// bukan di dalam badan `useAuth()`. `createClient()` sudah singleton (lihat
// catatan di lib/supabase/client.ts), jadi baris ini cuma mengambil referensi
// ke instance yang sama dipakai semua hook lain di app ini.
const supabase = createClient();

// ── REVISI (migration 038, "izin per user") ──
// Sistem role dinamis (migration 028/031: tabel roles/role_permissions, level,
// lintas_kasir) DIGANTI izin per user, sama dengan aplikasi Monitoring Konveksi:
//   - Izin disimpan di `profiles.permissions` (jsonb) — per modul & aksi.
//   - `profiles.roles` (text[]) hanya LABEL jabatan (boleh lebih dari satu),
//     kecuali `super_admin` yang selalu punya semua akses.
// Konsekuensi di file ini:
//   - `AuthUser.role_id/role_name/role_level/lintas_kasir` DIHAPUS. Gantinya
//     `roles`, `role_label`, `isSuperAdmin`. (lintas_kasir kini izin
//     `permissionActions.kasir.lintas_kasir`, hanya dipakai di database.)
//   - `hasPermission(user, key)` & `hasPermissionAction(user, key, aksi)` TETAP
//     dengan signature yang sama, jadi semua modul pemanggil tidak perlu diubah.
//     Super Admin selalu true (cermin has_permission di database).
export interface PermissionActions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface AuthUser {
  id: string;
  email: string | null;
  full_name: string | null;
  /** Label jabatan (boleh lebih dari satu): super_admin, admin, supervisor, kasir, qc. */
  roles: string[];
  /** Label siap tampil, mis. "Admin, Supervisor". */
  role_label: string;
  /** Super Admin: semua akses, tidak bergantung pada tabel izin. */
  isSuperAdmin: boolean;
  /**
   * Daftar permission_key yang boleh di-Lihat — dipertahankan supaya caller
   * lama `hasPermission(user, key)` (gate Sidebar, gate modul) tetap jalan.
   */
  permissions: string[];
  /**
   * Detail 4 aksi per permission_key (key yang tidak ada = semua aksi false).
   * Dipakai caller yang butuh granularitas (tombol Tambah/Ubah/Hapus).
   */
  permissionActions: Record<string, PermissionActions>;
  is_active: boolean;
}

// Helper murni (bukan hook) supaya bisa dipanggil dari mana saja — pola
// pemakaian: `hasPermission(user, "stok")`. Fail-closed: user null / key tak
// dikenal selalu false (kecuali Super Admin).
export function hasPermission(
  user: AuthUser | null,
  permissionKey: string
): boolean {
  if (!user) return false;
  return user.isSuperAdmin || user.permissions.includes(permissionKey);
}

// Cek aksi granular spesifik (bukan cuma Lihat) — tombol Tambah/Ubah/Hapus per
// menu sesuai hak akses user. Aksi lain hanya berlaku bila Lihat juga aktif
// (ditegakkan resolve di loadProfile & has_permission_action di database).
export function hasPermissionAction(
  user: AuthUser | null,
  permissionKey: string,
  action: keyof PermissionActions
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.permissionActions[permissionKey]?.[action] ?? false;
}

interface UseAuthResult {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadProfile(authUserId: string, email: string | null) {
    // ── REVISI (migration 038) ── Satu query ke `profiles` saja (tidak ada
    // join ke roles/role_permissions lagi): label role + izin per user ada di
    // baris profil itu sendiri.
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, is_active, roles, permissions")
      .eq("id", authUserId)
      .single();

    if (profileError || !data) {
      setError(
        "Login berhasil tapi profil tidak ditemukan — pastikan sudah insert baris di tabel profiles."
      );
      setUser(null);
      return;
    }

    const roles = getUserRoles({ roles: data.roles });
    const isSuperAdmin = roles.includes("super_admin");
    const resolved = resolvePermissions(data.permissions);

    // Cuma modul dengan view=true yang berarti "boleh Lihat menu ini"; aksi
    // lain tidak berarti apa-apa tanpa view (cermin has_permission_action).
    const permissionActions: Record<string, PermissionActions> = {};
    for (const key of MODULE_KEYS) {
      const m = resolved[key];
      permissionActions[key] = {
        view: m.view === true,
        create: m.view === true && m.create === true,
        edit: m.view === true && m.edit === true,
        delete: m.view === true && m.delete === true,
      };
    }
    const permissions = MODULE_KEYS.filter((key) => permissionActions[key].view);

    setUser({
      id: authUserId,
      email,
      full_name: data.full_name,
      roles,
      role_label: roles.map(roleLabel).join(", "),
      isSuperAdmin,
      permissions: isSuperAdmin ? [...MODULE_KEYS] : permissions,
      permissionActions,
      is_active: data.is_active,
    });
  }

  useEffect(() => {
    let isCancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isCancelled) return;
      if (session?.user) {
        loadProfile(session.user.id, session.user.email ?? null).finally(() =>
          setIsLoading(false)
        );
      } else {
        setIsLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfile(session.user.id, session.user.email ?? null);
      } else {
        setUser(null);
      }
    });

    return () => {
      isCancelled = true;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string) {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      const message = "Email atau password salah.";
      setError(message);
      return { error: message };
    }
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return { user, isLoading, error, signIn, signOut };
}