import { Data } from "effect";
import type { Span } from "./Span.js";

export type CompilerError = Data.TaggedEnum<{
  LexError: {
    readonly message: string;
    readonly span: Span;
    readonly hint?: string | undefined;
  };
  ParseError: {
    readonly message: string;
    readonly span: Span;
    readonly hint?: string | undefined;
  };
  CheckError: {
    readonly message: string;
    readonly span: Span;
    readonly hint?: string | undefined;
  };
  CodegenError: {
    readonly message: string;
    readonly span: Span;
    readonly hint?: string | undefined;
  };
}>;

export const { LexError, ParseError, CheckError, CodegenError, $is, $match } =
  Data.taggedEnum<CompilerError>();
