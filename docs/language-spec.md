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
                | EffectDecl
                ;


(* ─────────────────────────────────────────
   DECLARATIONS
   ───────────────────────────────────────── *)

Declaration     = 'mut'? Ident '=' Expr
                | Ident ':' Type
                | 'comptime' Ident '=' Expr
                | 'type' TypeIdent TypeVar* '=' TypeBody
                | 'declare' QualifiedIdent ':' Type
                ;

QualifiedIdent  = Ident ('.' Ident)* ;

TypeBody        = Type                                  (* newtype / alias *)
                | '|' Constructor ('|' Constructor)*    (* algebraic data type *)
                ;

Constructor     = TypeIdent                             (* nullary *)
                | TypeIdent '{' Field (',' Field)* '}'  (* named fields *)
                | TypeIdent Type+                       (* positional *)
                ;

Field           = Ident ':' Type ;

(*
    TYPE DECLARATIONS
    ─────────────────

    'type' covers four cases:

    1. NEWTYPE (branded wrapper)
       type UserId = String
       type Name = String
       -- UserId ≠ Name ≠ String. All three are distinct types.

    2. PARAMETERISED ALIAS
       type Pair a b = (a, b)
       type Pairs a b = List (Pair a b)

    3. ALGEBRAIC DATA TYPE (sum type)
       type Maybe a
         | Some a
         | None

       type Result a e
         | Ok a
         | Err e

       type Shape
         | Circle { radius: Float }
         | Rectangle { width: Float, height: Float }
         | Point

       type List a
         | Cons a (List a)
         | Nil

    4. RECORD TYPE (product type, named fields)
       type User = {
         name: String,
         age: Int,
         email: String
       }

    GENERICS
    ────────
    Type variables are always lowercase. Concrete types
    are always uppercase (TypeIdent). This is how the
    parser distinguishes them — no ambiguity:

    a, b, e, r          type variables (lowercase)
    Int, String, Maybe   concrete types (uppercase)

    All type declarations can be parameterised:
    type Box a = { value: a }
    type Either a b
      | Left a
      | Right b

    Generic functions use implicit quantification:
    id : a -> a
    map : (a -> b) -> List a -> List b
    compose : (b -> c) -> (a -> b) -> (a -> c)

    Constraints restrict type variables:
    show : a -> String where a : Show
    compare : a -> a -> Int where a : Ord

    TYPE SYSTEM: NOMINAL vs STRUCTURAL
    ───────────────────────────────────
    'type' declarations create NOMINAL types.
    Two types with the same underlying representation
    are never automatically coerced. Coercion is always explicit.

    type UserId = String
    type Name = String
    -- UserId ≠ Name ≠ String. Coercion required:
    userId = UserId "abc"           -- wrap: String -> UserId
    raw = UserId.unwrap userId      -- unwrap: UserId -> String

    ADT constructors are functions:
    Some 42                         -- Some : a -> Maybe a
    Cons 1 (Cons 2 Nil)             -- Cons : a -> List a -> List a
    Circle { radius: 5.0 }          -- Circle : { radius: Float } -> Shape

    Anonymous types (records, tuples, functions, effects) are STRUCTURAL.
    Two anonymous types with the same shape are the same type:
    { name: String, age: Int } == { name: String, age: Int }
    (String -> Int) == (String -> Int)

    SCHEMA INTEGRATION
    ──────────────────
    Every 'type' declaration automatically derives a Schema.
    This gives every type, for free:

    - decode : String -> Effect T {} DecodeError
    - encode : T -> String
    - Equality and Hash (via Equal, Hash)
    - Arbitrary generation (for property testing)
    - JSON Schema derivation

    type User = {
      name: String,
      age: Int
    }
    -- User.decode, User.encode, User.schema all available
    -- User values support == via derived Equal
    -- Property tests get User.arbitrary for free

    type Shape
      | Circle { radius: Float }
      | Rectangle { width: Float, height: Float }
    -- Shape.decode handles tagged discrimination automatically
    -- Pattern matching on Shape is exhaustive

    Schema is not a library you import. It is the native
    type representation. Every Bang type IS a Schema.

    EQUALITY
    ────────
    == requires operands of the same type.
    Cross-type comparison is a type error:
    userId == name                  -- TYPE ERROR: UserId ≠ Name
    userId1 == userId2              -- OK: same type, derived Equal

    Value equality is derived automatically from the Schema.
    Custom equality can override via the Equal trait.
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

    Expr : Effect A E R   ->  yield* Expr
    Expr : Promise A      ->  yield* Effect.promise(() => Expr)
    Expr : () -> A        ->  yield* Effect.sync(() => Expr())
    Expr : A              ->  Expr  (no-op, plain value)

    TypeScript interop:
    The compiler inspects the TypeScript declaration of any
    identifier and resolves force appropriately.
    No explicit FFI syntax required.

    declare console.log : String -> Effect Unit {} { Console }
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
   EFFECT INTERFACES
   ───────────────────────────────────────── *)

