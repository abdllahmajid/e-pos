// app/components/kasir/KasirModulePC.tsx
// ── TAMBAHAN (Kasir mode PC) ── Layout alternatif untuk layar Kasir, dipilih
// lewat tombol "Layout" di KasirTopBar (state `layoutMode` ada di
// KasirModule.tsx — file ini "dumb", TIDAK punya state transaksi sendiri).
//
// Beda paradigma dari mode Tablet (grid produk, klik-klik touch-friendly):
// di sini kasir mengetik/scan KODE produk, item LANGSUNG masuk ke tabel
// keranjang penuh-lebar, dan baris yang disorot ditampilkan di panel "Nama
// Barang Terpilih" + "Parameter Barang Aktif" di atas tabel. Navigasi ↑↓
// pindah baris yang disorot.
//
// ── PERBAIKAN (layout disamakan dengan screenshot rujukan) ──
// 1. Tiap bagian punya KARTU sendiri (info sesi, kode/parameter, keranjang,
//    bagian bawah) dengan jarak antar kartu — bukan satu blok besar.
// 2. Baris info (Waktu/Kasir | Pelanggan | Total Tagihan) pakai 3 kolom
//    proporsional dengan tinggi & padding yang sama, dipisah garis tipis.
// 3. Tabel keranjang: kolom NAMA BARANG melebar (sisa lebar), kolom lain
//    ukuran tetap & rapat di kanan (table-fixed + colgroup).
// 4. Bagian bawah: kotak Diskon/Promo, kotak Subtotal/Grand Total, dan
//    tombol TAHAN & BAYAR yang tingginya penuh (bukan tombol kecil).
//
// Semua LOGIKA (cart mutation, lookup produk, hitung total, dst.) tetap di
// KasirModule.tsx — file ini murni presentasi + urusan fokus/navigasi
// keyboard lokal, dikirim lewat props.

"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Search,
  User,
  Trash2,
  Pencil,
  Pause,
  Check,
  Loader2,
  Plus,
  Minus,
  RotateCcw,
  Clock,
  Lock,
  Link2,
} from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import type { CartItem } from "@/lib/pos/types";
import type { Customer } from "@/hooks/useCustomers";
import type { ProductWithCategory } from "@/hooks/useProducts";

interface KasirModulePCProps {
  cashierName: string;

  cart: CartItem[];
  /** Katalog produk aktif — dipakai untuk daftar saran saat kasir mengetik. */
  products: ProductWithCategory[];
  /** Tambah produk (dari daftar saran / kode persis) dengan jumlah tertentu. */
  onAddProduct: (product: ProductWithCategory, qty: number) => void;
  subtotal: number;
  tax: number;
  discount: number;
  grandTotal: number;
  onUpdateQty: (productId: string, delta: number) => void;
  onRemoveFromCart: (productId: string) => void;
  onClearCart: () => void;

  /** product.id dari baris keranjang yang sedang disorot (navigasi ↑↓). */
  selectedProductId: string | null;
  onSelectProductId: (productId: string | null) => void;

  onSubmitCode: (raw: string) => void;
  codeError: string | null;
  onClearCodeError: () => void;
  /** Increment dari KasirModule.tsx tiap F1/Cmd+K ditekan → input ini fokus. */
  focusCodeToken: number;
  focusCustomerToken: number;
  focusDiscountToken: number;

  customerQuery: string;
  onCustomerQueryChange: (value: string) => void;
  isCustomerDropdownOpen: boolean;
  onCustomerDropdownOpenChange: (open: boolean) => void;
  matchingCustomers: Customer[];
  onSelectCustomer: (customer: Customer) => void;
  selectedCustomer: Customer | null;
  onClearCustomer: () => void;
  usePoints: boolean;
  onToggleUsePoints: (value: boolean) => void;
  pointsBeingUsed: number;
  /** Nilai Rupiah 1 poin (konstanta LOYALTY_POINT_VALUE di KasirModule.tsx). */
  loyaltyPointValue: number;

