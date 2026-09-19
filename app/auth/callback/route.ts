// app/auth/callback/route.ts
// ── TAMBAHAN ── Titik mendarat WAJIB untuk semua link dari email Supabase
// Auth (undangan user baru DAN reset password — dua-duanya pakai jalur PKCE
// yang sama). SEBELUM file ini ada, link-link itu langsung mendarat di Site
// URL (root app), dan `middleware.ts` men-redirect ke /login SEBELUM kode
// `?code=...` di URL sempat ditukar jadi sesi — hasilnya blank/error, kode di
// URL hilang begitu saja. Ini bukan cuma menambal fitur "Tambah User" yang
// baru, tapi juga menutup celah yang sudah ada sejak fitur "Kirim Reset
// Password" (PengaturanAdminTab.tsx) dibuat — dua-duanya sekarang diarahkan
// ke sini (lihat perubahan `redirectTo` di hooks/useAdminUsers.ts &
// app/api/admin/create-user/route.ts).
//
// Alur: Supabase kirim email -> user klik link -> mendarat DULU di server
// Supabase (`{project}.supabase.co/auth/v1/verify`) -> BARU diarahkan ke sini
// dengan `?code=xxx` (PKCE, bukan token langsung di URL) -> kita tukar kode
// itu jadi sesi asli lewat `exchangeCodeForSession`, sambil menulis cookie
// sesi (pola cookies sama persis dengan middleware.ts) -> redirect ke `next`
// (default `/set-password`, lihat query param di redirectTo pemanggil).
//
// `middleware.ts` WAJIB mengizinkan path ini diakses tanpa sesi dulu (lihat
// PUBLIC_PATHS) — kalau tidak, request ke sini sendiri akan di-redirect ke
// /login sebelum route handler ini sempat jalan.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  // Default ke /set-password — dua kasus pemakaian saat ini (undangan user
  // baru & reset password) sama-sama berujung ke situ. `next` dikirim lewat
  // query oleh pemanggil (lihat redirectTo di useAdminUsers.ts / create-user
  // route.ts), bukan di-hardcode di sini, supaya fleksibel kalau nanti ada
  // kebutuhan lain yang mendarat lewat callback yang sama.
  const next = requestUrl.searchParams.get("next") ?? "/set-password";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${requestUrl.origin}${next}`);
    }
  }

  // Kode tidak ada / sudah kedaluwarsa / gagal ditukar -> balik ke login
  // dengan pesan, jangan biarkan user terdampar di halaman blank.
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set(
    "error",
    "Link sudah kedaluwarsa atau tidak valid. Minta link baru.",
  );
  return NextResponse.redirect(loginUrl);
}