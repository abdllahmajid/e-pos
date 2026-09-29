-- =====================================================================
-- Migration 034: Metode pembayaran disederhanakan jadi 3 + hapus bukti bayar
-- =====================================================================
-- Permintaan pemilik project: metode bayar hanya TUNAI, DIGITAL, PIUTANG.
-- Pembayaran digital nanti disambungkan ke Midtrans, jadi konsep upload
-- bukti transfer/QRIS dihapus — termasuk tabelnya.
--
-- YANG BERUBAH
--   1. Enum `payment_method` dibangun ulang dengan TEPAT 3 nilai:
--        CASH    = Tunai
--        DIGITAL = Digital (gabungan QRIS + transfer bank + debit/kredit lama)
--        TEMPO   = Piutang (nilainya tetap TEMPO supaya RPC settle_receivable,
--                  laporan piutang, dan dashboard tidak perlu diubah)
--      Data lama dipetakan: tunai -> CASH; transfer/QRIS/BANK_TRANSFER -> DIGITAL.
--   2. RPC `create_transaction` dibuat ulang PERSIS seperti sekarang (definisinya
--      disalin otomatis dari database, bukan diketik ulang) hanya saja tipe
--      parameternya sekarang enum baru. Nilai lama (QRIS dst.) otomatis ditolak
--      Postgres ("invalid input value for enum").
--   3. Tabel `payment_proofs` dihapus + policy Storage bucket-nya. Ini juga
--      menghapus bukti PELUNASAN piutang (proof_type = 'settlement'), karena
--      tabelnya dipakai bersama.
--
-- YANG TIDAK OTOMATIS
--   * Bucket Storage `payment-proofs` + file di dalamnya TIDAK ikut terhapus
--     (Supabase melarang hapus data storage lewat SQL). Hapus manual:
--     Dashboard -> Storage -> payment-proofs -> Empty bucket -> Delete bucket.
--     Unduh dulu file yang masih mau disimpan.
--
-- SEBELUM MENJALANKAN (opsional, cek dulu isinya):
--   select count(*) from public.payment_proofs;
--   select method, count(*) from public.payments group by 1;
--
-- URUTAN DEPLOY: jalankan migration ini, lalu deploy kode aplikasinya.
-- Ditulis sebagai SATU transaksi: kalau ada error, semuanya dibatalkan.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pengaman: nilai 'lainnya' (warisan setup awal) tidak punya padanan
--    yang jelas. Kalau ada barisnya, berhenti dan minta keputusan manual
--    daripada menebak (salah tebak bisa menggeser hitungan kas tunai).
-- ---------------------------------------------------------------------
do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.payments where method::text = 'lainnya';
  if v_n > 0 then
    raise exception
      'Ada % baris payments dengan method ''lainnya''. Tentukan dulu jadi CASH atau DIGITAL, mis.: update public.payments set method = ''CASH'' where method::text = ''lainnya''; (tipe kolom masih enum lama, jalankan lewat ::text bila perlu) lalu ulangi migration ini.',
      v_n;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1-5. Bangun ulang enum + semua yang bergantung padanya
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_defs text[] := array[]::text[];
  v_comments text[] := array[]::text[];
  v_sigs text[] := array[]::text[];
  v_def text;
  v_proofs bigint := 0;
begin
  -- 1a. Simpan definisi + komentar semua function yang memakai tipe enum lama,
  --     lalu hapus (function tidak bisa dialihkan ke tipe baru begitu saja).
  for r in
    select p.oid,
           p.oid::regprocedure::text as sig,
           obj_description(p.oid, 'pg_proc') as cmt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and 'public.payment_method'::regtype::oid = any (p.proargtypes::oid[])
  loop
    v_defs := array_append(v_defs, pg_get_functiondef(r.oid));
    v_comments := array_append(v_comments, r.cmt);
    v_sigs := array_append(v_sigs, r.sig);
  end loop;

  if coalesce(array_length(v_sigs, 1), 0) = 0 then
    raise exception 'Function create_transaction tidak ditemukan — database tidak sesuai dugaan, migration dibatalkan.';
  end if;

  foreach v_def in array v_sigs loop
    execute 'drop function ' || v_def;
  end loop;

  -- 2. Index parsial yang mengunci ke enum lama.
  drop index if exists public.payments_tempo_unsettled_idx;

  -- 3. Enum baru (nama lama dipakai ulang; enum lama diganti nama sementara).
  alter type public.payment_method rename to payment_method_old;
  create type public.payment_method as enum ('CASH', 'DIGITAL', 'TEMPO');

  -- 4. Pindahkan kolom + petakan data lama.
  alter table public.payments
    alter column method type public.payment_method
    using (
      case method::text
        when 'CASH'          then 'CASH'
        when 'tunai'         then 'CASH'
        when 'TEMPO'         then 'TEMPO'
        else 'DIGITAL'  -- transfer, QRIS, BANK_TRANSFER
      end
    )::public.payment_method;

  create index payments_tempo_unsettled_idx
    on public.payments using btree (due_date)
    where method = 'TEMPO'::public.payment_method and is_settled = false;

  -- 5. Pasang kembali function dari definisi yang disimpan. Nama tipe
  --    `payment_method` di dalamnya sekarang otomatis mengarah ke enum baru.
  foreach v_def in array v_defs loop
    execute v_def;
  end loop;

  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and 'public.payment_method'::regtype::oid = any (p.proargtypes::oid[])
  loop
    -- Hak akses sama seperti sebelumnya (migration 021): hanya user login
    -- (+ service_role bawaan Supabase), anon dan publik ditutup.
    execute 'revoke all on function ' || r.sig || ' from public, anon';
    execute 'grant execute on function ' || r.sig || ' to authenticated, service_role';
  end loop;

  -- Komentar function dikembalikan (urutan sama dengan array v_sigs; tanda
  -- tangan function tidak berubah, nama tipe `payment_method` kini = enum baru).
  for i in 1 .. array_length(v_sigs, 1) loop
    if v_comments[i] is not null then
      execute format('comment on function %s is %L', v_sigs[i], v_comments[i]);
    end if;
  end loop;

  drop type public.payment_method_old;

  -- 6. Hapus tabel bukti pembayaran (policy & FK ikut terhapus bersama tabel).
  if to_regclass('public.payment_proofs') is not null then
    execute 'select count(*) from public.payment_proofs' into v_proofs;
    raise notice 'payment_proofs: % baris dihapus.', v_proofs;
    drop table public.payment_proofs;
  end if;
end
$$;

-- Policy Storage untuk bucket payment-proofs (bucket & file dihapus manual).
drop policy if exists "payment_proofs_storage_select" on storage.objects;
drop policy if exists "payment_proofs_storage_insert" on storage.objects;

comment on type public.payment_method is
  'Metode bayar: CASH = tunai, DIGITAL = pembayaran digital (Midtrans), TEMPO = piutang.';

-- Segarkan schema cache PostgREST supaya tipe/function baru langsung dikenali.
notify pgrst, 'reload schema';

commit;
