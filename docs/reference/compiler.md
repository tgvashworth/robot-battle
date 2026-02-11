# Compiler Architecture

The RBL compiler transforms robot source code into WebAssembly binaries that run inside the simulation engine. The pipeline consists of five stages: lexing, parsing, semantic analysis, code generation, and WASM instantiation.

## Pipeline Overview

```
Source (.rbl)
    |
    v
  Lexer          src/compiler/lexer.ts
    |  Token[]
    v
  Parser         src/compiler/parser.ts
    |  Program (AST)
    v
  Analyzer       src/compiler/analyzer.ts
    |  AnalysisResult (typed AST + metadata)
    v
  Codegen        src/compiler/codegen.ts
    |  Uint8Array (WASM binary)
    v
  Instantiate    src/compiler/instantiate.ts
    |  RobotModule
    v
  Simulation     src/simulation/battle.ts
```

The `compile()` function in `src/compiler/instantiate.ts` orchestrates the first four stages. The `instantiate()` function takes the resulting WASM binary and produces a `RobotModule` that the simulation engine can drive.

If any stage produces errors, compilation halts and the errors are returned in a `CompileErrorList`. Parse errors prevent analysis; analysis errors prevent codegen.

## Lexer

**File:** `src/compiler/lexer.ts`

The lexer converts source text into a flat array of `Token` objects. Each token carries a `kind`, `value`, `line`, and `column`.

### Token Kinds

The lexer recognizes the following categories of tokens:

**Literals:** `Int`, `Float`, `String`, `True`, `False`

**Identifiers:** `Ident` -- any sequence of letters, digits, and underscores starting with a letter or underscore.

**Keywords:** `robot`, `var`, `const`, `func`, `on`, `if`, `else`, `for`, `while`, `switch`, `case`, `default`, `return`, `break`, `continue`, `type`, `struct`

**Type keywords:** `int`, `float`, `bool`, `angle` -- these are lexed as distinct token kinds (`IntType`, `FloatType`, `BoolType`, `AngleType`) to distinguish them from identifiers.

**Operators (two-character):**

| Token | Symbol |
|---|---|
| Walrus | `:=` |
| PlusAssign | `+=` |
| MinusAssign | `-=` |
| StarAssign | `*=` |
| SlashAssign | `/=` |
| Eq | `==` |
| NotEq | `!=` |
| LtEq | `<=` |
| GtEq | `>=` |
| And | `&&` |
| Or | `||` |
| Shl | `<<` |
| Shr | `>>` |

**Operators (single-character):** `+`, `-`, `*`, `/`, `%`, `=`, `<`, `>`, `!`, `&`, `|`, `^`

**Delimiters:** `(`, `)`, `{`, `}`, `[`, `]`, `,`, `.`, `:`, `;`

**Special:** `Newline`, `EOF`

### Lexing Rules

- Whitespace (spaces, tabs, carriage returns) is skipped. Newlines are emitted as `Newline` tokens because they serve as statement terminators.
- Line comments (`//`) consume everything to the next newline. There are no block comments.
- Numbers: a sequence of digits is an `Int`. If followed by `.` and more digits, it becomes a `Float`. There is no scientific notation.
- Strings: delimited by double quotes. Escape sequences: `\\`, `\"`, `\n`, `\t`.
- Identifiers and keywords: a sequence starting with `[a-zA-Z_]` and continuing with `[a-zA-Z0-9_]` is checked against the keyword table. If it matches a keyword, the corresponding keyword token kind is used; otherwise it is an `Ident`.
- Two-character operators are matched before single-character operators (greedy matching).

## Parser

**File:** `src/compiler/parser.ts`

The parser consumes the token array and produces a `Program` AST node. It is a hand-written recursive descent parser with Pratt parsing for expressions.

### AST Structure

The root `Program` node contains:

```typescript
interface Program {
    robotName: string
    consts: ConstDecl[]
    types: TypeDecl[]
    globals: VarDecl[]
    funcs: FuncDecl[]
    events: EventDecl[]
}
```

All AST nodes carry a `Span` with `line` and `column` for error reporting.

