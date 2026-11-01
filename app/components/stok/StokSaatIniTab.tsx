// app/components/stok/StokSaatIniTab.tsx
// ── TAMBAHAN (Fase 1 perbaikan Stok & Opname) ── Daftar stok saat ini per
// produk: stok, stok minimum, status (aman / menipis / habis), harga modal, dan
// nilai persediaan. Sebelumnya menu Stok hanya menampilkan riwayat mutasi dan
// tidak ada satu pun layar yang menjawab "stok produk X sekarang berapa".
//
// Data dari useProducts({ includeInactive: true }) — produk nonaktif tetap
// punya barang fisik, jadi tetap dihitung di nilai persediaan.
// Produk jasa tidak punya stok (PRD §4.3) dan dikeluarkan dari daftar ini.
//
// Nilai persediaan = stok x harga modal (cost_price). Produk tanpa harga modal
// dihitung 0 dan jumlahnya ditampilkan, supaya totalnya tidak terbaca lebih
// akurat daripada kenyataan.

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  Inbox,
  Loader2,
  Package,
  PackageX,
  Search,
  Wallet,
} from "lucide-react";
import type { ProductWithCategory } from "@/hooks/useProducts";
import StokPagination from "./StokPagination";
import { exportStockToExcel } from "./stokExport";
import {
  STOCK_STATUS_LABEL,
  formatNumber,
  formatRupiah,
  getStockStatus,
  stockStatusColorClass,
  type StockStatus,
} from "./stokUtils";

const PAGE_SIZE = 50;

type StatusFilter = "semua" | StockStatus;
type SortKey = "nama" | "stok_asc" | "nilai_desc";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "habis", label: "Habis" },
  { key: "menipis", label: "Menipis" },
  { key: "aman", label: "Aman" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "nama", label: "Nama A-Z" },
  { key: "stok_asc", label: "Stok terendah" },
  { key: "nilai_desc", label: "Nilai tertinggi" },
];

interface StokSaatIniTabProps {
  products: ProductWithCategory[];
  isLoading: boolean;
  error: string | null;
  /** Boleh membuka opname/penyesuaian (izin stok:edit). */
  canAdjust: boolean;
  onOpname: (product: ProductWithCategory) => void;
  onViewHistory: (product: ProductWithCategory) => void;
}

function inventoryValue(product: ProductWithCategory): number {
  return Math.max(product.stock, 0) * (product.cost_price ?? 0);
}

