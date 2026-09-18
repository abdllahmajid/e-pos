// hooks/useReports.ts
// ── TAMBAHAN (T-08) ── Hook domain Laporan (PRD §17 Fase E, §4.5, §4.7).
// Menyediakan data untuk 3 sub-tab yang diminta PRD:
//   - Per Shift        → riwayat shift semua kasir (bukan cuma milik sendiri,
//                         beda dengan hooks/useShifts.ts yang khusus user login).
//   - Harian/Bulanan    → ringkasan omzet + deret harian untuk rentang tanggal
//                         BEBAS (beda dengan hooks/useDashboard.ts yang terkunci
//                         "hari ini" & "bulan berjalan" saja).
//   - Piutang/Tempo     → daftar payment TEMPO + status Lunas/Belum/Jatuh Tempo
//                         (kolom `is_settled` dari migration 012) + aksi
//                         menandai lunas lewat RPC `settle_receivable`.
//
// ═══════════════════════════════════════════════════════════════════════════
// ASUMSI YANG PERLU DIKONFIRMASI KE PRD (bukan tebakan sembarangan, tapi belum
// ada teks PRD eksplisit yang terbaca sejauh sesi ini untuk 2 hal berikut):
// ═══════════════════════════════════════════════════════════════════════════
// 1. **Akses modul Laporan: diasumsikan admin/supervisor saja**, pola sama
//    seperti StokModule.tsx ("kasir TIDAK punya akses, PRD §5 baris `stok`").
//    Laporan berisi omzet & selisih kas semua kasir — masuk akal dibatasi sama
//    seperti Stok, tapi ini ASUMSI, bukan dikutip langsung dari §5. Kalau salah,
//    ubah flag `canViewReports` di komponen (LaporanModule.tsx, belum dibuat)
//    yang memakai hook ini — hook ini sendiri TIDAK melakukan pengecekan role
//    apapun (sama seperti useStock.ts, biar reusable & gampang ditest).
// 2. **Piutang/Tempo TIDAK ikut difilter rentang tanggal** seperti 2 sub-tab
//    lain — daftar piutang selalu menampilkan SEMUA payment TEMPO yang belum
//    lunas (+ 30 hari terakhir yang sudah lunas, biar tetap kelihatan riwayat
//    pelunasan terbaru), diurutkan jatuh tempo terdekat dulu. Alasannya: piutang
//    yang jatuh tempo bulan lalu tetap harus terlihat & bisa ditagih walau
//    filter Laporan sedang di "bulan ini" — kalau ikut difilter rentang, piutang
//    lama berisiko "hilang dari radar" begitu bulan berganti.
//
// ── Keputusan desain lain ──
// - **Agregasi Harian/Bulanan dilakukan di client**, pola sama persis seperti
//   useDashboard.ts (T-06): rentang tanggal laporan toko masih kecil, dan ini
//   ringkasan read-only. Kalau nanti dipindah ke RPC, bentuk return sengaja
//   dibuat datar (SalesSummary/DailySalesPoint) supaya komponen tidak perlu
//   diubah.
// - **Omzet = status PAID + RETURN, VOID dibuang** — alasan identik dengan
//   useDashboard.ts: baris RETURN bernilai total negatif, menjumlahkan
//   keduanya menghasilkan omzet BERSIH yang benar. Baca komentar lengkap di
//   hooks/useDashboard.ts kalau butuh detail, tidak diulang semua di sini.
// - **Semua pengelompokan tanggal pakai waktu LOKAL** (`dateKey()`), bukan
//   `toISOString()` — WIB (UTC+7) butuh ini, sama seperti useDashboard.ts &
//   RPC get_transaction_by_receipt (migration 010).
// - **Nama kasir di laporan shift diambil lewat query terpisah** ke `profiles`
//   (bukan embed PostgREST) — konsisten dengan alasan di useDashboard.ts &
//   useStock.ts: bentuk FK tidak seragam antara scripts/setup-database.sql dan
//   rantai migration.
// - **Shift yang masih OPEN ikut ditampilkan** di rentang tanggal (bukan cuma
//   CLOSED) — supervisor perlu tahu ada shift yang belum ditutup dalam rentang
//   yang dia lihat, bukan cuma shift yang sudah selesai.
// - **`settleReceivable()` di sini HANYA memanggil RPC + refetch** — upload
//   bukti pelunasan (tabel `payment_proofs`, kolom `proof_type = 'settlement'`
//   dari migration 012) sengaja belum ditaruh di hook ini, karena upload file
//   ke Storage butuh komponen (input file) — akan ditambahkan saat
//   LaporanModule.tsx dibuat, hook ini cukup expose `payment_id` yang
//   dibutuhkan untuk insert baris `payment_proofs` dari komponen.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

