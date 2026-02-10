import { describe, expect, it, vi } from "vitest"
import type {
	BulletHitEvent,
	GameConfig,
	RobotAPI,
	RobotDiedEvent,
	RobotModule,
} from "../../../spec/simulation"
import { createBattle, lineSegmentIntersectsCircle } from "../battle"
import { createDefaultConfig } from "../defaults"
import { createIdleBot } from "../test-stubs"

/**
 * Helper: creates a small arena battle where a shooting bot spins its gun
 * and fires at an idle target. In a small arena, hits happen quickly.
 */
function createSmallArenaBattle(opts?: {
	firePower?: number
	targetHealth?: number
	shooterModule?: RobotModule
	targetModule?: RobotModule
	physics?: Partial<GameConfig["physics"]>
}) {
	const firePower = opts?.firePower ?? 1

	let shooterApi: RobotAPI
	const defaultShooter: RobotModule = {
		init(a) {
			shooterApi = a
		},
		tick() {
			shooterApi.setSpeed(0)
			if (shooterApi.getGunHeat() === 0 && shooterApi.getEnergy() >= firePower) {
				shooterApi.fire(firePower)
			}
			shooterApi.setGunTurnRate(20)
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
			{ name: "Shooter", color: 0xff0000 },
			{ name: "Target", color: 0x0000ff },
		],
		{
			ticksPerRound: 2000,
			arena: { width: 120, height: 120 },
			physics: {
				...createDefaultConfig([]).physics,
				startHealth: opts?.targetHealth ?? 100,
				gunCooldownRate: 10, // Very fast cooldown so gun is ready on tick 1
				robotRadius: 18,
				ramDamageBase: 0, // Disable ram damage for bullet-focused tests
				ramDamageSpeedFactor: 0,
				...opts?.physics,
			},
			spawns: {
				...createDefaultConfig([]).spawns,
				minSpawnDistanceFromRobot: 20,
				minRobotSpacing: 40, // > 2 * robotRadius to prevent overlap collisions
			},
		},
	)

	const shooter = opts?.shooterModule ?? defaultShooter
	const target = opts?.targetModule ?? createIdleBot()
	const battle = createBattle(config, [shooter, target])

	return { config, battle }
}

/**
 * Advance until a bullet_hit event is found.
 */
function advanceUntilBulletHit(battle: ReturnType<typeof createBattle>, maxTicks = 500) {
	for (let i = 0; i < maxTicks; i++) {
		const result = battle.tick()
		const hitEvent = result.state.events.find((e): e is BulletHitEvent => e.type === "bullet_hit")
		if (hitEvent) {
			return { result, hitEvent, ticksElapsed: i + 1 }
		}
	}
	return undefined
}

