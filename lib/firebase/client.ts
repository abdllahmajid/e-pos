import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getMessaging,
  isSupported,
  getToken,
  onMessage,
  type Messaging,
  type MessagePayload,
} from "firebase/messaging";

/**
 * Wrapper Firebase untuk FCM (push notification), PRD §17 T-12.
 *
 * Pola sengaja disamakan dengan `lib/supabase/client.ts`: file ini CUMA
 * factory/wrapper SDK murni, TIDAK menyentuh Supabase/`profiles` sama sekali.
 * Simpan token ke `profiles.fcm_token` (migration `022`) jadi tanggung jawab
 * hook terpisah (`hooks/useFcmToken.ts`, langkah berikutnya) — supaya file
 * ini bisa dites/dipakai lepas dari Supabase, dan supaya "logika Firebase"
 * vs "logika nyimpan ke database" tidak campur di satu file besar.
 *
 * ── Kenapa banyak pengecekan `typeof window` / `isSupported()` ──
 * 1. Next.js merender sebagian komponen di server (SSR) — `firebase/messaging`
 *    memakai API browser (`navigator.serviceWorker`, IndexedDB) yang tidak ada
 *    sama sekali di Node.js. Import modul ini sendiri aman di server (tidak
 *    mengeksekusi apa-apa saat di-import), tapi MEMANGGIL fungsi apa pun di
 *    sini di server akan crash — makanya semua fungsi publik di file ini
 *    WAJIB dipanggil dari Client Component ("use client"), sama seperti
 *    `lib/supabase/client.ts`.
 * 2. `isSupported()` dari SDK Firebase mengecek browser SECARA SPESIFIK:
 *    Safari versi lama & beberapa in-app browser (mis. WebView Instagram/TikTok)
 *    TIDAK punya Push API sama sekali, walau `window` ada. Toko ini kemungkinan
 *    besar dibuka dari HP kasir dengan browser yang jelas (Chrome/Edge), tapi
 *    pengecekan ini tetap wajib supaya gagal dengan rapi (`null`), bukan
 *    exception yang bisa menjatuhkan seluruh halaman Kasir.
 *
 * ── Kenapa VAPID key & config Firebase taruh di NEXT_PUBLIC_* ──
 * Semua nilai ini (apiKey, VAPID public key, dst.) MEMANG didesain publik oleh
 * Firebase sendiri — dibaca browser untuk daftar ke layanan push, bukan
 * kredensial rahasia (beda dari service account key server-side yang dipakai
 * `/api/send-notification`, langkah T-12 berikutnya, dan TIDAK BOLEH pernah
 * diawali `NEXT_PUBLIC_`). Sama seperti `NEXT_PUBLIC_SUPABASE_ANON_KEY` yang
 * juga aman diekspos karena dibatasi RLS, keamanan FCM ada di sisi lain
 * (registration token per-device + aturan siapa yang boleh trigger kirim).
 *
 * ── WAJIB diisi sebelum fitur ini jalan (belum ada di sesi ini) ──
 * `.env.local`:
 *   NEXT_PUBLIC_FIREBASE_API_KEY=...
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
 *   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
 *   NEXT_PUBLIC_FIREBASE_APP_ID=...
 *   NEXT_PUBLIC_FIREBASE_VAPID_KEY=...   (Firebase Console → Project Settings
 *     → Cloud Messaging → Web Push certificates → "Key pair")
 * Semua nilai ini disalin dari Firebase Console, BUKAN dikarang di sini.
 */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Path service worker FCM — file-nya dibuat di langkah berikutnya
 * (`public/firebase-messaging-sw.js`). Sengaja HARDCODE root path `/`
 * (bukan di dalam subfolder) karena scope default service worker dibatasi
 * ke folder tempat filenya berada — taruh di subfolder berarti notifikasi
 * background cuma aktif untuk halaman di bawah subfolder itu, bukan seluruh
 * aplikasi. */
const SERVICE_WORKER_PATH = "/firebase-messaging-sw.js";

