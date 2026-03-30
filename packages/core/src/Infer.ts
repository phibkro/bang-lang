import { Effect, HashMap, Match, Option } from "effect";
import type { Expr, Pattern, Program, Stmt, Type } from "./Ast.js";
import type { InferType } from "./InferType.js";
import { TApp, TArrow, TCon, TVar, tBool, tFloat, tInt, tString, tUnit } from "./InferType.js";
import type { TypeError } from "./TypeError.js";
import { UndefinedVariable, UnknownField } from "./TypeError.js";
import type { Substitution } from "./Unify.js";
import { apply, unify } from "./Unify.js";

// ---------------------------------------------------------------------------
// Scheme & TypeEnv
// ---------------------------------------------------------------------------

interface Scheme {
  readonly vars: ReadonlyArray<number>;
  readonly type: InferType;
}

type TypeEnv = HashMap.HashMap<string, Scheme>;

type FieldInfo = HashMap.HashMap<string, ReadonlyArray<{ name: string; type: InferType }>>;

// ---------------------------------------------------------------------------
// Fresh variable counter (pragmatic mutable — per codebase style)
// ---------------------------------------------------------------------------

let nextId = 0;

const freshVar = (): TVar => {
  const v = new TVar({ id: nextId });
  nextId++;
  return v;
};

