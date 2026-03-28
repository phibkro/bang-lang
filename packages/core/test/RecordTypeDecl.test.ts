import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Interpreter, Lexer, Parser, Formatter } from "@bang/core";

const parse = (source: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(source);
    return yield* Parser.parse(tokens);
  });

describe("RecordTypeDecl", () => {
  it.effect("parses record type declaration", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type User = { name: String, age: Int }");
      expect(ast.statements.length).toBe(1);
      const stmt = ast.statements[0];
      expect(stmt._tag).toBe("RecordTypeDecl");
      if (stmt._tag !== "RecordTypeDecl") throw new Error("unreachable");
      expect(stmt.name).toBe("User");
      expect(stmt.fields.length).toBe(2);
      expect(stmt.fields[0].name).toBe("name");
      expect(stmt.fields[0].type._tag).toBe("ConcreteType");
      expect((stmt.fields[0].type as any).name).toBe("String");
      expect(stmt.fields[1].name).toBe("age");
      expect((stmt.fields[1].type as any).name).toBe("Int");
    }),
  );

  it.effect("parses record type with single field", () =>
    Effect.gen(function* () {
      const ast = yield* parse("type Wrapper = { value: Int }");
      expect(ast.statements.length).toBe(1);
      const stmt = ast.statements[0];
      expect(stmt._tag).toBe("RecordTypeDecl");
      if (stmt._tag !== "RecordTypeDecl") throw new Error("unreachable");
      expect(stmt.name).toBe("Wrapper");
      expect(stmt.fields.length).toBe(1);
      expect(stmt.fields[0].name).toBe("value");
    }),
  );

  it.effect("distinguishes record from ADT", () =>
    Effect.gen(function* () {
      const adtAst = yield* parse("type Shape = Circle | Point");
      expect(adtAst.statements[0]._tag).toBe("TypeDecl");

      const recordAst = yield* parse("type User = { name: String }");
      expect(recordAst.statements[0]._tag).toBe("RecordTypeDecl");
    }),
  );

  it.effect("distinguishes record from newtype", () =>
    Effect.gen(function* () {
      const newtypeAst = yield* parse("type Email = String");
      expect(newtypeAst.statements[0]._tag).toBe("NewtypeDecl");

      const recordAst = yield* parse("type User = { name: String }");
      expect(recordAst.statements[0]._tag).toBe("RecordTypeDecl");
    }),
  );

  it.effect("interprets record type construction", () =>
    Effect.gen(function* () {
      const source = `type User = { name: String, age: Int }
x = User "alice" 30`;
      const tokens = yield* Lexer.tokenize(source);
      const ast = yield* Parser.parse(tokens);
      const result = yield* Interpreter.evalProgram(ast);
      expect(result._tag).toBe("Tagged");
      if (result._tag !== "Tagged") throw new Error("unreachable");
      expect(result.tag).toBe("User");
      expect(result.fields.length).toBe(2);
    }),
  );

  it.effect("formats record type declaration", () =>
    Effect.gen(function* () {
      const source = "type User = { name: String, age: Int }";
      const formatted = yield* Formatter.formatSource(source);
      expect(formatted).toContain("type User = { name : String, age : Int }");
    }),
  );
});
