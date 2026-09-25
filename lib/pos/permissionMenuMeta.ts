// lib/pos/permissionMenuMeta.ts
// ── TAMBAHAN (migration 031, redesain tab Pengaturan > Role) ── Metadata
// TAMPILAN (grup + ikon) untuk tiap permission_key, dipakai PengaturanRoleTab.tsx
// menyusun checklist permission jadi 2 level: pilih GRUP dulu (persis label
// & urutan grup di Sidebar.tsx — MENU_GROUPS), baru di dalamnya daftar MENU
// (card + ikon + tombol Lihat/Tambah/Ubah/Hapus).
//
// SENGAJA file terpisah, bukan derive otomatis dari `MENU_GROUPS` di
// Sidebar.tsx, walau kelihatannya duplikasi — karena tidak 1:1: sebagian
// menu sidebar (dashboard/kas) TIDAK punya permission_key sama sekali (dulu
// & tetap sekarang terbuka untuk semua role, di luar cakupan migration ini),
// menu "Pengaturan" di sidebar satu item tapi mewakili 3 permission_key
// (toko/admin/role) yang masing-masing perlu card sendiri di sini, dan
// 'retur_void' punya permission_key sendiri tapi TIDAK punya menu sidebar
// sendiri (nempel sebagai aksi di dalam layar Riwayat Transaksi). Mapping
// otomatis dari MENU_GROUPS tidak bisa menangani 3 pengecualian itu dengan
// bersih — daftar eksplisit di bawah ini lebih gampang dibaca & dirawat.
//
// Urutan properti PERMISSION_GROUPS di bawah = urutan grup & menu yang
// tampil di UI — dijaga SAMA PERSIS dengan urutan MENU_GROUPS di Sidebar.tsx
// supaya admin yang sudah hafal urutan menu sidebar langsung familiar saat
// mengatur permission role.

import {
  ShoppingCart,
  Package,
  Undo2,
  Boxes,
  Monitor,
  TrendingUp,
  Trash2,
  ClipboardList,
  Store,
  Users,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

export interface PermissionMenuMeta {
  /** Sama dengan `permissions.key` di database — dipakai join ke katalog & role_permissions. */
  key: string;
  icon: LucideIcon;
}

export interface PermissionGroupMeta {
  /** Sama persis dengan `SidebarMenuGroup.label` di Sidebar.tsx. */
  label: string;
  items: PermissionMenuMeta[];
}

export const PERMISSION_GROUPS: PermissionGroupMeta[] = [
  {
    label: "Utama",
    items: [
      { key: "kasir", icon: ShoppingCart },
      { key: "produk", icon: Package },
      // Tidak punya menu sidebar sendiri (nempel di layar Riwayat Transaksi)
      // — lihat catatan header. Ditaruh di grup "Utama" karena Riwayat
      // Transaksi ada di grup itu.
      { key: "retur_void", icon: Undo2 },
    ],
  },
  {
    label: "Alat Kasir",
    items: [
      { key: "stok", icon: Boxes },
      { key: "promo", icon: Monitor },
    ],
  },
  {
    label: "Laporan",
    items: [{ key: "laporan", icon: TrendingUp }],
  },
  {
    label: "Lainnya",
    items: [
      { key: "sampah", icon: Trash2 },
      { key: "log_aktivitas", icon: ClipboardList },
    ],
  },
  {
    label: "Administrasi",
    items: [
      { key: "pengaturan_toko", icon: Store },
      { key: "pengaturan_admin", icon: Users },
      { key: "pengaturan_role", icon: KeyRound },
    ],
  },
];

/** Lookup cepat key -> ikon, dipakai render card tanpa harus loop PERMISSION_GROUPS tiap kali. */
export const PERMISSION_ICON: Record<string, LucideIcon> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) =>
    group.items.map((item) => [item.key, item.icon]),
  ),
);