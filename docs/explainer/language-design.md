# Language Design Choices

This document explains the *why* behind the design decisions in RBL (Robot Battle Language). Not just what the language does, but why it was designed this way. If you are extending the compiler or designing new language features, this is the document to read first. For the language specification, see the [Language Reference](../reference/language.md). For compiler internals, see the [Compiler Architecture](../reference/compiler.md).

## Why a Custom Language?

The short answer: sandboxing, determinism, and domain-specific features.

The longer answer involves several forces that all push in the same direction:

**Sandboxing via WASM.** Robots are untrusted code. A player writes a robot, and it runs in the same browser as everyone else's robots. If robots were JavaScript, they could access the DOM, make network requests, read cookies, or interfere with the simulation. WASM provides a hard sandbox: a robot can only call the functions explicitly provided as imports (the RobotAPI), and it can only access its own linear memory. There is no escape hatch.

**Determinism.** The simulation must produce identical results given the same seed. JavaScript is not deterministic in general -- floating point edge cases, object iteration order quirks, and `Math.random()` all conspire against reproducibility. By compiling to WASM with a controlled set of operations (i32/f32 arithmetic, a seeded PRNG exposed through the API), the entire simulation becomes deterministic. Same seed, same battle, every time.

**Domain-specific features.** A robot battle game has concepts that do not map cleanly to general-purpose languages. The `angle` type with wrapping semantics (0-360) prevents an entire class of bugs. Event handlers (`on scan(...)`) are first-class syntax, not callback registration. The RobotAPI functions (`setSpeed`, `fire`, `getHeading`) are available as built-in calls without imports or boilerplate. A general-purpose language would require layers of glue; RBL bakes these concepts into the grammar.

**Approachability.** The target audience includes people who might not be experienced programmers. Someone who wants to write a battle bot should be able to start with a 30-line file and understand what every line does. No build system, no imports, no packages, no dependency management. One file, one robot.

## Why Go-Inspired Syntax?

RBL borrows from Go's syntax because Go made a set of choices that align well with a teaching-friendly, game-oriented language:

**No semicolons.** Newlines terminate statements. This removes a common source of confusion for beginners and keeps the code visually clean.

**No parentheses around conditions.** `if x > 5 { ... }` instead of `if (x > 5) { ... }`. One less thing to remember, one less thing to get wrong.

**Short variable declarations.** `x := 42` instead of `var x int = 42`. The `:=` syntax infers the type from the right-hand side. This is the most common way to declare variables inside functions.

**Types after names.** `func fire(power float)` instead of `float fire(float power)`. This reads more naturally in English and avoids the C-style declaration ambiguity.

**Braces required for blocks.** No dangling-else bugs. Every `if`, `for`, and `on` body is delimited by braces.

But RBL is not Go. It intentionally leaves out:

- **Goroutines and channels** -- robots operate in a tick-based model, not concurrent
- **Interfaces** -- no polymorphism needed; there is one robot type
- **Packages and imports** -- one file, one robot
- **Pointers** -- no manual memory management; the WASM linear memory model handles storage
- **nil** -- every type has a zero value; there is no null/nil concept
- **Generics** -- the type system is intentionally small

The result is a language that *looks* like Go to someone who knows Go, but has a much smaller surface area to learn.

## The Angle Type

This is perhaps the most distinctive design decision in RBL. Why does a language need a dedicated angle type?

**The problem it solves.** In robot combat, nearly every interesting computation involves angles: headings, bearings, gun directions, radar arcs. And angle math is surprisingly error-prone. Is your heading 350 degrees? Add 20 and you get 370, which should be 10. Subtract 30 from 10 and you get -20, which should be 340. Every robot programmer makes these wrapping bugs, usually multiple times.

The `angle` type handles this automatically. It is stored as an f32 internally (in WASM), and the arithmetic operations produce values that conceptually stay in the [0, 360) range. The API functions that return angles (like `getHeading()`, `getRadarHeading()`, `bearingTo()`) return the `angle` type. Functions that accept angles (like `setHeading()`, `setGunHeading()`) expect the `angle` type.

**Strict coercion.** You cannot accidentally use a float where an angle is expected or vice versa. The conversion must be explicit:

```rbl
heading := getHeading()           // angle
speed := getSpeed()               // float
setHeading(heading + angle(90))   // angle(90) converts int literal to angle
// setHeading(heading + 90)       // TYPE ERROR: 90 is int, not angle
// setHeading(heading + 90.0)     // TYPE ERROR: 90.0 is float, not angle
```

**Multiplication asymmetry.** This is a deliberate design choice: `angle * float` works (scaling an angle), but `float * angle` is a type error. The rationale is that scaling an angle by a factor makes semantic sense (half a turn, double the turn rate), but the angle should always be the "base" value being scaled. This prevents confusing expressions where it is unclear what the result type should be.

```rbl
turn := angle(45) * 0.5           // OK: angle * float -> angle
// wrong := 0.5 * angle(45)       // TYPE ERROR: float * angle is not allowed
```

This rule is enforced in `analyzer.ts` in the `checkArithmeticOp` method. The same applies to division: `angle / float` works, `float / angle` does not.