// ── Util tanggal (waktu LOKAL, bukan UTC — lihat catatan di header) ─────────

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

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

// ── Preset rentang tanggal ────────────────────────────────────────────────

export type ReportDatePreset =
  | "today"
  | "7d"
  | "30d"
  | "this_month"
  | "last_month"
  | "custom";

export interface DateRange {
  start: Date;
  end: Date;
}

export function presetToRange(preset: ReportDatePreset, customRange?: DateRange): DateRange {
  const now = new Date();
  const today = startOfDay(now);

  switch (preset) {
    case "today":
      return { start: today, end: endOfDay(now) };
    case "7d":
      return { start: addDays(today, -6), end: endOfDay(now) };
    case "30d":
      return { start: addDays(today, -29), end: endOfDay(now) };
    case "this_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: endOfDay(now),
      };
    case "last_month": {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: startOfDay(lastMonthStart), end: endOfDay(lastMonthEnd) };
    }
    case "custom":
      if (!customRange) {
        throw new Error("customRange wajib diisi untuk preset 'custom'.");
      }
      return { start: startOfDay(customRange.start), end: endOfDay(customRange.end) };
    default:
      return { start: today, end: endOfDay(now) };
  }
}

// ── Tipe publik: Harian/Bulanan ──────────────────────────────────────────────

export interface SalesSummary {
  revenue: number;
  transactionCount: number;
  itemsSold: number;
  averageTicket: number;
}

export interface DailySalesPoint {
  date: string;
  label: string;
  revenue: number;
  transactionCount: number;
}

function emptySummary(): SalesSummary {
  return { revenue: 0, transactionCount: 0, itemsSold: 0, averageTicket: 0 };
}

// ── Tipe publik: Per Shift ───────────────────────────────────────────────────

export interface ShiftReportRow {
  id: string;
  cashier_id: string;
  cashier_name: string | null;
  opened_at: string;
  closed_at: string | null;
  status: "OPEN" | "CLOSED";
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
}

// ── Tipe publik: Piutang/Tempo ───────────────────────────────────────────────

export type ReceivableStatus = "LUNAS" | "JATUH_TEMPO" | "BELUM_LUNAS";

export interface ReceivableRow {
  payment_id: string;
  transaction_id: string;
  receipt_no: string;
  customer_name: string | null;
  amount: number;
  due_date: string | null;
  is_settled: boolean;
  settled_at: string | null;
  status: ReceivableStatus;
  created_at: string;
}

function receivableStatus(dueDate: string | null, isSettled: boolean): ReceivableStatus {
  if (isSettled) return "LUNAS";
  if (dueDate && dueDate < dateKey(new Date())) return "JATUH_TEMPO";
  return "BELUM_LUNAS";
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
  qty: number | null;
  returned_qty: number | null;
}

interface RawShift {
  id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  status: "OPEN" | "CLOSED";
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
}

interface RawPayment {
  id: string;
  transaction_id: string;
  amount: number;
  due_date: string | null;
  is_settled: boolean;
  settled_at: string | null;
  created_at: string;
}

interface RawTransactionLite {
  id: string;
  receipt_no: string;
  customer_name: string | null;
}

// ── Hasil hook ───────────────────────────────────────────────────────────────

interface UseReportsResult {
  dateRange: DateRange;
  preset: ReportDatePreset;
  setPreset: (preset: ReportDatePreset, customRange?: DateRange) => void;

  salesSummary: SalesSummary;
  dailySales: DailySalesPoint[];
  shifts: ShiftReportRow[];
  receivables: ReceivableRow[];

  isLoading: boolean;
  error: string | null;
  refetch: () => void;

  /** Menandai satu payment TEMPO lunas lewat RPC `settle_receivable` (migration 012). */
  settleReceivable: (paymentId: string) => Promise<void>;
}

const RECEIVABLES_SETTLED_LOOKBACK_DAYS = 30;

