# RBL Language Reference

RBL (Robot Battle Language) is a statically typed, imperative language for programming battle robots. Programs are compiled to WebAssembly and executed by the simulation engine. This document specifies the complete syntax and semantics of the language. For the complete list of built-in functions, see the [Standard Library Reference](../reference/stdlib.md). For a guided introduction, see the [Tutorial](../tutorial/writing-a-bot.md).

## Program Structure

Every RBL program must begin with a `robot` declaration, followed by top-level declarations in any order. The required structure is:

```rbl
robot "Name"

// Top-level declarations (any order):
const MY_CONST = 42
type MyStruct struct { ... }
var myGlobal int = 0
func init() { ... }
func tick() { ... }
on scan(distance float, bearing angle) { ... }
```

A program must define at least a `tick()` function. The `tick()` function must take no parameters and return no values. An optional `init()` function is called once when the robot is first instantiated.

### Top-Level Declaration Kinds

| Declaration | Syntax | Purpose |
|---|---|---|
| Robot name | `robot "Name"` | Names the robot. Must be the first line. |
| Constant | `const NAME = expr` | Compile-time constant value. |
| Type | `type Name struct { ... }` | Defines a struct type. |
| Global variable | `var name type` or `var name type = expr` | Module-level mutable variable. |
| Function | `func name(params) returnType { ... }` | User-defined function. |
| Event handler | `on eventName(params) { ... }` | Responds to simulation events. |

## Types

RBL has four primitive types, plus arrays and structs.

### Primitive Types

| Type | WASM representation | Size | Description |
|---|---|---|---|
| `int` | `i32` | 4 bytes | 32-bit signed integer |
| `float` | `f32` | 4 bytes | 32-bit floating-point number |
| `angle` | `f32` | 4 bytes | Floating-point value representing degrees |
| `bool` | `i32` | 4 bytes | Boolean (true = 1, false = 0) |

The `void` type exists internally but is not expressible in source code. Functions with no return type annotation are void.

### Angle Type

The `angle` type is a distinct numeric type stored as `f32`. It represents a value in degrees. Angle values follow special arithmetic rules:

- **angle + angle** and **angle - angle** produce an `angle`.
- **angle * float** and **angle / float** produce an `angle`. The angle operand must be on the left side.
- **float * angle** is a type error. Write `angle * float` instead.
- **angle * angle** and **angle / angle** are type errors.
- Comparisons between two angles are allowed.

Angle values are not automatically wrapped to [0, 360) at the language level. Wrapping occurs within API functions that interpret angles (such as `setHeading`).

### Arrays

Arrays have a fixed size known at compile time. The syntax for an array type is `[N]ElementType`, where `N` is an integer literal.

```rbl
var scores [5]int
var positions [3]float
var grid [4][4]int        // array of arrays
```

Array literals use bracket syntax:

```rbl
scores := [1, 2, 3, 4, 5]
```

All elements of an array literal must have the same type. Empty array literals are not allowed. Array indexing uses zero-based integer indices. Out-of-bounds access triggers a WASM trap (unreachable).

### Structs

Structs are user-defined composite types declared at the top level with `type ... struct`:

```rbl
type Point struct {
    x float
    y float
}

type Enemy struct {
    pos Point
    dist float
    alive bool
}
```

Struct literals use the type name followed by field initializers in braces:

```rbl
p := Point{ x: 1.0, y: 2.0 }
e := Enemy{ pos: p, dist: 100.0, alive: true }
```

Fields are accessed with dot notation: `p.x`, `e.pos.y`.

Struct names must be declared with `type` before use. The parser pre-scans for `type` declarations so struct literal syntax is unambiguous.

## Variables

### Global Variables

Global variables are declared at the top level with `var`:

```rbl
var counter int
var speed float = 50.0
var heading angle = angle(90)
```

Global variables are stored in WASM linear memory. They persist across tick calls within a round. Uninitialized globals are zero-filled.

### Local Variables

Local variables are declared inside function or event bodies using either `var` or the short declaration operator `:=`.

**Typed declaration:**

```rbl
var x int = 10
var name float
```

**Short declaration (type inferred):**

```rbl
x := 10
speed := 50.0
heading := angle(90)
dist, bearing := getDistAndBearing()  // multi-return destructuring
```

The short declaration operator `:=` infers the type from the right-hand side expression. Multiple names can be declared at once from a multi-return function call.

Local variables are stored as WASM locals (for primitives) or in linear memory (for arrays and structs).

### Constants

Constants are declared at the top level with `const`:

```rbl
const MAX_SPEED = 120
const PI = 3.14159
const HALF_TURN = -180
```

Constant values must be compile-time evaluable: integer literals, float literals, boolean literals, negation of a constant, or a reference to another constant. Constants are inlined at every use site.

## Operators

### Arithmetic Operators

