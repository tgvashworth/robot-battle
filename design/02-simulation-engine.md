# Simulation Engine Design

This document is the implementation blueprint for Robot Battle's simulation engine. It defines the game state interfaces, tick processing pipeline, robot interface, test stubs, batch runner, and project structure. A developer should be able to implement the engine from this document alone.

**Prerequisites**: Read [00-synthesis.md](../research/00-synthesis.md), [03-simulation-physics.md](../research/03-simulation-physics.md), and [06-language-spec.md](../research/06-language-spec.md) for full context on the decisions referenced here.

---

## 1. Game State Interfaces

The game state is the single most important contract in the codebase. It sits between the simulation engine and every consumer: the renderer, the replay system, the batch runner, the debug inspector, and future network play. Every design choice here prioritizes serializability, completeness, and forward compatibility.

### 1.1 Design Principles

- **Plain objects only.** No classes, no methods, no prototypes. Every interface is a plain TypeScript type that survives `structuredClone()`, `JSON.stringify()`, and `postMessage()` without loss.
- **State vs Events.** `GameState` answers "what is true right now." `GameEvent` answers "what happened this tick." The renderer needs both: state for positioning sprites, events for triggering animations and sound effects.
- **Immutable per tick.** The engine produces a new `TickResult` each tick. Consumers must never hold a reference to internal mutable state.
- **Forward compatible.** Every interface uses a discriminated union (`type` field) for events and includes an `extensions` escape hatch for future features.

### 1.2 GameConfig

Immutable for the lifetime of a battle. Set once before the first tick. Never changes.

```typescript
/**
 * Physics constants governing robot movement, combat, and the arena.
 * All speeds are in units/tick. All angles are in degrees.
 * All damage values are in HP (health points, 0-100 scale).
 */
interface PhysicsConfig {
  // --- Movement ---
  readonly maxSpeed: number               // 8 units/tick
  readonly accelerationRate: number        // 1 unit/tick/tick
  readonly decelerationRate: number        // 2 units/tick/tick
  readonly bodyTurnRateMax: number         // 10 deg/tick (at speed 0)
  readonly bodyTurnRateSpeedFactor: number // 0.75 (turn rate = max - factor * |speed|)
  readonly gunTurnRateMax: number          // 20 deg/tick
  readonly radarTurnRateMax: number        // 45 deg/tick

  // --- Combat ---
  readonly bulletSpeedBase: number         // 20 units/tick
  readonly bulletSpeedPowerFactor: number  // 3 (speed = base - factor * power)
  readonly bulletPowerMin: number          // 1
  readonly bulletPowerMax: number          // 5
  readonly fireCostMultiplier: number      // 1 (energy cost = power * multiplier)
  readonly gunHeatPerShot: number          // 1 + power / 5
  readonly gunCooldownRate: number         // 0.1 per tick
  readonly energyRegenRate: number         // 0.01 per tick

  // --- Damage ---
  // Bullet: 4 * power + max(0, 2 * (power - 1))
  readonly bulletDamageBase: number        // 4
  readonly bulletDamageBonusThreshold: number // 1
  readonly bulletDamageBonusFactor: number // 2
  // Wall: max(0, abs(speed) * 0.5 - 1)
  readonly wallDamageSpeedFactor: number   // 0.5
  readonly wallDamageOffset: number        // 1
  // Robot collision: 0.6 to each
  readonly robotCollisionDamage: number    // 0.6
  // Mine: flat damage
  readonly mineDamage: number              // 15

  // --- Cookies ---
  readonly cookieHealthGain: number        // 20
  readonly maxHealth: number               // 130 (soft cap with cookies)
  readonly startingHealth: number          // 100
  readonly startingEnergy: number          // 100

  // --- Radar ---
  readonly defaultScanWidth: number        // 10 degrees
  readonly minScanWidth: number            // 1 degree
  readonly maxScanWidth: number            // 45 degrees
  readonly scanRange: number               // 1200 units

  // --- Robot geometry ---
  readonly robotRadius: number             // 18 units
  readonly bulletRadius: number            // 3 units
  readonly mineRadius: number              // 10 units
  readonly cookieRadius: number            // 10 units
}

/**
 * Spawn rules for mines and cookies.
 */
interface SpawnConfig {
  readonly mineSpawnInterval: number       // ticks between mine spawns (e.g. 300)
  readonly mineMaxCount: number            // max mines on field (e.g. 8)
  readonly mineFirstSpawnTick: number      // first mine spawns on this tick (e.g. 100)
  readonly cookieSpawnInterval: number     // ticks between cookie spawns (e.g. 200)
  readonly cookieMaxCount: number          // max cookies on field (e.g. 3)
  readonly cookieFirstSpawnTick: number    // first cookie spawns on this tick (e.g. 200)
  readonly minSpawnDistanceFromRobot: number // min distance from any robot for spawns (100)
  readonly minSpawnDistanceFromWall: number  // min distance from walls for spawns (30)
}

/**
 * Scoring rules for placement across rounds.
 * Index 0 = 1st place points, index 1 = 2nd place, etc.
 * Array length must be >= the number of robots.
 */
interface ScoringConfig {
  readonly placementPoints: readonly number[]
  // Default for 8 players: [10, 7, 5, 3, 2, 1, 0, 0]
  // Default for 4 players: [10, 6, 3, 1]
  // Default for 2 players: [10, 4]
}

/**
 * Metadata for a single robot in the battle.
 */
interface RobotConfig {
  readonly id: number                      // 0-indexed, unique within battle
  readonly name: string                    // display name from robot declaration
  readonly sourceHash: string              // hash of source code (for replay identity)
  readonly color: readonly [number, number, number]  // default RGB, overridable at init
}

/**
 * Complete configuration for a battle. Immutable after creation.
 */
interface GameConfig {
  readonly arenaWidth: number              // default 800
  readonly arenaHeight: number             // default 600
  readonly ticksPerRound: number           // default 2000
  readonly roundCount: number              // total rounds to play
  readonly masterSeed: number              // seed for generating per-round seeds
  readonly robots: readonly RobotConfig[]  // 2-8 robots
  readonly physics: PhysicsConfig
  readonly spawning: SpawnConfig
  readonly scoring: ScoringConfig
  readonly fuelPerTick: number             // gas budget per tick per robot (10000)
  readonly minStartSpacing: number         // minimum distance between robots at start (80)
}
```

**Default config factory:**

```typescript
function createDefaultPhysics(): PhysicsConfig { /* ... */ }
function createDefaultSpawning(): SpawnConfig { /* ... */ }
function createDefaultScoring(robotCount: number): ScoringConfig { /* ... */ }
function createDefaultConfig(robots: RobotConfig[]): GameConfig { /* ... */ }
```

### 1.3 GameState

The complete simulation state at a single point in time. This is what you would need to render one frame or to resume a simulation from a checkpoint.

```typescript
/**
 * State of a single robot at a point in time.
 */
interface RobotState {
  readonly id: number
  readonly alive: boolean
  readonly health: number                  // 0-130
  readonly energy: number                  // 0+
  readonly x: number                       // arena position
  readonly y: number
  readonly heading: number                 // body heading, degrees [0, 360)
  readonly gunHeading: number              // absolute gun heading, degrees [0, 360)
  readonly radarHeading: number            // absolute radar heading, degrees [0, 360)
  readonly speed: number                   // current speed, can be negative (reversing)
  readonly gunHeat: number                 // 0 = ready to fire
  readonly scanWidth: number               // current radar arc width in degrees

  // Intent state (what the robot requested last tick, useful for debugging)
  readonly desiredSpeed: number
  readonly desiredBodyTurnRate: number
  readonly desiredGunTurnRate: number
  readonly desiredRadarTurnRate: number

  // Display (set by the robot, cosmetic only)
  readonly bodyColor: readonly [number, number, number]
  readonly gunColor: readonly [number, number, number]
  readonly radarColor: readonly [number, number, number]

  // Round stats
  readonly damageDealt: number
  readonly damageReceived: number
  readonly bulletsFired: number
  readonly bulletsHit: number
  readonly kills: number
  readonly tickAlive: number               // how many ticks this robot survived
}

/**
 * State of a single bullet in flight.
 */
interface BulletState {
  readonly id: number                      // unique within the battle
  readonly ownerId: number                 // robot ID that fired it
  readonly x: number
  readonly y: number
  readonly heading: number                 // degrees [0, 360)
  readonly speed: number                   // units/tick
  readonly power: number                   // 1-5
}

/**
 * State of a mine on the arena.
 */
interface MineState {
  readonly id: number                      // unique within the battle
  readonly x: number
  readonly y: number
}

/**
 * State of a cookie (health pickup) on the arena.
 */
interface CookieState {
  readonly id: number                      // unique within the battle
  readonly x: number
  readonly y: number
}

/**
 * Complete game state at a single tick.
 * This is a snapshot — it contains everything needed to render one frame.
 */
interface GameState {
  readonly tick: number                    // 0 to ticksPerRound-1
  readonly round: number                   // 1-indexed
  readonly robots: readonly RobotState[]
  readonly bullets: readonly BulletState[]
  readonly mines: readonly MineState[]
  readonly cookies: readonly CookieState[]
  readonly robotsAlive: number             // count of alive robots
  readonly events: readonly GameEvent[]    // events that occurred THIS tick
}
```

### 1.4 GameEvent

Events are things that happened during a tick. They are used for:
1. **Rendering**: trigger explosion animations, bullet trails, scan arc visuals, damage numbers.
2. **Replay**: reconstruct what happened without re-running the simulation.
3. **Robot event handlers**: the engine converts relevant events into robot callbacks.
4. **Debug panel**: show a log of what happened each tick.

Every event carries a `tick` field so it can be interpreted out of context (e.g., in a flat replay log).

