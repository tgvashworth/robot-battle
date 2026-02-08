# Building a Browser-Based Compiler: Custom C-Like Language to WebAssembly

## Project Context

Robot Battle is a game where players write robots in a custom C-like imperative language.
The compiler must:

- Run entirely in the browser (no server-side compilation)
- Accept source code as input
- Produce WASM modules that can be instantiated and executed each game tick
- Sandbox robot code so it cannot escape its memory or hang the game

This document covers the full technical landscape: parser options, WASM code
generation, language design, the compilation pipeline, existing precedents,
the robot API, performance, and sandboxing.

---

## 1. Parsing in TypeScript

### 1.1 Parser Generator Libraries

There are several mature parser generator libraries that work in TypeScript/JavaScript
and can run in the browser.

#### Chevrotain

- **npm**: `chevrotain`
- **Repository**: https://github.com/Chevrotain/chevrotain
- **Approach**: You define tokens and grammar rules directly in TypeScript code (no
  separate grammar file). It is an embedded DSL rather than a code generator.
- **Algorithm**: LL(k) recursive descent with backtracking support.
- **TypeScript support**: Written in TypeScript natively. Full type safety.
- **Performance**: Consistently the fastest JS parser library in benchmarks. No
  code generation step means no build-time overhead.
- **Error recovery**: Built-in error recovery and reporting.
- **Output**: Produces a Concrete Syntax Tree (CST) by default, with a visitor API
  to transform it into an AST.

```typescript
import { CstParser, Lexer, createToken } from "chevrotain";

const Int = createToken({ name: "Int", pattern: /int/ });
const Identifier = createToken({ name: "Identifier", pattern: /[a-zA-Z_]\w*/ });
const IntegerLiteral = createToken({ name: "IntegerLiteral", pattern: /\d+/ });
const Semicolon = createToken({ name: "Semicolon", pattern: /;/ });
const Equals = createToken({ name: "Equals", pattern: /=/ });
const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

const allTokens = [WhiteSpace, Int, Identifier, IntegerLiteral, Semicolon, Equals];
const RobotLexer = new Lexer(allTokens);

class RobotParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  public varDecl = this.RULE("varDecl", () => {
    this.CONSUME(Int);
    this.CONSUME(Identifier);
    this.CONSUME(Equals);
    this.SUBRULE(this.expression);
    this.CONSUME(Semicolon);
  });

  public expression = this.RULE("expression", () => {
    this.OR([
      { ALT: () => this.CONSUME(IntegerLiteral) },
      { ALT: () => this.CONSUME(Identifier) },
    ]);
  });
}
```

#### Peggy (successor to PEG.js)

- **npm**: `peggy` (with `ts-pegjs` plugin for TypeScript output)
- **Repository**: https://github.com/peggyjs/peggy
- **Approach**: Write a PEG grammar file; Peggy generates a parser module.
- **Algorithm**: Packrat parsing (PEG). Deterministic, no ambiguity.
- **TypeScript support**: Via `ts-pegjs` plugin or `tsPEG` (separate project).
- **Performance**: Good for typical grammar sizes. Memoization prevents exponential
  backtracking but costs memory.
- **Error reporting**: Decent, though less customizable than Chevrotain.
- **Consideration**: Requires a build step to generate parser code from the grammar.

```
// robot.pegjs
Program = statements:Statement* { return { type: "Program", body: statements }; }

Statement
  = VarDecl / ExpressionStatement / WhileStatement / IfStatement

VarDecl
  = "int" _ name:Identifier _ "=" _ value:Expression ";" _
    { return { type: "VarDecl", name, valueType: "i32", value }; }

Expression
  = left:Term _ "+" _ right:Expression
    { return { type: "BinaryExpr", op: "+", left, right }; }
  / Term

Term = IntegerLiteral / Identifier
```

#### Ohm

- **npm**: `ohm-js`
- **Repository**: https://ohmjs.org/
- **Approach**: Grammars are written in Ohm's notation, separate from semantic actions.
  Clean separation of syntax from semantics.
- **Algorithm**: PEG-based with extensions (supports left recursion).
- **TypeScript support**: Has TypeScript definitions. The grammar is a string, with
  typed semantic actions.
- **Unique strength**: Interactive grammar editor/visualizer for development. Grammars
  are cleanly separated from actions, making iteration fast.
- **Consideration**: Slightly less performant than Chevrotain. The separation of
  grammar and actions is elegant but means two pieces to maintain.

#### Nearley

- **npm**: `nearley`
- **Repository**: https://nearley.js.org/
- **Approach**: Earley parser generator. Write grammar in a `.ne` file.
- **Algorithm**: Earley parsing. Can handle ambiguous and left-recursive grammars.
- **TypeScript support**: Type definitions available. Grammar compiled at build time.
- **Consideration**: Earley parsing is more powerful than PEG (handles ambiguous
  grammars) but slower. Overkill for a C-like language which has an unambiguous
  grammar.

#### Tree-sitter (via WASM)

- **npm**: `web-tree-sitter`
- **Approach**: Write grammar in Tree-sitter's JS DSL. The parser is compiled to
  WASM and loaded in the browser.
- **Strengths**: Incremental parsing (extremely fast re-parsing after edits).
  Battle-tested on production editors (VS Code, Zed, Neovim).
- **Consideration**: Designed for syntax highlighting and code analysis, not
  compilation. Building a custom grammar requires compiling a C library to WASM.
  Heavy for our use case. Better suited for an editor integration layer than the
  compiler itself.

### 1.2 Hand-Written Recursive Descent vs. Parser Generators

| Factor | Hand-Written RD | Parser Generator |
|--------|----------------|-----------------|
| Error messages | Excellent (full control) | Good (varies by tool) |
| Performance | Excellent | Good to excellent |
| Development speed | Slower initially | Faster for grammar iteration |
| Maintenance | Grammar changes = code changes | Grammar changes = grammar file changes |
| Dependencies | None | Runtime library |
| Debugging | Standard debugger | Need to understand generated code |
| Precedence handling | Pratt parsing or precedence climbing | Declarative in grammar |
| Bundle size | Minimal | Adds library weight |

