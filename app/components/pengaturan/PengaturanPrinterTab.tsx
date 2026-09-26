"use client";

// app/components/pengaturan/PengaturanPrinterTab.tsx
// ── TAMBAHAN ── Sub-tab baru "Printer" di PengaturanModule.tsx: koneksi ke
// printer struk (Bluetooth/USB langsung dari browser, atau printer sistem/
// jaringan lewat dialog cetak OS), cari printer aktif, tes koneksi, tes
// print, dan pilih printer default. Semua logika ada di
// hooks/usePrinterProfiles.ts (baca catatan header file itu untuk alasan
// data ini per-device/localStorage & TIDAK di-gate permission_key seperti
// 3 sub-tab Pengaturan lainnya) — file ini murni UI.
//
// Daftar printer SENGAJA ditampilkan sebagai grid card (bukan tabel/list),
// konsisten dengan pola yang sudah dipakai daftar Layar Promosi
// (PromoModule.tsx) — badge status, tombol aksi jadi ikon polos di footer
// card, tanpa shadow.

import { useState } from "react";
import {
  AlertCircle,
  Bluetooth,
  CheckCircle2,
  Loader2,
  Pencil,
  Printer as PrinterIcon,
  RefreshCw,
  Star,
  Trash2,
  Usb,
  X,
  Zap,
} from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import {
  usePrinterProfiles,
  type PrinterConnectionType,
  type PrinterProfile,
  type PrinterStatus,
} from "@/hooks/usePrinterProfiles";

const GHOST_ICON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-200";
const GHOST_ICON_DANGER_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors duration-150 hover:bg-lco-coral/10 hover:text-lco-coral disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-500";

const CONNECTION_LABEL: Record<PrinterConnectionType, string> = {
  bluetooth: "Bluetooth",
  usb: "USB",
  browser: "Browser / Sistem",
};

const CONNECTION_ICON: Record<PrinterConnectionType, typeof Bluetooth> = {
  bluetooth: Bluetooth,
  usb: Usb,
  browser: PrinterIcon,
};

const STATUS_META: Record<
  PrinterStatus,
  { label: string; dot: string; text: string }
> = {
  connected: {
    label: "Terhubung",
    dot: "bg-lco-teal",
    text: "text-lco-green dark:text-lco-teal",
  },
  disconnected: {
    label: "Terputus",
    dot: "bg-lco-coral",
    text: "text-lco-coral",
  },
  unknown: {
    label: "Belum diketahui",
    dot: "bg-zinc-300 dark:bg-zinc-600",
    text: "text-zinc-400 dark:text-zinc-500",
  },
};

