import { describe, expect, test } from "bun:test";
import { degrees, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { unzipSync } from "fflate";
import { archiveBudget, createArchive } from "../src/tools/pdf/archive";
import {
  parseCount,
  parseMegabytes,
  partName,
  planRanges,
  safeStem,
} from "../src/tools/pdf/options";
import { loadPdf, serializeRange, splitPdf } from "../src/tools/pdf/split";

async function fixture(count = 7) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage([300 + i, 500 + i]);
    page.setRotation(degrees((i % 4) * 90));
    page.drawText(`Page ${i + 1}`);
  }
  return pdf;
}

describe("PDF options", () => {
  test("ranges preserve order, overlap and Chinese commas", () => {
    expect(planRanges({ mode: "ranges", ranges: " 4-6， 1 - 3,3, 7 " }, 7)).toEqual([
      { start: 4, end: 6 },
      { start: 1, end: 3 },
      { start: 3, end: 3 },
      { start: 7, end: 7 },
    ]);
  });
  test.each([
    "",
    ",",
    "1,",
    "1,,2",
    "0",
    "2-1",
    "8",
    "1.2",
    "-1",
    "1-8",
    "1e0",
    "1;2",
    "9007199254740993",
  ])("reject range %s", (ranges) => {
    expect(() => planRanges({ mode: "ranges", ranges }, 7)).toThrow();
  });
  test.each(["0", "-1", "1.5", "1e1", "", "Infinity", "9007199254740992"])(
    "reject count %s",
    (value) => expect(() => parseCount(value)).toThrow(),
  );
  test.each(["0", "-1", ".5", "1.234", "1e1", "", "Infinity", "999999999999999999"])(
    "reject MB %s",
    (value) => expect(() => parseMegabytes(value)).toThrow(),
  );
  test("decimal MB and group remainders", () => {
    expect(parseMegabytes(" 10.01 ")).toBe(10_010_000);
    expect(parseMegabytes("0.01")).toBe(10_000);
    expect(planRanges({ mode: "count", count: 3 }, 7)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
      { start: 7, end: 7 },
    ]);
    expect(planRanges({ mode: "count", count: 10 }, 7)).toEqual([{ start: 1, end: 7 }]);
    expect(planRanges({ mode: "count", count: 2 }, 4)).toHaveLength(2);
    expect(planRanges({ mode: "pages" }, 1)).toEqual([{ start: 1, end: 1 }]);
  });
  test("safe Chinese names and unique repeat names", () => {
    expect(safeStem("../报告:测试?.PDF")).toBe(".._报告_测试_");
    expect(safeStem(".pdf")).toBe("document");
    expect(partName("报告", 1, { start: 1, end: 10 })).toBe("报告_part-001_pages-0001-0010.pdf");
    expect(partName("报告", 2, { start: 1, end: 1 })).toBe("报告_part-002_pages-0001.pdf");
  });
});

