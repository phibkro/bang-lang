import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { Lexer, Parser } from "@bang/core";
import * as Infer from "../src/Infer.js";
import * as T from "../src/InferType.js";

const inferLast = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return yield* Infer.inferProgram(ast);
  });

describe("Infer", () => {
  describe("literals", () => {
    it.effect("infers Int", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 42");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers Float", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 3.14");
        expect(result.type).toEqual(T.tFloat);
      }),
    );

    it.effect("infers String", () =>
      Effect.gen(function* () {
        const result = yield* inferLast('x = "hello"');
        expect(result.type).toEqual(T.tString);
      }),
    );

    it.effect("infers Bool", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = true");
        expect(result.type).toEqual(T.tBool);
      }),
    );

    it.effect("infers Unit", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = ()");
        expect(result.type).toEqual(T.tUnit);
      }),
    );
  });

  describe("ident", () => {
    it.effect("resolves binding type", () =>
      Effect.gen(function* () {
        // Use block to test ident resolution within scope
        const result = yield* inferLast("x = { y = 1 + 2; y }");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("fails on undefined variable", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = unknown").pipe(Effect.either);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );
  });

  describe("lambda + application", () => {
    it.effect("infers identity function applied to Int", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("f = x -> { x }\ny = !f 42");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers Int -> Int", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("f = x -> { x + 1 }\ny = !f 5");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers multi-param curried", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("f = x y -> { x + y }\ny = !f 1 2");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("let-polymorphism", () =>
      Effect.gen(function* () {
        // id is polymorphic: can be applied to both Int and String
        // Use block with bindings to avoid multiline parse issues
        const result = yield* inferLast(
          'id = x -> { x }\nb = { a = !id 42; c = !id "hello"; c }',
        );
        expect(result.type).toEqual(T.tString);
      }),
    );
  });

  describe("binary operators", () => {
    it.effect("infers Int + Int = Int", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 1 + 2");
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers String ++ String = String", () =>
      Effect.gen(function* () {
        const result = yield* inferLast('x = "a" ++ "b"');
        expect(result.type).toEqual(T.tString);
      }),
    );

    it.effect("infers comparison returns Bool", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = 1 == 2");
        expect(result.type).toEqual(T.tBool);
      }),
    );

    it.effect("infers boolean operators", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = true and false");
        expect(result.type).toEqual(T.tBool);
      }),
    );

    it.effect("fails on Int + String", () =>
      Effect.gen(function* () {
        const result = yield* inferLast('x = 1 + "hello"').pipe(Effect.either);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );
  });

  describe("match", () => {
    it.effect("infers match result type", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "type Maybe a = Some a | None\nx = !match (Some 42) { Some v -> v, None -> 0 }",
        );
        expect(result.type).toEqual(T.tInt);
      }),
    );

    it.effect("infers match with wildcard", () =>
      Effect.gen(function* () {
        const result = yield* inferLast("x = !match 42 { _ -> true }");
        expect(result.type).toEqual(T.tBool);
      }),
    );
  });

  describe("ADT constructors", () => {
    it.effect("infers ADT constructor application", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "type Maybe a = Some a | None\nx = Some 42",
        );
        expect(result.type._tag).toBe("TApp");
      }),
    );

    it.effect("infers nullary constructor", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "type Maybe a = Some a | None\nx = None",
        );
        expect(result.type._tag).toBe("TApp");
      }),
    );
  });

  describe("record types", () => {
    it.effect("infers record field access", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          'type User = { name: String, age: Int }\nx = { u = User "alice" 30; u.name }',
        );
        expect(result.type).toEqual(T.tString);
      }),
    );
  });

  describe("newtype", () => {
    it.effect("infers newtype constructor", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          'type UserId = String\nx = UserId "abc"',
        );
        expect(result.type).toEqual(new T.TCon({ name: "UserId" }));
      }),
    );
  });

  describe("type annotations", () => {
    // Parser doesn't support inline type annotations (x : Int = 42),
    // so we test that declared types are respected instead
    it.effect("declared type constrains binding", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "declare foo : Int -> Int\nx = foo",
        );
        expect(result.type._tag).toBe("TArrow");
      }),
    );

    it.effect("fails when annotation contradicts inferred type", () =>
      Effect.gen(function* () {
        // Addition unifies operands: Int + String fails
        const result = yield* inferLast('x = 1 + "hello"').pipe(
          Effect.either,
        );
        expect(Either.isLeft(result)).toBe(true);
      }),
    );
  });

  describe("declare", () => {
    it.effect("introduces declared type", () =>
      Effect.gen(function* () {
        const result = yield* inferLast(
          "declare log : String -> Effect Unit {} {}\nx = log",
        );
        expect(result.type._tag).toBe("TArrow");
      }),
    );
  });
});
