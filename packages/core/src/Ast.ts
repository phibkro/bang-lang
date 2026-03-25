import type { Span } from "./Span.js";

// ---------------------------------------------------------------------------
// Type nodes
// ---------------------------------------------------------------------------

export interface ConcreteType {
  readonly _tag: "ConcreteType";
  readonly name: string;
  readonly span: Span;
}

export interface ArrowType {
  readonly _tag: "ArrowType";
  readonly param: Type;
  readonly result: Type;
  readonly span: Span;
}

export interface EffectType {
  readonly _tag: "EffectType";
  readonly value: Type;
  readonly deps: string[];
  readonly error: Type;
  readonly span: Span;
}

export type Type = ConcreteType | ArrowType | EffectType;

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

export interface Ident {
  readonly _tag: "Ident";
  readonly name: string;
  readonly span: Span;
}

export interface DotAccess {
  readonly _tag: "DotAccess";
  readonly object: Expr;
  readonly field: string;
  readonly span: Span;
}

export interface App {
  readonly _tag: "App";
  readonly func: Expr;
  readonly args: Expr[];
  readonly span: Span;
}

export interface StringLiteral {
  readonly _tag: "StringLiteral";
  readonly value: string;
  readonly span: Span;
}

export interface IntLiteral {
  readonly _tag: "IntLiteral";
  readonly value: number;
  readonly span: Span;
}

export interface BoolLiteral {
  readonly _tag: "BoolLiteral";
  readonly value: boolean;
  readonly span: Span;
}

export interface UnitLiteral {
  readonly _tag: "UnitLiteral";
  readonly span: Span;
}

export interface Force {
  readonly _tag: "Force";
  readonly expr: Expr;
  readonly span: Span;
}

export type Expr =
  | Ident
  | DotAccess
  | App
  | StringLiteral
  | IntLiteral
  | BoolLiteral
  | UnitLiteral
  | Force;

// ---------------------------------------------------------------------------
// Statement nodes
// ---------------------------------------------------------------------------

export interface Program {
  readonly _tag: "Program";
  readonly statements: Stmt[];
  readonly span: Span;
}

export interface Declaration {
  readonly _tag: "Declaration";
  readonly name: string;
  readonly mutable: boolean;
  readonly value: Expr;
  readonly typeAnnotation: Type | undefined;
  readonly span: Span;
}

export interface Declare {
  readonly _tag: "Declare";
  readonly name: string;
  readonly typeAnnotation: Type;
  readonly span: Span;
}

export interface ForceStatement {
  readonly _tag: "ForceStatement";
  readonly expr: Expr;
  readonly span: Span;
}

export interface ExprStatement {
  readonly _tag: "ExprStatement";
  readonly expr: Expr;
  readonly span: Span;
}

export type Stmt = Declaration | Declare | ForceStatement | ExprStatement;

export type Node = Program | Stmt | Expr | Type;

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export const ConcreteType = (fields: Omit<ConcreteType, "_tag">): ConcreteType => ({
  _tag: "ConcreteType",
  ...fields,
});

export const ArrowType = (fields: Omit<ArrowType, "_tag">): ArrowType => ({
  _tag: "ArrowType",
  ...fields,
});

export const EffectType = (fields: Omit<EffectType, "_tag">): EffectType => ({
  _tag: "EffectType",
  ...fields,
});

export const Ident = (fields: Omit<Ident, "_tag">): Ident => ({
  _tag: "Ident",
  ...fields,
});

export const DotAccess = (fields: Omit<DotAccess, "_tag">): DotAccess => ({
  _tag: "DotAccess",
  ...fields,
});

export const App = (fields: Omit<App, "_tag">): App => ({
  _tag: "App",
  ...fields,
});

export const StringLiteral = (fields: Omit<StringLiteral, "_tag">): StringLiteral => ({
  _tag: "StringLiteral",
  ...fields,
});

export const IntLiteral = (fields: Omit<IntLiteral, "_tag">): IntLiteral => ({
  _tag: "IntLiteral",
  ...fields,
});

export const BoolLiteral = (fields: Omit<BoolLiteral, "_tag">): BoolLiteral => ({
  _tag: "BoolLiteral",
  ...fields,
});

export const UnitLiteral = (fields: Omit<UnitLiteral, "_tag">): UnitLiteral => ({
  _tag: "UnitLiteral",
  ...fields,
});

export const Force = (fields: Omit<Force, "_tag">): Force => ({
  _tag: "Force",
  ...fields,
});

export const Program = (fields: Omit<Program, "_tag">): Program => ({
  _tag: "Program",
  ...fields,
});

export const Declaration = (fields: Omit<Declaration, "_tag">): Declaration => ({
  _tag: "Declaration",
  ...fields,
});

export const Declare = (fields: Omit<Declare, "_tag">): Declare => ({
  _tag: "Declare",
  ...fields,
});

export const ForceStatement = (fields: Omit<ForceStatement, "_tag">): ForceStatement => ({
  _tag: "ForceStatement",
  ...fields,
});

export const ExprStatement = (fields: Omit<ExprStatement, "_tag">): ExprStatement => ({
  _tag: "ExprStatement",
  ...fields,
});
