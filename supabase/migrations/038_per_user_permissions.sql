-- 038_per_user_permissions.sql
-- ── PERUBAHAN KONSEP ── Hak akses dipindah dari ROLE DINAMIS (migration 028/031)
-- ke PER USER, sama dengan konsep di aplikasi Monitoring Konveksi:
--
--   • `profiles.permissions` (jsonb)  -> izin tiap user, per modul & aksi
--       { "produk": {"view":true,"create":true,"edit":false,"delete":false}, ... }
--   • `profiles.roles` (text[])       -> LABEL jabatan, boleh lebih dari satu.
--       Nilai tetap: super_admin | admin | supervisor | kasir | qc.
--       Hanya `super_admin` yang punya arti khusus (semua akses + satu-satunya
--       yang boleh mengurus akun Super Admin). Role lain murni label.
--   • Hierarki `level` DIHAPUS, diganti aturan Konveksi (migration 019 mereka):
--       Super Admin : bebas.
--       Lainnya     : tidak bisa mengubah role/izin/status AKUNNYA SENDIRI,
--                     tidak bisa MENAMBAH izin yang ia sendiri tidak punya
--                     (mengurangi boleh), tidak bisa memberi/menyentuh Super Admin.
--   • `lintas_kasir` (dulu kolom roles.lintas_kasir) -> izin kasir.lintas_kasir.
--
-- YANG TIDAK BERUBAH (sengaja): nama & signature `has_permission(text)` dan
-- `has_permission_action(text, text)`. Sekitar 139 policy RLS & RPC yang
-- sudah memanggil keduanya TIDAK disentuh — hanya sumber datanya yang pindah
-- dari role_permissions ke profiles.permissions. `current_role_id()` dan
-- `current_role_lintas_kasir()` juga dipertahankan namanya karena dipakai
-- policy lain (migration 032/033, dan 035/036 yang tidak ada di repo ini).
--
-- DATA LAMA: tidak ada user yang kehilangan atau mendapat akses baru.
--   - Izin tiap user = salinan persis izin role-nya saat ini (kecuali
--     `pengaturan_role`, fiturnya dihapus).
--   - Role sistem "Admin" (slug admin, punya semua permission) -> `super_admin`.
--   - Supervisor/Kasir/QC -> label yang sama. Role custom -> label terdekat
--     (level 0 -> admin, level 1 -> supervisor, lainnya -> kasir). Hak aksesnya
--     tetap mengikuti izin yang disalin, bukan labelnya.
--
-- TABEL LAMA (roles, role_permissions, permissions, profiles.role_id) SENGAJA
-- TIDAK DIHAPUS di migration ini supaya bisa dibandingkan/di-rollback. Policy
-- tulisnya dicabut sehingga tidak bisa diubah lagi dari aplikasi. Bagian
-- pembersihan ada di paling bawah (dikomentari) — jalankan setelah yakin.
--
-- Prasyarat: migration 028–037 (termasuk 035/036 milik fitur Pelanggan).
-- Dijalankan sebagai satu transaksi; kalau ada yang gagal, semuanya batal.

begin;

-- ── 1. Kolom baru di profiles ──────────────────────────────────────────────
alter table public.profiles
  add column if not exists roles       text[] not null default array['kasir']::text[],
  add column if not exists permissions jsonb  not null default '{"kasir":{"view":true}}'::jsonb;

comment on column public.profiles.roles is 'Label jabatan (boleh lebih dari satu): super_admin, admin, supervisor, kasir, qc. Hanya super_admin yang berarti khusus (semua akses). Migration 038, pengganti role_id/roles.';
comment on column public.profiles.permissions is 'Izin per modul & aksi milik user ini: {"produk":{"view":true,"create":false,...},...}. Tidak tertulis = ditolak. Migration 038, pengganti role_permissions.';

-- role_id tidak wajib lagi (user baru tidak punya role dinamis).
alter table public.profiles alter column role_id drop not null;

-- Email login kini ditampilkan di daftar user (tanpa email undangan/reset):
-- isi profiles.email yang masih kosong dari akun login (auth.users).
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is null
  and u.email is not null;

-- ── 2. Backfill izin: salin dari role_permissions tiap user ────────────────
with src as (
  select
    p.id as profile_id,
    coalesce(
      jsonb_object_agg(
        rp.permission_key,
        jsonb_build_object(
          'view',   rp.can_view,
          'create', rp.can_create,
          'edit',   rp.can_edit,
          'delete', rp.can_delete
        )
      ) filter (where rp.permission_key is not null and rp.permission_key <> 'pengaturan_role'),
      '{}'::jsonb
    ) as perms
  from public.profiles p
  left join public.role_permissions rp on rp.role_id = p.role_id
  where p.role_id is not null
  group by p.id
)
update public.profiles p
set permissions = src.perms
from src
where src.profile_id = p.id;

