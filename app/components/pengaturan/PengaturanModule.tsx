"use client";

// app/components/pengaturan/PengaturanModule.tsx
// ── TAMBAHAN ── Modul Pengaturan Admin (PRD §17 T-10, §4.1 "Pengaturan
// Admin", §5 baris `settings` = admin only). Dua sub-tab sesuai PRD §17 T-10:
// - "Toko & Struk"   — edit `settings` dari T-01 (PPN, footer, logo, ukuran
//                       kertas, format cetak default) lewat
//                       PengaturanTokoTab.tsx (hooks/useSettings.ts).
// - "Pengaturan Admin" — daftar user dari `profiles`, ubah role, aktifkan/
//                       nonaktifkan, reset password, lewat
//                       PengaturanAdminTab.tsx (hooks/useAdminUsers.ts,
//                       migration 016/017).
//
// Sub-tab dipisah jadi komponen sendiri (bukan ditulis inline di sini) supaya
// file ini tetap jadi "shell" tipis (gate akses + tab switcher), sama seperti
// pola LaporanModule.tsx yang memisah isi tiap sub-tab.
//
// Akses: admin ONLY — beda dari SampahModule.tsx/LogAktivitasModule.tsx yang
// dilonggarkan ke admin+supervisor (migration 015). Menu ini SENGAJA TIDAK
// ikut dilonggarkan, lihat komentar di Sidebar.tsx grup "Administrasi" —
// PRD §5 baris `settings` tidak pernah disentuh migration 015 sama sekali.
//
// Pola gate: sama persis dengan LogAktivitasModule.tsx (cabang isAuthLoading
// dulu, baru cabang !canAccess, keduanya SETELAH semua hook dipanggil sesuai
// Rules of Hooks) — supaya tidak mengulang bug "kedipan" yang sudah pernah
// diperbaiki di modul-modul itu.

import { useState } from "react";
import { Loader2, ShieldAlert, Store, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import PengaturanTokoTab from "./PengaturanTokoTab";
import PengaturanAdminTab from "./PengaturanAdminTab";

type PengaturanTab = "toko" | "admin";

const TABS: { key: PengaturanTab; label: string; icon: typeof Store }[] = [
  { key: "toko", label: "Toko & Struk", icon: Store },
  { key: "admin", label: "Pengaturan Admin", icon: Users },
];

export default function PengaturanModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  // Admin only — lihat catatan header di atas, sengaja TIDAK sama dengan
  // SampahModule.tsx/LogAktivitasModule.tsx.
  const canAccessSettings = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<PengaturanTab>("toko");

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
          Modul Pengaturan hanya untuk admin.
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
            Pengaturan toko/struk dan kelola user — PRD §17 T-10.
          </p>
        </div>

        {/* Tab switcher — pola sama dengan tab internal SampahModule.tsx
            (Produk/Transaksi) & LaporanModule.tsx, bukan komponen tab
            generik terpisah. */}
        <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map(({ key, label, icon: Icon }) => (
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

        {/* ── TAMBAHAN ── Render sub-tab sungguhan. Dirender kondisional
            dengan && (bukan CSS hidden), jadi tab yang tidak aktif memang
            UNMOUNT — state form di tiap tab otomatis reset tiap kali tab
            dibuka lagi. Ini pilihan sadar, konsisten dengan pola tab lain di
            project ini (mis. SampahModule.tsx Produk/Transaksi). */}
        {activeTab === "toko" && <PengaturanTokoTab />}
        {activeTab === "admin" && <PengaturanAdminTab />}
      </div>
    </section>
  );
}
