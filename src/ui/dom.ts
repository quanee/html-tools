export function element<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element: ${selector}`);
  return found;
}

export function announce(target: HTMLElement, message = "", error = false): void {
  target.textContent = message;
  target.classList.toggle("is-error", error);
}

export function attempt(status: HTMLElement, work: () => void): void {
  try {
    work();
  } catch (error) {
    announce(status, error instanceof Error ? error.message : "操作失败，请检查输入。", true);
  }
}

export function onAction(root: HTMLElement, action: string, handler: () => void): void {
  element<HTMLButtonElement>(root, `[data-action="${action}"]`).addEventListener("click", handler);
}

export async function copyText(
  field: HTMLTextAreaElement | HTMLInputElement,
  status: HTMLElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(field.value);
    announce(status, "已复制到剪贴板。");
  } catch {
    field.focus();
    field.select();
    announce(status, "无法自动复制，已选中结果，请按 Ctrl+C（Mac：⌘C）复制。");
  }
}