Major production compilers use hand-written recursive descent: GCC, Clang, V8's JS
parser, the Go compiler, and the TypeScript compiler itself. The reason is maximum
control over error recovery, incremental parsing, and performance.

### 1.3 Recommendation for Robot Battle

**Use Chevrotain** or **hand-written recursive descent**.

Rationale:
- **Chevrotain** gives the speed of a hand-written parser with the maintainability of
  a grammar definition. No build step. Full TypeScript types. Best-in-class
  performance among JS parser libraries. The grammar is defined in code, so you can
  debug it with standard tools.
- **Hand-written recursive descent** is the other strong option. For a C-like language,
  the grammar is well-understood. A Pratt parser handles operator precedence elegantly.
  Zero dependencies. Maximum control over error messages, which matters for a game
  where beginners will write code.

For a C-like language with operator precedence, `if`/`else`, `while`/`for` loops,
function declarations, and struct-like types, both approaches are well-proven.
Chevrotain gets you there faster; hand-written gives you more control.

Avoid Nearley (overkill), Tree-sitter (wrong abstraction layer), and consider Peggy
or Ohm only if rapid grammar prototyping is the priority.

---

## 2. WASM Code Generation from TypeScript

### 2.1 Binaryen.js (Recommended)

- **npm**: `binaryen`
- **Repository**: https://github.com/AssemblyScript/binaryen.js
- **Size**: ~5 MB (it is the full Binaryen C++ library compiled to WASM/JS)
- **What it is**: The Binaryen compiler infrastructure, compiled to JavaScript. It
  provides a complete API for building, optimizing, and emitting WASM modules.

Binaryen.js is the most practical choice. It is what AssemblyScript uses internally.
It gives you:

1. **A typed IR** that maps closely to WASM but with higher-level constructs
2. **A full optimization pipeline** (dead code elimination, constant folding, local
   optimization, etc.)
3. **Validation** (checks your module is valid WASM before emitting)
4. **Binary emission** (produces `.wasm` bytes directly)
5. **Text emission** (produces `.wat` for debugging)

#### Core API Patterns

```typescript
import binaryen from "binaryen";

// Create a new module
const mod = new binaryen.Module();

// Set up linear memory: 1 page initial, 256 pages max (16 MB)
mod.setMemory(1, 256, "memory");

// Define a function type and add a function
const params = binaryen.createType([binaryen.i32, binaryen.i32]);
const results = binaryen.i32;
const vars = [binaryen.i32]; // one local variable

mod.addFunction(
  "add",
  params,
  results,
  vars,
  // Function body: return param0 + param1
  mod.i32.add(
    mod.local.get(0, binaryen.i32),
    mod.local.get(1, binaryen.i32)
  )
);

mod.addFunctionExport("add", "add");
```

#### Control Flow

```typescript
// If/else
mod.if(
  mod.i32.gt_s(
    mod.local.get(0, binaryen.i32),
    mod.i32.const(0)
  ),
  // then
  mod.call("fire", [], binaryen.none),
  // else
  mod.call("move", [mod.i32.const(1)], binaryen.none)
);

// While loop (block + loop + br_if pattern)
mod.block("break_label", [
  mod.loop("continue_label",
    mod.block(null, [
      // break if condition is false
      mod.br("break_label",
        mod.i32.eqz(mod.local.get(0, binaryen.i32))
      ),
      // loop body
      mod.call("move", [mod.i32.const(1)], binaryen.none),
      // decrement counter
      mod.local.set(0,
        mod.i32.sub(
          mod.local.get(0, binaryen.i32),
          mod.i32.const(1)
        )
      ),
      // branch back to loop start
      mod.br("continue_label"),
    ])
  )
]);
```

#### Imports and Exports

```typescript
// Import a host function: env.fire(direction: i32) -> void
mod.addFunctionImport(
  "fire",          // internal name
  "env",           // import module
  "fire",          // import name
  binaryen.createType([binaryen.i32]),  // params
  binaryen.none    // return type
);

// Import a host function: env.scan() -> i32
mod.addFunctionImport(
  "scan",
  "env",
  "scan",
  binaryen.none,
  binaryen.i32
);

// Export the robot's tick function
mod.addFunctionExport("tick", "tick");

// Export memory so host can inspect it
mod.addMemoryExport("0", "memory");
```

#### Validation, Optimization, and Emission

```typescript
// Validate the module
if (!mod.validate()) {
  throw new Error("Invalid WASM module");
}

// Optimize (uses Binaryen's full optimization pipeline)
binaryen.setOptimizeLevel(2);   // -O2
binaryen.setShrinkLevel(1);     // -Os
mod.optimize();

// Emit binary
const wasmBinary: Uint8Array = mod.emitBinary();

// Emit text for debugging
const watText: string = mod.emitText();

// IMPORTANT: free C++ memory when done
mod.dispose();
```

#### Instantiation

```typescript
const wasmModule = new WebAssembly.Module(wasmBinary);
const instance = new WebAssembly.Instance(wasmModule, {
  env: {
    fire: (direction: number) => { /* game engine call */ },
    scan: () => { /* return scan result */ return 0; },
    move: (direction: number) => { /* move robot */ },
  }
});

// Call the robot's tick function
(instance.exports.tick as Function)();
```

### 2.2 wabt.js (WebAssembly Binary Toolkit)

- **npm**: `wabt`
- **Repository**: https://github.com/AssemblyScript/wabt.js

wabt.js provides `wat2wasm` conversion: you generate WAT (WebAssembly Text Format)
as a string, then convert it to binary.

