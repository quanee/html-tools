import { announce, element, onAction } from "../../ui/dom";
import { compareText } from "./compare";
import { renderDiff } from "./render";

export function mountDiff(root: HTMLElement): void {
  const left = element<HTMLTextAreaElement>(root, "#diff-left");
  const right = element<HTMLTextAreaElement>(root, "#diff-right");
  const ignoreWhitespace = element<HTMLInputElement>(root, "#diff-ignore-whitespace");
  const ignoreCase = element<HTMLInputElement>(root, "#diff-ignore-case");
  const leftCount = element<HTMLElement>(root, "#diff-left-count");
  const rightCount = element<HTMLElement>(root, "#diff-right-count");
  const status = element<HTMLElement>(root, "#diff-status");
  const results = element<HTMLElement>(root, "#diff-results");
  const placeholder = element<HTMLElement>(root, "#diff-placeholder");
  const viewport = element<HTMLElement>(root, "#diff-viewport");
  const body = element<HTMLTableSectionElement>(root, "#diff-rows");
  const stats = element<HTMLElement>(root, "#diff-stats");
  const counts = {
    added: element<HTMLElement>(root, "#diff-added"),
    removed: element<HTMLElement>(root, "#diff-removed"),
    modified: element<HTMLElement>(root, "#diff-modified"),
  };
  const composing = new Set<HTMLTextAreaElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function compare() {
    timer = undefined;
    try {
      const result = compareText(left.value, right.value, {
        ignoreWhitespace: ignoreWhitespace.checked,
        ignoreCase: ignoreCase.checked,
      });
      renderDiff(result, body);
      for (const key of ["added", "removed", "modified"] as const)
        counts[key].textContent = String(result.stats[key]);
      stats.hidden = false;
      placeholder.hidden = true;
      viewport.hidden = false;
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
      const identical =
        ignoreWhitespace.checked || ignoreCase.checked
          ? "按当前忽略规则比较，内容相同。"
          : "内容相同。";
      announce(
        status,
        result.identical
          ? identical
          : result.inlineFallback
            ? "对比完成。部分行内差异较复杂，已改为整行高亮。"
            : `对比完成：新增 ${result.stats.added} 行，删除 ${result.stats.removed} 行，修改 ${result.stats.modified} 行。`,
      );
    } catch (error) {
      placeholder.textContent = "请调整文本后重试，原文已保留。";
      announce(
        status,
        error instanceof Error ? error.message : "对比失败，请缩小范围后重试。",
        true,
      );
    } finally {
      results.setAttribute("aria-busy", "false");
    }
  }

  function schedule(isComposing = false) {
    clearTimeout(timer);
    timer = undefined;
    leftCount.textContent = `${left.value.length.toLocaleString()} 字符`;
    rightCount.textContent = `${right.value.length.toLocaleString()} 字符`;
    body.replaceChildren();
    viewport.hidden = true;
    stats.hidden = true;
    placeholder.hidden = false;
    announce(status);
    if (left.value === "" && right.value === "") {
      placeholder.textContent = "在上方输入两份文本，差异会自动显示在这里。";
      results.setAttribute("aria-busy", "false");
      return;
    }
    results.setAttribute("aria-busy", "true");
    placeholder.textContent = "等待输入完成，自动更新对比…";
    if (!isComposing && composing.size === 0) timer = setTimeout(compare, 300);
  }

  for (const editor of [left, right]) {
    editor.addEventListener("input", (event) =>
      schedule(event instanceof InputEvent && event.isComposing),
    );
    editor.addEventListener("compositionstart", () => {
      composing.add(editor);
      schedule(true);
    });
    editor.addEventListener("compositionend", () => {
      composing.delete(editor);
      schedule();
    });
  }
  for (const option of [ignoreWhitespace, ignoreCase])
    option.addEventListener("change", () => schedule());
  onAction(root, "swap", () => {
    [left.value, right.value] = [right.value, left.value];
    schedule();
  });
  onAction(root, "clear", () => {
    left.value = right.value = "";
    composing.clear();
    schedule();
    left.focus();
  });
  onAction(root, "sample", () => {
    left.value =
      '项目：拾用工具集\n版本：1.0\n\nconst greeting = "你好，世界 👋";\nconst tools = ["JSON", "时间戳", "Base64"];\n\n旧版配置：enabled\n说明：所有数据在本地处理。';
    right.value =
      '项目：拾用工具集\n版本：1.1\n\nconst greeting = "你好，开发者 👋";\nconst tools = ["JSON", "时间戳", "Base64", "文本对比"];\n自动对比：300ms\n\n说明：所有数据在本地处理。';
    schedule();
  });
  schedule();
}
