"use client";

import { useEffect, useState } from "react";
// ⚠️ GANTI path ini setelah kamu ketemu lokasi asli file Supabase client di project kamu.
import { createClient } from "@/lib/supabase/client";

// ── KOREKSI (bug: "selalu rendering" / risiko rate limit auth) ── Dipindah
// ke scope MODUL (dipanggil sekali saat file ini pertama kali diimpor),
// bukan di dalam badan `useAuth()` seperti sebelumnya (artinya dulu
// terpanggil ulang di SETIAP render tiap komponen yang pakai hook ini).
// Sekarang `createClient()` sendiri sudah singleton (lihat catatan di
// lib/supabase/client.ts), jadi baris ini aman dipindah — tidak lagi
// membuat instance GoTrueClient baru sama sekali, cuma mengambil referensi
// ke instance singleton yang sama dipakai semua hook lain di app ini.
const supabase = createClient();

// ── REVISI (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// Enum Postgres `user_role` (admin/supervisor/kasir/qc hardcode) SUDAH
// DIHAPUS TOTAL di database, diganti tabel `roles`/`permissions`/
// `role_permissions` — role sekarang bebas dibuat pemilik project lewat tab
// "Role" di Pengaturan (menyusul, belum ada UI-nya), bukan lagi 4 pilihan
// tetap. Konsekuensinya:
// - Tipe `UserRole` DIHAPUS (tidak ada lagi daftar nama role yang pasti/
//   diketahui saat compile time — role sekarang data, bukan tipe).
// - `AuthUser.role` (string tunggal) DIHAPUS, diganti `role_id`/`role_name`/
//   `role_level`/`lintas_kasir` + `permissions` (daftar permission_key yang
//   allowed=true untuk role user ini, sumbernya tabel role_permissions).
// - Semua pengecekan akses yang TADINYA `user?.role === "admin" ||
//   user?.role === "supervisor"` di 7 file modul (StokModule, ProdukModule,
//   PromoModule, LaporanModule, SampahModule, LogAktivitasModule,
//   TransactionDetailModal) HARUS diganti `hasPermission(user, "kunci_nya")`
//   — belum dikerjakan di langkah ini, menyusul langkah terpisah supaya
//   tetap satu file per langkah.
// ── TAMBAHAN (migration 031, "permission granular per aksi") ── Sebelumnya
// tiap baris role_permissions cuma punya 1 flag `allowed` (all-or-nothing per
// menu). Sekarang dipecah 4 aksi (lihat migration 031 & PengaturanRoleTab.tsx):
// Lihat/Tambah/Ubah/Hapus per menu. `PermissionActions` merepresentasikan
// baris itu di sisi client — `view` SELALU jadi prasyarat (kalau false, 3
// lainnya pasti false juga, ditegakkan constraint DB
// `role_permissions_view_required`, bukan cuma konvensi frontend).
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
  role_id: string;
  role_name: string;
  role_level: number;
  lintas_kasir: boolean;
  /**
   * ── PERTAHANKAN (migration 031) ── Daftar permission_key yang can_view=true
   * untuk role user ini — SAMA PERSIS artinya dengan `permissions` sebelum
   * migration 031 (dulu sumbernya `allowed=true`, sekarang `can_view=true`),
   * supaya semua caller lama `hasPermission(user, key)` (gate Sidebar, gate
   * modul per-halaman) tetap jalan tanpa perlu diubah satu per satu.
   */
  permissions: string[];
  /**
   * ── TAMBAHAN (migration 031) ── Detail 4 aksi per permission_key, dipakai
   * caller yang butuh granularitas lebih dari sekadar "boleh buka menu ini
   * atau tidak" (mis. tombol Tambah/Ubah/Hapus produk, opname stok, retur
   * vs void). Key yang TIDAK ADA di map ini berarti keempat aksinya false
   * (tidak ada baris role_permissions untuk kombinasi itu — lihat migration
   * 031, "tidak ada baris = ditolak semua aksi").
   */
  permissionActions: Record<string, PermissionActions>;
  is_active: boolean;
}

// ── TAMBAHAN ── Helper murni (bukan hook) supaya bisa dipanggil dari mana
// saja tanpa import tambahan — pola pemakaian: `hasPermission(user, "stok")`.
// Sengaja bukan method di dalam AuthUser (AuthUser cuma data hasil query,
// bukan class) dan bukan dikembalikan sebagai closure dari useAuth() (kalau
// closure, tiap komponen yang destructure `{ hasPermission }` dari hook lain
// harus ikut re-render tiap useAuth() re-render — fungsi murni begini lebih
// ringan, sama sekali tidak butuh hook context).
//
// ── PERTAHANKAN (migration 031) ── Tetap berarti "boleh Lihat menu ini",
// TIDAK berubah walau model permission di belakangnya sekarang granular —
// pemakai lama (Sidebar, gate top-level tiap modul) tidak perlu disentuh.
export function hasPermission(
  user: AuthUser | null,
  permissionKey: string
): boolean {
  return user?.permissions.includes(permissionKey) ?? false;
}

