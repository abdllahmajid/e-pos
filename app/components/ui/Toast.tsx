"use client";

import { CheckCircle2, XCircle } from "lucide-react";

export type ToastVariant = "success" | "error";

type ToastProps = {
  /** Kalau false, komponen tidak me-render apa pun (bukan cuma disembunyikan lewat CSS). */
  visible: boolean;
  message: string;
  variant?: ToastVariant;
  /**
   * Lama notifikasi tampil sebelum hilang otomatis, dalam ms — dipakai untuk
   * mengatur durasi animasi garis countdown supaya PERSIS selesai bersamaan
   * dengan waktu pemanggil menyembunyikan toast ini (lihat `printToastTimeoutRef`
   * di PaymentModal.tsx). Default 3000ms.
   */
  durationMs?: number;
};

/**
 * Notifikasi pop-up di tengah-atas layar dengan garis countdown yang
 * menyusut sampai notifikasi hilang. Komponen ini HANYA urusan tampilan —
 * kapan `visible` jadi true/false, dan kapan toast disembunyikan (biasanya
 * lewat `setTimeout` di komponen pemanggil), diatur oleh pemanggil, bukan
 * oleh komponen ini sendiri (supaya pemanggil tetap bisa membatalkan/
 * memperpanjang timer-nya sendiri kalau perlu).
 *
 * ── CATATAN ── Karena komponen ini return `null` total saat `visible` false
 * (bukan disembunyikan lewat CSS), setiap kali `visible` berubah dari false
 * -> true, React selalu membuat node DOM yang benar-benar baru — jadi
 * animasi masuk & garis countdown otomatis restart dari awal tiap toast
 * baru muncul, tanpa perlu `key` khusus dari pemanggil.
 */
export default function Toast({
  visible,
  message,
  variant = "success",
  durationMs = 3000,
}: ToastProps) {
  if (!visible) return null;

  const isSuccess = variant === "success";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] w-[92vw] max-w-sm animate-toast-in"
    >
      <div
        className={`overflow-hidden rounded-lg border shadow-lg backdrop-blur-sm ${
          isSuccess
            ? "bg-white/95 dark:bg-zinc-900/95 border-lco-green/30"
            : "bg-white/95 dark:bg-zinc-900/95 border-lco-coral/30"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 py-3">
          {isSuccess ? (
            <CheckCircle2 className="w-4.5 h-4.5 shrink-0 text-lco-green" />
          ) : (
            <XCircle className="w-4.5 h-4.5 shrink-0 text-lco-coral" />
          )}
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {message}
          </p>
        </div>
        {/* Garis countdown: lebar 100% -> 0% selama durationMs, lalu toast
            disembunyikan pemanggil tepat saat animasi ini selesai. */}
        <div className="h-0.5 w-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full ${isSuccess ? "bg-lco-green" : "bg-lco-coral"} animate-toast-countdown`}
            style={{ animationDuration: `${durationMs}ms` }}
          />
        </div>
      </div>
    </div>
  );
}
