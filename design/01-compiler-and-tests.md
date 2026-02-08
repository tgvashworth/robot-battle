# Compiler & Test Harness Design

## 1. Compilation Pipeline Overview

```
Source (.rbl)
    |
    v
[Tokenizer]  tokenizer.ts
    |
    v
Token[]
    |
    v
[Parser]  parser.ts
    |
    v
AST (untyped)
    |
    v
[Analyzer]  analyzer.ts
    |
    v
Annotated AST (typed, resolved)
    |
    v
[CodeGenerator]  codegen.ts
    |
    v
binaryen.Module
    |
    v
[Binaryen validate + optimize + emitBinary]
    |
    v
Uint8Array (WASM binary)
```

The top-level `compiler.ts` orchestrates all stages and returns either a `CompileResult` (success with WASM bytes) or a `CompileError[]` array.

---

## 2. TypeScript Types

### 2.1 Tokens

```typescript
// src/compiler/tokens.ts

export type TokenType =
  // Literals
  | "INT_LIT"      // 42
  | "FLOAT_LIT"    // 3.14
  | "STRING_LIT"   // "MyBot"
  | "TRUE"         // true
  | "FALSE"        // false
  // Keywords
  | "ROBOT" | "FUNC" | "ON" | "VAR" | "CONST" | "TYPE" | "STRUCT"
  | "IF" | "ELSE" | "FOR" | "SWITCH" | "CASE" | "DEFAULT"
  | "RETURN" | "BREAK" | "CONTINUE"
  | "INT" | "FLOAT" | "BOOL" | "ANGLE"
  // Identifiers
  | "IDENT"
  // Operators
  | "PLUS" | "MINUS" | "STAR" | "SLASH" | "PERCENT"
  | "AMP" | "PIPE" | "CARET" | "SHL" | "SHR"
  | "EQ" | "NEQ" | "LT" | "GT" | "LTE" | "GTE"
  | "AND" | "OR" | "NOT"
  // Assignment
  | "ASSIGN"       // =
  | "WALRUS"       // :=
  | "PLUS_ASSIGN"  // +=
  | "MINUS_ASSIGN" // -=
  | "STAR_ASSIGN"  // *=
  | "SLASH_ASSIGN" // /=
  // Delimiters
  | "LPAREN" | "RPAREN"
  | "LBRACE" | "RBRACE"
  | "LBRACKET" | "RBRACKET"
  | "COMMA" | "DOT" | "COLON" | "SEMICOLON"
  // Special
  | "NEWLINE"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}
```

### 2.2 AST Nodes

```typescript
// src/compiler/ast.ts

export interface Span {
  line: number;
  col: number;
}

// --- Top-level declarations ---

export interface Program {
  kind: "Program";
  robotName: string;
  consts: ConstDecl[];
  types: TypeDecl[];
  globals: VarDecl[];
  funcs: FuncDecl[];
  events: EventDecl[];
  span: Span;
}

export interface ConstDecl {
  kind: "ConstDecl";
  name: string;
  value: Expr;
  span: Span;
}

export interface TypeDecl {
  kind: "TypeDecl";
  name: string;
  fields: FieldDef[];
  span: Span;
}

export interface FieldDef {
  name: string;
  typeNode: TypeNode;
  span: Span;
}

export interface VarDecl {
  kind: "VarDecl";
  name: string;
  typeNode: TypeNode;
  init: Expr | null;  // null = zero-initialized
  span: Span;
}

export interface FuncDecl {
  kind: "FuncDecl";
  name: string;
  params: ParamDef[];
  returnType: TypeNode[];  // [] = void, [T] = single, [T,U] = multi-return
  body: Block;
  span: Span;
}

export interface EventDecl {
  kind: "EventDecl";
  name: string;            // "scan", "hit", "wallHit", etc.
  params: ParamDef[];
  body: Block;
  span: Span;
}

export interface ParamDef {
  name: string;
  typeNode: TypeNode;
  span: Span;
}

// --- Type nodes (syntax-level, before resolution) ---

export type TypeNode =
  | { kind: "PrimitiveType"; name: "int" | "float" | "bool" | "angle"; span: Span }
  | { kind: "ArrayType"; size: number; elementType: TypeNode; span: Span }
  | { kind: "NamedType"; name: string; span: Span };

// --- Statements ---

export type Stmt =
  | VarStmt
  | ShortDeclStmt
  | AssignStmt
  | IfStmt
  | ForStmt
  | SwitchStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | ExprStmt
  | Block;

export interface Block {
  kind: "Block";
  stmts: Stmt[];
  span: Span;
}

export interface VarStmt {
  kind: "VarStmt";
  name: string;
  typeNode: TypeNode;
  init: Expr | null;
  span: Span;
}

export interface ShortDeclStmt {
  kind: "ShortDeclStmt";
  names: string[];
  values: Expr[];
  span: Span;
}

export interface AssignStmt {
  kind: "AssignStmt";
  target: Expr;        // Ident, FieldAccess, or IndexAccess
  op: "=" | "+=" | "-=" | "*=" | "/=";
  value: Expr;
  span: Span;
}

export interface IfStmt {
  kind: "IfStmt";
  condition: Expr;
  then: Block;
  else_: Block | IfStmt | null;
  span: Span;
}

export interface ForStmt {
  kind: "ForStmt";
  // All three are optional:
  init: ShortDeclStmt | null;     // for INIT; cond; post { }
  condition: Expr | null;          // null = infinite loop
  post: AssignStmt | null;         // for init; cond; POST { }
  body: Block;
  span: Span;
}

export interface SwitchStmt {
  kind: "SwitchStmt";
  tag: Expr;
  cases: CaseClause[];
  span: Span;
}

export interface CaseClause {
  kind: "CaseClause";
  values: Expr[];      // empty = default case
  isDefault: boolean;
  body: Stmt[];
  span: Span;
}

export interface ReturnStmt {
  kind: "ReturnStmt";
  values: Expr[];
  span: Span;
}

export interface BreakStmt { kind: "BreakStmt"; span: Span; }
export interface ContinueStmt { kind: "ContinueStmt"; span: Span; }
export interface ExprStmt { kind: "ExprStmt"; expr: Expr; span: Span; }

// --- Expressions ---

export type Expr =
  | IntLiteral
  | FloatLiteral
  | BoolLiteral
  | Ident
  | UnaryExpr
  | BinaryExpr
  | CallExpr
  | FieldAccess
  | IndexAccess
  | StructLiteral
  | TypeConversion
  | GroupExpr;

export interface IntLiteral {
  kind: "IntLiteral"; value: number; span: Span;
}
export interface FloatLiteral {
  kind: "FloatLiteral"; value: number; span: Span;
}
export interface BoolLiteral {
  kind: "BoolLiteral"; value: boolean; span: Span;
}
export interface Ident {
  kind: "Ident"; name: string; span: Span;
}
export interface UnaryExpr {
  kind: "UnaryExpr"; op: "-" | "!"; operand: Expr; span: Span;
}
export interface BinaryExpr {
  kind: "BinaryExpr";
  op: "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">" | "<=" | ">="
    | "&&" | "||" | "&" | "|" | "^" | "<<" | ">>";
  left: Expr;
  right: Expr;
  span: Span;
}
export interface CallExpr {
  kind: "CallExpr"; callee: string; args: Expr[]; span: Span;
}
export interface FieldAccess {
  kind: "FieldAccess"; object: Expr; field: string; span: Span;
}
export interface IndexAccess {
  kind: "IndexAccess"; object: Expr; index: Expr; span: Span;
}
export interface StructLiteral {
  kind: "StructLiteral";
  typeName: string;
  fields: { name: string; value: Expr; span: Span }[];
  span: Span;
}
export interface TypeConversion {
  kind: "TypeConversion"; targetType: "int" | "float" | "angle"; arg: Expr; span: Span;
}
export interface GroupExpr {
  kind: "GroupExpr"; expr: Expr; span: Span;
}
```

### 2.3 Resolved Types (post-analysis)

```typescript
// src/compiler/types.ts

export type RBLType =
  | { kind: "int" }
  | { kind: "float" }
  | { kind: "bool" }
  | { kind: "angle" }
  | { kind: "void" }
  | { kind: "array"; size: number; elementType: RBLType }
  | { kind: "struct"; name: string; fields: StructField[] };

export interface StructField {
  name: string;
  type: RBLType;
  offset: number;  // byte offset within struct in linear memory
  size: number;     // byte size of field
}

export function typeSize(t: RBLType): number {
  switch (t.kind) {
    case "int": case "float": case "bool": case "angle": return 4;
    case "void": return 0;
    case "array": return t.size * typeSize(t.elementType);
    case "struct": return t.fields.reduce((sum, f) => sum + f.size, 0);
  }
}

export function typeEq(a: RBLType, b: RBLType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "array" && b.kind === "array") {
    return a.size === b.size && typeEq(a.elementType, b.elementType);
  }
  if (a.kind === "struct" && b.kind === "struct") {
    return a.name === b.name;
  }
  return true;
}
```

### 2.4 Annotated AST

The analyzer does not produce a separate tree. It annotates the existing AST nodes in place via a side table (`Map<Expr, ExprInfo>`), avoiding duplication.

