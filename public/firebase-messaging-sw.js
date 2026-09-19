// Service worker FCM — PRD §17 T-12 (bagian "FCM").
//
// ── WAJIB tetap di root `public/`, TIDAK BOLEH dipindah ke subfolder ──
// Scope default sebuah service worker dibatasi ke folder tempat file ini
// disajikan (mis. kalau ada di `/sw/firebase-messaging-sw.js`, dia CUMA aktif
// untuk halaman di bawah `/sw/`). Path ini sudah di-hardcode sebagai konstanta
// `SERVICE_WORKER_PATH` di `lib/firebase/client.ts` — kalau nama/lokasi file
// ini diubah, WAJIB ikut ubah konstanta itu juga, dua-duanya harus sinkron.
//
// ── Kenapa file ini PLAIN JS + `importScripts`, BUKAN import dari
//    `lib/firebase/client.ts` yang sudah ada ──
// Service worker berjalan di thread/proses TERPISAH dari halaman web biasa,
// dan Next.js tidak meng-compile apa pun di dalam `public/` (folder ini
// disajikan APA ADANYA, mentah). Artinya file ini TIDAK BISA memakai
// `import`/TypeScript/bundtownship modul npm seperti file lain di project
// ini — satu-satunya cara memuat Firebase SDK di sini adalah `importScripts()`
// memuat build "compat" Firebase langsung dari CDN gstatic (pola resmi yang
// didokumentasikan Firebase sendiri untuk kasus ini, bukan workaround project
// ini). Konsekuensinya: sintaks di file ini beda gaya (global `firebase.*`,
// bukan `import { ... } from "firebase/..."`) dari file lain di codebase —
// itu MEMANG SEHARUSNYA begitu di file khusus ini.
//
// ── Kenapa `firebaseConfig` di bawah DITULIS ULANG (duplikat), bukan baca
//    `NEXT_PUBLIC_FIREBASE_*` yang sama dengan `lib/firebase/client.ts` ──
// File statis di `public/` disajikan mentah SEBELUM Next.js sempat menyuntik
// env var apa pun ke dalamnya (beda dari kode di `app/`/`lib/`/`hooks/` yang
// di-build ulang tiap deploy) — jadi TIDAK ADA cara menyuntik env var ke file
// ini tanpa menambah route/rewrite khusus, yang sengaja belum dilakukan sesi
// ini demi kesederhanaan (§18 poin 8: jangan menambah kerumitan tanpa alasan
// kuat di PRD). Ini AMAN dilakukan karena SEMUA nilai `firebaseConfig` memang
// didesain publik oleh Firebase sendiri (lihat komentar `lib/firebase/client.ts`
// soal `NEXT_PUBLIC_*`) — bukan kredensial rahasia yang bocor kalau
// di-hardcode di file yang bisa diakses siapa pun lewat browser.
// **WAJIB DIISI MANUAL, PERSIS SAMA dengan 6 nilai `NEXT_PUBLIC_FIREBASE_*`
// (kecuali VAPID key, itu TIDAK dipakai di sini) di `.env.local`** — kalau
// nanti nilainya diganti di Firebase Console, file ini WAJIB ikut diperbarui
// manual, tidak otomatis sinkron.
// `importScripts` WAJIB dipanggil DULU sebelum `firebase.initializeApp()` —
// ini yang mendaftarkan variabel global `firebase` yang dipakai baris-baris
// setelahnya (beda dari `import` ES module yang bisa diletakkan di mana saja,
// `importScripts` klasik ini bekerja sinkron top-to-bottom apa adanya).
importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
importScripts(
  "https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "ISI_SAMA_PERSIS_DENGAN_NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "ISI_SAMA_PERSIS_DENGAN_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "ISI_SAMA_PERSIS_DENGAN_NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "ISI_SAMA_PERSIS_DENGAN_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId:
    "ISI_SAMA_PERSIS_DENGAN_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "ISI_SAMA_PERSIS_DENGAN_NEXT_PUBLIC_FIREBASE_APP_ID",
});

const messaging = firebase.messaging();

// ── Notifikasi saat aplikasi TERTUTUP/di-background ──
// Notifikasi saat aplikasi SEDANG DIBUKA ditangani `listenForegroundMessages()`
// di `lib/firebase/client.ts` (foreground) — bukan handler ini. Firebase SDK
// otomatis memilih salah satu dari keduanya tergantung status tab, TIDAK
// pernah dua-duanya sekaligus untuk 1 notifikasi yang sama.
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification?.title || "LCO POS";
  const notificationOptions = {
    body: payload.notification?.body || "",
    // Path ikon PWA belum ada sesi ini — disiapkan di langkah "PWA manifest +
    // icon" (T-12 bagian terakhir). Browser akan diam-diam pakai ikon default
    // kalau path ini 404, TIDAK bikin notifikasi gagal tampil — aman
    // sementara sampai ikon aslinya dibuat.
    icon: "/icons/icon-192.png",
    // `data` dibawa apa adanya dari payload server (`/api/send-notification`,
    // langkah T-12 berikutnya) — dipakai `notificationclick` di bawah untuk
    // tahu halaman mana yang harus dibuka saat notifikasi diklik.
    data: payload.data || {},
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ── Klik notifikasi → fokus tab yang sudah terbuka, atau buka tab baru ──
// Pola ini standar PWA (bukan bagian Firebase SDK) — dicoba fokus ke tab yang
// SUDAH terbuka ke URL tujuan dulu sebelum buka tab baru, supaya kasir yang
// sudah punya aplikasi ini terbuka tidak berakhir dengan banyak tab duplikat
// tiap kali ada notifikasi baru.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});