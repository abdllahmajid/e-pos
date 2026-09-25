-- Migration 030: permission `retur_void` + perbaikan RPC yang kelewat di migration 028.
--
-- KONTEKS TEMUAN:
-- Migration 028 men-drop total kolom `profiles.role` & enum `public.user_role`
-- (diganti `profiles.role_id` + tabel `roles`/`role_permissions`/`has_permission()`).
-- Section 8 migration itu men-drop SEMUA policy/RPC lama yang membaca kolom/enum
-- tsb — TAPI 6 fungsi berikut kelewat (tidak ada di daftar drop, tidak
-- di-`create or replace` ulang di section manapun), sehingga isinya MASIH:
--   `v_role public.user_role;` + `select role into v_role from profiles ...`
-- Karena kolom `profiles.role` & tipe `public.user_role` sudah tidak ada sejak
-- 028, keenamnya PASTI gagal (`column "role" does not exist` /
-- `type "user_role" does not exist`) begitu dipanggil dari frontend:
--   1. void_transaction        (terakhir didefinisikan di 014)
--   2. return_transaction      (terakhir didefinisikan di 014)
--   3. soft_delete_product     (terakhir didefinisikan di 015)
--   4. restore_product         (terakhir didefinisikan di 015)
--   5. soft_delete_transaction (terakhir didefinisikan di 015)
--   6. restore_transaction     (terakhir didefinisikan di 015)
--
-- Sekalian dengan ini: void/return transaksi ternyata TIDAK ADA di 10 katalog
-- permission migration 028 (kelewat kepetakan dari PRD §5 "retur & void hanya
-- admin/supervisor" — lihat TransactionDetailModal.tsx). Permission baru
-- `retur_void` ditambah di sini. soft_delete_*/restore_* TIDAK butuh permission
-- baru — keduanya sudah wajar dipetakan ke permission `sampah` yang sudah ada
-- (menu Sampah), jadi isi fungsinya cuma diganti gate-nya ke has_permission('sampah'),
-- tanpa nambah permission baru untuk itu.
--
-- Semua logika bisnis di 6 fungsi ini DISALIN APA ADANYA dari versi terakhirnya
-- (014/015) — HANYA blok pengecekan role di awal yang diganti ke has_permission().

-- ── 1. Permission baru: retur_void ──────────────────────────────────────────
insert into public.permissions (key, label, description) values
  ('retur_void', 'Retur & Void Transaksi', 'Retur sebagian/void transaksi yang sudah PAID (PRD §5).');

-- Grant ke 2 role sistem yang sebelumnya (hardcode lama) memang berhak:
-- admin & supervisor. Role custom yang dibuat setelah migration ini harus
-- diberi izin ini manual lewat tab Pengaturan > Role kalau memang perlu.
insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'retur_void', true
from public.roles r
where r.slug in ('admin', 'supervisor');

-- ── 2. void_transaction — gate diganti has_permission('retur_void') ────────
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
  if not public.has_permission('retur_void') then
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

comment on function public.void_transaction(uuid, text) is
  'Void transaksi PAID. Migration 030: gate diganti dari kolom/enum role yang sudah dihapus 028 ke has_permission(''retur_void''). Logika lain sama persis dengan versi 014.';

-- ── 3. return_transaction — gate diganti has_permission('retur_void') ──────
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
  if not public.has_permission('retur_void') then
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

comment on function public.return_transaction(uuid, jsonb, text) is
  'Retur sebagian/total transaksi PAID. Migration 030: gate diganti dari kolom/enum role yang sudah dihapus 028 ke has_permission(''retur_void''). Logika lain sama persis dengan versi 014.';

-- ── 4. soft_delete_product — gate diganti has_permission('sampah') ─────────
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
  if not public.has_permission('sampah') then
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

comment on function public.soft_delete_product(uuid, text) is
  'Soft-delete produk (isi deleted_at). Migration 030: gate diganti dari kolom/enum role yang sudah dihapus 028 ke has_permission(''sampah''). Logika lain sama persis dengan versi 015.';

-- ── 5. restore_product — gate diganti has_permission('sampah') ─────────────
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
  if not public.has_permission('sampah') then
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

comment on function public.restore_product(uuid) is
  'Pulihkan produk dari Sampah (kosongkan deleted_at). Migration 030: gate diganti dari kolom/enum role yang sudah dihapus 028 ke has_permission(''sampah''). Logika lain sama persis dengan versi 015.';

-- ── 6. soft_delete_transaction — gate diganti has_permission('sampah') ─────
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
  if not public.has_permission('sampah') then
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

comment on function public.soft_delete_transaction(uuid, text) is
  'Soft-delete transaksi (isi deleted_at). Migration 030: gate diganti dari kolom/enum role yang sudah dihapus 028 ke has_permission(''sampah''). Logika lain sama persis dengan versi 015.';

-- ── 7. restore_transaction — gate diganti has_permission('sampah') ─────────
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
  if not public.has_permission('sampah') then
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

comment on function public.restore_transaction(uuid) is
  'Pulihkan transaksi dari Sampah (kosongkan deleted_at). Migration 030: gate diganti dari kolom/enum role yang sudah dihapus 028 ke has_permission(''sampah''). Logika lain sama persis dengan versi 015.';
