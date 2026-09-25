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
// - ── TAMBAHAN ── Buat user baru -> BEDA dari semua di atas: bukan RPC
//   Postgres (`supabase.rpc(...)`) dan bukan `.update()` langsung, tapi
//   `fetch()` ke API route server `app/api/admin/create-user/route.ts`. Ini
//   satu-satunya cara insert baris baru ke `auth.users` — butuh Supabase
//   Admin API + service role key, yang TIDAK BOLEH dipanggil dari client
//   (lihat komentar header route.ts). Hook ini cuma mengirim request &
//   melempar Error dari respons JSON-nya — validasi permission/role
//   sepenuhnya di server, bukan di sini.
//
// Pola sama dengan hooks/useTrash.ts: query ringan (field seperlunya),
// mutasi melempar Error yang ditangani UI (bukan RPC yang ditelan diam-diam).
//
// ── REVISI (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// `role: UserRole` (enum tetap) DIHAPUS dari AdminUserRow, diganti
// `role_id`/`role_name`/`role_level` (join ke tabel `roles` baru — role
// sekarang data yang dibuat bebas lewat tab "Role", bukan 4 pilihan tetap).
// `updateUserRole` & `createUser` sekarang menerima `roleId` (uuid), bukan
// lagi string `'admin'|'supervisor'|'kasir'|'qc'`. RPC
// `admin_update_user_role`/`admin_set_user_active` di database SUDAH
// divalidasi ulang dari sisi permission (`pengaturan_admin`) & hierarki
// (`level`) di migration 028 — hook ini TIDAK menduplikasi validasi itu di
// client, cuma meneruskan & melempar pesan error dari RPC (sama seperti
// sebelumnya).

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export interface AdminUserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role_id: string;
  role_name: string;
  role_level: number;
  is_active: boolean;
  created_at: string;
}

interface UseAdminUsersResult {
  users: AdminUserRow[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Ubah role user (bukan diri sendiri — ditolak RPC, lihat migration 016/028). */
  updateUserRole: (userId: string, newRoleId: string) => Promise<void>;
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
  /**
   * Buat user baru — kirim email undangan (user set password sendiri lewat
   * link, tidak ada password sementara yang perlu disampaikan admin secara
   * manual). Panggil API route server, BUKAN RPC/`.update()` langsung — lihat
   * catatan header di atas. Melempar Error dari pesan yang dikirim server
   * (mis. "Supervisor tidak bisa membuat user dengan role Admin").
   */
  createUser: (fields: {
    fullName: string;
    email: string;
    roleId: string;
  }) => Promise<void>;
}

export function useAdminUsers(): UseAdminUsersResult {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // ── REVISI (migration 028) ── `role` polos -> join `roles!inner(name,
    // level)`, pola sama seperti hooks/useAuth.ts. `!inner` aman karena
    // profiles.role_id NOT NULL + FK ke roles.
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, is_active, created_at, role_id, roles!inner ( name, level )",
      )
      .order("created_at", { ascending: true });

    if (fetchError) {
      // Kemungkinan besar penyebabnya: user login tidak punya permission
      // 'pengaturan_admin' (RLS profiles_select_pengaturan_admin menolak
      // diam-diam, hasilnya baris kosong, BUKAN error) — jadi kalau
      // fetchError benar-benar muncul di sini, itu masalah lain (jaringan,
      // dsb.), bukan permission.
      setError(fetchError.message);
      setUsers([]);
    } else {
      const rows: AdminUserRow[] = (data ?? []).map((row) => {
        // Sama seperti useAuth.ts: bentuk hasil join relasi many-to-one bisa
        // typed sebagai objek tunggal atau array tergantung versi tipe
        // supabase-js — jaga dua-duanya tanpa perlu generated Database types.
        const roleRow = Array.isArray(row.roles) ? row.roles[0] : row.roles;
        return {
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          is_active: row.is_active,
          created_at: row.created_at,
          role_id: row.role_id,
          role_name: roleRow?.name ?? "",
          role_level: roleRow?.level ?? 99,
        };
      });
      setUsers(rows);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const updateUserRole = useCallback(
    async (userId: string, newRoleId: string) => {
      // ── REVISI (migration 028) ── p_new_role (enum) -> p_new_role_id
      // (uuid). Validasi hierarki (level) & permission sepenuhnya di RPC.
      const { error: rpcError } = await supabase.rpc("admin_update_user_role", {
        p_user_id: userId,
        p_new_role_id: newRoleId,
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

    // ── TAMBAHAN ── Sama seperti inviteUserByEmail di create-user/route.ts:
    // tanpa redirectTo eksplisit ke /auth/callback, link reset password
    // mendarat langsung di root app dan ditolak middleware.ts sebelum sempat
    // jadi sesi (lihat app/auth/callback/route.ts). Ini bug lama yang baru
    // ketahuan sekarang, bukan cuma penyesuaian untuk fitur Tambah User.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      user.email,
      { redirectTo: `${window.location.origin}/auth/callback?next=/set-password` },
    );

    if (resetError) {
      throw new Error(resetError.message || "Gagal mengirim email reset password.");
    }
  }, []);

  const createUser = useCallback(
    async (fields: { fullName: string; email: string; roleId: string }) => {
      const trimmedName = fields.fullName.trim();
      const trimmedEmail = fields.email.trim();

      if (!trimmedName) {
        throw new Error("Nama tidak boleh kosong.");
      }
      if (!trimmedEmail || !trimmedEmail.includes("@")) {
        throw new Error("Email tidak valid.");
      }
      if (!fields.roleId) {
        throw new Error("Role wajib dipilih.");
      }

      let response: Response;
      try {
        // ── REVISI (migration 028) ── body `role` (string enum) -> `roleId`
        // (uuid) — lihat app/api/admin/create-user/route.ts (menyusul
        // langkah terpisah) untuk validasi server-side yang baru.
        response = await fetch("/api/admin/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: trimmedName,
            email: trimmedEmail,
            roleId: fields.roleId,
          }),
        });
      } catch {
        throw new Error(
          "Gagal menghubungi server — periksa koneksi internet Anda.",
        );
      }

      let payload: { error?: string } = {};
      try {
        payload = await response.json();
      } catch {
        // Respons bukan JSON (mis. error 500 HTML dari Next.js) — biarkan
        // payload kosong, pesan generik di bawah yang dipakai.
      }

      if (!response.ok) {
        throw new Error(payload.error || "Gagal membuat user baru.");
      }

      await fetchUsers();
    },
    [fetchUsers],
  );

  return {
    users,
    isLoading,
    error,
    refetch: fetchUsers,
    updateUserRole,
    setUserActive,
    updateUserContact,
    sendPasswordReset,
    createUser,
  };
}