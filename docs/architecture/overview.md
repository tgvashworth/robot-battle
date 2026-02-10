# System Architecture

## High-Level Overview

Robot Battle is a browser-based game where robots, written in RBL (a Go-inspired language), fight each other in a 2D arena. The system compiles RBL source code to WebAssembly, runs a deterministic tick-based simulation, and renders the results using PixiJS (WebGL). For the language specification, see the [Language Reference](../reference/language.md). For compiler internals, see the [Compiler Architecture](../reference/compiler.md).

The core loop is:

```
RBL source -> lex -> parse -> analyze -> codegen -> WASM binary
    -> instantiate with RobotAPI imports -> simulation tick loop
    -> GameState snapshots -> renderer
```

Everything runs in the browser. There is no server-side component for simulation or compilation.

## Module Map

```
spec/                   Canonical type definitions (shared contracts)
  simulation.ts         GameState, GameConfig, RobotModule, RobotAPI, Battle, all event types
  renderer.ts           BattleRenderer, RenderOptions, GameLoop interfaces

src/compiler/           RBL -> WASM compilation pipeline
  lexer.ts              Tokenization
  parser.ts             Token stream -> AST (Pratt parser for expressions)
  ast.ts                AST node type definitions
  types.ts              Resolved type system (int, float, bool, angle, array, struct)
  analyzer.ts           Two-pass semantic analysis and type checking
  codegen.ts            AST -> WASM binary (direct binary emission, no intermediate IR)
  instantiate.ts        WASM instantiation bridge + compile convenience functions
  errors.ts             Structured compile error collection
  debug-log.ts          Debug/trap message collection for diagnostics

src/simulation/         Deterministic simulation engine
  battle.ts             Core tick loop, collision detection, event emission
  defaults.ts           Default GameConfig values (arena, physics, spawns, scoring)
  prng.ts               Deterministic PRNG (xoshiro128**)
  tournament.ts         Headless batch tournament runner

src/renderer/           Visual rendering layer
  renderer.ts           PixiJS-based BattleRenderer (layered scene graph)
  replay-source.ts      Frame buffer for seek/playback
  game-loop.ts          Fixed-timestep game loop with interpolation
  math.ts               Lerp/angle interpolation utilities

src/ui/                 React 19 application shell
  App.tsx               Root layout (editor left, battle right)
  edit/                 Code editor panel (EditTab)
  battle/               Battle and tournament panels
    BattlePanel.tsx     Mode switcher (battle / tournament tabs)
    BattleTab.tsx       Single-battle runner with playback controls
    TournamentTab.tsx   Multi-game tournament runner
    RobotStatusPanel.tsx  Per-robot stats display
  store/                Zustand state management
    battleStore.ts      Battle state (status, tick, seed, roster, debug logs)
    robotFileStore.ts   Robot file management (load, edit, persist)
    tournamentStore.ts  Tournament state
    persistence.ts      localStorage persistence layer

public/robots/          Built-in robot programs (.rbl files)
```

## The Canonical Type: GameState

`GameState` is THE type at the center of the system. It is defined in `spec/simulation.ts` and is a plain readonly object containing the complete state of the game at a single tick:

```typescript
interface GameState {
  readonly tick: number
  readonly round: number
  readonly arena: ArenaConfig
  readonly robots: readonly RobotState[]
  readonly bullets: readonly BulletState[]
  readonly mines: readonly MineState[]
  readonly cookies: readonly CookieState[]
  readonly events: readonly GameEvent[]
}
```

Key design properties:

- **Plain object**: No class instances, no methods, no prototypes. Survives `structuredClone()` and `postMessage()` without loss.
- **Readonly**: All fields are readonly. The simulation engine creates a new snapshot each tick by shallow-copying from its internal mutable state.
- **Superset**: Contains everything both the simulation and renderer need. The renderer reads what it cares about and ignores the rest (e.g., `fuelUsedThisTick`, `damageDealt` on RobotState).
- **Produced by simulation, consumed by renderer**: The simulation engine is the sole producer. The renderer, replay system, and batch runner are all consumers.

## Data Flow

### Compilation Pipeline

