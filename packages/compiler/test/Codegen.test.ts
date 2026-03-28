import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser } from "@bang/core";
import { Checker, Codegen } from "@bang/compiler";

const compile = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    const typed = yield* Checker.check(ast);
    return yield* Codegen.generate(typed);
  });

describe("Codegen", () => {
  it.effect("generates a const binding", () =>
    Effect.gen(function* () {
      const output = yield* compile('greeting = "hello"');
      expect(output.code).toContain('const greeting = "hello"');
    }),
  );

  it.effect("generates Effect.gen wrapper for top-level force", () =>
    Effect.gen(function* () {
      const output = yield* compile(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      expect(output.code).toContain("Effect.gen(function*");
      expect(output.code).toContain("Effect.runPromise");
    }),
  );

  it.effect("generates yield* for forced effects", () =>
    Effect.gen(function* () {
      const output = yield* compile(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      expect(output.code).toContain("yield*");
    }),
  );

  it.effect("generates import { Effect } from 'effect'", () =>
    Effect.gen(function* () {
      const output = yield* compile(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      expect(output.code).toContain('import { Effect } from "effect"');
    }),
  );

  it.effect("compiles the full v0.1 target program", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const output = yield* compile(source);
      expect(output.code).toContain('import { Effect } from "effect"');
      expect(output.code).toContain("const greeting");
      expect(output.code).toContain("Effect.runPromise");
      expect(output.code).toContain("yield*");
    }),
  );

  it.effect("builds source map entries", () =>
    Effect.gen(function* () {
      const source = 'greeting = "hello"';
      const output = yield* compile(source);
      expect(output.sourceMap.size).toBeGreaterThan(0);
    }),
  );
});
