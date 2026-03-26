import { Doc } from "@effect/printer";
import { Effect, Match, Option } from "effect";
import * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import * as Lexer from "./Lexer.js";
import * as Parser from "./Parser.js";

// ---------------------------------------------------------------------------
// Precedence table (higher = tighter binding)
// ---------------------------------------------------------------------------

const PREC: Record<string, number> = {
  "<-": 1,
  xor: 4,
  or: 5,
  and: 6,
  "==": 7,
  "!=": 7,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  "+": 8,
  "-": 8,
  "++": 8,
  "*": 9,
  "/": 9,
  "%": 9,
};

// ---------------------------------------------------------------------------
// Expression formatting
// ---------------------------------------------------------------------------

const isAtom = (e: Ast.Expr): boolean => {
  const tag = e._tag;
  return (
    tag === "Ident" ||
    tag === "IntLiteral" ||
    tag === "FloatLiteral" ||
    tag === "StringLiteral" ||
    tag === "BoolLiteral" ||
    tag === "UnitLiteral" ||
    tag === "Block" ||
    tag === "StringInterp" ||
    tag === "DotAccess"
  );
};

const parenIfNonAtom = (e: Ast.Expr): Doc.Doc<never> => {
  if (isAtom(e)) return formatExpr(e);
  return Doc.hcat([Doc.text("("), formatExpr(e), Doc.text(")")]);
};

const parenIfLowerPrec = (child: Ast.Expr, parentOp: string, isRight: boolean): Doc.Doc<never> => {
  const childDoc = formatExpr(child);
  if (child._tag === "BinaryExpr") {
    const childPrec = PREC[child.op] ?? 0;
    const parentPrec = PREC[parentOp] ?? 0;
    // Paren if strictly lower, OR equal precedence on right side (preserves associativity)
    if (childPrec < parentPrec || (isRight && childPrec === parentPrec)) {
      return Doc.hcat([Doc.text("("), childDoc, Doc.text(")")]);
    }
  }
  return childDoc;
};

const formatBinaryExpr = (e: Ast.BinaryExpr): Doc.Doc<never> => {
  const left = parenIfLowerPrec(e.left, e.op, false);
  const right = parenIfLowerPrec(e.right, e.op, true);
  const op = Doc.text(e.op);
  return Doc.group(Doc.hcat([left, Doc.catWithSoftLine(Doc.cat(Doc.text(" "), op), right)]));
};

const formatUnaryExpr = (e: Ast.UnaryExpr): Doc.Doc<never> => {
  if (e.op === "not") return Doc.catWithSpace(Doc.text("not"), parenIfNonAtom(e.expr));
  return Doc.cat(Doc.text(e.op), parenIfNonAtom(e.expr));
};

