// app/components/stok/StokRiwayatTab.tsx
// ── REVISI (Fase 1 perbaikan Stok & Opname) ── Riwayat mutasi (kartu stok).
// Dibanding versi sebelumnya:
// - Kolom Stok Sebelum / Stok Sesudah (dari view `stock_ledger`, migration 037).
// - Filter tanggal (+ pintasan Hari Ini / 7 Hari / 30 Hari), produk, dan jenis.
// - Paging, bukan lagi "150 baris terakhir".
// - Kartu Stok Masuk / Stok Keluar / Jumlah Mutasi dihitung di database untuk
//   SEMUA baris yang cocok dengan filter, bukan dijumlah dari baris yang tampil.
//
// Komponen ini murni tampilan: state filter & halaman dipegang StokModule supaya
// tidak hilang saat pindah tab.

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Inbox,
  ListChecks,
  Loader2,
  Search,
  X,
} from "lucide-react";
import {
  MOVEMENT_TYPE_LABEL,
  type StockMovement,
  type StockMovementType,
  type StockSummary,
} from "@/hooks/useStock";
import type { ProductWithCategory } from "@/hooks/useProducts";
import StokPagination from "./StokPagination";
import {
  deltaColorClass,
  formatDateTime,
  formatDelta,
  formatNumber,
  movementTypeColorClass,
  toDateInputValue,
} from "./stokUtils";

export interface RiwayatFilters {
  types: StockMovementType[];
  /** YYYY-MM-DD, kosong = tanpa batas. */
  dateFrom: string;
  dateTo: string;
  productId: string | null;
}

export const EMPTY_RIWAYAT_FILTERS: RiwayatFilters = {
  types: [],
  dateFrom: "",
  dateTo: "",
  productId: null,
};

const FILTER_TYPES: StockMovementType[] = [
  "sale",
  "return",
  "void",
  "opname",
  "adjustment",
];

interface StokRiwayatTabProps {
  movements: StockMovement[];
  totalCount: number;
  summary: StockSummary | null;
  isLoading: boolean;
  error: string | null;
  filters: RiwayatFilters;
  onFiltersChange: (partial: Partial<RiwayatFilters>) => void;
  onResetFilters: () => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Daftar produk untuk pemilih filter produk. */
  products: ProductWithCategory[];
}

// --------------------------------------------------------
// Pemilih produk untuk filter
// --------------------------------------------------------