EffectDecl      = 'effect' TypeIdent TypeVar* '{' Operation+ '}' ;

Operation       = Ident ':' Type ;

HandlerBody     = '{' HandlerArm (',' HandlerArm)* '}' ;

HandlerArm      = TypeIdent '->' Expr ;

(*
    EFFECT INTERFACES
    ─────────────────
    An effect declares a set of operations. A handler provides
    implementations. All handling is explicit — no implicit
    resolution, no default implementations.

    Errors, dependencies, and side effects are all algebraic
    effects in a single effect row. The difference is how
    the handler behaves:
    - Handler resumes with a value  → dependency / service
    - Handler aborts                → error
    - Handler transforms and resumes → middleware / interceptor

    DECLARING EFFECTS
    ─────────────────
    effect Console {
      log   : String -> Unit
      error : String -> Unit
    }

    effect Database {
      query  : String -> List Row
      insert : Row -> Unit
    }

    Errors are effects whose operations return Nothing:
    effect Fail e {
      fail : e -> Nothing
    }

    Effects can be parameterised:
    effect Cache k v {
      get : k -> Maybe v
      set : k -> v -> Unit
    }

    PROVIDING IMPLEMENTATIONS
    ─────────────────────────
    Implementations are values. Create them, export them,
    pass them around:

    consoleNode : Console = {
      log   = (msg) -> { !js.console.log msg },
      error = (msg) -> { !js.console.error msg }
    }

    pgDatabase : Database = {
      query  = (sql) -> { !pg.rawQuery sql },
      insert = (row) -> { !pg.insertRow row }
    }

    mockDatabase : Database = {
      query  = (sql) -> { [] },
      insert = (row) -> { () }
    }

    Implementations are first-class values. Export them
    alongside the effect declaration:
    export { Database, pgDatabase }

    USING EFFECTS
    ─────────────
    Using an operation adds the effect to the appropriate
    channel. The compiler infers both E and R from the body —
    explicit type annotation is optional:

    -- Explicit annotation:
    getUser : Int -> Effect User { Fail NotFoundError } { Database }

    -- Or just write the function. Compiler infers E and R:
    getUser = (id) -> {
      rows = !Database.query id         -- adds Database to R
      match rows {
        Cons user _ -> user
        Nil         -> !Fail.fail (NotFound id)  -- adds Fail NotFoundError to E
      }
    }

    HANDLING CHANNELS
    ─────────────────
    All three channels (A, E, R) are handled via composable
    methods on Effect using dot syntax:

    .handle { ... }     provides dependencies  (eliminates from R)
    .catch  { ... }     recovers from errors   (eliminates from E)
    .map    (x) -> expr transforms the value   (transforms A)

    These compose left-to-right via the dot operator:

    result = getUser 42
      .handle { Database -> pgDatabase }
      .catch { NotFound _ -> defaultUser }
      .map (user) -> { user.name }

    !Console.log result

    HANDLING DEPENDENCIES (.handle)
    ───────────────────────────────
    .handle provides implementations and eliminates from R:

    getUser 42
      .handle { Database -> pgDatabase }

    Multiple dependencies:
    myApp
      .handle {
        Database -> pgDatabase,
        Console  -> consoleNode
      }

    Inline implementations:
    myApp
      .handle {
        Database -> {
          query  = (sql) -> { !pg.query sql },
          insert = (row) -> { !pg.insert row }
        }
      }

    HANDLING ERRORS (.catch)
    ────────────────────────
    .catch recovers from errors and eliminates from E:

    getUser 42
      .catch { NotFound _ -> defaultUser }

    Partial catch (only handles some errors):
    getUser 42
      .catch { NotFound _ -> defaultUser }
    -- DbError still in E, NotFoundError eliminated

    TRANSFORMING VALUES (.map)
    ──────────────────────────
    .map transforms the success value:

    getUser 42
      .map (user) -> { user.name }

    FULL COMPOSITION
    ────────────────
    All handlers chain naturally. ! forces the final result:

    !getUser 42
      .handle { Database -> pgDatabase }
      .catch { NotFound _ -> defaultUser }
      .map (user) -> { user.name }

    Without !, you're building a description of the computation.
    ! at the start of a statement forces it.

    EFFECT PROPAGATION
    ──────────────────
    Effects compose through the call graph. Calling a
    function that uses effects adds them to yours:

    getUserAndLog = (id) -> {
      user = !getUser id          -- adds Database to R, Fail NotFoundError to E
      !Console.log user.name      -- adds Console to R
      user
    }
    -- Inferred: Effect User { Fail NotFoundError } { Database, Console }

    TESTING
    ───────
    Swap implementations by passing different handlers:

    testGetUser = {
      result = !getUser 42
        .handle { Database -> mockDatabase }
        .catch { NotFound _ -> None }
      !assert (result.name == "test user")
    }

    No special testing infrastructure needed.
    Mock is just another implementation value.

    COMPILATION TO EFFECT TS
    ────────────────────────
    The compiler lowers effects based on their operations:

    Operations returning values → Effect service (R parameter):
    effect Database {                   class Database extends
      query : String -> List Row          Context.Tag("Database")<Database, {
    }                                       readonly query: (sql: string)
                                              => Effect<List<Row>>
                                          }>() {}

    Operations returning Nothing → Tagged error (E parameter):
    effect Fail e {                     class NotFoundError extends
      fail : e -> Nothing                 Data.TaggedError("NotFoundError")<{
    }                                       ...}>() {}

    Implementations → Layer:
    pgDatabase : Database = { ... }     const pgDatabase = {
                                          query: (sql) => ...
                                        }

    Channel handlers compile to:
    .handle { Database -> pgDatabase }  pipe(expr, Effect.provide(
                                          Layer.succeed(Database, pgDatabase)))
    .catch { NotFound _ -> default }    pipe(expr, Effect.catchTag(
                                          "NotFound", (_) => default))
    .map (x) -> { x.name }             pipe(expr, Effect.map(
                                          (x) => x.name))

    PRELUDE EFFECTS
    ───────────────
    These are defined in @bang/std with standard implementations:

    effect Console {                consoleNode   : Console
      log   : String -> Unit
      error : String -> Unit
      warn  : String -> Unit
    }

    effect FileSystem {             fsNode        : FileSystem
      read   : String -> String
      write  : String -> String -> Unit
      delete : String -> Unit
    }

    effect Http {                   httpNode      : Http
      fetch : String -> Response
    }

    effect Fail e {                 -- generic error effect
      fail : e -> Nothing           -- parameterised by error ADT
    }

    effect Random {                 randomDefault : Random
      next     : Unit -> Float
      nextInt  : Int -> Int
    }

    effect Clock {                  clockDefault  : Clock
      now : Unit -> DateTime
    }

    Import the effect and its implementation:
    from STD.IO.CONSOLE import { Console, consoleNode }
    from STD.HTTP import { Http, httpNode }
*)


