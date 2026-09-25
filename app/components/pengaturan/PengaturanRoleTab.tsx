"use client";

// app/components/pengaturan/PengaturanRoleTab.tsx
// ── TAMBAHAN (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// Sub-tab BARU "Role" di PengaturanModule.tsx (sejajar "Toko & Struk" dan
// "Pengaturan Admin" — revisi PengaturanModule.tsx menambahkan tab ini
// menyusul di langkah terpisah). CRUD role + checklist permission per role,
// lewat hooks/useRoles.ts.
//
// Beda pola dari PengaturanAdminTab.tsx: modal Tambah & Edit di sini
// DISATUKAN jadi satu form (bukan 2 modal terpisah seperti "Tambah User" vs
// "Edit User" di tab Admin) — field-nya PERSIS SAMA (nama, level, lintas
// kasir, checklist permission), tidak ada field tambahan yang cuma relevan
// buat salah satu mode seperti kasus create-user (undangan email). Disatukan
// supaya tidak ada 2 blok JSX checklist permission yang isinya identik.
//
// Role bawaan sistem (is_system = Admin/Supervisor/Kasir/QC hasil migrasi
// data lama) TETAP bisa diedit nama/level/permission-nya dari sini (lihat
// catatan header migration 028 & useRoles.ts) — cuma tombol Hapus yang
// dikunci untuk role ini, ditandai badge "Bawaan" + title tooltip di tombol,
// pola sama dengan disabled+title di PengaturanAdminTab.tsx (UI cuma
// mencerminkan pengaman trigger `protect_role_mutation`, bukan sumber
// kebenarannya — itu tetap di database, jadi tombol Hapus untuk role custom
// pun tetap bisa ditolak server kalau ternyata masih dipakai user).
//
// Akses tab ini sendiri (permission 'pengaturan_role') TIDAK digate di sini
// — itu tanggung jawab PengaturanModule.tsx (tab switcher-nya, menyusul)
// yang menentukan tab mana saja yang muncul sesuai permission user login,
// sama seperti pola PengaturanAdminTab.tsx/PengaturanTokoTab.tsx sekarang
// tidak self-gate. RLS `roles_write_pengaturan_role` di database tetap jadi
// pengaman sesungguhnya kalau ada yang mengakali UI.

import { useState } from "react";
import {
  AlertCircle,
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRoles, type RoleRow } from "@/hooks/useRoles";

interface RoleFormState {
  mode: "create" | "edit";
  roleId: string | null;
  name: string;
  level: string; // input text mentah, diparse ke integer saat submit
  lintasKasir: boolean;
  permissionKeys: string[];
}

