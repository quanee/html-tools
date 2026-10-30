// Dedicated manual benchmark fixtures, deliberately excluded from the default test suite.
// Every page owns a valid independent RGB image stream; no padding or shared image tricks.
import { mkdirSync, openSync, closeSync, writeSync, statSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, degrees } from "pdf-lib";

const directory = join(import.meta.dir, "../.cache/pdf-check");
mkdirSync(directory, { recursive: true });
const small = await PDFDocument.create();
for (let i = 0; i < 7; i++) {
  const page = small.addPage([300 + i, 500 + i]);
  page.drawText(`PDF split page ${i + 1}`, { x: 20, y: 100 });
  page.setRotation(degrees((i % 4) * 90));
}
await Bun.write(join(directory, "sample.pdf"), await small.save());
await Bun.write(join(directory, "invalid.pdf"), "not a pdf");

for (const mb of [100, 300, 500]) {
  const filename = join(directory, `scan-${mb}mb.pdf`);
  if (Bun.argv.includes("--small")) break;
  const side = 576;
  const imageBytes = side * side * 3;
  const pages = Math.ceil((mb * 1_000_000) / imageBytes);
  const fd = openSync(filename, "w");
  const offsets = [0];
  let offset = 0;
  const write = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? Buffer.from(value, "binary") : value;
    let sent = 0;
    while (sent < bytes.length) sent += writeSync(fd, bytes, sent, bytes.length - sent);
    offset += bytes.length;
  };
  const object = (id: number, body: string) => {
    offsets[id] = offset;
    write(`${id} 0 obj\n${body}\nendobj\n`);
  };
  write("%PDF-1.7\n%\x80\x81\x82\x83\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 3} 0 R`).join(" ")}] >>`,
  );
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let page = 0; page < pages; page++) {
    const id = 4 + page * 3;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${600 + page} 800] /Resources << /Font << /F1 3 0 R >> /XObject << /Image ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    const pixels = new Uint8Array(imageBytes);
    let random = page + 12345;
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        const shade = x > 30 && x < 545 && y % 24 < 3 ? 45 : 210 + ((random >>> 24) % 45);
        const at = (y * side + x) * 3;
        pixels[at] = shade;
        pixels[at + 1] = shade;
        pixels[at + 2] = Math.max(0, shade - (page % 9));
      }
    offsets[id + 1] = offset;
    write(
      `${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`,
    );
    write(pixels);
    write("\nendstream\nendobj\n");
    const content = `q 550 0 0 650 20 50 cm /Image Do Q\nBT /F1 20 Tf 20 750 Td (Independent scanned image - page ${page + 1}) Tj ET`;
    object(id + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  const xref = offset;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < offsets.length; id++)
    write(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  closeSync(fd);
  console.log(JSON.stringify({ filename, bytes: statSync(filename).size, pages, imageBytes }));
}
