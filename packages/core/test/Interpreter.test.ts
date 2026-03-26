import { describe, expect, it } from "@effect/vitest";
import { Effect, HashMap } from "effect";
import * as Ast from "@bang/core/Ast";
import * as Span from "@bang/core/Span";
import { Interpreter, Value } from "@bang/core";

const s = Span.empty;
const emptyEnv = HashMap.empty<string, Value.Value>();

describe("Interpreter", () => {
  it.effect("evaluates integer literal", () =>
    Effect.gen(function* () {
      const result = yield* Interpreter.evalExpr(
        new Ast.IntLiteral({ value: 42, span: s }),
        emptyEnv,
      );
      expect(result).toEqual(Value.Num({ value: 42 }));
    }),
  );

  it.effect("evaluates float literal", () =>
    Effect.gen(function* () {
      const result = yield* Interpreter.evalExpr(
        new Ast.FloatLiteral({ value: 3.14, span: s }),
        emptyEnv,
      );
      expect(result).toEqual(Value.Num({ value: 3.14 }));
    }),
  );

  it.effect("evaluates string literal", () =>
    Effect.gen(function* () {
      const result = yield* Interpreter.evalExpr(
        new Ast.StringLiteral({ value: "hello", span: s }),
        emptyEnv,
      );
      expect(result).toEqual(Value.Str({ value: "hello" }));
    }),
  );

  it.effect("evaluates bool literal", () =>
    Effect.gen(function* () {
      const result = yield* Interpreter.evalExpr(
        new Ast.BoolLiteral({ value: true, span: s }),
        emptyEnv,
      );
      expect(result).toEqual(Value.Bool({ value: true }));
    }),
  );

  it.effect("evaluates unit literal", () =>
    Effect.gen(function* () {
      const result = yield* Interpreter.evalExpr(
        new Ast.UnitLiteral({ span: s }),
        emptyEnv,
      );
      expect(result).toEqual(Value.Unit());
    }),
  );

  it.effect("evaluates arithmetic addition", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "+",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 2, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 3 }));
    }),
  );

  it.effect("evaluates arithmetic subtraction", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "-",
        left: new Ast.IntLiteral({ value: 10, span: s }),
        right: new Ast.IntLiteral({ value: 3, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 7 }));
    }),
  );

  it.effect("evaluates arithmetic multiplication", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "*",
        left: new Ast.IntLiteral({ value: 4, span: s }),
        right: new Ast.IntLiteral({ value: 5, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 20 }));
    }),
  );

  it.effect("evaluates arithmetic division", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "/",
        left: new Ast.IntLiteral({ value: 10, span: s }),
        right: new Ast.IntLiteral({ value: 3, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 10 / 3 }));
    }),
  );

  it.effect("evaluates modulo", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "%",
        left: new Ast.IntLiteral({ value: 7, span: s }),
        right: new Ast.IntLiteral({ value: 3, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 1 }));
    }),
  );

  it.effect("evaluates comparison ==", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "==",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 1, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Bool({ value: true }));
    }),
  );

  it.effect("evaluates comparison !=", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "!=",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 2, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Bool({ value: true }));
    }),
  );

  it.effect("evaluates comparison <", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "<",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 2, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Bool({ value: true }));
    }),
  );

  it.effect("evaluates unary minus", () =>
    Effect.gen(function* () {
      const expr = new Ast.UnaryExpr({
        op: "-",
        expr: new Ast.IntLiteral({ value: 5, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: -5 }));
    }),
  );

  it.effect("evaluates unary not", () =>
    Effect.gen(function* () {
      const expr = new Ast.UnaryExpr({
        op: "not",
        expr: new Ast.BoolLiteral({ value: true, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Bool({ value: false }));
    }),
  );

  it.effect("evaluates string concat", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "++",
        left: new Ast.StringLiteral({ value: "hello", span: s }),
        right: new Ast.StringLiteral({ value: " world", span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Str({ value: "hello world" }));
    }),
  );

  it.effect("evaluates logical and", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "and",
        left: new Ast.BoolLiteral({ value: true, span: s }),
        right: new Ast.BoolLiteral({ value: false, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Bool({ value: false }));
    }),
  );

  it.effect("evaluates logical or", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "or",
        left: new Ast.BoolLiteral({ value: false, span: s }),
        right: new Ast.BoolLiteral({ value: true, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Bool({ value: true }));
    }),
  );

  it.effect("evaluates variable lookup", () =>
    Effect.gen(function* () {
      const env = HashMap.set(emptyEnv, "x", Value.Num({ value: 99 }));
      const result = yield* Interpreter.evalExpr(
        new Ast.Ident({ name: "x", span: s }),
        env,
      );
      expect(result).toEqual(Value.Num({ value: 99 }));
    }),
  );

  it.effect("errors on undefined variable", () =>
    Effect.gen(function* () {
      const result = yield* Interpreter.evalExpr(
        new Ast.Ident({ name: "x", span: s }),
        emptyEnv,
      ).pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("errors on type mismatch in arithmetic", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "+",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.StringLiteral({ value: "x", span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv).pipe(
        Effect.either,
      );
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("errors on division by zero", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "/",
        left: new Ast.IntLiteral({ value: 1, span: s }),
        right: new Ast.IntLiteral({ value: 0, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv).pipe(
        Effect.either,
      );
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("errors on modulo by zero", () =>
    Effect.gen(function* () {
      const expr = new Ast.BinaryExpr({
        op: "%",
        left: new Ast.IntLiteral({ value: 5, span: s }),
        right: new Ast.IntLiteral({ value: 0, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv).pipe(
        Effect.either,
      );
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("evaluates nested binary expressions", () =>
    Effect.gen(function* () {
      // (1 + 2) * 3 = 9
      const expr = new Ast.BinaryExpr({
        op: "*",
        left: new Ast.BinaryExpr({
          op: "+",
          left: new Ast.IntLiteral({ value: 1, span: s }),
          right: new Ast.IntLiteral({ value: 2, span: s }),
          span: s,
        }),
        right: new Ast.IntLiteral({ value: 3, span: s }),
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 9 }));
    }),
  );
});