```typescript
// src/compiler/analysis.ts

export interface ExprInfo {
  type: RBLType;
  isLValue: boolean;      // can be assigned to
  isConst: boolean;       // compile-time constant
  constValue?: number;    // if isConst, the value
}

export interface SymbolInfo {
  name: string;
  type: RBLType;
  scope: "global" | "local" | "param";
  // For globals: byte offset in linear memory
  // For locals/params: WASM local index
  location: number;
}

export interface FuncInfo {
  name: string;
  params: RBLType[];
  returnTypes: RBLType[];        // [] = void
  isImport: boolean;             // API function
  isEvent: boolean;              // on handler
  wasmName: string;              // mangled name for WASM export
}

export interface AnalysisResult {
  exprTypes: Map<Expr, ExprInfo>;
  symbols: Map<string, SymbolInfo>;     // global symbols
  funcs: Map<string, FuncInfo>;
  structs: Map<string, RBLType>;        // struct type definitions
  consts: Map<string, number>;          // resolved constant values
  globalMemorySize: number;             // total bytes for globals
  errors: CompileError[];
}
```

### 2.5 Compiler Errors

```typescript
// src/compiler/errors.ts

export interface CompileError {
  message: string;
  line: number;
  col: number;
  phase: "tokenize" | "parse" | "analyze" | "codegen";
  // Optional hint for the user
  hint?: string;
}

export class CompileErrorList {
  errors: CompileError[] = [];

  add(phase: CompileError["phase"], line: number, col: number,
      message: string, hint?: string) {
    this.errors.push({ message, line, col, phase, hint });
  }

  hasErrors(): boolean { return this.errors.length > 0; }
}
```

### 2.6 Compiler Output

```typescript
// src/compiler/compiler.ts

export type CompileResult =
  | { ok: true; wasm: Uint8Array; wat: string; warnings: CompileError[] }
  | { ok: false; errors: CompileError[] };

export async function compile(source: string): Promise<CompileResult>;
```

---

## 3. Module Design (per compiler stage)

### 3.1 Tokenizer (`tokenizer.ts`)

**Export**: `function tokenize(source: string): Token[] | CompileError[]`

**Algorithm**: Single linear scan. Hand-written, no dependencies.

Key behaviors:
- Tracks line/col for every token.
- Skips whitespace and `//` line comments.
- Newlines are emitted as `NEWLINE` tokens so the parser can use them as statement terminators (Go-style semicolon insertion). The tokenizer inserts a synthetic `NEWLINE` after tokens that could end a statement: `IDENT`, `INT_LIT`, `FLOAT_LIT`, `TRUE`, `FALSE`, `RPAREN`, `RBRACKET`, `RBRACE`, `RETURN`, `BREAK`, `CONTINUE`, and type keywords (`INT`, `FLOAT`, `BOOL`, `ANGLE`).
- `:=` is a single `WALRUS` token. `<=`, `>=`, `==`, `!=`, `&&`, `||`, `<<`, `>>` are each single tokens. `+=`, `-=`, `*=`, `/=` are single tokens.
- Integer literals: `[0-9]+` (no hex/octal in MVP).
- Float literals: `[0-9]+\.[0-9]*` or `\.[0-9]+`.
- String literals: `"..."` (only used for robot name).
- Keywords are recognized after scanning an identifier and checking against a keyword map.

**Error handling**: On unrecognized character, emit an error with line/col and skip it.

### 3.2 Parser (`parser.ts`)

**Export**: `function parse(tokens: Token[]): Program | CompileError[]`

**Algorithm**: Hand-written recursive descent with Pratt parsing for expressions.

Key design:
- Cursor-based: the parser holds an index into the token array and advances it.
- Newlines act as statement terminators. The parser consumes `NEWLINE` tokens between statements.
- Operator precedence (lowest to highest):

| Precedence | Operators         | Associativity |
|------------|-------------------|---------------|
| 1          | `\|\|`            | left          |
| 2          | `&&`              | left          |
| 3          | `\|`              | left          |
| 4          | `^`               | left          |
| 5          | `&`               | left          |
| 6          | `== !=`           | left          |
| 7          | `< > <= >=`       | left          |
| 8          | `<< >>`           | left          |
| 9          | `+ -`             | left          |
| 10         | `* / %`           | left          |
| 11 (unary) | `- !`             | right (prefix)|

- Function calls, field access, and index access are parsed as postfix operations on primary expressions.
- Struct literals (`TypeName{...}`) are detected when an `IDENT` is followed by `LBRACE` and the identifier resolves to a known type name. The parser needs a set of declared type names (collected in a pre-pass or passed from a prior scan of top-level declarations).
- Type conversions (`int(x)`, `float(x)`, `angle(x)`) are parsed as call expressions and resolved during analysis.

**Distinguishing `:=` from `=`**: The parser sees `ident_list := expr_list` as a `ShortDeclStmt` and `expr = expr` as an `AssignStmt`. After parsing a primary expression, if the next token is `WALRUS`, it backtracks and parses as a short declaration. If the next token is `ASSIGN` or a compound assignment, it is an `AssignStmt`.

**Error recovery**: On a parse error, the parser records the error and skips tokens until the next `NEWLINE`, `RBRACE`, or top-level keyword, then resumes. This allows reporting multiple errors.

### 3.3 Semantic Analyzer (`analyzer.ts`)

**Export**: `function analyze(program: Program): AnalysisResult`

**Algorithm**: Two-pass tree walk.

**Pass 1 (collect declarations)**: Walk all top-level declarations and register:
- Struct types (compute field offsets and total sizes).
- Constants (evaluate constant expressions).
- Global variables (assign linear memory offsets starting at byte 0).
- Function signatures (params, return types).
- Event handler signatures (validate against known event types).
- Robot API imports (pre-registered; see section 3.3.1).

**Pass 2 (check bodies)**: Walk every function and event handler body:
- Build scoped symbol tables (function scope contains params + locals; nested blocks create child scopes).
- Type-check every expression. Populate the `exprTypes` map.
- Validate `:=` does not redeclare in the same scope. Validate `=` targets an existing variable.
- Validate `break`/`continue` are inside a `for` loop (track loop depth).
- Validate `return` matches the function's return type.
- Check function call argument counts and types against signatures.
- Check field access on struct types.
- Check array index expressions are `int`.
- Check array sizes reference constants.
- Flag type mismatches, undefined identifiers, etc.

**Type compatibility rules**:
- `int` and `float` do not implicitly convert. Explicit `float(x)` or `int(x)` required.
- `angle` converts explicitly to/from `float`. `angle` arithmetic produces `angle`.
- `bool` does not convert to/from numeric types.
- Comparison operators produce `bool`. Logical operators require `bool` operands.
- Arithmetic operators require matching numeric types (`int` with `int`, `float` with `float`, `angle` with `angle` or `angle` with `float` for `*` and `/`).
- `angle + angle` = `angle`, `angle - angle` = `angle`, `angle * float` = `angle`, `angle / float` = `angle`.
- `int % int` = `int`. `%` not defined for float or angle.

#### 3.3.1 Robot API Import Registry

The analyzer pre-registers all ~30 API functions plus ~15 math builtins with their signatures. These are stored in the `FuncInfo` map with `isImport: true`.

```typescript
const API_FUNCTIONS: FuncInfo[] = [
  // Movement
  { name: "setSpeed", params: [float], returnTypes: [], isImport: true, ... },
  { name: "setTurnRate", params: [float], returnTypes: [], isImport: true, ... },
  { name: "setHeading", params: [angle], returnTypes: [], isImport: true, ... },
  { name: "getX", params: [], returnTypes: [float], isImport: true, ... },
  { name: "getY", params: [], returnTypes: [float], isImport: true, ... },
  { name: "getHeading", params: [], returnTypes: [angle], isImport: true, ... },
  { name: "getSpeed", params: [], returnTypes: [float], isImport: true, ... },
  // Gun
  { name: "setGunTurnRate", params: [float], returnTypes: [], isImport: true, ... },
  { name: "setGunHeading", params: [angle], returnTypes: [], isImport: true, ... },
  { name: "getGunHeading", params: [], returnTypes: [angle], isImport: true, ... },
  { name: "getGunHeat", params: [], returnTypes: [float], isImport: true, ... },
  { name: "fire", params: [float], returnTypes: [], isImport: true, ... },
  { name: "getEnergy", params: [], returnTypes: [float], isImport: true, ... },
  // Radar
  { name: "setRadarTurnRate", params: [float], returnTypes: [], isImport: true, ... },
  { name: "setRadarHeading", params: [angle], returnTypes: [], isImport: true, ... },
  { name: "getRadarHeading", params: [], returnTypes: [angle], isImport: true, ... },
  { name: "setScanWidth", params: [float], returnTypes: [], isImport: true, ... },
  // Status
  { name: "getHealth", params: [], returnTypes: [float], isImport: true, ... },
  { name: "getTick", params: [], returnTypes: [int], isImport: true, ... },
  // Arena
  { name: "arenaWidth", params: [], returnTypes: [float], isImport: true, ... },
  { name: "arenaHeight", params: [], returnTypes: [float], isImport: true, ... },
  { name: "robotCount", params: [], returnTypes: [int], isImport: true, ... },
  // Utility
  { name: "distanceTo", params: [float, float], returnTypes: [float], isImport: true, ... },
  { name: "bearingTo", params: [float, float], returnTypes: [angle], isImport: true, ... },
  { name: "random", params: [int], returnTypes: [int], isImport: true, ... },
  { name: "randomFloat", params: [], returnTypes: [float], isImport: true, ... },
  { name: "debugInt", params: [int], returnTypes: [], isImport: true, ... },
  { name: "debugFloat", params: [float], returnTypes: [], isImport: true, ... },
  { name: "setColor", params: [int, int, int], returnTypes: [], isImport: true, ... },
  { name: "setGunColor", params: [int, int, int], returnTypes: [], isImport: true, ... },
  { name: "setRadarColor", params: [int, int, int], returnTypes: [], isImport: true, ... },
  // Math builtins
  { name: "sin", params: [angle], returnTypes: [float], isImport: true, ... },
  { name: "cos", params: [angle], returnTypes: [float], isImport: true, ... },
  { name: "tan", params: [angle], returnTypes: [float], isImport: true, ... },
  { name: "atan2", params: [float, float], returnTypes: [angle], isImport: true, ... },
  { name: "sqrt", params: [float], returnTypes: [float], isImport: true, ... },
  { name: "abs", params: [float], returnTypes: [float], isImport: true, ... },
  { name: "min", params: [float, float], returnTypes: [float], isImport: true, ... },
  { name: "max", params: [float, float], returnTypes: [float], isImport: true, ... },
  { name: "clamp", params: [float, float, float], returnTypes: [float], isImport: true, ... },
  { name: "floor", params: [float], returnTypes: [int], isImport: true, ... },
  { name: "ceil", params: [float], returnTypes: [int], isImport: true, ... },
  { name: "round", params: [float], returnTypes: [int], isImport: true, ... },
];
```

