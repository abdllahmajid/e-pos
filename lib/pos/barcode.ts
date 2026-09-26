// lib/pos/barcode.ts
// ── TAMBAHAN ── Barcode Code128 (subset B) murni JS, tanpa library
// eksternal, untuk mencetak nomor struk di bagian bawah struk thermal —
// supaya nomor struk (LCO-STR/{yy}/{mm}/{urutan}) bisa langsung di-scan
// saat konfirmasi retur atau pengecekan lain, tidak perlu diketik manual.
//
// ── Kenapa ditulis manual, bukan pasang paket (mis. jsbarcode) ── Nomor
// struk cuma butuh SATU simbologi umum: Code128 subset B menerima huruf
// besar/kecil, digit, "-", dan "/" tanpa masalah (nomor struk tidak pernah
// keluar dari ASCII 32-126) — tidak pernah perlu subset A/C atau ganti
// subset di tengah pesan, jadi tidak ada alasan menambah dependency baru
// hanya untuk kasus sesempit ini.
//
// ── Kenapa tabel pola di bawah AMAN & MEMANG HARUS identik dengan library
// lain ── Tabel ini adalah spesifikasi teknis standar Code128 (ISO/IEC
// 15417) — bukan kode kreatif siapa pun, sama seperti tabel ASCII. SEMUA
// implementasi Code128 di dunia (jsbarcode, bwip-js, zint, python-barcode,
// dst) memuat tabel angka yang SAMA PERSIS; kalau berbeda sedikit saja,
// scanner tidak akan bisa membaca barcode-nya.
//
// Dipakai dari HTML struk yang dicetak lewat window.print() (lihat
// lib/pos/printLogic.ts), BUKAN dikirim sebagai byte ESC/POS mentah —
// jadi barcode dirender sebagai markup <svg> yang ditempel langsung ke
// HTML struk, sama seperti QR code Layar Promosi (app/components/promo/
// PromoModule.tsx) yang juga di-generate di sisi klien.

// Pola modul Code128 (lebar batang/spasi dalam satuan modul, 1-4) untuk
// NILAI SIMBOL 0-102, lalu START A(103)/START B(104)/START C(105)/
// STOP(106). Tiap pola SELALU diawali batang & diakhiri spasi (6 digit) —
// KECUALI pola STOP yang punya 1 batang tambahan di akhir (7 digit)
// sebagai penutup + zona sunyi.
const CODE128_PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
];

const START_B = 104;
const STOP = 106;
// Code128 subset B mewakili ASCII 32 (spasi) s.d. 126 ("~") — nilai simbol
// = kode karakter - 32. Karakter di luar rentang ini tidak didukung.
const MIN_CHAR_CODE = 32;
const MAX_CHAR_CODE = 126;

export interface BarcodeModule {
  /** true = batang hitam, false = spasi putih (tidak digambar). */
  isBar: boolean;
  /** Lebar modul dalam satuan barcode (1-4), BUKAN px. */
  width: number;
}

/**
 * Enkode `text` jadi urutan modul Code128 subset B (bar/space + lebar).
 * Melempar error kalau ada karakter di luar ASCII 32-126 — dicek DULU,
 * supaya tidak diam-diam menghasilkan barcode yang gagal di-scan.
 */
export function encodeCode128B(text: string): BarcodeModule[] {
  if (text.length === 0) {
    throw new Error("Teks barcode tidak boleh kosong.");
  }

  const values: number[] = [START_B];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < MIN_CHAR_CODE || code > MAX_CHAR_CODE) {
      throw new Error(
        `Karakter "${char}" tidak didukung barcode Code128 subset B.`,
      );
    }
    values.push(code - MIN_CHAR_CODE);
  }

  // Checksum Code128: nilai START + Σ(nilai_i × posisi_i) — posisi mulai
  // dari 1 untuk karakter pertama SETELAH start — lalu mod 103.
  let checksum = values[0];
  for (let i = 1; i < values.length; i++) {
    checksum += values[i] * i;
  }
  values.push(checksum % 103);
  values.push(STOP);

  const modules: BarcodeModule[] = [];
  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    for (let i = 0; i < pattern.length; i++) {
      modules.push({
        isBar: i % 2 === 0, // tiap pola SELALU diawali batang (bar)
        width: Number(pattern[i]),
      });
    }
  }
  return modules;
}

/**
 * Render modul barcode jadi markup `<svg>` siap tempel ke HTML struk.
 * `moduleUnit` = lebar 1 modul dalam satuan viewBox — svg pakai
 * `preserveAspectRatio="none"` + width 100% supaya otomatis menyesuaikan
 * lebar kertas thermal (58mm/80mm) lewat CSS, bukan ukuran tetap px.
 */
export function renderBarcodeSvg(
  modules: BarcodeModule[],
  heightPx = 40,
  moduleUnit = 2,
): string {
  const totalWidth = modules.reduce((sum, m) => sum + m.width, 0) * moduleUnit;

  let cursor = 0;
  let rects = "";
  for (const module of modules) {
    const widthUnit = module.width * moduleUnit;
    if (module.isBar) {
      rects += `<rect x="${cursor}" y="0" width="${widthUnit}" height="${heightPx}" fill="#000000" />`;
    }
    cursor += widthUnit;
  }

  return `<svg viewBox="0 0 ${totalWidth} ${heightPx}" width="100%" height="${heightPx}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

/**
 * Helper sekali-panggil: teks -> markup `<svg>` barcode langsung.
 * Kalau enkode gagal (karakter di luar Code128B — seharusnya tidak pernah
 * terjadi untuk nomor struk `LCO-STR/...`, tapi dijaga untuk berjaga-jaga),
 * balik string kosong SUPAYA STRUK TETAP TERCETAK tanpa barcode — lebih
 * baik daripada gagal cetak total gara-gara barcode.
 */
export function buildBarcodeSvgSafe(
  text: string,
  heightPx = 40,
  moduleUnit = 2,
): string {
  try {
    return renderBarcodeSvg(encodeCode128B(text), heightPx, moduleUnit);
  } catch (err) {
    console.warn("[barcode] gagal encode, struk dicetak tanpa barcode:", err);
    return "";
  }
}