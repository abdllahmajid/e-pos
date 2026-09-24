// hooks/usePromoScreens.ts
// ── Langkah 2 (migration 027) ── Hook daftar TV ("layar promosi"), satu
// baris = satu `promo_screens`. Dipakai `PromoModule.tsx` (langkah 4, sudah
// menunggu kontrak persis file ini): tingkat 1 (daftar TV: tambah/ubah
// nama/aktif-nonaktif/hapus) sebelum masuk ke `usePromoMedia(screen.id)`
// (langkah 3, milik SATU TV yang dipilih).
//
// Pola sama seperti `usePromoMedia.ts`: aksi tulis mengembalikan
// `{ ok: true } | { ok: false; error }` (tidak melempar), dibungkus
// `runMutation` untuk `isMutating` + tangkap error tak terduga. Siapa boleh
// menulis ditegakkan RLS (admin+supervisor, migration 027) — hook ini tidak
// mengecek role sendiri.
//
// `access_token` TIDAK PERNAH bisa diubah dari sini (tidak ada fungsi
// regenerate) — sengaja: kalau bocor, cara amannya hapus TV itu dan buat
// baru dengan token baru, bukan "putar ulang" token TV yang linknya sudah
// ditempel di banyak perangkat.

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PROMO_BUCKET } from "@/hooks/usePromoMedia";

const supabase = createClient();

// ── Tipe ────────────────────────────────────────────────────────────────

export interface PromoScreen {
  id: string;
  name: string;
  access_token: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export type PromoScreenActionResult = { ok: true } | { ok: false; error: string };

const SCREEN_NAME_MAX = 80;
const SCREEN_COLUMNS = "id, name, access_token, is_active, created_by, created_at";

// Migration 028: slug custom boleh 3–64 karakter, huruf kecil/angka/tanda
// hubung, tidak diawali/diakhiri tanda hubung — SAMA PERSIS dengan CHECK
// constraint `promo_screens_access_token_format` di database, supaya pesan
// error tervalidasi di sisi klien DULU (lebih cepat & ramah) sebelum sempat
// dikirim dan ditolak database.
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$/;
const SLUG_MIN = 3;
const SLUG_MAX = 64;

// ── Helper ──────────────────────────────────────────────────────────────

function friendlyError(message: string | undefined, fallback: string): string {
  const text = (message ?? "").toLowerCase();

  if (text.includes("row-level security") || text.includes("permission denied")) {
    return "Anda tidak punya izin untuk aksi ini (hanya admin/supervisor).";
  }
  if (text.includes("promo_screens_access_token_format")) {
    return "Alamat TV hanya boleh huruf kecil, angka, dan tanda hubung (3-64 karakter), tidak diawali/diakhiri tanda hubung.";
  }
  if (text.includes("promo_screens_access_token_key") || text.includes("duplicate key")) {
    return "Alamat TV ini sudah dipakai TV lain — coba alamat lain.";
  }
  return message || fallback;
}

/**
 * Ubah ketikan bebas pengguna (mis. "Kasir Depan!!") jadi bentuk yang lolos
 * `SLUG_PATTERN` (mis. "kasir-depan") — huruf besar diturunkan, spasi/garis
 * bawah/karakter simbol jadi satu tanda hubung, tanda hubung berulang
 * dirapikan, tanda hubung di awal/akhir dibuang. Kembalikan `null` kalau
 * setelah dibersihkan hasilnya lebih pendek dari `SLUG_MIN` (bukan
 * memaksakan sisa karakter yang ada — lebih baik user diberi tahu untuk
 * menulis ulang daripada dapat slug pendek yang tidak diminta).
 */
export function slugifyScreenToken(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);

  if (slug.length < SLUG_MIN || !SLUG_PATTERN.test(slug)) return null;
  return slug;
}

/**
 * Alamat publik `/tv/[access_token]` — dipakai `ScreenLinkModal` (link +
 * QR) dan `ScreenMediaManager` (tautan "buka di tab baru"). Client-side
 * saja (`window.location.origin`, sama seperti pola `useAdminUsers.ts`
 * untuk `redirectTo`) — tidak ada fallback ke env var karena fungsi ini
 * tidak pernah dipanggil saat render di server (seluruh `PromoModule.tsx`
 * adalah client component, `dynamic(..., { ssr: false })`).
 */
