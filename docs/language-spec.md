```ebnf
(*
    BANG LANGUAGE SPECIFICATION
    ============================
    Version: 0.2
    Transpilation target: Effect TS

    CONVENTIONS
    -----------
    Terminals         'quoted'
    Nonterminals      PascalCase
    Optional          Term?
    Zero or more      Term*
    One or more       Term+
    Alternation       |
    Grouping          ( )

    PRECEDENCE
    ----------
    Expr alternatives are ordered by decreasing binding priority.
    Earlier alternatives bind tighter than later ones.

    FORMATTING
    ----------
    The formatter runs before compilation.
    Semicolons, braces, parentheses, and type annotations
    are enforced by the formatter, not the parser.
    The parser accepts flexible input.
*)


(* ─────────────────────────────────────────
   PROGRAM
   ───────────────────────────────────────── *)

Program         = Statement* ;

Statement       = Declaration
                | Mutation
                | Force
                | Import
                | Export
                | Defer
                ;


(* ─────────────────────────────────────────
   DECLARATIONS
   ───────────────────────────────────────── *)

Declaration     = 'mut'? Ident '=' Expr
                | Ident ':' Type
                | Ident ':' Type Ident Param* '=' Block
                | 'comptime' Ident '=' Expr
                | 'type' TypeIdent TypeVar* '=' Type
                | 'declare' Ident ':' Type
                ;

(*
    'type' covers two cases inferred by the compiler:

    type UserId = String            -- newtype, distinct from String
    type Name = String              -- distinct from UserId despite same rep
    type Pair A B = (A, B)         -- parameterised type alias

    TYPE SYSTEM: NOMINAL vs STRUCTURAL
    ───────────────────────────────────
    'type' declarations create NOMINAL types.
    Two types with the same underlying representation
    are never automatically coerced. Coercion is always explicit.

    type UserId = String
    type Name = String
    -- UserId ≠ Name ≠ String. All three are distinct types.

    Coercion requires explicit constructor/destructor:
    userId = UserId "abc"           -- wrap: String -> UserId
    raw = UserId.unwrap userId      -- unwrap: UserId -> String

    Anonymous types (records, tuples, functions, effects) are STRUCTURAL.
    Two anonymous types with the same shape are the same type:
    { name: String, age: Int } == { name: String, age: Int }
    (String -> Int) == (String -> Int)

    EQUALITY
    ────────
    == requires operands of the same type.
    Cross-type comparison is a type error:
    userId == name                  -- TYPE ERROR: UserId ≠ Name
    userId1 == userId2              -- OK: same type

    Value equality delegates to the underlying representation.
    Effect's Equal trait is the mechanism for custom equality.
*)


(* ─────────────────────────────────────────
   MUTATION
   ───────────────────────────────────────── *)

Mutation        = Expr '<-' Expr ;

(*
    Mutation returns the new value enabling chaining.
    Chains evaluate right to left.

    a <- b <- c <- expr
    evaluates as:
    a <- (b <- (c <- expr))

    Formatter parenthesises chains explicitly.

    Compiles to:
    yield* pipe(expr,
        Effect.flatMap(v => Ref.set(c, v)),
        Effect.flatMap(v => Ref.set(b, v)),
        Effect.flatMap(v => Ref.set(a, v)))
*)


(* ─────────────────────────────────────────
   FORCE
   ───────────────────────────────────────── *)

Force           = '!' Expr ;

(*
    Force resolves by type of Expr:

    Expr : Effect A D E   ->  yield* Expr
    Expr : Promise A      ->  yield* Effect.promise(() => Expr)
    Expr : () -> A        ->  yield* Effect.sync(() => Expr())
    Expr : A              ->  Expr  (no-op, plain value)

    TypeScript interop:
    The compiler inspects the TypeScript declaration of any
    identifier and resolves force appropriately.
    No explicit FFI syntax required.

    declare console.log : String -> Effect Unit { stdout } {}
    !console.log "hello"    -- compiler resolves and wraps

    Top-level Force causes the module to be wrapped
    in Effect.runPromise. Modules without top-level
    Force are pure library modules.
*)


(* ─────────────────────────────────────────
   DEFER
   ───────────────────────────────────────── *)

Defer           = 'defer' Force ;

(*
    Deferred effects run after the enclosing Block's
    return value is produced but before the value
    escapes the scope.

    Preferred pattern is explicit resource types:

    withFile : String -> (Resource FileHandle -> Effect A { file } E)
             -> Effect A {} E

    result = !withFile "path.txt" (file) -> {
        !file.value.read
    };

    defer is the escape hatch for ad-hoc cleanup
    that does not fit the resource pattern:

    result = !openFile "path.txt";
    defer !result.close;
    !result.read

    Compiles to:
    yield* Effect.addFinalizer(() => effect)

    Deferred effects are guaranteed to run even if
    the block fails. Order of execution is LIFO --
    last deferred runs first.
*)


(* ─────────────────────────────────────────
   IMPORTS AND EXPORTS
   ───────────────────────────────────────── *)

Import          = 'from' ModulePath 'import' Ident (',' Ident)* ;

Export          = 'export' Ident (',' Ident)* ;

ModulePath      = TypeIdent ('.' TypeIdent)* ;

(*
    Module name is derived from file path.
    STD/IO/CONSOLE.bang -> STD.IO.CONSOLE

    Circular imports are a compile error.
    Modules form a DAG consistent with the reactive graph model.

    Imports compile to:
    import { f } from 'ModulePath'

    Exports compile to:
    export { f }
*)


(* ─────────────────────────────────────────
   EXPRESSIONS
   Ordered by decreasing binding priority.
   ───────────────────────────────────────── *)

Expr            = Expr '.' Ident Atom*              (* composition / field access *)
                | Expr Atom+                        (* application by juxtaposition *)
                | Expr ('*' | '/' | '%') Expr       (* multiplicative *)
                | Expr ('+' | '-' | '++') Expr      (* additive *)
                | Expr CompOp Expr                  (* comparison *)
                | 'not' Expr                        (* logical NOT *)
                | Expr 'and' Expr                   (* logical AND *)
                | Expr 'or' Expr                    (* logical OR *)
                | Expr 'xor' Expr                   (* logical XOR *)
                | '!' Expr                          (* force *)
                | Expr '<-' Expr                    (* mutation expression *)
                | Ident                             (* variable reference *)
                | Literal                           (* literal value *)
                | Block                             (* scoped sequence *)
                | Match                             (* pattern match *)
                | Lambda                            (* anonymous function *)
                | Transaction                       (* atomic block *)
                | '(' Expr ')'                      (* grouping *)
                ;

CompOp          = '==' | '!=' | '<' | '>' | '<=' | '>=' ;


(* ─────────────────────────────────────────
   BLOCK
   ───────────────────────────────────────── *)

Block           = '{' Statement* Expr '}' ;

(*
    Block compiles to Effect.gen(function* () { ... }).
    The final Expr is the return value.
    Statements are sequenced effects.
    Every Block introduces a new scope.
    Lifetimes of bindings are bounded by their enclosing Block.

    Closures capture reactive references by default.
    To capture a snapshot, force inside the closure:

    g = () -> { !y }    -- captures reactive reference to y
    g = () -> { (!y) }  -- captures snapshot of y at closure creation
*)


(* ─────────────────────────────────────────
   MATCH
   ───────────────────────────────────────── *)

Match           = 'match' Expr '{' Arm+ '}' ;

Arm             = Pattern '->' Expr ;

(*
    Match is exhaustive. Non-exhaustive match is a type error.
    All Arms must return the same type.
    Arms are checked top to bottom, first match wins.

    Compiles to:
    yield* Effect.matchEffect(expr, {
        onSuccess: (a) => handler,
        onFailure: (e) => handler
    })

    For ADTs, compiles to a series of tag checks
    with exhaustiveness verified at compile time.
*)


(* ─────────────────────────────────────────
   LAMBDA
   ───────────────────────────────────────── *)

Lambda          = Param '->' Block
                | '(' Param* ')' '->' Block
                ;

Param           = Ident
                | '(' Ident ':' Type ')'
                ;

(*
    Formatter canonicalises all lambdas to
    parenthesised multi-param form:
    x -> { expr }  becomes  (x) -> { expr }

    Compiles to:
    (x) => Effect.gen(function* () { ... })
*)


(* ─────────────────────────────────────────
   TRANSACTION
   ───────────────────────────────────────── *)

Transaction     = '!' 'transaction' Block ;

(*
    Executes Block as a single atomic STM transaction.
    Either completes fully or retries from the start.
    No partial state is visible to other transactions.

    Mutations inside transaction operate on TRef not Ref.
    The compiler automatically promotes Ref to TRef
    inside a transaction block.

    Compiles to:
    yield* STM.commit(STM.gen(function* () { ... }))

    Example:
    !transaction {
        from.balance <- !from.balance - amount;
        to.balance <- !to.balance + amount
    }
*)


(* ─────────────────────────────────────────
   CONCURRENCY
   ───────────────────────────────────────── *)

(*
    Concurrency is provided by the STANDARD LIBRARY, not special syntax.
    These are regular functions called with the force operator:

    from STD.CONCURRENT import all, race, fork

    !all [e1, e2, ...]
    Force all concurrently. Returns tuple of all results.
    all : List (Effect A D E) -> Effect (List A) D E
    Compiles to:
    yield* Effect.all([e1, e2, ...], { concurrency: 'unbounded' })

    !race [e1, e2, ...]
    Force concurrently. Returns first result, cancels rest.
    race : List (Effect A D E) -> Effect A D E
    Compiles to:
    yield* Effect.race(e1, e2, ...)

    !fork e
    Fork into background fiber. Returns Fiber handle.
    fork : Effect A D E -> Effect (Fiber A E) {} {}
    Compiles to:
    yield* Effect.fork(e)

    No special grammar is needed. The force operator ! handles
    these like any other Effect-returning function.
*)


(* ─────────────────────────────────────────
   PATTERNS
   ───────────────────────────────────────── *)

Pattern         = '_'                                                   (* wildcard *)
                | Ident                                                 (* binding *)
                | TypeIdent Pattern*                                    (* constructor *)
                | Literal                                               (* literal *)
                | '[' Pattern* ']'                                     (* list *)
                | '[' Pattern ',' '...' Ident ']'                     (* head / tail *)
                | '{' Ident ':' Pattern (',' Ident ':' Pattern)* '}'  (* record *)
                | Pattern 'if' Expr                                    (* guard *)
                ;


(* ─────────────────────────────────────────
   ATOMS
   Irreducible expression units.
   ───────────────────────────────────────── *)

Atom            = Ident
                | Literal
                | '(' Expr ')'
                | Block
                ;


(* ─────────────────────────────────────────
   LITERALS
   ───────────────────────────────────────── *)

Literal         = Integer
                | Float
                | String
                | Bool
                | List
                | Unit
                ;

Integer         = [0-9]+ ;
Float           = [0-9]+ '.' [0-9]+ ;
String          = '"' [^"]* '"' ;
Bool            = 'true' | 'false' ;
List            = '[' (Expr (',' Expr)*)? ']' ;
Unit            = '()' ;


(* ─────────────────────────────────────────
   IDENTIFIERS
   ───────────────────────────────────────── *)

Ident           = [a-z] [a-zA-Z0-9]* ;
TypeIdent       = [A-Z] [a-zA-Z0-9]* ;


(* ─────────────────────────────────────────
   TYPES
   Ordered by decreasing binding priority.
   ───────────────────────────────────────── *)

Type            = TypeIdent Type+                                               (* application *)
                | Type '->' Type                                                (* function *)
                | TypeIdent                                                     (* concrete *)
                | TypeVar 'where' Constraint (',' Constraint)*                 (* constrained *)
                | TypeVar                                                       (* variable *)
                | '{' Ident ':' Type (',' Ident ':' Type)* '}'                (* record *)
                | '[' Type ']'                                                  (* list *)
                | '(' Type (',' Type)+ ')'                                     (* tuple *)
                | '(' ')'                                                       (* unit *)
                ;

TypeVar         = [a-z]+ ;

Constraint      = TypeVar ':' TypeIdent ;

(*
    BUILT-IN TYPE CONSTRUCTORS
    ──────────────────────────

    Signal A D E
        Pure reactive computation.
        A   value type
        D   dependency set  { ident* }
        E   error type
        Documents purity intent.
        Compiler infers -- annotation optional.

    Effect A D E
        Effectful computation.
        A   value type
        D   resource dependency set  { ident* }
        E   error type
        Documents side effect intent.
        Compiler infers -- annotation optional.

    Signal and Effect are semantically distinct
    but compile to the same Effect.Effect<A,E,D>.

    Result A E      materialised failable value
    Maybe A         optional value
    List A          linked list
    Ref A           mutable reference  (plain context)
    TRef A          mutable reference  (transaction context)
    Unit            absence of value  ()

    DEPENDENCY SETS
    ───────────────
    {}              no dependencies
    { db }          single dependency
    { db, net }     multiple dependencies
    { db | r }      open row, r is a type variable  (v2)

    RESOURCE TYPES
    ──────────────
    Preferred over defer for structured cleanup.

    Resource A = {
        value   : A,
        cleanup : Effect Unit {} {}
    }

    withX : (Resource X -> Effect A { x } E) -> Effect A {} E

    The handler must consume the resource within its scope.
    The resource never escapes. Cleanup is guaranteed.

    TYPE INFERENCE
    ──────────────
    A function is inferred as Signal if its body contains
    no force of a declared effectful expression.
    Otherwise inferred as Effect.
    Top-level function declarations benefit from explicit
    annotation for documentation and cross-module checking.
    Inference is full Hindley-Milner within blocks.

    MUST-HANDLE
    ───────────
    Any expression of type Effect A D E or Result A E
    appearing in statement position without force
    is a type error.
*)


(* ─────────────────────────────────────────
   TYPESCRIPT INTEROP
   ───────────────────────────────────────── *)

(*
    No explicit FFI syntax. The compiler inspects TypeScript
    declarations and resolves ! appropriately:

    TS return type          ! compiles to
    ──────────────────────────────────────
    void | A                direct call
    Promise<A>              Effect.promise(() => call)
    Effect.Effect<A,E,R>    yield* call

    Foreign functions are declared with 'declare':

    declare console.log : String -> Effect Unit { stdout } {}
    declare fetch : String -> Effect Response { net } HttpError

    Then called like any BANG function:

    !console.log "hello"
    !fetch "https://api.example.com"

    The compiler wraps the call based on the declared type.
    No extern keyword required.
    TypeScript global declarations are resolved automatically
    if not explicitly declared in BANG -- falling back to
    Effect Unit {} {} for unrecognised return types.
*)


(* ─────────────────────────────────────────
   STANDARD LIBRARY
   @bang/std -- thin wrappers over Effect TS
   ───────────────────────────────────────── *)

(*
    STD.IO.CONSOLE      log, warn, error, read
    STD.IO.FILE         read, write, append, delete
    STD.HTTP            fetch, get, post, put, delete
    STD.JSON            parse, stringify
    STD.STREAM          MutSource, on, fromList, fromQueue, fromPubSub
    STD.CONCURRENT      fork, race, all, timeout
    STD.SCHEMA          decode, encode, filter
    STD.REF             make, get, set, update
    STD.STM             transaction, TRef
    STD.RESOURCE        Resource, with
*)


(* ─────────────────────────────────────────
   KEYWORDS
   Reserved. Cannot be used as identifiers.
   ───────────────────────────────────────── *)

(*
    mut             comptime        type
    declare         from            import
    export          match           not
    and             or              xor
    where           forall          defer
    true            false           if
    transaction     scoped

    Note: race, fork, all are standard library functions,
    not keywords. They are regular identifiers.
*)


(* ─────────────────────────────────────────
   FORMATTING RULES
   Enforced by formatter before compilation.
   Parser accepts flexible input.
   ───────────────────────────────────────── *)

(*
    1.  Semicolons after every Statement
    2.  Braces around all Block bodies
    3.  Lambda params parenthesised: (x) -> { }
    4.  Chained mutations right-associated: a <- (b <- (c <- e))
    5.  Chained unifications share one node: x = y = e
    6.  Single space around binary operators
    7.  Single space after keywords
    8.  Newline after { and before }
    9.  Two space indentation inside blocks
    10. Imports sorted alphabetically
    11. Type annotations filled in where unambiguously inferable
    12. Unit is ()  not unit or Unit in value position
    13. transaction always on its own line
    14. match arms each on their own line
*)


(* ─────────────────────────────────────────
   TRANSPILATION SUMMARY
   BANG -> Effect TS
   ───────────────────────────────────────── *)

(*
    BANG                                EFFECT TS
    ──────────────────────────────────────────────────────────────

    x = expr                            const x = expr
    mut x = expr                        const x = yield* Ref.make(expr)
    x = y = expr                        const _e = expr
                                        const y = _e; const x = _e
    x : T                               const x: T

    !e  (Effect)                        yield* e
    !e  (Promise)                       yield* Effect.promise(() => e)
    !e  (thunk)                         yield* Effect.sync(() => e())
    !e  (value)                         e

    e.f                                 pipe(e, f)
    e.f x y                             pipe(e, f(x)(y))

    x <- e                              yield* Ref.set(x, e)
    a <- (b <- (c <- e))                yield* pipe(e,
                                            Effect.flatMap(v => Ref.set(c, v)),
                                            Effect.flatMap(v => Ref.set(b, v)),
                                            Effect.flatMap(v => Ref.set(a, v)))

    { s* e }                            Effect.gen(function* () { s*; return e })

    match e { p -> h }                  yield* Effect.matchEffect(e, { ... })

    (p) -> { }                          (p) => Effect.gen(function* () { })

    !transaction { }                    yield* STM.commit(
                                            STM.gen(function* () { }))

    defer !e                            yield* Effect.addFinalizer(() => e)

    -- Concurrency (standard library, not syntax):
    !all [e1, e2]                       yield* Effect.all([e1, e2],
                                            { concurrency: 'unbounded' })
    !race [e1, e2]                      yield* Effect.race(e1, e2)
    !fork e                             yield* Effect.fork(e)

    declare f : A -> Effect B { r } E   // TypeScript declaration
                                        // resolved at ! call sites

    top-level !e                        Effect.runPromise(
                                            Effect.gen(function* () { ... }))

    from M import f                     import { f } from 'M'
    export f                            export { f }

    type UserId = String                type UserId = string
                                        & Brand.Brand<'UserId'>
                                        const UserId = Brand.nominal<UserId>()
    UserId "abc"                        UserId("abc")   -- wrap
    UserId.unwrap userId                userId           -- unwrap (type cast)

    type Pair A B = (A, B)             type Pair<A, B> = [A, B]
*)
```
