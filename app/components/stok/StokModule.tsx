"use client";

// ── TAMBAHAN (T-05) ── Modul Stok & Opname (PRD §17 T-05 + §4.3 "Mutasi stok").
// Konsumen hooks/useStock.ts (riwayat mutasi + RPC adjust_stock) & hooks/useProducts.ts
// (daftar produk untuk dipilih saat opname). Pola UI disamakan dengan KasModule.tsx
// (kartu status + modal + tabel riwayat) supaya tidak ada dialek visual baru.
//
// Akses: PRD §5 baris `stok` — kasir TIDAK punya akses sama sekali, supervisor & admin
// punya view/edit. Di sini itu ditegakkan 2 lapis:
//   1. Layar blokir di bawah (lapis UX, biar kasir dapat penjelasan, bukan tabel kosong).
//   2. RLS `stock_movements_select_supervisor` + cek role di RPC `adjust_stock`
//      (migration 009) — ini yang sebenarnya mengikat, tidak bisa dilewati.
// Menu-nya sendiri masih tampil untuk semua role di Sidebar; penyembunyian menu per
// role adalah bagian permission matrix di T-10, sengaja belum dikerjakan di sini.
//
// Yang SENGAJA belum ada (bukan bug, scope task lain):
// - Menu "Stok Menipis" (§4.1) — modul terpisah, bukan bagian T-05.
// - Opname massal / sekaligus banyak produk lewat import Excel — belum diminta PRD;
//   opname di sini per produk, sesuai Definition of Done T-05.
// - Realtime stok antar-kasir (§4.10) — fase 1.1.