const resetFreshCounter = (): void => {
  nextId = 0;
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface InferResult {
  readonly type: InferType;
  readonly subst: Substitution;
}

interface StmtResult {
  readonly env: TypeEnv;
  readonly subst: Substitution;
  readonly fields: FieldInfo;
}

interface PatternResult {
  readonly type: InferType;
  readonly env: TypeEnv;
}

// ---------------------------------------------------------------------------
// Free type variables
// ---------------------------------------------------------------------------

const freeVars = (t: InferType): Set<number> => {
  switch (t._tag) {
    case "TVar": return new Set([t.id]);
    case "TCon": return new Set();
    case "TArrow": {
      const s = freeVars(t.param);
      for (const v of freeVars(t.result)) s.add(v);
      return s;
    }
    case "TApp": {
      const s = freeVars(t.ctor);
      for (const v of freeVars(t.arg)) s.add(v);
      return s;
    }
  }
};

const freeVarsEnv = (env: TypeEnv): Set<number> => {
  const result = new Set<number>();
  for (const [, scheme] of env) {
    const bound = new Set(scheme.vars);
    for (const v of freeVars(scheme.type)) {
      if (!bound.has(v)) result.add(v);
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// Instantiate & Generalize
// ---------------------------------------------------------------------------

const instantiate = (scheme: Scheme): InferType => {
  if (scheme.vars.length === 0) return scheme.type;
  let subst: HashMap.HashMap<number, InferType> = HashMap.empty();
  for (const v of scheme.vars) {
    subst = HashMap.set(subst, v, freshVar());
  }
  return applySchemeSubst(subst, scheme.type);
};

const applySchemeSubst = (
  subst: HashMap.HashMap<number, InferType>,
  t: InferType,
): InferType => {
  switch (t._tag) {
    case "TVar": {
      const resolved = HashMap.get(subst, t.id);
      return Option.isSome(resolved) ? resolved.value : t;
    }
    case "TCon": return t;
    case "TArrow":
      return new TArrow({
        param: applySchemeSubst(subst, t.param),
        result: applySchemeSubst(subst, t.result),
      });
    case "TApp":
      return new TApp({
        ctor: applySchemeSubst(subst, t.ctor),
        arg: applySchemeSubst(subst, t.arg),
      });
  }
};

const generalize = (env: TypeEnv, type: InferType, subst: Substitution): Scheme => {
  const resolved = apply(subst, type);
  const envFree = freeVarsEnv(env);
  const typeFree = freeVars(resolved);
  const vars: Array<number> = [];
  for (const v of typeFree) {
    if (!envFree.has(v)) vars.push(v);
  }
  return { vars, type: resolved };
};

// ---------------------------------------------------------------------------
// AST Type → InferType
// ---------------------------------------------------------------------------

// Deterministic type variable IDs from names (negative range to avoid collision with fresh vars)
const typeVarNameMap = new Map<string, number>();
let typeVarNextId = -1;

const typeVarId = (name: string): number => {
  const existing = typeVarNameMap.get(name);
  if (existing !== undefined) return existing;
  const id = typeVarNextId;
  typeVarNextId--;
  typeVarNameMap.set(name, id);
  return id;
};

const resetTypeVarMap = (): void => {
  typeVarNameMap.clear();
  typeVarNextId = -1;
};

const astTypeToInfer = (t: Type): InferType =>
  Match.value(t).pipe(
    Match.tag("ConcreteType", (c) => {
      const first = c.name[0];
      if (first !== undefined && first === first.toLowerCase() && first !== first.toUpperCase()) {
        return new TVar({ id: typeVarId(c.name) });
      }
      return new TCon({ name: c.name });
    }),
    Match.tag("ArrowType", (a) =>
      new TArrow({ param: astTypeToInfer(a.param), result: astTypeToInfer(a.result) }),
    ),
    Match.tag("EffectType", (e) =>
      astTypeToInfer(e.value),
    ),
    Match.exhaustive,
  );

// Convert AST Type to InferType, using existing param TVars for type params
const astTypeToInferWithParams = (
  t: Type,
  paramVars: ReadonlyArray<readonly [string, TVar]>,
): InferType =>
  Match.value(t).pipe(
    Match.tag("ConcreteType", (c) => {
      const found = paramVars.find(([name]) => name === c.name);
      if (found !== undefined) return found[1];
      const first = c.name[0];
      if (first !== undefined && first === first.toLowerCase() && first !== first.toUpperCase()) {
        return new TVar({ id: typeVarId(c.name) });
      }
      return new TCon({ name: c.name });
    }),
    Match.tag("ArrowType", (a) =>
      new TArrow({
        param: astTypeToInferWithParams(a.param, paramVars),
        result: astTypeToInferWithParams(a.result, paramVars),
      }),
    ),
    Match.tag("EffectType", (e) =>
      astTypeToInferWithParams(e.value, paramVars),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Infer expressions
// ---------------------------------------------------------------------------

const infer = (
  expr: Expr,
  env: TypeEnv,
  subst: Substitution,
  fields: FieldInfo,
): Effect.Effect<InferResult, TypeError> =>
  Match.value(expr).pipe(
    Match.tag("IntLiteral", () =>
      Effect.succeed({ type: tInt, subst } as InferResult)),
    Match.tag("FloatLiteral", () =>
      Effect.succeed({ type: tFloat, subst } as InferResult)),
    Match.tag("StringLiteral", () =>
      Effect.succeed({ type: tString, subst } as InferResult)),
    Match.tag("BoolLiteral", () =>
      Effect.succeed({ type: tBool, subst } as InferResult)),
    Match.tag("UnitLiteral", () =>
      Effect.succeed({ type: tUnit, subst } as InferResult)),

    Match.tag("Ident", (e) =>
      Effect.gen(function* () {
        const scheme = HashMap.get(env, e.name);
        if (Option.isNone(scheme)) {
          return yield* Effect.fail(new UndefinedVariable({ name: e.name, span: e.span }));
        }
        return { type: instantiate(scheme.value), subst } as InferResult;
      }),
    ),

    Match.tag("Lambda", (e) =>
      Effect.gen(function* () {
        const paramVars: Array<TVar> = [];
        let innerEnv = env;
        for (const p of e.params) {
          const tv = freshVar();
          paramVars.push(tv);
          innerEnv = HashMap.set(innerEnv, p, { vars: [], type: tv } as Scheme);
        }
        const bodyResult = yield* infer(e.body, innerEnv, subst, fields);
        // Build curried arrow right-to-left
        let resultType: InferType = bodyResult.type;
        for (let i = paramVars.length - 1; i >= 0; i--) {
          resultType = new TArrow({
            param: apply(bodyResult.subst, paramVars[i] as TVar),
            result: resultType,
          });
        }
        return { type: resultType, subst: bodyResult.subst } as InferResult;
      }),
    ),

    Match.tag("App", (e) =>
      Effect.gen(function* () {
        const funcResult = yield* infer(e.func, env, subst, fields);
        let currentSubst = funcResult.subst;
        let funcType = funcResult.type;

        for (const arg of e.args) {
          const argResult = yield* infer(arg, env, currentSubst, fields);
          currentSubst = argResult.subst;
          const resultVar = freshVar();
          currentSubst = yield* unify(
            apply(currentSubst, funcType),
            new TArrow({ param: argResult.type, result: resultVar }),
            currentSubst,
            e.span,
          );
          funcType = resultVar;
        }
        return { type: apply(currentSubst, funcType), subst: currentSubst } as InferResult;
      }),
    ),

    Match.tag("BinaryExpr", (e) =>
      Effect.gen(function* () {
        const leftResult = yield* infer(e.left, env, subst, fields);
        const rightResult = yield* infer(e.right, env, leftResult.subst, fields);
        let s = rightResult.subst;

        const op = e.op;

        if (op === "++") {
          s = yield* unify(leftResult.type, tString, s, e.span);
          s = yield* unify(rightResult.type, tString, s, e.span);
          return { type: tString, subst: s } as InferResult;
        }

        if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
          s = yield* unify(leftResult.type, rightResult.type, s, e.span);
          return { type: apply(s, leftResult.type), subst: s } as InferResult;
        }

        if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
          s = yield* unify(leftResult.type, rightResult.type, s, e.span);
          return { type: tBool, subst: s } as InferResult;
        }

        if (op === "and" || op === "or" || op === "xor") {
          s = yield* unify(leftResult.type, tBool, s, e.span);
          s = yield* unify(rightResult.type, tBool, s, e.span);
          return { type: tBool, subst: s } as InferResult;
        }

        if (op === "<-") {
          return { type: apply(s, rightResult.type), subst: s } as InferResult;
        }

        // Fallback
        s = yield* unify(leftResult.type, rightResult.type, s, e.span);
        return { type: apply(s, leftResult.type), subst: s } as InferResult;
      }),
    ),

    Match.tag("UnaryExpr", (e) =>
      Effect.gen(function* () {
        const inner = yield* infer(e.expr, env, subst, fields);
        if (e.op === "not") {
          const s = yield* unify(inner.type, tBool, inner.subst, e.span);
          return { type: tBool, subst: s } as InferResult;
        }
        return inner;
      }),
    ),

    Match.tag("Block", (e) =>
      Effect.gen(function* () {
        let currentEnv = env;
        let currentSubst = subst;
        let currentFields = fields;
        for (const stmt of e.statements) {
          const stmtResult = yield* inferStmt(stmt, currentEnv, currentSubst, currentFields);
          currentEnv = stmtResult.env;
          currentSubst = stmtResult.subst;
          currentFields = stmtResult.fields;
        }
        return yield* infer(e.expr, currentEnv, currentSubst, currentFields);
      }),
    ),

    Match.tag("Force", (e) =>
      infer(e.expr, env, subst, fields),
    ),

    Match.tag("ComptimeExpr", (e) =>
      infer(e.expr, env, subst, fields),
    ),

    Match.tag("MatchExpr", (e) =>
      Effect.gen(function* () {
        const scrutResult = yield* infer(e.scrutinee, env, subst, fields);
        let currentSubst = scrutResult.subst;
        const resultVar = freshVar();

        for (const arm of e.arms) {
          const patResult = yield* inferPattern(arm.pattern, env);
          currentSubst = yield* unify(patResult.type, scrutResult.type, currentSubst, arm.span);

          let armEnv = env;
          for (const [name, scheme] of patResult.env) {
            armEnv = HashMap.set(armEnv, name, scheme);
          }

          if (Option.isSome(arm.guard)) {
            const guardResult = yield* infer(arm.guard.value, armEnv, currentSubst, fields);
            currentSubst = yield* unify(guardResult.type, tBool, guardResult.subst, arm.span);
          }

          const bodyResult = yield* infer(arm.body, armEnv, currentSubst, fields);
          currentSubst = yield* unify(bodyResult.type, resultVar, bodyResult.subst, arm.span);
        }

        return { type: apply(currentSubst, resultVar), subst: currentSubst } as InferResult;
      }),
    ),

    Match.tag("StringInterp", (e) =>
      Effect.gen(function* () {
        let currentSubst = subst;
        for (const part of e.parts) {
          if (part._tag === "InterpExpr") {
            const r = yield* infer(part.value, env, currentSubst, fields);
            currentSubst = r.subst;
          }
        }
        return { type: tString, subst: currentSubst } as InferResult;
      }),
    ),

    Match.tag("UseExpr", (e) =>
      infer(e.value, env, subst, fields),
    ),

    Match.tag("OnExpr", (e) =>
      Effect.gen(function* () {
        const sourceResult = yield* infer(e.source, env, subst, fields);
        const handlerResult = yield* infer(e.handler, env, sourceResult.subst, fields);
        return {
          type: new TCon({ name: "Subscription" }),
          subst: handlerResult.subst,
        } as InferResult;
      }),
    ),

    Match.tag("DotAccess", (e) =>
      Effect.gen(function* () {
        const objResult = yield* infer(e.object, env, subst, fields);
        const resolvedObjType = apply(objResult.subst, objResult.type);

        // Check if it's a record field access
        if (resolvedObjType._tag === "TCon") {
          const fieldDefs = HashMap.get(fields, resolvedObjType.name);
          if (Option.isSome(fieldDefs)) {
            const field = fieldDefs.value.find((f) => f.name === e.field);
            if (field !== undefined) {
              return { type: field.type, subst: objResult.subst } as InferResult;
            }
          }
        }

        if (resolvedObjType._tag === "TApp") {
          const baseName = getBaseCtorName(resolvedObjType);
          if (baseName !== undefined) {
            const fieldDefs = HashMap.get(fields, baseName);
            if (Option.isSome(fieldDefs)) {
              const field = fieldDefs.value.find((f) => f.name === e.field);
              if (field !== undefined) {
                return { type: field.type, subst: objResult.subst } as InferResult;
              }
            }
          }
        }

        // Known dot methods — return fresh type variable
        const dotMethods = new Set(["map", "handle", "catch", "tap", "match", "abort", "unwrap"]);
        if (dotMethods.has(e.field)) {
          return { type: freshVar(), subst: objResult.subst } as InferResult;
        }

        return yield* Effect.fail(
          new UnknownField({ type: resolvedObjType, field: e.field, span: e.span }),
        );
      }),
    ),

    Match.exhaustive,
  );

const getBaseCtorName = (t: InferType): string | undefined => {
  if (t._tag === "TCon") return t.name;
  if (t._tag === "TApp") return getBaseCtorName(t.ctor);
  return undefined;
};

// ---------------------------------------------------------------------------
// Infer patterns
// ---------------------------------------------------------------------------

const inferPattern = (
  pattern: Pattern,
  env: TypeEnv,
): Effect.Effect<PatternResult, TypeError> =>
  Match.value(pattern).pipe(
    Match.tag("WildcardPattern", () =>
      Effect.succeed({
        type: freshVar(),
        env: HashMap.empty<string, Scheme>(),
      } as PatternResult),
    ),

    Match.tag("BindingPattern", (p) => {
      const tv = freshVar();
      return Effect.succeed({
        type: tv,
        env: HashMap.make([p.name, { vars: [], type: tv } as Scheme]),
      } as PatternResult);
    }),

    Match.tag("ConstructorPattern", (p) =>
      Effect.gen(function* () {
        const scheme = HashMap.get(env, p.tag);
        if (Option.isNone(scheme)) {
          return yield* Effect.fail(
            new UndefinedVariable({ name: p.tag, span: p.span }),
          );
        }
        const ctorType = instantiate(scheme.value);

        // Decompose curried arrow to get parameter types
        let current = ctorType;
        const paramTypes: Array<InferType> = [];
        while (current._tag === "TArrow" && paramTypes.length < p.patterns.length) {
          paramTypes.push(current.param);
          current = current.result;
        }

        let bindings: TypeEnv = HashMap.empty();
        for (let i = 0; i < p.patterns.length; i++) {
          const subPat = p.patterns[i] as Pattern;
          const subResult = yield* inferPattern(subPat, env);
          // Bind sub-pattern names to the constructor's field type (not the unconstrained fresh var)
          const fieldType = i < paramTypes.length ? paramTypes[i] as InferType : subResult.type;
          for (const [name] of subResult.env) {
            bindings = HashMap.set(bindings, name, { vars: [], type: fieldType } as Scheme);
          }
        }

        return { type: current, env: bindings } as PatternResult;
      }),
    ),

    Match.tag("LiteralPattern", (p) =>
      Effect.gen(function* () {
        const result = yield* infer(
          p.value,
          env,
          HashMap.empty() as Substitution,
          HashMap.empty() as FieldInfo,
        );
        return {
          type: result.type,
          env: HashMap.empty<string, Scheme>(),
        } as PatternResult;
      }),
    ),

    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Infer statements
// ---------------------------------------------------------------------------

const inferStmt = (
  stmt: Stmt,
  env: TypeEnv,
  subst: Substitution,
  fields: FieldInfo,
): Effect.Effect<StmtResult, TypeError> =>
  Match.value(stmt).pipe(
    Match.tag("Declaration", (s) =>
      Effect.gen(function* () {
        const valResult = yield* infer(s.value, env, subst, fields);
        let currentSubst = valResult.subst;
        let inferredType = valResult.type;

        if (Option.isSome(s.typeAnnotation)) {
          const annType = astTypeToInfer(s.typeAnnotation.value);
          currentSubst = yield* unify(inferredType, annType, currentSubst, s.span);
          inferredType = annType;
        }

        const scheme = generalize(env, inferredType, currentSubst);
        return {
          env: HashMap.set(env, s.name, scheme),
          subst: currentSubst,
          fields,
        } as StmtResult;
      }),
    ),

    Match.tag("Declare", (s) => {
      const inferType = astTypeToInfer(s.typeAnnotation);
      const fv = freeVars(inferType);
      const scheme: Scheme = { vars: [...fv], type: inferType };
      return Effect.succeed({
        env: HashMap.set(env, s.name, scheme),
        subst,
        fields,
      } as StmtResult);
    }),

    Match.tag("ForceStatement", (s) =>
      Effect.gen(function* () {
        // Special case: Force(UseExpr) — bind the name
        if (s.expr._tag === "Force" && s.expr.expr._tag === "UseExpr") {
          const useExpr = s.expr.expr;
          const valResult = yield* infer(useExpr.value, env, subst, fields);
          const scheme = generalize(env, valResult.type, valResult.subst);
          return {
            env: HashMap.set(env, useExpr.name, scheme),
            subst: valResult.subst,
            fields,
          } as StmtResult;
        }

        if (s.expr._tag === "UseExpr") {
          const useExpr = s.expr;
          const valResult = yield* infer(useExpr.value, env, subst, fields);
          const scheme = generalize(env, valResult.type, valResult.subst);
          return {
            env: HashMap.set(env, useExpr.name, scheme),
            subst: valResult.subst,
            fields,
          } as StmtResult;
        }

        const result = yield* infer(s.expr, env, subst, fields);
        return { env, subst: result.subst, fields } as StmtResult;
      }),
    ),

    Match.tag("ExprStatement", (s) =>
      Effect.gen(function* () {
        const result = yield* infer(s.expr, env, subst, fields);
        return { env, subst: result.subst, fields } as StmtResult;
      }),
    ),

    Match.tag("TypeDecl", (s) =>
      Effect.gen(function* () {
        const paramVars: Array<[string, TVar]> = [];
        for (const p of s.typeParams) {
          const tv = freshVar();
          paramVars.push([p, tv]);
        }

        // Build result type: TypeName a b → TApp(TApp(TCon(TypeName), a), b)
        let resultType: InferType = new TCon({ name: s.name });
        for (const [, tv] of paramVars) {
          resultType = new TApp({ ctor: resultType, arg: tv });
        }

        let currentEnv = env;
        let currentFields = fields;

        for (const ctor of s.constructors) {
          if (ctor._tag === "NullaryConstructor") {
            const scheme: Scheme = {
              vars: paramVars.map(([, tv]) => tv.id),
              type: resultType,
            };
            currentEnv = HashMap.set(currentEnv, ctor.tag, scheme);
          } else if (ctor._tag === "PositionalConstructor") {
            let ctorType: InferType = resultType;
            for (let i = ctor.fields.length - 1; i >= 0; i--) {
              const fieldType = astTypeToInferWithParams(ctor.fields[i] as Type, paramVars);
              ctorType = new TArrow({ param: fieldType, result: ctorType });
            }
            const scheme: Scheme = {
              vars: paramVars.map(([, tv]) => tv.id),
              type: ctorType,
            };
            currentEnv = HashMap.set(currentEnv, ctor.tag, scheme);
          } else {
            // NamedConstructor
            const fieldMeta: Array<{ name: string; type: InferType }> = [];
            let ctorType: InferType = resultType;
            for (let i = ctor.fields.length - 1; i >= 0; i--) {
              const f = ctor.fields[i] as { name: string; type: Type };
              const fieldType = astTypeToInferWithParams(f.type, paramVars);
              fieldMeta.unshift({ name: f.name, type: fieldType });
              ctorType = new TArrow({ param: fieldType, result: ctorType });
            }
            const scheme: Scheme = {
              vars: paramVars.map(([, tv]) => tv.id),
              type: ctorType,
            };
            currentEnv = HashMap.set(currentEnv, ctor.tag, scheme);
            currentFields = HashMap.set(currentFields, s.name, fieldMeta);
          }
        }

        return { env: currentEnv, subst, fields: currentFields } as StmtResult;
      }),
    ),

    Match.tag("NewtypeDecl", (s) => {
      const wrappedType = astTypeToInfer(s.wrappedType);
      const newType = new TCon({ name: s.name });
      const ctorType = new TArrow({ param: wrappedType, result: newType });
      const fv = freeVars(ctorType);
      const scheme: Scheme = { vars: [...fv], type: ctorType };
      return Effect.succeed({
        env: HashMap.set(env, s.name, scheme),
        subst,
        fields,
      } as StmtResult);
    }),

    Match.tag("RecordTypeDecl", (s) => {
      const resultType = new TCon({ name: s.name });
      const fieldMeta: Array<{ name: string; type: InferType }> = [];
      let ctorType: InferType = resultType;
      for (let i = s.fields.length - 1; i >= 0; i--) {
        const f = s.fields[i] as { name: string; type: Type };
        const fieldType = astTypeToInfer(f.type);
        fieldMeta.unshift({ name: f.name, type: fieldType });
        ctorType = new TArrow({ param: fieldType, result: ctorType });
      }
      const fv = freeVars(ctorType);
      const scheme: Scheme = { vars: [...fv], type: ctorType };
      return Effect.succeed({
        env: HashMap.set(env, s.name, scheme),
        subst,
        fields: HashMap.set(fields, s.name, fieldMeta),
      } as StmtResult);
    }),

    Match.tag("Import", (s) => {
      let currentEnv = env;
      for (const name of s.names) {
        currentEnv = HashMap.set(currentEnv, name, { vars: [], type: freshVar() } as Scheme);
      }
      return Effect.succeed({ env: currentEnv, subst, fields } as StmtResult);
    }),

    Match.tag("Export", () =>
      Effect.succeed({ env, subst, fields } as StmtResult),
    ),

    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface ProgramResult {
  readonly type: InferType;
  readonly subst: Substitution;
  readonly env: TypeEnv;
}

export const inferProgram = (
  program: Program,
): Effect.Effect<ProgramResult, TypeError> =>
  Effect.gen(function* () {
    resetFreshCounter();
    resetTypeVarMap();

    let currentEnv: TypeEnv = HashMap.empty();
    let currentSubst: Substitution = HashMap.empty();
    let currentFields: FieldInfo = HashMap.empty();
    let lastType: InferType = tUnit;

    for (const stmt of program.statements) {
      const stmtResult = yield* inferStmt(stmt, currentEnv, currentSubst, currentFields);
      currentEnv = stmtResult.env;
      currentSubst = stmtResult.subst;
      currentFields = stmtResult.fields;

      // Track the type of the last declaration for the return value
      if (stmt._tag === "Declaration") {
        const scheme = HashMap.get(currentEnv, stmt.name);
        if (Option.isSome(scheme)) {
          lastType = apply(currentSubst, instantiate(scheme.value));
        }
      } else if (stmt._tag === "ExprStatement") {
        const r = yield* infer(stmt.expr, currentEnv, currentSubst, currentFields);
        lastType = apply(r.subst, r.type);
      } else if (stmt._tag === "ForceStatement") {
        if (stmt.expr._tag === "Force" && stmt.expr.expr._tag === "UseExpr") {
          const scheme = HashMap.get(currentEnv, stmt.expr.expr.name);
          if (Option.isSome(scheme)) {
            lastType = apply(currentSubst, instantiate(scheme.value));
          }
        } else if (stmt.expr._tag === "UseExpr") {
          const scheme = HashMap.get(currentEnv, stmt.expr.name);
          if (Option.isSome(scheme)) {
            lastType = apply(currentSubst, instantiate(scheme.value));
          }
        }
      }
    }

    return { type: lastType, subst: currentSubst, env: currentEnv } as ProgramResult;
  });
