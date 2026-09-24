// app/tv/page.tsx
// ── KOREKSI ── /tv global (sesi #20, SATU playlist untuk semua TV) sudah
// digantikan /tv/[access_token] (migration 027, satu link per TV). Sesuai
// keputusan pemilik project: dimatikan, bukan dihapus diam-diam — siapa pun
// yang masih membuka link lama ini dilempar ke halaman utama (yang akan
// meneruskan ke /login kalau belum masuk, lewat middleware.ts seperti
// biasa) daripada disambut layar putih/404 tanpa penjelasan.
//
// Server component biasa (BUKAN "use client") — cukup redirect saat render,
// tidak ada state/efek yang dibutuhkan.

import { redirect } from "next/navigation";

export default function LegacyTvPage() {
  redirect("/");
}
