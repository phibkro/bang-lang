# Bang Formatter — Design Spec

**Date:** 2026-03-26
**Purpose:** Canonical pretty-printer/formatter using `@effect/printer` (Wadler-Lindig). Enables roundtrip testing and the `bang fmt` CLI command.

## Overview

One function: `format = render ∘ toDoc ∘ parse`. The pretty-printer IS the formatter — there's no separate "unformatted" mode. Every AST-to-string conversion goes through the same Doc IR and produces canonical output.

This unlocks the roundtrip property test:
```
eval(parse(format(source))) ≡ eval(parse(source))
```

## Architecture

```
Source (String)
  → Lexer → Parser → AST
  → toDoc (AST → Doc)
  → render (Doc → String, with page width)
```

`toDoc` converts each AST node to a `Doc<never>` using `@effect/printer`'s combinators. `render` uses Wadler-Lindig layout to produce a string that respects the configured line width (default 80).

The key insight from Wadler-Lindig: `Doc.group(doc)` tries to fit `doc` on one line. If it doesn't fit, it breaks at `line`/`softLine` points. This gives us smart formatting — short blocks stay on one line, long blocks break.

## Formatting Rules (from language spec)

The spec defines 14 rules. We implement the ones relevant to v0.2 features:

| # | Rule | How |
|---|------|-----|
| 1 | Semicolons after every statement | `toDoc` emits `;` after each statement in blocks |
| 2 | Braces around all block bodies | `toDoc` always emits `{ }` for blocks |
| 6 | Single space around binary operators | `Doc.catWithSpace` around operator |
| 7 | Single space after keywords | `Doc.catWithSpace` after `declare`, etc. |
| 8 | Newline after `{` and before `}` when block breaks; space-padded when flat | `Doc.line` inside `Doc.group` — resolves to space when flat, newline when broken |
| 9 | Two-space indentation inside blocks | `Doc.nest(2, ...)` |
| 12 | Unit is `()` in value position | `Doc.text("()")` for UnitLiteral |

Deferred (features not yet implemented): 3 (lambda params — bare Haskell-style), 4 (mutation chaining), 5 (chained unifications), 10 (import sorting), 11 (type annotation inference), 13 (transaction), 14 (match arms).

## Doc construction by AST node

### Literals

```
IntLiteral(n)     → text(String(n))
FloatLiteral(n)   → text(String(n))
StringLiteral(s)  → text('"' + escape(s) + '"')   -- see escape rules below
BoolLiteral(b)    → text(String(b))
UnitLiteral       → text("()")
StringInterp(ps)  → text('"') + parts + text('"')
  where InterpText → text(value)
        InterpExpr → text("${") + toDoc(expr) + text("}")
```

**String escape rules:** The lexer stores escape sequences as their escaped form (`\\n` as two characters, not a newline). The formatter emits `StringLiteral.value` as-is inside quotes — no re-escaping needed. If the lexer behavior changes to store actual characters, the formatter must re-escape `"` → `\"`, `\n` → `\\n`, etc.

### Operators

```
BinaryExpr(op, l, r) → group(parenIfNeeded(l) <> softLine <> text(op) <+> parenIfNeeded(r))
UnaryExpr("-", e)    → text("-") <> parenIfNeeded(e)
UnaryExpr("not", e)  → text("not") <+> parenIfNeeded(e)
```

Where `<+>` is `catWithSpace`, `<>` is `cat`, and `softLine` breaks to newline when group overflows (the key for Wadler-Lindig width-respecting).

**Parenthesization rule:** Wrap a subexpression in parens if it is a `BinaryExpr` with lower or equal precedence than the parent. Use the same precedence table as the Pratt parser. The formatter normalizes parenthesization — redundant parens are removed, necessary parens are added. This is a deliberate canonicalization.

### Blocks

```
Block([], expr)        → text("{") <+> toDoc(expr) <+> text("}")    -- single-expr, try flat
Block(stmts, expr)     → group(
                           text("{") <>
                           nest(2, line <> formatStmts(stmts) <> formatExpr(expr)) <>
                           line <> text("}")
                         )
```

`Doc.group` tries flat first: `{ x = 1; y = 2; x + y }`. If too wide, breaks:
```
{
  x = 1;
  y = 2;
  x + y
}
```

### Lambdas

```
Lambda(params, body) → fillSep(params.map(text)) <+> text("->") <+> toDoc(body)
```

