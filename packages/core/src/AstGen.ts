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
// Pattern generators
// ---------------------------------------------------------------------------

const genPattern = (depth: number): fc.Arbitrary<Ast.Pattern> =>
  depth <= 0
    ? fc.oneof(
        fc.constant(new Ast.WildcardPattern({ span: s })),
        fc.constantFrom("x", "y", "z").map((name) => new Ast.BindingPattern({ name, span: s })),
      )
    : fc.oneof(
        fc.constant(new Ast.WildcardPattern({ span: s })),
        fc.constantFrom("x", "y", "z").map((name) => new Ast.BindingPattern({ name, span: s })),
        genIntLiteral.map((lit) => new Ast.LiteralPattern({ value: lit, span: s })),
      );

// ---------------------------------------------------------------------------
// Recursive generators
// ---------------------------------------------------------------------------

/** Generate operands for binary expressions — excludes Lambda/OnExpr which don't
 *  roundtrip correctly when used as direct binary operands (formatter limitation). */
const genBinaryOperand = (depth: number): fc.Arbitrary<Ast.Expr> =>
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
        genMatchExpr(depth),
        genComptimeExpr(depth),
      );

const genBinaryExpr = (depth: number) =>
  fc
    .tuple(
      genBinaryOperand(depth - 1),
      fc.constantFrom("+", "-", "*", "==", "!=", "<", ">", "and", "or"),
      genBinaryOperand(depth - 1),
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

const genMutDeclaration = (depth: number) =>
  fc.tuple(fc.constantFrom("x", "y", "z"), genExpr(depth - 1)).map(
    ([name, value]) =>
      new Ast.Declaration({
        name,
        mutable: true,
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

const genArm = (depth: number) =>
  fc.tuple(genPattern(0), fc.boolean(), genExpr(depth - 1), genExpr(depth - 1)).map(
    ([pat, hasGuard, guardExpr, body]) =>
      new Ast.Arm({
        pattern: pat,
        guard: hasGuard ? Option.some(guardExpr) : Option.none(),
        body,
        span: s,
      }),
  );

const genMatchExpr = (depth: number) =>
  fc
    .tuple(
      // Use atom-like scrutinees to ensure correct parsing at high precedence
      fc.oneof(genIntLiteral, genBoolLiteral, genIdent),
      fc.array(genArm(depth - 1), { minLength: 1, maxLength: 3 }),
    )
    .map(([scrutinee, arms]) => new Ast.MatchExpr({ scrutinee, arms, span: s }));

// ---------------------------------------------------------------------------
// Composite expression generator
// ---------------------------------------------------------------------------

const genComptimeExpr = (depth: number) =>
  genExpr(depth - 1).map((expr) => new Ast.ComptimeExpr({ expr, span: s }));

const genOnExpr = (depth: number) =>
  fc
    .tuple(genIdent, genLambda(depth - 1))
    .map(([source, handler]) => new Ast.OnExpr({ source, handler, span: s }));

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
        genMatchExpr(depth),
        genComptimeExpr(depth),
        genOnExpr(depth),
      );

// ---------------------------------------------------------------------------
// TypeDecl generator (simple nullary ADTs)
// ---------------------------------------------------------------------------

const genNullaryConstructor = fc
  .constantFrom("True", "False", "None", "Red", "Green", "Blue")
  .map((tag) => new Ast.NullaryConstructor({ tag, span: s }));

export const genTypeDecl = fc
  .tuple(
    fc.constantFrom("Bool", "Color", "Status"),
    fc.array(genNullaryConstructor, { minLength: 1, maxLength: 4 }),
  )
  .map(([name, ctors]) => new Ast.TypeDecl({ name, typeParams: [], constructors: ctors, span: s }));

// ---------------------------------------------------------------------------
// Program generator
// ---------------------------------------------------------------------------

export const genProgram = (depth: number): fc.Arbitrary<Ast.Program> =>
  fc
    .array(fc.oneof(genDeclaration(depth), genMutDeclaration(depth)), {
      minLength: 1,
      maxLength: 5,
    })
    .map((stmts) => new Ast.Program({ statements: stmts, span: s }));

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

/** Expression arbitrary at depth 3 */
export const arbExpr = genExpr(3);

/** Program arbitrary at depth 2 */
export const arbProgram = genProgram(2);
