/**
 * Property tests for HM type inference.
 *
 * 1. Determinism: inferProgram(p) ≡ inferProgram(p) (same input → same type)
 * 2. Well-typed literals never error
 * 3. Inferred types agree with interpreter (if eval→Num then infer→Int, etc.)
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, FastCheck as fc, Option } from "effect";
import * as Ast from "../src/Ast.js";
import * as Span from "../src/Span.js";
import { Interpreter, Value } from "@bang/core";
import { inferProgram } from "../src/Infer.js";
import { tInt, tFloat, tString, tBool, tUnit } from "../src/InferType.js";
import type { InferType } from "../src/InferType.js";
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

const tryInfer = (program: Ast.Program) => Effect.runSyncExit(inferProgram(program));
const tryEval = (program: Ast.Program) => Effect.runSyncExit(Interpreter.evalProgram(program));

/** Map interpreter Value tags to expected InferTypes. */
const valueTagToType = (tag: string): InferType | undefined => {
  switch (tag) {
    case "Num": return tInt; // Note: both Int and Float map to Num at runtime
    case "Str": return tString;
    case "Bool": return tBool;
    case "Unit": return tUnit;
    default: return undefined; // Closure, Tagged, Constructor, MutCell — skip
  }
};

describe("Inference Property Tests", () => {
  it.prop(
    "inference is deterministic (depth 2)",
    [genExpr(2)],
    ([expr]) => {
      const program = wrapInProgram(expr);
      const r1 = tryInfer(program);
      const r2 = tryInfer(program);
      // Both succeed or both fail
      expect(Exit.isSuccess(r1)).toBe(Exit.isSuccess(r2));
      if (Exit.isSuccess(r1) && Exit.isSuccess(r2)) {
        expect(r1.value.type).toEqual(r2.value.type);
      }
    },
    { fastCheck: { numRuns: 200 } },
  );

  it.prop(
    "literal programs never cause inference errors (depth 0)",
    [fc.oneof(
      fc.integer({ min: 0, max: 1000 }).map((n) => new Ast.IntLiteral({ value: n, span: s })),
      fc.stringOf(fc.constantFrom(..."abcdef"), { maxLength: 5 }).map((v) => new Ast.StringLiteral({ value: v, span: s })),
      fc.boolean().map((b) => new Ast.BoolLiteral({ value: b, span: s })),
      fc.constant(new Ast.UnitLiteral({ span: s })),
    )],
    ([expr]) => {
      const program = wrapInProgram(expr);
      const result = tryInfer(program);
      expect(Exit.isSuccess(result)).toBe(true);
    },
    { fastCheck: { numRuns: 100 } },
  );

  it.prop(
    "inferred types agree with interpreter for simple values (depth 1)",
    [genExpr(1)],
    ([expr]) => {
      const program = wrapInProgram(expr);

      // Both must succeed
      const inferExit = tryInfer(program);
      fc.pre(Exit.isSuccess(inferExit));
      const evalExit = tryEval(program);
      fc.pre(Exit.isSuccess(evalExit));

      const inferredType = (inferExit as Exit.Success<any, any>).value.type;
      const evalValue = (evalExit as Exit.Success<any, any>).value;

      // Only check primitive values (skip Closure, Tagged, etc.)
      const expectedType = valueTagToType(evalValue._tag);
      fc.pre(expectedType !== undefined);

      // Special case: Float also produces Num at runtime, so accept both Int and Float
      if (evalValue._tag === "Num") {
        const isNumericType =
          (inferredType._tag === "TCon" && inferredType.name === "Int") ||
          (inferredType._tag === "TCon" && inferredType.name === "Float");
        expect(isNumericType).toBe(true);
      } else {
        expect(inferredType).toEqual(expectedType);
      }
    },
    { fastCheck: { numRuns: 200 } },
  );
});
