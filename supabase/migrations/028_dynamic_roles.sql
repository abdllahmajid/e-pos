-- 028_dynamic_roles.sql
-- ── FITUR BARU (bukan task T-xx PRD) ── Sistem role dinamis, menggantikan
-- total enum Postgres `user_role` (admin/supervisor/kasir/qc yang dihardcode)
-- dengan 3 tabel baru: `roles`, `permissions`, `role_permissions`.
--
-- LATAR BELAKANG & KEPUTUSAN KUNCI:
-- Pemilik project ingin bikin role SENDIRI (nama bebas), lalu centang menu
-- apa saja yang boleh diakses role itu, lalu tinggal pasang role itu ke user
-- baru — bukan lagi 4 pilihan role yang dihardcode di kode & database.
--
-- Awalnya sempat dipertimbangkan pendekatan "aman" (role custom menumpang
-- salah satu dari 4 role dasar, base_role tetap dipegang backend) supaya
-- RLS lama tidak perlu disentuh. TAPI pemilik project mengonfirmasi
-- **aplikasi ini masih tahap pengembangan, belum dipakai transaksi nyata**
-- (belum ada data production yang harus dijaga kompatibel) — jadi migration
-- ini langsung REPLACE total, bukan menumpuk lapisan baru di atas yang lama.
-- Hasilnya lebih bersih, tapi berarti SEMUA RLS policy & RPC yang tadinya
-- baca `profiles.role = 'admin'/'supervisor'` (10 policy di 6 tabel + 2
-- policy storage + 4 RPC + 1 trigger — lihat daftar lengkap di bawah) ikut
-- ditulis ulang di migration ini juga, bukan cuma bikin tabel baru.
--
-- KONSEP:
-- - `roles`      : role bebas dibuat pemilik project. Kolom `level` (integer,
--                  0 = paling tinggi) MENGGANTIKAN hierarki admin>supervisor
--                  yang dulu dihardcode — dipakai buat 2 aturan yang dulu
--                  ditulis manual per-fungsi: (a) siapa boleh mengubah/
--                  menonaktifkan akun siapa (target harus level >= caller,
--                  generalisasi dari "supervisor tidak bisa sentuh admin"),
--                  (b) siapa boleh memberi role apa (role yang diberikan
--                  harus level >= level caller, generalisasi dari
--                  "supervisor tidak bisa menjadikan orang admin").
--                  Kolom `lintas_kasir` (boolean) MENGGANTIKAN pola
--                  "admin/supervisor bisa lihat/tutup shift & held-order
--                  kasir LAIN, bukan cuma punya sendiri" — sebelumnya
--                  digabung ke cek admin/supervisor, sekarang jadi flag
--                  independen supaya role apa pun bisa diberi kemampuan itu
--                  tanpa harus "menyamar" jadi admin/supervisor.
--                  Kolom `is_system` menandai 4 role bawaan hasil migrasi
--                  data lama (Admin/Supervisor/Kasir/QC) — TIDAK BISA
--                  dihapus (supaya user lama yang masih pegang role ini
--                  tidak pernah kehilangan role-nya tiba-tiba), TAPI tetap
--                  BISA diubah nama/level/permission-nya seperti role custom
--                  lain. Kolom `slug` cuma dipakai internal migration ini
--                  buat mapping data lama -> role baru, tidak dipakai lagi
--                  setelah migration selesai (tidak ada logika app yang baca
--                  slug, semua baca permission/level).
-- - `permissions`: katalog TETAP (bukan bebas ditambah dari UI) berisi 10
--                  menu yang sudah ada gate-nya di kode sekarang (lihat tabel
--                  pemetaan di bawah). Sengaja tidak dibuka insert/update/
--                  delete-nya ke siapa pun lewat RLS (tidak ada policy
--                  authenticated sama sekali = default deny) — nambah
--                  menu baru di app tetap butuh migration baru yang nambah
--                  baris di sini, bukan dikira "role kosong = permission
--                  custom baru" dari UI.
-- - `role_permissions`: baris {role_id, permission_key, allowed}. Hanya baris
--                  `allowed = true` yang berarti apa-apa — TIDAK ada baris
--                  untuk kombinasi role+permission berarti otomatis DITOLAK
--                  (cek pakai EXISTS ... AND allowed = true, bukan NOT EXISTS
--                  buat larangan).
--
-- PEMETAAN permission_key -> gate lama di kode (dipakai buat isi seed di
-- bawah SAMA PERSIS dengan perilaku sebelum migration ini, supaya tidak ada
-- user yang tiba-tiba kehilangan/dapat akses baru cuma gara-gara migration):
--   kasir            -> KasirModule (semua role bisa akses; tidak ada gate
--                       eksplisit sebelumnya, cuma soal siapa yang "punya
--                       shift sendiri" - tetap begitu, permission ini baru
--                       dipakai kalau nanti pemilik project mau ngunci akses
--                       kasir per-role juga)
--   produk           -> ProdukModule.tsx canManage... (baris 83)
--   stok             -> StokModule.tsx canManageStock (baris 459) +
--                       RPC adjust_stock
--   laporan          -> LaporanModule.tsx canViewReports (baris 758)
--   promo            -> PromoModule.tsx canManage (baris 1065) + RPC
--                       reorder_promo_media + RLS promo_media/promo_screens
--                       + storage bucket promo-media
--   log_aktivitas    -> LogAktivitasModule.tsx (baris 95) + RLS activity_logs
--   sampah           -> SampahModule.tsx canAccessTrash (baris 59)
--   pengaturan_toko  -> PengaturanModule.tsx tab "Toko & Struk" + RLS settings
--   pengaturan_admin -> PengaturanModule.tsx tab "Pengaturan Admin" + RLS
--                       profiles (select/update) + RPC admin_update_user_role
--                       / admin_set_user_active
--   pengaturan_role  -> TAB BARU "Role" (belum ada UI-nya sampai migration
--                       ini — menyusul langkah berikutnya). Sengaja TIDAK
--                       digabung ke pengaturan_admin walau sama-sama di
--                       menu Pengaturan: mengatur STRUKTUR role & permission
--                       adalah aksi paling sensitif di sistem baru ini (bisa
--                       mengubah akses semua orang sekaligus), jadi dipisah
--                       supaya pemilik project bisa kasih orang lain akses
--                       kelola user TANPA sekaligus kasih akses ubah
--                       permission role itu sendiri.
--
-- Hierarki "seberapa sensitif": beberapa aksi paling berbahaya TETAP dikunci
-- ekstra ke level = 0 (bukan cuma permission), meniru pola lama
-- `settings_delete_admin_only` (dulu admin-only walau insert/update-nya
-- admin+supervisor):
--   - Hapus row `settings` (settings_delete) — tetap level 0 saja.
--   - Menghapus role, atau mengubah level SATU-SATUNYA role level=0 yang
--     tersisa — diblokir trigger `protect_role_mutation` di bawah, supaya
--     tidak ada skenario "semua role level 0 terhapus, tidak ada yang bisa
--     kelola apa-apa lagi".
--
-- ── PENTING (bacaan untuk langkah selanjutnya) ── Migration ini HANYA
-- database. Frontend (hooks/useAuth.ts tipe UserRole, hooks/useAdminUsers.ts,
-- app/api/admin/create-user/route.ts, dan semua 7 file yang baca
-- `user?.role === "admin" || user?.role === "supervisor"`) BELUM disentuh —
-- itu akan ERROR kalau langsung dijalankan sebelum langkah frontend
-- menyusul (kolom `profiles.role` sudah hilang, diganti `profiles.role_id`).
-- JANGAN jalankan migration ini di database yang masih dipakai app lama
-- tanpa deploy barengan frontend langkah berikutnya.

