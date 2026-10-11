"use client";

// ── TAMBAHAN ── Modal ini mengisi 2 hal yang di PRD §15.2 masih ditandai belum ada:
// 1. Tombol "Lihat Detail & Cetak" (sebelumnya sengaja `disabled` di TransactionHistoryModule).
// 2. Retur (sebagian) & Void, memakai RPC `return_transaction` / `void_transaction` yang
//    sudah dibuat di migration 004_return_and_void.sql tapi belum pernah dipanggil frontend.
//
// Aturan permission (PRD §5, digeneralisasi migration 030): retur & void butuh
// permission "retur_void" (default: Admin & Supervisor) — tombolnya disembunyikan
// untuk role yang tidak punya, tapi RPC sendiri tetap validasi ulang permission yang
// sama di server (jangan andalkan sembunyi tombol saja sebagai keamanan).

import { useEffect, useState } from "react";
import {
  X,
  Loader2,
  AlertTriangle,
  Printer,
  Undo2,
  Ban,
  User,
  Phone,
  StickyNote,
  ChevronDown,
  MessageCircle,
  Info,
} from "lucide-react";
import { useAuth, hasPermissionAction } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings"; // ── TAMBAHAN ── Untuk mendapatkan paperNota setting
import {
  getTransactionDetail,
  returnTransaction,
  voidTransaction,
  type TransactionDetail,
} from "@/lib/pos/transactionApi";
// ── TAMBAHAN (migration 037/039) ── Perkiraan dana kembali & ringkasan retur
// (fungsi murni, diuji terpisah). Angka final tetap dihitung server.
import { estimateReturn, summarizeReturns } from "@/lib/pos/returnPreview";
import {
  printA6Nota,
  shareReceiptViaWhatsApp,
  type ReceiptData,
} from "@/lib/pos/printLogic";
import { getReceiptPromo } from "@/lib/pos/receiptQr";
// ── PERBAIKAN (auto-print munculkan dialog cetak sistem) ── format
// "thermal" sekarang lewat printReceipt() (lihat catatan yang sama di
// KasirModule.tsx) supaya cetak ulang struk thermal juga tidak memunculkan
// dialog cetak kalau printer default kasir bertipe Bluetooth/USB. Format
// "nota" (A6/A5) TETAP pakai printA6Nota() / window.print() — itu memang
// ditujukan untuk printer kertas biasa (bukan thermal ESC/POS), jadi
// dialog cetak sistem di sana bukan bug, melainkan cara satu-satunya.
import { usePrinterProfiles } from "@/hooks/usePrinterProfiles";
import { formatRupiah } from "@/lib/pos/cartLogic";

type PanelMode = "detail" | "retur" | "void";

interface TransactionDetailModalProps {
  transactionId: string | null;
  onClose: () => void;
  /** Dipanggil setelah retur/void berhasil, supaya parent bisa refetch daftar riwayat. */
  onChanged: () => void;
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    CASH: "Tunai",
    DIGITAL: "Digital",
    TEMPO: "Piutang",
    // Fallback untuk baris lama yang belum termigrasi (migration 034).
    BANK_TRANSFER: "Digital",
    QRIS: "Digital",
  };
  return labels[method] ?? method;
}

