import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Formatter } from "@bang/core";

const fmt = (source: string) => Formatter.formatSource(source);

describe("Formatter", () => {
  it.effect("formats integer literal", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = 42");
      expect(result.trim()).toBe("result = 42");
    }),
  );

  it.effect("normalizes binary expression spacing", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = 1+2");
      expect(result.trim()).toBe("result = 1 + 2");
    }),
  );

  it.effect("formats string literal", () =>
    Effect.gen(function* () {
      const result = yield* fmt('result = "hello"');
      expect(result.trim()).toBe('result = "hello"');
    }),
  );

  it.effect("formats unary minus", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = -42");
      expect(result.trim()).toBe("result = -42");
    }),
  );

  it.effect("formats not operator", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = not true");
      expect(result.trim()).toBe("result = not true");
    }),
  );

  it.effect("formats boolean literal", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = true");
      expect(result.trim()).toBe("result = true");
    }),
  );

  it.effect("formats float literal", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = 3.14");
      expect(result.trim()).toBe("result = 3.14");
    }),
  );

  it.effect("formats declare statement", () =>
    Effect.gen(function* () {
      const result = yield* fmt("declare console.log : String -> Effect Unit { stdout } {}");
      expect(result.trim()).toContain("declare console.log : String -> Effect Unit");
    }),
  );

  it.effect("parenthesizes lower-precedence sub-expressions", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = (1 + 2) * 3");
      expect(result.trim()).toBe("result = (1 + 2) * 3");
    }),
  );

  it.effect("does not add unnecessary parentheses for equal precedence", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = 1 + 2 + 3");
      expect(result.trim()).toBe("result = 1 + 2 + 3");
    }),
  );

  it.effect("formats multiple statements with double newlines", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}\n\ngreeting = "hello"`;
      const result = yield* fmt(source);
      // Two statements separated by a blank line
      expect(result).toContain("declare console.log");
      expect(result).toContain('greeting = "hello"');
      expect(result).toMatch(/console\.log.*\n\n.*greeting/);
    }),
  );

  it.effect("formats force expression at statement level", () =>
    Effect.gen(function* () {
      const result = yield* fmt("!foo");
      expect(result.trim()).toBe("!foo");
    }),
  );
});
