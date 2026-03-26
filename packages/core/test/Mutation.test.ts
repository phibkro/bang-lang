import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { Checker, Compiler, Formatter, Interpreter, Lexer, Parser, Value } from "@bang/core";
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

describe("Mutation", () => {
  // -------------------------------------------------------------------------
  // Parser
  // -------------------------------------------------------------------------

  it.effect("parses mut declaration", () =>
    Effect.gen(function* () {
      const ast = yield* parse("mut x = 0");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl._tag).toBe("Declaration");
      expect(decl.name).toBe("x");
      expect(decl.mutable).toBe(true);
      expect(decl.value._tag).toBe("IntLiteral");
    }),
  );

  it.effect("parses mutation statement in block", () =>
    Effect.gen(function* () {
      const ast = yield* parse("y = { mut x = 0; x <- 1; x }");
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl.value._tag).toBe("Block");
      if (decl.value._tag === "Block") {
        expect(decl.value.statements.length).toBe(2);
        expect(decl.value.statements[0]._tag).toBe("Declaration");
        const mutation = decl.value.statements[1] as Ast.Mutation;
        expect(mutation._tag).toBe("Mutation");
        expect(mutation.target).toBe("x");
        expect(mutation.value._tag).toBe("IntLiteral");
      }
    }),
  );

  it.effect("parses mut declaration in block", () =>
    Effect.gen(function* () {
      const ast = yield* parse("y = { mut x = 0; x <- 5; x }");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl.value._tag).toBe("Block");
      if (decl.value._tag === "Block") {
        expect(decl.value.statements.length).toBe(2);
        expect(decl.value.statements[0]._tag).toBe("Declaration");
        expect((decl.value.statements[0] as Ast.Declaration).mutable).toBe(true);
        expect(decl.value.statements[1]._tag).toBe("Mutation");
      }
    }),
  );

  // -------------------------------------------------------------------------
  // Interpreter
  // -------------------------------------------------------------------------

  it.effect("interprets mut + read", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("y = { mut x = 42; x }");
      expect(Value.toJS(result)).toBe(42);
    }),
  );

  it.effect("interprets mutation", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("y = { mut x = 0; x <- 5; x }");
      expect(Value.toJS(result)).toBe(5);
    }),
  );

  it.effect("interprets mutation in block", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("y = { mut x = 0; x <- 5; x }");
      expect(Value.toJS(result)).toBe(5);
    }),
  );

  it.effect("fails on mutation of non-mut binding", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(evalSource("y = { x = 0; x <- 5; x }"));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toContain("non-mutable");
      }
    }),
  );

  it.effect("fails on mutation of undeclared variable", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(evalSource("y = { x <- 5; x }"));
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  // -------------------------------------------------------------------------
  // Checker
  // -------------------------------------------------------------------------

  it.effect("checker validates mutation target exists", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.gen(function* () {
          const tokens = yield* Lexer.tokenize("y = { z <- 5; z }");
          const ast = yield* Parser.parse(tokens);
          return yield* Checker.check(ast);
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("checker validates mutation target is mutable", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.gen(function* () {
          const tokens = yield* Lexer.tokenize("y = { x = 0; x <- 5; x }");
          const ast = yield* Parser.parse(tokens);
          return yield* Checker.check(ast);
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("checker accepts valid mutation", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.gen(function* () {
          const tokens = yield* Lexer.tokenize("y = { mut x = 0; x <- 5; x }");
          const ast = yield* Parser.parse(tokens);
          return yield* Checker.check(ast);
        }),
      );
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  // -------------------------------------------------------------------------
  // Codegen
  // -------------------------------------------------------------------------

  it.effect("compiles mut declaration to Ref.make", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("y = { mut x = 0; x }");
      expect(code).toContain("Ref.make");
    }),
  );

  it.effect("compiles mutation to Ref.set", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("y = { mut x = 0; x <- 5; x }");
      expect(code).toContain("Ref.set");
    }),
  );

  it.effect("compiles mut read to Ref.get", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("y = { mut x = 0; x }");
      expect(code).toContain("Ref.get");
    }),
  );

  // -------------------------------------------------------------------------
  // Formatter
  // -------------------------------------------------------------------------

  it.effect("formats mut declaration", () =>
    Effect.gen(function* () {
      const formatted = yield* Formatter.formatSource("mut x = 0");
      expect(formatted).toContain("mut x = 0");
    }),
  );

  it.effect("formats mutation statement in block", () =>
    Effect.gen(function* () {
      const formatted = yield* Formatter.formatSource("y = { mut x = 0; x <- 1; x }");
      expect(formatted).toContain("x <- 1");
    }),
  );
});