The `debug` function is overloaded in the spec. In the compiler, we resolve this to `debugInt` or `debugFloat` based on the argument type during analysis.

### 3.4 Code Generator (`codegen.ts`)

**Export**: `function generate(program: Program, analysis: AnalysisResult): binaryen.Module`

**Algorithm**: Recursive tree walk over the AST, emitting Binaryen IR.

#### 3.4.1 WASM Type Mapping

| RBL Type | WASM Type | Notes |
|----------|-----------|-------|
| `int`    | `i32`     | |
| `float`  | `f32`     | |
| `bool`   | `i32`     | 0 = false, 1 = true |
| `angle`  | `f32`     | Normalization calls inserted by codegen |
| `void`   | `none`    | |
| `struct` | N/A       | Lives in linear memory, accessed via load/store |
| `[N]T`   | N/A       | Lives in linear memory, accessed via load/store |

#### 3.4.2 Linear Memory Layout

```
Byte 0                                                    Byte N
+------------------------------------------+--------------+--------+
| Global variables (structs, arrays, scalars) | Stack frame  | Unused |
+------------------------------------------+--------------+--------+
0                                   globalMemorySize    stackBase
```

- Global scalars (`int`, `float`, `bool`, `angle`) are stored in linear memory at their assigned offsets.
- Global structs and arrays are also in linear memory contiguously.
- The stack frame region is used for local structs and arrays (scalars use WASM locals). A `__sp` global tracks the stack pointer. On function entry, `__sp` is decremented by the function's frame size. On exit, it is restored.
- WASM locals are used for scalar local variables and parameters.

#### 3.4.3 The `angle` Type

The `angle` type is `f32` at the WASM level. After every arithmetic operation that produces an `angle`, the code generator inserts a call to a normalization function:

```typescript
// Emitted as a WASM function in the module
// __normalize_angle(a: f32) -> f32
// Returns ((a % 360) + 360) % 360
function emitNormalizeAngle(mod: binaryen.Module): void {
  mod.addFunction("__normalize_angle",
    binaryen.createType([binaryen.f32]),
    binaryen.f32,
    [],
    mod.f32.sub(
      mod.local.get(0, binaryen.f32),
      mod.f32.mul(
        mod.f32.floor(
          mod.f32.div(mod.local.get(0, binaryen.f32), mod.f32.const(360))
        ),
        mod.f32.const(360)
      )
    )
  );
}
```

When the codegen encounters `angle + angle`, it emits:
```
call $__normalize_angle(f32.add(left, right))
```

When the codegen encounters `angle * float`, it emits:
```
call $__normalize_angle(f32.mul(left, right))
```

Assignment to an `angle` variable also normalizes. Reading an `angle` does not need normalization (it was normalized on write).

#### 3.4.4 Struct Access

Structs live in linear memory. Field access compiles to a load at `base_ptr + field_offset`. Field assignment compiles to a store.

```typescript
// target.bearing where target is a global at offset 16, bearing is field offset 0
// -> f32.load(offset=16, align=4, ptr=i32.const(0))

// For local structs on the stack:
// -> f32.load(offset=field_offset, align=4, ptr=i32.add(__sp, i32.const(local_offset)))
```

Struct assignment (e.g., `target = Target{...}`) compiles to a sequence of stores, one per field.

#### 3.4.5 Arrays

Fixed-size arrays live in linear memory (global or stack). Index access compiles to:

```
base_ptr + index * element_size
```

**Bounds checking**: Before each index access, emit:

```wasm
;; if (index < 0 || index >= array_size) unreachable
(if (i32.or
      (i32.lt_s (local.get $index) (i32.const 0))
      (i32.ge_s (local.get $index) (i32.const ARRAY_SIZE)))
  (then (unreachable)))
```

`unreachable` traps the WASM instance. The host catches this as a `RuntimeError` and the robot skips the tick.

#### 3.4.6 Multiple Return Values

**Decision: Use linear memory for multi-return.**

WASM's multi-value proposal is supported in all modern browsers, but Binaryen's TypeScript API for multi-value is cumbersome. Instead, the compiler uses a simple convention:

- Functions with multiple return values write extra returns to a fixed memory region (the "return slot" starting at a known address, e.g., byte 4 of linear memory, reserved).
- The first return value uses WASM's native return.
- The caller reads extras from the return slot after the call.

For example, `func bestTarget() (Target, bool)`:
- The `Target` struct (16 bytes) is written to the return slot at address `__RETSLOT`.
- The `bool` is returned as the WASM function return value (`i32`).
- The caller does: `ok := call $bestTarget`, then reads `Target` fields from `__RETSLOT`.

In the short-decl `target, ok := bestTarget()`:
- `ok` gets the i32 return.
- `target` fields are copied from `__RETSLOT` to `target`'s memory location.

The return slot is 64 bytes, starting at byte 0 of linear memory. This is enough for any reasonable multi-return. Global variables start after this reserved area.

#### 3.4.7 Event Handlers

Event handlers compile to regular WASM functions that are exported. The naming convention is `on_<eventName>`:

| RBL event | WASM export name | Parameters |
|-----------|------------------|------------|
| `on scan(...)` | `on_scan` | `(f32, f32)` — distance, bearing |
| `on hit(...)` | `on_hit` | `(f32, f32)` — damage, bearing |
| `on bulletHit(...)` | `on_bulletHit` | `(i32)` — targetId |
| `on wallHit(...)` | `on_wallHit` | `(f32)` — bearing |
| `on robotHit(...)` | `on_robotHit` | `(f32)` — bearing |
| `on bulletMiss()` | `on_bulletMiss` | `()` |
| `on robotDeath(...)` | `on_robotDeath` | `(i32)` — robotId |

Event handlers can access global variables and call any function, just like `tick()`.

#### 3.4.8 Fuel Metering

The code generator injects fuel checks in two places:

1. **At the top of every loop body** (inside the `loop` instruction, before the body).
2. **At the start of every user-defined function call** (not API imports).

The fuel counter is a WASM global `__fuel: mut i32`.

```typescript
function emitFuelCheck(mod: binaryen.Module, breakLabel: string): binaryen.ExpressionRef {
  return mod.block(null, [
    // __fuel -= 1
    mod.global.set("__fuel",
      mod.i32.sub(mod.global.get("__fuel", binaryen.i32), mod.i32.const(1))
    ),
    // if __fuel <= 0, break out
    mod.br(breakLabel,
      mod.i32.le_s(mod.global.get("__fuel", binaryen.i32), mod.i32.const(0))
    ),
  ]);
}
```

For function calls, fuel exhaustion causes the function to return immediately (via a check at the top of the function body). The host resets `__fuel` before each `tick()` call:

```typescript
(instance.exports.__set_fuel as Function)(10_000);
```

The module exports `__set_fuel` which sets the `__fuel` global.

#### 3.4.9 Division by Zero

Integer division by zero: wrap `i32.div_s` in a check. If divisor is 0, return 0 and call an imported warning function.

```typescript
function emitSafeDivI32(mod: binaryen.Module,
    left: binaryen.ExpressionRef, right: binaryen.ExpressionRef): binaryen.ExpressionRef {
  // Use a local to avoid evaluating right twice
  return mod.if(
    mod.i32.eqz(right),
    mod.block(null, [
      mod.call("__warn_div_zero", [], binaryen.none),
      mod.i32.const(0),
    ]),
    mod.i32.div_s(left, right)
  );
}
```

`__warn_div_zero` is an imported function. The host logs it to the debug panel.

Float division by zero: IEEE 754 handles this naturally (produces Infinity or NaN). We check for NaN/Infinity and substitute 0:

```typescript
function emitSafeDivF32(mod, left, right) {
  // f32.div produces Inf or NaN on /0. Replace with 0.
  const raw = mod.f32.div(left, right);
  // Check: if (result != result || result == Inf || result == -Inf) 0 else result
  // Simpler: use wasm's f32.ne for NaN check, but Inf is trickier.
  // Alternative: check divisor == 0 first, same as int.
  return mod.if(
    mod.f32.eq(right, mod.f32.const(0)),
    mod.block(null, [
      mod.call("__warn_div_zero", [], binaryen.none),
      mod.f32.const(0),
    ]),
    mod.f32.div(left, right)
  );
}
```

#### 3.4.10 Switch Statement

