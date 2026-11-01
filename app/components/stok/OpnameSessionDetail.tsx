// app/components/stok/OpnameSessionDetail.tsx
// ── TAMBAHAN (Fase 2 perbaikan Stok & Opname) ── Layar hitung satu sesi opname:
// progres, scan barcode / ketik SKU (tiap scan +1), isi hasil hitung per produk,
// selisih per produk (unit & rupiah), lalu Selesaikan atau Batalkan.
//
// Input angka & catatan sengaja UNCONTROLLED (defaultValue + key): nilai tampil
// otomatis mengikuti data terbaru dari server tanpa efek sinkronisasi, dan
// disimpan saat input kehilangan fokus / menekan Enter.
//
// Mode baca-saja untuk sesi selesai/dibatalkan dan untuk user tanpa izin
// stok:edit — pengecekan yang mengikat tetap di RPC (migration 041).

"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  FileSpreadsheet,
  Inbox,
  Loader2,
  Printer,
  ScanBarcode,
  Search,
  X,
} from "lucide-react";
import { useOpnameSession, type OpnameItem } from "@/hooks/useOpname";
import StokPagination from "./StokPagination";
import {
  OpnameCancelModal,
  OpnameFinalizeModal,
  OpnamePrintModal,
} from "./OpnameModals";
import { exportOpnameToExcel } from "./stokExport";
import {
  OPNAME_STATUS_LABEL,
  computeOpnameStats,
  itemDiff,
  opnameStatusColorClass,
} from "./opnameUtils";
import {
  deltaColorClass,
  formatDateTime,
  formatDelta,
  formatNumber,
  formatRupiah,
} from "./stokUtils";

const PAGE_SIZE = 50;

type RowFilter = "semua" | "belum" | "selisih" | "cocok";

const ROW_FILTERS: { key: RowFilter; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "belum", label: "Belum dihitung" },
  { key: "selisih", label: "Ada selisih" },
  { key: "cocok", label: "Cocok" },
];

interface ScanFeedback {
  type: "ok" | "error";
  text: string;
}

interface OpnameSessionDetailProps {
  sessionId: string;
  /** Boleh mengisi hitungan / menyelesaikan / membatalkan (izin stok:edit). */
  canEdit: boolean;
  onBack: () => void;
  /** Dipanggil saat stok berubah (sesi selesai) agar daftar stok & riwayat di-refresh. */
  onStockChanged: () => void;
  /** Dipanggil saat sesi berubah status supaya daftar sesi di-refresh. */
  onSessionChanged: () => void;
}

