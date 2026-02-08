# Robot Battle: Research Synthesis

This document synthesizes findings from five deep-dive research documents. It presents the recommended tech stack, key architectural decisions, and a proposed build order. All open questions and design assumptions have been resolved.

See individual documents for full detail:
- [01-wasm-compiler.md](./01-wasm-compiler.md) — Compiler pipeline and WASM code generation
- [02-rendering-engine.md](./02-rendering-engine.md) — WebGL rendering and React integration
- [03-simulation-physics.md](./03-simulation-physics.md) — Physics model, determinism, batch performance
- [04-language-design.md](./04-language-design.md) — Language syntax, API, example robots
- [05-architecture-sandboxing.md](./05-architecture-sandboxing.md) — App architecture, sandboxing, tooling

---

## The Big Picture

Players write robots in **RBL** (Robot Battle Language), a C-like language with modern ergonomics. The compiler (written in TypeScript, using binaryen.js) runs in the browser and produces WebAssembly modules. Robots fight in a deterministic tick-based simulation. Battles can be watched in real-time via a PixiJS WebGL renderer, or simulated headlessly at maximum speed across Web Workers. The UI is React.

```
  .rbl source
      │
      ▼
  ┌──────────┐     ┌─────────────┐     ┌──────────────┐
  │ Compiler │────▶│ WASM Module │────▶│  Simulation   │
  │ (TS)     │     │             │     │  Engine       │
  └──────────┘     └─────────────┘     └──────┬───────┘
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                        ┌──────────┐   ┌────────────┐  ┌───────────┐
                        │ PixiJS   │   │ Batch Mode │  │ Results   │
                        │ Renderer │   │ (Workers)  │  │ & Scoring │
                        └──────────┘   └────────────┘  └───────────┘
```

---

## Recommended Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Language | RBL (custom, C-like, no semicolons) | Learnable in 30 min, compiles cleanly to WASM |
| Compiler | Hand-written recursive descent + binaryen.js | Proven by AssemblyScript; full control; ~10-70ms compile time |
| Execution | WebAssembly with fuel metering | Near-native speed, natural sandboxing, deterministic |
| Simulation | Discrete tick-based (2,000 ticks/round) | Deterministic, reproducible, proven by Robocode |
| Rendering | PixiJS v8 | Purpose-built 2D WebGL, sprite hierarchy for body+turret, particle effects |
| UI Framework | React | Manages editor, controls, scoreboard alongside canvas |
| Code Editor | CodeMirror 6 | Lightweight, extensible, good custom language support |
| State Mgmt | Zustand or Jotai | Minimal, works well outside React render cycle |
| Build Tool | Vite | Fast HMR, native WASM support, simple config |
| Testing | Vitest + Playwright | Unit/integration for compiler+sim, E2E for full app |
| Storage | IndexedDB (via idb wrapper) | Robot files, battle history, tournament results |

---

## Key Architectural Decisions

### 1. Language: Modernized C Without Semicolons

The language research evaluated three syntax styles. **Option B (modernized C)** won:

```
robot "SpinBot" {
    fn tick() {
        setSpeed(30)
        setTurnRate(8)
        if getGunHeat() == 0.0 {
            fire(2)
        }
    }
}
```

- Curly braces (map directly to WASM block structure)
- No semicolons (less noise)
- No required parens on `if`/`while` conditions
- `let` for locals, `var` for persistent globals, `fn` for functions, `on` for events
- Types: `int`, `float`, `bool`, `angle`, fixed-size arrays, structs
- ~30 API functions + 6 event handlers + 15 math builtins

### 2. Compiler: TypeScript + Binaryen.js

Pipeline: Source → Tokens → AST → Annotated AST → Binaryen IR → Optimized WASM

