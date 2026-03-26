import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler, Interpreter, Lexer, Parser, Value } from "@bang/core";
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

describe("TypeDecl", () => {
  it.effect("parses enum with nullary constructors: type Bool = True | False", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type Bool = True | False");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.TypeDecl;
      expect(decl._tag).toBe("TypeDecl");
      expect(decl.name).toBe("Bool");
      expect(decl.typeParams).toEqual([]);
      expect(decl.constructors.length).toBe(2);
      expect(decl.constructors[0]._tag).toBe("NullaryConstructor");
      expect((decl.constructors[0] as Ast.NullaryConstructor).tag).toBe("True");
      expect(decl.constructors[1]._tag).toBe("NullaryConstructor");
      expect((decl.constructors[1] as Ast.NullaryConstructor).tag).toBe("False");
    }),
  );

  it.effect("parses parameterized type: type Maybe a = Some a | None", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type Maybe a = Some a | None");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.TypeDecl;
      expect(decl._tag).toBe("TypeDecl");
      expect(decl.name).toBe("Maybe");
      expect(decl.typeParams).toEqual(["a"]);
      expect(decl.constructors.length).toBe(2);

      const some = decl.constructors[0] as Ast.PositionalConstructor;
      expect(some._tag).toBe("PositionalConstructor");
      expect(some.tag).toBe("Some");
      expect(some.fields.length).toBe(1);
      expect(some.fields[0]._tag).toBe("ConcreteType");
      expect((some.fields[0] as Ast.ConcreteType).name).toBe("a");

      const none = decl.constructors[1] as Ast.NullaryConstructor;
      expect(none._tag).toBe("NullaryConstructor");
      expect(none.tag).toBe("None");
    }),
  );

  it.effect("parses named fields: type Shape = Circle { radius: Float } | Point", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type Shape = Circle { radius: Float } | Point");
      expect(ast.statements.length).toBe(1);
      const decl = ast.statements[0] as Ast.TypeDecl;
      expect(decl._tag).toBe("TypeDecl");
      expect(decl.name).toBe("Shape");
      expect(decl.typeParams).toEqual([]);
      expect(decl.constructors.length).toBe(2);

      const circle = decl.constructors[0] as Ast.NamedConstructor;
      expect(circle._tag).toBe("NamedConstructor");
      expect(circle.tag).toBe("Circle");
      expect(circle.fields.length).toBe(1);
      expect(circle.fields[0].name).toBe("radius");
      expect(circle.fields[0].type._tag).toBe("ConcreteType");
      expect((circle.fields[0].type as Ast.ConcreteType).name).toBe("Float");

      const point = decl.constructors[1] as Ast.NullaryConstructor;
      expect(point._tag).toBe("NullaryConstructor");
      expect(point.tag).toBe("Point");
    }),
  );

  it.effect("does not greedily consume next statement identifier as constructor field", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type Bool = True | False\nx = True");
      expect(ast.statements.length).toBe(2);
      expect(ast.statements[0]._tag).toBe("TypeDecl");
      expect(ast.statements[1]._tag).toBe("Declaration");
      const decl = ast.statements[1] as Ast.Declaration;
      expect(decl.name).toBe("x");
    }),
  );

  // -----------------------------------------------------------------------
  // Interpreter tests
  // -----------------------------------------------------------------------

  it.effect("interpreter: nullary constructor produces Tagged value", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("type Bool = True | False\nx = True");
      expect(result._tag).toBe("Tagged");
      expect((result as { tag: string }).tag).toBe("True");
      expect((result as { fields: readonly unknown[] }).fields).toEqual([]);
    }),
  );

  it.effect("interpreter: positional constructor applies to produce Tagged", () =>
    Effect.gen(function* () {
      const result = yield* evalSource("type Maybe a = Some a | None\nx = Some 42");
      expect(result._tag).toBe("Tagged");
      expect((result as { tag: string }).tag).toBe("Some");
      expect((result as { fields: readonly unknown[] }).fields).toEqual([Value.Num({ value: 42 })]);
    }),
  );

  // -----------------------------------------------------------------------
  // Codegen tests
  // -----------------------------------------------------------------------

  it.effect("codegen: emits Data.tagged for type declarations", () =>
    Effect.gen(function* () {
      const code = yield* compileSource("type Bool = True | False");
      expect(code).toContain("Data.tagged");
      expect(code).toContain('import { Data } from "effect"');
    }),
  );
});
