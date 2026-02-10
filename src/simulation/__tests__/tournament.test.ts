import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SCORING } from "../defaults"
import { createIdleBot, createSpinBot } from "../test-stubs"
import { calculateStandings, runSingleGame, runTournament } from "../tournament"
import type { GameResult, TournamentConfig, TournamentRobotEntry } from "../tournament"

const ENTRIES: TournamentRobotEntry[] = [
	{ rosterId: "r1", name: "Bot1", color: 0xff0000 },
	{ rosterId: "r2", name: "Bot2", color: 0x0000ff },
]

describe("runSingleGame", () => {
	it("returns placements for all robots", () => {
		const modules = [createIdleBot(), createIdleBot()]
		const result = runSingleGame(ENTRIES, modules, 0, 42, 100, DEFAULT_SCORING)

		expect(result.gameIndex).toBe(0)
		expect(result.seed).toBe(42)
		expect(result.placements).toHaveLength(2)

		const rosterIds = result.placements.map((p) => p.rosterId)
		expect(rosterIds).toContain("r1")
		expect(rosterIds).toContain("r2")
	})

	it("uses different seeds for different games", () => {
		const result1 = runSingleGame(
			ENTRIES,
			[createSpinBot(), createSpinBot()],
			0,
			100,
			200,
			DEFAULT_SCORING,
		)
		const result2 = runSingleGame(
			ENTRIES,
			[createSpinBot(), createSpinBot()],
			1,
			101,
			200,
			DEFAULT_SCORING,
		)

		expect(result1.seed).not.toBe(result2.seed)
	})

	it("assigns placement places from 1 to N", () => {
		const modules = [createIdleBot(), createIdleBot()]
		const result = runSingleGame(ENTRIES, modules, 0, 42, 100, DEFAULT_SCORING)

		const places = result.placements.map((p) => p.place).sort((a, b) => a - b)
		expect(places).toEqual([1, 2])
	})
})

describe("calculateStandings", () => {
	it("returns standings for all entries", () => {
		const standings = calculateStandings(ENTRIES, [], DEFAULT_SCORING)
		expect(standings).toHaveLength(2)
		expect(standings[0]!.points).toBe(0)
		expect(standings[0]!.wins).toBe(0)
		expect(standings[0]!.gamesPlayed).toBe(0)
	})

	it("accumulates points from placements", () => {
		const gameResults: GameResult[] = [
			{
				gameIndex: 0,
				seed: 1,
				placements: [
					{ rosterId: "r1", name: "Bot1", health: 50, alive: true, place: 1 },
					{ rosterId: "r2", name: "Bot2", health: 0, alive: false, place: 2 },
				],
			},
			{
				gameIndex: 1,
				seed: 2,
				placements: [
					{ rosterId: "r2", name: "Bot2", health: 80, alive: true, place: 1 },
					{ rosterId: "r1", name: "Bot1", health: 0, alive: false, place: 2 },
				],
			},
		]

		const standings = calculateStandings(ENTRIES, gameResults, DEFAULT_SCORING)

		// Both bots won once: 3 pts for 1st + 1 pt for 2nd = 4 pts each
		const bot1 = standings.find((s) => s.rosterId === "r1")!
		const bot2 = standings.find((s) => s.rosterId === "r2")!

		expect(bot1.points).toBe(4) // 3 (1st) + 1 (2nd)
		expect(bot1.wins).toBe(1)
		expect(bot1.gamesPlayed).toBe(2)

		expect(bot2.points).toBe(4) // 1 (2nd) + 3 (1st)
		expect(bot2.wins).toBe(1)
		expect(bot2.gamesPlayed).toBe(2)
	})

	it("sorts by points descending", () => {
		const gameResults: GameResult[] = [
			{
				gameIndex: 0,
				seed: 1,
				placements: [
					{ rosterId: "r1", name: "Bot1", health: 50, alive: true, place: 1 },
					{ rosterId: "r2", name: "Bot2", health: 0, alive: false, place: 2 },
				],
			},
		]

		const standings = calculateStandings(ENTRIES, gameResults, DEFAULT_SCORING)
		expect(standings[0]!.rosterId).toBe("r1")
		expect(standings[0]!.points).toBe(3)
		expect(standings[1]!.rosterId).toBe("r2")
		expect(standings[1]!.points).toBe(1)
	})
})

