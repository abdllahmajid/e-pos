"use client";

// app/components/kasir/BarcodeScanModal.tsx
// ── TAMBAHAN (T-11 bagian 3) ── Scan barcode pakai kamera HP/tablet, pelengkap
// dari scan pakai alat scanner fisik yang SUDAH bisa dipakai lewat kolom
// pencarian biasa (scanner fisik mengetik seperti keyboard, lihat komentar di
// KasirModule.tsx). Komponen ini murni "kamera -> teks barcode" — TIDAK tahu
// apa-apa soal produk/keranjang, itu tanggung jawab KasirModule.tsx lewat
// prop `onScan`.
//
// ── KOREKSI ── Versi pertama kamera AUTO-START begitu modal dibuka (lewat
// useEffect saat isOpen jadi true). Ternyata itu bermasalah di HP: banyak
// browser mobile (terutama Safari iOS, dan sebagian Chrome Android dalam
// mode PWA/in-app browser) HANYA mau menampilkan prompt izin kamera kalau
// permintaannya terjadi LANGSUNG dari user gesture (tap tombol) — bukan dari
// efek React yang berjalan "sendiri" setelah komponen mount, walau modal-nya
// sendiri dibuka dari tombol. Rantai promise (dynamic import -> lookup
// elemen -> start()) membuat panggilan getUserMedia() jadi tidak lagi
// dianggap "langsung dari tap" oleh sebagian browser -> kamera gagal
// muncul, sering TANPA pesan error yang jelas ke user.
//
// PERBAIKAN: kamera tidak lagi auto-start. Modal terbuka dulu dalam kondisi
// "idle" (tombol besar "Aktifkan Kamera"), scanner BARU dibuat & di-start()
// di dalam handler onClick tombol itu SENDIRI — jadi permintaan izin kamera
// selalu satu langkah langsung dari tap user, di HP maupun desktop.
//
// Kenapa `html5-qrcode` tetap di-import dinamis (bukan `import` statis di
// atas)? Library ini menyentuh `navigator`/`document` saat load, yang tidak
// ada di server (Next.js SSR/build) — dynamic import di dalam handler klik
// (bukan cuma di useEffect) tetap aman untuk SSR DAN tetap terhitung sebagai
// bagian dari user gesture yang sama oleh browser (await sebelum getUserMedia
// tidak memutus rantai gesture, beda dengan efek yang berjalan tanpa gesture
// sama sekali).
//
// Kenapa pause()/resume(), bukan stop() tiap kali dapat 1 hasil scan? Kamera
// terus mengirim frame ~10x/detik (fps: 10) — kalau tidak di-pause sesaat
// setelah dapat hasil, barcode yang SAMA yang masih ada di frame akan
// ke-scan berkali-kali dalam waktu kurang dari 1 detik (produk yang sama
// bisa ke-tambah ke keranjang belasan kali dari satu kali sorot kamera).
// pause(true) menahan gambar terakhir di layar selama jeda singkat, resume()
// lanjut otomatis — kasir bisa scan produk berikutnya tanpa buka-tutup modal.

import { useEffect, useRef, useState } from "react";
import { X, Camera, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

const SCANNER_ELEMENT_ID = "kasir-barcode-scanner-region";
// Jeda antara satu scan berhasil & kamera aktif kembali — cukup lama supaya
// tidak dobel-scan barcode yang sama, cukup singkat supaya scan beruntun
// (banyak produk berbeda) tetap terasa responsif.
const RESUME_DELAY_MS = 1200;

export interface ScanFeedback {
  type: "success" | "error";
  message: string;
}

interface BarcodeScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Dipanggil setiap kamera berhasil membaca satu barcode (mentah, belum dicocokkan ke produk). */
  onScan: (barcode: string) => void;
  /** Pesan hasil pencarian produk dari scan terakhir (diisi oleh KasirModule setelah lookup), null = belum ada / sudah lewat. */
  feedback: ScanFeedback | null;
}

// Tipe minimal dari instance Html5Qrcode yang benar-benar dipakai di sini —
// dari library, bukan `any` mentah, tapi juga tidak import tipe library-nya
// secara statis (konsisten dengan alasan dynamic import di atas).
interface Html5QrcodeInstance {
  start: (
    cameraConfig: { facingMode: string },
    scanConfig: { fps: number; qrbox: { width: number; height: number } },
    onSuccess: (decodedText: string) => void,
    onFailure: (errorMessage: string) => void,
  ) => Promise<void>;
  pause: (shouldPauseVideo: boolean) => void;
  resume: () => void;
  stop: () => Promise<void>;
  clear: () => void;
}

