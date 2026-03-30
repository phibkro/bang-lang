# Bang Language Compiler

Bang transpiles to Effect TS. Monorepo: `@bang/core` (interpreter domain), `@bang/compiler` (compilation pipeline), `@bang/cli` (CLI). Repo: github.com/phibkro/bang-lang

## Commands

- `pnpm install` — install dependencies (first-time setup)
- `vp check --fix` — format + Oxlint (auto-fix)
- `vp run lint` — ESLint with Effect/functional rules (auto-fix)
- `vp run check` — tsc + ESLint (full verification)
- `npx vitest run` — run all tests (322 tests, use this for accurate counts)
- `bang compile examples/hello.bang` — compile .bang to .ts
- `bang fmt <file.bang>` — format in place
- `bang run <file.bang>` — compile and execute

## Language Design

Key concepts (see `docs/language-spec.md` for full v0.5 spec):

- **Pull model**: Every binding is a lazy thunk. `!` is the single site where descriptions become reality.
- `Effect A E R` — A=value, E=error effects, R=dependency effects. Both E and R are algebraic effects.
- **Effects are types**: No `effect` keyword. Channel classification is mechanical — operations returning `Nothing` → E channel, returning values → R channel.
- `.handle`, `.catch`, `.map`, `.tap` — composable channel handlers via dot syntax.
- `Signal A E R` — pure lazy computation (no `!` on effectful expressions). Distinct from `Effect` at type level, same at runtime.
- `on` — explicit push subscriptions with compile-time cycle detection. Push is opt-in, pull is default.
- `use` — structured resource acquisition replacing `defer`. `use x = f; rest` desugars to `!f (x) -> { rest }`.
- `gen` — escape hatch to raw Effect TS (replaces `effect` block).
- `type` declarations are nominal (branded). Anonymous types are structural. Every type auto-derives Schema.
- Type constraints use angle brackets: `<a : Numeric> a -> a` (no `where` keyword).
- Type variables are always lowercase (`a`, `b`). Concrete types uppercase (`Int`, `Maybe`).
- `[1, 2, 3]` is Array (JS array). `List a` (Cons/Nil) is a separate ADT.
- `!` binds loosest (except `<-`) — forces everything to the right.
- Keywords (19): `mut type declare from import export match not and or xor if true false transaction gen on use comptime`

## Architecture

Pipeline: `Lexer → Parser → Checker → Codegen`, each an Effect returning typed output.
`@bang/core` owns AST + interpreter + type inference. `@bang/compiler` depends on core for codegen.

## Patterns

- All domain types use `Schema.TaggedClass` (Token, AST, Span) or `Schema.TaggedError` (CompilerError)
- Recursive AST types use `Schema.suspend` for forward references
- `Schema.OptionFromUndefinedOr` fields (Arm.guard, Declaration.typeAnnotation) are `Option<T>` at runtime — use `Option.isSome()`, NOT `!== undefined`
- `constructor` is reserved on Schema.TaggedClass — use `ctor` (see InferType.TApp)
- All dispatch uses `Match.tag` with `Match.exhaustive` — no switch/case on `_tag`
- Checker uses `HashMap` for scope, `Option` for nullable values, `Effect.fail` for errors
- Codegen uses immutable `WriterState` accumulator — no mutable class
- Lexer uses combinator pattern: `Recognizer = (ScanState) => Option<[Token, ScanState]>` with `firstOf` composition
- Parser uses immutable `ParseState` with all primitives returning `Effect`
- `declare` generates wrapper functions in codegen; `!` always means `yield*`
- Tests use `@effect/vitest` (`it.effect` for effectful tests)
- ESLint: `eslint-plugin-functional` + `@effect/eslint-plugin` + `typescript-eslint/strict`
- Interpreter values use `Data.TaggedEnum` (lightweight, no Schema overhead — values are internal, never serialized)
- Formatter uses `@effect/printer` Doc IR — `Doc.group` for smart line-breaking, `Doc.hcat` for concatenation
- AST generators use `FastCheck` from effect with bounded recursion for property tests
- Pre-commit: `vp staged` runs `vp check --fix` + `npx eslint --fix` on staged .ts files
- TypeError (from @bang/core) ≠ CompilerError — inference errors must be `catchAll`'d when crossing core→compiler boundary
- Checker.ts has a nested `checkStmt` call inside block validation (~line 308) — update ALL call sites when changing signature

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

