import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Interpreter, Lexer, Parser, Value } from "@bang/core";

const parseSource = (src: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(src);
    return yield* Parser.parse(tokens);
  });

describe("Dot match", () => {
  it.effect("parses .match { arms } as MatchExpr", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        "type Maybe a = Some a | None\nx = (Some 42).match { Some v -> v, None -> 0 }",
      );
      if (ast.statements[1]._tag === "Declaration") {
        expect(ast.statements[1].value._tag).toBe("MatchExpr");
      }
    }),
  );

  it.effect("interprets .match { arms }", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource(
        "type Maybe a = Some a | None\nx = !(Some 42).match { Some v -> v, None -> 0 }",
      );
      const result = yield* Interpreter.evalProgram(ast);
      expect(result).toEqual(Value.Num({ value: 42 }));
    }),
  );
});
