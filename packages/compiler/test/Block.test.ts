import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/compiler";

describe("Blocks", () => {
  it.effect("compiles a pure block as Effect.gen", () =>
    Effect.gen(function* () {
      const source = `result = { x = 1; y = 2; x + y }`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.gen(function*()");
      expect(result.code).toContain("const x = 1");
      expect(result.code).toContain("const y = 2");
      expect(result.code).toContain("return x + y");
    }),
  );

  it.effect("compiles single-expr block without Effect.gen", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("result = { 1 + 2 }");
      expect(result.code).toContain("const result = 1 + 2");
      expect(result.code).not.toContain("Effect.gen");
    }),
  );

  it.effect("effectful block with force", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}
declare fetch : String -> Effect String { net } {}
userData = !{ raw = !fetch "/api/user"; !console.log raw; raw }`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.gen(function*()");
      expect(result.code).toContain("yield*");
      expect(result.code).toContain("return raw");
    }),
  );
});