### Parsing Phases

**1. Pre-scan for type names:** Before parsing begins, the parser scans the token stream for `type Ident` sequences and records the identifier names. This allows the parser to disambiguate struct literals (`TypeName{ ... }`) from block statements when it encounters an identifier followed by `{`.

**2. Robot declaration:** The first non-newline tokens must be `robot "Name"`.

**3. Top-level declarations:** The parser loops over top-level tokens, dispatching on the leading keyword:

| Keyword | Production |
|---|---|
| `const` | `ConstDecl` -- `const NAME = expr` |
| `type` | `TypeDecl` -- `type Name struct { field1 Type1 \n field2 Type2 \n }` |
| `var` | `VarDecl` -- `var name Type [= expr]` |
| `func` | `FuncDecl` -- `func name(params) [returnType] { body }` |
| `on` | `EventDecl` -- `on name(params) { body }` |

**4. Statements:** Inside function and event bodies, the parser recognizes:

| Statement | Leading token(s) |
|---|---|
| `VarStmt` | `var` |
| `ShortDeclStmt` | `ident :=` |
| `AssignStmt` | `expr = expr` or `expr += expr` etc. |
| `IfStmt` | `if` |
| `ForStmt` | `for` or `while` |
| `SwitchStmt` | `switch` |
| `ReturnStmt` | `return` |
| `BreakStmt` | `break` |
| `ContinueStmt` | `continue` |
| `ExprStmt` | Any expression (typically a function call) |
| `Block` | `{` |

**5. Expressions:** The expression parser uses Pratt parsing (precedence climbing). It handles:

- Binary operators at 10 precedence levels (see Language Reference for the table)
- Unary prefix operators (`-`, `!`)
- Postfix operators: field access (`.`), array index (`[]`)
- Primary expressions: literals, identifiers, function calls, type conversions, struct literals, array literals, grouped expressions (`(expr)`)

### For Loop Disambiguation

The parser distinguishes three-part `for` loops from condition-only loops by scanning ahead for a semicolon before the opening `{`. This lookahead (`hasForSemicolon`) avoids backtracking.

### Error Recovery

When the parser encounters an unexpected token, it records an error and calls `recover()`, which skips tokens until it reaches a newline, closing brace, or top-level keyword. This allows the parser to continue and report multiple errors.

## Analyzer

**File:** `src/compiler/analyzer.ts`

The semantic analyzer performs type checking, scope resolution, and metadata collection in two passes over the AST. It produces an `AnalysisResult` containing all the information the code generator needs.

### AnalysisResult

```typescript
interface AnalysisResult {
    exprTypes: Map<Expr, ExprInfo>       // type and properties of every expression
    symbols: Map<string, SymbolInfo>     // global variable locations
    funcs: Map<string, FuncInfo>         // all function signatures (API + user)
    structs: Map<string, RBLType>        // struct type definitions
    consts: Map<string, ConstInfo>       // constant values
    globalMemorySize: number             // total bytes needed for globals
    errors: CompileErrorList
}
```

### Pass 1: Declaration Collection

The first pass walks top-level declarations and collects:

1. **Struct types:** Resolves field types and computes field offsets and sizes. Fields are laid out sequentially with no padding (all primitives are 4 bytes).

2. **Constants:** Evaluates constant expressions at compile time. Only integer literals, float literals, boolean literals, negation, and references to other constants are allowed.

3. **Global variables:** Assigns each global a byte offset in linear memory. The first 64 bytes are reserved for a return value slot. Globals are laid out sequentially starting at offset 64.

4. **Function signatures:** Records parameter types, return types, and whether the function is an import (API function) or user-defined.

5. **Event handlers:** Validates that the event name is one of the eight known events, and that the parameter count and types match the expected signature. Event handlers are stored with the WASM name `on_<eventName>`.

### Pass 2: Type Checking

The second pass type-checks function bodies, event handler bodies, and global variable initializers.

**Scope resolution:** The analyzer maintains a stack of local scopes. When looking up a name, it searches from the innermost scope outward to globals, then constants. Each scope is a `Map<string, SymbolInfo>`.

