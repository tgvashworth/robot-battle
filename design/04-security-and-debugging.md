# Security Model and Debugging Capabilities

This document defines the security model, threat analysis, and debugging/logging system for Robot Battle. It covers WASM sandbox guarantees, the complete import surface, resource exhaustion defenses, cross-robot information barriers, compiler hardening, runtime error handling, the debug system, and source maps.

The three non-negotiable security requirements are:

1. **Bots cannot access each other** -- one robot must have zero ability to read, write, or infer anything about another robot's internal state.
2. **Separate memory model** -- each robot has its own isolated memory space.
3. **No host access** -- robots must not be able to affect the host environment in any negative way (no DOM, no network, no filesystem, no timers, no ambient authority).

---

## 1. WASM Sandbox Threat Model

### 1.1 Memory Isolation

**Threat**: One robot reads or writes another robot's memory, gaining access to its strategy, internal state, or variables.

**How WASM handles this naturally**: Each robot is instantiated as a separate `WebAssembly.Instance`, each with its own `WebAssembly.Memory` object. WASM linear memory is a contiguous byte array that the module accesses through `i32.load` and `i32.store` instructions. All memory accesses are bounds-checked against the memory's current size. There is no instruction in the WASM specification that takes an arbitrary host pointer or references another instance's memory. The module literally cannot name, address, or discover memory that belongs to a different instance.

**Why this is airtight**: WASM memory addresses are offsets into the instance's own linear memory, starting at 0. Address `0x1000` in Robot A refers to byte 4096 of Robot A's memory. Address `0x1000` in Robot B refers to byte 4096 of Robot B's memory. There is no address Robot A can construct that resolves to Robot B's memory. The two address spaces are completely disjoint at the WASM specification level, and this is enforced by the browser engine.

**Additional measure -- no SharedArrayBuffer between robot instances**: We never create a `WebAssembly.Memory` with `shared: true` and we never pass the same Memory object to multiple robot instances. Each robot gets its own freshly constructed Memory.

**Memory limits**: Each robot's memory is capped using the `maximum` parameter on `WebAssembly.Memory`:

```typescript
const memory = new WebAssembly.Memory({
  initial: 1,   // 64 KiB -- sufficient for most robot state
  maximum: 16,  // 1 MiB cap -- generous but bounded
});
```

**What happens when a robot tries to grow memory beyond the cap**: The WASM `memory.grow` instruction returns `-1` (failure). The robot's linear memory remains at its current size. Since our language (RBL) does not expose `memory.grow` to the programmer -- the compiler manages memory layout statically -- this can only happen if the compiler emits code that attempts growth. Our compiler will not emit `memory.grow` instructions in the initial implementation because all data (globals, arrays, structs) has a statically known size computed at compile time. If dynamic growth is added later, the compiler will emit a bounds check and trap on failure.

**Out-of-bounds memory access**: Any `i32.load`, `i32.store`, or equivalent instruction that accesses an offset beyond the current memory size causes an immediate WASM trap. The trap is caught by the host as a JavaScript exception. The robot's tick ends, and the simulation continues with other robots unaffected. There is no undefined behavior -- the WASM specification requires trapping (not clamping, not wrapping, not returning garbage).

### 1.2 Import Surface Attack

**Threat**: A robot abuses its imported functions to affect the host, leak information about other robots, or escape the sandbox.

**Why this is the critical attack surface**: The ONLY way a WASM module can interact with anything outside its own linear memory is through imported functions. A module with zero imports is a pure computation that can only transform its own memory. Every import we provide is a capability we grant. The security of the system therefore reduces to: "Are the imports safe?"

**Complete enumeration of every import function**:

The following table lists every function imported by a robot WASM module. No other imports exist. This is the exhaustive list.

#### Body Movement Imports

| Import | Signature | Behavior | Safety Analysis |
|--------|-----------|----------|-----------------|
| `setSpeed` | `(f32) -> void` | Sets the robot's desired speed (clamped to 0-100 by engine) | Safe. Writes to the calling robot's own intent buffer. Cannot affect other robots. |
| `setTurnRate` | `(f32) -> void` | Sets body turn rate (clamped to -10..10 by engine) | Safe. Same as above. |
| `setHeading` | `(f32) -> void` | Sets desired heading (engine turns body toward it) | Safe. Same as above. |
| `getX` | `() -> f32` | Returns the robot's own X position | Safe. Returns the calling robot's own position. Cannot query other robots. |
| `getY` | `() -> f32` | Returns the robot's own Y position | Safe. Same as above. |
| `getHeading` | `() -> f32` | Returns the robot's own body heading | Safe. Returns own state only. |
| `getSpeed` | `() -> f32` | Returns the robot's own current speed | Safe. Returns own state only. |

#### Gun Imports

| Import | Signature | Behavior | Safety Analysis |
|--------|-----------|----------|-----------------|
| `setGunTurnRate` | `(f32) -> void` | Sets gun turn rate (clamped to -20..20) | Safe. Own intent buffer. |
| `setGunHeading` | `(f32) -> void` | Sets desired gun heading | Safe. Own intent buffer. |
| `getGunHeading` | `() -> f32` | Returns gun heading | Safe. Own state. |
| `getGunHeat` | `() -> f32` | Returns gun cooldown | Safe. Own state. |
| `fire` | `(f32) -> void` | Fires a bullet (power clamped to 1-5, costs energy) | Safe. Creates a bullet entity owned by the simulation engine. The robot cannot control the bullet after firing. Power is clamped by the engine. |
| `getEnergy` | `() -> f32` | Returns current energy | Safe. Own state. |

#### Radar Imports

| Import | Signature | Behavior | Safety Analysis |
|--------|-----------|----------|-----------------|
| `setRadarTurnRate` | `(f32) -> void` | Sets radar turn rate (clamped to -45..45) | Safe. Own intent buffer. |
| `setRadarHeading` | `(f32) -> void` | Sets desired radar heading | Safe. Own intent buffer. |
| `getRadarHeading` | `() -> f32` | Returns radar heading | Safe. Own state. |
| `setScanWidth` | `(f32) -> void` | Sets scan arc width (clamped to 1-45 degrees) | Safe. Own intent buffer. |

#### Status Imports

