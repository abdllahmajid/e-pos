-- Migration: T-10 (Pengaturan Admin) — tambah kolom `email` di profiles.
--
-- ── Kenapa dibutuhkan ──
-- Tab "Pengaturan Admin" (T-10) butuh tombol "Reset Password" per user.
-- Caranya lewat `supabase.auth.resetPasswordForEmail(email)` (client-side,
-- TIDAK butuh service role key) — tapi fungsi itu butuh alamat EMAIL, dan
-- `profiles` sebelum ini sama sekali tidak menyimpan email (cuma ada di
-- `auth.users`, yang tidak boleh dibaca langsung dari client biasa lewat RLS).
--
-- ── Keputusan desain ──
-- 1. **Kolom nullable, diisi MANUAL oleh admin** — bukan disinkronkan otomatis
--    lewat trigger `auth.users` (pola "sync auth.users -> profiles" memang
--    umum dipakai project Supabase lain, tapi di sini SENGAJA dihindari:
--    project ini sudah punya pola onboarding manual — migration `002` sudah
--    minta admin bikin user di Supabase Dashboard lalu INSERT baris
--    `profiles` manual lewat SQL Editor. Menambah trigger baru di skema
--    `auth` cuma untuk 1 kolom menambah permukaan yang bisa salah tanpa
--    manfaat besar untuk toko sekecil ini (jumlah user sedikit, dikelola
--    manual oleh admin sendiri).
-- 2. **User existing (dibuat sebelum migration ini) kolom email-nya NULL** —
--    admin WAJIB mengisi manual lewat tab Pengaturan Admin (UI T-10 akan
--    punya field edit) sebelum tombol Reset Password bisa dipakai untuk user
--    tersebut. Tombol Reset Password di UI HARUS disabled/beri pesan jelas
--    kalau `email` kosong, bukan diam-diam gagal.
-- 3. **Bukan kolom unique/not null** — sengaja longgar, supaya migration ini
--    tidak gagal dijalankan di data existing yang emailnya belum terisi.
--    Validasi format email (kalau diperlukan) cukup di sisi UI (T-10),
--    bukan constraint database — konsisten dengan pola project ini yang
--    validasi ringan taruh di client, logika penting di RPC/RLS (§18 poin 5
--    PRD), dan kolom ini murni data tampilan/kontak, bukan data transaksi.
-- 4. **RLS TIDAK perlu policy baru** — kolom ini ikut policy SELECT/UPDATE
--    yang sudah ada di `profiles` (migration 002 + 016), tidak ada kolom yang
--    butuh perlindungan ekstra berbeda dari kolom lain di tabel yang sama.

alter table public.profiles
  add column if not exists email text;

comment on column public.profiles.email is
  'Email user, diisi manual oleh admin (bukan sinkron otomatis dari auth.users) — dipakai tombol "Reset Password" di Pengaturan Admin (supabase.auth.resetPasswordForEmail). Bisa NULL untuk user lama yang belum diisi.';