**Expression type checking** produces an `ExprInfo` for every expression node:

```typescript
interface ExprInfo {
    type: RBLType       // resolved type
    isLValue: boolean   // can this be assigned to?
    isConst: boolean    // compile-time constant?
    constValue?: number // the constant value, if known
}
```

Key type-checking rules:

- **Arithmetic:** Both operands must be the same numeric type, with special rules for angle (see Language Reference).
- **Comparison:** Equality (`==`, `!=`) works on any matching types. Ordering (`<`, `>`, `<=`, `>=`) requires matching numeric types.
- **Logical:** Operands must be `bool`.
- **Bitwise:** Operands must be `int`.
- **Function calls:** Argument count and types must exactly match the function signature.
- **Type conversions:** `int()`, `float()`, `angle()` accept exactly one numeric argument.
- **Short declarations:** The type is inferred from the right-hand expression. Multi-return destructuring (e.g., `a, b := f()`) is supported.

### API Registry

The analyzer pre-registers all standard library functions in a static `API_REGISTRY` table. Each entry specifies the function name, parameter types, and return types. These functions are marked with `isImport: true` and become WASM imports from the `env` module.

### Required Validation

After both passes, the analyzer validates that:

- A `tick()` function exists.
- `tick()` takes no parameters and returns no values.

### The `debug()` Overload

The analyzer handles `debug(value)` calls specially. It examines the argument type and dispatches to `debugInt`, `debugFloat`, or `debugAngle` accordingly. This is purely a compiler convenience; there is no runtime polymorphism.

## Code Generator

**File:** `src/compiler/codegen.ts`

The code generator takes the typed AST and `AnalysisResult` and produces a valid WASM binary as a `Uint8Array`.

### WASM Binary Structure

The generated binary contains these WASM sections in order:

| Section | ID | Contents |
|---|---|---|
| Type | 1 | Function type signatures (deduplicated) |
| Import | 2 | API functions imported from `env` module |
| Function | 3 | Type indices for local functions |
| Memory | 5 | Linear memory declaration (minimum pages) |
| Export | 7 | Exported functions and memory |
| Code | 10 | Function bodies |

The binary starts with the WASM magic number (`\0asm`) and version 1.

### Type Mapping

| RBL Type | WASM Type |
|---|---|
| `int` | `i32` |
| `bool` | `i32` |
| `float` | `f32` |
| `angle` | `f32` |

### Memory Layout

WASM provides two kinds of storage for values:

1. **Locals** -- per-function slots, like registers. Fast, accessed with `local.get`/`local.set`. Each has a fixed type (`i32` or `f32`). Cannot be dynamically indexed (there is no "get the i-th local" instruction where i is a runtime value).

2. **Linear memory** -- a flat byte array addressed by integer offsets, allocated in 64KB pages. Read/written with `i32.load`/`i32.store` (or `f32` variants) at byte offsets. Think of it as one big `ArrayBuffer`.

The key constraint driving the memory design: WASM locals cannot be dynamically indexed. If you have an array `arr[i]`, you can't compile that to "get the i-th local" because `i` is only known at runtime. So anything that needs dynamic indexing (arrays, and by extension structs since they share the same approach) must live in linear memory. Globals also must live in linear memory because WASM locals are scoped to a single function invocation and don't persist across calls.

#### The Memory Map

Linear memory is laid out as:

```
Byte 0                          64                      globalMemorySize         localMemoryOffset
  |                              |                           |                        |
  v                              v                           v                        v
  [-- Return Value Slot (64B) --][--- Global Variables ---]  [-- Local Composites --]  [-- 64KB spare --]
```

**Bytes 0-63: Return value slot.** Reserved for multi-return functions. When a function returns multiple values, they are written here.

**Bytes 64 onward: Global variables.** The analyzer assigns each global a byte offset sequentially starting at 64 (`analyzer.ts:166`). Every RBL primitive is 4 bytes (i32 or f32), so each scalar global takes 4 bytes. Structs take `4 * number_of_fields` bytes. The analyzer tracks the running total in `globalOffset`, which becomes `globalMemorySize` in the `AnalysisResult`.