begin;

-- ── 1. Tabel roles ────────────────────────────────────────────────────────
create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  slug         text unique,        -- cuma dipakai backfill data lama, lihat catatan header
  level        integer not null default 10,
  lintas_kasir boolean not null default false,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint roles_level_check check (level >= 0)
);

comment on table public.roles is 'Role dinamis buatan pemilik project (migration 028, menggantikan enum user_role total). level 0 = paling tinggi. lintas_kasir = boleh lihat/kelola shift & held-order kasir lain, bukan cuma milik sendiri.';
comment on column public.roles.level is 'Hierarki akses antar-user (bukan antar-menu): dipakai admin_update_user_role/admin_set_user_active buat tentukan siapa boleh ubah/nonaktifkan siapa, dan role apa boleh diberikan ke siapa. Generalisasi dari hardcode "supervisor tidak bisa sentuh admin" lama.';
comment on column public.roles.is_system is 'True untuk 4 role hasil migrasi data lama (Admin/Supervisor/Kasir/QC) — tidak bisa DIHAPUS (masih dipegang user lama), tapi nama/level/permission-nya tetap bisa diubah bebas seperti role custom lain.';

-- ── 2. Tabel permissions (katalog tetap, lihat pemetaan di komentar header) ─
create table public.permissions (
  key         text primary key,
  label       text not null,
  description text
);

