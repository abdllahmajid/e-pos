-- Cek migration 027 — tempel SELURUH isi file ini ke SQL Editor lalu Run.
-- Bagian 1: satu tabel, kolom "hasil" harus sama dengan kolom "harapan".
-- Bagian 2: uji anon (transaksi di-rollback, TIDAK ada data uji yang tersisa).

-- ── Bagian 1: cek struktur ────────────────────────────────────────────────

select '1. RLS tabel promo_screens aktif' as cek,
       (select rowsecurity::text from pg_tables
         where schemaname = 'public' and tablename = 'promo_screens') as hasil,
       'true' as harapan
union all
select '2. Jumlah policy tabel promo_screens',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'promo_screens'),
       '4'
union all
select '3. promo_media punya kolom screen_id',
       (exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'promo_media'
                   and column_name = 'screen_id'))::text,
       'true'
union all
select '4. Policy anon lama (promo_media_select_active) sudah hilang',
       (not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'promo_media'
                       and policyname = 'promo_media_select_active'))::text,
       'true'
union all
select '5. anon TIDAK lagi punya SELECT langsung ke promo_media',
       (not exists (select 1 from information_schema.role_table_grants
                     where table_schema = 'public' and table_name = 'promo_media'
                       and grantee = 'anon' and privilege_type = 'SELECT'))::text,
       'true'
union all
select '6. RPC get_screen_playlist ada',
       (to_regprocedure('public.get_screen_playlist(text)') is not null)::text,
       'true'
union all
select '7. anon punya EXECUTE ke get_screen_playlist',
       (has_function_privilege('anon', 'public.get_screen_playlist(text)', 'execute'))::text,
       'true';

-- ── Bagian 2: uji fungsional sebagai anon (halaman /tv tanpa login) ───────
-- Harapan: query "layar aktif" mengembalikan 1 baris ('media-aktif'), dan
-- KEDUA query lain ('layar nonaktif', 'token salah') mengembalikan 0 baris.

begin;

insert into public.promo_screens (id, name, access_token, is_active)
values
  ('11111111-1111-1111-1111-111111111111', 'uji-layar-aktif', 'uji-token-aktif', true),
  ('22222222-2222-2222-2222-222222222222', 'uji-layar-nonaktif', 'uji-token-nonaktif', false);

insert into public.promo_media (title, media_type, file_url, storage_path, is_active, screen_id)
values
  ('media-aktif', 'image', 'https://example.com/a.jpg', 'uji/a.jpg', true, '11111111-1111-1111-1111-111111111111'),
  ('media-di-layar-nonaktif', 'image', 'https://example.com/b.jpg', 'uji/b.jpg', true, '22222222-2222-2222-2222-222222222222');

set local role anon;

select 'a. Token benar, layar aktif (harus 1 baris: media-aktif)' as uji;
select * from public.get_screen_playlist('uji-token-aktif');

select 'b. Token benar, tapi layar NONAKTIF (harus 0 baris)' as uji;
select * from public.get_screen_playlist('uji-token-nonaktif');

select 'c. Token salah/asal (harus 0 baris)' as uji;
select * from public.get_screen_playlist('token-yang-tidak-pernah-ada');

select 'd. anon select langsung ke promo_media (HARUS error permission denied)' as uji;
select * from public.promo_media limit 1;

rollback;
