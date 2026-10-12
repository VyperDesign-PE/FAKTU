import type { BusinessRecord } from "../tenants/tenantRepository.js";
import type { ReceiptRecord } from "../receipts/receiptRepository.js";

function latin1(value: string) {
  return value.replace(/[^\x20-\xFF]/g, "?");
}

function pdfText(value: string) {
  return latin1(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(value: number) {
  return `S/ ${value.toFixed(2)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function wrap(value: string, max = 78) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export type PdfLine = { text: string; size?: number; bold?: boolean; gap?: number };

function receiptLines(receipt: ReceiptRecord, business: BusinessRecord) {
  const lines: PdfLine[] = [];
  const businessName = business.tradeName ?? business.businessName ?? "Mi negocio";
  lines.push({ text: businessName, size: 15, bold: true, gap: 18 });
  if (business.businessName && business.businessName !== businessName) lines.push({ text: business.businessName, size: 9 });
  if (business.ruc) lines.push({ text: `RUC: ${business.ruc}`, size: 9 });
  if (business.address) wrap(business.address).forEach((text) => lines.push({ text, size: 8 }));
  lines.push({ text: "", gap: 8 });
  lines.push({ text: `${{ NOTA_CREDITO: "NOTA DE CREDITO", NOTA_DEBITO: "NOTA DE DEBITO", BOLETA: "BOLETA DE VENTA", FACTURA: "FACTURA" }[receipt.documentType]} ELECTRONICA`, size: 14, bold: true, gap: 16 });
  lines.push({ text: receipt.officialNumber ?? `${receipt.series}-${String(receipt.correlative).padStart(8, "0")}`, size: 13, bold: true, gap: 16 });
  lines.push({ text: `Fecha de emision: ${formatDate(receipt.issueDate)}`, size: 9 });
  lines.push({ text: `Moneda: PEN`, size: 9 });
  lines.push({ text: "", gap: 8 });

  if (receipt.customer?.documentNumber || receipt.customer?.name) {
    lines.push({ text: "CLIENTE", size: 10, bold: true, gap: 13 });
    if (receipt.customer?.documentNumber) lines.push({ text: `${receipt.customer.documentType ?? "Documento"}: ${receipt.customer.documentNumber}`, size: 9 });
    if (receipt.customer?.name) wrap(receipt.customer.name).forEach((text) => lines.push({ text, size: 9 }));
    if (receipt.customer?.address) wrap(receipt.customer.address).forEach((text) => lines.push({ text, size: 8 }));
  } else {
    lines.push({ text: "Cliente: Publico general", size: 9 });
  }
  lines.push({ text: "", gap: 8 });
  lines.push({ text: "DETALLE", size: 10, bold: true, gap: 13 });

  for (const item of receipt.items ?? []) {
    wrap(`${item.name} x ${item.quantity}`, 56).forEach((text, index) => {
      lines.push({ text: index === 0 ? `${text}   ${money(item.quantity * item.unitPrice)}` : text, size: 8 });
    });
  }

  lines.push({ text: "", gap: 8 });
  lines.push({ text: `Subtotal: ${money(receipt.subtotal)}`, size: 10 });
  lines.push({ text: `IGV (18%): ${money(receipt.igv)}`, size: 10 });
  lines.push({ text: `TOTAL: ${money(receipt.total)}`, size: 13, bold: true, gap: 16 });
  lines.push({ text: "", gap: 8 });
  lines.push({ text: "Representacion impresa del comprobante electronico.", size: 8 });
  if (receipt.providerCode === "mock") lines.push({ text: "ENTORNO DE PRUEBA - NO TIENE VALIDEZ TRIBUTARIA.", size: 8, bold: true });
  return lines;
}

export function wrapText(value: string, max = 78) {
  return wrap(value, max);
}

function buildContent(lines: PdfLine[]) {
  let y = 800;
  const commands: string[] = ["BT"];
  for (const line of lines) {
    const size = line.size ?? 9;
    commands.push(`/${line.bold ? "F2" : "F1"} ${size} Tf`);
    commands.push(`1 0 0 1 46 ${y} Tm`);
    commands.push(`(${pdfText(line.text)}) Tj`);
    y -= line.gap ?? Math.max(11, size + 3);
    if (y < 42) break;
  }
  commands.push("ET");
  return Buffer.from(commands.join("\n"), "latin1");
}

export function renderReceiptPdf(receipt: ReceiptRecord, business: BusinessRecord) {
  return renderLinesPdf(receiptLines(receipt, business));
}

/** PDF de una página (A4) a partir de líneas de texto. */
export function renderLinesPdf(lines: PdfLine[]) {
  const content = buildContent(lines);
  const objects: Buffer[] = [];
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii");
  objects[2] = Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii");
  objects[3] = Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>", "ascii");
  objects[4] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii");
  objects[5] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "ascii");
  objects[6] = Buffer.concat([
    Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"),
    content,
    Buffer.from("\nendstream", "ascii")
  ]);

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [0];
  let cursor = parts[0].length;

  for (let index = 1; index <= 6; index += 1) {
    offsets[index] = cursor;
    const object = Buffer.concat([
      Buffer.from(`${index} 0 obj\n`, "ascii"),
      objects[index],
      Buffer.from("\nendobj\n", "ascii")
    ]);
    parts.push(object);
    cursor += object.length;
  }

  const xrefOffset = cursor;
  const xref = ["xref", "0 7", "0000000000 65535 f "];
  for (let index = 1; index <= 6; index += 1) {
    xref.push(`${String(offsets[index]).padStart(10, "0")} 00000 n `);
  }
  parts.push(Buffer.from(`${xref.join("\n")}\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "ascii"));
  return Buffer.concat(parts);
}
