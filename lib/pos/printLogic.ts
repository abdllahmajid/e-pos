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
  // ── TAMBAHAN ── Sebelum ini, nama toko & footer di-hardcode ("Langitan.co",
  // "Terima kasih atas kunjungan Anda", dst) di 3 tempat berbeda di file ini,
  // jadi Pengaturan > Toko (hooks/useSettings.ts: namaToko/alamat/telepon/
  // footerStruk) TIDAK PERNAH terlihat efeknya di struk/nota/gambar WA. Field
  // di bawah ini yang menggantikannya — semua opsional (`?`) dengan fallback
  // di setiap fungsi cetak, supaya pemanggil lama yang belum dioper (kalau
  // ada) tidak pernah gagal, hanya menampilkan default lama.
  /** Dari `settings.namaToko`. Kosong/undefined -> fallback "Langitan.co". */
  storeName?: string;
  /** Dari `settings.alamat`. Kosong/undefined -> baris alamat tidak dicetak. */
  storeAddress?: string;
  /** Dari `settings.telepon`. Kosong/undefined -> baris telepon tidak dicetak. */
  storePhone?: string;
  /** Dari `settings.footerStruk`. Kosong/undefined -> fallback "Terima kasih atas kunjungan Anda". */
  footerText?: string;
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
        <div class="text-center font-bold" style="font-size: 16px;">${escapeHtml(data.storeName || "Langitan.co")}</div>
        ${data.storeAddress ? `<div class="text-center">${escapeHtml(data.storeAddress)}</div>` : ""}
        ${data.storePhone ? `<div class="text-center">${escapeHtml(data.storePhone)}</div>` : ""}
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
        <div class="text-center">${escapeHtml(data.footerText || "Terima kasih atas kunjungan Anda")}</div>
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
          <h1>${escapeHtml((data.storeName || "Langitan.co").toUpperCase())}</h1>
          ${data.storeAddress ? `<p>${escapeHtml(data.storeAddress)}</p>` : ""}
          ${data.storePhone ? `<p>${escapeHtml(data.storePhone)}</p>` : ""}
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
          <p>${escapeHtml(data.footerText || "Terima kasih atas kunjungan Anda")}</p>
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

// ── TAMBAHAN (T-08 lanjutan) ── generateReceiptImage() + share ke WhatsApp.
// PRD §4.7: "Versi digital: PDF + kirim gambar struk/nota via WhatsApp (pola
// ShareTicket/wa-messages)" dan "Kirim struk digital: gambar struk (JPEG via
// html-to-image) → share ke WhatsApp pelanggan."
//
// BEDA dari printThermalReceipt/printA6Nota di atas: dua fungsi itu menulis
// dokumen HTML ke iframe tersembunyi lalu memanggil window.print() — hasil
// akhirnya kertas fisik, BUKAN file. Fungsi di bawah ini sebaliknya merender
// template HTML yang mirip (proporsi beda — lebar tetap untuk dibaca di layar
// HP, bukan lebar kertas 58mm/A6) ke sebuah <div> yang ditempel SEMENTARA ke
// `document.body` di posisi off-screen (`position: fixed; left: -9999px`,
// BUKAN `display: none` — sama seperti dicatat di reportExport.ts,
// `html-to-image` tidak bisa merender elemen yang tidak punya ukuran layout),
// lalu di-snapshot ke JPEG lewat `html-to-image` (`toJpeg`), dan elemen itu
// dibuang lagi begitu snapshot selesai — kasir tidak pernah melihatnya.
//
// `html-to-image` di-import dinamis (`await import(...)`) di dalam fungsi,
// bukan di top-level file ini seperti di reportExport.ts — supaya
// printThermalReceipt()/printA6Nota() (dipanggil jauh lebih sering, tiap
// transaksi) tidak ikut menarik bundel `html-to-image` kalau fitur share WA
// ini ternyata tidak dipakai di sesi kasir tertentu.

/**
 * Render `data` jadi 1 gambar JPEG (Blob) — struk digital siap dibagikan.
 * Lebar elemen sumber sengaja tetap 380px (bukan mengikuti lebar layar kasir)
 * supaya hasil JPEG konsisten dibaca di WhatsApp berapa pun device kasirnya;
 * WhatsApp sendiri yang menyesuaikan ukuran preview di jendela chat.
 */
export async function generateReceiptImage(data: ReceiptData): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("generateReceiptImage() hanya bisa dipanggil di browser.");
  }

  const { toJpeg } = await import("html-to-image");

  const container = buildShareReceiptElement(data);
  document.body.appendChild(container);

  try {
    // Beri browser 2 frame untuk selesai layout sebelum di-snapshot — pola
    // senada dengan delay sebelum window.print() di dua fungsi cetak di atas,
    // supaya elemen yang baru saja ditempel ke DOM (termasuk font) sudah
    // pasti selesai di-render saat `toJpeg()` membaca ukurannya.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const dataUrl = await toJpeg(container, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      quality: 0.92,
      cacheBust: true,
    });

    const response = await fetch(dataUrl);
    return await response.blob();
  } finally {
    document.body.removeChild(container);
  }
}

