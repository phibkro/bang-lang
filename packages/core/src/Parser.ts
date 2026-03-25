import { Effect } from "effect";
import * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import { ParseError } from "./CompilerError.js";
import * as Span from "./Span.js";
import type { Token } from "./Token.js";

// ---------------------------------------------------------------------------
// Internal: mutable cursor over token array
// ---------------------------------------------------------------------------

class ParseState {
  constructor(
    readonly tokens: ReadonlyArray<Token.Token>,
    public pos: number = 0,
  ) {}

  peek(): Token.Token {
    return this.tokens[this.pos]!;
  }

  advance(): Token.Token {
    const t = this.tokens[this.pos]!;
    this.pos++;
    return t;
  }

  /** Check whether the current token matches a tag and optionally a value. */
  check(tag: string, value?: string): boolean {
    const t = this.peek();
    if (t._tag !== tag) return false;
    if (value !== undefined && "value" in t && (t as any).value !== value) return false;
    return true;
  }

  /** Consume a token with the expected tag/value, or throw a ParseError. */
  expect(tag: string, value?: string): Token.Token {
    const t = this.peek();
    if (!this.check(tag, value)) {
      const got = "value" in t ? `${t._tag}(${(t as any).value})` : t._tag;
      const expected = value !== undefined ? `${tag}(${value})` : tag;
      throw ParseError({
        message: `Expected ${expected}, got ${got}`,
        span: tokenSpan(t),
      });
    }
    return this.advance();
  }

