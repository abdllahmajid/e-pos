"use client";

// ── KOREKSI ── Sebelumnya sidebar menyatu langsung di app/page.tsx. Dipisah ke sini
// supaya konsisten dengan pola app lain di ekosistem Langitan.co (mis.
// monitoring-produksi) yang selalu punya komponen Sidebar sendiri — page.tsx cukup
// jadi "shell" yang menyimpan state menu aktif & merender modul yang dipilih.
//
// Komponen ini sengaja "dumb" (controlled dari luar): tidak punya state sendiri,
// cuma menerima `activeMenu` + `onMenuChange`. Kalau nanti mau ditambah menu baru
// (Stok & Opname, Laporan, dst. sesuai PRD §4.1), cukup tambah entri di MENU_GROUPS
// di bawah — tidak perlu sentuh page.tsx sama sekali.

import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Package,
  Wallet,
  Boxes,
  TrendingUp,
  Trash2,
  ClipboardList,
  Settings,
  Bell,
  BellOff,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useAuth, type UserRole } from "@/hooks/useAuth";
// ── TAMBAHAN (T-12) ── Dipanggil DI SINI SAJA (satu-satunya titik panggil di
// seluruh app, lihat catatan header hooks/useFcmToken.ts) — bukan per-device
// admin-only, jadi tombolnya harus terlihat SEMUA role, bukan di
// PengaturanModule.tsx (yang admin+supervisor only).
import { useFcmToken } from "@/hooks/useFcmToken";

export interface SidebarMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /**
   * ── TAMBAHAN (T-10) ── Role yang boleh MELIHAT menu ini, sesuai matriks
   * permission PRD §5 (kolom "view" tiap modul). Kosongkan (undefined) untuk
   * menu yang boleh dilihat SEMUA role aktif (dashboard/kasir/produk/riwayat/
   * kas_shift — semuanya minimal "view" di §5). Role `qc` sengaja diperlakukan
   * seperti `kasir` (paling terbatas) untuk menu yang tidak eksplisit
   * disebut di matriks §5 (kolomnya cuma Kasir/Supervisor/Admin) — belum ada
   * keputusan pemilik project soal qc, jadi default paling aman (tidak
   * elevated) dipakai sampai ada keputusan lain.
   */
  roles?: UserRole[];
}

export interface SidebarMenuGroup {
  label: string;
  items: SidebarMenuItem[];
}

