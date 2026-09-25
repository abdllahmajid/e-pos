"use client";

// app/components/pengaturan/PengaturanAdminTab.tsx
// ── TAMBAHAN ── Sub-tab "Pengaturan Admin" di PengaturanModule.tsx (PRD §17
// T-10, §11). Tabel semua user (`profiles`, lewat hooks/useAdminUsers.ts —
// migration 016/017) dengan aksi: ubah role, aktifkan/nonaktifkan, edit nama
// & email, kirim reset password.
//
// Baris user yang sedang login SENGAJA tidak bisa diubah role/status-nya dari
// sini (tombol disabled + catatan) — konsisten dengan guard di RPC
// `admin_update_user_role`/`admin_set_user_active` (migration 016, admin
// tidak bisa mengubah dirinya sendiri, supaya tidak terkunci dari sistem).
// UI ini cuma MENCERMINKAN batasan itu lebih awal (disabled, bukan menunggu
// error dari RPC), bukan sumber kebenaran permission-nya — itu tetap di
// database.
//
// ── REVISI (migration 028_dynamic_roles.sql, "sistem role dinamis") ──
// Sebelumnya (migration 018) hierarki ditulis manual dengan 2 pengaman
// khusus "supervisor tidak boleh sentuh/mempromosikan admin". Enum
// `user_role` & 4 nama role tetap SUDAH DIHAPUS TOTAL, diganti tabel `roles`
// dengan kolom `level` (integer, 0 = paling berwenang) — jadi kedua pengaman
// itu DIGENERALISASI jadi perbandingan angka, berlaku untuk level berapa pun
// (bukan cuma admin/supervisor), dan otomatis ikut kalau pemilik project
// bikin role custom baru dengan level sendiri:
//   A. Baris user yang ROLE-NYA SAAT INI level-nya < level caller (lebih
//      berwenang dari caller) dikunci total dari caller — bukan lagi
//      `isSupervisorCaller && row.role === "admin"`, tapi
//      `row.role_level < callerLevel`. Generalisasi trigger
//      `enforce_profiles_role_change` (migration 028).
//   B. Dropdown role (baik ubah role per-baris maupun Tambah User) cuma
//      menawarkan role dengan level >= level caller — bukan lagi
//      `ROLE_OPTIONS.filter(role => role !== "admin")` yang hardcode nama.
//      Generalisasi guard `v_new_role_level < v_caller_level` di RPC
//      `admin_update_user_role` (migration 028) & route.ts create-user.
// UI ini cuma mencerminkan batasan itu lebih awal (disabled/disaring,
// bukan menunggu error RPC/route) — sumber kebenarannya tetap di database,
// sama seperti sebelumnya.
//
// Daftar role sendiri (nama, level) sekarang DATA, bukan tipe compile-time —
// diambil lewat hooks/useRoles.ts (tab "Role", langkah sebelumnya), bukan
// lagi konstanta ROLE_LABEL/ROLE_OPTIONS yang di-hardcode di file ini.
//
// Pola konfirmasi: reuse gaya modal konfirmasi ProdukModule.tsx (hapus
// produk) untuk ubah role & nonaktifkan (aksi yang berdampak ke akses login
// user lain, perlu konfirmasi eksplisit) — TAPI aktifkan kembali & reset
// password TIDAK pakai modal (dampaknya kecil/reversible, konfirmasi malah
// memperlambat kerja admin untuk aksi yang sering dipakai).
//
// ── TAMBAHAN ── Tombol "+ Tambah User" (sebelumnya SENGAJA ditunda di PRD
// §17 T-10 — keputusan awal "user dibuat via dashboard/invite", sekarang
// dipindah ke dalam app atas permintaan lanjutan). Beda dari semua aksi lain
// di tab ini: bukan RPC/`.update()` langsung, tapi lewat
// `hooks/useAdminUsers.ts` -> `createUser()` -> API route server
// `app/api/admin/create-user/route.ts` (butuh Supabase Admin API + service
// role key, lihat komentar header route.ts). User baru dikirimi EMAIL
// UNDANGAN (bukan password sementara) — dia set password sendiri lewat link,
// konsisten dengan pola "Kirim Reset Password" yang sudah ada di tab ini.
// Modal Tambah User pakai batasan role yang SAMA dengan dropdown edit role
// per-baris (pengaman B di atas), TIDAK pakai modal konfirmasi terpisah
// (submit form-nya sendiri sudah cukup eksplisit, beda dari ubah
// role/nonaktifkan yang mengubah akun yang SUDAH ada).

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  ShieldAlert,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAdminUsers, type AdminUserRow } from "@/hooks/useAdminUsers";
import { useRoles, type RoleRow } from "@/hooks/useRoles";

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(isoString),
  );
}

