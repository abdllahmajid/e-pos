-- Migration: Multi-TV untuk Layar Promosi (langkah 1 dari rencana baru,
-- menggantikan arah lama migration 026 yang satu playlist global untuk
-- semua TV). Permintaan pemilik project: "satu TV satu akses sendiri, dan
-- isinya juga sendiri" — jadi tiap TV punya baris `promo_screens` sendiri
-- dengan link unik, dan `promo_media` sekarang milik SATU layar tertentu,
-- bukan milik semua TV sekaligus.
--
-- Skema `promo_media` sebelum migration ini (dikonfirmasi lewat query
-- langsung ke production, BUKAN dari file 026 aslinya yang tidak ikut
-- ter-commit ke repo — lihat PROGRESS.md untuk kronologinya):
--   id, title, media_type, file_url, storage_path, file_name, file_size,
--   duration_seconds, sort_order, is_active, created_by, created_at.
--   RLS 5 policy: select_active (anon+authenticated, is_active=true),
--   select/insert/update/delete_admin_supervisor (authenticated).
--   Kolom yang di-GRANT eksplisit ke anon: id, title, media_type, file_url,
--   duration_seconds, sort_order, is_active.
--
-- ── Keputusan desain ──
--
-- 1. **`access_token` acak 64 karakter hex, BUKAN id/slug yang bisa ditebak.**
--    Dibangun dari 2x `gen_random_uuid()` (fungsi inti Postgres 13+, tanpa
--    perlu extension `pgcrypto`) supaya entropinya jauh di atas cukup untuk
--    dijadikan "kunci akses" pengganti login — polanya beda dari
--    `/cek-struk` (migration 010) yang sengaja pakai 2 kunci publik (nomor
--    struk + tanggal) karena memang harus bisa diketik manual oleh
--    pelanggan; di sini tokennya tidak pernah diketik manusia, cuma
--    ditempel sebagai URL/QR, jadi boleh sepanjang dan seacak mungkin.
-- 2. **`promo_screens` TIDAK diberi hak akses apa pun ke `anon`.** Beda dari
--    rencana awal PROGRESS.md sesi #20 yang mengizinkan `anon` baca
--    langsung tabel `promo_media` (kolom dibatasi via GRANT). Sekarang
--    akses publik SATU-SATUNYA pintu adalah RPC `get_screen_playlist`
--    (`security definer`, lihat bagian bawah) — supaya `anon` tidak pernah
--    perlu tahu struktur tabel maupun bisa query lintas layar sama sekali.
-- 3. **Policy lama `promo_media_select_active` (anon+authenticated,
--    is_active=true) DIHAPUS.** Kalau dibiarkan, `anon` masih bisa
--    `select * from promo_media where is_active=true` langsung dan melihat
--    SEMUA media dari SEMUA TV sekaligus, tembus konsep "isinya sendiri
--    sendiri" yang diminta. Hak kolom yang sudah ter-GRANT ke `anon` juga
--    di-REVOKE di bagian bawah — akses `anon` ke `promo_media` jadi nol,
--    murni lewat RPC.
-- 4. **`promo_media.screen_id` dibuat NULLABLE, bukan NOT NULL.** Sesuai
--    keputusan pemilik project: "mulai bersih dari nol, TV lama dimatikan,
--    saya atur ulang manual" — jadi baris media LAMA (screen_id masih
--    kosong) dibiarkan apa adanya di database (tidak dihapus paksa migration
--    ini), tapi otomatis tidak akan pernah muncul di TV manapun lagi (RPC di
--    bawah selalu JOIN ke promo_screens, baris tanpa screen_id tidak lolos
--    join). Boleh dibersihkan manual belakangan lewat layar pengelola kalau
--    sudah tidak dibutuhkan. Langkah 2 (hook) akan mewajibkan screen_id
--    dari sisi aplikasi untuk SEMUA media baru.
-- 5. **`on delete cascade` dari promo_media ke promo_screens.** Hapus satu
--    TV = ikut menghapus baris media milik TV itu (baris DB saja). File di
--    Storage TIDAK ikut terhapus otomatis oleh cascade ini — langkah
--    berikutnya (hook "hapus layar") wajib membersihkan file Storage-nya
--    dulu satu-satu SEBELUM menghapus baris `promo_screens`, sama seperti
--    pola `removeMedia()` yang sudah ada (hapus baris dulu baru file,
--    supaya tidak ada media "rusak" tertayang) — dibalik urutannya di sini
--    karena arahnya kebalik (hapus induk), bukan mengubah prinsipnya.
-- 6. **RPC `get_screen_playlist` pakai `language sql stable`, bukan
--    `plpgsql`.** Cukup satu SELECT, tidak ada logika bercabang yang perlu
--    exception — token salah/layar nonaktif otomatis menghasilkan 0 baris
--    lewat JOIN, tidak perlu `raise exception` (dan memang JANGAN, supaya
--    tidak membocorkan "layar ada tapi nonaktif" vs "token salah" —
--    sama-sama diam, sama seperti alasan `/cek-struk` memakai pesan gagal
--    generik).
--
-- ── Yang HARUS dilakukan pemilik project setelah menjalankan file ini ──
-- Jalankan `027_cek_hasil.sql` (satu file terpisah, terutama bagian uji
-- `anon`-nya) sebelum melanjutkan ke langkah 2 (hook).

