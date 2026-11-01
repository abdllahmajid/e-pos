// app/components/stok/AdjustStockModal.tsx
// ── DIPINDAHKAN dari StokModule.tsx (Fase 1 perbaikan Stok & Opname) ── Isi modal
// Opname / Penyesuaian tidak diubah, kecuali:
// - Prop baru `initialProduct`: produk langsung terpilih saat modal dibuka dari
//   tombol "Opname" di tab Stok Saat Ini (kasir tidak perlu mencari ulang).
// - Helper format (formatDelta, deltaColorClass) kini dari stokUtils.ts.
//
// Opname di sini tetap per produk dan langsung mengubah stok saat disimpan.
// Opname berbentuk sesi (hitung banyak produk, tinjau selisih, finalisasi)
// adalah Fase 2.

"use client";

import { useMemo, useState } from "react";
import {
  ClipboardCheck,
  Loader2,
  AlertTriangle,
  Search,
  X,
} from "lucide-react";
import {
  MOVEMENT_TYPE_LABEL,
  type ManualMovementType,
  type AdjustStockResult,
} from "@/hooks/useStock";
import type { ProductWithCategory } from "@/hooks/useProducts";
import { deltaColorClass, formatDelta } from "./stokUtils";

// Alasan yang paling sering dipakai — tombol cepat supaya kasir/supervisor tidak
// mengetik bebas untuk kasus yang itu-itu saja (alasan tetap bisa diedit manual).
const QUICK_REASONS: Record<ManualMovementType, string[]> = {
  opname: [
    "Opname rutin",
    "Opname akhir bulan",
    "Selisih ditemukan saat cek rak",
  ],
  adjustment: [
    "Barang rusak",
    "Barang hilang",
    "Koreksi salah input",
    "Sampel / dipakai toko",
  ],
};

