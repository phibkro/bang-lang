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

const peek = (s: ParseState): Token => {
  const t = s.tokens[s.pos];
  if (t !== undefined) return t;
  const last = s.tokens[s.tokens.length - 1];
  if (last !== undefined) return last;
  throw new Error("Empty token array"); // unreachable — tokenize always produces EOF
};

const peekAt = (s: ParseState, ahead: number): Option.Option<Token> =>
  Option.fromNullable(s.tokens[s.pos + ahead]);

const advance = (s: ParseState): readonly [Token, ParseState] =>
  [peek(s), { ...s, pos: s.pos + 1 }] as const;

const isAtEnd = (s: ParseState): boolean => peek(s)._tag === "EOF";

// ---------------------------------------------------------------------------
// Token accessors (type-safe — no `any`)
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
// Parse primitives (return Effect to short-circuit on error)
// ---------------------------------------------------------------------------

type P<A> = Effect.Effect<readonly [A, ParseState], CompilerError>;

const check = (s: ParseState, tag: string, value?: string): boolean => {
  const t = peek(s);
  if (tokenTag(t) !== tag) return false;
  if (value !== undefined && tokenValue(t) !== value) return false;
  return true;
};

const expect = (s: ParseState, tag: string, value?: string): P<Token> => {
  if (!check(s, tag, value)) {
    const t = peek(s);
    const expected = value !== undefined ? `${tag}(${value})` : tag;
    return Effect.fail(
      ParseError({
        message: `Expected ${expected}, got ${tokenDescription(t)}`,
        span: tokenSpan(t),
      }),
    );
  }
  return Effect.succeed(advance(s));
};

const fail = (message: string, s: ParseState): Effect.Effect<never, CompilerError> =>
  Effect.fail(ParseError({ message, span: tokenSpan(peek(s)) }));

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const parseProgram = (s: ParseState): P<Ast.Program> => {
  const startSpan = tokenSpan(peek(s));
  const go = (stmts: ReadonlyArray<Ast.Stmt>, st: ParseState): P<Ast.Program> => {
    if (isAtEnd(st)) {
      const endSpan = tokenSpan(peek(st));
      return Effect.succeed([
        Ast.Program({ statements: [...stmts], span: Span.merge(startSpan, endSpan) }),
        st,
      ] as const);
    }
    return Effect.flatMap(parseStatement(st), ([stmt, st2]) => go([...stmts, stmt], st2));
  };
  return go([], s);
};

// ---------------------------------------------------------------------------
// Statement dispatch
// ---------------------------------------------------------------------------

const parseStatement = (s: ParseState): P<Ast.Stmt> => {
  const t = peek(s);

  if (tokenTag(t) === "Keyword" && tokenValue(t) === "declare") return parseDeclare(s);
  if (tokenTag(t) === "Operator" && tokenValue(t) === "!") return parseForceStatement(s);
  if (tokenTag(t) === "Ident") {
    return Option.match(peekAt(s, 1), {
      onNone: () => parseExprStatement(s),
      onSome: (next) =>
        tokenTag(next) === "Operator" && tokenValue(next) === "="
          ? parseDeclaration(s)
          : parseExprStatement(s),
    });
  }

  return fail(`Unexpected token at statement position: ${tokenDescription(t)}`, s);
};

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
      Ast.Declare({
        name,
        typeAnnotation,
        span: Span.merge(tokenSpan(startTok), typeAnnotation.span),
      }),
      s4,
    ] as const;
  });

