# Bang Compiler v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add blocks, lambdas, binary/unary operators, and string interpolation — enabling real programs with functions, arithmetic, and control flow.

**Architecture:** Each feature adds AST nodes, parser productions, checker rules, and codegen patterns. Changes cascade through the pipeline but each feature is independently testable. The codebase follows Effect conventions: Schema.TaggedClass for AST, Match.tag for dispatch, Effect.gen + Effect.fail for control flow, HashMap for scope.

**Tech Stack:** TypeScript, Effect (Schema, Match, HashMap, Option, Effect.gen), Vite+ (`vp`), `@effect/vitest`

**Reference:**

- Language spec: `docs/language-spec.md`
- Current codebase: `packages/core/src/` (Ast.ts, Lexer.ts, Parser.ts, Checker.ts, Codegen.ts)

**Effect conventions (MANDATORY for all code):**

- `new Ast.X({...})` for constructors (Schema.TaggedClass)
- `Match.tag` for all AST/token dispatch — no switch/case on `_tag`
- `Effect.fail(new CheckError({...}))` — no throw
- `Option` for nullable values — no undefined
- `HashMap` for scope — no mutable Map
- `Effect.gen(function*() { ... })` for sequential effects
- if/else guards inside Effect.gen for simple early returns are fine
- Character predicates stay as simple boolean functions

---

## v0.2 Target Program

```bang
declare console.log : String -> Effect Unit { stdout } {}
declare fetch : String -> Effect String { net } {}

-- lambdas: bare params, Haskell-style, auto-curried
add = a b -> { a + b }
double = x -> { x * 2 }
greet = name -> { "hello ${name}" }
negate = x -> { -x }

-- blocks sequence effects (like async/await)
userData = !{
  raw = !fetch "/api/user/42"
  !console.log "fetched: ${raw}"
  raw
}

-- pure blocks for local scope
result = {
  x = add 3 4
  y = double x
  x + y
}

-- partial application falls out from currying
addThree = add 3
seven = addThree 4

-- pipeline with .tap for interception (inherits Effect.tap)
!fetch "/api/data"
  .tap (v) -> { !console.log "got: ${v}" }
  .map (v) -> { v ++ " processed" }

!console.log (greet "world")
!console.log "result: ${result}"
!console.log "is 21: ${result == 21}"
!console.log "negated: ${negate 5}"
```

---

## File Structure (changes only)

```
packages/core/src/
  Ast.ts          + Block, Lambda, BinaryExpr, UnaryExpr, StringInterp nodes
  Token.ts        + StringPart token for interpolation
  Lexer.ts        + interpolation tokenizer, recognize FloatLit
  Parser.ts       + parseBlock, parseLambda, Pratt parser for operators
  Checker.ts      + block scope push/pop, lambda param bindings
  Codegen.ts      + emit blocks, lambdas, operators, template literals

packages/core/test/
  Block.test.ts       new: block expression tests
  Lambda.test.ts      new: lambda tests
  Operator.test.ts    new: binary/unary operator tests
  Interp.test.ts      new: string interpolation tests
  Compiler.test.ts    + v0.2 end-to-end test
```

---

## Task 1: AST Nodes for v0.2

**Files:**

- Modify: `packages/core/src/Ast.ts`

- [ ] **Step 1: Add Block, Lambda, BinaryExpr, UnaryExpr, StringInterp to Ast.ts**

New expression nodes:

```typescript
export class Block extends Schema.TaggedClass<Block>()("Block", {
  statements: Schema.Array(Schema.suspend(() => StmtSchema)),
  expr: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
  span: Span,
}) {}

export class Lambda extends Schema.TaggedClass<Lambda>()("Lambda", {
  params: Schema.Array(Schema.String),
  body: Schema.suspend((): Schema.Schema<Expr> => ExprSchema), // always a Block
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

export class StringInterp extends Schema.TaggedClass<StringInterp>()("StringInterp", {
  parts: Schema.Array(
    Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("text"), value: Schema.String }),
      Schema.Struct({
        _tag: Schema.Literal("expr"),
        value: Schema.suspend((): Schema.Schema<Expr> => ExprSchema),
      }),
    ),
  ),
  span: Span,
}) {}
```

Update `Expr` union and `ExprSchema` to include all new nodes.

