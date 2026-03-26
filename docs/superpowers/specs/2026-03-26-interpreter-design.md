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
  body: Schema.suspend(() => ExprSchema), // Ast.Expr
  env: Schema.Any, // Env (HashMap)
}) {}

type Value = Num | Str | Bool | Unit | Closure;
```

Schema.TaggedClass gives free equality for comparing interpreter output with compiled output.

## Environment

```typescript
type Env = HashMap<string, Value>;
```

Immutable HashMap from Effect. Child scopes created by `HashMap.set` — parent bindings remain accessible.

## Core Function

```typescript
eval: (expr: Ast.Expr, env: Env) => Effect<Value, EvalError>;
```

Returns Effect because:

- Undefined variable → EvalError
- Type mismatch (adding string to number) → EvalError
- Division by zero → EvalError

## Evaluation Rules

| Node                    | Rule                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `IntLiteral(n)`         | `Num(n)`                                                                                                                                       |
| `FloatLiteral(n)`       | `Num(n)`                                                                                                                                       |
| `StringLiteral(s)`      | `Str(s)`                                                                                                                                       |
| `BoolLiteral(b)`        | `Bool(b)`                                                                                                                                      |
| `UnitLiteral`           | `Unit`                                                                                                                                         |
| `Ident(name)`           | Lookup name in env. Missing → EvalError                                                                                                        |
| `BinaryExpr(op, l, r)`  | Eval both sides, apply operator. Type mismatch → EvalError                                                                                     |
| `UnaryExpr("-", e)`     | Eval e, negate. Non-Num → EvalError                                                                                                            |
| `UnaryExpr("not", e)`   | Eval e, logical not. Non-Bool → EvalError                                                                                                      |
| `Block(stmts, expr)`    | Eval statements in child env, return eval of final expr                                                                                        |
| `Lambda(params, body)`  | `Closure(params, body, currentEnv)` — captures env                                                                                             |
| `App(func, args)`       | Eval func to Closure, apply args (curried, see below)                                                                                          |
| `Force(expr)`           | Eval expr — in pure context, just evaluates                                                                                                    |
| `StringInterp(parts)`   | Eval each InterpExpr part, coerce to string (see below), concatenate with InterpText parts                                                     |
| `DotAccess(obj, field)` | EvalError in v1 — field access on values not supported. Dotted names for declared functions also error (declared functions can't be evaluated) |

### Statement evaluation

Statements modify the environment:

| Statement                  | Rule                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Declaration(name, value)` | Eval value, bind name in env, return updated env. `mutable` flag ignored. `typeAnnotation` ignored (interpreter is dynamically typed). |
| `Declare(name, type)`      | No-op — declared functions can't be evaluated                                                                                          |
| `ForceStatement(expr)`     | Eval the Force expression, discard value                                                                                               |
| `ExprStatement(expr)`      | Eval expression, discard value                                                                                                         |

### Program evaluation

`evalProgram(program)`:

1. Start with empty env
2. Eval each statement sequentially, threading the env
3. Return value of the last statement. If the last statement is a Declaration → return its value. If ForceStatement/ExprStatement → return the evaluated expression. If Declare → return Unit.
4. Empty program (no statements) → return Unit.

### Curried application

Lambdas are curried: `a b -> { a + b }` means params = ["a", "b"].

Application with `App(func, [arg1, arg2])`:

1. Eval `func` → `Closure(["a", "b"], body, closureEnv)`
2. Eval `arg1` → `v1`
3. If args.length < params.length: return `Closure(remainingParams, body, extendedEnv)` (partial application)
4. If args.length == params.length: bind all args to params in closureEnv, eval body
5. If args.length > params.length: apply first N args, then apply remaining to the result (over-application)

For v1, handle exact match and partial application. Over-application can be deferred.

### Zero-param lambdas

`Lambda([], body)` evaluates to `Closure([], body, env)`. Applying with `App(closure, [])` evaluates the body immediately — making zero-arg lambdas a thunk mechanism.

### Operator semantics

Arithmetic (`+`, `-`, `*`, `/`, `%`): Both operands must be Num. Result is Num. Division/modulo by zero → EvalError.
String concat (`++`): Both operands must be Str. Result is Str.
Comparison (`==`, `!=`, `<`, `>`, `<=`, `>=`): Both operands same type. Result is Bool.
Logical (`and`, `or`, `xor`): Both operands must be Bool. Result is Bool.

### String coercion (for interpolation)

When a value appears inside `${}` in a StringInterp, coerce to string:

| Value          | Coercion                                         |
| -------------- | ------------------------------------------------ |
| `Num(n)`       | `String(n)` — e.g., `"42"`, `"3.14"`             |
| `Str(s)`       | `s` (identity)                                   |
| `Bool(b)`      | `"true"` or `"false"`                            |
| `Unit`         | `"()"`                                           |
| `Closure(...)` | EvalError — closures cannot be coerced to string |

### Integer vs Float

Both `IntLiteral` and `FloatLiteral` map to `Num(number)`. The distinction is collapsed — JavaScript has no integer type. If the language ever needs integer semantics, this will need revision.

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
evalProgram: (program: Ast.Program) => Effect<Value, EvalError>;

// Evaluate a single expression in an environment
evalExpr: (expr: Ast.Expr, env: Env) => Effect<Value, EvalError>;
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

### Correctness comparison mechanism

The interpreter produces `Value` (Num, Str, Bool, Unit, Closure). The compiled JS produces JS values. To compare them, we extract the interpreter's Value to a JS primitive:

```typescript
toJS: (value: Value) => unknown
toJS(Num(n)) = n           // number
toJS(Str(s)) = s           // string
toJS(Bool(b)) = b          // boolean
toJS(Unit) = undefined     // undefined
toJS(Closure(...)) = ???   // closures can't be compared across representations
```

For the correctness property test, we only test programs that produce non-closure values (Num, Str, Bool, Unit). Closure-producing programs are tested separately via application (apply closure, check the result is a primitive).

Note: Closure equality is NOT supported. Two closures capturing the same environment are not structurally comparable because the env HashMap and body AST are complex objects. Schema equality on `Closure` with `Schema.Any` for env will not work. This is acceptable — closures are tested by their behavior (apply and check result), not by identity.

### Property tests (once interpreter + compiler both work on same programs)

```typescript
// Compiler correctness (pure programs only):
// toJS(eval(ast)) === evalJS(codegen(ast))

// Determinism: eval(ast) called twice gives same result
// Block optimization: eval(Block([], e)) ≡ eval(e)
// Lambda: eval(App(Lambda([x], body), [v])) ≡ eval(body, env + {x: v})
```

## What This Does NOT Include

- Effect execution (no I/O)
- Effect handler semantics (.handle, .catch)
- Module system (imports/exports)
- Type checking (dynamically typed)
- Mutation (<-, Ref)
- External function mocking

These are future extensions. The v1 interpreter covers everything the v0.2 compiler handles: literals, arithmetic, comparison, logic, blocks, lambdas, application, string interpolation.
