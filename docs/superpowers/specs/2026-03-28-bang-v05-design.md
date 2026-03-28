# Bang v0.5 Design Spec

## Axiom

Every construct is a description. `!` is the only way to make descriptions real. `!` flatmaps — one `!` unwraps to the value regardless of nesting depth. No exceptions.

## Scope

Seven waves, ordered by dependency:

1. **v0.5 alignment** — collapse Mutation into Force, blocks are thunks, `!match`
2. **Dot methods + effect handling** — `.handle`/`.catch`/`.map`/`.tap`, match-as-pipe
3. **`use`** — resource declaration qualifier
4. **`on`** — push subscriptions with cycle detection
5. **Nested patterns + guards** — recursive patterns, `if` guards
6. **Newtype + record types** — `type` = nominal, bare `=` = structural
7. **`comptime`** — compile-time expression, interpreter as evaluator

## Unification: match, catch, handle

Match, catch, and handle are the same primitive — inspect a tagged value, dispatch by tag, run the matched arm. They differ only in which channel they operate on:

| Method | Channel | Dispatches on |
|--------|---------|---------------|
| `.match` | A (success) | Value tags |
| `.catch` | E (error) | Error tags |
| `.handle` | R (dependency) | Effect interface types |

`match expr { arms }` is syntactic sugar for `expr.match { arms }`. The keyword form exists for readability. The dot-method form is the primitive.

```bang
!expr
  .match { Some v -> v, None -> 0 }     -- dispatch on A
  .catch { NotFound _ -> default }       -- dispatch on E
  .handle { Database -> pgDb }           -- dispatch on R
```

## Wave 1: v0.5 Alignment

### Mutation collapses into Force

Remove `Mutation` as a statement type. `!x <- 5` parses as `ForceStatement(BinaryExpr("<-", ...))`.

**Parser:** Remove `parseMutation`. Put `<-` back in Pratt parser as binary operator (precedence PREC_MUT=1, right-associative). Remove `mut` detection for `<-` in `parseStatement`/`parseBlockItem`.

**Interpreter:** Move mutation logic from `evalStmt` Mutation handler to `evalExpr` BinaryExpr handler for `<-` operator:
```
BinaryExpr("<-", target, value):
  - Do NOT evaluate left operand through evalExpr (it would unwrap MutCell)
  - Extract the Ident name from left AST node directly
  - Look up the raw MutCell in env by name
  - Verify it's a MutCell (fail if not)
  - Evaluate the right operand (value) normally
  - Mutate the cell: cell.ref.value = newValue
  - Return the new value
```

**Critical:** The current Ident handler auto-unwraps MutCells (`v._tag === "MutCell" ? v.ref.value : v`). The `<-` operator must bypass this by reading the env entry directly, not calling `evalExpr` on the left side. Left operand must be an Ident (or DotAccess for future field mutation).

**Checker/Codegen/Formatter:** Remove Mutation handlers. `<-` is handled through BinaryExpr codegen path.

**AST:** Remove `Mutation` from Stmt union and StmtSchema. `<-` is purely an expression operator.

**Tests:** Update all mutation tests: `x <- 5` → `!x <- 5`. The `!` is now required.

### Blocks are thunks

Blocks `{ stmt; expr }` are descriptions. `!` forces them. `!` flatmaps — `!{ { { 42 } } }` produces `42`, not nested Effects.

**Interpreter:** No change needed — `evalExpr` for Block already evaluates eagerly. The interpreter is eagerly evaluated by nature. The thunk/description distinction is a type-system and codegen concern.

**Codegen:** Blocks already compile to `Effect.gen(function*() { ... })`. No change.

**Type system implication (future):** Block type is `Effect A E R` where A, E, R are inferred from contents.

### Match requires `!`

Match is a thunk — it describes "a choice that, when forced, inspects a value and runs the selected arm." Match has its own effect scope: all arms contribute to E and R regardless of which fires at runtime.

**Parser:** No change — `match` is already an expression. It's used as `!match x { ... }` at statement level via ForceStatement.