export default function OpnameSessionDetail({
  sessionId,
  canEdit,
  onBack,
  onStockChanged,
  onSessionChanged,
}: OpnameSessionDetailProps) {
  const { session, items, isLoading, error, saveCount, finalize, cancel } =
    useOpnameSession(sessionId);

  const [search, setSearch] = useState("");
  const [rowFilter, setRowFilter] = useState<RowFilter>("semua");
  const [page, setPage] = useState(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [showFinalize, setShowFinalize] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const isDraft = session?.status === "draft";
  const canCount = isDraft && canEdit;

  const stats = useMemo(() => computeOpnameStats(items), [items]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return items.filter((item) => {
      const diff = itemDiff(item);

      if (rowFilter === "belum" && diff !== null) return false;
      if (rowFilter === "selisih" && (diff === null || diff === 0)) return false;
      if (rowFilter === "cocok" && diff !== 0) return false;

      if (keyword === "") return true;

      return (
        item.product_name.toLowerCase().includes(keyword) ||
        (item.product_sku ?? "").toLowerCase().includes(keyword) ||
        (item.product_barcode ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [items, search, rowFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const progressPercent =
    stats.total === 0 ? 0 : Math.round((stats.counted / stats.total) * 100);

  // Simpan satu hitungan; status "sedang menyimpan" per produk supaya baris
  // lain tetap bisa diisi. Error ditampilkan di banner atas.
  const runSave = async (
    item: OpnameItem,
    params: { mode: "set" | "add" | "clear" | "note"; qty?: number; note?: string },
  ) => {
    if (!item.product_id) return null;

    const productId = item.product_id;
    setSaveError(null);
    setSavingIds((prev) => new Set(prev).add(productId));

    try {
      return await saveCount({ productId, ...params });
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Gagal menyimpan hitungan.",
      );
      return null;
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  };

  const handleCountBlur = (item: OpnameItem, raw: string) => {
    const text = raw.trim();

    if (text === "") {
      // Dikosongkan = hapus hitungan (hanya kalau sebelumnya sudah dihitung).
      if (item.counted_qty !== null) void runSave(item, { mode: "clear" });
      return;
    }

    const qty = Number(text);

    if (!Number.isInteger(qty) || qty < 0) {
      setSaveError(
        `Hitungan "${item.product_name}" harus berupa angka bulat 0 atau lebih.`,
      );
      return;
    }

    if (qty === item.counted_qty) return;

    void runSave(item, { mode: "set", qty });
  };

  const handleNoteBlur = (item: OpnameItem, raw: string) => {
    const text = raw.trim();
    if (text === (item.note ?? "")) return;
    void runSave(item, { mode: "note", note: text });
  };

  // Scanner barcode USB/Bluetooth bekerja seperti keyboard: mengetik kode lalu
  // Enter. Kode dicocokkan persis (tanpa beda huruf besar/kecil) ke barcode
  // atau SKU produk di sesi ini; tiap scan menambah hitungan 1.
  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();

    const code = scanValue.trim().toLowerCase();
    if (code === "") return;

    const match = items.find(
      (item) =>
        (item.product_barcode ?? "").toLowerCase() === code ||
        (item.product_sku ?? "").toLowerCase() === code,
    );

    setScanValue("");

    if (!match) {
      setScanFeedback({
        type: "error",
        text: `Kode "${code}" tidak ditemukan di sesi ini.`,
      });
      scanInputRef.current?.focus();
      return;
    }

    const result = await runSave(match, { mode: "add", qty: 1 });

    if (result) {
      setScanFeedback({
        type: "ok",
        text: `${match.product_name} — dihitung ${formatNumber(result.counted_qty ?? 0)}`,
      });
    } else {
      setScanFeedback({
        type: "error",
        text: `${match.product_name} gagal disimpan.`,
      });
    }

    scanInputRef.current?.focus();
  };

  const cardClass =
    "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
  const labelClass =
    "text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400";
  const inputClass =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950";

  if (isLoading && !session) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat sesi opname...
      </div>
    );
  }

  if (error || !session) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-sm text-zinc-500 transition-colors duration-150 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke daftar sesi
        </button>
        <div className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-lco-coral dark:border-zinc-800 dark:bg-zinc-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error ?? "Sesi opname tidak ditemukan."}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 text-sm text-zinc-500 transition-colors duration-150 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke daftar sesi
      </button>

      {/* ---------------- Header sesi ---------------- */}
      <div className={`${cardClass} mb-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold">
              Opname #{session.number}
              <span
                className={`text-xs font-semibold ${opnameStatusColorClass(session.status)}`}
              >
                {OPNAME_STATUS_LABEL[session.status]}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              {session.name}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {session.category_name
                ? `Kategori ${session.category_name}`
                : "Semua produk berstok"}
              {" · dibuat "}
              {formatDateTime(session.created_at)}
              {session.created_by_name ? ` oleh ${session.created_by_name}` : ""}
            </p>
            {session.note && (
              <p className="mt-1 text-xs text-zinc-500">{session.note}</p>
            )}
            {session.status === "completed" && session.finalized_at && (
              <p className="mt-1 text-xs text-lco-green dark:text-lco-teal">
                Selesai {formatDateTime(session.finalized_at)}
                {session.finalized_by_name ? ` oleh ${session.finalized_by_name}` : ""}
              </p>
            )}
            {session.status === "cancelled" && (
              <p className="mt-1 text-xs text-zinc-500">
                Dibatalkan
                {session.cancelled_at ? ` ${formatDateTime(session.cancelled_at)}` : ""}
                {session.cancel_reason ? ` — ${session.cancel_reason}` : ""}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 md:items-end">
            <div className="flex flex-wrap gap-2">
              {isDraft && (
                <button
                  type="button"
                  onClick={() => setShowPrint(true)}
                  className="flex items-center gap-2 rounded-md border border-zinc-300 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <Printer className="h-4 w-4" />
                  Cetak Lembar Hitung
                </button>
              )}
              <button
                type="button"
                onClick={() => exportOpnameToExcel(session, items)}
                className="flex items-center gap-2 rounded-md border border-zinc-300 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Ekspor Excel
              </button>
            </div>

          {canCount && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCancel(true)}
                className="flex items-center gap-2 rounded-md border border-zinc-300 px-3.5 py-2 text-sm font-medium text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 dark:border-zinc-700"
              >
                <Ban className="h-4 w-4" />
                Batalkan
              </button>
              <button
                type="button"
                onClick={() => setShowFinalize(true)}
                disabled={stats.counted === 0}
                className="flex items-center gap-2 rounded-md bg-lco-green px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Selesaikan
              </button>
            </div>
          )}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {formatNumber(stats.counted)} dari {formatNumber(stats.total)}{" "}
              produk dihitung
            </span>
            <span className="font-mono tabular-nums">{progressPercent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-lco-teal transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* ---------------- Ringkasan selisih ---------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={cardClass}>
          <p className={labelClass}>Belum Dihitung</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
            {formatNumber(stats.uncounted)}
          </p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Ada Selisih</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-lco-mustard">
            {formatNumber(stats.withDiff)}
          </p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Lebih / Kurang (unit)</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
            <span className="text-lco-green dark:text-lco-teal">
              +{formatNumber(stats.plusQty)}
            </span>
            <span className="text-zinc-400"> / </span>
            <span className="text-lco-coral">-{formatNumber(stats.minusQty)}</span>
          </p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Selisih Nilai</p>
          <p
            className={`mt-2 font-mono text-xl font-semibold tabular-nums ${deltaColorClass(stats.diffValue)}`}
          >
            {stats.diffValue === 0
              ? formatRupiah(0)
              : `${stats.diffValue > 0 ? "+" : "-"}${formatRupiah(Math.abs(stats.diffValue))}`}
          </p>
        </div>
      </div>

      {/* ---------------- Scan + filter ---------------- */}
      <div className={`${cardClass} mb-4`}>
        {canCount && (
          <form onSubmit={handleScan} className="mb-3">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <ScanBarcode className="h-3.5 w-3.5" />
              Scan barcode atau ketik SKU lalu Enter — tiap scan menambah 1
            </label>
            <input
              ref={scanInputRef}
              type="text"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              placeholder="Arahkan scanner ke sini..."
              autoComplete="off"
              className={`${inputClass} w-full font-mono`}
            />
            {scanFeedback && (
              <p
                className={`mt-1.5 text-xs ${
                  scanFeedback.type === "ok"
                    ? "text-lco-green dark:text-lco-teal"
                    : "text-lco-coral"
                }`}
              >
                {scanFeedback.text}
              </p>
            )}
          </form>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Cari nama, SKU, atau barcode..."
              className={`${inputClass} w-full pl-9`}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ROW_FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setRowFilter(option.key);
                  setPage(0);
                }}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                  rowFilter === option.key
                    ? "border-lco-teal text-lco-teal"
                    : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {saveError && (
        <div className="mb-4 flex items-start justify-between gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {saveError}
          </span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            aria-label="Tutup pesan"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ---------------- Tabel produk ---------------- */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {pageRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Tidak ada produk yang cocok dengan filter.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3 text-right">Stok Sistem</th>
                  <th className="px-4 py-3 text-right">Hitung Fisik</th>
                  <th className="px-4 py-3 text-right">Selisih</th>
                  <th className="px-4 py-3 text-right">Nilai</th>
                  <th className="px-4 py-3">Catatan</th>
                  {session.status === "completed" && (
                    <th className="px-4 py-3 text-right">Diterapkan</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {pageRows.map((item) => {
                  const diff = itemDiff(item);
                  const isSaving = item.product_id
                    ? savingIds.has(item.product_id)
                    : false;

                  return (
                    <tr
                      key={item.id}
                      className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.product_name}</p>
                        <p className="font-mono text-[11px] text-zinc-400">
                          {item.product_sku ?? "-"}
                          {item.product_barcode ? ` · ${item.product_barcode}` : ""}
                        </p>
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                        {formatNumber(item.system_qty)}
                        {item.product_unit && (
                          <span className="ml-1 text-[11px] text-zinc-400">
                            {item.product_unit}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {canCount ? (
                          <div className="flex items-center justify-end gap-2">
                            {isSaving && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                            )}
                            <input
                              key={`c:${item.id}:${item.counted_qty ?? ""}`}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              defaultValue={item.counted_qty ?? ""}
                              placeholder="-"
                              aria-label={`Hitung fisik ${item.product_name}`}
                              onBlur={(e) => handleCountBlur(item, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              className={`${inputClass} w-24 text-right font-mono tabular-nums`}
                            />
                          </div>
                        ) : (
                          <span className="font-mono tabular-nums">
                            {item.counted_qty === null
                              ? "-"
                              : formatNumber(item.counted_qty)}
                          </span>
                        )}
                      </td>

                      <td
                        className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                          diff === null
                            ? "text-zinc-400"
                            : deltaColorClass(diff)
                        }`}
                      >
                        {diff === null ? "-" : formatDelta(diff)}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-zinc-500">
                        {diff === null || diff === 0 || !item.cost_price
                          ? "-"
                          : `${diff > 0 ? "+" : "-"}${formatRupiah(Math.abs(diff) * item.cost_price)}`}
                      </td>

                      <td className="px-4 py-3">
                        {canCount ? (
                          <input
                            key={`n:${item.id}:${item.note ?? ""}`}
                            type="text"
                            defaultValue={item.note ?? ""}
                            placeholder="Catatan produk ini"
                            aria-label={`Catatan ${item.product_name}`}
                            onBlur={(e) => handleNoteBlur(item, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            className={`${inputClass} w-full min-w-[160px] text-xs`}
                          />
                        ) : (
                          <span className="text-xs text-zinc-500">
                            {item.note ?? "-"}
                          </span>
                        )}
                      </td>

                      {session.status === "completed" && (
                        <td
                          className={`px-4 py-3 text-right font-mono tabular-nums ${
                            item.applied_delta === null
                              ? "text-zinc-400"
                              : deltaColorClass(item.applied_delta)
                          }`}
                        >
                          {item.applied_delta === null
                            ? "-"
                            : formatDelta(item.applied_delta)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <StokPagination
          page={safePage}
          pageSize={PAGE_SIZE}
          totalCount={filtered.length}
          noun="produk"
          onPageChange={setPage}
        />
      </div>

      {isDraft && (
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
          Stok sistem diperbarui otomatis tiap kali hitungan produk disimpan,
          jadi penjualan yang terjadi selama opname tidak dianggap selisih.
          Kosongkan kolom Hitung Fisik untuk membatalkan hitungan satu produk.
        </p>
      )}

      {showFinalize && (
        <OpnameFinalizeModal
          sessionNumber={session.number}
          items={items}
          stats={stats}
          onClose={() => setShowFinalize(false)}
          onFinalize={finalize}
          onDone={() => {
            onStockChanged();
            onSessionChanged();
          }}
        />
      )}

      {showPrint && (
        <OpnamePrintModal
          session={session}
          items={items}
          onClose={() => setShowPrint(false)}
        />
      )}

      {showCancel && (
        <OpnameCancelModal
          sessionNumber={session.number}
          countedCount={stats.counted}
          onClose={() => setShowCancel(false)}
          onCancel={async (reason) => {
            await cancel(reason);
            onSessionChanged();
          }}
        />
      )}
    </div>
  );
}
