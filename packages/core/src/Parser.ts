import { Effect, Option } from "effect";
import * as Ast from "./Ast.js";
import type { CompilerError } from "./CompilerError.js";
import { ParseError } from "./CompilerError.js";
import * as Lexer from "./Lexer.js";
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
// Type declarations
// ---------------------------------------------------------------------------

const parseTypeDecl = (s: ParseState): P<Ast.TypeDecl | Ast.NewtypeDecl> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "Keyword", "type");
    const [nameTok, s2] = yield* expect(s1, "TypeIdent");
    const typeName = tokenValue(nameTok);

    // Collect type params: lowercase Ident tokens until `=`
    const collectParams = (
      params: ReadonlyArray<string>,
      st: ParseState,
    ): P<ReadonlyArray<string>> =>
      Effect.gen(function* () {
        const isEq = yield* check(st, "Operator", "=");
        if (isEq) return [params, st] as const;
        const [tok, st2] = yield* expect(st, "Ident");
        return yield* collectParams([...params, tokenValue(tok)], st2);
      });

    const [typeParams, s3] = yield* collectParams([], s2);
    const typeParamSet = new Set(typeParams);
    const [, s4] = yield* expect(s3, "Operator", "=");

    // Newtype detection: after `=`, if we see a single type (TypeIdent or type-param Ident)
    // NOT followed by `|`, `{`, or another TypeIdent/Ident — it's a newtype wrapper
    const isNewtype = yield* Effect.gen(function* () {
      const atEnd = yield* isAtEnd(s4);
      if (atEnd) return false;
      const firstTok = yield* peek(s4);
      const firstTag = tokenTag(firstTok);
      // Must start with TypeIdent or type-param Ident
      if (
        firstTag !== "TypeIdent" &&
        !(firstTag === "Ident" && typeParamSet.has(tokenValue(firstTok)))
      )
        return false;
      // Check what follows the type name
      const next = peekAt(s4, 1);
      if (Option.isNone(next)) return true; // EOF after type name → newtype
      const nextTok = next.value;
      const nextTag = tokenTag(nextTok);
      const nextVal = tokenValue(nextTok);
      // If followed by `|`, `{`, TypeIdent, or type-param Ident → ADT
      if (nextTag === "Delimiter" && nextVal === "|") return false;
      if (nextTag === "Delimiter" && nextVal === "{") return false;
      if (nextTag === "TypeIdent") return false;
      if (nextTag === "Ident" && typeParamSet.has(nextVal)) return false;
      return true;
    });

    if (isNewtype) {
      const [typeTok, s5] = yield* advance(s4);
      const wrappedType = new Ast.ConcreteType({
        name: tokenValue(typeTok),
        span: tokenSpan(typeTok),
      });
      return [
        new Ast.NewtypeDecl({
          name: typeName,
          wrappedType,
          span: Span.merge(tokenSpan(startTok), tokenSpan(typeTok)),
        }),
        s5,
      ] as const;
    }

    // Parse constructors separated by `|`
    const collectConstructors = (
      ctors: ReadonlyArray<Ast.Constructor>,
      st: ParseState,
    ): P<ReadonlyArray<Ast.Constructor>> =>
      Effect.gen(function* () {
        const [ctor, st2] = yield* parseConstructor(st, typeParamSet);
        const newCtors = [...ctors, ctor];
        const hasPipe = yield* check(st2, "Delimiter", "|");
        if (!hasPipe) return [newCtors, st2] as const;
        const [, st3] = yield* advance(st2); // consume |
        return yield* collectConstructors(newCtors, st3);
      });

    const [constructors, s5] = yield* collectConstructors([], s4);
    const lastCtor = constructors[constructors.length - 1];
    const endSpan = lastCtor !== undefined ? lastCtor.span : tokenSpan(nameTok);
    return [
      new Ast.TypeDecl({
        name: typeName,
        typeParams: [...typeParams],
        constructors: [...constructors],
        span: Span.merge(tokenSpan(startTok), endSpan),
      }),
      s5,
    ] as const;
  });

