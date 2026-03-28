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

const compileSource = (source: string) =>
  Effect.gen(function* () {
    const result = yield* Compiler.compile(source);
    return result.code;
  });

describe("NewtypeDecl", () => {
  it.effect("parses newtype: type UserId = String", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type UserId = String");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.NewtypeDecl;
      expect(decl._tag).toBe("NewtypeDecl");
      expect(decl.name).toBe("UserId");
      expect(decl.wrappedType._tag).toBe("ConcreteType");
      expect((decl.wrappedType as Ast.ConcreteType).name).toBe("String");
    }),
  );

  it.effect('interprets newtype construction: UserId "abc"', () =>
    Effect.gen(function* () {
      const result = yield* evalSource('type UserId = String\nx = UserId "abc"');
      expect(result._tag).toBe("Tagged");
      expect((result as { tag: string }).tag).toBe("UserId");
      expect((result as { fields: readonly unknown[] }).fields).toEqual([
        Value.Str({ value: "abc" }),
      ]);
    }),
  );

  it.effect("interprets newtype unwrap", () =>
    Effect.gen(function* () {
      const result = yield* evalSource('type UserId = String\nx = (UserId "abc").unwrap');
      expect(result._tag).toBe("Str");
      expect((result as { value: string }).value).toBe("abc");
    }),
  );

  it.effect("codegen: emits Data.tagged for newtype", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("type UserId = String");
      expect(code).toContain("Data.tagged");
      expect(code).toContain('import { Data } from "effect"');
    }),
  );

  it.effect("formats newtype: type UserId = String", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type UserId = String");
      const formatted = Formatter.format(ast);
      expect(formatted).toBe("type UserId = String");
    }),
  );

  it.effect("distinguishes newtype from ADT", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type Bool = True | False\ntype UserId = String");
      expect(ast.statements.length).toBe(2);
      expect(ast.statements[0]._tag).toBe("TypeDecl");
      expect(ast.statements[1]._tag).toBe("NewtypeDecl");
    }),
  );
});