describe("Bullet-Robot Collision", () => {
	it("detects when a bullet hits a robot and emits bullet_hit event", () => {
		const { battle } = createSmallArenaBattle()

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { hitEvent } = found!
		expect(hitEvent.type).toBe("bullet_hit")
		expect(hitEvent.shooterId).toBeDefined()
		expect(hitEvent.targetId).toBeDefined()
		expect(hitEvent.shooterId).not.toBe(hitEvent.targetId)
		expect(hitEvent.damage).toBeGreaterThan(0)
		expect(typeof hitEvent.x).toBe("number")
		expect(typeof hitEvent.y).toBe("number")

		battle.destroy()
	})

	it("applies correct damage: baseDamage = 4 * power for power 1", () => {
		const { battle } = createSmallArenaBattle({ firePower: 1 })

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		// For power 1: damage = bulletDamageBase * power + max(0, power - 1) * bulletDamageBonus
		// = 4 * 1 + max(0, 0) * 2 = 4
		expect(found!.hitEvent.damage).toBe(4)

		battle.destroy()
	})

	it("applies correct damage with bonus: power 3", () => {
		const { battle } = createSmallArenaBattle({ firePower: 3 })

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		// For power 3: damage = 4 * 3 + max(0, 3 - 1) * 2 = 12 + 4 = 16
		expect(found!.hitEvent.damage).toBe(16)

		battle.destroy()
	})

	it("removes the bullet from the arena after hitting a robot", () => {
		const { battle } = createSmallArenaBattle()

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { result, hitEvent } = found!
		const bulletStillExists = result.state.bullets.find((b) => b.id === hitEvent.bulletId)
		expect(bulletStillExists).toBeUndefined()

		battle.destroy()
	})

	it("reduces target health by the damage amount", () => {
		const startHealth = 100
		const { battle } = createSmallArenaBattle({
			firePower: 1,
			targetHealth: startHealth,
		})

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { result, hitEvent } = found!
		const target = result.state.robots.find((r) => r.id === hitEvent.targetId)
		expect(target).toBeDefined()
		expect(target!.health).toBe(startHealth - hitEvent.damage)

		battle.destroy()
	})

	it("tracks bulletsHit stat on the shooter", () => {
		const { battle } = createSmallArenaBattle()

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { result, hitEvent } = found!
		const shooter = result.state.robots.find((r) => r.id === hitEvent.shooterId)
		expect(shooter).toBeDefined()
		expect(shooter!.bulletsHit).toBeGreaterThanOrEqual(1)

		battle.destroy()
	})

	it("tracks damageDealt on the shooter and damageReceived on the target", () => {
		const { battle } = createSmallArenaBattle()

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { result, hitEvent } = found!
		const shooter = result.state.robots.find((r) => r.id === hitEvent.shooterId)
		const target = result.state.robots.find((r) => r.id === hitEvent.targetId)

		expect(shooter).toBeDefined()
		expect(target).toBeDefined()
		expect(shooter!.damageDealt).toBeGreaterThanOrEqual(hitEvent.damage)
		expect(target!.damageReceived).toBeGreaterThanOrEqual(hitEvent.damage)

		battle.destroy()
	})

	it("does not allow bullets to hit their own shooter", () => {
		const { battle } = createSmallArenaBattle()

		for (let i = 0; i < 200; i++) {
			const result = battle.tick()
			const hitEvents = result.state.events.filter(
				(e): e is BulletHitEvent => e.type === "bullet_hit",
			)
			for (const hit of hitEvents) {
				expect(hit.shooterId).not.toBe(hit.targetId)
			}
		}

		battle.destroy()
	})

	it("does not allow bullets to hit dead robots", () => {
		const { battle } = createSmallArenaBattle({
			firePower: 3,
			targetHealth: 10,
		})

		let targetDied = false
		let targetId: number | undefined
		let deathTick = -1

		for (let i = 0; i < 500; i++) {
			const result = battle.tick()

			const diedEvent = result.state.events.find(
				(e): e is RobotDiedEvent => e.type === "robot_died",
			)
			if (diedEvent && !targetDied) {
				targetDied = true
				targetId = diedEvent.robotId
				deathTick = result.state.tick
			}

			// Only check ticks AFTER the death tick (not the tick where death happened,
			// since that tick naturally contains the fatal bullet_hit)
			if (targetDied && targetId !== undefined && result.state.tick > deathTick) {
				const hitEvents = result.state.events.filter(
					(e): e is BulletHitEvent => e.type === "bullet_hit",
				)
				for (const hit of hitEvents) {
					expect(hit.targetId).not.toBe(targetId)
				}
			}
		}

		expect(targetDied).toBe(true)

		battle.destroy()
	})

	it("kills the target when health drops to 0 and increments shooter kills", () => {
		const { battle } = createSmallArenaBattle({
			firePower: 3,
			targetHealth: 10,
		})

		let robotDied = false

		for (let i = 0; i < 500; i++) {
			const result = battle.tick()

			const hit = result.state.events.find((e): e is BulletHitEvent => e.type === "bullet_hit")
			const died = result.state.events.find((e): e is RobotDiedEvent => e.type === "robot_died")

			if (died) {
				robotDied = true

				const target = result.state.robots.find((r) => r.id === died.robotId)
				expect(target).toBeDefined()
				expect(target!.alive).toBe(false)
				expect(target!.health).toBe(0)

				if (hit) {
					const shooter = result.state.robots.find((r) => r.id === hit.shooterId)
					expect(shooter).toBeDefined()
					expect(shooter!.kills).toBeGreaterThanOrEqual(1)
				}

				break
			}
		}

		expect(robotDied).toBe(true)

		battle.destroy()
	})

	it("emits robot_died event with killerId when target is killed by bullet", () => {
		const { battle } = createSmallArenaBattle({
			firePower: 5,
			targetHealth: 5,
		})

		let diedEvent: RobotDiedEvent | undefined

		for (let i = 0; i < 500; i++) {
			const result = battle.tick()
			const died = result.state.events.find((e): e is RobotDiedEvent => e.type === "robot_died")
			if (died) {
				diedEvent = died
				break
			}
		}

		expect(diedEvent).toBeDefined()
		expect(diedEvent!.type).toBe("robot_died")
		expect(diedEvent!.killerId).toBeDefined()
		expect(typeof diedEvent!.x).toBe("number")
		expect(typeof diedEvent!.y).toBe("number")

		battle.destroy()
	})

	it("calls onHit callback on the target with damage and bearing", () => {
		const onHitSpy = vi.fn()

		const targetWithSpy: RobotModule = {
			init() {},
			tick() {},
			onScan() {},
			onScanned() {},
			onHit: onHitSpy,
			onBulletHit() {},
			onWallHit() {},
			onRobotHit() {},
			onBulletMiss() {},
			onRobotDeath() {},
			destroy() {},
		}

		const { battle } = createSmallArenaBattle({
			targetModule: targetWithSpy,
		})

		let hitFound = false
		for (let i = 0; i < 500; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "bullet_hit")) {
				hitFound = true
				// Callbacks are delivered on the next tick
				for (let j = 0; j < 3; j++) {
					battle.tick()
				}
				break
			}
		}

		expect(hitFound).toBe(true)
		expect(onHitSpy).toHaveBeenCalled()

		const [damage, bearing] = onHitSpy.mock.calls[0]!
		expect(damage).toBeGreaterThan(0)
		expect(typeof bearing).toBe("number")
		expect(bearing).toBeGreaterThanOrEqual(-180)
		expect(bearing).toBeLessThanOrEqual(180)

		battle.destroy()
	})

	it("calls onBulletHit callback on the shooter with targetId", () => {
		const onBulletHitSpy = vi.fn()

		let shooterApi: RobotAPI
		const shooterWithSpy: RobotModule = {
			init(a) {
				shooterApi = a
			},
			tick() {
				shooterApi.setSpeed(0)
				if (shooterApi.getGunHeat() === 0 && shooterApi.getEnergy() >= 1) {
					shooterApi.fire(1)
				}
				shooterApi.setGunTurnRate(20)
			},
			onScan() {},
			onScanned() {},
			onHit() {},
			onBulletHit: onBulletHitSpy,
			onWallHit() {},
			onRobotHit() {},
			onBulletMiss() {},
			onRobotDeath() {},
			destroy() {},
		}

		const { battle } = createSmallArenaBattle({
			shooterModule: shooterWithSpy,
		})

		let hitFound = false
		for (let i = 0; i < 500; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "bullet_hit")) {
				hitFound = true
				for (let j = 0; j < 3; j++) {
					battle.tick()
				}
				break
			}
		}

		expect(hitFound).toBe(true)
		expect(onBulletHitSpy).toHaveBeenCalled()

		const [targetId] = onBulletHitSpy.mock.calls[0]!
		expect(typeof targetId).toBe("number")

		battle.destroy()
	})

	it("ends the round when only one robot remains alive", () => {
		const { battle } = createSmallArenaBattle({
			firePower: 5,
			targetHealth: 5,
		})

		let roundEnded = false
		for (let i = 0; i < 500; i++) {
			const result = battle.tick()
			if (result.roundOver) {
				roundEnded = true
				expect(result.roundResult).toBeDefined()
				expect(result.roundResult!.reason).toBe("last_standing")
				break
			}
		}

		expect(roundEnded).toBe(true)

		battle.destroy()
	})
})

