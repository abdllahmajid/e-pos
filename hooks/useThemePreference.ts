// hooks/useThemePreference.ts
// ── TAMBAHAN (dark mode toggle, sidebar) ── Preferensi terang/gelap
// PER-DEVICE, disimpan di localStorage — SENGAJA TIDAK lewat
// hooks/useSettings.ts (tabel `settings` di Supabase).
//
// Alasan:
// 1. Tulis ke tabel `settings` dibatasi RLS admin-only (lihat
//    migration 005_settings.sql — "settings_update_admin_only"). Kalau tema
//    disimpan di sana, kasir non-admin akan gagal (error RLS) tiap kali
//    menekan tombol di Sidebar — padahal user MINTA tombolnya ada di
//    Sidebar, bukan di halaman Pengaturan yang admin/supervisor-only.
// 2. Preferensi ini murni tampilan LAYAR device yang sedang dipakai (mis.
//    kasir shift malam vs siang di device yang sama) — bukan pengaturan
//    TOKO yang harus sama di semua device seperti nama toko/PPN. Kalau
//    disimpan di `settings`, semua device toko ikut berubah begitu SATU
//    kasir menekan tombol ini — bukan itu yang diinginkan.
// Pola ini sama persis alasannya dengan token notifikasi FCM
// (hooks/useFcmToken.ts, dipanggil dari footer Sidebar juga) — lihat
// komentar header Sidebar.tsx bagian NotificationStatus.

"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark";

const STORAGE_KEY = "lco-pos-theme";

function applyThemeClass(theme: ThemePreference) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface UseThemePreferenceResult {
  /** Tema yang aktif SAAT INI di device ini. Default "light" (lihat catatan
   * di app/layout.tsx soal kenapa default-nya bukan ikut OS). */
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
}

export function useThemePreference(): UseThemePreferenceResult {
  // Default state render pertama SELALU "light" (sama dengan asumsi
  // app/layout.tsx sebelum script inline sempat jalan), supaya tidak ada
  // mismatch antara HTML hasil server render vs client saat hydrate.
  // Nilai sebenarnya (kalau tersimpan "dark") langsung disinkronkan dari
  // localStorage di useEffect di bawah, SEBELUM device sempat menampilkan
  // apa pun ke kasir (elemen <html> sendiri sudah lebih dulu dapat class
  // "dark" dari script inline di layout.tsx, jadi TIDAK ada "kedipan" warna
  // walau state React ini baru menyusul sepersekian saat kemudian).
  const [theme, setThemeState] = useState<ThemePreference>("light");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage tidak tersedia (mode privat/disabled) — anggap "light".
    }
    if (stored === "dark") {
      setThemeState("dark");
    }
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    applyThemeClass(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Gagal simpan (mis. kuota/mode privat) — tema tetap berubah untuk
      // sesi ini, cuma tidak akan diingat saat halaman dibuka ulang.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}