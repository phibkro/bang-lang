import { Effect, HashMap, Match, Option } from "effect";
import type * as Ast from "./Ast.js";
import { Num, Str, Bool, Unit, EvalError, type Value } from "./Value.js";

type Env = HashMap.HashMap<string, Value>;

export const evalExpr = (
  expr: Ast.Expr,
  env: Env,
): Effect.Effect<Value, EvalError> =>
  Match.value(expr).pipe(
    Match.tag("IntLiteral", (e) => Effect.succeed(Num({ value: e.value }))),
    Match.tag("FloatLiteral", (e) => Effect.succeed(Num({ value: e.value }))),
    Match.tag("StringLiteral", (e) =>
      Effect.succeed(Str({ value: e.value })),
    ),
    Match.tag("BoolLiteral", (e) =>
      Effect.succeed(Bool({ value: e.value })),
    ),
    Match.tag("UnitLiteral", () => Effect.succeed(Unit())),
    Match.tag("Ident", (e) =>
      Option.match(HashMap.get(env, e.name), {
        onNone: () =>
          Effect.fail(
            new EvalError({
              message: `Undefined variable: ${e.name}`,
              span: e.span,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
    Match.tag("BinaryExpr", (e) =>
      Effect.gen(function* () {
        const left = yield* evalExpr(e.left, env);
        const right = yield* evalExpr(e.right, env);
        return yield* applyBinaryOp(e.op, left, right, e.span);
      }),
    ),
    Match.tag("UnaryExpr", (e) =>
      Effect.gen(function* () {
        const val = yield* evalExpr(e.expr, env);
        return yield* applyUnaryOp(e.op, val, e.span);
      }),
    ),
    Match.tag("Force", (e) => evalExpr(e.expr, env)),
    Match.tag("DotAccess", (e) =>
      Effect.fail(
        new EvalError({
          message: "DotAccess not supported in interpreter v1",
          span: e.span,
        }),
      ),
    ),
    // Stubs for Task 3:
    Match.tag("Block", () =>
      Effect.fail(
        new EvalError({
          message: "Not yet implemented: Block",
          span: expr.span,
        }),
      ),
    ),
    Match.tag("Lambda", () =>
      Effect.fail(
        new EvalError({
          message: "Not yet implemented: Lambda",
          span: expr.span,
        }),
      ),
    ),
    Match.tag("App", () =>
      Effect.fail(
        new EvalError({
          message: "Not yet implemented: App",
          span: expr.span,
        }),
      ),
    ),
    Match.tag("StringInterp", () =>
      Effect.fail(
        new EvalError({
          message: "Not yet implemented: StringInterp",
          span: expr.span,
        }),
      ),
    ),
    Match.exhaustive,
  );

const applyBinaryOp = (
  op: string,
  left: Value,
  right: Value,
  span: Ast.Span,
): Effect.Effect<Value, EvalError> => {
  // Arithmetic: both must be Num
  if (
    op === "+" ||
    op === "-" ||
    op === "*" ||
    op === "/" ||
    op === "%"
  ) {
    if (left._tag !== "Num" || right._tag !== "Num")
      return Effect.fail(
        new EvalError({ message: `Operator ${op} requires numbers`, span }),
      );
    const l = left.value,
      r = right.value;
    if ((op === "/" || op === "%") && r === 0)
      return Effect.fail(
        new EvalError({ message: "Division by zero", span }),
      );
    const result =
      op === "+"
        ? l + r
        : op === "-"
          ? l - r
          : op === "*"
            ? l * r
            : op === "/"
              ? l / r
              : l % r;
    return Effect.succeed(Num({ value: result }));
  }

  // String concat
  if (op === "++") {
    if (left._tag !== "Str" || right._tag !== "Str")
      return Effect.fail(
        new EvalError({ message: "Operator ++ requires strings", span }),
      );
    return Effect.succeed(Str({ value: left.value + right.value }));
  }

  // Comparison: same type required
  if (
    op === "==" ||
    op === "!=" ||
    op === "<" ||
    op === ">" ||
    op === "<=" ||
    op === ">="
  ) {
    if (left._tag !== right._tag)
      return Effect.fail(
        new EvalError({
          message: `Cannot compare ${left._tag} with ${right._tag}`,
          span,
        }),
      );
    if (left._tag === "Num" && right._tag === "Num") {
      const l = left.value,
        r = right.value;
      const result =
        op === "=="
          ? l === r
          : op === "!="
            ? l !== r
            : op === "<"
              ? l < r
              : op === ">"
                ? l > r
                : op === "<="
                  ? l <= r
                  : l >= r;
      return Effect.succeed(Bool({ value: result }));
    }
    // For other types, only == and != make sense
    if (op === "==")
      return Effect.succeed(
        Bool({ value: JSON.stringify(left) === JSON.stringify(right) }),
      );
    if (op === "!=")
      return Effect.succeed(
        Bool({ value: JSON.stringify(left) !== JSON.stringify(right) }),
      );
    return Effect.fail(
      new EvalError({
        message: `Operator ${op} only supported for numbers`,
        span,
      }),
    );
  }

  // Logical: both must be Bool
  if (op === "and" || op === "or" || op === "xor") {
    if (left._tag !== "Bool" || right._tag !== "Bool")
      return Effect.fail(
        new EvalError({
          message: `Operator ${op} requires booleans`,
          span,
        }),
      );
    const l = left.value,
      r = right.value;
    const result =
      op === "and" ? l && r : op === "or" ? l || r : l !== r;
    return Effect.succeed(Bool({ value: result }));
  }

  return Effect.fail(
    new EvalError({ message: `Unknown operator: ${op}`, span }),
  );
};

const applyUnaryOp = (
  op: string,
  val: Value,
  span: Ast.Span,
): Effect.Effect<Value, EvalError> => {
  if (op === "-") {
    if (val._tag !== "Num")
      return Effect.fail(
        new EvalError({ message: "Unary - requires number", span }),
      );
    return Effect.succeed(Num({ value: -val.value }));
  }
  if (op === "not") {
    if (val._tag !== "Bool")
      return Effect.fail(
        new EvalError({ message: "not requires boolean", span }),
      );
    return Effect.succeed(Bool({ value: !val.value }));
  }
  return Effect.fail(
    new EvalError({ message: `Unknown unary operator: ${op}`, span }),
  );
};
