-- 031_granular_role_permissions.sql
-- ── FITUR BARU ── Permission per role dipecah jadi 4 aksi granular (Lihat/
-- Tambah/Ubah/Hapus) per menu, menggantikan model lama migration 028 yang
-- cuma satu flag `allowed` (all-or-nothing) per menu. Ini database counterpart
-- dari redesain tab Pengaturan > Role (PengaturanRoleTab.tsx menyusul di
-- langkah frontend terpisah): sekarang checklist permission dikelompokkan
-- sesuai grup sidebar, per menu ditampilkan sebagai card dengan tombol
-- centang Lihat/Tambah/Ubah/Hapus — TAPI tombol yang muncul cuma yang
-- relevan buat menu itu (mis. Laporan cuma "Lihat", Produk dapat keempatnya).
--
-- KEPUTUSAN DESAIN KUNCI:
-- - Katalog `permissions` (10+1 menu tetap, lihat migration 028/030) dapat 3
--   kolom baru `supports_create/supports_edit/supports_delete` — metadata
--   TETAP (bukan per-role) yang menandai aksi CRUD apa yang SECARA NYATA ada
--   di menu itu. "Lihat" tidak perlu kolom sendiri (implisit selalu ada untuk
--   semua menu — tanpa "Lihat" menu itu tidak berarti apa-apa).
-- - `role_permissions.allowed` (boolean tunggal) diganti 4 boolean:
--   `can_view/can_create/can_edit/can_delete`. ATURAN INTI (dipaksa lewat
--   constraint + fungsi has_permission_action di bawah): can_create/edit/
--   delete TIDAK BERARTI APA-APA kalau can_view=false — butuh akses lihat
--   dulu baru aksi lain masuk akal, sama seperti tidak mungkin bisa
--   menghapus produk dari menu yang tidak bisa dibuka sama sekali.
-- - Backfill dari data lama: baris existing SEMUA `allowed=true` (lihat
--   catatan migration 028 — tidak ada baris untuk yang ditolak). Supaya TIDAK
--   ADA user yang tiba-tiba kehilangan akses cuma gara-gara migration ini,
--   baris lama di-backfill ke akses PENUH sesuai kapasitas menu tsb
--   (can_view=true + semua can_create/edit/delete yang relevan ikut true).
--   Pemilik project bisa mempersempit manual lewat UI baru setelah ini,
--   tapi tidak ada yang otomatis dikunci mendadak oleh migration ini sendiri.
--
-- PEMETAAN aksi granular -> gate lama di kode (RLS & RPC ditulis ulang di
-- bagian bawah migration ini SAMA PERSIS urutannya dengan pemetaan berikut):
--   produk  : view (select) / create (insert kategori&produk) / edit (update
--             kategori&produk) / delete (soft_delete_product — LIHAT CATATAN
--             KHUSUS di bawah, ini satu-satunya penyimpangan sengaja dari
--             perilaku lama).
--   stok    : view (select stock_movements) / edit (RPC adjust_stock, opname
--             & penyesuaian manual — tidak ada create/delete terpisah, opname
--             menaikkan ATAU menurunkan stok lewat aksi yang sama).
--   promo   : view/create/edit/delete penuh untuk promo_media & promo_screens
--             + storage bucket promo-media (persis migration 028, cuma
--             pecah 1 flag jadi 4).
--   laporan : view saja (tidak ada mutasi sama sekali dari menu ini).
--   sampah  : view (lihat daftar sampah) / edit (RPC restore_product &
--             restore_transaction — "pulihkan" diperlakukan sebagai Ubah,
--             bukan Tambah/Hapus). TIDAK ADA aksi hapus permanen di kode
--             sekarang (belum ada fitur purge), jadi sampah TIDAK dapat
--             `supports_delete`.
--   log_aktivitas / kasir : view saja (kasir belum dipakai gate apa pun di
--             kode, lihat catatan migration 028 — tetap dipertahankan
--             sebagai view-only, tidak diperluas di migration ini).
--   retur_void : TIDAK diperlakukan sebagai satu tombol gabungan lagi.
--             "Tambah" = retur (return_transaction, bikin baris transaksi
--             RETURN baru — analog "membuat" catatan baru) dan "Hapus" =
--             void (void_transaction, membatalkan/mematikan transaksi PAID
--             — analog "menghapus" keabsahannya). Sengaja TIDAK dapat "Ubah"
--             (tidak ada aksi edit-transaksi-yang-sudah-PAID di kode).
--   pengaturan_toko  : view / edit (settings cuma 1 baris, upsert — insert
--             DIPERLAKUKAN SAMA dengan edit, tidak ada "Tambah" tersendiri
--             karena tidak ada UI untuk bikin baris settings kedua).
--   pengaturan_admin : view / create (tambah user baru, lewat
--             app/api/admin/create-user — endpoint itu pakai service role,
--             TIDAK lewat RLS tabel profiles, jadi tidak ada policy yang
--             perlu ditulis ulang untuk create di sini, cukup dicatat di
--             checklist UI) / edit (admin_update_user_role &
--             admin_set_user_active — ubah role/aktifkan/nonaktifkan). TIDAK
--             ADA "Hapus" (user tidak pernah dihapus permanen, cuma
--             dinonaktifkan = edit).
--   pengaturan_role  : view/create/edit/delete penuh (persis kapasitas
--             CRUD role yang sudah ada di hooks/useRoles.ts).
--
-- ── CATATAN KHUSUS: soft_delete_product ──────────────────────────────────
-- Migration 030 menggate RPC ini ke has_permission('sampah'), TAPI
-- ProdukModule.tsx (frontend) dari awal menampilkan tombol Hapus produk
-- berdasarkan permission 'produk' (`canDeleteProduct = canManageProducts`,
-- baris 85), BUKAN 'sampah' — jadi sebelum migration ini ADA MISMATCH: tombol
-- Hapus produk bisa tampil untuk role yang punya 'produk' tapi tidak punya
-- 'sampah', lalu RPC-nya ditolak. Migration ini SENGAJA memperbaiki
-- ketidaksesuaian itu: soft_delete_product sekarang gate ke
-- has_permission_action('produk', 'delete') — menghapus produk (memindah ke
-- Sampah) adalah aksi milik menu Produk, konsisten dengan card "Produk" di
-- UI baru yang punya tombol Hapus sendiri. Menu Sampah sendiri cuma mengurus
-- PEMULIHAN (restore), bukan proses menghapusnya. restore_product/
-- restore_transaction TETAP di has_permission('sampah') seperti semula
-- (cuma pindah ke aksi 'edit'). soft_delete_transaction (RPC ada sejak
-- migration 015 tapi TIDAK ADA pemanggilnya di frontend manapun sampai saat
-- ini — dicek ulang saat menulis migration ini) tetap di has_permission_action
-- ('sampah','edit') apa adanya, karena belum ada keputusan produk mana menu
-- yang akan memilikinya nanti (menyusul kalau fiturnya benar-benar dibangun).