const formatExpr = (expr: Ast.Expr): Doc.Doc<never> =>
  Match.value(expr).pipe(
    Match.tag("IntLiteral", (e) => Doc.text(String(e.value))),
    Match.tag("FloatLiteral", (e) => Doc.text(String(e.value))),
    Match.tag("StringLiteral", (e) => Doc.text(`"${e.value}"`)),
    Match.tag("BoolLiteral", (e) => Doc.text(String(e.value))),
    Match.tag("UnitLiteral", () => Doc.text("()")),
    Match.tag("Ident", (e) => Doc.text(e.name)),
    Match.tag("BinaryExpr", (e) => formatBinaryExpr(e)),
    Match.tag("UnaryExpr", (e) => formatUnaryExpr(e)),
    Match.tag("Force", (e) => Doc.cat(Doc.text("!"), formatExpr(e.expr))),
    Match.tag("DotAccess", (e) =>
      Doc.hcat([formatExpr(e.object), Doc.text("."), Doc.text(e.field)]),
    ),
    Match.tag("Block", (e) => {
      const stmtDocs = e.statements.map((s) => Doc.cat(formatTopLevelStmt(s), Doc.text(";")));
      const bodyParts = [...stmtDocs, formatExpr(e.expr)];
      const body = bodyParts.reduce((a, b) => Doc.catWithSoftLine(a, b));
      // Note: Doc.nest inside Doc.group triggers a flatten bug in @effect/printer.
      // Using flat-only layout for now. Indentation deferred until the bug is resolved
      // or we switch to a different rendering approach.
      return Doc.group(
        Doc.hcat([Doc.text("{"), Doc.catWithSoftLine(Doc.empty, body), Doc.text(" }")]),
      );
    }),
    Match.tag("Lambda", (e) => {
      const params = Doc.hsep(e.params.map(Doc.text));
      return Doc.hcat([params, Doc.text(" -> "), formatExpr(e.body)]);
    }),
    Match.tag("App", (e) => {
      const func = formatExpr(e.func);
      const args = e.args.map(parenIfNonAtom);
      return Doc.hsep([func, ...args]);
    }),
    Match.tag("StringInterp", (e) => {
      const parts = e.parts.map((p) =>
        p._tag === "InterpText"
          ? Doc.text(p.value)
          : Doc.hcat([Doc.text("${"), formatExpr(p.value), Doc.text("}")]),
      );
      return Doc.hcat([Doc.text('"'), ...parts, Doc.text('"')]);
    }),
    Match.tag("MatchExpr", () => Doc.text("match { ... }")),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Type formatting
// ---------------------------------------------------------------------------

const formatType = (type: Ast.Type): Doc.Doc<never> =>
  Match.value(type).pipe(
    Match.tag("ConcreteType", (t) => Doc.text(t.name)),
    Match.tag("ArrowType", (t) =>
      Doc.hcat([formatType(t.param), Doc.text(" -> "), formatType(t.result)]),
    ),
    Match.tag("EffectType", (t) => {
      const deps = t.deps.map(Doc.text);
      const parts: Array<Doc.Doc<never>> = [
        Doc.text("Effect "),
        formatType(t.value),
        Doc.text(" { "),
      ];
      if (deps.length > 0) {
        parts.push(Doc.hsep(deps));
      }
      parts.push(Doc.text(" } "));
      parts.push(formatType(t.error));
      return Doc.hcat(parts);
    }),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Statement formatting
// ---------------------------------------------------------------------------

const formatTopLevelStmt = (stmt: Ast.Stmt): Doc.Doc<never> =>
  Match.value(stmt).pipe(
    Match.tag("Declaration", (s) => {
      const parts: Array<Doc.Doc<never>> = [];
      if (s.mutable) parts.push(Doc.text("mut "));
      parts.push(Doc.text(s.name));
      if (Option.isSome(s.typeAnnotation)) {
        parts.push(Doc.text(" : "));
        parts.push(formatType(s.typeAnnotation.value));
      }
      parts.push(Doc.text(" = "));
      parts.push(formatExpr(s.value));
      return Doc.hcat(parts);
    }),
    Match.tag("Declare", (s) =>
      Doc.hcat([
        Doc.text("declare "),
        Doc.text(s.name),
        Doc.text(" : "),
        formatType(s.typeAnnotation),
      ]),
    ),
    Match.tag("ForceStatement", (s) => formatExpr(s.expr)),
    Match.tag("ExprStatement", (s) => formatExpr(s.expr)),
    Match.tag("TypeDecl", (s) => {
      const params = s.typeParams.length > 0 ? " " + s.typeParams.join(" ") : "";
      const ctors = s.constructors.map((ctor) =>
        Match.value(ctor).pipe(
          Match.tag("NullaryConstructor", (c) => Doc.text(c.tag)),
          Match.tag("PositionalConstructor", (c) => {
            const fields = c.fields.map((f) => formatType(f));
            return Doc.hsep([Doc.text(c.tag), ...fields]);
          }),
          Match.tag("NamedConstructor", (c) => {
            const fields = c.fields.map((f) =>
              Doc.hcat([Doc.text(f.name), Doc.text(" : "), formatType(f.type)]),
            );
            const inner = fields.reduce((a, b) => Doc.hcat([a, Doc.text(", "), b]));
            return Doc.hcat([Doc.text(c.tag), Doc.text(" { "), inner, Doc.text(" }")]);
          }),
          Match.exhaustive,
        ),
      );
      const ctorDoc = ctors.reduce((a, b) => Doc.hcat([a, Doc.text(" | "), b]));
      return Doc.hcat([Doc.text(`type ${s.name}${params} = `), ctorDoc]);
    }),
    Match.tag("Mutation", (s) =>
      Doc.hcat([Doc.text(s.target), Doc.text(" <- "), formatExpr(s.value)]),
    ),
    Match.tag("Import", (s) =>
      Doc.text(`import ${s.modulePath.join(".")}.{${s.names.join(", ")}}`),
    ),
    Match.tag("Export", (s) => Doc.text(`export {${s.names.join(", ")}}`)),
    Match.exhaustive,
  );

// ---------------------------------------------------------------------------
// Program formatting
// ---------------------------------------------------------------------------

const formatProgram = (program: Ast.Program): Doc.Doc<never> => {
  const stmts = program.statements.map(formatTopLevelStmt);
  if (stmts.length === 0) return Doc.empty;
  const separator = Doc.cat(Doc.hardLine, Doc.hardLine);
  return stmts.reduce((acc, s) => Doc.hcat([acc, separator, s]));
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Format an AST program to canonical Bang source string. */
export const format = (program: Ast.Program): string => {
  const doc = formatProgram(program);
  return Doc.render(doc, { style: "pretty", options: { lineWidth: 80 } });
};

/** Parse source, then format to canonical form. */
export const formatSource = (source: string): Effect.Effect<string, CompilerError> =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return format(ast);
  });
