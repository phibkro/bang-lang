import { Effect, Option } from "effect";
import * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import { ParseError } from "./CompilerError.js";
import * as Span from "./Span.js";
import type { Token } from "./Token.js";

// ---------------------------------------------------------------------------
// Immutable parse state
// ---------------------------------------------------------------------------

interface ParseState {
  readonly tokens: ReadonlyArray<Token>;
  readonly pos: number;
}

const makeState = (tokens: ReadonlyArray<Token>): ParseState => ({
  tokens,
  pos: 0,
});

// ---------------------------------------------------------------------------
// State primitives (all Effects)
// ---------------------------------------------------------------------------

const peek = (s: ParseState): Effect.Effect<Token, never> =>
  Option.match(Option.fromNullable(s.tokens[s.pos]), {
    onSome: Effect.succeed,
    onNone: () =>
      Option.match(Option.fromNullable(s.tokens[s.tokens.length - 1]), {
        onSome: Effect.succeed,
        onNone: () => Effect.die(new Error("Empty token array")),
      }),
  });

const peekAt = (s: ParseState, ahead: number): Option.Option<Token> =>
  Option.fromNullable(s.tokens[s.pos + ahead]);

const advance = (s: ParseState): Effect.Effect<readonly [Token, ParseState], never> =>
  Effect.map(peek(s), (t) => [t, { ...s, pos: s.pos + 1 }] as const);

const isAtEnd = (s: ParseState): Effect.Effect<boolean, never> =>
  Effect.map(peek(s), (t) => t._tag === "EOF");

// ---------------------------------------------------------------------------
// Token accessors
// ---------------------------------------------------------------------------

const tokenSpan = (t: Token): Span.Span => {
  if ("span" in t) return t.span as Span.Span;
  return Span.empty;
};

const tokenValue = (t: Token): string => {
  if ("value" in t && typeof t.value === "string") return t.value;
  return "";
};

const tokenBoolValue = (t: Token): boolean => {
  if ("value" in t && typeof t.value === "boolean") return t.value;
  return false;
};

const tokenTag = (t: Token): string => t._tag;

const tokenDescription = (t: Token): string =>
  "value" in t ? `${tokenTag(t)}(${String(t.value)})` : tokenTag(t);

// ---------------------------------------------------------------------------
// Parse primitives
// ---------------------------------------------------------------------------

type P<A> = Effect.Effect<readonly [A, ParseState], CompilerError>;

const check = (s: ParseState, tag: string, value?: string): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const t = yield* peek(s);
    if (tokenTag(t) !== tag) return false;
    if (value !== undefined && tokenValue(t) !== value) return false;
    return true;
  });

const expect = (s: ParseState, tag: string, value?: string): P<Token> =>
  Effect.gen(function* () {
    const matches = yield* check(s, tag, value);
    if (!matches) {
      const t = yield* peek(s);
      const expected = value !== undefined ? `${tag}(${value})` : tag;
      return yield* Effect.fail(
        new ParseError({
          message: `Expected ${expected}, got ${tokenDescription(t)}`,
          span: tokenSpan(t),
        }),
      );
    }
    return yield* advance(s);
  });

const fail = (message: string, s: ParseState): Effect.Effect<never, CompilerError> =>
  Effect.flatMap(peek(s), (t) => Effect.fail(new ParseError({ message, span: tokenSpan(t) })));

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const parseProgram = (s: ParseState): P<Ast.Program> =>
  Effect.gen(function* () {
    const startT = yield* peek(s);
    const startSpan = tokenSpan(startT);

    const go = (stmts: ReadonlyArray<Ast.Stmt>, st: ParseState): P<Ast.Program> =>
      Effect.gen(function* () {
        const atEnd = yield* isAtEnd(st);
        if (atEnd) {
          const endT = yield* peek(st);
          return [
            new Ast.Program({
              statements: [...stmts],
              span: Span.merge(startSpan, tokenSpan(endT)),
            }),
            st,
          ] as const;
        }
        const [stmt, st2] = yield* parseStatement(st);
        return yield* go([...stmts, stmt], st2);
      });

    return yield* go([], s);
  });

// ---------------------------------------------------------------------------
// Statement dispatch
// ---------------------------------------------------------------------------

const parseStatement = (s: ParseState): P<Ast.Stmt> =>
  Effect.gen(function* () {
    const t = yield* peek(s);

    if (tokenTag(t) === "Keyword" && tokenValue(t) === "declare") return yield* parseDeclare(s);
    if (tokenTag(t) === "Operator" && tokenValue(t) === "!") return yield* parseForceStatement(s);
    if (tokenTag(t) === "Ident") {
      return yield* Option.match(peekAt(s, 1), {
        onNone: () => parseExprStatement(s),
        onSome: (next) =>
          tokenTag(next) === "Operator" && tokenValue(next) === "="
            ? parseDeclaration(s)
            : parseExprStatement(s),
      });
    }

    return yield* fail(`Unexpected token at statement position: ${tokenDescription(t)}`, s);
  });

// ---------------------------------------------------------------------------
// Declare
// ---------------------------------------------------------------------------

