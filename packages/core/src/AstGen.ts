/**
 * Random AST generators using fast-check.
 * Each EBNF production becomes an fc.Arbitrary.
 * Bounded recursion prevents infinite trees.
 */
import { FastCheck as fc, Option } from "effect";
import * as Ast from "./Ast.js";
import * as Span from "./Span.js";

const s = Span.empty;

// ---------------------------------------------------------------------------
// Leaf generators (depth 0)
// ---------------------------------------------------------------------------

const genIntLiteral = fc
  .integer({ min: 0, max: 1000 })
  .map((n) => new Ast.IntLiteral({ value: n, span: s }));

const genStringLiteral = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz "), { minLength: 0, maxLength: 10 })
  .map((v) => new Ast.StringLiteral({ value: v, span: s }));

const genBoolLiteral = fc.boolean().map((b) => new Ast.BoolLiteral({ value: b, span: s }));

const genUnitLiteral = fc.constant(new Ast.UnitLiteral({ span: s }));

// ---------------------------------------------------------------------------
// Identifier (fixed pool for scope hits)
// ---------------------------------------------------------------------------

const genIdent = fc
  .constantFrom("x", "y", "z", "a", "b", "n")
  .map((name) => new Ast.Ident({ name, span: s }));

// ---------------------------------------------------------------------------
// Recursive generators
// ---------------------------------------------------------------------------

const genBinaryExpr = (depth: number) =>
  fc
    .tuple(
      genExpr(depth - 1),
      fc.constantFrom("+", "-", "*", "==", "!=", "<", ">", "and", "or"),
      genExpr(depth - 1),
    )
    .map(([left, op, right]) => new Ast.BinaryExpr({ op, left, right, span: s }));

const genUnaryExpr = (depth: number) =>
  fc
    .tuple(fc.constantFrom("-", "not"), genExpr(depth - 1))
    .map(([op, expr]) => new Ast.UnaryExpr({ op, expr, span: s }));

const genDeclaration = (depth: number) =>
  fc.tuple(fc.constantFrom("x", "y", "z", "a", "b", "tmp"), genExpr(depth - 1)).map(
    ([name, value]) =>
      new Ast.Declaration({
        name,
        mutable: false,
        value,
        typeAnnotation: Option.none(),
        span: s,
      }),
  );

const genBlock = (depth: number) =>
  fc
    .tuple(fc.array(genDeclaration(depth - 1), { minLength: 0, maxLength: 3 }), genExpr(depth - 1))
    .map(([stmts, expr]) => new Ast.Block({ statements: stmts, expr, span: s }));

const genLambda = (depth: number) =>
  fc
    .tuple(
      fc.array(fc.constantFrom("x", "y", "z", "a", "b"), { minLength: 1, maxLength: 3 }),
      genExpr(depth - 1),
    )
    .map(
      ([params, body]) =>
        new Ast.Lambda({
          params,
          body: new Ast.Block({ statements: [], expr: body, span: s }),
          span: s,
        }),
    );

// ---------------------------------------------------------------------------
// Composite expression generator
// ---------------------------------------------------------------------------

export const genExpr = (depth: number): fc.Arbitrary<Ast.Expr> =>
  depth <= 0
    ? fc.oneof(genIntLiteral, genStringLiteral, genBoolLiteral, genUnitLiteral)
    : fc.oneof(
        genIntLiteral,
        genStringLiteral,
        genBoolLiteral,
        genIdent,
        genBinaryExpr(depth),
        genUnaryExpr(depth),
        genBlock(depth),
        genLambda(depth),
      );

// ---------------------------------------------------------------------------
// Program generator
// ---------------------------------------------------------------------------

export const genProgram = (depth: number): fc.Arbitrary<Ast.Program> =>
  fc
    .array(genDeclaration(depth), { minLength: 1, maxLength: 5 })
    .map((stmts) => new Ast.Program({ statements: stmts, span: s }));

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

/** Expression arbitrary at depth 3 */
export const arbExpr = genExpr(3);

/** Program arbitrary at depth 2 */
export const arbProgram = genProgram(2);
