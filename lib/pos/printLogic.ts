export const printThermalReceipt = (data: any) => {
  // 1. Buat elemen iframe tersembunyi
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) return;

  // 2. Format tanggal
  const dateStr = new Date().toLocaleString("id-ID", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  // 3. Template HTML murni (tanpa Tailwind) khusus untuk printer thermal 58mm
  // Menggunakan font monospace bawaan sistem agar rapi
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Struk LCO POS</title>
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
        </style>
      </head>
      <body>
        <div class="text-center font-bold" style="font-size: 16px;">Langitan.co</div>
        <div class="text-center">Store & Merchandise</div>
        <div class="divider"></div>
        
        <table>
          <tr><td>Waktu</td><td class="text-right">${dateStr}</td></tr>
          <tr><td>Kasir</td><td class="text-right">Admin Store</td></tr>
          <tr><td>Metode</td><td class="text-right">${data.method.toUpperCase()}</td></tr>
        </table>
        
        <div class="divider"></div>
        
        <table>
          ${data.items.map((item: any) => `
            <tr>
              <td colspan="3"><span class="item-name">${item.name}</span></td>
            </tr>
            <tr>
              <td>${item.qty}x</td>
              <td>${item.price.toLocaleString("id-ID")}</td>
              <td class="text-right">${(item.qty * item.price).toLocaleString("id-ID")}</td>
            </tr>
          `).join("")}
        </table>
        
        <div class="divider"></div>
        
        <table>
          <tr>
            <td>Total</td>
            <td class="text-right font-bold">${data.total.toLocaleString("id-ID")}</td>
          </tr>
          <tr>
            <td>Bayar</td>
            <td class="text-right">${data.paidAmount.toLocaleString("id-ID")}</td>
          </tr>
          <tr>
            <td>Kembali</td>
            <td class="text-right">${data.changeAmount.toLocaleString("id-ID")}</td>
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