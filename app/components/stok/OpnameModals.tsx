// app/components/stok/OpnameModals.tsx
// ── TAMBAHAN (Fase 2 perbaikan Stok & Opname) ── Tiga modal sesi opname:
//   - OpnameStartModal    : mulai sesi baru (nama, cakupan, catatan).
//   - OpnameFinalizeModal : tinjau selisih lalu terapkan ke stok.
//   - OpnameCancelModal   : batalkan sesi (alasan wajib).
//   - OpnamePrintModal    : pilihan cetak lembar hitung (Fase 3).
// Gaya mengikuti AdjustStockModal supaya tampilan modal di menu Stok seragam.

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  X,
} from "lucide-react";
import type { Category } from "@/lib/pos/types";
import type { ProductWithCategory } from "@/hooks/useProducts";
import type {
  FinalizeOpnameResult,
  OpnameItem,
  OpnameSession,
} from "@/hooks/useOpname";
import {
  deltaColorClass,
  formatDelta,
  formatNumber,
  formatRupiah,
} from "./stokUtils";
import { itemDiff, type OpnameStats } from "./opnameUtils";
import { printCountSheet } from "./stokPrint";

const overlayClass =
  "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4";
const dialogClass =
  "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950";
const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950";
const labelClass = "mb-1 block text-xs font-medium text-zinc-500";
const primaryButtonClass =
  "flex w-full items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-60";
const dangerButtonClass =
  "flex w-full items-center justify-center gap-2 rounded-md bg-lco-coral px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function ModalHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <ClipboardList className="h-4 w-4 text-lco-teal" />
        {title}
      </h3>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup"
        className="text-zinc-400 transition-colors duration-150 hover:text-zinc-600 dark:hover:text-zinc-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// =====================================================================
// Mulai sesi
// =====================================================================