const parseDeclare = (s: ParseState): P<Ast.Declare> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "Keyword", "declare");
    const [name, s2] = yield* parseDottedName(s1);
    const [, s3] = yield* expect(s2, "Delimiter", ":");
    const [typeAnnotation, s4] = yield* parseType(s3);
    return [
      new Ast.Declare({
        name,
        typeAnnotation,
        span: Span.merge(tokenSpan(startTok), typeAnnotation.span),
      }),
      s4,
    ] as const;
  });

const parseDottedName = (s: ParseState): P<string> =>
  Effect.gen(function* () {
    const [tok, s1] = yield* expect(s, "Ident");
    const go = (name: string, st: ParseState): P<string> =>
      Effect.gen(function* () {
        const atEnd = yield* isAtEnd(st);
        const isDot = yield* check(st, "Operator", ".");
        if (atEnd || !isDot) return [name, st] as const;
        const [, st2] = yield* advance(st);
        const [part, st3] = yield* expect(st2, "Ident");
        return yield* go(`${name}.${tokenValue(part)}`, st3);
      });
    return yield* go(tokenValue(tok), s1);
  });

// ---------------------------------------------------------------------------
// Declaration
// ---------------------------------------------------------------------------

const parseDeclaration = (s: ParseState): P<Ast.Declaration> =>
  Effect.gen(function* () {
    const [nameTok, s1] = yield* expect(s, "Ident");
    const [, s2] = yield* expect(s1, "Operator", "=");
    const [value, s3] = yield* parseExpr(s2);
    return [
      new Ast.Declaration({
        name: tokenValue(nameTok),
        mutable: false,
        value,
        typeAnnotation: Option.none(),
        span: Span.merge(tokenSpan(nameTok), value.span),
      }),
      s3,
    ] as const;
  });

// ---------------------------------------------------------------------------
// Force statement
// ---------------------------------------------------------------------------

const parseForceStatement = (s: ParseState): P<Ast.ForceStatement> =>
  Effect.gen(function* () {
    const [bangTok, s1] = yield* expect(s, "Operator", "!");
    const [expr, s2] = yield* parseExpr(s1);
    const force = new Ast.Force({ expr, span: Span.merge(tokenSpan(bangTok), expr.span) });
    return [
      new Ast.ForceStatement({ expr: force, span: Span.merge(tokenSpan(bangTok), expr.span) }),
      s2,
    ] as const;
  });

// ---------------------------------------------------------------------------
// Expr statement
// ---------------------------------------------------------------------------

const parseExprStatement = (s: ParseState): P<Ast.ExprStatement> =>
  Effect.map(
    parseExpr(s),
    ([expr, s1]) => [new Ast.ExprStatement({ expr, span: expr.span }), s1] as const,
  );

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

const parseExpr = (s: ParseState): P<Ast.Expr> =>
  Effect.gen(function* () {
    const [primary, s1] = yield* parsePrimary(s);
    const [dotExpr, s2] = yield* parseDotAccess(primary, s1);
    return yield* parseApplication(dotExpr, s2);
  });

const parseDotAccess = (expr: Ast.Expr, s: ParseState): P<Ast.Expr> =>
  Effect.gen(function* () {
    const atEnd = yield* isAtEnd(s);
    const isDot = yield* check(s, "Operator", ".");
    if (atEnd || !isDot) return [expr, s] as const;
    const [, s1] = yield* advance(s);
    const [fieldTok, s2] = yield* expect(s1, "Ident");
    const dotExpr = new Ast.DotAccess({
      object: expr,
      field: tokenValue(fieldTok),
      span: Span.merge(expr.span, tokenSpan(fieldTok)),
    });
    return yield* parseDotAccess(dotExpr, s2);
  });

const parseApplication = (func: Ast.Expr, s: ParseState): P<Ast.Expr> =>
  Effect.gen(function* () {
    const atEnd = yield* isAtEnd(s);
    const t = yield* peek(s);
    if (atEnd || !isArgStart(t)) return [func, s] as const;

    const collectArgs = (
      args: ReadonlyArray<Ast.Expr>,
      st: ParseState,
    ): P<ReadonlyArray<Ast.Expr>> =>
      Effect.gen(function* () {
        const end = yield* isAtEnd(st);
        const curr = yield* peek(st);
        if (end || !isArgStart(curr)) return [args, st] as const;
        const [arg, st2] = yield* parsePrimary(st);
        return yield* collectArgs([...args, arg], st2);
      });

    const [args, s2] = yield* collectArgs([], s);
    const lastArg = args[args.length - 1];
    const endSpan = lastArg !== undefined ? lastArg.span : func.span;
    return [
      new Ast.App({ func, args: [...args], span: Span.merge(func.span, endSpan) }),
      s2,
    ] as const;
  });

const isArgStart = (t: Token): boolean => {
  const tag = tokenTag(t);
  return (
    tag === "Ident" ||
    tag === "TypeIdent" ||
    tag === "StringLit" ||
    tag === "IntLit" ||
    tag === "FloatLit" ||
    tag === "BoolLit" ||
    tag === "Unit"
  );
};

