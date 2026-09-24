"use client";

// app/components/promo/PromoModule.tsx
// ── TAMBAHAN ── Layar pengelola Layar Promosi TV (fitur di luar penomoran
// T-xx PRD; langkah 3 dari 6, lihat PROGRESS.md sesi #20). Admin+supervisor
// mengunggah gambar/video, mengatur urutan, menayangkan/menyembunyikan, dan
// menghapus media yang diputar halaman publik `/tv` (langkah 5).
//
// Semua logika data ada di hooks/usePromoMedia.ts — file ini murni tampilan +
// state form/dialog. Siapa boleh menulis ditegakkan RLS di database
// (migration 026); gate di bawah cuma UX supaya role lain tidak melihat
// layar yang pasti gagal. Pola gate SAMA dengan PengaturanModule.tsx
// (cabang isAuthLoading dulu, baru !canAccess, keduanya SETELAH semua hook
// dipanggil sesuai Rules of Hooks) — supaya tidak mengulang bug "kedipan".
//
// Wiring menu (Sidebar.tsx + page.tsx) ada di langkah 4: sampai itu selesai,
// modul ini belum bisa dibuka dari aplikasi.

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  PlayCircle,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  PROMO_ACCEPT,
  PROMO_DURATION_DEFAULT,
  PROMO_DURATION_MAX,
  PROMO_DURATION_MIN,
  PROMO_MAX_FILE_BYTES,
  usePromoMedia,
  type AddPromoMediaInput,
  type PromoActionResult,
  type PromoMedia,
  type UpdatePromoMediaInput,
} from "@/hooks/usePromoMedia";

// ── Helper tampilan ─────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LABEL_CLASS =
  "mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";

const INPUT_CLASS =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none transition-colors duration-150 placeholder:text-zinc-400 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal disabled:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800";

const ICON_BUTTON_BASE =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800";

const ICON_BUTTON_CLASS = `${ICON_BUTTON_BASE} text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100`;

const ICON_BUTTON_DANGER_CLASS = `${ICON_BUTTON_BASE} text-zinc-600 hover:bg-lco-coral/10 hover:text-lco-coral dark:text-zinc-400 dark:hover:bg-lco-coral/10 dark:hover:text-lco-coral`;

// ── Modal tambah / ubah ─────────────────────────────────────────────────

type FormTarget = { mode: "add" } | { mode: "edit"; item: PromoMedia };

interface MediaFormModalProps {
  target: FormTarget;
  isBusy: boolean;
  onClose: () => void;
  onAdd: (input: AddPromoMediaInput) => Promise<PromoActionResult>;
  onEdit: (
    id: string,
    patch: UpdatePromoMediaInput,
  ) => Promise<PromoActionResult>;
  onSaved: (message: string) => void;
}

