// hooks/useRoles.ts
// ── TAMBAHAN (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// Sub-tab "Role" di PengaturanModule.tsx. CRUD role + checklist permission
// per role, lewat hooks/useRoles.ts.
//
// ── REVISI (migration 031, "permission granular per aksi") ── Model
// permission per role sekarang 4 aksi (Lihat/Tambah/Ubah/Hapus) per menu,
// bukan lagi 1 flag `allowed` all-or-nothing. Konsekuensi di hook ini:
// - `Permission` (katalog) dapat 3 field baru `supportsCreate/supportsEdit/
//   supportsDelete` — metadata TETAP yang menentukan tombol CRUD mana yang
//   relevan ditampilkan buat menu itu di UI (mis. Laporan cuma render tombol
//   Lihat, Produk render keempatnya). Field ini SELALU read dari database
//   (kolom `permissions.supports_create/edit/delete`, migration 031) — bukan
//   hardcode di frontend — supaya kalau kapasitas suatu menu berubah lewat
//   migration baru nanti, UI otomatis ikut menyesuaikan tanpa deploy ulang.
// - `RoleRow.permission_keys` (dulu string[] hasil filter allowed=true)
//   diganti `RoleRow.permissionMatrix` — map permission_key -> 4 boolean
//   (PermissionActions dari hooks/useAuth.ts, dipakai ulang di sini supaya
//   satu sumber definisi tipe).
// - `RoleFields.permissionKeys` (string[]) diganti `RoleFields.permissionMatrix`
//   (Record<string, PermissionActions>) — cuma entry dengan `view: true` yang
//   ditulis ke database (entry dengan view:false dibuang sebelum submit,
//   sama seperti dulu cuma entry allowed:true yang ditulis).
// - createRole/updateRole tetap replace-total (hapus semua baris lama, tulis
//   ulang yang aktif) — TIDAK berubah dari migration 028, cuma kolom yang
//   ditulis sekarang 4 (can_view/can_create/can_edit/can_delete), bukan 1.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PermissionActions } from "@/hooks/useAuth";

const supabase = createClient();

// Urutan tampil di dalam grupnya masing-masing (lib/pos/permissionMenuMeta.ts
// yang menentukan urutan GRUP + urutan menu ANTAR grup; ini cadangan kalau
// katalog nambah key baru yang belum sempat dipetakan ke grup manapun —
// tetap muncul di akhir daripada hilang dari UI, sama seperti perilaku lama).
const PERMISSION_ORDER = [
  "kasir",
  "produk",
  "retur_void",
  "stok",
  "promo",
  "laporan",
  "sampah",
  "log_aktivitas",
  "pengaturan_toko",
  "pengaturan_admin",
  "pengaturan_role",
];

export const EMPTY_ACTIONS: PermissionActions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
};

export interface Permission {
  key: string;
  label: string;
  description: string | null;
  /** Metadata TETAP (bukan per-role) — kapasitas CRUD menu ini, migration 031. */
  supportsCreate: boolean;
  supportsEdit: boolean;
  supportsDelete: boolean;
}

export interface RoleRow {
  id: string;
  name: string;
  level: number;
  lintas_kasir: boolean;
  is_system: boolean;
  /**
   * ── REVISI (migration 031) ── permission_key -> 4 aksi granular untuk role
   * ini. Key yang tidak ada di map berarti keempat aksinya false (tidak ada
   * baris role_permissions untuk kombinasi itu).
   */
  permissionMatrix: Record<string, PermissionActions>;
}

interface RoleFields {
  name: string;
  /** 0 = paling tinggi. Lihat komentar kolom roles.level di migration 028. */
  level: number;
  /** Boleh lihat/kelola shift & held-order kasir LAIN, bukan cuma milik sendiri. */
  lintasKasir: boolean;
  /** Cuma entry dengan `view: true` yang ditulis ke database saat submit. */
  permissionMatrix: Record<string, PermissionActions>;
}

