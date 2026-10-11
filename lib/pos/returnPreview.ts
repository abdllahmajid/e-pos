// ── TAMBAHAN (migration 037/039) ── Hitungan murni (tanpa React/Supabase) untuk
// layar Retur di TransactionDetailModal: perkiraan dana kembali SEBELUM retur
// diproses, dan ringkasan retur yang SUDAH terjadi.
//
// PENTING: angka final selalu dihitung server (RPC `return_transaction`).
// `estimateReturn` hanya meniru rumusnya untuk pratinjau, jadi bisa berbeda
// beberapa rupiah karena pembulatan — selalu tampilkan sebagai "perkiraan".
// Rumus server (migration 037): refund tiap baris =
//   round(subtotal_item / qty_item * qty_retur * (total_transaksi / subtotal_transaksi))
// dibatasi supaya total semua retur tidak melebihi total transaksi, lalu
// dibagi ke CASH / DIGITAL menurut komposisi pembayaran asli. Bagian yang dulu
// dibayar lewat piutang (TEMPO) TIDAK dicatat sebagai pembayaran negatif
// (lihat header migration 037) -> masuk `unrecorded`.

export interface PreviewItem {
  id: string;
  qty: number;
  subtotal: number;
}

export interface PreviewPayment {
  method: string;
  amount: number;
}

export interface ReturnEstimateInput {
  items: PreviewItem[];
  /** Qty yang diisi kasir per id item (yang 0/kosong diabaikan). */
  qtyById: Record<string, number>;
  saleSubtotal: number;
  saleTotal: number;
  /** Pembayaran transaksi ASLI (nilai positif). */
  payments: PreviewPayment[];
  /** Total refund dari retur-retur sebelumnya atas transaksi ini. */
  previouslyRefunded: number;
}

export interface ReturnEstimate {
  refundTotal: number;
  cash: number;
  digital: number;
  /** Bagian piutang (TEMPO) — tidak tercatat sebagai refund tunai/digital. */
  unrecorded: number;
}

export function estimateReturn(input: ReturnEstimateInput): ReturnEstimate {
  const factor =
    input.saleSubtotal > 0 ? input.saleTotal / input.saleSubtotal : 1;

  let refundTotal = 0;
  for (const item of input.items) {
    const qty = input.qtyById[item.id] ?? 0;
    if (!(qty > 0) || item.qty <= 0) continue;

    let line = Math.round((item.subtotal / item.qty) * qty * factor);
    const capLeft = Math.max(
      input.saleTotal - input.previouslyRefunded - refundTotal,
      0,
    );
    line = Math.min(line, capLeft);
    refundTotal += line;
  }

  const paid = (method: string) =>
    input.payments
      .filter((p) => p.method === method)
      .reduce((sum, p) => sum + p.amount, 0);
  const paidCash = paid("CASH");
  const paidDigital = paid("DIGITAL");
  const paidAll = input.payments.reduce((sum, p) => sum + p.amount, 0);

  if (paidAll > 0 && refundTotal > 0) {
    const cash = Math.round((refundTotal * paidCash) / paidAll);
    const digital = Math.round((refundTotal * paidDigital) / paidAll);
    return {
      refundTotal,
      cash,
      digital,
      unrecorded: refundTotal - cash - digital,
    };
  }

  return { refundTotal, cash: 0, digital: 0, unrecorded: refundTotal };
}

export interface ReturnRecordLike {
  /** Nilai refund baris retur (kolom `subtotal` baris RETURN, positif). */
  refundAmount: number;
  /** Pembayaran negatif baris retur (refund tunai/digital). */
  payments: PreviewPayment[];
}

export interface ReturnsSummary {
  refundTotal: number;
  cash: number;
  digital: number;
  /** Refund yang berasal dari bagian piutang dan tidak tercatat sebagai kas. */
  unrecorded: number;
}

/** Ringkasan semua retur yang SUDAH tercatat atas satu transaksi penjualan. */
export function summarizeReturns(returns: ReturnRecordLike[]): ReturnsSummary {
  let refundTotal = 0;
  let cash = 0;
  let digital = 0;

  for (const r of returns) {
    refundTotal += r.refundAmount;
    for (const p of r.payments) {
      const value = Math.abs(p.amount);
      if (p.method === "CASH") cash += value;
      else if (p.method === "DIGITAL") digital += value;
    }
  }

  return {
    refundTotal,
    cash,
    digital,
    unrecorded: Math.max(refundTotal - cash - digital, 0),
  };
}