// ── TAMBAHAN (migration 037) ── Peringatan untuk refund yang TIDAK otomatis
// selesai di sistem. Dipakai di riwayat retur (transaksi penjualan) dan di
// detail baris retur itu sendiri.
function RefundWarnings({
  digital,
  unrecorded,
  digitalRefs,
  tempoSettled,
}: {
  digital: number;
  unrecorded: number;
  /** Order ID Midtrans pembayaran digital transaksi asli (kalau diketahui). */
  digitalRefs?: string[];
  /** Piutang transaksi asli sudah lunas? undefined = tidak diketahui. */
  tempoSettled?: boolean;
}) {
  if (digital <= 0 && unrecorded <= 0) return null;

  return (
    <div className="space-y-2">
      {digital > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-lco-mustard/40 bg-lco-mustard/10 p-3 text-xs text-zinc-800 dark:text-zinc-100">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-lco-mustard" />
          <div className="space-y-1">
            <p className="font-semibold">
              Refund digital {formatRupiah(digital)} harus diproses manual
            </p>
            <p>
              Sistem hanya mencatat refund ini. Dana BELUM otomatis kembali ke
              pelanggan — kembalikan lewat dashboard Midtrans.
              {digitalRefs && digitalRefs.length > 0 && (
                <>
                  {" "}
                  Order ID:{" "}
                  <span className="font-mono">{digitalRefs.join(", ")}</span>
                </>
              )}
            </p>
          </div>
        </div>
      )}
      {unrecorded > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-lco-mustard/40 bg-lco-mustard/10 p-3 text-xs text-zinc-800 dark:text-zinc-100">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-lco-mustard" />
          <div className="space-y-1">
            <p className="font-semibold">
              {formatRupiah(unrecorded)} berasal dari bagian piutang
            </p>
            <p>
              Tagihan piutang TIDAK otomatis berkurang oleh retur ini.{" "}
              {tempoSettled === true
                ? "Piutang transaksi ini sudah dilunasi, jadi kembalikan dana bagian ini ke pelanggan secara manual."
                : tempoSettled === false
                  ? "Tagihan masih tercatat penuh — sesuaikan secara manual dengan pelanggan."
                  : "Sesuaikan tagihan piutang pelanggan secara manual."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TransactionDetailModal({
  transactionId,
  onClose,
  onChanged,
}: TransactionDetailModalProps) {
  const { user } = useAuth();
  // ── REVISI (migration 030) ── `user?.role` (string admin/supervisor) sudah
  // dihapus sejak migration 028. Gate retur/void sekarang pakai permission
  // dinamis `retur_void` (RPC `void_transaction`/`return_transaction` di
  // migration 030 juga sudah divalidasi ulang pakai has_permission yang sama
  // di server — sembunyikan tombol di sini murni UX, bukan satu-satunya lapis
  // keamanan).
  // ── REVISI (migration 031, "permission granular per aksi") ── Retur & Void
  // dulu SATU flag gabungan (`canManage`), sekarang 2 aksi terpisah pada
  // permission yang sama: Retur = aksi "Tambah" (bikin baris transaksi RETURN
  // baru), Void = aksi "Hapus" (membatalkan keabsahan transaksi) — lihat
  // catatan lengkap soal keputusan ini di header migration 031. Role bisa
  // saja diberi salah satu tanpa yang lain (mis. kasir senior boleh Retur
  // tapi Void cuma untuk supervisor ke atas).
  const canRetur = hasPermissionAction(user, "retur_void", "create");
  const canVoid = hasPermissionAction(user, "retur_void", "delete");
  const { settings: posSettings } = useSettings();
  const { printReceipt } = usePrinterProfiles();

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<PanelMode>("detail");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [returnQtyById, setReturnQtyById] = useState<Record<string, number>>(
    {},
  );
  const [returnReason, setReturnReason] = useState("");

  const [voidReason, setVoidReason] = useState("");

  const [isPrintDropdownOpen, setIsPrintDropdownOpen] = useState(false);

  // ── TAMBAHAN (T-08 lanjutan) ── Kirim struk digital ke WhatsApp pelanggan.
  // State terpisah dari `isSubmitting` (dipakai retur/void) — supaya klik
  // "Kirim WA" tidak ikut menonaktifkan tombol Retur/Void atau sebaliknya,
  // keduanya independen.
  const [isSharingWa, setIsSharingWa] = useState(false);

  const isOpen = Boolean(transactionId);

  useEffect(() => {
    if (!transactionId) return;

    let isCancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setDetail(null);
    setMode("detail");
    setActionError(null);
    setActionSuccess(null);
    setReturnQtyById({});
    setReturnReason("");
    setVoidReason("");
    setIsPrintDropdownOpen(false);

    getTransactionDetail(transactionId)
      .then((data) => {
        if (isCancelled) return;
        setDetail(data);
      })
      .catch((err) => {
        if (isCancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Gagal memuat detail transaksi.",
        );
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [transactionId]);

  if (!isOpen) return null;

  const remainingQty = (itemId: string, qty: number, returned: number) =>
    qty - returned;

  // ── KOREKSI (T-08 lanjutan) ── Dipisah dari handleReprint() supaya bisa
  // dipakai ulang oleh handleShareWhatsApp() — sebelumnya object ini dibangun
  // inline di dalam handleReprint, sekarang jadi satu sumber kebenaran untuk
  // "apa isi struk transaksi ini", dipakai baik untuk cetak ulang maupun
  // kirim gambar ke WhatsApp.
  function buildReceiptData(txDetail: TransactionDetail): ReceiptData {
    const primaryPayment = txDetail.payments[0];

    return {
      // ── TAMBAHAN ── Sama seperti KasirModule.tsx: sebelumnya tidak dikirim,
      // jadi cetak ulang dari Riwayat Transaksi juga selalu memakai fallback
      // hardcode, bukan Pengaturan Toko yang berlaku SEKARANG. Catatan: kalau
      // Pengaturan Toko diubah SETELAH transaksi lama terjadi, cetak ulang
      // memakai footer/nama toko TERBARU, bukan yang berlaku saat transaksi
      // dibuat — struk tidak menyimpan snapshot data toko per transaksi. Ini
      // konsisten dengan cara `posSettings` dipakai di tempat lain (live,
      // bukan snapshot), tapi sebutkan kalau toko ganti nama/alamat, struk
      // lama yang dicetak ulang akan ikut berubah.
      storeName: posSettings.namaToko,
      storeAddress: posSettings.alamat,
      storePhone: posSettings.telepon,
      footerText: posSettings.footerStruk,
      ...getReceiptPromo(posSettings),
      receiptNo: txDetail.receipt_no,
      createdAt: txDetail.created_at,
      cashierName: txDetail.cashier_name,
      customerName: txDetail.customer_name,
      items: txDetail.items.map((item) => ({
        name: item.product_name,
        qty: item.qty,
        price: item.unit_price,
        subtotal: item.subtotal,
      })),
      subtotal: txDetail.subtotal,
      discount: txDetail.discount,
      tax: txDetail.tax,
      total: txDetail.total,
      method: primaryPayment?.method ?? "-",
      paidAmount:
        primaryPayment?.received_amount ??
        primaryPayment?.amount ??
        txDetail.total,
      changeAmount: primaryPayment?.change_amount ?? 0,
      isReprint: true,
    };
  }

  function handleReprint(format: "thermal" | "nota") {
    if (!detail) return;
    setIsPrintDropdownOpen(false);

    const printData = buildReceiptData(detail);

    if (format === "nota") {
      printA6Nota(printData, (posSettings.paperNota as "A6" | "A5") ?? "A6");
    } else {
      void printReceipt(printData);
    }
  }

  // ── TAMBAHAN (T-08 lanjutan) ── Kirim struk digital (gambar JPEG) ke
  // WhatsApp pelanggan, reuse `shareReceiptViaWhatsApp()` (lib/pos/printLogic.ts).
  // `detail.customer_phone` dipakai apa adanya (bisa `null` kalau pelanggan
  // tidak isi no. HP saat transaksi) — `shareReceiptViaWhatsApp()` sendiri
  // sudah menangani kasus itu (fallback `wa.me` TANPA nomor tujuan, membuka
  // layar pilih kontak manual, bukan gagal total).
  async function handleShareWhatsApp() {
    if (!detail) return;
    setIsPrintDropdownOpen(false);
    setActionError(null);
    setActionSuccess(null);
    setIsSharingWa(true);

    try {
      const printData = buildReceiptData(detail);
      const result = await shareReceiptViaWhatsApp(
        printData,
        detail.customer_phone,
      );

      setActionSuccess(
        result.method === "web-share"
          ? "Gambar struk dikirim — pilih WhatsApp di jendela share yang terbuka."
          : "Gambar struk sudah diunduh & WhatsApp dibuka di tab baru — lampirkan gambarnya secara manual (browser ini tidak mendukung lampiran otomatis).",
      );
    } catch (err) {
      // `navigator.share()` melempar `AbortError` kalau pengguna membatalkan
      // sheet share (mis. tekan "Batal") — itu BUKAN kegagalan, jangan
      // ditampilkan sebagai error supaya kasir tidak salah kira ada masalah.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setActionError(
        err instanceof Error
          ? err.message
          : "Gagal membuat/mengirim gambar struk.",
      );
    } finally {
      setIsSharingWa(false);
    }
  }

  async function handleSubmitReturn() {
    if (!detail) return;

    const items = Object.entries(returnQtyById)
      .filter(([, qty]) => qty > 0)
      .map(([transactionItemId, qty]) => ({ transactionItemId, qty }));

    if (items.length === 0) {
      setActionError("Isi minimal 1 qty item yang mau diretur.");
      return;
    }
    if (!returnReason.trim()) {
      setActionError("Alasan retur wajib diisi.");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);

    try {
      const result = await returnTransaction({
        transactionId: detail.id,
        items,
        reason: returnReason,
      });

      // ── PERBAIKAN (037/039) ── Rincian dari server: sebagian refund bisa
      // berupa digital (proses manual) atau bagian piutang (tidak tercatat
      // sebagai kas), dan poin pelanggan ikut disesuaikan.
      const refundParts: string[] = [];
      if (result.refund_cash > 0)
        refundParts.push(`tunai ${formatRupiah(result.refund_cash)}`);
      if (result.refund_digital > 0)
        refundParts.push(
          `digital ${formatRupiah(result.refund_digital)} — proses manual di Midtrans`,
        );
      if (result.refund_not_recorded > 0)
        refundParts.push(
          `${formatRupiah(result.refund_not_recorded)} dari bagian piutang — tagihan tidak otomatis berkurang`,
        );
      const pointParts: string[] = [];
      if (result.points_reversed > 0)
        pointParts.push(`${result.points_reversed} poin dicabut`);
      if (result.points_returned > 0)
        pointParts.push(`${result.points_returned} poin dikembalikan`);

      setActionSuccess(
        `Retur berhasil — ${result.receipt_no}, dana kembali ${formatRupiah(result.refund_amount)}` +
          (refundParts.length > 0 ? ` (${refundParts.join("; ")})` : "") +
          "." +
          (pointParts.length > 0
            ? ` Poin pelanggan: ${pointParts.join(", ")}.`
            : ""),
      );
      onChanged();

      const refreshed = await getTransactionDetail(detail.id);
      setDetail(refreshed);
      setMode("detail");
      setReturnQtyById({});
      setReturnReason("");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Retur gagal diproses.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitVoid() {
    if (!detail) return;

    if (!voidReason.trim()) {
      setActionError("Alasan void wajib diisi.");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);

    try {
      await voidTransaction({ transactionId: detail.id, reason: voidReason });

      setActionSuccess("Transaksi berhasil dibatalkan (void).");
      onChanged();

      const refreshed = await getTransactionDetail(detail.id);
      setDetail(refreshed);
      setMode("detail");
      setVoidReason("");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Void gagal diproses.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── PERBAIKAN (037) ── Dulu `canStillAct = status === "PAID"`. Setelah retur
  // PERTAMA status transaksi berubah jadi RETURN, sehingga tombol Retur hilang
  // padahal server (migration 037) sudah mengizinkan retur sebagian berulang.
  // Sekarang: transaksi PENJUALAN (bukan baris retur) berstatus PAID atau
  // RETURN, selama masih ada qty yang bisa diretur. Void tetap hanya untuk
  // PAID (void_transaction menolak status lain).
  const isReturnRow = Boolean(detail?.related_transaction_id);
  const hasReturnableQty = detail
    ? detail.items.some((item) => item.qty - item.returned_qty > 0)
    : false;
  const canStillReturn =
    Boolean(detail) &&
    !isReturnRow &&
    (detail?.status === "PAID" || detail?.status === "RETURN") &&
    hasReturnableQty;
  const canStillVoid = detail?.status === "PAID";

  // Defensif: kalau lib/pos/transactionApi.ts di proyek belum versi terbaru
  // (belum mengirim `returns`), modal tetap tampil — hanya tanpa riwayat retur —
  // dan tidak crash dengan "Cannot read properties of undefined".
  const returnList = detail?.returns ?? [];
  const returnsSummary = detail
    ? summarizeReturns(
        returnList.map((r) => ({
          refundAmount: r.refund_amount,
          payments: r.payments,
        })),
      )
    : null;
  const digitalRefs = detail
    ? detail.payments
        .filter((p) => p.method === "DIGITAL" && p.reference_no)
        .map((p) => p.reference_no as string)
    : [];
  const tempoPayments = detail
    ? detail.payments.filter((p) => p.method === "TEMPO")
    : [];
  const tempoSettled =
    tempoPayments.length > 0
      ? tempoPayments.every((p) => p.is_settled)
      : undefined;
  // Untuk baris retur: bagian piutang = nilai refund dikurangi refund yang tercatat.
  const returnRowSummary =
    detail && isReturnRow
      ? summarizeReturns([
          { refundAmount: detail.subtotal, payments: detail.payments },
        ])
      : null;

  const returnEstimate =
    detail && mode === "retur"
      ? estimateReturn({
          items: detail.items,
          qtyById: returnQtyById,
          saleSubtotal: detail.subtotal,
          saleTotal: detail.total,
          payments: detail.payments.map((p) => ({
            method: p.method,
            amount: p.amount,
          })),
          previouslyRefunded: returnsSummary?.refundTotal ?? 0,
        })
      : null;

  function statusBadge(d: TransactionDetail): { label: string; cls: string } {
    if (d.status === "VOID")
      return {
        label: "Dibatalkan (void)",
        cls: "bg-lco-coral/10 text-lco-coral border-lco-coral/30",
      };
    if (d.status === "RETURN") {
      if (d.related_transaction_id)
        return {
          label: "Retur",
          cls: "bg-lco-mustard/10 text-lco-mustard border-lco-mustard/40",
        };
      return {
        label: hasReturnableQty ? "Diretur sebagian" : "Diretur seluruhnya",
        cls: "bg-lco-mustard/10 text-lco-mustard border-lco-mustard/40",
      };
    }
    return {
      label: "Selesai",
      cls: "bg-lco-teal/10 text-lco-teal border-lco-teal/30",
    };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="bg-white dark:bg-zinc-950 rounded-xl w-full max-w-xl max-h-[90vh] border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Riwayat Transaksi
            </p>
            <div className="flex items-center gap-2">
              <h2 className="font-mono font-semibold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
                {detail?.receipt_no ?? "Memuat..."}
              </h2>
              {detail && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(detail).cls}`}
                >
                  {statusBadge(detail).label}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md transition-colors duration-150 text-zinc-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat detail transaksi...
            </div>
          )}

          {loadError && (
            <div className="flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{loadError}</p>
            </div>
          )}

          {detail && !isLoading && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1">
                    Tanggal
                  </p>
                  <p className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatDate(detail.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1">
                    Kasir
                  </p>
                  <p className="text-zinc-900 dark:text-zinc-100">
                    {detail.cashier_name ?? "-"}
                  </p>
                </div>
                {detail.customer_name && (
                  <div>
                    <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1 flex items-center gap-1">
                      <User className="w-3 h-3" /> Pelanggan
                    </p>
                    <p className="text-zinc-900 dark:text-zinc-100">
                      {detail.customer_name}
                    </p>
                  </div>
                )}
                {detail.customer_phone && (
                  <div>
                    <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> No. HP
                    </p>
                    <p className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                      {detail.customer_phone}
                    </p>
                  </div>
                )}
                {isReturnRow && detail.original_receipt_no && (
                  <div className="col-span-2">
                    <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1">
                      Retur dari struk
                    </p>
                    <p className="font-mono text-zinc-900 dark:text-zinc-100">
                      {detail.original_receipt_no}
                    </p>
                  </div>
                )}
              </div>

              {detail.void_reason && (
                <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                  <StickyNote className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      {detail.status === "VOID"
                        ? "Alasan void"
                        : "Alasan retur"}
                    </p>
                    <p>{detail.void_reason}</p>
                  </div>
                </div>
              )}

              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
                        Produk
                      </th>
                      <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
                        Qty
                      </th>
                      <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
                        Subtotal
                      </th>
                      {mode === "retur" && (
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
                          Retur
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {detail.items.map((item) => {
                      const sisa = remainingQty(
                        item.id,
                        item.qty,
                        item.returned_qty,
                      );
                      return (
                        <tr key={item.id}>
                          <td className="px-3 py-2">
                            <p className="text-zinc-900 dark:text-zinc-100">
                              {item.product_name}
                            </p>
                            {item.returned_qty > 0 && (
                              <p className="text-[10px] text-lco-mustard font-mono tabular-nums">
                                {item.returned_qty} sudah diretur
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                            {item.qty}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                            {formatRupiah(item.subtotal)}
                          </td>
                          {mode === "retur" && (
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={sisa}
                                disabled={sisa <= 0}
                                value={returnQtyById[item.id] ?? 0}
                                onChange={(e) => {
                                  const raw = Number(e.target.value);
                                  const clamped = Math.max(
                                    0,
                                    Math.min(sisa, isNaN(raw) ? 0 : raw),
                                  );
                                  setReturnQtyById((prev) => ({
                                    ...prev,
                                    [item.id]: clamped,
                                  }));
                                }}
                                className="w-16 px-2 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md text-right font-mono tabular-nums text-xs focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal disabled:opacity-40"
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1.5 text-sm border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <div className="flex justify-between text-zinc-500 text-xs">
                  <span>
                    {isReturnRow ? "Nilai barang diretur" : "Subtotal"}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatRupiah(detail.subtotal)}
                  </span>
                </div>
                {detail.discount > 0 && (
                  <div className="flex justify-between text-zinc-500 text-xs">
                    <span>Diskon</span>
                    <span className="font-mono tabular-nums">
                      -{formatRupiah(detail.discount)}
                    </span>
                  </div>
                )}
                {detail.tax > 0 && (
                  <div className="flex justify-between text-zinc-500 text-xs">
                    <span>Pajak</span>
                    <span className="font-mono tabular-nums">
                      {formatRupiah(detail.tax)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-base pt-2">
                  <span>{isReturnRow ? "Dana dikembalikan" : "Total"}</span>
                  <span className="font-mono tabular-nums text-lco-teal">
                    {formatRupiah(
                      isReturnRow ? Math.abs(detail.total) : detail.total,
                    )}
                  </span>
                </div>
                {detail.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="pt-2 flex flex-col gap-2 border-t border-zinc-100 dark:border-zinc-800/50 mt-2 first:border-0 first:mt-0"
                  >
                    <div className="flex justify-between text-zinc-500 text-xs">
                      <span>
                        {isReturnRow
                          ? `Refund ${methodLabel(payment.method)}`
                          : methodLabel(payment.method)}
                      </span>
                      <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                        {formatRupiah(
                          isReturnRow
                            ? Math.abs(payment.amount)
                            : payment.amount,
                        )}
                      </span>
                    </div>
                    {payment.method === "TEMPO" && payment.due_date && (
                      <div className="flex justify-between text-zinc-500 text-xs">
                        <span>Jatuh Tempo</span>
                        <span className="font-mono tabular-nums text-lco-coral font-medium">
                          {formatDate(payment.due_date).split(" ")[0]}
                        </span>
                      </div>
                    )}
                    {isReturnRow && payment.notes && (
                      <p className="text-[11px] text-zinc-400">
                        {payment.notes}
                      </p>
                    )}
                  </div>
                ))}
                {!isReturnRow &&
                  (detail.points_earned > 0 || detail.points_redeemed > 0) && (
                    <div className="flex justify-between text-zinc-500 text-xs pt-2 border-t border-zinc-100 dark:border-zinc-800/50 mt-2">
                      <span>Poin</span>
                      <span className="font-mono tabular-nums">
                        {detail.points_earned > 0 &&
                          `+${detail.points_earned} didapat`}
                        {detail.points_earned > 0 &&
                          detail.points_redeemed > 0 &&
                          " · "}
                        {detail.points_redeemed > 0 &&
                          `-${detail.points_redeemed} dipakai`}
                      </span>
                    </div>
                  )}
              </div>

              {/* ── TAMBAHAN (037) ── Peringatan + riwayat retur */}
              {isReturnRow && returnRowSummary && (
                <RefundWarnings
                  digital={returnRowSummary.digital}
                  unrecorded={returnRowSummary.unrecorded}
                />
              )}

              {!isReturnRow && returnList.length > 0 && returnsSummary && (
                <div className="space-y-3">
                  <RefundWarnings
                    digital={returnsSummary.digital}
                    unrecorded={returnsSummary.unrecorded}
                    digitalRefs={digitalRefs}
                    tempoSettled={tempoSettled}
                  />

                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Riwayat Retur ({returnList.length})
                      </p>
                      <p className="text-xs font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        Total kembali {formatRupiah(returnsSummary.refundTotal)}
                      </p>
                    </div>
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {returnList.map((ret) => (
                        <div key={ret.id} className="p-3 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                              {ret.receipt_no}
                            </p>
                            <p className="font-mono tabular-nums text-lco-mustard font-semibold">
                              {formatRupiah(ret.refund_amount)}
                            </p>
                          </div>
                          <p className="text-zinc-400 font-mono tabular-nums">
                            {formatDate(ret.created_at)}
                            {ret.cashier_name ? ` · ${ret.cashier_name}` : ""}
                          </p>
                          <ul className="text-zinc-700 dark:text-zinc-300">
                            {ret.items.map((item) => (
                              <li key={item.id}>
                                {item.product_name}{" "}
                                <span className="font-mono tabular-nums text-zinc-500">
                                  × {item.qty}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {ret.payments.length > 0 && (
                            <p className="text-zinc-500">
                              {ret.payments
                                .map(
                                  (pay) =>
                                    `${methodLabel(pay.method)} ${formatRupiah(Math.abs(pay.amount))}`,
                                )
                                .join(" · ")}
                            </p>
                          )}
                          {ret.reason && (
                            <p className="text-zinc-500">
                              Alasan: {ret.reason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {actionSuccess && (
                <div className="rounded-md border border-lco-teal/30 bg-lco-teal/10 p-3 text-xs text-lco-teal">
                  {actionSuccess}
                </div>
              )}
              {actionError && (
                <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{actionError}</p>
                </div>
              )}

              {mode === "retur" && (
                <div className="space-y-3 rounded-xl border border-lco-mustard/40 bg-lco-mustard/10 p-4">
                  {/* ── TAMBAHAN (037/039) ── Pratinjau dana kembali. Angka final
                      dihitung server; bisa beda beberapa rupiah (pembulatan). */}
                  <div className="rounded-md border border-lco-mustard/30 bg-white/60 dark:bg-zinc-950/60 p-3 text-xs space-y-1.5">
                    {returnEstimate && returnEstimate.refundTotal > 0 ? (
                      <>
                        <div className="flex justify-between font-semibold text-zinc-900 dark:text-zinc-100">
                          <span>Perkiraan dana kembali</span>
                          <span className="font-mono tabular-nums">
                            {formatRupiah(returnEstimate.refundTotal)}
                          </span>
                        </div>
                        {returnEstimate.cash > 0 && (
                          <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                            <span>Tunai (dari laci kasir)</span>
                            <span className="font-mono tabular-nums">
                              {formatRupiah(returnEstimate.cash)}
                            </span>
                          </div>
                        )}
                        {returnEstimate.digital > 0 && (
                          <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                            <span>Digital (proses manual di Midtrans)</span>
                            <span className="font-mono tabular-nums">
                              {formatRupiah(returnEstimate.digital)}
                            </span>
                          </div>
                        )}
                        {returnEstimate.unrecorded > 0 && (
                          <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                            <span>
                              Bagian piutang (tagihan tidak otomatis berkurang)
                            </span>
                            <span className="font-mono tabular-nums">
                              {formatRupiah(returnEstimate.unrecorded)}
                            </span>
                          </div>
                        )}
                        {returnEstimate.cash > 0 && (
                          <p className="flex items-start gap-1.5 text-zinc-500 pt-1">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                            Retur tunai butuh shift kasir yang sedang terbuka.
                          </p>
                        )}
                        {(detail.points_earned > 0 ||
                          detail.points_redeemed > 0) && (
                          <p className="flex items-start gap-1.5 text-zinc-500">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                            Poin pelanggan ikut disesuaikan: poin yang didapat
                            dicabut dan poin yang dipakai dikembalikan,
                            sebanding dengan barang yang diretur.
                          </p>
                        )}
                        <p className="text-[10px] text-zinc-400">
                          Perkiraan — angka final dihitung server dan bisa
                          berbeda beberapa rupiah karena pembulatan.
                        </p>
                      </>
                    ) : (
                      <p className="text-zinc-500">
                        Isi jumlah barang yang diretur untuk melihat perkiraan
                        dana kembali.
                      </p>
                    )}
                  </div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Alasan Retur
                  </label>
                  <textarea
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    rows={2}
                    placeholder="Contoh: ukuran tidak sesuai, barang cacat, dll."
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => setMode("detail")}
                      disabled={isSubmitting}
                      className="flex-1 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 disabled:opacity-50"
                    >
                      Batal
                    </button>
                    <button
                      onClick={handleSubmitReturn}
                      disabled={isSubmitting}
                      className="flex-1 py-2 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-xs font-semibold transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSubmitting && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Proses Retur
                    </button>
                  </div>
                </div>
              )}

              {mode === "void" && (
                <div className="space-y-3 rounded-xl border border-lco-coral/40 bg-lco-coral/10 p-4">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Alasan Void
                  </label>
                  <textarea
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    rows={2}
                    placeholder="Contoh: salah input, transaksi ganda, dll."
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal"
                  />
                  <p className="text-[11px] text-lco-coral">
                    Seluruh item pada transaksi ini akan dibatalkan dan stok
                    yang belum diretur akan dikembalikan.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setMode("detail")}
                      disabled={isSubmitting}
                      className="flex-1 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 disabled:opacity-50"
                    >
                      Batal
                    </button>
                    <button
                      onClick={handleSubmitVoid}
                      disabled={isSubmitting}
                      className="flex-1 py-2 rounded-md bg-lco-coral hover:opacity-90 text-white text-xs font-semibold transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSubmitting && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Ya, Void Transaksi
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {detail && mode === "detail" && (
          <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex flex-wrap gap-3">
            {/* Dropdown Cetak Ulang yang Mendukung Thermal dan Nota */}
            <div className="relative flex-1 min-w-32">
              <button
                onClick={() => setIsPrintDropdownOpen(!isPrintDropdownOpen)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-lco-teal hover:text-lco-teal text-xs font-semibold transition-colors duration-150"
              >
                <Printer className="w-4 h-4" />
                Cetak Ulang
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${isPrintDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isPrintDropdownOpen && (
                <div className="absolute bottom-full left-0 w-full mb-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-lg overflow-hidden z-10">
                  <button
                    onClick={() => handleReprint("thermal")}
                    className="w-full text-left px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium transition-colors"
                  >
                    Struk Thermal
                  </button>
                  <button
                    onClick={() => handleReprint("nota")}
                    className="w-full text-left px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium border-t border-zinc-100 dark:border-zinc-800 transition-colors"
                  >
                    Nota Kertas
                  </button>
                </div>
              )}
            </div>

            {/* ── TAMBAHAN (T-08 lanjutan) ── Kirim struk digital ke WhatsApp.
                Tombol tetap aktif walau `detail.customer_phone` kosong —
                lihat catatan di handleShareWhatsApp(). */}
            <button
              onClick={handleShareWhatsApp}
              disabled={isSharingWa}
              className="flex-1 min-w-32 flex items-center justify-center gap-2 py-2.5 rounded-md border border-lco-teal/50 bg-white dark:bg-zinc-950 text-lco-teal hover:bg-lco-teal/10 text-xs font-semibold transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSharingWa ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MessageCircle className="w-4 h-4" />
              )}
              Kirim WA
            </button>

            {canRetur && canStillReturn && (
              <button
                onClick={() => {
                  setActionError(null);
                  setActionSuccess(null);
                  setMode("retur");
                  setIsPrintDropdownOpen(false);
                }}
                className="flex-1 min-w-32 flex items-center justify-center gap-2 py-2.5 rounded-md border border-lco-mustard/50 bg-white dark:bg-zinc-950 text-lco-mustard hover:bg-lco-mustard/10 text-xs font-semibold transition-colors duration-150"
              >
                <Undo2 className="w-4 h-4" />
                Retur
              </button>
            )}
            {canVoid && canStillVoid && (
              <button
                onClick={() => {
                  setActionError(null);
                  setActionSuccess(null);
                  setMode("void");
                  setIsPrintDropdownOpen(false);
                }}
                className="flex-1 min-w-32 flex items-center justify-center gap-2 py-2.5 rounded-md border border-lco-coral/50 bg-white dark:bg-zinc-950 text-lco-coral hover:bg-lco-coral/10 text-xs font-semibold transition-colors duration-150"
              >
                <Ban className="w-4 h-4" />
                Void
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
