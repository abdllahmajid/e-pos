# LCO POS — Aplikasi Kasir

Aplikasi kasir (POS) berbasis Next.js + Supabase untuk Langitan.co. Lihat
`PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` untuk spesifikasi lengkap fitur, dan
`PROGRESS.md` untuk status pengembangan terkini.

## Tech stack

- **Next.js** (App Router) + TypeScript
- **Supabase** — Postgres, Auth, Storage, RLS
- **Firebase Cloud Messaging** — notifikasi push (opsional)

## Quick start

### 1. Clone & install

```bash
git clone https://github.com/storelangitanco/lco-pos.git
cd lco-pos
npm install
```

### 2. Buat project Supabase & setup struktur database

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor** di project baru → tempel seluruh isi
   [`supabase/schema.sql`](./supabase/schema.sql) → **Run**.

   File ini membuat semua tabel, enum, RLS policy, function/RPC, dan
   Storage bucket yang dibutuhkan aplikasi — **satu kali jalan**. File ini
   diambil langsung (`pg_dump --schema-only`) dari database production
   yang berjalan, jadi dijamin sinkron dengan struktur asli — bukan
   disusun ulang dari catatan.

   > `supabase/migrations/*.sql` berisi **riwayat** perubahan struktur
   > dari waktu ke waktu (untuk referensi/audit), **bukan** langkah setup
   > untuk instalasi baru. Untuk instalasi baru, cukup `supabase/schema.sql`.

### 3. Buat akun pertama (admin)

Aplikasi ini tidak punya halaman signup publik — akun pertama dibuat
manual lewat dashboard, akun berikutnya diundang dari dalam aplikasi oleh
admin/supervisor (menu Pengaturan Admin).

1. Dashboard Supabase → **Authentication → Users → Add user** → isi email
   & password.
2. Salin **User UID** yang baru dibuat, lalu di **SQL Editor**:
   ```sql
   insert into public.profiles (id, full_name, role)
   values ('TEMPEL-USER-UID-DI-SINI', 'Nama Anda', 'admin');
   ```

### 4. Environment variables

Buat `.env.local` di root project:

```bash
# Wajib — Project Settings > API di dashboard Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Wajib hanya untuk fitur "Tambah User" dari dalam aplikasi (Pengaturan
# Admin). Project Settings > API > service_role.
# JANGAN pernah di-expose ke client/browser.
SUPABASE_SERVICE_ROLE_KEY=

# Opsional — notifikasi push (PWA). Aplikasi tetap jalan normal tanpa ini,
# hanya fitur notifikasi yang tidak aktif. Isi dari Firebase Console kalau
# dibutuhkan.
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

### 5. Jalankan

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000), login pakai akun dari
Langkah 3.

## Backup / migrasi struktur database

Kalau suatu saat perlu memindahkan struktur database ke project Supabase
lain (ganti akun, disaster recovery, dsb.), lihat
[`MIGRASI-DATABASE.md`](./MIGRASI-DATABASE.md) — mengambil struktur
langsung dari database yang berjalan (`pg_dump --schema-only`), bukan
menyusun ulang dari file migration (ada riwayat drift yang tidak selalu
tercatat, dijelaskan di file itu).

## Struktur folder yang relevan

```
app/                  # halaman & komponen (App Router)
lib/pos/              # logika bisnis POS (produk, transaksi, cetak struk, dll.)
lib/supabase/         # client Supabase
hooks/                # data-fetching hooks per fitur
supabase/schema.sql   # setup database sekali-jalan (instalasi baru)
supabase/migrations/  # riwayat perubahan struktur (referensi, bukan setup)
```

## Dokumen project

- `PRD-LCO-POS-Aplikasi-Kasir-v1.1.md` — spesifikasi produk
- `PROGRESS.md` — status pengembangan per sesi, task selesai/belum, catatan
  serah terima antar-agent
- `AGENTS.md` / `CLAUDE.md` — panduan kerja untuk AI agent yang membantu
  pengembangan