const parsePrimary = (s: ParseState): P<Ast.Expr> =>
  Effect.gen(function* () {
    const t = yield* peek(s);
    const tag = tokenTag(t);

    if (tag === "Ident") {
      const [tok, s1] = yield* advance(s);
      return [new Ast.Ident({ name: tokenValue(tok), span: tokenSpan(tok) }), s1] as const;
    }
    if (tag === "TypeIdent") {
      const [tok, s1] = yield* advance(s);
      return [new Ast.Ident({ name: tokenValue(tok), span: tokenSpan(tok) }), s1] as const;
    }
    if (tag === "StringLit") {
      const [tok, s1] = yield* advance(s);
      return [new Ast.StringLiteral({ value: tokenValue(tok), span: tokenSpan(tok) }), s1] as const;
    }
    if (tag === "IntLit") {
      const [tok, s1] = yield* advance(s);
      return [
        new Ast.IntLiteral({ value: Number(tokenValue(tok)), span: tokenSpan(tok) }),
        s1,
      ] as const;
    }
    if (tag === "BoolLit") {
      const [tok, s1] = yield* advance(s);
      return [
        new Ast.BoolLiteral({ value: tokenBoolValue(tok), span: tokenSpan(tok) }),
        s1,
      ] as const;
    }
    if (tag === "Unit") {
      const [tok, s1] = yield* advance(s);
      return [new Ast.UnitLiteral({ span: tokenSpan(tok) }), s1] as const;
    }

    return yield* fail(`Expected expression, got ${tokenDescription(t)}`, s);
  });

// ---------------------------------------------------------------------------
// Type parsing
// ---------------------------------------------------------------------------

const parseType = (s: ParseState): P<Ast.Type> =>
  Effect.gen(function* () {
    const [left, s1] = yield* parsePrimaryType(s);
    const atEnd = yield* isAtEnd(s1);
    const isArrow = yield* check(s1, "Operator", "->");
    if (!atEnd && isArrow) {
      const [, s2] = yield* advance(s1);
      const [result, s3] = yield* parseType(s2);
      return [
        new Ast.ArrowType({ param: left, result, span: Span.merge(left.span, result.span) }),
        s3,
      ] as const;
    }
    return [left, s1] as const;
  });

const parsePrimaryType = (s: ParseState): P<Ast.Type> =>
  Effect.gen(function* () {
    const t = yield* peek(s);

    if (tokenTag(t) === "TypeIdent" && tokenValue(t) === "Effect") return yield* parseEffectType(s);

    if (tokenTag(t) === "TypeIdent") {
      const [tok, s1] = yield* advance(s);
      return [new Ast.ConcreteType({ name: tokenValue(tok), span: tokenSpan(tok) }), s1] as const;
    }

    // {} in type position → ConcreteType("Unit")
    if (tokenTag(t) === "Delimiter" && tokenValue(t) === "{") {
      return yield* Option.match(peekAt(s, 1), {
        onNone: () => fail(`Expected type, got ${tokenDescription(t)}`, s),
        onSome: (next) => {
          if (tokenTag(next) === "Delimiter" && tokenValue(next) === "}") {
            return Effect.gen(function* () {
              const [startTok, s1] = yield* advance(s);
              const [endTok, s2] = yield* advance(s1);
              return [
                new Ast.ConcreteType({
                  name: "Unit",
                  span: Span.merge(tokenSpan(startTok), tokenSpan(endTok)),
                }),
                s2,
              ] as const;
            });
          }
          return fail(`Expected type, got ${tokenDescription(t)}`, s);
        },
      });
    }

    return yield* fail(`Expected type, got ${tokenDescription(t)}`, s);
  });

const parseEffectType = (s: ParseState): P<Ast.EffectType> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "TypeIdent", "Effect");
    const [value, s2] = yield* parsePrimaryType(s1);
    const [, s3] = yield* expect(s2, "Delimiter", "{");
    const [deps, s4] = yield* parseDeps(s3);
    const [, s5] = yield* expect(s4, "Delimiter", "}");
    const [error, s6] = yield* parsePrimaryType(s5);
    return [
      new Ast.EffectType({ value, deps, error, span: Span.merge(tokenSpan(startTok), error.span) }),
      s6,
    ] as const;
  });

const parseDeps = (s: ParseState): P<ReadonlyArray<string>> => {
  const go = (deps: ReadonlyArray<string>, st: ParseState): P<ReadonlyArray<string>> =>
    Effect.gen(function* () {
      const atEnd = yield* isAtEnd(st);
      const isClose = yield* check(st, "Delimiter", "}");
      if (atEnd || isClose) return [deps, st] as const;
      const [tok, st2] = yield* expect(st, "Ident");
      return yield* go([...deps, tokenValue(tok)], st2);
    });
  return go([], s);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const parse = (tokens: ReadonlyArray<Token>): Effect.Effect<Ast.Program, CompilerError> =>
  Effect.map(parseProgram(makeState(tokens)), ([program]) => program);
