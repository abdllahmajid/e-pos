--
-- PostgreSQL database dump
--

\restrict oWH8CHzofmMEf9Bd7scptZJ3TU8UoDgFeMnb8uHmelWiA5vhMFyyaBRBVjTuZtv

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'tunai',
    'transfer',
    'QRIS',
    'lainnya',
    'CASH',
    'BANK_TRANSFER',
    'TEMPO'
);


--
-- Name: product_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_type AS ENUM (
    'FASHION',
    'SABLON',
    'KONVEKSI',
    'PERCETAKAN',
    'MERCHANDISE',
    'PARFUM',
    'JASA'
);


--
-- Name: transaction_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.transaction_status AS ENUM (
    'selesai',
    'retur',
    'void',
    'pending',
    'PAID',
    'RETURN',
    'VOID'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'kasir',
    'owner',
    'supervisor'
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: adjust_stock(uuid, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: FUNCTION adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text) IS 'Opname (p_value = hasil hitung fisik) / penyesuaian manual (p_value = selisih +/-). Admin & supervisor saja, alasan wajib, stok tidak boleh jadi minus. Sekali jalan: update products.stock + insert stock_movements.';


--
-- Name: admin_set_user_active(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_user_active(p_user_id uuid, p_is_active boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caller_role public.user_role;
  v_target record;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if v_caller_role is null or v_caller_role not in ('admin', 'supervisor') then
    raise exception 'Anda tidak punya izin untuk mengubah status user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa menonaktifkan diri sendiri — minta admin/supervisor lain melakukannya';
  end if;

  select id, full_name, role, is_active into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  if v_caller_role = 'supervisor' and v_target.role = 'admin' then
    raise exception 'Supervisor tidak bisa mengaktifkan/menonaktifkan akun admin';
  end if;

  if v_target.is_active = p_is_active then
    raise exception 'User sudah dalam status tersebut';
  end if;

  update public.profiles
  set is_active = p_is_active
  where id = p_user_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(),
    case when p_is_active then 'user_activate' else 'user_deactivate' end,
    'user', p_user_id,
    jsonb_build_object('target_name', v_target.full_name, 'changed_by_role', v_caller_role)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'is_active', p_is_active
  );
end;
$$;


--
-- Name: FUNCTION admin_set_user_active(p_user_id uuid, p_is_active boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_set_user_active(p_user_id uuid, p_is_active boolean) IS 'Aktifkan/nonaktifkan user — admin+supervisor (migration 018, sebelumnya admin-only di migration 016). Tidak bisa untuk diri sendiri. Supervisor tidak bisa menyentuh akun admin. Tercatat activity_logs. PRD §17 T-10.';


--
-- Name: admin_update_user_role(uuid, public.user_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_user_role(p_user_id uuid, p_new_role public.user_role) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caller_role public.user_role;
  v_target record;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if v_caller_role is null or v_caller_role not in ('admin', 'supervisor') then
    raise exception 'Anda tidak punya izin untuk mengubah role user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa mengubah role diri sendiri — minta admin/supervisor lain melakukannya';
  end if;

  select id, full_name, role into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  if v_caller_role = 'supervisor' then
    if v_target.role = 'admin' then
      raise exception 'Supervisor tidak bisa mengubah role akun admin';
    end if;
    if p_new_role = 'admin' then
      raise exception 'Supervisor tidak bisa menjadikan user sebagai admin';
    end if;
  end if;

  if v_target.role = p_new_role then
    raise exception 'User sudah memiliki role tersebut';
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_user_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'user_role_change', 'user', p_user_id,
    jsonb_build_object(
      'target_name', v_target.full_name,
      'old_role', v_target.role,
      'new_role', p_new_role,
      'changed_by_role', v_caller_role
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_role', v_target.role,
    'new_role', p_new_role
  );
end;
$$;


--
-- Name: FUNCTION admin_update_user_role(p_user_id uuid, p_new_role public.user_role); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_update_user_role(p_user_id uuid, p_new_role public.user_role) IS 'Ubah role user — admin+supervisor (migration 018, sebelumnya admin-only di migration 016). Tidak bisa untuk diri sendiri. Supervisor tidak bisa menyentuh/membuat akun admin. Tercatat activity_logs. PRD §17 T-10.';


--
-- Name: clear_my_fcm_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_my_fcm_token(p_token text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Tidak ada sesi login';
  end if;

  if p_token is null then
    update public.profiles
    set fcm_token = null,
        fcm_token_updated_at = now()
    where id = auth.uid();
  else
    update public.profiles
    set fcm_token = null,
        fcm_token_updated_at = now()
    where id = auth.uid()
      and fcm_token = p_token;
  end if;

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: FUNCTION clear_my_fcm_token(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.clear_my_fcm_token(p_token text) IS 'Hapus registration token FCM milik pemanggil sendiri (dipakai saat logout). Kalau p_token diisi, hanya menghapus bila persis cocok dengan token tersimpan saat ini — supaya logout di satu perangkat tidak ikut menghapus token perangkat lain yang sudah menimpanya. Sengaja tidak mensyaratkan is_active, supaya tetap bisa dipanggil saat akun sedang dinonaktifkan. PRD §17 T-12, migration 023.';


--
-- Name: close_shift(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_shift(p_shift_id uuid, p_actual_cash bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_shift RECORD;
    v_caller_id UUID;
    v_is_supervisor BOOLEAN := FALSE;
    v_cash_sales BIGINT := 0;
    v_expected_cash BIGINT;
    v_difference BIGINT;
begin

    v_caller_id := auth.uid();

    IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
        RAISE EXCEPTION 'Nominal kas fisik tidak valid';
    END IF;

    -- Lock baris shift supaya tidak bisa ditutup dobel kalau tombol "Tutup Shift"
    -- ke-klik 2x hampir bersamaan (race condition).
    SELECT *
    INTO v_shift
    FROM shift_sessions
    WHERE id = p_shift_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift tidak ditemukan';
    END IF;

    IF v_shift.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Shift ini sudah ditutup sebelumnya';
    END IF;

    -- Permission: pemilik shift sendiri, atau admin/supervisor (force-close).
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = v_caller_id
          AND profiles.role IN ('admin', 'supervisor')
          AND profiles.is_active = TRUE
    )
    INTO v_is_supervisor;

    IF v_shift.cashier_id <> v_caller_id AND NOT v_is_supervisor THEN
        RAISE EXCEPTION 'Anda tidak berhak menutup shift ini';
    END IF;

    -- --------------------------------------------------------
    -- Total penjualan TUNAI selama shift ini. Hanya method = 'CASH' yang masuk
    -- hitungan kas fisik di laci — transfer/QRIS/TEMPO tidak menambah uang tunai.
    -- Transaksi VOID/RETURN tidak ikut dihitung (status <> 'PAID').
    -- --------------------------------------------------------

    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_cash_sales
    FROM payments p
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.shift_id = p_shift_id
      AND p.method = 'CASH'
      AND t.status = 'PAID';

    v_expected_cash := v_shift.opening_cash + v_cash_sales;
    v_difference := p_actual_cash - v_expected_cash;

    UPDATE shift_sessions
    SET
        closed_at = NOW(),
        expected_cash = v_expected_cash,
        actual_cash = p_actual_cash,
        difference = v_difference,
        status = 'CLOSED'
    WHERE id = p_shift_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'shift_id', p_shift_id,
        'opening_cash', v_shift.opening_cash,
        'cash_sales', v_cash_sales,
        'expected_cash', v_expected_cash,
        'actual_cash', p_actual_cash,
        'difference', v_difference
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$;


--
-- Name: create_transaction(jsonb, bigint, bigint, bigint, bigint, text, text, public.payment_method, bigint, bigint, date, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_transaction(p_items jsonb, p_subtotal bigint, p_discount bigint DEFAULT 0, p_tax bigint DEFAULT 0, p_total bigint DEFAULT 0, p_customer_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payment_method public.payment_method DEFAULT 'CASH'::public.payment_method, p_payment_amount bigint DEFAULT 0, p_received_amount bigint DEFAULT NULL::bigint, p_due_date date DEFAULT NULL::date, p_customer_phone text DEFAULT NULL::text, p_payments jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    -- ── TAMBAHAN (021) ── variabel khusus split payment
    v_is_split BOOLEAN;
    v_split_line JSONB;
    v_line_method payment_method;
    v_line_amount BIGINT;
    v_line_received BIGINT;
    v_line_due_date DATE;
    v_line_change BIGINT;
    v_line_payment_id UUID;
    v_payments_sum BIGINT := 0;
    v_payments_result JSONB := '[]'::jsonb;
    v_seen_methods payment_method[] := array[]::payment_method[];
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

    -- ── TAMBAHAN (021) ── Transaksi dianggap split kalau p_payments array
    -- tidak kosong. Array kosong ('[]') maupun NULL SAMA-SAMA dianggap
    -- pembayaran tunggal (bukan error) — client memang tidak pernah
    -- mengirim array kosong (validateSplitPayments menolak duluan), tapi
    -- lebih aman ditulis longgar begini daripada RPC ikut menolak diam-diam.
    v_is_split :=
        p_payments IS NOT NULL
        AND jsonb_typeof(p_payments) = 'array'
        AND jsonb_array_length(p_payments) > 0;

    IF v_is_split THEN

        -- ── TAMBAHAN (021) ── Validasi split payment. Lihat keputusan
        -- desain poin 4 di komentar header migration ini.

        IF jsonb_array_length(p_payments) > 4 THEN
            RAISE EXCEPTION 'Maksimal 4 metode pembayaran per transaksi';
        END IF;

        FOR v_split_line IN
            SELECT value
            FROM jsonb_array_elements(p_payments)
        LOOP

            v_line_method := (v_split_line->>'method')::payment_method;
            v_line_amount := (v_split_line->>'amount')::BIGINT;

            IF v_line_method = ANY(v_seen_methods) THEN
                RAISE EXCEPTION
                    'Metode pembayaran % dipakai lebih dari sekali',
                    v_line_method;
            END IF;
            v_seen_methods := array_append(v_seen_methods, v_line_method);

            IF v_line_amount IS NULL OR v_line_amount <= 0 THEN
                RAISE EXCEPTION
                    'Nominal pembayaran metode % tidak valid',
                    v_line_method;
            END IF;
            v_payments_sum := v_payments_sum + v_line_amount;

            IF v_line_method = 'CASH' THEN
                v_line_received := (v_split_line->>'received_amount')::BIGINT;
                IF v_line_received IS NULL OR v_line_received < v_line_amount THEN
                    RAISE EXCEPTION
                        'Uang tunai yang diterima kurang dari porsi tunai';
                END IF;
            END IF;

            IF v_line_method = 'TEMPO' THEN
                IF (v_split_line->>'due_date') IS NULL THEN
                    RAISE EXCEPTION
                        'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
                END IF;
                IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
                    RAISE EXCEPTION
                        'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
                END IF;
            END IF;

        END LOOP;

        IF v_payments_sum <> p_total THEN
            RAISE EXCEPTION
                'Jumlah pembayaran (%) tidak sama dengan total transaksi (%)',
                v_payments_sum, p_total;
        END IF;

    ELSE

        -- TEMPO wajib nama pelanggan + tanggal jatuh tempo (migration 006,
        -- PRD §17 T-02) — jalur pembayaran tunggal, tidak berubah.
        IF p_payment_method = 'TEMPO' THEN
            IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
                RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
            END IF;

            IF p_due_date IS NULL THEN
                RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
            END IF;
        END IF;

    END IF;

    v_cashier_id := auth.uid();

    -- Wajib shift aktif sebelum transaksi (PRD §17 T-04 DoD). Tidak berubah
    -- dari migration 013 — berlaku sama untuk pembayaran tunggal maupun split.
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

            -- Jejak audit mutasi stok untuk penjualan (T-05).
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
    -- Save payment(s)
    -- ── TAMBAHAN (021) ── Dua jalur terpisah: split (banyak baris
    -- `payments`, satu per metode) vs tunggal (satu baris, logika lama
    -- persis migration 013). Blok tunggal SENGAJA dibungkus `NOT v_is_split`
    -- — kalau tidak, default `p_payment_method = 'CASH'` bawaan parameter
    -- akan salah kebaca sebagai instruksi sungguhan saat mode split (lihat
    -- keputusan desain poin 2 di komentar header migration ini).
    -- --------------------------------------------------------

    IF v_is_split THEN

        FOR v_split_line IN
            SELECT value
            FROM jsonb_array_elements(p_payments)
        LOOP

            v_line_method := (v_split_line->>'method')::payment_method;
            v_line_amount := (v_split_line->>'amount')::BIGINT;

            v_line_received :=
                CASE WHEN v_line_method = 'CASH'
                     THEN (v_split_line->>'received_amount')::BIGINT
                     ELSE NULL
                END;

            v_line_due_date :=
                CASE WHEN v_line_method = 'TEMPO'
                     THEN (v_split_line->>'due_date')::DATE
                     ELSE NULL
                END;

            v_line_change := 0;
            IF v_line_method = 'CASH' THEN
                v_line_change := v_line_received - v_line_amount;
                v_change := v_change + v_line_change;
            END IF;

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
                v_line_method,
                v_line_amount,
                v_line_received,
                v_line_change,
                v_line_due_date
            )
            RETURNING id INTO v_line_payment_id;

            -- payment_id top-level (kompatibilitas pemanggil lama) = baris
            -- PERTAMA sesuai urutan input, bukan baris "termahal"/CASH.
            IF v_payment_id IS NULL THEN
                v_payment_id := v_line_payment_id;
            END IF;

            v_payments_result := v_payments_result || jsonb_build_array(
                jsonb_build_object(
                    'payment_id', v_line_payment_id,
                    'method', v_line_method,
                    'amount', v_line_amount
                )
            );

        END LOOP;

    ELSE

        -- Cash change (jalur tunggal, persis migration 013)
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

        v_payments_result := jsonb_build_array(
            jsonb_build_object(
                'payment_id', v_payment_id,
                'method', p_payment_method,
                'amount', p_payment_amount
            )
        );

    END IF;


    -- --------------------------------------------------------
    -- Return result
    -- ── TAMBAHAN (021) ── field baru `payments` (array, urut sesuai input).
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'success', TRUE,
        'transaction_id', v_transaction_id,
        'receipt_no', v_receipt_no,
        'payment_id', v_payment_id,
        'payments', v_payments_result,
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
$$;


--
-- Name: FUNCTION create_transaction(p_items jsonb, p_subtotal bigint, p_discount bigint, p_tax bigint, p_total bigint, p_customer_name text, p_notes text, p_payment_method public.payment_method, p_payment_amount bigint, p_received_amount bigint, p_due_date date, p_customer_phone text, p_payments jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_transaction(p_items jsonb, p_subtotal bigint, p_discount bigint, p_tax bigint, p_total bigint, p_customer_name text, p_notes text, p_payment_method public.payment_method, p_payment_amount bigint, p_received_amount bigint, p_due_date date, p_customer_phone text, p_payments jsonb) IS 'Simpan transaksi + item + pembayaran secara atomik, kurangi stok & catat stock_movements. p_payments (baru, migration 021) opsional — array 1-4 baris {method,amount,received_amount,due_date} untuk split payment (T-11 bagian 2); kalau NULL, perilaku sama seperti migration 013 (satu metode via p_payment_method/p_payment_amount/dst).';


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS public.user_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true;
$$;


--
-- Name: FUNCTION current_user_role(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_user_role() IS 'Baca role user yang sedang login, bypass RLS (SECURITY DEFINER) — dipakai policy profiles_select_admin_supervisor/profiles_update_admin_supervisor supaya tidak query langsung ke profiles dari dalam policy profiles sendiri (itu penyebab "infinite recursion detected"). Return NULL kalau user tidak aktif/tidak ditemukan.';


--
-- Name: enforce_profiles_role_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_profiles_role_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caller_role public.user_role;
  v_caller_active boolean;
begin
  if new.role = old.role and new.is_active = old.is_active then
    return new;
  end if;

  select role, is_active into v_caller_role, v_caller_active
  from public.profiles
  where id = auth.uid();

  if v_caller_role is null
     or v_caller_role not in ('admin', 'supervisor')
     or v_caller_active is not true
  then
    raise exception 'Hanya admin atau supervisor aktif yang boleh mengubah role atau status aktif user';
  end if;

  -- Pengaman A & B (lihat komentar header migration ini): supervisor tidak
  -- boleh menyentuh akun yang SAAT INI admin, dan tidak boleh mempromosikan
  -- siapa pun jadi admin. Admin tidak kena batas ini sama sekali.
  if v_caller_role = 'supervisor' then
    if old.role = 'admin' then
      raise exception 'Supervisor tidak bisa mengubah role/status akun admin';
    end if;
    if new.role = 'admin' then
      raise exception 'Supervisor tidak bisa menjadikan user sebagai admin';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_profiles_role_change(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_profiles_role_change() IS 'Kunci perubahan kolom role/is_active di profiles kecuali pemanggil admin/supervisor aktif; supervisor tambahan dilarang menyentuh atau membuat akun admin. Lihat migration 016 (versi awal, admin-only) & 018 (revisi ini, pemilik project minta akses supervisor).';


--
-- Name: get_screen_playlist(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_screen_playlist(p_token text) RETURNS TABLE(id uuid, title text, media_type text, file_url text, duration_seconds integer, sort_order integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.id, m.title, m.media_type, m.file_url, m.duration_seconds, m.sort_order
  from public.promo_media m
  join public.promo_screens s on s.id = m.screen_id
  where s.access_token = p_token
    and s.is_active = true
    and m.is_active = true
  order by m.sort_order asc, m.id asc;
$$;


--
-- Name: FUNCTION get_screen_playlist(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_screen_playlist(p_token text) IS 'Satu-satunya jalan anon membaca media promosi (migration 027) — dipanggil app/tv/[access_token]/page.tsx (langkah berikutnya). Token salah ATAU layar nonaktif sama-sama menghasilkan 0 baris (tidak membedakan pesan, sengaja, lihat header migration).';


--
-- Name: get_transaction_by_receipt(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_transaction_by_receipt(p_receipt_no text, p_date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_transaction record;
  v_items jsonb;
begin
  if p_receipt_no is null or trim(p_receipt_no) = '' or p_date is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Nomor struk dan tanggal transaksi wajib diisi.'
    );
  end if;

  select
    t.id,
    t.receipt_no,
    t.status,
    t.subtotal,
    t.discount,
    t.tax,
    t.total,
    t.customer_name,
    t.void_reason,
    t.related_transaction_id,
    t.created_at
  into v_transaction
  from public.transactions t
  where t.receipt_no = trim(p_receipt_no)
    and (t.created_at at time zone 'Asia/Jakarta')::date = p_date
    and t.deleted_at is null
  limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Struk tidak ditemukan. Periksa kembali nomor struk dan tanggal transaksi.'
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_name', ti.product_name,
        'unit', ti.unit,
        'qty', ti.qty,
        'returned_qty', ti.returned_qty,
        'unit_price', ti.unit_price,
        'subtotal', ti.subtotal
      )
      order by ti.created_at
    ),
    '[]'::jsonb
  )
  into v_items
  from public.transaction_items ti
  where ti.transaction_id = v_transaction.id;

  return jsonb_build_object(
    'success', true,
    'receipt_no', v_transaction.receipt_no,
    'status', v_transaction.status,
    'created_at', v_transaction.created_at,
    'customer_name', v_transaction.customer_name,
    'subtotal', v_transaction.subtotal,
    'discount', v_transaction.discount,
    'tax', v_transaction.tax,
    'total', v_transaction.total,
    'void_reason', v_transaction.void_reason,
    'is_return_row', v_transaction.related_transaction_id is not null,
    'payment_method', (
      select p.method
      from public.payments p
      where p.transaction_id = v_transaction.id
      order by p.created_at
      limit 1
    ),
    'items', v_items
  );
end;
$$;


--
-- Name: FUNCTION get_transaction_by_receipt(p_receipt_no text, p_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_transaction_by_receipt(p_receipt_no text, p_date date) IS 'Lookup publik untuk halaman /cek-struk (PRD §4.9, §17 T-07). SECURITY DEFINER — sengaja bypass RLS lewat RPC yang divalidasi ketat (nomor struk + tanggal harus cocok), bukan lewat policy anon select langsung di transactions. Tidak pernah mengembalikan harga modal, nama kasir, atau detail bukti pembayaran.';


--
-- Name: reorder_promo_media(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reorder_promo_media(p_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'Hanya admin/supervisor yang boleh mengatur urutan media promosi.'
      using errcode = '42501';
  end if;

  -- Posisi (1, 2, 3, ...) mengikuti urutan elemen di p_ids. Baris yang tidak
  -- disebut di p_ids tidak disentuh.
  update public.promo_media m
     set sort_order = t.pos::integer
    from unnest(p_ids) with ordinality as t(id, pos)
   where m.id = t.id;
end;
$$;


--
-- Name: FUNCTION reorder_promo_media(p_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reorder_promo_media(p_ids uuid[]) IS 'Tulis ulang sort_order media promosi sesuai urutan array id (posisi mulai 1). Hanya admin/supervisor. Migration 026.';


--
-- Name: restore_product(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_product(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: FUNCTION restore_product(p_product_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.restore_product(p_product_id uuid) IS 'Pulihkan produk dari Sampah (kosongkan deleted_at) — admin+supervisor (dilonggarkan migration 015).';


--
-- Name: restore_transaction(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_transaction(p_transaction_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: FUNCTION restore_transaction(p_transaction_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.restore_transaction(p_transaction_id uuid) IS 'Pulihkan transaksi dari Sampah (kosongkan deleted_at) — admin+supervisor (dilonggarkan migration 015).';


--
-- Name: return_transaction(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.return_transaction(p_transaction_id uuid, p_items jsonb, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: save_my_fcm_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_my_fcm_token(p_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caller_active boolean;
begin
  select is_active into v_caller_active
  from public.profiles
  where id = auth.uid();

  if v_caller_active is not true then
    raise exception 'Sesi tidak valid atau akun tidak aktif';
  end if;

  if p_token is null or length(trim(p_token)) < 32 then
    raise exception 'Token FCM tidak valid (kosong atau terlalu pendek)';
  end if;

  if length(p_token) > 4096 then
    raise exception 'Token FCM tidak valid (terlalu panjang)';
  end if;

  -- Cabut dulu dari profil LAIN yang kebetulan masih memegang token yang
  -- sama persis — harus terjadi SEBELUM baris di bawah supaya tidak
  -- bentrok dengan unique index di atas.
  update public.profiles
  set fcm_token = null,
      fcm_token_updated_at = now()
  where fcm_token = p_token
    and id <> auth.uid();

  update public.profiles
  set fcm_token = p_token,
      fcm_token_updated_at = now()
  where id = auth.uid();

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: FUNCTION save_my_fcm_token(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.save_my_fcm_token(p_token text) IS 'Simpan registration token FCM milik pemanggil ke profiles.fcm_token, dan cabut token yang sama dari profil user LAIN kalau ada (tablet kasir dipakai bergantian). Menolak token kosong/<32/>4096 karakter dan pemanggil yang tidak aktif. security definer karena perlu mengubah baris profil user lain, bukan cuma baris sendiri (RLS profiles_update_own tidak cukup). PRD §17 T-12, migration 023.';


--
-- Name: settle_receivable(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_receivable(p_payment_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_payment record;
  v_active boolean;
begin
  select true into v_active
  from public.profiles
  where id = auth.uid() and is_active = true;

  if v_active is distinct from true then
    raise exception 'Anda tidak punya izin untuk mencatat pelunasan';
  end if;

  select id, method, is_settled
  into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Data pembayaran tidak ditemukan';
  end if;

  if v_payment.method <> 'TEMPO' then
    raise exception 'Hanya pembayaran TEMPO yang bisa ditandai lunas';
  end if;

  if v_payment.is_settled then
    raise exception 'Piutang ini sudah ditandai lunas sebelumnya';
  end if;

  update public.payments
  set is_settled = true,
      settled_at = now(),
      settled_by = auth.uid()
  where id = p_payment_id;

  return jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'settled_at', now()
  );
end;
$$;


--
-- Name: FUNCTION settle_receivable(p_payment_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.settle_receivable(p_payment_id uuid) IS 'Satu-satunya jalur menandai piutang TEMPO lunas (PRD §17 T-08, §4.7). SECURITY DEFINER karena payments tidak punya policy update langsung (migration 011). Role: SEMUA user aktif boleh — lihat catatan keputusan #3 di header migration ini, ubah di sini kalau PRD ternyata membatasi ke role tertentu.';


--
-- Name: soft_delete_product(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.soft_delete_product(p_product_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: FUNCTION soft_delete_product(p_product_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.soft_delete_product(p_product_id uuid, p_reason text) IS 'Soft-delete produk (isi deleted_at) — admin+supervisor (dilonggarkan migration 015). Alasan opsional, dicatat di activity_logs kalau diisi.';


--
-- Name: soft_delete_transaction(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.soft_delete_transaction(p_transaction_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: FUNCTION soft_delete_transaction(p_transaction_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.soft_delete_transaction(p_transaction_id uuid, p_reason text) IS 'Soft-delete transaksi (isi deleted_at) — admin+supervisor (dilonggarkan migration 015). TIDAK mengubah stok/status, murni sembunyikan dari tampilan normal.';


--
-- Name: void_transaction(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_transaction(p_transaction_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_lifecycle_service_role(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_lifecycle_service_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
  IF current_user::text IS DISTINCT FROM TG_ARGV[0]
     AND (
       OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
       OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation
     ) THEN
    -- AFTER runs only after caller RLS has accepted the proposed row. The API
    -- recognizes this specific error after rolling back its permission probe;
    -- direct non-service writes still fail and cannot persist the change.
    RAISE EXCEPTION 'bucket control columns may only be changed by the configured storage service role'
      USING ERRCODE = 'PST01',
            SCHEMA = TG_TABLE_SCHEMA,
            TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_NAME;
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN p_delimiter <> ''
         AND position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(
        p_key,
        length(p_prefix)
            + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1))
            + length(p_delimiter) - 1
    )
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket(noncurrent_versions text DEFAULT 'include'::text, delete_markers text DEFAULT 'include'::text) RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'include');
    delete_markers := COALESCE(delete_markers, 'include');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'include';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'include';
    END IF;

    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        where (noncurrent_versions != 'exclude' OR obj.archived_at IS NULL)
          and (noncurrent_versions != 'only' OR obj.archived_at IS NOT NULL)
          and (delete_markers != 'exclude' OR NOT obj.is_delete_marker)
          and (delete_markers != 'only' OR obj.is_delete_marker)
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text, raw_prefix_param text DEFAULT NULL::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $_$
WITH candidates AS (
    SELECT
        upload.key AS object_key,
        CASE
            WHEN position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1)) > 0
            THEN left(
                upload.key,
                length(coalesce($7, $2))
                    + position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1))
                    + length($3) - 1
            )
            ELSE upload.key
        END AS result_key,
        upload.id,
        upload.created_at,
        position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1)) > 0 AS is_common_prefix
    FROM storage.s3_multipart_uploads AS upload
    WHERE upload.bucket_id = $1
      AND upload.key COLLATE "C" LIKE $2 || '%'
), filtered AS (
    SELECT candidate.*
    FROM candidates AS candidate
    WHERE $5 = ''
       OR candidate.result_key COLLATE "C" > $5
       OR (
           candidate.result_key COLLATE "C" = $5
           AND NOT candidate.is_common_prefix
           AND $6 <> ''
           -- A completed or aborted marker repeats the remaining same-key uploads.
           AND COALESCE(
               (candidate.created_at, candidate.id COLLATE "C") > (
                   SELECT marker.created_at, marker.id COLLATE "C"
                   FROM storage.s3_multipart_uploads AS marker
                   WHERE marker.bucket_id = $1
                     AND marker.key COLLATE "C" = $5
                     AND marker.id = $6
               ),
               TRUE
           )
       )
), ranked AS (
    SELECT
        filtered.*,
        row_number() OVER (
            PARTITION BY filtered.result_key COLLATE "C"
            ORDER BY filtered.created_at, filtered.id COLLATE "C"
        ) AS prefix_rank
    FROM filtered
)
SELECT ranked.result_key, ranked.id, ranked.created_at
FROM ranked
WHERE NOT ranked.is_common_prefix OR ranked.prefix_rank = 1
ORDER BY ranked.result_key COLLATE "C", ranked.created_at, ranked.id COLLATE "C"
LIMIT $4;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text, text, text, timestamp with time zone, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text, next_token_archived_at timestamp with time zone DEFAULT NULL::timestamp with time zone, next_token_version text DEFAULT ''::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_start_relative TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;
    v_version_filter TEXT;

    -- true when noncurrent_versions can return >1 row per name; keeps them
    -- ordered most-recent-first and lets pagination resume mid-key
    v_multi_row BOOLEAN;
    v_name_order TEXT;
    v_exact_range_predicate TEXT;
    v_strict_range_predicate TEXT;
    v_inclusive_range_predicate TEXT;

    -- Seek state for the current name. archived_at is normalized to JavaScript's
    -- millisecond precision and version breaks ties within the same millisecond.
    -- Current rows use 'infinity'; NULL means no tiebreak has been established.
    v_next_seek TEXT;
    v_next_seek_at TIMESTAMPTZ;
    v_next_seek_version TEXT;
    v_next_seek_strict BOOLEAN := false;
    v_cursor_is_folder BOOLEAN;
    v_count INT := 0;
    v_previous_seek TEXT;
    v_previous_seek_at TIMESTAMPTZ;
    v_previous_seek_version TEXT;
    v_previous_count INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;
    v_batch_query_strict TEXT;
    v_delete_marker_peek_query TEXT;
    v_delete_marker_peek_query_strict TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);
    v_next_seek_at := NULL;
    v_next_seek_version := '';

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    v_multi_row := noncurrent_versions IN ('only', 'include');
    v_name_order := CASE WHEN v_is_asc THEN 'ASC' ELSE 'DESC' END;

    v_version_filter := '';
    IF noncurrent_versions = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NULL';
    ELSIF noncurrent_versions = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NOT NULL';
    END IF;
    IF delete_markers = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND NOT o.is_delete_marker';
    ELSIF delete_markers = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.is_delete_marker';
    END IF;

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Keep caller-provided cursors inside the requested prefix range.
    IF v_start <> '' AND v_upper_bound IS NOT NULL THEN
        IF v_is_asc THEN
            IF v_start COLLATE "C" < v_prefix COLLATE "C" THEN
                v_start := '';
            ELSIF v_start COLLATE "C" >= v_upper_bound COLLATE "C" THEN
                RETURN;
            END IF;
        ELSE
            IF v_start COLLATE "C" < v_prefix COLLATE "C" THEN
                RETURN;
            ELSIF v_start COLLATE "C" >= v_upper_bound COLLATE "C" THEN
                v_start := '';
            END IF;
        END IF;
    END IF;

    v_start_relative := substring(v_start FROM length(v_prefix) + 1);

    -- Direction affects only the indexed name range and its ordering. Cursor
    -- state transitions and within-key version ordering stay shared.
    IF v_is_asc THEN
        v_exact_range_predicate := 'TRUE';
        v_strict_range_predicate := 'o.name COLLATE "C" > $2';
        v_inclusive_range_predicate := 'o.name COLLATE "C" >= $2';
        IF v_upper_bound IS NOT NULL THEN
            v_exact_range_predicate := 'o.name COLLATE "C" < $3';
            v_strict_range_predicate := v_strict_range_predicate || ' AND o.name COLLATE "C" < $3';
            v_inclusive_range_predicate := v_inclusive_range_predicate || ' AND o.name COLLATE "C" < $3';
        END IF;
    ELSE
        v_exact_range_predicate := 'TRUE';
        v_strict_range_predicate := 'o.name COLLATE "C" < $2';
        v_inclusive_range_predicate := 'o.name COLLATE "C" < $2';
        IF v_prefix <> '' THEN
            v_exact_range_predicate := 'o.name COLLATE "C" >= $3';
            v_strict_range_predicate := v_strict_range_predicate || ' AND o.name COLLATE "C" >= $3';
            v_inclusive_range_predicate := v_inclusive_range_predicate || ' AND o.name COLLATE "C" >= $3';
        END IF;
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    -- The multi-row order matches the externally serialized cursor exactly:
    -- archived_at at millisecond precision, then version as the final tiebreak.
    --
    -- When v_multi_row, the seek is a keyset tuple comparison ("name > $2 OR
    -- (name = $2 AND tiebreak)") - Postgres won't split that OR into indexable
    -- form (confirmed even with fully literal values), so as one WHERE clause
    -- it forces a full bucket scan filtered row-by-row. Splitting it into two
    -- independently-indexable branches (exact name match with the tiebreak
    -- filter, vs. strictly-past names) combined with UNION ALL lets each
    -- branch keep name as a real index condition; the outer ORDER BY/LIMIT
    -- re-merges them into the same page the single query used to produce.
    IF v_multi_row THEN
        v_batch_query := format(
            $sql$
            SELECT *
            FROM (
                (
                    SELECT o.name, o.id, o.updated_at, o.created_at,
                           o.last_accessed_at, o.metadata, o.version,
                           o.archived_at, o.is_delete_marker, o.is_versioned
                    FROM storage.objects o
                    WHERE o.bucket_id = $1
                      AND o.name COLLATE "C" = $2
                      AND %s
                      AND NOT $7::boolean
                      AND (
                          $5::timestamptz IS NULL
                          OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < $5
                          OR (
                              COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = $5
                              AND COALESCE(o.version, '') > $6
                          )
                      )
                      %s
                    ORDER BY
                        COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC,
                        COALESCE(o.version, '') ASC
                    LIMIT $4
                )
                UNION ALL
                (
                    SELECT o.name, o.id, o.updated_at, o.created_at,
                           o.last_accessed_at, o.metadata, o.version,
                           o.archived_at, o.is_delete_marker, o.is_versioned
                    FROM storage.objects o
                    WHERE o.bucket_id = $1
                      AND %s
                      %s
                    ORDER BY
                        o.name COLLATE "C" %s,
                        COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC,
                        COALESCE(o.version, '') ASC
                    LIMIT $4
                )
            ) sub
            ORDER BY
                sub.name COLLATE "C" %s,
                COALESCE(date_trunc('milliseconds', sub.archived_at), 'infinity'::timestamptz) DESC,
                COALESCE(sub.version, '') ASC
            LIMIT $4
            $sql$,
            v_exact_range_predicate,
            v_version_filter,
            v_strict_range_predicate,
            v_version_filter,
            v_name_order,
            v_name_order
        );
    ELSE
        v_batch_query := format(
            $sql$
            SELECT o.name, o.id, o.updated_at, o.created_at,
                   o.last_accessed_at, o.metadata, o.version,
                   o.archived_at, o.is_delete_marker, o.is_versioned
            FROM storage.objects o
            WHERE o.bucket_id = $1
              AND %s
              %s
            ORDER BY o.name COLLATE "C" %s, o.archived_at DESC
            LIMIT $4
            $sql$,
            v_inclusive_range_predicate,
            v_version_filter,
            v_name_order
        );

        -- Strict counterpart of the query above: used once the single-row
        -- ASC batch advance (below) has left v_next_seek pointing at the
        -- last row already emitted, so an inclusive predicate would
        -- re-match it forever. Only single-row mode ever sets strict mode,
        -- so this variant is never needed when v_multi_row.
        v_batch_query_strict := format(
            $sql$
            SELECT o.name, o.id, o.updated_at, o.created_at,
                   o.last_accessed_at, o.metadata, o.version,
                   o.archived_at, o.is_delete_marker, o.is_versioned
            FROM storage.objects o
            WHERE o.bucket_id = $1
              AND %s
              %s
            ORDER BY o.name COLLATE "C" %s, o.archived_at DESC
            LIMIT $4
            $sql$,
            v_strict_range_predicate,
            v_version_filter,
            v_name_order
        );
    END IF;

    -- The static peek predicates cannot use the partial delete-marker index
    -- once PL/pgSQL switches to a generic plan because whether
    -- is_delete_marker is required remains parameter-dependent. Reuse the
    -- already-specialized batch query with a one-row limit for this sparse
    -- filter so the plan sees a literal `o.is_delete_marker` predicate.
    IF delete_markers = 'only' THEN
        v_delete_marker_peek_query :=
            'SELECT marker_page.name FROM (' || v_batch_query || ') marker_page LIMIT 1';
        IF NOT v_multi_row THEN
            v_delete_marker_peek_query_strict :=
                'SELECT marker_page.name FROM (' || v_batch_query_strict || ') marker_page LIMIT 1';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor performs one specialized initial seek so
            -- partial current-version and delete-marker indexes remain available.
            EXECUTE format(
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1%s%s ORDER BY o.name COLLATE "C" DESC LIMIT 1',
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND o.name COLLATE "C" >= $2 AND o.name COLLATE "C" < $3'
                    ELSE ''
                END,
                v_version_filter
            )
            INTO v_next_seek
            USING _bucket_id, v_prefix, v_upper_bound;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Folder continuation tokens retain their trailing delimiter. A
        -- delimiter-less startAfter is always a literal key boundary.
        v_cursor_is_folder := delimiter_param <> ''
            AND v_start_relative <> ''
            AND right(v_start_relative, length(delimiter_param)) = delimiter_param;

        IF v_cursor_is_folder THEN
            v_next_seek := CASE
                WHEN right(v_start, length(delimiter_param)) = delimiter_param
                    THEN v_start
                ELSE v_start || delimiter_param
            END;
            IF v_is_asc THEN
                v_next_seek := left(v_next_seek, -1)
                    || chr(ascii(right(v_next_seek, 1)) + 1);
            END IF;
            v_next_seek_strict := NOT v_is_asc;
        ELSE
            -- leaf object: when v_multi_row, stay on v_start with the
            -- caller-supplied tiebreak so a page boundary mid-key resumes
            -- that key's remaining rows instead of skipping them. Truncate
            -- to milliseconds like every other v_next_seek_at assignment -
            -- harmless today since object.ts's cursor always round-trips
            -- through JS Date first, but this shouldn't rely on that.
            IF v_multi_row THEN
                v_next_seek := v_start;
                v_next_seek_at := date_trunc('milliseconds', next_token_archived_at);
                v_next_seek_version := coalesce(next_token_version, '');
                v_next_seek_strict := coalesce(next_token, '') = '';
            ELSIF v_is_asc THEN
                v_next_seek := v_start;
                v_next_seek_strict := true;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        v_previous_seek := v_next_seek;
        v_previous_seek_at := v_next_seek_at;
        v_previous_seek_version := v_next_seek_version;
        v_previous_count := v_count;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        -- v_multi_row is branched here (rather than folded into the WHERE
        -- clause as a bound parameter) so each concrete query keeps an
        -- unconditional seek predicate - once PL/pgSQL switches to its
        -- cached generic plan (after 5 calls), a parameter-gated
        -- "(NOT v_multi_row AND name >= $x) OR (v_multi_row AND ...)"
        -- predicate stops the planner from using name as an index
        -- condition at all, degrading every subsequent peek to a full
        -- index scan filtered row-by-row instead of a bounded range scan.
        -- v_multi_row's seek predicate is a keyset tuple comparison
        -- ("name > x OR (name = x AND tiebreak)") - Postgres does not
        -- split this OR into indexable form even with fully literal
        -- values, so it falls back to a full scan filtered row-by-row.
        -- Splitting it into two independently-indexable branches (exact
        -- name match with the tiebreak filter, vs. strictly-past name)
        -- combined with UNION ALL lets each branch keep name as a real
        -- index condition; the outer ORDER BY/LIMIT picks whichever of
        -- the (at most 2) rows sorts first.
        IF delete_markers = 'only' THEN
            EXECUTE CASE WHEN v_next_seek_strict AND NOT v_multi_row
                THEN v_delete_marker_peek_query_strict
                ELSE v_delete_marker_peek_query
            END
                INTO v_peek_name
                USING _bucket_id, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END,
                    1, v_next_seek_at, v_next_seek_version, v_next_seek_strict;
        ELSIF v_multi_row THEN
            IF v_is_asc THEN
                IF v_upper_bound IS NOT NULL THEN
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND o.name COLLATE "C" < v_upper_bound
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" > v_next_seek AND o.name COLLATE "C" < v_upper_bound
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" ASC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" > v_next_seek
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" ASC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSE
                IF v_upper_bound IS NOT NULL THEN
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND o.name COLLATE "C" >= v_prefix
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" DESC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" DESC LIMIT 1;
                ELSE
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" DESC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" DESC LIMIT 1;
                END IF;
            END IF;
        ELSE
            -- Single-row mode is always noncurrent_versions='exclude'. Keep
            -- this predicate literal so generic plans use the current index.
            IF v_is_asc THEN
                IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" > v_next_seek
                      AND o.name COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSIF v_next_seek_strict THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" > v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSIF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" >= v_next_seek
                      AND o.name COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" >= v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSE
                IF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" < v_next_seek
                      AND o.name COLLATE "C" >= v_prefix
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" DESC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" < v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" DESC LIMIT 1;
                END IF;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := v_common_prefix;
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            version := NULL;
            archived_at := NULL;
            is_delete_marker := NULL;
            is_versioned := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1)
                    || chr(ascii(right(v_common_prefix, 1)) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
            v_next_seek_at := NULL;
            v_next_seek_version := '';
            v_next_seek_strict := NOT v_is_asc;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE CASE WHEN v_next_seek_strict AND NOT v_multi_row THEN v_batch_query_strict ELSE v_batch_query END
                USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size, v_next_seek_at, v_next_seek_version,
                v_next_seek_strict
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it. Reset
                    -- strict mode too it may have been set by an earlier
                    -- row in this same batch (see the single-row ASC advance
                    -- below), and v_next_seek here is the folder-triggering
                    -- row's own name, which the next peek must find inclusively.
                    v_next_seek := CASE
                        WHEN v_is_asc THEN v_current.name
                        ELSE v_current.name || delimiter_param
                    END;
                    v_next_seek_at := NULL;
                    v_next_seek_version := '';
                    v_next_seek_strict := false;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                version := v_current.version;
                archived_at := v_current.archived_at;
                is_delete_marker := v_current.is_delete_marker;
                is_versioned := v_current.is_versioned;
                RETURN NEXT;
                v_count := v_count + 1;

                -- when v_multi_row, stay on this name and record its
                -- archived_at as the new tiebreak so remaining rows for the
                -- same key are picked up before moving to the next name
                IF v_multi_row THEN
                    v_next_seek := v_current.name;
                    v_next_seek_at := COALESCE(date_trunc('milliseconds', v_current.archived_at), 'infinity'::timestamptz);
                    v_next_seek_version := COALESCE(v_current.version, '');
                    v_next_seek_strict := false;
                ELSIF v_is_asc THEN
                    -- Appending the delimiter as a fake lexical successor
                    -- would skip a real key like `name || '!'` (or any
                    -- character sorting below the delimiter), which sorts
                    -- between `name` and `name || delimiter`. Track the real
                    -- name and mark the next comparison strict instead.
                    v_next_seek := v_current.name;
                    v_next_seek_strict := true;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;

        IF v_count = v_previous_count
           AND v_next_seek IS NOT DISTINCT FROM v_previous_seek
           AND v_next_seek_at IS NOT DISTINCT FROM v_previous_seek_at
           AND v_next_seek_version IS NOT DISTINCT FROM v_previous_seek_version THEN
            RAISE EXCEPTION 'storage.list_objects_with_delimiter made no progress at seek (%, %, %)',
                v_next_seek, v_next_seek_at, v_next_seek_version;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_bucket_control_columns(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_bucket_control_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  configuration_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_configuration IS NOT NULL
       OR NEW.lifecycle_configuration_generation IS NOT NULL THEN
      IF NOT pg_has_role(current_user, TG_ARGV[0], 'MEMBER') THEN
        RAISE EXCEPTION 'only members of the configured storage service role may insert lifecycle policy state'
          USING ERRCODE = '42501',
                HINT = format(
                  'Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward, or insert as a member of %I.',
                  TG_ARGV[0]
                );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  configuration_changed =
    OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
    OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation;

  IF NOT configuration_changed THEN
    RETURN NEW;
  END IF;

  IF NEW.type IS DISTINCT FROM 'STANDARD' THEN
    RAISE EXCEPTION 'bucket versioning and lifecycle controls require a Standard bucket'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     AND NEW.lifecycle_configuration_generation IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     OR NEW.lifecycle_configuration_generation IS NULL
     OR OLD.lifecycle_configuration IS NOT DISTINCT FROM NEW.lifecycle_configuration
     OR OLD.lifecycle_configuration_generation IS NOT DISTINCT FROM NEW.lifecycle_configuration_generation THEN
    RAISE EXCEPTION 'a changed lifecycle policy requires a new non-null generation'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_prefix_len INT;
    v_prefix_start INT;
    v_combined_levels INT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;
    v_version_filter TEXT;
    v_multi_row BOOLEAN;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;
    v_delete_marker_peek_query TEXT;
    v_delete_marker_peek_query_strict TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_next_seek_at TIMESTAMPTZ;
    v_next_seek_version TEXT;
    v_next_seek_strict BOOLEAN := false;
    v_count INT := 0;
    v_skipped INT := 0;
    v_previous_seek TEXT;
    v_previous_seek_at TIMESTAMPTZ;
    v_previous_seek_version TEXT;
    v_previous_count INT;
    v_previous_skipped INT;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_prefix_len := length(coalesce(prefix, ''));
    v_prefix_start := coalesce(array_length(string_to_array(coalesce(prefix, ''), v_delimiter), 1), 1);
    v_combined_levels := coalesce(array_length(string_to_array(v_prefix, v_delimiter), 1), 1);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);
    v_next_seek_at := NULL;
    v_next_seek_version := '';

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    v_multi_row := noncurrent_versions IN ('only', 'include');

    v_version_filter := '';
    IF noncurrent_versions = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NULL';
    ELSIF noncurrent_versions = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NOT NULL';
    END IF;
    IF delete_markers = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND NOT o.is_delete_marker';
    ELSIF delete_markers = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.is_delete_marker';
    END IF;

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT array_to_string(path_tokens[$1:$2], '/') AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $3 || '%%'
                  AND bucket_id = $4
                  AND array_length(objects.path_tokens, 1) <> $2
                  AND ($7 != 'exclude' OR objects.archived_at IS NULL)
                  AND ($7 != 'only' OR objects.archived_at IS NOT NULL)
                  AND ($8 != 'exclude' OR NOT objects.is_delete_marker)
                  AND ($8 != 'only' OR objects.is_delete_marker)
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata,
                   NULL::text AS version,
                   NULL::timestamptz AS archived_at,
                   NULL::boolean AS is_delete_marker,
                   NULL::boolean AS is_versioned FROM folders)
            UNION ALL
            (SELECT array_to_string(path_tokens[$1:$2], '/') AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata,
                   version, archived_at, is_delete_marker, is_versioned
             FROM storage.objects
             WHERE objects.name ILIKE $3 || '%%'
               AND bucket_id = $4
               AND array_length(objects.path_tokens, 1) = $2
               AND ($7 != 'exclude' OR objects.archived_at IS NULL)
               AND ($7 != 'only' OR objects.archived_at IS NOT NULL)
               AND ($8 != 'exclude' OR NOT objects.is_delete_marker)
               AND ($8 != 'only' OR objects.is_delete_marker)
             -- name, then version, as tiebreaks so two versions of the same
             -- key tying on the sort column still sort deterministically
             ORDER BY %I %s, name COLLATE "C" %s, COALESCE(version, '') %s)
            LIMIT $5 OFFSET $6
            $sql$, v_sort_order, v_order_by, v_sort_order, v_sort_order, v_sort_order
        ) USING v_prefix_start, v_combined_levels, v_prefix, bucketname, v_limit, offsets, noncurrent_versions, delete_markers;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build a resume-safe batch query. The exact-name branch returns remaining
    -- versions after the current (archived_at, version) boundary; the strict
    -- name branch returns subsequent keys. UNION ALL keeps both predicates
    -- independently indexable.
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" > $2 AND lower(o.name) COLLATE "C" < $3' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" ASC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" > $2' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" ASC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 AND lower(o.name) COLLATE "C" >= $3' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" DESC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" DESC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        END IF;
    END IF;

    -- Keep the delete-marker predicate literal so the cached generic
    -- plan can use idx_objects_delete_markers during the main-loop peek.
    IF delete_markers = 'only' THEN
        IF v_multi_row THEN
            v_delete_marker_peek_query :=
                'SELECT marker_page.name FROM (' || v_batch_query || ') marker_page LIMIT 1';
        ELSIF v_is_asc THEN
            -- Two separate literal query strings, not one gated by a bound
            -- boolean: folding "$n AND op1 OR NOT $n AND op2" into a single
            -- query defeats the generic plan's ability to push either
            -- comparison into the index. Branching in PL/pgSQL control flow
            -- instead keeps each query's index condition intact.
            v_delete_marker_peek_query :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" >= $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" < $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1';
            -- Strict variant: used once the single-row ASC batch advance
            -- (below) has left v_next_seek pointing at the last row already
            -- emitted, so a plain >= would re-match it forever.
            v_delete_marker_peek_query_strict :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" > $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" < $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1';
        ELSE
            v_delete_marker_peek_query :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" < $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" >= $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC performs one specialized initial seek so partial current-version
        -- and delete-marker indexes remain available.
        EXECUTE format(
            'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1%s%s ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1',
            CASE WHEN v_upper_bound IS NOT NULL
                THEN ' AND lower(o.name) COLLATE "C" >= $2 AND lower(o.name) COLLATE "C" < $3'
                ELSE ''
            END,
            v_version_filter
        )
        INTO v_peek_name
        USING bucketname, v_prefix_lower, v_upper_bound;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch and
    -- the delete-marker-only path
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        v_previous_seek := v_next_seek;
        v_previous_seek_at := v_next_seek_at;
        v_previous_seek_version := v_next_seek_version;
        v_previous_count := v_count;
        v_previous_skipped := v_skipped;

        -- STEP 1: PEEK
        v_peek_name := NULL;
        IF delete_markers = 'only' THEN
            EXECUTE CASE WHEN v_next_seek_strict
                THEN v_delete_marker_peek_query_strict
                ELSE v_delete_marker_peek_query
            END
                INTO v_peek_name
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END,
                    1, v_next_seek_at, v_next_seek_version;
        ELSIF v_multi_row AND v_next_seek_at IS NOT NULL THEN
            SELECT o.name INTO v_peek_name
            FROM storage.objects o
            WHERE o.bucket_id = bucketname
              AND lower(o.name) COLLATE "C" = v_next_seek
              AND (COALESCE(o.archived_at, 'infinity'::timestamptz) < v_next_seek_at
                   OR (COALESCE(o.archived_at, 'infinity'::timestamptz) = v_next_seek_at
                       AND COALESCE(o.version, '') > v_next_seek_version))
              AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
              AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
              AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
              AND (delete_markers != 'only' OR o.is_delete_marker)
            ORDER BY COALESCE(o.archived_at, 'infinity'::timestamptz) DESC,
                     COALESCE(o.version, '') ASC
            LIMIT 1;

            -- The current key is exhausted. Clear its version boundary and
            -- make the following ASC name peek strict. Appending '/' is not a
            -- valid lexical successor because keys ending in characters such
            -- as '!' sort between the exhausted name and name || '/'.
            IF v_peek_name IS NULL THEN
                IF v_is_asc THEN
                    v_next_seek_strict := true;
                END IF;
                v_next_seek_at := NULL;
                v_next_seek_version := '';
            END IF;
        END IF;

        -- Single-row mode is always noncurrent_versions='exclude'. Keep the
        -- current-row predicate literal so generic plans use the current index.
        IF delete_markers != 'only' AND v_peek_name IS NULL AND NOT v_multi_row THEN
            IF v_is_asc THEN
                IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSIF v_next_seek_strict THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSIF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSIF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                  AND o.archived_at IS NULL
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                  AND o.archived_at IS NULL
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        ELSIF delete_markers != 'only' AND v_peek_name IS NULL AND v_is_asc THEN
            IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSIF v_next_seek_strict THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSIF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSIF delete_markers != 'only' AND v_peek_name IS NULL THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- If the peek landed on a different key than we were tracking, any
        -- version boundary belongs to the OLD key and must not leak into the
        -- new one - e.g. the deleteMarkers='only' peek doesn't know or care
        -- whether it's continuing the same key or jumping to a new one, so
        -- it never clears these itself.
        IF lower(v_peek_name) IS DISTINCT FROM v_next_seek THEN
            v_next_seek_at := NULL;
            v_next_seek_version := '';
        END IF;

        -- The peek is authoritative for the next key to process. This is
        -- especially important after exhausting a multi-version key: the
        -- version boundary has been cleared, so executing the batch against
        -- a stale v_next_seek would replay every version of that old key.
        v_next_seek := lower(v_peek_name);
        v_next_seek_strict := false;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := substring(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter) from v_prefix_len + 1);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                version := NULL;
                archived_at := NULL;
                is_delete_marker := NULL;
                is_versioned := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
            v_next_seek_at := NULL;
            v_next_seek_version := '';
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size,
                    v_next_seek_at, v_next_seek_version
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it. Reset
                    -- strict mode too - it may have been set by an earlier
                    -- row in this same batch (see the single-row ASC advance
                    -- below), and v_next_seek here is the folder-triggering
                    -- row's own name, which the next peek must find inclusively.
                    v_next_seek := CASE
                        WHEN v_is_asc THEN lower(v_current.name)
                        ELSE lower(v_current.name) || v_delimiter
                    END;
                    v_next_seek_at := NULL;
                    v_next_seek_version := '';
                    v_next_seek_strict := false;
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := substring(v_current.name from v_prefix_len + 1);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    version := v_current.version;
                    archived_at := v_current.archived_at;
                    is_delete_marker := v_current.is_delete_marker;
                    is_versioned := v_current.is_versioned;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Multi-row mode must remain on this key until all of its
                -- versions have crossed the internal batch boundary.
                IF v_multi_row THEN
                    v_next_seek := lower(v_current.name);
                    v_next_seek_at := COALESCE(v_current.archived_at, 'infinity'::timestamptz);
                    v_next_seek_version := COALESCE(v_current.version, '');
                ELSIF v_is_asc THEN
                    -- Appending the delimiter as a fake lexical successor would
                    -- skip a real key like `name || '!'` (or any character
                    -- sorting below the delimiter), which sorts between `name`
                    -- and `name || delimiter`. Track the real name and mark the
                    -- next comparison strict instead - same fix as the
                    -- exhausted-key case above.
                    v_next_seek := lower(v_current.name);
                    v_next_seek_strict := true;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;

        IF v_count = v_previous_count
           AND v_skipped = v_previous_skipped
           AND v_next_seek IS NOT DISTINCT FROM v_previous_seek
           AND v_next_seek_at IS NOT DISTINCT FROM v_previous_seek_at
           AND v_next_seek_version IS NOT DISTINCT FROM v_previous_seek_version THEN
            RAISE EXCEPTION 'storage.search made no progress at seek (%, %, %)',
                v_next_seek, v_next_seek_at, v_next_seek_version;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text, p_start_after_version text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
    v_prefix_pattern text;
    v_sort_order text;
    v_sort_column text;
    v_version_tiebreak text;
BEGIN
    v_prefix := coalesce(p_prefix, '');
    -- Keep the raw prefix for common-prefix calculations and escape only LIKE metacharacters.
    v_prefix_pattern := replace(v_prefix, chr(92), chr(92) || chr(92));
    v_prefix_pattern := replace(v_prefix_pattern, '%', chr(92) || '%');
    v_prefix_pattern := replace(v_prefix_pattern, '_', chr(92) || '_');

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    -- $9 is only populated in multi-row mode; it's always '' otherwise, so
    -- only use each row's real version as a tiebreak in multi-row mode.
    v_version_tiebreak := CASE WHEN noncurrent_versions IN ('only', 'include') THEN 'COALESCE(version, '''')' ELSE '''''' END;

    -- Defense-in-depth: this function is independently reachable and must
    -- not trust p_sort_order/p_sort_column to already be validated by a
    -- caller. Normalize to the same strict allow-list storage.search_v2
    -- uses before interpolating anything into dynamic SQL below.
    v_sort_order := lower(coalesce(p_sort_order, 'asc'));
    IF v_sort_order NOT IN ('asc', 'desc') THEN
        v_sort_order := 'asc';
    END IF;

    v_sort_column := lower(coalesce(p_sort_column, 'updated_at'));
    IF v_sort_column NOT IN ('updated_at', 'created_at') THEN
        v_sort_column := 'updated_at';
    END IF;

    IF v_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                o.version AS obj_version,
                o.archived_at AS obj_archived_at,
                o.is_delete_marker AS obj_is_delete_marker,
                o.is_versioned AS obj_is_versioned,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $10 || '%%'
              AND ($7 != 'exclude' OR o.archived_at IS NULL)
              AND ($7 != 'only' OR o.archived_at IS NOT NULL)
              AND ($8 != 'exclude' OR NOT o.is_delete_marker)
              AND ($8 != 'only' OR o.is_delete_marker)
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                common_prefix AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                NULL::text AS version,
                NULL::timestamptz AS archived_at,
                NULL::boolean AS is_delete_marker,
                NULL::boolean AS is_versioned,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                obj_version AS version,
                obj_archived_at AS archived_at,
                obj_is_delete_marker AS is_delete_marker,
                obj_is_versioned AS is_versioned,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz),
                    name COLLATE "C",
                    %s
                ) %s ROW(
                    -- truncated the same way as the stored value above
                    date_trunc('milliseconds', COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz)),
                    $5,
                    $9
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata,
            version,
            archived_at,
            is_delete_marker,
            is_versioned
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s,
            COALESCE(version, '') %s
        LIMIT $4
    $sql$,
        v_sort_column,
        v_version_tiebreak,
        v_cursor_op,
        v_sort_column,
        v_sort_order,
        v_sort_order,
        v_sort_order
    );

    -- version is the third tiebreak component for two versions of the same
    -- key tying on both timestamp and name (see filtered CTE / ORDER BY above)
    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after, noncurrent_versions, delete_markers, coalesce(p_start_after_version, ''), v_prefix_pattern;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text, text, text, timestamp with time zone, text, boolean); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text, noncurrent_versions text DEFAULT 'exclude'::text, delete_markers text DEFAULT 'exclude'::text, start_after_archived_at timestamp with time zone DEFAULT NULL::timestamp with time zone, start_after_version text DEFAULT ''::text, start_after_is_continuation boolean DEFAULT false) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb, version text, archived_at timestamp with time zone, is_delete_marker boolean, is_versioned boolean)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata,
            l.version,
            l.archived_at,
            l.is_delete_marker,
            l.is_versioned
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            CASE WHEN start_after_is_continuation THEN '' ELSE start_after END,
            CASE WHEN start_after_is_continuation THEN start_after ELSE '' END,
            v_sort_ord,
            noncurrent_versions,
            delete_markers,
            start_after_archived_at,
            start_after_version
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after,
            noncurrent_versions, delete_markers, start_after_version
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id uuid,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE activity_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.activity_logs IS 'Audit trail aksi sensitif (void, retur, opname/adjustment stok, hapus & pulihkan produk/transaksi). Hanya ditulis dari dalam RPC security definer — lihat migration 014.';


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text,
    sort_order integer,
    is_active boolean DEFAULT true
);


--
-- Name: held_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.held_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cashier_id uuid NOT NULL,
    label text,
    items jsonb NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    subtotal bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE held_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.held_orders IS 'Keranjang yang ditunda kasir (tombol "Tunda" di KasirModule.tsx, PRD §17 T-11). Bukan transaksi sah — row dihapus begitu dilanjutkan atau dibatalkan manual.';


--
-- Name: COLUMN held_orders.label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.held_orders.label IS 'Catatan bebas dari kasir saat menunda, mis. nama pelanggan ("Budi - baju kuning") — opsional, membantu kasir lain kenali held order mana yang mana.';


--
-- Name: COLUMN held_orders.items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.held_orders.items IS 'Array [{product_id, qty}] SAJA, tanpa harga/nama — harga & stok divalidasi ulang ke tabel products saat resume (lihat useHoldOrders.ts resumeHeldOrder()).';


--
-- Name: payment_proofs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_proofs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    file_url text NOT NULL,
    file_name text,
    file_size bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    proof_type text DEFAULT 'payment'::text NOT NULL,
    CONSTRAINT payment_proofs_proof_type_check CHECK ((proof_type = ANY (ARRAY['payment'::text, 'settlement'::text])))
);


--
-- Name: TABLE payment_proofs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_proofs IS 'Bukti pembayaran (foto transfer/QRIS), multi-file per payment. File fisik di Storage bucket "payment-proofs", baris ini cuma metadata + URL.';


--
-- Name: COLUMN payment_proofs.proof_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_proofs.proof_type IS '''payment'' = bukti saat checkout (transfer/QRIS awal). ''settlement'' = bukti pelunasan piutang TEMPO yang diupload belakangan lewat Laporan Piutang.';


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    method public.payment_method NOT NULL,
    amount bigint NOT NULL,
    received_amount bigint,
    change_amount bigint,
    reference_no text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date date,
    is_settled boolean DEFAULT false NOT NULL,
    settled_at timestamp with time zone,
    settled_by uuid
);


--
-- Name: COLUMN payments.due_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.due_date IS 'Tanggal jatuh tempo, wajib diisi untuk method = TEMPO (divalidasi di RPC create_transaction). NULL untuk method lain.';


--
-- Name: COLUMN payments.is_settled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.is_settled IS 'Piutang TEMPO sudah dilunasi atau belum. Hanya bermakna untuk method = TEMPO — method lain selalu false secara default dan tidak boleh dipakai untuk logika apapun.';


--
-- Name: COLUMN payments.settled_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.settled_at IS 'Waktu piutang ditandai lunas, diisi RPC settle_receivable. NULL selama is_settled = false.';


--
-- Name: COLUMN payments.settled_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.settled_by IS 'Profil yang menandai lunas (bisa beda dari kasir yang membuat transaksi asli).';


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    barcode text,
    name text NOT NULL,
    type public.product_type NOT NULL,
    is_service boolean DEFAULT false,
    category_id uuid,
    unit text,
    sell_price bigint NOT NULL,
    cost_price bigint,
    stock integer DEFAULT 0,
    min_stock integer DEFAULT 0,
    photo_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text,
    role public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    fcm_token text,
    fcm_token_updated_at timestamp with time zone
);


--
-- Name: COLUMN profiles.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.email IS 'Email user, diisi manual oleh admin (bukan sinkron otomatis dari auth.users) — dipakai tombol "Reset Password" di Pengaturan Admin (supabase.auth.resetPasswordForEmail). Bisa NULL untuk user lama yang belum diisi.';


--
-- Name: COLUMN profiles.fcm_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.fcm_token IS 'Registration token FCM (perangkat+browser TERAKHIR yang mengaktifkan notifikasi). NULL = belum/tidak lagi bisa menerima push. Ditulis lewat RPC save_my_fcm_token / clear_my_fcm_token, atau dibersihkan otomatis oleh lib/notifications/sendPush.ts saat FCM menolak token basi.';


--
-- Name: COLUMN profiles.fcm_token_updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.fcm_token_updated_at IS 'Kapan fcm_token terakhir disimpan/dibersihkan (UTC). Berguna untuk debugging "kenapa notifikasi tidak masuk".';


--
-- Name: profiles_directory; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.profiles_directory WITH (security_invoker='true') AS
 SELECT id,
    full_name
   FROM public.profiles
  WHERE (is_active = true);


--
-- Name: promo_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    media_type text NOT NULL,
    file_url text NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    file_size bigint,
    duration_seconds integer DEFAULT 8 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    screen_id uuid,
    CONSTRAINT promo_media_duration_seconds_check CHECK (((duration_seconds >= 3) AND (duration_seconds <= 120))),
    CONSTRAINT promo_media_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])))
);


--
-- Name: TABLE promo_media; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.promo_media IS 'Media promosi (gambar/video) untuk layar TV toko, diputar berurutan oleh halaman /tv. File fisik di Storage bucket "promo-media", baris ini metadata + URL. Migration 026.';


--
-- Name: COLUMN promo_media.duration_seconds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.promo_media.duration_seconds IS 'Lama tayang GAMBAR dalam detik (3-120). Diabaikan untuk video — video diputar sampai selesai.';


--
-- Name: COLUMN promo_media.sort_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.promo_media.sort_order IS 'Urutan tayang naik (kecil dulu). Ditulis ulang atomik oleh RPC reorder_promo_media.';


--
-- Name: COLUMN promo_media.screen_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.promo_media.screen_id IS 'Layar TV pemilik media ini (migration 027). NULL = media lama dari sebelum fitur multi-TV, tidak lagi tertayang di manapun sampai diberi screen_id manual.';


--
-- Name: promo_screens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_screens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    access_token text DEFAULT (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text)) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promo_screens_name_not_blank CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: TABLE promo_screens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.promo_screens IS 'Satu baris = satu TV/layar promosi fisik. access_token adalah "kunci" URL publik /tv/[access_token] (migration 027) — pengganti login untuk perangkat TV.';


--
-- Name: COLUMN promo_screens.access_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.promo_screens.access_token IS 'String acak 64 hex char, dibangkitkan otomatis (2x gen_random_uuid()). Jangan pernah dibuat bisa ditebak/berurutan — ini satu-satunya penjaga akses ke /tv/[access_token].';


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: TABLE settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.settings IS 'Pengaturan toko & struk, key-value (PRD §17 T-01). value disimpan sebagai jsonb supaya boolean/number/string bisa ditampung tanpa kolom nullable terpisah per setting.';


--
-- Name: shift_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cashier_id uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_cash bigint DEFAULT 0 NOT NULL,
    closed_at timestamp with time zone,
    expected_cash bigint,
    actual_cash bigint,
    difference bigint,
    status text DEFAULT 'OPEN'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shift_sessions_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text])))
);


--
-- Name: TABLE shift_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shift_sessions IS 'Shift kasir (PRD §17 T-04): buka dengan modal awal, tutup dengan hitung pecahan -> selisih kas otomatis. Satu kasir hanya boleh punya satu shift OPEN (lihat unique index di bawah).';


--
-- Name: COLUMN shift_sessions.opening_cash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shift_sessions.opening_cash IS 'Modal awal kas saat buka shift, default dari settings.shift_default_cash (diisi client saat buka, lihat useShifts.ts).';


--
-- Name: COLUMN shift_sessions.expected_cash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shift_sessions.expected_cash IS 'Kas yang seharusnya ada saat tutup (opening_cash + total tunai masuk selama shift), dihitung & dikunci oleh RPC close_shift.';


--
-- Name: COLUMN shift_sessions.actual_cash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shift_sessions.actual_cash IS 'Hasil hitung fisik pecahan uang oleh kasir saat tutup shift.';


--
-- Name: COLUMN shift_sessions.difference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shift_sessions.difference IS 'actual_cash - expected_cash. Negatif = kurang, positif = lebih.';


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    type text NOT NULL,
    qty_delta integer NOT NULL,
    reference_id uuid,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movements_manual_reason_check CHECK (((type <> ALL (ARRAY['opname'::text, 'adjustment'::text])) OR ((reason IS NOT NULL) AND (btrim(reason) <> ''::text)))),
    CONSTRAINT stock_movements_type_check CHECK ((type = ANY (ARRAY['sale'::text, 'return'::text, 'opname'::text, 'adjustment'::text, 'void'::text])))
);


--
-- Name: TABLE stock_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_movements IS 'Audit trail mutasi stok (PRD §6, §17 T-05). Satu-satunya cara sah mengubah products.stock adalah lewat RPC yang sekaligus menulis baris di sini: create_transaction (sale), return_transaction (return), void_transaction (void), adjust_stock (opname/adjustment).';


--
-- Name: COLUMN stock_movements.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_movements.type IS 'sale = penjualan (qty_delta negatif) · return = retur masuk · void = pembatalan transaksi · opname = hasil hitung fisik · adjustment = penyesuaian manual (rusak/hilang/koreksi input).';


--
-- Name: COLUMN stock_movements.qty_delta; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_movements.qty_delta IS 'Selisih stok: NEGATIF = stok berkurang, POSITIF = stok bertambah. Stok baru = stok lama + qty_delta.';


--
-- Name: COLUMN stock_movements.reference_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_movements.reference_id IS 'Transaksi sumber untuk type sale/return/void (transactions.id). NULL untuk mutasi manual.';


--
-- Name: COLUMN stock_movements.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_movements.reason IS 'Wajib diisi untuk type opname/adjustment (ditegakkan check constraint + RPC adjust_stock). Boleh NULL untuk mutasi otomatis.';


--
-- Name: transaction_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    product_id uuid,
    sku text,
    product_name text NOT NULL,
    qty integer NOT NULL,
    returned_qty integer DEFAULT 0 NOT NULL,
    unit text,
    unit_price bigint NOT NULL,
    discount bigint DEFAULT 0 NOT NULL,
    subtotal bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_no text NOT NULL,
    status public.transaction_status NOT NULL,
    subtotal bigint NOT NULL,
    discount bigint DEFAULT 0 NOT NULL,
    tax bigint DEFAULT 0 NOT NULL,
    total bigint NOT NULL,
    cashier_id uuid,
    shift_id uuid,
    customer_name text,
    customer_phone text,
    notes text,
    void_reason text,
    related_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: COLUMN transactions.cashier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.cashier_id IS 'Diisi setelah sistem Auth + role (profiles) dibangun. NULL untuk transaksi lama & sebelum Auth aktif.';


--
-- Name: COLUMN transactions.shift_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.shift_id IS 'Diisi setelah fitur Kas & Shift dibangun. NULL untuk transaksi lama & sebelum shift aktif.';


--
-- Name: COLUMN transactions.void_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.void_reason IS 'Alasan void, diisi saat transaksi di-void. Pertimbangkan juga catat di activity_logs untuk audit trail.';


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL,
    versioning_status text DEFAULT 'DISABLED'::text NOT NULL,
    lifecycle_configuration jsonb,
    lifecycle_configuration_generation uuid,
    CONSTRAINT buckets_lifecycle_configuration_pair_check CHECK (((lifecycle_configuration IS NULL) = (lifecycle_configuration_generation IS NULL))),
    CONSTRAINT buckets_lifecycle_configuration_shape_check CHECK (((lifecycle_configuration IS NULL) OR ((jsonb_typeof(lifecycle_configuration) = 'object'::text) AND (lifecycle_configuration ? 'rules'::text) AND
CASE
    WHEN (jsonb_typeof((lifecycle_configuration -> 'rules'::text)) = 'array'::text) THEN ((jsonb_array_length((lifecycle_configuration -> 'rules'::text)) >= 1) AND (jsonb_array_length((lifecycle_configuration -> 'rules'::text)) <= 1000))
    ELSE false
END))),
    CONSTRAINT buckets_lifecycle_configuration_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR ((lifecycle_configuration IS NULL) AND (lifecycle_configuration_generation IS NULL)))),
    CONSTRAINT buckets_versioning_dark_check CHECK ((versioning_status = 'DISABLED'::text)),
    CONSTRAINT buckets_versioning_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR (versioning_status = 'DISABLED'::text))),
    CONSTRAINT buckets_versioning_status_check CHECK ((versioning_status = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text, 'SUSPENDED'::text])))
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    archived_at timestamp with time zone,
    is_delete_marker boolean DEFAULT false NOT NULL,
    is_versioned boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: held_orders held_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.held_orders
    ADD CONSTRAINT held_orders_pkey PRIMARY KEY (id);


--
-- Name: payment_proofs payment_proofs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT payment_proofs_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: promo_media promo_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_media
    ADD CONSTRAINT promo_media_pkey PRIMARY KEY (id);


--
-- Name: promo_screens promo_screens_access_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_screens
    ADD CONSTRAINT promo_screens_access_token_key UNIQUE (access_token);


--
-- Name: promo_screens promo_screens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_screens
    ADD CONSTRAINT promo_screens_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: shift_sessions shift_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_sessions
    ADD CONSTRAINT shift_sessions_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: transaction_items transaction_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: activity_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_logs_created_at_idx ON public.activity_logs USING btree (created_at DESC);


--
-- Name: activity_logs_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_logs_entity_idx ON public.activity_logs USING btree (entity, entity_id);


--
-- Name: held_orders_cashier_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX held_orders_cashier_id_idx ON public.held_orders USING btree (cashier_id);


--
-- Name: held_orders_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX held_orders_created_at_idx ON public.held_orders USING btree (created_at DESC);


--
-- Name: payments_tempo_unsettled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_tempo_unsettled_idx ON public.payments USING btree (due_date) WHERE ((method = 'TEMPO'::public.payment_method) AND (is_settled = false));


--
-- Name: profiles_fcm_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_fcm_token_unique ON public.profiles USING btree (fcm_token) WHERE (fcm_token IS NOT NULL);


--
-- Name: profiles_fcm_token_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_fcm_token_unique_idx ON public.profiles USING btree (fcm_token) WHERE (fcm_token IS NOT NULL);


--
-- Name: INDEX profiles_fcm_token_unique_idx; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.profiles_fcm_token_unique_idx IS 'Jaga satu fcm_token cuma dipegang satu profil pada satu waktu — jaring pengaman DB di belakang logika revoke di RPC save_my_fcm_token (migration 023). NULL dikecualikan (where fcm_token is not null) supaya user yang belum pernah kasih izin notifikasi tidak saling bentrok.';


--
-- Name: promo_media_active_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promo_media_active_order_idx ON public.promo_media USING btree (is_active, sort_order, created_at);


--
-- Name: promo_media_screen_id_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promo_media_screen_id_sort_idx ON public.promo_media USING btree (screen_id, sort_order);


--
-- Name: shift_sessions_cashier_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_sessions_cashier_id_idx ON public.shift_sessions USING btree (cashier_id);


--
-- Name: shift_sessions_one_open_per_cashier; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shift_sessions_one_open_per_cashier ON public.shift_sessions USING btree (cashier_id) WHERE (status = 'OPEN'::text);


--
-- Name: stock_movements_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_created_at_idx ON public.stock_movements USING btree (created_at DESC);


--
-- Name: stock_movements_product_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_product_created_idx ON public.stock_movements USING btree (product_id, created_at DESC);


--
-- Name: stock_movements_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_reference_idx ON public.stock_movements USING btree (reference_id);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: idx_objects_current_version; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (archived_at IS NULL);


--
-- Name: idx_objects_delete_markers; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_delete_markers ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE is_delete_marker;


--
-- Name: idx_objects_null_version; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (NOT is_versioned);


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: objects_bucket_id_name_version_key; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX objects_bucket_id_name_version_key ON storage.objects USING btree (bucket_id, name COLLATE "C", version) NULLS NOT DISTINCT;


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: profiles profiles_enforce_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_enforce_role_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_profiles_role_change();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_bucket_control_insert; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_bucket_control_insert BEFORE INSERT ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role');


--
-- Name: buckets protect_bucket_control_update; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_bucket_control_update BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns();


--
-- Name: buckets protect_bucket_control_update_role; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_bucket_control_update_role AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role('service_role');


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: held_orders held_orders_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.held_orders
    ADD CONSTRAINT held_orders_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: payment_proofs payment_proofs_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT payment_proofs_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;


--
-- Name: payment_proofs payment_proofs_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_proofs
    ADD CONSTRAINT payment_proofs_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: payments payments_settled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_settled_by_fkey FOREIGN KEY (settled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: payments payments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: promo_media promo_media_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_media
    ADD CONSTRAINT promo_media_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: promo_media promo_media_screen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_media
    ADD CONSTRAINT promo_media_screen_id_fkey FOREIGN KEY (screen_id) REFERENCES public.promo_screens(id) ON DELETE CASCADE;


--
-- Name: promo_screens promo_screens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_screens
    ADD CONSTRAINT promo_screens_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: settings settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: shift_sessions shift_sessions_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_sessions
    ADD CONSTRAINT shift_sessions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: transaction_items transaction_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: transaction_items transaction_items_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shift_sessions(id) ON DELETE SET NULL;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_logs activity_logs_select_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_logs_select_admin_supervisor ON public.activity_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true)))));


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_delete_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_delete_admin_supervisor ON public.categories FOR DELETE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: categories categories_insert_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_insert_admin_supervisor ON public.categories FOR INSERT TO authenticated WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: categories categories_select_active_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_select_active_users ON public.categories FOR SELECT TO authenticated USING ((public.current_user_role() IS NOT NULL));


--
-- Name: categories categories_update_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_update_admin_supervisor ON public.categories FOR UPDATE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role]))) WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: held_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.held_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: held_orders held_orders_delete_own_or_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY held_orders_delete_own_or_supervisor ON public.held_orders FOR DELETE USING (((cashier_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true))))));


