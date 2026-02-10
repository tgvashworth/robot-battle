# Renderer Architecture

The renderer is a PixiJS-based visualization layer that reads `GameState` snapshots produced by the simulation engine and draws them to an HTML canvas. It has no knowledge of the compiler, WASM, or robot code. It is a pure consumer of state.

**File:** `src/renderer/renderer.ts`

## Overview

The renderer implements the `BattleRenderer` interface defined in `spec/renderer.ts`. It is created with `createRenderer()`, which returns an object with methods for initialization, frame pushing, rendering, and cleanup.

The rendering approach is retained mode: visual objects (PixiJS `Graphics` and `Container` nodes) are created once per entity and updated each frame. When entities appear or disappear between frames, visuals are lazily created or destroyed.

### BattleRenderer Interface

```typescript
interface BattleRenderer {
    ready: Promise<void>
    init(canvas: HTMLCanvasElement, arena: ArenaConfig): void
    pushFrame(state: GameState): void
    render(alpha: number): void
    resize(width: number, height: number): void
    setOptions(options: Partial<RenderOptions>): void
    reset(): void
    destroy(): void
}
```

### Lifecycle

1. **Create:** `createRenderer()` returns the renderer object. No PixiJS resources are allocated yet.

2. **Init:** `init(canvas, arena)` creates the PixiJS `Application`, sets up the layer hierarchy, and draws the background grid. Init is asynchronous internally (PixiJS v8 requires async init). The `ready` promise resolves when PixiJS is fully initialized.

3. **Push frames:** `pushFrame(state)` stores the new `GameState` as the current frame and shifts the previous current frame to the previous slot. The renderer maintains exactly two frames for interpolation.

4. **Render:** `render(alpha)` draws an interpolated frame. The `alpha` parameter (0.0 to 1.0) controls interpolation between the previous and current frames. At alpha=0, the previous frame is shown; at alpha=1, the current frame is shown. This allows smooth animation between discrete simulation ticks.

5. **Reset:** `reset()` destroys all entity visuals (robots, bullets, mines, cookies) and clears the frame state, but preserves the PixiJS application and layer hierarchy. Used when starting a new round or battle.

6. **Destroy:** `destroy()` releases all PixiJS resources, destroys the application, and nullifies all internal state. The renderer cannot be used after destruction.

## Layer Hierarchy

The PixiJS stage contains four layers ordered from bottom to top:

| Layer | Label | Contents |
|---|---|---|
| Background | `background` | Arena background color, grid lines |
| Entity | `entities` | Robot bodies, guns, radar arcs, bullets, mines, cookies |
| Effects | `effects` | Reserved for future effects (explosions, trails) |
| UI | `ui` | Health bars, name labels, damage numbers |

Health bars and name labels are placed on the UI layer (not inside robot containers) so they do not rotate with the robot body.

## Coordinate System

The renderer uses the same coordinate system as the simulation:

- Origin (0, 0) is the top-left corner of the canvas.
- X increases to the right.
- Y increases downward.
- Game heading 0 = north (up), increasing clockwise.

The conversion function `headingToRad(deg)` converts game headings to canvas radians: `(deg - 90) * PI / 180`. This accounts for the fact that PixiJS rotation 0 points right (east), while game heading 0 points up (north).

## Visual Elements

### Robots

Each robot is represented by a `RobotVisual` object containing:

| Component | Type | Description |
|---|---|---|
| `container` | `Container` | Parent node positioned at (x, y), rotated by body heading. Lives on the entity layer. |
| `body` | `Graphics` | Filled rectangle centered at origin, with a nose triangle indicating the front. |
| `gun` | `Graphics` | A line extending from the center outward. Rotated relative to the body by the difference between gun heading and body heading. |
| `radar` | `Graphics` | A filled arc extending from the center. Rotated relative to the body by the difference between radar heading and body heading. |
| `healthBarBg` | `Graphics` | Gray background rectangle for the health bar. Lives on the UI layer. |
| `healthBarFill` | `Graphics` | Colored fill rectangle for the health bar. Lives on the UI layer. |
| `nameLabel` | `Text` | Monospace text showing the robot name. Lives on the UI layer. |

