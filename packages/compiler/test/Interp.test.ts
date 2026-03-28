import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/compiler";

describe("String Interpolation", () => {
  it.effect("compiles simple interpolation", () =>
    Effect.gen(function* () {
      const source = 'declare name : String\nx = "hello ${name}"';
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("`hello ${name}`");
    }),
  );

  it.effect("compiles escape sequences", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile('x = "line1\\nline2"');
      expect(result.code).toContain("line1\\nline2");
    }),
  );

  it.effect("plain string without interpolation stays as quotes", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile('x = "hello"');
      expect(result.code).toContain('"hello"');
      expect(result.code).not.toContain("`");
    }),
  );

  it.effect("compiles multiple interpolations in one string", () =>
    Effect.gen(function* () {
      const source = 'declare a : String\ndeclare b : String\nc = "${a} and ${b}"';
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("`${a} and ${b}`");
    }),
  );

  it.effect("compiles interpolation at start of string", () =>
    Effect.gen(function* () {
      const source = 'declare x : String\ny = "${x} world"';
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("`${x} world`");
    }),
  );

  it.effect("compiles interpolation at end of string", () =>
    Effect.gen(function* () {
      const source = 'declare x : String\ny = "hello ${x}"';
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("`hello ${x}`");
    }),
  );

  it.effect("validates interpolated expressions against scope", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile('x = "hello ${unknown}"').pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );
});
