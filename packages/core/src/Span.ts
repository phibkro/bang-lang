import { Schema } from "effect";

export class Span extends Schema.Class<Span>("Span")({
  startLine: Schema.Number,
  startCol: Schema.Number,
  startOffset: Schema.Number,
  endLine: Schema.Number,
  endCol: Schema.Number,
  endOffset: Schema.Number,
}) {}

export const empty = new Span({
  startLine: 0,
  startCol: 0,
  startOffset: 0,
  endLine: 0,
  endCol: 0,
  endOffset: 0,
});

export const make = (fields: {
  readonly startLine: number;
  readonly startCol: number;
  readonly startOffset: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly endOffset: number;
}): Span => new Span(fields);

export const merge = (a: Span, b: Span): Span =>
  new Span({
    startLine: a.startLine,
    startCol: a.startCol,
    startOffset: a.startOffset,
    endLine: b.endLine,
    endCol: b.endCol,
    endOffset: b.endOffset,
  });
