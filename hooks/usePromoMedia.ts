// hooks/usePromoMedia.ts
// ── TAMBAHAN ── Hook domain Layar Promosi TV (fitur di luar penomoran T-xx
// PRD; langkah 2 dari 6, lihat PROGRESS.md sesi #20). Tabel `promo_media` +
// bucket Storage `promo-media` dibuat migration 026.
//
// Isi file ini dua hal yang SENGAJA dipisah:
//
// 1. `usePromoMedia()` — hook untuk layar PENGELOLA (admin+supervisor):
//    daftar semua media (termasuk nonaktif), tambah/upload, ubah judul/durasi,
//    aktif/nonaktif, hapus, dan atur urutan.
// 2. `fetchPlayablePromoMedia()` — fungsi biasa (BUKAN hook) untuk halaman
//    PUBLIK `/tv`. Bukan hook karena pemutar punya siklus polling sendiri.
//
// ── PENTING untuk `fetchPlayablePromoMedia()` ── dipanggil sebagai `anon`
// (TV tidak login). Migration 026 hanya memberi `anon` hak SELECT pada 7
// kolom: id, title, media_type, file_url, duration_seconds, sort_order,
// is_active. Konsekuensinya query di sana:
//   - TIDAK BOLEH `select("*")`,
//   - TIDAK BOLEH `.order("created_at")` (mengurutkan juga butuh hak baca
//     kolom itu → "permission denied"). Pengurut kedua memakai `id`.
//
// Aksi tulis (`addMedia`, `updateMedia`, `removeMedia`, `moveItem`)
// mengembalikan `{ ok: true } | { ok: false; error }` — TIDAK melempar error
// ke pemanggil, supaya layar pengelola cukup menampilkan `error` tanpa
// try/catch di mana-mana. Siapa boleh menulis ditegakkan RLS di database
// (admin+supervisor), hook ini tidak mengecek role sendiri.
//
// Semua UPDATE/DELETE memakai `.select()` lalu memeriksa jumlah baris yang
// kembali: kalau RLS menolak, Supabase TIDAK melempar error — cuma 0 baris
// yang kena (persis jebakan `updateSetting()` di PROGRESS.md sesi #18).

"use client";

import { useEffect, useState } from "react";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

// ── Tipe & konstanta ────────────────────────────────────────────────────

export type PromoMediaType = "image" | "video";

