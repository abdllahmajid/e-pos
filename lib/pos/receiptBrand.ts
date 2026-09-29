// ── TAMBAHAN (logo + tulisan merek di struk thermal) ──────────────────────
// Membuat "kepala struk" bergambar: ikon toko (public/StrukIcon.png) di atas,
// lalu tulisan merek di bawahnya — bagian tebal (mis. "Langitan") dan bagian
// akhiran kecil (mis. ".co") memakai font Inter. Hasilnya dipakai DUA jalur
// cetak, supaya tampilannya sama persis:
//   1. Jalur browser (window.print, printThermalReceipt): `dataUrl` (PNG
//      resolusi tinggi, halus/anti-aliasing) dipasang sebagai <img> di HTML struk.
//   2. Jalur Bluetooth/USB (ESC/POS mentah, buildReceiptBytes): `raster`
//      (perintah GS v 0, bitmap 1-bit) ditulis langsung ke printer.
// Kenapa digambar ke canvas, bukan teks biasa: printer ESC/POS tidak punya
// font Inter dan tidak bisa mencampur huruf tebal + kecil dalam satu baris,
// jadi satu-satunya cara agar tulisan merek persis rancangan adalah
// mengirimnya sebagai gambar. Jalur browser ikut memakai gambar yang sama
// supaya font Inter tidak bergantung pada iframe cetak (yang tidak
// mewarisi font halaman).
//
// Prasyarat:
// - `public/StrukIcon.png` harus HITAM (atau warna gelap) di latar transparan/
//   putih. Printer thermal hanya bisa mencetak hitam — ikon putih akan hilang.
// - Font Inter dimuat di app/layout.tsx (next/font, variabel CSS `--font-inter`).
// - Lebar 384 titik = kertas thermal 58mm (203 dpi). Di printer 80mm gambar
//   tetap tercetak di tengah (ESC a 1), hanya lebih sempit dari kertas.
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

const PAPER_DOTS = 384; // kelipatan 8 (1 byte = 8 titik)
const PREVIEW_SCALE = 3; // preview HTML digambar 3x (1152 px) supaya halus
const BAND_HEIGHT = 24; // pita kecil = aman untuk buffer printer murah/BLE
const LOGO_SRC = "/StrukIcon.png";
const LOGO_MAX_WIDTH = 200;
const LOGO_MAX_HEIGHT = 75;
const MAIN_SIZE = 35; // "Langitan" — tebal
const SUFFIX_SIZE = 35; // ".co" — kecil
const SIDE_MARGIN = 12;
const THRESHOLD = 170; // < ini = hitam. Agak tinggi supaya huruf tebal tidak menipis.
const FALLBACK_NAME = "Langitan.co";

const cache = new Map<string, ReceiptBrand>();

/** "Langitan.co" -> { main: "Langitan", suffix: ".co" }. Tanpa akhiran titik -> semua tebal. */
function splitWordmark(storeName: string): { main: string; suffix: string } {
  const name = storeName.trim() || FALLBACK_NAME;
  const match = name.match(/^(.+?)(\.[A-Za-z]{2,4})$/);
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

  const { main, suffix } = splitWordmark(storeName ?? "");
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
        document.fonts.load(`800 ${MAIN_SIZE}px ${family}`),
        document.fonts.load(`500 ${SUFFIX_SIZE}px ${family}`),
      ]);
    } catch {
      // Font gagal dimuat -> tetap gambar dengan font cadangan, jangan batalkan cetak.
    }

    // ── Ukur tulisan merek (kecilkan proporsional kalau terlalu lebar) ──
    const measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return null;
    const measure = (scale: number) => {
      measureCtx.font = `800 ${MAIN_SIZE * scale}px ${family}`;
      const mainWidth = measureCtx.measureText(main).width;
      measureCtx.font = `500 ${SUFFIX_SIZE * scale}px ${family}`;
      const suffixWidth = suffix ? measureCtx.measureText(suffix).width : 0;
      return mainWidth + suffixWidth;
    };
    let scale = 1;
    const maxTextWidth = PAPER_DOTS - SIDE_MARGIN * 2;
    const fullWidth = measure(1);
    if (fullWidth > maxTextWidth) scale = maxTextWidth / fullWidth;
    const mainSize = Math.round(MAIN_SIZE * scale);
    const suffixSize = Math.round(SUFFIX_SIZE * scale);

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
    const ascent = Math.round(mainSize * 0.78);
    const descent = Math.round(mainSize * 0.26); // ruang untuk huruf "g", "y", dst.
    const padBottom = 6;
    const contentHeight = padTop + logoH + gap + ascent + descent + padBottom;
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
      c.font = `800 ${mainSize}px ${family}`;
      const mainWidth = c.measureText(main).width;
      c.font = `500 ${suffixSize}px ${family}`;
      const suffixWidth = suffix ? c.measureText(suffix).width : 0;
      const startX = Math.round((PAPER_DOTS - (mainWidth + suffixWidth)) / 2);
      const baselineY = padTop + logoH + gap + ascent;
      c.font = `800 ${mainSize}px ${family}`;
      c.fillText(main, startX, baselineY);
      if (suffix) {
        c.font = `500 ${suffixSize}px ${family}`;
        c.fillText(suffix, startX + mainWidth, baselineY);
      }
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