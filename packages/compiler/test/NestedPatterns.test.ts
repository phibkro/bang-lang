import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Interpreter, Lexer, Parser, Value } from "@bang/core";

const parseSource = (src: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(src);
    return yield* Parser.parse(tokens);
  });

describe("Nested patterns", () => {
  it.effect("parses Ok (Some v) as nested ConstructorPattern", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        "type Maybe a = Some a | None\ntype Result a e = Ok a | Err e\nx = match y { Ok (Some v) -> v, Ok None -> 0, Err e -> 0 }",
      );
      const decl = ast.statements[2];
      if (decl._tag === "Declaration" && decl.value._tag === "MatchExpr") {
        const arm0 = decl.value.arms[0];
        expect(arm0.pattern._tag).toBe("ConstructorPattern");
        if (arm0.pattern._tag === "ConstructorPattern") {
          expect(arm0.pattern.tag).toBe("Ok");
          expect(arm0.pattern.patterns).toHaveLength(1);
          const inner = arm0.pattern.patterns[0];
          expect(inner._tag).toBe("ConstructorPattern");
          if (inner._tag === "ConstructorPattern") {
            expect(inner.tag).toBe("Some");
            expect(inner.patterns).toHaveLength(1);
            expect(inner.patterns[0]._tag).toBe("BindingPattern");
          }
        }
      }
    }),
  );

  it.effect("interprets !match (Some 42) { Some v -> v, None -> 0 } as 42", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        "type Maybe a = Some a | None\nx = !match (Some 42) { Some v -> v, None -> 0 }",
      );
      const result = yield* Interpreter.evalProgram(ast);
      expect(result).toEqual(Value.Num({ value: 42 }));
    }),
  );

  it.effect("interprets !match (Ok (Some 99)) with nested patterns as 99", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        "type Maybe a = Some a | None\ntype Result a e = Ok a | Err e\nx = !match (Ok (Some 99)) { Ok (Some v) -> v, Ok None -> 0, Err e -> 0 }",
      );
      const result = yield* Interpreter.evalProgram(ast);
      expect(result).toEqual(Value.Num({ value: 99 }));
    }),
  );
});
