import { Effect } from "effect";
import * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import { CheckError } from "./CompilerError.js";
import type * as TypedAst from "./TypedAst.js";
import { annotate } from "./TypedAst.js";

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

interface ScopeEntry {
  readonly name: string;
  readonly type: Ast.Type | undefined;
  readonly effectClass: "signal" | "effect";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a dotted name from a DotAccess chain: DotAccess(Ident("console"), "log") → "console.log" */
const buildDottedName = (expr: Ast.Expr): string | undefined => {
  if (expr._tag === "Ident") return expr.name;
  if (expr._tag === "DotAccess") {
    const obj = buildDottedName(expr.object);
    return obj !== undefined ? `${obj}.${expr.field}` : undefined;
  }
  return undefined;
};

/** Resolve the name of a callable expression (for scope lookup). */
const resolveCallableName = (expr: Ast.Expr): string | undefined => {
  if (expr._tag === "Ident") return expr.name;
  if (expr._tag === "DotAccess") return buildDottedName(expr);
  if (expr._tag === "App") return resolveCallableName(expr.func);
  if (expr._tag === "Force") return resolveCallableName(expr.expr);
  return undefined;
};

/** Check whether a type ultimately returns an Effect. */
const returnsEffect = (type: Ast.Type): boolean => {
  if (type._tag === "EffectType") return true;
  if (type._tag === "ArrowType") return returnsEffect(type.result);
  return false;
};

/** Get the final return type of a (possibly curried) function type. */
const finalReturnType = (type: Ast.Type): Ast.Type => {
  if (type._tag === "ArrowType") return finalReturnType(type.result);
  return type;
};

/** A sentinel "unknown" type for expressions we can't fully type yet. */
const unknownType: Ast.ConcreteType = Ast.ConcreteType({
  name: "Unknown",
  span: { startLine: 0, startCol: 0, startOffset: 0, endLine: 0, endCol: 0, endOffset: 0 },
});

// ---------------------------------------------------------------------------
// Checker entry point
// ---------------------------------------------------------------------------

export const check = (ast: Ast.Program): Effect.Effect<TypedAst.TypedProgram, CompilerError> =>
  Effect.try({
    try: () => checkProgram(ast),
    catch: (e) => e as CompilerError,
  });

// ---------------------------------------------------------------------------
// Internal checking
// ---------------------------------------------------------------------------

const checkProgram = (program: Ast.Program): TypedAst.TypedProgram => {
  const scope = new Map<string, ScopeEntry>();

  // First pass: collect declarations into scope
  for (const stmt of program.statements) {
    if (stmt._tag === "Declare") {
      scope.set(stmt.name, {
        name: stmt.name,
        type: stmt.typeAnnotation,
        effectClass: returnsEffect(stmt.typeAnnotation) ? "effect" : "signal",
      });
    } else if (stmt._tag === "Declaration") {
      scope.set(stmt.name, {
        name: stmt.name,
        type: stmt.typeAnnotation,
        effectClass: classifyExpr(stmt.value, scope),
      });
    }
  }

  // Second pass: check and annotate each statement
  const statements: TypedAst.TypedStmt[] = program.statements.map((stmt) => checkStmt(stmt, scope));

  return {
    _tag: "Program",
    statements,
    span: program.span,
  };
};

const checkStmt = (stmt: Ast.Stmt, scope: Map<string, ScopeEntry>): TypedAst.TypedStmt => {
  switch (stmt._tag) {
    case "Declare":
      return annotate(stmt, {
        type: stmt.typeAnnotation,
        effectClass: "signal",
      });

    case "Declaration": {
      validateExprScope(stmt.value, scope);
      const effectClass = classifyExpr(stmt.value, scope);
      return annotate(stmt, {
        type: stmt.typeAnnotation ?? unknownType,
        effectClass,
      });
    }

    case "ForceStatement": {
      // The ForceStatement.expr is a Force node wrapping the actual expression
      const forceExpr = stmt.expr;
      if (forceExpr._tag === "Force") {
        validateExprScope(forceExpr.expr, scope);

        // Resolve what's being forced
        const name = resolveCallableName(forceExpr.expr);
        const entry = name !== undefined ? scope.get(name) : undefined;

        const type = entry?.type !== undefined ? finalReturnType(entry.type) : unknownType;
        const isEffect = entry !== undefined && entry.effectClass === "effect";

        return annotate(stmt, {
          type,
          effectClass: isEffect ? "effect" : "signal",
          forceResolution: isEffect ? "yield*" : "none",
        });
      }

      // Fallback: shouldn't happen with current parser, but handle gracefully
      validateExprScope(stmt.expr, scope);
      return annotate(stmt, {
        type: unknownType,
        effectClass: "signal",
      });
    }

    case "ExprStatement": {
      validateExprScope(stmt.expr, scope);

      // Must-handle check: if the expression resolves to an Effect, error
      const name = resolveCallableName(stmt.expr);
      const entry = name !== undefined ? scope.get(name) : undefined;

      if (entry !== undefined && entry.effectClass === "effect") {
        throw new CheckError({
          message: `Effect-typed expression used in statement position without "!"`,
          span: stmt.span,
          hint: `Did you mean to use ! to force this effect?`,
        });
      }

      return annotate(stmt, {
        type: unknownType,
        effectClass: "signal",
      });
    }
  }
};

/** Classify an expression as signal or effect based on scope. */
const classifyExpr = (expr: Ast.Expr, scope: Map<string, ScopeEntry>): "signal" | "effect" => {
  switch (expr._tag) {
    case "StringLiteral":
    case "IntLiteral":
    case "BoolLiteral":
    case "UnitLiteral":
      return "signal";
    case "Ident": {
      const entry = scope.get(expr.name);
      return entry?.effectClass ?? "signal";
    }
    case "DotAccess": {
      const name = buildDottedName(expr);
      if (name !== undefined) {
        const entry = scope.get(name);
        return entry?.effectClass ?? "signal";
      }
      return "signal";
    }
    case "App": {
      const name = resolveCallableName(expr.func);
      if (name !== undefined) {
        const entry = scope.get(name);
        return entry?.effectClass ?? "signal";
      }
      return "signal";
    }
    case "Force": {
      return classifyExpr(expr.expr, scope);
    }
  }
};

/** Validate that all identifiers in an expression are in scope. */
const validateExprScope = (expr: Ast.Expr, scope: Map<string, ScopeEntry>): void => {
  switch (expr._tag) {
    case "Ident": {
      // Check if it's a standalone identifier in scope, or part of a dotted name
      if (!scope.has(expr.name)) {
        throw new CheckError({
          message: `Undeclared identifier: ${expr.name}`,
          span: expr.span,
        });
      }
      break;
    }
    case "DotAccess": {
      // Check the full dotted name as a single scope entry
      const name = buildDottedName(expr);
      if (name !== undefined) {
        if (!scope.has(name)) {
          throw new CheckError({
            message: `Undeclared identifier: ${name}`,
            span: expr.span,
          });
        }
      } else {
        // Fallback: validate the object part
        validateExprScope(expr.object, scope);
      }
      break;
    }
    case "App": {
      validateExprScope(expr.func, scope);
      for (const arg of expr.args) {
        validateExprScope(arg, scope);
      }
      break;
    }
    case "Force": {
      validateExprScope(expr.expr, scope);
      break;
    }
    case "StringLiteral":
    case "IntLiteral":
    case "BoolLiteral":
    case "UnitLiteral":
      break;
  }
};
