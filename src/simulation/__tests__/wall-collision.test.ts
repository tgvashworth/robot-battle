import { describe, expect, it } from "vitest"
import type { RobotAPI, RobotModule, WallHitEvent } from "../../../spec/simulation"
import { createBattle } from "../battle"
import { createDefaultConfig } from "../defaults"
import { createIdleBot, createWallSeekerBot } from "../test-stubs"

/**
 * Helper: creates a bot that drives east at a specific speed.
 * Heading is set to 90 (east) and speed to the given value.
 */
function createEastDrivingBot(speed: number): RobotModule {
	let api: RobotAPI

	return {
		init(a) {
			api = a
		},
		tick() {
			api.setHeading(90)
			api.setSpeed(speed)
		},
		onScan() {},
		onScanned() {},
		onHit() {},
		onBulletHit() {},
		onWallHit() {},
		onRobotHit() {},
		onBulletMiss() {},
		onRobotDeath() {},
		destroy() {},
	}
}

describe("Wall Collision", () => {
	it("applies wall damage based on speed * wallDamageSpeedFactor", () => {
		// Create a small arena so the bot hits the wall quickly
		const config = createDefaultConfig(
			[
				{ name: "WallBot", color: 0xff0000 },
				{ name: "Idle", color: 0x0000ff },
			],
			{
				arena: { width: 100, height: 100 },
				physics: {
					...createDefaultConfig([]).physics,
					// Speed 8, factor 0.5 => damage = 4
					wallDamageSpeedFactor: 0.5,
					maxSpeed: 100,
					acceleration: 100, // Instant acceleration for test clarity
					robotRadius: 18,
					startHealth: 100,
				},
				spawns: {
					...createDefaultConfig([]).spawns,
					minSpawnDistanceFromRobot: 1,
				},
				ticksPerRound: 500,
			},
		)

		// Create a bot that drives east at speed 8
		const bot = createEastDrivingBot(8)
		const battle = createBattle(config, [bot, createIdleBot()])

		// Run enough ticks so the robot reaches the wall
		let wallHitFound = false
		let damageOnHit = 0
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			const wallEvents = result.state.events.filter((e): e is WallHitEvent => e.type === "wall_hit")
			if (wallEvents.length > 0) {
				const event = wallEvents[0]!
				damageOnHit = event.damage
				wallHitFound = true
				break
			}
		}

		expect(wallHitFound).toBe(true)
		// Speed 8 * factor 0.5 = 4 damage
		expect(damageOnHit).toBe(4)

		battle.destroy()
	})

	it("emits WallHitEvent in state.events", () => {
		const config = createDefaultConfig(
			[
				{ name: "WallBot", color: 0xff0000 },
				{ name: "Idle", color: 0x0000ff },
			],
			{
				arena: { width: 100, height: 100 },
				spawns: {
					...createDefaultConfig([]).spawns,
					minSpawnDistanceFromRobot: 1,
				},
				ticksPerRound: 500,
			},
		)

		const battle = createBattle(config, [createWallSeekerBot(), createIdleBot()])

		let wallEvent: WallHitEvent | undefined
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			const found = result.state.events.find((e): e is WallHitEvent => e.type === "wall_hit")
			if (found) {
				wallEvent = found
				break
			}
		}

		expect(wallEvent).toBeDefined()
		expect(wallEvent!.type).toBe("wall_hit")
		expect(wallEvent!.robotId).toBeDefined()
		expect(wallEvent!.damage).toBeGreaterThan(0)
		expect(typeof wallEvent!.x).toBe("number")
		expect(typeof wallEvent!.y).toBe("number")
		expect(typeof wallEvent!.bearing).toBe("number")

		battle.destroy()
	})

	it("resets turn rate intents each tick but speed persists", () => {
		let api: RobotAPI

		// Bot that sets turn rate=5 and speed=30 only on first tick
		let firstTick = true
		const testBot: RobotModule = {
			init(a) {
				api = a
			},
			tick() {
				if (firstTick) {
					api.setTurnRate(5)
					api.setGunTurnRate(10)
					api.setRadarTurnRate(15)
					api.setSpeed(30)
					firstTick = false
				}
				// On subsequent ticks, don't call any setters
				// Turn rates should have been reset to 0
				// Speed should persist at 30
			},
			onScan() {},
			onScanned() {},
			onHit() {},
			onBulletHit() {},
			onWallHit() {},
			onRobotHit() {},
			onBulletMiss() {},
			onRobotDeath() {},
			destroy() {},
		}

		const config = createDefaultConfig(
			[
				{ name: "TestBot", color: 0xff0000 },
				{ name: "Idle", color: 0x0000ff },
			],
			{ ticksPerRound: 500 },
		)

		const battle = createBattle(config, [testBot, createIdleBot()])

		// Tick 1: bot sets turnRate=5, speed=30
		const r1 = battle.tick()
		const bot1 = r1.state.robots[0]!
		// After tick 1: heading changed by turn rate, speed ramping toward 30
		const headingAfter1 = bot1.heading
		expect(bot1.speed).toBeGreaterThan(0) // Speed is being applied

		// Tick 2: bot doesn't set any intents
		// Turn rates should have been reset, speed should persist
		const r2 = battle.tick()
		const bot2 = r2.state.robots[0]!
		// Heading should NOT change by turn rate (it was reset to 0)
		// However, the heading after tick 2 should be the same as after tick 1
		// because turn rate was reset to 0 before tick() on tick 2
		expect(bot2.heading).toBe(headingAfter1)
		// Speed should still be positive and accelerating toward 30
		expect(bot2.speed).toBeGreaterThan(0)

		// Tick 3: verify speed continues
		const r3 = battle.tick()
		const bot3 = r3.state.robots[0]!
		expect(bot3.heading).toBe(headingAfter1) // Still no turning
		expect(bot3.speed).toBeGreaterThanOrEqual(bot2.speed) // Speed persists/increases

		battle.destroy()
	})

	it("events survive structuredClone", () => {
		const config = createDefaultConfig(
			[
				{ name: "WallBot", color: 0xff0000 },
				{ name: "Idle", color: 0x0000ff },
			],
			{
				arena: { width: 100, height: 100 },
				spawns: {
					...createDefaultConfig([]).spawns,
					minSpawnDistanceFromRobot: 1,
				},
				ticksPerRound: 500,
			},
		)

		const battle = createBattle(config, [createWallSeekerBot(), createIdleBot()])

		let stateWithEvents: ReturnType<typeof battle.tick> | undefined
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			if (result.state.events.length > 0) {
				stateWithEvents = result
				break
			}
		}

		expect(stateWithEvents).toBeDefined()

		const cloned = structuredClone(stateWithEvents!.state)
		expect(cloned.events.length).toBeGreaterThan(0)
		expect(cloned.events[0]!.type).toBe(stateWithEvents!.state.events[0]!.type)

		const wallEvent = cloned.events.find((e): e is WallHitEvent => e.type === "wall_hit")
		expect(wallEvent).toBeDefined()
		expect(wallEvent!.damage).toBe(
			stateWithEvents!.state.events.find((e): e is WallHitEvent => e.type === "wall_hit")!.damage,
		)

		battle.destroy()
	})

	it("sets speed to zero on wall hit", () => {
		const config = createDefaultConfig(
			[
				{ name: "WallBot", color: 0xff0000 },
				{ name: "Idle", color: 0x0000ff },
			],
			{
				arena: { width: 100, height: 100 },
				spawns: {
					...createDefaultConfig([]).spawns,
					minSpawnDistanceFromRobot: 1,
				},
				ticksPerRound: 500,
			},
		)

		const battle = createBattle(config, [createWallSeekerBot(), createIdleBot()])

		let speedAfterWallHit: number | undefined
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			const wallEvents = result.state.events.filter((e) => e.type === "wall_hit")
			if (wallEvents.length > 0) {
				speedAfterWallHit = result.state.robots[0]!.speed
				break
			}
		}

		expect(speedAfterWallHit).toBeDefined()
		expect(speedAfterWallHit).toBe(0)

		battle.destroy()
	})
})