// ── TAMBAHAN (migration 028, pengaman B) ── Role yang boleh DIPILIH caller
// (baik ubah role per-baris maupun Tambah User): level-nya harus >= level
// caller sendiri — generalisasi dari "supervisor tidak bisa membuat/memberi
// role admin". `callerLevel` bisa `undefined` (currentUser belum termuat)
// -> dianggap paling TIDAK berwenang (Infinity) supaya defaultnya gagal
// closed (tidak ada opsi ditawarkan), bukan gagal open.
function getRoleOptionsFor(
  roles: RoleRow[],
  callerLevel: number | undefined,
): RoleRow[] {
  const level = callerLevel ?? Number.POSITIVE_INFINITY;
  return roles.filter((role) => role.level >= level);
}

// Default role paling aman untuk form Tambah User: yang levelnya PALING
// BESAR (paling tidak berwenang) di antara opsi yang boleh dipilih caller —
// generalisasi dari default hardcode 'kasir' lama, supaya admin harus SADAR
// menaikkan wewenangnya sendiri, bukan ke-klik tanpa sengaja.
function getSafestDefaultRoleId(options: RoleRow[]): string {
  if (options.length === 0) return "";
  return options.reduce((safest, role) =>
    role.level > safest.level ? role : safest,
  ).id;
}

