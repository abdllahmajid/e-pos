// ── KOREKSI ── Digeneralisasi supaya bisa dipakai untuk 2 skenario:
// 1. Cetak struk langsung setelah bayar di layar Kasir (data dari keranjang).
// 2. Cetak ULANG struk dari Riwayat Transaksi (data dari getTransactionDetail()).
// Sebelumnya fungsi ini hardcode "Admin Store" sebagai nama kasir dan selalu
// pakai new Date() sebagai waktu transaksi (salah kalau dipakai untuk cetak ulang
// transaksi lama). Sekarang semua field itu wajib dikirim oleh pemanggil.
// Tetap ikuti aturan PRD §16.5: dokumen HTML di iframe tersembunyi, TANPA
// @media print / print:* di komponen React utama atau globals.css.

export interface ReceiptItem {
  name: string;
  qty: number;
  /** Harga satuan sebelum diskon item. */
  price: number;
  /** Subtotal baris (qty x price - diskon item). Kalau tidak dikirim, dihitung dari qty x price. */
  subtotal?: number;
}

export interface ReceiptData {
  /** Nomor struk asli, mis. LCO-STR/26/09/000001. Wajib — sebelumnya tidak pernah ditampilkan. */
  receiptNo: string;
  /** ISO datetime transaksi. Kalau tidak dikirim (transaksi baru), pakai waktu sekarang. */
  createdAt?: string;
  cashierName?: string | null;
  customerName?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  method: string;
  paidAmount: number;
  changeAmount: number;
  /** Tampilkan label "STRUK CETAK ULANG" di header (dipakai dari Riwayat Transaksi). */
  isReprint?: boolean;
}

const METHOD_LABELS: Record<string, string> = {
  tunai: "Tunai",
  CASH: "Tunai",
  transfer: "Transfer Bank",
  BANK_TRANSFER: "Transfer Bank",
  QRIS: "QRIS",
  TEMPO: "Tempo / Piutang",
};

function formatMethod(method: string): string {
  return METHOD_LABELS[method] ?? method.toUpperCase();
}

function formatMoney(amount: number): string {
  return Math.round(amount).toLocaleString("id-ID");
}

