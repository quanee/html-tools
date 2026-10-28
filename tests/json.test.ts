import { describe, expect, test } from "bun:test";
import { escapeJson, transformJson, unescapeJson } from "../src/tools/json/convert";

describe("JSON text-preserving transformations", () => {
  test("formats nested data with selectable indentation", () => {
    expect(transformJson('{"a":[1,{}],"b":[]}', "format")).toBe(
      '{\n  "a": [\n    1,\n    {}\n  ],\n  "b": []\n}',
    );
    expect(transformJson('{"a":1}', "format", "4")).toBe('{\n    "a": 1\n}');
    expect(transformJson('{"a":1}', "format", "tab")).toBe('{\n\t"a": 1\n}');
  });
  test("preserves large numbers, key order, duplicate keys and escape spelling", () => {
    const compact =
      '{"10":9007199254740993,"2":1e400,"x":-0,"x":1.2300,"s":"a \\\" b \\u4e2d \\\\ / </script>"}';
    expect(transformJson(transformJson(compact, "format"), "compact")).toBe(compact);
  });
  test.each(["null", "true", "false", "123", '" { [, : ] } "', "{}", "[]"])(
    "accepts %s",
    (source) => {
      expect(transformJson(` \n ${source} \t `, "compact")).toBe(source);
    },
  );
  test.each([
    "",
    " ",
    '{"a":1,}',
    "[1,]",
    "// comment\n{}",
    "undefined",
    "NaN",
    "01",
    "{a:1}",
    "{} {}",
    '"\n"',
  ])("rejects invalid JSON %s", (source) => {
    expect(() => transformJson(source, "format")).toThrow();
  });
});

describe("JSON string escaping", () => {
  test("escapes quotes without adding outer quotes", () => {
    expect(escapeJson('{"a":1}')).toBe(String.raw`{\"a\":1}`);
  });

  test("escapes backslashes and control characters while keeping Unicode readable", () => {
    expect(escapeJson('"你好 👋"\\\n\r\t\b\f\u0000')).toBe(
      '\\"你好 👋\\"\\\\\\n\\r\\t\\b\\f\\u0000',
    );
  });

  test("accepts escaped contents and complete JSON strings", () => {
    expect(unescapeJson(String.raw`{\"a\":1}`)).toBe('{"a":1}');
    expect(unescapeJson(String.raw`"{\"a\":1}"`)).toBe('{"a":1}');
    expect(unescapeJson(' \n "hello" \t ')).toBe("hello");
    expect(unescapeJson('""')).toBe("");
  });

  test("decodes JSON escapes including Unicode and escaped forward slashes", () => {
    expect(unescapeJson(String.raw`\"\\\/\n\r\t\b\f\u0000\u4e2d\ud83d\udc4b`)).toBe(
      '"\\/\n\r\t\b\f\u0000中👋',
    );
  });

  test("handles plain text and preserves unquoted spaces", () => {
    expect(escapeJson("  你好 👋  ")).toBe("  你好 👋  ");
    expect(unescapeJson("  你好 👋  ")).toBe("  你好 👋  ");
    expect(escapeJson("   ")).toBe("   ");
    expect(unescapeJson("   ")).toBe("   ");
    expect(escapeJson("\n\t")).toBe(String.raw`\n\t`);
    expect(unescapeJson(String.raw`\n\t`)).toBe("\n\t");
    expect(unescapeJson("9007199254740993")).toBe("9007199254740993");
    expect(unescapeJson("null")).toBe("null");
  });

  test.each([
    ' \r\n {"10":9007199254740993,"2":1e400,"x":-0,"x":1.2300} \t ',
    String.raw`{"message":"line\nquoted \"text\"","path":"C:\\tmp","u":"\u4e2d"}`,
    '{\n  "name": "你好，世界 👋",\n  "items": [1, 2]\n}\n',
    ' "plain text" ',
    'not JSON: "hello" \\ world\n\t',
    "\ud800",
  ])("roundtrips text without parsing its contents: %j", (source) => {
    expect(unescapeJson(escapeJson(source))).toBe(source);
  });

  test("removes only one layer per action", () => {
    const source = '{"text":"你好"}';
    const once = escapeJson(source);
    const twice = escapeJson(once);
    expect(twice).not.toBe(once);
    expect(unescapeJson(twice)).toBe(once);
    expect(unescapeJson(unescapeJson(twice))).toBe(source);
    expect(unescapeJson(String.raw`\\n`)).toBe(String.raw`\n`);
    expect(unescapeJson(String.raw`"\\u4e2d"`)).toBe(String.raw`\u4e2d`);
  });

  test("rejects empty input with actionable messages", () => {
    expect(() => escapeJson("")).toThrow("请输入需要转义的文本。");
    expect(() => unescapeJson("")).toThrow("请输入需要去转义的文本。");
  });

  test.each([
    String.raw`\q`,
    String.raw`\u123`,
    String.raw`\uZZZZ`,
    String.raw`\x41`,
    "trailing\\",
    'unescaped "quote"',
    '{"a":1}',
    '"unterminated',
    '"a" "b"',
    String.raw`"bad\q"`,
    "line\nbreak",
    "\t",
    '"\n"',
    "\u0000",
  ])("rejects invalid escaped input %j", (source) => {
    expect(() => unescapeJson(source)).toThrow("转义格式不正确");
  });
});