describe("runTournament", () => {
	it("runs the correct number of games", () => {
		const config: TournamentConfig = {
			entries: ENTRIES,
			gameCount: 5,
			baseSeed: 100,
			ticksPerRound: 50,
			scoring: DEFAULT_SCORING,
		}

		const results = runTournament(config, () => [createIdleBot(), createIdleBot()])

		expect(results.gameResults).toHaveLength(5)
		expect(results.standings).toHaveLength(2)
	})

	it("calls onGameComplete after each game", () => {
		const onGameComplete = vi.fn()
		const config: TournamentConfig = {
			entries: ENTRIES,
			gameCount: 3,
			baseSeed: 100,
			ticksPerRound: 50,
			scoring: DEFAULT_SCORING,
		}

		runTournament(config, () => [createIdleBot(), createIdleBot()], {
			onGameComplete,
		})

		expect(onGameComplete).toHaveBeenCalledTimes(3)
		expect(onGameComplete).toHaveBeenCalledWith(0, expect.objectContaining({ gameIndex: 0 }))
		expect(onGameComplete).toHaveBeenCalledWith(1, expect.objectContaining({ gameIndex: 1 }))
		expect(onGameComplete).toHaveBeenCalledWith(2, expect.objectContaining({ gameIndex: 2 }))
	})

	it("uses sequential seeds based on baseSeed", () => {
		const config: TournamentConfig = {
			entries: ENTRIES,
			gameCount: 3,
			baseSeed: 1000,
			ticksPerRound: 50,
			scoring: DEFAULT_SCORING,
		}

		const results = runTournament(config, () => [createIdleBot(), createIdleBot()])

		expect(results.gameResults[0]!.seed).toBe(1000)
		expect(results.gameResults[1]!.seed).toBe(1001)
		expect(results.gameResults[2]!.seed).toBe(1002)
	})

	it("respects shouldAbort callback", () => {
		let gamesRun = 0
		const config: TournamentConfig = {
			entries: ENTRIES,
			gameCount: 100,
			baseSeed: 100,
			ticksPerRound: 50,
			scoring: DEFAULT_SCORING,
		}

		const results = runTournament(config, () => [createIdleBot(), createIdleBot()], {
			onGameComplete: () => {
				gamesRun++
			},
			shouldAbort: () => gamesRun >= 3,
		})

		expect(results.gameResults.length).toBeLessThanOrEqual(4)
		expect(gamesRun).toBeLessThanOrEqual(4)
	})

	it("accumulates tournament standings correctly over multiple games", () => {
		const config: TournamentConfig = {
			entries: ENTRIES,
			gameCount: 10,
			baseSeed: 42,
			ticksPerRound: 100,
			scoring: DEFAULT_SCORING,
		}

		const results = runTournament(config, () => [createSpinBot(), createIdleBot()])

		// Each game has 2 robots, so total games played per robot = 10
		for (const standing of results.standings) {
			expect(standing.gamesPlayed).toBe(10)
		}

		// Total points distributed should equal (3+1) * 10 = 40
		const totalPoints = results.standings.reduce((sum, s) => sum + s.points, 0)
		expect(totalPoints).toBe(40)

		// Total wins should be 10 (one winner per game)
		const totalWins = results.standings.reduce((sum, s) => sum + s.wins, 0)
		expect(totalWins).toBe(10)
	})

	it("handles three robots with custom scoring", () => {
		const threeEntries: TournamentRobotEntry[] = [
			{ rosterId: "r1", name: "Bot1", color: 0xff0000 },
			{ rosterId: "r2", name: "Bot2", color: 0x00ff00 },
			{ rosterId: "r3", name: "Bot3", color: 0x0000ff },
		]

		const customScoring = { placementPoints: [5, 3, 1] }

		const config: TournamentConfig = {
			entries: threeEntries,
			gameCount: 5,
			baseSeed: 99,
			ticksPerRound: 100,
			scoring: customScoring,
		}

		const results = runTournament(config, () => [createSpinBot(), createIdleBot(), createIdleBot()])

		expect(results.standings).toHaveLength(3)
		expect(results.gameResults).toHaveLength(5)

		// Total points per game = 5+3+1 = 9, times 5 games = 45
		const totalPoints = results.standings.reduce((sum, s) => sum + s.points, 0)
		expect(totalPoints).toBe(45)
	})
})
