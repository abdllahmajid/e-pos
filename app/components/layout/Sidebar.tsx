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
  Boxes,
  TrendingUp,
  Trash2,
  ClipboardList,
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
    items: [
      // ── TAMBAHAN (T-05) ── Menu Stok & Opname. Ditaruh di grup "Alat Kasir"
      // mengikuti PRD §4.1 (di sana Produk & Stok memang satu grup dengan Kas).
      // "Produk" sendiri sengaja dibiarkan di grup Utama seperti sebelumnya —
      // memindahkannya bukan bagian task ini dan bisa membingungkan kasir yang
      // sudah hafal posisi menu.
      { key: "stok", label: "Stok & Opname", icon: Boxes },
      { key: "kas", label: "Kas & Shift", icon: Wallet },
    ],
  },
  {
    // ── TAMBAHAN (T-08) ── Grup terpisah dari "Alat Kasir" secara sengaja —
    // Laporan diasumsikan khusus admin/supervisor (lihat catatan ASUMSI di
    // LaporanModule.tsx & hooks/useReports.ts), beda konteks dari alat kerja
    // harian kasir. Penyembunyian menu ini dari kasir sendiri belum dikerjakan
    // di sini (itu scope T-10, permission matrix) — untuk sekarang menu tetap
    // tampil semua role, yang menahan akses cuma layar blokir di
    // LaporanModule.tsx (pola sama seperti menu "stok").
    label: "Laporan",
    items: [{ key: "laporan", label: "Laporan", icon: TrendingUp }],
  },
  {
    // ── TAMBAHAN (T-09) ── Grup "Lainnya" sesuai penamaan persis di PRD §4.1
    // & §298 (bukan "Administrasi"/dsb.). "Log Aktivitas" ditambahkan
    // menyusul setelah LogAktivitasModule.tsx jadi (lihat komentar header
    // file: jangan render menu ke modul kosong — sebelumnya cuma "Sampah").
    //
    // Kedua menu di grup ini admin+supervisor (bukan admin-only seperti PRD
    // §5 asli — keputusan sadar pemilik project, migration 015; lihat
    // komentar header migration itu). Menu tetap tampil ke semua role,
    // sama seperti pola grup "Laporan" — yang menahan akses justru layar
    // blokir di dalam masing-masing modul (SampahModule.tsx /
    // LogAktivitasModule.tsx sendiri).
    label: "Lainnya",
    items: [
      { key: "sampah", label: "Sampah", icon: Trash2 },
      { key: "log-aktivitas", label: "Log Aktivitas", icon: ClipboardList },
    ],
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
