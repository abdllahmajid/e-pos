# Migrasi Struktur Database Supabase (Schema-Only)

> **Status: DARURAT — kerjakan Langkah 1–3 SEKARANG**, selagi sesi dashboard
> Supabase yang lama masih bisa diakses. Bagian restore (Langkah 4 dst.)
> boleh menyusul kapan saja setelah file backup-nya aman di tangan Anda.

## Kenapa tidak cukup pakai `supabase/migrations/001`–`022` saja?

Sebelum menulis panduan ini, isi 22 file migration di repo dicek satu per
satu terhadap `scripts/setup-database.sql` (skrip setup awal yang juga ada
di repo). Ditemukan **konflik nyata**:

- `scripts/setup-database.sql` membuat tipe `user_role` (`admin, kasir,
  owner, supervisor`) dan tabel `profiles` dengan `id UUID DEFAULT
  gen_random_uuid()` (tidak terhubung ke `auth.users`).
- `supabase/migrations/002_setup_profiles_and_roles.sql` **membuat ulang**
  tipe `public.user_role` (isi enum beda: `admin, supervisor, kasir, qc`)
  dan tabel `profiles` dengan `id` yang jadi *foreign key* ke
  `auth.users(id)` — tanpa ada file `DROP TYPE`/`DROP TABLE` di antaranya.

Kalau dua file ini dijalankan berurutan di database kosong, `002` akan
**gagal** (tipe & tabel sudah ada). Artinya: di suatu titik, seseorang
pasti sudah menjalankan `DROP TABLE profiles` / `DROP TYPE user_role`
secara manual lewat SQL Editor — langkah yang **tidak pernah tercatat**
di migration manapun. Ada kemungkinan celah serupa di bagian lain yang
belum ketemu.

**Kesimpulan:** file-file `.sql` di repo TIDAK BISA dipakai begitu saja
sebagai sumber kebenaran struktur database Anda saat ini. Satu-satunya
sumber yang pasti akurat adalah **database production itu sendiri** —
karena itu langkah di bawah ini mengambil struktur langsung dari sana
(`pg_dump` lewat Supabase CLI), bukan menyusun ulang dari file migration.

---

## Langkah 1 — Ambil connection string project LAMA

1. Buka dashboard Supabase project lama (selagi sesi masih hidup).
2. **Project Settings → Database → Connection string**, pilih tab **URI**.
   Salin URL-nya (bentuknya `postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres`
   atau lewat *Session pooler* kalau direct connection diblok).
3. Kalau field password masih berupa placeholder `[YOUR-PASSWORD]` dan Anda
   lupa passwordnya: di halaman yang sama biasanya ada tombol **Reset
   database password** — masih bisa dipakai selama dashboard masih
   menerima Anda. Password lama tidak perlu diingat, yang penting connection
   string yang baru direset ini berhasil dipakai di Langkah 2.

> Simpan connection string ini sementara di catatan lokal (bukan di
> GitHub). Setelah dipakai di Langkah 2, boleh dibuang.

## Langkah 2 — Dump struktur (schema-only, tanpa isi data)

Di terminal, dari folder project (`lco-pos-main`), jalankan (tidak perlu
install apa pun secara global — `npx` mengunduh Supabase CLI sekali pakai):

```bash
npx supabase db dump \
  --db-url "PASTE_CONNECTION_STRING_DARI_LANGKAH_1" \
  -f schema_backup_lama.sql
```

Tanpa flag tambahan, `supabase db dump` **otomatis schema-only** — tidak
menyertakan isi tabel (produk, transaksi, dll.) maupun role/akun. Ini
persis yang Anda minta: struktur saja, bukan isinya.

Hasilnya: satu file `schema_backup_lama.sql` di folder project, berisi
`CREATE TYPE`, `CREATE TABLE`, semua `CREATE FUNCTION` (RPC seperti
`create_transaction`, `return_transaction`, dll.), trigger, index, dan
seluruh RLS policy — **persis seperti yang aktif di production sekarang**,
bukan hasil reka ulang dari file migration.

## Langkah 3 — Amankan file backup-nya SEKARANG

Begitu `schema_backup_lama.sql` berhasil dibuat:

- Simpan salinannya di **minimal 2 tempat** yang bukan akun GitHub/Supabase
  yang sama-sama berisiko (mis. Google Drive akun lain, email ke diri
  sendiri, penyimpanan lokal + flashdisk).
- File ini murni teks SQL berisi struktur — aman disimpan di mana saja,
  tidak ada data pelanggan/transaksi di dalamnya.

**Sampai di sini adalah bagian mendesak. Selesaikan dulu sebelum lanjut ke
bagian restore di bawah**, karena tujuannya menyelamatkan struktur
sebelum akses ke project lama benar-benar hilang.

---

## Langkah 4 — Restore ke project Supabase BARU (kapan saja, tidak mendesak)

