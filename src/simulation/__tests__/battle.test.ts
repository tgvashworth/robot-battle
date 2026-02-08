import { describe, expect, it } from "vitest"
import { createBattle } from "../battle"
import { createDefaultConfig } from "../defaults"
import { createIdleBot, createSpinBot } from "../test-stubs"

function twoIdleBots() {
	const config = createDefaultConfig([
		{ name: "Bot1", color: 0xff0000 },
		{ name: "Bot2", color: 0x0000ff },
	])
	const robots = [createIdleBot(), createIdleBot()]
	return { config, robots }
}

describe("Battle", () => {
	it("creates a battle and produces initial state", () => {
		const { config, robots } = twoIdleBots()
		const battle = createBattle(config, robots)

		const state = battle.getState()
		expect(state.tick).toBe(0)
		expect(state.round).toBe(1)
		expect(state.robots).toHaveLength(2)
		expect(state.robots[0]!.name).toBe("Bot1")
		expect(state.robots[1]!.name).toBe("Bot2")
		expect(state.robots[0]!.alive).toBe(true)
		expect(state.robots[0]!.health).toBe(100)

		battle.destroy()
	})

	it("advances ticks", () => {
		const { config, robots } = twoIdleBots()
		const battle = createBattle(config, robots)

		const result1 = battle.tick()
		expect(result1.state.tick).toBe(1)
		expect(result1.roundOver).toBe(false)

		const result2 = battle.tick()
		expect(result2.state.tick).toBe(2)

		battle.destroy()
	})

	it("robots start within the arena", () => {
		const { config, robots } = twoIdleBots()
		const battle = createBattle(config, robots)
		const state = battle.getState()

		for (const robot of state.robots) {
			expect(robot.x).toBeGreaterThan(0)
			expect(robot.x).toBeLessThan(config.arena.width)
			expect(robot.y).toBeGreaterThan(0)
			expect(robot.y).toBeLessThan(config.arena.height)
		}

		battle.destroy()
	})

	it("GameState is a plain object (survives structuredClone)", () => {
		const { config, robots } = twoIdleBots()
		const battle = createBattle(config, robots)

		battle.tick()
		const state = battle.getState()
		const cloned = structuredClone(state)

		expect(cloned.tick).toBe(state.tick)
		expect(cloned.robots[0]!.name).toBe(state.robots[0]!.name)
		expect(cloned.robots[0]!.x).toBe(state.robots[0]!.x)

		battle.destroy()
	})

	it("runs a round to completion", () => {
		const config = createDefaultConfig(
			[
				{ name: "Bot1", color: 0xff0000 },
				{ name: "Bot2", color: 0x0000ff },
			],
			{ ticksPerRound: 50 },
		)
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		const result = battle.runRound()
		expect(result.round).toBe(1)
		expect(result.totalTicks).toBe(50)
		expect(result.reason).toBe("time_limit")
		expect(result.placements).toHaveLength(2)
		expect(battle.isRoundOver()).toBe(true)

		battle.destroy()
	})

	it("spin bot moves and rotates", () => {
		const config = createDefaultConfig([
			{ name: "Spinner", color: 0xff0000 },
			{ name: "Idle", color: 0x0000ff },
		])
		const battle = createBattle(config, [createSpinBot(), createIdleBot()])

		const before = battle.getState()
		const spinnerBefore = before.robots[0]!

		// Run 10 ticks
		for (let i = 0; i < 10; i++) {
			battle.tick()
		}

		const after = battle.getState()
		const spinnerAfter = after.robots[0]!

		// Heading should have changed (spinning)
		expect(spinnerAfter.heading).not.toBe(spinnerBefore.heading)
		// Should have moved (speed > 0)
		const moved =
			Math.abs(spinnerAfter.x - spinnerBefore.x) > 0.01 ||
			Math.abs(spinnerAfter.y - spinnerBefore.y) > 0.01
		expect(moved).toBe(true)

		battle.destroy()
	})

	it("determinism: same seed produces same state", () => {
		const config = createDefaultConfig(
			[
				{ name: "Bot1", color: 0xff0000 },
				{ name: "Bot2", color: 0x0000ff },
			],
			{ masterSeed: 42 },
		)

		const battle1 = createBattle(config, [createSpinBot(), createSpinBot()])
		const battle2 = createBattle(config, [createSpinBot(), createSpinBot()])

		for (let i = 0; i < 20; i++) {
			battle1.tick()
			battle2.tick()
		}

		const state1 = battle1.getState()
		const state2 = battle2.getState()

		expect(state1.robots[0]!.x).toBe(state2.robots[0]!.x)
		expect(state1.robots[0]!.y).toBe(state2.robots[0]!.y)
		expect(state1.robots[0]!.heading).toBe(state2.robots[0]!.heading)

		battle1.destroy()
		battle2.destroy()
	})
})
