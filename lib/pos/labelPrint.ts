// lib/pos/labelPrint.ts
// ── TAMBAHAN (menu Label Barcode) ── Logika murni (tanpa React) untuk
// mencetak label barcode/QR produk ke kertas label stiker lembaran
// (Tom & Jerry No.103 dst.) atau ukuran kustom.
//
// Satu fungsi pembuat HTML (`buildSheetHtml`) dipakai DUA tempat supaya
// preview == hasil cetak (WYSIWYG): panel preview di LabelBarcodeModule.tsx
// dan `printLabelSheets` di bawah (iframe tersembunyi + window.print(),
// pola yang sama dengan struk di lib/pos/printLogic.ts).
//
// Semua ukuran dalam MILIMETER. Setiap label diposisikan `absolute` di dalam
// lembar berukuran mm persis, jadi hasil cetak tidak bergantung pada layout
// flow browser — yang penting di dialog print: Skala 100% (bukan "Fit to
// page") dan Margin "Tidak ada".

import QRCode from "qrcode";
import { encodeCode128B } from "@/lib/pos/barcode";

// ───────────────────────── Tipe ─────────────────────────

export interface LabelSheetSpec {
  /** Ukuran kertas (satu lembar), mm. */
  pageWidth: number;
  pageHeight: number;
  /** Jumlah kolom & baris label per lembar. */
  cols: number;
  rows: number;
  /** Ukuran satu label, mm. */
  labelWidth: number;
  labelHeight: number;
  /** Jarak tepi kertas ke label pertama, mm. */
  marginLeft: number;
  marginTop: number;
  /** Jarak antar label, mm. */
  gapX: number;
  gapY: number;
}

export interface LabelPreset {
  key: string;
  name: string;
  description: string;
  spec: LabelSheetSpec;
}

export type LabelCodeType = "barcode" | "qr";

export interface LabelContentOptions {
  codeType: LabelCodeType;
  showName: boolean;
  showPrice: boolean;
  /** Teks kode (angka/huruf) di bawah barcode / di samping QR. */
  showCode: boolean;
}

export interface LabelItem {
  /** Teks yang di-encode ke barcode/QR (barcode produk, atau SKU kalau kosong). */
  code: string;
  name: string;
  price: number;
}

// ───────────────────────── Preset ukuran ─────────────────────────
// Ukuran label & jumlah per lembar diambil dari spesifikasi penjual (T&J
// No.103: 32×64 mm, 12 label/lembar). MARGIN & JARAK di bawah adalah
// PERKIRAAN (dibuat simetris di tengah lembar) — tiap merek/batch bisa
// beda sedikit, makanya semua angka bisa diubah di UI dan ada mode "Cetak
// Uji" (garis tepi) untuk kalibrasi di kertas HVS biasa dulu.

function sheetFromPitch(
  pageWidth: number,
  pageHeight: number,
  cols: number,
  rows: number,
  labelWidth: number,
  labelHeight: number,
  marginLeft: number,
  marginTop: number,
  horizontalPitch: number,
  verticalPitch: number,
): LabelSheetSpec {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    pageWidth,
    pageHeight,
    cols,
    rows,
    labelWidth,
    labelHeight,
    marginLeft,
    marginTop,
    // Pitch = ukuran label + jarak antar label, jadi jarak = pitch - ukuran.
    gapX: round1(horizontalPitch - labelWidth),
    gapY: round1(verticalPitch - labelHeight),
  };
}

