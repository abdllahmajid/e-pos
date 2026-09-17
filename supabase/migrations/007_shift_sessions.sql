-- Migration: Shift kasir — buka/tutup, selisih kas, wajib sebelum transaksi (PRD §17 T-04).
--
-- Keputusan desain:
-- 1. `status` dibuat `text` + `check` (bukan enum baru) — cukup 2 nilai ('OPEN'/'CLOSED'),
--    konsisten dengan pola `transactions.status` yang juga text, bukan enum Postgres
--    terpisah (lihat scripts/setup-database.sql), jadi tidak perlu migration `alter type`
--    kalau nanti butuh status ke-3 (mis. 'FORCE_CLOSED').
-- 2. **Satu shift aktif per kasir** ditegakkan di DATABASE lewat unique partial index
--    (bukan cuma dicek di UI/RPC) — sesuai DoD T-04 "ditolak di DB, bukan cuma di UI".
--    Race condition (dobel klik "Buka Shift") otomatis gagal dengan unique_violation.
-- 3. `expected_cash`/`actual_cash`/`difference` nullable — hanya terisi saat tutup shift
--    (KasModule.tsx menghitung `expected_cash` dari opening_cash + rekap kas masuk selama
--    shift, `actual_cash` dari input hitung pecahan kasir, `difference = actual - expected`).
--    Perhitungan detail ada di client (agregasi laporan, bukan uang inti), tapi begitu
--    dikirim ke `close_shift` RPC di bawah, angka-angka itu dikunci (RPC yang menulis).
-- 4. RLS baca: kasir lihat shift miliknya sendiri; admin/supervisor lihat SEMUA shift
--    (termasuk yang masih OPEN, untuk realtime monitoring PRD §4.6 "admin dapat melihat
--    semua shift berjalan"). RLS tulis: kasir hanya boleh buka/tutup shift miliknya sendiri;
--    admin/supervisor juga bisa (mis. force-close shift kasir yang lupa tutup / shift orphan).
-- 5. FK `transactions.shift_id` -> `shift_sessions.id` baru ditambahkan SEKARANG (kolom
--    `shift_id` sendiri sudah ada dari migration 001, nullable, tanpa FK — lihat komentar
--    di sana). `on delete set null` supaya shift lama tetap bisa dihapus (jarang terjadi)
--    tanpa merusak riwayat transaksi.
-- 6. RPC `create_transaction` (003 -> 006 -> di sini) ditambah logic: cari shift OPEN milik
--    `auth.uid()`, WAJIB ada kalau `cashier_id` diketahui (pola sama seperti komentar
--    "TIDAK di-hard-block kalau NULL" di 003 — supaya pemanggilan di luar konteks user login,
--    kalau ada, tidak ikut mendadak patah), isi ke `transactions.shift_id`. Kasir tanpa
--    shift aktif akan mendapat error jelas dari RPC (bukan silent shift_id = NULL).

-- --------------------------------------------------------
-- 1. Tabel shift_sessions
-- --------------------------------------------------------

create table if not exists public.shift_sessions (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles(id) on delete cascade,
  opened_at timestamptz not null default now(),
  opening_cash bigint not null default 0,
  closed_at timestamptz,
  expected_cash bigint,
  actual_cash bigint,
  difference bigint,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.shift_sessions is
  'Shift kasir (PRD §17 T-04): buka dengan modal awal, tutup dengan hitung pecahan -> selisih kas otomatis. Satu kasir hanya boleh punya satu shift OPEN (lihat unique index di bawah).';
comment on column public.shift_sessions.opening_cash is
  'Modal awal kas saat buka shift, default dari settings.shift_default_cash (diisi client saat buka, lihat useShifts.ts).';
comment on column public.shift_sessions.expected_cash is
  'Kas yang seharusnya ada saat tutup (opening_cash + total tunai masuk selama shift), dihitung & dikunci oleh RPC close_shift.';
comment on column public.shift_sessions.actual_cash is
  'Hasil hitung fisik pecahan uang oleh kasir saat tutup shift.';
comment on column public.shift_sessions.difference is
  'actual_cash - expected_cash. Negatif = kurang, positif = lebih.';

-- Satu shift AKTIF (status = OPEN) per kasir — ditegakkan di DB, bukan cuma UI.
create unique index if not exists shift_sessions_one_open_per_cashier
  on public.shift_sessions (cashier_id)
  where status = 'OPEN';

create index if not exists shift_sessions_cashier_id_idx
  on public.shift_sessions (cashier_id);

alter table public.shift_sessions enable row level security;

-- --------------------------------------------------------
-- 2. RLS — select: kasir lihat shift sendiri, admin/supervisor lihat semua
-- --------------------------------------------------------

drop policy if exists "shift_sessions_select_own_or_supervisor" on public.shift_sessions;
create policy "shift_sessions_select_own_or_supervisor"
  on public.shift_sessions for select
  using (
    cashier_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 3. RLS — insert: kasir hanya boleh buka shift atas namanya sendiri
--    (admin/supervisor juga punya shift sendiri kalau mereka pegang kasir langsung).
-- --------------------------------------------------------

drop policy if exists "shift_sessions_insert_own" on public.shift_sessions;
create policy "shift_sessions_insert_own"
  on public.shift_sessions for insert
  with check (
    cashier_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 4. RLS — update: kasir tutup shift sendiri; admin/supervisor boleh update shift siapa
--    saja (force-close shift yang lupa ditutup / koreksi selisih kas).
-- --------------------------------------------------------

drop policy if exists "shift_sessions_update_own_or_supervisor" on public.shift_sessions;
create policy "shift_sessions_update_own_or_supervisor"
  on public.shift_sessions for update
  using (
    cashier_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  )
  with check (
    cashier_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );

-- Tidak ada policy delete sengaja — riwayat shift adalah jejak audit kas, sama seperti
-- payment_proofs (migration 006). Admin yang benar-benar perlu hapus bisa lewat Dashboard.

-- --------------------------------------------------------
-- 5. FK transactions.shift_id -> shift_sessions.id
--    (kolom sudah ada dari migration 001, nullable, tanpa FK — ditambah sekarang).
-- --------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_shift_id_fkey'
  ) then
    alter table public.transactions
      add constraint transactions_shift_id_fkey
      foreign key (shift_id) references public.shift_sessions(id)
      on delete set null;
  end if;
end $$;

-- --------------------------------------------------------
-- 6. RPC create_transaction — tambah pencarian shift aktif + wajib isi shift_id
--    (pola sama seperti migration 006: CREATE OR REPLACE, signature TIDAK berubah,
--    hanya isi body yang ditambah).
-- --------------------------------------------------------

create or replace function public.create_transaction(
  p_items jsonb,
  p_subtotal bigint,
  p_discount bigint default 0,
  p_tax bigint default 0,
  p_total bigint default 0,
  p_customer_name text default null::text,
  p_notes text default null::text,
  p_payment_method payment_method default 'CASH'::payment_method,
  p_payment_amount bigint default 0,
  p_received_amount bigint default null::bigint,
  p_due_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_transaction_id UUID;
    v_receipt_no TEXT;
    v_item JSONB;
    v_product_id UUID;
    v_product RECORD;
    v_qty INTEGER;
    v_unit_price BIGINT;
    v_item_discount BIGINT;
    v_item_subtotal BIGINT;
    v_payment_id UUID;
    v_change BIGINT := 0;
    v_sequence BIGINT;
    v_cashier_id UUID;
    v_shift_id UUID;
begin

    -- --------------------------------------------------------
    -- Basic validation
    -- --------------------------------------------------------

    IF p_items IS NULL
       OR jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0
    THEN
        RAISE EXCEPTION 'Transaction must contain at least one item';
    END IF;

    IF p_subtotal < 0
       OR p_discount < 0
       OR p_tax < 0
       OR p_total < 0
    THEN
        RAISE EXCEPTION 'Transaction amounts cannot be negative';
    END IF;

    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative';
    END IF;

    -- TEMPO wajib nama pelanggan + tanggal jatuh tempo (migration 006, PRD §17 T-02).
    IF p_payment_method = 'TEMPO' THEN
        IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
            RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
        END IF;

        IF p_due_date IS NULL THEN
            RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
        END IF;
    END IF;

    v_cashier_id := auth.uid();

    -- ── TAMBAHAN (T-04) ── Wajib shift aktif sebelum transaksi (PRD §17 T-04 DoD:
    -- "kasir tidak bisa transaksi sebelum buka shift"). Sengaja hanya ditegakkan kalau
    -- v_cashier_id diketahui (auth.uid() tidak NULL) — konsisten dengan pola cashier_id
    -- di migration 003: pemanggilan RPC di luar konteks user login (kalau memang ada)
    -- tidak ikut mendadak patah karena aturan shift ini.
    IF v_cashier_id IS NOT NULL THEN
        SELECT id
        INTO v_shift_id
        FROM shift_sessions
        WHERE cashier_id = v_cashier_id
          AND status = 'OPEN'
        LIMIT 1;

        IF v_shift_id IS NULL THEN
            RAISE EXCEPTION
                'Anda belum membuka shift kasir. Buka shift terlebih dahulu sebelum bertransaksi.';
        END IF;
    END IF;


    -- --------------------------------------------------------
    -- Generate receipt sequence
    --
    -- Sequence is monthly:
    -- LCO-STR/26/09/000001
    -- LCO-STR/26/09/000002
    -- --------------------------------------------------------

    SELECT COALESCE(
        MAX(
            split_part(receipt_no, '/', 4)::BIGINT
        ),
        0
    ) + 1
    INTO v_sequence
    FROM transactions
    WHERE receipt_no LIKE
        'LCO-STR/'
        || TO_CHAR(NOW(), 'YY')
        || '/'
        || TO_CHAR(NOW(), 'MM')
        || '/%';

    v_receipt_no :=
        'LCO-STR/'
        || TO_CHAR(NOW(), 'YY')
        || '/'
        || TO_CHAR(NOW(), 'MM')
        || '/'
        || LPAD(v_sequence::TEXT, 6, '0');


    -- --------------------------------------------------------
    -- Create transaction header
    -- ── TAMBAHAN (T-04) ── kolom shift_id diisi dari v_shift_id.
    -- --------------------------------------------------------

    INSERT INTO transactions (
        receipt_no,
        status,
        subtotal,
        discount,
        tax,
        total,
        customer_name,
        notes,
        cashier_id,
        shift_id
    )
    VALUES (
        v_receipt_no,
        'PAID',
        p_subtotal,
        p_discount,
        p_tax,
        p_total,
        p_customer_name,
        p_notes,
        v_cashier_id,
        v_shift_id
    )
    RETURNING id INTO v_transaction_id;


    -- --------------------------------------------------------
    -- Process transaction items
    -- --------------------------------------------------------

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP

        v_product_id :=
            (v_item->>'product_id')::UUID;

        v_qty :=
            (v_item->>'qty')::INTEGER;

        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION
                'Invalid quantity for product %',
                v_product_id;
        END IF;


        -- Lock the product row while checking stock.
        SELECT *
        INTO v_product
        FROM products
        WHERE id = v_product_id
          AND is_active = TRUE
          AND deleted_at IS NULL
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Product % is not available',
                v_product_id;
        END IF;


        -- ----------------------------------------------------
        -- Services have unlimited stock.
        -- ----------------------------------------------------

        IF NOT (
            v_product.is_service = TRUE
            OR v_product.type = 'JASA'
        ) THEN

            IF COALESCE(v_product.stock, 0) < v_qty THEN
                RAISE EXCEPTION
                    'Insufficient stock for product "%". Available: %, requested: %',
                    v_product.name,
                    COALESCE(v_product.stock, 0),
                    v_qty;
            END IF;

            UPDATE products
            SET
                stock = stock - v_qty,
                updated_at = NOW()
            WHERE id = v_product_id;

        END IF;


        -- ----------------------------------------------------
        -- Item amounts
        -- ----------------------------------------------------

        v_unit_price :=
            COALESCE(
                (v_item->>'unit_price')::BIGINT,
                v_product.sell_price
            );

        v_item_discount :=
            COALESCE(
                (v_item->>'discount')::BIGINT,
                0
            );

        v_item_subtotal :=
            COALESCE(
                (v_item->>'subtotal')::BIGINT,
                (v_unit_price * v_qty) - v_item_discount
            );


        -- ----------------------------------------------------
        -- Save transaction item snapshot
        -- ----------------------------------------------------

        INSERT INTO transaction_items (
            transaction_id,
            product_id,
            product_name,
            sku,
            unit,
            qty,
            unit_price,
            discount,
            subtotal
        )
        VALUES (
            v_transaction_id,
            v_product.id,
            v_product.name,
            v_product.sku,
            v_product.unit,
            v_qty,
            v_unit_price,
            v_item_discount,
            v_item_subtotal
        );

    END LOOP;


    -- --------------------------------------------------------
    -- Cash change
    -- --------------------------------------------------------

    IF p_payment_method = 'CASH' THEN

        IF p_received_amount IS NULL THEN
            RAISE EXCEPTION
                'Received amount is required for cash payment';
        END IF;

        IF p_received_amount < p_total THEN
            RAISE EXCEPTION
                'Cash received is insufficient';
        END IF;

        v_change :=
            p_received_amount - p_total;

    END IF;


    -- --------------------------------------------------------
    -- Save payment
    -- --------------------------------------------------------

    INSERT INTO payments (
        transaction_id,
        method,
        amount,
        received_amount,
        change_amount,
        due_date
    )
    VALUES (
        v_transaction_id,
        p_payment_method,
        p_payment_amount,
        p_received_amount,
        v_change,
        CASE WHEN p_payment_method = 'TEMPO' THEN p_due_date ELSE NULL END
    )
    RETURNING id INTO v_payment_id;


    -- --------------------------------------------------------
    -- Return result
    -- ── TAMBAHAN (T-04) ── shift_id disertakan di response, disiapkan untuk
    -- KasirModule.tsx kalau nanti perlu tampilkan info shift berjalan di layar Kasir.
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'success', TRUE,
        'transaction_id', v_transaction_id,
        'receipt_no', v_receipt_no,
        'payment_id', v_payment_id,
        'change_amount', v_change,
        'shift_id', v_shift_id
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION
            'Failed to generate unique receipt number. Please retry the transaction';

    WHEN OTHERS THEN
        RAISE;
END;
$function$;
