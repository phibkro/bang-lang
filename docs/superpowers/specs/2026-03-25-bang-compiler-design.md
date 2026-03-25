# Bang Language Compiler — Design Spec

**Version:** 0.1
**Date:** 2026-03-25
**Target:** Effect TS transpilation
**Language spec:** v0.2 (EBNF)

## Overview

Bang is a functional-reactive language that transpiles to Effect TS. The compiler is implemented in TypeScript using Effect, structured as a library with CLI and REPL consumers. Reactivity (Signal vs Effect distinction) is tracked from day one.

## Decisions

| Decision                | Choice                             | Rationale                                                                 |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| Implementation language | TypeScript + Effect                | Same ecosystem as target; composable pipeline; fast iteration             |
| Monorepo tooling        | Vite+ (`vp`)                       | Globally available; handles build, test, lint                             |
| Parser strategy         | Effect-native combinators          | Schema for lexing, Effect composition for parsing; no external library    |
| Expression parsing      | Pratt parser (precedence climbing) | Maps directly to spec's precedence order                                  |
| Type checking (phase 1) | Delegate to tsc                    | Emit annotated TS, run `tsc --noEmit`, map diagnostics back to Bang spans |
| Type checking (goal)    | Full Hindley-Milner                | Replaceable Effect service; same interface, swappable implementation      |
| Reactivity              | Core from day one                  | Signal/Effect classification tracked in typed AST                         |
| Error style             | Rust-inspired                      | Multi-error collection, source context, carets, colored, actionable hints |
| Milestone strategy      | Vertical slice                     | Full pipeline for small subset, widen incrementally                       |

## Project Structure

```
bang-lang/
├── packages/
│   ├── core/                    # @bang/core — compiler library
│   │   ├── src/
│   │   │   ├── lexer/           # Schema-based tokenization
│   │   │   ├── parser/          # Effect-native parser, Pratt for exprs
│   │   │   ├── ast/             # AST node types (untyped + typed)
│   │   │   ├── checker/         # Bang-specific checks + tsc delegation
│   │   │   ├── codegen/         # AST → Effect TS source
│   │   │   ├── compiler/        # Pipeline orchestration
│   │   │   └── errors/          # Diagnostic types + Rust-style formatting
│   │   └── test/
│   ├── cli/                     # @bang/cli — thin wrapper via @effect/cli
│   │   └── src/
│   └── repl/                    # @bang/repl — interactive mode
│       └── src/
├── examples/                    # .bang example programs
└── docs/
```

## Compiler Pipeline

```
Source (.bang)
  → Lexer    → Token[]
  → Parser   → UntypedAST
  → Checker  → TypedAST
  → Codegen  → string (Effect TS)
  → Emitter  → .ts file (CLI only)
```

Each phase is an Effect service with a typed interface:

```typescript
Lexer: (source: string) => Effect<Token[], LexError>;
Parser: (tokens: Token[]) => Effect<UntypedAST, ParseError>;
Checker: (ast: UntypedAST) => Effect<TypedAST, CheckError>;
Codegen: (ast: TypedAST) => Effect<string, CodegenError>;
```

Phases produce distinct types — no mutation of a shared structure. Errors are typed per phase and composed at the pipeline level into `CompilerError`. The library exposes each phase individually (for REPL, testing) plus a composed `compile` function.

## Lexer

Schema-based token definitions. Each token type is a Schema, composed together. Validation and literal parsing (numbers, strings) come free from Schema's decode/encode.

### Token Categories

| Category | Tokens                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keywords | `mut`, `comptime`, `type`, `declare`, `from`, `import`, `export`, `match`, `not`, `and`, `or`, `xor`, `where`, `defer`, `true`, `false`, `if`, `transaction`, `race`, `fork`, `scoped` (see note below) |

