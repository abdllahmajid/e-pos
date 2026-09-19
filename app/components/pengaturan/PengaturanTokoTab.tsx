"use client";

// app/components/pengaturan/PengaturanTokoTab.tsx
// ── TAMBAHAN ── Sub-tab "Toko & Struk" di PengaturanModule.tsx (PRD §17 T-10).
// Form edit tabel `settings` (T-01, migration 005) — nama toko, alamat,
// telepon, footer struk, PPN (enabled+rate), pembulatan kembalian, modal awal
// shift default, format cetak default (struk/nota), ukuran kertas nota &
// thermal, dan tampil/sembunyi harga modal.
//
// Reuse penuh `hooks/useSettings.ts` yang sudah ada sejak T-01 — tidak ada
// hook/RPC baru di file ini. RLS `settings` (migration 005) sudah admin-only
// untuk INSERT/UPDATE, jadi kalaupun modul ini someday diakses non-admin
// (harusnya tidak, gate-nya di PengaturanModule.tsx), `updateSetting()` akan
// gagal dengan error dari Postgres, bukan diam-diam berhasil.
//
// Pola form: state lokal terpisah dari `settings` (bukan controlled langsung
// dari hook), disinkronkan SEKALI lewat useEffect saat fetch pertama selesai
// (`isLoading` true -> false) — supaya user boleh mengetik tanpa form
// "ke-reset" tiap kali `settings` berubah referensinya (mis. re-render lain
// yang tidak terkait). Submit membandingkan field yang BERUBAH saja terhadap
// `settings` asli, lalu panggil `updateSetting()` satu per satu HANYA untuk
// field yang berubah — bukan semua field sekaligus (mengurangi jumlah row
// UPDATE & baris `updated_by`/`updated_at` yang tersentuh tanpa perlu).

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";
import { useSettings, type Settings } from "@/hooks/useSettings";

const inputClass =
  "w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800";
const numberInputClass = `${inputClass} font-mono tabular-nums`;
const labelClass =
  "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

