// hooks/useAdminUsers.ts
// ── TAMBAHAN ── Hook domain "Pengaturan Admin" (PRD §17 T-10, §5 baris
// `settings` = admin only). Dipakai oleh sub-tab "Pengaturan Admin" di
// PengaturanModule.tsx (menyusul) untuk: daftar semua user, ubah role,
// aktifkan/nonaktifkan, ubah nama/email kontak, dan kirim link reset
// password.
//
// Pembagian tanggung jawab dengan database (migration 016/017):
// - Ubah ROLE & IS_ACTIVE -> WAJIB lewat RPC `admin_update_user_role` /
//   `admin_set_user_active` (bukan `.update()` langsung), supaya perubahan
//   SELALU tercatat activity_logs. Trigger `enforce_profiles_role_change` di
//   database tetap akan menolak `.update()` langsung ke kolom itu oleh
//   non-admin, tapi RPC ini tetap jalur yang benar dipakai UI supaya lognya
//   konsisten — lihat komentar migration 016 poin 4.
// - Ubah `full_name`/`email` -> `.update()` langsung ke tabel (bukan RPC),
//   lolos lewat policy `profiles_update_admin_all` (migration 016) untuk
//   admin, atau `profiles_update_own` (migration 002) kalau user mengedit
//   dirinya sendiri. Trigger di atas TIDAK menyentuh kolom ini, jadi aman.
// - Reset password -> `supabase.auth.resetPasswordForEmail()`, BUKAN RPC
//   database — ini panggilan ke Supabase Auth, bukan ke tabel `profiles`,
//   dan sengaja TIDAK butuh service role key (lihat komentar header migration
//   016 poin 1). Gagal kalau `email` user kosong (migration 017) — hook ini
//   melempar Error jelas sebelum sempat memanggil Supabase kalau begitu,
//   supaya UI tidak perlu menebak dari pesan error Supabase yang generik.
//
// Pola sama dengan hooks/useTrash.ts: query ringan (field seperlunya),
// mutasi melempar Error yang ditangani UI (bukan RPC yang ditelan diam-diam).

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/hooks/useAuth";

const supabase = createClient();

export interface AdminUserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

interface UseAdminUsersResult {
  users: AdminUserRow[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Ubah role user (bukan diri sendiri — ditolak RPC, lihat migration 016). */
  updateUserRole: (userId: string, newRole: UserRole) => Promise<void>;
  /** Aktifkan/nonaktifkan user (bukan diri sendiri — ditolak RPC). */
  setUserActive: (userId: string, isActive: boolean) => Promise<void>;
  /** Ubah nama & email kontak (bukan role/status) — update langsung, tanpa RPC. */
  updateUserContact: (
    userId: string,
    fields: { fullName: string; email: string },
  ) => Promise<void>;
  /**
   * Kirim email reset password lewat Supabase Auth. Melempar Error kalau
   * `email` user kosong (migration 017) — dicek di sini dulu supaya pesannya
   * jelas, bukan error generik dari Supabase.
   */
  sendPasswordReset: (user: AdminUserRow) => Promise<void>;
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
      .select("id, full_name, email, role, is_active, created_at")
      .order("created_at", { ascending: true });

    if (fetchError) {
      // Kemungkinan besar penyebabnya: user login bukan admin/supervisor
      // (RLS profiles_select_admin_supervisor menolak diam-diam, hasilnya
      // baris kosong, BUKAN error) — jadi kalau fetchError benar-benar
      // muncul di sini, itu masalah lain (jaringan, dsb.), bukan permission.
      setError(fetchError.message);
      setUsers([]);
    } else {
      setUsers((data ?? []) as AdminUserRow[]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const updateUserRole = useCallback(
    async (userId: string, newRole: UserRole) => {
      const { error: rpcError } = await supabase.rpc("admin_update_user_role", {
        p_user_id: userId,
        p_new_role: newRole,
      });

      if (rpcError) {
        throw new Error(rpcError.message || "Gagal mengubah role user.");
      }

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
          rpcError.message ||
            `Gagal ${isActive ? "mengaktifkan" : "menonaktifkan"} user.`,
        );
      }

      await fetchUsers();
    },
    [fetchUsers],
  );

  const updateUserContact = useCallback(
    async (userId: string, fields: { fullName: string; email: string }) => {
      const trimmedName = fields.fullName.trim();
      const trimmedEmail = fields.email.trim();

      if (!trimmedName) {
        throw new Error("Nama tidak boleh kosong.");
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: trimmedName,
          email: trimmedEmail || null,
        })
        .eq("id", userId);

      if (updateError) {
        throw new Error(updateError.message || "Gagal menyimpan data user.");
      }

      await fetchUsers();
    },
    [fetchUsers],
  );

  const sendPasswordReset = useCallback(async (user: AdminUserRow) => {
    if (!user.email) {
      throw new Error(
        `${user.full_name ?? "User ini"} belum punya email tersimpan — isi email dulu lewat "Edit" sebelum kirim reset password.`,
      );
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      user.email,
    );

    if (resetError) {
      throw new Error(resetError.message || "Gagal mengirim email reset password.");
    }
  }, []);

  return {
    users,
    isLoading,
    error,
    refetch: fetchUsers,
    updateUserRole,
    setUserActive,
    updateUserContact,
    sendPasswordReset,
  };
}