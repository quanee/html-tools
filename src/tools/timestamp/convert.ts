export type TimestampUnit = "seconds" | "milliseconds" | "nanoseconds";
export type TimeZone = "local" | "utc";

const DIGITS: Record<TimestampUnit, number> = { seconds: 9, milliseconds: 6, nanoseconds: 0 };
const NS_PER_SECOND = 1_000_000_000n;
const NS_PER_MS = 1_000_000n;
const MAX_NS = 8_640_000_000_000_000n * NS_PER_MS;

function assertRange(value: bigint): bigint {
  if (value < -MAX_NS || value > MAX_NS) throw new Error("时间超出浏览器支持的日期范围。");
  return value;
}

/** BigInt division truncates toward zero; calendar decomposition needs floor. */
function floorDivide(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value % divisor < 0n ? quotient - 1n : quotient;
}

export function parseTimestamp(source: string, unit: TimestampUnit): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(source.trim());
  if (!match) throw new Error("请输入十进制时间戳，不支持科学计数法。");
  const [, sign, whole = "0", fraction = ""] = match;
  const digits = DIGITS[unit];
  if (fraction.length > digits)
    throw new Error(digits ? `当前单位最多支持 ${digits} 位小数。` : "纳秒时间戳必须为整数。");
  const magnitude =
    BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  return assertRange(sign === "-" ? -magnitude : magnitude);
}

export function formatTimestamp(value: bigint, unit: TimestampUnit): string {
  assertRange(value);
  const digits = DIGITS[unit];
  const absolute = value < 0n ? -value : value;
  const divisor = 10n ** BigInt(digits);
  const fraction = digits
    ? (absolute % divisor).toString().padStart(digits, "0").replace(/0+$/, "")
    : "";
  return `${value < 0n ? "-" : ""}${absolute / divisor}${fraction ? `.${fraction}` : ""}`;
}

function matchesCalendar(date: Date, parts: number[], utc: boolean): boolean {
  const actual = utc
    ? [
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
      ]
    : [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
      ];
  return actual.every((part, index) => part === parts[index]);
}

/** A 400-year Gregorian cycle lets wall times straddle Date's clipping boundary. */
function calendarMilliseconds(parts: number[]): bigint {
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts;
  const cycles = Math.floor((year - 2000) / 400);
  const normalizedYear = year - cycles * 400;
  const date = new Date(0);
  date.setUTCFullYear(normalizedYear, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (!matchesCalendar(date, [normalizedYear, month, day, hour, minute, second], true)) {
    throw new Error("日期不存在，请检查年月日和时分秒。");
  }
  return BigInt(date.getTime()) + BigInt(cycles) * 146_097n * 86_400_000n;
}

export function parseDate(source: string, zone: TimeZone): bigint {
  const match =
    /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}(?::\d{2})?)?$/i.exec(
      source.trim(),
    );
  if (!match)
    throw new Error("日期格式应为 YYYY-MM-DD HH:mm:ss，可附加 1～9 位小数及 Z 或 ±HH:mm 时区。");
  const parts = match.slice(1, 7).map(Number);
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts;
  const explicitZone = match[8];
  const useUTC = zone === "utc" || Boolean(explicitZone);
  let milliseconds: bigint;
  if (useUTC) {
    milliseconds = calendarMilliseconds(parts);
  } else {
    // Native compatible disambiguation picks the earlier occurrence in a DST fold.
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(hour, minute, second, 0);
    if (!matchesCalendar(date, parts, false))
      throw new Error("日期不存在、超出范围，或处于本地夏令时跳过的时段。");
    milliseconds = BigInt(date.getTime());
  }
  let offsetSeconds = 0;
  if (explicitZone && explicitZone.toUpperCase() !== "Z") {
    const offsetParts = explicitZone.slice(1).split(":").map(Number);
    const [hours = 0, minutes = 0, seconds = 0] = offsetParts;
    if (hours > 23 || minutes > 59 || seconds > 59) throw new Error("时区偏移不正确。");
    offsetSeconds = (hours * 3600 + minutes * 60 + seconds) * (explicitZone[0] === "-" ? -1 : 1);
  }
  return assertRange(
    milliseconds * NS_PER_MS -
      BigInt(offsetSeconds) * NS_PER_SECOND +
      BigInt((match[7] ?? "").padEnd(9, "0")),
  );
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function formatDate(value: bigint, zone: TimeZone): string {
  assertRange(value);
  const milliseconds = Number(floorDivide(value, NS_PER_MS));
  const date = new Date(milliseconds);
  const utc = zone === "utc";
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = utc ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const second = utc ? date.getUTCSeconds() : date.getSeconds();
  const fraction = (value - floorDivide(value, NS_PER_SECOND) * NS_PER_SECOND)
    .toString()
    .padStart(9, "0");
  const yearText =
    year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? "-" : "+"}${pad(Math.abs(year), 6)}`;
  let offset = "Z";
  if (!utc) {
    // Preserve historical sub-minute UTC offsets as well as modern DST offsets.
    const wallTime =
      calendarMilliseconds([year, month, day, hour, minute, second]) +
      BigInt(date.getMilliseconds());
    const seconds = Number(wallTime - BigInt(milliseconds)) / 1000;
    const absolute = Math.abs(seconds);
    offset = `${seconds < 0 ? "-" : "+"}${pad(Math.floor(absolute / 3600))}:${pad(Math.floor((absolute % 3600) / 60))}${absolute % 60 ? `:${pad(absolute % 60)}` : ""}`;
  }
  return `${yearText}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${fraction}${offset}`;
}

export function localZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
}
