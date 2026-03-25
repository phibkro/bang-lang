import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Span Schema
// ---------------------------------------------------------------------------

const SpanSchema = Schema.Struct({
  startLine: Schema.Number,
  startCol: Schema.Number,
  startOffset: Schema.Number,
  endLine: Schema.Number,
  endCol: Schema.Number,
  endOffset: Schema.Number,
});

// ---------------------------------------------------------------------------
// Token types (Schema.TaggedClass — gives equality, encode/decode, Schema.is)
// ---------------------------------------------------------------------------

export class Keyword extends Schema.TaggedClass<Keyword>()("Keyword", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class Ident extends Schema.TaggedClass<Ident>()("Ident", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class TypeIdent extends Schema.TaggedClass<TypeIdent>()("TypeIdent", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class IntLit extends Schema.TaggedClass<IntLit>()("IntLit", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class FloatLit extends Schema.TaggedClass<FloatLit>()("FloatLit", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class StringLit extends Schema.TaggedClass<StringLit>()("StringLit", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class BoolLit extends Schema.TaggedClass<BoolLit>()("BoolLit", {
  value: Schema.Boolean,
  span: SpanSchema,
}) {}

export class Operator extends Schema.TaggedClass<Operator>()("Operator", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class Delimiter extends Schema.TaggedClass<Delimiter>()("Delimiter", {
  value: Schema.String,
  span: SpanSchema,
}) {}

export class Unit extends Schema.TaggedClass<Unit>()("Unit", {
  span: SpanSchema,
}) {}

export class EOF extends Schema.TaggedClass<EOF>()("EOF", {
  span: SpanSchema,
}) {}

// ---------------------------------------------------------------------------
// Token union
// ---------------------------------------------------------------------------

export const TokenSchema = Schema.Union(
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
);

export type Token =
  | Keyword
  | Ident
  | TypeIdent
  | IntLit
  | FloatLit
  | StringLit
  | BoolLit
  | Operator
  | Delimiter
  | Unit
  | EOF;

// ---------------------------------------------------------------------------
// Type guards (via Schema.is)
// ---------------------------------------------------------------------------

export const isKeyword = Schema.is(Keyword);
export const isIdent = Schema.is(Ident);
export const isTypeIdent = Schema.is(TypeIdent);
export const isOperator = Schema.is(Operator);
export const isDelimiter = Schema.is(Delimiter);
export const isEOF = Schema.is(EOF);
