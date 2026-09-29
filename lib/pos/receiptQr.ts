// lib/pos/receiptQr.ts
// ── TAMBAHAN (QR promosi di struk thermal) ────────────────────────────────
// Menyiapkan QR dari link promosi (mis. Linktree / link-in-bio) yang diisi
// admin di Pengaturan > Toko & Struk. Pola sama dengan receiptBrand.ts:
// hasilnya dipakai DUA jalur cetak supaya tampilannya sama:
//   1. Jalur browser (printThermalReceipt): `dataUrl` (PNG resolusi tinggi,
//      kotak-kotak tegas) dipasang sebagai <img>.
//   2. Jalur Bluetooth/USB (buildReceiptBytes): `raster` (GS v 0, bitmap
//      1-bit) ditulis langsung ke printer.
// Kenapa raster, bukan perintah QR bawaan printer (GS ( k): dukungannya tidak
// seragam di printer 58mm murah, sedangkan GS v 0 sudah dipakai untuk logo.
//
// Kunci ketajaman: ukuran satu kotak (modul) QR selalu BILANGAN BULAT titik.
// Ukuran pecahan membuat tepi kotak jadi abu-abu lalu bergerigi saat di-1-bit
// -kan; ukuran bulat menjaga tiap kotak tegas hitam / putih.
//
// Aturan aman: fungsi di sini TIDAK PERNAH melempar error. Link kosong/tidak
// valid/terlalu panjang -> null, dan pemanggil mencetak struk tanpa QR.

import QRCode from "qrcode";

export interface ReceiptQr {
  /** PNG (data URL) untuk jalur HTML/window.print. */
  dataUrl: string;
  width: number;
  height: number;
  /** Byte ESC/POS (GS v 0, per pita 24 baris) untuk jalur Bluetooth/USB. */
  raster: Uint8Array;
}

export const DEFAULT_PROMO_TEXT = "Scan untuk ikuti kami";

const PAPER_DOTS = 384; // 58mm @ 203dpi, kelipatan 8. Di 80mm tetap di tengah.
const BAND_HEIGHT = 24;
const QUIET_MODULES = 3; // area putih di sekeliling QR (dalam satuan modul)
const TARGET_DOTS = 232; // lebar QR yang dituju (~29mm), cukup besar untuk discan
const MIN_MODULE_DOTS = 3; // di bawah ini QR sulit discan di thermal
const PREVIEW_SCALE = 3;

/**
 * Rapikan link dari input admin. Mengembalikan string link siap-pakai, atau
 * null kalau kosong / bukan link web yang valid.
 * - Tanpa skema ("linktr.ee/langitan") -> otomatis diberi "https://".
 * - Hanya http/https; host harus mengandung titik (tolak "abc", "http://x").
 */
export function normalizePromoUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

/** Teks ajakan di atas QR; kosong -> default. */
export function resolvePromoText(raw: string | null | undefined): string {
  return (raw ?? "").trim() || DEFAULT_PROMO_TEXT;
}

/**
 * Siapkan QR dari link. null kalau link tidak valid atau terlalu panjang
 * (QR terlalu padat untuk kertas 58mm). Hanya boleh dipanggil di browser
 * (butuh canvas untuk preview).
 */
export async function loadReceiptQr(
  rawUrl: string | null | undefined,
): Promise<ReceiptQr | null> {
  if (typeof document === "undefined") return null;

  const url = normalizePromoUrl(rawUrl);
  if (!url) return null;

  try {
    // Koreksi error "M": cukup kuat untuk kertas thermal, tapi tidak membuat
    // QR jauh lebih padat daripada "L".
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const cells = qr.modules.data; // Uint8Array, 1 = kotak hitam

    const totalModules = count + QUIET_MODULES * 2;
    const moduleDots = Math.floor(TARGET_DOTS / totalModules);
    // Terlalu padat: modul < 3 titik, atau QR tidak muat di lebar kertas.
    if (moduleDots < MIN_MODULE_DOTS || totalModules * moduleDots > PAPER_DOTS) {
      console.warn("[receiptQr] link terlalu panjang, QR tidak dicetak");
      return null;
    }

    const qrDots = totalModules * moduleDots;
    const padTop = 6;
    const contentHeight = padTop + qrDots + 6;
    const height = Math.ceil(contentHeight / BAND_HEIGHT) * BAND_HEIGHT;
    const left = Math.floor((PAPER_DOTS - qrDots) / 2);

    // ── Jalur printer: langsung dari matriks modul, tanpa canvas ──
    const bytesPerRow = PAPER_DOTS / 8;
    const packed = new Uint8Array(bytesPerRow * height);
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!cells[row * count + col]) continue;
        const x0 = left + (QUIET_MODULES + col) * moduleDots;
        const y0 = padTop + (QUIET_MODULES + row) * moduleDots;
        for (let dy = 0; dy < moduleDots; dy++) {
          for (let dx = 0; dx < moduleDots; dx++) {
            const x = x0 + dx;
            packed[(y0 + dy) * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
          }
        }
      }
    }

    const commands: number[] = [];
    for (let y = 0; y < height; y += BAND_HEIGHT) {
      commands.push(
        0x1d, 0x76, 0x30, 0x00,
        bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
        BAND_HEIGHT & 0xff, (BAND_HEIGHT >> 8) & 0xff,
      );
      const start = y * bytesPerRow;
      const end = start + BAND_HEIGHT * bytesPerRow;
      for (let i = start; i < end; i++) commands.push(packed[i]);
    }

    // ── Jalur browser: PNG 3x, tiap kotak digambar persegi utuh (tanpa blur) ──
    const canvas = document.createElement("canvas");
    canvas.width = PAPER_DOTS * PREVIEW_SCALE;
    canvas.height = height * PREVIEW_SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(PREVIEW_SCALE, PREVIEW_SCALE);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PAPER_DOTS, height);
    ctx.fillStyle = "#000";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!cells[row * count + col]) continue;
        ctx.fillRect(
          left + (QUIET_MODULES + col) * moduleDots,
          padTop + (QUIET_MODULES + row) * moduleDots,
          moduleDots,
          moduleDots,
        );
      }
    }

    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: PAPER_DOTS,
      height,
      raster: new Uint8Array(commands),
    };
  } catch (err) {
    console.warn("[receiptQr] gagal membuat QR struk:", err);
    return null;
  }
}

/**
 * Field promo untuk ReceiptData, dari pengaturan toko. Mengembalikan objek
 * kosong kalau promosi mati atau link tidak valid, jadi aman di-spread:
 *   const receiptData: ReceiptData = { ..., ...getReceiptPromo(posSettings) };
 */
export function getReceiptPromo(settings: {
  promoEnabled: boolean;
  promoUrl: string;
  promoText: string;
}): { promoUrl?: string; promoText?: string } {
  if (!settings.promoEnabled) return {};
  const url = normalizePromoUrl(settings.promoUrl);
  if (!url) return {};
  return { promoUrl: url, promoText: resolvePromoText(settings.promoText) };
}
