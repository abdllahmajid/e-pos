// lib/pos/cartLogic.ts
// ── TAMBAHAN ── Logika bisnis murni untuk Keranjang Kasir (PRD §7: logika di /lib, bukan di komponen).
// Semua fungsi di sini tidak menyentuh React state — menerima cart lama, mengembalikan cart baru.

import { CartItem, Product } from "./types";

/**
 * Stok efektif suatu produk untuk validasi keranjang.
 * Produk tipe JASA (is_service = true) qty-nya tidak terbatas oleh stok (PRD §4.3).
 */
export function getAvailableStock(product: Product): number {
  if (product.is_service) return Infinity;
  return product.stock;
}

export function isOutOfStock(product: Product): boolean {
  if (product.is_service) return false;
  return product.stock <= 0;
}

/**
 * Tambah 1 produk ke keranjang. Jika sudah ada, qty +1 (dibatasi stok tersedia).
 * Jika produk nonaktif atau stok tidak cukup, cart dikembalikan apa adanya (no-op).
 */
export function addToCart(cart: CartItem[], product: Product): CartItem[] {
  if (!product.is_active) return cart;

  const existing = cart.find((item) => item.product.id === product.id);
  const available = getAvailableStock(product);

  if (existing) {
    if (existing.qty >= available) return cart;
    return cart.map((item) =>
      item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item,
    );
  }

  if (available <= 0) return cart;
  return [...cart, { product, qty: 1 }];
}

/**
 * Ubah qty item di keranjang sebesar `delta` (bisa negatif).
 * Qty tidak pernah turun di bawah 1 (pakai removeFromCart untuk menghapus) atau melebihi stok tersedia.
 */
export function updateQty(
  cart: CartItem[],
  productId: string,
  delta: number,
): CartItem[] {
  return cart.map((item) => {
    if (item.product.id !== productId) return item;

    const available = getAvailableStock(item.product);
    const newQty = item.qty + delta;

    if (newQty < 1 || newQty > available) return item;
    return { ...item, qty: newQty };
  });
}

export function removeFromCart(cart: CartItem[], productId: string): CartItem[] {
  return cart.filter((item) => item.product.id !== productId);
}

export function clearCart(): CartItem[] {
  return [];
}

/** Subtotal = jumlah (harga jual eceran × qty) semua item, sebelum diskon/pajak. */
export function getCartSubtotal(cart: CartItem[]): number {
  return cart.reduce(
    (sum, item) => sum + item.product.sell_price * item.qty,
    0,
  );
}

/** Total jumlah unit di keranjang (untuk badge "X Item"). */
export function getCartItemCount(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

/** Format angka menjadi Rupiah, dipakai di semua tempat yang menampilkan uang. */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}