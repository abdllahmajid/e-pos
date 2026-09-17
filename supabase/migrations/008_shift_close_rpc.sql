-- Migration: RPC close_shift() — pelengkap 007_shift_sessions.sql (PRD §17 T-04).
--
-- Kenapa perlu RPC terpisah (tidak cukup UPDATE langsung dari client seperti
-- useSettings.updateSetting())?
--
-- Sesuai Aturan Main #5 PRD ("Tulis/logika uang di RPC SECURITY DEFINER, bukan di
-- client"): `expected_cash` BUKAN angka yang kasir ketik, melainkan hasil agregasi
-- (modal awal + total penjualan tunai selama shift) yang harus dihitung dari sumber
-- data asli (`payments`/`transactions`), bukan dipercaya begitu saja dari payload
-- client — kalau dihitung di client lalu di-UPDATE langsung, kasir yang curang bisa
-- kirim `expected_cash` palsu supaya `difference` (selisih kas) selalu terlihat nol.
-- `close_shift` di bawah cuma menerima 1 input dari kasir (`p_actual_cash`, hasil
-- hitung fisik pecahan uang), sisanya (expected_cash, difference, closed_at, status)
-- dihitung & dikunci sepenuhnya oleh RPC.
--
-- Buka shift (`open_shift`) SENGAJA TIDAK dibuatkan RPC — `opening_cash` murni input
-- kasir (modal awal disepakati sebelum transaksi apapun terjadi, tidak ada nilai lain
-- yang bisa "dipalsukan" di titik ini), jadi insert langsung dari client
-- (`hooks/useShifts.ts`, ditolak RLS `shift_sessions_insert_own` kalau cashier_id
-- bukan diri sendiri, ditolak unique index kalau sudah ada shift OPEN) sudah cukup
-- aman tanpa perlu RPC tambahan.

create or replace function public.close_shift(
  p_shift_id uuid,
  p_actual_cash bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;
