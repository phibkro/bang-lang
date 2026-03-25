import { Array as Arr, Effect, HashMap, Match, Option } from "effect";
import type * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import { CodegenError } from "./CompilerError.js";
import * as SourceMap from "./SourceMap.js";
import * as Span from "./Span.js";
import type * as TypedAst from "./TypedAst.js";

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface CodegenOutput {
  readonly code: string;
  readonly sourceMap: SourceMap.SourceMap;
}

// ---------------------------------------------------------------------------
// Functional writer state (immutable)
// ---------------------------------------------------------------------------

interface WriterState {
  readonly lines: ReadonlyArray<string>;
  readonly indent: number;
  readonly currentLine: number;
  readonly sourceMap: SourceMap.SourceMap;
}

const emptyWriter: WriterState = {
  lines: [],
  indent: 0,
  currentLine: 1,
  sourceMap: SourceMap.empty(),
};

const writeLine = (w: WriterState, text: string): WriterState => ({
  ...w,
  lines: [...w.lines, " ".repeat(w.indent) + text],
  currentLine: w.currentLine + 1,
});

const writeBlankLine = (w: WriterState): WriterState => ({
  ...w,
  lines: [...w.lines, ""],
  currentLine: w.currentLine + 1,
});

const pushIndent = (w: WriterState): WriterState => ({ ...w, indent: w.indent + 2 });
const popIndent = (w: WriterState): WriterState => ({ ...w, indent: w.indent - 2 });

const recordMapping = (w: WriterState, span: Span.Span): WriterState => ({
  ...w,
  sourceMap: SourceMap.add(w.sourceMap, { line: w.currentLine, col: 0 }, span),
});

const writerToString = (w: WriterState): string => w.lines.join("\n") + "\n";

// ---------------------------------------------------------------------------
// Helpers (pure, Match.tag for dispatch)
// ---------------------------------------------------------------------------

const buildDottedName = (expr: Ast.Expr): Option.Option<string> =>
  Match.value(expr).pipe(
    Match.tag("Ident", (e) => Option.some(e.name)),
    Match.tag("DotAccess", (e) =>
      Option.map(buildDottedName(e.object), (obj) => `${obj}.${e.field}`),
    ),
    Match.orElse(() => Option.none()),
  );

const countParams = (type: Ast.Type): number =>
  Match.value(type).pipe(
    Match.tag("ArrowType", (t) => 1 + countParams(t.result)),
    Match.orElse(() => 0),
  );

const toWrapperName = (name: string): string => name.replace(/\./g, "_");

// ---------------------------------------------------------------------------
// Declared name info
// ---------------------------------------------------------------------------

interface DeclInfo {
  readonly wrapperName: string;
  readonly paramCount: number;
  readonly type: Ast.Type;
}

type DeclMap = HashMap.HashMap<string, DeclInfo>;

const collectDeclaredNames = (statements: ReadonlyArray<TypedAst.TypedStmt>): DeclMap =>
  Arr.reduce(statements, HashMap.empty<string, DeclInfo>(), (acc, stmt) =>
    Match.value(stmt.node).pipe(
      Match.tag("Declare", (s) =>
        HashMap.set(acc, s.name, {
          wrapperName: toWrapperName(s.name),
          paramCount: countParams(s.typeAnnotation),
          type: s.typeAnnotation,
        }),
      ),
      Match.orElse(() => acc),
    ),
  );

// ---------------------------------------------------------------------------
// Expression emission (pure string building)
// ---------------------------------------------------------------------------