// Data dari pemilik toko: ukuran label, ukuran kertas, kolom × baris,
// margin atas/samping, dan pitch (jarak dari awal satu label ke awal label
// berikutnya). Bila data berupa rentang (mis. pitch 3,5–3,8 cm), dipakai
// nilai tengahnya — kecuali No. 104 (lihat catatan) karena nilai tengah
// tidak muat di kertas. Orientasi kertas mengikuti susunan yang muat:
// 103 & 105 landscape, 121 / 107 / 104 portrait. Selisih kecil antar
// merek/batch tetap mungkin — kalibrasi lewat "Cetak uji" (garis tepi).
export const LABEL_PRESETS: LabelPreset[] = [
  {
    key: "tj-103",
    name: "Tom & Jerry No. 103",
    description:
      "32 × 64 mm · 12 label/lembar (3 × 4) · kertas 204 × 165 mm · margin atas 9 / samping 2 mm",
    spec: sheetFromPitch(204, 165, 3, 4, 64, 32, 2, 9, 67.5, 36.5),
  },
  {
    key: "tj-121",
    name: "Tom & Jerry No. 121",
    description:
      "38 × 75 mm · 10 label/lembar (2 × 5) · kertas 165 × 205 mm · margin atas 7 / samping 9,5 mm",
    spec: sheetFromPitch(165, 205, 2, 5, 75, 38, 9.5, 7, 79, 39.5),
  },
  {
    key: "tj-107",
    name: "Tom & Jerry No. 107",
    description:
      "18 × 50 mm · 24 label/lembar (3 × 8) · kertas 165 × 205 mm · margin atas 6 / samping 3 mm",
    spec: sheetFromPitch(165, 205, 3, 8, 50, 18, 3, 6, 54, 20.5),
  },
  {
    // Pitch vertikal 25,0 mm (batas bawah rentang 25–26): 8 baris dengan
    // 25,5 mm tidak muat di kertas 205 mm.
    key: "tj-104",
    name: "Tom & Jerry No. 104",
    description:
      "24 × 75 mm · 16 label/lembar (2 × 8) · kertas 165 × 205 mm · margin atas 5 / samping 5 mm",
    spec: sheetFromPitch(165, 205, 2, 8, 75, 24, 5, 5, 79, 25),
  },
  {
    key: "tj-105",
    name: "Tom & Jerry No. 105",
    description:
      "24 × 37 mm · 30 label/lembar (5 × 6) · kertas 205 × 165 mm · margin atas 5 / samping 3 mm",
    spec: sheetFromPitch(205, 165, 5, 6, 37, 24, 3, 5, 39.5, 25.5),
  },
  {
    key: "roll-40x30",
    name: "Roll thermal 40 × 30 mm",
    description: "1 label per halaman — untuk printer label barcode",
    spec: {
      pageWidth: 40,
      pageHeight: 30,
      cols: 1,
      rows: 1,
      labelWidth: 40,
      labelHeight: 30,
      marginLeft: 0,
      marginTop: 0,
      gapX: 0,
      gapY: 0,
    },
  },
];

export const CUSTOM_PRESET_KEY = "custom";

export const DEFAULT_PRESET_KEY = "tj-103";

export function getPreset(key: string): LabelPreset | undefined {
  return LABEL_PRESETS.find((preset) => preset.key === key);
}

// ───────────────────────── Validasi & paginasi ─────────────────────────

/** Orientasi ALAMI lembar (sesuai ukuran kertas pada spesifikasi). */
export function isLandscape(spec: LabelSheetSpec): boolean {
  return spec.pageWidth >= spec.pageHeight;
}

/**
 * Ukuran halaman cetak (mm). `rotated` = lembar diputar 90° (orientasi
 * dibalik dari orientasi alaminya), jadi lebar & tinggi halaman bertukar.
 */
export function outputPageSize(
  spec: LabelSheetSpec,
  rotated: boolean,
): { width: number; height: number } {
  return rotated
    ? { width: spec.pageHeight, height: spec.pageWidth }
    : { width: spec.pageWidth, height: spec.pageHeight };
}

export function labelsPerSheet(spec: LabelSheetSpec): number {
  return Math.max(1, Math.floor(spec.cols)) * Math.max(1, Math.floor(spec.rows));
}

