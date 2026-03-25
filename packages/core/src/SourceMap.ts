import { HashMap, Option } from "effect";
import type { Span } from "./Span.js";

export interface TSPosition {
  readonly line: number;
  readonly col: number;
}

const posKey = (pos: TSPosition): string => `${pos.line}:${pos.col}`;

export interface SourceMap {
  readonly entries: HashMap.HashMap<string, Span>;
  readonly size: number;
}

const makeSourceMap = (entries: HashMap.HashMap<string, Span>): SourceMap => ({
  entries,
  size: HashMap.size(entries),
});

export const empty = (): SourceMap => makeSourceMap(HashMap.empty());

export const add = (map: SourceMap, tsPos: TSPosition, bangSpan: Span): SourceMap =>
  makeSourceMap(HashMap.set(map.entries, posKey(tsPos), bangSpan));

export const lookup = (map: SourceMap, tsPos: TSPosition): Option.Option<Span> =>
  HashMap.get(map.entries, posKey(tsPos));
