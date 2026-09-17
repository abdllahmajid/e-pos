"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Sidebar from "./components/layout/Sidebar";

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

export default function LCOPOS() {
  const [activeMenu, setActiveMenu] = useState("kasir");

  // ── TAMBAHAN (T-04) ── dipakai KasirModule untuk pindah ke menu Kas & Shift
  // saat kasir belum buka shift (lihat layar blokir di KasirModule.tsx).
  const goToShiftMenu = () => setActiveMenu("kas");

  return (
    <div className="flex h-screen bg-zinc-100 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ── KOREKSI ── Sidebar dipisah ke app/components/layout/Sidebar.tsx, page.tsx
          sekarang cuma shell: simpan state menu aktif + render modul yang dipilih. */}
      <Sidebar activeMenu={activeMenu} onMenuChange={setActiveMenu} />

      <main className="flex-1 overflow-hidden">
        {activeMenu === "dashboard" && <DashboardModule />}
        {activeMenu === "kasir" && (
          <KasirModule onNavigateToShift={goToShiftMenu} />
        )}
        {activeMenu === "produk" && <ProdukModule />}
        {activeMenu === "riwayat" && <TransactionHistoryModule />}
        {activeMenu === "stok" && <StokModule />}
        {activeMenu === "kas" && <KasModule />}
      </main>
    </div>
  );
}