function ProductFilter({
  products,
  productId,
  onChange,
}: {
  products: ProductWithCategory[];
  productId: string | null;
  onChange: (productId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const selected = productId
    ? (products.find((product) => product.id === productId) ?? null)
    : null;

  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return products
      .filter((product) => !product.is_service && product.type !== "JASA")
      .filter(
        (product) =>
          keyword === "" ||
          product.name.toLowerCase().includes(keyword) ||
          (product.sku ?? "").toLowerCase().includes(keyword),
      )
      .slice(0, 8);
  }, [products, query]);

  if (productId) {
    return (
      <div className="flex h-[38px] items-center justify-between gap-2 rounded-md border border-lco-teal px-3 text-sm">
        <span className="truncate">
          {selected ? selected.name : "Produk terpilih"}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Hapus filter produk"
          className="text-zinc-400 transition-colors duration-150 hover:text-lco-coral"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        placeholder="Semua produk"
        className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950"
      />

      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          {matches.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-zinc-400">
              Tidak ada produk cocok.
            </p>
          ) : (
            matches.map((product) => (
              <button
                key={product.id}
                type="button"
                // onMouseDown (bukan onClick) supaya terpilih sebelum input
                // kehilangan fokus dan dropdown menutup.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(product.id);
                  setQuery("");
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="truncate text-sm">{product.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                  {product.sku}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------
// Tab Riwayat Mutasi
// --------------------------------------------------------

export default function StokRiwayatTab({
  movements,
  totalCount,
  summary,
  isLoading,
  error,
  filters,
  onFiltersChange,
  onResetFilters,
  page,
  pageSize,
  onPageChange,
  products,
}: StokRiwayatTabProps) {
  const hasFilter =
    filters.types.length > 0 ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.productId !== null;

  const toggleType = (type: StockMovementType) => {
    const next = filters.types.includes(type)
      ? filters.types.filter((item) => item !== type)
      : [...filters.types, type];
    onFiltersChange({ types: next });
  };

  const applyPreset = (days: number) => {
    const today = new Date();
    const from = new Date();
    from.setDate(today.getDate() - (days - 1));
    onFiltersChange({
      dateFrom: toDateInputValue(from),
      dateTo: toDateInputValue(today),
    });
  };

  const handleDateFrom = (value: string) => {
    // Jaga rentang tetap masuk akal: tanggal akhir tidak boleh lebih awal dari awal.
    onFiltersChange(
      value && filters.dateTo && value > filters.dateTo
        ? { dateFrom: value, dateTo: value }
        : { dateFrom: value },
    );
  };

  const handleDateTo = (value: string) => {
    onFiltersChange(
      value && filters.dateFrom && value < filters.dateFrom
        ? { dateFrom: value, dateTo: value }
        : { dateTo: value },
    );
  };

  const cardClass =
    "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
  const labelClass =
    "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400";
  const inputClass =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950";
  const presetClass =
    "rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors duration-150 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100";

  return (
    <div>
      {/* ---------------- Kartu ringkasan (sesuai filter) ---------------- */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={cardClass}>
          <p className={labelClass}>
            <ArrowUpRight className="h-3.5 w-3.5" />
            Stok Masuk
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-lco-green dark:text-lco-teal">
            {summary ? `+${formatNumber(summary.masuk)}` : "-"}
          </p>
        </div>

        <div className={cardClass}>
          <p className={labelClass}>
            <ArrowDownRight className="h-3.5 w-3.5" />
            Stok Keluar
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-lco-coral">
            {summary ? `-${formatNumber(summary.keluar)}` : "-"}
          </p>
        </div>

        <div className={cardClass}>
          <p className={labelClass}>
            <ListChecks className="h-3.5 w-3.5" />
            Jumlah Mutasi
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
            {summary ? formatNumber(summary.jumlah) : "-"}
          </p>
        </div>
      </div>
      <p className="-mt-2 mb-4 text-[11px] text-zinc-400">
        Angka di atas mencakup seluruh mutasi yang cocok dengan filter, bukan
        hanya baris di halaman ini.
      </p>

      {/* ---------------- Filter ---------------- */}
      <div className={`${cardClass} mb-4`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Dari tanggal
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(e) => handleDateFrom(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Sampai tanggal
            </label>
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(e) => handleDateTo(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Produk
            </label>
            <ProductFilter
              products={products}
              productId={filters.productId}
              onChange={(productId) => onFiltersChange({ productId })}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => applyPreset(1)} className={presetClass}>
            Hari Ini
          </button>
          <button type="button" onClick={() => applyPreset(7)} className={presetClass}>
            7 Hari
          </button>
          <button type="button" onClick={() => applyPreset(30)} className={presetClass}>
            30 Hari
          </button>

          <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

          {FILTER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                filters.types.includes(type)
                  ? "border-lco-teal text-lco-teal"
                  : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {MOVEMENT_TYPE_LABEL[type]}
            </button>
          ))}

          {hasFilter && (
            <button
              type="button"
              onClick={onResetFilters}
              className="ml-1 text-xs text-zinc-400 transition-colors duration-150 hover:text-lco-coral"
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* ---------------- Tabel ---------------- */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat riwayat...
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-sm text-lco-coral">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : movements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {hasFilter
                ? "Tidak ada mutasi yang cocok dengan filter."
                : "Belum ada mutasi stok."}
            </p>
            {page > 0 && (
              <button
                type="button"
                onClick={() => onPageChange(0)}
                className="mt-3 text-xs font-medium text-lco-green transition-colors duration-150 hover:underline dark:text-lco-teal"
              >
                Kembali ke halaman pertama
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3">Jenis</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Sebelum</th>
                  <th className="px-4 py-3 text-right">Sesudah</th>
                  <th className="px-4 py-3">Alasan</th>
                  <th className="px-4 py-3">Oleh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {movements.map((movement) => (
                  <tr
                    key={movement.id}
                    className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                      {formatDateTime(movement.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {movement.product_name ?? "Produk dihapus"}
                      </p>
                      {movement.product_sku && (
                        <p className="font-mono text-[11px] text-zinc-400">
                          {movement.product_sku}
                        </p>
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold ${movementTypeColorClass(movement.type)}`}
                    >
                      {MOVEMENT_TYPE_LABEL[movement.type]}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${deltaColorClass(movement.qty_delta)}`}
                    >
                      {formatDelta(movement.qty_delta)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                      {movement.stock_before === null
                        ? "-"
                        : formatNumber(movement.stock_before)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {movement.stock_after === null
                        ? "-"
                        : formatNumber(movement.stock_after)}
                    </td>
                    <td
                      className="max-w-[240px] truncate px-4 py-3 text-xs text-zinc-500"
                      title={movement.reason ?? undefined}
                    >
                      {movement.reason ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                      {movement.created_by_name ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !error && (
          <StokPagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            noun="mutasi"
            onPageChange={onPageChange}
          />
        )}
      </div>
    </div>
  );
}