interface UseRolesResult {
  roles: RoleRow[];
  /** Katalog tetap (read-only, lihat catatan header) — dipakai render checklist. */
  permissions: Permission[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createRole: (fields: RoleFields) => Promise<void>;
  /** Role bawaan sistem (is_system) TETAP bisa lewat sini — cuma tidak bisa dihapus, lihat deleteRole. */
  updateRole: (id: string, fields: RoleFields) => Promise<void>;
  /** Ditolak trigger database (pesan diteruskan apa adanya) untuk role bawaan sistem, role yang masih dipakai user, atau satu-satunya role level 0. */
  deleteRole: (id: string) => Promise<void>;
}

export function useRoles(): UseRolesResult {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [rolesRes, permsRes] = await Promise.all([
      supabase
        .from("roles")
        .select(
          "id, name, level, lintas_kasir, is_system, role_permissions ( permission_key, can_view, can_create, can_edit, can_delete )",
        )
        .order("level", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("permissions")
        .select("key, label, description, supports_create, supports_edit, supports_delete"),
    ]);

    if (rolesRes.error) {
      setError(rolesRes.error.message);
      setRoles([]);
    } else {
      const rows: RoleRow[] = (rolesRes.data ?? []).map((row) => {
        // Bentuk hasil join one-to-many bisa berupa array langsung (biasanya
        // memang begitu untuk relasi ini, beda dari join many-to-one di
        // useAuth.ts/useAdminUsers.ts) — dijaga tetap array untuk aman.
        const rpRows = Array.isArray(row.role_permissions)
          ? row.role_permissions
          : row.role_permissions
            ? [row.role_permissions]
            : [];
        const permissionMatrix: Record<string, PermissionActions> = {};
        for (const rp of rpRows) {
          permissionMatrix[rp.permission_key] = {
            view: rp.can_view,
            create: rp.can_create,
            edit: rp.can_edit,
            delete: rp.can_delete,
          };
        }
        return {
          id: row.id,
          name: row.name,
          level: row.level,
          lintas_kasir: row.lintas_kasir,
          is_system: row.is_system,
          permissionMatrix,
        };
      });
      setRoles(rows);
    }

    if (permsRes.error) {
      // Katalog permission gagal kebaca -> checklist tidak bisa dirender
      // sama sekali, ini masalah nyata (bukan cuma "role kosong"), jadi ikut
      // dilaporkan lewat `error` yang sama supaya UI menampilkan pesannya.
      setError((prev) => prev ?? permsRes.error.message);
      setPermissions([]);
    } else {
      const sorted = [...(permsRes.data ?? [])].sort((a, b) => {
        const ia = PERMISSION_ORDER.indexOf(a.key);
        const ib = PERMISSION_ORDER.indexOf(b.key);
        return (ia === -1 ? PERMISSION_ORDER.length : ia) -
          (ib === -1 ? PERMISSION_ORDER.length : ib);
      });
      setPermissions(
        sorted.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
          supportsCreate: p.supports_create,
          supportsEdit: p.supports_edit,
          supportsDelete: p.supports_delete,
        })),
      );
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function validateFields(fields: RoleFields): string {
    const trimmedName = fields.name.trim();
    if (!trimmedName) {
      return "Nama role tidak boleh kosong.";
    }
    if (!Number.isInteger(fields.level) || fields.level < 0) {
      return "Level harus angka bulat 0 atau lebih (0 = paling tinggi/paling berwenang).";
    }
    return "";
  }

  /**
   * Cuma entry dengan `view: true` yang berarti apa-apa (lihat catatan model
   * di header file & migration 031: constraint `role_permissions_view_required`
   * di database menolak baris can_create/edit/delete true tanpa can_view
   * true) — entry lain dibuang di sini sebelum ditulis, supaya tidak nyisa
   * baris "kosong" (keempatnya false) yang tidak ada gunanya disimpan.
   */
  function toInsertRows(roleId: string, matrix: Record<string, PermissionActions>) {
    return Object.entries(matrix)
      .filter(([, actions]) => actions.view)
      .map(([key, actions]) => ({
        role_id: roleId,
        permission_key: key,
        can_view: true,
        can_create: actions.create,
        can_edit: actions.edit,
        can_delete: actions.delete,
      }));
  }

