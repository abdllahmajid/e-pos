export default function DashboardModule() {
  return (
    <div className="p-6 h-full flex flex-col">
      <h2 className="text-2xl font-bold mb-4">Dashboard Utama</h2>
      <div className="flex-1 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl flex items-center justify-center">
        <p className="text-zinc-500">
          Ringkasan grafik dan performa penjualan akan tampil di sini.
        </p>
      </div>
    </div>
  );
}
