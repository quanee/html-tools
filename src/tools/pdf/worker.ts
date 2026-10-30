import { createArchive } from "./archive";
import { loadPdf, splitPdf } from "./split";
import type { Request, Response } from "./protocol";

const scope = self as unknown as {
  onmessage: (event: MessageEvent<Request>) => void;
  postMessage: (message: Response, transfer?: Transferable[]) => void;
};
let active = false;
let acknowledgement: { id: number; sequence: number; resolve: () => void } | undefined;
scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "ack") {
    if (acknowledgement?.id === request.id && acknowledgement.sequence === request.sequence) {
      acknowledgement.resolve();
      acknowledgement = undefined;
    }
    return;
  }
  if (active) return;
  active = true;
  void run(request);
};

async function run(request: Exclude<Request, { type: "ack" }>) {
  const id = request.id;
  let archive: ReturnType<typeof createArchive> | undefined;
  try {
    scope.postMessage({ type: "progress", id, progress: { phase: "read", current: 0, total: 1 } });
    const source = await loadPdf(await request.file.arrayBuffer());
    scope.postMessage({ type: "metadata", id, pages: source.getPageCount() });
    if (request.type === "inspect") return;
    let sequence = 0;
    archive = createArchive(async (chunk) => {
      const buffer = chunk.buffer as ArrayBuffer;
      await new Promise<void>((resolve) => {
        acknowledgement = { id, sequence: ++sequence, resolve };
        scope.postMessage({ type: "chunk", id, sequence, buffer }, [buffer]);
      });
    });
    const manifest = await splitPdf(
      source,
      request.options,
      request.file.name,
      (entry, bytes) => archive!.add(entry.name, bytes),
      (progress) => scope.postMessage({ type: "progress", id, progress }),
    );
    scope.postMessage({ type: "progress", id, progress: { phase: "zip", current: 0, total: 1 } });
    await archive.finish();
    scope.postMessage({ type: "done", id, manifest });
  } catch (error) {
    scope.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : "PDF 处理失败，请重试。",
    });
  } finally {
    archive?.terminate();
    acknowledgement = undefined;
    active = false;
  }
}
