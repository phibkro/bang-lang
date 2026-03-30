import { describe, expect, it } from "@effect/vitest";
import * as TE from "../src/TypeError.js";
import * as T from "../src/InferType.js";
import { Span } from "../src/Span.js";

const s = new Span({ start: 0, end: 5 });

describe("TypeError", () => {
  it("creates UnificationError", () => {
    const e = new TE.UnificationError({
      expected: T.tInt,
      actual: T.tString,
      span: s,
    });
    expect(e._tag).toBe("UnificationError");
  });

  it("creates UndefinedVariable", () => {
    const e = new TE.UndefinedVariable({ name: "foo", span: s });
    expect(e._tag).toBe("UndefinedVariable");
  });

  it("creates OccursCheck", () => {
    const e = new TE.OccursCheck({
      varId: 0,
      type: new T.TArrow({ param: new T.TVar({ id: 0 }), result: T.tInt }),
      span: s,
    });
    expect(e._tag).toBe("OccursCheck");
  });

  it("formats UnificationError", () => {
    const e = new TE.UnificationError({
      expected: T.tInt,
      actual: T.tString,
      span: s,
    });
    expect(TE.formatTypeError(e)).toContain("Int");
    expect(TE.formatTypeError(e)).toContain("String");
  });

  it("formats UndefinedVariable", () => {
    const e = new TE.UndefinedVariable({ name: "foo", span: s });
    expect(TE.formatTypeError(e)).toContain("foo");
  });

  it("formats OccursCheck", () => {
    const e = new TE.OccursCheck({
      varId: 0,
      type: new T.TArrow({ param: new T.TVar({ id: 0 }), result: T.tInt }),
      span: s,
    });
    expect(TE.formatTypeError(e)).toContain("?0");
  });
});
