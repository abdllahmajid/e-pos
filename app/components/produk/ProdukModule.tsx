"use client";

// ── KOREKSI ── Diselaraskan dengan hook & pola yang sudah ada:
// - Fetch manual via supabase.from("products")... DIHAPUS, diganti reuse hook useProducts()
//   (sudah join kategori) — satu sumber kebenaran dengan KasirModule nanti.
// - Tabel sekarang menampilkan kolom Kategori (chip warna kecil, bukan badge kotak — §8).
// - refetch() dari hook dipakai setelah simpan produk & setelah tombol Refresh ditekan,
//   menggantikan loadProducts() lokal.
// - Sisanya (warna lco-*, radius, dark mode) sudah benar sejak draft awal — dipertahankan.
// ── TAMBAHAN ── Tab internal "Daftar Produk" / "Kategori" (pola sama dengan tab status
// di TransactionHistoryModule). Sebelumnya KategoriModule sudah jadi tapi tidak
// tersambung ke UI manapun — makanya tabel `categories` kosong & chip filter Kasir
// cuma nampilin "Semua". Kategori WAJIB diisi lewat sini dulu sebelum dipilih di form Produk.

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProducts, type ProductWithCategory } from "@/hooks/useProducts";
import {
  createProduct,
  deleteProduct,
  updateProduct,
  type CreateProductInput,
} from "@/lib/pos/productLogic";
import type { ProductType } from "@/lib/pos/types";
import ProdukForm, { type ProductFormValues } from "./ProdukForm";
import KategoriModule from "./KategoriModule";

type ProdukTab = "produk" | "kategori";

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatProductType(type: ProductType) {
  const labels: Record<ProductType, string> = {
    FASHION: "Fashion",
    SABLON: "Sablon",
    KONVEKSI: "Konveksi",
    PERCETAKAN: "Percetakan",
    MERCHANDISE: "Merchandise",
    PARFUM: "Parfum",
    JASA: "Jasa",
  };

  return labels[type];
}

function parseNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

