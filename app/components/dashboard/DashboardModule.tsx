"use client";

// ── PENGGANTI STUB (T-06) ── Modul Dashboard (PRD §17 T-06 + §4.8).
// Konsumen tunggal hooks/useDashboard.ts. Semua agregat dihitung di hook —
// komponen ini murni penyaji, tidak melakukan query apa pun sendiri.
//
// Susunan mengikuti pola `HeroSection` + `Dashboard` + `ActionList` (§4.8):
//   1. Hero    — tanggal & jam real-time (font-mono), sapaan, tombol muat ulang.
//   2. Stat    — 4 kartu hari ini + 3 kartu bulan berjalan.
//   3. Grafik  — bar omzet 7/30 hari + pie kategori terlaris (recharts).
//   4. Action  — stok menipis / piutang jatuh tempo / shift belum ditutup,
//                tiap baris bisa diklik menuju modul terkait.
//
// ═══════════════════════════════════════════════════════════════════════════════
// KEPUTUSAN TAMPILAN — WAJIB DIBACA SEBELUM MENGUBAH
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. JAM REAL-TIME TIDAK DI-RENDER SAAT SSR. Komponen ini memang sudah dipanggil
//    dengan `dynamic(..., { ssr: false })` di app/page.tsx, tapi jam tetap dimulai
//    dari state `null` dan baru diisi di useEffect. Alasannya: jam yang dirender
//    langsung akan berbeda antara render pertama dan detik berikutnya, dan pola
//    "isi setelah mount" ini yang aman kalau suatu saat dynamic import-nya diubah.
//
// 2. TOGGLE 7/30 HARI TIDAK MEMANGGIL ULANG DATABASE. Hook selalu mengirim 30
//    titik; tombol di sini hanya memotong array. Lihat keputusan #5 di
//    hooks/useDashboard.ts — ini sengaja, supaya ganti rentang terasa instan.
//
// 3. WARNA GRAFIK MEMAKAI TOKEN TEMA, BUKAN PALET BAWAAN RECHARTS. Recharts perlu
//    nilai warna sebagai string (bukan class Tailwind), jadi hex-nya ditulis di
//    konstanta `CHART_COLORS` di bawah — nilainya HARUS sama persis dengan
//    variabel di app/globals.css (§16.2). Kalau tema berubah, ubah di dua tempat.
//    Ini satu-satunya tempat di modul ini yang boleh memuat hex.
//
// 4. ANGKA NEGATIF DITULIS MERAH CORAL. Omzet harian bisa negatif kalau di hari
//    itu nilai retur melebihi penjualan — itu kondisi nyata, bukan bug, jadi
//    ditampilkan apa adanya alih-alih dipaksa nol.
//
// 5. CHART TIDAK PERNAH DI-UNMOUNT SETELAH DATA PERTAMA KALI ADA (fix layout
//    shift). Sebelumnya `isLoading ? <spinner ukuran beda> : <div className="h-64">
//    <ResponsiveContainer>...`  — ini membongkar total elemen chart tiap kali
//    refetch, dan ResponsiveContainer butuh siklus ekstra untuk mengukur ulang
//    dirinya lewat ResizeObserver saat di-mount lagi. Proses remeasure inilah
//    yang bikin hero section "terdorong" naik/turun tiap klik Muat Ulang.
//    Solusinya: state `hasLoadedOnce` membedakan dua kondisi —
//      - Loading PERTAMA KALI (belum pernah ada data): tampilkan skeleton
//        placeholder dengan tinggi yang SAMA PERSIS dengan chart aslinya
//        (h-64 / h-48), supaya tidak ada reflow begitu chart asli terpasang.
//      - Loading saat REFETCH (sudah pernah ada data): chart TIDAK dibongkar.
//        Data lama tetap tampil, cuma diredupkan dikit + overlay spinner kecil
//        di tengahnya. ResponsiveContainer tidak pernah unmount lagi setelah
//        titik ini, jadi tidak ada remeasure yang memicu layout shift.
//    Pola yang sama diterapkan di tiga tempat: bar chart, pie chart, dan
//    Action List — ketiganya sebelumnya punya masalah identik.
//
// Yang SENGAJA belum ada di sini (bukan bug, scope task lain):
// - Notifikasi push FCM untuk isi Action List — "Jangan dulu" eksplisit (fase 1.1).
// - Filter tanggal custom & export — itu modul Laporan (T-08).
// - Penyembunyian kartu per role — permission matrix §5 adalah scope T-10.
//   Dashboard sendiri memang boleh dilihat SEMUA role (§5 baris `dashboard`),
//   dan isi Action List sudah otomatis menyesuaikan role lewat RLS.

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarDays,
  ChartColumn,
  ChartPie,
  Clock,
  Inbox,
  Loader2,
  Receipt,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  useDashboard,
  type ActionGroup,
  type ActionSeverity,
  type DailyPoint,
  type PeriodStats,
} from "@/hooks/useDashboard";
import { formatRupiah } from "@/lib/pos/cartLogic";