  isAtEnd(): boolean {
    return this.peek()._tag === "EOF";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tokenSpan = (t: Token.Token): Span.Span => (t as any).span;

const tokenValue = (t: Token.Token): string => (t as any).value;

// ---------------------------------------------------------------------------
// Parse entry point
// ---------------------------------------------------------------------------

export const parse = (
  tokens: ReadonlyArray<Token.Token>,
): Effect.Effect<Ast.Program, CompilerError> =>
  Effect.try({
    try: () => {
      const state = new ParseState(tokens);
      return parseProgram(state);
    },
    catch: (e) => e as CompilerError,
  });

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const parseProgram = (s: ParseState): Ast.Program => {
  const statements: Ast.Stmt[] = [];
  const startSpan = tokenSpan(s.peek());

  while (!s.isAtEnd()) {
    statements.push(parseStatement(s));
  }

  const endSpan = tokenSpan(s.peek()); // EOF
  return Ast.Program({
    statements,
    span: Span.merge(startSpan, endSpan),
  });
};

// ---------------------------------------------------------------------------
// Statement dispatch
// ---------------------------------------------------------------------------

const parseStatement = (s: ParseState): Ast.Stmt => {
  const t = s.peek();

  // declare ...
  if (t._tag === "Keyword" && tokenValue(t) === "declare") {
    return parseDeclare(s);
  }

  // ! expr (force statement)
  if (t._tag === "Operator" && tokenValue(t) === "!") {
    return parseForceStatement(s);
  }

  // Ident followed by = → declaration; otherwise expr statement
  if (t._tag === "Ident") {
    const next = s.tokens[s.pos + 1];
    if (next && next._tag === "Operator" && tokenValue(next) === "=") {
      return parseDeclaration(s);
    }
    return parseExprStatement(s);
  }

  const got = "value" in t ? `${t._tag}(${tokenValue(t)})` : t._tag;
  throw ParseError({
    message: `Unexpected token at statement position: ${got}`,
    span: tokenSpan(t),
  });
};

// ---------------------------------------------------------------------------
// Declare
// ---------------------------------------------------------------------------

const parseDeclare = (s: ParseState): Ast.Declare => {
  const start = s.expect("Keyword", "declare");

  // dotted name: ident (.ident)*
  let name = tokenValue(s.expect("Ident"));
  while (!s.isAtEnd() && s.check("Operator", ".")) {
    s.advance(); // consume .
    name += "." + tokenValue(s.expect("Ident"));
  }

  s.expect("Delimiter", ":");

  const typeAnnotation = parseType(s);

  return Ast.Declare({
    name,
    typeAnnotation,
    span: Span.merge(tokenSpan(start), typeSpan(typeAnnotation)),
  });
};

// ---------------------------------------------------------------------------
// Declaration
// ---------------------------------------------------------------------------

const parseDeclaration = (s: ParseState): Ast.Declaration => {
  const nameToken = s.expect("Ident");
  s.expect("Operator", "=");
  const value = parseExpr(s);

  return Ast.Declaration({
    name: tokenValue(nameToken),
    mutable: false,
    value,
    typeAnnotation: undefined,
    span: Span.merge(tokenSpan(nameToken), exprSpan(value)),
  });
};

// ---------------------------------------------------------------------------
// Force statement
// ---------------------------------------------------------------------------

const parseForceStatement = (s: ParseState): Ast.ForceStatement => {
  const bang = s.expect("Operator", "!");
  const expr = parseExpr(s);
  const force = Ast.Force({
    expr,
    span: Span.merge(tokenSpan(bang), exprSpan(expr)),
  });

  return Ast.ForceStatement({
    expr: force,
    span: Span.merge(tokenSpan(bang), exprSpan(expr)),
  });
};

// ---------------------------------------------------------------------------
// Expr statement
// ---------------------------------------------------------------------------

const parseExprStatement = (s: ParseState): Ast.ExprStatement => {
  const expr = parseExpr(s);
  return Ast.ExprStatement({
    expr,
    span: exprSpan(expr),
  });
};

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

const parseExpr = (s: ParseState): Ast.Expr => {
  // 1. Parse primary
  let expr = parsePrimary(s);

  // 2. Dot access: while . followed by Ident
  while (!s.isAtEnd() && s.check("Operator", ".")) {
    s.advance(); // consume .
    const fieldToken = s.expect("Ident");
    expr = Ast.DotAccess({
      object: expr,
      field: tokenValue(fieldToken),
      span: Span.merge(exprSpan(expr), tokenSpan(fieldToken)),
    });
  }

  // 3. Application: while next token looks like an argument
  if (!s.isAtEnd() && isArgStart(s.peek())) {
    const args: Ast.Expr[] = [];
    while (!s.isAtEnd() && isArgStart(s.peek())) {
      args.push(parseAtom(s));
    }
    expr = Ast.App({
      func: expr,
      args,
      span: Span.merge(exprSpan(expr), exprSpan(args[args.length - 1]!)),
    });
  }

  return expr;
};

/** Tokens that can start an argument in application position */
const isArgStart = (t: Token.Token): boolean => {
  switch (t._tag) {
    case "Ident":
    case "TypeIdent":
    case "StringLit":
    case "IntLit":
    case "FloatLit":
    case "BoolLit":
    case "Unit":
      return true;
    default:
      return false;
  }
};

/** Parse an atom (no dot access, no application — just the primary value) */
const parseAtom = (s: ParseState): Ast.Expr => {
  return parsePrimary(s);
};

const parsePrimary = (s: ParseState): Ast.Expr => {
  const t = s.peek();

  if (t._tag === "Ident") {
    s.advance();
    return Ast.Ident({ name: tokenValue(t), span: tokenSpan(t) });
  }

  if (t._tag === "TypeIdent") {
    s.advance();
    return Ast.Ident({ name: tokenValue(t), span: tokenSpan(t) });
  }

  if (t._tag === "StringLit") {
    s.advance();
    return Ast.StringLiteral({ value: tokenValue(t), span: tokenSpan(t) });
  }

  if (t._tag === "IntLit") {
    s.advance();
    return Ast.IntLiteral({ value: Number(tokenValue(t)), span: tokenSpan(t) });
  }

  if (t._tag === "BoolLit") {
    s.advance();
    return Ast.BoolLiteral({ value: (t as any).value as boolean, span: tokenSpan(t) });
  }

  if (t._tag === "Unit") {
    s.advance();
    return Ast.UnitLiteral({ span: tokenSpan(t) });
  }

  const got = "value" in t ? `${t._tag}(${tokenValue(t)})` : t._tag;
  throw ParseError({
    message: `Expected expression, got ${got}`,
    span: tokenSpan(t),
  });
};

// ---------------------------------------------------------------------------
// Type parsing
// ---------------------------------------------------------------------------

const parseType = (s: ParseState): Ast.Type => {
  const left = parsePrimaryType(s);

  // Arrow: type -> type (right-associative)
  if (!s.isAtEnd() && s.check("Operator", "->")) {
    s.advance(); // consume ->
    const result = parseType(s); // right-recursive
    return Ast.ArrowType({
      param: left,
      result,
      span: Span.merge(typeSpan(left), typeSpan(result)),
    });
  }

  return left;
};

const parsePrimaryType = (s: ParseState): Ast.Type => {
  const t = s.peek();

  if (t._tag === "TypeIdent" && tokenValue(t) === "Effect") {
    return parseEffectType(s);
  }

  if (t._tag === "TypeIdent") {
    s.advance();
    return Ast.ConcreteType({ name: tokenValue(t), span: tokenSpan(t) });
  }

  // {} in type position → ConcreteType("Unit") (empty error shorthand)
  if (t._tag === "Delimiter" && tokenValue(t) === "{") {
    const next = s.tokens[s.pos + 1];
    if (next && next._tag === "Delimiter" && tokenValue(next) === "}") {
      const start = s.advance(); // {
      const end = s.advance(); // }
      return Ast.ConcreteType({
        name: "Unit",
        span: Span.merge(tokenSpan(start), tokenSpan(end)),
      });
    }
  }

  const got = "value" in t ? `${t._tag}(${tokenValue(t)})` : t._tag;
  throw ParseError({
    message: `Expected type, got ${got}`,
    span: tokenSpan(t),
  });
};

const parseEffectType = (s: ParseState): Ast.EffectType => {
  const start = s.expect("TypeIdent", "Effect");

  // value type
  const value = parsePrimaryType(s);

  // { deps }
  s.expect("Delimiter", "{");
  const deps: string[] = [];
  while (!s.isAtEnd() && !s.check("Delimiter", "}")) {
    deps.push(tokenValue(s.expect("Ident")));
  }
  s.expect("Delimiter", "}");

  // error type
  const error = parsePrimaryType(s);

  return Ast.EffectType({
    value,
    deps,
    error,
    span: Span.merge(tokenSpan(start), typeSpan(error)),
  });
};

// ---------------------------------------------------------------------------
// Span extractors for AST nodes
// ---------------------------------------------------------------------------

const exprSpan = (e: Ast.Expr): Span.Span => e.span;

const typeSpan = (t: Ast.Type): Span.Span => t.span;
