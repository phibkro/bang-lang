# ADR-0001: The interpreter is the executable spec; the compiler is an optimization

**Status:** Accepted
**Date:** 2026-03-26

## Context

Bang has two execution paths: a reference interpreter (`@bang/core`,
`Interpreter.ts`) that evaluates the AST directly to values, and a compiler
(`@bang/compiler`, `Codegen.ts`) that translates the AST to Effect TS. Both must
agree on what a program _means_. Something has to be the authority when they
disagree, and when the language semantics themselves are ambiguous.

## Decision

The **interpreter is the spec**. It defines what Bang programs mean: when
semantics are ambiguous, the interpreter resolves it — it has to produce a
value, so it cannot dodge the question.

The **compiler is an optimization of the interpreter**. Codegen translates
semantics to Effect TS; it does not define behavior. If the compiler disagrees
with the interpreter, the compiler is wrong.

This sets the feature pipeline: a feature lands in the interpreter (the simpler
system, where semantics are easy to get right) _before_ the compiler. Then a
property test asserts the two agree:

```
Language spec (what it means, in docs/language-spec.md)
  → Interpreter (executable semantics, ground truth)
  → Compiler (optimized translation to Effect TS)
  → Property test (they agree)
```

The correctness equation is `eval(ast) ≡ run(codegen(ast))`. (As of this
writing the property test exercises interpreter agreement; the full
eval≡codegen comparison is a target, not yet enforced — see
`packages/compiler/test/Property.test.ts:50` and the note in `CLAUDE.md`.)

## Alternatives considered

- **Compiler-first / no interpreter.** Make the generated Effect TS the only
  definition of meaning. Rejected: there would be no independent oracle to test
  codegen against, ambiguous semantics would be pinned down by whatever the
  generator happened to emit, and debugging semantics would mean reading
  generated code instead of a small direct evaluator.
- **A prose spec as the authority.** Rejected: prose drifts and cannot be
  executed, so it cannot serve as a test oracle. The EBNF spec
  (`docs/language-spec.md`) defines _syntax_; the interpreter defines _meaning_.

## Consequences

- Don't add a feature to the compiler without adding it to the interpreter
  first.
- The interpreter is allowed to be slow and simple; clarity of semantics beats
  performance there.
- The compiler may legitimately support _less_ than the interpreter
  temporarily; such gaps are tracked under "Known Codegen Limitations" in
  `docs/PATTERNS.md`.
- The interpreter↔compiler property test is load-bearing: it is the structural
  enforcement of this decision.
