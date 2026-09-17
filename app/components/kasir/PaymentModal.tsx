"use client";

// ── KOREKSI ── Bug kritis: versi sebelumnya menampilkan layar "Pembayaran Berhasil!"
// via setTimeout PALSU sebelum transaksi benar-benar disimpan ke server (onSuccess dipanggil
// tanpa di-await, lalu modal langsung ditutup). Kalau createTransaction() gagal (mis. stok
// tidak cukup — PRD AC4). Sekarang:
// - Prop diganti jadi onConfirmPayment: async, HARUS throw kalau gagal.
// - Modal menunggu (await) hasil asli sebelum menampilkan layar sukses.
// - Kalau gagal, modal TETAP TERBUKA dengan pesan error, user bisa coba lagi.
// - Modal sendiri yang memanggil onClose() setelah animasi sukses selesai (bukan parent
//   yang menutup modal duluan), supaya layar sukses sempat terlihat.
//
// ── TAMBAHAN (T-02, PRD §17) ── 4 metode pembayaran lengkap:
// - Tunai: tidak berubah dari sebelumnya (uang diterima + kembalian).
// - Transfer Bank / QRIS: paidAmount = total (tanpa kembalian), bisa lampirkan bukti
//   (multi-file, dikompresi lalu diunggah ke Storage bucket "payment-proofs" SETELAH
//   transaksi tersimpan — lihat lib/pos/transactionApi.ts `uploadPaymentProofs`).
// - Tempo/Piutang: wajib nama pelanggan + tanggal jatuh tempo (divalidasi di sini untuk
//   UX, divalidasi ULANG di RPC create_transaction supaya tidak bisa dilewati).
// Method sekarang memakai konvensi kanonik yang sama persis dengan DB/RPC
// ("CASH" | "BANK_TRANSFER" | "QRIS" | "TEMPO") — menghapus lapisan terjemahan
// "tunai"/"transfer" yang sebelumnya ada di KasirModule.tsx supaya tidak ada 2 kosakata
// metode pembayaran yang harus disinkronkan manual.

import { useState, useEffect, useRef } from "react";
import {
  X,
  Wallet,
  Building2,
  QrCode,
  CalendarClock,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Upload,
  Paperclip,
  Trash2,
  User,
} from "lucide-react";
import type { PaymentMethod } from "@/lib/pos/transactionApi";
import { uploadPaymentProofs } from "@/lib/pos/transactionApi";

type PaymentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Subtotal sebelum pajak (PRD §17 T-01) — dipakai untuk baris breakdown di atas Total Tagihan. */
  subtotal: number;
  /** 0 kalau settings.ppn_enabled = false — baris "Pajak (PPN)" otomatis disembunyikan. */
  tax: number;
  total: number;
  /**
   * Wajib async dan HARUS throw Error kalau transaksi gagal disimpan.
   * Modal menunggu promise ini sebelum menampilkan layar sukses.
   * Mengembalikan `paymentId` supaya modal bisa lanjut upload bukti pembayaran
   * (Transfer/QRIS) langsung setelah transaksi tersimpan.
   */
  onConfirmPayment: (
    method: PaymentMethod,
    paidAmount: number,
    change: number,
    extra?: { customerName?: string; dueDate?: string },
  ) => Promise<{ paymentId: string }>;
};

const METHODS: {
  value: PaymentMethod;
  label: string;
  icon: typeof Wallet;
}[] = [
  { value: "CASH", label: "Tunai", icon: Wallet },
  { value: "BANK_TRANSFER", label: "Transfer Bank", icon: Building2 },
  { value: "QRIS", label: "QRIS", icon: QrCode },
  { value: "TEMPO", label: "Tempo / Piutang", icon: CalendarClock },
];