- [ ] **Step 2: Run tests to verify nothing breaks**

```bash
npx vitest run packages/core
```

Expected: 49 tests pass (no new tests yet, existing tests unaffected).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/Ast.ts
git commit --no-verify -m "feat(ast): add Block, Lambda, BinaryExpr, UnaryExpr, StringInterp nodes"
```

---

## Task 2: Binary and Unary Operators

**Files:**

- Modify: `packages/core/src/Parser.ts`
- Modify: `packages/core/src/Checker.ts`
- Modify: `packages/core/src/Codegen.ts`
- Create: `packages/core/test/Operator.test.ts`

- [ ] **Step 1: Write failing operator tests**

`packages/core/test/Operator.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/core";

const compile = (source: string) => Compiler.compile(source);

describe("Operators", () => {
  it.effect("compiles arithmetic", () =>
    Effect.gen(function* () {
      const result = yield* compile("x = 1 + 2 * 3");
      expect(result.code).toContain("const x = 1 + 2 * 3");
    }),
  );

  it.effect("compiles comparison", () =>
    Effect.gen(function* () {
      const result = yield* compile("x = 1 == 2");
      expect(result.code).toContain("const x = 1 === 2");
    }),
  );

  it.effect("compiles logical operators", () =>
    Effect.gen(function* () {
      const result = yield* compile("x = true and false");
      expect(result.code).toContain("const x = true && false");
    }),
  );

  it.effect("compiles unary minus", () =>
    Effect.gen(function* () {
      const result = yield* compile("x = -42");
      expect(result.code).toContain("const x = -42");
    }),
  );

  it.effect("compiles not", () =>
    Effect.gen(function* () {
      const result = yield* compile("x = not true");
      expect(result.code).toContain("const x = !true");
    }),
  );

  it.effect("respects precedence", () =>
    Effect.gen(function* () {
      const result = yield* compile("x = 1 + 2 * 3");
      // Should parse as 1 + (2 * 3) not (1 + 2) * 3
      expect(result.code).toContain("const x = 1 + 2 * 3");
    }),
  );
});
```

- [ ] **Step 2: Run tests — verify fail**

```bash
npx vitest run packages/core/test/Operator.test.ts
```

- [ ] **Step 3: Implement Pratt parser for expressions**

Modify `packages/core/src/Parser.ts`:

Replace the current `parseExpr` (which only handles primary + dot + application) with a Pratt parser (precedence climbing).

Precedence table (from spec, highest to lowest):

1. `.` (dot access) — already handled
2. juxtaposition (application) — already handled
3. `-` (unary minus), `not` — prefix operators
4. `*`, `/`, `%` — multiplicative
5. `+`, `-`, `++` — additive
6. `==`, `!=`, `<`, `>`, `<=`, `>=` — comparison
7. `and` — logical AND
8. `or` — logical OR
9. `xor` — logical XOR
10. `!` (force) — lowest prefix
11. `<-` (mutation) — lowest infix

Key implementation: `parseExprWithPrec(minPrec)` recurses with increasing precedence. Binary operators that are Keyword tokens (`and`, `or`, `xor`, `not`) need to be recognized in the operator table alongside Operator tokens.

- [ ] **Step 4: Add operator handling to Checker**

`Match.tag` cases in `classifyExpr` and `validateExprScope` for `BinaryExpr`, `UnaryExpr` — classify as signal, validate both operands.

- [ ] **Step 5: Add operator emission to Codegen**

`Match.tag` case in `emitExpr`:

- `BinaryExpr`: `${emitExpr(left)} ${mapOp(op)} ${emitExpr(right)}`
- `UnaryExpr`: `${mapOp(op)}${emitExpr(expr)}`

Operator mapping:

- `==` → `===`, `!=` → `!==` (JS strict equality)
- `and` → `&&`, `or` → `||`, `xor` → `!==` (boolean xor)
- `not` → `!`
- `++` → `+` (string concat in JS)
- All others pass through

- [ ] **Step 6: Run tests**

```bash
npx vitest run packages/core
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Parser.ts packages/core/src/Checker.ts packages/core/src/Codegen.ts packages/core/test/Operator.test.ts
git commit --no-verify -m "feat(core): binary/unary operators with Pratt parser"
```

---

## Task 3: Block Expressions

**Files:**

- Modify: `packages/core/src/Parser.ts`
- Modify: `packages/core/src/Checker.ts`
- Modify: `packages/core/src/Codegen.ts`
- Create: `packages/core/test/Block.test.ts`

- [ ] **Step 1: Write failing block tests**

`packages/core/test/Block.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/core";

