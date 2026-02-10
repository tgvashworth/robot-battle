/**
 * Simulation Module Interfaces
 *
 * This module defines:
 * 1. GameState — the canonical state type (superset, used by both sim and renderer)
 * 2. GameConfig — battle configuration
 * 3. GameEvent — things that happen during a tick
 * 4. RobotModule — the universal robot interface (WASM and test stubs)
 * 5. Battle — the simulation engine API
 * 6. Worker protocol — messages for batch simulation
 */

// ─── Game Configuration ───────────────────────────────────────────────────────

/**
 * Complete configuration for a battle. Immutable once created.
 * Passed to createBattle() and included in replays for reproducibility.
 */
export interface GameConfig {
	readonly arena: ArenaConfig
	readonly physics: PhysicsConfig
	readonly spawns: SpawnConfig
	readonly scoring: ScoringConfig
	readonly robots: readonly RobotConfig[]
	readonly ticksPerRound: number // default 2000
	readonly roundCount: number // default 1
	readonly masterSeed: number // seed for deterministic PRNG
}

export interface ArenaConfig {
	readonly width: number // default 800
	readonly height: number // default 600
}

export interface PhysicsConfig {
	// Movement
	readonly maxSpeed: number // default 100
	readonly acceleration: number // default 1.0 per tick
	readonly deceleration: number // default 2.0 per tick

	// Body rotation
	readonly maxTurnRate: number // default 10 deg/tick at speed 0
	readonly turnRateSpeedFactor: number // turn rate decreases with speed

	// Gun
	readonly maxGunTurnRate: number // default 20 deg/tick
	readonly gunHeatPerShot: number // default 1.0 + power/5
	readonly gunCooldownRate: number // default 0.1 per tick
	readonly minFirePower: number // default 1
	readonly maxFirePower: number // default 5

	// Radar
	readonly maxRadarTurnRate: number // default 45 deg/tick
	readonly defaultScanWidth: number // default 10 degrees
	readonly maxScanWidth: number // default 45 degrees
	readonly scanRange: number // default Infinity (whole arena)

	// Bullets
	readonly bulletSpeedBase: number // default 20
	readonly bulletSpeedPowerFactor: number // default 3 (speed = base - factor * power)
	readonly bulletDamageBase: number // default 4 * power
	readonly bulletDamageBonus: number // default 2 * (power - 1) (bonus for high power)

	// Damage
	readonly wallDamageSpeedFactor: number // damage = factor * abs(speed)
	readonly ramDamageBase: number // base ram damage
	readonly ramDamageSpeedFactor: number // damage = base + factor * relativeSpeed
	readonly mineDamage: number // default 30
	readonly cookieHealth: number // default 20

	// Energy
	readonly startEnergy: number // default 100
	readonly energyRegenRate: number // default 0.1 per tick
	readonly maxEnergy: number // default 100
	readonly fireCostFactor: number // energy cost = factor * power

	// Robot
	readonly startHealth: number // default 100
	readonly maxHealth: number // default 100
	readonly robotRadius: number // default 18
	readonly bulletRadius: number // default 3
	readonly cookieRadius: number // default 10
	readonly mineRadius: number // default 8

	// Fuel
	readonly fuelPerTick: number // default 10000 gas
}

export interface SpawnConfig {
	readonly mineSpawnInterval: number // ticks between mine spawns
	readonly mineMaxCount: number // max mines on field
	readonly cookieSpawnInterval: number // ticks between cookie spawns
	readonly cookieMaxCount: number // max cookies on field
	readonly minSpawnDistanceFromRobot: number // min distance from any robot
	readonly minRobotSpacing: number // min distance between robots at start
}

export interface ScoringConfig {
	/** Points awarded per placement. Index 0 = 1st place, etc. */
	readonly placementPoints: readonly number[]
}

export interface RobotConfig {
	/** Display name (from robot "Name" declaration). */
	readonly name: string

	/** Color for rendering (RGB hex, e.g., 0xFF0000). */
	readonly color: number

	/** Hash of the source code (for caching). */
	readonly sourceHash?: string
}

// ─── Game State (The Canonical Superset Type) ─────────────────────────────────

/**
 * Complete state of the game at a single tick. This is THE canonical type:
 * - The simulation engine produces it
 * - The renderer reads from it (ignoring fields it doesn't need)
 * - The replay system stores it
 * - The batch runner serializes it via postMessage
 *
 * All fields are readonly. The simulation engine creates a new snapshot each
 * tick by shallow-copying from its internal mutable state.
 */
export interface GameState {
	readonly tick: number
	readonly round: number
	readonly arena: ArenaConfig
	readonly robots: readonly RobotState[]
	readonly bullets: readonly BulletState[]
	readonly mines: readonly MineState[]
	readonly cookies: readonly CookieState[]
	readonly events: readonly GameEvent[]
}

