-- Migration 021: Split payment di RPC create_transaction (PRD §17 T-11 bagian 2)
-- + perbaikan semantik `payments.amount` + pengamanan akses RPC.
--
-- Nomor 021 sengaja dipilih (bukan 020) supaya tidak bentrok dengan
-- `020_profiles_update_admin_lock.sql` yang direncanakan PROGRESS.md sesi #14.
--
-- ══════════════════════════════════════════════════════════════════════════
-- RINGKASAN 3 PERUBAHAN (semua di fungsi yang sama, jadi satu file)
-- ══════════════════════════════════════════════════════════════════════════
--
-- 1. SPLIT PAYMENT (fitur baru)
--    Parameter baru `p_payments jsonb default null` (parameter ke-13). Kalau diisi,
--    berbentuk array 1-4 elemen:
--      [{"method":"CASH","amount":50000,"received_amount":100000},
--       {"method":"BANK_TRANSFER","amount":30000},
--       {"method":"TEMPO","amount":20000,"due_date":"2026-10-30"}]
--    Setiap elemen menjadi satu baris `payments` (tabel sudah 1-ke-banyak sejak
--    awal, jadi TIDAK ada perubahan skema). Aturan: jumlah `amount` HARUS persis
--    = p_total; tiap metode maksimal sekali; CASH wajib `received_amount` >=
--    amount; TEMPO wajib `due_date` + nama pelanggan. Kalau p_payments NULL,
--    perilaku pembayaran tunggal lama tetap dipakai (kompatibel).
--    Hasil RPC ditambah `payments: [{payment_id, method, amount}]` supaya UI bisa
--    menempelkan bukti transfer/QRIS ke baris yang benar. Field `payment_id`
--    lama tetap ada (= baris pertama).
--    Laporan Piutang (T-08) dan close_shift (008) TIDAK perlu diubah: piutang
--    dihitung per baris TEMPO (sisa tempo = amount baris itu), kas fisik dihitung
--    dari baris CASH saja.
--
-- 2. PERBAIKAN BUG `payments.amount` UNTUK CASH (ditemukan saat mendesain split)
--    Sebelum migration ini, transaksi CASH menyimpan `amount` = UANG DITERIMA
--    (sudah termasuk kembalian). Contoh: belanja Rp80.000, bayar Rp100.000 →
--    amount=100000, change=20000. Padahal close_shift (migration 008) menghitung
--    kas seharusnya dengan SUM(amount) method CASH → laci "seharusnya" berisi
--    Rp20.000 LEBIH BANYAK dari kenyataan untuk setiap transaksi yang ada
--    kembaliannya, dan selisih kas shift jadi minus palsu. Sekarang: amount =
--    porsi tagihan (Rp80.000), received_amount = Rp100.000, change = Rp20.000.
--    ⚠ Data LAMA tidak diubah otomatis — lihat bagian 5 di bawah (opsional).
--
-- 3. PENGAMANAN AKSES RPC
--    a. Overload lama create_transaction (versi 10, 11, dan 12 parameter dari
--       migration 003/006/007/009/013) DIHAPUS. Karena `create or replace` dengan
--       jumlah parameter berbeda membuat fungsi BARU (overload), versi-versi lama
--       itu masih hidup berdampingan: (a) request yang tidak menyebut semua
--       parameter bisa jadi ambigu (error PGRST203), dan (b) versi lama tidak
--       punya cek shift (T-04) / catatan stock_movements (T-05) sehingga bisa
--       dipanggil langsung lewat REST untuk melewati aturan itu.
--    b. `auth.uid()` NULL sekarang ditolak (sebelumnya sengaja dilonggarkan).
--    c. EXECUTE dicabut dari `public` & `anon`, hanya `authenticated` — pola
--       sama seperti settle_receivable (migration 012).
--
-- Bagian tubuh fungsi yang TIDAK terkait 3 hal di atas (kunci stok, snapshot item,
-- stock_movements, nomor struk, shift) disalin persis dari migration 013.
--
-- Idempotent: aman dijalankan ulang (drop ... if exists, create or replace).
-- Belum dijalankan/diuji di database manapun saat file ini ditulis.