| Operator | Types | Result | Notes |
|---|---|---|---|
| `+` | int + int | int | |
| `+` | float + float | float | |
| `+` | angle + angle | angle | |
| `-` | int - int | int | |
| `-` | float - float | float | |
| `-` | angle - angle | angle | |
| `*` | int * int | int | |
| `*` | float * float | float | |
| `*` | angle * float | angle | angle must be on the left |
| `/` | int / int | int | Integer division, truncates toward zero |
| `/` | float / float | float | |
| `/` | angle / float | angle | angle must be on the left |
| `%` | int % int | int | Modulo, int operands only |

### Comparison Operators

| Operator | Description | Operand requirement |
|---|---|---|
| `==` | Equal | Both operands must have the same type |
| `!=` | Not equal | Both operands must have the same type |
| `<` | Less than | Both operands must be the same numeric type |
| `>` | Greater than | Both operands must be the same numeric type |
| `<=` | Less or equal | Both operands must be the same numeric type |
| `>=` | Greater or equal | Both operands must be the same numeric type |

All comparison operators return `bool`.

### Logical Operators

| Operator | Description | Operand requirement |
|---|---|---|
| `&&` | Logical AND | Both operands must be `bool` |
| `||` | Logical OR | Both operands must be `bool` |
| `!` | Logical NOT (unary) | Operand must be `bool` |

`&&` and `||` use short-circuit evaluation.

### Bitwise Operators

| Operator | Description | Operand requirement |
|---|---|---|
| `&` | Bitwise AND | Both operands must be `int` |
| `|` | Bitwise OR | Both operands must be `int` |
| `^` | Bitwise XOR | Both operands must be `int` |
| `<<` | Left shift | Both operands must be `int` |
| `>>` | Arithmetic right shift | Both operands must be `int` |

### Unary Operators

| Operator | Description | Operand requirement |
|---|---|---|
| `-` | Negation | Operand must be numeric (int, float, or angle) |
| `!` | Logical NOT | Operand must be `bool` |

### Assignment Operators

| Operator | Description |
|---|---|
| `=` | Simple assignment |
| `+=` | Add and assign |
| `-=` | Subtract and assign |
| `*=` | Multiply and assign |
| `/=` | Divide and assign |

The left-hand side of any assignment must be an l-value (a variable, field access, or array index). Compound assignment operators follow the same type rules as their corresponding arithmetic operators.

### Operator Precedence

From lowest to highest precedence:

| Precedence | Operators |
|---|---|
| 1 (lowest) | `||` |
| 2 | `&&` |
| 3 | `|` |
| 4 | `^` |
| 5 | `&` |
| 6 | `==` `!=` |
| 7 | `<` `>` `<=` `>=` |
| 8 | `<<` `>>` |
| 9 | `+` `-` |
| 10 (highest) | `*` `/` `%` |

Unary operators (`-`, `!`) bind tighter than all binary operators. Postfix operators (`.`, `[]`) bind tighter than unary operators. Parentheses `()` override precedence.

## Control Flow

### If/Else

```rbl
if health < 50.0 {
    setSpeed(0.0)
}

if distance < 100.0 {
    fire(3.0)
} else {
    fire(1.0)
}

if x < 10 {
    // ...
} else if x < 20 {
    // ...
} else {
    // ...
}
```

The condition must be a `bool` expression. Braces are required. There is no ternary operator.

### For Loop

RBL supports three forms of `for` loop:

**Infinite loop:**

```rbl
for {
    // runs forever until break
}
```

**Condition-only loop:**

```rbl
for ticksSinceScan < 10 {
    // runs while condition is true
}
```

**Three-part loop (C-style):**

```rbl
for i := 0; i < 10; i += 1 {
    // init; condition; post
}
```

The init clause can be a short declaration (`:=`) or an assignment. The post clause must be an assignment. Semicolons separate the three parts.

### While Loop

The `while` keyword is syntactic sugar for a condition-only `for` loop:

```rbl
while getGunHeat() > 0.0 {
    // equivalent to: for getGunHeat() > 0.0 { ... }
}
```

### Switch/Case

```rbl
switch phase {
case 0:
    // searching
case 1:
    // tracking
case 2, 3:
    // multiple values per case
default:
    // fallback
}
```

The tag expression and case values must have matching types. Cases do not fall through; each case body runs independently. Multiple values in a single case are separated by commas.

### Break and Continue

`break` exits the innermost loop. `continue` skips to the post-statement (if any) and re-evaluates the loop condition. Both are errors outside of a loop.

### Return

```rbl
func add(a int, b int) int {
    return a + b
}

func swap(a int, b int) (int, int) {
    return b, a
}

func doSomething() {
    return  // void return
}
```

The number and types of return values must match the function's return type declaration.

## Functions

### Declaration

```rbl
func name(param1 type1, param2 type2) returnType {
    // body
}
```

