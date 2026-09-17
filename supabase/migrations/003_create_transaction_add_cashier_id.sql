-- ── KOREKSI ── Tambah cashier_id ke transactions, diisi otomatis dari auth.uid()
-- pemanggil RPC. Tidak ada perubahan lain di logic (stok, item, payment tetap sama).
-- auth.uid() tetap valid dibaca walau function ini SECURITY DEFINER — itu ambil dari
-- JWT request, bukan dari role eksekusi function.

CREATE OR REPLACE FUNCTION public.create_transaction(p_items jsonb, p_subtotal bigint, p_discount bigint DEFAULT 0, p_tax bigint DEFAULT 0, p_total bigint DEFAULT 0, p_customer_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payment_method payment_method DEFAULT 'CASH'::payment_method, p_payment_amount bigint DEFAULT 0, p_received_amount bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
BEGIN

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

    -- ── TAMBAHAN ── ambil user yang sedang login lewat RPC ini.
    -- Sengaja TIDAK di-hard-block kalau NULL dulu (misal dipanggil dari service role
    -- tanpa konteks user) — supaya tidak tiba-tiba mematahkan RPC ini kalau ada
    -- pemanggilan lain di luar layar Kasir. Kalau kamu mau wajibkan, tinggal uncomment
    -- blok IF di bawah ini setelah yakin semua pemanggilan RPC sudah lewat user login.
    v_cashier_id := auth.uid();

    -- IF v_cashier_id IS NULL THEN
    --     RAISE EXCEPTION 'Transaction must be created by an authenticated user';
    -- END IF;


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
    -- --------------------------------------------------------

    INSERT INTO payments (
        transaction_id,
        method,
        amount,
        received_amount,
        change_amount
    )
    VALUES (
        v_transaction_id,
        p_payment_method,
        p_payment_amount,
        p_received_amount,
        v_change
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
$function$
