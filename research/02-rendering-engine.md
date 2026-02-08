# Rendering Engine Research: Robot Battle

## Table of Contents

1. [WebGL for 2D Games: Library Comparison](#1-webgl-for-2d-games-library-comparison)
2. [Rendering Architecture](#2-rendering-architecture)
3. [Decoupling Simulation from Rendering](#3-decoupling-simulation-from-rendering)
4. [React + WebGL Integration](#4-react--webgl-integration)
5. [Performance for Batch Simulation](#5-performance-for-batch-simulation)
6. [Visual Design Inspiration](#6-visual-design-inspiration)
7. [Animation and Interpolation](#7-animation-and-interpolation)
8. [Recommendation Summary](#8-recommendation-summary)

---

## 1. WebGL for 2D Games: Library Comparison

### Overview

For a 2D tank battle game with 8 robots, bullets, explosions, and particle effects, we need a rendering solution that is fast enough for real-time visualization, lightweight enough to not bloat the app, and completely decoupled from simulation logic (since we need a headless mode). This last requirement is the most important architectural constraint: the renderer must be a consumer of simulation state, not intertwined with it.

### Option A: Raw WebGL2

**Approach:** Write shaders and buffer management directly against the WebGL2 API.

| Attribute | Details |
|---|---|
| Bundle size | 0 KB (browser-native API) |
| API ergonomics | Poor. Extremely verbose -- setting up a single textured quad requires ~100 lines of boilerplate (shader compilation, buffer creation, attribute binding, uniform management). |
| Performance | Maximum theoretical performance. Full control over draw call batching, instanced rendering, and state management. |
| Community | WebGL2 is a stable W3C standard. MDN documentation is excellent. No library-specific community needed. |
| Maintenance | No dependency risk. WebGL2 is supported in all modern browsers. |

**Pros:**
- Zero dependency overhead
- Complete control over rendering pipeline
- No abstraction leaks or library-imposed architecture

**Cons:**
- Enormous development time for basic features (sprite rendering, text, blending)
- Must implement your own sprite batcher, texture atlas system, and particle renderer
- Shader management is tedious
- Bug surface area is large

**Verdict:** Not recommended unless the team has deep WebGL expertise and wants maximum control. The development cost is disproportionate to the visual complexity of this game.

### Option B: PixiJS v8

**Approach:** Use PixiJS as a dedicated 2D WebGL renderer.

| Attribute | Details |
|---|---|
| Bundle size | ~130-200 KB min+gzip for a typical import (full package is larger, but v8 supports tree-shaking and selective imports via the `extend` API). |
| API ergonomics | Excellent for 2D. Sprite, Container, Graphics, ParticleContainer, Text are all first-class primitives. Rotation, anchor points, and hierarchical transforms are built in. |
| Performance | Very fast. Uses WebGL2 by default (with WebGPU support available). The ParticleContainer can render 100K+ particles at 60fps. Automatic sprite batching minimizes draw calls. |
| Community | Large and active. Used by Google, BBC, Adobe, Disney. Weekly npm downloads in the hundreds of thousands. Active GitHub with regular releases (currently v8.16+). |
| Maintenance | Actively maintained by a dedicated team. v8 was a major rewrite with modern JS, improved tree-shaking, and a modular architecture. |

**Key features relevant to Robot Battle:**
- `Sprite` with `anchor` and `rotation` -- perfect for tank body and turret
- `Container` hierarchy -- turret as child of body, inheriting position but with independent rotation
- `ParticleContainer` -- ideal for bullets, debris, explosion particles
- `Graphics` -- procedural drawing for arena boundaries, grid lines, scan arcs
- `Text` / `BitmapText` -- robot names, health values, scores
- Built-in blend modes for effects (explosions, energy shields)

**Cons:**
- It is a renderer, not a game engine. No physics, no input handling, no game loop. This is actually a *pro* for our architecture since we want the simulation fully decoupled.
- Learning curve for the container/display-object model if unfamiliar.

**Verdict: Strongly recommended.** PixiJS is purpose-built for exactly this use case. It provides the right abstraction level -- powerful 2D rendering without imposing game architecture.

### Option C: Three.js with Orthographic Camera

**Approach:** Use Three.js (a 3D engine) with an orthographic camera to render a 2D scene.

| Attribute | Details |
|---|---|
| Bundle size | ~180 KB min+gzip (full library). Tree-shakeable but the core is large. |
| API ergonomics | Designed for 3D. Using it for 2D means fighting the API -- materials, geometries, meshes, scenes, and cameras are all 3D concepts that add unnecessary complexity for 2D sprites. |
| Performance | Excellent for 3D; overkill for 2D. The overhead of a full 3D scene graph, matrix transforms, and depth sorting is unnecessary when everything is on a flat plane. |
| Community | Massive community. The most popular WebGL library. But most resources, examples, and help assume 3D use cases. |
| Maintenance | Very actively maintained with monthly releases. |

**Pros:**
- If we ever wanted to add 3D effects (camera tilt, perspective explosions), the infrastructure is there.
- react-three-fiber provides excellent React integration.

**Cons:**
- Conceptual overhead: PlaneGeometry + MeshBasicMaterial + Texture just to draw a sprite.
- Heavier bundle for features we will never use (3D lighting, shadows, raycasting).
- Sprite rotation requires quaternion or euler manipulation rather than simple angle assignment.

**Verdict:** Not recommended. Three.js is excellent at what it does, but using a 3D engine for a 2D game adds complexity without benefit. The bundle size penalty is also meaningful.

### Option D: Phaser

**Approach:** Use Phaser as a complete 2D game framework.

| Attribute | Details |
|---|---|
| Bundle size | ~335 KB min+gzip (full build). Custom builds can reduce to ~110-120 KB min+gzip by excluding unused modules. |
| API ergonomics | High-level game framework API. Scenes, game objects, tweens, cameras, physics, input, audio all built in. |
| Performance | Good. Uses WebGL for rendering. However, the framework overhead (physics, input, cameras) runs even if you don't need it in headless mode. |
| Community | Very large community. Extensive documentation and tutorials. |
| Maintenance | Actively maintained. Phaser 4 is in development. |

**Pros:**
- Fastest path to a working game if building a traditional browser game.
- Built-in particle systems, tweens, and cameras.

**Cons:**
- Phaser wants to own the game loop, input handling, and scene management. This conflicts with our architecture where React owns the UI and the simulation engine owns the game state.
- Difficult to run headless. Phaser is tightly coupled to its rendering pipeline.
- Largest bundle size of all options.
- Integrating Phaser inside a React app is awkward. Phaser expects to control a DOM element and manage its own lifecycle.
- We would be paying for physics, audio, input, tilemaps, and other features we do not need.

**Verdict:** Not recommended. Phaser is a great game framework, but it is too opinionated for our architecture. We need a renderer, not a framework.

### Option E: regl

**Approach:** Use regl as a functional abstraction over WebGL.

| Attribute | Details |
|---|---|
| Bundle size | ~71 KB minified, ~21 KB gzipped. |
| API ergonomics | Functional and declarative. You define "commands" (draw calls) as pure functions of state. No classes, no scene graph. Very elegant for developers who prefer functional patterns. |
| Performance | Excellent. Uses dynamic code generation and partial evaluation to eliminate almost all overhead. Near-raw-WebGL performance with a much better API. |
| Community | Moderate. ~183K weekly npm downloads. Used by Plotly, Mapbox, and other data visualization projects. |
| Maintenance | Stable but not frequently updated. Last major release (2.x) is mature. Zero dependencies. |

**Key characteristics:**
- No sprite abstraction -- you write shaders and define commands.
- No scene graph or display hierarchy.
- No built-in text rendering, particle system, or sprite batching.
- You get a clean, functional API for issuing draw calls and managing GPU state.

**Pros:**
- Very small bundle.
- Functional API is clean and composable.
- Near-raw performance.

**Cons:**
- Still requires building sprite rendering, text, and particle systems from scratch.
- Less community support for game-specific use cases.
- The functional paradigm, while elegant, adds a learning curve for WebGL newcomers.

**Verdict:** A solid middle ground between raw WebGL and a full renderer like PixiJS. Recommended only if the team is comfortable writing shaders and wants a lightweight, functional approach. For most teams, the development time savings of PixiJS outweigh regl's smaller bundle.

### Option F: TWGL.js

**Approach:** Use TWGL as a thin helper layer over raw WebGL.

| Attribute | Details |
|---|---|
| Bundle size | ~12 KB min+gzip (base), ~18 KB min+gzip (full with helpers). |
| API ergonomics | Minimal wrapper. Reduces WebGL boilerplate (program creation, buffer setup, uniform setting) but does not provide higher-level abstractions like sprites or scenes. |
| Performance | Identical to raw WebGL. TWGL adds no runtime overhead -- it is purely a convenience layer. |
| Community | Small but dedicated. Created by Gregg Tavares (former Chrome WebGL team member). |
| Maintenance | Stable, mature. Not frequently updated because it is essentially "done." |

**Pros:**
- Tiny footprint.
- Eliminates the most painful parts of raw WebGL without adding abstraction.
- Good for developers who understand WebGL but want less boilerplate.

**Cons:**
- Still requires building everything on top (sprites, text, particles, batching).
- Not a significant improvement over raw WebGL for the game-development use case.

**Verdict:** Good for WebGL utility work or data visualization, but insufficient for a game renderer without substantial custom code on top. Would pair well with regl or could be used for custom shader effects alongside a higher-level renderer.

### Option G: LittleJS

**Approach:** Use LittleJS as a tiny, batteries-included 2D game engine.

| Attribute | Details |
|---|---|
| Bundle size | ~16 KB min+gzip (entire engine). Has a js13k build that fits in 7 KB. |
| API ergonomics | Simple, immediate-mode-inspired API. Engine objects, tile rendering, particle system, input, and sound all included. |
| Performance | Fast. Hybrid WebGL2 + Canvas2D rendering. Can update and render 10,000+ objects at 60fps. |
| Community | Small but growing. Active game jam community. Created by Frank Force. |
| Maintenance | Actively maintained with regular releases. |

**Pros:**
- Incredibly small bundle size with a complete feature set.
- Built-in particle system, tile system, and simple physics.
- Designed for the exact scale of game we are building.

**Cons:**
- Small community and ecosystem.
- Owns the game loop (similar issue to Phaser, though less severe).
- Less flexible rendering pipeline than PixiJS.
- Not designed to be embedded as a renderer inside a React app.
- No React integration library.

**Verdict:** Interesting for a standalone game, but the game-loop ownership and lack of React integration make it unsuitable for our architecture.

### Comparison Table

| Library | Bundle (gzip) | Abstraction Level | Headless-Friendly | React Integration | Recommendation |
|---|---|---|---|---|---|
| Raw WebGL2 | 0 KB | None | Yes (no render needed) | Manual | No |
| **PixiJS v8** | **~130-200 KB** | **High (2D renderer)** | **Yes (just don't init)** | **@pixi/react** | **Yes** |
| Three.js | ~180 KB | High (3D engine) | Awkward | react-three-fiber | No |
| Phaser | ~335 KB | Very High (framework) | No (coupled to render) | Poor | No |
| regl | ~21 KB | Low (functional WebGL) | Yes | Manual | Maybe |
| TWGL.js | ~18 KB | Very Low (helper) | Yes | Manual | No |
| LittleJS | ~16 KB | Medium (game engine) | Partial | None | No |

---

## 2. Rendering Architecture

### 2.1 Tank Rendering: Sprite-Based vs Procedural

**Recommendation: Sprite-based with procedural fallback for debug mode.**

**Sprite-based approach (primary):**
- Pre-render or design tank body and turret as separate sprite assets (PNG or SVG rasterized to texture).
- Each robot gets a tinted/colored version of the base sprites (PixiJS supports `tint` on Sprites).
- Sprite sheets / texture atlases for all game assets (tanks, bullets, explosions, pickups) in a single texture to minimize draw calls.
- Typical sprite sizes: 32x32 or 64x64 pixels for tanks at the arena scale we need.

**Procedural approach (debug/fallback):**
- Draw tanks using PixiJS `Graphics` API: rectangles for body, line + circle for turret/barrel.
- Useful for development, debugging, and headless-with-minimal-visualization scenarios.
- No asset loading required -- renders immediately.

**Why sprites win for production:**
- Richer visual appearance with minimal code.
- GPU-friendly: texture sampling is faster than path rasterization.
- Sprite batching: PixiJS can draw all tanks in a single draw call if they share a texture atlas.
- Easier to add visual polish (shading, detail, wear effects) without code changes.

### 2.2 Handling Body + Turret Rotation

The tank has two independently rotating parts: the body (determines movement direction) and the gun turret (determines aim direction). This maps naturally to PixiJS's container hierarchy.

```
Tank (Container) - positioned at (x, y), rotated to bodyHeading
  |-- Body (Sprite) - anchor at center, no additional rotation
  |-- Turret (Sprite) - anchor at rotation point, rotated to (gunHeading - bodyHeading)
```

**Implementation approach:**

```typescript
class TankView {
  container: Container;
  bodySprite: Sprite;
  turretSprite: Sprite;

  constructor(texture: { body: Texture; turret: Texture }, color: number) {
    this.container = new Container();

    this.bodySprite = new Sprite(texture.body);
    this.bodySprite.anchor.set(0.5, 0.5);
    this.bodySprite.tint = color;

    this.turretSprite = new Sprite(texture.turret);
    this.turretSprite.anchor.set(0.5, 0.75); // pivot near base of barrel
    this.turretSprite.tint = color;

    this.container.addChild(this.bodySprite);
    this.container.addChild(this.turretSprite);
  }

  update(state: RobotState) {
    this.container.x = state.x;
    this.container.y = state.y;
    this.container.rotation = state.bodyHeading;
    // Turret rotation is relative to body
    this.turretSprite.rotation = state.gunHeading - state.bodyHeading;
  }
}
```

**Key details:**
- The `anchor` on the turret sprite is critical. It should be set so the sprite rotates around the turret's mount point on the tank body, not the sprite center.
- Body heading and gun heading are stored as absolute angles in the simulation. The turret sprite rotation is the *difference* between the two, since it inherits the container's rotation.
- PixiJS rotation is in radians.

### 2.3 Particle Effects

**Bullets:**
- Small sprites (4x4 or 8x8 pixels) or colored circles via Graphics.
- Use a `ParticleContainer` for bullets since they are numerous and homogeneous (same texture, only position/rotation/alpha differ).
- ParticleContainer avoids the overhead of full Container features and can handle thousands of particles efficiently.
- Bullet trails: render a fading line or series of small sprites behind each bullet, or use a simple shader effect.

**Explosions:**
- Sprite sheet animation: a sequence of explosion frames played rapidly.
- Alternative: procedural particle burst -- spawn 20-40 small particles with random velocities, fade out over 0.3-0.5 seconds.
- PixiJS `AnimatedSprite` handles sprite sheet animations natively.
- Screen shake: briefly offset the camera/stage position on explosion.

**Mine detonation:**
- Larger explosion effect than bullet impact.
- Expanding ring effect: a `Graphics` circle that grows and fades.
- Debris particles scattered outward.

**Scan lines (radar sweep):**
- Semi-transparent arc drawn with `Graphics`.
- Fades quickly (0.1-0.2 seconds).
- Can use a custom mesh or simple triangle fan for the scan cone.

### 2.4 Arena Rendering

**Layers (back to front):**

1. **Background** -- solid color or subtle grid pattern. A tiled sprite or a single `Graphics` fill.
2. **Grid lines** (optional) -- thin lines every N pixels for spatial reference. Draw once to a `RenderTexture` for performance.
3. **Arena boundary** -- thick border rectangle. Could be a wall texture or a simple colored rectangle.
4. **Mines** -- small sprites or colored circles placed on the ground layer.
5. **Health pickups / cookies** -- animated sprites (gentle rotation or pulse effect).
6. **Tanks** -- the tank containers described above.
7. **Bullets** -- the particle container.
8. **Effects** -- explosions, scan lines, damage indicators.
9. **UI overlay** -- health bars, names, scores.

**Implementation notes:**
- Use PixiJS `Container` instances as layers. Add them to the stage in order.
- Static layers (background, grid, boundary) should be rendered once to a `RenderTexture` and displayed as a single sprite. This eliminates per-frame draw calls for unchanging content.
- Dynamic layers (tanks, bullets, effects) are updated every frame.

### 2.5 UI Overlays

**In-canvas overlays (rendered by PixiJS):**
- Health bars: colored rectangles drawn with `Graphics`, positioned above each tank. Green-to-red gradient based on HP percentage.
- Robot names: `BitmapText` (pre-rendered font atlas) positioned above health bars. BitmapText is much faster than regular Text for frequently updated labels.
- Damage numbers: floating text that rises and fades when a robot takes damage.

**HTML overlays (rendered by React, positioned over canvas):**
- Scoreboard panel
- Robot list with detailed stats
- Speed controls (play/pause/speed slider)
- Round counter and timer

The split is intentional: game-world elements that move with entities belong in the canvas; UI panels that are static on screen belong in React DOM. This avoids the performance cost of rendering complex UI in WebGL and leverages React's strengths for interactive controls.

---

## 3. Decoupling Simulation from Rendering

This is the most critical architectural decision. The simulation engine must be completely independent of any rendering code so it can run headless at maximum speed for batch simulation (thousands of rounds).

### 3.1 Core Principle: Simulation as Pure State Machine

The simulation engine should be a pure function of state:

```
nextState = simulate(currentState, deltaTime)
```

It should have:
- No references to DOM, Canvas, WebGL, PixiJS, or any rendering code.
- No `requestAnimationFrame` calls.
- No awareness of whether it is being visualized.
- No dependencies on browser APIs (so it can run in a Web Worker).

The simulation produces state. The renderer consumes state. They never know about each other.

### 3.2 The Simulation State Interface

Define a clean interface for the state that the renderer needs:

```typescript
interface SimulationFrame {
  tick: number;
  robots: RobotState[];
  bullets: BulletState[];
  mines: MineState[];
  pickups: PickupState[];
  explosions: ExplosionEvent[];
  events: GameEvent[];  // damage dealt, robot destroyed, pickup collected, etc.
}

interface RobotState {
  id: string;
  x: number;
  y: number;
  bodyHeading: number;   // radians
  gunHeading: number;    // radians
  radarHeading: number;  // radians
  health: number;
  energy: number;
  alive: boolean;
}

interface BulletState {
  id: string;
  x: number;
  y: number;
  heading: number;
  power: number;
  ownerId: string;
}
```

### 3.3 Recording Strategy: Snapshot-Based vs Event-Based

Two approaches exist for recording a simulation so it can be replayed later.

**Approach A: Full Snapshots**

Store the complete `SimulationFrame` at every tick.

```typescript
interface SimulationRecording {
  metadata: { arena: ArenaConfig; robots: RobotConfig[]; seed: number };
  frames: SimulationFrame[];  // one per tick
}
```

| Pro | Con |
|---|---|
| Simple to implement | High memory usage: 8 robots x ~80 bytes + bullets + mines per frame x 1000+ ticks = several MB per round |
| Random access: jump to any tick instantly | Redundant data: most state does not change every tick |
| Trivial to render: just read `frames[tick]` | Serialization cost if transferring between worker and main thread |

**Approach B: Event Sourcing**

Store the initial state and a stream of events/deltas.

```typescript
interface SimulationRecording {
  metadata: { arena: ArenaConfig; robots: RobotConfig[]; seed: number };
  initialState: SimulationFrame;
  events: TimestampedEvent[];  // only what changed
}
```

| Pro | Con |
|---|---|
| Much smaller storage: only changes are recorded | Must replay from start (or nearest keyframe) to reach arbitrary tick |
| Natural fit for simulation events (damage, spawn, destroy) | More complex implementation |
| Can reconstruct any moment by replaying events | Seeking backward requires full replay from a checkpoint |

**Approach C: Hybrid (Recommended)**

Combine both: store keyframe snapshots at regular intervals (e.g., every 50 or 100 ticks) with events between keyframes.

```typescript
interface SimulationRecording {
  metadata: { arena: ArenaConfig; robots: RobotConfig[]; seed: number };
  keyframes: Map<number, SimulationFrame>;  // every N ticks
  events: TimestampedEvent[];
}
```

This gives:
- Fast random access: seek to nearest keyframe, then replay at most N events.
- Compact storage: keyframes are sparse, events are small.
- Backward seeking: jump to previous keyframe.
- This is the same pattern used by video codecs (I-frames + P-frames) and by event sourcing systems in production.

**For Robot Battle, given the small scale (8 robots, <5000 ticks per round), full snapshots (Approach A) are likely sufficient.** The data per round is roughly:

```
8 robots * 80 bytes = 640 bytes/frame
+ ~20 bullets * 40 bytes = 800 bytes/frame
+ overhead ~500 bytes/frame
= ~2 KB/frame * 3000 frames = ~6 MB per round
```

This is acceptable for single-round visualization. For batch simulation (10,000 rounds), we would not store full recordings -- just final results (scores, rankings, statistics).

### 3.4 Architecture Diagram

```
+-------------------+     SimulationFrame      +-------------------+
|                   | -----------------------> |                   |
|   Simulation      |    (state snapshots)     |    Renderer       |
|   Engine          |                          |    (PixiJS)       |
|                   |                          |                   |
|  - Pure logic     |                          |  - Reads state    |
|  - No DOM/GPU     |                          |  - Updates sprites|
|  - Runs in Worker |                          |  - Runs on main   |
|    or main thread |                          |    thread only    |
+-------------------+                          +-------------------+
        |                                              |
        |  GameEvent[]                                 |
        +--------------------------------------------->|
           (explosions, damage, etc. for VFX triggers)
```

**Three operational modes:**

1. **Real-time visualization:** Simulation runs tick-by-tick, renderer displays each frame. Simulation advances at controlled speed (1x, 2x, 4x).

2. **Replay visualization:** A completed recording is loaded. The renderer reads frames from the recording. Supports play, pause, seek, speed control.

3. **Headless batch:** Simulation runs in Web Worker(s) at maximum speed. No rendering. Only final results are reported back.

### 3.5 ECS Patterns for Game State

An Entity-Component-System (ECS) architecture is a natural fit for this kind of game:

- **Entities:** Robots, Bullets, Mines, Pickups
- **Components:** Position, Velocity, Health, Weapon, Scanner, AI
- **Systems:** MovementSystem, CollisionSystem, WeaponSystem, ScannerSystem, DamageSystem

However, given the small scale of Robot Battle (8 entities max + projectiles), a full ECS framework is likely overkill. A simpler approach works:

```typescript
class Simulation {
  state: SimulationFrame;

  tick(dt: number) {
    this.executeRobotAI();       // run each robot's program
    this.applyMovement(dt);      // update positions based on velocities
    this.moveBullets(dt);        // advance bullets
    this.checkCollisions();      // bullet-robot, robot-wall, robot-mine
    this.applyDamage();          // process hit events
    this.updatePickups();        // spawn/collect health pickups
    this.pruneDeadEntities();    // remove destroyed bullets, dead robots
  }
}
```

This is essentially an ECS without the formal framework -- systems are methods, components are properties on typed state objects.

---

## 4. React + WebGL Integration

### 4.1 Approaches

**Option A: @pixi/react (Recommended for tight React integration)**

The official React bindings for PixiJS v8, heavily inspired by react-three-fiber.

```tsx
import { Application, extend } from '@pixi/react';
import { Container, Sprite, Graphics } from 'pixi.js';

extend({ Container, Sprite, Graphics });

function Arena({ frame }: { frame: SimulationFrame }) {
  return (
    <Application width={800} height={600} background="#1a1a2e">
      <ArenaBackground />
      {frame.robots.filter(r => r.alive).map(robot => (
        <TankView key={robot.id} state={robot} />
      ))}
      {frame.bullets.map(bullet => (
        <BulletView key={bullet.id} state={bullet} />
      ))}
      <EffectsLayer events={frame.events} />
    </Application>
  );
}
```

**Pros:**
- Declarative: PixiJS objects are React components.
- Familiar mental model for React developers.
- Lifecycle management handled by React.
- The `extend` API keeps bundle small by only importing what you use.

**Cons:**
- React reconciliation overhead on every frame (mitigated by memoization and PixiJS's own diffing).
- For 60fps updates, reconciliation cost can become noticeable. Must be careful to avoid unnecessary re-renders.
- Requires React 19.

**Option B: Imperative PixiJS with React ref (Recommended for maximum performance)**

Use React only for the surrounding UI. Manage PixiJS imperatively via a canvas ref.

```tsx
function GameCanvas({ frame }: { frame: SimulationFrame }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new GameRenderer(canvasRef.current);
    return () => rendererRef.current?.destroy();
  }, []);

  useEffect(() => {
    rendererRef.current?.renderFrame(frame);
  }, [frame]);

  return <canvas ref={canvasRef} width={800} height={600} />;
}

class GameRenderer {
  private app: Application;
  private tanks: Map<string, TankView> = new Map();
  // ... pools for bullets, effects, etc.

  constructor(canvas: HTMLCanvasElement) {
    this.app = new Application();
    // Initialize with existing canvas
  }

  renderFrame(frame: SimulationFrame) {
    // Update all sprite positions from state
    for (const robot of frame.robots) {
      this.getTank(robot.id).update(robot);
    }
    // Update bullets, effects, etc.
    this.app.render();
  }
}
```

**Pros:**
- Zero React reconciliation overhead for game rendering.
- Full control over the render loop.
- Easier to optimize (object pooling, manual dirty tracking).
- Simpler mental model: React handles UI, PixiJS handles canvas.

**Cons:**
- More code to manage object lifecycle (creating/destroying sprites as entities appear/disappear).
- Must implement own object pooling for bullets and particles.
- Two different paradigms in one app (React declarative + PixiJS imperative).

**Recommendation:** Use **Option B (imperative)** for the game canvas. The game renderer is a performance-critical, rapidly-updating component that benefits from direct control. React excels at UI panels, not at 60fps game rendering. Wrap the imperative renderer in a single React component that acts as the bridge.

### 4.2 Layout Architecture

```
+----------------------------------------------------------+
|  React App                                                |
|  +---------------------+  +----------------------------+ |
|  |  Sidebar (React)    |  |  Game Canvas (WebGL)       | |
|  |                     |  |                            | |
|  |  - Robot list       |  |  [PixiJS manages this]     | |
|  |  - Health/energy    |  |                            | |
|  |  - Code editor      |  |  Arena, tanks, bullets,    | |
|  |    toggle           |  |  effects all rendered here | |
|  |                     |  |                            | |
|  +---------------------+  +----------------------------+ |
|  +-----------------------------------------------------+ |
|  |  Controls Bar (React)                                | |
|  |  [ Play ] [ Pause ] [ 1x ] [ 2x ] [ 4x ] [ Step ]  | |
|  |  [ Round: 1/100 ]  [ Tick: 342/3000 ]               | |
|  +-----------------------------------------------------+ |
+----------------------------------------------------------+
```

React owns the overall layout, sidebar, and controls. The WebGL canvas is a single React component that internally manages all PixiJS rendering. Communication is one-way: React passes the current `SimulationFrame` down; the canvas component renders it.

### 4.3 Managing the Render Loop Outside React

The game render loop should not be driven by React state updates. Instead:

```typescript
// In the imperative renderer
class GameRenderer {
  private animationFrameId: number = 0;
  private currentFrame: SimulationFrame | null = null;
  private previousFrame: SimulationFrame | null = null;
  private interpolationAlpha: number = 0;

  start() {
    const loop = () => {
      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.animationFrameId);
  }

  // Called by React when new simulation state is available
  setFrame(frame: SimulationFrame, alpha: number = 1) {
    this.previousFrame = this.currentFrame;
    this.currentFrame = frame;
    this.interpolationAlpha = alpha;
  }

  private render() {
    if (!this.currentFrame) return;
    // Interpolate between previousFrame and currentFrame using alpha
    // Update all PixiJS display objects
    // Render
  }
}
```

React sets the frame data; the renderer's own `requestAnimationFrame` loop handles smooth rendering. This decouples React's update cycle from the render cycle entirely.

---

## 5. Performance for Batch Simulation

### 5.1 Web Workers for Headless Simulation

When running 10,000 rounds for tournament scoring, the simulation must not block the UI. Web Workers are the solution.

**Architecture:**

```
Main Thread (React UI)
  |
  | postMessage({ type: 'START_BATCH', config })
  v
Worker Thread (Simulation)
  |
  | Runs rounds sequentially or in chunks
  | postMessage({ type: 'PROGRESS', completed: 500, total: 10000 })
  | postMessage({ type: 'ROUND_RESULT', round: 500, scores: {...} })
  | ...
  | postMessage({ type: 'BATCH_COMPLETE', results: {...} })
  v
Main Thread (updates progress bar, displays results)
```

**Basic Worker setup:**

```typescript
// simulation.worker.ts
self.onmessage = (event: MessageEvent) => {
  const { type, config } = event.data;

  if (type === 'START_BATCH') {
    const results = [];
    for (let i = 0; i < config.totalRounds; i++) {
      const result = runSimulation(config);
      results.push(result);

      // Report progress every N rounds
      if (i % 100 === 0) {
        self.postMessage({
          type: 'PROGRESS',
          completed: i,
          total: config.totalRounds
        });
      }
    }
    self.postMessage({ type: 'BATCH_COMPLETE', results });
  }
};
```

**From React:**

```typescript
const worker = new Worker(
  new URL('./simulation.worker.ts', import.meta.url),
  { type: 'module' }
);

worker.onmessage = (event) => {
  switch (event.data.type) {
    case 'PROGRESS':
      setProgress(event.data.completed / event.data.total);
      break;
    case 'BATCH_COMPLETE':
      setResults(event.data.results);
      break;
  }
};

worker.postMessage({ type: 'START_BATCH', config: tournamentConfig });
```

### 5.2 Parallel Simulation Across Multiple Workers

For maximum throughput, distribute rounds across multiple workers:

```typescript
const WORKER_COUNT = navigator.hardwareConcurrency || 4;

function runParallelBatch(config: BatchConfig): Promise<BatchResults> {
  const roundsPerWorker = Math.ceil(config.totalRounds / WORKER_COUNT);
  const workers: Worker[] = [];
  const promises: Promise<RoundResult[]>[] = [];

  for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(
      new URL('./simulation.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workers.push(worker);

    const startRound = i * roundsPerWorker;
    const endRound = Math.min(startRound + roundsPerWorker, config.totalRounds);

    promises.push(new Promise((resolve) => {
      worker.onmessage = (event) => {
        if (event.data.type === 'BATCH_COMPLETE') {
          resolve(event.data.results);
          worker.terminate();
        }
        if (event.data.type === 'PROGRESS') {
          // Aggregate progress across workers
          updateWorkerProgress(i, event.data.completed);
        }
      };
      worker.postMessage({
        type: 'START_BATCH',
        config: { ...config, startRound, endRound }
      });
    }));
  }

  return Promise.all(promises).then(resultArrays => {
    return aggregateResults(resultArrays.flat());
  });
}
```

**Expected performance gains:**
- On an 8-core machine, ~4-6x speedup (not full 8x due to overhead and main thread contention).
- Each worker runs its rounds independently -- no shared state needed between workers.
- Progress reporting: each worker reports independently; main thread aggregates.

### 5.3 SharedArrayBuffer Considerations

SharedArrayBuffer allows zero-copy data sharing between threads. However, for Robot Battle:

**When SharedArrayBuffer is useful:**
- Sharing large, frequently-updated data between simulation and rendering threads.
- When the overhead of `postMessage` serialization becomes a bottleneck.

**When it is NOT needed (our case for batch mode):**
- Each worker runs independently. No shared data between workers.
- Results are small (final scores per round). `postMessage` is sufficient.
- The serialization cost of posting a small results object is negligible.

**When it IS useful (our case for real-time visualization):**
- If simulation runs in a worker and we want to share the current frame with the main thread for rendering.
- A SharedArrayBuffer holding the current SimulationFrame avoids copying ~2 KB per tick.
- However, the complexity of manual memory layout, Atomics for synchronization, and the required security headers (Cross-Origin-Opener-Policy, Cross-Origin-Embedder-Policy) may not be worth it for ~2 KB/tick.

**Recommendation:** Use plain `postMessage` with Transferable objects (ArrayBuffers) for worker communication. The data sizes in Robot Battle are small enough that the copy overhead is negligible. Reserve SharedArrayBuffer for a future optimization if profiling shows worker communication as a bottleneck.

**Security headers required for SharedArrayBuffer:**
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
These headers restrict which resources can be loaded, which may complicate CDN usage and third-party script inclusion.

### 5.4 Progress Reporting

For 10,000 rounds, provide meaningful progress feedback:

```typescript
// Worker side: report every 1% or every 100 rounds, whichever is less frequent
const REPORT_INTERVAL = Math.max(1, Math.floor(totalRounds / 100));

for (let i = 0; i < totalRounds; i++) {
  results.push(runSimulation(config));
  if (i % REPORT_INTERVAL === 0) {
    self.postMessage({
      type: 'PROGRESS',
      completed: i + 1,
      total: totalRounds,
      elapsedMs: performance.now() - startTime,
      estimatedRemainingMs: /* calculate from rate */
    });
  }
}
```

On the React side, display:
- Progress bar (completed / total)
- Estimated time remaining
- Rounds per second throughput
- Partial results (running averages, current standings)

---

## 6. Visual Design Inspiration

### 6.1 Classic RoboCode Aesthetics

The original RoboCode (Java, 2001) established the visual language for robot battle games:
- Top-down 2D view
- Simple colored rectangles for tank bodies
- Rotating turret line on top
- Colored radar sweep arc
- Bullet trails as small dots
- Explosion effects as expanding circles
- Minimal UI with health bars and names

The aesthetic is functional rather than decorative. This is appropriate for a programming game where the focus is on the code, not the graphics.

### 6.2 Modern Minimalist 2D Game Aesthetics

For a contemporary look, consider these design directions:

**Direction A: Clean vector style**
- Solid colors with subtle gradients
- Sharp geometric shapes for tanks
- Glowing particle effects for bullets and explosions
- Dark background (deep navy or charcoal) with high-contrast game elements
- Inspired by games like Geometry Wars, Neon Chrome, or tron-style aesthetics
- Color palette: dark background (#0f0f1a), neon accents per robot (8 distinct hues)

**Direction B: Pixel art / retro**
- Small pixel sprites (16x16 or 32x32)
- Limited color palette per robot
- Sprite-sheet explosions
- Nostalgic, lightweight, easy to create
- Good for a programming-focused game where art is secondary

**Direction C: Technical/schematic**
- Blueprint-style background with grid
- Robots as technical drawings / schematics
- Scan lines and trajectories drawn as dotted lines
- HUD-style overlays with data readouts
- Fits the "programming" theme well

**Recommendation: Direction A (clean vector) with elements of Direction C (technical).** Dark background, geometric tanks with glowing accents, crisp particle effects, and a subtle grid on the arena floor. This looks modern, is achievable with PixiJS procedural drawing + simple sprites, and fits the programming game aesthetic.

### 6.3 Essential Visual Feedback

These visual elements are necessary for players to understand what is happening:

| Element | Priority | Implementation |
|---|---|---|
| Tank body rotation | Critical | Sprite or geometric shape rotating |
| Turret aim direction | Critical | Separate sprite rotating independently |
| Bullet position and trajectory | Critical | Small bright sprite, optional fading trail |
| Health bars | Critical | Colored bar above each tank |
| Explosion on bullet hit | High | Expanding particle burst, 0.3s duration |
| Robot death explosion | High | Larger burst with debris particles |
| Damage flash | High | Brief white tint on hit tank (1-2 frames) |
| Mine placement / detonation | High | Pulsing sprite for mine, large explosion on detonate |
| Radar scan arc | Medium | Semi-transparent cone/arc, fades quickly |
| Energy level indicator | Medium | Secondary bar or numeric display |
| Bullet power visualization | Medium | Bullet size/brightness varies with power |
| Scan detection highlight | Medium | Brief highlight on detected robot |
| Wall collision effect | Low | Small spark/flash at point of impact |
| Movement trail | Low | Fading trail behind moving tanks |
| Arena grid | Low | Subtle grid for spatial reference |
| Kill notifications | Medium | Text popup "RobotA destroyed RobotB" |

### 6.4 Color Assignment

With up to 8 robots, each needs a distinct, easily identifiable color:

```typescript
const ROBOT_COLORS = [
  0xFF4444, // Red
  0x4488FF, // Blue
  0x44FF44, // Green
  0xFFDD44, // Yellow
  0xFF44FF, // Magenta
  0x44FFFF, // Cyan
  0xFF8844, // Orange
  0xAA44FF, // Purple
];
```

These should be high-saturation, high-value colors that stand out against a dark background and are distinguishable from each other, including for common forms of color vision deficiency.

---

## 7. Animation and Interpolation

### 7.1 Fixed Timestep Simulation with Render Interpolation

The simulation runs at a fixed timestep (deterministic). The renderer runs at the display refresh rate (typically 60fps). These are unlikely to be exactly in sync, so interpolation is needed for smooth visuals.

**The fixed timestep game loop:**

```typescript
class GameLoop {
  private readonly TICK_RATE = 30;  // simulation ticks per second
  private readonly TICK_DURATION = 1000 / this.TICK_RATE;  // ~33.3ms

  private accumulator = 0;
  private lastTimestamp = 0;
  private currentFrame: SimulationFrame;
  private previousFrame: SimulationFrame;

  constructor(
    private simulation: Simulation,
    private renderer: GameRenderer
  ) {}

  start() {
    this.lastTimestamp = performance.now();
    this.loop(this.lastTimestamp);
  }

  private loop = (timestamp: number) => {
    const deltaTime = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    // Clamp delta to avoid spiral of death
    const clampedDelta = Math.min(deltaTime, this.TICK_DURATION * 5);
    this.accumulator += clampedDelta;

    // Run simulation ticks
    while (this.accumulator >= this.TICK_DURATION) {
      this.previousFrame = this.currentFrame;
      this.currentFrame = this.simulation.tick(this.TICK_DURATION);
      this.accumulator -= this.TICK_DURATION;
    }

    // Calculate interpolation alpha (0.0 to 1.0)
    const alpha = this.accumulator / this.TICK_DURATION;

    // Render interpolated state
    this.renderer.renderInterpolated(this.previousFrame, this.currentFrame, alpha);

    requestAnimationFrame(this.loop);
  };
}
```

### 7.2 Interpolation Implementation

For smooth rendering between simulation ticks:

```typescript
class GameRenderer {
  renderInterpolated(
    prev: SimulationFrame,
    curr: SimulationFrame,
    alpha: number
  ) {
    for (const robot of curr.robots) {
      const prevRobot = prev.robots.find(r => r.id === robot.id);
      if (!prevRobot) continue;

      const view = this.tankViews.get(robot.id);
      if (!view) continue;

      // Linear interpolation for position
      view.container.x = lerp(prevRobot.x, robot.x, alpha);
      view.container.y = lerp(prevRobot.y, robot.y, alpha);

      // Angular interpolation for rotation (handles wraparound)
      view.container.rotation = lerpAngle(
        prevRobot.bodyHeading, robot.bodyHeading, alpha
      );
      view.turretSprite.rotation = lerpAngle(
        prevRobot.gunHeading - prevRobot.bodyHeading,
        robot.gunHeading - robot.bodyHeading,
        alpha
      );
    }

    // Interpolate bullets similarly
    // ...

    this.app.render();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  // Shortest path interpolation for angles
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}
```

**Key considerations:**
- `lerpAngle` is essential. Naive lerp between 350 degrees and 10 degrees would go the long way around. The angle-aware version takes the shortest path.
- Position interpolation assumes constant velocity between ticks. This is accurate for our simulation since robots and bullets move linearly between ticks.
- Newly spawned entities (bullets, explosions) should appear at their current position without interpolation from (0,0).
- Dead entities should play a death animation rather than abruptly disappearing.

### 7.3 Speed Controls

Support variable playback speed for real-time and replay modes:

```typescript
class GameLoop {
  private speedMultiplier = 1; // 1x, 2x, 4x, 8x
  private paused = false;
  private stepRequested = false;

  setSpeed(multiplier: number) {
    this.speedMultiplier = multiplier;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  step() {
    // Advance exactly one simulation tick
    this.stepRequested = true;
  }

  private loop = (timestamp: number) => {
    const deltaTime = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    if (!this.paused || this.stepRequested) {
      const scaledDelta = this.stepRequested
        ? this.TICK_DURATION  // exactly one tick
        : deltaTime * this.speedMultiplier;

      this.stepRequested = false;
      const clampedDelta = Math.min(scaledDelta, this.TICK_DURATION * 10);
      this.accumulator += clampedDelta;

      while (this.accumulator >= this.TICK_DURATION) {
        this.previousFrame = this.currentFrame;
        this.currentFrame = this.simulation.tick(this.TICK_DURATION);
        this.accumulator -= this.TICK_DURATION;
      }
    }

    const alpha = this.paused ? 1 : this.accumulator / this.TICK_DURATION;
    this.renderer.renderInterpolated(
      this.previousFrame, this.currentFrame, alpha
    );

    requestAnimationFrame(this.loop);
  };
}
```

**Speed implementation notes:**
- At 1x speed with 30 tick/s simulation, each tick displays for ~1 frame at 30fps or ~2 frames at 60fps.
- At 4x speed, 4 simulation ticks run per frame. At very high speeds (16x+), consider skipping the render and only showing every Nth frame.
- The "step" button advances exactly one tick and pauses. Essential for debugging robot behavior.
- For replay mode, the simulation is already complete. The game loop simply reads frames from the recording rather than running the simulation.

### 7.4 Replay Mode Architecture

```typescript
class ReplayController {
  private recording: SimulationRecording;
  private currentTick = 0;
  private playbackSpeed = 1;

  constructor(recording: SimulationRecording) {
    this.recording = recording;
  }

  getFrame(tick: number): SimulationFrame {
    return this.recording.frames[
      Math.min(tick, this.recording.frames.length - 1)
    ];
  }

  seek(tick: number) {
    this.currentTick = Math.max(0,
      Math.min(tick, this.recording.frames.length - 1)
    );
  }

  get totalTicks(): number {
    return this.recording.frames.length;
  }

  // Integrates with the same GameLoop but replaces simulation.tick()
  // with recording frame reads
}
```

The replay controller exposes the same `SimulationFrame` interface as the live simulation, so the renderer does not need to know whether it is displaying live or recorded data.

---

## 8. Recommendation Summary

### Rendering Library: PixiJS v8

PixiJS is the clear winner for this project. It provides:
- Purpose-built 2D rendering with sprites, containers, particles, and text
- Excellent performance via WebGL2 batching
- Container hierarchy for tank body + turret rotation
- ParticleContainer for high-performance bullet/effect rendering
- Tree-shakeable imports for bundle size control
- Active maintenance and large community
- Official React bindings (@pixi/react)

### Architecture: Imperative Renderer in React Shell

- React manages the UI (sidebar, controls, code editor, scoreboard).
- A single `<GameCanvas>` React component wraps an imperative PixiJS renderer.
- The renderer receives `SimulationFrame` objects and updates display objects directly.
- No React reconciliation inside the render loop.

### Simulation Decoupling: Pure State Machine + Snapshots

- Simulation engine is a pure state machine with no rendering dependencies.
- Outputs `SimulationFrame` objects consumed by the renderer.
- Full snapshot recording for single-round replay (simple, ~6 MB/round).
- For batch mode, only final results are stored.

### Batch Execution: Parallel Web Workers

- Use `navigator.hardwareConcurrency` workers for parallel round execution.
- Plain `postMessage` for communication (data is small).
- Progress reporting every 1% of total rounds.
- Expected throughput: thousands of rounds per minute on modern hardware.

### Render Loop: Fixed Timestep + Interpolation

- 30 tick/s simulation rate (deterministic).
- `requestAnimationFrame` render loop with interpolation for smooth 60fps visuals.
- Speed controls: pause, step, 1x, 2x, 4x, 8x.
- Angle-aware interpolation for rotations.

### Visual Style: Modern Minimalist

- Dark background with geometric tanks and glowing accents.
- 8 distinct robot colors, high contrast.
- Sprite-based tanks with separate body and turret.
- Particle effects for bullets, explosions, and scans.
- HTML overlays for UI panels (React-rendered).
- In-canvas health bars and names (PixiJS-rendered).

### Key Dependencies

| Package | Purpose | Estimated Bundle Impact |
|---|---|---|
| `pixi.js` (v8) | 2D WebGL rendering | ~130-200 KB gzip (with tree-shaking) |
| `@pixi/react` | React integration (optional) | ~5-10 KB gzip |

No other rendering dependencies are needed. The simulation engine has zero browser dependencies and runs anywhere JavaScript runs.