export default function ProdukModule() {
  // Tombol Hapus (T-09) hanya untuk admin — sesuai matriks permission PRD §5
  // (baris `produk`: delete cuma ✔ di kolom Admin, Supervisor cuma view/edit).
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { products, isLoading, error, refetch } = useProducts();

  const [activeTab, setActiveTab] = useState<ProdukTab>("produk");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<ProductWithCategory | null>(null);

  // ── TAMBAHAN (T-09) ── Konfirmasi hapus (soft-delete) produk. Dipisah dari
  // `showForm`/`editingProduct` di atas supaya klik "Hapus" tidak ikut
  // membuka form edit — dua alur berbeda walau sama-sama dipicu dari baris
  // tabel yang sama.
  const [deletingProduct, setDeletingProduct] =
    useState<ProductWithCategory | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return products;
    }

    return products.filter((product) => {
      return (
        product.name.toLowerCase().includes(keyword) ||
        product.sku.toLowerCase().includes(keyword) ||
        (product.barcode ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [products, search]);

  const activeProducts = products.filter((product) => product.is_active).length;

  const lowStockProducts = products.filter(
    (product) =>
      product.is_active &&
      product.type !== "JASA" &&
      product.stock <= product.min_stock,
  ).length;

  function openForm() {
    setFormError(null);
    setEditingProduct(null);
    setShowForm(true);
  }

  function openEditForm(product: ProductWithCategory) {
    setFormError(null);
    setEditingProduct(product);
    setShowForm(true);
  }

  function closeForm() {
    if (saving) {
      return;
    }

    setFormError(null);
    setEditingProduct(null);
    setShowForm(false);
  }

  async function handleFormSubmit(values: ProductFormValues) {
    setSaving(true);
    setFormError(null);

    const input: CreateProductInput = {
      name: values.name,
      sku: values.sku,
      barcode: values.barcode,
      type: values.type,
      category_id: values.category_id,
      unit: values.unit,
      sell_price: parseNumber(values.sell_price),
      cost_price: parseNumber(values.cost_price),
      stock: values.type === "JASA" ? 0 : parseNumber(values.stock),
      min_stock: values.type === "JASA" ? 0 : parseNumber(values.min_stock),
      photo_url: values.photo_url,
      is_active: values.is_active,
    };

    const result = editingProduct
      ? await updateProduct({ ...input, id: editingProduct.id })
      : await createProduct(input);

    if (!result.success) {
      setFormError(result.error);
      setSaving(false);
      return;
    }

    setShowForm(false);
    setEditingProduct(null);
    setFormError(null);
    setSaving(false);

    // Produk baru/ubahan tersimpan di Supabase — refetch dari hook agar katalog Kasir
    // (yang memakai hook yang sama) ikut konsisten begitu tab-nya dibuka.
    refetch();
  }

  // ── TAMBAHAN (T-09) ── Hapus (soft-delete) produk lewat RPC
  // `soft_delete_product` (migration 014, dipanggil via `deleteProduct()` di
  // productLogic.ts). Produk yang dihapus pindah ke halaman Sampah (belum
  // dibuat di file ini — menyusul), bukan hilang permanen.
  function openDeleteConfirm(product: ProductWithCategory) {
    setDeleteError(null);
    setDeleteReason("");
    setDeletingProduct(product);
  }

  function closeDeleteConfirm() {
    if (isDeleting) {
      return;
    }

    setDeletingProduct(null);
    setDeleteReason("");
    setDeleteError(null);
  }

  async function handleConfirmDelete() {
    if (!deletingProduct) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    const result = await deleteProduct(deletingProduct.id, deleteReason);

    if (!result.success) {
      setDeleteError(result.error);
      setIsDeleting(false);
      return;
    }

    setIsDeleting(false);
    setDeletingProduct(null);
    setDeleteReason("");
    refetch();
  }

  return (
    <section className="h-full overflow-y-auto bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Master Data
            </p>

            <h2 className="text-2xl font-semibold tracking-tight">Produk</h2>

            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Kelola produk & kategori yang tersedia di kasir.
            </p>
          </div>

          {activeTab === "produk" && (
            <button
              type="button"
              onClick={openForm}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover"
            >
              <Plus className="h-4 w-4" />
              Tambah Produk
            </button>
          )}
        </div>

        <div className="mb-6 flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
          {(
            [
              { key: "produk", label: "Daftar Produk" },
              { key: "kategori", label: "Kategori" },
            ] as { key: ProdukTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative pb-3 text-xs font-semibold uppercase tracking-[0.12em] transition-colors duration-150 ${
                activeTab === tab.key
                  ? "text-lco-teal"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-lco-teal" />
              )}
            </button>
          ))}
        </div>

        {activeTab === "kategori" ? (
          <KategoriModule />
        ) : (
          <>
            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Total Produk
                </p>

                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                  {products.length}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Produk Aktif
                </p>

                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                  {activeProducts}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Stok Menipis
                </p>

                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-lco-coral">
                  {lowStockProducts}
                </p>
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />

                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nama, SKU, atau barcode..."
                  className="w-full rounded-md border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition-colors duration-150 placeholder:text-zinc-400 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal dark:border-zinc-800 dark:bg-zinc-950"
                />
              </div>

              <button
                type="button"
                onClick={() => refetch()}
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            </div>

            {error && (
              <div className="mb-4 flex items-start gap-3 border border-lco-coral/30 bg-white p-4 text-sm text-lco-coral dark:bg-zinc-950">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

                <div>
                  <p className="font-medium">Gagal memuat produk</p>

                  <p className="mt-1 break-all text-xs opacity-80">{error}</p>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              {isLoading ? (
                <div className="flex min-h-64 items-center justify-center">
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Memuat produk...
                  </div>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <Package className="h-6 w-6 text-zinc-400" />
                  </div>

                  <h3 className="text-sm font-semibold">
                    {search ? "Produk tidak ditemukan" : "Belum ada produk"}
                  </h3>

                  <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                    {search
                      ? "Coba gunakan nama produk, SKU, atau barcode yang berbeda."
                      : "Tambahkan produk agar produk dapat digunakan di Kasir."}
                  </p>

                  {!search && (
                    <button
                      type="button"
                      onClick={openForm}
                      className="mt-4 inline-flex items-center gap-2 rounded-md bg-lco-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover"
                    >
                      <Plus className="h-4 w-4" />
                      Tambah Produk
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                      <tr>
                        <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Produk
                        </th>

                        <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Kategori
                        </th>

                        <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Tipe
                        </th>

                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Harga Jual
                        </th>

                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Stok
                        </th>

                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Min.
                        </th>

                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Status
                        </th>

                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          Aksi
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                      {filteredProducts.map((product: ProductWithCategory) => {
                        const isLowStock =
                          product.type !== "JASA" &&
                          product.stock <= product.min_stock;

                        return (
                          <tr
                            key={product.id}
                            className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                                  {product.photo_url ? (
                                    <img
                                      src={product.photo_url}
                                      alt={product.name}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <Package className="h-4 w-4 text-zinc-400" />
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    {product.name}
                                  </p>

                                  <p className="mt-0.5 font-mono text-xs tabular-nums text-zinc-400">
                                    {product.sku}
                                    {product.barcode
                                      ? ` · ${product.barcode}`
                                      : ""}
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              {product.category ? (
                                <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor:
                                        product.category.color || "#a1a1aa",
                                    }}
                                  />
                                  {product.category.name}
                                </span>
                              ) : (
                                <span className="text-zinc-400">—</span>
                              )}
                            </td>

                            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                              {formatProductType(product.type)}
                            </td>

                            <td className="px-4 py-3 text-right font-mono tabular-nums">
                              {formatRupiah(product.sell_price)}
                            </td>

                            <td
                              className={`px-4 py-3 text-right font-mono tabular-nums ${
                                isLowStock ? "font-semibold text-lco-coral" : ""
                              }`}
                            >
                              {product.type === "JASA" ? "∞" : product.stock}
                            </td>

                            <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                              {product.type === "JASA"
                                ? "—"
                                : product.min_stock}
                            </td>

                            <td className="px-4 py-3 text-right">
                              <span
                                className={
                                  product.is_active
                                    ? "text-lco-green dark:text-lco-teal"
                                    : "text-zinc-400"
                                }
                              >
                                {product.is_active ? "Aktif" : "Nonaktif"}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditForm(product)}
                                  title="Edit produk"
                                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Edit
                                </button>

                                {/* Hapus (T-09): admin only, sesuai PRD §5 baris `produk` — Supervisor cuma view/edit. */}
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => openDeleteConfirm(product)}
                                    title="Hapus produk (pindah ke Sampah)"
                                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 dark:border-zinc-700"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Hapus
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
            </div>

            <div className="mt-3 text-xs text-zinc-400">
              Menampilkan{" "}
              <span className="font-mono tabular-nums">
                {filteredProducts.length}
              </span>{" "}
              dari{" "}
              <span className="font-mono tabular-nums">{products.length}</span>{" "}
              produk
            </div>
          </>
        )}
      </div>

      {showForm && (
        <ProdukForm
          onClose={closeForm}
          onSubmit={handleFormSubmit}
          saving={saving}
          error={formError}
          mode={editingProduct ? "edit" : "create"}
          initialValues={
            editingProduct
              ? {
                  name: editingProduct.name,
                  sku: editingProduct.sku,
                  barcode: editingProduct.barcode ?? "",
                  type: editingProduct.type,
                  category_id: editingProduct.category_id ?? "",
                  unit: editingProduct.unit ?? "",
                  sell_price: String(editingProduct.sell_price ?? ""),
                  cost_price: String(editingProduct.cost_price ?? 0),
                  stock: String(editingProduct.stock ?? 0),
                  min_stock: String(editingProduct.min_stock ?? 0),
                  photo_url: editingProduct.photo_url ?? "",
                  is_active: editingProduct.is_active,
                }
              : undefined
          }
        />
      )}

      {/* ── TAMBAHAN (T-09) ── Konfirmasi hapus produk. Overlay & radius
          disamakan dengan ProdukForm.tsx (bg-zinc-950/30, rounded-xl) supaya
          konsisten sebagai satu keluarga modal, walau ukurannya jauh lebih
          kecil (bukan form). */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lco-coral/10 text-lco-coral">
                <Trash2 className="h-4 w-4" />
              </div>

              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Hapus produk?</h3>

                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {deletingProduct.name}
                  </span>{" "}
                  akan dipindah ke Sampah, bukan dihapus permanen — bisa
                  dipulihkan kembali kapan saja lewat menu Sampah.
                </p>
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Alasan (opsional)
            </label>

            <textarea
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              disabled={isDeleting}
              rows={2}
              placeholder="Mis. produk sudah tidak dijual lagi"
              className="mb-3 w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 placeholder:text-zinc-400 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
            />

            {deleteError && (
              <div className="mb-3 flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="break-all">{deleteError}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteConfirm}
                disabled={isDeleting}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 rounded-md bg-lco-coral px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-coral/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
