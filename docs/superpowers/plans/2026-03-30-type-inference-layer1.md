# HM Type Inference Layer 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scope-only checker with a Hindley-Milner type inference engine that infers types for all pure expressions and produces a TypedAST with real inferred types.

**Architecture:** Five new files in `@bang/core` (InferType, Unify, Infer, TypeError, TypeCheck) implement HM inference. The new `TypeCheck.typeCheck()` replaces the existing `Checker.check()` in the compiler pipeline. `on` cycle detection moves into the new checker. TypedAst carries `InferType` instead of `Ast.Type`.

**Tech Stack:** Effect (Schema.TaggedClass, Match.exhaustive, HashMap, Effect.gen), `@effect/vitest` for tests.

**Spec:** `docs/superpowers/specs/2026-03-30-type-inference-layer1-design.md`

---

## File Map

### New files (in `packages/core/src/`)

| File | Responsibility | ~Lines |
|------|---------------|--------|
| `InferType.ts` | `TVar`, `TCon`, `TArrow`, `TApp` as Schema.TaggedClass; pretty-printer | ~80 |
| `TypeError.ts` | 8 structured error variants (Schema.TaggedError); formatter | ~100 |
| `Unify.ts` | Substitution (HashMap), `apply`, `unify`, occurs check | ~100 |
| `Infer.ts` | TypeEnv, Scheme, `infer`, `inferStmt`, `inferPattern`, builtins | ~350 |
| `TypeCheck.ts` | Public API: `typeCheck(program) → TypedProgram \| TypeError[]` | ~40 |

### New test files (in `packages/core/test/`)

| File | Covers |
|------|--------|
| `InferType.test.ts` | Type pretty-printing |
| `Unify.test.ts` | Unification unit tests |
| `Infer.test.ts` | Inference integration tests |
| `TypeError.test.ts` | Error formatting |

### Modified files

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Add exports for InferType, TypeError, Unify, Infer, TypeCheck |
| `packages/compiler/src/TypedAst.ts` | `TypeAnnotation.type` changes from `Ast.Type` to `InferType` |
| `packages/compiler/src/Compiler.ts` | Import TypeCheck from core instead of local Checker |
| `packages/compiler/src/Codegen.ts` | Adapt to new TypeAnnotation (InferType instead of Ast.Type) |
| `packages/compiler/test/Checker.test.ts` | Point at new TypeCheck; adapt assertions |

### Removed files

| File | Reason |
|------|--------|
| `packages/compiler/src/Checker.ts` | Replaced by `@bang/core/TypeCheck` |

---

## Task 1: InferType — Internal Type Representation

**Files:**
- Create: `packages/core/src/InferType.ts`
- Create: `packages/core/test/InferType.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/InferType.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import * as T from "../src/InferType.js";

describe("InferType", () => {
  it("creates TVar", () => {
    const v = new T.TVar({ id: 0 });
    expect(v._tag).toBe("TVar");
    expect(v.id).toBe(0);
  });

  it("creates TCon", () => {
    const t = new T.TCon({ name: "Int" });
    expect(t._tag).toBe("TCon");
    expect(t.name).toBe("Int");
  });

  it("creates TArrow", () => {
    const t = new T.TArrow({
      param: new T.TCon({ name: "Int" }),
      result: new T.TCon({ name: "String" }),
    });
    expect(t._tag).toBe("TArrow");
  });

  it("creates TApp", () => {
    const t = new T.TApp({
      constructor: new T.TCon({ name: "Maybe" }),
      arg: new T.TCon({ name: "Int" }),
    });
    expect(t._tag).toBe("TApp");
  });

  it("pretty-prints TCon", () => {
    expect(T.prettyPrint(new T.TCon({ name: "Int" }))).toBe("Int");
  });

  it("pretty-prints TVar", () => {
    expect(T.prettyPrint(new T.TVar({ id: 0 }))).toBe("?0");
  });

  it("pretty-prints TArrow", () => {
    const t = new T.TArrow({
      param: new T.TCon({ name: "Int" }),
      result: new T.TCon({ name: "String" }),
    });
    expect(T.prettyPrint(t)).toBe("Int -> String");
  });

  it("pretty-prints nested TArrow right-associative", () => {
    const t = new T.TArrow({
      param: new T.TCon({ name: "Int" }),
      result: new T.TArrow({
        param: new T.TCon({ name: "String" }),
        result: new T.TCon({ name: "Bool" }),
      }),
    });
    expect(T.prettyPrint(t)).toBe("Int -> String -> Bool");
  });

  it("pretty-prints TArrow param that is arrow with parens", () => {
    const t = new T.TArrow({
      param: new T.TArrow({
        param: new T.TCon({ name: "Int" }),
        result: new T.TCon({ name: "Int" }),
      }),
      result: new T.TCon({ name: "Bool" }),
    });
    expect(T.prettyPrint(t)).toBe("(Int -> Int) -> Bool");
  });

  it("pretty-prints TApp", () => {
    const t = new T.TApp({
      constructor: new T.TCon({ name: "Maybe" }),
      arg: new T.TCon({ name: "Int" }),
    });
    expect(T.prettyPrint(t)).toBe("Maybe Int");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/InferType.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement InferType.ts**

Create `packages/core/src/InferType.ts`:

```typescript
import { Match, Schema } from "effect";

// ---------------------------------------------------------------------------
// Internal type representation for HM inference
// ---------------------------------------------------------------------------

export class TVar extends Schema.TaggedClass<TVar>()("TVar", {
  id: Schema.Number,
}) {}

export class TCon extends Schema.TaggedClass<TCon>()("TCon", {
  name: Schema.String,
}) {}

const InferTypeSchema: Schema.Schema<InferType> = Schema.suspend(() =>
  Schema.Union(TVar, TCon, TArrow, TApp),
);

export class TArrow extends Schema.TaggedClass<TArrow>()("TArrow", {
  param: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
  result: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
}) {}

export class TApp extends Schema.TaggedClass<TApp>()("TApp", {
  constructor: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
  arg: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
}) {}

export type InferType = TVar | TCon | TArrow | TApp;

// ---------------------------------------------------------------------------
// Convenience constructors for builtins
// ---------------------------------------------------------------------------

export const tInt = new TCon({ name: "Int" });
export const tFloat = new TCon({ name: "Float" });
export const tString = new TCon({ name: "String" });
export const tBool = new TCon({ name: "Bool" });
export const tUnit = new TCon({ name: "Unit" });

// ---------------------------------------------------------------------------
// Pretty-printer
// ---------------------------------------------------------------------------