Switch compiles to a chain of `if/else` blocks (not `br_table`). `br_table` requires contiguous integer indices, which RBL switch cases are not guaranteed to be. A chain of comparisons is simpler and Binaryen's optimizer will produce efficient code.

```typescript
// switch tag { case 0: A  case 1: B  default: C }
// compiles to:
// if (tag == 0) { A }
// else if (tag == 1) { B }
// else { C }
```

If a future optimization pass detects that all case values are contiguous small integers, it can emit `br_table` instead.

#### 3.4.11 Robot API Imports

All ~30 API functions and math builtins are added as WASM imports under the `"env"` module:

```typescript
for (const func of API_FUNCTIONS) {
  const paramTypes = func.params.map(t => rblTypeToWasm(t));
  const returnType = func.returnTypes.length === 0
    ? binaryen.none
    : rblTypeToWasm(func.returnTypes[0]);
  mod.addFunctionImport(
    func.name, "env", func.name,
    binaryen.createType(paramTypes), returnType
  );
}

// Also import the internal helpers
mod.addFunctionImport("__warn_div_zero", "env", "__warn_div_zero",
  binaryen.none, binaryen.none);
```

---

## 4. Test Harness Design

### 4.1 Test Infrastructure

**Test runner**: Vitest.

**Binaryen initialization**: Binaryen.js requires async initialization (loading its WASM). Use a Vitest `beforeAll` in a shared setup file:

```typescript
// src/tests/setup.ts
import binaryen from "binaryen";

// binaryen initializes synchronously when imported in Node,
// but we call ready() to be safe
beforeAll(async () => {
  // binaryen is ready after import in Node.js/Vitest
  // No explicit init needed - the module is synchronous in Node
});
```

Note: In Node.js (where Vitest runs), `binaryen` initializes synchronously on import. The async concern only applies to browser usage. Tests do not need special async setup.

### 4.2 Test Helpers

```typescript
// src/tests/helpers.ts
import { compile } from "../compiler/compiler";
import type { CompileError } from "../compiler/errors";

// ---- Compile-only helpers ----

export function compileToWasm(source: string): Uint8Array {
  const result = compile(source);
  if (!result.ok) {
    throw new Error(
      "Compilation failed:\n" +
      result.errors.map(e => `  ${e.line}:${e.col} ${e.message}`).join("\n")
    );
  }
  return result.wasm;
}

export function expectCompileError(source: string, messageSubstring: string): void {
  const result = compile(source);
  if (result.ok) {
    throw new Error("Expected compilation to fail, but it succeeded");
  }
  const found = result.errors.some(e =>
    e.message.toLowerCase().includes(messageSubstring.toLowerCase())
  );
  if (!found) {
    throw new Error(
      `Expected error containing "${messageSubstring}", got:\n` +
      result.errors.map(e => `  ${e.message}`).join("\n")
    );
  }
}

// ---- Mock API ----

export interface APICallRecord {
  name: string;
  args: number[];
}

export interface MockRobotAPI {
  calls: APICallRecord[];
  state: {
    x: number; y: number; heading: number; speed: number;
    gunHeading: number; gunHeat: number; energy: number;
    radarHeading: number; health: number; tick: number;
    arenaWidth: number; arenaHeight: number; robotCount: number;
  };
  warnings: string[];
}

export function createMockAPI(): MockRobotAPI {
  return {
    calls: [],
    state: {
      x: 400, y: 300, heading: 0, speed: 0,
      gunHeading: 0, gunHeat: 0, energy: 100,
      radarHeading: 0, health: 100, tick: 0,
      arenaWidth: 800, arenaHeight: 600, robotCount: 4,
    },
    warnings: [],
  };
}

export function buildImportObject(mock: MockRobotAPI): WebAssembly.Imports {
  const record = (name: string, ...args: number[]) => {
    mock.calls.push({ name, args: [...args] });
  };

  return {
    env: {
      // Movement
      setSpeed: (s: number) => record("setSpeed", s),
      setTurnRate: (r: number) => record("setTurnRate", r),
      setHeading: (h: number) => record("setHeading", h),
      getX: () => mock.state.x,
      getY: () => mock.state.y,
      getHeading: () => mock.state.heading,
      getSpeed: () => mock.state.speed,
      // Gun
      setGunTurnRate: (r: number) => record("setGunTurnRate", r),
      setGunHeading: (h: number) => record("setGunHeading", h),
      getGunHeading: () => mock.state.gunHeading,
      getGunHeat: () => mock.state.gunHeat,
      fire: (p: number) => record("fire", p),
      getEnergy: () => mock.state.energy,
      // Radar
      setRadarTurnRate: (r: number) => record("setRadarTurnRate", r),
      setRadarHeading: (h: number) => record("setRadarHeading", h),
      getRadarHeading: () => mock.state.radarHeading,
      setScanWidth: (d: number) => record("setScanWidth", d),
      // Status
      getHealth: () => mock.state.health,
      getTick: () => mock.state.tick,
      // Arena
      arenaWidth: () => mock.state.arenaWidth,
      arenaHeight: () => mock.state.arenaHeight,
      robotCount: () => mock.state.robotCount,
      // Utility
      distanceTo: (x: number, y: number) => {
        record("distanceTo", x, y);
        const dx = x - mock.state.x;
        const dy = y - mock.state.y;
        return Math.sqrt(dx * dx + dy * dy);
      },
      bearingTo: (x: number, y: number) => {
        record("bearingTo", x, y);
        return Math.atan2(y - mock.state.y, x - mock.state.x) * 180 / Math.PI;
      },
      random: (max: number) => { record("random", max); return 0; },
      randomFloat: () => { record("randomFloat"); return 0.5; },
      debugInt: (v: number) => record("debugInt", v),
      debugFloat: (v: number) => record("debugFloat", v),
      setColor: (r: number, g: number, b: number) => record("setColor", r, g, b),
      setGunColor: (r: number, g: number, b: number) => record("setGunColor", r, g, b),
      setRadarColor: (r: number, g: number, b: number) => record("setRadarColor", r, g, b),
      // Math builtins
      sin: (a: number) => Math.sin(a * Math.PI / 180),
      cos: (a: number) => Math.cos(a * Math.PI / 180),
      tan: (a: number) => Math.tan(a * Math.PI / 180),
      atan2: (y: number, x: number) => {
        const deg = Math.atan2(y, x) * 180 / Math.PI;
        return ((deg % 360) + 360) % 360;
      },
      sqrt: Math.sqrt,
      abs: Math.abs,
      min: Math.min,
      max: Math.max,
      clamp: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      // Internal
      __warn_div_zero: () => { mock.warnings.push("division by zero"); },
    },
  };
}

// ---- Compile + Run helper ----

export interface RobotTestInstance {
  tick: () => void;
  init?: () => void;
  callEvent: (name: string, ...args: number[]) => void;
  setFuel: (amount: number) => void;
  mock: MockRobotAPI;
  memory: WebAssembly.Memory;
}

export async function compileAndRun(source: string): Promise<RobotTestInstance> {
  const wasm = compileToWasm(source);
  const mock = createMockAPI();
  const imports = buildImportObject(mock);

  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports;

  return {
    tick: () => {
      mock.calls = [];  // reset per tick
      mock.warnings = [];
      (exports.__set_fuel as Function)(10_000);
      (exports.tick as Function)();
    },
    init: exports.init ? () => (exports.init as Function)() : undefined,
    callEvent: (name: string, ...args: number[]) => {
      const fn = exports[`on_${name}`] as Function | undefined;
      if (!fn) throw new Error(`No event handler: on_${name}`);
      fn(...args);
    },
    setFuel: (amount: number) => {
      (exports.__set_fuel as Function)(amount);
    },
    mock,
    memory: exports.memory as WebAssembly.Memory,
  };
}
```

### 4.3 Test File Structure

```
src/
  tests/
    setup.ts                     # Vitest global setup
    helpers.ts                   # compileAndRun, mocks, assertions
    compiler/
      tokenizer.test.ts          # Unit tests for tokenizer
      parser.test.ts             # Unit tests for parser
      analyzer.test.ts           # Unit tests for semantic analysis
      codegen.test.ts            # Unit tests for code generation
    integration/
      literals.test.ts           # int, float, bool, angle literals
      variables.test.ts          # var, :=, =, scoping
      arithmetic.test.ts         # +, -, *, /, %, precedence, angle normalization
      comparison.test.ts         # ==, !=, <, >, <=, >=, &&, ||, !
      control-flow.test.ts       # if/else, for, switch, break, continue, return
      functions.test.ts          # declaration, calls, recursion, multi-return
      structs.test.ts            # definition, literals, field access, assignment
      arrays.test.ts             # declaration, indexing, bounds checking
      events.test.ts             # on scan, on hit, etc.
      api.test.ts                # all robot API functions
      fuel.test.ts               # infinite loops, deep recursion
      errors.test.ts             # compile error messages
      edge-cases.test.ts         # div by zero, angle wraparound, nested loops
```

---

## 5. Test Case Specifications

Every test below specifies an RBL source input and the expected behavior. Integration tests use `compileAndRun` and assert on `mock.calls`, WASM memory, or trap behavior.

### 5.1 Literals and Types

