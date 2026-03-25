import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { compileFile } from "../src/Compile.js";

describe("CLI", () => {
  it.effect("compile command produces .ts output", () =>
    Effect.gen(function* () {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bang-"));
      const inputPath = path.join(tmpDir, "hello.bang");
      fs.writeFileSync(
        inputPath,
        `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`,
      );

      yield* compileFile(inputPath).pipe(Effect.provide(NodeContext.layer));

      const outputPath = path.join(tmpDir, "hello.ts");
      expect(fs.existsSync(outputPath)).toBe(true);
      const output = fs.readFileSync(outputPath, "utf-8");
      expect(output).toContain('import { Effect } from "effect"');

      fs.rmSync(tmpDir, { recursive: true });
    }),
  );
});
