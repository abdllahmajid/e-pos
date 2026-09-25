"use client";

// app/components/pengaturan/PengaturanRoleTab.tsx
// ── TAMBAHAN (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// Sub-tab "Role" di PengaturanModule.tsx. CRUD role + checklist permission
// per role, lewat hooks/useRoles.ts.
//
// ── REVISI BESAR (migration 031, "permission granular per aksi") ──
// Sebelumnya checklist permission cuma daftar rata 10 menu, tiap menu 1
// checkbox (allowed/tidak). Sekarang diganti total sesuai permintaan pemilik
// project: bagian "Izin Akses" di modal Tambah/Edit Role jadi navigasi 2
// tingkat, MENGIKUTI PENGELOMPOKAN SIDEBAR (lib/pos/permissionMenuMeta.ts,
// yang labelnya sengaja sama persis dengan Sidebar.tsx MENU_GROUPS):
//   1. Tingkat GRUP — card per grup (mis. "Utama", "Alat Kasir", ...),
//      masing-masing menampilkan ringkasan "X dari Y menu diberi akses".
//   2. Tingkat MENU — klik satu grup, masuk ke daftar card menu di grup itu
//      (ikon + nama + deskripsi menu), TIAP CARD tombolnya Lihat/Tambah/
//      Ubah/Hapus TAPI CUMA YANG RELEVAN yang dirender — ditentukan field
//      `supportsCreate/supportsEdit/supportsDelete` dari katalog permission
//      (hooks/useRoles.ts, sumbernya kolom `permissions.supports_*` di
//      database, migration 031) — BUKAN hardcode di sini, supaya konsisten
//      kalau kapasitas suatu menu berubah lewat migration baru nanti.
//
// Aturan toggle (cermin dari constraint database
// `role_permissions_view_required`, migration 031): mematikan "Lihat" ikut
// mematikan Tambah/Ubah/Hapus menu itu (tidak masuk akal bisa mengubah/
// menghapus dari menu yang tidak bisa dibuka), dan menyalakan salah satu
// dari Tambah/Ubah/Hapus otomatis menyalakan "Lihat" juga.
//
// Pola dasar (modal Tambah/Edit disatukan jadi satu form, role bawaan sistem
// tidak bisa dihapus tapi tetap bisa diedit) TIDAK berubah dari versi
// sebelumnya — cuma bagian checklist permission yang direstrukturisasi
// total. Lihat komentar lengkap soal itu di riwayat git file ini / migration
// 028 kalau perlu konteks lebih jauh.
//
// Akses tab ini sendiri (permission 'pengaturan_role') TIDAK digate di sini
// — itu tanggung jawab PengaturanModule.tsx (tab switcher-nya) yang
// menentukan tab mana saja yang muncul sesuai permission user login.

import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  useRoles,
  EMPTY_ACTIONS,
  type RoleRow,
  type Permission,
} from "@/hooks/useRoles";
import type { PermissionActions } from "@/hooks/useAuth";
import {
  PERMISSION_GROUPS,
  PERMISSION_ICON,
} from "@/lib/pos/permissionMenuMeta";

interface RoleFormState {
  mode: "create" | "edit";
  roleId: string | null;
  name: string;
  level: string; // input text mentah, diparse ke integer saat submit
  lintasKasir: boolean;
  permissionMatrix: Record<string, PermissionActions>;
}

// Navigasi 2 tingkat di dalam bagian "Izin Akses" — lihat catatan header.
type PermissionView =
  | { mode: "groups" }
  | { mode: "menus"; groupLabel: string };

