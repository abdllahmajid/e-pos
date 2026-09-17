"use client";

// ── KOREKSI ── Diselaraskan dengan THEME-GUIDE LCO POS (Tailwind 4):
// - Warna generic (teal-500/100, red-200, emerald-700/800) diganti ke token lco-teal / lco-coral / lco-green.
// - Radius: rounded-md untuk tombol/input, rounded-xl untuk panel modal.
// - transition generic → transition-colors duration-150.
// - Overlay modal → bg-zinc-950/30 sesuai spesifikasi layout §8.
// - Fetch kategori manual (duplikat query Supabase) DIHAPUS, diganti reuse hook useCategories()
//   agar satu sumber kebenaran dengan chip filter Kasir & KategoriModule.
// - Tambah dark mode agar konsisten dengan ProdukModule.tsx.
// ── TAMBAHAN ── mode "edit": terima initialValues dari produk yang sedang diedit,
// judul & teks tombol menyesuaikan, sisanya (validasi, layout) sama persis dengan mode create.

import { FormEvent, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useCategories } from "@/hooks/useCategories";
import type { ProductType } from "@/lib/pos/types";

export type ProductFormValues = {
  name: string;
  sku: string;
  barcode: string;
  type: ProductType;
  category_id: string;
  unit: string;
  sell_price: string;
  cost_price: string;
  stock: string;
  min_stock: string;
  photo_url: string;
  is_active: boolean;
};

type ProdukFormProps = {
  onClose: () => void;
  onSubmit?: (values: ProductFormValues) => void | Promise<void>;
  saving?: boolean;
  error?: string | null;
  mode?: "create" | "edit";
  initialValues?: ProductFormValues;
};

const PRODUCT_TYPES: ProductType[] = [
  "FASHION",
  "SABLON",
  "KONVEKSI",
  "PERCETAKAN",
  "MERCHANDISE",
  "PARFUM",
  "JASA",
];

const EMPTY_FORM: ProductFormValues = {
  name: "",
  sku: "",
  barcode: "",
  type: "FASHION",
  category_id: "",
  unit: "pcs",
  sell_price: "",
  cost_price: "",
  stock: "0",
  min_stock: "0",
  photo_url: "",
  is_active: true,
};

export default function ProdukForm({
  onClose,
  onSubmit,
  saving = false,
  error = null,
  mode = "create",
  initialValues,
}: ProdukFormProps) {
  const isEdit = mode === "edit";

  // Form hanya perlu kategori aktif — persis kontrak useCategories() (is_active=true, urut sort_order).
  const { categories, isLoading: loadingCategories } = useCategories();

  const [form, setForm] = useState<ProductFormValues>(
    initialValues ?? EMPTY_FORM,
  );

  const [validationError, setValidationError] = useState("");

  function updateField<K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleTypeChange(type: ProductType) {
    setForm((current) => ({
      ...current,
      type,
      stock: type === "JASA" ? "0" : current.stock,
      min_stock: type === "JASA" ? "0" : current.min_stock,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setValidationError("");

    if (!form.name.trim()) {
      setValidationError("Nama produk wajib diisi.");
      return;
    }

    if (!form.sku.trim()) {
      setValidationError("SKU wajib diisi.");
      return;
    }

    const sellPrice = Number(form.sell_price);
    const costPrice = Number(form.cost_price || 0);
    const stock = Number(form.stock || 0);
    const minStock = Number(form.min_stock || 0);

    if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
      setValidationError("Harga jual harus lebih dari 0.");
      return;
    }

    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setValidationError("Harga modal tidak boleh negatif.");
      return;
    }

    if (form.type !== "JASA") {
      if (!Number.isFinite(stock) || stock < 0) {
        setValidationError("Stok tidak boleh negatif.");
        return;
      }

      if (!Number.isFinite(minStock) || minStock < 0) {
        setValidationError("Minimum stok tidak boleh negatif.");
        return;
      }
    }

    onSubmit?.(form);
  }

  const displayError = validationError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {isEdit ? "Edit Produk" : "Tambah Produk"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {isEdit
                ? "Perbarui informasi produk ini."
                : "Masukkan informasi produk baru."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-2 text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto">
          <div className="space-y-5 p-6">
            {displayError && (
              <div className="rounded-md border border-lco-coral/30 bg-lco-coral/10 px-4 py-3 text-sm text-lco-coral">
                {displayError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Nama Produk
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  disabled={saving}
                  placeholder="Contoh: Kaos Polos Hitam"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  SKU
                </label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) =>
                    updateField("sku", e.target.value.toUpperCase())
                  }
                  disabled={saving}
                  placeholder="Contoh: KAOS-HITAM-L"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm uppercase tabular-nums outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Barcode
                </label>
                <input
                  type="text"
                  value={form.barcode}
                  onChange={(e) => updateField("barcode", e.target.value)}
                  disabled={saving}
                  placeholder="Opsional"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Jenis Produk
                </label>
                <select
                  value={form.type}
                  onChange={(e) =>
                    handleTypeChange(e.target.value as ProductType)
                  }
                  disabled={saving}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                >
                  {PRODUCT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Kategori
                </label>
                <select
                  value={form.category_id}
                  onChange={(e) => updateField("category_id", e.target.value)}
                  disabled={saving || loadingCategories}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                >
                  <option value="">
                    {loadingCategories
                      ? "Memuat kategori..."
                      : "Pilih kategori"}
                  </option>

                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                {!loadingCategories && categories.length === 0 && (
                  <p className="mt-1.5 text-xs text-lco-coral">
                    Belum ada kategori aktif.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Satuan
                </label>
                <input
                  type="text"
                  value={form.unit}
                  onChange={(e) => updateField("unit", e.target.value)}
                  disabled={saving}
                  placeholder="pcs"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Harga Jual
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.sell_price}
                  onChange={(e) => updateField("sell_price", e.target.value)}
                  disabled={saving}
                  placeholder="0"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Harga Modal
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.cost_price}
                  onChange={(e) => updateField("cost_price", e.target.value)}
                  disabled={saving}
                  placeholder="0"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              {form.type !== "JASA" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Stok {isEdit ? "" : "Awal"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.stock}
                      onChange={(e) => updateField("stock", e.target.value)}
                      disabled={saving}
                      placeholder="0"
                      className="w-full rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                    />
                    {isEdit && (
                      <p className="mt-1.5 text-xs text-zinc-400">
                        Mengubah stok di sini langsung menimpa angka stok saat
                        ini — tidak tercatat sebagai mutasi/opname.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Minimum Stok
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.min_stock}
                      onChange={(e) => updateField("min_stock", e.target.value)}
                      disabled={saving}
                      placeholder="0"
                      className="w-full rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                    />
                  </div>
                </>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => updateField("is_active", e.target.checked)}
                disabled={saving}
                className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
              />
              <div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Produk aktif
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Produk aktif dapat digunakan dalam transaksi kasir.
                </p>
              </div>
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors duration-150 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Batal
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-lco-green px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving
                ? "Menyimpan..."
                : isEdit
                  ? "Simpan Perubahan"
                  : "Simpan Produk"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
