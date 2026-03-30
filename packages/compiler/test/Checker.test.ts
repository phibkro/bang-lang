import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser, InferType } from "@bang/core";
import { Checker } from "@bang/compiler";

const check = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return yield* Checker.check(ast);
  });

describe("Checker", () => {
  it.effect("checks a valid program", () =>
    Effect.gen(function* () {
      const typed = yield* check(`declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`);
      expect(typed._tag).toBe("Program");
      expect(typed.statements.length).toBe(3);
    }),
  );

  it.effect("resolves force of declared Effect as yield*", () =>
    Effect.gen(function* () {
      const typed = yield* check(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      const forceStmt = typed.statements[1] as any;
      expect(forceStmt.annotation.effectClass).toBe("effect");
      expect(forceStmt.annotation.forceResolution).toBe("yield*");
    }),
  );

  it.effect("validates scope — undeclared identifier is an error", () =>
    Effect.gen(function* () {
      const result = yield* check("!undeclared").pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("validates must-handle — unforced Effect in statement position", () =>
    Effect.gen(function* () {
      const result = yield* check(`declare fetch : String -> Effect String { net } {}
fetch "url"`).pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("classifies declarations as signal", () =>
    Effect.gen(function* () {
      const typed = yield* check('greeting = "hello"');
      const decl = typed.statements[0] as any;
      expect(decl.annotation.effectClass).toBe("signal");
    }),
  );

  it.effect("annotates declaration with inferred type", () =>
    Effect.gen(function* () {
      const typed = yield* check("x = 42");
      const decl = typed.statements[0] as any;
      expect(decl.annotation.type).toEqual(InferType.tInt);
    }),
  );

  it.effect("annotates string declaration with inferred type", () =>
    Effect.gen(function* () {
      const typed = yield* check('x = "hello"');
      const decl = typed.statements[0] as any;
      expect(decl.annotation.type).toEqual(InferType.tString);
    }),
  );

  it.effect("annotates declared type from inference", () =>
    Effect.gen(function* () {
      const typed = yield* check("declare log : String -> Unit");
      const decl = typed.statements[0] as any;
      expect(decl.annotation.type._tag).toBe("TArrow");
    }),
  );
});
