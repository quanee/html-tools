import { describe, expect, test } from "bun:test";
import { compareText, DIFF_LIMITS, type DiffResult } from "../src/tools/diff/compare";
import { DiffBudgetError, diffSequence, WorkBudget } from "../src/tools/diff/sequence";

function sideText(result: DiffResult, side: "left" | "right"): string {
  return result.rows.flatMap((row) => (row[side] ? [row[side]!.text] : [])).join("\n");
}

describe("text comparison", () => {
  test("handles identical and empty inputs", () => {
    expect(compareText("", "")).toMatchObject({ rows: [], identical: true, inlineFallback: false });
    const result = compareText("你好\nhello\n", "你好\nhello\n");
    expect(result.identical).toBe(true);
    expect(result.stats).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 3 });
    expect(result.rows.map((row) => row.left!.number)).toEqual([1, 2, 3]);
  });
  test("one empty side is entirely added or removed", () => {
    expect(compareText("", "a\nb").stats).toEqual({
      added: 2,
      removed: 0,
      modified: 0,
      unchanged: 0,
    });
    expect(compareText("a\nb", "").stats).toEqual({
      added: 0,
      removed: 2,
      modified: 0,
      unchanged: 0,
    });
  });
  test("aligns inserted and removed lines", () => {
    const added = compareText("a\nc", "a\nb\nc");
    expect(added.rows.map((row) => [row.type, row.left?.number, row.right?.number])).toEqual([
      ["equal", 1, 1],
      ["added", undefined, 2],
      ["equal", 2, 3],
    ]);
    expect(compareText("a\nb\nc", "a\nc").rows[1]?.type).toBe("removed");
  });
  test("pairs change blocks by order, with remaining lines added", () => {
    const result = compareText("same\nold\nend", "same\nnew\nextra\nend");
    expect(result.rows.map((row) => row.type)).toEqual(["equal", "modified", "added", "equal"]);
    expect(result.stats).toEqual({ added: 1, removed: 0, modified: 1, unchanged: 2 });
  });
  test("highlights only changed parts of a modified line", () => {
    const row = compareText("hello old world", "hello new world").rows[0]!;
    expect(row.left!.spans).toEqual([
      { text: "hello ", changed: false },
      { text: "old", changed: true },
      { text: " world", changed: false },
    ]);
    expect(
      row
        .right!.spans.filter((span) => span.changed)
        .map((span) => span.text)
        .join(""),
    ).toBe("new");
  });
  test("normalizes line endings, preserving blank lines and final newline", () => {
    expect(compareText("a\r\nb\r", "a\nb\n").identical).toBe(true);
    expect(compareText("a\nb", "a\n\nb").stats.added).toBe(1);
    const result = compareText("a", "a\n");
    expect(result.stats.added).toBe(1);
    expect(result.rows[1]?.right?.trailingNewline).toBe(true);
  });
  test("compares whitespace and case exactly by default", () => {
    expect(compareText("Hello ", "hello").identical).toBe(false);
    expect(compareText("a b", "ab").identical).toBe(false);
    expect(compareText("a\tb", "a b").identical).toBe(false);
  });
  test("ignore options preserve all original text", () => {
    const left = "  Hello\t WORLD \n next　line";
    const right = "helloworld\nNEXT LINE";
    const result = compareText(left, right, { ignoreWhitespace: true, ignoreCase: true });
    expect(result.identical).toBe(true);
    expect(sideText(result, "left")).toBe(left);
    expect(sideText(result, "right")).toBe(right);
    expect(compareText("a\n\nb", "a\nb", { ignoreWhitespace: true }).identical).toBe(false);
    expect(compareText("a\n", "a", { ignoreWhitespace: true }).identical).toBe(false);
  });
  test("ignore rules apply to inline highlights", () => {
    const row = compareText(" A B old ", "ab new", { ignoreWhitespace: true, ignoreCase: true })
      .rows[0]!;
    expect(
      row
        .left!.spans.filter((span) => span.changed)
        .map((span) => span.text)
        .join(""),
    ).toBe("old");
    expect(
      row
        .right!.spans.filter((span) => span.changed)
        .map((span) => span.text)
        .join(""),
    ).toBe("new");
    expect(row.left!.spans.map((span) => span.text).join("")).toBe(" A B old ");
  });
  test("whole-line Unicode lowercase rules are shared with inline comparison", () => {
    const row = compareText("ΟΣ old", "ος new", { ignoreCase: true }).rows[0]!;
    expect(
      row
        .left!.spans.filter((span) => span.changed)
        .map((span) => span.text)
        .join(""),
    ).toBe("old");
    expect(compareText("İ", "i\u0307", { ignoreCase: true }).identical).toBe(true);
  });
  test("Chinese, emoji sequences and combining marks are grapheme-safe", () => {
    const row = compareText("你好 👩‍💻 e\u0301", "您好 👨‍💻 e\u0300").rows[0]!;
    expect(row.left!.spans).toEqual([
      { text: "你", changed: true },
      { text: "好 ", changed: false },
      { text: "👩‍💻", changed: true },
      { text: " ", changed: false },
      { text: "e\u0301", changed: true },
    ]);
  });
  test("falls back to Unicode code points without Intl.Segmenter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    try {
      const row = compareText("A😀B", "A😃B").rows[0]!;
      expect(row.left!.spans).toEqual([
        { text: "A", changed: false },
        { text: "😀", changed: true },
        { text: "B", changed: false },
      ]);
    } finally {
      Object.defineProperty(Intl, "Segmenter", descriptor);
    }
  });
  test("keeps HTML-like text literal", () => {
    const text = '<script>alert("x")</script>\n<img src=x onerror=alert(1)>';
    expect(sideText(compareText(text, ""), "left")).toBe(text);
  });
  test("accepts the documented limits and rejects larger input", () => {
    expect(
      compareText("x".repeat(DIFF_LIMITS.characters), "x".repeat(DIFF_LIMITS.characters)).identical,
    ).toBe(true);
    expect(() => compareText("x".repeat(DIFF_LIMITS.characters + 1), "")).toThrow("200,000");
    expect(
      compareText("x\n".repeat(DIFF_LIMITS.lines - 1), "x\n".repeat(DIFF_LIMITS.lines - 1))
        .identical,
    ).toBe(true);
    expect(() => compareText("", "\n".repeat(DIFF_LIMITS.lines))).toThrow("5,000");
  });
  test("complex line alignment stops within its work budget", () => {
    const left = Array.from({ length: 2000 }, (_, index) => `left${index}`).join("\n");
    const right = Array.from({ length: 2000 }, (_, index) => `right${index}`).join("\n");
    expect(() => compareText(left, right)).toThrow(DiffBudgetError);
  });
  test("inline budget exhaustion falls back to complete line highlights", () => {
    const left = "a".repeat(2000) + "\nsecond old";
    const right = "b".repeat(2000) + "\nsecond new";
    const result = compareText(left, right);
    expect(result.inlineFallback).toBe(true);
    expect(result.rows[0]!.left!.spans).toEqual([{ text: "a".repeat(2000), changed: true }]);
    expect(result.rows[1]!.right!.spans).toEqual([{ text: "second new", changed: true }]);
    expect(sideText(result, "left")).toBe(left);
    expect(sideText(result, "right")).toBe(right);
  });
});