export default function PengaturanTokoTab() {
  const { settings, isLoading, error, updateSetting } = useSettings();

  const [form, setForm] = useState<Settings>(settings);
  // Dipakai supaya sinkronisasi awal dari `settings` -> `form` cuma terjadi
  // SEKALI (saat fetch pertama selesai), bukan tiap kali `settings` berubah
  // referensi — lihat catatan pola di atas.
  const [hasSynced, setHasSynced] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isLoading && !hasSynced) {
      setForm(settings);
      setHasSynced(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasSynced]);

  function updateField<K extends keyof Settings>(field: K, value: Settings[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveSuccess(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setIsSaving(true);

    try {
      // Hanya kirim field yang benar-benar berubah dibanding `settings` asli
      // (lihat catatan pola di atas) — dibandingkan terhadap `settings`
      // (bukan `form` sebelum submit), supaya perubahan dari sesi lain yang
      // sempat masuk lewat refetch juga ikut terhitung "berubah" kalau perlu
      // ditimpa ulang.
      const changedFields = (Object.keys(form) as (keyof Settings)[]).filter(
        (field) => form[field] !== settings[field],
      );

      if (changedFields.length === 0) {
        setIsSaving(false);
        return;
      }

      for (const field of changedFields) {
        // eslint-disable-next-line no-await-in-loop
        await updateSetting(field, form[field]);
      }

      setSaveSuccess(true);
    } catch (submitError) {
      setSaveError(
        submitError instanceof Error
          ? submitError.message
          : "Gagal menyimpan pengaturan.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading && !hasSynced) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat pengaturan...
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Gagal memuat pengaturan tersimpan: {error}. Form di bawah memakai
          nilai default sementara.
        </div>
      )}

      {/* ── Identitas toko ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Identitas Toko
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Nama Toko</label>
            <input
              type="text"
              value={form.namaToko}
              onChange={(e) => updateField("namaToko", e.target.value)}
              disabled={isSaving}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Telepon</label>
            <input
              type="text"
              value={form.telepon}
              onChange={(e) => updateField("telepon", e.target.value)}
              disabled={isSaving}
              placeholder="mis. 0812xxxxxxx"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Alamat</label>
            <textarea
              value={form.alamat}
              onChange={(e) => updateField("alamat", e.target.value)}
              disabled={isSaving}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Footer Struk</label>
            <textarea
              value={form.footerStruk}
              onChange={(e) => updateField("footerStruk", e.target.value)}
              disabled={isSaving}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>
      </div>

      {/* ── PPN ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Pajak (PPN)
        </h3>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <input
            type="checkbox"
            checked={form.ppnEnabled}
            onChange={(e) => updateField("ppnEnabled", e.target.checked)}
            disabled={isSaving}
            className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
          />
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Aktifkan baris PPN
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Kalau aktif, baris pajak muncul di layar Kasir & struk sesuai
              persentase di bawah.
            </p>
          </div>
        </label>
        <div className="mt-3 max-w-xs">
          <label className={labelClass}>Persentase PPN (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={form.ppnRate}
            onChange={(e) => updateField("ppnRate", Number(e.target.value))}
            disabled={isSaving || !form.ppnEnabled}
            className={numberInputClass}
          />
        </div>
      </div>

      {/* ── Kasir & Shift ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Kasir & Shift
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Pembulatan Kembalian Tunai (Rp)
            </label>
            <input
              type="number"
              min={1}
              value={form.rounding}
              onChange={(e) => updateField("rounding", Number(e.target.value))}
              disabled={isSaving}
              className={numberInputClass}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Kembalian tunai dibulatkan ke kelipatan ini, mis. 100.
            </p>
          </div>
          <div>
            <label className={labelClass}>Modal Awal Kas Default (Rp)</label>
            <input
              type="number"
              min={0}
              value={form.shiftDefaultCash}
              onChange={(e) =>
                updateField("shiftDefaultCash", Number(e.target.value))
              }
              disabled={isSaving}
              className={numberInputClass}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Nilai awal yang disarankan saat kasir membuka shift baru.
            </p>
          </div>
        </div>
      </div>

      {/* ── Cetak ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Format Cetak
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Format Default</label>
            <select
              value={form.printDefault}
              onChange={(e) =>
                updateField(
                  "printDefault",
                  e.target.value as Settings["printDefault"],
                )
              }
              disabled={isSaving}
              className={inputClass}
            >
              <option value="struk">Struk Thermal</option>
              <option value="nota">Nota A6/A5</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Ukuran Kertas Nota</label>
            <select
              value={form.paperNota}
              onChange={(e) =>
                updateField(
                  "paperNota",
                  e.target.value as Settings["paperNota"],
                )
              }
              disabled={isSaving}
              className={inputClass}
            >
              <option value="A6">A6</option>
              <option value="A5">A5</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Ukuran Kertas Thermal</label>
            <select
              value={form.paperThermal}
              onChange={(e) =>
                updateField(
                  "paperThermal",
                  e.target.value as Settings["paperThermal"],
                )
              }
              disabled={isSaving}
              className={inputClass}
            >
              <option value="58mm">58mm</option>
              <option value="80mm">80mm</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Harga modal ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Harga Modal
        </h3>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <input
            type="checkbox"
            checked={form.showCostPrice}
            onChange={(e) => updateField("showCostPrice", e.target.checked)}
            disabled={isSaving}
            className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
          />
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Tampilkan harga modal
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Kalau aktif, layar yang butuh permission{" "}
              <code className="font-mono">harga_modal</code> (PRD §5) akan
              menampilkan harga modal produk.
            </p>
          </div>
        </label>
      </div>

      {/* ── Aksi ── */}
      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-md bg-lco-teal px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Simpan Perubahan
        </button>

        {saveSuccess && (
          <span className="flex items-center gap-1.5 text-sm text-lco-green">
            <CheckCircle2 className="h-4 w-4" />
            Tersimpan.
          </span>
        )}

        {saveError && (
          <span className="flex items-center gap-1.5 text-sm text-lco-coral">
            <AlertCircle className="h-4 w-4" />
            {saveError}
          </span>
        )}
      </div>
    </form>
  );
}
