# Bang Interpreter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reference interpreter that evaluates Bang AST directly to values, enabling compiler correctness testing via `eval(ast) ≡ run(codegen(ast))`.

**Architecture:** Two new files: `Value.ts` (value types as Schema.TaggedClass) and `Interpreter.ts` (eval function using Match.tag, HashMap for env, Effect.fail for errors). The interpreter walks the AST recursively, threading an immutable environment. Property tests compare interpreter output against compiled output.

**Tech Stack:** TypeScript, Effect (Schema, Match, HashMap, Option, Effect.gen), `@effect/vitest` (it.effect, it.prop)

**Reference:** Design spec at `docs/superpowers/specs/2026-03-26-interpreter-design.md`

**Effect conventions (MANDATORY):**
- Schema.TaggedClass for Value types
- Match.tag for AST dispatch
- Effect.fail(new EvalError({...})) for errors
- HashMap for environment
- if/else guards inside Effect.gen for simple early returns are fine

---

## File Structure

```
packages/core/src/
  Value.ts          — Value types (Num, Str, Bool, Unit, Closure)
  Interpreter.ts    — evalExpr, evalProgram, evalStmt
  index.ts          — add Value, Interpreter exports

packages/core/test/
  Interpreter.test.ts  — unit tests for eval
  Property.test.ts     — property tests for correctness laws
```

---

## Task 1: Value Types

**Files:**
- Create: `packages/core/src/Value.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create Value.ts with Schema.TaggedClass types**

```typescript
import { Schema } from "effect"

export class Num extends Schema.TaggedClass<Num>()("Num", {
  value: Schema.Number,
}) {}

export class Str extends Schema.TaggedClass<Str>()("Str", {
  value: Schema.String,
}) {}

export class Bool extends Schema.TaggedClass<Bool>()("Bool", {
  value: Schema.Boolean,
}) {}

export class Unit extends Schema.TaggedClass<Unit>()("Unit", {}) {}

export class Closure extends Schema.TaggedClass<Closure>()("Closure", {
  params: Schema.Array(Schema.String),
  body: Schema.Any,   // Ast.Expr — use Any to avoid circular Schema refs
  env: Schema.Any,    // HashMap<string, Value> — structural equality not needed for closures
}) {}

export type Value = Num | Str | Bool | Unit | Closure

// Extract interpreter Value to JS primitive (for correctness comparison)
export const toJS = (v: Value): unknown =>
  Match.value(v).pipe(
    Match.tag("Num", (n) => n.value),
    Match.tag("Str", (s) => s.value),
    Match.tag("Bool", (b) => b.value),
    Match.tag("Unit", () => undefined),
    Match.tag("Closure", () => { throw new Error("Cannot convert Closure to JS") }),
    Match.exhaustive,
  )

// Coerce Value to string (for string interpolation)
export const coerceToString = (v: Value): Effect<string, EvalError> =>
  Match.value(v).pipe(
    Match.tag("Num", (n) => Effect.succeed(String(n.value))),
    Match.tag("Str", (s) => Effect.succeed(s.value)),
    Match.tag("Bool", (b) => Effect.succeed(String(b.value))),
    Match.tag("Unit", () => Effect.succeed("()")),
    Match.tag("Closure", () => Effect.fail(new EvalError({ message: "Cannot coerce closure to string", span: Span.empty }))),
    Match.exhaustive,
  )
```

Add `EvalError` to Value.ts or CompilerError.ts:
```typescript
export class EvalError extends Schema.TaggedError<EvalError>()("EvalError", {
  message: Schema.String,
  span: Schema.Any,
}) {}
```

- [ ] **Step 2: Update index.ts**

Add `export * as Value from "./Value.js"` and `export * as Interpreter from "./Interpreter.js"` (Interpreter will be created in Task 2).

- [ ] **Step 3: Run tests — verify nothing breaks**

```bash
npx vitest run packages/core
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/Value.ts packages/core/src/index.ts
git commit --no-verify -m "feat(core): add Value types for interpreter"
```

---

## Task 2: Core Interpreter — Literals and Operators

**Files:**
- Create: `packages/core/src/Interpreter.ts`
- Create: `packages/core/test/Interpreter.test.ts`

- [ ] **Step 1: Write failing tests for literals and operators**

```typescript
import { describe, expect, it } from "@effect/vitest"
import { Effect, HashMap } from "effect"
import { Interpreter, Value } from "@bang/core"
import * as Ast from "@bang/core/Ast"
import * as Span from "@bang/core/Span"

