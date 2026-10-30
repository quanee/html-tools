import { Zip, ZipPassThrough } from "fflate";

export function archiveBudget(current: number, count: number, name: string, bytes: number): number {
  const length = new TextEncoder().encode(name).length;
  const next = current + bytes + 92 + length * 2;
  // Reserve ZIP32 sentinel values; no ZIP64 output is supported by fflate.
  if (count >= 65534 || bytes >= 0xffffffff || next >= 0xffffffff || length > 65535)
    throw new Error("输出超过 ZIP32 容量限制（约 4 GB 或 65,534 份），请减少输出页数或分批处理。");
  return next;
}

/** fflate callbacks are synchronous. Drain each bounded push before making the next. */
export function createArchive(send: (chunk: Uint8Array) => Promise<void>) {
  let pending: Uint8Array[] = [];
  let failure: Error | undefined;
  let budget = 22;
  let count = 0;
  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else if (data.length) pending.push(data);
  });
  const drain = async () => {
    if (failure) throw failure;
    const chunks = pending;
    pending = [];
    for (const chunk of chunks) await send(chunk);
  };
  return {
    async add(name: string, bytes: Uint8Array) {
      budget = archiveBudget(budget, count, name, bytes.length);
      count++;
      const file = new ZipPassThrough(name);
      zip.add(file);
      await drain();
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        // Copy only this chunk: transferring a subarray would detach the entire PDF.
        file.push(bytes.slice(offset, offset + chunkSize), offset + chunkSize >= bytes.length);
        await drain();
      }
    },
    async finish() {
      zip.end();
      await drain();
    },
    terminate() {
      pending = [];
      zip.terminate();
    },
  };
}
