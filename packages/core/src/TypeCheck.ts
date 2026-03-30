import type * as Ast from "./Ast.js";
import type { TypeError } from "./TypeError.js";
import type { ProgramResult } from "./Infer.js";
import { inferProgram } from "./Infer.js";
import { Effect } from "effect";

// ---------------------------------------------------------------------------
// Public API: typeCheck a parsed program
// ---------------------------------------------------------------------------

export const typeCheck = (
  program: Ast.Program,
): Effect.Effect<ProgramResult, TypeError> => inferProgram(program);