comment on table public.permissions is 'Katalog TETAP menu/fitur yang bisa di-toggle per role (migration 028). Sengaja tidak ada RLS policy authenticated (default deny total) — nambah permission baru wajib lewat migration baru, bukan dari UI.';

insert into public.permissions (key, label, description) values
  ('kasir',            'Kasir',             'Modul transaksi/POS.'),
  ('produk',           'Kelola Produk',     'Tambah/ubah produk & kategori.'),
  ('stok',             'Kelola Stok',       'Opname & penyesuaian stok manual, riwayat mutasi stok.'),
  ('laporan',          'Laporan',           'Lihat laporan penjualan.'),
  ('promo',            'Layar Promosi TV',  'Kelola daftar TV & media promosi.'),
  ('log_aktivitas',    'Log Aktivitas',     'Lihat riwayat aktivitas sensitif user lain.'),
  ('sampah',           'Sampah',            'Lihat & pulihkan produk/transaksi yang dihapus.'),
  ('pengaturan_toko',  'Pengaturan Toko',   'Ubah pengaturan struk/PPN/format cetak toko.'),
  ('pengaturan_admin', 'Pengaturan Admin',  'Kelola daftar user: tambah, ubah role, aktif/nonaktifkan.'),
  ('pengaturan_role',  'Pengaturan Role',   'Buat/ubah/hapus role beserta daftar permission-nya. Paling sensitif — lihat catatan header.');

-- ── 3. Tabel role_permissions (junction) ────────────────────────────────────
create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_key  text not null references public.permissions(key) on delete cascade,
  allowed         boolean not null default true,
  primary key (role_id, permission_key)
);

comment on table public.role_permissions is 'Baris allowed=true berarti role itu boleh akses menu tsb. Tidak ada baris = default DITOLAK (migration 028).';

-- ── 4. Seed 4 role bawaan (persis perilaku lama, lihat pemetaan di header) ──
insert into public.roles (name, slug, level, lintas_kasir, is_system) values
  ('Admin',      'admin',      0, true,  true),
  ('Supervisor', 'supervisor', 1, true,  true),
  ('Kasir',      'kasir',      2, false, true),
  ('QC',         'qc',         2, false, true);

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key, true
from public.roles r
cross join public.permissions p
where r.slug = 'admin';  -- Admin: semua permission, termasuk pengaturan_role.

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key, true
from public.roles r
cross join public.permissions p
where r.slug = 'supervisor'
  and p.key <> 'pengaturan_role';  -- sama seperti Admin KECUALI kelola role (lihat header).

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'kasir', true
from public.roles r
where r.slug in ('kasir', 'qc');  -- Kasir & QC: cuma modul Kasir, sama seperti sebelum migration.

-- ── 5. profiles: tambah kolom role_id baru, backfill dari enum lama ─────────
-- (kolom `role` lama & enum `user_role` baru DILEPAS di section 9, setelah
-- semua RLS/RPC/trigger lama yang masih membacanya di-drop di section 8 —
-- fungsi baru di section 6 di bawah baru boleh mereferensikan role_id
-- setelah kolomnya benar-benar ada, makanya section ini didahulukan.)
alter table public.profiles add column role_id uuid references public.roles(id);

update public.profiles p
set role_id = r.id
from public.roles r
where r.slug = p.role::text;

-- Jaga-jaga: kalau ternyata ada baris profiles yang role_id-nya masih NULL
-- (enum lama tidak ketemu slug manapun — harusnya mustahil karena enum cuma
-- 4 nilai dan ke-4-nya sudah di-seed di atas), migration DIHENTIKAN di sini
-- dengan pesan jelas, daripada lanjut bikin kolom NOT NULL gagal dengan error
-- generik yang bikin bingung.
do $$
begin
  if exists (select 1 from public.profiles where role_id is null) then
    raise exception 'Ada baris profiles yang role lamanya tidak ke-mapping ke roles baru — migration dihentikan, cek manual dulu sebelum lanjut.';
  end if;
end $$;

alter table public.profiles alter column role_id set not null;

-- ── 6. Helper functions baru (pengganti current_user_role()) ────────────────
-- Semua SECURITY DEFINER + STABLE, pola sama persis dengan current_user_role()
-- lama: bypass RLS supaya policy tabel profiles/roles sendiri tidak baca
-- ulang dirinya sendiri (penyebab "infinite recursion detected" yang sudah
-- pernah diperbaiki migration 024 — pola itu dipertahankan di sini).

create function public.current_role_id()
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select role_id
  from public.profiles
  where id = auth.uid()
    and is_active = true;
