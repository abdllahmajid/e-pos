import { createClient } from "@supabase/supabase-js";

// 1. Klien Lama (Database Lama)
const oldSupabase = createClient(
  "https://cvezzsfqnaurkthebcbj.supabase.co", 
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2ZXp6c2ZxbmF1cmt0aGViY2JqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTUzODYxNSwiZXhwIjoyMTA1MTE0NjE1fQ.qe5C16TwDyPjFx-FCUvtV0WnQKkL-exH4RdqQiaBqf0"
);

// 2. Klien Baru (Database Baru)
const newSupabase = createClient(
  "https://crcizjiknjpiprzrdeii.supabase.co", 
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyY2l6amlrbmpwaXByenJkZWlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTYxNzc3MywiZXhwIjoyMTA1MTkzNzczfQ.slnT82rR5aKFnhRiIdRd0zihMUllmr4Tuf4fRMtT7MU"
);

async function migrateAllData() {
  console.log("🚀 Memulai proses migrasi mendalam...");

  // Urutan mutlak: Induk -> Anak -> Cucu (untuk menjaga foreign key)
  const tables = [
    "categories",
    "profiles",
    "products",
    "transactions",
    "transaction_items",
    "payments",
    "stock_movements"
  ];

  for (const tableName of tables) {
    console.log(`\n----------------------------------------`);
    console.log(`📂 Memproses tabel: ${tableName}...`);
    
    const { data, error: fetchError } = await oldSupabase.from(tableName).select("*");
    
    if (fetchError) {
      console.error(`❌ Gagal mengambil data dari ${tableName}:`, fetchError.message);
      continue;
    }

    if (!data || data.length === 0) {
      console.log(`ℹ️ Tabel ${tableName} kosong di database lama.`);
      continue;
    }

    console.log(`📦 Ditemukan ${data.length} baris data di ${tableName}. Memasukkan satu per satu...`);

    // Masukkan data per baris agar kita tahu jika ada baris spesifik yang gagal beserta alasan errornya
    let successCount = 0;
    let failCount = 0;

    for (const row of data) {
      const { error: insertError } = await newSupabase.from(tableName).upsert(row);
      
      if (insertError) {
        failCount++;
        console.error(`  ❌ Gagal insert baris ID [${row.id || 'N/A'}]:`, insertError.message);
      } else {
        successCount++;
      }
    }

    console.log(`📊 Hasil ${tableName}: Berhasil (${successCount}), Gagal (${failCount})`);
  }

  console.log("\n🎉 Proses migrasi mendalam selesai!");
}

migrateAllData();