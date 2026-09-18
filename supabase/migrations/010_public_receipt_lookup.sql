-- Migration: RPC publik untuk halaman /cek-struk (PRD §17 T-07, §4.9).
--
-- ── Keputusan desain ──
-- 1. TIDAK menambah policy `anon select` di tabel `transactions` — sesuai PRD §17 T-07
--    ("jangan bikin policy anon select polos"). Sebagai gantinya, satu RPC
--    `SECURITY DEFINER` yang jalan sebagai owner (bypass RLS sepenuhnya) dan hanya
--    mengembalikan data kalau NOMOR STRUK + TANGGAL cocok. Nomor struk saja tidak
--    cukup rahasia (formatnya berurutan: LCO-STR/26/09/000123), jadi tanpa pasangan
--    tanggal, orang bisa mencoba nomor urut satu-satu (enumerasi). Dua kunci ini
--    membuat pencarian brute-force tidak praktis untuk pemakaian normal.
-- 2. Pesan gagal SENGAJA generik ("Struk tidak ditemukan...") untuk kedua kasus —
--    nomor struk salah ATAUPUN nomor benar tapi tanggal salah. Kalau pesannya beda,
--    itu sendiri jadi celah buat menebak nomor struk yang valid satu per satu.
-- 3. Field yang dikembalikan SENGAJA tidak menyertakan `cost_price`/harga modal
--    (PRD §4.9 eksplisit: "tanpa harga modal"). Amannya lebih tinggi dari itu:
--    `transaction_items` memang tidak pernah menyimpan `cost_price` sama sekali
--    (lihat scripts/setup-database.sql) — hanya snapshot `unit_price` jual — jadi
--    tidak ada kolom harga modal yang bisa "kebocoran" dari tabel ini.
-- 4. Tidak mengembalikan `cashier_name`, `customer_phone`, atau rincian pembayaran
--    (nomor referensi transfer, bukti foto) — cukup metode pembayarannya saja.
--    Data itu tidak perlu diketahui pelanggan lewat halaman publik dan tidak masuk
--    scope "status & rincian" di PRD §4.9.
-- 5. Perbandingan tanggal pakai `AT TIME ZONE 'Asia/Jakarta'`, BUKAN `::date` mentah
--    dari timestamptz UTC — pola sama seperti `dateKey()` di hooks/useDashboard.ts
--    (T-06): di WIB (UTC+7), transaksi jam 00:00–07:00 akan salah tanggal kalau
--    dibaca sebagai UTC.
--
-- ── ⚠️ Temuan keamanan (BUKAN scope T-07, dicatat supaya tidak lupa) ──
-- Tabel `transactions`, `transaction_items`, dan `payments` SAMPAI SAAT INI belum
-- pernah diaktifkan RLS-nya sama sekali di migration manapun (beda dengan
-- `stock_movements`, `shift_sessions`, `payment_proofs` yang sudah). Karena privilege
-- default Supabase memberi role `anon`/`authenticated` akses langsung ke tabel baru,
-- ini berarti SEMUA transaksi (termasuk milik toko, bukan cuma yang dicari lewat
-- /cek-struk) berisiko bisa dibaca langsung lewat PostgREST tanpa login sama sekali,
-- di luar jalur RPC ini. Migration ini TIDAK memperbaikinya — menambah RLS di 3 tabel
-- itu sekarang butuh policy lengkap per role (kasir/supervisor/admin, lihat PRD §5)
-- yang belum dirancang, dan kalau ditambah asal-asalan di sini berisiko mematahkan
-- seluruh modul yang sudah jalan (Kasir, Riwayat, Dashboard, dll). Ini PR/migration
-- terpisah yang lebih besar — jangan dikerjakan tercampur T-07.

create or replace function public.get_transaction_by_receipt(
  p_receipt_no text,
  p_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

comment on function public.get_transaction_by_receipt(text, date) is
  'Lookup publik untuk halaman /cek-struk (PRD §4.9, §17 T-07). SECURITY DEFINER '
  '— sengaja bypass RLS lewat RPC yang divalidasi ketat (nomor struk + tanggal harus '
  'cocok), bukan lewat policy anon select langsung di transactions. Tidak pernah '
  'mengembalikan harga modal, nama kasir, atau detail bukti pembayaran.';

-- Eksplisit: hanya boleh dipanggil, tidak ada hak lain yang ikut menempel.
revoke all on function public.get_transaction_by_receipt(text, date) from public;
grant execute on function public.get_transaction_by_receipt(text, date) to anon, authenticated;
