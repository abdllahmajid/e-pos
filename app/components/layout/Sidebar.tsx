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

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  // ── PERUBAHAN (Kasir full-screen) ── ShoppingCart tidak lagi dipakai di
  // sini (menu "kasir" dihapus dari MENU_GROUPS, lihat catatan di atas) —
  // tapi ikon yang sama masih dipakai Header.tsx & DashboardModule.tsx untuk
  // tombol "Buka Kasir" yang baru.
  ReceiptText,
  Package,
  Wallet,
  Boxes,
  Monitor,
  TrendingUp,
  Trash2,
  ClipboardList,
  Settings,
  Bell,
  BellOff,
  Sun,
  Moon,
  Loader2,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth, hasPermission, type AuthUser } from "@/hooks/useAuth";
// ── TAMBAHAN (T-12) ── Dipanggil DI SINI SAJA (satu-satunya titik panggil di
// seluruh app, lihat catatan header hooks/useFcmToken.ts) — bukan per-device
// admin-only, jadi tombolnya harus terlihat SEMUA role, bukan di
// PengaturanModule.tsx (yang admin+supervisor only).
import { useFcmToken } from "@/hooks/useFcmToken";
// ── TAMBAHAN (dark mode toggle, sidebar) ── Sama alasannya dengan
// useFcmToken di atas: preferensi PER-DEVICE, bukan pengaturan toko, jadi
// tombolnya sengaja ditaruh di sini (footer Sidebar), BUKAN di
// PengaturanModule.tsx (admin/supervisor only) — supaya semua role kasir
// bisa mengatur tampilan device yang sedang mereka pakai sendiri, kapan
// saja, tanpa perlu izin admin. Lihat catatan lengkap di
// hooks/useThemePreference.ts.
import { useThemePreference } from "@/hooks/useThemePreference";

export interface SidebarMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /**
   * ── REVISI (migration 028/030, "sistem role dinamis") ── Sebelumnya field
   * ini `roles?: UserRole[]` (daftar nama role tetap admin/supervisor/kasir/
   * qc, dicocokkan ke `user.role` string tunggal). Role sekarang data bebas
   * (tabel `roles`), bukan lagi 4 pilihan pasti, jadi menu TIDAK BISA lagi
   * digate per nama role — diganti daftar permission_key dari katalog
   * `permissions` (lihat migration 028, sama persis dipakai tab Pengaturan >
   * Role buat checklist). Menu tampil kalau user punya SALAH SATU (OR) dari
   * permission_key di sini — array biasanya cuma 1 key (mis. `["stok"]`),
   * kecuali menu "Pengaturan" yang tampil asal user punya minimal satu dari
   * 3 permission tab-nya. Kosongkan (undefined) untuk menu yang boleh
   * dilihat SEMUA role aktif (dashboard/kasir/produk/riwayat/kas_shift —
   * semuanya minimal "view" di PRD §5, dan tidak ada baris permission
   * khususnya di katalog).
   */
  permissions?: string[];
}

export interface SidebarMenuGroup {
  label: string;
  items: SidebarMenuItem[];
}

