import { Array, Match, Option } from "effect";
import type { CompilerError } from "./CompilerError.js";
import { offsetToLineCol } from "./Span.js";

export const format = (error: CompilerError, source: string): string => {
  const category = Match.value(error).pipe(
    Match.tag("LexError", () => "lex"),
    Match.tag("ParseError", () => "parse"),
    Match.tag("CheckError", () => "check"),
    Match.tag("CodegenError", () => "codegen"),
    Match.exhaustive,
  );

  const { message, span, hint } = error;
  const startPos = offsetToLineCol(source, span.start);
  const endPos = offsetToLineCol(source, span.end);
  const lines = source.split("\n");
  const sourceLine = lines[startPos.line - 1] ?? "";
  const lineNum = String(startPos.line);
  const gutter = " ".repeat(lineNum.length);
  const caretCount = Math.max(1, endPos.col - startPos.col);
  const caretPad = " ".repeat(startPos.col);
  const carets = "^".repeat(caretCount);

  const parts: string[] = [
    `error[${category}]: ${message}`,
    ` --> source.bang:${startPos.line}:${startPos.col + 1}`,
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
