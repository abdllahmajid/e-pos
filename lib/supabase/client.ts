import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase untuk dipakai di Client Component ("use client").
 * Baca env NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY —
 * pastikan dua ini ada di .env.local (lihat catatan di bawah).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}