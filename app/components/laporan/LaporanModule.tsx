"use client";

// app/components/laporan/LaporanModule.tsx
// ── TAMBAHAN (T-08) ── Modul Laporan (PRD §17 Fase E, §4.5, §4.7).
// Konsumen hooks/useReports.ts (data 3 sub-tab) + lib/pos/transactionApi.ts
// (upload bukti pelunasan, reuse fungsi yang sama dengan bukti pembayaran
// checkout, lihat parameter `proofType` yang ditambahkan untuk T-08 ini).
//
// Akses: **diasumsikan admin/supervisor saja** (sama seperti StokModule.tsx),
// BUKAN dikutip langsung dari teks PRD — lihat catatan ASUMSI di header
// hooks/useReports.ts. Kalau ternyata salah, tinggal ubah `canViewReports` di
// bawah, tidak perlu ubah hook.
//
// Pola UI sengaja disamakan dengan KasModule.tsx/StokModule.tsx (kartu status,
// tabel, modal, warna lco-teal/lco-coral/lco-mustard) supaya tidak ada dialek
// visual baru di codebase ini.
//
// Yang SENGAJA belum ada di sini (bukan bug, scope file terpisah):
// - Export Excel/PDF — tombol sudah disiapkan (lihat placeholder `onExport`)
//   tapi implementasinya (pakai `xlsx`/`jspdf`+`html-to-image`, sudah ada di
//   package.json) menyusul di file lib/pos/reportExport.ts terpisah, supaya
//   file ini tidak makin panjang.
// - `generateReceiptImage()` untuk share WA (disebut di rencana T-08 awal) —
//   itu bagian printLogic.ts, file terpisah juga.
// - Penyembunyian MENU Laporan dari Sidebar untuk kasir — itu di Sidebar.tsx +
//   page.tsx (file terpisah berikutnya), belum diubah di sini. Untuk sekarang
//   kalau kasir buka menu ini (kalau menu-nya sudah ditambahkan), yang menahan
//   cuma layar blokir di bawah, sama seperti pola StokModule.tsx sebelum T-10.

import { useMemo, useState, type ChangeEvent } from "react";
import {
  Loader2,
  AlertTriangle,
  Inbox,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
  CalendarDays,
  CheckCircle2,
  Clock,
  Upload,
  X,
  Download,
} from "lucide-react";
import {
  useReports,
  type ReportDatePreset,
  type DateRange,
  type ReceivableRow,
  type ReceivableStatus,
} from "@/hooks/useReports";
import { useAuth } from "@/hooks/useAuth";
import { formatRupiah } from "@/lib/pos/cartLogic";
import { uploadPaymentProofs } from "@/lib/pos/transactionApi";

type ReportTab = "harian" | "shift" | "piutang";

const TABS: { key: ReportTab; label: string; icon: typeof TrendingUp }[] = [
  { key: "harian", label: "Harian/Bulanan", icon: TrendingUp },
  { key: "shift", label: "Per Shift", icon: Users },
  { key: "piutang", label: "Piutang/Tempo", icon: Wallet },
];

const PRESETS: { key: ReportDatePreset; label: string }[] = [
  { key: "today", label: "Hari Ini" },
  { key: "7d", label: "7 Hari" },
  { key: "30d", label: "30 Hari" },
  { key: "this_month", label: "Bulan Ini" },
  { key: "last_month", label: "Bulan Lalu" },
  { key: "custom", label: "Custom" },
];

// ── Util tampilan ────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

