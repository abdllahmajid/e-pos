-- Migration 041: Opname stok berbentuk SESI (perbaikan menu Stok & Opname, Fase 2)
--
-- Alur: mulai sesi (draft) -> hitung / scan banyak produk -> tinjau selisih ->
--       selesaikan (selisih diterapkan ke stok sekaligus) atau batalkan.
--
-- Isi:
--   1. Tabel  stock_opname_sessions  — satu baris per sesi.
--   2. Tabel  stock_opname_items     — satu baris per produk dalam sesi.
--   3. View   stock_opname_session_stats — sesi + progres & total selisih.
--   4. RPC    start_stock_opname / save_opname_count / finalize_stock_opname /
--             cancel_stock_opname (semua security definer, izin dicek di dalam).
--
-- Tidak menyentuh adjust_stock, create_transaction, return/void_transaction.
-- Penerapan selisih memakai pola yang sama dengan adjust_stock: ubah
-- products.stock + tulis stock_movements (type 'opname') dalam satu transaksi DB.
--
-- ============================================================================
-- KEPUTUSAN DESAIN: kenapa selisih BUKAN "hitung fisik - stok saat sesi dimulai"
-- ============================================================================
-- Selama sesi berjalan toko tetap berjualan. Dua kemungkinan yang harus benar:
--   (a) produk terjual SEBELUM dihitung  -> fisik di rak sudah berkurang;
--   (b) produk terjual SESUDAH dihitung  -> stok sistem berkurang, hitungan lama
--       tidak boleh menimpanya.
-- Karena itu tiap kali hitungan disimpan, sistem mencatat `system_qty` = stok
-- sistem PADA SAAT ITU. Selisih = counted_qty - system_qty, dan saat sesi
-- diselesaikan selisih itu DITAMBAHKAN ke stok sekarang (bukan menimpanya):
--     stok baru = stok sekarang + (counted_qty - system_qty)
-- Contoh: sistem 10, dihitung 8 (selisih -2), lalu terjual 3 -> stok sekarang 7
-- -> hasil 5. Contoh lain: terjual 4 sebelum dihitung (sistem 6), fisik 6 ->
-- selisih 0 -> stok tetap 6 (penjualan tidak dihitung dua kali).
-- Produk yang belum dihitung TIDAK diubah.
--
-- Satu produk hanya boleh ada di satu sesi berjalan pada satu waktu (dicek saat
-- sesi dimulai), supaya dua sesi tidak menerapkan koreksi ganda.
-- ============================================================================

-- --------------------------------------------------------
-- 1. Tabel
-- --------------------------------------------------------

