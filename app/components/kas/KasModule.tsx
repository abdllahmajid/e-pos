"use client";

// ── TAMBAHAN (T-04) ── Modul Kas & Shift (PRD §17 T-04 + §4.6).
// ── PERUBAHAN (buka/tutup shift pindah ke layar Kasir) ── Menu ini sekarang
// READ-ONLY: hanya menampilkan shift yang sedang berjalan + riwayat shift.
// Tombol Buka Shift & Tutup Shift (beserta modal modal awal & hitung pecahan)
// dipindah sepenuhnya ke layar Kasir — lihat KasirModule.tsx &
// kasir/CloseShiftModal.tsx. Konsumen hooks/useShifts.ts (baca saja).
//
// ── TAMBAHAN (migration 040) ── Kas masuk & kas keluar dari laci (tabel
// cash_movements) kini ada: catat dari sini atau dari tombol "Kas Masuk/Keluar"
// di layar Kasir, lihat daftar catatan shift berjalan, dan batalkan catatan yang
// salah (alasan wajib, hanya selama shift masih berjalan). Menu ini SENGAJA
// tidak menampilkan "kas seharusnya" shift yang sedang berjalan — penutupan kas
// dibuat "buta"; angka itu baru muncul di ringkasan setelah shift ditutup.
//
// Yang SENGAJA belum ada di sini (bukan bug, scope task lain):
// - Cetak laporan shift A6/PDF (disebut di §4.6) — di luar Definition of Done T-04.
// - Monitoring realtime semua shift kasir lain oleh admin — fase 1.1 (§17 "Jangan dulu").
//   Riwayat di bawah ini HANYA shift milik user yang sedang login.

import { useState } from "react";
import {
  Wallet,
  Loader2,
  AlertTriangle,
  Clock,
  Inbox,
  Banknote,
  ArrowDownLeft,
  ArrowUpRight,
  X,
} from "lucide-react";
import { useShifts, type ShiftSession } from "@/hooks/useShifts";
import {
  useCashMovements,
  useCashTotalsByShift,
  categoryLabel,
  type CashMovement,
} from "@/hooks/useCashMovements";
import { CashMovementModal } from "@/app/components/kasir/CashMovementModal";
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
// Modal: batalkan satu catatan kas (alasan wajib)
// --------------------------------------------------------

