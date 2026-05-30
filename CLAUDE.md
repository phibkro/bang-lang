# Bang Language Compiler

Bang transpiles to Effect TS. Monorepo: `@bang/core` (interpreter domain),
`@bang/compiler` (compilation pipeline), `@bang/cli` (CLI).
Repo: github.com/phibkro/bang-lang

## Docs map — read the one you need

- **this file** — tier-0 entrypoint: commands, the correctness law, the design
  process, definition of done, and routing to the docs below.
- `docs/CONCEPTS.md` — the language's nouns and verbs (pull model, `!`,
  `Effect`/`Signal`, channels, nominal vs structural, keywords) and the _why_.
- `docs/PATTERNS.md` — implementation patterns, the Effect-TS style split, and
  the known limitations (tsc/printer/ESLint, inference, codegen).
- `docs/decisions/` — ADRs for hard-to-reverse calls: interpreter-is-the-spec
  (0001), effects-are-types / no `effect` keyword (0002), nominal/structural
  types + auto-Schema (0003).
- `docs/language-spec.md` — the full v0.5 syntax/EBNF spec.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design specs and
  plans (drill-down).

## Commands

- `pnpm install` — install dependencies (first-time setup)
- `vp check --fix` — format + Oxlint (auto-fix)
- `vp run lint` — ESLint with Effect/functional rules (auto-fix)
- `vp run check` — runs the `check` package script: tsc on all three packages
  (`--noEmit`) then `vp run lint`. Full verification.
- `pnpm test` — run the suite (Vitest). Run it for the current test count.
- `bang compile examples/hello.bang` — compile .bang to .ts
- `bang fmt <file.bang>` — format in place
- `bang run <file.bang>` — compile and execute

## Architecture

Pipeline: `Lexer → Parser → Checker → Codegen`, each an Effect returning typed
output. `@bang/core` owns AST + interpreter + type inference. `@bang/compiler`
depends on core for codegen.

Key files:

- `packages/core/src/Ast.ts` — Schema.TaggedClass nodes with Schema.suspend for
  recursion
- `packages/core/src/Token.ts` — Schema.TaggedClass token types
- `packages/core/src/Interpreter.ts` — reference eval (ground truth semantics)
- `packages/core/src/Formatter.ts` — canonical pretty-printer via @effect/printer
  (Wadler-Lindig)
- `packages/core/src/Value.ts` — interpreter values (Data.TaggedEnum, internal
  only)
- `packages/core/src/AstGen.ts` — random AST generators for property tests
- `packages/core/src/InferType.ts` — TVar, TCon, TArrow, TApp for HM inference
- `packages/core/src/TypeError.ts` — structured type error variants
  (Schema.TaggedError)
- `packages/core/src/Unify.ts` — Substitution (HashMap), apply, unify with
  occurs check
- `packages/core/src/Infer.ts` — HM inference engine
- `packages/core/src/TypeCheck.ts` — public API: `typeCheck(program)`
- `packages/compiler/src/Compiler.ts` — pipeline entry: compose(lex, parse,
  check, codegen)
- `packages/compiler/src/Checker.ts` — scope validation, effect classification,
  cycle detection
- `packages/compiler/src/Codegen.ts` — Effect TS code generation
- `packages/cli/src/index.ts` — CLI entry point (@effect/cli): compile, run, fmt

For language concepts see `docs/CONCEPTS.md`; for implementation patterns and
the Effect-TS style rules see `docs/PATTERNS.md`.

## Design process

**The interpreter is the spec; the compiler is an optimization of it** — see
`docs/decisions/0001-interpreter-is-the-spec.md`. When semantics are ambiguous,
the interpreter resolves them. If the compiler disagrees with the interpreter,
the compiler is wrong. Don't add a feature to the compiler without adding it to
the interpreter first; get semantics right in the simpler system, then
translate.

Feature pipeline (add the AST node first — `Match.exhaustive` breaks every
downstream file, fix each):

```
AST node (Schema.TaggedClass) → type errors everywhere
  → Lexer (new tokens) → Parser (source → AST)
  → Interpreter (ground truth semantics)
  → Infer (type inference) → Checker (scope/type rules)
  → Codegen (compile to Effect TS) → Formatter (canonical output)
  → Property test: parse(format(x)) roundtrips
```

The AST is the type-level test; `Match.exhaustive` is the assertion; the spec
says what each case does.

## Correctness

Priority: types (illegal states unrepresentable) > property tests (`it.prop`,
algebraic laws) > unit tests (specific cases).

Correctness equations:

- `eval(parse(format(ast))) ≡ eval(ast)` — the roundtrip law, **enforced** by
  the property test.
- `toJS(eval(ast)) ≡ evalJS(codegen(ast))` — eval≡codegen. **Target, not yet
  enforced**: the property test currently checks only the interpreter-agreement
  half (interpret + compile both succeed); full value comparison needs a safe
  JS-eval mechanism. See `packages/compiler/test/Property.test.ts:50`.

## Definition of done

- `vp run check` green (tsc on all packages + ESLint; lint _errors_, not
  warnings, block — see `docs/PATTERNS.md` for the accepted-warnings note).
- Suite green (`pnpm test`).
- Docs the change touched are updated; deferred items written down, not dropped.
- New language feature → walk the full feature pipeline above (interpreter
  first).

## Working with subagents

- Subagents often implement ahead of scope. Check `git status` before
  dispatching the next task.
- Parallel agents sharing a worktree can stage each other's files. Use explicit
  `git add <specific files>`, not `git add .`.
- Pre-commit hook runs lint + the full suite; commits failing lint _errors_ are
  rejected.
