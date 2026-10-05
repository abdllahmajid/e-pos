"use client";

// ── TAMBAHAN (menu Pelanggan, migration 035) ── Layar manajemen pelanggan:
// daftar + cari/filter/urut, kartu ringkasan, tambah/ubah, detail (riwayat
// transaksi & poin), penyesuaian poin, arsip/aktifkan, ekspor CSV, WhatsApp.
//
// Permission (Pengaturan > Role > "Kelola Pelanggan"): Lihat (buka menu),
// Tambah, Ubah (ubah data + sesuaikan poin), Hapus (arsipkan). Tombol
// disembunyikan sesuai izin; penegakan sebenarnya ada di RLS/RPC database.

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Coins,
  Download,
  Loader2,
  Plus,
  Search,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { hasPermission, hasPermissionAction, useAuth } from "@/hooks/useAuth";
import {
  useCustomerAdmin,
  isNamelessCustomer,
  type CustomerFormValues,
  type CustomerWithStats,
} from "@/hooks/useCustomerAdmin";
import { formatRupiah } from "@/lib/pos/cartLogic";
import Toast, { type ToastVariant } from "../ui/Toast";
import PelangganFormModal from "./PelangganFormModal";
import PelangganDetailPanel from "./PelangganDetailPanel";
import PoinAdjustModal from "./PoinAdjustModal";

// Nilai 1 poin = Rp 100. HARUS sama dengan LOYALTY_POINT_VALUE di
// app/components/kasir/KasirModule.tsx (konstanta itu tidak di-export);
// ubah keduanya bersamaan kalau tarif poin berubah.
const LOYALTY_POINT_VALUE = 100;
const PAGE_SIZE = 50;

type StatusFilter = "aktif" | "arsip" | "semua";
type QuickFilter = "poin" | "piutang" | "belum_belanja";
type SortKey = "nama" | "belanja" | "terbaru" | "poin" | "terakhir";

const SORT_LABELS: Record<SortKey, string> = {
  nama: "Nama A–Z",
  belanja: "Belanja tertinggi",
  terbaru: "Terbaru didaftarkan",
  poin: "Poin terbanyak",
  terakhir: "Terakhir belanja",
};

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(iso),
  );
}