const parseDottedName = (s: ParseState): P<string> =>
  Effect.flatMap(expect(s, "Ident"), ([tok, s1]) => {
    const go = (name: string, st: ParseState): P<string> => {
      if (isAtEnd(st) || !check(st, "Operator", ".")) return Effect.succeed([name, st] as const);
      const [, st2] = advance(st); // consume .
      return Effect.flatMap(expect(st2, "Ident"), ([part, st3]) =>
        go(`${name}.${tokenValue(part)}`, st3),
      );
    };
    return go(tokenValue(tok), s1);
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
      Ast.Declaration({
        name: tokenValue(nameTok),
        mutable: false,
        value,
        typeAnnotation: undefined,
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
    const force = Ast.Force({ expr, span: Span.merge(tokenSpan(bangTok), expr.span) });
    return [
      Ast.ForceStatement({ expr: force, span: Span.merge(tokenSpan(bangTok), expr.span) }),
      s2,
    ] as const;
  });

// ---------------------------------------------------------------------------
// Expr statement
// ---------------------------------------------------------------------------

const parseExprStatement = (s: ParseState): P<Ast.ExprStatement> =>
  Effect.map(
    parseExpr(s),
    ([expr, s1]) => [Ast.ExprStatement({ expr, span: expr.span }), s1] as const,
  );

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

const parseExpr = (s: ParseState): P<Ast.Expr> =>
  Effect.flatMap(parsePrimary(s), ([primary, s1]) =>
    Effect.flatMap(parseDotAccess(primary, s1), ([dotExpr, s2]) => parseApplication(dotExpr, s2)),
  );

const parseDotAccess = (expr: Ast.Expr, s: ParseState): P<Ast.Expr> => {
  if (isAtEnd(s) || !check(s, "Operator", ".")) return Effect.succeed([expr, s] as const);
  const [, s1] = advance(s); // consume .
  return Effect.flatMap(expect(s1, "Ident"), ([fieldTok, s2]) => {
    const dotExpr = Ast.DotAccess({
      object: expr,
      field: tokenValue(fieldTok),
      span: Span.merge(expr.span, tokenSpan(fieldTok)),
    });
    return parseDotAccess(dotExpr, s2); // recurse for chained dots
  });
};

const parseApplication = (func: Ast.Expr, s: ParseState): P<Ast.Expr> => {
  if (isAtEnd(s) || !isArgStart(peek(s))) return Effect.succeed([func, s] as const);
  const collectArgs = (
    args: ReadonlyArray<Ast.Expr>,
    st: ParseState,
  ): P<ReadonlyArray<Ast.Expr>> => {
    if (isAtEnd(st) || !isArgStart(peek(st))) return Effect.succeed([args, st] as const);
    return Effect.flatMap(parsePrimary(st), ([arg, st2]) => collectArgs([...args, arg], st2));
  };
  return Effect.map(collectArgs([], s), ([args, s2]) => {
    const lastArg = args[args.length - 1] ?? func; // fallback to func span if no args (unreachable)
    return [
      Ast.App({ func, args: [...args], span: Span.merge(func.span, lastArg.span) }),
      s2,
    ] as const;
  });
};

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

const parsePrimary = (s: ParseState): P<Ast.Expr> => {
  const t = peek(s);
  const tag = tokenTag(t);

  if (tag === "Ident") {
    const [tok, s1] = advance(s);
    return Effect.succeed([
      Ast.Ident({ name: tokenValue(tok), span: tokenSpan(tok) }),
      s1,
    ] as const);
  }
  if (tag === "TypeIdent") {
    const [tok, s1] = advance(s);
    return Effect.succeed([
      Ast.Ident({ name: tokenValue(tok), span: tokenSpan(tok) }),
      s1,
    ] as const);
  }
  if (tag === "StringLit") {
    const [tok, s1] = advance(s);
    return Effect.succeed([
      Ast.StringLiteral({ value: tokenValue(tok), span: tokenSpan(tok) }),
      s1,
    ] as const);
  }
  if (tag === "IntLit") {
    const [tok, s1] = advance(s);
    return Effect.succeed([
      Ast.IntLiteral({ value: Number(tokenValue(tok)), span: tokenSpan(tok) }),
      s1,
    ] as const);
  }
  if (tag === "BoolLit") {
    const [tok, s1] = advance(s);
    return Effect.succeed([
      Ast.BoolLiteral({ value: tokenBoolValue(tok), span: tokenSpan(tok) }),
      s1,
    ] as const);
  }
  if (tag === "Unit") {
    const [tok, s1] = advance(s);
    return Effect.succeed([Ast.UnitLiteral({ span: tokenSpan(tok) }), s1] as const);
  }

  return fail(`Expected expression, got ${tokenDescription(t)}`, s);
};

// ---------------------------------------------------------------------------
// Type parsing
// ---------------------------------------------------------------------------

const parseType = (s: ParseState): P<Ast.Type> =>
  Effect.flatMap(parsePrimaryType(s), ([left, s1]) => {
    if (!isAtEnd(s1) && check(s1, "Operator", "->")) {
      const [, s2] = advance(s1); // consume ->
      return Effect.map(
        parseType(s2),
        ([result, s3]) =>
          [
            Ast.ArrowType({ param: left, result, span: Span.merge(left.span, result.span) }),
            s3,
          ] as const,
      );
    }
    return Effect.succeed([left, s1] as const);
  });

const parsePrimaryType = (s: ParseState): P<Ast.Type> => {
  const t = peek(s);

  if (tokenTag(t) === "TypeIdent" && tokenValue(t) === "Effect") return parseEffectType(s);

  if (tokenTag(t) === "TypeIdent") {
    const [tok, s1] = advance(s);
    return Effect.succeed([
      Ast.ConcreteType({ name: tokenValue(tok), span: tokenSpan(tok) }),
      s1,
    ] as const);
  }

  // {} in type position → ConcreteType("Unit")
  if (tokenTag(t) === "Delimiter" && tokenValue(t) === "{") {
    return Option.match(peekAt(s, 1), {
      onNone: () => fail(`Expected type, got ${tokenDescription(t)}`, s),
      onSome: (next) => {
        if (tokenTag(next) === "Delimiter" && tokenValue(next) === "}") {
          const [startTok, s1] = advance(s);
          const [endTok, s2] = advance(s1);
          return Effect.succeed([
            Ast.ConcreteType({
              name: "Unit",
              span: Span.merge(tokenSpan(startTok), tokenSpan(endTok)),
            }),
            s2,
          ] as const);
        }
        return fail(`Expected type, got ${tokenDescription(t)}`, s);
      },
    });
  }

  return fail(`Expected type, got ${tokenDescription(t)}`, s);
};

const parseEffectType = (s: ParseState): P<Ast.EffectType> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "TypeIdent", "Effect");
    const [value, s2] = yield* parsePrimaryType(s1);
    const [, s3] = yield* expect(s2, "Delimiter", "{");
    const [deps, s4] = yield* parseDeps(s3);
    const [, s5] = yield* expect(s4, "Delimiter", "}");
    const [error, s6] = yield* parsePrimaryType(s5);
    return [
      Ast.EffectType({ value, deps, error, span: Span.merge(tokenSpan(startTok), error.span) }),
      s6,
    ] as const;
  });

const parseDeps = (s: ParseState): P<ReadonlyArray<string>> => {
  const go = (deps: ReadonlyArray<string>, st: ParseState): P<ReadonlyArray<string>> => {
    if (isAtEnd(st) || check(st, "Delimiter", "}")) return Effect.succeed([deps, st] as const);
    return Effect.flatMap(expect(st, "Ident"), ([tok, st2]) => go([...deps, tokenValue(tok)], st2));
  };
  return go([], s);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const parse = (tokens: ReadonlyArray<Token>): Effect.Effect<Ast.Program, CompilerError> =>
  Effect.map(parseProgram(makeState(tokens)), ([program]) => program);
