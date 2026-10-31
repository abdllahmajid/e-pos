// hooks/usePrinterProfiles.ts
// ── TAMBAHAN (Pengaturan > Printer) ── Hook tab baru "Setting Printer":
// kelola daftar printer, cari printer aktif (Bluetooth/USB), tes koneksi,
// tes print, dan pilih printer default.
//
// ── Kenapa disimpan di localStorage, BUKAN tabel `settings`/tabel baru di
// Supabase (pola sama seperti hooks/useThemePreference.ts) ── Printer
// adalah perangkat FISIK yang tercolok/terpasang di SATU device kasir
// tertentu — printer Bluetooth/USB yang tersambung di komputer kasir depan
// tidak relevan sama sekali untuk device kasir belakang, beda dari
// pengaturan toko (PPN, nama toko, dst) yang memang harus sama di semua
// device. Konsekuensinya:
// 1. Tidak butuh RLS/tabel baru — murni per-browser, tidak perlu disinkron.
// 2. TIDAK digate lewat permission_key seperti 3 sub-tab Pengaturan lainnya
//    (toko/admin/role, lihat PengaturanModule.tsx) — siapa pun yang sudah
//    bisa membuka menu Pengaturan (di-gate SEKALI di level modul) boleh
//    mengatur printer device yang sedang dia pakai sendiri, termasuk kasir
//    non-admin yang perlu menyambungkan printer di stasiunnya.
//
// ── Kenapa "device handle" (objek BluetoothDevice/USBDevice asli) TIDAK
// ikut disimpan ── objek itu tidak bisa di-JSON.stringify (bukan data,
// referensi live ke browser) dan memang TIDAK PERLU — yang disimpan cuma
// metadata (id Bluetooth / vendorId+productId USB). Device asli dicari lagi
// via `getPairedBluetoothDevices()`/`getAuthorizedUsbDevices()` saat
// dibutuhkan (tes koneksi/print), lalu disimpan SEMENTARA di
// `deviceRegistryRef` (bukan state — tidak boleh memicu re-render & tidak
// boleh ikut ke localStorage).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildReceiptBytes,
  buildTestPrintBytes,
  disconnectBluetoothPrinter,
  getAuthorizedUsbDevices,
  getPairedBluetoothDevices,
  isWebBluetoothSupported,
  isWebUsbSupported,
  reconnectBluetoothPrinter,
  requestBluetoothPrinter,
  requestUsbPrinter,
  writeToBluetoothPrinter,
  writeToUsbPrinter,
  type MinimalBluetoothDevice,
  type MinimalBluetoothRemoteGATTCharacteristic,
  type MinimalUsbDevice,
} from "@/lib/pos/printerConnection";
import {
  printBrowserTestPage,
  printThermalReceipt,
  type ReceiptData,
} from "@/lib/pos/printLogic";
import { loadReceiptBrand } from "@/lib/pos/receiptBrand";
import { loadReceiptQr } from "@/lib/pos/receiptQr";

export type PrinterConnectionType = "bluetooth" | "usb" | "browser";
export type PrinterStatus = "connected" | "disconnected" | "unknown";

export interface PrinterProfile {
  id: string;
  name: string;
  connectionType: PrinterConnectionType;
  isDefault: boolean;
  createdAt: string;
  lastConnectedAt?: string;
  bluetoothId?: string;
  usbVendorId?: number;
  usbProductId?: number;
}

export type PrinterActionResult = { ok: true } | { ok: false; error: string };

const STORAGE_KEY = "lco-pos-printers";

// Profil tetap untuk printer yang dipanggil lewat dialog cetak bawaan
// browser (lihat catatan header lib/pos/printerConnection.ts) — SELALU ada,
// tidak bisa dihapus, supaya toko yang belum sempat menyambungkan printer
// Bluetooth/USB apa pun tetap punya cara mencetak (persis perilaku sebelum
// tab ini ada).
const BROWSER_PRINTER_ID = "browser-default";

