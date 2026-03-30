import { Effect } from "effect";
import type { Program } from "./Ast.js";
import type { InferType } from "./InferType.js";

// ---------------------------------------------------------------------------
// HM Type Inference — stub (implementation pending)
// ---------------------------------------------------------------------------

export interface InferResult {
  readonly type: InferType;
}

export const inferProgram = (
  program: Program,
): Effect.Effect<InferResult, Error> => {
  void program;
  return Effect.fail(new Error("inferProgram: not yet implemented"));
};
