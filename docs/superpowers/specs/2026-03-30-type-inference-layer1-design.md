# Layer 1: HM Type Inference — Design Spec

## Overview

Replace the existing checker with a Hindley-Milner type inference engine. Lives in `@bang/core` (static semantics alongside runtime semantics). Infers types for all pure expressions. No effect rows yet. Produces `TypedAST` with real inferred types.

## Scope

### Infers

- Literals: `42 : Int`, `"hi" : String`, `true : Bool`, `() : Unit`, `3.14 : Float`
- Bindings: `x = 42` → `x : Int`
- Functions: `(x) -> { x + 1 }` → `Int -> Int`
- Application: `f 42` unifies `f` with `? -> ?`, arg with `Int`
- Let-polymorphism: `id = (x) -> { x }` → `forall a. a -> a`, usable at multiple types
- ADT constructors: `Some : forall a. a -> Maybe a`, `None : forall a. Maybe a`
- Newtype constructors: `UserId : String -> UserId`
- Match: all arms unify to same return type
- Binary/unary operators: typed (`+ : Int -> Int -> Int`, `++ : String -> String -> String`, `== : a -> a -> Bool`)
- Blocks: type is the type of the return expression
- Dot access on records: `user.name : String` when `user : User`

### Excludes (Layer 2+)

- Effect rows, `Effect A E R`
- Trait constraints `<a : Numeric>`
- Exhaustiveness checking
- Signal vs Effect classification
- `use`, `on`, `comptime`, `transaction` type semantics (inferred as `Unknown` for now)

## Architecture

### Where it lives

`@bang/core` — the type system is static semantics, alongside the interpreter (runtime semantics). The compiler depends on core, so `@bang/compiler` can consume the typed output. No dependency cycles.

### Pipeline integration

```
Lexer → Parser → TypeChecker → Codegen
```

The new type checker replaces the existing `Checker.ts` in `@bang/compiler`. It:
1. Resolves names (subsumes scope validation)
2. Infers types via HM
3. Produces `TypedAST` with real inferred types
4. `on` cycle detection becomes a separate lint pass or moves into the new checker

The existing `Checker.ts` is removed. `TypedAst.ts` in `@bang/compiler` gets updated — `TypeAnnotation` carries `InferType` instead of `Ast.Type | Unknown`.

## Internal Type Representation

New file `packages/core/src/InferType.ts`:

```typescript
type InferType =
  | TVar    { id: number }                             // unification variable ?0, ?1
  | TCon    { name: string }                           // Int, String, Bool, Unit, Float
  | TArrow  { param: InferType, result: InferType }    // a -> b
  | TApp    { constructor: InferType, arg: InferType }  // Maybe a, List a
```

`Schema.TaggedClass` for each, following the codebase pattern. `Match.exhaustive` for dispatch.

Separate from `Ast.Type` (parser output). Conversion functions bridge the two:
- `astTypeToInfer(astType: Ast.Type) : InferType` — convert user-written type annotations to inference types
- `inferTypeToAst(inferType: InferType) : Ast.Type` — convert inferred types back to AST types (for TypedAST output)

## Substitution + Unification

New file `packages/core/src/Unify.ts`:

- `Substitution = HashMap<number, InferType>` — maps type variable IDs to their resolved types
- `apply(subst, type) : InferType` — apply substitution recursively, chasing variable chains
- `unify(t1, t2, subst, span) : Effect<Substitution, TypeError>` — unify two types, extending the substitution
- Occurs check: `?a` can't unify with a type containing `?a` (prevents infinite types)

### Unification rules

| t1 | t2 | Result |
|----|----|--------|
| `TVar ?a` | any `t` | Extend subst: `?a → t` (after occurs check) |
| any `t` | `TVar ?a` | Extend subst: `?a → t` (after occurs check) |
| `TCon "Int"` | `TCon "Int"` | Success (same name) |
| `TCon "Int"` | `TCon "String"` | UnificationError |
| `TArrow(a1, r1)` | `TArrow(a2, r2)` | Unify `a1` with `a2`, then `r1` with `r2` |
| `TApp(c1, a1)` | `TApp(c2, a2)` | Unify `c1` with `c2`, then `a1` with `a2` |

