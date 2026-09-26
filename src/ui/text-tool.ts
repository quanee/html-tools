import { announce, attempt, copyText, element, onAction } from "./dom";

/** Shared mechanics only; individual tools own conversion and option semantics. */
export function bindTextTool(root: HTMLElement) {
  const editor = element<HTMLTextAreaElement>(root, "[data-editor]");
  const status = element<HTMLElement>(root, "[data-status]");
  const copy = element<HTMLButtonElement>(root, '[data-action="copy"]');
  const count = element<HTMLElement>(root, "[data-character-count]");

  function updateState() {
    count.textContent = `${editor.value.length.toLocaleString()} 字符`;
    copy.disabled = editor.value.length === 0;
  }
  function clearFeedback() {
    announce(status);
    updateState();
  }
  function setContent(value: string) {
    editor.value = value;
    clearFeedback();
    editor.focus();
  }
  function run(transform: (source: string) => string, message: string) {
    clearFeedback();
    attempt(status, () => {
      // Compute first: a failed conversion must leave the editable source intact.
      editor.value = transform(editor.value);
      editor.scrollTop = 0;
      editor.scrollLeft = 0;
      updateState();
      announce(status, message);
    });
  }
  editor.addEventListener("input", clearFeedback);
  root
    .querySelectorAll("select")
    .forEach((select) => select.addEventListener("change", clearFeedback));
  onAction(root, "clear", () => setContent(""));
  onAction(root, "copy", () => {
    void copyText(editor, status);
  });
  updateState();
  return { run, setContent };
}