// Struktur grup mengikuti PRD §4.1 (UTAMA / ALAT KASIR / ...). Menu yang belum
// dibangun (Stok Menipis, Laporan, Nota/Struk mandiri, dst.) belum dimasukkan ke
// sini — tambahkan begitu modulnya sudah ada, jangan render menu ke modul kosong.
// ── TAMBAHAN (header/topbar) ── Sekarang di-`export` (sebelumnya modul-privat
// ke file ini) supaya Header.tsx bisa mengambil judul + ikon menu aktif dari
// SATU sumber yang sama persis dengan Sidebar — tidak ada daftar judul kedua
// yang harus diupdate manual tiap kali menu baru ditambah di sini.
// ── PERUBAHAN (Kasir full-screen, tidak lagi di sidebar) ── "Kasir (POS)"
// SENGAJA dihapus dari MENU_GROUPS. Satu-satunya jalan masuk sekarang tombol
// "Buka Kasir" di Header.tsx & DashboardModule.tsx (keduanya panggil
// onNavigate/onOpenKasir("kasir") langsung, tidak lewat Sidebar sama sekali)
// — begitu activeMenu === "kasir", page.tsx me-render KasirModule TANPA
// Sidebar/Header ini (full-screen takeover, lihat page.tsx). Kalau menu ini
// masih ada di sini, drawer sidebar/mobile jadi punya jalan masuk kedua yang
// tidak konsisten dengan flow itu.
export const MENU_GROUPS: SidebarMenuGroup[] = [
  {
    label: "Utama",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
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
      // permissions: PRD §5 baris `stok` — gate lama admin/supervisor
      // digeneralisasi jadi permission "stok" (migration 028/030).
      {
        key: "stok",
        label: "Stok & Opname",
        icon: Boxes,
        permissions: ["stok"],
      },
      // roles: kosong (semua role) — PRD §5 baris `kas_shift` — Kasir "✔ (sendiri)".
      { key: "kas", label: "Kas & Shift", icon: Wallet },
      // ── TAMBAHAN (Layar Promosi) ── Pengelola gambar/video yang diputar di
      // TV toko lewat halaman publik `/tv`. Fitur di LUAR penomoran T-xx PRD
      // (lihat PROGRESS.md sesi #20). admin+supervisor — sama dengan
      // keputusan Sampah/Log Aktivitas/Pengaturan, dan sejalan dengan RLS
      // tabel `promo_media` (migration 026). Layar blokir di dalam
      // PromoModule.tsx TETAP ada (defense in depth, sama alasannya dengan
      // grup Laporan/Lainnya di bawah).
      {
        key: "promo",
        label: "Layar Promosi",
        icon: Monitor,
        permissions: ["promo"],
      },
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
        permissions: ["laporan"],
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
        permissions: ["sampah"],
      },
      {
        key: "log-aktivitas",
        label: "Log Aktivitas",
        icon: ClipboardList,
        permissions: ["log_aktivitas"],
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
    // ── REVISI (migration 028/030) ── Riwayat lama: `roles` semula
    // `["admin"]`, lalu migration 018 melonggarkan ke `["admin",
    // "supervisor"]` (keputusan sadar pemilik project, lihat header
    // `018_pengaturan_supervisor_access.sql`). Sejak migration 028 role
    // sudah dinamis, jadi gate ini digeneralisasi ke permission: menu
    // tampil kalau user punya SALAH SATU dari 3 permission tab Pengaturan
    // (Toko/Admin/Role) — sama persis dengan gate `canAccessSettings` di
    // PengaturanModule.tsx ("minimal satu dari tiga"), supaya role custom
    // yang cuma dikasih satu tab pun tetap melihat menunya.
    label: "Administrasi",
    items: [
      {
        key: "pengaturan",
        label: "Pengaturan",
        icon: Settings,
        permissions: ["pengaturan_toko", "pengaturan_admin", "pengaturan_role"],
      },
    ],
  },
];

/**
 * ── REVISI (migration 028/030) ── Saring MENU_GROUPS sesuai permission user
 * aktif (sebelumnya sesuai `role` string tunggal dicocokkan ke daftar nama
 * role tetap — lihat riwayat lengkap di komentar `SidebarMenuItem.permissions`
 * di atas). Item tanpa `permissions` (undefined) lolos untuk user manapun.
 * Item DENGAN `permissions` lolos kalau user punya SALAH SATU (OR) dari
 * permission_key di daftar itu — cukup satu match, bukan harus semua
 * (dipakai menu "Pengaturan" yang bisa tampil dari 3 permission berbeda).
 * Grup yang jadi kosong setelah disaring (semua itemnya tersaring) TIDAK
 * dirender sama sekali — supaya tidak ada judul grup menggantung tanpa isi.
 *
 * `user` boleh `null` (auth masih loading / belum login) — dalam kondisi itu
 * `hasPermission` selalu false, jadi semua item yang PUNYA `permissions`
 * ikut disembunyikan dulu (default paling aman), baru muncul begitu profil
 * user selesai dimuat. Ini sengaja, supaya tidak ada "kedipan" menu sensitif
 * tampil sebentar lalu hilang saat auth masih resolve (pola yang sama
 * seperti kehati-hatian anti-blink di modul lain, lihat catatan blink
 * LaporanModule.tsx/SampahModule.tsx di PROGRESS.md).
 */
