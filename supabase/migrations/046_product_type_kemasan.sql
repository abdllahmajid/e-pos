-- Migration 046: Jenis produk baru KEMASAN (kantong plastik, paper bag, packaging, dst.)
--
-- Jenis ini untuk barang pendukung penjualan yang berstok. Beda dengan JASA
-- (tanpa stok, mis. layanan fotocopy), produk KEMASAN stoknya dihitung dan
-- berkurang saat dijual/dihadiahkan. Di aplikasi, produk KEMASAN otomatis
-- tampil di modal Biaya Tambahan Kasir (lihat migration 045) dan bisa dipilih
-- di menu Hadiah & Oleh-oleh.
--
-- Jalankan sebagai SATU statement tersendiri di SQL Editor Supabase (nilai enum
-- baru baru bisa dipakai setelah statement ini selesai). Aman dijalankan ulang.

alter type public.product_type add value if not exists 'KEMASAN';
