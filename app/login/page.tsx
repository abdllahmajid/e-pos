"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ScanLine,
  Wallet,
  PackageSearch,
  Eye,
  EyeOff,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// ── PERBAIKAN (tampilan login) ── Desain ulang total dari versi sebelumnya:
// 1. Bug kontras: banyak elemen (judul, label, input) sebelumnya pakai
//    `text-white`/`bg-white` TANPA varian `dark:`, padahal dark mode di app
//    ini berbasis CLASS (lihat @custom-variant di globals.css), bukan
//    `prefers-color-scheme`. Efeknya: di light mode teks putih di atas
//    kartu putih/terang -> tidak kebaca sama sekali. Sekarang semua teks
//    pakai pasangan warna terang/gelap yang benar (zinc-900 di light,
//    zinc-100 di dark), diuji kontrasnya di kedua mode.
// 2. Layout: sebelumnya cuma 1 kartu form di tengah layar kosong. Sekarang
//    2 kolom di layar lebar — panel kiri (identitas brand Langitan.co,
//    disembunyikan di layar sempit) + panel kanan (form login) — pola umum
//    aplikasi POS/back-office profesional, dan brand kiri sekaligus jadi
//    "tempat sampah" visual layar kosong yang sebelumnya terasa polos.
export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // ── TAMBAHAN (tombol lihat password) ──
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    const { error } = await signIn(email, password);

    if (error) {
      setFormError(error);
      setIsSubmitting(false);
      return;
    }

    router.push("/");
  }

  return (
    <div className="min-h-screen flex bg-zinc-100 dark:bg-zinc-950">
      {/* ── Panel kiri — identitas brand, hanya tampil di layar lebar (md+).
          Warna dasar lco-green (bukan hitam generik) supaya langsung terasa
          "Langitan.co", dihiasi lingkaran-lingkaran lco-teal transparan yang
          nyerempet ke luar frame — bukan gradient dekoratif polos.
          ── KOREKSI (seimbang) ── Sebelumnya lebar panel kiri 44%/38% (lebih
          sempit dari panel kanan), jadi form di kanan kelihatan tidak center
          terhadap keseluruhan layar. Sekarang dibuat pas 50/50 (`md:w-1/2`
          di kedua sisi) supaya kedua panel benar-benar seimbang. ── */}
      <div className="hidden md:flex md:w-1/2 relative flex-col justify-between overflow-hidden bg-lco-green px-14 py-16 lg:px-20 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-28 h-72 w-72 rounded-full bg-lco-teal/25"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-lco-teal/15"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/3 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full border border-white/10"
        />

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-lco-teal">
            LCO POS
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight leading-snug">
            Langitan.co
          </h1>
          <p className="mt-2 max-w-xs text-sm text-white/70">
            Satu aplikasi untuk transaksi, stok, dan laporan toko kamu —
            dirancang supaya kasir kerja cepat, pemilik tenang.
          </p>
        </div>

        <div className="relative space-y-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <ScanLine className="h-4 w-4 text-lco-teal" />
            </div>
            <div>
              <p className="text-sm font-semibold">Transaksi tanpa ribet</p>
              <p className="text-xs text-white/60">
                Scan barcode, split pembayaran, cetak struk dalam satu layar.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <PackageSearch className="h-4 w-4 text-lco-teal" />
            </div>
            <div>
              <p className="text-sm font-semibold">Stok selalu akurat</p>
              <p className="text-xs text-white/60">
                Setiap penjualan otomatis mengurangi stok, tanpa hitung manual.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Wallet className="h-4 w-4 text-lco-teal" />
            </div>
            <div>
              <p className="text-sm font-semibold">Kas & shift terpantau</p>
              <p className="text-xs text-white/60">
                Buka-tutup shift dan rekap kas tercatat rapi tiap hari.
              </p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-white/40">
          © {new Date().getFullYear()} Langitan.co
        </p>
      </div>

      {/* ── Panel kanan — form login. `md:w-1/2` (bukan `flex-1`) supaya
          benar-benar separuh layar juga, senilai dengan panel kiri — kalau
          cuma `flex-1` lebarnya jadi sisa layar (tetap 50% di kasus 2 panel,
          tapi eksplisit di sini supaya jelas & tidak berubah kalau nanti ada
          panel ketiga). Form di dalamnya tetap `max-w-sm` supaya baris teks
          tidak kepanjangan, tapi terpusat PAS DI TENGAH panel kanan. ── */}
      <div className="flex w-full md:w-1/2 items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm">
          {/* Wordmark ini yang muncul kalau panel kiri disembunyikan (layar
              sempit) — supaya identitas brand tetap ada di mobile. */}
          <div className="mb-8 md:hidden">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lco-teal">
              LCO POS
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Langitan.co
            </h1>
          </div>

          <div className="hidden md:block mb-8">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Masuk ke akun kamu
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Gunakan email & kata sandi yang terdaftar sebagai kasir/admin.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@langitan.co"
                className="w-full px-3 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/40 transition-colors duration-150 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5"
              >
                Password
              </label>
              {/* ── TAMBAHAN (tombol lihat password) ── Wrapper relative +
                  tombol absolute di kanan input, `pr-10` di input supaya
                  teks/placeholder tidak ketiban ikon. `tabIndex={-1}` biar
                  tombol ini dilewati saat Tab dari email ke password
                  (urutan fokus form tetap wajar), dan `aria-label` +
                  `aria-pressed` untuk pengguna screen reader. ── */}
              <div className="relative">
                <input
                  id="password"
                  type={isPasswordVisible ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/40 transition-colors duration-150 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setIsPasswordVisible((v) => !v)}
                  aria-label={
                    isPasswordVisible
                      ? "Sembunyikan password"
                      : "Lihat password"
                  }
                  aria-pressed={isPasswordVisible}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors duration-150"
                >
                  {isPasswordVisible ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {formError && (
              <p className="text-xs text-lco-coral bg-lco-coral/10 border border-lco-coral/30 rounded-md px-3 py-2">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 mt-1 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-sm font-semibold transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Masuk
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
            Lupa kata sandi? Hubungi admin toko kamu.
          </p>
        </div>
      </div>
    </div>
  );
}
