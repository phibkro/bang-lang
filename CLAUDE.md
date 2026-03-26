# Bang Language Compiler

Bang transpiles to Effect TS. Monorepo: `@bang/core` (library), `@bang/cli` (CLI). Repo: github.com/phibkro/bang-lang

## Commands

- `vp check --fix` — format + Oxlint (auto-fix)
- `vp run lint` — ESLint with Effect/functional rules (auto-fix)
- `vp run check` — tsc + ESLint (full verification)
- `vp test packages/core` — run core tests (shows "no tests" in summary; use `npx vitest run` for accurate counts)
- `bun run packages/cli/src/index.ts compile examples/hello.bang` — test CLI manually

## Language Design

Key concepts (see `docs/language-spec.md` for full spec):

- `Effect A E R` — A=value, E=error effects, R=dependency effects. Both E and R are algebraic effects.
- `effect` declarations define interfaces. Implementations are first-class values, handling is always explicit via `.handle`.
- `.handle`, `.catch`, `.map` — composable channel handlers via dot syntax, not keywords.
- `Signal` — push-based reactive computation. Ref changes propagate eagerly to dependent Signals.
- `type` declarations are nominal (branded). Anonymous types are structural. Every type auto-derives Schema.
- Type variables are always lowercase (`a`, `b`). Concrete types uppercase (`Int`, `Maybe`).
- `[1, 2, 3]` is Array (JS array). `List a` (Cons/Nil) is a separate ADT.
- `!` binds loosest (except `<-`) — forces everything to the right.

## Architecture

Pipeline: `Lexer → Parser → Checker → Codegen`, each an Effect returning typed output.
Phases composed in `Compiler.ts`. Each phase produces a distinct type (Token[] → UntypedAST → TypedAST → string).

## Patterns

- All domain types use `Schema.TaggedClass` (Token, AST, Span) or `Schema.TaggedError` (CompilerError)
- Recursive AST types use `Schema.suspend` for forward references
- All dispatch uses `Match.tag` with `Match.exhaustive` — no switch/case on `_tag`
- Checker uses `HashMap` for scope, `Option` for nullable values, `Effect.fail` for errors
- Codegen uses immutable `WriterState` accumulator — no mutable class
- Lexer uses combinator pattern: `Recognizer = (ScanState) => Option<[Token, ScanState]>` with `firstOf` composition
- Parser uses immutable `ParseState` with all primitives returning `Effect`
- `declare` generates wrapper functions in codegen; `!` always means `yield*`
- Tests use `@effect/vitest` (`it.effect` for effectful tests)
- ESLint: `eslint-plugin-functional` + `@effect/eslint-plugin` + `typescript-eslint/strict`
- Pre-commit: `vp staged` runs `vp check --fix` + `npx eslint --fix` on staged .ts files

## Effect Style Rules

Strict (enforce):

- Schema.TaggedClass for all domain types (AST, errors, tokens)
- Match.tag with Match.exhaustive for AST/token dispatch
- Effect.fail over throw; Option over undefined for nullable fields
- HashMap over mutable Map; Schema.is() and Either.isLeft() in tests

Pragmatic (skip):

- Character predicates (isDigit, isAlpha) stay as simple boolean functions
- if/else guards in Effect.gen for early returns are fine
- Internal-only state types (ScanState, ParseState) stay as plain interfaces
- Constant Sets (KEYWORDS, DELIMITERS) stay as `new Set()`
- Pure string operations stay as-is

## Key Files

- `packages/core/src/Compiler.ts` — pipeline entry: compose(lex, parse, check, codegen)
- `packages/core/src/Ast.ts` — Schema.TaggedClass nodes with Schema.suspend for recursion
- `packages/core/src/Token.ts` — Schema.TaggedClass token types
- `packages/cli/src/index.ts` — CLI entry point (@effect/cli)

## Status

v0.2 compiler + interpreter complete.
Next: pretty-printer (AST → Bang source, enables roundtrip testing).

## Design Process

**The interpreter is the spec.** It defines what Bang programs mean. When semantics are ambiguous, the interpreter resolves it — it has to produce a value.

**The compiler is an optimization of the interpreter.** Codegen translates semantics to Effect TS. It doesn't define behavior. If the compiler disagrees with the interpreter, the compiler is wrong.

**New features flow through a pipeline:**

```
Language spec (what it means, in docs/language-spec.md)
  → Interpreter (executable semantics, ground truth)
  → Compiler (optimized translation to Effect TS)
  → Property test (they agree)
```

Don't add a feature to the compiler without adding it to the interpreter first. Get semantics right in the simpler system, then translate.

## Correctness

Three layers, ordered by cost-effectiveness:

1. **Types** — Make illegal states unrepresentable. Schema.TaggedClass, Match.exhaustive, Span as {start, end} not 6 fields. Prevent entire bug classes with zero tests.

2. **Property tests** — Algebraic laws that hold for all inputs. `eval(Block([], e)) ≡ eval(e)`. Determinism. Lambda application matches direct computation. Catch systematic bugs. Use `it.prop` / `it.effect.prop`.

3. **Unit/E2E tests** — Specific behaviors and edge cases. Division by zero. Undeclared variables. Full program compilation. Catch individual bugs.

**Correctness equation** (Bahr & Hutton "Calculating Correct Compilers"):
```
eval(ast) ≡ run(codegen(ast))     -- compiler correctness
eval(parse(print(ast))) ≡ eval(ast)  -- pretty-printer roundtrip
```

## Specs & Plans

- Language spec: `docs/language-spec.md` (EBNF v0.2)
- Compiler design: `docs/superpowers/specs/2026-03-25-bang-compiler-design.md`
- Interpreter design: `docs/superpowers/specs/2026-03-26-interpreter-design.md`
- v0.1 plan: `docs/superpowers/plans/2026-03-25-bang-compiler-v0.1.md` (completed)
- v0.2 plan: `docs/superpowers/plans/2026-03-25-bang-compiler-v0.2.md` (completed)
- Effect repo: `~/Projects/Repos/effect` — reference for idiomatic Effect patterns
