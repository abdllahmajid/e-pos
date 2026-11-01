"use client";

// app/components/pengaturan/PengaturanAdminTab.tsx
// ── REVISI TOTAL (migration 038, "izin per user") ── Sub-tab "Pengguna" di
// PengaturanModule.tsx. Konsepnya SAMA dengan aplikasi Monitoring Konveksi
// (settings/tabs/UsersTab.tsx) dan menggantikan DUA tab lama sekaligus:
// "Pengaturan Admin" (tabel user + dropdown role) dan "Role" (CRUD role dinamis
// + checklist izin per role).
//
// Dua layar:
//   1. Daftar user (cari, halaman) -> ikon kunci "Atur Akses".
//   2. Detail user: Informasi Pengguna (kiri) + Hak Akses Modul (kanan, toggle
//      per modul & aksi). "Tambah Akses Modul" membuka modal. Perubahan hak
//      akses ditampung dulu (draft) dan baru tersimpan setelah klik "Simpan".
//
// Aturan (sama dengan Konveksi; ditegakkan di server /api/admin/* dan trigger
// database `enforce_profiles_role_change`, UI ini hanya mencerminkannya lebih awal):
//   - Role cuma LABEL (boleh lebih dari satu). Hanya Super Admin yang punya
//     arti khusus: selalu punya semua akses, tidak bisa diubah izinnya.
//   - Super Admin: bebas. User lain: tidak bisa mengubah role/izin akunnya
//     sendiri, hanya bisa MENAMBAH izin yang ia sendiri punya (toggle redup
//     bila tidak punya), dan tidak bisa menyentuh akun Super Admin.
//   - Hierarki `level` (migration 028) sudah dihapus.
//
// Tambah User SAMA dengan Konveksi: admin mengisi nama, email, PASSWORD, dan
// role langsung — tidak ada email undangan. Password user diganti admin lewat
// "Ubah Profil" (kosongkan bila tidak diubah); email login tidak bisa diubah.
// Aktifkan/nonaktifkan dipertahankan: user tidak pernah dihapus permanen
// (transaksi merujuk ke profilnya) — dinonaktifkan.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Layers,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserRound,
  UserX,
  X,
} from "lucide-react";
import { hasPermissionAction, useAuth } from "@/hooks/useAuth";
import { useAdminUsers, type AdminUserRow } from "@/hooks/useAdminUsers";
import { ROLE_OPTIONS, DEFAULT_ROLES, roleLabel } from "@/lib/pos/roles";
import {
  DEFAULT_PERMISSIONS,
  MODULE_DEFS,
  grantModules,
  moduleHasAccess,
  summarizeAccess,
  type CanGrant,
  type InitialGrant,
  type PermKey,
  type UserPermissions,
} from "@/lib/pos/permissionModules";
import { holdsPermission, permissionsEqual } from "@/lib/pos/permissionRules";
import { AddModuleModal, PermissionMatrix } from "./PermissionMatrix";

const cardCls = "overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
const thCls =
  "px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800";
const inputCls =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors duration-150 placeholder-zinc-400 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder-zinc-500";
const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-lco-green px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-60";
const ghostBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900";
const iconBtn =
  "rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

const PER_PAGE = 10;

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(isoString));
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
      <ShieldCheck className="h-3 w-3" />
      {roleLabel(role)}
    </span>
  );
}

