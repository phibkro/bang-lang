import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/core";

describe("Compiler", () => {
  it.effect("compiles the v0.1 target program end-to-end", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain('import { Effect } from "effect"');
      expect(result.code).toContain("const greeting");
      expect(result.code).toContain("Effect.runPromise");
    }),
  );

  it.effect("compile returns errors for invalid source", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("= = =").pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("exposes individual phases", () =>
    Effect.gen(function* () {
      const tokens = yield* Compiler.lex("x = 42");
      expect(tokens.length).toBeGreaterThan(0);

      const ast = yield* Compiler.parse(tokens);
      expect(ast._tag).toBe("Program");
    }),
  );
});
