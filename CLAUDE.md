# Bang Language Compiler

Bang transpiles to Effect TS. Monorepo: `@bang/core` (interpreter domain), `@bang/compiler` (compilation pipeline), `@bang/cli` (CLI). Repo: github.com/phibkro/bang-lang

## Commands

- `vp check --fix` — format + Oxlint (auto-fix)
- `vp run lint` — ESLint with Effect/functional rules (auto-fix)
- `vp run check` — tsc + ESLint (full verification)
- `npx vitest run` — run all tests (200 tests, use this for accurate counts)
- `bang compile examples/hello.bang` — compile .bang to .ts
- `bang fmt <file.bang>` — format in place
- `bang run <file.bang>` — compile and execute

## Language Design

Key concepts (see `docs/language-spec.md` for full v0.4 spec):

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
- Keywords (18): `mut type declare from import export match not and or xor if true false transaction gen on use`

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
- Interpreter values use `Data.TaggedEnum` (lightweight, no Schema overhead — values are internal, never serialized)
- Formatter uses `@effect/printer` Doc IR — `Doc.group` for smart line-breaking, `Doc.hcat` for concatenation
- AST generators use `FastCheck` from effect with bounded recursion for property tests
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

- `packages/core/src/Ast.ts` — Schema.TaggedClass nodes with Schema.suspend for recursion
- `packages/core/src/Token.ts` — Schema.TaggedClass token types
- `packages/core/src/Interpreter.ts` — reference eval (ground truth semantics)
- `packages/core/src/Formatter.ts` — canonical pretty-printer via @effect/printer (Wadler-Lindig)
- `packages/core/src/Value.ts` — interpreter values (Data.TaggedEnum, not Schema.TaggedClass — internal only)
- `packages/core/src/AstGen.ts` — random AST generators for property tests
- `packages/compiler/src/Compiler.ts` — pipeline entry: compose(lex, parse, check, codegen)
- `packages/compiler/src/Checker.ts` — type checking / scope validation
- `packages/compiler/src/Codegen.ts` — Effect TS code generation
- `packages/cli/src/index.ts` — CLI entry point (@effect/cli): compile, run, fmt

## Status

v0.5 compiler complete. 250 tests, 200 random property test iterations.
v0.5 adds: thunk axiom alignment (!x <- 5, !match), dot methods (.handle/.catch/.map/.tap), use (resource binding), on (push subscriptions + cycle detection), nested patterns + guards, newtype + record type declarations, comptime expressions.
Monorepo split: `@bang/core` (interpreter domain), `@bang/compiler` (compilation pipeline), `@bang/cli`.
Roundtrip property test: `eval(parse(format(ast))) ≡ eval(ast)` — covers parser + formatter + interpreter.

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
  → Checker (scope/type rules)
  → Codegen (compile to Effect TS)
  → Formatter (canonical output)
  → Property test: eval ≡ run(codegen)
  → Property test: parse(format(x)) roundtrips
```

The AST is the type-level test. Match.exhaustive is the assertion. The spec says what each case does.

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

## Known Issues

- `tsc` reports errors in Ast.ts (Schema.suspend + OptionFromUndefinedOr Encoded/Type mismatch) and Parser.ts (block return type) — type-level only, no runtime impact. `skipLibCheck: true` masks these.
- `@effect/printer` Doc.nest inside Doc.group triggers a flatten bug — blocks format flat-only for now.
- ESLint has 44 warnings in Parser.ts (imperative patterns) — accepted per pragmatic style rules.

## Specs & Plans

- Language spec: `docs/language-spec.md`
- Design specs and plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`
- Effect source: `~/Projects/Repos/effect` — read here instead of node_modules
