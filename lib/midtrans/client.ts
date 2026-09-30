// lib/midtrans/client.ts
// ── TAMBAHAN (Midtrans, langkah 6) ── Helper sisi BROWSER untuk pembayaran
// digital: buat order lewat API route, buka popup Snap, dan menunggu sampai
// pembayaran lunas.
//
// File ini TIDAK memegang kunci rahasia apa pun. Client Key + URL snap.js
// dikirim server bersama token (lihat app/api/midtrans/create), jadi mode
// sandbox/production selalu mengikuti konfigurasi server.
//
// Cara pakai (dipasang di PaymentModal pada langkah 7):
//   const order = await createMidtransOrder({ amount: total });
//   await openSnapPopup(order, { onClose: ... });
//   const result = await waitForMidtransResult(order.orderId, { ... });
//   if (result.status === "paid") -> simpan transaksi dengan order.orderId

export type DigitalPaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled";

export interface MidtransOrder {
  orderId: string;
  token: string;
  clientKey: string;
  snapJsUrl: string;
  amount: number;
  /** ISO time: setelah ini tagihan tidak bisa dibayar lagi. */
  expiresAt: string;
  /** true kalau server memakai ulang order pending yang sama. */
  reused: boolean;
}

export interface MidtransStatusResult {
  orderId: string;
  status: DigitalPaymentStatus;
  midtransStatus: string | null;
  paymentType: string | null;
  amount: number;
  /** true kalau order ini sudah dipakai menyimpan sebuah transaksi. */
  used: boolean;
}

interface SnapCallbacks {
  onSuccess?: (result: unknown) => void;
  onPending?: (result: unknown) => void;
  onError?: (result: unknown) => void;
  onClose?: () => void;
}

declare global {
  interface Window {
    snap?: {
      pay: (token: string, callbacks?: SnapCallbacks) => void;
      hide?: () => void;
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Panggilan ke API route kita
// ─────────────────────────────────────────────────────────────────────

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : fallbackMessage;
    throw new Error(message);
  }
  return data as T;
}

export async function createMidtransOrder(params: {
  amount: number;
  customerName?: string;
  customerPhone?: string;
  /** Order pending sebelumnya — dipakai ulang kalau masih layak. */
  reuseOrderId?: string;
}): Promise<MidtransOrder> {
  const res = await fetch("/api/midtrans/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return readJson<MidtransOrder>(res, "Gagal membuat pembayaran digital.");
}

export async function getMidtransStatus(
  orderId: string,
  signal?: AbortSignal,
): Promise<MidtransStatusResult> {
  const res = await fetch(
    `/api/midtrans/status?order_id=${encodeURIComponent(orderId)}`,
    { cache: "no-store", signal },
  );
  return readJson<MidtransStatusResult>(res, "Gagal mengecek status pembayaran.");
}

/**
 * Batalkan order yang belum dibayar. Hasilnya WAJIB dibaca pemanggil: kalau
 * `status` ternyata "paid", pelanggan sudah membayar di detik terakhir dan
 * transaksi harus tetap disimpan, bukan dibatalkan.
 */
export async function cancelMidtransOrder(
  orderId: string,
): Promise<MidtransStatusResult> {
  const res = await fetch("/api/midtrans/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  return readJson<MidtransStatusResult>(res, "Gagal membatalkan pembayaran.");
}

// ─────────────────────────────────────────────────────────────────────
// snap.js
// ─────────────────────────────────────────────────────────────────────

let snapScriptPromise: Promise<void> | null = null;
let snapScriptKey: string | null = null;

export function loadSnapScript(
  snapJsUrl: string,
  clientKey: string,
): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Snap hanya bisa dimuat di browser."));
  }

  const key = `${snapJsUrl}|${clientKey}`;
  if (snapScriptPromise && snapScriptKey === key) return snapScriptPromise;

  // Mode/kunci berubah (mis. pindah sandbox -> production): buang yang lama.
  document
    .querySelectorAll("script[data-midtrans-snap]")
    .forEach((el) => el.remove());
  delete window.snap;

  snapScriptKey = key;
  snapScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = snapJsUrl;
    script.async = true;
    script.setAttribute("data-client-key", clientKey);
    script.setAttribute("data-midtrans-snap", "true");
    script.onload = () => resolve();
    script.onerror = () => {
      // Izinkan mencoba lagi pada panggilan berikutnya.
      snapScriptPromise = null;
      snapScriptKey = null;
      script.remove();
      reject(
        new Error(
          "Gagal memuat Midtrans Snap. Periksa koneksi internet lalu coba lagi.",
        ),
      );
    };
    document.head.appendChild(script);
  });

  return snapScriptPromise;
}

/** Buka (atau buka ulang) popup pembayaran Snap untuk sebuah order. */
export async function openSnapPopup(
  order: Pick<MidtransOrder, "token" | "clientKey" | "snapJsUrl">,
  callbacks: SnapCallbacks = {},
): Promise<void> {
  await loadSnapScript(order.snapJsUrl, order.clientKey);
  if (!window.snap) {
    throw new Error("Midtrans Snap tidak tersedia.");
  }
  // Snap tidak suka dibuka dua kali bersamaan — tutup dulu kalau masih ada.
  window.snap.hide?.();
  window.snap.pay(order.token, callbacks);
}

export function closeSnapPopup(): void {
  if (typeof window !== "undefined") window.snap?.hide?.();
}

// ─────────────────────────────────────────────────────────────────────
// Menunggu hasil pembayaran
// ─────────────────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Dibatalkan", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Dibatalkan", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Polling status sampai berubah dari "pending". Selesai (resolve) saat status
 * menjadi paid / failed / expired / cancelled. Melempar AbortError kalau
 * `signal` dibatalkan (mis. kasir menekan Batalkan / menutup modal).
 *
 * - Gangguan jaringan sesaat ditoleransi (maks 5x berturut-turut).
 * - Kalau lewat `expiresAt` + 30 detik dan server masih bilang pending,
 *   dianggap "expired" di sisi layar supaya kasir tidak menunggu selamanya.
 */
export async function waitForMidtransResult(
  orderId: string,
  options: {
    intervalMs?: number;
    signal?: AbortSignal;
    expiresAt?: string;
    onUpdate?: (result: MidtransStatusResult) => void;
  } = {},
): Promise<MidtransStatusResult> {
  const { intervalMs = 3000, signal, expiresAt, onUpdate } = options;
  const deadline = expiresAt ? new Date(expiresAt).getTime() + 30_000 : null;
  let consecutiveErrors = 0;
  let last: MidtransStatusResult | null = null;

  for (;;) {
    if (signal?.aborted) throw new DOMException("Dibatalkan", "AbortError");

    try {
      const result = await getMidtransStatus(orderId, signal);
      consecutiveErrors = 0;
      last = result;
      onUpdate?.(result);
      if (result.status !== "pending") return result;
    } catch (err) {
      if (isAbortError(err)) throw err;
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) throw err;
    }

    if (deadline !== null && Date.now() > deadline) {
      return {
        orderId,
        status: "expired",
        midtransStatus: last?.midtransStatus ?? null,
        paymentType: last?.paymentType ?? null,
        amount: last?.amount ?? 0,
        used: false,
      };
    }

    await sleep(intervalMs, signal);
  }
}