import { useMemo, useState } from "react";
import {
  Boxes,
  ClipboardCheck,
  Loader2,
  AlertTriangle,
  Inbox,
  Search,
  X,
  ShieldAlert,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import {
  useStock,
  MOVEMENT_TYPE_LABEL,
  type StockMovementType,
  type ManualMovementType,
  type AdjustStockResult,
} from "@/hooks/useStock";
import { useProducts, type ProductWithCategory } from "@/hooks/useProducts";
import { useAuth } from "@/hooks/useAuth";

const FILTER_TYPES: StockMovementType[] = [
  "sale",
  "return",
  "void",
  "opname",
  "adjustment",
];

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

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

/** Warna teks per jenis mutasi — "status = teks berwarna", bukan badge solid (§16). */
function typeColorClass(type: StockMovementType): string {
  switch (type) {
    case "return":
    case "opname":
      return "text-lco-teal";
    case "void":
      return "text-lco-coral";
    case "adjustment":
      return "text-lco-mustard";
    default:
      return "text-zinc-500";
  }
}

/** Angka mutasi: minus = coral, plus = teal, nol = zinc (opname yang hasilnya cocok). */
function deltaColorClass(qtyDelta: number): string {
  if (qtyDelta < 0) return "text-lco-coral";
  if (qtyDelta > 0) return "text-lco-teal";
  return "text-zinc-400";
}

function formatDelta(qtyDelta: number): string {
  if (qtyDelta > 0) return `+${qtyDelta}`;
  return String(qtyDelta);
}

// --------------------------------------------------------
// Modal: Opname / Penyesuaian
// --------------------------------------------------------

function AdjustStockModal({
  products,
  onClose,
  onSubmit,
}: {
  products: ProductWithCategory[];
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
    useState<ProductWithCategory | null>(null);
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

// --------------------------------------------------------
// Modul utama
// --------------------------------------------------------

export default function StokModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [activeTypes, setActiveTypes] = useState<StockMovementType[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { movements, isLoading, error, adjustStock } = useStock({
    types: activeTypes,
    limit: 150,
  });

  // includeInactive: produk nonaktif tetap punya stok fisik di rak dan tetap
  // perlu diopname — beda dengan layar Kasir yang hanya boleh menjual yang aktif.
  const { products } = useProducts({ includeInactive: true });

  const canManageStock = user?.role === "admin" || user?.role === "supervisor";

  const toggleType = (type: StockMovementType) => {
    setActiveTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  // Ringkasan kecil dari data yang sedang tampil — bukan agregat seluruh database
  // (itu bagian Laporan/Dashboard, T-06/T-08).
  const summary = useMemo(() => {
    const masuk = movements
      .filter((m) => m.qty_delta > 0)
      .reduce((total, m) => total + m.qty_delta, 0);
    const keluar = movements
      .filter((m) => m.qty_delta < 0)
      .reduce((total, m) => total + Math.abs(m.qty_delta), 0);
    return { masuk, keluar };
  }, [movements]);

  // ---------------- Layar blokir untuk role tanpa akses ----------------
  if (!isAuthLoading && !canManageStock) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Modul Stok & Opname hanya untuk supervisor dan admin. Hubungi admin
          kalau Anda memang perlu melakukan opname.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Alat Kasir
          </p>
          <h2 className="text-xl font-semibold tracking-tight">
            Stok & Opname
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Semua perubahan stok tercatat di sini — penjualan, retur, void,
            opname, dan penyesuaian manual.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
        >
          <ClipboardCheck className="h-4 w-4" />
          Opname / Penyesuaian
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ---------------- Ringkasan dari data yang tampil ---------------- */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:max-w-md">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Stok Masuk
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold leading-none tabular-nums text-lco-teal">
            {summary.masuk}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            <ArrowDownRight className="h-3.5 w-3.5" />
            Stok Keluar
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold leading-none tabular-nums text-lco-coral">
            {summary.keluar}
          </p>
        </div>
      </div>

      {/* ---------------- Filter jenis mutasi ---------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setActiveTypes([])}
          className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ${
            activeTypes.length === 0
              ? "border-lco-teal text-lco-teal"
              : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
          }`}
        >
          Semua
        </button>
        {FILTER_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => toggleType(type)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ${
              activeTypes.includes(type)
                ? "border-lco-teal text-lco-teal"
                : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            {MOVEMENT_TYPE_LABEL[type]}
          </button>
        ))}
      </div>

      {/* ---------------- Riwayat mutasi ---------------- */}
      <div className="flex-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {isLoading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat riwayat mutasi...
          </div>
        ) : movements.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <Inbox className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold">Belum ada mutasi stok</h3>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Mutasi akan muncul otomatis setiap ada penjualan, retur, atau
              opname.
            </p>
          </div>
        ) : (
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Waktu
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Produk
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Jenis
                </th>
                <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Qty
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Alasan
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Oleh
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="px-5 py-3 font-mono text-xs tabular-nums">
                    {formatDateTime(movement.created_at)}
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-xs font-medium">
                      {movement.product_name ?? "(produk dihapus)"}
                    </p>
                    {movement.product_sku && (
                      <p className="font-mono text-[11px] tabular-nums text-zinc-400">
                        {movement.product_sku}
                      </p>
                    )}
                  </td>
                  <td
                    className={`px-5 py-3 text-xs font-medium ${typeColorClass(movement.type)}`}
                  >
                    {MOVEMENT_TYPE_LABEL[movement.type] ?? movement.type}
                  </td>
                  <td
                    className={`px-5 py-3 text-right font-mono text-xs font-medium tabular-nums ${deltaColorClass(movement.qty_delta)}`}
                  >
                    {formatDelta(movement.qty_delta)}
                  </td>
                  <td className="max-w-xs truncate px-5 py-3 text-xs text-zinc-500">
                    {movement.reason ?? "-"}
                  </td>
                  <td className="px-5 py-3 text-xs text-zinc-500">
                    {movement.created_by_name ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && (
        <AdjustStockModal
          products={products}
          onClose={() => setIsModalOpen(false)}
          onSubmit={adjustStock}
        />
      )}
    </div>
  );
}
