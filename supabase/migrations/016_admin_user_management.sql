-- Migration: T-10 (Pengaturan Admin — kelola user/role) — PRD §17 Fase F, §5, §11.
--
-- ── Keputusan desain ──
-- 1. **Cakupan sesi ini cuma tabel `profiles`** (lihat DoD T-10: "daftar user
--    dari profiles, ubah role, nonaktifkan"). "Reset password" SENGAJA belum
--    ditangani di sini — itu butuh Supabase Admin API (service role key), beda
--    jalur dari RLS/RPC biasa di project ini. Rencana: pakai
--    `supabase.auth.resetPasswordForEmail()` (kirim email link reset) di sisi
--    hook, TIDAK butuh service role key sama sekali — keputusan ini dicatat di
--    sini supaya sesi berikutnya yang mengerjakan hook tidak salah asumsi harus
--    bikin API route baru untuk service role.
--
-- 2. **CELAH KEAMANAN DITEMUKAN & DITUTUP sesi ini**: policy
--    `profiles_update_own` (migration 002) — `using (auth.uid() = id)` TANPA
--    `with check` eksplisit (Postgres otomatis memakai klausa `using` yang
--    sama sebagai `with check` kalau tidak ditulis terpisah) — secara teknis
--    mengizinkan user mana pun meng-UPDATE baris `profiles` miliknya sendiri
--    TANPA batasan kolom. Artinya seorang kasir bisa memanggil
--    `supabase.from('profiles').update({ role: 'admin' }).eq('id', auth.uid())`
--    langsung dari client dan lolos RLS (self-privilege-escalation) — policy
--    lama tidak pernah memvalidasi ISI perubahan, cuma ISI baris (`id`).
--    Belum ada indikasi ini pernah dieksploitasi, tapi wajib ditutup SEBELUM
--    UI kelola user (T-10) ditambahkan, supaya tidak menambah permukaan
--    serangan baru tanpa menutup yang lama lebih dulu.
--
-- 3. **Perbaikan: trigger `enforce_profiles_role_change`, BUKAN mengubah/
--    menghapus policy `profiles_update_own`.** Alasan pilih trigger dibanding
--    RLS murni: RLS `with check` di level row TIDAK bisa membandingkan
--    NEW.role terhadap peran SESSION saat ini dengan mudah dibaca (butuh
--    subquery berulang di tiap policy update ke depannya), sedangkan trigger
--    BEFORE UPDATE bisa membandingkan OLD vs NEW secara eksplisit dan berlaku
--    untuk SEMUA jalur UPDATE ke tabel ini (baik lewat policy lama
--    `profiles_update_own` MAUPUN policy baru `profiles_update_admin_all` di
--    bawah, MAUPUN RPC di bagian 4) — satu titik penegakan, bukan tersebar di
--    banyak policy yang gampang lupa disinkronkan kalau ada policy baru lagi
--    nanti. Kolom lain (`full_name`) TETAP bisa diubah user sendiri seperti
--    perilaku lama — trigger cuma mengunci `role` & `is_active`.
--
-- 4. **RPC `admin_update_user_role` / `admin_set_user_active`** — pola sama
--    persis dengan RPC Sampah (migration 014/015): cek role di awal fungsi,
--    `security definer`, tulis `activity_logs` sebelum return. RPC ini
--    TIDAK WAJIB dipakai UI (UPDATE langsung ke tabel oleh admin juga akan
--    lolos RLS + trigger di atas), tapi DISARANKAN dipakai supaya perubahan
--    role/status SELALU tercatat activity_logs secara konsisten (kalau admin
--    update langsung lewat `.update()` client tanpa lewat RPC ini, triggernya
--    akan meloloskan perubahan tapi TIDAK ada baris activity_logs — RPC inilah
--    yang menjamin logging, bukan trigger, sesuai DoD T-10 "semua perubahan
--    role tercatat di activity log").
--
-- 5. **Admin tidak bisa menonaktifkan/menurunkan role dirinya sendiri** lewat
--    RPC ini (guard `p_user_id = auth.uid()` ditolak) — mencegah admin
--    tunggal mengunci diri sendiri dari sistem secara tidak sengaja. Kalau
--    memang perlu, harus dilakukan admin LAIN atau langsung dari Supabase
--    Dashboard (jalur luar RLS, service role).

-- --------------------------------------------------------
-- 1. RLS: admin+supervisor boleh SELECT semua baris profiles
--    (policy_select_own dari migration 002 TETAP ada, tidak dihapus — RLS
--    multiple permissive policies digabung dengan OR, jadi user biasa tetap
--    bisa baca profilnya sendiri lewat policy lama itu selain lewat sini).
-- --------------------------------------------------------

drop policy if exists "profiles_select_admin_supervisor" on public.profiles;
create policy "profiles_select_admin_supervisor"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'supervisor')
        and p.is_active = true
    )
  );

