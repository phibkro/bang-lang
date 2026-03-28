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

  it.effect("parses mutation as BinaryExpr <- in block via ForceStatement", () =>
    Effect.gen(function* () {
      const ast = yield* parse("y = { mut x = 0; !x <- 1; x }");
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl.value._tag).toBe("Block");
      if (decl.value._tag === "Block") {
        expect(decl.value.statements.length).toBe(2);
        expect(decl.value.statements[0]._tag).toBe("Declaration");
        const forceStmt = decl.value.statements[1] as Ast.ForceStatement;
        expect(forceStmt._tag).toBe("ForceStatement");
        // ForceStatement wraps Force(BinaryExpr("<-", Ident("x"), IntLiteral(1)))
        expect(forceStmt.expr._tag).toBe("Force");
        if (forceStmt.expr._tag === "Force") {
          const binExpr = forceStmt.expr.expr as Ast.BinaryExpr;
          expect(binExpr._tag).toBe("BinaryExpr");
          expect(binExpr.op).toBe("<-");
          expect(binExpr.left._tag).toBe("Ident");
          if (binExpr.left._tag === "Ident") {
            expect(binExpr.left.name).toBe("x");
          }
          expect(binExpr.right._tag).toBe("IntLiteral");
        }
      }
    }),
  );

  it.effect("parses mut declaration in block", () =>
    Effect.gen(function* () {
      const ast = yield* parse("y = { mut x = 0; !x <- 5; x }");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.Declaration;
      expect(decl.value._tag).toBe("Block");
      if (decl.value._tag === "Block") {
        expect(decl.value.statements.length).toBe(2);
        expect(decl.value.statements[0]._tag).toBe("Declaration");
        expect((decl.value.statements[0] as Ast.Declaration).mutable).toBe(true);
        expect(decl.value.statements[1]._tag).toBe("ForceStatement");
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
      const result = yield* evalSource("y = { mut x = 0; !x <- 5; x }");
      expect(Value.toJS(result)).toBe(5);
    }),
  );

  it.effect("interprets mutation in block", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("y = { mut x = 0; !x <- 5; x }");
      expect(Value.toJS(result)).toBe(5);
    }),
  );

  it.effect("fails on mutation of non-mut binding", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(evalSource("y = { x = 0; !x <- 5; x }"));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toContain("non-mutable");
      }
    }),
  );

  it.effect("fails on mutation of undeclared variable", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(evalSource("y = { !x <- 5; x }"));
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
          const tokens = yield* Lexer.tokenize("y = { !z <- 5; z }");
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
          const tokens = yield* Lexer.tokenize("y = { x = 0; !x <- 5; x }");
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
          const tokens = yield* Lexer.tokenize("y = { mut x = 0; !x <- 5; x }");
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
      const code = yield* compileSource("y = { mut x = 0; !x <- 5; x }");
      expect(code).toContain("Ref.set");
    }),
  );

  it.effect("compiles mut read to Ref.get", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("y = { mut x = 0; x }");
      expect(code).toContain("Ref.get");
    }),
  );

  it.effect("codegen hoists Ref.get for mut reads in expressions", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("y = { mut x = 0; !x <- x + 1; x }");
      // Should NOT contain "yield* Ref.get(x) + 1" inline (invalid JS in generators)
      // Should contain a hoisted read like "const _x = yield* Ref.get(x)"
      expect(code).not.toContain("Ref.get(x) +");
      expect(code).toContain("const _x = yield* Ref.get(x)");
      expect(code).toContain("Ref.set(x,");
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

  it.effect("formats mutation as BinaryExpr <- in block", () =>
    Effect.gen(function* () {
      const formatted = yield* Formatter.formatSource("y = { mut x = 0; !x <- 1; x }");
      expect(formatted).toContain("x <- 1");
    }),
  );
});
