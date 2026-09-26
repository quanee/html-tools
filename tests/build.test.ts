import { describe, expect, test } from "bun:test";
import { assembleHtml, assertSelfContained, buildPage } from "../scripts/page";

const template =
  "<!doctype html><html><head><!-- APP_STYLES --></head><body><!-- APP_SCRIPT --></body></html>";

describe("standalone build", () => {
  test("bundles real source into one self-contained HTML", async () => {
    const html = await buildPage();
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("JSON 工具");
    expect(html).toContain("文本对比");
    expect(html).toContain('href="#diff"');
    expect(html).not.toContain("<!-- APP_");
    expect(html.match(/<script>/g)?.length).toBe(1);
    expect(html.match(/<style>/g)?.length).toBe(1);
    expect(() => assertSelfContained(html)).not.toThrow();
  });
  test("escapes raw-text closing tags and preserves replacement-dollar literals", () => {
    const html = assembleHtml(
      template,
      'console.log("</script><!--<script>$&");',
      'p::after { content: "</style>" }',
    );
    expect(html).toContain("<\\/script>\\x3c!--<script>$&");
    expect(html.match(/<\/script>/g)?.length).toBe(1);
    expect(html.match(/<\/style>/g)?.length).toBe(1);
  });
  test.each([
    '<script src="app.js"></script>',
    '<link rel="stylesheet" href="https://example.com/style.css">',
    '<img src="./photo.png">',
    '<style>@import "style.css";</style>',
    "<style>body{background:url(https://example.com/pic.png)}</style>",
  ])("rejects external references %s", (fragment) => {
    expect(() => assertSelfContained(fragment)).toThrow();
  });
  test("allows embedded resources and fragment links", () => {
    expect(() =>
      assertSelfContained(
        '<img src="data:image/png;base64,AA=="><a href="#json">JSON</a><style>p{background:url("data:image/png;base64,AA==")}</style>',
      ),
    ).not.toThrow();
  });
  test("requires unique template markers", () => {
    expect(() => assembleHtml("", "", "")).toThrow();
    expect(() => assembleHtml(template + "<!-- APP_SCRIPT -->", "", "")).toThrow();
  });
});