**After globals: Local composite types.** When codegen encounters a local struct or array variable inside a function, `allocCompositeLocal()` (`codegen.ts:1808`) bump-allocates space after the globals. It creates a WASM local (`i32`) that holds the base address of that memory region. So a local struct with fields `x float` and `y float` gets 8 bytes of linear memory, plus one WASM local holding the integer address of those 8 bytes.

**Total size:** `globalMemorySize + localMemoryOffset + 65536`, rounded up to whole 64KB pages (`codegen.ts:2116`). The 64KB spare provides safety margin.

#### How Different Variable Types Compile

**Local scalar** (`var x int = 5` inside a function) -- uses WASM locals:

```wasm
i32.const 5
local.set $x        ;; $x is a WASM local index
```

**Global scalar** (`var health float = 100.0` at top level) -- uses linear memory at a fixed offset:

```wasm
;; Write (in init function):
i32.const 68         ;; memory address assigned by analyzer
f32.const 100.0
f32.store            ;; write to linear memory

;; Read (in tick or event handler):
i32.const 68
f32.load             ;; read from linear memory
```

See `compileGlobalLoad` at `codegen.ts:1084`.

**Local struct** (`var pos Vec2 = Vec2{x: 1.0, y: 2.0}` inside a function) -- bump-allocated linear memory with a base address local:

```wasm
;; Set base address local
i32.const 128        ;; bump-allocated address past globals
local.set $pos_base

;; Store field x at base+0
local.get $pos_base
f32.const 1.0
f32.store offset=0

;; Store field y at base+4
local.get $pos_base
f32.const 2.0
f32.store offset=4

;; Read field x later:
local.get $pos_base
f32.load offset=0
```

**Local array** (`var scores [3]int`) -- same approach as structs. Bump-allocated linear memory, base address in a local, elements accessed at `base + index * 4`. Bounds checks compile to:

```wasm
;; if (index < 0 || index >= length) { unreachable }
local.get $index
i32.const 3          ;; array length
i32.ge_s
if
  unreachable        ;; trap: kills this tick's WASM execution
end
```

#### Why No Garbage Collection or Freeing

The bump allocator for local composites never frees memory. This is correct because:

1. WASM linear memory persists for the module's lifetime.
2. Each robot gets a fresh WASM instance per battle.
3. Local composite addresses are fixed at compile time, not allocated dynamically at runtime.
4. There is no heap allocation in RBL -- all sizes are known statically.

### Function Compilation

Each user function and event handler is compiled to a WASM function:

1. **Parameters** are assigned WASM local indices starting at 0.
2. **Local variables** are allocated as additional WASM locals (or memory for composites) during body compilation.
3. **The body** is compiled to a sequence of WASM instructions.
4. **Local declarations** are grouped by type into the WASM code section entry format.

### Global Initialization

Global variables with initializers are compiled into an `init` function:

- If the user defines `init()`, the global initialization code is prepended to its body.
- If no user `init()` exists but globals have initializers, a synthetic `init` function is generated.

The `init` function is exported so the simulation engine can call it.

### Control Flow Compilation

**If/else:** Compiled to WASM `if`/`else`/`end` blocks.

**For loops:** Compiled to a nested block/loop structure:

```wasm
block $break
  loop $loop
    ;; condition check -> br_if $break
    block $continue
      ;; body
    end
    ;; post-statement
    br $loop
  end
end
```

`break` emits `br` targeting the `$break` block. `continue` emits `br` targeting the `$continue` block (which falls through to the post-statement).

**Switch:** Compiled as a `block` containing a chain of `if`/`end` blocks. Each case compares the tag value (stored in a temp local) against case values using equality. When a case matches, its body runs and then `br` exits the outer switch block.

**Short-circuit evaluation:** `&&` and `||` use `if`/`else` blocks to avoid evaluating the right-hand side when unnecessary.

### Expression Compilation

