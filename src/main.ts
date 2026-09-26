import { mountBase64 } from "./tools/base64/view";
import { mountDiff } from "./tools/diff/view";
import { mountJson } from "./tools/json/view";
import { mountTimestamp } from "./tools/timestamp/view";
import { element } from "./ui/dom";

const tools = [
  { id: "json", title: "JSON 工具", mount: mountJson },
  { id: "timestamp", title: "时间戳转换", mount: mountTimestamp },
  { id: "base64", title: "Base64 编解码", mount: mountBase64 },
  { id: "diff", title: "文本对比", mount: mountDiff },
];

for (const tool of tools) tool.mount(element(document, `#panel-${tool.id}`));

function navigate(): void {
  const selected = tools.find((tool) => tool.id === location.hash.slice(1)) ?? tools[0]!;
  for (const tool of tools) {
    const active = tool.id === selected.id;
    element(document, `#panel-${tool.id}`).hidden = !active;
    const link = element(document, `[href="#${tool.id}"]`);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  element(document, "#breadcrumb-current").textContent = selected.title;
  document.title = `${selected.title} · 拾用工具集`;
}

window.addEventListener("hashchange", navigate);
element<HTMLAnchorElement>(document, ".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  const workspace = element(document, "#workspace");
  workspace.focus();
  workspace.scrollIntoView();
});
navigate();
