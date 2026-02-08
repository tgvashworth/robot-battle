# Interface Specifications

This document describes the module boundaries and the interfaces between them. The TypeScript files in this directory are the source of truth for types. This document explains the design intent and invariants that types alone cannot express.

## Module Architecture

```
                    .rbl source
                         │
                         ▼
              ┌─────────────────────┐
              │      COMPILER       │
              │                     │
              │  source → CompileResult
              │  (wasm + sourcemap  │
              │   + metadata)       │
              └────────┬────────────┘
                       │ CompileResult
                       ▼
              ┌─────────────────────┐
              │     SIMULATION      │
              │                     │
              │  GameConfig         │
              │  + RobotModule[]    │
              │  → Battle           │
              │  → GameState per tick
              └────────┬────────────┘
                       │ GameState
                       ▼
              ┌─────────────────────┐
              │      RENDERER       │
              │                     │
              │  GameState → pixels │
              │  (PixiJS + WebGL)   │
              └─────────────────────┘

              ┌─────────────────────┐
              │      UI / APP       │
              │                     │
              │  Orchestrates all   │
              │  three modules.     │
              │  React + CodeMirror │
              │  + Storage          │
              └─────────────────────┘
```

## The Four Modules

### 1. Compiler (`spec/compiler.ts`)

**Responsibility**: Transform RBL source code into a WASM binary with metadata.

**Input**: A string of RBL source code.

**Output**: `CompileResult` containing:
- `wasm: Uint8Array` — the compiled WASM binary
- `sourceMap: SourceMap` — offset-to-source-line mapping
- `metadata: RobotMetadata` — robot name, global variable layout, event handlers
- `errors: CompileError[]` — any errors or warnings

**Invariants**:
- The compiler is a pure function. Same input always produces same output.
- The compiler has zero runtime dependencies (no simulation, no renderer, no DOM).
- The compiler can run in the main thread or a Web Worker.
- On failure, `success` is false and `wasm`/`sourceMap`/`metadata` are absent.
- On success, the WASM binary always passes `WebAssembly.validate()`.
- The WASM binary exports: `memory`, `init`, `tick`, and any `on_*` event handlers.
- The WASM binary imports: all functions from the `"env"` module matching `RobotAPI`.

**Test boundary**: Compile source, assert on `CompileResult` contents. For behavioral tests, compile + instantiate + call exports with mock imports.

---

### 2. Simulation (`spec/simulation.ts`)

**Responsibility**: Run deterministic tick-based battles between robots.

**Inputs**:
- `GameConfig` — arena size, physics constants, scoring, seed
- `RobotModule[]` — compiled WASM robots or test stubs

**Output**: `GameState` per tick (the canonical superset type).

**Key interface: `RobotModule`**

This is the universal robot interface. Both WASM-compiled robots and TypeScript test stubs implement it. The simulation engine treats them identically.

```
Engine calls:    init(api) → tick() → onScan() → onHit() → ...
Robot calls:     api.setSpeed() → api.fire() → api.getX() → ...
```

The `RobotAPI` is provided to the robot via `init()`. For WASM robots, these become WASM imports. For test stubs, they're plain function calls.

**Key interface: `GameState`**

This is THE canonical state type. It is a superset — it contains everything any consumer could need:

- The simulation engine produces it (one per tick)
- The renderer reads it (ignoring debug/stats fields)
- The replay system stores it
- The batch runner serializes it via `postMessage`

**Invariants**:
- `GameState` is a plain object (no methods, no classes). It survives `structuredClone()`.
- All fields are readonly. The engine creates a new snapshot each tick.
- The same `GameConfig` + seed + robot code always produces identical `GameState` sequences.
- `GameState.events` contains everything that happened this tick, in processing order.
- Robot IDs within `GameState` are randomized per round.
- Heading convention: 0 = north, clockwise (90 = east, 180 = south, 270 = west).
- Coordinates: top-left origin (0,0), x increases right, y increases down.

**Key interface: `Battle`**

The simulation engine API. Supports both tick-by-tick execution (for real-time visualization) and run-to-completion (for batch simulation).

**Worker Protocol**:

For batch simulation, workers receive `WorkerCommand` messages and emit `WorkerEvent` messages. The protocol is stateless — each command is self-contained with the WASM binaries and config.

**Test boundary**: Create a `Battle` with test stub `RobotModule` implementations. Call `tick()`, assert on `GameState` contents. No compiler or renderer needed.

---

### 3. Renderer (`spec/renderer.ts`)

**Responsibility**: Draw `GameState` frames to a canvas using PixiJS.

**Input**: `GameState` objects (one per tick, from simulation or replay).

**Output**: Pixels on a canvas element.

**Key interface: `BattleRenderer`**

Imperative renderer. NOT managed by React reconciliation. React owns the canvas element; the renderer owns everything drawn on it.

```
renderer.pushFrame(state)    // give it new state
renderer.render(alpha)       // draw interpolated frame
```

**Key interface: `TickSource`**

Abstraction over "something that produces states." Both live simulation and replay implement this. The `GameLoop` consumes a `TickSource` and feeds frames to the `BattleRenderer`.

