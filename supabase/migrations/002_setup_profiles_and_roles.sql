-- Migration: sistem role dasar (profiles).
-- 4 role disiapkan sesuai PRD §3, walau yang dipakai sekarang baru 'supervisor'.

create type public.user_role as enum ('admin', 'supervisor', 'kasir', 'qc');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'kasir',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Untuk sekarang: setiap user cuma boleh baca profilnya sendiri.
-- Nanti kalau sudah ada admin/supervisor yang perlu lihat semua user (mis. halaman
-- Pengaturan Admin di PRD §11 "Pengaturan Admin"), tambah policy baru di sini —
-- jangan longgarkan policy ini jadi "true" begitu saja.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- ── Jalankan manual setelah ini ──
-- Ganti 'PASTE-USER-UID-DISINI' dengan User UID yang kamu salin dari
-- Supabase Dashboard > Authentication > Users, setelah bikin user pertama.
--
-- insert into public.profiles (id, full_name, role)
-- values ('PASTE-USER-UID-DISINI', 'Majid', 'supervisor');
