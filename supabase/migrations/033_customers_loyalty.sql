-- ── TAMBAHAN (Kasir: pelanggan + poin loyalitas) ──
-- Migration ini MURNI ADDITIVE: satu tabel baru (`customers`) + satu fungsi
-- baru (`redeem_loyalty_points`). TIDAK mengubah tabel/enum/RPC yang sudah
-- ada (payment_method, create_transaction, dst.) sama sekali — jadi tidak
-- ada risiko ke alur transaksi/pembayaran yang sudah berjalan.
--
-- KEPUTUSAN DESAIN:
-- - Pemilihan pelanggan di layar Kasir TIDAK mengubah RPC create_transaction.
--   Nama & no. HP pelanggan yang dipilih dikirim lewat parameter yang SUDAH
--   ADA (p_customer_name/p_customer_phone, migration 013) — customer_id tidak
--   disimpan di baris transaksi pada tahap ini (bisa ditambah lagi nanti kalau
--   dibutuhkan pelaporan per-pelanggan).
-- - Potongan poin dikirim lewat parameter `p_discount` yang SUDAH ADA juga
--   (selama ini selalu dikirim 0 dari KasirModule.tsx) — jadi tidak perlu
--   kolom/parameter baru untuk itu.
-- - 1 poin = Rp 100 (konstanta LOYALTY_POINT_VALUE di KasirModule.tsx) — ubah
--   di sana kalau pemilik toko mau rate lain, tidak perlu migration baru.
-- - RLS: siapa pun user aktif (semua role kasir) boleh lihat/cari & menambah
--   pelanggan baru saat transaksi.
--   ── KOREKSI ── Versi pertama migration ini pakai `current_user_role()`,
--   tapi fungsi itu sudah DIHAPUS oleh migration 028_dynamic_roles.sql (baca
--   komentarnya: "Helper functions baru (pengganti current_user_role())").
--   supabase/schema.sql yang saya baca sebelumnya rupanya cuma snapshot LAMA
--   (dari sebelum migration 028 digabung ulang ke sana) — bukan cerminan
--   state DB yang sebenarnya. Penggantinya, `current_role_id()`, punya
--   perilaku identik (SECURITY DEFINER, return NULL kalau user tidak
--   aktif/tidak ditemukan) — jadi `current_role_id() IS NOT NULL` di sini
--   persis sama maknanya dengan `current_user_role() IS NOT NULL` yang lama.
--   TIDAK ada policy DELETE (konsisten dengan budaya soft-delete di app ini
--   — data pelanggan tidak dihapus lewat UI Kasir).

-- ── Idempotensi ── Ditulis pakai IF NOT EXISTS / DROP POLICY IF EXISTS /
-- CREATE OR REPLACE supaya AMAN dijalankan ulang — termasuk kalau percobaan
-- SEBELUMNYA (yang error di current_user_role()) sempat membuat tabel
-- `customers` duluan sebelum gagal di statement CREATE POLICY (SQL editor
-- Supabase commit per-statement, bukan satu transaksi besar).

CREATE TABLE IF NOT EXISTS public.customers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    phone text,
    loyalty_points integer NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_name_idx ON public.customers USING btree (lower(name));

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select_active_users ON public.customers;
CREATE POLICY customers_select_active_users ON public.customers
    FOR SELECT TO authenticated
    USING (public.current_role_id() IS NOT NULL);

DROP POLICY IF EXISTS customers_insert_active_users ON public.customers;
CREATE POLICY customers_insert_active_users ON public.customers
    FOR INSERT TO authenticated
    WITH CHECK (public.current_role_id() IS NOT NULL);

DROP POLICY IF EXISTS customers_update_active_users ON public.customers;
CREATE POLICY customers_update_active_users ON public.customers
    FOR UPDATE TO authenticated
    USING (public.current_role_id() IS NOT NULL)
    WITH CHECK (public.current_role_id() IS NOT NULL);

COMMENT ON TABLE public.customers IS 'Data pelanggan toko + saldo poin loyalitas. Dipakai layar Kasir untuk pencarian pelanggan opsional (fitur "Buka Kasir" flow baru). Tidak ada FK ke transactions pada tahap ini — lihat catatan header migration.';

-- Fungsi atomik untuk memakai poin: mengunci baris pelanggan, memastikan poin
-- cukup, lalu mengurangi. Dipanggil dari KasirModule.tsx SETELAH transaksi
-- berhasil dibuat (bukan sebelum) — supaya poin tidak berkurang kalau
-- create_transaction gagal.
CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(p_customer_id uuid, p_points integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current integer;
BEGIN
    IF p_points <= 0 THEN
        RETURN;
    END IF;

    SELECT loyalty_points INTO v_current
    FROM public.customers
    WHERE id = p_customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pelanggan tidak ditemukan.';
    END IF;

    IF v_current < p_points THEN
        RAISE EXCEPTION 'Poin tidak cukup. Tersedia %, diminta %', v_current, p_points;
    END IF;

    UPDATE public.customers
    SET loyalty_points = loyalty_points - p_points,
        updated_at = now()
    WHERE id = p_customer_id;
END;
$$;

COMMENT ON FUNCTION public.redeem_loyalty_points(uuid, integer) IS 'Kurangi poin loyalitas pelanggan secara atomik (row lock + validasi cukup). Dipanggil Kasir setelah transaksi dengan potongan poin berhasil disimpan.';

GRANT EXECUTE ON FUNCTION public.redeem_loyalty_points(uuid, integer) TO authenticated;
