--
-- PostgreSQL database dump
--


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

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


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
-- Name: profiles profiles_enforce_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_enforce_role_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_profiles_role_change();


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
-- Name: profiles profiles_select_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_admin_supervisor ON public.profiles FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::public.user_role, 'supervisor'::public.user_role])) AND (p.is_active = true)))));


--
-- Name: profiles profiles_update_admin_supervisor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_admin_supervisor ON public.profiles FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.profiles caller
  WHERE ((caller.id = auth.uid()) AND (caller.is_active = true) AND (caller.role = 'admin'::public.user_role)))) OR ((role <> 'admin'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.profiles caller
  WHERE ((caller.id = auth.uid()) AND (caller.is_active = true) AND (caller.role = 'supervisor'::public.user_role))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles caller
  WHERE ((caller.id = auth.uid()) AND (caller.is_active = true) AND (caller.role = 'admin'::public.user_role)))) OR ((role <> 'admin'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.profiles caller
  WHERE ((caller.id = auth.uid()) AND (caller.is_active = true) AND (caller.role = 'supervisor'::public.user_role)))))));


--
-- Name: POLICY profiles_update_admin_supervisor ON profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY profiles_update_admin_supervisor ON public.profiles IS 'Admin+supervisor boleh UPDATE profiles siapa pun (migration 018), TAPI supervisor tidak lolos sama sekali untuk baris yang role-nya admin (SEBELUM maupun SESUDAH update) — migration 020, menutup celah full_name/email yang tidak lewat trigger enforce_profiles_role_change.';


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
-- PostgreSQL database dump complete
--



-- ==========================================================
-- Seed default `settings` (PRD §17 T-01 / migration 005).
-- TIDAK ikut ter-dump oleh `pg_dump --schema-only` (itu perintah dump
-- struktur saja, isi baris apa pun termasuk seed default ini otomatis
-- terbuang, apa pun sumbernya) — ditambahkan manual di sini supaya
-- instalasi baru langsung punya baris yang dibutuhkan `hooks/useSettings.ts`
-- (updateSetting() memakai .update().eq("key", ...) — kalau baris belum
-- ada, update itu "berhasil" tapi 0 baris kena, jadi kelihatan seperti
-- "tidak tersimpan").
-- ==========================================================
insert into public.settings (key, value, description) values
  ('nama_toko',          '"Langitan.co"'::jsonb,                        'Nama toko, tampil di header struk/nota.'),
  ('alamat',             '""'::jsonb,                                   'Alamat toko, tampil di footer struk/nota.'),
  ('telepon',            '""'::jsonb,                                   'Nomor telepon toko, tampil di struk/nota.'),
  ('footer_struk',       '"Terima kasih atas kunjungan Anda"'::jsonb,    'Teks footer struk/nota.'),
  ('ppn_enabled',        'false'::jsonb,                                'Aktifkan baris PPN di transaksi (PaymentModal) & struk. Default off sesuai PRD §4.2.'),
  ('ppn_rate',           '11'::jsonb,                                   'Persentase PPN, dipakai kalau ppn_enabled = true.'),
  ('rounding',           '100'::jsonb,                                  'Pembulatan kembalian tunai ke kelipatan ini (rupiah). Belum dipakai di T-01, disiapkan untuk T-02/T-03.'),
  ('shift_default_cash', '0'::jsonb,                                    'Modal awal kas default saat kasir buka shift. Dipakai mulai T-04.'),
  ('print_default',      '"nota"'::jsonb,                               'Format cetak default: "struk" (thermal) atau "nota" (A6/A5). Dipakai mulai T-03.'),
  ('paper_nota',         '"A6"'::jsonb,                                 'Ukuran kertas nota: "A6" atau "A5". Dipakai mulai T-03.'),
  ('paper_thermal',      '"80mm"'::jsonb,                               'Ukuran kertas thermal: "58mm" atau "80mm". Dipakai mulai T-03.'),
  ('show_cost_price',    'false'::jsonb,                                'Tampilkan harga modal di layar yang butuh permission harga_modal (PRD §5).')
on conflict (key) do nothing;

-- ==========================================================
-- Storage bucket "payment-proofs" (migration 006).
-- Schema `storage` sengaja dikecualikan `pg_dump` (dianggap milik platform
-- Supabase, bukan milik user) — bucket & policy-nya ditambah manual di
-- sini, kalau tidak, upload bukti pembayaran (PaymentModal) akan gagal
-- di instalasi baru walau semua tabel `public` sudah benar.
-- ==========================================================
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', true)
on conflict (id) do nothing;

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