-- Cek migration 026 — tempel SELURUH isi file ini ke SQL Editor lalu Run.
-- Hasilnya satu tabel: kolom "hasil" harus sama dengan kolom "harapan".
select '1. RLS tabel promo_media aktif' as cek,
       (select rowsecurity::text from pg_tables
         where schemaname = 'public' and tablename = 'promo_media') as hasil,
       'true' as harapan
union all
select '2. Jumlah policy tabel promo_media',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'promo_media'),
       '5'
union all
select '3. Bucket promo-media (public / batas byte)',
       coalesce((select b.public::text || ' / ' || b.file_size_limit::text
                   from storage.buckets b where b.id = 'promo-media'), 'TIDAK ADA'),
       'true / 52428800'
union all
select '4. Jumlah policy Storage promo_media',
       (select count(*)::text from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'promo_media_storage_%'),
       '3'
union all
select '5. RPC reorder_promo_media ada',
       (to_regprocedure('public.reorder_promo_media(uuid[])') is not null)::text,
       'true';
