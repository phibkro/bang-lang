import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Lexer, Parser } from "@bang/core";

const parseSource = (src: string) =>
  Effect.gen(function* () {
    const tokens = yield* Lexer.tokenize(src);
    return yield* Parser.parse(tokens);
  });

describe("Braced multi-handler", () => {
  it.effect("parses braced multi-handler", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource("x = y.handle { Console -> impl1, Database -> impl2 }");
      const decl = ast.statements[0];
      if (decl._tag === "Declaration") {
        // Should be App(DotAccess(..., "handle"), [...])
        // The outermost should be the last handler (Database)
        expect(decl.value._tag).toBe("App");
        if (decl.value._tag === "App") {
          // Outermost: App(DotAccess(inner, "handle"), [Database, impl2])
          expect(decl.value.func._tag).toBe("DotAccess");
          if (decl.value.func._tag === "DotAccess") {
            expect(decl.value.func.field).toBe("handle");
            // Inner: App(DotAccess(y, "handle"), [Console, impl1])
            expect(decl.value.func.object._tag).toBe("App");
          }
          expect(decl.value.args).toHaveLength(2);
          if (decl.value.args[0]._tag === "Ident") {
            expect(decl.value.args[0].name).toBe("Database");
          }
        }
      }
    }),
  );

  it.effect("parses single braced handler", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource("x = y.handle { Console -> impl1 }");
      const decl = ast.statements[0];
      if (decl._tag === "Declaration") {
        expect(decl.value._tag).toBe("App");
        if (decl.value._tag === "App") {
          expect(decl.value.func._tag).toBe("DotAccess");
          expect(decl.value.args).toHaveLength(2);
        }
      }
    }),
  );

  it.effect("parses braced handler with trailing comma", () =>
    Effect.gen(function* () {
      const ast = yield* parseSource("x = y.handle { Console -> impl1, }");
      const decl = ast.statements[0];
      if (decl._tag === "Declaration") {
        expect(decl.value._tag).toBe("App");
      }
    }),
  );
});
