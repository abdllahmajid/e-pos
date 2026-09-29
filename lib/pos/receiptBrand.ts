// ── TAMBAHAN (logo + tulisan merek di struk thermal) ──────────────────────
// Membuat "kepala struk" bergambar: ikon toko (public/StrukIcon.png) di atas,
// lalu tulisan merek di bawahnya. Bagian awal (mis. "Langitan.co") tebal,
// bagian setelah spasi (mis. " Store") normal dan miring, keduanya font Inter.
// Hasilnya dipakai DUA jalur cetak, supaya tampilannya sama persis:
//   1. Jalur browser (window.print, printThermalReceipt): `dataUrl` (PNG
//      resolusi tinggi, halus/anti-aliasing) dipasang sebagai <img> di HTML struk.
//   2. Jalur Bluetooth/USB (ESC/POS mentah, buildReceiptBytes): `raster`
//      (perintah GS v 0, bitmap 1-bit) ditulis langsung ke printer.
// Kenapa digambar ke canvas, bukan teks biasa: printer ESC/POS tidak punya
// font Inter dan tidak bisa mencampur huruf tebal + miring dalam satu baris,
// jadi satu-satunya cara agar tulisan merek persis rancangan adalah
// mengirimnya sebagai gambar.
//
// Tata letak tulisan:
// - Kalau "Langitan.co Store" muat dalam satu baris, dicetak satu baris.
// - Kalau tidak muat, " Store" pindah ke baris kedua (ukuran huruf TIDAK
//   dikecilkan). Huruf baru dikecilkan kalau satu baris saja sudah terlalu lebar.
// - Kalau nama toko tidak mengandung spasi (mis. "Langitan.co"), kata
//   DEFAULT_SUFFIX_WORD ("Store") ditambahkan otomatis di belakangnya.
//
// Prasyarat:
// - `public/StrukIcon.png` harus HITAM (atau warna gelap) di latar transparan/
//   putih. Printer thermal hanya bisa mencetak hitam — ikon putih akan hilang.
// - Font Inter dimuat di app/layout.tsx (next/font, variabel CSS `--font-inter`).
//   Kalau font italic Inter tidak dimuat, browser membuat miringnya sendiri
//   (oblique buatan); hasilnya tetap miring.
// - Lebar 384 titik = kertas thermal 58mm (203 dpi).
//
// Kalau ikon belum ada / gagal dimuat, loadReceiptBrand() mengembalikan null
// dan struk kembali ke tampilan lama (nama toko sebagai teks) — cetak tidak
// pernah gagal gara-gara logo.

export interface ReceiptBrand {
  /** PNG hitam-putih (data URL) untuk jalur HTML/window.print. */
  dataUrl: string;
  width: number;
  height: number;
  /** Byte ESC/POS (GS v 0, dipecah per pita 24 baris) untuk jalur Bluetooth/USB. */
  raster: Uint8Array;
}

type FontStyle = "normal" | "italic";

const PAPER_DOTS = 384; // kelipatan 8 (1 byte = 8 titik)
const PREVIEW_SCALE = 3; // preview HTML digambar 3x (1152 px) supaya halus
const BAND_HEIGHT = 24; // pita kecil = aman untuk buffer printer murah/BLE
const LOGO_SRC = "/StrukIcon.png";
const LOGO_MAX_WIDTH = 200;
const LOGO_MAX_HEIGHT = 75;
const MAIN_SIZE = 35; // "Langitan.co"
const SUFFIX_SIZE = 35; // " Store"
const MAIN_WEIGHT = 800; // bagian awal: tebal
const SUFFIX_WEIGHT = 500; // bagian setelah spasi: normal
const MAIN_STYLE: FontStyle = "normal";
const SUFFIX_STYLE: FontStyle = "italic"; // bagian setelah spasi: miring
const SIDE_MARGIN = 12;
const LINE_GAP = 4; // jarak antar baris kalau tulisan dipecah dua baris
const THRESHOLD = 170; // < ini = hitam. Agak tinggi supaya huruf tebal tidak menipis.
const FALLBACK_NAME = "Langitan.co Store";
const DEFAULT_SUFFIX_WORD = "Store"; // ditambahkan kalau nama toko tanpa spasi