/**
 * Hex tema LCO Flat — HARUS sama dengan app/globals.css §16.2.
 * Recharts tidak bisa memakai class Tailwind, jadi ini pengecualian yang
 * disengaja terhadap larangan hardcode hex.
 */
const CHART_COLORS = {
  teal: "#49bfb4",
  green: "#124540",
  coral: "#f4435e",
  // ── KOREKSI (theme-guide.md §7) ── Sebelumnya "#e4e596" (kuning pucat,
  // tidak match hex manapun di app/globals.css) — token resmi lco-mustard
  // adalah #E45742. Nilai lama membuat grafik & pie diam-diam memakai warna
  // di luar 5 palet resmi (pelanggaran §0.1) tanpa ada yang sadar karena
  // hasilnya masih "kelihatan oranye-ish".
  mustard: "#E45742",
  zinc: "#a1a1aa",
} as const;

/**
 * Urutan warna irisan pie saat kategori tidak punya warna sendiri di database.
 * Urutan mengikuti CHART_SERIES di theme-guide.md §7 (green → teal → mustard
 * → coral, zinc terakhir khusus label/"Lainnya") supaya konsisten dengan
 * palet chart resmi di seluruh app, bukan urutan teal-dulu yang sebelumnya.
 */
const PIE_FALLBACK = [
  CHART_COLORS.green,
  CHART_COLORS.teal,
  CHART_COLORS.mustard,
  CHART_COLORS.coral,
  CHART_COLORS.zinc,
];

/** Kategori sisanya digabung jadi satu irisan supaya pie tetap terbaca. */
const PIE_MAX_SLICES = 5;

type ChartRange = 7 | 30;

/** Menu tujuan Action List — harus cocok dengan `activeMenu` di app/page.tsx. */
export type DashboardTargetMenu = ActionGroup["targetMenu"];

interface DashboardModuleProps {
  /**
   * Dipanggil saat baris Action List diklik. Opsional supaya komponen tetap bisa
   * dirender sendirian (mis. saat pengembangan) tanpa wiring menu — kalau tidak
   * diberikan, kartunya tetap tampil tapi tidak bisa diklik.
   */
  onNavigate?: (menu: DashboardTargetMenu) => void;
}

// ── Util tampilan ────────────────────────────────────────────────────────────

function greeting(hour: number): string {
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 18) return "Selamat sore";
  return "Selamat malam";
}

/** Angka uang: negatif ditulis coral (lihat keputusan #4 di header). */
function moneyColorClass(amount: number): string {
  if (amount < 0) return "text-lco-coral";
  return "text-zinc-900 dark:text-zinc-100";
}

function severityTextClass(severity: ActionSeverity): string {
  switch (severity) {
    case "danger":
      return "text-lco-coral";
    case "warning":
      return "text-lco-mustard";
    default:
      return "text-lco-teal";
  }
}

/**
 * ── TAMBAHAN (theme-guide.md §2 & §6.2) ── Badge count di header ActionCard.
 * Aturan §2 wajib: "danger" harus solid (coral solid + teks putih), "warning"
 * harus soft (tint + border, BUKAN solid fill) — dua warna itu berdekatan hue
 * jadi solid-vs-soft ini satu-satunya cara membedakan error vs warning tanpa
 * nambah warna baru. "info"/default pakai gaya soft teal biasa.
 */
