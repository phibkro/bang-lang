import { Schema } from "effect";

/**
 * Source span — a range of offsets into the original source string.
 *
 * **Invariant:** `end >= start`. This is not enforced by the constructor
 * but holds structurally because:
 * - The lexer only advances forward (offset monotonically increases)
 * - Spans are created as `{ start: before, end: after }` where `after >= before`
 * - `merge` takes `(first.start, last.end)` from ordered tokens
 *
 * Line/column information is computed on demand from the source string
 * at error reporting time via `offsetToLineCol`, not stored in the span.
 */
export class Span extends Schema.Class<Span>("Span")({
  start: Schema.Number,
  end: Schema.Number,
}) {}

export const empty = new Span({ start: 0, end: 0 });

export const merge = (a: Span, b: Span): Span => new Span({ start: a.start, end: b.end });

/**
 * Compute line (1-indexed) and column (0-indexed) from a source offset.
 * Used by ErrorFormatter at reporting time — not stored in spans.
 */
export const offsetToLineCol = (
  source: string,
  offset: number,
): { readonly line: number; readonly col: number } => {
  const clamped = Math.min(offset, source.length);
  const before = source.slice(0, clamped);
  const lines = before.split("\n");
  return {
    line: lines.length,
    col: lines[lines.length - 1]?.length ?? 0,
  };
};
