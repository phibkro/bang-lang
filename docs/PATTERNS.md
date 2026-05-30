---
summary: Implementation patterns, Effect-TS style rules, and known limitations across the compiler packages.
---

# Patterns & Implementation Notes

The implementation-level reference: the conventions a contributor must match,
the Effect-TS style split, and the limitations that are known and accepted.
Read-on-demand; the entrypoint (`CLAUDE.md`) routes here.

## Patterns

- All domain types use `Schema.TaggedClass` (Token, AST, Span) or
  `Schema.TaggedError` (CompilerError).
- Recursive AST types use `Schema.suspend` for forward references.
- `Schema.OptionFromUndefinedOr` fields (Arm.guard, Declaration.typeAnnotation)
  are `Option<T>` at runtime — use `Option.isSome()`, NOT `!== undefined`.
- `constructor` is reserved on `Schema.TaggedClass` — use `ctor` (see
  InferType.TApp).
- All dispatch uses `Match.tag` with `Match.exhaustive` — no switch/case on
  `_tag`.
- Checker uses `HashMap` for scope, `Option` for nullable values, `Effect.fail`
  for errors.
- Codegen uses an immutable `WriterState` accumulator — no mutable class.
- Lexer uses the combinator pattern:
  `Recognizer = (ScanState) => Option<[Token, ScanState]>` with `firstOf`
  composition.
- Parser uses immutable `ParseState` with all primitives returning `Effect`.
- `declare` generates wrapper functions in codegen; `!` always means `yield*`.
- Tests use `@effect/vitest` (`it.effect` for effectful tests).
- ESLint: `eslint-plugin-functional` + `@effect/eslint-plugin` +
  `typescript-eslint/strict`.
- Interpreter values use `Data.TaggedEnum` (lightweight, no Schema overhead —
  values are internal, never serialized).
- Formatter uses the `@effect/printer` Doc IR — `Doc.group` for smart
  line-breaking, `Doc.hcat` for concatenation.
- AST generators use `FastCheck` from effect with bounded recursion for property
  tests.
- Pre-commit: `vp staged` runs `vp check --fix` + `npx eslint --fix` on staged
  `.ts` files.
- `TypeError` (from `@bang/core`) ≠ `CompilerError` — inference errors must be
  `catchAll`'d when crossing the core→compiler boundary.
- `Checker.ts` has a nested `checkStmt` call inside block validation
  (~line 308) — update ALL call sites when changing the signature.

## Effect Style Rules

Strict (enforce):

- `Schema.TaggedClass` for all domain types (AST, errors, tokens).
- `Match.tag` with `Match.exhaustive` for AST/token dispatch.
- `Effect.fail` over `throw`; `Option` over `undefined` for nullable fields.
- `HashMap` over mutable `Map`; `Schema.is()` and `Either.isLeft()` in tests.

Pragmatic (skip):

- Character predicates (`isDigit`, `isAlpha`) stay as simple boolean functions.
- `if`/`else` guards in `Effect.gen` for early returns are fine.
- Internal-only state types (`ScanState`, `ParseState`) stay as plain
  interfaces.
- Constant Sets (`KEYWORDS`, `DELIMITERS`) stay as `new Set()`.
- Pure string operations stay as-is.

## Interpreter Patterns

- `<-` in `BinaryExpr`: do NOT `evalExpr` the left side (would unwrap MutCell).
  Extract the `Ident` name directly.
- `.handle` binds with a `__handler_` prefix to avoid user name collisions.
- `use` CPS: the Block handler detects `Force(UseExpr)`, builds a continuation
  lambda from the remaining stmts.
- `on` subscribers use a `{ active: boolean, fn }` pattern. The subscription
  registry is module-level.
- `genBinaryOperand` excludes `Lambda`/`OnExpr` to prevent flaky roundtrip
  property tests.

## Known Issues

- `tsc` reports errors in `Ast.ts` (`Schema.suspend` + `OptionFromUndefinedOr`
  Encoded/Type mismatch) and `Parser.ts` (block return type) — type-level only,
  no runtime impact. `skipLibCheck: true` masks these.
- `@effect/printer` `Doc.nest` inside `Doc.group` triggers a flatten bug —
  blocks format flat-only for now.
- ESLint has ~209 warnings (imperative patterns in
  Parser/Interpreter/Codegen/Infer) — accepted per the pragmatic style rules
  above.

## Known Inference Limitations

- `Infer.ts` uses a module-level mutable counter (`nextId`) — reset in
  `inferProgram`, not safe for concurrent use. Documented in code.
- The Checker runs `inferProgram` then annotates — inference errors are
  non-fatal (falls back to `TCon("Unknown")`).
- `ForceStatement`/`ExprStatement`/`TypeDecl`/`Import`/`Export` annotations
  still use `TCon("Unknown")` — only `Declaration` and `Declare` carry real
  inferred types.

## Known Codegen Limitations

- Guards on grouped constructor arms (same outer tag) not yet codegen'd — the
  interpreter handles them.
- Multi-field nested constructor patterns (`Pair a b`) only single-field
  supported in codegen.
- The subscription registry is module-level mutable state (leaks across test
  runs, works in practice).
- `.abort` on a Subscription is an immediate side effect, not a returned thunk.