$$;

comment on function public.current_role_id() is 'role_id user yang sedang login (NULL kalau tidak aktif/tidak ditemukan). Migration 028.';

create function public.current_role_level()
returns integer
language sql stable security definer
set search_path to 'public'
as $$
  select r.level
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
    and p.is_active = true;
$$;

comment on function public.current_role_level() is 'Level role user yang sedang login. Migration 028, pengganti perbandingan enum admin/supervisor manual.';

create function public.current_role_lintas_kasir()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(r.lintas_kasir, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
    and p.is_active = true;
$$;

comment on function public.current_role_lintas_kasir() is 'True kalau role user yang login boleh lihat/kelola shift & held-order kasir LAIN. Migration 028, pengganti cek admin/supervisor di pola "own_or_supervisor".';

create function public.role_level(p_role_id uuid)
returns integer
language sql stable security definer
set search_path to 'public'
as $$
  select level from public.roles where id = p_role_id;
$$;

comment on function public.role_level(uuid) is 'Level sebuah role by id — dipakai bandingkan level target vs caller di RLS profiles & RPC admin_update_user_role/admin_set_user_active. Migration 028.';

create function public.has_permission(p_key text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid()
      and p.is_active = true
      and rp.permission_key = p_key
      and rp.allowed = true
  );
$$;

comment on function public.has_permission(text) is 'True kalau role user yang login punya permission_key tsb (allowed=true di role_permissions). Inti sistem permission baru — migration 028.';

-- ── 7. RLS untuk 3 tabel baru ────────────────────────────────────────────────
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- permissions: TIDAK ADA policy sama sekali untuk role authenticated -> default
-- deny total (sesuai catatan header, katalog cuma berubah lewat migration).
-- roles & role_permissions: semua user aktif boleh BACA (perlu buat dropdown
-- pilih role, dan buat layar kelola role menampilkan checklist), tapi
-- insert/update/delete WAJIB permission 'pengaturan_role'.

create policy roles_select_active_users on public.roles
  for select to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_active = true));

create policy roles_write_pengaturan_role on public.roles
  for all to authenticated
  using (public.has_permission('pengaturan_role'))
  with check (public.has_permission('pengaturan_role'));

create policy role_permissions_select_active_users on public.role_permissions
  for select to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_active = true));

create policy role_permissions_write_pengaturan_role on public.role_permissions
  for all to authenticated
  using (public.has_permission('pengaturan_role'))
  with check (public.has_permission('pengaturan_role'));

-- ── 8. Drop semua RLS/RPC/trigger lama yang masih pakai enum user_role ──────
-- (harus di-drop dulu sebelum drop kolom `role`/type `user_role`, karena
-- semuanya mereferensikan kolom/tipe itu)

drop policy if exists categories_delete_admin_supervisor on public.categories;
drop policy if exists categories_insert_admin_supervisor on public.categories;
drop policy if exists categories_select_active_users on public.categories;
drop policy if exists categories_update_admin_supervisor on public.categories;

drop policy if exists held_orders_delete_own_or_supervisor on public.held_orders;
drop policy if exists held_orders_select_own_or_supervisor on public.held_orders;

drop policy if exists products_insert_admin_supervisor on public.products;
drop policy if exists products_select_active_users on public.products;
drop policy if exists products_update_admin_supervisor on public.products;

drop policy if exists profiles_select_admin_supervisor on public.profiles;
drop policy if exists profiles_update_admin_supervisor on public.profiles;

drop policy if exists promo_media_delete_admin_supervisor on public.promo_media;
drop policy if exists promo_media_insert_admin_supervisor on public.promo_media;
drop policy if exists promo_media_select_admin_supervisor on public.promo_media;
drop policy if exists promo_media_update_admin_supervisor on public.promo_media;

drop policy if exists promo_screens_delete_admin_supervisor on public.promo_screens;
drop policy if exists promo_screens_insert_admin_supervisor on public.promo_screens;
drop policy if exists promo_screens_select_admin_supervisor on public.promo_screens;
drop policy if exists promo_screens_update_admin_supervisor on public.promo_screens;

drop policy if exists settings_delete_admin_only on public.settings;
drop policy if exists settings_insert_admin_supervisor on public.settings;
drop policy if exists settings_update_admin_supervisor on public.settings;

drop policy if exists shift_sessions_select_own_or_supervisor on public.shift_sessions;
drop policy if exists shift_sessions_update_own_or_supervisor on public.shift_sessions;

drop policy if exists stock_movements_select_supervisor on public.stock_movements;

