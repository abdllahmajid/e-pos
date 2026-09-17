// hooks/useDashboard.ts
// ── TAMBAHAN (T-06) ── Hook domain Dashboard (PRD §17 T-06 + §4.8). Menyediakan
// SEMUA agregat yang dipakai app/components/dashboard/DashboardModule.tsx:
//   - stat hari ini & bulan berjalan (omzet, transaksi, item terjual, rata-rata)
//   - deret harian 30 hari terakhir (untuk bar chart 7/30 hari — lihat catatan di bawah)
//   - komposisi kategori terlaris 30 hari (untuk pie chart)
//   - Action List: stok menipis, piutang tempo jatuh tempo, shift belum ditutup
//
// ═══════════════════════════════════════════════════════════════════════════════
// KEPUTUSAN PENTING — WAJIB DIBACA SEBELUM MENGUBAH FILE INI
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. OMZET = SUM(total) DARI STATUS 'PAID' **DAN** 'RETURN' (VOID dibuang).
//    Kenapa bukan cuma 'PAID'? Karena RPC `return_transaction` (migration 004)
//    melakukan DUA hal sekaligus:
//      a. membuat baris transaksi BARU berstatus 'RETURN' dengan `total` NEGATIF
//         (`-v_refund_total`), dan
//      b. mengubah status transaksi ASLI dari 'PAID' menjadi 'RETURN' juga —
//         bahkan untuk retur SEBAGIAN.
//    Jadi kalau difilter `status = 'PAID'` saja, satu retur sebagian akan
//    menghapus SELURUH omzet transaksi aslinya dari laporan. Dengan menjumlahkan
//    kedua status, hasilnya otomatis omzet BERSIH: nilai asli (positif) dikurangi
//    refund (negatif). VOID tetap dibuang total karena transaksinya dibatalkan
//    penuh dan stoknya sudah dikembalikan.
//
// 2. JUMLAH TRANSAKSI hanya menghitung baris PENJUALAN, bukan baris retur.
//    Pembedanya `related_transaction_id`: baris retur selalu terisi (menunjuk ke
//    transaksi asli), baris penjualan selalu NULL. Kalau retur ikut dihitung,
//    satu penjualan yang diretur akan tampil sebagai 2 transaksi.
//
// 3. ITEM TERJUAL dihitung `qty - returned_qty` dari `transaction_items` milik
//    transaksi ASLI. Baris transaksi retur sendiri memang TIDAK punya item sama
//    sekali (bug yang sudah tercatat di PROGRESS.md, belum diperbaiki atas
//    keputusan pemilik project) — jadi jangan pernah menjumlahkan item dari baris
//    retur, tidak akan ada isinya. Konsekuensi jujur yang perlu diketahui:
//    `returned_qty` menempel pada item transaksi ASLI, sehingga retur yang terjadi
//    HARI INI atas transaksi KEMARIN akan mengurangi angka "item terjual" di
//    tanggal kemarin, bukan hari ini. Untuk laporan harian ini masih wajar;
//    kalau nanti T-08 butuh pemisahan tanggal retur, sumbernya `stock_movements`
//    (type 'return'), bukan `transaction_items`.
//
// 4. TIDAK PAKAI RPC/VIEW AGREGAT DI DATABASE. Semua agregasi dilakukan di sini
//    setelah data mentah ditarik. Alasannya: (a) volume data satu toko dalam 30
//    hari masih kecil, (b) menghindari menambah objek DB baru yang harus diurus
//    RLS-nya untuk sesuatu yang sifatnya cuma tampilan, (c) Aturan Main #5 PRD
//    (logika uang wajib server-side) berlaku untuk uang yang DITULIS/DIKUNCI
//    (mis. `expected_cash` di `close_shift`), bukan untuk ringkasan read-only
//    yang tidak dipakai sebagai dasar transaksi apa pun.
//    KALAU nanti data sudah puluhan ribu baris per bulan, pindahkan agregasi ke
//    RPC `security definer` — bentuk return-nya sengaja dibuat datar supaya
//    penggantian itu tidak menyentuh komponen.
//
// 5. CHART 7/30 HARI TIDAK MEMICU FETCH ULANG. Hook selalu mengembalikan 30 titik
//    harian; tombol "7 Hari / 30 Hari" di komponen cukup memotong array (slice)
//    di sisi client. Ini sengaja — supaya ganti rentang terasa instan dan tidak
//    membebani database untuk data yang sudah ada di memori.
//
// 6. PIUTANG: belum ada mekanisme PELUNASAN tempo di sistem (itu scope T-08,
//    sub-tab Piutang/Tempo). Artinya SEMUA pembayaran `TEMPO` masih dianggap
//    belum lunas di sini. Ini bukan kelalaian — memang belum ada kolom/tabel
//    penanda lunas. Saat T-08 menambahkannya, filter tinggal ditambah di bagian
//    `loadReceivables()` di bawah.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

