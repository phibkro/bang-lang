import { Array as Arr, Effect, HashMap, Match, Option } from "effect";
import * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import { CheckError } from "./CompilerError.js";
import * as Span from "./Span.js";
import type * as TypedAst from "./TypedAst.js";
import { annotate } from "./TypedAst.js";

// ---------------------------------------------------------------------------
// Scope (internal — plain interface is fine)
// ---------------------------------------------------------------------------

interface ScopeEntry {
  readonly name: string;
  readonly type: Option.Option<Ast.Type>;
  readonly effectClass: "signal" | "effect";
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
        }),
      ),
      Match.tag("Declaration", (s) =>
        HashMap.set(acc, s.name, {
          name: s.name,
          type: s.typeAnnotation,
          effectClass: classifyExpr(s.value, acc),
        }),
      ),
      Match.tag("TypeDecl", (s) =>
        Arr.reduce(s.constructors, acc, (scope, ctor) => {
          const ctorTag =
            ctor._tag === "NullaryConstructor"
              ? ctor.tag
              : ctor._tag === "PositionalConstructor"
                ? ctor.tag
                : ctor.tag;
          return HashMap.set(scope, ctorTag, {
            name: ctorTag,
            type: Option.none(),
            effectClass: "signal" as const,
          });
        }),
      ),
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
          (s._tag === "Declaration" && classifyExpr(s.value, blockScope) === "effect"),
      );
      const exprClass = classifyExpr(e.expr, blockScope);
      return stmtHasEffect || exprClass === "effect" ? ("effect" as const) : ("signal" as const);
    }),
    Match.tag("Lambda", (e) => {
      // Create child scope with params bound as signal-typed
      const paramScope = Arr.reduce(e.params, scope, (acc, p) =>
        HashMap.set(acc, p, { name: p, type: Option.none(), effectClass: "signal" as const }),
      );
      // Lambda itself is always signal (it's a value); classify body for internal use
      classifyExpr(e.body, paramScope);
      return "signal" as const;
    }),
    Match.tag("StringInterp", () => "signal" as const),
    Match.tag("MatchExpr", () => "signal" as const),
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
    Match.tag("BinaryExpr", (e) =>
      Effect.flatMap(validateExprScope(e.left, scope), () => validateExprScope(e.right, scope)),
    ),
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
        HashMap.set(acc, p, { name: p, type: Option.none(), effectClass: "signal" as const }),
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
          yield* validateExprScope(arm.body, scope);
        }
      }),
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
    Match.tag("Mutation", (s) =>
      Effect.succeed(annotate(s, { type: unknownType, effectClass: "signal" as const })),
    ),
    Match.tag("Import", (s) =>
      Effect.succeed(annotate(s, { type: unknownType, effectClass: "signal" as const })),
    ),
    Match.tag("Export", (s) =>
      Effect.succeed(annotate(s, { type: unknownType, effectClass: "signal" as const })),
    ),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Check program
// ---------------------------------------------------------------------------

const checkProgram = (program: Ast.Program): Effect.Effect<TypedAst.TypedProgram, CompilerError> =>
  Effect.gen(function* () {
    const scope = buildScope(program.statements, HashMap.empty());
    const statements = yield* Effect.forEach(program.statements, (stmt) => checkStmt(stmt, scope));
    return { _tag: "Program" as const, statements: [...statements], span: program.span };
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const check = (ast: Ast.Program): Effect.Effect<TypedAst.TypedProgram, CompilerError> =>
  checkProgram(ast);
