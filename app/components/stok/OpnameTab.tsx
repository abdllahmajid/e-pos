// app/components/stok/OpnameTab.tsx
// ── TAMBAHAN (Fase 2 perbaikan Stok & Opname) ── Tab "Sesi Opname": daftar sesi
// + tombol mulai sesi baru, dan membuka layar hitung (OpnameSessionDetail)
// untuk sesi yang dipilih. Tombol "Penyesuaian Cepat" di header menu Stok tetap
// ada untuk koreksi satu produk tanpa sesi.

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  Inbox,
  Loader2,
  Plus,
} from "lucide-react";
import { useOpnameSessions } from "@/hooks/useOpname";
import { useCategories } from "@/hooks/useCategories";
import type { ProductWithCategory } from "@/hooks/useProducts";
import { OpnameStartModal } from "./OpnameModals";
import OpnameSessionDetail from "./OpnameSessionDetail";
import { OPNAME_STATUS_LABEL, opnameStatusColorClass } from "./opnameUtils";
import {
  deltaColorClass,
  formatDateTime,
  formatNumber,
  formatRupiah,
} from "./stokUtils";

interface OpnameTabProps {
  products: ProductWithCategory[];
  /** Boleh memulai sesi & mengisi hitungan (izin stok:edit). */
  canEdit: boolean;
  /** Dipanggil saat stok berubah (sesi selesai). */
  onStockChanged: () => void;
}

export default function OpnameTab({
  products,
  canEdit,
  onStockChanged,
}: OpnameTabProps) {
  const { sessions, isLoading, error, refetch, startSession } =
    useOpnameSessions();
  const { categories } = useCategories();

  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);

  if (openSessionId) {
    return (
      <OpnameSessionDetail
        sessionId={openSessionId}
        canEdit={canEdit}
        onBack={() => setOpenSessionId(null)}
        onStockChanged={onStockChanged}
        onSessionChanged={refetch}
      />
    );
  }

  const cardClass =
    "rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-zinc-500">
          Mulai sesi, hitung atau scan produk, tinjau selisih, lalu terapkan ke
          stok sekaligus.
        </p>

        {canEdit && (
          <button
            type="button"
            onClick={() => setShowStart(true)}
            className="flex items-center justify-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
          >
            <Plus className="h-4 w-4" />
            Mulai Opname Baru
          </button>
        )}
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat sesi opname...
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-sm text-lco-coral">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Belum ada sesi opname.
            </p>
            {canEdit && (
              <p className="mt-1 text-xs text-zinc-400">
                Klik Mulai Opname Baru untuk menghitung stok fisik.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-3">Sesi</th>
                  <th className="px-4 py-3">Cakupan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Progres</th>
                  <th className="px-4 py-3 text-right">Selisih</th>
                  <th className="px-4 py-3">Dibuat</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    onClick={() => setOpenSessionId(session.id)}
                    className="cursor-pointer transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-1.5 font-medium">
                        <ClipboardList className="h-3.5 w-3.5 text-zinc-400" />
                        #{session.number} · {session.name}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {session.category_name ?? "Semua produk"}
                    </td>
                    <td
                      className={`px-4 py-3 text-xs font-semibold ${opnameStatusColorClass(session.status)}`}
                    >
                      {OPNAME_STATUS_LABEL[session.status]}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {formatNumber(session.counted_count)} /{" "}
                      {formatNumber(session.item_count)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      <span className={deltaColorClass(session.diff_qty)}>
                        {session.diff_qty > 0 ? "+" : ""}
                        {formatNumber(session.diff_qty)} unit
                      </span>
                      {session.diff_value !== 0 && (
                        <span className="block text-[11px] text-zinc-400">
                          {session.diff_value > 0 ? "+" : "-"}
                          {formatRupiah(Math.abs(session.diff_value))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {formatDateTime(session.created_at)}
                      {session.created_by_name && (
                        <span className="block text-[11px] text-zinc-400">
                          {session.created_by_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showStart && (
        <OpnameStartModal
          products={products}
          categories={categories}
          onClose={() => setShowStart(false)}
          onStart={async (params) => {
            const started = await startSession(params);
            setShowStart(false);
            setOpenSessionId(started.sessionId);
          }}
        />
      )}
    </div>
  );
}
