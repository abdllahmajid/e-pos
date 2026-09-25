"use client";

// ── TAMBAHAN (header/topbar) ── Topbar di atas konten utama, tampil di semua
// modul (Dashboard, Kasir, dst.) — sebelumnya modul langsung mulai dari
// konten begitu sidebar dibuka, tidak ada penanda "sedang di menu apa" di
// area konten itu sendiri. Berguna terutama di mobile: sidebar di sana jadi
// drawer tersembunyi (lihat Sidebar.tsx), jadi tanpa header ini kasir tidak
// punya cara melihat nama menu aktif tanpa buka drawer dulu.
//
// Sengaja "dumb" seperti Sidebar: cuma menerima `activeMenu` dari page.tsx,
// tidak simpan state sendiri. Judul + ikon diambil dari `MENU_GROUPS` yang
// di-export Sidebar.tsx (satu sumber kebenaran) — supaya kalau nanti ada
// menu baru ditambah di sana, Header ini otomatis ikut tanpa perlu disentuh.

import { Store } from "lucide-react";
import { MENU_GROUPS } from "./Sidebar";
import { useSettings } from "@/hooks/useSettings";

interface HeaderProps {
  activeMenu: string;
}

/** Cari label + ikon menu aktif beserta label grupnya (mis. "Alat Kasir"). */
function findMenuMeta(key: string) {
  for (const group of MENU_GROUPS) {
    const item = group.items.find((menuItem) => menuItem.key === key);
    if (item) return { groupLabel: group.label, item };
  }
  // Fallback aman: kalau `key` somehow tidak ada di MENU_GROUPS (mis. menu
  // baru ditambah di page.tsx tapi belum didaftarkan di Sidebar), header
  // tetap tampil (judul generik) daripada crash.
  return null;
}

export default function Header({ activeMenu }: HeaderProps) {
  // Nama toko dari Pengaturan > Toko (hooks/useSettings.ts) — pakai fallback
  // DEFAULT_SETTINGS bawaan hook selagi loading, jadi tidak pernah tampil
  // kosong/kedip di kanan header.
  const { settings } = useSettings();
  const meta = findMenuMeta(activeMenu);
  const Icon = meta?.item.icon;

  return (
    <header className="sticky top-0 z-10 flex h-17 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white pl-16 pr-4 dark:border-zinc-800 dark:bg-zinc-950 md:pl-6">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lco-green/10 text-lco-green dark:bg-lco-teal/15 dark:text-lco-teal">
            <Icon className="h-4.5 w-4.5" />
          </span>
        )}
        <div className="min-w-0">
          {meta && (
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              {meta.groupLabel}
            </p>
          )}
          <h2 className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100 md:text-base">
            {meta?.item.label ?? "LCO POS"}
          </h2>
        </div>
      </div>

      {/* ── Badge nama toko ── disembunyikan di layar paling sempit (identitas
          toko kasir sudah cukup jelas dari konteks tablet yang dipakai; di
          layar sempit ruang lebih berharga untuk judul menu di kiri). */}
      <div className="hidden shrink-0 items-center gap-1.5 rounded-full bg-lco-green/10 px-3 py-1.5 text-xs font-medium text-lco-green dark:bg-lco-teal/15 dark:text-lco-teal sm:flex">
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[180px] truncate">{settings.namaToko}</span>
      </div>
    </header>
  );
}
