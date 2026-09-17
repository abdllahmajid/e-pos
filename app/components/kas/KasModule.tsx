"use client";

// ── TAMBAHAN (T-04) ── Modul Kas & Shift (PRD §17 T-04 + §4.6).
// Konsumen hooks/useShifts.ts (buka/tutup shift) & hooks/useSettings.ts (modal awal
// default dari `shift_default_cash`). Tema & pola UI disamakan dengan modul lain
// (TransactionHistoryModule.tsx untuk tabel riwayat, KasirModule.tsx untuk pola modal).
//
// Yang SENGAJA belum ada di sini (bukan bug, scope task lain):
// - Setoran ke bank/kantor (cash_movements) — "Jangan dulu" eksplisit di PRD §17 T-04,
//   boleh menyusul kalau ada waktu tapi tidak dikerjakan sekarang.
// - Cetak laporan shift A6/PDF (disebut di §4.6) — di luar Definition of Done T-04,
//   akan reuse printLogic.ts pola printA6Nota kalau dikerjakan nanti.
// - Monitoring realtime semua shift kasir lain oleh admin — fase 1.1 (§17 "Jangan dulu").
//   Riwayat di bawah ini HANYA shift milik user yang sedang login.

import { useMemo, useState } from "react";
import {
  Wallet,
  Lock,
  Unlock,
  Loader2,
  AlertTriangle,
  Clock,
  X,
  Inbox,
} from "lucide-react";
import { useShifts, type ShiftSession } from "@/hooks/useShifts";
import { useSettings } from "@/hooks/useSettings";
import { formatRupiah } from "@/lib/pos/cartLogic";

// Pecahan uang tunai Rupiah yang beredar, dari besar ke kecil.
const DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100];

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

/** Warna teks selisih kas: nol = teal (aman), kurang = coral, lebih = mustard. */
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

// --------------------------------------------------------
// Modal: Buka Shift
// --------------------------------------------------------

