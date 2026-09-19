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
// ── TAMBAHAN (migration 018) ── Modul ini sekarang admin+supervisor (lihat
// PengaturanModule.tsx). Supervisor dapat 2 pengaman TAMBAHAN yang tidak
// berlaku untuk admin, mencerminkan trigger `profiles_enforce_role_change` +
// RPC `admin_update_user_role`/`admin_set_user_active` di migration 018:
//   A. Baris user yang ROLE-NYA SAAT INI admin dikunci total dari supervisor
//      (dropdown role & tombol nonaktifkan disabled) — supervisor tidak
//      boleh menyentuh akun admin sama sekali.
//   B. Pilihan role "Admin" disembunyikan dari dropdown supervisor sama
//      sekali — supervisor tidak bisa mempromosikan siapa pun jadi admin.
// UI ini cuma mencerminkan batasan itu lebih awal (disabled/disembunyikan,
// bukan menunggu error RPC) — sumber kebenarannya tetap di database, sama
// seperti pola pengaman self-target di atas.
//
// Pola konfirmasi: reuse gaya modal konfirmasi ProdukModule.tsx (hapus
// produk) untuk ubah role & nonaktifkan (aksi yang berdampak ke akses login
// user lain, perlu konfirmasi eksplisit) — TAPI aktifkan kembali & reset
// password TIDAK pakai modal (dampaknya kecil/reversible, konfirmasi malah
// memperlambat kerja admin untuk aksi yang sering dipakai).

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  ShieldAlert,
  UserCheck,
  UserX,
} from "lucide-react";
import { useAuth, type UserRole } from "@/hooks/useAuth";
import { useAdminUsers, type AdminUserRow } from "@/hooks/useAdminUsers";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  kasir: "Kasir",
  qc: "QC",
};

const ROLE_OPTIONS: UserRole[] = ["admin", "supervisor", "kasir", "qc"];

// ── TAMBAHAN (migration 018, pengaman B) ── Opsi role yang boleh DIPILIH
// tergantung role pemanggil. Supervisor tidak pernah melihat "Admin" sebagai
// pilihan (tidak bisa mempromosikan siapa pun jadi admin) — admin tetap
// melihat semua opsi seperti sebelumnya.
function getRoleOptionsFor(callerRole: UserRole | undefined): UserRole[] {
  if (callerRole === "supervisor") {
    return ROLE_OPTIONS.filter((role) => role !== "admin");
  }
  return ROLE_OPTIONS;
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(isoString),
  );
}

export default function PengaturanAdminTab() {
  const { user: currentUser } = useAuth();
  const {
    users,
    isLoading,
    error,
    updateUserRole,
    setUserActive,
    updateUserContact,
    sendPasswordReset,
  } = useAdminUsers();

  // Konfirmasi ubah role — { user, newRole } sekaligus supaya modal tahu
  // isi "dari -> ke" untuk ditampilkan.
  const [roleChangeTarget, setRoleChangeTarget] = useState<{
    targetUser: AdminUserRow;
    newRole: UserRole;
  } | null>(null);
  // Konfirmasi nonaktifkan (aktifkan kembali tidak pakai modal, lihat catatan header).
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUserRow | null>(
    null,
  );
  // Modal edit nama/email.
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

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
        roleChangeTarget.newRole,
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

  // ── TAMBAHAN (migration 018, pengaman A/B) ── Dihitung sekali di luar
  // loop baris, dipakai per baris di bawah.
  const isSupervisorCaller = currentUser?.role === "supervisor";
  const roleOptions = getRoleOptionsFor(currentUser?.role);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat daftar user...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Gagal memuat daftar user: {error}
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {actionError}
        </div>
      )}

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
              // Pengaman A (migration 018): supervisor tidak boleh
              // menyentuh baris yang ROLE-NYA SAAT INI admin sama sekali.
              const isLockedForSupervisor =
                isSupervisorCaller && row.role === "admin";

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
                      value={row.role}
                      disabled={isSelf || isLockedForSupervisor}
                      title={
                        isLockedForSupervisor
                          ? "Supervisor tidak bisa mengubah role akun admin"
                          : undefined
                      }
                      onChange={(e) =>
                        setRoleChangeTarget({
                          targetUser: row,
                          newRole: e.target.value as UserRole,
                        })
                      }
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      {/* ── TAMBAHAN (migration 018, pengaman B) ── Baris
                          yang SAAT INI admin tapi selectnya disabled (lihat
                          di atas) tetap perlu opsi "Admin" supaya value
                          terpilih valid — roleOptions (tanpa "admin" untuk
                          supervisor) dipakai untuk baris LAIN yang bisa
                          diedit, bukan baris ini. */}
                      {(row.role === "admin" ? ROLE_OPTIONS : roleOptions).map(
                        (role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        row.is_active
                          ? "font-medium text-lco-green"
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
                          isLockedForSupervisor
                            ? "Supervisor tidak bisa mengedit akun admin"
                            : "Edit nama & email"
                        }
                        onClick={() => openEdit(row)}
                        disabled={isLockedForSupervisor}
                        className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        title={
                          isLockedForSupervisor
                            ? "Supervisor tidak bisa mengirim reset password akun admin"
                            : !row.email
                              ? "Isi email dulu lewat Edit sebelum kirim reset password"
                              : "Kirim email reset password"
                        }
                        onClick={() => handleSendReset(row)}
                        disabled={
                          isLockedForSupervisor ||
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
                              : isLockedForSupervisor
                                ? "Supervisor tidak bisa menonaktifkan akun admin"
                                : "Nonaktifkan"
                          }
                          onClick={() => setDeactivateTarget(row)}
                          disabled={isSelf || isLockedForSupervisor}
                          className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-lco-coral/10 hover:text-lco-coral disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                        >
                          <UserX className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title={
                            isLockedForSupervisor
                              ? "Supervisor tidak bisa mengaktifkan akun admin"
                              : "Aktifkan kembali"
                          }
                          onClick={() => handleReactivate(row)}
                          disabled={isLockedForSupervisor}
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
                  (butuh migration 016 aktif).
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
                    {ROLE_LABEL[roleChangeTarget.targetUser.role]}
                  </span>{" "}
                  menjadi{" "}
                  <span className="font-medium">
                    {ROLE_LABEL[roleChangeTarget.newRole]}
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