--
-- Name: held_orders held_orders_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY held_orders_insert_own ON public.held_orders FOR INSERT WITH CHECK (((cashier_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true))))));


--
-- Name: held_orders held_orders_select_own_or_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY held_orders_select_own_or_supervisor ON public.held_orders FOR SELECT USING (((cashier_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true))))));


--
-- Name: payment_proofs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_proofs payment_proofs_insert_active_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_proofs_insert_active_users ON public.payment_proofs FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: payment_proofs payment_proofs_select_active_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_proofs_select_active_users ON public.payment_proofs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_select_authenticated ON public.payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_insert_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_insert_admin_supervisor ON public.products FOR INSERT TO authenticated WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: products products_select_active_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_select_active_users ON public.products FOR SELECT TO authenticated USING ((public.current_user_role() IS NOT NULL));


--
-- Name: products products_update_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_update_admin_supervisor ON public.products FOR UPDATE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role]))) WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_admin_supervisor ON public.profiles FOR SELECT TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));


--
-- Name: profiles profiles_update_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_admin_supervisor ON public.profiles FOR UPDATE TO authenticated USING (((public.current_user_role() = 'admin'::public.user_role) OR ((role <> 'admin'::public.user_role) AND (public.current_user_role() = 'supervisor'::public.user_role)))) WITH CHECK (((public.current_user_role() = 'admin'::public.user_role) OR ((role <> 'admin'::public.user_role) AND (public.current_user_role() = 'supervisor'::public.user_role))));


