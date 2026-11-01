// app/components/stok/stokPrint.ts
// ── TAMBAHAN (Fase 3 perbaikan Stok & Opname) ── Cetak lembar hitung opname:
// daftar produk dengan kolom kosong untuk menulis hasil hitung manual di rak,
// lalu hasilnya diketik ke layar hitung.
//
// Mekanisme: HTML dibangun sebagai string lalu dicetak lewat <iframe>
// tersembunyi — tidak butuh popup (tidak diblokir browser) dan tidak mengubah
// halaman aplikasi. Semua nilai di-escape sebelum masuk HTML.
//
// Secara bawaan stok sistem DISEMBUNYIKAN (hitung buta): penghitung yang tahu
// angka sistem cenderung menyamakan hasilnya.

import type { OpnameItem, OpnameSession } from "@/hooks/useOpname";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface CountSheetOptions {
  /** Cetak kolom Stok Sistem. Bawaan false (hitung buta). */
  showSystemQty: boolean;
  /** Hanya produk yang belum dihitung (berguna kalau opname dilanjutkan di hari lain). */
  onlyUncounted: boolean;
}

function buildCountSheetHtml(
  session: OpnameSession,
  items: OpnameItem[],
  options: CountSheetOptions,
): string {
  const rows = items.filter(
    (item) => !options.onlyUncounted || item.counted_qty === null,
  );

  const printedAt = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  const systemHeader = options.showSystemQty ? "<th class=\"num\">Stok Sistem</th>" : "";

  const body = rows
    .map((item, index) => {
      const code = [item.product_sku, item.product_barcode]
        .filter((part): part is string => !!part)
        .join(" · ");

      return `<tr>
        <td class="num">${index + 1}</td>
        <td><div class="name">${escapeHtml(item.product_name)}</div>${
          code ? `<div class="code">${escapeHtml(code)}</div>` : ""
        }</td>
        <td class="center">${escapeHtml(item.product_unit ?? "")}</td>
        ${options.showSystemQty ? `<td class="num">${item.system_qty}</td>` : ""}
        <td class="box"></td>
        <td class="note"></td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Lembar Hitung Opname #${session.number}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { font-size: 11px; color: #444; margin-bottom: 8px; }
  .fields { display: flex; gap: 24px; margin: 10px 0 12px; font-size: 11px; }
  .fields div { flex: 1; border-bottom: 1px solid #111; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #333; padding: 5px 6px; vertical-align: middle; }
  th { background: #eee; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; width: 56px; }
  .center { text-align: center; width: 52px; }
  .name { font-weight: 600; }
  .code { font-size: 9.5px; color: #555; margin-top: 1px; }
  .box { width: 92px; height: 28px; }
  .note { width: 150px; }
  .sign { display: flex; gap: 40px; margin-top: 28px; page-break-inside: avoid; }
  .sign div { flex: 1; text-align: center; font-size: 11px; }
  .sign span { display: block; border-top: 1px solid #111; margin-top: 44px; padding-top: 3px; }
  .foot { margin-top: 10px; font-size: 9.5px; color: #666; }
</style>
</head>
<body>
  <h1>Lembar Hitung Stok — Opname #${session.number}</h1>
  <div class="meta">
    ${escapeHtml(session.name)} · ${escapeHtml(session.category_name ?? "Semua produk berstok")} ·
    ${rows.length} produk${options.onlyUncounted ? " (belum dihitung)" : ""}
  </div>
  <div class="fields"><div>Pencacah:</div><div>Tanggal hitung:</div><div>Lokasi / rak:</div></div>
  <table>
    <thead>
      <tr>
        <th class="num">No</th>
        <th>Produk</th>
        <th class="center">Satuan</th>
        ${systemHeader}
        <th>Hitung Fisik</th>
        <th>Catatan</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <div class="sign">
    <div><span>Dihitung oleh</span></div>
    <div><span>Diperiksa oleh</span></div>
  </div>
  <div class="foot">Dicetak ${escapeHtml(printedAt)}. Isi hasil hitung di layar Sesi Opname setelah selesai menghitung.</div>
</body>
</html>`;
}

/**
 * Cetak lembar hitung lewat iframe tersembunyi. Mengembalikan false kalau tidak
 * ada produk yang perlu dicetak (mis. filter "belum dihitung" tapi semua sudah dihitung).
 */
export function printCountSheet(
  session: OpnameSession,
  items: OpnameItem[],
  options: CountSheetOptions,
): boolean {
  const hasRows = items.some(
    (item) => !options.onlyUncounted || item.counted_qty === null,
  );

  if (!hasRows) return false;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;
  const frameWindow = iframe.contentWindow;

  if (!frameDocument || !frameWindow) {
    iframe.remove();
    return false;
  }

  frameDocument.open();
  frameDocument.write(buildCountSheetHtml(session, items, options));
  frameDocument.close();

  // Beri waktu singkat agar layout selesai sebelum dialog cetak dibuka.
  window.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 250);

  // Bersihkan iframe setelah dialog cetak ditutup; batas waktu jaga-jaga untuk
  // browser yang tidak memicu `afterprint`.
  const cleanup = () => iframe.remove();
  frameWindow.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 5 * 60 * 1000);

  return true;
}
