"use client";

// app/tv/page.tsx
// ── TAMBAHAN ── Pemutar Layar Promosi TV (fitur di luar penomoran T-xx PRD;
// langkah 5 dari 6, lihat PROGRESS.md sesi #20). Halaman PUBLIK (tanpa
// login) yang dibuka di browser TV / mini PC / Android box, memutar media
// aktif dari `promo_media` berulang-ulang. Daftar dikelola lewat menu
// "Layar Promosi" (PromoModule.tsx).
//
// Publik lewat middleware.ts (PUBLIC_PATHS). Sama seperti /cek-struk:
// halaman ini TIDAK boleh mengasumsikan ada sesi/user, dan sengaja tidak
// memakai hooks/useAuth atau komponen modul internal. Satu-satunya sumber
// data: `fetchPlayablePromoMedia()` (hooks/usePromoMedia.ts) — query-nya
// sudah menyebut kolom satu-satu sesuai hak `anon` migration 026.
//
// Aturan pemutaran:
// - Gambar tayang `duration_seconds`; video diputar sampai selesai, SELALU
//   tanpa suara (browser memblokir autoplay bersuara).
// - Urutan mengikuti `sort_order`, berputar terus dari awal.
// - Daftar dimuat ulang tiap 60 detik (BUKAN Realtime — PRD §7 membatasi
//   Realtime hanya Kasir & Stok). Angka ini dijanjikan di teks bantuan
//   PromoModule.tsx — kalau diubah, ubah teks itu juga.
// - Gagal memuat ulang → TETAP memutar playlist lama (TV tidak boleh kosong
//   gara-gara sinyal putus sebentar). Kalau belum pernah berhasil memuat,
//   coba lagi lebih cepat (15 detik).
// - Media yang gagal dimuat dilompati; video yang tidak mulai diputar dalam
//   20 detik juga dilompati — supaya TV tidak macet di satu item.
// - Sengaja TANPA animasi transisi (potong langsung), sejalan dengan tema
//   "LCO Flat" yang melarang animasi selain transisi warna, dan lebih ringan
//   untuk browser TV yang lemah.
// - Gambar memakai `object-contain` di latar hitam (tidak dipotong) — materi
//   promosi yang dipotong sering kehilangan teks di tepinya.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPlayablePromoMedia,
  type PlayablePromoMedia,
} from "@/hooks/usePromoMedia";

const REFRESH_MS = 60_000;
const RETRY_MS = 15_000;
const VIDEO_START_TIMEOUT_MS = 20_000;
const ERROR_SKIP_DELAY_MS = 2_000;
const HINT_VISIBLE_MS = 8_000;

// Dua playlist dianggap sama kalau urutan, file, jenis, dan durasinya sama.
// `title` SENGAJA tidak dibandingkan: mengganti judul di layar pengelola
// tidak boleh mengulang timer item yang sedang tayang. Kalau sama, state
// lama dipertahankan (referensi objek tetap) sehingga tidak ada efek yang
// terpicu ulang tiap polling.
function isSamePlaylist(
  a: PlayablePromoMedia[],
  b: PlayablePromoMedia[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const other = b[i];
    return (
      item.id === other.id &&
      item.file_url === other.file_url &&
      item.media_type === other.media_type &&
      item.duration_seconds === other.duration_seconds &&
      item.sort_order === other.sort_order
    );
  });
}

