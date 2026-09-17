-- Migration: fondasi Retur & Void sesuai PRD §4.4, §5 (permission), §6 (model data).
--
-- Keputusan desain (karena user minta langsung diimplementasi sesuai PRD, tanpa Q&A lagi):
-- 1. Retur bersifat PARTIAL per item (pilih item & qty) — pakai kolom `returned_qty`
--    di transaction_items, BUKAN boolean `is_returned` seperti draft awal PRD §6 —
--    karena boolean tidak bisa merepresentasikan "retur qty" sesuai teks PRD §4.4.
-- 2. Retur membuat BARIS TRANSAKSI BARU berstatus RETURN, ter-link ke transaksi asli
--    lewat `related_transaction_id` (pola double-entry sederhana sesuai PRD §4.4).
--    Transaksi asli TIDAK dihapus — statusnya ikut diubah jadi RETURN.
-- 3. Void & Retur cuma boleh role admin/supervisor (PRD §5: kasir tidak punya akses 'retur').
-- 4. Restock (retur & void) dicatat ke stock_movements (kolom persis PRD §6).
-- 5. Refund amount DICATAT tapi BELUM dipotong dari kas manapun — tabel cash_movements/
--    shift_sessions belum ada (Kas & Shift belum dikerjakan). Sambungkan nanti.
-- 6. `void_reason` dipakai ulang sebagai kolom alasan generik untuk void MAUPUN retur
--    (tidak bikin kolom baru `retur_reason` terpisah, supaya tidak duplikatif).

-- --------------------------------------------------------
-- 1. Kolom baru
-- --------------------------------------------------------

alter table public.transactions
  add column if not exists related_transaction_id uuid references public.transactions(id);

alter table public.transaction_items
  add column if not exists returned_qty integer not null default 0;

-- --------------------------------------------------------
-- 2. Tabel stock_movements (persis nama kolom PRD §6)
-- --------------------------------------------------------

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  type text not null check (type in ('sale', 'return', 'opname', 'adjustment', 'void')),
  qty_delta integer not null,
  reference_id uuid,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- Catatan: 'sale' belum pernah diisi otomatis oleh create_transaction (di luar
-- scope migration ini) — baru 'return' & 'void' yang mengisi tabel ini untuk sekarang.

comment on table public.stock_movements is
  'Audit trail mutasi stok. Sale belum otomatis tercatat di sini — cuma return & void per migration 004.';

-- --------------------------------------------------------
-- 3. RPC: void_transaction
-- --------------------------------------------------------

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
  v_role public.user_role;
  v_status public.transaction_status;
  v_item record;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is null or v_role not in ('admin', 'supervisor') then
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

  return jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id
  );
end;
$function$;

-- --------------------------------------------------------
-- 4. RPC: return_transaction
-- p_items: [{ "transaction_item_id": "<uuid>", "qty": <int> }, ...]
-- --------------------------------------------------------

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
  v_role public.user_role;
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
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is null or v_role not in ('admin', 'supervisor') then
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

    -- Refund proporsional terhadap subtotal per-unit item ini (subtotal sudah dikurangi diskon).
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

  -- Nomor "struk" retur terpisah: LCO-RTR/{yy}/{mm}/{urutan} — beda prefix dari
  -- LCO-STR agar gampang dibedakan di laporan/riwayat.
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

  return jsonb_build_object(
    'success', true,
    'return_transaction_id', v_return_id,
    'receipt_no', v_receipt_no,
    'refund_amount', v_refund_total
  );
end;
$function$;
