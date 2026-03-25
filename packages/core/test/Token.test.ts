import { describe, expect, it } from "@effect/vitest";
import { Span, Token } from "@bang/core";

describe("Span", () => {
  it("creates a span with start and end positions", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 5,
      endOffset: 5,
    });
    expect(span.startLine).toBe(1);
    expect(span.endCol).toBe(5);
  });
});

describe("Token", () => {
  it("creates a keyword token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 7,
      endOffset: 7,
    });
    const token = Token.Keyword({ value: "declare", span });
    expect(token._tag).toBe("Keyword");
    expect(token.value).toBe("declare");
  });

  it("creates an identifier token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 3,
      endOffset: 3,
    });
    const token = Token.Ident({ value: "foo", span });
    expect(token._tag).toBe("Ident");
    expect(token.value).toBe("foo");
  });

  it("creates a TypeIdent token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 6,
      endOffset: 6,
    });
    const token = Token.TypeIdent({ value: "Effect", span });
    expect(token._tag).toBe("TypeIdent");
  });

  it("creates a string literal token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 7,
      endOffset: 7,
    });
    const token = Token.StringLit({ value: "hello", span });
    expect(token._tag).toBe("StringLit");
  });

  it("creates an operator token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 1,
      endOffset: 1,
    });
    const token = Token.Operator({ value: "=", span });
    expect(token._tag).toBe("Operator");
  });

  it("creates a delimiter token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 1,
      endOffset: 1,
    });
    const token = Token.Delimiter({ value: "{", span });
    expect(token._tag).toBe("Delimiter");
  });

  it("creates an EOF token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 0,
      endOffset: 0,
    });
    const token = Token.EOF({ span });
    expect(token._tag).toBe("EOF");
  });
});