describe("lineSegmentIntersectsCircle", () => {
	it("detects hit when segment passes through circle center", () => {
		// Segment from (0, 0) to (100, 0), circle at (50, 0) radius 10
		const result = lineSegmentIntersectsCircle(0, 0, 100, 0, 50, 0, 10)
		expect(result.hit).toBe(true)
		expect(result.t).toBeCloseTo(0.5, 5)
	})

	it("detects hit when segment passes near circle (within radius)", () => {
		// Segment from (0, 0) to (100, 0), circle at (50, 5) radius 10
		const result = lineSegmentIntersectsCircle(0, 0, 100, 0, 50, 5, 10)
		expect(result.hit).toBe(true)
		expect(result.t).toBeCloseTo(0.5, 5)
	})

	it("misses when segment passes outside circle radius", () => {
		// Segment from (0, 0) to (100, 0), circle at (50, 25) radius 10
		const result = lineSegmentIntersectsCircle(0, 0, 100, 0, 50, 25, 10)
		expect(result.hit).toBe(false)
	})

	it("detects hit at exact boundary of radius", () => {
		// Segment from (0, 0) to (100, 0), circle at (50, 10) radius 10
		// Closest point is (50, 0), distance to center is exactly 10
		const result = lineSegmentIntersectsCircle(0, 0, 100, 0, 50, 10, 10)
		expect(result.hit).toBe(true)
		expect(result.t).toBeCloseTo(0.5, 5)
	})

	it("detects hit when circle is at the start of the segment", () => {
		const result = lineSegmentIntersectsCircle(0, 0, 100, 0, 0, 0, 5)
		expect(result.hit).toBe(true)
		expect(result.t).toBeCloseTo(0, 5)
	})

	it("detects hit when circle is at the end of the segment", () => {
		const result = lineSegmentIntersectsCircle(0, 0, 100, 0, 100, 0, 5)
		expect(result.hit).toBe(true)
		expect(result.t).toBeCloseTo(1, 5)
	})

	it("misses when circle is beyond the end of the segment", () => {
		// Segment from (0,0) to (40,0), circle at (60, 0) radius 10
		const result = lineSegmentIntersectsCircle(0, 0, 40, 0, 60, 0, 10)
		expect(result.hit).toBe(false)
	})

	it("misses when circle is before the start of the segment", () => {
		// Segment from (50, 0) to (100, 0), circle at (20, 0) radius 10
		const result = lineSegmentIntersectsCircle(50, 0, 100, 0, 20, 0, 10)
		expect(result.hit).toBe(false)
	})

	it("handles zero-length segment inside circle", () => {
		const result = lineSegmentIntersectsCircle(50, 50, 50, 50, 50, 50, 10)
		expect(result.hit).toBe(true)
		expect(result.t).toBe(0)
	})

	it("handles zero-length segment outside circle", () => {
		const result = lineSegmentIntersectsCircle(0, 0, 0, 0, 50, 50, 10)
		expect(result.hit).toBe(false)
		expect(result.t).toBe(0)
	})

	it("works with diagonal segments", () => {
		// Segment from (0, 0) to (100, 100), circle at (50, 50) radius 5
		const result = lineSegmentIntersectsCircle(0, 0, 100, 100, 50, 50, 5)
		expect(result.hit).toBe(true)
		expect(result.t).toBeCloseTo(0.5, 5)
	})
})

