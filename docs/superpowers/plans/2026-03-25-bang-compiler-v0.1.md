# Bang Compiler v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete Bang-to-Effect-TS transpiler pipeline that compiles a minimal program (`declare`, bindings, `!`, function application) end-to-end.

**Architecture:** Monorepo with three packages — `@bang/core` (library), `@bang/cli`, `@bang/repl` (stub). Each compiler phase (lexer, parser, checker, codegen) is an Effect service. Phases produce distinct typed outputs: `Token[] → UntypedAST → TypedAST → string`. Errors are typed per phase, collected (not fail-fast), and rendered Rust-style.

**Tech Stack:** TypeScript, Effect (`effect`, `@effect/cli`, `@effect/vitest`, `@effect/platform`), Vite+ (`vp`) for monorepo tooling.

**Reference:**

- Design spec: `docs/superpowers/specs/2026-03-25-bang-compiler-design.md`
- Language spec: EBNF v0.2 (in project context)
- Effect repo: `~/Projects/Repos/effect` — consult for idiomatic patterns

---

## File Structure

```
bang-lang/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── index.ts                    # Public API re-exports
│   │   │   ├── Span.ts                     # Source position types
│   │   │   ├── Token.ts                    # Token TaggedEnum + Span
│   │   │   ├── Lexer.ts                    # Tokenization service
│   │   │   ├── Ast.ts                      # AST node TaggedEnums (untyped)
│   │   │   ├── TypedAst.ts                 # Typed AST with annotations
│   │   │   ├── Parser.ts                   # Token[] → UntypedAST
│   │   │   ├── Checker.ts                  # UntypedAST → TypedAST
│   │   │   ├── Codegen.ts                  # TypedAST → Effect TS string
│   │   │   ├── Compiler.ts                 # Pipeline composition
│   │   │   ├── CompilerError.ts            # Error union + Rust-style formatter
│   │   │   └── SourceMap.ts                # Bang span ↔ TS position mapping
│   │   ├── test/
│   │   │   ├── Lexer.test.ts
│   │   │   ├── Parser.test.ts
│   │   │   ├── Checker.test.ts
│   │   │   ├── Codegen.test.ts
│   │   │   ├── Compiler.test.ts            # End-to-end snapshot tests
│   │   │   └── fixtures/                   # .bang test files
│   │   │       ├── hello.bang
│   │   │       └── hello.expected.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── cli/
│       ├── src/
│       │   ├── index.ts                    # CLI entry point
│       │   ├── Compile.ts                  # compile command
│       │   └── Run.ts                      # run command
│       ├── test/
│       │   └── Cli.test.ts
│       ├── package.json
│       └── tsconfig.json
├── examples/
│   └── hello.bang                          # v0.1 target program
├── package.json                            # Workspace root
└── docs/
```

---

## Task 1: Project Scaffolding

**Files:**

- Create: `package.json` (workspace root)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `examples/hello.bang`

- [ ] **Step 1: Initialize monorepo with vp**

```bash
cd /Users/nori/Projects/bang-lang
vp create vite:monorepo --no-interactive --directory .
```

If `vp create` doesn't support `--directory .` on an existing dir, manually create the workspace root `package.json`:

```json
{
  "name": "bang-lang",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"]
}
```

- [ ] **Step 2: Create core package**

`packages/core/package.json`:

```json
{
  "name": "@bang/core",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "test": "vitest",
    "check": "tsc -b tsconfig.json"
  },
  "dependencies": {
    "effect": "^3"
  },
  "devDependencies": {
    "@effect/vitest": "^0.20",
    "typescript": "^5.8",
    "vitest": "^3"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "sourceMap": true,
    "exactOptionalPropertyTypes": true,
    "moduleDetection": "force",
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create CLI package**

`packages/cli/package.json`:

```json
{
  "name": "@bang/cli",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "bang": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest",
    "check": "tsc -b tsconfig.json"
  },
  "dependencies": {
    "@bang/core": "workspace:*",
    "@effect/cli": "^0.75",
    "@effect/platform": "^0.82",
    "@effect/platform-node": "^0.78",
    "effect": "^3"
  },
  "devDependencies": {
    "@effect/vitest": "^0.20",
    "typescript": "^5.8",
    "vitest": "^3"
  }
}
```

`packages/cli/tsconfig.json` — same as core's.

- [ ] **Step 4: Create v0.1 target program**

`examples/hello.bang`:

```bang
declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting
```

- [ ] **Step 5: Verify dependency versions and install**

Check latest versions before installing:

```bash
npm view effect version
npm view @effect/cli version
npm view @effect/platform version
npm view @effect/vitest version
```

Update `package.json` files with correct versions, then:

```bash
cd /Users/nori/Projects/bang-lang
vp install
```

- [ ] **Step 6: Verify setup**

```bash
vp check
vp test
```

Both should pass (no source files yet, no errors).

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold monorepo with @bang/core and @bang/cli"
```

---

## Task 2: Span & Token Types

**Files:**

- Create: `packages/core/src/Span.ts`
- Create: `packages/core/src/Token.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/Token.test.ts`

- [ ] **Step 1: Write failing test for Span and Token creation**

