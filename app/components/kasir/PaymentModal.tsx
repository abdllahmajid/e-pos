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
  MessageCircle,
  ArrowRight,
} from "lucide-react";
import type {
  CreatedPayment,
  PaymentMethod,
  SplitPaymentLine,
} from "@/lib/pos/transactionApi";
import {
  uploadPaymentProofs,
  validateSplitPayments,
} from "@/lib/pos/transactionApi";
// ── PERBAIKAN (konsep baru: preview struk + cetak manual) ── Sebelumnya di
// sini ada tipe `ReceiptPreviewData` yang didefinisikan ULANG secara manual
// (supaya PaymentModal "tidak perlu tahu" bentuk printLogic.ts) — tapi itu
// bikin field-nya gampang tidak sinkron dengan `ReceiptData` yang sebenarnya
// (sudah 2x ketahuan beda: `customerName`, lalu `discount`). Sekarang pakai
// TYPE-ONLY import langsung dari printLogic.ts: baris `import type` di bawah
// ini dihapus total oleh compiler saat build (tidak ada kode printLogic.ts
// yang ikut ter-bundle/dijalankan di sini), jadi PaymentModal tetap tidak
// punya dependency RUNTIME ke modul cetak — cuma dependency TIPE, supaya
// TypeScript selalu tahu bentuk data struk yang benar tanpa perlu disalin
// manual lagi.
import type { ReceiptData } from "@/lib/pos/printLogic";
import Toast from "@/app/components/ui/Toast";

// ── TAMBAHAN (bug: preview tidak sama dengan hasil cetak) ── Duplikat kecil
// dari METHOD_LABELS/formatMethod() di printLogic.ts (tidak diexport dari
// sana, dan sengaja tidak diimport langsung supaya PaymentModal tetap tidak
// punya dependency RUNTIME ke printLogic.ts — lihat catatan di atas soal
// `import type` ReceiptData). Kalau labelnya diubah di printLogic.ts, ubah
// juga di sini supaya preview & hasil cetak tetap sama persis.
const PREVIEW_METHOD_LABELS: Record<string, string> = {
  tunai: "Tunai",
  CASH: "Tunai",
  transfer: "Transfer Bank",
  BANK_TRANSFER: "Transfer Bank",
  QRIS: "QRIS",
  TEMPO: "Tempo / Piutang",
};

function formatMethodLabel(method: string): string {
  return PREVIEW_METHOD_LABELS[method] ?? method.toUpperCase();
}

type PaymentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  subtotal: number;
  tax: number;
  total: number;
  onConfirmPayment: (
    method: PaymentMethod,
    paidAmount: number,
    change: number,
    extra?: {
      customerName?: string;
      /** ── TAMBAHAN (013) ── Nomor HP pelanggan, opsional untuk semua metode. */
      customerPhone?: string;
      dueDate?: string;
    },
  ) => Promise<{ paymentId: string }>;
  /**
   * ── TAMBAHAN (021, T-11 bagian 2) ── Simpan transaksi dengan SPLIT payment
   * (beberapa metode sekaligus). Opsional: kalau parent tidak mengirim prop ini,
   * pilihan "Split Bayar" disembunyikan dan modal berperilaku persis seperti
   * sebelumnya. Hasilnya memuat `payments` (id tiap baris pembayaran yang baru
   * tersimpan) supaya modal ini bisa menempelkan bukti transfer/QRIS ke baris
   * yang benar.
   */
  onConfirmSplitPayment?: (
    lines: SplitPaymentLine[],
    extra?: {
      customerName?: string;
      customerPhone?: string;
    },
  ) => Promise<{ payments: CreatedPayment[] }>;
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
  /**
   * ── TAMBAHAN (konsep baru: preview struk + cetak manual) ── Data struk
   * transaksi yang baru saja sukses, untuk ditampilkan sebagai PREVIEW di
   * sebelah layar sukses. null/undefined selama belum ada transaksi sukses
   * (tidak akan terjadi di praktik — parent selalu mengisinya sebelum
   * onConfirmPayment/onConfirmSplitPayment resolve, lihat KasirModule.tsx).
   */
  receipt?: ReceiptData | null;
  /**
   * ── PERBAIKAN (auto-print setelah bayar) ── Dipanggil OTOMATIS, sekali,
   * tepat saat layar sukses pertama kali muncul — kasir TIDAK perlu menekan
   * tombol apa pun lagi untuk mencetak. Parent (KasirModule) selalu mencetak
   * ke printer thermal lewat callback ini; pemilihan format thermal/nota
   * sekarang hanya ada di alur "Cetak Ulang" pada Riwayat Transaksi.
   * Opsional: kalau parent tidak mengirim prop ini, tidak ada auto-print
   * ataupun notif "Struk berhasil dicetak" yang muncul.
   */
  onPrint?: () => void;
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

