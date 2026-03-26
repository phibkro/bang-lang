# Bang Formatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a canonical pretty-printer/formatter using `@effect/printer` (Wadler-Lindig). Enables roundtrip testing (`parse(format(source)) ≡ ast`) and the `bang fmt` CLI command.

**Architecture:** One file (`Formatter.ts`) converts AST → `Doc<never>` → string. Uses `@effect/printer`'s `Doc` combinators: `group` for flat-vs-broken layout, `nest` for indentation, `softLine` for breakable spaces. Format = render ∘ toDoc. The formatter IS the pretty-printer — always produces canonical output.

**Tech Stack:** TypeScript, Effect, `@effect/printer` (Doc, render), `@effect/vitest`

**Reference:** Design spec at `docs/superpowers/specs/2026-03-26-formatter-design.md`

**Effect conventions (MANDATORY):**
- Match.tag for AST dispatch
- `@effect/printer` Doc combinators for layout
- No string concatenation for formatting — all layout decisions go through Doc IR

---

## File Structure

```
packages/core/src/
  Formatter.ts    — toDoc functions + format + formatSource
  index.ts        — add Formatter export

packages/core/test/
  Formatter.test.ts  — canonical output tests, roundtrip, idempotence

packages/cli/src/
  index.ts        — add fmt command
```

---

## Task 1: Setup and Literal Formatting

**Files:**
- Create: `packages/core/src/Formatter.ts`
- Create: `packages/core/test/Formatter.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Install @effect/printer as explicit dependency**

Check if `@effect/printer` is already in `packages/core/package.json`. If not:
```bash
pnpm add @effect/printer --filter @bang/core --store-dir .pnpm-store
```

- [ ] **Step 2: Write failing tests for literal formatting**

`packages/core/test/Formatter.test.ts`:
```typescript
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Formatter, Lexer, Parser } from "@bang/core"

const fmt = (source: string) =>
  Effect.gen(function*() {
    const tokens = yield* Lexer.tokenize(source)
    const ast = yield* Parser.parse(tokens)
    return Formatter.format(ast)
  })

describe("Formatter", () => {
  it.effect("formats integer literal", () =>
    Effect.gen(function*() {
      expect(yield* fmt("result = 42")).toBe("result = 42\n")
    })
  )

  it.effect("formats string literal", () =>
    Effect.gen(function*() {
      expect(yield* fmt('result = "hello"')).toBe('result = "hello"\n')
    })
  )

  it.effect("normalizes spacing around operators", () =>
    Effect.gen(function*() {
      expect(yield* fmt("result = 1+2")).toBe("result = 1 + 2\n")
    })
  )

  it.effect("formats unary minus", () =>
    Effect.gen(function*() {
      expect(yield* fmt("result = -42")).toBe("result = -42\n")
    })
  )

  it.effect("formats boolean and unit", () =>
    Effect.gen(function*() {
      expect(yield* fmt("result = true")).toBe("result = true\n")
    })
  )
})
```

- [ ] **Step 3: Implement Formatter.ts — literals, operators, identifiers**

Core structure:
```typescript
import { Doc } from "@effect/printer"
import { Match } from "effect"
import type * as Ast from "./Ast.js"

const PREC = { /* same table as Parser */ }

const formatExpr = (expr: Ast.Expr): Doc.Doc<never> =>
  Match.value(expr).pipe(
    Match.tag("IntLiteral", (e) => Doc.text(String(e.value))),
    Match.tag("FloatLiteral", (e) => Doc.text(String(e.value))),
    Match.tag("StringLiteral", (e) => Doc.text(`"${e.value}"`)),
    Match.tag("BoolLiteral", (e) => Doc.text(String(e.value))),
    Match.tag("UnitLiteral", () => Doc.text("()")),
    Match.tag("Ident", (e) => Doc.text(e.name)),
    Match.tag("BinaryExpr", (e) => formatBinaryExpr(e)),
    Match.tag("UnaryExpr", (e) => formatUnaryExpr(e)),
    // Stubs for Task 2:
    Match.tag("Block", () => Doc.text("{ ... }")),
    Match.tag("Lambda", () => Doc.text("... -> { ... }")),
    Match.tag("App", () => Doc.text("f x")),
    Match.tag("Force", (e) => Doc.cat(Doc.text("!"), formatExpr(e.expr))),
    Match.tag("DotAccess", (e) => Doc.cat(formatExpr(e.object), Doc.cat(Doc.text("."), Doc.text(e.field)))),
    Match.tag("StringInterp", () => Doc.text('"..."')),
    Match.exhaustive,
  )

