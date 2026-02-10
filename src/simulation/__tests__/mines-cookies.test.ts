import { describe, expect, it } from "vitest"
import type {
	CookiePickupEvent,
	CookieSpawnedEvent,
	GameConfig,
	MineDetonatedEvent,
	MineSpawnedEvent,
	RobotAPI,
	RobotModule,
} from "../../../spec/simulation"
import { createBattle } from "../battle"
import { createDefaultConfig } from "../defaults"
import { createIdleBot } from "../test-stubs"

/**
 * Create a config with sensible defaults for testing.
 */
function createTestConfig(overrides?: Partial<GameConfig>): GameConfig {
	return createDefaultConfig(
		[
			{ name: "Bot1", color: 0xff0000 },
			{ name: "Bot2", color: 0x0000ff },
		],
		{
			ticksPerRound: 2000,
			arena: { width: 800, height: 800 },
			...overrides,
		},
	)
}

/**
 * Create a bot that spins and moves, covering the maximum area.
 */
function createAreaCoverBot(): RobotModule {
	let api: RobotAPI
	return {
		init(a) {
			api = a
		},
		tick() {
			api.setSpeed(100)
			api.setTurnRate(5) // Spin to cover area
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

/**
 * Collision-focused config: small arena, many items, no other damage sources.
 */
function createCollisionConfig(
	overrides?: Partial<GameConfig> & {
		spawnsOverride?: Partial<GameConfig["spawns"]>
		physicsOverride?: Partial<GameConfig["physics"]>
	},
): GameConfig {
	return createTestConfig({
		arena: { width: 100, height: 100 },
		physics: {
			...createDefaultConfig([]).physics,
			wallDamageSpeedFactor: 0,
			ramDamageBase: 0,
			ramDamageSpeedFactor: 0,
			...overrides?.physicsOverride,
		},
		spawns: {
			...createDefaultConfig([]).spawns,
			minSpawnDistanceFromRobot: 5,
			minRobotSpacing: 20,
			...overrides?.spawnsOverride,
		},
		...overrides,
	})
}

describe("Mine Spawning", () => {
	it("spawns mines at the configured interval", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 10,
				mineMaxCount: 4,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		let mineSpawnCount = 0
		for (let i = 0; i < 30; i++) {
			const result = battle.tick()
			const spawnEvents = result.state.events.filter(
				(e): e is MineSpawnedEvent => e.type === "mine_spawned",
			)
			mineSpawnCount += spawnEvents.length
		}

		// With interval of 10, ticks 10, 20, and 30 should try to spawn mines
		expect(mineSpawnCount).toBeGreaterThanOrEqual(2)

		battle.destroy()
	})

	it("emits mine_spawned events with correct data", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 5,
				mineMaxCount: 4,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		let spawnEvent: MineSpawnedEvent | undefined
		for (let i = 0; i < 20; i++) {
			const result = battle.tick()
			const found = result.state.events.find(
				(e): e is MineSpawnedEvent => e.type === "mine_spawned",
			)
			if (found) {
				spawnEvent = found
				break
			}
		}

		expect(spawnEvent).toBeDefined()
		expect(spawnEvent!.type).toBe("mine_spawned")
		expect(typeof spawnEvent!.mineId).toBe("number")
		expect(spawnEvent!.x).toBeGreaterThan(0)
		expect(spawnEvent!.x).toBeLessThan(800)
		expect(spawnEvent!.y).toBeGreaterThan(0)
		expect(spawnEvent!.y).toBeLessThan(800)

		battle.destroy()
	})

	it("respects max mine count", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 1,
				mineMaxCount: 2,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		for (let i = 0; i < 50; i++) {
			battle.tick()
		}

		const state = battle.getState()
		expect(state.mines.length).toBeLessThanOrEqual(2)

		battle.destroy()
	})

	it("includes mines in GameState snapshot", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 1,
				mineMaxCount: 4,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		for (let i = 0; i < 5; i++) {
			battle.tick()
		}

		const state = battle.getState()
		expect(state.mines.length).toBeGreaterThanOrEqual(1)

		const mine = state.mines[0]!
		expect(typeof mine.id).toBe("number")
		expect(typeof mine.x).toBe("number")
		expect(typeof mine.y).toBe("number")

		battle.destroy()
	})
})