/** Pesan masalah pada spesifikasi, atau null kalau tata letak muat di kertas. */
export function validateSpec(spec: LabelSheetSpec): string | null {
  const positive: [number, string][] = [
    [spec.pageWidth, "Lebar kertas"],
    [spec.pageHeight, "Tinggi kertas"],
    [spec.labelWidth, "Lebar label"],
    [spec.labelHeight, "Tinggi label"],
  ];
  for (const [value, label] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      return `${label} harus lebih dari 0.`;
    }
  }
  if (spec.cols < 1 || spec.rows < 1) {
    return "Kolom dan baris minimal 1.";
  }
  const usedW =
    spec.marginLeft + spec.cols * spec.labelWidth + (spec.cols - 1) * spec.gapX;
  const usedH =
    spec.marginTop + spec.rows * spec.labelHeight + (spec.rows - 1) * spec.gapY;
  if (usedW > spec.pageWidth + 0.01) {
    return `Susunan label melebihi lebar kertas (${usedW.toFixed(1)} mm > ${spec.pageWidth} mm).`;
  }
  if (usedH > spec.pageHeight + 0.01) {
    return `Susunan label melebihi tinggi kertas (${usedH.toFixed(1)} mm > ${spec.pageHeight} mm).`;
  }
  return null;
}

/**
 * Ratakan daftar label jadi slot per lembar. `startPosition` (1-based) =
 * label pertama diletakkan di slot ke-N pada lembar pertama — untuk
 * memakai lembar stiker yang sebagian labelnya sudah terpakai. Slot `null`
 * = kosong (tidak dicetak).
 */
export function paginateLabels(
  items: LabelItem[],
  spec: LabelSheetSpec,
  startPosition: number,
): (LabelItem | null)[][] {
  const perSheet = labelsPerSheet(spec);
  const skip = Math.min(Math.max(1, Math.floor(startPosition) || 1), perSheet) - 1;
  const slots: (LabelItem | null)[] = [
    ...Array.from({ length: skip }, () => null),
    ...items,
  ];
  if (slots.length === 0) return [];

  const sheets: (LabelItem | null)[][] = [];
  for (let i = 0; i < slots.length; i += perSheet) {
    const sheet = slots.slice(i, i + perSheet);
    while (sheet.length < perSheet) sheet.push(null);
    sheets.push(sheet);
  }
  return sheets;
}

// ───────────────────────── Barcode & QR (SVG) ─────────────────────────

const QUIET_MODULES = 10; // zona sunyi kiri/kanan barcode (standar Code128)

/** Jumlah modul Code128B untuk teks ini (sudah termasuk zona sunyi). Null kalau tidak bisa di-encode. */
export function countBarcodeModules(text: string): number | null {
  try {
    const modules = encodeCode128B(text);
    return modules.reduce((sum, m) => sum + m.width, 0) + QUIET_MODULES * 2;
  } catch {
    return null;
  }
}

/** Lebar 1 modul barcode (mm) kalau barcode memenuhi lebar area `areaWidthMm`. */
export function estimateModuleMm(text: string, areaWidthMm: number): number | null {
  const total = countBarcodeModules(text);
  return total ? areaWidthMm / total : null;
}

/** Di bawah ini barcode rawan gagal di-scan (printer 203 dpi ≈ 0,125 mm per dot). */
export const MIN_SAFE_MODULE_MM = 0.19;

function barcodeSvg(text: string): string | null {
  let modules;
  try {
    modules = encodeCode128B(text);
  } catch {
    return null;
  }
  const total = modules.reduce((sum, m) => sum + m.width, 0) + QUIET_MODULES * 2;
  let cursor = QUIET_MODULES;
  let rects = "";
  for (const m of modules) {
    if (m.isBar) {
      rects += `<rect x="${cursor}" y="0" width="${m.width}" height="1" />`;
    }
    cursor += m.width;
  }
  // Skala horizontal saja (preserveAspectRatio none) — semua batang melebar
  // sama rata, jadi rasio antar batang tetap benar dan bisa di-scan.
  return `<svg viewBox="0 0 ${total} 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" fill="#000">${rects}</svg>`;
}

const qrCache = new Map<string, string | null>();

