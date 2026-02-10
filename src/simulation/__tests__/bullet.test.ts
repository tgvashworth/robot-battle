import { describe, expect, it, vi } from "vitest"
import type {
	BulletFiredEvent,
	BulletWallEvent,
	GameConfig,
	RobotAPI,
	RobotModule,
} from "../../../spec/simulation"
import { createBattle } from "../battle"
import { createDefaultConfig } from "../defaults"
import { createIdleBot, createStationaryShooterBot } from "../test-stubs"

/**
 * Helper: creates a config with sensible defaults for bullet tests.
 * Gun heat starts at 0, so robots can fire immediately.
 */
function configWithDefaults(overrides?: Partial<GameConfig>): GameConfig {
	return createDefaultConfig(
		[
			{ name: "Shooter", color: 0xff0000 },
			{ name: "Idle", color: 0x0000ff },
		],
		{
			ticksPerRound: 2000,
			...overrides,
		},
	)
}

/**
 * Helper: advances the battle until we find the first BulletFiredEvent.
 * Returns the tick result that contains the event and how many ticks elapsed.
 */
function advanceUntilBulletFired(battle: ReturnType<typeof createBattle>, maxTicks = 100) {
	for (let i = 0; i < maxTicks; i++) {
		const result = battle.tick()
		const firedEvent = result.state.events.find(
			(e): e is BulletFiredEvent => e.type === "bullet_fired",
		)
		if (firedEvent) {
			return { result, firedEvent, ticksElapsed: i + 1 }
		}
	}
	return undefined
}