begin;

-- ── 1. Katalog: tandai aksi CRUD yang SECARA NYATA ada di tiap menu ────────
alter table public.permissions
  add column supports_create boolean not null default false,
  add column supports_edit   boolean not null default false,
  add column supports_delete boolean not null default false;

comment on column public.permissions.supports_create is 'True kalau menu ini punya aksi "Tambah" yang nyata di kode (dipakai UI checklist buat menentukan tombol mana yang muncul). Migration 031.';
comment on column public.permissions.supports_edit is 'True kalau menu ini punya aksi "Ubah" yang nyata di kode. Migration 031.';
comment on column public.permissions.supports_delete is 'True kalau menu ini punya aksi "Hapus" yang nyata di kode. Migration 031.';

update public.permissions set supports_create = true, supports_edit = true, supports_delete = true where key = 'produk';
update public.permissions set supports_edit = true where key = 'stok';
update public.permissions set supports_create = true, supports_edit = true, supports_delete = true where key = 'promo';
update public.permissions set supports_edit = true where key = 'sampah';
update public.permissions set supports_create = true, supports_delete = true where key = 'retur_void';
update public.permissions set supports_edit = true where key = 'pengaturan_toko';
update public.permissions set supports_create = true, supports_edit = true where key = 'pengaturan_admin';
update public.permissions set supports_create = true, supports_edit = true, supports_delete = true where key = 'pengaturan_role';
-- kasir, laporan, log_aktivitas: sengaja tidak disentuh (tetap view-only,
-- ketiga kolom baru default false).

