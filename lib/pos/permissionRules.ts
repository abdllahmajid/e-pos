// lib/pos/permissionRules.ts
//
// ── MIGRATION 038 ── Aturan siapa boleh memberi izin apa (murni, dipakai server
// /api/admin/* dan tampilan matriks hak akses). Cermin trigger database
// `enforce_profiles_role_change` + `perms_added_beyond` di migration 038.
//
//  • Super Admin: bebas.
//  • User lain yang boleh mengelola user (permission pengaturan_admin):
//      - TIDAK bisa mengubah role/izin/status AKUNNYA SENDIRI;
//      - TIDAK bisa MENAMBAH izin yang ia sendiri tidak punya (mengurangi boleh);
//      - TIDAK bisa memberi role Super Admin atau menyentuh akun Super Admin.

import { MODULE_DEFS } from "@/lib/pos/permissionModules";

type PermMap = Record<string, Record<string, boolean> | undefined>;

const asMap = (p: unknown): PermMap => (p && typeof p === "object" ? p : {}) as PermMap;

const ACTION_LABEL: Record<string, string> = {
  view: "Lihat",
  create: "Tambah",
  edit: "Ubah",
  delete: "Hapus",
  lintas_kasir: "Akses semua kasir",
};

export function permissionLabel(module: string, action: string): string {
  const mod = MODULE_DEFS.find((d) => d.key === module)?.label ?? module;
  return `${mod} · ${ACTION_LABEL[action] ?? action}`;
}

/** Apakah `permissions` memberi izin ini? (true murni) */
export function holdsPermission(permissions: unknown, module: string, action: string): boolean {
  return asMap(permissions)[module]?.[action] === true;
}

/** Dua set izin sama persis? (modul/aksi yang tidak ada dianggap false) */
export function permissionsEqual(a: unknown, b: unknown): boolean {
  const A = asMap(a);
  const B = asMap(b);
  const modules = new Set([...Object.keys(A), ...Object.keys(B)]);
  for (const m of modules) {
    const actions = new Set([...Object.keys(A[m] ?? {}), ...Object.keys(B[m] ?? {})]);
    for (const act of actions) {
      if ((A[m]?.[act] === true) !== (B[m]?.[act] === true)) return false;
    }
  }
  return true;
}

/**
 * Izin pertama yang DITAMBAHKAN (false → true) tetapi tidak dimiliki si pemberi.
 * Mengembalikan label izinnya, atau null bila tidak ada pelanggaran.
 * `current` = izin target saat ini (user baru: nilai default).
 */
export function findPermissionEscalation(next: unknown, current: unknown, caller: unknown): string | null {
  const N = asMap(next);
  for (const [module, actions] of Object.entries(N)) {
    for (const [action, value] of Object.entries(actions ?? {})) {
      if (value !== true) continue;
      if (holdsPermission(current, module, action)) continue; // tidak berubah
      if (!holdsPermission(caller, module, action)) return permissionLabel(module, action);
    }
  }
  return null;
}
