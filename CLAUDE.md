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

v0.2 complete: blocks, lambdas, operators, string interpolation, grouped expressions.
Next: interpreter (reference eval for compiler correctness testing).

## Design Process

Every feature follows: **Discuss → Research → Spec → Plan → Implement → Review**.

1. **Discuss** — brainstorm the feature, ask clarifying questions, propose 2-3 approaches
2. **Research** — consult language spec, Effect repo, context7 docs, web search as needed
3. **Spec** — write design doc to `docs/superpowers/specs/`, dispatch reviewer, iterate until approved
4. **Plan** — write implementation plan to `docs/superpowers/plans/` with bite-sized tasks
5. **Implement** — dispatch subagents per task, or inline execution. TDD. Effect conventions.
6. **Review** — spec compliance review, then code quality review. Fix issues, re-review.

Design decisions that affect the language go in `docs/language-spec.md` (EBNF).
Design decisions that affect the compiler go in spec docs.
Style decisions go in this file under Effect Style Rules.

**Correctness approach** (from Bahr & Hutton "Calculating Correct Compilers"):
- Reference interpreter (`eval`) defines ground truth semantics
- Compiler correctness = `eval(ast) ≡ run(codegen(ast))`
- Pretty-printer roundtrip = `eval(parse(print(ast))) ≡ eval(ast)`
- Prefer correct-by-construction (types, structural invariants) over testing where possible
- Property tests for algebraic laws; unit tests for specific behaviors

## Specs & Plans

- Language spec: `docs/language-spec.md` (EBNF v0.2)
- Compiler design: `docs/superpowers/specs/2026-03-25-bang-compiler-design.md`
- Interpreter design: `docs/superpowers/specs/2026-03-26-interpreter-design.md`
- v0.1 plan: `docs/superpowers/plans/2026-03-25-bang-compiler-v0.1.md` (completed)
- v0.2 plan: `docs/superpowers/plans/2026-03-25-bang-compiler-v0.2.md` (completed)
- Effect repo: `~/Projects/Repos/effect` — reference for idiomatic Effect patterns
