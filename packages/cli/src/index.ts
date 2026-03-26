#!/usr/bin/env bun
import { Args, Command } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Formatter } from "@bang/core";
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

const fmtCmd = Command.make("fmt", { filePath }).pipe(
  Command.withHandler(({ filePath }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const source = yield* fs.readFileString(filePath);
      const formatted = yield* Formatter.formatSource(source);
      yield* fs.writeFileString(filePath, formatted);
      yield* Effect.log(`Formatted ${filePath}`);
    }),
  ),
);

const bang = Command.make("bang").pipe(Command.withSubcommands([compile, run, fmtCmd]));

const cli = Command.run(bang, { name: "bang", version: "0.0.1" });

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
