import { Array as Arr, Effect, HashMap, Match, Option } from "effect";
import type * as Ast from "./Ast.js";
import type * as Span from "./Span.js";
import {
  Num,
  Str,
  Bool,
  Unit,
  Closure,
  Tagged,
  Constructor,
  MutCell,
  EvalError,
  coerceToString,
  type Value,
} from "./Value.js";

const matchPattern = (pattern: Ast.Pattern, value: Value, env: Env): Option.Option<Env> =>
  Match.value(pattern).pipe(
    Match.tag("WildcardPattern", () => Option.some(env)),
    Match.tag("BindingPattern", (p) => Option.some(HashMap.set(env, p.name, value))),
    Match.tag("ConstructorPattern", (p) => {
      if (value._tag !== "Tagged" || value.tag !== p.tag) return Option.none();
      if (p.patterns.length !== value.fields.length) return Option.none();
      let currentEnv = env;
      for (let i = 0; i < p.patterns.length; i++) {
        const result = matchPattern(p.patterns[i], value.fields[i], currentEnv);
        if (Option.isNone(result)) return Option.none();
        currentEnv = result.value;
      }
      return Option.some(currentEnv);
    }),
    Match.tag("LiteralPattern", (p) => {
      if (p.value._tag === "IntLiteral" && value._tag === "Num" && value.value === p.value.value)
        return Option.some(env);
      if (p.value._tag === "FloatLiteral" && value._tag === "Num" && value.value === p.value.value)
        return Option.some(env);
      if (p.value._tag === "StringLiteral" && value._tag === "Str" && value.value === p.value.value)
        return Option.some(env);
      if (p.value._tag === "BoolLiteral" && value._tag === "Bool" && value.value === p.value.value)
        return Option.some(env);
      if (p.value._tag === "UnitLiteral" && value._tag === "Unit") return Option.some(env);
      return Option.none();
    }),
    Match.exhaustive,
  );

type Env = HashMap.HashMap<string, Value>;

export const evalExpr = (expr: Ast.Expr, env: Env): Effect.Effect<Value, EvalError> =>
  Match.value(expr).pipe(
    Match.tag("IntLiteral", (e) => Effect.succeed(Num({ value: e.value }))),
    Match.tag("FloatLiteral", (e) => Effect.succeed(Num({ value: e.value }))),
    Match.tag("StringLiteral", (e) => Effect.succeed(Str({ value: e.value }))),
    Match.tag("BoolLiteral", (e) => Effect.succeed(Bool({ value: e.value }))),
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
        onSome: (v) => Effect.succeed(v._tag === "MutCell" ? v.ref.value : v),
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
    Match.tag("Block", (e) =>
      Effect.gen(function* () {
        let blockEnv = env;
        for (const stmt of e.statements) {
          blockEnv = yield* evalStmt(stmt, blockEnv);
        }
        return yield* evalExpr(e.expr, blockEnv);
      }),
    ),
    Match.tag("Lambda", (e) =>
      Effect.succeed(Closure({ params: [...e.params], body: e.body, env })),
    ),
    Match.tag("App", (e) =>
      Effect.gen(function* () {
        const func = yield* evalExpr(e.func, env);

        const args: Value[] = [];
        for (const arg of e.args) {
          args.push(yield* evalExpr(arg, env));
        }

        if (func._tag === "Constructor") {
          const allApplied = [...func.applied, ...args];
          if (allApplied.length >= func.arity) {
            return Tagged({ tag: func.tag, fields: allApplied });
          }
          return Constructor({ tag: func.tag, arity: func.arity, applied: allApplied });
        }

        if (func._tag !== "Closure")
          return yield* Effect.fail(
            new EvalError({
              message: "Cannot apply non-function",
              span: e.span,
            }),
          );

        return yield* applyClosure(func, args, e.span);
      }),
    ),
    Match.tag("StringInterp", (e) =>
      Effect.gen(function* () {
        const parts: string[] = [];
        for (const part of e.parts) {
          if (part._tag === "InterpText") {
            parts.push(part.value);
          } else {
            const val = yield* evalExpr(part.value, env);
            const str = yield* coerceToString(val);
            parts.push(str);
          }
        }
        return Str({ value: parts.join("") });
      }),
    ),
    Match.tag("MatchExpr", (e) =>
      Effect.gen(function* () {
        const scrutinee = yield* evalExpr(e.scrutinee, env);
        for (const arm of e.arms) {
          const result = matchPattern(arm.pattern, scrutinee, env);
          if (Option.isSome(result)) {
            return yield* evalExpr(arm.body, result.value);
          }
        }
        return yield* Effect.fail(
          new EvalError({ message: "Non-exhaustive match: no arm matched", span: e.span }),
        );
      }),
    ),
    Match.exhaustive,
  );