Functions with no return type are void:

```rbl
func doWork() {
    // no return value
}
```

Multi-return functions declare return types in parentheses:

```rbl
func divide(a int, b int) (int, int) {
    return a / b, a % b
}
```

### Calls

```rbl
setSpeed(50.0)
x := getX()
q, r := divide(10, 3)
```

Arguments must match the function's parameter types exactly. There is no implicit type coercion.

### Required Functions

Every robot must define `tick()` with no parameters and no return value. An optional `init()` function is called once after the WASM module is instantiated and receives the robot API.

## Type Conversions

Explicit type conversions between numeric types use function-call syntax:

| Conversion | Description |
|---|---|
| `int(x)` | Convert float or angle to int (truncates toward zero) |
| `float(x)` | Convert int or angle to float |
| `angle(x)` | Convert int or float to angle |

Only numeric types (int, float, angle) can be converted to each other. Converting non-numeric types is a compile error.

```rbl
speed := 50
setSpeed(float(speed))        // int -> float
heading := angle(90)          // int -> angle
ticks := int(getGunHeat())    // float -> int
```

## Events

Event handlers are declared with the `on` keyword. The simulation engine calls them when specific conditions occur. Event handlers may not return values.

```rbl
on eventName(param1 type1, param2 type2) {
    // body
}
```

### Event Reference

| Event | Parameters | Description |
|---|---|---|
| `scan` | `distance float, bearing angle` | Your radar detected an enemy robot. `distance` is the distance to the target. `bearing` is the relative bearing from your heading. |
| `scanned` | `bearing angle` | An enemy robot's radar detected you. `bearing` is the relative bearing to the scanner from your heading. |
| `hit` | `damage float, bearing angle` | Your robot was hit by a bullet. `damage` is the amount of damage taken. `bearing` is the relative bearing to the bullet source. |
| `bulletHit` | `robotId int` | A bullet you fired hit an enemy robot. `robotId` is the target's ID. |
| `wallHit` | `bearing angle` | Your robot collided with a wall. `bearing` is the relative bearing to the wall from your heading. |
| `robotHit` | `bearing angle` | Your robot collided with another robot. `bearing` is the relative bearing to the other robot from your heading. |
| `bulletMiss` | *(none)* | A bullet you fired left the arena without hitting anything. |
| `robotDeath` | `robotId int` | An enemy robot was destroyed. `robotId` is the dead robot's ID. |

All bearing parameters are relative to your robot's current heading: 0 = straight ahead, positive = clockwise, negative = counter-clockwise. Range: [-180, 180].

Event handlers are compiled to WASM exports with the prefix `on_` (e.g., `on scan` becomes the export `on_scan`). The parameter count and types must exactly match the signatures listed above.

### Event Delivery Order

Within a single tick, events are delivered in this order before `tick()` is called:

1. Wall hits
2. Robot-robot collisions
3. Bullet hits (onHit for target, then onBulletHit for shooter)
4. Bullet misses
5. Robot deaths
6. Scan results (onScan, then onScanned)

## Literals

| Kind | Examples | Type |
|---|---|---|
| Integer | `42`, `-1`, `0` | `int` |
| Float | `3.14`, `-0.5`, `1.0` | `float` |
| Boolean | `true`, `false` | `bool` |
| String | `"hello"` | Only valid in `robot "Name"` |
| Array | `[1, 2, 3]` | `[N]T` (inferred) |
| Struct | `Point{ x: 1.0, y: 2.0 }` | Named struct type |

Integer literals are sequences of digits. Float literals require a decimal point with at least one digit on each side. String literals support escape sequences: `\\`, `\"`, `\n`, `\t`.

## Comments

Line comments start with `//` and extend to the end of the line:

```rbl
// This is a comment
var x int = 10  // inline comment
```

There are no block comments.

## Newlines

RBL uses newlines as statement terminators (similar to Go). Newlines are significant tokens. The parser skips consecutive newlines where appropriate. Semicolons are only used in three-part `for` loop headers.

## Example

```rbl
robot "TrackerBot"

var phase int = 0
var enemyBearing angle = angle(0)
var enemyDist float = 0.0

func init() {
    setColor(220, 30, 30)
    setScanWidth(10.0)
}

func tick() {
    if phase == 0 {
        setRadarTurnRate(20.0)
        setSpeed(40.0)
    }

    if phase == 1 {
        enemyAbsAngle := getHeading() + enemyBearing
        setGunHeading(enemyAbsAngle)
        if getGunHeat() == 0.0 {
            fire(3.0)
        }
        setHeading(enemyAbsAngle)
        setSpeed(80.0)
    }
}

on scan(distTo float, bearing angle) {
    enemyBearing = bearing
    enemyDist = distTo
    phase = 1
}

on wallHit(bearing angle) {
    setSpeed(50.0)
}
```
