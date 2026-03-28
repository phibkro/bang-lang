import { Effect } from "effect";
import * as Lexer from "@bang/core/Lexer";
import * as Parser from "@bang/core/Parser";
import * as Checker from "./Checker.js";
import * as Codegen from "./Codegen.js";
import type { CompilerError } from "@bang/core/CompilerError";

export const lex = Lexer.tokenize;
export const parse = Parser.parse;
export const check = Checker.check;
export const codegen = Codegen.generate;

export const compile = (source: string): Effect.Effect<Codegen.CodegenOutput, CompilerError> =>
  Effect.gen(function* () {
    const tokens = yield* lex(source);
    const ast = yield* parse(tokens);
    const typed = yield* check(ast);
    return yield* codegen(typed);
  });
