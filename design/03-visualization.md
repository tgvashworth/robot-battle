# Visualization Layer Design: Robot Battle

## Table of Contents

1. [Renderer's Input Interface](#1-renderers-input-interface)
2. [PixiJS Renderer Architecture](#2-pixijs-renderer-architecture)
3. [Interpolation and Animation](#3-interpolation-and-animation)
4. [Visual Effects](#4-visual-effects)
5. [React Application Structure](#5-react-application-structure)
6. [Responsive Design and Canvas Sizing](#6-responsive-design-and-canvas-sizing)
7. [The Tutorial System](#7-the-tutorial-system)
8. [Project Structure](#8-project-structure)
9. [Trade-offs and Decisions](#9-trade-offs-and-decisions)

---

## 1. Renderer's Input Interface

The renderer is a pure consumer of game state. It has zero knowledge of WASM, the
compiler, the simulation engine's internals, or how robot code executes. The only
coupling point is the `FrameData` interface defined below. This is the renderer's
"wish list" -- the shape of data it needs each tick to draw everything.

### 1.1 FrameData: The Per-Tick Contract

```typescript
/**
 * Complete data needed to render one simulation tick.
 * Produced by the simulation engine, consumed by the renderer.
 */
interface FrameData {
  /** Current simulation tick number (0-based, monotonically increasing). */
  tick: number;

  /** Total ticks in this round (e.g. 2000). Used for progress display. */
  totalTicks: number;

  /** Arena dimensions in simulation units. */
  arena: {
    width: number;   // e.g. 800
    height: number;  // e.g. 600
  };

  /** Current state of every robot (alive or dead). */
  robots: RobotFrameState[];

  /** Current state of every active bullet. */
  bullets: BulletFrameState[];

  /** Current state of every mine on the field. */
  mines: MineFrameState[];

  /** Current state of every cookie on the field. */
  cookies: CookieFrameState[];

  /** Events that occurred THIS tick. Used to trigger visual effects. */
  events: GameEvent[];
}
```

### 1.2 Entity State Interfaces

```typescript
interface RobotFrameState {
  id: string;
  name: string;
  /** Position in arena coordinates. */
  x: number;
  y: number;
  /** Body heading in radians, 0 = right, increasing counter-clockwise. */
  bodyHeading: number;
  /** Gun turret heading in radians (absolute, not relative to body). */
  gunHeading: number;
  /** Radar dish heading in radians (absolute, not relative to body). */
  radarHeading: number;
  /** Current health points. 0 = dead. */
  health: number;
  /** Maximum health (default 100, can exceed with cookies up to 130). */
  maxHealth: number;
  /** Current energy for firing. */
  energy: number;
  /** Maximum energy. */
  maxEnergy: number;
  /** Current speed in units/tick. Used for motion trails. */
  speed: number;
  /** Whether the robot is alive. Dead robots stay in the array for the
   *  death animation but with alive=false. */
  alive: boolean;
  /** Assigned color as a hex number (e.g. 0xFF4444). */
  color: number;
  /** Gun heat. 0 = can fire. Renderer can use this for a barrel glow. */
  gunHeat: number;
}

interface BulletFrameState {
  id: string;
  x: number;
  y: number;
  /** Heading in radians (direction of travel). */
  heading: number;
  /** Firepower 0.1-3.0. Determines bullet size and explosion intensity. */
  power: number;
  /** ID of the robot that fired this bullet. Used for color matching. */
  ownerId: string;
}

interface MineFrameState {
  id: string;
  x: number;
  y: number;
  /** Whether the mine is still active (not yet detonated). */
  active: boolean;
}

interface CookieFrameState {
  id: string;
  x: number;
  y: number;
  /** Whether the cookie is still active (not yet collected). */
  active: boolean;
}
```

### 1.3 Event Types

Events trigger one-shot visual effects. They carry enough data for the renderer
to place and scale the effect without needing to look up entity state.

```typescript
type GameEvent =
  | BulletFiredEvent
  | BulletHitEvent
  | BulletWallHitEvent
  | RobotDeathEvent
  | RobotCollisionEvent
  | WallHitEvent
  | ScanEvent
  | MineDetonationEvent
  | CookiePickupEvent
  | CookieSpawnEvent
  | MineSpawnEvent
  | DamageEvent;

interface BulletFiredEvent {
  type: 'bullet_fired';
  /** Position of gun muzzle at moment of firing. */
  x: number;
  y: number;
  heading: number;
  power: number;
  robotId: string;
}

interface BulletHitEvent {
  type: 'bullet_hit';
  /** Impact position. */
  x: number;
  y: number;
  /** Bullet power determines explosion size. */
  power: number;
  /** Robot that was hit. */
  targetId: string;
  /** Robot that fired. */
  shooterId: string;
  /** Damage dealt. */
  damage: number;
}

interface BulletWallHitEvent {
  type: 'bullet_wall_hit';
  x: number;
  y: number;
  power: number;
}

interface RobotDeathEvent {
  type: 'robot_death';
  robotId: string;
  x: number;
  y: number;
  /** Who killed them, if applicable. */
  killerId?: string;
}

interface RobotCollisionEvent {
  type: 'robot_collision';
  robotAId: string;
  robotBId: string;
  x: number;
  y: number;
}

interface WallHitEvent {
  type: 'wall_hit';
  robotId: string;
  x: number;
  y: number;
  /** Speed at impact -- determines spark intensity. */
  impactSpeed: number;
}

interface ScanEvent {
  type: 'scan';
  /** Robot performing the scan. */
  robotId: string;
  /** Origin of the scan arc. */
  x: number;
  y: number;
  /** Center direction of the scan arc in radians. */
  heading: number;
  /** Half-width of the scan arc in radians (e.g. 5 degrees = ~0.087). */
  arcHalfWidth: number;
  /** Maximum scan range in arena units. */
  range: number;
  /** Whether the scan detected an enemy. Affects visual intensity. */
  hitDetected: boolean;
}

interface MineDetonationEvent {
  type: 'mine_detonation';
  mineId: string;
  x: number;
  y: number;
  /** Robot that triggered the mine. */
  robotId: string;
}

interface CookiePickupEvent {
  type: 'cookie_pickup';
  cookieId: string;
  x: number;
  y: number;
  robotId: string;
}

interface CookieSpawnEvent {
  type: 'cookie_spawn';
  cookieId: string;
  x: number;
  y: number;
}

interface MineSpawnEvent {
  type: 'mine_spawn';
  mineId: string;
  x: number;
  y: number;
}

interface DamageEvent {
  type: 'damage';
  robotId: string;
  amount: number;
  x: number;
  y: number;
  /** Source of damage for display. */
  source: 'bullet' | 'mine' | 'wall' | 'collision';
}
```

### 1.4 Design Notes on the Interface

**What the renderer needs vs what the simulation tracks.** The simulation
internally tracks acceleration, turn rates, gun cooldown curves, energy
regeneration formulas, and other mechanical state. The renderer does not need any
of that. It receives the resolved positions, angles, and health values after all
simulation logic has executed.

**Scan arc geometry.** The simulation knows the radar heading, arc width, and
range. It emits this as a `ScanEvent` so the renderer can draw the translucent
sweep. The renderer does not compute scan intersections -- it just draws the
shape.

**Dead robots.** Dead robots remain in the `robots` array with `alive: false`
for the duration of the death animation (roughly 60 frames / 1 second). The
simulation can remove them afterward, or keep them. The renderer ignores
`alive: false` robots after the death animation completes.

**Entity lifecycle.** Bullets, mines, and cookies appear in the arrays when they
exist and disappear when they are destroyed or collected. The renderer creates
and recycles display objects accordingly. Events signal the transitions (spawn,
hit, pickup) so the renderer can trigger effects at the right moment.

---

## 2. PixiJS Renderer Architecture

### 2.1 Layer Hierarchy (Draw Order)

Layers are PixiJS `Container` instances added to the stage in back-to-front
order. Each layer contains only the display objects appropriate for its depth.

```
Stage (Application.stage)
  |
  |-- Layer 0: backgroundLayer (Container)
  |     Arena floor, grid lines, arena border.
  |     Rendered once to a RenderTexture on init and on resize.
  |
  |-- Layer 1: groundLayer (Container)
  |     Mines and cookies. Sit on the arena floor.
  |
  |-- Layer 2: scanArcLayer (Container)
  |     Translucent radar sweep arcs. Brief lifespan, fade out.
  |     Drawn below robots so they don't obscure the action.
  |
  |-- Layer 3: robotLayer (Container)
  |     Robot containers (body + gun + radar sprites). One per robot.
  |
  |-- Layer 4: bulletLayer (Container)
  |     Bullet sprites. Drawn above robots so they are always visible.
  |
  |-- Layer 5: effectLayer (Container)
  |     Explosions, hit flashes, sparks, muzzle flashes.
  |     Short-lived effects drawn on top of everything.
  |
  |-- Layer 6: uiOverlayLayer (Container)
  |     Health bars, robot name labels, damage numbers.
  |     Always on top. Positioned in world coordinates (follow robots).
  |
  |-- Layer 7: hudLayer (Container)
  |     Tick counter, round number, FPS counter.
  |     Positioned in screen coordinates (does not move with camera).
```

### 2.2 Robot Sprite Design

Each robot is a `Container` with three independently-rotating child sprites:
body, gun turret, and radar dish.

**Container hierarchy and rotation strategy:**

```
RobotContainer (Container)
  position: (x, y) from RobotFrameState
  rotation: 0 (container itself does not rotate)
  |
  |-- bodySprite (Sprite)
  |     anchor: (0.5, 0.5)
  |     rotation: bodyHeading (absolute, from state)
  |     tint: robot color
  |
  |-- gunSprite (Sprite)
  |     anchor: (0.5, 0.75) -- pivot near base of barrel
  |     rotation: gunHeading (absolute, from state)
  |     tint: robot color (slightly lighter shade)
  |
  |-- radarSprite (Sprite)
  |     anchor: (0.5, 0.5)
  |     rotation: radarHeading (absolute, from state)
  |     tint: robot color (translucent)
```

**Why the container does not rotate:** All three parts rotate independently and
their headings are absolute (not relative to each other). If the container
rotated to `bodyHeading`, the gun and radar would need to be set to
`gunHeading - bodyHeading` and `radarHeading - bodyHeading` respectively. This
works but adds unnecessary coupling. By keeping the container at rotation 0 and
setting each sprite to its absolute heading, the code is simpler and each
rotation is independent.

**Sprite assets (procedural, generated at startup):**

The robot sprites are drawn procedurally using the PixiJS `Graphics` API at
startup, then cached as textures. This eliminates the need for an asset pipeline
and produces resolution-independent results.

```typescript
function createBodyTexture(renderer: Renderer, size: number): Texture {
  const g = new Graphics();
  // Rounded rectangle for tank body, pointing right (0 radians)
  g.roundRect(-size / 2, -size / 2, size, size, 4);
  g.fill({ color: 0xFFFFFF }); // White base, tinted per robot
  // Tread marks
  g.rect(-size / 2, -size / 2, size, 3);
  g.fill({ color: 0xCCCCCC });
  g.rect(-size / 2, size / 2 - 3, size, 3);
  g.fill({ color: 0xCCCCCC });
  return renderer.generateTexture(g);
}

function createGunTexture(renderer: Renderer, size: number): Texture {
  const g = new Graphics();
  // Circular turret base
  g.circle(0, 0, size * 0.3);
  g.fill({ color: 0xFFFFFF });
  // Barrel extending to the right
  g.rect(0, -size * 0.08, size * 0.55, size * 0.16);
  g.fill({ color: 0xFFFFFF });
  return renderer.generateTexture(g);
}

function createRadarTexture(renderer: Renderer, size: number): Texture {
  const g = new Graphics();
  // Small dish shape
  g.moveTo(0, 0);
  g.arc(0, 0, size * 0.45, -0.25, 0.25);
  g.lineTo(0, 0);
  g.fill({ color: 0xFFFFFF, alpha: 0.4 });
  return renderer.generateTexture(g);
}
```

**Color tinting for 8 robots:**

```typescript
const ROBOT_COLORS: readonly number[] = [
  0xFF4444, // Red
  0x4488FF, // Blue
  0x44DD44, // Green
  0xFFDD44, // Yellow
  0xFF44FF, // Magenta
  0x44FFFF, // Cyan
  0xFF8844, // Orange
  0xAA44FF, // Purple
] as const;
```

Each sprite is created with a white base texture and tinted at runtime using
PixiJS's `tint` property. The gun sprite uses a lighter shade
(`lightenColor(color, 0.3)`) for visual distinction from the body.

### 2.3 Object Pooling

Frequently created/destroyed entities use object pools to avoid GC pressure.

**BulletPool:**

Bullets are created when robots fire and destroyed on impact or wall collision.
In an 8-robot battle, there can be 20-30 active bullets at peak. Bullets are
visually homogeneous (same shape, different color tint) and are perfect pool
candidates.

```typescript
class BulletPool {
  private pool: Sprite[] = [];
  private active: Map<string, Sprite> = new Map();
  private parent: Container;
  private texture: Texture;

  constructor(parent: Container, texture: Texture, initialSize: number = 32) {
    this.parent = parent;
    this.texture = texture;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.createSprite());
    }
  }

  acquire(id: string, state: BulletFrameState, ownerColor: number): Sprite {
    const sprite = this.pool.pop() ?? this.createSprite();
    sprite.visible = true;
    sprite.x = state.x;
    sprite.y = state.y;
    sprite.rotation = state.heading;
    sprite.tint = ownerColor;
    // Scale by power: min 0.5x, max 1.5x
    const scale = 0.5 + (state.power / 3.0);
    sprite.scale.set(scale);
    this.parent.addChild(sprite);
    this.active.set(id, sprite);
    return sprite;
  }

  release(id: string): void {
    const sprite = this.active.get(id);
    if (!sprite) return;
    sprite.visible = false;
    this.parent.removeChild(sprite);
    this.active.delete(id);
    this.pool.push(sprite);
  }

  getActive(id: string): Sprite | undefined {
    return this.active.get(id);
  }

  private createSprite(): Sprite {
    const s = new Sprite(this.texture);
    s.anchor.set(0.5);
    s.visible = false;
    return s;
  }
}
```

**EffectPool:**

Explosions, sparks, and muzzle flashes are short-lived effects. A single pool
manages all effect types by tracking each effect's type, remaining lifetime, and
update function.

```typescript
interface ActiveEffect {
  container: Container;
  type: string;
  lifetime: number;
  maxLifetime: number;
  update: (progress: number) => void; // progress: 0..1
}

class EffectPool {
  private pool: Container[] = [];
  private active: ActiveEffect[] = [];
  private parent: Container;

  spawn(type: string, lifetime: number, setup: (c: Container) => (progress: number) => void): void {
    const container = this.pool.pop() ?? new Container();
    container.visible = true;
    container.removeChildren();
    this.parent.addChild(container);
    const updateFn = setup(container);
    this.active.push({ container, type, lifetime, maxLifetime: lifetime, update: updateFn });
  }

  tick(): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i]!;
      effect.lifetime--;
      const progress = 1 - (effect.lifetime / effect.maxLifetime);
      effect.update(progress);
      if (effect.lifetime <= 0) {
        effect.container.visible = false;
        this.parent.removeChild(effect.container);
        this.pool.push(effect.container);
        this.active.splice(i, 1);
      }
    }
  }
}
```

**Mines and cookies:** These appear and disappear infrequently (a few per round).
Direct create/destroy is acceptable -- no pool needed.

### 2.4 The BattleRenderer Class

```typescript
interface ArenaConfig {
  width: number;
  height: number;
}

interface RenderOptions {
  /** Show grid lines on the arena floor. Default true. */
  showGrid: boolean;
  /** Show floating damage numbers. Default true. */
  showDamageNumbers: boolean;
  /** Show radar scan arcs. Default true. */
  showScanArcs: boolean;
  /** Background color. Default 0x111118. */
  backgroundColor: number;
}

class BattleRenderer {
  private app: Application;
  private layers: {
    background: Container;
    ground: Container;
    scanArc: Container;
    robot: Container;
    bullet: Container;
    effect: Container;
    uiOverlay: Container;
    hud: Container;
  };
  private robotViews: Map<string, RobotView> = new Map();
  private bulletPool: BulletPool;
  private effectPool: EffectPool;
  private mineViews: Map<string, Sprite> = new Map();
  private cookieViews: Map<string, Sprite> = new Map();
  private options: RenderOptions;

  // Coordinate mapping
  private scale: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private arenaConfig: ArenaConfig;

  // Interpolation state
  private prevFrame: FrameData | null = null;
  private currFrame: FrameData | null = null;

  constructor(canvas: HTMLCanvasElement, arenaConfig: ArenaConfig, options?: Partial<RenderOptions>);

  /**
   * Initialize the PixiJS application. Must be called once before update().
   * Async because PixiJS v8 Application.init() is async.
   */
  async init(): Promise<void>;

  /**
   * Push a new simulation frame. The renderer holds the previous frame
   * for interpolation. Call this once per simulation tick.
   */
  pushFrame(frame: FrameData): void;

  /**
   * Render an interpolated frame. Called by requestAnimationFrame.
   * @param alpha Interpolation factor between prevFrame and currFrame (0..1).
   */
  render(alpha: number): void;

  /**
   * Handle canvas resize. Recomputes coordinate scaling.
   */
  resize(canvasWidth: number, canvasHeight: number): void;

  /**
   * Update render options at runtime (toggle grid, damage numbers, etc).
   */
  setOptions(options: Partial<RenderOptions>): void;

  /**
   * Clean up all PixiJS resources.
   */
  destroy(): void;

  // ---- Internal methods ----

  /** Convert arena coordinates to canvas pixel coordinates. */
  private arenaToCanvas(x: number, y: number): { x: number; y: number };

  /** Set up the static background layer (arena floor, grid, border). */
  private initBackground(): void;

  /** Create or update robot display objects to match frame data. */
  private syncRobots(robots: RobotFrameState[], alpha: number): void;

  /** Create or update bullet sprites to match frame data. */
  private syncBullets(bullets: BulletFrameState[], alpha: number): void;

  /** Create or update mine sprites. */
  private syncMines(mines: MineFrameState[]): void;

  /** Create or update cookie sprites. */
  private syncCookies(cookies: CookieFrameState[]): void;

  /** Process events and spawn visual effects. */
  private processEvents(events: GameEvent[]): void;

  /** Update the HUD (tick counter, etc). */
  private updateHUD(): void;
}
```

### 2.5 RobotView: Per-Robot Display Object

```typescript
class RobotView {
  container: Container;
  bodySprite: Sprite;
  gunSprite: Sprite;
  radarSprite: Sprite;
  healthBar: HealthBarView;
  nameLabel: BitmapText;
  alive: boolean = true;
  deathTimer: number = 0;

  constructor(textures: RobotTextures, name: string, color: number) {
    this.container = new Container();

    this.bodySprite = new Sprite(textures.body);
    this.bodySprite.anchor.set(0.5);
    this.bodySprite.tint = color;

    this.gunSprite = new Sprite(textures.gun);
    this.gunSprite.anchor.set(0.5, 0.75);
    this.gunSprite.tint = lightenColor(color, 0.3);

    this.radarSprite = new Sprite(textures.radar);
    this.radarSprite.anchor.set(0.5);
    this.radarSprite.tint = color;
    this.radarSprite.alpha = 0.5;

    this.container.addChild(this.bodySprite);
    this.container.addChild(this.gunSprite);
    this.container.addChild(this.radarSprite);

    this.healthBar = new HealthBarView();
    this.healthBar.container.y = -28; // Above the robot
    this.container.addChild(this.healthBar.container);

    this.nameLabel = new BitmapText({
      text: name,
      style: { fontFamily: 'GameFont', fontSize: 10 },
    });
    this.nameLabel.anchor.set(0.5);
    this.nameLabel.y = -38;
    this.container.addChild(this.nameLabel);
  }

  update(state: RobotFrameState): void {
    this.container.x = state.x;
    this.container.y = state.y;
    this.bodySprite.rotation = state.bodyHeading;
    this.gunSprite.rotation = state.gunHeading;
    this.radarSprite.rotation = state.radarHeading;
    this.healthBar.update(state.health, state.maxHealth);
  }

  /** Update with interpolated values for smooth rendering. */
  updateInterpolated(
    prev: RobotFrameState,
    curr: RobotFrameState,
    alpha: number,
  ): void {
    this.container.x = lerp(prev.x, curr.x, alpha);
    this.container.y = lerp(prev.y, curr.y, alpha);
    this.bodySprite.rotation = lerpAngle(prev.bodyHeading, curr.bodyHeading, alpha);
    this.gunSprite.rotation = lerpAngle(prev.gunHeading, curr.gunHeading, alpha);
    this.radarSprite.rotation = lerpAngle(prev.radarHeading, curr.radarHeading, alpha);
    // Health snaps -- no interpolation.
    this.healthBar.update(curr.health, curr.maxHealth);
  }
}
```

---

## 3. Interpolation and Animation

### 3.1 The Problem

The simulation runs at a fixed tick rate (30 ticks/second as established in the
simulation physics design). The browser's display typically refreshes at 60 Hz.
If we render only on simulation ticks, we get 30 fps -- noticeable stutter,
especially for fast-moving bullets.

The solution is to interpolate between two simulation frames to produce a smooth
60 fps visual while the simulation remains deterministic at 30 ticks/sec.

### 3.2 The Game Loop

The game loop sits between the simulation and the renderer. It manages time
accumulation, speed control, pause/step, and interpolation.

```typescript
class GameLoop {
  private readonly TICK_RATE = 30;
  private readonly TICK_DURATION = 1000 / 30; // ~33.33ms

  private accumulator = 0;
  private lastTimestamp = 0;
  private speedMultiplier = 1;
  private paused = false;
  private stepRequested = false;
  private animFrameId = 0;
  private running = false;

  // Frame buffers for interpolation
  private prevFrame: FrameData | null = null;
  private currFrame: FrameData | null = null;

  constructor(
    private simulation: { tick(): FrameData },
    private renderer: BattleRenderer,
    private onTick?: (frame: FrameData) => void,
  ) {}

  start(): void {
    this.running = true;
    this.lastTimestamp = performance.now();
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  setSpeed(multiplier: number): void {
    // Supported: 0.5, 1, 2, 4, 8
    this.speedMultiplier = multiplier;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.lastTimestamp = performance.now(); // Reset to avoid accumulator spike
  }

  step(): void {
    this.stepRequested = true;
  }

  private loop = (timestamp: number): void => {
    if (!this.running) return;

    const deltaMs = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    if (this.stepRequested) {
      // Step mode: advance exactly one simulation tick.
      this.prevFrame = this.currFrame;
      this.currFrame = this.simulation.tick();
      this.onTick?.(this.currFrame);
      this.stepRequested = false;
      // Render at alpha=1 (fully at currFrame).
      this.renderer.pushFrame(this.currFrame);
      this.renderer.render(1.0);
    } else if (!this.paused) {
      // Scale delta by speed multiplier.
      const scaledDelta = deltaMs * this.speedMultiplier;
      // Clamp to prevent spiral of death (max 8 ticks per render frame).
      this.accumulator += Math.min(scaledDelta, this.TICK_DURATION * 8);

      // Consume simulation ticks.
      while (this.accumulator >= this.TICK_DURATION) {
        this.prevFrame = this.currFrame;
        this.currFrame = this.simulation.tick();
        this.onTick?.(this.currFrame);
        this.accumulator -= this.TICK_DURATION;
      }

      // Interpolation alpha: fraction of the way to the next tick.
      const alpha = this.accumulator / this.TICK_DURATION;
      if (this.currFrame) {
        this.renderer.pushFrame(this.currFrame);
        this.renderer.render(alpha);
      }
    } else {
      // Paused: keep rendering the current frame (for resize, etc).
      if (this.currFrame) {
        this.renderer.render(1.0);
      }
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };
}
```

### 3.3 Interpolation Functions

```typescript
/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Angular interpolation taking the shortest path.
 * Handles the wraparound at +/- PI correctly.
 * Both angles must be in radians.
 */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  // Normalize diff to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}
```

### 3.4 What to Interpolate and What Not To

| Property        | Interpolate? | Reason                                          |
|-----------------|--------------|--------------------------------------------------|
| Position (x, y) | Yes         | Movement is continuous. Linear interpolation is accurate for constant-velocity motion. |
| Body heading     | Yes         | Rotation is continuous. Use `lerpAngle` for shortest path. |
| Gun heading      | Yes         | Same reasoning as body heading.                  |
| Radar heading    | Yes         | Same reasoning. Radar sweep looks much smoother. |
| Health           | No          | Health changes are discrete events. Snapping is correct -- a hit deals instant damage. |
| Energy           | No          | Same reasoning as health.                        |
| Gun heat         | No          | Discrete countdown.                              |
| Alive/dead       | No          | Binary state. Death triggers an effect; no interpolation needed. |
| Bullet position  | Yes         | Bullets move fast. Interpolation prevents them from "jumping." |
| Bullet heading   | No          | Bullets travel in a straight line. Heading does not change. |

### 3.5 Speed Control Implementation

| Speed | Behavior                                                      |
|-------|---------------------------------------------------------------|
| 0.5x  | Accumulate 0.5x real time. One sim tick every ~2 render frames. Slow-motion feel. |
| 1x    | Real time. ~1 sim tick per 2 render frames (30 tick/s at 60 fps). |
| 2x    | ~2 sim ticks per 2 render frames. Brisk pace.                |
| 4x    | ~4 sim ticks per 2 render frames.                            |
| 8x    | ~8 sim ticks per 2 render frames. Fast-forward. At this speed, interpolation still applies but is less visible because multiple ticks are consumed per frame. |

At very high speeds (8x), the game loop processes up to 8 simulation ticks per
render frame. The loop clamp (`TICK_DURATION * 8`) prevents unbounded catchup.
If the simulation cannot keep up at the requested speed, it simply runs as fast
as it can.

### 3.6 Replay Mode

For replay mode, the game loop replaces `simulation.tick()` with a read from the
recording:

```typescript
class ReplaySource {
  private frames: FrameData[];
  private index = 0;

  constructor(recording: FrameData[]) {
    this.frames = recording;
  }

  tick(): FrameData {
    if (this.index >= this.frames.length) {
      return this.frames[this.frames.length - 1]!;
    }
    return this.frames[this.index++]!;
  }

  seek(tick: number): void {
    this.index = Math.max(0, Math.min(tick, this.frames.length - 1));
  }

  get totalTicks(): number {
    return this.frames.length;
  }

  get currentTick(): number {
    return this.index;
  }
}
```

The `GameLoop` accepts either a live simulation or a `ReplaySource` -- they both
implement the same `{ tick(): FrameData }` interface. The renderer does not know
or care which one it is rendering.

---

## 4. Visual Effects

### 4.1 Effect Catalog

#### Muzzle Flash (Bullet Fired)

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `BulletFiredEvent`                                 |
| PixiJS primitive | `Graphics` circle + short line                   |
| Duration       | 4 frames (~67ms)                                   |
| Behavior       | Bright flash at gun tip position. Starts at full opacity and scale, shrinks and fades. Color matches robot. |
| Pooled         | Yes (via EffectPool)                               |

```typescript
function spawnMuzzleFlash(pool: EffectPool, event: BulletFiredEvent, color: number): void {
  pool.spawn('muzzle_flash', 4, (container) => {
    const flash = new Graphics();
    flash.circle(0, 0, 6);
    flash.fill({ color, alpha: 1 });
    container.addChild(flash);
    container.x = event.x;
    container.y = event.y;
    return (progress: number) => {
      const invProgress = 1 - progress;
      flash.alpha = invProgress;
      flash.scale.set(0.5 + invProgress * 0.5);
    };
  });
}
```

#### Bullet Sprite (In-Flight)

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | Bullet appears in `FrameData.bullets`              |
| PixiJS primitive | `Sprite` (small filled circle texture, 6x6 px)  |
| Behavior       | Moves along trajectory. Size scales with power (0.5x to 1.5x). Color matches owner robot. |
| Pooled         | Yes (via BulletPool)                               |
| Trail          | Optional: 3-sprite trail with decreasing alpha (0.6, 0.3, 0.1) trailing behind the bullet by 4px, 8px, 12px along its heading. Togglable. |

#### Bullet Impact Explosion

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `BulletHitEvent`                                   |
| PixiJS primitive | `Graphics` circles + `Sprite` particles          |
| Duration       | 15 frames (~250ms) for small; 25 frames (~420ms) for high-power |
| Behavior       | Expanding ring + 8-12 particle sprites that fly outward and fade. Ring radius proportional to bullet power (power 1 = 15px, power 3 = 35px). |
| Color          | Orange/yellow core, fading to transparent.         |
| Pooled         | Yes (via EffectPool)                               |

```typescript
function spawnBulletExplosion(pool: EffectPool, event: BulletHitEvent): void {
  const duration = Math.round(15 + event.power * 5);
  const maxRadius = 15 + event.power * 8;

  pool.spawn('bullet_explosion', duration, (container) => {
    // Expanding ring
    const ring = new Graphics();
    container.addChild(ring);
    container.x = event.x;
    container.y = event.y;

    // Particle sprites (small 2x2 circles)
    const particles: { sprite: Sprite; vx: number; vy: number }[] = [];
    const count = 8 + Math.round(event.power * 2);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      const particle = new Sprite(Texture.WHITE);
      particle.width = 2;
      particle.height = 2;
      particle.anchor.set(0.5);
      particle.tint = 0xFFAA44;
      container.addChild(particle);
      particles.push({ sprite: particle, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    }

    return (progress: number) => {
      // Ring expands and fades
      ring.clear();
      const radius = maxRadius * progress;
      ring.circle(0, 0, radius);
      ring.stroke({ color: 0xFF8800, alpha: 1 - progress, width: 2 });

      // Particles move outward and fade
      for (const p of particles) {
        p.sprite.x += p.vx;
        p.sprite.y += p.vy;
        p.sprite.alpha = 1 - progress;
      }
    };
  });
}
```

#### Robot Hit Flash

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `BulletHitEvent` or `DamageEvent`                  |
| PixiJS primitive | Tint change on existing robot body sprite         |
| Duration       | 6 frames (~100ms)                                  |
| Behavior       | Robot body sprite tint flashes white (0xFFFFFF) then returns to robot color. |
| Pooled         | No -- modifies existing sprite directly.           |

```typescript
function flashRobot(view: RobotView, originalColor: number): void {
  view.bodySprite.tint = 0xFFFFFF;
  let framesLeft = 6;
  const restore = () => {
    framesLeft--;
    if (framesLeft <= 0) {
      view.bodySprite.tint = originalColor;
    }
  };
  // Called by BattleRenderer.render() each frame while active.
}
```

#### Robot Death Explosion

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `RobotDeathEvent`                                  |
| PixiJS primitive | Multiple `Graphics` circles + 20-30 particle sprites |
| Duration       | 45 frames (~750ms)                                 |
| Behavior       | Large explosion (2x bullet explosion). Robot sprite fades to alpha 0 over 30 frames, then is hidden. Two expanding rings. Debris particles scatter outward with deceleration. Camera shake (stage offset by +/-3px for 10 frames). |
| Pooled         | Yes (via EffectPool)                               |

#### Scan Arc

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `ScanEvent`                                        |
| PixiJS primitive | `Graphics` filled arc (triangle fan)              |
| Duration       | 8 frames (~133ms)                                  |
| Behavior       | Translucent cone drawn from robot center outward to scan range. Color matches robot color at low alpha (0.15). If `hitDetected` is true, the arc briefly flashes brighter (alpha 0.35). Fades to 0 over its lifetime. |
| Pooled         | Yes (via EffectPool)                               |

```typescript
function spawnScanArc(pool: EffectPool, event: ScanEvent, color: number): void {
  const startAlpha = event.hitDetected ? 0.35 : 0.15;

  pool.spawn('scan_arc', 8, (container) => {
    const arc = new Graphics();
    arc.moveTo(0, 0);
    arc.arc(0, 0, event.range, event.heading - event.arcHalfWidth, event.heading + event.arcHalfWidth);
    arc.lineTo(0, 0);
    arc.fill({ color, alpha: startAlpha });
    container.addChild(arc);
    container.x = event.x;
    container.y = event.y;

    return (progress: number) => {
      arc.alpha = startAlpha * (1 - progress);
    };
  });
}
```

#### Wall Hit Sparks

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `WallHitEvent` or `BulletWallHitEvent`             |
| PixiJS primitive | 4-6 small `Sprite` particles                     |
| Duration       | 10 frames (~167ms)                                 |
| Behavior       | Small yellow/white particles scatter inward from wall hit point. Speed proportional to `impactSpeed`. |
| Pooled         | Yes (via EffectPool)                               |

#### Mine Explosion

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `MineDetonationEvent`                              |
| PixiJS primitive | `Graphics` circles + particles                   |
| Duration       | 30 frames (~500ms)                                 |
| Behavior       | Distinctive red-orange explosion. Two expanding concentric rings (inner red, outer orange). 15-20 debris particles. Larger than bullet explosion (maxRadius = 40px). Camera shake (5px, 15 frames). |
| Pooled         | Yes (via EffectPool)                               |

#### Cookie Pickup

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `CookiePickupEvent`                                |
| PixiJS primitive | 6-8 small `Sprite` particles                     |
| Duration       | 20 frames (~333ms)                                 |
| Behavior       | Green sparkle particles converge toward the collecting robot's position. Starts spread out (radius 20px), moves inward, and fades. A brief green glow on the robot's health bar. |
| Pooled         | Yes (via EffectPool)                               |

#### Damage Numbers (Togglable)

| Property       | Value                                              |
|----------------|----------------------------------------------------|
| Trigger        | `DamageEvent`                                      |
| PixiJS primitive | `BitmapText`                                     |
| Duration       | 40 frames (~667ms)                                 |
| Behavior       | Text showing "-4.0" (damage amount) floats upward from impact point at 0.5 px/frame. Fades from full opacity to 0. Color: red for damage taken, white for damage dealt. |
| Pooled         | Yes (via a DamageNumberPool of BitmapText objects) |
| Toggle         | Controlled by `RenderOptions.showDamageNumbers`.   |

### 4.2 Health Bars

```typescript
class HealthBarView {
  container: Container;
  private background: Graphics;
  private fill: Graphics;
  private readonly WIDTH = 36;
  private readonly HEIGHT = 4;

  constructor() {
    this.container = new Container();

    this.background = new Graphics();
    this.background.rect(-this.WIDTH / 2, 0, this.WIDTH, this.HEIGHT);
    this.background.fill({ color: 0x333333 });
    this.container.addChild(this.background);

    this.fill = new Graphics();
    this.container.addChild(this.fill);
  }

  update(health: number, maxHealth: number): void {
    const fraction = Math.max(0, health / maxHealth);
    const fillWidth = this.WIDTH * fraction;

    // Color gradient: green (>60%), yellow (30-60%), red (<30%)
    let color: number;
    if (fraction > 0.6) {
      color = 0x44DD44; // green
    } else if (fraction > 0.3) {
      color = 0xDDDD44; // yellow
    } else {
      color = 0xDD4444; // red
    }

    this.fill.clear();
    this.fill.rect(-this.WIDTH / 2, 0, fillWidth, this.HEIGHT);
    this.fill.fill({ color });
  }
}
```

### 4.3 Cookie and Mine Rendering

**Cookies** pulse gently to attract attention:

```typescript
class CookieView {
  sprite: Sprite;
  private tickCount = 0;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.tint = 0x44FF88;
  }

  update(): void {
    this.tickCount++;
    // Gentle pulse: scale oscillates between 0.9 and 1.1
    const pulse = 1 + 0.1 * Math.sin(this.tickCount * 0.1);
    this.sprite.scale.set(pulse);
  }
}
```

**Mines** have a subtle red glow:

```typescript
class MineView {
  sprite: Sprite;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.tint = 0xFF4444;
    this.sprite.alpha = 0.8;
  }
}
```

### 4.4 Camera Shake

Camera shake is implemented by temporarily offsetting the stage position:

```typescript
class CameraShake {
  private intensity = 0;
  private duration = 0;
  private remaining = 0;

  trigger(intensity: number, durationFrames: number): void {
    // Take the stronger shake if one is already active
    if (intensity > this.intensity) {
      this.intensity = intensity;
      this.duration = durationFrames;
      this.remaining = durationFrames;
    }
  }

  /** Returns offset to apply to the stage container. */
  update(): { x: number; y: number } {
    if (this.remaining <= 0) return { x: 0, y: 0 };
    this.remaining--;
    const decay = this.remaining / this.duration;
    const magnitude = this.intensity * decay;
    return {
      x: (Math.random() - 0.5) * 2 * magnitude,
      y: (Math.random() - 0.5) * 2 * magnitude,
    };
  }
}
```

---

## 5. React Application Structure

### 5.1 Overall Layout

```
+------------------------------------------------------------------+
|  [ Edit ]  [ Battle ]  [ Tournament ]              Robot Battle  |
+------------------------------------------------------------------+
|                                                                   |
|  (Active tab content fills the rest of the viewport)             |
|                                                                   |
+------------------------------------------------------------------+
```

### 5.2 Edit Tab Layout

```
+------------------------------------------------------------------+
|  [ Edit ]  [ Battle ]  [ Tournament ]                            |
+-------------------+----------------------------------------------+
|  Robot Files      |  Editor (CodeMirror 6)                       |
|                   |                                              |
|  > SpinBot.rbl    |  robot "SpinBot" {                           |
|    WallCrawler    |      fn tick() {                             |
|    Tracker        |          setSpeed(30)                        |
|    MyBot          |          setTurnRate(8)                      |
|                   |          if getGunHeat() == 0.0 {            |
|  [+ New Robot]    |              fire(2)                         |
|  [Import .rbl]    |          }                                   |
|                   |      }                                       |
|                   |  }                                           |
|                   |                                              |
+-------------------+----------------------------------------------+
|  Compile Status: Ready  |  [Compile]  [Run Battle]              |
+-------------------+----------------------------------------------+
```

### 5.3 Battle Tab Layout

```
+------------------------------------------------------------------+
|  [ Edit ]  [ Battle ]  [ Tournament ]                            |
+------------------------------------------------------------------+
|                                                                   |
|  +--------------------------------------------+  +-----------+  |
|  |                                            |  | Robot     |  |
|  |          PixiJS Canvas                     |  | Status    |  |
|  |                                            |  |           |  |
|  |     (Arena with robots, bullets,           |  | SpinBot   |  |
|  |      explosions, health bars)              |  | HP: 78    |  |
|  |                                            |  | E:  45    |  |
|  |                                            |  |           |  |
|  |                                            |  | Tracker   |  |
|  |                                            |  | HP: 92    |  |
|  |                                            |  | E:  60    |  |
|  |                                            |  |           |  |
|  |                                            |  | ...       |  |
|  +--------------------------------------------+  +-----------+  |
|                                                                   |
|  +------------------------------------------------------------+  |
|  | [|<] [<<] [ > Play ] [>>] [>|]   1x [2x] [4x] [8x]       |  |
|  | Tick: 342 / 2000                            Round: 1 / 10  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### 5.4 Tournament Tab Layout

```
+------------------------------------------------------------------+
|  [ Edit ]  [ Battle ]  [ Tournament ]                            |
+------------------------------------------------------------------+
|                                                                   |
|  Tournament Configuration                                        |
|  +-----------------------------+  +---------------------------+  |
|  | Select Robots:              |  | Settings:                 |  |
|  | [x] SpinBot                 |  | Rounds: [1000]            |  |
|  | [x] WallCrawler             |  | Ticks/round: [2000]       |  |
|  | [x] Tracker                 |  | Arena: [800] x [600]      |  |
|  | [ ] MyBot (compile error)   |  |                           |  |
|  +-----------------------------+  | [Start Tournament]        |  |
|                                   +---------------------------+  |
|                                                                   |
|  Results                                                         |
|  +------------------------------------------------------------+  |
|  | Progress: [=================>          ] 62% (620 / 1000)  |  |
|  |                                                             |  |
|  | Rank | Robot       | Points | Win% | Avg Placement          |  |
|  | ---- | ----------- | ------ | ---- | ---------------        |  |
|  |  1   | Tracker     |  6420  |  41% | 1.8                    |  |
|  |  2   | SpinBot     |  5890  |  35% | 2.1                    |  |
|  |  3   | WallCrawler |  4230  |  24% | 2.8                    |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### 5.5 Component Hierarchy

```tsx
<App>
  <TabBar activeTab={tab} onTabChange={setTab} />

  {tab === 'edit' && (
    <EditTab>
      <FileListSidebar
        files={robotFiles}
        activeFileId={activeFileId}
        onSelect={setActiveFileId}
        onCreate={createRobotFile}
        onImport={importRobotFile}
        onDelete={deleteRobotFile}
      />
      <EditorPane>
        <CodeMirrorEditor
          source={activeFile.source}
          onChange={updateSource}
          language={rblLanguageSupport}
        />
        <CompileStatusBar
          status={compileStatus}
          errors={compileErrors}
        />
        <EditorToolbar
          onCompile={compile}
          onRunBattle={switchToBattleAndRun}
        />
      </EditorPane>
    </EditTab>
  )}

  {tab === 'battle' && (
    <BattleTab>
      <BattleMain>
        <GameCanvas
          rendererRef={rendererRef}
          arenaConfig={arenaConfig}
        />
        <RobotStatusPanel robots={currentFrame?.robots ?? []} />
      </BattleMain>
      <ControlBar
        playing={playing}
        speed={speed}
        currentTick={currentTick}
        totalTicks={totalTicks}
        onPlay={play}
        onPause={pause}
        onStep={step}
        onSpeedChange={setSpeed}
        onSeek={seek}
      />
    </BattleTab>
  )}

  {tab === 'tournament' && (
    <TournamentTab>
      <TournamentConfig
        robots={compiledRobots}
        settings={tournamentSettings}
        onSettingsChange={setTournamentSettings}
        onStart={startTournament}
      />
      <TournamentProgress
        running={tournamentRunning}
        completed={roundsCompleted}
        total={totalRounds}
      />
      <Leaderboard results={tournamentResults} />
    </TournamentTab>
  )}
</App>
```

### 5.6 State Management (Zustand)

Two stores separate concerns: one for robot file management (persistent) and one
for the active battle session (ephemeral).

```typescript
// ---- Robot File Store ----

interface RobotFile {
  id: string;
  name: string;
  source: string;
  compiledWasm: ArrayBuffer | null;
  compileStatus: 'none' | 'compiling' | 'success' | 'error';
  compileErrors: CompileError[];
  modified: number;
}

interface RobotFileStore {
  files: RobotFile[];
  activeFileId: string | null;

  // Actions
  createFile: (name: string) => void;
  deleteFile: (id: string) => void;
  updateSource: (id: string, source: string) => void;
  setActiveFile: (id: string) => void;
  setCompileResult: (id: string, wasm: ArrayBuffer | null, errors: CompileError[]) => void;
  importFile: (name: string, source: string) => void;

  // Derived
  activeFile: () => RobotFile | null;
  compiledRobots: () => RobotFile[];
}

const useRobotFileStore = create<RobotFileStore>()(
  persist(
    (set, get) => ({
      files: [],
      activeFileId: null,
      // ... implementation
    }),
    {
      name: 'robot-battle-files',
      storage: createJSONStorage(() => /* IndexedDB adapter */),
    }
  )
);
```

```typescript
// ---- Battle Store ----

interface BattleStore {
  // State
  status: 'idle' | 'loading' | 'running' | 'paused' | 'finished';
  speed: number;
  currentTick: number;
  totalTicks: number;
  currentFrame: FrameData | null;
  results: BattleResults | null;

  // Actions
  startBattle: (robotIds: string[], config: BattleConfig) => void;
  pause: () => void;
  resume: () => void;
  step: () => void;
  setSpeed: (multiplier: number) => void;
  stop: () => void;
  setFrame: (frame: FrameData) => void;
  setResults: (results: BattleResults) => void;
}

const useBattleStore = create<BattleStore>()((set) => ({
  status: 'idle',
  speed: 1,
  currentTick: 0,
  totalTicks: 0,
  currentFrame: null,
  results: null,
  // ... implementation
}));
```

```typescript
// ---- Tournament Store ----

interface TournamentStore {
  status: 'idle' | 'configuring' | 'running' | 'complete';
  settings: TournamentSettings;
  roundsCompleted: number;
  totalRounds: number;
  results: TournamentResults | null;

  setSettings: (settings: Partial<TournamentSettings>) => void;
  start: () => void;
  cancel: () => void;
  setProgress: (completed: number) => void;
  setResults: (results: TournamentResults) => void;
}

interface TournamentSettings {
  robotIds: string[];
  rounds: number;
  ticksPerRound: number;
  arenaWidth: number;
  arenaHeight: number;
}
```

### 5.7 How the PixiJS Renderer Gets State Updates

The renderer does NOT receive state through React re-renders. Instead:

1. The simulation worker posts `FrameData` via `postMessage`.
2. A listener on the main thread receives the frame.
3. The listener calls `renderer.pushFrame(frame)` directly on the imperative
   renderer instance (accessed via a React ref).
4. The `GameLoop` drives `renderer.render(alpha)` via `requestAnimationFrame`.
5. React is only notified for slow-changing UI state (current tick number, robot
   health values for the status panel) by selectively updating the Zustand store,
   throttled to 10 updates/second.

```typescript
// In the GameCanvas component
function GameCanvas({ arenaConfig }: { arenaConfig: ArenaConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const gameLoopRef = useRef<GameLoop | null>(null);

  // React state updated at 10 Hz for the status panel
  const setFrame = useBattleStore((s) => s.setFrame);
  const throttledSetFrame = useMemo(
    () => throttle((frame: FrameData) => setFrame(frame), 100),
    [setFrame],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new BattleRenderer(canvas, arenaConfig);
    rendererRef.current = renderer;

    renderer.init().then(() => {
      // Renderer ready. GameLoop is started by the parent when
      // the simulation begins.
    });

    return () => {
      gameLoopRef.current?.stop();
      renderer.destroy();
    };
  }, [arenaConfig]);

  // Expose renderer ref to parent for GameLoop wiring
  useImperativeHandle(/* ... */);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
```

### 5.8 File Management

Robot files are stored in IndexedDB and synced to the Zustand store on app
startup:

```
App startup:
  1. Load all RobotFile records from IndexedDB.
  2. Populate useRobotFileStore with loaded files.
  3. Set activeFileId to the last-edited file (from localStorage).

On source edit:
  1. Update store immediately (for editor display).
  2. Debounce save to IndexedDB (300ms).
  3. Clear compiled WASM cache (source changed).

On compile:
  1. Set compileStatus = 'compiling' in store.
  2. Post source to compiler (Web Worker or main thread).
  3. On success: store compiled WASM in the file record.
  4. On failure: store compile errors for display.

On import (.rbl file):
  1. Read file contents via File API.
  2. Create new RobotFile record with source.
  3. Save to IndexedDB and store.

On export:
  1. Read source from store.
  2. Create Blob and trigger download.
```

---

## 6. Responsive Design and Canvas Sizing

### 6.1 Coordinate Systems

There are two coordinate systems:

1. **Arena coordinates**: The simulation's world space. Origin at (0, 0) which
   maps to the top-left corner of the arena. X increases rightward, Y increases
   downward. The arena extends from (0, 0) to (width, height), e.g., (800, 600).

2. **Canvas pixel coordinates**: The actual pixel space of the HTML canvas
   element. Determined by the canvas element's size on screen and the device
   pixel ratio.

### 6.2 Coordinate Mapping

The canvas displays the entire arena with uniform scaling and letterboxing
(black bars) if the aspect ratios do not match.

```typescript
function computeCanvasMapping(
  arenaWidth: number,
  arenaHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { scale: number; offsetX: number; offsetY: number } {
  const scaleX = canvasWidth / arenaWidth;
  const scaleY = canvasHeight / arenaHeight;
  const scale = Math.min(scaleX, scaleY); // Uniform scale, fit whole arena

  // Center the arena in the canvas
  const offsetX = (canvasWidth - arenaWidth * scale) / 2;
  const offsetY = (canvasHeight - arenaHeight * scale) / 2;

  return { scale, offsetX, offsetY };
}
```

The PixiJS stage container is positioned at `(offsetX, offsetY)` and scaled by
`scale`. All arena-coordinate objects are added as children of this container,
so they automatically map to the correct canvas position.

```typescript
// In BattleRenderer.resize():
resize(canvasWidth: number, canvasHeight: number): void {
  this.app.renderer.resize(canvasWidth, canvasHeight);
  const { scale, offsetX, offsetY } = computeCanvasMapping(
    this.arenaConfig.width, this.arenaConfig.height,
    canvasWidth, canvasHeight,
  );
  this.scale = scale;
  this.offsetX = offsetX;
  this.offsetY = offsetY;

  // Apply to the arena container (parent of all game layers)
  this.arenaContainer.x = offsetX;
  this.arenaContainer.y = offsetY;
  this.arenaContainer.scale.set(scale);

  // Redraw static background at new resolution
  this.initBackground();
}
```

### 6.3 Window Resize Handling

The `GameCanvas` React component observes its own size using `ResizeObserver`
and forwards dimensions to the renderer:

```typescript
useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    rendererRef.current?.resize(width * dpr, height * dpr);
  });

  observer.observe(canvas.parentElement!);
  return () => observer.disconnect();
}, []);
```

### 6.4 Device Pixel Ratio

For crisp rendering on high-DPI displays, the canvas internal resolution is
multiplied by `devicePixelRatio`. The CSS size remains at logical pixels. PixiJS
handles this via its `resolution` option:

```typescript
await this.app.init({
  canvas: canvasElement,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  antialias: true,
  backgroundColor: this.options.backgroundColor,
});
```

### 6.5 Mobile Considerations

Mobile is explicitly not a primary target for the initial release. The game
requires a code editor, which is not practical on small screens. However, the
canvas rendering layer itself is responsive and will scale correctly on tablets.
The minimum supported viewport width is 1024px. Below that, the layout degrades
but does not break.

---

## 7. The Tutorial System

### 7.1 Design Goals

The tutorial teaches a new player to write and run their first robot in 5
minutes. It is sequential, hands-on, and uses the real editor and battle view --
not a separate sandbox.

### 7.2 Tutorial Steps

```
Step 1: Welcome
  "Welcome to Robot Battle! Let's build your first fighting robot."
  [Action: Click "Start Tutorial"]

Step 2: Create a robot file
  "Click 'New Robot' to create your first robot."
  [Highlight: + New Robot button]
  [Action: User clicks the button, names the robot]

Step 3: Write the tick function
  "Every tick, your robot runs this function. Let's make it move!"
  [Pre-fill editor with skeleton:]
    robot "MyBot" {
        fn tick() {
            // Your code here
        }
    }
  [Instruction: "Type setSpeed(5) inside the tick function."]
  [Highlight: cursor position inside tick()]
  [Validation: source contains setSpeed]

Step 4: Make it turn
  "Your robot moves forward. Now let's make it turn too."
  [Instruction: "Add setTurnRate(3) on the next line."]
  [Validation: source contains setTurnRate]

Step 5: Compile
  "Let's compile your robot. Click 'Compile'."
  [Highlight: Compile button]
  [Action: User clicks compile]
  [Handle: If compile errors, show guidance]

Step 6: Run a battle
  "Your robot compiles! Let's see it fight. Click 'Run Battle'."
  [Highlight: Run Battle button]
  [Action: Switch to Battle tab, start a battle vs a built-in SpinBot]

Step 7: Watch the battle
  "Watch your robot move! It cannot shoot yet -- let's fix that."
  [Wait: 5 seconds or user clicks "Continue"]

Step 8: Add firing
  [Switch back to Edit tab]
  "Add this code to make your robot fire:"
  [Show suggested code:]
    if getGunHeat() == 0.0 {
        fire(1)
    }
  [Validation: source contains fire]

Step 9: Run again
  "Compile and run again!"
  [Guide through compile + run]

Step 10: Complete
  "Congratulations! Your robot can move, turn, and shoot."
  "Next steps: try scanning for enemies, adjusting your strategy,
   or running a tournament."
  [Show links: "Example Robots", "Language Reference", "Tournament Mode"]
```

### 7.3 Tutorial State

```typescript
interface TutorialState {
  active: boolean;
  currentStep: number;
  totalSteps: number;
  completedSteps: Set<number>;
}

const useTutorialStore = create<TutorialState & {
  start: () => void;
  advance: () => void;
  skip: () => void;
  reset: () => void;
}>()((set) => ({
  active: false,
  currentStep: 0,
  totalSteps: 10,
  completedSteps: new Set(),
  start: () => set({ active: true, currentStep: 1, completedSteps: new Set() }),
  advance: () => set((s) => ({
    currentStep: s.currentStep + 1,
    completedSteps: new Set([...s.completedSteps, s.currentStep]),
    active: s.currentStep + 1 <= s.totalSteps,
  })),
  skip: () => set({ active: false }),
  reset: () => set({ active: false, currentStep: 0, completedSteps: new Set() }),
}));
```

Tutorial completion is persisted in `localStorage` so it only shows once.

### 7.4 Tutorial UI Component

The tutorial uses a floating tooltip panel that points to the relevant UI
element. It is implemented as a React portal rendered above the application:

```tsx
function TutorialOverlay() {
  const { active, currentStep } = useTutorialStore();
  if (!active) return null;

  const step = TUTORIAL_STEPS[currentStep];
  if (!step) return null;

  return (
    <div className="tutorial-overlay">
      {/* Semi-transparent backdrop with cutout around highlighted element */}
      {step.highlightSelector && (
        <TutorialHighlight selector={step.highlightSelector} />
      )}
      {/* Floating tooltip */}
      <TutorialTooltip
        title={step.title}
        content={step.content}
        position={step.tooltipPosition}
        onNext={advance}
        onSkip={skip}
        showNext={step.autoAdvance ? false : true}
        stepNumber={currentStep}
        totalSteps={totalSteps}
      />
    </div>
  );
}
```

The overlay uses a highlight cutout (a CSS clip-path or box-shadow overlay with
a transparent hole) to draw attention to the target element. This approach keeps
the target element interactive while dimming the rest of the UI.

---

## 8. Project Structure

```
src/
  renderer/
    BattleRenderer.ts        # Main renderer class (Section 2.4)
    RobotView.ts             # Per-robot display object (Section 2.5)
    HealthBarView.ts         # Health bar rendering (Section 4.2)
    CookieView.ts            # Cookie display and animation
    MineView.ts              # Mine display
    BulletPool.ts            # Object pool for bullet sprites (Section 2.3)
    EffectPool.ts            # Object pool for visual effects (Section 2.3)
    effects.ts               # Effect spawning functions (Section 4.1)
    CameraShake.ts           # Camera shake system (Section 4.4)
    textures.ts              # Procedural texture generation (Section 2.2)
    GameLoop.ts              # Fixed timestep + interpolation (Section 3.2)
    ReplaySource.ts          # Replay playback controller (Section 3.6)
    types.ts                 # FrameData, entity state, event types (Section 1)
    constants.ts             # Colors, sizes, durations
    math.ts                  # lerp, lerpAngle utilities (Section 3.3)

  ui/
    App.tsx                  # Root component with tab routing
    TabBar.tsx               # Tab navigation header
    edit/
      EditTab.tsx            # Edit tab layout container
      FileListSidebar.tsx    # Robot file list + create/import
      CodeMirrorEditor.tsx   # CodeMirror 6 wrapper component
      CompileStatusBar.tsx   # Compile status and error display
      EditorToolbar.tsx      # Compile + Run Battle buttons
    battle/
      BattleTab.tsx          # Battle tab layout container
      GameCanvas.tsx         # Canvas + BattleRenderer integration (Section 5.7)
      ControlBar.tsx         # Play/pause/speed/step controls
      RobotStatusPanel.tsx   # Per-robot health/energy readout
    tournament/
      TournamentTab.tsx      # Tournament tab layout container
      TournamentConfig.tsx   # Robot selection + settings form
      TournamentProgress.tsx # Progress bar during batch sim
      Leaderboard.tsx        # Results table with rankings
    tutorial/
      TutorialOverlay.tsx    # Floating tutorial tooltip (Section 7.4)
      TutorialHighlight.tsx  # Highlight cutout for target elements
      tutorialSteps.ts       # Step definitions (Section 7.2)
    hooks/
      useSimulationWorker.ts # Web Worker communication for sim
      useCompiler.ts         # Compile robot source to WASM
      useRobotStorage.ts     # IndexedDB CRUD for robot files
      useCanvasResize.ts     # ResizeObserver hook (Section 6.3)
    store/
      robotFileStore.ts      # Zustand store for robot files (Section 5.6)
      battleStore.ts         # Zustand store for battle state (Section 5.6)
      tournamentStore.ts     # Zustand store for tournament state
      tutorialStore.ts       # Zustand store for tutorial state (Section 7.3)

  tests/
    renderer/
      BattleRenderer.test.ts # Renderer initialization and frame processing
      interpolation.test.ts  # lerp, lerpAngle correctness
      GameLoop.test.ts       # Tick accumulation, speed control, pause/step
      BulletPool.test.ts     # Pool acquire/release lifecycle
      EffectPool.test.ts     # Effect lifetime and cleanup
      effects.test.ts        # Effect spawning produces correct display objects
    ui/
      EditTab.test.tsx       # File creation, source editing
      ControlBar.test.tsx    # Play/pause/speed button interactions
      GameCanvas.test.tsx    # Canvas mounting and resize handling
      TutorialOverlay.test.tsx # Tutorial step progression
```

---

## 9. Trade-offs and Decisions

### 9.1 Raw State vs View Model Transformation Layer

**Question:** Should the renderer receive raw `FrameData` and derive visual
state, or should there be an intermediate "view model" layer that transforms
simulation state into render-ready data?

**Decision: No separate view model layer.** The `FrameData` interface is already
designed from the renderer's perspective. It contains exactly what the renderer
needs, in the form it needs it. Adding a view model transformation would create
an extra copy of the data per frame with no architectural benefit.

If the simulation engine's internal representation differs from `FrameData` (it
likely will -- the sim uses fixed-point integers internally), the transformation
happens once at the simulation boundary when constructing the `FrameData`. This
is the simulation engine's responsibility, not the renderer's.

### 9.2 Canvas Coordinate System: Top-Left Origin

**Question:** Should (0,0) be top-left (screen convention) or bottom-left
(math convention)?

**Decision: Top-left origin.** Both PixiJS and HTML Canvas use top-left origin
with Y increasing downward. The simulation physics document specifies the arena
origin at top-left. Using the same convention everywhere eliminates a constant
source of coordinate bugs. Headings still use standard math convention (0 =
right, counter-clockwise positive), but Y coordinates match screen space.

This means "up" on screen is negative Y. Robot programmers will need to know
this, but it matches the overwhelming majority of 2D game engines and web APIs.
The tutorial and API documentation will state this clearly.

### 9.3 Robot Sprites: Procedural Generation

**Question:** Procedural drawing (Graphics API) vs pre-rendered sprite sheets?

**Decision: Procedural, cached as textures.** Robots are drawn once at startup
using the `Graphics` API, then `renderer.generateTexture()` converts them to
GPU textures. This gives us:

- No asset pipeline needed (no image files to manage, no loading screen).
- Resolution independence (regenerate at any scale on resize).
- Easy color tinting (white base + `tint` property).
- Consistent visual style without requiring an artist.

The procedural shapes are intentionally simple (rounded rectangles, circles,
lines) to match the clean vector aesthetic. If we want richer visuals later,
sprite sheets can replace the procedural textures without changing any other
code -- the `Sprite` objects work identically with either texture source.

### 9.4 Container Rotation Strategy

**Question:** Which sprite is the parent? How to handle three independent
rotations?

**Decision: Non-rotating container, all rotations absolute.** The robot
`Container` sits at `(x, y)` with rotation 0. Each of the three child sprites
(body, gun, radar) is individually set to its absolute heading from the state.
This is the simplest approach:

- No relative angle math needed.
- Adding or removing a part does not affect the others.
- Debugging is straightforward (each sprite's rotation matches the state value).

The alternative (container rotates to body heading, gun/radar set to relative
offsets) saves one subtraction per frame but introduces coupling. Not worth it.

### 9.5 Dark Theme and Visual Style

**Question:** How dark? Grid lines?

**Decision: Dark charcoal background with subtle grid.** Background color
`0x111118` (very dark blue-grey). Grid lines at 50-unit intervals in
`0x1A1A24` (barely visible, 6% contrast). Arena border in `0x333344` (visible
but not distracting). This follows the "clean vector + technical schematic"
direction from the rendering research.

The grid is optional (`RenderOptions.showGrid`) and rendered once to a
`RenderTexture` on the background layer. The subtle grid gives spatial reference
without competing with game elements.

### 9.6 Robot Source Code in Battle Tab

**Question:** Should the battle tab show robot source alongside the canvas?

**Decision: No.** The battle tab is dedicated to watching and controlling the
battle. Showing source code would reduce canvas size and split the user's
attention. Players who want to see their code can use the Edit tab. The tabs
are explicitly designed so each tab has one primary purpose:

- Edit = write and compile code.
- Battle = watch and control a fight.
- Tournament = configure and run tournaments, view rankings.

A "split view" showing code + battle could be a future enhancement, but it is
not part of the initial design.

### 9.7 Replay: Recording-Based, Not Live Re-Simulation

**Question:** Should watching a battle produce a replayable recording, or is
each viewing live from the simulation?

**Decision: Full snapshot recording for single battles.** Every battle run
records the complete `FrameData[]` array (one per tick). This costs roughly
2-6 MB per round (as estimated in the simulation research) and enables:

- Instant seeking to any tick (no re-simulation needed).
- Backward playback (just read frames in reverse).
- Speed changes without simulation cost.
- Sharing replays without sharing robot code.

For batch tournaments (10,000 rounds), only results are stored -- no frame
recordings. If a user wants to watch a specific tournament round, they re-run
that single round from its seed (deterministic replay).

The `ReplaySource` and live simulation both implement the same
`{ tick(): FrameData }` interface, so the `GameLoop` and `BattleRenderer` work
identically for both modes.

### 9.8 React Rendering of @pixi/react vs Imperative

**Question:** Use `@pixi/react` for declarative rendering or imperative PixiJS
with a React ref wrapper?

**Decision: Imperative.** The rendering research concluded that React
reconciliation overhead at 60 fps is a risk, and that imperative PixiJS in a
React shell is the recommended pattern. The `BattleRenderer` class manages all
PixiJS objects directly. React owns only the `<canvas>` element and the
surrounding UI panels. The bridge is a single `GameCanvas` component that holds
a ref to the `BattleRenderer` instance.

This keeps the fast path (game rendering) outside React's update cycle and the
slow path (UI panels, controls, status) inside React where it belongs.

### 9.9 Simulation Tick Rate

**Question:** 30 ticks/sec or 60 ticks/sec?

**Decision: 30 ticks/sec with 60 fps rendering interpolation.** This matches
the simulation physics design. The renderer interpolates between tick N and
tick N+1 to produce smooth 60 fps visuals. At 30 ticks/sec, each simulation
tick is ~33ms, giving plenty of budget for WASM execution, physics, and
rendering on the main thread. At 2x speed, 60 ticks are consumed per second;
at 8x speed, 240 ticks/sec. The game loop caps at 8 ticks per render frame to
prevent spiral-of-death scenarios.