```typescript
type GameEvent =
  | BulletFiredEvent
  | BulletHitEvent
  | BulletWallEvent
  | RobotHitEvent
  | RobotDiedEvent
  | WallHitEvent
  | RobotCollisionEvent
  | MineDetonatedEvent
  | CookiePickupEvent
  | ScanDetectionEvent
  | MineSpawnedEvent
  | CookieSpawnedEvent
  | RobotSpawnedEvent
  | EnergyRegenEvent
  | RoundOverEvent

interface BulletFiredEvent {
  readonly type: 'bullet_fired'
  readonly tick: number
  readonly bulletId: number
  readonly robotId: number
  readonly x: number                       // fire origin (gun tip)
  readonly y: number
  readonly heading: number
  readonly power: number
  readonly speed: number
}

interface BulletHitEvent {
  readonly type: 'bullet_hit'
  readonly tick: number
  readonly bulletId: number
  readonly shooterId: number
  readonly targetId: number
  readonly x: number                       // impact position
  readonly y: number
  readonly damage: number
}

interface BulletWallEvent {
  readonly type: 'bullet_wall'
  readonly tick: number
  readonly bulletId: number
  readonly shooterId: number
  readonly x: number
  readonly y: number
}

interface RobotHitEvent {
  readonly type: 'robot_hit'
  readonly tick: number
  readonly robotId: number
  readonly damage: number
  readonly bearing: number                 // direction damage came from
  readonly sourceType: 'bullet' | 'wall' | 'collision' | 'mine'
}

interface RobotDiedEvent {
  readonly type: 'robot_died'
  readonly tick: number
  readonly robotId: number
  readonly x: number
  readonly y: number
  readonly placement: number               // 1-indexed (last alive = 1st)
}

interface WallHitEvent {
  readonly type: 'wall_hit'
  readonly tick: number
  readonly robotId: number
  readonly damage: number
  readonly x: number
  readonly y: number
  readonly bearing: number                 // angle of wall relative to robot
}

interface RobotCollisionEvent {
  readonly type: 'robot_collision'
  readonly tick: number
  readonly robotId1: number
  readonly robotId2: number
  readonly damage1: number
  readonly damage2: number
  readonly x: number                       // midpoint of collision
  readonly y: number
}

interface MineDetonatedEvent {
  readonly type: 'mine_detonated'
  readonly tick: number
  readonly mineId: number
  readonly robotId: number
  readonly damage: number
  readonly x: number
  readonly y: number
}

interface CookiePickupEvent {
  readonly type: 'cookie_pickup'
  readonly tick: number
  readonly cookieId: number
  readonly robotId: number
  readonly healthGained: number
  readonly x: number
  readonly y: number
}

interface ScanDetectionEvent {
  readonly type: 'scan_detection'
  readonly tick: number
  readonly scannerId: number
  readonly targetId: number
  readonly distance: number
  readonly bearing: number                 // absolute bearing from scanner to target
  readonly scanStartAngle: number          // arc start (for rendering the sweep)
  readonly scanEndAngle: number            // arc end
}

interface MineSpawnedEvent {
  readonly type: 'mine_spawned'
  readonly tick: number
  readonly mineId: number
  readonly x: number
  readonly y: number
}

interface CookieSpawnedEvent {
  readonly type: 'cookie_spawned'
  readonly tick: number
  readonly cookieId: number
  readonly x: number
  readonly y: number
}

interface RobotSpawnedEvent {
  readonly type: 'robot_spawned'
  readonly tick: number
  readonly robotId: number
  readonly x: number
  readonly y: number
  readonly heading: number
}

interface EnergyRegenEvent {
  readonly type: 'energy_regen'
  readonly tick: number
  readonly robotId: number
  readonly amount: number
}

interface RoundOverEvent {
  readonly type: 'round_over'
  readonly tick: number
  readonly reason: 'last_standing' | 'time_limit' | 'all_immobile'
  readonly winnerId: number | null         // null if time limit with no clear winner
  readonly placements: readonly RobotPlacement[]
}

interface RobotPlacement {
  readonly robotId: number
  readonly placement: number               // 1 = winner
  readonly tickSurvived: number
  readonly damageDealt: number
  readonly kills: number
  readonly points: number                  // from ScoringConfig
}
```

### 1.5 TickResult and BattleResult

```typescript
/**
 * The output of processing a single tick.
 */
interface TickResult {
  readonly state: GameState
  readonly events: readonly GameEvent[]
  readonly roundOver: boolean
  readonly roundResult: RoundResult | null
}

/**
 * The result of a single round.
 */
interface RoundResult {
  readonly round: number
  readonly tickCount: number               // how many ticks the round lasted
  readonly reason: 'last_standing' | 'time_limit' | 'all_immobile'
  readonly placements: readonly RobotPlacement[]
  readonly seed: number                    // the seed used for this round
}

/**
 * The result of a complete battle (all rounds).
 */
interface BattleResult {
  readonly config: GameConfig
  readonly rounds: readonly RoundResult[]
  readonly finalScores: readonly RobotScore[]
  readonly totalTicks: number
  readonly wallTimeMs: number              // how long the battle took to run
}

interface RobotScore {
  readonly robotId: number
  readonly name: string
  readonly totalPoints: number
  readonly wins: number                    // 1st place finishes
  readonly avgPlacement: number
  readonly avgDamageDealt: number
  readonly avgSurvivalTicks: number
  readonly totalKills: number
}
```

---

## 2. Simulation Engine Architecture

### 2.1 Public API

```typescript
/**
 * A RobotModule is anything the engine can call per-tick.
 * Both compiled WASM robots and TypeScript test stubs implement this.
 * See Section 3 for the full interface design.
 */
interface RobotModule {
  init(api: RobotAPI): void
  tick(): void
  onScan(distance: number, bearing: number): void
  onHit(damage: number, bearing: number): void
  onBulletHit(targetId: number): void
  onWallHit(bearing: number): void
  onRobotHit(bearing: number): void
  onBulletMiss(): void
  onRobotDeath(robotId: number): void
  destroy(): void
}

/**
 * Top-level factory. Stateless — all state lives inside the returned Battle.
 */
function createBattle(config: GameConfig, robots: RobotModule[]): Battle

interface Battle {
  /** Advance the simulation by one tick. Returns the result. */
  tick(): TickResult

  /** Run a single round to completion. Returns when the round ends. */
  runRound(): RoundResult

  /** Run all rounds to completion. Returns full battle results. */
  run(): BattleResult

  /** Get a readonly snapshot of the current state. */
  getState(): GameState

  /** Get the current tick number. */
  getTick(): number

  /** Get the current round number. */
  getRound(): number

  /** Check if the current round is over. */
  isRoundOver(): boolean

  /** Check if the entire battle is over. */
  isBattleOver(): boolean

  /** Reset for the next round. Called automatically by runRound/run. */
  nextRound(): void

  /** Clean up all resources (WASM instances, etc). */
  destroy(): void
}
```

### 2.2 Internal Architecture

```
Battle
  |-- config: GameConfig (immutable)
  |-- rng: SeededRNG (Mulberry32, reseeded per round)
  |-- round: number
  |-- tick: number
  |-- state: MutableGameState (internal, mutable for performance)
  |-- robots: RobotRunner[] (one per robot, wraps RobotModule + intent + state)
  |-- bullets: MutableBulletState[]
  |-- mines: MutableMineState[]
  |-- cookies: MutableCookieState[]
  |-- events: GameEvent[] (cleared each tick)
  |-- nextBulletId: number
  |-- nextMineId: number
  |-- nextCookieId: number
  |-- placementOrder: number[] (tracks death order for scoring)
```

The engine maintains internal mutable state for performance. On every `tick()` call, it produces an immutable `TickResult` by snapshotting (shallow-copying) the mutable state. This is the hybrid approach: mutate internally, freeze at the boundary.

**RobotRunner** wraps a `RobotModule` and tracks per-robot intent and runtime state:

```typescript
interface RobotRunner {
  module: RobotModule
  id: number
  alive: boolean

  // Mutable state (engine writes these)
  x: number
  y: number
  heading: number
  gunHeading: number
  radarHeading: number
  speed: number
  health: number
  energy: number
  gunHeat: number
  scanWidth: number

  // Robot intents (robot writes via API calls, engine reads and applies)
  intent: RobotIntent

  // Display
  bodyColor: [number, number, number]
  gunColor: [number, number, number]
  radarColor: [number, number, number]

  // Stats
  damageDealt: number
  damageReceived: number
  bulletsFired: number
  bulletsHit: number
  kills: number
  tickAlive: number

  // Stalemate detection
  lastMoveX: number
  lastMoveY: number
  stationaryTicks: number
}

interface RobotIntent {
  desiredSpeed: number
  bodyTurnRate: number
  gunTurnRate: number
  radarTurnRate: number
  firepower: number | null                 // null = don't fire this tick
  useSetHeading: boolean                   // true if setHeading was called
  targetHeading: number
  useSetGunHeading: boolean
  targetGunHeading: number
  useSetRadarHeading: boolean
  targetRadarHeading: number
}
```

### 2.3 Per-Tick Processing Pipeline

This is the exact sequence of operations for every tick. Order matters for determinism. Steps are numbered and cross-referenced throughout this document.

```
TICK PROCESSING ORDER
=====================

Phase A: Physics Resolution (no robot code runs)
  1. Move bullets
  2. Check bullet-robot collisions
  3. Check bullet-wall collisions (remove bullets that left the arena)
  4. Apply robot intents to heading/speed (from PREVIOUS tick's intents)
  5. Move robots (apply speed to position)
  6. Check robot-wall collisions
  7. Check robot-robot collisions
  8. Check robot-mine collisions
  9. Check robot-cookie collisions

Phase B: Bookkeeping
  10. Spawn new mines/cookies (if due this tick)
  11. Regenerate energy
  12. Cool down guns
  13. Remove dead robots (health <= 0), record death events and placement
  14. Check round-over conditions

Phase C: Robot Code Execution (if round is not over)
  15. Fire radar scans (sweep detection)
  16. Deliver events to each robot via event handlers
  17. Call each robot's tick() function
  18. Collect robot intents (already recorded via API calls during step 16-17)

Phase D: Post-Tick
  19. Process fire commands from intents (create bullets if gun is cool)
  20. Snapshot state -> produce TickResult
```

