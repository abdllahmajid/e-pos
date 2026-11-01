-- Migration 042: Barang masuk + stok awal produk (perbaikan menu Stok & Opname, Fase 3)
--
-- Isi:
--   1. Jenis mutasi baru di stock_movements: 'stock_in' (barang masuk) dan
--      'initial' (stok awal produk).
--   2. Tabel stock_receipts + stock_receipt_items (dokumen penerimaan barang).
--   3. RPC receive_stock (catat barang masuk) dan void_stock_receipt
--      (batalkan barang masuk yang salah input).
--   4. Trigger AFTER INSERT di products: produk baru dengan stok awal > 0
--      otomatis tercatat sebagai mutasi 'initial'.
--
-- Tidak mengubah adjust_stock, create_transaction, return/void_transaction,
-- maupun RPC opname sesi (041). Aman dijalankan ulang.
--
-- ============================================================================
-- CATATAN DESAIN
-- ============================================================================
-- 1. Barang masuk menambah stok DAN menulis stock_movements dalam satu transaksi
--    DB (pola yang sama dengan adjust_stock). Jadi invariant "stok berubah <=>
--    ada barisnya di stock_movements" tetap terjaga, dan kartu stok (037) tetap
--    akurat.
-- 2. Harga modal produk TIDAK berubah kecuali p_update_cost = true. Kalau
--    diaktifkan, cost_price produk diganti dengan harga beli terakhir (bukan
--    rata-rata tertimbang), hanya untuk baris yang diisi harga belinya. Harga
--    modal dipakai untuk nilai persediaan & nilai selisih opname, jadi
--    perubahannya harus disengaja.
-- 3. Pembatalan barang masuk membuat mutasi 'adjustment' negatif (alasan memuat
--    nomor penerimaan) dan DITOLAK kalau stok sekarang tidak cukup (sebagian
--    sudah terjual) — koreksi sisanya lewat Penyesuaian. Harga modal yang
--    pernah diperbarui TIDAK dikembalikan otomatis.
-- 4. Trigger stok awal hanya untuk INSERT (bukan UPDATE). Itu sebabnya aman
--    walau RPC return/void sudah menulis mutasinya sendiri: tidak ada RPC lain
--    yang meng-INSERT produk. Produk lama tidak di-backfill — kartu stok
--    menghitung saldo mundur dari stok sekarang, jadi tetap benar.
-- ============================================================================

-- --------------------------------------------------------
-- 1. Jenis mutasi baru
-- --------------------------------------------------------

alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements
  add constraint stock_movements_type_check
  check (type in ('sale', 'return', 'opname', 'adjustment', 'void', 'stock_in', 'initial'))
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
  'sale = penjualan · return = retur masuk · void = pembatalan transaksi · opname = hasil hitung fisik · adjustment = penyesuaian manual · stock_in = barang masuk (penerimaan) · initial = stok awal produk baru.';

-- --------------------------------------------------------
-- 2. Tabel penerimaan barang
-- --------------------------------------------------------

create table if not exists public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  received_at date not null,
  supplier text,
  reference_no text,
  note text,
  status text not null default 'completed'
    check (status in ('completed', 'voided')),
  item_count integer not null default 0,
  total_qty integer not null default 0,
  total_cost bigint not null default 0,
  cost_updated boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text
);

create unique index if not exists stock_receipts_number_key
  on public.stock_receipts (number);
create index if not exists stock_receipts_received_idx
  on public.stock_receipts (received_at desc, created_at desc);

comment on table public.stock_receipts is
  'Dokumen barang masuk (penerimaan). total_cost = jumlah qty x harga beli baris yang diisi harga belinya. status voided = sudah dibatalkan (stok dikurangi kembali).';

create table if not exists public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.stock_receipts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_sku text,
  product_unit text,
  qty integer not null check (qty > 0),
  unit_cost bigint check (unit_cost is null or unit_cost >= 0),
  movement_id uuid,
  unique (receipt_id, product_id)
);

create index if not exists stock_receipt_items_receipt_idx
  on public.stock_receipt_items (receipt_id);
create index if not exists stock_receipt_items_product_idx
  on public.stock_receipt_items (product_id);

comment on table public.stock_receipt_items is
  'Baris barang masuk. Nama/SKU/satuan disalin (snapshot) saat dicatat.';

alter table public.stock_receipts enable row level security;
alter table public.stock_receipt_items enable row level security;

