export type UnicodeScope = "all" | "preserve-ascii";

function assertPairedSurrogates(text: string): void {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
    } else if (unit < 0xdc00 || unit > 0xdfff) {
      continue;
    }
    throw new Error(`文本第 ${index + 1} 个 UTF-16 代码单元是孤立代理项，请检查字符是否完整。`);
  }
}

export function encodeUnicode(text: string, scope: UnicodeScope = "all"): string {
  assertPairedSurrogates(text);
  const output: string[] = [];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    // Escape backslashes even in ASCII mode so literal escapes survive a round trip.
    if (scope === "preserve-ascii" && unit >= 0x20 && unit <= 0x7e && unit !== 0x5c) {
      output.push(text[index]!);
    } else {
      output.push(`\\u${unit.toString(16).padStart(4, "0")}`);
    }
  }
  return output.join("");
}

export function decodeUnicode(source: string): string {
  const output: string[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== "\\" || source[index + 1] !== "u") {
      output.push(source[index]!);
      continue;
    }
    const digits = source.slice(index + 2, index + 6);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
      throw new Error(
        `第 ${index + 1} 个字符处的 Unicode 转义不完整或含非法数字，\\u 后须紧跟四位十六进制数字。`,
      );
    }
    output.push(String.fromCharCode(Number.parseInt(digits, 16)));
    // Advance through the original source only; never decode the newly produced text.
    index += 5;
  }
  const decoded = output.join("");
  assertPairedSurrogates(decoded);
  return decoded;
}