**Deferred keywords:** `comptime` (compile-time evaluation), `where` (type constraints), and `scoped` (resource scoping) are reserved in the lexer but have no parser, checker, or codegen support until their respective feature slices. They exist only to prevent use as identifiers.
| Operators | `=`, `<-`, `->`, `!`, `.`, `+`, `-`, `*`, `/`, `%`, `++`, `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Delimiters | `(`, `)`, `{`, `}`, `[`, `]`, `,`, `:`, `;` |
| Literals | Integer, Float, String, `true`, `false`, `()` |
| Identifiers | `Ident` (lowercase start), `TypeIdent` (uppercase start) |
| Special | EOF |

Every token carries a `Span` (start/end position: line, column, offset) for error reporting.

String handling is simple for now — `"` to `"`, no interpolation. Escape sequences deferred.

## AST

Two-layer AST: **Untyped** (parser output) and **Typed** (checker output). Both share the same node structure; typed nodes carry additional annotations.

### Node Hierarchy

```
Program
  Statement[]
    Declaration     (let, mut, comptime, type, declare)
    Mutation        (expr <- expr)
    Force           (! expr)
    Import          (from M import f)
    Export          (export f)
    Defer           (defer ! expr)

Expr
    DotExpr         (expr.ident atoms)
    AppExpr         (expr atom+)
    BinaryExpr      (+, -, *, /, %, ++, comparisons)
    LogicalExpr     (and, or, xor, not)
    ForceExpr       (! expr)
    MutationExpr    (expr <- expr)
    Ident           (variable reference)
    Literal         (int, float, string, bool, list, unit)
    Block           ({ stmt* expr })
    Match           (match expr { arm+ })
    Lambda          (params -> block)
    Transaction     (! transaction block)
    Concurrent      (![ ], !race [ ], !fork)
    Grouped         (( expr ))

Pattern
    Wildcard, Binding, Constructor, Literal,
    List, HeadTail, Record, Guard

Type
    Applied, Arrow, Concrete, Constrained,
    Variable, Record, List, Tuple, Unit
```

Every node carries a `Span`. Typed nodes additionally carry:

- `type: Type` — inferred or annotated type
- `effectClass: "signal" | "effect"` — Signal/Effect distinction

Represented as `Data.TaggedEnum` from Effect — exhaustive matching and structural equality for free.

## Parser

Effect-native composition as the combinator foundation. A `Parser<A>` is an Effect that reads from a `Ref<TokenStream>`. No custom combinator library — let patterns emerge from the code, factor out repetition as it appears.

### Expression Parsing

Pratt parser (precedence climbing) mapping to the spec's precedence order:

| Precedence | Operators                      |
| ---------- | ------------------------------ |
| Highest    | `.` (composition/field access) |
|            | juxtaposition (application)    |
|            | `*` `/` `%`                    |
|            | `+` `-` `++`                   |
|            | `==` `!=` `<` `>` `<=` `>=`    |
|            | `not`                          |
|            | `and`                          |
|            | `or`                           |
|            | `xor`                          |
|            | `!` (force)                    |
| Lowest     | `<-` (mutation)                |

### Error Recovery

On parse failure, report error with span, then synchronize to next statement boundary (`;` or `}`) to continue parsing and collect multiple errors per compilation.

## Checker (Phase 1 — tsc-delegated)

Minimal checker handling what tsc cannot, delegating the rest.

### Bang Checker Responsibilities

1. **Signal vs Effect classification** — Bottom-up AST walk using these rules:
   - **Leaf rules:** Literals, identifiers referencing immutable bindings → Signal. `Ref.get`/`Ref.set`, `!` of an Effect-typed expr → Effect.
   - **Propagation:** A block is Effect if any statement within it is Effect. A function is Effect if its body is Effect. Otherwise Signal.
   - **Transitivity:** Calling a function classified as Effect makes the call site Effect (even without `!` — that's a must-handle error, but classification still propagates).
   - **`declare` externals:** The type annotation on `declare` determines classification. `Effect` in return type → Effect. Pure return type → Signal.
   - **Top-level bindings:** Classified by their initializer expression.
   - **v0.1 pragmatics:** Both Signal and Effect compile to `Effect.Effect<A, E, R>`. Misclassification in v0.1 has no codegen consequence — it only affects `// Signal` annotations in output. The classification infrastructure exists for correctness when the full checker (HM) is implemented.
