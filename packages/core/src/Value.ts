import { Data, Effect, HashMap, Schema } from "effect";
import type * as Ast from "./Ast.js";
import * as Span from "./Span.js";

export type Value = Data.TaggedEnum<{
  Num: { readonly value: number };
  Str: { readonly value: string };
  Bool: { readonly value: boolean };
  Unit: {};
  Closure: {
    readonly params: ReadonlyArray<string>;
    readonly body: Ast.Expr;
    readonly env: HashMap.HashMap<string, Value>;
  };
}>;

export const { Num, Str, Bool, Unit, Closure, $match } = Data.taggedEnum<Value>();

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
  });