```typescript
import wabt from "wabt";

const wabtModule = await wabt();

const watSource = `
(module
  (func $add (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add
  )
  (export "add" (func $add))
)`;

const parsed = wabtModule.parseWat("robot.wat", watSource);
parsed.resolveNames();
parsed.validate();
const { buffer } = parsed.toBinary({});
// buffer is a Uint8Array containing .wasm bytes
```

**When to use wabt.js**:
- Prototyping: generating WAT strings is easier to read/debug than building an IR.
- As a debugging tool alongside Binaryen (generate WAT, inspect it, convert).

**Downsides**:
- String concatenation for code generation is error-prone.
- No optimization pipeline (unlike Binaryen).
- String-based codegen is slower than direct IR construction.

### 2.3 Writing Raw WASM Binary Manually

You can emit WASM binary bytes directly from TypeScript. The binary format is
well-specified and not terribly complex for simple modules.

```typescript
// WASM binary starts with magic number and version
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d]; // \0asm
const WASM_VERSION = [0x01, 0x00, 0x00, 0x00]; // version 1

// LEB128 encoding for integers
function encodeULEB128(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function encodeSLEB128(value: number): number[] {
  const bytes: number[] = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    if ((value === 0 && (byte & 0x40) === 0) ||
        (value === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

// Section IDs
const SECTION_TYPE = 0x01;
const SECTION_IMPORT = 0x02;
const SECTION_FUNCTION = 0x03;
const SECTION_MEMORY = 0x05;
const SECTION_EXPORT = 0x07;
const SECTION_CODE = 0x0a;

// Type constants
const TYPE_I32 = 0x7f;
const TYPE_FUNC = 0x60;

// Opcodes
const OP_LOCAL_GET = 0x20;
const OP_I32_ADD = 0x6a;
const OP_END = 0x0b;
```

**When to use raw binary emission**:
- You want zero dependencies (no 5 MB Binaryen bundle).
- You need the smallest possible compiler footprint.
- The language is simple enough that you do not need Binaryen's optimizer.

**Downsides**:
- You must implement every WASM encoding detail yourself.
- No validation unless you write your own.
- No optimization passes.
- High surface area for bugs (wrong LEB128, wrong section ordering, etc.).

The chasm project (see Section 5) takes this approach and shows it is viable for
a small language.

### 2.4 Comparison Summary

| Library | Bundle Size | Optimization | Difficulty | Best For |
|---------|-------------|-------------|------------|----------|
| binaryen.js | ~5 MB | Full pipeline | Medium | Production compilers |
| wabt.js | ~2 MB | None | Low | Prototyping, debugging |
| Raw binary | 0 KB | None (DIY) | High | Minimal footprint |

**Recommendation**: Use **binaryen.js**. The 5 MB bundle is acceptable for a game
that will also load game assets. The optimization pipeline and validation alone are
worth it. AssemblyScript proves this works at scale.

---

## 3. Language Design Considerations for WASM Targeting

### 3.1 Data Types

WASM natively supports four value types:

| WASM Type | Size | Use |
|-----------|------|-----|
| `i32` | 32-bit integer | General purpose, booleans, pointers |
| `i64` | 64-bit integer | Large integers (less common) |
| `f32` | 32-bit float | Fast floating point |
| `f64` | 64-bit float | Precise floating point |

**Recommended type mapping for the robot language**:

```
int     -> i32    (32-bit signed integer)
float   -> f32    (32-bit float, enough for game math)
bool    -> i32    (0 = false, nonzero = true, like C)
void    -> none
```

Keeping to `i32` and `f32` simplifies the compiler and is sufficient for a robot
game. Avoid `i64` and `f64` unless there is a concrete need (game coordinates and
health values fit comfortably in 32 bits).

### 3.2 Function Calls and the WASM Call Stack

WASM has a proper call stack with function frames. Function calls work naturally:

- Direct calls: `call $function_index` -- fast, statically resolved.
- Indirect calls: `call_indirect` via a function table -- needed for function
  pointers or dynamic dispatch.

For a C-like language, direct calls are sufficient. Every function the user defines
maps to a WASM function. There is no need for closures or dynamic dispatch.

```
// Robot language
int max(int a, int b) {
  if (a > b) return a;
  return b;
}

// Compiles to WASM (conceptual WAT)
(func $max (param $a i32) (param $b i32) (result i32)
  (if (result i32) (i32.gt_s (local.get $a) (local.get $b))
    (then (local.get $a))
    (else (local.get $b))
  )
)
```

**Stack depth**: WASM engines have implementation-defined stack depth limits
(typically thousands of frames). For a robot game, this is not a practical concern
unless the language allows unbounded recursion (which we may want to restrict anyway).

### 3.3 Memory Management (Linear Memory)

WASM provides a single contiguous block of memory (linear memory), accessed via
`i32.load` and `i32.store` instructions. Memory is allocated in 64 KiB pages.

For a robot game, we can use a simple memory model:

```
+------------------+-------------------+-------------------+
| Static data      | Stack             | Heap (bump alloc) |
| (globals, consts)| (local arrays)    | (dynamic alloc)   |
+------------------+-------------------+-------------------+
0              STATIC_END         STACK_END             HEAP_END
```

**Simple approach: no dynamic allocation at all**. If the robot language only
supports fixed-size local variables and arrays with compile-time-known sizes, you
can put everything on the stack or in static memory. No allocator needed.

**If dynamic allocation is needed** (variable-length arrays, strings), implement a
bump allocator:

```typescript
// In the compiler-generated WASM:
// Global: heap pointer starts after static data
(global $heap_ptr (mut i32) (i32.const 1024))

// alloc(size) -> pointer
(func $alloc (param $size i32) (result i32)
  (local $ptr i32)
  (local.set $ptr (global.get $heap_ptr))
  (global.set $heap_ptr
    (i32.add (global.get $heap_ptr) (local.get $size))
  )
  (local.get $ptr)
)
```

A bump allocator is sufficient for a tick-based game: allocate during the tick,
then reset the heap pointer at the start of each tick. This is effectively
arena allocation -- no freeing individual allocations, just reset the whole arena.

### 3.4 No Garbage Collection (Implications)

WASM's linear memory has no garbage collector. This means:

- **Strings**: Must be stored as byte arrays in linear memory. Need a length prefix
  or null terminator. String concatenation requires allocation. For a robot game,
  strings are likely unnecessary -- robot API calls use integer parameters.
- **Arrays**: Fixed-size arrays stored inline or on the stack work naturally. Variable-
  size arrays require the allocator above.
- **Structs**: Laid out as contiguous bytes in memory, accessed via offset calculations,
  exactly like C. This maps perfectly to WASM.

**Recommendation for Robot Battle**: Start with a restrictive language. No strings,
no dynamic arrays, no heap allocation. Support only:
- Scalar types (`int`, `float`, `bool`)
- Fixed-size arrays (`int sensors[8]`)
- Simple structs (compile-time-known layout)

This sidesteps all GC concerns. If strings are needed later (for debug logging),
they can be stored in a fixed-size buffer.

### 3.5 Control Flow

This is the trickiest part of targeting WASM. WASM uses **structured control flow**,
not arbitrary jumps:

- **`block`**: A sequence of instructions. `br` jumps forward to the end.
- **`loop`**: Like `block`, but `br` jumps backward to the start.
- **`if`/`else`**: Conditional execution.
- **`br`**: Branch (jump) to a labeled block.
- **`br_if`**: Conditional branch.
- **`br_table`**: Branch table (for switch statements).

There is no `goto`. You cannot jump to arbitrary addresses. All control flow must
be expressible as nested blocks, loops, and branches.

**What maps easily**:
- `if`/`else` -> WASM `if`/`else` directly
- `while` loops -> WASM `block` + `loop` + `br_if` pattern
- `for` loops -> desugar to `while`, then same pattern
- `break` -> `br` to enclosing block label
- `continue` -> `br` to enclosing loop label
- `return` -> `return` instruction
- `switch` -> `br_table` (with fallthrough if desired)

**What is tricky**:
- `goto` -> Cannot be directly represented. Would require the Relooper or
  Stackifier algorithm to restructure arbitrary control flow into WASM's structured
  form. Binaryen includes a Relooper implementation if needed.
- Multiple `break` targets (e.g., `break 2` to exit nested loops) -> requires
  careful label management.

**Recommendation**: Do not support `goto` in the robot language. The structured
control flow of `if`/`else`, `while`, `for`, `break`, `continue`, and `return` maps
directly to WASM with no algorithmic complexity. This is a deliberate language
design constraint that makes the compiler much simpler.

#### Control Flow Compilation Patterns

```
// Source: while (x > 0) { x = x - 1; }
//
// WASM pattern (conceptual WAT):
// (block $break
//   (loop $continue
//     (br_if $break (i32.eqz (i32.gt_s (local.get $x) (i32.const 0))))
//     (local.set $x (i32.sub (local.get $x) (i32.const 1)))
//     (br $continue)
//   )
// )

// Source: if (health < 20) { retreat(); } else { attack(); }
//
// WASM pattern (conceptual WAT):
// (if (i32.lt_s (local.get $health) (i32.const 20))
//   (then (call $retreat))
//   (else (call $attack))
// )

// Source: for (int i = 0; i < 10; i = i + 1) { fire(i); }
//
// Desugar to:
// int i = 0;
// while (i < 10) { fire(i); i = i + 1; }
// Then compile the while loop as above.
```

---

## 4. The Compilation Pipeline

### 4.1 Overview

```
Source Code (string)
       |
       v
   [Tokenizer/Lexer]
       |
       v
   Token Stream
       |
       v
   [Parser]
       |
       v
   Abstract Syntax Tree (AST)
       |
       v
   [Semantic Analysis]  (type checking, name resolution)
       |
       v
   Annotated AST (or simple IR)
       |
       v
   [Code Generator]  (AST -> Binaryen IR)
       |
       v
   Binaryen Module
       |
       v
   [Binaryen Optimizer]
       |
       v
   WASM Binary (Uint8Array)
       |
       v
   [WebAssembly.instantiate()]
       |
       v
   Running WASM Instance
```

### 4.2 Stage 1: Tokenization (Lexing)

Convert the source string into a flat array of tokens. Each token has a type and value.

```typescript
type TokenType =
  | "keyword"    // int, float, if, else, while, for, return, void, bool
  | "identifier" // user-defined names
  | "number"     // 42, 3.14
  | "operator"   // +, -, *, /, %, ==, !=, <, >, <=, >=, &&, ||, !
  | "assign"     // =, +=, -=
  | "lparen" | "rparen"  // ( )
  | "lbrace" | "rbrace"  // { }
  | "lbracket" | "rbracket"  // [ ]
  | "semicolon"  // ;
  | "comma"      // ,
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0, line = 1, col = 1;

  while (pos < source.length) {
    // Skip whitespace and comments
    // Match keywords, identifiers, numbers, operators, punctuation
    // Track line/column for error reporting
  }

  tokens.push({ type: "eof", value: "", line, column: col });
  return tokens;
}
```

Keeping the tokenizer hand-written is standard practice. It is simple, fast, and gives
full control over error positions.

### 4.3 Stage 2: Parsing

Transform the token stream into an AST. Define AST node types:

```typescript
type ASTNode =
  | Program
  | FunctionDecl
  | VarDecl
  | IfStatement
  | WhileStatement
  | ForStatement
  | ReturnStatement
  | Block
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | Assignment
  | NumberLiteral
  | BoolLiteral
  | Identifier
  | ArrayAccess;

interface Program {
  type: "Program";
  functions: FunctionDecl[];
  globals: VarDecl[];
}

interface FunctionDecl {
  type: "FunctionDecl";
  name: string;
  params: { name: string; valueType: ValueType }[];
  returnType: ValueType;
  body: Block;
}

interface BinaryExpr {
  type: "BinaryExpr";
  op: "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">" | "<=" | ">="
      | "&&" | "||";
  left: ASTNode;
  right: ASTNode;
}

interface CallExpr {
  type: "CallExpr";
  callee: string;
  args: ASTNode[];
}
```

For operator precedence, use a **Pratt parser** (top-down operator precedence).
It handles left-associative binary operators, unary prefix operators, and
parenthesized subexpressions elegantly:

```typescript
function parseExpression(precedence: number = 0): ASTNode {
  let left = parsePrefix(); // number literals, identifiers, unary ops, parens

  while (precedence < getPrecedence(currentToken())) {
    left = parseInfix(left); // binary operators, function calls, array access
  }

  return left;
}

function getPrecedence(token: Token): number {
  switch (token.value) {
    case "||": return 1;
    case "&&": return 2;
    case "==": case "!=": return 3;
    case "<": case ">": case "<=": case ">=": return 4;
    case "+": case "-": return 5;
    case "*": case "/": case "%": return 6;
    default: return 0;
  }
}
```

### 4.4 Stage 3: Semantic Analysis

Walk the AST and:

1. **Resolve names**: Build a symbol table mapping identifiers to their declarations.
   Check for undefined variables and duplicate declarations.
2. **Type check**: Ensure operands have compatible types. Insert implicit conversions
   where needed (e.g., `int` to `float`).
3. **Validate function calls**: Check argument counts and types against declarations.
4. **Validate control flow**: `break`/`continue` only inside loops. `return` type
   matches function return type.

```typescript
interface SymbolTable {
  parent: SymbolTable | null;
  symbols: Map<string, Symbol>;
}

interface Symbol {
  name: string;
  valueType: ValueType;  // i32, f32, bool
  kind: "local" | "global" | "param" | "function";
  index: number;         // local/param index for WASM
}

function analyze(program: Program): AnnotatedProgram {
  const globalScope = createScope(null);

  // Register built-in functions (robot API imports)
  registerBuiltin(globalScope, "move", [{ name: "dir", valueType: "i32" }], "void");
  registerBuiltin(globalScope, "fire", [{ name: "dir", valueType: "i32" }], "void");
  registerBuiltin(globalScope, "scan", [], "i32");
  registerBuiltin(globalScope, "getHealth", [], "i32");
  // ... etc

  // Analyze each function
  for (const func of program.functions) {
    analyzeFunction(func, globalScope);
  }
}
```

### 4.5 Stage 4: Code Generation (AST to Binaryen IR)

Walk the annotated AST and build Binaryen expressions:

```typescript
function emitExpression(node: ASTNode, mod: binaryen.Module): binaryen.ExpressionRef {
  switch (node.type) {
    case "NumberLiteral":
      if (node.valueType === "i32") {
        return mod.i32.const(node.value);
      } else {
        return mod.f32.const(node.value);
      }

    case "Identifier":
      return mod.local.get(node.symbol.index, typeToWasm(node.symbol.valueType));

    case "BinaryExpr":
      const left = emitExpression(node.left, mod);
      const right = emitExpression(node.right, mod);
      switch (node.op) {
        case "+": return mod.i32.add(left, right);
        case "-": return mod.i32.sub(left, right);
        case "*": return mod.i32.mul(left, right);
        case "/": return mod.i32.div_s(left, right);
        case "<": return mod.i32.lt_s(left, right);
        case "==": return mod.i32.eq(left, right);
        // ... etc
      }

    case "CallExpr":
      const args = node.args.map(a => emitExpression(a, mod));
      return mod.call(node.callee, args, typeToWasm(node.returnType));

    case "Assignment":
      return mod.local.set(
        node.symbol.index,
        emitExpression(node.value, mod)
      );

    case "IfStatement":
      return mod.if(
        emitExpression(node.condition, mod),
        emitStatement(node.consequent, mod),
        node.alternate ? emitStatement(node.alternate, mod) : undefined
      );

    case "WhileStatement":
      return emitWhileLoop(node, mod);
  }
}

function emitWhileLoop(node: WhileStatement, mod: binaryen.Module): binaryen.ExpressionRef {
  const breakLabel = `break_${labelCounter++}`;
  const continueLabel = `continue_${labelCounter++}`;

  return mod.block(breakLabel, [
    mod.loop(continueLabel,
      mod.block(null, [
        // Exit condition: break if condition is false
        mod.br(breakLabel,
          mod.i32.eqz(emitExpression(node.condition, mod))
        ),
        // Loop body
        emitStatement(node.body, mod),
        // Jump back to loop start
        mod.br(continueLabel),
      ])
    )
  ]);
}
```

### 4.6 Stage 5: Optimization

Binaryen's optimizer handles the heavy lifting:

```typescript
binaryen.setOptimizeLevel(2);  // Equivalent to -O2
binaryen.setShrinkLevel(0);    // Don't prioritize size
mod.optimize();
```

Key optimization passes Binaryen runs include:
- **SimplifyLocals**: Removes redundant local variable operations
- **Vacuum**: Removes dead code
- **RemoveUnusedBrs**: Eliminates unnecessary branches
- **MergeBlocks**: Simplifies nested blocks
- **CodeFolding**: Merges duplicate code patterns
- **ConstantFolding**: Evaluates constant expressions at compile time
- **DeadCodeElimination**: Removes unreachable functions

**Optimizations worth doing in your own compiler** (before Binaryen):
1. **Constant folding** at the AST level: `3 + 4` becomes `7`.
2. **Dead code elimination**: Code after `return` is unreachable.
3. **Strength reduction**: `x * 2` becomes `x << 1` (though Binaryen does this too).
4. **Not worth doing yourself**: Register allocation, instruction scheduling, loop
   unrolling -- Binaryen and the WASM engine handle these.

### 4.7 Stage 6: Module Emission and Instantiation

```typescript
// Emit binary
const binary = mod.emitBinary();
mod.dispose(); // Free Binaryen's C++ memory

// Compile and instantiate
const wasmModule = await WebAssembly.compile(binary);
const instance = await WebAssembly.instantiate(wasmModule, importObject);

// The robot is ready to run
```

---

## 5. Existing Examples and Precedents

### 5.1 AssemblyScript

- **Repository**: https://github.com/AssemblyScript/assemblyscript
- **npm**: `assemblyscript`
- **What it is**: A TypeScript-like language that compiles to WebAssembly.
  The compiler itself is written in TypeScript (actually, self-hosted in
  AssemblyScript).

**Architecture lessons**:
- AssemblyScript uses Binaryen.js as its backend. This is the strongest validation
  that Binaryen.js works well for browser-based compilation.
- It has a hand-written parser (not a parser generator).
- The compiler runs in both Node.js and the browser.
- It implements its own type system on top of WASM's primitive types, including
  classes, generics, and a garbage collector (via a built-in runtime).
- The compilation pipeline is: Source -> Tokenizer -> Parser -> AST -> Type Checker
  -> Binaryen IR -> Optimized WASM.

**What we can learn**: AssemblyScript proves the full stack works: a TypeScript
compiler using Binaryen.js, running in the browser, producing optimized WASM. We can
follow the same architecture with a simpler language.

### 5.2 Chasm

- **Repository**: https://github.com/ColinEberhardt/chasm
- **Blog post**: https://blog.scottlogic.com/2019/05/17/webassembly-compiler.html
- **Live demo**: https://colineberhardt.github.io/chasm/

**What it is**: A tiny language ("chasm") that compiles to WASM in the browser.
The compiler is written in TypeScript. Created by Colin Eberhardt at Scott Logic as
a teaching project.

**Architecture**:
- Hand-written tokenizer using regex matchers
- Hand-written recursive descent parser producing an AST
- Direct binary emission (no Binaryen or wabt -- writes raw WASM bytes)
- Supports: variables (`var`), arithmetic expressions, `print`, `while` loops,
  `setpixel` for graphics
- Rendered a Mandelbrot set as a demonstration

**What we can learn**: You can write a compiler that targets WASM with raw binary
emission and very little code. The chasm compiler is small enough to read in an
afternoon. However, for a production game with more language features, using
Binaryen provides much better optimization and validation than manual binary emission.

### 5.3 Other Notable Projects

- **Walt** (https://github.com/nicolo-ribaudo/walt-deprecated): An alternative syntax
  for WebAssembly text format, written as a JavaScript compiler. Demonstrates
  JavaScript-to-WASM compilation but was deprecated.
- **aspect** (https://aspect.dev/): A testing framework using AssemblyScript
  that demonstrates WASM module isolation patterns.
- **porffor** (https://github.com/nicolo-ribaudo/porffor): A JavaScript engine
  written in JavaScript that compiles JS to WASM. Demonstrates that even a complex
  language can target WASM from a JS-based compiler.

---

## 6. Robot API Design

### 6.1 The Import/Export Interface

The WASM module (robot code) communicates with the game engine (JavaScript host)
through WASM imports and exports.

```
+-------------------+         +-------------------+
|   Game Engine     |         |   Robot WASM      |
|   (JavaScript)    |         |   Module          |
|                   |         |                   |
|  Calls:           |-------->| Exports:          |
|  instance.tick()  |         |   tick()          |
|                   |         |   init()          |
|                   |         |                   |
|  Provides:        |<--------|  Imports:         |
|  env.move()       |         |   env.move()      |
|  env.rotate()     |         |   env.rotate()    |
|  env.fire()       |         |   env.fire()      |
|  env.scan()       |         |   env.scan()      |
|  env.getHealth()  |         |   env.getHealth() |
|  env.getEnergy()  |         |   env.getEnergy() |
|  env.getX()       |         |   env.getX()      |
|  env.getY()       |         |   env.getY()      |
|  env.getHeading() |         |   env.getHeading()|
|  env.log()        |         |   env.log()       |
|                   |         |                   |
+-------------------+         +-------------------+
```

### 6.2 Exported Functions (Robot -> Engine)

The robot WASM module exports functions that the game engine calls:

```typescript
// Functions the robot MUST export
interface RobotExports {
  // Called once when the robot is created. Robot initializes state.
  init(): void;

  // Called every game tick. The robot decides what to do.
  tick(): void;

  // Called when the robot is hit. direction is the angle of impact.
  onHit(direction: i32): void;

  // WASM memory, exported so the host can inspect/debug if needed.
  memory: WebAssembly.Memory;
}
```

### 6.3 Imported Functions (Engine -> Robot)

The game engine provides these as WASM imports:

```typescript
// The import object passed to WebAssembly.instantiate()
const robotImports = {
  env: {
    // === Movement ===
    move: (direction: number): void => { /* 0=forward, 1=backward */ },
    rotate: (degrees: number): void => { /* turn left (neg) or right (pos) */ },
    rotateTurret: (degrees: number): void => { /* rotate gun independently */ },

    // === Combat ===
    fire: (power: number): void => { /* fire with energy cost = power */ },
    scan: (): number => { /* scan for enemies, returns distance or -1 */ },
    scanDirection: (): number => { /* angle to nearest enemy from scan */ },

    // === Sensors (read-only) ===
    getHealth: (): number => { /* current HP, 0-100 */ },
    getEnergy: (): number => { /* current energy, 0-100 */ },
    getX: (): number => { /* x position on battlefield */ },
    getY: (): number => { /* y position on battlefield */ },
    getHeading: (): number => { /* current heading in degrees */ },
    getTurretHeading: (): number => { /* turret angle */ },
    getSpeed: (): number => { /* current speed */ },
    getTickCount: (): number => { /* current game tick */ },

    // === Utilities ===
    random: (max: number): number => { /* random int 0..max-1 */ },
    log: (value: number): void => { /* debug: print a value to console */ },
  }
};
```

### 6.4 Game Loop Integration

Each game tick, the engine calls into every robot's WASM module:

```typescript
class RobotRunner {
  private instance: WebAssembly.Instance;
  private robotState: RobotState;

  constructor(wasmBinary: Uint8Array, robotState: RobotState) {
    // Each robot gets its own WASM instance (isolated memory)
    const module = new WebAssembly.Module(wasmBinary);
    this.robotState = robotState;

    this.instance = new WebAssembly.Instance(module, {
      env: this.createImports()
    });

    // Call the robot's init function
    (this.instance.exports.init as Function)();
  }

  /** Called by the game engine every tick */
  executeTick(): RobotActions {
    // Reset per-tick action budget
    this.robotState.actionsThisTick = [];

    try {
      // Call the robot's tick function
      (this.instance.exports.tick as Function)();
    } catch (e) {
      // Robot crashed -- it does nothing this tick
      console.warn(`Robot ${this.robotState.name} crashed:`, e);
    }

    return this.robotState.actionsThisTick;
  }

  private createImports() {
    return {
      move: (direction: number) => {
        this.robotState.actionsThisTick.push({ type: "move", direction });
      },
      fire: (power: number) => {
        const clampedPower = Math.min(power, this.robotState.energy);
        this.robotState.actionsThisTick.push({ type: "fire", power: clampedPower });
      },
      scan: () => {
        return this.robotState.nearestEnemyDistance ?? -1;
      },
      getHealth: () => this.robotState.health,
      getEnergy: () => this.robotState.energy,
      getX: () => this.robotState.x,
      getY: () => this.robotState.y,
      // ... etc
    };
  }
}
```

### 6.5 Robot Language Example

Here is what a robot program might look like in the custom language:

```c
// A simple robot that scans and fires

int direction;
int scanResult;

void init() {
  direction = 0;
}

void tick() {
  // Rotate and scan
  rotate(10);
  scanResult = scan();

  if (scanResult > 0) {
    // Enemy found -- fire!
    fire(3);
  }

  // Move forward if health is good
  if (getHealth() > 30) {
    move(1);
  } else {
    // Low health -- reverse and evade
    move(-1);
    rotate(45);
  }
}

void onHit(int direction) {
  // Turn away from the hit
  rotate(180);
  move(1);
}
```

This compiles to a WASM module exporting `init`, `tick`, and `onHit`, with all
the `move`, `fire`, `scan`, `rotate`, `getHealth` calls becoming WASM imports.

---

## 7. Performance Considerations

### 7.1 Compilation Speed

The compilation pipeline has these performance-relevant steps:

| Stage | Expected Time (small program) | Notes |
|-------|-------------------------------|-------|
| Tokenization | < 1 ms | Linear scan, very fast |
| Parsing | < 1 ms | Recursive descent is fast |
| Semantic analysis | < 1 ms | Single pass over AST |
| Binaryen IR generation | 1-5 ms | Dominated by Binaryen API call overhead |
| Binaryen optimization | 5-50 ms | Depends on optimization level |
| WASM binary emission | < 1 ms | Fast serialization |
| WebAssembly.compile() | 1-10 ms | Browser's WASM compiler (very fast for small modules) |
| WebAssembly.instantiate() | < 1 ms | Fast for small modules |
| **Total** | **~10-70 ms** | Acceptable for interactive use |

For a robot program of a few hundred lines, the entire compile-and-instantiate cycle
should complete in well under 100 ms on modern hardware. This is fast enough for a
"compile on save" workflow in the game's code editor.

**Binaryen.js initialization** is a one-time cost. Loading the ~5 MB Binaryen WASM
module and initializing it takes 100-500 ms on first load. This can be done at
application startup and amortized.

### 7.2 WASM Instantiation Overhead

`WebAssembly.compile()` is fast for small modules. Browsers have baseline compilers
(SpiderMonkey's, V8's Liftoff) that produce machine code in a single pass with
minimal optimization. For a small robot module (a few KB of WASM), compilation is
nearly instant.

`WebAssembly.instantiate()` allocates memory and links imports. With one page of
memory (64 KB) and a dozen imports, this is sub-millisecond.

For the game scenario where many robots need to be compiled at once (e.g., a
tournament), you can compile in parallel using Web Workers or `Promise.all`:

```typescript
const robots = await Promise.all(
  robotSources.map(async (source) => {
    const binary = compile(source);
    const module = await WebAssembly.compile(binary);
    return { module, source };
  })
);
```

### 7.3 Module Caching

Modern browsers (Chrome, Firefox) **implicitly cache compiled WASM modules**. When
the same WASM bytes are compiled a second time, the browser can reuse the cached
machine code. This means:

- First compilation: full compile (a few ms for small modules)
- Subsequent compilations of the same bytes: near-instant

For Robot Battle, if a player's code has not changed, you can skip recompilation
entirely by caching the `Uint8Array` of WASM bytes and comparing it:

```typescript
class CompilationCache {
  private cache = new Map<string, WebAssembly.Module>();

  async getModule(sourceCode: string): Promise<WebAssembly.Module> {
    // Use source hash as cache key
    const hash = await hashSource(sourceCode);

    if (this.cache.has(hash)) {
      return this.cache.get(hash)!;
    }

    const binary = compile(sourceCode);
    const module = await WebAssembly.compile(binary);
    this.cache.set(hash, module);
    return module;
  }
}
```

`WebAssembly.Module` objects are structured-cloneable, so they can be passed to
Web Workers or stored (though browser-level implicit caching makes explicit
IndexedDB caching largely unnecessary in modern browsers).

### 7.4 Runtime Performance

Robot WASM code executes at near-native speed. A robot's `tick()` function will
typically complete in microseconds. Even complex logic with loops over sensor data
will not be a bottleneck.

The main performance consideration at runtime is the **cost of crossing the
WASM-JS boundary** for import calls. Each `move()`, `fire()`, `scan()`, etc. call
crosses this boundary. In V8, this overhead is roughly 10-50 nanoseconds per call.
For a robot making 10-20 API calls per tick, this is completely negligible.

---

## 8. Sandboxing via WASM

### 8.1 What WASM Sandboxes Naturally

WebAssembly provides strong sandboxing by design:

1. **Memory isolation**: Each WASM instance has its own linear memory. A robot
   cannot read or write memory belonging to another robot or the host JavaScript.
   All memory accesses are bounds-checked (accessing out-of-bounds traps the module).

2. **No system access**: WASM modules cannot access the file system, network,
   DOM, or any browser API unless explicitly provided as imports. A robot can only
   call functions we give it.

3. **No code injection**: WASM is a typed, validated binary format. You cannot
   construct and execute arbitrary machine code at runtime. The module is validated
   before execution.

4. **No access to other modules**: A WASM instance cannot discover or interact with
   other WASM instances or JavaScript objects unless the host explicitly brokers the
   interaction.

5. **Deterministic execution**: For the same inputs, WASM produces the same outputs
   (with minor exceptions around NaN bit patterns). This is useful for replays.

### 8.2 What WASM Does Not Sandbox

1. **CPU time**: WASM cannot enforce execution time limits on its own. An infinite
   loop will run forever (or until the browser's script timeout kills it).

2. **Memory growth**: A WASM module can call `memory.grow` to request more memory.
   You can cap this by setting a maximum memory size at instantiation time.

3. **Stack overflow**: Deep recursion will eventually trap (stack overflow), but
   the stack depth is implementation-defined.

### 8.3 Preventing Infinite Loops

This is the most important sandboxing concern for Robot Battle. A player's robot
must not be able to hang the game with an infinite loop.

#### Approach 1: Fuel/Gas Metering (Recommended)

Inject a counter into the compiled WASM code. At the top of every loop and function
call, decrement the counter. If it reaches zero, trap.

This can be done at the compiler level (during code generation):

```typescript
// During compilation, inject fuel checks into every loop
function emitWhileLoopWithFuel(
  node: WhileStatement,
  mod: binaryen.Module
): binaryen.ExpressionRef {
  const breakLabel = `break_${labelCounter++}`;
  const continueLabel = `continue_${labelCounter++}`;

  return mod.block(breakLabel, [
    mod.loop(continueLabel,
      mod.block(null, [
        // === FUEL CHECK ===
        // Decrement global fuel counter
        mod.global.set("__fuel",
          mod.i32.sub(
            mod.global.get("__fuel", binaryen.i32),
            mod.i32.const(1)
          )
        ),
        // If fuel exhausted, break out (will propagate up and exit tick)
        mod.br(breakLabel,
          mod.i32.le_s(
            mod.global.get("__fuel", binaryen.i32),
            mod.i32.const(0)
          )
        ),
        // === END FUEL CHECK ===

        // Normal loop exit condition
        mod.br(breakLabel,
          mod.i32.eqz(emitExpression(node.condition, mod))
        ),
        // Loop body
        emitStatement(node.body, mod),
        // Jump back to loop start
        mod.br(continueLabel),
      ])
    )
  ]);
}
```

Before each tick, the host resets the fuel:

```typescript
// Before calling tick()
(instance.exports.__setFuel as Function)(100_000); // allow 100k iterations
(instance.exports.tick as Function)();
```

This is the approach used by Ethereum's eWASM (via `wasm-metering`) and many
WASM runtimes (Wasmtime, Wasmi).

#### Approach 2: Web Worker + Timeout

Run each robot's tick in a Web Worker with a timeout:

```typescript
// In a Web Worker
self.onmessage = (e) => {
  const { wasmBytes, imports } = e.data;
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(wasmBytes),
    imports
  );
  (instance.exports.tick as Function)();
  self.postMessage({ done: true });
};

// In the main thread
const worker = new Worker("robot-worker.js");
worker.postMessage({ wasmBytes, imports });

const timeout = setTimeout(() => {
  worker.terminate(); // Kill the worker if it takes too long
  console.warn("Robot timed out");
}, 50); // 50ms budget per tick

worker.onmessage = () => {
  clearTimeout(timeout);
};
```

**Trade-off**: Web Workers add latency (message passing overhead) and complexity
(serializing import functions). Fuel metering is more precise and has less overhead.

#### Approach 3: Combined

Use fuel metering as the primary defense (catches most infinite loops within
microseconds) and a Web Worker timeout as a backup safety net (catches edge cases
where fuel is exhausted in a way that does not trap cleanly).

**Recommendation**: Implement fuel metering in the compiler. It is deterministic,
has negligible overhead (one integer decrement and comparison per loop iteration),
and catches infinite loops immediately. Add a Web Worker timeout as a secondary
defense if the game needs to be resilient against all edge cases.

### 8.4 Memory Limits

Cap each robot's memory at instantiation:

```typescript
// Create memory with max 4 pages (256 KB) -- plenty for a robot
const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });

const instance = new WebAssembly.Instance(module, {
  env: {
    memory,
    ...otherImports
  }
});
```

If the robot tries to `memory.grow` beyond 4 pages, the grow instruction returns
-1 (failure). The robot cannot allocate more memory than you allow.

### 8.5 Import Surface Minimization

Only provide the imports the robot language needs. The import object IS the
sandbox boundary. A robot cannot:

- Access the DOM (no `document` import)
- Make network requests (no `fetch` import)
- Read from the file system (no `fs` imports)
- Access other robots' memory (separate WASM instances)
- Access JavaScript globals (WASM has no implicit access)

The only things a robot can do are call the functions in the `env` import object.
If `move()`, `fire()`, `scan()`, and sensor functions are the only imports, then
those are the only side effects a robot can have.

---

## 9. Concrete Recommendations Summary

### Architecture

1. **Parser**: Hand-written recursive descent with Pratt parsing for expressions.
   Alternatively, Chevrotain for slightly faster development with similar performance.
2. **Code generation**: Binaryen.js (`npm install binaryen`). Build Binaryen IR
   directly from the AST.
3. **Optimization**: Let Binaryen handle it (`mod.optimize()` at level 2).
4. **Sandboxing**: Compiler-injected fuel metering for loop/recursion limits.
   Maximum memory set at 256 KB per robot. Minimal import surface.

### Language Features (MVP)

Start with a minimal language and expand:

- **Phase 1**: `int` type, arithmetic, variables, `if`/`else`, `while`, functions,
  robot API calls. This is enough for interesting robots.
- **Phase 2**: `float` type, `for` loops, `break`/`continue`, arrays with
  compile-time sizes.
- **Phase 3**: Structs, multiple return values, more operators (`%`, bitwise).
- **Avoid for now**: Strings, dynamic allocation, closures, generics, classes.

### File Structure

```
src/
  compiler/
    tokenizer.ts       // Source -> Token[]
    parser.ts          // Token[] -> AST
    analyzer.ts        // AST -> AnnotatedAST (type checking, name resolution)
    codegen.ts         // AnnotatedAST -> binaryen.Module
    compiler.ts        // Orchestrates the pipeline, returns Uint8Array
  runtime/
    robot-runner.ts    // Instantiates and manages WASM robot instances
    robot-imports.ts   // Defines the import object (robot API)
    fuel.ts            // Fuel metering constants and reset logic
  game/
    engine.ts          // Game loop, physics, collision
    battlefield.ts     // Battlefield state
```

### Key Dependencies

| Package | Purpose | npm |
|---------|---------|-----|
| binaryen | WASM IR construction, optimization, emission | `npm install binaryen` |
| chevrotain (optional) | Parser toolkit if not hand-writing | `npm install chevrotain` |
| wabt (optional) | WAT-to-WASM for debugging | `npm install wabt` |

### Development Workflow

1. Write a robot program in the custom language
2. Compiler tokenizes, parses, analyzes, and generates Binaryen IR
3. Binaryen validates and optimizes
4. Emit WASM binary bytes
5. `WebAssembly.instantiate()` with the robot API import object
6. Game engine calls `tick()` each frame
7. Robot calls `move()`, `fire()`, etc. via imports
8. Engine processes the robot's actions

This architecture is proven by AssemblyScript (which uses the same Binaryen.js
backend), demonstrated at smaller scale by the chasm project, and fits naturally
into the browser environment with strong sandboxing guarantees from WASM itself.
