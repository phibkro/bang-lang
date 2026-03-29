import { Array as Arr, Effect, HashMap, Match, Option } from "effect";
import * as Ast from "@bang/core/Ast";
import type { CompilerError } from "@bang/core/CompilerError";
import { CheckError } from "@bang/core/CompilerError";
import * as Span from "@bang/core/Span";
import type * as TypedAst from "./TypedAst.js";
import { annotate } from "./TypedAst.js";

// ---------------------------------------------------------------------------
// Scope (internal — plain interface is fine)
// ---------------------------------------------------------------------------

interface ScopeEntry {
  readonly name: string;
  readonly type: Option.Option<Ast.Type>;
  readonly effectClass: "signal" | "effect";
  readonly mutable: boolean;
}

type Scope = HashMap.HashMap<string, ScopeEntry>;

// ---------------------------------------------------------------------------
// Helpers (pure, use Match.tag for dispatch)
// ---------------------------------------------------------------------------

const buildDottedName = (expr: Ast.Expr): Option.Option<string> =>
  Match.value(expr).pipe(
    Match.tag("Ident", (e) => Option.some(e.name)),
    Match.tag("DotAccess", (e) =>
      Option.map(buildDottedName(e.object), (obj) => `${obj}.${e.field}`),
    ),
    Match.orElse(() => Option.none()),
  );

const resolveCallableName = (expr: Ast.Expr): Option.Option<string> =>
  Match.value(expr).pipe(
    Match.tag("Ident", (e) => Option.some(e.name)),
    Match.tag("DotAccess", (e) => buildDottedName(e)),
    Match.tag("App", (e) => resolveCallableName(e.func)),
    Match.tag("Force", (e) => resolveCallableName(e.expr)),
    Match.orElse(() => Option.none()),
  );

const returnsEffect = (type: Ast.Type): boolean =>
  Match.value(type).pipe(
    Match.tag("EffectType", () => true),
    Match.tag("ArrowType", (t) => returnsEffect(t.result)),
    Match.orElse(() => false),
  );

const finalReturnType = (type: Ast.Type): Ast.Type =>
  Match.value(type).pipe(
    Match.tag("ArrowType", (t) => finalReturnType(t.result)),
    Match.orElse(() => type),
  );

const unknownType: Ast.ConcreteType = new Ast.ConcreteType({
  name: "Unknown",
  span: Span.empty,
});

// ---------------------------------------------------------------------------
// Scope lookup helpers
// ---------------------------------------------------------------------------

const lookupScope = (scope: Scope, name: string): Option.Option<ScopeEntry> =>
  HashMap.get(scope, name);

const lookupByExpr = (scope: Scope, expr: Ast.Expr): Option.Option<ScopeEntry> =>
  Option.flatMap(resolveCallableName(expr), (name) => lookupScope(scope, name));

// ---------------------------------------------------------------------------
// Build scope from statements (first pass)
// ---------------------------------------------------------------------------

const buildScope = (statements: ReadonlyArray<Ast.Stmt>, scope: Scope): Scope =>
  Arr.reduce(statements, scope, (acc, stmt) =>
    Match.value(stmt).pipe(
      Match.tag("Declare", (s) =>
        HashMap.set(acc, s.name, {
          name: s.name,
          type: Option.some(s.typeAnnotation),
          effectClass: returnsEffect(s.typeAnnotation) ? ("effect" as const) : ("signal" as const),
          mutable: false,
        }),
      ),
      Match.tag("Declaration", (s) =>
        HashMap.set(acc, s.name, {
          name: s.name,
          type: s.typeAnnotation,
          effectClass: classifyExpr(s.value, acc),
          mutable: s.mutable,
        }),
      ),
      Match.tag("TypeDecl", (s) =>
        Arr.reduce(s.constructors, acc, (scope, ctor) => {
          const ctorTag = ctor.tag;
          return HashMap.set(scope, ctorTag, {
            name: ctorTag,
            type: Option.none(),
            effectClass: "signal" as const,
            mutable: false,
          });
        }),
      ),
      Match.tag("NewtypeDecl", (s) =>
        HashMap.set(acc, s.name, {
          name: s.name,
          type: Option.none(),
          effectClass: "signal" as const,
          mutable: false,
        }),
      ),
      Match.tag("RecordTypeDecl", (s) =>
        HashMap.set(acc, s.name, {
          name: s.name,
          type: Option.none(),
          effectClass: "signal" as const,
          mutable: false,
        }),
      ),
      Match.tag("Import", (s) =>
        Arr.reduce(s.names, acc, (scope, name) =>
          HashMap.set(scope, name, {
            name,
            type: Option.none(),
            effectClass: "signal" as const,
            mutable: false,
          }),
        ),
      ),
      Match.tag("ForceStatement", (s) => {
        // !use x = val introduces x into scope
        if (s.expr._tag === "Force" && s.expr.expr._tag === "UseExpr") {
          const useName = s.expr.expr.name;
          return HashMap.set(acc, useName, {
            name: useName,
            type: Option.none(),
            effectClass: "signal" as const,
            mutable: false,
          });
        }
        return acc;
      }),
      Match.orElse(() => acc),
    ),
  );