function filterMenuGroups(groups: SidebarMenuGroup[], user: AuthUser | null) {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.permissions ||
          item.permissions.some((key) => hasPermission(user, key)),
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

// ── TAMBAHAN (dark mode toggle, sidebar) ── Toggle terang/gelap, ditaruh di
// footer Sidebar (bukan Pengaturan) atas permintaan langsung — preferensi
// ini per-device, dibaca/ditulis lewat hooks/useThemePreference.ts
// (localStorage), BUKAN lewat hooks/useSettings.ts (tabel `settings`
// Supabase yang tulisnya admin-only, lihat catatan lengkap di hook itu).
function ThemeToggle() {
  const { theme, toggleTheme } = useThemePreference();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-zinc-600 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5" />
      ) : (
        <Moon className="h-3.5 w-3.5" />
      )}
      {isDark ? "Mode Terang" : "Mode Gelap"}
    </button>
  );
}

interface SidebarProps {
  activeMenu: string;
  onMenuChange: (menu: string) => void;
  // ── TAMBAHAN (Kasir: "Menu" membuka sidebar sebagai drawer) ── Dulu tombol
  // "Menu" di KasirTopBar cuma NAVIGASI balik ke Dashboard (Sidebar sendiri
  // tidak pernah dirender sama sekali selagi Kasir full-screen, lihat
  // page.tsx). Sekarang: Sidebar TETAP dirender (tersembunyi off-canvas) saat
  // Kasir full-screen, dan "Menu" di Kasir MEMBUKA-nya sebagai drawer di atas
  // layar Kasir — persis seperti drawer mobile yang sudah ada di sini
  // (`mobileOpen`/hamburger di bawah), cuma sumber "buka/tutup"-nya sekarang
  // BISA datang dari luar (Kasir), bukan cuma hamburger internal.
  //
  // Kedua prop ini opsional & SEPASANG — kalau diberikan, drawer jadi
  // "controlled" (state betul-betul dipegang page.tsx, bukan Sidebar), DAN
  // hamburger bawaan Sidebar disembunyikan (karena kasir sudah punya tombol
  // "Menu" sendiri di KasirTopBar — dua pemicu buka/tutup akan membingungkan)
  // DAN pembatasan "drawer cuma di bawah breakpoint md" dilepas, supaya
  // tetap jadi overlay drawer walau dibuka dari mode PC (desktop). Kalau
  // TIDAK diberikan (dipakai dari page.tsx di luar Kasir, seperti biasa),
  // semua perilaku lama (hamburger sendiri, drawer mobile-only) apa adanya.
  forceOpen?: boolean;
  onForceOpenChange?: (open: boolean) => void;
}

