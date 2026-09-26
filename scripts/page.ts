import { join } from "node:path";

export const root = join(import.meta.dir, "..");

/** Keep build output in memory; only the production entry writes the final HTML. */
export async function buildPage(minify = true): Promise<string> {
  const [javascript, css] = await Promise.all([
    Bun.build({
      entrypoints: [join(root, "src/main.ts")],
      target: "browser",
      format: "iife",
      minify,
      splitting: false,
      sourcemap: "none",
    }),
    Bun.build({
      entrypoints: [join(root, "src/styles.css")],
      target: "browser",
      minify,
      sourcemap: "none",
    }),
  ]);
  for (const result of [javascript, css]) {
    if (!result.success) throw new Error(result.logs.map(String).join("\n"));
    if (result.outputs.length !== 1) throw new Error("单文件构建不允许额外资源或代码分块。");
  }
  const script = await javascript.outputs[0]!.text();
  const styles = await css.outputs[0]!.text();
  return assembleHtml(await Bun.file(join(root, "src/index.html")).text(), script, styles);
}

export function assembleHtml(template: string, javascript: string, css: string): string {
  const markers = ["<!-- APP_STYLES -->", "<!-- APP_SCRIPT -->"];
  for (const marker of markers) {
    if (template.split(marker).length !== 2)
      throw new Error(`HTML 模板必须且只能包含一个 ${marker}`);
  }
  // HTML raw-text elements end even when the closing tag is inside a JS/CSS string.
  // JS also escapes '<!--' to avoid the HTML parser's legacy script escape state.
  const script = javascript.replace(/<\//g, "<\\/").replace(/<!--/g, "\\x3c!--");
  const styles = css.replace(/<\/style/gi, "\\3c /style");
  const html = template
    .replace(markers[0]!, () => `<style>${styles}</style>`)
    .replace(markers[1]!, () => `<script>${script}</script>`);
  assertSelfContained(html);
  return html;
}

export function assertSelfContained(html: string): void {
  const violations: string[] = [];
  new HTMLRewriter()
    .on("*", {
      element(node) {
        for (const attribute of ["src", "href", "srcset", "poster", "action"]) {
          const value = node.getAttribute(attribute);
          if (value && !value.startsWith("#") && !value.startsWith("data:"))
            violations.push(`${node.tagName}[${attribute}]=${value}`);
        }
      },
    })
    .transform(html);
  if (violations.length) throw new Error(`HTML 引用了外部资源：${violations.join(", ")}`);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map((match) => match[1] ?? "")
    .join("\n");
  const urls = [...styles.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)];
  const hasExternalUrl = urls.some(
    (match) => !/^(data:|#)/i.test(match[1] ?? match[2] ?? match[3] ?? ""),
  );
  if (/@import\b/i.test(styles) || hasExternalUrl) throw new Error("CSS 不允许外部资源引用。");
}
