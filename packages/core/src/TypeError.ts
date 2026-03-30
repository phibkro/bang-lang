import { Match, Schema } from "effect";
import type { InferType } from "./InferType.js";
import { prettyPrint } from "./InferType.js";
import { Span } from "./Span.js";

// ---------------------------------------------------------------------------
// Type error variants — Schema.TaggedError for each
// ---------------------------------------------------------------------------

export class UnificationError extends Schema.TaggedError<UnificationError>()("UnificationError", {
  expected: Schema.Any as Schema.Schema<InferType>,
  actual: Schema.Any as Schema.Schema<InferType>,
  span: Span,
}) {}

export class UndefinedVariable extends Schema.TaggedError<UndefinedVariable>()("UndefinedVariable", {
  name: Schema.String,
  span: Span,
}) {}

export class OccursCheck extends Schema.TaggedError<OccursCheck>()("OccursCheck", {
  varId: Schema.Number,
  type: Schema.Any as Schema.Schema<InferType>,
  span: Span,
}) {}

export class NonFunctionApp extends Schema.TaggedError<NonFunctionApp>()("NonFunctionApp", {
  actual: Schema.Any as Schema.Schema<InferType>,
  span: Span,
}) {}

export class ArityMismatch extends Schema.TaggedError<ArityMismatch>()("ArityMismatch", {
  expected: Schema.Number,
  actual: Schema.Number,
  span: Span,
}) {}

export class PatternTypeMismatch extends Schema.TaggedError<PatternTypeMismatch>()(
  "PatternTypeMismatch",
  {
    pattern: Schema.Any as Schema.Schema<InferType>,
    scrutinee: Schema.Any as Schema.Schema<InferType>,
    span: Span,
  },
) {}

export class UnknownField extends Schema.TaggedError<UnknownField>()("UnknownField", {
  type: Schema.Any as Schema.Schema<InferType>,
  field: Schema.String,
  span: Span,
}) {}

export class DuplicateBinding extends Schema.TaggedError<DuplicateBinding>()("DuplicateBinding", {
  name: Schema.String,
  span: Span,
}) {}

export type TypeError =
  | UnificationError
  | UndefinedVariable
  | OccursCheck
  | NonFunctionApp
  | ArityMismatch
  | PatternTypeMismatch
  | UnknownField
  | DuplicateBinding;

// ---------------------------------------------------------------------------
// Error formatter
// ---------------------------------------------------------------------------

export const formatTypeError = (e: TypeError): string =>
  Match.value(e).pipe(
    Match.tag("UnificationError", (e) =>
      `Type mismatch: expected \`${prettyPrint(e.expected)}\` but got \`${prettyPrint(e.actual)}\``),
    Match.tag("UndefinedVariable", (e) =>
      `Undefined variable: \`${e.name}\``),
    Match.tag("OccursCheck", (e) =>
      `Infinite type: \`?${e.varId}\` occurs in \`${prettyPrint(e.type)}\``),
    Match.tag("NonFunctionApp", (e) =>
      `Not a function: cannot apply \`${prettyPrint(e.actual)}\``),
    Match.tag("ArityMismatch", (e) =>
      `Arity mismatch: expected ${e.expected} arguments but got ${e.actual}`),
    Match.tag("PatternTypeMismatch", (e) =>
      `Pattern type mismatch: pattern has type \`${prettyPrint(e.pattern)}\` but scrutinee has type \`${prettyPrint(e.scrutinee)}\``),
    Match.tag("UnknownField", (e) =>
      `Unknown field: \`${e.field}\` on type \`${prettyPrint(e.type)}\``),
    Match.tag("DuplicateBinding", (e) =>
      `Duplicate binding: \`${e.name}\``),
    Match.exhaustive,
  );
