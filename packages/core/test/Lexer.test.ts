import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer } from "@bang/core";

describe("Lexer", () => {
  it.effect("lexes a simple declaration", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize('greeting = "hello"');
      expect(tokens.map((t) => t._tag)).toEqual(["Ident", "Operator", "StringLit", "EOF"]);
      expect((tokens[0] as any).value).toBe("greeting");
      expect((tokens[1] as any).value).toBe("=");
      expect((tokens[2] as any).value).toBe("hello");
    }),
  );

  it.effect("lexes keywords", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("declare mut type from import export");
      const tags = tokens.filter((t) => t._tag !== "EOF").map((t) => (t as any).value);
      expect(tags).toEqual(["declare", "mut", "type", "from", "import", "export"]);
    }),
  );

  it.effect("lexes true/false as BoolLit, not Keyword", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("true false");
      expect(tokens[0]._tag).toBe("BoolLit");
      expect((tokens[0] as any).value).toBe(true);
      expect(tokens[1]._tag).toBe("BoolLit");
      expect((tokens[1] as any).value).toBe(false);
    }),
  );

  it.effect("lexes integer and float literals", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("42 3.14");
      expect(tokens[0]._tag).toBe("IntLit");
      expect((tokens[0] as any).value).toBe("42");
      expect(tokens[1]._tag).toBe("FloatLit");
      expect((tokens[1] as any).value).toBe("3.14");
    }),
  );

  it.effect("lexes the force operator", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("!foo");
      expect(tokens[0]._tag).toBe("Operator");
      expect((tokens[0] as any).value).toBe("!");
      expect(tokens[1]._tag).toBe("Ident");
    }),
  );

  it.effect("lexes type identifiers", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("Effect Unit String");
      expect(tokens.filter((t) => t._tag !== "EOF").every((t) => t._tag === "TypeIdent")).toBe(
        true,
      );
    }),
  );

  it.effect("lexes arrow operator", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("String -> Effect");
      expect(tokens.map((t) => t._tag)).toEqual(["TypeIdent", "Operator", "TypeIdent", "EOF"]);
      expect((tokens[1] as any).value).toBe("->");
    }),
  );

  it.effect("lexes delimiters", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("{ } ( ) :");
      const values = tokens.filter((t) => t._tag === "Delimiter").map((t) => (t as any).value);
      expect(values).toEqual(["{", "}", "(", ")", ":"]);
    }),
  );

  it.effect("lexes the full v0.1 target program", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const tokens = yield* Lexer.tokenize(source);
      expect(tokens[tokens.length - 1]._tag).toBe("EOF");
      expect(tokens.length).toBeGreaterThan(10);
    }),
  );

  it.effect("tracks spans correctly", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("x = 42");
      expect(tokens[0]._tag).toBe("Ident");
      expect((tokens[0] as any).span.startLine).toBe(1);
      expect((tokens[0] as any).span.startCol).toBe(0);
    }),
  );

  it.effect("reports error for unterminated string", () =>
    Effect.gen(function* () {
      const result = yield* Lexer.tokenize('"hello').pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );
});
