// hooks/useRoles.ts
// ── TAMBAHAN (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// Hook domain tab BARU "Role" di Pengaturan (sejajar "Toko & Struk" dan
// "Pengaturan Admin" — menyusul revisi PengaturanModule.tsx/PengaturanAdminTab.tsx
// di langkah terpisah). Tanggung jawab: daftar role + checklist permission
// per role (CRUD role), dan katalog permission tetap (cuma dibaca, TIDAK
// bisa ditambah/diubah dari sini — lihat catatan di bawah).
//
// Pembagian tanggung jawab dengan database:
// - Validasi SIAPA boleh CRUD role sepenuhnya di RLS (`roles_write_pengaturan_role`
//   / `role_permissions_write_pengaturan_role`, migration 028) — permission
//   'pengaturan_role'. Hook ini TIDAK menduplikasi cek itu di client; kalau
//   user tidak berwenang, Supabase balikin error RLS dan hook melempar Error
//   apa adanya (pola sama seperti useAdminUsers.ts).
// - Pengaman STRUKTURAL (role bawaan sistem tidak bisa dihapus, role yang
//   masih dipakai user tidak bisa dihapus, tidak boleh sampai 0 role level=0)
//   ada di trigger `protect_role_mutation` (migration 028) — pesan errornya
//   RAISE EXCEPTION dari Postgres, diteruskan apa adanya lewat `error.message`
//   supaya UI tidak perlu menerka alasan penolakan.
// - Katalog `permissions` (10 menu tetap) SENGAJA read-only dari UI manapun
//   (tidak ada fungsi insert/update/delete permission di hook ini) — nambah
//   menu baru wajib migration baru, sesuai keputusan desain di migration 028.
//   RLS tabel ini sempat bug (SELECT ikut ke-deny total, bukan cuma
//   insert/update/delete) — sudah diperbaiki migration 029.
//
// Model permission per role (migration 028): baris `role_permissions` cuma
// ada untuk kombinasi role+menu yang DIIZINKAN (allowed selalu true di semua
// baris yang kita tulis dari sini) — tidak ada baris = otomatis ditolak.
// Jadi `updateRole` SELALU replace total (hapus semua baris lama milik role
// itu, tulis ulang cuma yang tercentang) daripada hitung diff tambah/kurang —
// lebih simpel dan tidak mungkin nyisa baris usang.
//
// createRole/updateRole/deleteRole masing-masing MULTI-LANGKAH (insert/update
// tabel roles, lalu insert/delete tabel role_permissions terpisah — Postgres
// REST API Supabase tidak menyediakan transaksi multi-tabel dari client).
// Kalau langkah kedua gagal setelah langkah pertama sukses, hook mencoba
// rollback (khusus createRole: hapus lagi role yang baru dibuat, pola sama
// dengan app/api/admin/create-user/route.ts) SUPAYA tidak nyisa role
// "kosong" nyasar tanpa permission apa pun cuma gara-gara separuh gagal.
// Ketiga fungsi SELALU refetch di `finally` (bukan cuma saat sukses seperti
// hook lain) — supaya kalau ternyata gagal di tengah, list yang ditampilkan
// tetap mencerminkan kondisi database yang sesungguhnya, bukan state lama
// yang sudah tidak akurat.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

// Urutan tampil checklist di UI — mengikuti urutan menu di app (sama seperti
// pemetaan permission_key di komentar header migration 028), BUKAN urutan
// insert ke database (Postgres tidak menjamin itu tanpa ORDER BY eksplisit).
// Kunci yang tidak ada di daftar ini (permission baru dari migration
// mendatang) tetap muncul, ditaruh di akhir supaya tidak hilang dari UI.
const PERMISSION_ORDER = [
  "kasir",
  "produk",
  "stok",
  "laporan",
  "promo",
  "log_aktivitas",
  "sampah",
  "pengaturan_toko",
  "pengaturan_admin",
  "pengaturan_role",
];

export interface Permission {
  key: string;
  label: string;
  description: string | null;
}

export interface RoleRow {
  id: string;
  name: string;
  level: number;
  lintas_kasir: boolean;
  is_system: boolean;
  /** permission_key yang allowed=true untuk role ini (lihat catatan model di atas). */
  permission_keys: string[];
}

interface RoleFields {
  name: string;
  /** 0 = paling tinggi. Lihat komentar kolom roles.level di migration 028. */
  level: number;
  /** Boleh lihat/kelola shift & held-order kasir LAIN, bukan cuma milik sendiri. */
  lintasKasir: boolean;
  permissionKeys: string[];
}

interface UseRolesResult {
  roles: RoleRow[];
  /** Katalog tetap 10 menu (read-only, lihat catatan header) — dipakai render checklist. */
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
          "id, name, level, lintas_kasir, is_system, role_permissions ( permission_key, allowed )",
        )
        .order("level", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("permissions").select("key, label, description"),
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
        return {
          id: row.id,
          name: row.name,
          level: row.level,
          lintas_kasir: row.lintas_kasir,
          is_system: row.is_system,
          permission_keys: rpRows
            .filter((rp) => rp.allowed)
            .map((rp) => rp.permission_key),
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
      setPermissions(sorted);
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

        if (fields.permissionKeys.length > 0) {
          const { error: permError } = await supabase
            .from("role_permissions")
            .insert(
              fields.permissionKeys.map((key) => ({
                role_id: newRole.id,
                permission_key: key,
                allowed: true,
              })),
            );

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

        if (fields.permissionKeys.length > 0) {
          const { error: permError } = await supabase
            .from("role_permissions")
            .insert(
              fields.permissionKeys.map((key) => ({
                role_id: id,
                permission_key: key,
                allowed: true,
              })),
            );

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