// Label tombol CRUD generik (fixed, sesuai permintaan pemilik project) —
// urutan render juga dari sini: Lihat SELALU pertama & selalu ditampilkan,
// 3 lainnya kondisional per `supports*`.
const ACTION_BUTTONS: {
  action: keyof PermissionActions;
  label: string;
  supportsKey?: keyof Pick<
    Permission,
    "supportsCreate" | "supportsEdit" | "supportsDelete"
  >;
}[] = [
  { action: "view", label: "Lihat" },
  { action: "create", label: "Tambah", supportsKey: "supportsCreate" },
  { action: "edit", label: "Ubah", supportsKey: "supportsEdit" },
  { action: "delete", label: "Hapus", supportsKey: "supportsDelete" },
];

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
  const [permissionView, setPermissionView] = useState<PermissionView>({
    mode: "groups",
  });
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  // Grup + menu yang benar-benar dirender: filter PERMISSION_GROUPS ke key
  // yang memang ada di katalog (jaga-jaga kalau katalog & metadata sempat
  // tidak sinkron), lalu tambahkan grup "Lainnya" di akhir untuk key katalog
  // yang belum sempat dipetakan ke grup manapun di permissionMenuMeta.ts —
  // supaya permission baru dari migration mendatang tetap kelihatan &
  // bisa diatur walau UI belum diupdate mengelompokkannya.
  const mappedKeys = new Set(
    PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)),
  );
  const renderedGroups = [
    ...PERMISSION_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.filter((item) => permissionByKey.has(item.key)),
    })).filter((group) => group.items.length > 0),
    ...(permissions.some((p) => !mappedKeys.has(p.key))
      ? [
          {
            label: "Lainnya",
            items: permissions
              .filter((p) => !mappedKeys.has(p.key))
              .map((p) => ({ key: p.key, icon: Layers })),
          },
        ]
      : []),
  ];

  function openCreate() {
    setFormError(null);
    setPermissionView({ mode: "groups" });
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
      permissionMatrix: {},
    });
  }

  function openEdit(role: RoleRow) {
    setFormError(null);
    setPermissionView({ mode: "groups" });
    setForm({
      mode: "edit",
      roleId: role.id,
      name: role.name,
      level: String(role.level),
      lintasKasir: role.lintas_kasir,
      permissionMatrix: { ...role.permissionMatrix },
    });
  }

  function getActions(key: string): PermissionActions {
    return form?.permissionMatrix[key] ?? EMPTY_ACTIONS;
  }

  // Toggle satu aksi untuk satu menu — lihat catatan header soal aturan
  // "Lihat" jadi prasyarat (cermin constraint database).
  function toggleAction(key: string, action: keyof PermissionActions) {
    if (!form) return;
    const current = getActions(key);
    const nextValue = !current[action];

    let next: PermissionActions;
    if (action === "view" && !nextValue) {
      // Matikan Lihat -> matikan semua aksi lain sekalian.
      next = { view: false, create: false, edit: false, delete: false };
    } else if (action !== "view" && nextValue) {
      // Nyalakan Tambah/Ubah/Hapus -> pastikan Lihat ikut menyala.
      next = { ...current, view: true, [action]: true };
    } else {
      next = { ...current, [action]: nextValue };
    }

    setForm({
      ...form,
      permissionMatrix: { ...form.permissionMatrix, [key]: next },
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
      permissionMatrix: form.permissionMatrix,
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

  // Total menu (dari katalog) dipakai buat ringkasan kolom "Akses Menu" di
  // tabel & ringkasan card grup di modal.
  const totalMenuCount = permissions.length;

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
            {roles.map((role) => {
              const viewableKeys = Object.entries(role.permissionMatrix)
                .filter(([, actions]) => actions.view)
                .map(([key]) => key);
              return (
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
                        .filter((p) => viewableKeys.includes(p.key))
                        .map((p) => p.label)
                        .join(", ") || "Tidak ada akses menu"
                    }
                  >
                    {viewableKeys.length} dari {totalMenuCount} menu
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
              );
            })}

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
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
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
              Izin Akses
            </p>

            {/* ── Tingkat 1: daftar GRUP (sesuai pengelompokan Sidebar) ── */}
            {permissionView.mode === "groups" && (
              <div className="mb-3 space-y-2">
                {renderedGroups.map((group) => {
                  const viewableInGroup = group.items.filter(
                    (item) => getActions(item.key).view,
                  ).length;
                  return (
                    <button
                      key={group.label}
                      type="button"
                      onClick={() =>
                        setPermissionView({
                          mode: "menus",
                          groupLabel: group.label,
                        })
                      }
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2.5 text-left transition-colors duration-150 hover:border-lco-teal/50 hover:bg-lco-teal/5 dark:border-zinc-800 dark:hover:bg-lco-teal/10"
                    >
                      <span>
                        <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {group.label}
                        </span>
                        <span className="block text-xs text-zinc-400">
                          {viewableInGroup} dari {group.items.length} menu
                          diberi akses
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                    </button>
                  );
                })}

                {renderedGroups.length === 0 && (
                  <p className="rounded-md border border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800">
                    Katalog menu belum termuat, atau Anda tidak punya izin
                    melihatnya.
                  </p>
                )}
              </div>
            )}

            {/* ── Tingkat 2: daftar MENU dalam satu grup, tombol CRUD per menu ── */}
            {permissionView.mode === "menus" && (
              <div className="mb-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setPermissionView({ mode: "groups" })}
                  className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-lco-teal hover:underline"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Kembali ke kelompok
                </button>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {permissionView.groupLabel}
                </p>

                {renderedGroups
                  .find((g) => g.label === permissionView.groupLabel)
                  ?.items.map((item) => {
                    const permission = permissionByKey.get(item.key);
                    if (!permission) return null;
                    const actions = getActions(item.key);
                    const Icon =
                      item.icon ?? PERMISSION_ICON[item.key] ?? Layers;

                    return (
                      <div
                        key={item.key}
                        className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
                      >
                        <div className="mb-2.5 flex items-start gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {permission.label}
                            </p>
                            {permission.description && (
                              <p className="text-xs text-zinc-400">
                                {permission.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {ACTION_BUTTONS.filter(
                            (btn) =>
                              btn.action === "view" ||
                              (btn.supportsKey && permission[btn.supportsKey]),
                          ).map((btn) => {
                            const active = actions[btn.action];
                            return (
                              <button
                                key={btn.action}
                                type="button"
                                disabled={isSubmitting}
                                onClick={() =>
                                  toggleAction(item.key, btn.action)
                                }
                                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                                  active
                                    ? "border-lco-green bg-lco-green/10 text-lco-green dark:border-lco-teal dark:bg-lco-teal/10 dark:text-lco-teal"
                                    : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                                }`}
                              >
                                {active ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <span className="h-3 w-3 rounded-sm border border-current" />
                                )}
                                {btn.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

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