  manualDiscountInput: string;
  onManualDiscountInputChange: (value: string) => void;

  onOpenBiayaTambahan: () => void;
  onHold: () => void;
  onPay: () => void;
  isSavingTransaction: boolean;
}

// Kelas kartu yang dipakai SEMUA bagian — satu tempat supaya konsisten.
const CARD =
  "rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
// Kotak isian/tampilan bertinggi sama (baris kode, nama barang, parameter).
const FIELD_BOX =
  "h-9 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";
const SECTION_LABEL =
  "text-[11px] font-semibold text-lco-green dark:text-lco-teal";

// ── TAMBAHAN (saran produk saat mengetik) ──────────────────────────────────
// Kolom kode menerima "qty*teks" (mis. "3*polo") atau teks biasa. Bagian
// teks dipakai untuk mencari produk lewat nama, SKU, atau barcode.
function parseCodeInput(raw: string): { qty: number; term: string } {
  const trimmed = raw.trim();
  const star = trimmed.indexOf("*");
  if (star > -1) {
    const qtyPart = trimmed.slice(0, star).trim();
    const q = Number(qtyPart);
    if (qtyPart && Number.isFinite(q) && q > 0) {
      return {
        qty: Math.max(1, Math.floor(q)),
        term: trimmed.slice(star + 1).trim(),
      };
    }
  }
  return { qty: 1, term: trimmed };
}

const MAX_SUGGESTIONS = 12;

// Pencarian per-kata: "polo hitam" cocok dengan produk yang namanya/SKU/
// barcode-nya memuat SEMUA kata itu (urutan bebas). Hasil diurutkan: kode
// persis > diawali teks > kata pertama nama diawali teks > sisanya (A-Z).
function searchProducts(
  products: ProductWithCategory[],
  term: string,
): ProductWithCategory[] {
  const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const full = tokens.join(" ");

  const scored: { product: ProductWithCategory; score: number }[] = [];
  for (const product of products) {
    const name = product.name.toLowerCase();
    const sku = product.sku.toLowerCase();
    const barcode = (product.barcode ?? "").toLowerCase();
    const haystack = `${name} ${sku} ${barcode}`;
    if (!tokens.every((t) => haystack.includes(t))) continue;

    let score = 3;
    if (sku === full || (barcode && barcode === full)) score = 0;
    else if (
      name.startsWith(full) ||
      sku.startsWith(full) ||
      (barcode && barcode.startsWith(full))
    )
      score = 1;
    else if (name.split(/\s+/).some((w) => w.startsWith(tokens[0]))) score = 2;

    scored.push({ product, score });
  }

  scored.sort(
    (a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name),
  );
  return scored.slice(0, MAX_SUGGESTIONS).map((x) => x.product);
}

// Jam berjalan dipisah jadi komponen kecil supaya re-render tiap detik tidak
// ikut merender ulang seluruh tabel keranjang.
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const date = now
    ? new Intl.DateTimeFormat("id-ID", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(now)
    : "--/--/----";
  const time = now
    ? new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now)
    : "--.--.--";

  return (
    <span className="font-mono text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
      {date} · {time}
    </span>
  );
}

