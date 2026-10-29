import { describe, expect, test } from "bun:test";
import { decodeUnicode, encodeUnicode } from "../src/tools/unicode/convert";

describe("Unicode escapes", () => {
  const samples = [
    "",
    "你好，世界",
    "Hello, Unicode! 123 ~",
    "😀👩‍💻🇨🇳",
    "e\u0301é",
    " \t\n\r\n\r ",
    "\0\b\f\v\u001f\u007f\u0080",
    "\uFEFFBOM\uFEFF",
    "\\",
    "\\u4f60\\u597d",
    '"\\u005cu4f60" \\n \\t \\u{1f600} \\U0041',
    "\ud7ff\ue000\uffff\ud800\udc00\udbff\udfff",
    "中文 A1😀e\u0301\n\\u4f60".repeat(10000),
  ];

  for (const scope of ["all", "preserve-ascii"] as const) {
    test.each(samples)(`roundtrips ${scope} (%#. case)`, (source) => {
      expect(decodeUnicode(encodeUnicode(source, scope))).toBe(source);
    });
  }

  test("defaults to lowercase four-digit UTF-16 escapes for every code unit", () => {
    expect(encodeUnicode("A你")).toBe("\\u0041\\u4f60");
    expect(encodeUnicode("😀")).toBe("\\ud83d\\ude00");
    expect(encodeUnicode(" \t\n\r\0\uFEFF")).toBe("\\u0020\\u0009\\u000a\\u000d\\u0000\\ufeff");
    expect(encodeUnicode("e\u0301é")).toBe("\\u0065\\u0301\\u00e9");
  });

  test("preserves exactly printable ASCII except backslash", () => {
    const ascii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 0x20)).join(
      "",
    );
    expect(encodeUnicode(ascii, "preserve-ascii")).toBe(ascii.replace("\\", "\\u005c"));
    expect(encodeUnicode("\u001f !~\u007f\u0080你😀\n\t", "preserve-ascii")).toBe(
      "\\u001f !~\\u007f\\u0080\\u4f60\\ud83d\\ude00\\u000a\\u0009",
    );
    expect(encodeUnicode("\\u4f60", "preserve-ascii")).toBe("\\u005cu4f60");
  });

  test("decodes uppercase and lowercase hex mixed with ordinary text", () => {
    expect(decodeUnicode("Hello \\u4F60\\u597d 123 \\uD83D\\ude00！")).toBe("Hello 你好 123 😀！");
    expect(decodeUnicode("\\u0041F")).toBe("AF");
    expect(decodeUnicode("\\ud800\\udc00\\udbff\\udfff")).toBe("\ud800\udc00\udbff\udfff");
  });

  test("decodes one layer without rescanning output or applying JSON escape rules", () => {
    expect(decodeUnicode("\\u005cu4f60")).toBe("\\u4f60");
    expect(decodeUnicode("\\u005c\\u0075\\u0034\\u0066\\u0033\\u0030")).toBe("\\u4f30");
    expect(decodeUnicode("\\u005cu12G4")).toBe("\\u12G4");
    expect(decodeUnicode("\\\\u0041")).toBe("\\A");
    expect(decodeUnicode(decodeUnicode("\\u005cu4f60"))).toBe("你");
  });

  test("keeps quotes, non-Unicode escapes, whitespace, BOM and text unchanged", () => {
    const source = ' \uFEFF"\\u4f60" \\n\\t\\r\\b\\f\\/\\"\\U0041\\x41 &#x4f60; e\u0301\r\n\\ ';
    expect(decodeUnicode(source)).toBe(source.replace("\\u4f60", "你"));
    expect(decodeUnicode("\\ufeff\\u0000\\u000d\\u000a")).toBe("\uFEFF\0\r\n");
    expect(encodeUnicode("")).toBe("");
    expect(decodeUnicode("")).toBe("");
  });

  test.each([
    "\\u",
    "\\u0",
    "\\u00",
    "\\u004",
    "\\u12G4",
    "\\u-001",
    "\\u+041",
    "\\u 041",
    "\\u0x41",
    "\\u００４１",
    "\\u00\n1",
    "\\u{1f600}",
    "正常文字\\u4f60\\u12",
  ])("rejects malformed escape (%#. case)", (source) => {
    expect(() => decodeUnicode(source)).toThrow("四位十六进制数字");
  });

  test.each([
    "\ud800",
    "\udbff",
    "\udc00",
    "\udfff",
    "\ud800A",
    "A\udfff",
    "\udc00\ud800",
    "\ud800\ud800\udc00",
    "😀\udc00",
    "\ud800\\udc00",
  ])("rejects lone surrogate input in both encoding scopes (%#. case)", (source) => {
    expect(() => encodeUnicode(source)).toThrow("孤立代理项");
    expect(() => encodeUnicode(source, "preserve-ascii")).toThrow("孤立代理项");
  });

  test.each([
    "\\ud800",
    "\\udbff",
    "\\udc00",
    "\\udfff",
    "\\ud800A",
    "\\ud800 \\udc00",
    "\\udc00\\ud800",
    "\\ud800\\ud800\\udc00",
    "\\ud83d\\ude00\\udc00",
    "\ud800",
    "\udc00",
    "\ud800\\u0041",
    "\\ud800\ud800",
  ])("rejects lone surrogates in the decoded result (%#. case)", (source) => {
    expect(() => decodeUnicode(source)).toThrow("孤立代理项");
  });

  test("validates surrogate pairs after decoding escaped and literal code units together", () => {
    expect(decodeUnicode("\ud83d\\ude00")).toBe("😀");
    expect(decodeUnicode("\\ud83d\ude00")).toBe("😀");
    expect(decodeUnicode("😀")).toBe("😀");
  });
});
