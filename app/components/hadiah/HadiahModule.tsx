"use client";

// ── TAMBAHAN (migration 044) ── Modul Hadiah & Oleh-oleh.
//
// Kebiasaan pondok: tamu (terutama tamu besar yang diminta Bapak Kiyai, atau
// tamu toko) diberi oleh-oleh dari produk toko. Barang keluar tanpa penjualan,
// jadi harus tercatat sebagai pengeluaran (BEBAN HADIAH) sebesar harga modal —
// bukan hilang sebagai selisih opname.
//
// Layar ini: ringkasan beban per periode, daftar hadiah, catat hadiah baru
// (stok berkurang + mutasi "Hadiah" di Riwayat Mutasi + Log Aktivitas), detail,
// pembatalan, dan ekspor Excel untuk pembukuan.
//
// Akses: izin modul `hadiah` (Lihat / Tambah / Hapus). Yang benar-benar
// mengikat tetap RLS + cek izin di RPC give_gift / void_gift.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  Gift,
  Inbox,
  Loader2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useAuth, hasPermission, hasPermissionAction } from "@/hooks/useAuth";
import { useProducts } from "@/hooks/useProducts";
import {
  GIFT_CATEGORIES,
  GIFT_CATEGORY_LABEL,
  useGifts,
} from "@/hooks/useGifts";
import {
  formatDateOnly,
  formatNumber,
  formatRupiah,
  toDateInputValue,
} from "../stok/stokUtils";
import GiftForm from "./GiftForm";
import GiftDetail from "./GiftDetail";
import { exportGiftsToExcel } from "./hadiahExport";

type View =
  | { kind: "list" }
  | { kind: "form" }
  | { kind: "detail"; giftId: string };

type PeriodKey = "bulan_ini" | "bulan_lalu" | "tahun_ini" | "semua" | "kustom";

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "bulan_ini", label: "Bulan Ini" },
  { key: "bulan_lalu", label: "Bulan Lalu" },
  { key: "tahun_ini", label: "Tahun Ini" },
  { key: "semua", label: "Semua" },
  { key: "kustom", label: "Kustom" },
];

function resolvePeriod(
  key: PeriodKey,
  customFrom: string,
  customTo: string,
): { from: string; to: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (key) {
    case "bulan_ini":
      return {
        from: toDateInputValue(new Date(year, month, 1)),
        to: toDateInputValue(new Date(year, month + 1, 0)),
        label: new Intl.DateTimeFormat("id-ID", {
          month: "long",
          year: "numeric",
        }).format(now),
      };
    case "bulan_lalu": {
      const last = new Date(year, month - 1, 1);
      return {
        from: toDateInputValue(last),
        to: toDateInputValue(new Date(year, month, 0)),
        label: new Intl.DateTimeFormat("id-ID", {
          month: "long",
          year: "numeric",
        }).format(last),
      };
    }
    case "tahun_ini":
      return {
        from: toDateInputValue(new Date(year, 0, 1)),
        to: toDateInputValue(new Date(year, 11, 31)),
        label: `Tahun ${year}`,
      };
    case "kustom":
      return {
        from: customFrom,
        to: customTo,
        label:
          customFrom || customTo
            ? `${customFrom || "awal"} s/d ${customTo || "sekarang"}`
            : "Semua periode",
      };
    default:
      return { from: "", to: "", label: "Semua periode" };
  }
}

