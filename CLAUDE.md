# Bang Language Compiler

Bang transpiles to Effect TS. Monorepo: `@bang/core` (library), `@bang/cli` (CLI).

## Commands

- `vp check` — format + lint (use instead of separate commands)
- `vp test packages/core` — run core tests (shows "no tests" in summary; ignore, check exit code or use `npx vitest run` for accurate counts)
- `npx vitest run` — direct test runner with accurate test counts
- `bun run packages/cli/src/index.ts compile examples/hello.bang` — test CLI manually

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