## Inference Engine

New file `packages/core/src/Infer.ts`:

### Type environment

```typescript
interface Scheme {
  readonly vars: ReadonlyArray<number>;  // bound type variables (forall)
  readonly type: InferType;
}

type TypeEnv = HashMap<string, Scheme>;
```

Monomorphic types have empty `vars`. Polymorphic types (from let-bindings) have non-empty `vars`.

### Fresh variable generation

Counter-based: `freshTVar()` returns `TVar({ id: nextId++ })`. Thread through inference as part of state, or use a mutable counter (pragmatic, per the codebase's style rules for internal state).

### Core inference rules

All rules thread a substitution `S` through. Each rule takes `(env, S)` and returns `(type, S')` where `S'` extends `S`. The substitution is applied to the environment before each lookup.

**Literal:**
```
infer(IntLiteral, env, S)    = (TCon("Int"), S)
infer(FloatLiteral, env, S)  = (TCon("Float"), S)
infer(StringLiteral, env, S) = (TCon("String"), S)
infer(BoolLiteral, env, S)   = (TCon("Bool"), S)
infer(UnitLiteral, env, S)   = (TCon("Unit"), S)
```

**Ident:**
```
infer(Ident(x), env, S):
  scheme = lookup(x, env) or fail UndefinedVariable
  return (instantiate(scheme), S)
```
Instantiate replaces each bound variable in the scheme with a fresh type variable.

**Lambda (multi-param → curried):**
```
infer(Lambda(params, body), env, S):
  // params is an array; build curried TArrow
  freshParams = params.map(_ => freshTVar())
  extendedEnv = env + { params[i]: Scheme([], freshParams[i]) for each i }
  (bodyType, S1) = infer(body, extendedEnv, S)
  // Build curried arrow right-to-left: p1 -> p2 -> ... -> bodyType
  resultType = bodyType
  for i = params.length - 1 downto 0:
    resultType = TArrow(apply(S1, freshParams[i]), resultType)
  return (resultType, S1)
```

**Application (correct substitution threading):**
```
infer(App(func, args), env, S):
  (funcType, S1) = infer(func, env, S)
  currentSubst = S1
  currentFuncType = apply(S1, funcType)
  for each arg in args:
    (argType, S2) = infer(arg, env, currentSubst)
    freshResult = freshTVar()
    S3 = unify(apply(S2, currentFuncType), TArrow(argType, freshResult), S2)
    currentFuncType = apply(S3, freshResult)
    currentSubst = S3
  return (apply(currentSubst, currentFuncType), currentSubst)
```

**Declaration (let-binding with optional type annotation):**
```
infer(Declaration(name, value, typeAnnotation?), env, S):
  (valueType, S1) = infer(value, env, S)
  // If type annotation exists, unify with inferred type
  if typeAnnotation is Some(ann):
    annType = astTypeToInfer(ann)
    S2 = unify(apply(S1, valueType), annType, S1)
  else:
    S2 = S1
  scheme = generalize(env, apply(S2, valueType))
  return (env + { name: scheme }, S2)
```

Generalize: find type variables in the inferred type that are NOT free in the environment. These become the `forall` variables.

**Declare (foreign type assertion):**
```
inferStmt(Declare(name, typeAnnotation), env, S):
  inferType = astTypeToInfer(typeAnnotation)
  scheme = Scheme(freeVars(inferType), inferType)
  return (env + { name: scheme }, S)
```

**ForceStatement:**
```
inferStmt(ForceStatement(expr), env, S):
  // Infer the expression (for type checking), discard the type
  // Special case: Force(UseExpr(name, value)) → bind name in env
  if expr is Force(UseExpr(name, value)):
    (valueType, S1) = infer(value, env, S)
    return (env + { name: Scheme([], apply(S1, valueType)) }, S1)
  (_, S1) = infer(expr, env, S)
  return (env, S1)
```

**ExprStatement:**
```
inferStmt(ExprStatement(expr), env, S):
  (_, S1) = infer(expr, env, S)
  return (env, S1)
```

**Import:**
```
inferStmt(Import(path, names), env, S):
  // For Layer 1: introduce names as Unknown (no cross-module type resolution)
  extendedEnv = env + { name: Scheme([], freshTVar()) for each name in names }
  return (extendedEnv, S)
```

**Export:**
```
inferStmt(Export(names), env, S):
  // Validate names exist in env, otherwise pass through
  return (env, S)
```

**TypeDecl (ADT constructors):**
```
inferStmt(TypeDecl(name, typeParams, constructors), env, S):
  // Create type variables for each type parameter
  paramVars = typeParams.map(_ => freshTVar())
  // The result type is TApp(TCon(name), paramVars...)
  resultType = foldl(TApp, TCon(name), paramVars)

  extendedEnv = env
  for each constructor:
    if NullaryConstructor(tag):
      // tag : forall params. ResultType
      scheme = Scheme(paramVars.ids, resultType)
      extendedEnv = extendedEnv + { tag: scheme }
    if PositionalConstructor(tag, fields):
      // tag : forall params. field1 -> field2 -> ... -> ResultType
      fieldTypes = fields.map(f => astTypeToInfer(f))
      ctorType = foldr(TArrow, resultType, fieldTypes)
      scheme = Scheme(paramVars.ids, ctorType)
      extendedEnv = extendedEnv + { tag: scheme }
    if NamedConstructor(tag, fields):
      // Same as positional, but fields are named (names stored for record access)
      fieldTypes = fields.map(f => astTypeToInfer(f.type))
      ctorType = foldr(TArrow, resultType, fieldTypes)
      scheme = Scheme(paramVars.ids, ctorType)
      extendedEnv = extendedEnv + { tag: scheme }
  return (extendedEnv, S)
```

**NewtypeDecl:**
```
inferStmt(NewtypeDecl(name, wrappedType), env, S):
  wType = astTypeToInfer(wrappedType)
  ctorType = TArrow(wType, TCon(name))
  scheme = Scheme(freeVars(ctorType), ctorType)
  return (env + { name: scheme }, S)
```

**RecordTypeDecl:**
```
inferStmt(RecordTypeDecl(name, fields), env, S):
  fieldTypes = fields.map(f => astTypeToInfer(f.type))
  ctorType = foldr(TArrow, TCon(name), fieldTypes)
  scheme = Scheme(freeVars(ctorType), ctorType)
  // Store field metadata for DotAccess resolution
  return (env + { name: scheme, __fields_{name}: fieldNames }, S)
```

**Match (correct substitution threading):**
```
infer(MatchExpr(scrutinee, arms), env, S):
  (scrutType, S1) = infer(scrutinee, env, S)
  resultType = freshTVar()
  currentSubst = S1
  for each arm:
    (patType, patBindings) = inferPattern(arm.pattern)
    S2 = unify(apply(currentSubst, scrutType), patType, currentSubst)
    // If guard present, infer guard in env + pattern bindings, unify with Bool
    if arm.guard is Some(guardExpr):
      (guardType, S2a) = infer(guardExpr, env + patBindings, S2)
      S2 = unify(guardType, TCon("Bool"), S2a)
    (bodyType, S3) = infer(arm.body, env + patBindings, S2)
    S4 = unify(apply(S3, resultType), bodyType, S3)
    currentSubst = S4
  return (apply(currentSubst, resultType), currentSubst)
```

**BinaryExpr:**
```
Arithmetic operators are polymorphic over numeric types:
  + - * / % : Num -> Num -> Num  (where Num is a fresh TVar unified with operands)

Implementation: for arithmetic ops, infer both operands, unify them with each
other (must be same type), verify the unified type is Int or Float.
For Layer 1 (no trait system), accept both Int and Float:
  (leftType, S1) = infer(left, env, S)
  (rightType, S2) = infer(right, env, S1)
  S3 = unify(leftType, rightType, S2)  // operands must match
  return (apply(S3, leftType), S3)     // result is same numeric type

Other operators:
  ++ : String -> String -> String
  == != < > <= >= : a -> a -> Bool  (polymorphic, operands must match)
  and or xor : Bool -> Bool -> Bool
  <- : deferred to Layer 2 (infer both sides, return right-side type)
```

**UnaryExpr:**
```
infer(UnaryExpr("-", expr), env, S):
  (exprType, S1) = infer(expr, env, S)
  // exprType must be Int or Float — for Layer 1, just infer and return same type
  return (exprType, S1)

infer(UnaryExpr("not", expr), env, S):
  (exprType, S1) = infer(expr, env, S)
  S2 = unify(exprType, TCon("Bool"), S1)
  return (TCon("Bool"), S2)
```

**StringInterp:**
```
infer(StringInterp(parts), env, S):
  currentSubst = S
  for each part:
    if InterpExpr(expr):
      (_, S1) = infer(expr, env, currentSubst)  // infer for side effects / errors
      currentSubst = S1
  return (TCon("String"), currentSubst)
```

**Block (threads substitution through statements):**
```
infer(Block(stmts, returnExpr), env, S):
  extendedEnv = env
  currentSubst = S
  for each stmt:
    (extendedEnv, S1) = inferStmt(stmt, extendedEnv, currentSubst)
    currentSubst = S1
  (returnType, S2) = infer(returnExpr, extendedEnv, currentSubst)
  return (returnType, S2)
```

**DotAccess:**
```
infer(DotAccess(expr, field), env, S):
  (exprType, S1) = infer(expr, env, S)
  resolvedType = apply(S1, exprType)
  // Record field access: if resolvedType is TCon(typeName) and __fields_{typeName} exists
  if resolvedType is TCon(name) and env has __fields_{name}:
    fieldIdx = indexOf(field, fieldNames)
    if fieldIdx >= 0: return (fieldType at fieldIdx, S1)
  // Newtype .unwrap
  if field == "unwrap" and resolvedType is TCon(name) with newtype scheme:
    return (wrappedType, S1)
  // Dot methods (.map, .handle, .catch, .tap): Layer 1 returns freshTVar
  // These will be properly typed in Layer 2 with effect rows
  if field in ["map", "tap", "handle", "catch", "match", "abort"]:
    return (freshTVar(), S1)
  fail UnknownField(resolvedType, field, span)
```

**Force:**
```
infer(Force(expr), env, S):
  return infer(expr, env, S)  // Layer 1: Force is identity on types. Layer 2 adds Effect unwrapping.
```

**ComptimeExpr:**
```
infer(ComptimeExpr(expr), env, S):
  return infer(expr, env, S)  // Comptime is transparent to types
```

**UseExpr:**
```
infer(UseExpr(name, value), env, S):
  (valueType, S1) = infer(value, env, S)
  return (valueType, S1)  // Binding happens in ForceStatement handler
```

**OnExpr:**
```
infer(OnExpr(source, handler), env, S):
  (sourceType, S1) = infer(source, env, S)
  (handlerType, S2) = infer(handler, env, S1)
  return (TCon("Subscription"), S2)  // Returns Subscription type
```

### Pattern type inference

```
inferPattern(WildcardPattern):
  t = freshTVar()
  return (t, {})

inferPattern(BindingPattern(name)):
  t = freshTVar()
  return (t, { name: Scheme([], t) })  // SAME variable for pattern and binding

inferPattern(ConstructorPattern(tag, subPats)):
  ctorScheme = lookup(tag, env)
  ctorType = instantiate(ctorScheme)
  // ctorType is field1 -> field2 -> ... -> ResultType
  // Decompose into field types + result type
  (fieldTypes, resultType) = uncurryArrow(ctorType, subPats.length)
  bindings = {}
  for i in 0..subPats.length:
    (subPatType, subBindings) = inferPattern(subPats[i])
    unify(subPatType, fieldTypes[i])
    bindings = bindings + subBindings
  return (resultType, bindings)

inferPattern(LiteralPattern(lit)):
  return (typeOf(lit), {})
```

## Type Errors

New file `packages/core/src/TypeError.ts`:

```typescript
type TypeError =
  | UnificationError    { expected: InferType, actual: InferType, span: Span }
  | UndefinedVariable   { name: string, span: Span }
  | OccursCheck         { varId: number, type: InferType, span: Span }
  | NonFunctionApp      { actual: InferType, span: Span }
  | ArityMismatch       { expected: number, actual: number, span: Span }
  | PatternTypeMismatch { pattern: InferType, scrutinee: InferType, span: Span }
  | UnknownField        { type: InferType, field: string, span: Span }
  | DuplicateBinding    { name: string, span: Span }
```

Each is a `Schema.TaggedClass` following the codebase pattern.

Error formatter converts to human-readable strings:
- `UnificationError` → "Type mismatch: expected `Int` but got `String` at line 3, col 5"
- `OccursCheck` → "Infinite type: `?a` occurs in `?a -> Int`"
- `UndefinedVariable` → "Undefined variable: `foo` at line 2, col 1"

## Conversion Functions

### `astTypeToInfer`

Converts user-written type annotations (from parser) to inference types:
- `ConcreteType("Int")` → `TCon("Int")`
- `ConcreteType("a")` (lowercase) → `TVar(fresh)` with name tracking
- `ArrowType(param, result)` → `TArrow(convert(param), convert(result))`
- `EffectType(...)` → `TCon("Effect")` (opaque for Layer 1)

### `inferTypeToAst`

Converts inferred types back to AST types (for TypedAST output):
- `TCon("Int")` → `ConcreteType("Int")`
- `TVar(?a)` → `ConcreteType("?a")` (for display)
- `TArrow(a, b)` → `ArrowType(convert(a), convert(b))`
- `TApp(c, a)` → `ConcreteType(prettyPrint(TApp(c, a)))` (simplified for Layer 1)

## Built-in Type Environment

The initial `TypeEnv` contains:
- All operators with their types
- Constructors from `TypeDecl`, `NewtypeDecl`, `RecordTypeDecl` (populated during inference)
- `declare` bindings (from parser, converted to inference types)

## File Map

```
packages/core/src/
  InferType.ts    — TVar, TCon, TArrow, TApp (Schema.TaggedClass)
  Unify.ts        — Substitution, apply, unify, occurs check
  Infer.ts        — TypeEnv, Scheme, infer, inferStmt, inferProgram
  TypeError.ts    — structured type error variants
  TypeCheck.ts    — public API: typeCheck(program) → TypedProgram | TypeError[]

packages/core/test/
  Unify.test.ts   — unification unit tests
  Infer.test.ts   — inference unit tests
  TypeError.test.ts — error formatting tests
```

## Testing Strategy

### Unit tests for Unify.ts
- Unify `Int` with `Int` → success
- Unify `Int` with `String` → UnificationError
- Unify `?a` with `Int` → subst `?a = Int`
- Unify `?a -> ?b` with `Int -> String` → `?a = Int, ?b = String`
- Occurs check: `?a` with `?a -> Int` → OccursCheck error
- Transitive: unify `?a` with `?b`, then `?b` with `Int` → both resolve to `Int`

### Unit tests for Infer.ts
- Literal: `42 : Int`
- Variable: `x = 42; y = x` → `y : Int`
- Function: `(x) -> { x + 1 }` → `Int -> Int`
- Polymorphism: `id = (x) -> { x }; a = id 42; b = id "hi"` → `a : Int, b : String`
- Type error: `1 + "hello"` → UnificationError
- ADT: `type Maybe a = Some a | None; x = Some 42` → `x : Maybe Int`
- Match: `!match (Some 42) { Some v -> v, None -> 0 }` → `Int`
- Record access: `type User = { name: String }; u = User "alice"; x = u.name` → `String`
- Newtype: `type UserId = String; x = UserId "abc"` → `UserId`

### Property tests
- Well-typed programs (from AstGen) don't produce type errors
- Type inference is deterministic
- Inferred types agree with interpreter behavior (if interpreter produces `Num`, inferred type is `Int`)

## Migration Path

1. Build new type checker in `packages/core/src/` (new files, no changes to existing)
2. Add tests for inference
3. Update `packages/compiler/src/Compiler.ts` to use new type checker instead of old `Checker.ts`
4. Move `on` cycle detection to the new type checker or a separate pass
5. Remove old `Checker.ts` from `@bang/compiler`
6. Update `TypedAst.ts` to carry `InferType` annotations

Step 1-2 can be done without breaking anything. Step 3 is the switchover.
