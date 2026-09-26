import type { DiffLine, DiffResult, DiffRow } from "./compare";

const ROW_LABELS: Record<DiffRow["type"], string> = {
  equal: "相同",
  added: "新增",
  removed: "删除",
  modified: "修改",
};

function appendSide(
  row: HTMLTableRowElement,
  line: DiffLine | null,
  side: "left" | "right",
  type: DiffRow["type"],
): void {
  if (!line) {
    const empty = document.createElement("td");
    empty.colSpan = 3;
    empty.className = `diff-gap diff-${side}`;
    empty.setAttribute("aria-label", "此侧无对应行");
    row.append(empty);
    return;
  }
  const tone = type === "equal" ? "equal" : side === "left" ? "removed" : "added";
  const number = document.createElement("td");
  number.className = `diff-line-number diff-${side} diff-${tone}`;
  number.textContent = String(line.number);
  const marker = document.createElement("td");
  marker.className = `diff-line-marker diff-${tone}`;
  marker.textContent =
    type === "equal" ? "" : type === "modified" ? "~" : type === "added" ? "+" : "−";
  marker.setAttribute("aria-label", ROW_LABELS[type]);
  const content = document.createElement("td");
  content.className = `diff-line-content diff-${tone}`;
  if (line.text === "") {
    const placeholder = document.createElement("span");
    placeholder.className = "diff-empty-line";
    placeholder.textContent = line.trailingNewline ? "↵ 末尾换行" : "空行";
    content.append(placeholder);
  } else {
    for (const part of line.spans) {
      if (!part.changed) content.append(document.createTextNode(part.text));
      else {
        const highlight = document.createElement("mark");
        highlight.className = "diff-inline";
        highlight.textContent = part.text;
        content.append(highlight);
      }
    }
  }
  row.append(number, marker, content);
}

export function renderDiff(result: DiffResult, body: HTMLTableSectionElement): void {
  const fragment = document.createDocumentFragment();
  for (const change of result.rows) {
    const row = document.createElement("tr");
    row.dataset.kind = change.type;
    appendSide(row, change.left, "left", change.type);
    appendSide(row, change.right, "right", change.type);
    fragment.append(row);
  }
  body.replaceChildren(fragment);
}
