"use client";

// ── KOREKSI ── DUMMY_TRANSACTIONS dihapus, diganti data asli via hook useTransactions().
// Penyesuaian penting terhadap RPC create_transaction yang sudah dicek langsung ke database:
// - Status asli dari DB adalah 'PAID' (huruf besar), BUKAN 'selesai' seperti PRD §6.
//   normalizeStatus() di bawah menerjemahkan 'PAID' -> kelompok "selesai" untuk tampilan,
//   sekaligus tetap siap menerima 'retur_sebagian'/'retur_penuh'/'void' kalau backend
//   RPC retur/void sudah dibuat (belum ada saat ini).
// - Metode pembayaran & nominal diambil dari tabel `payments` (join), bukan dari `transactions`
//   langsung — kolom itu memang tidak ada di `transactions`.
// - Nomor struk asli formatnya LCO-STR/{yy}/{mm}/{urutan} (reset bulanan), ditampilkan apa adanya.
// - Tombol "Lihat Detail & Cetak" SENGAJA belum aktif — detail modal, cetak struk ulang, dan
//   retur/void perlu RPC backend yang belum ada, jadi disiapkan sebagai increment berikutnya.

import { useMemo, useState } from "react";
import { Search, Eye, AlertTriangle, Loader2, Inbox } from "lucide-react";
import {
  useTransactions,
  type TransactionListItem,
} from "@/hooks/useTransactions";
import { formatRupiah } from "@/lib/pos/cartLogic";
import TransactionDetailModal from "./TransactionDetailModal";

type StatusGroup = "selesai" | "retur" | "void" | "lainnya";

const TABS: { label: string; group: StatusGroup | "Semua" }[] = [
  { label: "Semua", group: "Semua" },
  { label: "Selesai", group: "selesai" },
  { label: "Retur", group: "retur" },
  { label: "Void", group: "void" },
];

/**
 * Status mentah dari database belum tentu sama dengan enum PRD §6 (lihat catatan di atas).
 * Fungsi ini satu-satunya tempat pemetaan status -> kelompok tampilan, supaya kalau nanti
 * RPC retur/void sudah ada dan nilainya berubah, cukup diperbarui di sini saja.
 */
function normalizeStatus(rawStatus: string): StatusGroup {
  const value = rawStatus.toUpperCase();

  if (value === "PAID" || value === "SELESAI") return "selesai";
  // ── KOREKSI ── Nilai asli dari database adalah 'RETURN' (lihat migration
  // 004_return_and_void.sql), belum pernah tercocokkan di sini karena sebelum modul
  // Retur dikerjakan, status ini tidak pernah benar-benar muncul dari RPC manapun.
  if (
    value === "RETURN" ||
    value === "RETUR_SEBAGIAN" ||
    value === "RETUR_PENUH" ||
    value === "RETUR"
  )
    return "retur";
  if (value === "VOID") return "void";

  return "lainnya";
}

function statusLabel(group: StatusGroup): string {
  const labels: Record<StatusGroup, string> = {
    selesai: "Selesai",
    retur: "Retur",
    void: "Void",
    lainnya: "Lainnya",
  };

  return labels[group];
}

function statusColorClass(group: StatusGroup): string {
  switch (group) {
    case "selesai":
      return "text-lco-teal";
    case "retur":
      return "text-lco-mustard";
    case "void":
      return "text-lco-coral";
    default:
      return "text-zinc-500";
  }
}