drop policy if exists activity_logs_select_admin_supervisor on public.activity_logs;

drop policy if exists promo_media_storage_delete on storage.objects;
drop policy if exists promo_media_storage_insert on storage.objects;

drop trigger if exists profiles_enforce_role_change on public.profiles;
drop function if exists public.enforce_profiles_role_change();
drop function if exists public.admin_update_user_role(uuid, public.user_role);
drop function if exists public.admin_set_user_active(uuid, boolean);
drop function if exists public.current_user_role();

-- ── 9. Drop kolom & enum lama ────────────────────────────────────────────────
alter table public.profiles drop column role;
drop type public.user_role;

-- ── 10. Tulis ulang RLS pakai fungsi baru ───────────────────────────────────

-- categories & products: select tetap "siapa saja user aktif", tulis pakai
-- permission 'produk' (pengganti admin_supervisor).
create policy categories_select_active_users on public.categories
  for select to authenticated
  using (public.current_role_id() is not null);

create policy categories_insert_produk on public.categories
  for insert to authenticated
  with check (public.has_permission('produk'));

create policy categories_update_produk on public.categories
  for update to authenticated
  using (public.has_permission('produk'))
  with check (public.has_permission('produk'));

create policy categories_delete_produk on public.categories
  for delete to authenticated
  using (public.has_permission('produk'));

create policy products_select_active_users on public.products
  for select to authenticated
  using (public.current_role_id() is not null);

create policy products_insert_produk on public.products
  for insert to authenticated
  with check (public.has_permission('produk'));

create policy products_update_produk on public.products
  for update to authenticated
  using (public.has_permission('produk'))
  with check (public.has_permission('produk'));

-- held_orders & shift_sessions: "own_or_supervisor" -> "own_or_lintas_kasir".
create policy held_orders_select_own_or_lintas_kasir on public.held_orders
  for select using (cashier_id = auth.uid() or public.current_role_lintas_kasir());

create policy held_orders_delete_own_or_lintas_kasir on public.held_orders
  for delete using (cashier_id = auth.uid() or public.current_role_lintas_kasir());

create policy shift_sessions_select_own_or_lintas_kasir on public.shift_sessions
  for select using (cashier_id = auth.uid() or public.current_role_lintas_kasir());

create policy shift_sessions_update_own_or_lintas_kasir on public.shift_sessions
  for update
  using (cashier_id = auth.uid() or public.current_role_lintas_kasir())
  with check (cashier_id = auth.uid() or public.current_role_lintas_kasir());

-- profiles: select & update pakai permission 'pengaturan_admin' + hierarki
-- level (pengganti "admin bebas; supervisor kecuali baris admin").
create policy profiles_select_pengaturan_admin on public.profiles
  for select to authenticated
  using (public.has_permission('pengaturan_admin'));

create policy profiles_update_pengaturan_admin on public.profiles
  for update to authenticated
  using (
    public.has_permission('pengaturan_admin')
    and public.role_level(role_id) >= public.current_role_level()
  )
  with check (
    public.has_permission('pengaturan_admin')
    and public.role_level(role_id) >= public.current_role_level()
  );

comment on policy profiles_update_pengaturan_admin on public.profiles is 'Boleh UPDATE baris user lain kalau punya permission pengaturan_admin DAN target level-nya >= level caller sendiri (tidak bisa sentuh yang levelnya lebih tinggi/lebih berwenang). Migration 028, generalisasi dari profiles_update_admin_supervisor lama.';

-- promo_media & promo_screens: pakai permission 'promo'.
create policy promo_media_select_promo on public.promo_media
  for select to authenticated using (public.has_permission('promo'));
create policy promo_media_insert_promo on public.promo_media
  for insert to authenticated with check (public.has_permission('promo'));
create policy promo_media_update_promo on public.promo_media
  for update to authenticated using (public.has_permission('promo')) with check (public.has_permission('promo'));
create policy promo_media_delete_promo on public.promo_media
  for delete to authenticated using (public.has_permission('promo'));

create policy promo_screens_select_promo on public.promo_screens
  for select to authenticated using (public.has_permission('promo'));
create policy promo_screens_insert_promo on public.promo_screens
  for insert to authenticated with check (public.has_permission('promo'));
create policy promo_screens_update_promo on public.promo_screens
  for update to authenticated using (public.has_permission('promo')) with check (public.has_permission('promo'));
create policy promo_screens_delete_promo on public.promo_screens
  for delete to authenticated using (public.has_permission('promo'));

