```ebnf
(*
    BANG LANGUAGE SPECIFICATION
    ============================
    Version: 0.4
    Transpilation target: Effect TS
*)


(* ─────────────────────────────────────────
   CORE MODEL
   ───────────────────────────────────────── *)

(*
    BANG is syntactic sugar for Effect TS.
    Every valid BANG program is a valid Effect TS program.
    The BANG compiler is a formatter and transpiler, not a runtime.
    Effect TS knowledge transfers directly.

    THE FUNDAMENTAL DISTINCTION
    ───────────────────────────
    Describing a computation and running a computation
    are different things. This distinction is BANG's
    central design principle.

    Every binding is a lazy thunk — a description.
    ! is the single site where descriptions become reality.

    x = fetch "https://api.example.com"     -- description, nothing runs
    result = !x                             -- reality, network call happens

    THE PULL MODEL
    ──────────────
    Nothing evaluates until forced with !.
    No ambient push propagation.
    Glitch-free by construction — every ! observes
    a consistent snapshot.

    mut count = 0
    doubled = count * 2     -- lazy, nothing runs

    !log doubled            -- pulls doubled, which pulls count
                            -- consistent at this moment

    PUSH IS EXPLICIT
    ────────────────
    Push reactivity is opt-in via the 'on' keyword.
    When a mut source updates, registered handlers fire.
    Handlers are pull contexts — everything inside
    evaluates via ! at a consistent point in time.

    on count (c) -> {       -- fires when count updates
        !log doubled        -- pulls consistent snapshot
    }

    count <- 5              -- triggers handler

    WHAT ! UNIFIES
    ──────────────
    ! is the single concept covering:
    - materialisation   thunk    -> value
    - allocation        Signal   -> value
    - async resolution  Promise  -> value  (implicit await)
    - effect execution  Effect   -> value  (side effects run)
    - error short-circuit        -> propagates to enclosing block

    The type of the expression determines which applies.
    The programmer always writes !.

    SIGNAL vs EFFECT
    ────────────────
    Signal A E R    pure lazy computation, safe to recompute
    Effect A E R    effectful computation, side effects on !

    Both compile to Effect.Effect<A,E,R>.
    Signal documents purity intent.
    Effect documents side effect intent.
    Both are inferred from the body. Annotation is optional.

    A function containing no ! on an effectful expression
    is inferred as Signal. Otherwise Effect.
*)


(* ─────────────────────────────────────────
   PROGRAM
   ───────────────────────────────────────── *)

Program     = Statement* ;

Statement   = Declaration
            | Mutation
            | Force
            | Import
            | Export
            | EscapeBlock
            ;


(* ─────────────────────────────────────────
   DECLARATIONS
   ───────────────────────────────────────── *)

Declaration = 'mut'? Ident '=' Expr
            | Ident ':' Type
            | Ident ':' Type Ident Param* '=' Block
            | 'type' TypeIdent TypeVar* '=' TypeBody
            | 'declare' QualifiedIdent ':' Type
            ;

QualifiedIdent  = Ident ('.' Ident)* ;

TypeBody        = Constructor ('|' Constructor)*    (* ADT: type Maybe a = Some a | None *)
                | Type                              (* newtype: type UserId = String *)
                | '{' Field (',' Field)* '}'        (* record: type User = { name: String } *)
                ;

Constructor     = TypeIdent                             (* nullary: None, Point *)
                | TypeIdent Type+                       (* positional: Some a *)
                | TypeIdent '{' Field (',' Field)* '}'  (* named: Circle { radius: Float } *)
                ;

Field           = Ident ':' Type ;

(*
    BINDING
    ───────
    x = expr        reactive binding, lazy thunk
    mut x = expr    mutable source, imperative entry point
                    into the reactive graph

    The difference is fundamental:
    x = 5           -- named computation, no allocation
    mut x = 5       -- Ref, allocated, externally pushable via <-

    FUNCTION DECLARATION
    ────────────────────
    Two forms, identical semantics, formatter picks based on context:

    -- sugared (named, formatter canonical for named functions)
    double : Int -> Int
    double x = { x * 2 }

    -- explicit (canonical for anonymous)
    double : Int -> Int
    double = x -> { x * 2 }

    Desugaring: f x y = { expr }  ->  f = x -> { y -> { expr } }
    All multi-param functions are curried.

    CHAINED UNIFICATION
    ───────────────────
    x = y = expr    both x and y alias the same computation node

    TYPE DECLARATIONS
    ─────────────────
    'type' covers four cases inferred by the compiler:

    -- newtype (nominal wrapper, distinct from underlying type)
    type UserId = String
    type Name = String
    -- UserId ≠ Name ≠ String, never auto-coerced
    -- construction:  UserId "abc"
    -- unwrap:        UserId.unwrap userId

    -- parameterised alias
    type Pair a b = (a, b)

    -- algebraic data type (sum type)
    type Shape = Circle { radius: Float }
               | Rectangle { width: Float, height: Float }
               | Point

    -- record type (product type)
    type User = {
      name  : String,
      age   : Int
    }

    NOMINAL vs STRUCTURAL
    ─────────────────────
    Named type declarations are NOMINAL.
    Anonymous types (records, tuples, functions) are STRUCTURAL.

    UserId ≠ Name even if both wrap String.
    { name: String } == { name: String } (structural, same type)

    SCHEMA AS NATIVE
    ────────────────
    Every 'type' declaration IS a Schema.
    Derived automatically, no import required:

    decode   : Unknown -> Effect T {} { Fail DecodeError }
    encode   : T -> String
    Equal    : T -> T -> Bool
    Hash     : T -> Int
    schema   : Schema T

    ADTs get tagged discrimination and exhaustive pattern
    matching automatically.

    DERIVED Ord AND Show
    ────────────────────
    ADTs derive ordering from declaration order:

    type Priority = Low | Medium | High
    -- Low < Medium < High
    -- show Low == "Low"
    -- Priority.values == [Low, Medium, High]

    DECLARE
    ───────
    'declare' asserts a type for a foreign identifier.
    The compiler trusts this — it cannot verify it.
    Used for TypeScript interop:

    declare console.log : String -> Effect Unit {} { Console }
    declare fetch : String -> Effect Response { Fail HttpError } { Http }

    EFFECT INTERFACES (via types)
    ─────────────────────────────
    Effect interfaces are just types. The compiler applies
    channel classification based on operation return types:

    Returns a value  ->  R channel (dependency / service)
    Returns Nothing  ->  E channel (error / abort)

    type Console = {
      log   : String -> Unit,      -- R channel, resumes
      error : String -> Unit       -- R channel, resumes
    }

    type Fail e = {
      fail : e -> Nothing          -- E channel, aborts
    }

    type Cache k v = {
      get : k -> Maybe v,          -- R channel
      set : k -> v -> Unit         -- R channel
    }

    IMPLEMENTATIONS
    ───────────────
    Implementations are plain values — first class,
    passable, exportable:

    consoleNode : Console = {
      log   = (msg) -> { !js.console.log msg },
      error = (msg) -> { !js.console.error msg }
    }

    mockConsole : Console = {
      log   = (_) -> { () },
      error = (_) -> { () }
    }

    USING EFFECTS
    ─────────────
    Calling an operation adds its effect to the inferred type.
    Compiler infers E and R from the body:

    getUser = (id) -> {
      rows = !Database.query id       -- adds Database to R
      match rows {
        Cons user _ -> user
        Nil -> !Fail.fail (NotFound id)  -- adds Fail NotFoundError to E
      }
    }
    -- inferred: Int -> Effect User { Fail NotFoundError } { Database }

    HANDLING EFFECTS
    ────────────────
    Via composable dot methods:

    .handle { Effect -> impl }  provides implementation, eliminates from R
    .catch  { Pattern -> expr } recovers from error, eliminates from E
    .map    f                   transforms success value
    .tap    f                   side effect, passes value through unchanged

    !getUser 42
      .handle { Database -> pgDatabase }
      .catch  { NotFound _ -> defaultUser }
      .map    (user) -> { user.name }

    EFFECT PROPAGATION
    ──────────────────
    Effects compose through the call graph automatically.
    Calling a function that uses effects adds them to yours.

    TESTING
    ───────
    Swap implementations — no special infrastructure needed:

    !getUser 42
      .handle { Database -> mockDatabase }
      .catch  { NotFound _ -> None }

    PRELUDE EFFECTS (defined in @bang/std)
    ──────────────────────────────────────
    type Console = { log, error, warn : String -> Unit }
    type FileSystem = { read, write, delete : String -> ... }
    type Http = { fetch : String -> Response }
    type Fail e = { fail : e -> Nothing }
    type Random = { next : Unit -> Float, nextInt : Int -> Int }
    type Clock = { now : Unit -> DateTime }
*)


(* ─────────────────────────────────────────
   MUTATION
   ───────────────────────────────────────── *)

Mutation    = Expr '<-' Expr ;

(*
    Only valid on mut bindings.
    Returns the new value, enabling chaining.
    Chains evaluate right to left:

    a <- b <- c <- expr
    evaluates as:
    a <- (b <- (c <- expr))

    Formatter parenthesises chains explicitly.
*)


(* ─────────────────────────────────────────
   FORCE
   ───────────────────────────────────────── *)

Force       = '!' Expr ;

(*
    Resolves by type of Expr:

    Effect A E R    yield* Expr
    Promise A       yield* Effect.promise(() => Expr)
    () -> A         yield* Effect.sync(() => Expr())
    A               Expr  (no-op)

    MUST-HANDLE
    ───────────
    Any Effect A E R or Result A E in statement position
    without ! is a type error.

    Unhandled R (dependencies) at the top-level ! boundary
    is a compile error. All dependencies must be handled
    before the program runs.

    Unhandled E (errors) at the top-level are a warning —
    they become runtime defects if uncaught.

    TOP-LEVEL !
    ───────────
    Any top-level ! causes the module to be an entry point.
    The compiler wraps the module in Effect.runPromise.
    Modules without top-level ! are pure library modules.

    ERROR SHORT-CIRCUIT
    ───────────────────
    ! on a fallible Effect short-circuits the enclosing
    block on failure, propagating the error upward.
    Equivalent to Rust's ? operator but unified with force.
*)


(* ─────────────────────────────────────────
   ESCAPE HATCH
   ───────────────────────────────────────── *)

EscapeBlock = 'gen' Block ;

(*
    Escape to raw Effect TS when BANG abstractions don't reach.
    Contents are opaque to the BANG type checker.
    Typed conservatively as Effect Unit {} {} unless annotated:

    result : Effect String { Fail HttpError } { Http }
    result = gen {
      yield* someRawEffectTsFunction()
    }

    Patterns appearing repeatedly in gen blocks are
    candidates for promotion to the stdlib.
    The escape block shrinks as the stdlib matures.
*)


(* ─────────────────────────────────────────
   ON — PUSH SUBSCRIPTIONS
   ───────────────────────────────────────── *)

(*
    'on' is the explicit bridge from push to pull.
    It is a keyword, not a library function, because:
    - The compiler uses on sites to build a static push topology
    - The compiler detects push cycles statically
    - A push cycle (handler eventually pushes back to its source)
      is a compile error

    SYNTAX
    ──────
    on Source Handler

    Source   : a mut binding
    Handler  : a lambda (event) -> Block

    sub = on stream (event) -> {
        result = !process event;
        !persist result
    }

    Returns a Subscription:
    type Subscription = { abort : Effect Unit {} {} }

    !sub.abort      -- unsubscribes, stops handler firing

    PUSH CYCLE DETECTION
    ────────────────────
    on a (x) -> { a <- x }      -- COMPILE ERROR: push cycle
    on a (x) -> { b <- x }      -- ok, pushes to different source
    on a (_) -> { on b ... }    -- ok, nested subscription

    PUSH + PULL COMPOSITION
    ───────────────────────
    The handler body is a pull context.
    Everything inside evaluates via ! at a consistent snapshot.
    No glitches possible — the snapshot is taken at handler invocation.

    on count (c) -> {
        doubled = count * 2     -- lazy inside handler
        !log doubled            -- forces at this moment, consistent
    }

    RESOURCE ACQUISITION INSIDE HANDLERS
    ─────────────────────────────────────
    use inside on handlers gives per-event resource lifecycle:

    on stream (event) -> {
        use conn = withDbConnection;    -- acquired per event
        result   = !query conn event;
        !persist result
        -- conn released when handler block exits
    }
*)


(* ─────────────────────────────────────────
   USE — RESOURCE ACQUISITION
   ───────────────────────────────────────── *)

(*
    'use' flattens callback-taking resource functions
    into linear code. Replaces both defer and scoped.

    SYNTAX
    ──────
    use Ident = Expr ;

    Expr must be a function that takes a callback:
    f : (a -> Effect b e r) -> Effect b e r

    DESUGARING
    ──────────
    use x = f;
    rest
    -- desugars to
    !f (x) -> { rest }

    EXAMPLES
    ────────
    -- without use
    result = !withDb (db) -> {
        !withTransaction db (tx) -> {
            !withLock tx (lock) -> {
                !doWork lock
            }
        }
    }

    -- with use, flat
    result = {
        use db   = withDb;
        use tx   = withTransaction db;
        use lock = withLock tx;
        !doWork lock
    }

    RESOURCE LIFECYCLE
    ──────────────────
    The resource is acquired at the 'use' site.
    Cleanup runs when the enclosing block exits.
    Cleanup is guaranteed even if the block fails.
    Multiple use expressions clean up in LIFO order.

    REPLACES defer
    ──────────────
    Any defer pattern is expressible as use with a wrapper:

    -- defer pattern (old)
    handle = !openFile "path.txt";
    defer !handle.close;
    !handle.read

    -- use pattern (preferred)
    use handle = withFile "path.txt";
    !handle.read
    -- handle.close guaranteed on block exit

    The stdlib provides 'with' wrappers for all common resources.
    Foreign resources without wrappers use the escape hatch.
*)


(* ─────────────────────────────────────────
   IMPORTS AND EXPORTS
   ───────────────────────────────────────── *)

Import      = 'from' ModulePath 'import' '{' Ident (',' Ident)* '}' ;

Export      = 'export' '{' Ident (',' Ident)* '}' ;

ModulePath  = TypeIdent ('.' TypeIdent)* ;

(*
    Module name derived from file path.
    Circular imports are a compile error.
    Modules form a DAG.
*)


(* ─────────────────────────────────────────
   EXPRESSIONS
   Ordered by decreasing binding priority.
   ───────────────────────────────────────── *)

Expr        = Expr '.' Ident Atom*          (* composition / field access *)
            | Expr Atom+                    (* application by juxtaposition *)
            | '-' Expr                      (* unary minus *)
            | Expr ('*' | '/' | '%') Expr
            | Expr ('+' | '-' | '++') Expr
            | Expr CompOp Expr
            | 'not' Expr
            | Expr 'and' Expr
            | Expr 'or' Expr
            | Expr 'xor' Expr
            | '!' Expr                      (* force *)
            | Expr '<-' Expr                (* mutation *)
            | Ident
            | Literal
            | Block
            | Match
            | Lambda
            | Transaction
            | '(' Expr ')'
            ;

CompOp      = '==' | '!=' | '<' | '>' | '<=' | '>=' ;


(* ─────────────────────────────────────────
   BLOCK
   ───────────────────────────────────────── *)

Block       = '{' Statement* Expr '}' ;

(*
    The final Expr is the return value.
    Every Block introduces a new scope.
    Lifetimes of bindings are bounded by their enclosing Block.

    CLOSURE CAPTURE
    ───────────────
    Closures capture reactive references by default.
    Forcing inside a closure captures a snapshot:

    g = () -> { count * 3 }     -- reactive reference to count
    g = () -> { (!count) * 3 }  -- snapshot of count at closure creation
*)


(* ─────────────────────────────────────────
   MATCH
   ───────────────────────────────────────── *)

Match       = 'match' Expr '{' Arm+ '}' ;

Arm         = Pattern '->' Expr ;

(*
    Exhaustive — non-exhaustive match is a type error.
    All arms must return the same type.
    First match wins.

    match shape {
      Circle c    -> !Console.log c.radius
      Rectangle r -> !Console.log (r.width * r.height)
      Point       -> !Console.log "point"
    }

    Nested patterns:
    match result {
      Ok (Some value) -> value
      Ok None         -> defaultValue
      Err e           -> !handleError e
    }

    Guards:
    match x {
      n if n > 0 -> "positive"
      n if n < 0 -> "negative"
      _          -> "zero"
    }
*)


(* ─────────────────────────────────────────
   LAMBDA
   ───────────────────────────────────────── *)

Lambda      = Param+ '->' Block ;

Param       = Ident
            | '(' Ident ':' Type ')'
            ;

(*
    Bare params, auto-curried:
    x -> { x * 2 }
    a b -> { a + b }            desugars to a -> { b -> { a + b } }
    (x : Int) -> { x * 2 }     typed param

    Partial application:
    add5 = add 3                -- b -> { 3 + b }

    PIPE PLACEHOLDER
    ────────────────
    _ as placeholder for the piped value when it is not
    the last argument:

    result = value
        .clamp(_, 0, 100)       -- _ is value
        .filter(_ > 50)

    Desugars to a lambda with _ substituted:
    .clamp(_, 0, 100)  ->  (x) -> { clamp x 0 100 }
*)


(* ─────────────────────────────────────────
   TRANSACTION
   ───────────────────────────────────────── *)

Transaction = '!' 'transaction' Block ;

(*
    Atomic STM transaction.
    Either completes fully or retries from the start.
    No partial state visible to other transactions.

    Ref inside transaction is automatically promoted to TRef.
    STM composes — transactions can call functions that
    are themselves transactional. Locks cannot do this.

    !transaction {
        from.balance <- !from.balance - amount;
        to.balance   <- !to.balance + amount
    }

    WHEN TO USE transaction vs on
    ─────────────────────────────
    transaction     coordinating shared mutable state
                    between concurrent operations
    on              reacting to a single source updating

    SYNCHRONISATION PRIMITIVES
    ──────────────────────────
    For cases transaction alone does not cover:

    Semaphore   bound concurrency, rate limiting
    Deferred    one-shot synchronisation between fibers
    Queue       bounded channel with backpressure

    All in STD.CONCURRENT.
*)


(* ─────────────────────────────────────────
   PATTERNS
   ───────────────────────────────────────── *)

Pattern     = '_'
            | Ident
            | TypeIdent Pattern*
            | Literal
            | '[' ']'
            | '[' Pattern (',' Pattern)* ']'
            | '[' Pattern ',' '...' Ident ']'
            | '{' Ident ':' Pattern (',' Ident ':' Pattern)* '}'
            | Pattern 'if' Expr
            ;


(* ─────────────────────────────────────────
   ATOMS
   ───────────────────────────────────────── *)

Atom        = Ident
            | Literal
            | '(' Expr ')'
            | Block
            ;


(* ─────────────────────────────────────────
   LITERALS
   ───────────────────────────────────────── *)

Literal     = Integer
            | Float
            | String
            | Bool
            | Array
            | Unit
            ;

Integer     = [0-9]+ ;
Float       = [0-9]+ '.' [0-9]+ ;
String      = '"' StringPart* '"' ;
StringPart  = [^"\\$]+
            | '\\' [nrtv0\\"]
            | '${' Expr '}'
            ;
Bool        = 'true' | 'false' ;
Array       = '[' (Expr (',' Expr)*)? ']' ;
Unit        = '()' ;

(*
    STRING INTERPOLATION
    ────────────────────
    ${} evaluates an expression and converts to String.
    Force works inside interpolation:

    "user: ${!getUser 42 .name}"

    ARRAY vs LIST
    ─────────────
    Array is the default collection — JS array, fast, indexable.
    [1, 2, 3] : Array Int

    List a (Cons/Nil) for recursive functional algorithms.
    Use when cons-cell semantics are needed:
    Cons 1 (Cons 2 (Cons 3 Nil)) : List Int

    Pattern matching on Array:
    match items {
      []           -> "empty"
      [x]          -> "one"
      [x, ...rest] -> "more"
    }

    Pattern matching on List:
    match myList {
      Nil        -> "empty"
      Cons x xs  -> "head and tail"
    }
*)


(* ─────────────────────────────────────────
   IDENTIFIERS
   ───────────────────────────────────────── *)

Ident       = [a-z] [a-zA-Z0-9]* ;
TypeIdent   = [A-Z] [a-zA-Z0-9]* ;

(*
    Case is load-bearing, not just convention:
    lowercase   value identifier or type variable
    uppercase   type name or constructor

    The parser uses this to distinguish type variables
    from concrete types without annotations.
*)


(* ─────────────────────────────────────────
   TYPES
   Ordered by decreasing binding priority.
   ───────────────────────────────────────── *)

Type        = TypeIdent Type+                                           (* application *)
            | Type '->' Type                                            (* function *)
            | TypeIdent                                                 (* concrete *)
            | '<' TypeParam (',' TypeParam)* '>' Type                  (* constrained *)
            | TypeVar                                                   (* variable *)
            | '{' Ident ':' Type (',' Ident ':' Type)* '}'            (* record *)
            | EffectRow                                                 (* effect row *)
            | '[' Type ']'                                              (* array *)
            | '(' Type (',' Type)+ ')'                                 (* tuple *)
            | '(' Type ')'                                              (* grouping *)
            | '(' ')'                                                   (* unit *)
            ;

TypeParam   = TypeVar
            | TypeVar ':' TypeIdent
            ;

EffectRow   = '{' '}'
            | '{' TypeIdent TypeVar* (',' TypeIdent TypeVar*)* '}'
            | '{' TypeIdent TypeVar* (',' TypeIdent TypeVar*)* '|' TypeVar '}'
            ;

TypeVar     = [a-z]+ ;

(*
    TYPE CONSTRAINTS
    ────────────────
    Angle bracket syntax for type variable constraints:

    id     : <a> a -> a
    double : <a : Numeric> a -> a
    map    : <a, b> (a -> b) -> List a -> List b
    filter : <a : Equal> (a -> Bool) -> List a -> List a

    EFFECT TYPE
    ───────────
    Effect A E R
        A   value produced
        E   error effects   (operations returning Nothing)
        R   dependencies    (operations returning values)

    Signal A E R
        Same as Effect at runtime.
        Documents that the computation is pure and lazy.

    Unit        successful completion, no meaningful value
    Nothing     cannot return — used for abort operations
    Ref A       mutable reference
    TRef A      mutable reference inside a transaction
    Fiber A E   background fiber handle

    EFFECT ROWS
    ───────────
    {}                          no effects
    { Console }                 single effect
    { Database, Console }       multiple effects
    { Database, Console | r }   open row, polymorphic over r

    Open rows enable effect-polymorphic functions:
    mapE : <a, b, e, r> (a -> Effect b e r) -> List a -> Effect (List b) e r

    TYPE INFERENCE
    ──────────────
    Full Hindley-Milner within blocks.
    Effect rows inferred from operations used in the body.
    Type variables implicitly universally quantified.
    Top-level annotations recommended for documentation
    and cross-module checking.

    PRELUDE TYPES
    ─────────────
    type Maybe a = Some a | None
    type Result a e = Ok a | Err e
    type List a = Cons a (List a) | Nil
    Array a     (built-in, JS array)

    TRAITS
    ──────
    Constraints restrict type variables.
    Prelude traits:

    Equal       ==
    Ord         < > <= >=   (implies Equal)
    Show        string representation
    Hash        for maps and sets   (implies Equal)
    Semigroup   ++ (append)
    Monoid      empty element + ++  (implies Semigroup)
    Functor     map over structure
    Foldable    fold, reduce, toList
*)


(* ─────────────────────────────────────────
   CONCURRENCY
   ───────────────────────────────────────── *)

(*
    Concurrency is stdlib, not syntax.
    All concurrency is explicit — no implicit parallelism.

    from STD.CONCURRENT import { all, race, fork }

    !all [e1, e2, ...]      concurrent, returns all results
    !race [e1, e2, ...]     concurrent, returns first result
    !fork expr              background fiber, returns Fiber handle

    all  : List (Effect a e r) -> Effect (List a) e r
    race : List (Effect a e r) -> Effect a e r
    fork : Effect a e r -> Effect (Fiber a e) {} {}

    Fibers are scoped to their parent — when a scope exits,
    child fibers are cancelled. No orphaned fibers.

    fiber = !fork longTask
    result = !fiber.join
    !fiber.interrupt
*)


(* ─────────────────────────────────────────
   TYPESCRIPT INTEROP
   ───────────────────────────────────────── *)

(*
    No explicit FFI syntax.
    The compiler inspects TypeScript declarations
    and resolves ! appropriately by return type:

    void | A                    direct call
    Promise<A>                  wrapped in Effect.promise
    Effect.Effect<A,E,R>        yield*

    Declare foreign functions with 'declare':

    declare console.log : String -> Effect Unit {} { Console }
    declare fetch : String -> Effect Response { Fail HttpError } { Http }

    TypeScript globals not explicitly declared fall back
    conservatively to Effect Unit {} {}.

    For raw Effect TS, use the escape hatch:
    result = gen { yield* someRawEffectTsFunction() }
*)


(* ─────────────────────────────────────────
   STANDARD LIBRARY
   @bang/std
   ───────────────────────────────────────── *)

(*
    STD.IO.CONSOLE      log, warn, error, read
    STD.IO.FILE         read, write, append, delete
    STD.HTTP            fetch, get, post, put, delete
    STD.JSON            parse, stringify
    STD.STREAM          MutSource, on
    STD.CONCURRENT      all, race, fork, timeout
                        Semaphore, Deferred, Queue
    STD.REF             make, get, set, update
    STD.STM             TRef
    STD.RESOURCE        Resource, with
*)


(* ─────────────────────────────────────────
   KEYWORDS
   ───────────────────────────────────────── *)

(*
    mut         type        declare
    from        import      export
    match       not         and
    or          xor         if
    true        false       transaction
    gen         on          use

    handle, catch, map, tap are dot methods on Effect, not keywords.
    all, race, fork are stdlib functions, not keywords.
    Nothing, Unit are type constructors, not keywords.
*)


(* ─────────────────────────────────────────
   FORMATTING
   ───────────────────────────────────────── *)

(*
    The formatter runs before the compiler.
    The parser accepts flexible input.
    The compiler only sees canonical form.
    Formatting twice is a no-op.

    CANONICAL RULES
    ───────────────
    1.  Semicolons after every Statement
    2.  Braces around all Block bodies
    3.  Named functions in sugared form: f x = { }
    4.  Anonymous lambdas in explicit form: (x) -> { }
    5.  Multi-param lambdas fully curried: (a) -> { (b) -> { } }
    6.  Chained mutations right-associated: a <- (b <- (c <- e))
    7.  Chained unifications: x = y = e
    8.  Imports use braces: from M import { f, g }
    9.  Imports sorted alphabetically
    10. Type annotations filled in where unambiguously inferable
    11. transaction always on its own line
    12. match arms each on their own line
    13. One operation per line in record type declarations
    14. Unit written as () in value position
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

    match e { p -> h }                  Match.value(e).pipe(
                                            Match.tag("P", (x) => h),
                                            Match.exhaustive)

    x -> { }                            (x) => Effect.gen(function* () { })
    a b -> { }                          (a) => (b) => Effect.gen(function* () { })

    !transaction { }                    yield* STM.commit(
                                            STM.gen(function* () { }))

    gen { ... }                         Effect.gen(function* () { ... })

    use x = f;                          yield* f((x) => Effect.gen(function* () {
    rest                                    rest
                                        }))

    on source handler                   yield* subscribeToRef(source, handler)

    -- Concurrency (standard library):
    !all [e1, e2]                       yield* Effect.all([e1, e2],
                                            { concurrency: 'unbounded' })
    !race [e1, e2]                      yield* Effect.race(e1, e2)
    !fork e                             yield* Effect.fork(e)

    declare f : A -> Effect B { r } E   // TypeScript declaration
                                        // resolved at ! call sites

    top-level !e                        Effect.runPromise(
                                            Effect.gen(function* () { ... }))

    -- Channel handling (composable via dot):
    e.handle { Db -> impl }             pipe(e, Effect.provide(
                                          Layer.succeed(Db, impl)))
    e.catch { NotFound _ -> x }         pipe(e, Effect.catchTag(
                                          "NotFound", (_) => x))
    e.map f                             pipe(e, Effect.map(f))
    e.tap f                             pipe(e, Effect.tap(f))

    from M import { f }                 import { f } from 'M'
    export { f }                        export { f }

    -- Newtypes (branded):
    type UserId = String                class UserId extends Schema.Class<UserId>("UserId")({
                                          value: Schema.String
                                        }) {}
    UserId "abc"                        new UserId({ value: "abc" })
    UserId.unwrap userId                userId.value

    -- Parameterised aliases:
    type Pair a b = (a, b)             type Pair<A, B> = [A, B]

    -- Algebraic data types:
    type Maybe a = Some a | None        const Maybe = Data.taggedEnum<...>()
                                        -- + Schema.Union of tagged structs
    Some 42                             Maybe.Some({ _0: 42 })
    None                                Maybe.None({})

    -- Record types (Schema-backed):
    type User = {                       class User extends Schema.Class<User>("User")({
      name: String,                       name: Schema.String,
      age: Int                            age: Schema.Int
    }                                   }) {}

    -- Generic functions:
    id : <a> a -> a                     const id = <A>(a: A): A => a
    map : <a, b> (a -> b) ->            const map = <A, B>(
        List a -> List b                  f: (a: A) => B, xs: List<A>
                                        ): List<B> => ...
*)
```
