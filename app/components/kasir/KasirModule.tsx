"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Lock,
  Unlock,
  History,
  X,
  PlayCircle,
  Camera,
  ArrowLeft,
} from "lucide-react";
import BarcodeScanModal, { type ScanFeedback } from "./BarcodeScanModal";
import PaymentModal from "./PaymentModal";
import {
  shareReceiptViaWhatsApp,
  type ReceiptData,
} from "@/lib/pos/printLogic";
// ── PERBAIKAN (auto-print munculkan dialog cetak sistem) ── Sebelumnya file
// ini memanggil printThermalReceipt() langsung dari lib/pos/printLogic.ts,
// yang SELALU lewat window.print() (dialog cetak OS/browser SELALU muncul,
// itu batasan platform). Sekarang pakai printReceipt() dari
// usePrinterProfiles: kalau printer default kasir bertipe Bluetooth/USB,
// struk dikirim sebagai byte ESC/POS langsung ke device — TANPA dialog sama
// sekali. Dialog cetak sistem hanya muncul kalau printer default kasir
// masih "Printer Sistem (Browser)" (lihat Pengaturan > Printer).
import { usePrinterProfiles } from "@/hooks/usePrinterProfiles";
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
import {
  createTransaction,
  PaymentMethod,
  // ── TAMBAHAN (021, T-11 bagian 2) ── Tipe untuk wiring split payment ke
  // PaymentModal — lihat handleConfirmSplitPayment di bawah.
  type SplitPaymentLine,
  type CreatedPayment,
} from "@/lib/pos/transactionApi";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
// ── TAMBAHAN (T-04) ── Layar Kasir wajib mengecek shift aktif sebelum transaksi
// bisa dilakukan (PRD §17 T-04 DoD: "kasir tidak bisa transaksi sebelum buka shift").
// Pengecekan SEBENARNYA (yang tidak bisa dilewati) tetap ada di RPC create_transaction
// (migration 007) — blokir di sini murni supaya UX-nya jelas (kasir tidak perlu isi
// keranjang dulu baru ketahuan ditolak saat bayar).
import { useShifts } from "@/hooks/useShifts";
// ── TAMBAHAN (T-11 bagian 1) ── Hold order / "Tunda" — lihat komentar header
// hooks/useHoldOrders.ts untuk pembagian tanggung jawab lengkap.
import { useHoldOrders } from "@/hooks/useHoldOrders";

// ── TAMBAHAN (021, T-11 bagian 2) ── Label singkat per metode, dipakai
// handleConfirmSplitPayment() untuk menyusun field `method` gabungan di
// struk (mis. "Tunai + Transfer") — ReceiptData.method bertipe `string`
// bebas (lib/pos/printLogic.ts), jadi aman diisi gabungan begini, beda dari
// PaymentMethod tunggal yang dipakai jalur pembayaran biasa.
const SPLIT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Tunai",
  BANK_TRANSFER: "Transfer",
  QRIS: "QRIS",
  TEMPO: "Tempo",
};

interface KasirModuleProps {
  /** Dipanggil saat kasir menekan tombol "Buka Shift" di layar blokir (lihat di bawah). */
  onNavigateToShift?: () => void;
}

