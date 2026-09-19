// lib/notifications/sendPush.ts
// ── TAMBAHAN ── Logika INTI kirim push notification FCM (PRD §17 T-12,
// bagian "FCM"). Dipisah dari `app/api/send-notification/route.ts` SENGAJA
// supaya bisa dipanggil LANGSUNG (import biasa, tanpa HTTP roundtrip) dari
// kode server lain yang berjalan di proses Next.js yang sama — terutama
// `/api/cron/daily-summary` (T-12 bagian lain, belum dibuat sesi ini).
// Kalau logika ini ditaruh di dalam route.ts saja, cron route TERPAKSA
// `fetch()` balik ke endpoint sendiri (lambat, dan gagal aneh kalau env
// hosting membatasi request self-referencing) — pola yang sama seharusnya
// dihindari dipakai ulang lewat import fungsi biasa, bukan HTTP.
//
// ── Kenapa pakai Supabase SERVICE ROLE di sini, bukan RLS biasa ──
// Fungsi ini perlu baca `profiles.fcm_token` milik USER LAIN (target
// notifikasi), BUKAN milik pemanggil — policy `profiles_select_own`
// (migration 002) tidak akan mengizinkan ini untuk role kasir biasa lewat
// client ANON. Pola sama persis dengan `app/api/admin/create-user/route.ts`:
// validasi izin pemanggil dilakukan DI LUAR fungsi ini (di route.ts, lewat
// cookie sesi), fungsi ini sendiri "mempercayai" bahwa siapa pun yang
// memanggilnya SUDAH divalidasi — makanya fungsi ini TIDAK diekspor ke
// client/browser sama sekali (tidak ada "use client", memang tidak boleh).

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

let cachedAdminApp: App | null = null;

/** Pola sama dengan `getFirebaseApp()` di `lib/firebase/client.ts`
 * (`getApps().length ? ... : initializeApp(...)`) — mencegah error
 * "duplicate app" kalau fungsi ini dipanggil berkali-kali dalam satu proses
 * Node yang sama (mis. beberapa notifikasi dikirim berurutan dari
 * `/api/cron/daily-summary`). */
function getFirebaseAdminApp(): App {
  if (cachedAdminApp) return cachedAdminApp;
  if (getApps().length) {
    cachedAdminApp = getApps()[0];
    return cachedAdminApp;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // ── Kenapa `.replace(/\\n/g, "\n")` ──
  // Private key service account asli mengandung baris baru (`\n` sungguhan).
  // Kebanyakan hosting (Vercel dkk.) menyimpan env var sebagai satu baris teks
  // -- newline sungguhan di value env var sering bikin masalah copy-paste /
  // parsing, jadi konvensi umum: simpan di .env dengan `\n` LITERAL (dua
  // karakter backslash-n), lalu program yang mengubahnya jadi newline
  // sungguhan saat dibaca. Kalau tidak di-replace, `cert()` akan gagal
  // parse key ini dan melempar error samar soal format PEM.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Kredensial Firebase Admin belum lengkap. Wajib diisi di environment " +
        "server (BUKAN NEXT_PUBLIC_*): FIREBASE_ADMIN_PROJECT_ID, " +
        "FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY — ketiganya " +
        "disalin dari file JSON service account (Firebase Console -> Project " +
        "Settings -> Service Accounts -> Generate new private key)."
    );
  }

  cachedAdminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return cachedAdminApp;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  /** Kalau diisi, dipakai `notificationclick` di
   * `public/firebase-messaging-sw.js` untuk tahu halaman mana yang harus
   * dibuka/difokuskan saat notifikasi diklik. Path relatif, mis. "/laporan". */
  url?: string;
}

export type SendPushResult =
  | { status: "sent" }
  /** User target tidak (atau belum) punya `fcm_token` tersimpan — BUKAN
   * error, keadaan wajar untuk user yang belum pernah mengaktifkan
   * notifikasi (lihat `hooks/useFcmToken.ts`). Pemanggil TIDAK perlu
   * menampilkan ini sebagai kegagalan ke siapa pun. */
  | { status: "no_token" }
  /** Token yang tersimpan sudah basi/dicabut FCM (device uninstall, izin
   * dicabut lewat OS, dst.) — otomatis dibersihkan dari `profiles.fcm_token`
   * di sini supaya percobaan kirim berikutnya (mis. dari cron) tidak
   * mengulang kegagalan yang sama terus-menerus. */
  | { status: "invalid_token_cleared" }
  | { status: "error"; message: string };

/**
 * Kirim SATU push notification ke SATU user (lewat token FCM yang tersimpan
 * di `profiles.fcm_token`, migration 022). Pemanggil (route.ts, atau nanti
 * cron) WAJIB sudah memvalidasi bahwa pemanggil ASLI (bukan target) berhak
 * memicu ini — fungsi ini sendiri tidak melakukan pengecekan permission apa
 * pun, lihat komentar header file.
 */
export async function sendPushToUser(
  targetUserId: string,
  payload: PushNotificationPayload
): Promise<SendPushResult> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return {
      status: "error",
      message: "SUPABASE_SERVICE_ROLE_KEY belum diset di environment server.",
    };
  }

  const supabaseAdmin = createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("fcm_token")
    .eq("id", targetUserId)
    .single();

  if (profileError || !profile?.fcm_token) {
    return { status: "no_token" };
  }

  try {
    getFirebaseAdminApp();
    await getMessaging().send({
      token: profile.fcm_token,
      notification: { title: payload.title, body: payload.body },
      // `data` (bukan cuma `notification`) WAJIB disertakan supaya
      // `payload.data.url` bisa dibaca `onBackgroundMessage` di
      // `public/firebase-messaging-sw.js` — pesan yang CUMA berisi
      // `notification` tanpa `data` tetap tampil, tapi klik-nya tidak akan
      // tahu mau membuka halaman apa (fallback ke "/" di service worker).
      data: payload.url ? { url: payload.url } : undefined,
    });
    return { status: "sent" };
  } catch (err) {
    const code =
      (err as { errorInfo?: { code?: string }; code?: string })?.errorInfo
        ?.code ?? (err as { code?: string })?.code;

    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      await supabaseAdmin
        .from("profiles")
        .update({ fcm_token: null, fcm_token_updated_at: new Date().toISOString() })
        .eq("id", targetUserId);
      return { status: "invalid_token_cleared" };
    }

    return {
      status: "error",
      message: err instanceof Error ? err.message : "Gagal mengirim notifikasi.",
    };
  }
}