export default function KasirModulePC({
  cashierName,
  cart,
  products,
  onAddProduct,
  subtotal,
  tax,
  discount,
  grandTotal,
  onUpdateQty,
  onRemoveFromCart,
  onClearCart,
  selectedProductId,
  onSelectProductId,
  onSubmitCode,
  codeError,
  onClearCodeError,
  focusCodeToken,
  focusCustomerToken,
  focusDiscountToken,
  customerQuery,
  onCustomerQueryChange,
  isCustomerDropdownOpen,
  onCustomerDropdownOpenChange,
  matchingCustomers,
  onSelectCustomer,
  selectedCustomer,
  onClearCustomer,
  usePoints,
  onToggleUsePoints,
  pointsBeingUsed,
  loyaltyPointValue,
  manualDiscountInput,
  onManualDiscountInputChange,
  onOpenBiayaTambahan,
  onHold,
  onPay,
  isSavingTransaction,
}: KasirModulePCProps) {
  const [codeInput, setCodeInput] = useState("");
  const codeInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);

  // Daftar saran produk (kolom kode) & daftar pelanggan: baris yang sedang
  // disorot digerakkan dengan ↑↓, Enter memilih, Esc menutup.
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [customerIdx, setCustomerIdx] = useState(0);
  const suggestListRef = useRef<HTMLDivElement>(null);
  const customerListRef = useRef<HTMLDivElement>(null);

  const parsedCode = useMemo(() => parseCodeInput(codeInput), [codeInput]);
  const suggestions = useMemo(
    () => searchProducts(products, parsedCode.term),
    [products, parsedCode.term],
  );
  const showSuggest = isSuggestOpen && parsedCode.term.length > 0;
  const showCustomerList =
    isCustomerDropdownOpen && customerQuery.trim().length > 0;

  const selectedItem =
    cart.find((item) => item.product.id === selectedProductId) ?? null;
  const selectedIndex = selectedItem
    ? cart.findIndex((item) => item.product.id === selectedProductId)
    : -1;

  useEffect(() => {
    if (focusCodeToken > 0) codeInputRef.current?.focus();
  }, [focusCodeToken]);
  useEffect(() => {
    if (focusCustomerToken > 0) customerInputRef.current?.focus();
  }, [focusCustomerToken]);
  useEffect(() => {
    if (focusDiscountToken > 0) discountInputRef.current?.focus();
  }, [focusDiscountToken]);

  useEffect(() => {
    setCustomerIdx(0);
  }, [customerQuery]);
  useEffect(() => {
    suggestListRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [suggestIdx, showSuggest]);
  useEffect(() => {
    customerListRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [customerIdx, showCustomerList]);

  // Kalau baris yang disorot hilang (mis. dihapus) tapi keranjang masih
  // berisi, otomatis sorot baris terakhir supaya panel "Nama Barang Terpilih"
  // tidak kosong padahal keranjang ada isinya.
  useEffect(() => {
    if (cart.length === 0) return;
    if (!cart.some((item) => item.product.id === selectedProductId)) {
      onSelectProductId(cart[cart.length - 1].product.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const points = selectedCustomer?.loyalty_points ?? 0;

  const commitProduct = (product: ProductWithCategory) => {
    onAddProduct(product, parsedCode.qty);
    setCodeInput("");
    setIsSuggestOpen(false);
    setSuggestIdx(0);
  };

  const pickCustomer = (customer: Customer) => {
    onSelectCustomer(customer);
    // Input pelanggan hilang begitu pelanggan terpilih → kembalikan fokus ke
    // kolom kode supaya kasir bisa langsung lanjut scan/ketik barang.
    setTimeout(() => codeInputRef.current?.focus(), 0);
  };

  const handleCodeKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Langkah 1: daftar saran terbuka → ↑↓ menggerakkan sorotan di daftar itu.
    if (showSuggest && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsSuggestOpen(false);
      return;
    }

    // Langkah 2: Enter — kode/barcode persis cocok menang dulu (penting untuk scanner
    //    fisik yang mengetik cepat lalu Enter) → baru produk yang disorot di
    //    daftar saran → terakhir pesan "tidak ditemukan".
    if (e.key === "Enter") {
      e.preventDefault();
      const term = parsedCode.term;
      if (!term) return;
      const lower = term.toLowerCase();
      const exact = products.find(
        (p) =>
          p.sku.toLowerCase() === lower ||
          (p.barcode ?? "").toLowerCase() === lower,
      );
      if (exact) {
        commitProduct(exact);
      } else if (showSuggest && suggestions.length > 0) {
        commitProduct(
          suggestions[Math.min(suggestIdx, suggestions.length - 1)],
        );
      } else {
        onSubmitCode(codeInput);
        setCodeInput("");
        setIsSuggestOpen(false);
      }
      return;
    }

    // Langkah 3: tidak ada daftar saran → ↑↓ pindah baris yang disorot di keranjang.
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (selectedIndex > 0) {
        onSelectProductId(cart[selectedIndex - 1].product.id);
      } else if (cart.length > 0 && selectedIndex === -1) {
        onSelectProductId(cart[cart.length - 1].product.id);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedIndex > -1 && selectedIndex < cart.length - 1) {
        onSelectProductId(cart[selectedIndex + 1].product.id);
      }
    }
  };

  const handleCustomerKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const open = showCustomerList && matchingCustomers.length > 0;
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setCustomerIdx((i) => (i + 1) % matchingCustomers.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setCustomerIdx(
        (i) => (i - 1 + matchingCustomers.length) % matchingCustomers.length,
      );
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      pickCustomer(
        matchingCustomers[Math.min(customerIdx, matchingCustomers.length - 1)],
      );
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCustomerDropdownOpenChange(false);
      codeInputRef.current?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* ═══ KARTU 1 · Waktu/Kasir | Pelanggan | Total Tagihan ═══ */}
      <section className={CARD}>
        <div className="grid grid-cols-[24fr_40fr_34fr] divide-x divide-zinc-200 dark:divide-zinc-800">
          {/* Waktu & kasir */}
          <div className="flex flex-col justify-center gap-1.5 px-4 py-2">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Clock className="h-3.5 w-3.5" />
                Waktu:
              </span>
              <LiveClock />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-zinc-500">Kasir:</span>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                <Lock className="h-3.5 w-3.5 text-zinc-400" />
                <span className="truncate">{cashierName}</span>
              </span>
            </div>
          </div>

          {/* Pelanggan */}
          <div className="relative flex flex-col justify-center gap-1 px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-lco-green dark:text-lco-teal">
                Pelanggan [F2 / Cmd+U]
              </label>
              {selectedCustomer && (
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-lco-green px-1.5 py-0.5 text-[9px] font-bold text-white">
                    Member Aktif
                  </span>
                  {points > 0 && (
                    <span className="flex items-center gap-1 rounded-full border border-lco-mustard/40 bg-lco-mustard/10 px-1.5 py-0.5 text-[9px] font-bold text-lco-mustard">
                      <Link2 className="h-3 w-3" />
                      {points} poin
                    </span>
                  )}
                </div>
              )}
            </div>

            {selectedCustomer ? (
              <div className="flex h-8 items-center gap-2 rounded-md border-2 border-lco-teal bg-white px-2.5 dark:bg-zinc-950">
                <User className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="flex-1 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                  {selectedCustomer.name}
                </span>
                <button
                  onClick={onClearCustomer}
                  title="Hapus pelanggan"
                  className="shrink-0 text-lco-coral transition-opacity duration-150 hover:opacity-70"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 focus-within:border-lco-teal focus-within:ring-1 focus-within:ring-lco-teal dark:border-zinc-800 dark:bg-zinc-900">
                  <User className="h-4 w-4 shrink-0 text-zinc-400" />
                  <input
                    ref={customerInputRef}
                    type="text"
                    placeholder="Cari pelanggan / umum..."
                    className="w-full bg-transparent text-xs outline-none"
                    value={customerQuery}
                    autoComplete="off"
                    onChange={(e) => onCustomerQueryChange(e.target.value)}
                    onKeyDown={handleCustomerKeyDown}
                    onFocus={() => onCustomerDropdownOpenChange(true)}
                    onBlur={() =>
                      setTimeout(() => onCustomerDropdownOpenChange(false), 150)
                    }
                  />
                </div>
                {showCustomerList && (
                  <div
                    ref={customerListRef}
                    className="absolute left-4 right-4 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    {matchingCustomers.length === 0 ? (
                      <p className="px-3 py-2.5 text-xs text-zinc-400">
                        Pelanggan tidak ditemukan.
                      </p>
                    ) : (
                      matchingCustomers.map((c, i) => {
                        const active = i === customerIdx;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            data-active={active}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickCustomer(c);
                            }}
                            className={`flex w-full items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 text-left last:border-b-0 dark:border-zinc-900 ${
                              active
                                ? "bg-lco-teal/10"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                                {c.name}
                              </span>
                              {c.phone && (
                                <span className="block truncate font-mono text-[10px] text-zinc-400">
                                  {c.phone}
                                </span>
                              )}
                            </span>
                            {c.loyalty_points > 0 && (
                              <span className="shrink-0 text-[10px] font-semibold text-lco-mustard">
                                {c.loyalty_points} poin
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Total tagihan */}
          <div className="flex min-w-0 items-center justify-end gap-3 px-4 py-2">
            <div className="shrink-0 text-right font-mono text-[10px] leading-tight text-zinc-400">
              <p className="uppercase tracking-wider">Total Tagihan</p>
              <p>
                {cart.length} Item ({totalQty} Qty)
              </p>
            </div>
            <p className="whitespace-nowrap font-mono text-[clamp(1.5rem,2.2vw,2.5rem)] font-bold leading-none tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatRupiah(grandTotal)}
            </p>
          </div>
        </div>
      </section>

      {/* ═══ KARTU 2 · Kode + Nama Barang Terpilih + Parameter ═══ */}
      <section className={`${CARD} px-4 py-2.5`}>
        <div className="grid grid-cols-[33fr_25fr_42fr] gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className={SECTION_LABEL}>
                Jumlah Beli * Kode [F1 / Cmd+K]
              </label>
              {codeError ? (
                <span className="truncate text-[11px] font-medium text-lco-coral">
                  {codeError}
                </span>
              ) : (
                <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                  ↑↓ Navigasi Baris
                </span>
              )}
            </div>
            <div className="relative">
              <div
                className={`${FIELD_BOX} flex items-center gap-2.5 px-3 focus-within:border-lco-teal focus-within:ring-1 focus-within:ring-lco-teal`}
              >
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  ref={codeInputRef}
                  type="text"
                  autoComplete="off"
                  placeholder="Scan barcode / ketik nama atau [Qty*Kode]..."
                  className="w-full bg-transparent font-mono text-xs outline-none"
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    setIsSuggestOpen(true);
                    setSuggestIdx(0);
                    if (codeError) onClearCodeError();
                  }}
                  onFocus={() => setIsSuggestOpen(true)}
                  onBlur={() => setIsSuggestOpen(false)}
                  onKeyDown={handleCodeKeyDown}
                />
              </div>

              {/* Daftar saran: muncul saat mengetik nama/kode sebagian. */}
              {showSuggest && (
                <div
                  ref={suggestListRef}
                  className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full min-w-[420px] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {suggestions.length === 0 ? (
                    <p className="px-3 py-2.5 text-xs text-zinc-400">
                      Tidak ada produk yang cocok dengan &quot;{parsedCode.term}
                      &quot;.
                    </p>
                  ) : (
                    suggestions.map((product, i) => {
                      const active = i === suggestIdx;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          data-active={active}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            commitProduct(product);
                          }}
                          className={`flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left last:border-b-0 dark:border-zinc-900 ${
                            active
                              ? "bg-lco-teal/10"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                              {product.name}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-zinc-400">
                              {product.sku}
                              {product.barcode ? ` · ${product.barcode}` : ""}
                            </span>
                          </span>
                          {!product.is_service && (
                            <span
                              className={`shrink-0 font-mono text-[10px] ${
                                product.stock <= 0
                                  ? "text-lco-coral"
                                  : "text-zinc-400"
                              }`}
                            >
                              {product.stock <= 0
                                ? "Habis"
                                : `Stok ${product.stock}`}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                            {formatRupiah(product.sell_price)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className={SECTION_LABEL}>Nama Barang Terpilih</label>
            <div className={`${FIELD_BOX} flex items-center px-3`}>
              <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {selectedItem?.product.name ?? "-"}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className={SECTION_LABEL}>Parameter Barang Aktif</label>
            <div className="grid grid-cols-5 gap-1.5">
              <ParamBox label="Jumlah" value={selectedItem?.qty ?? "-"} />
              <ParamBox
                label="Satuan"
                value={selectedItem?.product.unit ?? "-"}
              />
              <ParamBox
                label="Harga Jual"
                value={
                  selectedItem
                    ? formatRupiah(selectedItem.product.sell_price)
                    : "-"
                }
              />
              {/* Diskon per-baris belum ada di skema (CartItem cuma
                  { product, qty }) — tampilan saja, selalu 0. Diskon yang
                  sungguhan dipakai ada di "Diskon Faktur" di bawah. */}
              <ParamBox label="Disc" value="0" />
              <ParamBox
                label="Total"
                value={
                  selectedItem
                    ? formatRupiah(
                        selectedItem.product.sell_price * selectedItem.qty,
                      )
                    : "-"
                }
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ KARTU 3 · Keranjang (mengisi sisa tinggi layar) ═══ */}
      <section
        className={`${CARD} flex min-h-0 flex-1 flex-col overflow-hidden`}
      >
        <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xs font-bold text-zinc-800 dark:text-zinc-100">
              Keranjang
            </h2>
            <span className="text-[10px] text-zinc-400">
              {cart.length} item · {totalQty} qty
            </span>
          </div>
          <button
            onClick={onClearCart}
            disabled={cart.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-lco-coral/40 bg-lco-coral/5 px-2.5 py-1 text-[11px] font-semibold text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
            Bersihkan [F5]
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
            {/* Lebar kolom: NAMA BARANG tanpa lebar tetap → otomatis melebar
                mengisi sisa; semua kolom lain lebar tetap & rapat di kanan. */}
            <colgroup>
              <col className="w-[44px]" />
              <col className="w-[128px]" />
              <col />
              <col className="w-[116px]" />
              <col className="w-[68px]" />
              <col className="w-[98px]" />
              <col className="w-[68px]" />
              <col className="w-[98px]" />
              <col className="w-[106px]" />
              <col className="w-[64px]" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-zinc-50 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <Th className="pl-4 text-left">No</Th>
                <Th className="text-left">Kode</Th>
                <Th className="text-left">Nama Barang</Th>
                <Th className="text-center">Jumlah</Th>
                <Th className="text-center">Satuan</Th>
                <Th className="text-right">Harga</Th>
                <Th className="text-right">Diskon</Th>
                <Th className="text-right">Netto</Th>
                <Th className="text-right">Total</Th>
                <Th className="pr-4 text-center">Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-10 text-center text-xs text-zinc-400"
                  >
                    Belum ada produk. Scan barcode atau ketik kode di kolom atas
                    untuk memulai.
                  </td>
                </tr>
              ) : (
                cart.map((item, idx) => {
                  const isSelected = item.product.id === selectedProductId;
                  const lineTotal = item.product.sell_price * item.qty;
                  const cell =
                    "border-b border-zinc-100 px-2.5 py-1.5 dark:border-zinc-900";
                  return (
                    <tr
                      key={item.product.id}
                      onClick={() => onSelectProductId(item.product.id)}
                      className={`cursor-pointer transition-colors duration-100 ${
                        isSelected
                          ? "bg-lco-teal/10"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                      }`}
                    >
                      <td
                        className={`${cell} border-l-[3px] pl-3 text-zinc-500 ${
                          isSelected
                            ? "border-l-lco-teal"
                            : "border-l-transparent"
                        }`}
                      >
                        {idx + 1}
                      </td>
                      <td
                        className={`${cell} truncate font-mono text-[11px] text-zinc-500`}
                      >
                        {item.product.sku}
                      </td>
                      <td
                        className={`${cell} truncate font-mono text-[13px] font-semibold text-zinc-800 dark:text-zinc-100`}
                      >
                        {item.product.name}
                      </td>
                      <td className={cell}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateQty(item.product.id, -1);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors duration-150 hover:text-lco-teal"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="flex h-6 w-10 items-center justify-center rounded border border-zinc-200 bg-white font-mono text-xs font-semibold tabular-nums dark:border-zinc-700 dark:bg-zinc-950">
                            {item.qty}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateQty(item.product.id, 1);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors duration-150 hover:text-lco-teal"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                      <td
                        className={`${cell} text-center font-mono text-[11px] uppercase text-zinc-500`}
                      >
                        {item.product.unit ?? "-"}
                      </td>
                      <td
                        className={`${cell} whitespace-nowrap text-right font-mono tabular-nums`}
                      >
                        {formatRupiah(item.product.sell_price)}
                      </td>
                      <td
                        className={`${cell} whitespace-nowrap text-right font-mono tabular-nums text-zinc-400`}
                      >
                        {formatRupiah(0)}
                      </td>
                      <td
                        className={`${cell} whitespace-nowrap text-right font-mono tabular-nums`}
                      >
                        {formatRupiah(lineTotal)}
                      </td>
                      <td
                        className={`${cell} whitespace-nowrap text-right font-mono font-bold tabular-nums`}
                      >
                        {formatRupiah(lineTotal)}
                      </td>
                      <td className={`${cell} pr-4`}>
                        <div className="flex items-center justify-center gap-2.5 text-zinc-400">
                          <Pencil className="h-3 w-3" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveFromCart(item.product.id);
                            }}
                            className="transition-colors duration-150 hover:text-lco-coral"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ═══ KARTU 4 · Bagian bawah ═══ */}
      <section className={`${CARD} p-2`}>
        <div className="grid h-[clamp(158px,21vh,270px)] grid-cols-[33fr_33fr_10fr_23fr] gap-2">
          {/* Kotak kiri: Diskon Faktur, Kode Promo, info poin */}
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                Diskon Faktur [F6 / Cmd+D]
              </label>
              <div className="flex gap-2">
                <input
                  ref={discountInputRef}
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={manualDiscountInput}
                  onChange={(e) => onManualDiscountInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      codeInputRef.current?.focus();
                    }
                  }}
                  className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-right font-mono text-xs outline-none focus:border-lco-teal focus:ring-1 focus:ring-lco-teal dark:border-zinc-800 dark:bg-zinc-900"
                />
                <button
                  onClick={() => codeInputRef.current?.focus()}
                  className="h-8 w-16 shrink-0 rounded-md bg-zinc-100 text-xs font-bold text-zinc-700 transition-colors duration-150 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  OK
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                Kode Promo / Voucher
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  disabled
                  placeholder="KODE PROMO..."
                  title="Fitur promo/voucher segera hadir"
                  className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-right font-mono text-xs uppercase text-zinc-400 outline-none dark:border-zinc-800 dark:bg-zinc-900"
                />
                <button
                  disabled
                  className="h-8 w-16 shrink-0 rounded-md bg-zinc-100 text-xs font-semibold text-zinc-300 dark:bg-zinc-900 dark:text-zinc-600"
                >
                  Pakai
                </button>
              </div>
            </div>

            {/* Info poin loyalitas — menempati slot yang sama dengan kotak
                peringatan poin di screenshot rujukan. */}
            {selectedCustomer && points > 0 && (
              <div
                className={`rounded-md border p-2 ${
                  usePoints
                    ? "border-lco-teal/40 bg-lco-teal/10"
                    : "border-lco-mustard/40 bg-lco-mustard/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`text-[10px] font-bold uppercase ${
                      usePoints
                        ? "text-lco-green dark:text-lco-teal"
                        : "text-lco-mustard"
                    }`}
                  >
                    {usePoints
                      ? `Memakai ${pointsBeingUsed} poin`
                      : `Punya ${points} poin`}
                  </p>
                  <button
                    onClick={() => onToggleUsePoints(!usePoints)}
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold text-white ${
                      usePoints ? "bg-zinc-500" : "bg-lco-mustard"
                    }`}
                  >
                    {usePoints ? "Batalkan" : "Gunakan Poin"}
                  </button>
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-zinc-600 dark:text-zinc-400">
                  {usePoints
                    ? `Potongan ${formatRupiah(pointsBeingUsed * loyaltyPointValue)} sudah dihitung ke total.`
                    : `${selectedCustomer.name} bisa memakai poinnya sebagai potongan harga (1 poin = ${formatRupiah(loyaltyPointValue)}).`}
                </p>
              </div>
            )}
          </div>

          {/* Kotak tengah: Subtotal ... Grand Total */}
          <div className="flex min-h-0 flex-col rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Subtotal:</span>
              <span className="font-mono font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {formatRupiah(subtotal)}
              </span>
            </div>
            {discount > 0 && (
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Diskon:</span>
                <span className="font-mono font-semibold tabular-nums text-lco-coral">
                  − {formatRupiah(discount)}
                </span>
              </div>
            )}
            {tax > 0 && (
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Pajak:</span>
                <span className="font-mono font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {formatRupiah(tax)}
                </span>
              </div>
            )}
            <button
              onClick={onOpenBiayaTambahan}
              className="mt-1.5 flex w-fit items-center gap-1.5 text-[11px] font-semibold text-lco-green transition-opacity duration-150 hover:opacity-70 dark:text-lco-teal"
            >
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current">
                <Plus className="h-2.5 w-2.5" />
              </span>
              + Biaya Tambahan (F7 / ⌥7)
            </button>

            <div className="mt-auto flex items-end justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                Grand Total:
              </span>
              <span className="font-mono text-lg font-bold tabular-nums text-lco-green dark:text-lco-teal">
                {formatRupiah(grandTotal)}
              </span>
            </div>
          </div>

          {/* TAHAN — tinggi penuh */}
          <button
            onClick={onHold}
            disabled={cart.length === 0 || isSavingTransaction}
            className="flex h-full items-center justify-center gap-1.5 rounded-lg border border-lco-mustard/20 bg-lco-mustard/10 px-2 text-xs font-bold text-lco-mustard transition-colors duration-150 hover:bg-lco-mustard/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pause className="h-3.5 w-3.5 shrink-0" />
            TAHAN [F3]
          </button>

          {/* BAYAR — tinggi penuh */}
          <button
            onClick={onPay}
            disabled={cart.length === 0 || isSavingTransaction}
            className="flex h-full items-center justify-center gap-2 rounded-lg bg-lco-green px-3 text-[clamp(0.8rem,1.1vw,1.2rem)] font-bold text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSavingTransaction ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Check className="h-4 w-4 shrink-0" />
            )}
            BAYAR [F8 / Cmd+Enter]
          </button>
        </div>
      </section>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`whitespace-nowrap border-y border-zinc-200 px-2.5 py-1.5 font-bold dark:border-zinc-800 ${className}`}
    >
      {children}
    </th>
  );
}

function ParamBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex h-9 min-w-0 flex-col items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-mono text-[9px] leading-none text-zinc-400">{label}</p>
      <p className="w-full truncate text-center font-mono text-[13px] font-bold leading-tight tabular-nums text-zinc-800 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}
