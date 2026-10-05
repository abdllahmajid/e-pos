"use client";

// ── TAMBAHAN (menu Pelanggan) ── Penyesuaian poin manual (tambah/kurangi).
// Alasan WAJIB (jadi jejak audit di customer_point_logs + activity_logs).
// Validasi akhir (saldo tidak boleh negatif) ada di RPC adjust_customer_points.

import { useState } from "react";
import { Loader2, Minus, Plus, X } from "lucide-react";
import type { CustomerRecord } from "@/hooks/useCustomerAdmin";

interface PoinAdjustModalProps {
  customer: CustomerRecord;
  /** Nilai 1 poin dalam rupiah (sama dengan LOYALTY_POINT_VALUE di Kasir). */
  pointValue: number;
  onClose: () => void;
  onSubmit: (delta: number, reason: string) => Promise<void>;
}

const REASON_PRESETS = [
  "Bonus loyalitas",
  "Kompensasi / komplain",
  "Koreksi kesalahan input",
  "Poin kedaluwarsa",
];

export default function PoinAdjustModal({
  customer,
  pointValue,
  onClose,
  onSubmit,
}: PoinAdjustModalProps) {
  const [mode, setMode] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsed = Math.floor(Number(amount));
  const validAmount = Number.isFinite(parsed) && parsed > 0;
  const delta = validAmount ? (mode === "add" ? parsed : -parsed) : 0;
  const after = customer.loyalty_points + delta;

  async function handleSubmit() {
    setError("");
    if (!validAmount) {
      setError("Masukkan jumlah poin lebih dari 0.");
      return;
    }
    if (after < 0) {
      setError("Poin tidak cukup untuk dikurangi sebanyak itu.");
      return;
    }
    if (!reason.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(delta, reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Sesuaikan Poin
            </h3>
            <p className="text-xs text-zinc-500">{customer.name}</p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("add")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "add"
                  ? "border-lco-teal bg-lco-teal/10 text-lco-green dark:text-lco-teal"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              <Plus className="h-4 w-4" /> Tambah
            </button>
            <button
              type="button"
              onClick={() => setMode("subtract")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "subtract"
                  ? "border-lco-coral bg-lco-coral/10 text-lco-coral"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              <Minus className="h-4 w-4" /> Kurangi
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Jumlah poin
            </label>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              placeholder="0"
              autoFocus
            />
            <p className="mt-1 text-xs text-zinc-500">
              Saldo sekarang <strong>{customer.loyalty_points}</strong> poin
              {validAmount && (
                <>
                  {" "}
                  → <strong>{Math.max(after, 0)}</strong> poin (setara Rp{" "}
                  {(Math.max(after, 0) * pointValue).toLocaleString("id-ID")})
                </>
              )}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Alasan <span className="text-lco-coral">*</span>
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              placeholder="Mengapa poin diubah?"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASON_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 hover:border-lco-teal hover:text-lco-green dark:border-zinc-700 dark:text-zinc-400"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-lco-green px-4 py-2 text-sm font-semibold text-white hover:bg-lco-green-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
