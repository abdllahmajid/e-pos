-- Migration: tambah kolom yang ada di PRD §6 tapi belum ada di tabel `transactions` asli.
-- Aman dijalankan kapan saja: semua kolom nullable, TANPA foreign key dulu.
-- FK ke cashier_id (-> profiles/users) dan shift_id (-> shift_sessions) menyusul
-- setelah tabel-tabel itu dibuat (belum ada saat migration ini ditulis, 17 Sep 2026).

alter table public.transactions
  add column if not exists cashier_id uuid,
  add column if not exists shift_id uuid,
  add column if not exists customer_phone text,
  add column if not exists void_reason text;

comment on column public.transactions.cashier_id is
  'Diisi setelah sistem Auth + role (profiles) dibangun. NULL untuk transaksi lama & sebelum Auth aktif.';
comment on column public.transactions.shift_id is
  'Diisi setelah fitur Kas & Shift dibangun. NULL untuk transaksi lama & sebelum shift aktif.';
comment on column public.transactions.void_reason is
  'Alasan void, diisi saat transaksi di-void. Pertimbangkan juga catat di activity_logs untuk audit trail.';
