"use client";

// Halaman PUBLIK (tanpa login) — PRD §4.9, §17 T-07.
// Sudah dikecualikan di middleware.ts (lihat PUBLIC_PATHS), jadi halaman ini
// TIDAK boleh mengasumsikan ada sesi/user sama sekali.
//
// Sengaja tidak memakai hooks/useAuth atau komponen modul internal manapun —
// halaman ini berdiri sendiri, satu-satunya sumber data adalah RPC
// `get_transaction_by_receipt` (migration 010_public_receipt_lookup.sql),
// yang SECURITY DEFINER dan hanya membalas kalau nomor struk + tanggal cocok.
//
// Tidak menampilkan harga modal, nama kasir, nomor referensi transfer, atau
// bukti pembayaran — RPC memang tidak pernah mengirim field-field itu (lihat
// komentar di migration), jadi tidak ada risiko halaman ini "lupa
// menyembunyikan" sesuatu yang seharusnya rahasia.

import { useState, type FormEvent } from "react";
import { Loader2, Search, ReceiptText, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/pos/cartLogic";

const supabase = createClient();

type LookupStatus = "PAID" | "VOID" | "RETURN";

interface LookupItem {
  product_name: string;
  unit: string | null;
  qty: number;
  returned_qty: number;
  unit_price: number;
  subtotal: number;
}

interface LookupResult {
  success: boolean;
  message?: string;
  receipt_no: string;
  status: LookupStatus;
  created_at: string;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  void_reason: string | null;
  is_return_row: boolean;
  payment_method: string | null;
  items: LookupItem[];
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(isoString));
}

function methodLabel(method: string | null): string {
  const labels: Record<string, string> = {
    CASH: "Tunai",
    BANK_TRANSFER: "Transfer Bank",
    QRIS: "QRIS",
    TEMPO: "Tempo / Piutang",
  };
  if (!method) return "-";
  return labels[method] ?? method;
}

function statusBadge(
  status: LookupStatus,
  isReturnRow: boolean,
): {
  label: string;
  className: string;
} {
  // Baris RETURN bisa berarti 2 hal berbeda (lihat catatan bug di PROGRESS.md):
  // transaksi ASLI yang statusnya berubah jadi RETURN setelah diretur (sebagian
  // atau penuh), ATAU baris retur itu sendiri (is_return_row = true, nomor
  // LCO-RTR/...). Labelnya dibedakan supaya pelanggan tidak bingung.
  if (status === "VOID") {
    return {
      label: "Dibatalkan (Void)",
      className: "bg-lco-coral/10 text-lco-coral border-lco-coral/30",
    };
  }
  if (status === "RETURN") {
    return isReturnRow
      ? {
          label: "Nota Retur",
          className:
            "bg-lco-mustard/20 text-zinc-700 dark:text-lco-mustard border-lco-mustard/40",
        }
      : {
          label: "Sudah Diretur (Sebagian/Penuh)",
          className:
            "bg-lco-mustard/20 text-zinc-700 dark:text-lco-mustard border-lco-mustard/40",
        };
  }
  return {
    label: "Lunas / Selesai",
    className: "bg-lco-teal/10 text-lco-teal border-lco-teal/30",
  };
}

export default function CekStrukPage() {
  const [receiptNo, setReceiptNo] = useState("");
  const [date, setDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!receiptNo.trim() || !date) {
      setErrorMessage("Nomor struk dan tanggal transaksi wajib diisi.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const { data, error } = await supabase.rpc("get_transaction_by_receipt", {
        p_receipt_no: receiptNo.trim(),
        p_date: date,
      });

      if (error) {
        console.error("get_transaction_by_receipt error:", error);
        setErrorMessage(
          "Terjadi gangguan saat memeriksa struk. Coba lagi sebentar lagi.",
        );
        return;
      }

      const parsed = data as LookupResult;

      if (!parsed?.success) {
        setErrorMessage(
          parsed?.message ??
            "Struk tidak ditemukan. Periksa kembali nomor struk dan tanggal transaksi.",
        );
        return;
      }

      setResult(parsed);
    } catch (err) {
      console.error("Cek struk error:", err);
      setErrorMessage(
        "Terjadi gangguan saat memeriksa struk. Coba lagi sebentar lagi.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  const badge = result
    ? statusBadge(result.status, result.is_return_row)
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 mb-1">
            LCO POS
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            Cek Struk
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Masukkan nomor struk dan tanggal transaksi untuk melihat rincian
            &amp; status pesanan.
          </p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">
                Nomor Struk
              </label>
              <input
                type="text"
                required
                autoComplete="off"
                placeholder="LCO-STR/26/09/000123"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm font-mono text-zinc-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">
                Tanggal Transaksi
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm font-mono tabular-nums text-zinc-900 dark:text-white"
              />
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{errorMessage}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 rounded-md bg-lco-green hover:bg-lco-green-hover text-white text-sm font-semibold transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Cek Struk
            </button>
          </form>
        </div>

        {result && badge && (
          <div className="mt-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-1.5 text-zinc-400 mb-1">
                  <ReceiptText className="w-3.5 h-3.5" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold">
                    Nomor Struk
                  </span>
                </div>
                <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-white break-all">
                  {result.receipt_no}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {formatDate(result.created_at)}
                </p>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold ${badge.className}`}
              >
                {badge.label}
              </span>
            </div>

            {result.status === "VOID" && result.void_reason && (
              <div className="mb-4 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                Alasan pembatalan: {result.void_reason}
              </div>
            )}

            {result.customer_name && (
              <p className="text-xs text-zinc-500 mb-4">
                Atas nama:{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {result.customer_name}
                </span>
              </p>
            )}

            <div className="space-y-2 mb-4">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 block">
                Rincian Barang
              </span>
              {result.items.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">
                  Tidak ada rincian barang untuk struk ini.
                </p>
              ) : (
                result.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 text-xs border-b border-zinc-100 dark:border-zinc-800 pb-2 last:border-0 last:pb-0"
                  >
                    <div className="flex-1">
                      <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {item.product_name}
                      </p>
                      <p className="font-mono tabular-nums text-zinc-400">
                        {item.qty} {item.unit ?? ""} ×{" "}
                        {formatRupiah(item.unit_price)}
                        {item.returned_qty > 0 && (
                          <span className="text-lco-mustard">
                            {" "}
                            · {item.returned_qty} sudah diretur
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="font-mono tabular-nums font-medium text-zinc-900 dark:text-white shrink-0">
                      {formatRupiah(item.subtotal)}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-1 text-xs border-t border-zinc-200 dark:border-zinc-800 pt-3">
              <div className="flex justify-between text-zinc-500">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(result.subtotal)}
                </span>
              </div>
              {result.discount > 0 && (
                <div className="flex justify-between text-zinc-500">
                  <span>Diskon</span>
                  <span className="font-mono tabular-nums">
                    -{formatRupiah(result.discount)}
                  </span>
                </div>
              )}
              {result.tax > 0 && (
                <div className="flex justify-between text-zinc-500">
                  <span>Pajak</span>
                  <span className="font-mono tabular-nums">
                    {formatRupiah(result.tax)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold text-zinc-900 dark:text-white pt-1">
                <span>Total</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(result.total)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-500 pt-1">
                <span>Metode Pembayaran</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {methodLabel(result.payment_method)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
