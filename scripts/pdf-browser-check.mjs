// Run after bun scripts/pdf-fixtures.ts and bun run build.
// Uses the repository's existing optional Playwright installation.
import { chromium } from "../.cache/ui-check/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { Unzip } from "fflate";

const directory = resolve(".cache/pdf-check");
const benchmark = process.argv.includes("--large");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  acceptDownloads: true,
});
await context.setOffline(true);
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [],
  external = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => {
  if (/^https?:/.test(request.url())) external.push(request.url());
});
await page.goto(pathToFileURL(resolve("dist/index.html")).href + "#pdf");
await page.evaluate(() => {
  window.pdfTicks = { count: 0, maxGap: 0, last: performance.now() };
  setInterval(() => {
    const now = performance.now();
    window.pdfTicks.maxGap = Math.max(window.pdfTicks.maxGap, now - window.pdfTicks.last);
    window.pdfTicks.count++;
    window.pdfTicks.last = now;
  }, 25);
});
const status = page.locator("#pdf-status");
const start = page.locator("#pdf-start");
const choose = async (name) => {
  await page.locator("#pdf-file").setInputFiles(resolve(directory, name));
  await page.waitForFunction(() => document.querySelector("#pdf-cancel").hidden);
  assert.match(await status.textContent(), /文件已就绪/);
};
async function verifyZip(path, large, expected, maxBytes) {
  let files = 0,
    pages = 0,
    tasks = [];
  const widths = [];
  let ordinal = 0;
  const unzip = new Unzip((file) => {
    const index = ordinal++;
    widths[index] = [];
    assert.equal(file.compression, 0);
    const chunks = [];
    file.ondata = (error, data, final) => {
      if (error) throw error;
      chunks.push(data);
      if (final)
        tasks.push(
          (async () => {
            const bytes = Buffer.concat(chunks);
            if (maxBytes) assert.ok(bytes.length <= maxBytes);
            const pdf = await PDFDocument.load(bytes);
            const range = /pages-(\d+)(?:-(\d+))?\.pdf$/.exec(file.name);
            assert.ok(range);
            const begin = Number(range[1]);
            const end = Number(range[2] || range[1]);
            assert.equal(pdf.getPageCount(), end - begin + 1);
            pdf.getPages().forEach((p, i) => {
              assert.equal(p.getWidth(), (large ? 600 : 300) + begin - 1 + i);
              if (!large) assert.equal(p.getRotation().angle, ((begin - 1 + i) % 4) * 90);
              assert.ok(p.node.Contents());
              widths[index].push(p.getWidth());
            });
            pages += pdf.getPageCount();
            files++;
          })(),
        );
    };
    file.start();
  });
  for await (const chunk of createReadStream(path, { highWaterMark: 256 * 1024 })) {
    unzip.push(new Uint8Array(chunk), false);
    await Promise.all(tasks);
    tasks = [];
  }
  unzip.push(new Uint8Array(), true);
  await Promise.all(tasks);
  if (expected) assert.deepEqual(widths.flat(), expected);
  return { files, pages };
}
async function run(mode, large = false, expected, limit) {
  await page.locator("#pdf-mode").selectOption(mode);
  await page.evaluate(() => {
    window.pdfTicks.maxGap = 0;
    window.pdfTicks.count = 0;
  });
  const began = Date.now();
  const downloadEvent = page.waitForEvent("download", { timeout: 600000 });
  await start.click();
  const download = await downloadEvent;
  const elapsedMs = Date.now() - began;
  assert.equal(await download.failure(), null);
  const path = await download.path();
  const zipBytes = (await stat(path)).size;
  const verified = await verifyZip(path, large, expected, limit);
  const ticks = await page.evaluate(() => window.pdfTicks);
  const heap = await page.evaluate(() =>
    performance.memory
      ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize }
      : null,
  );
  assert.match(await status.textContent(), /分割完成/);
  assert.equal(await page.locator("#pdf-results li").count(), verified.files);
  await download.delete();
  return {
    mode,
    elapsedMs,
    zipBytes,
    ...verified,
    ticks: ticks.count,
    maxUiGapMs: ticks.maxGap,
    mainThreadHeap: heap,
  };
}
try {
  await choose("sample.pdf");
  results.push(await run("pages", false, [300, 301, 302, 303, 304, 305, 306]));
  const redownloadEvent = page.waitForEvent("download");
  await page.locator("#pdf-download").click();
  const redownload = await redownloadEvent;
  assert.equal(await redownload.failure(), null);
  await redownload.delete();
  await page.locator("#pdf-mode").selectOption("count");
  await page.locator("#pdf-count").fill("3");
  results.push(await run("count", false, [300, 301, 302, 303, 304, 305, 306]));
  await page.locator("#pdf-mode").selectOption("ranges");
  await page.locator("#pdf-ranges").fill("4-6，1-3,3,7");
  results.push(await run("ranges", false, [303, 304, 305, 300, 301, 302, 302, 306]));
  await page.locator("#pdf-ranges").fill("1,,2");
  await start.click();
  assert.match(await status.textContent(), /范围格式无效/);
  await page.locator("#pdf-mode").selectOption("size");
  results.push(await run("size", false, [300, 301, 302, 303, 304, 305, 306], 10_000_000));
  for (const [width, height] of [
    [1366, 768],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: resolve(directory, `pdf-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator("#pdf-file").setInputFiles(resolve(directory, "invalid.pdf"));
  await page.waitForFunction(() => document.querySelector("#pdf-cancel").hidden);
  assert.match(await status.textContent(), /无效或已损坏/);
  await choose("sample.pdf");
  for (const id of ["json", "timestamp", "base64", "diff", "unicode"]) {
    await page.locator(`.tool-nav [href="#${id}"]`).click();
    await page.locator(`#panel-${id}`).waitFor({ state: "visible" });
  }
  await page.locator('.tool-nav [href="#pdf"]').click();
  await page.locator("#panel-pdf").waitFor({ state: "visible" });
  assert.match(await page.locator("#pdf-info").textContent(), /sample.pdf/);

  if (benchmark)
    for (const mb of [100, 300, 500]) {
      const loadStart = Date.now();
      await choose(`scan-${mb}mb.pdf`);
      const inspectMs = Date.now() - loadStart;
      const totalPages = Number(
        (await page.locator("#pdf-info").textContent()).match(/(\d+) 页/)[1],
      );
      // Cancellation during parse and retry; switching tools must not cancel a live task.
      await start.click();
      await page.locator("#pdf-cancel").click();
      assert.match(await status.textContent(), /已取消/);
      await page.locator("#pdf-mode").selectOption("size");
      await page.locator("#pdf-size").fill("0.01");
      let unexpected = 0;
      const onDownload = () => unexpected++;
      page.on("download", onDownload);
      await start.click();
      await page.waitForFunction(() => document.querySelector("#pdf-cancel").hidden, {
        timeout: 120000,
      });
      assert.match(await status.textContent(), /第 1 页.*超过上限/);
      assert.equal(unexpected, 0);
      page.off("download", onDownload);
      await page.locator("#pdf-size").fill("10");
      await page.locator("#pdf-mode").selectOption("count");
      await page.locator("#pdf-count").fill("10");
      const order = Array.from({ length: totalPages }, (_, i) => 600 + i);
      for (const mode of ["pages", "count", "ranges", "size"]) {
        let expected = order;
        if (mode === "ranges") {
          await page.locator("#pdf-mode").selectOption("ranges");
          const groups = [];
          expected = [];
          for (let begin = 1; begin <= totalPages; begin += 10)
            groups.push([begin, Math.min(begin + 9, totalPages)]);
          groups.reverse();
          groups.push([1, 1]);
          await page.locator("#pdf-ranges").fill(groups.map(([a, b]) => `${a}-${b}`).join(","));
          for (const [a, b] of groups) for (let i = a; i <= b; i++) expected.push(599 + i);
        }
        const result = await run(mode, true, expected, mode === "size" ? 10_000_000 : undefined);
        results.push({
          sourceMB: mb,
          sourceBytes: (await stat(resolve(directory, `scan-${mb}mb.pdf`))).size,
          inspectMs,
          ...result,
        });
        console.log(JSON.stringify(results.at(-1)));
        await writeFile(
          resolve(directory, "browser-results.json"),
          JSON.stringify({ results, errors, external }, null, 2),
        );
      }
    }
  await page.locator("#pdf-clear").click();
  assert.equal(await page.locator("#pdf-download").isVisible(), false);
  assert.equal(await start.isDisabled(), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(
    resolve(directory, "browser-results.json"),
    JSON.stringify({ results, errors, external }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, results, errors, external }));
} finally {
  await browser.close();
}
