// app/components/hadiah/GiftDetail.tsx
// ── TAMBAHAN (migration 044) ── Detail satu dokumen Hadiah: penerima, daftar
// produk beserta harga modal (snapshot saat dicatat), total beban, dan
// pembatalan (alasan wajib; stok dikembalikan oleh database).

"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Gift, Loader2, X } from "lucide-react";
import {
  GIFT_CATEGORY_LABEL,
  useGift,
} from "@/hooks/useGifts";
import {
  formatDateOnly,
  formatDateTime,
  formatNumber,
  formatRupiah,
} from "../stok/stokUtils";

interface GiftDetailProps {
  giftId: string;
  /** Boleh membatalkan (izin hadiah:delete). */
  canVoid: boolean;
  onBack: () => void;
  /** Dipanggil saat dokumen berubah (dibatalkan) agar daftar & stok di-refresh. */
  onChanged: () => void;
}

export default function GiftDetail({
  giftId,
  canVoid,
  onBack,
  onChanged,
}: GiftDetailProps) {
  const { gift, items, isLoading, error, voidGift } = useGift(giftId);

  const [showVoid, setShowVoid] = useState(false);
  const [reason, setReason] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const handleVoid = async () => {
    setVoidError(null);
    setIsVoiding(true);

    try {
      await voidGift(reason);
      onChanged();
      setShowVoid(false);
      setReason("");
    } catch (err) {
      setVoidError(
        err instanceof Error ? err.message : "Gagal membatalkan hadiah.",
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
      Kembali ke daftar hadiah
    </button>
  );

  if (isLoading && !gift) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat hadiah...
      </div>
    );
  }

  if (error || !gift) {
    return (
      <div>
        {backButton}
        <div className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-lco-coral dark:border-zinc-800 dark:bg-zinc-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error ?? "Hadiah tidak ditemukan."}
        </div>
      </div>
    );
  }

  const isVoided = gift.status === "voided";

  return (
    <div>
      {backButton}

      <div className={`${cardClass} mb-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold">
              <Gift className="h-4 w-4 text-lco-teal" />
              Hadiah #{gift.number}
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
              {formatDateOnly(gift.given_at)} · untuk{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {gift.recipient_name}
              </span>{" "}
              ({GIFT_CATEGORY_LABEL[gift.recipient_category]})
            </p>
            {gift.occasion && (
              <p className="mt-0.5 text-xs text-zinc-500">
                Keperluan: {gift.occasion}
              </p>
            )}
            {gift.note && (
              <p className="mt-0.5 text-xs text-zinc-500">{gift.note}</p>
            )}
            <p className="mt-1 text-xs text-zinc-400">
              Dicatat {formatDateTime(gift.created_at)}
              {gift.created_by_name ? ` oleh ${gift.created_by_name}` : ""}
            </p>
            {isVoided && (
              <p className="mt-2 text-xs text-lco-coral">
                Dibatalkan{" "}
                {gift.voided_at ? formatDateTime(gift.voided_at) : ""}
                {gift.voided_by_name ? ` oleh ${gift.voided_by_name}` : ""}
                {gift.void_reason ? ` — ${gift.void_reason}` : ""}. Stok sudah
                dikembalikan.
              </p>
            )}
          </div>

          {canVoid && !isVoided && (
            <button
              type="button"
              onClick={() => setShowVoid(true)}
              className="flex items-center justify-center gap-2 rounded-md border border-lco-coral/50 px-3 py-2 text-sm font-medium text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10"
            >
              <Ban className="h-4 w-4" />
              Batalkan Hadiah
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-3 dark:border-zinc-900">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Total unit
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {formatNumber(gift.total_qty)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Beban hadiah (harga modal)
            </p>
            <p
              className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                isVoided ? "text-zinc-400 line-through" : "text-lco-coral"
              }`}
            >
              {formatRupiah(gift.total_cost)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Nilai jika dijual
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-500">
              {formatRupiah(gift.total_retail)}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-3">Produk</th>
                <th className="px-4 py-3 text-right">Jumlah</th>
                <th className="px-4 py-3 text-right">Harga Modal</th>
                <th className="px-4 py-3 text-right">Nilai (Modal)</th>
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
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {item.unit_cost > 0 ? (
                      formatRupiah(item.unit_cost)
                    ) : (
                      <span className="text-lco-mustard">Belum diisi</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatRupiah(item.qty * item.unit_cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">
                  Batalkan Hadiah #{gift.number}?
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Stok semua produk di hadiah ini akan dikembalikan, dan
                  nilainya tidak lagi dihitung sebagai beban hadiah. Gunakan
                  hanya kalau hadiah salah input.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowVoid(false);
                  setVoidError(null);
                }}
                disabled={isVoiding}
                aria-label="Tutup"
                className="rounded-md p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Alasan pembatalan (wajib)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isVoiding}
              rows={3}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />

            {voidError && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-lco-coral">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {voidError}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowVoid(false);
                  setVoidError(null);
                }}
                disabled={isVoiding}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={isVoiding || reason.trim() === ""}
                className="flex items-center gap-2 rounded-md bg-lco-coral px-4 py-2 text-sm font-semibold text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {isVoiding && <Loader2 className="h-4 w-4 animate-spin" />}
                Ya, Batalkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