type CameraPhase = "idle" | "starting" | "running" | "error";

export default function BarcodeScanModal({
  isOpen,
  onClose,
  onScan,
  feedback,
}: BarcodeScanModalProps) {
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const [phase, setPhase] = useState<CameraPhase>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Modal ditutup (dari luar, mis. tombol X atau ganti layar) -> matikan
  // kamera & reset ke "idle" supaya lain kali dibuka, tombol "Aktifkan
  // Kamera" muncul lagi (bukan langsung nyala sendiri — sesuai perbaikan di
  // atas, aktivasi SELALU dari tap tombol, termasuk saat modal dibuka ulang).
  useEffect(() => {
    if (isOpen) return;
    setPhase("idle");
    setCameraError(null);
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {
          // Kamera mungkin belum sempat start / sudah berhenti duluan — abaikan.
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // ── Dipanggil LANGSUNG dari onClick tombol "Aktifkan Kamera" — lihat
  // catatan header soal kenapa ini tidak boleh dipindah ke useEffect.
  async function handleActivateCamera() {
    setPhase("starting");
    setCameraError(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(
        SCANNER_ELEMENT_ID,
      ) as unknown as Html5QrcodeInstance;
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // Lihat catatan header soal pause/resume.
          scanner.pause(true);
          onScan(decodedText);
          setTimeout(() => {
            // Modal mungkin sudah ditutup sebelum jeda ini selesai —
            // scannerRef sudah di-null-kan oleh cleanup kalau begitu.
            if (scannerRef.current === scanner) {
              scanner.resume();
            }
          }, RESUME_DELAY_MS);
        },
        () => {
          // Dipanggil terus-menerus setiap frame TANPA barcode terdeteksi —
          // bukan error sungguhan, sengaja diabaikan (kalau ditampilkan ke
          // UI akan flicker puluhan kali per detik).
        },
      );

      setPhase("running");
    } catch {
      setPhase("error");
      setCameraError(
        'Tidak bisa mengakses kamera. Pastikan Anda menekan "Izinkan" saat browser minta izin kamera, dan situs diakses lewat HTTPS (atau localhost).',
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Camera className="h-4 w-4 text-lco-teal" />
            Scan Barcode
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {/* Elemen kamera SELALU dirender selama modal terbuka (bukan cuma
              saat phase === "running") — Html5Qrcode butuh elemen ini SUDAH
              ada di DOM pas start() dipanggil. Overlay di atasnya yang
              berubah-ubah sesuai phase, bukan elemen kamera-nya sendiri. */}
          <div className="relative min-h-[250px] overflow-hidden rounded-md bg-black">
            <div
              id={SCANNER_ELEMENT_ID}
              className="[&_video]:w-full [&_video]:h-full [&_video]:object-cover"
            />

            {phase !== "running" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900 p-4 text-center">
                {phase === "starting" ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                    <p className="text-xs text-white/70">Membuka kamera...</p>
                  </>
                ) : phase === "error" ? (
                  <>
                    <AlertTriangle className="h-7 w-7 text-lco-coral" />
                    <p className="text-xs text-white/80">{cameraError}</p>
                    <button
                      onClick={handleActivateCamera}
                      className="mt-1 rounded-md bg-lco-teal px-4 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:opacity-90"
                    >
                      Coba Lagi
                    </button>
                  </>
                ) : (
                  <>
                    <Camera className="h-8 w-8 text-white/60" />
                    <button
                      onClick={handleActivateCamera}
                      className="rounded-md bg-lco-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90"
                    >
                      Aktifkan Kamera
                    </button>
                    <p className="text-[11px] text-white/50">
                      Browser akan minta izin akses kamera.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {phase === "running" && (
            <p className="mt-2 text-center text-[11px] text-zinc-400">
              Arahkan kamera ke barcode produk.
            </p>
          )}

          {/* ── Feedback hasil scan terakhir (diisi KasirModule setelah lookup produk). ── */}
          {feedback && (
            <div
              className={`mt-3 flex items-center gap-2 rounded-md p-2.5 text-xs ${
                feedback.type === "success"
                  ? "border border-lco-green/30 bg-lco-green/5 text-lco-green"
                  : "border border-lco-coral/30 bg-lco-coral/5 text-lco-coral"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
