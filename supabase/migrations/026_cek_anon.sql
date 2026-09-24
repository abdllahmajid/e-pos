-- Uji akses anon (halaman /tv tanpa login) — tempel SELURUH isi file lalu Run.
-- Semuanya di dalam transaksi yang di-rollback, jadi TIDAK ada data uji yang tersisa.
-- Harapan: hanya 1 baris muncul, yaitu 'uji-aktif'. Baris 'uji-nonaktif' TIDAK boleh tampil.
begin;

insert into public.promo_media (title, media_type, file_url, storage_path, is_active)
values ('uji-aktif',    'image', 'https://example.com/a.jpg', 'uji/a.jpg', true),
       ('uji-nonaktif', 'image', 'https://example.com/b.jpg', 'uji/b.jpg', false);

set local role anon;

select title, file_url from public.promo_media where title like 'uji-%';

rollback;