**Why this order?**
- Bullets move first so that bullets fired last tick have traveled before we check collisions. A bullet should not hit something on the tick it was fired.
- Robot intents are applied before movement so that `setSpeed(50)` on tick N results in changed speed on tick N+1's movement.
- Radar scans happen after all movement so the scan sees the final positions for this tick.
- Events are delivered before `tick()` so the robot can react to what happened.
- Fire commands are processed after `tick()` so the robot can call `fire()` and have the bullet created at the end of the same tick.

### 2.4 Detailed Step Specifications

#### Step 1: Move Bullets

For each active bullet:
```
bullet.x += bullet.speed * cos(bullet.heading)
bullet.y += bullet.speed * sin(bullet.heading)
```

Heading is in degrees. Use custom deterministic `cos`/`sin` (see Section 2.5).

#### Step 2: Bullet-Robot Collisions

For each bullet, for each alive robot (excluding the bullet's owner):
```
distance = sqrt((bullet.x - robot.x)^2 + (bullet.y - robot.y)^2)
if distance < physics.robotRadius + physics.bulletRadius:
    // Hit!
    damage = 4 * bullet.power + max(0, 2 * (bullet.power - 1))
    robot.health -= damage
    robot.damageReceived += damage
    shooter.damageDealt += damage
    shooter.bulletsHit += 1

    Emit BulletHitEvent
    Emit RobotHitEvent (sourceType: 'bullet', bearing from bullet to robot)
    Remove bullet from active list
```

**Collision priority**: If a bullet could hit multiple robots in the same tick (very rare with circle hitboxes), it hits the one closest to the bullet's previous position. Process robots in ID order; the first hit wins.

**Self-collision**: A bullet cannot hit its own shooter. This is enforced by the `excluding the bullet's owner` check.

**Swept collision for fast bullets**: Since bullet speed can be up to 19.7 units/tick and robot radius is 18, a bullet can potentially skip over a robot in one tick. To prevent this, use a line-segment-to-circle intersection test:

```
Given bullet moving from P0 to P1, and robot center C with radius R:
1. Let D = P1 - P0 (bullet displacement this tick)
2. Let F = P0 - C (vector from circle center to bullet start)
3. a = dot(D, D)
4. b = 2 * dot(F, D)
5. c = dot(F, F) - (R + bulletRadius)^2
6. discriminant = b^2 - 4*a*c
7. If discriminant >= 0:
   t = (-b - sqrt(discriminant)) / (2*a)
   If 0 <= t <= 1: collision occurred at time t along the segment
```

#### Step 3: Bullet-Wall Collisions

Remove any bullet whose position is outside the arena bounds:
```
if bullet.x < 0 || bullet.x > arenaWidth || bullet.y < 0 || bullet.y > arenaHeight:
    Emit BulletWallEvent
    Remove bullet
```

The arena uses a coordinate system with origin at top-left (0, 0) and extends to (arenaWidth, arenaHeight). This is the standard screen coordinate system and simplifies wall collision checks. The API functions `arenaWidth()` and `arenaHeight()` return the dimensions directly.

Note: The synthesis document mentions centered coordinates (-400 to 400, -300 to 300), but top-left origin is simpler for implementation and wall checks. If centered coordinates are preferred for the robot API, provide them as a thin translation layer in the API functions (getX returns `x - arenaWidth/2`, etc). The internal simulation always uses top-left origin.

#### Step 4: Apply Robot Intents to Heading and Speed

For each alive robot, apply the intents collected from the previous tick:

**Body turning:**
```
maxTurnRate = physics.bodyTurnRateMax - physics.bodyTurnRateSpeedFactor * abs(robot.speed)
maxTurnRate = max(0, maxTurnRate)

if intent.useSetHeading:
    // Turn toward target heading at max rate
    delta = normalizeAngle(intent.targetHeading - robot.heading)  // -180 to +180
    turnAmount = clamp(delta, -maxTurnRate, maxTurnRate)
else:
    turnAmount = clamp(intent.bodyTurnRate, -maxTurnRate, maxTurnRate)

robot.heading = normalizeAngle360(robot.heading + turnAmount)
```

**Gun turning:**
```
if intent.useSetGunHeading:
    delta = normalizeAngle(intent.targetGunHeading - robot.gunHeading)
    turnAmount = clamp(delta, -physics.gunTurnRateMax, physics.gunTurnRateMax)
else:
    turnAmount = clamp(intent.gunTurnRate, -physics.gunTurnRateMax, physics.gunTurnRateMax)

robot.gunHeading = normalizeAngle360(robot.gunHeading + turnAmount)
```

**Radar turning:**
```
if intent.useSetRadarHeading:
    delta = normalizeAngle(intent.targetRadarHeading - robot.radarHeading)
    turnAmount = clamp(delta, -physics.radarTurnRateMax, physics.radarTurnRateMax)
else:
    turnAmount = clamp(intent.radarTurnRate, -physics.radarTurnRateMax, physics.radarTurnRateMax)

previousRadarHeading = robot.radarHeading  // save for sweep detection in step 15
robot.radarHeading = normalizeAngle360(robot.radarHeading + turnAmount)
```

**Speed (acceleration/deceleration):**
```
target = clamp(intent.desiredSpeed, -physics.maxSpeed, physics.maxSpeed)

if target > robot.speed:
    robot.speed = min(robot.speed + physics.accelerationRate, target)
else if target < robot.speed:
    robot.speed = max(robot.speed - physics.decelerationRate, target)
```

Note: Negative speed means reversing. The robot can set a negative desired speed to go backward. The acceleration/deceleration model is asymmetric: robots accelerate slowly (1 unit/tick^2) but decelerate quickly (2 units/tick^2). This punishes changing direction and rewards commitment.

#### Step 5: Move Robots

For each alive robot:
```
robot.x += robot.speed * cos(robot.heading)
robot.y += robot.speed * sin(robot.heading)
```

#### Step 6: Robot-Wall Collisions

For each alive robot:
```
clamped = false

if robot.x < robotRadius:
    robot.x = robotRadius; clamped = true
if robot.x > arenaWidth - robotRadius:
    robot.x = arenaWidth - robotRadius; clamped = true
if robot.y < robotRadius:
    robot.y = robotRadius; clamped = true
if robot.y > arenaHeight - robotRadius:
    robot.y = arenaHeight - robotRadius; clamped = true

if clamped:
    damage = max(0, abs(robot.speed) * physics.wallDamageSpeedFactor - physics.wallDamageOffset)
    robot.health -= damage
    robot.damageReceived += damage
    robot.speed = 0

    // Calculate wall bearing (direction from robot to wall)
    bearing = calculateWallBearing(robot)  // see below

    Emit WallHitEvent { damage, bearing }
    Emit RobotHitEvent { sourceType: 'wall', bearing }
```

**Wall bearing calculation:**
```
function calculateWallBearing(robot, arenaWidth, arenaHeight, robotRadius):
    // Which wall was hit? Use the clamped axis.
    // If clamped on X: left wall (bearing 270) or right wall (bearing 90)
    // If clamped on Y: top wall (bearing 0) or bottom wall (bearing 180)
    // If clamped on both (corner): use the axis with greater penetration
    if robot.x <= robotRadius: return 270          // left wall
    if robot.x >= arenaWidth - robotRadius: return 90   // right wall
    if robot.y <= robotRadius: return 0             // top wall
    if robot.y >= arenaHeight - robotRadius: return 180 // bottom wall
```

#### Step 7: Robot-Robot Collisions

For each pair of alive robots (i < j):
```
dx = robot_j.x - robot_i.x
dy = robot_j.y - robot_i.y
distSq = dx * dx + dy * dy
minDist = 2 * physics.robotRadius
if distSq < minDist * minDist:
    dist = sqrt(distSq)
    if dist < 0.001: dist = 0.001  // prevent division by zero

    // Push robots apart (equal and opposite)
    overlap = minDist - dist
    nx = dx / dist
    ny = dy / dist
    robot_i.x -= nx * overlap / 2
    robot_i.y -= ny * overlap / 2
    robot_j.x += nx * overlap / 2
    robot_j.y += ny * overlap / 2

    // Apply damage
    damage = physics.robotCollisionDamage
    robot_i.health -= damage
    robot_i.damageReceived += damage
    robot_j.health -= damage
    robot_j.damageReceived += damage

    // Bearing from i to j
    bearingIJ = atan2(dy, dx)  // in degrees
    bearingJI = normalizeAngle360(bearingIJ + 180)

    Emit RobotCollisionEvent { damage1: damage, damage2: damage }
    Emit RobotHitEvent for robot_i { sourceType: 'collision', bearing: bearingIJ }
    Emit RobotHitEvent for robot_j { sourceType: 'collision', bearing: bearingJI }
```

#### Step 8: Robot-Mine Collisions

For each alive robot, for each mine:
```
dx = mine.x - robot.x
dy = mine.y - robot.y
distSq = dx * dx + dy * dy
minDist = physics.robotRadius + physics.mineRadius
if distSq < minDist * minDist:
    robot.health -= physics.mineDamage
    robot.damageReceived += physics.mineDamage

    Emit MineDetonatedEvent
    Emit RobotHitEvent { sourceType: 'mine' }
    Remove mine from active list
```

A mine can only hit one robot (first one found in robot-ID order). Once detonated, it is removed immediately and cannot hit another robot in the same tick.

#### Step 9: Robot-Cookie Collisions

For each alive robot, for each cookie:
```
dx = cookie.x - robot.x
dy = cookie.y - robot.y
distSq = dx * dx + dy * dy
minDist = physics.robotRadius + physics.cookieRadius
if distSq < minDist * minDist:
    gained = min(physics.cookieHealthGain, physics.maxHealth - robot.health)
    robot.health += gained

    Emit CookiePickupEvent { healthGained: gained }
    Remove cookie from active list
```

A cookie can only be picked up by one robot. First one found in robot-ID order gets it. Robot health is capped at `physics.maxHealth` (130).

#### Step 10: Spawn Mines and Cookies

```
if tick >= spawning.mineFirstSpawnTick
   && (tick - spawning.mineFirstSpawnTick) % spawning.mineSpawnInterval == 0
   && mines.length < spawning.mineMaxCount:

    position = findSpawnPosition(rng, arenaWidth, arenaHeight, robots,
                                 spawning.minSpawnDistanceFromRobot,
                                 spawning.minSpawnDistanceFromWall)
    if position != null:
        mine = { id: nextMineId++, x: position.x, y: position.y }
        mines.push(mine)
        Emit MineSpawnedEvent

// Same logic for cookies with cookie-specific config values
```

**findSpawnPosition**: Try up to 20 random positions. For each, check minimum distance from all alive robots and from all walls. Return the first valid position, or null if none found (skip spawn this tick). This prevents spawning on top of robots while keeping the algorithm bounded.

#### Step 11: Regenerate Energy

For each alive robot:
```
robot.energy += physics.energyRegenRate
```

Energy has no cap. It starts at `startingEnergy` (100) and regenerates slowly. The only drain is firing.

#### Step 12: Cool Down Guns

For each alive robot:
```
robot.gunHeat = max(0, robot.gunHeat - physics.gunCooldownRate)
```

#### Step 13: Remove Dead Robots

For each robot where health <= 0 (process in ID order):
```
robot.alive = false
robot.health = 0
robot.speed = 0
placement = robotsAlive  // the Nth-to-last death gets Nth place
robotsAlive -= 1

Emit RobotDiedEvent { placement }

// Notify all other alive robots
for each other alive robot:
    Queue onRobotDeath(deadRobotId) event for delivery in step 16
```

**Placement assignment**: When a robot dies, its placement is the number of robots currently alive (before decrementing). If multiple robots die on the same tick, they share the same placement. The last robot standing gets placement 1. If the round ends by time limit, alive robots are ranked by health.

#### Step 14: Check Round-Over Conditions

```
if robotsAlive <= 1:
    reason = 'last_standing'
    END ROUND

if tick >= config.ticksPerRound:
    reason = 'time_limit'
    END ROUND

if allRobotsStationary(100):  // all alive robots stationary for 100 ticks
    reason = 'all_immobile'
    END ROUND
```

**Stalemate detection**:
```
for each alive robot:
    if abs(robot.x - robot.lastMoveX) < 0.1 && abs(robot.y - robot.lastMoveY) < 0.1:
        robot.stationaryTicks += 1
    else:
        robot.stationaryTicks = 0
        robot.lastMoveX = robot.x
        robot.lastMoveY = robot.y

allStationary = every alive robot has stationaryTicks >= 100
```

**Round-end scoring** (when the round ends by time limit or stalemate):
```
Sort alive robots by health descending (ties broken by damageDealt descending, then by lower ID)
Assign placement 1, 2, 3... in sorted order
Dead robots keep their death-order placement
```

#### Step 15: Fire Radar Scans (Sweep Detection)

The radar uses a **continuous sweep model**. Between the previous tick and the current tick, the radar rotated from `previousRadarHeading` to `robot.radarHeading`. The scan arc covers everything the radar swept over during that rotation, plus the configured scan width.

```
for each alive robot (the "scanner"):
    if not alive: skip

    // The swept arc: from (previousRadarHeading - scanWidth/2)
    //                to   (currentRadarHeading  + scanWidth/2)
    // But we need to handle the direction of rotation correctly.

    sweepStart = normalizeAngle360(previousRadarHeading - scanner.scanWidth / 2)
    sweepEnd   = normalizeAngle360(scanner.radarHeading + scanner.scanWidth / 2)
    sweepDelta = normalizeAngle(scanner.radarHeading - previousRadarHeading) // -180 to +180

    for each other alive robot (the "target"):
        dx = target.x - scanner.x
        dy = target.y - scanner.y
        distance = sqrt(dx*dx + dy*dy)

        if distance > physics.scanRange: continue
        if distance < 0.001: continue  // on top of each other, edge case

        bearingToTarget = atan2Deg(dy, dx)  // absolute bearing in degrees

        if isAngleInSweep(bearingToTarget, sweepStart, sweepEnd, sweepDelta):
            Emit ScanDetectionEvent {
                scannerId: scanner.id,
                targetId: target.id,
                distance: distance,
                bearing: bearingToTarget,
                scanStartAngle: sweepStart,
                scanEndAngle: sweepEnd
            }
            // Queue on scan event for delivery to scanner in step 16
```

**isAngleInSweep**: Determines if a bearing falls within the swept arc. The arc direction matters (clockwise vs counterclockwise sweep).

```
function isAngleInSweep(angle, start, end, sweepDelta):
    if abs(sweepDelta) < 0.001:
        // No rotation this tick: use instantaneous arc check
        return isAngleInArc(angle, start, end)

    if sweepDelta > 0:
        // Clockwise sweep: check if angle is between start and end going clockwise
        return isAngleBetweenCW(angle, start, end)
    else:
        // Counter-clockwise sweep
        return isAngleBetweenCW(angle, end, start)

function isAngleBetweenCW(angle, from, to):
    // Is 'angle' between 'from' and 'to' going clockwise?
    a = normalizeAngle360(angle - from)
    sweep = normalizeAngle360(to - from)
    return a <= sweep
```

The scan detects every robot within the sweep, not just the nearest. Each detection fires a separate `on scan` event. This matches the language spec where `on scan(distance, bearing)` can fire multiple times per tick.

#### Steps 16-17: Deliver Events and Call tick()

For each alive robot, in robot-ID order:

```
// Step 16: Deliver queued events
for each event queued for this robot (in the order they were generated):
    match event:
        ScanDetection  -> robot.module.onScan(event.distance, event.bearing)
        BulletHit (as target) -> robot.module.onHit(event.damage, event.bearing)
        BulletHit (as shooter) -> robot.module.onBulletHit(event.targetId)
        BulletWall (as shooter) -> robot.module.onBulletMiss()
        WallHit    -> robot.module.onWallHit(event.bearing)
        RobotCollision -> robot.module.onRobotHit(bearing toward other robot)
        RobotDied  -> robot.module.onRobotDeath(event.robotId)

// Step 17: Call tick
robot.module.tick()
```

Each robot's event handlers and `tick()` share the same fuel budget for the tick (10,000 gas total). If fuel runs out during an event handler, remaining events and `tick()` are skipped.

Before calling any robot code, clear the robot's intent to default values (desiredSpeed unchanged, all turn rates = 0, firepower = null, all useSetHeading flags = false). The robot must actively set intents each tick.

**Important**: "Clear intent" means reset turn rates and fire command only. `desiredSpeed` persists from the last tick. This matches the API contract where `setSpeed` is a persistent setting ("keep going at this speed") while turn rates are per-tick commands.

Actually, let us be more precise:

```
// Before robot code runs each tick:
intent.bodyTurnRate = 0        // reset: robot must call setTurnRate each tick to keep turning
intent.gunTurnRate = 0         // reset
intent.radarTurnRate = 0       // reset
intent.firepower = null        // reset: robot must call fire() each tick to shoot
intent.useSetHeading = false   // reset
intent.useSetGunHeading = false // reset
intent.useSetRadarHeading = false // reset
// intent.desiredSpeed is NOT reset (speed persists)
```

#### Step 19: Process Fire Commands

For each alive robot, in robot-ID order:
```
if intent.firepower != null
   && intent.firepower >= physics.bulletPowerMin
   && intent.firepower <= physics.bulletPowerMax
   && robot.gunHeat == 0
   && robot.energy >= intent.firepower:

    power = intent.firepower
    robot.energy -= power * physics.fireCostMultiplier
    robot.gunHeat = 1 + power / 5
    robot.bulletsFired += 1

    speed = physics.bulletSpeedBase - physics.bulletSpeedPowerFactor * power

    // Bullet spawns at the gun tip (robot center + robotRadius in gun direction)
    bx = robot.x + physics.robotRadius * cos(robot.gunHeading)
    by = robot.y + physics.robotRadius * sin(robot.gunHeading)

    bullet = {
        id: nextBulletId++,
        ownerId: robot.id,
        x: bx, y: by,
        heading: robot.gunHeading,
        speed: speed,
        power: power
    }
    bullets.push(bullet)

    Emit BulletFiredEvent
```

If the robot does not have enough energy or the gun is still hot, the fire command is silently ignored.

### 2.5 Deterministic Math

All trigonometric functions must produce identical results across all platforms. We achieve this by implementing them ourselves rather than using JavaScript's `Math.sin`, `Math.cos`, `Math.atan2`.

**Approach**: WASM f32 arithmetic (add, subtract, multiply, divide) is deterministic per IEEE 754. The non-deterministic operations are transcendental functions. We implement these as polynomial approximations operating on f32 values.

```typescript
/**
 * All angles in the simulation are in degrees [0, 360).
 * Internal math converts to radians as needed.
 */

const DEG_TO_RAD = Math.PI / 180  // Precomputed constant, exact

/**
 * Normalize an angle to [0, 360).
 */
function normalizeAngle360(deg: number): number {
  deg = deg % 360
  if (deg < 0) deg += 360
  return deg
}

/**
 * Normalize an angle to [-180, +180) for computing shortest turn direction.
 */
function normalizeAngle(deg: number): number {
  deg = deg % 360
  if (deg < -180) deg += 360
  if (deg >= 180) deg -= 360
  return deg
}

/**
 * Deterministic sine. Uses a Bhaskara I approximation or a polynomial.
 * Input: degrees. Output: [-1, 1].
 *
 * We use a 5th-order Chebyshev polynomial for sin(x) on [-pi, pi]:
 *   sin(x) ~ x - x^3/6 + x^5/120 - x^7/5040
 * Truncated to match f32 precision (good to ~7 significant digits).
 */
function sinDeg(deg: number): number {
  const rad = normalizeAngle(deg) * DEG_TO_RAD
  // Horner's method for numerical stability
  const x2 = rad * rad
  return rad * (1 - x2 * (1/6 - x2 * (1/120 - x2 / 5040)))
}

function cosDeg(deg: number): number {
  return sinDeg(deg + 90)
}

/**
 * Deterministic atan2. Returns degrees [0, 360).
 * Uses a polynomial approximation of atan.
 */
function atan2Deg(y: number, x: number): number {
  // CORDIC or polynomial atan2 implementation
  // Returns result in degrees, normalized to [0, 360)
  // ...
}
```

**Alternative: Lookup Table (LUT)**

For maximum speed and guaranteed determinism, use a precomputed lookup table with 3600 entries (0.1-degree resolution):

```typescript
const SIN_LUT = new Float32Array(3600)
const COS_LUT = new Float32Array(3600)

for (let i = 0; i < 3600; i++) {
  SIN_LUT[i] = Math.fround(Math.sin(i * Math.PI / 1800))
  COS_LUT[i] = Math.fround(Math.cos(i * Math.PI / 1800))
}

function sinDeg(deg: number): number {
  const idx = Math.round(normalizeAngle360(deg) * 10) % 3600
  return SIN_LUT[idx]
}
```

`Math.fround` ensures the precomputed values are f32, matching WASM's precision. The LUT is generated once at startup. Since the table is fixed and the lookup is integer-indexed, results are identical everywhere.

**Recommendation**: Use the LUT approach. It is faster, simpler, and determinism is trivially guaranteed because the table is a constant. Ship the table as a static asset or generate it at module load time (the generation uses `Math.sin` once, but the result is frozen as f32 values in the array).

### 2.6 Seeded PRNG

```typescript
/**
 * Mulberry32: fast 32-bit seeded PRNG.
 * Returns a function that produces the next random number on each call.
 */
function createRNG(seed: number): SeededRNG {
  let state = seed | 0

  function nextInt(): number {
    let t = (state += 0x6D2B79F5) | 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= (t + Math.imul(t ^ (t >>> 7), t | 61))
    return (t ^ (t >>> 14)) >>> 0
  }

  return {
    /** Returns integer in [0, 2^32) */
    nextInt,
    /** Returns float in [0, 1) */
    nextFloat: () => nextInt() / 4294967296,
    /** Returns integer in [0, max) */
    nextRange: (max: number) => nextInt() % max,
    /** Returns integer in [min, max) */
    nextRangeMinMax: (min: number, max: number) => min + (nextInt() % (max - min)),
  }
}

interface SeededRNG {
  nextInt(): number
  nextFloat(): number
  nextRange(max: number): number
  nextRangeMinMax(min: number, max: number): number
}
```

**Per-round seeding**: Each round derives its seed from the master seed:
```typescript
function roundSeed(masterSeed: number, round: number): number {
  // Hash the master seed with the round number for independence
  let h = masterSeed ^ (round * 0x9E3779B9)
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B)
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B)
  return (h ^ (h >>> 16)) >>> 0
}
```

**Robot PRNG**: Each robot also gets its own seeded PRNG derived from the round RNG, so that `random()` and `randomFloat()` API calls are deterministic per robot and do not depend on other robots' random call patterns:
```typescript
const robotRNG = createRNG(rng.nextInt())  // one per robot per round
```

### 2.7 Round Initialization

When starting a new round:

```
1. Derive round seed from master seed + round number
2. Create round RNG from round seed
3. Reset all robot state to defaults:
   - health = startingHealth (100)
   - energy = startingEnergy (100)
   - alive = true
   - speed = 0
   - gunHeat = 3 (prevents firing for first 30 ticks — avoids instant-fire on spawn)
   - All headings = random (from round RNG)
   - All turn rates = 0
   - Clear stats
4. Place robots at random positions (minimum spacing enforced):
   - For each robot in ID order:
     - Try up to 100 random positions
     - Accept first position that is >= minStartSpacing from all placed robots
       and >= robotRadius from all walls
     - If no valid position found in 100 tries, relax spacing by 10% and retry
5. Clear all bullets, mines, cookies
6. Emit RobotSpawnedEvent for each robot
7. Call robot.module.init() for each robot (in ID order)
   - This is where robots set their colors
8. Reset tick counter to 0
```

---

## 3. Robot Interface

### 3.1 The RobotModule Interface

This is the contract between the simulation engine and any robot implementation (WASM or test stub).

```typescript
/**
 * A robot that the simulation engine can run.
 * Both WASM-compiled robots and TypeScript test stubs implement this.
 */
interface RobotModule {
  /** Called once per round at the start. Robot sets colors, initializes state. */
  init(api: RobotAPI): void

  /** Called once per tick after events are delivered. Main robot logic. */
  tick(): void

  /** Radar detected another robot. */
  onScan(distance: number, bearing: number): void

  /** This robot was hit by a bullet. */
  onHit(damage: number, bearing: number): void

  /** A bullet this robot fired hit an enemy. */
  onBulletHit(targetId: number): void

  /** This robot hit a wall. */
  onWallHit(bearing: number): void

  /** This robot collided with another robot. */
  onRobotHit(bearing: number): void

  /** A bullet this robot fired missed (hit a wall). */
  onBulletMiss(): void

  /** Another robot was destroyed. */
  onRobotDeath(robotId: number): void

  /** Clean up resources (WASM instance, etc). */
  destroy(): void
}
```

### 3.2 The RobotAPI Interface

The API is the set of functions the robot can call. For WASM robots, these become WASM imports. For test stubs, they are passed as a plain object.

```typescript
/**
 * Functions available to the robot during execution.
 * Each call records an intent or returns a sensor value.
 */
interface RobotAPI {
  // --- Body Movement ---
  setSpeed(speed: number): void            // desired speed, clamped to [-maxSpeed, maxSpeed]
  setTurnRate(rate: number): void          // body turn rate, clamped to [-bodyTurnRateMax, bodyTurnRateMax]
  setHeading(heading: number): void        // turn toward this heading at max rate
  getX(): number
  getY(): number
  getHeading(): number                     // degrees [0, 360)
  getSpeed(): number

  // --- Gun ---
  setGunTurnRate(rate: number): void
  setGunHeading(heading: number): void
  getGunHeading(): number
  getGunHeat(): number
  fire(power: number): void                // power 1-5, costs energy
  getEnergy(): number

  // --- Radar ---
  setRadarTurnRate(rate: number): void
  setRadarHeading(heading: number): void
  getRadarHeading(): number
  setScanWidth(degrees: number): void      // 1-45 degrees

  // --- Status ---
  getHealth(): number
  getTick(): number

  // --- Arena ---
  arenaWidth(): number
  arenaHeight(): number
  robotCount(): number                     // alive robots

  // --- Utility ---
  distanceTo(x: number, y: number): number
  bearingTo(x: number, y: number): number  // degrees [0, 360)
  random(max: number): number              // int in [0, max)
  randomFloat(): number                    // float in [0, 1)
  debugInt(value: number): void
  debugFloat(value: number): void
  setColor(r: number, g: number, b: number): void
  setGunColor(r: number, g: number, b: number): void
  setRadarColor(r: number, g: number, b: number): void

  // --- Math (provided as imports for WASM, available in test stubs too) ---
  sin(a: number): number
  cos(a: number): number
  tan(a: number): number
  atan2(y: number, x: number): number
  sqrt(x: number): number
  abs(x: number): number
  min(a: number, b: number): number
  max(a: number, b: number): number
  clamp(x: number, lo: number, hi: number): number
  floor(x: number): number
  ceil(x: number): number
  round(x: number): number
}
```

### 3.3 How Intents Work

When a robot calls `setSpeed(50)`, the engine does not immediately change the robot's speed. Instead, it records the intent:

```typescript
// Inside the engine's RobotAPI implementation for robot i:
setSpeed(speed: number): void {
  runners[i].intent.desiredSpeed = clamp(speed, -config.physics.maxSpeed, config.physics.maxSpeed)
}

setTurnRate(rate: number): void {
  runners[i].intent.bodyTurnRate = rate
  runners[i].intent.useSetHeading = false  // explicit turn rate overrides setHeading
}

setHeading(heading: number): void {
  runners[i].intent.targetHeading = normalizeAngle360(heading)
  runners[i].intent.useSetHeading = true
}

fire(power: number): void {
  runners[i].intent.firepower = power
}

// Sensor reads return current state directly:
getX(): number {
  return runners[i].x
}

getHealth(): number {
  return runners[i].health
}

// Utility functions compute on the spot:
distanceTo(x: number, y: number): number {
  const dx = x - runners[i].x
  const dy = y - runners[i].y
  return Math.sqrt(dx * dx + dy * dy)  // Use deterministic sqrt
}

bearingTo(x: number, y: number): number {
  const dx = x - runners[i].x
  const dy = y - runners[i].y
  return normalizeAngle360(atan2Deg(dy, dx))
}

random(max: number): number {
  return runners[i].rng.nextRange(max)
}
```

### 3.4 WASM Robot Adapter

For compiled WASM robots, the `RobotModule` interface is implemented by a `WasmRobotAdapter` class that bridges WASM imports/exports to the engine:

```typescript
class WasmRobotAdapter implements RobotModule {
  private instance: WebAssembly.Instance | null = null
  private api: RobotAPI | null = null
  private fuelRemaining: number = 0

  constructor(
    private readonly wasmBytes: Uint8Array,
    private readonly fuelPerTick: number
  ) {}

  init(api: RobotAPI): void {
    this.api = api

    // Build the WASM import object mapping RBL API names to engine functions
    const imports = {
      env: {
        // Movement
        setSpeed: (speed: number) => api.setSpeed(speed),
        setTurnRate: (rate: number) => api.setTurnRate(rate),
        setHeading: (heading: number) => api.setHeading(heading),
        getX: () => api.getX(),
        getY: () => api.getY(),
        getHeading: () => api.getHeading(),
        getSpeed: () => api.getSpeed(),

        // Gun
        setGunTurnRate: (rate: number) => api.setGunTurnRate(rate),
        setGunHeading: (heading: number) => api.setGunHeading(heading),
        getGunHeading: () => api.getGunHeading(),
        getGunHeat: () => api.getGunHeat(),
        fire: (power: number) => api.fire(power),
        getEnergy: () => api.getEnergy(),

        // Radar
        setRadarTurnRate: (rate: number) => api.setRadarTurnRate(rate),
        setRadarHeading: (heading: number) => api.setRadarHeading(heading),
        getRadarHeading: () => api.getRadarHeading(),
        setScanWidth: (degrees: number) => api.setScanWidth(degrees),

        // Status
        getHealth: () => api.getHealth(),
        getTick: () => api.getTick(),

        // Arena
        arenaWidth: () => api.arenaWidth(),
        arenaHeight: () => api.arenaHeight(),
        robotCount: () => api.robotCount(),

        // Utility
        distanceTo: (x: number, y: number) => api.distanceTo(x, y),
        bearingTo: (x: number, y: number) => api.bearingTo(x, y),
        random: (max: number) => api.random(max),
        randomFloat: () => api.randomFloat(),
        debug: (value: number) => api.debugInt(value),
        setColor: (r: number, g: number, b: number) => api.setColor(r, g, b),
        setGunColor: (r: number, g: number, b: number) => api.setGunColor(r, g, b),
        setRadarColor: (r: number, g: number, b: number) => api.setRadarColor(r, g, b),

        // Math
        sin: (a: number) => api.sin(a),
        cos: (a: number) => api.cos(a),
        tan: (a: number) => api.tan(a),
        atan2: (y: number, x: number) => api.atan2(y, x),
        sqrt: (x: number) => api.sqrt(x),
        abs: (x: number) => api.abs(x),
        min: (a: number, b: number) => api.min(a, b),
        max: (a: number, b: number) => api.max(a, b),
        clamp: (x: number, lo: number, hi: number) => api.clamp(x, lo, hi),
        floor: (x: number) => api.floor(x),
        ceil: (x: number) => api.ceil(x),
        round: (x: number) => api.round(x),

        // Fuel metering (injected by compiler)
        usegas: (gas: number) => {
          this.fuelRemaining -= gas
          if (this.fuelRemaining <= 0) {
            throw new FuelExhaustedError()
          }
        },
      },
    }

    const module = new WebAssembly.Module(this.wasmBytes)
    this.instance = new WebAssembly.Instance(module, imports)

    // Call the robot's init export if it exists
    this.fuelRemaining = this.fuelPerTick
    try {
      const init = this.instance.exports.init as Function | undefined
      if (init) init()
    } catch (e) {
      if (!(e instanceof FuelExhaustedError)) throw e
    }
  }

  tick(): void {
    this.fuelRemaining = this.fuelPerTick
    try {
      (this.instance!.exports.tick as Function)()
    } catch (e) {
      if (!(e instanceof FuelExhaustedError)) {
        // Runtime error (array bounds, stack overflow, etc)
        // Robot skips this tick
      }
    }
  }

  onScan(distance: number, bearing: number): void {
    try {
      const fn = this.instance!.exports.on_scan as Function | undefined
      if (fn) fn(distance, bearing)
    } catch (e) {
      if (!(e instanceof FuelExhaustedError)) { /* skip */ }
    }
  }

  // ... similar for all other event handlers

  destroy(): void {
    this.instance = null
  }
}

class FuelExhaustedError extends Error {
  constructor() { super('Fuel exhausted') }
}
```

**Important implementation note**: The fuel counter (`fuelRemaining`) is shared across all event handlers and `tick()` within a single simulation tick. The counter is set once at the start of step 16, and if fuel runs out during any event handler, subsequent handlers and `tick()` are all skipped.

### 3.5 Test Stub Robot Adapter

For testing the simulation engine without the compiler, test stubs implement `RobotModule` directly in TypeScript:

```typescript
type TestRobotTickFn = (api: RobotAPI) => void
type TestRobotEventHandlers = {
  onScan?: (api: RobotAPI, distance: number, bearing: number) => void
  onHit?: (api: RobotAPI, damage: number, bearing: number) => void
  onBulletHit?: (api: RobotAPI, targetId: number) => void
  onWallHit?: (api: RobotAPI, bearing: number) => void
  onRobotHit?: (api: RobotAPI, bearing: number) => void
  onBulletMiss?: (api: RobotAPI) => void
  onRobotDeath?: (api: RobotAPI, robotId: number) => void
}

interface TestRobotDef {
  name?: string
  init?: (api: RobotAPI) => void
  tick: TestRobotTickFn
  handlers?: TestRobotEventHandlers
}

function createTestRobot(def: TestRobotDef): RobotModule {
  let api: RobotAPI

  return {
    init(a: RobotAPI) {
      api = a
      if (def.init) def.init(api)
    },
    tick() {
      def.tick(api)
    },
    onScan(distance, bearing) {
      if (def.handlers?.onScan) def.handlers.onScan(api, distance, bearing)
    },
    onHit(damage, bearing) {
      if (def.handlers?.onHit) def.handlers.onHit(api, damage, bearing)
    },
    onBulletHit(targetId) {
      if (def.handlers?.onBulletHit) def.handlers.onBulletHit(api, targetId)
    },
    onWallHit(bearing) {
      if (def.handlers?.onWallHit) def.handlers.onWallHit(api, bearing)
    },
    onRobotHit(bearing) {
      if (def.handlers?.onRobotHit) def.handlers.onRobotHit(api, bearing)
    },
    onBulletMiss() {
      if (def.handlers?.onBulletMiss) def.handlers.onBulletMiss(api)
    },
    onRobotDeath(robotId) {
      if (def.handlers?.onRobotDeath) def.handlers.onRobotDeath(api, robotId)
    },
    destroy() {},
  }
}
```

---

## 4. Test Stub Robots

These robots test specific simulation features. Each is designed to exercise a known code path and produce predictable, verifiable results.

### 4.1 StandStill — baseline test

```typescript
const StandStill = createTestRobot({
  name: 'StandStill',
  tick: (_api) => {
    // Do absolutely nothing. Tests that a robot can exist without acting.
  },
})
```

**Verifies**: Robot stays at spawn position. Health remains 100 (no self-damage). Energy regenerates. Gun heat cools down.

### 4.2 StraightLine — movement test

```typescript
const StraightLine = createTestRobot({
  name: 'StraightLine',
  init: (api) => {
    api.setSpeed(100)  // will be clamped to maxSpeed (8)
  },
  tick: (api) => {
    // Speed persists; robot moves at max speed in its initial heading.
  },
})
```

**Verifies**: Robot accelerates at 1 unit/tick/tick until reaching max speed (8). Position changes by `speed * cos/sin(heading)` each tick. After 8 ticks, robot is at max speed. Eventually hits a wall.

### 4.3 SpinAndFire — gun rotation and firing test

```typescript
const SpinAndFire = createTestRobot({
  name: 'SpinAndFire',
  tick: (api) => {
    api.setGunTurnRate(20)  // max gun rotation
    if (api.getGunHeat() === 0 && api.getEnergy() >= 2) {
      api.fire(2)
    }
  },
})
```

**Verifies**: Gun rotates at 20 deg/tick. Bullet created at gun tip in gun heading direction. Bullet speed = 20 - 3*2 = 14 units/tick. Energy decreases by 2 per shot. Gun heat = 1 + 2/5 = 1.4, cools at 0.1/tick, so gun is ready again after 14 ticks.

### 4.4 WallSeeker — wall collision test

```typescript
const WallSeeker = createTestRobot({
  name: 'WallSeeker',
  init: (api) => {
    api.setHeading(0)    // head toward top wall (or whatever heading faces a wall)
    api.setSpeed(100)
  },
  tick: (_api) => {
    // Just keep going. Will hit a wall.
  },
  handlers: {
    onWallHit: (api, _bearing) => {
      // Record that wall hit occurred (for test assertions)
      api.debugInt(1)
    },
  },
})
```

**Verifies**: Robot hits wall. Damage = max(0, 8 * 0.5 - 1) = 3 HP at max speed. Speed set to 0. `onWallHit` event fires with correct bearing. Robot health drops to 97.

### 4.5 RamBot — robot collision test

```typescript
const RamBot = createTestRobot({
  name: 'RamBot',
  tick: (api) => {
    // Always move toward the center of the arena
    const cx = api.arenaWidth() / 2
    const cy = api.arenaHeight() / 2
    api.setHeading(api.bearingTo(cx, cy))
    api.setSpeed(100)
  },
})
```

**Test setup**: Place two RamBots facing each other. They collide in the center.

**Verifies**: Robot-robot collision detected. Both take 0.6 damage. Both pushed apart. `onRobotHit` fires for both with correct bearing to the other robot.

### 4.6 RadarSpinner — scan test

```typescript
const RadarSpinner = createTestRobot({
  name: 'RadarSpinner',
  init: (api) => {
    api.setScanWidth(20)  // wide scan arc
  },
  tick: (api) => {
    api.setRadarTurnRate(45)  // max radar rotation, full sweep every 8 ticks
  },
  handlers: {
    onScan: (api, distance, bearing) => {
      api.debugFloat(distance)
      api.debugFloat(bearing)
    },
  },
})
```

**Test setup**: Place RadarSpinner and a StandStill bot at known positions.

**Verifies**: `on scan` fires when the radar sweep crosses the other robot. Distance and bearing match the geometric calculation. Scan fires on the tick when the arc sweeps over the target.

### 4.7 TrackerBot — full combat loop test

```typescript
const TrackerBot = createTestRobot({
  name: 'TrackerBot',
  init: (api) => {
    api.setRadarTurnRate(30)
    api.setScanWidth(10)
  },
  tick: (api) => {
    // Default: spin radar to find targets
    api.setRadarTurnRate(30)
  },
  handlers: {
    onScan: (api, distance, bearing) => {
      // Point gun at target
      api.setGunHeading(bearing)

      // Move toward target
      api.setHeading(bearing)
      api.setSpeed(60)  // clamped to max

      // Fire based on distance
      if (api.getGunHeat() === 0 && api.getEnergy() > 5) {
        const power = Math.min(5, Math.max(1, 400 / distance))
        api.fire(power)
      }

      // Lock radar on target
      api.setRadarHeading(bearing)
    },
    onHit: (api, _damage, bearing) => {
      // Dodge perpendicular when hit
      api.setHeading(bearing + 90)
      api.setSpeed(100)
    },
  },
})
```

**Test setup**: Two TrackerBots facing each other at moderate distance.

**Verifies**: Full scan-aim-fire loop. Radar detects target. Gun turns toward target. Bullet fires at correct heading. Bullet travels and hits. Damage applied. `onBulletHit` fires for shooter. `onHit` fires for target. When health reaches 0, `RobotDiedEvent` is emitted and `onRobotDeath` fires for the survivor.

### 4.8 MineWalker — mine collision test

```typescript
const MineWalker = createTestRobot({
  name: 'MineWalker',
  tick: (api) => {
    // Walk toward arena center (where mines will be placed in the test)
    api.setHeading(api.bearingTo(api.arenaWidth() / 2, api.arenaHeight() / 2))
    api.setSpeed(100)
  },
})
```

**Test setup**: Place a mine at the arena center. Spawn MineWalker heading toward it.

**Verifies**: Mine detonation on contact. 15 damage applied. Mine removed from arena. `MineDetonatedEvent` emitted.

### 4.9 CookieSeeker — cookie pickup test

```typescript
const CookieSeeker = createTestRobot({
  name: 'CookieSeeker',
  tick: (api) => {
    // Move toward a known position (test places cookie there)
    api.setHeading(api.bearingTo(400, 300))
    api.setSpeed(100)
  },
})
```

**Test setup**: Pre-damage the robot to 80 HP. Place a cookie at (400, 300).

**Verifies**: Cookie pickup restores 20 HP (back to 100). Cookie removed from arena. `CookiePickupEvent` emitted. Health capped at `maxHealth` (130).

### 4.10 DeterminismBot — determinism verification

```typescript
const DeterminismBot = createTestRobot({
  name: 'DeterminismBot',
  tick: (api) => {
    // Use every API function to produce a deterministic trace
    const x = api.getX()
    const y = api.getY()
    const heading = api.getHeading()
    const r = api.random(100)
    const rf = api.randomFloat()

    api.setSpeed(r % 8)
    api.setTurnRate((rf * 20) - 10)
    api.setGunTurnRate(api.sin(heading) * 20)
    api.setRadarTurnRate(api.cos(heading) * 45)

    if (api.getTick() % 20 === 0 && api.getGunHeat() === 0) {
      api.fire(1 + (r % 4))
    }
  },
})
```

**Test**: Run two identical battles with the same seed. Compare the full event log tick by tick. Every event must be identical.

---

## 5. Batch Runner Design

### 5.1 Overview

The batch runner executes thousands of rounds at maximum speed, without rendering. It distributes rounds across Web Workers for parallelism.

```
Main Thread
  |
  |-- BatchController
  |     |-- createWorkers(n)
  |     |-- distributRounds(totalRounds, workers)
  |     |-- collectResults()
  |     |-- reportProgress(callback)
  |
  +-- Worker 1: SimulationWorker
  |     |-- receives: { config, robotWasmBytes[], roundRange }
  |     |-- runs rounds sequentially
  |     |-- reports progress periodically
  |     |-- returns: RoundResult[]
  |
  +-- Worker 2: SimulationWorker
  |     ...
  +-- Worker N
```

### 5.2 BatchController (Main Thread)

```typescript
interface BatchConfig {
  gameConfig: GameConfig
  robotWasmBytes: Uint8Array[]             // compiled WASM for each robot
  totalRounds: number
  workerCount?: number                     // default: navigator.hardwareConcurrency
  onProgress?: (completed: number, total: number) => void
  onRoundComplete?: (result: RoundResult) => void
}

interface BatchController {
  start(config: BatchConfig): Promise<BattleResult>
  cancel(): void
  getProgress(): { completed: number; total: number }
}

function createBatchController(): BatchController {
  let workers: Worker[] = []
  let cancelled = false

  return {
    async start(config: BatchConfig): Promise<BattleResult> {
      const workerCount = config.workerCount
        ?? navigator.hardwareConcurrency
        ?? 4

      const roundsPerWorker = Math.ceil(config.totalRounds / workerCount)
      workers = []
      cancelled = false

      const allResults: RoundResult[] = []
      let completedRounds = 0
      const startTime = performance.now()

      const promises = Array.from({ length: workerCount }, (_, i) => {
        return new Promise<RoundResult[]>((resolve, reject) => {
          const worker = new Worker(
            new URL('./simulation-worker.ts', import.meta.url),
            { type: 'module' }
          )
          workers.push(worker)

          const startRound = i * roundsPerWorker + 1
          const endRound = Math.min(startRound + roundsPerWorker - 1, config.totalRounds)

          worker.postMessage({
            type: 'start',
            config: config.gameConfig,
            robotWasmBytes: config.robotWasmBytes,
            startRound,
            endRound,
          })

          worker.onmessage = (e) => {
            const msg = e.data
            if (msg.type === 'progress') {
              completedRounds += msg.roundsCompleted
              config.onProgress?.(completedRounds, config.totalRounds)
            } else if (msg.type === 'complete') {
              resolve(msg.results)
              worker.terminate()
            } else if (msg.type === 'error') {
              reject(new Error(msg.message))
              worker.terminate()
            }
          }
        })
      })

      const workerResults = await Promise.all(promises)
      const allRounds = workerResults.flat()

      return {
        config: config.gameConfig,
        rounds: allRounds,
        finalScores: computeFinalScores(config.gameConfig, allRounds),
        totalTicks: allRounds.reduce((sum, r) => sum + r.tickCount, 0),
        wallTimeMs: performance.now() - startTime,
      }
    },

    cancel() {
      cancelled = true
      workers.forEach(w => w.terminate())
      workers = []
    },

    getProgress() {
      return { completed: 0, total: 0 }  // updated via onProgress callback
    },
  }
}
```

### 5.3 SimulationWorker (Web Worker)

```typescript
// simulation-worker.ts
// Runs inside a Web Worker. No DOM access.

self.onmessage = async (e) => {
  const { config, robotWasmBytes, startRound, endRound } = e.data

  try {
    // Pre-compile WASM modules once (compilation is expensive)
    const wasmModules = robotWasmBytes.map(
      (bytes: Uint8Array) => new WebAssembly.Module(bytes)
    )

    const results: RoundResult[] = []
    const progressInterval = Math.max(1, Math.floor((endRound - startRound) / 100))

    for (let round = startRound; round <= endRound; round++) {
      // Create fresh robot instances for each round
      const robots = wasmModules.map(
        (mod: WebAssembly.Module) => new WasmRobotAdapter(mod, config.fuelPerTick)
      )

      // Override config for this specific round
      const roundConfig = { ...config, roundCount: 1 }
      const battle = createBattle(roundConfig, robots)

      // Manually set the round seed
      battle.setRoundSeed(roundSeed(config.masterSeed, round))

      const roundResult = battle.runRound()
      results.push({ ...roundResult, round })

      // Clean up
      battle.destroy()

      // Report progress periodically
      if ((round - startRound) % progressInterval === 0) {
        self.postMessage({
          type: 'progress',
          roundsCompleted: progressInterval,
        })
      }
    }

    self.postMessage({ type: 'complete', results })
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message })
  }
}
```

### 5.4 Seed Sequence

Determinism across batch runs requires a deterministic seed sequence:

```
masterSeed = 12345 (user-configurable)
round 1 seed  = hash(masterSeed, 1)  = 0xA3F1B2C4
round 2 seed  = hash(masterSeed, 2)  = 0x7E2D9F01
...
round N seed  = hash(masterSeed, N)
```

Each worker computes its own seeds from the master seed and round number. No communication needed. Two batch runs with the same master seed and round count produce identical results regardless of how many workers are used or how rounds are distributed.

### 5.5 Progress Reporting

Workers report progress every 1% of their assigned rounds. The main thread aggregates:

```
Worker 1: [======>    ] 60%  (750/1250 rounds)
Worker 2: [========>  ] 80%  (1000/1250 rounds)
Worker 3: [====>      ] 45%  (563/1250 rounds)
Worker 4: [=======>   ] 72%  (900/1250 rounds)
                              ----
Total:    [======>    ] 64%  (3213/5000 rounds)
```

### 5.6 Memory and Performance

Per worker:
- Game config: ~1 KB
- Simulation state: ~10 KB
- WASM modules (compiled): shared via `WebAssembly.Module` transfer (~50-200 KB each)
- WASM instances (per robot): 64 KB - 256 KB each (1 page minimum, 4 pages max)
- Per worker total: ~1-3 MB for 8 robots

With 8 workers: ~8-24 MB total. Negligible on modern hardware.

**Performance estimate** (see research/03-simulation-physics.md for derivation):
- Per-tick: ~45 us (with WASM), ~5 us (with JS test stubs)
- Per round (2000 ticks): ~90 ms (WASM), ~10 ms (JS)
- 10,000 rounds, 8 workers: ~112 seconds (WASM), ~12.5 seconds (JS)

---

## 6. Project Structure

```
src/
  simulation/
    types.ts                    # All interfaces: GameConfig, GameState, GameEvent,
                                # TickResult, BattleResult, RobotModule, RobotAPI, etc.
    constants.ts                # Default physics, spawning, scoring configs
    math.ts                     # Deterministic sin/cos/atan2, angle normalization,
                                # LUT generation
    rng.ts                      # Mulberry32 seeded PRNG
    battle.ts                   # createBattle(), Battle implementation
    tick.ts                     # Per-tick processing pipeline (steps 1-20)
    collision.ts                # All collision detection functions
    robot-runner.ts             # RobotRunner internal class, intent management
    robot-api.ts                # RobotAPI implementation (maps API calls to intents)
    wasm-adapter.ts             # WasmRobotAdapter (WASM robots)
    test-robot.ts               # createTestRobot() and TestRobotDef types
    scoring.ts                  # computeFinalScores, placement logic
    batch/
      batch-controller.ts       # Main thread batch orchestration
      simulation-worker.ts      # Web Worker entry point

  simulation/__tests__/
    math.test.ts                # Deterministic math function tests
    rng.test.ts                 # PRNG reproducibility tests
    movement.test.ts            # Robot movement, acceleration, deceleration
    turning.test.ts             # Body, gun, radar turn rates and setHeading
    collision.test.ts           # All collision types (bullet-robot, wall, robot-robot,
                                # mine, cookie)
    firing.test.ts              # Bullet creation, gun heat, energy cost
    scanning.test.ts            # Radar sweep detection, arc geometry
    damage.test.ts              # All damage formulas
    round-lifecycle.test.ts     # Round init, round-over conditions, scoring
    determinism.test.ts         # Run same battle twice, compare event logs
    intents.test.ts             # Intent collection, speed persistence, turn rate reset
    robot-api.test.ts           # API function correctness (getX, distanceTo, etc.)
    integration.test.ts         # Full battles with test stub robots
    batch.test.ts               # Batch runner (may use Node worker_threads for testing)

  simulation/__tests__/robots/
    stand-still.ts              # Test stub robots (one file each)
    straight-line.ts
    spin-and-fire.ts
    wall-seeker.ts
    ram-bot.ts
    radar-spinner.ts
    tracker-bot.ts
    mine-walker.ts
    cookie-seeker.ts
    determinism-bot.ts
```

---

## 7. Formulas Reference

All formulas in one place for quick reference during implementation.

### Movement

```
acceleration:    speed += min(accelerationRate, desiredSpeed - speed)
deceleration:    speed -= min(decelerationRate, speed - desiredSpeed)
position:        x += speed * cos(heading)
                 y += speed * sin(heading)
turn rate:       maxTurn = bodyTurnRateMax - bodyTurnRateSpeedFactor * |speed|
                 actual = clamp(requestedRate, -maxTurn, maxTurn)
```

### Combat

```
bullet speed:    speed = bulletSpeedBase - bulletSpeedPowerFactor * power
                       = 20 - 3 * power
bullet damage:   damage = bulletDamageBase * power
                          + max(0, bulletDamageBonusFactor * (power - bulletDamageBonusThreshold))
                        = 4 * power + max(0, 2 * (power - 1))
energy cost:     cost = power * fireCostMultiplier = power
gun heat:        heat = 1 + power / 5
gun cooldown:    heat -= gunCooldownRate (0.1 per tick)
energy regen:    energy += energyRegenRate (0.01 per tick)
```

### Damage Table

| Source          | Formula                                         | Example at max |
|-----------------|-------------------------------------------------|----------------|
| Bullet (pow 1)  | 4 * 1 + max(0, 2*(1-1)) = 4                   | 4 HP           |
| Bullet (pow 3)  | 4 * 3 + max(0, 2*(3-1)) = 16                  | 16 HP          |
| Bullet (pow 5)  | 4 * 5 + max(0, 2*(5-1)) = 28                  | 28 HP          |
| Wall collision   | max(0, \|speed\| * 0.5 - 1)                   | 3 HP at speed 8|
| Robot collision  | 0.6 (flat)                                     | 0.6 HP         |
| Mine             | 15 (flat)                                      | 15 HP          |

### Scoring (8 players)

| Placement | Points |
|-----------|--------|
| 1st       | 10     |
| 2nd       | 7      |
| 3rd       | 5      |
| 4th       | 3      |
| 5th       | 2      |
| 6th       | 1      |
| 7th       | 0      |
| 8th       | 0      |

### Turn Rates

| Component | Max Rate      | Notes                                    |
|-----------|---------------|------------------------------------------|
| Body      | 10 deg/tick   | Reduced by speed: 10 - 0.75*\|speed\|   |
| Gun       | 20 deg/tick   | Independent of body                      |
| Radar     | 45 deg/tick   | Independent of body and gun              |

---

## 8. Trade-offs and Decisions

### 8.1 State Representation: Plain Objects vs Classes

**Decision: Plain objects (interfaces only).**

Rationale: The game state must be serialized constantly (postMessage to workers, replay recording, debug inspection). Plain objects survive `structuredClone()` without any custom serialization logic. Classes with methods would require serialize/deserialize adapters everywhere. The simulation engine uses internal mutable state (for performance) and produces plain-object snapshots at the boundary.

The engine internals (`RobotRunner`, `Battle`) are classes with methods. Only the public-facing types (`GameState`, `GameEvent`, `TickResult`, etc.) are plain interfaces.

### 8.2 Mutable vs Immutable State Between Ticks

**Decision: Hybrid. Mutate internally, snapshot at the boundary.**

The engine maintains mutable `RobotRunner`, mutable bullet/mine/cookie arrays, etc. At the end of each tick (step 20), it produces an immutable `TickResult` by shallow-copying the state into plain objects. This gives us:
- Performance: no object allocation during physics processing.
- Safety: consumers cannot accidentally corrupt engine state.
- Replay: each `TickResult` is a self-contained snapshot.

The snapshot cost is trivial: copying 8 robot states + ~20 bullets + a few mines/cookies is ~50 object allocations per tick. At sub-microsecond cost per allocation, this is negligible.

### 8.3 Event Ordering Within a Tick

**Decision: Events are ordered by processing step, then by robot ID within each step.**

If bullet A hits robot 1 and bullet B hits robot 2 in the same tick, the events are ordered:
1. BulletHitEvent(A -> robot 1) — bullet A processed first (lower bullet ID)
2. BulletHitEvent(B -> robot 2)

If robot 1 and robot 2 both die in the same tick, both get the same placement number. Events are delivered in robot-ID order.

This ordering is deterministic and documented. The renderer can rely on event order for animation sequencing.

### 8.4 Radar Scan Geometry: Sweep vs Instantaneous

**Decision: Continuous sweep.**

The radar swept from its previous heading to its current heading during this tick. Any robot that falls within the swept arc (previous heading to current heading, plus scan width on each side) is detected. This means:
- A fast-spinning radar (45 deg/tick) with a 10-degree scan width effectively covers 55 degrees per tick, completing a full scan every ~6.5 ticks.
- A stationary radar only checks its current arc (no sweep benefit).
- The sweep model rewards radar movement and makes it harder to "hide" from a spinning radar.

The implementation is in Step 15 of the tick pipeline. The `isAngleInSweep` function handles the arc geometry.

### 8.5 PRNG Ownership

**Decision: The engine owns a master RNG. Each robot gets a derived RNG.**

```
Round RNG (from master seed + round number)
  |-- Robot 0 RNG (from round RNG)
  |-- Robot 1 RNG (from round RNG)
  |-- ...
  |-- Spawn RNG (for mines/cookies, from round RNG)
```

Each robot's `random()` and `randomFloat()` calls use that robot's RNG. This means robot 0 calling `random()` does not affect robot 1's random sequence. It also means adding or removing a `random()` call in one robot does not change the behavior of other robots -- essential for fair competition.

The spawn RNG is separate from robot RNGs so that mine/cookie placement is independent of robot behavior.

### 8.6 setHeading Behavior

**Decision: `setHeading(target)` turns toward the target at maximum rate. The engine calculates the shortest turn direction.**

When a robot calls `setHeading(90)` and its current heading is 350, the engine computes:
- Delta = normalizeAngle(90 - 350) = normalizeAngle(-260) = 100 (shortest path is +100 degrees)
- Max turn rate at current speed = 10 - 0.75 * |speed|
- This tick's turn = clamp(100, -maxRate, maxRate) = maxRate (e.g. 10 at speed 0)

The robot does not need to calculate turn direction. `setHeading` is a convenience that does the right thing. `setTurnRate` is the low-level alternative for manual control.

`setHeading` and `setTurnRate` are mutually exclusive per tick. The last one called wins. Internally, `setTurnRate` sets `intent.useSetHeading = false` and `setHeading` sets `intent.useSetHeading = true`.

### 8.7 Test Stubs vs WASM: Shared Interface

**Decision: Both use the exact same `RobotModule` interface. No adapter layer needed.**

The `RobotModule` interface (Section 3.1) is the universal contract. `WasmRobotAdapter` implements it for WASM robots. `createTestRobot()` implements it for TypeScript test stubs. The simulation engine treats them identically. This means:
- You can mix WASM and test stub robots in the same battle.
- Test stubs exercise the exact same code paths as real robots.
- No "test mode" vs "production mode" divergence.

The only difference is fuel metering: WASM robots have compiler-injected gas counting. Test stubs have no fuel limit. This is acceptable because test stubs are trusted code written by the engine developers, not untrusted user code.

### 8.8 Coordinate System

**Decision: Top-left origin (0, 0) internally. Heading 0 = right (east), 90 = down (south), following standard screen coordinates.**

This is the simplest coordinate system for wall collision checks and rendering. The research document suggested centered coordinates (-400 to 400, -300 to 300), but that adds unnecessary translation in every wall check and spawn position calculation.

If the robot-facing API should use a different convention (e.g., 0 = north), this can be translated in the API layer without affecting the simulation internals. For the MVP, keep it consistent: the API reports the same coordinates the engine uses.

Angles follow standard math convention mapped to screen coordinates:
- 0 degrees = right (+x direction)
- 90 degrees = down (+y direction)
- 180 degrees = left (-x direction)
- 270 degrees = up (-y direction)

### 8.9 What Happens When a Robot Traps (Runtime Error)

**Decision: The robot skips the rest of this tick. It remains alive and in the battle.**

Runtime errors (array out of bounds, stack overflow) cause the WASM instance to trap. The engine catches the trap, logs it to the debug panel, and the robot simply does nothing for the remainder of this tick. Its previously-set intents (from before the trap) are cleared. The robot's `tick()` will be called again next tick as normal.

This is forgiving by design. A bug should not instantly kill your robot -- it just costs you a tick of inaction. Persistent trapping (every tick) effectively makes the robot a sitting duck, which is punishment enough.

### 8.10 Dead Robot Cleanup

**Decision: Dead robots are removed from all collision checks immediately. Their state persists in the GameState (with `alive: false`) for display purposes but they are skipped in all physics processing.**

Dead robots do not block bullets, do not collide with other robots, cannot pick up cookies, and cannot trigger mines. Their WASM instances are not called. They exist in the state only so the renderer can show a death animation and the scoreboard can display final stats.