**Interpreter:** No change — `evalExpr` for MatchExpr already evaluates eagerly.

**Tests:** Update match tests at statement level to use `!match`. Match in expression position (e.g., RHS of declaration) stays as-is since the declaration captures the thunk.

### Grammar updates

```ebnf
Statement   = Declaration
            | Force                 (* covers all effects *)
            | Import
            | Export
            | EscapeBlock
            ;

Declaration = 'mut' Ident '=' Expr
            | 'use' Ident '=' Expr
            | Ident '=' Expr
            | Ident ':' Type
            | 'type' TypeIdent TypeVar* '=' TypeBody
            | 'declare' QualifiedIdent ':' Type
            ;
```

No `Mutation` statement. No `comptime` declaration. `<-` is an expression operator. `comptime` is an expression.

### Keyword updates

Add `comptime` to keyword set. Remove stale entries if any remain.

```
mut         type        declare
from        import      export
match       not         and
or          xor         if
true        false       on
use         comptime    transaction
gen
```

## Wave 2: Dot Methods + Effect Handling

### No new AST nodes

`.handle Console impl` parses as existing `DotAccess` + `App`:
```
App(DotAccess(expr, "handle"), [Ident("Console"), Ident("impl")])
```

`.map f` parses as:
```
App(DotAccess(expr, "map"), [f])
```

The parser already handles this. No changes needed.

### Match as pipe (sugar)

`match expr { arms }` desugars to `expr.match { arms }`.

The keyword form is sugar for readability. Both forms are valid. The parser handles the keyword form directly (already implemented). The dot-method form parses through existing DotAccess + App.

The braced handler body `{ Tag -> expr, Tag2 -> expr2 }` reuses match arm parsing — same syntax, different channel semantics determined by the method name.

### Interpreter — effect handler stack

The interpreter needs a real effect system to handle `.handle` and `.catch`:

**Handler stack:** A stack of handler maps, scoped to blocks. When `!expr.handle Console impl` is forced:
1. Push `{ Console: impl }` onto the handler stack
2. Evaluate `expr` in the context with this handler available
3. When `!Console.log msg` is encountered during evaluation, look up `Console` in the handler stack, find `impl`, call `impl.log(msg)`
4. Pop the handler on scope exit

**Catch stack:** Same pattern for `.catch`. When an error of a matching type propagates, the catch handler intercepts and recovers.

**`.map f`:** Apply `f` to the result value. Pure transformation.

**`.tap f`:** Apply `f` for side effect, return original value.

### Codegen

Based on method name, generate Effect TS:

| Bang | Effect TS |
|------|-----------|
| `expr.handle Console impl` | `pipe(expr, Effect.provide(Layer.succeed(Console, impl)))` |
| `expr.catch NotFound f` | `pipe(expr, Effect.catchTag("NotFound", f))` |
| `expr.map f` | `pipe(expr, Effect.map(f))` |
| `expr.tap f` | `pipe(expr, Effect.tap(f))` |
| `expr.match { arms }` | `pipe(expr, Match.value(...).pipe(Match.tag(...), ...))` |

### Braced multi-handler (deferred)

`.handle { A -> x, B -> y }` desugars to `.handle A x .handle B y`. Deferred — single-handler form is sufficient for v0.5.

## Wave 3: `use` (Resource Binding)

### Binding form within blocks

`use` is a binding form that declares a resource-managed name. Syntactically it appears in the expression grammar (`use Ident = Expr`), but semantically it restructures the enclosing block — everything after the `use` becomes the resource's callback body. It is parallel to `mut` in that it qualifies a binding, but it is NOT a simple declaration — it transforms the block's continuation.

```bang
use conn = withDb        -- description: resource binding
!use conn = withDb       -- forced: acquires resource
```

`mut` and `use` are mutually exclusive. A resource handle cannot be mutated.

**AST node:** `UseExpr extends Schema.TaggedClass("UseExpr", { name: Schema.String, value: ExprSchema, span: Span })`. Added to the Expr union and ExprSchema.

### Interpreter semantics