**Body rendering:** The body is a rectangle of `ROBOT_WIDTH` (14) by `ROBOT_LENGTH` (20) pixels, filled with the robot's color. A nose triangle extends 4 pixels beyond the front edge to indicate facing direction. The container is rotated by `heading * DEG_TO_RAD`.

**Gun rendering:** A line from the center extending `ROBOT_LENGTH / 2 + GUN_LENGTH` (22) pixels outward, drawn with a width of `GUN_WIDTH + 1` (3) pixels in color `0xAACCDD`. The gun graphic is rotated by `headingToRad(gunHeading - bodyHeading)` relative to the container.

**Radar arc rendering:** A filled wedge (pie slice) with radius `RADAR_ARC_RADIUS` (120) pixels and angular span equal to the robot's `scanWidth`. The fill color is `0x00FF88` at alpha 0.15, with edge strokes at alpha 0.4. The radar graphic is rotated by `headingToRad(radarHeading - bodyHeading)` relative to the container. The radar arc is redrawn each frame to reflect changes in scan width.

**Health bar:** A horizontal bar positioned `HEALTH_BAR_OFFSET_Y` (17) pixels below the robot center. The background is `HEALTH_BAR_WIDTH` (20) by `HEALTH_BAR_HEIGHT` (3) pixels in dark gray (`0x333333`). The fill width is proportional to health / 100. Fill color varies:

| Health Range | Color |
|---|---|
| > 50 | Green (`0x00FF00`) |
| 25-50 | Yellow (`0xFFFF00`) |
| < 25 | Red (`0xFF0000`) |

**Name label:** Monospace 10px white text, positioned `NAME_OFFSET_Y` (-16) pixels above the robot center (above the body). Anchored at center-bottom.

**Dead robots:** When `alive` is false, the container and all UI elements are hidden (`visible = false`).

### Bullets

Each bullet is a circle of `BULLET_RADIUS` (3) pixels filled with `0xFFFF88` (bright yellow). Bullets are positioned directly at their (x, y) coordinates on the entity layer.

### Mines

Each mine is rendered as a composite graphic on the entity layer:

- **Outer circle:** `MINE_RADIUS` (8) pixels, filled with `MINE_COLOR` (`0xFF4422`, red-orange).
- **Inner dot:** 40% of the mine radius, filled with `MINE_INNER_COLOR` (`0xFF8844`, lighter orange).
- **Warning cross:** Two perpendicular lines through the center, each 60% of the mine radius long, stroked with `MINE_INNER_COLOR` at 1.5px width.

### Cookies

Each cookie is rendered as a composite graphic on the entity layer:

- **Outer circle:** `COOKIE_RADIUS` (10) pixels, filled with `COOKIE_COLOR` (`0x22DD44`, green).
- **Plus sign:** Two perpendicular rectangles (horizontal and vertical), each 55% of the cookie radius in half-length, 2px thick, filled with `COOKIE_CROSS_COLOR` (`0xFFFFFF`, white).

### Grid

When enabled, the background grid draws lines every 50 pixels across the arena. Lines are stroked with color `0x222233` at alpha 0.5 and 1px width.

## Interpolation

The renderer supports frame interpolation for smooth animation. Given an `alpha` value between 0 and 1:

**Robot interpolation:** Position (x, y) is linearly interpolated between previous and current frames. Heading, gun heading, and radar heading use angular interpolation (`lerpAngle`) which handles wrapping around 360 degrees correctly.

**Bullet interpolation:** Position (x, y) is linearly interpolated between previous and current frames.

**Mines and cookies:** Not interpolated (they are stationary). Positions are taken directly from the current frame.