describe("PDF output", () => {
  test("shared image bytes survive copying and size probes use serialized sharing", async () => {
    const source = await PDFDocument.create();
    const pixels = Uint8Array.from({ length: 30_000 }, (_, i) => i % 251);
    const image = source.context.register(
      source.context.stream(pixels, {
        Type: "XObject",
        Subtype: "Image",
        Width: 100,
        Height: 100,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
      }),
    );
    for (let i = 0; i < 3; i++) {
      const page = source.addPage();
      page.node.Resources()!.set(PDFName.of("XObject"), source.context.obj({ Im: image }));
      page.node.set(
        PDFName.of("Contents"),
        source.context.register(
          source.context.stream(new TextEncoder().encode("q 100 0 0 100 0 0 cm /Im Do Q")),
        ),
      );
    }
    const one = await serializeRange(source, { start: 1, end: 1 });
    const all = await serializeRange(source, { start: 1, end: 3 });
    expect(all.length).toBeLessThan(one.length * 2);
    const entries = await splitPdf(
      source,
      { mode: "size", maxBytes: all.length },
      "shared.pdf",
      async (_, bytes) => {
        const output = await loadPdf(bytes);
        for (const page of output.getPages()) {
          const objects = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
          const stream = objects.lookup(PDFName.of("Im"));
          expect(stream).toBeInstanceOf(PDFRawStream);
          expect((stream as PDFRawStream).getContents()).toEqual(pixels);
        }
      },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.bytes).toBe(all.length);
  });
  test("ZIP reopens, retains page order, dimensions, rotation and contents", async () => {
    const source = await fixture();
    const chunks: Uint8Array[] = [];
    const zip = createArchive(async (chunk) => {
      chunks.push(chunk);
    });
    const entries = await splitPdf(
      source,
      { mode: "ranges", ranges: "4-6,1-3,3,7" },
      "测试.pdf",
      (entry, bytes) => zip.add(entry.name, bytes),
    );
    await zip.finish();
    const files = unzipSync(new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer()));
    expect(Object.keys(files)).toEqual(entries.map((e) => e.name));
    for (const entry of entries) {
      const bytes = files[entry.name]!;
      expect(bytes.length).toBe(entry.bytes);
      const output = await loadPdf(bytes);
      expect(output.getPageCount()).toBe(entry.end - entry.start + 1);
      output.getPages().forEach((page, i) => {
        const index = entry.start - 1 + i;
        expect(page.getWidth()).toBe(300 + index);
        expect(page.getHeight()).toBe(500 + index);
        expect(page.getRotation().angle).toBe((index % 4) * 90);
        expect(page.node.Contents()).toBeDefined();
      });
    }
  });
  test("size accepts exact bytes and rejects one byte less without emitting", async () => {
    const source = await fixture(1);
    const limit = (await serializeRange(source, { start: 1, end: 1 })).length;
    const entries = await splitPdf(
      source,
      { mode: "size", maxBytes: limit },
      "one.pdf",
      async (_, bytes) => {
        expect(bytes.length).toBe(limit);
      },
    );
    expect(entries).toHaveLength(1);
    let emitted = 0;
    await expect(
      splitPdf(source, { mode: "size", maxBytes: limit - 1 }, "one.pdf", async () => {
        emitted++;
      }),
    ).rejects.toThrow(`第 1 页单独导出为 ${limit} 字节`);
    expect(emitted).toBe(0);
  });
  test("middle oversize page fails complete preflight before any output", async () => {
    const source = await fixture(3);
    const stream = source.context.stream(new Uint8Array(20_000).fill(65));
    source.getPage(1).node.set(PDFName.of("Contents"), source.context.register(stream));
    let emitted = 0;
    await expect(
      splitPdf(source, { mode: "size", maxBytes: 2000 }, "middle.pdf", async () => {
        emitted++;
      }),
    ).rejects.toThrow("第 2 页");
    expect(emitted).toBe(0);
  });
  test("size grouping is bounded and covers each page once with shared fonts", async () => {
    const source = await fixture(12);
    const sizes = await Promise.all(
      source
        .getPages()
        .map((_, i) => serializeRange(source, { start: i + 1, end: i + 1 }).then((b) => b.length)),
    );
    const maxBytes = Math.max(...sizes) + 200;
    const covered: number[] = [];
    const result = await splitPdf(
      source,
      { mode: "size", maxBytes },
      "group.pdf",
      async (entry, bytes) => {
        expect(bytes.length).toBeLessThanOrEqual(maxBytes);
        const output = await loadPdf(bytes);
        expect(output.getPageCount()).toBe(entry.end - entry.start + 1);
        for (let page = entry.start; page <= entry.end; page++) covered.push(page);
      },
    );
    expect(result.length).toBeGreaterThan(1);
    expect(covered).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
  test("invalid, zero-page and encrypted PDFs have actionable errors", async () => {
    await expect(loadPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow("无效或已损坏");
    const empty = await PDFDocument.create();
    await expect(loadPdf(await empty.save({ addDefaultPage: false }))).rejects.toThrow(
      "没有可分割",
    );
    const encrypted = await fixture(1);
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
      encrypted.context.obj({ Filter: "Standard" }),
    );
    await expect(loadPdf(await encrypted.save())).rejects.toThrow("加密 PDF");
  });
  test("archive waits for consumer acknowledgement and chunks are bounded", async () => {
    let release: (() => void) | undefined;
    const lengths: number[] = [];
    const zip = createArchive(async (chunk) => {
      lengths.push(chunk.length);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    let done = false;
    const job = zip.add("test.pdf", new Uint8Array(700_000)).then(() => {
      done = true;
    });
    await Bun.sleep(5);
    expect(lengths).toHaveLength(1);
    expect(done).toBe(false);
    while (!done) {
      release?.();
      await Bun.sleep(1);
    }
    await job;
    expect(Math.max(...lengths)).toBeLessThanOrEqual(256 * 1024);
    zip.terminate();
  });
  test("ZIP32 guards account for UTF8 headers and reject overflow", () => {
    expect(archiveBudget(22, 0, "中", 10)).toBe(130);
    expect(() => archiveBudget(22, 65534, "a", 1)).toThrow("ZIP32");
    expect(() => archiveBudget(22, 0, "a", 0xffffffff)).toThrow("ZIP32");
    expect(() => archiveBudget(0xffffff00, 0, "a", 300)).toThrow("ZIP32");
  });
});