function severityBadgeClass(severity: ActionSeverity): string {
  switch (severity) {
    case "danger":
      return "bg-lco-coral text-white";
    case "warning":
      return "bg-lco-mustard/15 text-lco-mustard border border-lco-mustard/30";
    default:
      return "bg-lco-teal/15 text-lco-teal";
  }
}

function actionIcon(kind: ActionGroup["kind"]) {
  switch (kind) {
    case "low_stock":
      return Boxes;
    case "due_receivable":
      return Receipt;
    default:
      return Wallet;
  }
}

/** Label tombol menuju modul terkait, per jenis action. */
function actionCta(kind: ActionGroup["kind"]): string {
  switch (kind) {
    case "low_stock":
      return "Buka Stok & Opname";
    case "due_receivable":
      return "Buka Riwayat Transaksi";
    default:
      return "Buka Kas & Shift";
  }
}

// ── Overlay loading kecil untuk refetch (fix layout shift, keputusan #5) ─────
// Dipakai di atas konten yang SUDAH pernah tampil, jadi tidak pernah membongkar
// elemen di baliknya — cuma menumpuk spinner tipis dengan `absolute inset-0`.
function RefetchOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/60 backdrop-blur-[1px] dark:bg-zinc-950/60">
      <Loader2 className="h-5 w-5 animate-spin text-lco-teal" />
    </div>
  );
}

