// app/components/stok/BarangMasukTab.tsx
// ── TAMBAHAN (Fase 3 perbaikan Stok & Opname) ── Tab "Barang Masuk": daftar
// dokumen penerimaan barang, tombol catat baru, dan membuka detail/form.
// Sebelumnya stok hanya bisa bertambah lewat Penyesuaian dengan alasan
// "koreksi" — tidak ada jejak supplier, nomor nota, atau harga beli.

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Inbox,
  Loader2,
  PackagePlus,
  Plus,
} from "lucide-react";
import { useStockReceipts } from "@/hooks/useStockReceipts";
import type { ProductWithCategory } from "@/hooks/useProducts";
import ReceiptForm from "./ReceiptForm";
import ReceiptDetail from "./ReceiptDetail";
import { formatDateOnly, formatNumber, formatRupiah } from "./stokUtils";

type View =
  | { kind: "list" }
  | { kind: "form" }
  | { kind: "detail"; receiptId: string };

interface BarangMasukTabProps {
  products: ProductWithCategory[];
  /** Boleh mencatat & membatalkan barang masuk (izin stok:edit). */
  canEdit: boolean;
  /** Dipanggil saat stok berubah (barang masuk dicatat / dibatalkan). */
  onStockChanged: () => void;
}

export default function BarangMasukTab({
  products,
  canEdit,
  onStockChanged,
}: BarangMasukTabProps) {
  const { receipts, isLoading, error, refetch, receiveStock } =
    useStockReceipts();

  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "form") {
    return (
      <ReceiptForm
        products={products}
        onBack={() => setView({ kind: "list" })}
        onSubmit={receiveStock}
        onSaved={(result) => {
          onStockChanged();
          setView({ kind: "detail", receiptId: result.receiptId });
        }}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <ReceiptDetail
        receiptId={view.receiptId}
        canEdit={canEdit}
        onBack={() => setView({ kind: "list" })}
        onChanged={() => {
          refetch();
          onStockChanged();
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-zinc-500">
          Catat barang yang diterima dari supplier supaya stok bertambah lengkap
          dengan tanggal, nomor nota, dan harga beli.
        </p>

        {canEdit && (
          <button
            type="button"
            onClick={() => setView({ kind: "form" })}
            className="flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
          >
            <Plus className="h-4 w-4" />
            Catat Barang Masuk
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat barang masuk...
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-sm text-lco-coral">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : receipts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Belum ada barang masuk yang dicatat.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-3">Dokumen</th>
                  <th className="px-4 py-3">Tanggal Terima</th>
                  <th className="px-4 py-3">Supplier / Referensi</th>
                  <th className="px-4 py-3 text-right">Produk</th>
                  <th className="px-4 py-3 text-right">Unit</th>
                  <th className="px-4 py-3 text-right">Nilai</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {receipts.map((receipt) => (
                  <tr
                    key={receipt.id}
                    onClick={() =>
                      setView({ kind: "detail", receiptId: receipt.id })
                    }
                    className="cursor-pointer transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-1.5 font-medium">
                        <PackagePlus className="h-3.5 w-3.5 text-zinc-400" />#
                        {receipt.number}
                      </p>
                      {receipt.created_by_name && (
                        <p className="text-[11px] text-zinc-400">
                          {receipt.created_by_name}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                      {formatDateOnly(receipt.received_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {receipt.supplier ?? "-"}
                      {receipt.reference_no && (
                        <span className="block font-mono text-[11px] text-zinc-400">
                          {receipt.reference_no}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {formatNumber(receipt.item_count)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {formatNumber(receipt.total_qty)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {receipt.total_cost > 0
                        ? formatRupiah(receipt.total_cost)
                        : "-"}
                    </td>
                    <td
                      className={`px-4 py-3 text-xs font-semibold ${
                        receipt.status === "voided"
                          ? "text-zinc-500 dark:text-zinc-400"
                          : "text-lco-green dark:text-lco-teal"
                      }`}
                    >
                      {receipt.status === "voided" ? "Dibatalkan" : "Selesai"}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