create policy promo_media_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'promo-media' and public.has_permission('promo'));
create policy promo_media_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'promo-media' and public.has_permission('promo'));

-- settings: select tetap semua user aktif; insert/update pakai
-- 'pengaturan_toko'; delete TETAP dikunci ekstra ke level 0 saja (lihat
-- catatan header soal aksi paling sensitif).
create policy settings_insert_pengaturan_toko on public.settings
  for insert with check (public.has_permission('pengaturan_toko'));

create policy settings_update_pengaturan_toko on public.settings
  for update
  using (public.has_permission('pengaturan_toko'))
  with check (public.has_permission('pengaturan_toko'));

create policy settings_delete_level_0_only on public.settings
  for delete using (public.current_role_level() = 0);

-- stock_movements: pakai permission 'stok'.
create policy stock_movements_select_stok on public.stock_movements
  for select using (public.has_permission('stok'));

-- activity_logs: pakai permission 'log_aktivitas'.
create policy activity_logs_select_log_aktivitas on public.activity_logs
  for select using (public.has_permission('log_aktivitas'));

-- ── 11. Tulis ulang RPC & trigger yang tadinya baca enum ────────────────────

create or replace function public.adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_product RECORD;
    v_old_stock INTEGER;
    v_qty_delta INTEGER;
    v_new_stock INTEGER;
    v_movement_id UUID;
