"use client";

// app/components/sampah/SampahModule.tsx
// ── TAMBAHAN ── Modul Sampah (PRD §17 T-09, §4.1 menu LAINNYA → "Sampah").
// Admin+supervisor (PRD §5 baris `trash` aslinya cuma ✔ di kolom Admin —
// dilonggarkan ke supervisor lewat keputusan sadar pemilik project, migration
// 015; lihat komentar header migration itu untuk alasan & konsekuensinya)
// — halaman ini SENGAJA tidak menyembunyikan diri sendiri kalau bukan
// admin/supervisor (itu tanggung jawab routing di app/page.tsx & Sidebar,
// sama seperti modul lain di project ini), tapi setiap aksi Pulihkan tetap
// aman kalau nekat diakses role lain: RPC `restore_product`/
// `restore_transaction` (migration 014, diperbarui migration 015) menolak
// dari sisi database, errornya ditampilkan apa adanya lewat state
// `actionError` di bawah.
//
// Tab "Produk" & "Transaksi" — pola sama dengan tab internal di
// ProdukModule.tsx (Daftar Produk/Kategori) & TransactionHistoryModule.tsx
// (filter status), bukan komponen tab generik terpisah.

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpFromLine,
  Loader2,
  Package,
  Receipt,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useTrash,
  type TrashedProduct,
  type TrashedTransaction,
} from "@/hooks/useTrash";
import { formatRupiah } from "@/lib/pos/cartLogic";

type SampahTab = "produk" | "transaksi";

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

const STATUS_LABEL: Record<TrashedTransaction["status"], string> = {
  PAID: "Selesai",
  VOID: "Void",
  RETURN: "Retur",
};

export default function SampahModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  // ── PERUBAHAN (migration 015) ── admin+supervisor, sebelumnya admin only.
  // Keputusan sadar pemilik project, menyimpang dari matriks PRD §5 asli —
  // lihat komentar header migration 015 untuk detail & konsekuensinya.
  const canAccessTrash = user?.role === "admin" || user?.role === "supervisor";

  const {
    products,
    transactions,
    isLoading,
    error,
    restoreProduct,
    restoreTransaction,
  } = useTrash();

  const [activeTab, setActiveTab] = useState<SampahTab>("produk");

  // Baris yang sedang diproses restore-nya — dikunci per-id (bukan satu
  // boolean global) supaya klik "Pulihkan" di baris lain tetap responsif
  // selagi satu baris lain masih diproses.
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isEmpty = useMemo(
    () =>
      activeTab === "produk"
        ? products.length === 0
        : transactions.length === 0,
    [activeTab, products.length, transactions.length],
  );

  async function handleRestoreProduct(product: TrashedProduct) {
    setActionError(null);
    setRestoringId(product.id);

    try {
      await restoreProduct(product.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Produk gagal dipulihkan.",
      );
    } finally {
      setRestoringId(null);
    }
  }

  async function handleRestoreTransaction(transaction: TrashedTransaction) {
    setActionError(null);
    setRestoringId(transaction.id);

    try {
      await restoreTransaction(transaction.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Transaksi gagal dipulihkan.",
      );
    } finally {
      setRestoringId(null);
    }
  }

  // Halaman Sampah admin-only (PRD §5 baris `trash`) — pola sama seperti
  // LaporanModule.tsx: menu tetap tampil di Sidebar untuk semua role (lihat
  // Sidebar.tsx), yang menahan akses justru layar blokir ini. Ditaruh
  // SETELAH semua hook dipanggil (bukan early-return di awal fungsi) supaya
  // urutan pemanggilan hook tetap konsisten antar render — aturan dasar
  // Rules of Hooks.
  //
  // ── PERBAIKAN ── Selama `isAuthLoading` masih true, dulu kode ini jatuh
  // ke `return` konten utama di bawah (kondisi `!isAuthLoading && !canAccessTrash`
  // otomatis false saat isAuthLoading true) — jadi header+tab+tabel sempat
  // dirender dulu, baru begitu auth selesai dimuat & ternyata bukan admin,
  // seluruh halaman diganti jadi layar blokir. Itu penyebab "kedipan" yang
  // dilaporkan. Sekarang loading auth punya cabangnya sendiri, TIDAK
  // dianggap sama dengan "izinnya belum diketahui" lalu lanjut render konten.
  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat...
        </div>
      </div>
    );
  }

  if (!canAccessTrash) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Modul Sampah hanya untuk admin dan supervisor. Hubungi admin kalau ada
          produk atau transaksi yang perlu dipulihkan.
        </p>
      </div>
    );
  }

  return (
    <section className="h-full overflow-y-auto bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="mb-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Administrasi
          </p>

          <h2 className="text-2xl font-semibold tracking-tight">Sampah</h2>

          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Produk & transaksi yang dihapus tetap tersimpan di sini dan bisa
            dipulihkan kapan saja — tidak ada penghapusan permanen.
          </p>
        </div>

        <div className="mb-6 flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
          {(
            [
              { key: "produk", label: `Produk (${products.length})` },
              { key: "transaksi", label: `Transaksi (${transactions.length})` },
            ] as { key: SampahTab; label: string }[]
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

        {error && (
          <div className="mb-4 flex items-start gap-3 border border-lco-coral/30 bg-white p-4 text-sm text-lco-coral dark:bg-zinc-950">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

            <div>
              <p className="font-medium">Gagal memuat Sampah</p>
              <p className="mt-1 break-all text-xs opacity-80">{error}</p>
            </div>
          </div>
        )}

        {actionError && (
          <div className="mb-4 flex items-start gap-3 border border-lco-coral/30 bg-white p-4 text-sm text-lco-coral dark:bg-zinc-950">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{actionError}</p>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          {isLoading ? (
            <div className="flex min-h-64 items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat Sampah...
              </div>
            </div>
          ) : isEmpty ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <Trash2 className="h-6 w-6 text-zinc-400" />
              </div>

              <h3 className="text-sm font-semibold">Sampah kosong</h3>

              <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                {activeTab === "produk"
                  ? "Belum ada produk yang dihapus."
                  : "Belum ada transaksi yang dihapus."}
              </p>
            </div>
          ) : activeTab === "produk" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Produk
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Harga Jual
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Stok
                    </th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Dihapus
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Aksi
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {products.map((product) => (
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
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatRupiah(product.sell_price)}
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {product.type === "JASA" ? "∞" : product.stock}
                      </td>

                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {formatDateTime(product.deleted_at)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRestoreProduct(product)}
                          disabled={restoringId === product.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-lco-teal transition-colors duration-150 hover:bg-lco-teal/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                        >
                          {restoringId === product.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Pulihkan
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      No. Struk
                    </th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Pelanggan
                    </th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Total
                    </th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Dihapus
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Aksi
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {transactions.map((transaction) => (
                    <tr
                      key={transaction.id}
                      className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Receipt className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                          <span className="font-mono text-xs tabular-nums">
                            {transaction.receipt_no}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        {transaction.customer_name || "—"}
                      </td>

                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        {STATUS_LABEL[transaction.status]}
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatRupiah(transaction.total)}
                      </td>

                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {formatDateTime(transaction.deleted_at)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRestoreTransaction(transaction)}
                          disabled={restoringId === transaction.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-lco-teal transition-colors duration-150 hover:bg-lco-teal/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                        >
                          {restoringId === transaction.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArrowUpFromLine className="h-3.5 w-3.5" />
                          )}
                          Pulihkan
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
