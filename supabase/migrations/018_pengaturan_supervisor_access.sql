-- Migration: T-10 revisi — longgarkan modul Pengaturan ke admin+supervisor.
--
-- ── Latar belakang ──
-- Migration 005 (`settings`) dan 016 (kelola user `profiles`) awalnya
-- admin-only, sesuai PRD §5 baris `settings` = "Admin" saja. Pemilik project
-- MINTA LANGSUNG (bukan asumsi agent) supaya supervisor juga bisa mengakses
-- modul Pengaturan untuk keperluan pengujian, dengan alasan yang sama seperti
-- migration 015 (Sampah/Log Aktivitas): akun pemilik/penguji sehari-hari
-- kebetulan berrole `supervisor`. **Ini keputusan sadar pemilik project,
-- menyimpang dari PRD §5 asli** — dicatat di sini persis seperti pola
-- migration 015, supaya sesi berikutnya tidak bingung kenapa beda dari PRD.
--
-- ── Kenapa TIDAK melonggarkan 1:1 sepenuhnya (beda dari migration 015) ──
-- Migration 015 melonggarkan Sampah/Log Aktivitas ke supervisor karena
-- dampak terburuknya "cuma" restore/lihat data yang sudah ada. Modul
-- Pengaturan beda kelas risiko: isinya bisa MENGUBAH ROLE USER LAIN
-- (termasuk berpotensi mempromosikan seseorang jadi admin) dan MENGUBAH
-- PENGATURAN TOKO (PPN, dsb). Kalau dilonggarkan 1:1 tanpa batas, seorang
-- supervisor (atau akun yang berhasil diretas dengan role supervisor) bisa:
--   1. Mempromosikan akun mana pun (termasuk dirinya kalau bukan guard
--      self-target yang sudah ada) jadi admin — privilege escalation penuh.
--   2. Menonaktifkan SEMUA akun admin yang ada — mengunci pemilik asli dari
--      sistemnya sendiri.
-- Karena itu migration ini menambah 2 PENGAMAN yang TIDAK ada di migration
-- 015 (yang tidak perlu pengaman serupa untuk kasus Sampah/Log Aktivitas):
--   A. Supervisor TIDAK BISA mengubah role/status akun yang ROLE-NYA
--      SAAT INI 'admin' (baik lewat trigger maupun RPC).
--   B. Supervisor TIDAK BISA mengubah role SIAPA PUN menjadi 'admin'.
-- Kedua batas ini TIDAK berlaku untuk admin (admin tetap bebas penuh, sama
-- seperti sebelumnya) — cuma membatasi kalau PEMANGGILNYA supervisor.
--
-- ── Cakupan perubahan ──
-- 1. `settings` (migration 005): INSERT/UPDATE sekarang admin+supervisor
--    (DELETE TETAP admin-only — tidak pernah dipakai UI, sengaja tidak
--    disentuh, tidak ada alasan melonggarkannya).
-- 2. `profiles` UPDATE (migration 016 `profiles_update_admin_all`): diganti
--    `profiles_update_admin_supervisor` (admin+supervisor boleh UPDATE baris
--    siapa pun) — kolom apa yang boleh diubah tetap dijaga trigger di poin 3.
-- 3. Trigger `enforce_profiles_role_change` (migration 016): sekarang
--    menerima pemanggil admin ATAU supervisor, TAPI kalau pemanggilnya
--    supervisor (bukan admin), tambahan cek: OLD.role dan NEW.role
--    tidak boleh 'admin' (pengaman A & B di atas).
-- 4. RPC `admin_update_user_role`/`admin_set_user_active` (migration 016):
--    cek role pemanggil dilonggarkan ke admin+supervisor, ditambah pengaman
--    A & B yang sama seperti trigger (dobel proteksi — trigger tetap jadi
--    penjaga terakhir kalau ada jalur lain di masa depan yang lupa menambah
--    cek ini, RPC menambah pesan error yang lebih jelas untuk UI).
-- 5. Nama fungsi TIDAK diganti (`admin_update_user_role` dst. tetap dipakai
--    apa adanya walau sekarang bisa dipanggil supervisor juga) — mengganti
--    nama fungsi cuma menambah churn di hooks/useAdminUsers.ts tanpa manfaat.

-- --------------------------------------------------------
-- 1. settings — INSERT/UPDATE admin+supervisor
-- --------------------------------------------------------

drop policy if exists "settings_insert_admin_only" on public.settings;
create policy "settings_insert_admin_supervisor"
  on public.settings for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );

drop policy if exists "settings_update_admin_only" on public.settings;
create policy "settings_update_admin_supervisor"
  on public.settings for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );

-- settings_delete_admin_only (migration 005) SENGAJA TIDAK disentuh — tetap
-- admin-only, tidak pernah dipakai UI manapun.

-- --------------------------------------------------------
-- 2. profiles UPDATE — admin+supervisor boleh sentuh baris siapa pun
--    (kolom yang boleh diubah tetap dijaga trigger di bagian 3).
-- --------------------------------------------------------

