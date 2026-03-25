import { Data } from "effect";
import type { Span } from "./Span.js";

export type Token = Data.TaggedEnum<{
  Keyword: { readonly value: string; readonly span: Span };
  Ident: { readonly value: string; readonly span: Span };
  TypeIdent: { readonly value: string; readonly span: Span };
  IntLit: { readonly value: string; readonly span: Span };
  FloatLit: { readonly value: string; readonly span: Span };
  StringLit: { readonly value: string; readonly span: Span };
  BoolLit: { readonly value: boolean; readonly span: Span };
  Operator: { readonly value: string; readonly span: Span };
  Delimiter: { readonly value: string; readonly span: Span };
  Unit: { readonly span: Span };
  EOF: { readonly span: Span };
}>;

export const {
  Keyword,
  Ident,
  TypeIdent,
  IntLit,
  FloatLit,
  StringLit,
  BoolLit,
  Operator,
  Delimiter,
  Unit,
  EOF,
  $is,
  $match,
} = Data.taggedEnum<Token>();
