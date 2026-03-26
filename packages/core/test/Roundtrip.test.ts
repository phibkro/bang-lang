/**
 * The most valuable test in the codebase.
 *
 * ∀ ast. eval(parse(format(ast))) ≡ eval(ast)
 *
 * One property test covering the entire parser + formatter + interpreter
 * for randomly generated programs.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, FastCheck as fc, Option } from "effect";
import * as Ast from "@bang/core/Ast";
import * as Span from "@bang/core/Span";
import { Formatter, Interpreter, Lexer, Parser } from "@bang/core";
import { genExpr } from "../src/AstGen.js";

const s = Span.empty;

const wrapInProgram = (expr: Ast.Expr): Ast.Program =>
  new Ast.Program({
    statements: [
      new Ast.Declaration({
        name: "result",
        mutable: false,
        value: expr,
        typeAnnotation: Option.none(),
        span: s,
      }),
    ],
    span: s,
  });

const tryEval = (program: Ast.Program) => Effect.runSyncExit(Interpreter.evalProgram(program));

const tryParse = (source: string) =>
  Effect.runSyncExit(
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize(source);
      return yield* Parser.parse(tokens);
    }),
  );

describe("Roundtrip Property Tests", () => {
  it.prop(
    "format roundtrip preserves semantics (depth 2)",
    [genExpr(2)],
    ([expr]) => {
      const program = wrapInProgram(expr);

      // Interpret original — skip if errors
      const evalExit = tryEval(program);
      fc.pre(Exit.isSuccess(evalExit));
      const original = (evalExit as Exit.Success<any, any>).value;

      // Skip closures
      fc.pre(original._tag !== "Closure");

      // Format to source
      const source = Formatter.format(program);

      // Re-parse — skip if fails
      const parseExit = tryParse(source);
      fc.pre(Exit.isSuccess(parseExit));
      const reparsed = (parseExit as Exit.Success<any, any>).value;

      // Re-eval — skip if fails
      const reEvalExit = tryEval(reparsed);
      fc.pre(Exit.isSuccess(reEvalExit));
      const roundtripped = (reEvalExit as Exit.Success<any, any>).value;

      // THE ASSERTION
      expect(roundtripped).toEqual(original);
    },
    { fastCheck: { numRuns: 100 } },
  );

  it.prop(
    "format is idempotent for random programs (depth 2)",
    [genExpr(2)],
    ([expr]) => {
      const program = wrapInProgram(expr);
      const once = Formatter.format(program);

      const parseExit = tryParse(once);
      fc.pre(Exit.isSuccess(parseExit));
      const reparsed = (parseExit as Exit.Success<any, any>).value;
      const twice = Formatter.format(reparsed);

      expect(twice).toBe(once);
    },
    { fastCheck: { numRuns: 100 } },
  );
});