**Addition and subtraction.** Two angles can be added or subtracted, producing an angle: `heading + bearing` gives you an absolute heading from a relative bearing. But `angle + float` is a type error -- you must convert.

## Strict Integer/Float Separation

RBL has no implicit numeric coercion. `42` is an `int`. `42.0` is a `float`. You cannot assign one to the other without an explicit conversion:

```rbl
var x float = 42.0       // OK
// var y float = 42       // TYPE ERROR: int is not float
var z float = float(42)   // OK: explicit conversion

var a int = int(42.5)     // OK: truncates to 42
// var b int = 42.5        // TYPE ERROR: float is not int
```

**Why this strictness?** In a game simulation where physics, damage, and scoring all depend on numeric precision, implicit coercion creates subtle bugs. Consider `damage = power * 4` vs `damage = power * 4.0` -- if `power` is a float, the first silently truncates (in some languages) or promotes (in others). In RBL, mixing int and float in arithmetic is a compile-time error. You must be explicit about what you mean.

This is analogous to TypeScript's `noUncheckedIndexedAccess` compiler option: it is slightly more annoying to write code, but it catches bugs at compile time that would otherwise be painful to debug at runtime. In a robot battle context, "my robot does weird damage sometimes" is much harder to debug than "the compiler told me line 42 mixes int and float."

The type checker enforces this in the `checkBinaryExpr` and `checkArithmeticOp` methods of `analyzer.ts`. The error messages are specific: the compiler tells you exactly which types are incompatible and suggests the correct conversion.

## Events as Language Constructs

In many game frameworks, event handling looks like this (pseudocode):

```javascript
robot.on("scan", (distance, bearing) => { ... })
robot.on("hit", (damage, bearing) => { ... })
```

In RBL, events are first-class syntax:

```rbl
on scan(distance float, bearing angle) {
    // ...
}

on hit(damage float, bearing angle) {
    // ...
}
```

**Why syntax instead of callbacks?**

First, **compile-time checking**. The compiler knows the complete set of valid event names (`scan`, `scanned`, `hit`, `bulletHit`, `wallHit`, `robotHit`, `bulletMiss`, `robotDeath`) and their exact parameter signatures. If you misspell an event name or get the parameter types wrong, the compiler tells you immediately. With callback registration, these errors would only surface at runtime.

The valid event signatures are defined in the `EVENT_SIGNATURES` map in `analyzer.ts`:

```
scan:       (float, angle)
scanned:    (angle)
hit:        (float, angle)
bulletHit:  (int)
wallHit:    (angle)
robotHit:   (angle)
bulletMiss: ()
robotDeath: (int)
```

Second, **direct WASM mapping**. Each event handler compiles to a WASM export function. `on scan(...)` becomes the export `on_scan`. The simulation engine calls it directly through the `RobotModule` interface. There is no event dispatch table, no string matching, no dynamic lookup. The call path is: simulation detects scan -> `robot.module.onScan(distance, bearing)` -> WASM export `on_scan` runs.

Third, **clarity**. When reading a robot's source code, event handlers are visually distinct from regular functions. You can scan the file and immediately see what events this robot responds to. There is no need to search through `init()` for callback registrations.

## Intent-Based Control

Robots do not directly modify their own position, heading, or gun state. Instead, they set *intents*:

```rbl
func tick() {
    setSpeed(80.0)              // I want to go 80 units/second
    setHeading(angle(90))       // I want to face east
    fire(3.0)                   // I want to fire with power 3
}
```

The simulation engine reads these intents after `tick()` returns and applies them according to the physics rules (acceleration limits, turn rate limits, gun cooldown, energy costs).

**Why intents instead of direct control?**

**Determinism.** If robots directly modified shared state, the order in which robots execute their `tick()` functions would matter. Robot A modifying its position before Robot B reads it gives a different result than the reverse. With intents, the order does not matter: all robots set their intents, then the engine applies all intents simultaneously.

**Physics constraints.** A robot cannot teleport or spin instantly. `setSpeed(80.0)` does not immediately set the speed to 80; the engine accelerates toward 80 at the configured rate. `setHeading(angle(90))` does not instantly snap to 90 degrees; it sets a turn rate intent based on the angle difference, clamped to the maximum turn rate. This is all handled in `applyMovement()` in `battle.ts`.

**Simplicity.** The robot programmer does not need to think about physics. "I want to go fast toward the enemy" translates to `setSpeed(80.0)` and `setHeading(enemyAngle)`. The engine handles acceleration curves, turn rate limiting, wall collision, and energy costs.

The "set" functions record intents on the `InternalRobot` struct (`intendedSpeed`, `intendedTurnRate`, `intendedGunTurnRate`, `intendedRadarTurnRate`, `intendedFire`). The "get" functions read from the robot's actual state as of the start of the tick. This separation is explicit in the `RobotAPI` doc comment: "All set functions record intents. All get functions return the current state as of the start of this tick."

## Compilation to WASM

### Why WASM?

**Sandboxing.** This is the primary reason. A WASM module can only access its own linear memory and the functions explicitly provided as imports. It cannot access the DOM, make network requests, read files, or interfere with other modules. For a game where users submit code that runs in everyone's browser, this is essential.