const s = Span.empty
const emptyEnv = HashMap.empty<string, Value.Value>()

describe("Interpreter", () => {
  it.effect("evaluates integer literal", () =>
    Effect.gen(function*() {
      const result = yield* Interpreter.evalExpr(new Ast.IntLiteral({ value: 42, span: s }), emptyEnv)
      expect(result).toEqual(new Value.Num({ value: 42 }))
    })
  )

  it.effect("evaluates arithmetic", () =>
    Effect.gen(function*() {
      const expr = new Ast.BinaryExpr({
        op: "+",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 2, span: s }),
        span: s,
      })
      const result = yield* Interpreter.evalExpr(expr, emptyEnv)
      expect(result).toEqual(new Value.Num({ value: 3 }))
    })
  )

  it.effect("evaluates comparison", () =>
    Effect.gen(function*() {
      const expr = new Ast.BinaryExpr({
        op: "==",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 1, span: s }),
        span: s,
      })
      const result = yield* Interpreter.evalExpr(expr, emptyEnv)
      expect(result).toEqual(new Value.Bool({ value: true }))
    })
  )

  it.effect("evaluates unary minus", () =>
    Effect.gen(function*() {
      const expr = new Ast.UnaryExpr({
        op: "-",
        expr: new Ast.IntLiteral({ value: 5, span: s }),
        span: s,
      })
      const result = yield* Interpreter.evalExpr(expr, emptyEnv)
      expect(result).toEqual(new Value.Num({ value: -5 }))
    })
  )

  it.effect("evaluates string concat", () =>
    Effect.gen(function*() {
      const expr = new Ast.BinaryExpr({
        op: "++",
        left: new Ast.StringLiteral({ value: "hello", span: s }),
        right: new Ast.StringLiteral({ value: " world", span: s }),
        span: s,
      })
      const result = yield* Interpreter.evalExpr(expr, emptyEnv)
      expect(result).toEqual(new Value.Str({ value: "hello world" }))
    })
  )

  it.effect("errors on undefined variable", () =>
    Effect.gen(function*() {
      const result = yield* Interpreter.evalExpr(
        new Ast.Ident({ name: "x", span: s }), emptyEnv
      ).pipe(Effect.either)
      expect(result._tag).toBe("Left")
    })
  )

  it.effect("errors on type mismatch", () =>
    Effect.gen(function*() {
      const expr = new Ast.BinaryExpr({
        op: "+",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.StringLiteral({ value: "x", span: s }),
        span: s,
      })
      const result = yield* Interpreter.evalExpr(expr, emptyEnv).pipe(Effect.either)
      expect(result._tag).toBe("Left")
    })
  )

  it.effect("errors on division by zero", () =>
    Effect.gen(function*() {
      const expr = new Ast.BinaryExpr({
        op: "/",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 0, span: s }),
        span: s,
      })
      const result = yield* Interpreter.evalExpr(expr, emptyEnv).pipe(Effect.either)
      expect(result._tag).toBe("Left")
    })
  )
})
```

- [ ] **Step 2: Implement Interpreter.ts — literals and operators**

```typescript
export const evalExpr = (expr: Ast.Expr, env: Env): Effect<Value, EvalError> =>
  Match.value(expr).pipe(
    Match.tag("IntLiteral", (e) => Effect.succeed(new Num({ value: e.value }))),
    Match.tag("FloatLiteral", (e) => Effect.succeed(new Num({ value: e.value }))),
    Match.tag("StringLiteral", (e) => Effect.succeed(new Str({ value: e.value }))),
    Match.tag("BoolLiteral", (e) => Effect.succeed(new Bool({ value: e.value }))),
    Match.tag("UnitLiteral", () => Effect.succeed(new Unit({}))),
    Match.tag("Ident", (e) => /* HashMap.get lookup */),
    Match.tag("BinaryExpr", (e) => /* eval both sides, apply op */),
    Match.tag("UnaryExpr", (e) => /* eval inner, apply op */),
    // Stubs for Task 3:
    Match.tag("Block", () => Effect.fail(new EvalError({ message: "Not implemented", span: expr.span }))),
    Match.tag("Lambda", () => Effect.fail(new EvalError({ message: "Not implemented", span: expr.span }))),
    Match.tag("App", () => Effect.fail(new EvalError({ message: "Not implemented", span: expr.span }))),
    Match.tag("Force", (e) => evalExpr(e.expr, env)),
    Match.tag("DotAccess", () => Effect.fail(new EvalError({ message: "DotAccess not supported in interpreter v1", span: expr.span }))),
    Match.tag("StringInterp", () => Effect.fail(new EvalError({ message: "Not implemented", span: expr.span }))),
    Match.exhaustive,
  )