-- --------------------------------------------------------
-- 2. RLS: admin boleh UPDATE baris siapa pun (dibutuhkan supaya admin bisa
--    mengubah role/status user LAIN — policy_update_own lama cuma mengizinkan
--    auth.uid() = id, tidak cukup untuk kelola user lain).
--    Kolom apa yang boleh diubah tetap ditegakkan trigger di bagian 3, bukan
--    di sini — policy ini murni soal BARIS mana yang boleh disentuh.
-- --------------------------------------------------------

drop policy if exists "profiles_update_admin_all" on public.profiles;
create policy "profiles_update_admin_all"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.is_active = true
    )
  );

-- --------------------------------------------------------
-- 3. Trigger: kunci kolom role & is_active kecuali pemanggil admin aktif.
--    Berlaku untuk SEMUA jalur UPDATE ke profiles (menutup celah #2 di atas).
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
  -- Tidak ada perubahan role/is_active sama sekali -> lolos, tidak perlu cek apa-apa
  -- (mis. user ganti full_name sendiri, perilaku lama tetap jalan).
  if new.role = old.role and new.is_active = old.is_active then
    return new;
  end if;

  select role, is_active into v_caller_role, v_caller_active
  from public.profiles
  where id = auth.uid();

  if v_caller_role is null or v_caller_role <> 'admin' or v_caller_active is not true then
    raise exception 'Hanya admin aktif yang boleh mengubah role atau status aktif user';
  end if;

  return new;
end;
$function$;

comment on function public.enforce_profiles_role_change() is
  'Kunci perubahan kolom role/is_active di tabel profiles kecuali pemanggil admin aktif — menutup celah self-privilege-escalation lewat policy profiles_update_own (migration 002). Lihat migration 016 untuk detail.';

drop trigger if exists profiles_enforce_role_change on public.profiles;
create trigger profiles_enforce_role_change
  before update on public.profiles
  for each row
  execute function public.enforce_profiles_role_change();

-- --------------------------------------------------------
-- 4. RPC: admin_update_user_role — admin only, tercatat activity_logs.
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

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'Anda tidak punya izin untuk mengubah role user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa mengubah role diri sendiri — minta admin lain melakukannya';
  end if;

  select id, full_name, role into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User tidak ditemukan';
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
      'new_role', p_new_role
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
  'Ubah role user (admin only). Tidak bisa dipakai untuk mengubah role diri sendiri. Tercatat di activity_logs. PRD §17 T-10.';

-- --------------------------------------------------------
-- 5. RPC: admin_set_user_active — admin only, tercatat activity_logs.
--    "Nonaktifkan" (bukan hapus) — konsisten dengan kolom is_active yang
--    sudah dipakai di seluruh app sebagai gate login (lihat useAuth.ts /
--    middleware.ts), bukan menghapus baris profiles.
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

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'Anda tidak punya izin untuk mengubah status user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa menonaktifkan diri sendiri — minta admin lain melakukannya';
  end if;

  select id, full_name, is_active into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User tidak ditemukan';
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
    jsonb_build_object('target_name', v_target.full_name)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'is_active', p_is_active
  );
end;
$function$;

comment on function public.admin_set_user_active(uuid, boolean) is
  'Aktifkan/nonaktifkan user (admin only). Tidak bisa dipakai untuk menonaktifkan diri sendiri. Tercatat di activity_logs. PRD §17 T-10.';