export default function PengaturanAdminTab() {
  const { user: currentUser } = useAuth();
  const {
    users,
    isLoading: isUsersLoading,
    error: usersError,
    updateUserRole,
    setUserActive,
    updateUserContact,
    sendPasswordReset,
    createUser,
  } = useAdminUsers();
  // ── TAMBAHAN (migration 028) ── Daftar role dinamis buat dropdown — hook
  // yang sama dipakai tab "Role", di sini cuma dibaca (tidak ada CRUD role
  // dari tab ini).
  const { roles, isLoading: isRolesLoading, error: rolesError } = useRoles();

  // Konfirmasi ubah role — { user, newRoleId } sekaligus supaya modal tahu
  // isi "dari -> ke" untuk ditampilkan.
  const [roleChangeTarget, setRoleChangeTarget] = useState<{
    targetUser: AdminUserRow;
    newRoleId: string;
  } | null>(null);
  // Konfirmasi nonaktifkan (aktifkan kembali tidak pakai modal, lihat catatan header).
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUserRow | null>(
    null,
  );
  // Modal edit nama/email.
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  // ── TAMBAHAN ── Modal "Tambah User". Dipisah state-nya dari modal Edit di
  // atas (walau field mirip: nama & email) karena aksinya beda total (create
  // vs update) dan Tambah User punya field tambahan (role) + tidak ada
  // "user yang sedang diedit" untuk dijadikan initial value.
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRoleId, setNewUserRoleId] = useState("");
  const [addUserSuccess, setAddUserSuccess] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // id user yang baru sukses kirim reset password, dipakai tampilkan centang
  // sebentar di baris itu saja (bukan toast global) — reset saat ganti target lain.
  const [resetSentForId, setResetSentForId] = useState<string | null>(null);
  const [sendingResetForId, setSendingResetForId] = useState<string | null>(
    null,
  );

  function openEdit(targetUser: AdminUserRow) {
    setActionError(null);
    setEditingUser(targetUser);
    setEditName(targetUser.full_name ?? "");
    setEditEmail(targetUser.email ?? "");
  }

  function openAddUser() {
    setActionError(null);
    setAddUserSuccess(false);
    setNewUserName("");
    setNewUserEmail("");
    // ── REVISI (migration 028) ── lihat getSafestDefaultRoleId di atas.
    setNewUserRoleId(getSafestDefaultRoleId(roleOptions));
    setIsAddUserOpen(true);
  }

  async function handleConfirmAddUser() {
    setIsSubmitting(true);
    setActionError(null);
    try {
      await createUser({
        fullName: newUserName,
        email: newUserEmail,
        roleId: newUserRoleId,
      });
      // Beda dari modal Edit (langsung tutup) — modal ini tetap terbuka
      // sebentar menampilkan pesan sukses dulu, supaya admin sadar undangan
      // sudah terkirim (bukan langsung raib begitu submit), baru admin yang
      // menutup sendiri.
      setAddUserSuccess(true);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal membuat user baru.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmEdit() {
    if (!editingUser) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await updateUserContact(editingUser.id, {
        fullName: editName,
        email: editEmail,
      });
      setEditingUser(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal menyimpan data user.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmRoleChange() {
    if (!roleChangeTarget) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await updateUserRole(
        roleChangeTarget.targetUser.id,
        roleChangeTarget.newRoleId,
      );
      setRoleChangeTarget(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal mengubah role user.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDeactivate() {
    if (!deactivateTarget) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await setUserActive(deactivateTarget.id, false);
      setDeactivateTarget(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal menonaktifkan user.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReactivate(targetUser: AdminUserRow) {
    setActionError(null);
    try {
      await setUserActive(targetUser.id, true);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal mengaktifkan user.",
      );
    }
  }

  async function handleSendReset(targetUser: AdminUserRow) {
    setActionError(null);
    setResetSentForId(null);
    setSendingResetForId(targetUser.id);
    try {
      await sendPasswordReset(targetUser);
      setResetSentForId(targetUser.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal mengirim reset password.",
      );
    } finally {
      setSendingResetForId(null);
    }
  }

  // ── REVISI (migration 028, pengaman B) ── Dihitung sekali di luar loop
  // baris, dipakai per baris di bawah + modal Tambah User.
  const roleOptions = getRoleOptionsFor(roles, currentUser?.role_level);

  if (isUsersLoading || isRolesLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat daftar user...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {usersError && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Gagal memuat daftar user: {usersError}
        </div>
      )}

      {rolesError && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Gagal memuat daftar role: {rolesError}
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
          onClick={openAddUser}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover"
        >
          <UserPlus className="h-4 w-4" />
          Tambah User
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Nama</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Bergabung</th>
              <th className="px-4 py-3 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((row) => {
              const isSelf = row.id === currentUser?.id;
              // ── REVISI (migration 028, pengaman A) ── Baris yang role-nya
              // SAAT INI lebih berwenang dari caller (level lebih kecil)
              // dikunci total — generalisasi dari "supervisor tidak boleh
              // menyentuh baris admin".
              const isLockedByHierarchy =
                row.role_level <
                (currentUser?.role_level ?? Number.POSITIVE_INFINITY);

              return (
                <tr key={row.id} className={!row.is_active ? "opacity-60" : ""}>
                  <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200">
                    {row.full_name || "(tanpa nama)"}
                    {isSelf && (
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        Anda
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {row.email || (
                      <span className="italic text-zinc-400 dark:text-zinc-600">
                        belum diisi
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={row.role_id}
                      disabled={isSelf || isLockedByHierarchy}
                      title={
                        isLockedByHierarchy
                          ? "Role user ini lebih berwenang dari Anda — tidak bisa diubah dari sini"
                          : undefined
                      }
                      onChange={(e) =>
                        setRoleChangeTarget({
                          targetUser: row,
                          newRoleId: e.target.value,
                        })
                      }
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      {/* ── REVISI (migration 028, pengaman B) ── Baris yang
                          dikunci (role saat ini lebih berwenang dari caller)
                          tetap perlu opsi role-nya sendiri supaya value
                          terpilih valid walau selectnya disabled — daftar
                          penuh `roles` dipakai untuk baris ini, `roleOptions`
                          (yang sudah disaring level) dipakai untuk baris lain
                          yang memang bisa diedit caller. */}
                      {(isLockedByHierarchy ? roles : roleOptions).map(
                        (role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        row.is_active
                          ? "font-medium text-lco-teal"
                          : "font-medium text-lco-coral"
                      }
                    >
                      {row.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        title={
                          isLockedByHierarchy
                            ? "Role user ini lebih berwenang dari Anda — tidak bisa diedit dari sini"
                            : "Edit nama & email"
                        }
                        onClick={() => openEdit(row)}
                        disabled={isLockedByHierarchy}
                        className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        title={
                          isLockedByHierarchy
                            ? "Role user ini lebih berwenang dari Anda — tidak bisa kirim reset password dari sini"
                            : !row.email
                              ? "Isi email dulu lewat Edit sebelum kirim reset password"
                              : "Kirim email reset password"
                        }
                        onClick={() => handleSendReset(row)}
                        disabled={
                          isLockedByHierarchy ||
                          !row.email ||
                          sendingResetForId === row.id
                        }
                        className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        {sendingResetForId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : resetSentForId === row.id ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-lco-green" />
                        ) : (
                          <KeyRound className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {row.is_active ? (
                        <button
                          type="button"
                          title={
                            isSelf
                              ? "Tidak bisa menonaktifkan diri sendiri"
                              : isLockedByHierarchy
                                ? "Role user ini lebih berwenang dari Anda — tidak bisa dinonaktifkan dari sini"
                                : "Nonaktifkan"
                          }
                          onClick={() => setDeactivateTarget(row)}
                          disabled={isSelf || isLockedByHierarchy}
                          className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-lco-coral/10 hover:text-lco-coral disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                        >
                          <UserX className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title={
                            isLockedByHierarchy
                              ? "Role user ini lebih berwenang dari Anda — tidak bisa diaktifkan dari sini"
                              : "Aktifkan kembali"
                          }
                          onClick={() => handleReactivate(row)}
                          disabled={isLockedByHierarchy}
                          className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-lco-green/10 hover:text-lco-green disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  Belum ada user, atau Anda tidak punya izin melihat daftar ini
                  (butuh permission &quot;pengaturan_admin&quot;).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modal: edit nama & email ── */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-3 text-sm font-semibold">Edit User</h3>

            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Nama
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={isSubmitting}
              className="mb-3 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
            />

            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Email
            </label>
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              disabled={isSubmitting}
              placeholder="user@email.com"
              className="mb-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
            />
            <p className="mb-3 text-xs text-zinc-400">
              Dipakai untuk tombol reset password. Tidak wajib diisi.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                disabled={isSubmitting}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmEdit}
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

      {/* ── Modal: Tambah User ── */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            {addUserSuccess ? (
              // ── Layar sukses — bukan modal Edit yang langsung tutup,
              // supaya admin sadar undangan email sudah terkirim.
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-lco-teal/10 text-lco-teal">
                  <Mail className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold">Undangan terkirim</h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Email undangan sudah dikirim ke{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {newUserEmail}
                  </span>
                  . User akan muncul di daftar setelah dia klik link di email
                  itu dan mengatur password.
                </p>
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="mt-4 w-full rounded-md bg-lco-teal px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-teal/90"
                >
                  Tutup
                </button>
              </div>
            ) : (
              <>
                <h3 className="mb-3 text-sm font-semibold">Tambah User</h3>

                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Nama
                </label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="Nama lengkap"
                  className="mb-3 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
                />

                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Email
                </label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="user@email.com"
                  className="mb-3 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
                />

                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Role
                </label>
                {/* roleOptions sudah dihitung di atas (pengaman B, migration
                    028) — caller tidak melihat role yang levelnya lebih
                    tinggi dari dirinya sendiri, sama seperti dropdown ubah
                    role per-baris. */}
                <select
                  value={newUserRoleId}
                  onChange={(e) => setNewUserRoleId(e.target.value)}
                  disabled={isSubmitting}
                  className="mb-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  {roleOptions.length === 0 && (
                    <option value="">Tidak ada role yang bisa diberikan</option>
                  )}
                  {roleOptions.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <p className="mb-3 text-xs text-zinc-400">
                  User akan menerima email undangan untuk mengatur password
                  sendiri — tidak ada password sementara.
                </p>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddUserOpen(false)}
                    disabled={isSubmitting}
                    className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAddUser}
                    disabled={isSubmitting || !newUserRoleId}
                    className="inline-flex items-center gap-2 rounded-md bg-lco-green px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    Kirim Undangan
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: konfirmasi ubah role ── */}
      {roleChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lco-mustard/10 text-lco-mustard">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Ubah role user?</h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {roleChangeTarget.targetUser.full_name || "User ini"}
                  </span>{" "}
                  akan diubah dari{" "}
                  <span className="font-medium">
                    {roleChangeTarget.targetUser.role_name}
                  </span>{" "}
                  menjadi{" "}
                  <span className="font-medium">
                    {roles.find((r) => r.id === roleChangeTarget.newRoleId)
                      ?.name ?? "(role tidak dikenal)"}
                  </span>
                  . Akses menu & tombol user ini akan berubah sesuai role baru
                  mulai sesi login berikutnya.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRoleChangeTarget(null)}
                disabled={isSubmitting}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmRoleChange}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-md bg-lco-mustard px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-mustard/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Ya, Ubah Role
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: konfirmasi nonaktifkan ── */}
      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lco-coral/10 text-lco-coral">
                <UserX className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Nonaktifkan user?</h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {deactivateTarget.full_name || "User ini"}
                  </span>{" "}
                  tidak akan bisa login sampai diaktifkan kembali. Data &
                  riwayat transaksinya tidak terhapus.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeactivateTarget(null)}
                disabled={isSubmitting}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-md bg-lco-coral px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-coral/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Ya, Nonaktifkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