const parseConstructor = (s: ParseState, typeParamNames: ReadonlySet<string>): P<Ast.Constructor> =>
  Effect.gen(function* () {
    const [nameTok, s1] = yield* expect(s, "TypeIdent");
    const ctorName = tokenValue(nameTok);

    // Check for named fields: `{`
    const isBrace = yield* check(s1, "Delimiter", "{");
    if (isBrace) {
      const [, s2] = yield* advance(s1); // consume {
      const collectFields = (
        fields: ReadonlyArray<{ readonly name: string; readonly type: Ast.Type }>,
        st: ParseState,
      ): P<ReadonlyArray<{ readonly name: string; readonly type: Ast.Type }>> =>
        Effect.gen(function* () {
          const isClose = yield* check(st, "Delimiter", "}");
          if (isClose) return [fields, st] as const;
          // Consume comma between fields if present
          if (fields.length > 0) {
            const hasComma = yield* check(st, "Delimiter", ",");
            if (hasComma) {
              const [, st2] = yield* advance(st);
              st = st2;
            }
          }
          const [fieldNameTok, st2] = yield* expect(st, "Ident");
          const [, st3] = yield* expect(st2, "Delimiter", ":");
          const [fieldType, st4] = yield* parsePrimaryType(st3);
          return yield* collectFields(
            [...fields, { name: tokenValue(fieldNameTok), type: fieldType }],
            st4,
          );
        });

      const [fields, s3] = yield* collectFields([], s2);
      const [endTok, s4] = yield* expect(s3, "Delimiter", "}");
      return [
        new Ast.NamedConstructor({
          tag: ctorName,
          fields: [...fields],
          span: Span.merge(tokenSpan(nameTok), tokenSpan(endTok)),
        }),
        s4,
      ] as const;
    }

    // Positional fields: collect TypeIdent tokens and type-param Ident tokens
    // Stop at `|`, `;`, `}`, EOF, any Keyword, any Operator
    const collectPositional = (
      fields: ReadonlyArray<Ast.Type>,
      st: ParseState,
    ): P<ReadonlyArray<Ast.Type>> =>
      Effect.gen(function* () {
        const atEnd = yield* isAtEnd(st);
        if (atEnd) return [fields, st] as const;
        const t = yield* peek(st);
        const tag = tokenTag(t);
        // Stop tokens
        if (tag === "Keyword" || tag === "Operator") return [fields, st] as const;
        if (tag === "Delimiter") {
          const v = tokenValue(t);
          if (v === "|" || v === ";" || v === "}") return [fields, st] as const;
        }
        // Accept TypeIdent
        if (tag === "TypeIdent") {
          const [tok, st2] = yield* advance(st);
          const ty = new Ast.ConcreteType({ name: tokenValue(tok), span: tokenSpan(tok) });
          return yield* collectPositional([...fields, ty], st2);
        }
        // Accept Ident only if it's a type param
        if (tag === "Ident" && typeParamNames.has(tokenValue(t))) {
          const [tok, st2] = yield* advance(st);
          const ty = new Ast.ConcreteType({ name: tokenValue(tok), span: tokenSpan(tok) });
          return yield* collectPositional([...fields, ty], st2);
        }
        // Anything else (including non-type-param Ident) — stop
        return [fields, st] as const;
      });

    const [fields, s2] = yield* collectPositional([], s1);
    if (fields.length === 0) {
      return [
        new Ast.NullaryConstructor({
          tag: ctorName,
          span: tokenSpan(nameTok),
        }),
        s2,
      ] as const;
    }
    // fields.length > 0 guaranteed by the `if (fields.length === 0)` guard above
    const lastField = fields[fields.length - 1] as Ast.Type;
    return [
      new Ast.PositionalConstructor({
        tag: ctorName,
        fields: [...fields],
        span: Span.merge(tokenSpan(nameTok), lastField.span),
      }),
      s2,
    ] as const;
  });

