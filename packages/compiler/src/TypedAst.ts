import type * as Ast from "@bang/core/Ast";
import type { InferType } from "@bang/core/InferType";
import type { Span } from "@bang/core/Span";

export interface TypeAnnotation {
  readonly type: InferType;
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

// ---------------------------------------------------------------------------
// Typed program structure
// ---------------------------------------------------------------------------

export type TypedStmt = TypedNode<Ast.Stmt>;

export interface TypedProgram {
  readonly _tag: "Program";
  readonly statements: TypedStmt[];
  readonly span: Span;
}
