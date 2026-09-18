-- Migration: RPC create_transaction menerima & menyimpan nomor HP pelanggan
-- (PRD §4.2 "Identitas pelanggan (opsional per transaksi): nama + no. HP" dan
-- §4.7 "kirim struk via WhatsApp"). Langkah pertama dari task PROGRESS.md
-- "Task berikutnya" poin 10: field HP dulu, baru tombol "Kirim WA" di layar
-- sukses Kasir.
--
-- ── Kenapa migration ini perlu ──
-- Kolom `transactions.customer_phone` SUDAH ADA sejak migration 001, dan
-- SUDAH dibaca `getTransactionDetail()` (dipakai tombol "Kirim WA" di
-- TransactionDetailModal.tsx, Riwayat Transaksi). Tapi RPC `create_transaction`
-- (terakhir di-`create or replace` migration 009 untuk T-05) tidak pernah
-- punya parameter untuk menerima nilainya — kolom itu SELALU NULL untuk
-- transaksi baru. Migration ini HANYA menambah parameter baru; tidak ada
-- perubahan skema tabel (kolomnya sudah ada).
--
-- ── Keputusan desain ──
-- 1. Parameter baru `p_customer_phone` ditambahkan di AKHIR daftar parameter
--    dengan `default null::text` — aman untuk `create or replace function`
--    (tidak mengubah urutan/tipe parameter yang sudah ada) dan tidak
--    mem-break pemanggil lama yang belum kirim nilainya. Frontend
--    (`transactionApi.ts`) memanggil `supabase.rpc()` dengan named
--    parameters (object), jadi urutan penambahan ini tidak relevan di sisi
--    JS sama sekali.
-- 2. TIDAK wajib diisi untuk metode pembayaran manapun (termasuk TEMPO) —
--    PRD §4.2 eksplisit menulis "opsional per transaksi". Validasi nama +
--    jatuh tempo untuk TEMPO (sudah ada sejak migration 006) tidak disentuh.
-- 3. Tidak ada normalisasi/format nomor di level RPC (mis. paksa awalan 62) —
--    disimpan apa adanya seperti yang dikirim UI. Sanitasi ke format
--    `62xxx` untuk kebutuhan `wa.me` sudah ada di
--    `sanitizeIndonesianWaNumber()` (lib/pos/printLogic.ts), dilakukan saat
--    KIRIM, bukan saat SIMPAN — supaya nomor yang tersimpan tetap apa adanya
--    kalau suatu saat perlu ditampilkan balik ke kasir/pelanggan.
-- 4. Isi lain fungsi disalin persis dari migration 009 (tidak ada perubahan
--    logika lain) — pola yang sama dengan migration 009 sendiri terhadap 007,
--    supaya file ini tetap bisa dibaca sebagai versi terbaru yang utuh tanpa
--    menelusuri banyak migration.

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
  p_due_date date default null::date,
  p_customer_phone text default null::text
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
    -- ── TAMBAHAN (013) ── kolom customer_phone diisi dari p_customer_phone
    -- (sebelumnya selalu NULL untuk transaksi baru — lihat komentar header
    -- migration ini).
    -- --------------------------------------------------------

    INSERT INTO transactions (
        receipt_no,
        status,
        subtotal,
        discount,
        tax,
        total,
        customer_name,
        customer_phone,
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
        p_customer_phone,
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

            -- Jejak audit mutasi stok untuk penjualan (T-05). qty_delta NEGATIF
            -- (stok berkurang), reference_id = transaksi ini, reason NULL
            -- (mutasi otomatis, referensinya sudah jelas dari nomor struk).
            -- Produk JASA sengaja TIDAK dicatat: stoknya memang tak terbatas.
            INSERT INTO stock_movements (
                product_id, type, qty_delta, reference_id, reason, created_by
            )
            VALUES (
                v_product_id, 'sale', -v_qty, v_transaction_id, NULL, v_cashier_id
            );

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

comment on function public.create_transaction(
  jsonb, bigint, bigint, bigint, bigint, text, text, payment_method, bigint,
  bigint, date, text
) is
  'Simpan transaksi + item + pembayaran secara atomik, kurangi stok & catat stock_movements. p_customer_phone (baru, migration 013) opsional untuk semua metode pembayaran — dipakai fitur "Kirim WA" di layar sukses Kasir.';