| Import | Signature | Behavior | Safety Analysis |
|--------|-----------|----------|-----------------|
| `getHealth` | `() -> f32` | Returns current health (0-100) | Safe. Own state. |
| `getTick` | `() -> i32` | Returns current tick number | Safe. This is global simulation state but it is the same for all robots and contains no per-robot information. |

#### Arena Imports

| Import | Signature | Behavior | Safety Analysis |
|--------|-----------|----------|-----------------|
| `arenaWidth` | `() -> f32` | Returns arena width | Safe. Static arena geometry, same for all robots. |
| `arenaHeight` | `() -> f32` | Returns arena height | Safe. Same as above. |
| `robotCount` | `() -> i32` | Returns number of robots still alive | Safe. This reveals a global count but not the identity, position, health, or strategy of any specific robot. It is a game mechanic -- robots need to know if opponents remain. |

#### Utility Imports

| Import | Signature | Behavior | Safety Analysis |
|--------|-----------|----------|-----------------|
| `distanceTo` | `(f32, f32) -> f32` | Euclidean distance from robot to a point | Safe. Pure geometry computation using the robot's own position. |
| `bearingTo` | `(f32, f32) -> f32` | Bearing from robot to a point | Safe. Same as above. |
| `random` | `(i32) -> i32` | Returns random int in [0, max) | Safe. Uses the simulation's seeded PRNG, not `crypto.getRandomValues` or `Math.random`. Each robot gets its own PRNG stream derived from the simulation seed. Cannot be used to generate cryptographic material or leak entropy about other robots. |
| `randomFloat` | `() -> f32` | Returns random float in [0.0, 1.0) | Safe. Same PRNG as above. |
| `debug_int` | `(i32) -> void` | Logs an integer to the debug panel | Safe. See detailed analysis in Section 3. Output goes to a per-robot buffer visible only in that robot's debug panel. |
| `debug_float` | `(f32) -> void` | Logs a float to the debug panel | Safe. Same as above. |
| `setColor` | `(i32, i32, i32) -> void` | Sets body RGB color | Safe. Cosmetic only. Values clamped to 0-255 by engine. |
| `setGunColor` | `(i32, i32, i32) -> void` | Sets gun RGB color | Safe. Cosmetic only. |
| `setRadarColor` | `(i32, i32, i32) -> void` | Sets radar RGB color | Safe. Cosmetic only. |

#### Math Builtins

| Import | Signature | Safety |
|--------|-----------|--------|
| `sin` | `(f32) -> f32` | Pure math, no side effects |
| `cos` | `(f32) -> f32` | Pure math |
| `tan` | `(f32) -> f32` | Pure math |
| `atan2` | `(f32, f32) -> f32` | Pure math |
| `sqrt` | `(f32) -> f32` | Pure math |
| `abs` | `(f32) -> f32` | Pure math |
| `min` | `(f32, f32) -> f32` | Pure math |
| `max` | `(f32, f32) -> f32` | Pure math |
| `clamp` | `(f32, f32, f32) -> f32` | Pure math |
| `floor` | `(f32) -> i32` | Pure math |
| `ceil` | `(f32) -> i32` | Pure math |
| `round` | `(f32) -> i32` | Pure math |

Math builtins are implemented as custom deterministic functions (polynomial approximations or lookup tables), not as calls to JavaScript's `Math` object. This ensures cross-browser determinism and eliminates any possibility of side effects.

#### Explicit Deny-All Policy

Any WASM import not listed above does not exist. The `WebAssembly.instantiate()` call receives an import object containing exactly these functions and nothing else. If a malformed or hand-crafted WASM module requests an import not in this set, instantiation fails with a `WebAssembly.LinkError`. This is enforced by the WASM specification -- a module cannot be instantiated if any of its declared imports are missing from the import object.

### 1.3 Timing Attacks

**Threat**: Robot A measures how long Robot B's tick takes to infer information about Robot B's code complexity, branching behavior, or strategy.

**Analysis**: All robots execute sequentially within the same simulation worker thread. The execution order within a single tick is: deliver events to all robots, then call `tick()` on each robot in sequence. However, no robot has access to any timing function:

- No `Date.now()` import is provided.
- No `performance.now()` import is provided.
- No timer-related import of any kind exists.
- WASM has no built-in instruction for reading wall-clock time.
- The `getTick()` import returns the simulation tick counter, which increments exactly once per simulation tick regardless of wall-clock time.

**Without a clock, timing attacks are impossible.** A robot cannot measure elapsed time between any two points in its execution. It cannot observe when its `tick()` is called relative to other robots' ticks.

**Web Worker timing concern**: The simulation runs in a single Web Worker. All robot ticks execute sequentially in the same thread. There is no message-passing between robot ticks that could introduce observable timing. The only `postMessage` occurs after ALL robots have executed their tick for the current simulation step, when the worker sends the frame state to the main thread. No robot can observe this message.

**Recommendation**: Never provide any time-related import. This is a hard rule. If future features require time-awareness (e.g., real-time mode), the simulation should provide a virtual clock that advances uniformly, not a wall-clock reading.

### 1.4 Resource Exhaustion

#### Infinite Loops

**Threat**: A robot enters an infinite loop in `tick()` or an event handler, freezing the simulation.

**Defense -- fuel metering**: The compiler injects a gas counter check at every loop back-edge and every function call site. Each robot starts each tick with a budget of 10,000 gas units. Every loop iteration costs 1 gas. Every function call costs 1 gas.

When fuel runs out, the injected code executes an `unreachable` instruction, causing a WASM trap. The host catches this trap, marks the robot's tick as "fuel exhausted", and the robot does nothing further this tick. On the next tick, its fuel is reset and it executes normally.

**What happens when fuel runs out mid-tick**: The robot's tick ends immediately. Any intents (setSpeed, fire, etc.) that the robot set before fuel exhaustion are still applied -- the engine processes whatever intents were registered up to the point of exhaustion. Intents that would have been set after exhaustion are simply never set. Other robots are completely unaffected.

**Can a robot deliberately exhaust fuel to gain an advantage?** No. Fuel exhaustion only harms the exhausting robot -- it loses its remaining computation for that tick. Other robots still get their full fuel budget. The simulation does not slow down because the fuel check is not wall-clock-based; it is instruction-counted. A robot that exhausts fuel in 10 microseconds and a robot that exhausts fuel in 50 microseconds both had the same gas budget -- the difference is irrelevant because no robot can observe wall-clock time.

