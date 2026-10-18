"use client";

// ── TAMBAHAN (menu Label Barcode) ── Cetak label barcode / QR code produk
// untuk ditempel di barang, supaya kasir tinggal scan (tanpa ketik SKU).
//
// Alur: (1) pilih jenis label (Tom & Jerry 103 dst. atau ukuran kustom),
// (2) pilih isi label (barcode/QR, nama, harga), (3) centang produk + jumlah
// label per produk. Panel kanan = preview lembar yang SAMA PERSIS dengan
// hasil cetak (HTML dibuat fungsi yang sama di lib/pos/labelPrint.ts) dan
// bisa dipindah antar lembar kalau labelnya lebih dari satu lembar.
//
// Kode yang di-encode = `barcode` produk; kalau kosong, pakai `sku` (SKU
// wajib & unik di tabel products, jadi selalu ada nilainya). Kasir
// (KasirModule) mencocokkan hasil scan ke KEDUANYA.
//
// Izin: memakai permission "produk" yang sudah ada (tidak perlu migration).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useAuth, hasPermission } from "@/hooks/useAuth";
import { useProducts, type ProductWithCategory } from "@/hooks/useProducts";
import {
  CUSTOM_PRESET_KEY,
  DEFAULT_PRESET_KEY,
  LABEL_PRESETS,
  LABEL_SHEET_CSS,
  MIN_SAFE_MODULE_MM,
  buildSheetHtml,
  estimateModuleMm,
  getPreset,
  isLandscape,
  labelsPerSheet,
  outputPageSize,
  paginateLabels,
  printLabelSheets,
  validateSpec,
  type LabelContentOptions,
  type LabelItem,
  type LabelSheetSpec,
} from "@/lib/pos/labelPrint";

const MAX_QTY = 999;
const PX_PER_MM = 96 / 25.4;
const PREVIEW_MAX_HEIGHT_PX = 620;

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 placeholder:text-zinc-400 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal dark:border-zinc-800 dark:bg-zinc-950";

const sectionClass =
  "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

const sectionTitleClass =
  "mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400";

