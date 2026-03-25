# Bang Language Compiler

Bang transpiles to Effect TS. Monorepo: `@bang/core` (library), `@bang/cli` (CLI). Repo: github.com/phibkro/bang-lang

## Commands

- `vp check` — format + lint (use instead of separate commands)
- `vp check --fix` — auto-fix formatting
- `vp test packages/core` — run core tests (shows "no tests" in summary; ignore, check exit code or use `npx vitest run` for accurate counts)
- `npx vitest run` — direct test runner with accurate test counts
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

- AST uses plain interfaces + factory functions (not `Data.TaggedEnum` — recursive types aren't supported)
- Tokens and CompilerError use `Data.TaggedEnum` (flat, non-recursive)
- Parser/Checker use synchronous internals wrapped in `Effect.try` at the boundary
- `declare` generates wrapper functions in codegen; `!` always means `yield*`
- Tests use `@effect/vitest` (`it.effect` for effectful tests)

## Specs & Plans

- Language spec: `docs/language-spec.md` (EBNF v0.2)
- Design spec: `docs/superpowers/specs/2026-03-25-bang-compiler-design.md`
- Implementation plan: `docs/superpowers/plans/2026-03-25-bang-compiler-v0.1.md`
- Effect repo: `~/Projects/Repos/effect` — reference for idiomatic Effect patterns
