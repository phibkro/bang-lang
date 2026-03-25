import { Schema } from "effect";

export class LexError extends Schema.TaggedError<LexError>()("LexError", {
  message: Schema.String,
  span: Schema.Any,
  hint: Schema.optional(Schema.String),
}) {}

export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  message: Schema.String,
  span: Schema.Any,
  hint: Schema.optional(Schema.String),
}) {}

export class CheckError extends Schema.TaggedError<CheckError>()("CheckError", {
  message: Schema.String,
  span: Schema.Any,
  hint: Schema.optional(Schema.String),
}) {}

export class CodegenError extends Schema.TaggedError<CodegenError>()("CodegenError", {
  message: Schema.String,
  span: Schema.Any,
  hint: Schema.optional(Schema.String),
}) {}

export type CompilerError = LexError | ParseError | CheckError | CodegenError;

export const CompilerErrorSchema = Schema.Union(LexError, ParseError, CheckError, CodegenError);
