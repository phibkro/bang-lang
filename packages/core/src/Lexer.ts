import { Effect } from "effect";
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
]);

const DELIMITERS = new Set(["{", "}", "(", ")", ":", ";", ","]);

const TWO_CHAR_OPS: Record<string, string> = {
  "->": "->",
  "<-": "<-",
  "==": "==",
  "!=": "!=",
  "<=": "<=",
  ">=": ">=",
  "++": "++",
};

const SINGLE_CHAR_OPS = new Set(["=", "!", ".", "+", "-", "*", "/", "%", "<", ">"]);

const isLowerAlpha = (ch: string): boolean => ch >= "a" && ch <= "z";
const isUpperAlpha = (ch: string): boolean => ch >= "A" && ch <= "Z";
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isAlphaNum = (ch: string): boolean => isLowerAlpha(ch) || isUpperAlpha(ch) || isDigit(ch);

export const tokenize = (source: string): Effect.Effect<Token[], CompilerError> =>
  Effect.gen(function* () {
    const tokens: Token[] = [];
    let offset = 0;
    let line = 1;
    let col = 0;

    const peek = (): string | undefined => source[offset];
    const peekNext = (): string | undefined => source[offset + 1];
    const advance = (): string => {
      const ch = source[offset]!;
      offset++;
      if (ch === "\n") {
        line++;
        col = 0;
      } else {
        col++;
      }
      return ch;
    };

    const makeSpan = (startLine: number, startCol: number, startOffset: number): Span.Span =>
      Span.make({
        startLine,
        startCol,
        startOffset,
        endLine: line,
        endCol: col,
        endOffset: offset,
      });

    while (offset < source.length) {
      const ch = peek()!;

      // Skip whitespace
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        advance();
        continue;
      }

      // Skip line comments
      if (ch === "/" && peekNext() === "/") {
        while (offset < source.length && peek() !== "\n") {
          advance();
        }
        continue;
      }

      const startLine = line;
      const startCol = col;
      const startOffset = offset;

      // String literal
      if (ch === '"') {
        advance(); // opening quote
        let value = "";
        while (offset < source.length && peek() !== '"') {
          if (peek() === "\n") {
            return yield* Effect.fail(
              LexError({
                message: "Unterminated string literal",
                span: makeSpan(startLine, startCol, startOffset),
              }),
            );
          }
          value += advance();
        }
        if (offset >= source.length) {
          return yield* Effect.fail(
            LexError({
              message: "Unterminated string literal",
              span: makeSpan(startLine, startCol, startOffset),
            }),
          );
        }
        advance(); // closing quote
        tokens.push(
          StringLit({
            value,
            span: makeSpan(startLine, startCol, startOffset),
          }),
        );
        continue;
      }

      // Number literal
      if (isDigit(ch)) {
        let value = "";
        while (offset < source.length && isDigit(peek()!)) {
          value += advance();
        }
        if (
          offset < source.length &&
          peek() === "." &&
          peekNext() !== undefined &&
          isDigit(peekNext()!)
        ) {
          value += advance(); // the dot
          while (offset < source.length && isDigit(peek()!)) {
            value += advance();
          }
          tokens.push(
            FloatLit({
              value,
              span: makeSpan(startLine, startCol, startOffset),
            }),
          );
        } else {
          tokens.push(
            IntLit({
              value,
              span: makeSpan(startLine, startCol, startOffset),
            }),
          );
        }
        continue;
      }

      // Lowercase identifier / keyword / bool
      if (isLowerAlpha(ch)) {
        let value = "";
        while (offset < source.length && isAlphaNum(peek()!)) {
          value += advance();
        }
        const span = makeSpan(startLine, startCol, startOffset);
        if (value === "true") {
          tokens.push(BoolLit({ value: true, span }));
        } else if (value === "false") {
          tokens.push(BoolLit({ value: false, span }));
        } else if (KEYWORDS.has(value)) {
          tokens.push(Keyword({ value, span }));
        } else {
          tokens.push(Ident({ value, span }));
        }
        continue;
      }

      // Uppercase identifier (type)
      if (isUpperAlpha(ch)) {
        let value = "";
        while (offset < source.length && isAlphaNum(peek()!)) {
          value += advance();
        }
        tokens.push(
          TypeIdent({
            value,
            span: makeSpan(startLine, startCol, startOffset),
          }),
        );
        continue;
      }

      // Unit literal: ()
      if (ch === "(" && peekNext() === ")") {
        advance();
        advance();
        tokens.push(Unit({ span: makeSpan(startLine, startCol, startOffset) }));
        continue;
      }

      // Delimiters
      if (DELIMITERS.has(ch)) {
        advance();
        tokens.push(
          Delimiter({
            value: ch,
            span: makeSpan(startLine, startCol, startOffset),
          }),
        );
        continue;
      }

      // Two-char operators
      if (offset + 1 < source.length) {
        const twoChar = ch + source[offset + 1];
        if (twoChar in TWO_CHAR_OPS) {
          advance();
          advance();
          tokens.push(
            Operator({
              value: twoChar,
              span: makeSpan(startLine, startCol, startOffset),
            }),
          );
          continue;
        }
      }

      // Single-char operators
      if (SINGLE_CHAR_OPS.has(ch)) {
        advance();
        tokens.push(
          Operator({
            value: ch,
            span: makeSpan(startLine, startCol, startOffset),
          }),
        );
        continue;
      }

      // Unknown character
      advance();
      return yield* Effect.fail(
        LexError({
          message: `Unexpected character: '${ch}'`,
          span: makeSpan(startLine, startCol, startOffset),
        }),
      );
    }

    tokens.push(
      EOF({
        span: Span.make({
          startLine: line,
          startCol: col,
          startOffset: offset,
          endLine: line,
          endCol: col,
          endOffset: offset,
        }),
      }),
    );

    return tokens;
  });
