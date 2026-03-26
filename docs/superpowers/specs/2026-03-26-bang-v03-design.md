# Bang v0.3 Design Spec

## Scope

Four features, each following the established pipeline (AST node → lexer → parser → interpreter → checker → codegen → formatter → property tests):

1. **Match + patterns** — `match expr { arms }` with wildcard, binding, constructor, literal patterns
2. **Type declarations** — `type X = A | B` for nominal ADTs
3. **Mut + assignment** — `mut x = expr`, `x <- expr`
4. **Import/export** — `from M import { f }`, `export { f }`

## Feature 1: Match + Patterns

### Syntax

```bang
match expr {
  Some x  -> x + 1
  None    -> 0
  42      -> "exact"
  _       -> "fallback"
}
```

### Patterns (v0.3)

| Pattern     | Syntax                  | Matches                          |
| ----------- | ----------------------- | -------------------------------- |
| Wildcard    | `_`                     | Anything, binds nothing          |
| Binding     | `x`                     | Anything, binds to name          |
| Constructor | `Some x`, `None`        | ADT variant by tag, binds fields |
| Literal     | `42`, `"hello"`, `true` | Exact value                      |

**Disambiguation rule:** Uppercase identifiers in pattern position are constructor patterns. Lowercase identifiers are binding patterns. `_` is the wildcard. This follows the existing Ident/TypeIdent distinction in the lexer.

**Restriction:** v0.3 does not support mixed constructor + literal patterns in the same match. All arms must use the same pattern kind (all constructor, all literal, or wildcard/binding). Mixed matches are a compile error in v0.3, deferred to v0.4.

### Parsing `->` in Match Arms

After `match expr {`, the parser enters arm-parsing mode. In this context, `->` separates pattern from body (not a lambda introducer). The parser knows it is inside a match because it tracked the `match` keyword. Each arm is: pattern, then `->`, then expression. The `}` closes the match.

### AST Nodes

- `Match` — expression: scrutinee + arms
- `Arm` — pattern + body expression
- `Pattern` — union type: `WildcardPattern | BindingPattern | ConstructorPattern | LiteralPattern`. Uses `Schema.suspend` for `ConstructorPattern.patterns` (sub-patterns for constructor fields), following the same recursive schema pattern as `Expr`.
- `WildcardPattern` — matches anything
- `BindingPattern` — matches anything, binds to identifier
- `ConstructorPattern` — tag name (TypeIdent) + sub-patterns for fields
- `LiteralPattern` — literal value to match against

### Interpreter Semantics (ground truth)

- Evaluate scrutinee to a value
- Try each arm top-to-bottom: first matching pattern wins
- Constructor patterns match on `_tag` and bind fields positionally
- Literal patterns compare by value equality
- Wildcard matches always
- Binding matches always, extends environment with name → value
- No matching arm → runtime error (exhaustiveness checking deferred to v0.4)

### Codegen

```typescript
// match expr { Some x -> x + 1, None -> 0 }
Match.value(expr).pipe(
  Match.tag("Some", ({ _0: x }) => x + 1),
  Match.tag("None", () => 0),
  Match.exhaustive,
);

// Literal patterns use Match.when:
// match x { 42 -> "exact", _ -> "other" }
Match.value(x).pipe(
  Match.when(
    (v) => v === 42,
    () => "exact",
  ),
  Match.orElse(() => "other"),
);
```

### Formatter

- `match` keyword on same line as scrutinee
- Opening `{` on same line
- Each arm on its own line, indented
- `->` aligned within a match block
- Closing `}` on its own line

### Tokens

- `match` added to keyword set

## Feature 2: Type Declarations (ADTs)

### Syntax

```bang
type Bool = True | False

type Maybe a = Some a | None

type Shape = Circle { radius: Float }
           | Rectangle { width: Float, height: Float }
           | Point
```

`type` keyword marks nominal — the declared type is distinct from all other types. `|` is a separator between constructors, not a prefix.

### Grammar

```ebnf
Declaration = 'type' TypeIdent TypeVar* '=' TypeBody ;

TypeBody    = Constructor ('|' Constructor)* ;

Constructor = TypeIdent                             (* nullary: None, Point *)
            | TypeIdent Type+                       (* positional: Some a *)
            | TypeIdent '{' Field (',' Field)* '}'  (* named: Circle { radius: Float } *)
            ;

Field       = Ident ':' Type ;
```

Parser disambiguation: after `=`, sees `TypeIdent` → ADT constructor. This is unambiguous because constructors always start uppercase.

### Three Constructor Forms

| Form       | Example                    | Fields  | Access          |
| ---------- | -------------------------- | ------- | --------------- |
| Nullary    | `None`, `Point`            | None    | —               |
| Positional | `Some a`                   | Unnamed | `_0`, `_1`, ... |
| Named      | `Circle { radius: Float }` | Named   | `.radius`       |

### AST Nodes

- `TypeDecl` — statement: name (TypeIdent), type params (TypeVar[]), constructors (Constructor[])
- `Constructor` — tag name + fields: `NullaryConstructor | PositionalConstructor | NamedConstructor`

### Interpreter Semantics

- `TypeDecl` registers each constructor as a function in the environment
- Nullary constructors: value `{ _tag: "None" }`
- Positional constructors: function that produces `{ _tag: "Some", _0: value }`
- Named constructors: function that produces `{ _tag: "Circle", radius: 5.0 }`
- Constructor application: `Some 42` → `{ _tag: "Some", _0: 42 }`

### Codegen

```typescript
// type Maybe a = Some a | None
const Some = <A>(value: A) => Data.tagged("Some")({ _0: value });
const None = Data.tagged("None")({});
```

Full Schema.TaggedClass codegen deferred — `Data.tagged` is simpler for v0.3 and sufficient for match dispatch via `_tag`.