`packages/core/test/Token.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Span, Token } from "@bang/core";

describe("Span", () => {
  it("creates a span with start and end positions", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 5,
      endOffset: 5,
    });
    expect(span.startLine).toBe(1);
    expect(span.endCol).toBe(5);
  });
});

describe("Token", () => {
  it("creates a keyword token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 7,
      endOffset: 7,
    });
    const token = Token.Keyword({ value: "declare", span });
    expect(token._tag).toBe("Keyword");
    expect(token.value).toBe("declare");
  });

  it("creates an identifier token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 3,
      endOffset: 3,
    });
    const token = Token.Ident({ value: "foo", span });
    expect(token._tag).toBe("Ident");
    expect(token.value).toBe("foo");
  });

  it("creates a TypeIdent token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 6,
      endOffset: 6,
    });
    const token = Token.TypeIdent({ value: "Effect", span });
    expect(token._tag).toBe("TypeIdent");
  });

  it("creates a string literal token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 7,
      endOffset: 7,
    });
    const token = Token.StringLit({ value: "hello", span });
    expect(token._tag).toBe("StringLit");
  });

  it("creates an operator token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 1,
      endOffset: 1,
    });
    const token = Token.Operator({ value: "=", span });
    expect(token._tag).toBe("Operator");
  });

  it("creates a delimiter token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 1,
      endOffset: 1,
    });
    const token = Token.Delimiter({ value: "{", span });
    expect(token._tag).toBe("Delimiter");
  });

  it("creates an EOF token", () => {
    const span = Span.make({
      startLine: 1,
      startCol: 0,
      startOffset: 0,
      endLine: 1,
      endCol: 0,
      endOffset: 0,
    });
    const token = Token.EOF({ span });
    expect(token._tag).toBe("EOF");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/nori/Projects/bang-lang
vp test packages/core/test/Token.test.ts
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement Span**

`packages/core/src/Span.ts`:

```typescript
import { Data } from "effect";

export interface Span {
  readonly startLine: number;
  readonly startCol: number;
  readonly startOffset: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly endOffset: number;
}

export const make = (fields: Span): Span => Data.struct(fields);

export const empty: Span = make({
  startLine: 0,
  startCol: 0,
  startOffset: 0,
  endLine: 0,
  endCol: 0,
  endOffset: 0,
});

export const merge = (a: Span, b: Span): Span =>
  make({
    startLine: a.startLine,
    startCol: a.startCol,
    startOffset: a.startOffset,
    endLine: b.endLine,
    endCol: b.endCol,
    endOffset: b.endOffset,
  });
```

- [ ] **Step 4: Implement Token**

`packages/core/src/Token.ts`:

```typescript
import { Data } from "effect";
import type { Span } from "./Span.js";

export type Token = Data.TaggedEnum<{
  Keyword: { readonly value: string; readonly span: Span };
  Ident: { readonly value: string; readonly span: Span };
  TypeIdent: { readonly value: string; readonly span: Span };
  IntLit: { readonly value: string; readonly span: Span };
  FloatLit: { readonly value: string; readonly span: Span };
  StringLit: { readonly value: string; readonly span: Span };
  BoolLit: { readonly value: boolean; readonly span: Span };
  Operator: { readonly value: string; readonly span: Span };
  Delimiter: { readonly value: string; readonly span: Span };
  Unit: { readonly span: Span };
  EOF: { readonly span: Span };
}>;

export const {
  Keyword,
  Ident,
  TypeIdent,
  IntLit,
  FloatLit,
  StringLit,
  BoolLit,
  Operator,
  Delimiter,
  Unit,
  EOF,
  $is,
  $match,
} = Data.taggedEnum<Token>();
```

- [ ] **Step 5: Create index.ts**

`packages/core/src/index.ts`:

```typescript
export * as Span from "./Span.js";
export * as Token from "./Token.js";
```

- [ ] **Step 6: Run tests**

```bash
vp test packages/core/test/Token.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Span.ts packages/core/src/Token.ts packages/core/src/index.ts packages/core/test/Token.test.ts
git commit -m "feat(core): add Span and Token types"
```

---

## Task 3: Lexer

**Files:**

- Create: `packages/core/src/Lexer.ts`
- Create: `packages/core/src/CompilerError.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/Lexer.test.ts`

- [ ] **Step 1: Write failing test for lexing the v0.1 target program**

`packages/core/test/Lexer.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Token } from "@bang/core";

