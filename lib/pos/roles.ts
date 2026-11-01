// lib/pos/roles.ts
//
// ── MIGRATION 038 (izin per user, konsep sama dengan aplikasi Monitoring Konveksi) ──
// Role BUKAN lagi penentu hak akses. Hak akses disimpan langsung di tiap user
// (kolom `profiles.permissions`, lihat lib/pos/permissionModules.ts). Role
// hanya LABEL jabatan, dengan satu pengecualian: `super_admin`, yang selalu
// punya semua akses dan satu-satunya yang boleh mengurus akun Super Admin.
//
// Satu user boleh punya beberapa role sekaligus (kolom `profiles.roles`, text[]).
// Daftar role TETAP (bukan tabel `roles` dinamis seperti migration 028).

export const ROLE_OPTIONS = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "supervisor", label: "Supervisor" },
  { value: "kasir", label: "Kasir" },
  { value: "qc", label: "QC" },
] as const;

export type RoleValue = (typeof ROLE_OPTIONS)[number]["value"];

export const ROLE_VALUES: string[] = ROLE_OPTIONS.map((o) => o.value);

/** Role bawaan untuk user baru. */
export const DEFAULT_ROLES: RoleValue[] = ["kasir"];

export function roleLabel(role: string): string {
  return ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
}

/** Buang role tak dikenal & duplikat; urutan mengikuti ROLE_OPTIONS. */
export function normalizeRoles(raw: unknown): RoleValue[] {
  const input = Array.isArray(raw) ? raw.map(String) : [];
  return ROLE_OPTIONS.map((o) => o.value).filter((v) => input.includes(v));
}

type RoleHolder = { roles?: string[] | null } | null | undefined;

export function getUserRoles(user: RoleHolder): string[] {
  return user?.roles && user.roles.length > 0 ? user.roles : [];
}

export function hasRole(user: RoleHolder, role: string): boolean {
  return getUserRoles(user).includes(role);
}

export function isSuperAdmin(user: RoleHolder): boolean {
  return hasRole(user, "super_admin");
}