create table if not exists public.stock_opname_sessions (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  category_name text,
  status text not null default 'draft'
    check (status in ('draft', 'completed', 'cancelled')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  finalized_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text
);

create unique index if not exists stock_opname_sessions_number_key
  on public.stock_opname_sessions (number);
create index if not exists stock_opname_sessions_status_idx
  on public.stock_opname_sessions (status, created_at desc);

comment on table public.stock_opname_sessions is
  'Sesi opname stok (Fase 2). status: draft = sedang menghitung, completed = selisih sudah diterapkan ke stok, cancelled = dibatalkan (stok tidak berubah).';

create table if not exists public.stock_opname_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.stock_opname_sessions(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_sku text,
  product_barcode text,
  product_unit text,
  cost_price bigint,
  system_qty integer not null,
  counted_qty integer check (counted_qty is null or counted_qty >= 0),
  note text,
  counted_by uuid references public.profiles(id) on delete set null,
  counted_at timestamptz,
  applied_delta integer,
  movement_id uuid,
  unique (session_id, product_id)
);

create index if not exists stock_opname_items_session_idx
  on public.stock_opname_items (session_id);
create index if not exists stock_opname_items_product_idx
  on public.stock_opname_items (product_id);

comment on table public.stock_opname_items is
  'Produk dalam sesi opname. system_qty = stok sistem pada saat hitungan terakhir disimpan (atau saat sesi dimulai kalau belum dihitung); counted_qty NULL = belum dihitung. Nama/SKU/barcode/satuan/harga modal disalin (snapshot) saat sesi dimulai.';
comment on column public.stock_opname_items.applied_delta is
  'Selisih yang benar-benar diterapkan ke stok saat sesi diselesaikan (counted_qty - system_qty). NULL kalau belum diterapkan / dilewati.';

-- --------------------------------------------------------
-- 2. RLS: baca = izin stok:view, tulis HANYA lewat RPC di bawah
-- --------------------------------------------------------

alter table public.stock_opname_sessions enable row level security;
alter table public.stock_opname_items enable row level security;

drop policy if exists stock_opname_sessions_select on public.stock_opname_sessions;
create policy stock_opname_sessions_select on public.stock_opname_sessions
  for select using (public.has_permission_action('stok', 'view'));

drop policy if exists stock_opname_items_select on public.stock_opname_items;
create policy stock_opname_items_select on public.stock_opname_items
  for select using (public.has_permission_action('stok', 'view'));

revoke all on public.stock_opname_sessions from anon;
revoke all on public.stock_opname_items from anon;
revoke insert, update, delete on public.stock_opname_sessions from authenticated;
revoke insert, update, delete on public.stock_opname_items from authenticated;
grant select on public.stock_opname_sessions to authenticated;
grant select on public.stock_opname_items to authenticated;

-- --------------------------------------------------------
-- 3. View ringkasan sesi (progres + total selisih)
-- --------------------------------------------------------

create or replace view public.stock_opname_session_stats
with (security_invoker = true) as
select
  s.id,
  s.number,
  s.name,
  s.category_id,
  s.category_name,
  s.status,
  s.note,
  s.created_by,
  s.created_at,
  s.finalized_by,
  s.finalized_at,
  s.cancelled_by,
  s.cancelled_at,
  s.cancel_reason,
  coalesce(c.item_count, 0)::bigint   as item_count,
  coalesce(c.counted_count, 0)::bigint as counted_count,
  coalesce(c.diff_count, 0)::bigint   as diff_count,
  coalesce(c.diff_qty, 0)::bigint     as diff_qty,
  coalesce(c.diff_value, 0)::bigint   as diff_value
from public.stock_opname_sessions s
left join lateral (
  select
    count(*) as item_count,
    count(i.counted_qty) as counted_count,
    count(*) filter (where i.counted_qty is not null and i.counted_qty <> i.system_qty) as diff_count,
    sum(i.counted_qty - i.system_qty) filter (where i.counted_qty is not null) as diff_qty,
    sum((i.counted_qty - i.system_qty)::bigint * coalesce(i.cost_price, 0))
      filter (where i.counted_qty is not null) as diff_value
  from public.stock_opname_items i
  where i.session_id = s.id
) c on true;

comment on view public.stock_opname_session_stats is
  'Sesi opname + progres (counted_count/item_count) dan total selisih (unit & nilai rupiah berdasarkan harga modal). security_invoker = true.';

revoke all on public.stock_opname_session_stats from anon;
grant select on public.stock_opname_session_stats to authenticated;

-- --------------------------------------------------------
-- 4. RPC
-- --------------------------------------------------------

-- 4a. Mulai sesi
create or replace function public.start_stock_opname(
  p_name text default null,
  p_category_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_category_name text;
  v_session_id uuid;
  v_number bigint;
  v_item_count integer;
  v_conflict bigint;
begin
  if not public.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  if p_category_id is not null then
    select name into v_category_name from public.categories where id = p_category_id;
    if not found then
      raise exception 'Kategori tidak ditemukan';
    end if;
  end if;

  -- Serialisasi pembuatan sesi supaya dua sesi tidak lolos cek tumpang tindih bersamaan.
  perform pg_advisory_xact_lock(hashtext('start_stock_opname'));

  select s.number into v_conflict
  from public.stock_opname_items i
  join public.stock_opname_sessions s on s.id = i.session_id
  join public.products p on p.id = i.product_id
  where s.status = 'draft'
    and p.deleted_at is null
    and coalesce(p.is_service, false) = false
    and p.type <> 'JASA'
    and (p_category_id is null or p.category_id = p_category_id)
  order by s.number
  limit 1;

  if v_conflict is not null then
    raise exception 'Sebagian produk di cakupan ini masih ada di sesi opname #% yang belum selesai. Selesaikan atau batalkan sesi itu dulu.', v_conflict;
  end if;

  if v_name is null then
    v_name := 'Opname ' || to_char(now() at time zone 'Asia/Jakarta', 'DD-MM-YYYY');
  end if;

  insert into public.stock_opname_sessions (name, category_id, category_name, note, created_by)
  values (v_name, p_category_id, v_category_name, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id, number into v_session_id, v_number;

  insert into public.stock_opname_items
    (session_id, product_id, product_name, product_sku, product_barcode, product_unit, cost_price, system_qty)
  select
    v_session_id, p.id, p.name, p.sku, p.barcode, p.unit, p.cost_price, coalesce(p.stock, 0)
  from public.products p
  where p.deleted_at is null
    and coalesce(p.is_service, false) = false
    and p.type <> 'JASA'
    and (p_category_id is null or p.category_id = p_category_id);

  get diagnostics v_item_count = row_count;

  if v_item_count = 0 then
    raise exception 'Tidak ada produk berstok pada cakupan ini';
  end if;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'opname_start', 'stock_opname', v_session_id,
    jsonb_build_object(
      'opname_number', v_number,
      'session_name', v_name,
      'category_name', v_category_name,
      'item_count', v_item_count,
      'note', format('Opname #%s (%s) dimulai, %s produk', v_number, v_name, v_item_count)
    )
  );

  return jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'number', v_number,
    'name', v_name,
    'item_count', v_item_count
  );
end;
$$;

comment on function public.start_stock_opname(text, uuid, text) is
  'Mulai sesi opname: salin semua produk fisik (tidak dihapus, bukan jasa) pada cakupan (semua / satu kategori) beserta stok sistem saat ini. Ditolak kalau ada produk yang sudah ada di sesi lain yang masih berjalan. Butuh izin stok:edit.';

-- 4b. Simpan hitungan / catatan satu produk
--     p_mode: 'set' = isi hasil hitung, 'add' = tambah (mis. scan +1),
--             'clear' = hapus hitungan, 'note' = ubah catatan saja.
create or replace function public.save_opname_count(
  p_session_id uuid,
  p_product_id uuid,
  p_mode text,
  p_qty integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.stock_opname_sessions%rowtype;
  v_item public.stock_opname_items%rowtype;
  v_stock integer;
  v_new integer;
begin
  if not public.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  if p_mode is null or p_mode not in ('set', 'add', 'clear', 'note') then
    raise exception 'Mode hitungan tidak valid';
  end if;

  select * into v_session from public.stock_opname_sessions where id = p_session_id for share;
  if not found then
    raise exception 'Sesi opname tidak ditemukan';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'Sesi opname #% sudah %, hitungan tidak bisa diubah lagi',
      v_session.number,
      case v_session.status when 'completed' then 'selesai' else 'dibatalkan' end;
  end if;

  select * into v_item
  from public.stock_opname_items
  where session_id = p_session_id and product_id = p_product_id
  for update;
  if not found then
    raise exception 'Produk ini tidak termasuk dalam sesi opname';
  end if;

  if p_mode = 'note' then
    update public.stock_opname_items
       set note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_item.id
    returning * into v_item;
  else
    select coalesce(stock, 0) into v_stock from public.products where id = p_product_id;
    v_stock := coalesce(v_stock, v_item.system_qty);

    if p_mode = 'clear' then
      update public.stock_opname_items
         set counted_qty = null, system_qty = v_stock, counted_by = null, counted_at = null,
             note = case when p_note is null then note else nullif(btrim(p_note), '') end
       where id = v_item.id
      returning * into v_item;
    else
      if p_qty is null then
        raise exception 'Jumlah tidak boleh kosong';
      end if;

      v_new := case when p_mode = 'add' then coalesce(v_item.counted_qty, 0) + p_qty else p_qty end;
      if v_new < 0 then
        raise exception 'Hasil hitung fisik tidak boleh negatif';
      end if;

      update public.stock_opname_items
         set counted_qty = v_new, system_qty = v_stock,
             counted_by = auth.uid(), counted_at = now(),
             note = case when p_note is null then note else nullif(btrim(p_note), '') end
       where id = v_item.id
      returning * into v_item;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'product_id', v_item.product_id,
    'system_qty', v_item.system_qty,
    'counted_qty', v_item.counted_qty,
    'note', v_item.note,
    'counted_at', v_item.counted_at
  );
end;
$$;

comment on function public.save_opname_count(uuid, uuid, text, integer, text) is
  'Simpan hitungan fisik satu produk dalam sesi draft. Mencatat stok sistem pada saat itu (system_qty) supaya penjualan selama opname tidak dianggap selisih. Mode: set / add / clear / note. Butuh izin stok:edit.';

-- 4c. Selesaikan sesi: terapkan selisih ke stok
create or replace function public.finalize_stock_opname(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.stock_opname_sessions%rowtype;
  v_item public.stock_opname_items%rowtype;
  v_product public.products%rowtype;
  v_total integer;
  v_counted integer;
  v_old integer;
  v_delta integer;
  v_new integer;
  v_movement_id uuid;
  v_adjusted integer := 0;
  v_matched integer := 0;
  v_skipped integer := 0;
  v_plus bigint := 0;
  v_minus bigint := 0;
  v_value bigint := 0;
begin
  if not public.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  select * into v_session from public.stock_opname_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesi opname tidak ditemukan';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'Sesi opname #% sudah %',
      v_session.number,
      case v_session.status when 'completed' then 'selesai' else 'dibatalkan' end;
  end if;

  select count(*), count(counted_qty) into v_total, v_counted
  from public.stock_opname_items where session_id = p_session_id;

  if v_counted = 0 then
    raise exception 'Belum ada produk yang dihitung. Hitung minimal satu produk sebelum menyelesaikan sesi.';
  end if;

  -- Urut per product_id: urutan kunci baris konsisten supaya tidak deadlock
  -- dengan transaksi penjualan / sesi lain.
  for v_item in
    select * from public.stock_opname_items
    where session_id = p_session_id and counted_qty is not null
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id and deleted_at is null
    for update;

    -- Produk sudah dihapus / berubah jadi jasa selama sesi: dilewati, bukan error.
    if not found or v_product.is_service = true or v_product.type = 'JASA' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_old := coalesce(v_product.stock, 0);
    v_delta := v_item.counted_qty - v_item.system_qty;
    v_new := v_old + v_delta;

    if v_new < 0 then
      raise exception 'Stok "%" akan minus (stok sekarang %, selisih opname %). Hitung ulang produk ini lalu selesaikan sesi lagi.',
        v_item.product_name, v_old, v_delta;
    end if;

    if v_delta <> 0 then
      update public.products set stock = v_new, updated_at = now() where id = v_item.product_id;
    end if;

    -- Selisih 0 tetap dicatat sebagai bukti produk ini sudah diopname
    -- (sama seperti adjust_stock).
    insert into public.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'opname', v_delta, null,
      'Opname sesi #' || v_session.number || coalesce(' — ' || v_item.note, ''),
      auth.uid()
    )
    returning id into v_movement_id;

    update public.stock_opname_items
       set applied_delta = v_delta, movement_id = v_movement_id
     where id = v_item.id;

    if v_delta = 0 then
      v_matched := v_matched + 1;
    else
      v_adjusted := v_adjusted + 1;
      if v_delta > 0 then v_plus := v_plus + v_delta; else v_minus := v_minus + (-v_delta); end if;
      v_value := v_value + v_delta::bigint * coalesce(v_item.cost_price, 0);
    end if;
  end loop;

  update public.stock_opname_sessions
     set status = 'completed', finalized_by = auth.uid(), finalized_at = now()
   where id = p_session_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'opname_finalize', 'stock_opname', p_session_id,
    jsonb_build_object(
      'opname_number', v_session.number,
      'session_name', v_session.name,
      'item_count', v_total,
      'counted_count', v_counted,
      'adjusted_count', v_adjusted,
      'matched_count', v_matched,
      'skipped_count', v_skipped,
      'plus_qty', v_plus,
      'minus_qty', v_minus,
      'diff_value', v_value,
      'note', format('Opname #%s (%s) selesai: %s produk disesuaikan, %s cocok, %s belum dihitung',
                     v_session.number, v_session.name, v_adjusted, v_matched, v_total - v_counted)
    )
  );

  return jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'number', v_session.number,
    'item_count', v_total,
    'counted_count', v_counted,
    'uncounted_count', v_total - v_counted,
    'adjusted_count', v_adjusted,
    'matched_count', v_matched,
    'skipped_count', v_skipped,
    'plus_qty', v_plus,
    'minus_qty', v_minus,
    'diff_value', v_value
  );
