# ADR-0002: Effects are types — no `effect` keyword

**Status:** Accepted
**Date:** 2026-03-26

## Context

Bang needs to express effectful computation (errors, dependencies) on top of
Effect TS, whose `Effect<A, E, R>` carries a value channel `A`, an error
channel `E`, and a requirement/dependency channel `R`. A language could mark
effectfulness syntactically — an `effect { ... }` block, a `do`-notation
keyword, a function colour — or it could encode it purely in the type and let
the compiler classify operations mechanically.

## Decision

**Effectfulness is encoded in the type, not in syntax.** There is no `effect`
keyword and no effect block. `Effect A E R` and `Signal A E R` are ordinary
types; effects live in the `E` and `R` type parameters (algebraic effect
_rows_, not a single error type).

**Channel classification is mechanical.** The compiler routes operations by
their result type, not by author annotation:

- an operation returning `Nothing` (cannot produce a value — it aborts) flows
  to the **E** (error) channel;
- an operation returning a value flows to the **R** (dependency) channel.

`!` is the single force site (see ADR-0001 / `docs/CONCEPTS.md`) and always
compiles to `yield*`. `gen` is the deliberate escape hatch to raw Effect TS
for the cases the surface language cannot yet express.

## Alternatives considered

- **An `effect` block / `do`-notation keyword.** Rejected: it makes
  effectfulness a syntactic property the author must restate, duplicating
  information the type already carries, and it splits the language into
  effectful and pure dialects. Mechanical classification keeps one surface
  syntax and lets the type system be the single source of truth.
- **Function colouring (async/await-style).** Rejected: colouring forces a
  viral annotation up every call chain; encoding effects in the type row lets
  composition stay uniform.

## Consequences

- The classification rule (`Nothing` → E, value → R) is a load-bearing
  semantic convention; it lives in `docs/CONCEPTS.md` (Types and channels) and
  the spec (`docs/language-spec.md`).
- `Signal A E R` is distinct from `Effect A E R` at the type level but
  identical at runtime — the difference is whether `!` is applied to effectful
  expressions, which the type captures.
- Removing the keyword means the only way "into" effect-land from raw Effect TS
  is `gen`; that keeps the escape hatch explicit and greppable.