export default function AdjustStockModal({
  products,
  initialProduct = null,
  onClose,
  onSubmit,
}: {
  products: ProductWithCategory[];
  /** Produk yang langsung terpilih saat modal dibuka (mis. dari tombol Opname di tab Stok Saat Ini). */
  initialProduct?: ProductWithCategory | null;
  onClose: () => void;
  onSubmit: (params: {
    productId: string;
    type: ManualMovementType;
    value: number;
    reason: string;
  }) => Promise<AdjustStockResult>;
}) {
  const [type, setType] = useState<ManualMovementType>("opname");
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] =
    useState<ProductWithCategory | null>(initialProduct);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdjustStockResult | null>(null);

  // Produk jasa tidak punya stok (PRD §4.3: qty tak terbatas) — dikeluarkan dari
  // daftar pilihan supaya tidak ada yang mencoba opname lalu ditolak RPC.
  const selectableProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return products
      .filter((product) => !product.is_service && product.type !== "JASA")
      .filter(
        (product) =>
          keyword === "" ||
          product.name.toLowerCase().includes(keyword) ||
          (product.sku ?? "").toLowerCase().includes(keyword),
      )
      .slice(0, 30);
  }, [products, search]);

  const systemStock = selectedProduct?.stock ?? 0;

  // Preview stok sesudah — dihitung ulang di server saat submit, ini murni
  // untuk UX supaya tidak ada kejutan setelah tombol ditekan.
  const parsedValue = useMemo(() => {
    if (value.trim() === "" || value.trim() === "-") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }, [value]);

  const previewDelta =
    parsedValue === null
      ? null
      : type === "opname"
        ? parsedValue - systemStock
        : parsedValue;

  const previewStock =
    previewDelta === null ? null : systemStock + previewDelta;

  const canSubmit =
    !!selectedProduct &&
    parsedValue !== null &&
    reason.trim() !== "" &&
    !isSubmitting;

  const handleSubmit = async () => {
    if (!selectedProduct || parsedValue === null) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const res = await onSubmit({
        productId: selectedProduct.id,
        type,
        value: parsedValue,
        reason,
      });
      setResult(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan mutasi stok.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ClipboardCheck className="h-4 w-4 text-lco-teal" />
            Opname / Penyesuaian Stok
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 transition-colors duration-150 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          // ---------------- Ringkasan setelah sukses ----------------
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-lco-teal">
              Mutasi Tersimpan
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {result.product_name}
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Stok sebelum</dt>
                <dd className="font-mono tabular-nums">{result.old_stock}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Selisih</dt>
                <dd
                  className={`font-mono tabular-nums font-medium ${deltaColorClass(result.qty_delta)}`}
                >
                  {formatDelta(result.qty_delta)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
                <dt className="font-medium">Stok sekarang</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">
                  {result.new_stock}
                </dd>
              </div>
            </dl>

            {result.qty_delta === 0 && (
              <p className="mt-3 text-[11px] text-zinc-400">
                Hitungan fisik cocok dengan sistem. Tetap dicatat sebagai bukti
                bahwa produk ini sudah diopname hari ini.
              </p>
            )}

            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
            >
              Selesai
            </button>
          </div>
        ) : (
          <>
            {/* ---------------- Jenis mutasi ---------------- */}
            <div className="mb-4 flex gap-2">
              {(["opname", "adjustment"] as ManualMovementType[]).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setType(option);
                      setValue("");
                      setReason("");
                    }}
                    className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors duration-150 ${
                      type === option
                        ? "border-lco-teal text-lco-teal"
                        : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
                    }`}
                  >
                    {MOVEMENT_TYPE_LABEL[option]}
                  </button>
                ),
              )}
            </div>

            <p className="mb-4 text-[11px] text-zinc-400">
              {type === "opname"
                ? "Isi jumlah hasil hitung fisik di rak. Selisihnya dihitung otomatis oleh sistem."
                : "Isi selisihnya langsung: minus untuk barang rusak/hilang, plus untuk koreksi kekurangan input."}
            </p>

            {/* ---------------- Pilih produk ---------------- */}
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Produk
            </label>

            {selectedProduct ? (
              <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div>
                  <p className="text-sm font-medium">{selectedProduct.name}</p>
                  <p className="font-mono text-[11px] tabular-nums text-zinc-400">
                    {selectedProduct.sku} · stok sistem {systemStock}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProduct(null);
                    setValue("");
                  }}
                  className="text-xs text-zinc-400 transition-colors duration-150 hover:text-lco-coral"
                >
                  Ganti
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari nama produk atau SKU..."
                    className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </div>

                <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                  {selectableProducts.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-zinc-400">
                      Tidak ada produk cocok.
                    </p>
                  ) : (
                    selectableProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => setSelectedProduct(product)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <span className="text-sm">{product.name}</span>
                        <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                          {product.stock}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {/* ---------------- Jumlah ---------------- */}
            <label className="mb-1 mt-4 block text-xs font-medium text-zinc-500">
              {type === "opname" ? "Hasil hitung fisik" : "Selisih (+/-)"}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={value}
              onChange={(e) => {
                // adjustment boleh negatif, opname tidak.
                const cleaned =
                  type === "opname"
                    ? e.target.value.replace(/[^0-9]/g, "")
                    : e.target.value.replace(/[^0-9-]/g, "");
                setValue(cleaned);
              }}
              placeholder={type === "opname" ? String(systemStock) : "-1"}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm tabular-nums transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950"
            />

            {selectedProduct && previewStock !== null && (
              <p className="mt-1 text-[11px] text-zinc-400">
                Stok {systemStock} →{" "}
                <span className="font-mono tabular-nums">{previewStock}</span>{" "}
                <span className={deltaColorClass(previewDelta ?? 0)}>
                  ({formatDelta(previewDelta ?? 0)})
                </span>
                {previewStock < 0 && (
                  <span className="text-lco-coral">
                    {" "}
                    — stok tidak boleh minus
                  </span>
                )}
              </p>
            )}

            {/* ---------------- Alasan (wajib) ---------------- */}
            <label className="mb-1 mt-4 block text-xs font-medium text-zinc-500">
              Alasan <span className="text-lco-coral">*</span>
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_REASONS[type].map((quick) => (
                <button
                  key={quick}
                  type="button"
                  onClick={() => setReason(quick)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 ${
                    reason === quick
                      ? "border-lco-teal text-lco-teal"
                      : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
                  }`}
                >
                  {quick}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Wajib diisi — akan tersimpan permanen di riwayat mutasi."
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950"
            />

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="h-4 w-4" />
              )}
              Simpan Mutasi
            </button>
          </>
        )}
      </div>
    </div>
  );
}
