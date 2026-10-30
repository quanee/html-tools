import { element } from "./dom";

type FullscreenRegion = {
  target: HTMLElement;
  trigger: HTMLButtonElement;
  dialog: HTMLDialogElement;
  header: HTMLElement;
  exit: HTMLButtonElement;
};
type FullscreenEntry = FullscreenRegion & { restoreBackground: () => void };

function captureView(target: HTMLElement): () => void {
  const fields = [...target.querySelectorAll("textarea")].map((field) => ({
    field,
    start: field.selectionStart,
    end: field.selectionEnd,
    direction: field.selectionDirection,
  }));
  const scroll = [
    target,
    ...target.querySelectorAll<HTMLElement>("textarea, [data-fullscreen-scroll]"),
  ].map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }));
  return () => {
    for (const { field, start, end, direction } of fields)
      field.setSelectionRange(start, end, direction);
    for (const { node, top, left } of scroll) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
  };
}

export function mountFullscreen() {
  const stack: FullscreenEntry[] = [];
  const composing = new Set<EventTarget>();
  let imeEscape = false;

  document.addEventListener("compositionstart", (event) => {
    if (event.target) composing.add(event.target);
  });
  document.addEventListener("compositionend", (event) => {
    if (event.target) composing.delete(event.target);
  });

  function setButton(button: HTMLButtonElement, target: HTMLElement, active: boolean) {
    const label = target.dataset.fullscreenLabel!;
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? `退出${label}全屏` : `${label}全屏`);
    button.title = active ? "退出全屏（Esc）" : `${label}全屏`;
    element(button, "[data-fullscreen-text]").textContent = active
      ? "退出全屏"
      : button.dataset.fullscreenText!;
    button.querySelector("use")!.setAttribute("href", active ? "#icon-restore" : "#icon-expand");
  }

  function close(restoreFocus = true) {
    const entry = stack.pop();
    if (!entry) return;
    const restoreView = captureView(entry.target);
    entry.dialog.close();
    entry.dialog.classList.remove("fullscreen-dialog");
    entry.dialog.setAttribute("role", "group");
    entry.dialog.setAttribute("aria-label", entry.target.dataset.fullscreenLabel!);
    entry.header.hidden = true;
    entry.target.classList.remove("is-fullscreen");
    entry.dialog.open = true;
    setButton(entry.trigger, entry.target, false);
    document.documentElement.classList.toggle("fullscreen-open", stack.length > 0);
    if (restoreFocus) entry.trigger.focus({ preventScroll: true });
    restoreView();
    entry.restoreBackground();
  }

  function open(region: FullscreenRegion) {
    const { target, trigger, dialog, header, exit } = region;
    const restoreView = captureView(target);
    const ancestors: { node: HTMLElement; top: number; left: number }[] = [];
    for (let node = dialog.parentElement; node; node = node.parentElement)
      ancestors.push({ node, top: node.scrollTop, left: node.scrollLeft });
    const pageX = window.scrollX;
    const pageY = window.scrollY;
    exit.lastChild!.textContent = stack.length ? "返回对比工作区" : "退出全屏";
    stack.push({
      ...region,
      restoreBackground() {
        for (const { node, top, left } of ancestors) {
          node.scrollTop = top;
          node.scrollLeft = left;
        }
        window.scrollTo(pageX, pageY);
      },
    });
    dialog.close();
    dialog.classList.add("fullscreen-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", `${target.dataset.fullscreenLabel}全屏`);
    header.hidden = false;
    target.classList.add("is-fullscreen");
    setButton(trigger, target, true);
    document.documentElement.classList.add("fullscreen-open");
    dialog.showModal();
    target.querySelector("textarea")?.focus({ preventScroll: true });
    restoreView();
  }

  // Leave IME cancellation to the browser, but suppress its dialog cancel event.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || stack.length === 0) return;
    imeEscape = event.isComposing || event.keyCode === 229 || composing.size > 0;
    if (!imeEscape) {
      event.preventDefault();
      close();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") imeEscape = false;
  });

  for (const trigger of document.querySelectorAll<HTMLButtonElement>("[data-fullscreen-target]")) {
    const target = element(document, `#${trigger.dataset.fullscreenTarget}`);
    trigger.dataset.fullscreenText = element(trigger, "[data-fullscreen-text]").textContent!;
    setButton(trigger, target, false);

    // Wrap once before editing starts. Toggling only changes presentation: even atomic
    // DOM moves clear Chromium's native textarea undo history, so never reparent on toggle.
    const dialog = document.createElement("dialog");
    dialog.className = "fullscreen-host";
    dialog.open = true;
    dialog.setAttribute("role", "group");
    dialog.setAttribute("aria-label", target.dataset.fullscreenLabel!);
    const header = document.createElement("div");
    header.className = "fullscreen-header";
    header.hidden = true;
    const title = document.createElement("strong");
    title.textContent = target.dataset.fullscreenLabel!;
    const exit = document.createElement("button");
    exit.type = "button";
    exit.className = "button fullscreen-exit";
    exit.title = "退出当前全屏（Esc）";
    const icon = trigger.querySelector("svg")!.cloneNode(true) as SVGElement;
    icon.querySelector("use")!.setAttribute("href", "#icon-restore");
    exit.append(icon, document.createTextNode("退出全屏"));
    exit.addEventListener("click", () => close());
    header.append(title, exit);
    const body = document.createElement("div");
    body.className = "fullscreen-body";
    target.before(dialog);
    body.append(target);
    dialog.append(header, body);

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!imeEscape && composing.size === 0 && stack.at(-1)?.dialog === dialog) close();
    });
    const region = { target, trigger, dialog, header, exit };
    trigger.addEventListener("click", () => {
      if (stack.at(-1)?.target === target) close();
      else if (!stack.some((entry) => entry.target === target)) open(region);
    });
  }

  return {
    closeAll() {
      while (stack.length) close(false);
    },
  };
}
