// lib/pos/types.ts
// ── TAMBAHAN ── Tipe domain Produk & Kategori, disamakan persis dengan skema SQL Supabase (PRD §6)

export type ProductType =
  | "FASHION"
  | "SABLON"
  | "KONVEKSI"
  | "PERCETAKAN"
  | "MERCHANDISE"
  | "PARFUM"
  | "JASA";

// Baris asli tabel `products` — nama kolom & tipe wajib sama persis dengan SQL
export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  type: ProductType;
  is_service: boolean;
  category_id: string | null;
  unit: string | null;
  sell_price: number; // BIGINT rupiah, tanpa desimal
  cost_price: number | null;
  stock: number;
  min_stock: number;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Baris asli tabel `categories`
export interface Category {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
}

// Item di dalam keranjang Kasir — Product + qty, dipisah dari tipe Product murni
// supaya lib/pos/cartLogic.ts tidak bergantung pada state React apa pun.
export interface CartItem {
  product: Product;
  qty: number;
}