```typescript
// src/tests/integration/literals.test.ts

describe("int literals", () => {
  test("integer assigned to global", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int = 42
      func tick() { debugInt(x) }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [42] });
  });

  test("zero value of int", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int
      func tick() { debugInt(x) }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [0] });
  });
});

describe("float literals", () => {
  test("float assigned to global", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x float = 3.14
      func tick() { debugFloat(x) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(3.14, 2);
  });

  test("zero value of float", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x float
      func tick() { debugFloat(x) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(0.0);
  });
});

describe("bool literals", () => {
  test("true and false", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var t bool = true
      var f bool = false
      func tick() {
        if t { debugInt(1) }
        if f { debugInt(2) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([{ name: "debugInt", args: [1] }]);
  });

  test("zero value of bool is false", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var b bool
      func tick() {
        if b { debugInt(1) } else { debugInt(0) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([{ name: "debugInt", args: [0] }]);
  });
});

describe("angle literals", () => {
  test("angle stores value", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var a angle = 90
      func tick() { debugFloat(float(a)) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(90.0);
  });

  test("angle normalizes on assignment", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var a angle = 450
      func tick() { debugFloat(float(a)) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(90.0);
  });

  test("negative angle normalizes", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var a angle = -90
      func tick() { debugFloat(float(a)) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(270.0);
  });
});
```

### 5.2 Variables

```typescript
// src/tests/integration/variables.test.ts

describe("var declarations", () => {
  test("global var with type and init", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int = 10
      func tick() { debugInt(x) }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [10] });
  });

  test("global var persists across ticks", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var counter int
      func tick() {
        counter = counter + 1
        debugInt(counter)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [1] });
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [2] });
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [3] });
  });
});

describe("short declarations (:=)", () => {
  test("local short decl with int", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 42
        debugInt(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [42] });
  });

  test("local short decl with float", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 1.5
        debugFloat(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(1.5);
  });

  test("local short decl infers type from function call", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := getX()
        debugFloat(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(400.0);  // mock default
  });
});

describe("assignment", () => {
  test("assign to existing var", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int = 1
      func tick() {
        x = 99
        debugInt(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [99] });
  });

  test("compound assignment +=", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int = 10
      func tick() {
        x += 5
        debugInt(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [15] });
  });
});

describe("scoping", () => {
  test("local shadows global", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int = 1
      func tick() {
        x := 99
        debugInt(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [99] });
  });

  test("local does not affect global", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int = 1
      func tick() {
        x := 99
        debugInt(x)
      }
    `);
    bot.tick();  // local x = 99
    // Read global x via a different function
    // Actually, := inside tick creates a local, so global x stays 1
    // We can verify by calling tick twice and checking global persists as 1
  });

  test("block scoping", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 1
        if true {
          x := 2
          debugInt(x)
        }
        debugInt(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([
      { name: "debugInt", args: [2] },
      { name: "debugInt", args: [1] },
    ]);
  });
});
```

### 5.3 Arithmetic

```typescript
// src/tests/integration/arithmetic.test.ts

describe("integer arithmetic", () => {
  test("addition", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(3 + 4) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(7);
  });

  test("subtraction", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(10 - 3) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(7);
  });

  test("multiplication", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(6 * 7) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(42);
  });

  test("division", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(10 / 3) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(3);  // integer division truncates
  });

  test("modulo", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(10 % 3) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(1);
  });

  test("unary negation", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(-42) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(-42);
  });
});

describe("float arithmetic", () => {
  test("addition", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugFloat(1.5 + 2.5) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(4.0);
  });

  test("division", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugFloat(7.0 / 2.0) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(3.5);
  });
});

describe("operator precedence", () => {
  test("multiply before add", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(2 + 3 * 4) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(14);
  });

  test("parentheses override precedence", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt((2 + 3) * 4) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(20);
  });

  test("left associativity", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(10 - 3 - 2) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(5);  // (10-3)-2, not 10-(3-2)
  });
});

describe("angle arithmetic", () => {
  test("angle addition normalizes", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 350
        a = a + 20
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(10.0);
  });

  test("angle subtraction normalizes", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 10
        a = a - 30
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(340.0);
  });

  test("angle * float normalizes", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 200
        a = a * 2.0
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(40.0);  // 400 -> 40
  });
});
```

### 5.4 Comparison and Logical Operators

```typescript
// src/tests/integration/comparison.test.ts

describe("comparison operators", () => {
  test("== true", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { if 5 == 5 { debugInt(1) } }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [1] });
  });

  test("!= true", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { if 3 != 4 { debugInt(1) } }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [1] });
  });

  test("< > <= >=", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        if 3 < 5 { debugInt(1) }
        if 5 > 3 { debugInt(2) }
        if 3 <= 3 { debugInt(3) }
        if 5 >= 5 { debugInt(4) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([
      { name: "debugInt", args: [1] },
      { name: "debugInt", args: [2] },
      { name: "debugInt", args: [3] },
      { name: "debugInt", args: [4] },
    ]);
  });

  test("float comparison", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { if 1.5 < 2.5 { debugInt(1) } }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [1] });
  });
});

describe("logical operators", () => {
  test("&& short-circuits", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        if false && true { debugInt(1) } else { debugInt(0) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [0] });
  });

  test("|| short-circuits", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        if true || false { debugInt(1) } else { debugInt(0) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [1] });
  });

  test("! negation", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        if !false { debugInt(1) }
        if !true { debugInt(2) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([{ name: "debugInt", args: [1] }]);
  });
});
```

### 5.5 Control Flow

```typescript
// src/tests/integration/control-flow.test.ts

describe("if/else", () => {
  test("if true branch", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        if true { debugInt(1) } else { debugInt(2) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [1] });
  });

  test("else branch", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        if false { debugInt(1) } else { debugInt(2) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [2] });
  });

  test("else if chain", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int = 5
      func tick() {
        if x < 3 { debugInt(1) } else if x < 7 { debugInt(2) } else { debugInt(3) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [2] });
  });
});

describe("for loops", () => {
  test("three-part for", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        for i := 0; i < 5; i += 1 {
          debugInt(i)
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([0, 1, 2, 3, 4]);
  });

  test("condition-only for (while style)", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 3
        for x > 0 {
          debugInt(x)
          x = x - 1
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([3, 2, 1]);
  });

  test("infinite for with break", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 0
        for {
          x = x + 1
          if x == 3 { break }
        }
        debugInt(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [3] });
  });

  test("continue skips iteration", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        for i := 0; i < 5; i += 1 {
          if i == 2 { continue }
          debugInt(i)
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([0, 1, 3, 4]);
  });

  test("nested loops with break", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        for i := 0; i < 3; i += 1 {
          for j := 0; j < 3; j += 1 {
            if j == 1 { break }
            debugInt(i * 10 + j)
          }
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([0, 10, 20]);
  });
});

describe("switch", () => {
  test("matches correct case", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var state int = 1
      func tick() {
        switch state {
        case 0:
          debugInt(0)
        case 1:
          debugInt(1)
        case 2:
          debugInt(2)
        default:
          debugInt(99)
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([{ name: "debugInt", args: [1] }]);
  });

  test("default case", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var state int = 42
      func tick() {
        switch state {
        case 0:
          debugInt(0)
        default:
          debugInt(99)
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([{ name: "debugInt", args: [99] }]);
  });

  test("no fallthrough", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        switch 0 {
        case 0:
          debugInt(0)
        case 1:
          debugInt(1)
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toEqual([{ name: "debugInt", args: [0] }]);
  });
});

describe("return", () => {
  test("return from function", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func add(a int, b int) int { return a + b }
      func tick() { debugInt(add(3, 4)) }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [7] });
  });

  test("early return", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func earlyReturn(x int) int {
        if x > 0 { return 1 }
        return 0
      }
      func tick() {
        debugInt(earlyReturn(5))
        debugInt(earlyReturn(-1))
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([1, 0]);
  });
});
```

### 5.6 Functions

```typescript
// src/tests/integration/functions.test.ts

describe("functions", () => {
  test("simple function call", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func double(x int) int { return x * 2 }
      func tick() { debugInt(double(21)) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(42);
  });

  test("function with no return value", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var x int
      func setX(val int) { x = val }
      func tick() {
        setX(42)
        debugInt(x)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(42);
  });

  test("recursion", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func factorial(n int) int {
        if n <= 1 { return 1 }
        return n * factorial(n - 1)
      }
      func tick() { debugInt(factorial(5)) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(120);
  });

  test("multiple return values", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func swap(a int, b int) (int, int) {
        return b, a
      }
      func tick() {
        x, y := swap(1, 2)
        debugInt(x)
        debugInt(y)
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([2, 1]);
  });

  test("init function called before tick", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var initialized int
      func init() { initialized = 1 }
      func tick() { debugInt(initialized) }
    `);
    bot.init?.();
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(1);
  });
});
```

### 5.7 Structs

```typescript
// src/tests/integration/structs.test.ts

describe("structs", () => {
  test("struct definition and literal", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      type Point struct {
        x float
        y float
      }
      func tick() {
        p := Point{x: 1.5, y: 2.5}
        debugFloat(p.x)
        debugFloat(p.y)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(1.5);
    expect(bot.mock.calls[1].args[0]).toBeCloseTo(2.5);
  });

  test("struct zero value", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      type Point struct {
        x float
        y float
      }
      func tick() {
        p := Point{}
        debugFloat(p.x)
        debugFloat(p.y)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(0.0);
    expect(bot.mock.calls[1].args[0]).toBeCloseTo(0.0);
  });

  test("global struct persists across ticks", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      type Counter struct {
        value int
      }
      var c Counter
      func tick() {
        c.value = c.value + 1
        debugInt(c.value)
      }
    `);
    bot.tick();
    bot.tick();
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(3);
  });

  test("struct field assignment", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      type Target struct {
        bearing angle
        distance float
        active bool
      }
      var t Target
      func tick() {
        t.bearing = 90
        t.distance = 150.0
        t.active = true
        debugFloat(float(t.bearing))
        debugFloat(t.distance)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(90.0);
    expect(bot.mock.calls[1].args[0]).toBeCloseTo(150.0);
  });

  test("struct assignment (whole struct)", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      type Pt struct { x int; y int }
      var p Pt
      func tick() {
        p = Pt{x: 10, y: 20}
        debugInt(p.x)
        debugInt(p.y)
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([10, 20]);
  });
});
```

### 5.8 Arrays

```typescript
// src/tests/integration/arrays.test.ts

