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

  it.effect("formats single-expr block", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = { 1 + 2 }");
      expect(result.trim()).toBe("result = { 1 + 2 }");
    }),
  );

  it.effect("formats block with statements", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = { x = 1; y = 2; x + y }");
      expect(result.trim()).toBe("result = { x = 1; y = 2; x + y }");
    }),
  );

  it.effect("formats lambda", () =>
    Effect.gen(function* () {
      const result = yield* fmt("double = x -> { x * 2 }");
      expect(result.trim()).toBe("double = x -> { x * 2 }");
    }),
  );

  it.effect("formats multi-param lambda", () =>
    Effect.gen(function* () {
      const result = yield* fmt("add = a b -> { a + b }");
      expect(result.trim()).toBe("add = a b -> { a + b }");
    }),
  );

  it.effect("formats application", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = add 3 4");
      expect(result.trim()).toBe("result = add 3 4");
    }),
  );

  it.effect("parenthesizes non-atom arguments", () =>
    Effect.gen(function* () {
      const result = yield* fmt("result = add (1 + 2) 3");
      expect(result.trim()).toBe("result = add (1 + 2) 3");
    }),
  );

  it.effect("formats string interpolation", () =>
    Effect.gen(function* () {
      const result = yield* fmt('result = "hello ${name}"');
      expect(result.trim()).toBe('result = "hello ${name}"');
    }),
  );

  it.effect("formatting is idempotent", () =>
    Effect.gen(function* () {
      const source = "result = { x = 1 + 2 * 3; y = x; y }";
      const once = yield* Formatter.formatSource(source);
      const twice = yield* Formatter.formatSource(once);
      expect(twice).toBe(once);
    }),
  );
});
