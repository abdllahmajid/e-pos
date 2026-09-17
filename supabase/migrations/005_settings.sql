-- Migration: tabel `settings` (key-value) — PRD §17 T-01.
-- Tujuan utama fase ini: PPN "siap-aktif" — begitu admin mengubah `ppn_enabled`
-- lewat baris ini, baris pajak langsung muncul/hilang di PaymentModal & struk
-- (lihat hooks/useSettings.ts + perubahan di KasirModule.tsx/PaymentModal.tsx).
--
-- Keputusan desain:
-- 1. Key-value dengan `value jsonb` (bukan banyak kolom nullable) — sesuai PRD §6
--    ("settings — key-value: ..."), dan supaya 1 tabel bisa menampung boolean/
--    number/string tanpa migration baru tiap ada setting baru.
-- 2. RLS: SELECT boleh oleh semua user aktif (kasir butuh baca ppn_enabled/ppn_rate
--    saat transaksi jalan) — bukan cuma admin, beda dari pola `profiles` di 002.
--    INSERT/UPDATE/DELETE hanya admin, sesuai §5 (permission `settings` = admin only).
-- 3. Belum ada halaman Pengaturan UI (itu T-10 — "Jangan dulu" di §17) — migration
--    ini cukup tabel + seed + RLS, dikonsumsi dulu lewat hook.

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.settings is
  'Pengaturan toko & struk, key-value (PRD §17 T-01). value disimpan sebagai jsonb supaya boolean/number/string bisa ditampung tanpa kolom nullable terpisah per setting.';

alter table public.settings enable row level security;

-- --------------------------------------------------------
-- RLS: baca — semua user aktif (semua role: admin/supervisor/kasir/qc)
-- --------------------------------------------------------

drop policy if exists "settings_select_active_users" on public.settings;
create policy "settings_select_active_users"
  on public.settings for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- RLS: tulis — hanya admin (PRD §5: permission `settings` = full, admin only)
-- --------------------------------------------------------

drop policy if exists "settings_insert_admin_only" on public.settings;
create policy "settings_insert_admin_only"
  on public.settings for insert
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.is_active = true
    )
  );

drop policy if exists "settings_update_admin_only" on public.settings;
create policy "settings_update_admin_only"
  on public.settings for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.is_active = true
    )
  );

drop policy if exists "settings_delete_admin_only" on public.settings;
create policy "settings_delete_admin_only"
  on public.settings for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- Seed default — persis daftar key di PRD §17 T-01.
-- on conflict do nothing supaya migration ini aman dijalankan ulang (idempotent)
-- dan tidak menimpa perubahan admin kalau migration di-rerun.
-- --------------------------------------------------------

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