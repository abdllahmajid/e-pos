// lib/pos/permissionModules.ts
//
// ── MIGRATION 038 ── Definisi modul untuk layar Hak Akses per user + operasi
// murni (tanpa React) untuk menambah / mencabut / mengubah izin. Diadaptasi
// dari aplikasi Monitoring Konveksi (lib/permissionModules.ts) dan menggantikan
// `permissionMenuMeta.ts` + checklist per role yang lama.
//
// Konsep tampilan: sebuah modul "punya akses" bila ada izin yang aktif di
// dalamnya. Baris modul hanya tampil bila punya akses. "Tambah Akses Modul"
// menyalakan `view` plus izin awal yang dipilih; ikon sampah mencabut semua
// izin modul itu.
//
// Bentuk data di database (`profiles.permissions`, jsonb):
//   { "produk": { "view": true, "create": true, "edit": false, "delete": false },
//     "kasir":  { "view": true, "lintas_kasir": false }, ... }
// Modul/aksi yang tidak tertulis dianggap false (fail-closed). `view` WAJIB
// true supaya aksi lain berlaku — sama dengan has_permission_action di database.
//
// Tambah modul baru: satu objek di MODULE_DEFS di bawah + (kalau perlu)
// menu di Sidebar.tsx + gate `has_permission_action` di migration SQL-nya.

import {
  Boxes,
  ClipboardList,
  KeyRound,
  Monitor,
  Package,
  ShoppingCart,
  Store,
  Trash2,
  TrendingUp,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Aksi dasar per modul. `view` tidak punya kolom: ia berarti "modul ada di daftar". */
export type PermColumn = "create" | "edit" | "delete";
export const PERM_COLUMNS: PermColumn[] = ["create", "edit", "delete"];

export interface ModulePerm {
  view: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  /** Khusus modul Kasir: boleh lihat/kelola shift & held-order kasir LAIN. */
  lintas_kasir?: boolean;
}

export interface ModuleDef {
  /** Sama dengan kunci di `profiles.permissions` dan argumen has_permission_action(). */
  key: string;
  label: string;
  /** Grup — sama dengan urutan grup di Sidebar.tsx (hanya untuk pengelompokan tampilan). */
  group: string;
  icon: LucideIcon;
  /** Kolom aksi yang tersedia untuk modul ini; isinya = keterangan (tooltip). */
  columns: Partial<Record<PermColumn, string>>;
  /** Izin tambahan di luar kolom (mis. lintas_kasir di Kasir). */
  extras?: { field: "lintas_kasir"; label: string; hint: string }[];
}

export const MODULE_DEFS: ModuleDef[] = [
  {
    key: "kasir",
    label: "Kasir",
    group: "Utama",
    icon: ShoppingCart,
    columns: {},
    extras: [
      {
        field: "lintas_kasir",
        label: "Akses semua kasir",
        hint: "Melihat dan mengelola shift & pesanan tertahan milik kasir LAIN (tutup paksa shift), bukan hanya milik sendiri.",
      },
    ],
  },
  {
    key: "produk",
    label: "Kelola Produk",
    group: "Utama",
    icon: Package,
    columns: {
      create: "Tambah produk & kategori",
      edit: "Ubah produk & kategori",
      delete: "Hapus produk (pindah ke Sampah)",
    },
  },
  {
    key: "pelanggan",
    label: "Pelanggan",
    group: "Utama",
    icon: Users,
    columns: {
      create: "Tambah pelanggan",
      edit: "Ubah pelanggan & poin",
      delete: "Hapus pelanggan",
    },
  },
  {
    key: "retur_void",
    label: "Retur & Void",
    group: "Utama",
    icon: Undo2,
    columns: {
      create: "Retur transaksi",
      delete: "Void (batalkan) transaksi",
    },
  },
  {
    key: "stok",
    label: "Kelola Stok",
    group: "Alat Kasir",
    icon: Boxes,
    columns: { edit: "Opname & penyesuaian stok manual" },
  },
  {
    key: "promo",
    label: "Layar Promosi TV",
    group: "Alat Kasir",
    icon: Monitor,
    columns: {
      create: "Tambah media & layar TV",
      edit: "Ubah media & layar TV",
      delete: "Hapus media & layar TV",
    },
  },
  { key: "laporan", label: "Laporan", group: "Laporan", icon: TrendingUp, columns: {} },
  {
    key: "sampah",
    label: "Sampah",
    group: "Lainnya",
    icon: Trash2,
    columns: { edit: "Pulihkan produk/transaksi" },
  },
  { key: "log_aktivitas", label: "Log Aktivitas", group: "Lainnya", icon: ClipboardList, columns: {} },
  {
    key: "pengaturan_toko",
    label: "Pengaturan Toko",
    group: "Administrasi",
    icon: Store,
    columns: { edit: "Ubah pengaturan toko & struk" },
  },
  {
    key: "pengaturan_admin",
    label: "Kelola User",
    group: "Administrasi",
    icon: KeyRound,
    columns: {
      create: "Tambah user baru",
      edit: "Ubah role & hak akses, aktif/nonaktifkan user",
    },
  },
];

export type PermKey = string;
export type UserPermissions = Record<string, ModulePerm>;

export const MODULE_KEYS: string[] = MODULE_DEFS.map((d) => d.key);

export const defOf = (key: PermKey): ModuleDef | undefined => MODULE_DEFS.find((d) => d.key === key);

const fieldsOf = (d: ModuleDef): string[] => [
  "view",
  ...PERM_COLUMNS.filter((c) => d.columns[c] !== undefined),
  ...(d.extras?.map((x) => x.field) ?? []),
];

/** Izin bawaan user baru: hanya modul Kasir (sama seperti role Kasir/QC lama). */
export const DEFAULT_PERMISSIONS: UserPermissions = Object.fromEntries(
  MODULE_DEFS.map((d) => [
    d.key,
    Object.fromEntries(fieldsOf(d).map((f) => [f, d.key === "kasir" && f === "view"])),
  ]),
) as UserPermissions;

/**
 * Samakan data mentah dari database dengan definisi modul saat ini: modul/aksi
 * yang belum tertulis jadi false, kunci asing dibuang. User lama otomatis
 * mendapat nilai default modul baru.
 */
export function resolvePermissions(raw?: unknown): UserPermissions {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const out: UserPermissions = {};
  for (const d of MODULE_DEFS) {
    const base = { ...(DEFAULT_PERMISSIONS[d.key] as unknown as Record<string, boolean>) };
    const got = src[d.key] ?? {};
    for (const f of Object.keys(base)) {
      if (typeof got[f] === "boolean") base[f] = got[f] as boolean;
    }
    out[d.key] = base as unknown as ModulePerm;
  }
  return out;
}

/**
 * Versi untuk DISIMPAN: hanya modul & aksi yang dikenal, dan `view` otomatis
 * menyala bila ada aksi lain yang aktif (database menolak aksi tanpa view).
 */
export function sanitizePermissions(raw: unknown): UserPermissions {
  const resolved = resolvePermissions(raw);
  for (const d of MODULE_DEFS) {
    const m = resolved[d.key] as unknown as Record<string, boolean>;
    const anyOn = Object.entries(m).some(([f, v]) => f !== "view" && v === true);
    if (anyOn) m.view = true;
  }
  return resolved;
}

/** Callback pembatas (non-Super Admin tidak boleh memberi izin yang ia sendiri tidak punya). */
export type CanGrant = (key: PermKey, field: string) => boolean;

const modOf = (p: UserPermissions, key: PermKey) => (p[key] ?? {}) as unknown as Record<string, boolean>;

export function getField(p: UserPermissions, key: PermKey, field: string): boolean {
  return modOf(p, key)[field] === true;
}

/** Modul punya akses bila ada satu saja izin yang aktif. */
export function moduleHasAccess(p: UserPermissions, key: PermKey): boolean {
  return Object.values(modOf(p, key)).some((v) => v === true);
}

export function grantedModules(p: UserPermissions): ModuleDef[] {
  return MODULE_DEFS.filter((d) => moduleHasAccess(p, d.key));
}

function withField(p: UserPermissions, key: PermKey, field: string, value: boolean): UserPermissions {
  return { ...p, [key]: { ...modOf(p, key), [field]: value } } as unknown as UserPermissions;
}

/**
 * Ubah satu izin. Menyalakan izin apa pun juga menyalakan `view` modulnya
 * (bila boleh), sehingga baris tidak hilang dan menu bisa dibuka.
 */
export function setField(
  p: UserPermissions,
  key: PermKey,
  field: string,
  value: boolean,
  canGrant?: CanGrant,
): UserPermissions {
  let next = withField(p, key, field, value);
  if (value && field !== "view" && !getField(next, key, "view") && (!canGrant || canGrant(key, "view"))) {
    next = withField(next, key, "view", true);
  }
  return next;
}

/** Cabut semua izin satu modul (kembali ke semua false). */
export function revokeModule(p: UserPermissions, key: PermKey): UserPermissions {
  const base = DEFAULT_PERMISSIONS[key] as unknown as Record<string, boolean> | undefined;
  const off: Record<string, boolean> = {};
  for (const f of Object.keys(base ?? {})) off[f] = false;
  return { ...p, [key]: off } as unknown as UserPermissions;
}

/** Izin awal yang dipilih di modal "Tambah Akses Modul". */
export interface InitialGrant {
  create: boolean;
  edit: boolean;
  delete: boolean;
}

/**
 * Tambah akses beberapa modul sekaligus. Tiap modul: `view` menyala, ditambah
 * izin awal yang memang ada di kolom modul itu. Izin yang tidak boleh diberikan
 * `canGrant` dilewati; modul yang `view`-nya tidak boleh diberikan dilewati.
 */
export function grantModules(
  p: UserPermissions,
  keys: PermKey[],
  initial: InitialGrant,
  canGrant?: CanGrant,
): UserPermissions {
  let next = p;
  const ok = (k: PermKey, f: string) => !canGrant || canGrant(k, f);
  for (const key of keys) {
    const def = defOf(key);
    if (!def || !ok(key, "view")) continue;
    next = withField(next, key, "view", true);
    for (const col of PERM_COLUMNS) {
      if (def.columns[col] === undefined) continue;
      if (initial[col] && ok(key, col)) next = withField(next, key, col, true);
    }
  }
  return next;
}

/** Ringkasan singkat untuk daftar user (nama modul yang punya akses). */
export function summarizeAccess(p: UserPermissions): { label: string }[] {
  return grantedModules(p).map((d) => ({ label: d.label }));
}