2. **Must-handle enforcement** — `Effect` or `Result` in statement position without `!` → compile error. Simple AST walk.
3. **Exhaustiveness checking** — Verify all constructors of an ADT are covered in `match`. Compile error for non-exhaustive patterns.
4. **Scope validation** — Identifiers defined before use, `mut` shadowing rules, `declare` references exist.
5. **Force resolution** — Determine `!` variant (yield\*, Effect.promise, Effect.sync, no-op) based on declared/inferred type.

### tsc Delegation

Codegen emits `.ts` with type annotations. CLI runs `tsc --noEmit` and maps TS diagnostics back to Bang source spans. Users never see `.ts` file references.

**Source map strategy:** An in-memory `Map<TSPosition, BangSpan>` built during codegen — not a standard `.map` file. Granularity is expression-level: each emitted TS expression records which Bang AST node (and thus span) produced it. Multi-expansion cases (e.g., `x = y = expr` → 3 TS statements) map all generated positions back to the original Bang span. Errors in generated wrapper code (`Effect.gen(function* () { ... })`) map to the enclosing Bang block's span.

### Path to Full HM

The checker is a replaceable Effect service. When Algorithm W is implemented, swap the implementation — same interface, same typed AST output, inference moves from tsc into Bang's checker.

## Codegen

Template-based string building. Each AST node type has an `emit` function. Direct AST-to-string with a `Writer` (string buffer tracking indentation).

### Translation Table

| Bang                     | Effect TS                                                   |
| ------------------------ | ----------------------------------------------------------- |
| `x = expr`               | `const x = expr`                                            |
| `mut x = expr`           | `const x = yield* Ref.make(expr)`                           |
| `x = y = expr`           | `const _e = expr; const y = _e; const x = _e`               |
| `!e` (Effect)            | `yield* e`                                                  |
| `!e` (Promise)           | `yield* Effect.promise(() => e)`                            |
| `!e` (thunk)             | `yield* Effect.sync(() => e())`                             |
| `!e` (value)             | `e` (no-op)                                                 |
| `e.f`                    | `pipe(e, f)`                                                |
| `e.f x y`                | `pipe(e, f(x)(y))`                                          |
| `x <- e`                 | `yield* Ref.set(x, e)`                                      |
| `a <- (b <- (c <- e))`   | chained `Ref.set` via `Effect.flatMap`                      |
| `{ stmts; expr }`        | `Effect.gen(function* () { stmts; return expr })`           |
| `match e { arms }`       | tag checks with exhaustiveness                              |
| `(p) -> { body }`        | `(p) => Effect.gen(function* () { body })`                  |
| `!transaction { body }`  | `yield* STM.commit(STM.gen(function* () { body }))`         |
| `![e1, e2]`              | `yield* Effect.all([e1, e2], { concurrency: 'unbounded' })` |
| `!race [e1, e2]`         | `yield* Effect.race(e1, e2)`                                |
| `!fork e`                | `yield* Effect.fork(e)`                                     |
| `defer !e`               | `yield* Effect.addFinalizer(() => e)`                       |
| `type UserId = String`   | branded type via `Brand.nominal`                            |
| `type Pair A B = (A, B)` | `type Pair<A, B> = [A, B]`                                  |
| `declare f : A -> B`     | No TS output; registers type info for force resolution      |
| `from M import f`        | `import { f } from 'M'`                                     |
| `export f`               | `export { f }`                                              |
| top-level `!e`           | `Effect.runPromise(Effect.gen(function* () { ... }))`       |

### Import Management

Codegen tracks which Effect modules are used during emission and generates the import block at the top. Only imports what's needed.

### Signal vs Effect in Output

Both compile to `Effect.Effect<A, E, R>`. The distinction lives in emitted type annotations and documentation comments (`// Signal`). tsc validates correctness; the distinction is preserved for tooling.

