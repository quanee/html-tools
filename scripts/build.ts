import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildPage, root } from "./page";

const html = await buildPage();
const destination = join(root, "dist");
await mkdir(destination, { recursive: true });
const unexpected = (await readdir(destination)).filter((name) => name !== "index.html");
if (unexpected.length) throw new Error(`dist 内存在额外文件，请先移走：${unexpected.join(", ")}`);
await Bun.write(join(destination, "index.html"), html);
console.log(
  `已构建 dist/index.html · ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB · 无外部依赖`,
);