If no previous frame exists or alpha >= 1, the current frame values are used directly.

## Render Options

The renderer supports configurable visual options via `setOptions()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `showGrid` | `boolean` | `true` | Show the background grid. |
| `showDamageNumbers` | `boolean` | `true` | Show floating damage numbers (reserved for future use). |
| `showScanArcs` | `boolean` | `true` | Show radar scan arcs on robots. |
| `showHealthBars` | `boolean` | `true` | Show health bars below robots. |
| `showNames` | `boolean` | `true` | Show robot name labels. |
| `backgroundColor` | `number` | `0x111118` | Arena background color (hex). |

Options can be changed at any time. Changes take effect on the next `render()` call. The `applyOptions()` internal function updates visibility flags on all existing visuals.

## Stale Visual Cleanup

Each `render()` call begins by comparing the current frame's entity IDs against the existing visual pools. Visuals for entities that no longer appear in the frame are destroyed and removed from their respective maps:

- Robot visuals: the container and all its children are destroyed, plus the health bar and name label on the UI layer.
- Bullet visuals: the graphics object is destroyed.
- Mine visuals: the graphics object is destroyed.
- Cookie visuals: the graphics object is destroyed.

New visuals are created lazily when an entity ID is encountered for the first time.

## Constants Reference

| Constant | Value | Description |
|---|---|---|
| `ROBOT_WIDTH` | 14 | Robot body width in pixels |
| `ROBOT_LENGTH` | 20 | Robot body length in pixels |
| `GUN_LENGTH` | 12 | Gun line length beyond the robot body |
| `GUN_WIDTH` | 2 | Gun line base width (rendered at +1) |
| `RADAR_ARC_RADIUS` | 120 | Radar sweep arc radius in pixels |
| `BULLET_RADIUS` | 3 | Bullet circle radius |
| `HEALTH_BAR_WIDTH` | 20 | Health bar total width |
| `HEALTH_BAR_HEIGHT` | 3 | Health bar height |
| `HEALTH_BAR_OFFSET_Y` | 17 | Health bar vertical offset below robot center |
| `NAME_OFFSET_Y` | -16 | Name label vertical offset above robot center |
| `MINE_RADIUS` | 8 | Mine visual radius |
| `MINE_COLOR` | `0xFF4422` | Mine outer circle color |
| `MINE_INNER_COLOR` | `0xFF8844` | Mine inner dot and cross color |
| `COOKIE_RADIUS` | 10 | Cookie visual radius |
| `COOKIE_COLOR` | `0x22DD44` | Cookie outer circle color |
| `COOKIE_CROSS_COLOR` | `0xFFFFFF` | Cookie plus sign color |
| `DEG_TO_RAD` | `PI / 180` | Degrees to radians conversion factor |

## GameState Input

The renderer reads from the `GameState` interface produced by the simulation engine:

```typescript
interface GameState {
    tick: number
    round: number
    arena: ArenaConfig
    robots: readonly RobotState[]
    bullets: readonly BulletState[]
    mines: readonly MineState[]
    cookies: readonly CookieState[]
    events: readonly GameEvent[]
}
```

The renderer currently uses `robots`, `bullets`, `mines`, and `cookies` arrays for visual updates. The `events` array is available for future event-driven effects (explosions, damage numbers, scan flashes) but is not currently consumed by the renderer.

### RobotState Fields Used

| Field | Usage |
|---|---|
| `id` | Key for visual pooling |
| `name` | Name label text |
| `color` | Body fill color |
| `x`, `y` | Container position |
| `heading` | Container rotation |
| `gunHeading` | Gun graphic rotation |
| `radarHeading` | Radar arc rotation |
| `scanWidth` | Radar arc angular span |
| `health` | Health bar fill width and color |
| `alive` | Visibility toggle |

Fields such as `speed`, `energy`, `score`, `fuelUsedThisTick`, and all stat fields are not used by the renderer.