```
RBL source string
    |
    v
  Lexer        ->  Token[]
    |
    v
  Parser       ->  Program (untyped AST)
    |
    v
  Analyzer     ->  AnalysisResult (typed AST + symbol table + expression types)
    |
    v
  Codegen      ->  Uint8Array (raw WASM binary)
    |
    v
  instantiate  ->  RobotModule (WASM instance wrapped in RobotModule interface)
```

The `compile()` function in `instantiate.ts` runs lex, parse, analyze, and codegen as a single pipeline, returning a `CompileResult` with the WASM binary. The `instantiate()` function takes the WASM binary, creates a `WebAssembly.Instance` with the RobotAPI as imports, and wraps the WASM exports in a `RobotModule` interface.

The instantiation bridge deserves attention: the WASM imports are bound to a mutable `api` reference that is `null` until `init()` is called. Every import function calls `requireApi()` which throws if `init()` has not been called. This means the RobotAPI is injected lazily -- the WASM module is compiled once, but the API binding happens at simulation time.

### Simulation Loop

```
createBattle(config, robotModules)
    |
    v
  Initialize robots (random positions via PRNG)
  Call robot.init(api) for each robot
    |
    v
  Per tick:
    1.  Move bullets (save previous positions for swept collision)
    2.  Bullet-robot swept collision detection
    2b. Bullet-mine collision detection
    2c. Bullet-cookie collision detection
    3.  Remove out-of-bounds bullets (+ bullet-wall events)
    4.  Deliver pending events to robots (wall hits, collisions, bullet hits, scans)
    5.  Call robot.tick() for each alive robot
    6.  Apply movement intents (speed, turn, gun turn, radar turn)
    7.  Robot-robot collision detection and separation
    8.  Radar scanning (sweep arc intersection test)
    9.  Process fire intents (create bullets)
    10. Mine spawning (periodic, PRNG-positioned)
    11. Cookie spawning (periodic, PRNG-positioned)
    12. Robot-mine collision detection
    13. Robot-cookie collision detection
    14. Check round end conditions
    |
    v
  snapshot() -> GameState
```

### Rendering Pipeline

```
GameState (from simulation or replay buffer)
    |
    v
  renderer.pushFrame(state)    -- stores current + previous frame
    |
    v
  renderer.render(alpha)       -- interpolates between prev/current using alpha
    |                             for smooth sub-tick animation
    v
  PixiJS scene graph update    -- create/update/remove visual objects
    |                             (robots, bullets, mines, cookies, health bars)
    v
  app.render()                 -- PixiJS draws to canvas
```

The game loop (`createGameLoop`) drives this at a fixed tick rate with interpolation. The replay source (`createReplaySource`) provides random-access seek over the pre-computed frame buffer.

## Simulation Engine Details

### Intent-Based Robot Control

Robots do not directly modify their state. Instead, they set *intents* through the RobotAPI:

- `setSpeed(speed)` -- records desired speed
- `setTurnRate(rate)` -- records desired body turn rate
- `setHeading(heading)` -- converted to a turn rate intent internally
- `setGunTurnRate(rate)` -- records desired gun turn rate
- `fire(power)` -- records desired fire power

The engine applies these intents *after* the robot's `tick()` returns, in a well-defined order. This prevents order-of-execution bugs: it does not matter whether a robot calls `setSpeed` before or after `fire` within the same tick.

All "get" functions (`getX()`, `getHealth()`, etc.) return the state as of the *start* of the current tick, not mid-computation values.

### Event Delivery

Events are queued during the physics simulation steps and delivered to robots in a fixed order before `tick()` is called:

1. Wall hits (`onWallHit`)
2. Robot-robot collisions (`onRobotHit`)
3. Bullet hits -- target receives `onHit`, shooter receives `onBulletHit`
4. Bullet misses (`onBulletMiss`)
5. Robot deaths (`onRobotDeath`)
6. Scan results -- scanner receives `onScan`, scanned robot receives `onScanned`

This ordering is deterministic and consistent across replays.

### Collision Detection

