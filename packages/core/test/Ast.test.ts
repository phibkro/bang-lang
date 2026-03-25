import { describe, expect, it } from "@effect/vitest";
import { Ast, Span } from "@bang/core";

const span = Span.empty;

describe("Ast", () => {
  it("creates a Program node", () => {
    const program = Ast.Program({ statements: [], span });
    expect(program._tag).toBe("Program");
    expect(program.statements).toEqual([]);
  });

  it("creates a Declaration node", () => {
    const decl = Ast.Declaration({
      name: "greeting",
      mutable: false,
      value: Ast.StringLiteral({ value: "hello", span }),
      typeAnnotation: undefined,
      span,
    });
    expect(decl._tag).toBe("Declaration");
    expect(decl.name).toBe("greeting");
  });

  it("creates a Declare node (external declaration)", () => {
    const decl = Ast.Declare({
      name: "console.log",
      typeAnnotation: Ast.ArrowType({
        param: Ast.ConcreteType({ name: "String", span }),
        result: Ast.EffectType({
          value: Ast.ConcreteType({ name: "Unit", span }),
          deps: ["stdout"],
          error: Ast.ConcreteType({ name: "Unit", span }),
          span,
        }),
        span,
      }),
      span,
    });
    expect(decl._tag).toBe("Declare");
    expect(decl.name).toBe("console.log");
  });

  it("creates a Force node", () => {
    const force = Ast.Force({
      expr: Ast.App({
        func: Ast.Ident({ name: "console.log", span }),
        args: [Ast.Ident({ name: "greeting", span })],
        span,
      }),
      span,
    });
    expect(force._tag).toBe("Force");
    expect(force.expr._tag).toBe("App");
  });
});
