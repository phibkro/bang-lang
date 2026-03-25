import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { Compiler, ErrorFormatter } from "@bang/core";

export const compileFile = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(filePath);
    const result = yield* Compiler.compile(source).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const formatted = ErrorFormatter.format(error, source);
          yield* Effect.logError(formatted);
          return yield* Effect.fail(error);
        }),
      ),
    );
    const outPath = filePath.replace(/\.bang$/, ".ts");
    yield* fs.writeFileString(outPath, result.code);
    yield* Effect.log(`Compiled ${filePath} → ${outPath}`);
  });