- **Literals:** `i32.const` for int/bool, `f32.const` for float/angle.
- **Variables:** `local.get` for locals, `i32.load`/`f32.load` from memory for globals.
- **Constants:** Inlined as literal values.
- **Binary ops:** Left operand, right operand, then the appropriate WASM opcode.
- **Unary ops:** `-` on int compiles as `i32.const 0; operand; i32.sub`. `-` on float uses `f32.neg`. `!` uses `i32.eqz`.
- **Function calls:** Arguments are pushed, then `call` with the function index.
- **Type conversions:** `i32.trunc_f32_s` (float/angle to int), `f32.convert_i32_s` (int to float/angle). float-to-angle and angle-to-float are no-ops (same WASM type).
- **Field access:** Computes base address + field offset, then loads.
- **Index access:** Computes base address + index * element size, with bounds checking (two `if`/`unreachable` blocks for `>= size` and `< 0`).

### Exports

The code generator exports:

- `memory` -- the linear memory instance.
- `tick` -- the main tick function.
- `init` -- the initialization function (if present).
- All event handlers as `on_<eventName>` (e.g., `on_scan`, `on_hit`).

Helper functions defined by the user are not exported; they are only callable internally.

## Instantiation

**File:** `src/compiler/instantiate.ts`

The `instantiate()` function takes a compiled WASM binary and produces a `RobotModule` that the simulation engine can drive.

### Process

1. **Compile:** `WebAssembly.compile(wasm)` produces a `WebAssembly.Module`.

2. **Build import object:** An import object is constructed with every API function forwarding to a mutable `api` reference. The reference starts as `null` and is set when `init()` is called. If any API function is called before `init()`, it throws.

3. **Instantiate:** `WebAssembly.instantiate(module, imports)` produces a `WebAssembly.Instance`.

4. **Wrap exports:** The WASM exports are wrapped in a `RobotModule` object:

```typescript
interface RobotModule {
    init(api: RobotAPI): void     // Sets the API ref, calls WASM init
    tick(): void                   // Calls WASM tick
    onScan(distance, bearing): void
    onScanned(bearing): void
    onHit(damage, bearing): void
    onBulletHit(targetId): void
    onWallHit(bearing): void
    onRobotHit(bearing): void
    onBulletMiss(): void
    onRobotDeath(robotId): void
    destroy(): void                // Releases the API ref
}
```

### WASM Trap Handling

All calls to WASM exports are wrapped in try/catch. If a WASM trap occurs (e.g., `unreachable` from bounds checks, stack overflow), the error is caught and logged. The robot skips that call but continues to function on subsequent ticks. Traps are recorded in the optional `RobotDebugLog`.

### Debug Log Integration

If a `RobotDebugLog` is provided during instantiation, the `debugInt`, `debugFloat`, and `debugAngle` import wrappers forward values to the debug log collector before calling through to the API. This captures debug output with tick numbers for diagnostics.

## Error Handling

**File:** `src/compiler/errors.ts`

All compilation errors are collected in a `CompileErrorList`. Each error has:

```typescript
interface CompileError {
    message: string
    line: number
    column: number
    phase: "tokenize" | "parse" | "analyze" | "codegen"
    hint?: string    // optional suggestion for fixing the error
}
```

Errors from each phase are accumulated and returned to the caller. The `compile()` function checks for errors after each phase and stops early if any are found (parse errors prevent analysis, analysis errors prevent codegen).

The `CompileError` class (in `instantiate.ts`) wraps a `CompileErrorList` as a throwable `Error` with a formatted message listing all errors with their line numbers.

## Debug Log

**File:** `src/compiler/debug-log.ts`

The `RobotDebugLog` interface collects diagnostic messages during simulation:

| Message Type | Fields | Source |
|---|---|---|
| `trap` | tick, functionName, error | WASM unreachable or stack overflow |
| `debug_int` | tick, value | `debugInt()` call |
| `debug_float` | tick, value | `debugFloat()` call |
| `debug_angle` | tick, value | `debugAngle()` call |
| `api_call` | tick, name, args, result | Optional API call tracing |

A debug log is created with `createDebugLog(getTick)`, where `getTick` returns the current tick number. The log is entirely opt-in and does not affect simulation behavior.