function qrSvg(text: string): string | null {
  if (qrCache.has(text)) return qrCache.get(text) ?? null;
  let result: string | null = null;
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const quiet = 2;
    const total = size + quiet * 2;
    let path = "";
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.modules.get(row, col)) {
          path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
        }
      }
    }
    result = `<svg viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><path d="${path}" fill="#000"/></svg>`;
  } catch {
    result = null;
  }
  if (qrCache.size > 500) qrCache.clear();
  qrCache.set(text, result);
  return result;
}

// ───────────────────────── HTML lembar label ─────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPrice(value: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value)}`;
}

const mm = (n: number) => `${Math.round(n * 1000) / 1000}mm`;

function buildLabelHtml(
  item: LabelItem,
  spec: LabelSheetSpec,
  content: LabelContentOptions,
): string {
  const pad = Math.min(1.5, spec.labelHeight * 0.06, spec.labelWidth * 0.04);
  const innerH = spec.labelHeight - pad * 2;
  const innerW = spec.labelWidth - pad * 2;

  // Ukuran font ikut tinggi label supaya label kecil (18 mm) tidak meluap.
  const nameFont = Math.max(1.7, Math.min(3.2, spec.labelHeight * 0.1));
  const smallFont = Math.max(1.5, nameFont * 0.85);
  const priceFont = nameFont * 1.15;

  const nameHtml =
    content.showName
      ? `<div class="lbl-name" style="font-size:${mm(nameFont)}">${escapeHtml(item.name)}</div>`
      : "";
  const priceHtml =
    content.showPrice
      ? `<div class="lbl-price" style="font-size:${mm(priceFont)}">${formatPrice(item.price)}</div>`
      : "";
  const codeHtml =
    content.showCode
      ? `<div class="lbl-code" style="font-size:${mm(smallFont)}">${escapeHtml(item.code)}</div>`
      : "";

  if (content.codeType === "qr") {
    const svg = qrSvg(item.code);
    const qrSize = Math.min(innerH, innerW * 0.5);
    const qrHtml = svg
      ? `<div class="lbl-qr" style="width:${mm(qrSize)};height:${mm(qrSize)}">${svg}</div>`
      : `<div class="lbl-invalid" style="width:${mm(qrSize)}">QR gagal</div>`;
    return `<div class="lbl-inner lbl-row" style="padding:${mm(pad)};gap:${mm(pad)}">${qrHtml}<div class="lbl-side">${nameHtml}${priceHtml}${codeHtml}</div></div>`;
  }

  const svg = barcodeSvg(item.code);
  const barcodeHtml = svg
    ? `<div class="lbl-bars">${svg}</div>`
    : `<div class="lbl-invalid">Kode tidak didukung barcode — gunakan QR</div>`;

  // Baris bawah: kode (kiri) & harga (kanan) berbagi satu baris supaya hemat tinggi.
  const footer =
    codeHtml || priceHtml
      ? `<div class="lbl-footer">${codeHtml}${priceHtml}</div>`
      : "";

  return `<div class="lbl-inner lbl-col" style="padding:${mm(pad)};gap:${mm(pad * 0.6)}">${nameHtml}${barcodeHtml}${footer}</div>`;
}

export const LABEL_SHEET_CSS = `
.lbl-sheet{position:relative;background:#fff;color:#000;overflow:hidden;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
.lbl-cell{position:absolute;overflow:hidden;box-sizing:border-box}
.lbl-outline{outline:0.2mm dashed #94a3b8;outline-offset:-0.1mm}
.lbl-inner{width:100%;height:100%;box-sizing:border-box;display:flex;overflow:hidden}
.lbl-col{flex-direction:column}
.lbl-row{flex-direction:row;align-items:center}
.lbl-name{font-weight:700;line-height:1.15;text-align:center;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.lbl-row .lbl-name{text-align:left;-webkit-line-clamp:3}
.lbl-bars{flex:1 1 0;min-height:0;width:100%}
.lbl-bars svg{display:block;width:100%;height:100%}
.lbl-qr{flex:none}
.lbl-qr svg{display:block;width:100%;height:100%}
.lbl-side{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0.6mm;overflow:hidden}
.lbl-footer{display:flex;justify-content:space-between;align-items:baseline;gap:1mm}
.lbl-footer:has(.lbl-code:only-child),.lbl-footer:has(.lbl-price:only-child){justify-content:center}
.lbl-code{font-family:"Courier New",monospace;letter-spacing:0.05mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbl-price{font-weight:700;white-space:nowrap}
.lbl-invalid{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;font-size:2mm;color:#b91c1c;border:0.2mm solid #b91c1c}
`;