export const prettyPrint = (t: InferType): string =>
  Match.value(t).pipe(
    Match.tag("TVar", (v) => `?${v.id}`),
    Match.tag("TCon", (c) => c.name),
    Match.tag("TArrow", (a) => {
      const paramStr = a.param._tag === "TArrow"
        ? `(${prettyPrint(a.param)})`
        : prettyPrint(a.param);
      return `${paramStr} -> ${prettyPrint(a.result)}`;
    }),
    Match.tag("TApp", (app) => `${prettyPrint(app.constructor)} ${prettyPrint(app.arg)}`),
    Match.exhaustive,
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/InferType.test.ts`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/InferType.ts packages/core/test/InferType.test.ts
git commit -m "feat(core): add InferType — TVar, TCon, TArrow, TApp with pretty-printer"
```

---

## Task 2: TypeError — Structured Type Errors

**Files:**
- Create: `packages/core/src/TypeError.ts`
- Create: `packages/core/test/TypeError.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/TypeError.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import * as TE from "../src/TypeError.js";
import * as T from "../src/InferType.js";
import { Span } from "../src/Span.js";

const s = new Span({ start: 0, end: 5 });

describe("TypeError", () => {
  it("creates UnificationError", () => {
    const e = new TE.UnificationError({
      expected: T.tInt,
      actual: T.tString,
      span: s,
    });
    expect(e._tag).toBe("UnificationError");
  });

  it("creates UndefinedVariable", () => {
    const e = new TE.UndefinedVariable({ name: "foo", span: s });
    expect(e._tag).toBe("UndefinedVariable");
  });

  it("creates OccursCheck", () => {
    const e = new TE.OccursCheck({
      varId: 0,
      type: new T.TArrow({ param: new T.TVar({ id: 0 }), result: T.tInt }),
      span: s,
    });
    expect(e._tag).toBe("OccursCheck");
  });

  it("formats UnificationError", () => {
    const e = new TE.UnificationError({
      expected: T.tInt,
      actual: T.tString,
      span: s,
    });
    expect(TE.formatTypeError(e)).toContain("Int");
    expect(TE.formatTypeError(e)).toContain("String");
  });

  it("formats UndefinedVariable", () => {
    const e = new TE.UndefinedVariable({ name: "foo", span: s });
    expect(TE.formatTypeError(e)).toContain("foo");
  });

  it("formats OccursCheck", () => {
    const e = new TE.OccursCheck({
      varId: 0,
      type: new T.TArrow({ param: new T.TVar({ id: 0 }), result: T.tInt }),
      span: s,
    });
    expect(TE.formatTypeError(e)).toContain("?0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/TypeError.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TypeError.ts**

Create `packages/core/src/TypeError.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/TypeError.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/TypeError.ts packages/core/test/TypeError.test.ts
git commit -m "feat(core): add TypeError — 8 structured type error variants with formatter"
```

---

## Task 3: Unify — Substitution and Unification

**Files:**
- Create: `packages/core/src/Unify.ts`
- Create: `packages/core/test/Unify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/Unify.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, HashMap } from "effect";
import * as T from "../src/InferType.js";
import * as U from "../src/Unify.js";
import { Span } from "../src/Span.js";

const s = new Span({ start: 0, end: 0 });