let cachedApp: FirebaseApp | null = null;

/** Ambil (atau buat sekali) instance FirebaseApp.
 * Pola `getApps().length ? getApp() : initializeApp(...)` WAJIB dipakai (bukan
 * `initializeApp()` polos) — konsisten dengan alasan Next.js dev mode
 * (Fast Refresh) bisa menjalankan ulang modul client tanpa full page reload,
 * dan Firebase melempar error "duplicate app" kalau `initializeApp` dipanggil
 * dua kali untuk app default yang sama. */
function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  cachedApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return cachedApp;
}

/** Cek dukungan browser LALU kembalikan instance Messaging, atau `null` kalau
 * tidak didukung / dipanggil di server. Semua fungsi publik lain di bawah
 * WAJIB lewat fungsi ini dulu, jangan panggil `getMessaging()` langsung. */
async function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null;
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  return getMessaging(getFirebaseApp());
}

export interface FcmPermissionResult {
  /** `null` kalau browser tidak didukung, izin ditolak, atau env var belum diisi. */
  token: string | null;
  /** Alasan singkat untuk ditampilkan/di-log kalau `token` null — bukan untuk
   * ditampilkan mentah-mentah ke user awam, tapi supaya hook pemanggil tahu
   * harus menampilkan pesan apa (§18 poin 5: validasi ringan boleh di client). */
  reason:
    | "ok"
    | "unsupported_browser"
    | "permission_denied"
    | "missing_vapid_key"
    | "error";
}

/**
 * Minta izin notifikasi browser (kalau belum pernah ditanya/ditolak), daftarkan
 * service worker FCM, lalu ambil registration token.
 *
 * Sengaja TIDAK menyimpan token ke mana pun di sini (lihat catatan header file)
 * — pemanggil (hook) yang menyimpan ke `profiles.fcm_token`.
 */
export async function requestFcmPermissionAndToken(): Promise<FcmPermissionResult> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    // Tidak melempar exception — env belum diisi itu keadaan wajar sebelum
    // setup Firebase Console selesai, bukan bug kode.
    return { token: null, reason: "missing_vapid_key" };
  }

  const messaging = await getMessagingInstance();
  if (!messaging) {
    return { token: null, reason: "unsupported_browser" };
  }

  try {
    // `Notification.requestPermission()` browser TIDAK menampilkan prompt lagi
    // kalau user sudah pernah menjawab (izinkan/tolak) — ini perilaku browser,
    // bukan sesuatu yang bisa/perlu dipaksa dari kode.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { token: null, reason: "permission_denied" };
    }

    const registration = await navigator.serviceWorker.register(
      SERVICE_WORKER_PATH
    );

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    return { token: token || null, reason: token ? "ok" : "error" };
  } catch {
    // Sengaja tidak dirinci error-nya ke pemanggil — kemungkinan penyebab
    // (network gagal daftar service worker, VAPID key salah, dst.) sama-sama
    // berujung "notifikasi tidak aktif", cukup dicatat sebagai "error" generik.
    return { token: null, reason: "error" };
  }
}

/**
 * Dengarkan notifikasi yang masuk SAAT APLIKASI SEDANG DIBUKA (foreground).
 * Notifikasi saat tab/aplikasi TIDAK dibuka ditangani otomatis oleh
 * `public/firebase-messaging-sw.js` (langkah berikutnya), bukan fungsi ini.
 *
 * Mengembalikan fungsi unsubscribe (atau `undefined` kalau messaging tidak
 * didukung) — pemanggil (hook) WAJIB memanggilnya saat unmount, pola sama
 * seperti `useEffect` cleanup di `hooks/useAuth.ts`.
 */
export async function listenForegroundMessages(
  onMessageReceived: (payload: MessagePayload) => void
): Promise<(() => void) | undefined> {
  const messaging = await getMessagingInstance();
  if (!messaging) return undefined;
  return onMessage(messaging, onMessageReceived);
}