/** Bangun elemen off-screen untuk di-snapshot `generateReceiptImage()`. */
function buildShareReceiptElement(data: ReceiptData): HTMLDivElement {
  const dateStr = new Date(data.createdAt ?? Date.now()).toLocaleString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const discount = data.discount ?? 0;
  const tax = data.tax ?? 0;

  const itemsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td colspan="3" style="padding-top:6px;font-weight:600;">${escapeHtml(item.name)}</td>
      </tr>
      <tr>
        <td style="padding:0 0 6px;color:#52525b;">${item.qty} x ${formatMoney(item.price)}</td>
        <td></td>
        <td style="padding:0 0 6px;text-align:right;">${formatMoney(item.subtotal ?? item.qty * item.price)}</td>
      </tr>`,
    )
    .join("");

  const container = document.createElement("div");
  // Off-screen, BUKAN display:none — lihat catatan di atas fungsi ini.
  container.style.cssText =
    "position:fixed;top:0;left:-9999px;width:380px;background:#ffffff;";
  container.innerHTML = `
    <div style="width:380px;padding:24px;font-family:'Courier New',Courier,monospace;color:#18181b;box-sizing:border-box;">
      ${
        data.isReprint
          ? `<div style="text-align:center;font-weight:bold;border:1px dashed #18181b;padding:4px 0;margin-bottom:10px;">*** CETAK ULANG ***</div>`
          : ""
      }
      <div style="text-align:center;font-weight:bold;font-size:20px;letter-spacing:0.5px;">${escapeHtml((data.storeName || "Langitan.co").toUpperCase())}</div>
      ${data.storeAddress ? `<div style="text-align:center;font-size:12px;color:#52525b;">${escapeHtml(data.storeAddress)}</div>` : ""}
      ${data.storePhone ? `<div style="text-align:center;font-size:12px;color:#52525b;margin-bottom:14px;">${escapeHtml(data.storePhone)}</div>` : ""}
      <div style="border-top:1px dashed #a1a1aa;margin:10px 0;"></div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <tr><td style="padding:2px 0;">No. Struk</td><td style="text-align:right;">${escapeHtml(data.receiptNo)}</td></tr>
        <tr><td style="padding:2px 0;">Waktu</td><td style="text-align:right;">${dateStr}</td></tr>
        <tr><td style="padding:2px 0;">Kasir</td><td style="text-align:right;">${escapeHtml(data.cashierName ?? "-")}</td></tr>
        ${
          data.customerName
            ? `<tr><td style="padding:2px 0;">Pelanggan</td><td style="text-align:right;">${escapeHtml(data.customerName)}</td></tr>`
            : ""
        }
        <tr><td style="padding:2px 0;">Metode</td><td style="text-align:right;">${escapeHtml(formatMethod(data.method))}</td></tr>
      </table>
      <div style="border-top:1px dashed #a1a1aa;margin:10px 0;"></div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">${itemsHtml}</table>
      <div style="border-top:1px dashed #a1a1aa;margin:10px 0;"></div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <tr><td style="padding:2px 0;">Subtotal</td><td style="text-align:right;">${formatMoney(data.subtotal)}</td></tr>
        ${discount > 0 ? `<tr><td style="padding:2px 0;">Diskon</td><td style="text-align:right;">-${formatMoney(discount)}</td></tr>` : ""}
        ${tax > 0 ? `<tr><td style="padding:2px 0;">Pajak</td><td style="text-align:right;">${formatMoney(tax)}</td></tr>` : ""}
        <tr><td style="padding:6px 0 2px;font-weight:bold;">Total</td><td style="padding:6px 0 2px;text-align:right;font-weight:bold;">${formatMoney(data.total)}</td></tr>
        <tr><td style="padding:2px 0;">Bayar</td><td style="text-align:right;">${formatMoney(data.paidAmount)}</td></tr>
        <tr><td style="padding:2px 0;">Kembali</td><td style="text-align:right;">${formatMoney(data.changeAmount)}</td></tr>
      </table>
      <div style="border-top:1px dashed #a1a1aa;margin:10px 0;"></div>
      <div style="text-align:center;font-size:12px;color:#52525b;">${escapeHtml(data.footerText || "Terima kasih atas kunjungan Anda")}</div>
    </div>
  `;

  return container;
}

/** Hasil `shareReceiptViaWhatsApp()` — dipakai UI pemanggil untuk pesan status. */
export interface ShareReceiptResult {
  /**
   * "web-share" = berhasil lewat Web Share API (`navigator.share`) dengan
   * file gambar terlampir langsung — pengguna tinggal pilih WhatsApp di
   * sheet share bawaan OS/browser. Umumnya tersedia di HP (Android/iOS
   * Chrome/Safari), termasuk device kasir kalau pakai tablet/HP.
   *
   * "download-fallback" = Web Share API dengan file TIDAK tersedia (paling
   * umum: browser desktop). Gambar diunduh otomatis ke device, lalu tab
   * WhatsApp Web/`wa.me` dibuka dengan teks siap-kirim — kasir WAJIB
   * melampirkan file yang baru terunduh secara manual. Ini keterbatasan
   * `wa.me` sendiri (URL scheme resminya cuma menerima parameter teks,
   * tidak ada parameter attachment file) — bukan bug di fungsi ini.
   */
  method: "web-share" | "download-fallback";
}

/**
 * Ubah nomor HP Indonesia ke format yang diterima `wa.me` (`62xxxxxxxxxx`,
 * tanpa `+`/spasi/strip). "0812..." → "62812...", "+62812..."/"62812..." →
 * dipakai apa adanya (setelah dibuang karakter non-digit).
 */
function sanitizeIndonesianWaNumber(rawPhone: string): string {
  const digitsOnly = rawPhone.replace(/\D/g, "");
  if (digitsOnly.startsWith("62")) return digitsOnly;
  if (digitsOnly.startsWith("0")) return `62${digitsOnly.slice(1)}`;
  return digitsOnly;
}

/**
 * Alur lengkap "kirim struk digital ke WhatsApp pelanggan" (PRD §4.7): buat
 * gambar struk lewat `generateReceiptImage()`, lalu coba Web Share API dulu
 * (device mendukung lampiran file langsung ke WhatsApp), kalau tidak bisa
 * fallback unduh gambar + buka `wa.me` dengan pesan siap-kirim.
 *
 * `customerPhone` opsional — kalau kosong (pelanggan tidak isi no. HP saat
 * transaksi), fallback tetap jalan tapi `wa.me` dibuka TANPA nomor tujuan
 * (`https://wa.me/`), yang membuka WhatsApp ke layar pilih kontak manual,
 * bukan gagal total.
 */
export async function shareReceiptViaWhatsApp(
  data: ReceiptData,
  customerPhone?: string | null,
): Promise<ShareReceiptResult> {
  const blob = await generateReceiptImage(data);
  const safeReceiptNo = data.receiptNo.replace(/[\\/:*?"<>|]/g, "-");
  const fileName = `Struk-${safeReceiptNo}.jpg`;
  const file = new File([blob], fileName, { type: "image/jpeg" });
  // ── TAMBAHAN ── Sebelumnya "Langitan.co" tetap di sini juga, terpisah dari
  // 3 tempat lain di file ini yang sudah diperbaiki — caption pesan WA ini
  // tidak ikut ke gambar struk (`generateReceiptImage`), jadi harus dibetulkan
  // sendiri di sini.
  const caption = `Struk pembelian ${data.storeName || "Langitan.co"} No. ${data.receiptNo}. ${data.footerText || "Terima kasih atas kunjungan Anda"}!`;

  // `canShare`/`share` dengan dukungan `files` belum ada di semua lib.dom.d.ts
  // versi TS lama — dicek via optional chaining + type guard tipis di sini,
  // bukan lewat `@ts-expect-error`, supaya tetap type-safe kalau TS/lib.dom
  // proyek ini nanti di-upgrade dan sudah menyertakan tipenya sendiri.
  const nav = navigator as Navigator & {
    canShare?: (shareData?: { files?: File[] }) => boolean;
    share?: (shareData: { files?: File[]; text?: string; title?: string }) => Promise<void>;
  };

  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    await nav.share({ files: [file], text: caption, title: `Struk ${data.receiptNo}` });
    return { method: "web-share" };
  }

  // Fallback: unduh JPEG dulu lewat <a download> sementara (pola sama seperti
  // XLSX.writeFile/jsPDF.save di reportExport.ts, tapi manual karena sumbernya
  // Blob polos, bukan library yang sudah punya method .save()/.writeFile()).
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke ditunda, bukan langsung — beberapa browser masih memproses
  // download dari blob URL walau elemen <a>-nya sudah dibuang dari DOM.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

  const phoneDigits = customerPhone ? sanitizeIndonesianWaNumber(customerPhone) : "";
  const waBase = phoneDigits ? `https://wa.me/${phoneDigits}` : "https://wa.me/";
  const waCaption = `${caption} (gambar struk sudah terunduh ke perangkat ini, mohon dilampirkan manual)`;
  window.open(`${waBase}?text=${encodeURIComponent(waCaption)}`, "_blank", "noopener,noreferrer");

  return { method: "download-fallback" };
}