-- ── 2. role_permissions: pecah `allowed` jadi 4 flag granular ─────────────
alter table public.role_permissions
  add column can_view   boolean not null default false,
  add column can_create boolean not null default false,
  add column can_edit   boolean not null default false,
  add column can_delete boolean not null default false;

-- Backfill: SEMUA baris lama pasti allowed=true (lihat catatan header
-- migration 028). Beri akses PENUH sesuai kapasitas menu (supports_*) supaya
-- tidak ada user yang mendadak kehilangan akses gara-gara migration ini.
update public.role_permissions rp
set can_view   = true,
    can_create = p.supports_create,
    can_edit   = p.supports_edit,
    can_delete = p.supports_delete
from public.permissions p
where p.key = rp.permission_key
  and rp.allowed = true;

alter table public.role_permissions
  add constraint role_permissions_view_required
  check (can_view or not (can_create or can_edit or can_delete));

comment on constraint role_permissions_view_required on public.role_permissions is 'Migration 031: can_create/edit/delete tidak boleh true kalau can_view false — tidak masuk akal bisa mengubah/menghapus dari menu yang tidak bisa dibuka sama sekali.';

alter table public.role_permissions drop column allowed;

comment on table public.role_permissions is 'Baris cuma ditulis untuk kombinasi role+permission yang punya MINIMAL can_view=true (migration 031, generalisasi dari allowed=true migration 028) — tidak ada baris berarti otomatis ditolak semua aksi.';

-- ── 3. Fungsi pengecekan: has_permission (lama, tetap ada) + fungsi baru ──
-- has_permission(key) DIPERTAHANKAN (dipakai tempat yang cuma butuh cek akses
-- dasar/Lihat, mis. filter menu Sidebar) — sekarang baca can_view, bukan
-- allowed, TAPI SIGNATURE & PERILAKU DASARNYA SAMA (backward compatible,
-- tidak perlu ganti semua caller lama sekaligus).
create or replace function public.has_permission(p_key text)
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
      and rp.can_view = true
  );
$$;

comment on function public.has_permission(text) is 'True kalau role user login punya can_view=true untuk permission_key tsb. Migration 031: baca kolom can_view (pecahan granular), pengganti allowed tunggal migration 028 — signature & arti dasarnya (akses Lihat) tidak berubah.';

create function public.has_permission_action(p_key text, p_action text)
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
      and rp.can_view = true
      and case p_action
            when 'view'   then true
            when 'create' then rp.can_create
            when 'edit'   then rp.can_edit
            when 'delete' then rp.can_delete
            else false
          end
  );
$$;

comment on function public.has_permission_action(text, text) is 'Migration 031: cek aksi granular (''view''/''create''/''edit''/''delete'') untuk permission_key tsb. Selalu mensyaratkan can_view=true dulu (lihat constraint role_permissions_view_required) — p_action di luar 4 nilai itu selalu false (fail-closed untuk salah ketik/typo aksi).';

-- ── 4. Tulis ulang RLS yang tadinya pakai has_permission('produk'/'promo') ──
-- untuk insert/update/delete supaya pakai aksi granular yang sesuai. SELECT
-- yang sebelumnya sudah "semua user aktif" (categories/products) TIDAK
-- disentuh — permission 'produk' tidak pernah menggate SELECT-nya, cuma
-- mutasi (lihat migration 028).

drop policy if exists categories_insert_produk on public.categories;
create policy categories_insert_produk on public.categories
  for insert to authenticated
  with check (public.has_permission_action('produk', 'create'));

drop policy if exists categories_update_produk on public.categories;
create policy categories_update_produk on public.categories
  for update to authenticated
  using (public.has_permission_action('produk', 'edit'))
  with check (public.has_permission_action('produk', 'edit'));

drop policy if exists categories_delete_produk on public.categories;
create policy categories_delete_produk on public.categories
  for delete to authenticated
  using (public.has_permission_action('produk', 'delete'));

drop policy if exists products_insert_produk on public.products;
create policy products_insert_produk on public.products
  for insert to authenticated
  with check (public.has_permission_action('produk', 'create'));

drop policy if exists products_update_produk on public.products;
create policy products_update_produk on public.products
  for update to authenticated
  using (public.has_permission_action('produk', 'edit'))
  with check (public.has_permission_action('produk', 'edit'));

