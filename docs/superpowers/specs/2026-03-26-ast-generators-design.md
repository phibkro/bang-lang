# AST Generators — Design Spec

**Date:** 2026-03-26
**Purpose:** Random AST generators using fast-check, enabling the roundtrip property test that covers parser + formatter + interpreter in one test.

## Overview

Write `fc.Arbitrary<Ast.Expr>` generators for each AST node type, bounded by recursion depth. Compose them into a single `genExpr(depth)` that produces random valid Bang AST trees. Wire into the roundtrip property test:

```
∀ ast. eval(parse(format(ast))) ≡ eval(ast)
```

One test, infinite coverage.

## Design Principles

**Generators mirror the grammar.** Each EBNF production becomes an `fc.Arbitrary`. The generator structure IS the grammar, expressed as code.

**Bounded recursion.** Recursive nodes (Block, Lambda, App, BinaryExpr) decrease a depth counter. At depth 0, only leaf nodes (literals, identifiers) are generated. This prevents infinite trees and controls test size.

**Valid programs only.** Generators produce ASTs that the interpreter can evaluate without errors. This means:

- Identifiers must be in scope (generate declarations before references)
- No division by zero (avoid generating `/ 0`)
- No type mismatches (generate well-typed expressions)
- No declared functions (interpreter can't eval them)

Actually — **start simple**. Generate arbitrary expressions first (may produce scope errors). Filter out programs that error. This is faster to build and still catches real bugs. Constrained generation (only valid programs) is a refinement.

## Generators

### Leaf generators (depth 0)

```typescript
const genIntLiteral = fc
  .integer({ min: -1000, max: 1000 })
  .map((n) => new Ast.IntLiteral({ value: n, span: Span.empty }));

const genFloatLiteral = fc
  .double({ min: -1000, max: 1000, noNaN: true })
  .map((n) => new Ast.FloatLiteral({ value: n, span: Span.empty }));

const genStringLiteral = fc
  .string({ minLength: 0, maxLength: 20 })
  .filter((s) => !s.includes('"') && !s.includes("${") && !s.includes("\\"))
  .map((s) => new Ast.StringLiteral({ value: s, span: Span.empty }));

const genBoolLiteral = fc.boolean().map((b) => new Ast.BoolLiteral({ value: b, span: Span.empty }));

const genUnitLiteral = fc.constant(new Ast.UnitLiteral({ span: Span.empty }));
```

### Identifier generator

Use a fixed set of variable names to increase the chance of in-scope references:

```typescript
const genIdent = fc
  .constantFrom("x", "y", "z", "a", "b", "n", "result")
  .map((name) => new Ast.Ident({ name, span: Span.empty }));
```

### Recursive generators (depth > 0)

```typescript
const genBinaryExpr = (depth: number) =>
  fc
    .tuple(
      genExpr(depth - 1),
      fc.constantFrom("+", "-", "*", "==", "!=", "<", ">", "and", "or", "++"),
      genExpr(depth - 1),
    )
    .map(([left, op, right]) => new Ast.BinaryExpr({ op, left, right, span: Span.empty }));

const genUnaryExpr = (depth: number) =>
  fc
    .tuple(fc.constantFrom("-", "not"), genExpr(depth - 1))
    .map(([op, expr]) => new Ast.UnaryExpr({ op, expr, span: Span.empty }));

const genBlock = (depth: number) =>
  fc
    .tuple(fc.array(genDeclaration(depth - 1), { minLength: 0, maxLength: 3 }), genExpr(depth - 1))
    .map(([stmts, expr]) => new Ast.Block({ statements: stmts, expr, span: Span.empty }));

const genLambda = (depth: number) =>
  fc
    .tuple(
      fc.array(fc.constantFrom("x", "y", "z", "a", "b"), { minLength: 1, maxLength: 3 }),
      genExpr(depth - 1), // body — should be a Block, but genExpr includes Block
    )
    .map(
      ([params, body]) =>
        new Ast.Lambda({
          params,
          body: new Ast.Block({ statements: [], expr: body, span: Span.empty }),
          span: Span.empty,
        }),
    );

const genApp = (depth: number) =>
  fc
    .tuple(
      genExpr(depth - 1), // function
      fc.array(genExpr(depth - 1), { minLength: 1, maxLength: 3 }), // args
    )
    .map(([func, args]) => new Ast.App({ func, args, span: Span.empty }));
```

### Declaration generator (for block statements)

```typescript
const genDeclaration = (depth: number) =>
  fc.tuple(fc.constantFrom("x", "y", "z", "a", "b", "tmp"), genExpr(depth - 1)).map(
    ([name, value]) =>
      new Ast.Declaration({
        name,
        mutable: false,
        value,
        typeAnnotation: Option.none(),
        span: Span.empty,
      }),
  );
```

### Composite generator

```typescript
const genExpr = (depth: number): fc.Arbitrary<Ast.Expr> =>
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
        // genApp(depth),  — likely to produce scope errors, enable later
      );

const genProgram = (depth: number): fc.Arbitrary<Ast.Program> =>
  fc.array(genDeclaration(depth), { minLength: 1, maxLength: 5 }).map(
    (decls) =>
      new Ast.Program({
        statements: decls,
        span: Span.empty,
      }),
  );
```

### Top-level default

```typescript
// Depth 3 = good balance of complexity vs test speed
export const arbExpr = genExpr(3);
export const arbProgram = genProgram(2);
```

## The Roundtrip Test

```typescript
it.prop("format roundtrip preserves semantics", [arbExpr], ([expr]) => {
  // Wrap expr in a program: result = <expr>
  const program = new Ast.Program({
    statements: [
      new Ast.Declaration({
        name: "result",
        mutable: false,
        value: expr,
        typeAnnotation: Option.none(),
        span: Span.empty,
      }),
    ],
    span: Span.empty,
  });

  // Format → source string
  const source = Formatter.format(program);

  // Re-parse
  const reparsed = Effect.runSync(
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize(source);
      return yield* Parser.parse(tokens);
    }),
  );

  // Interpret both — must agree
  const original = Effect.runSync(Interpreter.evalProgram(program));
  const roundtripped = Effect.runSync(Interpreter.evalProgram(reparsed));

  expect(roundtripped).toEqual(original);
});
```

**Filter strategy:** Some generated programs will fail (scope errors, type mismatches). Use `fc.pre()` to skip those:

```typescript
it.prop("format roundtrip", [arbExpr], ([expr]) => {
  const program = wrapInProgram(expr);

  // Skip programs that fail to interpret (scope errors, etc.)
  const evalResult = Effect.runSyncExit(Interpreter.evalProgram(program));
  fc.pre(Exit.isSuccess(evalResult));

  const source = Formatter.format(program);
  const reparsed = parseSync(source);

  // Skip if re-parsing fails (formatter produced invalid syntax)
  const reparseResult = Effect.runSyncExit(parseProgram(source));
  fc.pre(Exit.isSuccess(reparseResult));

  const original = Exit.getOrThrow(evalResult);
  const roundtripped = Effect.runSync(Interpreter.evalProgram(Exit.getOrThrow(reparseResult)));

  expect(roundtripped).toEqual(original);
});
```

`fc.pre(condition)` skips the test case if the condition is false. Fast-check will generate more cases to compensate. This lets us use simple unconstrained generators and filter, rather than building complex constrained generators upfront.

## File Structure

```
packages/core/src/
  AstGen.ts       — generators for each AST node type

packages/core/test/
  Roundtrip.test.ts  — the roundtrip property test
```

## What This Does NOT Include

- Constrained generation (only well-typed/well-scoped programs) — refinement for later
- StringInterp generation — complex to generate valid interpolation strings
- DotAccess generation — always errors in interpreter v1
- App generation — high chance of scope errors, enable after constrained gen

## Success Criteria

The roundtrip test runs 100 iterations at depth 3 without failure. This means:

- The formatter produces valid Bang source for any well-formed AST
- The parser can re-parse any formatted output
- The interpreter agrees on the semantics before and after formatting