drop policy if exists "profiles_update_admin_all" on public.profiles;
create policy "profiles_update_admin_supervisor"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'supervisor')
        and p.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'supervisor')
        and p.is_active = true
    )
  );

-- --------------------------------------------------------
-- 3. Trigger enforce_profiles_role_change — terima admin+supervisor,
--    TAMBAH pengaman A & B khusus kalau pemanggilnya supervisor.
-- --------------------------------------------------------

create or replace function public.enforce_profiles_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role public.user_role;
  v_caller_active boolean;
begin
  if new.role = old.role and new.is_active = old.is_active then
    return new;
  end if;

  select role, is_active into v_caller_role, v_caller_active
  from public.profiles
  where id = auth.uid();

  if v_caller_role is null
     or v_caller_role not in ('admin', 'supervisor')
     or v_caller_active is not true
  then
    raise exception 'Hanya admin atau supervisor aktif yang boleh mengubah role atau status aktif user';
  end if;

  -- Pengaman A & B (lihat komentar header migration ini): supervisor tidak
  -- boleh menyentuh akun yang SAAT INI admin, dan tidak boleh mempromosikan
  -- siapa pun jadi admin. Admin tidak kena batas ini sama sekali.
  if v_caller_role = 'supervisor' then
    if old.role = 'admin' then
      raise exception 'Supervisor tidak bisa mengubah role/status akun admin';
    end if;
    if new.role = 'admin' then
      raise exception 'Supervisor tidak bisa menjadikan user sebagai admin';
    end if;
  end if;

  return new;
end;
$function$;

comment on function public.enforce_profiles_role_change() is
  'Kunci perubahan kolom role/is_active di profiles kecuali pemanggil admin/supervisor aktif; supervisor tambahan dilarang menyentuh atau membuat akun admin. Lihat migration 016 (versi awal, admin-only) & 018 (revisi ini, pemilik project minta akses supervisor).';

-- --------------------------------------------------------
-- 4. RPC admin_update_user_role — admin+supervisor, pengaman A & B.
-- --------------------------------------------------------

create or replace function public.admin_update_user_role(
  p_user_id uuid,
  p_new_role public.user_role
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role public.user_role;
  v_target record;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if v_caller_role is null or v_caller_role not in ('admin', 'supervisor') then
    raise exception 'Anda tidak punya izin untuk mengubah role user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa mengubah role diri sendiri — minta admin/supervisor lain melakukannya';
  end if;

  select id, full_name, role into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  if v_caller_role = 'supervisor' then
    if v_target.role = 'admin' then
      raise exception 'Supervisor tidak bisa mengubah role akun admin';
    end if;
    if p_new_role = 'admin' then
      raise exception 'Supervisor tidak bisa menjadikan user sebagai admin';
    end if;
  end if;

  if v_target.role = p_new_role then
    raise exception 'User sudah memiliki role tersebut';
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_user_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'user_role_change', 'user', p_user_id,
    jsonb_build_object(
      'target_name', v_target.full_name,
      'old_role', v_target.role,
      'new_role', p_new_role,
      'changed_by_role', v_caller_role
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_role', v_target.role,
    'new_role', p_new_role
  );
end;
$function$;

comment on function public.admin_update_user_role(uuid, public.user_role) is
  'Ubah role user — admin+supervisor (migration 018, sebelumnya admin-only di migration 016). Tidak bisa untuk diri sendiri. Supervisor tidak bisa menyentuh/membuat akun admin. Tercatat activity_logs. PRD §17 T-10.';

-- --------------------------------------------------------
-- 5. RPC admin_set_user_active — admin+supervisor, pengaman A.
-- --------------------------------------------------------

create or replace function public.admin_set_user_active(
  p_user_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role public.user_role;
  v_target record;
begin
  select role into v_caller_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if v_caller_role is null or v_caller_role not in ('admin', 'supervisor') then
    raise exception 'Anda tidak punya izin untuk mengubah status user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa menonaktifkan diri sendiri — minta admin/supervisor lain melakukannya';
  end if;

  select id, full_name, role, is_active into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  if v_caller_role = 'supervisor' and v_target.role = 'admin' then
    raise exception 'Supervisor tidak bisa mengaktifkan/menonaktifkan akun admin';
  end if;

  if v_target.is_active = p_is_active then
    raise exception 'User sudah dalam status tersebut';
  end if;

  update public.profiles
  set is_active = p_is_active
  where id = p_user_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(),
    case when p_is_active then 'user_activate' else 'user_deactivate' end,
    'user', p_user_id,
    jsonb_build_object('target_name', v_target.full_name, 'changed_by_role', v_caller_role)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'is_active', p_is_active
  );
end;
$function$;

comment on function public.admin_set_user_active(uuid, boolean) is
  'Aktifkan/nonaktifkan user — admin+supervisor (migration 018, sebelumnya admin-only di migration 016). Tidak bisa untuk diri sendiri. Supervisor tidak bisa menyentuh akun admin. Tercatat activity_logs. PRD §17 T-10.';