describe("Lexer", () => {
  it.effect("lexes a simple declaration", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize('greeting = "hello"');
      expect(tokens.map((t) => t._tag)).toEqual(["Ident", "Operator", "StringLit", "EOF"]);
      expect((tokens[0] as any).value).toBe("greeting");
      expect((tokens[1] as any).value).toBe("=");
      expect((tokens[2] as any).value).toBe("hello");
    }),
  );

  it.effect("lexes keywords", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("declare mut type from import export");
      const tags = tokens.filter((t) => t._tag !== "EOF").map((t) => (t as any).value);
      expect(tags).toEqual(["declare", "mut", "type", "from", "import", "export"]);
    }),
  );

  it.effect("lexes true/false as BoolLit, not Keyword", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("true false");
      expect(tokens[0]._tag).toBe("BoolLit");
      expect((tokens[0] as any).value).toBe(true);
      expect(tokens[1]._tag).toBe("BoolLit");
      expect((tokens[1] as any).value).toBe(false);
    }),
  );

  it.effect("lexes integer and float literals", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("42 3.14");
      expect(tokens[0]._tag).toBe("IntLit");
      expect((tokens[0] as any).value).toBe("42");
      expect(tokens[1]._tag).toBe("FloatLit");
      expect((tokens[1] as any).value).toBe("3.14");
    }),
  );

  it.effect("lexes the force operator", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("!foo");
      expect(tokens[0]._tag).toBe("Operator");
      expect((tokens[0] as any).value).toBe("!");
      expect(tokens[1]._tag).toBe("Ident");
    }),
  );

  it.effect("lexes type identifiers", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("Effect Unit String");
      expect(tokens.filter((t) => t._tag !== "EOF").every((t) => t._tag === "TypeIdent")).toBe(
        true,
      );
    }),
  );

  it.effect("lexes arrow operator", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("String -> Effect");
      expect(tokens.map((t) => t._tag)).toEqual(["TypeIdent", "Operator", "TypeIdent", "EOF"]);
      expect((tokens[1] as any).value).toBe("->");
    }),
  );

  it.effect("lexes delimiters", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("{ } ( ) :");
      const values = tokens.filter((t) => t._tag === "Delimiter").map((t) => (t as any).value);
      expect(values).toEqual(["{", "}", "(", ")", ":"]);
    }),
  );

  it.effect("lexes the full v0.1 target program", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const tokens = yield* Lexer.tokenize(source);
      // Should not fail — just verify we get tokens and EOF
      expect(tokens[tokens.length - 1]._tag).toBe("EOF");
      expect(tokens.length).toBeGreaterThan(10);
    }),
  );

  it.effect("tracks spans correctly", () =>
    Effect.gen(function* () {
      const tokens = yield* Lexer.tokenize("x = 42");
      expect(tokens[0]._tag).toBe("Ident");
      expect((tokens[0] as any).span.startLine).toBe(1);
      expect((tokens[0] as any).span.startCol).toBe(0);
    }),
  );

  it.effect("reports error for unterminated string", () =>
    Effect.gen(function* () {
      const result = yield* Lexer.tokenize('"hello').pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vp test packages/core/test/Lexer.test.ts
```

Expected: FAIL — Lexer module doesn't exist.

- [ ] **Step 3: Implement CompilerError**

`packages/core/src/CompilerError.ts`:

```typescript
import { Data } from "effect";
import type { Span } from "./Span.js";

export type CompilerError = Data.TaggedEnum<{
  LexError: { readonly message: string; readonly span: Span; readonly hint?: string };
  ParseError: { readonly message: string; readonly span: Span; readonly hint?: string };
  CheckError: { readonly message: string; readonly span: Span; readonly hint?: string };
  CodegenError: { readonly message: string; readonly span: Span; readonly hint?: string };
}>;

export const { LexError, ParseError, CheckError, CodegenError, $is, $match } =
  Data.taggedEnum<CompilerError>();
```

- [ ] **Step 4: Implement Lexer**

`packages/core/src/Lexer.ts`:

The lexer is a function `tokenize: (source: string) => Effect<Token[], CompilerError>`.

Implementation approach:

- Maintain a cursor (`offset`, `line`, `col`) via local mutable state (not Ref — this is synchronous, internal)
- Character-by-character scanning
- Keyword set for distinguishing keywords from identifiers
- Return `LexError` for invalid input (unterminated string, unexpected character)

The keywords set:

```typescript
const KEYWORDS = new Set([
  "mut",
  "comptime",
  "type",
  "declare",
  "from",
  "import",
  "export",
  "match",
  "not",
  "and",
  "or",
  "xor",
  "where",
  "defer",
  "if",
  "transaction",
  "race",
  "fork",
  "scoped",
]);
// Note: "true" and "false" are NOT in KEYWORDS — they produce BoolLit tokens
```

Operator recognition (multi-char aware):

- `->`, `<-`, `==`, `!=`, `<=`, `>=`, `++`
- Single char: `=`, `!`, `.`, `+`, `-`, `*`, `/`, `%`, `<`, `>`

Identifier scanning: starts with `[a-z]`, continues with `[a-zA-Z0-9]` (no underscores — per the EBNF spec `Ident = [a-z] [a-zA-Z0-9]*`). If in KEYWORDS → `Keyword`, else → `Ident`.

TypeIdent scanning: starts with `[A-Z]`, continues with `[a-zA-Z0-9]` → `TypeIdent`.

String scanning: `"` to `"`, no escape sequences yet. Unterminated → `LexError`.

Number scanning: `[0-9]+` optionally followed by `.` `[0-9]+`. Produces `IntLit` or `FloatLit`.

`true`/`false` → `BoolLit` (caught during keyword check).

`()` → `Unit` token (two-char lookahead when seeing `(`). **Note:** This is v0.1 only. When grouped expressions `(expr)` are added, Unit detection must move to the parser instead.

Whitespace and newlines: skip, but update line/col tracking.

Comments: not in v0.1 spec. Skip for now.

- [ ] **Step 5: Update index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export * as Lexer from "./Lexer.js";
export * as CompilerError from "./CompilerError.js";
```

- [ ] **Step 6: Run tests**

```bash
vp test packages/core/test/Lexer.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Lexer.ts packages/core/src/CompilerError.ts packages/core/src/index.ts packages/core/test/Lexer.test.ts
git commit -m "feat(core): add lexer with keyword, ident, literal, and operator tokenization"
```

---

## Task 4: AST Types

**Files:**

- Create: `packages/core/src/Ast.ts`
- Create: `packages/core/src/TypedAst.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/Ast.test.ts`

- [ ] **Step 1: Write failing test for AST node construction**

`packages/core/test/Ast.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Ast, Span } from "@bang/core";

const span = Span.empty;

describe("Ast", () => {
  it("creates a Program node", () => {
    const program = Ast.Program({ statements: [], span });
    expect(program._tag).toBe("Program");
    expect(program.statements).toEqual([]);
  });

  it("creates a Declaration node", () => {
    const decl = Ast.Declaration({
      name: "greeting",
      mutable: false,
      value: Ast.StringLiteral({ value: "hello", span }),
      typeAnnotation: undefined,
      span,
    });
    expect(decl._tag).toBe("Declaration");
    expect(decl.name).toBe("greeting");
  });

  it("creates a Declare node (external declaration)", () => {
    const decl = Ast.Declare({
      name: "console.log",
      typeAnnotation: Ast.ArrowType({
        param: Ast.ConcreteType({ name: "String", span }),
        result: Ast.EffectType({
          value: Ast.ConcreteType({ name: "Unit", span }),
          deps: ["stdout"],
          error: Ast.ConcreteType({ name: "Unit", span }),
          span,
        }),
        span,
      }),
      span,
    });
    expect(decl._tag).toBe("Declare");
    expect(decl.name).toBe("console.log");
  });

  it("creates a Force node", () => {
    const force = Ast.Force({
      expr: Ast.App({
        func: Ast.Ident({ name: "console.log", span }),
        args: [Ast.Ident({ name: "greeting", span })],
        span,
      }),
      span,
    });
    expect(force._tag).toBe("Force");
    expect(force.expr._tag).toBe("App");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vp test packages/core/test/Ast.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement Ast (untyped AST nodes for v0.1 subset)**

`packages/core/src/Ast.ts`:

Define only the nodes needed for v0.1:

**Statements:** `Program`, `Declaration`, `Declare`, `ForceStatement`, `ExprStatement`
**Expressions:** `Ident`, `DotAccess`, `App`, `StringLiteral`, `IntLiteral`, `BoolLiteral`, `UnitLiteral`, `Force`
**Types:** `ConcreteType`, `ArrowType`, `EffectType`

`EffectType` holds `deps: string[]` and `error: Type` directly — no separate `DepsType` node. The parser handles `{ idents }` in type position by collecting identifiers into the `deps` array, and `{}` as an empty deps/error set.

All as `Data.TaggedEnum` with `span: Span` on every node. Use namespaced enums — `Stmt`, `Expr`, `Type` — to avoid collisions.

Alternatively, use a flat namespace with descriptive tag names since v0.1 is small. Grow into namespaces if needed.

- [ ] **Step 4: Implement TypedAst**

`packages/core/src/TypedAst.ts`:

Wraps each untyped AST node with:

```typescript
interface TypeAnnotation {
  readonly type: Ast.Type;
  readonly effectClass: "signal" | "effect";
}
```

For v0.1, this can be a simple wrapper:

```typescript
interface TypedNode<A> {
  readonly node: A;
  readonly annotation: TypeAnnotation;
}
```

Keep it minimal — the checker will construct these from untyped nodes.

- [ ] **Step 5: Update index.ts**

Add `Ast` and `TypedAst` exports.

- [ ] **Step 6: Run tests**

```bash
vp test packages/core/test/Ast.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Ast.ts packages/core/src/TypedAst.ts packages/core/src/index.ts packages/core/test/Ast.test.ts
git commit -m "feat(core): add AST and TypedAST node types for v0.1 subset"
```

---

## Task 5: Parser

**Files:**

- Create: `packages/core/src/Parser.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/Parser.test.ts`
- Create: `packages/core/test/fixtures/hello.bang`

- [ ] **Step 1: Write failing test for parsing declarations**

`packages/core/test/Parser.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser } from "@bang/core";

const parse = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    return yield* Parser.parse(tokens);
  });

describe("Parser", () => {
  it.effect("parses a simple binding", () =>
    Effect.gen(function* () {
      const ast = yield* parse('greeting = "hello"');
      expect(ast._tag).toBe("Program");
      expect(ast.statements.length).toBe(1);
      expect(ast.statements[0]._tag).toBe("Declaration");
    }),
  );

  it.effect("parses a declare statement", () =>
    Effect.gen(function* () {
      const ast = yield* parse("declare console.log : String -> Effect Unit { stdout } {}");
      expect(ast.statements.length).toBe(1);
      expect(ast.statements[0]._tag).toBe("Declare");
    }),
  );

  it.effect("parses a force statement", () =>
    Effect.gen(function* () {
      const ast = yield* parse("!console.log greeting");
      expect(ast.statements.length).toBe(1);
      expect(ast.statements[0]._tag).toBe("ForceStatement");
      const force = ast.statements[0] as any;
      expect(force.expr._tag).toBe("Force");
    }),
  );

  it.effect("parses function application", () =>
    Effect.gen(function* () {
      const ast = yield* parse("!console.log greeting");
      const force = (ast.statements[0] as any).expr;
      // !console.log greeting → Force(App(DotAccess(console, log), [greeting]))
      const inner = force.expr;
      expect(inner._tag).toBe("App");
    }),
  );

  it.effect("parses the full v0.1 target program", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const ast = yield* parse(source);
      expect(ast.statements.length).toBe(3);
      expect(ast.statements[0]._tag).toBe("Declare");
      expect(ast.statements[1]._tag).toBe("Declaration");
      expect(ast.statements[2]._tag).toBe("ForceStatement");
    }),
  );

  it.effect("reports error for unexpected token", () =>
    Effect.gen(function* () {
      const result = yield* parse("= = =").pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vp test packages/core/test/Parser.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement Parser**

`packages/core/src/Parser.ts`:

```typescript
export const parse: (tokens: ReadonlyArray<Token>) => Effect<Ast.Program, CompilerError>;
```

Implementation approach — recursive descent using Effect composition:

- `parseProgram` — consume statements until EOF
- `parseStatement` — lookahead to determine which statement:
  - `declare` keyword → `parseDeclare`
  - `!` operator → `parseForceStatement`
  - `Ident` followed by `=` → `parseDeclaration`
  - `Ident` followed by atoms (not `=`) → `parseExprStatement` (bare function application, used for must-handle checking)
- `parseDeclare` — `declare` Ident `:` Type
- `parseDeclaration` — Ident `=` Expr
- `parseForceStatement` — `!` Expr (wraps in ForceStatement)
- `parseExpr` — for v0.1: function application (Ident/DotAccess followed by atoms)
- `parseType` — for v0.1: `ConcreteType`, `ArrowType` (`A -> B`), `EffectType` (`Effect A { deps } E`), `{ deps }` for dependency sets

Parser state: token array + cursor index. Use local mutable index (not Ref — synchronous code).

Key parsing decisions for v0.1:

- Dot-access (`ident.ident`) is a general expression form, handled in `parseExpr` — not special-cased to `declare`
- Application: `f x y` → `App(f, [x, y])` by consuming atoms after an expression
- `{ stdout }` in type position is a dependency set, not a block — context-sensitive parsing in type position
- `{}` at end of Effect type is empty error type

- [ ] **Step 4: Create test fixture**

`packages/core/test/fixtures/hello.bang`:

```bang
declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting
```

- [ ] **Step 5: Update index.ts**

Add `Parser` export.

- [ ] **Step 6: Run tests**

```bash
vp test packages/core/test/Parser.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Parser.ts packages/core/src/index.ts packages/core/test/Parser.test.ts packages/core/test/fixtures/hello.bang
git commit -m "feat(core): add parser for declarations, declare, and force statements"
```

---

## Task 6: Checker

**Files:**

- Create: `packages/core/src/Checker.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/Checker.test.ts`

- [ ] **Step 1: Write failing test for checker**

`packages/core/test/Checker.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser, Checker } from "@bang/core";

const check = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    return yield* Checker.check(ast);
  });

describe("Checker", () => {
  it.effect("checks a valid program", () =>
    Effect.gen(function* () {
      const typed = yield* check(`declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`);
      expect(typed._tag).toBe("Program");
      expect(typed.statements.length).toBe(3);
    }),
  );

  it.effect("resolves force of declared Effect as yield*", () =>
    Effect.gen(function* () {
      const typed = yield* check(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      const forceStmt = typed.statements[1] as any;
      expect(forceStmt.annotation.effectClass).toBe("effect");
      expect(forceStmt.annotation.forceResolution).toBe("yield*");
    }),
  );

  it.effect("validates scope — undeclared identifier is an error", () =>
    Effect.gen(function* () {
      const result = yield* check("!undeclared").pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("validates must-handle — unforced Effect in statement position", () =>
    Effect.gen(function* () {
      // Calling an Effect function without ! should error
      const result = yield* check(`declare fetch : String -> Effect String { net } {}
fetch "url"`).pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("classifies declarations as signal", () =>
    Effect.gen(function* () {
      const typed = yield* check('greeting = "hello"');
      const decl = typed.statements[0] as any;
      expect(decl.annotation.effectClass).toBe("signal");
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vp test packages/core/test/Checker.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement Checker**

`packages/core/src/Checker.ts`:

```typescript
export const check: (ast: Ast.Program) => Effect<TypedAst.Program, CompilerError>;
```

Implementation:

1. **Build scope** — Walk statements, collect `declare` and `Declaration` bindings into a `Map<string, ScopeEntry>`. `ScopeEntry` tracks the name, type (if annotated), and effect classification.
2. **Classify nodes** — Bottom-up walk:
   - Literals → signal
   - `Ident` referencing a declared Effect function → effect (but only when forced)
   - `Force` of an Effect-classified expr → effect, resolution = "yield\*"
   - `Declaration` with plain value initializer → signal
3. **Validate scope** — Every `Ident` must exist in scope. Error otherwise.
4. **Must-handle** — Any expression in statement position whose type is Effect and is not wrapped in Force → `CheckError`.
5. **Force resolution** — For v0.1, all forced expressions resolve to "yield\*" since we only have `declare` with Effect types. Promise/thunk/value resolution comes in later slices.

Output: `TypedAst.Program` where each node carries `TypeAnnotation` with `effectClass` and `forceResolution`.

- [ ] **Step 4: Update index.ts**

Add `Checker` export.

- [ ] **Step 5: Run tests**

```bash
vp test packages/core/test/Checker.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/Checker.ts packages/core/src/index.ts packages/core/test/Checker.test.ts
git commit -m "feat(core): add checker with scope validation, force resolution, and signal/effect classification"
```

---

## Task 7: Codegen

**Files:**

- Create: `packages/core/src/Codegen.ts`
- Create: `packages/core/src/SourceMap.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/Codegen.test.ts`
- Create: `packages/core/test/fixtures/hello.expected.ts`

- [ ] **Step 1: Write the expected output for the v0.1 target program**

`packages/core/test/fixtures/hello.expected.ts`:

```typescript
import { Effect } from "effect";

const console_log = (s: string) => Effect.sync(() => console.log(s));

const main = Effect.gen(function* () {
  const greeting = "hello, bang";
  yield* console_log(greeting);
});

Effect.runPromise(main);
```

**Design decision: `declare` generates a wrapper function.** When `declare` maps a JS function to an Effect type, codegen emits a wrapper that produces the appropriate Effect. This way `!` always means `yield*` — no special cases in force resolution.

- `declare f : A -> Effect B { deps } E` where `f` is a raw JS function → codegen emits a wrapper: `const f_bang = (a: A) => Effect.sync(() => f(a))`
- The wrapper name is derived from the declared name (dots replaced with underscores)
- All `!f` calls then compile uniformly to `yield* f_bang(...)`

Key invariants:

- Imports from `effect` are generated
- Top-level `!` wraps in `Effect.runPromise`
- `greeting` becomes a `const` binding
- `declare` generates a wrapper; `!` always means `yield*`

- [ ] **Step 2: Write failing test**

`packages/core/test/Codegen.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser, Checker, Codegen } from "@bang/core";

const compile = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    const ast = yield* Parser.parse(tokens);
    const typed = yield* Checker.check(ast);
    return yield* Codegen.generate(typed);
  });

describe("Codegen", () => {
  it.effect("generates a const binding", () =>
    Effect.gen(function* () {
      const output = yield* compile('greeting = "hello"');
      expect(output.code).toContain('const greeting = "hello"');
    }),
  );

  it.effect("generates Effect.gen wrapper for top-level force", () =>
    Effect.gen(function* () {
      const output = yield* compile(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      expect(output.code).toContain("Effect.gen(function*");
      expect(output.code).toContain("Effect.runPromise");
    }),
  );

  it.effect("generates yield* for forced effects", () =>
    Effect.gen(function* () {
      const output = yield* compile(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      expect(output.code).toContain("yield*");
    }),
  );

  it.effect("generates import { Effect } from 'effect'", () =>
    Effect.gen(function* () {
      const output = yield* compile(`declare console.log : String -> Effect Unit { stdout } {}
!console.log "hello"`);
      expect(output.code).toContain('import { Effect } from "effect"');
    }),
  );

  it.effect("compiles the full v0.1 target program", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const output = yield* compile(source);
      // Verify key structural elements
      expect(output.code).toContain('import { Effect } from "effect"');
      expect(output.code).toContain("const greeting");
      expect(output.code).toContain("Effect.runPromise");
      expect(output.code).toContain("yield*");
    }),
  );

  it.effect("builds source map entries", () =>
    Effect.gen(function* () {
      const source = 'greeting = "hello"';
      const output = yield* compile(source);
      expect(output.sourceMap.size).toBeGreaterThan(0);
    }),
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
vp test packages/core/test/Codegen.test.ts
```

Expected: FAIL

- [ ] **Step 4: Implement SourceMap**

`packages/core/src/SourceMap.ts`:

```typescript
import type { Span } from "./Span.js";

export interface TSPosition {
  readonly line: number;
  readonly col: number;
}

export interface SourceMap {
  readonly entries: Map<string, Span>; // "line:col" → Bang span
  readonly size: number;
}

export const empty = (): SourceMap => ({
  entries: new Map(),
  get size() {
    return this.entries.size;
  },
});

// Note: SourceMap uses internal mutation during codegen (builder pattern).
// This is scoped to the codegen phase only — never exposed as shared mutable state.
export const add = (map: SourceMap, tsPos: TSPosition, bangSpan: Span): void => {
  map.entries.set(`${tsPos.line}:${tsPos.col}`, bangSpan);
};

export const lookup = (map: SourceMap, tsPos: TSPosition): Span | undefined =>
  map.entries.get(`${tsPos.line}:${tsPos.col}`);
```

- [ ] **Step 5: Implement Codegen**

`packages/core/src/Codegen.ts`:

```typescript
export interface CodegenOutput {
  readonly code: string;
  readonly sourceMap: SourceMap;
}

export const generate: (ast: TypedAst.Program) => Effect<CodegenOutput, CompilerError>;
```

Implementation — a `Writer` that builds a string with indentation tracking:

1. **Import collection** — Walk the typed AST, collect which Effect modules are referenced. Emit `import { Effect } from "effect"` (and others as needed).
2. **Top-level detection** — If any top-level statement is a `ForceStatement`, wrap the entire module body in `Effect.gen(function*() { ... })` and add `Effect.runPromise(main)`.
3. **Declare wrapper emission** — For each `Declare` node, emit a wrapper function:
   - `declare console.log : String -> Effect Unit { stdout } {}` → `const console_log = (s: string) => Effect.sync(() => console.log(s))`
   - Wrapper name: dots replaced with underscores
   - All references to the declared name in the rest of codegen use the wrapper name
4. **Statement emission:**
   - `Declaration` → `const name = <emit expr>`
   - `ForceStatement` → `yield* <emit force expr>`
   - `ExprStatement` → should not reach codegen (checker rejects unforced Effects)
5. **Expression emission:**
   - `StringLiteral` → `"value"`
   - `IntLiteral` → `value`
   - `Ident` → `name` (mapped to wrapper name if from `declare`)
   - `DotAccess` → `object.field`
   - `App` → `func(arg1, arg2)` (wrapper functions take normal args)
   - `Force` → `yield* expr` (always — wrapper makes this uniform)
6. **Source map** — As each node is emitted, record the TS line/col → Bang span mapping.

Key v0.1 codegen decisions:

- `declare` generates wrapper functions; `!` always means `yield*` — no special cases
- Top-level structure: `const main = Effect.gen(function*() { ... }); Effect.runPromise(main)`

- [ ] **Step 6: Update index.ts**

Add `Codegen` and `SourceMap` exports.

- [ ] **Step 7: Run tests**

```bash
vp test packages/core/test/Codegen.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/Codegen.ts packages/core/src/SourceMap.ts packages/core/src/index.ts packages/core/test/Codegen.test.ts packages/core/test/fixtures/hello.expected.ts
git commit -m "feat(core): add codegen emitting Effect TS with source map"
```

---

## Task 8: Compiler Pipeline

**Files:**

- Create: `packages/core/src/Compiler.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/Compiler.test.ts`

- [ ] **Step 1: Write failing end-to-end test**

`packages/core/test/Compiler.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Compiler } from "@bang/core";

describe("Compiler", () => {
  it.effect("compiles the v0.1 target program end-to-end", () =>
    Effect.gen(function* () {
      const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain('import { Effect } from "effect"');
      expect(result.code).toContain("const greeting");
      expect(result.code).toContain("Effect.runPromise");
    }),
  );

  it.effect("compile returns errors for invalid source", () =>
    Effect.gen(function* () {
      const result = yield* Compiler.compile("= = =").pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("exposes individual phases", () =>
    Effect.gen(function* () {
      const tokens = yield* Compiler.lex("x = 42");
      expect(tokens.length).toBeGreaterThan(0);

      const ast = yield* Compiler.parse(tokens);
      expect(ast._tag).toBe("Program");
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vp test packages/core/test/Compiler.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement Compiler**

`packages/core/src/Compiler.ts`:

```typescript
import { Effect } from "effect";
import * as Lexer from "./Lexer.js";
import * as Parser from "./Parser.js";
import * as Checker from "./Checker.js";
import * as Codegen from "./Codegen.js";
import type { CompilerError } from "./CompilerError.js";
import type { Token } from "./Token.js";
import type * as Ast from "./Ast.js";
import type * as TypedAst from "./TypedAst.js";

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
```

- [ ] **Step 4: Update index.ts**

Add `Compiler` export.

- [ ] **Step 5: Run tests**

```bash
vp test packages/core/test/Compiler.test.ts
```

Expected: PASS

- [ ] **Step 6: Run all core tests**

```bash
vp test packages/core
```

Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/Compiler.ts packages/core/src/index.ts packages/core/test/Compiler.test.ts
git commit -m "feat(core): add compiler pipeline composing lex → parse → check → codegen"
```

---

## Task 9: Error Formatter

**Files:**

- Create: `packages/core/src/ErrorFormatter.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ErrorFormatter.test.ts`

- [ ] **Step 1: Write failing test for Rust-style error rendering**

`packages/core/test/ErrorFormatter.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { ErrorFormatter, CompilerError, Span } from "@bang/core";

describe("ErrorFormatter", () => {
  it("formats a lex error with source context", () => {
    const source = 'greeting = "hello';
    const error = CompilerError.LexError({
      message: "Unterminated string literal",
      span: Span.make({
        startLine: 1,
        startCol: 11,
        startOffset: 11,
        endLine: 1,
        endCol: 17,
        endOffset: 17,
      }),
      hint: 'Add a closing " to the string',
    });
    const formatted = ErrorFormatter.format(error, source);
    expect(formatted).toContain("error[lex]");
    expect(formatted).toContain("Unterminated string literal");
    expect(formatted).toContain("1 |");
    expect(formatted).toContain("^");
    expect(formatted).toContain('Add a closing "');
  });

  it("formats errors with line numbers", () => {
    const source = "line1\nline2\nline3";
    const error = CompilerError.ParseError({
      message: "Unexpected token",
      span: Span.make({
        startLine: 2,
        startCol: 0,
        startOffset: 6,
        endLine: 2,
        endCol: 5,
        endOffset: 11,
      }),
    });
    const formatted = ErrorFormatter.format(error, source);
    expect(formatted).toContain("2 |");
    expect(formatted).toContain("line2");
  });

  it("formats multiple errors with separation", () => {
    const source = 'x = "hello\ny = "world';
    const errors = [
      CompilerError.LexError({
        message: "Unterminated string",
        span: Span.make({
          startLine: 1,
          startCol: 4,
          startOffset: 4,
          endLine: 1,
          endCol: 10,
          endOffset: 10,
        }),
      }),
      CompilerError.LexError({
        message: "Unterminated string",
        span: Span.make({
          startLine: 2,
          startCol: 4,
          startOffset: 15,
          endLine: 2,
          endCol: 10,
          endOffset: 21,
        }),
      }),
    ];
    const formatted = ErrorFormatter.formatAll(errors, source);
    // Should contain both errors
    expect(formatted.split("error[lex]").length - 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vp test packages/core/test/ErrorFormatter.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement ErrorFormatter**

`packages/core/src/ErrorFormatter.ts`:

Rust-style format:

```
error[lex]: Unterminated string literal
 --> source.bang:1:12
  |
1 | greeting = "hello
  |            ^^^^^^
  |
  = hint: Add a closing " to the string
```

Implementation:

- Extract source line from the span
- Build gutter with line numbers
- Place carets (`^`) under the span range
- Color: error tag in red, hint in blue (using ANSI codes)
- Support multi-error rendering (join with blank lines)

- [ ] **Step 4: Update index.ts**

Add `ErrorFormatter` export.

- [ ] **Step 5: Run tests**

```bash
vp test packages/core/test/ErrorFormatter.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ErrorFormatter.ts packages/core/src/index.ts packages/core/test/ErrorFormatter.test.ts
git commit -m "feat(core): add Rust-style error formatter with source context and hints"
```

---

## Task 10: CLI — compile and run commands

**Files:**

- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/Compile.ts`
- Create: `packages/cli/src/Run.ts`
- Test: `packages/cli/test/Cli.test.ts`

- [ ] **Step 1: Write failing test for CLI compile command**

`packages/cli/test/Cli.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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

      // Import and invoke compile directly (test the function, not the CLI binary)
      const { compileFile } = yield* Effect.promise(() => import("../src/Compile.js"));
      yield* compileFile(inputPath).pipe(Effect.provide(NodeContext.layer));

      const outputPath = path.join(tmpDir, "hello.ts");
      expect(fs.existsSync(outputPath)).toBe(true);
      const output = fs.readFileSync(outputPath, "utf-8");
      expect(output).toContain('import { Effect } from "effect"');

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true });
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vp test packages/cli/test/Cli.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement Compile command**

`packages/cli/src/Compile.ts`:

```typescript
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { Compiler, ErrorFormatter } from "@bang/core";
import * as path from "node:path";

export const compileFile = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(filePath);
    const result = yield* Compiler.compile(source);

    const outPath = filePath.replace(/\.bang$/, ".ts");
    yield* fs.writeFileString(outPath, result.code);
  });
```

- [ ] **Step 4: Implement Run command**

`packages/cli/src/Run.ts`:

Compiles to a temp directory, then executes via the host runtime (`bun` or `tsx`).

```typescript
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { Command } from "@effect/platform";
import { Compiler } from "@bang/core";
import * as path from "node:path";
import * as os from "node:os";

export const runFile = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(filePath);
    const result = yield* Compiler.compile(source);

    const tmpDir = path.join(os.tmpdir(), "bang-run-" + Date.now());
    yield* fs.makeDirectory(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, "main.ts");
    yield* fs.writeFileString(outPath, result.code);

    // Execute with bun — consult @effect/platform Command API for exact pipe pattern
    // The implementing agent should check ~/Projects/Repos/effect/packages/platform/src/Command.ts
    // for the correct way to pipe stdout/stderr to the parent process
    yield* Command.make("bun", "run", outPath).pipe(
      Command.stdout("inherit"),
      Command.stderr("inherit"),
      Command.exitCode,
    );
  });
```

- [ ] **Step 5: Implement CLI entry point**

`packages/cli/src/index.ts`:

**IMPORTANT:** Verify `@effect/cli` API against the Effect repo at `~/Projects/Repos/effect/packages/cli/src/` or use context7 before implementing. The API below is approximate — the exact signatures may differ.

Wire up using `@effect/cli`:

```typescript
import { Command, Options, Args } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { compileFile } from "./Compile.js";
import { runFile } from "./Run.js";

const filePath = Args.file({ name: "file", exists: "yes" });

const compile = Command.make("compile", { filePath }, ({ filePath }) => compileFile(filePath));

const run = Command.make("run", { filePath }, ({ filePath }) => runFile(filePath));

const bang = Command.make("bang").pipe(Command.withSubcommands([compile, run]));

const cli = Command.run(bang, { name: "bang", version: "0.0.1" });

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
```

- [ ] **Step 6: Run tests**

```bash
vp test packages/cli/test/Cli.test.ts
```

Expected: PASS

- [ ] **Step 7: Test manually with the example**

```bash
cd /Users/nori/Projects/bang-lang
bun run packages/cli/src/index.ts compile examples/hello.bang
cat examples/hello.ts
```

Verify the output is valid Effect TS.

- [ ] **Step 8: Test run command**

```bash
bun run packages/cli/src/index.ts run examples/hello.bang
```

Expected: prints "hello, bang" to stdout.

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/ packages/cli/test/ packages/cli/package.json packages/cli/tsconfig.json
git commit -m "feat(cli): add compile and run commands"
```

---

## Task 11: End-to-End Snapshot Tests

**Files:**

- Modify: `packages/core/test/Compiler.test.ts`
- Create: additional fixtures as needed

- [ ] **Step 1: Add snapshot test for v0.1 target**

Add to `packages/core/test/Compiler.test.ts`:

```typescript
it.effect("snapshot: hello.bang", () =>
  Effect.gen(function* () {
    const source = `declare console.log : String -> Effect Unit { stdout } {}

greeting = "hello, bang"
!console.log greeting`;
    const result = yield* Compiler.compile(source);
    expect(result.code).toMatchSnapshot();
  }),
);
```

- [ ] **Step 2: Run test to generate snapshot**

```bash
vp test packages/core/test/Compiler.test.ts --update
```

- [ ] **Step 3: Review the snapshot**

Read the generated snapshot file and verify the output is correct, valid Effect TS.

- [ ] **Step 4: Run all tests one final time**

```bash
vp test
```

Expected: ALL PASS across both packages.

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/Compiler.test.ts packages/core/test/__snapshots__/
git commit -m "test: add end-to-end snapshot tests for v0.1 target program"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run full check suite**

```bash
vp check
vp test
```

Both must pass.

- [ ] **Step 2: Verify the compiled output actually runs**

```bash
bun run packages/cli/src/index.ts run examples/hello.bang
```

Expected output: `hello, bang`

- [ ] **Step 3: Review all files for cleanup**

Check for:

- Unused imports
- TODO comments that should be addressed
- Any hardcoded paths

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "chore: cleanup and final verification for v0.1"
```

---

## Summary

| Task | What it delivers    | Test count     |
| ---- | ------------------- | -------------- |
| 1    | Monorepo scaffold   | 0 (structural) |
| 2    | Span + Token types  | ~7             |
| 3    | Lexer               | ~11            |
| 4    | AST types           | ~4             |
| 5    | Parser              | ~6             |
| 6    | Checker             | ~5             |
| 7    | Codegen + SourceMap | ~6             |
| 8    | Compiler pipeline   | ~3             |
| 9    | Error formatter     | ~3             |
| 10   | CLI (compile + run) | ~2             |
| 11   | E2E snapshots       | ~1             |
| 12   | Final verification  | 0 (manual)     |

**Total: 12 tasks, ~48 tests, full pipeline from `.bang` source to running Effect TS.**
