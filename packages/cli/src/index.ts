import { Args, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { compileFile } from "./Compile.js";
import { runFile } from "./Run.js";

const filePath = Args.file({ name: "file" });

const compile = Command.make("compile", { filePath }).pipe(
  Command.withHandler(({ filePath }) => compileFile(filePath)),
);

const run = Command.make("run", { filePath }).pipe(
  Command.withHandler(({ filePath }) => runFile(filePath)),
);

const bang = Command.make("bang").pipe(Command.withSubcommands([compile, run]));

const cli = Command.run(bang, { name: "bang", version: "0.0.1" });

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
