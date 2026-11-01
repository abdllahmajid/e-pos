// hooks/useAdminUsers.ts
// Daftar user (`profiles`) + aksi kelola user untuk Pengaturan > Pengguna.
//
// ── REVISI (migration 038, "izin per user") ── Dulu setiap user punya satu
// `role_id` (role dinamis) dan hak aksesnya ikut role. Sekarang tiap user
// membawa sendiri `roles` (label, boleh lebih dari satu) dan `permissions`
// (izin per modul & aksi), sama dengan aplikasi Monitoring Konveksi. Akibatnya:
//   - `updateUserRole` (RPC admin_update_user_role) dan `updateUserContact`
//     (update langsung) DIGABUNG jadi `saveUser` -> PATCH /api/admin/update-user,
//     yang menyimpan nama, email, role, dan izin dalam satu langkah, lengkap
//     dengan aturan "tidak boleh memberi izin yang tidak dimiliki".
//   - `createUser` mengirim email + PASSWORD yang diisi admin (tanpa email
//     undangan, sama dengan Konveksi) + `roles` + `permissions`.
//   - Password user diganti admin lewat `saveUser({ password })`; tombol kirim
//     reset password dihapus. Email login tidak bisa diubah.
//   - `setUserActive` (RPC admin_set_user_active) tidak berubah.
// User tidak pernah dihapus permanen (transaksi merujuk ke profilnya) — cukup
// dinonaktifkan.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeRoles } from "@/lib/pos/roles";
import { resolvePermissions, type UserPermissions } from "@/lib/pos/permissionModules";

const supabase = createClient();

export interface AdminUserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  roles: string[];
  permissions: UserPermissions;
  is_active: boolean;
  created_at: string;
}

interface SaveUserFields {
  fullName: string;
  /** Kosong = password tidak diubah. */
  password?: string;
  roles: string[];
  permissions: UserPermissions;
}

interface UseAdminUsersResult {
  users: AdminUserRow[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Simpan nama, email, role, dan izin satu user (aturan eskalasi dicek server). */
  saveUser: (userId: string, fields: SaveUserFields) => Promise<void>;
  /** Aktifkan/nonaktifkan user (bukan diri sendiri — ditolak RPC). */
  setUserActive: (userId: string, isActive: boolean) => Promise<void>;
  /**
   * Buat user baru dengan email + password dari admin (tanpa email undangan).
   * Panggil API route server, BUKAN RPC/`.update()` langsung, karena butuh
   * Supabase Admin API + service role key (lihat app/api/admin/create-user).
   * Mengembalikan id user baru supaya UI bisa langsung membuka halaman aksesnya.
   */
  createUser: (fields: {
    fullName: string;
    email: string;
    password: string;
    roles: string[];
    permissions: UserPermissions;
  }) => Promise<string>;
}

async function callAdminApi(
  url: string,
  method: "POST" | "PATCH",
  payload: unknown,
  fallbackMessage: string,
): Promise<{ user_id?: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Gagal menghubungi server — periksa koneksi internet Anda.");
  }

  let body: { error?: string; user_id?: string } = {};
  try {
    body = await response.json();
  } catch {
    // Body bukan JSON (mis. error 502 dari proxy) — pakai pesan generik di bawah.
  }

  if (!response.ok) {
    if (body.error) throw new Error(body.error);
    // Body bukan JSON = request tidak sampai ke handler kita (mis. 404 route belum terpasang).
    throw new Error(
      `${fallbackMessage} (server membalas ${response.status} tanpa pesan — periksa log terminal server dan pastikan file ${url}/route.ts ada, lalu restart server).`,
    );
  }
  return body;
}

export function useAdminUsers(): UseAdminUsersResult {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("id, full_name, email, is_active, created_at, roles, permissions")
      .order("created_at", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setUsers([]);
    } else {
      setUsers(
        (data ?? []).map((row) => ({
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          is_active: row.is_active,
          created_at: row.created_at,
          roles: normalizeRoles(row.roles),
          permissions: resolvePermissions(row.permissions),
        })),
      );
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const saveUser = useCallback(
    async (userId: string, fields: SaveUserFields) => {
      if (!fields.fullName.trim()) throw new Error("Nama tidak boleh kosong.");
      if (fields.password && fields.password.length < 8) throw new Error("Password minimal 8 karakter.");
      if (fields.roles.length === 0) throw new Error("Pilih minimal satu role.");
      await callAdminApi(
        "/api/admin/update-user",
        "PATCH",
        {
          id: userId,
          fullName: fields.fullName.trim(),
          password: fields.password ?? "",
          roles: fields.roles,
          permissions: fields.permissions,
        },
        "Gagal menyimpan perubahan user.",
      );
      await fetchUsers();
    },
    [fetchUsers],
  );

  const setUserActive = useCallback(
    async (userId: string, isActive: boolean) => {
      const { error: rpcError } = await supabase.rpc("admin_set_user_active", {
        p_user_id: userId,
        p_is_active: isActive,
      });

      if (rpcError) {
        throw new Error(
          rpcError.message || `Gagal ${isActive ? "mengaktifkan" : "menonaktifkan"} user.`,
        );
      }

      await fetchUsers();
    },
    [fetchUsers],
  );

  const createUser = useCallback(
    async (fields: {
      fullName: string;
      email: string;
      password: string;
      roles: string[];
      permissions: UserPermissions;
    }) => {
      const name = fields.fullName.trim();
      const email = fields.email.trim();
      if (!name) throw new Error("Nama tidak boleh kosong.");
      if (!email || !email.includes("@")) throw new Error("Email tidak valid.");
      if (fields.password.length < 8) throw new Error("Password minimal 8 karakter.");
      if (fields.roles.length === 0) throw new Error("Pilih minimal satu role.");

      const body = await callAdminApi(
        "/api/admin/create-user",
        "POST",
        { fullName: name, email, password: fields.password, roles: fields.roles, permissions: fields.permissions },
        "Gagal membuat user baru.",
      );

      await fetchUsers();
      return body.user_id ?? "";
    },
    [fetchUsers],
  );

  return {
    users,
    isLoading,
    error,
    refetch: fetchUsers,
    saveUser,
    setUserActive,
    createUser,
  };
}
