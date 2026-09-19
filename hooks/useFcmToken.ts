// hooks/useFcmToken.ts
// ── BARU ── Hook domain FCM push notification (PRD §17 T-12), menjembatani
// wrapper SDK murni `lib/firebase/client.ts` dengan RPC penyimpanan token di
// `profiles.fcm_token` (`save_my_fcm_token`/`clear_my_fcm_token`, migration
// `023_fcm_token_rpc.sql` — LIHAT file itu untuk alasan kenapa harus RPC,
// bukan `.update()` langsung: RLS `profiles_update_own` tidak mengizinkan
// mencabut token dari profil user lain).
//
// ── Kenapa TIDAK auto-minta izin notifikasi saat hook mount ──
// `Notification.requestPermission()` browser MEMANG hanya menampilkan popup
// kalau `Notification.permission === "default"` (belum pernah dijawab) —
// begitu "granted"/"denied", browser TIDAK menampilkan apa pun lagi meski
// dipanggil ulang. Tapi sengaja tetap TIDAK dipanggil otomatis di sini kalau
// izinnya masih "default", supaya popup permintaan izin browser tidak muncul
// tiba-tiba tanpa aksi user (praktik umum: minta izin notifikasi dari klik
// tombol eksplisit, bukan saat halaman baru dibuka). Hook ini HANYA
// mendaftar ulang diam-diam kalau izin SUDAH "granted" dari sesi sebelumnya
// (token FCM bisa berubah/di-rotate browser, jadi wajib disinkron ulang tiap
// kali aplikasi dibuka, bukan cuma sekali seumur akun) — dan menyediakan
// `requestPermission()` untuk dipanggil dari tombol UI (mis. di Pengaturan)
// kalau izinnya belum pernah ditentukan. **Tombol itu SENDIRI belum dibuat
// di sesi ini** — langkah berikutnya.
//
// ── Kenapa `clearToken()` diekspos, TAPI belum dipanggil otomatis di sini ──
// Awalnya dicoba dengar event `SIGNED_OUT` dari
// `supabase.auth.onAuthStateChange()` untuk auto-hapus token saat logout —
// TERNYATA salah: supabase-js sudah menghapus sesi lokal SEBELUM event
// `SIGNED_OUT` ditembakkan, jadi panggilan RPC yang menyusul setelah event
// itu akan berjalan TANPA sesi (`auth.uid()` di database jadi NULL), dan
// `clear_my_fcm_token` akan menolaknya (lihat migration 023: "Tidak ada sesi
// login"). Kalau errornya ditelan diam-diam, token JUSTRU TIDAK PERNAH
// terhapus — bug senyap yang lebih buruk daripada tidak ada fitur ini sama
// sekali. Solusi yang benar: `clearToken()` WAJIB dipanggil SEBELUM
// `supabase.auth.signOut()` dijalankan (selagi sesi masih valid) — ini
// artinya `hooks/useAuth.ts` (fungsi `signOut()`) perlu disambungkan ke hook
// ini. **Belum dilakukan di sesi ini** (di luar scope "satu file per
// langkah") — dicatat di PROGRESS.md sebagai langkah berikutnya, jangan
// dianggap sudah otomatis jalan.
//
// ── Kenapa cuma satu efek pendaftaran (bukan langganan auth state) ──
// Satu-satunya tempat hook ini akan dipasang adalah shell aplikasi setelah
// login (`app/page.tsx`, langkah berikutnya) — route itu sendiri hanya bisa
// dirender kalau `middleware.ts` sudah memvalidasi sesi ada, jadi saat hook
// ini mount, sesi Supabase SUDAH pasti ada. Registrasi ulang otomatis tiap
// ganti sesi (login/logout/login lagi di tab yang sama tanpa reload) SENGAJA
// tidak ditangani — kasus itu jarang (kasir biasanya reload/buka tab baru
// tiap ganti shift), dicatat sebagai keterbatasan yang diketahui, bukan bug
// tersembunyi.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  listenForegroundMessages,
  requestFcmPermissionAndToken,
} from "@/lib/firebase/client";
import type { MessagePayload } from "firebase/messaging";

const supabase = createClient();

export type FcmStatus =
  /** Belum ada percobaan registrasi sama sekali sejak hook ini mount. */
  | "idle"
  /** Sedang meminta izin/token (menunggu `requestFcmPermissionAndToken()`/RPC). */
  | "checking"
  /** Token berhasil didaftarkan & tersimpan di `profiles.fcm_token`. */
  | "granted"
  /** User (pernah) menolak izin notifikasi di browser — browser TIDAK akan
   * menampilkan prompt lagi sampai user ubah manual dari pengaturan browser. */
  | "denied"
  /** Browser ini tidak mendukung Push API (mis. Safari lama, in-app browser
   * tertentu) — lihat `isSupported()` di `lib/firebase/client.ts`. */
  | "unsupported"
  /** Env var Firebase (`NEXT_PUBLIC_FIREBASE_VAPID_KEY`, dst.) belum diisi —
   * lihat catatan header `lib/firebase/client.ts`. */
  | "missing_config"
  /** Gagal karena sebab lain (network gagal daftar service worker, RPC gagal
   * simpan token ke database, dst.) — tidak dirinci lebih jauh ke pemanggil,
   * cukup untuk UI menampilkan "coba lagi nanti". */
  | "error";

