"use client";

// app/set-password/page.tsx
// ── TAMBAHAN ── Halaman terakhir dari alur undangan user baru & reset
// password (lihat app/auth/callback/route.ts). Sesi login SUDAH terbentuk
// duluan lewat cookie di callback route sebelum halaman ini dirender — jadi
// di sini kita TINGGAL panggil `supabase.auth.updateUser({ password })`,
// bukan proses token/kode apa pun lagi (itu sudah selesai di callback).
//
// Kalau user membuka halaman ini TANPA lewat callback (mis. ketik URL
// langsung tanpa sesi) — middleware.ts akan menolaknya lebih dulu (path ini
// SENGAJA TIDAK dimasukkan ke PUBLIC_PATHS, beda dari /auth/callback),
// jadi tidak perlu guard tambahan di sini untuk kasus itu.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function SetPasswordPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password.length < 6) {
      setFormError("Password minimal 6 karakter.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Konfirmasi password tidak sama.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (error) {
      setFormError(error.message || "Gagal menyimpan password.");
      return;
    }

    setIsDone(true);
    // Jeda sebentar supaya pesan sukses sempat kebaca, baru masuk ke app.
    setTimeout(() => router.push("/"), 1500);
  }

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          LCO POS
        </p>

        {isDone ? (
          <div className="py-4 text-center">
            <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-lco-green/10 text-lco-green">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Password tersimpan
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Mengalihkan ke aplikasi...
            </p>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lco-teal/10 text-lco-teal">
                <KeyRound className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Atur Password
                </h1>
                {user?.email && (
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {user.email}
                  </p>
                )}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-500">
                  Password Baru
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-500">
                  Ulangi Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              {formError && (
                <p className="text-xs text-lco-coral">{formError}</p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-lco-green py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Simpan Password
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
