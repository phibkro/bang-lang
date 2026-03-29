import { Chunk, Effect, Option } from "effect";
import type { CompilerError } from "./CompilerError.js";
import { LexError } from "./CompilerError.js";
import * as Span from "./Span.js";
import type { Token } from "./Token.js";
import {
  BoolLit,
  Delimiter,
  EOF,
  FloatLit,
  Ident,
  IntLit,
  Keyword,
  Operator,
  StringLit,
  TypeIdent,
  Unit,
} from "./Token.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  "mut",
  "type",
  "declare",
  "from",
  "import",
  "export",
  "match",
  "not",
  "and",
  "or",
  "xor",
  "if",
  "transaction",
  "gen",
  "on",
  "use",
  "comptime",
]);

const DELIMITER_CHARS = new Set(["{", "}", "(", ")", "[", "]", ":", ";", ",", "|"]);

const TWO_CHAR_OPS = new Set(["->", "<-", "==", "!=", "<=", ">=", "++"]);

const SINGLE_CHAR_OPS = new Set(["=", "!", ".", "+", "-", "*", "/", "%", "<", ">"]);

// ---------------------------------------------------------------------------
// Scanner state (immutable)
// ---------------------------------------------------------------------------

interface ScanState {
  readonly source: string;
  readonly offset: number;
  readonly line: number;
  readonly col: number;
}

const initialState = (source: string): ScanState => ({
  source,
  offset: 0,
  line: 1,
  col: 0,
});

// ---------------------------------------------------------------------------
// State primitives
// ---------------------------------------------------------------------------

const charAt = (s: ScanState, ahead: number = 0): Option.Option<string> =>
  Option.fromNullable(s.source[s.offset + ahead]);

const advance = (s: ScanState): ScanState => {
  const ch = s.source[s.offset];
  return ch === "\n"
    ? { ...s, offset: s.offset + 1, line: s.line + 1, col: 0 }
    : { ...s, offset: s.offset + 1, col: s.col + 1 };
};

const advanceN = (s: ScanState, n: number): ScanState => (n <= 0 ? s : advanceN(advance(s), n - 1));

const makeSpan = (start: ScanState, end: ScanState): Span.Span =>
  new Span.Span({ start: start.offset, end: end.offset });

const consumeWhile = (
  s: ScanState,
  pred: (ch: string) => boolean,
): readonly [string, ScanState] => {
  const go = (acc: string, st: ScanState): readonly [string, ScanState] =>
    Option.match(charAt(st), {
      onNone: () => [acc, st] as const,
      onSome: (ch) => (pred(ch) ? go(acc + ch, advance(st)) : ([acc, st] as const)),
    });
  return go("", s);
};

const skipWhitespace = (s: ScanState): ScanState => {
  const isWs = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  const [, s1] = consumeWhile(s, isWs);
  return s1;
};

const skipLineComment = (s: ScanState): ScanState =>
  Option.match(charAt(s), {
    onNone: () => s,
    onSome: (ch) =>
      ch === "/" && Option.getOrElse(charAt(s, 1), () => "") === "/"
        ? consumeWhile(s, (c) => c !== "\n")[1]
        : s,
  });

// ---------------------------------------------------------------------------
// Recognizer type — the combinator primitive
// ---------------------------------------------------------------------------

type Recognizer = (s: ScanState) => Option.Option<readonly [Token, ScanState]>;

// ---------------------------------------------------------------------------
// Combinator: try each recognizer in order, first match wins
// ---------------------------------------------------------------------------

const firstOf =
  (...recognizers: ReadonlyArray<Recognizer>): Recognizer =>
  (s) => {
    for (const r of recognizers) {
      const result = r(s);
      if (Option.isSome(result)) return result;
    }
    return Option.none();
  };

// ---------------------------------------------------------------------------
// Character predicates
// ---------------------------------------------------------------------------

const isLowerAlpha = (ch: string): boolean => ch >= "a" && ch <= "z";
const isUpperAlpha = (ch: string): boolean => ch >= "A" && ch <= "Z";
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isAlphaNum = (ch: string): boolean => isLowerAlpha(ch) || isUpperAlpha(ch) || isDigit(ch);
const isIdentChar = (ch: string): boolean => isAlphaNum(ch) || ch === "_";

// ---------------------------------------------------------------------------
// Token recognizers
// ---------------------------------------------------------------------------

const ESCAPE_MAP: Record<string, string> = {
  n: "\\n",
  t: "\\t",
  r: "\\r",
  "\\": "\\\\",
  '"': '\\"',
};

const recognizeString: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    if (ch !== '"') return Option.none();
    const start = s;
    const go = (acc: string, st: ScanState): Option.Option<readonly [Token, ScanState]> =>
      Option.match(charAt(st), {
        onNone: () => Option.none(), // unterminated — handled as error in scan loop
        onSome: (c) => {
          if (c === "\n") return Option.none();
          if (c === "\\") {
            return Option.match(charAt(st, 1), {
              onNone: () => Option.none(),
              onSome: (next) => {
                const mapped = ESCAPE_MAP[next];
                if (mapped !== undefined) {
                  return go(acc + mapped, advanceN(st, 2));
                }
                // Unknown escape — keep as-is
                return go(acc + "\\" + next, advanceN(st, 2));
              },
            });
          }
          if (c === '"') {
            const end = advance(st);
            return Option.some([
              new StringLit({ value: acc, span: makeSpan(start, end) }),
              end,
            ] as const);
          }
          return go(acc + c, advance(st));
        },
      });
    return go("", advance(s)); // skip opening quote
  });

const recognizeNumber: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    if (!isDigit(ch)) return Option.none();
    const start = s;
    const [intPart, s1] = consumeWhile(s, isDigit);
    const hasDot =
      Option.getOrElse(charAt(s1), () => "") === "." &&
      Option.match(charAt(s1, 1), { onNone: () => false, onSome: isDigit });
    if (hasDot) {
      const s2 = advance(s1);
      const [fracPart, s3] = consumeWhile(s2, isDigit);
      return Option.some([
        new FloatLit({ value: `${intPart}.${fracPart}`, span: makeSpan(start, s3) }),
        s3,
      ] as const);
    }
    return Option.some([new IntLit({ value: intPart, span: makeSpan(start, s1) }), s1] as const);
  });

const recognizeLowerWord: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    if (!isLowerAlpha(ch) && ch !== "_") return Option.none();
    const start = s;
    const [value, s1] = consumeWhile(s, isIdentChar);
    const span = makeSpan(start, s1);
    if (value === "true") return Option.some([new BoolLit({ value: true, span }), s1] as const);
    if (value === "false") return Option.some([new BoolLit({ value: false, span }), s1] as const);
    if (KEYWORDS.has(value)) return Option.some([new Keyword({ value, span }), s1] as const);
    return Option.some([new Ident({ value, span }), s1] as const);
  });

const recognizeUpperWord: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    if (!isUpperAlpha(ch)) return Option.none();
    const start = s;
    const [value, s1] = consumeWhile(s, isIdentChar);
    return Option.some([new TypeIdent({ value, span: makeSpan(start, s1) }), s1] as const);
  });

const recognizeUnit: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    if (ch !== "(" || Option.getOrElse(charAt(s, 1), () => "") !== ")") return Option.none();
    const start = s;
    const s1 = advanceN(s, 2);
    return Option.some([new Unit({ span: makeSpan(start, s1) }), s1] as const);
  });

const recognizeDelimiter: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    if (!DELIMITER_CHARS.has(ch)) return Option.none();
    const start = s;
    const s1 = advance(s);
    return Option.some([new Delimiter({ value: ch, span: makeSpan(start, s1) }), s1] as const);
  });

const recognizeTwoCharOp: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    const twoChar = ch + Option.getOrElse(charAt(s, 1), () => "");
    if (!TWO_CHAR_OPS.has(twoChar)) return Option.none();
    const start = s;
    const s1 = advanceN(s, 2);
    return Option.some([new Operator({ value: twoChar, span: makeSpan(start, s1) }), s1] as const);
  });

const recognizeSingleCharOp: Recognizer = (s) =>
  Option.flatMap(charAt(s), (ch) => {
    if (!SINGLE_CHAR_OPS.has(ch)) return Option.none();
    const start = s;
    const s1 = advance(s);
    return Option.some([new Operator({ value: ch, span: makeSpan(start, s1) }), s1] as const);
  });

// ---------------------------------------------------------------------------
// Composed scanner — precedence defined by order
// ---------------------------------------------------------------------------

const tokenRecognizer: Recognizer = firstOf(
  recognizeString,
  recognizeNumber,
  recognizeLowerWord, // handles booleans, keywords, identifiers
  recognizeUpperWord,
  recognizeUnit, // before delimiter (consumes "()")
  recognizeDelimiter,
  recognizeTwoCharOp, // before single char ops
  recognizeSingleCharOp,
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface ScanAccum {
  readonly state: ScanState;
  readonly tokens: Chunk.Chunk<Token>;
}

export const tokenize = (source: string): Effect.Effect<Token[], CompilerError> =>
  Effect.iterate({ state: initialState(source), tokens: Chunk.empty<Token>() } as ScanAccum, {
    while: (acc) => acc.state.offset < acc.state.source.length,
    body: (acc) => {
      // Skip whitespace and comments
      const cleaned = skipWhitespace(skipLineComment(skipWhitespace(acc.state)));

      // Check if we've reached the end after skipping
      if (cleaned.offset >= cleaned.source.length) {
        return Effect.succeed({ state: cleaned, tokens: acc.tokens });
      }

      // Try to recognize a token
      return Option.match(tokenRecognizer(cleaned), {
        onNone: () => {
          const ch = cleaned.source[cleaned.offset] ?? "?";
          const s1 = advance(cleaned);
          // Better error for unterminated strings
          const message =
            ch === '"' ? "Unterminated string literal" : `Unexpected character: '${ch}'`;
          return Effect.fail(
            new LexError({
              message,
              span: makeSpan(cleaned, s1),
            }),
          );
        },
        onSome: ([token, nextState]) =>
          Effect.succeed({
            state: nextState,
            tokens: Chunk.append(acc.tokens, token),
          }),
      });
    },
  }).pipe(
    Effect.map((acc) => {
      const eofSpan = new Span.Span({
        start: acc.state.offset,
        end: acc.state.offset,
      });
      return [...Chunk.toArray(acc.tokens), new EOF({ span: eofSpan })];
    }),
  );