function escapeHtml(value: string): string {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const printThermalReceipt = (data: ReceiptData) => {
  // 1. Buat elemen iframe tersembunyi
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  // 2. Format tanggal — pakai waktu transaksi asli kalau ada (penting untuk cetak ulang),
  // fallback ke waktu sekarang untuk transaksi yang baru saja dibayar.
  const dateStr = new Date(data.createdAt ?? Date.now()).toLocaleString(
    "id-ID",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  const discount = data.discount ?? 0;
  const tax = data.tax ?? 0;

  // 3. Template HTML murni (tanpa Tailwind) khusus untuk printer thermal 58mm
  // Menggunakan font monospace bawaan sistem agar rapi
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Struk ${escapeHtml(data.receiptNo)}</title>
        <style>
          body {
            font-family: "Courier New", Courier, monospace;
            font-size: 12px;
            color: #000;
            width: 58mm; /* Ukuran thermal standar */
            margin: 0;
            padding: 0;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .font-bold { font-weight: bold; }
          .divider { border-bottom: 1px dashed #000; margin: 5px 0; }
          table { width: 100%; border-collapse: collapse; }
          td { vertical-align: top; padding: 2px 0; }
          .item-name { display: block; margin-bottom: 2px; }
          .reprint-badge {
            text-align: center;
            font-weight: bold;
            border: 1px dashed #000;
            padding: 2px 0;
            margin-bottom: 6px;
          }
        </style>
      </head>
      <body>
        ${data.isReprint ? `<div class="reprint-badge">*** CETAK ULANG ***</div>` : ""}
        <div class="text-center font-bold" style="font-size: 16px;">Langitan.co</div>
        <div class="text-center">Store &amp; Merchandise</div>
        <div class="divider"></div>

        <table>
          <tr><td>No. Struk</td><td class="text-right">${escapeHtml(data.receiptNo)}</td></tr>
          <tr><td>Waktu</td><td class="text-right">${dateStr}</td></tr>
          <tr><td>Kasir</td><td class="text-right">${escapeHtml(data.cashierName ?? "-")}</td></tr>
          ${data.customerName ? `<tr><td>Pelanggan</td><td class="text-right">${escapeHtml(data.customerName)}</td></tr>` : ""}
          <tr><td>Metode</td><td class="text-right">${escapeHtml(formatMethod(data.method))}</td></tr>
        </table>

        <div class="divider"></div>

        <table>
          ${data.items
            .map(
              (item) => `
            <tr>
              <td colspan="3"><span class="item-name">${escapeHtml(item.name)}</span></td>
            </tr>
            <tr>
              <td>${item.qty}x</td>
              <td>${formatMoney(item.price)}</td>
              <td class="text-right">${formatMoney(item.subtotal ?? item.qty * item.price)}</td>
            </tr>
          `,
            )
            .join("")}
        </table>

        <div class="divider"></div>

        <table>
          <tr>
            <td>Subtotal</td>
            <td class="text-right">${formatMoney(data.subtotal)}</td>
          </tr>
          ${
            discount > 0
              ? `<tr><td>Diskon</td><td class="text-right">-${formatMoney(discount)}</td></tr>`
              : ""
          }
          ${
            tax > 0
              ? `<tr><td>Pajak</td><td class="text-right">${formatMoney(tax)}</td></tr>`
              : ""
          }
          <tr>
            <td class="font-bold">Total</td>
            <td class="text-right font-bold">${formatMoney(data.total)}</td>
          </tr>
          <tr>
            <td>Bayar</td>
            <td class="text-right">${formatMoney(data.paidAmount)}</td>
          </tr>
          <tr>
            <td>Kembali</td>
            <td class="text-right">${formatMoney(data.changeAmount)}</td>
          </tr>
        </table>

        <div class="divider"></div>
        <div class="text-center">Terima kasih atas kunjungan Anda</div>
        <div class="text-center">lco-store.com</div>
      </body>
    </html>
  `;

  // 4. Tulis ke iframe dan cetak
  iframeDoc.open();
  iframeDoc.write(htmlContent);
  iframeDoc.close();

  // Tunggu sebentar agar browser selesai merender HTML, lalu cetak
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // Hapus iframe setelah selesai agar tidak menumpuk di DOM
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  }, 250);
};

// ── TAMBAHAN (T-03) ── Fungsi cetak nota A6/A5 untuk dokumen yang lebih awet.
// Menggunakan iframe tersembunyi yang sama dengan CSS layout berbeda.
export const printA6Nota = (data: ReceiptData, paperSize: "A6" | "A5" = "A6") => {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  const dateStr = new Date(data.createdAt ?? Date.now()).toLocaleString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  const discount = data.discount ?? 0;
  const tax = data.tax ?? 0;

  // Setelan CSS sesuai ukuran kertas
  const widthStr = paperSize === "A5" ? "148mm" : "105mm";
  const heightStr = paperSize === "A5" ? "210mm" : "148mm";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Nota ${escapeHtml(data.receiptNo)}</title>
        <style>
          @page { size: ${paperSize}; margin: 5mm; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: ${paperSize === "A5" ? "12px" : "10px"};
            color: #000;
            width: ${widthStr};
            min-height: ${heightStr};
            margin: 0;
            padding: 10px;
            box-sizing: border-box;
          }
          .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .header h1 { margin: 0; font-size: ${paperSize === "A5" ? "24px" : "18px"}; font-weight: bold; letter-spacing: 1px; }
          .header p { margin: 3px 0 0 0; color: #333; }
          
          .info-table { width: 100%; margin-bottom: 15px; }
          .info-table td { padding: 2px 5px 2px 0; vertical-align: top; }
          .info-label { width: 80px; font-weight: bold; }
          
          .item-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
          .item-table th { background: #f0f0f0; border: 1px solid #000; padding: 6px; text-align: left; }
          .item-table th.text-right { text-align: right; }
          .item-table td { border: 1px solid #ccc; padding: 6px; }
          .item-table td.text-right { text-align: right; }
          .item-table td.text-center { text-align: center; }
          
          .summary-table { width: 100%; max-width: 250px; margin-left: auto; border-collapse: collapse; }
          .summary-table td { padding: 4px; }
          .summary-table td.text-right { text-align: right; }
          .summary-table .font-bold { font-weight: bold; }
          .summary-table .total-row td { border-top: 1px solid #000; border-bottom: 1px solid #000; font-size: 14px; }
          
          .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #555; border-top: 1px solid #ccc; padding-top: 10px; }
          .reprint-badge { text-align: center; font-weight: bold; background: #eee; padding: 4px; border-radius: 4px; margin-bottom: 10px; letter-spacing: 2px;}
        </style>
      </head>
      <body>
        ${data.isReprint ? `<div class="reprint-badge">SALINAN / CETAK ULANG</div>` : ""}
        
        <div class="header">
          <h1>LANGITAN.CO</h1>
          <p>Store &amp; Merchandise</p>
        </div>

        <table class="info-table">
          <tr>
            <td class="info-label">No. Nota</td><td>: ${escapeHtml(data.receiptNo)}</td>
            <td class="info-label">Kasir</td><td>: ${escapeHtml(data.cashierName ?? "-")}</td>
          </tr>
          <tr>
            <td class="info-label">Tanggal</td><td>: ${dateStr}</td>
            <td class="info-label">Metode</td><td>: ${escapeHtml(formatMethod(data.method))}</td>
          </tr>
          ${data.customerName ? `
          <tr>
            <td class="info-label">Pelanggan</td><td colspan="3">: ${escapeHtml(data.customerName)}</td>
          </tr>` : ""}
        </table>

        <table class="item-table">
          <thead>
            <tr>
              <th>Produk / Item</th>
              <th class="text-center" style="width: 50px;">Qty</th>
              <th class="text-right" style="width: 80px;">Harga</th>
              <th class="text-right" style="width: 90px;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map(item => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td class="text-center">${item.qty}</td>
                <td class="text-right">${formatMoney(item.price)}</td>
                <td class="text-right">${formatMoney(item.subtotal ?? item.qty * item.price)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <table class="summary-table">
          <tr>
            <td>Subtotal</td>
            <td class="text-right">${formatMoney(data.subtotal)}</td>
          </tr>
          ${discount > 0 ? `<tr><td>Diskon</td><td class="text-right">-${formatMoney(discount)}</td></tr>` : ""}
          ${tax > 0 ? `<tr><td>Pajak</td><td class="text-right">${formatMoney(tax)}</td></tr>` : ""}
          <tr class="total-row">
            <td class="font-bold">Total Tagihan</td>
            <td class="text-right font-bold">${formatMoney(data.total)}</td>
          </tr>
          <tr>
            <td>Bayar</td>
            <td class="text-right">${formatMoney(data.paidAmount)}</td>
          </tr>
          <tr>
            <td>Kembalian</td>
            <td class="text-right">${formatMoney(data.changeAmount)}</td>
          </tr>
        </table>

        <div class="footer">
          <p>Terima kasih atas kunjungan Anda. Barang yang sudah dibeli tidak dapat ditukar/dikembalikan kecuali ada perjanjian.<br/><strong>lco-store.com</strong></p>
        </div>
      </body>
    </html>
  `;

  iframeDoc.open();
  iframeDoc.write(htmlContent);
  iframeDoc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  }, 250);
};