- `use x = f` in a block: evaluate `f` to get a resource provider
- The resource provider has a protocol: it takes a callback and manages acquire/cleanup
- When the block is forced, acquisition happens. Cleanup registers in LIFO stack.
- Block exit (normal or error) triggers all registered cleanups

**Cleanup stack:** Per-block scope, list of cleanup thunks. Pushed on `!use`, popped (and executed) on block exit.

### Codegen

```typescript
// !use conn = withDb;
// rest...
yield* withDb((conn) => Effect.gen(function* () {
    // rest...
}))
```

The compiler restructures: everything after `!use x = f;` in the block becomes the callback body.

### Dependencies

`use conn = withDb` adds `withDb`'s resource type to the enclosing scope's R channel. Dependencies hoist to the scope's requirement channel.

## Wave 4: `on` (Push Subscriptions)

### AST node

`OnExpr extends Schema.TaggedClass("OnExpr", { source: ExprSchema, handler: ExprSchema, span: Span })`. Added to the Expr union and ExprSchema. `on` is a keyword, so it gets its own node (not parsed as function application).

### Expression form

`on` produces a thunk. `!` forces it (starts the subscription):

```bang
handler = on count (c) -> { !log c }    -- thunk
sub = !handler                           -- subscription active
!sub.abort                               -- unsubscribe
```

### Interpreter semantics

- `on source handler` creates a subscription description
- `!on source handler` activates it: registers `handler` on the `source` MutCell's subscriber list
- When `!source <- newValue` mutates a MutCell, the interpreter fires all registered handlers with the new value
- Returns a Subscription value: `{ abort: Effect Unit {} {} }`

**MutCell subscriber list:** Extend the existing mutable-object-behind-readonly-reference pattern: `MutCell.ref` becomes `{ value: Value; subscribers: Array<Handler> }`. This matches the existing `ref: { value: Value }` pattern — the outer reference is readonly per TaggedEnum, but the inner object is mutable. On mutation, iterate and fire each subscriber.

### Cycle detection (checker)

Post-pass after scope validation:
1. Walk all `on source handler` expressions
2. For each handler body, find all `<-` targets (mutation expressions)
3. Resolve source and targets to `mut` bindings
4. Build directed graph: source → each target
5. DFS cycle detection
6. Report error with the cycle path

### Codegen

```typescript
// !on count handler
yield* subscribeToRef(count, handler)
```

## Wave 5: Nested Patterns + Guards

### Nested patterns

```bang
!match result {
  Ok (Some value) -> value,
  Ok None -> defaultValue,
  Err e -> !handleError e
}
```

**Parser:** Add `(Pattern)` grouping to `parsePattern`. When pattern parser sees `(`, parse inner pattern and expect `)`.

**Interpreter:** `matchPattern` already recurses on `ConstructorPattern.patterns`. Nesting should work with the parser fix.

**Codegen:** Nested destructuring in `Match.tag`:
```typescript
Match.tag("Ok", ({ _0 }) =>
  Match.value(_0).pipe(
    Match.tag("Some", ({ _0: value }) => value),
    Match.tag("None", () => defaultValue),
    Match.exhaustive
  )
)
```

### Guards

```bang
!match x {
  n if n > 0 -> "positive",
  n if n < 0 -> "negative",
  _ -> "zero"
}
```

**AST:** Add `guard: Schema.OptionFromUndefinedOr(Schema.suspend(() => ExprSchema))` field to `Arm`.

**Parser:** After parsing pattern, check for `if` keyword. If present, parse guard expression.

**Interpreter:** Match pattern first. If pattern matches, evaluate guard expression in the extended environment (with pattern bindings). If guard is false, try next arm.

**Codegen:** `Match.when` with compound predicate:
```typescript
Match.when(
  (n) => n > 0,
  (n) => "positive"
)
```

## Wave 6: Newtype + Record Types

### `type` = nominal, always

`type` keyword creates a nominal type. Plain `=` binding creates a structural alias:

```bang
type UserId = String           -- nominal: UserId ≠ String
type User = { name: String }   -- nominal record

Alias = String                 -- structural: Alias === String
Pair = { a: Int, b: Int }     -- structural alias
```