-- promo_media & promo_screens: select juga ikut permission ini (beda dari
-- categories/products di atas), jadi SELECT-nya pun diganti aksi 'view'.
drop policy if exists promo_media_select_promo on public.promo_media;
create policy promo_media_select_promo on public.promo_media
  for select to authenticated using (public.has_permission_action('promo', 'view'));
drop policy if exists promo_media_insert_promo on public.promo_media;
create policy promo_media_insert_promo on public.promo_media
  for insert to authenticated with check (public.has_permission_action('promo', 'create'));
drop policy if exists promo_media_update_promo on public.promo_media;
create policy promo_media_update_promo on public.promo_media
  for update to authenticated
  using (public.has_permission_action('promo', 'edit'))
  with check (public.has_permission_action('promo', 'edit'));
drop policy if exists promo_media_delete_promo on public.promo_media;
create policy promo_media_delete_promo on public.promo_media
  for delete to authenticated using (public.has_permission_action('promo', 'delete'));

drop policy if exists promo_screens_select_promo on public.promo_screens;
create policy promo_screens_select_promo on public.promo_screens
  for select to authenticated using (public.has_permission_action('promo', 'view'));
drop policy if exists promo_screens_insert_promo on public.promo_screens;
create policy promo_screens_insert_promo on public.promo_screens
  for insert to authenticated with check (public.has_permission_action('promo', 'create'));
drop policy if exists promo_screens_update_promo on public.promo_screens;
create policy promo_screens_update_promo on public.promo_screens
  for update to authenticated
  using (public.has_permission_action('promo', 'edit'))
  with check (public.has_permission_action('promo', 'edit'));
drop policy if exists promo_screens_delete_promo on public.promo_screens;
create policy promo_screens_delete_promo on public.promo_screens
  for delete to authenticated using (public.has_permission_action('promo', 'delete'));

drop policy if exists promo_media_storage_insert on storage.objects;
create policy promo_media_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'promo-media' and public.has_permission_action('promo', 'create'));
drop policy if exists promo_media_storage_delete on storage.objects;
create policy promo_media_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'promo-media' and public.has_permission_action('promo', 'delete'));

-- profiles: select -> 'view', update -> 'edit' (hierarki level tetap sama).
drop policy if exists profiles_select_pengaturan_admin on public.profiles;
create policy profiles_select_pengaturan_admin on public.profiles
  for select to authenticated
  using (public.has_permission_action('pengaturan_admin', 'view'));

drop policy if exists profiles_update_pengaturan_admin on public.profiles;
create policy profiles_update_pengaturan_admin on public.profiles
  for update to authenticated
  using (
    public.has_permission_action('pengaturan_admin', 'edit')
    and public.role_level(role_id) >= public.current_role_level()
  )
  with check (
    public.has_permission_action('pengaturan_admin', 'edit')
    and public.role_level(role_id) >= public.current_role_level()
  );

comment on policy profiles_update_pengaturan_admin on public.profiles is 'Migration 031: aksi ''edit'' (pecahan granular dari pengaturan_admin), bukan lagi allowed tunggal. Syarat hierarki level tidak berubah dari migration 028.';

-- settings: insert & update SAMA-SAMA pakai aksi 'edit' (lihat catatan
-- header — settings cuma 1 baris, tidak ada "Tambah" tersendiri). delete
-- TETAP dikunci level 0 saja, tidak disentuh (bukan bagian sistem permission
-- granular ini, lihat catatan migration 028).
drop policy if exists settings_insert_pengaturan_toko on public.settings;
create policy settings_insert_pengaturan_toko on public.settings
  for insert with check (public.has_permission_action('pengaturan_toko', 'edit'));

drop policy if exists settings_update_pengaturan_toko on public.settings;
create policy settings_update_pengaturan_toko on public.settings
  for update
  using (public.has_permission_action('pengaturan_toko', 'edit'))
  with check (public.has_permission_action('pengaturan_toko', 'edit'));

-- stock_movements & activity_logs: select -> 'view'.
drop policy if exists stock_movements_select_stok on public.stock_movements;
create policy stock_movements_select_stok on public.stock_movements
  for select using (public.has_permission_action('stok', 'view'));

drop policy if exists activity_logs_select_log_aktivitas on public.activity_logs;
create policy activity_logs_select_log_aktivitas on public.activity_logs
  for select using (public.has_permission_action('log_aktivitas', 'view'));