Example: `a b -> { a + b }`

Lambda body is always a `Block` in v0.2 (enforced by parser). The formatter can assume this.

### Application

```
App(func, args) → toDoc(func) <+> fillSep(args.map(parenIfNonAtom))
```

Example: `add 3 4`

**Argument parenthesization rule:** Wrap an argument in parens if it is NOT an atom. Atoms are: `Ident`, `IntLiteral`, `FloatLiteral`, `StringLiteral`, `BoolLiteral`, `UnitLiteral`, `Block`, `StringInterp`, `DotAccess`. Everything else (`BinaryExpr`, `UnaryExpr`, `Lambda`, `App`, `Force`) gets parens. Example: `add (1 + 2) 3`.

`fillSep` instead of `hsep` allows long argument lists to break across lines.

### Statements

```
Declaration(name, value)     → text(name) <+> text("=") <+> toDoc(value)
Declare(name, type)          → text("declare") <+> text(name) <+> text(":") <+> formatType(type)
ForceStatement(stmt)         → toDoc(stmt.expr)   -- stmt.expr is always a Force node, which formats as !expr
ExprStatement(expr)          → toDoc(expr)
```

Note: `Declaration.mutable` is always `false` in v0.2 (parser doesn't parse `mut` yet). When `mut` is added, format as `mut name = value`. `Declaration.typeAnnotation` is always `None` in v0.2. When present, format as `name : Type = value`.

Each statement followed by `;` when inside a block. Top-level statements separated by newlines (no semicolons).

### Types

```
ConcreteType(name)          → text(name)
ArrowType(param, result)    → formatType(param) <+> text("->") <+> formatType(result)
EffectType(value, deps, err) → text("Effect") <+> formatType(value) <+> text("{") <+> hsep(deps.map(text)) <+> text("}") <+> formatType(err)
```

### Identifiers and DotAccess

```
Ident(name)              → text(name)
DotAccess(obj, field)    → toDoc(obj) <> text(".") <> text(field)
Force(expr)              → text("!") <> toDoc(expr)
```

### Program

```
Program(stmts) → concatWith((a, b) => a <> hardLine <> hardLine <> b)(stmts.map(formatTopLevelStmt))
```

Top-level statements separated by blank lines (double newline). No trailing semicolons at top level.

## File Structure

```
packages/core/src/
  Formatter.ts    — toDoc + format functions
  index.ts        — add Formatter export

packages/core/test/
  Formatter.test.ts  — roundtrip tests, formatting tests
```

## Public API

```typescript
// Format a parsed AST back to canonical Bang source
format: (program: Ast.Program) => string

// Format a source string (parse then format)
formatSource: (source: string) => Effect<string, CompilerError>
```

`formatSource = source → lex → parse → format` — this is the `bang fmt` pipeline.

## CLI Integration

Add `fmt` command to `packages/cli/src/index.ts`:

```
bang fmt <file.bang>         # Format in place
bang fmt --check <file.bang> # Check if formatted, exit 1 if not
```

## Testing Strategy

### Roundtrip property test (the big one)

```typescript
it.effect("format roundtrip preserves semantics", () =>
  Effect.gen(function*() {
    const source = "result = { x = 1 + 2 * 3; y = x; y }"
    const formatted = yield* Formatter.formatSource(source)
    const original = yield* interpret(source)
    const roundtripped = yield* interpret(formatted)
    expect(roundtripped).toEqual(original)
  })
)
```

### Idempotence

```typescript
// format(format(source)) === format(source)
it.effect("formatting is idempotent", () =>
  Effect.gen(function*() {
    const source = "result={x=1+2*3;y=x;y}"
    const once = yield* Formatter.formatSource(source)
    const twice = yield* Formatter.formatSource(once)
    expect(twice).toBe(once)
  })
)
```

### Canonical output tests

```typescript
// Specific formatting expectations
expect(format(parse("x=1+2"))).toBe("x = 1 + 2")
expect(format(parse("result={x=1;x}"))).toBe("result = { x = 1; x }")
// or multi-line if too wide
```

## Dependencies

- `@effect/printer` — already in dependency tree via Effect
- May need to add as explicit dependency in `packages/core/package.json`

## What This Does NOT Include

- Comment preservation (comments are discarded by the lexer — a known limitation)
- Whitespace-sensitive formatting (Bang uses braces, not indentation)
- Import sorting (no imports yet)
- Type annotation inference (no type inference yet)