No parser disambiguation needed. The presence of `type` is the signal.

### Newtype

```bang
type UserId = String
```

**Parser:** After `type Name =`, if next token is a Type (not a TypeIdent starting a constructor, not `{` starting a record, not `|`), it's a newtype. Disambiguation:
- TypeIdent followed by `|` or another TypeIdent → ADT constructor
- TypeIdent alone at end of declaration → could be newtype OR single nullary constructor. Resolve: single TypeIdent after `=` is newtype wrapping that type.
- `{` with `Ident :` inside → record type

**Interpreter:** `UserId "abc"` wraps. Register `UserId` as a constructor function (arity 1) that produces `Tagged({ tag: "UserId", fields: [value] })`. `UserId.unwrap x` unwraps — `DotAccess` with field "unwrap" on a Tagged value returns the inner value.

**Codegen:**
```typescript
class UserId extends Schema.Class<UserId>("UserId")({
  value: Schema.String
}) {}
```

### Record type

```bang
type User = {
  name : String,
  age : Int
}
```

**Parser:** After `type Name =`, if `{` with `Ident : Type` fields → record type. Distinguished from a block by the presence of type annotations on fields.

**Interpreter:** `User { name: "alice", age: 30 }` constructs. Register `User` as a constructor that takes a record argument and produces `Tagged({ tag: "User", fields: { name: "alice", age: 30 } })`. Field access via DotAccess: `user.name` extracts the field.

**Codegen:**
```typescript
class User extends Schema.Class<User>("User")({
  name: Schema.String,
  age: Schema.Int
}) {}
```

## Wave 7: `comptime`

### Expression form

`comptime` wraps an expression, marking it for compile-time evaluation:

```bang
table = comptime { buildSineTable () }  -- thunk
result = !table                          -- compiler evaluates via interpreter

!comptime { inlineConstant () }          -- immediate compile-time force
```

### Grammar

```ebnf
Expr = ... | 'comptime' Expr | ...
```

### Interpreter

`comptime { expr }` evaluates identically to `{ expr }`. The interpreter doesn't distinguish compile-time from runtime — it evaluates everything eagerly. The `comptime` annotation is a hint to the compiler.

### Compiler

When the codegen encounters `comptime expr`:
1. Call `Interpreter.evalExpr(expr, env)` at compile time
2. Convert the resulting `Value` to an AST literal (Num → IntLiteral, Str → StringLiteral, etc.)
3. Substitute the literal in the generated output

For complex values (Tagged, records), serialize to the appropriate `Data.tagged(...)({...})` call.

### Lint rule

`comptime { expr }` that is never forced (no `!` reaches it) is unreachable. Lint warning: "comptime expression result unused — expression will be tree-shaken."

## Implementation Order

Each wave follows the pipeline:
```
AST changes → Lexer → Parser → Interpreter (ground truth)
  → Tests → Checker → Codegen → Formatter
  → Property test: eval(ast) ≡ run(codegen(ast))
```

**The interpreter is the spec.** Implement semantics there first. If it works in the interpreter, translate to codegen. If the compiler disagrees with the interpreter, the compiler is wrong.

Wave dependencies:
- Wave 1 (alignment) must go first
- Waves 2-4 depend on wave 1
- Wave 2 (.handle) uses effect interfaces which are record types — Wave 2 initially works with simplified record-as-constructor patterns (positional fields). Full named-field record types (Wave 6) enhance this later.
- Waves 5-6 are independent of 2-4 (can be parallelized)
- Wave 7 depends on wave 1

**Note:** `gen` (EscapeBlock) is already in the grammar and keyword list. It is not implemented in the current codebase. It's a simple passthrough (raw Effect TS block). Can be added in any wave or deferred.

## Deferrals (v0.6+)

- Braced multi-handler sugar: `.handle { A -> x, B -> y }`
- Exhaustiveness checking for match in checker
- HM type inference
- Effect row inference and checking
- Trait system (Equal, Ord, Show, etc.)
- Signal vs Effect classification in type system