describe("Unify", () => {
  describe("apply", () => {
    it("resolves TVar through substitution", () => {
      const subst = HashMap.make([0, T.tInt] as const);
      expect(U.apply(subst, new T.TVar({ id: 0 }))).toEqual(T.tInt);
    });

    it("leaves unbound TVar unchanged", () => {
      const v = new T.TVar({ id: 99 });
      expect(U.apply(HashMap.empty(), v)).toEqual(v);
    });

    it("applies recursively through TArrow", () => {
      const subst = HashMap.make([0, T.tInt] as const, [1, T.tString] as const);
      const t = new T.TArrow({
        param: new T.TVar({ id: 0 }),
        result: new T.TVar({ id: 1 }),
      });
      expect(U.apply(subst, t)).toEqual(
        new T.TArrow({ param: T.tInt, result: T.tString }),
      );
    });

    it("chases variable chains", () => {
      // ?0 → ?1, ?1 → Int => ?0 resolves to Int
      const subst = HashMap.make([0, new T.TVar({ id: 1 })] as const, [1, T.tInt] as const);
      expect(U.apply(subst, new T.TVar({ id: 0 }))).toEqual(T.tInt);
    });
  });

  describe("unify", () => {
    it.effect("unifies identical TCon", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(T.tInt, T.tInt, HashMap.empty(), s);
        expect(HashMap.size(result)).toBe(0);
      }),
    );

    it.effect("fails on different TCon", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(T.tInt, T.tString, HashMap.empty(), s).pipe(
          Effect.either,
        );
        expect(Either.isLeft(result)).toBe(true);
      }),
    );

    it.effect("unifies TVar with TCon", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TVar({ id: 0 }),
          T.tInt,
          HashMap.empty(),
          s,
        );
        expect(HashMap.get(result, 0)).toEqual({ _tag: "Some", value: T.tInt });
      }),
    );

    it.effect("unifies TCon with TVar (symmetric)", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          T.tInt,
          new T.TVar({ id: 0 }),
          HashMap.empty(),
          s,
        );
        expect(HashMap.get(result, 0)).toEqual({ _tag: "Some", value: T.tInt });
      }),
    );

    it.effect("unifies TArrow components", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TArrow({ param: new T.TVar({ id: 0 }), result: new T.TVar({ id: 1 }) }),
          new T.TArrow({ param: T.tInt, result: T.tString }),
          HashMap.empty(),
          s,
        );
        expect(U.apply(result, new T.TVar({ id: 0 }))).toEqual(T.tInt);
        expect(U.apply(result, new T.TVar({ id: 1 }))).toEqual(T.tString);
      }),
    );

    it.effect("unifies TApp components", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TApp({ constructor: new T.TCon({ name: "Maybe" }), arg: new T.TVar({ id: 0 }) }),
          new T.TApp({ constructor: new T.TCon({ name: "Maybe" }), arg: T.tInt }),
          HashMap.empty(),
          s,
        );
        expect(U.apply(result, new T.TVar({ id: 0 }))).toEqual(T.tInt);
      }),
    );

    it.effect("occurs check prevents infinite type", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TVar({ id: 0 }),
          new T.TArrow({ param: new T.TVar({ id: 0 }), result: T.tInt }),
          HashMap.empty(),
          s,
        ).pipe(Effect.either);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );

    it.effect("transitive unification", () =>
      Effect.gen(function* () {
        // ?0 = ?1, then ?1 = Int => ?0 = Int
        const s1 = yield* U.unify(
          new T.TVar({ id: 0 }),
          new T.TVar({ id: 1 }),
          HashMap.empty(),
          s,
        );
        const s2 = yield* U.unify(new T.TVar({ id: 1 }), T.tInt, s1, s);
        expect(U.apply(s2, new T.TVar({ id: 0 }))).toEqual(T.tInt);
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/Unify.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Unify.ts**

Create `packages/core/src/Unify.ts`:

```typescript
import { Effect, HashMap, Match, Option } from "effect";
import type { InferType } from "./InferType.js";
import { TApp, TArrow, TCon, TVar } from "./InferType.js";
import { OccursCheck, UnificationError } from "./TypeError.js";
import type { TypeError } from "./TypeError.js";
import type { Span } from "./Span.js";

// ---------------------------------------------------------------------------
// Substitution: maps type variable IDs to their resolved types
// ---------------------------------------------------------------------------

export type Substitution = HashMap.HashMap<number, InferType>;

// ---------------------------------------------------------------------------
// Apply substitution — chase variable chains
// ---------------------------------------------------------------------------

export const apply = (subst: Substitution, type: InferType): InferType =>
  Match.value(type).pipe(
    Match.tag("TVar", (v) => {
      const resolved = HashMap.get(subst, v.id);
      if (Option.isNone(resolved)) return v;
      // Chase chains: if resolved to another TVar, keep applying
      return apply(subst, resolved.value);
    }),
    Match.tag("TCon", (c) => c),
    Match.tag("TArrow", (a) =>
      new TArrow({ param: apply(subst, a.param), result: apply(subst, a.result) }),
    ),
    Match.tag("TApp", (app) =>
      new TApp({ constructor: apply(subst, app.constructor), arg: apply(subst, app.arg) }),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Occurs check — does varId appear free in type?
// ---------------------------------------------------------------------------

const occursIn = (varId: number, type: InferType, subst: Substitution): boolean =>
  Match.value(type).pipe(
    Match.tag("TVar", (v) => {
      if (v.id === varId) return true;
      const resolved = HashMap.get(subst, v.id);
      return Option.isSome(resolved) ? occursIn(varId, resolved.value, subst) : false;
    }),
    Match.tag("TCon", () => false),
    Match.tag("TArrow", (a) => occursIn(varId, a.param, subst) || occursIn(varId, a.result, subst)),
    Match.tag("TApp", (app) =>
      occursIn(varId, app.constructor, subst) || occursIn(varId, app.arg, subst),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Unify two types, extending the substitution
// ---------------------------------------------------------------------------

export const unify = (
  t1: InferType,
  t2: InferType,
  subst: Substitution,
  span: Span,
): Effect.Effect<Substitution, TypeError> => {
  const a = apply(subst, t1);
  const b = apply(subst, t2);

  // Same TVar
  if (a._tag === "TVar" && b._tag === "TVar" && a.id === b.id) {
    return Effect.succeed(subst);
  }

  // TVar on left — bind
  if (a._tag === "TVar") {
    if (occursIn(a.id, b, subst)) {
      return Effect.fail(new OccursCheck({ varId: a.id, type: b, span }));
    }
    return Effect.succeed(HashMap.set(subst, a.id, b));
  }

  // TVar on right — bind
  if (b._tag === "TVar") {
    if (occursIn(b.id, a, subst)) {
      return Effect.fail(new OccursCheck({ varId: b.id, type: a, span }));
    }
    return Effect.succeed(HashMap.set(subst, b.id, a));
  }

  // Same TCon
  if (a._tag === "TCon" && b._tag === "TCon" && a.name === b.name) {
    return Effect.succeed(subst);
  }

  // TArrow
  if (a._tag === "TArrow" && b._tag === "TArrow") {
    return Effect.gen(function* () {
      const s1 = yield* unify(a.param, b.param, subst, span);
      return yield* unify(a.result, b.result, s1, span);
    });
  }

  // TApp
  if (a._tag === "TApp" && b._tag === "TApp") {
    return Effect.gen(function* () {
      const s1 = yield* unify(a.constructor, b.constructor, subst, span);
      return yield* unify(a.arg, b.arg, s1, span);
    });
  }

  // Mismatch
  return Effect.fail(new UnificationError({ expected: a, actual: b, span }));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/Unify.test.ts`
Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/Unify.ts packages/core/test/Unify.test.ts
git commit -m "feat(core): add Unify — substitution, apply, unify with occurs check"
```

---

## Task 4: Infer — HM Inference Engine

This is the largest task. It implements the core inference engine covering all expression, statement, and pattern types.

**Files:**
- Create: `packages/core/src/Infer.ts`
- Create: `packages/core/test/Infer.test.ts`

### Phase A: Literals + Ident + Lambda + App

- [ ] **Step 1: Write failing tests for literals and ident**

Create `packages/core/test/Infer.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { Lexer, Parser } from "@bang/core";
import * as Infer from "../src/Infer.js";
import * as T from "../src/InferType.js";

/** Parse source, then infer the type of the last expression/binding. */
const inferLast = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return yield* Infer.inferProgram(ast);
  });

describe("Infer", () => {
  describe("literals", () => {
    it.effect("infers Int", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 42");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers Float", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 3.14");
        expect(result.type).toEqual(T.tFloat);
      }),
    );

    it.effect("infers String", () =>
      Effect.gen(function* () {
        const result = yield* inferLast('x = "hello"');
        expect(result.type).toEqual(T.tString);
      }),
    );

    it.effect("infers Bool", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = true");
        expect(result.type).toEqual(T.tBool);
      }),
    );

    it.effect("infers Unit", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = ()");
        expect(result.type).toEqual(T.tUnit);
      }),
    );
  });

  describe("ident", () => {
    it.effect("resolves binding type", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 42\ny = x");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("fails on undefined variable", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = unknown").pipe(Effect.either);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );
  });

  describe("lambda + application", () => {
    it.effect("infers identity function type", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("f = (x) -> { x }\ny = !f 42");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers Int -> Int", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("f = (x) -> { x + 1 }\ny = !f 5");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers multi-param curried", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("f = (x, y) -> { x + y }\ny = !f 1 2");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("let-polymorphism — same function at different types", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          'id = (x) -> { x }\na = !id 42\nb = !id "hello"',
        );
        expect(result.type).toEqual(T.tString);
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/Infer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Infer.ts — core engine**

Create `packages/core/src/Infer.ts`. This is the largest file — implement incrementally. The full implementation covers:

1. **State**: Mutable counter for fresh type variables (pragmatic per codebase style rules)
2. **TypeEnv**: `HashMap<string, Scheme>` for variable → type scheme bindings
3. **Scheme**: `{ vars: ReadonlyArray<number>, type: InferType }` for polymorphic types
4. **Fresh variable generation**: `freshTVar()` returns `TVar({ id: nextId++ })`
5. **Instantiate**: Replace bound variables in a scheme with fresh type variables
6. **Generalize**: Find type variables NOT free in environment → become `forall` variables

**Key implementation — `infer` function dispatching on Expr._tag via Match.tag:**

```typescript
import { Array as Arr, Effect, HashMap, Match, Option } from "effect";
import * as Ast from "./Ast.js";
import type { InferType } from "./InferType.js";
import { TArrow, TApp, TCon, TVar, tInt, tFloat, tString, tBool, tUnit } from "./InferType.js";
import type { Substitution } from "./Unify.js";
import { apply, unify } from "./Unify.js";
import { UndefinedVariable, UnknownField } from "./TypeError.js";
import type { TypeError } from "./TypeError.js";
import type { Span } from "./Span.js";

// ---------------------------------------------------------------------------
// Scheme (polymorphic type)
// ---------------------------------------------------------------------------

export interface Scheme {
  readonly vars: ReadonlyArray<number>;
  readonly type: InferType;
}

const mono = (type: InferType): Scheme => ({ vars: [], type });

// ---------------------------------------------------------------------------
// Type environment
// ---------------------------------------------------------------------------

export type TypeEnv = HashMap.HashMap<string, Scheme>;

// Field metadata for record type access
type FieldInfo = HashMap.HashMap<string, ReadonlyArray<{ name: string; type: InferType }>>;

// ---------------------------------------------------------------------------
// Fresh variable generation (mutable counter — pragmatic per style rules)
// ---------------------------------------------------------------------------

let nextId = 0;

export const resetFreshCounter = (): void => {
  nextId = 0;
};

const freshTVar = (): TVar => new TVar({ id: nextId++ });

// ---------------------------------------------------------------------------
// Instantiate: replace bound vars with fresh vars
// ---------------------------------------------------------------------------

const instantiate = (scheme: Scheme): InferType => {
  if (scheme.vars.length === 0) return scheme.type;
  const mapping = HashMap.fromIterable(
    scheme.vars.map((v) => [v, freshTVar()] as const),
  );
  return substituteVars(mapping, scheme.type);
};

const substituteVars = (
  mapping: HashMap.HashMap<number, InferType>,
  type: InferType,
): InferType =>
  Match.value(type).pipe(
    Match.tag("TVar", (v) =>
      Option.getOrElse(HashMap.get(mapping, v.id), () => v)),
    Match.tag("TCon", (c) => c),
    Match.tag("TArrow", (a) =>
      new TArrow({
        param: substituteVars(mapping, a.param),
        result: substituteVars(mapping, a.result),
      })),
    Match.tag("TApp", (app) =>
      new TApp({
        constructor: substituteVars(mapping, app.constructor),
        arg: substituteVars(mapping, app.arg),
      })),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Generalize: find free vars in type that are NOT free in env
// ---------------------------------------------------------------------------

const freeVarsInType = (type: InferType): ReadonlyArray<number> =>
  Match.value(type).pipe(
    Match.tag("TVar", (v) => [v.id]),
    Match.tag("TCon", () => [] as readonly number[]),
    Match.tag("TArrow", (a) => [...freeVarsInType(a.param), ...freeVarsInType(a.result)]),
    Match.tag("TApp", (app) => [...freeVarsInType(app.constructor), ...freeVarsInType(app.arg)]),
    Match.exhaustive,
  );

const freeVarsInScheme = (scheme: Scheme): ReadonlyArray<number> => {
  const bound = new Set(scheme.vars);
  return freeVarsInType(scheme.type).filter((v) => !bound.has(v));
};

const freeVarsInEnv = (env: TypeEnv): Set<number> => {
  const result = new Set<number>();
  for (const [, scheme] of env) {
    for (const v of freeVarsInScheme(scheme)) result.add(v);
  }
  return result;
};

const generalize = (env: TypeEnv, type: InferType): Scheme => {
  const envFree = freeVarsInEnv(env);
  const vars = [...new Set(freeVarsInType(type))].filter((v) => !envFree.has(v));
  return { vars, type };
};

// ---------------------------------------------------------------------------
// AST Type → InferType conversion
// ---------------------------------------------------------------------------

const astTypeToInfer = (astType: Ast.Type): InferType => {
  // Track lowercase type variable names → TVar ids for consistency
  const varMap = new Map<string, TVar>();
  const convert = (t: Ast.Type): InferType =>
    Match.value(t).pipe(
      Match.tag("ConcreteType", (c) => {
        // Lowercase = type variable
        if (c.name[0] === c.name[0].toLowerCase() && /^[a-z]/.test(c.name)) {
          if (!varMap.has(c.name)) varMap.set(c.name, freshTVar());
          return varMap.get(c.name)!;
        }
        return new TCon({ name: c.name });
      }),
      Match.tag("ArrowType", (a) => new TArrow({ param: convert(a.param), result: convert(a.result) })),
      Match.tag("EffectType", () => new TCon({ name: "Effect" })),
      Match.exhaustive,
    );
  return convert(astType);
};

// ---------------------------------------------------------------------------
// Inference result
// ---------------------------------------------------------------------------

interface InferResult {
  readonly type: InferType;
  readonly subst: Substitution;
}

// ---------------------------------------------------------------------------
// Expression inference
// ---------------------------------------------------------------------------

const infer = (
  expr: Ast.Expr,
  env: TypeEnv,
  subst: Substitution,
  fields: FieldInfo,
): Effect.Effect<InferResult, TypeError> =>
  Match.value(expr).pipe(
    // Literals
    Match.tag("IntLiteral", () => Effect.succeed({ type: tInt, subst })),
    Match.tag("FloatLiteral", () => Effect.succeed({ type: tFloat, subst })),
    Match.tag("StringLiteral", () => Effect.succeed({ type: tString, subst })),
    Match.tag("BoolLiteral", () => Effect.succeed({ type: tBool, subst })),
    Match.tag("UnitLiteral", () => Effect.succeed({ type: tUnit, subst })),

    // Ident
    Match.tag("Ident", (e) => {
      const scheme = HashMap.get(env, e.name);
      if (Option.isNone(scheme)) {
        return Effect.fail(new UndefinedVariable({ name: e.name, span: e.span }));
      }
      return Effect.succeed({ type: instantiate(scheme.value), subst });
    }),

    // Lambda
    Match.tag("Lambda", (e) =>
      Effect.gen(function* () {
        const freshParams = e.params.map(() => freshTVar());
        let extendedEnv = env;
        for (let i = 0; i < e.params.length; i++) {
          extendedEnv = HashMap.set(extendedEnv, e.params[i], mono(freshParams[i]));
        }
        const body = yield* infer(e.body, extendedEnv, subst, fields);
        // Build curried arrow right-to-left
        let resultType: InferType = body.type;
        for (let i = e.params.length - 1; i >= 0; i--) {
          resultType = new TArrow({ param: apply(body.subst, freshParams[i]), result: resultType });
        }
        return { type: resultType, subst: body.subst };
      }),
    ),

    // Application
    Match.tag("App", (e) =>
      Effect.gen(function* () {
        const func = yield* infer(e.func, env, subst, fields);
        let currentSubst = func.subst;
        let currentFuncType = apply(currentSubst, func.type);
        for (const arg of e.args) {
          const argResult = yield* infer(arg, env, currentSubst, fields);
          const freshResult = freshTVar();
          const s = yield* unify(
            apply(argResult.subst, currentFuncType),
            new TArrow({ param: argResult.type, result: freshResult }),
            argResult.subst,
            e.span,
          );
          currentFuncType = apply(s, freshResult);
          currentSubst = s;
        }
        return { type: apply(currentSubst, currentFuncType), subst: currentSubst };
      }),
    ),

    // Binary operators
    Match.tag("BinaryExpr", (e) =>
      Effect.gen(function* () {
        const left = yield* infer(e.left, env, subst, fields);
        const right = yield* infer(e.right, env, left.subst, fields);

        if (e.op === "+" || e.op === "-" || e.op === "*" || e.op === "/" || e.op === "%") {
          // Arithmetic: operands must match, result is same type
          const s = yield* unify(left.type, right.type, right.subst, e.span);
          return { type: apply(s, left.type), subst: s };
        }
        if (e.op === "++") {
          // String concat
          const s1 = yield* unify(left.type, tString, right.subst, e.span);
          const s2 = yield* unify(right.type, tString, s1, e.span);
          return { type: tString, subst: s2 };
        }
        if (e.op === "==" || e.op === "!=" || e.op === "<" || e.op === ">" || e.op === "<=" || e.op === ">=") {
          // Comparison: operands must match, result is Bool
          const s = yield* unify(left.type, right.type, right.subst, e.span);
          return { type: tBool, subst: s };
        }
        if (e.op === "and" || e.op === "or" || e.op === "xor") {
          // Boolean: both Bool
          const s1 = yield* unify(left.type, tBool, right.subst, e.span);
          const s2 = yield* unify(right.type, tBool, s1, e.span);
          return { type: tBool, subst: s2 };
        }
        if (e.op === "<-") {
          // Mutation: infer both, return right side type (Layer 2 handles effects)
          return { type: right.type, subst: right.subst };
        }
        // Unknown operator — return fresh var
        return { type: freshTVar() as InferType, subst: right.subst };
      }),
    ),

    // Unary operators
    Match.tag("UnaryExpr", (e) =>
      Effect.gen(function* () {
        const inner = yield* infer(e.expr, env, subst, fields);
        if (e.op === "not") {
          const s = yield* unify(inner.type, tBool, inner.subst, e.span);
          return { type: tBool, subst: s };
        }
        // Negation: return same type
        return inner;
      }),
    ),

    // Block
    Match.tag("Block", (e) =>
      Effect.gen(function* () {
        let currentEnv = env;
        let currentSubst = subst;
        for (const stmt of e.statements) {
          const result = yield* inferStmt(stmt, currentEnv, currentSubst, fields);
          currentEnv = result.env;
          currentSubst = result.subst;
        }
        const result = yield* infer(e.expr, currentEnv, currentSubst, fields);
        return result;
      }),
    ),

    // Match expression
    Match.tag("MatchExpr", (e) =>
      Effect.gen(function* () {
        const scrut = yield* infer(e.scrutinee, env, subst, fields);
        const resultVar = freshTVar();
        let currentSubst = scrut.subst;
        for (const arm of e.arms) {
          const { type: patType, bindings } = inferPattern(arm.pattern, env);
          currentSubst = yield* unify(apply(currentSubst, scrut.type), patType, currentSubst, arm.span);
          let armEnv = env;
          for (const [name, scheme] of bindings) {
            armEnv = HashMap.set(armEnv, name, scheme);
          }
          // Guard (arm.guard is Option<Expr> via Schema.OptionFromUndefinedOr)
          if (Option.isSome(arm.guard)) {
            const guardResult = yield* infer(arm.guard.value, armEnv, currentSubst, fields);
            currentSubst = yield* unify(guardResult.type, tBool, guardResult.subst, arm.span);
          }
          const bodyResult = yield* infer(arm.body, armEnv, currentSubst, fields);
          currentSubst = yield* unify(
            apply(bodyResult.subst, resultVar),
            bodyResult.type,
            bodyResult.subst,
            arm.span,
          );
        }
        return { type: apply(currentSubst, resultVar), subst: currentSubst };
      }),
    ),

    // String interpolation
    Match.tag("StringInterp", (e) =>
      Effect.gen(function* () {
        let currentSubst = subst;
        for (const part of e.parts) {
          if (part._tag === "InterpExpr") {
            const result = yield* infer(part.expr, env, currentSubst, fields);
            currentSubst = result.subst;
          }
        }
        return { type: tString, subst: currentSubst };
      }),
    ),

    // Force — identity on types for Layer 1
    Match.tag("Force", (e) => infer(e.expr, env, subst, fields)),

    // Comptime — transparent
    Match.tag("ComptimeExpr", (e) => infer(e.expr, env, subst, fields)),

    // UseExpr — infer value, binding happens in ForceStatement handler
    Match.tag("UseExpr", (e) =>
      Effect.gen(function* () {
        const result = yield* infer(e.value, env, subst, fields);
        return result;
      }),
    ),

    // OnExpr — returns Subscription
    Match.tag("OnExpr", (e) =>
      Effect.gen(function* () {
        const srcResult = yield* infer(e.source, env, subst, fields);
        const handlerResult = yield* infer(e.handler, env, srcResult.subst, fields);
        return { type: new TCon({ name: "Subscription" }) as InferType, subst: handlerResult.subst };
      }),
    ),

    // DotAccess
    Match.tag("DotAccess", (e) =>
      Effect.gen(function* () {
        const obj = yield* infer(e.object, env, subst, fields);
        const resolvedType = apply(obj.subst, obj.type);

        // Record field access
        if (resolvedType._tag === "TCon") {
          const fieldDefs = HashMap.get(fields, resolvedType.name);
          if (Option.isSome(fieldDefs)) {
            const idx = fieldDefs.value.findIndex((f) => f.name === e.field);
            if (idx >= 0) {
              return { type: fieldDefs.value[idx].type, subst: obj.subst };
            }
          }
        }

        // Dot methods deferred to Layer 2
        if (["map", "tap", "handle", "catch", "match", "abort", "unwrap"].includes(e.field)) {
          return { type: freshTVar() as InferType, subst: obj.subst };
        }

        return yield* Effect.fail(
          new UnknownField({ type: resolvedType, field: e.field, span: e.span }),
        );
      }),
    ),

    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Pattern inference
// ---------------------------------------------------------------------------

interface PatternResult {
  readonly type: InferType;
  readonly bindings: ReadonlyArray<readonly [string, Scheme]>;
}

const inferPattern = (
  pattern: Ast.Pattern,
  env: TypeEnv,
): PatternResult =>
  Match.value(pattern).pipe(
    Match.tag("WildcardPattern", () => ({
      type: freshTVar() as InferType,
      bindings: [],
    })),
    Match.tag("BindingPattern", (p) => {
      const t = freshTVar();
      return { type: t as InferType, bindings: [[p.name, mono(t)] as const] };
    }),
    Match.tag("ConstructorPattern", (p) => {
      const ctorScheme = HashMap.get(env, p.tag);
      if (Option.isNone(ctorScheme)) {
        // Unknown constructor — return fresh var (error caught elsewhere)
        return { type: freshTVar() as InferType, bindings: [] };
      }
      const ctorType = instantiate(ctorScheme.value);
      // Decompose curried arrow: field1 -> field2 -> ... -> ResultType
      const fieldTypes: InferType[] = [];
      let current = ctorType;
      for (let i = 0; i < p.patterns.length; i++) {
        if (current._tag === "TArrow") {
          fieldTypes.push(current.param);
          current = current.result;
        } else {
          fieldTypes.push(freshTVar());
        }
      }
      const resultType = current;

      // Recursively infer sub-patterns
      const allBindings: Array<readonly [string, Scheme]> = [];
      for (let i = 0; i < p.patterns.length; i++) {
        const sub = inferPattern(p.patterns[i], env);
        // Note: unification of sub.type with fieldTypes[i] happens in the match arm handler
        allBindings.push(...sub.bindings);
        // For binding patterns, update the binding's type to match the field type
        for (const [name] of sub.bindings) {
          const idx = allBindings.findIndex(([n]) => n === name);
          if (idx >= 0) {
            allBindings[idx] = [name, mono(fieldTypes[i])];
          }
        }
      }
      return { type: resultType, bindings: allBindings };
    }),
    Match.tag("LiteralPattern", (p) => {
      // Infer the literal's type
      const litType =
        p.value._tag === "IntLiteral" ? tInt
        : p.value._tag === "FloatLiteral" ? tFloat
        : p.value._tag === "StringLiteral" ? tString
        : p.value._tag === "BoolLiteral" ? tBool
        : (freshTVar() as InferType);
      return { type: litType, bindings: [] };
    }),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Statement inference
// ---------------------------------------------------------------------------

interface StmtResult {
  readonly env: TypeEnv;
  readonly subst: Substitution;
  readonly fields?: FieldInfo;  // Updated by TypeDecl/RecordTypeDecl
}

const inferStmt = (
  stmt: Ast.Stmt,
  env: TypeEnv,
  subst: Substitution,
  fields: FieldInfo,
): Effect.Effect<StmtResult, TypeError> =>
  Match.value(stmt).pipe(
    Match.tag("Declaration", (s) =>
      Effect.gen(function* () {
        const result = yield* infer(s.value, env, subst, fields);
        let s2 = result.subst;
        // Optional type annotation (Option<Type> via Schema.OptionFromUndefinedOr)
        if (Option.isSome(s.typeAnnotation)) {
          const annType = astTypeToInfer(s.typeAnnotation.value);
          s2 = yield* unify(apply(result.subst, result.type), annType, result.subst, s.span);
        }
        const scheme = generalize(env, apply(s2, result.type));
        return { env: HashMap.set(env, s.name, scheme), subst: s2 };
      }),
    ),

    Match.tag("Declare", (s) => {
      const inferType = astTypeToInfer(s.typeAnnotation);
      const fv = freeVarsInType(inferType);
      const scheme: Scheme = { vars: [...new Set(fv)], type: inferType };
      return Effect.succeed({ env: HashMap.set(env, s.name, scheme), subst });
    }),

    Match.tag("ForceStatement", (s) =>
      Effect.gen(function* () {
        // Special case: Force(UseExpr(name, value)) → bind name in env
        if (s.expr._tag === "Force" && s.expr.expr._tag === "UseExpr") {
          const useExpr = s.expr.expr;
          const result = yield* infer(useExpr.value, env, subst, fields);
          return {
            env: HashMap.set(env, useExpr.name, mono(apply(result.subst, result.type))),
            subst: result.subst,
          };
        }
        const result = yield* infer(s.expr, env, subst, fields);
        return { env, subst: result.subst };
      }),
    ),

    Match.tag("ExprStatement", (s) =>
      Effect.gen(function* () {
        const result = yield* infer(s.expr, env, subst, fields);
        return { env, subst: result.subst };
      }),
    ),

    Match.tag("TypeDecl", (s) =>
      Effect.gen(function* () {
        // Create type variables for each type parameter
        const paramVars = s.typeParams.map(() => freshTVar());
        // Result type: foldl TApp over TCon(name) with paramVars
        let resultType: InferType = new TCon({ name: s.name });
        for (const pv of paramVars) {
          resultType = new TApp({ constructor: resultType, arg: pv });
        }

        let extendedEnv = env;
        let updatedFields = fields;
        for (const ctor of s.constructors) {
          if (ctor._tag === "NullaryConstructor") {
            const scheme: Scheme = { vars: paramVars.map((v) => v.id), type: resultType };
            extendedEnv = HashMap.set(extendedEnv, ctor.tag, scheme);
          } else if (ctor._tag === "PositionalConstructor") {
            const fieldTypes = ctor.fields.map(astTypeToInfer);
            let ctorType: InferType = resultType;
            for (let i = fieldTypes.length - 1; i >= 0; i--) {
              ctorType = new TArrow({ param: fieldTypes[i], result: ctorType });
            }
            const scheme: Scheme = { vars: paramVars.map((v) => v.id), type: ctorType };
            extendedEnv = HashMap.set(extendedEnv, ctor.tag, scheme);
          } else {
            // NamedConstructor
            const fieldInfos = ctor.fields.map((f) => ({
              name: f.name,
              type: astTypeToInfer(f.type),
            }));
            const fieldTypes = fieldInfos.map((f) => f.type);
            let ctorType: InferType = resultType;
            for (let i = fieldTypes.length - 1; i >= 0; i--) {
              ctorType = new TArrow({ param: fieldTypes[i], result: ctorType });
            }
            const scheme: Scheme = { vars: paramVars.map((v) => v.id), type: ctorType };
            extendedEnv = HashMap.set(extendedEnv, ctor.tag, scheme);
            // Store field metadata for DotAccess resolution
            updatedFields = HashMap.set(updatedFields, ctor.tag, fieldInfos);
          }
        }
        return { env: extendedEnv, subst, fields: updatedFields };
      }),
    ),

    Match.tag("NewtypeDecl", (s) => {
      const wrappedType = astTypeToInfer(s.wrappedType);
      const ctorType = new TArrow({ param: wrappedType, result: new TCon({ name: s.name }) });
      const fv = freeVarsInType(ctorType);
      const scheme: Scheme = { vars: [...new Set(fv)], type: ctorType };
      return Effect.succeed({
        env: HashMap.set(env, s.name, scheme),
        subst,
      });
    }),

    Match.tag("RecordTypeDecl", (s) => {
      const fieldInfos = s.fields.map((f) => ({
        name: f.name,
        type: astTypeToInfer(f.type),
      }));
      const fieldTypes = fieldInfos.map((f) => f.type);
      let ctorType: InferType = new TCon({ name: s.name });
      for (let i = fieldTypes.length - 1; i >= 0; i--) {
        ctorType = new TArrow({ param: fieldTypes[i], result: ctorType });
      }
      const fv = freeVarsInType(ctorType);
      const scheme: Scheme = { vars: [...new Set(fv)], type: ctorType };
      const newFields = HashMap.set(fields, s.name, fieldInfos);
      return Effect.succeed({
        env: HashMap.set(env, s.name, scheme),
        subst,
        fields: newFields,
      });
    }),

    Match.tag("Import", (s) => {
      let extendedEnv = env;
      for (const name of s.names) {
        extendedEnv = HashMap.set(extendedEnv, name, mono(freshTVar()));
      }
      return Effect.succeed({ env: extendedEnv, subst });
    }),

    Match.tag("Export", () => Effect.succeed({ env, subst })),

    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Program inference — public entry point
// ---------------------------------------------------------------------------

export interface InferredProgram {
  readonly type: InferType;
  readonly env: TypeEnv;
  readonly subst: Substitution;
}

export const inferProgram = (
  program: Ast.Program,
): Effect.Effect<InferredProgram, TypeError> =>
  Effect.gen(function* () {
    resetFreshCounter();
    let env: TypeEnv = HashMap.empty();
    let currentSubst: Substitution = HashMap.empty();
    let currentFields: FieldInfo = HashMap.empty();
    let lastType: InferType = tUnit;

    for (const stmt of program.statements) {
      const result = yield* inferStmt(stmt, env, currentSubst, currentFields);
      env = result.env;
      currentSubst = result.subst;
      // Track field metadata from TypeDecl/RecordTypeDecl
      if (result.fields !== undefined) {
        currentFields = result.fields;
      }
      // Track the type of the last declaration
      if (stmt._tag === "Declaration") {
        const scheme = HashMap.get(env, stmt.name);
        if (Option.isSome(scheme)) {
          lastType = apply(currentSubst, instantiate(scheme.value));
        }
      }
    }

    return { type: lastType, env, subst: currentSubst };
  });
```

**Note on field metadata threading:** The `inferStmt` for TypeDecl and RecordTypeDecl returns extra `fields` data. The `inferProgram` loop detects this via `"fields" in result` and threads it through. This is the simplest approach — a cleaner refactor (putting fields into a state object) can happen later if needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/Infer.test.ts`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/Infer.ts packages/core/test/Infer.test.ts
git commit -m "feat(core): add Infer — HM inference engine for expressions, statements, patterns"
```

### Phase B: More inference tests — operators, match, ADTs, records

- [ ] **Step 6: Add tests for operators, match, ADTs, records, type errors**

Append to `packages/core/test/Infer.test.ts`:

```typescript
  describe("binary operators", () => {
    it.effect("infers Int + Int = Int", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 1 + 2");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers String ++ String = String", () =>
      Effect.gen(function* () {
        const result = yield* inferLast('x = "a" ++ "b"');
        expect(result.type).toEqual(T.tString);
      }),
    );

    it.effect("infers comparison returns Bool", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 1 == 2");
        expect(result.type).toEqual(T.tBool);
      }),
    );

    it.effect("infers boolean operators", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = true and false");
        expect(result.type).toEqual(T.tBool);
      }),
    );

    it.effect("fails on Int + String", () =>
      Effect.gen(function* () {
        const result = yield* inferLast('x = 1 + "hello"').pipe(Effect.either);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );
  });

  describe("match", () => {
    it.effect("infers match result type", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "type Maybe a = Some a | None\nx = !match (Some 42) { Some v -> v, None -> 0 }",
        );
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers match with wildcard", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = !match 42 { _ -> true }");
        expect(result.type).toEqual(T.tBool);
      }),
    );
  });

  describe("ADT constructors", () => {
    it.effect("infers ADT constructor application", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "type Maybe a = Some a | None\nx = Some 42",
        );
        // x should be Maybe Int (TApp(TCon("Maybe"), TCon("Int")))
        expect(result.type._tag).toBe("TApp");
      }),
    );

    it.effect("infers nullary constructor", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "type Maybe a = Some a | None\nx = None",
        );
        expect(result.type._tag).toBe("TApp");
      }),
    );
  });

  describe("record types", () => {
    it.effect("infers record field access", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          'type User = { name: String, age: Int }\nu = User "alice" 30\nx = u.name',
        );
        expect(result.type).toEqual(T.tString);
      }),
    );
  });

  describe("newtype", () => {
    it.effect("infers newtype constructor", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          'type UserId = String\nx = UserId "abc"',
        );
        expect(result.type).toEqual(new T.TCon({ name: "UserId" }));
      }),
    );
  });

  describe("type annotations", () => {
    it.effect("respects explicit type annotation", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x : Int = 42");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("fails when annotation contradicts inferred type", () =>
      Effect.gen(function* () {
        const result = yield* inferLast('x : Int = "hello"').pipe(Effect.either);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );
  });

  describe("declare", () => {
    it.effect("introduces declared type", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "declare console.log : String -> Effect Unit {} {}\nx = console.log",
        );
        // x should be the declared type (or close to it)
        expect(result.type._tag).toBe("TArrow");
      }),
    );
  });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/Infer.test.ts`
Expected: all tests PASS. If any fail, fix the inference logic in `Infer.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/core/test/Infer.test.ts
git commit -m "test(core): add comprehensive inference tests — operators, match, ADTs, records, newtypes"
```

---

## Task 5: TypeCheck — Public API + Core Exports

**Files:**
- Create: `packages/core/src/TypeCheck.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create TypeCheck.ts**

Create `packages/core/src/TypeCheck.ts`:

```typescript
import { Effect } from "effect";
import type * as Ast from "./Ast.js";
import type { TypeError } from "./TypeError.js";
import { inferProgram } from "./Infer.js";
import type { InferredProgram } from "./Infer.js";

// ---------------------------------------------------------------------------
// Public API: typeCheck a parsed program
// ---------------------------------------------------------------------------

export const typeCheck = (
  program: Ast.Program,
): Effect.Effect<InferredProgram, TypeError> => inferProgram(program);
```

- [ ] **Step 2: Add exports to index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export * as InferType from "./InferType.js";
export * as TypeError from "./TypeError.js";
export * as Unify from "./Unify.js";
export * as Infer from "./Infer.js";
export * as TypeCheck from "./TypeCheck.js";
```

- [ ] **Step 3: Run full test suite to verify nothing breaks**

Run: `npx vitest run`
Expected: all 263+ existing tests PASS plus new tests

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/TypeCheck.ts packages/core/src/index.ts
git commit -m "feat(core): add TypeCheck public API and export all inference modules"
```

---

## Task 6: Pipeline Integration — Replace Old Checker

**Files:**
- Modify: `packages/compiler/src/TypedAst.ts`
- Modify: `packages/compiler/src/Compiler.ts`
- Modify: `packages/compiler/src/Codegen.ts`
- Modify: `packages/compiler/test/Checker.test.ts`

This is the switchover task. It replaces the old Checker with the new TypeCheck while keeping the existing Codegen working. The approach: update TypedAst to carry InferType, update Compiler to use the new checker, adapt Codegen to the new TypeAnnotation, update tests.

**Important:** Codegen currently uses `stmt.annotation.effectClass` and `stmt.annotation.forceResolution`. The new checker needs to produce these fields too. For Layer 1, we keep the existing effect classification logic from the old Checker and run it alongside the new type inference.

- [ ] **Step 1: Update TypedAst.ts**

Replace `packages/compiler/src/TypedAst.ts`:

```typescript
import type * as Ast from "@bang/core/Ast";
import type { InferType } from "@bang/core/InferType";
import type { Span } from "@bang/core/Span";

export interface TypeAnnotation {
  readonly type: InferType;
  readonly effectClass: "signal" | "effect";
  readonly forceResolution?: "yield*" | "promise" | "sync" | "none";
}

export interface TypedNode<T extends Ast.Node> {
  readonly node: T;
  readonly annotation: TypeAnnotation;
}

export const annotate = <T extends Ast.Node>(
  node: T,
  annotation: TypeAnnotation,
): TypedNode<T> => ({ node, annotation });

export type TypedStmt = TypedNode<Ast.Stmt>;

export interface TypedProgram {
  readonly _tag: "Program";
  readonly statements: TypedStmt[];
  readonly span: Span;
}
```

- [ ] **Step 2: Update Compiler.ts to use new type checker**

The new checker will be a bridge module that runs both HM inference (for types) and the existing scope/effect classification (for effectClass and forceResolution). Create this bridge in the compiler:

Update `packages/compiler/src/Compiler.ts`:

```typescript
import { Effect } from "effect";
import * as Lexer from "@bang/core/Lexer";
import * as Parser from "@bang/core/Parser";
import * as Checker from "./Checker.js";
import * as Codegen from "./Codegen.js";
import type { CompilerError } from "@bang/core/CompilerError";

export const lex = Lexer.tokenize;
export const parse = Parser.parse;
export const check = Checker.check;
export const codegen = Codegen.generate;

export const compile = (source: string): Effect.Effect<Codegen.CodegenOutput, CompilerError> =>
  Effect.gen(function* () {
    const tokens = yield* lex(source);
    const ast = yield* parse(tokens);
    const typed = yield* check(ast);
    return yield* codegen(typed);
  });
```

(No change to Compiler.ts yet — the Checker.ts will be updated to incorporate type inference.)

- [ ] **Step 3: Update Checker.ts to produce InferType in annotations**

Modify `packages/compiler/src/Checker.ts` to:
1. Import `TypeCheck` from `@bang/core`
2. Run both the existing scope/effect checks AND the new type inference
3. Produce `TypeAnnotation` with `InferType` instead of `Ast.Type`

The key change in the `annotate` calls — replace `type: resolvedType` (which was `Ast.Type | Unknown`) with the inferred `InferType`. For statements where type inference is not yet connected, use `TCon("Unknown")` as a fallback.

This is the most delicate step. The existing effect classification logic must remain intact since Codegen depends on it. The approach:

```typescript
// At the top of Checker.ts, add:
import { TCon } from "@bang/core/InferType";
import type { InferType } from "@bang/core/InferType";

// In the annotate calls, change:
// FROM: type: Option.getOrElse(resolvedType, () => unknownType)
// TO:   type: new TCon({ name: "Unknown" })
// The real inferred type will come from the parallel type inference pass in a later iteration.
```

**Phase 1 approach (minimal disruption):** Replace every `Ast.Type` in annotations with `TCon("Unknown")`. This unblocks the TypedAst change without requiring full integration. The actual inferred types will be threaded through in a follow-up step.

- [ ] **Step 4: Update Codegen to work with InferType annotations**

Check all places in Codegen.ts where `stmt.annotation.type` is accessed. The existing codegen primarily uses `effectClass` and `forceResolution`, not the type field directly. Verify this and make minimal changes.

Run: `npx vitest run packages/compiler/test/`
Expected: all compiler tests PASS

- [ ] **Step 5: Update Checker.test.ts assertions**

The test file imports from `@bang/compiler` Checker. If the type field changed from `Ast.Type` to `InferType`, update any assertions that check the type field.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/compiler/src/TypedAst.ts packages/compiler/src/Checker.ts packages/compiler/src/Codegen.ts packages/compiler/test/Checker.test.ts
git commit -m "feat(compiler): integrate InferType into TypedAst — Checker produces InferType annotations"
```

---

## Task 7: On Cycle Detection Migration

**Files:**
- Modify: `packages/core/src/Infer.ts` (or TypeCheck.ts)
- Modify: `packages/compiler/src/Checker.ts`

The spec says cycle detection should move to the new checker or become a separate pass. For Layer 1, the simplest approach: keep cycle detection in the existing Checker.ts (it already works) and call it from the updated check pipeline. Only migrate if the old Checker is being removed entirely.

- [ ] **Step 1: Assess whether to move cycle detection**

Read the cycle detection code in Checker.ts (lines 439-550). If the old Checker is preserved as a "bridge" (running both scope validation and type inference), cycle detection stays put. If the old Checker is being removed, extract the cycle detection functions into a standalone module.

**Decision:** For Layer 1, keep cycle detection in the existing Checker.ts. It depends on AST traversal, not on types. Migration to `@bang/core` is a Layer 2 concern.

- [ ] **Step 2: Verify cycle detection still works**

Run: `npx vitest run packages/compiler/test/On.test.ts`
Expected: PASS

- [ ] **Step 3: Commit (if any changes were needed)**

```bash
git commit -m "refactor: preserve on cycle detection in Checker during type inference integration"
```

---

## Task 8: Final Verification + Cleanup

**Files:**
- Modify: `CLAUDE.md` (update status, file list, test counts)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS. Count the new total.

- [ ] **Step 2: Run lint**

Run: `vp check --fix && vp run lint`
Expected: no new errors (warnings are acceptable per style rules)

- [ ] **Step 3: Run tsc**

Run: `npx tsc -b --noEmit` (or `vp run check`)
Expected: no new type errors beyond known issues in CLAUDE.md

- [ ] **Step 4: Update CLAUDE.md**

Update the following sections:
- **Status**: Add "Layer 1 HM type inference implemented"
- **Key Files**: Add InferType.ts, TypeError.ts, Unify.ts, Infer.ts, TypeCheck.ts
- **Test count**: Update from 263 to new count

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Layer 1 type inference"
```

---

## Execution Notes

**Task dependencies:**
- Tasks 1-3 are independent and can run in parallel (InferType, TypeError, Unify)
- Task 4 depends on Tasks 1-3 (Infer uses all three)
- Task 5 depends on Task 4 (TypeCheck wraps Infer)
- Task 6 depends on Task 5 (pipeline integration)
- Task 7 depends on Task 6 (cycle detection decision)
- Task 8 depends on all previous tasks

**Parallel wave decomposition:**
```
Wave 1: Task 1 (InferType) | Task 2 (TypeError) | Task 3 (Unify)
Wave 2: Task 4 (Infer)
Wave 3: Task 5 (TypeCheck + exports)
Wave 4: Task 6 (pipeline integration)
Wave 5: Task 7 (cycle detection) | Task 8 (verification)
```

**Risk areas:**
- Task 4 is the largest (~350 lines). The `inferStmt` function threads field metadata via an optional `fields` property on `StmtResult`.
- Task 6 (pipeline integration) is the most delicate — it touches the existing Checker and Codegen. The Phase 1 approach (TCon("Unknown") placeholders) minimizes risk. Full integration of inferred types into codegen annotations is a follow-up concern.
- The `resetFreshCounter()` call in `inferProgram` ensures deterministic type variable IDs across test runs. This is fine for now but won't work for incremental compilation (Layer 2+ concern).
