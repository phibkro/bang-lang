import { Data } from "effect";

export interface Span {
  readonly startLine: number;
  readonly startCol: number;
  readonly startOffset: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly endOffset: number;
}

export const make = (fields: Span): Span => Data.struct(fields);

export const empty: Span = make({
  startLine: 0,
  startCol: 0,
  startOffset: 0,
  endLine: 0,
  endCol: 0,
  endOffset: 0,
});

export const merge = (a: Span, b: Span): Span =>
  make({
    startLine: a.startLine,
    startCol: a.startCol,
    startOffset: a.startOffset,
    endLine: b.endLine,
    endCol: b.endCol,
    endOffset: b.endOffset,
  });
