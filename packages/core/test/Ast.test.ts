import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { Ast, Span } from "@bang/core";

const span = Span.empty;

describe("Ast", () => {
  it("creates a Program node", () => {
    const program = new Ast.Program({ statements: [], span });
    expect(program._tag).toBe("Program");
    expect(program.statements).toEqual([]);
  });

  it("creates a Declaration node", () => {
    const decl = new Ast.Declaration({
      name: "greeting",
      mutable: false,
      value: new Ast.StringLiteral({ value: "hello", span }),
      typeAnnotation: Option.none(),
      span,
    });
    expect(decl._tag).toBe("Declaration");
    expect(decl.name).toBe("greeting");
  });

  it("creates a Declare node (external declaration)", () => {
    const decl = new Ast.Declare({
      name: "console.log",
      typeAnnotation: new Ast.ArrowType({
        param: new Ast.ConcreteType({ name: "String", span }),
        result: new Ast.EffectType({
          value: new Ast.ConcreteType({ name: "Unit", span }),
          deps: ["stdout"],
          error: new Ast.ConcreteType({ name: "Unit", span }),
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
    const force = new Ast.Force({
      expr: new Ast.App({
        func: new Ast.Ident({ name: "console.log", span }),
        args: [new Ast.Ident({ name: "greeting", span })],
        span,
      }),
      span,
    });
    expect(force._tag).toBe("Force");
    expect(force.expr._tag).toBe("App");
  });
});
