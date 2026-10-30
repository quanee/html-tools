import { PDFDocument } from "pdf-lib";
import {
  partName,
  planRanges,
  safeStem,
  type ManifestEntry,
  type PageRange,
  type Progress,
  type SplitOptions,
} from "./options";

export async function loadPdf(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  try {
    const document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    if (!document.getPageCount()) throw new Error("PDF 没有可分割的页面。");
    return document;
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message))
      throw new Error("不支持加密 PDF，请先解密后重试。");
    if (error instanceof Error && error.message === "PDF 没有可分割的页面。") throw error;
    throw new Error("无法读取 PDF：文件无效或已损坏。");
  }
}

export async function serializeRange(source: PDFDocument, range: PageRange): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  // Fixed metadata keeps size probes repeatable, including an exact-byte boundary.
  output.setCreationDate(new Date(0));
  output.setModificationDate(new Date(0));
  const indices = Array.from(
    { length: range.end - range.start + 1 },
    (_, index) => range.start - 1 + index,
  );
  for (const page of await output.copyPages(source, indices)) output.addPage(page);
  return output.save();
}

/** Sequential generation: the consumer must finish writing before the next PDF is created. */
export async function splitPdf(
  source: PDFDocument,
  options: SplitOptions,
  filename: string,
  emit: (entry: ManifestEntry, bytes: Uint8Array) => Promise<void>,
  progress: (value: Progress) => void = () => {},
): Promise<ManifestEntry[]> {
  const total = source.getPageCount();
  const manifest: ManifestEntry[] = [];
  const stem = safeStem(filename);
  const publish = async (range: PageRange, bytes: Uint8Array) => {
    const entry = {
      ...range,
      name: partName(stem, manifest.length + 1, range),
      bytes: bytes.length,
    };
    await emit(entry, bytes);
    manifest.push(entry);
  };
  if (options.mode !== "size") {
    const ranges = planRanges(options, total);
    for (const [index, range] of ranges.entries()) {
      progress({ phase: "split", current: index, total: ranges.length });
      await publish(range, await serializeRange(source, range));
    }
    return manifest;
  }
  const limit = options.maxBytes;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("大小上限必须为正整数字节数。");
  // Complete preflight before the consumer receives even one output PDF.
  for (let page = 1; page <= total; page++) {
    progress({ phase: "preflight", current: page - 1, total });
    const size = (await serializeRange(source, { start: page, end: page })).length;
    if (size > limit)
      throw new Error(
        `第 ${page} 页单独导出为 ${size} 字节，超过上限 ${limit} 字节。请提高大小上限后重试。`,
      );
  }
  for (let start = 1; start <= total; ) {
    progress({ phase: "split", current: start - 1, total });
    let end = start;
    let best = await serializeRange(source, { start, end });
    let step = 1;
    let high = total + 1;
    while (end < total) {
      const candidate = Math.min(start + step, total);
      const bytes = await serializeRange(source, { start, end: candidate });
      if (bytes.length > limit) {
        high = candidate;
        break;
      }
      end = candidate;
      best = bytes;
      step *= 2;
    }
    while (end + 1 < high) {
      const candidate = Math.floor((end + high) / 2);
      const bytes = await serializeRange(source, { start, end: candidate });
      if (bytes.length <= limit) {
        end = candidate;
        best = bytes;
      } else high = candidate;
    }
    await publish({ start, end }, best);
    start = end + 1;
  }
  return manifest;
}
