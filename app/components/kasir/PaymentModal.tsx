"use client";

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
  Phone,
  Printer,
  MessageCircle,
  ArrowRight,
} from "lucide-react";
import type { PaymentMethod } from "@/lib/pos/transactionApi";
import { uploadPaymentProofs } from "@/lib/pos/transactionApi";

type PaymentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  subtotal: number;
  tax: number;
  total: number;
  /** Format cetak default dari pengaturan toko */
  defaultPrintFormat: "thermal" | "nota";
  onConfirmPayment: (
    method: PaymentMethod,
    paidAmount: number,
    change: number,
    extra?: {
      customerName?: string;
      /** ── TAMBAHAN (013) ── Nomor HP pelanggan, opsional untuk semua metode. */
      customerPhone?: string;
      dueDate?: string;
      printFormat?: "thermal" | "nota";
    },
  ) => Promise<{ paymentId: string }>;
  /**
   * ── TAMBAHAN (013) ── Kirim struk digital ke WhatsApp pelanggan (PRD §4.2
   * "kirim struk via WhatsApp", §4.7). Dipanggil dari tombol di layar sukses,
   * SETELAH transaksi tersimpan (parent — KasirModule — yang tahu data
   * lengkap struk & memanggil shareReceiptViaWhatsApp() dari printLogic.ts;
   * PaymentModal sengaja tidak import printLogic sendiri supaya modal ini
   * tetap murni UI pembayaran, tidak perlu tahu bentuk ReceiptData).
   * Opsional — kalau tidak dikirim parent, tombol "Kirim WA" disembunyikan.
   */
  onSendWhatsApp?: () => Promise<{ method: "web-share" | "download-fallback" }>;
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
  defaultPrintFormat,
  onConfirmPayment,
  onSendWhatsApp,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [paidAmount, setPaidAmount] = useState<number>(0);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());

  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State untuk pilihan format cetak
  const [printFormat, setPrintFormat] = useState<"thermal" | "nota">(
    defaultPrintFormat,
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [proofWarning, setProofWarning] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // ── TAMBAHAN (013) ── Status tombol "Kirim WA" di layar sukses. Terpisah dari
  // isProcessing/isUploadingProof karena aksi ini terjadi SETELAH transaksi
  // sudah tersimpan — gagal di sini tidak boleh terlihat seperti transaksi
  // gagal (uang & stok sudah benar, cuma pengiriman gambar struk yang gagal).
  const [waStatus, setWaStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [waMethod, setWaMethod] = useState<
    "web-share" | "download-fallback" | null
  >(null);
  const [waError, setWaError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMethod("CASH");
      setPaidAmount(0);
      setCustomerName("");
      setCustomerPhone("");
      setDueDate(defaultDueDate());
      setProofFiles([]);
      setPrintFormat(defaultPrintFormat);
      setIsProcessing(false);
      setIsUploadingProof(false);
      setIsSuccess(false);
      setProofWarning(null);
      setLocalError(null);
      setWaStatus("idle");
      setWaMethod(null);
      setWaError(null);
    }
  }, [isOpen, defaultPrintFormat]);

  if (!isOpen) return null;

  const formatRp = (angka: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(angka);
  };

  const changeAmount = paidAmount - total;
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

      // ── TAMBAHAN (013) ── customerPhone dikirim untuk SEMUA metode (opsional,
      // PRD §4.2), bukan hanya TEMPO seperti customerName. trim() -> undefined
      // kalau kosong, konsisten dengan pola customerName di TEMPO.
      const trimmedPhone = customerPhone.trim();

      const { paymentId } = await onConfirmPayment(
        method,
        finalPaidAmount,
        finalChange,
        {
          customerName: method === "TEMPO" ? customerName.trim() : undefined,
          customerPhone: trimmedPhone || undefined,
          dueDate: method === "TEMPO" ? dueDate : undefined,
          printFormat: printFormat,
        },
      );

      setIsProcessing(false);

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

      // ── KOREKSI (013) ── Sebelumnya di sini ada setTimeout yang otomatis
      // menutup modal (900ms, atau 2500ms kalau ada proofWarning) — TIDAK
      // cukup waktu untuk kasir sempat menekan tombol apa pun, apalagi PRD
      // §4.2 secara eksplisit minta layar sukses menawarkan "kirim struk via
      // WhatsApp" DAN "opsi transaksi baru" sebagai dua aksi terpisah, bukan
      // sesuatu yang lewat begitu saja dalam waktu kurang dari 1 detik.
      // Sekarang layar sukses tetap terbuka sampai kasir menekan salah satu
      // tombol (lihat blok isSuccess di bawah) — struk tetap otomatis
      // tercetak/tersimpan seperti sebelumnya (dipanggil parent sebelum
      // Promise ini resolve), hanya PENUTUPAN modal yang sekarang manual.
      setIsSuccess(true);
    } catch (err) {
      setIsProcessing(false);
      setIsUploadingProof(false);
      setLocalError(
        err instanceof Error ? err.message : "Pembayaran gagal diproses.",
      );
    }
  }

  // ── TAMBAHAN (013) ── Tombol "Kirim WA" di layar sukses. Status ditangani
  // di sini (bukan langsung di JSX) supaya pesan error dari shareReceiptViaWhatsApp
  // (mis. browser tidak izinkan popup wa.me) bisa ditampilkan tanpa membuat
  // kasir mengira TRANSAKSINYA yang gagal.
  async function handleSendWhatsApp() {
    if (!onSendWhatsApp || waStatus === "sending") return;
    setWaStatus("sending");
    setWaError(null);
    try {
      const result = await onSendWhatsApp();
      setWaMethod(result.method);
      setWaStatus("sent");
    } catch (err) {
      setWaStatus("error");
      setWaError(
        err instanceof Error
          ? err.message
          : "Gagal mengirim struk ke WhatsApp.",
      );
    }
  }

  function handleFinishTransaction() {
    setIsSuccess(false);
    onClose();
  }

  if (isSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
        <div className="bg-white dark:bg-zinc-950 rounded-xl p-8 max-w-sm w-full flex flex-col items-center text-center border border-zinc-200 dark:border-zinc-800">
          <CheckCircle2 className="w-16 h-16 text-lco-green mb-4" />
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mb-2">
            Pembayaran Berhasil!
          </h2>
          <p className="text-zinc-500 text-xs mb-6">
            Struk sudah dicetak. Kirim struk digital ke pelanggan atau lanjut ke
            transaksi berikutnya.
          </p>

          {proofWarning && (
            <p className="mb-4 w-full text-[11px] text-lco-mustard border border-lco-mustard/40 bg-lco-mustard/10 rounded-md px-3 py-2">
              {proofWarning}
            </p>
          )}

          {onSendWhatsApp && (
            <div className="w-full mb-3">
              <button
                type="button"
                onClick={handleSendWhatsApp}
                disabled={waStatus === "sending" || waStatus === "sent"}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-md border border-lco-green/40 text-lco-green hover:bg-lco-green/10 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {waStatus === "sending" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Menyiapkan
                    Gambar Struk...
                  </>
                ) : waStatus === "sent" ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    {waMethod === "web-share"
                      ? "Terkirim ke Sheet Share"
                      : "Gambar Terunduh, WhatsApp Terbuka"}
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4" /> Kirim Struk via
                    WhatsApp
                  </>
                )}
              </button>
              {waStatus === "sent" && waMethod === "download-fallback" && (
                <p className="mt-2 text-[11px] text-zinc-500 text-left">
                  Lampirkan gambar struk yang baru terunduh ke chat WhatsApp
                  secara manual.
                </p>
              )}
              {waStatus === "error" && waError && (
                <p className="mt-2 text-[11px] text-lco-coral text-left">
                  {waError}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleFinishTransaction}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-sm font-semibold transition-colors duration-150"
          >
            Transaksi Baru <ArrowRight className="w-4 h-4" />
          </button>
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

          {/* ── TAMBAHAN (013) ── Identitas pelanggan opsional (PRD §4.2), khusus
              di sini untuk metode SELAIN TEMPO — TEMPO sudah punya field Nama
              wajib + field HP opsional sendiri di bloknya masing-masing di
              bawah, jadi tidak perlu field nama dobel. */}
          {method !== "TEMPO" && (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Nama Pelanggan{" "}
                  <span className="normal-case font-normal text-zinc-400">
                    (opsional)
                  </span>
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    disabled={isProcessing}
                    placeholder="Nama"
                    className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  No. HP{" "}
                  <span className="normal-case font-normal text-zinc-400">
                    (opsional)
                  </span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    disabled={isProcessing}
                    placeholder="08xxxxxxxxxx"
                    className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                  />
                </div>
              </div>
            </div>
          )}

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
                  . Lampirkan bukti (opsional).
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
                  <Upload className="w-4 h-4" /> Pilih Foto Bukti
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

          {method === "TEMPO" && (
            <div className="space-y-4">
              <div className="p-4 bg-lco-coral/10 rounded-xl border border-lco-coral/30 text-center">
                <CalendarClock className="w-6 h-6 mx-auto text-lco-coral mb-2" />
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Transaksi tercatat sebagai piutang sebesar{" "}
                  <span className="font-mono font-semibold">
                    {formatRp(total)}
                  </span>
                  . Nama &amp; jatuh tempo wajib diisi.
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
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  No. HP{" "}
                  <span className="normal-case font-normal text-zinc-400">
                    (opsional, untuk kirim struk &amp; tagih WA)
                  </span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    disabled={isProcessing}
                    placeholder="08xxxxxxxxxx"
                    className="w-full pl-11 pr-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                  />
                </div>
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

        {/* Pilihan Radio Format Cetak */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-zinc-400" />
            <span className="text-[10px] uppercase font-semibold text-zinc-500">
              Format Cetak:
            </span>
          </div>
          <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-md p-0.5 border border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setPrintFormat("thermal")}
              disabled={isProcessing}
              className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors ${
                printFormat === "thermal"
                  ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              Struk Thermal
            </button>
            <button
              type="button"
              onClick={() => setPrintFormat("nota")}
              disabled={isProcessing}
              className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors ${
                printFormat === "nota"
                  ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              Nota Kertas
            </button>
          </div>
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
              "Proses Pembayaran & Cetak"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