export interface PromoMedia {
  id: string;
  title: string;
  media_type: PromoMediaType;
  file_url: string;
  storage_path: string;
  file_name: string | null;
  file_size: number | null;
  duration_seconds: number;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

/** Bentuk yang boleh dibaca `anon` (dan yang dibutuhkan pemutar /tv). */
export type PlayablePromoMedia = Pick<
  PromoMedia,
  "id" | "title" | "media_type" | "file_url" | "duration_seconds" | "sort_order"
>;

export type PromoActionResult = { ok: true } | { ok: false; error: string };

export const PROMO_BUCKET = "promo-media";
/** Sama dengan `file_size_limit` bucket (migration 026) = batas upload plan gratis Supabase. */
export const PROMO_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const PROMO_DURATION_MIN = 3;
export const PROMO_DURATION_MAX = 120;
export const PROMO_DURATION_DEFAULT = 8;
/** Untuk atribut `accept` di <input type="file"> — sama dengan `allowed_mime_types` bucket. */
export const PROMO_ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/webm";

const PROMO_TITLE_MAX = 120;

// Tipe MIME yang diizinkan bucket → jenis media + ekstensi file di Storage.
// Ekstensi diturunkan dari MIME (bukan dari nama file asli) supaya nama file
// di Storage selalu aman & sesuai isi sebenarnya.
const MIME_INFO: Record<string, { type: PromoMediaType; ext: string }> = {
  "image/jpeg": { type: "image", ext: ".jpg" },
  "image/png": { type: "image", ext: ".png" },
  "image/webp": { type: "image", ext: ".webp" },
  "video/mp4": { type: "video", ext: ".mp4" },
  "video/webm": { type: "video", ext: ".webm" },
};

const ADMIN_COLUMNS =
  "id, title, media_type, file_url, storage_path, file_name, file_size, duration_seconds, sort_order, is_active, created_by, created_at";

// ── Helper ──────────────────────────────────────────────────────────────

function friendlyError(message: string | undefined, fallback: string): string {
  const text = (message ?? "").toLowerCase();

  if (text.includes("row-level security") || text.includes("permission denied")) {
    return "Anda tidak punya izin untuk aksi ini (hanya admin/supervisor).";
  }
  if (
    text.includes("maximum allowed size") ||
    text.includes("payload too large") ||
    text.includes("too large")
  ) {
    return "File melebihi batas ukuran Storage (50 MB).";
  }
  return message || fallback;
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function isValidDuration(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= PROMO_DURATION_MIN &&
    value <= PROMO_DURATION_MAX
  );
}

// ── Untuk halaman publik /tv ────────────────────────────────────────────

/**
 * Ambil playlist yang sedang aktif, berurutan. Dipakai `app/tv/page.tsx`
 * (langkah 5). MELEMPAR Error kalau gagal — pemutar yang memutuskan (biasanya
 * tetap memutar playlist lama daripada layar TV kosong karena sinyal putus
 * sebentar).
 */
export async function fetchPlayablePromoMedia(): Promise<PlayablePromoMedia[]> {
  const { data, error } = await supabase
    .from("promo_media")
    // Kolom disebut satu-satu — lihat catatan header soal hak `anon`.
    .select("id, title, media_type, file_url, duration_seconds, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(error.message || "Gagal memuat media promosi.");
  }

  return (data ?? []) as PlayablePromoMedia[];
}

// ── Hook untuk layar pengelola ──────────────────────────────────────────

export interface AddPromoMediaInput {
  file: File;
  title: string;
  /** Hanya dipakai untuk gambar; diabaikan untuk video. */
  durationSeconds: number;
}

export interface UpdatePromoMediaInput {
  title?: string;
  duration_seconds?: number;
  is_active?: boolean;
}

interface UsePromoMediaResult {
  items: PromoMedia[];
  isLoading: boolean;
  /** Error MEMUAT daftar (bukan error aksi tulis — itu ada di hasil tiap aksi). */
  error: string | null;
  /** true selama ada aksi tulis yang sedang berjalan (upload/ubah/hapus/urutan). */
  isMutating: boolean;
  refetch: () => Promise<void>;
  addMedia: (input: AddPromoMediaInput) => Promise<PromoActionResult>;
  updateMedia: (
    id: string,
    patch: UpdatePromoMediaInput,
  ) => Promise<PromoActionResult>;
  removeMedia: (id: string) => Promise<PromoActionResult>;
  moveItem: (id: string, direction: "up" | "down") => Promise<PromoActionResult>;
}

export function usePromoMedia(): UsePromoMediaResult {
  const [items, setItems] = useState<PromoMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  // Sengaja TIDAK memanggil setIsLoading(true) di awal fungsi ini: pemuatan
  // pertama sudah dimulai dari state awal (`true`), dan menaruh setState
  // sinkron di badan efek adalah pola yang dilarang lint project ini
  // (react-hooks/set-state-in-effect, lihat PROGRESS.md). `refetch()` di
  // bawah yang menyalakan spinner untuk muat ulang manual.
  async function load() {
    const { data, error: fetchError } = await supabase
      .from("promo_media")
      .select(ADMIN_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (fetchError) {
      setError(friendlyError(fetchError.message, "Gagal memuat media promosi."));
      setItems([]);
    } else {
      setError(null);
      setItems((data ?? []) as PromoMedia[]);
    }

    setIsLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() hanya memakai setter state (stabil) dan client singleton; cukup dijalankan sekali saat mount.
  }, []);

  async function refetch() {
    setIsLoading(true);
    await load();
  }

  // Bungkus semua aksi tulis: nyalakan isMutating, tangkap error tak terduga.
  async function runMutation(
    action: () => Promise<PromoActionResult>,
  ): Promise<PromoActionResult> {
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

  // ── Tambah (upload file + simpan metadata) ────────────────────────────
  function addMedia({
    file,
    title,
    durationSeconds,
  }: AddPromoMediaInput): Promise<PromoActionResult> {
    return runMutation(async () => {
      const info = MIME_INFO[file.type];
      if (!info) {
        return {
          ok: false,
          error: "Format tidak didukung. Gunakan JPG, PNG, WebP, MP4, atau WebM.",
        };
      }

      const cleanTitle = (
        title.trim() || file.name.replace(/\.[^.]+$/, "").trim()
      ).slice(0, PROMO_TITLE_MAX);
      if (!cleanTitle) {
        return { ok: false, error: "Judul media wajib diisi." };
      }

      // Video tidak memakai durasi (diputar sampai selesai) — simpan nilai
      // default supaya kolom NOT NULL + CHECK 3..120 di database terpenuhi.
      const duration =
        info.type === "image" ? durationSeconds : PROMO_DURATION_DEFAULT;
      if (!isValidDuration(duration)) {
        return {
          ok: false,
          error: `Durasi harus bilangan bulat ${PROMO_DURATION_MIN}–${PROMO_DURATION_MAX} detik.`,
        };
      }

      // Gambar dikompres (TV 1080p tidak butuh lebih dari 1920px); kalau
      // kompresi gagal pakai file asli, sama seperti bukti pembayaran di
      // lib/pos/transactionApi.ts. Video tidak dikompres di browser.
      let uploadFile = file;
      if (info.type === "image") {
        try {
          uploadFile = await imageCompression(file, {
            maxSizeMB: 1,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
          });
        } catch (err) {
          console.error("Kompresi gambar promosi gagal, pakai file asli:", err);
        }
      }

      if (uploadFile.size > PROMO_MAX_FILE_BYTES) {
        return {
          ok: false,
          error: `Ukuran file ${formatMegabytes(uploadFile.size)} MB melebihi batas ${formatMegabytes(PROMO_MAX_FILE_BYTES)} MB. Kecilkan/kompres videonya dulu.`,
        };
      }

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const storagePath = `${info.type}/${uniqueSuffix}${info.ext}`;

      const { error: uploadError } = await supabase.storage
        .from(PROMO_BUCKET)
        .upload(storagePath, uploadFile, {
          contentType: uploadFile.type || file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload media promosi error:", uploadError);
        return {
          ok: false,
          error: friendlyError(uploadError.message, "Gagal mengunggah file."),
        };
      }

      const { data: publicUrlData } = supabase.storage
        .from(PROMO_BUCKET)
        .getPublicUrl(storagePath);

      // Urutan: taruh di paling akhir. Ambil sort_order tertinggi langsung
      // dari database (bukan dari state) supaya benar walau daftar di layar
      // sudah basi — termasuk baris nonaktif, yang admin+supervisor bisa lihat.
      const { data: lastRows } = await supabase
        .from("promo_media")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1);
      const nextSortOrder =
        ((lastRows?.[0] as { sort_order: number } | undefined)?.sort_order ??
          0) + 1;

      const { data: inserted, error: insertError } = await supabase
        .from("promo_media")
        .insert({
          title: cleanTitle,
          media_type: info.type,
          file_url: publicUrlData.publicUrl,
          storage_path: storagePath,
          file_name: file.name,
          file_size: uploadFile.size,
          duration_seconds: duration,
          sort_order: nextSortOrder,
        })
        .select(ADMIN_COLUMNS)
        .single();

      if (insertError || !inserted) {
        console.error("Simpan metadata media promosi error:", insertError);
        // File sudah terlanjur terunggah tanpa baris pasangan — bersihkan
        // (best effort) supaya tidak jadi file yatim yang memakan kuota.
        await supabase.storage.from(PROMO_BUCKET).remove([storagePath]);
        return {
          ok: false,
          error: friendlyError(
            insertError?.message,
            "File terunggah tapi gagal disimpan datanya.",
          ),
        };
      }

      setItems((prev) => [...prev, inserted as PromoMedia]);
      return { ok: true };
    });
  }

  // ── Ubah judul / durasi / aktif-nonaktif ──────────────────────────────
  function updateMedia(
    id: string,
    patch: UpdatePromoMediaInput,
  ): Promise<PromoActionResult> {
    return runMutation(async () => {
      const payload: UpdatePromoMediaInput = {};

      if (patch.title !== undefined) {
        const cleanTitle = patch.title.trim().slice(0, PROMO_TITLE_MAX);
        if (!cleanTitle) {
          return { ok: false, error: "Judul media wajib diisi." };
        }
        payload.title = cleanTitle;
      }

      if (patch.duration_seconds !== undefined) {
        if (!isValidDuration(patch.duration_seconds)) {
          return {
            ok: false,
            error: `Durasi harus bilangan bulat ${PROMO_DURATION_MIN}–${PROMO_DURATION_MAX} detik.`,
          };
        }
        payload.duration_seconds = patch.duration_seconds;
      }

      if (patch.is_active !== undefined) {
        payload.is_active = patch.is_active;
      }

      if (Object.keys(payload).length === 0) {
        return { ok: true };
      }

      const { data, error: updateError } = await supabase
        .from("promo_media")
        .update(payload)
        .eq("id", id)
        .select(ADMIN_COLUMNS);

      if (updateError) {
        return {
          ok: false,
          error: friendlyError(updateError.message, "Gagal menyimpan perubahan."),
        };
      }
      if (!data || data.length === 0) {
        return {
          ok: false,
          error:
            "Perubahan tidak tersimpan (media tidak ditemukan atau Anda tidak punya izin).",
        };
      }

      const updated = data[0] as PromoMedia;
      setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
      return { ok: true };
    });
  }

  // ── Hapus permanen (baris + file) ─────────────────────────────────────
  function removeMedia(id: string): Promise<PromoActionResult> {
    return runMutation(async () => {
      const target = items.find((it) => it.id === id);
      if (!target) {
        return { ok: false, error: "Media tidak ditemukan di daftar." };
      }

      // Baris dihapus DULU, file sesudahnya. Kalau urutannya dibalik dan
      // penghapusan baris gagal, TV akan memutar media yang filenya sudah
      // hilang. Kebalikannya lebih aman: paling buruk tersisa file yatim di
      // Storage (tidak terlihat siapa pun, cuma memakan kuota).
      const { data, error: deleteError } = await supabase
        .from("promo_media")
        .delete()
        .eq("id", id)
        .select("id");

      if (deleteError) {
        return {
          ok: false,
          error: friendlyError(deleteError.message, "Gagal menghapus media."),
        };
      }
      if (!data || data.length === 0) {
        return {
          ok: false,
          error:
            "Media tidak terhapus (sudah tidak ada atau Anda tidak punya izin).",
        };
      }

      const { error: removeFileError } = await supabase.storage
        .from(PROMO_BUCKET)
        .remove([target.storage_path]);
      if (removeFileError) {
        // Baris sudah hilang, jadi ini bukan kegagalan bagi pengguna —
        // cukup dicatat.
        console.warn(
          "Media promosi terhapus tapi file di Storage gagal dibersihkan:",
          target.storage_path,
          removeFileError,
        );
      }

      setItems((prev) => prev.filter((it) => it.id !== id));
      return { ok: true };
    });
  }

  // ── Geser urutan satu posisi (atomik lewat RPC reorder_promo_media) ────
  function moveItem(
    id: string,
    direction: "up" | "down",
  ): Promise<PromoActionResult> {
    return runMutation(async () => {
      const index = items.findIndex((it) => it.id === id);
      if (index === -1) {
        return { ok: false, error: "Media tidak ditemukan di daftar." };
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= items.length) {
        return { ok: true }; // sudah di ujung, tidak ada yang digeser
      }

      const reordered = [...items];
      [reordered[index], reordered[targetIndex]] = [
        reordered[targetIndex],
        reordered[index],
      ];

      const { error: rpcError } = await supabase.rpc("reorder_promo_media", {
        p_ids: reordered.map((it) => it.id),
      });

      if (rpcError) {
        return {
          ok: false,
          error: friendlyError(rpcError.message, "Gagal mengubah urutan."),
        };
      }

      // Cerminkan penomoran yang baru ditulis RPC (1, 2, 3, ...).
      setItems(reordered.map((it, i) => ({ ...it, sort_order: i + 1 })));
      return { ok: true };
    });
  }

  return {
    items,
    isLoading,
    error,
    isMutating,
    refetch,
    addMedia,
    updateMedia,
    removeMedia,
    moveItem,
  };
}