describe("Blocks", () => {
  it.effect("compiles a block expression", () =>
    Effect.gen(function* () {
      const source = `result = {
  x = 1
  y = 2
  x + y
}`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.gen(function*()");
      expect(result.code).toContain("const x = 1");
      expect(result.code).toContain("const y = 2");
      expect(result.code).toContain("return x + y");
    }),
  );

  it.effect("effectful block sequences operations", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}
declare fetch : String -> Effect String { net } {}
userData = !{
  raw = !fetch "/api/user"
  !console.log raw
  raw
}`;
      const result = yield* Compiler.compile(source);
      // Block becomes Effect.gen with yield* for each !
      expect(result.code).toContain("Effect.gen(function*()");
      expect(result.code).toContain("yield*");
      expect(result.code).toContain("return raw");
    }),
  );
});
```

- [ ] **Step 2: Run tests — verify fail**

- [ ] **Step 3: Implement block parsing**

In Parser, `parseBlock`:

- Consume `{`
- Parse statements until the last expression before `}`
- The tricky part: distinguish "last expression" from "statement". Approach: parse as statements, then check if the last one is an ExprStatement — if so, extract its expr as the block's return value.
- Consume `}`
- Return `new Ast.Block({ statements, expr, span })`

Add `Block` to `parsePrimary` — when the current token is `Delimiter("{")`, parse a block.

- [ ] **Step 4: Add block handling to Checker**

In `checkStmt` / `classifyExpr`: when encountering a Block, push a new scope (create child HashMap from parent), check inner statements, classify the final expression.

- [ ] **Step 5: Add block emission to Codegen**

`Match.tag("Block", ...)` — optimize based on body:

- Zero statements → emit the expression directly (no `Effect.gen`)
- Has statements, no `!` → `Effect.gen(function*() { stmts; return expr })`
- Has `!` → `Effect.gen(function*() { stmts with yield*; return expr })`

- [ ] **Step 6: Run tests**

```bash
npx vitest run packages/core
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Parser.ts packages/core/src/Checker.ts packages/core/src/Codegen.ts packages/core/test/Block.test.ts
git commit --no-verify -m "feat(core): block expressions with scoped bindings"
```

---

## Task 4: Lambda Expressions

**Files:**

- Modify: `packages/core/src/Parser.ts`
- Modify: `packages/core/src/Checker.ts`
- Modify: `packages/core/src/Codegen.ts`
- Create: `packages/core/test/Lambda.test.ts`

- [ ] **Step 1: Write failing lambda tests**

`packages/core/test/Lambda.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/core";

describe("Lambdas", () => {
  it.effect("compiles single-expr lambda as plain function", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("double = x -> { x * 2 }");
      expect(result.code).toContain("const double = (x) => x * 2");
      expect(result.code).not.toContain("Effect.gen");
    }),
  );

  it.effect("compiles multi-param lambda as curried plain function", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("add = a b -> { a + b }");
      expect(result.code).toContain("const add = (a) => (b) => a + b");
    }),
  );

  it.effect("compiles lambda with statements using Effect.gen", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("process = x -> { y = x * 2; y + 1 }");
      expect(result.code).toContain("Effect.gen(function*()");
      expect(result.code).toContain("const y = x * 2");
    }),
  );

  it.effect("partial application", () =>
    Effect.gen(function* () {
      const source = `add = a b -> { a + b }
addThree = add 3`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("const addThree = add(3)");
    }),
  );

  it.effect("lambda used with full application", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}
add = a b -> { a + b }
result = add 3 4
!console.log "done"`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("const add =");
      expect(result.code).toContain("const result = add(3)(4)");
    }),
  );
});
```

- [ ] **Step 2: Run tests — verify fail**

- [ ] **Step 3: Implement lambda parsing**

Haskell-style bare params: `a b -> { body }`. The parser detects lambdas by scanning ahead for `->`:

- In expression position, if we see a sequence of `Ident` tokens followed by `Operator("->")`, it's a lambda.
- Collect param names, consume `->`, parse body (Block).
- Return `new Ast.Lambda({ params: ["a", "b"], body: blockExpr, span })`
- Every multi-param lambda is auto-curried: `a b -> { body }` = `a -> { b -> { body } }`

- [ ] **Step 4: Add lambda handling to Checker**

Create a scope with param names bound as signal-typed identifiers. Check the body block in that scope.

- [ ] **Step 5: Add lambda emission to Codegen**

All lambdas emit as curried. The codegen optimizes based on body complexity:

**Single-expression body (no statements)** — emit as plain function:

```bang
double = x -> { x * 2 }
add = a b -> { a + b }
```

```typescript
const double = (x) => x * 2;
const add = (a) => (b) => a + b;
```

**Body with statements but no effects** — emit with `Effect.gen`:

```bang
process = x -> { y = x * 2; y + 1 }
```

```typescript
const process = (x) =>
  Effect.gen(function* () {
    const y = x * 2;
    return y + 1;
  });
