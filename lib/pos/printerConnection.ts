// lib/pos/printerConnection.ts
// ── TAMBAHAN (Pengaturan > Printer) ── Lapisan koneksi ke printer FISIK,
// dipisah dari hook React (hooks/usePrinterProfiles.ts) supaya file ini
// murni wrapper Web Bluetooth/WebUSB + builder byte ESC/POS, tanpa state —
// pola yang sama seperti lib/pos/printLogic.ts (logika cetak dipisah dari
// komponen React yang memanggilnya).
//
// ── Kenapa cuma 3 tipe koneksi (bluetooth/usb/browser), bukan "jaringan/LAN"
// mentah lewat IP:port? ── Printer thermal jaringan biasanya menerima data
// ESC/POS mentah lewat socket TCP port 9100 ("raw/JetDirect"). Browser TIDAK
// PERNAH bisa membuka socket TCP sembarang (bukan keterbatasan proyek ini —
// itu batasan platform web demi keamanan, sama seperti kenapa browser tidak
// bisa jadi klien FTP/SSH). Makanya printer jaringan di sini diarahkan lewat
// tipe "browser" — device itu didaftarkan sebagai printer default di OS
// (Windows/macOS "Add Printer" via IP), lalu dipanggil lewat dialog cetak
// bawaan browser (window.print()), PERSIS mekanisme yang sudah dipakai
// printLogic.ts untuk struk & nota selama ini. Bluetooth dan USB, sebaliknya,
// BISA disambungkan langsung dari browser (Web Bluetooth API / WebUSB API)
// tanpa driver/OS print dialog — makanya dua tipe itu dapat alur "cari
// printer aktif" & tes koneksi/print yang sungguhan menyambung ke device.
//
// ── Kenapa definisi tipe Bluetooth/USB ditulis manual di sini (bukan pasang
// paket @types/web-bluetooth) ── tsconfig.json proyek ini cuma include lib
// "dom" bawaan TypeScript, yang TIDAK menyertakan Web Bluetooth/WebUSB (API
// ini masihексperimental & Chromium-only, belum bagian standar DOM). Daripada
// menambah dependency baru (lihat catatan header PromoModule.tsx soal Aturan
// Main §18.8 — nambah dependency harus ada alasan). API ini masih
// eksperimental (Chromium-only), jadi cukup didefinisikan subset minimal
// yang benar-benar dipakai di sini, lalu `navigator` di-cast inline — pola
// PERSIS yang sudah dipakai printLogic.ts untuk `navigator.share`/`canShare`
// (Web Share API, juga tidak lengkap di lib.dom versi TS ini).

// ── Tipe minimal Web Bluetooth ──────────────────────────────────────────

export interface MinimalBluetoothRemoteGATTCharacteristic {
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
}

interface MinimalBluetoothRemoteGATTService {
  getCharacteristic(
    characteristic: string,
  ): Promise<MinimalBluetoothRemoteGATTCharacteristic>;
}

interface MinimalBluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<MinimalBluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(
    service: string,
  ): Promise<MinimalBluetoothRemoteGATTService>;
}

export interface MinimalBluetoothDevice {
  id: string;
  name?: string;
  gatt?: MinimalBluetoothRemoteGATTServer;
  addEventListener(
    type: "gattserverdisconnected",
    listener: () => void,
  ): void;
  removeEventListener(
    type: "gattserverdisconnected",
    listener: () => void,
  ): void;
}

interface MinimalBluetooth {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }): Promise<MinimalBluetoothDevice>;
  getDevices?(): Promise<MinimalBluetoothDevice[]>;
}

// ── Tipe minimal WebUSB ─────────────────────────────────────────────────

interface MinimalUsbEndpoint {
  direction: "in" | "out";
  endpointNumber: number;
}

interface MinimalUsbAlternateInterface {
  endpoints: MinimalUsbEndpoint[];
}