describe("Myers sequence alignment", () => {
  test("search and character comparisons share one budget", () => {
    const budget = new WorkBudget(2);
    expect(diffSequence(["x"], ["x"], budget)).toEqual([{ kind: "equal", count: 1 }]);
    expect(budget.remaining).toBe(1);
    expect(() => diffSequence(["a"], ["b"], budget)).toThrow(DiffBudgetError);
    expect(budget.remaining).toBe(0);
  });
  test("short random sequences reconstruct both sides with minimal edit distance", () => {
    let seed = 17;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    const pick = (size: number) => (random() >>> 8) % size;
    for (let trial = 0; trial < 250; trial++) {
      const left = Array.from({ length: pick(12) }, () => String(pick(4)));
      const right = Array.from({ length: pick(12) }, () => String(pick(4)));
      const lcs = Array.from({ length: left.length + 1 }, () =>
        new Array<number>(right.length + 1).fill(0),
      );
      for (let x = 1; x <= left.length; x++)
        for (let y = 1; y <= right.length; y++) {
          lcs[x]![y] =
            left[x - 1] === right[y - 1]
              ? lcs[x - 1]![y - 1]! + 1
              : Math.max(lcs[x - 1]![y]!, lcs[x]![y - 1]!);
        }
      let x = 0,
        y = 0,
        cost = 0;
      for (const run of diffSequence(left, right, new WorkBudget(DIFF_LIMITS.steps))) {
        if (run.kind === "equal") {
          expect(left.slice(x, x + run.count)).toEqual(right.slice(y, y + run.count));
          x += run.count;
          y += run.count;
        } else {
          cost += run.count;
          if (run.kind === "delete") x += run.count;
          else y += run.count;
        }
      }
      expect([x, y, cost]).toEqual([
        left.length,
        right.length,
        left.length + right.length - 2 * lcs[left.length]![right.length]!,
      ]);
      const result = compareText(left.join("\n"), right.join("\n"));
      expect(sideText(result, "left")).toBe(left.join("\n"));
      expect(sideText(result, "right")).toBe(right.join("\n"));
    }
  });
});
