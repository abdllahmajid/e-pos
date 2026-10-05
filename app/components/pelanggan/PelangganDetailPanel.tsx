"use client";

// ── TAMBAHAN (menu Pelanggan) ── Panel detail pelanggan (drawer kanan di
// desktop, layar penuh di HP) dengan 3 tab: Ringkasan, Transaksi, Poin.
// Riwayat dimuat LAZY per tab (RPC get_customer_transactions / tabel
// customer_point_logs) — tidak menambah beban saat daftar dibuka.

import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Coins,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  X,
} from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import {
  isNamelessCustomer,
  normalizePhone,
  type CustomerTransaction,
  type CustomerWithStats,
  type PointLog,
} from "@/hooks/useCustomerAdmin";

type Tab = "ringkasan" | "transaksi" | "poin";

interface PelangganDetailPanelProps {
  customer: CustomerWithStats;
  pointValue: number;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAdjustPoints: () => void;
  onToggleActive: () => void;
  fetchTransactions: (id: string) => Promise<CustomerTransaction[]>;
  fetchPointLogs: (id: string) => Promise<PointLog[]>;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(
    new Date(iso.length === 10 ? `${iso}T00:00:00` : iso),
  );
}

function statusStyle(status: string): { label: string; className: string } {
  switch (status.toUpperCase()) {
    case "PAID":
      return { label: "Selesai", className: "text-lco-teal" };
    case "RETURN":
      return { label: "Retur", className: "text-lco-mustard" };
    case "VOID":
      return { label: "Void", className: "text-lco-coral" };
    default:
      return { label: status, className: "text-zinc-500" };
  }
}

export default function PelangganDetailPanel({
  customer,
  pointValue,
  canEdit,
  canDelete,
  onClose,
  onEdit,
  onAdjustPoints,
  onToggleActive,
  fetchTransactions,
  fetchPointLogs,
}: PelangganDetailPanelProps) {
  const [tab, setTab] = useState<Tab>("ringkasan");
  const [transactions, setTransactions] = useState<
    CustomerTransaction[] | null
  >(null);
  const [logs, setLogs] = useState<PointLog[] | null>(null);
  const [tabError, setTabError] = useState("");

  const customerId = customer.id;
  const points = customer.loyalty_points;

  useEffect(() => {
    if (tab === "ringkasan") return;
    let cancelled = false;

    async function load() {
      setTabError("");
      try {
        if (tab === "transaksi") {
          const rows = await fetchTransactions(customerId);
          if (!cancelled) setTransactions(rows);
        } else {
          const rows = await fetchPointLogs(customerId);
          if (!cancelled) setLogs(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setTabError(
            err instanceof Error ? err.message : "Gagal memuat data.",
          );
          if (tab === "transaksi") setTransactions([]);
          else setLogs([]);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // `points` ikut dependency supaya riwayat poin segar setelah penyesuaian.
  }, [tab, customerId, points, fetchTransactions, fetchPointLogs]);

  const waNumber = normalizePhone(customer.phone);
  const avgTrx =
    customer.trxCount > 0
      ? Math.round(customer.totalSpent / customer.trxCount)
      : 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-zinc-900 dark:text-zinc-100">
              {isNamelessCustomer(customer) ? customer.phone : customer.name}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              {!isNamelessCustomer(customer) && customer.phone && (
                <>{customer.phone} • </>
              )}
              Terdaftar {formatDate(customer.created_at)}
              {!customer.is_active && (
                <span className="ml-2 font-semibold text-lco-coral">
                  • Diarsipkan
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Aksi cepat */}
        <div className="flex flex-wrap gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {waNumber && (
            <a
              href={`https://wa.me/${waNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-lco-teal/15 px-3 py-1.5 text-xs font-semibold text-lco-green hover:bg-lco-teal/25 dark:text-lco-teal"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <Pencil className="h-3.5 w-3.5" /> Ubah
              </button>
              <button
                type="button"
                onClick={onAdjustPoints}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <Coins className="h-3.5 w-3.5" /> Sesuaikan Poin
              </button>
            </>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onToggleActive}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {customer.is_active ? (
                <>
                  <Archive className="h-3.5 w-3.5" /> Arsipkan
                </>
              ) : (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5" /> Aktifkan
                </>
              )}
            </button>
          )}
        </div>

        {/* Tab */}
        <div className="flex border-b border-zinc-200 px-3 dark:border-zinc-800">
          {(
            [
              ["ringkasan", "Ringkasan"],
              ["transaksi", "Transaksi"],
              ["poin", "Poin"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors ${
                tab === key
                  ? "border-lco-teal text-lco-green dark:text-lco-teal"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Isi */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === "ringkasan" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-[11px] text-zinc-500">Total belanja</p>
                  <p className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {formatRupiah(customer.totalSpent)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-[11px] text-zinc-500">Jumlah transaksi</p>
                  <p className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {customer.trxCount}x
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-[11px] text-zinc-500">
                    Rata-rata / transaksi
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {formatRupiah(avgTrx)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-[11px] text-zinc-500">Poin loyalitas</p>
                  <p className="mt-0.5 text-sm font-bold text-lco-green dark:text-lco-teal">
                    {customer.loyalty_points}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    ≈ {formatRupiah(customer.loyalty_points * pointValue)}
                  </p>
                </div>
              </div>

              {customer.outstanding > 0 && (
                <div className="rounded-lg bg-lco-coral/10 p-3">
                  <p className="text-[11px] font-semibold text-lco-coral">
                    Piutang (Tempo) belum lunas
                  </p>
                  <p className="mt-0.5 text-base font-bold text-lco-coral">
                    {formatRupiah(customer.outstanding)}
                  </p>
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-zinc-500">
                Transaksi dikaitkan ke pelanggan lewat no. HP. Minta kasir
                mengisi no. HP member saat transaksi agar riwayat belanja
                tercatat.
              </p>
            </div>
          )}

          {tab === "transaksi" && (
            <div>
              {transactions === null ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
              ) : tabError ? (
                <p className="rounded-md bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
                  {tabError}
                </p>
              ) : transactions.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">
                  Belum ada transaksi untuk pelanggan ini.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {transactions.map((trx) => {
                    const st = statusStyle(trx.status);
                    return (
                      <li key={trx.id} className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {trx.receipt_no}
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              {formatDateTime(trx.created_at)} • {trx.methods}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                              {formatRupiah(trx.total)}
                            </p>
                            <p
                              className={`text-[11px] font-semibold ${st.className}`}
                            >
                              {st.label}
                            </p>
                          </div>
                        </div>
                        {trx.tempo_outstanding > 0 && (
                          <p className="mt-1 text-[11px] font-semibold text-lco-coral">
                            Piutang belum lunas:{" "}
                            {formatRupiah(trx.tempo_outstanding)}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === "poin" && (
            <div>
              {logs === null ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
              ) : tabError ? (
                <p className="rounded-md bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
                  {tabError}
                </p>
              ) : logs.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">
                  Belum ada riwayat perubahan poin.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {logs.map((log) => (
                    <li
                      key={log.id}
                      className="flex items-start justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-800 dark:text-zinc-200">
                          {log.reason ??
                            (log.type === "redeem"
                              ? "Dipakai di Kasir"
                              : "Penyesuaian")}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {formatDateTime(log.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={`text-sm font-bold ${
                            log.points_delta >= 0
                              ? "text-lco-teal"
                              : "text-lco-coral"
                          }`}
                        >
                          {log.points_delta >= 0 ? "+" : ""}
                          {log.points_delta}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          Saldo {log.balance_after}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
