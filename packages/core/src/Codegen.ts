import { Effect } from "effect";
import type * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import { CodegenError } from "./CompilerError.js";
import * as SourceMap from "./SourceMap.js";
import type * as TypedAst from "./TypedAst.js";

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface CodegenOutput {
  readonly code: string;
  readonly sourceMap: SourceMap.SourceMap;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

class Writer {
  private lines: string[] = [];
  private currentIndent = 0;
  private currentLine = 1;
  private currentCol = 0;
  readonly sourceMap = SourceMap.empty();

  writeLine(text: string): void {
    const indent = " ".repeat(this.currentIndent);
    this.lines.push(indent + text);
    this.currentLine++;
    this.currentCol = 0;
  }

  writeBlankLine(): void {
    this.lines.push("");
    this.currentLine++;
    this.currentCol = 0;
  }

  pushIndent(): void {
    this.currentIndent += 2;
  }

  popIndent(): void {
    this.currentIndent -= 2;
  }

  recordMapping(span: Ast.Span): void {
    SourceMap.add(this.sourceMap, { line: this.currentLine, col: this.currentCol }, span);
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a dotted name from a DotAccess chain. */
const buildDottedName = (expr: Ast.Expr): string | undefined => {
  if (expr._tag === "Ident") return expr.name;
  if (expr._tag === "DotAccess") {
    const obj = buildDottedName(expr.object);
    return obj !== undefined ? `${obj}.${expr.field}` : undefined;
  }
  return undefined;
};

/** Count the number of parameters in an ArrowType. */
const countParams = (type: Ast.Type): number => {
  if (type._tag === "ArrowType") return 1 + countParams(type.result);
  return 0;
};

/** Replace dots with underscores for wrapper function names. */
const toWrapperName = (name: string): string => name.replace(/\./g, "_");

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

export const generate = (ast: TypedAst.TypedProgram): Effect.Effect<CodegenOutput, CompilerError> =>
  Effect.try({
    try: () => generateProgram(ast),
    catch: (e) => {
      if (typeof e === "object" && e !== null && "_tag" in e) return e as CompilerError;
      return CodegenError({
        message: `Codegen failed: ${String(e)}`,
        span: ast.span,
      });
    },
  });

const generateProgram = (program: TypedAst.TypedProgram): CodegenOutput => {
  const w = new Writer();

  // Collect declared names for wrapper generation
  const declaredNames = new Map<
    string,
    { wrapperName: string; paramCount: number; type: Ast.Type }
  >();
  for (const stmt of program.statements) {
    if (stmt.node._tag === "Declare") {
      const name = stmt.node.name;
      declaredNames.set(name, {
        wrapperName: toWrapperName(name),
        paramCount: countParams(stmt.node.typeAnnotation),
        type: stmt.node.typeAnnotation,
      });
    }
  }

  // Detect if we need Effect wrapping (any ForceStatement present)
  const hasForce = program.statements.some((s) => s.node._tag === "ForceStatement");

  // Emit import if we have any declares or force statements
  const needsEffectImport = declaredNames.size > 0 || hasForce;
  if (needsEffectImport) {
    w.writeLine('import { Effect } from "effect"');
    w.writeBlankLine();
  }

  // Emit declare wrappers
  for (const stmt of program.statements) {
    if (stmt.node._tag === "Declare") {
      const info = declaredNames.get(stmt.node.name)!;
      const params = Array.from({ length: info.paramCount }, (_, i) => `_a${i}`);
      const paramList = params.join(", ");
      const argList = params.join(", ");
      w.recordMapping(stmt.node.span);
      w.writeLine(
        `const ${info.wrapperName} = (${paramList}) => Effect.sync(() => ${stmt.node.name}(${argList}))`,
      );
      w.writeBlankLine();
    }
  }

  // Collect non-declare statements
  const bodyStmts = program.statements.filter((s) => s.node._tag !== "Declare");

  if (hasForce) {
    // Wrap in Effect.gen + runPromise
    w.writeLine("const main = Effect.gen(function*() {");
    w.pushIndent();
    for (const stmt of bodyStmts) {
      emitStatement(w, stmt, declaredNames);
    }
    w.popIndent();
    w.writeLine("})");
    w.writeBlankLine();
    w.writeLine("Effect.runPromise(main)");
  } else {
    // No force — emit statements directly
    for (const stmt of bodyStmts) {
      emitStatement(w, stmt, declaredNames);
    }
  }

  return {
    code: w.toString(),
    sourceMap: w.sourceMap,
  };
};

const emitStatement = (
  w: Writer,
  stmt: TypedAst.TypedStmt,
  declaredNames: Map<string, { wrapperName: string; paramCount: number; type: Ast.Type }>,
): void => {
  const node = stmt.node;
  switch (node._tag) {
    case "Declaration": {
      w.recordMapping(node.span);
      w.writeLine(`const ${node.name} = ${emitExpr(node.value, declaredNames)}`);
      break;
    }
    case "ForceStatement": {
      w.recordMapping(node.span);
      // ForceStatement.expr is a Force node
      if (node.expr._tag === "Force") {
        w.writeLine(`yield* ${emitExpr(node.expr.expr, declaredNames)}`);
      } else {
        w.writeLine(`yield* ${emitExpr(node.expr, declaredNames)}`);
      }
      break;
    }
    case "ExprStatement": {
      w.recordMapping(node.span);
      w.writeLine(emitExpr(node.expr, declaredNames));
      break;
    }
    case "Declare":
      // Already handled above
      break;
  }
};

const emitExpr = (
  expr: Ast.Expr,
  declaredNames: Map<string, { wrapperName: string; paramCount: number; type: Ast.Type }>,
): string => {
  switch (expr._tag) {
    case "StringLiteral":
      return `"${expr.value}"`;
    case "IntLiteral":
      return String(expr.value);
    case "BoolLiteral":
      return String(expr.value);
    case "UnitLiteral":
      return "undefined";
    case "Ident": {
      return expr.name;
    }
    case "DotAccess": {
      const dottedName = buildDottedName(expr);
      if (dottedName !== undefined) {
        const declared = declaredNames.get(dottedName);
        if (declared !== undefined) return declared.wrapperName;
      }
      return `${emitExpr(expr.object, declaredNames)}.${expr.field}`;
    }
    case "App": {
      const func = emitExpr(expr.func, declaredNames);
      const args = expr.args.map((a) => emitExpr(a, declaredNames)).join(", ");
      return `${func}(${args})`;
    }
    case "Force": {
      return `yield* ${emitExpr(expr.expr, declaredNames)}`;
    }
  }
};
