"use client";

// ── TAMBAHAN (T-04) ── Modul Kas & Shift (PRD §17 T-04 + §4.6).
// ── PERUBAHAN (buka/tutup shift pindah ke layar Kasir) ── Menu ini sekarang
// READ-ONLY: hanya menampilkan shift yang sedang berjalan + riwayat shift.
// Tombol Buka Shift & Tutup Shift (beserta modal modal awal & hitung pecahan)
// dipindah sepenuhnya ke layar Kasir — lihat KasirModule.tsx &
// kasir/CloseShiftModal.tsx. Konsumen hooks/useShifts.ts (baca saja).
//
// Yang SENGAJA belum ada di sini (bukan bug, scope task lain):
// - Setoran ke bank/kantor (cash_movements) — "Jangan dulu" eksplisit di PRD §17 T-04.
// - Cetak laporan shift A6/PDF (disebut di §4.6) — di luar Definition of Done T-04.
// - Monitoring realtime semua shift kasir lain oleh admin — fase 1.1 (§17 "Jangan dulu").
//   Riwayat di bawah ini HANYA shift milik user yang sedang login.

import { Wallet, Loader2, AlertTriangle, Clock, Inbox } from "lucide-react";
import { useShifts, type ShiftSession } from "@/hooks/useShifts";
import { formatRupiah } from "@/lib/pos/cartLogic";
import {
  differenceColorClass,
  differenceLabel,
} from "@/app/components/kasir/CloseShiftModal";

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

// --------------------------------------------------------
// Modul utama
// --------------------------------------------------------

export default function KasModule() {
  const { activeShift, history, isLoading, error } = useShifts();

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-950 p-4 md:p-6 text-zinc-900 dark:text-zinc-100 overflow-y-auto">
      <div className="mb-6">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Alat Kasir
        </p>
        <h2 className="text-xl font-semibold tracking-tight">Kas & Shift</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Shift yang sedang berjalan dan riwayat shift Anda. Buka & tutup shift
          dilakukan dari layar Kasir.
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
                Shift dibuka lewat tombol Buka Kasir di layar Kasir.
              </p>
            </div>
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
    </div>
  );
}