- **Bullet-robot**: Swept line-segment vs. circle test (`lineSegmentIntersectsCircle`). The bullet's trajectory from its previous position to its current position is tested against each robot's collision circle. This prevents fast bullets from tunneling through robots.
- **Bullet-mine/cookie**: Same swept collision approach.
- **Robot-robot**: Circle-circle overlap test. Damage is only applied on initial contact (tracked via `collidingPairs` set). Overlapping robots are pushed apart.
- **Robot-mine/cookie**: Circle-circle overlap test with immediate effect (detonation or pickup).
- **Radar scanning**: Sweep arc intersection test (`isAngleInSweep`). The radar's rotation from the previous heading to the current heading, expanded by the scan width, defines the detection region.

### Deterministic PRNG

The `PRNG` class implements xoshiro128**, initialized from a seed via splitmix32. The same `masterSeed` in `GameConfig` produces the same sequence of random numbers, which means:

- Robot spawn positions are deterministic
- Mine/cookie spawn positions are deterministic
- Any robot calls to `random()` or `randomFloat()` draw from the shared PRNG in a deterministic order

Same seed = same battle outcome, enabling deterministic replay.

### Round and Battle Lifecycle

A battle consists of one or more rounds. Each round:

1. Robots are placed at random positions (via PRNG)
2. Simulation runs until one of: all robots dead, one robot remaining, or tick limit reached
3. Robots are ranked by alive status then remaining health
4. Placement points are awarded per `ScoringConfig`
5. Scores accumulate across rounds

Between rounds, `nextRound()` resets positions and entity state but preserves cumulative scores.

## Tournament System

The tournament runner (`src/simulation/tournament.ts`) is separate from the visual battle system. It runs battles headlessly -- no rendering, no frame collection, just tick-to-completion.

Key types:

- `TournamentConfig`: entries, game count, base seed, ticks per round, scoring
- `TournamentRobotEntry`: roster ID, name, color
- `GameResult`: per-game placement results
- `TournamentStanding`: cumulative points, wins, games played

The async variant (`runTournamentAsync`) yields to the event loop between games via `setTimeout(resolve, 0)`, keeping the UI responsive during long tournaments. Each game gets a fresh set of `RobotModule` instances (required because WASM modules have mutable state in linear memory).

Seeds are derived sequentially: game `i` uses seed `baseSeed + i`.

## Configuration

`GameConfig` (defined in `spec/simulation.ts`) is the complete, immutable configuration for a battle. It includes:

- **Arena**: width (800), height (800)
- **Physics**: speeds, turn rates, gun mechanics, bullet mechanics, damage values, energy, fuel
- **Spawns**: mine/cookie spawn intervals and limits, minimum spawn distances
- **Scoring**: placement points per position (default: [3, 1] for 1st and 2nd place)
- **Robots**: name and color for each robot
- **Timing**: ticks per round (2000), round count (1), master seed (12345)

Default configuration is constructed by `createDefaultConfig()` in `defaults.ts`, which accepts robot configs and optional overrides.

## UI Architecture

The application is a React 19 SPA with a two-panel layout:

- **Left panel**: Code editor (`EditTab`) for editing .rbl files
- **Right panel**: Battle/Tournament mode switcher (`BattlePanel`)

State management uses Zustand stores:

- `robotFileStore`: Manages robot files (load from manifest, edit, persist to localStorage)
- `battleStore`: Battle state (status, tick position, speed, roster, seed, debug logs)
- `tournamentStore`: Tournament configuration and results

The battle flow in `BattleTab`:

1. User selects robots for the roster and clicks "Run Battle"
2. Each robot's source is compiled to WASM via `compile()`
3. WASM binaries are instantiated via `instantiate()`
4. A `Battle` is created and run tick-by-tick, collecting all `GameState` frames
5. Frames are loaded into a `ReplaySource` for playback
6. A `GameLoop` drives the renderer at the selected speed
7. The timeline scrubber allows seeking to any tick

## Tech Stack

- **Runtime**: Bun (development and build tooling)
- **Bundler**: Vite
- **Testing**: Vitest
- **UI**: React 19
- **Rendering**: PixiJS v8 (WebGL, falls back to WebGPU/canvas)
- **State**: Zustand
- **Linting/Formatting**: Biome
- **Git**: Pre-commit hooks for linting
