-- Migration 044: Hadiah & Oleh-oleh (barang keluar non-penjualan)
--
-- Latar belakang: di pondok, tamu (termasuk tamu besar yang diminta langsung
-- oleh Bapak Kiyai, atau tamu toko) diberi oleh-oleh/hadiah yang diambil dari
-- produk toko. Barang itu keluar dari stok TANPA ada penjualan, sehingga harus
-- tercatat sebagai pengeluaran (beban hadiah/representasi) sebesar HARGA MODAL,
-- bukan sebagai selisih opname yang "tidak jelas ke mana perginya".
--
-- Isi:
--   1. Jenis mutasi baru di stock_movements: 'gift'.
--   2. Tabel gift_records + gift_record_items (dokumen hadiah). Harga modal dan
--      harga jual produk DISALIN (snapshot) saat dicatat, jadi nilai beban
--      tidak berubah walau harga modal produk diganti di kemudian hari.
--   3. RPC give_gift (catat hadiah) dan void_gift (batalkan hadiah yang salah
--      input — stok dikembalikan).
--
-- Izin: modul baru `hadiah` (profiles.permissions.hadiah): view / create / delete.
--   - view   : melihat daftar & detail hadiah
--   - create : mencatat hadiah baru
--   - delete : membatalkan hadiah
-- Super Admin otomatis lolos (has_permission_action). User lain harus diberi
-- akses lewat Pengaturan > Kelola User > Hak Akses.
--
-- Tidak mengubah adjust_stock, create_transaction, return/void_transaction,
-- receive_stock, maupun RPC opname. Aman dijalankan ulang.
--
-- ============================================================================
-- CATATAN AKUNTANSI
-- ============================================================================
-- Nilai hadiah = qty x unit_cost (harga modal saat dicatat). Itulah angka yang
-- dilaporkan sebagai "Beban Hadiah" per periode di menu Hadiah & Oleh-oleh.
-- Hadiah TIDAK menyentuh kas/shift dan TIDAK masuk omzet penjualan.
-- Produk yang harga modalnya belum diisi tetap bisa dihadiahkan, tapi nilainya
-- tercatat Rp 0 (aplikasi menampilkan peringatan sebelum disimpan).
-- ============================================================================

-- --------------------------------------------------------
-- 1. Jenis mutasi baru: 'gift'
-- --------------------------------------------------------

alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements
  add constraint stock_movements_type_check
  check (type in ('sale', 'return', 'opname', 'adjustment', 'void', 'stock_in', 'initial', 'gift'))
  not valid;

do $$
begin
  begin
    alter table public.stock_movements validate constraint stock_movements_type_check;
  exception when check_violation then
    raise warning 'stock_movements: ada baris lama dengan type di luar daftar yang sah. Constraint tetap aktif untuk data baru; rapikan baris lama lalu jalankan: alter table public.stock_movements validate constraint stock_movements_type_check;';
  end;
end $$;

comment on column public.stock_movements.type is
  'sale = penjualan · return = retur masuk · void = pembatalan transaksi · opname = hasil hitung fisik · adjustment = penyesuaian manual · stock_in = barang masuk (penerimaan) · initial = stok awal produk baru · gift = hadiah/oleh-oleh keluar (negatif) atau pembatalannya (positif).';

-- --------------------------------------------------------
-- 2. Tabel dokumen hadiah
-- --------------------------------------------------------

create table if not exists public.gift_records (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  given_at date not null,
  recipient_name text not null,
  recipient_category text not null default 'lainnya'
    check (recipient_category in ('kyai', 'tamu_pondok', 'tamu_toko', 'lainnya')),
  occasion text,
  note text,
  status text not null default 'completed'
    check (status in ('completed', 'voided')),
  item_count integer not null default 0,
  total_qty integer not null default 0,
  total_cost bigint not null default 0,
  total_retail bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text
);

create unique index if not exists gift_records_number_key
  on public.gift_records (number);
create index if not exists gift_records_given_idx
  on public.gift_records (given_at desc, created_at desc);

comment on table public.gift_records is
  'Dokumen hadiah/oleh-oleh dari stok toko. total_cost = beban hadiah (qty x harga modal saat dicatat); total_retail = nilai jika dijual (info saja). status voided = dibatalkan, stok sudah dikembalikan.';
comment on column public.gift_records.recipient_category is
  'kyai = Bapak Kiyai/pengasuh · tamu_pondok = tamu yang berkunjung ke pondok · tamu_toko = tamu/pembeli di toko · lainnya.';