export default function Sidebar({
  activeMenu,
  onMenuChange,
  forceOpen,
  onForceOpenChange,
}: SidebarProps) {
  // ── TAMBAHAN (T-10) ── Sidebar sengaja tetap "dumb" untuk activeMenu/
  // onMenuChange (dikontrol dari page.tsx seperti sebelumnya), tapi butuh
  // tahu role sendiri untuk menyaring menu — dipanggil langsung di sini
  // (bukan lewat prop baru dari page.tsx) supaya page.tsx tidak perlu
  // berubah sama sekali, konsisten dengan komentar header file ini
  // ("tidak perlu sentuh page.tsx sama sekali" untuk urusan menu).
  const { user, signOut } = useAuth();
  const visibleGroups = filterMenuGroups(MENU_GROUPS, user);

  // ── TAMBAHAN (responsif) ── Di bawah breakpoint `md` (tablet portrait &
  // HP), sidebar sebelumnya `hidden` total — tidak ada cara buka menu sama
  // sekali di perangkat itu. Sekarang jadi drawer off-canvas: tersembunyi di
  // luar layar (`-translate-x-full`) sampai `mobileOpen` true, dibuka lewat
  // tombol hamburger mengambang (di bawah) dan ditutup lewat tombol X di
  // header drawer, klik overlay gelap, atau otomatis begitu satu menu
  // dipilih. Di `md` ke atas, drawer ini balik jadi sidebar statis seperti
  // semula (lihat className `<aside>` — `md:translate-x-0 md:static`
  // menimpa state ini, jadi `mobileOpen` tidak berpengaruh sama sekali di
  // desktop/tablet landscape besar).
  const [mobileOpenState, setMobileOpenState] = useState(false);
  // "controlled" kalau page.tsx mengirim forceOpen (kasus Kasir); kalau
  // tidak, jatuh balik ke state internal seperti sebelumnya.
  const isControlled = forceOpen !== undefined;
  const mobileOpen = isControlled ? forceOpen : mobileOpenState;
  const setMobileOpen = (open: boolean) => {
    if (isControlled) onForceOpenChange?.(open);
    else setMobileOpenState(open);
  };

  // Kunci scroll body selagi drawer terbuka di mobile, supaya konten di
  // belakang overlay tidak ikut ter-scroll (pola standar untuk off-canvas
  // drawer). Dibersihkan lagi begitu drawer ditutup / komponen unmount.
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  // Bungkus onMenuChange: selain memanggil handler asli dari page.tsx, juga
  // tutup drawer di mobile begitu satu menu dipilih — supaya kasir tidak
  // perlu tap X manual tiap habis pindah menu. Tidak berdampak apa-apa di
  // desktop (mobileOpen memang tidak pernah true di sana).
  function handleMenuSelect(key: string) {
    onMenuChange(key);
    setMobileOpen(false);
  }

  // ── TAMBAHAN (logout) ── `signOut()` di hooks/useAuth.ts sudah ada dan sudah
  // menghapus token FCM SEBELUM mengakhiri sesi, tapi sebelumnya tidak ada
  // komponen yang memanggilnya. Setelah sesi berakhir kita pindah halaman
  // dengan reload penuh (bukan router.push) supaya semua state di memori —
  // keranjang, data shift, cache hook — ikut hilang dan tidak bocor ke user
  // berikutnya di tablet kasir yang dipakai bergantian.
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      window.location.assign("/login");
    } catch {
      setSignOutError("Gagal keluar. Periksa koneksi lalu coba lagi.");
      setIsSigningOut(false);
    }
  }

  return (
    <>
      {/* ── TAMBAHAN (responsif) ── Tombol hamburger, hanya tampil di bawah
          `md` (mobile/tablet portrait) dan hanya saat drawer TERTUTUP —
          begitu drawer terbuka, tombol tutup (X) di header drawer mengambil
          alih perannya supaya tidak ada dua tombol toggle tumpang tindih. */}
      {/* ── TAMBAHAN (responsif) ── Tombol hamburger bawaan Sidebar — hanya
          tampil di bawah `md` (mobile/tablet portrait) DAN cuma kalau drawer
          ini TIDAK "controlled" dari luar. Saat dipakai dari Kasir
          (`forceOpen` diberikan), Kasir punya tombol "Menu" sendiri di
          KasirTopBar yang mengambil alih peran ini — dua tombol buka akan
          membingungkan. */}
      {!mobileOpen && !isControlled && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Buka menu"
          className="fixed left-3 top-3 z-30 inline-flex h-10 w-10 items-center justify-center rounded-lg  border-zinc-200 bg-white text-zinc-700  active:scale-95 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* ── TAMBAHAN (responsif) ── Overlay gelap di belakang drawer, hanya
          dirender (dan hanya menutup akses klik ke konten di baliknya)
          selagi drawer terbuka. `md:hidden` memastikan ini tidak pernah
          muncul di desktop/tablet besar SAAT TIDAK controlled — begitu
          `isControlled` true (dibuka dari Kasir mode PC), overlay ini SENGAJA
          tetap tampil di layar besar juga, karena itu justru yang diminta:
          sidebar sebagai drawer di atas layar Kasir, bukan sidebar statis. */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          className={`fixed inset-0 z-30 bg-black/50 ${isControlled ? "" : "md:hidden"}`}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 ease-in-out dark:border-zinc-800 dark:bg-zinc-950 ${
          isControlled
            ? ""
            : "md:static md:z-auto md:w-64 md:translate-x-0 md:transition-none"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* ── TAMBAHAN (T-12) ── Dibungkus flex-1 overflow-y-auto supaya daftar
          menu bisa scroll sendiri kalau kepanjangan, TANPA ikut menggeser
          footer notifikasi di bawah keluar layar. */}
        <div className="flex-1 overflow-y-auto">
          {/* ── PERBAIKAN (garis bawah sejajar dengan Header) ── Dulu tinggi blok
              ini "ikut isi" (padding p-5 + tinggi teks judul + 1px border =
              69px), sedangkan Header.tsx memakai `h-17` (68px, border sudah
              termasuk) — akibatnya garis bawah sidebar & garis bawah header
              beda 1px dan tampak tidak lurus. Sekarang tinggi dikunci sama
              persis dengan Header (`h-17`), padding vertikal diganti
              `items-center`. WAJIB dijaga sama: kalau tinggi Header.tsx
              diubah, ubah juga angka `h-17` di sini. */}
          <div className="flex h-17 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
            {/* ── PERUBAHAN (logo menyesuaikan tema) ── Sebelumnya satu logo putih
                ditaruh di kotak hijau. Sekarang ada 2 file di `public/`:
                `BlackIcon.png` (untuk tema terang) & `WhiteIcon.png` (untuk
                tema gelap), tanpa kotak latar. Yang tampil dipilih murni lewat
                CSS — `dark:hidden` / `hidden dark:block` mengikuti class `dark`
                di <html> (diatur hooks/useThemePreference.ts) — jadi ikut
                berganti seketika saat tema diubah, tanpa state/JS tambahan.
                Nama file CASE-SENSITIVE di server Linux/Vercel: harus persis
                `BlackIcon.png` & `WhiteIcon.png`. `object-contain` supaya logo
                persegi maupun lebar tidak terpotong/gepeng. Kalau file belum
                ada, gambar disembunyikan (onError) — tidak ada ikon rusak. */}
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- logo statis kecil dari /public, tidak perlu dioptimasi next/image */}
                <img
                  src="/BlackIcon.png"
                  alt="Logo LCO POS"
                  className="h-full w-full object-contain dark:hidden"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- lihat catatan di atas */}
                <img
                  src="/WhiteIcon.png"
                  alt="Logo LCO POS"
                  className="hidden h-full w-full object-contain dark:block"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </span>
              {/* ── TAMBAHAN (teks kecil di bawah judul) ── Supaya blok logo tidak
                  terlihat polos. Gaya label kecil disamakan dengan label grup
                  menu & label di Header.tsx (10px, uppercase, tracking lebar). */}
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold leading-tight tracking-tight text-zinc-900 dark:text-zinc-100">
                  LCO POS
                </h1>
                <p className="mt-0.5 truncate text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-zinc-400">
                  Kasir Langitan.co
                </p>
              </div>
            </div>
            {/* ── TAMBAHAN (responsif) ── Tombol tutup drawer. Biasanya cuma
                tampil di mobile/tablet portrait (`md:hidden`) karena di
                desktop sidebar memang selalu terbuka & statis — TAPI saat
                `isControlled` (dibuka dari Kasir), sidebar SELALU dalam mode
                drawer walau di layar besar, jadi tombol tutup ini juga harus
                selalu tampil di situ. */}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Tutup menu"
              className={`rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 ${isControlled ? "" : "md:hidden"}`}
            >
              <X className="h-5 w-5" />
            </button>
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
                    onClick={() => handleMenuSelect(key)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
                      // ── PERUBAHAN (theme-guide.md §6.6) ── Item aktif sebelumnya
                      // `bg-zinc-100 text-lco-teal` (netral + aksen) — panduan tema
                      // resmi §6.6 minta item aktif pakai wash brand-nya sendiri
                      // (green di light mode, teal di dark mode) + font-semibold,
                      // bukan background abu-abu netral.
                      activeMenu === key
                        ? "bg-lco-green/10 font-semibold text-lco-green dark:bg-lco-teal/15 dark:text-lco-teal"
                        : "font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
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
          {/* ── TAMBAHAN (dark mode toggle, sidebar) ── */}
          <ThemeToggle />
          <NotificationStatus />

          {/* ── TAMBAHAN (logout) ── Identitas user + tombol Keluar. */}
          <div className="mt-1 border-t border-zinc-200 px-3 pt-3 pb-1 dark:border-zinc-800">
            {user && (
              <div className="mb-2 min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {user.full_name || user.email || "Pengguna"}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  {/* ── REVISI (migration 028/030) ── `ROLE_LABELS[user.role]`
                      (lookup ke 4 nama role tetap) dihapus — role sekarang
                      data bebas, namanya sudah human-readable apa adanya
                      dari tabel `roles` (mis. "Admin", "Kasir Cabang"),
                      tidak perlu translasi lagi. */}
                  {user.role_name}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {isSigningOut ? "Keluar..." : "Keluar"}
            </button>

            {signOutError && (
              <p className="mt-1 px-3 text-[11px] leading-snug text-lco-coral">
                {signOutError}
              </p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
