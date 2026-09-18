-- Migration: aktifkan RLS di `transactions`, `transaction_items`, `payments`.
-- Menutup temuan keamanan yang dicatat di PROGRESS.md sesi #7 (saat menyiapkan
-- RPC T-07 `get_transaction_by_receipt`): ketiga tabel ini belum pernah
-- mengaktifkan RLS sama sekali sejak awal proyek (beda dengan `stock_movements`,
-- `shift_sessions`, `payment_proofs` yang sudah). Privilege default Supabase
-- memberi role `anon`/`authenticated` akses langsung ke tabel baru, jadi tanpa
-- migration ini SEMUA transaksi toko bisa dibaca lewat PostgREST
-- (`/rest/v1/transactions`, dst.) oleh siapa saja tanpa login sama sekali.
--
-- ── Keputusan desain ──
-- 1. **Select: semua user login (role apa saja) boleh lihat SEMUA transaksi**,
--    BUKAN dibatasi per-kasir. Ini SENGAJA, dikonfirmasi ke pemilik project,
--    supaya perilaku aplikasi untuk user yang sudah login TIDAK berubah:
--      - Dashboard (`hooks/useDashboard.ts`, T-06) menghitung "Omzet Hari Ini"
--        dari SELURUH transaksi toko dan memang didesain boleh dilihat semua
--        role (PRD §5 baris `dashboard`). Kalau select dibatasi ke `cashier_id
--        = auth.uid()`, angka omzet kasir akan salah (cuma hitung transaksi
--        miliknya sendiri) — itu perubahan aturan bisnis, bukan perbaikan bug.
--      - `app/components/transaksi/TransactionDetailModal.tsx` sudah
--        berkomentar eksplisit soal PRD §5: "kasir cuma boleh lihat & cetak
--        ulang. Retur & void hanya [admin/supervisor]" — jadi batasan §5 itu
--        PER-AKSI (lihat vs retur/void), bukan per-baris (punya sendiri vs
--        punya kasir lain).
--    Yang DITUTUP migration ini hanya jalur `anon` (belum login sama sekali) —
--    itulah satu-satunya celah nyata yang ditemukan.
-- 2. **Write (insert/update/delete): TIDAK ada policy sama sekali**, sengaja —
--    pola yang sama seperti `stock_movements` (migration 009). Semua penulisan
--    ke tiga tabel ini SUDAH lewat RPC `security definer`
--    (`create_transaction`, `return_transaction`, `void_transaction` — lihat
--    migration 004/006/009), yang otomatis bypass RLS. Kalau kita tambah
--    policy insert/update langsung ke `authenticated`, itu justru MEMBUKA jalur
--    baru untuk melewati validasi & permission-check yang sudah ada di dalam
--    RPC (mis. `void_transaction` mengecek role admin/supervisor sendiri di
--    dalam function body) — jadi TIDAK ditambahkan sama sekali.
-- 3. **`transaction_items` dan `payments` pakai policy select yang sama** (cek
--    profil aktif saja, tanpa join balik ke `transactions`) — karena keputusan
--    #1 di atas membuat semua transaksi memang boleh dibaca semua user login,
--    join balik ke transactions cuma menambah biaya query tanpa menambah
--    proteksi apapun.
-- 4. RPC publik `get_transaction_by_receipt` (migration 010, dipakai halaman
--    `/cek-struk`) TIDAK terpengaruh migration ini — dia `SECURITY DEFINER`
--    dan sudah didesain bypass RLS secara sengaja lewat jalur yang divalidasi
--    ketat (nomor struk + tanggal harus cocok). WAJIB tetap diuji ulang secara
--    manual setelah migration ini jalan (buka `/cek-struk` tanpa login), lihat
--    checklist di PROGRESS.md.

-- --------------------------------------------------------
-- 1. transactions
-- --------------------------------------------------------

alter table public.transactions enable row level security;

drop policy if exists "transactions_select_authenticated" on public.transactions;
create policy "transactions_select_authenticated"
  on public.transactions for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 2. transaction_items
-- --------------------------------------------------------

alter table public.transaction_items enable row level security;

drop policy if exists "transaction_items_select_authenticated" on public.transaction_items;
create policy "transaction_items_select_authenticated"
  on public.transaction_items for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 3. payments
-- --------------------------------------------------------

alter table public.payments enable row level security;

drop policy if exists "payments_select_authenticated" on public.payments;
create policy "payments_select_authenticated"
  on public.payments for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_active = true
    )
  );

comment on policy "transactions_select_authenticated" on public.transactions is
  'Semua user login (role apa saja, asal is_active) boleh lihat semua transaksi — '
  'sengaja tidak dibatasi per-kasir, lihat catatan desain di header migration 011. '
  'Anon/publik otomatis ditolak karena auth.uid() bernilai NULL untuk mereka.';