function statusDotClass(group: StatusGroup): string {
  switch (group) {
    case "selesai":
      return "bg-lco-teal";
    case "retur":
      return "bg-lco-mustard";
    case "void":
      return "bg-lco-coral";
    default:
      return "bg-zinc-400";
  }
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

/** Gabungkan metode dari semua baris payments (biasanya 1, tapi split payment fase 1.1 bisa >1). */
function formatPaymentMethods(transaction: TransactionListItem): string {
  if (transaction.payments.length === 0) return "-";

  return transaction.payments.map((p) => p.method).join(" + ");
}

export default function TransactionHistoryModule() {
  const { transactions, isLoading, error, refetch } = useTransactions();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<StatusGroup | "Semua">("Semua");
  const [selectedTransactionId, setSelectedTransactionId] = useState<
    string | null
  >(null);

  const filteredTransactions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();

    return transactions.filter((trx) => {
      const group = normalizeStatus(trx.status);

      const matchesTab = activeTab === "Semua" || group === activeTab;

      const matchesSearch =
        !keyword ||
        trx.receipt_no.toLowerCase().includes(keyword) ||
        (trx.customer_name ?? "").toLowerCase().includes(keyword);

      return matchesTab && matchesSearch;
    });
  }, [transactions, searchQuery, activeTab]);

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-950 p-4 md:p-6 text-zinc-900 dark:text-zinc-100 overflow-hidden">
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Utama
          </p>
          <h2 className="text-xl font-semibold tracking-tight">
            Riwayat Transaksi
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            Daftar penjualan, retur, dan pembatalan (void).
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Cari no. struk atau pelanggan..."
              className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm font-mono"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tab status — gaya "segmented control", konsisten dengan tab switcher
          di PengaturanModule.tsx: dibungkus satu kontainer beruas supaya
          kelihatan seperti sekelompok tombol, bukan teks bergaris bawah. */}
      <div className="mb-4 inline-flex w-fit flex-wrap gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
        {TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(tab.group)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-colors duration-150 ${
              activeTab === tab.group
                ? "bg-white text-lco-green shadow-sm dark:bg-zinc-800 dark:text-lco-teal"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Gagal memuat riwayat transaksi</p>
            <p className="mt-1 text-xs opacity-80">{error}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 text-xs font-semibold underline underline-offset-2"
            >
              Coba lagi
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800">
        {isLoading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat transaksi...
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <Inbox className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold">
              {searchQuery
                ? "Transaksi tidak ditemukan"
                : "Belum ada transaksi"}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {searchQuery
                ? "Coba gunakan nomor struk atau nama pelanggan yang berbeda."
                : "Transaksi yang dibayar dari layar Kasir akan muncul di sini."}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Tanggal
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  No. Struk
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Total
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Metode
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Status
                </th>
                <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 text-right">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredTransactions.map((trx) => {
                const group = normalizeStatus(trx.status);
                const isVoid = group === "void";

                return (
                  <tr
                    key={trx.id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors duration-150 group"
                  >
                    <td className="px-5 py-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {formatDate(trx.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-mono text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                        {trx.receipt_no}
                      </span>
                      <span className="ml-2 font-mono text-xs tabular-nums text-zinc-500">
                        {trx.item_count} item
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {isVoid ? (
                        <span className="line-through text-zinc-400">
                          {formatRupiah(trx.total)}
                        </span>
                      ) : (
                        formatRupiah(trx.total)
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 rounded-md">
                        {formatPaymentMethods(trx)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {/* ── TAMBAHAN (T-02) ──  Label badge "Piutang" */}
                      <div className="flex flex-col items-start gap-1.5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${statusColorClass(group)}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${statusDotClass(group)}`}
                          />
                          {statusLabel(group)}
                        </span>
                        {trx.payments?.some((p) => p.method === "TEMPO") && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider bg-lco-mustard/10 text-lco-mustard border border-lco-mustard/30 px-1.5 py-0.5 rounded-md">
                            Piutang
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        title="Lihat detail & cetak ulang struk"
                        onClick={() => setSelectedTransactionId(trx.id)}
                        className="p-1.5 text-zinc-500 hover:text-lco-teal hover:bg-lco-teal/10 rounded-md inline-flex transition-colors duration-150"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3 text-xs text-zinc-400">
        Menampilkan{" "}
        <span className="font-mono tabular-nums">
          {filteredTransactions.length}
        </span>{" "}
        dari{" "}
        <span className="font-mono tabular-nums">{transactions.length}</span>{" "}
        transaksi
      </div>

      <TransactionDetailModal
        transactionId={selectedTransactionId}
        onClose={() => setSelectedTransactionId(null)}
        onChanged={refetch}
      />
    </div>
  );
}
