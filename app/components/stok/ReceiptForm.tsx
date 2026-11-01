// app/components/stok/ReceiptForm.tsx
// ── TAMBAHAN (Fase 3 perbaikan Stok & Opname) ── Form catat Barang Masuk:
// tanggal terima, supplier, nomor referensi (nota supplier), lalu daftar produk
// dengan jumlah dan harga beli (opsional). Produk bisa dicari lewat nama/SKU
// atau di-scan (barcode/SKU persis + Enter menambah baris atau +1 jumlah).
//
// Harga modal produk TIDAK diubah kecuali kotak "Perbarui harga modal" dicentang
// — harga modal dipakai untuk nilai persediaan dan nilai selisih opname.

"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  ScanBarcode,
  Search,
  Trash2,
} from "lucide-react";
import type { ProductWithCategory } from "@/hooks/useProducts";
import type {
  ReceiveStockParams,
  ReceiveStockResult,
} from "@/hooks/useStockReceipts";
import { formatNumber, formatRupiah, toDateInputValue } from "./stokUtils";

interface FormLine {
  productId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  stock: number;
  currentCost: number | null;
  /** String mentah dari input — divalidasi saat simpan. */
  qty: string;
  unitCost: string;
}

interface ReceiptFormProps {
  products: ProductWithCategory[];
  onBack: () => void;
  onSubmit: (params: ReceiveStockParams) => Promise<ReceiveStockResult>;
  onSaved: (result: ReceiveStockResult) => void;
}

