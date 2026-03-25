import type * as Ast from "./Ast.js";

export interface TypeAnnotation {
  readonly type: Ast.Type;
  readonly effectClass: "signal" | "effect";
  readonly forceResolution?: "yield*" | "promise" | "sync" | "none";
}

// A typed node pairs an untyped AST node with its inferred annotation.
export interface TypedNode<T extends Ast.Node> {
  readonly node: T;
  readonly annotation: TypeAnnotation;
}

export const annotate = <T extends Ast.Node>(
  node: T,
  annotation: TypeAnnotation,
): TypedNode<T> => ({ node, annotation });