// Struktur grup mengikuti PRD §4.1 (UTAMA / ALAT KASIR / ...). Menu yang belum
// dibangun (Stok Menipis, Laporan, Nota/Struk mandiri, dst.) belum dimasukkan ke
// sini — tambahkan begitu modulnya sudah ada, jangan render menu ke modul kosong.
const MENU_GROUPS: SidebarMenuGroup[] = [
  {
    label: "Utama",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "kasir", label: "Kasir (POS)", icon: ShoppingCart },
      { key: "produk", label: "Produk", icon: Package },
      { key: "riwayat", label: "Riwayat Transaksi", icon: ReceiptText },
    ],
  },
  {
    label: "Alat Kasir",
    items: [
      // ── TAMBAHAN (T-05) ── Menu Stok & Opname. Ditaruh di grup "Alat Kasir"
      // mengikuti PRD §4.1 (di sana Produk & Stok memang satu grup dengan Kas).
      // "Produk" sendiri sengaja dibiarkan di grup Utama seperti sebelumnya —
      // memindahkannya bukan bagian task ini dan bisa membingungkan kasir yang
      // sudah hafal posisi menu.
      // roles: PRD §5 baris `stok` — Kasir "—", Supervisor/Admin "✔".
      {
        key: "stok",
        label: "Stok & Opname",
        icon: Boxes,
        roles: ["admin", "supervisor"],
      },
      // roles: kosong (semua role) — PRD §5 baris `kas_shift` — Kasir "✔ (sendiri)".
      { key: "kas", label: "Kas & Shift", icon: Wallet },
    ],
  },
  {
    // ── TAMBAHAN (T-08) ── Grup terpisah dari "Alat Kasir" secara sengaja —
    // Laporan diasumsikan khusus admin/supervisor (lihat catatan ASUMSI di
    // LaporanModule.tsx & hooks/useReports.ts), beda konteks dari alat kerja
    // harian kasir.
    //
    // ── PERUBAHAN (T-10) ── `roles` sekarang benar-benar diterapkan (lihat
    // fungsi filter di komponen bawah) — sebelumnya menu ini tampil ke semua
    // role dan cuma ditahan layar blokir di dalam LaporanModule.tsx. Layar
    // blokir itu TETAP ada, sengaja tidak dihapus (defense in depth — kalau
    // suatu saat filter di sini ke-skip karena bug, LaporanModule.tsx sendiri
    // tetap menolak).
    label: "Laporan",
    items: [
      {
        key: "laporan",
        label: "Laporan",
        icon: TrendingUp,
        roles: ["admin", "supervisor"],
      },
    ],
  },
  {
    // ── TAMBAHAN (T-09) ── Grup "Lainnya" sesuai penamaan persis di PRD §4.1
    // & §298 (bukan "Administrasi"/dsb.). "Log Aktivitas" ditambahkan
    // menyusul setelah LogAktivitasModule.tsx jadi (lihat komentar header
    // file: jangan render menu ke modul kosong — sebelumnya cuma "Sampah").
    //
    // Kedua menu di grup ini admin+supervisor (bukan admin-only seperti PRD
    // §5 asli — keputusan sadar pemilik project, migration 015; lihat
    // komentar header migration itu).
    //
    // ── PERUBAHAN (T-10) ── `roles` di bawah sekarang benar-benar diterapkan
    // (sebelumnya cuma catatan komentar, menu tampil ke semua role). Layar
    // blokir di SampahModule.tsx/LogAktivitasModule.tsx TETAP ada (defense
    // in depth, sama alasannya dengan grup "Laporan" di atas).
    label: "Lainnya",
    items: [
      {
        key: "sampah",
        label: "Sampah",
        icon: Trash2,
        roles: ["admin", "supervisor"],
      },
      {
        key: "log-aktivitas",
        label: "Log Aktivitas",
        icon: ClipboardList,
        roles: ["admin", "supervisor"],
      },
    ],
  },
  {
    // ── TAMBAHAN (T-10) ── Grup baru "Administrasi", khusus menu
    // "Pengaturan". Sengaja dipisah dari grup "Lainnya" (bukan ditumpuk
    // dengan Sampah/Log Aktivitas) walau sama-sama admin+supervisor — PRD
    // §4.1 memang menyebut "Pengaturan Admin" terpisah dari grup "LAINNYA"
    // (baris "Pengaturan Admin — user, role, permission, ..." ditulis
    // sebagai section sendiri di diagram §4.1, bukan di bawah "Sampah/Log
    // Aktivitas").
    //
    // ── REVISI (migration 018) ── `roles` semula `["admin"]` saja, sekarang
    // `["admin", "supervisor"]` — pemilik project MINTA LANGSUNG akses
    // supervisor ke modul ini untuk keperluan pengujian, sama alasannya
    // dengan migration 015 (akun pemilik/penguji sehari-hari berrole
    // `supervisor`). Ini keputusan sadar, menyimpang dari PRD §5 asli
    // (baris `settings` = "Admin" saja) — lihat komentar header migration
    // `018_pengaturan_supervisor_access.sql` untuk detail lengkap & 2
    // pengaman tambahan (supervisor tidak bisa menyentuh/membuat akun
    // admin) yang TIDAK ada di migration 015 karena modul ini beda kelas
    // risiko (bisa ubah role user lain, bukan cuma restore data).
    label: "Administrasi",
    items: [
      {
        key: "pengaturan",
        label: "Pengaturan",
        icon: Settings,
        roles: ["admin", "supervisor"],
      },
    ],
  },
];

/**
 * ── TAMBAHAN (T-10) ── Saring MENU_GROUPS sesuai role user aktif. Item tanpa
 * `roles` (undefined) lolos untuk role manapun. Grup yang jadi kosong setelah
 * disaring (semua itemnya tersaring) TIDAK dirender sama sekali — supaya
 * tidak ada judul grup menggantung tanpa isi (mis. kasir tidak akan melihat
 * judul grup "Administrasi" kalau satu-satunya isinya, "Pengaturan",
 * tersaring).
 *
 * `role` boleh `undefined` (auth masih loading) — dalam kondisi itu semua
 * item yang PUNYA `roles` ikut disembunyikan dulu (default paling aman),
 * baru muncul begitu role user selesai dimuat. Ini sengaja, supaya tidak ada
 * "kedipan" menu sensitif tampil sebentar lalu hilang saat auth masih
 * resolve (pola yang sama seperti kehati-hatian anti-blink di modul lain,
 * lihat catatan blink LaporanModule.tsx/SampahModule.tsx di PROGRESS.md).
 */
