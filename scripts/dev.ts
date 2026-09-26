import { buildPage } from "./page";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  async fetch(request) {
    if (new URL(request.url).pathname !== "/") return new Response("Not found", { status: 404 });
    try {
      return new Response(await buildPage(false), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    } catch (error) {
      console.error(error);
      return new Response(String(error), {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
});
console.log(`开发预览：${server.url}（修改源码后刷新页面）`);