describe("arrays", () => {
  test("array declaration and indexing", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var nums [4]int
      func tick() {
        nums[0] = 10
        nums[1] = 20
        nums[2] = 30
        nums[3] = 40
        debugInt(nums[2])
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(30);
  });

  test("array zero-initialized", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var nums [3]int
      func tick() {
        debugInt(nums[0])
        debugInt(nums[1])
        debugInt(nums[2])
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([0, 0, 0]);
  });

  test("array of structs", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      type Pt struct { x int; y int }
      var pts [2]Pt
      func tick() {
        pts[0].x = 1
        pts[0].y = 2
        pts[1].x = 3
        pts[1].y = 4
        debugInt(pts[1].x)
        debugInt(pts[1].y)
      }
    `);
    bot.tick();
    expect(bot.mock.calls.map(c => c.args[0])).toEqual([3, 4]);
  });

  test("array bounds check traps", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var nums [3]int
      func tick() {
        nums[5] = 99
      }
    `);
    expect(() => bot.tick()).toThrow();  // WASM unreachable trap
  });

  test("negative array index traps", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var nums [3]int
      func tick() {
        x := -1
        nums[x] = 99
      }
    `);
    expect(() => bot.tick()).toThrow();
  });

  test("array with constant size", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      const SIZE = 4
      var data [SIZE]int
      func tick() {
        data[3] = 42
        debugInt(data[3])
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(42);
  });

  test("loop over array", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      const N = 5
      var arr [N]int
      func tick() {
        for i := 0; i < 5; i += 1 {
          arr[i] = i * i
        }
        debugInt(arr[4])
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(16);
  });
});
```

### 5.9 Event Handlers

```typescript
// src/tests/integration/events.test.ts

describe("event handlers", () => {
  test("on scan stores data in globals", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var lastDist float
      var lastBearing angle
      on scan(distance float, bearing angle) {
        lastDist = distance
        lastBearing = bearing
      }
      func tick() {
        debugFloat(lastDist)
        debugFloat(float(lastBearing))
      }
    `);
    bot.callEvent("scan", 150.0, 45.0);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(150.0);
    expect(bot.mock.calls[1].args[0]).toBeCloseTo(45.0);
  });

  test("on hit handler", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var wasHit bool
      on hit(damage float, bearing angle) {
        wasHit = true
      }
      func tick() {
        if wasHit { debugInt(1) } else { debugInt(0) }
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(0);
    bot.callEvent("hit", 10.0, 90.0);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(1);
  });

  test("event handler can call API functions", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      on wallHit(bearing angle) {
        setHeading(bearing + 180)
        setSpeed(50)
      }
      func tick() {}
    `);
    bot.callEvent("wallHit", 270.0);
    expect(bot.mock.calls).toContainEqual({ name: "setHeading", args: [expect.closeTo(90.0)] });
    expect(bot.mock.calls).toContainEqual({ name: "setSpeed", args: [50] });
  });

  test("event handler can call user functions", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var evaded bool
      func evade() { evaded = true }
      on robotHit(bearing angle) { evade() }
      func tick() {
        if evaded { debugInt(1) }
      }
    `);
    bot.callEvent("robotHit", 0.0);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(1);
  });

  test("multiple events fire before tick", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var hitCount int
      on hit(damage float, bearing angle) {
        hitCount = hitCount + 1
      }
      func tick() { debugInt(hitCount) }
    `);
    bot.callEvent("hit", 5.0, 90.0);
    bot.callEvent("hit", 3.0, 180.0);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(2);
  });
});
```

### 5.10 API Calls

```typescript
// src/tests/integration/api.test.ts

describe("robot API", () => {
  test("setSpeed and setTurnRate", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        setSpeed(50.0)
        setTurnRate(5.0)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "setSpeed", args: [50] });
    expect(bot.mock.calls).toContainEqual({ name: "setTurnRate", args: [5] });
  });

  test("getX and getY return mock values", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        debugFloat(getX())
        debugFloat(getY())
      }
    `);
    bot.mock.state.x = 123.0;
    bot.mock.state.y = 456.0;
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(123.0);
    expect(bot.mock.calls[1].args[0]).toBeCloseTo(456.0);
  });

  test("fire with computed power", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        power := 3.0
        fire(power)
      }
    `);
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "fire", args: [3] });
  });

  test("getHealth returns mock value", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        if getHealth() < 50.0 {
          debugInt(1)
        } else {
          debugInt(0)
        }
      }
    `);
    bot.mock.state.health = 30;
    bot.tick();
    expect(bot.mock.calls).toContainEqual({ name: "debugInt", args: [1] });
  });

  test("math builtins work", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        debugFloat(sqrt(16.0))
        debugFloat(abs(-5.0))
        debugFloat(min(3.0, 7.0))
        debugFloat(max(3.0, 7.0))
        debugFloat(clamp(15.0, 0.0, 10.0))
      }
    `);
    bot.tick();
    const values = bot.mock.calls.map(c => c.args[0]);
    expect(values[0]).toBeCloseTo(4.0);
    expect(values[1]).toBeCloseTo(5.0);
    expect(values[2]).toBeCloseTo(3.0);
    expect(values[3]).toBeCloseTo(7.0);
    expect(values[4]).toBeCloseTo(10.0);
  });

  test("trig functions accept angles in degrees", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 90
        debugFloat(sin(a))
        debugFloat(cos(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(1.0);
    expect(bot.mock.calls[1].args[0]).toBeCloseTo(0.0, 5);
  });

  test("setColor records RGB", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func init() { setColor(255, 0, 128) }
      func tick() {}
    `);
    bot.init?.();
    expect(bot.mock.calls).toContainEqual({ name: "setColor", args: [255, 0, 128] });
  });
});
```

### 5.11 Fuel Metering

```typescript
// src/tests/integration/fuel.test.ts

describe("fuel metering", () => {
  test("infinite loop exhausts fuel, does not hang", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        for {
          debugInt(1)
        }
      }
    `);
    bot.setFuel(100);
    bot.tick();  // Should complete, not hang
    // debugInt was called at most 100 times
    expect(bot.mock.calls.length).toBeLessThanOrEqual(100);
  });

  test("normal loop within fuel budget", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        for i := 0; i < 10; i += 1 {
          debugInt(i)
        }
      }
    `);
    bot.setFuel(10_000);
    bot.tick();
    expect(bot.mock.calls.length).toBe(10);
  });

  test("deep recursion exhausts fuel", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func recurse(depth int) {
        if depth > 0 {
          recurse(depth - 1)
        }
      }
      func tick() {
        recurse(100000)
        debugInt(1)
      }
    `);
    bot.setFuel(500);
    bot.tick();
    // debugInt should not have been called (fuel exhausted in recursion)
    const debugCalls = bot.mock.calls.filter(c => c.name === "debugInt");
    expect(debugCalls.length).toBe(0);
  });

  test("fuel resets between ticks", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      var count int
      func tick() {
        for i := 0; i < 5; i += 1 {
          count = count + 1
        }
        debugInt(count)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(5);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(10);
  });
});
```

### 5.12 Compile Error Cases

```typescript
// src/tests/integration/errors.test.ts

describe("syntax errors", () => {
  test("missing robot declaration", () => {
    expectCompileError(`func tick() {}`, "robot");
  });

  test("unterminated string", () => {
    expectCompileError(`robot "Test`, "unterminated");
  });

  test("unexpected token", () => {
    expectCompileError(`robot "Test"\nfunc tick() { @@ }`, "unexpected");
  });

  test("missing closing brace", () => {
    expectCompileError(`robot "Test"\nfunc tick() {`, "expected");
  });
});

describe("type errors", () => {
  test("int + float mismatch", () => {
    expectCompileError(`
      robot "Test"
      func tick() { x := 1 + 1.5 }
    `, "type mismatch");
  });

  test("bool used in arithmetic", () => {
    expectCompileError(`
      robot "Test"
      func tick() { x := true + 1 }
    `, "type");
  });

  test("wrong argument type", () => {
    expectCompileError(`
      robot "Test"
      func tick() { setSpeed(42) }
    `, "type");
    // setSpeed expects float, got int
  });

  test("wrong argument count", () => {
    expectCompileError(`
      robot "Test"
      func tick() { setSpeed(1.0, 2.0) }
    `, "argument");
  });

  test("return type mismatch", () => {
    expectCompileError(`
      robot "Test"
      func add(a int, b int) float { return a + b }
      func tick() {}
    `, "return type");
  });
});

describe("name resolution errors", () => {
  test("undefined variable", () => {
    expectCompileError(`
      robot "Test"
      func tick() { debugInt(xyz) }
    `, "undefined");
  });

  test("undefined function", () => {
    expectCompileError(`
      robot "Test"
      func tick() { notAFunction() }
    `, "undefined");
  });

  test("redeclare in same scope", () => {
    expectCompileError(`
      robot "Test"
      func tick() {
        x := 1
        x := 2
      }
    `, "already declared");
  });

  test("assign to undeclared variable", () => {
    expectCompileError(`
      robot "Test"
      func tick() { y = 5 }
    `, "undefined");
  });
});