describe("Mine Explosion", () => {
	it("detonates when a robot moves over a mine", () => {
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 1,
				mineMaxCount: 20,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
			physicsOverride: {
				mineDamage: 5, // Low damage so robot survives
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let detonateEvent: MineDetonatedEvent | undefined
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			if (result.roundOver) break
			const found = result.state.events.find(
				(e): e is MineDetonatedEvent => e.type === "mine_detonated",
			)
			if (found) {
				detonateEvent = found
				break
			}
		}

		expect(detonateEvent).toBeDefined()
		expect(detonateEvent!.type).toBe("mine_detonated")
		expect(detonateEvent!.damage).toBe(5)

		battle.destroy()
	})

	it("removes the mine after detonation", () => {
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 1,
				mineMaxCount: 20,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
			physicsOverride: {
				mineDamage: 5,
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let detonatedMineId: number | undefined
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			if (result.roundOver) break
			const found = result.state.events.find(
				(e): e is MineDetonatedEvent => e.type === "mine_detonated",
			)
			if (found) {
				detonatedMineId = found.mineId
				const mineStillExists = result.state.mines.find((m) => m.id === detonatedMineId)
				expect(mineStillExists).toBeUndefined()
				break
			}
		}

		expect(detonatedMineId).toBeDefined()

		battle.destroy()
	})

	it("deals the configured mine damage", () => {
		const mineDamage = 25
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 1,
				mineMaxCount: 20,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
			physicsOverride: {
				mineDamage,
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let foundDamage = false
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			if (result.roundOver) break
			const found = result.state.events.find(
				(e): e is MineDetonatedEvent => e.type === "mine_detonated",
			)
			if (found) {
				expect(found.damage).toBe(mineDamage)
				foundDamage = true
				break
			}
		}

		expect(foundDamage).toBe(true)

		battle.destroy()
	})

	it("can kill a robot if health drops to zero from mine damage", () => {
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 1,
				mineMaxCount: 20,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
			},
			physicsOverride: {
				mineDamage: 200, // Instant kill
				startHealth: 100,
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let robotDied = false
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			const diedEvent = result.state.events.find((e) => e.type === "robot_died")
			const detonateEvent = result.state.events.find(
				(e): e is MineDetonatedEvent => e.type === "mine_detonated",
			)
			if (detonateEvent && diedEvent) {
				robotDied = true
				break
			}
			if (result.roundOver) break
		}

		expect(robotDied).toBe(true)

		battle.destroy()
	})
})

describe("Cookie Spawning", () => {
	it("spawns cookies at the configured interval", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 10,
				cookieMaxCount: 3,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		let cookieSpawnCount = 0
		for (let i = 0; i < 30; i++) {
			const result = battle.tick()
			const spawnEvents = result.state.events.filter(
				(e): e is CookieSpawnedEvent => e.type === "cookie_spawned",
			)
			cookieSpawnCount += spawnEvents.length
		}

		expect(cookieSpawnCount).toBeGreaterThanOrEqual(2)

		battle.destroy()
	})

	it("emits cookie_spawned events with correct data", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 5,
				cookieMaxCount: 3,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		let spawnEvent: CookieSpawnedEvent | undefined
		for (let i = 0; i < 20; i++) {
			const result = battle.tick()
			const found = result.state.events.find(
				(e): e is CookieSpawnedEvent => e.type === "cookie_spawned",
			)
			if (found) {
				spawnEvent = found
				break
			}
		}

		expect(spawnEvent).toBeDefined()
		expect(spawnEvent!.type).toBe("cookie_spawned")
		expect(typeof spawnEvent!.cookieId).toBe("number")
		expect(spawnEvent!.x).toBeGreaterThan(0)
		expect(spawnEvent!.x).toBeLessThan(800)
		expect(spawnEvent!.y).toBeGreaterThan(0)
		expect(spawnEvent!.y).toBeLessThan(800)

		battle.destroy()
	})

	it("respects max cookie count", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 1,
				cookieMaxCount: 2,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		for (let i = 0; i < 50; i++) {
			battle.tick()
		}

		const state = battle.getState()
		expect(state.cookies.length).toBeLessThanOrEqual(2)

		battle.destroy()
	})

	it("includes cookies in GameState snapshot", () => {
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 1,
				cookieMaxCount: 3,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		for (let i = 0; i < 5; i++) {
			battle.tick()
		}

		const state = battle.getState()
		expect(state.cookies.length).toBeGreaterThanOrEqual(1)

		const cookie = state.cookies[0]!
		expect(typeof cookie.id).toBe("number")
		expect(typeof cookie.x).toBe("number")
		expect(typeof cookie.y).toBe("number")

		battle.destroy()
	})
})

