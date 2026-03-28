import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { Compiler } from "@bang/compiler";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

export const runFile = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(filePath);
    const result = yield* Compiler.compile(source);

    const tmpDir = path.join(os.tmpdir(), "bang-run-" + Date.now());
    yield* fs.makeDirectory(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, "main.ts");
    yield* fs.writeFileString(outPath, result.code);

    yield* Effect.sync(() => {
      execSync(`bun run ${outPath}`, { stdio: "inherit" });
    });
  });