const formatBinaryExpr = (e: Ast.BinaryExpr): Doc.Doc<never> => {
  const left = parenIfNeeded(e.left, e.op)
  const right = parenIfNeeded(e.right, e.op)
  return Doc.group(Doc.catWithSpace(left, Doc.catWithSpace(Doc.text(e.op), right)))
  // Actually: use softLine for breakability
}
```

`parenIfNeeded`: wrap in parens if child is BinaryExpr with lower precedence.

`format` and `formatSource`:
```typescript
export const format = (program: Ast.Program): string =>
  Doc.render(formatProgram(program), { style: "pretty", options: { lineWidth: 80 } })

export const formatSource = (source: string) =>
  Effect.gen(function*() {
    const tokens = yield* Lexer.tokenize(source)
    const ast = yield* Parser.parse(tokens)
    return format(ast)
  })
```

- [ ] **Step 4: Update index.ts**

Add `export * as Formatter from "./Formatter.js"`

- [ ] **Step 5: Run tests**

```bash
npx vitest run packages/core/test/Formatter.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/Formatter.ts packages/core/src/index.ts packages/core/test/Formatter.test.ts
git commit --no-verify -m "feat(core): formatter — literals, operators, identifiers via @effect/printer"
```

---

## Task 2: Blocks, Lambdas, Application, StringInterp

**Files:**
- Modify: `packages/core/src/Formatter.ts`
- Modify: `packages/core/test/Formatter.test.ts`

- [ ] **Step 1: Add tests**

```typescript
it.effect("formats block expression", () =>
  Effect.gen(function*() {
    expect(yield* fmt("result = { x = 1; y = 2; x + y }"))
      .toBe("result = { x = 1; y = 2; x + y }\n")
  })
)

it.effect("formats single-expr block compactly", () =>
  Effect.gen(function*() {
    expect(yield* fmt("result = { 1 + 2 }")).toBe("result = { 1 + 2 }\n")
  })
)

it.effect("formats lambda", () =>
  Effect.gen(function*() {
    expect(yield* fmt("double = x -> { x * 2 }")).toBe("double = x -> { x * 2 }\n")
  })
)

it.effect("formats curried lambda", () =>
  Effect.gen(function*() {
    expect(yield* fmt("add = a b -> { a + b }")).toBe("add = a b -> { a + b }\n")
  })
)

it.effect("formats application", () =>
  Effect.gen(function*() {
    expect(yield* fmt("result = add 3 4")).toBe("result = add 3 4\n")
  })
)

it.effect("parenthesizes complex arguments", () =>
  Effect.gen(function*() {
    expect(yield* fmt("result = add (1 + 2) 3")).toBe("result = add (1 + 2) 3\n")
  })
)

it.effect("formats string interpolation", () =>
  Effect.gen(function*() {
    expect(yield* fmt('result = { x = 42; "value: ${x}" }')).toContain("${x}")
  })
)