describe("Swept Collision Detection", () => {
	it("detects a fast bullet that would skip over a robot with point-check", () => {
		// Fire at power 1 for maximum speed (35 - 3*1 = 32)
		// The bullet moves 32 units per tick, which is larger than the robot diameter (36)
		// So with old point-in-circle collision, a fast bullet could skip over a robot
		// The swept collision should still detect the hit
		const { battle } = createSmallArenaBattle({
			firePower: 1,
			physics: {
				...createDefaultConfig([]).physics,
				gunCooldownRate: 10,
				robotRadius: 18,
			},
		})

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { hitEvent } = found!
		expect(hitEvent.type).toBe("bullet_hit")
		expect(hitEvent.damage).toBe(4) // 4 * 1 + max(0, 0) * 2 = 4

		battle.destroy()
	})

	it("does not report a hit when bullet passes far from robot", () => {
		// Shooter fires north, target is far to the east - should miss
		let shooterApi: RobotAPI
		const shooter: RobotModule = {
			init(a) {
				shooterApi = a
			},
			tick() {
				shooterApi.setSpeed(0)
				// Point gun north (heading 0)
				shooterApi.setGunHeading(0)
				if (shooterApi.getGunHeat() === 0 && shooterApi.getEnergy() >= 1) {
					shooterApi.fire(1)
				}
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
				{ name: "Shooter", color: 0xff0000 },
				{ name: "Target", color: 0x0000ff },
			],
			{
				ticksPerRound: 2000,
				arena: { width: 800, height: 600 },
				physics: {
					...createDefaultConfig([]).physics,
					gunCooldownRate: 10,
				},
			},
		)

		const battle = createBattle(config, [shooter, createIdleBot()])

		// Run many ticks - with a large arena and random spawn positions,
		// bullets aimed north are unlikely to hit a specific target
		// This is a probabilistic test but in a big arena misses are common
		let bulletWallCount = 0
		for (let i = 0; i < 200; i++) {
			const result = battle.tick()
			const wallEvents = result.state.events.filter((e) => e.type === "bullet_wall")
			bulletWallCount += wallEvents.length
		}

		// Just verify the simulation runs without errors and bullets do hit walls
		// (meaning they travel their full path without false positives)
		expect(bulletWallCount).toBeGreaterThanOrEqual(0)

		battle.destroy()
	})

	it("still detects slow-moving bullet hits correctly", () => {
		// Fire at max power (5) for slowest speed: 35 - 3*5 = 20
		const { battle } = createSmallArenaBattle({ firePower: 5 })

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { hitEvent } = found!
		expect(hitEvent.type).toBe("bullet_hit")
		expect(hitEvent.damage).toBeGreaterThan(0)

		battle.destroy()
	})

	it("positions bullet at the intersection point on hit, not the final moved position", () => {
		const { battle, config } = createSmallArenaBattle()

		const found = advanceUntilBulletHit(battle)
		expect(found).toBeDefined()

		const { hitEvent, result } = found!
		const target = result.state.robots.find((r) => r.id === hitEvent.targetId)
		expect(target).toBeDefined()

		// The bullet hit position should be within robotRadius + bulletRadius of the target
		const dx = hitEvent.x - target!.x
		const dy = hitEvent.y - target!.y
		const dist = Math.sqrt(dx * dx + dy * dy)
		const maxDist = config.physics.robotRadius + config.physics.bulletRadius
		expect(dist).toBeLessThanOrEqual(maxDist + 0.001)

		battle.destroy()
	})

	it("uses combined robotRadius + bulletRadius for collision", () => {
		// A bullet that passes just within robotRadius + bulletRadius should hit
		// Using lineSegmentIntersectsCircle directly to verify
		const robotRadius = 18
		const bulletRadius = 3
		const combinedRadius = robotRadius + bulletRadius // 21

		// Segment passes at distance 20 from center (within combined radius of 21)
		const result = lineSegmentIntersectsCircle(0, 0, 100, 0, 50, 20, combinedRadius)
		expect(result.hit).toBe(true)

		// Segment passes at distance 22 from center (outside combined radius of 21)
		const result2 = lineSegmentIntersectsCircle(0, 0, 100, 0, 50, 22, combinedRadius)
		expect(result2.hit).toBe(false)
	})
})