interface MinimalUsbInterface {
  interfaceNumber: number;
  alternates: MinimalUsbAlternateInterface[];
}

interface MinimalUsbConfiguration {
  interfaces: MinimalUsbInterface[];
}

export interface MinimalUsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: MinimalUsbConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(
    endpointNumber: number,
    data: BufferSource,
  ): Promise<{ status: "ok" | "stall" | "babble"; bytesWritten: number }>;
}

interface MinimalUsb {
  requestDevice(options: { filters: unknown[] }): Promise<MinimalUsbDevice>;
  getDevices(): Promise<MinimalUsbDevice[]>;
}

type NavigatorWithPrinterApis = Navigator & {
  bluetooth?: MinimalBluetooth;
  usb?: MinimalUsb;
};

function getNav(): NavigatorWithPrinterApis {
  return navigator as NavigatorWithPrinterApis;
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && !!getNav().bluetooth;
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && !!getNav().usb;
}

// ── UUID service/characteristic printer BLE generik ──────────────────────
// Dipakai HAMPIR SEMUA printer thermal Bluetooth murah (58mm/80mm) yang
// dijual lintas merek ("Zjiang", "Goojprt", "MHT-P58", dst) — semuanya
// memakai modul BLE-ke-serial generik yang sama, jadi UUID ini sama persis
// walau mereknya beda-beda. Printer bermerek besar (Epson/Star) dengan SDK
// resmi sendiri punya UUID berbeda dan di luar cakupan langkah ini.
export const GENERIC_BLE_PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
export const GENERIC_BLE_PRINTER_CHARACTERISTIC =
  "00002af1-0000-1000-8000-00805f9b34fb";

// ── Builder perintah ESC/POS untuk tes print ─────────────────────────────
// Sengaja terpisah dari template struk (printLogic.ts) — tes print di sini
// tidak butuh data transaksi, cuma perlu membuktikan koneksi jalan.

const ESC = 0x1b;
const GS = 0x1d;

/** Bangun byte mentah ESC/POS untuk satu halaman tes print. */
export function buildTestPrintBytes(
  storeName: string,
  printerName: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const raw = (...values: number[]) => bytes.push(...values);
  const text = (value: string) => bytes.push(...Array.from(encoder.encode(value)));

  raw(ESC, 0x40); // reset printer
  raw(ESC, 0x61, 0x01); // rata tengah
  raw(ESC, 0x21, 0x30); // font besar (double width+height) untuk judul
  text(`${storeName || "Langitan.co"}\n`);
  raw(ESC, 0x21, 0x00); // font normal
  text("*** TES PRINT ***\n");
  text("--------------------------------\n");
  raw(ESC, 0x61, 0x00); // rata kiri
  text(`Printer   : ${printerName}\n`);
  text(`Waktu     : ${new Date().toLocaleString("id-ID")}\n`);
  text("--------------------------------\n");
  raw(ESC, 0x61, 0x01);
  text("Kalau teks ini tercetak rapi,\n");
  text("printer sudah terhubung dengan\n");
  text("benar dan siap dipakai.\n");
  text("\n\n\n");
  raw(GS, 0x56, 0x42, 0x00); // potong kertas parsial (didukung kebanyakan printer mini)
  return new Uint8Array(bytes);
}

// ── Bluetooth ─────────────────────────────────────────────────────────────

/** Buka dialog pilih perangkat Bluetooth bawaan browser ("cari printer"). */
export async function requestBluetoothPrinter(): Promise<MinimalBluetoothDevice> {
  const bluetooth = getNav().bluetooth;
  if (!bluetooth) {
    throw new Error(
      "Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome/Edge terbaru di desktop atau Android.",
    );
  }
  // acceptAllDevices: true — banyak printer BLE murah mengiklankan nama
  // generik ("BlueTooth Printer", dst) tanpa service UUID di paket
  // advertisement-nya, jadi filter by-service akan membuatnya tidak
  // kelihatan sama sekali di dialog pilih perangkat.
  return bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [GENERIC_BLE_PRINTER_SERVICE],
  });
}

