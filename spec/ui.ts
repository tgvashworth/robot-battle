/**
 * UI Module Interfaces
 *
 * The UI module owns the React application shell, the code editor,
 * file management, and storage. It orchestrates the other modules
 * but doesn't implement game logic.
 *
 * Key boundaries:
 * - UI → Compiler: sends source code, receives CompileResult
 * - UI → Simulation: creates battles with GameConfig + RobotModules
 * - UI → Renderer: passes GameState frames to BattleRenderer
 * - UI → Storage: persists robot files and battle results
 */

import type { CompileResult } from "./compiler"
import type { BattleResult, GameConfig, GameState, RobotScore } from "./simulation"

// ─── Robot File Management ────────────────────────────────────────────────────

/**
 * A robot source file as managed by the UI.
 */
export interface RobotFile {
	/** Unique identifier (generated, for internal tracking). */
	readonly id: string

	/** File name (e.g., "SpinBot.rbl"). */
	readonly filename: string

	/** Source code content. */
	source: string

	/** Last compilation result, if any. */
	lastCompile?: CompileResult

	/** Timestamp of last modification. */
	lastModified: number
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Persistent storage for robot files and battle results.
 * Implemented over IndexedDB.
 */
export interface Storage {
	// Robot files
	listRobots(): Promise<RobotFile[]>
	getRobot(id: string): Promise<RobotFile | undefined>
	saveRobot(file: RobotFile): Promise<void>
	deleteRobot(id: string): Promise<void>
	importRobot(source: string, filename: string): Promise<RobotFile>
	exportRobot(id: string): Promise<string> // returns source code

	// Battle results
	saveBattleResult(result: BattleResult): Promise<string> // returns result ID
	getBattleResult(id: string): Promise<BattleResult | undefined>
	listBattleResults(): Promise<BattleResultSummary[]>
	deleteBattleResult(id: string): Promise<void>

	// Replay data
	saveReplay(battleId: string, frames: readonly GameState[]): Promise<void>
	getReplay(battleId: string): Promise<readonly GameState[] | undefined>
	deleteReplay(battleId: string): Promise<void>
}

export interface BattleResultSummary {
	readonly id: string
	readonly timestamp: number
	readonly robotNames: readonly string[]
	readonly roundCount: number
	readonly winner: string
}

// ─── Editor Integration ───────────────────────────────────────────────────────

/**
 * What the code editor needs from the compiler for live feedback.
 */
export interface EditorDiagnostic {
	readonly line: number
	readonly column: number
	readonly length: number
	readonly severity: "error" | "warning"
	readonly message: string
}

// ─── Tournament Configuration ─────────────────────────────────────────────────

export interface TournamentConfig {
	/** Robot files to include in the tournament. */
	readonly robotIds: readonly string[]

	/** Number of rounds per matchup. */
	readonly roundsPerMatch: number

	/** Arena configuration. */
	readonly arena: GameConfig["arena"]

	/** Ticks per round. */
	readonly ticksPerRound: number

	/** Master seed. */
	readonly seed: number
}

export interface TournamentProgress {
	readonly totalRounds: number
	readonly completedRounds: number
	readonly currentMatchup: string // e.g., "SpinBot vs TrackerBot"
	readonly estimatedTimeRemaining?: number // milliseconds
}

export interface TournamentResult {
	readonly config: TournamentConfig
	readonly leaderboard: readonly RobotScore[]
	readonly matchResults: readonly MatchResult[]
	readonly totalTime: number // milliseconds
}

export interface MatchResult {
	readonly robot1: string
	readonly robot2: string
	readonly robot1Wins: number
	readonly robot2Wins: number
	readonly draws: number
	readonly rounds: number
}

// ─── Debug Panel ──────────────────────────────────────────────────────────────

/**
 * Debug information for a single robot, displayed in the debug panel.
 */
export interface RobotDebugInfo {
	readonly robotId: number
	readonly robotName: string
	readonly log: readonly DebugEntry[]
	readonly globals: readonly GlobalValue[]
	readonly fuelUsedLastTick: number
	readonly errorsThisBattle: number
}

export interface DebugEntry {
	readonly tick: number
	readonly type: "int" | "float"
	readonly value: number
}

export interface GlobalValue {
	readonly name: string
	readonly type: string
	readonly value: string // formatted for display
}