describe("Cookie Pickup", () => {
	it("picks up cookie when a robot moves over it", () => {
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 1,
				cookieMaxCount: 20,
			},
			physicsOverride: {
				cookieHealth: 5,
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let pickupEvent: CookiePickupEvent | undefined
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			if (result.roundOver) break
			const found = result.state.events.find(
				(e): e is CookiePickupEvent => e.type === "cookie_pickup",
			)
			if (found) {
				pickupEvent = found
				break
			}
		}

		expect(pickupEvent).toBeDefined()
		expect(pickupEvent!.type).toBe("cookie_pickup")

		battle.destroy()
	})

	it("heals the robot that picks up a cookie", () => {
		const cookieHealth = 15
		const startHealth = 50
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 1,
				cookieMaxCount: 20,
			},
			physicsOverride: {
				cookieHealth,
				startHealth,
				maxHealth: 100,
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let foundPickup = false
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			if (result.roundOver) break
			const found = result.state.events.find(
				(e): e is CookiePickupEvent => e.type === "cookie_pickup",
			)
			if (found) {
				expect(found.healthGained).toBe(cookieHealth)
				foundPickup = true
				break
			}
		}

		expect(foundPickup).toBe(true)

		battle.destroy()
	})

	it("does not heal above max health", () => {
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 1,
				cookieMaxCount: 20,
			},
			physicsOverride: {
				cookieHealth: 50,
				startHealth: 100,
				maxHealth: 100,
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let foundPickup = false
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			if (result.roundOver) break
			const found = result.state.events.find(
				(e): e is CookiePickupEvent => e.type === "cookie_pickup",
			)
			if (found) {
				// healthGained should be 0 since already at max
				expect(found.healthGained).toBe(0)
				const robot = result.state.robots.find((r) => r.id === found.robotId)
				expect(robot).toBeDefined()
				expect(robot!.health).toBeLessThanOrEqual(100)
				foundPickup = true
				break
			}
		}

		expect(foundPickup).toBe(true)

		battle.destroy()
	})

	it("removes the cookie after pickup", () => {
		const config = createCollisionConfig({
			spawnsOverride: {
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 1,
				cookieMaxCount: 20,
			},
			physicsOverride: {
				cookieHealth: 5,
			},
		})

		const battle = createBattle(config, [createAreaCoverBot(), createIdleBot()])

		let pickedUpCookieId: number | undefined
		for (let i = 0; i < 1000; i++) {
			const result = battle.tick()
			if (result.roundOver) break
			const found = result.state.events.find(
				(e): e is CookiePickupEvent => e.type === "cookie_pickup",
			)
			if (found) {
				pickedUpCookieId = found.cookieId
				const cookieStillExists = result.state.cookies.find((c) => c.id === pickedUpCookieId)
				expect(cookieStillExists).toBeUndefined()
				break
			}
		}

		expect(pickedUpCookieId).toBeDefined()

		battle.destroy()
	})
})

