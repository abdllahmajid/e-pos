"use client";

// ── TAMBAHAN ── Modal ini mengisi 2 hal yang di PRD §15.2 masih ditandai belum ada:
// 1. Tombol "Lihat Detail & Cetak" (sebelumnya sengaja `disabled` di TransactionHistoryModule).
// 2. Retur (sebagian) & Void, memakai RPC `return_transaction` / `void_transaction` yang
//    sudah dibuat di migration 004_return_and_void.sql tapi belum pernah dipanggil frontend.
//
// Aturan permission (PRD §5): kasir cuma boleh lihat & cetak ulang. Retur & void hanya
// admin/supervisor — tombolnya disembunyikan untuk role lain, tapi RPC sendiri tetap
// validasi ulang role di server (jangan andalkan sembunyi tombol saja sebagai keamanan).

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
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  getTransactionDetail,
  returnTransaction,
  voidTransaction,
  type TransactionDetail,
} from "@/lib/pos/transactionApi";
import { printThermalReceipt } from "@/lib/pos/printLogic";
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
    BANK_TRANSFER: "Transfer Bank",
    QRIS: "QRIS",
    TEMPO: "Tempo / Piutang",
  };
  return labels[method] ?? method;
}

export default function TransactionDetailModal({
  transactionId,
  onClose,
  onChanged,
}: TransactionDetailModalProps) {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "supervisor";

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<PanelMode>("detail");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Retur form state: qty yang mau diretur per transaction_item.id
  const [returnQtyById, setReturnQtyById] = useState<Record<string, number>>(
    {},
  );
  const [returnReason, setReturnReason] = useState("");

  // Void form state
  const [voidReason, setVoidReason] = useState("");

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

  function handleReprint() {
    if (!detail) return;

    const primaryPayment = detail.payments[0];

    printThermalReceipt({
      receiptNo: detail.receipt_no,
      createdAt: detail.created_at,
      cashierName: detail.cashier_name,
      customerName: detail.customer_name,
      items: detail.items.map((item) => ({
        name: item.product_name,
        qty: item.qty,
        price: item.unit_price,
        subtotal: item.subtotal,
      })),
      subtotal: detail.subtotal,
      discount: detail.discount,
      tax: detail.tax,
      total: detail.total,
      method: primaryPayment?.method ?? "-",
      paidAmount:
        primaryPayment?.received_amount ??
        primaryPayment?.amount ??
        detail.total,
      changeAmount: primaryPayment?.change_amount ?? 0,
      isReprint: true,
    });
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

      setActionSuccess(
        `Retur berhasil — ${result.receipt_no}, dana kembali ${formatRupiah(result.refund_amount)}.`,
      );
      onChanged();

      // Muat ulang detail supaya returned_qty & status ter-update di modal ini juga.
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

  const canStillAct = detail?.status === "PAID";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="bg-white dark:bg-zinc-950 rounded-xl w-full max-w-xl max-h-[90vh] border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Riwayat Transaksi
            </p>
            <h2 className="font-mono font-semibold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
              {detail?.receipt_no ?? "Memuat..."}
            </h2>
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
              {/* Info umum */}
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

              {/* Item */}
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

              {/* Ringkasan pembayaran */}
              <div className="space-y-1.5 text-sm border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <div className="flex justify-between text-zinc-500 text-xs">
                  <span>Subtotal</span>
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
                  <span>Total</span>
                  <span className="font-mono tabular-nums text-lco-teal">
                    {formatRupiah(detail.total)}
                  </span>
                </div>
                {detail.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex justify-between text-zinc-500 text-xs pt-1"
                  >
                    <span>{methodLabel(payment.method)}</span>
                    <span className="font-mono tabular-nums">
                      {formatRupiah(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>

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

              {/* Panel Retur */}
              {mode === "retur" && (
                <div className="space-y-3 rounded-xl border border-lco-mustard/40 bg-lco-mustard/10 p-4">
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

              {/* Panel Void */}
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
            <button
              onClick={handleReprint}
              className="flex-1 min-w-32 flex items-center justify-center gap-2 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-lco-teal hover:text-lco-teal text-xs font-semibold transition-colors duration-150"
            >
              <Printer className="w-4 h-4" />
              Cetak Ulang Struk
            </button>

            {canManage && canStillAct && (
              <>
                <button
                  onClick={() => {
                    setActionError(null);
                    setActionSuccess(null);
                    setMode("retur");
                  }}
                  className="flex-1 min-w-32 flex items-center justify-center gap-2 py-2.5 rounded-md border border-lco-mustard/50 bg-white dark:bg-zinc-950 text-lco-mustard hover:bg-lco-mustard/10 text-xs font-semibold transition-colors duration-150"
                >
                  <Undo2 className="w-4 h-4" />
                  Retur
                </button>
                <button
                  onClick={() => {
                    setActionError(null);
                    setActionSuccess(null);
                    setMode("void");
                  }}
                  className="flex-1 min-w-32 flex items-center justify-center gap-2 py-2.5 rounded-md border border-lco-coral/50 bg-white dark:bg-zinc-950 text-lco-coral hover:bg-lco-coral/10 text-xs font-semibold transition-colors duration-150"
                >
                  <Ban className="w-4 h-4" />
                  Void
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
