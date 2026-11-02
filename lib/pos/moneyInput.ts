// lib/pos/moneyInput.ts
// ── TAMBAHAN ── Helper murni (tanpa React) untuk input nominal rupiah,
// dipakai app/components/ui/MoneyInput.tsx.

/**
 * Ambil angka saja dari teks bebas ("Rp 200.000", "200000", "2a0b") dan
 * buang nol di depan ("007" -> "7"). Kosong tetap "". Dibatasi `maxDigits`.
 */
export function sanitizeMoneyDigits(raw: string, maxDigits = 12): string {
  const digits = raw.replace(/\D/g, "").slice(0, maxDigits);
  return digits.replace(/^0+(?=\d)/, "");
}

/** "200000" -> "200.000". String kosong tetap kosong. */
export function formatMoneyDigits(digits: string): string {
  if (digits === "") return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
