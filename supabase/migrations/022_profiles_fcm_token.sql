-- Migration: T-12 (FCM push notification) — tambah kolom `fcm_token` di
-- profiles. PRD §17 Fase G: "FCM (`firebase` dep + token di profiles +
-- `/api/send-notification`)".
--
-- ── Kenapa dibutuhkan ──
-- Firebase Cloud Messaging butuh "registration token" per device/browser
-- untuk tahu ke mana notifikasi push dikirim. Token ini didapat di sisi
-- client (browser, lewat `getToken()` dari Firebase SDK setelah user kasih
-- izin notifikasi) dan harus disimpan di server supaya `/api/send-notification`
-- (dibuat sesi/langkah berikutnya) bisa membaca token itu lalu memanggil FCM
-- Admin SDK untuk mengirim push ke device yang benar.
--
-- ── Keputusan desain ──
-- 1. **Kolom nullable, di `profiles`, BUKAN tabel baru** — pola sama dengan
--    kolom `email` (migration `017`): satu user = satu baris kontak/metadata
--    tambahan, tidak butuh riwayat/relasi 1-ke-banyak. Konsekuensi yang
--    SADAR diambil: **satu user cuma bisa punya SATU token aktif** (device
--    yang paling terakhir login/kasih izin notifikasi). Kalau nanti user
--    login dari 2 device sekaligus (mis. HP + laptop kasir) dan keduanya
--    perlu menerima notifikasi bersamaan, tabel ini PERLU dipecah jadi
--    `push_tokens` (1-ke-banyak, pola sama seperti `payment_proofs` migration
--    `006`) — **sengaja belum dilakukan sekarang** karena PRD §17 T-12 belum
--    merinci kebutuhan multi-device, dan toko sekecil ini kemungkinan besar
--    1 kasir = 1 device aktif per shift. Dicatat di sini supaya sesi
--    berikutnya tidak kaget kalau ada laporan "notifikasi cuma masuk ke
--    salah satu device".
-- 2. **Token ditulis LANGSUNG oleh client lewat `profiles_update_own`
--    (migration `002`), TIDAK lewat RPC baru.** Alasan: menyimpan token FCM
--    milik sendiri bukan "logika uang" (§18 Aturan Main poin 5 PRD — yang
--    wajib RPC itu stok/nomor struk/kembalian/permission), murni metadata
--    device yang risikonya rendah kalau salah/telat sinkron. Trigger
--    `enforce_profiles_role_change` (migration `016`) HANYA mengunci kolom
--    `role`/`is_active`, jadi UPDATE kolom ini oleh pemilik baris sendiri
--    tidak akan diblokir trigger itu — sudah dicek langsung ke isi trigger,
--    bukan diasumsikan.
-- 3. **Tidak ada RLS baru** — kolom ini ikut policy SELECT/UPDATE yang sudah
--    ada di `profiles` (`profiles_select_own`/`profiles_update_own` dari
--    migration `002`, ditambah policy admin/supervisor dari migration
--    `016`/`018`/`020` untuk keperluan lain). Server (`/api/send-notification`,
--    langkah berikutnya) WAJIB membaca token lewat service role key
--    (bypass RLS), bukan lewat client biasa, supaya bisa mengirim notifikasi
--    ke user lain (mis. admin dapat notifikasi transaksi kasir) — detail itu
--    menyusul di file API route-nya, bukan bagian migration ini.
-- 4. **Kolom `fcm_token_updated_at` ikut ditambahkan** (bukan cuma
--    `fcm_token`) — supaya `/api/cron/daily-summary` (T-12 bagian lain) atau
--    proses bersih-bersih di masa depan bisa membedakan token yang baru
--    vs. yang sudah lama tidak diperbarui (mis. user uninstall PWA / hapus
--    izin notifikasi browser tanpa pernah eksplisit menghapus tokennya dari
--    server). Tidak ada logika pembersihan otomatis dibuat sesi ini — cuma
--    kolomnya disiapkan, sengaja idle sampai benar-benar dibutuhkan.
-- 5. **Bukan unique/not null** — sama seperti kolom `email` (migration
--    `017`), sengaja longgar. Dua user beda TIDAK divalidasi supaya tidak
--    pegang token yang sama persis (kasus ini harusnya tidak mungkin terjadi
--    dari sisi Firebase, tapi database tidak menjamin itu — bukan blocker
--    fase ini).

alter table public.profiles
  add column if not exists fcm_token text,
  add column if not exists fcm_token_updated_at timestamptz;

comment on column public.profiles.fcm_token is
  'Firebase Cloud Messaging registration token milik device/browser terakhir user ini memberi izin notifikasi. Satu user = satu token aktif (lihat catatan desain migration 022 kalau butuh multi-device). Ditulis langsung oleh client lewat policy profiles_update_own (migration 002), dibaca server lewat service role key di /api/send-notification. Bisa NULL kalau user belum pernah memberi izin notifikasi / sudah mencabut izinnya.';

comment on column public.profiles.fcm_token_updated_at is
  'Kapan fcm_token terakhir ditulis/diperbarui. Disiapkan untuk kebutuhan pembersihan token basi di masa depan (belum ada logika otomatisnya per migration 022) — isi manual lewat client bersamaan tiap kali fcm_token ditulis.';
