-- Migration: T-09 (Sampah + Log Aktivitas) — PRD §17 Fase F, §4.1, §5, §6.
--
-- ── Keputusan desain ──
-- 1. **Kolom `deleted_at` TIDAK ditambah di sini** — sudah ada sejak
--    `scripts/setup-database.sql` di `products` MAUPUN `transactions`, dan
--    sudah dipakai di semua query baca (`hooks/useProducts.ts`,
--    `hooks/useTransactions.ts`, `hooks/useDashboard.ts`, `hooks/useReports.ts`
--    — semua sudah `.is("deleted_at", null)`). Yang belum ada murni RPC-nya.
-- 2. **Cakupan Sampah: produk & transaksi saja**, sesuai PRD §4.1 ("Sampah —
--    soft-delete transaksi/produk"). Kategori SENGAJA tidak diikutkan — PRD §6
--    hanya menulis `deleted_at` untuk produk & transaksi, dan tabel
--    `categories` memang tidak punya kolom itu (lihat `setup-database.sql`).
--    Kalau nanti dibutuhkan, itu migration terpisah, bukan asumsi diam-diam.
-- 3. **Hapus transaksi ≠ Void.** Void (migration 004) mengubah status jadi
--    'VOID' dan MENGEMBALIKAN stok — itu proses bisnis, tetap ada & tidak
--    disentuh. `soft_delete_transaction` di sini murni "sembunyikan dari
--    tampilan normal" (mis. transaksi dobel akibat klik ganda, salah input
--    yang belum sempat dibayar/void) — TIDAK mengubah stok maupun status
--    apapun, cuma set `deleted_at`. Kedua konsep ini independen: transaksi
--    berstatus VOID pun tetap bisa di-soft-delete kalau perlu disembunyikan.
-- 4. **Semua 4 RPC baru (soft_delete_product/restore_product/
--    soft_delete_transaction/restore_transaction) admin-only** — beda dari
--    void/retur/opname yang admin+supervisor. Sesuai matriks PRD §5: baris
--    `trash` cuma ada ✔ di kolom Admin (Supervisor & Kasir sama-sama '—').
-- 5. **`activity_logs` ditulis dari DALAM RPC yang sudah ada** (void_transaction,
--    return_transaction, adjust_stock — `create or replace`, isi lain disalin
--    APA ADANYA, cuma ditambah satu blok INSERT di akhir sebelum RETURN) —
--    BUKAN lewat trigger. Alasan: trigger di banyak tabel (transactions,
--    products, stock_movements) akan sulit membedakan "opname biasa" vs
--    "hasil retur" vs dst. dari row change saja, sedangkan tiap RPC sudah TAHU
--    persis actor & konteksnya sendiri saat itu juga.
-- 6. **RLS `activity_logs`: select admin-only, TANPA policy insert/update/
--    delete sama sekali** — pola sama seperti `stock_movements`/`transactions`
--    (migration 009/011). Semua tulisan wajib lewat RPC `security definer` di
--    atas, supaya tidak ada jalur untuk memalsukan/menghapus log dari client.
-- 7. **`meta` (jsonb) menyimpan detail spesifik per action** (mis. alasan,
--    nilai lama/baru) supaya satu tabel generik ini tetap berguna dibaca tanpa
--    join balik ke tabel lain yang mungkin sudah berubah datanya.

-- --------------------------------------------------------
-- 1. Tabel activity_logs
-- --------------------------------------------------------

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activity_logs is
  'Audit trail aksi sensitif (void, retur, opname/adjustment stok, hapus & pulihkan produk/transaksi). Hanya ditulis dari dalam RPC security definer — lihat migration 014.';

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);

create index if not exists activity_logs_entity_idx
  on public.activity_logs (entity, entity_id);

alter table public.activity_logs enable row level security;

