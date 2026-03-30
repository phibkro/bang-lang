import { Effect, HashMap, Match, Option } from "effect";
import type { InferType } from "./InferType.js";
import { TApp, TArrow, TCon, TVar } from "./InferType.js";
import { OccursCheck, UnificationError } from "./TypeError.js";
import type { TypeError } from "./TypeError.js";
import type { Span } from "./Span.js";

// ---------------------------------------------------------------------------
// Substitution: maps type variable IDs to their resolved types
// ---------------------------------------------------------------------------

export type Substitution = HashMap.HashMap<number, InferType>;

// ---------------------------------------------------------------------------
// Apply substitution — chase variable chains
// ---------------------------------------------------------------------------

export const apply = (subst: Substitution, type: InferType): InferType =>
  Match.value(type).pipe(
    Match.tag("TVar", (v) => {
      const resolved = HashMap.get(subst, v.id);
      if (Option.isNone(resolved)) return v;
      return apply(subst, resolved.value);
    }),
    Match.tag("TCon", (c) => c),
    Match.tag("TArrow", (a) =>
      new TArrow({ param: apply(subst, a.param), result: apply(subst, a.result) }),
    ),
    Match.tag("TApp", (app) =>
      new TApp({ ctor: apply(subst, app.ctor), arg: apply(subst, app.arg) }),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Occurs check — does varId appear free in type?
// ---------------------------------------------------------------------------

const occursIn = (varId: number, type: InferType, subst: Substitution): boolean =>
  Match.value(type).pipe(
    Match.tag("TVar", (v) => {
      if (v.id === varId) return true;
      const resolved = HashMap.get(subst, v.id);
      return Option.isSome(resolved) ? occursIn(varId, resolved.value, subst) : false;
    }),
    Match.tag("TCon", () => false),
    Match.tag("TArrow", (a) =>
      occursIn(varId, a.param, subst) || occursIn(varId, a.result, subst),
    ),
    Match.tag("TApp", (app) =>
      occursIn(varId, app.ctor, subst) || occursIn(varId, app.arg, subst),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Unify two types, extending the substitution
// ---------------------------------------------------------------------------

export const unify = (
  t1: InferType,
  t2: InferType,
  subst: Substitution,
  span: Span,
): Effect.Effect<Substitution, TypeError> => {
  const a = apply(subst, t1);
  const b = apply(subst, t2);

  // Same TVar
  if (a._tag === "TVar" && b._tag === "TVar" && a.id === b.id) {
    return Effect.succeed(subst);
  }

  // TVar on left — bind
  if (a._tag === "TVar") {
    if (occursIn(a.id, b, subst)) {
      return Effect.fail(new OccursCheck({ varId: a.id, type: b, span }));
    }
    return Effect.succeed(HashMap.set(subst, a.id, b));
  }

  // TVar on right — bind
  if (b._tag === "TVar") {
    if (occursIn(b.id, a, subst)) {
      return Effect.fail(new OccursCheck({ varId: b.id, type: a, span }));
    }
    return Effect.succeed(HashMap.set(subst, b.id, a));
  }

  // Same TCon
  if (a._tag === "TCon" && b._tag === "TCon" && a.name === b.name) {
    return Effect.succeed(subst);
  }

  // TArrow
  if (a._tag === "TArrow" && b._tag === "TArrow") {
    return Effect.gen(function* () {
      const s1 = yield* unify(a.param, b.param, subst, span);
      return yield* unify(a.result, b.result, s1, span);
    });
  }

  // TApp
  if (a._tag === "TApp" && b._tag === "TApp") {
    return Effect.gen(function* () {
      const s1 = yield* unify(a.ctor, b.ctor, subst, span);
      return yield* unify(a.arg, b.arg, s1, span);
    });
  }

  // Mismatch
  return Effect.fail(new UnificationError({ expected: a, actual: b, span }));
};

// Prevent unused import warnings for named imports used only as types
export { TApp, TArrow, TCon, TVar };
