-- Migration 032: perbaikan bug di close_shift() — kolom salah tulis.
--
-- KONTEKS TEMUAN:
-- Migration 028 menulis ulang close_shift() (CREATE OR REPLACE) hanya untuk
-- mengganti pengecekan admin/supervisor menjadi current_role_lintas_kasir().
-- Tapi di baris UPDATE shift_sessions, kolom hasil hitung selisih kas salah
-- ditulis sebagai `cash_difference` — padahal kolom aslinya (migration 007)
-- bernama `difference`. Akibatnya close_shift SELALU gagal dipanggil dari
-- frontend dengan error "column cash_difference of relation shift_sessions
-- does not exist" (muncul di console sebagai object kosong {}).
--
-- Perbaikan ini HANYA mengganti nama kolom di UPDATE, tidak mengubah logika
-- lain (hitung expected_cash/cash_sales, gate lintas_kasir) dari versi 028.

create or replace function public.close_shift(p_shift_id uuid, p_actual_cash bigint)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_shift RECORD;
    v_caller_id UUID;
    v_can_force_close BOOLEAN := FALSE;
    v_cash_sales BIGINT := 0;
    v_expected_cash BIGINT;
    v_difference BIGINT;
begin
    v_caller_id := auth.uid();

    IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
        RAISE EXCEPTION 'Nominal kas fisik tidak valid';
    END IF;

    SELECT * INTO v_shift FROM shift_sessions WHERE id = p_shift_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift tidak ditemukan';
    END IF;

    IF v_shift.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Shift ini sudah ditutup sebelumnya';
    END IF;

    -- Migration 028: "admin/supervisor" -> current_role_lintas_kasir()
    -- (role apa pun dengan flag lintas_kasir boleh force-close shift orang lain).
    v_can_force_close := public.current_role_lintas_kasir();

    IF v_shift.cashier_id <> v_caller_id AND NOT v_can_force_close THEN
        RAISE EXCEPTION 'Anda tidak berhak menutup shift ini';
    END IF;

    SELECT COALESCE(SUM(pay.amount), 0) INTO v_cash_sales
    FROM payments pay
    JOIN transactions t ON t.id = pay.transaction_id
    WHERE t.shift_id = p_shift_id AND pay.method = 'CASH';

    v_expected_cash := v_shift.opening_cash + v_cash_sales;
    v_difference := p_actual_cash - v_expected_cash;

    -- FIX migration 032: kolom yang benar adalah `difference` (migration 007),
    -- bukan `cash_difference` (typo dari migration 028).
    UPDATE shift_sessions
    SET status = 'CLOSED', closed_at = NOW(), actual_cash = p_actual_cash,
        expected_cash = v_expected_cash, difference = v_difference
    WHERE id = p_shift_id;

    RETURN jsonb_build_object(
        'success', true, 'shift_id', p_shift_id, 'expected_cash', v_expected_cash,
        'actual_cash', p_actual_cash, 'difference', v_difference
    );
end;
$$;

comment on function public.close_shift(uuid, bigint) is 'Tutup shift kasir. Migration 032: perbaiki typo migration 028 (cash_difference -> difference). Logika lain tidak berubah.';