-- ── 5. Tulis ulang RPC yang tadinya pakai has_permission(key) tunggal ──────
-- Isi logika bisnis SEMUA fungsi di bawah DISALIN APA ADANYA dari versi
-- sebelumnya (migration 028/030) — HANYA baris pengecekan permission yang
-- diganti ke has_permission_action dengan aksi yang sesuai (lihat pemetaan
-- di komentar header migration ini).

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
    IF NOT public.has_permission_action('stok', 'edit') THEN
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

comment on function public.adjust_stock(uuid, text, integer, text) is 'Opname/penyesuaian stok manual. Migration 031: gate diganti ke has_permission_action(''stok'',''edit'') (pecahan granular dari has_permission(''stok'') migration 028). Logika stok/validasi tidak berubah.';

create or replace function public.reorder_promo_media(p_ids uuid[])
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.has_permission_action('promo', 'edit') then
    raise exception 'Anda tidak punya izin mengatur urutan media promosi.'
      using errcode = '42501';
  end if;

  update public.promo_media m
     set sort_order = t.pos::integer
    from unnest(p_ids) with ordinality as t(id, pos)
   where m.id = t.id;
end;
$$;

comment on function public.reorder_promo_media(uuid[]) is 'Migration 031: gate diganti ke has_permission_action(''promo'',''edit'') (mengurutkan ulang adalah bentuk "ubah", bukan tambah/hapus).';