- `packages/core/src/Ast.ts` — Schema.TaggedClass nodes with Schema.suspend for recursion
- `packages/core/src/Token.ts` — Schema.TaggedClass token types
- `packages/core/src/Interpreter.ts` — reference eval (ground truth semantics)
- `packages/core/src/Formatter.ts` — canonical pretty-printer via @effect/printer (Wadler-Lindig)
- `packages/core/src/Value.ts` — interpreter values (Data.TaggedEnum, not Schema.TaggedClass — internal only)
- `packages/core/src/AstGen.ts` — random AST generators for property tests
- `packages/core/src/InferType.ts` — TVar, TCon, TArrow, TApp (Schema.TaggedClass) for HM inference
- `packages/core/src/TypeError.ts` — 8 structured type error variants (Schema.TaggedError)
- `packages/core/src/Unify.ts` — Substitution (HashMap), apply, unify with occurs check
- `packages/core/src/Infer.ts` — HM inference engine: infer, inferStmt, inferPattern, inferProgram
- `packages/core/src/TypeCheck.ts` — public API: typeCheck(program) wraps inferProgram
- `packages/compiler/src/Compiler.ts` — pipeline entry: compose(lex, parse, check, codegen)
- `packages/compiler/src/Checker.ts` — scope validation, effect classification, cycle detection (produces InferType annotations)
- `packages/compiler/src/Codegen.ts` — Effect TS code generation
- `packages/cli/src/index.ts` — CLI entry point (@effect/cli): compile, run, fmt

## Status

v0.5.1 compiler + Layer 1 HM type inference. 322 tests across 33 files.
Roundtrip property test: `eval(parse(format(ast))) ≡ eval(ast)`.

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

## Adding a Language Feature

Add the AST node first. `Match.exhaustive` breaks every downstream file — fix each one:

```
AST node (Schema.TaggedClass) → type errors everywhere
  → Lexer (new tokens if needed)
  → Parser (source → AST)
  → Interpreter (ground truth semantics)
  → Infer (type inference rules)
  → Checker (scope/type rules)
  → Codegen (compile to Effect TS)
  → Formatter (canonical output)
  → Property test: eval ≡ run(codegen)
  → Property test: parse(format(x)) roundtrips
```

The AST is the type-level test. Match.exhaustive is the assertion. The spec says what each case does.

## Correctness

Priority: types (illegal states unrepresentable) > property tests (`it.prop`, algebraic laws) > unit tests (specific cases).

Correctness equations: `eval(ast) ≡ run(codegen(ast))` and `eval(parse(format(ast))) ≡ eval(ast)`.

## Interpreter Patterns

- `<-` in BinaryExpr: do NOT evalExpr the left side (would unwrap MutCell). Extract Ident name directly.
- `.handle` binds with `__handler_` prefix to avoid user name collisions
- `use` CPS: Block handler detects `Force(UseExpr)`, builds continuation lambda from remaining stmts
- `on` subscribers use `{ active: boolean, fn }` pattern. Subscription registry is module-level.
- `genBinaryOperand` excludes Lambda/OnExpr to prevent flaky roundtrip property tests

## Known Issues

- `tsc` reports errors in Ast.ts (Schema.suspend + OptionFromUndefinedOr Encoded/Type mismatch) and Parser.ts (block return type) — type-level only, no runtime impact. `skipLibCheck: true` masks these.
- `@effect/printer` Doc.nest inside Doc.group triggers a flatten bug — blocks format flat-only for now.
- ESLint has ~209 warnings (imperative patterns in Parser/Interpreter/Codegen/Infer) — accepted per pragmatic style rules.

## Known Inference Limitations

- `Infer.ts` uses module-level mutable counter (`nextId`) — reset in `inferProgram`, not safe for concurrent use. Documented in code.
- Checker runs inferProgram then annotates — inference errors are non-fatal (falls back to TCon("Unknown"))
- ForceStatement/ExprStatement/TypeDecl/Import/Export annotations still use TCon("Unknown") — only Declaration and Declare carry real inferred types

## Known Codegen Limitations

- Guards on grouped constructor arms (same outer tag) not yet codegen'd — interpreter handles them
- Multi-field nested constructor patterns (`Pair a b`) only single-field supported in codegen
- Subscription registry is module-level mutable state (leaks across test runs, works in practice)
- `.abort` on Subscription is immediate side effect, not a returned thunk

## Specs & Plans

- Language spec: `docs/language-spec.md`
- Design specs and plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`
- Effect source: `~/Projects/Repos/effect` — read here instead of node_modules

## Working with Subagents

- Subagents often implement ahead of scope. Check git status before dispatching next task.
- Parallel agents sharing a worktree can accidentally stage each other's files. Use explicit `git add <specific files>`, not `git add .`.
- Pre-commit hook runs lint + full test suite. Commits that fail lint errors (not warnings) are rejected.
- `npx vitest run` — canonical test command. 322 tests across 33 files.
