"use client";

import { useMemo, useState } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Clock,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import PaymentModal from "./PaymentModal";
import { printThermalReceipt, printA6Nota } from "@/lib/pos/printLogic";
import { useProducts, ProductWithCategory } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { CartItem } from "@/lib/pos/types";
import {
  addToCart,
  removeFromCart,
  updateQty,
  clearCart,
  getCartSubtotal,
  getCartItemCount,
  getAvailableStock,
  isOutOfStock,
  formatRupiah,
} from "@/lib/pos/cartLogic";
import { createTransaction, PaymentMethod } from "@/lib/pos/transactionApi";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";

export default function KasirModule() {
  const { products, isLoading, error, refetch } = useProducts();
  const { categories } = useCategories();
  const { user } = useAuth();

  const { settings: posSettings } = useSettings();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        !selectedCategoryId || product.category_id === selectedCategoryId;
      const matchesSearch =
        !q ||
        product.name.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q) ||
        (product.barcode ?? "").toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [products, searchQuery, selectedCategoryId]);

  const handleAddToCart = (product: ProductWithCategory) => {
    setTransactionError(null);
    setCart((prev) => addToCart(prev, product));
  };
  const handleUpdateQty = (productId: string, delta: number) => {
    setTransactionError(null);
    setCart((prev) => updateQty(prev, productId, delta));
  };
  const handleRemoveFromCart = (productId: string) => {
    setTransactionError(null);
    setCart((prev) => removeFromCart(prev, productId));
  };

  const subtotal = useMemo(() => getCartSubtotal(cart), [cart]);
  const discount = 0;
  const tax = useMemo(() => {
    if (!posSettings.ppnEnabled) return 0;
    return Math.round((subtotal * posSettings.ppnRate) / 100);
  }, [posSettings.ppnEnabled, posSettings.ppnRate, subtotal]);
  const grandTotal = subtotal - discount + tax;

  const handleConfirmPayment = async (
    method: PaymentMethod,
    paidAmount: number,
    change: number,
    extra?: {
      customerName?: string;
      dueDate?: string;
      printFormat?: "thermal" | "nota";
    },
  ): Promise<{ paymentId: string }> => {
    if (cart.length === 0) throw new Error("Keranjang masih kosong.");
    setTransactionError(null);
    setIsSavingTransaction(true);

    try {
      const result = await createTransaction({
        items: cart,
        subtotal,
        discount,
        tax,
        total: grandTotal,
        paymentMethod: method,
        paymentAmount: paidAmount,
        receivedAmount: method === "CASH" ? paidAmount : undefined,
        customerName: extra?.customerName,
        dueDate: extra?.dueDate,
      });

      const receiptData = {
        receiptNo: result.receipt_no,
        cashierName: user?.full_name ?? user?.email ?? null,
        customerName: extra?.customerName,
        items: cart.map((item) => ({
          name: item.product.name,
          price: item.product.sell_price,
          qty: item.qty,
        })),
        subtotal,
        discount,
        tax,
        total: grandTotal,
        paidAmount,
        changeAmount: result.change_amount ?? change,
        method,
      };

      // ── TAMBAHAN (T-03) ── Pemanggilan print logic sesuai dengan pilihan dari PaymentModal
      if (extra?.printFormat === "nota") {
        printA6Nota(
          receiptData,
          (posSettings.paperNota as "A6" | "A5") ?? "A6",
        );
      } else {
        printThermalReceipt(receiptData);
      }

      setCart(clearCart());
      await refetch();
      return { paymentId: result.payment_id };
    } catch (err) {
      console.error("Transaction failed:", err);
      const message =
        err instanceof Error ? err.message : "Transaksi gagal disimpan.";
      setTransactionError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setIsSavingTransaction(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-xs">Memuat produk...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <AlertTriangle className="w-6 h-6 text-lco-coral" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Gagal memuat produk: {error}
          </p>
          <button
            onClick={refetch}
            className="px-4 py-2 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-xs font-semibold transition-colors duration-150"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="flex-1 flex flex-col h-full border-r border-zinc-200 dark:border-zinc-800">
        <div className="p-5 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex flex-col gap-4 z-10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
            <input
              type="text"
              placeholder="Cari nama, SKU, atau scan barcode..."
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setSelectedCategoryId(null)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap transition-colors duration-150 ${
                selectedCategoryId === null
                  ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              Semua
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap transition-colors duration-150 ${
                  selectedCategoryId === cat.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                {cat.color && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                )}
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-zinc-400 text-xs">
              Tidak ada produk yang cocok.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {filteredProducts.map((product) => {
                const inCartQty =
                  cart.find((item) => item.product.id === product.id)?.qty || 0;
                const outOfStock = isOutOfStock(product);
                const isMaxReached = inCartQty >= getAvailableStock(product);

                return (
                  <button
                    key={product.id}
                    onClick={() => handleAddToCart(product)}
                    disabled={outOfStock || isMaxReached}
                    className={`flex flex-col text-left bg-white dark:bg-zinc-950 p-4 rounded-xl border transition-colors duration-150 relative overflow-hidden group ${
                      outOfStock
                        ? "border-zinc-200 dark:border-zinc-800 opacity-50 cursor-not-allowed grayscale"
                        : isMaxReached
                          ? "border-lco-coral/50 cursor-not-allowed"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-lco-teal"
                    }`}
                  >
                    {inCartQty > 0 && (
                      <div className="absolute top-2 right-2 bg-lco-teal text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10 tabular-nums">
                        {inCartQty} di keranjang
                      </div>
                    )}
                    <div className="w-full aspect-square bg-zinc-50 dark:bg-zinc-900 rounded-md mb-3 flex items-center justify-center border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                      {product.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.photo_url}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-zinc-400 font-mono">
                          {product.sku}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight leading-tight mb-1">
                      {product.name}
                    </h3>
                    <div className="mt-auto pt-2 flex items-end justify-between w-full">
                      <span className="font-mono font-semibold text-lco-teal text-sm tabular-nums">
                        {formatRupiah(product.sell_price)}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-[0.12em] font-semibold font-mono tabular-nums ${outOfStock ? "text-lco-coral" : "text-zinc-500"}`}
                      >
                        {product.is_service ? "Jasa" : `Stok: ${product.stock}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="w-full md:w-[400px] flex flex-col bg-white dark:bg-zinc-950 h-full">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="font-semibold text-base tracking-tight flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
            <ShoppingCart className="w-5 h-5 text-lco-teal" />
            Keranjang
          </h2>
          <span className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 text-[11px] px-2.5 py-1 rounded-full font-mono tabular-nums border border-zinc-200 dark:border-zinc-800">
            {getCartItemCount(cart)} Item
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 bg-zinc-50/50 dark:bg-zinc-900/30">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 bg-zinc-50 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4 border border-zinc-200 dark:border-zinc-800">
                <ShoppingCart className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
              </div>
              <p className="text-zinc-500 text-xs">
                Belum ada produk di keranjang.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cart.map((item) => (
                <div
                  key={item.product.id}
                  className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex gap-3"
                >
                  <div className="flex-1">
                    <h4 className="text-sm font-medium line-clamp-1 text-zinc-900 dark:text-zinc-100">
                      {item.product.name}
                    </h4>
                    <p className="font-mono tabular-nums text-xs text-zinc-500 mt-0.5">
                      {formatRupiah(item.product.sell_price)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center bg-zinc-50 dark:bg-zinc-900 rounded-md p-0.5 border border-zinc-200 dark:border-zinc-800">
                        <button
                          onClick={() => handleUpdateQty(item.product.id, -1)}
                          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md transition-colors duration-150 text-zinc-500"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center font-mono text-xs tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                          {item.qty}
                        </span>
                        <button
                          onClick={() => handleUpdateQty(item.product.id, 1)}
                          disabled={item.qty >= getAvailableStock(item.product)}
                          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md transition-colors duration-150 text-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => handleRemoveFromCart(item.product.id)}
                        className="p-1.5 text-zinc-400 hover:text-lco-coral hover:bg-lco-coral/10 rounded-md transition-colors duration-150"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="font-mono text-sm font-semibold text-lco-teal mt-2 tabular-nums">
                      {formatRupiah(item.product.sell_price * item.qty)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {transactionError && (
          <div className="mx-5 mb-3 p-3 rounded-md border border-lco-coral/30 bg-lco-coral/5 text-lco-coral text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">Transaksi gagal</p>
                <p>{transactionError}</p>
              </div>
            </div>
          </div>
        )}

        <div className="p-5 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 z-10">
          <div className="space-y-1.5 mb-5 text-sm">
            <div className="flex justify-between text-zinc-500">
              <span className="text-xs">Subtotal</span>
              <span className="font-mono tabular-nums">
                {formatRupiah(subtotal)}
              </span>
            </div>
            {tax > 0 && (
              <div className="flex justify-between text-zinc-500">
                <span className="text-xs">
                  Pajak (PPN {posSettings.ppnRate}%)
                </span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(tax)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-lg pt-3 border-t border-zinc-200 dark:border-zinc-800 mt-3 text-zinc-900 dark:text-zinc-100">
              <span>Total</span>
              <span className="font-mono tabular-nums text-lco-teal">
                {formatRupiah(grandTotal)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <button
              disabled={cart.length === 0 || isSavingTransaction}
              className="col-span-1 flex items-center justify-center gap-2 py-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-lco-mustard/20 hover:text-lco-mustard transition-colors duration-150 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Clock className="w-4 h-4" />
              <span className="text-xs">Tunda</span>
            </button>
            <button
              disabled={cart.length === 0 || isSavingTransaction}
              onClick={() => {
                setTransactionError(null);
                setIsPaymentModalOpen(true);
              }}
              className="col-span-2 flex items-center justify-center gap-2 py-3 rounded-md bg-lco-green hover:bg-lco-green-hover text-white transition-colors duration-150 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSavingTransaction ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Menyimpan...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-5 h-5" />
                  <span className="text-sm">Bayar Sekarang</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          if (!isSavingTransaction) setIsPaymentModalOpen(false);
        }}
        subtotal={subtotal}
        tax={tax}
        total={grandTotal}
        defaultPrintFormat={
          (posSettings.printDefault as "thermal" | "nota") ?? "thermal"
        }
        onConfirmPayment={handleConfirmPayment}
      />
    </div>
  );
}