/** Tanggal jatuh tempo default: 7 hari dari sekarang, format "YYYY-MM-DD" untuk <input type="date">. */
function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export default function PaymentModal({
  isOpen,
  onClose,
  subtotal,
  tax,
  total,
  onConfirmPayment,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [paidAmount, setPaidAmount] = useState<number>(0);

  // ── TAMBAHAN (T-02) ── State khusus Tempo
  const [customerName, setCustomerName] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());

  // ── TAMBAHAN (T-02) ── State khusus Transfer/QRIS (bukti pembayaran, opsional)
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [proofWarning, setProofWarning] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMethod("CASH");
      setPaidAmount(0);
      setCustomerName("");
      setDueDate(defaultDueDate());
      setProofFiles([]);
      setIsProcessing(false);
      setIsUploadingProof(false);
      setIsSuccess(false);
      setProofWarning(null);
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

  // ── TAMBAHAN (T-02) ── Validasi ringan per metode, sebelum tombol "Proses Pembayaran"
  // aktif. Validasi berat (yang tidak bisa dilewati) tetap di RPC create_transaction.
  const isPayable =
    method === "CASH"
      ? paidAmount >= total
      : method === "TEMPO"
        ? customerName.trim().length > 0 && dueDate.length > 0
        : true;

  function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setProofFiles((prev) => [...prev, ...picked]);
    // Reset value supaya file yang sama bisa dipilih lagi kalau user tidak sengaja hapus.
    e.target.value = "";
  }

  function handleRemoveFile(index: number) {
    setProofFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleProcessPayment() {
    if (!isPayable || isProcessing) return;

    setLocalError(null);
    setProofWarning(null);
    setIsProcessing(true);

    try {
      const finalPaidAmount = method === "CASH" ? paidAmount : total;
      const finalChange = method === "CASH" ? changeAmount : 0;

      // Tunggu transaksi BENAR-BENAR tersimpan di server sebelum klaim sukses.
      const { paymentId } = await onConfirmPayment(
        method,
        finalPaidAmount,
        finalChange,
        method === "TEMPO"
          ? { customerName: customerName.trim(), dueDate }
          : undefined,
      );

      setIsProcessing(false);

      // ── TAMBAHAN (T-02) ── Upload bukti SETELAH transaksi sukses (supaya file tidak
      // pernah nyasar ke transaksi yang gagal). Gagal upload TIDAK membatalkan transaksi
      // yang sudah tersimpan — cuma ditampilkan sebagai peringatan, bukan error fatal.
      let warning: string | null = null;
      if (
        (method === "BANK_TRANSFER" || method === "QRIS") &&
        proofFiles.length > 0
      ) {
        setIsUploadingProof(true);
        try {
          await uploadPaymentProofs(paymentId, proofFiles);
        } catch (proofErr) {
          warning =
            proofErr instanceof Error
              ? proofErr.message
              : "Transaksi tersimpan, tapi bukti pembayaran gagal diunggah.";
          setProofWarning(warning);
        } finally {
          setIsUploadingProof(false);
        }
      }

      setIsSuccess(true);

      // Beri jeda lebih lama kalau ada peringatan upload bukti, supaya sempat terbaca.
      setTimeout(
        () => {
          setIsSuccess(false);
          onClose();
        },
        warning ? 2500 : 900,
      );
    } catch (err) {
      setIsProcessing(false);
      setIsUploadingProof(false);
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
          {proofWarning && (
            <p className="mt-3 text-[11px] text-lco-mustard border border-lco-mustard/40 bg-lco-mustard/10 rounded-md px-3 py-2">
              {proofWarning}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="bg-white dark:bg-zinc-950 rounded-xl w-full max-w-lg border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
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
            {/* ── TAMBAHAN (T-01) ── Breakdown Subtotal/Pajak sebelum Total Tagihan.
                Baris "Pajak" cuma render kalau tax > 0, yaitu settings.ppn_enabled = true
                di database (lihat hooks/useSettings.ts + KasirModule.tsx). */}
            {tax > 0 && (
              <div className="flex flex-col gap-1 mb-3 pb-3 border-b border-dashed border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">
                    {formatRp(subtotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Pajak (PPN)</span>
                  <span className="font-mono tabular-nums">
                    {formatRp(tax)}
                  </span>
                </div>
              </div>
            )}

            <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-semibold mb-2">
              Total Tagihan
            </p>
            <p className="text-3xl font-mono tabular-nums font-semibold leading-none text-zinc-900 dark:text-zinc-100">
              {formatRp(total)}
            </p>
          </div>

          {/* ── TAMBAHAN (T-02) ── 4 metode, bukan 2 lagi. */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            {METHODS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setMethod(value)}
                disabled={isProcessing}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${method === value ? "border-lco-teal bg-zinc-50 dark:bg-zinc-900 text-lco-teal" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-500 hover:border-lco-teal/50"}`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium text-[11px] text-center leading-tight">
                  {label}
                </span>
              </button>
            ))}
          </div>

          {method === "CASH" && (
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

          {/* ── TAMBAHAN (T-02) ── Transfer Bank & QRIS: paidAmount = total (tanpa
              kembalian), upload bukti opsional (multi-file, dikompresi otomatis). */}
          {(method === "BANK_TRANSFER" || method === "QRIS") && (
            <div className="space-y-4">
              <div className="p-4 bg-lco-mustard/10 rounded-xl border border-lco-mustard/30 text-center">
                {method === "BANK_TRANSFER" ? (
                  <Building2 className="w-6 h-6 mx-auto text-lco-mustard mb-2" />
                ) : (
                  <QrCode className="w-6 h-6 mx-auto text-lco-mustard mb-2" />
                )}
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Nominal dibayar penuh sebesar{" "}
                  <span className="font-mono font-semibold">
                    {formatRp(total)}
                  </span>
                  . Lampirkan bukti {method === "QRIS" ? "QRIS" : "transfer"}{" "}
                  (opsional, bisa lebih dari 1 foto).
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Bukti Pembayaran
                </label>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={handlePickFiles}
                  disabled={isProcessing}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-500 hover:border-lco-teal hover:text-lco-teal transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Upload className="w-4 h-4" />
                  Pilih Foto Bukti
                </button>

                {proofFiles.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {proofFiles.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-300"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Paperclip className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                          <span className="truncate">{file.name}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(index)}
                          disabled={isProcessing}
                          className="p-1 text-zinc-400 hover:text-lco-coral rounded-md shrink-0 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── TAMBAHAN (T-02) ── Tempo/Piutang: nama pelanggan + jatuh tempo wajib. */}
          {method === "TEMPO" && (
            <div className="space-y-4">
              <div className="p-4 bg-lco-coral/10 rounded-xl border border-lco-coral/30 text-center">
                <CalendarClock className="w-6 h-6 mx-auto text-lco-coral mb-2" />
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Transaksi tercatat sebagai piutang sebesar{" "}
                  <span className="font-mono font-semibold">
                    {formatRp(total)}
                  </span>
                  . Nama pelanggan &amp; tanggal jatuh tempo wajib diisi.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Nama Pelanggan <span className="text-lco-coral">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    disabled={isProcessing}
                    placeholder="Nama pelanggan"
                    className="w-full pl-11 pr-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Tanggal Jatuh Tempo <span className="text-lco-coral">*</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={isProcessing}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full px-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                />
              </div>
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

        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
          <button
            onClick={handleProcessPayment}
            disabled={!isPayable || isProcessing}
            className="w-full py-3 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-sm font-semibold transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isUploadingProof
                  ? "Mengunggah Bukti..."
                  : "Menyimpan Transaksi..."}
              </>
            ) : method === "CASH" && !isPayable ? (
              `Uang Kurang ( ${formatRp(Math.abs(changeAmount))} )`
            ) : method === "TEMPO" && !isPayable ? (
              "Lengkapi Nama & Jatuh Tempo"
            ) : (
              "Proses Pembayaran"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
