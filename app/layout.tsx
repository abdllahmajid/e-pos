import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ── TAMBAHAN (T-12, PWA manifest + icon) ──
// `manifest`/`icons` di sini yang membuat browser mobile menawarkan "Add to
// Home Screen" / "Install App". Ikon di public/icons/ MASIH PLACEHOLDER
// (monogram teks "LCO", bukan logo asli toko) — timpa 2 file PNG-nya kalau
// logo asli sudah ada, TIDAK perlu ubah baris ini (nama file & ukuran sama).
export const metadata: Metadata = {
  title: "LCO POS - Aplikasi Kasir Langitan.co",
  description:
    "Aplikasi kasir toko Langitan.co — transaksi, stok, laporan, dan shift kasir dalam satu aplikasi.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    // `apple-touch-icon` WAJIB tanpa transparansi & TANPA maskable-safe-zone
    // (beda dari icon-512-maskable.png yang memang untuk Android) — iOS
    // Safari tidak membaca manifest.json untuk ikon home screen sama sekali,
    // cuma tag <link rel="apple-touch-icon"> ini, jadi harus dideklarasikan
    // terpisah di sini walau isinya kebetulan sama dengan icon-512.png biasa.
    apple: [
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

// Next.js 16: `themeColor` WAJIB lewat export `viewport` terpisah, BUKAN
// digabung ke object `metadata` di atas (perubahan dari versi Next.js lama —
// lihat catatan AGENTS.md soal breaking changes versi ini). Warna dari
// `--color-lco-green` (app/globals.css) — dipakai browser mobile untuk warna
// status bar/title bar saat aplikasi diinstal sebagai PWA.
export const viewport: Viewport = {
  themeColor: "#124540",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      // ── KOREKSI (T-12) ── Sebelumnya masih "en" bawaan create-next-app,
      // tidak pernah diubah sesi manapun sebelumnya — sekarang disamakan
      // dengan `lang: "id-ID"` di manifest.json, konsisten dengan seluruh
      // teks UI aplikasi ini yang memang Bahasa Indonesia.
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
