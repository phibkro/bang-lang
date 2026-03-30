import { Match, Schema } from "effect";

// ---------------------------------------------------------------------------
// Internal type representation for HM inference
// ---------------------------------------------------------------------------

export class TVar extends Schema.TaggedClass<TVar>()("TVar", {
  id: Schema.Number,
}) {}

export class TCon extends Schema.TaggedClass<TCon>()("TCon", {
  name: Schema.String,
}) {}

const InferTypeSchema: Schema.Schema<InferType> = Schema.suspend(() =>
  Schema.Union(TVar, TCon, TArrow, TApp),
);

export class TArrow extends Schema.TaggedClass<TArrow>()("TArrow", {
  param: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
  result: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
}) {}

export class TApp extends Schema.TaggedClass<TApp>()("TApp", {
  ctor: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
  arg: Schema.suspend((): Schema.Schema<InferType> => InferTypeSchema),
}) {}

export type InferType = TVar | TCon | TArrow | TApp;

// ---------------------------------------------------------------------------
// Convenience constructors for builtins
// ---------------------------------------------------------------------------

export const tInt = new TCon({ name: "Int" });
export const tFloat = new TCon({ name: "Float" });
export const tString = new TCon({ name: "String" });
export const tBool = new TCon({ name: "Bool" });
export const tUnit = new TCon({ name: "Unit" });

// ---------------------------------------------------------------------------
// Pretty-printer
// ---------------------------------------------------------------------------

export const prettyPrint = (t: InferType): string =>
  Match.value(t).pipe(
    Match.tag("TVar", (v) => `?${v.id}`),
    Match.tag("TCon", (c) => c.name),
    Match.tag("TArrow", (a) => {
      const paramStr =
        a.param._tag === "TArrow"
          ? `(${prettyPrint(a.param)})`
          : prettyPrint(a.param);
      return `${paramStr} -> ${prettyPrint(a.result)}`;
    }),
    Match.tag("TApp", (app) => `${prettyPrint(app.ctor)} ${prettyPrint(app.arg)}`),
    Match.exhaustive,
  );