  const createRole = useCallback(
    async (fields: RoleFields) => {
      try {
        const validationError = validateFields(fields);
        if (validationError) {
          throw new Error(validationError);
        }

        const { data: newRole, error: insertError } = await supabase
          .from("roles")
          .insert({
            name: fields.name.trim(),
            level: fields.level,
            lintas_kasir: fields.lintasKasir,
          })
          .select("id")
          .single();

        if (insertError || !newRole) {
          // Kode 23505 = unique_violation (pola sama dengan hooks/useShifts.ts)
          // — constraint `roles_name_key` (migration 028). Pesan Postgres
          // mentahnya tidak ramah ("duplicate key value violates unique
          // constraint..."), jadi diganti pesan yang jelas.
          if (insertError?.code === "23505") {
            throw new Error(`Nama role "${fields.name.trim()}" sudah dipakai.`);
          }
          throw new Error(insertError?.message || "Gagal membuat role.");
        }

        const rows = toInsertRows(newRole.id, fields.permissionMatrix);
        if (rows.length > 0) {
          const { error: permError } = await supabase
            .from("role_permissions")
            .insert(rows);

          if (permError) {
            // Rollback — lihat catatan header, supaya tidak nyisa role
            // "kosong" tanpa permission apa pun cuma gara-gara separuh gagal.
            await supabase.from("roles").delete().eq("id", newRole.id);
            throw new Error(
              permError.message || "Gagal menyimpan daftar akses role.",
            );
          }
        }
      } finally {
        await fetchAll();
      }
    },
    [fetchAll],
  );

  const updateRole = useCallback(
    async (id: string, fields: RoleFields) => {
      try {
        const validationError = validateFields(fields);
        if (validationError) {
          throw new Error(validationError);
        }

        const { error: updateError } = await supabase
          .from("roles")
          .update({
            name: fields.name.trim(),
            level: fields.level,
            lintas_kasir: fields.lintasKasir,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (updateError) {
          if (updateError.code === "23505") {
            throw new Error(`Nama role "${fields.name.trim()}" sudah dipakai.`);
          }
          throw new Error(updateError.message || "Gagal menyimpan perubahan role.");
        }

        // Replace total (bukan diff) — lihat catatan model permission di
        // header file ini.
        const { error: clearError } = await supabase
          .from("role_permissions")
          .delete()
          .eq("role_id", id);

        if (clearError) {
          throw new Error(
            clearError.message || "Gagal memperbarui daftar akses role.",
          );
        }

        const rows = toInsertRows(id, fields.permissionMatrix);
        if (rows.length > 0) {
          const { error: permError } = await supabase
            .from("role_permissions")
            .insert(rows);

          if (permError) {
            throw new Error(
              permError.message || "Gagal menyimpan daftar akses role.",
            );
          }
        }
      } finally {
        await fetchAll();
      }
    },
    [fetchAll],
  );

  const deleteRole = useCallback(
    async (id: string) => {
      try {
        const { error: deleteError } = await supabase
          .from("roles")
          .delete()
          .eq("id", id);

        if (deleteError) {
          // Pesan dari trigger protect_role_mutation (migration 028)
          // diteruskan apa adanya — sudah jelas buat pengguna ("Role bawaan
          // sistem tidak bisa dihapus.", "Role ini masih dipakai user...",
          // dst), tidak perlu dibungkus ulang.
          throw new Error(deleteError.message || "Gagal menghapus role.");
        }
      } finally {
        await fetchAll();
      }
    },
    [fetchAll],
  );

  return {
    roles,
    permissions,
    isLoading,
    error,
    refetch: fetchAll,
    createRole,
    updateRole,
    deleteRole,
  };
}