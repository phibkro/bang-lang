---
name: bang-lang monorepo scaffold
description: Structure, tooling, and conventions established during initial project scaffolding
type: project
---

Monorepo uses pnpm workspaces (pnpm-workspace.yaml) with two packages: @bang/core and @bang/cli. vp (Vite+) is the unified toolchain — `vp check` runs format+lint, `vp test` runs vitest.

Vitest is installed at root (devDependency) with a root `vitest.config.ts` setting `passWithNoTests: true`, so `vp test` passes when no test files exist yet. Each package also has its own `vitest.config.ts` with the same setting.

`vp check --fix` auto-fixes formatting — run it before `vp check` when adding new files, since the formatter touches pnpm store index files and other generated files that aren't in the project.

`docs/superpowers/` is in `.gitignore` — these are specs/plans that must not be committed.

**`vp test` quirk:** `vp test` at the workspace root reports "no tests" even when tests pass — this is a vp test runner quirk with the root config. Use `cd packages/core && node_modules/.bin/vitest run` (or same for packages/cli) to verify actual test counts and results. The exit code from `vp test` is still reliable (0 = pass, 1 = fail). Also, `--filter` is not a valid flag for `vp test` (it's not vitest's `--testNamePattern`).

**Test baseline (as of Task 10):** @bang/core: 47 tests across 8 test files. @bang/cli: 1 test (compile command produces .ts output).

**@effect/cli pattern (verified v0.75.x):** `Args.file({ name: "file" })` returns `Args<string>`. `Command.make("name", { filePath })` builds a command with args. Chain `.pipe(Command.withHandler(({ filePath }) => effect))` to add handler. `Command.withSubcommands([...])` attaches subcommands. `Command.run(root, { name, version })` returns `(argv: string[]) => Effect`. Entry point: `cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain)`.

**@effect/platform FileSystem in CLI tests:** Tests using `compileFile` must `.pipe(Effect.provide(NodeContext.layer))` — NodeContext.layer includes NodeFileSystem, NodeCommandExecutor, and NodePath layers.

**AST pattern:** Recursive AST types cannot use `Data.TaggedEnum` (Effect's TaggedEnum doesn't support recursive self-referential types). Use plain interfaces with `readonly _tag: "NodeName"` discriminators, union types (`Expr`, `Type`, `Stmt`, `Node`), and factory functions (`export const Foo = (fields: Omit<Foo, "_tag">): Foo => ({ _tag: "Foo", ...fields })`). This is the established pattern in `packages/core/src/Ast.ts`.

**Why:** pnpm is the package manager (not npm/yarn) — pnpm-workspace.yaml and pnpm-lock.yaml are present. npm commands fail due to cache permission issues in this environment; use pnpm directly.

**How to apply:** Always use `pnpm install` (or `vp install`) not `npm install`. Run `vp check --fix` before `vp check` after creating files. Never commit docs/superpowers/. Verify test count with `node_modules/.bin/vitest run` not `vp test`.