export default function ReceiptForm({
  products,
  onBack,
  onSubmit,
  onSaved,
}: ReceiptFormProps) {
  const today = toDateInputValue(new Date());

  const [receivedAt, setReceivedAt] = useState(today);
  const [supplier, setSupplier] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([]);
  const [updateCost, setUpdateCost] = useState(false);
  const [query, setQuery] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Hanya produk fisik; produk jasa tidak punya stok.
  const stockable = useMemo(
    () =>
      products.filter((product) => !product.is_service && product.type !== "JASA"),
    [products],
  );

  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword === "") return [];

    return stockable
      .filter(
        (product) =>
          product.name.toLowerCase().includes(keyword) ||
          (product.sku ?? "").toLowerCase().includes(keyword) ||
          (product.barcode ?? "").toLowerCase().includes(keyword),
      )
      .slice(0, 8);
  }, [stockable, query]);

  const addProduct = (product: ProductWithCategory) => {
    setLines((prev) => {
      const existing = prev.find((line) => line.productId === product.id);

      if (existing) {
        return prev.map((line) =>
          line.productId === product.id
            ? {
                ...line,
                qty: String((Number.parseInt(line.qty, 10) || 0) + 1),
              }
            : line,
        );
      }

      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku ?? null,
          unit: product.unit ?? null,
          stock: product.stock,
          currentCost: product.cost_price ?? null,
          qty: "1",
          unitCost: "",
        },
      ];
    });

    setQuery("");
    setIsPickerOpen(false);
    searchInputRef.current?.focus();
  };

  // Enter di kolom cari: kode persis (barcode/SKU) dari scanner menambah produk;
  // kalau hasil pencarian tinggal satu, itu yang dipilih.
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    const code = query.trim().toLowerCase();
    if (code === "") return;

    const exact = stockable.find(
      (product) =>
        (product.barcode ?? "").toLowerCase() === code ||
        (product.sku ?? "").toLowerCase() === code,
    );

    const target = exact ?? (matches.length === 1 ? matches[0] : null);

    if (target) {
      addProduct(target);
      setScanFeedback(`${target.name} ditambahkan.`);
    } else {
      setScanFeedback(`Kode "${query.trim()}" tidak ditemukan.`);
      setQuery("");
    }
  };

  const updateLine = (productId: string, patch: Partial<FormLine>) => {
    setLines((prev) =>
      prev.map((line) =>
        line.productId === productId ? { ...line, ...patch } : line,
      ),
    );
  };

  const removeLine = (productId: string) => {
    setLines((prev) => prev.filter((line) => line.productId !== productId));
  };

  const totals = useMemo(() => {
    let qty = 0;
    let cost = 0;
    let anyCost = false;

    for (const line of lines) {
      const lineQty = Number.parseInt(line.qty, 10);
      if (!Number.isInteger(lineQty) || lineQty <= 0) continue;
      qty += lineQty;

      const lineCost = Number(line.unitCost);
      if (line.unitCost.trim() !== "" && Number.isFinite(lineCost) && lineCost >= 0) {
        cost += lineQty * lineCost;
        anyCost = true;
      }
    }

    return { qty, cost, anyCost };
  }, [lines]);

  const anyUnitCost = lines.some((line) => line.unitCost.trim() !== "");

  const handleSubmit = async () => {
    setError(null);

    if (lines.length === 0) {
      setError("Tambahkan minimal satu produk yang masuk.");
      return;
    }

    const parsed: ReceiveStockParams["lines"] = [];

    for (const line of lines) {
      const qty = Number(line.qty);

      if (line.qty.trim() === "" || !Number.isInteger(qty) || qty <= 0) {
        setError(`Jumlah "${line.name}" harus berupa angka bulat lebih dari 0.`);
        return;
      }

      let unitCost: number | null = null;

      if (line.unitCost.trim() !== "") {
        unitCost = Number(line.unitCost);

        if (!Number.isInteger(unitCost) || unitCost < 0) {
          setError(
            `Harga beli "${line.name}" harus berupa angka bulat 0 atau lebih.`,
          );
          return;
        }
      }

      parsed.push({ productId: line.productId, qty, unitCost });
    }

    setIsSaving(true);

    try {
      const result = await onSubmit({
        receivedAt,
        supplier,
        referenceNo,
        note,
        lines: parsed,
        updateCost: updateCost && anyUnitCost,
      });
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan barang masuk.");
      setIsSaving(false);
    }
  };

  const cardClass =
    "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
  const labelClass = "mb-1 block text-xs font-medium text-zinc-500";
  const inputClass =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        disabled={isSaving}
        className="mb-3 flex items-center gap-1.5 text-sm text-zinc-500 transition-colors duration-150 hover:text-zinc-900 disabled:opacity-60 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke daftar barang masuk
      </button>

      <div className={`${cardClass} mb-4`}>
        <h3 className="mb-3 text-base font-semibold">Catat Barang Masuk</h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>Tanggal terima</label>
            <input
              type="date"
              value={receivedAt}
              max={today}
              onChange={(e) => setReceivedAt(e.target.value)}
              disabled={isSaving}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Supplier (opsional)</label>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              disabled={isSaving}
              placeholder="Nama supplier / pengirim"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>No. referensi (opsional)</label>
            <input
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              disabled={isSaving}
              placeholder="Nomor nota / surat jalan"
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-3">
          <label className={labelClass}>Catatan (opsional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isSaving}
            className={inputClass}
          />
        </div>
      </div>

      <div className={`${cardClass} mb-4`}>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
          <ScanBarcode className="h-3.5 w-3.5" />
          Cari produk atau scan barcode — tiap scan menambah 1
        </label>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsPickerOpen(true);
              setScanFeedback(null);
            }}
            onFocus={() => setIsPickerOpen(true)}
            onBlur={() => setIsPickerOpen(false)}
            onKeyDown={handleSearchKeyDown}
            disabled={isSaving}
            placeholder="Nama, SKU, atau barcode..."
            autoComplete="off"
            className={`${inputClass} pl-9`}
          />

          {isPickerOpen && query.trim() !== "" && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
              {matches.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-zinc-400">
                  Tidak ada produk cocok.
                </p>
              ) : (
                matches.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    // onMouseDown agar terpilih sebelum input kehilangan fokus.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addProduct(product);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <span className="truncate text-sm">
                      {product.name}
                      {!product.is_active && (
                        <span className="ml-2 text-[11px] text-zinc-400">
                          Nonaktif
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                      {product.sku} · stok {formatNumber(product.stock)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {scanFeedback && (
          <p className="mt-1.5 text-xs text-zinc-500">{scanFeedback}</p>
        )}
      </div>

      <div className="mb-4 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {lines.length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Belum ada produk. Cari atau scan produk di atas untuk menambahkannya.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3 text-right">Stok Sekarang</th>
                  <th className="px-4 py-3 text-right">Jumlah Masuk</th>
                  <th className="px-4 py-3 text-right">Harga Beli (opsional)</th>
                  <th className="px-4 py-3 text-right">Subtotal</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {lines.map((line) => {
                  const lineQty = Number.parseInt(line.qty, 10);
                  const lineCost = Number(line.unitCost);
                  const hasSubtotal =
                    Number.isInteger(lineQty) &&
                    lineQty > 0 &&
                    line.unitCost.trim() !== "" &&
                    Number.isFinite(lineCost) &&
                    lineCost >= 0;

                  return (
                    <tr key={line.productId}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{line.name}</p>
                        <p className="font-mono text-[11px] text-zinc-400">
                          {line.sku ?? "-"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                        {formatNumber(line.stock)}
                        {line.unit && (
                          <span className="ml-1 text-[11px] text-zinc-400">
                            {line.unit}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          value={line.qty}
                          onChange={(e) =>
                            updateLine(line.productId, { qty: e.target.value })
                          }
                          disabled={isSaving}
                          aria-label={`Jumlah masuk ${line.name}`}
                          className={`${inputClass} w-24 text-right font-mono tabular-nums`}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={line.unitCost}
                          onChange={(e) =>
                            updateLine(line.productId, {
                              unitCost: e.target.value,
                            })
                          }
                          disabled={isSaving}
                          placeholder={
                            line.currentCost !== null
                              ? String(line.currentCost)
                              : "-"
                          }
                          aria-label={`Harga beli ${line.name}`}
                          className={`${inputClass} w-32 text-right font-mono tabular-nums`}
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {hasSubtotal ? formatRupiah(lineQty * lineCost) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(line.productId)}
                          disabled={isSaving}
                          aria-label={`Hapus ${line.name}`}
                          title="Hapus baris"
                          className="rounded-md p-1.5 text-zinc-400 transition-colors duration-150 hover:bg-lco-coral/10 hover:text-lco-coral"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <dl className="mb-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500">Jumlah produk</dt>
            <dd className="font-mono tabular-nums">{formatNumber(lines.length)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500">Total unit masuk</dt>
            <dd className="font-mono tabular-nums">{formatNumber(totals.qty)}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <dt className="font-medium">Total nilai (baris yang diisi harga beli)</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {totals.anyCost ? formatRupiah(totals.cost) : "-"}
            </dd>
          </div>
        </dl>

        <label
          className={`mb-4 flex items-start gap-2 text-sm ${
            anyUnitCost ? "" : "opacity-50"
          }`}
        >
          <input
            type="checkbox"
            checked={updateCost && anyUnitCost}
            onChange={(e) => setUpdateCost(e.target.checked)}
            disabled={isSaving || !anyUnitCost}
            className="mt-0.5 h-4 w-4 accent-lco-green"
          />
          <span>
            Perbarui harga modal produk sesuai harga beli
            <span className="block text-xs text-zinc-400">
              Hanya baris yang diisi harga belinya, memakai harga beli terakhir
              (bukan rata-rata). Harga modal dipakai untuk nilai persediaan dan
              nilai selisih opname.
            </span>
          </span>
        </label>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving || lines.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Menyimpan...
            </>
          ) : (
            "Simpan Barang Masuk"
          )}
        </button>
      </div>
    </div>
  );
}