end;
$$;

comment on function public.finalize_stock_opname(uuid) is
  'Selesaikan sesi opname: untuk tiap produk yang sudah dihitung, tambahkan (counted_qty - system_qty) ke stok sekarang dan tulis mutasi type opname. Produk belum dihitung tidak diubah. Atomik: kalau satu produk akan minus, seluruh penyelesaian dibatalkan dan sesi tetap draft. Butuh izin stok:edit.';

-- 4d. Batalkan sesi
create or replace function public.cancel_stock_opname(p_session_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.stock_opname_sessions%rowtype;
begin
  if not public.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan pembatalan wajib diisi';
  end if;

  select * into v_session from public.stock_opname_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesi opname tidak ditemukan';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'Sesi opname #% sudah %',
      v_session.number,
      case v_session.status when 'completed' then 'selesai' else 'dibatalkan' end;
  end if;

  update public.stock_opname_sessions
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = btrim(p_reason)
   where id = p_session_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'opname_cancel', 'stock_opname', p_session_id,
    jsonb_build_object(
      'opname_number', v_session.number,
      'session_name', v_session.name,
      'reason', format('Opname #%s (%s) dibatalkan: %s', v_session.number, v_session.name, btrim(p_reason))
    )
  );

  return jsonb_build_object('success', true, 'session_id', p_session_id, 'number', v_session.number);
end;
$$;

comment on function public.cancel_stock_opname(uuid, text) is
  'Batalkan sesi opname draft. Stok tidak berubah sama sekali. Alasan wajib. Butuh izin stok:edit.';

-- --------------------------------------------------------
-- 5. Hak eksekusi
-- --------------------------------------------------------

revoke all on function public.start_stock_opname(text, uuid, text) from public, anon;
revoke all on function public.save_opname_count(uuid, uuid, text, integer, text) from public, anon;
revoke all on function public.finalize_stock_opname(uuid) from public, anon;
revoke all on function public.cancel_stock_opname(uuid, text) from public, anon;

grant execute on function public.start_stock_opname(text, uuid, text) to authenticated;
grant execute on function public.save_opname_count(uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.finalize_stock_opname(uuid) to authenticated;
grant execute on function public.cancel_stock_opname(uuid, text) to authenticated;