function OpenShiftModal({
  defaultOpeningCash,
  onClose,
  onSubmit,
}: {
  defaultOpeningCash: number;
  onClose: () => void;
  onSubmit: (openingCash: number) => Promise<void>;
}) {
  const [openingCash, setOpeningCash] = useState(String(defaultOpeningCash));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = Number(openingCash.replace(/[^0-9]/g, "")) || 0;

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(parsedAmount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuka shift.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Unlock className="h-4 w-4 text-lco-teal" />
            Buka Shift
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors duration-150"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-zinc-500">
          Modal awal kas
        </label>
        <input
          type="text"
          inputMode="numeric"
          value={openingCash}
          onChange={(e) => setOpeningCash(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono tabular-nums focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950 transition-colors duration-150"
          placeholder="0"
        />
        <p className="mt-1 text-[11px] text-zinc-400">
          {formatRupiah(parsedAmount)} — default diambil dari Pengaturan
          (shift_default_cash).
        </p>

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
            <Unlock className="h-4 w-4" />
          )}
          Buka Shift
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------
// Modal: Tutup Shift — hitung pecahan uang
// --------------------------------------------------------

function CloseShiftModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (actualCash: number) => Promise<{
    expected_cash: number;
    actual_cash: number;
    difference: number;
  }>;
}) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    expected_cash: number;
    actual_cash: number;
    difference: number;
  } | null>(null);

  const actualCash = useMemo(() => {
    return DENOMINATIONS.reduce((total, denom) => {
      const qty = Number(counts[denom]) || 0;
      return total + denom * qty;
    }, 0);
  }, [counts]);

  const handleCountChange = (denom: number, value: string) => {
    const digitsOnly = value.replace(/[^0-9]/g, "");
    setCounts((prev) => ({ ...prev, [denom]: digitsOnly }));
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await onSubmit(actualCash);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menutup shift.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4 text-lco-coral" />
            Tutup Shift
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors duration-150"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">
              Shift ditutup. Ringkasan selisih kas:
            </p>
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Kas seharusnya</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(result.expected_cash)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Kas fisik</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(result.actual_cash)}
                </span>
              </div>
              <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-2">
                <span className="text-zinc-500">Selisih</span>
                <span
                  className={`font-mono tabular-nums font-semibold ${differenceColorClass(result.difference)}`}
                >
                  {differenceLabel(result.difference)}
                </span>
              </div>
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
            <p className="mb-3 text-xs text-zinc-500">
              Hitung uang fisik di laci per pecahan. Selisih dihitung otomatis
              oleh sistem.
            </p>

            <div className="space-y-2">
              {DENOMINATIONS.map((denom) => (
                <div key={denom} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 font-mono tabular-nums text-sm text-zinc-600 dark:text-zinc-400">
                    {formatRupiah(denom)}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={counts[denom] ?? ""}
                    onChange={(e) => handleCountChange(denom, e.target.value)}
                    className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm font-mono tabular-nums text-right focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950 transition-colors duration-150"
                  />
                  <span className="flex-1 text-right font-mono tabular-nums text-sm text-zinc-400">
                    {formatRupiah(denom * (Number(counts[denom]) || 0))}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 text-sm font-semibold">
              <span>Total kas fisik</span>
              <span className="font-mono tabular-nums">
                {formatRupiah(actualCash)}
              </span>
            </div>

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
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-lco-coral px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              Tutup Shift
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------
// Modul utama
// --------------------------------------------------------

export default function KasModule() {
  const { activeShift, history, isLoading, error, openShift, closeShift } =
    useShifts();
  const { settings } = useSettings();

  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-950 p-4 md:p-6 text-zinc-900 dark:text-zinc-100 overflow-y-auto">
      <div className="mb-6">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Alat Kasir
        </p>
        <h2 className="text-xl font-semibold tracking-tight">Kas & Shift</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Buka shift dengan modal awal, tutup shift dengan hitung pecahan untuk
          selisih kas otomatis.
        </p>
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
          Memuat status shift...
        </div>
      ) : activeShift ? (
        <div className="mb-6 rounded-xl border border-lco-teal/30 bg-lco-teal/5 p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-lco-teal text-xs font-semibold uppercase tracking-[0.12em]">
                <Wallet className="h-4 w-4" />
                Shift Sedang Berjalan
              </div>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Dibuka {formatDateTime(activeShift.opened_at)}
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Modal awal:{" "}
                <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {formatRupiah(activeShift.opening_cash)}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCloseModalOpen(true)}
              className="flex items-center justify-center gap-2 rounded-md bg-lco-coral px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90"
            >
              <Lock className="h-4 w-4" />
              Tutup Shift
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-zinc-500 text-xs font-semibold uppercase tracking-[0.12em]">
                <Wallet className="h-4 w-4" />
                Belum Ada Shift Aktif
              </div>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Buka shift dulu sebelum bisa memakai layar Kasir.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpenModalOpen(true)}
              className="flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
            >
              <Unlock className="h-4 w-4" />
              Buka Shift
            </button>
          </div>
        </div>
      )}

      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
        Riwayat Shift
      </h3>

      <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800">
        {history.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <Inbox className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold">Belum ada riwayat shift</h3>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Shift yang sudah ditutup akan muncul di sini.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Dibuka
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Ditutup
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Modal Awal
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Kas Seharusnya
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Kas Fisik
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Selisih
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {history.map((shift: ShiftSession) => (
                <tr key={shift.id}>
                  <td className="px-5 py-3 font-mono tabular-nums text-xs">
                    {formatDateTime(shift.opened_at)}
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-xs">
                    {shift.closed_at ? formatDateTime(shift.closed_at) : "-"}
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-xs">
                    {formatRupiah(shift.opening_cash)}
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-xs">
                    {shift.expected_cash !== null
                      ? formatRupiah(shift.expected_cash)
                      : "-"}
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-xs">
                    {shift.actual_cash !== null
                      ? formatRupiah(shift.actual_cash)
                      : "-"}
                  </td>
                  <td
                    className={`px-5 py-3 font-mono tabular-nums text-xs font-medium ${differenceColorClass(shift.difference)}`}
                  >
                    {differenceLabel(shift.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isOpenModalOpen && (
        <OpenShiftModal
          defaultOpeningCash={settings.shiftDefaultCash}
          onClose={() => setIsOpenModalOpen(false)}
          onSubmit={openShift}
        />
      )}

      {isCloseModalOpen && (
        <CloseShiftModal
          onClose={() => setIsCloseModalOpen(false)}
          onSubmit={closeShift}
        />
      )}
    </div>
  );
}
