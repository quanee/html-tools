import { element } from "./dom";

export function mountSidebar(): void {
  const shell = element(document, ".app-shell");
  const toggle = element<HTMLButtonElement>(document, "#sidebar-toggle");
  toggle.addEventListener("click", () => {
    const collapsed = shell.classList.toggle("sidebar-collapsed");
    const label = collapsed ? "展开导航" : "折叠导航";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  });
}
