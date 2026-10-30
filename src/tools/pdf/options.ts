export type SplitOptions =
  | { mode: "pages" }
  | { mode: "count"; count: number }
  | { mode: "ranges"; ranges: string }
  | { mode: "size"; maxBytes: number };

export interface PageRange {
  start: number;
  end: number;
}
export interface ManifestEntry extends PageRange {
  name: string;
  bytes: number;
}
export interface Progress {
  phase: "read" | "preflight" | "split" | "zip";
  current: number;
  total: number;
}

export function parseCount(value: string): number {
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    throw new Error("每份页数必须是正整数。");
  return Number(value);
}

export function parseMegabytes(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("大小必须为正数，最多两位小数。");
  const bytes = Math.round(Number(value) * 1_000_000);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("大小必须为有效的正数。");
  return bytes;
}

export function planRanges(
  options: Exclude<SplitOptions, { mode: "size" }>,
  pages: number,
): PageRange[] {
  if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("PDF 没有可分割的页面。");
  if (options.mode === "ranges") {
    return options.ranges.split(/[,，]/).map((entry) => {
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(entry.trim());
      if (!match) throw new Error("范围格式无效，请使用 1-3,4-6,7，不能包含空段。");
      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 1 ||
        end < start ||
        end > pages
      )
        throw new Error(`页码必须在 1–${pages} 内，且范围不能倒序。`);
      return { start, end };
    });
  }
  const count = options.mode === "pages" ? 1 : parseCount(String(options.count));
  const result: PageRange[] = [];
  for (let start = 1; start <= pages; start += count)
    result.push({ start, end: Math.min(start + count - 1, pages) });
  return result;
}

export function safeStem(filename: string): string {
  const stem = filename
    .replace(/\.pdf$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return stem || "document";
}

export function partName(stem: string, index: number, range: PageRange): string {
  const page = (n: number) => String(n).padStart(4, "0");
  return `${stem}_part-${String(index).padStart(3, "0")}_pages-${page(range.start)}${range.end === range.start ? "" : `-${page(range.end)}`}.pdf`;
}
