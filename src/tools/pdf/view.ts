import { announce, element } from "../../ui/dom";
import { parseCount, parseMegabytes, planRanges, safeStem, type SplitOptions } from "./options";
import type { Request, Response } from "./protocol";

declare const __PDF_WORKER_SOURCE__: string;

export function mountPdf(panel: HTMLElement): void {
  const fileInput = element<HTMLInputElement>(panel, "#pdf-file");
  const drop = element(panel, "#pdf-drop");
  const mode = element<HTMLSelectElement>(panel, "#pdf-mode");
  const count = element<HTMLInputElement>(panel, "#pdf-count");
  const ranges = element<HTMLInputElement>(panel, "#pdf-ranges");
  const size = element<HTMLInputElement>(panel, "#pdf-size");
  const status = element(panel, "#pdf-status");
  const info = element(panel, "#pdf-info");
  const start = element<HTMLButtonElement>(panel, "#pdf-start");
  const cancel = element<HTMLButtonElement>(panel, "#pdf-cancel");
  const clear = element<HTMLButtonElement>(panel, "#pdf-clear");
  const download = element<HTMLAnchorElement>(panel, "#pdf-download");
  const results = element(panel, "#pdf-results");
  const progress = element<HTMLProgressElement>(panel, "#pdf-progress");
  let selected: File | undefined;
  let pages = 0;
  let busy = false;
  let worker: Worker | undefined;
  let workerUrl: string | undefined;
  let resultUrl: string | undefined;
  let task = 0;
  let chunks: Blob[] = [];

  const resetResult = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = undefined;
    download.removeAttribute("href");
    download.hidden = true;
    results.replaceChildren();
    chunks = [];
  };
  const stop = () => {
    task++;
    worker?.terminate();
    worker = undefined;
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = undefined;
    chunks = [];
    busy = false;
    for (const input of [fileInput, mode, count, ranges, size]) input.disabled = false;
    drop.setAttribute("aria-disabled", "false");
    cancel.hidden = true;
    progress.hidden = true;
    start.disabled = !selected;
  };
  const describe = () => {
    info.textContent = selected
      ? `${selected.name} · ${selected.size.toLocaleString()} 字节${pages ? ` · ${pages} 页` : ""}`
      : "尚未选择文件";
  };
  const options = (): SplitOptions => {
    switch (mode.value) {
      case "count":
        return { mode: "count", count: parseCount(count.value) };
      case "ranges":
        return { mode: "ranges", ranges: ranges.value };
      case "size":
        return { mode: "size", maxBytes: parseMegabytes(size.value) };
      default:
        return { mode: "pages" };
    }
  };
  const launch = (type: "inspect" | "split", settings?: SplitOptions) => {
    stop();
    resetResult();
    const id = task;
    busy = true;
    for (const input of [fileInput, mode, count, ranges, size]) input.disabled = true;
    drop.setAttribute("aria-disabled", "true");
    start.disabled = true;
    cancel.hidden = false;
    progress.hidden = false;
    progress.removeAttribute("value");
    announce(status, "正在读取 PDF…");
    try {
      workerUrl = URL.createObjectURL(
        new Blob([__PDF_WORKER_SOURCE__], { type: "text/javascript" }),
      );
      worker = new Worker(workerUrl);
      const fail = (message: string) => {
        if (id !== task) return;
        stop();
        resetResult();
        announce(status, message, true);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail("PDF 后台处理失败，可能是文件过大或浏览器内存不足。请重试或使用较小文件。");
      };
      worker.onmessageerror = () => fail("无法接收后台处理结果，请重试。");
      worker.onmessage = (event: MessageEvent<Response>) => {
        const message = event.data;
        if (message.id !== task || id !== task) return;
        try {
          switch (message.type) {
            case "metadata":
              pages = message.pages;
              describe();
              if (type === "inspect") {
                stop();
                announce(status, "文件已就绪，请选择分割方式。");
              }
              break;
            case "progress": {
              const labels = {
                read: "读取 PDF",
                preflight: "检查每页大小",
                split: "分割页面",
                zip: "完成 ZIP",
              };
              const value = message.progress;
              if (value.phase === "read" || value.phase === "zip")
                progress.removeAttribute("value");
              else {
                progress.max = value.total;
                progress.value = value.current;
              }
              announce(
                status,
                `${labels[value.phase]}…${value.phase === "read" ? "" : ` ${value.current} / ${value.total}`}`,
              );
              break;
            }
            case "chunk":
              chunks.push(new Blob([message.buffer]));
              worker!.postMessage({
                type: "ack",
                id,
                sequence: message.sequence,
              } satisfies Request);
              break;
            case "error":
              fail(message.message);
              break;
            case "done": {
              const blob = new Blob(chunks, { type: "application/zip" });
              resultUrl = URL.createObjectURL(blob);
              download.href = resultUrl;
              download.download = `${safeStem(selected!.name)}_split.zip`;
              download.hidden = false;
              const summary = document.createElement("p");
              summary.textContent = `已生成 ${message.manifest.length} 份 PDF · ZIP ${blob.size.toLocaleString()} 字节`;
              const list = document.createElement("ol");
              for (const entry of message.manifest) {
                const item = document.createElement("li");
                item.textContent = `${entry.name} · 第 ${entry.start}${entry.end === entry.start ? "" : `–${entry.end}`} 页 · ${entry.bytes.toLocaleString()} 字节`;
                list.append(item);
              }
              results.replaceChildren(summary, list);
              stop();
              announce(status, "分割完成，已尝试自动下载；如未开始，请点击再次下载 ZIP。");
              try {
                download.click();
              } catch {
                announce(status, "分割完成，请点击再次下载 ZIP 保存文件。");
              }
              break;
            }
          }
        } catch {
          fail("无法保存处理结果，可能是浏览器内存不足。请重试或使用较小文件。");
        }
      };
      worker.postMessage(
        type === "inspect"
          ? { type, id, file: selected! }
          : { type, id, file: selected!, options: settings! },
      );
    } catch {
      stop();
      resetResult();
      announce(status, "无法启动后台处理。请使用支持 Blob Worker 的现代浏览器。", true);
    }
  };
  const choose = (files: FileList | null) => {
    if (busy || !files?.length) return;
    if (files.length !== 1) {
      announce(status, "请一次选择一个 PDF 文件。", true);
      return;
    }
    const file = files[0]!;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      announce(status, "请选择 PDF 文件。", true);
      return;
    }
    selected = file;
    pages = 0;
    describe();
    launch("inspect");
  };
  fileInput.addEventListener("change", () => {
    choose(fileInput.files);
    fileInput.value = "";
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy";
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    choose(event.dataTransfer?.files ?? null);
  });
  const updateMode = () => {
    for (const name of ["count", "ranges", "size"])
      element(panel, `#pdf-${name}-field`).hidden = mode.value !== name;
  };
  for (const input of [mode, count, ranges, size])
    input.addEventListener("input", () => {
      resetResult();
      updateMode();
      announce(status);
    });
  start.addEventListener("click", () => {
    if (!selected || busy) return;
    try {
      const settings = options();
      if (pages && settings.mode !== "size") planRanges(settings, pages);
      launch("split", settings);
    } catch (error) {
      announce(status, error instanceof Error ? error.message : "请检查分割设置。", true);
    }
  });
  cancel.addEventListener("click", () => {
    stop();
    resetResult();
    announce(status, "已取消，原文件与设置已保留，可重新分割。");
  });
  clear.addEventListener("click", () => {
    stop();
    resetResult();
    selected = undefined;
    pages = 0;
    fileInput.value = "";
    start.disabled = true;
    describe();
    announce(status);
  });
  window.addEventListener("pagehide", () => {
    stop();
    resetResult();
  });
  updateMode();
}
