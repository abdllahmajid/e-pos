import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Route yang boleh diakses TANPA login.
// /cek-struk sengaja publik sesuai PRD §4.9 (halaman cek struk untuk pelanggan).
// ── TAMBAHAN ── /auth/callback WAJIB publik: ini titik mendarat link email
// (undangan user baru / reset password) SEBELUM sesi login terbentuk — kalau
// tidak diizinkan di sini, request-nya sendiri di-redirect ke /login duluan,
// dan kode `?code=...` di URL hilang sebelum sempat ditukar jadi sesi. Lihat
// app/auth/callback/route.ts.
const PUBLIC_PATHS = ["/login", "/cek-struk", "/auth/callback"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Pakai getUser() (bukan getSession()) — ini yang divalidasi ke server Supabase,
  // bukan cuma baca cookie mentah. Sengaja begitu demi keamanan, walau sedikit lebih lambat.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Kalau sudah login tapi masih coba buka /login, lempar balik ke halaman utama.
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};