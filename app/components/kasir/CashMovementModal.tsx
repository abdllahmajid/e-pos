"use client";

// ── TAMBAHAN (migration 040) ── Modal pencatatan kas masuk / kas keluar dari
// laci. Dipakai di layar Kasir (tombol "Kas Masuk/Keluar" di bar atas) dan di
// menu Kas & Shift — komponennya sama, supaya aturan isian & tampilannya sama.
//
// Sengaja "bodoh" (pola sama dengan CloseShiftModal): tidak tahu soal Supabase.
// Penyimpanan dikerjakan `onSubmit` dari pemanggil (hook useCashMovements) yang
// melempar Error berisi pesan server kalau ditolak — pesannya ditampilkan di sini.
//
// Selama menyimpan: semua isian & tombol dikunci, tombol utama menampilkan
// spinner + "Menyimpan...". Setelah sukses: layar konfirmasi (bukan langsung
// menutup) supaya kasir yakin catatannya tersimpan, dengan pilihan "Catat Lagi".

import { useMemo, useState } from "react";
import {
  Banknote,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  X,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import {
  CASH_CATEGORIES,
  validateCashMovement,
  type AddCashMovementParams,
  type CashCategory,
  type CashMovementType,
} from "@/hooks/useCashMovements";

interface CashMovementModalProps {
  onClose: () => void;
  /** Simpan catatan. Dilempar Error (pesan server) kalau ditolak — ditampilkan di modal. */
  onSubmit: (params: AddCashMovementParams) => Promise<void>;
  /** Jenis yang terpilih saat modal dibuka. Default: kas keluar (yang paling sering). */
  initialType?: CashMovementType;
}

export function CashMovementModal({
  onClose,
  onSubmit,
  initialType = "OUT",
}: CashMovementModalProps) {
  const [type, setType] = useState<CashMovementType>(initialType);
  const [amountInput, setAmountInput] = useState("");
  const [category, setCategory] = useState<CashCategory>(
    CASH_CATEGORIES[initialType][0].value,
  );
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    type: CashMovementType;
    amount: number;
  } | null>(null);

  const amount = Number(amountInput) || 0;
  const options = CASH_CATEGORIES[type];
  const selectedOption = options.find((option) => option.value === category);

  const validationMessage = useMemo(
    () => validateCashMovement({ type, amount, category, note }),
    [type, amount, category, note],
  );

  const handleTypeChange = (next: CashMovementType) => {
    if (isSubmitting || next === type) return;
    setType(next);
    // Kategori milik jenis lama tidak berlaku di jenis baru.
    setCategory(CASH_CATEGORIES[next][0].value);
    setError(null);
  };

  const handleSubmit = async () => {
    if (isSubmitting || validationMessage) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({ type, amount, category, note: note.trim() });
      setSaved({ type, amount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mencatat kas.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordAnother = () => {
    setSaved(null);
    setAmountInput("");
    setNote("");
    setError(null);
    setCategory(CASH_CATEGORIES[type][0].value);
  };

  const isOut = type === "OUT";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-label="Catat kas masuk atau keluar"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950 max-h-[90vh] overflow-y-auto"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Banknote className="h-4 w-4 text-lco-teal" />
            Kas Masuk / Keluar
          </h3>
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

        {saved ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-lco-teal/30 bg-lco-teal/5 p-4 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-lco-teal" />
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {saved.type === "IN" ? "Kas masuk" : "Kas keluar"}{" "}
                  <span className="font-mono tabular-nums">
                    {formatRupiah(saved.amount)}
                  </span>{" "}
                  tercatat
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Sudah masuk perhitungan kas shift ini. Kalau ada yang salah,
                  batalkan dari menu Kas &amp; Shift.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRecordAnother}
                className="flex-1 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition-colors duration-150 hover:border-lco-teal hover:text-lco-teal dark:border-zinc-700 dark:text-zinc-200"
              >
                Catat Lagi
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
              >
                Selesai
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-4 text-xs text-zinc-500">
              Catat uang yang keluar atau masuk laci di luar penjualan, supaya
              tidak muncul sebagai selisih kas saat tutup shift.
            </p>

            <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label="Jenis kas">
              <button
                type="button"
                onClick={() => handleTypeChange("IN")}
                disabled={isSubmitting}
                aria-pressed={!isOut}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors duration-150 disabled:opacity-60 ${
                  !isOut
                    ? "border-lco-teal bg-lco-teal/5 text-lco-teal"
                    : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-800"
                }`}
              >
                <ArrowDownLeft className="h-4 w-4" />
                Kas Masuk
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange("OUT")}
                disabled={isSubmitting}
                aria-pressed={isOut}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors duration-150 disabled:opacity-60 ${
                  isOut
                    ? "border-lco-coral/50 bg-lco-coral/5 text-lco-coral"
                    : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-800"
                }`}
              >
                <ArrowUpRight className="h-4 w-4" />
                Kas Keluar
              </button>
            </div>

            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Nominal
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={amountInput}
              disabled={isSubmitting}
              onChange={(e) =>
                setAmountInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))
              }
              aria-label="Nominal"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-right font-mono text-base tabular-nums transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <p className="mt-1 h-4 text-right font-mono text-xs tabular-nums text-zinc-400">
              {amount > 0 ? formatRupiah(amount) : ""}
            </p>

            <label className="mb-1 mt-2 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Kategori
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Kategori">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCategory(option.value)}
                  disabled={isSubmitting}
                  aria-pressed={category === option.value}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 disabled:opacity-60 ${
                    category === option.value
                      ? "border-lco-teal bg-lco-teal/5 text-lco-teal"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {selectedOption && (
              <p className="mt-1.5 text-xs text-zinc-400">{selectedOption.hint}</p>
            )}

            <label className="mb-1 mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Keterangan (wajib)
            </label>
            <textarea
              rows={2}
              value={note}
              disabled={isSubmitting}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                isOut
                  ? "mis. beli galon untuk dispenser"
                  : "mis. tukar uang kecil dari bank"
              }
              aria-label="Keterangan"
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

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || Boolean(validationMessage)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>Catat {isOut ? "Kas Keluar" : "Kas Masuk"}</>
              )}
            </button>
            {amount > 0 && validationMessage && !isSubmitting && (
              <p className="mt-2 text-center text-xs text-zinc-400">
                {validationMessage}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