// ---------------------------------------------------------------------------
// Classify expression (pure)
// ---------------------------------------------------------------------------

const classifyExpr = (expr: Ast.Expr, scope: Scope): "signal" | "effect" =>
  Match.value(expr).pipe(
    Match.tag("StringLiteral", () => "signal" as const),
    Match.tag("IntLiteral", () => "signal" as const),
    Match.tag("BoolLiteral", () => "signal" as const),
    Match.tag("UnitLiteral", () => "signal" as const),
    Match.tag("Ident", (e) =>
      Option.match(lookupScope(scope, e.name), {
        onNone: () => "signal" as const,
        onSome: (entry) => entry.effectClass,
      }),
    ),
    Match.tag("DotAccess", (e) =>
      Option.match(buildDottedName(e), {
        onNone: () => "signal" as const,
        onSome: (name) =>
          Option.match(lookupScope(scope, name), {
            onNone: () => "signal" as const,
            onSome: (entry) => entry.effectClass,
          }),
      }),
    ),
    Match.tag("App", (e) =>
      Option.match(lookupByExpr(scope, e.func), {
        onNone: () => "signal" as const,
        onSome: (entry) => entry.effectClass,
      }),
    ),
    Match.tag("Force", (e) => classifyExpr(e.expr, scope)),
    Match.tag("FloatLiteral", () => "signal" as const),
    Match.tag("BinaryExpr", (e) => {
      const l = classifyExpr(e.left, scope);
      const r = classifyExpr(e.right, scope);
      return l === "effect" || r === "effect" ? ("effect" as const) : ("signal" as const);
    }),
    Match.tag("UnaryExpr", (e) => classifyExpr(e.expr, scope)),
    Match.tag("Block", (e) => {
      const blockScope = buildScope(e.statements, scope);
      const stmtHasEffect = e.statements.some(
        (s) =>
          s._tag === "ForceStatement" ||
          (s._tag === "Declaration" && s.mutable) ||
          (s._tag === "Declaration" && classifyExpr(s.value, blockScope) === "effect"),
      );
      const exprClass = classifyExpr(e.expr, blockScope);
      return stmtHasEffect || exprClass === "effect" ? ("effect" as const) : ("signal" as const);
    }),
    Match.tag("Lambda", (e) => {
      // Create child scope with params bound as signal-typed
      const paramScope = Arr.reduce(e.params, scope, (acc, p) =>
        HashMap.set(acc, p, {
          name: p,
          type: Option.none(),
          effectClass: "signal" as const,
          mutable: false,
        }),
      );
      // Lambda itself is always signal (it's a value); classify body for internal use
      classifyExpr(e.body, paramScope);
      return "signal" as const;
    }),
    Match.tag("StringInterp", () => "signal" as const),
    Match.tag("MatchExpr", () => "signal" as const),
    Match.tag("ComptimeExpr", (e) => classifyExpr(e.expr, scope)),
    Match.tag("UseExpr", () => "effect" as const),
    Match.tag("OnExpr", () => "effect" as const),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Pattern binding (collects names introduced by a pattern into scope)
// ---------------------------------------------------------------------------

const bindPatternNames = (pat: Ast.Pattern, scope: Scope): Scope =>
  Match.value(pat).pipe(
    Match.tag("WildcardPattern", () => scope),
    Match.tag("BindingPattern", (p) =>
      HashMap.set(scope, p.name, {
        name: p.name,
        type: Option.none(),
        effectClass: "signal" as const,
        mutable: false,
      }),
    ),
    Match.tag("ConstructorPattern", (p) =>
      Arr.reduce(p.patterns, scope, (acc, sub) => bindPatternNames(sub, acc)),
    ),
    Match.tag("LiteralPattern", () => scope),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Validate scope (returns Effect to fail on undeclared identifiers)
// ---------------------------------------------------------------------------

const validateExprScope = (expr: Ast.Expr, scope: Scope): Effect.Effect<void, CompilerError> =>
  Match.value(expr).pipe(
    Match.tag("Ident", (e) =>
      HashMap.has(scope, e.name)
        ? Effect.void
        : Effect.fail(
            new CheckError({ message: `Undeclared identifier: ${e.name}`, span: e.span }),
          ),
    ),
    Match.tag("DotAccess", (e) =>
      Option.match(buildDottedName(e), {
        onNone: () => validateExprScope(e.object, scope),
        onSome: (name) =>
          HashMap.has(scope, name)
            ? Effect.void
            : Effect.fail(
                new CheckError({ message: `Undeclared identifier: ${name}`, span: e.span }),
              ),
      }),
    ),
    Match.tag("App", (e) =>
      Effect.flatMap(validateExprScope(e.func, scope), () =>
        Effect.forEach(e.args, (arg) => validateExprScope(arg, scope), { discard: true }),
      ),
    ),
    Match.tag("Force", (e) => validateExprScope(e.expr, scope)),
    Match.tag("StringLiteral", () => Effect.void),
    Match.tag("IntLiteral", () => Effect.void),
    Match.tag("FloatLiteral", () => Effect.void),
    Match.tag("BoolLiteral", () => Effect.void),
    Match.tag("UnitLiteral", () => Effect.void),
    Match.tag("BinaryExpr", (e) => {
      if (e.op === "<-") {
        // Mutation: verify left is Ident and is mutable in scope
        if (e.left._tag !== "Ident") {
          return Effect.fail(
            new CheckError({
              message: "Left side of <- must be an identifier",
              span: e.span,
            }),
          );
        }
        const entry = lookupScope(scope, e.left.name);
        if (Option.isNone(entry)) {
          return Effect.fail(
            new CheckError({
              message: `Undeclared identifier: ${e.left.name}`,
              span: e.span,
            }),
          );
        }
        if (!entry.value.mutable) {
          return Effect.fail(
            new CheckError({
              message: `Cannot mutate non-mutable binding: ${e.left.name}`,
              span: e.span,
            }),
          );
        }
        return validateExprScope(e.right, scope);
      }
      return Effect.flatMap(validateExprScope(e.left, scope), () =>
        validateExprScope(e.right, scope),
      );
    }),
    Match.tag("UnaryExpr", (e) => validateExprScope(e.expr, scope)),
    Match.tag("Block", (e) =>
      Effect.gen(function* () {
        const blockScope = buildScope(e.statements, scope);
        yield* Effect.forEach(e.statements, (stmt) => checkStmt(stmt, blockScope), {
          discard: true,
        });
        yield* validateExprScope(e.expr, blockScope);
      }),
    ),
    Match.tag("Lambda", (e) => {
      const paramScope = Arr.reduce(e.params, scope, (acc, p) =>
        HashMap.set(acc, p, {
          name: p,
          type: Option.none(),
          effectClass: "signal" as const,
          mutable: false,
        }),
      );
      return validateExprScope(e.body, paramScope);
    }),
    Match.tag("StringInterp", (e) =>
      Effect.forEach(
        e.parts,
        (part) => (part._tag === "InterpExpr" ? validateExprScope(part.value, scope) : Effect.void),
        { discard: true },
      ),
    ),
    Match.tag("MatchExpr", (e) =>
      Effect.gen(function* () {
        yield* validateExprScope(e.scrutinee, scope);
        for (const arm of e.arms) {
          const armScope = bindPatternNames(arm.pattern, scope);
          if (Option.isSome(arm.guard)) {
            yield* validateExprScope(arm.guard.value, armScope);
          }
          yield* validateExprScope(arm.body, armScope);
        }
      }),
    ),
    Match.tag("ComptimeExpr", (e) => validateExprScope(e.expr, scope)),
    Match.tag("UseExpr", (e) => validateExprScope(e.value, scope)),
    Match.tag("OnExpr", (e) =>
      Effect.flatMap(validateExprScope(e.source, scope), () => validateExprScope(e.handler, scope)),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Check statement (returns Effect<TypedStmt, CompilerError>)
// ---------------------------------------------------------------------------

const checkStmt = (
  stmt: Ast.Stmt,
  scope: Scope,
): Effect.Effect<TypedAst.TypedStmt, CompilerError> =>
  Match.value(stmt).pipe(
    Match.tag("Declare", (s) =>
      Effect.succeed(annotate(s, { type: s.typeAnnotation, effectClass: "signal" as const })),
    ),
    Match.tag("Declaration", (s) =>
      Effect.gen(function* () {
        yield* validateExprScope(s.value, scope);
        const effectClass = classifyExpr(s.value, scope);
        return annotate(s, {
          type: Option.getOrElse(s.typeAnnotation, () => unknownType),
          effectClass,
        });
      }),
    ),
    Match.tag("ForceStatement", (s) =>
      Effect.gen(function* () {
        if (s.expr._tag === "Force") {
          yield* validateExprScope(s.expr.expr, scope);
          const entry = lookupByExpr(scope, s.expr.expr);
          const type = Option.match(
            Option.flatMap(entry, (e) => e.type),
            { onNone: () => unknownType, onSome: finalReturnType },
          );
          const isEffect = Option.match(entry, {
            onNone: () => false,
            onSome: (e) => e.effectClass === "effect",
          });
          return annotate(s, {
            type,
            effectClass: isEffect ? ("effect" as const) : ("signal" as const),
            forceResolution: isEffect ? ("yield*" as const) : ("none" as const),
          });
        }
        yield* validateExprScope(s.expr, scope);
        return annotate(s, { type: unknownType, effectClass: "signal" as const });
      }),
    ),
    Match.tag("ExprStatement", (s) =>
      Effect.gen(function* () {
        yield* validateExprScope(s.expr, scope);
        const entry = lookupByExpr(scope, s.expr);
        const isEffect = Option.match(entry, {
          onNone: () => false,
          onSome: (e) => e.effectClass === "effect",
        });
        if (isEffect) {
          return yield* Effect.fail(
            new CheckError({
              message: 'Effect-typed expression used in statement position without "!"',
              span: s.span,
              hint: "Did you mean to use ! to force this effect?",
            }),
          );
        }
        return annotate(s, { type: unknownType, effectClass: "signal" as const });
      }),
    ),
    Match.tag("TypeDecl", (s) =>
      Effect.succeed(annotate(s, { type: unknownType, effectClass: "signal" as const })),
    ),
    Match.tag("NewtypeDecl", (s) =>
      Effect.succeed(annotate(s, { type: unknownType, effectClass: "signal" as const })),
    ),
    Match.tag("RecordTypeDecl", (s) =>
      Effect.succeed(annotate(s, { type: unknownType, effectClass: "signal" as const })),
    ),
    Match.tag("Import", (s) =>
      Effect.succeed(annotate(s, { type: unknownType, effectClass: "signal" as const })),
    ),
    Match.tag("Export", (s) =>
      Effect.gen(function* () {
        for (const name of s.names) {
          if (!HashMap.has(scope, name)) {
            return yield* Effect.fail(
              new CheckError({
                message: `Exported name not in scope: ${name}`,
                span: s.span,
              }),
            );
          }
        }
        return annotate(s, { type: unknownType, effectClass: "signal" as const });
      }),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Cycle detection for `on` subscriptions
// ---------------------------------------------------------------------------

/** Collect mutation targets (names on left side of `<-`) from an expression tree. */
const collectMutationTargets = (expr: Ast.Expr): ReadonlyArray<string> => {
  const targets: string[] = [];
  const walk = (e: Ast.Expr): void => {
    if (e._tag === "BinaryExpr" && e.op === "<-" && e.left._tag === "Ident") {
      targets.push(e.left.name);
    }
    if (e._tag === "BinaryExpr") {
      walk(e.left);
      walk(e.right);
    }
    if (e._tag === "UnaryExpr") walk(e.expr);
    if (e._tag === "Force") walk(e.expr);
    if (e._tag === "Block") {
      for (const s of e.statements) {
        if (s._tag === "ForceStatement") walk(s.expr);
        if (s._tag === "ExprStatement") walk(s.expr);
        if (s._tag === "Declaration") walk(s.value);
      }
      walk(e.expr);
    }
    if (e._tag === "Lambda") walk(e.body);
    if (e._tag === "App") {
      walk(e.func);
      for (const a of e.args) walk(a);
    }
    if (e._tag === "OnExpr") {
      walk(e.source);
      walk(e.handler);
    }
  };
  walk(expr);
  return targets;
};

/** Collect on-subscription edges from statements: source -> mutation targets in handler. */
const collectOnEdges = (
  stmts: ReadonlyArray<Ast.Stmt>,
): ReadonlyArray<{ source: string; targets: ReadonlyArray<string>; span: Ast.OnExpr["span"] }> => {
  const edges: Array<{ source: string; targets: ReadonlyArray<string>; span: Ast.OnExpr["span"] }> =
    [];
  const walkExpr = (e: Ast.Expr): void => {
    if (e._tag === "OnExpr") {
      const sourceName = e.source._tag === "Ident" ? e.source.name : "";
      if (sourceName) {
        const targets = collectMutationTargets(e.handler);
        edges.push({ source: sourceName, targets, span: e.span });
      }
    }
    if (e._tag === "Block") {
      for (const s of e.statements) walkStmt(s);
      walkExpr(e.expr);
    }
    if (e._tag === "Force") walkExpr(e.expr);
    if (e._tag === "Lambda") walkExpr(e.body);
    if (e._tag === "App") {
      walkExpr(e.func);
      for (const a of e.args) walkExpr(a);
    }
    if (e._tag === "BinaryExpr") {
      walkExpr(e.left);
      walkExpr(e.right);
    }
  };
  const walkStmt = (s: Ast.Stmt): void => {
    if (s._tag === "ForceStatement") walkExpr(s.expr);
    if (s._tag === "ExprStatement") walkExpr(s.expr);
    if (s._tag === "Declaration") walkExpr(s.value);
  };
  for (const s of stmts) walkStmt(s);
  return edges;
};

/** Detect cycles in on-subscription graph via DFS. */
const detectOnCycles = (stmts: ReadonlyArray<Ast.Stmt>): Effect.Effect<void, CompilerError> => {
  const edges = collectOnEdges(stmts);
  // Build adjacency list: source -> targets
  const graph = new Map<string, string[]>();
  const spanMap = new Map<string, Ast.OnExpr["span"]>();
  for (const edge of edges) {
    const existing = graph.get(edge.source) ?? [];
    existing.push(...edge.targets);
    graph.set(edge.source, existing);
    if (!spanMap.has(edge.source)) spanMap.set(edge.source, edge.span);
  }
  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const hasCycle = (node: string): boolean => {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const neighbor of graph.get(node) ?? []) {
      if (hasCycle(neighbor)) return true;
    }
    inStack.delete(node);
    return false;
  };
  for (const node of graph.keys()) {
    if (hasCycle(node)) {
      const span = spanMap.get(node) ?? Span.empty;
      return Effect.fail(
        new CheckError({
          message: `Subscription cycle detected: on ${node} handler mutates back to ${node}`,
          span,
        }),
      );
    }
  }
  return Effect.void;
};

// ---------------------------------------------------------------------------
// Check program
// ---------------------------------------------------------------------------

const checkProgram = (program: Ast.Program): Effect.Effect<TypedAst.TypedProgram, CompilerError> =>
  Effect.gen(function* () {
    const scope = buildScope(program.statements, HashMap.empty());
    const statements = yield* Effect.forEach(program.statements, (stmt) => checkStmt(stmt, scope));
    // Post-pass: detect subscription cycles
    yield* detectOnCycles(program.statements);
    return { _tag: "Program" as const, statements: [...statements], span: program.span };
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const check = (ast: Ast.Program): Effect.Effect<TypedAst.TypedProgram, CompilerError> =>
  checkProgram(ast);
