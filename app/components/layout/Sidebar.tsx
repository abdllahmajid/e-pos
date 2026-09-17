"use client";

// ── KOREKSI ── Sebelumnya sidebar menyatu langsung di app/page.tsx. Dipisah ke sini
// supaya konsisten dengan pola app lain di ekosistem Langitan.co (mis.
// monitoring-produksi) yang selalu punya komponen Sidebar sendiri — page.tsx cukup
// jadi "shell" yang menyimpan state menu aktif & merender modul yang dipilih.
//
// Komponen ini sengaja "dumb" (controlled dari luar): tidak punya state sendiri,
// cuma menerima `activeMenu` + `onMenuChange`. Kalau nanti mau ditambah menu baru
// (Stok & Opname, Laporan, dst. sesuai PRD §4.1), cukup tambah entri di MENU_GROUPS
// di bawah — tidak perlu sentuh page.tsx sama sekali.

import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Package,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface SidebarMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface SidebarMenuGroup {
  label: string;
  items: SidebarMenuItem[];
}

// Struktur grup mengikuti PRD §4.1 (UTAMA / ALAT KASIR / ...). Menu yang belum
// dibangun (Stok Menipis, Laporan, Nota/Struk mandiri, dst.) belum dimasukkan ke
// sini — tambahkan begitu modulnya sudah ada, jangan render menu ke modul kosong.
const MENU_GROUPS: SidebarMenuGroup[] = [
  {
    label: "Utama",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "kasir", label: "Kasir (POS)", icon: ShoppingCart },
      { key: "produk", label: "Produk", icon: Package },
      { key: "riwayat", label: "Riwayat Transaksi", icon: ReceiptText },
    ],
  },
  {
    label: "Alat Kasir",
    items: [{ key: "kas", label: "Kas & Shift", icon: Wallet }],
  },
];

interface SidebarProps {
  activeMenu: string;
  onMenuChange: (menu: string) => void;
}

export default function Sidebar({ activeMenu, onMenuChange }: SidebarProps) {
  return (
    <aside className="hidden w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 md:flex md:flex-col">
      <div className="border-b border-zinc-200 p-5 dark:border-zinc-800">
        <h1 className="rounded-xl text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          LCO POS
        </h1>
      </div>

      {MENU_GROUPS.map((group) => (
        <div key={group.label} className="p-3 pt-3 first:pt-3">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            {group.label}
          </p>

          <nav className="flex flex-col gap-1">
            {group.items.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => onMenuChange(key)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  activeMenu === key
                    ? "bg-zinc-100 text-lco-teal dark:bg-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      ))}
    </aside>
  );
}