export default function HadiahModule() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const [view, setView] = useState<View>({ kind: "list" });
  const [period, setPeriod] = useState<PeriodKey>("bulan_ini");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(
    () => resolvePeriod(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const { gifts, isLoading, error, refetch, giveGift } = useGifts({
    dateFrom: range.from,
    dateTo: range.to,
  });

  // includeInactive: produk nonaktif tetap punya stok fisik di rak dan boleh
  // dihadiahkan (hanya Kasir yang membatasi ke produk aktif).
  const { products, refetch: refetchProducts } = useProducts({
    includeInactive: true,
  });

  const canView = hasPermission(user, "hadiah");
  const canCreate = hasPermissionAction(user, "hadiah", "create");
  const canVoid = hasPermissionAction(user, "hadiah", "delete");

  // Hadiah yang dibatalkan TIDAK dihitung di beban.
  const summary = useMemo(() => {
    const active = gifts.filter((gift) => gift.status === "completed");

    const perCategory = GIFT_CATEGORIES.map((key) => {
      const rows = active.filter((gift) => gift.recipient_category === key);
      return {
        key,
        count: rows.length,
        cost: rows.reduce((sum, gift) => sum + gift.total_cost, 0),
      };
    });

    return {
      count: active.length,
      qty: active.reduce((sum, gift) => sum + gift.total_qty, 0),
      cost: active.reduce((sum, gift) => sum + gift.total_cost, 0),
      retail: active.reduce((sum, gift) => sum + gift.total_retail, 0),
      perCategory,
    };
  }, [gifts]);

  // ---------------- Layar blokir untuk user tanpa akses ----------------
  if (!isAuthLoading && !canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Akun Anda tidak punya akses ke menu Hadiah & Oleh-oleh. Hubungi admin
          kalau Anda memang perlu mencatat atau melihat hadiah.
        </p>
      </div>
    );
  }

  const handleStockChanged = () => {
    refetch();
    refetchProducts();
  };

  const inputClass =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Alat Kasir
          </p>
          <h2 className="text-xl font-semibold tracking-tight">
            Hadiah & Oleh-oleh
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Catat produk toko yang diberikan sebagai oleh-oleh/hadiah untuk
            tamu atau Bapak Kiyai. Stok berkurang otomatis dan nilainya
            tercatat sebagai beban hadiah (harga modal).
          </p>
        </div>

        {view.kind === "list" && canCreate && (
          <button
            type="button"
            onClick={() => setView({ kind: "form" })}
            className="flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
          >
            <Plus className="h-4 w-4" />
            Catat Hadiah
          </button>
        )}
      </div>

      {view.kind === "form" && (
        <GiftForm
          products={products}
          onBack={() => setView({ kind: "list" })}
          onSubmit={giveGift}
          onSaved={(result) => {
            handleStockChanged();
            setView({ kind: "detail", giftId: result.giftId });
          }}
        />
      )}

      {view.kind === "detail" && (
        <GiftDetail
          giftId={view.giftId}
          canVoid={canVoid}
          onBack={() => setView({ kind: "list" })}
          onChanged={handleStockChanged}
        />
      )}

      {view.kind === "list" && (
        <div>
          {/* Filter periode */}
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="inline-flex w-fit flex-wrap gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
              {PERIOD_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                    period === key
                      ? "bg-white text-lco-green shadow-sm dark:bg-zinc-800 dark:text-lco-teal"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {period === "kustom" && (
                <>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="Dari tanggal"
                    className={inputClass}
                  />
                  <span className="text-xs text-zinc-400">s/d</span>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="Sampai tanggal"
                    className={inputClass}
                  />
                </>
              )}

              <button
                type="button"
                onClick={() => exportGiftsToExcel(gifts, range.label)}
                disabled={isLoading || gifts.length === 0}
                className="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                <Download className="h-4 w-4" />
                Ekspor Excel
              </button>
            </div>
          </div>

          {/* Ringkasan beban */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Beban hadiah · {range.label}
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-lco-coral">
                {formatRupiah(summary.cost)}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                Dihitung dari harga modal
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Jumlah pemberian
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                {formatNumber(summary.count)}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Total unit keluar
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                {formatNumber(summary.qty)}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Nilai jika dijual
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-500">
                {formatRupiah(summary.retail)}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                Info saja, bukan angka pembukuan
              </p>
            </div>
          </div>

          {/* Per kategori penerima */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summary.perCategory.map((row) => (
              <div
                key={row.key}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <p className="text-xs text-zinc-500">
                  {GIFT_CATEGORY_LABEL[row.key]}
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                  {formatRupiah(row.cost)}
                </p>
                <p className="text-[11px] text-zinc-400">
                  {formatNumber(row.count)} pemberian
                </p>
              </div>
            ))}
          </div>

          {/* Daftar */}
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat hadiah...
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 p-4 text-sm text-lco-coral">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : gifts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Inbox className="mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Belum ada hadiah yang dicatat di periode ini.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                      <th className="px-4 py-3">Dokumen</th>
                      <th className="px-4 py-3">Tanggal</th>
                      <th className="px-4 py-3">Penerima</th>
                      <th className="px-4 py-3 text-right">Unit</th>
                      <th className="px-4 py-3 text-right">Beban (Modal)</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                    {gifts.map((gift) => {
                      const isVoided = gift.status === "voided";

                      return (
                        <tr
                          key={gift.id}
                          onClick={() =>
                            setView({ kind: "detail", giftId: gift.id })
                          }
                          className="cursor-pointer transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                        >
                          <td className="px-4 py-3">
                            <p className="flex items-center gap-1.5 font-medium">
                              <Gift className="h-3.5 w-3.5 text-zinc-400" />#
                              {gift.number}
                            </p>
                            <p className="text-[11px] text-zinc-400">
                              {gift.created_by_name ?? "-"}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                            {formatDateOnly(gift.given_at)}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{gift.recipient_name}</p>
                            <p className="text-[11px] text-zinc-400">
                              {GIFT_CATEGORY_LABEL[gift.recipient_category]}
                              {gift.occasion ? ` · ${gift.occasion}` : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">
                            {formatNumber(gift.total_qty)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono tabular-nums ${
                              isVoided ? "text-zinc-400 line-through" : ""
                            }`}
                          >
                            {formatRupiah(gift.total_cost)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs font-semibold ${
                                isVoided
                                  ? "text-zinc-500 dark:text-zinc-400"
                                  : "text-lco-green dark:text-lco-teal"
                              }`}
                            >
                              {isVoided ? "Dibatalkan" : "Selesai"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-zinc-300 dark:text-zinc-600">
                            <ChevronRight className="inline h-4 w-4" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
