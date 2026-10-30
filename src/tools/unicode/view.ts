import { element, onAction } from "../../ui/dom";
import { bindTextTool } from "../../ui/text-tool";
import { decodeUnicode, encodeUnicode, type UnicodeScope } from "./convert";

export function mountUnicode(root: HTMLElement): void {
  const editor = bindTextTool(root);
  const scope = element<HTMLSelectElement>(root, "#unicode-scope");
  onAction(root, "encode", () =>
    editor.run(
      (value) => encodeUnicode(value, scope.value as UnicodeScope),
      "编码完成，已按所选范围转换为 Unicode 转义。",
    ),
  );
  onAction(root, "decode", () => editor.run(decodeUnicode, "解码完成，已还原一层 Unicode 转义。"));
  onAction(root, "sample", () => editor.setContent("你好，世界 😀\nHello, Unicode! 123"));
}
