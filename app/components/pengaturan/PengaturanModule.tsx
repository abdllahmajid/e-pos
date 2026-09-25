"use client";

// app/components/pengaturan/PengaturanModule.tsx
// ── TAMBAHAN ── Modul Pengaturan Admin (PRD §17 T-10, §4.1 "Pengaturan
// Admin", §5 baris `settings` = admin only). Tiga sub-tab:
// - "Toko & Struk"     — edit `settings` (PPN, footer, logo, ukuran kertas,
//                        format cetak default) lewat PengaturanTokoTab.tsx.
// - "Pengaturan Admin" — daftar user dari `profiles`, ubah role, aktifkan/
//                        nonaktifkan, reset password, lewat
//                        PengaturanAdminTab.tsx.
// - "Role"             — ── TAMBAHAN (migration 028) ── CRUD role dinamis +
//                        checklist permission per role, lewat
//                        PengaturanRoleTab.tsx.
//
// Sub-tab dipisah jadi komponen sendiri (bukan ditulis inline di sini) supaya
// file ini tetap jadi "shell" tipis (gate akses + tab switcher), sama seperti
// pola LaporanModule.tsx yang memisah isi tiap sub-tab.
//
// ── REVISI (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// Sebelumnya modul ini gate akses tunggal `user?.role === "admin" ||
// user?.role === "supervisor"` (migration 018) untuk SEMUA sub-tab sekaligus.
// Enum `user_role` & kolom `profiles.role` SUDAH DIHAPUS TOTAL — sekarang
// setiap sub-tab punya permission_key SENDIRI-SENDIRI
// (pengaturan_toko/pengaturan_admin/pengaturan_role, lihat katalog di
// migration 028) dan dicek lewat `hasPermission(user, key)`, BUKAN lagi satu
// gate besar. Konsekuensinya:
// - Tab switcher sekarang MENYARING tab mana saja yang MUNCUL sesuai
//   permission user login — bukan lagi daftar tetap 2 tab yang selalu sama
//   untuk admin & supervisor. Seorang user custom bisa saja cuma punya akses
//   "Pengaturan Admin" tanpa "Role", atau sebaliknya (lihat catatan header
//   migration 028 kenapa pengaturan_role sengaja dipisah dari
//   pengaturan_admin — aksi paling sensitif, tidak otomatis nempel di
//   permission kelola user).
// - `canAccessSettings` (gate utama, sebelum tab switcher dirender sama
//   sekali) sekarang berarti "minimal punya SATU dari 3 permission itu",
//   bukan lagi cek role tetap.
// - Tab aktif WAJIB selalu salah satu tab yang memang terlihat oleh user ini
//   (tidak boleh "nyangkut" di tab yang izin aksesnya baru saja hilang,
//   mis. gara-gara role-nya diubah admin lain sementara dia masih login) —
//   makanya ada useEffect kecil di bawah yang menyinkronkan ulang setiap
//   kali daftar tab yang terlihat berubah.
//
// Pola gate: cabang isAuthLoading dulu, baru cabang !canAccessSettings,
// KEDUANYA setelah semua hook (useState/useEffect) dipanggil sesuai Rules of
// Hooks — sama seperti sebelumnya, supaya tidak mengulang bug "kedipan" yang
// sudah pernah diperbaiki di modul-modul lain (LogAktivitasModule.tsx dkk).

import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldAlert, Store, Users } from "lucide-react";
import { hasPermission, useAuth } from "@/hooks/useAuth";
import PengaturanTokoTab from "./PengaturanTokoTab";
import PengaturanAdminTab from "./PengaturanAdminTab";
import PengaturanRoleTab from "./PengaturanRoleTab";

type PengaturanTab = "toko" | "admin" | "role";

// ── REVISI (migration 028) ── Tiap tab sekarang bawa permission_key
// sendiri (katalog `permissions`, migration 028) — dipakai `visibleTabs`
// di bawah buat menyaring, GANTI gate tunggal admin/supervisor lama.
const TABS: {
  key: PengaturanTab;
  label: string;
  icon: typeof Store;
  permission: string;
}[] = [
  {
    key: "toko",
    label: "Toko & Struk",
    icon: Store,
    permission: "pengaturan_toko",
  },
  {
    key: "admin",
    label: "Pengaturan Admin",
    icon: Users,
    permission: "pengaturan_admin",
  },
  // ── TAMBAHAN (migration 028) ──
  { key: "role", label: "Role", icon: KeyRound, permission: "pengaturan_role" },
];

export default function PengaturanModule() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<PengaturanTab | null>(null);

  // ── REVISI (migration 028) ── Dihitung tiap render (bukan disimpan di
  // state) — murni turunan dari `user.permissions`, tidak ada alasan
  // disimpan terpisah dan berisiko basi.
  const visibleTabs = TABS.filter((tab) => hasPermission(user, tab.permission));
  const canAccessSettings = visibleTabs.length > 0;

  // ── TAMBAHAN (migration 028) ── Jaga activeTab selalu salah satu tab yang
  // memang terlihat — inisialisasi ke tab pertama yang terlihat begitu user
  // termuat, dan pindah otomatis kalau tab yang lagi aktif hilang dari
  // daftar (mis. permission-nya baru saja dicabut). Dipanggil tanpa syarat
  // (hook tidak boleh di dalam if) — no-op lewat early return di badan
  // effect kalau belum ada tab yang terlihat sama sekali.
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    const stillVisible = visibleTabs.some((tab) => tab.key === activeTab);
    if (!stillVisible) {
      setActiveTab(visibleTabs[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat...
        </div>
      </div>
    );
  }

  if (!canAccessSettings) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Role Anda tidak punya akses ke satu pun menu Pengaturan. Hubungi admin
          kalau ini seharusnya tidak terjadi.
        </p>
      </div>
    );
  }

  return (
    <section className="h-full overflow-y-auto bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Pengaturan
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Pengaturan toko/struk, kelola user, dan kelola role — PRD §17 T-10,
            migration 028.
          </p>
        </div>

        {/* Tab switcher — cuma render tab yang memang terlihat untuk role
            user ini (lihat visibleTabs di atas), pola tombol sama seperti
            sebelumnya. */}
        <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                activeTab === key
                  ? "border-lco-teal text-lco-teal"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Render sub-tab sungguhan. Dirender kondisional dengan && (bukan
            CSS hidden), jadi tab yang tidak aktif memang UNMOUNT — state
            form di tiap tab otomatis reset tiap kali tab dibuka lagi.
            Konsisten dengan pola tab lain di project ini. */}
        {activeTab === "toko" && <PengaturanTokoTab />}
        {activeTab === "admin" && <PengaturanAdminTab />}
        {/* ── TAMBAHAN (migration 028) ── */}
        {activeTab === "role" && <PengaturanRoleTab />}
      </div>
    </section>
  );
}
