import { element, onAction } from "../../ui/dom";
import { bindTextTool } from "../../ui/text-tool";
import { transformJson, type JsonIndent } from "./convert";

export function mountJson(root: HTMLElement): void {
  const editor = bindTextTool(root);
  const indent = element<HTMLSelectElement>(root, "#json-indent");
  onAction(root, "format", () =>
    editor.run(
      (value) => transformJson(value, "format", indent.value as JsonIndent),
      "格式化完成，原始数值与键顺序已保留。",
    ),
  );
  onAction(root, "compact", () =>
    editor.run((value) => transformJson(value, "compact"), "压缩完成，已移除多余空白。"),
  );
  onAction(root, "sample", () =>
    editor.setContent(
      '{"name":"开发者工具集","ready":true,"tools":["JSON","时间戳","Base64"],"id":9007199254740993,"meta":{"version":"1.0","note":"你好，世界 👋"}}',
    ),
  );
}