1. Buat project Supabase baru, ambil connection string barunya (sama
   caranya seperti Langkah 1, tapi project baru).
2. Jalankan salah satu cara berikut:

   **Cara A — psql (kalau tersedia di komputer Anda):**
   ```bash
   psql "PASTE_CONNECTION_STRING_PROJECT_BARU" -f schema_backup_lama.sql
   ```

   **Cara B — SQL Editor Supabase Studio (tanpa psql):**
   Buka project baru → SQL Editor → tempel isi `schema_backup_lama.sql` →
   Run. Kalau filenya besar dan editor terasa berat, jalankan per beberapa
   ratus baris (potong di antara blok `CREATE ...`, jangan di tengah satu
   statement).

3. **Sebelum restore**, Supabase menyarankan menjalankan ini dulu di
   project baru supaya privilege `anon`/`authenticated` tidak otomatis
   kebuka lebar ke semua tabel:
   ```sql
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
   ```

## Langkah 5 — WAJIB dikerjakan manual: Storage bucket `payment-proofs`

`supabase db dump` **tidak menyertakan schema `storage`** (dianggap
schema bawaan platform). Artinya bucket `payment-proofs` (tempat bukti
transfer/QRIS diupload, dibuat migration `006`) **tidak ikut ter-dump**
dan harus dibuat ulang manual di project baru. Jalankan di SQL Editor
project BARU, setelah restore struktur `public` selesai:

```sql
-- Bucket public=true supaya URL bukti pembayaran bisa tampil langsung
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', true)
on conflict (id) do nothing;

drop policy if exists "payment_proofs_storage_select" on storage.objects;
create policy "payment_proofs_storage_select"
  on storage.objects for select
  using (bucket_id = 'payment-proofs');

drop policy if exists "payment_proofs_storage_insert" on storage.objects;
create policy "payment_proofs_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );
```

(Dicek di repo: ini satu-satunya bucket Storage yang dipakai kode — tidak
ada bucket lain untuk foto produk atau semacamnya.)

## Langkah 6 — Verifikasi hasil restore

Jalankan query pengecekan yang sudah disiapkan di `PROGRESS.md` bagian
"Yang HARUS dikonfirmasi" poin 1, tapi kali ini di project **BARU**, untuk
memastikan dump membawa semuanya:

```sql
select to_regclass('public.held_orders') as held_orders;
select polname from pg_policy where polrelid = 'public.profiles'::regclass order by 1;
select column_name from information_schema.columns
 where table_schema='public' and table_name='profiles'
   and column_name in ('email','fcm_token','fcm_token_updated_at');
select pg_get_function_arguments(p.oid) from pg_proc p
 where p.proname='create_transaction'
   and pg_get_function_arguments(p.oid) ilike '%p_customer_phone%'
   and pg_get_function_arguments(p.oid) ilike '%p_payments%';
```

Lalu update `.env.local` project (dan Vercel env) dengan
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` project baru,
dan buat ulang service role key kalau dipakai (`SUPABASE_SERVICE_ROLE_KEY`,
untuk `app/api/admin/create-user/route.ts`).

---

## Batasan — apa yang TIDAK ter-cover panduan ini

Sesuai permintaan, ini **hanya struktur**, bukan pemulihan penuh:

- **Isi tabel** (produk, transaksi, dll.) — memang sengaja tidak diambil.
  Kalau nanti berubah pikiran dan butuh data juga, tinggal tambah
  `--data-only --use-copy` di Langkah 2 untuk dump kedua, terpisah dari
  struktur.
- **Akun user di `auth.users`** (kasir/admin yang sudah terdaftar) — schema
  `auth` tidak ikut ter-dump. User harus diundang ulang lewat fitur "Tambah
  User" di project baru setelah struktur `profiles` ada.
- **File fisik** yang sudah terupload ke bucket `payment-proofs` (bukan
  cuma definisi bucketnya) — perlu diunduh manual dari Storage project
  lama kalau masih ingin disimpan, sebelum akses hilang.
- **Environment variables/secrets** (Firebase Admin, dsb.) — tidak
  tersimpan di database sama sekali, harus dicatat ulang manual dari
  `.env.local` / Vercel.

## Langkah selanjutnya yang bisa disiapkan (kalau diinginkan)

Kalau nanti mau ini jadi "fitur" yang lebih permanen di repo (bukan cuma
panduan manual), langkah berikutnya bisa berupa satu file skrip
`scripts/backup-schema.sh` yang membungkus perintah `npx supabase db dump`
di Langkah 2 supaya tinggal dijalankan `npm run backup:schema` kapan pun,
tanpa perlu mengetik ulang perintahnya. Beri tahu saya kalau mau itu
dibuatkan sebagai langkah berikutnya — atau kalau Langkah 1–3 di atas
sudah cukup untuk situasi mendesak sekarang, kita lanjut ke task PRD
berikutnya seperti biasa.