-- lintas_kasir (dulu flag di role) -> izin kasir.lintas_kasir
update public.profiles p
set permissions = jsonb_set(
      case
        when jsonb_typeof(p.permissions -> 'kasir') = 'object' then p.permissions
        else p.permissions || jsonb_build_object('kasir', jsonb_build_object('view', false))
      end,
      '{kasir,lintas_kasir}',
      'true'::jsonb,
      true
    )
from public.roles r
where r.id = p.role_id
  and r.lintas_kasir = true;

-- ── 3. Backfill label role ─────────────────────────────────────────────────
update public.profiles p
set roles = array[
  case
    when r.slug = 'admin'                    then 'super_admin'
    when r.slug in ('supervisor','kasir','qc') then r.slug
    when r.level = 0                         then 'admin'
    when r.level = 1                         then 'supervisor'
    else 'kasir'
  end
]::text[]
from public.roles r
where r.id = p.role_id;

-- Pengaman: jangan lanjut kalau ada profil yang belum punya role sama sekali
-- (artinya data lama tidak ke-mapping) atau tidak ada satu pun Super Admin.
do $$
begin
  if exists (select 1 from public.profiles where cardinality(roles) < 1) then
    raise exception 'Ada profil tanpa role setelah backfill — migration dihentikan, cek manual.';
  end if;
  if not exists (select 1 from public.profiles where 'super_admin' = any(roles)) then
    raise exception 'Tidak ada Super Admin setelah backfill (role sistem Admin tidak ditemukan?) — migration dihentikan, cek manual.';
  end if;
end $$;

alter table public.profiles
  drop constraint if exists profiles_roles_valid,
  drop constraint if exists profiles_roles_not_empty,
  drop constraint if exists profiles_permissions_object;

alter table public.profiles
  add constraint profiles_roles_valid
    check (roles <@ array['super_admin','admin','supervisor','kasir','qc']::text[]),
  add constraint profiles_roles_not_empty
    check (cardinality(roles) >= 1),
  add constraint profiles_permissions_object
    check (jsonb_typeof(permissions) = 'object');

-- ── 4. Fungsi pengecekan: sumber data pindah ke profiles ───────────────────
create or replace function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and 'super_admin' = any(p.roles)
  );
$$;

comment on function public.is_super_admin() is 'True kalau user login aktif dan punya role super_admin. Migration 038.';

create or replace function public.has_permission(p_key text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        'super_admin' = any(p.roles)
        or coalesce(p.permissions -> p_key ->> 'view', 'false') = 'true'
      )
  );
$$;

comment on function public.has_permission(text) is 'True kalau user login boleh Lihat modul tsb (profiles.permissions.<key>.view) atau Super Admin. Migration 038 (sebelumnya baca role_permissions); signature tidak berubah.';

create or replace function public.has_permission_action(p_key text, p_action text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p_action in ('view', 'create', 'edit', 'delete')   -- aksi asing = ditolak (fail-closed)
      and (
        'super_admin' = any(p.roles)
        or (
          coalesce(p.permissions -> p_key ->> 'view', 'false') = 'true'
          and coalesce(p.permissions -> p_key ->> p_action, 'false') = 'true'
        )
      )
  );
$$;

comment on function public.has_permission_action(text, text) is 'Cek aksi granular (view/create/edit/delete) milik user login, atau Super Admin. Selalu mensyaratkan view=true. Migration 038 (sebelumnya baca role_permissions); signature tidak berubah.';

-- Dipertahankan namanya karena dipakai policy lain sebagai "user aktif?".
create or replace function public.current_role_id()
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select p.id from public.profiles p
  where p.id = auth.uid() and p.is_active = true;
$$;

comment on function public.current_role_id() is 'NON-NULL (= id user) kalau user login aktif, NULL kalau tidak. Migration 038: role dinamis dihapus, nama dipertahankan karena dipakai policy lama sebagai cek "user aktif".';

create or replace function public.current_role_lintas_kasir()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select 'super_admin' = any(p.roles)
          or coalesce(p.permissions -> 'kasir' ->> 'lintas_kasir', 'false') = 'true'
      from public.profiles p
      where p.id = auth.uid() and p.is_active = true
    ),
    false
  );
$$;

comment on function public.current_role_lintas_kasir() is 'True kalau user login boleh lihat/kelola shift & held-order kasir lain (izin kasir.lintas_kasir atau Super Admin). Migration 038.';

