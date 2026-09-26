export type Base64Variant = "standard" | "url";

export function encodeBase64(text: string, variant: Base64Variant = "standard"): string {
  // TextEncoder replaces lone surrogates; reject them to avoid silent data loss.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new Error("文本包含不完整的 Unicode 字符，请检查后重试。");
  }
  const bytes = new TextEncoder().encode(text);
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  }
  const encoded = btoa(chunks.join(""));
  return variant === "url"
    ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : encoded;
}

export function decodeBase64(source: string, variant: Base64Variant = "standard"): string {
  const compact = source.replace(/[\t\n\r\f ]/g, "");
  const alphabet = variant === "url" ? /^[A-Za-z0-9_-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!alphabet.test(compact)) throw new Error("编码包含非法字符，或与所选 Base64 类型不匹配。");
  const payload = compact.replace(/=+$/, "");
  const padding = compact.length - payload.length;
  const remainder = payload.length % 4;
  if (
    remainder === 1 ||
    (padding > 0 && (compact.length % 4 !== 0 || padding !== (4 - remainder) % 4))
  ) {
    throw new Error("Base64 长度或末尾的 = 填充不正确。");
  }
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - remainder) % 4));
  // Reject non-zero unused bits instead of silently accepting a non-canonical value.
  if (btoa(binary).replace(/=+$/, "") !== normalized)
    throw new Error("Base64 末尾包含无效的填充位。");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("解码结果不是有效的 UTF-8 文本，可能是二进制文件。");
  }
}
