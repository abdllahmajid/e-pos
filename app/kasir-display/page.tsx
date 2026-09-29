"use client";

// app/kasir-display/page.tsx
// ── TAMBAHAN (Kasir mode PC: tombol "Display") ── Halaman layar KEDUA untuk
// pelanggan (dibuka lewat window.open() dari KasirModule/KasirModulePC saat
// tombol "Display" diklik, mis. di monitor kedua yang dicolok ke komputer
// kasir — pola umum kasir retail: kasir lihat 1 layar, pelanggan lihat layar
// lain berisi rincian belanjaannya sendiri).
//
// KEPUTUSAN PRODUK (dikonfirmasi user): tombol & halaman ini disiapkan DULU,
// tapi ISINYA (sinkron live keranjang & total dari layar Kasir) MENYUSUL —
// jadi file ini SENGAJA baru placeholder statis. Scaffolding untuk isinya
// nanti (BroadcastChannel, cara paling sederhana untuk 2 tab/window di
// browser yang SAMA saling kirim pesan tanpa server) sudah digariskan di
// komentar di bawah supaya sesi berikutnya tinggal isi, bukan mulai dari nol.
//
// Sengaja TIDAK public (tidak didaftar di middleware.ts PUBLIC_PATHS) — beda
// dari /tv/[access_token] yang memang untuk TV toko yang diakses siapa pun.
// Layar ini cuma dibuka dari dalam aplikasi (window.open, warisan sesi login
// yang sama), jadi biarkan lewat proteksi auth normal seperti halaman lain.

import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";

// ── CATATAN UNTUK IMPLEMENTASI SINKRON (belum dipakai) ──────────────────────
// Saat KasirModule mengirim update, pola yang disarankan:
//
//   const channel = new BroadcastChannel(`kasir-display-${activeShift.id}`);
//   channel.postMessage({ cart, subtotal, discount, tax, grandTotal, customer });
//
// dan di halaman ini:
//
//   useEffect(() => {
//     const channel = new BroadcastChannel(`kasir-display-${shiftId}`);
//     channel.onmessage = (e) => setDisplayState(e.data);
//     return () => channel.close();
//   }, [shiftId]);
//
// `shiftId` perlu dikirim lewat query string saat window.open() dipanggil
// (mis. `/kasir-display?shift=${activeShift.id}`) supaya halaman ini tahu
// channel mana yang harus didengarkan. BroadcastChannel HANYA bekerja antar
// tab/window di browser yang sama di komputer yang sama — cukup untuk kasus
// "2 monitor, 1 komputer kasir" yang dijelaskan user, TIDAK untuk 2 perangkat
// terpisah (itu butuh Supabase Realtime, di luar cakupan keputusan ini).

export default function KasirDisplayPage() {
  const { settings } = useSettings();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-white">
      <div className="flex items-center gap-2 text-lco-teal">
        <Store className="h-6 w-6" />
        <span className="text-lg font-semibold tracking-tight">
          {settings.namaToko}
        </span>
      </div>

      <p className="text-2xl font-semibold text-zinc-200">
        Layar Display Pelanggan
      </p>
      <p className="max-w-md text-center text-sm text-zinc-400">
        Rincian belanja &amp; total akan tampil otomatis di sini begitu kasir
        mulai memindai barang. Fitur ini sedang disiapkan.
      </p>

      {now && (
        <p className="mt-6 font-mono text-sm tabular-nums text-zinc-500">
          {new Intl.DateTimeFormat("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(now)}
        </p>
      )}
    </div>
  );
}