export default function KasirModule({ onNavigateToShift }: KasirModuleProps) {
  const { products, isLoading, error, refetch } = useProducts();
  const { categories } = useCategories();
  const { user } = useAuth();

  const { settings: posSettings } = useSettings();
  const { activeShift, isLoading: isShiftLoading } = useShifts();
  const { printReceipt } = usePrinterProfiles();
  const {
    heldOrders,
    isLoading: isHeldOrdersLoading,
    holdOrder,
    resumeHeldOrder,
    deleteHeldOrder,
    refetch: refetchHeldOrders,
  } = useHoldOrders();

  // ── PERBAIKAN (BUG: "layar kedip/refresh setelah bayar, sukses tidak
  // pernah tampil") ── Akar masalahnya: `isLoading` dari useProducts() juga
  // menyala true saat refetch() manual (dipanggil KasirModule setelah
  // transaksi sukses, untuk update angka stok) — bukan cuma saat load
  // pertama kali. Guard di bawah (`if (isLoading || isShiftLoading) return
  // <spinner full-screen>`) dulu memakai isLoading itu apa adanya, jadi tiap
  // kali refetch() jalan, SELURUH KasirModule (termasuk <PaymentModal> yang
  // sedang di layar sukses) ikut dibuang & diganti spinner, lalu di-mount
  // ULANG dari nol begitu refetch selesai — dan PaymentModal yang baru
  // di-mount otomatis reset ke layar form (lihat useEffect([isOpen, ...])
  // di PaymentModal.tsx). Itulah "kedip" yang terlihat: bukan bug print,
  // bukan bug transaksi (keduanya sudah sukses) — transaksi & cetak sudah
  // beres, tapi layarnya keburu di-reset paksa oleh loading state produk.
  //
  // Perbaikan: `hasLoadedInitial` hanya dipakai untuk menahan spinner
  // full-screen SEBELUM data pertama kali selesai dimuat. Setelah itu,
  // walau isLoading/isShiftLoading menyala lagi (mis. karena refetch()
  // pasca-transaksi), layar utama Kasir & PaymentModal TIDAK di-unmount —
  // cukup biarkan data lama tampil sampai data baru datang.
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);
  useEffect(() => {
    if (!isLoading && !isShiftLoading && !hasLoadedInitial) {
      setHasLoadedInitial(true);
    }
  }, [isLoading, isShiftLoading, hasLoadedInitial]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  // ── TAMBAHAN (responsif HP/tablet) ── Di layar sempit (di bawah breakpoint
  // `md`), panel Produk & panel Keranjang tidak lagi ditumpuk vertikal (itu
  // yang bikin kasir harus scroll ~2 layar penuh untuk sampai ke keranjang).
  // Sebagai gantinya keduanya jadi 2 "layar" yang di-toggle lewat state ini —
  // tombol mengambang "Lihat Keranjang" di layar Produk, tombol kembali di
  // layar Keranjang. Di `md` ke atas (tablet lanskap/desktop) state ini
  // diabaikan sepenuhnya lewat class `md:flex` — kedua panel selalu tampil
  // berdampingan seperti sebelumnya.
  const [mobileView, setMobileView] = useState<"products" | "cart">("products");
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);

  // ── TAMBAHAN (013) ── Struk transaksi TERAKHIR yang berhasil dibayar + no.
  // HP pelanggan yang diisi kasir di PaymentModal, disimpan di sini (bukan di
  // PaymentModal) supaya tetap tersedia untuk handleSendWhatsApp() bahkan
  // kalau PaymentModal sempat re-render (mis. reset form saat isOpen berubah).
  // null selama belum pernah ada transaksi sukses di sesi Kasir ini.
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [lastCustomerPhone, setLastCustomerPhone] = useState<string | null>(
    null,
  );

  // ── TAMBAHAN (T-11 bagian 1) ── Modal konfirmasi "Tunda" (isi label opsional).
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState("");
  const [isHolding, setIsHolding] = useState(false);
  const [holdModalError, setHoldModalError] = useState<string | null>(null);

  // Modal daftar held order — lihat & lanjutkan/hapus.
  const [isHeldListOpen, setIsHeldListOpen] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [heldListError, setHeldListError] = useState<string | null>(null);
  // Info non-fatal ("2 item disesuaikan karena stok berkurang") setelah resume —
  // dipisah dari transactionError (yang khusus kegagalan pembayaran) supaya
  // warnanya beda (peringatan kuning, bukan merah) & tidak saling menimpa.
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  // ── TAMBAHAN (T-11 bagian 3) ── Modal scan barcode kamera.
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);

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
      customerPhone?: string;
      dueDate?: string;
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
        customerPhone: extra?.customerPhone,
        dueDate: extra?.dueDate,
      });

      const receiptData: ReceiptData = {
        // ── KOREKSI (bug: data Pengaturan Toko/Struk tidak muncul di struk
        // baru) ── Field ini sebelumnya tidak pernah diisi di sini, jadi
        // printLogic.ts selalu jatuh ke fallback hardcode-nya ("Langitan.co",
        // tanpa alamat/telepon, footer default) walau kasir sudah mengisi
        // Pengaturan > Toko. TransactionDetailModal.tsx (cetak ulang dari
        // Riwayat Transaksi) sudah benar mengisi 4 field ini dari
        // `posSettings` — disamakan di sini.
        storeName: posSettings.namaToko,
        storeAddress: posSettings.alamat,
        storePhone: posSettings.telepon,
        footerText: posSettings.footerStruk,
        receiptNo: result.receipt_no,
        createdAt: new Date().toISOString(),
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

      // ── PERBAIKAN (auto-print setelah bayar) ── Sebelumnya cetak hanya
      // dipicu manual lewat tombol "Cetak" di layar sukses. Sekarang
      // PaymentModal memanggil onPrint() OTOMATIS begitu layar sukses
      // muncul (lihat handlePrintReceipt & prop onPrint di <PaymentModal>
      // di bawah) — kasir tidak perlu menekan apa pun, dan selalu ke
      // printer thermal (pemilihan format thermal/nota hanya tersisa di
      // alur "Cetak Ulang" pada Riwayat Transaksi).

      // ── TAMBAHAN (013) ── Simpan struk + no. HP transaksi ini supaya tombol
      // "Kirim WA" di layar sukses PaymentModal (dipanggil lewat onSendWhatsApp
      // di bawah) tahu struk MANA yang harus dibagikan.
      setLastReceipt(receiptData);
      setLastCustomerPhone(extra?.customerPhone ?? null);

      setCart(clearCart());
      setMobileView("products");
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

  // ── TAMBAHAN (021, T-11 bagian 2) ── Versi split payment dari
  // handleConfirmPayment di atas. Alurnya sengaja dibuat semirip mungkin
  // (createTransaction -> susun ReceiptData -> cetak -> simpan lastReceipt
  // -> kosongkan keranjang) supaya perilaku di luar bagian pembayaran
  // (cetak, "Kirim WA", refetch stok) tetap konsisten dengan jalur tunggal.
  // Perbedaan utama:
  // - createTransaction() dipanggil dengan `payments` (array), bukan
  //   `paymentMethod`/`paymentAmount` tunggal — lihat cabang SplitPaymentParams
  //   di lib/pos/transactionApi.ts.
  // - `paidAmount` struk = jumlah SEMUA baris (bukan satu nilai yang dikirim
  //   kasir), dan `method` struk digabung dari semua metode yang dipakai
  //   (mis. "Tunai + Transfer") memakai SPLIT_METHOD_LABELS di atas.
  // - Mengembalikan `payments` (bukan `paymentId` tunggal) — PaymentModal
  //   butuh ini untuk menempelkan bukti transfer/QRIS ke baris yang benar
  //   (lihat handleProcessSplitPayment di PaymentModal.tsx).
  const handleConfirmSplitPayment = async (
    lines: SplitPaymentLine[],
    extra?: {
      customerName?: string;
      customerPhone?: string;
    },
  ): Promise<{ payments: CreatedPayment[] }> => {
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
        payments: lines,
        customerName: extra?.customerName,
        customerPhone: extra?.customerPhone,
      });

      const totalPaid = lines.reduce((sum, line) => sum + line.amount, 0);
      const methodLabel = lines
        .map((line) => SPLIT_METHOD_LABELS[line.method] ?? line.method)
        .join(" + ");

      const receiptData: ReceiptData = {
        // ── KOREKSI (bug: data Pengaturan Toko/Struk tidak muncul di struk
        // baru) ── Sama seperti di handleConfirmPayment di atas.
        storeName: posSettings.namaToko,
        storeAddress: posSettings.alamat,
        storePhone: posSettings.telepon,
        footerText: posSettings.footerStruk,
        receiptNo: result.receipt_no,
        createdAt: new Date().toISOString(),
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
        paidAmount: totalPaid,
        changeAmount: result.change_amount ?? 0,
        method: methodLabel,
      };

      // ── PERBAIKAN (auto-print setelah bayar) ── Sama seperti
      // handleConfirmPayment di atas — auto-print thermal dipicu PaymentModal
      // sendiri lewat onPrint saat layar sukses muncul.
      setLastReceipt(receiptData);
      setLastCustomerPhone(extra?.customerPhone ?? null);

      setCart(clearCart());
      setMobileView("products");
      await refetch();
      return { payments: result.payments };
    } catch (err) {
      console.error("Split transaction failed:", err);
      const message =
        err instanceof Error ? err.message : "Transaksi gagal disimpan.";
      setTransactionError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setIsSavingTransaction(false);
    }
  };

  // ── TAMBAHAN (013) ── Dipanggil PaymentModal saat kasir menekan "Kirim
  // Struk via WhatsApp" di layar sukses. Pakai lastReceipt/lastCustomerPhone
  // dari state (bukan closure atas parameter handleConfirmPayment) karena
  // tombolnya baru bisa diklik SETELAH createTransaction() di atas selesai —
  // urutannya selalu: handleConfirmPayment selesai -> state ini terisi ->
  // PaymentModal masuk isSuccess -> baru mungkin tombol ini ditekan.
  const handleSendWhatsApp = async () => {
    if (!lastReceipt) {
      throw new Error(
        "Data struk tidak ditemukan. Muat ulang halaman lalu coba lagi.",
      );
    }
    return shareReceiptViaWhatsApp(lastReceipt, lastCustomerPhone);
  };

  // ── PERBAIKAN (auto-print setelah bayar) ── Dulu dipanggil manual saat
  // kasir menekan tombol "Cetak" di layar sukses, dan bisa mencetak thermal
  // ATAU nota tergantung pilihan kasir di form pembayaran. Sekarang
  // dipanggil OTOMATIS oleh PaymentModal (lihat prop onPrint di bawah) tepat
  // saat layar sukses muncul — kasir tidak perlu menekan apa pun — dan
  // SELALU ke printer thermal. Pilihan format nota (A6/A5) tidak hilang,
  // hanya dipindah sepenuhnya ke alur "Cetak Ulang" di Riwayat Transaksi
  // (lihat handleReprint di TransactionDetailModal.tsx), yang tetap
  // menawarkan thermal maupun nota untuk cetak ulang. Tetap boleh terpanggil
  // lagi kalau suatu saat dibutuhkan (mis. kertas macet) — printThermalReceipt
  // sendiri aman dipanggil berkali-kali.
  const handlePrintReceipt = () => {
    if (!lastReceipt) return;
    // Tidak perlu await/tangani hasilnya di sini — kegagalan (mis. printer
    // Bluetooth tiba-tiba mati) sudah cukup terlihat dari status printer di
    // Pengaturan > Printer, dan kasir tetap punya tombol ini untuk coba
    // cetak ulang kalau kertas macet, sama seperti sebelumnya.
    void printReceipt(lastReceipt);
  };

  // ── TAMBAHAN (T-11 bagian 1) ── Handler Hold Order.
  const openHoldModal = () => {
    if (cart.length === 0) return;
    setHoldModalError(null);
    setHoldLabel("");
    setIsHoldModalOpen(true);
  };

  const handleConfirmHold = async () => {
    setIsHolding(true);
    setHoldModalError(null);
    try {
      await holdOrder(cart, holdLabel);
      setCart(clearCart());
      setMobileView("products");
      setIsHoldModalOpen(false);
    } catch (err) {
      setHoldModalError(
        err instanceof Error ? err.message : "Gagal menunda transaksi.",
      );
    } finally {
      setIsHolding(false);
    }
  };

  const openHeldList = () => {
    setHeldListError(null);
    setIsHeldListOpen(true);
    refetchHeldOrders();
  };

  const handleResumeHeldOrder = async (id: string) => {
    // Melanjutkan held order MENIMPA keranjang aktif — kalau keranjang sedang
    // tidak kosong, kasir harus sadar dulu isinya bakal diganti (pola window.confirm
    // sama seperti KategoriModule.tsx untuk aksi yang tidak reversible dari UI).
    if (
      cart.length > 0 &&
      !window.confirm(
        "Keranjang saat ini belum kosong dan akan diganti dengan pesanan yang ditunda. Lanjutkan?",
      )
    ) {
      return;
    }

    setResumingId(id);
    setHeldListError(null);
    try {
      const result = await resumeHeldOrder(id, products);
      setCart(result.cart);
      setMobileView("cart");
      setTransactionError(null);
      setResumeNotice(
        result.skippedItems.length > 0
          ? `Beberapa item disesuaikan karena stok/produk berubah: ${result.skippedItems.join(", ")}`
          : null,
      );
      setIsHeldListOpen(false);
    } catch (err) {
      setHeldListError(
        err instanceof Error ? err.message : "Gagal melanjutkan pesanan.",
      );
    } finally {
      setResumingId(null);
    }
  };

  const handleDeleteHeldOrder = async (id: string) => {
    if (!window.confirm("Hapus pesanan tertunda ini? Tidak bisa dibatalkan.")) {
      return;
    }
    setResumingId(id);
    setHeldListError(null);
    try {
      await deleteHeldOrder(id);
    } catch (err) {
      setHeldListError(
        err instanceof Error ? err.message : "Gagal menghapus pesanan.",
      );
    } finally {
      setResumingId(null);
    }
  };

  // ── TAMBAHAN (T-11 bagian 3) ── Dipanggil BarcodeScanModal setiap kamera
  // berhasil baca satu barcode. Cocokkan ke `products` yang SUDAH dimuat di
  // layar ini (bukan query baru ke server tiap scan — barcode sama persis
  // dengan yang dipakai kolom pencarian teks di atas, jadi sumber datanya
  // konsisten). `useCallback` dengan dependensi [products, cart] supaya
  // BarcodeScanModal (yang pakai fungsi ini sebagai dependency effect kamera)
  // tidak restart kamera tiap render KasirModule, hanya saat daftar produk
  // atau isi keranjang benar-benar berubah.
  const handleBarcodeScanned = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim();
      const product = products.find((p) => (p.barcode ?? "").trim() === code);

      if (!product) {
        setScanFeedback({
          type: "error",
          message: `Barcode "${code}" tidak ditemukan di daftar produk.`,
        });
      } else if (isOutOfStock(product)) {
        setScanFeedback({
          type: "error",
          message: `${product.name} — stok habis.`,
        });
      } else {
        const inCartQty =
          cart.find((item) => item.product.id === product.id)?.qty ?? 0;
        if (inCartQty >= getAvailableStock(product)) {
          setScanFeedback({
            type: "error",
            message: `${product.name} — sudah mencapai stok maksimal di keranjang.`,
          });
        } else {
          handleAddToCart(product);
          setScanFeedback({
            type: "success",
            message: `${product.name} ditambahkan ke keranjang.`,
          });
        }
      }

      // Feedback ini transien — hilang sendiri sebelum kamera aktif lagi
      // (BarcodeScanModal resume ~1200ms), supaya tidak menumpuk pesan lama
      // saat kasir scan beberapa produk berturut-turut.
      setTimeout(() => setScanFeedback(null), 1800);
    },
    [products, cart],
  );

  // ── KOREKSI ── Sebelumnya di sini cuma cek `isLoading` (produk), sedangkan
  // `isShiftLoading` dicek belakangan di kondisi blokir shift. Karena fetch produk
  // & fetch status shift berjalan paralel dan seringkali produk selesai LEBIH DULU,
  // ada jeda sepersekian detik di mana `isLoading` sudah false tapi `isShiftLoading`
  // masih true — kondisi blokir shift (`!isShiftLoading && !activeShift`) ikut
  // bernilai false di jeda itu, sehingga layar Kasir SEMPAT ter-render utuh (tanpa
  // kunci) sebelum akhirnya "kedip" berubah jadi layar terkunci begitu status shift
  // datang. Sekarang KEDUA sumber loading digabung jadi satu kondisi, supaya layar
  // utama Kasir tidak pernah dirender sebelum status shift benar-benar diketahui.
  if (!hasLoadedInitial && (isLoading || isShiftLoading)) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-xs">Memuat layar Kasir...</span>
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

  // ── TAMBAHAN (T-04) ── Blokir layar Kasir kalau kasir belum buka shift.
  // Di titik ini `isShiftLoading` sudah pasti false (ditangani gabungan loading
  // di atas), jadi cukup cek `activeShift` saja.
  if (!activeShift) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <Lock className="w-6 h-6 text-lco-coral" />
          </div>
          <h3 className="text-sm font-semibold">Shift Belum Dibuka</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Buka shift dengan modal awal terlebih dahulu di menu Kas & Shift
            sebelum bisa mulai transaksi.
          </p>
          <button
            onClick={onNavigateToShift}
            disabled={!onNavigateToShift}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-xs font-semibold transition-colors duration-150 disabled:opacity-60"
          >
            <Unlock className="w-3.5 h-3.5" />
            Buka Shift Sekarang
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden">
      {/* ── PERBAIKAN (responsif HP/tablet) ── Sebelumnya panel ini punya
          `h-full` DI DALAM parent yang juga `flex-col` di layar sempit —
          artinya panel ini (dan panel Keranjang di bawah) sama-sama memaksa
          tinggi 100% layar, lalu ditumpuk vertikal, jadi total tingginya ~2x
          tinggi layar (kasir harus scroll sangat jauh untuk sampai ke
          keranjang & tombol Bayar). Sekarang: `min-h-0` (bukan `h-full`) agar
          panel ini benar-benar mengambil SISA tinggi yang tersedia dari flex
          parent, dan class `hidden`/`flex` + `md:flex` di bawah membuat di
          bawah `md` hanya SATU panel yang tampil sekaligus (tab "Produk" vs
          "Keranjang" lewat `mobileView`), sementara `md` ke atas kedua panel
          selalu tampil berdampingan seperti semula. */}
      <div
        className={`${mobileView === "products" ? "flex" : "hidden"} md:flex flex-1 flex-col min-h-0 border-r border-zinc-200 dark:border-zinc-800`}
      >
        <div className="p-4 sm:p-5 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex flex-col gap-4 z-10">
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
              <input
                type="text"
                placeholder="Cari nama, SKU, atau scan barcode..."
                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {/* ── TAMBAHAN (T-11 bagian 3) ── Scan pakai kamera, pelengkap alat
                scanner fisik (yang sudah bisa lewat kolom pencarian di atas —
                scanner fisik mengetik seperti keyboard). */}
            <button
              onClick={() => {
                setScanFeedback(null);
                setIsScanModalOpen(true);
              }}
              title="Scan Barcode (Kamera)"
              className="shrink-0 flex items-center justify-center w-10 h-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-500 hover:border-lco-teal hover:text-lco-teal transition-colors duration-150"
            >
              <Camera className="w-4 h-4" />
            </button>
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

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-zinc-400 text-xs">
              Tidak ada produk yang cocok.
            </div>
          ) : (
            // ── PERBAIKAN (responsif HP/tablet) ── Kolom disesuaikan per lebar
            // layar: 2 kolom di HP kecil, 3 di HP besar/tablet potret, turun
            // ke 2 lagi persis di breakpoint `md` (saat panel Keranjang mulai
            // tampil di sebelah, jatah lebar panel ini otomatis menyempit),
            // lalu naik lagi ke 3-4 kolom seiring layar makin lebar.
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
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

        {/* ── TAMBAHAN (responsif HP) ── Hanya tampil di bawah breakpoint
            `md` (di `md` ke atas keranjang sudah kelihatan di sebelah, jadi
            tombol ini tidak perlu). Ini pengganti scroll panjang ke bawah —
            kasir cukup tap untuk pindah ke layar Keranjang. */}
        {cart.length > 0 && (
          <button
            type="button"
            onClick={() => setMobileView("cart")}
            className="md:hidden shrink-0 flex items-center justify-between gap-3 mx-4 mb-4 px-4 py-3 rounded-xl bg-lco-teal hover:opacity-90 text-white shadow-lg transition-opacity duration-150"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingCart className="w-4 h-4" />
              {getCartItemCount(cart)} item
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="font-mono tabular-nums">
                {formatRupiah(grandTotal)}
              </span>
              <span className="text-xs font-medium underline underline-offset-2">
                Lihat Keranjang
              </span>
            </span>
          </button>
        )}
      </div>

      <div
        className={`${mobileView === "cart" ? "flex" : "hidden"} md:flex w-full md:w-[320px] lg:w-[380px] xl:w-[420px] flex-col min-h-0 bg-white dark:bg-zinc-950`}
      >
        <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* ── TAMBAHAN (responsif HP) ── Tombol kembali ke layar Produk;
                disembunyikan di `md` ke atas karena di sana panel Produk
                sudah selalu terlihat di sebelah. */}
            <button
              type="button"
              onClick={() => setMobileView("products")}
              title="Kembali ke Produk"
              className="md:hidden shrink-0 p-1.5 -ml-1 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-150"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="font-semibold text-base tracking-tight flex items-center gap-2 text-zinc-900 dark:text-zinc-100 truncate">
              <ShoppingCart className="w-5 h-5 text-lco-teal shrink-0" />
              Keranjang
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* ── TAMBAHAN (T-11 bagian 1) ── Lihat & lanjutkan pesanan yang ditunda. */}
            <button
              onClick={openHeldList}
              className="relative flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-900 text-zinc-500 hover:text-lco-mustard text-[11px] px-2.5 py-1 rounded-full font-mono border border-zinc-200 dark:border-zinc-800 transition-colors duration-150"
              title="Pesanan Tertunda"
            >
              <History className="w-3.5 h-3.5" />
              {heldOrders.length > 0 && (
                <span className="tabular-nums">{heldOrders.length}</span>
              )}
            </button>
            <span className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 text-[11px] px-2.5 py-1 rounded-full font-mono tabular-nums border border-zinc-200 dark:border-zinc-800">
              {getCartItemCount(cart)} Item
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-zinc-50/50 dark:bg-zinc-900/30">
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

        {/* ── TAMBAHAN (T-11 bagian 1) ── Info non-fatal setelah resume held order
            (mis. item disesuaikan karena stok berubah) — warna kuning/mustard,
            beda dari transactionError merah, supaya kasir tidak salah kira ada
            transaksi yang gagal. */}
        {resumeNotice && (
          <div className="mx-5 mb-3 p-3 rounded-md border border-lco-mustard/30 bg-lco-mustard/5 text-lco-mustard text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1">{resumeNotice}</p>
            <button
              onClick={() => setResumeNotice(null)}
              className="shrink-0 hover:opacity-70"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="p-4 sm:p-5 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 z-10">
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
              onClick={openHoldModal}
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
        onConfirmPayment={handleConfirmPayment}
        // ── TAMBAHAN (021, T-11 bagian 2) ── Sebelum ini, prop tidak pernah
        // dikirim sama sekali — pilihan "Split Bayar" di PaymentModal.tsx
        // sengaja hanya muncul kalau prop ini ADA (`splitAvailable = !!onConfirmSplitPayment`),
        // jadi tombolnya baru bisa terlihat/dipakai mulai dari baris ini.
        onConfirmSplitPayment={handleConfirmSplitPayment}
        onSendWhatsApp={handleSendWhatsApp}
        // ── PERBAIKAN (auto-print setelah bayar) ── onPrint sekarang dipanggil
        // OTOMATIS oleh PaymentModal begitu layar sukses muncul, bukan lewat
        // klik tombol "Cetak" manual lagi.
        receipt={lastReceipt}
        onPrint={handlePrintReceipt}
      />

      {/* ── TAMBAHAN (T-11 bagian 1) ── Modal konfirmasi "Tunda". */}
      {isHoldModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Tunda Transaksi
            </h3>
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              {getCartItemCount(cart)} item, {formatRupiah(subtotal)} —
              keranjang akan dikosongkan dan bisa dilanjutkan lagi lewat ikon
              riwayat di atas keranjang.
            </p>

            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Catatan (opsional)
            </label>
            <input
              type="text"
              value={holdLabel}
              onChange={(e) => setHoldLabel(e.target.value)}
              disabled={isHolding}
              placeholder="Mis. nama pelanggan"
              className="mb-3 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
            />

            {holdModalError && (
              <p className="mb-3 text-xs text-lco-coral">{holdModalError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsHoldModalOpen(false)}
                disabled={isHolding}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmHold}
                disabled={isHolding}
                className="inline-flex items-center gap-2 rounded-md bg-lco-mustard px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isHolding && <Loader2 className="h-4 w-4 animate-spin" />}
                Tunda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAMBAHAN (T-11 bagian 1) ── Modal daftar held order — lanjutkan/hapus. */}
      {isHeldListOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Pesanan Tertunda
              </h3>
              <button
                onClick={() => setIsHeldListOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {heldListError && (
              <p className="mx-4 mt-3 text-xs text-lco-coral">
                {heldListError}
              </p>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {isHeldOrdersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
              ) : heldOrders.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-400">
                  Belum ada pesanan yang ditunda.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {heldOrders.map((ho) => (
                    <div
                      key={ho.id}
                      className="flex items-center gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {ho.label || "Tanpa catatan"}
                        </p>
                        <p className="font-mono text-xs text-zinc-500">
                          {ho.item_count} item • {formatRupiah(ho.subtotal)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleResumeHeldOrder(ho.id)}
                        disabled={resumingId === ho.id}
                        title="Lanjutkan"
                        className="rounded-md p-2 text-lco-teal hover:bg-lco-green/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {resumingId === ho.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <PlayCircle className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteHeldOrder(ho.id)}
                        disabled={resumingId === ho.id}
                        title="Hapus"
                        className="rounded-md p-2 text-zinc-400 hover:bg-lco-coral/10 hover:text-lco-coral disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAMBAHAN (T-11 bagian 3) ── Modal scan barcode kamera. */}
      <BarcodeScanModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        onScan={handleBarcodeScanned}
        feedback={scanFeedback}
      />
    </div>
  );
}
