-- Migration: Pembayaran lengkap per metode (PRD §17 T-02).
--
-- ── TEMUAN PENTING (bukan bagian rencana awal T-02, tapi WAJIB diperbaiki di sini
-- supaya T-02 bisa jalan sama sekali) ──
-- Enum Postgres `payment_method` yang asli (dibuat lewat scripts/setup-database.sql,
-- lihat komentar di sana) cuma berisi: 'tunai', 'transfer', 'QRIS', 'CASH', 'lainnya'.
-- Padahal SELURUH kode frontend (transactionApi.ts, KasirModule.tsx, PaymentModal.tsx,
-- TransactionDetailModal.tsx, printLogic.ts, hooks/useTransactions.ts) sudah lama
-- memakai konvensi 'CASH' | 'BANK_TRANSFER' | 'QRIS' | 'TEMPO'. Karena 'BANK_TRANSFER'
-- dan 'TEMPO' TIDAK ADA di enum, RPC create_transaction akan langsung gagal
-- ("invalid input value for enum payment_method") setiap kali dipanggil dengan salah
-- satu dari 2 metode itu — berarti sebelum migration ini, transfer & tempo memang
-- belum pernah bisa checkout sama sekali (baru CASH yang benar-benar teruji end-to-end
-- di sesi T-01). Diperbaiki di bagian 1 di bawah, bukan mengubah konvensi frontend
-- (frontend yang sudah konsisten dipertahankan, enum database yang menyusul).
--
-- Keputusan desain lain:
-- 1. `due_date` ditaruh di `payments` (bukan `transactions`) — karena due date memang
--    milik satu baris pembayaran TEMPO, bukan atribut transaksi secara umum.
-- 2. Validasi "nama pelanggan wajib + jatuh tempo wajib untuk TEMPO" ditaruh di RPC
--    create_transaction (bukan cuma di client) sesuai Aturan Main #5 (logika uang/status
--    di RPC SECURITY DEFINER, client cuma validasi ringan UX) — supaya tidak bisa
--    dilewati dari luar UI Kasir.
-- 3. `payment_proofs` sengaja multi-file (1 payment bisa >1 bukti, PRD §6) dan diisi
--    dari CLIENT langsung (bukan RPC) karena upload file ke Storage tidak bisa dilakukan
--    dari plpgsql — client upload ke bucket dulu, baru insert 1 baris metadata per file
--    lewat supabase-js biasa (RLS di bawah yang menjaga, bukan RPC).
-- 4. TIDAK menambah kolom status "lunas/belum" untuk piutang TEMPO di migration ini —
--    itu scope Laporan Piutang (T-08, "Jangan dulu" persis di PRD §17 T-02). Untuk T-02,
--    "label piutang di riwayat" cukup diturunkan di UI dari `method = 'TEMPO'` + `due_date`,
--    tidak perlu kolom baru.

-- --------------------------------------------------------
-- 1. Enum payment_method: tambah nilai yang sudah dipakai frontend tapi belum ada di DB
-- --------------------------------------------------------

alter type public.payment_method add value if not exists 'BANK_TRANSFER';
alter type public.payment_method add value if not exists 'TEMPO';

-- --------------------------------------------------------
-- 2. Kolom due_date di payments (wajib untuk TEMPO, divalidasi di RPC bagian 5)
-- --------------------------------------------------------

alter table public.payments
  add column if not exists due_date date;

comment on column public.payments.due_date is
  'Tanggal jatuh tempo, wajib diisi untuk method = TEMPO (divalidasi di RPC create_transaction). NULL untuk method lain.';

-- --------------------------------------------------------
-- 3. Tabel payment_proofs — bukti transfer/QRIS, multi-file per payment (PRD §6)
-- --------------------------------------------------------

create table if not exists public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  file_url text not null,
  file_name text,
  file_size bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.payment_proofs is
  'Bukti pembayaran (foto transfer/QRIS), multi-file per payment. File fisik di Storage bucket "payment-proofs", baris ini cuma metadata + URL.';

alter table public.payment_proofs enable row level security;

-- RLS baca: semua user aktif (sama seperti akses baca transaksi/payments hari ini —
-- catatan: tabel `payments`/`transactions` sendiri BELUM punya RLS sama sekali, lihat
-- PROGRESS.md bagian "Temuan" sesi ini; payment_proofs sengaja tetap diberi RLS supaya
-- tabel baru tidak menambah lubang baru, walau tabel lama belum konsisten).
drop policy if exists "payment_proofs_select_active_users" on public.payment_proofs;
create policy "payment_proofs_select_active_users"
  on public.payment_proofs for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- RLS tulis: user aktif manapun boleh insert (kasir upload bukti saat checkout).
-- Tidak ada policy update/delete sengaja — bukti pembayaran tidak boleh diubah/dihapus
-- dari client sama sekali (integritas audit); admin yang perlu bisa lewat Supabase Dashboard.
drop policy if exists "payment_proofs_insert_active_users" on public.payment_proofs;
create policy "payment_proofs_insert_active_users"
  on public.payment_proofs for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 4. Storage bucket "payment-proofs" + policy
-- --------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', true)
on conflict (id) do nothing;

-- Bucket public=true supaya URL publik bukti pembayaran bisa langsung ditampilkan di
-- TransactionDetailModal tanpa signed URL (sama seperti pola photo_url produk nanti).
-- Policy di bawah cuma mengatur akses lewat Storage API (list/insert), bukan lewat
-- URL publik langsung (itu otomatis diizinkan karena bucket public).

drop policy if exists "payment_proofs_storage_select" on storage.objects;
create policy "payment_proofs_storage_select"
  on storage.objects for select
  using (bucket_id = 'payment-proofs');

drop policy if exists "payment_proofs_storage_insert" on storage.objects;
create policy "payment_proofs_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 5. RPC create_transaction — tambah parameter p_due_date + validasi TEMPO
--    (pola sama seperti migration 003: CREATE OR REPLACE, isi lain tidak diubah)
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

    -- ── TAMBAHAN (T-02) ── TEMPO wajib nama pelanggan + tanggal jatuh tempo (PRD §17 T-02).
    -- Divalidasi di RPC (bukan cuma client) supaya tidak bisa dilewati.
    IF p_payment_method = 'TEMPO' THEN
        IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
            RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
        END IF;

        IF p_due_date IS NULL THEN
            RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
        END IF;
    END IF;

    v_cashier_id := auth.uid();


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
        cashier_id
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
        v_cashier_id
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
    -- ── TAMBAHAN (T-02) ── kolom due_date, diisi hanya kalau TEMPO (NULL untuk method lain).
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
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'success', TRUE,
        'transaction_id', v_transaction_id,
        'receipt_no', v_receipt_no,
        'payment_id', v_payment_id,
        'change_amount', v_change
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION
            'Failed to generate unique receipt number. Please retry the transaction';

    WHEN OTHERS THEN
        RAISE;
END;
$function$;
