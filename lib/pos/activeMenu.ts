// lib/pos/activeMenu.ts
// ── TAMBAHAN (refresh tetap di halaman terakhir) ── app/page.tsx menyimpan
// menu aktif hanya di useState, jadi setiap refresh balik ke nilai awal
// ("dashboard"). Helper ini menyimpan menu terakhir di sessionStorage:
//   - sessionStorage (bukan localStorage): per TAB, bertahan saat refresh,
//     tapi hilang kalau tab/browser ditutup — tab baru tetap mulai dari
//     Dashboard, dan tidak "menyangkut" di menu Kasir keesokan harinya.
//   - Dihapus saat logout & saat login sukses, supaya "login selalu mendarat
//     di Dashboard" (lihat catatan di app/page.tsx) dan menu user sebelumnya
//     tidak terbawa ke user berikutnya di tablet kasir yang dipakai bergantian.
// Semua fungsi aman dipanggil di server/mode privat: gagal -> diam saja.

const STORAGE_KEY = "lco-pos-active-menu";

// Harus sama dengan blok render di app/page.tsx. Kalau menu baru ditambahkan
// di sana, tambahkan juga di sini — kunci tak dikenal diabaikan (jatuh ke Dashboard).
export const VALID_MENU_KEYS = [
  "dashboard",
  "kasir",
  "produk",
  "riwayat",
  "pelanggan",
  "stok",
  "hadiah",
  "label-barcode",
  "kas",
  "promo",
  "laporan",
  "sampah",
  "log-aktivitas",
  "pengaturan",
] as const;

export function readStoredMenu(): string | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value && (VALID_MENU_KEYS as readonly string[]).includes(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveActiveMenu(key: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Mode privat / penyimpanan penuh — refresh akan kembali ke Dashboard, tidak fatal.
  }
}

export function clearStoredMenu(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // abaikan
  }
}