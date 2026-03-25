import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/core";

describe("Operators", () => {
  it.effect("compiles arithmetic", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = 1 + 2 * 3");
      expect(result.code).toContain("const x = 1 + 2 * 3");
    }),
  );

  it.effect("compiles comparison", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = 1 == 2");
      expect(result.code).toContain("const x = 1 === 2");
    }),
  );

  it.effect("compiles logical operators", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = true and false");
      expect(result.code).toContain("const x = true && false");
    }),
  );

  it.effect("compiles unary minus", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = -42");
      expect(result.code).toContain("const x = -42");
    }),
  );

  it.effect("compiles not", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = not true");
      expect(result.code).toContain("const x = !true");
    }),
  );

  it.effect("string concat", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile('x = "hello" ++ " world"');
      expect(result.code).toContain('const x = "hello" + " world"');
    }),
  );

  it.effect("respects precedence: multiply before add", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = 2 + 3 * 4");
      expect(result.code).toContain("const x = 2 + 3 * 4");
    }),
  );

  it.effect("grouped expression forces precedence", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = (1 + 2) * 3");
      expect(result.code).toContain("const x = (1 + 2) * 3");
    }),
  );

  it.effect("does not break existing declare + force + application", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello"
!console.log greeting`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("const greeting");
      expect(result.code).toContain("yield* console_log(greeting)");
    }),
  );
});
