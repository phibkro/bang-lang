# Bang Interpreter — Design Spec

**Date:** 2026-03-26
**Purpose:** Reference interpreter for testing compiler correctness via `eval(ast) ≡ run(codegen(ast))`

## Overview

A direct AST interpreter that evaluates Bang programs to values without compiling to Effect TS. Serves as ground truth semantics for:

1. Property-testing compiler correctness
2. Pretty-printer roundtrip testing: `eval(parse(print(ast))) ≡ eval(ast)`
3. Future REPL (evaluate without compiling)

Motivated by Bahr & Hutton's "Calculating Correct Compilers" — the correctness equation `exec(comp(x), s) = eval(x) : s` requires both a compiler and an evaluator.

## Value Type

```typescript
class Num extends Schema.TaggedClass<Num>()("Num", { value: Schema.Number }) {}
class Str extends Schema.TaggedClass<Str>()("Str", { value: Schema.String }) {}
class Bool extends Schema.TaggedClass<Bool>()("Bool", { value: Schema.Boolean }) {}
class Unit extends Schema.TaggedClass<Unit>()("Unit", {}) {}
class Closure extends Schema.TaggedClass<Closure>()("Closure", {
  params: Schema.Array(Schema.String),
  body: Schema.suspend(() => ExprSchema),    // Ast.Expr
  env: Schema.Any,                            // Env (HashMap)
}) {}

type Value = Num | Str | Bool | Unit | Closure
```

Schema.TaggedClass gives free equality for comparing interpreter output with compiled output.

## Environment

```typescript
type Env = HashMap<string, Value>
```

Immutable HashMap from Effect. Child scopes created by `HashMap.set` — parent bindings remain accessible.

## Core Function

```typescript
eval: (expr: Ast.Expr, env: Env) => Effect<Value, EvalError>
```

Returns Effect because:
- Undefined variable → EvalError
- Type mismatch (adding string to number) → EvalError
- Division by zero → EvalError

## Evaluation Rules

| Node | Rule |
|------|------|
| `IntLiteral(n)` | `Num(n)` |
| `FloatLiteral(n)` | `Num(n)` |
| `StringLiteral(s)` | `Str(s)` |
| `BoolLiteral(b)` | `Bool(b)` |
| `UnitLiteral` | `Unit` |
| `Ident(name)` | Lookup name in env. Missing → EvalError |
| `BinaryExpr(op, l, r)` | Eval both sides, apply operator. Type mismatch → EvalError |
| `UnaryExpr("-", e)` | Eval e, negate. Non-Num → EvalError |
| `UnaryExpr("not", e)` | Eval e, logical not. Non-Bool → EvalError |
| `Block(stmts, expr)` | Eval statements in child env, return eval of final expr |
| `Lambda(params, body)` | `Closure(params, body, currentEnv)` — captures env |
| `App(func, args)` | Eval func to Closure, apply args (curried, see below) |
| `Force(expr)` | Eval expr — in pure context, just evaluates |
| `StringInterp(parts)` | Eval each InterpExpr part, coerce to string, concatenate with InterpText parts |
| `DotAccess(obj, field)` | Resolve dotted name for declared function lookup |

### Statement evaluation

Statements modify the environment:

| Statement | Rule |
|-----------|------|
| `Declaration(name, value)` | Eval value, bind name in env, return updated env |
| `Declare(name, type)` | No-op — declared functions can't be evaluated |
| `ForceStatement(expr)` | Eval the Force expression, discard value |
| `ExprStatement(expr)` | Eval expression, discard value |

### Curried application

Lambdas are curried: `a b -> { a + b }` means params = ["a", "b"].

Application with `App(func, [arg1, arg2])`:
1. Eval `func` → `Closure(["a", "b"], body, closureEnv)`
2. Eval `arg1` → `v1`
3. If args.length < params.length: return `Closure(remainingParams, body, extendedEnv)` (partial application)
4. If args.length == params.length: bind all args to params in closureEnv, eval body
5. If args.length > params.length: apply first N args, then apply remaining to the result (over-application)

For v1, handle exact match and partial application. Over-application can be deferred.

### Operator semantics

Arithmetic (`+`, `-`, `*`, `/`, `%`): Both operands must be Num. Result is Num.
String concat (`++`): Both operands must be Str. Result is Str.
Comparison (`==`, `!=`, `<`, `>`, `<=`, `>=`): Both operands same type. Result is Bool.
Logical (`and`, `or`, `xor`): Both operands must be Bool. Result is Bool.

## Handling `declare` and Force

Declared functions (like `console.log`) have no Bang implementation. The interpreter:
- Skips `Declare` statements (no-op)
- If a Force evaluates a declared function → EvalError("Cannot evaluate external function")

The interpreter only evaluates pure Bang code. External function mocking is a future extension.

## File Structure

```
packages/core/src/
  Value.ts          — Value types (Schema.TaggedClass)
  Interpreter.ts    — eval function + evalProgram
  index.ts          — add exports
```

## Error Type

```typescript
class EvalError extends Schema.TaggedError<EvalError>()("EvalError", {
  message: Schema.String,
  span: Schema.Any,
}) {}
```

## Public API

```typescript
// Evaluate an AST program, return the last expression's value
evalProgram: (program: Ast.Program) => Effect<Value, EvalError>

// Evaluate a single expression in an environment
evalExpr: (expr: Ast.Expr, env: Env) => Effect<Value, EvalError>
```

## Testing Strategy

### Unit tests (immediate)
```typescript
// Literals
evalExpr(IntLiteral(42), emptyEnv) → Num(42)

// Arithmetic
evalExpr(BinaryExpr("+", IntLiteral(1), IntLiteral(2)), emptyEnv) → Num(3)

// Blocks
evalExpr(Block([Declaration("x", IntLiteral(1))], Ident("x")), emptyEnv) → Num(1)

// Lambdas
evalExpr(App(Lambda(["x"], BinaryExpr("*", Ident("x"), IntLiteral(2))), [IntLiteral(5)]), emptyEnv) → Num(10)

// Partial application
evalExpr(App(Lambda(["a", "b"], ...), [IntLiteral(3)]), emptyEnv) → Closure(["b"], ...)
```

### Property tests (once interpreter + compiler both work on same programs)
```typescript
// Compiler correctness: eval(ast) ≡ run(codegen(ast))
// Determinism: eval(ast) called twice gives same result
// Block optimization: eval(Block([], e)) ≡ eval(e)
```

## What This Does NOT Include

- Effect execution (no I/O)
- Effect handler semantics (.handle, .catch)
- Module system (imports/exports)
- Type checking (dynamically typed)
- Mutation (<-, Ref)
- External function mocking

These are future extensions. The v1 interpreter covers everything the v0.2 compiler handles: literals, arithmetic, comparison, logic, blocks, lambdas, application, string interpolation.