// ── TAMBAHAN (migration 031) ── Cek aksi granular spesifik (bukan cuma
// Lihat) — dipakai buat menampilkan/menyembunyikan tombol Tambah/Ubah/Hapus
// per menu sesuai checklist role (lihat PengaturanRoleTab.tsx). Fail-closed:
// key yang tidak dikenal / user null selalu balik false.
export function hasPermissionAction(
  user: AuthUser | null,
  permissionKey: string,
  action: keyof PermissionActions
): boolean {
  return user?.permissionActions[permissionKey]?.[action] ?? false;
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
    // ── REVISI (migration 028) ── Satu query nested (bukan lagi
    // `.select("full_name, role, is_active")` polos) buat sekalian tarik
    // nama/level/lintas_kasir role-nya DAN daftar permission_key yang
    // allowed=true — supaya AuthUser lengkap dalam satu round-trip, tidak
    // perlu query kedua di setiap komponen yang butuh cek permission.
    // `roles!inner` (bukan left join) aman karena profiles.role_id NOT NULL
    // dengan FK ke roles, tidak mungkin ada baris profiles tanpa role.
    // ── REVISI (migration 031) ── `role_permissions ( permission_key, allowed )`
    // jadi `role_permissions ( permission_key, can_view, can_create, can_edit,
    // can_delete )` — kolom `allowed` tunggal sudah di-drop dari skema.
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select(
        `full_name, is_active, role_id,
         roles!inner (
           name, level, lintas_kasir,
           role_permissions ( permission_key, can_view, can_create, can_edit, can_delete )
         )`
      )
      .eq("id", authUserId)
      .single();

    if (profileError || !data) {
      setError(
        "Login berhasil tapi profil tidak ditemukan — pastikan sudah insert baris di tabel profiles."
      );
      setUser(null);
      return;
    }

    // Supabase-js mengetik hasil join sebagai objek tunggal untuk relasi
    // many-to-one (`roles!inner`), tapi tipe generatednya kadang lebih aman
    // dianggap array — `Array.isArray` di sini jaga-jaga dua kemungkinan
    // bentuk itu tanpa perlu import Database types generated (belum ada di
    // project ini, lihat catatan lib/supabase/client.ts).
    const roleRow = Array.isArray(data.roles) ? data.roles[0] : data.roles;
    type RolePermissionRow = {
      permission_key: string;
      can_view: boolean;
      can_create: boolean;
      can_edit: boolean;
      can_delete: boolean;
    };
    const rpRows: RolePermissionRow[] = roleRow?.role_permissions ?? [];

    // Sama seperti sebelum migration 031: cuma baris can_view=true yang
    // berarti "boleh Lihat menu ini" — dipertahankan buat caller lama
    // `hasPermission(user, key)`.
    const permissions = rpRows
      .filter((rp) => rp.can_view)
      .map((rp) => rp.permission_key);

    // ── TAMBAHAN (migration 031) ── Map lengkap 4 aksi per permission_key,
    // dipakai `hasPermissionAction`. Key yang tidak ada baris-nya otomatis
    // tidak masuk map ini -> hasPermissionAction balik false (fail-closed),
    // konsisten dengan "tidak ada baris = ditolak semua aksi" di migration 031.
    const permissionActions: Record<string, PermissionActions> = {};
    for (const rp of rpRows) {
      permissionActions[rp.permission_key] = {
        view: rp.can_view,
        create: rp.can_create,
        edit: rp.can_edit,
        delete: rp.can_delete,
      };
    }

    setUser({
      id: authUserId,
      email,
      full_name: data.full_name,
      role_id: data.role_id,
      role_name: roleRow?.name ?? "",
      role_level: roleRow?.level ?? 99,
      lintas_kasir: roleRow?.lintas_kasir ?? false,
      permissions,
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
    // WAJIB sebelum signOut(), bukan sesudah — sesi masih perlu valid supaya
    // RPC clear_my_fcm_token tahu auth.uid(). Lihat hooks/useFcmToken.ts.
    try {
      await supabase.rpc("clear_my_fcm_token");
    } catch {
      // Jangan sampai gagal hapus token menghambat proses logout.
    }
    await supabase.auth.signOut();
    setUser(null);
  }

  return { user, isLoading, error, signIn, signOut };
}