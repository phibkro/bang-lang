import { Array as Arr, Effect, HashMap, Match, Option } from "effect";
import * as Ast from "@bang/core/Ast";
import type { CompilerError } from "@bang/core/CompilerError";
import { CodegenError } from "@bang/core/CompilerError";
import { Interpreter, Value as ValueMod } from "@bang/core";
import * as SourceMap from "./SourceMap.js";
import * as Span from "@bang/core/Span";
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

const countParams = (type: Ast.Type): number =>
  Match.value(type).pipe(
    Match.tag("ArrowType", (t) => 1 + countParams(t.result)),
    Match.orElse(() => 0),
  );

const toWrapperName = (name: string): string => name.replace(/\./g, "_");

const mapBinaryOp = (op: string): string => {
  switch (op) {
    case "==":
      return "===";
    case "!=":
      return "!==";
    case "and":
      return "&&";
    case "or":
      return "||";
    case "xor":
      return "!==";
    case "++":
      return "+";
    default:
      return op;
  }
};

// JavaScript operator precedence for binary operators (higher = tighter binding)
const JS_PREC: Record<string, number> = {
  "||": 4,
  "&&": 5,
  "!==": 7,
  "===": 8,
  "<": 9,
  ">": 9,
  "<=": 9,
  ">=": 9,
  "+": 12,
  "-": 12,
  "*": 14,
  "/": 14,
  "%": 14,
};

const jsPrecOf = (jsOp: string): number => JS_PREC[jsOp] ?? 0;

const mapUnaryOp = (op: string): string => {
  switch (op) {
    case "not":
      return "!";
    default:
      return op;
  }
};

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
// Ref.get hoisting helpers
// ---------------------------------------------------------------------------

/** Walk an expression tree and collect all Ident names that are in mutNames. */
const collectMutReads = (expr: Ast.Expr, mutNames: ReadonlySet<string>): ReadonlySet<string> => {
  const reads = new Set<string>();
  const walk = (e: Ast.Expr): void => {
    Match.value(e).pipe(
      Match.tag("Ident", (id) => {
        if (mutNames.has(id.name)) reads.add(id.name);
      }),
      Match.tag("BinaryExpr", (b) => {
        walk(b.left);
        walk(b.right);
      }),
      Match.tag("UnaryExpr", (u) => walk(u.expr)),
      Match.tag("Force", (f) => walk(f.expr)),
      Match.tag("App", (a) => {
        walk(a.func);
        a.args.forEach(walk);
      }),
      Match.tag("StringInterp", (s) =>
        s.parts.forEach((p) => {
          if (p._tag === "InterpExpr") walk(p.value);
        }),
      ),
      Match.orElse(() => {}),
    );
  };
  walk(expr);
  return reads;
};

/** Check if an expression is a simple lone Ident (no compound sub-expressions). */
const isSimpleIdent = (expr: Ast.Expr): boolean => expr._tag === "Ident";

/**
 * Emit hoisted Ref.get bindings for mutable names read inside a compound expression.
 * Returns [prefixLines, hoistedNames] where hoistedNames maps original name -> temp name.
 */
const hoistMutReads = (
  expr: Ast.Expr,
  mutNames: ReadonlySet<string>,
): { readonly prefixLines: ReadonlyArray<string>; readonly hoisted: ReadonlySet<string> } => {
  // Simple ident: yield* Ref.get(x) at statement level is fine, no hoisting needed
  if (isSimpleIdent(expr)) return { prefixLines: [], hoisted: new Set() };
  const reads = collectMutReads(expr, mutNames);
  if (reads.size === 0) return { prefixLines: [], hoisted: new Set() };
  const prefixLines: string[] = [];
  for (const name of reads) {
    prefixLines.push(`const _${name} = yield* Ref.get(${name})`);
  }
  return { prefixLines, hoisted: reads };
};

// ---------------------------------------------------------------------------
// Block statement emission (pure string, no WriterState)
// ---------------------------------------------------------------------------

