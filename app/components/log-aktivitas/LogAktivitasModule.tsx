"use client";

// app/components/log-aktivitas/LogAktivitasModule.tsx
// ── TAMBAHAN ── Modul Log Aktivitas (PRD §17 T-09, §4.1 menu Lainnya →
// "Log Aktivitas"). Melengkapi SampahModule.tsx yang sudah lebih dulu ada —
// keduanya satu task (T-09), tapi sengaja dua file terpisah (bukan digabung
// jadi 1 modul bertab) karena PRD §4.1 menulisnya sebagai 2 menu berbeda di
// grup "Lainnya", dan datanya juga berasal dari tabel berbeda (`activity_logs`
// vs `products`/`transactions` yang `deleted_at IS NOT NULL`).
//
// Akses: admin+supervisor — SAMA dengan SampahModule.tsx (migration 015),
// bukan admin-only seperti PRD §5 asli. Alasannya konsisten dengan Sampah:
// kedua menu ini satu paket audit/administrasi yang sudah dikonfirmasi
// pemilik project dibuka untuk supervisor juga (lihat komentar header
// migration 015 & entri sesi #10 di PROGRESS.md). RLS `activity_logs` sendiri
// SUDAH admin+supervisor sejak migration 015 (bagian kedua migration itu,
// bukan cuma RPC Sampah) — jadi halaman ini cuma menyamakan gate UI dengan
// apa yang backend sudah izinkan, tidak melonggarkan apa pun sendiri.
//
// Read-only murni (lihat catatan header hooks/useActivityLogs.ts) — tidak ada
// aksi tulis di halaman ini sama sekali, beda dengan SampahModule.tsx yang
// punya tombol Pulihkan.
//
// Filter: entitas (Semua/Transaksi/Produk), aksi (multi-pilih, daftar dari
// ACTIVITY_ACTION_LABEL), user pelaku (dropdown dari useActivityLogUsers),
// dan rentang tanggal (client-side — tabel activity_logs untuk toko kecil ini
// diperkirakan tidak akan sebesar transactions, jadi filter tanggal tidak
// perlu dikirim ke query seperti LaporanModule.tsx; kalau nanti baris makin
// banyak, pertimbangkan pindahkan ke server-side).

import { useMemo, useState } from "react";
import { AlertCircle, ClipboardList, Loader2, ShieldAlert } from "lucide-react";
import { useAuth, hasPermission } from "@/hooks/useAuth";
import {
  useActivityLogs,
  useActivityLogUsers,
  ACTIVITY_ACTION_LABEL,
  activityActionTone,
  type ActivityLogAction,
  type ActivityLogEntity,
} from "@/hooks/useActivityLogs";

const ENTITY_FILTER_OPTIONS: {
  value: ActivityLogEntity | "all";
  label: string;
}[] = [
  { value: "all", label: "Semua Entitas" },
  { value: "transaction", label: "Transaksi" },
  { value: "product", label: "Produk" },
];

const ACTION_FILTER_OPTIONS = Object.entries(ACTIVITY_ACTION_LABEL) as [
  ActivityLogAction,
  string,
][];

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

// Ringkasan `meta` (jsonb bebas per aksi — bentuknya beda-beda tergantung RPC
// yang menulis) jadi 1 baris teks kecil di bawah label aksi. Sengaja tidak
// coba tampilkan SEMUA isi meta sebagai JSON mentah (tidak enak dibaca kasir
// non-teknis) — cukup ambil field yang paling sering relevan kalau ada, sisanya
// diamkan. Kalau field yang dicari tidak ada, baris ini kosong saja, bukan error.
function summarizeMeta(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;

  const reason = typeof meta.reason === "string" ? meta.reason : null;
  const note = typeof meta.note === "string" ? meta.note : null;
  const receiptNo =
    typeof meta.receipt_no === "string" ? meta.receipt_no : null;
  const sku = typeof meta.sku === "string" ? meta.sku : null;

  const parts = [receiptNo, sku, reason ?? note].filter(
    (part): part is string => !!part,
  );

  return parts.length > 0 ? parts.join(" — ") : null;
}

