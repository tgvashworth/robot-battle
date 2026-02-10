import type { RobotModule, ScoringConfig } from "../../spec/simulation"
import { createBattle } from "./battle"
import { createDefaultConfig } from "./defaults"

// ─── Tournament Types ─────────────────────────────────────────────────────────

export interface TournamentRobotEntry {
	readonly rosterId: string
	readonly name: string
	readonly color: number
}

export interface TournamentConfig {
	readonly entries: readonly TournamentRobotEntry[]
	readonly gameCount: number
	readonly baseSeed: number
	readonly ticksPerRound: number
	readonly scoring: ScoringConfig
}

export interface GamePlacement {
	readonly rosterId: string
	readonly name: string
	readonly health: number
	readonly alive: boolean
	readonly place: number
}

export interface GameResult {
	readonly gameIndex: number
	readonly seed: number
	readonly placements: readonly GamePlacement[]
}

export interface TournamentStanding {
	readonly rosterId: string
	readonly name: string
	readonly points: number
	readonly wins: number
	readonly gamesPlayed: number
}

export interface TournamentResults {
	readonly standings: readonly TournamentStanding[]
	readonly gameResults: readonly GameResult[]
}

// ─── Single Game Runner ───────────────────────────────────────────────────────

/**
 * Run a single game with the given modules and seed.
 * Returns the placement results. Caller is responsible for
 * providing fresh RobotModule instances (WASM must be re-instantiated).
 */
export function runSingleGame(
	entries: readonly TournamentRobotEntry[],
	modules: RobotModule[],
	gameIndex: number,
	seed: number,
	ticksPerRound: number,
	scoring: ScoringConfig,
): GameResult {
	const config = createDefaultConfig(
		entries.map((e) => ({ name: e.name, color: e.color })),
		{ ticksPerRound, masterSeed: seed, scoring },
	)

	const battle = createBattle(config, modules)

	// Run the round to completion
	while (!battle.isRoundOver()) {
		battle.tick()
	}

	// Get final state and determine placements
	const finalState = battle.getState()
	const sortedRobots = [...finalState.robots].sort((a, b) => {
		if (a.alive !== b.alive) return a.alive ? -1 : 1
		return b.health - a.health
	})

	const placements: GamePlacement[] = sortedRobots.map((robot, i) => {
		const entry = entries[robot.id]
		return {
			rosterId: entry?.rosterId ?? `unknown-${robot.id}`,
			name: robot.name,
			health: robot.health,
			alive: robot.alive,
			place: i + 1,
		}
	})

	battle.destroy()

	return {
		gameIndex,
		seed,
		placements,
	}
}

// ─── Score Calculation ────────────────────────────────────────────────────────

/**
 * Calculate cumulative standings from a list of game results.
 */
export function calculateStandings(
	entries: readonly TournamentRobotEntry[],
	gameResults: readonly GameResult[],
	scoring: ScoringConfig,
): TournamentStanding[] {
	const scoreMap = new Map<
		string,
		{ rosterId: string; name: string; points: number; wins: number; gamesPlayed: number }
	>()

	// Initialize all entries
	for (const entry of entries) {
		scoreMap.set(entry.rosterId, {
			rosterId: entry.rosterId,
			name: entry.name,
			points: 0,
			wins: 0,
			gamesPlayed: 0,
		})
	}

	// Accumulate results
	for (const result of gameResults) {
		for (const placement of result.placements) {
			const score = scoreMap.get(placement.rosterId)
			if (!score) continue

			score.gamesPlayed++
			const placementPoints = scoring.placementPoints[placement.place - 1] ?? 0
			score.points += placementPoints

			if (placement.place === 1) {
				score.wins++
			}
		}
	}

	// Sort by points descending, then wins descending
	const standings = [...scoreMap.values()]
	standings.sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points
		return b.wins - a.wins
	})

	return standings
}

// ─── Tournament Runner ────────────────────────────────────────────────────────

export interface TournamentCallbacks {
	onGameComplete?: (gameIndex: number, result: GameResult) => void
	/** Return true to abort the tournament early */
	shouldAbort?: () => boolean
}

/**
 * Run a full tournament using test stub robot modules.
 * For WASM robots, use runTournamentAsync which re-instantiates modules per game.
 */
export function runTournament(
	config: TournamentConfig,
	createModules: () => RobotModule[],
	callbacks?: TournamentCallbacks,
): TournamentResults {
	const gameResults: GameResult[] = []

	for (let i = 0; i < config.gameCount; i++) {
		if (callbacks?.shouldAbort?.()) break

		const seed = config.baseSeed + i
		const modules = createModules()

		const result = runSingleGame(
			config.entries,
			modules,
			i,
			seed,
			config.ticksPerRound,
			config.scoring,
		)

		gameResults.push(result)
		callbacks?.onGameComplete?.(i, result)
	}

	const standings = calculateStandings(config.entries, gameResults, config.scoring)

	return { standings, gameResults }
}

/**
 * Run a tournament asynchronously, yielding between games to keep the UI responsive.
 * Accepts a factory that creates fresh RobotModule instances for each game
 * (necessary for WASM modules which have mutable state).
 */
export async function runTournamentAsync(
	config: TournamentConfig,
	createModules: () => Promise<RobotModule[]>,
	callbacks?: TournamentCallbacks,
): Promise<TournamentResults> {
	const gameResults: GameResult[] = []

	for (let i = 0; i < config.gameCount; i++) {
		if (callbacks?.shouldAbort?.()) break

		const seed = config.baseSeed + i
		const modules = await createModules()

		const result = runSingleGame(
			config.entries,
			modules,
			i,
			seed,
			config.ticksPerRound,
			config.scoring,
		)

		gameResults.push(result)
		callbacks?.onGameComplete?.(i, result)

		// Yield to the event loop every game to keep UI responsive
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0)
		})
	}

	const standings = calculateStandings(config.entries, gameResults, config.scoring)

	return { standings, gameResults }
}