function formatRupiah(value: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value)}`;
}

function clampQty(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_QTY, Math.max(1, Math.floor(value)));
}

function productCode(product: ProductWithCategory) {
  return (product.barcode ?? "").trim() || product.sku;
}

// ───────────────────────── Field angka kecil ─────────────────────────

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`${inputClass} ${suffix ? "pr-10" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex w-full gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-colors duration-150 ${
            value === option.key
              ? "bg-white text-lco-green shadow-sm dark:bg-zinc-800 dark:text-lco-teal"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CheckOption({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-lco-green"
      />
      {label}
    </label>
  );
}

// ───────────────────────── Modul utama ─────────────────────────

export default function LabelBarcodeModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const canAccess = hasPermission(user, "produk");

  const { products, isLoading, error, refetch } = useProducts();

  // ── Jenis label ──
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET_KEY);
  const [spec, setSpec] = useState<LabelSheetSpec>(
    () => getPreset(DEFAULT_PRESET_KEY)!.spec,
  );
  const [showDetail, setShowDetail] = useState(false);
  const [startPosition, setStartPosition] = useState(1);
  const [showOutline, setShowOutline] = useState(false);
  // true = lembar diputar 90° (orientasi kertas dibalik dari orientasi alami
  // preset/ukuran kertas). Lihat `outputPageSize` & `buildSheetHtml`.
  const [rotated, setRotated] = useState(false);

  // ── Isi label ──
  const [content, setContent] = useState<LabelContentOptions>({
    codeType: "barcode",
    showName: true,
    showPrice: true,
    showCode: true,
  });

  // ── Produk terpilih (id → jumlah label) ──
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [bulkQty, setBulkQty] = useState(1);

  // ── Preview ──
  const [pageIndex, setPageIndex] = useState(0);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(480);

  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setBoxWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canAccess]);

  function applyPreset(key: string) {
    setPresetKey(key);
    const preset = getPreset(key);
    if (preset) {
      setSpec(preset.spec);
      setStartPosition(1);
      setPageIndex(0);
      setRotated(false);
    }
  }

  function updateSpec(patch: Partial<LabelSheetSpec>) {
    setSpec((prev) => ({ ...prev, ...patch }));
    setPresetKey(CUSTOM_PRESET_KEY);
  }

  function updateContent(patch: Partial<LabelContentOptions>) {
    setContent((prev) => ({ ...prev, ...patch }));
  }

  function toggleProduct(id: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  }

  function setQty(id: string, qty: number) {
    setSelected((prev) => ({ ...prev, [id]: clampQty(qty) }));
  }

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(keyword) ||
        product.sku.toLowerCase().includes(keyword) ||
        (product.barcode ?? "").toLowerCase().includes(keyword),
    );
  }, [products, search]);

  function selectAllShown() {
    setSelected((prev) => {
      const next = { ...prev };
      for (const product of filteredProducts) {
        if (!next[product.id]) next[product.id] = 1;
      }
      return next;
    });
  }

  function applyBulkQty() {
    const qty = clampQty(bulkQty);
    setSelected((prev) =>
      Object.fromEntries(Object.keys(prev).map((id) => [id, qty])),
    );
  }

  function applyStockQty() {
    setSelected((prev) => {
      const next: Record<string, number> = {};
      for (const id of Object.keys(prev)) {
        const product = products.find((p) => p.id === id);
        next[id] = product && !product.is_service ? clampQty(product.stock) : 1;
      }
      return next;
    });
  }

  const selectedProducts = useMemo(
    () => products.filter((product) => selected[product.id]),
    [products, selected],
  );

  // Daftar label (sudah diulang sesuai jumlah per produk).
  const items = useMemo<LabelItem[]>(() => {
    const list: LabelItem[] = [];
    for (const product of selectedProducts) {
      const item: LabelItem = {
        code: productCode(product),
        name: product.name,
        price: product.sell_price,
      };
      for (let i = 0; i < (selected[product.id] ?? 0); i++) list.push(item);
    }
    return list;
  }, [selectedProducts, selected]);

  const naturalLandscape = isLandscape(spec);
  const orientation: "portrait" | "landscape" = rotated
    ? naturalLandscape
      ? "portrait"
      : "landscape"
    : naturalLandscape
      ? "landscape"
      : "portrait";

  function changeOrientation(next: "portrait" | "landscape") {
    setRotated((next === "landscape") !== naturalLandscape);
  }

  const specError = validateSpec(spec);
  const perSheet = labelsPerSheet(spec);
  const safeStart = Math.min(
    Math.max(1, Math.floor(startPosition) || 1),
    perSheet,
  );

  const sheets = useMemo(
    () => (specError ? [] : paginateLabels(items, spec, safeStart)),
    [items, spec, safeStart, specError],
  );

  // Preview selalu menampilkan minimal satu lembar (kosong kalau belum ada
  // produk dipilih) supaya tata letak label langsung kelihatan.
  const previewSheets = useMemo(
    () =>
      sheets.length > 0
        ? sheets
        : [Array.from({ length: perSheet }, () => null)],
    [sheets, perSheet],
  );

  const safePageIndex = Math.min(pageIndex, previewSheets.length - 1);

  const previewHtml = useMemo(
    () =>
      specError
        ? ""
        : buildSheetHtml(
            previewSheets[safePageIndex],
            spec,
            content,
            true,
            rotated,
          ),
    [previewSheets, safePageIndex, spec, content, specError, rotated],
  );

  // Peringatan barcode terlalu rapat / kode tidak didukung.
  const codeWarnings = useMemo(() => {
    if (content.codeType !== "barcode" || specError) {
      return { unsupported: [] as string[], tooDense: [] as string[] };
    }
    const areaWidth = spec.labelWidth - 3;
    const unsupported: string[] = [];
    const tooDense: string[] = [];
    for (const product of selectedProducts) {
      const code = productCode(product);
      const moduleMm = estimateModuleMm(code, areaWidth);
      if (moduleMm === null) unsupported.push(product.name);
      else if (moduleMm < MIN_SAFE_MODULE_MM) tooDense.push(product.name);
    }
    return { unsupported, tooDense };
  }, [content.codeType, specError, spec.labelWidth, selectedProducts]);

  const totalLabels = items.length;
  const canPrint = totalLabels > 0 && !specError;

  // Skala preview: muat di lebar panel DAN tinggi maksimal.
  const outputPage = outputPageSize(spec, rotated);
  const pageWidthPx = outputPage.width * PX_PER_MM;
  const pageHeightPx = outputPage.height * PX_PER_MM;
  const scale = Math.max(
    0.1,
    Math.min(
      (boxWidth - 8) / pageWidthPx,
      PREVIEW_MAX_HEIGHT_PX / pageHeightPx,
      4,
    ),
  );

  function handlePrint() {
    if (!canPrint) return;
    printLabelSheets(sheets, spec, content, showOutline, rotated);
  }

  // ───────── Guard akses ─────────

  if (!isAuthLoading && !canAccess) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 p-6 dark:bg-zinc-950">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800">
            <ShieldAlert className="h-6 w-6 text-lco-coral" />
          </div>
          <h2 className="text-lg font-semibold">Akses ditolak</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Anda tidak punya izin Produk untuk mencetak label barcode.
          </p>
        </div>
      </div>
    );
  }

  const selectedCount = selectedProducts.length;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Alat Kasir
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Label Barcode
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Cetak label barcode / QR untuk ditempel di produk, supaya kasir
            tinggal scan.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        {/* ═════════ KIRI: pengaturan ═════════ */}
        <div className="flex flex-col gap-4">
          {/* 1. Jenis label */}
          <section className={sectionClass}>
            <p className={sectionTitleClass}>1 · Jenis label</p>

            <select
              value={presetKey}
              onChange={(event) => {
                if (event.target.value === CUSTOM_PRESET_KEY) {
                  setPresetKey(CUSTOM_PRESET_KEY);
                  setShowDetail(true);
                } else {
                  applyPreset(event.target.value);
                }
              }}
              className={inputClass}
            >
              {LABEL_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.name}
                </option>
              ))}
              <option value={CUSTOM_PRESET_KEY}>Kustom (atur sendiri)</option>
            </select>

            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {getPreset(presetKey)?.description ??
                `${spec.labelWidth} × ${spec.labelHeight} mm · ${perSheet} label/lembar (${spec.cols} × ${spec.rows})`}
            </p>

            <div className="mt-4">
              <span className="mb-1.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Orientasi kertas
              </span>
              <SegmentedControl
                value={orientation}
                options={[
                  { key: "portrait", label: "Portrait" },
                  { key: "landscape", label: "Landscape" },
                ]}
                onChange={changeOrientation}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {rotated
                  ? "Lembar diputar 90° dari susunan aslinya — masukkan kertas ke printer dengan arah yang sesuai."
                  : `Sesuai susunan asli lembar (${naturalLandscape ? "landscape" : "portrait"}). Pilih yang lain untuk memutar seluruh lembar 90°.`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="mt-3 text-xs font-semibold text-lco-green hover:underline dark:text-lco-teal"
            >
              {showDetail
                ? "Sembunyikan detail ukuran"
                : "Atur detail ukuran & margin"}
            </button>

            {showDetail && (
              <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <NumberField
                    label="Lebar kertas"
                    suffix="mm"
                    value={spec.pageWidth}
                    onChange={(v) => updateSpec({ pageWidth: v })}
                  />
                  <NumberField
                    label="Tinggi kertas"
                    suffix="mm"
                    value={spec.pageHeight}
                    onChange={(v) => updateSpec({ pageHeight: v })}
                  />
                  <NumberField
                    label="Kolom"
                    value={spec.cols}
                    min={1}
                    onChange={(v) => updateSpec({ cols: Math.floor(v) })}
                  />
                  <NumberField
                    label="Baris"
                    value={spec.rows}
                    min={1}
                    onChange={(v) => updateSpec({ rows: Math.floor(v) })}
                  />
                  <NumberField
                    label="Lebar label"
                    suffix="mm"
                    step={0.5}
                    value={spec.labelWidth}
                    onChange={(v) => updateSpec({ labelWidth: v })}
                  />
                  <NumberField
                    label="Tinggi label"
                    suffix="mm"
                    step={0.5}
                    value={spec.labelHeight}
                    onChange={(v) => updateSpec({ labelHeight: v })}
                  />
                  <NumberField
                    label="Jarak antar kolom"
                    suffix="mm"
                    step={0.5}
                    value={spec.gapX}
                    onChange={(v) => updateSpec({ gapX: v })}
                  />
                  <NumberField
                    label="Jarak antar baris"
                    suffix="mm"
                    step={0.5}
                    value={spec.gapY}
                    onChange={(v) => updateSpec({ gapY: v })}
                  />
                  <NumberField
                    label="Margin kiri"
                    suffix="mm"
                    step={0.5}
                    value={spec.marginLeft}
                    onChange={(v) => updateSpec({ marginLeft: v })}
                  />
                  <NumberField
                    label="Margin atas"
                    suffix="mm"
                    step={0.5}
                    value={spec.marginTop}
                    onChange={(v) => updateSpec({ marginTop: v })}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Ukuran label sesuai spesifikasi penjual, tetapi margin tiap
                  merek/batch bisa berbeda sedikit. Cetak dulu di kertas HVS
                  dengan <b>Cetak uji (garis tepi)</b>, tempelkan ke lembar
                  stiker lalu cocokkan — geser Margin kiri/atas bila perlu.
                </p>
              </div>
            )}

            {specError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 p-3 text-xs text-lco-coral">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {specError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800 sm:grid-cols-2">
              <div>
                <NumberField
                  label="Mulai dari label ke-"
                  value={safeStart}
                  min={1}
                  onChange={(v) => {
                    setStartPosition(
                      Math.min(perSheet, Math.max(1, Math.floor(v) || 1)),
                    );
                    setPageIndex(0);
                  }}
                />
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Untuk lembar yang labelnya sudah terpakai sebagian (1–
                  {perSheet}).
                </p>
              </div>
              <div className="flex items-end pb-1">
                <CheckOption
                  label="Cetak uji (garis tepi)"
                  checked={showOutline}
                  onChange={setShowOutline}
                />
              </div>
            </div>
          </section>

          {/* 2. Isi label */}
          <section className={sectionClass}>
            <p className={sectionTitleClass}>2 · Isi label</p>

            <SegmentedControl
              value={content.codeType}
              options={[
                { key: "barcode", label: "Barcode" },
                { key: "qr", label: "QR Code" },
              ]}
              onChange={(codeType) => updateContent({ codeType })}
            />

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <CheckOption
                label="Nama produk"
                checked={content.showName}
                onChange={(showName) => updateContent({ showName })}
              />
              <CheckOption
                label="Harga"
                checked={content.showPrice}
                onChange={(showPrice) => updateContent({ showPrice })}
              />
              <CheckOption
                label="Teks kode"
                checked={content.showCode}
                onChange={(showCode) => updateContent({ showCode })}
              />
            </div>

            {codeWarnings.unsupported.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 p-3 text-xs text-lco-coral">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Kode produk ini memuat karakter yang tidak didukung barcode,
                  gunakan QR Code:{" "}
                  {codeWarnings.unsupported.slice(0, 3).join(", ")}
                  {codeWarnings.unsupported.length > 3 &&
                    ` +${codeWarnings.unsupported.length - 3} lainnya`}
                </span>
              </div>
            )}

            {codeWarnings.tooDense.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 p-3 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Kode terlalu panjang untuk lebar label ini — garis barcode
                  sangat rapat dan bisa sulit di-scan. Pakai QR Code atau label
                  yang lebih lebar:{" "}
                  {codeWarnings.tooDense.slice(0, 3).join(", ")}
                  {codeWarnings.tooDense.length > 3 &&
                    ` +${codeWarnings.tooDense.length - 3} lainnya`}
                </span>
              </div>
            )}
          </section>

          {/* 3. Produk */}
          <section className={sectionClass}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                3 · Produk & jumlah label
              </p>
              <span className="font-mono text-xs tabular-nums text-zinc-500">
                {selectedCount} dipilih
              </span>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nama, SKU, atau barcode..."
                  className={`${inputClass} pl-9`}
                />
              </div>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isLoading}
                aria-label="Muat ulang produk"
                className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 transition-colors duration-150 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={selectAllShown}
                disabled={filteredProducts.length === 0}
                className="rounded-md border border-zinc-200 px-2.5 py-1.5 font-medium transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Pilih semua yang tampil
              </button>
              <button
                type="button"
                onClick={() => setSelected({})}
                disabled={selectedCount === 0}
                className="rounded-md border border-zinc-200 px-2.5 py-1.5 font-medium transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Kosongkan
              </button>
              <span className="mx-1 hidden h-4 w-px bg-zinc-200 dark:bg-zinc-800 sm:block" />
              <span className="text-zinc-500 dark:text-zinc-400">
                Jumlah semua:
              </span>
              <input
                type="number"
                min={1}
                max={MAX_QTY}
                value={bulkQty}
                onChange={(event) => setBulkQty(Number(event.target.value))}
                className="w-16 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-center text-xs outline-none focus:border-lco-teal dark:border-zinc-800 dark:bg-zinc-950"
              />
              <button
                type="button"
                onClick={applyBulkQty}
                disabled={selectedCount === 0}
                className="rounded-md border border-zinc-200 px-2.5 py-1.5 font-medium transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Terapkan
              </button>
              <button
                type="button"
                onClick={applyStockQty}
                disabled={selectedCount === 0}
                className="rounded-md border border-zinc-200 px-2.5 py-1.5 font-medium transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Sesuai stok
              </button>
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 p-3 text-xs text-lco-coral">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Gagal memuat produk: {error}
              </div>
            )}

            <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              {isLoading ? (
                <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-zinc-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Memuat produk...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="flex min-h-32 items-center justify-center px-4 text-center text-sm text-zinc-500">
                  {search ? "Produk tidak ditemukan." : "Belum ada produk."}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredProducts.map((product) => {
                    const qty = selected[product.id];
                    const isSelected = Boolean(qty);
                    return (
                      <li
                        key={product.id}
                        className={`flex items-center gap-3 px-3 py-2.5 ${
                          isSelected ? "bg-lco-green/5 dark:bg-lco-teal/10" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProduct(product.id)}
                          aria-label={`Pilih ${product.name}`}
                          className="h-4 w-4 shrink-0 accent-lco-green"
                        />
                        <button
                          type="button"
                          onClick={() => toggleProduct(product.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-medium">
                            {product.name}
                          </p>
                          <p className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            {productCode(product)} ·{" "}
                            {formatRupiah(product.sell_price)}
                            {!product.is_service && ` · stok ${product.stock}`}
                          </p>
                        </button>

                        {isSelected && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setQty(product.id, qty - 1)}
                              aria-label="Kurangi"
                              className="rounded-md border border-zinc-200 p-1.5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={MAX_QTY}
                              value={qty}
                              onChange={(event) =>
                                setQty(product.id, Number(event.target.value))
                              }
                              className="w-14 rounded-md border border-zinc-200 bg-white px-1 py-1 text-center text-sm outline-none focus:border-lco-teal dark:border-zinc-800 dark:bg-zinc-950"
                            />
                            <button
                              type="button"
                              onClick={() => setQty(product.id, qty + 1)}
                              aria-label="Tambah"
                              className="rounded-md border border-zinc-200 p-1.5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* ═════════ KANAN: preview ═════════ */}
        <div className="lg:sticky lg:top-0">
          <section className={sectionClass}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Preview
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-mono tabular-nums">{totalLabels}</span>{" "}
                label ·{" "}
                <span className="font-mono tabular-nums">{sheets.length}</span>{" "}
                lembar
              </p>
            </div>

            {/* Navigasi lembar */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
                disabled={safePageIndex <= 0}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Sebelumnya
              </button>

              <span className="text-xs font-medium tabular-nums">
                Lembar {safePageIndex + 1} dari {previewSheets.length}
              </span>

              <button
                type="button"
                onClick={() =>
                  setPageIndex(
                    Math.min(previewSheets.length - 1, safePageIndex + 1),
                  )
                }
                disabled={safePageIndex >= previewSheets.length - 1}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Berikutnya
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Area kertas */}
            <div
              ref={previewBoxRef}
              className="flex justify-center overflow-hidden rounded-lg bg-zinc-200 p-2 dark:bg-zinc-900"
            >
              {specError ? (
                <div className="flex min-h-64 items-center px-6 text-center text-sm text-zinc-500">
                  Perbaiki ukuran label untuk melihat preview.
                </div>
              ) : (
                <div
                  className="shrink-0 bg-white shadow-md"
                  style={{
                    width: pageWidthPx * scale,
                    height: pageHeightPx * scale,
                  }}
                >
                  <style>{LABEL_SHEET_CSS}</style>
                  <div
                    style={{
                      width: pageWidthPx,
                      height: pageHeightPx,
                      transform: `scale(${scale})`,
                      transformOrigin: "top left",
                    }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </div>

            {totalLabels === 0 && !specError && (
              <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
                Pilih produk di sebelah kiri untuk melihat labelnya di sini.
              </p>
            )}

            <button
              type="button"
              onClick={handlePrint}
              disabled={!canPrint}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Cetak {totalLabels > 0 ? `${totalLabels} label` : "label"}
              {sheets.length > 1 ? ` (${sheets.length} lembar)` : ""}
            </button>

            <p className="mt-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
              Di dialog cetak pilih ukuran kertas sesuai lembar, skala 100%, dan
              margin &ldquo;Tidak ada&rdquo;.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
