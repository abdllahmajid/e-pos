// hooks/useSettings.ts
// ── TAMBAHAN ── Hook domain Settings (PRD §17 T-01): baca tabel key-value `settings`
// (migration 005_settings.sql) dan parse jadi objek typed, dipakai di seluruh app.
// Konsumen pertama: KasirModule.tsx & PaymentModal.tsx (baris PPN muncul/hilang
// sesuai `ppn_enabled` — lihat Definition of Done T-01). UI Pengaturan sendiri
// menyusul di T-10 — hook ini sudah menyediakan `updateSetting` untuk dipakai nanti,
// supaya T-10 tidak perlu bongkar hook ini lagi.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

// Baris asli tabel `settings` (migration 005) — key-value, value disimpan jsonb.
interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** Bentuk siap-pakai di client, sudah di-parse dari jsonb & diberi nama camelCase. */
export interface Settings {
  namaToko: string;
  alamat: string;
  telepon: string;
  footerStruk: string;
  /** Kalau true, PaymentModal & struk menampilkan baris pajak (PRD §17 T-01 DoD). */
  ppnEnabled: boolean;
  /** Persentase, mis. 11 → 11%. Hanya dipakai kalau ppnEnabled = true. */
  ppnRate: number;
  /** Pembulatan kembalian tunai ke kelipatan ini (rupiah). Disiapkan untuk T-02/T-03. */
  rounding: number;
  /** Modal awal kas default saat buka shift. Dipakai mulai T-04. */
  shiftDefaultCash: number;
  /** Dipakai mulai T-03. */
  printDefault: "struk" | "nota";
  paperNota: "A6" | "A5";
  paperThermal: "58mm" | "80mm";
  /** Dipakai mulai T-10 (kontrol tampil/sembunyi harga modal, permission `harga_modal`). */
  showCostPrice: boolean;
}

// Default fallback — SENGAJA persis sama dengan seed di migration 005_settings.sql.
// Dipakai selama fetch pertama masih berjalan (isLoading) dan kalau fetch gagal,
// supaya layar Kasir tidak pernah crash / tidak pernah tiba-tiba menampilkan pajak
// yang salah hanya karena request settings belum selesai.
export const DEFAULT_SETTINGS: Settings = {
  namaToko: "Langitan.co",
  alamat: "",
  telepon: "",
  footerStruk: "Terima kasih atas kunjungan Anda",
  ppnEnabled: false,
  ppnRate: 11,
  rounding: 100,
  shiftDefaultCash: 0,
  printDefault: "nota",
  paperNota: "A6",
  paperThermal: "80mm",
  showCostPrice: false,
};

// Pemetaan key DB (snake_case, sesuai migration) -> field Settings (camelCase).
// Satu sumber kebenaran dipakai dua arah: parse hasil select, dan tulis balik di updateSetting.
const KEY_MAP: Record<keyof Settings, string> = {
  namaToko: "nama_toko",
  alamat: "alamat",
  telepon: "telepon",
  footerStruk: "footer_struk",
  ppnEnabled: "ppn_enabled",
  ppnRate: "ppn_rate",
  rounding: "rounding",
  shiftDefaultCash: "shift_default_cash",
  printDefault: "print_default",
  paperNota: "paper_nota",
  paperThermal: "paper_thermal",
  showCostPrice: "show_cost_price",
};

function parseSettings(rows: SettingRow[]): Settings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = { ...DEFAULT_SETTINGS };

  (Object.keys(KEY_MAP) as (keyof Settings)[]).forEach((field) => {
    const dbKey = KEY_MAP[field];
    if (!byKey.has(dbKey)) return; // key belum ada di DB (mis. migration belum jalan) -> pakai default

    const raw = byKey.get(dbKey);
    // value jsonb sudah otomatis ke-decode jadi tipe JS asli (boolean/number/string) oleh
    // supabase-js, jadi cukup type-assert saja sesuai bentuk Settings.
    (result as Record<string, unknown>)[field] = raw;
  });

  return result;
}

interface UseSettingsResult {
  settings: Settings;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Update 1 setting. Ditolak oleh RLS (migration 005) kalau bukan admin —
   * lempar Error dengan pesan dari Postgres, tangani di UI pemanggil (T-10).
   */
  updateSetting: <K extends keyof Settings>(
    field: K,
    value: Settings[K],
  ) => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("settings")
      .select("*");

    if (fetchError) {
      setError(fetchError.message);
      // Baris TIDAK dikosongkan ke [] di sini secara sengaja — biarkan `settings`
      // (lihat useMemo di bawah) tetap jatuh ke DEFAULT_SETTINGS lewat parseSettings([]),
      // supaya layar Kasir tetap bisa dipakai (PPN dianggap off) walau fetch gagal.
      setRows([]);
    } else {
      setRows((data ?? []) as SettingRow[]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const settings = useMemo(() => parseSettings(rows), [rows]);

  const updateSetting = useCallback(
    async <K extends keyof Settings>(field: K, value: Settings[K]) => {
      const dbKey = KEY_MAP[field];

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: updateError } = await supabase
        .from("settings")
        .update({
          value,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("key", dbKey);

      if (updateError) {
        throw new Error(
          updateError.message || `Gagal menyimpan pengaturan "${dbKey}".`,
        );
      }

      await fetchSettings();
    },
    [fetchSettings],
  );

  return { settings, isLoading, error, refetch: fetchSettings, updateSetting };
}