create table if not exists public.gift_record_items (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gift_records(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_sku text,
  product_unit text,
  qty integer not null check (qty > 0),
  unit_cost bigint not null default 0 check (unit_cost >= 0),
  unit_price bigint not null default 0 check (unit_price >= 0),
  movement_id uuid,
  unique (gift_id, product_id)
);

create index if not exists gift_record_items_gift_idx
  on public.gift_record_items (gift_id);
create index if not exists gift_record_items_product_idx
  on public.gift_record_items (product_id);

comment on table public.gift_record_items is
  'Baris hadiah. Nama/SKU/satuan, harga modal, dan harga jual disalin (snapshot) saat dicatat.';

alter table public.gift_records enable row level security;
alter table public.gift_record_items enable row level security;

drop policy if exists gift_records_select on public.gift_records;
create policy gift_records_select on public.gift_records
  for select using (public.has_permission_action('hadiah', 'view'));

drop policy if exists gift_record_items_select on public.gift_record_items;
create policy gift_record_items_select on public.gift_record_items
  for select using (public.has_permission_action('hadiah', 'view'));

revoke all on public.gift_records from anon;
revoke all on public.gift_record_items from anon;
revoke insert, update, delete on public.gift_records from authenticated;
revoke insert, update, delete on public.gift_record_items from authenticated;
grant select on public.gift_records to authenticated;
grant select on public.gift_record_items to authenticated;

-- --------------------------------------------------------
-- 3. RPC
-- --------------------------------------------------------

-- 3a. Catat hadiah
--     p_items: [{ "product_id": "<uuid>", "qty": 2 }, ...]
create or replace function public.give_gift(
  p_given_at date,
  p_recipient_name text,
  p_recipient_category text,
  p_occasion text,
  p_note text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_date date := coalesce(p_given_at, (now() at time zone 'Asia/Jakarta')::date);
  v_recipient text := nullif(btrim(coalesce(p_recipient_name, '')), '');
  v_category text := coalesce(nullif(btrim(coalesce(p_recipient_category, '')), ''), 'lainnya');
  v_occasion text := nullif(btrim(coalesce(p_occasion, '')), '');
  v_dup uuid;
  v_gift_id uuid;
  v_number bigint;
  v_item record;
  v_product public.products%rowtype;
  v_old integer;
  v_cost bigint;
  v_price bigint;
  v_movement_id uuid;
  v_item_count integer;
  v_total_qty bigint;
  v_total_cost bigint := 0;
  v_total_retail bigint := 0;
begin
  if not public.has_permission_action('hadiah', 'create') then
    raise exception 'Anda tidak punya izin untuk mencatat hadiah';
  end if;

  if v_recipient is null then
    raise exception 'Nama penerima wajib diisi';
  end if;

  if v_category not in ('kyai', 'tamu_pondok', 'tamu_toko', 'lainnya') then
    raise exception 'Kategori penerima tidak valid';
  end if;

  if v_date > v_today then
    raise exception 'Tanggal hadiah tidak boleh di masa depan';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu produk yang dihadiahkan';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Maksimal 200 produk per hadiah';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) where product_id is null) then
    raise exception 'Ada baris tanpa produk';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) where qty is null or qty <= 0) then
    raise exception 'Jumlah hadiah harus berupa angka bulat lebih dari 0';
  end if;

  select product_id into v_dup
  from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer)
  group by product_id having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception 'Produk yang sama muncul lebih dari satu kali. Gabungkan jumlahnya jadi satu baris.';
  end if;

  select count(*), sum(qty)
    into v_item_count, v_total_qty
  from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer);

  insert into public.gift_records
    (given_at, recipient_name, recipient_category, occasion, note, item_count, total_qty, created_by)
  values (
    v_date, v_recipient, v_category, v_occasion,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_item_count, v_total_qty,
    (select id from public.profiles where id = auth.uid())
  )
  returning id, number into v_gift_id, v_number;

  -- Urut per product_id: urutan kunci baris konsisten (anti-deadlock dengan penjualan / sesi lain).
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id and deleted_at is null
    for update;

    if not found then
      raise exception 'Produk tidak ditemukan atau sudah dihapus';
    end if;
    if v_product.is_service = true or v_product.type = 'JASA' then
      raise exception 'Produk "%" adalah jasa — tidak punya stok untuk dihadiahkan', v_product.name;
    end if;

    v_old := coalesce(v_product.stock, 0);

    if v_old < v_item.qty then
      raise exception 'Stok "%" tidak cukup. Stok sekarang %, hadiah % unit.',
        v_product.name, v_old, v_item.qty;
    end if;

    v_cost := coalesce(v_product.cost_price, 0);
    v_price := coalesce(v_product.sell_price, 0);

    update public.products
       set stock = v_old - v_item.qty,
           updated_at = now()
     where id = v_item.product_id;

    insert into public.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'gift', -v_item.qty, v_gift_id,
      'Hadiah #' || v_number || ' — ' || v_recipient || coalesce(' (' || v_occasion || ')', ''),
      (select id from public.profiles where id = auth.uid())
    )
    returning id into v_movement_id;

    insert into public.gift_record_items
      (gift_id, product_id, product_name, product_sku, product_unit, qty, unit_cost, unit_price, movement_id)
    values
      (v_gift_id, v_item.product_id, v_product.name, v_product.sku, v_product.unit,
       v_item.qty, v_cost, v_price, v_movement_id);

    v_total_cost := v_total_cost + (v_item.qty::bigint * v_cost);
    v_total_retail := v_total_retail + (v_item.qty::bigint * v_price);
  end loop;

  update public.gift_records
     set total_cost = v_total_cost,
         total_retail = v_total_retail
   where id = v_gift_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'gift_give', 'gift', v_gift_id,
    jsonb_build_object(
      'gift_number', v_number,
      'recipient', v_recipient,
      'category', v_category,
      'item_count', v_item_count,
      'total_qty', v_total_qty,
      'total_cost', v_total_cost,
      'note', format('Hadiah #%s untuk %s: %s produk, %s unit, nilai modal Rp %s',
                     v_number, v_recipient, v_item_count, v_total_qty, v_total_cost)
    )
  );

  return jsonb_build_object(
    'success', true,
    'gift_id', v_gift_id,
    'number', v_number,
    'item_count', v_item_count,
    'total_qty', v_total_qty,
    'total_cost', v_total_cost,
    'total_retail', v_total_retail
  );