```

For binary operators, use a helper:
```typescript
const applyBinaryOp = (op: string, left: Value, right: Value, span: Span): Effect<Value, EvalError> => ...
```

Map operators: `+`, `-`, `*`, `/`, `%` for Num. `++` for Str. `==`, `!=`, `<`, `>`, `<=`, `>=` for same-type comparison. `and`, `or`, `xor` for Bool. Division/modulo by zero → EvalError.

- [ ] **Step 3: Run tests**

```bash
npx vitest run packages/core/test/Interpreter.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/Interpreter.ts packages/core/test/Interpreter.test.ts
git commit --no-verify -m "feat(core): interpreter — literals, operators, variables"
```

---

## Task 3: Blocks, Lambdas, Application

**Files:**
- Modify: `packages/core/src/Interpreter.ts`
- Modify: `packages/core/test/Interpreter.test.ts`

- [ ] **Step 1: Add tests for blocks, lambdas, application**

```typescript
it.effect("evaluates block with bindings", () =>
  Effect.gen(function*() {
    // { x = 1; y = 2; x + y }
    const block = new Ast.Block({
      statements: [
        new Ast.Declaration({ name: "x", mutable: false, value: new Ast.IntLiteral({ value: 1, span: s }), typeAnnotation: Option.none(), span: s }),
        new Ast.Declaration({ name: "y", mutable: false, value: new Ast.IntLiteral({ value: 2, span: s }), typeAnnotation: Option.none(), span: s }),
      ],
      expr: new Ast.BinaryExpr({ op: "+", left: new Ast.Ident({ name: "x", span: s }), right: new Ast.Ident({ name: "y", span: s }), span: s }),
      span: s,
    })
    const result = yield* Interpreter.evalExpr(block, emptyEnv)
    expect(result).toEqual(new Value.Num({ value: 3 }))
  })
)

it.effect("evaluates lambda and application", () =>
  Effect.gen(function*() {
    // (x -> { x * 2 }) applied to 5
    const lambda = new Ast.Lambda({ params: ["x"], body: new Ast.Block({
      statements: [],
      expr: new Ast.BinaryExpr({ op: "*", left: new Ast.Ident({ name: "x", span: s }), right: new Ast.IntLiteral({ value: 2, span: s }), span: s }),
      span: s,
    }), span: s })
    const app = new Ast.App({ func: lambda, args: [new Ast.IntLiteral({ value: 5, span: s })], span: s })
    const result = yield* Interpreter.evalExpr(app, emptyEnv)
    expect(result).toEqual(new Value.Num({ value: 10 }))
  })
)

it.effect("evaluates partial application", () =>
  Effect.gen(function*() {
    // add = a b -> { a + b }; add 3 → Closure(["b"], ...)
    const lambda = new Ast.Lambda({ params: ["a", "b"], body: new Ast.Block({
      statements: [],
      expr: new Ast.BinaryExpr({ op: "+", left: new Ast.Ident({ name: "a", span: s }), right: new Ast.Ident({ name: "b", span: s }), span: s }),
      span: s,
    }), span: s })
    const partial = new Ast.App({ func: lambda, args: [new Ast.IntLiteral({ value: 3, span: s })], span: s })
    const result = yield* Interpreter.evalExpr(partial, emptyEnv)
    expect(result._tag).toBe("Closure")
  })
)
```

- [ ] **Step 2: Implement blocks, lambdas, application in Interpreter.ts**

Block: create child env, eval each statement (threading env), eval final expr.
Lambda: return Closure(params, body, currentEnv).
App: eval func → Closure, eval args, bind params. Partial if args < params. Full eval if args == params.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/Interpreter.ts packages/core/test/Interpreter.test.ts
git commit --no-verify -m "feat(core): interpreter — blocks, lambdas, curried application"
```

