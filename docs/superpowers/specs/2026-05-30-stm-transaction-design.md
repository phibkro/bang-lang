# STM `transaction` — Design Spec

## Overview

Wire the `transaction` keyword end-to-end so Bang gains software transactional
memory. The keyword is already reserved (`Lexer.ts` `KEYWORDS`) and the surface
syntax + transpilation are already specified in `docs/language-spec.md`
(grammar `'transaction' Block`, force-resolution `!transaction B → yield*
STM.commit(STM.gen(…))`, the dedicated section at spec lines 773–816, and the
transpilation summary). Today it is **lexer-only**: no parser rule, AST node,
interpreter case, inference rule, checker handling, or codegen.

This spec resolves what the language spec leaves open — interpreter semantics,
the surface form of `retry`/`orElse`, and the `Ref`→`TRef` promotion strategy —
and lays out an interpreter-first, sliced implementation. The compile target,
Effect's `@effect/stm` (`STM`, `TRef`), does the concurrency-runtime work; Bang
stays "a formatter and transpiler, not a runtime" (spec line 22).

This supersedes the exploratory `bang-lang-design.md` STM section (`tvar`,
`atomically`, `:=`, kernel `effect STM { }`), which predates and conflicts with
the shipped spec and ADRs. Reconciliation table is in §Reconciliation.

## Scope

### Includes (v1)

- `transaction { … }` — a thunk (STM-typed value); `!transaction { … }` forces
  it (commit, or compose when nested).
- Atomic grouping of `mut` reads/writes inside a transaction.
- Automatic `Ref`→`TRef` promotion by usage classification (see §Architecture).
- STM composition — a transaction may call functions that are themselves
  transactional; parameters are inferred as `TRef`.
- `!retry` — abort-and-restart the current transaction.
- `expr.orElse other` — dot-method combinator: run `expr`; if it retries, run
  `other`; the result commits as one transaction.

### Excludes (deferred)

- **Mixed-mode bindings** — a `mut` used both inside and outside a transaction.
  v1 makes this a compile error; lifting the restriction (compiling
  non-transactional access through `STM.commit(TRef.get/set …)`) is a later
  slice.
- **Blocking-retry semantics in the interpreter** — a `retry` parked until a
  *concurrent* fiber writes a read `TRef`. Structurally impossible in a
  single-threaded reference interpreter; see §Interpreter boundary. Exists only
  in compiled output.
- Synchronisation primitives beyond `transaction` (`Semaphore`, `Deferred`,
  `Queue` — spec lists them under `STD.CONCURRENT`).
- Explicit `TRef` allocation syntax / a `tvar` binding form (promotion is
  automatic; no new binding keyword).

## Surface syntax & semantics

All conformant with `docs/language-spec.md`. No new keywords — `transaction` is
the only one. `retry` and `orElse` are **compiler intrinsics**, not library
functions: there is no `@bang/std` package (only `core`/`compiler`/`cli`), so
the spec's `STD.STM` is fiction until someone builds it. They are recognized by
name and special-cased, exactly as the four combinators `handle`/`catch`/`map`/
`tap` already are — those are **not** generic dispatch but hardcoded arms in
`Codegen.ts` (lines 277–302). `.orElse` becomes a fifth such arm; `retry` is a
compiler-recognized identifier handled in transaction scope. Both are
documented as STM vocabulary in `CONCEPTS.md`; neither is a user-space
importable value. (Standing up a real `@bang/std` to home them — and eventually
`TRef`, `all`/`race`/`fork` — is deferred; it's a new package + monorepo wiring,
out of scope for v1.)

| Form | Meaning |
| --- | --- |
| `transaction { … }` | STM-typed thunk; describes, does not run |
| `!transaction { … }` | force: outside a transaction → `STM.commit`; inside one → compose (no nested commit) |
| `!retry` | abort the current transaction (`retry : … Nothing`, an abort op forced like any effect) |
| `expr.orElse other` | run `expr`; on retry, run `other`; commit as one transaction |
| `!x` (inside a transaction) | read a `TRef` (STM `get`) — same syntax as a normal force, meaning shifts by context |
| `!x <- v` (inside a transaction) | write a `TRef` (STM `set`) — same syntax as normal mutation |