```

**Body with effects (`!`)** — emit with `Effect.gen` and `yield*`:

```bang
fetch = url -> { data = !Http.get url; data }
```

```typescript
const fetch = (url) =>
  Effect.gen(function* () {
    const data = yield* Http_get(url);
    return data;
  });
```

**Same optimization applies to blocks:**

```bang
result = { 1 + 2 }           -- single expr → 1 + 2 (no Effect.gen)
result = { x = 1; x + 2 }    -- has statements → Effect.gen
```

The check is simple: block has zero statements → emit the expression directly.

Application is curried: `add 3 4` → `add(3)(4)`. Partial application works naturally: `add 3` → `add(3)`.

- [ ] **Step 6: Run tests**

```bash
npx vitest run packages/core
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Parser.ts packages/core/src/Checker.ts packages/core/src/Codegen.ts packages/core/test/Lambda.test.ts
git commit --no-verify -m "feat(core): lambda expressions with curried multi-param"
```

---

## Task 5: String Interpolation

**Files:**

- Modify: `packages/core/src/Token.ts`
- Modify: `packages/core/src/Lexer.ts`
- Modify: `packages/core/src/Parser.ts`
- Modify: `packages/core/src/Checker.ts`
- Modify: `packages/core/src/Codegen.ts`
- Create: `packages/core/test/Interp.test.ts`

- [ ] **Step 1: Write failing interpolation tests**

`packages/core/test/Interp.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/core";