/** Daftar perangkat Bluetooth yang PERNAH diizinkan sebelumnya di origin ini (tanpa dialog baru). */
export async function getPairedBluetoothDevices(): Promise<
  MinimalBluetoothDevice[]
> {
  const bluetooth = getNav().bluetooth;
  if (!bluetooth?.getDevices) return [];
  try {
    return await bluetooth.getDevices();
  } catch {
    return [];
  }
}

/**
 * Sambungkan ke GATT server printer & ambil characteristic tulisnya.
 * Melempar error kalau printer mati/di luar jangkauan — pemanggil
 * (usePrinterProfiles) yang menerjemahkannya jadi status "terputus".
 */
export async function connectBluetoothPrinter(
  device: MinimalBluetoothDevice,
): Promise<MinimalBluetoothRemoteGATTCharacteristic> {
  if (!device.gatt) {
    throw new Error("Perangkat ini bukan printer BLE yang didukung (tidak ada GATT).");
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(GENERIC_BLE_PRINTER_SERVICE);
  return service.getCharacteristic(GENERIC_BLE_PRINTER_CHARACTERISTIC);
}

/** Kirim byte ke printer BLE, dipecah per potongan kecil (aman untuk stack BLE lama yang MTU-nya kecil). */
export async function writeToBluetoothPrinter(
  characteristic: MinimalBluetoothRemoteGATTCharacteristic,
  bytes: Uint8Array,
): Promise<void> {
  const CHUNK_SIZE = 180;
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    await characteristic.writeValueWithoutResponse(
      bytes.slice(offset, offset + CHUNK_SIZE),
    );
  }
}

export function disconnectBluetoothPrinter(device: MinimalBluetoothDevice): void {
  try {
    device.gatt?.disconnect();
  } catch {
    // Sudah terputus / tidak pernah tersambung — abaikan.
  }
}

// ── USB ───────────────────────────────────────────────────────────────────

/** Buka dialog pilih perangkat USB bawaan browser ("cari printer"). */
export async function requestUsbPrinter(): Promise<MinimalUsbDevice> {
  const usb = getNav().usb;
  if (!usb) {
    throw new Error(
      "Browser ini tidak mendukung WebUSB. Gunakan Chrome/Edge terbaru di desktop.",
    );
  }
  // filters: [] — sengaja tidak difilter by vendor/class, supaya semua
  // printer USB (yang class/driver-nya beragam antar merek) tetap kelihatan.
  return usb.requestDevice({ filters: [] });
}

/** Daftar perangkat USB yang PERNAH diizinkan sebelumnya (tanpa dialog baru) & sedang tercolok. */
export async function getAuthorizedUsbDevices(): Promise<MinimalUsbDevice[]> {
  const usb = getNav().usb;
  if (!usb) return [];
  try {
    return await usb.getDevices();
  } catch {
    return [];
  }
}

/** Buka koneksi + kirim byte mentah ke endpoint OUT printer USB, lalu lepas interface (device dibiarkan terbuka untuk print berikutnya). */
export async function writeToUsbPrinter(
  device: MinimalUsbDevice,
  bytes: Uint8Array,
): Promise<void> {
  if (!device.opened) {
    await device.open();
  }
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }

  const iface = device.configuration?.interfaces[0];
  const outEndpoint = iface?.alternates[0]?.endpoints.find(
    (endpoint) => endpoint.direction === "out",
  );
  if (!iface || !outEndpoint) {
    throw new Error("Endpoint OUT printer USB ini tidak ditemukan — kemungkinan bukan printer ESC/POS yang didukung.");
  }

  await device.claimInterface(iface.interfaceNumber);
  try {
    await device.transferOut(outEndpoint.endpointNumber, bytes);
  } finally {
    await device.releaseInterface(iface.interfaceNumber);
  }
}