-- Kompatibilitas: kalau masih ada policy lama (mis. dari migration 035/036)
-- yang memanggil current_role_level(), fungsinya tetap ada dengan arti serupa.
create or replace function public.current_role_level()
returns integer
language sql stable security definer
set search_path to 'public'
as $$
  select case
    when 'super_admin' = any(p.roles) then 0
    when 'admin'       = any(p.roles) then 1
    when 'supervisor'  = any(p.roles) then 2
    else 10
  end
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;
$$;

comment on function public.current_role_level() is 'DEPRECATED (migration 038): hierarki level dihapus. Hanya shim kompatibilitas — jangan dipakai di kode baru, pakai is_super_admin()/has_permission_action().';

-- ── 5. Aturan pemberian izin (cermin lib/pos/permissionRules.ts) ───────────
-- Izin pertama yang DITAMBAHKAN (false -> true) tapi tidak dimiliki pemberi.
-- Mengembalikan 'modul.aksi' atau NULL. p_old = izin target sebelumnya.
create or replace function public.perms_added_beyond(p_new jsonb, p_old jsonb, p_caller jsonb)
returns text
language sql immutable
as $$
  select m.key || '.' || a.key
  from jsonb_each(case when jsonb_typeof(p_new) = 'object' then p_new else '{}'::jsonb end) m,
       lateral jsonb_each_text(case when jsonb_typeof(m.value) = 'object' then m.value else '{}'::jsonb end) a
  where a.value = 'true'
    and coalesce(p_old    -> m.key ->> a.key, 'false') <> 'true'
    and coalesce(p_caller -> m.key ->> a.key, 'false') <> 'true'
  order by m.key, a.key
  limit 1;
$$;

comment on function public.perms_added_beyond(jsonb, jsonb, jsonb) is 'Izin pertama yang ditambahkan tetapi tidak dimiliki pemberi (modul.aksi), atau NULL. Migration 038, port dari Monitoring Konveksi migration 019.';

-- Trigger pengaman langsung di tabel profiles (defense in depth). Service role
-- (API server, SQL Editor) tidak terpengaruh karena auth.uid() kosong.
create or replace function public.enforce_profiles_role_change()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_caller_roles text[];
  v_caller_perms jsonb;
  v_caller_active boolean;
  v_caller_super boolean;
  v_old_super boolean;
  v_new_super boolean;
  v_over text;
begin
  -- Tidak ada perubahan pada kolom yang dijaga -> lewat.
  if new.roles is not distinct from old.roles
     and new.permissions is not distinct from old.permissions
     and new.is_active = old.is_active then
    return new;
  end if;

  -- service role / SQL editor (tanpa auth.uid) dibiarkan.
  if auth.uid() is null then
    return new;
  end if;

  select p.roles, p.permissions, p.is_active
    into v_caller_roles, v_caller_perms, v_caller_active
  from public.profiles p
  where p.id = auth.uid();

  v_caller_super := coalesce(v_caller_active, false) and 'super_admin' = any(coalesce(v_caller_roles, '{}'::text[]));
  v_old_super := 'super_admin' = any(old.roles);
  v_new_super := 'super_admin' = any(new.roles);

  -- Jangan sampai sistem tanpa Super Admin aktif.
  if v_old_super and old.is_active
     and (not v_new_super or not new.is_active)
     and not exists (
       select 1 from public.profiles o
       where o.id <> old.id and o.is_active = true and 'super_admin' = any(o.roles)
     ) then
    raise exception 'Tidak bisa menurunkan atau menonaktifkan Super Admin terakhir'
      using errcode = '42501';
  end if;

  -- Super Admin: bebas.
  if v_caller_super then
    return new;
  end if;

  if not public.has_permission_action('pengaturan_admin', 'edit') then
    raise exception 'Anda tidak punya izin mengubah role, hak akses, atau status user'
      using errcode = '42501';
  end if;

  if v_new_super and not v_old_super then
    raise exception 'Hanya Super Admin yang boleh memberi role Super Admin'
      using errcode = '42501';
  end if;

  if v_old_super then
    raise exception 'Hanya Super Admin yang boleh mengubah akun Super Admin'
      using errcode = '42501';
  end if;

  if new.id = auth.uid() then
    raise exception 'Tidak bisa mengubah role, hak akses, atau status akun Anda sendiri'
      using errcode = '42501';
  end if;

  if new.permissions is distinct from old.permissions then
    v_over := public.perms_added_beyond(new.permissions, old.permissions, v_caller_perms);
    if v_over is not null then
      raise exception 'Tidak bisa memberi izin yang tidak Anda miliki: %', v_over
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_profiles_role_change() is 'Migration 038: menegakkan aturan izin per user (Super Admin bebas; lainnya tidak boleh ubah akun sendiri, tidak boleh menambah izin yang tidak dimiliki, tidak boleh menyentuh Super Admin). Menggantikan hierarki level migration 028/031.';