export default function PengaturanPrinterTab() {
  const { settings } = useSettings();
  const {
    profiles,
    statuses,
    isLoaded,
    isScanning,
    busyId,
    bluetoothSupported,
    usbSupported,
    scanBluetooth,
    scanUsb,
    testConnection,
    testPrint,
    setDefaultPrinter,
    renamePrinter,
    removePrinter,
  } = usePrinterProfiles();

  const [notice, setNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleScan(kind: "bluetooth" | "usb") {
    setNotice(null);
    const result =
      kind === "bluetooth" ? await scanBluetooth() : await scanUsb();
    if (result.ok) {
      setNotice({
        type: "success",
        text: "Printer ditemukan & ditambahkan ke daftar.",
      });
    } else if (result.error !== "Dibatalkan.") {
      setNotice({ type: "error", text: result.error });
    }
  }

  async function handleTestConnection(profile: PrinterProfile) {
    setNotice(null);
    const result = await testConnection(profile.id);
    if (result.ok) {
      setNotice({
        type: "success",
        text: `Koneksi ke "${profile.name}" berhasil.`,
      });
    } else if (result.error !== "Dibatalkan.") {
      setNotice({ type: "error", text: `${profile.name}: ${result.error}` });
    }
  }

  async function handleTestPrint(profile: PrinterProfile) {
    setNotice(null);
    const result = await testPrint(profile.id, settings.namaToko);
    if (result.ok) {
      setNotice({
        type: "success",
        text: `Perintah tes print terkirim ke "${profile.name}".`,
      });
    } else if (result.error !== "Dibatalkan.") {
      setNotice({ type: "error", text: `${profile.name}: ${result.error}` });
    }
  }

  function handleRemove(profile: PrinterProfile) {
    const result = removePrinter(profile.id);
    if (!result.ok) {
      setNotice({ type: "error", text: result.error });
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Printer Struk
        </h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pengaturan ini tersimpan di perangkat/browser ini saja — printer yang
          tersambung di kasir depan tidak ikut muncul di device lain.
        </p>
      </div>

      {/* Panel tambah printer */}
      <div className="mb-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Cari Printer Aktif
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!bluetoothSupported || isScanning}
            title={
              bluetoothSupported
                ? undefined
                : "Butuh Chrome/Edge terbaru (desktop atau Android)"
            }
            onClick={() => void handleScan("bluetooth")}
            className="inline-flex items-center gap-2 rounded-lg bg-lco-green px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bluetooth className="h-4 w-4" />
            )}
            Cari Printer Bluetooth
          </button>
          <button
            type="button"
            disabled={!usbSupported || isScanning}
            title={
              usbSupported ? undefined : "Butuh Chrome/Edge terbaru di desktop"
            }
            onClick={() => void handleScan("usb")}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Usb className="h-4 w-4" />
            )}
            Cari Printer USB
          </button>
        </div>
        <p className="mt-2.5 text-xs text-zinc-400 dark:text-zinc-500">
          Printer jaringan/LAN? Pasang sebagai printer default di pengaturan
          sistem (OS) device ini, lalu pakai kartu{" "}
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            &ldquo;Printer Sistem (Browser)&rdquo;
          </span>{" "}
          di bawah.
        </p>
      </div>

      {notice && (
        <div
          className={`mb-3 flex items-start gap-3 rounded-xl p-3.5 ${
            notice.type === "success" ? "bg-lco-teal/10" : "bg-lco-coral/10"
          }`}
        >
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              notice.type === "success"
                ? "bg-lco-teal/20 text-lco-green dark:text-lco-teal"
                : "bg-lco-coral/20 text-lco-coral"
            }`}
          >
            {notice.type === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
          </div>
          <p
            className={`flex-1 pt-0.5 text-sm ${
              notice.type === "success"
                ? "text-lco-green dark:text-lco-teal"
                : "text-lco-coral"
            }`}
          >
            {notice.text}
          </p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Tutup notifikasi"
            className={`shrink-0 rounded-md p-1 transition-colors duration-150 ${
              notice.type === "success"
                ? "text-lco-green/50 hover:bg-lco-teal/20 hover:text-lco-green dark:text-lco-teal/60 dark:hover:text-lco-teal"
                : "text-lco-coral/50 hover:bg-lco-coral/20 hover:text-lco-coral"
            }`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!isLoaded ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 p-8 text-sm text-zinc-400 dark:border-zinc-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat daftar printer...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => (
            <PrinterCard
              key={profile.id}
              profile={profile}
              status={statuses[profile.id] ?? "unknown"}
              isBusy={busyId === profile.id}
              onTestConnection={() => void handleTestConnection(profile)}
              onTestPrint={() => void handleTestPrint(profile)}
              onSetDefault={() => setDefaultPrinter(profile.id)}
              onRename={(name) => renamePrinter(profile.id, name)}
              onRemove={() => handleRemove(profile)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PrinterCardProps {
  profile: PrinterProfile;
  status: PrinterStatus;
  isBusy: boolean;
  onTestConnection: () => void;
  onTestPrint: () => void;
  onSetDefault: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

function PrinterCard({
  profile,
  status,
  isBusy,
  onTestConnection,
  onTestPrint,
  onSetDefault,
  onRename,
  onRemove,
}: PrinterCardProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const Icon = CONNECTION_ICON[profile.connectionType];
  const statusMeta = STATUS_META[status];
  const isBrowserPrinter = profile.connectionType === "browser";

  function submitRename() {
    onRename(draftName);
    setIsEditingName(false);
  }

  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            {isEditingName ? (
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={submitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitRename();
                  if (event.key === "Escape") {
                    setDraftName(profile.name);
                    setIsEditingName(false);
                  }
                }}
                className="w-full rounded-md border border-lco-teal bg-transparent px-1.5 py-0.5 text-sm font-semibold text-zinc-900 outline-none dark:text-zinc-100"
              />
            ) : (
              <h4 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {profile.name}
              </h4>
            )}
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              {CONNECTION_LABEL[profile.connectionType]}
            </p>
          </div>
        </div>

        {profile.isDefault ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Star className="h-3 w-3 fill-current" />
            Default
          </span>
        ) : (
          <button
            type="button"
            title="Jadikan printer default"
            onClick={onSetDefault}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-[10px] font-medium text-zinc-500 transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <Star className="h-3 w-3" />
            Jadikan Default
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs">
        <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
        <span className={statusMeta.text}>{statusMeta.label}</span>
      </div>

      <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-900" />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Ubah nama"
            aria-label="Ubah nama"
            onClick={() => setIsEditingName(true)}
            className={GHOST_ICON_CLASS}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={
              isBrowserPrinter
                ? "Printer sistem tidak bisa dihapus"
                : confirmingRemove
                  ? "Klik sekali lagi untuk konfirmasi hapus"
                  : "Hapus printer"
            }
            aria-label="Hapus printer"
            disabled={isBrowserPrinter}
            onClick={() => {
              if (!confirmingRemove) {
                setConfirmingRemove(true);
                return;
              }
              onRemove();
            }}
            onBlur={() => setConfirmingRemove(false)}
            className={
              confirmingRemove
                ? "inline-flex h-8 items-center gap-1 rounded-lg bg-lco-coral px-2 text-xs font-medium text-white"
                : GHOST_ICON_DANGER_CLASS
            }
          >
            <Trash2 className="h-4 w-4" />
            {confirmingRemove && "Yakin?"}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {!isBrowserPrinter && (
            <button
              type="button"
              disabled={isBusy}
              onClick={onTestConnection}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-2 text-xs font-medium text-zinc-700 transition-colors duration-150 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Tes Koneksi
            </button>
          )}
          <button
            type="button"
            disabled={isBusy}
            onClick={onTestPrint}
            className="inline-flex items-center gap-1.5 rounded-lg bg-lco-green px-2.5 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-lco-green-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Tes Print
          </button>
        </div>
      </div>
    </div>
  );
}