const emitExpr = (expr: Ast.Expr, decls: DeclMap): string =>
  Match.value(expr).pipe(
    Match.tag("StringLiteral", (e) => `"${e.value}"`),
    Match.tag("IntLiteral", (e) => String(e.value)),
    Match.tag("BoolLiteral", (e) => String(e.value)),
    Match.tag("UnitLiteral", () => "undefined"),
    Match.tag("Ident", (e) => e.name),
    Match.tag("DotAccess", (e) =>
      Option.match(buildDottedName(e), {
        onNone: () => `${emitExpr(e.object, decls)}.${e.field}`,
        onSome: (name) =>
          Option.match(HashMap.get(decls, name), {
            onNone: () => `${emitExpr(e.object, decls)}.${e.field}`,
            onSome: (info) => info.wrapperName,
          }),
      }),
    ),
    Match.tag("App", (e) => {
      const func = emitExpr(e.func, decls);
      const args = Arr.map(e.args, (a) => emitExpr(a, decls)).join(", ");
      return `${func}(${args})`;
    }),
    Match.tag("Force", (e) => `yield* ${emitExpr(e.expr, decls)}`),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Statement emission (returns new WriterState)
// ---------------------------------------------------------------------------

const emitStatement = (w: WriterState, stmt: TypedAst.TypedStmt, decls: DeclMap): WriterState =>
  Match.value(stmt.node).pipe(
    Match.tag("Declaration", (node) => {
      const w1 = recordMapping(w, node.span);
      return writeLine(w1, `const ${node.name} = ${emitExpr(node.value, decls)}`);
    }),
    Match.tag("ForceStatement", (node) => {
      const w1 = recordMapping(w, node.span);
      if (node.expr._tag === "Force") {
        return writeLine(w1, `yield* ${emitExpr(node.expr.expr, decls)}`);
      }
      return writeLine(w1, `yield* ${emitExpr(node.expr, decls)}`);
    }),
    Match.tag("ExprStatement", (node) => {
      const w1 = recordMapping(w, node.span);
      return writeLine(w1, emitExpr(node.expr, decls));
    }),
    Match.tag("Declare", () => w), // already handled in wrapper generation
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Program generation
// ---------------------------------------------------------------------------

const generateProgram = (program: TypedAst.TypedProgram): CodegenOutput => {
  const decls = collectDeclaredNames(program.statements);
  const hasForce = Arr.some(program.statements, (s) => s.node._tag === "ForceStatement");
  const needsEffectImport = HashMap.size(decls) > 0 || hasForce;

  // Start building output
  const w0 = needsEffectImport
    ? writeBlankLine(writeLine(emptyWriter, 'import { Effect } from "effect"'))
    : emptyWriter;

  // Emit declare wrappers
  const w1 = Arr.reduce(program.statements, w0, (w, stmt) =>
    Match.value(stmt.node).pipe(
      Match.tag("Declare", (node) =>
        Option.match(HashMap.get(decls, node.name), {
          onNone: () => w,
          onSome: (info) => {
            const params = Arr.makeBy(info.paramCount, (i) => `_a${i}`);
            const paramList = params.join(", ");
            const w2 = recordMapping(w, node.span);
            return writeBlankLine(
              writeLine(
                w2,
                `const ${info.wrapperName} = (${paramList}) => Effect.sync(() => ${node.name}(${paramList}))`,
              ),
            );
          },
        }),
      ),
      Match.orElse(() => w),
    ),
  );

  // Filter non-declare statements
  const bodyStmts = Arr.filter(program.statements, (s) => s.node._tag !== "Declare");

  if (hasForce) {
    // Wrap in Effect.gen + runPromise
    const w2 = pushIndent(writeLine(w1, "const main = Effect.gen(function*() {"));
    const w3 = Arr.reduce(bodyStmts, w2, (w, stmt) => emitStatement(w, stmt, decls));
    const w4 = writeLine(popIndent(w3), "})");
    const w5 = writeLine(writeBlankLine(w4), "Effect.runPromise(main)");
    return { code: writerToString(w5), sourceMap: w5.sourceMap };
  }

  const w2 = Arr.reduce(bodyStmts, w1, (w, stmt) => emitStatement(w, stmt, decls));
  return { code: writerToString(w2), sourceMap: w2.sourceMap };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const generate = (ast: TypedAst.TypedProgram): Effect.Effect<CodegenOutput, CompilerError> =>
  Effect.try({
    try: () => generateProgram(ast),
    catch: (e) =>
      e instanceof CodegenError
        ? e
        : new CodegenError({ message: `Codegen failed: ${String(e)}`, span: ast.span }),
  });