-- --------------------------------------------------------
-- 1. Hapus overload lama (sebelum membuat versi 13 parameter)
-- --------------------------------------------------------

-- 10 parameter (migration 003)
drop function if exists public.create_transaction(
  jsonb, bigint, bigint, bigint, bigint, text, text, payment_method, bigint, bigint
);

-- 11 parameter (migration 006/007/009: + p_due_date)
drop function if exists public.create_transaction(
  jsonb, bigint, bigint, bigint, bigint, text, text, payment_method, bigint, bigint, date
);

-- 12 parameter (migration 013: + p_customer_phone)
drop function if exists public.create_transaction(
  jsonb, bigint, bigint, bigint, bigint, text, text, payment_method, bigint, bigint, date, text
);

-- --------------------------------------------------------
-- 2. Fungsi baru (13 parameter)
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
  p_due_date date default null::date,
  p_customer_phone text default null::text,
  p_payments jsonb default null::jsonb
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

    -- ── TAMBAHAN (021) ── variabel untuk split payment (p_payments)
    v_pay JSONB;
    v_pay_method TEXT;
    v_pay_amount BIGINT;
    v_pay_received BIGINT;
    v_pay_due DATE;
    v_pay_change BIGINT;
    v_pay_sum BIGINT := 0;
    v_pay_methods TEXT[] := ARRAY[]::TEXT[];
    v_has_tempo BOOLEAN := FALSE;
    v_first_payment_id UUID;
    v_payments_result JSONB := '[]'::jsonb;
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
    -- ── KOREKSI (021) ── hanya untuk jalur pembayaran TUNGGAL (p_payments NULL).
    -- Jalur split divalidasi per baris di blok bawah.
    IF p_payments IS NULL AND p_payment_method = 'TEMPO' THEN
        IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
            RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
        END IF;

        IF p_due_date IS NULL THEN
            RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
        END IF;
    END IF;

    -- ── TAMBAHAN (021) ── Validasi split payment (PRD §17 T-11 bagian 2).
    -- Aturan: array 1..4 baris, tiap metode maksimal 1x, tiap `amount` > 0 dan
    -- JUMLAH `amount` HARUS PERSIS = p_total (tidak boleh kurang/lebih — sisa yang
    -- belum dibayar harus dicatat eksplisit sebagai baris TEMPO, bukan dibiarkan
    -- menggantung). CASH wajib `received_amount` >= amount. TEMPO wajib
    -- `due_date` + nama pelanggan. Divalidasi di sini (SEBELUM baris produk dikunci
    -- FOR UPDATE) supaya request salah bentuk gagal cepat tanpa menahan lock stok.
    IF p_payments IS NOT NULL THEN
        IF jsonb_typeof(p_payments) <> 'array'
           OR jsonb_array_length(p_payments) = 0
           OR jsonb_array_length(p_payments) > 4
        THEN
            RAISE EXCEPTION 'Rincian pembayaran tidak valid (wajib array 1-4 baris)';
        END IF;

        IF p_total <= 0 THEN
            RAISE EXCEPTION 'Split pembayaran hanya untuk transaksi dengan total lebih dari nol';
        END IF;

        FOR v_pay IN
            SELECT value FROM jsonb_array_elements(p_payments)
        LOOP
            v_pay_method := v_pay->>'method';

            IF v_pay_method IS NULL
               OR v_pay_method NOT IN ('CASH', 'BANK_TRANSFER', 'QRIS', 'TEMPO')
            THEN
                RAISE EXCEPTION 'Metode pembayaran tidak dikenal: %', COALESCE(v_pay_method, '(kosong)');
            END IF;

            IF v_pay_method = ANY (v_pay_methods) THEN
                RAISE EXCEPTION 'Metode pembayaran % dipakai lebih dari sekali', v_pay_method;
            END IF;
            v_pay_methods := v_pay_methods || v_pay_method;

            v_pay_amount := (v_pay->>'amount')::BIGINT;
            IF v_pay_amount IS NULL OR v_pay_amount <= 0 THEN
                RAISE EXCEPTION 'Nominal pembayaran % harus lebih dari nol', v_pay_method;
            END IF;
            v_pay_sum := v_pay_sum + v_pay_amount;

            IF v_pay_method = 'CASH' THEN
                v_pay_received := (v_pay->>'received_amount')::BIGINT;
                IF v_pay_received IS NULL OR v_pay_received < v_pay_amount THEN
                    RAISE EXCEPTION 'Uang tunai yang diterima kurang dari porsi tunai';
                END IF;
            END IF;

            IF v_pay_method = 'TEMPO' THEN
                v_has_tempo := TRUE;
                IF NULLIF(v_pay->>'due_date', '') IS NULL THEN
                    RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
                END IF;
            END IF;
        END LOOP;

        IF v_pay_sum <> p_total THEN
            RAISE EXCEPTION
                'Jumlah rincian pembayaran (%) harus sama dengan total transaksi (%)',
                v_pay_sum, p_total;
        END IF;

        IF v_has_tempo AND (p_customer_name IS NULL OR trim(p_customer_name) = '') THEN
            RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
        END IF;
    END IF;

    v_cashier_id := auth.uid();

    -- ── TAMBAHAN (021) ── Tolak pemanggil tanpa sesi login. Sebelumnya fungsi ini
    -- sengaja "longgar" kalau auth.uid() NULL (shift tidak dicek, cashier_id NULL),
    -- sehingga request anon bisa membuat transaksi & memotong stok. Satu-satunya
    -- pemanggil sah adalah client Kasir yang sudah login (lib/pos/transactionApi.ts).
    IF v_cashier_id IS NULL THEN
        RAISE EXCEPTION 'Anda harus login untuk membuat transaksi';
    END IF;

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
    -- Payments
    --
    -- ── KOREKSI (021) ── SEMANTIK KOLOM `payments` DIRAPIKAN:
    --   amount          = porsi yang DIPAKAI melunasi tagihan (Rp)
    --   received_amount = uang yang diserahkan pelanggan (hanya CASH)
    --   change_amount   = received_amount - amount (hanya CASH)
    -- Sebelum 021, untuk CASH kolom `amount` diisi dengan UANG DITERIMA (termasuk
    -- kembalian) sehingga close_shift (migration 008, SUM(amount) method CASH)
    -- menghitung kas yang seharusnya ada terlalu besar sebesar total kembalian.
    -- Dengan semantik baru, SUM(amount) per metode = omzet per metode, dan
    -- SUM(amount) semua baris satu transaksi = total transaksi.
    -- --------------------------------------------------------

    IF p_payments IS NOT NULL THEN

        -- Jalur SPLIT: satu baris `payments` per elemen p_payments.
        FOR v_pay IN
            SELECT value FROM jsonb_array_elements(p_payments)
        LOOP
            v_pay_method := v_pay->>'method';
            v_pay_amount := (v_pay->>'amount')::BIGINT;
            v_pay_received := NULL;
            v_pay_change := 0;
            v_pay_due := NULL;

            IF v_pay_method = 'CASH' THEN
                v_pay_received := (v_pay->>'received_amount')::BIGINT;
                v_pay_change := v_pay_received - v_pay_amount;
            END IF;

            IF v_pay_method = 'TEMPO' THEN
                v_pay_due := (v_pay->>'due_date')::DATE;
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
                v_pay_method::payment_method,
                v_pay_amount,
                v_pay_received,
                v_pay_change,
                v_pay_due
            )
            RETURNING id INTO v_payment_id;

            IF v_first_payment_id IS NULL THEN
                v_first_payment_id := v_payment_id;
            END IF;

            v_change := v_change + v_pay_change;

            v_payments_result := v_payments_result || jsonb_build_array(
                jsonb_build_object(
                    'payment_id', v_payment_id,
                    'method', v_pay_method,
                    'amount', v_pay_amount
                )
            );
        END LOOP;

        v_payment_id := v_first_payment_id;

    ELSE

        -- Jalur TUNGGAL (perilaku lama, dipertahankan untuk pemanggil lama).
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
            -- KOREKSI (021): CASH → simpan porsi tagihan (= p_total), BUKAN uang
            -- diterima. Metode lain tetap p_payment_amount seperti sebelumnya.
            CASE WHEN p_payment_method = 'CASH' THEN p_total ELSE p_payment_amount END,
            p_received_amount,
            v_change,
            CASE WHEN p_payment_method = 'TEMPO' THEN p_due_date ELSE NULL END
        )
        RETURNING id INTO v_payment_id;

        v_payments_result := jsonb_build_array(
            jsonb_build_object(
                'payment_id', v_payment_id,
                'method', p_payment_method::TEXT,
                'amount', CASE WHEN p_payment_method = 'CASH' THEN p_total ELSE p_payment_amount END
            )
        );

    END IF;


    -- --------------------------------------------------------
    -- Return result
    -- `payment_id` = baris pembayaran pertama (kompatibel dengan pemanggil lama).
    -- `payments`   = SEMUA baris {payment_id, method, amount} — dipakai UI split
    -- untuk menempelkan bukti transfer/QRIS ke baris yang benar (TAMBAHAN 021).
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
$function$;