### Formatter

- `type` keyword, name, params, `=` on first line
- Single-line if fits: `type Bool = True | False`
- Multi-line: each constructor on its own line, `|` as prefix on continuation lines
- Named fields: `{ field: Type }` inline with constructor

### Tokens

- `type` already in keyword set
- `|` added as operator/delimiter

## Feature 3: Mut + Assignment

### Syntax

```bang
mut count = 0
count <- count + 1
```

### AST Nodes

- `Declaration` already has `mutable: Schema.Boolean` (currently hardcoded to `false`). v0.3 work: parse `mut` keyword to set it to `true`.
- `Mutation` — new statement node: target identifier + value expression

### Interpreter Semantics

- `mut x = expr` → allocates a mutable cell in the environment
- `x <- expr` → updates the mutable cell, returns the new value
- Reading a mut binding returns current value directly
- `<-` on a non-mut binding → runtime error (checker catches statically)

### Codegen

```typescript
// mut count = 0
const count = yield * Ref.make(0);

// reading count (anywhere count appears in an expression)
const _count = yield * Ref.get(count);

// count <- count + 1
const _count_1 = yield * Ref.get(count);
yield * Ref.set(count, _count_1 + 1);
```

**Ref.get hoisting:** `yield*` cannot appear inside sub-expressions in JavaScript. Codegen must hoist `Ref.get` reads to temporary bindings when they appear inside compound expressions (e.g., `count + 1` becomes `const _tmp = yield* Ref.get(count); _tmp + 1`). The checker tracks which bindings are mutable. Codegen uses this annotation to emit `Ref.get` (hoisted) for reads and `Ref.make`/`Ref.set` for allocation/mutation.

### Formatter

- `mut` keyword before identifier in declaration
- `<-` with spaces on both sides
- Chained mutation deferred to v0.4 (single assignment only)

### Tokens

- `mut` already in keyword set
- `<-` added as operator

## Feature 4: Import/Export

### Syntax

```bang
from STD import { log, error }
export { greet, add }
```

### Module Resolution

`from X.Y.Z import { ... }` resolves by checking in order:

1. `./x/y/z.bang`
2. `./x/y/z/index.bang`

First match wins. Path segments lowercased from TypeIdent to filesystem path. There is no special `@bang/std` package resolution in v0.3 — `from STD import { log }` looks for `./std.bang` or `./std/index.bang` relative to the importing file. Standard library is a local directory.

### AST Nodes

- `Import` — statement: module path (TypeIdent[]) + imported names (Ident[])
- `Export` — statement: exported names (Ident[])

### Interpreter Semantics

For v0.3, imports are a no-op in the interpreter (single-file eval). The interpreter evaluates one file at a time. Multi-file resolution is a compiler concern.

Exports mark which bindings are externally visible. The interpreter ignores visibility — all bindings are accessible during eval.

### Codegen

```typescript
// from STD import { log, error }
import { log, error } from "./std";

// export { greet, add }
export { greet, add };
```

### Visibility

Two levels for v0.3:

- **Private** (default) — not in any `export { }` statement
- **Exported** — listed in `export { }`, part of public API

### Formatter

- `from` and `import` on same line
- Braces with spaces: `{ f, g }`
- Imported names sorted alphabetically
- Exports collected at end of file (formatter convention, not enforced)

### Tokens

- `from`, `import`, `export` added to keyword set

## Implementation Order

Features have dependencies:

1. **Type declarations** first — constructors are needed for constructor patterns in match
2. **Match + patterns** second — needs constructors to destructure
3. **Mut + assignment** third — independent of 1-2 but benefits from match for testing
4. **Import/export** fourth — independent, needs the others to be useful

Each feature follows the pipeline:

```
AST node (Schema.TaggedClass) → Match.exhaustive breaks everything
  → Lexer (new tokens)
  → Parser (source → AST)
  → Interpreter (ground truth semantics)
  → Checker (scope/type rules)
  → Codegen (compile to Effect TS)
  → Formatter (canonical output)
  → AstGen (random generators for new nodes)
  → Property tests: eval ≡ run(codegen), parse(format(x)) roundtrips
```

## Deferrals (v0.4+)

### Patterns

- Mixed pattern kinds in same match (constructor + literal arms) — requires unified codegen strategy
- Nested patterns `Ok (Some x)` — requires recursive pattern matching
- Array patterns `[x, ...rest]` — requires array destructuring codegen
- Record patterns `{ name: n }` — requires record type support
- Guard patterns `n if n > 0` — requires expression eval in pattern context

### Type Declarations

- Newtype `type UserId = String` — branded wrapper, additive
- Record type `type User = { name: String, age: Int }` — additive, needs record literals
- Parameterised aliases `type Pair a b = (a, b)` — additive
- Structural aliases `X = String` — no `type` keyword, purely structural
- Schema.TaggedClass codegen — v0.3 uses simpler Data.tagged
- Derived Ord, Show, Hash — requires trait system

### Effect Handling

- `.handle { Eff -> impl }` — dot-method parsing, Layer codegen, effect row elimination
- `.catch { Err -> expr }` — dot-method parsing, catchTag codegen
- `.map f` / `.tap f` — dot-method parsing
- Exhaustiveness checking in checker — runtime error on miss for v0.3

### Other Features

- `use x = f` — callback-flattening desugaring
- `on source handler` — push subscriptions, cycle detection
- `gen { ... }` — escape hatch, additive
- Chained mutation `a <- b <- expr` — single assignment sufficient for v0.3
- `pub` visibility — two-level (private/export) sufficient for v0.3
- Pipe placeholder `_` — lambda desugaring
- Named function sugar `f x = { body }` — formatter convention
