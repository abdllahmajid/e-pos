import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ── KOREKSI (bug: "selalu rendering" / risiko rate limit auth) ──
 * Sebelumnya `createClient()` memanggil `createBrowserClient()` BARU setiap
 * kali fungsi ini dipanggil. Karena hampir tiap hook (useAuth, useProducts,
 * useSettings, useDashboard, useStock, useReports, useShifts,
 * useTransactions, dll — total belasan file) punya baris
 * `const supabase = createClient();` di scope modulnya sendiri, efeknya
 * aplikasi ini diam-diam menjalankan BELASAN instance GoTrueClient (klien
 * auth Supabase) sekaligus di satu tab browser.
 *
 * Tiap instance auth itu punya timer auto-refresh token sendiri-sendiri,
 * jadi token sesi yang SAMA di-refresh berkali-kali secara paralel oleh
 * instance-instance yang berbeda — ini persis kondisi yang memicu warning
 * Supabase "Multiple GoTrueClient instances detected in the same browser
 * context", dan kalau terus terjadi (apalagi kasir sering pindah menu,
 * yang bikin modul unmount/mount ulang → instance baru lagi) bisa betulan
 * kena rate limit endpoint auth Supabase.
 *
 * Perbaikan: cache SATU instance di scope modul ini (`cachedClient`).
 * Panggilan `createClient()` keberapa pun, di file manapun, sekarang selalu
 * mengembalikan objek client yang SAMA — persis pola singleton yang
 * direkomendasikan resminya oleh @supabase/ssr untuk Client Component.
 */
let cachedClient: SupabaseClient | undefined;

/**
 * Client Supabase untuk dipakai di Client Component ("use client").
 * Baca env NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY —
 * pastikan dua ini ada di .env.local (lihat catatan di bawah).
 */
export function createClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return cachedClient;
}