function makeBrowserProfile(isDefault: boolean): PrinterProfile {
  return {
    id: BROWSER_PRINTER_ID,
    name: "Printer Sistem (Browser)",
    connectionType: "browser",
    isDefault,
    createdAt: new Date(0).toISOString(),
  };
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `printer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pastikan tepat SATU profil `isDefault: true`, dan profil browser selalu ada. */
function normalizeProfiles(list: PrinterProfile[]): PrinterProfile[] {
  const hasBrowser = list.some((p) => p.id === BROWSER_PRINTER_ID);
  const next = hasBrowser ? [...list] : [makeBrowserProfile(true), ...list];

  const defaultCount = next.filter((p) => p.isDefault).length;
  if (defaultCount === 1) return next;

  // 0 atau >1 default (data korup/lama) — reset ke browser saja sebagai default.
  return next.map((p) => ({ ...p, isDefault: p.id === BROWSER_PRINTER_ID }));
}

function loadFromStorage(): PrinterProfile[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeProfiles([]);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return normalizeProfiles([]);
    return normalizeProfiles(parsed as PrinterProfile[]);
  } catch {
    return normalizeProfiles([]);
  }
}

function saveToStorage(list: PrinterProfile[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Kuota penuh / mode privat — perubahan tetap berlaku untuk sesi ini,
    // cuma tidak akan diingat setelah halaman dimuat ulang.
  }
}

/** Terjemahkan error Web Bluetooth/WebUSB jadi pesan yang dipahami kasir. */
function friendlyPrinterError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("user cancelled") || lower.includes("cancel")) {
    return "Dibatalkan.";
  }
  if (lower.includes("not found") || lower.includes("tidak ditemukan")) {
    return "Printer tidak ditemukan — pastikan menyala, dalam jangkauan, dan sudah pernah dipasangkan lewat 'Cari Printer'.";
  }
  if (lower.includes("gatt") || lower.includes("disconnected")) {
    return "Printer tidak merespons. Pastikan printer menyala & dalam jangkauan, lalu coba lagi.";
  }
  if (lower.includes("security") || lower.includes("permission")) {
    return "Izin akses perangkat ditolak browser.";
  }
  return message || "Gagal menyambungkan ke printer.";
}

// Handle device yang SEDANG tersambung, disimpan di luar state React (lihat
// catatan header) — key-nya `profile.id`.
type DeviceRegistryEntry =
  | {
      type: "bluetooth";
      device: MinimalBluetoothDevice;
      characteristic: MinimalBluetoothRemoteGATTCharacteristic;
    }
  | { type: "usb"; device: MinimalUsbDevice };

// ── PERUBAHAN (koneksi printer bertahan antar menu) ── Hook ini dipanggil di
// banyak komponen (PengaturanPrinterTab, KasirModule, TransactionDetailModal)
// dan tiap komponen dibuang saat pindah menu. Kalau handle device disimpan di
// useRef biasa, setiap pindah menu semuanya hilang & printer terlihat
// "terputus", padahal koneksi Bluetooth-nya sendiri masih hidup. Karena itu
// handle disimpan di level MODUL (satu salinan per halaman) dan hook cuma
// menunjuk ke sana lewat useRef(sharedObjek).
const sharedDeviceRegistry = new Map<string, DeviceRegistryEntry>();
const sharedScannedBluetooth = new Map<string, MinimalBluetoothDevice>();

// ── PERBAIKAN (koneksi bertahan setelah refresh) ── Seluruh logika
// "sambung & jaga koneksi Bluetooth" ada di level MODUL (bukan di dalam hook),
// karena hook ini dipasang di banyak komponen sekaligus dan tiap komponen
// bisa dibuang kapan saja. Komponen cukup berlangganan status lewat
// `statusListeners` supaya tampilan ikut berubah.
//
// Alur setelah refresh: profil printer (termasuk bluetoothId) sudah tersimpan
// di localStorage -> begitu halaman termuat, autoConnectBluetooth() mengambil
// device dari getDevices() (izin lama tetap berlaku) lalu menyambungnya tanpa
// dialog (lihat reconnectBluetoothPrinter). Kalau printer putus di tengah
// jalan (mati/keluar jangkauan), dicoba disambung ulang beberapa kali.
type BluetoothEntry = Extract<DeviceRegistryEntry, { type: "bluetooth" }>;
type StatusListener = (id: string, status: PrinterStatus) => void;

const statusListeners = new Set<StatusListener>();
function emitStatus(id: string, status: PrinterStatus) {
  statusListeners.forEach((listener) => listener(id, status));
}

const disconnectHandlerKeys = new Set<string>(); // "profileId:deviceId"
const inflightBluetooth = new Map<string, Promise<BluetoothEntry>>();
const reconnectAttempts = new Map<string, number>();
const lastAutoConnectAt = new Map<string, number>();
const suppressReconnect = new Set<string>(); // profil yang sengaja diputus/dihapus

const MAX_AUTO_RECONNECT_ATTEMPTS = 3;
const BACKGROUND_RECONNECT_WAIT_MS = 10000; // lama menunggu iklan printer (tanpa kasir menunggu)
const FOREGROUND_RECONNECT_WAIT_MS = 5000; // saat kasir sedang menekan cetak
const AUTO_CONNECT_COOLDOWN_MS = 15000; // jangan mencoba lagi terlalu rapat saat tab bolak-balik

/** Cari objek device Bluetooth untuk sebuah profil: yang sedang tersambung, baru dipindai, atau yang pernah diizinkan. */
async function resolveBluetoothDeviceFor(
  profile: PrinterProfile,
): Promise<MinimalBluetoothDevice> {
  const cached = sharedDeviceRegistry.get(profile.id);
  if (cached?.type === "bluetooth") return cached.device;

  const scanned = profile.bluetoothId
    ? sharedScannedBluetooth.get(profile.bluetoothId)
    : undefined;
  if (scanned) return scanned;

  const paired = await getPairedBluetoothDevices();
  const found = paired.find((d) => d.id === profile.bluetoothId);
  if (!found) {
    throw new Error(
      "Printer tidak ditemukan — pastikan sudah pernah dipasangkan lewat 'Cari Printer' dan browser mengizinkan akses ulang.",
    );
  }
  return found;
}

function scheduleBluetoothReconnect(profileId: string, device: MinimalBluetoothDevice) {
  const attempt = reconnectAttempts.get(profileId) ?? 0;
  if (attempt >= MAX_AUTO_RECONNECT_ATTEMPTS) return;
  reconnectAttempts.set(profileId, attempt + 1);

  setTimeout(() => {
    if (suppressReconnect.has(profileId)) return;
    // Profil sudah dihapus dari daftar -> berhenti.
    if (!loadFromStorage().some((p) => p.id === profileId)) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    openBluetoothEntry(profileId, device, BACKGROUND_RECONNECT_WAIT_MS).catch(() =>
      scheduleBluetoothReconnect(profileId, device),
    );
  }, 2000 * (attempt + 1));
}

function attachBluetoothDisconnectHandler(profileId: string, device: MinimalBluetoothDevice) {
  const key = `${profileId}:${device.id}`;
  if (disconnectHandlerKeys.has(key)) return;
  disconnectHandlerKeys.add(key);
  device.addEventListener("gattserverdisconnected", () => {
    emitStatus(profileId, "disconnected");
    if (!suppressReconnect.has(profileId)) scheduleBluetoothReconnect(profileId, device);
  });
}

/**
 * Pastikan `device` tersambung & characteristic tulisnya siap. Banyak pemanggil
 * sekaligus (auto-connect + tombol cetak) berbagi SATU proses lewat
 * `inflightBluetooth`, jadi tidak pernah ada dua gatt.connect() bertabrakan.
 */
function openBluetoothEntry(
  profileId: string,
  device: MinimalBluetoothDevice,
  waitMs: number,
): Promise<BluetoothEntry> {
  const existing = sharedDeviceRegistry.get(profileId);
  if (existing?.type === "bluetooth" && existing.device === device && device.gatt?.connected) {
    return Promise.resolve(existing);
  }
  const pending = inflightBluetooth.get(profileId);
  if (pending) return pending;

  const promise = (async (): Promise<BluetoothEntry> => {
    const characteristic = await reconnectBluetoothPrinter(device, waitMs);
    const entry: BluetoothEntry = { type: "bluetooth", device, characteristic };
    sharedDeviceRegistry.set(profileId, entry);
    attachBluetoothDisconnectHandler(profileId, device);
    reconnectAttempts.set(profileId, 0);
    emitStatus(profileId, "connected");
    return entry;
  })().finally(() => {
    inflightBluetooth.delete(profileId);
  });
  inflightBluetooth.set(profileId, promise);
  return promise;
}

/** Sambung diam-diam (tanpa dialog, tanpa error ke layar). Dipakai saat halaman dimuat & tab dibuka kembali. */
async function autoConnectBluetooth(profile: PrinterProfile): Promise<void> {
  const existing = sharedDeviceRegistry.get(profile.id);
  if (existing?.type === "bluetooth" && existing.device.gatt?.connected) {
    emitStatus(profile.id, "connected");
    return;
  }
  const last = lastAutoConnectAt.get(profile.id) ?? 0;
  if (Date.now() - last < AUTO_CONNECT_COOLDOWN_MS) return;
  lastAutoConnectAt.set(profile.id, Date.now());

  suppressReconnect.delete(profile.id);
  try {
    const device = await resolveBluetoothDeviceFor(profile);
    await openBluetoothEntry(profile.id, device, BACKGROUND_RECONNECT_WAIT_MS);
  } catch {
    emitStatus(profile.id, "disconnected");
  }
}

interface UsePrinterProfilesResult {
  profiles: PrinterProfile[];
  statuses: Record<string, PrinterStatus>;
  isLoaded: boolean;
  isScanning: boolean;
  busyId: string | null;
  bluetoothSupported: boolean;
  usbSupported: boolean;
  scanBluetooth: () => Promise<PrinterActionResult>;
  scanUsb: () => Promise<PrinterActionResult>;
  testConnection: (id: string) => Promise<PrinterActionResult>;
  testPrint: (id: string, storeName: string) => Promise<PrinterActionResult>;
  /**
   * Cetak struk TRANSAKSI SUNGGUHAN ke printer default (atau `id` tertentu
   * kalau dikirim). BEDA dari testPrint(): kalau printer default bertipe
   * bluetooth/usb, ini TIDAK PERNAH memunculkan dialog cetak apa pun —
   * langsung menulis byte ESC/POS ke device. Dialog cetak sistem HANYA
   * muncul kalau printer default kasir memang masih bertipe "Printer
   * Sistem (Browser)" (mis. belum sempat menyambungkan printer fisik) —
   * itu bukan bug, itu satu-satunya cara mencetak lewat OS print driver.
   */
  printReceipt: (
    data: ReceiptData,
    id?: string,
  ) => Promise<PrinterActionResult>;
  setDefaultPrinter: (id: string) => void;
  renamePrinter: (id: string, name: string) => void;
  removePrinter: (id: string) => PrinterActionResult;
}

export function usePrinterProfiles(): UsePrinterProfilesResult {
  const [profiles, setProfiles] = useState<PrinterProfile[]>([
    makeBrowserProfile(true),
  ]);
  const [statuses, setStatuses] = useState<Record<string, PrinterStatus>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Ref supaya handler async (scan/tes koneksi) selalu baca daftar TERBARU,
  // bukan closure basi dari render saat handler mulai dipanggil (penting —
  // requestDevice() bisa menggantung lama menunggu kasir memilih perangkat).
  const profilesRef = useRef(profiles);
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  const deviceRegistryRef = useRef<Map<string, DeviceRegistryEntry>>(
    sharedDeviceRegistry,
  );
  // Perangkat Bluetooth yang BARU SAJA dipilih lewat "Cari Printer" di sesi
  // halaman ini. Disimpan karena navigator.bluetooth.getDevices() belum tentu
  // tersedia/aktif di semua versi Chrome — tanpa ini, printer yang baru
  // dipilih langsung dianggap "tidak ditemukan" saat tes koneksi.
  const scannedBluetoothRef = useRef<Map<string, MinimalBluetoothDevice>>(
    sharedScannedBluetooth,
  );
  // Web Bluetooth mengembalikan instance BluetoothDevice yang SAMA untuk
  // perangkat fisik yang sama tiap kali getDevices() dipanggil — dedupe di
  // sini supaya event listener disconnect tidak menumpuk tiap kali kasir
  // menekan "Tes Koneksi" berkali-kali pada printer yang sama.
  // (listener disconnect kini ada di level modul — lihat attachBluetoothDisconnectHandler)

  // Muat dari localStorage sekali di awal (client-only, lihat pola sama di
  // useThemePreference.ts — default aman dulu, baru dikoreksi di effect).
  useEffect(() => {
    const loaded = loadFromStorage();
    setProfiles(loaded);
    setIsLoaded(true);
  }, []);

  // Berlangganan perubahan status dari logika koneksi level modul.
  useEffect(() => {
    const listener: StatusListener = (id, status) =>
      setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  }, []);

  // ── PERBAIKAN (koneksi bertahan setelah refresh) ── Begitu daftar printer
  // termuat, sambungkan semua printer Bluetooth yang tersimpan — tanpa dialog.
  // Dicoba lagi tiap tab kembali dibuka (mis. kasir pindah aplikasi lalu balik).
  useEffect(() => {
    if (!isLoaded || !isWebBluetoothSupported()) return;
    const connectAll = () => {
      for (const profile of profilesRef.current) {
        if (profile.connectionType === "bluetooth") void autoConnectBluetooth(profile);
      }
    };
    connectAll();
    const onVisible = () => {
      if (document.visibilityState === "visible") connectAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isLoaded]);

  const persist = useCallback((next: PrinterProfile[]) => {
    setProfiles(next);
    saveToStorage(next);
  }, []);

  // Saat komponen ini baru dipasang (mis. kembali ke menu Printer), ambil
  // status koneksi Bluetooth dari handle yang masih hidup di level modul.
  useEffect(() => {
    if (!isLoaded) return;
    setStatuses((prev) => {
      const next = { ...prev };
      for (const profile of profilesRef.current) {
        if (profile.connectionType !== "bluetooth") continue;
        const entry = deviceRegistryRef.current.get(profile.id);
        if (entry?.type === "bluetooth") {
          next[profile.id] = entry.device.gatt?.connected
            ? "connected"
            : "disconnected";
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // Best-effort: begitu daftar termuat, cek printer USB mana yang memang
  // sedang tercolok (getAuthorizedUsbDevices menyaring otomatis — perangkat
  // yang tidak tercolok tidak akan muncul di daftar sama sekali) — TANPA
  // gesture pengguna, tanpa dialog apa pun, jadi aman dipanggil otomatis.
  useEffect(() => {
    if (!isLoaded) return;
    void (async () => {
      const usbProfiles = profilesRef.current.filter(
        (p) => p.connectionType === "usb",
      );
      if (usbProfiles.length === 0) return;
      const authorized = await getAuthorizedUsbDevices();
      setStatuses((prev) => {
        const next = { ...prev };
        for (const profile of usbProfiles) {
          const stillPlugged = authorized.some(
            (d) =>
              d.vendorId === profile.usbVendorId &&
              d.productId === profile.usbProductId,
          );
          next[profile.id] = stillPlugged ? "connected" : "disconnected";
        }
        return next;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  const resolveBluetoothDevice = useCallback(
    (profile: PrinterProfile): Promise<MinimalBluetoothDevice> =>
      resolveBluetoothDeviceFor(profile),
    [],
  );

  const resolveUsbDevice = useCallback(
    async (profile: PrinterProfile): Promise<MinimalUsbDevice> => {
      const cached = deviceRegistryRef.current.get(profile.id);
      if (cached?.type === "usb") return cached.device;

      const authorized = await getAuthorizedUsbDevices();
      const found = authorized.find(
        (d) =>
          d.vendorId === profile.usbVendorId &&
          d.productId === profile.usbProductId,
      );
      if (!found) {
        throw new Error(
          "Printer tidak ditemukan — pastikan kabel USB tercolok dan sudah pernah diizinkan lewat 'Cari Printer'.",
        );
      }
      return found;
    },
    [],
  );

  const touchLastConnected = useCallback(
    (id: string) => {
      const next = profilesRef.current.map((p) =>
        p.id === id ? { ...p, lastConnectedAt: new Date().toISOString() } : p,
      );
      persist(next);
    },
    [persist],
  );

  const scanBluetooth = useCallback(async (): Promise<PrinterActionResult> => {
    if (!isWebBluetoothSupported()) {
      return {
        ok: false,
        error:
          "Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome/Edge terbaru di desktop atau Android.",
      };
    }

    setIsScanning(true);
    try {
      const device = await requestBluetoothPrinter();
      scannedBluetoothRef.current.set(device.id, device);
      const existing = profilesRef.current.find(
        (p) => p.connectionType === "bluetooth" && p.bluetoothId === device.id,
      );

      if (existing) {
        // Sudah pernah ditambahkan sebelumnya — cukup perbarui namanya kalau berubah.
        const next = profilesRef.current.map((p) =>
          p.id === existing.id ? { ...p, name: device.name || p.name } : p,
        );
        persist(next);
        return { ok: true };
      }

      const newProfile: PrinterProfile = {
        id: generateId(),
        name: device.name || "Printer Bluetooth",
        connectionType: "bluetooth",
        isDefault: false,
        createdAt: new Date().toISOString(),
        bluetoothId: device.id,
      };
      persist(normalizeProfiles([...profilesRef.current, newProfile]));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyPrinterError(err) };
    } finally {
      setIsScanning(false);
    }
  }, [persist]);

  const scanUsb = useCallback(async (): Promise<PrinterActionResult> => {
    if (!isWebUsbSupported()) {
      return {
        ok: false,
        error: "Browser ini tidak mendukung WebUSB. Gunakan Chrome/Edge terbaru di desktop.",
      };
    }

    setIsScanning(true);
    try {
      const device = await requestUsbPrinter();
      const existing = profilesRef.current.find(
        (p) =>
          p.connectionType === "usb" &&
          p.usbVendorId === device.vendorId &&
          p.usbProductId === device.productId,
      );

      if (existing) {
        return { ok: true };
      }

      const label =
        device.productName ||
        (device.manufacturerName ? `Printer USB (${device.manufacturerName})` : "Printer USB");

      const newProfile: PrinterProfile = {
        id: generateId(),
        name: label,
        connectionType: "usb",
        isDefault: false,
        createdAt: new Date().toISOString(),
        usbVendorId: device.vendorId,
        usbProductId: device.productId,
      };
      persist(normalizeProfiles([...profilesRef.current, newProfile]));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyPrinterError(err) };
    } finally {
      setIsScanning(false);
    }
  }, [persist]);

  const testConnection = useCallback(
    async (id: string): Promise<PrinterActionResult> => {
      const profile = profilesRef.current.find((p) => p.id === id);
      if (!profile) return { ok: false, error: "Printer tidak ditemukan." };

      setBusyId(id);
      try {
        if (profile.connectionType === "browser") {
          // Printer sistem tidak punya sesi koneksi untuk dites dari sini —
          // satu-satunya bukti nyata adalah dialog cetak OS lewat "Tes Print".
          return { ok: true };
        }

        if (profile.connectionType === "bluetooth") {
          suppressReconnect.delete(id);
          const device = await resolveBluetoothDevice(profile);
          await openBluetoothEntry(id, device, FOREGROUND_RECONNECT_WAIT_MS);
        } else {
          const device = await resolveUsbDevice(profile);
          if (!device.opened) await device.open();
          deviceRegistryRef.current.set(id, { type: "usb", device });
        }

        setStatuses((prev) => ({ ...prev, [id]: "connected" }));
        touchLastConnected(id);
        return { ok: true };
      } catch (err) {
        setStatuses((prev) => ({ ...prev, [id]: "disconnected" }));
        return { ok: false, error: friendlyPrinterError(err) };
      } finally {
        setBusyId(null);
      }
    },
    [resolveBluetoothDevice, resolveUsbDevice, touchLastConnected],
  );

  const testPrint = useCallback(
    async (id: string, storeName: string): Promise<PrinterActionResult> => {
      const profile = profilesRef.current.find((p) => p.id === id);
      if (!profile) return { ok: false, error: "Printer tidak ditemukan." };

      setBusyId(id);
      try {
        if (profile.connectionType === "browser") {
          printBrowserTestPage(storeName, profile.name);
          return { ok: true };
        }

        const bytes = buildTestPrintBytes(storeName, profile.name);

        if (profile.connectionType === "bluetooth") {
          suppressReconnect.delete(id);
          const device = await resolveBluetoothDevice(profile);
          const entry = await openBluetoothEntry(id, device, FOREGROUND_RECONNECT_WAIT_MS);
          await writeToBluetoothPrinter(entry.characteristic, bytes);
        } else {
          let entry = deviceRegistryRef.current.get(id);
          if (!entry || entry.type !== "usb") {
            const device = await resolveUsbDevice(profile);
            entry = { type: "usb", device };
            deviceRegistryRef.current.set(id, entry);
          }
          await writeToUsbPrinter(entry.device, bytes);
        }

        setStatuses((prev) => ({ ...prev, [id]: "connected" }));
        touchLastConnected(id);
        return { ok: true };
      } catch (err) {
        setStatuses((prev) => ({ ...prev, [id]: "disconnected" }));
        return { ok: false, error: friendlyPrinterError(err) };
      } finally {
        setBusyId(null);
      }
    },
    [resolveBluetoothDevice, resolveUsbDevice, touchLastConnected],
  );

  // ── PERBAIKAN (auto-print munculkan dialog padahal sudah ada printer
  // bluetooth/usb) ── Sebelumnya KasirModule.tsx & TransactionDetailModal.tsx
  // memanggil printThermalReceipt() langsung, TIDAK PEDULI printer default
  // kasir bertipe apa — selalu lewat window.print(), selalu memunculkan
  // dialog cetak sistem walau kasir sudah menyambungkan printer Bluetooth/
  // USB di Pengaturan > Printer. testPrint() di atas SUDAH benar (branching
  // per connectionType) tapi cuma dipakai tombol "Tes Print" di Pengaturan,
  // tidak pernah dipanggil dari alur pembayaran. printReceipt() ini pola
  // yang SAMA dengan testPrint(), hanya isinya struk transaksi asli
  // (buildReceiptBytes) bukan halaman tes — supaya alur pembayaran &
  // cetak ulang bisa pakai jalur tanpa-dialog yang sama.
  const printReceipt = useCallback(
    async (data: ReceiptData, id?: string): Promise<PrinterActionResult> => {
      const profile = id
        ? profilesRef.current.find((p) => p.id === id)
        : profilesRef.current.find((p) => p.isDefault);
      if (!profile) return { ok: false, error: "Printer tidak ditemukan." };

      // ── TAMBAHAN (logo + tulisan merek di struk) ── Siapkan kepala struk
      // bergambar (ikon + "Langitan.co" Inter). null (ikon belum ada / gagal)
      // -> struk tetap tercetak dengan tampilan lama. Hasilnya di-cache, jadi
      // hanya cetak pertama yang menunggu.
      const brand = await loadReceiptBrand(data.storeName);

      // ── TAMBAHAN (QR promosi) ── Dibuat dari link di Pengaturan setiap kali
      // cetak, jadi ganti link langsung berlaku di struk berikutnya. Hanya
      // struk penjualan; Buka Kasir tidak pakai. null (link kosong/tidak
      // valid/terlalu panjang) -> struk tercetak tanpa QR, tidak pernah gagal.
      const qr =
        data.kind !== "shift_open" && data.promoUrl
          ? await loadReceiptQr(data.promoUrl)
          : null;

      if (profile.connectionType === "browser") {
        // Satu-satunya jalur yang TIDAK BISA menghindari dialog cetak —
        // window.print() selalu memunculkannya, ini batasan browser, bukan
        // sesuatu yang bisa "diperbaiki" dari sisi kode. Kalau kasir tidak
        // mau lihat dialog sama sekali, solusinya menyambungkan printer
        // fisik lewat Bluetooth/USB di Pengaturan > Printer, bukan
        // memaksa jalur "Printer Sistem (Browser)" ini diam-diam.
        printThermalReceipt(data, brand, qr);
        return { ok: true };
      }

      setBusyId(profile.id);
      try {
        const bytes = buildReceiptBytes(data, brand, qr);

        if (profile.connectionType === "bluetooth") {
          suppressReconnect.delete(profile.id);
          const device = await resolveBluetoothDevice(profile);
          const entry = await openBluetoothEntry(
            profile.id,
            device,
            FOREGROUND_RECONNECT_WAIT_MS,
          );
          await writeToBluetoothPrinter(entry.characteristic, bytes);
        } else {
          let entry = deviceRegistryRef.current.get(profile.id);
          if (!entry || entry.type !== "usb") {
            const device = await resolveUsbDevice(profile);
            entry = { type: "usb", device };
            deviceRegistryRef.current.set(profile.id, entry);
          }
          await writeToUsbPrinter(entry.device, bytes);
        }

        setStatuses((prev) => ({ ...prev, [profile.id]: "connected" }));
        touchLastConnected(profile.id);
        return { ok: true };
      } catch (err) {
        setStatuses((prev) => ({ ...prev, [profile.id]: "disconnected" }));
        return { ok: false, error: friendlyPrinterError(err) };
      } finally {
        setBusyId(null);
      }
    },
    [resolveBluetoothDevice, resolveUsbDevice, touchLastConnected],
  );

  const setDefaultPrinter = useCallback(
    (id: string) => {
      const next = profilesRef.current.map((p) => ({
        ...p,
        isDefault: p.id === id,
      }));
      persist(next);
    },
    [persist],
  );

  const renamePrinter = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const next = profilesRef.current.map((p) =>
        p.id === id ? { ...p, name: trimmed } : p,
      );
      persist(next);
    },
    [persist],
  );

  const removePrinter = useCallback(
    (id: string): PrinterActionResult => {
      if (id === BROWSER_PRINTER_ID) {
        return {
          ok: false,
          error: "Printer Sistem (Browser) tidak bisa dihapus — ini cadangan utama supaya toko selalu bisa mencetak.",
        };
      }

      const target = profilesRef.current.find((p) => p.id === id);
      const entry = deviceRegistryRef.current.get(id);
      // Hapus sengaja -> jangan coba disambung ulang otomatis.
      suppressReconnect.add(id);
      if (entry?.type === "bluetooth") {
        disconnectBluetoothPrinter(entry.device);
      }
      deviceRegistryRef.current.delete(id);

      const remaining = profilesRef.current.filter((p) => p.id !== id);
      // Kalau yang dihapus adalah default, lempar default balik ke printer
      // sistem — sengaja tidak dibiarkan tanpa default sama sekali.
      const next = target?.isDefault
        ? remaining.map((p) => ({ ...p, isDefault: p.id === BROWSER_PRINTER_ID }))
        : remaining;

      persist(normalizeProfiles(next));
      setStatuses((prev) => {
        const nextStatuses = { ...prev };
        delete nextStatuses[id];
        return nextStatuses;
      });
      return { ok: true };
    },
    [persist],
  );

  return {
    profiles,
    statuses,
    isLoaded,
    isScanning,
    busyId,
    bluetoothSupported: isWebBluetoothSupported(),
    usbSupported: isWebUsbSupported(),
    scanBluetooth,
    scanUsb,
    testConnection,
    testPrint,
    printReceipt,
    setDefaultPrinter,
    renamePrinter,
    removePrinter,
  };
}