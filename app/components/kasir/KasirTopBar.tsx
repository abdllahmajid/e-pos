// app/components/kasir/KasirTopBar.tsx
// ── TAMBAHAN (Kasir full-screen, 2 layout: Tablet & PC) ── Bar paling atas di
// layar Kasir: Menu/Pending di kiri, nama toko di tengah, Tutup Sesi Kas/
// Layout/Display di kanan. Dipakai di mode Tablet (variant "strip", bar
// setipis garis di atas layar) DAN mode PC (variant "card", kartu sendiri
// dengan border & sudut membulat seperti di screenshot rujukan).
//
// ── PERBAIKAN (layout PC dirapikan) ── Judul (nama toko) sekarang benar-
// benar di TENGAH kartu: pakai grid 3 kolom `1fr auto 1fr`, bukan
// `justify-between` (yang menggeser judul kalau lebar grup tombol kiri &
// kanan tidak sama).
//
// Sengaja "dumb" — semua data & handler dikirim lewat props dari
// KasirModule.tsx (satu-satunya pemilik state sesi/keranjang/dll).

"use client";

import { ArrowLeft, Pause, Lock, LayoutGrid, Monitor } from "lucide-react";

interface KasirTopBarProps {
  storeName: string;
  onOpenMenu?: () => void;
  heldOrdersCount: number;
  onOpenHeldList: () => void;
  onCloseShift?: () => void;
  layoutMode: "tablet" | "pc";
  onToggleLayout: () => void;
  onOpenDisplay: () => void;
  /** "card" = kartu berdiri sendiri (mode PC). "strip" = bar tipis (mode Tablet). */
  variant?: "strip" | "card";
}

export default function KasirTopBar({
  storeName,
  onOpenMenu,
  heldOrdersCount,
  onOpenHeldList,
  onCloseShift,
  layoutMode,
  onToggleLayout,
  onOpenDisplay,
  variant = "strip",
}: KasirTopBarProps) {
  const isCard = variant === "card";

  const containerClass = isCard
    ? "grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
    : "grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950";

  const btnSize = isCard ? "px-3 py-1.5 text-xs" : "px-2.5 py-1.5 text-xs";
  const iconSize = "h-3.5 w-3.5";
  const btnBase = `flex items-center gap-2 rounded-lg border font-semibold transition-colors duration-150 ${btnSize}`;
  const btnNeutral = `${btnBase} border-zinc-200 text-zinc-700 hover:border-lco-teal hover:text-lco-teal dark:border-zinc-800 dark:text-zinc-200`;

  return (
    <div className={containerClass}>
      <div className="flex items-center gap-2 justify-self-start">
        {onOpenMenu && (
          <button onClick={onOpenMenu} className={btnNeutral}>
            <ArrowLeft className={iconSize} />
            Menu
          </button>
        )}
        <button
          onClick={onOpenHeldList}
          title="Pesanan Tertunda"
          className={`${btnBase} border-zinc-200 text-zinc-700 hover:border-lco-mustard dark:border-zinc-800 dark:text-zinc-200`}
        >
          <Pause className={`${iconSize} text-lco-mustard`} />
          Pending
          {heldOrdersCount > 0 && (
            <span className="rounded-full bg-lco-mustard px-1.5 text-[10px] font-bold tabular-nums text-white">
              {heldOrdersCount}
            </span>
          )}
        </button>
      </div>

      <h1
        className={
          isCard
            ? "truncate text-center font-mono text-lg font-bold uppercase tracking-[0.2em] text-lco-green dark:text-lco-teal"
            : "truncate text-center text-base font-bold uppercase tracking-widest text-zinc-800 dark:text-zinc-100"
        }
      >
        {storeName}
      </h1>

      <div className="flex items-center gap-2 justify-self-end">
        {onCloseShift && (
          <button
            onClick={onCloseShift}
            className={`${btnBase} border-lco-coral/40 bg-lco-coral/5 text-lco-coral hover:bg-lco-coral/10`}
          >
            <Lock className={iconSize} />
            Tutup Sesi Kas
          </button>
        )}
        <button
          onClick={onToggleLayout}
          title={`Tampilan sekarang: ${layoutMode.toUpperCase()} — klik untuk ganti`}
          className={btnNeutral}
        >
          <LayoutGrid className={iconSize} />
          Layout
        </button>
        <button
          onClick={onOpenDisplay}
          title="Buka layar display pelanggan (monitor kedua)"
          className={btnNeutral}
        >
          <Monitor className={iconSize} />
          Display
        </button>
      </div>
    </div>
  );
}