-- --------------------------------------------------------
-- 1. Tabel promo_screens ("layar TV")
-- --------------------------------------------------------

create table if not exists public.promo_screens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  access_token text not null default (
    replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '')
  ),
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint promo_screens_access_token_key unique (access_token),
  constraint promo_screens_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.promo_screens is
  'Satu baris = satu TV/layar promosi fisik. access_token adalah "kunci" URL publik /tv/[access_token] (migration 027) — pengganti login untuk perangkat TV.';
comment on column public.promo_screens.access_token is
  'String acak 64 hex char, dibangkitkan otomatis (2x gen_random_uuid()). Jangan pernah dibuat bisa ditebak/berurutan — ini satu-satunya penjaga akses ke /tv/[access_token].';

alter table public.promo_screens enable row level security;

drop policy if exists "promo_screens_select_admin_supervisor" on public.promo_screens;
create policy "promo_screens_select_admin_supervisor"
  on public.promo_screens for select
  to authenticated
  using (current_user_role() = any (array['admin', 'supervisor']::user_role[]));

drop policy if exists "promo_screens_insert_admin_supervisor" on public.promo_screens;
create policy "promo_screens_insert_admin_supervisor"
  on public.promo_screens for insert
  to authenticated
  with check (current_user_role() = any (array['admin', 'supervisor']::user_role[]));

drop policy if exists "promo_screens_update_admin_supervisor" on public.promo_screens;
create policy "promo_screens_update_admin_supervisor"
  on public.promo_screens for update
  to authenticated
  using (current_user_role() = any (array['admin', 'supervisor']::user_role[]))
  with check (current_user_role() = any (array['admin', 'supervisor']::user_role[]));

drop policy if exists "promo_screens_delete_admin_supervisor" on public.promo_screens;
create policy "promo_screens_delete_admin_supervisor"
  on public.promo_screens for delete
  to authenticated
  using (current_user_role() = any (array['admin', 'supervisor']::user_role[]));

-- Sengaja TIDAK ADA policy untuk anon sama sekali (lihat keputusan #2 di
-- atas) — tabel ini tidak boleh terbaca publik dalam bentuk apa pun.

-- --------------------------------------------------------
-- 2. promo_media: tambah screen_id (nullable, lihat keputusan #4)
-- --------------------------------------------------------

alter table public.promo_media
  add column if not exists screen_id uuid references public.promo_screens(id) on delete cascade;

comment on column public.promo_media.screen_id is
  'Layar TV pemilik media ini (migration 027). NULL = media lama dari sebelum fitur multi-TV, tidak lagi tertayang di manapun sampai diberi screen_id manual.';

create index if not exists promo_media_screen_id_sort_idx
  on public.promo_media (screen_id, sort_order);

-- --------------------------------------------------------
-- 3. Tutup akses langsung anon ke promo_media (lihat keputusan #3)
-- --------------------------------------------------------

drop policy if exists "promo_media_select_active" on public.promo_media;

revoke select on public.promo_media from anon;

-- --------------------------------------------------------
-- 4. RPC publik: satu-satunya pintu /tv/[access_token] (lihat keputusan #6)
-- --------------------------------------------------------

create or replace function public.get_screen_playlist(p_token text)
returns table (
  id uuid,
  title text,
  media_type text,
  file_url text,
  duration_seconds integer,
  sort_order integer
)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.title, m.media_type, m.file_url, m.duration_seconds, m.sort_order
  from public.promo_media m
  join public.promo_screens s on s.id = m.screen_id
  where s.access_token = p_token
    and s.is_active = true
    and m.is_active = true
  order by m.sort_order asc, m.id asc;
$$;

comment on function public.get_screen_playlist(text) is
  'Satu-satunya jalan anon membaca media promosi (migration 027) — dipanggil app/tv/[access_token]/page.tsx (langkah berikutnya). Token salah ATAU layar nonaktif sama-sama menghasilkan 0 baris (tidak membedakan pesan, sengaja, lihat header migration).';

revoke all on function public.get_screen_playlist(text) from public;
grant execute on function public.get_screen_playlist(text) to anon, authenticated;
