// app/components/stok/StokPagination.tsx
// Kontrol paging sederhana, dipakai tab Stok Saat Ini dan tab Riwayat Mutasi.

"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber } from "./stokUtils";

interface StokPaginationProps {
  /** Halaman aktif, mulai dari 0. */
  page: number;
  pageSize: number;
  totalCount: number;
  /** Kata benda untuk teks "dari N ...", mis. "produk" atau "mutasi". */
  noun: string;
  onPageChange: (page: number) => void;
}

export default function StokPagination({
  page,
  pageSize,
  totalCount,
  noun,
  onPageChange,
}: StokPaginationProps) {
  if (totalCount === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const firstRow = page * pageSize + 1;
  const lastRow = Math.min(totalCount, (page + 1) * pageSize);

  const buttonClass =
    "flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900";

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Menampilkan {formatNumber(firstRow)}–{formatNumber(lastRow)} dari{" "}
        {formatNumber(totalCount)} {noun}
      </span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 0}
          className={buttonClass}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Sebelumnya
        </button>
        <span className="tabular-nums">
          Hal. {formatNumber(page + 1)} / {formatNumber(totalPages)}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          className={buttonClass}
        >
          Berikutnya
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