const cache = new Map<string, ReceiptBrand>();

interface Part {
  text: string;
  weight: number;
  style: FontStyle;
  baseSize: number;
}

/** "Langitan.co Store" -> { main: "Langitan.co", suffix: " Store" }. Tanpa spasi -> semua main. */
function splitWordmark(storeName: string): { main: string; suffix: string } {
  const name = storeName.trim() || FALLBACK_NAME;
  const match = name.match(/^(\S+)(\s.+)$/);
  return match
    ? { main: match[1], suffix: match[2] }
    : { main: name, suffix: "" };
}

function interFamily(): string {
  const fromVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-inter")
    .trim();
  return fromVar || 'Inter, "Helvetica Neue", Arial, sans-serif';
}

function loadImage(src: string, timeoutMs = 4000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Siapkan kepala struk (ikon + tulisan merek). TIDAK PERNAH melempar error:
 * gagal apa pun -> null (pemanggil memakai tampilan struk lama).
 */
export async function loadReceiptBrand(
  storeName?: string,
): Promise<ReceiptBrand | null> {
  if (typeof document === "undefined") return null;

  // Nama tanpa spasi (mis. "Langitan.co") -> tambahkan " Store" di belakangnya.
  const rawName = (storeName ?? "").trim();
  const { main, suffix } = splitWordmark(
    rawName && !/\s/.test(rawName) ? `${rawName} ${DEFAULT_SUFFIX_WORD}` : rawName,
  );

  const cacheKey = `${main}|${suffix}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Ikon opsional: kalau gagal dimuat, tulisan merek tetap dicetak (tanpa ikon).
    const loaded = await loadImage(LOGO_SRC);
    const logo =
      loaded && loaded.naturalWidth && loaded.naturalHeight ? loaded : null;
    if (!logo) console.warn(`[receiptBrand] ${LOGO_SRC} tidak termuat, struk dicetak tanpa ikon`);

    // Pastikan Inter benar-benar termuat sebelum menggambar (canvas tidak
    // menunggu font sendiri — tanpa ini hasil pertama bisa jatuh ke font cadangan).
    const family = interFamily();
    try {
      await Promise.all([
        document.fonts.load(`${MAIN_STYLE} ${MAIN_WEIGHT} ${MAIN_SIZE}px ${family}`),
        document.fonts.load(`${SUFFIX_STYLE} ${SUFFIX_WEIGHT} ${SUFFIX_SIZE}px ${family}`),
      ]);
    } catch {
      // Font gagal dimuat -> tetap gambar dengan font cadangan, jangan batalkan cetak.
    }

    // ── Ukur tulisan merek ──
    const measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return null;
    const measureLine = (parts: Part[], scale: number) =>
      parts.reduce((sum, p) => {
        measureCtx.font = `${p.style} ${p.weight} ${p.baseSize * scale}px ${family}`;
        return sum + measureCtx.measureText(p.text).width;
      }, 0);

    const mainPart: Part = {
      text: main,
      weight: MAIN_WEIGHT,
      style: MAIN_STYLE,
      baseSize: MAIN_SIZE,
    };
    const suffixPart = (text: string): Part => ({
      text,
      weight: SUFFIX_WEIGHT,
      style: SUFFIX_STYLE,
      baseSize: SUFFIX_SIZE,
    });
    const maxTextWidth = PAPER_DOTS - SIDE_MARGIN * 2;

    // Coba satu baris dulu. Kalau tidak muat, pecah: suffix pindah ke baris 2.
    let lines: Part[][] = [[mainPart]];
    if (suffix) {
      const oneLine: Part[] = [mainPart, suffixPart(suffix)];
      if (measureLine(oneLine, 1) <= maxTextWidth) {
        lines = [oneLine];
      } else {
        lines = [[mainPart], [suffixPart(suffix.trim())]];
      }
    }

    // Kecilkan hanya kalau ada baris yang masih terlalu lebar.
    let scale = 1;
    for (const line of lines) {
      const w = measureLine(line, 1);
      if (w > maxTextWidth) scale = Math.min(scale, maxTextWidth / w);
    }
    const sized = (p: Part) => Math.round(p.baseSize * scale);
    const baseTextSize = Math.round(Math.max(MAIN_SIZE, SUFFIX_SIZE) * scale);

    // ── Tata letak ──
    const logoScale = logo
      ? Math.min(
          LOGO_MAX_WIDTH / logo.naturalWidth,
          LOGO_MAX_HEIGHT / logo.naturalHeight,
        )
      : 0;
    const logoW = logo ? Math.round(logo.naturalWidth * logoScale) : 0;
    const logoH = logo ? Math.round(logo.naturalHeight * logoScale) : 0;
    const padTop = 6;
    const gap = logo ? 10 : 0;
    const ascent = Math.round(baseTextSize * 0.78);
    const descent = Math.round(baseTextSize * 0.26); // ruang untuk huruf "g", "y", dst.
    const lineHeight = ascent + descent;
    const padBottom = 6;
    const textBlockHeight =
      lines.length * lineHeight + (lines.length - 1) * LINE_GAP;
    const contentHeight = padTop + logoH + gap + textBlockHeight + padBottom;
    // Tinggi dibulatkan ke kelipatan pita supaya tiap pita penuh (sisa = putih).
    const height = Math.ceil(contentHeight / BAND_HEIGHT) * BAND_HEIGHT;

    // Satu fungsi gambar untuk dua kanvas (koordinat logis 384 x height):
    // kanvas kecil -> bitmap 1-bit printer, kanvas besar -> preview halus.
    const drawBrand = (c: CanvasRenderingContext2D) => {
      c.fillStyle = "#fff"; // latar putih: meratakan transparansi PNG
      c.fillRect(0, 0, PAPER_DOTS, height);
      if (logo) {
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = "high";
        c.drawImage(logo, Math.round((PAPER_DOTS - logoW) / 2), padTop, logoW, logoH);
      }
      c.fillStyle = "#000";
      c.textBaseline = "alphabetic";
      c.textAlign = "left";

      lines.forEach((line, index) => {
        const widths = line.map((p) => {
          c.font = `${p.style} ${p.weight} ${sized(p)}px ${family}`;
          return c.measureText(p.text).width;
        });
        const totalWidth = widths.reduce((a, b) => a + b, 0);
        let x = Math.round((PAPER_DOTS - totalWidth) / 2);
        const baselineY =
          padTop + logoH + gap + ascent + index * (lineHeight + LINE_GAP);
        line.forEach((p, i) => {
          c.font = `${p.style} ${p.weight} ${sized(p)}px ${family}`;
          c.fillText(p.text, x, baselineY);
          x += widths[i];
        });
      });
    };

    // ── Preview / jalur HTML: resolusi tinggi + anti-aliasing (halus, solid) ──
    const hiCanvas = document.createElement("canvas");
    hiCanvas.width = PAPER_DOTS * PREVIEW_SCALE;
    hiCanvas.height = height * PREVIEW_SCALE;
    const hiCtx = hiCanvas.getContext("2d");
    if (!hiCtx) return null;
    hiCtx.scale(PREVIEW_SCALE, PREVIEW_SCALE);
    drawBrand(hiCtx);
    const dataUrl = hiCanvas.toDataURL("image/png");

    // ── Jalur printer: 384 titik, dipaksa hitam-putih 1-bit ──
    const canvas = document.createElement("canvas");
    canvas.width = PAPER_DOTS;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    drawBrand(ctx);
    const bytesPerRow = PAPER_DOTS / 8;
    const image = ctx.getImageData(0, 0, PAPER_DOTS, height);
    const px = image.data;
    const packed = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < PAPER_DOTS; x++) {
        const i = (y * PAPER_DOTS + x) * 4;
        const luminance = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (luminance < THRESHOLD) packed[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }

    // GS v 0 m xL xH yL yH d... — satu perintah per pita 24 baris.
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

    const brand: ReceiptBrand = {
      dataUrl,
      width: PAPER_DOTS,
      height,
      raster: new Uint8Array(commands),
    };
    cache.set(cacheKey, brand);
    return brand;
  } catch (err) {
    console.warn("[receiptBrand] gagal menyiapkan logo struk:", err);
    return null;
  }
}