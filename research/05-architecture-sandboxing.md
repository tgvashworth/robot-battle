# Robot Battle: Architecture, Sandboxing, and Security

## Table of Contents

1. [WASM Sandboxing Model](#1-wasm-sandboxing-model)
2. [Preventing Infinite Loops and Resource Abuse](#2-preventing-infinite-loops-and-resource-abuse)
3. [Web Worker Architecture Options](#3-web-worker-architecture-options)
4. [Fairness in Execution](#4-fairness-in-execution)
5. [Overall Application Architecture](#5-overall-application-architecture)
6. [Data Flow Architecture](#6-data-flow-architecture)
7. [Storage and Persistence](#7-storage-and-persistence)
8. [Build and Development Tooling](#8-build-and-development-tooling)

---

## 1. WASM Sandboxing Model

### 1.1 What WASM's Security Model Guarantees

WebAssembly was designed from the ground up with a sandboxed execution model. Each
WASM module runs inside an isolated environment with the following guarantees:

- **Linear memory isolation**: Each module receives its own contiguous block of raw bytes
  (linear memory). It cannot address anything outside this block. All memory accesses are
  bounds-checked, and out-of-bounds access traps (throws) rather than corrupting host
  memory. Memory is zero-initialized by default.
- **No ambient authority**: A WASM module starts with zero capabilities. It cannot access the
  DOM, network, filesystem, or any browser API unless the host explicitly provides import
  functions.
- **Import/export restrictions**: A module can only call functions that the host explicitly
  provides via its import object. It can only expose functions it declares as exports. There
  is no mechanism for a module to discover or invoke undeclared host functionality.
- **Control-flow integrity**: WASM enforces structured control flow. There is no arbitrary
  `goto` or ability to jump to computed addresses in the code section. The call stack is
  protected and separate from linear memory, preventing return-address overwriting.
- **Type safety**: All function calls are type-checked. A module cannot call an imported
  function with mismatched parameter types.

### 1.2 What a WASM Module Cannot Do (By Default)

| Capability              | Available? | Notes                                      |
|--------------------------|------------|--------------------------------------------|
| Read/write own memory    | Yes        | Within declared linear memory bounds only  |
| Call imported functions   | Yes        | Only those explicitly provided by host     |
| Access DOM               | No         | Must be bridged via imports                |
| Make network requests    | No         | No ambient network access                 |
| Read filesystem          | No         | No filesystem API                          |
| Access other WASM memory | No         | Each instance has isolated linear memory   |
| Spawn threads            | No         | Requires explicit shared memory setup      |
| Execute arbitrary code   | No         | Code is validated at compile/load time     |

### 1.3 Remaining Attack Vectors

Even with strong sandboxing, several concerns remain relevant to Robot Battle:

1. **Resource exhaustion**: A WASM module can enter an infinite loop, consume all
   available memory via `memory.grow`, or cause deep recursion leading to stack overflow.
   WASM sandboxing does not inherently limit computation time or resource usage.

2. **Timing side channels**: A module that is provided any form of timing function (even
   indirectly) could measure execution durations to infer information about the host or
   other modules.

3. **Import function abuse**: If the host provides overly-broad imports (e.g., a logging
   function that writes to the DOM), a malicious module could abuse them. The attack
   surface is exactly the set of provided imports.

4. **JIT compiler bugs**: Browser JIT compilers for WASM have had vulnerabilities where
   optimizations (particularly around bounds-check elision) allowed sandbox escapes. These
   are browser engine bugs, not WASM spec issues, but they are real-world concerns that
   browser vendors actively patch.

5. **Spectre-class attacks**: Shared memory and high-resolution timers can enable
   speculative execution attacks. This is mitigated by the cross-origin isolation
   requirements browsers impose on `SharedArrayBuffer`.

### 1.4 Implications for Robot Battle

For our use case, WASM sandboxing is very strong. Each robot WASM module:

- Gets its own isolated linear memory (no robot can read another's state)
- Can only call the functions we provide (the simulation API)
- Cannot access the network, DOM, or filesystem
- Cannot escape its sandbox under normal conditions

The primary threats we must handle ourselves are resource exhaustion (infinite loops,
memory hogging) and fairness (ensuring equal computational budgets). These are addressed
in the following sections.

---

## 2. Preventing Infinite Loops and Resource Abuse

### 2.1 The Core Problem

A robot written in our custom language compiles to WASM and executes a `tick()` function
each simulation step. A malicious or buggy robot could:

- Enter an infinite loop inside `tick()`
- Allocate unbounded memory via `memory.grow`
- Cause deep recursion leading to stack overflow
- Consume excessive CPU, starving other robots or freezing the UI

We need to cap computation per tick, limit memory, and handle stack overflow.

### 2.2 Approach 1: WASM Fuel/Metering (Compile-Time Instrumentation)

**How it works**: Before instantiation, the WASM binary is transformed to inject
instruction-counting code. The algorithm:

1. Parse the WASM binary into basic blocks (sequences of instructions with no branches)
2. At the entry of each basic block, inject instructions that:
   - Decrement a gas/fuel counter by the block's cost (number of instructions)
   - Check if the counter has reached zero
   - If so, trap (throw) or call a host-provided "out of gas" function
3. The transformed WASM binary is then instantiated normally

```
Original basic block:         Instrumented basic block:
                              global.get $fuel
  i32.load                    i32.const 5          ;; cost of this block
  i32.const 10                i32.sub
  i32.add                     global.set $fuel
  i32.store                   global.get $fuel
                              i32.const 0
                              i32.le_s
                              if
                                unreachable        ;; trap: out of fuel
                              end
                              i32.load             ;; original code begins
                              i32.const 10
                              i32.add
                              i32.store
```

**The `wasm-metering` npm package**: This package (originally by the Ethereum/eWasm team)
implements exactly this approach. It takes a WASM binary (as a `Uint8Array`), analyzes it
for basic blocks, and returns a new WASM binary with metering injected. The metered module
expects an import function that acts as the gas counter callback.

```typescript
import metering from 'wasm-metering';

// Instrument the WASM binary
const meteredWasm = metering.meterWASM(originalWasm, {
  meterType: 'i32',  // counter register type
});

// The metered module expects this import:
const imports = {
  metering: {
    usegas: (gas: number) => {
      gasUsed += gas;
      if (gasUsed > GAS_LIMIT) {
        throw new Error('Out of gas');
      }
    }
  },
  // ... other robot API imports
};
```

**Status and alternatives**:

- The original `wasm-metering` (ewasm) is marked as orphaned, but forks like
  `@permaweb/wasm-metering` are actively maintained.
- The `wasm-instrument` Rust crate (by Parity) provides similar functionality and is more
  actively maintained, but requires a Rust toolchain.
- Since we control the compiler, we can inject metering at compile time directly in our
  TypeScript compiler, avoiding any third-party dependency entirely.

**Does the browser runtime support fuel natively?** No. Browser WASM engines (V8,
SpiderMonkey, JavaScriptCore) do not expose a fuel/gas metering API. This feature exists
in standalone runtimes like Wasmtime and Wasmer, but not in browsers. For browser
execution, instrumentation-based metering or external timeout mechanisms are required.

### 2.3 Approach 2: Web Worker + Timeout (Terminate on Overshoot)

An alternative to instruction-level metering: run each robot's `tick()` in a Web Worker
and terminate the worker if it exceeds a wall-clock time limit.

```typescript
// Main thread or simulation worker
function executeRobotTick(robotWorker: Worker, timeout: number): Promise<RobotState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      robotWorker.terminate();
      reject(new Error('Robot tick timed out'));
    }, timeout);

    robotWorker.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };

    robotWorker.postMessage({ command: 'tick' });
  });
}
```

**Pros**:
- Simple to implement
- No WASM binary modification needed
- `Worker.terminate()` is immediate and forceful

**Cons**:
- Wall-clock time is nondeterministic (varies with CPU load, browser throttling, system
  state). This makes it unsuitable as the sole fairness mechanism.
- Worker startup and communication overhead is significant for per-tick execution.
- Terminating and recreating workers repeatedly is expensive.
- One worker per robot for 8 robots means 8 workers just for execution.

### 2.4 Recommended Approach: Compile-Time Metering + Worker Timeout as Safety Net

The best strategy combines both approaches:

1. **Primary**: Inject fuel metering during compilation. Each robot gets a fixed gas
   budget per tick (e.g., 100,000 gas units). Our compiler emits the metering code
   directly, so no third-party binary rewriting is needed.

2. **Safety net**: Run the simulation in a Web Worker. If a metering bug or edge case
   causes a robot to exceed wall-clock time (e.g., 100ms for a tick that should take <1ms),
   the main thread can terminate the worker as a last resort.

```
                     Compile-time metering
                     (primary defense)
                            |
  Robot source ---> Compiler ---> Metered WASM
                                      |
                              Simulation Worker
                                      |
                            tick() with gas limit
                                      |
                              Gas exhausted? ---> Trap (robot disqualified)
                                      |
                              Wall-clock timeout? ---> Worker.terminate()
                                                       (catastrophic fallback)
```

### 2.5 Memory Limits

WASM linear memory is measured in pages of 64 KiB each. When creating a
`WebAssembly.Memory` object, we can specify both initial and maximum page counts:

```typescript
const memory = new WebAssembly.Memory({
  initial: 1,    // 64 KiB starting memory
  maximum: 16,   // 1 MiB cap (16 * 64 KiB)
});
```

For Robot Battle, robots should not need much memory. Recommended limits:

| Parameter       | Value     | Rationale                                  |
|-----------------|-----------|--------------------------------------------|
| Initial memory  | 1 page    | 64 KiB; sufficient for most robot state    |
| Maximum memory  | 16 pages  | 1 MiB cap; generous but bounded            |
| Gas per tick    | 100,000   | Tunable; sufficient for complex strategies |

If a robot calls `memory.grow` and exceeds the maximum, the call returns `-1` (failure).
The robot must handle this or it will crash, which is acceptable behavior for a
resource-abusing robot.

### 2.6 Stack Overflow Protection

WASM's call stack is managed by the browser engine and is separate from linear memory.
Browsers impose hard limits on call stack depth:

- V8 (Chrome): Throws `RangeError: Maximum call stack size exceeded`
- SpiderMonkey (Firefox): Throws `InternalError: too much recursion`
- JavaScriptCore (Safari): Throws `RangeError: Maximum call stack size exceeded`

These traps are caught by the host environment. For Robot Battle:

- A robot that stack overflows simply traps, and we catch the error
- The robot is either disqualified or penalized for that tick
- The simulation continues with remaining robots
- No special handling is needed beyond try/catch around the tick invocation

Additionally, since we control the compiler, we can inject recursion depth counters
at compile time for additional protection.

---

## 3. Web Worker Architecture Options

### 3.1 Overview of Options

Running simulations off the main thread is essential for UI responsiveness, especially
during batch simulation of 10,000+ rounds. There are three main architecture options:

```
Option A: Single Worker, All Robots
====================================
Main Thread          Simulation Worker
+-----------+        +---------------------------+
|  React UI | <----> | Sim Engine                |
|  Renderer |        |  +-----+ +-----+ +-----+ |
+-----------+        |  |Bot 1| |Bot 2| |Bot 3| |
                     |  +-----+ +-----+ +-----+ |
                     +---------------------------+

Option B: One Worker Per Robot
==============================
Main Thread          Workers
+-----------+        +----------+
|  React UI | <----> | Sim Ctrl |
|  Renderer |        +----------+
+-----------+             |
                    +-----+-----+------+
                    |     |     |      |
                   W1    W2    W3    W4
                  Bot1  Bot2  Bot3  Bot4

Option C: Simulation Worker + WASM Instances (Recommended)
==========================================================
Main Thread               Simulation Worker
+-----------+             +---------------------------+
|  React UI | <---------> | Simulation Engine         |
|  WebGL    |  periodic   |                           |
|  Renderer |  state      |  WASM 1  WASM 2  WASM 3  |
+-----------+  updates    |  (iso)   (iso)   (iso)    |
                          +---------------------------+
```

### 3.2 Option A: All Robots in One Worker

All robot WASM instances and the simulation engine run in a single Web Worker.

| Aspect            | Assessment                                                   |
|-------------------|--------------------------------------------------------------|
| Isolation         | Low. Robots share a JS context (though WASM memory is isolated) |
| Performance       | Best. Zero communication overhead between robots and engine  |
| Complexity        | Low. Single worker, straightforward message passing          |
| Batch simulation  | Excellent. No inter-worker sync needed for 10K+ rounds      |
| Memory overhead   | Minimal. One worker, one JS context                          |
| Fault tolerance   | Poor. One crashing robot can take down the worker            |

### 3.3 Option B: Each Robot in Its Own Worker

Maximum isolation: each robot runs in a completely separate Worker.

| Aspect            | Assessment                                                   |
|-------------------|--------------------------------------------------------------|
| Isolation         | Maximum. Separate JS contexts, separate event loops          |
| Performance       | Poor. High communication overhead (postMessage per tick)     |
| Complexity        | High. Orchestrating 8+ workers, synchronizing state          |
| Batch simulation  | Poor. Message passing overhead * 8 robots * 10K rounds       |
| Memory overhead   | High. Each worker has its own JS heap (~2-10 MB each)        |
| Fault tolerance   | Excellent. One robot crashing only kills its worker          |

**Why this is impractical for Robot Battle**: With 8 robots, 10,000 rounds, and many ticks
per round, we would need millions of postMessage round-trips. Even with transferable
objects, the overhead is prohibitive. Structured cloning for complex state objects costs
roughly 1-10ms per message; transferable objects are near-zero-cost but require ownership
transfer semantics that complicate shared state.

### 3.4 Option C: Simulation Worker with WASM Instances (Recommended)

The simulation engine and all robot WASM instances run in one dedicated Web Worker. Each
robot is a separate `WebAssembly.Instance` with its own isolated linear memory, but they
share the worker's JS context.

| Aspect            | Assessment                                                   |
|-------------------|--------------------------------------------------------------|
| Isolation         | Good. WASM memory isolation between robots; shared JS context |
| Performance       | Excellent. Direct function calls between engine and robots   |
| Complexity        | Moderate. One worker with careful error handling             |
| Batch simulation  | Excellent. All computation local, no message passing         |
| Memory overhead   | Low. One worker context                                      |
| Fault tolerance   | Good with try/catch. A trapping robot is caught and skipped  |

This is the recommended architecture because:

1. WASM already provides memory isolation between robot instances
2. Zero communication overhead for robot-to-engine interaction
3. Batch simulation of 10K+ rounds is fast (no IPC)
4. A single postMessage per frame to the main thread for rendering
5. Fuel metering handles per-robot resource limits

### 3.5 SharedArrayBuffer and Atomics

`SharedArrayBuffer` allows multiple threads (workers) to share a memory region without
copying. `Atomics` provides synchronization primitives.

**Requirements for SharedArrayBuffer**:
- The page must be cross-origin isolated, requiring these HTTP headers:
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```
  (Or `credentialless` for COEP to allow some cross-origin resources.)
- All cross-origin resources must opt in with `Cross-Origin-Resource-Policy` headers.

**Is it useful for Robot Battle?**

Potentially, but not essential. The primary use case would be:

- **Rendering buffer**: The simulation worker writes robot positions/states into a
  SharedArrayBuffer. The main thread reads it for WebGL rendering without copying.
- **Progress reporting**: A shared atomic counter for batch simulation progress.

However, the added complexity of cross-origin isolation headers (which affect how the
page interacts with third-party resources) may not be worth it initially. A simpler
approach is to `postMessage` with transferable `ArrayBuffer` objects for state transfer.

**Recommendation**: Start without SharedArrayBuffer. Use `postMessage` with transferable
objects. Add SharedArrayBuffer later if profiling shows the state transfer is a
bottleneck.

### 3.6 Practical Web Worker Limits

There is no hard specification limit on the number of Web Workers, but practical
limits exist:

- Each worker creates a separate OS thread and JS heap (typically 2-10 MB baseline)
- Chrome has been observed to support hundreds of workers, but performance degrades
- Firefox has no documented hard limit but similar practical constraints
- The general recommendation is to match worker count to `navigator.hardwareConcurrency`
  (number of logical CPU cores)

For Robot Battle, we need at most 2-3 workers:

1. **Simulation worker**: Runs battles (the heavyweight)
2. **Compiler worker** (optional): Compiles robot source to WASM off the main thread
3. **Main thread**: React UI + WebGL rendering

---

## 4. Fairness in Execution

### 4.1 Equal Computational Budget

With compile-time fuel metering, each robot gets exactly the same gas budget per tick.
This is deterministic regardless of wall-clock time:

```typescript
const GAS_PER_TICK = 100_000;

function executeTick(robotInstance: WebAssembly.Instance, state: ArenaState): RobotAction {
  let gasRemaining = GAS_PER_TICK;

  const imports = {
    metering: {
      usegas: (cost: number) => {
        gasRemaining -= cost;
        if (gasRemaining <= 0) {
          throw new GasExhaustedError();
        }
      }
    },
    // ... simulation API imports
  };

  try {
    return robotInstance.exports.tick(state);
  } catch (e) {
    if (e instanceof GasExhaustedError) {
      return { action: 'noop' }; // Robot ran out of gas, does nothing this tick
    }
    throw e; // Other errors = robot malfunction
  }
}
```

**Key property**: Gas metering counts WASM instructions, not wall-clock time. Two robots
with the same gas budget execute the same number of instructions, regardless of whether
one runs on a fast machine and one on a slow machine.

### 4.2 Timing Side Channels

**Threat**: Can one robot measure how long another robot's tick takes and gain strategic
information?

**Mitigation**: By design, robots have no access to timing information:
- We do not provide any time-related imports (no `Date.now()`, no `performance.now()`)
- Robots execute sequentially within a tick (Robot 1 finishes before Robot 2 starts)
- No robot can observe the wall-clock duration of another robot's execution
- The simulation state provided to each robot contains only game-relevant information

### 4.3 Memory Access Pattern Isolation

**Threat**: Can one robot infer information about another through cache timing or memory
access patterns?

**Mitigation**: WASM linear memory isolation ensures:
- Each robot has its own memory region
- No robot can read another's memory addresses
- While theoretical CPU-cache-based side channels exist (Spectre-class), they require
  high-resolution timers we do not provide, and are impractical in this context

### 4.4 Deterministic Execution

For tournament integrity, identical inputs should produce identical outputs. WASM is
almost fully deterministic, with one notable exception:

**NaN bit patterns**: When floating-point operations produce NaN results, the specific
NaN bit pattern (sign, payload) is nondeterministic in the base WASM spec. Different
browsers may produce different NaN bits for the same operation.

**Mitigations**:

1. **Avoid floating point in game logic**: Use fixed-point integer arithmetic for all
   simulation logic (positions, distances, angles). This eliminates NaN nondeterminism
   entirely.
   ```
   // Instead of: position = 3.14159
   // Use:        position = 31416  (fixed-point, 4 decimal places, stored as i32)
   ```

2. **WASM deterministic profile**: The WASM 3.0 spec (finalized 2025) includes a
   deterministic profile that canonicalizes NaN values. However, browser adoption of this
   profile is not yet guaranteed across all engines.

3. **NaN canonicalization at compile time**: Our compiler can emit code that checks for
   and canonicalizes NaN values after every floating-point operation. This adds overhead
   but guarantees determinism.

**Recommendation**: Use integer/fixed-point arithmetic for all game state. Reserve
floating-point for rendering only (which runs on the main thread and does not affect
simulation outcomes). This sidesteps the determinism problem entirely.

### 4.5 Tournament Integrity

For competitive play, additional measures ensure fair results:

- **Seed-based RNG**: The simulation provides a seeded PRNG. Robots that need randomness
  call `random()` through the simulation API, ensuring reproducibility.
- **Round-robin execution order**: Randomize which robot executes first each tick, using
  a deterministic shuffle based on the round seed.
- **Replay verification**: Since the simulation is deterministic (with fixed-point math),
  any battle can be replayed from its seed to verify results.
- **Gas usage reporting**: Record each robot's gas consumption per tick for post-match
  analysis.

---

## 5. Overall Application Architecture

### 5.1 Module Structure

```
robot-battle/
  src/
    compiler/           # Source language -> WASM compiler
      lexer.ts          # Tokenization
      parser.ts         # AST generation
      analyzer.ts       # Semantic analysis, type checking
      codegen.ts        # WASM binary generation
      metering.ts       # Fuel injection during codegen
      errors.ts         # Compiler error types and messages

    simulation/         # Battle simulation engine
      engine.ts         # Core simulation loop
      arena.ts          # Arena geometry, boundaries, obstacles
      physics.ts        # Movement, collision detection (fixed-point)
      robot.ts          # Robot state management
      weapons.ts        # Weapon systems, damage calculation
      api.ts            # Import functions provided to robot WASM
      types.ts          # Shared type definitions

    renderer/           # WebGL visualization
      renderer.ts       # Main render loop
      arena-view.ts     # Arena rendering
      robot-sprites.ts  # Robot visualization
      effects.ts        # Explosions, projectiles, visual effects
      camera.ts         # Viewport and camera control
      hud.ts            # Heads-up display (health bars, scores)

    ui/                 # React application layer
      App.tsx           # Root component
      components/
        Editor.tsx      # Code editor for robot source
        BattleView.tsx  # Battle visualization container
        RobotList.tsx   # Robot file management
        Results.tsx     # Battle results and statistics
        Tournament.tsx  # Tournament bracket and configuration
      hooks/
        useSimulation.ts    # Simulation worker interface
        useCompiler.ts      # Compilation interface
        useRobotStorage.ts  # File storage interface
      store/
        index.ts        # State management

    workers/            # Web Worker entry points
      simulation.worker.ts  # Simulation worker
      compiler.worker.ts    # Compiler worker (optional)

    storage/            # Persistence layer
      robot-store.ts    # Robot file CRUD (IndexedDB)
      results-store.ts  # Battle history (IndexedDB)
      export.ts         # Import/export, URL sharing

    shared/             # Shared types and utilities
      types.ts          # Cross-module type definitions
      constants.ts      # Game constants, limits
      fixed-point.ts    # Fixed-point arithmetic utilities
```

### 5.2 Module Communication

```
+------------------------------------------------------------------+
|  Main Thread                                                      |
|                                                                   |
|  +---------+     +----------+     +-----------+     +-----------+ |
|  | React   |<--->| State    |<--->| Renderer  |     | Storage   | |
|  | UI      |     | Store    |     | (WebGL)   |     | (IDB)     | |
|  +---------+     +----------+     +-----------+     +-----------+ |
|                       ^                  ^                         |
|                       | state updates    | frame data              |
+------------------------------------------------------------------+
                        |                  |
                   postMessage        postMessage
                  (transferable)     (transferable)
                        |                  |
+------------------------------------------------------------------+
|  Simulation Worker                                                |
|                                                                   |
|  +--------------+     +--------+--------+--------+               |
|  |  Simulation  |<--->| WASM 1 | WASM 2 | WASM 3 |              |
|  |  Engine      |     | Robot  | Robot  | Robot  |               |
|  +--------------+     +--------+--------+--------+               |
|                                                                   |
+------------------------------------------------------------------+
```

**Communication protocol between main thread and simulation worker**:

```typescript
// Messages from Main Thread -> Simulation Worker
type SimCommand =
  | { type: 'load-robots'; robots: { id: string; wasm: ArrayBuffer }[] }
  | { type: 'start-battle'; config: BattleConfig }
  | { type: 'start-batch'; config: BatchConfig }  // 10K+ rounds
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' };

// Messages from Simulation Worker -> Main Thread
type SimEvent =
  | { type: 'battle-state'; state: ArrayBuffer }    // Transferable frame data
  | { type: 'battle-complete'; results: BattleResults }
  | { type: 'batch-progress'; completed: number; total: number }
  | { type: 'batch-complete'; results: BatchResults }
  | { type: 'error'; robotId: string; error: string }
  | { type: 'robot-disqualified'; robotId: string; reason: string };
```

### 5.3 State Management

State is divided by concern and ownership:

| State                    | Location            | Rationale                           |
|--------------------------|---------------------|-------------------------------------|
| Robot source files       | IndexedDB           | Persistent, potentially large       |
| Compiled WASM binaries   | In-memory (cache)   | Derived from source, regenerable    |
| Active battle state      | Simulation worker   | Owned by simulation engine          |
| Rendered frame data      | Main thread (WebGL) | Consumed by renderer each frame     |
| UI state (menus, editor) | React state/store   | Ephemeral, UI-specific              |
| Battle results history   | IndexedDB           | Persistent, queryable               |
| Editor content           | React state         | Synced to IndexedDB on save         |

For React state management, a lightweight solution is sufficient:

- **Zustand** or **Jotai**: Minimal boilerplate, good TypeScript support, sufficient for
  this application's needs. The app does not have deep component trees or complex state
  interactions that would warrant Redux.
- **React context**: Acceptable for simple shared state like "current robot" or "active
  battle." Avoid putting rapidly-changing state (like frame data) in context.

### 5.4 Robot Source File Format

The robot source files should use a clear, distinctive extension. Considerations:

| Extension | Pros                                  | Cons                           |
|-----------|---------------------------------------|--------------------------------|
| `.rbl`    | Short, unique to project              | Not immediately obvious        |
| `.bot`    | Intuitive, easy to remember           | May conflict with other tools  |
| `.robot`  | Very clear purpose                    | Long                           |
| `.rbat`   | Combines "robot" and "battle"         | Awkward                        |

**Recommendation**: `.rbl` (Robot Battle Language). It is concise, unlikely to conflict
with existing tools, and distinctive enough for file association.

```
// example.rbl - Robot Battle Language source file
robot "Spinner" {
  fn tick(state: ArenaState) -> Action {
    let target = state.nearest_enemy();
    if target.distance < 100 {
      return fire(target.bearing);
    }
    return turn(15) + move_forward(50);
  }
}
```

---

## 6. Data Flow Architecture

### 6.1 End-to-End Data Flow

```
                        Main Thread                    Simulation Worker
                        ===========                    =================

  User writes/loads     +--------+
  robot source      --->| Editor |
                        +--------+
                            |
                         save to
                         IndexedDB
                            |
                        +----------+
  Compile request  ---->| Compiler |  (could also be a separate worker)
                        +----------+
                            |
                        WASM binary
                        (ArrayBuffer)
                            |
                     postMessage ------>  +------------------+
                     (transferable)       | Instantiate WASM |
                                          +------------------+
                                                  |
                                          +------------------+
                          "start"  -----> | Simulation Loop  |
                                          |                  |
                                          | for each tick:   |
                                          |   for each robot:|
                                          |     call tick()  |
                                          |   resolve combat |
                                          |   update physics |
                                          +------------------+
                                                  |
                     <------ postMessage          |
                     (transferable)        frame state / results
                            |
                     +------------+
                     | Renderer   |  (WebGL, reads frame state)
                     +------------+
                            |
                     +------------+
                     | Results UI |  (React, displays outcomes)
                     +------------+
```

### 6.2 What Happens Where

| Step                      | Thread             | Rationale                          |
|---------------------------|--------------------|------------------------------------|
| Code editing              | Main               | DOM interaction required           |
| Compilation               | Main or Worker     | CPU-intensive, but infrequent      |
| WASM instantiation        | Simulation Worker  | Keeps main thread free             |
| Simulation ticks          | Simulation Worker  | CPU-intensive, must not block UI   |
| Physics/collision         | Simulation Worker  | Part of simulation loop            |
| State serialization       | Simulation Worker  | Prepare frame data for transfer    |
| WebGL rendering           | Main               | WebGL context is main-thread-only  |
| UI updates                | Main               | React renders on main thread       |
| File I/O (IndexedDB)      | Main               | IDB is available on both, but UI triggers it |

### 6.3 Keeping the UI Responsive During Batch Simulation

During a 10,000-round batch simulation, the simulation worker runs continuously. The
main thread must remain responsive for:

- Displaying progress (progress bar)
- Allowing the user to cancel
- Rendering a sample battle (optional)

**Strategy**:

```typescript
// In simulation worker:
async function runBatch(config: BatchConfig) {
  for (let round = 0; round < config.totalRounds; round++) {
    const result = runSingleBattle(config);
    aggregateResults(result);

    // Report progress every N rounds (not every round, to minimize overhead)
    if (round % 100 === 0) {
      postMessage({
        type: 'batch-progress',
        completed: round,
        total: config.totalRounds,
      });
    }

    // Yield to allow message handling (check for cancel/pause)
    // This is optional but useful; without it, the worker cannot
    // receive messages until the batch completes.
    if (round % 1000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  postMessage({ type: 'batch-complete', results: getAggregatedResults() });
}
```

**Key points**:
- Progress is reported periodically (e.g., every 100 rounds) to keep overhead low
- An occasional `setTimeout(0)` yield allows the worker to process incoming messages
  (like a cancel command)
- During visualization mode (single battle), the worker sends frame data every tick
- During batch mode, no frame data is sent (pure computation), only progress updates

### 6.4 Rendering Modes

The system supports two distinct rendering modes:

1. **Live battle**: Simulation runs at a controlled tick rate (e.g., 30 ticks/second).
   The worker sends frame state after each tick. The renderer displays the battle in
   real-time.

2. **Batch simulation**: Simulation runs as fast as possible, no rendering. Only
   aggregate results are sent back. After batch completes, individual battles can be
   replayed from their seeds.

```typescript
// Worker-side mode handling
if (config.mode === 'live') {
  // Throttled: send state every tick, pace to target tick rate
  for (const tick of simulation) {
    const frameData = serializeState(tick);
    postMessage({ type: 'battle-state', state: frameData }, [frameData]);
    await delay(1000 / config.tickRate);
  }
} else {
  // Batch: run at full speed, no frame output
  runBatch(config);
}
```

---

## 7. Storage and Persistence

### 7.1 Storage Technology Comparison

| Technology               | Capacity       | Performance | Browser Support | Use Case              |
|--------------------------|----------------|-------------|------------------|-----------------------|
| localStorage             | ~5-10 MB       | Synchronous | Universal        | Small settings only   |
| IndexedDB                | 60% of disk    | Async, good | Universal        | Robot files, results  |
| Origin Private File Sys. | Generous       | Very fast   | Chromium only    | Future optimization   |
| File System Access API   | User's disk    | Fast        | Chromium desktop | Open/save dialogs     |
| Cache API                | Generous       | Async       | Universal        | Not suitable here     |

### 7.2 Recommended Storage Strategy

```typescript
// Robot storage schema (IndexedDB)
interface RobotRecord {
  id: string;           // UUID
  name: string;         // Robot name
  source: string;       // .rbl source code
  compiledWasm?: ArrayBuffer;  // Cached compiled WASM
  compilerVersion: string;     // Invalidate cache on compiler updates
  created: number;      // Timestamp
  modified: number;     // Timestamp
  metadata: {
    author?: string;
    description?: string;
    version?: string;
  };
}

// Battle results schema (IndexedDB)
interface BattleRecord {
  id: string;
  timestamp: number;
  seed: number;          // For replay
  robotIds: string[];
  config: BattleConfig;
  results: BattleResults;
  rounds?: number;       // For batch results
}
```

**IndexedDB** is the primary storage backend because:
- Sufficient capacity for thousands of robot files and battle records
- Asynchronous API does not block the UI
- Supports structured data (objects) and binary data (ArrayBuffer for WASM)
- Universal browser support
- Transactional (data integrity)

**localStorage** is used only for small preferences:
- Editor settings (theme, font size)
- Last-opened robot ID
- UI preferences

### 7.3 File Import/Export

Users should be able to import and export robot files:

```typescript
// Export: download .rbl file
function exportRobot(robot: RobotRecord) {
  const blob = new Blob([robot.source], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${robot.name}.rbl`;
  a.click();
  URL.revokeObjectURL(url);
}

// Import: read .rbl file via File input or drag-and-drop
async function importRobot(file: File): Promise<RobotRecord> {
  const source = await file.text();
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.rbl$/, ''),
    source,
    compilerVersion: COMPILER_VERSION,
    created: Date.now(),
    modified: Date.now(),
    metadata: {},
  };
}
```

For Chromium browsers, the File System Access API can provide a more native feel:
```typescript
// Open file picker
const [handle] = await window.showOpenFilePicker({
  types: [{ description: 'Robot files', accept: { 'text/plain': ['.rbl'] } }],
});
const file = await handle.getFile();
```

### 7.4 Sharing Robots via URL

Robots can be shared by encoding the source code in the URL. This works for small robots:

```typescript
// Encode robot source into URL
function shareRobot(robot: RobotRecord): string {
  const compressed = pako.deflate(robot.source);  // zlib compression
  const encoded = btoa(String.fromCharCode(...compressed));
  return `${window.location.origin}/#/robot/${encodeURIComponent(encoded)}`;
}

// Decode robot from URL
function loadSharedRobot(encoded: string): string {
  const binary = atob(decodeURIComponent(encoded));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return pako.inflate(bytes, { to: 'string' });
}
```

**Limitations**:
- URL length is limited (2,048 chars in some browsers, ~8KB in modern browsers)
- With compression, this supports robots of roughly 2-6 KB of source code
- Larger robots would need a paste service or file-sharing approach

**Alternative for larger sharing**: A simple JSON blob hosted on a gist or paste service,
with the URL pointing to that external resource.

---

## 8. Build and Development Tooling

### 8.1 Bundler: Vite (Recommended)

Vite is the recommended bundler for Robot Battle:

- **Fast development server**: Near-instant HMR (Hot Module Replacement), critical during
  iterative development
- **Native ESM**: Serves ES modules directly in development, no bundling step
- **WASM support**: Built-in support for `.wasm` files via `?init` imports; the
  `vite-plugin-wasm` package adds ESM integration for WASM modules
- **Web Worker support**: Native `new Worker(new URL(...), { type: 'module' })` syntax
  works out of the box
- **TypeScript**: First-class TypeScript support, no additional configuration
- **Production builds**: Uses Rollup under the hood for optimized production bundles

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  // Ensure WASM files are not inlined
  build: {
    assetsInlineLimit: 0,
  },
  // Headers for SharedArrayBuffer (if used later)
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

### 8.2 TypeScript Configuration

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "jsx": "react-jsx",
    "outDir": "dist",
    "sourceMap": true,
    "declaration": true,
    "types": ["vite/client"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Key configuration choices:
- `ES2022` target: Supports all modern features needed (top-level await, etc.)
- `strict: true` with additional strict flags: Catches bugs early, especially important
  for the compiler and simulation engine
- `WebWorker` lib: Provides types for Worker APIs
- `moduleResolution: "bundler"`: Matches Vite's resolution strategy

### 8.3 Testing Strategy

Testing is layered, with each module having appropriate test types:

```
Test Pyramid for Robot Battle
=============================

              +------------------+
              |  E2E Tests       |  Few: Full battle through UI
              |  (Playwright)    |
              +------------------+
            /                      \
      +----------+            +----------+
      | Integ.   |            | Integ.   |   Some: Compile + simulate,
      | Tests    |            | Tests    |   multi-robot battles
      +----------+            +----------+
    /              \        /              \
+------+  +------+  +------+  +------+  +------+
| Unit |  | Unit |  | Unit |  | Unit |  | Unit |   Many: Pure functions,
|Lexer |  |Parser|  |Codegn|  |Physcs|  |Arena |   deterministic logic
+------+  +------+  +------+  +------+  +------+
```

**Unit tests** (Vitest):
- **Compiler**: Lexer tokenizes correctly, parser builds correct ASTs, codegen produces
  valid WASM for each language construct, metering injection works correctly
- **Simulation**: Physics calculations are correct (fixed-point arithmetic), collision
  detection works, weapon damage calculations are accurate, robot API functions behave
  correctly
- **Determinism**: Same seed + same robots = same results, across multiple runs

```typescript
// Example: compiler unit test
describe('codegen', () => {
  it('produces valid WASM for a minimal robot', async () => {
    const source = `robot "Test" { fn tick(s: State) -> Action { noop() } }`;
    const wasm = compile(source);
    const module = await WebAssembly.compile(wasm);
    expect(module).toBeInstanceOf(WebAssembly.Module);
  });

  it('injects metering into all basic blocks', () => {
    const source = `robot "Test" { fn tick(s: State) -> Action {
      if s.energy > 50 { fire(0) } else { noop() }
    }}`;
    const wasm = compile(source);
    // Verify metering calls are present in the binary
    expect(countMeteringCalls(wasm)).toBeGreaterThanOrEqual(3); // entry + 2 branches
  });
});
```

**Integration tests** (Vitest):
- Compile a robot from source and run it in a simulation
- Run multi-robot battles and verify outcomes
- Test gas exhaustion (robot with infinite loop is correctly halted)
- Test memory limit enforcement

```typescript
// Example: integration test
describe('battle simulation', () => {
  it('halts a robot that exceeds gas limit', async () => {
    const infiniteLoopRobot = compile(`
      robot "Looper" {
        fn tick(s: State) -> Action {
          while true {}
          noop()
        }
      }
    `);
    const normalRobot = compile(`
      robot "Normal" { fn tick(s: State) -> Action { noop() } }
    `);

    const result = await runBattle({
      robots: [infiniteLoopRobot, normalRobot],
      seed: 42,
      maxTicks: 100,
    });

    expect(result.disqualified).toContain('Looper');
    expect(result.winner).toBe('Normal');
  });
});
```

**End-to-end tests** (Playwright):
- Load the app, write a robot, compile it, run a battle, verify results display
- Test file import/export
- Test batch simulation with progress reporting
- Verify UI responsiveness during simulation

### 8.4 Development Workflow Recommendations

**Repository structure**:
```
robot-battle/
  src/            # Application source
  tests/          # Test files (mirrors src/ structure)
  research/       # Design documents (like this one)
  public/         # Static assets
  examples/       # Example .rbl robot files
  package.json
  vite.config.ts
  tsconfig.json
  vitest.config.ts
```

**Development commands**:
```bash
npm run dev         # Start Vite dev server with HMR
npm run build       # Production build
npm run test        # Run unit + integration tests (Vitest)
npm run test:watch  # Watch mode for tests
npm run test:e2e    # Run Playwright E2E tests
npm run lint        # ESLint + TypeScript checking
npm run typecheck   # tsc --noEmit
```

**CI pipeline** (GitHub Actions):
1. Lint and type-check
2. Run unit tests
3. Run integration tests
4. Build production bundle
5. Run E2E tests against production build
6. (Optional) Deploy preview for PRs

**Development tips**:
- Write compiler tests first (TDD works very well for compilers)
- Use example `.rbl` files as living documentation and test fixtures
- Profile batch simulation early; the 10K-round target is a useful performance benchmark
- Keep the simulation engine independent of the renderer; it should work headlessly in
  tests and in the worker without any DOM dependencies

---

## Appendix A: Security Checklist

Before shipping, verify:

- [ ] Robot WASM instances have capped memory (`maximum` pages set)
- [ ] Fuel metering is injected for all robot code paths
- [ ] No timing-related imports are provided to robot WASM
- [ ] Robot WASM imports are minimal (only the simulation API)
- [ ] Gas exhaustion is caught and handled gracefully
- [ ] Stack overflow traps are caught and handled
- [ ] Worker timeout exists as a safety net
- [ ] No robot can cause the main thread to freeze
- [ ] Battle results are deterministic for the same seed
- [ ] Shared robot URLs cannot contain executable code (XSS prevention)

## Appendix B: Key Dependencies

| Dependency               | Purpose                              | Required? |
|--------------------------|--------------------------------------|-----------|
| React                    | UI framework                         | Yes       |
| Vite                     | Build tool and dev server            | Yes       |
| Vitest                   | Unit and integration testing         | Yes       |
| Playwright               | E2E testing                          | Optional  |
| Zustand or Jotai         | React state management               | Yes       |
| CodeMirror or Monaco     | Code editor for .rbl files           | Yes       |
| pako                     | Zlib compression for URL sharing     | Optional  |
| idb                      | IndexedDB wrapper (cleaner API)      | Optional  |
| vite-plugin-wasm         | WASM ESM integration for Vite        | Yes       |

## Appendix C: References

- [WebAssembly Security Model](https://webassembly.org/docs/security/)
- [WebAssembly Nondeterminism](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md)
- [wasm-metering (GitHub)](https://github.com/ewasm/wasm-metering)
- [WebAssembly.Memory (MDN)](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory)
- [Worker.terminate() (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate)
- [Structured Clone Algorithm (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [Transferable Objects (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [SharedArrayBuffer (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [Cross-Origin Isolation (web.dev)](https://web.dev/articles/coop-coep)
- [Is postMessage Slow? (surma.dev)](https://surma.dev/things/is-postmessage-slow/)
- [Vite WASM Plugin](https://github.com/Menci/vite-plugin-wasm)
- [WebAssembly 3.0 Spec](https://webassembly.github.io/spec/core/)
- [V8 4GB WASM Memory](https://v8.dev/blog/4gb-wasm-memory)
- [Wasmtime Deterministic Execution](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html)
- [DFINITY WASM Instrumentation](https://medium.com/dfinity/new-webassembly-instrumentation-2c93631e5718)