describe("Mine/Cookie spawn distance from robots", () => {
	it("mines spawn at least minSpawnDistanceFromRobot away from all alive robots", () => {
		const minDist = 80
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 1,
				mineMaxCount: 20,
				cookieSpawnInterval: 99999,
				cookieMaxCount: 0,
				minSpawnDistanceFromRobot: minDist,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		for (let i = 0; i < 20; i++) {
			const result = battle.tick()
			const spawnEvents = result.state.events.filter(
				(e): e is MineSpawnedEvent => e.type === "mine_spawned",
			)
			for (const spawnEvent of spawnEvents) {
				for (const robot of result.state.robots) {
					if (!robot.alive) continue
					const dx = robot.x - spawnEvent.x
					const dy = robot.y - spawnEvent.y
					const dist = Math.sqrt(dx * dx + dy * dy)
					expect(dist).toBeGreaterThanOrEqual(minDist)
				}
			}
		}

		battle.destroy()
	})

	it("cookies spawn at least minSpawnDistanceFromRobot away from all alive robots", () => {
		const minDist = 80
		const config = createTestConfig({
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 99999,
				mineMaxCount: 0,
				cookieSpawnInterval: 1,
				cookieMaxCount: 20,
				minSpawnDistanceFromRobot: minDist,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		for (let i = 0; i < 20; i++) {
			const result = battle.tick()
			const spawnEvents = result.state.events.filter(
				(e): e is CookieSpawnedEvent => e.type === "cookie_spawned",
			)
			for (const spawnEvent of spawnEvents) {
				for (const robot of result.state.robots) {
					if (!robot.alive) continue
					const dx = robot.x - spawnEvent.x
					const dy = robot.y - spawnEvent.y
					const dist = Math.sqrt(dx * dx + dy * dy)
					expect(dist).toBeGreaterThanOrEqual(minDist)
				}
			}
		}

		battle.destroy()
	})
})

describe("Round reset clears mines and cookies", () => {
	it("mines and cookies are cleared on next round", () => {
		const config = createTestConfig({
			ticksPerRound: 20,
			roundCount: 2,
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 1,
				mineMaxCount: 10,
				cookieSpawnInterval: 1,
				cookieMaxCount: 10,
				minSpawnDistanceFromRobot: 10,
			},
		})
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		// Run round 1 to completion
		battle.runRound()
		const stateAfterRound1 = battle.getState()
		const hadMines = stateAfterRound1.mines.length > 0
		const hadCookies = stateAfterRound1.cookies.length > 0
		expect(hadMines || hadCookies).toBe(true)

		// Start next round
		battle.nextRound()
		const stateAfterReset = battle.getState()
		expect(stateAfterReset.mines.length).toBe(0)
		expect(stateAfterReset.cookies.length).toBe(0)

		battle.destroy()
	})
})

describe("Initial state includes mines and cookies arrays", () => {
	it("initial state has empty mines and cookies arrays", () => {
		const config = createTestConfig()
		const battle = createBattle(config, [createIdleBot(), createIdleBot()])

		const state = battle.getState()
		expect(state.mines).toEqual([])
		expect(state.cookies).toEqual([])

		battle.destroy()
	})
})

describe("Determinism", () => {
	it("mine and cookie spawns are deterministic with same seed", () => {
		const config = createTestConfig({
			masterSeed: 42,
			spawns: {
				...createDefaultConfig([]).spawns,
				mineSpawnInterval: 5,
				mineMaxCount: 4,
				cookieSpawnInterval: 5,
				cookieMaxCount: 3,
			},
		})

		const battle1 = createBattle(config, [createIdleBot(), createIdleBot()])
		const battle2 = createBattle(config, [createIdleBot(), createIdleBot()])

		for (let i = 0; i < 50; i++) {
			battle1.tick()
			battle2.tick()
		}

		const state1 = battle1.getState()
		const state2 = battle2.getState()

		expect(state1.mines.length).toBe(state2.mines.length)
		expect(state1.cookies.length).toBe(state2.cookies.length)

		for (let i = 0; i < state1.mines.length; i++) {
			expect(state1.mines[i]!.x).toBe(state2.mines[i]!.x)
			expect(state1.mines[i]!.y).toBe(state2.mines[i]!.y)
		}

		for (let i = 0; i < state1.cookies.length; i++) {
			expect(state1.cookies[i]!.x).toBe(state2.cookies[i]!.x)
			expect(state1.cookies[i]!.y).toBe(state2.cookies[i]!.y)
		}

		battle1.destroy()
		battle2.destroy()
	})
})
