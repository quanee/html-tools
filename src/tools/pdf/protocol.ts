import type { ManifestEntry, Progress, SplitOptions } from "./options";
export type Request =
  | { type: "inspect"; id: number; file: File }
  | { type: "split"; id: number; file: File; options: SplitOptions }
  | { type: "ack"; id: number; sequence: number };
export type Response =
  | { type: "metadata"; id: number; pages: number }
  | { type: "progress"; id: number; progress: Progress }
  | { type: "chunk"; id: number; sequence: number; buffer: ArrayBuffer }
  | { type: "done"; id: number; manifest: ManifestEntry[] }
  | { type: "error"; id: number; message: string };
