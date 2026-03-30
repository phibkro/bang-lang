import { describe, expect, it } from "@effect/vitest";
import * as T from "../src/InferType.js";

describe("InferType", () => {
  it("creates TVar", () => {
    const v = new T.TVar({ id: 0 });
    expect(v._tag).toBe("TVar");
    expect(v.id).toBe(0);
  });

  it("creates TCon", () => {
    const t = new T.TCon({ name: "Int" });
    expect(t._tag).toBe("TCon");
    expect(t.name).toBe("Int");
  });

  it("creates TArrow", () => {
    const t = new T.TArrow({
      param: new T.TCon({ name: "Int" }),
      result: new T.TCon({ name: "String" }),
    });
    expect(t._tag).toBe("TArrow");
  });

  it("creates TApp", () => {
    const t = new T.TApp({
      ctor: new T.TCon({ name: "Maybe" }),
      arg: new T.TCon({ name: "Int" }),
    });
    expect(t._tag).toBe("TApp");
  });

  it("pretty-prints TCon", () => {
    expect(T.prettyPrint(new T.TCon({ name: "Int" }))).toBe("Int");
  });

  it("pretty-prints TVar", () => {
    expect(T.prettyPrint(new T.TVar({ id: 0 }))).toBe("?0");
  });

  it("pretty-prints TArrow", () => {
    const t = new T.TArrow({
      param: new T.TCon({ name: "Int" }),
      result: new T.TCon({ name: "String" }),
    });
    expect(T.prettyPrint(t)).toBe("Int -> String");
  });

  it("pretty-prints nested TArrow right-associative", () => {
    const t = new T.TArrow({
      param: new T.TCon({ name: "Int" }),
      result: new T.TArrow({
        param: new T.TCon({ name: "String" }),
        result: new T.TCon({ name: "Bool" }),
      }),
    });
    expect(T.prettyPrint(t)).toBe("Int -> String -> Bool");
  });

  it("pretty-prints TArrow param that is arrow with parens", () => {
    const t = new T.TArrow({
      param: new T.TArrow({
        param: new T.TCon({ name: "Int" }),
        result: new T.TCon({ name: "Int" }),
      }),
      result: new T.TCon({ name: "Bool" }),
    });
    expect(T.prettyPrint(t)).toBe("(Int -> Int) -> Bool");
  });

  it("pretty-prints TApp", () => {
    const t = new T.TApp({
      ctor: new T.TCon({ name: "Maybe" }),
      arg: new T.TCon({ name: "Int" }),
    });
    expect(T.prettyPrint(t)).toBe("Maybe Int");
  });
});
