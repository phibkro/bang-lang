import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser } from "@bang/core";

describe("Match parsing", () => {
  const parseSource = (src: string) =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize(src);
      return yield* Parser.parse(tokens);
    });

  it.effect("parses match with wildcard", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource('x = match 42 { _ -> "any" }');
      const decl = ast.statements[0];
      expect(decl._tag).toBe("Declaration");
      if (decl._tag === "Declaration") {
        expect(decl.value._tag).toBe("MatchExpr");
      }
    }),
  );

  it.effect("parses match with constructor patterns", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        "type Maybe a = Some a | None\nx = match y { Some v -> v, None -> 0 }",
      );
      const decl = ast.statements[1];
      if (decl._tag === "Declaration" && decl.value._tag === "MatchExpr") {
        expect(decl.value.arms).toHaveLength(2);
        expect(decl.value.arms[0].pattern._tag).toBe("ConstructorPattern");
        expect(decl.value.arms[1].pattern._tag).toBe("ConstructorPattern");
      }
    }),
  );

  it.effect("parses match with literal patterns", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource('x = match n { 0 -> "zero", _ -> "other" }');
      if (ast.statements[0]._tag === "Declaration") {
        const m = ast.statements[0].value;
        if (m._tag === "MatchExpr") {
          expect(m.arms[0].pattern._tag).toBe("LiteralPattern");
          expect(m.arms[1].pattern._tag).toBe("WildcardPattern");
        }
      }
    }),
  );

  it.effect("parses match with binding patterns", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource("x = match 42 { n -> n + 1 }");
      if (ast.statements[0]._tag === "Declaration") {
        const m = ast.statements[0].value;
        if (m._tag === "MatchExpr") {
          expect(m.arms[0].pattern._tag).toBe("BindingPattern");
          if (m.arms[0].pattern._tag === "BindingPattern") {
            expect(m.arms[0].pattern.name).toBe("n");
          }
        }
      }
    }),
  );

  it.effect("parses nullary constructor None as constructor pattern", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        'type Maybe a = Some a | None\nx = match y { None -> "nothing" }',
      );
      if (ast.statements[1]._tag === "Declaration") {
        const m = ast.statements[1].value;
        if (m._tag === "MatchExpr") {
          expect(m.arms[0].pattern._tag).toBe("ConstructorPattern");
          if (m.arms[0].pattern._tag === "ConstructorPattern") {
            expect(m.arms[0].pattern.tag).toBe("None");
            expect(m.arms[0].pattern.patterns).toHaveLength(0);
          }
        }
      }
    }),
  );

  it.effect("parses match with trailing comma", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource("x = match n { 1 -> 10, 2 -> 20, }");
      if (ast.statements[0]._tag === "Declaration") {
        const m = ast.statements[0].value;
        if (m._tag === "MatchExpr") {
          expect(m.arms).toHaveLength(2);
        }
      }
    }),
  );

  it.effect("parses constructor pattern with nested sub-pattern", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        "type Maybe a = Some a | None\nx = match y { Some x -> x }",
      );
      if (ast.statements[1]._tag === "Declaration") {
        const m = ast.statements[1].value;
        if (m._tag === "MatchExpr" && m.arms[0].pattern._tag === "ConstructorPattern") {
          expect(m.arms[0].pattern.tag).toBe("Some");
          expect(m.arms[0].pattern.patterns).toHaveLength(1);
          expect(m.arms[0].pattern.patterns[0]._tag).toBe("BindingPattern");
        }
      }
    }),
  );
});
