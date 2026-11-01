-- Migration 037: Kartu stok (perbaikan menu Stok & Opname, Fase 1)
--
-- Isi:
--   1. View `stock_ledger`  — riwayat mutasi + nama produk + saldo stok SESUDAH
--      tiap mutasi (stok sebelum = stok sesudah - qty_delta, dihitung di aplikasi).
--   2. RPC `stock_movement_summary` — total masuk/keluar/jumlah mutasi sesuai
--      filter, dihitung di database (bukan dari 150 baris yang tampil di layar).
--
-- Tidak mengubah tabel apa pun dan tidak menyentuh RPC transaksi
-- (create_transaction / return_transaction / void_transaction / adjust_stock).
-- Aman dijalankan ulang (create or replace).
--
-- Cara kerja saldo: dihitung MUNDUR dari stok produk saat ini. Mutasi terbaru
-- selalu cocok dengan stok sekarang; mutasi yang lebih lama = stok sekarang
-- dikurangi seluruh mutasi yang terjadi sesudahnya. Jadi tidak perlu kolom baru
-- dan tidak perlu mengubah RPC lain.
--
-- Batasan yang perlu diketahui: kalau stok pernah diubah TANPA mutasi (mis. lewat
-- form Edit Produk, yang saat ini menimpa kolom stock langsung), saldo pada
-- mutasi SEBELUM perubahan itu akan bergeser sebesar perubahan tersebut.
-- Mutasi sesudahnya tetap benar.

create or replace view public.stock_ledger
with (security_invoker = true) as
select
  m.id,
  m.product_id,
  m.type,
  m.qty_delta,
  m.reference_id,
  m.reason,
  m.created_by,
  m.created_at,
  p.name as product_name,
  p.sku  as product_sku,
  p.unit as product_unit,
  case
    when m.product_id is null or p.id is null then null
    else (
      coalesce(p.stock, 0)
      - coalesce(
          sum(m.qty_delta) over (
            partition by m.product_id
            order by m.created_at desc, m.id desc
            rows between unbounded preceding and 1 preceding
          ),
          0
        )
    )::integer
  end as stock_after
from public.stock_movements m
left join public.products p on p.id = m.product_id;

comment on view public.stock_ledger is
  'Kartu stok: stock_movements + nama/SKU/satuan produk + stock_after (saldo sesudah mutasi, dihitung mundur dari products.stock). security_invoker = true, jadi RLS stock_movements & products tetap berlaku untuk pemanggil.';

revoke all on public.stock_ledger from anon;
grant select on public.stock_ledger to authenticated;

-- --------------------------------------------------------

create or replace function public.stock_movement_summary(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_product_id uuid default null,
  p_types text[] default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_masuk bigint;
  v_keluar bigint;
  v_jumlah bigint;
begin
  if not public.has_permission_action('stok', 'view') then
    raise exception 'Anda tidak punya izin melihat mutasi stok';
  end if;

  select
    coalesce(sum(qty_delta) filter (where qty_delta > 0), 0),
    coalesce(abs(sum(qty_delta) filter (where qty_delta < 0)), 0),
    count(*)
  into v_masuk, v_keluar, v_jumlah
  from public.stock_movements
  where (p_from is null or created_at >= p_from)
    and (p_to is null or created_at < p_to)
    and (p_product_id is null or product_id = p_product_id)
    and (p_types is null or cardinality(p_types) = 0 or type = any(p_types));

  return jsonb_build_object(
    'masuk', v_masuk,
    'keluar', v_keluar,
    'jumlah', v_jumlah
  );
end;
$$;

comment on function public.stock_movement_summary(timestamptz, timestamptz, uuid, text[]) is
  'Ringkasan mutasi stok sesuai filter: total masuk (qty_delta > 0), total keluar (qty_delta < 0, nilai mutlak), dan jumlah baris. p_to bersifat eksklusif. Butuh izin stok:view.';

revoke all on function public.stock_movement_summary(timestamptz, timestamptz, uuid, text[]) from public, anon;
grant execute on function public.stock_movement_summary(timestamptz, timestamptz, uuid, text[]) to authenticated;
