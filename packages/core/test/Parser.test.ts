import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser } from "@bang/core";

const parse = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    return yield* Parser.parse(tokens);
  });

describe("Parser", () => {
  it.effect("parses a simple binding", () =>
    Effect.gen(function* () {
      const ast = yield* parse('greeting = "hello"');
      expect(ast._tag).toBe("Program");
      expect(ast.statements.length).toBe(1);
      expect(ast.statements[0]._tag).toBe("Declaration");
    }),
  );

  it.effect("parses a declare statement", () =>
    Effect.gen(function* () {
      const ast = yield* parse("declare console.log : String -> Effect Unit { stdout } {}");
      expect(ast.statements.length).toBe(1);
      expect(ast.statements[0]._tag).toBe("Declare");
    }),
  );

  it.effect("parses a force statement", () =>
    Effect.gen(function* () {
      const ast = yield* parse("!console.log greeting");
      expect(ast.statements.length).toBe(1);
      expect(ast.statements[0]._tag).toBe("ForceStatement");
      const force = ast.statements[0] as any;
      expect(force.expr._tag).toBe("Force");
    }),
  );

  it.effect("parses function application", () =>
    Effect.gen(function* () {
      const ast = yield* parse("!console.log greeting");
      const force = (ast.statements[0] as any).expr;
      // Force wraps App(DotAccess(console, log), [greeting])
      const inner = force.expr;
      expect(inner._tag).toBe("App");
    }),
  );

  it.effect("parses the full v0.1 target program", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const ast = yield* parse(source);
      expect(ast.statements.length).toBe(3);
      expect(ast.statements[0]._tag).toBe("Declare");
      expect(ast.statements[1]._tag).toBe("Declaration");
      expect(ast.statements[2]._tag).toBe("ForceStatement");
    }),
  );

  it.effect("reports error for unexpected token", () =>
    Effect.gen(function* () {
      const result = yield* parse("= = =").pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );
});