`!` remains the single force operator; its STM behavior is type/context-directed,
exactly as the spec's force-resolution table already prescribes.

## Architecture

### Interpreter model (the spec — ADR-0001)

> **Lands in Slice B, not A.** TDD showed the journal has no observable effect
> until `retry` exists (see §Pipeline & slicing). In Slice A a transaction
> simply evaluates its body block. The model below is the Slice-B target.

The reference interpreter gains a **transaction journal** (a tentative
write-buffer over the `mut` cells a transaction touches):

- Entering `transaction { … }` opens a journal.
- `!x` reads journal-then-store; `!x <- v` writes the journal only.
- Normal completion → merge the journal into the store (atomic commit). No
  partial state is ever visible because the merge is all-or-nothing.
- `!retry` → discard the journal, raise a `Retry` control signal.
- `.orElse(a, b)` → evaluate `a` against a sub-journal; on `Retry`, discard it
  and evaluate `b`; if `b` also retries, propagate `Retry`.

Conflict detection (read-set validation against concurrent committers) is moot
in a single-threaded interpreter — there are no concurrent committers — so it is
not modeled. The journal exists for **atomicity and rollback**, which *are*
observable single-threaded.

### Interpreter boundary (stated honestly)

STM's blocking semantics — `retry` parks a transaction until another fiber
writes a `TRef` it read — cannot exist single-threaded; there is no other fiber
to wake it. Therefore:

- A `Retry` that escapes to the top (no enclosing `orElse`, guard never clears)
  is a **defined error** in the interpreter: `"transaction blocked — no progress
  possible"`. Not a hang.
- `.orElse` is fully modeled (pure control flow).
- The `eval ≡ codegen` law (below) holds only for **deterministically-resolving**
  transactions. Blocking-then-woken-by-concurrent-writer behavior exists only in
  the compiled output (real `@effect/stm`).

This is consistent with ADR-0001: the interpreter is the spec for *semantics*;
here the compiler additionally supplies concurrency the interpreter
structurally cannot. The boundary is a property of single-threadedness, not a
shortcut.

### Type system

- New type `TRef A` (the spec already names it) and an **STM effect** carried in
  the effect row. A `transaction { … }` body has STM in its row; the whole
  expression is an STM-typed value.
- **Classification pass** (in `Infer`/`Checker`): each `mut` binding referenced
  inside any transaction — directly, or passed as an argument to a transactional
  function — is classified `TRef`; every other `mut` stays `Ref`. A transactional
  function's `mut`-typed parameters are inferred as `TRef` from the STM effect in
  its body.
- **`on` + `transaction` on one cell is a dedicated error (likely permanent).** A
  `mut` that is both an `on` source (`Interpreter.ts:312` requires `on`'s source
  be a `mut`) and transaction-touched gets a *distinct* diagnostic — an
  "STM/reactive conflict" — not the generic mixed-mode message. Rationale: `on`
  is glitch-free pull-on-update; STM is optimistic and retryable. If a
  transaction that wrote the cell retries or rolls back, there is no coherent
  story for whether the `on` handler already fired on a now-discarded value. The
  two topologies don't compose on a shared cell. Unlike the general mixed-mode
  restriction (a v1 deferral), this one is expected to stand. The classification
  pass counts `on`-usage as outside-transaction use, then specially recognizes
  the on+transaction overlap to emit the sharper diagnostic.
- **v1 restriction:** a `TRef`-classified `mut` that is **read or written**
  (`!x`, `!x <- v`, or subscribed via `on x`) *outside* any transaction is a
  **compile error** with a clear message naming the binding and pointing to the
  transaction that promoted it. The binding's **declaration/allocation** site
  (`mut alice = 1000` at top level) does *not* count as use — otherwise the
  feature would be unusable, since refs are always allocated outside the
  transactions that mutate them. This defers the genuinely-racy mixed-mode case
  and keeps codegen for non-transaction bindings byte-identical to today
  (protecting the existing suite).

### Codegen → Effect TS

Refines the spec's transpilation mapping for `TRef`:

| Bang | Effect TS |
| --- | --- |
| `mut x = e` classified `TRef` | `const x = yield* STM.commit(TRef.make(e))` |
| `mut x = e` classified `Ref` | `const x = yield* Ref.make(e)` (unchanged) |
| `!x` inside `STM.gen` | `yield* TRef.get(x)` |
| `!x <- v` inside `STM.gen` | `yield* TRef.set(x, v)` |
| `!retry` | `yield* STM.retry` |
| `transaction { … }` | `STM.gen(function* () { … })` |
| `!transaction …` outside a transaction | `yield* STM.commit(STM.gen(…))` |
| `!transaction …` inside a transaction | `yield* (…)` (compose) |
| `a.orElse b` | `STM.orElse(a, () => b)` |

`!retry` and `.orElse` are **compiler intrinsics** (see §Surface syntax), not
library calls. `.orElse` is added as a fifth hardcoded dot-method arm alongside
`handle`/`catch`/`map`/`tap` in `Codegen.ts` (~line 302). `retry` is recognized
by name in transaction scope by both interpreter and codegen; it is **not**
resolved through the env / `declare`-wrapper path, so the interpreter must
short-circuit it before normal identifier lookup (which would otherwise fail
"undefined identifier").

Exact `@effect/stm` signatures (`STM.orElse`'s lazy second argument, the
`STM.void`/`STM.unit`/`STM.succeed(undefined)` spelling for the empty branch,
whether `TRef.make` needs `STM.commit` wrapping in an `Effect.gen` context) are
verified against the installed Effect version during TDD — they are an
implementation detail, not a design fork.

## Worked example (bank transfer)

```
mut alice = 1000
mut bob   = 500
mut savings = 5000

transfer from to amount = transaction {
  bal = !from;
  match bal < amount { true -> { !retry } false -> { () } };
  !from <- bal - amount;
  !to   <- !to + amount
}

payEither main fallback recipient amount = {
  (transfer main recipient amount).orElse (transfer fallback recipient amount)
}

!transfer alice bob 200;
!(payEither alice savings bob 2000)
```

emits (shape — exact API verified at TDD time):

```ts
import { Effect, STM, TRef } from "effect"

const transfer = (from) => (to) => (amount) => STM.gen(function* () {
  const bal = yield* TRef.get(from)
  yield* (bal < amount ? STM.retry : STM.void)
  yield* TRef.set(from, bal - amount)
  yield* TRef.set(to, (yield* TRef.get(to)) + amount)
})

const payEither = (main) => (fallback) => (recipient) => (amount) =>
  STM.orElse(transfer(main)(recipient)(amount), () => transfer(fallback)(recipient)(amount))

Effect.runPromise(Effect.gen(function* () {
  const alice   = yield* STM.commit(TRef.make(1000))   // promoted: TRef, not Ref
  const bob     = yield* STM.commit(TRef.make(500))
  const savings = yield* STM.commit(TRef.make(5000))
  yield* STM.commit(transfer(alice)(bob)(200))
  yield* STM.commit(payEither(alice)(savings)(bob)(2000))
}))
```

`alice`/`bob`/`savings` are all referenced only inside transactions, so all are
promoted to `TRef` with no v1 restriction triggered.

## Correctness & testing