export function buildScreenUrl(accessToken: string): string {
  return `${window.location.origin}/tv/${accessToken}`;
}

// ── Hook ────────────────────────────────────────────────────────────────

interface UsePromoScreensResult {
  screens: PromoScreen[];
  isLoading: boolean;
  /** Error MEMUAT daftar (bukan error aksi tulis — itu ada di hasil tiap aksi). */
  error: string | null;
  /** true selama ada aksi tulis yang sedang berjalan (tambah/ubah/hapus). */
  isMutating: boolean;
  refetch: () => Promise<void>;
  addScreen: (name: string, customSlug?: string) => Promise<PromoScreenActionResult>;
  renameScreen: (id: string, name: string) => Promise<PromoScreenActionResult>;
  setScreenActive: (id: string, isActive: boolean) => Promise<PromoScreenActionResult>;
  removeScreen: (id: string) => Promise<PromoScreenActionResult>;
}

export function usePromoScreens(): UsePromoScreensResult {
  const [screens, setScreens] = useState<PromoScreen[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  // Sama seperti `usePromoMedia`: tidak ada `setIsLoading(true)` sinkron di
  // badan efek (dilarang lint `react-hooks/set-state-in-effect`) — state
  // awal sudah `true`, `refetch()` di bawah yang menyalakan spinner untuk
  // muat ulang manual.
  async function load() {
    const { data, error: fetchError } = await supabase
      .from("promo_screens")
      .select(SCREEN_COLUMNS)
      .order("created_at", { ascending: true });

    if (fetchError) {
      setError(friendlyError(fetchError.message, "Gagal memuat daftar TV."));
      setScreens([]);
    } else {
      setError(null);
      setScreens((data ?? []) as PromoScreen[]);
    }

    setIsLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali jalan saat mount, sama seperti `usePromoMedia`; muat ulang manual lewat `refetch()`.
  }, []);

  async function refetch() {
    setIsLoading(true);
    await load();
  }

  async function runMutation(
    action: () => Promise<PromoScreenActionResult>,
  ): Promise<PromoScreenActionResult> {
    setIsMutating(true);
    try {
      return await action();
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.",
      };
    } finally {
      setIsMutating(false);
    }
  }

  // ── Tambah TV baru ──────────────────────────────────────────────────
  // `customSlug` (migration 028) OPSIONAL: kalau diisi & valid, dipakai
  // sebagai `access_token` (alamat `/tv/...` yang mudah dibaca/diketik).
  // Kalau kosong, `access_token` TIDAK dikirim sama sekali — dibangkitkan
  // otomatis oleh default kolom di database (2x `gen_random_uuid()`,
  // migration 027), supaya keacakannya murni server-side.
  function addScreen(
    name: string,
    customSlug?: string,
  ): Promise<PromoScreenActionResult> {
    return runMutation(async () => {
      const cleanName = name.trim().slice(0, SCREEN_NAME_MAX);
      if (!cleanName) {
        return { ok: false, error: "Nama TV wajib diisi." };
      }

      let accessToken: string | undefined;
      if (customSlug && customSlug.trim()) {
        const slug = slugifyScreenToken(customSlug);
        if (!slug) {
          return {
            ok: false,
            error:
              "Alamat TV tidak valid — minimal 3 karakter, huruf kecil/angka/tanda hubung saja.",
          };
        }
        accessToken = slug;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("promo_screens")
        .insert(accessToken ? { name: cleanName, access_token: accessToken } : { name: cleanName })
        .select(SCREEN_COLUMNS)
        .single();

      if (insertError || !inserted) {
        return {
          ok: false,
          error: friendlyError(insertError?.message, "Gagal menambah TV."),
        };
      }

      setScreens((prev) => [...prev, inserted as PromoScreen]);
      return { ok: true };
    });
  }

  // ── Ubah nama ────────────────────────────────────────────────────────
  function renameScreen(id: string, name: string): Promise<PromoScreenActionResult> {
    return runMutation(async () => {
      const cleanName = name.trim().slice(0, SCREEN_NAME_MAX);
      if (!cleanName) {
        return { ok: false, error: "Nama TV wajib diisi." };
      }

      const { data, error: updateError } = await supabase
        .from("promo_screens")
        .update({ name: cleanName })
        .eq("id", id)
        .select(SCREEN_COLUMNS);

      if (updateError) {
        return {
          ok: false,
          error: friendlyError(updateError.message, "Gagal menyimpan nama TV."),
        };
      }
      if (!data || data.length === 0) {
        return {
          ok: false,
          error: "TV tidak ditemukan atau Anda tidak punya izin.",
        };
      }

      const updated = data[0] as PromoScreen;
      setScreens((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return { ok: true };
    });
  }

  // ── Aktif / nonaktif (tanpa menghapus data) ──────────────────────────
  function setScreenActive(
    id: string,
    isActive: boolean,
  ): Promise<PromoScreenActionResult> {
    return runMutation(async () => {
      const { data, error: updateError } = await supabase
        .from("promo_screens")
        .update({ is_active: isActive })
        .eq("id", id)
        .select(SCREEN_COLUMNS);

      if (updateError) {
        return {
          ok: false,
          error: friendlyError(updateError.message, "Gagal mengubah status TV."),
        };
      }
      if (!data || data.length === 0) {
        return {
          ok: false,
          error: "TV tidak ditemukan atau Anda tidak punya izin.",
        };
      }

      const updated = data[0] as PromoScreen;
      setScreens((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return { ok: true };
    });
  }

  // ── Hapus TV (+ file Storage semua medianya, lihat migration 027 #5) ──
  function removeScreen(id: string): Promise<PromoScreenActionResult> {
    return runMutation(async () => {
      // Bersihkan file Storage DULU, sebelum baris TV dihapus — kebalikan
      // dari `removeMedia()` di `usePromoMedia.ts` (di sana baris dulu baru
      // file), karena arahnya kebalik: di sini yang dihapus adalah
      // INDUKnya. `on delete cascade` (migration 027) akan ikut menghapus
      // baris-baris `promo_media` begitu baris `promo_screens` terhapus —
      // kalau urutan dibalik (baris dulu), kita kehilangan daftar
      // `storage_path` yang perlu dibersihkan sebelum sempat menghapus
      // filenya.
      const { data: mediaRows, error: mediaFetchError } = await supabase
        .from("promo_media")
        .select("storage_path")
        .eq("screen_id", id);

      if (mediaFetchError) {
        return {
          ok: false,
          error: friendlyError(
            mediaFetchError.message,
            "Gagal memeriksa media TV ini sebelum dihapus.",
          ),
        };
      }

      const storagePaths = (mediaRows ?? [])
        .map((row) => (row as { storage_path: string }).storage_path)
        .filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: removeFilesError } = await supabase.storage
          .from(PROMO_BUCKET)
          .remove(storagePaths);
        if (removeFilesError) {
          // Jangan macet di sini — baris DB belum terhapus sama sekali,
          // jadi paling buruk file yatim tersisa (akan dicoba lagi kalau
          // admin klik hapus sekali lagi), bukan TV rusak setengah jalan.
          console.warn(
            "Sebagian file promosi TV gagal dibersihkan sebelum hapus TV:",
            id,
            removeFilesError,
          );
        }
      }

      const { data, error: deleteError } = await supabase
        .from("promo_screens")
        .delete()
        .eq("id", id)
        .select("id");

      if (deleteError) {
        return {
          ok: false,
          error: friendlyError(deleteError.message, "Gagal menghapus TV."),
        };
      }
      if (!data || data.length === 0) {
        return {
          ok: false,
          error: "TV tidak ditemukan atau Anda tidak punya izin.",
        };
      }

      setScreens((prev) => prev.filter((s) => s.id !== id));
      return { ok: true };
    });
  }

  return {
    screens,
    isLoading,
    error,
    isMutating,
    refetch,
    addScreen,
    renameScreen,
    setScreenActive,
    removeScreen,
  };
}