comment on function public.create_transaction(
  jsonb, bigint, bigint, bigint, bigint, text, text, payment_method, bigint,
  bigint, date, text, jsonb
) is
  'Simpan transaksi + item + pembayaran secara atomik, kurangi stok & catat stock_movements. p_payments (migration 021) opsional: array pembayaran untuk split payment (jumlah amount harus = total). payments.amount = porsi tagihan, received_amount = uang diterima (CASH).';

-- --------------------------------------------------------
-- 3. Hak akses: hanya user login (authenticated)
-- --------------------------------------------------------

revoke all on function public.create_transaction(
  jsonb, bigint, bigint, bigint, bigint, text, text, payment_method, bigint,
  bigint, date, text, jsonb
) from public, anon;

grant execute on function public.create_transaction(
  jsonb, bigint, bigint, bigint, bigint, text, text, payment_method, bigint,
  bigint, date, text, jsonb
) to authenticated;

-- --------------------------------------------------------
-- 4. Segarkan schema cache PostgREST (supaya parameter baru langsung dikenali)
-- --------------------------------------------------------

notify pgrst, 'reload schema';

-- --------------------------------------------------------
-- 5. OPSIONAL — rapikan data CASH lama (JALANKAN MANUAL, SADAR RISIKO)
--
-- Mengubah `amount` transaksi CASH lama dari "uang diterima" menjadi "porsi
-- tagihan" (= amount - change_amount), supaya konsisten dengan semantik baru dan
-- close_shift untuk shift yang MASIH TERBUKA menghitung benar. Ini mengubah data
-- keuangan yang sudah tercatat, jadi sengaja TIDAK aktif otomatis.
--
-- Aman dijalankan ulang: kondisi `amount = received_amount` hanya cocok untuk
-- baris yang belum dikoreksi. Shift yang SUDAH ditutup sebelumnya tidak berubah
-- (expected_cash/difference-nya sudah tersimpan sebagai angka mati).
--
-- Cek dulu berapa baris yang terdampak:
--   select count(*), coalesce(sum(change_amount), 0) as total_kembalian
--   from public.payments
--   where method = 'CASH' and change_amount > 0 and amount = received_amount;
--
-- Lalu, kalau setuju, hapus tanda komentar (--) di 5 baris berikut:
--
-- update public.payments
-- set amount = amount - change_amount
-- where method = 'CASH'
--   and change_amount > 0
--   and amount = received_amount;