begin
    IF NOT public.has_permission('stok') THEN
        RAISE EXCEPTION 'Anda tidak punya izin untuk mengubah stok';
    END IF;

    IF p_type IS NULL OR p_type NOT IN ('opname', 'adjustment') THEN
        RAISE EXCEPTION 'Jenis mutasi manual tidak valid (hanya opname / adjustment)';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'Alasan wajib diisi untuk mutasi stok manual';
    END IF;

    IF p_value IS NULL THEN
        RAISE EXCEPTION 'Jumlah tidak boleh kosong';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produk tidak ditemukan';
    END IF;

    IF v_product.is_service = TRUE OR v_product.type = 'JASA' THEN
        RAISE EXCEPTION 'Produk "%" adalah jasa — stoknya tidak terbatas dan tidak bisa diopname', v_product.name;
    END IF;

    v_old_stock := COALESCE(v_product.stock, 0);

    IF p_type = 'opname' THEN
        IF p_value < 0 THEN
            RAISE EXCEPTION 'Hasil hitung fisik tidak boleh negatif';
        END IF;
        v_qty_delta := p_value - v_old_stock;
    ELSE
        IF p_value = 0 THEN
            RAISE EXCEPTION 'Penyesuaian 0 tidak ada artinya — isi jumlah plus atau minus';
        END IF;
        v_qty_delta := p_value;
    END IF;

    v_new_stock := v_old_stock + v_qty_delta;
    IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'Stok tidak boleh minus. Stok sekarang %, penyesuaian %', v_old_stock, v_qty_delta;
    END IF;

    IF v_qty_delta <> 0 THEN
        UPDATE products SET stock = v_new_stock, updated_at = NOW() WHERE id = p_product_id;
    END IF;

    INSERT INTO stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    VALUES (p_product_id, p_type, v_qty_delta, NULL, btrim(p_reason), auth.uid())
    RETURNING id INTO v_movement_id;

    INSERT INTO activity_logs (user_id, action, entity, entity_id, meta)
    VALUES (
        auth.uid(),
        CASE WHEN p_type = 'opname' THEN 'stock_opname' ELSE 'stock_adjustment' END,
        'product', p_product_id,
        jsonb_build_object(
            'product_name', v_product.name, 'reason', btrim(p_reason),
            'old_stock', v_old_stock, 'qty_delta', v_qty_delta,
            'new_stock', v_new_stock, 'movement_id', v_movement_id
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE, 'movement_id', v_movement_id, 'product_id', p_product_id,
        'product_name', v_product.name, 'old_stock', v_old_stock,
        'qty_delta', v_qty_delta, 'new_stock', v_new_stock
    );
EXCEPTION
    WHEN OTHERS THEN RAISE;
END;
$$;

comment on function public.adjust_stock(uuid, text, integer, text) is 'Opname/penyesuaian stok manual. Migration 028: gate diganti dari role admin/supervisor ke has_permission(''stok''). Logika stok/validasi tidak berubah.';

create or replace function public.close_shift(p_shift_id uuid, p_actual_cash bigint)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_shift RECORD;
    v_caller_id UUID;
    v_can_force_close BOOLEAN := FALSE;
    v_cash_sales BIGINT := 0;
    v_expected_cash BIGINT;
    v_difference BIGINT;
begin
    v_caller_id := auth.uid();

    IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
        RAISE EXCEPTION 'Nominal kas fisik tidak valid';
    END IF;

    SELECT * INTO v_shift FROM shift_sessions WHERE id = p_shift_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift tidak ditemukan';
    END IF;

    IF v_shift.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Shift ini sudah ditutup sebelumnya';
    END IF;

    -- Migration 028: "admin/supervisor" -> current_role_lintas_kasir()
    -- (role apa pun dengan flag lintas_kasir boleh force-close shift orang lain).
    v_can_force_close := public.current_role_lintas_kasir();

    IF v_shift.cashier_id <> v_caller_id AND NOT v_can_force_close THEN
        RAISE EXCEPTION 'Anda tidak berhak menutup shift ini';
    END IF;

    SELECT COALESCE(SUM(pay.amount), 0) INTO v_cash_sales
    FROM payments pay
    JOIN transactions t ON t.id = pay.transaction_id
    WHERE t.shift_id = p_shift_id AND pay.method = 'CASH';

    v_expected_cash := v_shift.opening_cash + v_cash_sales;
    v_difference := p_actual_cash - v_expected_cash;

    UPDATE shift_sessions
    SET status = 'CLOSED', closed_at = NOW(), actual_cash = p_actual_cash,
        expected_cash = v_expected_cash, cash_difference = v_difference
    WHERE id = p_shift_id;

    RETURN jsonb_build_object(
        'success', true, 'shift_id', p_shift_id, 'expected_cash', v_expected_cash,
        'actual_cash', p_actual_cash, 'difference', v_difference
    );
end;
$$;

comment on function public.close_shift(uuid, bigint) is 'Tutup shift kasir. Migration 028: gate force-close diganti dari role admin/supervisor ke current_role_lintas_kasir(). Logika hitung kas tidak berubah dari migration 008.';

create or replace function public.reorder_promo_media(p_ids uuid[])
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.has_permission('promo') then
    raise exception 'Anda tidak punya izin mengatur urutan media promosi.'
      using errcode = '42501';
  end if;

  update public.promo_media m
     set sort_order = t.pos::integer
    from unnest(p_ids) with ordinality as t(id, pos)
   where m.id = t.id;
end;
$$;

comment on function public.reorder_promo_media(uuid[]) is 'Migration 028: gate diganti dari role admin/supervisor ke has_permission(''promo'').';

-- admin_update_user_role & admin_set_user_active: signature berubah total
-- (p_new_role enum -> p_new_role_id uuid), jadi ini bukan CREATE OR REPLACE
-- fungsi lama (sudah di-drop di section 8), tapi fungsi baru dengan nama
-- sama. Frontend (useAdminUsers.ts) WAJIB dikinikan menyusul supaya
-- memanggil dengan role_id, bukan lagi string 'admin'/'supervisor'/dst.

create function public.admin_update_user_role(p_user_id uuid, p_new_role_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_caller_level integer;
  v_new_role_level integer;
  v_target record;
begin
  if not public.has_permission('pengaturan_admin') then
    raise exception 'Anda tidak punya izin untuk mengubah role user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa mengubah role diri sendiri — minta user lain yang berwenang melakukannya';
  end if;

  v_caller_level := public.current_role_level();

  select p.id, p.full_name, p.role_id, r.name as role_name, r.level
    into v_target
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = p_user_id
  for update of p;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  -- Generalisasi migration 018: target harus level >= level caller (tidak
  -- bisa sentuh user yang levelnya lebih tinggi/berwenang dari diri sendiri).
  if v_target.level < v_caller_level then
    raise exception 'Anda tidak bisa mengubah role user dengan level lebih tinggi dari Anda';
  end if;

  select level into v_new_role_level from public.roles where id = p_new_role_id;
  if not found then
    raise exception 'Role tujuan tidak ditemukan';
  end if;

  -- Generalisasi migration 018: tidak bisa memberi role yang levelnya lebih
  -- tinggi (lebih berwenang) dari level caller sendiri.
  if v_new_role_level < v_caller_level then
    raise exception 'Anda tidak bisa memberikan role dengan level lebih tinggi dari level Anda sendiri';
  end if;

  if v_target.role_id = p_new_role_id then
    raise exception 'User sudah memiliki role tersebut';
  end if;

  update public.profiles set role_id = p_new_role_id where id = p_user_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'user_role_change', 'user', p_user_id,
    jsonb_build_object('target_name', v_target.full_name, 'old_role', v_target.role_name, 'new_role_id', p_new_role_id)
  );

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'new_role_id', p_new_role_id);
end;
$$;