/**
 * Markup SATU lembar (tanpa <html>), siap ditempel ke preview ataupun
 * dokumen cetak. `showOutline` = garis tepi putus-putus tiap slot label.
 * `rotated` = putar seluruh lembar 90° searah jarum jam (untuk memilih
 * orientasi kertas yang berlawanan dengan orientasi alami lembar).
 */
export function buildSheetHtml(
  slots: (LabelItem | null)[],
  spec: LabelSheetSpec,
  content: LabelContentOptions,
  showOutline: boolean,
  rotated = false,
): string {
  const cells = slots
    .map((item, index) => {
      const col = index % spec.cols;
      const row = Math.floor(index / spec.cols);
      const left = spec.marginLeft + col * (spec.labelWidth + spec.gapX);
      const top = spec.marginTop + row * (spec.labelHeight + spec.gapY);
      const style = `left:${mm(left)};top:${mm(top)};width:${mm(spec.labelWidth)};height:${mm(spec.labelHeight)}`;
      const cls = showOutline ? "lbl-cell lbl-outline" : "lbl-cell";
      return `<div class="${cls}" style="${style}">${item ? buildLabelHtml(item, spec, content) : ""}</div>`;
    })
    .join("");

  if (rotated) {
    // Titik (x, y) → (tinggiKertas - y, x): lembar diputar 90° searah jarum
    // jam lalu digeser supaya pas menempati halaman yang sudah bertukar sisi.
    return `<div class="lbl-sheet" style="width:${mm(spec.pageHeight)};height:${mm(spec.pageWidth)}"><div style="position:absolute;left:0;top:0;width:${mm(spec.pageWidth)};height:${mm(spec.pageHeight)};transform:translateX(${mm(spec.pageHeight)}) rotate(90deg);transform-origin:0 0">${cells}</div></div>`;
  }

  return `<div class="lbl-sheet" style="width:${mm(spec.pageWidth)};height:${mm(spec.pageHeight)}">${cells}</div>`;
}

// ───────────────────────── Cetak ─────────────────────────

/** Cetak semua lembar lewat iframe tersembunyi (pola sama dengan struk). */
export function printLabelSheets(
  sheets: (LabelItem | null)[][],
  spec: LabelSheetSpec,
  content: LabelContentOptions,
  showOutline: boolean,
  rotated = false,
): void {
  if (sheets.length === 0) return;
  const page = outputPageSize(spec, rotated);

  const pagesHtml = sheets
    .map(
      (slots, i) =>
        `<div class="lbl-page${i < sheets.length - 1 ? " lbl-break" : ""}">${buildSheetHtml(slots, spec, content, showOutline, rotated)}</div>`,
    )
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Label Barcode</title><style>
@page{size:${mm(page.width)} ${mm(page.height)};margin:0}
html,body{margin:0;padding:0;background:#fff}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lbl-page{width:${mm(page.width)};height:${mm(page.height)};overflow:hidden}
.lbl-break{break-after:page;page-break-after:always}
${LABEL_SHEET_CSS}
</style></head><body>${pagesHtml}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "0";
  iframe.style.left = "-9999px";
  iframe.style.width = "800px";
  iframe.style.height = "600px";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.error("printLabelSheets: window.print() gagal:", err);
    }
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 1500);
  }, 300);
}