// ── Kartu stat ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accentClass = "text-zinc-900 dark:text-zinc-100",
  hint,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass?: string;
  hint?: string;
}) {
  return (
    // ── PERUBAHAN (theme-guide.md §6.4) ── Sebelumnya `bg-white dark:bg-zinc-950`
    // polos — dokumen tema secara eksplisit menyebut kartu ringkasan/statistik
    // Dashboard sebagai kandidat wash brand tipis (§6.4, poin "Card
    // ringkasan/statistik"). Opacity rendah (/5, /10) dipakai karena kartu ini
    // berulang (4-7 per layar) — wash lebih berani disediakan untuk elemen
    // besar/tunggal, bukan grid yang diulang (lihat catatan panduan di §6.4).
    <div className="rounded-xl border border-lco-teal/20 bg-lco-teal/5 p-4 dark:bg-lco-teal/10">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p
        className={`mt-2 font-mono text-2xl font-semibold leading-none tabular-nums ${accentClass}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

// ── Kartu stat versi "kaca" untuk di dalam hero gradient ───────────────────
// Sengaja komponen terpisah dari StatCard (bukan varian prop) — background,
// border, dan warna teks defaultnya dibuat untuk kontras di atas gradient
// lco-green→lco-teal (§4.1), beda total dari StatCard yang didesain untuk
// wash tipis di atas background halaman biasa (§6.4).
function HeroStat({
  label,
  value,
  icon: Icon,
  valueClass = "text-white",
  hint,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/60">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p
        className={`mt-1.5 font-mono text-lg font-semibold leading-none tabular-nums ${valueClass}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[10px] text-white/50">{hint}</p>}
    </div>
  );
}

interface TooltipPayloadEntry {
  payload?: { label?: string; name?: string; revenue?: number; value?: number };
}

function ChartTooltip({
  active,
  payload,
  valueLabel,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  valueLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const row = payload[0]?.payload;
  if (!row) return null;

  const amount = row.revenue ?? row.value ?? 0;

  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">
        {row.label ?? row.name}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
        {valueLabel}
      </p>
      <p
        className={`font-mono text-sm font-semibold tabular-nums ${moneyColorClass(amount)}`}
      >
        {formatRupiah(amount)}
      </p>
    </div>
  );
}

// ── Kartu Action List ────────────────────────────────────────────────────────

function ActionCard({
  group,
  onNavigate,
}: {
  group: ActionGroup;
  onNavigate?: (menu: DashboardTargetMenu) => void;
}) {
  const Icon = actionIcon(group.kind);
  const sisa = group.count - group.entries.length;
  const isClickable = !!onNavigate;

  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          <Icon
            className={`h-3.5 w-3.5 ${severityTextClass(group.severity)}`}
          />
          {group.title}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${severityBadgeClass(group.severity)}`}
        >
          {group.count}
        </span>
      </div>

      <ul className="mt-3 flex-1 space-y-2">
        {group.entries.map((entry) => (
          <li
            key={`${group.kind}-${entry.title}-${entry.detail}`}
            className="border-b border-zinc-100 pb-2 last:border-0 last:pb-0 dark:border-zinc-900"
          >
            <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
              {entry.title}
            </p>
            <p className="truncate text-[11px] text-zinc-500">{entry.detail}</p>
          </li>
        ))}
      </ul>

      {sisa > 0 && (
        <p className="mt-2 font-mono text-[11px] tabular-nums text-zinc-400">
          +{sisa} lainnya
        </p>
      )}

      {isClickable && (
        <button
          type="button"
          onClick={() => onNavigate?.(group.targetMenu)}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors duration-150 hover:border-lco-teal hover:text-lco-teal dark:border-zinc-800 dark:text-zinc-400"
        >
          {actionCta(group.kind)}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Modul ────────────────────────────────────────────────────────────────────

export default function DashboardModule({ onNavigate }: DashboardModuleProps) {
  const {
    today,
    month,
    daily,
    categories,
    actions,
    isLoading,
    error,
    refetch,
    lastUpdatedAt,
  } = useDashboard();

  const [range, setRange] = useState<ChartRange>(7);

  // Jam real-time. Dimulai null supaya tidak ada selisih antara render pertama
  // dan detik berikutnya (lihat keputusan #1 di header).
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── TAMBAHAN (fix layout shift, keputusan #5) ── Menandai apakah data
  // pertama kali sudah pernah berhasil dimuat. Sekali `true`, tidak pernah
  // kembali `false` lagi — jadi refetch berikutnya (klik "Muat Ulang") tidak
  // akan membongkar chart, hanya menumpuk overlay spinner tipis di atasnya.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    if (!isLoading) setHasLoadedOnce(true);
  }, [isLoading]);

  // Loading yang dimaksud "pertama kali, belum ada apa-apa untuk ditampilkan".
  // Hanya kondisi INI yang boleh mengganti chart dengan skeleton kosong.
  const isInitialLoading = isLoading && !hasLoadedOnce;
  // Loading di atas data yang sudah ada (refetch) — chart tetap terpasang,
  // cuma dapat overlay spinner tipis (lihat RefetchOverlay).
  const isRefetching = isLoading && hasLoadedOnce;

  // Potong deret harian sesuai rentang yang dipilih — tanpa query ulang.
  const chartData: DailyPoint[] = useMemo(
    () => daily.slice(-range),
    [daily, range],
  );

  const chartTotal = useMemo(
    () => chartData.reduce((total, point) => total + point.revenue, 0),
    [chartData],
  );

  // Kategori di luar 5 besar digabung jadi "Lainnya" supaya pie tetap terbaca.
  const pieData = useMemo(() => {
    if (categories.length <= PIE_MAX_SLICES) return categories;

    const utama = categories.slice(0, PIE_MAX_SLICES - 1);
    const sisa = categories.slice(PIE_MAX_SLICES - 1);
    const nilaiSisa = sisa.reduce((total, slice) => total + slice.value, 0);

    return [
      ...utama,
      {
        categoryId: null,
        name: `Lainnya (${sisa.length} kategori)`,
        value: nilaiSisa,
        color: null,
      },
    ];
  }, [categories]);

  const pieTotal = useMemo(
    () => pieData.reduce((total, slice) => total + slice.value, 0),
    [pieData],
  );

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("id-ID", {
        month: "long",
        year: "numeric",
      }).format(now ?? new Date()),
    [now],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      {/* ---------------- Hero: tanggal & jam real-time ---------------- */}
      {/* ── FIX (layout shift: hero tersusut & terpotong) ── Root wrapper di atas
          adalah `flex flex-col overflow-y-auto` (lihat baris return utama). Div
          Hero ini punya `overflow-hidden` untuk membungkus lingkaran dekoratif —
          tapi menurut spesifikasi Flexbox, begitu sebuah flex-item diberi
          `overflow` selain `visible`, ukuran minimum otomatisnya berubah jadi 0
          (bukan konten intrinsiknya). Akibatnya, saat total tinggi konten
          (setelah chart & action list asli dimuat) melebihi tinggi kontainer,
          Hero — satu-satunya section dengan overflow-hidden langsung di
          wrapper-nya — jadi satu-satunya yang "boleh" disusutkan algoritma flex,
          alih-alih membiarkan kontainer luar yang scroll (overflow-y-auto) yang
          menangani kelebihan tinggi seperti seharusnya. Karena Hero sendiri
          overflow-hidden, bagian yang tidak muat itu ke-crop — persis gejala
          "hero terdorong ke atas & terpotong". `shrink-0` mengunci Hero supaya
          selalu memakai tinggi konten aslinya dan mengecualikannya dari
          perhitungan shrink flex. */}
      <div className="relative mb-6 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-lco-green to-lco-teal px-5 py-6 text-white md:px-8 md:py-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-lco-teal/25"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-12 h-64 w-64 rounded-full bg-lco-teal/15"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-1/4 h-28 w-28 -translate-y-1/2 rounded-full border border-white/10"
        />

        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lco-teal">
              Utama
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">
              {now ? greeting(now.getHours()) : "Dashboard"}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="font-mono tabular-nums">
                  {now
                    ? new Intl.DateTimeFormat("id-ID", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }).format(now)
                    : "—"}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span className="font-mono tabular-nums">
                  {now
                    ? new Intl.DateTimeFormat("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: false,
                      }).format(now)
                    : "--:--:--"}
                </span>
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdatedAt && (
              <p className="hidden text-[11px] text-white/60 sm:block">
                Diperbarui{" "}
                <span className="font-mono tabular-nums">
                  {new Intl.DateTimeFormat("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }).format(lastUpdatedAt)}
                </span>
              </p>
            )}
            <button
              type="button"
              onClick={refetch}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-white/20 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Muat Ulang
            </button>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <HeroStat
            label="Omzet"
            value={formatRupiah(today.revenue)}
            icon={TrendingUp}
            valueClass={today.revenue < 0 ? "text-lco-coral" : "text-white"}
            hint="Sudah dikurangi retur"
          />
          <HeroStat
            label="Transaksi"
            value={String(today.transactionCount)}
            icon={Receipt}
          />
          <HeroStat
            label="Item Terjual"
            value={String(today.itemsSold)}
            icon={ShoppingBag}
          />
          <HeroStat
            label="Rata-rata"
            value={formatRupiah(today.averageTicket)}
            icon={Wallet}
            hint="Per transaksi"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ---------------- Stat bulan berjalan ---------------- */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
        Bulan {monthLabel}
      </p>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Omzet Bulan Ini"
          value={formatRupiah(month.revenue)}
          icon={TrendingUp}
          accentClass={moneyColorClass(month.revenue)}
        />
        <StatCard
          label="Transaksi"
          value={String(month.transactionCount)}
          icon={Receipt}
          hint={`${month.itemsSold} item terjual`}
        />
        <StatCard
          label="Rata-rata"
          value={formatRupiah(month.averageTicket)}
          icon={Wallet}
          hint="Per transaksi"
        />
      </div>

      {/* ---------------- Grafik ---------------- */}
      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Bar: omzet harian */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                <ChartColumn className="h-3.5 w-3.5" />
                Omzet {range} Hari Terakhir
              </p>
              <p
                className={`mt-2 font-mono text-xl font-semibold leading-none tabular-nums ${moneyColorClass(chartTotal)}`}
              >
                {formatRupiah(chartTotal)}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              {([7, 30] as ChartRange[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={`rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium tabular-nums transition-colors duration-150 ${
                    range === option
                      ? "border-lco-teal text-lco-teal"
                      : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
                  }`}
                >
                  {option} Hari
                </button>
              ))}
            </div>
          </div>

          {/* ── FIX (keputusan #5) ── Sebelumnya `isLoading ? spinner-h64 :
              <div className="h-64">chart</div>` — chart dibongkar total tiap
              refetch. Sekarang skeleton HANYA di loading pertama kali; setelah
              itu chart tetap terpasang selamanya dan cuma dapat overlay. */}
          {isInitialLoading ? (
            <div className="flex h-64 items-center justify-center text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="relative h-64">
              {isRefetching && <RefetchOverlay />}
              <div
                className={`h-full transition-opacity duration-150 ${
                  isRefetching ? "opacity-40" : "opacity-100"
                }`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                  >
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval={range === 30 ? 4 : 0}
                      tick={{ fontSize: 10, fill: CHART_COLORS.zinc }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tick={{ fontSize: 10, fill: CHART_COLORS.zinc }}
                      tickFormatter={(value: number) =>
                        value === 0
                          ? "0"
                          : `${Math.round(value / 1000).toLocaleString("id-ID")}k`
                      }
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(73, 191, 180, 0.08)" }}
                      content={<ChartTooltip valueLabel="Omzet bersih" />}
                    />
                    <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>
                      {chartData.map((point) => (
                        <Cell
                          key={point.date}
                          fill={
                            point.revenue < 0
                              ? CHART_COLORS.coral
                              : CHART_COLORS.teal
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Pie: kategori terlaris */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            <ChartPie className="h-3.5 w-3.5" />
            Kategori Terlaris
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">30 hari terakhir</p>

          {/* ── FIX (keputusan #5) ── Sama seperti bar chart: skeleton cuma di
              loading pertama kali. Kondisi "belum ada penjualan" tetap dicek
              setelahnya, tapi sekarang tidak akan pernah salah tampil sebagai
              "belum ada penjualan" saat sebenarnya masih memuat data awal. */}
          {isInitialLoading ? (
            <div className="flex h-48 items-center justify-center text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : pieData.length === 0 ? (
            <div className="relative flex h-48 flex-col items-center justify-center text-center text-zinc-400">
              {isRefetching && <RefetchOverlay />}
              <Inbox className="mb-2 h-5 w-5" />
              <p className="text-xs">Belum ada penjualan</p>
            </div>
          ) : (
            <div className="relative">
              {isRefetching && <RefetchOverlay />}
              <div
                className={`transition-opacity duration-150 ${
                  isRefetching ? "opacity-40" : "opacity-100"
                }`}
              >
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="85%"
                        paddingAngle={1}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {pieData.map((slice, index) => (
                          <Cell
                            key={`${slice.categoryId ?? "none"}-${index}`}
                            fill={
                              slice.color ??
                              PIE_FALLBACK[index % PIE_FALLBACK.length]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={<ChartTooltip valueLabel="Nilai penjualan" />}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Legenda dibuat manual — legenda bawaan recharts tidak bisa
                    menampilkan angka dengan font-mono tabular-nums (§16.3). */}
                <ul className="mt-3 space-y-1.5">
                  {pieData.map((slice, index) => {
                    const persen =
                      pieTotal > 0
                        ? Math.round((slice.value / pieTotal) * 100)
                        : 0;

                    return (
                      <li
                        key={`${slice.categoryId ?? "none"}-legend-${index}`}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-sm"
                          style={{
                            backgroundColor:
                              slice.color ??
                              PIE_FALLBACK[index % PIE_FALLBACK.length],
                          }}
                        />
                        <span className="flex-1 truncate text-zinc-600 dark:text-zinc-400">
                          {slice.name}
                        </span>
                        <span className="font-mono tabular-nums text-zinc-400">
                          {persen}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Action List ---------------- */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
        Perlu Perhatian
      </p>

      {/* ── FIX (keputusan #5) ── Pola sama: skeleton (tinggi kira-kira setara
          kartu action, dipakai `py-10` seperti aslinya) cuma di loading
          pertama kali; refetch berikutnya menumpuk overlay di atas grid yang
          sudah ada, tanpa membongkar dan memasang ulang gridnya. */}
      {isInitialLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-zinc-200 bg-white py-10 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : actions.length === 0 ? (
        <div className="relative flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
          {isRefetching && <RefetchOverlay />}
          <Inbox className="mb-2 h-5 w-5 text-zinc-300 dark:text-zinc-700" />
          <p className="text-sm text-zinc-500">Tidak ada yang perlu ditindak</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Stok aman, tidak ada piutang jatuh tempo, semua shift sudah ditutup.
          </p>
        </div>
      ) : (
        <div className="relative pb-2">
          {isRefetching && <RefetchOverlay />}
          <div
            className={`grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 transition-opacity duration-150 ${
              isRefetching ? "opacity-40" : "opacity-100"
            }`}
          >
            {actions.map((group) => (
              <ActionCard
                key={group.kind}
                group={group}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