function csvCell(value: string | number | null): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv(rows: CustomerWithStats[]) {
  const header = [
    "No. HP",
    "Nama",
    "Poin",
    "Jumlah Transaksi",
    "Total Belanja",
    "Piutang",
    "Terakhir Belanja",
    "Status",
    "Terdaftar",
  ];
  const lines = rows.map((c) =>
    [
      c.phone,
      isNamelessCustomer(c) ? "" : c.name,
      c.loyalty_points,
      c.trxCount,
      c.totalSpent,
      c.outstanding,
      c.lastTrxAt ? c.lastTrxAt.slice(0, 10) : "",
      c.is_active ? "Aktif" : "Diarsipkan",
      c.created_at.slice(0, 10),
    ]
      .map(csvCell)
      .join(","),
  );
  // BOM supaya Excel membaca UTF-8 (nama berhuruf non-ASCII) dengan benar.
  const blob = new Blob(
    ["\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n")],
    {
      type: "text/csv;charset=utf-8;",
    },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pelanggan-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PelangganModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const canView = hasPermission(user, "pelanggan");
  const canCreate = hasPermissionAction(user, "pelanggan", "create");
  const canEdit = hasPermissionAction(user, "pelanggan", "edit");
  const canDelete = hasPermissionAction(user, "pelanggan", "delete");

  const {
    customers,
    isLoading,
    error,
    refetch,
    createCustomer,
    updateCustomer,
    setActive,
    adjustPoints,
    fetchTransactions,
    fetchPointLogs,
  } = useCustomerAdmin();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("aktif");
  const [quickFilters, setQuickFilters] = useState<QuickFilter[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("nama");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const [toast, setToast] = useState<{
    message: string;
    variant: ToastVariant;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, variant: ToastVariant = "success") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, variant });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  const selected = useMemo(
    () => customers.find((c) => c.id === selectedId) ?? null,
    [customers, selectedId],
  );

  const summary = useMemo(() => {
    const active = customers.filter((c) => c.is_active);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      totalActive: active.length,
      newThisMonth: active.filter((c) => new Date(c.created_at) >= monthStart)
        .length,
      totalPoints: active.reduce((sum, c) => sum + c.loyalty_points, 0),
      totalOutstanding: active.reduce((sum, c) => sum + c.outstanding, 0),
      debtors: active.filter((c) => c.outstanding > 0).length,
    };
  }, [customers]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const queryDigits = query.replace(/\D/g, "");

    const rows = customers.filter((c) => {
      if (statusFilter === "aktif" && !c.is_active) return false;
      if (statusFilter === "arsip" && c.is_active) return false;
      if (quickFilters.includes("poin") && c.loyalty_points <= 0) return false;
      if (quickFilters.includes("piutang") && c.outstanding <= 0) return false;
      if (quickFilters.includes("belum_belanja") && c.trxCount > 0)
        return false;

      if (!query) return true;
      if (c.name.toLowerCase().includes(query)) return true;
      if (
        queryDigits.length >= 3 &&
        (c.phone ?? "").replace(/\D/g, "").includes(queryDigits)
      ) {
        return true;
      }
      return false;
    });

    rows.sort((a, b) => {
      switch (sortKey) {
        case "belanja":
          return b.totalSpent - a.totalSpent;
        case "terbaru":
          return b.created_at.localeCompare(a.created_at);
        case "poin":
          return b.loyalty_points - a.loyalty_points;
        case "terakhir":
          return (b.lastTrxAt ?? "").localeCompare(a.lastTrxAt ?? "");
        default:
          return a.name.localeCompare(b.name, "id");
      }
    });
    return rows;
  }, [customers, search, statusFilter, quickFilters, sortKey]);

  const visibleRows = filtered.slice(0, visibleCount);

  function toggleQuick(key: QuickFilter) {
    setQuickFilters((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    );
    setVisibleCount(PAGE_SIZE);
  }

  async function handleSubmitForm(values: CustomerFormValues) {
    if (formMode === "edit" && selected) {
      await updateCustomer(selected.id, values);
      showToast("Data pelanggan diperbarui.");
    } else {
      await createCustomer(values);
      showToast("Pelanggan berhasil didaftarkan.");
    }
    setFormMode(null);
  }

  async function handleToggleActive(customer: CustomerWithStats) {
    const archiving = customer.is_active;
    const confirmed = window.confirm(
      archiving
        ? `Arsipkan "${customer.name}"? Pelanggan tidak muncul lagi di pencarian Kasir. Riwayat transaksi tetap aman dan bisa diaktifkan kembali.`
        : `Aktifkan kembali "${customer.name}"?`,
    );
    if (!confirmed) return;
    try {
      await setActive(customer.id, !archiving);
      showToast(
        archiving ? "Pelanggan diarsipkan." : "Pelanggan diaktifkan kembali.",
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal mengubah status.",
        "error",
      );
    }
  }

  // Tunggu auth selesai dulu supaya layar "akses ditolak" tidak berkedip
  // sesaat untuk user yang sebenarnya punya izin (pola sama modul lain).
  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-lco-mustard" />
          <h3 className="mt-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Akses ditolak
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Role Anda belum punya izin membuka menu Pelanggan. Hubungi admin
            untuk mengaktifkannya di Pengaturan &gt; Role.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {toast && (
        <Toast visible message={toast.message} variant={toast.variant} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {/* Kartu ringkasan */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Users className="h-3.5 w-3.5" /> Pelanggan aktif
            </div>
            <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {summary.totalActive}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <UserPlus className="h-3.5 w-3.5" /> Baru bulan ini
            </div>
            <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {summary.newThisMonth}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Coins className="h-3.5 w-3.5" /> Poin beredar
            </div>
            <p className="mt-1 text-xl font-bold text-lco-green dark:text-lco-teal">
              {summary.totalPoints.toLocaleString("id-ID")}
            </p>
            <p className="text-[11px] text-zinc-500">
              ≈ {formatRupiah(summary.totalPoints * LOYALTY_POINT_VALUE)}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Wallet className="h-3.5 w-3.5" /> Piutang pelanggan
            </div>
            <p
              className={`mt-1 text-xl font-bold ${
                summary.totalOutstanding > 0
                  ? "text-lco-coral"
                  : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {formatRupiah(summary.totalOutstanding)}
            </p>
            <p className="text-[11px] text-zinc-500">
              {summary.debtors} pelanggan
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Cari no. HP atau nama…"
              className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-zinc-400 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              aria-label="Urutkan"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                exportCsv(filtered);
                showToast(`${filtered.length} pelanggan diekspor.`);
              }}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <Download className="h-3.5 w-3.5" /> Ekspor CSV
            </button>

            {canCreate && (
              <button
                type="button"
                onClick={() => setFormMode("create")}
                className="inline-flex items-center gap-1.5 rounded-md bg-lco-green px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-lco-green-hover"
              >
                <Plus className="h-3.5 w-3.5" /> Daftarkan Pelanggan
              </button>
            )}
          </div>
        </div>

        {/* Filter */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(
            [
              ["aktif", "Aktif"],
              ["arsip", "Diarsipkan"],
              ["semua", "Semua"],
            ] as [StatusFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setStatusFilter(key);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === key
                  ? "bg-lco-green text-white"
                  : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
          {(
            [
              ["poin", "Punya poin"],
              ["piutang", "Punya piutang"],
              ["belum_belanja", "Belum pernah belanja"],
            ] as [QuickFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleQuick(key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                quickFilters.includes(key)
                  ? "border-lco-teal bg-lco-teal/10 text-lco-green dark:text-lco-teal"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Daftar */}
        <div className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-lco-coral/30 bg-lco-coral/5 p-4 text-sm text-lco-coral">
              <p>{error}</p>
              <button
                type="button"
                onClick={refetch}
                className="mt-2 text-xs font-semibold underline"
              >
                Coba lagi
              </button>
              <p className="mt-2 text-[11px] text-zinc-500">
                Jika baru menambahkan menu ini, pastikan migration{" "}
                <code>035_customers_management.sql</code> sudah dijalankan.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
              <Users className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-2 text-sm text-zinc-500">
                {customers.length === 0
                  ? "Belum ada pelanggan."
                  : "Tidak ada pelanggan yang cocok dengan filter."}
              </p>
            </div>
          ) : (
            <>
              {/* Tabel (md ke atas) */}
              <div className="hidden overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 md:block">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Pelanggan</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Poin
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Transaksi
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Total belanja
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Piutang
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Terakhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {visibleRows.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className="cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {isNamelessCustomer(c) ? c.phone : c.name}
                            {!c.is_active && (
                              <Archive className="ml-1.5 inline h-3 w-3 text-zinc-400" />
                            )}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {isNamelessCustomer(c)
                              ? "Tanpa nama"
                              : (c.phone ?? "Belum ada no. HP")}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-lco-green dark:text-lco-teal">
                          {c.loyalty_points}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">
                          {c.trxCount}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">
                          {formatRupiah(c.totalSpent)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right ${
                            c.outstanding > 0
                              ? "font-semibold text-lco-coral"
                              : "text-zinc-400"
                          }`}
                        >
                          {c.outstanding > 0
                            ? formatRupiah(c.outstanding)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-500">
                          {formatShortDate(c.lastTrxAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Kartu (HP) */}
              <ul className="space-y-2 md:hidden">
                {visibleRows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className="w-full rounded-xl border border-zinc-200 bg-white p-3.5 text-left dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {isNamelessCustomer(c) ? c.phone : c.name}
                            {!c.is_active && (
                              <Archive className="ml-1.5 inline h-3 w-3 text-zinc-400" />
                            )}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {isNamelessCustomer(c)
                              ? "Tanpa nama"
                              : (c.phone ?? "Belum ada no. HP")}
                          </p>
                        </div>
                        {c.loyalty_points > 0 && (
                          <span className="shrink-0 rounded-full bg-lco-teal/15 px-2 py-0.5 text-[11px] font-semibold text-lco-green dark:text-lco-teal">
                            {c.loyalty_points} poin
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                        <span>
                          {c.trxCount}x • {formatRupiah(c.totalSpent)}
                        </span>
                        {c.outstanding > 0 && (
                          <span className="font-semibold text-lco-coral">
                            Piutang {formatRupiah(c.outstanding)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                <span>
                  Menampilkan {visibleRows.length} dari {filtered.length}{" "}
                  pelanggan
                </span>
                {visibleRows.length < filtered.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                    className="font-semibold text-lco-green hover:underline dark:text-lco-teal"
                  >
                    Tampilkan lebih banyak
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {selected && (
        <PelangganDetailPanel
          customer={selected}
          pointValue={LOYALTY_POINT_VALUE}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setSelectedId(null)}
          onEdit={() => setFormMode("edit")}
          onAdjustPoints={() => setAdjustOpen(true)}
          onToggleActive={() => handleToggleActive(selected)}
          fetchTransactions={fetchTransactions}
          fetchPointLogs={fetchPointLogs}
        />
      )}

      {formMode && (
        <PelangganFormModal
          customer={formMode === "edit" ? selected : null}
          existing={customers}
          onClose={() => setFormMode(null)}
          onSubmit={handleSubmitForm}
        />
      )}

      {adjustOpen && selected && (
        <PoinAdjustModal
          customer={selected}
          pointValue={LOYALTY_POINT_VALUE}
          onClose={() => setAdjustOpen(false)}
          onSubmit={async (delta, reason) => {
            await adjustPoints(selected.id, delta, reason);
            showToast("Poin pelanggan diperbarui.");
            setAdjustOpen(false);
          }}
        />
      )}
    </div>
  );
}
