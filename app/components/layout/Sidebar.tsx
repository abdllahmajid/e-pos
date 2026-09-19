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
  type LucideIcon,
} from "lucide-react";
import { useAuth, type UserRole } from "@/hooks/useAuth";

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
    // dengan Sampah/Log Aktivitas) walau sama-sama admin — PRD §4.1 memang
    // menyebut "Pengaturan Admin" terpisah dari grup "LAINNYA" (baris
    // "Pengaturan Admin — user, role, permission, ..." ditulis sebagai
    // section sendiri di diagram §4.1, bukan di bawah "Sampah/Log
    // Aktivitas"). `roles: ["admin"]` SAJA (bukan +supervisor) — beda dari
    // Sampah/Log Aktivitas yang sengaja dilonggarkan migration 015; menu ini
    // TIDAK ikut dilonggarkan karena belum ada keputusan sadar pemilik
    // project untuk `settings` (PRD §5 baris `settings` tetap admin only,
    // tidak disentuh migration 015 sama sekali — RLS `settings` di migration
    // 005 pun masih murni admin only).
    label: "Administrasi",
    items: [
      {
        key: "pengaturan",
        label: "Pengaturan",
        icon: Settings,
        roles: ["admin"],
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
    <aside className="hidden w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 md:flex md:flex-col">
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
    </aside>
  );
}