- **Roundtrip law** `eval(parse(format(ast))) ≡ eval(ast)` — **enforced**. Extend
  `AstGen` to emit `transaction`, `retry`, and `.orElse` nodes; add the formatter
  rule "transaction always on its own line" (spec §Formatting #11).
- **eval ≡ codegen** — **scoped**. The property generator emits only
  deterministically-resolving transactions (orElse-terminating, no dependence on
  cross-fiber wakeup). Blocking-retry programs are excluded from the equivalence
  generator and covered instead by targeted interpreter unit tests asserting the
  `"transaction blocked"` defined-error.
- **Interpreter unit tests**: atomic commit, rollback-on-retry (writes before a
  `retry` are not visible), `orElse` fallback selects the second branch, nested
  composition commits as one unit, top-level escaping `retry` → defined error.

## Pipeline & slicing

Interpreter-first per `CLAUDE.md` ("get semantics right in the simpler system,
then translate"). Walk the standard feature pipeline (AST node → Lexer → Parser
→ Interpreter → Infer → Checker → Codegen → Formatter → property test). Sliced
so each slice lands independently green (`vp run check` + `pnpm test`):

- **Slice A — atomic block.** `transaction { }` + `TRef` classification. AST
  node, parser rule, interpreter (evaluates the body as a block — see note),
  Checker lexical classification + the v1 mixed-mode / `on`-conflict errors,
  codegen with `mut`→`TRef` promotion, formatter, roundtrip property test.
  **No journal in Slice A** — discovered during TDD: without an abort path
  (retry) or concurrency, a buffered-then-committed write is *observationally
  identical* to a direct mutation (behavior "commit visible" passes with zero
  journal code), and rollback-on-failure isn't observable through the public
  interface because execution can't continue past the failure to inspect state.
  A journal here would be speculative code no test can drive. So Slice A's
  interpreter semantics are simply "a transaction evaluates as a block";
  atomicity is vacuously satisfied single-threaded with no abort path.
- **Slice B — retry + the journal.** `!retry`: this is where the journal earns
  its place — a `retry` rolls back *and continues* (re-runs), making buffered
  commit observable. Interpreter gains the transaction-scoped overlay (write
  buffer + rollback), the blocked-error boundary, and `STM.retry` codegen.
- **Slice C — orElse.** `.orElse` dot-method: sub-journal try/fallback in the
  interpreter, `STM.orElse` codegen.
- **Slice D — transactional functions.** Parameter `TRef` inference for
  functions whose body is/contains a transaction, plus the scoped `eval ≡
  codegen` property test.

## Reconciliation (design note → shipped reality)

| `bang-lang-design.md` proposed | Resolved to |
| --- | --- |
| `atomically { … }` | `transaction { … }` (reserved keyword) |
| `tvar x = …` distinct binding | no `tvar`; `mut` auto-promotes to `TRef` by usage |
| `!tvar` read / `tvar := v` write | `!x` force / `!x <- v` mutation in STM context |
| `retry()`, `orElse` as kernel ops | `!retry` (forced abort) + `.orElse` dot-method, in `STD.STM` |
| `effect STM { … }` declaration | dropped — ADR-0002, no `effect` keyword |
| `[S]` bracket generics | juxtaposition (`TRef Int`) |

## Code-reality findings (resolved during grilling)

- **No `@bang/std`.** `STD.STM`/`STD.CONCURRENT`/`TRef` exist only in
  `language-spec.md`, not in code. `retry`/`orElse` are therefore **compiler
  intrinsics**, not library imports (see §Surface syntax & §Codegen). Building a
  real `@bang/std` is deferred.
- **`EvalError` has no variants.** It is a single flat `Schema.TaggedError`
  (`message`, optional `tag`, `span`) in `Value.ts:41`. The "transaction
  blocked" error is therefore just `new EvalError({ message: "transaction
  blocked — no progress possible", tag: "TransactionBlocked", span })` — the
  existing optional `tag` field carries the programmatic discriminator; no new
  error type is introduced.
- **`MutCell` mutates in place** (`Value.ts:27`, with a baked-in `subscribers`
  array for `on`); there is no journal today. The interpreter's transaction
  journal is a new transaction-scoped overlay keyed on `MutCell.ref` object
  identity, threaded through `evalExpr` while a transaction is open; see
  §Interpreter model. (Implementation detail confirmed feasible, not a fork.)

## Grilling outcome

All open items resolved against code reality (see §Code-reality findings and the
`on`+`transaction` rule in §Type system). Design is hardened; ready for `tdd`
(Slice A first).

**Glossary discipline:** STM vocabulary (`transaction`, `TRef`, the transaction
journal, `retry`, `.orElse`, the STM/reactive conflict) is deliberately **not**
added to `CONCEPTS.md` yet — that glossary tracks what the language *does*, and
the feature is unbuilt. Each slice's definition of done includes adding its
now-real terms to `CONCEPTS.md` as it lands, so the glossary never describes
behavior the code lacks. The resolved vocabulary lives here in the design spec
until then.
