import { describe, expect, test } from "bun:test";
import {
  formatDate,
  formatTimestamp,
  parseDate,
  parseTimestamp,
} from "../src/tools/timestamp/convert";

describe("exact timestamp units", () => {
  test("parses zero, signs, milliseconds and nanoseconds", () => {
    expect(parseTimestamp("0", "milliseconds")).toBe(0n);
    expect(parseTimestamp("-0.000000001", "seconds")).toBe(-1n);
    expect(parseTimestamp("+001.000001", "milliseconds")).toBe(1_000_001n);
    expect(parseTimestamp("1727222400123456789", "nanoseconds")).toBe(1_727_222_400_123_456_789n);
  });
  test("roundtrips all units without loss", () => {
    const values = [
      0n,
      1n,
      -1n,
      -1_000_001n,
      1_727_222_400_123_456_789n,
      -1_727_222_400_123_456_789n,
      8_640_000_000_000_000_000_000n,
    ];
    for (const value of values) {
      for (const unit of ["seconds", "milliseconds", "nanoseconds"] as const) {
        expect(parseTimestamp(formatTimestamp(value, unit), unit)).toBe(value);
      }
    }
  });
  test("rejects unsupported precision and malformed values", () => {
    for (const input of ["", "1e3", "NaN", "0x10", "1.", ".1", "1,000", "--1"])
      expect(() => parseTimestamp(input, "seconds")).toThrow();
    expect(() => parseTimestamp("0.0000000001", "seconds")).toThrow();
    expect(() => parseTimestamp("0.0000001", "milliseconds")).toThrow();
    expect(() => parseTimestamp("1.0", "nanoseconds")).toThrow();
    expect(() => parseTimestamp("8640000000000000000001", "nanoseconds")).toThrow();
  });
});

describe("date parsing and formatting", () => {
  test("epoch and pre-epoch nanoseconds", () => {
    expect(formatDate(0n, "utc")).toBe("1970-01-01T00:00:00.000000000Z");
    expect(formatDate(-1n, "utc")).toBe("1969-12-31T23:59:59.999999999Z");
    expect(parseDate("1969-12-31 23:59:59.999999999Z", "utc")).toBe(-1n);
  });
  test("explicit offsets override selected timezone", () => {
    expect(parseDate("1970-01-01 08:00:00+08:00", "local")).toBe(0n);
    expect(parseDate("1969-12-31T18:30:00-05:30", "utc")).toBe(0n);
    expect(parseDate("1970-01-01T00:00:00.1Z", "local")).toBe(100_000_000n);
  });
  test("preserves leap dates, year 0-99, expanded years and date limits", () => {
    for (const text of [
      "0000-02-29T00:00:00.000000001Z",
      "0099-01-01T00:00:00.000000000Z",
      "2000-02-29T12:34:56.123456789Z",
      "+010000-01-01T00:00:00.000000000Z",
      "+275760-09-13T00:00:00.000000000Z",
      "-271821-04-20T00:00:00.000000000Z",
    ]) {
      expect(formatDate(parseDate(text, "utc"), "utc")).toBe(text);
    }
  });
  test.each([
    "2025-02-29 12:00:00",
    "1900-02-29 00:00:00",
    "2026-04-31 00:00:00",
    "2026-00-01 00:00:00",
    "2026-13-01 00:00:00",
    "2026-01-00 00:00:00",
    "2026-01-01 24:00:00",
    "2026-01-01 00:60:00",
    "2026-01-01 00:00:60",
    "2026-01-01",
    "2026-01-01 00:00:00.1234567890",
    "2026-01-01 00:00:00+24:00",
    "2026-01-01 00:00:00+00:60",
  ])("rejects invalid date %s", (source) => {
    expect(() => parseDate(source, "utc")).toThrow();
  });
  test("local output roundtrips nanoseconds with an explicit offset", () => {
    for (const value of [
      0n,
      -1n,
      1n,
      1_727_222_400_123_456_789n,
      8_640_000_000_000_000_000_000n,
      -8_640_000_000_000_000_000_000n,
    ])
      expect(parseDate(formatDate(value, "local"), "local")).toBe(value);
  });
  test("local DST gap is rejected and fold chooses earlier occurrence", () => {
    const script = `
      import { parseDate, formatDate } from './src/tools/timestamp/convert.ts';
      let gapRejected = false;
      try { parseDate('2024-03-10 02:30:00', 'local'); } catch { gapRejected = true; }
      const fold = parseDate('2024-11-03 01:30:00.123456789', 'local');
      console.log(JSON.stringify({ gapRejected, utc: formatDate(fold, 'utc'), local: formatDate(fold, 'local') }));
    `;
    const result = Bun.spawnSync([process.execPath, "--eval", script], {
      cwd: import.meta.dir + "/..",
      env: { ...process.env, TZ: "America/New_York" },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      gapRejected: true,
      utc: "2024-11-03T05:30:00.123456789Z",
      local: "2024-11-03T01:30:00.123456789-04:00",
    });
  });
});