- **Parser**: Hand-written recursive descent with Pratt parsing for operator precedence. Chevrotain is a solid alternative if hand-writing feels slow.
- **Code gen**: Build Binaryen IR directly from the AST. Binaryen handles optimization (constant folding, dead code elimination, etc.) and binary emission.
- **Compile time**: ~10-70ms for a typical robot program. Fast enough for compile-on-save.
- **Binaryen.js init**: ~100-500ms one-time cost at app startup (it's a 5MB WASM module itself).

### 3. Simulation: Discrete Tick-Based

- **2,000 ticks per round** (matches Robocode's proven model)
- **Per-tick callback**: Engine calls each robot's `tick()` export once per simulation tick
- **10,000 gas per tick**: Fuel metering prevents infinite loops. Counter injected at compile time into every loop and function call.
- **Integer/fixed-point arithmetic** for all game logic (avoids floating-point non-determinism across platforms)
- **Seeded PRNG** (Mulberry32): Identical seeds produce identical battles
- **Circle hitboxes** (radius 18 units): Simple, fast collision detection
- **Brute-force O(n²) collision**: With ≤8 robots, only ~330 pair checks per tick at ~5ns each. Spatial partitioning would add more overhead than it saves.

### 4. Rendering: PixiJS in React Shell

- PixiJS v8 handles all in-canvas rendering (tanks, bullets, effects, health bars)
- React handles all UI panels (editor, controls, scoreboard, robot list)
- Imperative renderer wrapped in a single `<GameCanvas>` React component
- **SimulationFrame** objects are the interface between simulation and renderer
- **30 tick/s simulation, 60fps rendering** with linear interpolation between ticks
- Speed controls: pause, step, 1x, 2x, 4x, 8x

### 5. Batch Mode: Parallel Web Workers

- Simulation engine runs in Web Workers (zero rendering dependencies)
- `navigator.hardwareConcurrency` workers run rounds in parallel
- Plain `postMessage` for worker communication (data is small)
- Progress reporting every 1% of rounds
- **Expected**: 10,000 rounds in minutes on modern hardware

### 6. Sandboxing: WASM + Fuel Metering

- WASM provides memory isolation, no system access, no code injection by design
- Fuel metering (compiler-injected gas counter) prevents infinite loops
- Memory capped at 4 pages (256KB) per robot — plenty for any strategy
- Only ~20 import functions exposed (the game API) — that IS the sandbox boundary
- Web Worker timeout as a secondary safety net

---

## Resolved Design Decisions

All open questions have been resolved. Here are the decisions:

### Language Design

1. **Scan API**: Event-based. `scan()` fires the scan; if it hits something, `on scan(distance, bearing)` fires next tick. No nullable types needed, no sentinel values.

2. **API model**: Fully intent-based. All outbound calls (`setSpeed`, `setTurnRate`, `fire`, `scan`) are non-blocking intents. All inbound information arrives via event handlers (`on hit`, `on scan`, `on wallHit`). No blocking calls, no coroutines needed in the compiler.

3. **`angle` type**: Included in MVP. Auto-normalizes to 0-360 on every operation. Worth the compiler effort since bearing math is central to robot programming.

4. **Structs**: Included in MVP. Essential for readable robot code (tracking targets, waypoints, state).

### Simulation

5. **Float handling**: Use WASM f32 for all arithmetic (its basic ops ARE deterministic per IEEE 754). Implement sin/cos/atan2 as custom polynomial approximations or lookup tables rather than importing from JS. This gives determinism where it matters without fixed-point complexity.

6. **Bullet model**: Projectile with travel time (speed = 20 - 3*power). Creates dodging, leading shots, and power/speed tradeoffs. Core competitive mechanic.

7. **Energy system**: Finite energy with slow passive regeneration. No energy returned on hit. Every shot is a real decision — spam-firing drains you. Favors precision and conservation.

### Architecture

8. **Code editor**: CodeMirror 6. Lighter (~100KB), modular, excellent custom language support.

9. **File extension**: `.rbl` (Robot Battle Language).

10. **URL sharing**: Yes, for small robots. Compress source into URL hash for sharing on forums/Discord. Fall back to file export for larger robots.

---

## Game Design Decisions

These were identified as implicit assumptions in the research and have now been explicitly confirmed.

### Arena & Environment

| Decision | Choice |
|----------|--------|
| Arena dimensions | Configurable per match (default 800x600) |
| Mines | Spawn periodically at random locations during the round |
| Cookies (health) | Spawn periodically at random locations during the round |
| Robot start positions | Random with minimum spacing between robots |
| Round end condition | Last robot standing OR time limit (whichever first) |
| Ticks per round | Configurable per match (default 2,000) |
| Dead robots | Disappear from the arena |
| Wall collision | Speed-based damage (faster = more damage) |

### Robot Model

| Decision | Choice |
|----------|--------|
| Rotating parts | Three independent parts: **body**, **gun**, **radar** |
| Gun rotation | Fully independent from body |
| Radar | Separate from gun. Scan fires from radar direction, not gun. |
| Robot stats | Fixed for all robots (pure programming competition) |
| Robot-robot collision | Speed-based damage (faster robot takes less, slower takes more) |

### Combat & Scoring

| Decision | Choice |
|----------|--------|
| Bullet model | Projectile with travel time (speed = 20 - 3*power) |
| Energy system | Finite with slow passive regen. No energy returned on hit. |
| Scoring | Placement points per round, totaled across all rounds |
| Team battles | Free-for-all only initially. Teams deferred. |
| Team communication | Deferred (no team comms) |

### Application & UX

| Decision | Choice |
|----------|--------|
| Primary use case | Solo first, then local multiplayer, then online community |
| Layout | Tabbed/modal (Edit tab, Battle tab, Tournament tab) |
| Editor model | Single editor, switch between robot files via tabs/file list |
| Onboarding | Guided tutorial ("Your first robot in 5 minutes") |
| Deployment | Static site / PWA (works offline, deploy to any CDN) |

---

## Proposed Build Order

Based on dependencies and the ability to test incrementally:

### Phase 1: Core Engine (No UI)
1. **Simulation engine** — Tick loop, robot state, integer physics, collision detection
2. **JS robot interface** — `onTick()` callback returning actions (test without WASM)
3. **Determinism verification** — Run same battle twice, confirm identical results
4. **Bullet and scan mechanics** — Projectile tracking, ray-cast scanning
5. **Seeded PRNG** — Mulberry32 integration

### Phase 2: Compiler
6. **Tokenizer** — Source → Token[]
7. **Parser** — Token[] → AST (recursive descent + Pratt)
8. **Semantic analysis** — Type checking, name resolution, error messages
9. **Code generator** — AST → Binaryen IR → WASM binary
10. **Fuel metering** — Inject gas counters into loops and function calls
11. **WASM robot runner** — Instantiate compiled WASM, connect to simulation engine

### Phase 3: Visualization
12. **PixiJS renderer** — Tank sprites (body + turret), arena, bullets, effects
13. **React shell** — Layout with canvas + panels
14. **Game loop** — Fixed timestep + interpolation, speed controls
15. **Code editor** — CodeMirror 6 with RBL syntax highlighting

### Phase 4: Battle Management
16. **Batch simulation** — Web Worker runner, parallel rounds, progress reporting
17. **Scoring system** — Point-based placement across thousands of rounds
18. **Robot file management** — Load/save via IndexedDB and file import/export
19. **Results display** — Leaderboard, per-robot stats, win rates

### Phase 5: Polish
20. **Debugger** — Breakpoints, variable inspection, step-through
21. **Hot reload** — Edit code during a battle, see changes immediately
22. **Particle effects** — Explosions, bullet trails, scan arcs
23. **Example robots** — SpinBot, WallCrawler, TrackerBot, StrategyBot
24. **Tournament mode** — Automated round-robin with Elo or point-based ranking

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Binaryen.js too large (5MB) | Medium | Medium | Lazy-load on first compile; cache aggressively |
| Float non-determinism across browsers | Medium | High | Use WASM f32 (deterministic) + custom trig implementations (no JS Math) |
| Fuel metering overhead too high | Low | Medium | Research shows ~2x slowdown, acceptable for robot code |
| Language too complex for beginners | Medium | High | Start with minimal MVP (int, if, while, functions only) |
| PixiJS v8 breaking changes | Low | Medium | Pin version, stay on stable release |
| Web Worker communication overhead | Low | Low | Data per round is small (~5-15KB); postMessage is fine |

---

## Key Dependencies (npm)

| Package | Purpose | Size |
|---------|---------|------|
| `binaryen` | WASM IR construction, optimization, emission | ~5MB (WASM) |
| `pixi.js` | 2D WebGL rendering | ~130-200KB gzip |
| `react` + `react-dom` | UI framework | ~40KB gzip |
| `@codemirror/view` + lang packages | Code editor | ~100KB gzip |
| `zustand` | State management | ~3KB gzip |
| `vite` | Build tool (dev dependency) | — |
| `vitest` | Testing (dev dependency) | — |
| `idb` | IndexedDB wrapper | ~3KB gzip |

Total client bundle (estimated): **~400-500KB gzip** excluding binaryen (loaded separately).
