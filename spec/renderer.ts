/**
 * Renderer Module Interfaces
 *
 * Boundary: GameState (from simulation) → Canvas pixels
 *
 * The renderer is a pure consumer of GameState. It has no knowledge of
 * WASM, the compiler, or robot code. It reads state and draws.
 *
 * The renderer also provides the GameLoop (bridges simulation ticks to
 * requestAnimationFrame) and the ReplaySource (plays back recorded frames).
 */

import type { ArenaConfig, GameConfig, GameState } from "./simulation"

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * The battle renderer. Manages all PixiJS objects and draws frames.
 * Created imperatively, not through React reconciliation.
 */
export interface BattleRenderer {
	/** Initialize the renderer on a canvas element. */
	init(canvas: HTMLCanvasElement, arena: ArenaConfig): void

	/** Push a new game state frame. The renderer will draw it. */
	pushFrame(state: GameState): void

	/**
	 * Draw an interpolated frame between the last two pushed states.
	 * @param alpha - Interpolation factor (0 = previous frame, 1 = current frame)
	 */
	render(alpha: number): void

	/** Handle canvas resize. */
	resize(width: number, height: number): void

	/** Update rendering options (grid, effects, etc.) */
	setOptions(options: Partial<RenderOptions>): void

	/** Release all PixiJS resources. */
	destroy(): void
}

export interface RenderOptions {
	readonly showGrid: boolean
	readonly showDamageNumbers: boolean
	readonly showScanArcs: boolean
	readonly showHealthBars: boolean
	readonly showNames: boolean
	readonly backgroundColor: number // hex color, default 0x111118
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

/**
 * Bridges a TickSource (live simulation or replay) to the renderer.
 * Manages the fixed-timestep + interpolation game loop.
 */
export interface GameLoop {
	/** Start the game loop (begins requestAnimationFrame). */
	start(): void

	/** Stop the game loop. */
	stop(): void

	/** Set playback speed multiplier (0.5, 1, 2, 4, 8). */
	setSpeed(multiplier: number): void

	/** Pause playback (freezes on current frame). */
	pause(): void

	/** Resume playback. */
	resume(): void

	/** Advance exactly one tick (while paused). */
	step(): void

	/** Whether the loop is currently paused. */
	isPaused(): boolean

	/** Current playback speed multiplier. */
	getSpeed(): number

	/** Release resources. */
	destroy(): void
}

// ─── Tick Source ───────────────────────────────────────────────────────────────

/**
 * Abstraction over "something that produces game states tick by tick."
 * Both live simulation and replay implement this.
 */
export interface TickSource {
	/** Advance one tick and return the new state. */
	tick(): GameState

	/** Whether there are more ticks available. */
	hasNext(): boolean

	/** Current tick number. */
	currentTick(): number

	/** Total ticks in this source (known for replays, estimated for live). */
	totalTicks(): number
}

// ─── Replay ───────────────────────────────────────────────────────────────────

/**
 * A recorded battle that can be played back. Implements TickSource.
 * Created from an array of GameState snapshots.
 */
export interface ReplayData {
	readonly config: GameConfig
	readonly frames: readonly GameState[]
}