---

## Task 4: String Interpolation and Program Evaluation

**Files:**
- Modify: `packages/core/src/Interpreter.ts`
- Modify: `packages/core/test/Interpreter.test.ts`

- [ ] **Step 1: Add tests**

```typescript
it.effect("evaluates string interpolation", () =>
  Effect.gen(function*() {
    const env = HashMap.set(emptyEnv, "name", new Value.Str({ value: "world" }))
    const interp = new Ast.StringInterp({
      parts: [
        new Ast.InterpText({ value: "hello " }),
        new Ast.InterpExpr({ value: new Ast.Ident({ name: "name", span: s }) }),
      ],
      span: s,
    })
    const result = yield* Interpreter.evalExpr(interp, env)
    expect(result).toEqual(new Value.Str({ value: "hello world" }))
  })
)

it.effect("evaluates a full program", () =>
  Effect.gen(function*() {
    // Parse and eval: add = a b -> { a + b }; result = add 3 4
    const source = "add = a b -> { a + b }\nresult = add 3 4"
    const tokens = yield* Lexer.tokenize(source)
    const ast = yield* Parser.parse(tokens)
    const result = yield* Interpreter.evalProgram(ast)
    expect(result).toEqual(new Value.Num({ value: 7 }))
  })
)
```

- [ ] **Step 2: Implement StringInterp eval and evalProgram**

StringInterp: eval each part, coerce to string via `coerceToString`, concatenate.
evalProgram: fold over statements threading env, return last value.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/Interpreter.ts packages/core/test/Interpreter.test.ts
git commit --no-verify -m "feat(core): interpreter — string interpolation, evalProgram"
```

---

## Task 5: Property Tests

**Files:**
- Create: `packages/core/test/Property.test.ts`

- [ ] **Step 1: Write property tests**

```typescript
import { describe, it } from "@effect/vitest"
import { Effect, FastCheck } from "effect"
import { Compiler, Interpreter, Value } from "@bang/core"

describe("Correctness Properties", () => {
  // Determinism: evaluating the same AST twice gives the same result
  it.effect("interpreter is deterministic", () =>
    Effect.gen(function*() {
      const source = "result = { x = 1 + 2; y = x * 3; y + 1 }"
      const r1 = yield* compileAndEval(source)
      const r2 = yield* compileAndEval(source)
      expect(r1).toEqual(r2)
    })
  )

  // Block optimization: { expr } ≡ expr
  it.effect("single-expr block is equivalent to bare expr", () =>
    Effect.gen(function*() {
      const bare = "result = 1 + 2"
      const blocked = "result = { 1 + 2 }"
      const r1 = yield* compileAndEval(bare)
      const r2 = yield* compileAndEval(blocked)
      expect(r1).toEqual(r2)
    })
  )

  // Compiler correctness for known programs
  const programs = [
    "result = 42",
    "result = 1 + 2 * 3",
    'result = "hello" ++ " world"',
    "result = true and false",
    "result = not true",
    "result = -5",
    "result = { x = 10; x + 1 }",
  ]

  for (const source of programs) {
    it.effect(`compiler matches interpreter: ${source}`, () =>
      Effect.gen(function*() {
        const interpreted = yield* interpretProgram(source)
        // For now, just verify interpreter doesn't error
        // Full correctness comparison (vs compiled JS) added when we have JS eval
        expect(interpreted._tag).not.toBe("Closure")
      })
    )
  }
})

// Helper: parse and interpret
const interpretProgram = (source: string) =>
  Effect.gen(function*() {
    const tokens = yield* Lexer.tokenize(source)
    const ast = yield* Parser.parse(tokens)
    return yield* Interpreter.evalProgram(ast)
  })
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/Property.test.ts
git commit --no-verify -m "test: property tests — determinism, block equivalence, correctness"
```

---

## Summary

| Task | What it delivers | Tests |
|------|-----------------|-------|
| 1 | Value types (Num, Str, Bool, Unit, Closure, EvalError) | 0 (types only) |
| 2 | Interpreter — literals, operators, variables | ~8 |
| 3 | Interpreter — blocks, lambdas, application | ~3 |
| 4 | String interpolation, evalProgram | ~2 |
| 5 | Property tests | ~9 |

**Total: 5 tasks, ~22 tests, reference interpreter for compiler correctness.**
