import { Array, Match, Option } from "effect";
import type { CompilerError } from "./CompilerError.js";

export const format = (error: CompilerError, source: string): string => {
  const category = Match.value(error).pipe(
    Match.tag("LexError", () => "lex"),
    Match.tag("ParseError", () => "parse"),
    Match.tag("CheckError", () => "check"),
    Match.tag("CodegenError", () => "codegen"),
    Match.exhaustive,
  );

  const { message, span, hint } = error;
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
    ...Option.match(Option.fromNullable(hint), {
      onNone: () => [] as string[],
      onSome: (h) => [`${gutter}  = hint: ${h}`],
    }),
  ];

  return parts.join("\n");
};

export const formatAll = (errors: CompilerError[], source: string): string =>
  Array.map(errors, (e) => format(e, source)).join("\n\n");
