import { Schema } from "effect";
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
// Pattern nodes
// ---------------------------------------------------------------------------

// Forward-declare recursive Pattern schema
const PatternSchema: Schema.Schema<Pattern> = Schema.suspend(() =>
  Schema.Union(WildcardPattern, BindingPattern, ConstructorPattern, LiteralPattern),
);

export class WildcardPattern extends Schema.TaggedClass<WildcardPattern>()("WildcardPattern", {
  span: Span,
}) {}

export class BindingPattern extends Schema.TaggedClass<BindingPattern>()("BindingPattern", {
  name: Schema.String,
  span: Span,
}) {}

export class ConstructorPattern extends Schema.TaggedClass<ConstructorPattern>()(
  "ConstructorPattern",
  {
    tag: Schema.String,
    patterns: Schema.Array(Schema.suspend((): Schema.Schema<Pattern> => PatternSchema)),
    span: Span,
  },
) {}

export class LiteralPattern extends Schema.TaggedClass<LiteralPattern>()("LiteralPattern", {
  value: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export type Pattern = WildcardPattern | BindingPattern | ConstructorPattern | LiteralPattern;

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

// Forward-declare recursive Expr schema
const ExprSchema: Schema.Schema<Expr> = Schema.suspend(() =>
  Schema.Union(
    Ident,
    DotAccess,
    App,
    StringLiteral,
    IntLiteral,
    FloatLiteral,
    BoolLiteral,
    UnitLiteral,
    Force,
    Block,
    Lambda,
    BinaryExpr,
    UnaryExpr,
    StringInterp,
    MatchExpr,
    ComptimeExpr,
    UseExpr,
    OnExpr,
  ),
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

export class FloatLiteral extends Schema.TaggedClass<FloatLiteral>()("FloatLiteral", {
  value: Schema.Number,
  span: Span,
}) {}

export class Block extends Schema.TaggedClass<Block>()("Block", {
  statements: Schema.Array(Schema.suspend(() => StmtSchema)),
  expr: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class Lambda extends Schema.TaggedClass<Lambda>()("Lambda", {
  params: Schema.Array(Schema.String),
  body: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class BinaryExpr extends Schema.TaggedClass<BinaryExpr>()("BinaryExpr", {
  op: Schema.String,
  left: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  right: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class UnaryExpr extends Schema.TaggedClass<UnaryExpr>()("UnaryExpr", {
  op: Schema.String,
  expr: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class InterpText extends Schema.TaggedClass<InterpText>()("InterpText", {
  value: Schema.String,
}) {}

export class InterpExpr extends Schema.TaggedClass<InterpExpr>()("InterpExpr", {
  value: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
}) {}

export type InterpPart = InterpText | InterpExpr;
const InterpPartSchema = Schema.Union(InterpText, InterpExpr);

export class StringInterp extends Schema.TaggedClass<StringInterp>()("StringInterp", {
  parts: Schema.Array(Schema.suspend(() => InterpPartSchema)),
  span: Span,
}) {}

export class Arm extends Schema.TaggedClass<Arm>()("Arm", {
  pattern: Schema.suspend((): Schema.Schema<Pattern> => PatternSchema),
  guard: Schema.OptionFromUndefinedOr(Schema.suspend((): Schema.Schema<Expr> => ExprSchema)),
  body: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class MatchExpr extends Schema.TaggedClass<MatchExpr>()("MatchExpr", {
  scrutinee: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  arms: Schema.Array(Arm),
  span: Span,
}) {}

export class ComptimeExpr extends Schema.TaggedClass<ComptimeExpr>()("ComptimeExpr", {
  expr: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class UseExpr extends Schema.TaggedClass<UseExpr>()("UseExpr", {
  name: Schema.String,
  value: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class OnExpr extends Schema.TaggedClass<OnExpr>()("OnExpr", {
  source: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  handler: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export type Expr =
  | Ident
  | DotAccess
  | App
  | StringLiteral
  | IntLiteral
  | FloatLiteral
  | BoolLiteral
  | UnitLiteral
  | Force
  | Block
  | Lambda
  | BinaryExpr
  | UnaryExpr
  | StringInterp
  | MatchExpr
  | ComptimeExpr
  | UseExpr
  | OnExpr;

// ---------------------------------------------------------------------------
// Constructor nodes (for TypeDecl)
// ---------------------------------------------------------------------------

export class NullaryConstructor extends Schema.TaggedClass<NullaryConstructor>()(
  "NullaryConstructor",
  {
    tag: Schema.String,
    span: Span,
  },
) {}

export class PositionalConstructor extends Schema.TaggedClass<PositionalConstructor>()(
  "PositionalConstructor",
  {
    tag: Schema.String,
    fields: Schema.Array(Schema.suspend((): Schema.Schema<Type> => TypeSchema)),
    span: Span,
  },
) {}

export class NamedConstructor extends Schema.TaggedClass<NamedConstructor>()("NamedConstructor", {
  tag: Schema.String,
  fields: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
    }),
  ),
  span: Span,
}) {}

export type Constructor = NullaryConstructor | PositionalConstructor | NamedConstructor;

const ConstructorSchema: Schema.Schema<Constructor> = Schema.suspend(() =>
  Schema.Union(NullaryConstructor, PositionalConstructor, NamedConstructor),
);

// ---------------------------------------------------------------------------
// Statement nodes
// ---------------------------------------------------------------------------

export class NewtypeDecl extends Schema.TaggedClass<NewtypeDecl>()("NewtypeDecl", {
  name: Schema.String,
  wrappedType: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
  span: Span,
}) {}

export class RecordTypeDecl extends Schema.TaggedClass<RecordTypeDecl>()("RecordTypeDecl", {
  name: Schema.String,
  fields: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.suspend((): Schema.Schema<Type> => TypeSchema),
    }),
  ),
  span: Span,
}) {}

const StmtSchema = Schema.suspend(() =>
  Schema.Union(
    Declaration,
    Declare,
    ForceStatement,
    ExprStatement,
    TypeDecl,
    NewtypeDecl,
    RecordTypeDecl,
    Import,
    Export,
  ),
);

export class Program extends Schema.TaggedClass<Program>()("Program", {
  statements: Schema.Array(Schema.suspend(() => StmtSchema)),
  span: Span,
}) {}

export class Declaration extends Schema.TaggedClass<Declaration>()("Declaration", {
  name: Schema.String,
  mutable: Schema.Boolean,
  value: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  typeAnnotation: Schema.OptionFromUndefinedOr(
    Schema.suspend((): Schema.Schema<Type> => TypeSchema),
  ),
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

export class TypeDecl extends Schema.TaggedClass<TypeDecl>()("TypeDecl", {
  name: Schema.String,
  typeParams: Schema.Array(Schema.String),
  constructors: Schema.Array(Schema.suspend((): Schema.Schema<Constructor> => ConstructorSchema)),
  span: Span,
}) {}

export class Import extends Schema.TaggedClass<Import>()("Import", {
  modulePath: Schema.Array(Schema.String),
  names: Schema.Array(Schema.String),
  span: Span,
}) {}

export class Export extends Schema.TaggedClass<Export>()("Export", {
  names: Schema.Array(Schema.String),
  span: Span,
}) {}

export type Stmt =
  | Declaration
  | Declare
  | ForceStatement
  | ExprStatement
  | TypeDecl
  | NewtypeDecl
  | RecordTypeDecl
  | Import
  | Export;

export type Node = Program | Stmt | Expr | Type | InterpPart | Pattern | Constructor | Arm;
