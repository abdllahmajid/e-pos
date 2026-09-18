-- Migration 015: buka akses Sampah + Log Aktivitas untuk admin+supervisor.
--
-- KONTEKS: migration ini disebut sudah dibuat di PROGRESS.md (sesi #10),
-- tapi filenya hilang dari repo/zip yang diserahkan — dibuat ulang di sini
-- berdasarkan deskripsi PROGRESS.md, isinya SAMA seperti yang tercatat:
--
-- 1. RLS `activity_logs`: select yang tadinya admin-only (migration 014)
--    dilonggarkan jadi admin+supervisor. Insert/update/delete TETAP tanpa
--    policy sama sekali (tidak berubah) — semua tulisan wajib lewat RPC
--    security definer (void_transaction, return_transaction, adjust_stock,
--    soft_delete_*/restore_*).
-- 2. 4 RPC Sampah (soft_delete_product/restore_product/
--    soft_delete_transaction/restore_transaction): baris cek role diubah
--    dari `<> 'admin'` menjadi `not in ('admin', 'supervisor')`. Isi lain
--    disalin PERSIS dari migration 014, tidak ada perubahan logika lain.
--    void_transaction/return_transaction/adjust_stock TIDAK disentuh —
--    sudah admin+supervisor sejak migration 004/009.
--
-- PENTING: migration ini WAJIB dijalankan di Supabase (SQL Editor atau
-- `supabase db push`) sebelum fitur Log Aktivitas/Sampah bisa dipakai
-- oleh akun supervisor — kode frontend (LogAktivitasModule.tsx,
-- SampahModule.tsx) sudah mengasumsikan akses ini terbuka.

-- --------------------------------------------------------
-- 1. RLS activity_logs: select admin+supervisor
-- --------------------------------------------------------

drop policy if exists "activity_logs_select_admin" on public.activity_logs;
drop policy if exists "activity_logs_select_admin_supervisor" on public.activity_logs;

create policy "activity_logs_select_admin_supervisor"
  on public.activity_logs for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 2. soft_delete_product — role check dilonggarkan
-- --------------------------------------------------------

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
  v_role public.user_role;
  v_product record;
begin
  select role into v_role from public.profiles
  where id = auth.uid() and is_active = true;

  if v_role is null or v_role not in ('admin', 'supervisor') then
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
  'Soft-delete produk (isi deleted_at) — admin+supervisor (dilonggarkan migration 015). Alasan opsional, dicatat di activity_logs kalau diisi.';

-- --------------------------------------------------------
-- 3. restore_product — role check dilonggarkan
-- --------------------------------------------------------

create or replace function public.restore_product(
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role;
  v_product record;
begin
  select role into v_role from public.profiles
  where id = auth.uid() and is_active = true;

  if v_role is null or v_role not in ('admin', 'supervisor') then
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
  'Pulihkan produk dari Sampah (kosongkan deleted_at) — admin+supervisor (dilonggarkan migration 015).';

-- --------------------------------------------------------
-- 4. soft_delete_transaction — role check dilonggarkan
-- --------------------------------------------------------

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
  v_role public.user_role;
  v_tx record;
begin
  select role into v_role from public.profiles
  where id = auth.uid() and is_active = true;

  if v_role is null or v_role not in ('admin', 'supervisor') then
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
  'Soft-delete transaksi (isi deleted_at) — admin+supervisor (dilonggarkan migration 015). TIDAK mengubah stok/status, murni sembunyikan dari tampilan normal.';

-- --------------------------------------------------------
-- 5. restore_transaction — role check dilonggarkan
-- --------------------------------------------------------

create or replace function public.restore_transaction(
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role;
  v_tx record;
begin
  select role into v_role from public.profiles
  where id = auth.uid() and is_active = true;

  if v_role is null or v_role not in ('admin', 'supervisor') then
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
  'Pulihkan transaksi dari Sampah (kosongkan deleted_at) — admin+supervisor (dilonggarkan migration 015).';
