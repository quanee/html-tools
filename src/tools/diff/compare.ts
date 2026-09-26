import { DiffBudgetError, WorkBudget, diffSequence, type EditRun } from "./sequence";

export const DIFF_LIMITS = { characters: 200_000, lines: 5_000, steps: 2_000_000 } as const;

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

export interface DiffSpan {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  number: number;
  text: string;
  spans: DiffSpan[];
  trailingNewline: boolean;
}

export interface DiffRow {
  type: "equal" | "added" | "removed" | "modified";
  left: DiffLine | null;
  right: DiffLine | null;
}

export interface DiffResult {
  rows: DiffRow[];
  stats: { added: number; removed: number; modified: number; unchanged: number };
  identical: boolean;
  inlineFallback: boolean;
}

function splitLines(source: string, label: string): string[] {
  if (source.length > DIFF_LIMITS.characters)
    throw new Error(`${label}超过 200,000 个字符，请缩小对比范围。`);
  const lines = source === "" ? [] : source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > DIFF_LIMITS.lines) throw new Error(`${label}超过 5,000 行，请缩小对比范围。`);
  return lines;
}

function stripWhitespace(text: string, options: DiffOptions): string {
  return options.ignoreWhitespace ? text.replace(/[^\S\r\n]/gu, "") : text;
}

function comparisonKey(text: string, options: DiffOptions): string {
  const key = stripWhitespace(text, options);
  return options.ignoreCase ? key.toLowerCase() : key;
}

function* graphemes(text: string, segmenter: Intl.Segmenter | undefined): Generator<string> {
  if (segmenter) {
    for (const part of segmenter.segment(text)) yield part.segment;
  } else {
    yield* text;
  }
}

interface CharacterRange {
  start: number;
  end: number;
}

interface PreparedText {
  keys: string[];
  tokens: CharacterRange[];
  originals: (CharacterRange & { text: string })[];
}

/** Map normalized ranges back to original graphemes, including ignored whitespace. */
function prepareText(
  text: string,
  options: DiffOptions,
  segmenter: Intl.Segmenter | undefined,
): PreparedText {
  const originals: PreparedText["originals"] = [];
  let position = 0;
  for (const original of graphemes(text, segmenter)) {
    const length = comparisonKey(original, options).length;
    originals.push({ text: original, start: position, end: position + length });
    position += length;
  }
  // Lowercase the whole line, preserving contextual Unicode rules (e.g. Greek sigma).
  const key = comparisonKey(text, options);
  const keys: string[] = [];
  const tokens: CharacterRange[] = [];
  position = 0;
  for (const token of graphemes(key, segmenter)) {
    keys.push(token);
    tokens.push({ start: position, end: position + token.length });
    position += token.length;
  }
  return { keys, tokens, originals };
}

function changedRanges(
  runs: EditRun[],
  prepared: PreparedText,
  side: "delete" | "insert",
): CharacterRange[] {
  const ranges: CharacterRange[] = [];
  let position = 0;
  for (const run of runs) {
    if (run.kind === side) {
      ranges.push({
        start: prepared.tokens[position]!.start,
        end: prepared.tokens[position + run.count - 1]!.end,
      });
    }
    if (run.kind === side || run.kind === "equal") position += run.count;
  }
  return ranges;
}

function originalSpans(prepared: PreparedText, changed: CharacterRange[]): DiffSpan[] {
  const spans: DiffSpan[] = [];
  let index = 0;
  for (const original of prepared.originals) {
    while (changed[index] && changed[index]!.end <= original.start) index++;
    const range = changed[index];
    const isChanged =
      original.start !== original.end && Boolean(range && range.start < original.end);
    const previous = spans.at(-1);
    if (previous?.changed === isChanged) previous.text += original.text;
    else spans.push({ text: original.text, changed: isChanged });
  }
  return spans;
}

function highlightPair(
  left: DiffLine,
  right: DiffLine,
  options: DiffOptions,
  segmenter: Intl.Segmenter | undefined,
  budget: WorkBudget,
): boolean {
  try {
    if (budget.remaining === 0) throw new DiffBudgetError();
    const leftText = prepareText(left.text, options, segmenter);
    const rightText = prepareText(right.text, options, segmenter);
    const runs = diffSequence(leftText.keys, rightText.keys, budget);
    left.spans = originalSpans(leftText, changedRanges(runs, leftText, "delete"));
    right.spans = originalSpans(rightText, changedRanges(runs, rightText, "insert"));
    return false;
  } catch (error) {
    if (!(error instanceof DiffBudgetError)) throw error;
    left.spans = [{ text: left.text, changed: true }];
    right.spans = [{ text: right.text, changed: true }];
    return true;
  }
}

/** Pure comparison: the inputs are never rewritten; all rows retain their original text. */
export function compareText(left: string, right: string, options: DiffOptions = {}): DiffResult {
  const leftLines = splitLines(left, "原文");
  const rightLines = splitLines(right, "新文本");
  const budget = new WorkBudget(DIFF_LIMITS.steps);
  const runs = diffSequence(
    leftLines.map((line) => comparisonKey(line, options)),
    rightLines.map((line) => comparisonKey(line, options)),
    budget,
  );
  const rows: DiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  function line(lines: string[], index: number, changed = false): DiffLine {
    const text = lines[index]!;
    return {
      number: index + 1,
      text,
      spans: [{ text, changed }],
      trailingNewline: index > 0 && index === lines.length - 1 && text === "",
    };
  }
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!;
    if (run.kind === "equal") {
      for (let count = 0; count < run.count; count++)
        rows.push({
          type: "equal",
          left: line(leftLines, leftIndex++),
          right: line(rightLines, rightIndex++),
        });
      continue;
    }
    let removed = 0;
    let added = 0;
    while (index < runs.length && runs[index]!.kind !== "equal") {
      const change = runs[index++]!;
      if (change.kind === "delete") removed += change.count;
      else added += change.count;
    }
    index--;
    for (let count = 0; count < Math.max(removed, added); count++) {
      const leftLine = count < removed ? line(leftLines, leftIndex++, true) : null;
      const rightLine = count < added ? line(rightLines, rightIndex++, true) : null;
      rows.push({
        type: leftLine && rightLine ? "modified" : leftLine ? "removed" : "added",
        left: leftLine,
        right: rightLine,
      });
    }
  }

  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : undefined;
  let inlineFallback = false;
  for (const row of rows) {
    if (row.type === "equal") stats.unchanged++;
    else stats[row.type]++;
    if (row.type === "modified")
      inlineFallback =
        highlightPair(row.left!, row.right!, options, segmenter, budget) || inlineFallback;
  }
  return {
    rows,
    stats,
    identical: stats.added + stats.removed + stats.modified === 0,
    inlineFallback,
  };
}