--
-- Name: POLICY profiles_update_admin_supervisor ON profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY profiles_update_admin_supervisor ON public.profiles IS 'Admin bebas UPDATE profiles siapa pun; supervisor boleh KECUALI baris yang role-nya admin (migration 020, ditulis ulang migration 024 pakai current_user_role() untuk hindari infinite recursion — logika akses tidak berubah).';


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));


--
-- Name: promo_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_media ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_media promo_media_delete_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_media_delete_admin_supervisor ON public.promo_media FOR DELETE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: promo_media promo_media_insert_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_media_insert_admin_supervisor ON public.promo_media FOR INSERT TO authenticated WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: promo_media promo_media_select_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_media_select_admin_supervisor ON public.promo_media FOR SELECT TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: promo_media promo_media_update_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_media_update_admin_supervisor ON public.promo_media FOR UPDATE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role]))) WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: promo_screens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_screens ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_screens promo_screens_delete_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_screens_delete_admin_supervisor ON public.promo_screens FOR DELETE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: promo_screens promo_screens_insert_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_screens_insert_admin_supervisor ON public.promo_screens FOR INSERT TO authenticated WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: promo_screens promo_screens_select_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_screens_select_admin_supervisor ON public.promo_screens FOR SELECT TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: promo_screens promo_screens_update_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promo_screens_update_admin_supervisor ON public.promo_screens FOR UPDATE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role]))) WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])));


