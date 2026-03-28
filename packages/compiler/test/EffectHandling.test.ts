import { describe, expect, it } from "@effect/vitest";
import { Effect, HashMap } from "effect";
import * as Ast from "@bang/core/Ast";
import * as Span from "@bang/core/Span";
import { Interpreter, Lexer, Parser, Value } from "@bang/core";
import { Compiler } from "@bang/compiler";

const s = Span.empty;
const emptyEnv = HashMap.empty<string, Value.Value>();

describe("Dot methods — interpreter", () => {
  it.effect(".map transforms a value through a function", () =>
    Effect.gen(function* () {
      // { 42 }.map (n) -> { n + 1 }
      // App(DotAccess(Block([], 42), "map"), [Lambda(["n"], n + 1)])
      const expr = new Ast.App({
        func: new Ast.DotAccess({
          object: new Ast.Block({
            statements: [],
            expr: new Ast.IntLiteral({ value: 42, span: s }),
            span: s,
          }),
          field: "map",
          span: s,
        }),
        args: [
          new Ast.Lambda({
            params: ["n"],
            body: new Ast.BinaryExpr({
              op: "+",
              left: new Ast.Ident({ name: "n", span: s }),
              right: new Ast.IntLiteral({ value: 1, span: s }),
              span: s,
            }),
            span: s,
          }),
        ],
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 43 }));
    }),
  );

  it.effect(".tap runs side effect but returns original value", () =>
    Effect.gen(function* () {
      // { 42 }.tap (n) -> { n + 1 }
      // Result should be 42, not 43
      const expr = new Ast.App({
        func: new Ast.DotAccess({
          object: new Ast.Block({
            statements: [],
            expr: new Ast.IntLiteral({ value: 42, span: s }),
            span: s,
          }),
          field: "tap",
          span: s,
        }),
        args: [
          new Ast.Lambda({
            params: ["n"],
            body: new Ast.BinaryExpr({
              op: "+",
              left: new Ast.Ident({ name: "n", span: s }),
              right: new Ast.IntLiteral({ value: 1, span: s }),
              span: s,
            }),
            span: s,
          }),
        ],
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 42 }));
    }),
  );

  it.effect(".handle binds an implementation and makes it available", () =>
    Effect.gen(function* () {
      // Test: a block that looks up Console in env and calls .log
      // { !Console.log "hi" }.handle Console impl
      // For interpreter: .handle re-evaluates the object with the handler bound
      //
      // Simpler test: { x }.handle via re-evaluation with x bound
      // Let's test: { x }.handle where x is looked up from an ident provided by handle
      //
      // Actually: .handle(TypeName, impl) re-evaluates object with TypeName=impl in env
      // Test: { MyService }.handle MyService 99
      // Result: 99 (re-evaluates { MyService } with MyService=99 in env)
      const expr = new Ast.App({
        func: new Ast.DotAccess({
          object: new Ast.Block({
            statements: [],
            expr: new Ast.Ident({ name: "MyService", span: s }),
            span: s,
          }),
          field: "handle",
          span: s,
        }),
        args: [
          new Ast.Ident({ name: "MyService", span: s }),
          new Ast.IntLiteral({ value: 99, span: s }),
        ],
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 99 }));
    }),
  );

  it.effect(".catch recovers from matching errors", () =>
    Effect.gen(function* () {
      // Test: an expression that fails with an error containing "NotFound",
      // caught by .catch NotFound handler
      // We need something that fails. A block with undefined var "NotFound_trigger" will fail,
      // but the error message is "Undefined variable: NotFound_trigger"
      //
      // Better: use a block that accesses an undefined NotFound var
      // { NotFound }.catch NotFound (msg) -> { 0 }
      const expr = new Ast.App({
        func: new Ast.DotAccess({
          object: new Ast.Block({
            statements: [],
            expr: new Ast.Ident({ name: "NotFound", span: s }),
            span: s,
          }),
          field: "catch",
          span: s,
        }),
        args: [
          new Ast.Ident({ name: "NotFound", span: s }),
          new Ast.Lambda({
            params: ["msg"],
            body: new Ast.IntLiteral({ value: 0, span: s }),
            span: s,
          }),
        ],
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv);
      expect(result).toEqual(Value.Num({ value: 0 }));
    }),
  );

  it.effect(".catch does not catch non-matching errors", () =>
    Effect.gen(function* () {
      // { undefinedVar }.catch WrongTag handler → should still fail
      const expr = new Ast.App({
        func: new Ast.DotAccess({
          object: new Ast.Block({
            statements: [],
            expr: new Ast.Ident({ name: "undefinedVar", span: s }),
            span: s,
          }),
          field: "catch",
          span: s,
        }),
        args: [
          new Ast.Ident({ name: "WrongTag", span: s }),
          new Ast.Lambda({
            params: ["msg"],
            body: new Ast.IntLiteral({ value: 0, span: s }),
            span: s,
          }),
        ],
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, emptyEnv).pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }),
  );

  it.effect("DotAccess on tagged value for field-like access falls through to dot lookup", () =>
    Effect.gen(function* () {
      // DotAccess alone (not as part of App with known method) should try env lookup
      // e.g. Console.log where Console is in env as a Tagged value
      // For now, test that DotAccess on a simple ident resolves via env dotted name
      const env = HashMap.set(emptyEnv, "Console.log", Value.Num({ value: 42 }));
      const expr = new Ast.DotAccess({
        object: new Ast.Ident({ name: "Console", span: s }),
        field: "log",
        span: s,
      });
      const result = yield* Interpreter.evalExpr(expr, env);
      expect(result).toEqual(Value.Num({ value: 42 }));
    }),
  );
});

describe("Dot methods — codegen", () => {
  it.effect(".map generates pipe + Effect.map", () =>
    Effect.gen(function* () {
      const source = `inc = n -> { n + 1 }\nx = { 42 }.map inc`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.map");
      expect(result.code).toContain("pipe(");
    }),
  );

  it.effect(".tap generates pipe + Effect.tap", () =>
    Effect.gen(function* () {
      const source = `id = n -> { n }\nx = { 42 }.tap id`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.tap");
      expect(result.code).toContain("pipe(");
    }),
  );

  it.effect(".handle generates pipe + Effect.provide + Layer.succeed", () =>
    Effect.gen(function* () {
      const source = `type MyService = MyService\nx = { 42 }.handle MyService "impl"`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.provide");
      expect(result.code).toContain("Layer.succeed");
    }),
  );

  it.effect(".catch generates pipe + Effect.catchTag", () =>
    Effect.gen(function* () {
      const source = `type NotFound = NotFound\nhandler = msg -> { 0 }\nx = { 42 }.catch NotFound handler`;
      const result = yield* Compiler.compile(source);
      expect(result.code).toContain("Effect.catchTag");
    }),
  );
});

describe("Dot methods — parse roundtrip", () => {
  it.effect("parses expr.map f as App(DotAccess(expr, map), [f])", () =>
    Effect.gen(function* () {
      const source = `inc = n -> { n + 1 }\nx = { 42 }.map inc`;
      const tokens = yield* Lexer.tokenize(source);
      const ast = yield* Parser.parse(tokens);
      const decl = ast.statements[1];
      expect(decl._tag).toBe("Declaration");
      if (decl._tag !== "Declaration") return;
      expect(decl.value._tag).toBe("App");
      if (decl.value._tag !== "App") return;
      expect(decl.value.func._tag).toBe("DotAccess");
      if (decl.value.func._tag !== "DotAccess") return;
      expect(decl.value.func.field).toBe("map");
    }),
  );
});
