"use client";

// ── TAMBAHAN (menu Pelanggan) ── Form daftar / ubah pelanggan, sengaja
// SEDERHANA seperti pendaftaran member minimarket: cukup no. HP (wajib),
// nama opsional. Validasi format ada di toPayload() hooks/useCustomerAdmin.ts.
// No. HP yang sudah terdaftar DITOLAK di sini (no. HP = identitas member,
// dan dipakai mengaitkan riwayat transaksi).

import { useMemo, useState } from "react";
import { Loader2, X, AlertTriangle } from "lucide-react";
import {
  isNamelessCustomer,
  normalizePhone,
  type CustomerFormValues,
  type CustomerRecord,
} from "@/hooks/useCustomerAdmin";

interface PelangganFormModalProps {
  /** null = mode tambah, ada isi = mode ubah. */
  customer: CustomerRecord | null;
  /** Dipakai cek no. HP kembar. */
  existing: CustomerRecord[];
  onClose: () => void;
  onSubmit: (values: CustomerFormValues) => Promise<void>;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export default function PelangganFormModal({
  customer,
  existing,
  onClose,
  onSubmit,
}: PelangganFormModalProps) {
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [name, setName] = useState(
    customer && !isNamelessCustomer(customer) ? customer.name : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const duplicate = useMemo(() => {
    const key = normalizePhone(phone);
    if (key.length < 9) return null;
    return (
      existing.find(
        (c) => c.id !== customer?.id && normalizePhone(c.phone) === key,
      ) ?? null
    );
  }, [phone, existing, customer?.id]);

  async function handleSubmit() {
    setError("");
    if (duplicate) {
      setError("No. HP ini sudah terdaftar.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ phone, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {customer ? "Ubah Pelanggan" : "Daftarkan Pelanggan"}
          </h3>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              No. HP / WhatsApp <span className="text-lco-coral">*</span>
            </label>
            <input
              className={inputClass}
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !saving && handleSubmit()}
              placeholder="08xxxxxxxxxx"
              autoFocus
            />
          </div>

          {duplicate && (
            <div className="flex items-start gap-2 rounded-md bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No. HP ini sudah terdaftar
                {isNamelessCustomer(duplicate) ? (
                  "."
                ) : (
                  <>
                    {" "}
                    atas nama <strong>{duplicate.name}</strong>.
                  </>
                )}
              </span>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Nama <span className="font-normal text-zinc-400">(opsional)</span>
            </label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !saving && handleSubmit()}
              placeholder="Boleh dikosongkan"
            />
          </div>

          {error && (
            <p className="rounded-md bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !!duplicate}
            className="inline-flex items-center gap-2 rounded-md bg-lco-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-lco-green-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {customer ? "Simpan" : "Daftarkan"}
          </button>
        </div>
      </div>
    </div>
  );
}
