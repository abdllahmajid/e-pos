-- Migration 043: Filter mutasi stok per user (perbaikan menu Stok & Opname)
--
-- Isi:
--   1. Indeks stock_movements(created_by) — filter "Oleh" tetap cepat.
--   2. stock_movement_summary diberi parameter p_user_id (opsional). Fungsi lama
--      (4 argumen) dihapus lalu dibuat ulang dengan 5 argumen: dua fungsi dengan
--      nama sama tapi argumen berbeda bisa membuat PostgREST bingung memilih.
--      Pemanggil lama yang tidak mengirim p_user_id tetap jalan (default NULL).
--   3. RPC stock_movement_actors — daftar user yang pernah membuat mutasi stok
--      (untuk pilihan filter "Oleh"). security definer supaya nama user terbaca
--      walau role pemanggil tidak boleh membaca tabel profiles langsung; dijaga
--      izin stok:view di dalam fungsi.
--
-- Tidak mengubah tabel/view lain. Aman dijalankan ulang.

create index if not exists stock_movements_created_by_idx
  on public.stock_movements (created_by);

drop function if exists public.stock_movement_summary(timestamptz, timestamptz, uuid, text[]);

create or replace function public.stock_movement_summary(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_product_id uuid default null,
  p_types text[] default null,
  p_user_id uuid default null
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
    and (p_user_id is null or created_by = p_user_id)
    and (p_types is null or cardinality(p_types) = 0 or type = any(p_types));

  return jsonb_build_object(
    'masuk', v_masuk,
    'keluar', v_keluar,
    'jumlah', v_jumlah
  );
end;
$$;

comment on function public.stock_movement_summary(timestamptz, timestamptz, uuid, text[], uuid) is
  'Ringkasan mutasi stok sesuai filter: total masuk (qty_delta > 0), total keluar (qty_delta < 0, nilai mutlak), dan jumlah baris. p_to eksklusif. p_user_id opsional = hanya mutasi buatan user itu. Butuh izin stok:view.';

revoke all on function public.stock_movement_summary(timestamptz, timestamptz, uuid, text[], uuid) from public, anon;
grant execute on function public.stock_movement_summary(timestamptz, timestamptz, uuid, text[], uuid) to authenticated;

-- --------------------------------------------------------

create or replace function public.stock_movement_actors()
returns table (user_id uuid, full_name text, movement_count bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.has_permission_action('stok', 'view') then
    raise exception 'Anda tidak punya izin melihat mutasi stok';
  end if;

  return query
    select p.id, p.full_name, count(*)::bigint
    from public.stock_movements m
    join public.profiles p on p.id = m.created_by
    group by p.id, p.full_name
    order by p.full_name nulls last, p.id;
end;
$$;

comment on function public.stock_movement_actors() is
  'User yang pernah membuat mutasi stok beserta jumlah mutasinya — untuk pilihan filter Oleh di Riwayat Mutasi. Butuh izin stok:view.';

revoke all on function public.stock_movement_actors() from public, anon;
grant execute on function public.stock_movement_actors() to authenticated;
