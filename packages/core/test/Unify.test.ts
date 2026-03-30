import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, HashMap, Option } from "effect";
import * as T from "../src/InferType.js";
import * as U from "../src/Unify.js";
import { Span } from "../src/Span.js";

const s = new Span({ start: 0, end: 0 });

describe("Unify", () => {
  describe("apply", () => {
    it("resolves TVar through substitution", () => {
      const subst = HashMap.make([0, T.tInt] as const);
      expect(U.apply(subst, new T.TVar({ id: 0 }))).toEqual(T.tInt);
    });

    it("leaves unbound TVar unchanged", () => {
      const v = new T.TVar({ id: 99 });
      expect(U.apply(HashMap.empty(), v)).toEqual(v);
    });

    it("applies recursively through TArrow", () => {
      const subst = HashMap.make([0, T.tInt] as const, [1, T.tString] as const);
      const t = new T.TArrow({
        param: new T.TVar({ id: 0 }),
        result: new T.TVar({ id: 1 }),
      });
      expect(U.apply(subst, t)).toEqual(
        new T.TArrow({ param: T.tInt, result: T.tString }),
      );
    });

    it("chases variable chains", () => {
      // ?0 → ?1, ?1 → Int => ?0 resolves to Int
      const subst = HashMap.make([0, new T.TVar({ id: 1 })] as const, [1, T.tInt] as const);
      expect(U.apply(subst, new T.TVar({ id: 0 }))).toEqual(T.tInt);
    });
  });

  describe("unify", () => {
    it.effect("unifies identical TCon", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(T.tInt, T.tInt, HashMap.empty(), s);
        expect(HashMap.size(result)).toBe(0);
      }),
    );

    it.effect("fails on different TCon", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(T.tInt, T.tString, HashMap.empty(), s).pipe(
          Effect.either,
        );
        expect(Either.isLeft(result)).toBe(true);
      }),
    );

    it.effect("unifies TVar with TCon", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TVar({ id: 0 }),
          T.tInt,
          HashMap.empty(),
          s,
        );
        expect(Option.getOrUndefined(HashMap.get(result, 0))).toEqual(T.tInt);
      }),
    );

    it.effect("unifies TCon with TVar (symmetric)", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          T.tInt,
          new T.TVar({ id: 0 }),
          HashMap.empty(),
          s,
        );
        expect(Option.getOrUndefined(HashMap.get(result, 0))).toEqual(T.tInt);
      }),
    );

    it.effect("unifies TArrow components", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TArrow({ param: new T.TVar({ id: 0 }), result: new T.TVar({ id: 1 }) }),
          new T.TArrow({ param: T.tInt, result: T.tString }),
          HashMap.empty(),
          s,
        );
        expect(U.apply(result, new T.TVar({ id: 0 }))).toEqual(T.tInt);
        expect(U.apply(result, new T.TVar({ id: 1 }))).toEqual(T.tString);
      }),
    );

    it.effect("unifies TApp components", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TApp({ ctor: new T.TCon({ name: "Maybe" }), arg: new T.TVar({ id: 0 }) }),
          new T.TApp({ ctor: new T.TCon({ name: "Maybe" }), arg: T.tInt }),
          HashMap.empty(),
          s,
        );
        expect(U.apply(result, new T.TVar({ id: 0 }))).toEqual(T.tInt);
      }),
    );

    it.effect("occurs check prevents infinite type", () =>
      Effect.gen(function* () {
        const result = yield* U.unify(
          new T.TVar({ id: 0 }),
          new T.TArrow({ param: new T.TVar({ id: 0 }), result: T.tInt }),
          HashMap.empty(),
          s,
        ).pipe(Effect.either);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );

    it.effect("transitive unification", () =>
      Effect.gen(function* () {
        // ?0 = ?1, then ?1 = Int => ?0 = Int
        const s1 = yield* U.unify(
          new T.TVar({ id: 0 }),
          new T.TVar({ id: 1 }),
          HashMap.empty(),
          s,
        );
        const s2 = yield* U.unify(new T.TVar({ id: 1 }), T.tInt, s1, s);
        expect(U.apply(s2, new T.TVar({ id: 0 }))).toEqual(T.tInt);
      }),
    );
  });
});
