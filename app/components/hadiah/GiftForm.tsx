// app/components/hadiah/GiftForm.tsx
// ── TAMBAHAN (migration 044) ── Form catat Hadiah & Oleh-oleh: tanggal,
// penerima (+ kategori: Kiyai / Tamu Pondok / Tamu Toko / Lainnya), keperluan,
// lalu daftar produk dari stok toko. Produk dicari lewat nama/SKU atau di-scan
// (barcode/SKU persis + Enter menambah baris atau +1 jumlah).
//
// Nilai hadiah dihitung dari HARGA MODAL produk (itulah angka beban yang masuk
// pembukuan). Produk tanpa harga modal tetap boleh dihadiahkan, tapi diberi
// peringatan karena nilainya akan tercatat Rp 0.

"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Gift,
  Loader2,
  ScanBarcode,
  Search,
  Trash2,
} from "lucide-react";
import type { ProductWithCategory } from "@/hooks/useProducts";
import {
  GIFT_CATEGORIES,
  GIFT_CATEGORY_LABEL,
  type GiftCategory,
  type GiveGiftParams,
  type GiveGiftResult,
} from "@/hooks/useGifts";
import {
  formatNumber,
  formatRupiah,
  toDateInputValue,
} from "../stok/stokUtils";

interface FormLine {
  productId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  stock: number;
  costPrice: number;
  sellPrice: number;
  /** String mentah dari input — divalidasi saat simpan. */
  qty: string;
}

interface GiftFormProps {
  products: ProductWithCategory[];
  onBack: () => void;
  onSubmit: (params: GiveGiftParams) => Promise<GiveGiftResult>;
  onSaved: (result: GiveGiftResult) => void;
}

export default function GiftForm({
  products,
  onBack,
  onSubmit,
  onSaved,
}: GiftFormProps) {
  const today = toDateInputValue(new Date());

  const [givenAt, setGivenAt] = useState(today);
  const [recipientName, setRecipientName] = useState("");
  const [category, setCategory] = useState<GiftCategory>("kyai");
  const [occasion, setOccasion] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([]);
  const [query, setQuery] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Hanya produk fisik yang masih ada stoknya; jasa tidak punya stok.
  const giftable = useMemo(
    () =>
      products.filter(
        (product) => !product.is_service && product.type !== "JASA",
      ),
    [products],
  );

  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword === "") return [];

    return giftable
      .filter(
        (product) =>
          product.name.toLowerCase().includes(keyword) ||
          (product.sku ?? "").toLowerCase().includes(keyword) ||
          (product.barcode ?? "").toLowerCase().includes(keyword),
      )
      .slice(0, 8);
  }, [giftable, query]);

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
          costPrice: product.cost_price ?? 0,
          sellPrice: product.sell_price ?? 0,
          qty: "1",
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

    const exact = giftable.find(
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
    let retail = 0;

    for (const line of lines) {
      const lineQty = Number.parseInt(line.qty, 10);
      if (!Number.isInteger(lineQty) || lineQty <= 0) continue;
      qty += lineQty;
      cost += lineQty * line.costPrice;
      retail += lineQty * line.sellPrice;
    }

    return { qty, cost, retail };
  }, [lines]);

  const linesWithoutCost = lines.filter((line) => line.costPrice <= 0);

  const handleSubmit = async () => {
    setError(null);

    if (recipientName.trim() === "") {
      setError("Nama penerima wajib diisi.");
      return;
    }

    if (lines.length === 0) {
      setError("Tambahkan minimal satu produk yang dihadiahkan.");
      return;
    }

    const parsed: GiveGiftParams["lines"] = [];

    for (const line of lines) {
      const qty = Number(line.qty);

      if (line.qty.trim() === "" || !Number.isInteger(qty) || qty <= 0) {
        setError(`Jumlah "${line.name}" harus berupa angka bulat lebih dari 0.`);
        return;
      }

      if (qty > line.stock) {
        setError(
          `Stok "${line.name}" tidak cukup (stok ${formatNumber(line.stock)}, hadiah ${formatNumber(qty)}).`,
        );
        return;
      }

      parsed.push({ productId: line.productId, qty });
    }

    setIsSaving(true);

    try {
      const result = await onSubmit({
        givenAt,
        recipientName,
        recipientCategory: category,
        occasion,
        note,
        lines: parsed,
      });
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan hadiah.");
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
        Kembali ke daftar hadiah
      </button>

      <div className={`${cardClass} mb-4`}>
        <h3 className="mb-3 text-base font-semibold">Catat Hadiah / Oleh-oleh</h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>Tanggal</label>
            <input
              type="date"
              value={givenAt}
              max={today}
              onChange={(e) => setGivenAt(e.target.value)}
              disabled={isSaving}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Untuk siapa (kategori)</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as GiftCategory)}
              disabled={isSaving}
              className={inputClass}
            >
              {GIFT_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {GIFT_CATEGORY_LABEL[key]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Nama penerima</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              disabled={isSaving}
              placeholder="Mis. Bapak Kiyai / nama tamu / rombongan"
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={labelClass}>Keperluan / acara (opsional)</label>
            <input
              type="text"
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              disabled={isSaving}
              placeholder="Mis. Kunjungan tamu besar, oleh-oleh pulang"
              className={inputClass}
            />
          </div>
          <div>
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
                      {product.stock <= 0 && (
                        <span className="ml-2 text-[11px] text-lco-coral">
                          Stok habis
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
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3 text-right">Stok Sekarang</th>
                  <th className="px-4 py-3 text-right">Jumlah Hadiah</th>
                  <th className="px-4 py-3 text-right">Harga Modal</th>
                  <th className="px-4 py-3 text-right">Nilai (Modal)</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {lines.map((line) => {
                  const lineQty = Number.parseInt(line.qty, 10);
                  const validQty = Number.isInteger(lineQty) && lineQty > 0;
                  const overStock = validQty && lineQty > line.stock;

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
                          aria-label={`Jumlah hadiah ${line.name}`}
                          className={`${inputClass} w-24 text-right font-mono tabular-nums ${
                            overStock ? "border-lco-coral" : ""
                          }`}
                        />
                        {overStock && (
                          <p className="mt-1 text-[11px] text-lco-coral">
                            Melebihi stok
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {line.costPrice > 0 ? (
                          formatRupiah(line.costPrice)
                        ) : (
                          <span className="text-lco-mustard">Belum diisi</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {validQty ? formatRupiah(lineQty * line.costPrice) : "-"}
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

      {linesWithoutCost.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-lco-mustard/40 bg-lco-mustard/5 p-3 text-xs text-zinc-700 dark:text-zinc-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-lco-mustard" />
          <p>
            {linesWithoutCost.length} produk belum punya harga modal (
            {linesWithoutCost.map((line) => line.name).join(", ")}). Hadiah
            tetap bisa disimpan, tapi nilainya tercatat Rp 0 di pembukuan.
            Isi harga modalnya di menu Produk supaya beban hadiah akurat.
          </p>
        </div>
      )}

      <div className={`${cardClass} mb-4`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Total unit
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {formatNumber(totals.qty)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Beban hadiah (harga modal)
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-lco-coral">
              {formatRupiah(totals.cost)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Nilai jika dijual
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-500">
              {formatRupiah(totals.retail)}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-lco-coral/40 bg-lco-coral/5 p-3 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving}
          className="flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:opacity-60"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Gift className="h-4 w-4" />
          )}
          Simpan Hadiah & Kurangi Stok
        </button>
      </div>
    </div>
  );
}