**Performance.** WASM executes at near-native speed. A tournament running hundreds of games with thousands of ticks each completes in seconds, not minutes.

**Determinism.** WASM integer and floating-point arithmetic is well-specified across platforms. Combined with the seeded PRNG, this gives reproducible simulation results.

### Compilation Strategy

The compiler emits WASM binary format directly -- no intermediate text format (WAT), no intermediate representation. The `codegen.ts` file constructs the binary byte-by-byte using helper functions for LEB128 encoding, section building, and opcode emission.

The WASM module structure:

- **Import section**: All RobotAPI functions are imported from the `"env"` module. The simulation provides these as the import object during instantiation.
- **Function section**: User-defined functions (`init`, `tick`, helpers) and event handlers (`on_scan`, `on_hit`, etc.).
- **Memory section**: One linear memory, sized to hold all global variables plus scratch space for local composite types.
- **Export section**: `memory`, `init`, `tick`, and all event handlers are exported.

### Memory Model

- **Global variables**: Stored in linear memory starting at offset 64 (first 64 bytes reserved for return slots). The analyzer assigns each global a fixed memory offset during pass 1.
- **Local variables** (primitives): Stored as WASM locals. These are stack-allocated and fast.
- **Local variables** (structs/arrays): Stored in linear memory past the global area. WASM locals are not dynamically indexable, so arrays must use memory. The codegen allocates a "composite local" by bumping a memory offset counter and storing the base address in a WASM local.
- **Constants**: Inlined as WASM `i32.const` or `f32.const` instructions. No memory allocation.

### Array Bounds Checking

Array index access includes bounds checking that traps on out-of-range indices. The generated code checks both `index >= array_size` and `index < 0`, and emits `unreachable` (WASM trap) if either is true. This follows Go's approach: an out-of-bounds access is a fatal error for that tick. The `callExport` wrapper in `instantiate.ts` catches WASM traps gracefully -- the robot skips that call, and a diagnostic is logged. The robot survives to fight another tick.

### Type Mapping

| RBL Type | WASM Type | Notes |
|----------|-----------|-------|
| `int`    | `i32`     | 32-bit signed integer |
| `float`  | `f32`     | 32-bit IEEE 754 |
| `bool`   | `i32`     | 0 = false, 1 = true |
| `angle`  | `f32`     | Same representation as float at the WASM level |
| `struct` | memory    | Fields laid out sequentially in linear memory |
| `array`  | memory    | Elements laid out sequentially in linear memory |

The `angle` and `float` types have the same WASM representation (`f32`). The distinction exists only at the RBL type-checking level. Once code reaches WASM, angle values are plain floats. The normalization semantics (wrapping to 0-360) are handled by the API functions on the simulation side, not by WASM instructions.

## What We Left Out and Why

### No Strings

Robots do not need to manipulate text. There is no chat system, no logging facility that accepts strings, no file I/O. The `robot "Name"` declaration uses a string literal at the syntax level, but this is consumed by the compiler and never appears in the WASM output. Removing strings simplifies the type system (no heap allocation, no GC, no string interning) and the WASM memory model (no dynamic-length data).

### No Closures

WASM has no built-in closure support. Implementing closures would require heap-allocating captured variables and managing their lifetime -- a significant increase in compiler complexity for a feature robots do not need. Functions in RBL are top-level only. Event handlers are top-level only. There is no need for anonymous functions or lambda expressions.

### No Imports or Packages

One file, one robot. This is a deliberate constraint, not a missing feature. It means:

- A robot is entirely self-contained. You can read the entire source in one file.
- There is no dependency resolution, no version conflicts, no build system.
- Sharing a robot is sharing a single file.
- The compiler does not need a module system, a linker, or a path resolver.

### No Goroutines

Go's goroutines are designed for concurrent I/O and parallel computation. Robots operate in a fundamentally different model: each robot gets a single `tick()` call per simulation step, executes synchronously, sets its intents, and returns. There is nothing to run concurrently. The simulation itself is sequential: all robots tick, then the engine applies physics. Goroutines would add complexity with no benefit.

### No Generic Types

The type system has a fixed set of primitives (`int`, `float`, `bool`, `angle`), fixed-size arrays (`[N]Type`), and structs. There is no need for generic containers because:

- Arrays are fixed-size and homogeneous.
- Structs are user-defined product types with named fields.
- There is no standard library with generic data structures.
- The API surface is small enough that every function has concrete types.

### No Pointers

WASM's linear memory model does not naturally support pointers in the way C or Go uses them. More importantly, robots do not need them. Values are either primitive (stored in WASM locals) or composite (stored in linear memory at compiler-assigned offsets). The compiler manages memory layout; the programmer works with values.

### No Nil/Null

Every type has a zero value: `int` is 0, `float` is 0.0, `bool` is false, `angle` is 0 degrees, struct fields are zero-valued, array elements are zero-valued. There is no concept of "absence of value." This eliminates null pointer exceptions, nil checks, and the billion-dollar mistake. If a variable exists, it has a valid value.