drop policy if exists stock_receipts_select on public.stock_receipts;
create policy stock_receipts_select on public.stock_receipts
  for select using (public.has_permission_action('stok', 'view'));

drop policy if exists stock_receipt_items_select on public.stock_receipt_items;
create policy stock_receipt_items_select on public.stock_receipt_items
  for select using (public.has_permission_action('stok', 'view'));

revoke all on public.stock_receipts from anon;
revoke all on public.stock_receipt_items from anon;
revoke insert, update, delete on public.stock_receipts from authenticated;
revoke insert, update, delete on public.stock_receipt_items from authenticated;
grant select on public.stock_receipts to authenticated;
grant select on public.stock_receipt_items to authenticated;

-- --------------------------------------------------------
-- 3. RPC
-- --------------------------------------------------------

-- 3a. Catat barang masuk
--     p_items: [{ "product_id": "<uuid>", "qty": 10, "unit_cost": 25000 }, ...]
--     unit_cost boleh null/dihilangkan.
create or replace function public.receive_stock(
  p_received_at date,
  p_supplier text,
  p_reference_no text,
  p_note text,
  p_items jsonb,
  p_update_cost boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_date date := coalesce(p_received_at, (now() at time zone 'Asia/Jakarta')::date);
  v_supplier text := nullif(btrim(coalesce(p_supplier, '')), '');
  v_dup uuid;
  v_receipt_id uuid;
  v_number bigint;
  v_item record;
  v_product public.products%rowtype;
  v_old integer;
  v_movement_id uuid;
  v_item_count integer;
  v_total_qty bigint;
  v_total_cost bigint;
begin
  if not public.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk mencatat barang masuk';
  end if;

  if v_date > v_today then
    raise exception 'Tanggal terima tidak boleh di masa depan';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu produk yang masuk';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Maksimal 500 produk per barang masuk';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) where product_id is null) then
    raise exception 'Ada baris tanpa produk';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) where qty is null or qty <= 0) then
    raise exception 'Jumlah barang masuk harus berupa angka bulat lebih dari 0';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) where unit_cost is not null and unit_cost < 0) then
    raise exception 'Harga beli tidak boleh negatif';
  end if;

  select product_id into v_dup from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) group by product_id having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception 'Produk yang sama muncul lebih dari satu kali. Gabungkan jumlahnya jadi satu baris.';
  end if;

  select count(*), sum(qty), coalesce(sum(qty::bigint * coalesce(unit_cost, 0)), 0)
    into v_item_count, v_total_qty, v_total_cost
  from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint);

  insert into public.stock_receipts
    (received_at, supplier, reference_no, note, item_count, total_qty, total_cost, cost_updated, created_by)
  values (
    v_date, v_supplier,
    nullif(btrim(coalesce(p_reference_no, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_item_count, v_total_qty, v_total_cost, coalesce(p_update_cost, false), auth.uid()
  )
  returning id, number into v_receipt_id, v_number;

  -- Urut per product_id: urutan kunci baris konsisten (anti-deadlock dengan penjualan / sesi lain).
  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) order by product_id loop
    select * into v_product
    from public.products
    where id = v_item.product_id and deleted_at is null
    for update;

    if not found then
      raise exception 'Produk tidak ditemukan atau sudah dihapus';
    end if;
    if v_product.is_service = true or v_product.type = 'JASA' then
      raise exception 'Produk "%" adalah jasa — tidak punya stok', v_product.name;
    end if;

    v_old := coalesce(v_product.stock, 0);

    update public.products
       set stock = v_old + v_item.qty,
           cost_price = case
             when coalesce(p_update_cost, false) and v_item.unit_cost is not null then v_item.unit_cost
             else cost_price
           end,
           updated_at = now()
     where id = v_item.product_id;

    insert into public.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'stock_in', v_item.qty, null,
      'Barang masuk #' || v_number || coalesce(' — ' || v_supplier, ''),
      auth.uid()
    )
    returning id into v_movement_id;

    insert into public.stock_receipt_items
      (receipt_id, product_id, product_name, product_sku, product_unit, qty, unit_cost, movement_id)
    values
      (v_receipt_id, v_item.product_id, v_product.name, v_product.sku, v_product.unit,
       v_item.qty, v_item.unit_cost, v_movement_id);
  end loop;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'stock_receive', 'stock_receipt', v_receipt_id,
    jsonb_build_object(
      'receipt_number', v_number,
      'supplier', v_supplier,
      'item_count', v_item_count,
      'total_qty', v_total_qty,
      'total_cost', v_total_cost,
      'note', format('Barang masuk #%s%s: %s produk, %s unit', v_number,
                     coalesce(' (' || v_supplier || ')', ''), v_item_count, v_total_qty)
    )
  );

  return jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'number', v_number,
    'item_count', v_item_count,
    'total_qty', v_total_qty,
    'total_cost', v_total_cost
  );
