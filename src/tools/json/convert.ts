export type JsonIndent = "2" | "4" | "tab";

/** Escape the original text without parsing its contents or adding outer quotes. */
export function escapeJson(source: string): string {
  if (source.length === 0) throw new Error("请输入需要转义的文本。");
  return JSON.stringify(source).slice(1, -1);
}

/** Decode exactly one JSON string layer, accepting optional outer quotes. */
export function unescapeJson(source: string): string {
  if (source.length === 0) throw new Error("请输入需要去转义的文本。");
  const trimmed = source.trim();
  const quoted = trimmed.startsWith('"') && trimmed.endsWith('"');
  try {
    return JSON.parse(quoted ? trimmed : `"${source}"`);
  } catch {
    throw new Error(
      "转义格式不正确，请检查双引号、反斜杠及 Unicode 转义；换行和制表符需使用转义写法。",
    );
  }
}

/** Validate with the native parser, but never serialize its rounded numbers. */
export function transformJson(
  source: string,
  mode: "format" | "compact",
  indent: JsonIndent = "2",
): string {
  if (!source.trim()) throw new Error("请输入需要处理的 JSON。");
  try {
    JSON.parse(source);
  } catch {
    throw new Error("JSON 格式不正确，请检查引号、逗号和括号；不支持注释或尾随逗号。");
  }

  // Quoted strings are indivisible tokens, including escapes and inner spaces.
  const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? [];
  if (mode === "compact") return tokens.join("");

  const unit = indent === "tab" ? "\t" : " ".repeat(Number(indent));
  const output: string[] = [];
  let depth = 0;
  const newline = () => output.push("\n", unit.repeat(depth));
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === "{" || token === "[") {
      output.push(token);
      if (tokens[index + 1] === (token === "{" ? "}" : "]")) {
        output.push(tokens[++index]!);
      } else {
        depth++;
        newline();
      }
    } else if (token === "}" || token === "]") {
      depth--;
      newline();
      output.push(token);
    } else if (token === ",") {
      output.push(token);
      newline();
    } else {
      output.push(token === ":" ? ": " : token);
    }
  }
  return output.join("");
}
