import { Data, Effect, HashMap, Schema } from "effect";
import type * as Ast from "./Ast.js";
import * as Span from "./Span.js";

export type Value = Data.TaggedEnum<{
  Num: { readonly value: number };
  Str: { readonly value: string };
  Bool: { readonly value: boolean };
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Data.TaggedEnum requires {} for no-field variants
  Unit: {};
  Closure: {
    readonly params: ReadonlyArray<string>;
    readonly body: Ast.Expr;
    readonly env: HashMap.HashMap<string, Value>;
  };
  Tagged: {
    readonly tag: string;
    readonly fields: ReadonlyArray<Value>;
  };
  Constructor: {
    readonly tag: string;
    readonly arity: number;
    readonly applied: ReadonlyArray<Value>;
  };
  MutCell: {
    readonly ref: { value: Value };
  };
}>;

export const { Num, Str, Bool, Unit, Closure, Tagged, Constructor, MutCell, $match } =
  Data.taggedEnum<Value>();

export class EvalError extends Schema.TaggedError<EvalError>()("EvalError", {
  message: Schema.String,
  span: Schema.Any,
}) {}

export const toJS = (v: Value): unknown =>
  $match(v, {
    Num: (n) => n.value,
    Str: (s) => s.value,
    Bool: (b) => b.value,
    Unit: () => undefined,
    Closure: () => {
      throw new Error("Cannot convert Closure to JS");
    },
    Tagged: (t) => {
      const fields: Record<string, unknown> = { _tag: t.tag };
      t.fields.forEach((f, i) => {
        fields[String(i)] = toJS(f);
      });
      return fields;
    },
    Constructor: () => {
      throw new Error("Cannot convert Constructor to JS");
    },
    MutCell: (m) => toJS(m.ref.value),
  });

export const coerceToString = (v: Value): Effect.Effect<string, EvalError> =>
  $match(v, {
    Num: (n) => Effect.succeed(String(n.value)),
    Str: (s) => Effect.succeed(s.value),
    Bool: (b) => Effect.succeed(String(b.value)),
    Unit: () => Effect.succeed("()"),
    Closure: () =>
      Effect.fail(
        new EvalError({
          message: "Cannot coerce closure to string",
          span: Span.empty,
        }),
      ),
    Tagged: (t) =>
      Effect.succeed(t.fields.length === 0 ? t.tag : `${t.tag}(${t.fields.length} fields)`),
    Constructor: (c) => Effect.succeed(`<Constructor:${c.tag}/${c.arity}>`),
    MutCell: (m) => coerceToString(m.ref.value),
  });
