// app/components/stok/ReceiptDetail.tsx
// ── TAMBAHAN (Fase 3 perbaikan Stok & Opname) ── Detail satu dokumen Barang
// Masuk: header, daftar produk beserta jumlah & harga beli, dan pembatalan
// (alasan wajib; ditolak database kalau stok sekarang tidak cukup).

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Loader2,
  PackagePlus,
  X,
} from "lucide-react";
import { useStockReceipt } from "@/hooks/useStockReceipts";
import {
  formatDateOnly,
  formatDateTime,
  formatNumber,
  formatRupiah,
} from "./stokUtils";

interface ReceiptDetailProps {
  receiptId: string;
  /** Boleh membatalkan (izin stok:edit). */
  canEdit: boolean;
  onBack: () => void;
  /** Dipanggil saat dokumen berubah (dibatalkan) agar daftar & stok di-refresh. */
  onChanged: () => void;
}

export default function ReceiptDetail({
  receiptId,
  canEdit,
  onBack,
  onChanged,
}: ReceiptDetailProps) {
  const { receipt, items, isLoading, error, voidReceipt } =
    useStockReceipt(receiptId);

  const [showVoid, setShowVoid] = useState(false);
  const [reason, setReason] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const handleVoid = async () => {
    setVoidError(null);
    setIsVoiding(true);

    try {
      await voidReceipt(reason);
      onChanged();
      setShowVoid(false);
      setReason("");
    } catch (err) {
      setVoidError(
        err instanceof Error ? err.message : "Gagal membatalkan barang masuk.",
      );
    } finally {
      setIsVoiding(false);
    }
  };

  const cardClass =
    "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 flex items-center gap-1.5 text-sm text-zinc-500 transition-colors duration-150 hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      <ArrowLeft className="h-4 w-4" />
      Kembali ke daftar barang masuk
    </button>
  );

  if (isLoading && !receipt) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat barang masuk...
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div>
        {backButton}
        <div className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-lco-coral dark:border-zinc-800 dark:bg-zinc-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error ?? "Barang masuk tidak ditemukan."}
        </div>
      </div>
    );
  }

  const isVoided = receipt.status === "voided";

  return (
    <div>
      {backButton}

      <div className={`${cardClass} mb-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold">
              <PackagePlus className="h-4 w-4 text-lco-teal" />
              Barang Masuk #{receipt.number}
              <span
                className={`text-xs font-semibold ${
                  isVoided
                    ? "text-zinc-500 dark:text-zinc-400"
                    : "text-lco-green dark:text-lco-teal"
                }`}
              >
                {isVoided ? "Dibatalkan" : "Selesai"}
              </span>
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Diterima {formatDateOnly(receipt.received_at)}
              {receipt.supplier ? ` dari ${receipt.supplier}` : ""}
            </p>
            {receipt.reference_no && (
              <p className="mt-0.5 text-xs text-zinc-500">
                No. referensi: {receipt.reference_no}
              </p>
            )}
            {receipt.note && (
              <p className="mt-0.5 text-xs text-zinc-500">{receipt.note}</p>
            )}
            <p className="mt-1 text-xs text-zinc-400">
              Dicatat {formatDateTime(receipt.created_at)}
              {receipt.created_by_name ? ` oleh ${receipt.created_by_name}` : ""}
              {receipt.cost_updated ? " · harga modal produk diperbarui" : ""}
            </p>
            {isVoided && (
              <p className="mt-1 text-xs text-zinc-500">
                Dibatalkan
                {receipt.voided_at ? ` ${formatDateTime(receipt.voided_at)}` : ""}
                {receipt.voided_by_name ? ` oleh ${receipt.voided_by_name}` : ""}
                {receipt.void_reason ? ` — ${receipt.void_reason}` : ""}
              </p>
            )}
          </div>

          {canEdit && !isVoided && (
            <button
              type="button"
              onClick={() => setShowVoid(true)}
              className="flex items-center justify-center gap-2 self-start rounded-md border border-zinc-300 px-3.5 py-2 text-sm font-medium text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 dark:border-zinc-700"
            >
              <Ban className="h-4 w-4" />
              Batalkan
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-3">Produk</th>
                <th className="px-4 py-3 text-right">Jumlah</th>
                <th className="px-4 py-3 text-right">Harga Beli</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{item.product_name}</p>
                    <p className="font-mono text-[11px] text-zinc-400">
                      {item.product_sku ?? "-"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatNumber(item.qty)}
                    {item.product_unit && (
                      <span className="ml-1 text-[11px] text-zinc-400">
                        {item.product_unit}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                    {item.unit_cost === null ? "-" : formatRupiah(item.unit_cost)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {item.unit_cost === null
                      ? "-"
                      : formatRupiah(item.qty * item.unit_cost)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 text-sm font-semibold dark:border-zinc-800">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {formatNumber(receipt.total_qty)}
                </td>
                <td />
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {receipt.total_cost > 0 ? formatRupiah(receipt.total_cost) : "-"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {showVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold">
                Batalkan Barang Masuk #{receipt.number}
              </h3>
              <button
                type="button"
                onClick={() => setShowVoid(false)}
                disabled={isVoiding}
                aria-label="Tutup"
                className="text-zinc-400 transition-colors duration-150 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Stok tiap produk dikurangi sebesar jumlah yang dulu masuk dan
              tercatat sebagai Penyesuaian. Pembatalan ditolak kalau sebagian
              barang sudah terjual dan stok sekarang tidak cukup. Harga modal
              yang pernah diperbarui tidak dikembalikan otomatis.
            </p>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-zinc-500">
                Alasan pembatalan
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                disabled={isVoiding}
                placeholder="Wajib diisi — tersimpan di riwayat dan log aktivitas."
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>

            {voidError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{voidError}</span>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowVoid(false)}
                disabled={isVoiding}
                className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={isVoiding || reason.trim() === ""}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-lco-coral px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isVoiding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Membatalkan...
                  </>
                ) : (
                  "Batalkan Barang Masuk"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
