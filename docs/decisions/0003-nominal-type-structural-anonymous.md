# ADR-0003: `type` declarations are nominal; anonymous types are structural; every type auto-derives a Schema

**Status:** Accepted
**Date:** 2026-03-26

## Context

Bang compiles to Effect TS, where `Schema` provides runtime validation and
encode/decode. The language must decide its type identity rule — when are two
types "the same"? — and how a Bang type relates to a runtime `Schema`. The two
classic choices are nominal (identity by name/declaration) and structural
(identity by shape); each fits a different use.

## Decision

**Named `type` declarations are nominal (branded).** Two `type`s with the same
underlying shape are distinct types with distinct identity — a newtype-style
brand. `type UserId = String` is not interchangeable with `String` or with
another `type OrderId = String`.

**Anonymous types are structural.** An inline record type like
`{ name: String }` is identified by its shape: same shape means same type, no
declaration required.

**Every type auto-derives a `Schema`.** A Bang type _is_ a runtime `Schema`
(named types compile to `Schema.Class`/branded schemas; records to
`Schema.Class` with the field schemas; ADTs to a `Schema.Union` of tagged
structs). There is no separate "make this validatable" step.

## Alternatives considered

- **All-structural (no nominal types).** Rejected: structural-only loses the
  ability to brand domain types (`UserId` vs `OrderId`), which is a primary
  reason to declare a type at all; accidental interchangeability is a known
  footgun.
- **All-nominal (declare every type).** Rejected: it forces a name on
  throwaway inline shapes (function args, intermediate records), adding
  ceremony where structural identity is exactly what's wanted.
- **Schema opt-in (derive only on request).** Rejected: auto-derivation keeps
  the type system and the runtime-validation story unified — "the type is the
  schema" — instead of maintaining two parallel declarations that can drift.

## Consequences

- Use a named `type` when you want identity/branding; use an anonymous type
  when you want shape-equality and no ceremony.
- Because every type is a `Schema`, validation, encode/decode, and the
  compiler's own AST representation share one mechanism (see the
  `Schema.TaggedClass` patterns in `docs/PATTERNS.md`).
- The nominal/structural split is a semantic rule documented in
  `docs/CONCEPTS.md` (Type declarations) and the spec
  (`docs/language-spec.md`).