export interface RobotState {
	/** Randomized ID (unique within a round, reshuffled between rounds). */
	readonly id: number

	/** Display name. */
	readonly name: string

	/** Display color (RGB hex). */
	readonly color: number

	// Position and movement
	readonly x: number
	readonly y: number
	readonly heading: number // body heading (degrees, 0=north, clockwise)
	readonly speed: number // current speed

	// Gun
	readonly gunHeading: number // absolute gun heading (degrees)
	readonly gunHeat: number // 0 = ready to fire

	// Radar
	readonly radarHeading: number // absolute radar heading (degrees)
	readonly scanWidth: number // current scan width (degrees)

	// Status
	readonly health: number // 0-100
	readonly energy: number // 0-100
	readonly alive: boolean
	readonly score: number // accumulated score this battle

	// Debug/stats (renderer can ignore these)
	readonly fuelUsedThisTick: number
	readonly ticksSurvived: number
	readonly damageDealt: number
	readonly damageReceived: number
	readonly bulletsFired: number
	readonly bulletsHit: number
	readonly kills: number
}

export interface BulletState {
	readonly id: number
	readonly ownerId: number // robot ID that fired this bullet
	readonly x: number
	readonly y: number
	readonly heading: number // degrees
	readonly speed: number
	readonly power: number
}

export interface MineState {
	readonly id: number
	readonly x: number
	readonly y: number
}

export interface CookieState {
	readonly id: number
	readonly x: number
	readonly y: number
}

// ─── Game Events ──────────────────────────────────────────────────────────────

/**
 * Discriminated union of all events that can occur during a tick.
 * These are emitted by the simulation engine AND consumed by the renderer
 * for visual effects. Both modules use the same event types.
 */
export type GameEvent =
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
	| ScannedEvent
	| MineSpawnedEvent
	| CookieSpawnedEvent
	| RoundOverEvent

export interface BulletFiredEvent {
	readonly type: "bullet_fired"
	readonly robotId: number
	readonly bulletId: number
	readonly x: number
	readonly y: number
	readonly heading: number
	readonly power: number
}

export interface BulletHitEvent {
	readonly type: "bullet_hit"
	readonly bulletId: number
	readonly shooterId: number
	readonly targetId: number
	readonly x: number
	readonly y: number
	readonly damage: number
}

export interface BulletWallEvent {
	readonly type: "bullet_wall"
	readonly bulletId: number
	readonly shooterId: number
	readonly x: number
	readonly y: number
}

export interface RobotHitEvent {
	readonly type: "robot_hit"
	readonly robotId: number
	readonly damage: number
	readonly bearing: number
}

export interface RobotDiedEvent {
	readonly type: "robot_died"
	readonly robotId: number
	readonly x: number
	readonly y: number
	readonly killerId?: number
}

export interface WallHitEvent {
	readonly type: "wall_hit"
	readonly robotId: number
	readonly x: number
	readonly y: number
	readonly damage: number
	readonly bearing: number
}

export interface RobotCollisionEvent {
	readonly type: "robot_collision"
	readonly robotId1: number
	readonly robotId2: number
	readonly x: number
	readonly y: number
	readonly damage1: number
	readonly damage2: number
}

export interface MineDetonatedEvent {
	readonly type: "mine_detonated"
	readonly mineId: number
	readonly robotId: number
	readonly x: number
	readonly y: number
	readonly damage: number
}

export interface CookiePickupEvent {
	readonly type: "cookie_pickup"
	readonly cookieId: number
	readonly robotId: number
	readonly x: number
	readonly y: number
	readonly healthGained: number
}

export interface ScanDetectionEvent {
	readonly type: "scan_detection"
	readonly scannerId: number
	readonly targetId: number
	readonly distance: number
	readonly bearing: number
	readonly scanStartAngle: number
	readonly scanEndAngle: number
}

export interface ScannedEvent {
	readonly type: "scanned"
	readonly targetId: number
	readonly bearing: number
}

export interface MineSpawnedEvent {
	readonly type: "mine_spawned"
	readonly mineId: number
	readonly x: number
	readonly y: number
}

export interface CookieSpawnedEvent {
	readonly type: "cookie_spawned"
	readonly cookieId: number
	readonly x: number
	readonly y: number
}

export interface RoundOverEvent {
	readonly type: "round_over"
	readonly round: number
	readonly placements: readonly RobotPlacement[]
	readonly reason: "last_standing" | "time_limit"
}

export interface RobotPlacement {
	readonly robotId: number
	readonly place: number // 1-based
	readonly points: number
	readonly alive: boolean
	readonly healthRemaining: number
}

// ─── Tick and Battle Results ──────────────────────────────────────────────────

export interface TickResult {
	readonly state: GameState
	readonly roundOver: boolean
	readonly roundResult?: RoundResult
}

