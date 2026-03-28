import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/compiler";

describe("Lambdas", () => {
  it.effect("compiles single-expr lambda as plain function", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("double = x -> { x * 2 }");
      expect(result.code).toContain("const double = (x) => x * 2");
      expect(result.code).not.toContain("Effect.gen");
    }),
  );

  it.effect("compiles multi-param lambda as curried", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("add = a b -> { a + b }");
      expect(result.code).toContain("const add = (a) => (b) => a + b");
    }),
  );

  it.effect("compiles lambda with statements using Effect.gen", () =>
    Effect.gen(function* () {
      const source = "process = x -> { y = x * 2; y + 1 }";
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.gen(function*()");
      expect(result.code).toContain("const y = x * 2");
    }),
  );

  it.effect("partial application", () =>
    Effect.gen(function* () {
      const source = `add = a b -> { a + b }
addThree = add 3`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("const addThree = add(3)");
    }),
  );

  it.effect("full application of curried function", () =>
    Effect.gen(function* () {
      const source = `add = a b -> { a + b }
result = add 3 4`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("const result = add(3)(4)");
    }),
  );
});