export default function TvPage() {
  const [playlist, setPlaylist] = useState<PlayablePromoMedia[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  // Yang sedang tayang disimpan sebagai ID (bukan indeks): kalau playlist
  // berubah di tengah jalan, item ini tetap dicari lewat ID-nya; kalau sudah
  // dihapus/disembunyikan, otomatis jatuh ke item pertama.
  const [currentId, setCurrentId] = useState<string | null>(null);
  // Naik tiap pindah item — dipakai sebagai bagian `key` elemen dan
  // dependency timer, supaya playlist berisi 1 item / item yang sama
  // muncul berturut-turut tetap diputar ulang dari awal dengan benar.
  const [cycle, setCycle] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHint, setShowHint] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current =
    playlist.find((item) => item.id === currentId) ?? playlist[0] ?? null;
  const currentIndex = current
    ? playlist.findIndex((item) => item.id === current.id)
    : -1;
  const nextItem =
    playlist.length > 1 ? playlist[(currentIndex + 1) % playlist.length] : null;

  const advance = useCallback(() => {
    if (playlist.length === 0) return;
    const index = current
      ? playlist.findIndex((item) => item.id === current.id)
      : -1;
    const next = playlist[(index + 1) % playlist.length];
    setCurrentId(next.id);
    setCycle((value) => value + 1);
  }, [playlist, current]);

  // Media gagal dimuat: lompat ke berikutnya SETELAH jeda pendek. Jeda ini
  // penting — kalau semua item rusak, tanpa jeda TV akan berputar sangat
  // cepat tanpa henti.
  const skipAfterError = useCallback(() => {
    if (playlist.length < 2) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(advance, ERROR_SKIP_DELAY_MS);
  }, [playlist.length, advance]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // ── Muat & segarkan playlist ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      let ok = false;
      try {
        const next = await fetchPlayablePromoMedia();
        if (cancelled) return;
        ok = true;
        setPlaylist((prev) => (isSamePlaylist(prev, next) ? prev : next));
        setHasLoaded(true);
      } catch (err) {
        // Sengaja diam di layar (ini TV untuk pelanggan, bukan layar teknisi);
        // playlist lama tetap diputar.
        console.warn("Gagal memuat media promosi, coba lagi nanti:", err);
      }
      if (cancelled) return;
      timer = setTimeout(tick, ok ? REFRESH_MS : RETRY_MS);
    }

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ── Timer gambar ──────────────────────────────────────────────────────
  // Playlist 1 item: tidak ada timer (gambar tayang terus, tidak perlu
  // "pindah" ke dirinya sendiri).
  useEffect(() => {
    if (!current || current.media_type !== "image" || playlist.length < 2) {
      return;
    }
    const timer = setTimeout(advance, current.duration_seconds * 1000);
    return () => clearTimeout(timer);
  }, [current, playlist.length, cycle, advance]);

  // ── Penjaga video macet ───────────────────────────────────────────────
  // Video yang belum bergerak sama sekali setelah 20 detik (koneksi lambat,
  // codec tidak didukung tapi tanpa event error) dilompati.
  useEffect(() => {
    if (!current || current.media_type !== "video" || playlist.length < 2) {
      return;
    }
    const timer = setTimeout(() => {
      const element = videoRef.current;
      if (!element || element.currentTime === 0) advance();
    }, VIDEO_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [current, playlist.length, cycle, advance]);

  // ── Layar penuh ───────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        // Browser TV lama bisa tidak punya API ini → TypeError, ditangkap.
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {
      /* tidak didukung — abaikan */
    }
  }, []);

  useEffect(() => {
    function handleChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    function handleKey(event: KeyboardEvent) {
      // Enter = tombol OK di kebanyakan remote TV.
      if (event.key === "f" || event.key === "F" || event.key === "Enter") {
        toggleFullscreen();
      }
    }
    document.addEventListener("fullscreenchange", handleChange);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      window.removeEventListener("keydown", handleKey);
    };
  }, [toggleFullscreen]);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), HINT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  // ── Cegah TV masuk mode tidur ─────────────────────────────────────────
  // Wake Lock butuh HTTPS dan tidak ada di semua browser TV — kalau ditolak
  // atau tidak ada, diam saja (atur "screen saver: mati" di pengaturan TV).
  // Browser melepas kunci ini otomatis saat tab tidak terlihat, jadi diminta
  // ulang begitu tab terlihat lagi.
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        if (!("wakeLock" in navigator)) return;
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        /* ditolak / tidak didukung — abaikan */
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (sentinel) void sentinel.release();
    };
  }, []);

  return (
    <div
      onClick={toggleFullscreen}
      className="fixed inset-0 z-50 flex cursor-none select-none items-center justify-center overflow-hidden bg-black text-white"
    >
      {current && current.media_type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- URL publik Supabase Storage, ditampilkan penuh layar; next/image tidak relevan untuk TV
        <img
          key={`${current.id}-${cycle}`}
          src={current.file_url}
          alt=""
          onError={skipAfterError}
          className="h-full w-full object-contain"
        />
      )}

      {current && current.media_type === "video" && (
        <video
          key={`${current.id}-${cycle}`}
          ref={videoRef}
          src={current.file_url}
          autoPlay
          muted
          playsInline
          // 1 item saja: ulang terus di tempat, `onEnded` tidak akan terpicu.
          loop={playlist.length < 2}
          onEnded={advance}
          onError={skipAfterError}
          // Beberapa browser TV mengabaikan atribut autoplay — paksa play().
          onLoadedData={(event) => {
            void event.currentTarget.play().catch(() => {});
          }}
          className="h-full w-full object-contain"
        />
      )}

      {/* Layar tunggu: playlist SUDAH berhasil dimuat tapi tidak ada media
          aktif. Teks statis — `anon` tidak boleh membaca tabel `settings`,
          jadi nama toko tidak bisa diambil dari sana. */}
      {hasLoaded && !current && (
        <p className="text-3xl font-semibold tracking-tight text-white/70">
          Langitan.co
        </p>
      )}

      {/* Prapemuatan gambar berikutnya, supaya pindah item tidak "kosong"
          sebentar. Gambar dengan display:none tetap diunduh browser. Video
          sengaja TIDAK diprapemuat (menggandakan unduhan file besar). */}
      {nextItem &&
        nextItem.media_type === "image" &&
        nextItem.id !== current?.id && (
          // eslint-disable-next-line @next/next/no-img-element -- prapemuatan tersembunyi
          <img
            src={nextItem.file_url}
            alt=""
            aria-hidden="true"
            className="hidden"
          />
        )}

      {showHint && !isFullscreen && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/40">
          Klik atau tekan OK / F untuk layar penuh
        </p>
      )}
    </div>
  );
}