#### Memory Bombs

**Threat**: A robot allocates memory until the browser tab crashes.

**Defense**: The `WebAssembly.Memory` object has a `maximum` field set to 16 pages (1 MiB). The WASM `memory.grow` instruction returns `-1` when the maximum is reached. Since our compiler does not emit `memory.grow` (all data is statically sized), this is defense-in-depth. Even if a hand-crafted WASM module were somehow loaded, it could not allocate more than 1 MiB.

#### Stack Overflow

**Threat**: A robot uses deep or infinite recursion to exhaust the call stack, crashing the simulation.

**Defense -- WASM traps on stack overflow**: WASM engines maintain a separate call stack (not in linear memory) with implementation-defined limits. Deep recursion traps with a `RangeError`. The host catches this exception, and the robot skips the tick.

**Defense -- fuel metering**: Because every function call costs 1 gas, infinite recursion also triggers fuel exhaustion before reaching engine stack limits (10,000 gas units means at most 10,000 stack frames, which is well within browser limits but also means the robot exhausts fuel long before that in practice since each frame does at least one operation).

#### Fuel Exhaustion Impact on Simulation Performance

A robot that exhaust its fuel does so in bounded time. The fuel check is a simple integer decrement and comparison (2 WASM instructions per check point). With 10,000 gas, the maximum number of check executions before trapping is 10,000. At ~1 nanosecond per check, fuel exhaustion takes at most ~10 microseconds of wall-clock time. This cannot perceptibly slow the simulation.

### 1.5 Side Channels

**Can a robot infer information about another robot from timing of API calls?** No. All API import functions return immediately with pre-computed values. The engine pre-computes each robot's state (position, health, energy, etc.) before any robot's tick executes. Import calls are simple property lookups on a JavaScript object, completing in nanoseconds. There is no observable latency variation based on other robots' state.

**Can a robot infer anything from the order of event delivery?** Events are delivered in a fixed processing order within each tick: `scan`, `hit`, `bulletHit`, `wallHit`, `robotHit`, `bulletMiss`, `robotDeath`. Within each event type, events are delivered in a deterministic order (e.g., scan events ordered by distance). This order is consistent and based on the calling robot's own situation. A robot receives only events about things that happened to IT (its bullets hitting, its scans detecting, it being hit). It does not receive other robots' events. The event delivery order does not leak information about other robots' code or strategy.

**Can a robot infer information from its own fuel consumption?** No. Fuel consumption is deterministic based solely on the robot's own code path. It depends on which branches are taken and how many loop iterations execute, all of which are determined by the robot's own logic and the game state it can legitimately observe. There is no correlation between one robot's fuel consumption and another robot's internal state.

**Can a robot infer information from `robotCount()`?** The `robotCount()` import returns how many robots are alive. This changes when robots die, which is observable. However, this is an intended game mechanic (knowing how many opponents remain is strategically relevant). It does not reveal which specific robot died, what its strategy was, or any internal state.

### 1.6 Code Injection

**Can a robot generate and execute new code at runtime?** No. WASM does not support dynamic code generation. There is no `eval`, no JIT compilation within WASM, no mechanism to construct new functions from data. The code section of a WASM module is immutable after compilation.

**Can a robot modify its own code?** No. The WASM code section is separate from linear memory and is read-only. A robot can modify its own data in linear memory but cannot modify the instructions being executed.

**Can a malformed .rbl file exploit the compiler?** This is a real concern. The compiler is a TypeScript program that parses untrusted input. A malicious .rbl file could attempt to:

- Cause the parser to enter an infinite loop or consume excessive memory via deeply nested expressions or pathologically long tokens.
- Trigger unhandled exceptions in semantic analysis.
- Generate a WASM module that, while valid, is designed to test edge cases in the browser's WASM JIT compiler.

**Mitigations are covered in Section 2.D (Compiler Hardening).**

### 1.7 Cross-Robot Information Barriers

**Goal**: Robot A should not be able to determine Robot B's health, energy, strategy, code, or any internal state. The only information robots get about each other is through legitimate game mechanics.

**Legitimate information channels** (intended game mechanics):

| Channel | What It Reveals | Why It Is Acceptable |
|---------|----------------|---------------------|
| `on scan(distance, bearing)` | Distance and bearing to a detected robot | Core game mechanic. Does not reveal which robot, its health, energy, or strategy. |
| `on hit(damage, bearing)` | That this robot was hit, from what bearing, and how much damage | Reveals information about the attacking robot's bullet power (derivable from damage), but this is a consequence of being shot. |
| `on bulletHit(targetId)` | That this robot's bullet hit a target, identified by an integer ID | See analysis below. |
| `on robotDeath(robotId)` | That a robot died, identified by an integer ID | See analysis below. |
| `robotCount()` | Number of living robots | Does not identify any specific robot. |

**Robot IDs in events -- security analysis**:

The `on bulletHit(targetId)` and `on robotDeath(robotId)` events expose integer IDs. These IDs require careful design:

- If IDs are stable across rounds (Robot A is always ID 0), a robot can develop opponent-specific strategies across rounds in a multi-round match. It could identify "ID 2 always moves clockwise" and counter specifically. This is a form of information leakage that goes beyond what the scan mechanic provides.
- If IDs are randomized per round, a robot can still correlate within a single round (track which IDs it has hit, which have died) but cannot carry knowledge about specific opponents across rounds.

**Recommendation**: Assign robot IDs randomly at the start of each round. Within a round, IDs are stable so that `bulletHit` and `robotDeath` events are coherent (a robot can track "I've hit ID 3 twice, and ID 3 just died"). Across rounds, IDs are reshuffled so no opponent-specific cross-round learning is possible. This preserves within-round tactical awareness while preventing cross-round profiling.

**What robot IDs do NOT reveal**: Health, energy, position (beyond scan/hit data), code, strategy, internal variable values, fuel consumption, or error state of the identified robot.

---

## 2. Security Implementation Checklist

### 2.A WASM Instance Isolation

Each robot is a separate `WebAssembly.Instance` with its own `WebAssembly.Memory`.

**Implementation**:

```typescript
function createRobotInstance(
  wasmModule: WebAssembly.Module,
  robotState: RobotState,
  debugBuffer: DebugBuffer
): WebAssembly.Instance {
  // Each robot gets its own memory -- never shared
  const memory = new WebAssembly.Memory({
    initial: 1,   // 64 KiB
    maximum: 16,  // 1 MiB hard cap
  });

  const imports = buildImportObject(memory, robotState, debugBuffer);

  return new WebAssembly.Instance(wasmModule, imports);
}
```

**Checklist**:

- [ ] Each robot instance has its own `WebAssembly.Memory` constructed with `maximum: 16`.
- [ ] No `SharedArrayBuffer` is used for robot memory.
- [ ] No two robot instances share any object references except the read-only simulation state accessors.
- [ ] The import object for each robot references only that robot's state, never another robot's state.
- [ ] The memory is exported by the module (for debug panel inspection by the host) but is never exposed to other robot instances.

### 2.B Import Allowlist

The import object is structured as a single `env` module:

```typescript
function buildImportObject(
  memory: WebAssembly.Memory,
  state: RobotState,
  debugBuf: DebugBuffer
): WebAssembly.Imports {
  return {
    env: {
      memory,

      // Movement (all write to state.intents, read from state)
      setSpeed:         (v: number) => { state.intents.speed = clamp(v, 0, 100); },
      setTurnRate:      (v: number) => { state.intents.turnRate = clamp(v, -10, 10); },
      setHeading:       (v: number) => { state.intents.heading = normalizeAngle(v); },
      getX:             ()          => state.x,
      getY:             ()          => state.y,
      getHeading:       ()          => state.heading,
      getSpeed:         ()          => state.speed,

      // Gun
      setGunTurnRate:   (v: number) => { state.intents.gunTurnRate = clamp(v, -20, 20); },
      setGunHeading:    (v: number) => { state.intents.gunHeading = normalizeAngle(v); },
      getGunHeading:    ()          => state.gunHeading,
      getGunHeat:       ()          => state.gunHeat,
      fire:             (v: number) => { state.intents.firePower = clamp(v, 1, 5); },
      getEnergy:        ()          => state.energy,

      // Radar
      setRadarTurnRate: (v: number) => { state.intents.radarTurnRate = clamp(v, -45, 45); },
      setRadarHeading:  (v: number) => { state.intents.radarHeading = normalizeAngle(v); },
      getRadarHeading:  ()          => state.radarHeading,
      setScanWidth:     (v: number) => { state.intents.scanWidth = clamp(v, 1, 45); },

      // Status
      getHealth:        ()          => state.health,
      getTick:          ()          => state.currentTick,

      // Arena
      arenaWidth:       ()          => state.arenaWidth,
      arenaHeight:      ()          => state.arenaHeight,
      robotCount:       ()          => state.aliveCount,

      // Utility
      distanceTo:       (x: number, y: number) => Math.hypot(x - state.x, y - state.y),
      bearingTo:        (x: number, y: number) => normalizeAngle(
                          Math.atan2(y - state.y, x - state.x) * (180 / Math.PI)
                        ),
      random:           (max: number) => state.prng.nextInt(Math.max(1, max | 0)),
      randomFloat:      ()             => state.prng.nextFloat(),
      debug_int:        (v: number)    => { debugBuf.logInt(v); },
      debug_float:      (v: number)    => { debugBuf.logFloat(v); },
      setColor:         (r: number, g: number, b: number) => {
                          state.color = [clamp(r|0, 0, 255), clamp(g|0, 0, 255), clamp(b|0, 0, 255)];
                        },
      setGunColor:      (r: number, g: number, b: number) => {
                          state.gunColor = [clamp(r|0, 0, 255), clamp(g|0, 0, 255), clamp(b|0, 0, 255)];
                        },
      setRadarColor:    (r: number, g: number, b: number) => {
                          state.radarColor = [clamp(r|0, 0, 255), clamp(g|0, 0, 255), clamp(b|0, 0, 255)];
                        },

      // Math (deterministic implementations, not JS Math)
      sin:   (a: number) => deterministicSin(a),
      cos:   (a: number) => deterministicCos(a),
      tan:   (a: number) => deterministicTan(a),
      atan2: (y: number, x: number) => deterministicAtan2(y, x),
      sqrt:  (x: number) => deterministicSqrt(x),
      abs:   (x: number) => Math.fround(Math.abs(x)),
      min:   (a: number, b: number) => Math.fround(Math.min(a, b)),
      max:   (a: number, b: number) => Math.fround(Math.max(a, b)),
      clamp: (x: number, lo: number, hi: number) => Math.fround(Math.min(Math.max(x, lo), hi)),
      floor: (x: number) => Math.floor(x) | 0,
      ceil:  (x: number) => Math.ceil(x) | 0,
      round: (x: number) => Math.round(x) | 0,
    },
  };
}
```

**Deny-all policy**: This import object is the ONLY object passed to `WebAssembly.instantiate()`. If a WASM module declares an import not present in this object, instantiation throws `WebAssembly.LinkError` and the robot fails to load. There is no fallback, no dynamic resolution, no ambient environment access.

### 2.C Fuel Metering

**Injection points**: The compiler injects fuel checks at two locations:

1. **Every loop back-edge** (the branch instruction that jumps back to the loop header in `for` and `for`-with-condition loops). This catches infinite loops.
2. **Every function call** (including calls to user-defined functions and recursive calls, but NOT calls to imported API functions since those are host-side and execute in bounded time). This catches infinite recursion.

**Gas budget**: 10,000 gas per tick. This budget covers all event handlers AND the `tick()` function. Event handlers and `tick()` share a single fuel counter because they execute within the same tick invocation sequence.

**Implementation**: The compiler emits a WASM global variable `$__fuel` of type `i32`. Before each tick, the host sets this global to the gas budget via an exported setter function.

```
;; Compiler-emitted fuel check (injected at every loop back-edge):
global.get $__fuel
i32.const 1
i32.sub
global.set $__fuel
global.get $__fuel
i32.const 0
i32.le_s
if
  unreachable          ;; trap: out of fuel
end
```

**What happens at exhaustion**: The `unreachable` instruction causes a WASM trap. The host catches this as a `WebAssembly.RuntimeError` with a message containing "unreachable". The engine distinguishes this from other traps by checking the fuel counter value (if `$__fuel <= 0`, it was a fuel exhaustion). The robot's tick ends. On the next tick, fuel is reset to 10,000.