end;
$$;

comment on function public.receive_stock(date, text, text, text, jsonb, boolean) is
  'Catat barang masuk: tambah stok tiap produk + tulis mutasi stock_in + dokumen penerimaan, atomik. Harga modal produk hanya diubah kalau p_update_cost = true. Butuh izin stok:edit.';

-- 3b. Batalkan barang masuk
create or replace function public.void_stock_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_receipt public.stock_receipts%rowtype;
  v_item public.stock_receipt_items%rowtype;
  v_product public.products%rowtype;
  v_old integer;
  v_skipped integer := 0;
begin
  if not public.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk membatalkan barang masuk';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan pembatalan wajib diisi';
  end if;

  select * into v_receipt from public.stock_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'Barang masuk tidak ditemukan';
  end if;
  if v_receipt.status <> 'completed' then
    raise exception 'Barang masuk #% sudah dibatalkan', v_receipt.number;
  end if;

  for v_item in
    select * from public.stock_receipt_items where receipt_id = p_receipt_id order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id and deleted_at is null
    for update;

    -- Produk sudah dihapus: tidak ada stok yang perlu dikurangi.
    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_old := coalesce(v_product.stock, 0);

    if v_old < v_item.qty then
      raise exception 'Stok "%" tinggal %, tidak cukup untuk membatalkan barang masuk % unit (sebagian sudah terjual). Koreksi lewat Penyesuaian.',
        v_item.product_name, v_old, v_item.qty;
    end if;

    update public.products set stock = v_old - v_item.qty, updated_at = now()
     where id = v_item.product_id;

    insert into public.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'adjustment', -v_item.qty, null,
      'Pembatalan barang masuk #' || v_receipt.number || ': ' || btrim(p_reason),
      auth.uid()
    );
  end loop;

  update public.stock_receipts
     set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
   where id = p_receipt_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'stock_receive_void', 'stock_receipt', p_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt.number,
      'skipped_count', v_skipped,
      'reason', format('Barang masuk #%s dibatalkan: %s', v_receipt.number, btrim(p_reason))
    )
  );

  return jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'number', v_receipt.number,
    'skipped_count', v_skipped
  );
end;
$$;

comment on function public.void_stock_receipt(uuid, text) is
  'Batalkan barang masuk: kurangi stok sebesar yang dulu masuk (mutasi adjustment). Ditolak kalau stok sekarang tidak cukup. Harga modal yang pernah diperbarui tidak dikembalikan. Alasan wajib. Butuh izin stok:edit.';

-- --------------------------------------------------------
-- 4. Stok awal produk baru -> mutasi 'initial'
-- --------------------------------------------------------

create or replace function public.log_initial_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.stock, 0) > 0 and coalesce(new.is_service, false) = false then
    insert into public.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      new.id, 'initial', new.stock, null, 'Stok awal produk',
      -- created_by memakai FK ke profiles: kalau pemanggil bukan user biasa
      -- (mis. SQL Editor), isi NULL daripada membuat INSERT produk gagal.
      (select id from public.profiles where id = auth.uid())
    );
  end if;
  return new;
end;
$$;

comment on function public.log_initial_stock() is
  'Trigger AFTER INSERT di products: stok awal > 0 dicatat sebagai mutasi initial supaya ada jejak siapa yang mengisi stok awal.';

drop trigger if exists products_log_initial_stock on public.products;
create trigger products_log_initial_stock
  after insert on public.products
  for each row execute function public.log_initial_stock();

-- --------------------------------------------------------
-- 5. Hak eksekusi
-- --------------------------------------------------------

revoke all on function public.receive_stock(date, text, text, text, jsonb, boolean) from public, anon;
revoke all on function public.void_stock_receipt(uuid, text) from public, anon;
revoke all on function public.log_initial_stock() from public, anon;

grant execute on function public.receive_stock(date, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.void_stock_receipt(uuid, text) to authenticated;