const evalStmt = (stmt: Ast.Stmt, env: Env): Effect.Effect<Env, EvalError> =>
  Match.value(stmt).pipe(
    Match.tag("Declaration", (s) =>
      Effect.gen(function* () {
        const value = yield* evalExpr(s.value, env);
        if (s.mutable) {
          return HashMap.set(env, s.name, MutCell({ ref: { value } }));
        }
        return HashMap.set(env, s.name, value);
      }),
    ),
    Match.tag("Declare", () => Effect.succeed(env)),
    Match.tag("ForceStatement", (s) =>
      Effect.gen(function* () {
        yield* evalExpr(s.expr, env);
        return env;
      }),
    ),
    Match.tag("ExprStatement", (s) =>
      Effect.gen(function* () {
        yield* evalExpr(s.expr, env);
        return env;
      }),
    ),
    Match.tag("TypeDecl", (s) =>
      Effect.succeed(
        Arr.reduce(s.constructors, env, (acc, ctor) =>
          Match.value(ctor).pipe(
            Match.tag("NullaryConstructor", (c) =>
              HashMap.set(acc, c.tag, Tagged({ tag: c.tag, fields: [] })),
            ),
            Match.tag("PositionalConstructor", (c) =>
              HashMap.set(
                acc,
                c.tag,
                Constructor({ tag: c.tag, arity: c.fields.length, applied: [] }),
              ),
            ),
            Match.tag("NamedConstructor", (c) =>
              HashMap.set(
                acc,
                c.tag,
                Constructor({ tag: c.tag, arity: c.fields.length, applied: [] }),
              ),
            ),
            Match.exhaustive,
          ),
        ),
      ),
    ),
    Match.tag("Mutation", (s) =>
      Effect.gen(function* () {
        const cell = HashMap.get(env, s.target);
        if (Option.isNone(cell)) {
          return yield* Effect.fail(
            new EvalError({ message: `Undefined variable: ${s.target}`, span: s.span }),
          );
        }
        if (cell.value._tag !== "MutCell") {
          return yield* Effect.fail(
            new EvalError({
              message: `Cannot mutate non-mutable binding: ${s.target}`,
              span: s.span,
            }),
          );
        }
        const newValue = yield* evalExpr(s.value, env);
        cell.value.ref.value = newValue;
        return env;
      }),
    ),
    Match.tag("Import", (s) =>
      Effect.fail(new EvalError({ message: "Import not yet implemented", span: s.span })),
    ),
    Match.tag("Export", (s) =>
      Effect.fail(new EvalError({ message: "Export not yet implemented", span: s.span })),
    ),
    Match.exhaustive,
  );

const applyClosure = (
  closure: Extract<Value, { _tag: "Closure" }>,
  args: Value[],
  span: Span.Span,
): Effect.Effect<Value, EvalError> => {
  const { params, body, env: closureEnv } = closure;

  if (args.length < params.length) {
    let newEnv = closureEnv;
    for (let i = 0; i < args.length; i++) {
      newEnv = HashMap.set(newEnv, params[i], args[i]);
    }
    return Effect.succeed(
      Closure({
        params: params.slice(args.length),
        body,
        env: newEnv,
      }),
    );
  }

  if (args.length === params.length) {
    let newEnv = closureEnv;
    for (let i = 0; i < args.length; i++) {
      newEnv = HashMap.set(newEnv, params[i], args[i]);
    }
    return evalExpr(body, newEnv);
  }

  return Effect.fail(
    new EvalError({
      message: "Over-application not supported in v1",
      span,
    }),
  );
};