export function useReports(): UseReportsResult {
  const [preset, setPresetState] = useState<ReportDatePreset>("this_month");
  const [dateRange, setDateRangeState] = useState<DateRange>(() => presetToRange("this_month"));

  const [salesSummary, setSalesSummary] = useState<SalesSummary>(emptySummary);
  const [dailySales, setDailySales] = useState<DailySalesPoint[]>([]);
  const [shifts, setShifts] = useState<ShiftReportRow[]>([]);
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const setPreset = useCallback((next: ReportDatePreset, customRange?: DateRange) => {
    setPresetState(next);
    setDateRangeState(presetToRange(next, customRange));
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        // ── 1. Transaksi dalam rentang (untuk Harian/Bulanan) ────────────────
        const { data: trxData, error: trxError } = await supabase
          .from("transactions")
          .select("id, total, status, created_at, related_transaction_id")
          .in("status", ["PAID", "RETURN"])
          .is("deleted_at", null)
          .gte("created_at", dateRange.start.toISOString())
          .lte("created_at", dateRange.end.toISOString())
          .order("created_at", { ascending: true });

        if (trxError) throw new Error(trxError.message);
        const transactions = (trxData ?? []) as RawTransaction[];

        const saleIds = transactions
          .filter((trx) => trx.related_transaction_id === null)
          .map((trx) => trx.id);

        const items: RawItem[] = [];
        for (const ids of chunk(saleIds, 150)) {
          const { data: itemData, error: itemError } = await supabase
            .from("transaction_items")
            .select("transaction_id, qty, returned_qty")
            .in("transaction_id", ids);
          if (itemError) throw new Error(itemError.message);
          items.push(...((itemData ?? []) as RawItem[]));
        }

        if (isCancelled) return;

        // ── 2. Agregasi Harian/Bulanan ────────────────────────────────────────
        const dailyMap = new Map<string, DailySalesPoint>();
        for (
          let cursor = startOfDay(dateRange.start);
          cursor <= dateRange.end;
          cursor = addDays(cursor, 1)
        ) {
          dailyMap.set(dateKey(cursor), {
            date: dateKey(cursor),
            label: shortLabel(cursor),
            revenue: 0,
            transactionCount: 0,
          });
        }

        const summaryAcc = emptySummary();
        for (const trx of transactions) {
          const total = Number(trx.total ?? 0);
          const isSale = trx.related_transaction_id === null;
          const createdAt = new Date(trx.created_at);

          summaryAcc.revenue += total;
          if (isSale) summaryAcc.transactionCount += 1;

          const point = dailyMap.get(dateKey(createdAt));
          if (point) {
            point.revenue += total;
            if (isSale) point.transactionCount += 1;
          }
        }

        const itemsByTransaction = new Map<string, number>();
        for (const item of items) {
          const netQty = Number(item.qty ?? 0) - Number(item.returned_qty ?? 0);
          if (netQty <= 0) continue;
          itemsByTransaction.set(
            item.transaction_id,
            (itemsByTransaction.get(item.transaction_id) ?? 0) + netQty,
          );
        }
        summaryAcc.itemsSold = Array.from(itemsByTransaction.values()).reduce(
          (sum, qty) => sum + qty,
          0,
        );
        summaryAcc.averageTicket =
          summaryAcc.transactionCount > 0
            ? Math.round(summaryAcc.revenue / summaryAcc.transactionCount)
            : 0;

        // ── 3. Shift dalam rentang (SEMUA kasir, untuk Per Shift) ────────────
        const { data: shiftData, error: shiftError } = await supabase
          .from("shift_sessions")
          .select(
            "id, cashier_id, opened_at, closed_at, status, opening_cash, expected_cash, actual_cash, difference",
          )
          .gte("opened_at", dateRange.start.toISOString())
          .lte("opened_at", dateRange.end.toISOString())
          .order("opened_at", { ascending: false });

        if (shiftError) throw new Error(shiftError.message);
        const rawShifts = (shiftData ?? []) as RawShift[];

        const cashierIds = Array.from(new Set(rawShifts.map((s) => s.cashier_id)));
        const cashierNameById = new Map<string, string | null>();
        for (const ids of chunk(cashierIds, 150)) {
          const { data: profileData, error: profileError } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", ids);
          if (profileError) throw new Error(profileError.message);
          for (const p of profileData ?? []) {
            cashierNameById.set(p.id, p.full_name ?? null);
          }
        }

        const shiftRows: ShiftReportRow[] = rawShifts.map((s) => ({
          id: s.id,
          cashier_id: s.cashier_id,
          cashier_name: cashierNameById.get(s.cashier_id) ?? null,
          opened_at: s.opened_at,
          closed_at: s.closed_at,
          status: s.status,
          opening_cash: Number(s.opening_cash ?? 0),
          expected_cash: s.expected_cash === null ? null : Number(s.expected_cash),
          actual_cash: s.actual_cash === null ? null : Number(s.actual_cash),
          difference: s.difference === null ? null : Number(s.difference),
        }));

        if (isCancelled) return;

        // ── 4. Piutang/Tempo — TIDAK ikut filter rentang, lihat catatan #2 di
        //      header file ini. Ambil: semua yang belum lunas, + yang lunas
        //      dalam N hari terakhir supaya riwayat pelunasan tetap kelihatan.
        const lookback = addDays(startOfDay(new Date()), -RECEIVABLES_SETTLED_LOOKBACK_DAYS);

        const { data: paymentData, error: paymentError } = await supabase
          .from("payments")
          .select("id, transaction_id, amount, due_date, is_settled, settled_at, created_at")
          .eq("method", "TEMPO")
          .or(`is_settled.eq.false,settled_at.gte.${lookback.toISOString()}`)
          .order("due_date", { ascending: true })
          .limit(300);

        if (paymentError) throw new Error(paymentError.message);
        const rawPayments = (paymentData ?? []) as RawPayment[];

        const trxIds = Array.from(new Set(rawPayments.map((p) => p.transaction_id)));
        const trxLiteById = new Map<string, RawTransactionLite>();
        for (const ids of chunk(trxIds, 150)) {
          const { data: trxLiteData, error: trxLiteError } = await supabase
            .from("transactions")
            .select("id, receipt_no, customer_name")
            .in("id", ids);
          if (trxLiteError) throw new Error(trxLiteError.message);
          for (const t of (trxLiteData ?? []) as RawTransactionLite[]) {
            trxLiteById.set(t.id, t);
          }
        }

        const receivableRows: ReceivableRow[] = rawPayments.map((p) => {
          const trx = trxLiteById.get(p.transaction_id);
          return {
            payment_id: p.id,
            transaction_id: p.transaction_id,
            receipt_no: trx?.receipt_no ?? "-",
            customer_name: trx?.customer_name ?? null,
            amount: Number(p.amount ?? 0),
            due_date: p.due_date,
            is_settled: p.is_settled,
            settled_at: p.settled_at,
            status: receivableStatus(p.due_date, p.is_settled),
            created_at: p.created_at,
          };
        });

        if (isCancelled) return;

        setSalesSummary(summaryAcc);
        setDailySales(Array.from(dailyMap.values()));
        setShifts(shiftRows);
        setReceivables(receivableRows);
        setIsLoading(false);
      } catch (err) {
        if (isCancelled) return;
        console.error("useReports load error:", err);
        setError(err instanceof Error ? err.message : "Gagal memuat data laporan.");
        setIsLoading(false);
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [dateRange, reloadToken]);

  const settleReceivable = useCallback(
    async (paymentId: string) => {
      const { data, error: rpcError } = await supabase.rpc("settle_receivable", {
        p_payment_id: paymentId,
      });

      if (rpcError) {
        console.error("settle_receivable RPC error:", rpcError);
        throw new Error(rpcError.message || "Gagal menandai piutang lunas.");
      }

      if (!data?.success) {
        throw new Error("Piutang gagal ditandai lunas.");
      }

      refetch();
    },
    [refetch],
  );

  // Memo supaya identitas objek dateRange tidak berubah tiap render kalau
  // preset-nya tidak berubah (mencegah re-fetch tak perlu di komponen konsumen
  // yang mungkin taruh dateRange di dependency array useEffect sendiri).
  const memoDateRange = useMemo(
    () => dateRange,
    [dateRange.start.getTime(), dateRange.end.getTime()],
  );

  return {
    dateRange: memoDateRange,
    preset,
    setPreset,
    salesSummary,
    dailySales,
    shifts,
    receivables,
    isLoading,
    error,
    refetch,
    settleReceivable,
  };
}