interface UseFcmTokenResult {
  /** Status percobaan registrasi token FCM yang paling akhir. */
  status: FcmStatus;
  /** Notifikasi terakhir yang masuk SAAT aplikasi sedang terbuka (foreground).
   * `null` kalau belum ada yang masuk sejak hook ini mount. Notifikasi saat
   * aplikasi/tab TIDAK terbuka ditangani otomatis oleh
   * `public/firebase-messaging-sw.js`, bukan lewat sini. Hook ini SENGAJA
   * tidak menampilkan toast/UI apa pun sendiri — pemanggil (komponen) yang
   * memutuskan cara menampilkan `lastForegroundMessage`, langkah berikutnya. */
  lastForegroundMessage: MessagePayload | null;
  /** Panggil dari aksi user eksplisit (klik tombol "Aktifkan Notifikasi") —
   * akan memicu prompt izin browser kalau izin belum pernah ditentukan, atau
   * langsung mendaftar token kalau izin sudah "granted" sebelumnya. */
  requestPermission: () => Promise<void>;
  /** Hapus token milik device ini dari `profiles.fcm_token`. WAJIB dipanggil
   * SEBELUM `supabase.auth.signOut()`, lihat catatan header file ini — bukan
   * sesudahnya. Tidak melempar exception ke pemanggil kalau gagal (logout
   * tidak boleh terhambat gara-gara ini), cukup dicoba sebaik mungkin. */
  clearToken: () => Promise<void>;
}

export function useFcmToken(): UseFcmTokenResult {
  const [status, setStatus] = useState<FcmStatus>("idle");
  const [lastForegroundMessage, setLastForegroundMessage] =
    useState<MessagePayload | null>(null);
  // Cegah percobaan registrasi diam-diam dobel kalau efek re-run (mis. React
  // StrictMode double-invoke di development) — bukan proteksi terhadap klik
  // dobel tombol (itu tanggung jawab UI pemanggil di langkah berikutnya).
  const hasAttemptedSilentRegister = useRef(false);

  const registerToken = useCallback(async () => {
    setStatus("checking");

    const result = await requestFcmPermissionAndToken();
    if (!result.token) {
      setStatus(
        result.reason === "unsupported_browser"
          ? "unsupported"
          : result.reason === "permission_denied"
            ? "denied"
            : result.reason === "missing_vapid_key"
              ? "missing_config"
              : "error"
      );
      return;
    }

    const { error } = await supabase.rpc("save_my_fcm_token", {
      p_token: result.token,
    });
    if (error) {
      // Token berhasil didapat dari Firebase tapi gagal disimpan ke database
      // (mis. RPC migration 023 belum dijalankan, atau akun tidak aktif) —
      // dilaporkan sebagai "error", BUKAN "granted", supaya UI tidak salah
      // klaim notifikasi sudah aktif padahal server tidak tahu token ini.
      setStatus("error");
      return;
    }

    setStatus("granted");
  }, []);

  const clearToken = useCallback(async () => {
    try {
      await supabase.rpc("clear_my_fcm_token");
    } catch {
      // Diam-diam gagal — lihat catatan header file: dipanggil sebelum
      // signOut() supaya sesi masih valid, tapi tetap dijaga tidak melempar
      // supaya proses logout di pemanggil tidak pernah terhambat oleh ini.
    }
  }, []);

  // Registrasi diam-diam SEKALI saat mount, HANYA kalau izin browser sudah
  // "granted" dari sesi sebelumnya (lihat catatan header: tidak memicu
  // prompt otomatis di sini).
  useEffect(() => {
    if (hasAttemptedSilentRegister.current) return;
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission !== "granted") return;

    hasAttemptedSilentRegister.current = true;
    void registerToken();
  }, [registerToken]);

  // Dengarkan notifikasi foreground selama hook ini terpasang.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isCancelled = false;

    listenForegroundMessages((payload) => {
      setLastForegroundMessage(payload);
    }).then((unsub) => {
      if (isCancelled) {
        unsub?.();
      } else {
        unsubscribe = unsub;
      }
    });

    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, []);

  return {
    status,
    lastForegroundMessage,
    requestPermission: registerToken,
    clearToken,
  };
}