// Dirender HANYA saat `target` ada (lihat PromoModule di bawah), jadi state
// awalnya cukup diisi lewat useState initializer — tidak perlu useEffect
// untuk mereset form tiap dibuka.
function MediaFormModal({
  target,
  isBusy,
  onClose,
  onAdd,
  onEdit,
  onSaved,
}: MediaFormModalProps) {
  // `editItem` (bukan alias boolean) supaya TypeScript pasti menyempitkan tipe.
  const editItem = target.mode === "edit" ? target.item : null;
  const isEdit = editItem !== null;

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(editItem ? editItem.title : "");
  const [duration, setDuration] = useState(
    String(editItem ? editItem.duration_seconds : PROMO_DURATION_DEFAULT),
  );
  const [formError, setFormError] = useState("");

  // URL pratinjau file lokal. Dibuat di event handler (bukan saat render)
  // dan WAJIB di-revoke kalau diganti/modal ditutup, kalau tidak bocor di
  // memori tab (TV/tablet kasir dibuka seharian).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = picked ? URL.createObjectURL(picked) : null;
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setFile(picked);

    // Judul otomatis dari nama file kalau belum diisi — bisa diubah.
    if (picked && !title.trim()) {
      setTitle(picked.name.replace(/\.[^.]+$/, ""));
    }

    // Video tidak dikompres di browser, jadi ukurannya bisa dicek langsung.
    // (Gambar dicek SETELAH kompresi, di hook.)
    if (
      picked &&
      picked.type.startsWith("video/") &&
      picked.size > PROMO_MAX_FILE_BYTES
    ) {
      setFormError(
        `Video ${formatFileSize(picked.size)} melebihi batas ${formatFileSize(PROMO_MAX_FILE_BYTES)}. Kecilkan/kompres videonya dulu.`,
      );
    } else {
      setFormError("");
    }
  }

  const isImage = editItem
    ? editItem.media_type === "image"
    : file
      ? file.type.startsWith("image/")
      : false;
  const isVideoPicked = !isEdit && !!file && file.type.startsWith("video/");

  async function handleSubmit() {
    setFormError("");

    if (!editItem) {
      if (!file) {
        setFormError("Pilih file gambar atau video dulu.");
        return;
      }
      const result = await onAdd({
        file,
        title,
        durationSeconds: Number(duration),
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onSaved("Media berhasil ditambahkan.");
      return;
    }

    const patch: UpdatePromoMediaInput = { title };
    if (editItem.media_type === "image") {
      patch.duration_seconds = Number(duration);
    }
    const result = await onEdit(editItem.id, patch);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onSaved("Perubahan disimpan.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">
            {isEdit ? "Ubah Media" : "Tambah Media"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Tutup"
            className="rounded-md p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {!isEdit && (
            <div>
              <label className={LABEL_CLASS}>File (gambar atau video)</label>
              <input
                type="file"
                accept={PROMO_ACCEPT}
                onChange={handleFileChange}
                disabled={isBusy}
                className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700 file:transition-colors file:duration-150 hover:file:bg-zinc-50 disabled:opacity-60 dark:text-zinc-400 dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-200 dark:hover:file:bg-zinc-800"
              />
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                JPG, PNG, WebP, MP4, atau WebM. Maksimal{" "}
                <span className="font-mono tabular-nums">
                  {formatFileSize(PROMO_MAX_FILE_BYTES)}
                </span>
                . Video terbaik: MP4 (H.264), 1080p.
              </p>
            </div>
          )}

          {previewUrl && file && (
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-950 dark:border-zinc-800">
              {isVideoPicked ? (
                <video
                  src={previewUrl}
                  controls
                  muted
                  playsInline
                  className="mx-auto max-h-56 w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- pratinjau file lokal (blob:), tidak bisa dioptimasi next/image
                <img
                  src={previewUrl}
                  alt="Pratinjau"
                  className="mx-auto max-h-56 w-full object-contain"
                />
              )}
            </div>
          )}

          <div>
            <label className={LABEL_CLASS}>Judul</label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={isBusy}
              maxLength={120}
              placeholder="Mis. Promo Kaos Oktober"
              className={INPUT_CLASS}
            />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Hanya untuk penanda di daftar ini — tidak tampil di layar TV.
            </p>
          </div>

          {isImage && (
            <div>
              <label className={LABEL_CLASS}>Lama tayang (detik)</label>
              <input
                type="number"
                inputMode="numeric"
                min={PROMO_DURATION_MIN}
                max={PROMO_DURATION_MAX}
                step={1}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                disabled={isBusy}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {PROMO_DURATION_MIN}–{PROMO_DURATION_MAX} detik. Video diputar
                sampai selesai.
              </p>
            </div>
          )}

          {formError && (
            <div className="flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>{formError}</p>
            </div>
          )}

          {isBusy && !isEdit && (
            <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Mengunggah... jangan tutup halaman ini (video besar bisa butuh
              beberapa menit).
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-md bg-lco-green px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Simpan" : "Unggah"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modul utama ─────────────────────────────────────────────────────────

export default function PromoModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "supervisor";

  const {
    items,
    isLoading,
    error,
    isMutating,
    refetch,
    addMedia,
    updateMedia,
    removeMedia,
    moveItem,
  } = usePromoMedia();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [deletingItem, setDeletingItem] = useState<PromoMedia | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function runAction(
    action: () => Promise<PromoActionResult>,
    successText?: string,
  ) {
    setActionError("");
    setSuccessMessage("");
    const result = await action();
    if (!result.ok) {
      setActionError(result.error);
    } else if (successText) {
      setSuccessMessage(successText);
    }
  }

  function handleFormSaved(message: string) {
    setFormTarget(null);
    setActionError("");
    setSuccessMessage(message);
  }

  async function handleConfirmDelete() {
    if (!deletingItem) return;
    setDeleteError("");

    const result = await removeMedia(deletingItem.id);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeletingItem(null);
    setActionError("");
    setSuccessMessage("Media dihapus.");
  }

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat...
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Layar Promosi hanya untuk admin dan supervisor.
        </p>
      </div>
    );
  }

  // Modul ini dimuat lewat next/dynamic { ssr: false } (lihat app/page.tsx),
  // jadi `window` selalu ada di sini.
  const tvUrl = `${window.location.origin}/tv`;
  const activeCount = items.filter((item) => item.is_active).length;

  return (
    <section className="h-full overflow-y-auto bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Layar Promosi
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Gambar dan video yang diputar berulang di TV toko.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setActionError("");
              setSuccessMessage("");
              setFormTarget({ mode: "add" });
            }}
            className="inline-flex items-center gap-2 rounded-md bg-lco-green px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover"
          >
            <Plus className="h-4 w-4" />
            Tambah Media
          </button>
        </div>

        {/* Petunjuk pemakaian + alamat TV */}
        <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className={LABEL_CLASS}>Alamat layar TV</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a
              href="/tv"
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-sm text-lco-green underline-offset-2 transition-colors duration-150 hover:underline dark:text-lco-teal"
            >
              {tvUrl}
            </a>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              ← buka di browser TV / mini PC, lalu layar penuh
            </span>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-500 dark:text-zinc-400">
            <li>
              Gambar tayang sesuai durasinya; video diputar sampai selesai,
              tanpa suara.
            </li>
            <li>
              Perubahan di daftar ini muncul di TV dalam sekitar 1 menit tanpa
              perlu memuat ulang.
            </li>
            <li>
              Alamat ini bisa dibuka siapa pun tanpa login. Hanya media yang
              berstatus <span className="font-medium">Tayang</span> yang
              terlihat — jangan unggah materi internal.
            </li>
          </ul>
        </div>

        {successMessage && (
          <div className="mb-3 flex items-start gap-2 border border-lco-teal/40 bg-white p-3 text-xs text-lco-green dark:bg-zinc-950 dark:text-lco-teal">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{successMessage}</p>
          </div>
        )}

        {actionError && (
          <div className="mb-3 flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{actionError}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat daftar media...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-lco-coral/30 bg-white p-6 text-center dark:bg-zinc-950">
            <AlertCircle className="mx-auto mb-2 h-5 w-5 text-lco-coral" />
            <p className="text-sm text-lco-coral">{error}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              Coba lagi
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <Upload className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
            <p className="text-sm font-medium">Belum ada media</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Klik &quot;Tambah Media&quot; untuk mengunggah gambar atau video
              pertama. Selama kosong, TV menampilkan layar tunggu.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono tabular-nums">{items.length}</span>{" "}
              media ·{" "}
              <span className="font-mono tabular-nums">{activeCount}</span>{" "}
              tayang di TV
            </p>

            <ul className="space-y-2">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <span className="w-6 shrink-0 text-center font-mono text-sm tabular-nums text-zinc-400">
                    {index + 1}
                  </span>

                  <div
                    className={`relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-zinc-950 ${
                      item.is_active ? "" : "opacity-40"
                    }`}
                  >
                    {item.media_type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL publik Supabase Storage, tampilan kecil
                      <img
                        src={item.file_url}
                        alt={item.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <>
                        {/* #t=0.1 supaya browser menampilkan satu frame sebagai gambar mini */}
                        <video
                          src={`${item.file_url}#t=0.1`}
                          preload="metadata"
                          muted
                          playsInline
                          className="h-full w-full object-cover"
                        />
                        <PlayCircle className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-white/80" />
                      </>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {item.media_type === "image" ? (
                        <>
                          Gambar ·{" "}
                          <span className="font-mono tabular-nums">
                            {item.duration_seconds}
                          </span>{" "}
                          dtk
                        </>
                      ) : (
                        <>Video · sampai selesai</>
                      )}{" "}
                      ·{" "}
                      <span className="font-mono tabular-nums">
                        {formatFileSize(item.file_size)}
                      </span>
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                        item.is_active
                          ? "text-lco-green dark:text-lco-teal"
                          : "text-zinc-400"
                      }`}
                    >
                      {item.is_active ? "Tayang" : "Disembunyikan"}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      title="Naikkan urutan"
                      aria-label="Naikkan urutan"
                      disabled={isMutating || index === 0}
                      onClick={() =>
                        void runAction(() => moveItem(item.id, "up"))
                      }
                      className={ICON_BUTTON_CLASS}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Turunkan urutan"
                      aria-label="Turunkan urutan"
                      disabled={isMutating || index === items.length - 1}
                      onClick={() =>
                        void runAction(() => moveItem(item.id, "down"))
                      }
                      className={ICON_BUTTON_CLASS}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title={
                        item.is_active
                          ? "Sembunyikan dari TV"
                          : "Tayangkan di TV"
                      }
                      aria-label={
                        item.is_active
                          ? "Sembunyikan dari TV"
                          : "Tayangkan di TV"
                      }
                      disabled={isMutating}
                      onClick={() =>
                        void runAction(() =>
                          updateMedia(item.id, { is_active: !item.is_active }),
                        )
                      }
                      className={ICON_BUTTON_CLASS}
                    >
                      {item.is_active ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Ubah judul / durasi"
                      aria-label="Ubah judul / durasi"
                      disabled={isMutating}
                      onClick={() => {
                        setActionError("");
                        setSuccessMessage("");
                        setFormTarget({ mode: "edit", item });
                      }}
                      className={ICON_BUTTON_CLASS}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Hapus"
                      aria-label="Hapus"
                      disabled={isMutating}
                      onClick={() => {
                        setDeleteError("");
                        setDeletingItem(item);
                      }}
                      className={ICON_BUTTON_DANGER_CLASS}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {formTarget && (
        <MediaFormModal
          target={formTarget}
          isBusy={isMutating}
          onClose={() => setFormTarget(null)}
          onAdd={addMedia}
          onEdit={updateMedia}
          onSaved={handleFormSaved}
        />
      )}

      {/* Konfirmasi hapus — overlay & radius disamakan dengan modal Hapus
          produk di ProdukModule.tsx. Beda penting: di sini hapus PERMANEN
          (tidak ada Sampah untuk media promosi, lihat migration 026). */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lco-coral/10 text-lco-coral">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Hapus media?</h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {deletingItem.title}
                  </span>{" "}
                  akan dihapus permanen beserta filenya dan tidak bisa
                  dipulihkan. Kalau hanya ingin berhenti menayangkan sementara,
                  pakai tombol sembunyikan (ikon mata).
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="mb-3 flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="break-all">{deleteError}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                disabled={isMutating}
                className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isMutating}
                className="inline-flex items-center gap-2 rounded-md bg-lco-coral px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-coral/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