function formatDateOnly(value: string | null): string {
  if (!value) return "-";
  // `value` dari kolom `date` Postgres ("YYYY-MM-DD") — parse manual komponennya,
  // JANGAN `new Date(value)` langsung (itu diparse sebagai UTC tengah malam,
  // bisa mundur 1 hari saat ditampilkan di WIB). Pola sama seperti catatan
  // waktu lokal di useDashboard.ts/useReports.ts.
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

/** Input `<input type="date">` → Date lokal (BUKAN `new Date(string)`, lihat catatan di atas). */
function parseDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function differenceColorClass(difference: number | null): string {
  if (difference === null) return "text-zinc-400";
  if (difference === 0) return "text-lco-teal";
  if (difference < 0) return "text-lco-coral";
  return "text-lco-mustard";
}

function differenceLabel(difference: number | null): string {
  if (difference === null) return "-";
  if (difference === 0) return `Pas — ${formatRupiah(0)}`;
  if (difference < 0) return `Kurang ${formatRupiah(Math.abs(difference))}`;
  return `Lebih ${formatRupiah(difference)}`;
}

const RECEIVABLE_BADGE: Record<
  ReceivableStatus,
  { label: string; className: string }
> = {
  LUNAS: {
    label: "Lunas",
    className: "bg-lco-teal/10 text-lco-teal border-lco-teal/30",
  },
  JATUH_TEMPO: {
    label: "Jatuh Tempo",
    className: "bg-lco-coral/10 text-lco-coral border-lco-coral/30",
  },
  BELUM_LUNAS: {
    label: "Belum Lunas",
    className:
      "bg-lco-mustard/20 text-zinc-700 dark:text-lco-mustard border-lco-mustard/40",
  },
};

// --------------------------------------------------------
// Filter tanggal (preset + custom)
// --------------------------------------------------------

function DateFilterBar({
  preset,
  dateRange,
  onChange,
}: {
  preset: ReportDatePreset;
  dateRange: DateRange;
  onChange: (preset: ReportDatePreset, customRange?: DateRange) => void;
}) {
  const [customStart, setCustomStart] = useState(
    toDateInputValue(dateRange.start),
  );
  const [customEnd, setCustomEnd] = useState(toDateInputValue(dateRange.end));
  const [customError, setCustomError] = useState<string | null>(null);

  const applyCustom = () => {
    const start = parseDateInputValue(customStart);
    const end = parseDateInputValue(customEnd);

    if (!start || !end) {
      setCustomError("Isi tanggal awal dan akhir.");
      return;
    }
    if (start > end) {
      setCustomError("Tanggal awal tidak boleh setelah tanggal akhir.");
      return;
    }
    setCustomError(null);
    onChange("custom", { start, end });
  };

  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => p.key !== "custom" && onChange(p.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
              preset === p.key
                ? "border-lco-teal bg-lco-teal/10 text-lco-teal"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Dari
            </label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-mono tabular-nums focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Sampai
            </label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-mono tabular-nums focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
          <button
            type="button"
            onClick={applyCustom}
            className="rounded-md bg-lco-green px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
          >
            Terapkan
          </button>
          {customError && (
            <p className="w-full text-xs text-lco-coral">{customError}</p>
          )}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
        <CalendarDays className="h-3.5 w-3.5" />
        {formatDateOnly(toDateInputValue(dateRange.start))} —{" "}
        {formatDateOnly(toDateInputValue(dateRange.end))}
      </p>
    </div>
  );
}

// --------------------------------------------------------
// Modal: Tandai Lunas
// --------------------------------------------------------

function SettleReceivableModal({
  receivable,
  onClose,
  onSettle,
}: {
  receivable: ReceivableRow;
  onClose: () => void;
  onSettle: (paymentId: string) => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(e.target.files ?? []));
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      // Urutan sengaja: tandai lunas DULU lewat RPC (itu yang mengunci status),
      // baru upload bukti (opsional). Kalau upload gagal, status lunas tetap
      // tersimpan — bukti bisa diupload ulang lain kali, tapi piutang yang
      // sudah dibayar tidak boleh "ke-block" cuma gara-gara upload foto gagal.
      await onSettle(receivable.payment_id);

      if (files.length > 0) {
        await uploadPaymentProofs(receivable.payment_id, files, "settlement");
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menandai lunas.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-4 w-4 text-lco-teal" />
            Tandai Lunas
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 transition-colors duration-150 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-lco-teal/30 bg-lco-teal/10 p-3 text-xs text-lco-teal">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Piutang {receivable.receipt_no} berhasil ditandai lunas.
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
            >
              Selesai
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 space-y-1 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
              <div className="flex justify-between">
                <span className="text-zinc-500">Struk</span>
                <span className="font-mono">{receivable.receipt_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Pelanggan</span>
                <span>{receivable.customer_name ?? "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Nominal</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatRupiah(receivable.amount)}
                </span>
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Bukti pelunasan (opsional)
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-4 text-xs text-zinc-500 transition-colors duration-150 hover:border-lco-teal hover:text-lco-teal dark:border-zinc-700">
              <Upload className="h-4 w-4" />
              {files.length > 0
                ? `${files.length} file dipilih`
                : "Pilih foto/PDF bukti transfer"}
              <input
                type="file"
                accept="image/*,.pdf"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Tandai Lunas
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------
// Sub-tab: Harian/Bulanan
// --------------------------------------------------------

function HarianBulananTab({
  summary,
  daily,
}: {
  summary: ReturnType<typeof useReports>["salesSummary"];
  daily: ReturnType<typeof useReports>["dailySales"];
}) {
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Omzet
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {formatRupiah(summary.revenue)}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Transaksi
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {summary.transactionCount}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Item Terjual
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {summary.itemsSold}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Rata-rata/Transaksi
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {formatRupiah(summary.averageTicket)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Tanggal
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Omzet
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Transaksi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {daily.map((point) => (
              <tr key={point.date}>
                <td className="px-5 py-2.5 text-xs">{point.label}</td>
                <td
                  className={`px-5 py-2.5 font-mono text-xs tabular-nums ${
                    point.revenue < 0 ? "text-lco-coral" : ""
                  }`}
                >
                  {formatRupiah(point.revenue)}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs tabular-nums">
                  {point.transactionCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --------------------------------------------------------
// Sub-tab: Per Shift
// --------------------------------------------------------

function PerShiftTab({
  shifts,
}: {
  shifts: ReturnType<typeof useReports>["shifts"];
}) {
  if (shifts.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-zinc-200 px-6 text-center dark:border-zinc-800">
        <Inbox className="mb-2 h-6 w-6 text-zinc-400" />
        <p className="text-sm text-zinc-500">
          Tidak ada shift pada rentang tanggal ini.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full whitespace-nowrap text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Kasir
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Dibuka
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Ditutup
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Status
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Modal Awal
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Selisih
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {shifts.map((shift) => (
            <tr key={shift.id}>
              <td className="px-5 py-3 text-xs font-medium">
                {shift.cashier_name ?? "-"}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {formatDateTime(shift.opened_at)}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {shift.closed_at ? formatDateTime(shift.closed_at) : "-"}
              </td>
              <td className="px-5 py-3 text-xs">
                {shift.status === "OPEN" ? (
                  <span className="rounded-full border border-lco-mustard/40 bg-lco-mustard/20 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:text-lco-mustard">
                    Belum Ditutup
                  </span>
                ) : (
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                    Selesai
                  </span>
                )}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {formatRupiah(shift.opening_cash)}
              </td>
              <td
                className={`px-5 py-3 font-mono text-xs font-medium tabular-nums ${differenceColorClass(shift.difference)}`}
              >
                {differenceLabel(shift.difference)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------
// Sub-tab: Piutang/Tempo
// --------------------------------------------------------

function PiutangTab({
  receivables,
  onSettle,
}: {
  receivables: ReceivableRow[];
  onSettle: (paymentId: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<ReceivableRow | null>(null);

  if (receivables.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-zinc-200 px-6 text-center dark:border-zinc-800">
        <Inbox className="mb-2 h-6 w-6 text-zinc-400" />
        <p className="text-sm text-zinc-500">
          Tidak ada piutang TEMPO — baik yang belum lunas maupun yang lunas 30
          hari terakhir.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Struk
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Pelanggan
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Jatuh Tempo
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Nominal
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Status
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {receivables.map((row) => {
              const badge = RECEIVABLE_BADGE[row.status];
              return (
                <tr key={row.payment_id}>
                  <td className="px-5 py-3 font-mono text-xs">
                    {row.receipt_no}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {row.customer_name ?? "-"}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs tabular-nums">
                    {formatDateOnly(row.due_date)}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs font-semibold tabular-nums">
                    {formatRupiah(row.amount)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!row.is_settled && (
                      <button
                        type="button"
                        onClick={() => setTarget(row)}
                        className="rounded-md bg-lco-green px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
                      >
                        Tandai Lunas
                      </button>
                    )}
                    {row.is_settled && row.settled_at && (
                      <span className="flex items-center justify-end gap-1 text-[11px] text-zinc-400">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(row.settled_at)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {target && (
        <SettleReceivableModal
          receivable={target}
          onClose={() => setTarget(null)}
          onSettle={onSettle}
        />
      )}
    </>
  );
}

// --------------------------------------------------------
// Modul utama
// --------------------------------------------------------

export default function LaporanModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    dateRange,
    preset,
    setPreset,
    salesSummary,
    dailySales,
    shifts,
    receivables,
    isLoading,
    error,
    settleReceivable,
  } = useReports();

  const [activeTab, setActiveTab] = useState<ReportTab>("harian");

  // Lihat catatan ASUMSI di header file & hooks/useReports.ts.
  const canViewReports = user?.role === "admin" || user?.role === "supervisor";

  const receivablesUnsettledCount = useMemo(
    () => receivables.filter((r) => !r.is_settled).length,
    [receivables],
  );

  if (!isAuthLoading && !canViewReports) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Modul Laporan hanya untuk supervisor dan admin. Hubungi admin kalau
          Anda memang perlu melihat laporan ini.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Laporan
          </p>
          <h2 className="text-xl font-semibold tracking-tight">Laporan</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Omzet, riwayat shift, dan piutang tempo — pilih rentang tanggal di
            bawah.
          </p>
        </div>

        {/* Placeholder export — implementasi menyusul di file lib/pos/reportExport.ts */}
        <button
          type="button"
          disabled
          title="Export Excel/PDF menyusul di file berikutnya"
          className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
      </div>

      <DateFilterBar
        preset={preset}
        dateRange={dateRange}
        onChange={setPreset}
      />

      <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors duration-150 ${
              activeTab === key
                ? "border-lco-teal text-lco-teal"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {key === "piutang" && receivablesUnsettledCount > 0 && (
              <span className="rounded-full bg-lco-coral px-1.5 text-[10px] font-bold text-white">
                {receivablesUnsettledCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat data laporan...
        </div>
      ) : (
        <>
          {activeTab === "harian" && (
            <HarianBulananTab summary={salesSummary} daily={dailySales} />
          )}
          {activeTab === "shift" && <PerShiftTab shifts={shifts} />}
          {activeTab === "piutang" && (
            <PiutangTab receivables={receivables} onSettle={settleReceivable} />
          )}
        </>
      )}
    </div>
  );
}
