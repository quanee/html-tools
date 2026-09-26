import { element, onAction } from "../../ui/dom";
import { bindTextTool } from "../../ui/text-tool";
import { decodeBase64, encodeBase64, type Base64Variant } from "./convert";

export function mountBase64(root: HTMLElement): void {
  const editor = bindTextTool(root);
  const variant = element<HTMLSelectElement>(root, "#base64-variant");
  onAction(root, "encode", () =>
    editor.run(
      (value) => encodeBase64(value, variant.value as Base64Variant),
      "编码完成，使用 UTF-8 字符集。",
    ),
  );
  onAction(root, "decode", () =>
    editor.run(
      (value) => decodeBase64(value, variant.value as Base64Variant),
      "解码完成，结果为 UTF-8 文本。",
    ),
  );
  onAction(root, "sample", () => editor.setContent("你好，世界 👋\nHello, developer."));
}