export interface RoundResult {
	readonly round: number
	readonly placements: readonly RobotPlacement[]
	readonly totalTicks: number
	readonly seed: number
	readonly reason: "last_standing" | "time_limit"
}

export interface BattleResult {
	readonly config: GameConfig
	readonly rounds: readonly RoundResult[]
	readonly scores: readonly RobotScore[]
}

export interface RobotScore {
	readonly name: string
	readonly color: number
	readonly totalPoints: number
	readonly wins: number
	readonly roundsPlayed: number
	readonly avgPlacement: number
	readonly totalDamageDealt: number
	readonly totalDamageReceived: number
	readonly totalKills: number
	readonly avgTicksSurvived: number
}

// ─── Robot Module Interface ───────────────────────────────────────────────────

/**
 * The universal robot interface. Both compiled WASM robots and TypeScript
 * test stubs implement this. The simulation engine treats them identically.
 *
 * The simulation engine calls these methods. The robot calls RobotAPI methods
 * (provided via init()) to interact with the world.
 */
export interface RobotModule {
	/** Called once when the robot is instantiated. Receives the API object. */
	init(api: RobotAPI): void

	/** Called once per tick after events. The robot's main decision loop. */
	tick(): void

	// Event handlers (called before tick, in event order)
	onScan(distance: number, bearing: number): void
	onScanned(bearing: number): void
	onHit(damage: number, bearing: number): void
	onBulletHit(targetId: number): void
	onWallHit(bearing: number): void
	onRobotHit(bearing: number): void
	onBulletMiss(): void
	onRobotDeath(robotId: number): void

	/** Release resources (WASM instance, memory). */
	destroy(): void
}

/**
 * The API surface available to robots. Provided by the simulation engine
 * via init(). For WASM robots, these become WASM imports. For test stubs,
 * they're plain function calls.
 *
 * All "set" functions record intents — they don't take effect until the
 * engine processes them after tick() returns.
 *
 * All "get" functions return the current state as of the start of this tick.
 */
export interface RobotAPI {
	// Body movement
	setSpeed(speed: number): void
	setTurnRate(rate: number): void
	setHeading(heading: number): void
	getX(): number
	getY(): number
	getHeading(): number
	getSpeed(): number

	// Gun
	setGunTurnRate(rate: number): void
	setGunHeading(heading: number): void
	getGunHeading(): number
	getGunHeat(): number
	fire(power: number): void
	getEnergy(): number

	// Radar
	setRadarTurnRate(rate: number): void
	setRadarHeading(heading: number): void
	getRadarHeading(): number
	setScanWidth(degrees: number): void

	// Status
	getHealth(): number
	getTick(): number

	// Arena
	arenaWidth(): number
	arenaHeight(): number
	robotCount(): number

	// Utility
	distanceTo(x: number, y: number): number
	bearingTo(x: number, y: number): number
	random(max: number): number
	randomFloat(): number
	debugInt(value: number): void
	debugFloat(value: number): void
	debugAngle(value: number): void
	setColor(r: number, g: number, b: number): void
	setGunColor(r: number, g: number, b: number): void
	setRadarColor(r: number, g: number, b: number): void

	// Math builtins
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

// ─── Battle API ───────────────────────────────────────────────────────────────

/**
 * The simulation engine's public API. Created by createBattle().
 */
export interface Battle {
	/** Advance one tick. Returns the result including new state and events. */
	tick(): TickResult

	/** Run the current round to completion. Returns the round result. */
	runRound(): RoundResult

	/** Run all rounds to completion. Returns the full battle result. */
	run(): BattleResult

	/** Get the current game state (without advancing). */
	getState(): GameState

	/** Current tick number within the round. */
	getTick(): number

	/** Current round number. */
	getRound(): number

	/** Whether the current round has ended. */
	isRoundOver(): boolean

	/** Whether all rounds are complete. */
	isBattleOver(): boolean

	/** Start the next round (resets positions, keeps scores). */
	nextRound(): void

	/** Release all resources. */
	destroy(): void
}

/**
 * Top-level factory function. Pure — all state lives inside the returned Battle.
 */
export type CreateBattle = (config: GameConfig, robots: RobotModule[]) => Battle

// ─── Worker Protocol ──────────────────────────────────────────────────────────

/**
 * Messages sent from the main thread to a simulation Web Worker.
 */
export type WorkerCommand =
	| {
			type: "run_batch"
			config: GameConfig
			robotWasm: Uint8Array[]
			startRound: number
			endRound: number
	  }
	| { type: "cancel" }

/**
 * Messages sent from a simulation Web Worker back to the main thread.
 */
export type WorkerEvent =
	| { type: "progress"; roundsComplete: number; totalRounds: number }
	| { type: "round_result"; result: RoundResult }
	| { type: "batch_complete"; results: RoundResult[] }
	| { type: "error"; message: string }