/** Jumlah titik pada deret harian yang selalu diambil (komponen boleh memotongnya). */
export const DASHBOARD_DAILY_POINTS = 30;

/** Batas baris yang ditampilkan per kelompok Action List (bukan batas hitungan). */
const ACTION_PREVIEW_LIMIT = 5;

/** PostgREST membatasi panjang URL — daftar id dipecah agar `.in()` tidak kepanjangan. */
const ID_CHUNK_SIZE = 150;

// ── Tipe publik ──────────────────────────────────────────────────────────────

export interface PeriodStats {
  /** Omzet bersih (penjualan dikurangi retur) dalam Rupiah. */
  revenue: number;
  /** Jumlah transaksi penjualan (baris retur tidak dihitung). */
  transactionCount: number;
  /** Total item terjual bersih = SUM(qty - returned_qty). */
  itemsSold: number;
  /** Rata-rata nilai per transaksi. 0 kalau belum ada transaksi. */
  averageTicket: number;
}

export interface DailyPoint {
  /** Tanggal kunci `YYYY-MM-DD` (waktu lokal, bukan UTC). */
  date: string;
  /** Label pendek untuk sumbu X, mis. "17 Sep". */
  label: string;
  revenue: number;
  transactionCount: number;
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  /** Nilai penjualan bersih kategori ini (Rupiah). */
  value: number;
  /** Warna dari tabel `categories`, null kalau kategori tidak punya warna. */
  color: string | null;
}

export type ActionKind = "low_stock" | "due_receivable" | "open_shift";

/** Tingkat urgensi — dipetakan ke warna teks di komponen (teal/mustard/coral). */
export type ActionSeverity = "info" | "warning" | "danger";

export interface ActionEntry {
  /** Judul baris, mis. nama produk atau nomor struk. */
  title: string;
  /** Keterangan pendek, mis. "Sisa 2 dari minimal 10". */
  detail: string;
}

export interface ActionGroup {
  kind: ActionKind;
  title: string;
  /** Jumlah TOTAL yang perlu perhatian (bisa lebih besar dari `entries.length`). */
  count: number;
  severity: ActionSeverity;
  /** Maksimal 5 baris contoh untuk ditampilkan. */
  entries: ActionEntry[];
  /** Key menu tujuan saat baris diklik — harus cocok dengan `activeMenu` di app/page.tsx. */
  targetMenu: "stok" | "riwayat" | "kas";
}

