export type EditKind = "equal" | "delete" | "insert";
export interface EditRun {
  kind: EditKind;
  count: number;
}

export class DiffBudgetError extends Error {
  constructor() {
    super("文本差异过于复杂，已停止计算。请缩小对比范围后重试。");
  }
}

/** Shared by line alignment and every subsequent inline comparison. */
export class WorkBudget {
  constructor(public remaining: number) {}

  spend(): void {
    if (this.remaining <= 0) throw new DiffBudgetError();
    this.remaining--;
  }
}

function append(runs: EditRun[], kind: EditKind, count: number): void {
  if (!count) return;
  const previous = runs.at(-1);
  if (previous?.kind === kind) previous.count += count;
  else runs.push({ kind, count });
}

function backtrack(trace: Int32Array[], leftLength: number, rightLength: number): EditRun[] {
  const reversed: EditRun[] = [];
  let x = leftLength;
  let y = rightLength;
  for (let distance = trace.length - 1; distance > 0; distance--) {
    const previous = trace[distance - 1]!;
    const diagonal = x - y;
    const index = (diagonal + distance) / 2;
    const inserted = index === 0 || (index !== distance && previous[index - 1]! < previous[index]!);
    const previousDiagonal = diagonal + (inserted ? 1 : -1);
    const previousX = previous[(previousDiagonal + distance - 1) / 2]!;
    const previousY = previousX - previousDiagonal;
    const equalCount = Math.min(x - previousX, y - previousY);
    append(reversed, "equal", equalCount);
    append(reversed, inserted ? "insert" : "delete", 1);
    x = previousX;
    y = previousY;
  }
  append(reversed, "equal", x);
  return reversed.reverse();
}

/** Myers shortest edit script. Store only the reachable diagonals at each depth. */
export function diffSequence(
  left: readonly string[],
  right: readonly string[],
  budget: WorkBudget,
): EditRun[] {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length) {
    budget.spend();
    if (left[prefix] !== right[prefix]) break;
    prefix++;
  }
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix) {
    budget.spend();
    if (left[left.length - suffix - 1] !== right[right.length - suffix - 1]) break;
    suffix++;
  }

  const leftLength = left.length - prefix - suffix;
  const rightLength = right.length - prefix - suffix;
  const result: EditRun[] = [];
  append(result, "equal", prefix);
  if (!leftLength || !rightLength) {
    append(result, "delete", leftLength);
    append(result, "insert", rightLength);
  } else {
    const trace: Int32Array[] = [];
    search: for (let distance = 0; distance <= leftLength + rightLength; distance++) {
      const frontier = new Int32Array(distance + 1);
      const previous = trace[distance - 1];
      for (let index = 0; index <= distance; index++) {
        budget.spend();
        const diagonal = index * 2 - distance;
        let x = !previous
          ? 0
          : index === 0 || (index !== distance && previous[index - 1]! < previous[index]!)
            ? previous[index]!
            : previous[index - 1]! + 1;
        let y = x - diagonal;
        while (x < leftLength && y < rightLength) {
          budget.spend();
          if (left[prefix + x] !== right[prefix + y]) break;
          x++;
          y++;
        }
        frontier[index] = x;
        if (x >= leftLength && y >= rightLength) {
          trace.push(frontier);
          for (const run of backtrack(trace, leftLength, rightLength))
            append(result, run.kind, run.count);
          break search;
        }
      }
      trace.push(frontier);
    }
  }
  append(result, "equal", suffix);
  return result;
}