export function OpnameStartModal({
  products,
  categories,
  onClose,
  onStart,
}: {
  products: ProductWithCategory[];
  categories: Category[];
  onClose: () => void;
  onStart: (params: {
    name: string;
    categoryId: string | null;
    note: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Produk yang akan ikut dihitung: fisik (bukan jasa) dalam cakupan terpilih.
  // Angka ini hanya petunjuk — daftar final ditentukan database saat sesi dibuat.
  const productCount = useMemo(
    () =>
      products.filter(
        (product) =>
          !product.is_service &&
          product.type !== "JASA" &&
          (categoryId === "" || product.category_id === categoryId),
      ).length,
    [products, categoryId],
  );

  const handleStart = async () => {
    setError(null);
    setIsSaving(true);

    try {
      await onStart({
        name,
        categoryId: categoryId === "" ? null : categoryId,
        note,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memulai sesi opname.");
      setIsSaving(false);
    }
  };

  return (
    <div className={overlayClass}>
      <div className={dialogClass}>
        <ModalHeader title="Mulai Opname Baru" onClose={onClose} />

        <div className="space-y-4">
          <div>
            <label className={labelClass}>Nama sesi (opsional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Opname rak kaos akhir bulan"
              className={inputClass}
              disabled={isSaving}
            />
          </div>

          <div>
            <label className={labelClass}>Cakupan produk</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClass}
              disabled={isSaving}
            >
              <option value="">Semua produk berstok</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  Kategori: {category.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-400">
              {formatNumber(productCount)} produk akan masuk daftar hitung.
              Produk jasa dan produk yang sudah dihapus tidak ikut.
            </p>
          </div>

          <div>
            <label className={labelClass}>Catatan (opsional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className={inputClass}
              disabled={isSaving}
            />
          </div>

          <p className="rounded-md border border-zinc-200 p-3 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Toko tetap boleh berjualan selama opname. Selisih dihitung terhadap
            stok sistem pada saat tiap produk dihitung, jadi penjualan di
            tengah opname tidak dianggap selisih. Satu produk hanya bisa ada di
            satu sesi yang sedang berjalan.
          </p>
        </div>

        {error && <ErrorBox message={error} />}

        <button
          type="button"
          onClick={handleStart}
          disabled={isSaving || productCount === 0}
          className={`${primaryButtonClass} mt-5`}
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Membuat sesi...
            </>
          ) : (
            "Mulai Opname"
          )}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Selesaikan sesi (tinjau selisih)
// =====================================================================

const TOP_DIFF_LIMIT = 5;

export function OpnameFinalizeModal({
  sessionNumber,
  items,
  stats,
  onClose,
  onFinalize,
  onDone,
}: {
  sessionNumber: number;
  items: OpnameItem[];
  stats: OpnameStats;
  onClose: () => void;
  onFinalize: () => Promise<FinalizeOpnameResult>;
  /** Dipanggil saat modal ditutup setelah sukses (untuk refresh data stok). */
  onDone: () => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeOpnameResult | null>(null);

  // Selisih terbesar (menurut nilai rupiah, lalu jumlah unit) untuk ditinjau
  // sebelum diterapkan — yang paling berisiko salah hitung biasanya di sini.
  const topDiffs = useMemo(
    () =>
      items
        .filter((item) => {
          const diff = itemDiff(item);
          return diff !== null && diff !== 0;
        })
        .sort((a, b) => {
          const diffA = Math.abs(itemDiff(a) ?? 0);
          const diffB = Math.abs(itemDiff(b) ?? 0);
          const valueA = diffA * (a.cost_price ?? 0);
          const valueB = diffB * (b.cost_price ?? 0);
          return valueB - valueA || diffB - diffA;
        })
        .slice(0, TOP_DIFF_LIMIT),
    [items],
  );

  const handleFinalize = async () => {
    setError(null);
    setIsSaving(true);

    try {
      const finalized = await onFinalize();
      setResult(finalized);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyelesaikan opname.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (result) onDone();
    onClose();
  };

  if (result) {
    return (
      <div className={overlayClass}>
        <div className={dialogClass}>
          <ModalHeader title={`Opname #${result.number} Selesai`} onClose={handleClose} />

          <div className="flex items-start gap-2 text-sm text-lco-green dark:text-lco-teal">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Selisih sudah diterapkan ke stok dan tercatat di riwayat mutasi.</span>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-zinc-500">Produk disesuaikan</dt>
              <dd className="font-mono tabular-nums">
                {formatNumber(result.adjusted_count)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-500">Produk cocok (tanpa selisih)</dt>
              <dd className="font-mono tabular-nums">
                {formatNumber(result.matched_count)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-500">Belum dihitung (tidak diubah)</dt>
              <dd className="font-mono tabular-nums">
                {formatNumber(result.uncounted_count)}
              </dd>
            </div>
            {result.skipped_count > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Dilewati (produk dihapus / jadi jasa)</dt>
                <dd className="font-mono tabular-nums">
                  {formatNumber(result.skipped_count)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <dt className="font-medium">Selisih nilai</dt>
              <dd
                className={`font-mono font-semibold tabular-nums ${deltaColorClass(result.diff_value)}`}
              >
                {result.diff_value === 0
                  ? formatRupiah(0)
                  : `${result.diff_value > 0 ? "+" : "-"}${formatRupiah(Math.abs(result.diff_value))}`}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={handleClose}
            className={`${primaryButtonClass} mt-5`}
          >
            Tutup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={overlayClass}>
      <div className={dialogClass}>
        <ModalHeader title={`Selesaikan Opname #${sessionNumber}`} onClose={onClose} />

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tinjau ringkasan di bawah. Setelah diterapkan, stok berubah dan sesi
          ini tidak bisa diubah lagi.
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500">Produk dihitung</dt>
            <dd className="font-mono tabular-nums">
              {formatNumber(stats.counted)} dari {formatNumber(stats.total)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500">Cocok dengan stok sistem</dt>
            <dd className="font-mono tabular-nums">{formatNumber(stats.matched)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500">Ada selisih</dt>
            <dd className="font-mono tabular-nums">{formatNumber(stats.withDiff)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500">Stok lebih / kurang</dt>
            <dd className="font-mono tabular-nums">
              <span className="text-lco-green dark:text-lco-teal">
                +{formatNumber(stats.plusQty)}
              </span>
              {" / "}
              <span className="text-lco-coral">-{formatNumber(stats.minusQty)}</span>
            </dd>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <dt className="font-medium">Selisih nilai (harga modal)</dt>
            <dd
              className={`font-mono font-semibold tabular-nums ${deltaColorClass(stats.diffValue)}`}
            >
              {stats.diffValue === 0
                ? formatRupiah(0)
                : `${stats.diffValue > 0 ? "+" : "-"}${formatRupiah(Math.abs(stats.diffValue))}`}
            </dd>
          </div>
        </dl>

        {stats.uncounted > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-lco-mustard/40 p-3 text-xs text-zinc-600 dark:text-zinc-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lco-mustard" />
            <span>
              {formatNumber(stats.uncounted)} produk belum dihitung. Stoknya
              tidak akan diubah.
            </span>
          </div>
        )}

        {topDiffs.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Selisih terbesar
            </p>
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 text-sm dark:divide-zinc-900 dark:border-zinc-800">
              {topDiffs.map((item) => {
                const diff = itemDiff(item) ?? 0;
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="truncate">{item.product_name}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-500">
                      {formatNumber(item.system_qty)} →{" "}
                      {formatNumber(item.counted_qty ?? 0)}{" "}
                      <span className={`font-semibold ${deltaColorClass(diff)}`}>
                        ({formatDelta(diff)})
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {error && <ErrorBox message={error} />}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Kembali
          </button>
          <button
            type="button"
            onClick={handleFinalize}
            disabled={isSaving || stats.counted === 0}
            className={primaryButtonClass}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Menerapkan...
              </>
            ) : (
              "Terapkan ke Stok"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Batalkan sesi
// =====================================================================

export function OpnameCancelModal({
  sessionNumber,
  countedCount,
  onClose,
  onCancel,
}: {
  sessionNumber: number;
  countedCount: number;
  onClose: () => void;
  onCancel: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    setError(null);
    setIsSaving(true);

    try {
      await onCancel(reason);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal membatalkan sesi opname.",
      );
      setIsSaving(false);
    }
  };

  return (
    <div className={overlayClass}>
      <div className={dialogClass}>
        <ModalHeader title={`Batalkan Opname #${sessionNumber}`} onClose={onClose} />

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Stok tidak akan berubah sama sekali.
          {countedCount > 0
            ? ` ${formatNumber(countedCount)} hasil hitungan yang sudah diisi akan tetap tersimpan sebagai arsip, tapi tidak diterapkan.`
            : ""}
        </p>

        <div className="mt-4">
          <label className={labelClass}>Alasan pembatalan</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Wajib diisi — tersimpan di log aktivitas."
            className={inputClass}
            disabled={isSaving}
          />
        </div>

        {error && <ErrorBox message={error} />}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Kembali
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving || reason.trim() === ""}
            className={dangerButtonClass}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Membatalkan...
              </>
            ) : (
              "Batalkan Sesi"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Cetak lembar hitung
// =====================================================================

export function OpnamePrintModal({
  session,
  items,
  onClose,
}: {
  session: OpnameSession;
  items: OpnameItem[];
  onClose: () => void;
}) {
  const [showSystemQty, setShowSystemQty] = useState(false);
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uncountedCount = items.filter((item) => item.counted_qty === null).length;
  const printCount = onlyUncounted ? uncountedCount : items.length;

  const handlePrint = () => {
    setError(null);

    const printed = printCountSheet(session, items, {
      showSystemQty,
      onlyUncounted,
    });

    if (!printed) {
      setError("Tidak ada produk yang perlu dicetak.");
      return;
    }

    onClose();
  };

  return (
    <div className={overlayClass}>
      <div className={dialogClass}>
        <ModalHeader title="Cetak Lembar Hitung" onClose={onClose} />

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Lembar berisi daftar produk dengan kolom kosong untuk menulis hasil
          hitung di rak. Isi hasilnya ke layar ini setelah selesai menghitung.
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={showSystemQty}
              onChange={(e) => setShowSystemQty(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-lco-green"
            />
            <span>
              Cetak kolom Stok Sistem
              <span className="block text-xs text-zinc-400">
                Bawaan dimatikan (hitung buta): penghitung yang tahu angka
                sistem cenderung menyamakan hasilnya.
              </span>
            </span>
          </label>

          <label
            className={`flex items-start gap-2 text-sm ${
              uncountedCount === items.length ? "opacity-50" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={onlyUncounted}
              onChange={(e) => setOnlyUncounted(e.target.checked)}
              disabled={uncountedCount === items.length}
              className="mt-0.5 h-4 w-4 accent-lco-green"
            />
            <span>
              Hanya produk yang belum dihitung
              <span className="block text-xs text-zinc-400">
                Berguna kalau opname dilanjutkan di hari lain.
              </span>
            </span>
          </label>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          {formatNumber(printCount)} produk akan dicetak.
        </p>

        {error && <ErrorBox message={error} />}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={printCount === 0}
            className={primaryButtonClass}
          >
            Cetak
          </button>
        </div>
      </div>
    </div>
  );
}