describe("String Interpolation", () => {
  it.effect("compiles simple interpolation", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile('x = "hello ${name}"');
      expect(result.code).toContain("`hello ${name}`");
    }),
  );

  it.effect("compiles escape sequences", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile('x = "line1\\nline2"');
      expect(result.code).toContain("line1\\nline2");
    }),
  );

  it.effect("compiles nested expression in interpolation", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile('x = "result: ${1 + 2}"');
      expect(result.code).toContain("`result: ${1 + 2}`");
    }),
  );
});
```

- [ ] **Step 2: Run tests — verify fail**

- [ ] **Step 3: Update Lexer for interpolation**

The lexer's `recognizeString` needs to handle `${...}` and escape sequences.

Two approaches:
**(A)** Lexer produces a single `StringInterp` token containing parts — complex lexer, simple parser.
**(B)** Lexer produces multiple tokens: `StringPartStart`, `Expr tokens`, `StringPartEnd` — simple lexer, complex parser.

**Recommended: (A)** — tokenize the entire string in the lexer, producing a `StringInterp` AST node directly (or a special token that the parser converts). Since string interpolation can contain arbitrary expressions, the lexer needs to recursively lex inside `${}`.

Simpler approach: the lexer produces a `StringLit` for plain strings (no `${}`), and a sequence of tokens for interpolated strings: `InterpStart`, regular tokens, `InterpEnd`, etc. But this gets complex.

**Simplest viable approach:** Keep lexing strings as-is for now. The Parser, when it sees a `StringLit` token, checks if the value contains `${`. If so, it re-parses the string content into `StringInterp` parts. This avoids changing the lexer's token stream.

Actually the cleanest approach: the Lexer scans the string and produces a `StringInterp` AST node embedded in a new token type, or produces the `StringInterp` directly. Let the implementer decide the cleanest mechanism — the key requirement is that `"hello ${name}"` compiles to `` `hello ${name}` ``.

- [ ] **Step 4: Add interpolation to Checker**

Validate each expression part in the interpolation has scope.

- [ ] **Step 5: Add interpolation emission to Codegen**

`StringInterp` emits as a JS template literal:

- Text parts → literal text
- Expr parts → `${emitExpr(expr)}`
- Wrap in backticks instead of quotes

Plain `StringLit` (no interpolation) still emits as `"value"`.

- [ ] **Step 6: Run tests**

```bash
npx vitest run packages/core
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Token.ts packages/core/src/Lexer.ts packages/core/src/Parser.ts packages/core/src/Checker.ts packages/core/src/Codegen.ts packages/core/test/Interp.test.ts
git commit --no-verify -m "feat(core): string interpolation with escape sequences"
```

---

## Task 6: Float Literals in Expressions

**Files:**

- Modify: `packages/core/src/Parser.ts`
- Modify: `packages/core/src/Ast.ts`
- Modify: `packages/core/src/Checker.ts`
- Modify: `packages/core/src/Codegen.ts`

- [ ] **Step 1: Add FloatLiteral AST node and handle in parser/checker/codegen**

The lexer already produces `FloatLit` tokens but the parser doesn't handle them. Add:

- `FloatLiteral` Schema.TaggedClass in Ast.ts
- `Match.tag("FloatLit", ...)` in parsePrimary
- `Match.tag("FloatLiteral", ...)` in classifyExpr, validateExprScope, emitExpr

- [ ] **Step 2: Run tests**

```bash
npx vitest run packages/core
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/Ast.ts packages/core/src/Parser.ts packages/core/src/Checker.ts packages/core/src/Codegen.ts
git commit --no-verify -m "feat(core): float literal support in expressions"
```

---

## Task 7: Grouped Expressions (Parentheses)

**Files:**

- Modify: `packages/core/src/Parser.ts`

- [ ] **Step 1: Handle `(expr)` grouping in parsePrimary**

When the parser sees `(` and it's not a lambda (no `->` after `)`) and not Unit (`()`), parse as grouped expression:

- Consume `(`
- Parse expression
- Consume `)`
- Return the inner expression

This is needed for `add (1 + 2) 3` where `(1 + 2)` is a grouped argument.

- [ ] **Step 2: Run tests**

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/Parser.ts
git commit --no-verify -m "feat(core): parenthesized expression grouping"
```

---

## Task 8: End-to-End v0.2 Test

**Files:**

- Modify: `packages/core/test/Compiler.test.ts`

- [ ] **Step 1: Add v0.2 target program test**

```typescript
it.effect("compiles the v0.2 target program", () =>
  Effect.gen(function* () {
    const source = `declare console.log : String -> Effect Unit { stdout } {}

add = (a, b) -> { a + b }
double = (x) -> { x * 2 }

result = {
  x = add 3 4
  y = double x
  x + y
}

!console.log "result: ${result}"`;
    const result = yield* Compiler.compile(source);
    expect(result.code).toContain("const add =");
    expect(result.code).toContain("const double =");
    expect(result.code).toContain("Effect.gen(function*()");
    expect(result.code).toContain("return x + y");
    expect(result.code).toContain("Effect.runPromise");
  }),
);
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
vp run check
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/Compiler.test.ts
git commit --no-verify -m "test: add v0.2 end-to-end target program test"
```

---

## Summary

| Task | What it delivers                      | Dependencies  |
| ---- | ------------------------------------- | ------------- |
| 1    | AST nodes                             | None          |
| 2    | Binary/unary operators + Pratt parser | Task 1        |
| 3    | Block expressions                     | Tasks 1, 2    |
| 4    | Lambda expressions                    | Tasks 1, 2, 3 |
| 5    | String interpolation                  | Task 1        |
| 6    | Float literals                        | Task 1        |
| 7    | Grouped expressions                   | Task 2        |
| 8    | E2E test                              | All above     |

Tasks 5, 6, 7 are independent of each other and can run in parallel after Task 2.