**Fuel counter as a WASM global**: The counter is a mutable WASM global (`(global $__fuel (mut i32) (i32.const 0))`). It is exported so the host can set it before each tick. It is NOT an imported function call (which would be slower due to WASM-JS boundary crossing per check). Keeping it as a global means the fuel check is two WASM instructions (global.get + i32.le_s + br_if) with no boundary crossing, minimizing overhead.

**Estimated overhead**: Each fuel check is approximately 5 WASM instructions (get, const, sub, set, get, const, le_s, if, end). At ~1ns per instruction, each check costs ~5ns. With 10,000 checks maximum per tick, the total overhead is ~50 microseconds per tick in the worst case. This is negligible compared to the simulation's per-tick budget.

### 2.D Compiler Hardening

The compiler accepts untrusted input (.rbl source files). It must be robust against malicious or adversarial input.

**Input validation**:

| Limit | Value | Rationale |
|-------|-------|-----------|
| Maximum source file size | 64 KiB | A few hundred lines of RBL. Larger files are almost certainly adversarial. |
| Maximum token count | 50,000 | Prevents pathological tokenization. |
| Maximum nesting depth (scopes) | 32 | Prevents deeply nested `if`/`for` structures that exhaust the parser stack. |
| Maximum function count | 128 | No robot needs more than ~20 functions. |
| Maximum array size (elements) | 1,024 | Arrays of `[1024]int` use 4 KiB of memory, well within the 64 KiB initial page. |
| Maximum struct field count | 32 | Reasonable for any game struct. |
| Maximum number of global variables | 256 | Generous but bounded. |
| Maximum number of local variables per function | 128 | Prevents excessive WASM local slots. |
| Maximum WASM module size (output) | 256 KiB | Defense-in-depth. If the compiler produces a module larger than this, something has gone wrong. |
| Maximum string literal length (robot name) | 64 characters | Robot names do not need to be long. |
| Maximum number of constants | 256 | Generous but bounded. |

**Parser robustness**:

- The recursive descent parser tracks nesting depth and aborts with a clear error if `MAX_NESTING_DEPTH` is exceeded.
- The lexer has a maximum token length (no single token can be longer than 1,024 characters -- identifiers, number literals, etc.).
- The lexer rejects source files that do not consist of valid UTF-8.
- Comments are stripped during lexing with a maximum comment length of 4,096 characters.

**Code generation limits**:

- The Binaryen module is validated (`mod.validate()`) before binary emission. If validation fails, compilation is aborted with an internal compiler error.
- The emitted binary size is checked against the 256 KiB limit.

**Handling malicious input that tries to exploit the compiler**:

All compiler phases (lexer, parser, analyzer, codegen) are wrapped in try-catch. Any unhandled exception produces a generic "internal compiler error" message to the user. The compiler never crashes the application -- it returns an error result.

**Fuzzing recommendation**: Before shipping, the compiler should be fuzz-tested with random and semi-structured input. This can be done with a simple test harness that generates random strings, random token sequences, and mutated versions of valid programs, then verifies that the compiler either produces a valid result or a clean error. It must never throw an unhandled exception, hang, or produce invalid WASM.

### 2.E Runtime Hardening

**WASM instantiation failure**: If `WebAssembly.instantiate()` throws (e.g., due to a `LinkError` for missing imports, or a `CompileError` for invalid WASM), the robot is marked as "failed to load" and excluded from the battle. The simulation proceeds with remaining robots. An error message is displayed in the UI.

**Robot tick() throws or traps**: Every call to a robot's exported function (`tick()`, event handlers, `init()`) is wrapped in try-catch:

```typescript
function executeRobotTick(robot: RobotRunner): void {
  // Reset fuel
  robot.setFuel(GAS_PER_TICK);

  // Deliver queued events
  for (const event of robot.pendingEvents) {
    try {
      robot.callEventHandler(event);
    } catch (e) {
      robot.recordError(e, 'event_handler');
      // Event handler failed -- continue to tick()
    }
  }

  // Call tick()
  try {
    robot.callTick();
  } catch (e) {
    robot.recordError(e, 'tick');
    // Robot does nothing this tick
  }
}
```

**Error recording**: Errors are logged to the robot's debug buffer with:
- The error type (fuel exhaustion, array out of bounds, stack overflow, division by zero, other trap).
- The WASM byte offset where the trap occurred (extracted from the error object if available).
- The source location (if a source map is available -- see Section 4).

**Graceful recovery**: After a trap, the robot's WASM instance remains intact. WASM instances are not corrupted by traps -- the instance's linear memory and global state are preserved up to the point of the trap. On the next tick, the robot can execute normally. If a robot traps on 3 consecutive ticks, it is marked as "malfunctioning" and visually distinguished in the renderer (e.g., grayed out or flashing). It continues to participate but its repeated failures are visible to the user.

**WASM validation**: We call `WebAssembly.validate(wasmBytes)` on every compiled module before instantiation, even though our compiler should always produce valid WASM. This is defense-in-depth. The cost is negligible (sub-millisecond for small modules) and it catches compiler bugs before they manifest as runtime errors.

```typescript
const wasmBytes = compiler.compile(source);

if (!WebAssembly.validate(wasmBytes)) {
  throw new CompilerInternalError(
    'Compiler produced invalid WASM. This is a bug in the compiler.'
  );
}

const module = await WebAssembly.compile(wasmBytes);
```

---

## 3. Logging and Debug Capabilities

### 3.A The `debug()` Function

The RBL language provides two overloaded forms:

```go
debug(value int)    // logs an integer
debug(value float)  // logs a float
```

These compile to calls to the `debug_int` and `debug_float` WASM imports, respectively.

**Isolation**: Each robot has its own `DebugBuffer` object on the host side. The `debug_int` and `debug_float` imports for each robot write to that robot's buffer. There is no shared debug output. Robot A's debug output is never visible in Robot B's debug panel.

**Cannot be used for exfiltration**: The debug function is write-only from the robot's perspective. The robot writes a value; it does not receive a response. The value goes into a host-side buffer that is rendered in the UI's debug panel for that robot. There is no mechanism for the debug output to influence the simulation state, affect other robots, or leave the browser tab. In tournament mode, debug output is suppressed entirely (the import function is a no-op).

**Implementation**:

```typescript
class DebugBuffer {
  private entries: DebugEntry[] = [];
  private currentTick: number = 0;
  private readonly maxEntries = 1000;  // ring buffer
  private writeIndex = 0;

  setTick(tick: number): void {
    this.currentTick = tick;
  }

  logInt(value: number): void {
    this.addEntry({ tick: this.currentTick, type: 'int', value: value | 0 });
  }

  logFloat(value: number): void {
    this.addEntry({ tick: this.currentTick, type: 'float', value: Math.fround(value) });
  }

  private addEntry(entry: DebugEntry): void {
    if (this.entries.length < this.maxEntries) {
      this.entries.push(entry);
    } else {
      this.entries[this.writeIndex] = entry;
    }
    this.writeIndex = (this.writeIndex + 1) % this.maxEntries;
  }

  getEntries(): ReadonlyArray<DebugEntry> {
    return this.entries;
  }

  clear(): void {
    this.entries.length = 0;
    this.writeIndex = 0;
  }
}

interface DebugEntry {
  tick: number;
  type: 'int' | 'float';
  value: number;
}
```

### 3.B Structured Logging

**Options evaluated**:

1. **`debug(value)` only** -- Minimal. Just prints a number. Simple to implement. The user must infer meaning from context ("which debug call produced this 42?").

2. **`debugLabel(labelId int, value float)`** -- Associates a numeric label ID with a value. Label IDs are mapped to string names by a lookup table embedded in the WASM module's data section (or provided by the compiler as metadata). Allows output like `"speed: 50.0"`, `"target_dist: 200.5"`.

3. **`debugArray(arrayPtr, length)`** -- Dumps a slice of WASM linear memory as an array of values. More powerful but requires the host to know the element type and stride.

**Recommendation: Start with `debug(value)` only. Add `debugLabel` in a follow-up.**

Rationale:
- `debug(value)` is sufficient for MVP debugging. Programmers can call it with different values at different points in their code and correlate the output with their source. It imposes zero additional compiler complexity.
- `debugLabel` is a clear improvement that is worth adding after MVP, but it requires the compiler to emit a label-to-string mapping (either as WASM data or as sidecar metadata), which adds complexity to the compiler pipeline.
- `debugArray` is too complex for the benefit it provides. Users who need to inspect arrays can call `debug()` in a loop.

When `debugLabel` is implemented, it will work as follows:

```go
// In RBL source:
debug("speed", getSpeed())       // compiler assigns labelId 0 to "speed"
debug("target_dist", dist)       // compiler assigns labelId 1 to "target_dist"
```

The compiler emits a call to `debug_labeled(labelId i32, value f32)` and stores the label-to-string mapping in a custom WASM section or as part of the compilation result metadata. The debug panel uses this mapping to display labeled output.

### 3.C Debug Panel UI

The debug panel is a per-robot UI component in the React shell. It displays:

**Log history**:
- A scrollable list of debug output entries.
- Entries are grouped by tick number. Each tick's entries are shown under a tick header (e.g., "Tick 142:").
- The most recent tick's entries are shown at the bottom (newest at bottom, like a terminal).
- Maximum 1,000 entries in the ring buffer. Older entries are overwritten.

**Robot state overlay** (live values):
- Current global variable values. The host CAN read the robot's WASM memory because the memory is exported. The compiler emits metadata mapping global variable names to their byte offsets and types in linear memory. The debug panel uses this metadata to read and display global values in real time.
- This memory reading is performed by the host JavaScript (the simulation worker or main thread), not by any WASM import. The robot cannot detect that its memory is being read. This is a host-side operation only.

**Performance info**:
- Fuel used this tick (10,000 minus remaining fuel).
- Whether the robot was skipped this tick due to an error.
- Error count (total traps since battle start).
- The most recent error message and source location (if source map available).

