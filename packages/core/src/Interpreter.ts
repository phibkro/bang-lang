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

const buildDottedName = (expr: Ast.Expr): Option.Option<string> =>
  Match.value(expr).pipe(
    Match.tag("Ident", (e) => Option.some(e.name)),
    Match.tag("DotAccess", (e) =>
      Option.map(buildDottedName(e.object), (obj) => `${obj}.${e.field}`),
    ),
    Match.orElse(() => Option.none()),
  );

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
        if (e.op === "<-") {
          // Do NOT evaluate left side through evalExpr (would unwrap MutCell)
          if (e.left._tag !== "Ident") {
            return yield* Effect.fail(
              new EvalError({ message: "Left side of <- must be an identifier", span: e.span }),
            );
          }
          const cell = HashMap.get(env, e.left.name);
          if (Option.isNone(cell) || cell.value._tag !== "MutCell") {
            return yield* Effect.fail(
              new EvalError({
                message: `Cannot mutate non-mutable binding: ${e.left.name}`,
                span: e.span,
              }),
            );
          }
          const newValue = yield* evalExpr(e.right, env);
          cell.value.ref.value = newValue;
          // Fire subscribers
          for (const sub of cell.value.ref.subscribers) {
            yield* sub(newValue);
          }
          return newValue;
        }
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
      Effect.gen(function* () {
        // Try dotted name lookup in env (e.g. Console.log)
        const dottedName = buildDottedName(e);
        if (Option.isSome(dottedName)) {
          const found = HashMap.get(env, dottedName.value);
          if (Option.isSome(found)) {
            return found.value._tag === "MutCell" ? found.value.ref.value : found.value;
          }
        }
        // Evaluate object and try field access on Tagged values
        const obj = yield* evalExpr(e.object, env);
        if (obj._tag === "Tagged" && obj.fields.length > 0 && e.field === "unwrap") {
          return obj.fields[0];
        }
        return yield* Effect.fail(
          new EvalError({
            message: `Field access .${e.field} not supported on ${obj._tag}`,
            span: e.span,
          }),
        );
      }),
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
        // Detect dot-method patterns: App(DotAccess(obj, method), args)
        if (e.func._tag === "DotAccess") {
          const method = e.func.field;

          if (method === "map" && e.args.length === 1) {
            const obj = yield* evalExpr(e.func.object, env);
            const f = yield* evalExpr(e.args[0], env);
            return yield* applyValue(f, [obj], e.span);
          }

          if (method === "tap" && e.args.length === 1) {
            const obj = yield* evalExpr(e.func.object, env);
            const f = yield* evalExpr(e.args[0], env);
            yield* applyValue(f, [obj], e.span);
            return obj;
          }

          if (method === "handle" && e.args.length === 2) {
            const typeName = e.args[0]._tag === "Ident" ? e.args[0].name : "";
            const impl = yield* evalExpr(e.args[1], env);
            const handledEnv = HashMap.set(env, typeName, impl);
            return yield* evalExpr(e.func.object, handledEnv);
          }

          if (method === "catch" && e.args.length >= 1) {
            const errorTag = e.args[0]._tag === "Ident" ? e.args[0].name : "";
            const handler =
              e.args.length > 1
                ? yield* evalExpr(e.args[1], env)
                : Closure({ params: ["_"], body: e.args[0], env });
            return yield* Effect.catchAll(evalExpr(e.func.object, env), (err) => {
              if (err instanceof EvalError && err.message.includes(errorTag)) {
                return applyValue(handler, [Str({ value: err.message })], e.span);
              }
              return Effect.fail(err);
            });
          }

          // Not a known dot method — fall through to normal application
        }

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
            // Check guard if present
            if (Option.isSome(arm.guard)) {
              const guardVal = yield* evalExpr(arm.guard.value, result.value);
              if (guardVal._tag !== "Bool" || !guardVal.value) {
                continue; // guard failed, try next arm
              }
            }
            return yield* evalExpr(arm.body, result.value);
          }
        }
        return yield* Effect.fail(
          new EvalError({ message: "Non-exhaustive match: no arm matched", span: e.span }),
        );
      }),
    ),
    Match.tag("ComptimeExpr", (e) => evalExpr(e.expr, env)),
    Match.tag("UseExpr", (e) => evalExpr(e.value, env)),
    Match.tag("OnExpr", (e) =>
      Effect.gen(function* () {
        // Source must resolve to a MutCell
        const sourceName = e.source._tag === "Ident" ? e.source.name : "";
        const sourceCell = HashMap.get(env, sourceName);
        if (Option.isNone(sourceCell) || sourceCell.value._tag !== "MutCell") {
          return yield* Effect.fail(
            new EvalError({ message: "on requires a mut binding", span: e.span }),
          );
        }
        // Evaluate handler (should be a Closure)
        const handler = yield* evalExpr(e.handler, env);
        // Register subscriber
        const sub = (newValue: Value) => applyValue(handler, [newValue], e.span).pipe(Effect.asVoid);
        sourceCell.value.ref.subscribers.push(sub);
        // Return Unit (subscription is a side effect)
        return Unit();
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
          return HashMap.set(env, s.name, MutCell({ ref: { value, subscribers: [] } }));
        }
        return HashMap.set(env, s.name, value);
      }),
    ),
    Match.tag("Declare", () => Effect.succeed(env)),
    Match.tag("ForceStatement", (s) =>
      Effect.gen(function* () {
        // !use x = val → evaluate val, bind result to x
        if (s.expr._tag === "Force" && s.expr.expr._tag === "UseExpr") {
          const useExpr = s.expr.expr;
          const value = yield* evalExpr(useExpr.value, env);
          return HashMap.set(env, useExpr.name, value);
        }
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
    Match.tag("NewtypeDecl", (s) =>
      Effect.succeed(HashMap.set(env, s.name, Constructor({ tag: s.name, arity: 1, applied: [] }))),
    ),
    Match.tag("Import", () => Effect.succeed(env)),
    Match.tag("Export", () => Effect.succeed(env)),
    Match.exhaustive,
  );

const applyValue = (
  func: Value,
  args: Value[],
  span: Span.Span,
): Effect.Effect<Value, EvalError> => {
  if (func._tag === "Closure") return applyClosure(func, args, span);
  if (func._tag === "Constructor") {
    const allApplied = [...func.applied, ...args];
    if (allApplied.length >= func.arity) {
      return Effect.succeed(Tagged({ tag: func.tag, fields: allApplied }));
    }
    return Effect.succeed(Constructor({ tag: func.tag, arity: func.arity, applied: allApplied }));
  }
  return Effect.fail(new EvalError({ message: "Cannot apply non-function", span }));
};

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
          env = HashMap.set(env, stmt.name, MutCell({ ref: { value: val, subscribers: [] } }));
        } else {
          env = HashMap.set(env, stmt.name, val);
        }
        lastValue = val;
      } else if (stmt._tag === "Declare") {
        lastValue = Unit();
      } else if (stmt._tag === "ForceStatement") {
        // !use x = val at program level → evaluate val, bind to x
        if (stmt.expr._tag === "Force" && stmt.expr.expr._tag === "UseExpr") {
          const useExpr = stmt.expr.expr;
          const value = yield* evalExpr(useExpr.value, env);
          env = HashMap.set(env, useExpr.name, value);
          lastValue = value;
        } else {
          lastValue = yield* evalExpr(stmt.expr, env);
        }
      } else if (stmt._tag === "ExprStatement") {
        lastValue = yield* evalExpr(stmt.expr, env);
      } else if (
        stmt._tag === "TypeDecl" ||
        stmt._tag === "NewtypeDecl" ||
        stmt._tag === "Import" ||
        stmt._tag === "Export"
      ) {
        env = yield* evalStmt(stmt, env);
        lastValue = Unit();
      }
    }

    return lastValue;
  });
