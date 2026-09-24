"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Sidebar from "./components/layout/Sidebar";
// ── TAMBAHAN (header/topbar) ── Lihat catatan header lengkap di file ini.
import Header from "./components/layout/Header";

// Dynamic Imports
const KasirModule = dynamic(() => import("./components/kasir/KasirModule"), {
  ssr: false,
});

const DashboardModule = dynamic(
  () => import("./components/dashboard/DashboardModule"),
  {
    ssr: false,
  },
);

const TransactionHistoryModule = dynamic(
  () => import("./components/transaksi/TransactionHistoryModule"),
  {
    ssr: false,
  },
);

const ProdukModule = dynamic(() => import("./components/produk/ProdukModule"), {
  ssr: false,
});

// ── TAMBAHAN (T-04) ── Modul Kas & Shift.
const KasModule = dynamic(() => import("./components/kas/KasModule"), {
  ssr: false,
});

// ── TAMBAHAN (T-05) ── Modul Stok & Opname (riwayat mutasi + opname manual).
const StokModule = dynamic(() => import("./components/stok/StokModule"), {
  ssr: false,
});

// ── TAMBAHAN (T-08) ── Modul Laporan (Harian/Bulanan, Per Shift, Piutang/Tempo).
// Menu "laporan" sudah ada di Sidebar.tsx sejak T-08, tapi belum dirender di
// sini sampai sekarang — sebelum baris ini ditambah, klik menu Laporan cuma
// menampilkan layar kosong (activeMenu berubah, tapi tidak ada blok JSX yang
// cocok di bawah).
const LaporanModule = dynamic(
  () => import("./components/laporan/LaporanModule"),
  {
    ssr: false,
  },
);

// ── TAMBAHAN (T-09) ── Modul Sampah (produk & transaksi yang di-soft-delete,
// admin+supervisor — layar blokirnya sendiri sudah di dalam SampahModule.tsx).
const SampahModule = dynamic(() => import("./components/sampah/SampahModule"), {
  ssr: false,
});

// ── TAMBAHAN (T-09) ── Modul Log Aktivitas (audit trail aksi sensitif),
// menyusul SampahModule di atas — satu task T-09, dua menu terpisah sesuai
// PRD §4.1. Sama seperti Sampah: admin+supervisor, layar blokirnya sendiri
// sudah di dalam LogAktivitasModule.tsx.
const LogAktivitasModule = dynamic(
  () => import("./components/log-aktivitas/LogAktivitasModule"),
  {
    ssr: false,
  },
);

// ── TAMBAHAN (T-10) ── Modul Pengaturan (Toko/Struk + kelola user), admin
// only — menu "pengaturan" sudah ada di Sidebar.tsx (grup "Administrasi"),
// belum dirender di sini sampai sekarang. Isi modulnya sendiri masih stub
// ("segera hadir") per komentar header PengaturanModule.tsx — sub-tabnya
// menyusul sesi berikutnya, tapi menu sudah bisa diklik & gate-nya sudah
// bisa dites mulai commit ini.
const PengaturanModule = dynamic(
  () => import("./components/pengaturan/PengaturanModule"),
  {
    ssr: false,
  },
);

// ── TAMBAHAN (Layar Promosi) ── Modul pengelola media TV toko, admin+supervisor
// (layar blokirnya sendiri sudah di dalam PromoModule.tsx). WAJIB `ssr: false`:
// modul ini membaca `window.location` langsung saat render.
const PromoModule = dynamic(() => import("./components/promo/PromoModule"), {
  ssr: false,
});

export default function LCOPOS() {
  // ── KOREKSI (setelah login diarahkan ke Dashboard) ── Sebelumnya default
  // "kasir", jadi kasir/admin yang baru login langsung masuk layar POS.
  // Sekarang default "dashboard" — halaman ini ("/") satu-satunya tempat
  // yang menyimpan `activeMenu`, dan login/page.tsx (setelah signIn sukses)
  // selalu redirect ke sini via `router.push("/")`, jadi mengganti default
  // di sini otomatis membuat SETIAP login mendarat di Dashboard dulu,
  // bukan langsung ke menu Kasir. Menu "dashboard" sendiri tidak dibatasi
  // role (lihat MENU_GROUPS di Sidebar.tsx — tidak ada `roles: [...]`),
  // jadi aman untuk semua role (admin/supervisor/kasir/qc).
  const [activeMenu, setActiveMenu] = useState("dashboard");

  // ── TAMBAHAN (T-04) ── dipakai KasirModule untuk pindah ke menu Kas & Shift
  // saat kasir belum buka shift (lihat layar blokir di KasirModule.tsx).
  const goToShiftMenu = () => setActiveMenu("kas");

  return (
    <div className="flex h-screen bg-zinc-100 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ── KOREKSI ── Sidebar dipisah ke app/components/layout/Sidebar.tsx, page.tsx
          sekarang cuma shell: simpan state menu aktif + render modul yang dipilih. */}
      <Sidebar activeMenu={activeMenu} onMenuChange={setActiveMenu} />

      {/* ── PERUBAHAN (header/topbar) ── `main` sekarang `flex-col`: Header di
          atas (tinggi tetap, `shrink-0` lewat className-nya sendiri), lalu
          div pembungkus modul di bawahnya diberi `flex-1 min-h-0` supaya
          mengambil SISA tinggi layar. Modul-modul di bawah (Dashboard, Kasir,
          dst.) sudah pakai `h-full` di root masing-masing sejak sebelumnya,
          jadi otomatis pas mengisi div pembungkus ini — tidak perlu ubah
          satu pun file modul. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Header activeMenu={activeMenu} />

        <div className="min-h-0 flex-1">
          {activeMenu === "dashboard" && (
            <DashboardModule onNavigate={setActiveMenu} />
          )}
          {activeMenu === "kasir" && (
            <KasirModule onNavigateToShift={goToShiftMenu} />
          )}
          {activeMenu === "produk" && <ProdukModule />}
          {activeMenu === "riwayat" && <TransactionHistoryModule />}
          {activeMenu === "stok" && <StokModule />}
          {activeMenu === "kas" && <KasModule />}
          {activeMenu === "promo" && <PromoModule />}
          {activeMenu === "laporan" && <LaporanModule />}
          {activeMenu === "sampah" && <SampahModule />}
          {activeMenu === "log-aktivitas" && <LogAktivitasModule />}
          {activeMenu === "pengaturan" && <PengaturanModule />}
        </div>
      </main>
    </div>
  );
}