const applyBinaryOp = (
  op: string,
  left: Value,
  right: Value,
  span: Span.Span,
): Effect.Effect<Value, EvalError> => {
  // Arithmetic: both must be Num
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
    if (left._tag !== "Num" || right._tag !== "Num")
      return Effect.fail(new EvalError({ message: `Operator ${op} requires numbers`, span }));
    const l = left.value,
      r = right.value;
    if ((op === "/" || op === "%") && r === 0)
      return Effect.fail(new EvalError({ message: "Division by zero", span }));
    const result =
      op === "+" ? l + r : op === "-" ? l - r : op === "*" ? l * r : op === "/" ? l / r : l % r;
    return Effect.succeed(Num({ value: result }));
  }

  // String concat
  if (op === "++") {
    if (left._tag !== "Str" || right._tag !== "Str")
      return Effect.fail(new EvalError({ message: "Operator ++ requires strings", span }));
    return Effect.succeed(Str({ value: left.value + right.value }));
  }

  // Comparison: same type required
  if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
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
    // For Str: compare value directly
    if (left._tag === "Str" && right._tag === "Str") {
      if (op === "==") return Effect.succeed(Bool({ value: left.value === right.value }));
      if (op === "!=") return Effect.succeed(Bool({ value: left.value !== right.value }));
    }
    // For Bool: compare value directly
    if (left._tag === "Bool" && right._tag === "Bool") {
      if (op === "==") return Effect.succeed(Bool({ value: left.value === right.value }));
      if (op === "!=") return Effect.succeed(Bool({ value: left.value !== right.value }));
    }
    // For Unit: always equal
    if (left._tag === "Unit" && right._tag === "Unit") {
      if (op === "==") return Effect.succeed(Bool({ value: true }));
      if (op === "!=") return Effect.succeed(Bool({ value: false }));
    }
    // Closures cannot be compared
    if (left._tag === "Closure" || right._tag === "Closure") {
      return Effect.fail(new EvalError({ message: "Cannot compare closures", span }));
    }
    return Effect.fail(
      new EvalError({
        message: `Operator ${op} not supported for ${left._tag}`,
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
    const result = op === "and" ? l && r : op === "or" ? l || r : l !== r;
    return Effect.succeed(Bool({ value: result }));
  }

  return Effect.fail(new EvalError({ message: `Unknown operator: ${op}`, span }));
};

const applyUnaryOp = (op: string, val: Value, span: Span.Span): Effect.Effect<Value, EvalError> => {
  if (op === "-") {
    if (val._tag !== "Num")
      return Effect.fail(new EvalError({ message: "Unary - requires number", span }));
    return Effect.succeed(Num({ value: -val.value }));
  }
  if (op === "not") {
    if (val._tag !== "Bool")
      return Effect.fail(new EvalError({ message: "not requires boolean", span }));
    return Effect.succeed(Bool({ value: !val.value }));
  }
  return Effect.fail(new EvalError({ message: `Unknown unary operator: ${op}`, span }));
};

export const evalProgram = (program: Ast.Program): Effect.Effect<Value, EvalError> =>
  Effect.gen(function* () {
    let env: Env = HashMap.empty();
    let lastValue: Value = Unit();

    for (const stmt of program.statements) {
      if (stmt._tag === "Declaration") {
        const val = yield* evalExpr(stmt.value, env);
        if (stmt.mutable) {
          env = HashMap.set(env, stmt.name, MutCell({ ref: { value: val } }));
        } else {
          env = HashMap.set(env, stmt.name, val);
        }
        lastValue = val;
      } else if (stmt._tag === "Declare") {
        lastValue = Unit();
      } else if (stmt._tag === "ForceStatement") {
        lastValue = yield* evalExpr(stmt.expr, env);
      } else if (stmt._tag === "ExprStatement") {
        lastValue = yield* evalExpr(stmt.expr, env);
      } else if (
        stmt._tag === "TypeDecl" ||
        stmt._tag === "Mutation" ||
        stmt._tag === "Import" ||
        stmt._tag === "Export"
      ) {
        env = yield* evalStmt(stmt, env);
        lastValue = Unit();
      }
    }

    return lastValue;
  });
