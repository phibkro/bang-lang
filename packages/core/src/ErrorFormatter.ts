import type { CompilerError } from "./CompilerError.js";

const categoryFromTag = (tag: string): string => {
  switch (tag) {
    case "LexError":
      return "lex";
    case "ParseError":
      return "parse";
    case "CheckError":
      return "check";
    case "CodegenError":
      return "codegen";
    default:
      return tag.toLowerCase();
  }
};

export const format = (error: CompilerError, source: string): string => {
  const { _tag, message, span, hint } = error as CompilerError & {
    _tag: string;
    message: string;
    span: { startLine: number; startCol: number; endCol: number };
    hint?: string;
  };

  const category = categoryFromTag(_tag);
  const lines = source.split("\n");
  const lineIndex = span.startLine - 1;
  const sourceLine = lines[lineIndex] ?? "";
  const lineNum = String(span.startLine);
  const gutter = " ".repeat(lineNum.length);
  const caretCount = Math.max(1, span.endCol - span.startCol);
  const caretPad = " ".repeat(span.startCol);
  const carets = "^".repeat(caretCount);

  const parts: string[] = [
    `error[${category}]: ${message}`,
    ` --> source.bang:${span.startLine}:${span.startCol + 1}`,
    `${gutter}  |`,
    `${lineNum} | ${sourceLine}`,
    `${gutter}  | ${caretPad}${carets}`,
    `${gutter}  |`,
  ];

  if (hint !== undefined) {
    parts.push(`${gutter}  = hint: ${hint}`);
  }

  return parts.join("\n");
};

export const formatAll = (errors: CompilerError[], source: string): string =>
  errors.map((e) => format(e, source)).join("\n\n");
