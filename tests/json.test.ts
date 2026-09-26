import { describe, expect, test } from "bun:test";
import { transformJson } from "../src/tools/json/convert";

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