export default function PengaturanRoleTab() {
  const {
    roles,
    permissions,
    isLoading,
    error,
    createRole,
    updateRole,
    deleteRole,
  } = useRoles();

  const [form, setForm] = useState<RoleFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function openCreate() {
    setFormError(null);
    setForm({
      mode: "create",
      roleId: null,
      name: "",
      // Default paling aman: level tinggi (angka besar = wewenang rendah),
      // konsisten dengan semangat "kasir" jadi default aman di modal Tambah
      // User (PengaturanAdminTab.tsx) — admin harus SADAR menurunkan angka
      // kalau memang mau bikin role berwenang tinggi, bukan ke-set tanpa
      // sengaja.
      level: "10",
      lintasKasir: false,
      permissionKeys: [],
    });
  }

  function openEdit(role: RoleRow) {
    setFormError(null);
    setForm({
      mode: "edit",
      roleId: role.id,
      name: role.name,
      level: String(role.level),
      lintasKasir: role.lintas_kasir,
      permissionKeys: [...role.permission_keys],
    });
  }

  function togglePermission(key: string) {
    if (!form) return;
    setForm({
      ...form,
      permissionKeys: form.permissionKeys.includes(key)
        ? form.permissionKeys.filter((k) => k !== key)
        : [...form.permissionKeys, key],
    });
  }

  async function handleSubmit() {
    if (!form) return;
    setIsSubmitting(true);
    setFormError(null);

    const parsedLevel = Number.parseInt(form.level, 10);
    const fields = {
      name: form.name,
      // NaN -> -1 (sengaja dibuat invalid): biar validasi di useRoles.ts
      // yang menolak dengan pesan "Level harus angka bulat 0 atau lebih",
      // bukan lolos sebagai NaN ke Supabase dan gagal dengan error generik.
      level: Number.isNaN(parsedLevel) ? -1 : parsedLevel,
      lintasKasir: form.lintasKasir,
      permissionKeys: form.permissionKeys,
    };

    try {
      if (form.mode === "create") {
        await createRole(fields);
      } else if (form.roleId) {
        await updateRole(form.roleId, fields);
      }
      setForm(null);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Gagal menyimpan role.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await deleteRole(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal menghapus role.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat daftar role...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Gagal memuat data role: {error}
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {actionError}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover"
        >
          <Plus className="h-4 w-4" />
          Tambah Role
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Nama Role</th>
              <th className="px-4 py-3 font-medium">Level</th>
              <th className="px-4 py-3 font-medium">Lintas Kasir</th>
              <th className="px-4 py-3 font-medium">Akses Menu</th>
              <th className="px-4 py-3 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {roles.map((role) => (
              <tr key={role.id}>
                <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200">
                  {role.name}
                  {role.is_system && (
                    <span
                      title="Role bawaan sistem — tidak bisa dihapus, tapi nama/level/aksesnya tetap bisa diubah"
                      className="ml-2 inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      <Lock className="h-2.5 w-2.5" />
                      Bawaan
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  {role.level}
                </td>
                <td className="px-4 py-3">
                  {role.lintas_kasir ? (
                    <span className="inline-flex items-center gap-1 text-lco-teal">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Ya
                    </span>
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-600">
                      Tidak
                    </span>
                  )}
                </td>
                <td
                  className="px-4 py-3 text-zinc-500 dark:text-zinc-400"
                  title={
                    permissions
                      .filter((p) => role.permission_keys.includes(p.key))
                      .map((p) => p.label)
                      .join(", ") || "Tidak ada akses menu"
                  }
                >
                  {role.permission_keys.length} dari {permissions.length} menu
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      title="Edit role"
                      onClick={() => openEdit(role)}
                      className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title={
                        role.is_system
                          ? "Role bawaan sistem tidak bisa dihapus"
                          : "Hapus role"
                      }
                      onClick={() => setDeleteTarget(role)}
                      disabled={role.is_system}
                      className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-lco-coral/10 hover:text-lco-coral disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {roles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                  Belum ada role, atau Anda tidak punya izin melihat daftar ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modal: Tambah/Edit Role (satu form untuk dua mode, lihat catatan header) ── */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-3 text-sm font-semibold">
              {form.mode === "create"
                ? "Tambah Role"
                : `Edit Role — ${form.name}`}
            </h3>

            {formError && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}

            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Nama Role
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={isSubmitting}
              placeholder="mis. Kasir Cabang, Staff Gudang"
              className="mb-3 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
            />

            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Level
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
              disabled={isSubmitting}
              className="mb-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
            />
            <p className="mb-3 text-xs text-zinc-400">
              0 = paling berwenang. Role hanya bisa mengelola user & memberi
              role dengan level sama atau lebih rendah dari level dirinya
              sendiri.
            </p>

            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={form.lintasKasir}
                onChange={(e) =>
                  setForm({ ...form, lintasKasir: e.target.checked })
                }
                disabled={isSubmitting}
                className="h-4 w-4 rounded border-zinc-300 text-lco-teal focus:ring-lco-teal dark:border-zinc-700"
              />
              Lintas kasir (boleh lihat &amp; tutup shift / held-order kasir
              lain)
            </label>

            <p className="mb-2 mt-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Akses Menu
            </p>
            <div className="mb-3 space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              {permissions.map((permission) => (
                <label
                  key={permission.key}
                  className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  <input
                    type="checkbox"
                    checked={form.permissionKeys.includes(permission.key)}
                    onChange={() => togglePermission(permission.key)}
                    disabled={isSubmitting}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-lco-teal focus:ring-lco-teal dark:border-zinc-700"
                  />
                  <span>
                    <span className="font-medium">{permission.label}</span>
                    {permission.description && (
                      <span className="block text-xs text-zinc-400">
                        {permission.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}

              {permissions.length === 0 && (
                <p className="text-xs text-zinc-400">
                  Katalog menu belum termuat, atau Anda tidak punya izin
                  melihatnya.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForm(null)}
                disabled={isSubmitting}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-md bg-lco-teal px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: konfirmasi hapus role ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lco-coral/10 text-lco-coral">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Hapus role?</h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Role{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {deleteTarget.name}
                  </span>{" "}
                  akan dihapus permanen. Ditolak otomatis kalau masih ada user
                  yang memakai role ini — pindahkan usernya ke role lain dulu.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isSubmitting}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-md bg-lco-coral px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-coral/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
