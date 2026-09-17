"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Package,
} from "lucide-react";

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

export default function LCOPOS() {
  const [activeMenu, setActiveMenu] = useState("kasir");

  return (
    <div className="flex h-screen bg-zinc-100 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="hidden w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 md:flex md:flex-col">
        <div className="border-b border-zinc-200 p-5 dark:border-zinc-800">
          <h1 className="rounded-xl text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            LCO POS
          </h1>
        </div>

        <div className="p-3">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Utama
          </p>

          <nav className="flex flex-col gap-1">
            <button
              onClick={() => setActiveMenu("dashboard")}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                activeMenu === "dashboard"
                  ? "bg-zinc-100 text-lco-teal dark:bg-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>

            <button
              onClick={() => setActiveMenu("kasir")}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                activeMenu === "kasir"
                  ? "bg-zinc-100 text-lco-teal dark:bg-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <ShoppingCart className="h-4 w-4" />
              Kasir (POS)
            </button>

            <button
              onClick={() => setActiveMenu("produk")}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                activeMenu === "produk"
                  ? "bg-zinc-100 text-lco-teal dark:bg-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <Package className="h-4 w-4" />
              Produk
            </button>

            <button
              onClick={() => setActiveMenu("riwayat")}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                activeMenu === "riwayat"
                  ? "bg-zinc-100 text-lco-teal dark:bg-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <ReceiptText className="h-4 w-4" />
              Riwayat Transaksi
            </button>
          </nav>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {activeMenu === "dashboard" && <DashboardModule />}
        {activeMenu === "kasir" && <KasirModule />}
        {activeMenu === "produk" && <ProdukModule />}
        {activeMenu === "riwayat" && <TransactionHistoryModule />}
      </main>
    </div>
  );
}
