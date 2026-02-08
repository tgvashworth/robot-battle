# RBL Language Specification

Robot Battle Language (RBL) — a Go-inspired language for programming battle robots. Compiles to WebAssembly.

## Design Principles

- Go-inspired: explicit over implicit, zero values over nil, types after names
- No nil, no null, no pointers, no generics
- Strict static types
- Every type has a zero value
- One file = one robot
- ~30 API functions, learnable in 30 minutes

---

## File Structure

Every `.rbl` file begins with a robot declaration. Top-level items are: the robot declaration, type definitions, global variables, constants, functions, and event handlers.

```go
robot "MyBot"

// Constants
const MAX_TARGETS = 8

// Type definitions
type Target struct {
    bearing  angle
    distance float
    tick     int
    active   bool
}

// Global variables (persist across ticks)
var state int
var targets [MAX_TARGETS]Target

// Functions
func tick() {
    // ...
}

// Event handlers
on scan(distance float, bearing angle) {
    // ...
}
```

---

## Types

### Primitives

| Type | Zero Value | Description |
|------|-----------|-------------|
| `int` | `0` | 32-bit signed integer |
| `float` | `0.0` | 32-bit IEEE 754 float |
| `bool` | `false` | Boolean |
| `angle` | `0` | Float that auto-normalizes to [0, 360) on every operation |

### Composite Types

**Fixed-size arrays**: `[N]Type` where N is a compile-time constant.

```go
var scores [4]int       // [0, 0, 0, 0]
var targets [8]Target   // 8 zero-valued Targets
```

**Structs**: Named product types. Defined at top level only.

```go
type Target struct {
    bearing  angle
    distance float
    tick     int
    active   bool
}
```

Struct literals use Go syntax:

```go
t := Target{bearing: 45, distance: 200, tick: getTick(), active: true}
t2 := Target{}  // all fields zero-valued
```

### The `angle` Type

The `angle` type is a domain-specific float that auto-normalizes to `[0, 360)` after every arithmetic operation. This is the one place where RBL diverges from Go's explicitness — bearing math is so central to robot programming that implicit normalization is justified.

```go
var heading angle = 350
heading = heading + 20   // heading is 10, not 370
heading = heading - 30   // heading is 340, not -20
```

`angle` converts explicitly to/from `float`:

```go
var a angle = 90
var f float = float(a)   // f = 90.0
var b angle = angle(f)   // b = 90
```

### No nil, No Null

There is no nil, null, none, or optional type. Every variable has a concrete zero value from the moment it exists. The "maybe" pattern uses multi-return with a bool:

```go
func bestTarget() (Target, bool) {
    // ...
    return closest, found
}

// Caller:
target, ok := bestTarget()
if ok {
    setGunHeading(target.bearing)
}
```

---

## Variables and Constants

### Global Variables (`var`)

