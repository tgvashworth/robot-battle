# Robot Battle Language Design

A comprehensive design document for **RBL** (Robot Battle Language) -- a custom C-like
programming language for the Robot Battle game. Players write robots in RBL, which
compiles to WebAssembly for deterministic, sandboxed execution in the arena.

---

## Table of Contents

1. [Prior Art: Robot Programming Games and Their Languages](#1-prior-art)
2. [Language Design Principles](#2-language-design-principles)
3. [Proposed Language Features](#3-proposed-language-features)
4. [Robot API Design](#4-robot-api-design)
5. [Example Robot Programs](#5-example-robot-programs)
6. [Syntax Style Comparison](#6-syntax-style-comparison)
7. [Error Handling and Developer Experience](#7-error-handling-and-developer-experience)

---

## 1. Prior Art: Robot Programming Games and Their Languages {#1-prior-art}

The robot programming game genre spans over four decades, from RobotWar (1981) to
Screeps (2017) and Robocode Tank Royale. Each game made different tradeoffs between
accessibility, expressiveness, and fun. Understanding those tradeoffs is essential
before designing our own language.

### 1.1 RobotWar (1981) -- The Pioneer

**Language:** Custom register-based language resembling a BASIC/Forth hybrid.

RobotWar, written by Silas Warner and published by Muse Software, was the first robot
programming game. Robots were controlled through 34 registers used for both variables
and hardware I/O. The syntax used a stack-oriented model with commands like `TO` for
assignment and `GOSUB`/`ENDSUB` for subroutines.

**What worked:**
- Extremely simple mental model -- registers are both state and I/O
- Immediate feedback loop -- write code, watch robots fight
- Computer Gaming World praised its language as "easy to learn"

**What did not work:**
- Register-based I/O is cryptic for modern programmers
- Stack-oriented syntax is unintuitive
- No structured control flow (GOTO-heavy)
- Limited expressiveness for complex strategies

### 1.2 CROBOTS (1985) -- C for Robots

**Language:** A subset of C with intrinsic hardware functions.

CROBOTS by Tom Poindexter gave players a real C compiler (with restrictions) and
exposed robot hardware through eight intrinsic functions:

| Function | Purpose |
|---|---|
| `scan(degree, resolution)` | Scan for robots, returns range or 0 |
| `cannon(degree, range)` | Fire missile, returns 1 if fired |
| `drive(degree, speed)` | Set motor heading and speed (0-100%) |
| `damage()` | Get cumulative damage (0-99) |
| `speed()` | Get current velocity |
| `loc_x()`, `loc_y()` | Get battlefield coordinates |
| `rand(limit)` | Random number 0..limit |

The C subset supported: `if/else`, `while`, functions, recursion, local/global
variables, and standard operators. It deliberately omitted: floating-point, structs,
pointers, arrays, `for` loops, `switch`, and the preprocessor.

**What worked:**
- Using a real (subset of a) language meant transferable skills
- The API was tiny and clean -- 8 functions covered everything
- Non-blocking `drive()` felt natural; robots kept moving while thinking
- Helper functions like `sqrt()`, `sin()`, `cos()`, `atan()` enabled targeting math

**What did not work:**
- No structured data (arrays/structs) limited complex strategies
- No events -- pure polling required busy-wait patterns
- 7-character identifier limit was unnecessarily restrictive

**Key lesson:** A small, clean API with a familiar language syntax is the sweet spot.
CROBOTS proved that a subset of C is plenty expressive for robot battles.

### 1.3 Robot Battle / RSL (1994) -- The Event-Driven Approach

**Language:** RSL (Robot Scripting Language), resembling a mix of BASIC, C, and
JavaScript.

Robot Battle, developed by Brad Schick, introduced an event-driven architecture that
was a significant advance over polling-based predecessors. RSL organized code into
named sections triggered by events:

- **`init`** -- Required section. Runs once at startup.
- **`core`** -- Default behavior when no events are active.
- **`ascan`** -- Low-priority section that runs while the robot moves.
- **Event sections** -- Triggered by radar detections, collisions, etc.

Each section had a priority level, and higher-priority events could interrupt
lower-priority ones. The robot had three independently rotating parts:

| Part | Size/Speed | Function |
|---|---|---|
| Body | 33x33 pixels, rotates 5 deg/turn | Movement, collision |
| Gun | Rotates 10 deg/turn | Fires energy missiles |
| Radar | Rotates 15 deg/turn | Scans for objects |

RSL also supported arrays, radio communication between allied robots, and loop
constructs.

**What worked:**
- Event-driven model was intuitive: "when I see something, do this"
- Three independent parts (body/gun/radar) created strategic depth
- Priority-based event handling was elegant
- Sample robots (Combo, Walls II, Zag, etc.) served as great learning templates

**What did not work:**
- The language syntax was inconsistent, borrowing from too many traditions
- Event priority tuning was confusing for beginners
- The distinction between sections was not immediately obvious
- Debugging event interactions was difficult

**Key lesson:** Events are powerful but need to be simple. The three-part robot
(body/gun/turret) is a proven design that creates good strategic depth. Sample robots
are essential learning tools.

### 1.4 Robocode (2001) -- The Java Heavyweight

**Language:** Full Java, extended with a robot API.

Robocode, originally by Mathew Nelson at IBM, became the most popular robot programming
game and is still actively maintained as Robocode Tank Royale. It uses full Java (or
C#/.NET) with an extensive API.

**Robot API (simplified):**

Movement: `ahead(distance)`, `back(distance)`, `turnLeft(degrees)`, `turnRight(degrees)`

Gun: `turnGunLeft(degrees)`, `turnGunRight(degrees)`, `fire(power)`

Radar: `turnRadarLeft(degrees)`, `turnRadarRight(degrees)`, `scan()`

Sensors: `getX()`, `getY()`, `getHeading()`, `getGunHeading()`, `getEnergy()`,
`getVelocity()`, `getBattleFieldWidth()`, `getBattleFieldHeight()`

Events: `onScannedRobot(event)`, `onHitByBullet(event)`, `onHitWall(event)`,
`onHitRobot(event)`, `onBulletHit(event)`, `onDeath(event)`, `onWin(event)`

Robocode has two execution modes:

1. **Basic Robot**: Blocking calls. `ahead(100)` does not return until the robot has
   moved 100 pixels. Simple but prevents doing multiple things at once.
2. **Advanced Robot**: Non-blocking setters. `setForward(100)` queues the command, and
   `go()` submits all queued commands for the turn. This allows parallel actions
   (move + turn gun + fire in one turn).

The Tank Royale documentation recommends: use event handlers only for gathering
information; defer all decisions to the main loop; submit all actions via `go()`.

**What worked:**
- Using a mainstream language meant zero syntax learning curve
- The blocking/non-blocking distinction elegantly separated beginners from experts
- The `run()` loop + event handler model was clean
- Extensive documentation and community
- Source maps and debugging worked out of the box (it is Java)

**What did not work:**
- Java boilerplate is heavy for a fun game (classes, imports, inheritance)
- Full language access meant robots could be arbitrarily complex
- No sandbox -- robots could access the filesystem, network, etc. (a security issue)
- Compile-edit cycle was slow compared to interpreted languages
- Barrier to entry was high for non-programmers

**Key lesson:** The `run()` loop + event handlers + `go()` per-tick pattern is the
gold standard for robot execution models. But using a full general-purpose language
adds too much complexity for a game.

### 1.5 Core War / Redcode (1984) -- The Minimalist Extreme

**Language:** Redcode, a simplified assembly language.

Core War, introduced by D.G. Jones and A.K. Dewdney, puts two programs in shared
memory. Programs take turns executing one instruction at a time and try to crash
each other. Redcode has only ~16 instructions (`MOV`, `ADD`, `SUB`, `JMP`, `DJN`, etc.)
with multiple addressing modes.

**What worked:**
- Extreme simplicity led to emergent complexity
- The rock-paper-scissors metagame (replicators vs bombers vs scanners) was deep
- Programs were tiny, making them easy to share and study

**What did not work:**
- Assembly language is impenetrable to most people
- No high-level abstractions whatsoever
- The game is abstract -- no visual robots, no physical arena

**Key lesson:** Constraints breed creativity, but there is a floor of accessibility.
Assembly is too low-level for a fun game. However, the idea that every action costs
time (each instruction is one tick) is worth borrowing.

### 1.6 Screeps (2017) -- The Modern Approach

**Language:** Full JavaScript (or any language via WebAssembly).

Screeps is a persistent MMO where you program "creeps" in JavaScript. Its tick-based
execution model is relevant:

- Each tick, the game calls your `module.exports.loop` function
- All property changes take effect at the start of the next tick
- Multiple commands in one tick are batched and applied simultaneously
- The game loop runs 24/7, even when you are offline

**What worked:**
- Using a mainstream language (JS) was accessible
- Tick-based batching is clean and predictable
- Persistent world created deep engagement

**What did not work:**
- Full JS access created performance and security concerns
- Memory management became a core challenge (GC pressure)
- Debugging async behavior across ticks was hard

**Key lesson:** The tick-based "gather intent, then execute" model is clean and
maps well to our WebAssembly compilation target.

### 1.7 Summary of Lessons Learned

| Principle | Supported By |
|---|---|
| Small, clean API (under 20 functions) | CROBOTS, RobotWar |
| Event handlers + main loop hybrid | Robocode, Robot Battle |
| Tick-based execution with batched commands | Screeps, Robocode Tank Royale |
| Familiar C-like syntax | CROBOTS, Robocode |
| Independent body/gun/turret parts | Robot Battle, Robocode |
| Sample robots as learning tools | Robot Battle, Robocode |
| Constraints breed creativity | Core War, CROBOTS |
| Deterministic execution (no real I/O) | Core War, all games |

---

## 2. Language Design Principles {#2-language-design-principles}

### 2.1 Core Design Goals

**Learnable in 30 minutes.** A programmer who has seen any C-family language should
be writing their first robot within 30 minutes. A non-programmer should be able to
modify a sample robot and understand what changed within 15 minutes. The entire
language reference should fit on a single page.

**Expressive enough for mastery.** The language must support state machines, targeting
algorithms, predictive aiming, wall-following, evasion patterns, and team coordination.
The gap between "my first robot" and "tournament champion" should come from strategy,
not language gymnastics.

**Compiles cleanly to WebAssembly.** This means:
- Static types (WASM is typed at the instruction level)
- No garbage collection (WASM GC is not yet universal)
- No dynamic dispatch / vtables (keep it simple)
- Fixed-size data structures (stack-allocated or statically allocated)
- No string manipulation (WASM has no native string support)
- All memory usage is bounded and predictable

**Deterministic execution.** Given the same seed, a robot must behave identically
every time. This means:
- No access to real time, system calls, or I/O
- Random numbers must be seeded and reproducible
- Floating-point operations must follow IEEE 754 strictly
- Execution order is fixed and predictable

**Fun and thematic.** The language should make you feel like you are programming a
battle robot, not writing enterprise software. The API should use action verbs.
Error messages should be helpful and encouraging.

### 2.2 Anti-Goals (Things We Deliberately Avoid)

- **Turing-complete generality.** We do not need closures, higher-order functions,
  generics, or metaprogramming. This is a domain-specific language.
- **String processing.** Robots do not need to manipulate text. String literals exist
  only for the robot's display name.
- **Dynamic memory allocation.** No `malloc`, no `new`, no heap. All memory is
  statically allocated or stack-based.
- **Object-oriented programming.** No classes, no inheritance, no interfaces. Functions
  and structs are sufficient.
- **Module system.** Each robot is a single file. No imports, no libraries (the robot
  API is built in).
- **Concurrency.** One robot, one thread, one tick at a time.

### 2.3 The "30-Minute" Test

A good language design should pass this test. A new player should be able to:

1. **Minute 0-5:** Read a sample robot and understand its basic structure.
2. **Minute 5-10:** Modify the sample (change a number, swap a direction) and see
   the effect.
3. **Minute 10-20:** Write a simple robot from scratch (spin and shoot).
4. **Minute 20-30:** Add one clever behavior (track an enemy, dodge walls, alternate
   strategies).

If the language requires understanding type systems, memory management, or complex
control flow to reach step 3, it is too complex.

---

## 3. Proposed Language Features {#3-proposed-language-features}

### 3.1 Data Types

RBL has four primitive types and two compound types:

```
int       // 32-bit signed integer
float     // 64-bit IEEE 754 floating-point (f64 in WASM)
bool      // true or false (stored as i32 in WASM)
angle     // alias for float, used semantically for degrees (0-359)
```

**Why `float` is f64, not f32:** Targeting math requires precision. Accumulated
rounding errors in angle calculations lead to robots that slowly drift off target.
The cost of f64 over f32 in WASM is negligible.

**Why `angle` exists:** It is syntactically identical to `float`, but it signals intent
to the reader and enables the compiler to emit helpful warnings (e.g., "this angle
is greater than 360, did you mean to normalize it?").

**Compound types:**

```c
// Fixed-size arrays
int[10] scores;
float[360] scanData;

// Structs (value types, stack-allocated)
struct Target {
    float x;
    float y;
    float distance;
    float bearing;
    int lastSeen;
}
```

**Why arrays but not dynamic arrays:** Fixed-size arrays compile to simple WASM memory
offsets. They are sufficient for lookup tables, scan histories, and enemy tracking
buffers. Dynamic arrays require heap allocation, which we want to avoid.

**Why structs but not classes:** Structs are value types -- they live on the stack or in
global memory. They group related data without requiring OOP machinery. A `Target`
struct is more readable than five separate variables.

### 3.2 Variables

```c
// Local variables (stack-allocated, scoped to function)
let speed: int = 100;
let heading: float = 0.0;

// Type inference when the type is obvious
let x = getX();          // inferred as float
let alive = true;        // inferred as bool

// Constants (evaluated at compile time)
const MAX_SPEED: int = 100;
const PI: float = 3.14159265;
const SCAN_WIDTH: float = 10.0;

// Global variables (persist across ticks, visible to all functions)
var targetX: float = 0.0;
var targetY: float = 0.0;
var state: int = 0;
```

**The `let` / `var` distinction:**
- `let` declares a local variable inside a function. It is allocated on the stack and
  does not survive across ticks.
- `var` declares a global variable at the top level of the program. It persists for
  the robot's entire lifetime and retains its value between ticks.
- `const` declares a compile-time constant.

This distinction is critical because tick-based execution means local variables are
re-initialized every tick. Players need a clear way to maintain state across ticks
(globals) vs. temporary computation (locals).

### 3.3 Control Flow

```c
// If/else
if health < 30 {
    retreat();
} else if health < 70 {
    fightCautiously();
} else {
    chargeAttack();
}

// While loops
while getEnergy() > 20 {
    fire(2);
    gunTurn(15);
}

// For loops (C-style, bounded)
for i in 0..360 {
    // scan every degree
}

// For loops (traditional)
for let i: int = 0; i < 10; i += 1 {
    scanHistory[i] = 0;
}

// Match (lightweight switch)
match state {
    0 => seek(),
    1 => attack(),
    2 => evade(),
    _ => seek(),    // default
}

// Loop with break/continue
loop {
    scan();
    if foundTarget {
        break;
    }
}
```

**Why `match` instead of `switch`:** The `match` syntax avoids the C pitfall of
fall-through. Each arm is an expression, and the default arm (`_`) is required,
preventing unhandled cases.

**Why `for i in 0..360`:** Range-based for loops are safer (no off-by-one errors)
and compile to identical WASM as C-style for loops. The compiler knows the bounds
at compile time, enabling optimizations.

**Loop limits:** The compiler enforces a maximum iteration count per tick to prevent
infinite loops from freezing the game. If a loop exceeds the limit (configurable,
default 10,000 iterations), the robot's tick is terminated and it skips its turn.

### 3.4 Functions

```c
// Function declaration
fn calculateBearing(x1: float, y1: float, x2: float, y2: float) -> float {
    let dx = x2 - x1;
    let dy = y2 - y1;
    return atan2(dy, dx);
}

// Function with no return value
fn retreat() {
    turn(180);
    move(50);
}

// Functions can call other functions (no recursion limit enforced,
// but stack depth is bounded by WASM stack size)
fn executeStrategy() {
    let bearing = calculateBearing(getX(), getY(), targetX, targetY);
    turnTo(bearing);
    move(30);
}
```

**No function pointers or closures.** Functions are statically dispatched. This keeps
WASM output simple and prevents callback spaghetti. Strategy selection uses `match`
on state variables, not function pointers.

### 3.5 Operators

**Arithmetic:** `+`, `-`, `*`, `/`, `%` (modulo)

**Comparison:** `==`, `!=`, `<`, `>`, `<=`, `>=`

**Logical:** `&&`, `||`, `!`

**Bitwise:** `&`, `|`, `^`, `~`, `<<`, `>>`

**Assignment:** `=`, `+=`, `-=`, `*=`, `/=`

**Unary:** `-` (negation), `!` (logical not)

**No increment/decrement operators (`++`/`--`).** These are a frequent source of bugs
(pre vs post) and `+= 1` is equally concise and unambiguous.

**Implicit numeric conversions:** `int` promotes to `float` silently. `float` to `int`
requires an explicit `toInt()` call. `bool` does not convert to or from integers.

### 3.6 Built-in Math Functions

These are available without any import and compile to WASM intrinsics or small
inlined functions:

```
sin(degrees: float) -> float
cos(degrees: float) -> float
tan(degrees: float) -> float
atan2(y: float, x: float) -> float    // returns degrees
sqrt(value: float) -> float
abs(value: int | float) -> int | float
min(a, b) -> same type
max(a, b) -> same type
clamp(value, lo, hi) -> same type
floor(value: float) -> int
ceil(value: float) -> int
round(value: float) -> int
toFloat(value: int) -> float
toInt(value: float) -> int
normalizeAngle(degrees: float) -> float  // wraps to 0..359
```

**Trig functions use degrees, not radians.** Radians are mathematically elegant but
degrees are what players think in when rotating a robot. "Turn 90 degrees" is
intuitive; "turn PI/2 radians" is not.

### 3.7 Random Number Generation

```c
// Returns a random integer in [0, max)
let r = random(100);       // 0 to 99

// Returns a random float in [0.0, 1.0)
let f = randomFloat();

// Returns a random integer in [min, max]
let dir = randomRange(-45, 45);
```

All random numbers are generated from a seeded PRNG (xoshiro256** or similar). The
seed is set by the game engine at the start of each match. Given the same seed, a
robot will make the same sequence of "random" decisions, ensuring replays are
deterministic.

### 3.8 Comments

```c
// Single-line comment

/* Multi-line
   comment */

/// Documentation comment (shown in editor tooltips)
/// Describes the function below
fn seekTarget() { ... }
```

### 3.9 What Is Intentionally Omitted

| Omitted Feature | Reason |
|---|---|
| Strings / string manipulation | No use case in robot battles. WASM has no native string type. The robot name is set via metadata, not code. |
| Dynamic memory allocation | No `malloc`/`new`/`free`. All data is stack-allocated or global. Prevents memory leaks and fragmentation. |
| File I/O, network, system calls | Deterministic sandbox. Robots cannot access anything outside the arena. |
| Imports / modules / libraries | Each robot is one file. The entire API is built in. Simplicity over modularity. |
| Classes / inheritance / interfaces | Structs and functions are sufficient. OOP adds complexity without benefit here. |
| Pointers / references | All data is passed by value. Structs are copied. No null pointer bugs. |
| Exceptions / try-catch | Errors are compile-time. Runtime errors (division by zero, array out of bounds) terminate the tick. |
| Closures / lambdas / callbacks | Functions are top-level declarations only. No anonymous functions. |
| Async / await / promises | Single-threaded, tick-based execution. No need for concurrency primitives. |
| Operator overloading | Keeps semantics predictable. `+` always means addition. |
| Macros / metaprogramming | Simplicity. Constants and functions cover all use cases. |

---

## 4. Robot API Design {#4-robot-api-design}

### 4.1 Execution Model: Tick-Based with Intents

Each game tick, the engine calls the robot's entry points in this order:

1. **Event handlers fire** (if any events occurred since last tick).
2. **`tick()` is called** -- the robot's main per-tick function.
3. **Queued commands execute** -- movement, turning, firing happen simultaneously.

Commands issued during `tick()` or event handlers do not take effect immediately.
Instead, they are *queued* and applied at the end of the tick. This means:

- `setSpeed(100)` + `setTurnRate(5)` in the same tick = robot moves AND turns
- Multiple calls to the same command in one tick: last one wins
- `fire()` sets the gun to fire this tick, but the bullet appears next tick

This is the "intent-based" model proven by Robocode Tank Royale: gather information,
make decisions, queue actions, submit. It avoids the complexity of blocking calls
while staying intuitive.

### 4.2 Program Structure

Every robot must define at least `tick()`. The `init()` function is optional and runs
once when the robot spawns. Event handlers are optional.

```c
/// My First Robot
robot "Spinner" {

    var direction: float = 1.0;

    fn init() {
        setColor(255, 0, 0);   // red body
        setGunColor(0, 0, 0);  // black gun
    }

    fn tick() {
        setSpeed(50);
        setTurnRate(5);
        setGunTurnRate(-5);
        fire(1);
    }

    on hit(damage: float, bearing: float) {
        // Someone shot us! Turn away
        direction = -direction;
    }
}
```

**Why `robot "Name" { ... }` as the top-level structure:** It makes the file
self-contained and self-describing. The name is metadata, not a string variable.
The block scope clearly delineates "this is the robot." It also prevents the need
for a separate configuration file.

### 4.3 Movement API

```c
// Speed control (persistent -- stays set until changed)
setSpeed(speed: int)              // -100 to 100 (negative = reverse)
setTurnRate(degreesPerTick: float) // body rotation rate, -10 to 10

// Heading control (set desired heading, robot turns toward it)
setHeading(degrees: float)        // absolute heading (0 = north, 90 = east)

// Query
getX() -> float                   // x position in arena
getY() -> float                   // y position in arena
getHeading() -> float             // current body heading (degrees)
getSpeed() -> float               // current speed
```

**Why set-and-forget speed instead of `move(distance)`:** Blocking `move(distance)`
requires yielding mid-tick, which is complex in WASM. Non-blocking `move(distance)`
requires tracking "remaining distance" state. `setSpeed()` is simpler: the robot
moves every tick at its current speed. Players control movement by changing speed
and heading, not by issuing discrete move commands.

This matches real robotics more closely -- you set motor speeds, not destinations.

**Speed as an integer (-100 to 100):** Percentage-based speed is intuitive. Negative
values mean reverse. The actual pixels-per-tick conversion is handled by the engine.

### 4.4 Gun API

```c
// Gun rotation (independent of body)
setGunTurnRate(degreesPerTick: float) // -20 to 20

// Gun heading (absolute)
setGunHeading(degrees: float)

// Fire (consumes energy, creates a bullet)
fire(power: int)                  // 1-5, higher = more damage, slower bullet, more energy cost

// Query
getGunHeading() -> float          // absolute gun heading
getGunHeat() -> float             // 0.0 = ready to fire, decreases each tick
getEnergy() -> float              // current energy level
```

**Gun heat mechanic:** After firing, the gun heats up proportional to fire power.
It cools down by a fixed amount each tick. Calling `fire()` when the gun is hot does
nothing. This prevents "machine gun" strategies and adds resource management.

**Fire power tradeoffs:**

| Power | Damage | Bullet Speed | Energy Cost | Gun Heat |
|---|---|---|---|---|
| 1 | 4 | 11 | 1 | 1.0 |
| 2 | 8 | 8 | 2 | 1.4 |
| 3 | 12 | 5 | 3 | 1.8 |
| 4 | 16 | 3 | 4 | 2.2 |
| 5 | 20 | 2 | 5 | 2.6 |

Higher power shots deal more damage but are slower (easier to dodge) and cost more
energy. This creates interesting risk/reward decisions.

### 4.5 Scanning API

```c
// Scan in the gun's current direction
// Returns a ScanResult or nothing
scan() -> ScanResult?

// ScanResult is a built-in struct:
// struct ScanResult {
//     distance: float    -- distance to scanned robot
//     bearing: float     -- absolute bearing to scanned robot
//     heading: float     -- the scanned robot's heading
//     speed: float       -- the scanned robot's speed
//     energy: float      -- the scanned robot's energy
//     name: int          -- numeric ID of scanned robot
// }
```

**Why scan through the gun:** The gun direction doubles as the radar direction. This
simplifies the API (no separate radar part) while preserving strategic depth: you must
choose between keeping your gun aimed at a target and scanning for new targets. This
tradeoff is at the heart of good robot design.

**Scan cone:** The scan has a configurable width (default 10 degrees centered on the
gun heading). Wider scans detect more but return less precise data. This could be
exposed as:

```c
setScanWidth(degrees: float)      // 1 to 45 degrees
```

### 4.6 Status API

```c
getHealth() -> float              // 0 to 100, robot dies at 0
getEnergy() -> float              // energy for firing, starts at 100
getX() -> float                   // arena x coordinate
getY() -> float                   // arena y coordinate
getHeading() -> float             // body heading in degrees
getGunHeading() -> float          // gun heading in degrees
getGunHeat() -> float             // gun cooldown timer
getSpeed() -> float               // current speed
getTick() -> int                  // current game tick number
getArenaBounds() -> Bounds        // struct { width: float, height: float }
getRobotCount() -> int            // number of robots still alive
```

### 4.7 Event Handlers

Events fire at the beginning of each tick, before `tick()` is called. They provide
information about what happened since the last tick. Event handlers should be short --
store data in globals and let `tick()` make decisions.

```c
// Your robot was hit by a bullet
on hit(damage: float, bearing: float) { ... }

// Your bullet hit another robot (energy bonus!)
on bulletHit(targetId: int) { ... }

// Your robot collided with a wall
on wallHit(bearing: float) { ... }

// Your robot collided with another robot
on robotHit(bearing: float) { ... }

// Your bullet hit a wall (missed)
on bulletMiss() { ... }

// A robot was destroyed
on robotDeath(robotId: int) { ... }
```

**Why events AND a tick function (not one or the other):**

Pure event-driven (like RSL) is hard to reason about when multiple events fire
simultaneously. Pure polling (like CROBOTS) requires robots to constantly check for
things that happened. The hybrid model is the proven winner:

- Events push information to the robot (reactive)
- `tick()` pulls decisions from that information (proactive)
- The flow is always: events update state -> tick reads state -> tick queues commands

This matches the Robocode Tank Royale recommendation: "use event handlers only for
gathering intelligence information."

### 4.8 Utility API

```c
// Debug output (shown in game UI during development, stripped in tournament)
debug(message: int)               // prints a number to the debug console
debug(message: float)

// Set robot colors (called once in init, purely cosmetic)
setColor(r: int, g: int, b: int)
setGunColor(r: int, g: int, b: int)

// Calculate distance between two points
distanceTo(x: float, y: float) -> float

// Calculate bearing from robot's position to a point
bearingTo(x: float, y: float) -> float
```

### 4.9 Complete API Reference Card

This is the entire API. It fits on one screen. A player can learn every function
available to them in a single reading.

```
MOVEMENT                          GUN & SCANNING
  setSpeed(speed)                   setGunTurnRate(rate)
  setTurnRate(rate)                 setGunHeading(degrees)
  setHeading(degrees)               fire(power)
  getX() -> float                   scan() -> ScanResult?
  getY() -> float                   setScanWidth(degrees)
  getHeading() -> float             getGunHeading() -> float
  getSpeed() -> float               getGunHeat() -> float
                                    getEnergy() -> float

STATUS                            ARENA
  getHealth() -> float              getArenaBounds() -> Bounds
  getTick() -> int                  getRobotCount() -> int
  distanceTo(x, y) -> float
  bearingTo(x, y) -> float       EVENTS
                                    on hit(damage, bearing)
UTILITY                            on bulletHit(targetId)
  random(max) -> int                on wallHit(bearing)
  randomFloat() -> float            on robotHit(bearing)
  randomRange(min, max) -> int      on bulletMiss()
  debug(value)                      on robotDeath(robotId)
  setColor(r, g, b)
  setGunColor(r, g, b)           MATH (built-in)
                                    sin, cos, tan, atan2, sqrt,
LIFECYCLE                           abs, min, max, clamp, floor,
  fn init()                         ceil, round, normalizeAngle,
  fn tick()                         toFloat, toInt
```

**Total: ~30 functions + 6 events + 15 math builtins.** This is comparable to
CROBOTS (8 functions) scaled up for richer gameplay, and far simpler than Robocode
(100+ methods).

---

## 5. Example Robot Programs {#5-example-robot-programs}

### 5.1 SpinBot -- The Simplest Possible Robot

This robot spins in circles and fires continuously. It is terrible at aiming but
surprisingly effective against stationary targets.

```c
/// SpinBot: Spin in circles, fire constantly.
/// Good against beginners, terrible against anything that moves.
robot "SpinBot" {

    fn tick() {
        setSpeed(30);
        setTurnRate(8);
        setGunTurnRate(-8);

        if getGunHeat() == 0.0 {
            fire(2);
        }
    }
}
```

**15 lines.** A complete, functional robot. No boilerplate, no imports, no ceremony.
This is the "Hello World" of Robot Battle.

### 5.2 WallCrawler -- Hug the Walls

This robot navigates to the nearest wall and follows it clockwise. Staying near walls
reduces the angles from which you can be attacked. A solid defensive strategy.

```c
/// WallCrawler: Navigate to the nearest wall, then follow it clockwise.
/// Hard to hit because it moves predictably along the arena edge.
robot "WallCrawler" {

    var phase: int = 0;       // 0 = go to wall, 1 = follow wall
    var wallHeading: float = 0.0;

    fn init() {
        setColor(0, 128, 255);
        setGunColor(0, 64, 128);
    }

    fn tick() {
        let bounds = getArenaBounds();

        match phase {
            0 => goToWall(bounds),
            1 => followWall(bounds),
            _ => goToWall(bounds),
        }

        // Always scan and shoot
        setGunTurnRate(3);
        let result = scan();
        if result != null && getGunHeat() == 0.0 {
            fire(2);
        }
    }

    fn goToWall(bounds: Bounds) {
        let x = getX();
        let y = getY();

        // Find nearest wall
        let distTop = y;
        let distBottom = bounds.height - y;
        let distLeft = x;
        let distRight = bounds.width - x;

        let nearest = min(min(distTop, distBottom), min(distLeft, distRight));

        if nearest < 20.0 {
            // We reached the wall, start following
            phase = 1;
            // Determine wall direction for clockwise traversal
            if nearest == distTop { wallHeading = 90.0; }
            else if nearest == distRight { wallHeading = 180.0; }
            else if nearest == distBottom { wallHeading = 270.0; }
            else { wallHeading = 0.0; }
        } else {
            // Head toward nearest wall
            if nearest == distTop { setHeading(0.0); }
            else if nearest == distRight { setHeading(90.0); }
            else if nearest == distBottom { setHeading(180.0); }
            else { setHeading(270.0); }
            setSpeed(80);
        }
    }

    fn followWall(bounds: Bounds) {
        setHeading(wallHeading);
        setSpeed(60);

        // Turn corners when approaching arena edges
        let x = getX();
        let y = getY();
        let margin = 30.0;

        if x < margin && wallHeading == 0.0 { wallHeading = 90.0; }
        if y > bounds.height - margin && wallHeading == 90.0 { wallHeading = 180.0; }
        // (wrong direction -- illustrates the concept; real version normalizes)
        if x > bounds.width - margin && wallHeading == 180.0 { wallHeading = 270.0; }
        if y < margin && wallHeading == 270.0 { wallHeading = 0.0; }
    }

    on wallHit(bearing: float) {
        // Bounce off: turn 90 degrees clockwise
        wallHeading = normalizeAngle(getHeading() + 90.0);
        phase = 1;
    }
}
```

### 5.3 TrackerBot -- Scan, Lock, Pursue

This robot systematically scans the arena, locks onto the first enemy it finds, and
pursues while keeping its gun trained on the target. It uses basic predictive aiming.

```c
/// TrackerBot: Methodically scan, find a target, chase it down.
/// Uses predictive aiming to lead shots based on target velocity.
robot "TrackerBot" {

    var targetFound: bool = false;
    var targetX: float = 0.0;
    var targetY: float = 0.0;
    var targetHeading: float = 0.0;
    var targetSpeed: float = 0.0;
    var targetDistance: float = 0.0;
    var lastScanTick: int = 0;
    var scanDirection: float = 1.0;

    fn init() {
        setColor(200, 50, 50);
        setGunColor(255, 100, 0);
    }

    fn tick() {
        if !targetFound || getTick() - lastScanTick > 30 {
            // No target or stale data: sweep scan
            seekTarget();
        } else {
            // We have a target: pursue and fire
            pursueTarget();
        }
    }

    fn seekTarget() {
        setSpeed(30);
        setTurnRate(0);
        setGunTurnRate(6.0 * scanDirection);

        let result = scan();
        if result != null {
            lockTarget(result);
        }

        // Reverse scan direction at limits
        let gunAngle = getGunHeading();
        if gunAngle > 350.0 || gunAngle < 10.0 {
            scanDirection = -scanDirection;
        }
    }

    fn lockTarget(result: ScanResult) {
        targetFound = true;
        lastScanTick = getTick();
        targetDistance = result.distance;
        targetHeading = result.heading;
        targetSpeed = result.speed;

        // Calculate target position from bearing and distance
        let bearing = result.bearing;
        targetX = getX() + sin(bearing) * result.distance;
        targetY = getY() + cos(bearing) * result.distance;
    }

    fn pursueTarget() {
        // Predict where the target will be when our bullet arrives
        let bulletSpeed = 8.0;  // power 2 bullet
        let flightTime = targetDistance / bulletSpeed;

        let predictedX = targetX + sin(targetHeading) * targetSpeed * flightTime;
        let predictedY = targetY + cos(targetHeading) * targetSpeed * flightTime;

        // Aim gun at predicted position
        let aimBearing = bearingTo(predictedX, predictedY);
        setGunHeading(aimBearing);

        // Move toward target, but keep some distance
        let dist = distanceTo(targetX, targetY);
        let approachBearing = bearingTo(targetX, targetY);
        setHeading(approachBearing);

        if dist > 200.0 {
            setSpeed(80);
        } else if dist > 100.0 {
            setSpeed(40);
        } else {
            setSpeed(20);
        }

        // Fire when gun is approximately aimed
        let aimError = abs(normalizeAngle(getGunHeading() - aimBearing));
        if aimError < 5.0 && getGunHeat() == 0.0 {
            // Close range = high power, long range = low power
            if dist < 150.0 {
                fire(4);
            } else {
                fire(2);
            }
        }

        // Keep scanning to update target position
        let result = scan();
        if result != null {
            lockTarget(result);
        }
    }

    on hit(damage: float, bearing: float) {
        // When hit, assume the attacker is the priority target
        targetX = getX() + sin(bearing) * 100.0;
        targetY = getY() + cos(bearing) * 100.0;
        targetFound = true;
        lastScanTick = getTick();
    }
}
```

### 5.4 StrategyBot -- Multi-State Battle Robot

This is a sophisticated robot that demonstrates state machines, energy management,
evasion patterns, and adaptive strategy. It switches between behaviors based on
the situation.

```c
/// StrategyBot: A multi-mode battle robot.
/// Adapts between aggressive, defensive, and evasive strategies based on
/// health, energy, enemy count, and incoming fire.
robot "StrategyBot" {

    // --- State machine ---
    const MODE_SEEK: int    = 0;
    const MODE_ATTACK: int  = 1;
    const MODE_EVADE: int   = 2;
    const MODE_RETREAT: int = 3;

    var mode: int = 0;

    // --- Target tracking ---
    struct Target {
        float x;
        float y;
        float heading;
        float speed;
        float distance;
        float energy;
        int lastSeen;
        bool valid;
    }

    var target: Target;
    var hitsTaken: int = 0;
    var hitsDealt: int = 0;

    // --- Evasion ---
    var evadeDirection: float = 1.0;
    var evadeTimer: int = 0;

    fn init() {
        setColor(80, 0, 160);
        setGunColor(200, 0, 255);
        target.valid = false;
    }

    fn tick() {
        updateMode();

        match mode {
            0 => doSeek(),
            1 => doAttack(),
            2 => doEvade(),
            3 => doRetreat(),
            _ => doSeek(),
        }

        // Always try to scan
        let result = scan();
        if result != null {
            updateTarget(result);
        }
    }

    fn updateMode() {
        let health = getHealth();
        let energy = getEnergy();
        let tick = getTick();

        // Critical health: retreat
        if health < 15.0 {
            mode = MODE_RETREAT;
            return;
        }

        // Taking heavy fire: evade
        if hitsTaken > 3 && tick - evadeTimer < 50 {
            mode = MODE_EVADE;
            return;
        }

        // Have a target: attack
        if target.valid && tick - target.lastSeen < 40 {
            mode = MODE_ATTACK;
            return;
        }

        // Default: seek
        mode = MODE_SEEK;
    }

    // --- SEEK: Sweep the arena looking for targets ---
    fn doSeek() {
        // Move in a wide pattern to cover ground
        setSpeed(60);
        setTurnRate(2);
        setGunTurnRate(6);

        // Avoid walls
        avoidWalls();
    }

    // --- ATTACK: Pursue and fire at target ---
    fn doAttack() {
        let energy = getEnergy();

        // Predict target position
        let bulletPower = choosePower();
        let bulletSpeed = 14.0 - bulletPower * 2.0;
        let flightTime = target.distance / bulletSpeed;

        let px = target.x + sin(target.heading) * target.speed * flightTime;
        let py = target.y + cos(target.heading) * target.speed * flightTime;

        // Aim gun
        let aimAngle = bearingTo(px, py);
        setGunHeading(aimAngle);

        // Strafe perpendicular to target for harder dodging
        let strafeBearing = normalizeAngle(bearingTo(target.x, target.y) + 90.0);
        setHeading(strafeBearing);
        setSpeed(50);

        // Fire when aimed
        let aimError = abs(normalizeAngle(getGunHeading() - aimAngle));
        if aimError < 3.0 && getGunHeat() == 0.0 && energy > 5.0 {
            fire(bulletPower);
        }

        avoidWalls();
    }

    fn choosePower() -> int {
        let energy = getEnergy();
        let dist = target.distance;

        // Low energy: conserve
        if energy < 20.0 { return 1; }

        // Close range: maximum damage
        if dist < 100.0 { return 4; }

        // Medium range: balanced
        if dist < 300.0 { return 2; }

        // Long range: low power (faster bullet, easier to hit)
        return 1;
    }

    // --- EVADE: Dodge incoming fire ---
    fn doEvade() {
        // Zigzag movement
        if getTick() % 20 == 0 {
            evadeDirection = -evadeDirection;
        }

        let evadeAngle = normalizeAngle(getHeading() + 90.0 * evadeDirection);
        setHeading(evadeAngle);
        setSpeed(100);

        // Keep gun on target if we have one
        if target.valid {
            setGunHeading(bearingTo(target.x, target.y));
            if getGunHeat() == 0.0 {
                fire(1);  // quick low-power shots while dodging
            }
        }

        avoidWalls();

        // Exit evade mode after timer expires
        if getTick() - evadeTimer > 60 {
            hitsTaken = 0;
        }
    }

    // --- RETREAT: Run to a corner and heal ---
    fn doRetreat() {
        let bounds = getArenaBounds();

        // Find the corner furthest from any known target
        let safeX = 50.0;
        let safeY = 50.0;

        if target.valid {
            if target.x < bounds.width / 2.0 { safeX = bounds.width - 50.0; }
            if target.y < bounds.height / 2.0 { safeY = bounds.height - 50.0; }
        }

        setHeading(bearingTo(safeX, safeY));
        setSpeed(100);

        // Desperation fire: if gun happens to be aimed, shoot
        if getGunHeat() == 0.0 {
            fire(1);
        }
        setGunTurnRate(10);

        avoidWalls();
    }

    // --- Helper: steer away from arena walls ---
    fn avoidWalls() {
        let bounds = getArenaBounds();
        let x = getX();
        let y = getY();
        let margin = 40.0;

        if x < margin {
            setHeading(90.0);  // steer east
        } else if x > bounds.width - margin {
            setHeading(270.0); // steer west
        }

        if y < margin {
            setHeading(180.0); // steer south
        } else if y > bounds.height - margin {
            setHeading(0.0);   // steer north
        }
    }

    fn updateTarget(result: ScanResult) {
        target.x = getX() + sin(result.bearing) * result.distance;
        target.y = getY() + cos(result.bearing) * result.distance;
        target.heading = result.heading;
        target.speed = result.speed;
        target.distance = result.distance;
        target.energy = result.energy;
        target.lastSeen = getTick();
        target.valid = true;
    }

    // --- Event handlers ---

    on hit(damage: float, bearing: float) {
        hitsTaken += 1;
        evadeTimer = getTick();

        // Track the attacker
        target.x = getX() + sin(bearing) * 150.0;
        target.y = getY() + cos(bearing) * 150.0;
        target.lastSeen = getTick();
        target.valid = true;
    }

    on bulletHit(targetId: int) {
        hitsDealt += 1;
    }

    on wallHit(bearing: float) {
        // Reverse direction on wall collision
        setSpeed(-50);
        setHeading(normalizeAngle(getHeading() + 120.0));
    }
}
```

This robot demonstrates:
- **State machine** with four modes and dynamic transitions
- **Predictive aiming** that leads targets based on velocity
- **Energy management** that adjusts fire power based on resources
- **Strafing movement** perpendicular to the target
- **Adaptive evasion** with zigzag patterns when under fire
- **Wall avoidance** as a reusable utility function
- **Event-driven state updates** that feed into the main loop

---

## 6. Syntax Style Comparison {#6-syntax-style-comparison}

To validate our syntax choices, here is the same simple robot (SpinBot with wall
avoidance) written in three different syntax styles.

### 6.1 Option A: Classic C-like (Semicolons, Explicit Types)

```c
robot "SpinBot" {

    var direction: int = 1;

    fn init() -> void {
        setColor(255, 0, 0);
    }

    fn tick() -> void {
        setSpeed(50);
        setTurnRate(8 * direction);
        setGunTurnRate(-5);

        if (getGunHeat() == 0.0) {
            fire(2);
        }

        var x: float = getX();
        var bounds: Bounds = getArenaBounds();
        if (x < 40.0 || x > bounds.width - 40.0) {
            direction = direction * -1;
        }
    }

    on hit(damage: float, bearing: float) -> void {
        direction = direction * -1;
    }
};
```

**Pros:** Extremely familiar to C/Java/C# programmers. Semicolons and parenthesized
conditions are what most programmers expect.

**Cons:** Semicolons are visual noise in a small language. `-> void` is pointless
ceremony. Parentheses around `if` conditions add nothing. The trailing `};` is
a common source of errors.

### 6.2 Option B: Modernized C (Our Proposed Syntax)

```c
robot "SpinBot" {

    var direction: int = 1;

    fn init() {
        setColor(255, 0, 0);
    }

    fn tick() {
        setSpeed(50);
        setTurnRate(8 * direction);
        setGunTurnRate(-5);

        if getGunHeat() == 0.0 {
            fire(2);
        }

        let x = getX();
        let bounds = getArenaBounds();
        if x < 40.0 || x > bounds.width - 40.0 {
            direction = direction * -1;
        }
    }

    on hit(damage: float, bearing: float) {
        direction = direction * -1;
    }
}
```

**Pros:** Familiar C-like structure but with modern ergonomics. No semicolons.
No parentheses required on `if`. Type inference with `let`. Curly braces provide
clear block structure. The `on` keyword for events reads like English.

**Cons:** Programmers who rely on semicolons as line delimiters may stumble initially.
Some may find the `let`/`var` distinction confusing at first.

### 6.3 Option C: Python-like (Indentation, No Braces)

```python
robot "SpinBot":

    var direction: int = 1

    def init():
        setColor(255, 0, 0)

    def tick():
        setSpeed(50)
        setTurnRate(8 * direction)
        setGunTurnRate(-5)

        if getGunHeat() == 0.0:
            fire(2)

        let x = getX()
        let bounds = getArenaBounds()
        if x < 40.0 or x > bounds.width - 40.0:
            direction = direction * -1

    on hit(damage: float, bearing: float):
        direction = direction * -1
```

**Pros:** Minimal syntax, very clean. Appealing to Python programmers, who are a
large portion of hobby programmers. No braces or semicolons to forget.

**Cons:** Indentation-sensitivity is a known source of subtle bugs, especially when
sharing code online (forums strip whitespace, copy-paste breaks indentation).
Does not compile as naturally to WASM (braces directly map to WASM block structure).
Mixing tabs and spaces causes invisible errors.

### 6.4 Recommendation: Option B (Modernized C)

**Option B is the recommended syntax.** Here is the reasoning:

| Criterion | A (Classic C) | B (Modern C) | C (Python-like) |
|---|---|---|---|
| Familiarity | High | High | Medium |
| Boilerplate | High | Low | Very Low |
| Copy-paste safety | Good | Good | Poor |
| WASM compilation fit | Good | Good | Moderate |
| Error-prone syntax | Medium (semicolons) | Low | Medium (whitespace) |
| Looks fun, not corporate | No | Yes | Yes |
| Editor support ease | Easy | Easy | Harder |

The modernized C syntax preserves the structural clarity of C (curly braces map
directly to WASM blocks) while removing the ceremony that makes C feel like work
(semicolons, required parentheses, explicit void returns). The `let`/`var` distinction
and `on` keyword add just enough modern flavor to feel fresh without being alien.

---

## 7. Error Handling and Developer Experience {#7-error-handling-and-developer-experience}

### 7.1 Compiler Error Messages

The compiler should produce error messages that are helpful, specific, and
non-intimidating. Every error message should:

1. **Point to the exact location** with line number and column
2. **Explain what went wrong** in plain language
3. **Suggest a fix** when possible

**Example error messages:**

```
error[E001]: Unknown function 'fireBullet'
  --> mybot.rbl:12:9
   |
12 |         fireBullet(3);
   |         ^^^^^^^^^^
   |
   = help: Did you mean 'fire'? The fire(power) function accepts
     a power level from 1 to 5.
```

```
error[E002]: Type mismatch in assignment
  --> mybot.rbl:8:24
   |
 8 |     var speed: int = 3.5;
   |                      ^^^
   |
   = note: Cannot assign a float value to an int variable.
   = help: Use 'var speed: float = 3.5' or 'var speed: int = 3'
```

```
error[E003]: Variable 'targetX' used but never assigned
  --> mybot.rbl:15:22
   |
15 |     setHeading(bearingTo(targetX, targetY));
   |                          ^^^^^^^
   |
   = note: 'targetX' is declared on line 3 with default value 0.0.
     Is this intentional, or did you forget to update it in an
     event handler?
```

```
warning[W001]: This scan result is never checked for null
  --> mybot.rbl:20:9
   |
20 |     let result = scan();
21 |     let dist = result.distance;
   |                ^^^^^^^^^^^^^^^ result could be null
   |
   = help: Use 'if result != null { ... }' to handle the case
     where no robot was found.
```

```
error[E004]: 'tick' function is missing
  --> mybot.rbl
   |
   = note: Every robot must define a 'fn tick()' function. This is
     called once per game tick and is where your robot makes decisions.
   = help: Add this to your robot:
     |
     |  fn tick() {
     |      // Your robot logic here
     |  }
```

### 7.2 Runtime Errors

Runtime errors do not crash the game. Instead, the robot skips its turn and the error
is reported to the player via the debug panel.

```
runtime error: Array index out of bounds
  --> mybot.rbl:24:15
   |
24 |     scores[i] = 10;
   |     ^^^^^^^^^ index 10 is out of range for array of size 10
   |
   = note: Your robot skipped tick 347. Valid indices are 0..9.
```

```
runtime error: Division by zero
  --> mybot.rbl:18:22
   |
18 |     let ratio = hits / shots;
   |                 ^^^^^^^^^^^^
   |
   = note: 'shots' is 0. Your robot skipped tick 112.
   = help: Check that the divisor is not zero before dividing.
```

```
runtime warning: Tick computation limit exceeded (10000 iterations)
  --> mybot.rbl:30:5
   |
30 |     while scanning {
   |     ^^^^^ This loop ran for 10000 iterations without finishing.
   |
   = note: Your robot skipped tick 89. Check your loop condition
     to ensure it will terminate.
```

### 7.3 Source Maps (WASM-to-Source Mapping)

The RBL compiler should emit DWARF debug information or a custom source map that maps
WebAssembly instruction offsets back to RBL source locations. This enables:

- **Stack traces with source lines** when a runtime error occurs
- **Breakpoint debugging** in the game's built-in editor
- **Step-through execution** at the source level
- **Variable inspection** during paused execution

Implementation approach:
- The compiler emits a `.rbl.map` JSON file alongside the `.wasm` output
- The map contains: `{ wasmOffset -> { file, line, column, functionName } }`
- The game runtime consults this map when reporting errors or hitting breakpoints
- The map format is intentionally simple (not the full DWARF spec) for fast lookups

### 7.4 Syntax Highlighting

RBL syntax highlighting should be available for:

**CodeMirror 6** (recommended for the in-game editor):
- Language package defining tokens: keywords, types, functions, operators, comments
- Autocompletion for API functions with parameter hints
- Inline error display from the compiler
- Bracket matching and auto-closing

**Monaco Editor** (alternative):
- TextMate grammar for syntax highlighting
- Language server protocol (LSP) support for richer features
- Hover documentation for API functions

The token categories for highlighting:

| Category | Examples | Suggested Color |
|---|---|---|
| Keywords | `fn`, `let`, `var`, `const`, `if`, `else`, `while`, `for`, `match`, `on`, `return`, `robot`, `struct` | Bold, primary accent |
| Types | `int`, `float`, `bool`, `angle` | Distinct from keywords |
| Robot API | `setSpeed`, `fire`, `scan`, `getX`, `getHealth` | Distinct, thematic color |
| Math builtins | `sin`, `cos`, `sqrt`, `abs`, `atan2` | Same as API or subdued |
| Constants | `true`, `false`, `null` | Literal color |
| Numbers | `42`, `3.14`, `0xFF` | Literal color |
| Strings | `"SpinBot"` | String color (only in robot name) |
| Comments | `// ...`, `/* ... */` | Subdued / gray |
| Operators | `+`, `-`, `*`, `==`, `&&` | Default text |

### 7.5 Built-in Debugger

The game should include a debugger that lets players:

1. **Pause the match** at any tick
2. **Step forward** one tick at a time
3. **Set breakpoints** on source lines (the tick pauses when that line executes)
4. **Inspect variables** -- see the current value of all globals and locals
5. **Watch expressions** -- evaluate arbitrary expressions each tick
6. **View the robot's intent** -- what commands it queued this tick before they execute
7. **Replay** -- rewind to any previous tick (requires recording game state)

The debugger should display:
- The source code with the current line highlighted
- A variable panel showing all `var` globals with their current values
- An event log showing which events fired this tick
- A command log showing what commands the robot issued
- A mini-map showing the robot's position and scan cone

**Debug mode performance:** When debugging is active, execution is slower because
every instruction is instrumented. This is acceptable because debugging is a
development-time activity, not tournament-time.

### 7.6 Hot Reload

During development (not in tournaments), the player should be able to edit their
robot's source code and see the changes take effect immediately without restarting
the match. Implementation:

1. Player edits code in the editor panel
2. On save (or on every keystroke with debouncing), the compiler runs
3. If compilation succeeds, the new WASM module replaces the old one
4. Global variables retain their current values (the robot keeps its state)
5. If compilation fails, the old code keeps running and errors are shown inline

This "edit-compile-see" loop should take under 100ms to maintain flow state.

### 7.7 Tournament Mode Restrictions

In tournament mode (competitive play), certain development features are disabled:

- No `debug()` output (stripped at compile time)
- No breakpoints or stepping
- Source code is not visible to opponents
- Execution time limits are strictly enforced
- WASM module size limits are enforced (prevents code bloat)

---

## Appendix A: Grammar Summary (EBNF Sketch)

```ebnf
program     = "robot" STRING "{" (declaration | function | event)* "}" ;
declaration = ("var" | "let" | "const") IDENT (":" type)? "=" expr ;
function    = "fn" IDENT "(" params? ")" ("->" type)? block ;
event       = "on" IDENT "(" params? ")" block ;
block       = "{" statement* "}" ;
statement   = declaration | assignment | ifStmt | whileStmt
            | forStmt | matchStmt | loopStmt | returnStmt
            | exprStmt ;
ifStmt      = "if" expr block ("else" (ifStmt | block))? ;
whileStmt   = "while" expr block ;
forStmt     = "for" (IDENT "in" expr ".." expr | declaration ";" expr ";" assignment) block ;
matchStmt   = "match" expr "{" (expr "=>" (expr | block) ",")* "}" ;
loopStmt    = "loop" block ;
returnStmt  = "return" expr? ;
exprStmt    = expr ;
assignment  = IDENT ("=" | "+=" | "-=" | "*=" | "/=") expr ;
expr        = /* standard expression grammar with precedence */ ;
type        = "int" | "float" | "bool" | "angle" | IDENT
            | type "[" INT "]" ;
structDecl  = "struct" IDENT "{" (type IDENT ";")* "}" ;
params      = param ("," param)* ;
param       = IDENT ":" type ;
```

## Appendix B: Comparison with Prior Art APIs

| Feature | CROBOTS | Robot Battle | Robocode | RBL (Proposed) |
|---|---|---|---|---|
| Language | C subset | Custom (RSL) | Java / C# | Custom (RBL) |
| Execution model | Continuous | Event-driven | Loop + events | Tick + events |
| Movement | `drive(deg, speed)` | Body commands | `ahead(dist)` | `setSpeed(n)` |
| Firing | `cannon(deg, range)` | Gun commands | `fire(power)` | `fire(power)` |
| Scanning | `scan(deg, res)` | Radar sections | `scan()` + event | `scan()` -> result |
| Body/gun independence | No | Yes (3 parts) | Yes (3 parts) | Yes (2 parts) |
| Data types | int only | int + arrays | Full Java | int, float, bool, arrays, structs |
| Events | None (polling) | Priority-based | Method overrides | `on` handlers |
| State persistence | Global vars | Section state | Object fields | `var` globals |
| Deterministic | Yes | Yes | Mostly | Yes (strict) |
| Sandbox | Yes | Yes | Partial | Yes (WASM) |
| Target platform | Custom VM | Custom VM | JVM / CLR | WebAssembly |

## Appendix C: WASM Compilation Considerations

### Type Mapping

| RBL Type | WASM Type | Notes |
|---|---|---|
| `int` | `i32` | Direct mapping |
| `float` | `f64` | All floats are double precision |
| `bool` | `i32` | 0 = false, 1 = true |
| `angle` | `f64` | Same as float at WASM level |
| Arrays | Linear memory | Base pointer + offset |
| Structs | Linear memory | Flattened to fields |

### Function Calls

Robot API functions (`setSpeed`, `fire`, `scan`, etc.) are implemented as WASM
imports. The host environment (the game engine, written in JS/TS) provides these
functions via the WASM import mechanism:

```wasm
(import "robot" "setSpeed" (func $setSpeed (param i32)))
(import "robot" "fire" (func $fire (param i32)))
(import "robot" "getX" (func $getX (result f64)))
(import "robot" "scan" (func $scan (result i32)))  ;; returns pointer to ScanResult
```

The game engine calls the robot's exported `tick` function each game tick:

```wasm
(export "tick" (func $tick))
(export "init" (func $init))
(export "on_hit" (func $on_hit))
```

### Memory Layout

```
WASM Linear Memory (fixed size, e.g., 64KB = 1 page):

0x0000 - 0x00FF : Reserved (scan result buffer, return values)
0x0100 - 0x0FFF : Global variables (var declarations)
0x1000 - 0xFFFF : Stack (grows downward from top)
```

No heap, no dynamic allocation. The compiler statically computes the exact memory
layout at compile time. If a robot exceeds the memory limit (too many globals or
arrays), the compiler emits an error.

---

## References

The following sources informed this design document:

- [Robot Battle - HandWiki](https://handwiki.org/wiki/Software:Robot_Battle) -- Overview of the original Robot Battle game and RSL language
- [Robocode - Robowiki](https://robowiki.net/wiki/Robocode) -- Robocode community wiki and documentation
- [Robocode Robot API](https://robocode.sourceforge.io/docs/robocode/robocode/Robot.html) -- Full Java API for Robocode's Robot class
- [Robocode Tank Royale - Beyond the Basics](https://robocode.dev/tutorial/beyond-the-basics.html) -- Execution model and turn-based architecture
- [Core War - Wikipedia](https://en.wikipedia.org/wiki/Core_War) -- History and design of Redcode and Core War
- [CROBOTS - GitHub](https://github.com/tpoindex/crobots) -- CROBOTS source and documentation
- [CROBOTS Documentation](https://github.com/tpoindex/crobots/blob/master/src/crobots.doc) -- C subset and API reference
- [RobotWar - Wikipedia](https://en.wikipedia.org/wiki/RobotWar) -- The original 1981 robot programming game
- [Core War: Programming Games](https://corewar.co.uk/games.htm) -- Comprehensive list of programming battle games
- [Screeps Game Loop Documentation](https://docs.screeps.com/game-loop.html) -- Tick-based execution model
- [AT-Robots Homepage](http://necrobones.com/atrobots/) -- Assembly-based robot programming game
- [Robot Battle - MobyGames](https://www.mobygames.com/game/94250/robot-battle/) -- Game history and description