**Privacy concern in competitive play**: Showing global variable values in the debug panel is extremely useful during development but could be a concern in competitive play (a spectator could see a robot's internal strategy). Mitigation: in tournament/competitive mode, the debug panel shows only the user's own robots. Spectators see only the battle visualization, not debug panels. This is a UI-level restriction, not a security boundary -- the host always CAN read memory, but the UI chooses not to display it for non-owned robots.

### 3.D Compile-Time Debug Stripping

**In tournament/batch mode, should `debug()` calls be stripped?**

**Two options**:

1. **Compile-time stripping**: The compiler recognizes `debug()` calls and emits no WASM instructions for them. The import is not even declared in the module. This saves fuel (no gas spent on debug calls) and eliminates any overhead.

2. **Runtime no-op**: The `debug_int` and `debug_float` imports remain in the module, but the host provides no-op implementations (`() => {}`). The fuel cost of calling them is still incurred.

**Recommendation: Use runtime no-op for simplicity. Reserve compile-time stripping as an optimization.**

Rationale:
- Runtime no-op is simpler to implement. The compiler always emits the same code regardless of mode. Only the host-side implementation changes.
- The fuel cost of debug calls is minimal. Each `debug()` call costs 1 gas for the function call plus the gas to evaluate the argument. In a 10,000-gas budget, a robot with 20 debug calls loses ~20-40 gas -- negligible.
- Compile-time stripping requires the compiler to accept a "mode" parameter and emit different code for different modes, complicating the compilation pipeline and caching (a tournament-compiled module is different from a debug-compiled module).
- If profiling later shows that debug calls in hot loops cause meaningful fuel waste, compile-time stripping can be added as an optimization flag.

---

## 4. Source Maps

### 4.1 What Source Maps Enable

When a runtime error occurs (array out-of-bounds, fuel exhaustion, division by zero), the browser reports a WASM byte offset. Without a source map, the error message is:

```
RuntimeError: unreachable executed at wasm-function[3]:0x1a2
```

With a source map, the error message becomes:

```
Runtime error at guardian.rbl:24 -- array index out of bounds
    in function engage(), line 24, column 5
```

This is the difference between a usable debugging experience and a cryptic one.

### 4.2 Implementation Approaches

#### Approach A: Simple Offset Map (Recommended for MVP)

The compiler records a mapping from WASM byte offsets to source locations at key points during code generation:

```typescript
interface SourceMap {
  entries: SourceMapEntry[];
}

interface SourceMapEntry {
  wasmOffset: number;          // byte offset in the WASM binary
  sourceFile: string;          // always the single .rbl file
  line: number;                // 1-indexed source line
  column: number;              // 1-indexed source column
  functionName: string | null; // enclosing function name, if known
}
```

**When to record entries**: The compiler records a source map entry at:
- Every function entry point.
- Every loop header.
- Every API call site.
- Every array access (potential OOB trap site).
- Every division (potential div-by-zero site).
- Every `unreachable` instruction (fuel exhaustion trap site).

This is a small number of entries per function -- typically 5-20 -- resulting in a source map of a few hundred entries for a typical robot.

**Storage**: The source map is stored as a JSON object alongside the compiled WASM binary. It is part of the compilation result but is not embedded in the WASM module.

```typescript
interface CompilationResult {
  wasmBytes: Uint8Array;
  sourceMap: SourceMap;
  globalMetadata: GlobalVarMetadata[];  // for debug panel
  errors: CompileError[];               // empty on success
}
```

#### Approach B: DWARF Debug Info

The WASM specification supports DWARF debug information in custom sections. Chrome DevTools can consume DWARF data to provide source-level debugging with breakpoints, variable inspection, and stepping.

**Why not for MVP**: Emitting DWARF is significantly more complex than a simple offset map. It requires generating DWARF section headers, line number tables, and potentially variable location descriptions. This is a large implementation effort for a feature that provides marginal benefit over the simple offset map for our use case (we just need error location reporting, not full breakpoint debugging).

**Aspirational**: DWARF support would enable users to set breakpoints in their RBL source and step through execution using Chrome DevTools. This is a compelling future feature but is not necessary for launch.

#### Approach C: Inline Source in Custom WASM Section

Store the original RBL source code in a custom section of the WASM binary. The host can extract it for display in the debug panel.

```typescript
// During code generation:
mod.addCustomSection("source", new TextEncoder().encode(rblSource));
```

**Value**: Allows the debug panel to display the source code alongside debug output, even if the original source file is not available (e.g., if the robot was loaded from a shared URL that only contains the compiled WASM).

**Recommendation**: Include this in MVP. It is trivial to implement (one line of code) and provides clear value.

### 4.3 Recommended Implementation Plan

**MVP (Phase 1)**:
- Simple offset map generated during compilation.
- Original source stored in a custom WASM section.
- When a trap occurs, look up the byte offset in the offset map and display the source location.
- No breakpoint debugging.

**Future (Phase 2)**:
- DWARF debug info for Chrome DevTools integration.
- Variable inspection via DWARF location descriptions.
- Stepping through RBL source code.

### 4.4 Using Source Maps at Runtime

```typescript
function handleRobotTrap(
  error: WebAssembly.RuntimeError,
  robotName: string,
  sourceMap: SourceMap,
  fuelRemaining: number
): RobotError {
  // Determine error type
  let errorType: string;
  if (fuelRemaining <= 0) {
    errorType = 'fuel_exhausted';
  } else if (error.message.includes('out of bounds')) {
    errorType = 'array_out_of_bounds';
  } else if (error.message.includes('unreachable')) {
    errorType = 'runtime_trap';
  } else if (error.message.includes('call stack')) {
    errorType = 'stack_overflow';
  } else {
    errorType = 'unknown';
  }

  // Extract WASM byte offset from error stack
  // The format is engine-specific but typically includes "wasm-function[N]:0xOFFSET"
  const wasmOffset = extractWasmOffset(error.stack);

  // Look up source location
  let sourceLocation: SourceMapEntry | null = null;
  if (wasmOffset !== null) {
    sourceLocation = findNearestEntry(sourceMap, wasmOffset);
  }

  // Compose human-readable error
  const locationStr = sourceLocation
    ? `${robotName}.rbl:${sourceLocation.line}`
      + (sourceLocation.functionName ? ` in ${sourceLocation.functionName}()` : '')
    : 'unknown location';

  return {
    robot: robotName,
    type: errorType,
    message: `${formatErrorType(errorType)} at ${locationStr}`,
    tick: currentTick,
    wasmOffset,
    sourceLocation,
  };
}

function extractWasmOffset(stack: string | undefined): number | null {
  if (!stack) return null;
  // V8 format: "at wasm-function[3]:0x1a2"
  // SpiderMonkey: "wasm-function[3]:0x1a2"
  const match = stack.match(/wasm-function\[\d+\]:0x([0-9a-f]+)/);
  if (match) return parseInt(match[1], 16);
  return null;
}

function findNearestEntry(
  sourceMap: SourceMap,
  wasmOffset: number
): SourceMapEntry | null {
  // Find the entry with the largest wasmOffset that is <= the target offset
  let best: SourceMapEntry | null = null;
  for (const entry of sourceMap.entries) {
    if (entry.wasmOffset <= wasmOffset) {
      if (best === null || entry.wasmOffset > best.wasmOffset) {
        best = entry;
      }
    }
  }
  return best;
}
```

---

## 5. Trade-offs and Design Decisions

### 5.1 Robot IDs in Events

**Decision**: Randomize robot IDs per round.

`on bulletHit(targetId)` and `on robotDeath(robotId)` expose integer IDs. These IDs are assigned randomly at the start of each round using the round's seed. Within a round, IDs are stable. Across rounds, they are reshuffled.

**Rationale**: Stable cross-round IDs would allow a robot to build a profile of specific opponents ("ID 0 always charges, ID 2 always runs"). While this is an interesting strategic dimension, it gives an unfair advantage to robots with more sophisticated profiling code and could lead to an arms race of opponent-modeling that overshadows core gameplay. Randomized IDs keep the focus on moment-to-moment tactics within each round.

**Implementation**: The simulation engine maintains a mapping of internal robot index to randomized ID, shuffled at round start using the seeded PRNG.

### 5.2 Debug Output Limits

**Decision**: Rely on fuel metering. Do not add a separate debug call limit.

Each `debug()` call costs 1 gas (for the function call overhead). A robot that calls `debug()` in a tight loop will exhaust its fuel budget calling debug, leaving no fuel for actual logic. This is self-penalizing.

Adding a separate limit (e.g., "max 100 debug calls per tick") would be redundant with fuel metering and would add another parameter to tune and explain. The fuel system already provides the correct incentive: every debug call costs gas that could be spent on computation.

### 5.3 Memory Inspection for Debug Panel

**Decision**: Allow the host to read a robot's WASM memory for the debug panel. Restrict visibility in competitive mode.

The host can always read a robot's exported memory -- this is a JavaScript capability, not a WASM import. The robot cannot detect or prevent this. For the debug panel, the host reads global variable values from the robot's linear memory using the offset metadata emitted by the compiler.

In development/casual mode: the debug panel shows global variable values for any selected robot. This is invaluable for debugging.

In tournament/competitive mode: the debug panel is available only for the user's own robots. Spectators see battle visualization and results only, not internal robot state. This is a UI-level restriction.

This is NOT a security concern in the traditional sense (the host is trusted -- it IS the game engine). It is a fairness concern for competitive play, addressed by UI restrictions.

### 5.4 WASM Validation

**Decision**: Always validate. Call `WebAssembly.validate()` on every compiled module.

The cost is negligible (under 1ms for our small modules). The benefit is catching compiler bugs before they cause cryptic runtime errors. This is defense-in-depth against our own compiler, not against robots.

### 5.5 Division by Zero Handling

**Decision**: The compiler emits a check before every integer division. If the divisor is zero, the result is 0 and a warning is logged to the debug panel.

For floating-point division, WASM follows IEEE 754: `x / 0.0` produces `+Infinity` or `-Infinity` (or `NaN` for `0.0 / 0.0`). These values propagate through subsequent arithmetic. The compiler does not check for float division by zero -- IEEE 754 behavior is well-defined and non-trapping.

```
;; Compiler-emitted integer division with zero check:
local.get $divisor
i32.eqz
if (result i32)
  i32.const 0              ;; return 0 on div-by-zero
else
  local.get $dividend
  local.get $divisor
  i32.div_s
end
```

### 5.6 NaN Propagation

**Decision**: The compiler emits NaN checks after trig functions that can produce NaN (e.g., `sqrt` of a negative number). If a NaN is detected, it is replaced with `0.0` and a warning is logged. This prevents NaN from silently corrupting robot state.

This is implemented in the host-side math functions, not in WASM:

```typescript
function deterministicSqrt(x: number): number {
  if (x < 0) return 0.0;  // NaN prevention
  return Math.fround(Math.sqrt(x));
}
```

---

## 6. Security Summary

### 6.1 Defense-in-Depth Layers

```
Layer 1: WASM Specification Guarantees
  - Memory isolation (each instance has own linear memory)
  - No ambient authority (no DOM, network, filesystem)
  - Control flow integrity (no arbitrary jumps)
  - Type safety (function call signatures enforced)
  - Code immutability (no runtime code generation)

Layer 2: Import Surface Control
  - Explicit allowlist of ~40 import functions
  - Every import analyzed for safety
  - No timing functions provided
  - All inputs clamped/validated by host
  - Deny-all policy for unlisted imports

Layer 3: Resource Limits
  - Fuel metering (10,000 gas per tick, compiler-injected)
  - Memory cap (16 pages / 1 MiB maximum)
  - Stack overflow trapping (engine-level)
  - Web Worker timeout (safety net, ~100ms)

Layer 4: Compiler Hardening
  - Input size limits (64 KiB source)
  - Nesting depth limits (32 levels)
  - Output size limits (256 KiB WASM)
  - WASM validation on every compilation
  - All compiler phases wrapped in try-catch

Layer 5: Runtime Error Handling
  - Every robot tick() call wrapped in try-catch
  - Trapping robot skips tick, does not crash simulation
  - Error recorded and displayed in debug panel
  - WASM instance preserved across traps (recoverable)
  - Malfunctioning robot detection (3+ consecutive traps)
```

### 6.2 What a Malicious Robot Cannot Do

| Action | Why It Is Impossible |
|--------|---------------------|
| Read another robot's memory | Separate WASM instances with separate Memory objects |
| Write to another robot's memory | Same as above |
| Access the DOM | No DOM-related imports provided |
| Make network requests | No fetch/XMLHttpRequest imports provided |
| Read the filesystem | No filesystem imports provided |
| Measure wall-clock time | No timing imports provided |
| Execute arbitrary JavaScript | WASM cannot call JS functions not in its import set |
| Generate new code at runtime | WASM does not support dynamic code generation |
| Modify its own code | WASM code section is immutable |
| Freeze the simulation | Fuel metering traps infinite loops |
| Consume unbounded memory | Memory capped at 1 MiB |
| Crash the simulation for other robots | Traps are caught per-robot; other robots continue |
| Identify specific opponents across rounds | Robot IDs randomized per round |
| Infer other robots' code from timing | No timing capability available |
| Exploit the compiler for code execution | Compiler hardened with input limits and validation |

### 6.3 Pre-Ship Security Checklist

- [ ] Each robot WASM instance has its own `WebAssembly.Memory` with `maximum: 16`.
- [ ] No `SharedArrayBuffer` is used between robot instances.
- [ ] The import object contains exactly the documented imports and nothing else.
- [ ] No timing-related imports (`Date.now`, `performance.now`, etc.) are provided.
- [ ] Fuel metering is injected at every loop back-edge and every user function call.
- [ ] Fuel counter is reset before each tick.
- [ ] Gas exhaustion is caught and handled (robot skips tick, not simulation crash).
- [ ] Stack overflow traps are caught and handled.
- [ ] Array out-of-bounds traps are caught and handled.
- [ ] Integer division by zero is checked at compile time (returns 0).
- [ ] `WebAssembly.validate()` is called on every compiled module.
- [ ] Compiler rejects source files larger than 64 KiB.
- [ ] Compiler rejects nesting deeper than 32 levels.
- [ ] Compiler rejects modules larger than 256 KiB.
- [ ] All compiler phases are wrapped in try-catch.
- [ ] Robot IDs are randomized per round.
- [ ] Debug output is per-robot and not shared.
- [ ] Debug output is suppressed in tournament mode.
- [ ] Memory inspection in the debug panel is restricted to owned robots in competitive mode.
- [ ] Web Worker timeout exists as a catastrophic fallback (100ms per tick).
- [ ] No robot error can cause an unhandled exception in the simulation engine.
- [ ] Math builtins use deterministic implementations (not `Math.sin`, `Math.cos`).
- [ ] Import functions clamp all numeric inputs to valid ranges.
- [ ] Shared URL encoding cannot contain executable code (XSS prevention).
- [ ] Fuzz testing has been run against the compiler with adversarial input.
