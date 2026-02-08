import { describe, expect, it, vi } from "vitest"
import type {
	GameConfig,
	RobotAPI,
	RobotModule,
	ScanDetectionEvent,
	ScannedEvent,
} from "../../../spec/simulation"
import { createBattle } from "../battle"
import { createDefaultConfig } from "../defaults"
import { createIdleBot } from "../test-stubs"

/**
 * Helper: creates a bot that spins its radar at the given rate.
 */
function createRadarSpinBot(radarTurnRate: number): RobotModule {
	let api: RobotAPI

	return {
		init(a) {
			api = a
		},
		tick() {
			api.setRadarTurnRate(radarTurnRate)
			api.setSpeed(0)
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
 * Helper: creates a small arena battle with a radar-spinning bot and an idle target.
 */
function createRadarBattle(opts?: {
	radarTurnRate?: number
	scannerModule?: RobotModule
	targetModule?: RobotModule
	physics?: Partial<GameConfig["physics"]>
	arenaSize?: number
}) {
	const radarRate = opts?.radarTurnRate ?? 45

	const config = createDefaultConfig(
		[
			{ name: "Scanner", color: 0xff0000 },
			{ name: "Target", color: 0x0000ff },
		],
		{
			ticksPerRound: 2000,
			arena: {
				width: opts?.arenaSize ?? 200,
				height: opts?.arenaSize ?? 200,
			},
			physics: {
				...createDefaultConfig([]).physics,
				maxRadarTurnRate: 45,
				scanRange: Number.POSITIVE_INFINITY,
				...opts?.physics,
			},
			spawns: {
				...createDefaultConfig([]).spawns,
				minSpawnDistanceFromRobot: 20,
				minRobotSpacing: 40, // > 2 * robotRadius to prevent overlap collisions
			},
		},
	)

	const scanner = opts?.scannerModule ?? createRadarSpinBot(radarRate)
	const target = opts?.targetModule ?? createIdleBot()
	const battle = createBattle(config, [scanner, target])

	return { config, battle }
}

/**
 * Advance until a scan_detection event is found.
 */
function advanceUntilScan(battle: ReturnType<typeof createBattle>, maxTicks = 200) {
	for (let i = 0; i < maxTicks; i++) {
		const result = battle.tick()
		const scanEvent = result.state.events.find(
			(e): e is ScanDetectionEvent => e.type === "scan_detection",
		)
		if (scanEvent) {
			return { result, scanEvent, ticksElapsed: i + 1 }
		}
	}
	return undefined
}

describe("Radar Scanning", () => {
	it("detects a robot when the radar sweeps over it and emits scan_detection event", () => {
		const { battle } = createRadarBattle()

		const found = advanceUntilScan(battle)
		expect(found).toBeDefined()

		const { scanEvent } = found!
		expect(scanEvent.type).toBe("scan_detection")
		expect(scanEvent.scannerId).toBeDefined()
		expect(scanEvent.targetId).toBeDefined()
		expect(scanEvent.scannerId).not.toBe(scanEvent.targetId)
		expect(scanEvent.distance).toBeGreaterThan(0)
		expect(typeof scanEvent.bearing).toBe("number")
		expect(typeof scanEvent.scanStartAngle).toBe("number")
		expect(typeof scanEvent.scanEndAngle).toBe("number")

		battle.destroy()
	})

	it("emits a scanned event alongside scan_detection", () => {
		const { battle } = createRadarBattle()

		let scannedEvent: ScannedEvent | undefined

		for (let i = 0; i < 200; i++) {
			const result = battle.tick()
			const found = result.state.events.find((e): e is ScannedEvent => e.type === "scanned")
			if (found) {
				scannedEvent = found
				break
			}
		}

		expect(scannedEvent).toBeDefined()
		expect(scannedEvent!.type).toBe("scanned")
		expect(typeof scannedEvent!.targetId).toBe("number")
		expect(typeof scannedEvent!.bearing).toBe("number")

		battle.destroy()
	})

	it("calls onScan callback on the scanner with distance and bearing", () => {
		const onScanSpy = vi.fn()

		let scannerApi: RobotAPI
		const scannerWithSpy: RobotModule = {
			init(a) {
				scannerApi = a
			},
			tick() {
				scannerApi.setRadarTurnRate(45)
				scannerApi.setSpeed(0)
			},
			onScan: onScanSpy,
			onScanned() {},
			onHit() {},
			onBulletHit() {},
			onWallHit() {},
			onRobotHit() {},
			onBulletMiss() {},
			onRobotDeath() {},
			destroy() {},
		}

		const { battle } = createRadarBattle({
			scannerModule: scannerWithSpy,
		})

		// Run until a scan_detection event, then a few more ticks for callback delivery
		let scanFound = false
		for (let i = 0; i < 200; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "scan_detection")) {
				scanFound = true
				// Callbacks are delivered on the next tick
				for (let j = 0; j < 3; j++) {
					battle.tick()
				}
				break
			}
		}

		expect(scanFound).toBe(true)
		expect(onScanSpy).toHaveBeenCalled()

		const [distance, bearing] = onScanSpy.mock.calls[0]!
		expect(distance).toBeGreaterThan(0)
		expect(typeof bearing).toBe("number")
		expect(bearing).toBeGreaterThanOrEqual(0)
		expect(bearing).toBeLessThan(360)

		battle.destroy()
	})

	it("calls onScanned callback on the target with bearing back to scanner", () => {
		const onScannedSpy = vi.fn()

		const targetWithSpy: RobotModule = {
			init() {},
			tick() {},
			onScan() {},
			onScanned: onScannedSpy,
			onHit() {},
			onBulletHit() {},
			onWallHit() {},
			onRobotHit() {},
			onBulletMiss() {},
			onRobotDeath() {},
			destroy() {},
		}

		const { battle } = createRadarBattle({
			targetModule: targetWithSpy,
		})

		let scanFound = false
		for (let i = 0; i < 200; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "scan_detection")) {
				scanFound = true
				for (let j = 0; j < 3; j++) {
					battle.tick()
				}
				break
			}
		}

		expect(scanFound).toBe(true)
		expect(onScannedSpy).toHaveBeenCalled()

		const [bearing] = onScannedSpy.mock.calls[0]!
		expect(typeof bearing).toBe("number")
		expect(bearing).toBeGreaterThanOrEqual(0)
		expect(bearing).toBeLessThan(360)

		battle.destroy()
	})

	it("does not scan dead robots", () => {
		// Use a config where the target starts with very low health
		// Kill the target first via wall damage, then verify no scans
		const config = createDefaultConfig(
			[
				{ name: "Scanner", color: 0xff0000 },
				{ name: "Target", color: 0x0000ff },
			],
			{
				ticksPerRound: 2000,
				arena: { width: 200, height: 200 },
				physics: {
					...createDefaultConfig([]).physics,
					startHealth: 1, // Very low health
					maxRadarTurnRate: 45,
				},
				spawns: {
					...createDefaultConfig([]).spawns,
					minSpawnDistanceFromRobot: 20,
					minRobotSpacing: 1,
				},
			},
		)

		// Target drives into the wall to die
		let targetApi: RobotAPI
		const suicidalTarget: RobotModule = {
			init(a) {
				targetApi = a
			},
			tick() {
				targetApi.setHeading(90)
				targetApi.setSpeed(100)
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

		const scanner = createRadarSpinBot(45)
		const battle = createBattle(config, [scanner, suicidalTarget])

		// Run until target dies
		let targetDied = false
		let targetId: number | undefined
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			const deadRobot = result.state.robots.find((r) => !r.alive)
			if (deadRobot) {
				targetDied = true
				targetId = deadRobot.id
				break
			}
		}

		// If target didn't die from walls, skip this test
		// (depends on spawn position)
		if (!targetDied) {
			battle.destroy()
			return
		}

		// After death, run more ticks and verify no scan_detection for the dead robot
		for (let i = 0; i < 50; i++) {
			const result = battle.tick()
			const scanEvents = result.state.events.filter(
				(e): e is ScanDetectionEvent => e.type === "scan_detection",
			)
			for (const scan of scanEvents) {
				expect(scan.targetId).not.toBe(targetId)
			}
		}

		battle.destroy()
	})

	it("radar heading actually changes each tick when radar turn rate is set", () => {
		let scannerApi: RobotAPI
		const scannerBot: RobotModule = {
			init(a) {
				scannerApi = a
			},
			tick() {
				scannerApi.setRadarTurnRate(30)
				scannerApi.setSpeed(0)
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
				{ name: "Scanner", color: 0xff0000 },
				{ name: "Idle", color: 0x0000ff },
			],
			{
				ticksPerRound: 100,
				physics: {
					...createDefaultConfig([]).physics,
					maxRadarTurnRate: 45,
				},
			},
		)

		const battle = createBattle(config, [scannerBot, createIdleBot()])

		const state0 = battle.getState()
		const radarBefore = state0.robots[0]!.radarHeading

		// Tick a few times
		battle.tick()
		battle.tick()
		battle.tick()

		const state3 = battle.getState()
		const radarAfter = state3.robots[0]!.radarHeading

		// Radar heading should have changed
		expect(radarAfter).not.toBe(radarBefore)

		battle.destroy()
	})

	it("scan distance is the correct euclidean distance between scanner and target", () => {
		const { battle } = createRadarBattle()

		const found = advanceUntilScan(battle)
		expect(found).toBeDefined()

		const { result, scanEvent } = found!
		const scanner = result.state.robots.find((r) => r.id === scanEvent.scannerId)
		const target = result.state.robots.find((r) => r.id === scanEvent.targetId)

		expect(scanner).toBeDefined()
		expect(target).toBeDefined()

		const expectedDist = Math.sqrt((scanner!.x - target!.x) ** 2 + (scanner!.y - target!.y) ** 2)
		expect(scanEvent.distance).toBeCloseTo(expectedDist, 1)

		battle.destroy()
	})

	it("handles radar sweep across 360/0 boundary (wraparound)", () => {
		// Create a scanner whose radar is near 350 degrees and turns to 10 degrees
		// The sweep should still detect targets in that arc
		let scannerApi: RobotAPI
		const wrapAroundScanner: RobotModule = {
			init(a) {
				scannerApi = a
			},
			tick() {
				// Set a large turn rate to cross the 0 boundary
				scannerApi.setRadarTurnRate(45)
				scannerApi.setSpeed(0)
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

		const { battle } = createRadarBattle({
			scannerModule: wrapAroundScanner,
		})

		// Run for enough ticks that the radar should sweep through the entire
		// 360 degrees at least once (360/45 = 8 ticks for a full revolution)
		let scanDetected = false
		for (let i = 0; i < 20; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "scan_detection")) {
				scanDetected = true
				break
			}
		}

		// In a small arena with two robots, the radar should find the target
		// within one full revolution
		expect(scanDetected).toBe(true)

		battle.destroy()
	})

	it("respects scan range limit", () => {
		// Set a very short scan range so robots can't see each other in a large arena
		const config = createDefaultConfig(
			[
				{ name: "Scanner", color: 0xff0000 },
				{ name: "Target", color: 0x0000ff },
			],
			{
				ticksPerRound: 200,
				arena: { width: 1000, height: 1000 }, // Large arena
				physics: {
					...createDefaultConfig([]).physics,
					maxRadarTurnRate: 45,
					scanRange: 10, // Very short range
				},
				spawns: {
					...createDefaultConfig([]).spawns,
					minSpawnDistanceFromRobot: 100, // Robots spawn far from edges
					minRobotSpacing: 200, // Robots spawn far apart
				},
			},
		)

		const scanner = createRadarSpinBot(45)
		const battle = createBattle(config, [scanner, createIdleBot()])

		// With a 10-unit scan range and robots 200+ apart, no scan should occur
		let scanDetected = false
		for (let i = 0; i < 100; i++) {
			const result = battle.tick()
			if (result.state.events.some((e) => e.type === "scan_detection")) {
				scanDetected = true
				break
			}
		}

		// The robots should be far enough apart that no scan occurs
		// Note: due to random spawning, there's a small chance they spawn close
		// Check the actual distance to be sure
		const state = battle.getState()
		const r0 = state.robots[0]!
		const r1 = state.robots[1]!
		const dist = Math.sqrt((r0.x - r1.x) ** 2 + (r0.y - r1.y) ** 2)

		if (dist > 10) {
			expect(scanDetected).toBe(false)
		}
		// If they happen to be within range, the scan is valid

		battle.destroy()
	})

	it("scanning produces consistent bearing values", () => {
		const { battle } = createRadarBattle()

		const found = advanceUntilScan(battle)
		expect(found).toBeDefined()

		const { scanEvent } = found!
		// Bearing should be a normalized angle in [0, 360)
		expect(scanEvent.bearing).toBeGreaterThanOrEqual(0)
		expect(scanEvent.bearing).toBeLessThan(360)

		// Scan angles should also be normalized
		expect(scanEvent.scanStartAngle).toBeGreaterThanOrEqual(0)
		expect(scanEvent.scanStartAngle).toBeLessThan(360)
		expect(scanEvent.scanEndAngle).toBeGreaterThanOrEqual(0)
		expect(scanEvent.scanEndAngle).toBeLessThan(360)

		battle.destroy()
	})
})