const chipToneClass: Record<ReturnType<typeof activityActionTone>, string> = {
  destructive: "bg-lco-coral/10 text-lco-coral",
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  neutral: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

export default function LogAktivitasModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  // ── REVISI (migration 028/030) ── `user?.role` (string admin/supervisor)
  // sudah dihapus, diganti permission dinamis "log_aktivitas".
  const canAccessActivityLogs = hasPermission(user, "log_aktivitas");

  const [entityFilter, setEntityFilter] = useState<ActivityLogEntity | "all">(
    "all",
  );
  const [selectedActions, setSelectedActions] = useState<ActivityLogAction[]>(
    [],
  );
  const [userFilter, setUserFilter] = useState<string>("all");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");

  const { logs, isLoading, error } = useActivityLogs({
    entity: entityFilter === "all" ? null : entityFilter,
    userId: userFilter === "all" ? null : userFilter,
    actions: selectedActions.length > 0 ? selectedActions : undefined,
  });

  const { users } = useActivityLogUsers();

  function toggleAction(action: ActivityLogAction) {
    setSelectedActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
  }

  // Filter tanggal diterapkan di client (lihat catatan header) — dibandingkan
  // sebagai tanggal WIB, pola sama dengan dateKey() di hooks/useDashboard.ts,
  // supaya baris jam 00:00–06:59 WIB (dini hari) tidak salah masuk ke tanggal
  // sebelumnya akibat created_at tersimpan sebagai UTC.
  const filteredLogs = useMemo(() => {
    if (!dateStart && !dateEnd) return logs;

    return logs.filter((log) => {
      const localDateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(log.created_at));

      if (dateStart && localDateKey < dateStart) return false;
      if (dateEnd && localDateKey > dateEnd) return false;
      return true;
    });
  }, [logs, dateStart, dateEnd]);

  const hasActiveFilter =
    entityFilter !== "all" ||
    selectedActions.length > 0 ||
    userFilter !== "all" ||
    !!dateStart ||
    !!dateEnd;

  function resetFilters() {
    setEntityFilter("all");
    setSelectedActions([]);
    setUserFilter("all");
    setDateStart("");
    setDateEnd("");
  }

  // Sama seperti SampahModule.tsx: cabang loading-auth sendiri, DITARUH
  // SETELAH semua hook dipanggil (Rules of Hooks) supaya tidak mengulang bug
  // "kedipan" yang sudah diperbaiki di modul itu sebelum ini dibuat.
  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat...
        </div>
      </div>
    );
  }

  if (!canAccessActivityLogs) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Modul Log Aktivitas hanya untuk admin dan supervisor.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 dark:bg-zinc-950 md:p-6">
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Administrasi
        </p>

        <h2 className="text-2xl font-semibold tracking-tight">Log Aktivitas</h2>

        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Riwayat aksi sensitif — void, retur, opname/penyesuaian stok, hapus &
          pulihkan produk atau transaksi — beserta pelaku dan waktunya.
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Entitas
            </label>
            <select
              value={entityFilter}
              onChange={(e) =>
                setEntityFilter(e.target.value as ActivityLogEntity | "all")
              }
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {ENTITY_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              User Pelaku
            </label>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="all">Semua User</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || "(tanpa nama)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Dari Tanggal
            </label>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Sampai Tanggal
            </label>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Jenis Aksi
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ACTION_FILTER_OPTIONS.map(([action, label]) => {
              const isActive = selectedActions.includes(action);
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggleAction(action)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 ${
                    isActive
                      ? "border-lco-teal bg-lco-teal/10 text-lco-teal"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {hasActiveFilter && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Reset filter
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 border border-lco-coral/30 bg-white p-4 text-sm text-lco-coral dark:bg-zinc-950">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Gagal memuat Log Aktivitas</p>
            <p className="mt-1 break-all text-xs opacity-80">{error}</p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {isLoading ? (
          <div className="flex min-h-64 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat Log Aktivitas...
            </div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <ClipboardList className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold">Belum ada aktivitas</h3>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {hasActiveFilter
                ? "Tidak ada log yang cocok dengan filter saat ini."
                : "Belum ada aksi sensitif yang tercatat."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Waktu
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Aksi
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Entitas
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    User
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Keterangan
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {filteredLogs.map((log) => {
                  const tone = activityActionTone(log.action);
                  const actionLabel =
                    ACTIVITY_ACTION_LABEL[log.action as ActivityLogAction] ??
                    log.action;
                  const detail = summarizeMeta(log.meta);

                  return (
                    <tr
                      key={log.id}
                      className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {formatDateTime(log.created_at)}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${chipToneClass[tone]}`}
                        >
                          {actionLabel}
                        </span>
                      </td>

                      <td className="px-4 py-3 capitalize text-zinc-600 dark:text-zinc-400">
                        {log.entity === "transaction" ? "Transaksi" : "Produk"}
                      </td>

                      <td className="px-4 py-3">
                        {log.user_name || (
                          <span className="text-zinc-400">
                            (user tidak diketahui)
                          </span>
                        )}
                      </td>

                      <td className="max-w-xs truncate px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {detail || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