end;
$$;

comment on function public.give_gift(date, text, text, text, text, jsonb) is
  'Catat hadiah/oleh-oleh: kurangi stok tiap produk + tulis mutasi gift + dokumen hadiah (snapshot harga modal), atomik. Stok tidak boleh minus. Butuh izin hadiah:create.';

-- 3b. Batalkan hadiah (salah input) — stok dikembalikan
create or replace function public.void_gift(p_gift_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gift public.gift_records%rowtype;
  v_item public.gift_record_items%rowtype;
  v_product public.products%rowtype;
  v_skipped integer := 0;
begin
  if not public.has_permission_action('hadiah', 'delete') then
    raise exception 'Anda tidak punya izin untuk membatalkan hadiah';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan pembatalan wajib diisi';
  end if;

  select * into v_gift from public.gift_records where id = p_gift_id for update;
  if not found then
    raise exception 'Hadiah tidak ditemukan';
  end if;
  if v_gift.status <> 'completed' then
    raise exception 'Hadiah #% sudah dibatalkan', v_gift.number;
  end if;

  for v_item in
    select * from public.gift_record_items where gift_id = p_gift_id order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id and deleted_at is null
    for update;

    -- Produk sudah dihapus: tidak ada stok yang bisa dikembalikan.
    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.products
       set stock = coalesce(v_product.stock, 0) + v_item.qty,
           updated_at = now()
     where id = v_item.product_id;

    insert into public.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'gift', v_item.qty, p_gift_id,
      'Pembatalan hadiah #' || v_gift.number || ': ' || btrim(p_reason),
      (select id from public.profiles where id = auth.uid())
    );
  end loop;

  update public.gift_records
     set status = 'voided',
         voided_by = (select id from public.profiles where id = auth.uid()),
         voided_at = now(),
         void_reason = btrim(p_reason)
   where id = p_gift_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'gift_void', 'gift', p_gift_id,
    jsonb_build_object(
      'gift_number', v_gift.number,
      'skipped_count', v_skipped,
      'reason', format('Hadiah #%s dibatalkan: %s', v_gift.number, btrim(p_reason))
    )
  );

  return jsonb_build_object(
    'success', true,
    'gift_id', p_gift_id,
    'number', v_gift.number,
    'skipped_count', v_skipped
  );
end;
$$;

comment on function public.void_gift(uuid, text) is
  'Batalkan hadiah: stok dikembalikan (mutasi gift positif), dokumen jadi voided dan tidak dihitung di beban hadiah. Alasan wajib. Butuh izin hadiah:delete.';

-- --------------------------------------------------------
-- 4. Hak eksekusi
-- --------------------------------------------------------

revoke all on function public.give_gift(date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.give_gift(date, text, text, text, text, jsonb) to authenticated;

revoke all on function public.void_gift(uuid, text) from public, anon;
grant execute on function public.void_gift(uuid, text) to authenticated;