// ── TAMBAHAN (021) ── Urutan tampil & urutan baris yang dikirim ke RPC pada mode split.
const SPLIT_ORDER: PaymentMethod[] = ["CASH", "BANK_TRANSFER", "QRIS", "TEMPO"];

type ProofMethod = "BANK_TRANSFER" | "QRIS";

function emptyMethodFlags(): Record<PaymentMethod, boolean> {
  return { CASH: false, BANK_TRANSFER: false, QRIS: false, TEMPO: false };
}

function emptyMethodAmounts(): Record<PaymentMethod, number> {
  return { CASH: 0, BANK_TRANSFER: 0, QRIS: 0, TEMPO: 0 };
}

function methodLabel(method: PaymentMethod): string {
  return METHODS.find((m) => m.value === method)?.label ?? method;
}

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
  onConfirmSplitPayment,
  onSendWhatsApp,
  receipt,
  onPrint,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [paidAmount, setPaidAmount] = useState<number>(0);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());

  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── TAMBAHAN (021) ── State mode split. Sengaja terpisah dari `method`/`paidAmount`
  // milik mode tunggal supaya berpindah mode tidak saling menimpa input kasir.
  // - splitOn: metode mana yang dipakai (tiap metode maksimal 1 baris, sama seperti RPC).
  // - splitAmount: nominal yang DIKETIK kasir per metode. TEMPO tidak ikut —
  //   nominal TEMPO selalu otomatis = sisa (lihat `tempoAmount` di bawah), supaya
  //   piutang tidak bisa salah ketik.
  // - splitCashReceived: uang yang diserahkan untuk porsi tunai (0/kosong = uang pas).
  const [mode, setMode] = useState<"single" | "split">("single");
  const [splitOn, setSplitOn] =
    useState<Record<PaymentMethod, boolean>>(emptyMethodFlags());
  const [splitAmount, setSplitAmount] =
    useState<Record<PaymentMethod, number>>(emptyMethodAmounts());
  const [splitCashReceived, setSplitCashReceived] = useState<number>(0);
  const [splitProofs, setSplitProofs] = useState<Record<ProofMethod, File[]>>({
    BANK_TRANSFER: [],
    QRIS: [],
  });
  const splitFileRefs = useRef<Record<ProofMethod, HTMLInputElement | null>>({
    BANK_TRANSFER: null,
    QRIS: null,
  });

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

  // ── PERBAIKAN (auto-print setelah bayar) ── `autoPrintedRef` mencegah
  // `onPrint()` terpanggil lebih dari sekali untuk satu transaksi sukses yang
  // sama (mis. kalau komponen re-render selagi isSuccess masih true — lihat
  // efek di bawah). Pakai ref (bukan state) karena nilainya tidak boleh
  // memicu render ulang sendiri, hanya dibaca di dalam efek.
  const autoPrintedRef = useRef(false);
  // Notif pop-up "Struk berhasil dicetak" — muncul tepat saat auto-print
  // terpicu, hilang otomatis lewat timeout di bawah (Toast.tsx sendiri cuma
  // urusan tampilan, tidak menyimpan timer-nya sendiri).
  const [printToastVisible, setPrintToastVisible] = useState(false);
  const printToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const PRINT_TOAST_DURATION_MS = 3000;

  useEffect(() => {
    if (isOpen) {
      setMethod("CASH");
      setPaidAmount(0);
      setCustomerName("");
      setCustomerPhone("");
      setDueDate(defaultDueDate());
      setProofFiles([]);
      setMode("single");
      setSplitOn(emptyMethodFlags());
      setSplitAmount(emptyMethodAmounts());
      setSplitCashReceived(0);
      setSplitProofs({ BANK_TRANSFER: [], QRIS: [] });
      setIsProcessing(false);
      setIsUploadingProof(false);
      setIsSuccess(false);
      setProofWarning(null);
      setLocalError(null);
      setWaStatus("idle");
      setWaMethod(null);
      setWaError(null);
      autoPrintedRef.current = false;
      if (printToastTimeoutRef.current) {
        clearTimeout(printToastTimeoutRef.current);
        printToastTimeoutRef.current = null;
      }
      setPrintToastVisible(false);
    }
  }, [isOpen]);

  // ── PERBAIKAN (auto-print setelah bayar) ── Begitu layar sukses muncul
  // (isSuccess true), langsung cetak struk sekali ke printer thermal tanpa
  // kasir perlu menekan tombol apa pun, lalu tampilkan notif pop-up "Struk
  // berhasil dicetak" selama PRINT_TOAST_DURATION_MS. Dijaga `autoPrintedRef`
  // supaya tidak tercetak berkali-kali kalau komponen re-render selagi masih
  // di layar sukses yang sama.
  useEffect(() => {
    if (!isOpen || !isSuccess || !onPrint || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    onPrint();
    setPrintToastVisible(true);
    if (printToastTimeoutRef.current) clearTimeout(printToastTimeoutRef.current);
    printToastTimeoutRef.current = setTimeout(() => {
      setPrintToastVisible(false);
    }, PRINT_TOAST_DURATION_MS);
  }, [isOpen, isSuccess, onPrint]);

  // Bersihkan timer toast kalau komponen unmount selagi toast masih berjalan.
  useEffect(() => {
    return () => {
      if (printToastTimeoutRef.current) clearTimeout(printToastTimeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const formatRp = (angka: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(angka);
  };

  const changeAmount = paidAmount - total;

  // ── TAMBAHAN (021) ── Turunan mode split. Semua dihitung ulang tiap render dari
  // state di atas (murni, tanpa efek samping) — tidak ada state turunan yang bisa
  // basi/tidak sinkron dengan input kasir.
  const splitAvailable = !!onConfirmSplitPayment && total > 0;
  const isSplit = mode === "split" && splitAvailable;
  const selectedMethods = SPLIT_ORDER.filter((m) => splitOn[m]);
  const typedSum = selectedMethods
    .filter((m) => m !== "TEMPO")
    .reduce((sum, m) => sum + (splitAmount[m] || 0), 0);
  // Sisa tagihan setelah semua nominal yang diketik. Kalau TEMPO dipilih,
  // nilai inilah yang menjadi piutang; kalau tidak, sisa harus 0.
  const splitRemaining = total - typedSum;
  const tempoAmount = splitOn.TEMPO ? Math.max(splitRemaining, 0) : 0;
  const splitPaidSum = typedSum + tempoAmount;
  // Uang tunai diterima kosong (0) dianggap uang pas.
  const cashReceivedEffective =
    splitCashReceived > 0 ? splitCashReceived : splitAmount.CASH;
  const splitCashChange = splitOn.CASH
    ? Math.max(cashReceivedEffective - splitAmount.CASH, 0)
    : 0;
  const splitLines: SplitPaymentLine[] = selectedMethods.map((m) => {
    if (m === "CASH") {
      return {
        method: m,
        amount: splitAmount.CASH,
        receivedAmount: cashReceivedEffective,
      };
    }
    if (m === "TEMPO") {
      return { method: m, amount: tempoAmount, dueDate };
    }
    return { method: m, amount: splitAmount[m] };
  });
  const splitError: string | null = !isSplit
    ? null
    : selectedMethods.length < 2
      ? "Pilih minimal 2 metode pembayaran"
      : validateSplitPayments(total, splitLines, customerName);

  const isPayable = isSplit
    ? splitError === null
    : method === "CASH"
      ? paidAmount >= total
      : method === "TEMPO"
        ? customerName.trim().length > 0 && dueDate.length > 0
        : true;

  function toggleSplitMethod(target: PaymentMethod) {
    setLocalError(null);
    setSplitOn((prev) => ({ ...prev, [target]: !prev[target] }));
  }

  function setSplitAmountFor(target: PaymentMethod, value: number) {
    setLocalError(null);
    const clean = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setSplitAmount((prev) => ({ ...prev, [target]: clean }));
  }

  // Isi nominal metode ini dengan sisa yang belum tertutup metode LAIN.
  function fillSplitRemainder(target: PaymentMethod) {
    const others = typedSum - (splitAmount[target] || 0);
    setSplitAmountFor(target, Math.max(total - others, 0));
  }

  function handlePickSplitFiles(
    target: ProofMethod,
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setSplitProofs((prev) => ({
      ...prev,
      [target]: [...prev[target], ...picked],
    }));
    e.target.value = "";
  }

  function handleRemoveSplitFile(target: ProofMethod, index: number) {
    setSplitProofs((prev) => ({
      ...prev,
      [target]: prev[target].filter((_, i) => i !== index),
    }));
  }

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
          // ── KOREKSI (021) ── Sebelumnya nama HANYA dikirim untuk TEMPO, padahal
          // field "Nama Pelanggan (opsional)" tampil untuk semua metode lain —
          // nama yang diketik kasir diam-diam terbuang dan tidak pernah tersimpan.
          customerName: customerName.trim() || undefined,
          customerPhone: trimmedPhone || undefined,
          dueDate: method === "TEMPO" ? dueDate : undefined,
        },
      );

      // ── KOREKSI (021) ── `setIsProcessing(false)` dulu dipanggil DI SINI, sebelum
      // upload bukti. Selama upload (bisa beberapa detik) tombol Bayar aktif lagi
      // dan klik kedua akan MEMBUAT TRANSAKSI GANDA (stok terpotong 2x). Sekarang
      // baru dimatikan setelah upload selesai (lihat di bawah).

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

      setIsProcessing(false);

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

  // ── TAMBAHAN (021) ── Proses pembayaran mode split. Alurnya sama dengan
  // handleProcessPayment: simpan transaksi dulu (atomik di RPC), BARU unggah bukti
  // ke baris pembayaran yang benar. Gagal unggah bukti tidak membatalkan transaksi
  // (uang & stok sudah benar) — hanya jadi peringatan di layar sukses.
  async function handleProcessSplitPayment() {
    if (!onConfirmSplitPayment || !isPayable || isProcessing) return;

    setLocalError(null);
    setProofWarning(null);
    setIsProcessing(true);

    try {
      const { payments } = await onConfirmSplitPayment(splitLines, {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
      });

      const warnings: string[] = [];
      for (const target of ["BANK_TRANSFER", "QRIS"] as ProofMethod[]) {
        const files = splitProofs[target];
        if (!splitOn[target] || files.length === 0) continue;

        const created = payments.find((p) => p.method === target);
        if (!created) {
          warnings.push(
            `Bukti ${methodLabel(target)} tidak bisa ditautkan ke pembayaran.`,
          );
          continue;
        }

        setIsUploadingProof(true);
        try {
          await uploadPaymentProofs(created.payment_id, files);
        } catch (proofErr) {
          warnings.push(
            proofErr instanceof Error
              ? `${methodLabel(target)}: ${proofErr.message}`
              : `Transaksi tersimpan, tapi bukti ${methodLabel(target)} gagal diunggah.`,
          );
        } finally {
          setIsUploadingProof(false);
        }
      }

      if (warnings.length > 0) setProofWarning(warnings.join(" "));
      setIsProcessing(false);
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
      <>
        {/* ── PERBAIKAN (auto-print setelah bayar) ── Toast dirender sebagai
            saudara (bukan anak) dari overlay modal di bawah, supaya posisinya
            benar-benar "tengah-atas LAYAR" (fixed viewport), bukan cuma
            tengah-atas kartu modal. */}
        <Toast
          visible={printToastVisible}
          message="Struk berhasil dicetak"
          variant="success"
          durationMs={PRINT_TOAST_DURATION_MS}
        />
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
        {/* ── Satu kartu menyatu: konfirmasi sukses di atas, preview struk
            (selalu putih, seperti kertas struk asli — tidak ikut dark mode)
            di tengah, lalu tombol aksi di bawah. ── */}
        <div className="bg-white dark:bg-zinc-950 rounded-xl w-full max-w-sm border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden max-h-[90vh]">
          <div className="p-6 pb-4 flex flex-col items-center text-center shrink-0">
            <CheckCircle2 className="w-14 h-14 text-lco-green mb-3" />
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mb-1">
              Pembayaran Berhasil!
            </h2>
            <p className="text-zinc-500 text-xs">
              {receipt
                ? "Struk otomatis tercetak. Kirim ke pelanggan atau lanjut ke transaksi berikutnya."
                : "Kirim struk digital ke pelanggan atau lanjut ke transaksi berikutnya."}
            </p>
          </div>

          {proofWarning && (
            <div className="px-6 shrink-0">
              <p className="mb-3 text-[11px] text-lco-mustard border border-lco-mustard/40 bg-lco-mustard/10 rounded-md px-3 py-2">
                {proofWarning}
              </p>
            </div>
          )}

          {/* ── Preview struk/nota — dipaksa bg putih & teks gelap (bg-white
              text-zinc-800, TANPA varian dark:) apa pun tema aplikasinya,
              supaya tampak seperti kertas struk sungguhan, bukan kartu UI. ── */}
          {receipt && (
            <div className="mx-6 mb-4 rounded-lg border border-zinc-200 bg-white overflow-hidden shrink-0">
              <div className="px-4 py-2 border-b border-dashed border-zinc-300 bg-zinc-50">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 text-center">
                  Preview Struk
                </p>
              </div>
              <div className="max-h-[38vh] overflow-y-auto px-4 py-3">
                <div className="font-mono text-[11px] leading-relaxed text-zinc-800">
                  {/* ── KOREKSI (bug: preview tidak sama dengan hasil cetak) ──
                      Sebelumnya preview langsung mulai dari No. Struk, tanpa
                      pernah menampilkan nama toko/alamat/telepon (dari
                      Pengaturan > Toko) ataupun tanggal & metode pembayaran —
                      padahal semua itu ADA di template HTML yang benar-benar
                      dicetak (lihat printThermalReceipt() di printLogic.ts).
                      Blok di bawah ini disusun mengikuti urutan yang sama
                      persis dengan template cetak: nama toko -> alamat ->
                      telepon -> No. Struk/Waktu/Kasir/Pelanggan/Metode ->
                      item -> total -> footer. ── */}
                  <p className="text-center font-bold text-sm mb-0.5 text-zinc-900">
                    {receipt.storeName || "Langitan.co"}
                  </p>
                  {receipt.storeAddress && (
                    <p className="text-center text-zinc-600">
                      {receipt.storeAddress}
                    </p>
                  )}
                  {receipt.storePhone && (
                    <p className="text-center text-zinc-600 mb-1">
                      {receipt.storePhone}
                    </p>
                  )}

                  <div className="border-t border-dashed border-zinc-300 my-2" />

                  <div className="space-y-0.5">
                    <div className="flex justify-between">
                      <span>No. Struk</span>
                      <span>{receipt.receiptNo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Waktu</span>
                      <span>
                        {new Date(
                          receipt.createdAt ?? Date.now(),
                        ).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Kasir</span>
                      <span>{receipt.cashierName ?? "-"}</span>
                    </div>
                    {receipt.customerName && (
                      <div className="flex justify-between">
                        <span>Pelanggan</span>
                        <span>{receipt.customerName}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Metode</span>
                      <span>{formatMethodLabel(receipt.method)}</span>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-zinc-300 my-2" />

                  <div className="space-y-1.5">
                    {(receipt.items ?? []).map((item, idx) => (
                      <div key={idx}>
                        <p className="truncate text-zinc-800">{item.name}</p>
                        <div className="flex justify-between text-zinc-500">
                          <span>
                            {item.qty} x {formatRp(item.price)}
                          </span>
                          <span className="tabular-nums">
                            {formatRp(item.price * item.qty)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-dashed border-zinc-300 my-2" />

                  {/* ── CATATAN: beberapa field ReceiptData (discount, tax, dll)
                      opsional di tipe aslinya, jadi dipakai dengan fallback
                      `?? 0` di sini supaya aman dari undefined, baik untuk
                      TypeScript maupun tampilan (bukan cuma kosmetik). */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="tabular-nums">
                        {formatRp(receipt.subtotal ?? 0)}
                      </span>
                    </div>
                    {(receipt.discount ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <span>Diskon</span>
                        <span className="tabular-nums">
                          -{formatRp(receipt.discount ?? 0)}
                        </span>
                      </div>
                    )}
                    {(receipt.tax ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <span>Pajak</span>
                        <span className="tabular-nums">
                          {formatRp(receipt.tax ?? 0)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold text-sm text-zinc-900 pt-1">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {formatRp(receipt.total ?? 0)}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-zinc-300 my-2" />

                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Bayar</span>
                      <span className="tabular-nums">
                        {formatRp(receipt.paidAmount ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Kembali</span>
                      <span className="tabular-nums">
                        {formatRp(receipt.changeAmount ?? 0)}
                      </span>
                    </div>
                  </div>

                  {/* ── TAMBAHAN (bug: preview tidak sama dengan hasil cetak) ──
                      Footer struk (Pengaturan > Toko > footerStruk) dulu tidak
                      pernah ditampilkan di preview, padahal selalu ada di
                      bagian bawah struk fisik. ── */}
                  <div className="border-t border-dashed border-zinc-300 my-2" />
                  <p className="text-center text-zinc-600">
                    {receipt.footerText || "Terima kasih atas kunjungan Anda"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Aksi: Kirim WA / Selesai (cetak sudah otomatis, lihat efek
              isSuccess di atas — tinggal 2 tombol sesuai permintaan). ── */}
          <div className="px-6 pb-6 pt-1 flex flex-col shrink-0">
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
              Selesai <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        </div>
      </>
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

          {/* ── TAMBAHAN (021) ── Pemilih mode: satu metode / split. Hanya tampil
              kalau parent menyediakan onConfirmSplitPayment. */}
          {splitAvailable && (
            <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-md p-0.5 border border-zinc-200 dark:border-zinc-800 mb-5">
              {(
                [
                  { value: "single", label: "Satu Metode" },
                  { value: "split", label: "Split Bayar" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setLocalError(null);
                    setMode(opt.value);
                  }}
                  disabled={isProcessing}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-sm transition-colors duration-150 disabled:cursor-not-allowed ${
                    mode === opt.value
                      ? "bg-white dark:bg-zinc-950 text-lco-teal border border-zinc-200 dark:border-zinc-800"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-transparent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {!isSplit && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
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
                      Tanggal Jatuh Tempo{" "}
                      <span className="text-lco-coral">*</span>
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
            </>
          )}

          {/* ── TAMBAHAN (021, T-11 bagian 2) ── UI SPLIT PAYMENT.
              Aturan: pilih ≥ 2 metode; tiap metode 1 baris; jumlah nominal harus
              persis = total. TEMPO hanya menampung SISA (nominal otomatis), jadi
              piutang tidak bisa salah ketik. */}
          {isSplit && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Pilih Metode{" "}
                  <span className="normal-case font-normal text-zinc-400">
                    (minimal 2)
                  </span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {METHODS.map(({ value, label, icon: Icon }) => {
                    const on = splitOn[value];
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleSplitMethod(value)}
                        disabled={isProcessing}
                        aria-pressed={on}
                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-lco-teal bg-zinc-50 dark:bg-zinc-900 text-lco-teal" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-500 hover:border-lco-teal/50"}`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="font-medium text-[11px] text-center leading-tight">
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedMethods.map((m) => (
                <div
                  key={m}
                  data-split-row={m}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {methodLabel(m)}
                    </span>
                    {m !== "TEMPO" && (
                      <button
                        type="button"
                        onClick={() => fillSplitRemainder(m)}
                        disabled={isProcessing}
                        className="text-[11px] font-medium text-lco-teal hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Isi sisa
                      </button>
                    )}
                  </div>

                  {m === "TEMPO" ? (
                    <>
                      <div className="flex items-center justify-between rounded-md bg-lco-coral/10 border border-lco-coral/30 px-3 py-2.5">
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          Piutang (sisa otomatis)
                        </span>
                        <span
                          data-testid="tempo-amount"
                          className="font-mono text-sm font-semibold tabular-nums text-lco-coral"
                        >
                          {formatRp(tempoAmount)}
                        </span>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                          Tanggal Jatuh Tempo{" "}
                          <span className="text-lco-coral">*</span>
                        </label>
                        <input
                          type="date"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                          disabled={isProcessing}
                          min={new Date().toISOString().slice(0, 10)}
                          className="w-full px-4 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-zinc-400">
                        Rp
                      </span>
                      <input
                        type="number"
                        aria-label={`Nominal ${methodLabel(m)}`}
                        value={splitAmount[m] || ""}
                        onChange={(e) =>
                          setSplitAmountFor(m, Number(e.target.value))
                        }
                        disabled={isProcessing}
                        placeholder="0"
                        className="w-full pl-12 pr-4 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                      />
                    </div>
                  )}

                  {m === "CASH" && (
                    <div className="space-y-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Uang Diterima{" "}
                        <span className="normal-case font-normal text-zinc-400">
                          (kosong = uang pas)
                        </span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-zinc-400">
                          Rp
                        </span>
                        <input
                          type="number"
                          aria-label="Uang diterima tunai"
                          value={splitCashReceived || ""}
                          onChange={(e) =>
                            setSplitCashReceived(
                              Math.max(0, Math.floor(Number(e.target.value))),
                            )
                          }
                          disabled={isProcessing}
                          placeholder="0"
                          className="w-full pl-12 pr-4 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-base tabular-nums text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-500">Kembalian</span>
                        <span
                          data-testid="split-change"
                          className="font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100"
                        >
                          {formatRp(splitCashChange)}
                        </span>
                      </div>
                    </div>
                  )}

                  {(m === "BANK_TRANSFER" || m === "QRIS") && (
                    <div>
                      <input
                        ref={(el) => {
                          splitFileRefs.current[m] = el;
                        }}
                        type="file"
                        accept="image/*,.pdf"
                        multiple
                        onChange={(e) => handlePickSplitFiles(m, e)}
                        disabled={isProcessing}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => splitFileRefs.current[m]?.click()}
                        disabled={isProcessing}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-500 hover:border-lco-teal hover:text-lco-teal transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Upload className="w-4 h-4" /> Bukti {methodLabel(m)}{" "}
                        (opsional)
                      </button>
                      {splitProofs[m].length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {splitProofs[m].map((file, index) => (
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
                                onClick={() => handleRemoveSplitFile(m, index)}
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
                  )}
                </div>
              ))}

              {/* Ringkasan: selalu terlihat supaya kasir tahu berapa yang masih kurang. */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Total tagihan</span>
                  <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatRp(total)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Terbayar</span>
                  <span
                    data-testid="split-paid"
                    className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100"
                  >
                    {formatRp(splitPaidSum)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-zinc-500">
                    {total - splitPaidSum < 0 ? "Kelebihan" : "Masih kurang"}
                  </span>
                  <span
                    data-testid="split-remaining"
                    className={`font-mono tabular-nums ${total - splitPaidSum === 0 ? "text-lco-green" : "text-lco-coral"}`}
                  >
                    {formatRp(Math.abs(total - splitPaidSum))}
                  </span>
                </div>
              </div>

              {/* Identitas pelanggan — satu set untuk seluruh transaksi. Nama
                  WAJIB kalau ada baris TEMPO (aturan RPC). */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Nama Pelanggan{" "}
                    {splitOn.TEMPO ? (
                      <span className="text-lco-coral">*</span>
                    ) : (
                      <span className="normal-case font-normal text-zinc-400">
                        (opsional)
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="text"
                      aria-label="Nama pelanggan"
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
                      aria-label="No. HP pelanggan"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      disabled={isProcessing}
                      placeholder="08xxxxxxxxxx"
                      className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                    />
                  </div>
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

        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
          <button
            onClick={isSplit ? handleProcessSplitPayment : handleProcessPayment}
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
            ) : isSplit && splitError ? (
              splitError
            ) : !isSplit && method === "CASH" && !isPayable ? (
              `Uang Kurang ( ${formatRp(Math.abs(changeAmount))} )`
            ) : !isSplit && method === "TEMPO" && !isPayable ? (
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
