"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth"; // sesuaikan path kalau struktur hooks kamu beda

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          LCO POS
        </p>
        <h1 className="text-xl font-semibold tracking-tight mb-6">Masuk</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm"
            />
          </div>

          {formError && <p className="text-xs text-lco-coral">{formError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-sm font-semibold transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Masuk
          </button>
        </form>
      </div>
    </div>
  );
}