interface UseDashboardResult {
  today: PeriodStats;
  month: PeriodStats;
  daily: DailyPoint[];
  categories: CategorySlice[];
  actions: ActionGroup[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Waktu selesai pemuatan terakhir — dipakai label "diperbarui pukul ...". */
  lastUpdatedAt: Date | null;
}

// ── Util tanggal (semua pakai waktu LOKAL, bukan UTC) ────────────────────────
//
// Penting: `new Date().toISOString().slice(0, 10)` SALAH untuk kita, karena WIB
// (UTC+7) membuat transaksi jam 00:00–07:00 masuk ke tanggal kemarin versi UTC.
// Semua pengelompokan tanggal di bawah memakai komponen tanggal lokal.

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Kunci tanggal lokal `YYYY-MM-DD` untuk pengelompokan. */
function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortLabel(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function emptyStats(): PeriodStats {
  return { revenue: 0, transactionCount: 0, itemsSold: 0, averageTicket: 0 };
}

// ── Bentuk baris mentah dari Supabase ────────────────────────────────────────

interface RawTransaction {
  id: string;
  total: number | null;
  status: string;
  created_at: string;
  related_transaction_id: string | null;
}

interface RawItem {
  transaction_id: string;
  product_id: string | null;
  qty: number | null;
  returned_qty: number | null;
  unit_price: number | null;
  subtotal: number | null;
}

interface RawProductLite {
  id: string;
  category_id: string | null;
}

interface RawLowStockProduct {
  id: string;
  name: string;
  stock: number | null;
  min_stock: number | null;
  unit: string | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboard(): UseDashboardResult {
  const [today, setToday] = useState<PeriodStats>(emptyStats);
  const [month, setMonth] = useState<PeriodStats>(emptyStats);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [categories, setCategories] = useState<CategorySlice[]>([]);
  const [actions, setActions] = useState<ActionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const now = new Date();
      const todayStart = startOfDay(now);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      // Jendela tarik data = yang paling awal antara awal bulan dan 30 hari lalu,
      // supaya cukup satu query untuk stat bulan DAN grafik harian sekaligus.
      const chartStart = addDays(todayStart, -(DASHBOARD_DAILY_POINTS - 1));
      const windowStart =
        monthStart < chartStart ? monthStart : chartStart;

      try {
        // ── 1. Transaksi dalam jendela ──────────────────────────────────────
        // VOID sengaja tidak diambil sama sekali (lihat keputusan #1 di header).
        const { data: trxData, error: trxError } = await supabase
          .from("transactions")
          .select("id, total, status, created_at, related_transaction_id")
          .in("status", ["PAID", "RETURN"])
          .is("deleted_at", null)
          .gte("created_at", windowStart.toISOString())
          .order("created_at", { ascending: true });

        if (trxError) throw new Error(trxError.message);

        const transactions = (trxData ?? []) as RawTransaction[];

        // ── 2. Item dari transaksi di atas ──────────────────────────────────
        // Hanya transaksi PENJUALAN yang punya item (baris retur tidak punya —
        // lihat keputusan #3). Jadi id yang ditanyakan dipersempit dulu supaya
        // payload tidak membawa id yang pasti tidak ada isinya.
        const saleIds = transactions
          .filter((trx) => trx.related_transaction_id === null)
          .map((trx) => trx.id);

        const items: RawItem[] = [];

        for (const ids of chunk(saleIds, ID_CHUNK_SIZE)) {
          const { data: itemData, error: itemError } = await supabase
            .from("transaction_items")
            .select(
              "transaction_id, product_id, qty, returned_qty, unit_price, subtotal",
            )
            .in("transaction_id", ids);

          if (itemError) throw new Error(itemError.message);
          items.push(...((itemData ?? []) as RawItem[]));
        }

        // ── 3. Peta produk → kategori, dan kategori → nama/warna ────────────
        // Sengaja query terpisah, BUKAN embed PostgREST bertingkat
        // (`product:products(category:categories(...))`). Alasan yang sama seperti
        // di hooks/useStock.ts: bentuk FK di database ini tidak seragam antara
        // jalur scripts/setup-database.sql dan rantai migration, sehingga embed
        // berisiko patah diam-diam di salah satu jalur. Dua query kecil jauh lebih
        // mudah ditebak perilakunya.
        const productIds = Array.from(
          new Set(
            items
              .map((item) => item.product_id)
              .filter((id): id is string => !!id),
          ),
        );

        const categoryIdByProduct = new Map<string, string | null>();

        for (const ids of chunk(productIds, ID_CHUNK_SIZE)) {
          const { data: productData, error: productError } = await supabase
            .from("products")
            .select("id, category_id")
            .in("id", ids);

          if (productError) throw new Error(productError.message);

          for (const product of (productData ?? []) as RawProductLite[]) {
            categoryIdByProduct.set(product.id, product.category_id);
          }
        }

        const { data: categoryData, error: categoryError } = await supabase
          .from("categories")
          .select("id, name, color");

        if (categoryError) throw new Error(categoryError.message);

        const categoryMeta = new Map<string, { name: string; color: string | null }>();
        for (const row of categoryData ?? []) {
          categoryMeta.set(row.id, { name: row.name, color: row.color ?? null });
        }

        if (isCancelled) return;

        // ── 4. Agregasi ─────────────────────────────────────────────────────

        // Peta transaksi → (tanggal, apakah baris penjualan) untuk dipakai saat
        // menjumlahkan item per periode.
        const trxDate = new Map<string, Date>();
        for (const trx of transactions) {
          trxDate.set(trx.id, new Date(trx.created_at));
        }

        // 4a. Deret harian (selalu 30 titik, termasuk hari yang nol transaksi —
        // titik kosong penting supaya bentuk grafik tidak menipu).
        const dailyMap = new Map<string, DailyPoint>();
        for (let i = 0; i < DASHBOARD_DAILY_POINTS; i += 1) {
          const date = addDays(chartStart, i);
          dailyMap.set(dateKey(date), {
            date: dateKey(date),
            label: shortLabel(date),
            revenue: 0,
            transactionCount: 0,
          });
        }

        // 4b. Akumulator stat periode.
        const todayAcc = emptyStats();
        const monthAcc = emptyStats();

        for (const trx of transactions) {
          const createdAt = new Date(trx.created_at);
          const total = Number(trx.total ?? 0);
          const isSale = trx.related_transaction_id === null;

          // Grafik harian: omzet bersih (retur ikut, nilainya negatif),
          // tapi hitungan transaksi hanya baris penjualan.
          const point = dailyMap.get(dateKey(createdAt));
          if (point) {
            point.revenue += total;
            if (isSale) point.transactionCount += 1;
          }

          if (createdAt >= monthStart) {
            monthAcc.revenue += total;
            if (isSale) monthAcc.transactionCount += 1;
          }

          if (createdAt >= todayStart) {
            todayAcc.revenue += total;
            if (isSale) todayAcc.transactionCount += 1;
          }
        }

        // 4c. Item terjual + komposisi kategori (kategori dihitung untuk rentang
        // 30 hari, sama dengan grafik, supaya pie dan bar bercerita tentang
        // periode yang sama).
        const categoryValue = new Map<string | null, number>();

        for (const item of items) {
          const createdAt = trxDate.get(item.transaction_id);
          if (!createdAt) continue;

          const netQty = Number(item.qty ?? 0) - Number(item.returned_qty ?? 0);
          if (netQty <= 0) continue;

          if (createdAt >= monthStart) monthAcc.itemsSold += netQty;
          if (createdAt >= todayStart) todayAcc.itemsSold += netQty;

          if (createdAt >= chartStart) {
            // Nilai kategori dihitung ulang dari `unit_price × netQty`, BUKAN dari
            // `subtotal` apa adanya — subtotal masih memuat qty penuh sebelum
            // retur, jadi kalau dipakai langsung, barang yang sudah diretur tetap
            // terhitung penuh di pie kategori.
            const value = Number(item.unit_price ?? 0) * netQty;
            const categoryId = item.product_id
              ? (categoryIdByProduct.get(item.product_id) ?? null)
              : null;
            categoryValue.set(
              categoryId,
              (categoryValue.get(categoryId) ?? 0) + value,
            );
          }
        }

        todayAcc.averageTicket =
          todayAcc.transactionCount > 0
            ? Math.round(todayAcc.revenue / todayAcc.transactionCount)
            : 0;
        monthAcc.averageTicket =
          monthAcc.transactionCount > 0
            ? Math.round(monthAcc.revenue / monthAcc.transactionCount)
            : 0;

        const categorySlices: CategorySlice[] = Array.from(
          categoryValue.entries(),
        )
          .filter(([, value]) => value > 0)
          .map(([categoryId, value]) => {
            const meta = categoryId ? categoryMeta.get(categoryId) : undefined;
            return {
              categoryId,
              name: meta?.name ?? "Tanpa Kategori",
              value,
              color: meta?.color ?? null,
            };
          })
          .sort((a, b) => b.value - a.value);

        // ── 5. Action List ──────────────────────────────────────────────────
        const actionGroups = await loadActionGroups(todayStart);

        if (isCancelled) return;

        setToday(todayAcc);
        setMonth(monthAcc);
        setDaily(Array.from(dailyMap.values()));
        setCategories(categorySlices);
        setActions(actionGroups);
        setLastUpdatedAt(new Date());
        setIsLoading(false);
      } catch (err) {
        if (isCancelled) return;
        console.error("useDashboard load error:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Gagal memuat ringkasan dashboard.",
        );
        setToday(emptyStats());
        setMonth(emptyStats());
        setDaily([]);
        setCategories([]);
        setActions([]);
        setIsLoading(false);
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  // Array/objek hasil agregasi dikembalikan apa adanya; useMemo di sini hanya
  // menjaga identitas objek pembungkus supaya konsumen yang memakainya sebagai
  // dependency effect tidak ikut render berulang tanpa sebab.
  return useMemo(
    () => ({
      today,
      month,
      daily,
      categories,
      actions,
      isLoading,
      error,
      refetch,
      lastUpdatedAt,
    }),
    [today, month, daily, categories, actions, isLoading, error, refetch, lastUpdatedAt],
  );
}

// ── Action List ──────────────────────────────────────────────────────────────
//
// Dipisah jadi fungsi sendiri supaya bagian agregat penjualan di atas tetap
// terbaca. Ketiga kelompok ditarik paralel — tidak saling bergantung.
//
// Catatan RLS yang perlu diingat saat membaca hasilnya:
// - `products` bisa dibaca semua role, jadi "stok menipis" selalu terisi.
// - `shift_sessions` dibatasi RLS (migration 007): kasir hanya melihat shift
//   miliknya sendiri, admin/supervisor melihat semua. Jadi kelompok "shift belum
//   ditutup" otomatis menyesuaikan role TANPA cek role di sini — memang disengaja.
// - `payments` mengikuti akses transaksinya.

async function loadActionGroups(todayStart: Date): Promise<ActionGroup[]> {
  const [lowStock, receivables, openShifts] = await Promise.all([
    loadLowStock(),
    loadReceivables(todayStart),
    loadStaleShifts(todayStart),
  ]);

  // Kelompok kosong dibuang — Action List hanya menampilkan yang benar-benar
  // perlu perhatian, bukan daftar tetap berisi "0 item".
  return [lowStock, receivables, openShifts].filter(
    (group): group is ActionGroup => group !== null,
  );
}

async function loadLowStock(): Promise<ActionGroup | null> {
  // PostgREST tidak bisa membandingkan dua kolom (`stock <= min_stock`) lewat
  // filter biasa, jadi penyaringan akhir dilakukan di sini. Untuk menekan jumlah
  // baris yang ditarik, hanya produk yang PUNYA ambang batas (`min_stock > 0`)
  // yang diambil — produk tanpa ambang memang tidak pernah "menipis".
  // Produk jasa dikecualikan: stoknya tidak bermakna (pola sama dengan T-05).
  const { data, error } = await supabase
    .from("products")
    .select("id, name, stock, min_stock, unit")
    .eq("is_active", true)
    .eq("is_service", false)
    .is("deleted_at", null)
    .gt("min_stock", 0)
    .order("stock", { ascending: true });

  if (error) {
    console.error("Action List (stok menipis) gagal dimuat:", error);
    return null;
  }

  const rows = ((data ?? []) as RawLowStockProduct[]).filter(
    (row) => Number(row.stock ?? 0) <= Number(row.min_stock ?? 0),
  );

  if (rows.length === 0) return null;

  const habis = rows.some((row) => Number(row.stock ?? 0) <= 0);

  return {
    kind: "low_stock",
    title: "Stok menipis",
    count: rows.length,
    // Ada yang sudah benar-benar habis → coral (bahaya), selebihnya peringatan.
    severity: habis ? "danger" : "warning",
    targetMenu: "stok",
    entries: rows.slice(0, ACTION_PREVIEW_LIMIT).map((row) => {
      const stock = Number(row.stock ?? 0);
      const unit = row.unit ? ` ${row.unit}` : "";
      return {
        title: row.name,
        detail:
          stock <= 0
            ? `Habis — minimal ${row.min_stock}${unit}`
            : `Sisa ${stock}${unit} dari minimal ${row.min_stock}${unit}`,
      };
    }),
  };
}

async function loadReceivables(todayStart: Date): Promise<ActionGroup | null> {
  // Semua pembayaran TEMPO yang tanggal jatuh temponya hari ini atau sudah lewat.
  // Belum ada penanda lunas di skema (lihat keputusan #6 di header) — begitu T-08
  // menambahkannya, tambahkan filternya di query ini.
  const dueKey = dateKey(todayStart);

  const { data, error } = await supabase
    .from("payments")
    .select("id, transaction_id, amount, due_date")
    .eq("method", "TEMPO")
    .not("due_date", "is", null)
    .lte("due_date", dueKey)
    .order("due_date", { ascending: true });

  if (error) {
    console.error("Action List (piutang) gagal dimuat:", error);
    return null;
  }

  const payments = (data ?? []) as {
    id: string;
    transaction_id: string;
    amount: number | null;
    due_date: string;
  }[];

  if (payments.length === 0) return null;

  // Ambil identitas transaksinya secara terpisah (bukan embed — alasan sama
  // seperti di bagian kategori) sekaligus untuk membuang transaksi VOID.
  const trxIds = Array.from(new Set(payments.map((p) => p.transaction_id)));
  const trxInfo = new Map<
    string,
    { receipt_no: string; customer_name: string | null; status: string }
  >();

  for (const ids of chunk(trxIds, ID_CHUNK_SIZE)) {
    const { data: trxData, error: trxError } = await supabase
      .from("transactions")
      .select("id, receipt_no, customer_name, status")
      .in("id", ids)
      .is("deleted_at", null);

    if (trxError) {
      console.error("Action List (piutang) gagal memuat transaksi:", trxError);
      return null;
    }

    for (const row of trxData ?? []) {
      trxInfo.set(row.id, {
        receipt_no: row.receipt_no,
        customer_name: row.customer_name,
        status: row.status,
      });
    }
  }

  const rows = payments.filter((payment) => {
    const info = trxInfo.get(payment.transaction_id);
    return !!info && info.status !== "VOID";
  });

  if (rows.length === 0) return null;

  const lewatTempo = rows.some((payment) => payment.due_date < dueKey);

  return {
    kind: "due_receivable",
    title: "Piutang jatuh tempo",
    count: rows.length,
    severity: lewatTempo ? "danger" : "warning",
    targetMenu: "riwayat",
    entries: rows.slice(0, ACTION_PREVIEW_LIMIT).map((payment) => {
      const info = trxInfo.get(payment.transaction_id);
      const nama = info?.customer_name?.trim() || "Tanpa nama";
      const jatuhTempo = new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
      }).format(new Date(`${payment.due_date}T00:00:00`));

      return {
        title: `${nama} — ${info?.receipt_no ?? "?"}`,
        detail:
          payment.due_date < dueKey
            ? `Lewat tempo sejak ${jatuhTempo}`
            : `Jatuh tempo hari ini (${jatuhTempo})`,
      };
    }),
  };
}

async function loadStaleShifts(todayStart: Date): Promise<ActionGroup | null> {
  // Shift yang masih OPEN padahal dibuka SEBELUM hari ini = lupa ditutup.
  // Shift yang dibuka hari ini dan masih terbuka itu normal (kasir sedang kerja),
  // jadi sengaja tidak ikut dihitung.
  const { data, error } = await supabase
    .from("shift_sessions")
    .select("id, cashier_id, opened_at, opening_cash")
    .eq("status", "OPEN")
    .lt("opened_at", todayStart.toISOString())
    .order("opened_at", { ascending: true });

  if (error) {
    console.error("Action List (shift) gagal dimuat:", error);
    return null;
  }

  const rows = (data ?? []) as {
    id: string;
    cashier_id: string;
    opened_at: string;
    opening_cash: number | null;
  }[];

  if (rows.length === 0) return null;

  // Nama kasir diambil terpisah dari `profiles` — pola yang sama dengan
  // hooks/useStock.ts (FK `cashier_id` tidak seragam antar jalur pembuatan tabel).
  const cashierIds = Array.from(new Set(rows.map((row) => row.cashier_id)));
  const nameById = new Map<string, string>();

  if (cashierIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", cashierIds);

    for (const profile of profiles ?? []) {
      if (profile.full_name) nameById.set(profile.id, profile.full_name);
    }
  }

  return {
    kind: "open_shift",
    title: "Shift belum ditutup",
    count: rows.length,
    severity: "danger",
    targetMenu: "kas",
    entries: rows.slice(0, ACTION_PREVIEW_LIMIT).map((row) => {
      const dibuka = new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(row.opened_at));

      return {
        title: nameById.get(row.cashier_id) ?? "Kasir tidak dikenal",
        detail: `Dibuka ${dibuka}, masih terbuka`,
      };
    }),
  };
}