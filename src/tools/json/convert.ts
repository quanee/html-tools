export type JsonIndent = "2" | "4" | "tab";

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