--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: settings settings_delete_admin_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_delete_admin_only ON public.settings FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::public.user_role) AND (profiles.is_active = true)))));


--
-- Name: settings settings_insert_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_insert_admin_supervisor ON public.settings FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true)))));


--
-- Name: settings settings_select_active_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_select_active_users ON public.settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: settings settings_update_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_update_admin_supervisor ON public.settings FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true)))));


--
-- Name: shift_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_sessions shift_sessions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_sessions_insert_own ON public.shift_sessions FOR INSERT WITH CHECK (((cashier_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true))))));


--
-- Name: shift_sessions shift_sessions_select_own_or_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_sessions_select_own_or_supervisor ON public.shift_sessions FOR SELECT USING (((cashier_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true))))));


--
-- Name: shift_sessions shift_sessions_update_own_or_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_sessions_update_own_or_supervisor ON public.shift_sessions FOR UPDATE USING (((cashier_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true)))))) WITH CHECK (((cashier_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true))))));


--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements stock_movements_select_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_movements_select_supervisor ON public.stock_movements FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (profiles.is_active = true)))));


--
-- Name: transaction_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_items transaction_items_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transaction_items_select_authenticated ON public.transaction_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_select_authenticated ON public.transactions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: POLICY transactions_select_authenticated ON transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY transactions_select_authenticated ON public.transactions IS 'Semua user login (role apa saja, asal is_active) boleh lihat semua transaksi — sengaja tidak dibatasi per-kasir, lihat catatan desain di header migration 011. Anon/publik otomatis ditolak karena auth.uid() bernilai NULL untuk mereka.';


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: objects payment_proofs_storage_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY payment_proofs_storage_insert ON storage.objects FOR INSERT WITH CHECK (((bucket_id = 'payment-proofs'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true))))));


--
-- Name: objects payment_proofs_storage_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY payment_proofs_storage_select ON storage.objects FOR SELECT USING ((bucket_id = 'payment-proofs'::text));


--
-- Name: objects promo_media_storage_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY promo_media_storage_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'promo-media'::text) AND (public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role]))));


--
-- Name: objects promo_media_storage_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY promo_media_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'promo-media'::text) AND (public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role]))));


--
-- Name: objects promo_media_storage_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY promo_media_storage_select ON storage.objects FOR SELECT USING ((bucket_id = 'promo-media'::text));


--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict oWH8CHzofmMEf9Bd7scptZJ3TU8UoDgFeMnb8uHmelWiA5vhMFyyaBRBVjTuZtv

