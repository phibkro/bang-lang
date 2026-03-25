import { Option, Schema } from "effect";
import { Span } from "./Span.js";

// ---------------------------------------------------------------------------
// Type nodes
// ---------------------------------------------------------------------------

export class ConcreteType extends Schema.TaggedClass<ConcreteType>()("ConcreteType", {
  name: Schema.String,
  span: Span,
}) {}

// Forward-declare recursive Type schema via suspend
const TypeSchema: Schema.Schema<Type> = Schema.suspend(() =>
  Schema.Union(ConcreteType, ArrowType, EffectType),
);

export class ArrowType extends Schema.TaggedClass<ArrowType>()("ArrowType", {
  param: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
  result: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
  span: Span,
}) {}

export class EffectType extends Schema.TaggedClass<EffectType>()("EffectType", {
  value: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
  deps: Schema.Array(Schema.String),
  error: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
  span: Span,
}) {}

export type Type = ConcreteType | ArrowType | EffectType;

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

// Forward-declare recursive Expr schema
const ExprSchema: Schema.Schema<Expr> = Schema.suspend(() =>
  Schema.Union(Ident, DotAccess, App, StringLiteral, IntLiteral, BoolLiteral, UnitLiteral, Force),
);

export class Ident extends Schema.TaggedClass<Ident>()("Ident", {
  name: Schema.String,
  span: Span,
}) {}

export class DotAccess extends Schema.TaggedClass<DotAccess>()("DotAccess", {
  object: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  field: Schema.String,
  span: Span,
}) {}

export class App extends Schema.TaggedClass<App>()("App", {
  func: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  args: Schema.Array(Schema.suspend((): Schema.Schema<Expr> => ExprSchema)),
  span: Span,
}) {}

export class StringLiteral extends Schema.TaggedClass<StringLiteral>()("StringLiteral", {
  value: Schema.String,
  span: Span,
}) {}

export class IntLiteral extends Schema.TaggedClass<IntLiteral>()("IntLiteral", {
  value: Schema.Number,
  span: Span,
}) {}

export class BoolLiteral extends Schema.TaggedClass<BoolLiteral>()("BoolLiteral", {
  value: Schema.Boolean,
  span: Span,
}) {}

export class UnitLiteral extends Schema.TaggedClass<UnitLiteral>()("UnitLiteral", {
  span: Span,
}) {}

export class Force extends Schema.TaggedClass<Force>()("Force", {
  expr: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export type Expr = Ident | DotAccess | App | StringLiteral | IntLiteral | BoolLiteral | UnitLiteral | Force;

// ---------------------------------------------------------------------------
// Statement nodes
// ---------------------------------------------------------------------------

const StmtSchema: Schema.Schema<Stmt> = Schema.suspend(() =>
  Schema.Union(Declaration, Declare, ForceStatement, ExprStatement),
);

export class Program extends Schema.TaggedClass<Program>()("Program", {
  statements: Schema.Array(Schema.suspend((): Schema.Schema<Stmt> => StmtSchema)),
  span: Span,
}) {}

export class Declaration extends Schema.TaggedClass<Declaration>()("Declaration", {
  name: Schema.String,
  mutable: Schema.Boolean,
  value: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  typeAnnotation: Schema.OptionFromUndefinedOr(Schema.suspend((): Schema.Schema<Type> => TypeSchema)),
  span: Span,
}) {}

export class Declare extends Schema.TaggedClass<Declare>()("Declare", {
  name: Schema.String,
  typeAnnotation: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
  span: Span,
}) {}

export class ForceStatement extends Schema.TaggedClass<ForceStatement>()("ForceStatement", {
  expr: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class ExprStatement extends Schema.TaggedClass<ExprStatement>()("ExprStatement", {
  expr: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export type Stmt = Declaration | Declare | ForceStatement | ExprStatement;

export type Node = Program | Stmt | Expr | Type;
