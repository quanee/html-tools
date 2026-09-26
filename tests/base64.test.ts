import { describe, expect, test } from "bun:test";
import { decodeBase64, encodeBase64 } from "../src/tools/base64/convert";

describe("UTF-8 Base64", () => {
  test.each([
    "",
    "f",
    "fo",
    "foo",
    "hello",
    "你好，世界 👋",
    "\uFEFFBOM",
    "\0\r\n",
    "文本".repeat(10000),
  ])("roundtrips UTF-8 (%#. case)", (source) => {
    for (const variant of ["standard", "url"] as const) {
      expect(decodeBase64(encodeBase64(source, variant), variant)).toBe(source);
    }
  });
  test("uses standard padding and URL-safe alphabet", () => {
    expect(encodeBase64("f")).toBe("Zg==");
    expect(encodeBase64("f", "url")).toBe("Zg");
    expect(encodeBase64("😀?", "url")).toBe("8J-YgD8");
    expect(decodeBase64("8J+YgD8=")).toBe("😀?");
  });
  test("accepts omitted padding and ASCII whitespace", () => {
    expect(decodeBase64(" \tZ g\r\n==\f")).toBe("f");
    expect(decodeBase64("Zg")).toBe("f");
    expect(decodeBase64("Zm8")).toBe("fo");
    expect(decodeBase64("Zg==", "url")).toBe("f");
  });
  test.each([
    "A",
    "A===",
    "Z=g=",
    "Zg=",
    "Zg===",
    "====",
    "Zm9v=",
    "Zm$8",
    "Zh==",
    "Zm9=",
    "8J-YgD8",
    "Zg\u200B",
  ])("rejects invalid standard Base64 %s", (value) => {
    expect(() => decodeBase64(value)).toThrow();
  });
  test("rejects standard characters in URL mode", () => {
    expect(() => decodeBase64("8J+YgD8=", "url")).toThrow();
  });
  test.each(["/w==", "wK8=", "7aCA", "8J8="])("rejects non-UTF-8 bytes %s", (value) => {
    expect(() => decodeBase64(value)).toThrow("UTF-8");
  });
  test("does not silently replace lone surrogates", () => {
    expect(() => encodeBase64("\uD800")).toThrow();
    expect(() => encodeBase64("\uDC00")).toThrow();
    expect(encodeBase64("😀")).toBe("8J+YgA==");
  });
});
