import { chromium } from "../.cache/ui-check/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
await context.setOffline(true);
await context.addInitScript(() => {
  const live = new Set();
  const workers = new Set();
  window.pdfAudit = { live, workers, stale: null, failResult: false };
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    if (blob.type === "application/zip" && window.pdfAudit.failResult)
      throw new Error("Injected allocation failure");
    const url = create(blob);
    live.add(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    live.delete(url);
    revoke(url);
  };
  const OriginalWorker = Worker;
  window.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args);
      workers.add(this);
    }
    postMessage(message, ...args) {
      if (message.type !== "ack") this.auditId = message.id;
      return super.postMessage(message, ...args);
    }
    terminate() {
      window.pdfAudit.stale = { handler: this.onmessage, id: this.auditId };
      workers.delete(this);
      super.terminate();
    }
  };
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const records = [];
const status = page.locator("#pdf-status");
const choose = async (file = "sample.pdf") => {
  await page.locator("#pdf-file").setInputFiles(resolve(".cache/pdf-check", file));
  await page.waitForFunction(() => document.querySelector("#pdf-cancel").hidden);
  assert.match(await status.textContent(), /文件已就绪/);
};
const snapshot = async (label) => {
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const state = await page.evaluate(() => ({
    urls: pdfAudit.live.size,
    workers: pdfAudit.workers.size,
  }));
  records.push({ label, ...state, heap });
  return state;
};
try {
  await page.goto(pathToFileURL(resolve("dist/index.html")).href + "#pdf");
  await choose();
  assert.deepEqual(await snapshot("inspection"), { urls: 0, workers: 0 });
  // Simulate a late message from a worker terminated during inspection.
  await page.evaluate(() =>
    pdfAudit.stale.handler({ data: { type: "error", id: pdfAudit.stale.id, message: "STALE" } }),
  );
  assert.match(await status.textContent(), /文件已就绪/);
  await page.evaluate(() => {
    pdfAudit.failResult = true;
  });
  await page.locator("#pdf-start").click();
  await page.waitForFunction(() => document.querySelector("#pdf-cancel").hidden);
  assert.match(await status.textContent(), /无法保存处理结果/);
  assert.deepEqual(await snapshot("allocation-failure"), { urls: 0, workers: 0 });
  await page.evaluate(() => {
    pdfAudit.failResult = false;
  });
  for (let iteration = 0; iteration < 3; iteration++) {
    const event = page.waitForEvent("download");
    await page.locator("#pdf-start").click();
    const download = await event;
    assert.equal(await download.failure(), null);
    await download.delete();
    assert.deepEqual(await snapshot(`success-${iteration}`), { urls: 1, workers: 0 });
  }
  await page.locator("#pdf-mode").selectOption("count");
  assert.deepEqual(await snapshot("setting-change"), { urls: 0, workers: 0 });
  await choose("scan-500mb.pdf");
  await page.locator("#pdf-mode").selectOption("size");
  await page.locator("#pdf-start").click();
  await page.waitForFunction(() =>
    document.querySelector("#pdf-status").textContent.includes("检查每页"),
  );
  const began = Date.now();
  await page.locator("#pdf-cancel").click();
  records.push({ label: "cancel-500mb-preflight", elapsedMs: Date.now() - began });
  assert.match(await status.textContent(), /已取消/);
  assert.deepEqual(await snapshot("cancelled"), { urls: 0, workers: 0 });
  // Retry while navigating away; output must still arrive.
  await page.locator("#pdf-mode").selectOption("count");
  const event = page.waitForEvent("download", { timeout: 120000 });
  await page.locator("#pdf-start").click();
  await page.locator('.tool-nav [href="#json"]').click();
  const download = await event;
  assert.equal(await download.failure(), null);
  await download.delete();
  await page.locator('.tool-nav [href="#pdf"]').click();
  await page.locator("#panel-pdf").waitFor({ state: "visible" });
  assert.match(await status.textContent(), /分割完成/);
  assert.deepEqual(await snapshot("500mb-retry-navigation"), { urls: 1, workers: 0 });
  await choose();
  assert.deepEqual(await snapshot("replace-large-file"), { urls: 0, workers: 0 });
  await page.locator("#pdf-start").click();
  await page.locator("#pdf-clear").click();
  assert.deepEqual(await snapshot("clear"), { urls: 0, workers: 0 });
  assert.equal(await page.locator("#pdf-start").isDisabled(), true);
  await page.reload();
  assert.match(await page.locator("#pdf-info").textContent(), /尚未选择/);
  for (const id of ["json", "base64", "unicode", "diff", "timestamp"]) {
    await page.locator(`.tool-nav [href="#${id}"]`).click();
    const panel = page.locator(`#panel-${id}`);
    await panel.waitFor({ state: "visible" });
    if (id === "timestamp") {
      await panel.locator('[data-action="now-timestamp"]').click();
      await panel.locator('[data-action="to-date"]').click();
      assert.ok((await panel.locator("#timestamp-status").textContent()).length);
    } else {
      await panel.locator('[data-action="sample"]').click();
      if (id === "diff") {
        await page.waitForFunction(() => document.querySelector("#diff-rows").children.length > 0);
      } else {
        const input = panel.locator("textarea");
        const before = await input.inputValue();
        if (id === "json") {
          await panel.locator('[data-action="compact"]').click();
          assert.ok((await input.inputValue()).length);
        } else {
          await panel.locator('[data-action="encode"]').click();
          await panel.locator('[data-action="decode"]').click();
          assert.equal(await input.inputValue(), before);
        }
      }
    }
  }
  records.push({ label: "five-tool-basic-regression", passed: true });
  await writeFile(
    resolve(".cache/pdf-check/lifecycle-results.json"),
    JSON.stringify(records, null, 2),
  );
  console.log(JSON.stringify({ ok: true, records }));
} finally {
  await browser.close();
}
