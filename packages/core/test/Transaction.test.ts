import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Interpreter, Lexer, Parser } from "@bang/core";
import * as Value from "@bang/core/Value";

const run = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const program = yield* Parser.parse(tokens);
    return yield* Interpreter.evalProgram(program);
  });

describe("transaction — Slice A", () => {
  it.effect("evaluates the block body to its return value", () =>
    Effect.gen(function* () {
      const result = yield* run("result = !transaction { 42 }");
      expect(Value.toJS(result)).toBe(42);
    }),
  );

  it.effect("commits a write made inside the transaction (visible after)", () =>
    Effect.gen(function* () {
      const result = yield* run("result = { mut x = 0; !transaction { !x <- 5; () }; x }");
      expect(Value.toJS(result)).toBe(5);
    }),
  );
});
