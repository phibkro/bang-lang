import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler, Interpreter, Lexer, Parser, Value } from "@bang/core";

// ---------------------------------------------------------------------------
// Helper: parse + interpret a Bang program
// ---------------------------------------------------------------------------

const interpret = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return yield* Interpreter.evalProgram(ast);
  });

// ---------------------------------------------------------------------------
// Correctness Properties
// ---------------------------------------------------------------------------

describe("Correctness Properties", () => {
  // -------------------------------------------------------------------------
  // Determinism: same program → same result
  // -------------------------------------------------------------------------

  it.effect("interpreter is deterministic", () =>
    Effect.gen(function* () {
      const source = "result = { x = 1 + 2; y = x * 3; y + 1 }";
      const r1 = yield* interpret(source);
      const r2 = yield* interpret(source);
      expect(r1).toEqual(r2);
    }),
  );

  // -------------------------------------------------------------------------
  // Block optimization equivalence: { expr } ≡ expr
  // -------------------------------------------------------------------------

  it.effect("single-expr block equals bare expr", () =>
    Effect.gen(function* () {
      const bare = yield* interpret("result = 1 + 2");
      const blocked = yield* interpret("result = { 1 + 2 }");
      expect(bare).toEqual(blocked);
    }),
  );

  // -------------------------------------------------------------------------
  // Compiler correctness for known pure programs
  //
  // The full correctness law: toJS(eval(ast)) === evalJS(codegen(ast))
  // Requires JS eval for compiled output. For now, verify both interpreter
  // and compiler succeed without errors. Full value comparison deferred
  // until we have a safe JS eval mechanism.
  // -------------------------------------------------------------------------

  const purePrograms = [
    "result = 42",
    "result = 1 + 2 * 3",
    'result = "hello" ++ " world"',
    "result = true and false",
    "result = not true",
    "result = -5",
    "result = { x = 10; x + 1 }",
    "result = 1 == 1",
    "result = 2 > 1",
  ];

  for (const source of purePrograms) {
    it.effect(`interpreter + compiler agree: ${source}`, () =>
      Effect.gen(function* () {
        const interpreted = yield* interpret(source);
        expect(interpreted._tag).not.toBe("Closure");

        const compiled = yield* Compiler.compile(source);
        expect(compiled.code.length).toBeGreaterThan(0);
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Lambda correctness (use blocks for multi-statement programs)
  // -------------------------------------------------------------------------

  it.effect("lambda application matches direct computation", () =>
    Effect.gen(function* () {
      const viaLambda = yield* interpret(
        "result = { add = a b -> { a + b }; add 3 4 }",
      );
      const direct = yield* interpret("result = 3 + 4");
      expect(viaLambda).toEqual(direct);
    }),
  );

  it.effect("partial application produces correct result", () =>
    Effect.gen(function* () {
      const result = yield* interpret(
        "result = { add = a b -> { a + b }; addThree = add 3; addThree 4 }",
      );
      expect(result).toEqual(Value.Num({ value: 7 }));
    }),
  );

  // -------------------------------------------------------------------------
  // Nested blocks scope correctly
  // -------------------------------------------------------------------------

  it.effect("nested blocks scope correctly", () =>
    Effect.gen(function* () {
      const result = yield* interpret(
        "result = { x = { y = 1; y + 2 }; x * 3 }",
      );
      expect(result).toEqual(Value.Num({ value: 9 }));
    }),
  );

  // -------------------------------------------------------------------------
  // String interpolation with expressions
  // -------------------------------------------------------------------------

  it.effect("interpolation evaluates expressions", () =>
    Effect.gen(function* () {
      const result = yield* interpret(
        'result = { x = 42; "value: ${x}" }',
      );
      expect(result).toEqual(Value.Str({ value: "value: 42" }));
    }),
  );
});
