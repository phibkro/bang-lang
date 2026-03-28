import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Formatter, Interpreter, Lexer, Parser, Value } from "@bang/core";
import { Compiler } from "@bang/compiler";
import type * as Ast from "@bang/core/Ast";

const parse = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    return yield* Parser.parse(tokens);
  });

const evalSource = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return yield* Interpreter.evalProgram(ast);
  });

describe("comptime", () => {
  it.effect("parses comptime expression", () =>
    Effect.gen(function* () {
      const ast = yield* parse("x = comptime { 1 + 2 }");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl._tag).toBe("Declaration");
      expect(decl.value._tag).toBe("ComptimeExpr");
      const comptime = decl.value as Ast.ComptimeExpr;
      expect(comptime.expr._tag).toBe("Block");
    }),
  );

  it.effect("interpreter evaluates comptime as passthrough", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("result = comptime { 1 + 2 + 3 }");
      expect(result).toEqual(Value.Num({ value: 6 }));
    }),
  );

  it.effect("comptime in binding", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("result = comptime { 42 }");
      expect(result).toEqual(Value.Num({ value: 42 }));
    }),
  );

  it.effect("formats comptime", () =>
    Effect.gen(function* () {
      const formatted = yield* Formatter.formatSource("x = comptime { 1 + 2 }");
      expect(formatted).toContain("comptime");
    }),
  );

  it.effect("comptime evaluates at compile time", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = comptime { 1 + 2 + 3 }");
      expect(result.code).toContain("6");
      expect(result.code).not.toContain("1 + 2");
    }),
  );

  it.effect("comptime with simple literal compiles to value", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = comptime { 42 }");
      expect(result.code).toContain("42");
    }),
  );

  it.effect("comptime with simple literal", () =>
    Effect.gen(function* () {
      const result = yield* evalSource('result = comptime "hello"');
      expect(result).toEqual(Value.Str({ value: "hello" }));
    }),
  );

  it.effect("roundtrip: format preserves comptime semantics", () =>
    Effect.gen(function* () {
      const source = "result = comptime { 1 + 2 * 3 }";
      const formatted = yield* Formatter.formatSource(source);
      const original = yield* evalSource(source);
      const roundtripped = yield* evalSource(formatted);
      expect(roundtripped).toEqual(original);
    }),
  );
});