drop policy if exists "activity_logs_select_admin" on public.activity_logs;
create policy "activity_logs_select_admin"
  on public.activity_logs for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 2. RPC: soft_delete_product / restore_product
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

  if v_role is null or v_role <> 'admin' then
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
  'Soft-delete produk (isi deleted_at) — admin only. Alasan opsional, dicatat di activity_logs kalau diisi.';

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

  if v_role is null or v_role <> 'admin' then
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
  'Pulihkan produk dari Sampah (kosongkan deleted_at) — admin only.';

-- --------------------------------------------------------
-- 3. RPC: soft_delete_transaction / restore_transaction
--
--    SENGAJA tidak menyentuh stok/status apapun — lihat keputusan #3 di atas.
--    Transaksi berstatus apapun (PAID/VOID/RETURN) boleh di-soft-delete;
--    ini murni visibilitas, bukan pembatalan transaksi.
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

  if v_role is null or v_role <> 'admin' then
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
  'Soft-delete transaksi (isi deleted_at) — admin only. TIDAK mengubah stok/status, murni sembunyikan dari tampilan normal. Beda dengan void_transaction (migration 004).';

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

  if v_role is null or v_role <> 'admin' then
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
  'Pulihkan transaksi dari Sampah (kosongkan deleted_at) — admin only.';

-- --------------------------------------------------------
-- 4. void_transaction — TAMBAHAN: catat ke activity_logs.
--    Isi lain disalin APA ADANYA dari migration 004, hanya ditambah satu
--    blok INSERT sebelum RETURN.
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

  -- TAMBAHAN (T-09): log aksi sensitif.
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

-- --------------------------------------------------------
-- 5. return_transaction — TAMBAHAN: catat ke activity_logs.
--    Isi lain disalin APA ADANYA dari migration 004, hanya ditambah satu
--    blok INSERT sebelum RETURN.
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

  -- TAMBAHAN (T-09): log aksi sensitif.
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

-- --------------------------------------------------------
-- 6. adjust_stock — TAMBAHAN: catat ke activity_logs.
--    Isi lain disalin APA ADANYA dari migration 009, hanya ditambah satu
--    blok INSERT sebelum RETURN (setelah insert stock_movements yang sudah ada).
-- --------------------------------------------------------

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_type text,
  p_value integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_role public.user_role;
    v_product RECORD;
    v_old_stock INTEGER;
    v_qty_delta INTEGER;
    v_new_stock INTEGER;
    v_movement_id UUID;
begin
    SELECT role INTO v_role
    FROM profiles
    WHERE id = auth.uid()
      AND is_active = TRUE;

    IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
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

    SELECT *
    INTO v_product
    FROM products
    WHERE id = p_product_id
      AND deleted_at IS NULL
    FOR UPDATE;

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
        UPDATE products
        SET stock = v_new_stock,
            updated_at = NOW()
        WHERE id = p_product_id;
    END IF;

    INSERT INTO stock_movements (
        product_id, type, qty_delta, reference_id, reason, created_by
    )
    VALUES (
        p_product_id, p_type, v_qty_delta, NULL, btrim(p_reason), auth.uid()
    )
    RETURNING id INTO v_movement_id;

    -- TAMBAHAN (T-09): log aksi sensitif (opname & adjustment dua-duanya,
    -- termasuk opname selisih 0 — konsisten dengan stock_movements yang juga
    -- tetap mencatat baris qty_delta = 0).
    INSERT INTO activity_logs (user_id, action, entity, entity_id, meta)
    VALUES (
        auth.uid(),
        CASE WHEN p_type = 'opname' THEN 'stock_opname' ELSE 'stock_adjustment' END,
        'product',
        p_product_id,
        jsonb_build_object(
            'product_name', v_product.name,
            'reason', btrim(p_reason),
            'old_stock', v_old_stock,
            'qty_delta', v_qty_delta,
            'new_stock', v_new_stock,
            'movement_id', v_movement_id
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'movement_id', v_movement_id,
        'product_id', p_product_id,
        'product_name', v_product.name,
        'old_stock', v_old_stock,
        'qty_delta', v_qty_delta,
        'new_stock', v_new_stock
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$function$;
