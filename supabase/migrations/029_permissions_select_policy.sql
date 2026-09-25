-- 029_permissions_select_policy.sql
-- ── PERBAIKAN BUG (migration 028_dynamic_roles.sql) ── Tabel `permissions`
-- di-enable RLS di migration 028 tapi TIDAK diberi policy SELECT sama sekali
-- (cuma insert/update/delete yang sengaja ditutup total — lihat komentar
-- header migration 028 bagian tabel `permissions`). Efeknya "default deny"
-- itu ikut menutup SELECT juga, bukan cuma tulis: query ke `permissions`
-- dari client selalu balik 0 baris untuk SIAPA PUN (termasuk user dengan
-- permission 'pengaturan_role'), padahal katalog 10 menu ini WAJIB kebaca
-- buat render checklist di tab "Role" (hooks/useRoles.ts, menyusul).
--
-- Fix: tambah SATU policy SELECT (pola sama persis dengan
-- roles_select_active_users / role_permissions_select_active_users di
-- migration 028 — semua user aktif boleh baca). Insert/update/delete
-- SENGAJA tetap tidak diberi policy apa pun (tetap default deny total) —
-- katalog permission tetap cuma berubah lewat migration baru, bukan dari UI,
-- sesuai keputusan desain awal yang tidak berubah.

begin;

create policy permissions_select_active_users on public.permissions
  for select to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_active = true));

commit;