export default function StokSaatIniTab({
  products,
  isLoading,
  error,
  canAdjust,
  onOpname,
  onViewHistory,
}: StokSaatIniTabProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("semua");
  const [sortKey, setSortKey] = useState<SortKey>("nama");
  const [page, setPage] = useState(0);

  // Hanya produk fisik. Produk jasa tidak punya stok.
  const stockable = useMemo(
    () =>
      products.filter((product) => !product.is_service && product.type !== "JASA"),
    [products],
  );

  const stats = useMemo(() => {
    let low = 0;
    let empty = 0;
    let value = 0;
    let withoutCost = 0;

    for (const product of stockable) {
      const status = getStockStatus(product.stock, product.min_stock);
      if (status === "habis") empty += 1;
      if (status === "menipis") low += 1;
      value += inventoryValue(product);
      if (product.stock > 0 && !product.cost_price) withoutCost += 1;
    }

    return { total: stockable.length, low, empty, value, withoutCost };
  }, [stockable]);

  const categories = useMemo(() => {
    const byId = new Map<string, string>();
    for (const product of stockable) {
      if (product.category) byId.set(product.category.id, product.category.name);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "id"),
    );
  }, [stockable]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    const rows = stockable.filter((product) => {
      if (categoryId && product.category_id !== categoryId) return false;

      if (
        statusFilter !== "semua" &&
        getStockStatus(product.stock, product.min_stock) !== statusFilter
      ) {
        return false;
      }

      if (keyword === "") return true;

      return (
        product.name.toLowerCase().includes(keyword) ||
        (product.sku ?? "").toLowerCase().includes(keyword) ||
        (product.barcode ?? "").toLowerCase().includes(keyword)
      );
    });

    rows.sort((a, b) => {
      if (sortKey === "stok_asc") {
        return a.stock - b.stock || a.name.localeCompare(b.name, "id");
      }
      if (sortKey === "nilai_desc") {
        return (
          inventoryValue(b) - inventoryValue(a) ||
          a.name.localeCompare(b.name, "id")
        );
      }
      return a.name.localeCompare(b.name, "id");
    });

    return rows;
  }, [stockable, search, categoryId, statusFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const hasFilter =
    search.trim() !== "" || categoryId !== "" || statusFilter !== "semua";

  const resetFilters = () => {
    setSearch("");
    setCategoryId("");
    setStatusFilter("semua");
    setPage(0);
  };

  const cardClass =
    "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
  const labelClass =
    "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400";
  const inputClass =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <div>
      {/* ---------------- Kartu ringkasan ---------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={cardClass}>
          <p className={labelClass}>
            <Package className="h-3.5 w-3.5" />
            Produk Berstok
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
            {formatNumber(stats.total)}
          </p>
        </div>

        <div className={cardClass}>
          <p className={labelClass}>
            <AlertTriangle className="h-3.5 w-3.5" />
            Stok Menipis
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-lco-mustard">
            {formatNumber(stats.low)}
          </p>
        </div>

        <div className={cardClass}>
          <p className={labelClass}>
            <PackageX className="h-3.5 w-3.5" />
            Stok Habis
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-lco-coral">
            {formatNumber(stats.empty)}
          </p>
        </div>

        <div className={cardClass}>
          <p className={labelClass}>
            <Wallet className="h-3.5 w-3.5" />
            Nilai Persediaan
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
            {formatRupiah(stats.value)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            {stats.withoutCost > 0
              ? `${formatNumber(stats.withoutCost)} produk berstok belum punya harga modal (dihitung Rp 0)`
              : "Stok x harga modal"}
          </p>
        </div>
      </div>

      {/* ---------------- Filter ---------------- */}
      <div className={`${cardClass} mb-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Cari nama, SKU, atau barcode..."
              className={`${inputClass} w-full pl-9`}
            />
          </div>

          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(0);
            }}
            aria-label="Filter kategori"
            className={inputClass}
          >
            <option value="">Semua kategori</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <select
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value as SortKey);
              setPage(0);
            }}
            aria-label="Urutkan"
            className={inputClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => exportStockToExcel(filtered)}
            disabled={filtered.length === 0}
            title="Ekspor daftar yang sedang tampil (sesuai filter & urutan) ke Excel"
            className="flex items-center justify-center gap-2 rounded-md border border-zinc-300 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Ekspor Excel
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setStatusFilter(option.key);
                setPage(0);
              }}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                statusFilter === option.key
                  ? "border-lco-teal text-lco-teal"
                  : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {option.label}
            </button>
          ))}

          {hasFilter && (
            <button
              type="button"
              onClick={resetFilters}
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
            Memuat stok...
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-sm text-lco-coral">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : pageRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {hasFilter
                ? "Tidak ada produk yang cocok dengan filter."
                : "Belum ada produk berstok."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3 text-right">Stok</th>
                  <th className="px-4 py-3 text-right">Minimum</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Harga Modal</th>
                  <th className="px-4 py-3 text-right">Nilai</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {pageRows.map((product) => {
                  const status = getStockStatus(product.stock, product.min_stock);

                  return (
                    <tr
                      key={product.id}
                      className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">
                          {product.name}
                          {!product.is_active && (
                            <span className="ml-2 text-[11px] font-normal text-zinc-400">
                              Nonaktif
                            </span>
                          )}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-400">
                          {product.sku}
                          {product.category ? ` · ${product.category.name}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <span className="font-semibold">
                          {formatNumber(product.stock)}
                        </span>
                        {product.unit && (
                          <span className="ml-1 text-[11px] text-zinc-400">
                            {product.unit}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                        {formatNumber(product.min_stock)}
                      </td>
                      <td
                        className={`px-4 py-3 text-xs font-semibold ${stockStatusColorClass(status)}`}
                      >
                        {STOCK_STATUS_LABEL[status]}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                        {product.cost_price
                          ? formatRupiah(product.cost_price)
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {product.cost_price
                          ? formatRupiah(inventoryValue(product))
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onViewHistory(product)}
                            title="Lihat riwayat mutasi produk ini"
                            aria-label={`Riwayat mutasi ${product.name}`}
                            className="rounded-md p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          {canAdjust && (
                            <button
                              type="button"
                              onClick={() => onOpname(product)}
                              title="Opname / penyesuaian produk ini"
                              aria-label={`Opname ${product.name}`}
                              className="rounded-md p-1.5 text-lco-green transition-colors duration-150 hover:bg-lco-teal/10 dark:text-lco-teal"
                            >
                              <ClipboardCheck className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !error && (
          <StokPagination
            page={safePage}
            pageSize={PAGE_SIZE}
            totalCount={filtered.length}
            noun="produk"
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