## CLI

Thin wrapper using `@effect/cli`.

```
bang compile <file.bang>         # Emit .ts alongside source
bang compile <file.bang> -o dir  # Emit to output directory
bang check <file.bang>           # Type check only (no emit)
bang run <file.bang>             # Compile + run via host runtime
bang fmt <file.bang>             # Format (spec's 14 rules)
bang repl                        # Launch REPL
```

`bang run` compiles to a temp directory, then executes with the host runtime. No bundling — output is standard TS importing from `effect`.

## REPL

Uses the library API directly: `parse()` → `check()` → `codegen()` → `eval()`.

- Expression mode: type an expression, see Effect TS output and evaluated result
- `:type expr` — show inferred type without executing
- `:emit expr` — show generated Effect TS without executing
- `:ast expr` — show parsed AST (debug aid)
- Session scope: bindings persist across inputs
- Wraps evaluation in `Effect.runPromise`
- **Eval strategy (TBD):** Likely compiles to JS via esbuild, evaluates in a persistent V8 context with `effect` pre-loaded. Detailed design deferred until REPL feature slice.

## Error Reporting

Rust-inspired error rendering with multi-error collection.

### Error Types

```
LexError      — unexpected character, unterminated string
ParseError    — unexpected token, missing delimiter
CheckError    — unresolved identifier, must-handle violation,
                non-exhaustive match, misclassification
CodegenError  — unsupported node (during incremental development)
TscError      — mapped TypeScript diagnostics
```

### Common Structure

All errors carry:

- `span: Span` — points to `.bang` source
- `message: string` — human-readable
- `hint?: string` — suggestion for how to fix

### Multi-Error Collection

The compiler doesn't bail on the first error. Each phase collects as many as it can — parser synchronizes at statement boundaries, checker walks the full AST. All errors reported together.

### tsc Error Mapping

Codegen emits a simple source map (Bang span → TS line/column). tsc diagnostics are mapped back to Bang source positions. Errors display as Bang errors pointing to `.bang` files.

### Output Format

Source context with caret pointing to span, colored by severity. Similar to Rust's `rustc` output — clear, actionable, shows relevant code.

## Formatter

Separate module in `core`. Implements the 14 formatting rules from the spec:

1. Semicolons after every Statement
2. Braces around all Block bodies
3. Lambda params parenthesised
4. Chained mutations right-associated
5. Chained unifications share one node
6. Single space around binary operators
7. Single space after keywords
8. Newline after `{` and before `}`
9. Two-space indentation inside blocks
10. Imports sorted alphabetically
11. Type annotations filled in where unambiguously inferable
12. Unit is `()` in value position
13. `transaction` on its own line
14. `match` arms each on their own line

CLI's `fmt` command calls it. `compile` can optionally auto-format before compilation.

## v0.1 Scope (Vertical Slice)

### Target Program

```bang
declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting
```

### Included

- **Lexer:** keywords, identifiers, string literals, operators (`=`, `!`, `:`, `->`, `.`), delimiters, EOF
- **Parser:** `declare`, simple declarations, force expressions, function application, string/int/bool literals, `()`
- **Checker:** force resolution (Effect → `yield*`), scope validation, must-handle for top-level `!`
- **Codegen:** `const` bindings, `yield*`, `Effect.gen` wrapper, `Effect.runPromise` for top-level force, import generation
- **CLI:** `bang compile` and `bang run`
- **Errors:** Rust-style rendering with spans and hints

### Deferred

- `mut`, `<-`, `Ref`
- `match`, patterns, ADTs
- Lambdas, blocks as expressions
- `type` declarations, branded types
- Transactions, concurrency, `defer`
- `from`/`import`/`export` (single-file only)
- Formatter
- REPL

Each subsequent slice adds one feature group with full pipeline coverage and tests.

## Reference

- **Effect repo:** `~/Projects/Repos/effect` — consult for API patterns and idiomatic usage
- **Bang language spec:** v0.2 EBNF — authoritative source for syntax and semantics