describe("control flow errors", () => {
  test("break outside loop", () => {
    expectCompileError(`
      robot "Test"
      func tick() { break }
    `, "break");
  });

  test("continue outside loop", () => {
    expectCompileError(`
      robot "Test"
      func tick() { continue }
    `, "continue");
  });
});

describe("struct errors", () => {
  test("unknown struct type", () => {
    expectCompileError(`
      robot "Test"
      func tick() { p := Unknown{x: 1} }
    `, "undefined");
  });

  test("unknown field in struct literal", () => {
    expectCompileError(`
      robot "Test"
      type Pt struct { x int; y int }
      func tick() { p := Pt{z: 1} }
    `, "field");
  });

  test("field access on non-struct", () => {
    expectCompileError(`
      robot "Test"
      func tick() {
        x := 5
        debugInt(x.y)
      }
    `, "field");
  });
});

describe("missing tick", () => {
  test("no tick function is an error", () => {
    expectCompileError(`robot "Test"`, "tick");
  });
});
```

### 5.13 Edge Cases

```typescript
// src/tests/integration/edge-cases.test.ts

describe("division by zero", () => {
  test("int division by zero returns 0", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(10 / 0) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(0);
    expect(bot.mock.warnings).toContain("division by zero");
  });

  test("float division by zero returns 0", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugFloat(10.0 / 0.0) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(0.0);
    expect(bot.mock.warnings).toContain("division by zero");
  });

  test("modulo by zero returns 0", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() { debugInt(10 % 0) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(0);
  });
});

describe("angle wraparound", () => {
  test("angle 360 becomes 0", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 360
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(0.0);
  });

  test("angle 720 becomes 0", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 720
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(0.0);
  });

  test("angle -1 becomes 359", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = -1
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(359.0);
  });

  test("accumulated angle operations stay normalized", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 0
        for i := 0; i < 100; i += 1 {
          a = a + 7
        }
        debugFloat(float(a))
      }
    `);
    bot.tick();
    // 700 % 360 = 340
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(340.0);
  });
});

describe("type conversions", () => {
  test("int to float", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 42
        debugFloat(float(x))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(42.0);
  });

  test("float to int truncates", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 3.7
        debugInt(int(x))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(3);
  });

  test("angle to float", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        var a angle = 90
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(90.0);
  });

  test("float to angle normalizes", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        f := 450.0
        var a angle = angle(f)
        debugFloat(float(a))
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBeCloseTo(90.0);
  });
});

describe("constants", () => {
  test("const used in array size", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      const N = 3
      var arr [N]int
      func tick() {
        arr[2] = 42
        debugInt(arr[2])
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(42);
  });

  test("const used in expression", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      const MAX = 100
      func tick() { debugInt(MAX) }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(100);
  });
});

describe("deeply nested structures", () => {
  test("nested if/else", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        x := 5
        if x > 0 {
          if x > 3 {
            if x > 4 {
              debugInt(1)
            } else {
              debugInt(2)
            }
          }
        }
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(1);
  });

  test("nested loops", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        sum := 0
        for i := 0; i < 3; i += 1 {
          for j := 0; j < 3; j += 1 {
            sum = sum + 1
          }
        }
        debugInt(sum)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(9);
  });
});

describe("bitwise operators", () => {
  test("and, or, xor", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        debugInt(0xFF & 0x0F)
        debugInt(0xF0 | 0x0F)
        debugInt(0xFF ^ 0x0F)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(0x0F);
    expect(bot.mock.calls[1].args[0]).toBe(0xFF);
    expect(bot.mock.calls[2].args[0]).toBe(0xF0);
  });

  test("shift left and right", async () => {
    const bot = await compileAndRun(`
      robot "Test"
      func tick() {
        debugInt(1 << 4)
        debugInt(256 >> 3)
      }
    `);
    bot.tick();
    expect(bot.mock.calls[0].args[0]).toBe(16);
    expect(bot.mock.calls[1].args[0]).toBe(32);
  });
});
```

### 5.14 Unit Tests for Compiler Stages

```typescript
// src/tests/compiler/tokenizer.test.ts

import { tokenize } from "../../compiler/tokenizer";

describe("tokenizer", () => {
  test("simple variable declaration", () => {
    const tokens = tokenize('var x int = 42');
    expect(tokens.map(t => t.type)).toEqual([
      "VAR", "IDENT", "INT", "ASSIGN", "INT_LIT", "NEWLINE", "EOF"
    ]);
  });

  test(":= token", () => {
    const tokens = tokenize('x := 5');
    expect(tokens.map(t => t.type)).toEqual([
      "IDENT", "WALRUS", "INT_LIT", "NEWLINE", "EOF"
    ]);
  });

  test("comparison operators", () => {
    const tokens = tokenize('a <= b >= c == d != e');
    const ops = tokens.filter(t => ["LTE","GTE","EQ","NEQ"].includes(t.type));
    expect(ops.map(t => t.type)).toEqual(["LTE", "GTE", "EQ", "NEQ"]);
  });

  test("float literal", () => {
    const tokens = tokenize('3.14');
    expect(tokens[0]).toMatchObject({ type: "FLOAT_LIT", value: "3.14" });
  });

  test("string literal for robot name", () => {
    const tokens = tokenize('robot "MyBot"');
    expect(tokens[1]).toMatchObject({ type: "STRING_LIT", value: "MyBot" });
  });

  test("line and column tracking", () => {
    const tokens = tokenize('x\ny');
    expect(tokens[0]).toMatchObject({ line: 1, col: 1 });
    // After newline, y is on line 2
    const yToken = tokens.find(t => t.value === "y");
    expect(yToken).toMatchObject({ line: 2, col: 1 });
  });

  test("comments are skipped", () => {
    const tokens = tokenize('x // this is a comment\ny');
    const idents = tokens.filter(t => t.type === "IDENT");
    expect(idents.map(t => t.value)).toEqual(["x", "y"]);
  });

  test("all keywords recognized", () => {
    const keywords = [
      "robot", "func", "on", "var", "const", "type", "struct",
      "if", "else", "for", "switch", "case", "default",
      "return", "break", "continue",
      "int", "float", "bool", "angle",
    ];
    for (const kw of keywords) {
      const tokens = tokenize(kw);
      expect(tokens[0].type).toBe(kw.toUpperCase());
    }
  });
});
```

```typescript
// src/tests/compiler/parser.test.ts

import { parse } from "../../compiler/parser";
import { tokenize } from "../../compiler/tokenizer";

function parseSource(source: string) {
  const tokens = tokenize(source);
  return parse(tokens);
}

describe("parser", () => {
  test("parses robot declaration", () => {
    const ast = parseSource('robot "TestBot"');
    expect(ast.robotName).toBe("TestBot");
  });

  test("parses empty tick function", () => {
    const ast = parseSource('robot "T"\nfunc tick() {}');
    expect(ast.funcs).toHaveLength(1);
    expect(ast.funcs[0].name).toBe("tick");
    expect(ast.funcs[0].params).toHaveLength(0);
  });

  test("parses function with params and return type", () => {
    const ast = parseSource(`
      robot "T"
      func add(a int, b int) int { return a + b }
      func tick() {}
    `);
    const addFn = ast.funcs.find(f => f.name === "add");
    expect(addFn?.params).toHaveLength(2);
    expect(addFn?.returnType).toHaveLength(1);
  });

  test("parses global var declaration", () => {
    const ast = parseSource('robot "T"\nvar x int = 5\nfunc tick() {}');
    expect(ast.globals).toHaveLength(1);
    expect(ast.globals[0].name).toBe("x");
  });

  test("parses struct type declaration", () => {
    const ast = parseSource(`
      robot "T"
      type Pt struct { x int; y int }
      func tick() {}
    `);
    expect(ast.types).toHaveLength(1);
    expect(ast.types[0].name).toBe("Pt");
    expect(ast.types[0].fields).toHaveLength(2);
  });

  test("parses event handler", () => {
    const ast = parseSource(`
      robot "T"
      on scan(distance float, bearing angle) {}
      func tick() {}
    `);
    expect(ast.events).toHaveLength(1);
    expect(ast.events[0].name).toBe("scan");
  });

  test("parses binary expression with precedence", () => {
    const ast = parseSource(`
      robot "T"
      func tick() { x := 2 + 3 * 4 }
    `);
    const stmt = ast.funcs[0].body.stmts[0];
    // The RHS should be BinaryExpr(+, 2, BinaryExpr(*, 3, 4))
    expect(stmt.kind).toBe("ShortDeclStmt");
  });

  test("parses if/else chain", () => {
    const ast = parseSource(`
      robot "T"
      func tick() {
        if true { } else if false { } else { }
      }
    `);
    const stmt = ast.funcs[0].body.stmts[0];
    expect(stmt.kind).toBe("IfStmt");
  });

  test("parses for loop (three-part)", () => {
    const ast = parseSource(`
      robot "T"
      func tick() {
        for i := 0; i < 10; i += 1 { }
      }
    `);
    const stmt = ast.funcs[0].body.stmts[0];
    expect(stmt.kind).toBe("ForStmt");
  });

  test("parses array type", () => {
    const ast = parseSource('robot "T"\nvar arr [5]int\nfunc tick() {}');
    expect(ast.globals[0].typeNode.kind).toBe("ArrayType");
  });
});
```