create or replace function public.admin_update_user_role(p_user_id uuid, p_new_role_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_caller_level integer;
  v_new_role_level integer;
  v_target record;
begin
  if not public.has_permission_action('pengaturan_admin', 'edit') then
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

  if v_target.level < v_caller_level then
    raise exception 'Anda tidak bisa mengubah role user dengan level lebih tinggi dari Anda';
  end if;

  select level into v_new_role_level from public.roles where id = p_new_role_id;
  if not found then
    raise exception 'Role tujuan tidak ditemukan';
  end if;

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

comment on function public.admin_update_user_role(uuid, uuid) is 'Ubah role user. Migration 031: gate diganti ke has_permission_action(''pengaturan_admin'',''edit''). Hierarki level tidak berubah.';

create or replace function public.admin_set_user_active(p_user_id uuid, p_is_active boolean)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_caller_level integer;
  v_target record;
begin
  if not public.has_permission_action('pengaturan_admin', 'edit') then
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

comment on function public.admin_set_user_active(uuid, boolean) is 'Aktifkan/nonaktifkan user. Migration 031: gate diganti ke has_permission_action(''pengaturan_admin'',''edit'').';

create or replace function public.void_transaction(
  p_transaction_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status public.transaction_status;
  v_item record;
begin
  if not public.has_permission_action('retur_void', 'delete') then
    raise exception 'Anda tidak punya izin untuk void transaksi';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Alasan void wajib diisi';
  end if;

  select status into v_status
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_status <> 'PAID' then
    raise exception 'Hanya transaksi berstatus PAID yang bisa di-void';
  end if;

  for v_item in
    select product_id, (qty - returned_qty) as remaining_qty
    from public.transaction_items
    where transaction_id = p_transaction_id
  loop
    if v_item.product_id is not null and v_item.remaining_qty > 0 then
      update public.products
      set stock = stock + v_item.remaining_qty, updated_at = now()
      where id = v_item.product_id and is_service = false;

      insert into public.stock_movements (
        product_id, type, qty_delta, reference_id, reason, created_by
      )
      values (
        v_item.product_id, 'void', v_item.remaining_qty, p_transaction_id, p_reason, auth.uid()
      );
    end if;
  end loop;

  update public.transactions
  set status = 'VOID', void_reason = p_reason, updated_at = now()
  where id = p_transaction_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'void_transaction', 'transaction', p_transaction_id,
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id
  );
end;
$function$;

comment on function public.void_transaction(uuid, text) is 'Void transaksi PAID. Migration 031: gate diganti ke has_permission_action(''retur_void'',''delete'') — void diperlakukan sebagai aksi "Hapus" (membatalkan keabsahan transaksi), pecahan granular dari has_permission(''retur_void'') migration 030.';

create or replace function public.return_transaction(
  p_transaction_id uuid,
  p_items jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status public.transaction_status;
  v_item jsonb;
  v_ti record;
  v_qty integer;
  v_refund_total bigint := 0;
  v_line_refund bigint;
  v_return_id uuid;
  v_sequence bigint;
  v_receipt_no text;
begin
  if not public.has_permission_action('retur_void', 'create') then
    raise exception 'Anda tidak punya izin untuk retur transaksi';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Alasan retur wajib diisi';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
  then
    raise exception 'Pilih minimal 1 item untuk diretur';
  end if;

  select status into v_status
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_status <> 'PAID' then
    raise exception 'Hanya transaksi berstatus PAID yang bisa diretur';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    select id, product_id, qty, subtotal, returned_qty
    into v_ti
    from public.transaction_items
    where id = (v_item->>'transaction_item_id')::uuid
      and transaction_id = p_transaction_id
    for update;

    if not found then
      raise exception 'Item transaksi tidak ditemukan: %', v_item->>'transaction_item_id';
    end if;

    v_qty := (v_item->>'qty')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Qty retur tidak valid untuk item %', v_ti.id;
    end if;

    if v_ti.returned_qty + v_qty > v_ti.qty then
      raise exception 'Qty retur melebihi sisa qty yang bisa diretur untuk item %', v_ti.id;
    end if;

    v_line_refund := round((v_ti.subtotal::numeric / v_ti.qty) * v_qty);
    v_refund_total := v_refund_total + v_line_refund;

    update public.transaction_items
    set returned_qty = returned_qty + v_qty
    where id = v_ti.id;

    if v_ti.product_id is not null then
      update public.products
      set stock = stock + v_qty, updated_at = now()
      where id = v_ti.product_id and is_service = false;

      insert into public.stock_movements (
        product_id, type, qty_delta, reference_id, reason, created_by
      )
      values (
        v_ti.product_id, 'return', v_qty, p_transaction_id, p_reason, auth.uid()
      );
    end if;
  end loop;

  select coalesce(max(split_part(receipt_no, '/', 4)::bigint), 0) + 1
  into v_sequence
  from public.transactions
  where receipt_no like
    'LCO-RTR/' || to_char(now(), 'YY') || '/' || to_char(now(), 'MM') || '/%';

  v_receipt_no :=
    'LCO-RTR/' || to_char(now(), 'YY') || '/' || to_char(now(), 'MM')
    || '/' || lpad(v_sequence::text, 6, '0');

  insert into public.transactions (
    receipt_no, status, subtotal, discount, tax, total,
    cashier_id, void_reason, related_transaction_id
  )
  values (
    v_receipt_no, 'RETURN', v_refund_total, 0, 0, -v_refund_total,
    auth.uid(), p_reason, p_transaction_id
  )
  returning id into v_return_id;

  update public.transactions
  set status = 'RETURN', updated_at = now()
  where id = p_transaction_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'return_transaction', 'transaction', p_transaction_id,
    jsonb_build_object(
      'reason', p_reason,
      'return_transaction_id', v_return_id,
      'refund_amount', v_refund_total
    )
  );

  return jsonb_build_object(
    'success', true,
    'return_transaction_id', v_return_id,
    'receipt_no', v_receipt_no,
    'refund_amount', v_refund_total
  );
end;
$function$;

comment on function public.return_transaction(uuid, jsonb, text) is 'Retur sebagian/total transaksi PAID. Migration 031: gate diganti ke has_permission_action(''retur_void'',''create'') — retur diperlakukan sebagai aksi "Tambah" (membuat baris transaksi RETURN baru), pecahan granular dari has_permission(''retur_void'') migration 030.';

create or replace function public.soft_delete_product(
  p_product_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_product record;
begin
  if not public.has_permission_action('produk', 'delete') then
    raise exception 'Anda tidak punya izin untuk menghapus produk';
  end if;

  select id, name, deleted_at into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Produk tidak ditemukan';
  end if;

  if v_product.deleted_at is not null then
    raise exception 'Produk sudah ada di Sampah';
  end if;

  update public.products
  set deleted_at = now(), updated_at = now()
  where id = p_product_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'product_delete', 'product', p_product_id,
    jsonb_build_object('product_name', v_product.name, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('success', true, 'product_id', p_product_id);
end;
$function$;

comment on function public.soft_delete_product(uuid, text) is 'Soft-delete produk (isi deleted_at). Migration 031: gate DIPINDAH dari has_permission(''sampah'') ke has_permission_action(''produk'',''delete'') — lihat CATATAN KHUSUS di header migration ini soal mismatch frontend/backend yang diperbaiki di sini. Logika lain tidak berubah dari migration 030.';

create or replace function public.restore_product(
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_product record;
begin
  if not public.has_permission_action('sampah', 'edit') then
    raise exception 'Anda tidak punya izin untuk memulihkan produk';
  end if;

  select id, name, deleted_at into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Produk tidak ditemukan';
  end if;

  if v_product.deleted_at is null then
    raise exception 'Produk tidak sedang ada di Sampah';
  end if;

  update public.products
  set deleted_at = null, updated_at = now()
  where id = p_product_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'product_restore', 'product', p_product_id,
    jsonb_build_object('product_name', v_product.name)
  );

  return jsonb_build_object('success', true, 'product_id', p_product_id);
end;
$function$;

comment on function public.restore_product(uuid) is 'Pulihkan produk dari Sampah. Migration 031: gate diganti ke has_permission_action(''sampah'',''edit'') — pemulihan diperlakukan sebagai aksi "Ubah" menu Sampah (pecahan granular dari has_permission(''sampah'') migration 030).';

create or replace function public.soft_delete_transaction(
  p_transaction_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx record;
begin
  -- Belum ada pemanggil di frontend manapun sampai migration ini ditulis
  -- (dicek ulang, lihat catatan header) — tetap digate ke aksi 'edit' menu
  -- Sampah (sama dengan restore_*) sampai ada keputusan produk menu mana
  -- yang akan memilikinya kalau fiturnya benar-benar dibangun nanti.
  if not public.has_permission_action('sampah', 'edit') then
    raise exception 'Anda tidak punya izin untuk menghapus transaksi';
  end if;

  select id, receipt_no, deleted_at into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_tx.deleted_at is not null then
    raise exception 'Transaksi sudah ada di Sampah';
  end if;

  update public.transactions
  set deleted_at = now(), updated_at = now()
  where id = p_transaction_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'transaction_delete', 'transaction', p_transaction_id,
    jsonb_build_object('receipt_no', v_tx.receipt_no, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('success', true, 'transaction_id', p_transaction_id);
end;
$function$;

comment on function public.soft_delete_transaction(uuid, text) is 'Soft-delete transaksi. Migration 031: gate diganti ke has_permission_action(''sampah'',''edit'') apa adanya (lihat catatan di badan fungsi) — belum ada pemanggil di frontend.';

create or replace function public.restore_transaction(
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx record;
begin
  if not public.has_permission_action('sampah', 'edit') then
    raise exception 'Anda tidak punya izin untuk memulihkan transaksi';
  end if;

  select id, receipt_no, deleted_at into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_tx.deleted_at is null then
    raise exception 'Transaksi tidak sedang ada di Sampah';
  end if;

  update public.transactions
  set deleted_at = null, updated_at = now()
  where id = p_transaction_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'transaction_restore', 'transaction', p_transaction_id,
    jsonb_build_object('receipt_no', v_tx.receipt_no)
  );

  return jsonb_build_object('success', true, 'transaction_id', p_transaction_id);
end;
$function$;

comment on function public.restore_transaction(uuid) is 'Pulihkan transaksi dari Sampah. Migration 031: gate diganti ke has_permission_action(''sampah'',''edit'') (pecahan granular dari has_permission(''sampah'') migration 030).';

-- Trigger pengaman langsung di tabel profiles (defense in depth, migration
-- 028) — ikut diupdate ke aksi granular 'edit' supaya konsisten dengan RLS
-- profiles_update_pengaturan_admin di atas (kedua-duanya harus sepakat,
-- kalau tidak trigger ini bisa lebih longgar/ketat dari RLS-nya sendiri).
create or replace function public.enforce_profiles_role_change()
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

  if not public.has_permission_action('pengaturan_admin', 'edit') then
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

comment on function public.enforce_profiles_role_change() is 'Migration 031: gate diganti ke has_permission_action(''pengaturan_admin'',''edit''), konsisten dengan RLS profiles_update_pengaturan_admin. Logika hierarki level tidak berubah dari migration 028.';

commit;
