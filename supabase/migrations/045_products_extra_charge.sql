-- Migration 045: Penanda "Biaya Tambahan" pada produk (terpisah dari tipe Jasa)
--
-- Latar belakang: menu Biaya Tambahan di Kasir sebelumnya HANYA menampilkan
-- produk bertipe Jasa (is_service = true), dan produk Jasa selalu tanpa stok.
-- Padahal kantong plastik, paper bag, dan packaging itu barang fisik yang
-- stoknya perlu terkurang saat dipakai/dijual. Tipe Jasa tetap dipakai untuk
-- layanan (mis. kasir unit fotocopy) yang memang tidak punya stok.
--
-- Solusi: kolom boolean `is_extra_charge`. Produk dengan penanda ini tampil di
-- modal Biaya Tambahan Kasir TANPA harus bertipe Jasa, sehingga stoknya tetap
-- tercatat & berkurang lewat create_transaction seperti produk biasa.
-- Produk bertipe Jasa tetap otomatis tampil di Biaya Tambahan (perilaku lama
-- tidak berubah), jadi tidak ada backfill.
--
-- Tidak mengubah RPC apa pun. Aman dijalankan ulang.

alter table public.products
  add column if not exists is_extra_charge boolean not null default false;

comment on column public.products.is_extra_charge is
  'true = tampil di modal Biaya Tambahan Kasir (kantong, paper bag, packaging, dst.) walau bukan produk Jasa, stok tetap dihitung. Produk Jasa selalu tampil di sana tanpa perlu penanda ini.';