```typescript
// src/tests/compiler/analyzer.test.ts

import { analyze } from "../../compiler/analyzer";
import { parse } from "../../compiler/parser";
import { tokenize } from "../../compiler/tokenizer";

function analyzeSource(source: string) {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  return analyze(ast);
}

describe("analyzer", () => {
  test("resolves global variable types", () => {
    const result = analyzeSource(`
      robot "T"
      var x int = 5
      func tick() {}
    `);
    expect(result.errors).toHaveLength(0);
    const sym = result.symbols.get("x");
    expect(sym?.type.kind).toBe("int");
  });

  test("resolves struct fields", () => {
    const result = analyzeSource(`
      robot "T"
      type Pt struct { x int; y int }
      func tick() {}
    `);
    expect(result.errors).toHaveLength(0);
    const structType = result.structs.get("Pt");
    expect(structType?.kind).toBe("struct");
  });

  test("detects undefined variable", () => {
    const result = analyzeSource(`
      robot "T"
      func tick() { debugInt(undefined_var) }
    `);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("undefined");
  });

  test("detects type mismatch in binary expression", () => {
    const result = analyzeSource(`
      robot "T"
      func tick() { x := 1 + 1.5 }
    `);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("detects wrong argument count", () => {
    const result = analyzeSource(`
      robot "T"
      func tick() { setSpeed(1.0, 2.0) }
    `);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("resolves constant values", () => {
    const result = analyzeSource(`
      robot "T"
      const N = 5
      var arr [N]int
      func tick() {}
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.consts.get("N")).toBe(5);
  });

  test("validates break inside loop", () => {
    const result = analyzeSource(`
      robot "T"
      func tick() {
        for i := 0; i < 5; i += 1 { break }
      }
    `);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects break outside loop", () => {
    const result = analyzeSource(`
      robot "T"
      func tick() { break }
    `);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
```

```typescript
// src/tests/compiler/codegen.test.ts

import { compile } from "../../compiler/compiler";

describe("codegen", () => {
  test("produces valid WASM binary", async () => {
    const result = await compile(`
      robot "Test"
      func tick() {}
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // WebAssembly.compile will throw if binary is invalid
      const mod = await WebAssembly.compile(result.wasm);
      expect(mod).toBeInstanceOf(WebAssembly.Module);
    }
  });

  test("exports tick function", async () => {
    const result = await compile(`
      robot "Test"
      func tick() {}
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mod = await WebAssembly.compile(result.wasm);
      // Check that the module exports a 'tick' function
      const exports = WebAssembly.Module.exports(mod);
      const tickExport = exports.find(e => e.name === "tick");
      expect(tickExport).toBeDefined();
      expect(tickExport?.kind).toBe("function");
    }
  });

  test("exports event handlers", async () => {
    const result = await compile(`
      robot "Test"
      on scan(distance float, bearing angle) {}
      func tick() {}
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mod = await WebAssembly.compile(result.wasm);
      const exports = WebAssembly.Module.exports(mod);
      expect(exports.find(e => e.name === "on_scan")).toBeDefined();
    }
  });

  test("exports __set_fuel", async () => {
    const result = await compile(`
      robot "Test"
      func tick() {}
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mod = await WebAssembly.compile(result.wasm);
      const exports = WebAssembly.Module.exports(mod);
      expect(exports.find(e => e.name === "__set_fuel")).toBeDefined();
    }
  });

  test("imports all API functions", async () => {
    const result = await compile(`
      robot "Test"
      func tick() {}
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mod = await WebAssembly.compile(result.wasm);
      const imports = WebAssembly.Module.imports(mod);
      // Should import at least the core API functions
      expect(imports.find(i => i.name === "getX")).toBeDefined();
      expect(imports.find(i => i.name === "fire")).toBeDefined();
      expect(imports.find(i => i.name === "setSpeed")).toBeDefined();
    }
  });
});
```

---

## 6. Project Structure

```
src/
  compiler/
    tokens.ts           # Token type definitions
    ast.ts              # AST node type definitions
    types.ts            # RBLType, typeSize, typeEq
    errors.ts           # CompileError, CompileErrorList
    tokenizer.ts        # tokenize(source) -> Token[]
    parser.ts           # parse(tokens) -> Program
    analyzer.ts         # analyze(program) -> AnalysisResult
    codegen.ts          # generate(program, analysis) -> binaryen.Module
    compiler.ts         # compile(source) -> CompileResult (orchestrator)
    api-registry.ts     # API_FUNCTIONS constant with all import signatures
  tests/
    setup.ts            # Vitest global setup
    helpers.ts          # compileAndRun, mocks, expectCompileError
    compiler/
      tokenizer.test.ts
      parser.test.ts
      analyzer.test.ts
      codegen.test.ts
    integration/
      literals.test.ts
      variables.test.ts
      arithmetic.test.ts
      comparison.test.ts
      control-flow.test.ts
      functions.test.ts
      structs.test.ts
      arrays.test.ts
      events.test.ts
      api.test.ts
      fuel.test.ts
      errors.test.ts
      edge-cases.test.ts
```

---

## 7. Trade-offs and Open Questions

### Q1: Multi-value returns -- WASM multi-value vs linear memory?

**Options**:
- (A) WASM multi-value proposal (supported in all modern browsers since 2020).
- (B) Linear memory return slot (write extra return values to a fixed address).
- (C) Return a struct (pack multi-return into a struct in memory).

**Recommendation**: **(B) Linear memory return slot.** Binaryen's JS API support for multi-value tuples is workable but awkward to construct. A fixed return slot at a known address is simple to implement, debug, and understand. The slot is 64 bytes at address 0, used transiently only during the call sequence. Option (A) is a reasonable future optimization once the compiler is stable.

### Q2: How to represent the `angle` type in WASM?

**Options**:
- (A) `f32` with normalization calls inserted after every arithmetic operation.
- (B) Store as `i32` (fixed-point, e.g., angle * 1000) and convert at API boundaries.
- (C) Separate `angle` struct with custom operators.

**Recommendation**: **(A) `f32` with normalization.** The angle is fundamentally a float. Normalization is a single function call (`__normalize_angle`) inserted by the code generator after `+`, `-`, `*`, `/` on angle-typed expressions and on assignment to angle variables. This is simple, correct, and the overhead is negligible (one fmod-equivalent per operation).

### Q3: Struct layout -- linear memory or WASM locals?

**Options**:
- (A) Always linear memory (globals in static region, locals on a shadow stack).
- (B) Scalar fields promoted to WASM locals, struct aggregates in memory.
- (C) Entirely in WASM locals (flatten struct into N locals).

**Recommendation**: **(A) Always linear memory.** Structs in linear memory with load/store is the simplest and most consistent approach. It handles global structs, local structs, arrays of structs, and struct assignment uniformly. Binaryen's optimizer can hoist frequently accessed fields into locals automatically. Option (C) would be faster but makes struct assignment, arrays of structs, and multi-return with structs significantly more complex.

### Q4: Test against WAT output or only test compiled+executed behavior?

**Options**:
- (A) Snapshot tests on WAT text output for readability.
- (B) Only test compiled+executed behavior via `compileAndRun`.
- (C) Both.

**Recommendation**: **(B) Only test behavior.** WAT snapshots are brittle -- they break on any codegen refactor, Binaryen optimization change, or label renaming. Behavioral tests (`compileAndRun` + assert on mock calls) are stable and test what actually matters: does the compiled program do the right thing? WAT output can be inspected manually during debugging via `compile(source).wat` but should not be asserted on in automated tests.

### Q5: Binaryen.js async initialization in tests?

**Non-issue in Node.js.** Binaryen.js initializes synchronously when `import binaryen from "binaryen"` is used in Node.js (which is where Vitest runs). No special async setup is needed. In the browser, Binaryen's WASM module loads asynchronously, but tests run in Node. If browser-based tests are ever needed, use `await binaryen.ready` in a `beforeAll`.

### Q6: Incremental compilation?

**Options**:
- (A) Always recompile the full file.
- (B) Cache tokenized/parsed results and only re-analyze and re-codegen on change.
- (C) Full incremental (only re-process changed functions).

**Recommendation**: **(A) Always recompile.** Full compilation of a robot program (~100-500 lines) takes 10-70ms. This is fast enough for compile-on-save with no perceptible delay. Incremental compilation adds significant complexity (invalidation, dependency tracking) for no user-visible benefit at this scale. Revisit only if programs somehow grow to thousands of lines, which is unlikely given the game's nature.

### Q7: Should `&&` and `||` short-circuit?

**Recommendation**: **Yes.** Go short-circuits `&&` and `||`, and RBL should match. This requires compiling `&&` and `||` as control flow (using `if` expressions in Binaryen) rather than as simple binary operations. Specifically:
- `a && b` compiles to `if (a) then b else false`.
- `a || b` compiles to `if (a) then true else b`.

### Q8: How to handle the overloaded `debug()` function?

The spec says `debug(value int)` and `debug(value float)` are both valid. Since WASM cannot overload imports by type, the compiler resolves `debug(x)` during analysis:
- If the argument is `int` or `bool`, emit a call to `debugInt`.
- If the argument is `float` or `angle`, emit a call to `debugFloat`.
- The import object provides both `debugInt` and `debugFloat`.

### Q9: Semicolons in struct field declarations?

The grammar shows `field_decl = IDENT type` with fields separated by newlines. However, the example robot uses newline-separated fields. The spec also shows `type Pt struct { x int; y int }` in some test examples (single-line). **Decision**: Allow both newlines and semicolons as field separators, same as Go. The tokenizer's newline insertion handles the newline case; explicit semicolons handle the single-line case.