Declared at file scope. Persist across ticks (this is the robot's memory).

```go
var targetCount int         // explicit type, zero-initialized
var speed float = 50.0      // explicit type + initial value
```

### Local Variables

Declared inside functions using `:=` (inferred) or `var` (explicit).

```go
func tick() {
    x := getX()               // type inferred as float
    var threshold float = 40.0 // explicit type
    x = x + 1.0               // reassignment with =
}
```

`:=` declares and assigns. `=` reassigns an existing variable. Using `=` on an undeclared name is a compile error. Using `:=` on an already-declared name in the same scope is a compile error.

### Constants

```go
const MAX_SPEED = 100
const PI = 3.14159
const MAX_TARGETS = 8
```

Constants must be compile-time evaluable. They have no address and are inlined.

---

## Operators

### Arithmetic
`+`, `-`, `*`, `/`, `%`

No `++` or `--`. Use `+= 1` and `-= 1`.

### Comparison
`==`, `!=`, `<`, `>`, `<=`, `>=`

### Logical
`&&`, `||`, `!`

### Assignment
`=`, `+=`, `-=`, `*=`, `/=`

### Bitwise
`&`, `|`, `^`, `<<`, `>>`

---

## Control Flow

### `if` / `else`

No parentheses around the condition (Go-style).

```go
if getHealth() < 30 {
    state = 2
} else if getHealth() < 60 {
    state = 1
} else {
    state = 0
}
```

### `for` (the only loop)

Three forms, like Go:

```go
// Condition-only (replaces "while")
for getHealth() > 0 {
    // ...
}

// Classic three-part
for i := 0; i < MAX_TARGETS; i += 1 {
    // ...
}

// Infinite (must break)
for {
    // ...
    if done {
        break
    }
}
```

`break` exits the innermost loop. `continue` skips to the next iteration. No labeled breaks.

### `switch`

No fallthrough by default (Go-style). No `break` needed.

```go
switch state {
case 0:
    scan_mode()
case 1:
    attack_mode()
case 2:
    evade_mode()
default:
    scan_mode()
}
```

### `return`

```go
func addOne(x int) int {
    return x + 1
}

func bestTarget() (Target, bool) {
    return closest, found
}
```

---

## Functions

Declared with `func`. Parameters and return types use Go ordering (name before type).

```go
func fire_at(bearing angle, power float) {
    setGunHeading(bearing)
    if getGunHeat() == 0 {
        fire(power)
    }
}

func distance(x1 float, y1 float, x2 float, y2 float) float {
    dx := x2 - x1
    dy := y2 - y1
    return sqrt(dx*dx + dy*dy)
}

func bestTarget() (Target, bool) {
    // multiple return values
    return target, true
}
```

### Required Functions

Every robot must define:

```go
func tick() {
    // Called once per simulation tick. This is where your robot thinks.
}
```

### Optional Functions

```go
func init() {
    // Called once when the robot spawns. Set colors, initialize state.
}
```

---

## Event Handlers

Declared with `on`. Syntactic sugar for exported functions called by the engine. Events fire at the start of each tick, before `tick()` runs.

Event handlers should be short — store data in globals and let `tick()` make decisions.

```go
on scan(distance float, bearing angle) {
    // Radar detected a robot
    targetDist = distance
    targetBearing = bearing
    targetFound = true
}

on hit(damage float, bearing angle) {
    // Your robot was hit by a bullet
    lastHitBearing = bearing
}

on bulletHit(targetId int) {
    // Your bullet hit another robot
}

on wallHit(bearing angle) {
    // Your robot hit a wall
}

on robotHit(bearing angle) {
    // Your robot collided with another robot
}

on scanned(bearing angle) {
    // Another robot's radar detected YOU. Bearing is the direction
    // the scan came from (i.e., where the scanner is relative to you).
    // Use this to react: dodge, turn to face the threat, or fire back.
}

on bulletMiss() {
    // Your bullet hit a wall (missed)
}

on robotDeath(robotId int) {
    // A robot was destroyed
}
```

Event handlers compile to regular exported WASM functions. They can call any function, read/write any global, and call API functions. They share the same fuel budget as `tick()`.

---

## Robot API

### Body Movement

```go
setSpeed(speed float)           // set desired speed (0 to 100)
setTurnRate(rate float)         // set body turn rate (degrees per tick, -10 to 10)
setHeading(heading angle)       // set desired heading (body turns toward it)
getX() float                    // current x position
getY() float                    // current y position
getHeading() angle              // current body heading
getSpeed() float                // current speed
```

### Gun

```go
setGunTurnRate(rate float)      // set gun turn rate (degrees per tick, -20 to 20)
setGunHeading(heading angle)    // set desired gun heading
getGunHeading() angle           // current gun heading
getGunHeat() float              // gun cooldown (0 = ready to fire)
fire(power float)               // fire bullet (power 1-5, costs energy)
getEnergy() float               // current energy
```

### Radar

```go
setRadarTurnRate(rate float)    // set radar turn rate (degrees per tick, -45 to 45)
setRadarHeading(heading angle)  // set desired radar heading
getRadarHeading() angle         // current radar heading
setScanWidth(degrees float)     // scan arc width (1 to 45 degrees)
```

Radar scans automatically each tick. When the scan arc sweeps over an enemy robot, `on scan(distance, bearing)` fires.

### Status

```go
getHealth() float               // current health (0 to 100)
getTick() int                   // current tick number
```

### Arena

```go
arenaWidth() float              // arena width
arenaHeight() float             // arena height
robotCount() int                // robots still alive
```

### Utility

```go
distanceTo(x float, y float) float     // distance from robot to point
bearingTo(x float, y float) angle      // bearing from robot to point
random(max int) int                     // random int in [0, max)
randomFloat() float                     // random float in [0.0, 1.0)
debug(value int)                        // print to debug console
debug(value float)                      // (overloaded for float)
setColor(r int, g int, b int)          // set body color
setGunColor(r int, g int, b int)       // set gun color
setRadarColor(r int, g int, b int)     // set radar color
```

### Math Builtins

```go
sin(a angle) float          cos(a angle) float
tan(a angle) float          atan2(y float, x float) angle
sqrt(x float) float         abs(x float) float
min(a float, b float) float max(a float, b float) float
clamp(x float, lo float, hi float) float
floor(x float) int          ceil(x float) int
round(x float) int
```

---

## Runtime Behavior

### Tick Execution Order

Each simulation tick:

1. Engine processes physics (movement, bullets, collisions)
2. Engine fires event handlers for things that happened (hits, scans, deaths)
3. Engine calls `tick()`
4. Engine applies the robot's intent (speed, turn rates, fire commands)

### Fuel Metering

Each `tick()` invocation (including event handlers) has a fuel budget of 10,000 gas. Every loop iteration and function call costs 1 gas. If fuel runs out, the robot's turn ends immediately (equivalent to doing nothing).

### Runtime Errors

| Error | Behavior |
|-------|----------|
| Division by zero | Returns 0, logs warning to debug panel |
| Array out of bounds | Traps: robot skips this tick, error reported |
| Stack overflow | Traps: robot skips this tick, error reported |
| Fuel exhausted | Turn ends silently, robot does nothing further this tick |

### Zero Values

Every type has a zero value. Variables are zero-initialized if no initial value is given.

| Type | Zero Value |
|------|-----------|
| `int` | `0` |
| `float` | `0.0` |
| `bool` | `false` |
| `angle` | `0` |
| `[N]T` | N copies of T's zero value |
| `struct` | All fields set to their zero values |

---

## Grammar Summary (EBNF)

```ebnf
program       = robot_decl { top_level } ;
robot_decl    = "robot" STRING_LIT ;
top_level     = const_decl | type_decl | var_decl | func_decl | event_decl ;

const_decl    = "const" IDENT "=" expr ;
type_decl     = "type" IDENT "struct" "{" { field_decl } "}" ;
field_decl    = IDENT type ;
var_decl      = "var" IDENT type [ "=" expr ] ;

func_decl     = "func" IDENT "(" [ params ] ")" [ return_type ] block ;
event_decl    = "on" IDENT "(" [ params ] ")" block ;
params        = param { "," param } ;
param         = IDENT type ;
return_type   = type | "(" type "," type ")" ;

block         = "{" { statement } "}" ;
statement     = var_stmt | assign_stmt | short_decl | if_stmt
              | for_stmt | switch_stmt | return_stmt | break_stmt
              | continue_stmt | expr_stmt | block ;

short_decl    = ident_list ":=" expr_list ;
assign_stmt   = expr assign_op expr ;
assign_op     = "=" | "+=" | "-=" | "*=" | "/=" ;
if_stmt       = "if" expr block [ "else" ( if_stmt | block ) ] ;
for_stmt      = "for" [ for_clause ] block ;
for_clause    = expr | short_decl ";" expr ";" assign_stmt ;
switch_stmt   = "switch" expr "{" { case_clause } "}" ;
case_clause   = ( "case" expr | "default" ) ":" { statement } ;
return_stmt   = "return" [ expr_list ] ;

type          = "int" | "float" | "bool" | "angle"
              | "[" INT_LIT "]" type | IDENT ;

expr          = unary_expr | expr binary_op expr
              | expr "(" [ expr_list ] ")"     (* function call *)
              | expr "." IDENT                 (* field access *)
              | expr "[" expr "]"              (* array index *)
              | "(" expr ")"
              | IDENT | INT_LIT | FLOAT_LIT | "true" | "false"
              | IDENT "{" [ field_init_list ] "}" ;  (* struct literal *)

binary_op     = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">"
              | "<=" | ">=" | "&&" | "||" | "&" | "|" | "^" | "<<" | ">>" ;
unary_op      = "-" | "!" ;
```

---

## Example: Complete Robot

```go
robot "Guardian"

// Track the best target we've seen
type Target struct {
    bearing  angle
    distance float
    lastSeen int
    active   bool
}

var target Target
var patrolDir float = 1.0

func init() {
    setColor(0, 200, 100)
    setGunColor(0, 255, 150)
    setRadarColor(0, 100, 50)
}

func tick() {
    // Always spin radar
    setRadarTurnRate(30)

    if target.active && getTick() - target.lastSeen < 30 {
        engage()
    } else {
        patrol()
    }
}

func engage() {
    // Aim gun at target
    setGunHeading(target.bearing)

    // Close distance if far, maintain distance if close
    if target.distance > 200 {
        setHeading(target.bearing)
        setSpeed(60)
    } else if target.distance < 100 {
        setHeading(target.bearing + 180)
        setSpeed(40)
    } else {
        // Strafe
        setHeading(target.bearing + 90)
        setSpeed(50)
    }

    // Fire based on distance
    if getGunHeat() == 0 && getEnergy() > 10 {
        power := clamp(400.0 / target.distance, 1, 4)
        fire(power)
    }
}

func patrol() {
    setSpeed(30)
    setTurnRate(2 * patrolDir)
    target.active = false
}

on scan(distance float, bearing angle) {
    target = Target{
        bearing:  bearing,
        distance: distance,
        lastSeen: getTick(),
        active:   true,
    }
}

on hit(damage float, bearing angle) {
    // If we don't have a target, the thing that hit us is our target
    if !target.active {
        target = Target{
            bearing:  bearing + 180,
            distance: 150,
            lastSeen: getTick(),
            active:   true,
        }
    }

    // Dodge perpendicular to the hit
    setHeading(bearing + 90)
    setSpeed(80)
}

on wallHit(bearing angle) {
    patrolDir = patrolDir * -1
    setHeading(getHeading() + 180)
}
```
