import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { Formatter, Interpreter, Lexer, Parser, Value } from "@bang/core";
import { Checker, Compiler } from "@bang/compiler";
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

const compileSource = (source: string) =>
  Effect.gen(function* () {
    const result = yield* Compiler.compile(source);
    return result.code;
  });

describe("On — Push Subscriptions", () => {
  // -------------------------------------------------------------------------
  // Parser
  // -------------------------------------------------------------------------

  it.effect("parses on expression", () =>
    Effect.gen(function* () {
      const ast = yield* parse("y = { mut count = 0; on count v -> { v } }");
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl.value._tag).toBe("Block");
      if (decl.value._tag === "Block") {
        const exprResult = decl.value.expr;
        expect(exprResult._tag).toBe("OnExpr");
        if (exprResult._tag === "OnExpr") {
          expect(exprResult.source._tag).toBe("Ident");
          if (exprResult.source._tag === "Ident") {
            expect(exprResult.source.name).toBe("count");
          }
          expect(exprResult.handler._tag).toBe("Lambda");
        }
      }
    }),
  );

  // -------------------------------------------------------------------------
  // Interpreter
  // -------------------------------------------------------------------------

  it.effect("interprets on — subscriber fires on mutation", () =>
    Effect.gen(function* () {
      const result = yield* evalSource(
        "result = { mut x = 0; mut y = 0; !on x v -> { !y <- v; () }; !x <- 5; y }",
      );
      expect(Value.toJS(result)).toBe(5);
    }),
  );

  it.effect("multiple subscribers fire on mutation", () =>
    Effect.gen(function* () {
      const result = yield* evalSource(
        `result = {
          mut x = 0;
          mut a = 0;
          mut b = 0;
          !on x v -> { !a <- v; () };
          !on x v -> { !b <- v; () };
          !x <- 10;
          a + b
        }`,
      );
      expect(Value.toJS(result)).toBe(20);
    }),
  );

  it.effect("on returns subscription, abort stops handler", () =>
    Effect.gen(function* () {
      const result = yield* evalSource(
        `result = {
          mut x = 0;
          mut y = 0;
          sub = !on x v -> { !y <- v; () };
          !x <- 10;
          !sub.abort;
          !x <- 20;
          y
        }`,
      );
      expect(Value.toJS(result)).toBe(10);
    }),
  );

  // -------------------------------------------------------------------------
  // Checker
  // -------------------------------------------------------------------------

  it.effect("checker accepts valid on expression", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.gen(function* () {
          const tokens = yield* Lexer.tokenize(
            "y = { mut x = 0; mut z = 0; !on x v -> { !z <- v; () }; x }",
          );
          const ast = yield* Parser.parse(tokens);
          return yield* Checker.check(ast);
        }),
      );
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect("checker detects direct cycle: on a -> mutate a", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.gen(function* () {
          const tokens = yield* Lexer.tokenize("y = { mut a = 0; !on a v -> { !a <- v; () }; a }");
          const ast = yield* Parser.parse(tokens);
          return yield* Checker.check(ast);
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toContain("cycle");
      }
    }),
  );

  // -------------------------------------------------------------------------
  // Formatter
  // -------------------------------------------------------------------------

  it.effect("formats on expression", () =>
    Effect.gen(function* () {
      const formatted = yield* Formatter.formatSource("y = { mut x = 0; on x v -> { v } }");
      expect(formatted).toContain("on x");
    }),
  );

  // -------------------------------------------------------------------------
  // Codegen
  // -------------------------------------------------------------------------

  it.effect("compiles on expression to subscribeToRef", () =>
    Effect.gen(function* () {
      const code = yield* compileSource(
        "y = { mut x = 0; mut z = 0; !on x v -> { !z <- v; () }; x }",
      );
      expect(code).toContain("subscribeToRef");
    }),
  );
});
