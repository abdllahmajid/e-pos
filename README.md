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
git clone https://github.com/storelangitanco/e-pos.git
cd lco-pos
npm install
```

> **Punya lebih dari satu akun GitHub?** Kalau di editor code Anda
> menggunakan `gh auth switch` untuk berpindah akun, lihat
> [Menggunakan beberapa akun GitHub](#menggunakan-beberapa-akun-github-gh-auth-switch)
> di bawah sebelum clone/push ke repo ini.

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

## Menggunakan beberapa akun GitHub (gh auth switch)

Kalau Anda mengelola beberapa akun GitHub di komputer yang sama (misalnya
akun pribadi dan akun kerja/organisasi) dan mengandalkan `gh auth switch`
di editor code untuk berpindah akun, berikut alurnya khusus untuk repo
ini.

### Prasyarat

- Install [GitHub CLI](https://cli.github.com) (`gh`).
- Login sekali untuk tiap akun yang dipakai:

  ```bash
  gh auth login
  ```

  `gh` akan menyimpan kredensial masing-masing akun, jadi cukup dilakukan
  sekali per akun.

### Cek akun yang sedang aktif

```bash
gh auth status
```

### Berpindah akun

```bash
gh auth switch
```

Kalau ada lebih dari dua akun tersimpan, tentukan akun tujuannya secara
eksplisit:

```bash
gh auth switch --hostname github.com --user <username>
```

### Pastikan git ikut memakai akun yang baru dipilih

`gh` mengatur kredensial git lewat credential helper miliknya sendiri.
Token akun lama kadang masih ter-cache oleh git/editor, jadi setelah
`gh auth switch`, jalankan:

```bash
gh auth setup-git
```

supaya `git clone`, `git pull`, dan `git push` ke repo ini konsisten
menggunakan akun yang aktif saat itu.

### Catatan khusus repo ini

- Pastikan akun yang aktif punya akses (minimal read untuk clone, write
  kalau perlu push) ke repo `lco-pos` sebelum menjalankan Langkah 1
  (`git clone`) atau melakukan `git push`.
- Kalau editor (VS Code, dsb.) punya integrasi Git/GitHub sendiri,
  reload window / restart integrasi tersebut setelah `gh auth switch`
  supaya editor membaca ulang kredensial yang aktif — kalau tidak,
  editor bisa saja masih memakai token akun sebelumnya.
- `gh auth switch` hanya mengganti kredensial CLI/git secara lokal; ini
  tidak berkaitan dengan environment variable Supabase/Firebase di
  `.env.local` (Langkah 4), yang tetap sama untuk semua akun GitHub.

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
