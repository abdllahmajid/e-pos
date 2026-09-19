-- Migration: T-10 revisi #2 — tutup celah RLS `profiles_update_admin_supervisor`
-- (migration 018) untuk kolom SELAIN role/is_active.
--
-- ── Penomoran (sesi #16) ──
-- File ini SEBELUMNYA bernomor `019_profiles_update_admin_lock.sql` — bentrok
-- dengan `019_hold_orders.sql` (T-11 bagian 1, migration TERPISAH & TIDAK
-- BERGANTUNG pada file ini sama sekali). Digeser jadi `020` di sini karena
-- `hooks/useHoldOrders.ts` sudah 3x menyebut "migration 019" verbatim di
-- komentarnya untuk merujuk ke `held_orders` — mengubah migration ITU berarti
-- ikut mengedit baris TypeScript, lebih berisiko daripada menggeser migration
-- ini yang tidak di-hardcode di kode manapun (dicek ulang sesi #16: tidak ada
-- referensi "019_profiles_update_admin_lock" atau nomor migration ini di file
-- `.ts`/`.tsx` manapun). Isi SQL di bawah PERSIS sama seperti versi `019`
-- sebelumnya, cuma satu baris `comment on policy` di akhir file yang diubah
-- (019 → 020) supaya self-reference-nya konsisten dengan nama file yang baru.
-- Sesi #14 sempat mencatat penggeseran ini sudah dilakukan, tapi file yang
-- sebenarnya sampai ke repo masih bernomor `019` (lihat PROGRESS.md sesi
-- #15/#16 untuk kronologi lengkap) — file `019_profiles_update_admin_lock.sql`
-- yang lama SUDAH DIHAPUS dari repo di sesi #16, digantikan file ini.
--
-- ── Temuan (ditemukan saat review UI T-10, PengaturanAdminTab.tsx, BUKAN
-- insiden nyata yang sudah terjadi — murni defensif) ──
-- Pengaman A/B migration 018 ("supervisor tidak bisa sentuh/promosikan akun
-- admin") HANYA ditegakkan lewat trigger `enforce_profiles_role_change`.
-- Trigger itu baris pertamanya:
--   if new.role = old.role and new.is_active = old.is_active then return new;
-- — artinya trigger SAMA SEKALI TIDAK JALAN kalau yang diubah cuma
-- `full_name`/`email`. Policy `profiles_update_admin_supervisor` (migration
-- 018, bagian 2) mengizinkan admin+supervisor UPDATE baris SIAPA PUN tanpa
-- pengecualian kolom apa yang diubah. Kombinasi keduanya: seorang supervisor
-- MASIH BISA `.update()` langsung `email` akun admin (lewat
-- `updateUserContact` di hooks/useAdminUsers.ts — jalur ini sengaja tidak
-- lewat RPC, lihat komentar header hook itu, karena migration 016 awalnya
-- cuma mengizinkan admin lewat RLS, belum ada konsep "admin-only sub-area"
-- saat itu ditulis).
--
-- Risikonya konkret: supervisor ganti email admin ke email yang dia kuasai
-- → klik "Kirim Reset Password" (`supabase.auth.resetPasswordForEmail`,
-- panggilan Auth API terpisah dari RLS `profiles` — ini normal, siapa pun
-- boleh memicu reset ke email manapun, itu memang cara kerja alur reset
-- password) → link reset terkirim ke email yang sudah diganti tadi →
-- supervisor bisa reset password akun admin & mengambil alih. Menutup
-- perubahan email di titik ini (RLS) memutus rantainya, TANPA perlu
-- menyentuh alur reset password itu sendiri (yang memang harus tetap
-- terbuka untuk siapa pun, itu bukan bagian yang bocor).
--
-- ── Perbaikan ──
-- `profiles_update_admin_supervisor` diganti: syarat baris TARGET (dicek di
-- USING, artinya dievaluasi dari nilai SEBELUM update) tidak boleh
-- `role = 'admin'` kalau pemanggilnya supervisor — berlaku untuk update
-- kolom APAPUN (role/is_active MAUPUN full_name/email), tidak bergantung
-- trigger lagi. WITH CHECK menambah syarat simetris untuk baris SESUDAH
-- update (redundan dengan trigger untuk kasus role, tapi tidak ada ruginya
-- — dobel proteksi, pola yang sama dipakai migration 018 bagian 4/5 untuk
-- RPC). Admin TETAP tanpa batasan tambahan apa pun (persis migration 018).
--
-- Tidak ada perubahan ke trigger `enforce_profiles_role_change` maupun RPC
-- `admin_update_user_role`/`admin_set_user_active` — keduanya sudah benar
-- untuk kasus role/is_active sejak migration 018, migration ini murni
-- menambal jalur `.update()` langsung untuk kolom lain.

drop policy if exists "profiles_update_admin_supervisor" on public.profiles;

create policy "profiles_update_admin_supervisor"
  on public.profiles for update
  using (
    -- Admin pemanggil: bebas menyentuh baris manapun (tidak berubah dari
    -- migration 018).
    exists (
      select 1 from public.profiles caller
      where caller.id = auth.uid()
        and caller.is_active = true
        and caller.role = 'admin'
    )
    or (
      -- Supervisor pemanggil: baris TARGET (nilai SEBELUM update — `role`
      -- di sini tanpa alias merujuk baris public.profiles yang sedang
      -- dicek, BUKAN baris `caller` di subquery) tidak boleh admin. Ini
      -- yang menutup celah full_name/email — dicek untuk update kolom
      -- apapun, tidak cuma role/is_active.
      role <> 'admin'
      and exists (
        select 1 from public.profiles caller
        where caller.id = auth.uid()
          and caller.is_active = true
          and caller.role = 'supervisor'
      )
    )
  )
  with check (
    exists (
      select 1 from public.profiles caller
      where caller.id = auth.uid()
        and caller.is_active = true
        and caller.role = 'admin'
    )
    or (
      -- Baris SESUDAH update juga tidak boleh admin kalau pemanggil
      -- supervisor — redundan dengan trigger `enforce_profiles_role_change`
      -- untuk kasus role berubah, tapi jadi satu-satunya penjaga kalau
      -- suatu saat ada jalur update lain yang lupa lewat trigger itu.
      role <> 'admin'
      and exists (
        select 1 from public.profiles caller
        where caller.id = auth.uid()
          and caller.is_active = true
          and caller.role = 'supervisor'
      )
    )
  );

comment on policy "profiles_update_admin_supervisor" on public.profiles is
  'Admin+supervisor boleh UPDATE profiles siapa pun (migration 018), TAPI supervisor tidak lolos sama sekali untuk baris yang role-nya admin (SEBELUM maupun SESUDAH update) — migration 020, menutup celah full_name/email yang tidak lewat trigger enforce_profiles_role_change.';