function filterMenuGroups(
  groups: SidebarMenuGroup[],
  role: UserRole | undefined,
) {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.roles || (role && item.roles.includes(role)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * ── TAMBAHAN (T-12) ── Status + tombol aktifkan notifikasi push, ditaruh di
 * footer Sidebar (bukan Pengaturan) supaya terlihat SEMUA role — ini
 * pengaturan per-device kasir, bukan pengaturan toko.
 *
 * Kalau `status` "unsupported" atau "missing_config" (env Firebase belum
 * diisi — lihat lib/firebase/client.ts), SENGAJA tidak dirender apa-apa:
 * menampilkan tombol yang pasti gagal cuma membingungkan kasir yang tidak
 * bisa berbuat apa-apa soal itu (butuh env var diisi pemilik project, bukan
 * aksi dari layar ini).
 */
function NotificationStatus() {
  const { status, requestPermission } = useFcmToken();

  if (status === "unsupported" || status === "missing_config") return null;

  if (status === "granted") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
        <Bell className="h-3.5 w-3.5 text-lco-teal" />
        Notifikasi aktif
      </div>
    );
  }

  if (status === "checking") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Mengaktifkan notifikasi...
      </div>
    );
  }

  if (status === "denied") {
    // Browser TIDAK akan menampilkan prompt lagi begitu ditolak — satu-satunya
    // jalan adalah user ubah manual dari pengaturan browser, tombol di sini
    // percuma dipanggil ulang (lihat catatan header lib/firebase/client.ts).
    return (
      <div className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-500">
        <div className="flex items-center gap-2">
          <BellOff className="h-3.5 w-3.5" />
          Notifikasi diblokir browser
        </div>
        <p className="mt-0.5 text-[11px] leading-snug">
          Aktifkan lewat pengaturan izin situs di browser.
        </p>
      </div>
    );
  }

  // status "idle" atau "error" — tombol untuk minta izin/coba lagi.
  return (
    <button
      onClick={() => void requestPermission()}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-zinc-600 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    >
      <Bell className="h-3.5 w-3.5" />
      {status === "error"
        ? "Coba aktifkan notifikasi lagi"
        : "Aktifkan Notifikasi"}
    </button>
  );
}

interface SidebarProps {
  activeMenu: string;
  onMenuChange: (menu: string) => void;
}

export default function Sidebar({ activeMenu, onMenuChange }: SidebarProps) {
  // ── TAMBAHAN (T-10) ── Sidebar sengaja tetap "dumb" untuk activeMenu/
  // onMenuChange (dikontrol dari page.tsx seperti sebelumnya), tapi butuh
  // tahu role sendiri untuk menyaring menu — dipanggil langsung di sini
  // (bukan lewat prop baru dari page.tsx) supaya page.tsx tidak perlu
  // berubah sama sekali, konsisten dengan komentar header file ini
  // ("tidak perlu sentuh page.tsx sama sekali" untuk urusan menu).
  const { user } = useAuth();
  const visibleGroups = filterMenuGroups(MENU_GROUPS, user?.role);

  return (
    <aside className="hidden w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 md:flex">
      {/* ── TAMBAHAN (T-12) ── Dibungkus flex-1 overflow-y-auto supaya daftar
          menu bisa scroll sendiri kalau kepanjangan, TANPA ikut menggeser
          footer notifikasi di bawah keluar layar. */}
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-zinc-200 p-5 dark:border-zinc-800">
          <h1 className="rounded-xl text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            LCO POS
          </h1>
        </div>

        {visibleGroups.map((group) => (
          <div key={group.label} className="p-3 pt-3 first:pt-3">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              {group.label}
            </p>

            <nav className="flex flex-col gap-1">
              {group.items.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => onMenuChange(key)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    activeMenu === key
                      ? "bg-zinc-100 text-lco-teal dark:bg-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>
          </div>
        ))}
      </div>

      {/* ── TAMBAHAN (T-12) ── Footer notifikasi, di luar area scroll di atas
          supaya selalu terlihat. */}
      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <NotificationStatus />
      </div>
    </aside>
  );
}
