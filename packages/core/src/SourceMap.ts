import type { Span } from "./Span.js";

export interface TSPosition {
  readonly line: number;
  readonly col: number;
}

export interface SourceMap {
  readonly entries: Map<string, Span>;
  readonly size: number;
}

export const empty = (): SourceMap => {
  const entries = new Map<string, Span>();
  return {
    entries,
    get size() {
      return entries.size;
    },
  };
};

export const add = (map: SourceMap, tsPos: TSPosition, bangSpan: Span): void => {
  map.entries.set(`${tsPos.line}:${tsPos.col}`, bangSpan);
};

export const lookup = (map: SourceMap, tsPos: TSPosition): Span | undefined =>
  map.entries.get(`${tsPos.line}:${tsPos.col}`);