function VoidCashMovementModal({
  movement,
  onClose,
  onConfirm,
}: {
  movement: CashMovement;
  onClose: () => void;
  /** Dilempar Error (pesan server) kalau ditolak — ditampilkan di modal. */
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = reason.trim().length >= 3;

  const handleConfirm = async () => {
    if (isSubmitting || !isValid) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan catatan kas.");
      setIsSubmitting(false);
    }
    // Sukses: pemanggil menutup modal ini (komponen ter-unmount), jadi tidak
    // ada setState lagi di sini.
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-label="Batalkan catatan kas"
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Batalkan Catatan Kas</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Tutup"
            className="text-zinc-400 transition-colors duration-150 hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {movement.type === "IN" ? "Kas masuk" : "Kas keluar"} ·{" "}
            {categoryLabel(movement.category)} ·{" "}
            <span className="font-mono tabular-nums">
              {formatRupiah(movement.amount)}
            </span>
          </p>
          <p className="mt-1 text-zinc-500">{movement.note}</p>
        </div>

        <p className="mb-2 text-xs text-zinc-500">
          Catatan yang dibatalkan tidak dihitung lagi di kas shift ini, tetapi
          tetap tersimpan di riwayat dan Log Aktivitas.
        </p>

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Alasan pembatalan (wajib)
        </label>
        <textarea
          rows={2}
          value={reason}
          disabled={isSubmitting}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Alasan pembatalan"
          className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
        />

        {error && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition-colors duration-150 hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200"
          >
            Kembali
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !isValid}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-lco-coral/40 bg-lco-coral/5 px-4 py-2.5 text-sm font-semibold text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Membatalkan...
              </>
            ) : (
              "Batalkan Catatan"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------
// Modul utama
// --------------------------------------------------------

export default function KasModule() {
  const { activeShift, history, isLoading, error } = useShifts();
  const {
    movements,
    summary,
    isLoading: isMovementsLoading,
    error: movementsError,
    addMovement,
    voidMovement,
  } = useCashMovements(activeShift?.id ?? null);
  // Total kas masuk/keluar per shift untuk tabel riwayat (kosong selagi memuat).
  const cashTotalsByShift = useCashTotalsByShift(history.map((shift) => shift.id));
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<CashMovement | null>(null);

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
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Kas masuk:{" "}
                <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {formatRupiah(summary.cashIn)}
                </span>
                {" · "}Kas keluar:{" "}
                <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {formatRupiah(summary.cashOut)}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCashModalOpen(true)}
              className="flex shrink-0 items-center gap-2 self-start rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors duration-150 hover:border-lco-teal hover:text-lco-teal dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 md:self-center"
            >
              <Banknote className="h-3.5 w-3.5" />
              Catat Kas Masuk/Keluar
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
                Shift dibuka lewat tombol Buka Kasir di layar Kasir.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeShift && !isLoading && (
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Kas Masuk/Keluar Shift Ini
          </h3>

          {movementsError && (
            <div className="mb-3 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {movementsError}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            {isMovementsLoading && movements.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat catatan kas...
              </div>
            ) : movements.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Belum ada kas masuk/keluar di shift ini.
              </p>
            ) : (
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    {["Waktu", "Jenis", "Kategori", "Keterangan", "Nominal", ""].map(
                      (label, index) => (
                        <th
                          key={index}
                          className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
                        >
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {movements.map((movement) => {
                    const isVoided = Boolean(movement.voided_at);
                    return (
                      <tr key={movement.id} className={isVoided ? "opacity-60" : ""}>
                        <td className="px-5 py-3 font-mono text-xs tabular-nums">
                          {formatDateTime(movement.created_at)}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              movement.type === "IN"
                                ? "bg-lco-teal/10 text-lco-teal"
                                : "bg-lco-coral/10 text-lco-coral"
                            }`}
                          >
                            {movement.type === "IN" ? (
                              <ArrowDownLeft className="h-3 w-3" />
                            ) : (
                              <ArrowUpRight className="h-3 w-3" />
                            )}
                            {movement.type === "IN" ? "Masuk" : "Keluar"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs">
                          {categoryLabel(movement.category)}
                        </td>
                        <td className="max-w-xs whitespace-normal px-5 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                          {movement.note}
                          {isVoided && (
                            <span className="mt-0.5 block text-[11px] text-zinc-400">
                              Dibatalkan: {movement.void_reason}
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-5 py-3 font-mono text-xs font-medium tabular-nums ${
                            isVoided ? "line-through" : ""
                          }`}
                        >
                          {formatRupiah(movement.amount)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {!isVoided && (
                            <button
                              type="button"
                              onClick={() => setVoidTarget(movement)}
                              className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 transition-colors duration-150 hover:border-lco-coral/40 hover:text-lco-coral dark:border-zinc-800 dark:text-zinc-300"
                            >
                              Batalkan
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {isCashModalOpen && (
        <CashMovementModal
          onClose={() => setIsCashModalOpen(false)}
          onSubmit={addMovement}
        />
      )}
      {voidTarget && (
        <VoidCashMovementModal
          movement={voidTarget}
          onClose={() => setVoidTarget(null)}
          onConfirm={async (reason) => {
            await voidMovement(voidTarget.id, reason);
            setVoidTarget(null);
          }}
        />
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
                  Kas Masuk
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Kas Keluar
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
                    {cashTotalsByShift[shift.id]
                      ? formatRupiah(cashTotalsByShift[shift.id].cashIn)
                      : "-"}
                  </td>
                  <td className="px-5 py-3 font-mono tabular-nums text-xs">
                    {cashTotalsByShift[shift.id]
                      ? formatRupiah(cashTotalsByShift[shift.id].cashOut)
                      : "-"}
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