// ---------------------------------------------------------------------------
// Statement dispatch
// ---------------------------------------------------------------------------

const parseStatement = (s: ParseState): P<Ast.Stmt> =>
  Effect.gen(function* () {
    const t = yield* peek(s);

    if (tokenTag(t) === "Keyword" && tokenValue(t) === "from") return yield* parseImport(s);
    if (tokenTag(t) === "Keyword" && tokenValue(t) === "export") return yield* parseExport(s);
    if (tokenTag(t) === "Keyword" && tokenValue(t) === "declare") return yield* parseDeclare(s);
    if (tokenTag(t) === "Keyword" && tokenValue(t) === "type") return yield* parseTypeDecl(s);
    if (tokenTag(t) === "Keyword" && tokenValue(t) === "mut") return yield* parseMutDeclaration(s);
    if (tokenTag(t) === "Operator" && tokenValue(t) === "!") return yield* parseForceStatement(s);
    if (tokenTag(t) === "Ident") {
      return yield* Option.match(peekAt(s, 1), {
        onNone: () => parseExprStatement(s),
        onSome: (next) => {
          if (tokenTag(next) === "Operator" && tokenValue(next) === "=") return parseDeclaration(s);
          return parseExprStatement(s);
        },
      });
    }

    // Any other expression-starting token (blocks, grouped, literals, unary ops)
    return yield* parseExprStatement(s);
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
// Mut declaration
// ---------------------------------------------------------------------------

const parseMutDeclaration = (s: ParseState): P<Ast.Declaration> =>
  Effect.gen(function* () {
    const [mutTok, s1] = yield* expect(s, "Keyword", "mut");
    const [nameTok, s2] = yield* expect(s1, "Ident");
    const [, s3] = yield* expect(s2, "Operator", "=");
    const [value, s4] = yield* parseExpr(s3);
    return [
      new Ast.Declaration({
        name: tokenValue(nameTok),
        mutable: true,
        value,
        typeAnnotation: Option.none(),
        span: Span.merge(tokenSpan(mutTok), value.span),
      }),
      s4,
    ] as const;
  });

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const parseImport = (s: ParseState): P<Ast.Import> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "Keyword", "from");

    // Parse module path: TypeIdent separated by `.`
    const [firstMod, s2] = yield* expect(s1, "TypeIdent");
    const collectPath = (parts: ReadonlyArray<string>, st: ParseState): P<ReadonlyArray<string>> =>
      Effect.gen(function* () {
        const isDot = yield* check(st, "Operator", ".");
        if (!isDot) return [parts, st] as const;
        const [, st2] = yield* advance(st); // consume .
        const [seg, st3] = yield* expect(st2, "TypeIdent");
        return yield* collectPath([...parts, tokenValue(seg)], st3);
      });
    const [modulePath, s3] = yield* collectPath([tokenValue(firstMod)], s2);

    const [, s4] = yield* expect(s3, "Keyword", "import");
    const [, s5] = yield* expect(s4, "Delimiter", "{");

    // Parse comma-separated Ident names
    const collectNames = (names: ReadonlyArray<string>, st: ParseState): P<ReadonlyArray<string>> =>
      Effect.gen(function* () {
        const isClose = yield* check(st, "Delimiter", "}");
        if (isClose) return [names, st] as const;
        if (names.length > 0) {
          const [, st2] = yield* expect(st, "Delimiter", ",");
          st = st2;
        }
        const [nameTok, st2] = yield* expect(st, "Ident");
        return yield* collectNames([...names, tokenValue(nameTok)], st2);
      });

    const [names, s6] = yield* collectNames([], s5);
    const [endTok, s7] = yield* expect(s6, "Delimiter", "}");

    return [
      new Ast.Import({
        modulePath: [...modulePath],
        names: [...names],
        span: Span.merge(tokenSpan(startTok), tokenSpan(endTok)),
      }),
      s7,
    ] as const;
  });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const parseExport = (s: ParseState): P<Ast.Export> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "Keyword", "export");
    const [, s2] = yield* expect(s1, "Delimiter", "{");

    const collectNames = (names: ReadonlyArray<string>, st: ParseState): P<ReadonlyArray<string>> =>
      Effect.gen(function* () {
        const isClose = yield* check(st, "Delimiter", "}");
        if (isClose) return [names, st] as const;
        if (names.length > 0) {
          const [, st2] = yield* expect(st, "Delimiter", ",");
          st = st2;
        }
        const [nameTok, st2] = yield* expect(st, "Ident");
        return yield* collectNames([...names, tokenValue(nameTok)], st2);
      });

    const [names, s3] = yield* collectNames([], s2);
    const [endTok, s4] = yield* expect(s3, "Delimiter", "}");

    return [
      new Ast.Export({
        names: [...names],
        span: Span.merge(tokenSpan(startTok), tokenSpan(endTok)),
      }),
      s4,
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
// Expressions — Pratt parser (precedence climbing)
// ---------------------------------------------------------------------------

const PREC_MUT = 1;
const PREC_XOR = 4;
const PREC_OR = 5;
const PREC_AND = 6;
const PREC_CMP = 7;
const PREC_ADD = 8;
const PREC_MUL = 9;
const PREC_UNARY = 10;
const PREC_APP = 11;

const BINARY_PREC: Record<string, number> = {
  "<-": PREC_MUT,
  xor: PREC_XOR,
  or: PREC_OR,
  and: PREC_AND,
  "==": PREC_CMP,
  "!=": PREC_CMP,
  "<": PREC_CMP,
  ">": PREC_CMP,
  "<=": PREC_CMP,
  ">=": PREC_CMP,
  "+": PREC_ADD,
  "-": PREC_ADD,
  "++": PREC_ADD,
  "*": PREC_MUL,
  "/": PREC_MUL,
  "%": PREC_MUL,
};

const RIGHT_ASSOC = new Set<string>(["<-"]);

const getBinaryPrec = (t: Token): number | undefined => {
  const tag = tokenTag(t);
  const val = tokenValue(t);
  if (tag === "Operator" && val in BINARY_PREC) return BINARY_PREC[val];
  if (tag === "Keyword" && val in BINARY_PREC) return BINARY_PREC[val];
  return undefined;
};

const parseExpr = (s: ParseState): P<Ast.Expr> => parseExprPrec(s, 0);

const tryParseLambda = (s: ParseState): P<Option.Option<Ast.Lambda>> =>
  Effect.gen(function* () {
    // Count consecutive Ident tokens from current position
    let paramCount = 0;
    let scanning = true;
    while (scanning) {
      const tok = peekAt(s, paramCount);
      if (Option.isSome(tok) && tokenTag(tok.value) === "Ident") {
        paramCount++;
      } else {
        scanning = false;
      }
    }
    if (paramCount === 0) return [Option.none(), s] as const;
    // Check if token after params is ->
    const afterParams = peekAt(s, paramCount);
    if (
      !Option.isSome(afterParams) ||
      tokenTag(afterParams.value) !== "Operator" ||
      tokenValue(afterParams.value) !== "->"
    ) {
      return [Option.none(), s] as const;
    }
    // It's a lambda! Consume param names
    let st = s;
    const params: Array<string> = [];
    for (let i = 0; i < paramCount; i++) {
      const [tok, st2] = yield* advance(st);
      params.push(tokenValue(tok));
      st = st2;
    }
    // Consume ->
    const [, st3] = yield* expect(st, "Operator", "->");
    // Parse body (must be a Block)
    const [body, st4] = yield* parseBlock(st3);
    const startTok = yield* peek(s);
    return [
      Option.some(
        new Ast.Lambda({
          params,
          body,
          span: Span.merge(tokenSpan(startTok), body.span),
        }),
      ),
      st4,
    ] as const;
  });

const parseExprPrec = (s: ParseState, minPrec: number): P<Ast.Expr> =>
  Effect.gen(function* () {
    // 0. Try lambda (Ident+ -> { body })
    const [maybeLambda, sAfterLambda] = yield* tryParseLambda(s);
    if (Option.isSome(maybeLambda)) {
      return [maybeLambda.value as Ast.Expr, sAfterLambda] as const;
    }

    // 1. Parse prefix (unary operators)
    const t = yield* peek(s);
    let left: Ast.Expr;
    let state: ParseState;

    if (tokenTag(t) === "Operator" && tokenValue(t) === "!") {
      const [bangTok, s1] = yield* advance(s);
      const [operand, s2] = yield* parseExprPrec(s1, PREC_UNARY);
      left = new Ast.Force({
        expr: operand,
        span: Span.merge(tokenSpan(bangTok), operand.span),
      });
      state = s2;
    } else if (tokenTag(t) === "Operator" && tokenValue(t) === "-") {
      const [opTok, s1] = yield* advance(s);
      const [operand, s2] = yield* parseExprPrec(s1, PREC_UNARY);
      left = new Ast.UnaryExpr({
        op: "-",
        expr: operand,
        span: Span.merge(tokenSpan(opTok), operand.span),
      });
      state = s2;
    } else if (tokenTag(t) === "Keyword" && tokenValue(t) === "not") {
      const [opTok, s1] = yield* advance(s);
      const [operand, s2] = yield* parseExprPrec(s1, PREC_UNARY);
      left = new Ast.UnaryExpr({
        op: "not",
        expr: operand,
        span: Span.merge(tokenSpan(opTok), operand.span),
      });
      state = s2;
    } else {
      // Parse atom, then dot access, then application
      const [primary, s1] = yield* parsePrimary(s);
      const [dotExpr, s2] = yield* parseDotAccess(primary, s1);
      if (minPrec <= PREC_APP) {
        const [appExpr, s3] = yield* parseApplication(dotExpr, s2);
        left = appExpr;
        state = s3;
      } else {
        left = dotExpr;
        state = s2;
      }
    }

    // 2. Handle infix operators
    const parseInfix = (l: Ast.Expr, st: ParseState): P<Ast.Expr> =>
      Effect.gen(function* () {
        const atEnd = yield* isAtEnd(st);
        if (atEnd) return [l, st] as const;
        const next = yield* peek(st);
        const prec = getBinaryPrec(next);
        if (prec === undefined || prec < minPrec) return [l, st] as const;
        const op = tokenValue(next);
        const [, st2] = yield* advance(st);
        const nextPrec = RIGHT_ASSOC.has(op) ? prec : prec + 1;
        const [right, st3] = yield* parseExprPrec(st2, nextPrec);
        const binExpr = new Ast.BinaryExpr({
          op,
          left: l,
          right,
          span: Span.merge(l.span, right.span),
        });
        return yield* parseInfix(binExpr, st3);
      });

    return yield* parseInfix(left, state);
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
  if (tag === "Delimiter") return tokenValue(t) === "(";
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

// ---------------------------------------------------------------------------
// String interpolation: split "hello ${expr} world" into InterpText/InterpExpr parts
// ---------------------------------------------------------------------------

const parseStringInterp = (
  raw: string,
  span: Span.Span,
): Effect.Effect<Ast.StringInterp, CompilerError> =>
  Effect.gen(function* () {
    const parts: Array<Ast.InterpPart> = [];
    let i = 0;
    let textStart = 0;

    while (i < raw.length) {
      if (raw[i] === "$" && raw[i + 1] === "{") {
        // Flush accumulated text
        if (i > textStart) {
          parts.push(new Ast.InterpText({ value: raw.slice(textStart, i) }));
        }
        // Find matching closing brace (simple: no nested braces in v0.2)
        const exprStart = i + 2;
        let depth = 1;
        let j = exprStart;
        while (j < raw.length && depth > 0) {
          if (raw[j] === "{") depth++;
          else if (raw[j] === "}") depth--;
          if (depth > 0) j++;
        }
        if (depth !== 0) {
          return yield* Effect.fail(
            new ParseError({ message: "Unterminated interpolation expression", span }),
          );
        }
        const exprText = raw.slice(exprStart, j);
        // Lex and parse the expression
        const tokens = yield* Lexer.tokenize(exprText);
        const exprAst = yield* parseExprFromTokens(tokens);
        parts.push(new Ast.InterpExpr({ value: exprAst }));
        i = j + 1;
        textStart = i;
      } else {
        i++;
      }
    }
    // Flush trailing text
    if (textStart < raw.length) {
      parts.push(new Ast.InterpText({ value: raw.slice(textStart) }));
    }
    return new Ast.StringInterp({ parts, span });
  });

const parseExprFromTokens = (
  tokens: ReadonlyArray<Token>,
): Effect.Effect<Ast.Expr, CompilerError> =>
  Effect.map(parseExpr(makeState(tokens)), ([expr]) => expr);

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
      const value = tokenValue(tok);
      const span = tokenSpan(tok);
      if (value.includes("${")) {
        const interp = yield* parseStringInterp(value, span);
        return [interp, s1] as const;
      }
      return [new Ast.StringLiteral({ value, span }), s1] as const;
    }
    if (tag === "IntLit") {
      const [tok, s1] = yield* advance(s);
      return [
        new Ast.IntLiteral({ value: Number(tokenValue(tok)), span: tokenSpan(tok) }),
        s1,
      ] as const;
    }
    if (tag === "FloatLit") {
      const [tok, s1] = yield* advance(s);
      return [
        new Ast.FloatLiteral({ value: Number(tokenValue(tok)), span: tokenSpan(tok) }),
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

    if (tag === "Keyword" && tokenValue(t) === "match") {
      return yield* parseMatch(s);
    }

    if (tag === "Keyword" && tokenValue(t) === "comptime") {
      const [startTok, s1] = yield* advance(s);
      const [expr, s2] = yield* parsePrimary(s1);
      return [
        new Ast.ComptimeExpr({ expr, span: Span.merge(tokenSpan(startTok), expr.span) }),
        s2,
      ] as const;
    }

    if (tag === "Delimiter" && tokenValue(t) === "{") {
      return yield* parseBlock(s);
    }

    if (tag === "Delimiter" && tokenValue(t) === "(") {
      // Grouped expression: ( expr )
      const [, s1] = yield* advance(s); // consume (
      const [expr, s2] = yield* parseExprPrec(s1, 0); // parse inner expr at lowest prec
      const [, s3] = yield* expect(s2, "Delimiter", ")"); // consume )
      return [expr, s3] as const;
    }

    return yield* fail(`Expected expression, got ${tokenDescription(t)}`, s);
  });

// ---------------------------------------------------------------------------
// Match expression
// ---------------------------------------------------------------------------

const parseMatch = (s: ParseState): P<Ast.MatchExpr> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "Keyword", "match");
    // Parse scrutinee at high precedence to avoid consuming `{`
    const [scrutinee, s2] = yield* parseExprPrec(s1, PREC_APP + 1);
    const [, s3] = yield* expect(s2, "Delimiter", "{");

    // Parse arms separated by commas until `}`
    const collectArms = (arms: ReadonlyArray<Ast.Arm>, st: ParseState): P<ReadonlyArray<Ast.Arm>> =>
      Effect.gen(function* () {
        const isClose = yield* check(st, "Delimiter", "}");
        if (isClose) return [arms, st] as const;
        const [arm, st2] = yield* parseArm(st);
        const newArms = [...arms, arm];
        // Consume optional comma
        const hasComma = yield* check(st2, "Delimiter", ",");
        if (hasComma) {
          const [, st3] = yield* advance(st2);
          return yield* collectArms(newArms, st3);
        }
        return [newArms, st2] as const;
      });

    const [arms, s4] = yield* collectArms([], s3);
    const [endTok, s5] = yield* expect(s4, "Delimiter", "}");
    return [
      new Ast.MatchExpr({
        scrutinee,
        arms: [...arms],
        span: Span.merge(tokenSpan(startTok), tokenSpan(endTok)),
      }),
      s5,
    ] as const;
  });