-- Trigger profiles_enforce_role_change (migration 028) sudah menunjuk ke fungsi
-- ini; dibuat ulang eksplisit supaya pasti terpasang.
drop trigger if exists profiles_enforce_role_change on public.profiles;
create trigger profiles_enforce_role_change
  before update on public.profiles
  for each row execute function public.enforce_profiles_role_change();

-- ── 6. RLS yang tadinya memakai level role ────────────────────────────────
drop policy if exists profiles_update_pengaturan_admin on public.profiles;
create policy profiles_update_pengaturan_admin on public.profiles
  for update to authenticated
  using (public.has_permission_action('pengaturan_admin', 'edit'))
  with check (public.has_permission_action('pengaturan_admin', 'edit'));

comment on policy profiles_update_pengaturan_admin on public.profiles is 'Boleh UPDATE baris user lain kalau punya izin pengaturan_admin.edit. Batasan siapa boleh mengubah apa ditegakkan trigger enforce_profiles_role_change (migration 038), bukan lagi perbandingan level.';

drop policy if exists settings_delete_level_0_only on public.settings;
drop policy if exists settings_delete_super_admin_only on public.settings;
create policy settings_delete_super_admin_only on public.settings
  for delete using (public.is_super_admin());

-- ── 7. RPC admin: ubah role lama dihapus, aktif/nonaktif ditulis ulang ────
drop function if exists public.admin_update_user_role(uuid, uuid);

create or replace function public.admin_set_user_active(p_user_id uuid, p_is_active boolean)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_target record;
begin
  if not public.has_permission_action('pengaturan_admin', 'edit') then
    raise exception 'Anda tidak punya izin untuk mengubah status user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa menonaktifkan diri sendiri — minta user lain yang berwenang melakukannya';
  end if;

  select p.id, p.full_name, p.is_active, p.roles
    into v_target
  from public.profiles p
  where p.id = p_user_id
  for update of p;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  if 'super_admin' = any(v_target.roles) and not public.is_super_admin() then
    raise exception 'Hanya Super Admin yang boleh mengubah status akun Super Admin';
  end if;

  if v_target.is_active = p_is_active then
    raise exception 'User sudah dalam status tersebut';
  end if;

  -- Penjagaan "Super Admin terakhir" ditegakkan trigger enforce_profiles_role_change.
  update public.profiles set is_active = p_is_active where id = p_user_id;

  insert into public.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(),
    case when p_is_active then 'user_activate' else 'user_deactivate' end,
    'user', p_user_id,
    jsonb_build_object('target_name', v_target.full_name)
  );

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'is_active', p_is_active);
end;
$$;

comment on function public.admin_set_user_active(uuid, boolean) is 'Aktifkan/nonaktifkan user. Migration 038: gate pengaturan_admin.edit; hanya Super Admin yang boleh mengubah akun Super Admin; tidak bisa diri sendiri. Hierarki level dihapus.';

-- ── 8. Tabel role lama: tidak bisa ditulis lagi dari aplikasi ─────────────
drop policy if exists roles_write_pengaturan_role on public.roles;
drop policy if exists role_permissions_write_pengaturan_role on public.role_permissions;

comment on table public.roles is 'DEPRECATED (migration 038): hak akses kini per user (profiles.permissions). Tabel dipertahankan hanya untuk arsip/rollback; boleh dihapus lewat bagian pembersihan di migration 038.';
comment on table public.role_permissions is 'DEPRECATED (migration 038): lihat comment tabel roles.';

commit;

-- ═════════════════════════════════════════════════════════════════════════
-- PEMBERSIHAN (OPSIONAL) — jalankan MANUAL, terpisah, SETELAH aplikasi versi
-- baru berjalan normal beberapa hari dan semua user terverifikasi punya akses
-- yang benar. Tidak bisa di-rollback. Kalau ada policy lain (mis. dari
-- migration 035/036) yang masih memanggil role_level()/roles, perintah ini
-- akan gagal dengan pesan jelas — itu tanda aman untuk TIDAK lanjut.
-- ═════════════════════════════════════════════════════════════════════════
-- begin;
--   alter table public.profiles drop column role_id;
--   drop table public.role_permissions;
--   drop table public.roles cascade;
--   drop function if exists public.role_level(uuid);
--   drop function if exists public.protect_role_mutation();
--   drop table public.permissions;
-- commit;
