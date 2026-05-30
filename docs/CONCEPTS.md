---
summary: Bang's vocabulary — the nouns and verbs of the language and why they exist.
---

# Concepts — Bang's Vocabulary

The mental-model reference for Bang. Definitions of the language's nouns and
verbs; the _why_ lives here so the entrypoint (`CLAUDE.md`) and the spec
(`docs/language-spec.md`) can stay lean.

## Evaluation model

- **Pull model** — Every binding is a lazy thunk. Nothing computes until
  forced. `!` is the single site where descriptions become reality. Push
  (eager, reactive) is opt-in via `on`; pull is the default.
- **Thunk** — A deferred description of a computation. Bindings are thunks, not
  values; forcing a thunk runs it. "Everything is a description; `!` is the only
  way to make a description real."
- **`!`** — The force operator. It flatmaps: one `!` unwraps to the value
  regardless of nesting depth. `!` always compiles to `yield*`. It binds loosest
  (except `<-`), forcing everything to its right.

## Types and channels

- **`Effect A E R`** — A = value, E = error effects, R = dependency effects.
  Both E and R are algebraic effects (effect _rows_, not a single error type).
- **`Signal A E R`** — A pure lazy computation (no `!` on effectful
  expressions). Distinct from `Effect` at the type level, identical at runtime.
- **E channel vs R channel** — Channel classification is mechanical: operations
  returning `Nothing` flow to the E (error) channel; operations returning values
  flow to the R (dependency) channel. There is no `effect` keyword — see
  `docs/decisions/0002-effects-are-types.md`.
- **Effects are types** — Effectfulness is encoded in the type, not a syntactic
  block. The compiler classifies channels structurally.

## Type declarations

- **Nominal vs structural** — `type` declarations are nominal (branded):
  distinct identity even with the same shape. Anonymous types are structural:
  same shape means same type. Every type auto-derives a `Schema`. See
  `docs/decisions/0003-nominal-type-structural-anonymous.md`.
- **Type variables** — Always lowercase (`a`, `b`). Concrete types are
  uppercase (`Int`, `Maybe`). Constraints use angle brackets:
  `<a : Numeric> a -> a` (no `where` keyword).
- **`Array` vs `List`** — `[1, 2, 3]` is a JS Array. `List a` (Cons/Nil) is a
  separate ADT.

## Verbs and blocks

- **`on`** — Explicit push subscriptions with compile-time cycle detection. Push
  is opt-in; pull is the default.
- **`use`** — Structured resource acquisition, replacing `defer`.
  `use x = f; rest` desugars to `!f (x) -> { rest }`.
- **`gen`** — The escape hatch to raw Effect TS (replaces the old `effect`
  block).
- **Handlers** — `.handle`, `.catch`, `.map`, `.tap` are composable channel
  handlers via dot syntax.

## Keywords (19)

`mut type declare from import export match not and or xor if true false
transaction gen on use comptime`