(* ─────────────────────────────────────────
   IMPORTS AND EXPORTS
   ───────────────────────────────────────── *)

Import          = 'from' ModulePath 'import' '{' Ident (',' Ident)* '}' ;

Export          = 'export' '{' Ident (',' Ident)* '}' ;

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
                | '-' Expr                          (* unary minus *)
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

    ADT MATCHING
    ────────────
    match shape {
      Circle c     -> !console.log c.radius
      Rectangle r  -> !console.log (r.width * r.height)
      Point        -> !console.log "point"
    }

    Nested patterns:
    match result {
      Ok (Some value) -> value
      Ok None         -> defaultValue
      Err e           -> !handleError e
    }

    Compiles to tag-checked switch with exhaustiveness
    verified at compile time. Uses the Schema-derived
    _tag field on each constructor.

    For Effect error channel matching:
    yield* Effect.matchEffect(expr, {
        onSuccess: (a) => handler,
        onFailure: (e) => handler
    })
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
    all : List (Effect A E R) -> Effect (List A) E R
    Compiles to:
    yield* Effect.all([e1, e2, ...], { concurrency: 'unbounded' })

    !race [e1, e2, ...]
    Force concurrently. Returns first result, cancels rest.
    race : List (Effect A E R) -> Effect A E R
    Compiles to:
    yield* Effect.race(e1, e2, ...)

    !fork e
    Fork into background fiber. Returns Fiber handle.
    fork : Effect A E R -> Effect (Fiber A E) {} {}
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
String          = '"' StringPart* '"' ;
StringPart      = [^"\\$]+                      (* plain text *)
                | '\\' [nrtv0\\"]               (* escape sequence *)
                | '${' Expr '}'                 (* interpolation *)
                ;
Bool            = 'true' | 'false' ;
List            = '[' (Expr (',' Expr)*)? ']' ;

(*
    STRING INTERPOLATION
    ────────────────────
    Expressions inside ${} are evaluated and converted to String.
    Force (!) works inside interpolation:

    name = "world"
    greeting = "hello ${name}"              -- "hello world"
    msg = "user: ${!getUser 42 .name}"      -- forces effect, accesses field

    Escape sequences (same as JS):
    \n   newline
    \r   carriage return
    \t   tab
    \v   vertical tab
    \0   null
    \\   backslash
    \"   double quote

    Interpolation compiles to template literals in Effect TS:
    "hello ${name}" → `hello ${name}`
*)
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
                | EffectRow                                                     (* effect row *)
                | '[' Type ']'                                                  (* list *)
                | '(' Type (',' Type)+ ')'                                     (* tuple *)
                | '(' Type ')'                                                  (* grouping *)
                | '(' ')'                                                       (* unit *)
                ;

EffectRow       = '{' '}'                                                       (* empty row *)
                | '{' TypeIdent TypeVar* (',' TypeIdent TypeVar*)* '}'         (* closed row *)
                | '{' TypeIdent TypeVar* (',' TypeIdent TypeVar*)* '|' TypeVar '}' (* open row *)
                ;

TypeVar         = [a-z]+ ;

Constraint      = TypeVar ':' TypeIdent ;

(*
    BUILT-IN TYPE CONSTRUCTORS
    ──────────────────────────

    EFFECT TYPE
    ───────────
    Effect A E R
        A   value type
        E   error effects (operations returning Nothing)
        R   dependency effects (operations returning values)

    Both E and R are algebraic effects declared with 'effect'.
    The compiler separates them based on operation return types.
    The unified handle operator works on both channels.

    getUser : Int -> Effect User { Fail NotFoundError } { Database }
    --                       A    E                      R

    Explicit type annotation is optional. The compiler
    infers E and R from operations used in the body.

    Signal A E R
        Pure reactive computation with the same structure.
        Compiler infers Signal when body contains no !.
        Signal and Effect compile to the same Effect.Effect<A,E,R>
        but Signal documents purity intent.

    Ref A           mutable reference  (plain context)
    TRef A          mutable reference  (transaction context)
    Unit            absence of value  ()

    ERROR EFFECTS (E)
    ─────────────────
    Effects whose operations return Nothing.
    Propagate automatically through the call graph:

    {}                              no errors (infallible)
    { Fail NotFoundError }          single error
    { Fail DbError, Fail AuthError } multiple errors

    DEPENDENCY EFFECTS (R)
    ──────────────────────
    Effects whose operations return values.
    Must be explicitly handled:

    {}                              no dependencies (pure)
    { Console }                     single dependency
    { Database, Console }           multiple dependencies
    { Database, Console | r }       open row (polymorphic)

    Open rows enable effect polymorphism:
    mapE : (a -> Effect b e r) -> List a -> Effect (List b) e r

    PRELUDE TYPES (defined as ADTs in @bang/std)
    ─────────────
    type Maybe a
      | Some a
      | None

    type Result a e
      | Ok a
      | Err e

    type List a
      | Cons a (List a)
      | Nil

    Schema-backed: decode/encode/equality/arbitrary for free.

    RESOURCE TYPES
    ──────────────
    Preferred over defer for structured cleanup.

    Resource A = {
        value   : A,
        cleanup : Effect Unit {} {}
    }

    withX : (Resource X -> Effect A {} { x }) -> Effect A {} {}

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
    Effect rows are inferred from operations used in the body.

    MUST-HANDLE
    ───────────
    Any expression of type Effect A E R or Result A E
    appearing in statement position without force
    is a type error.

    Unhandled dependencies (non-empty R) at the top-level !
    boundary is a compile error. All dependency effects
    must be handled before Effect.runPromise.
    Unhandled errors (non-empty E) at the top-level are
    a warning — they become runtime defects if not caught.
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

    declare console.log : String -> Effect Unit {} { Console }
    declare fetch : String -> Effect Response { Fail HttpError } { Http }

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
    transaction     scoped          effect

    Note: handle, catch, map are methods on Effect via dot
    syntax, not keywords. race, fork, all are standard library
    functions. Console, Database, etc. are effect names (TypeIdent).
    not keywords.
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

    -- Channel handling (composable via dot):
    e.handle { Db -> impl }             pipe(e, Effect.provide(
                                          Layer.succeed(Db, impl)))
    e.catch { NotFound _ -> x }         pipe(e, Effect.catchTag(
                                          "NotFound", (_) => x))
    e.map (x) -> { x.name }            pipe(e, Effect.map(
                                          (x) => x.name))

    from M import { f }                 import { f } from 'M'
    export { f }                        export { f }

    -- Newtypes (branded):
    type UserId = String                class UserId extends Schema.Class<UserId>("UserId")({
                                          value: Schema.String
                                        }) {}
    UserId "abc"                        new UserId({ value: "abc" })
    UserId.unwrap userId                userId.value

    -- Parameterised aliases:
    type Pair A B = (A, B)             type Pair<A, B> = [A, B]

    -- Algebraic data types:
    type Maybe a                        const Maybe = Data.taggedEnum<...>()
      | Some A                          -- + Schema.Union of tagged structs
      | None
    Some 42                             Maybe.Some({ _0: 42 })
    None                                Maybe.None({})

    -- Record types (Schema-backed):
    type User = {                       class User extends Schema.Class<User>("User")({
      name: String,                       name: Schema.String,
      age: Int                            age: Schema.Int
    }                                   }) {}
    -- User.decode, User.encode, User.schema auto-derived

    -- Generic functions:
    id : a -> a                         const id = <A>(a: A): A => a
    map : (a -> b) -> List a            const map = <A, B>(
        -> List b                         f: (a: A) => B, xs: List<A>
                                        ): List<B> => ...
*)
```