function Initials({ name }: { name: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-sm font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
      {(name.trim().charAt(0) || "?").toUpperCase()}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

// ─── Modal konfirmasi sederhana ──────────────────────────────────────────────

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h3 className="mb-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={ghostBtn}>
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
              danger ? "bg-lco-coral hover:bg-lco-coral/90" : "bg-lco-green hover:bg-lco-green-hover"
            }`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal profil: tambah user / ubah profil ─────────────────────────────────

interface ProfileForm {
  name: string;
  email: string;
  password: string;
  roles: string[];
}

function ProfileModal({
  mode,
  form,
  setForm,
  saving,
  error,
  rolesLocked,
  canGrantSuperAdmin,
  onClose,
  onSubmit,
}: {
  mode: "new" | "edit";
  form: ProfileForm;
  setForm: (f: ProfileForm) => void;
  saving: boolean;
  error: string | null;
  /** Role tidak boleh diubah (akun sendiri / akun Super Admin bagi non-Super Admin). */
  rolesLocked: boolean;
  canGrantSuperAdmin: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const isNew = mode === "new";
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Tambah user" : "Ubah profil"}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 pt-5 pb-4 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {isNew ? "Tambah User" : "Ubah Profil"}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {isNew
                ? "Hak akses modul diatur setelah user dibuat."
                : "Data akun pengguna. Hak akses diubah di panel Hak Akses Modul."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Tutup"
            className="p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {error && <ErrorBanner message={error} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Nama Lengkap</label>
              <input
                className={inputCls}
                value={form.name}
                disabled={saving}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nama lengkap"
              />
            </div>
            <div>
              <label className={labelCls}>Email Login</label>
              <input
                type="email"
                autoComplete="off"
                className={inputCls}
                value={form.email}
                disabled={saving || !isNew}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="user@email.com"
              />
              {!isNew && (
                <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                  Email login tidak bisa diubah.
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={`${inputCls} pr-9`}
                  value={form.password}
                  disabled={saving}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={isNew ? "Minimal 8 karakter" : "Kosongkan jika tidak diubah"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400 transition-colors duration-150 hover:text-lco-green dark:hover:text-lco-teal"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                {isNew
                  ? "User langsung bisa login dengan email dan password ini — tidak ada email undangan."
                  : "Password baru langsung berlaku; user perlu login ulang dengan password itu."}
              </p>
            </div>
          </div>

          <div>
            <label className={labelCls}>Role (boleh pilih lebih dari satu)</label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const selected = form.roles.includes(opt.value);
                const isSuperOpt = opt.value === "super_admin";
                const disabled = saving || rolesLocked || (isSuperOpt && !canGrantSuperAdmin);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    title={
                      isSuperOpt && !canGrantSuperAdmin
                        ? "Hanya Super Admin yang boleh memberi role Super Admin"
                        : rolesLocked
                          ? "Role akun ini tidak bisa Anda ubah"
                          : undefined
                    }
                    onClick={() => {
                      const next = selected
                        ? form.roles.filter((r) => r !== opt.value)
                        : [...form.roles, opt.value];
                      if (next.length === 0) return; // minimal satu role
                      setForm({ ...form, roles: next });
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected
                        ? "border-lco-green bg-lco-green text-white"
                        : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              Role hanya label jabatan. Hak akses sebenarnya diatur per modul di halaman detail user — kecuali Super
              Admin, yang selalu punya semua akses.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <button type="button" onClick={onClose} disabled={saving} className={ghostBtn}>
            Batalkan
          </button>
          <button type="submit" disabled={saving} className={primaryBtn}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? "Menyimpan..." : isNew ? "Buat User" : "Simpan Profil"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Layar detail ────────────────────────────────────────────────────────────

function DetailView({
  user,
  isSelf,
  draft,
  setDraft,
  dirty,
  saving,
  readOnly,
  readOnlyReason,
  superAdmin,
  canGrant,
  canEdit,
  canToggleActive,
  onBack,
  onEditProfile,
  onAddModule,
  onSave,
  onReset,
  onToggleActive,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  draft: UserPermissions;
  setDraft: (p: UserPermissions) => void;
  dirty: boolean;
  saving: boolean;
  readOnly: boolean;
  readOnlyReason: string;
  superAdmin: boolean;
  canGrant: CanGrant | undefined;
  canEdit: boolean;
  canToggleActive: boolean;
  onBack: () => void;
  onEditProfile: () => void;
  onAddModule: () => void;
  onSave: () => void;
  onReset: () => void;
  onToggleActive: () => void;
}) {
  const name = user.full_name || "(tanpa nama)";
  const info: [string, ReactNode][] = [
    ["Nama", name],
    [
      "Email",
      user.email ? (
        <span key="e" className="break-all font-mono">
          {user.email}
        </span>
      ) : (
        <span key="e" className="italic text-zinc-400">
          belum diisi
        </span>
      ),
    ],
    [
      "Peran",
      <span key="r" className="flex flex-wrap gap-1">
        {user.roles.map((r) => (
          <RoleBadge key={r} role={r} />
        ))}
      </span>,
    ],
    [
      "Status",
      <span key="s" className={user.is_active ? "text-lco-teal" : "text-lco-coral"}>
        {user.is_active ? "Aktif" : "Nonaktif"}
      </span>,
    ],
    ["Bergabung", formatDate(user.created_at)],
  ];

  const hint = superAdmin
    ? "Super Admin selalu punya semua akses, jadi semua izin aktif otomatis dan tidak bisa diubah."
    : readOnly
      ? readOnlyReason
      : canGrant
        ? "Izin yang Anda sendiri tidak punya tidak bisa diberikan (toggle redup). Perubahan tersimpan setelah klik Simpan."
        : "Matriks hak akses modul dan aksi. Perubahan tersimpan setelah klik Simpan.";

  return (
    <>
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition-colors duration-150 hover:text-lco-green dark:text-zinc-400 dark:hover:text-lco-teal"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke daftar
        </button>
        <nav aria-label="Breadcrumb" className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Pengaturan</span>
          <ChevronRight className="h-3 w-3" />
          <button type="button" onClick={onBack} className="hover:text-zinc-800 dark:hover:text-zinc-200">
            Pengguna
          </button>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">{name}</span>
        </nav>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 md:gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Kiri: Informasi pengguna */}
        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lco-green/10 text-lco-green dark:text-lco-teal">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Informasi Pengguna</h3>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">Data akun dan peran</p>
              </div>
            </div>
            <button type="button" onClick={onEditProfile} disabled={!canEdit} className={ghostBtn}>
              <Pencil className="h-3.5 w-3.5" /> Ubah Profil
            </button>
          </div>
          <dl className="m-5 divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {info.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[100px_1fr] gap-3 px-4 py-3 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
                <dd className="min-w-0 font-semibold text-zinc-800 dark:text-zinc-200">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            <button
              type="button"
              onClick={onToggleActive}
              disabled={!canToggleActive}
              title={
                isSelf
                  ? "Tidak bisa mengubah status akun sendiri"
                  : !canToggleActive
                    ? "Anda tidak bisa mengubah status akun ini"
                    : undefined
              }
              className={ghostBtn}
            >
              {user.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
              {user.is_active ? "Nonaktifkan" : "Aktifkan Kembali"}
            </button>
          </div>
        </div>

        {/* Kanan: Hak akses modul */}
        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lco-green/10 text-lco-green dark:text-lco-teal">
                <Layers className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Hak Akses Modul</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
              </div>
            </div>
            {!superAdmin && !readOnly && (
              <button type="button" onClick={onAddModule} className={`${primaryBtn} shrink-0`}>
                + Tambah Akses Modul
              </button>
            )}
          </div>

          <div className="p-4">
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <PermissionMatrix
                permissions={draft}
                onChange={setDraft}
                allGranted={superAdmin}
                readOnly={readOnly}
                canGrant={canGrant}
              />
            </div>
          </div>

          {dirty && (
            <div className="flex flex-col justify-between gap-3 border-t border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900/60 dark:bg-amber-950/30 sm:flex-row sm:items-center">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Ada perubahan hak akses yang belum disimpan.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onReset} disabled={saving} className={ghostBtn}>
                  Batalkan
                </button>
                <button type="button" onClick={onSave} disabled={saving} className={primaryBtn}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? "Menyimpan..." : "Simpan Perubahan"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Komponen utama ──────────────────────────────────────────────────────────

export default function PengaturanAdminTab() {
  const { user: currentUser } = useAuth();
  const { users, isLoading, error: usersError, saveUser, setUserActive, createUser } = useAdminUsers();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserPermissions>(DEFAULT_PERMISSIONS);
  const [savingPerm, setSavingPerm] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const [profileMode, setProfileMode] = useState<"new" | "edit" | null>(null);
  const [form, setForm] = useState<ProfileForm>({ name: "", email: "", password: "", roles: [...DEFAULT_ROLES] });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  /** Setelah user baru dibuat, buka detailnya begitu muncul di daftar. */
  const [openAfterCreate, setOpenAfterCreate] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUserRow | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // ─── Turunan ────────────────────────────────────────────────────────────────
  const selectedUser = selectedId ? (users.find((u) => u.id === selectedId) ?? null) : null;
  const savedPerms = useMemo(
    () => (selectedUser ? selectedUser.permissions : DEFAULT_PERMISSIONS),
    [selectedUser],
  );
  const dirty = !!selectedUser && !permissionsEqual(draft, savedPerms);

  const callerIsSuperAdmin = !!currentUser?.isSuperAdmin;
  const canCreateUser = hasPermissionAction(currentUser, "pengaturan_admin", "create");
  const canEditUser = hasPermissionAction(currentUser, "pengaturan_admin", "edit");

  // Izin lengkap pemanggil (termasuk `lintas_kasir`) diambil dari barisnya sendiri
  // di daftar; cadangannya permissionActions dari useAuth.
  const callerPermissions = useMemo<UserPermissions | null>(() => {
    if (!currentUser) return null;
    return users.find((u) => u.id === currentUser.id)?.permissions ?? null;
  }, [users, currentUser]);

  const canGrant: CanGrant | undefined = callerIsSuperAdmin
    ? undefined
    : (key, field) =>
        callerPermissions
          ? holdsPermission(callerPermissions, key, field)
          : ((currentUser?.permissionActions[key] as unknown as Record<string, boolean> | undefined)?.[field] ??
            false);

  const targetIsSuperAdmin = !!selectedUser?.roles.includes("super_admin");
  const editingSelf = !!selectedUser && selectedUser.id === currentUser?.id;
  // Super Admin boleh mengubah semua (kecuali yang ditolak server, mis. Super Admin terakhir).
  const permReadOnly = !callerIsSuperAdmin && (!canEditUser || editingSelf || targetIsSuperAdmin);
  const readOnlyReason = !canEditUser
    ? "Anda hanya boleh melihat. Izin “Kelola User · Ubah” diperlukan untuk mengubah hak akses."
    : editingSelf
      ? "Anda tidak bisa mengubah izin akun Anda sendiri. Minta Super Admin atau user lain yang berwenang."
      : "Hanya Super Admin yang boleh mengubah akun Super Admin.";

  const canToggleActiveFor = (u: AdminUserRow) =>
    canEditUser && u.id !== currentUser?.id && (callerIsSuperAdmin || !u.roles.includes("super_admin"));

  // ─── Navigasi ───────────────────────────────────────────────────────────────
  const openDetail = (u: AdminUserRow) => {
    setSelectedId(u.id);
    setDraft(u.permissions);
    setAddOpen(false);
    setActionError(null);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setAddOpen(false);
    setDiscardOpen(false);
  };

  const backToList = () => {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    closeDetail();
  };

  // User yang dibuka hilang dari daftar → kembali ke daftar
  useEffect(() => {
    if (selectedId && !selectedUser && !isLoading) setSelectedId(null);
  }, [selectedId, selectedUser, isLoading]);

  // Buka detail user yang baru dibuat
  useEffect(() => {
    if (!openAfterCreate) return;
    const u = users.find((x) => x.id === openAfterCreate);
    if (u) {
      setOpenAfterCreate(null);
      openDetail(u);
    }
  }, [users, openAfterCreate]);

  // ─── Profil (tambah user / ubah profil) ─────────────────────────────────────
  const openNewUser = () => {
    setProfileError(null);
    setForm({ name: "", email: "", password: "", roles: [...DEFAULT_ROLES] });
    setProfileMode("new");
  };

  const openEditProfile = () => {
    if (!selectedUser) return;
    setProfileError(null);
    setForm({
      name: selectedUser.full_name ?? "",
      email: selectedUser.email ?? "",
      password: "",
      roles: [...selectedUser.roles],
    });
    setProfileMode("edit");
  };

  const closeProfile = () => {
    setProfileMode(null);
    setProfileError(null);
  };

  const submitProfile = async () => {
    if (savingProfile || !profileMode) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      if (profileMode === "new") {
        const newId = await createUser({
          fullName: form.name,
          email: form.email,
          password: form.password,
          roles: form.roles,
          permissions: DEFAULT_PERMISSIONS,
        });
        // Langsung tutup modal dan buka detail user baru untuk mengatur hak aksesnya.
        setProfileMode(null);
        if (newId) setOpenAfterCreate(newId);
      } else if (selectedUser) {
        // Ubah profil: kirim izin yang SUDAH tersimpan (bukan draft) supaya draft tidak ikut tersimpan.
        await saveUser(selectedUser.id, {
          fullName: form.name,
          password: form.password,
          roles: form.roles,
          permissions: savedPerms,
        });
        setProfileMode(null);
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Gagal menyimpan data user.");
    } finally {
      setSavingProfile(false);
    }
  };

  // ─── Hak akses ──────────────────────────────────────────────────────────────
  // Modul yang belum punya akses dan boleh diberikan oleh pemanggil (hanya 11 modul — tanpa memo).
  const available = MODULE_DEFS.filter(
    (d) => !moduleHasAccess(draft, d.key) && (!canGrant || canGrant(d.key, "view")),
  );

  const handleAddModules = (keys: PermKey[], initial: InitialGrant) => {
    setDraft((d) => grantModules(d, keys, initial, canGrant));
    setAddOpen(false);
  };

  const savePermissions = async () => {
    if (!selectedUser || savingPerm) return;
    setSavingPerm(true);
    setActionError(null);
    try {
      await saveUser(selectedUser.id, {
        fullName: selectedUser.full_name ?? "",
        roles: selectedUser.roles,
        permissions: draft,
      });
      // `users` dimuat ulang → savedPerms ikut berubah dan `dirty` kembali false.
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menyimpan hak akses.");
    } finally {
      setSavingPerm(false);
    }
  };

  // ─── Aktif/nonaktif ─────────────────────────────────────────────────────────
  const handleToggleActive = async (u: AdminUserRow) => {
    if (u.is_active) {
      setDeactivateTarget(u); // menonaktifkan perlu konfirmasi; mengaktifkan tidak
      return;
    }
    setActionError(null);
    try {
      await setUserActive(u.id, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengaktifkan user.");
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setTogglingActive(true);
    setActionError(null);
    try {
      await setUserActive(deactivateTarget.id, false);
      setDeactivateTarget(null);
    } catch (err) {
      setDeactivateTarget(null);
      setActionError(err instanceof Error ? err.message : "Gagal menonaktifkan user.");
    } finally {
      setTogglingActive(false);
    }
  };

  // ─── Daftar: cari + halaman ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => [u.full_name ?? "", u.email ?? ""].some((s) => s.toLowerCase().includes(q)));
  }, [users, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * PER_PAGE, curPage * PER_PAGE);

  // Spinner hanya saat pemuatan PERTAMA — muat ulang setelah simpan tidak boleh
  // membongkar layar detail (draft bisa hilang).
  if (isLoading && users.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat daftar user...
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {usersError && <ErrorBanner message={`Gagal memuat daftar user: ${usersError}`} />}
      {actionError && <ErrorBanner message={actionError} />}

      {selectedUser ? (
        <DetailView
          user={selectedUser}
          isSelf={editingSelf}
          draft={draft}
          setDraft={setDraft}
          dirty={dirty}
          saving={savingPerm}
          readOnly={permReadOnly}
          readOnlyReason={readOnlyReason}
          superAdmin={targetIsSuperAdmin}
          canGrant={canGrant}
          canEdit={canEditUser && (callerIsSuperAdmin || !targetIsSuperAdmin)}
          canToggleActive={canToggleActiveFor(selectedUser)}
          onBack={backToList}
          onEditProfile={openEditProfile}
          onAddModule={() => setAddOpen(true)}
          onSave={savePermissions}
          onReset={() => setDraft(savedPerms)}
          onToggleActive={() => handleToggleActive(selectedUser)}
        />
      ) : (
        <>
          <div className={`${cardCls} flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6`}>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Akses Pengguna</h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Kelola akun dan hak akses modul. Klik ikon kunci untuk melihat dan mengatur akses.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewUser}
              disabled={!canCreateUser}
              title={!canCreateUser ? "Butuh izin “Kelola User · Tambah”" : undefined}
              className={primaryBtn}
            >
              <UserPlus className="h-4 w-4" />
              Tambah User
            </button>
          </div>

          <div className={cardCls}>
            <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div className="relative max-w-sm">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Cari nama atau email..."
                  aria-label="Cari pengguna"
                  className={`${inputCls} pl-9`}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-950">
                    <th className={thCls}>Pengguna</th>
                    <th className={thCls}>Email</th>
                    <th className={thCls}>Akses Modul</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} !text-right`}>Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                        {query
                          ? "Tidak ada pengguna yang cocok dengan pencarian."
                          : "Belum ada user, atau Anda tidak punya izin melihat daftar ini (butuh izin “Kelola User”)."}
                      </td>
                    </tr>
                  )}
                  {pageRows.map((u) => {
                    const isSuper = u.roles.includes("super_admin");
                    const chips = summarizeAccess(u.permissions);
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <tr
                        key={u.id}
                        className={`transition-colors duration-150 hover:bg-zinc-50/60 dark:hover:bg-zinc-950/60 ${
                          u.is_active ? "" : "opacity-60"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Initials name={u.full_name ?? ""} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {u.full_name || "(tanpa nama)"}
                                {isSelf && (
                                  <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                    Anda
                                  </span>
                                )}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {u.roles.map((r) => (
                                  <RoleBadge key={r} role={r} />
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          {u.email ? (
                            <span className="block max-w-[220px] truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">
                              {u.email}
                            </span>
                          ) : (
                            <span className="text-xs italic text-zinc-400">belum diisi</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          {isSuper ? (
                            <span className="inline-flex items-center rounded-md bg-lco-green/10 px-2 py-0.5 text-[11px] font-semibold text-lco-green dark:text-lco-teal">
                              Semua modul
                            </span>
                          ) : chips.length === 0 ? (
                            <span className="text-xs text-zinc-400">Belum ada akses</span>
                          ) : (
                            <div className="flex max-w-[320px] flex-wrap gap-1">
                              {chips.slice(0, 4).map((c) => (
                                <span
                                  key={c.label}
                                  className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                >
                                  {c.label}
                                </span>
                              ))}
                              {chips.length > 4 && (
                                <span
                                  title={chips
                                    .slice(4)
                                    .map((c) => c.label)
                                    .join(", ")}
                                  className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                >
                                  +{chips.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <span className={`text-sm font-medium ${u.is_active ? "text-lco-teal" : "text-lco-coral"}`}>
                            {u.is_active ? "Aktif" : "Nonaktif"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openDetail(u)}
                              title="Atur Akses"
                              aria-label={`Atur akses ${u.full_name ?? "user"}`}
                              className={iconBtn}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(u)}
                              disabled={!canToggleActiveFor(u)}
                              title={
                                isSelf
                                  ? "Tidak bisa mengubah status akun sendiri"
                                  : u.is_active
                                    ? "Nonaktifkan"
                                    : "Aktifkan kembali"
                              }
                              aria-label={`${u.is_active ? "Nonaktifkan" : "Aktifkan"} ${u.full_name ?? "user"}`}
                              className={iconBtn}
                            >
                              {u.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span>
                {filtered.length} pengguna · halaman {curPage} dari {totalPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(curPage - 1)}
                  disabled={curPage <= 1}
                  aria-label="Halaman sebelumnya"
                  className={iconBtn}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(curPage + 1)}
                  disabled={curPage >= totalPages}
                  aria-label="Halaman berikutnya"
                  className={iconBtn}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {addOpen && <AddModuleModal available={available} onClose={() => setAddOpen(false)} onSubmit={handleAddModules} />}

      {profileMode && (
        <ProfileModal
          mode={profileMode}
          form={form}
          setForm={setForm}
          saving={savingProfile}
          error={profileError}
          rolesLocked={
            profileMode === "edit" &&
            !callerIsSuperAdmin &&
            (editingSelf || targetIsSuperAdmin)
          }
          canGrantSuperAdmin={callerIsSuperAdmin}
          onClose={closeProfile}
          onSubmit={submitProfile}
        />
      )}

      {deactivateTarget && (
        <ConfirmModal
          title="Nonaktifkan user?"
          message={`${deactivateTarget.full_name ?? "User ini"} tidak akan bisa login atau memakai aplikasi sampai diaktifkan kembali. Riwayat transaksinya tetap tersimpan.`}
          confirmLabel="Nonaktifkan"
          danger
          busy={togglingActive}
          onConfirm={confirmDeactivate}
          onClose={() => setDeactivateTarget(null)}
        />
      )}

      {discardOpen && (
        <ConfirmModal
          title="Perubahan belum disimpan"
          message="Perubahan hak akses belum disimpan. Tinggalkan halaman ini?"
          confirmLabel="Tinggalkan"
          onConfirm={closeDetail}
          onClose={() => setDiscardOpen(false)}
        />
      )}
    </div>
  );
}