comment on function public.admin_update_user_role(uuid, uuid) is 'Ubah role user. Migration 028: role sekarang uuid dinamis (bukan enum), gate & hierarki pakai has_permission(''pengaturan_admin'') + perbandingan level, generalisasi dari migration 018.';

create function public.admin_set_user_active(p_user_id uuid, p_is_active boolean)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_caller_level integer;
  v_target record;
begin
  if not public.has_permission('pengaturan_admin') then
    raise exception 'Anda tidak punya izin untuk mengubah status user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa menonaktifkan diri sendiri — minta user lain yang berwenang melakukannya';
  end if;

  v_caller_level := public.current_role_level();

  select p.id, p.full_name, p.is_active, r.level
    into v_target
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = p_user_id
  for update of p;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  if v_target.level < v_caller_level then
    raise exception 'Anda tidak bisa mengubah status user dengan level lebih tinggi dari Anda';
  end if;

  if v_target.is_active = p_is_active then
    raise exception 'User sudah dalam status tersebut';
  end if;

  update public.profiles set is_active = p_is_active where id = p_user_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(),
    case when p_is_active then 'user_activate' else 'user_deactivate' end,
    'user', p_user_id,
    jsonb_build_object('target_name', v_target.full_name)
  );

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'is_active', p_is_active);
end;
$$;

comment on function public.admin_set_user_active(uuid, boolean) is 'Aktifkan/nonaktifkan user. Migration 028: gate & hierarki pakai has_permission(''pengaturan_admin'') + perbandingan level, generalisasi dari migration 018.';

-- Trigger pengaman langsung di tabel profiles (defense in depth, sama pola
-- dengan migration 018/020) — jaga-jaga kalau ada yang UPDATE profiles.role_id
-- / is_active langsung (bukan lewat RPC di atas).
create function public.enforce_profiles_role_change()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_caller_level integer;
  v_old_level integer;
  v_new_level integer;
begin
  if new.role_id = old.role_id and new.is_active = old.is_active then
    return new;
  end if;

  if not public.has_permission('pengaturan_admin') then
    raise exception 'Anda tidak punya izin mengubah role atau status aktif user';
  end if;

  v_caller_level := public.current_role_level();
  select level into v_old_level from public.roles where id = old.role_id;
  select level into v_new_level from public.roles where id = new.role_id;

  if v_old_level < v_caller_level then
    raise exception 'Tidak bisa mengubah user dengan level lebih tinggi dari Anda';
  end if;

  if v_new_level < v_caller_level then
    raise exception 'Tidak bisa memberikan role dengan level lebih tinggi dari level Anda sendiri';
  end if;

  return new;
end;
$$;

comment on function public.enforce_profiles_role_change() is 'Migration 028: pengaman UPDATE langsung ke profiles.role_id/is_active, generalisasi dari migration 018 pakai has_permission + level (bukan lagi cek enum admin/supervisor).';

create trigger profiles_enforce_role_change
  before update on public.profiles
  for each row execute function public.enforce_profiles_role_change();

-- ── 12. Pengaman struktural tabel roles (jangan sampai terkunci total) ──────
create function public.protect_role_mutation()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'Role bawaan sistem (%) tidak bisa dihapus.', old.name;
    end if;
    if exists (select 1 from public.profiles where role_id = old.id) then
      raise exception 'Role "%" masih dipakai user — pindahkan user itu ke role lain dulu.', old.name;
    end if;
    if old.level = 0 and (select count(*) from public.roles where level = 0) <= 1 then
      raise exception 'Tidak bisa menghapus satu-satunya role dengan level 0 (level tertinggi) — akan ada risiko tidak ada yang bisa mengelola sistem lagi.';
    end if;
    return old;
  end if;

  -- UPDATE: cegah level SATU-SATUNYA role level 0 diubah jadi bukan 0.
  if tg_op = 'UPDATE' and old.level = 0 and new.level <> 0
     and (select count(*) from public.roles where level = 0) <= 1 then
    raise exception 'Tidak bisa mengubah level satu-satunya role level 0 (level tertinggi) — akan ada risiko tidak ada yang bisa mengelola sistem lagi.';
  end if;

  return new;
end;
$$;

comment on function public.protect_role_mutation() is 'Migration 028: cegah role bawaan dihapus, role yang masih dipakai user dihapus, dan cegah sistem kehabisan role level 0 sama sekali (lock-out).';

create trigger roles_protect_mutation
  before update or delete on public.roles
  for each row execute function public.protect_role_mutation();

commit;