const parseArm = (s: ParseState): P<Ast.Arm> =>
  Effect.gen(function* () {
    const [pattern, s1] = yield* parsePattern(s);
    // Optional guard: `if expr`
    const hasGuard = yield* check(s1, "Keyword", "if");
    let guard: Option.Option<Ast.Expr> = Option.none();
    let guardState = s1;
    if (hasGuard) {
      const [, s2] = yield* advance(s1); // consume `if`
      const [gExpr, s3] = yield* parseExpr(s2);
      guard = Option.some(gExpr);
      guardState = s3;
    }
    const [, s4] = yield* expect(guardState, "Operator", "->");
    const [body, s5] = yield* parseExpr(s4);
    return [
      new Ast.Arm({
        pattern,
        guard,
        body,
        span: Span.merge(pattern.span, body.span),
      }),
      s5,
    ] as const;
  });

const isPatternTerminator = (t: Token): boolean => {
  const tag = tokenTag(t);
  if (tag === "Operator" && tokenValue(t) === "->") return true;
  if (tag === "Keyword" && tokenValue(t) === "if") return true;
  if (tag === "Delimiter") {
    const v = tokenValue(t);
    return v === "," || v === "}" || v === ")";
  }
  if (tag === "EOF") return true;
  return false;
};

const parsePattern = (s: ParseState): P<Ast.Pattern> =>
  Effect.gen(function* () {
    const t = yield* peek(s);
    const tag = tokenTag(t);

    // Grouped pattern: (Pattern)
    if (tag === "Delimiter" && tokenValue(t) === "(") {
      const [, s1] = yield* advance(s);
      const [inner, s2] = yield* parsePattern(s1);
      const [, s3] = yield* expect(s2, "Delimiter", ")");
      return [inner, s3] as const;
    }

    // Wildcard: _
    if (tag === "Ident" && tokenValue(t) === "_") {
      const [tok, s1] = yield* advance(s);
      return [new Ast.WildcardPattern({ span: tokenSpan(tok) }), s1] as const;
    }

    // Constructor: TypeIdent followed by sub-patterns
    if (tag === "TypeIdent") {
      const [tok, s1] = yield* advance(s);
      const ctorName = tokenValue(tok);
      // Collect sub-patterns until we hit a terminator
      const collectSubPatterns = (
        pats: ReadonlyArray<Ast.Pattern>,
        st: ParseState,
      ): P<ReadonlyArray<Ast.Pattern>> =>
        Effect.gen(function* () {
          const atEnd = yield* isAtEnd(st);
          if (atEnd) return [pats, st] as const;
          const next = yield* peek(st);
          if (isPatternTerminator(next)) return [pats, st] as const;
          const [subPat, st2] = yield* parsePattern(st);
          return yield* collectSubPatterns([...pats, subPat], st2);
        });

      const [subPatterns, s2] = yield* collectSubPatterns([], s1);
      const endSpan =
        subPatterns.length > 0
          ? (subPatterns[subPatterns.length - 1] as Ast.Pattern).span
          : tokenSpan(tok);
      return [
        new Ast.ConstructorPattern({
          tag: ctorName,
          patterns: [...subPatterns],
          span: Span.merge(tokenSpan(tok), endSpan),
        }),
        s2,
      ] as const;
    }

    // Literal patterns
    if (tag === "IntLit") {
      const [tok, s1] = yield* advance(s);
      const lit = new Ast.IntLiteral({ value: Number(tokenValue(tok)), span: tokenSpan(tok) });
      return [new Ast.LiteralPattern({ value: lit, span: tokenSpan(tok) }), s1] as const;
    }
    if (tag === "FloatLit") {
      const [tok, s1] = yield* advance(s);
      const lit = new Ast.FloatLiteral({ value: Number(tokenValue(tok)), span: tokenSpan(tok) });
      return [new Ast.LiteralPattern({ value: lit, span: tokenSpan(tok) }), s1] as const;
    }
    if (tag === "StringLit") {
      const [tok, s1] = yield* advance(s);
      const lit = new Ast.StringLiteral({ value: tokenValue(tok), span: tokenSpan(tok) });
      return [new Ast.LiteralPattern({ value: lit, span: tokenSpan(tok) }), s1] as const;
    }
    if (tag === "BoolLit") {
      const [tok, s1] = yield* advance(s);
      const lit = new Ast.BoolLiteral({ value: tokenBoolValue(tok), span: tokenSpan(tok) });
      return [new Ast.LiteralPattern({ value: lit, span: tokenSpan(tok) }), s1] as const;
    }

    // Binding: lowercase Ident (not _)
    if (tag === "Ident") {
      const [tok, s1] = yield* advance(s);
      return [new Ast.BindingPattern({ name: tokenValue(tok), span: tokenSpan(tok) }), s1] as const;
    }

    return yield* fail(`Expected pattern, got ${tokenDescription(t)}`, s);
  });

