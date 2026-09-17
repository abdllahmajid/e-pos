"use client";

// ── KOREKSI ── Diselaraskan dengan THEME-GUIDE LCO POS (Tailwind 4):
// - Warna generic (emerald/teal/red) diganti ke token lco-green / lco-teal / lco-coral.
// - Status "Aktif/Nonaktif" jadi indikator teks berwarna, bukan badge kotak solid (PRD §8).
// - Radius: rounded-md untuk tombol/input, rounded-xl untuk panel/modal (PRD §8).
// - Tambah dark mode (bg-zinc-950/900, border-zinc-800) agar konsisten dengan ProdukModule.tsx.
// - Tipe Category dipakai dari lib/pos/types.ts (satu sumber kebenaran, sama seperti useCategories hook).

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/lib/pos/types";

const supabase = createClient();

type CategoryForm = {
  name: string;
  color: string;
  sort_order: string;
  is_active: boolean;
};

const DEFAULT_FORM: CategoryForm = {
  name: "",
  color: "",
  sort_order: "0",
  is_active: true,
};

export default function KategoriModule() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<CategoryForm>(DEFAULT_FORM);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Catatan: sengaja TIDAK memakai hook useCategories() di sini.
  // Hook itu hanya mengambil kategori is_active=true (untuk chip filter Kasir),
  // sedangkan layar admin ini wajib menampilkan kategori nonaktif juga (agar bisa diaktifkan kembali).
  async function loadCategories() {
    setLoading(true);

    const { data, error: fetchError } = await supabase
      .from("categories")
      .select("id, name, color, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setCategories([]);
    } else {
      setCategories((data ?? []) as Category[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadCategories();
  }, []);

  function openCreateForm() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function openEditForm(category: Category) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      color: category.color ?? "",
      sort_order: String(category.sort_order ?? 0),
      is_active: category.is_active,
    });
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError("");
  }

  async function handleSave() {
    setError("");
    setSuccess("");

    const name = form.name.trim();
    const color = form.color.trim();
    const sortOrder = Number(form.sort_order);

    if (!name) {
      setError("Nama kategori wajib diisi.");
      return;
    }

    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      setError("Urutan harus berupa angka 0 atau lebih.");
      return;
    }

    setSaving(true);

    const payload = {
      name,
      color: color || null,
      sort_order: sortOrder,
      is_active: form.is_active,
    };

    const result = editingId
      ? await supabase.from("categories").update(payload).eq("id", editingId)
      : await supabase.from("categories").insert(payload);

    if (result.error) {
      if (result.error.code === "23505") {
        setError("Kategori dengan nama tersebut sudah ada.");
      } else {
        setError(result.error.message);
      }

      setSaving(false);
      return;
    }

    setSaving(false);
    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setSuccess(
      editingId
        ? "Kategori berhasil diperbarui."
        : "Kategori berhasil ditambahkan.",
    );

    await loadCategories();
  }

  async function handleDelete(category: Category) {
    setError("");
    setSuccess("");

    const confirmed = window.confirm(
      `Hapus kategori "${category.name}"?\n\nJika kategori sudah digunakan oleh produk, penghapusan mungkin gagal.`,
    );

    if (!confirmed) return;

    const { error: deleteError } = await supabase
      .from("categories")
      .delete()
      .eq("id", category.id);

    if (deleteError) {
      setError(
        "Kategori tidak dapat dihapus. Jika sudah digunakan produk, nonaktifkan kategori tersebut.",
      );
      return;
    }

    setSuccess("Kategori berhasil dihapus.");
    await loadCategories();
  }

  async function toggleActive(category: Category) {
    setError("");
    setSuccess("");

    const { error: updateError } = await supabase
      .from("categories")
      .update({ is_active: !category.is_active })
      .eq("id", category.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadCategories();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Master Data
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Kategori Produk
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Kelola kategori yang digunakan pada produk.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover"
        >
          <Plus size={18} />
          Tambah Kategori
        </button>
      </div>

      {error && !showForm && (
        <div className="rounded-md border border-lco-coral/30 bg-lco-coral/10 px-4 py-3 text-sm text-lco-coral">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md border border-lco-green/30 bg-lco-teal/10 px-4 py-3 text-sm text-lco-green dark:text-lco-teal">
          {success}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
            Memuat kategori...
          </div>
        ) : categories.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Belum ada kategori
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Tambahkan kategori pertama untuk mulai mengelompokkan produk.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Kategori
                  </th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Warna
                  </th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Urutan
                  </th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Status
                  </th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Aksi
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {categories.map((category) => (
                  <tr
                    key={category.id}
                    className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full border border-zinc-200 dark:border-zinc-700"
                          style={{
                            backgroundColor: category.color || "#a1a1aa",
                          }}
                        />
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {category.name}
                        </span>
                      </div>
                    </td>

                    <td className="px-5 py-4 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {category.color || "-"}
                    </td>

                    <td className="px-5 py-4 font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                      {category.sort_order}
                    </td>

                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => toggleActive(category)}
                        className={`text-sm font-medium transition-colors duration-150 ${
                          category.is_active
                            ? "text-lco-green hover:text-lco-green-hover dark:text-lco-teal"
                            : "text-zinc-400 hover:text-zinc-600"
                        }`}
                      >
                        {category.is_active ? "Aktif" : "Nonaktif"}
                      </button>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEditForm(category)}
                          className="rounded-md p-2 text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                          title="Edit kategori"
                        >
                          <Pencil size={17} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDelete(category)}
                          className="rounded-md p-2 text-zinc-500 transition-colors duration-150 hover:bg-lco-coral/10 hover:text-lco-coral"
                          title="Hapus kategori"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {editingId ? "Edit Kategori" : "Tambah Kategori"}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Isi informasi kategori.
                </p>
              </div>

              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-md p-2 text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-900"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 p-6">
              {error && (
                <div className="rounded-md border border-lco-coral/30 bg-lco-coral/10 px-4 py-3 text-sm text-lco-coral">
                  {error}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Nama Kategori
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((current) => ({ ...current, name: e.target.value }))
                  }
                  disabled={saving}
                  placeholder="Contoh: Kaos"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Warna
                </label>

                <div className="flex gap-2">
                  <input
                    type="color"
                    value={form.color || "#49bfb4"}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        color: e.target.value,
                      }))
                    }
                    disabled={saving}
                    className="h-10 w-12 cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
                  />

                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        color: e.target.value,
                      }))
                    }
                    disabled={saving}
                    placeholder="#49bfb4"
                    className="flex-1 rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm uppercase outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Urutan
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      sort_order: e.target.value,
                    }))
                  }
                  disabled={saving}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2.5 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      is_active: e.target.checked,
                    }))
                  }
                  disabled={saving}
                  className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
                />

                <div>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Kategori aktif
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Kategori aktif akan tersedia saat membuat produk.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors duration-150 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Batal
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-lco-green px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                {saving ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