**Key interface: `GameLoop`**

Bridges the fixed-timestep simulation (30 ticks/sec) to the variable-rate render loop (requestAnimationFrame, ~60fps). Handles interpolation, speed control, pause, and step.

**Invariants**:
- The renderer has zero knowledge of WASM, the compiler, or robot code.
- The renderer only reads from `GameState`. It never writes to it or mutates it.
- The renderer reads `GameState.events` to trigger visual effects (explosions, flashes, scan arcs).
- The renderer ignores fields it doesn't need (e.g., `fuelUsedThisTick`, `damageDealt`).
- Destroying the renderer releases all PixiJS/WebGL resources.

**Test boundary**: Push `GameState` objects (constructed manually), verify renderer doesn't crash. Visual testing via screenshots is optional polish.

---

### 4. UI / App (`spec/ui.ts`)

**Responsibility**: Orchestrate the other modules. Manage the React application, code editor, file storage, and tournament system.

**The UI is the glue**. It:
1. Loads robot files from storage
2. Sends source to the compiler
3. Shows errors in the editor
4. Creates battles with compiled robots
5. Feeds game states to the renderer
6. Manages tournament execution
7. Displays results

**Key interface: `Storage`**

Persistence layer over IndexedDB. Stores robot files, battle results, and replays. All methods are async.

**Key interface: `RobotFile`**

The UI's representation of a robot. Contains source code, filename, last compile result, and modification timestamp.

**Invariants**:
- The UI never directly calls WASM functions. It uses `RobotModule` via the simulation engine.
- The UI never directly calls PixiJS functions. It uses `BattleRenderer`.
- File I/O is always through the `Storage` interface (never direct IndexedDB calls).
- The UI can run without the renderer (for testing compilation and simulation).

---

## Boundary Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        UI / APP                              │
│                                                              │
│   ┌─────────┐  source   ┌──────────┐  CompileResult         │
│   │  Editor  │ ────────► │ Compiler │ ──────────────┐        │
│   └─────────┘           └──────────┘               │        │
│                                                     ▼        │
│   ┌─────────┐  config   ┌──────────────┐   GameState         │
│   │ Battle  │ ────────► │  Simulation  │ ──────────┐        │
│   │ Config  │           │   Engine     │           │        │
│   └─────────┘           └──────────────┘           ▼        │
│                                              ┌──────────┐   │
│                                              │ Renderer │   │
│   ┌─────────┐                                └──────────┘   │
│   │ Storage │  IndexedDB                                     │
│   └─────────┘                                                │
│                                                              │
│   ┌─────────┐  Workers  ┌──────────────┐                     │
│   │Tourney  │ ────────► │ Batch Runner │                     │
│   │ Config  │           │ (Workers)    │                     │
│   └─────────┘           └──────────────┘                     │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow for Key Scenarios

### Scenario 1: Edit → Compile → Battle → Watch

```
1. User edits source in CodeMirror
2. UI sends source string to Compiler.compile()
3. Compiler returns CompileResult (wasm + metadata + errors)
4. UI shows errors in editor (if any)
5. User clicks "Battle"
6. UI creates GameConfig
7. UI creates RobotModules from CompileResults (WASM adapter)
8. UI calls createBattle(config, robots)
9. GameLoop starts: calls battle.tick() at 30 Hz
10. Each tick: pushFrame(state) to BattleRenderer
11. Each rAF: renderer.render(alpha) draws interpolated frame
12. Round ends: UI shows results
```

### Scenario 2: Tournament (Batch Simulation)

```
1. User configures tournament (robots, rounds, settings)
2. UI compiles all robot files → CompileResult[] (wasm bytes)
3. UI creates N Web Workers
4. UI sends WorkerCommand { type: 'run_batch', ... } to each worker
5. Workers run rounds, send WorkerEvent { type: 'progress' } periodically
6. Workers send WorkerEvent { type: 'round_result' } per round
7. Workers send WorkerEvent { type: 'batch_complete' } when done
8. UI aggregates results → TournamentResult
9. UI displays leaderboard
```

### Scenario 3: Replay

```
1. User watches a battle (Scenario 1)
2. UI records all GameState frames into an array
3. User clicks "Replay"
4. UI creates ReplaySource from recorded frames
5. GameLoop uses ReplaySource instead of live Battle as its TickSource
6. Same rendering path as live battle
7. User can seek to any tick (ReplaySource supports random access)
```

## Versioning and Backwards Compatibility

The `GameState` interface is the most critical to keep stable. Any change to it affects all four modules. Guidelines:

- **Adding fields**: Always safe. Renderer ignores unknown fields.
- **Removing fields**: Breaking. Never remove, only deprecate.
- **Changing field types**: Breaking. Never change.
- **Adding new event types**: Safe. Renderer ignores unknown event types.

The `RobotAPI` interface (WASM imports) is the second most critical:
- **Adding functions**: Safe (robots that don't use them aren't affected).
- **Removing functions**: Breaking for robots that use them.
- **Changing signatures**: Breaking. Never change.

The `CompileResult` interface can evolve more freely since only the UI consumes it.