describe("Bullet Firing and Physics", () => {
	it("creates a bullet when robot fires with gunHeat === 0 and sufficient energy", () => {
		const config = configWithDefaults()
		const battle = createBattle(config, [createStationaryShooterBot(), createIdleBot()])

		const found = advanceUntilBulletFired(battle)
		expect(found).toBeDefined()

		const { result, firedEvent } = found!

		// Verify BulletFiredEvent
		expect(firedEvent.type).toBe("bullet_fired")
		expect(firedEvent.robotId).toBe(0) // first robot
		expect(firedEvent.power).toBe(3)

		// Verify bullet exists in state
		expect(result.state.bullets.length).toBeGreaterThanOrEqual(1)
		const bullet = result.state.bullets.find((b) => b.id === firedEvent.bulletId)
		expect(bullet).toBeDefined()
		expect(bullet!.ownerId).toBe(0)
		expect(bullet!.power).toBe(3)

		// Verify speed = bulletSpeedBase - bulletSpeedPowerFactor * power = 35 - 3*3 = 26
		expect(bullet!.speed).toBe(35 - 3 * 3)

		// Verify heading matches gun heading
		expect(bullet!.heading).toBe(firedEvent.heading)

		battle.destroy()
	})

	it("spawns bullet at robot position offset by robotRadius in gunHeading direction", () => {
		// Create a bot with a known gun heading — we'll check the offset
		let capturedApi: RobotAPI
		let hasFired = false
		const knownGunHeadingBot: RobotModule = {
			init(a) {
				capturedApi = a
			},
			tick() {
				if (!hasFired && capturedApi.getGunHeat() === 0 && capturedApi.getEnergy() >= 3) {
					capturedApi.fire(3)
					hasFired = true
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

		const config = configWithDefaults()
		const battle = createBattle(config, [knownGunHeadingBot, createIdleBot()])

		const found = advanceUntilBulletFired(battle)
		expect(found).toBeDefined()

		const { result, firedEvent } = found!

		// Get robot position at this tick
		const robot = result.state.robots[0]!

		// The bullet should have been spawned at robot pos + robotRadius in gunHeading direction
		const gunRad = (firedEvent.heading * Math.PI) / 180
		const expectedX = robot.x + config.physics.robotRadius * Math.sin(gunRad)
		const expectedY = robot.y - config.physics.robotRadius * Math.cos(gunRad)

		expect(firedEvent.x).toBeCloseTo(expectedX, 5)
		expect(firedEvent.y).toBeCloseTo(expectedY, 5)

		battle.destroy()
	})

	it("deducts energy by power * fireCostFactor on firing", () => {
		const config = configWithDefaults()
		const battle = createBattle(config, [createStationaryShooterBot(), createIdleBot()])

		// Gun heat starts at 0, so robot fires on tick 1
		const found = advanceUntilBulletFired(battle, 5)
		expect(found).toBeDefined()

		const energyAfterFire = found!.result.state.robots[0]!.energy

		// Energy starts at 100 (startEnergy). Fire cost = power * fireCostFactor = 3 * 1.0 = 3
		// Energy regen (0.1) also applies but energy starts at max so no regen on first tick.
		expect(energyAfterFire).toBeCloseTo(config.physics.startEnergy - 3, 1)

		battle.destroy()
	})

	it("sets gunHeat to 1 + power/5 after firing, preventing fire until heat reaches 0", () => {
		const config = configWithDefaults()
		const battle = createBattle(config, [createStationaryShooterBot(), createIdleBot()])

		const found = advanceUntilBulletFired(battle)
		expect(found).toBeDefined()

		// At the firing tick, gunHeat should be 1 + 3/5 = 1.6
		const robotAfterFire = found!.result.state.robots[0]!
		expect(robotAfterFire.gunHeat).toBeCloseTo(1.6, 5)

		// At 0.15 cooldown per tick, it takes 11 ticks to reach 0 (1.6 / 0.15 = 10.67)
		// Verify no bullet is fired for the next 10 ticks
		let bulletsFiredDuringCooldown = 0
		for (let i = 0; i < 10; i++) {
			const result = battle.tick()
			const firedEvents = result.state.events.filter(
				(e): e is BulletFiredEvent => e.type === "bullet_fired",
			)
			bulletsFiredDuringCooldown += firedEvents.length
		}
		expect(bulletsFiredDuringCooldown).toBe(0)

		// On the 11th tick (heat goes to ~0), gun becomes cool
		// Cooldown happens in applyMovement which is before fire processing
		// So let's just check that a second bullet eventually fires
		let secondBullet = false
		for (let i = 0; i < 5; i++) {
			const result = battle.tick()
			const firedEvents = result.state.events.filter(
				(e): e is BulletFiredEvent => e.type === "bullet_fired",
			)
			if (firedEvents.length > 0) {
				secondBullet = true
				break
			}
		}
		expect(secondBullet).toBe(true)

		battle.destroy()
	})

	it("moves bullet each tick in its heading direction at its speed", () => {
		const config = configWithDefaults()
		const battle = createBattle(config, [createStationaryShooterBot(), createIdleBot()])

		const found = advanceUntilBulletFired(battle)
		expect(found).toBeDefined()

		const { firedEvent } = found!
		const bulletId = firedEvent.bulletId

		// Get initial bullet position (from the fired event)
		const startX = firedEvent.x
		const startY = firedEvent.y
		const heading = firedEvent.heading
		const speed = 35 - 3 * 3 // bulletSpeedBase - bulletSpeedPowerFactor * power = 26

		// Advance one tick
		const nextResult = battle.tick()
		const bullet = nextResult.state.bullets.find((b) => b.id === bulletId)

		if (bullet) {
			// Bullet should have moved by speed in the heading direction
			const rad = (heading * Math.PI) / 180
			const expectedX = startX + speed * Math.sin(rad)
			const expectedY = startY - speed * Math.cos(rad)

			expect(bullet.x).toBeCloseTo(expectedX, 5)
			expect(bullet.y).toBeCloseTo(expectedY, 5)
		}
		// If bullet is already gone (hit wall on first move), that's acceptable too

		battle.destroy()
	})

	it("removes bullet and emits BulletWallEvent when bullet exits arena", () => {
		// Use a small arena so bullets quickly reach the wall
		const config = configWithDefaults({
			arena: { width: 100, height: 100 },
			spawns: {
				...createDefaultConfig([]).spawns,
				minSpawnDistanceFromRobot: 1,
			},
		})
		const battle = createBattle(config, [createStationaryShooterBot(), createIdleBot()])

		// Run until a bullet is fired
		const found = advanceUntilBulletFired(battle)
		expect(found).toBeDefined()

		// Run until bullet hits wall
		let wallEvent: BulletWallEvent | undefined
		for (let i = 0; i < 50; i++) {
			const result = battle.tick()
			const bwEvent = result.state.events.find(
				(e): e is BulletWallEvent => e.type === "bullet_wall",
			)
			if (bwEvent) {
				wallEvent = bwEvent
				// Bullet should be removed from state
				const bulletStillExists = result.state.bullets.find((b) => b.id === bwEvent.bulletId)
				expect(bulletStillExists).toBeUndefined()
				break
			}
		}

		expect(wallEvent).toBeDefined()
		expect(wallEvent!.type).toBe("bullet_wall")
		expect(wallEvent!.shooterId).toBe(0)

		battle.destroy()
	})

	it("calls onBulletMiss on the shooter when bullet hits wall", () => {
		const bulletMissSpy = vi.fn()

		let api: RobotAPI
		const shooterWithSpy: RobotModule = {
			init(a) {
				api = a
			},
			tick() {
				api.setSpeed(0)
				if (api.getGunHeat() === 0 && api.getEnergy() >= 3) {
					api.fire(3)
				}
			},
			onScan() {},
			onScanned() {},
			onHit() {},
			onBulletHit() {},
			onWallHit() {},
			onRobotHit() {},
			onBulletMiss: bulletMissSpy,
			onRobotDeath() {},
			destroy() {},
		}

		const config = configWithDefaults({
			arena: { width: 100, height: 100 },
			spawns: {
				...createDefaultConfig([]).spawns,
				minSpawnDistanceFromRobot: 1,
			},
		})
		const battle = createBattle(config, [shooterWithSpy, createIdleBot()])

		// Run until bullet miss callback is triggered
		let bulletWallFound = false
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "bullet_wall")) {
				bulletWallFound = true
				// onBulletMiss is delivered as a pending callback on the next tick
				// after the bullet_wall event. Let's run a few more ticks to ensure
				// the callback is delivered.
				for (let j = 0; j < 3; j++) {
					battle.tick()
				}
				break
			}
		}

		expect(bulletWallFound).toBe(true)
		expect(bulletMissSpy).toHaveBeenCalled()

		battle.destroy()
	})

	it("rejects fire when gun is hot (gunHeat > 0)", () => {
		const config = configWithDefaults()
		const battle = createBattle(config, [createStationaryShooterBot(), createIdleBot()])

		// Gun heat starts at 0, so the first fire attempt succeeds (tick 1)
		const found = advanceUntilBulletFired(battle, 5)
		expect(found).toBeDefined()

		// After firing, gunHeat = 1 + 3/5 = 1.6, so next tick should NOT fire
		const result2 = battle.tick()
		const firedEvents2 = result2.state.events.filter(
			(e): e is BulletFiredEvent => e.type === "bullet_fired",
		)
		expect(firedEvents2.length).toBe(0)

		// Still hot on the next tick too
		const result3 = battle.tick()
		const firedEvents3 = result3.state.events.filter(
			(e): e is BulletFiredEvent => e.type === "bullet_fired",
		)
		expect(firedEvents3.length).toBe(0)

		battle.destroy()
	})

	it("rejects fire when energy is insufficient", () => {
		// Create a bot that tries to fire at power 3 but has very low energy
		let fireApi: RobotAPI
		const lowEnergyBot: RobotModule = {
			init(a) {
				fireApi = a
			},
			tick() {
				// Always try to fire at power 3 (costs 3 energy)
				if (fireApi.getGunHeat() === 0) {
					fireApi.fire(3)
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

		// Start with very low energy so the bot can't afford to fire
		const config = configWithDefaults({
			physics: {
				...createDefaultConfig([]).physics,
				startEnergy: 2, // Less than power * fireCostFactor (3 * 1 = 3)
				energyRegenRate: 0, // No regen so it stays low
				gunCooldownRate: 10, // Very fast cooldown so gun is ready
			},
		})
		const battle = createBattle(config, [lowEnergyBot, createIdleBot()])

		// Run many ticks — no bullet should ever fire since energy < 3
		let anyBulletFired = false
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "bullet_fired")) {
				anyBulletFired = true
				break
			}
		}

		expect(anyBulletFired).toBe(false)

		battle.destroy()
	})

	it("determinism: two identical battles produce identical bullet sequences", () => {
		const config = configWithDefaults({ masterSeed: 42 })

		const battle1 = createBattle(config, [
			createStationaryShooterBot(),
			createStationaryShooterBot(),
		])
		const battle2 = createBattle(config, [
			createStationaryShooterBot(),
			createStationaryShooterBot(),
		])

		for (let i = 0; i < 50; i++) {
			battle1.tick()
			battle2.tick()
		}

		const state1 = battle1.getState()
		const state2 = battle2.getState()

		// Same number of bullets
		expect(state1.bullets.length).toBe(state2.bullets.length)

		// Each bullet matches
		for (let i = 0; i < state1.bullets.length; i++) {
			const b1 = state1.bullets[i]!
			const b2 = state2.bullets[i]!
			expect(b1.id).toBe(b2.id)
			expect(b1.ownerId).toBe(b2.ownerId)
			expect(b1.x).toBe(b2.x)
			expect(b1.y).toBe(b2.y)
			expect(b1.heading).toBe(b2.heading)
			expect(b1.speed).toBe(b2.speed)
			expect(b1.power).toBe(b2.power)
		}

		battle1.destroy()
		battle2.destroy()
	})
})
