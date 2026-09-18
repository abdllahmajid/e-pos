-- Migration: penanda lunas untuk piutang TEMPO (PRD §17 Fase E T-08, §4.7).
--
-- ── Kenapa migration ini perlu ──
-- Sampai migration 011, tabel `payments` sama sekali tidak punya cara menandai
-- pembayaran TEMPO sudah dilunasi atau belum (dicatat eksplisit sebagai utang
-- teknis di PROGRESS.md sesi T-06 & T-02: "SEMUA pembayaran TEMPO dianggap
-- belum lunas"). Laporan Piutang/Tempo (T-08) butuh status Lunas/Belum/Jatuh
-- Tempo per PRD §4.7 — tanpa kolom ini, hook Laporan tidak punya data untuk
-- dibaca sama sekali.
--
-- ── Keputusan desain ──
-- 1. Kolom ditaruh di `payments`, BUKAN tabel baru — piutang tidak lain adalah
--    satu baris `payments` dengan `method = 'TEMPO'`; satu transaksi TEMPO
--    hanya punya satu baris payment (lihat RPC `create_transaction`, migration
--    006), jadi tidak perlu tabel terpisah untuk merepresentasikan "utang".
-- 2. `is_settled boolean not null default false` + `settled_at`/`settled_by`
--    nullable — pola yang sama seperti `shift_sessions` (kolom hasil hanya
--    terisi saat aksi terjadi). Transaksi lama (CASH/TRANSFER/QRIS) otomatis
--    `is_settled = false`, tapi itu tidak masalah — UI Laporan HARUS memfilter
--    dulu `method = 'TEMPO'` sebelum menampilkan status Lunas/Belum, kolom ini
--    tidak bermakna untuk metode lain.
-- 3. **Siapa boleh menandai lunas: SEMUA user aktif (role apa saja), TIDAK
--    dibatasi admin/supervisor.** Ini beda dari pola Retur/Void (migration 004:
--    khusus admin/supervisor). Alasannya: menandai lunas itu MENCATAT bahwa
--    uang sudah diterima (kasir manapun yang menerima pelunasan dari pelanggan
--    berhak mencatatnya), bukan aksi yang membatalkan/mengubah transaksi asli
--    seperti retur/void. ⚠️ **PRD tidak eksplisit menyebut role untuk aksi ini
--    di bagian yang sudah dibaca sejauh ini** — kalau ternyata PRD §4.7/§5 minta
--    dibatasi ke role tertentu, ganti pengecekan role di RPC
--    `settle_receivable` di bawah (polanya sama seperti `void_transaction`,
--    tinggal tambah `if v_role not in (...) then raise exception`), tidak perlu
--    ubah skema tabel.
-- 4. **Bukti pelunasan REUSE tabel `payment_proofs`** (migration 006) alih-alih
--    bikin tabel baru — sudah multi-file, sudah ada RLS & Storage bucket yang
--    jalan. Ditambah kolom `proof_type` supaya bukti pelunasan (mis. foto
--    transfer belakangan) tidak tercampur secara ambigu dengan bukti pembayaran
--    awal saat checkout (relevan terutama untuk QRIS/TRANSFER yang juga punya
--    bukti dari awal, walau kasus utama tetap TEMPO). Default `'payment'` supaya
--    baris lama (sebelum kolom ini ada) otomatis diberi makna yang benar tanpa
--    perlu backfill manual.
-- 5. Penulisan status lunas WAJIB lewat RPC `settle_receivable`
--    (`SECURITY DEFINER`), BUKAN lewat `update` langsung dari client — konsisten
--    dengan Aturan Main #5 PRD (status yang berarti uang, ditulis server-side).
--    `payments` sendiri (migration 011) memang sudah tidak punya policy
--    update/insert langsung sama sekali, jadi tanpa RPC ini piutang tidak bisa
--    ditandai lunas dari client sama sekali.
-- 6. RPC memvalidasi: baris payment harus `method = 'TEMPO'` (tidak masuk akal
--    melunasi CASH) dan belum `is_settled` (tidak bisa dilunasi dua kali) —
--    idempoten secara eksplisit lewat exception, bukan silent no-op, supaya UI
--    bisa kasih pesan jelas kalau user klik dobel.

-- --------------------------------------------------------
-- 1. Kolom baru di payments
-- --------------------------------------------------------

alter table public.payments
  add column if not exists is_settled boolean not null default false,
  add column if not exists settled_at timestamptz,
  add column if not exists settled_by uuid references public.profiles(id) on delete set null;

comment on column public.payments.is_settled is
  'Piutang TEMPO sudah dilunasi atau belum. Hanya bermakna untuk method = TEMPO — '
  'method lain selalu false secara default dan tidak boleh dipakai untuk logika apapun.';
comment on column public.payments.settled_at is
  'Waktu piutang ditandai lunas, diisi RPC settle_receivable. NULL selama is_settled = false.';
comment on column public.payments.settled_by is
  'Profil yang menandai lunas (bisa beda dari kasir yang membuat transaksi asli).';

-- Index untuk query Laporan Piutang: filter TEMPO + belum lunas + urut jatuh tempo.
create index if not exists payments_tempo_unsettled_idx
  on public.payments (due_date)
  where method = 'TEMPO' and is_settled = false;

-- --------------------------------------------------------
-- 2. payment_proofs: bedakan bukti pembayaran awal vs bukti pelunasan
-- --------------------------------------------------------

alter table public.payment_proofs
  add column if not exists proof_type text not null default 'payment'
    check (proof_type in ('payment', 'settlement'));

comment on column public.payment_proofs.proof_type is
  '''payment'' = bukti saat checkout (transfer/QRIS awal). ''settlement'' = bukti '
  'pelunasan piutang TEMPO yang diupload belakangan lewat Laporan Piutang.';

-- --------------------------------------------------------
-- 3. RPC settle_receivable — satu-satunya jalur menandai piutang lunas
-- --------------------------------------------------------

create or replace function public.settle_receivable(
  p_payment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_active boolean;
begin
  select true into v_active
  from public.profiles
  where id = auth.uid() and is_active = true;

  if v_active is distinct from true then
    raise exception 'Anda tidak punya izin untuk mencatat pelunasan';
  end if;

  select id, method, is_settled
  into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Data pembayaran tidak ditemukan';
  end if;

  if v_payment.method <> 'TEMPO' then
    raise exception 'Hanya pembayaran TEMPO yang bisa ditandai lunas';
  end if;

  if v_payment.is_settled then
    raise exception 'Piutang ini sudah ditandai lunas sebelumnya';
  end if;

  update public.payments
  set is_settled = true,
      settled_at = now(),
      settled_by = auth.uid()
  where id = p_payment_id;

  return jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'settled_at', now()
  );
end;
$function$;

comment on function public.settle_receivable(uuid) is
  'Satu-satunya jalur menandai piutang TEMPO lunas (PRD §17 T-08, §4.7). '
  'SECURITY DEFINER karena payments tidak punya policy update langsung (migration 011). '
  'Role: SEMUA user aktif boleh — lihat catatan keputusan #3 di header migration ini, '
  'ubah di sini kalau PRD ternyata membatasi ke role tertentu.';

revoke all on function public.settle_receivable(uuid) from public;
grant execute on function public.settle_receivable(uuid) to authenticated;
