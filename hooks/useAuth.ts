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
export interface AuthUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string;
  role_name: string;
  role_level: number;
  lintas_kasir: boolean;
  permissions: string[];
  is_active: boolean;
}

// ── TAMBAHAN ── Helper murni (bukan hook) supaya bisa dipanggil dari mana
// saja tanpa import tambahan — pola pemakaian: `hasPermission(user, "stok")`.
// Sengaja bukan method di dalam AuthUser (AuthUser cuma data hasil query,
// bukan class) dan bukan dikembalikan sebagai closure dari useAuth() (kalau
// closure, tiap komponen yang destructure `{ hasPermission }` dari hook lain
// harus ikut re-render tiap useAuth() re-render — fungsi murni begini lebih
// ringan, sama sekali tidak butuh hook context).
export function hasPermission(
  user: AuthUser | null,
  permissionKey: string
): boolean {
  return user?.permissions.includes(permissionKey) ?? false;
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
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select(
        `full_name, is_active, role_id,
         roles!inner (
           name, level, lintas_kasir,
           role_permissions ( permission_key, allowed )
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
    const permissions = (roleRow?.role_permissions ?? [])
      .filter((rp: { permission_key: string; allowed: boolean }) => rp.allowed)
      .map((rp: { permission_key: string; allowed: boolean }) => rp.permission_key);

    setUser({
      id: authUserId,
      email,
      full_name: data.full_name,
      role_id: data.role_id,
      role_name: roleRow?.name ?? "",
      role_level: roleRow?.level ?? 99,
      lintas_kasir: roleRow?.lintas_kasir ?? false,
      permissions,
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