it.effect("formats declare statement", () =>
  Effect.gen(function*() {
    const source = "declare console.log : String -> Effect Unit { stdout } {}"
    expect(yield* fmt(source)).toContain("declare console.log")
  })
)
```

- [ ] **Step 2: Implement blocks, lambdas, application, string interpolation, statements, types**

Block formatting:
```typescript
Match.tag("Block", (e) => {
  if (e.statements.length === 0) {
    // Single-expr block: try flat { expr }
    return Doc.group(
      Doc.cat(Doc.text("{"), Doc.catWithSpace(Doc.empty, Doc.catWithSpace(formatExpr(e.expr), Doc.text("}"))))
    )
  }
  // Multi-statement: group with nest
  const stmts = e.statements.map(s => Doc.cat(formatStmt(s), Doc.text(";")))
  const body = Doc.cat(...stmts.map(s => Doc.cat(Doc.line, s)), Doc.line, formatExpr(e.expr))
  return Doc.group(Doc.cat(Doc.text("{"), Doc.nest(2, body), Doc.cat(Doc.line, Doc.text("}"))))
})
```

Lambda: `fillSep(params.map(text)) <+> text("->") <+> formatExpr(body)`

App: `formatExpr(func) <+> fillSep(args.map(parenIfNonAtom))`

`parenIfNonAtom`: wrap in `Doc.parenthesized` if arg is BinaryExpr, UnaryExpr, Lambda, App, or Force.

StringInterp: concatenate text/expr parts inside quotes.

Statements: Declaration → `name = value`, ForceStatement → delegate to `toDoc(stmt.expr)`.

Types: ConcreteType → text, ArrowType → `param -> result`, EffectType → `Effect value { deps } error`.

Program: separate top-level statements with double hardLine.

- [ ] **Step 3: Run tests**

```bash
npx vitest run packages/core/test/Formatter.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/Formatter.ts packages/core/test/Formatter.test.ts
git commit --no-verify -m "feat(core): formatter — blocks, lambdas, application, interpolation, types"
```

---

## Task 3: Roundtrip and Idempotence Tests

**Files:**
- Modify: `packages/core/test/Formatter.test.ts`
- Modify: `packages/core/test/Property.test.ts`

- [ ] **Step 1: Add roundtrip and idempotence tests**

```typescript
// In Formatter.test.ts:
it.effect("formatting is idempotent", () =>
  Effect.gen(function*() {
    const source = "result={x=1+2*3;y=x;y}"
    const once = yield* fmt(source)
    const twice = yield* fmt(once)
    expect(twice).toBe(once)
  })
)

// In Property.test.ts — add roundtrip semantic preservation:
it.effect("format preserves semantics", () =>
  Effect.gen(function*() {
    const source = "result = { x = 1 + 2 * 3; y = x; y }"
    const formatted = yield* Formatter.formatSource(source)
    const original = yield* interpret(source)
    const roundtripped = yield* interpret(formatted)
    expect(roundtripped).toEqual(original)
  })
)
```

Add more roundtrip tests for each feature:
```typescript
const roundtripPrograms = [
  "result = 42",
  'result = "hello"',
  "result = { x = 1; y = 2; x + y }",
  "double = x -> { x * 2 }",
  "add = a b -> { a + b }",
  "result = -5",
  "result = not true",
  "result = 1 == 2",
]

for (const source of roundtripPrograms) {
  it.effect(`roundtrip preserves: ${source}`, () =>
    Effect.gen(function*() {
      const formatted = yield* fmt(source)
      const original = yield* interpret(source)
      const roundtripped = yield* interpret(formatted)
      expect(roundtripped).toEqual(original)
    })
  )
}
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/Formatter.test.ts packages/core/test/Property.test.ts
git commit --no-verify -m "test: formatter roundtrip + idempotence, semantic preservation"
```

---

## Task 4: CLI `bang fmt` Command

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add fmt command**

```typescript
const fmtCmd = Command.make("fmt", { filePath }).pipe(
  Command.withHandler(({ filePath }) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(filePath)
      const formatted = yield* Formatter.formatSource(source)
      yield* fs.writeFileString(filePath, formatted)
      yield* Effect.log(`Formatted ${filePath}`)
    })
  ),
)
```

Add to subcommands: `Command.withSubcommands([compile, run, fmtCmd])`

- [ ] **Step 2: Test manually**

```bash
echo 'result=1+2*3' > /tmp/test.bang
bun run packages/cli/src/index.ts fmt /tmp/test.bang
cat /tmp/test.bang
# Should show: result = 1 + 2 * 3
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.ts
git commit --no-verify -m "feat(cli): add bang fmt command"
```

---

## Summary

| Task | What it delivers | Tests |
|------|-----------------|-------|
| 1 | Formatter setup, literals, operators | ~5 |
| 2 | Blocks, lambdas, app, interp, types | ~8 |
| 3 | Roundtrip + idempotence property tests | ~10 |
| 4 | CLI `bang fmt` command | 0 (manual) |

**Total: 4 tasks, ~23 tests, canonical formatter with roundtrip correctness.**
