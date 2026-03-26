import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { Checker, Compiler, Formatter, Lexer, Parser } from "@bang/core";
import type * as Ast from "@bang/core/Ast";

const parse = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    return yield* Parser.parse(tokens);
  });

const compileSource = (source: string) =>
  Effect.gen(function* () {
    const result = yield* Compiler.compile(source);
    return result.code;
  });

const checkSource = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return yield* Checker.check(ast);
  });

describe("Import/Export", () => {
  // ---------------------------------------------------------------------------
  // Parser — Import
  // ---------------------------------------------------------------------------

  it.effect("parses import statement", () =>
    Effect.gen(function* () {
      const ast = yield* parse('from STD import { log, error }');
      expect(ast.statements.length).toBe(1);
      const imp = ast.statements[0] as Ast.Import;
      expect(imp._tag).toBe("Import");
      expect(imp.modulePath).toEqual(["STD"]);
      expect(imp.names).toEqual(["log", "error"]);
    }),
  );

  it.effect("parses dotted module path", () =>
    Effect.gen(function* () {
      const ast = yield* parse('from STD.IO.Console import { log }');
      expect(ast.statements.length).toBe(1);
      const imp = ast.statements[0] as Ast.Import;
      expect(imp._tag).toBe("Import");
      expect(imp.modulePath).toEqual(["STD", "IO", "Console"]);
      expect(imp.names).toEqual(["log"]);
    }),
  );

  it.effect("parses single import name", () =>
    Effect.gen(function* () {
      const ast = yield* parse('from IO import { read }');
      const imp = ast.statements[0] as Ast.Import;
      expect(imp.modulePath).toEqual(["IO"]);
      expect(imp.names).toEqual(["read"]);
    }),
  );

  // ---------------------------------------------------------------------------
  // Parser — Export
  // ---------------------------------------------------------------------------

  it.effect("parses export statement", () =>
    Effect.gen(function* () {
      const ast = yield* parse('export { greet, add }');
      expect(ast.statements.length).toBe(1);
      const exp = ast.statements[0] as Ast.Export;
      expect(exp._tag).toBe("Export");
      expect(exp.names).toEqual(["greet", "add"]);
    }),
  );

  it.effect("parses single export name", () =>
    Effect.gen(function* () {
      const ast = yield* parse('export { x }');
      const exp = ast.statements[0] as Ast.Export;
      expect(exp.names).toEqual(["x"]);
    }),
  );

  // ---------------------------------------------------------------------------
  // Checker
  // ---------------------------------------------------------------------------

  it.effect("checker registers imported names in scope", () =>
    Effect.gen(function* () {
      // Using an imported name should not fail the checker
      const result = yield* Effect.either(
        checkSource("from STD import { log }\nx = log"),
      );
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect("checker validates exported names exist in scope", () =>
    Effect.gen(function* () {
      // Exporting an undeclared name should fail
      const result = yield* Effect.either(checkSource("export { unknown }"));
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("checker allows export of declared names", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        checkSource("x = 42\nexport { x }"),
      );
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  // ---------------------------------------------------------------------------
  // Codegen
  // ---------------------------------------------------------------------------

  it.effect("codegen import", () =>
    Effect.gen(function* () {
      const code = yield* compileSource('from STD import { log }');
      expect(code).toContain('import { log } from "./std"');
    }),
  );

  it.effect("codegen dotted import path", () =>
    Effect.gen(function* () {
      const code = yield* compileSource('from STD.IO.Console import { log }');
      expect(code).toContain('import { log } from "./std/io/console"');
    }),
  );

  it.effect("codegen export", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("x = 42\nexport { x }");
      expect(code).toContain("export { x }");
    }),
  );

  // ---------------------------------------------------------------------------
  // Formatter
  // ---------------------------------------------------------------------------

  it.effect("formats import", () =>
    Effect.gen(function* () {
      const ast = yield* parse('from STD.IO import { log, error }');
      const formatted = Formatter.format(ast);
      expect(formatted).toContain("from STD.IO import { log, error }");
    }),
  );

  it.effect("formats export", () =>
    Effect.gen(function* () {
      const ast = yield* parse('export { greet, add }');
      const formatted = Formatter.format(ast);
      expect(formatted).toContain("export { greet, add }");
    }),
  );
});
