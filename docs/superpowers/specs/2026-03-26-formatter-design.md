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
| 8 | Newline after `{` and before `}` | `Doc.hardLine` (or `Doc.line` inside `group` for short blocks) |
| 9 | Two-space indentation inside blocks | `Doc.nest(2, ...)` |
| 12 | Unit is `()` in value position | `Doc.text("()")` for UnitLiteral |

Deferred (features not yet implemented): 3 (lambda params — bare Haskell-style), 4 (mutation chaining), 5 (chained unifications), 10 (import sorting), 11 (type annotation inference), 13 (transaction), 14 (match arms).

## Doc construction by AST node

### Literals

```
IntLiteral(n)     → text(String(n))
FloatLiteral(n)   → text(String(n))
StringLiteral(s)  → text('"' + escape(s) + '"')
BoolLiteral(b)    → text(String(b))
UnitLiteral       → text("()")
StringInterp(ps)  → text('"') + parts + text('"')
  where InterpText → text(value)
        InterpExpr → text("${") + toDoc(expr) + text("}")
```

### Operators

```
BinaryExpr(op, l, r) → group(toDoc(l) <+> text(op) <+> toDoc(r))
UnaryExpr("-", e)    → text("-") <> toDoc(e)
UnaryExpr("not", e)  → text("not") <+> toDoc(e)
```

Where `<+>` is `catWithSpace` and `<>` is `cat`.

Parenthesization: if a binary expr's child is also a binary expr with lower precedence, wrap in parens. Use the same precedence table as the Pratt parser.

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
Lambda(params, body) → hsep(params.map(text)) <+> text("->") <+> toDoc(body)
```

Example: `a b -> { a + b }`

### Application

```
App(func, args) → toDoc(func) <+> hsep(args.map(toDoc))
```

Example: `add 3 4`

For complex args, parenthesize: `add (1 + 2) 3`

### Statements

```
Declaration(name, _, value, _, _) → text(name) <+> text("=") <+> toDoc(value)
Declare(name, type)               → text("declare") <+> text(name) <+> text(":") <+> formatType(type)
ForceStatement(Force(expr))       → text("!") <> toDoc(expr)
ExprStatement(expr)               → toDoc(expr)
```

Each statement followed by `;` when inside a block. Top-level statements separated by newlines (no semicolons).

### Types

```
ConcreteType(name)          → text(name)
ArrowType(param, result)    → formatType(param) <+> text("->") <+> formatType(result)
EffectType(value, deps, err) → text("Effect") <+> formatType(value) <+> text("{") <+> hsep(deps) <+> text("}") <+> formatType(err)
```

### Identifiers and DotAccess

```
Ident(name)              → text(name)
DotAccess(obj, field)    → toDoc(obj) <> text(".") <> text(field)
Force(expr)              → text("!") <> toDoc(expr)
```

### Program

```
Program(stmts) → vsep(stmts.map(formatTopLevelStmt))
```

Top-level statements separated by blank lines between declarations. No trailing semicolons at top level.

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