const emitBlockStmt = (stmt: Ast.Stmt, decls: DeclMap, mutNames: ReadonlySet<string>): string =>
  Match.value(stmt).pipe(
    Match.tag("Declaration", (s) => {
      if (s.mutable) {
        const { prefixLines, hoisted } = hoistMutReads(s.value, mutNames);
        const valueCode = emitExpr(s.value, decls, mutNames, hoisted);
        return [...prefixLines, `const ${s.name} = yield* Ref.make(${valueCode})`].join("\n  ");
      }
      const { prefixLines, hoisted } = hoistMutReads(s.value, mutNames);
      const valueCode = emitExpr(s.value, decls, mutNames, hoisted);
      return [...prefixLines, `const ${s.name} = ${valueCode}`].join("\n  ");
    }),
    Match.tag("ForceStatement", (s) => {
      if (s.expr._tag === "Force" && s.expr.expr._tag === "UseExpr") {
        const useExpr = s.expr.expr;
        const valueCode = emitExpr(useExpr.value, decls, mutNames);
        return `const ${useExpr.name} = yield* ${valueCode}`;
      }
      return s.expr._tag === "Force"
        ? `yield* ${emitExpr(s.expr.expr, decls, mutNames)}`
        : `yield* ${emitExpr(s.expr, decls, mutNames)}`;
    }),
    Match.tag("ExprStatement", (s) => emitExpr(s.expr, decls, mutNames)),
    Match.tag("Declare", () => ""),
    Match.tag("TypeDecl", () => ""),
    Match.tag("NewtypeDecl", () => ""),
    Match.tag("RecordTypeDecl", () => ""),
    Match.tag("Import", (s) => {
      const path = s.modulePath.map((p) => p.toLowerCase()).join("/");
      return `import { ${s.names.join(", ")} } from "./${path}"`;
    }),
    Match.tag("Export", (s) => `export { ${s.names.join(", ")} }`),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Expression emission (pure string building)
// ---------------------------------------------------------------------------

const emitExpr = (
  expr: Ast.Expr,
  decls: DeclMap,
  mutNames: ReadonlySet<string> = new Set(),
  hoistedNames: ReadonlySet<string> = new Set(),
): string =>
  Match.value(expr).pipe(
    Match.tag("StringLiteral", (e) => `"${e.value}"`),
    Match.tag("IntLiteral", (e) => String(e.value)),
    Match.tag("BoolLiteral", (e) => String(e.value)),
    Match.tag("UnitLiteral", () => "undefined"),
    Match.tag("Ident", (e) =>
      hoistedNames.has(e.name)
        ? `_${e.name}`
        : mutNames.has(e.name)
          ? `yield* Ref.get(${e.name})`
          : e.name,
    ),
    Match.tag("DotAccess", (e) =>
      Option.match(Ast.buildDottedName(e), {
        onNone: () => `${emitExpr(e.object, decls, mutNames, hoistedNames)}.${e.field}`,
        onSome: (name) =>
          Option.match(HashMap.get(decls, name), {
            onNone: () => `${emitExpr(e.object, decls, mutNames, hoistedNames)}.${e.field}`,
            onSome: (info) => info.wrapperName,
          }),
      }),
    ),
    Match.tag("App", (e) => {
      // Detect dot-method patterns: App(DotAccess(obj, method), args)
      if (e.func._tag === "DotAccess") {
        const method = e.func.field;
        const obj = emitExpr(e.func.object, decls, mutNames, hoistedNames);

        if (method === "handle" && e.args.length === 2) {
          const typeName =
            e.args[0]._tag === "Ident"
              ? e.args[0].name
              : emitExpr(e.args[0], decls, mutNames, hoistedNames);
          const impl = emitExpr(e.args[1], decls, mutNames, hoistedNames);
          return `pipe(${obj}, Effect.provide(Layer.succeed(${typeName}, ${impl})))`;
        }
        if (method === "catch" && e.args.length >= 1) {
          const tag =
            e.args[0]._tag === "Ident"
              ? `"${e.args[0].name}"`
              : emitExpr(e.args[0], decls, mutNames, hoistedNames);
          const handler =
            e.args.length > 1
              ? emitExpr(e.args[1], decls, mutNames, hoistedNames)
              : "(_) => Effect.void";
          return `pipe(${obj}, Effect.catchTag(${tag}, ${handler}))`;
        }
        if (method === "map" && e.args.length === 1) {
          const f = emitExpr(e.args[0], decls, mutNames, hoistedNames);
          return `pipe(${obj}, Effect.map(${f}))`;
        }
        if (method === "tap" && e.args.length === 1) {
          const f = emitExpr(e.args[0], decls, mutNames, hoistedNames);
          return `pipe(${obj}, Effect.tap(${f}))`;
        }
        // Not a known dot method — fall through to normal App handling
      }

      const funcCode = emitExpr(e.func, decls, mutNames, hoistedNames);
      // Check if the function is a declared wrapper (use comma-separated args)
      const dottedName = Ast.buildDottedName(e.func);
      const isDeclared = Option.isSome(Option.flatMap(dottedName, (n) => HashMap.get(decls, n)));
      if (isDeclared) {
        const args = Arr.map(e.args, (a) => emitExpr(a, decls, mutNames, hoistedNames)).join(", ");
        return `${funcCode}(${args})`;
      }
      // User-defined: curried application
      return Arr.reduce(
        e.args,
        funcCode,
        (fn, arg) => `${fn}(${emitExpr(arg, decls, mutNames, hoistedNames)})`,
      );
    }),
    Match.tag("Force", (e) => `yield* ${emitExpr(e.expr, decls, mutNames, hoistedNames)}`),
    Match.tag("FloatLiteral", (e) => String(e.value)),
    Match.tag("BinaryExpr", (e) => {
      if (e.op === "<-") {
        // Left must be raw name, NOT emitExpr (which would emit Ref.get)
        const target =
          e.left._tag === "Ident" ? e.left.name : emitExpr(e.left, decls, mutNames, hoistedNames);
        const { prefixLines, hoisted } = hoistMutReads(e.right, mutNames);
        const valueCode = emitExpr(e.right, decls, mutNames, hoisted);
        return [...prefixLines, `yield* Ref.set(${target}, ${valueCode})`].join("\n  ");
      }
      const op = mapBinaryOp(e.op);
      const prec = jsPrecOf(op);
      const leftCode = emitExpr(e.left, decls, mutNames, hoistedNames);
      const rightCode = emitExpr(e.right, decls, mutNames, hoistedNames);
      const left =
        e.left._tag === "BinaryExpr" && jsPrecOf(mapBinaryOp(e.left.op)) < prec
          ? `(${leftCode})`
          : leftCode;
      const right =
        e.right._tag === "BinaryExpr" && jsPrecOf(mapBinaryOp(e.right.op)) < prec
          ? `(${rightCode})`
          : rightCode;
      return `${left} ${op} ${right}`;
    }),
    Match.tag("UnaryExpr", (e) => {
      const op = mapUnaryOp(e.op);
      return `${op}${emitExpr(e.expr, decls, mutNames, hoistedNames)}`;
    }),
    Match.tag("Block", (e) => {
      // Collect mut names from block statements
      const blockMutNames = new Set(mutNames);
      for (const stmt of e.statements) {
        if (stmt._tag === "Declaration" && stmt.mutable) {
          blockMutNames.add(stmt.name);
        }
      }
      if (e.statements.length === 0) {
        return emitExpr(e.expr, decls, blockMutNames);
      }
      const stmtLines = e.statements.map((stmt) => {
        const line = emitBlockStmt(stmt, decls, blockMutNames);
        return `  ${line}`;
      });
      const returnLine = `  return ${emitExpr(e.expr, decls, blockMutNames)}`;
      const body = [...stmtLines, returnLine].join("\n");
      return `Effect.gen(function*() {\n${body}\n})`;
    }),
    Match.tag("Lambda", (e) => {
      const bodyCode = emitExpr(e.body, decls, mutNames, hoistedNames);
      return Arr.reduceRight(e.params, bodyCode, (inner, param) => `(${param}) => ${inner}`);
    }),
    Match.tag("StringInterp", (e) => {
      const inner = e.parts
        .map((part) =>
          part._tag === "InterpText"
            ? part.value
            : `\${${emitExpr(part.value, decls, mutNames, hoistedNames)}}`,
        )
        .join("");
      return `\`${inner}\``;
    }),
    Match.tag("ComptimeExpr", (e) => {
      try {
        const result = Effect.runSync(Interpreter.evalExpr(e.expr, HashMap.empty()));
        return ValueMod.$match(result, {
          Num: (n) => String(n.value),
          Str: (s) => `"${s.value}"`,
          Bool: (b) => String(b.value),
          Unit: () => "undefined",
          Closure: () =>
            `/* comptime: cannot serialize closure */ ${emitExpr(e.expr, decls, mutNames, hoistedNames)}`,
          Tagged: () =>
            `/* comptime: cannot serialize tagged */ ${emitExpr(e.expr, decls, mutNames, hoistedNames)}`,
          Constructor: () =>
            `/* comptime: cannot serialize constructor */ ${emitExpr(e.expr, decls, mutNames, hoistedNames)}`,
          MutCell: () =>
            `/* comptime: cannot serialize mutcell */ ${emitExpr(e.expr, decls, mutNames, hoistedNames)}`,
        });
      } catch {
        return `/* comptime eval failed */ ${emitExpr(e.expr, decls, mutNames, hoistedNames)}`;
      }
    }),
    Match.tag(
      "UseExpr",
      (e) => `/* use ${e.name} = */ ${emitExpr(e.value, decls, mutNames, hoistedNames)}`,
    ),
    Match.tag("OnExpr", (e) => {
      const source = emitExpr(e.source, decls, mutNames, hoistedNames);
      const handler = emitExpr(e.handler, decls, mutNames, hoistedNames);
      return `subscribeToRef(${source}, ${handler})`;
    }),
    Match.tag("MatchExpr", (e) => {
      const scrutinee = emitExpr(e.scrutinee, decls, mutNames, hoistedNames);
      const arms = e.arms;
      const lastArm = arms[arms.length - 1];
      const lastIsWildcard = lastArm?.pattern._tag === "WildcardPattern";
      const lastIsBinding = lastArm?.pattern._tag === "BindingPattern";
      const allConstructor = arms.every(
        (a) =>
          a.pattern._tag === "ConstructorPattern" ||
          a.pattern._tag === "WildcardPattern" ||
          a.pattern._tag === "BindingPattern",
      );
      const hasConstructor = arms.some((a) => a.pattern._tag === "ConstructorPattern");

      // Check if any constructor tag appears in multiple arms (needs grouping)
      const ctorTagCounts = new Map<string, number>();
      for (const arm of arms) {
        if (arm.pattern._tag === "ConstructorPattern") {
          ctorTagCounts.set(arm.pattern.tag, (ctorTagCounts.get(arm.pattern.tag) ?? 0) + 1);
        }
      }
      const needsGrouping = Array.from(ctorTagCounts.values()).some((count) => count > 1);

      const parts: string[] = [];

      if (needsGrouping) {
        // Group constructor-pattern arms by outer tag, preserving order of first appearance
        const tagOrder: string[] = [];
        const tagGroups = new Map<string, ReadonlyArray<Ast.Arm>>();
        const nonCtorArms: Array<{ arm: Ast.Arm; isLast: boolean }> = [];

        for (let i = 0; i < arms.length; i++) {
          const arm = arms[i];
          const isLast = i === arms.length - 1;
          if (arm.pattern._tag === "ConstructorPattern") {
            const tag = arm.pattern.tag;
            if (!tagGroups.has(tag)) {
              tagOrder.push(tag);
              tagGroups.set(tag, []);
            }
            tagGroups.set(tag, [...(tagGroups.get(tag) ?? []), arm]);
          } else {
            nonCtorArms.push({ arm, isLast });
          }
        }

        // Emit grouped constructor arms
        for (const tag of tagOrder) {
          const group = tagGroups.get(tag) ?? [];
          if (group.length === 1) {
            // Single arm for this tag — emit flat Match.tag
            // NOTE: guards on grouped constructor arms are not yet supported in codegen.
            // The interpreter handles them correctly. This is a known v0.5.1 limitation.
            const arm = group[0];
            const pat = arm.pattern as Ast.ConstructorPattern;
            const body = emitExpr(arm.body, decls, mutNames, hoistedNames);
            if (pat.patterns.length === 0) {
              parts.push(`Match.tag("${pat.tag}", () => ${body})`);
            } else {
              const bindings = pat.patterns.map((sub, idx) => {
                if (sub._tag === "BindingPattern") return `_${idx}: ${sub.name}`;
                return `_${idx}`;
              });
              parts.push(`Match.tag("${pat.tag}", ({ ${bindings.join(", ")} }) => ${body})`);
            }
          } else {
            // Multiple arms for this tag — emit Match.tag with inner Match.value
            const innerParts: string[] = [];
            for (const arm of group) {
              const pat = arm.pattern as Ast.ConstructorPattern;
              const body = emitExpr(arm.body, decls, mutNames, hoistedNames);
              // Each sub-pattern of the outer constructor becomes a match on _0, _1, etc.
              // For now, handle the common single-field case
              if (pat.patterns.length === 1) {
                const sub = pat.patterns[0];
                if (sub._tag === "ConstructorPattern") {
                  if (sub.patterns.length === 0) {
                    innerParts.push(`Match.tag("${sub.tag}", () => ${body})`);
                  } else {
                    const subBindings = sub.patterns.map((s, idx) => {
                      if (s._tag === "BindingPattern") return `_${idx}: ${s.name}`;
                      return `_${idx}`;
                    });
                    innerParts.push(
                      `Match.tag("${sub.tag}", ({ ${subBindings.join(", ")} }) => ${body})`,
                    );
                  }
                } else if (sub._tag === "BindingPattern") {
                  innerParts.push(`Match.orElse((${sub.name}) => ${body})`);
                } else if (sub._tag === "WildcardPattern") {
                  innerParts.push(`Match.orElse(() => ${body})`);
                }
              } else if (pat.patterns.length === 0) {
                innerParts.push(`Match.orElse(() => ${body})`);
              }
            }
            // Check if all inner parts are constructor-based (for exhaustive)
            const allInnerCtor = group.every(
              (arm) =>
                (arm.pattern as Ast.ConstructorPattern).patterns.length === 1 &&
                (arm.pattern as Ast.ConstructorPattern).patterns[0]._tag === "ConstructorPattern",
            );
            if (allInnerCtor) {
              innerParts.push("Match.exhaustive");
            }
            const innerMatch = `Match.value(_0).pipe(\n      ${innerParts.join(",\n      ")}\n    )`;
            parts.push(`Match.tag("${tag}", ({ _0 }) => ${innerMatch})`);
          }
        }

        // Emit non-constructor arms (wildcard, binding, literal) at the end
        for (const { arm, isLast } of nonCtorArms) {
          const body = emitExpr(arm.body, decls, mutNames, hoistedNames);
          const hasGuard = Option.isSome(arm.guard);
          const guardCode = hasGuard
            ? emitExpr(arm.guard.value, decls, mutNames, hoistedNames)
            : "";
          if (
            isLast &&
            (arm.pattern._tag === "WildcardPattern" || arm.pattern._tag === "BindingPattern") &&
            !hasGuard
          ) {
            if (arm.pattern._tag === "BindingPattern") {
              parts.push(`Match.orElse((${arm.pattern.name}) => ${body})`);
            } else {
              parts.push(`Match.orElse(() => ${body})`);
            }
          } else if (arm.pattern._tag === "LiteralPattern") {
            const litVal = emitExpr(arm.pattern.value, decls, mutNames, hoistedNames);
            parts.push(`Match.when((v) => v === ${litVal}, () => ${body})`);
          } else if (arm.pattern._tag === "BindingPattern") {
            if (hasGuard) {
              parts.push(
                `Match.when((${arm.pattern.name}) => ${guardCode}, (${arm.pattern.name}) => ${body})`,
              );
            } else {
              parts.push(`Match.when(() => true, (${arm.pattern.name}) => ${body})`);
            }
          } else {
            if (hasGuard) {
              parts.push(`Match.when(() => ${guardCode}, () => ${body})`);
            } else {
              parts.push(`Match.when(() => true, () => ${body})`);
            }
          }
        }

        // Exhaustive if all constructor patterns and no wildcard/binding at end
        if (hasConstructor && allConstructor && !lastIsWildcard && !lastIsBinding) {
          parts.push("Match.exhaustive");
        }
      } else {
        // No grouping needed — original code path
        for (let i = 0; i < arms.length; i++) {
          const arm = arms[i];
          const isLast = i === arms.length - 1;
          const body = emitExpr(arm.body, decls, mutNames, hoistedNames);
          const hasGuard = Option.isSome(arm.guard);
          const guardCode = hasGuard
            ? emitExpr(arm.guard.value, decls, mutNames, hoistedNames)
            : "";

          if (isLast && (lastIsWildcard || lastIsBinding) && !hasGuard) {
            if (lastIsBinding && arm.pattern._tag === "BindingPattern") {
              parts.push(`Match.orElse((${arm.pattern.name}) => ${body})`);
            } else {
              parts.push(`Match.orElse(() => ${body})`);
            }
          } else if (arm.pattern._tag === "ConstructorPattern") {
            const pat = arm.pattern;
            if (hasGuard) {
              const bindings = pat.patterns.map((sub, idx) => {
                if (sub._tag === "BindingPattern") return `_${idx}: ${sub.name}`;
                return `_${idx}`;
              });
              const destructure = pat.patterns.length > 0 ? `({ ${bindings.join(", ")} })` : `()`;
              const tagCheck = `_v._tag === "${pat.tag}"`;
              const guardPred =
                pat.patterns.length > 0 ? `(${destructure} => ${guardCode})(${`_v`})` : guardCode;
              parts.push(
                `Match.when((_v) => ${tagCheck} && ${guardPred}, ${destructure} => ${body})`,
              );
            } else if (pat.patterns.length === 0) {
              parts.push(`Match.tag("${pat.tag}", () => ${body})`);
            } else {
              const bindings = pat.patterns.map((sub, idx) => {
                if (sub._tag === "BindingPattern") return `_${idx}: ${sub.name}`;
                return `_${idx}`;
              });
              parts.push(`Match.tag("${pat.tag}", ({ ${bindings.join(", ")} }) => ${body})`);
            }
          } else if (arm.pattern._tag === "LiteralPattern") {
            const litVal = emitExpr(arm.pattern.value, decls, mutNames, hoistedNames);
            if (hasGuard) {
              parts.push(`Match.when((v) => v === ${litVal} && ${guardCode}, () => ${body})`);
            } else {
              parts.push(`Match.when((v) => v === ${litVal}, () => ${body})`);
            }
          } else if (arm.pattern._tag === "BindingPattern") {
            if (hasGuard) {
              parts.push(
                `Match.when((${arm.pattern.name}) => ${guardCode}, (${arm.pattern.name}) => ${body})`,
              );
            } else {
              parts.push(`Match.when(() => true, (${arm.pattern.name}) => ${body})`);
            }
          } else {
            if (hasGuard) {
              parts.push(`Match.when(() => ${guardCode}, () => ${body})`);
            } else {
              parts.push(`Match.when(() => true, () => ${body})`);
            }
          }
        }

        if (hasConstructor && allConstructor && !lastIsWildcard && !lastIsBinding) {
          parts.push("Match.exhaustive");
        }
      }

      return `Match.value(${scrutinee}).pipe(\n  ${parts.join(",\n  ")}\n)`;
    }),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Statement emission (returns new WriterState)
// ---------------------------------------------------------------------------

const emitStatement = (
  w: WriterState,
  stmt: TypedAst.TypedStmt,
  decls: DeclMap,
  mutNames: ReadonlySet<string>,
): WriterState =>
  Match.value(stmt.node).pipe(
    Match.tag("Declaration", (node) => {
      const w1 = recordMapping(w, node.span);
      const { prefixLines, hoisted } = hoistMutReads(node.value, mutNames);
      const w2 = prefixLines.reduce((acc, line) => writeLine(acc, line), w1);
      const valueCode = emitExpr(node.value, decls, mutNames, hoisted);
      if (node.mutable) {
        return writeLine(w2, `const ${node.name} = yield* Ref.make(${valueCode})`);
      }
      return writeLine(w2, `const ${node.name} = ${valueCode}`);
    }),
    Match.tag("ForceStatement", (node) => {
      const w1 = recordMapping(w, node.span);
      if (node.expr._tag === "Force" && node.expr.expr._tag === "UseExpr") {
        const useExpr = node.expr.expr;
        const valueCode = emitExpr(useExpr.value, decls, mutNames);
        return writeLine(w1, `const ${useExpr.name} = yield* ${valueCode}`);
      }
      if (node.expr._tag === "Force") {
        return writeLine(w1, `yield* ${emitExpr(node.expr.expr, decls, mutNames)}`);
      }
      return writeLine(w1, `yield* ${emitExpr(node.expr, decls, mutNames)}`);
    }),
    Match.tag("ExprStatement", (node) => {
      const w1 = recordMapping(w, node.span);
      return writeLine(w1, emitExpr(node.expr, decls, mutNames));
    }),
    Match.tag("Declare", () => w), // already handled in wrapper generation
    Match.tag("TypeDecl", (node) => {
      const w1 = recordMapping(w, node.span);
      const lines = node.constructors.map((ctor) =>
        Match.value(ctor).pipe(
          Match.tag("NullaryConstructor", (c) => `const ${c.tag} = Data.tagged("${c.tag}")({})`),
          Match.tag("PositionalConstructor", (c) => {
            const params = c.fields.map((_, i) => `_${i}`);
            const fields = params.map((p) => `${p}`).join(", ");
            return `const ${c.tag} = (${params.join(", ")}) => Data.tagged("${c.tag}")({ ${fields} })`;
          }),
          Match.tag("NamedConstructor", (c) => {
            const fields = c.fields.map((f) => f.name);
            return `const ${c.tag} = ({ ${fields.join(", ")} }) => Data.tagged("${c.tag}")({ ${fields.join(", ")} })`;
          }),
          Match.exhaustive,
        ),
      );
      return lines.reduce((acc, line) => writeLine(acc, line), w1);
    }),
    Match.tag("NewtypeDecl", (node) => {
      const w1 = recordMapping(w, node.span);
      return writeLine(
        w1,
        `const ${node.name} = (value) => Data.tagged("${node.name}")({ _0: value })`,
      );
    }),
    Match.tag("RecordTypeDecl", (node) => {
      const w1 = recordMapping(w, node.span);
      const fields = node.fields.map((f) => f.name);
      return writeLine(
        w1,
        `const ${node.name} = ({ ${fields.join(", ")} }) => Data.tagged("${node.name}")({ ${fields.join(", ")} })`,
      );
    }),
    Match.tag("Import", (node) => {
      const w1 = recordMapping(w, node.span);
      const path = node.modulePath.map((p) => p.toLowerCase()).join("/");
      return writeLine(w1, `import { ${node.names.join(", ")} } from "./${path}"`);
    }),
    Match.tag("Export", (node) => {
      const w1 = recordMapping(w, node.span);
      return writeLine(w1, `export { ${node.names.join(", ")} }`);
    }),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Program generation
// ---------------------------------------------------------------------------

const exprContains = (expr: Ast.Expr, pred: (e: Ast.Expr) => boolean): boolean => {
  if (pred(expr)) return true;
  switch (expr._tag) {
    case "BinaryExpr":
      return exprContains(expr.left, pred) || exprContains(expr.right, pred);
    case "UnaryExpr":
      return exprContains(expr.expr, pred);
    case "Force":
      return exprContains(expr.expr, pred);
    case "App":
      return exprContains(expr.func, pred) || expr.args.some((a) => exprContains(a, pred));
    case "DotAccess":
      return exprContains(expr.object, pred);
    case "Block":
      return expr.statements.some((s) => stmtContains(s, pred)) || exprContains(expr.expr, pred);
    case "Lambda":
      return exprContains(expr.body, pred);
    case "MatchExpr":
      return (
        exprContains(expr.scrutinee, pred) || expr.arms.some((a) => exprContains(a.body, pred))
      );
    case "StringInterp":
      return expr.parts.some((p) => p._tag === "InterpExpr" && exprContains(p.value, pred));
    case "ComptimeExpr":
      return exprContains(expr.expr, pred);
    case "UseExpr":
      return exprContains(expr.value, pred);
    case "OnExpr":
      return exprContains(expr.source, pred) || exprContains(expr.handler, pred);
    default:
      return false;
  }
};

const stmtContains = (stmt: Ast.Stmt, pred: (e: Ast.Expr) => boolean): boolean => {
  switch (stmt._tag) {
    case "Declaration":
      return exprContains(stmt.value, pred);
    case "ForceStatement":
      return exprContains(stmt.expr, pred);
    case "ExprStatement":
      return exprContains(stmt.expr, pred);
    default:
      return false;
  }
};

const DOT_METHODS = new Set(["handle", "catch", "map", "tap"]);

const generateProgram = (program: TypedAst.TypedProgram): CodegenOutput => {
  const decls = collectDeclaredNames(program.statements);
  const hasForce = Arr.some(program.statements, (s) => s.node._tag === "ForceStatement");
  const hasTypeDecl = Arr.some(
    program.statements,
    (s) => s.node._tag === "TypeDecl" || s.node._tag === "NewtypeDecl",
  );
  const hasMatch = Arr.some(program.statements, (s) =>
    stmtContains(s.node, (e) => e._tag === "MatchExpr"),
  );
  const stmtHasMutExpr = (stmt: TypedAst.TypedStmt): boolean =>
    stmt.node._tag === "ForceStatement" &&
    stmt.node.expr._tag === "Force" &&
    stmt.node.expr.expr._tag === "BinaryExpr" &&
    stmt.node.expr.expr.op === "<-";
  const hasMut = Arr.some(
    program.statements,
    (s) => (s.node._tag === "Declaration" && s.node.mutable) || stmtHasMutExpr(s),
  );
  const hasDotMethod = Arr.some(program.statements, (s) =>
    stmtContains(
      s.node,
      (e) => e._tag === "App" && e.func._tag === "DotAccess" && DOT_METHODS.has(e.func.field),
    ),
  );
  const hasDotHandle = Arr.some(program.statements, (s) =>
    stmtContains(
      s.node,
      (e) => e._tag === "App" && e.func._tag === "DotAccess" && e.func.field === "handle",
    ),
  );
  const needsEffectImport = HashMap.size(decls) > 0 || hasForce || hasMut || hasDotMethod;
  const needsDataImport = hasTypeDecl;

  // Collect mutable binding names for Ref.get emission
  const mutNames = new Set<string>();
  for (const s of program.statements) {
    if (s.node._tag === "Declaration" && s.node.mutable) {
      mutNames.add(s.node.name);
    }
  }

  // Start building output
  const imports: string[] = [];
  if (needsEffectImport) imports.push("Effect");
  if (hasMut) imports.push("Ref");
  if (needsDataImport) imports.push("Data");
  if (hasMatch) imports.push("Match");
  if (hasDotMethod) imports.push("pipe");
  if (hasDotHandle) imports.push("Layer");
  const w0 =
    imports.length > 0
      ? writeBlankLine(writeLine(emptyWriter, `import { ${imports.join(", ")} } from "effect"`))
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

  // Emit user import statements at top level
  const importStmts = Arr.filter(program.statements, (s) => s.node._tag === "Import");
  const w1a = Arr.reduce(importStmts, w1, (w, stmt) => emitStatement(w, stmt, decls, mutNames));

  // Filter non-declare, non-import, non-export statements for body
  const bodyStmts = Arr.filter(
    program.statements,
    (s) => s.node._tag !== "Declare" && s.node._tag !== "Import" && s.node._tag !== "Export",
  );

  // Collect export statements for emission after body
  const exportStmts = Arr.filter(program.statements, (s) => s.node._tag === "Export");

  if (hasForce || hasMut) {
    // Wrap in Effect.gen + runPromise
    const w2 = pushIndent(writeLine(w1a, "const main = Effect.gen(function*() {"));
    const w3 = Arr.reduce(bodyStmts, w2, (w, stmt) => emitStatement(w, stmt, decls, mutNames));
    const w4 = writeLine(popIndent(w3), "})");
    const w5 = writeLine(writeBlankLine(w4), "Effect.runPromise(main)");
    const w6 = Arr.reduce(exportStmts, w5, (w, stmt) => emitStatement(w, stmt, decls, mutNames));
    return { code: writerToString(w6), sourceMap: w6.sourceMap };
  }

  const w2 = Arr.reduce(bodyStmts, w1a, (w, stmt) => emitStatement(w, stmt, decls, mutNames));
  const w3 = Arr.reduce(exportStmts, w2, (w, stmt) => emitStatement(w, stmt, decls, mutNames));
  return { code: writerToString(w3), sourceMap: w3.sourceMap };
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
