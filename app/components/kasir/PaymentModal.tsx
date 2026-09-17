"use client";

// ── KOREKSI ── Bug kritis: versi sebelumnya menampilkan layar "Pembayaran Berhasil!"
// via setTimeout PALSU sebelum transaksi benar-benar disimpan ke server (onSuccess dipanggil
// tanpa di-await, lalu modal langsung ditutup). Kalau createTransaction() gagal (mis. stok
// tidak cukup — PRD AC4), user sudah terlanjur melihat pesan sukses. Sekarang:
// - Prop diganti jadi onConfirmPayment: async, HARUS throw kalau gagal.
// - Modal menunggu (await) hasil asli sebelum menampilkan layar sukses.
// - Kalau gagal, modal TETAP TERBUKA dengan pesan error, user bisa coba lagi.
// - Modal sendiri yang memanggil onClose() setelah animasi sukses selesai (bukan parent
//   yang menutup modal duluan), supaya layar sukses sempat terlihat.

import { useState, useEffect } from "react";
import {
  X,
  Wallet,
  Building2,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from "lucide-react";

type PaymentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  total: number;
  /**
   * Wajib async dan HARUS throw Error kalau transaksi gagal disimpan.
   * Modal menunggu promise ini sebelum menampilkan layar sukses.
   */
  onConfirmPayment: (
    method: string,
    paidAmount: number,
    change: number,
  ) => Promise<void>;
};

export default function PaymentModal({
  isOpen,
  onClose,
  total,
  onConfirmPayment,
}: PaymentModalProps) {
  const [method, setMethod] = useState<"tunai" | "transfer">("tunai");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMethod("tunai");
      setPaidAmount(0);
      setIsProcessing(false);
      setIsSuccess(false);
      setLocalError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatRp = (angka: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(angka);
  };

  const changeAmount = paidAmount - total;
  const isPayable = method === "tunai" ? paidAmount >= total : true;

  async function handleProcessPayment() {
    if (!isPayable || isProcessing) return;

    setLocalError(null);
    setIsProcessing(true);

    try {
      // Tunggu transaksi BENAR-BENAR tersimpan di server sebelum klaim sukses.
      await onConfirmPayment(
        method,
        method === "tunai" ? paidAmount : total,
        method === "tunai" ? changeAmount : 0,
      );

      setIsProcessing(false);
      setIsSuccess(true);

      // Beri jeda singkat agar layar sukses sempat terlihat, baru modal menutup dirinya sendiri.
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
      }, 900);
    } catch (err) {
      setIsProcessing(false);
      setLocalError(
        err instanceof Error ? err.message : "Pembayaran gagal diproses.",
      );
    }
  }

  if (isSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
        <div className="bg-white dark:bg-zinc-950 rounded-xl p-8 max-w-sm w-full flex flex-col items-center justify-center text-center border border-zinc-200 dark:border-zinc-800">
          <CheckCircle2 className="w-16 h-16 text-lco-green mb-4" />
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mb-2">
            Pembayaran Berhasil!
          </h2>
          <p className="text-zinc-500 text-xs">
            Mencetak struk & menyiapkan transaksi baru...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="bg-white dark:bg-zinc-950 rounded-xl w-full max-w-lg border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-semibold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
            Pembayaran
          </h2>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md transition-colors duration-150 text-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          <div className="bg-zinc-50 dark:bg-zinc-900/90 p-5 rounded-xl text-center mb-6 border border-zinc-200 dark:border-zinc-800">
            <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-semibold mb-2">
              Total Tagihan
            </p>
            <p className="text-3xl font-mono tabular-nums font-semibold leading-none text-zinc-900 dark:text-zinc-100">
              {formatRp(total)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => setMethod("tunai")}
              disabled={isProcessing}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${method === "tunai" ? "border-lco-teal bg-zinc-50 dark:bg-zinc-900 text-lco-teal" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-500 hover:border-lco-teal/50"}`}
            >
              <Wallet className="w-5 h-5" />
              <span className="font-medium text-xs">Tunai</span>
            </button>
            <button
              onClick={() => setMethod("transfer")}
              disabled={isProcessing}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${method === "transfer" ? "border-lco-teal bg-zinc-50 dark:bg-zinc-900 text-lco-teal" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-500 hover:border-lco-teal/50"}`}
            >
              <Building2 className="w-5 h-5" />
              <span className="font-medium text-xs">Transfer Bank</span>
            </button>
          </div>

          {method === "tunai" && (
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Uang Diterima
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-zinc-400">
                    Rp
                  </span>
                  <input
                    type="number"
                    value={paidAmount || ""}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    disabled={isProcessing}
                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                    placeholder="0"
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setPaidAmount(total)}
                  disabled={isProcessing}
                  className="py-2 px-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-lco-teal/50 rounded-md text-xs font-medium transition-colors duration-150 text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Uang Pas
                </button>
                <button
                  onClick={() => setPaidAmount(50000)}
                  disabled={isProcessing}
                  className="py-2 px-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-lco-teal/50 rounded-md text-xs font-mono tabular-nums font-medium transition-colors duration-150 text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  50.000
                </button>
                <button
                  onClick={() => setPaidAmount(100000)}
                  disabled={isProcessing}
                  className="py-2 px-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-lco-teal/50 rounded-md text-xs font-mono tabular-nums font-medium transition-colors duration-150 text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  100.000
                </button>
              </div>

              <div className="flex justify-between items-center p-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2">
                <span className="text-xs font-medium text-zinc-500">
                  Kembalian
                </span>
                <span
                  className={`font-mono text-xl font-semibold tabular-nums ${changeAmount < 0 ? "text-lco-coral" : "text-zinc-900 dark:text-zinc-100"}`}
                >
                  {changeAmount < 0 ? "Rp 0" : formatRp(changeAmount)}
                </span>
              </div>
            </div>
          )}

          {method === "transfer" && (
            <div className="p-6 bg-lco-mustard/10 rounded-xl border border-lco-mustard/30 text-center">
              <Building2 className="w-6 h-6 mx-auto text-lco-mustard mb-3" />
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Integrasi upload bukti transfer akan disiapkan. Pembayaran via
                bank butuh verifikasi.
              </p>
            </div>
          )}

          {localError && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">Pembayaran gagal</p>
                <p>{localError}</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <button
            onClick={handleProcessPayment}
            disabled={!isPayable || isProcessing}
            className="w-full py-3 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-sm font-semibold transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Menyimpan Transaksi...
              </>
            ) : isPayable ? (
              "Proses Pembayaran"
            ) : (
              `Uang Kurang ( ${formatRp(Math.abs(changeAmount))} )`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
