-- Migration: Hold order / "Tunda" transaksi di layar Kasir (PRD §17 T-11, bagian 1 dari 3).
--
-- Keputusan desain:
-- 1. `items` menyimpan HANYA `[{product_id, qty}]`, BUKAN snapshot harga/nama produk
--    (beda dari `transaction_items` yang sengaja snapshot harga demi riwayat transaksi
--    yang sudah SELESAI dibayar — lihat komentar migration 001/003). Held order BELUM
--    jadi transaksi sah, masih murni "keranjang yang ditunda", jadi saat dilanjutkan
--    (resume) harga & stok yang dipakai HARUS yang terbaru, bukan yang basi saat
--    ditunda tadi — konsisten dengan cara KasirModule.tsx selalu baca harga dari
--    `useProducts()` langsung, bukan dari cache lokal.
-- 2. `subtotal` & `item_count` DIDUPLIKASI di kolom terpisah (walau bisa dihitung ulang
--    dari `items`) supaya daftar held order bisa ditampilkan di modal TANPA perlu
--    join/hitung ulang ke tabel `products` dulu (list-nya sengaja ringan, baru pas
--    "Lanjutkan" diklik baru divalidasi ke `products` real, lihat useHoldOrders.ts).
-- 3. Tidak ada kolom `status` — held order cuma py2 keadaan: ADA (menunggu) atau SUDAH
--    DIHAPUS (row-nya dihapus langsung, baik karena "Lanjutkan" atau "Hapus" manual).
--    Beda dari shift_sessions yang butuh riwayat OPEN/CLOSED permanen (bukti kas),
--    held order bukan dokumen audit — begitu selesai perannya, tidak perlu disimpan.
-- 4. RLS: pola SAMA PERSIS dengan shift_sessions (migration 007) — kasir kelola
--    miliknya sendiri, admin/supervisor bisa lihat & hapus semua (mis. bersihkan held
--    order kasir yang sudah resign / lupa dihapus, tanpa perlu psql manual).

create table if not exists public.held_orders (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles(id) on delete cascade,
  label text,
  items jsonb not null,
  item_count integer not null default 0,
  subtotal bigint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.held_orders is
  'Keranjang yang ditunda kasir (tombol "Tunda" di KasirModule.tsx, PRD §17 T-11). Bukan transaksi sah — row dihapus begitu dilanjutkan atau dibatalkan manual.';
comment on column public.held_orders.items is
  'Array [{product_id, qty}] SAJA, tanpa harga/nama — harga & stok divalidasi ulang ke tabel products saat resume (lihat useHoldOrders.ts resumeHeldOrder()).';
comment on column public.held_orders.label is
  'Catatan bebas dari kasir saat menunda, mis. nama pelanggan ("Budi - baju kuning") — opsional, membantu kasir lain kenali held order mana yang mana.';

create index if not exists held_orders_cashier_id_idx
  on public.held_orders (cashier_id);

create index if not exists held_orders_created_at_idx
  on public.held_orders (created_at desc);

alter table public.held_orders enable row level security;

-- --------------------------------------------------------
-- RLS — select: kasir lihat held order sendiri, admin/supervisor lihat semua
-- --------------------------------------------------------

drop policy if exists "held_orders_select_own_or_supervisor" on public.held_orders;
create policy "held_orders_select_own_or_supervisor"
  on public.held_orders for select
  using (
    cashier_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- RLS — insert: kasir hanya boleh tunda atas namanya sendiri
-- --------------------------------------------------------

drop policy if exists "held_orders_insert_own" on public.held_orders;
create policy "held_orders_insert_own"
  on public.held_orders for insert
  with check (
    cashier_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- RLS — delete: kasir hapus held order sendiri (baik "Lanjutkan" maupun "Hapus"
-- manual di UI sama-sama lewat delete ini); admin/supervisor boleh hapus semua.
-- Tidak ada policy UPDATE sengaja — held order tidak pernah diedit di tempat,
-- kalau kasir mau ubah isi keranjang yang ditunda, cara paling sederhana adalah
-- lanjutkan dulu (resume), edit di keranjang aktif, tunda lagi kalau perlu.
-- --------------------------------------------------------

drop policy if exists "held_orders_delete_own_or_supervisor" on public.held_orders;
create policy "held_orders_delete_own_or_supervisor"
  on public.held_orders for delete
  using (
    cashier_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );
