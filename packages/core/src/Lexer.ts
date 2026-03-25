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
  "comptime",
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
  "where",
  "defer",
  "if",
  "transaction",
  "race",
  "fork",
  "scoped",
  "effect",
]);

const DELIMITERS = new Set(["{", "}", "(", ")", "[", "]", ":", ";", ","]);

const TWO_CHAR_OPS: ReadonlyMap<string, string> = new Map([
  ["->", "->"],
  ["<-", "<-"],
  ["==", "=="],
  ["!=", "!="],
  ["<=", "<="],
  [">=", ">="],
  ["++", "++"],
]);

const SINGLE_CHAR_OPS = new Set(["=", "!", ".", "+", "-", "*", "/", "%", "<", ">"]);

// ---------------------------------------------------------------------------
// Character predicates
// ---------------------------------------------------------------------------

const isLowerAlpha = (ch: string): boolean => ch >= "a" && ch <= "z";
const isUpperAlpha = (ch: string): boolean => ch >= "A" && ch <= "Z";
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isAlphaNum = (ch: string): boolean => isLowerAlpha(ch) || isUpperAlpha(ch) || isDigit(ch);
const isWhitespace = (ch: string): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

// ---------------------------------------------------------------------------
// Scanner state (immutable)
// ---------------------------------------------------------------------------

interface ScanState {
  readonly source: string;
  readonly offset: number;
  readonly line: number;
  readonly col: number;
  readonly tokens: Chunk.Chunk<Token>;
}

const initialState = (source: string): ScanState => ({
  source,
  offset: 0,
  line: 1,
  col: 0,
  tokens: Chunk.empty(),
});

// ---------------------------------------------------------------------------
// State helpers (pure — return new state)
// ---------------------------------------------------------------------------

const peek = (s: ScanState): Option.Option<string> => Option.fromNullable(s.source[s.offset]);

const peekAt = (s: ScanState, ahead: number): Option.Option<string> =>
  Option.fromNullable(s.source[s.offset + ahead]);

const advance = (s: ScanState): ScanState => {
  const ch = s.source[s.offset];
  return ch === "\n"
    ? { ...s, offset: s.offset + 1, line: s.line + 1, col: 0 }
    : { ...s, offset: s.offset + 1, col: s.col + 1 };
};

const advanceN = (s: ScanState, n: number): ScanState => {
  if (n <= 0) return s;
  return advanceN(advance(s), n - 1);
};

const makeSpan = (
  startLine: number,
  startCol: number,
  startOffset: number,
  s: ScanState,
): Span.Span =>
  Span.make({
    startLine,
    startCol,
    startOffset,
    endLine: s.line,
    endCol: s.col,
    endOffset: s.offset,
  });

const emit = (s: ScanState, token: Token): ScanState => ({
  ...s,
  tokens: Chunk.append(s.tokens, token),
});

// ---------------------------------------------------------------------------
// Scanning primitives (pure — return [value, newState])
// ---------------------------------------------------------------------------

const consumeWhile = (
  s: ScanState,
  pred: (ch: string) => boolean,
): readonly [string, ScanState] => {
  const go = (acc: string, st: ScanState): readonly [string, ScanState] =>
    Option.match(peek(st), {
      onNone: () => [acc, st] as const,
      onSome: (ch) => (pred(ch) ? go(acc + ch, advance(st)) : ([acc, st] as const)),
    });
  return go("", s);
};

const skipWhile = (s: ScanState, pred: (ch: string) => boolean): ScanState =>
  Option.match(peek(s), {
    onNone: () => s,
    onSome: (ch) => (pred(ch) ? skipWhile(advance(s), pred) : s),
  });

// ---------------------------------------------------------------------------
// Token scanners (each returns Effect<ScanState, CompilerError>)
// ---------------------------------------------------------------------------

const scanString = (
  s: ScanState,
  startLine: number,
  startCol: number,
  startOffset: number,
): Effect.Effect<ScanState, CompilerError> => {
  const s1 = advance(s); // skip opening quote
  const go = (acc: string, st: ScanState): Effect.Effect<ScanState, CompilerError> =>
    Option.match(peek(st), {
      onNone: () =>
        Effect.fail(
          LexError({
            message: "Unterminated string literal",
            span: makeSpan(startLine, startCol, startOffset, st),
          }),
        ),
      onSome: (ch) => {
        if (ch === "\n") {
          return Effect.fail(
            LexError({
              message: "Unterminated string literal",
              span: makeSpan(startLine, startCol, startOffset, st),
            }),
          );
        }
        if (ch === '"') {
          const s2 = advance(st);
          return Effect.succeed(
            emit(
              s2,
              StringLit({ value: acc, span: makeSpan(startLine, startCol, startOffset, s2) }),
            ),
          );
        }
        return go(acc + ch, advance(st));
      },
    });
  return go("", s1);
};

const scanNumber = (
  s: ScanState,
  startLine: number,
  startCol: number,
  startOffset: number,
): ScanState => {
  const [intPart, s1] = consumeWhile(s, isDigit);
  const hasDot =
    Option.isSome(peek(s1)) &&
    Option.getOrElse(peek(s1), () => "") === "." &&
    Option.match(peekAt(s1, 1), { onNone: () => false, onSome: isDigit });
  if (hasDot) {
    const s2 = advance(s1); // skip dot
    const [fracPart, s3] = consumeWhile(s2, isDigit);
    return emit(
      s3,
      FloatLit({
        value: `${intPart}.${fracPart}`,
        span: makeSpan(startLine, startCol, startOffset, s3),
      }),
    );
  }
  return emit(s1, IntLit({ value: intPart, span: makeSpan(startLine, startCol, startOffset, s1) }));
};

const scanLowerIdent = (
  s: ScanState,
  startLine: number,
  startCol: number,
  startOffset: number,
): ScanState => {
  const [value, s1] = consumeWhile(s, isAlphaNum);
  const span = makeSpan(startLine, startCol, startOffset, s1);
  if (value === "true") return emit(s1, BoolLit({ value: true, span }));
  if (value === "false") return emit(s1, BoolLit({ value: false, span }));
  if (KEYWORDS.has(value)) return emit(s1, Keyword({ value, span }));
  return emit(s1, Ident({ value, span }));
};

const scanUpperIdent = (
  s: ScanState,
  startLine: number,
  startCol: number,
  startOffset: number,
): ScanState => {
  const [value, s1] = consumeWhile(s, isAlphaNum);
  return emit(s1, TypeIdent({ value, span: makeSpan(startLine, startCol, startOffset, s1) }));
};

// ---------------------------------------------------------------------------
// Main scanner step (one token per call)
// ---------------------------------------------------------------------------

const scanOneToken = (s: ScanState): Effect.Effect<ScanState, CompilerError> => {
  // Skip whitespace
  const s0 = skipWhile(s, isWhitespace);

  // Skip line comments
  const s1 = Option.match(peek(s0), {
    onNone: () => s0,
    onSome: (ch) =>
      ch === "/" && Option.getOrElse(peekAt(s0, 1), () => "") === "/"
        ? skipWhile(s0, (c) => c !== "\n")
        : s0,
  });

  // Re-skip whitespace after comment
  const state = skipWhile(s1, isWhitespace);

  return Option.match(peek(state), {
    onNone: () => Effect.succeed(state), // EOF — handled after loop
    onSome: (ch) => {
      const startLine = state.line;
      const startCol = state.col;
      const startOffset = state.offset;

      // String literal
      if (ch === '"') {
        return scanString(state, startLine, startCol, startOffset);
      }

      // Number literal
      if (isDigit(ch)) {
        return Effect.succeed(scanNumber(state, startLine, startCol, startOffset));
      }

      // Lowercase identifier / keyword / bool
      if (isLowerAlpha(ch)) {
        return Effect.succeed(scanLowerIdent(state, startLine, startCol, startOffset));
      }

      // Uppercase identifier (type)
      if (isUpperAlpha(ch)) {
        return Effect.succeed(scanUpperIdent(state, startLine, startCol, startOffset));
      }

      // Unit literal: ()
      if (ch === "(" && Option.getOrElse(peekAt(state, 1), () => "") === ")") {
        const s2 = advanceN(state, 2);
        return Effect.succeed(
          emit(s2, Unit({ span: makeSpan(startLine, startCol, startOffset, s2) })),
        );
      }

      // Delimiters
      if (DELIMITERS.has(ch)) {
        const s2 = advance(state);
        return Effect.succeed(
          emit(s2, Delimiter({ value: ch, span: makeSpan(startLine, startCol, startOffset, s2) })),
        );
      }

      // Two-char operators
      const twoChar = ch + Option.getOrElse(peekAt(state, 1), () => "");
      if (TWO_CHAR_OPS.has(twoChar)) {
        const s2 = advanceN(state, 2);
        return Effect.succeed(
          emit(
            s2,
            Operator({ value: twoChar, span: makeSpan(startLine, startCol, startOffset, s2) }),
          ),
        );
      }

      // Single-char operators
      if (SINGLE_CHAR_OPS.has(ch)) {
        const s2 = advance(state);
        return Effect.succeed(
          emit(s2, Operator({ value: ch, span: makeSpan(startLine, startCol, startOffset, s2) })),
        );
      }

      // Unknown character
      const s2 = advance(state);
      return Effect.fail(
        LexError({
          message: `Unexpected character: '${ch}'`,
          span: makeSpan(startLine, startCol, startOffset, s2),
        }),
      );
    },
  });
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const tokenize = (source: string): Effect.Effect<Token[], CompilerError> =>
  Effect.iterate(initialState(source), {
    while: (s) => s.offset < s.source.length,
    body: scanOneToken,
  }).pipe(
    Effect.map((finalState) => {
      const eofSpan = Span.make({
        startLine: finalState.line,
        startCol: finalState.col,
        startOffset: finalState.offset,
        endLine: finalState.line,
        endCol: finalState.col,
        endOffset: finalState.offset,
      });
      return [...Chunk.toArray(finalState.tokens), EOF({ span: eofSpan })];
    }),
  );
