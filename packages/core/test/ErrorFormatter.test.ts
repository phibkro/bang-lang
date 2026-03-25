import { describe, expect, it } from "@effect/vitest";
import { ErrorFormatter, CompilerError, Span } from "@bang/core";

describe("ErrorFormatter", () => {
  it("formats a lex error with source context", () => {
    const source = 'greeting = "hello';
    const error = new CompilerError.LexError({
      message: "Unterminated string literal",
      span: Span.make({
        startLine: 1,
        startCol: 11,
        startOffset: 11,
        endLine: 1,
        endCol: 17,
        endOffset: 17,
      }),
      hint: 'Add a closing " to the string',
    });
    const formatted = ErrorFormatter.format(error, source);
    expect(formatted).toContain("error[lex]");
    expect(formatted).toContain("Unterminated string literal");
    expect(formatted).toContain("1 |");
    expect(formatted).toContain("^");
    expect(formatted).toContain('Add a closing "');
  });

  it("formats errors with line numbers", () => {
    const source = "line1\nline2\nline3";
    const error = new CompilerError.ParseError({
      message: "Unexpected token",
      span: Span.make({
        startLine: 2,
        startCol: 0,
        startOffset: 6,
        endLine: 2,
        endCol: 5,
        endOffset: 11,
      }),
    });
    const formatted = ErrorFormatter.format(error, source);
    expect(formatted).toContain("2 |");
    expect(formatted).toContain("line2");
  });

  it("formats multiple errors with separation", () => {
    const source = 'x = "hello\ny = "world';
    const errors = [
      new CompilerError.LexError({
        message: "Unterminated string",
        span: Span.make({
          startLine: 1,
          startCol: 4,
          startOffset: 4,
          endLine: 1,
          endCol: 10,
          endOffset: 10,
        }),
      }),
      new CompilerError.LexError({
        message: "Unterminated string",
        span: Span.make({
          startLine: 2,
          startCol: 4,
          startOffset: 15,
          endLine: 2,
          endCol: 10,
          endOffset: 21,
        }),
      }),
    ];
    const formatted = ErrorFormatter.formatAll(errors, source);
    expect(formatted.split("error[lex]").length - 1).toBe(2);
  });
});
