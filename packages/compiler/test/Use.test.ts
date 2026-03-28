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

describe("use", () => {
  it.effect("parses use expression", () =>
    Effect.gen(function* () {
      const ast = yield* parse("x = { !use conn = withDb; conn }");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl._tag).toBe("Declaration");
      expect(decl.value._tag).toBe("Block");
      const block = decl.value as Ast.Block;
      expect(block.statements.length).toBe(1);
      const forceStmt = block.statements[0] as Ast.ForceStatement;
      expect(forceStmt._tag).toBe("ForceStatement");
      expect(forceStmt.expr._tag).toBe("Force");
      const force = forceStmt.expr as Ast.Force;
      expect(force.expr._tag).toBe("UseExpr");
      const useExpr = force.expr as Ast.UseExpr;
      expect(useExpr.name).toBe("conn");
      expect(useExpr.value._tag).toBe("Ident");
    }),
  );

  it.effect("interprets use as binding", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("result = { !use x = 42; x }");
      expect(result).toEqual(Value.Num({ value: 42 }));
    }),
  );

  it.effect("formats use expression", () =>
    Effect.gen(function* () {
      const formatted = yield* Formatter.formatSource("x = { !use conn = withDb; conn }");
      expect(formatted).toContain("use conn = withDb");
    }),
  );

  it.effect("compiles use expression as binding", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("x = { !use conn = 42; conn }");
      expect(result.code).toContain("const conn = yield*");
    }),
  );

  it.effect("use binds value in subsequent expression", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("result = { !use a = 10; !use b = 20; a + b }");
      expect(result).toEqual(Value.Num({ value: 30 }));
    }),
  );
});