// ---------------------------------------------------------------------------
// Block expression
// ---------------------------------------------------------------------------

const parseBlock = (s: ParseState): P<Ast.Block> =>
  Effect.gen(function* () {
    const [startTok, s1] = yield* expect(s, "Delimiter", "{");

    // Check for empty block
    const isEmpty = yield* check(s1, "Delimiter", "}");
    if (isEmpty) {
      return yield* fail("Empty block expression", s1);
    }

    // Parse semicolon-separated items: { stmt; stmt; expr }
    // After each item, if `;` follows it's a statement; if `}` follows it's the return expr.
    const go = (
      stmts: ReadonlyArray<Ast.Stmt>,
      st: ParseState,
    ): P<readonly [ReadonlyArray<Ast.Stmt>, Ast.Expr, ParseState]> =>
      Effect.gen(function* () {
        const [item, st2] = yield* parseBlockItem(st);
        const hasSemi = yield* check(st2, "Delimiter", ";");
        if (hasSemi) {
          // This item is a statement; consume `;` and continue
          const [, st3] = yield* advance(st2);
          return yield* go([...stmts, item], st3);
        }
        // No semicolon — this must be the return expression
        if (item._tag !== "ExprStatement") {
          return yield* fail("Block must end with an expression", st2);
        }
        return [stmts, item.expr, st2] as const;
      });

    const [stmts, expr, s2] = yield* go([], s1);
    const [endTok, s3] = yield* expect(s2, "Delimiter", "}");
    const span = Span.merge(tokenSpan(startTok), tokenSpan(endTok));

    return [new Ast.Block({ statements: [...stmts], expr, span }), s3] as const;
  });

const parseBlockItem = (s: ParseState): P<Ast.Stmt> =>
  Effect.gen(function* () {
    const t = yield* peek(s);

    if (tokenTag(t) === "Keyword" && tokenValue(t) === "mut") return yield* parseMutDeclaration(s);
    if (tokenTag(t) === "Operator" && tokenValue(t) === "!") return yield* parseForceStatement(s);
    if (tokenTag(t) === "Ident") {
      return yield* Option.match(peekAt(s, 1), {
        onNone: () => parseExprStatement(s),
        onSome: (next) => {
          if (tokenTag(next) === "Operator" && tokenValue(next) === "=") return parseDeclaration(s);
          return parseExprStatement(s);
        },
      });
    }

    return yield* parseExprStatement(s);
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

    if (tokenTag(t) === "Ident") {
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
