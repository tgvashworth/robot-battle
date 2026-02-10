import type {
	Battle,
	BattleResult,
	BulletFiredEvent,
	BulletHitEvent,
	BulletState,
	BulletWallEvent,
	GameConfig,
	GameEvent,
	GameState,
	RobotAPI,
	RobotCollisionEvent,
	RobotDiedEvent,
	RobotModule,
	RobotState,
	RoundResult,
	ScanDetectionEvent,
	ScannedEvent,
	TickResult,
	WallHitEvent,
} from "../../spec/simulation"
import { PRNG } from "./prng"

/**
 * Internal mutable state for a single robot during simulation.
 */
interface InternalRobot {
	readonly module: RobotModule
	readonly config: GameConfig["robots"][number]
	id: number
	x: number
	y: number
	heading: number
	speed: number
	gunHeading: number
	gunHeat: number
	radarHeading: number
	scanWidth: number
	health: number
	energy: number
	alive: boolean
	score: number
	fuelUsedThisTick: number
	ticksSurvived: number
	damageDealt: number
	damageReceived: number
	bulletsFired: number
	bulletsHit: number
	kills: number

	// Intent registers (set by robot, consumed by engine)
	intendedSpeed: number
	intendedTurnRate: number
	intendedGunTurnRate: number
	intendedRadarTurnRate: number
	intendedFire: number

	// Pending event callbacks
	pendingWallHitBearing: number | undefined
	pendingRobotHitBearing: number | undefined
	pendingBulletMiss: boolean
	pendingHitDamage: number | undefined
	pendingHitBearing: number | undefined
	pendingBulletHitTargetId: number | undefined
	pendingOnScan: Array<{ distance: number; bearing: number }>
	pendingOnScanned: Array<{ bearing: number }>
	pendingRobotDeaths: number[]

	// Radar sweep tracking
	prevRadarHeading: number
}

/**
 * Internal mutable state for a bullet in flight.
 */
interface InternalBullet {
	id: number
	ownerId: number
	x: number
	y: number
	heading: number
	speed: number
	power: number
}

export function createBattle(config: GameConfig, robots: RobotModule[]): Battle {
	const rng = new PRNG(config.masterSeed)
	let tick = 0
	let round = 1
	let roundOver = false
	let battleOver = false
	const allRoundResults: RoundResult[] = []
	let bullets: InternalBullet[] = []
	let nextBulletId = 0
	// Track robot pairs currently in collision (only apply damage on initial contact)
	const collidingPairs = new Set<string>()

	// Initialize robots
	const internalRobots: InternalRobot[] = robots.map((module, i) => {
		const rc = config.robots[i]!
		return createInternalRobot(module, rc, i, config, rng)
	})

	// Give each robot its API and call init()
	for (const robot of internalRobots) {
		const api = createRobotAPI(robot, config, () => tick, rng)
		robot.module.init(api)
	}

	// Accumulated events for the current tick
	let tickEvents: GameEvent[] = []

	function snapshot(): GameState {
		return {
			tick,
			round,
			arena: config.arena,
			robots: internalRobots.map(snapshotRobot),
			bullets: bullets.map(snapshotBullet),
			mines: [],
			cookies: [],
			events: [...tickEvents],
		}
	}

	function doTick(): TickResult {
		tick++

		// Clear events for this tick
		tickEvents = []

		// Save radar headings before any updates this tick
		for (const robot of internalRobots) {
			robot.prevRadarHeading = robot.radarHeading
		}

		// Reset per-tick intents (speed persists)
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			robot.intendedTurnRate = 0
			robot.intendedGunTurnRate = 0
			robot.intendedRadarTurnRate = 0
			robot.intendedFire = 0
		}

		// Step 1: Move bullets (save previous positions for swept collision)
		const bulletPrevPositions = new Map<number, { prevX: number; prevY: number }>()
		for (const bullet of bullets) {
			bulletPrevPositions.set(bullet.id, { prevX: bullet.x, prevY: bullet.y })
			const rad = (bullet.heading * Math.PI) / 180
			bullet.x += bullet.speed * Math.sin(rad)
			bullet.y -= bullet.speed * Math.cos(rad)
		}

		// Step 2: Bullet-robot swept collision detection
		const bulletsHitRobot = new Set<number>()
		const collisionRadius = config.physics.robotRadius + config.physics.bulletRadius
		for (const bullet of bullets) {
			if (bulletsHitRobot.has(bullet.id)) continue
			const prev = bulletPrevPositions.get(bullet.id)!
			for (const target of internalRobots) {
				if (!target.alive) continue
				if (target.id === bullet.ownerId) continue

				// Swept line-segment vs circle test
				const result = lineSegmentIntersectsCircle(
					prev.prevX,
					prev.prevY,
					bullet.x,
					bullet.y,
					target.x,
					target.y,
					collisionRadius,
				)

				if (result.hit) {
					// Position bullet at the intersection point along the segment
					const hitX = prev.prevX + result.t * (bullet.x - prev.prevX)
					const hitY = prev.prevY + result.t * (bullet.y - prev.prevY)
					bullet.x = hitX
					bullet.y = hitY

					// Hit! Calculate damage
					const damage =
						config.physics.bulletDamageBase * bullet.power +
						Math.max(0, bullet.power - 1) * config.physics.bulletDamageBonus

					// Apply damage to target
					target.health = Math.max(0, target.health - damage)
					target.damageReceived += damage

					// Award energy back to shooter
					const shooter = internalRobots.find((r) => r.id === bullet.ownerId)
					if (shooter?.alive) {
						const energyReturn = 3 * bullet.power
						shooter.energy = Math.min(config.physics.maxEnergy, shooter.energy + energyReturn)
						shooter.bulletsHit++
						shooter.damageDealt += damage

						// Queue onBulletHit callback for shooter
						shooter.pendingBulletHitTargetId = target.id
					}

					// Calculate bearing from target to bullet (relative to target heading)
					const bearingAbsolute = normalizeAngle(
						(Math.atan2(bullet.x - target.x, -(bullet.y - target.y)) * 180) / Math.PI,
					)
					let bearingRelative = bearingAbsolute - target.heading
					if (bearingRelative > 180) bearingRelative -= 360
					if (bearingRelative < -180) bearingRelative += 360

					// Queue onHit callback for target
					target.pendingHitDamage = damage
					target.pendingHitBearing = bearingRelative

					// Emit bullet_hit event
					const hitEvent: BulletHitEvent = {
						type: "bullet_hit",
						bulletId: bullet.id,
						shooterId: bullet.ownerId,
						targetId: target.id,
						x: bullet.x,
						y: bullet.y,
						damage,
					}
					tickEvents.push(hitEvent)

					// Check if target died
					if (target.health <= 0) {
						target.alive = false
						if (shooter?.alive) {
							shooter.kills++
						}

						const diedEvent: RobotDiedEvent = {
							type: "robot_died",
							robotId: target.id,
							x: target.x,
							y: target.y,
							killerId: bullet.ownerId,
						}
						tickEvents.push(diedEvent)

						// Queue onRobotDeath for all surviving robots
						for (const survivor of internalRobots) {
							if (survivor.alive && survivor.id !== target.id) {
								survivor.pendingRobotDeaths.push(target.id)
							}
						}
					}

					// Mark bullet for removal
					bulletsHitRobot.add(bullet.id)
					break // Bullet can only hit one robot
				}
			}
		}

		// Step 3: Remove bullets that exit arena bounds (and bullets that hit robots)
		const survivingBullets: InternalBullet[] = []
		for (const bullet of bullets) {
			// Skip bullets that already hit a robot
			if (bulletsHitRobot.has(bullet.id)) continue

			if (
				bullet.x < 0 ||
				bullet.x > config.arena.width ||
				bullet.y < 0 ||
				bullet.y > config.arena.height
			) {
				// Bullet hit wall — emit event and queue callback for shooter
				const wallEvent: BulletWallEvent = {
					type: "bullet_wall",
					bulletId: bullet.id,
					shooterId: bullet.ownerId,
					x: bullet.x,
					y: bullet.y,
				}
				tickEvents.push(wallEvent)

				// Queue onBulletMiss callback for the shooter
				const shooter = internalRobots.find((r) => r.id === bullet.ownerId)
				if (shooter?.alive) {
					shooter.pendingBulletMiss = true
				}
			} else {
				survivingBullets.push(bullet)
			}
		}
		bullets = survivingBullets

		// ── Event delivery order ──────────────────────────────────
		// 1. Wall hits
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.pendingWallHitBearing !== undefined) {
				robot.module.onWallHit(robot.pendingWallHitBearing)
				robot.pendingWallHitBearing = undefined
			}
		}

		// 2. Robot-robot collisions
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.pendingRobotHitBearing !== undefined) {
				robot.module.onRobotHit(robot.pendingRobotHitBearing)
				robot.pendingRobotHitBearing = undefined
			}
		}

		// 3. Bullet hits (onHit for target, onBulletHit for shooter)
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.pendingHitDamage !== undefined && robot.pendingHitBearing !== undefined) {
				robot.module.onHit(robot.pendingHitDamage, robot.pendingHitBearing)
				robot.pendingHitDamage = undefined
				robot.pendingHitBearing = undefined
			}
		}
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.pendingBulletHitTargetId !== undefined) {
				robot.module.onBulletHit(robot.pendingBulletHitTargetId)
				robot.pendingBulletHitTargetId = undefined
			}
		}

		// 4. Bullet misses
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.pendingBulletMiss) {
				robot.module.onBulletMiss()
				robot.pendingBulletMiss = false
			}
		}

		// 5. Robot deaths (notify all survivors)
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			for (const deadId of robot.pendingRobotDeaths) {
				robot.module.onRobotDeath(deadId)
			}
			robot.pendingRobotDeaths = []
		}

		// 6. Scan results (onScan, onScanned)
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			for (const scan of robot.pendingOnScan) {
				robot.module.onScan(scan.distance, scan.bearing)
			}
			robot.pendingOnScan = []
		}
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			for (const scanned of robot.pendingOnScanned) {
				robot.module.onScanned(scanned.bearing)
			}
			robot.pendingOnScanned = []
		}

		// Call tick() on each alive robot
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			robot.fuelUsedThisTick = 0
			robot.module.tick()
			robot.ticksSurvived++
		}

		// Apply movement intents
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			applyMovement(robot, config, tickEvents)
		}

		// Robot-robot collision detection (only when at least one is moving)
		const currentlyColliding = new Set<string>()
		for (let i = 0; i < internalRobots.length; i++) {
			const a = internalRobots[i]!
			if (!a.alive) continue
			for (let j = i + 1; j < internalRobots.length; j++) {
				const b = internalRobots[j]!
				if (!b.alive) continue

				const dx = b.x - a.x
				const dy = b.y - a.y
				const dist = Math.sqrt(dx * dx + dy * dy)
				const minDist = config.physics.robotRadius * 2

				if (dist < minDist) {
					const pairKey = `${a.id}:${b.id}`
					currentlyColliding.add(pairKey)
					const isNewCollision = !collidingPairs.has(pairKey)

					// Only apply damage on initial collision contact
					if (isNewCollision) {
						const relSpeed = Math.abs(a.speed) + Math.abs(b.speed)
						const damage =
							config.physics.ramDamageBase + config.physics.ramDamageSpeedFactor * relSpeed

						a.health = Math.max(0, a.health - damage)
						a.damageReceived += damage
						b.health = Math.max(0, b.health - damage)
						b.damageReceived += damage

						// Calculate bearings (relative to each robot's heading)
						const bearingAtoB = normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI)
						let relBearingA = bearingAtoB - a.heading
						if (relBearingA > 180) relBearingA -= 360
						if (relBearingA < -180) relBearingA += 360

						const bearingBtoA = normalizeAngle((Math.atan2(-dx, dy) * 180) / Math.PI)
						let relBearingB = bearingBtoA - b.heading
						if (relBearingB > 180) relBearingB -= 360
						if (relBearingB < -180) relBearingB += 360

						// Queue onRobotHit callbacks
						a.pendingRobotHitBearing = relBearingA
						b.pendingRobotHitBearing = relBearingB

						// Emit collision event
						const collisionEvent: RobotCollisionEvent = {
							type: "robot_collision",
							robotId1: a.id,
							robotId2: b.id,
							x: (a.x + b.x) / 2,
							y: (a.y + b.y) / 2,
							damage1: damage,
							damage2: damage,
						}
						tickEvents.push(collisionEvent)

						// Check deaths from collision
						if (a.health <= 0 && a.alive) {
							a.alive = false
							const diedEvent: RobotDiedEvent = {
								type: "robot_died",
								robotId: a.id,
								x: a.x,
								y: a.y,
							}
							tickEvents.push(diedEvent)
						}
						if (b.health <= 0 && b.alive) {
							b.alive = false
							const diedEvent: RobotDiedEvent = {
								type: "robot_died",
								robotId: b.id,
								x: b.x,
								y: b.y,
							}
							tickEvents.push(diedEvent)
						}
					}

					// Always push robots apart regardless of damage
					if (dist > 0) {
						const overlap = minDist - dist
						const pushX = (dx / dist) * (overlap / 2)
						const pushY = (dy / dist) * (overlap / 2)
						a.x -= pushX
						a.y -= pushY
						b.x += pushX
						b.y += pushY
					}
				}
			}
		}
		// Update collision tracking: clear pairs no longer colliding
		collidingPairs.clear()
		for (const key of currentlyColliding) {
			collidingPairs.add(key)
		}

		// Queue onRobotDeath for any robots that died this tick (from wall or collision)
		// Note: bullet deaths are already queued in bullet collision section above
		for (const event of tickEvents) {
			if (event.type === "robot_died") {
				// Only queue if not already queued (bullet deaths are pre-queued)
				const alreadyQueued = internalRobots.some(
					(r) => r.alive && r.pendingRobotDeaths.includes((event as RobotDiedEvent).robotId),
				)
				if (!alreadyQueued) {
					for (const survivor of internalRobots) {
						if (survivor.alive && survivor.id !== (event as RobotDiedEvent).robotId) {
							survivor.pendingRobotDeaths.push((event as RobotDiedEvent).robotId)
						}
					}
				}
			}
		}

		// Step 5: Radar scanning
		for (const scanner of internalRobots) {
			if (!scanner.alive) continue

			const prevAngle = scanner.prevRadarHeading
			const currAngle = scanner.radarHeading

			for (const target of internalRobots) {
				if (!target.alive) continue
				if (target.id === scanner.id) continue

				// Calculate distance to target
				const dx = target.x - scanner.x
				const dy = target.y - scanner.y
				const distance = Math.sqrt(dx * dx + dy * dy)

				// Check scan range
				if (distance > config.physics.scanRange) continue

				// Calculate absolute bearing from scanner to target
				// 0=north, clockwise
				const bearingToTarget = normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI)

				// Check if bearingToTarget falls within the sweep arc
				if (isAngleInSweep(prevAngle, currAngle, bearingToTarget)) {
					// Calculate bearing from target to scanner (for onScanned)
					const dxBack = scanner.x - target.x
					const dyBack = scanner.y - target.y
					const bearingToScanner = normalizeAngle((Math.atan2(dxBack, -dyBack) * 180) / Math.PI)

					// Convert to relative bearings
					let scanBearingRel = bearingToTarget - scanner.heading
					if (scanBearingRel > 180) scanBearingRel -= 360
					if (scanBearingRel < -180) scanBearingRel += 360

					let scannedBearingRel = bearingToScanner - target.heading
					if (scannedBearingRel > 180) scannedBearingRel -= 360
					if (scannedBearingRel < -180) scannedBearingRel += 360

					// Queue callbacks for next tick delivery
					scanner.pendingOnScan.push({
						distance,
						bearing: scanBearingRel,
					})
					target.pendingOnScanned.push({
						bearing: scannedBearingRel,
					})

					// Emit scan_detection event
					const scanEvent: ScanDetectionEvent = {
						type: "scan_detection",
						scannerId: scanner.id,
						targetId: target.id,
						distance,
						bearing: scanBearingRel,
						scanStartAngle: prevAngle,
						scanEndAngle: currAngle,
					}
					tickEvents.push(scanEvent)

					// Emit scanned event
					const scannedEvent: ScannedEvent = {
						type: "scanned",
						targetId: target.id,
						bearing: scannedBearingRel,
					}
					tickEvents.push(scannedEvent)
				}
			}
		}

		// Step 19: Process fire intents
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.intendedFire <= 0) continue
			if (robot.gunHeat > 0) continue

			const power = clamp(
				robot.intendedFire,
				config.physics.minFirePower,
				config.physics.maxFirePower,
			)
			const energyCost = power * config.physics.fireCostFactor
			if (robot.energy < energyCost) continue

			// Deduct energy
			robot.energy -= energyCost

			// Set gun heat
			robot.gunHeat = 1 + power / 5

			// Calculate bullet spawn position (gun tip = robot pos + robotRadius in gunHeading direction)
			const gunRad = (robot.gunHeading * Math.PI) / 180
			const spawnX = robot.x + config.physics.robotRadius * Math.sin(gunRad)
			const spawnY = robot.y - config.physics.robotRadius * Math.cos(gunRad)

			// Calculate bullet speed
			const bulletSpeed =
				config.physics.bulletSpeedBase - config.physics.bulletSpeedPowerFactor * power

			// Create bullet
			const bulletId = nextBulletId++
			const bullet: InternalBullet = {
				id: bulletId,
				ownerId: robot.id,
				x: spawnX,
				y: spawnY,
				heading: robot.gunHeading,
				speed: bulletSpeed,
				power,
			}
			bullets.push(bullet)

			// Track stats
			robot.bulletsFired++

			// Emit event
			const firedEvent: BulletFiredEvent = {
				type: "bullet_fired",
				robotId: robot.id,
				bulletId,
				x: spawnX,
				y: spawnY,
				heading: robot.gunHeading,
				power,
			}
			tickEvents.push(firedEvent)
		}

		// Check round end conditions
		const aliveCount = internalRobots.filter((r) => r.alive).length
		const totalRobots = internalRobots.length
		const isOver =
			aliveCount === 0 || (totalRobots > 1 && aliveCount <= 1) || tick >= config.ticksPerRound
		if (isOver) {
			roundOver = true
		}

		const state = snapshot()

		if (roundOver && round >= config.roundCount) {
			battleOver = true
		}

		return {
			state,
			roundOver,
			roundResult: roundOver ? buildRoundResult() : undefined,
		}
	}

	function buildRoundResult(): RoundResult {
		const placements = internalRobots
			.slice()
			.sort((a, b) => {
				if (a.alive !== b.alive) return a.alive ? -1 : 1
				return b.health - a.health
			})
			.map((robot, i) => ({
				robotId: robot.id,
				place: i + 1,
				points: config.scoring.placementPoints[i] ?? 0,
				alive: robot.alive,
				healthRemaining: robot.health,
			}))

		// Award points
		for (const p of placements) {
			const robot = internalRobots.find((r) => r.id === p.robotId)
			if (robot) robot.score += p.points
		}

		const result: RoundResult = {
			round,
			placements,
			totalTicks: tick,
			seed: config.masterSeed,
			reason: tick >= config.ticksPerRound ? "time_limit" : "last_standing",
		}
		allRoundResults.push(result)
		return result
	}

	return {
		tick: doTick,
		runRound(): RoundResult {
			while (!roundOver) {
				doTick()
			}
			return allRoundResults[allRoundResults.length - 1]!
		},
		run(): BattleResult {
			while (!battleOver) {
				if (roundOver) {
					this.nextRound()
				}
				this.runRound()
			}
			return {
				config,
				rounds: allRoundResults,
				scores: internalRobots.map((r) => ({
					name: r.config.name,
					color: r.config.color,
					totalPoints: r.score,
					wins: 0, // TODO: compute properly
					roundsPlayed: allRoundResults.length,
					avgPlacement: 0,
					totalDamageDealt: r.damageDealt,
					totalDamageReceived: r.damageReceived,
					totalKills: r.kills,
					avgTicksSurvived: r.ticksSurvived / Math.max(1, allRoundResults.length),
				})),
			}
		},
		getState: snapshot,
		getTick: () => tick,
		getRound: () => round,
		isRoundOver: () => roundOver,
		isBattleOver: () => battleOver,
		nextRound() {
			round++
			tick = 0
			roundOver = false
			bullets = []
			nextBulletId = 0
			for (const robot of internalRobots) {
				resetRobot(robot, config, rng)
			}
		},
		destroy() {
			for (const robot of internalRobots) {
				robot.module.destroy()
			}
		},
	}
}

function createInternalRobot(
	module: RobotModule,
	rc: GameConfig["robots"][number],
	index: number,
	config: GameConfig,
	rng: PRNG,
): InternalRobot {
	return {
		module,
		config: rc,
		id: index,
		x:
			config.spawns.minSpawnDistanceFromRobot +
			rng.nextFloat() * (config.arena.width - 2 * config.spawns.minSpawnDistanceFromRobot),
		y:
			config.spawns.minSpawnDistanceFromRobot +
			rng.nextFloat() * (config.arena.height - 2 * config.spawns.minSpawnDistanceFromRobot),
		heading: rng.nextFloat() * 360,
		speed: 0,
		gunHeading: rng.nextFloat() * 360,
		gunHeat: 3.0,
		radarHeading: rng.nextFloat() * 360,
		scanWidth: config.physics.defaultScanWidth,
		health: config.physics.startHealth,
		energy: config.physics.startEnergy,
		alive: true,
		score: 0,
		fuelUsedThisTick: 0,
		ticksSurvived: 0,
		damageDealt: 0,
		damageReceived: 0,
		bulletsFired: 0,
		bulletsHit: 0,
		kills: 0,
		intendedSpeed: 0,
		intendedTurnRate: 0,
		intendedGunTurnRate: 0,
		intendedRadarTurnRate: 0,
		intendedFire: 0,
		pendingWallHitBearing: undefined,
		pendingRobotHitBearing: undefined,
		pendingBulletMiss: false,
		pendingHitDamage: undefined,
		pendingHitBearing: undefined,
		pendingBulletHitTargetId: undefined,
		pendingOnScan: [],
		pendingOnScanned: [],
		pendingRobotDeaths: [],
		prevRadarHeading: 0, // Will be set at start of first tick
	}
}

function resetRobot(robot: InternalRobot, config: GameConfig, rng: PRNG) {
	robot.x =
		config.spawns.minSpawnDistanceFromRobot +
		rng.nextFloat() * (config.arena.width - 2 * config.spawns.minSpawnDistanceFromRobot)
	robot.y =
		config.spawns.minSpawnDistanceFromRobot +
		rng.nextFloat() * (config.arena.height - 2 * config.spawns.minSpawnDistanceFromRobot)
	robot.heading = rng.nextFloat() * 360
	robot.speed = 0
	robot.gunHeading = rng.nextFloat() * 360
	robot.gunHeat = 3.0
	robot.radarHeading = rng.nextFloat() * 360
	robot.scanWidth = config.physics.defaultScanWidth
	robot.health = config.physics.startHealth
	robot.energy = config.physics.startEnergy
	robot.alive = true
	robot.fuelUsedThisTick = 0
	robot.intendedSpeed = 0
	robot.intendedTurnRate = 0
	robot.intendedGunTurnRate = 0
	robot.intendedRadarTurnRate = 0
	robot.intendedFire = 0
	robot.pendingWallHitBearing = undefined
	robot.pendingRobotHitBearing = undefined
	robot.pendingBulletMiss = false
	robot.pendingHitDamage = undefined
	robot.pendingHitBearing = undefined
	robot.pendingBulletHitTargetId = undefined
	robot.pendingOnScan = []
	robot.pendingOnScanned = []
	robot.pendingRobotDeaths = []
	robot.prevRadarHeading = robot.radarHeading
}

function snapshotRobot(robot: InternalRobot): RobotState {
	return {
		id: robot.id,
		name: robot.config.name,
		color: robot.config.color,
		x: robot.x,
		y: robot.y,
		heading: robot.heading,
		speed: robot.speed,
		gunHeading: robot.gunHeading,
		gunHeat: robot.gunHeat,
		radarHeading: robot.radarHeading,
		scanWidth: robot.scanWidth,
		health: robot.health,
		energy: robot.energy,
		alive: robot.alive,
		score: robot.score,
		fuelUsedThisTick: robot.fuelUsedThisTick,
		ticksSurvived: robot.ticksSurvived,
		damageDealt: robot.damageDealt,
		damageReceived: robot.damageReceived,
		bulletsFired: robot.bulletsFired,
		bulletsHit: robot.bulletsHit,
		kills: robot.kills,
	}
}

function snapshotBullet(bullet: InternalBullet): BulletState {
	return {
		id: bullet.id,
		ownerId: bullet.ownerId,
		x: bullet.x,
		y: bullet.y,
		heading: bullet.heading,
		speed: bullet.speed,
		power: bullet.power,
	}
}

function applyMovement(robot: InternalRobot, config: GameConfig, events: GameEvent[]) {
	// Apply turn rate
	robot.heading = normalizeAngle(
		robot.heading +
			clamp(robot.intendedTurnRate, -config.physics.maxTurnRate, config.physics.maxTurnRate),
	)

	// Apply speed change
	const targetSpeed = clamp(robot.intendedSpeed, -config.physics.maxSpeed, config.physics.maxSpeed)
	if (robot.speed < targetSpeed) {
		robot.speed = Math.min(robot.speed + config.physics.acceleration, targetSpeed)
	} else if (robot.speed > targetSpeed) {
		robot.speed = Math.max(robot.speed - config.physics.deceleration, targetSpeed)
	}

	// Move
	const rad = ((robot.heading - 90) * Math.PI) / 180 // 0=north, clockwise
	const preClampX = robot.x + Math.cos(rad) * robot.speed * 0.1
	const preClampY = robot.y + Math.sin(rad) * robot.speed * 0.1

	// Clamp to arena
	const r = config.physics.robotRadius
	const clampedX = clamp(preClampX, r, config.arena.width - r)
	const clampedY = clamp(preClampY, r, config.arena.height - r)

	// Detect wall collision
	const hitWall = clampedX !== preClampX || clampedY !== preClampY
	if (hitWall) {
		const damage = Math.abs(robot.speed) * config.physics.wallDamageSpeedFactor
		robot.health = Math.max(0, robot.health - damage)
		robot.damageReceived += damage

		// Determine wall bearing relative to robot heading
		let wallBearing = 0
		if (preClampX < r) {
			// Hit west wall
			wallBearing = normalizeAngle(270 - robot.heading)
		} else if (preClampX > config.arena.width - r) {
			// Hit east wall
			wallBearing = normalizeAngle(90 - robot.heading)
		} else if (preClampY < r) {
			// Hit north wall
			wallBearing = normalizeAngle(0 - robot.heading)
		} else if (preClampY > config.arena.height - r) {
			// Hit south wall
			wallBearing = normalizeAngle(180 - robot.heading)
		}
		// Normalize bearing to [-180, 180]
		if (wallBearing > 180) wallBearing -= 360

		const wallEvent: WallHitEvent = {
			type: "wall_hit",
			robotId: robot.id,
			x: clampedX,
			y: clampedY,
			damage,
			bearing: wallBearing,
		}
		events.push(wallEvent)

		// Store pending callback for next tick
		robot.pendingWallHitBearing = wallBearing

		// Stop the robot on wall hit
		robot.speed = 0

		// Check if robot died from wall damage
		if (robot.health <= 0) {
			robot.alive = false

			const diedEvent: RobotDiedEvent = {
				type: "robot_died",
				robotId: robot.id,
				x: clampedX,
				y: clampedY,
			}
			events.push(diedEvent)
		}
	}

	robot.x = clampedX
	robot.y = clampedY

	// Gun turn
	robot.gunHeading = normalizeAngle(
		robot.gunHeading +
			clamp(
				robot.intendedGunTurnRate,
				-config.physics.maxGunTurnRate,
				config.physics.maxGunTurnRate,
			),
	)

	// Gun cooldown
	if (robot.gunHeat > 0) {
		robot.gunHeat = Math.max(0, robot.gunHeat - config.physics.gunCooldownRate)
	}

	// Radar turn
	robot.radarHeading = normalizeAngle(
		robot.radarHeading +
			clamp(
				robot.intendedRadarTurnRate,
				-config.physics.maxRadarTurnRate,
				config.physics.maxRadarTurnRate,
			),
	)

	// Energy regen
	robot.energy = Math.min(config.physics.maxEnergy, robot.energy + config.physics.energyRegenRate)
}

function createRobotAPI(
	robot: InternalRobot,
	config: GameConfig,
	getTick: () => number,
	rng: PRNG,
): RobotAPI {
	return {
		setSpeed: (speed) => {
			robot.intendedSpeed = speed
		},
		setTurnRate: (rate) => {
			robot.intendedTurnRate = rate
		},
		setHeading: (heading) => {
			robot.intendedTurnRate = angleDiff(robot.heading, heading)
		},
		getX: () => robot.x,
		getY: () => robot.y,
		getHeading: () => robot.heading,
		getSpeed: () => robot.speed,
		setGunTurnRate: (rate) => {
			robot.intendedGunTurnRate = rate
		},
		setGunHeading: (heading) => {
			robot.intendedGunTurnRate = angleDiff(robot.gunHeading, heading)
		},
		getGunHeading: () => robot.gunHeading,
		getGunHeat: () => robot.gunHeat,
		fire: (power) => {
			robot.intendedFire = power
		},
		getEnergy: () => robot.energy,
		setRadarTurnRate: (rate) => {
			robot.intendedRadarTurnRate = rate
		},
		setRadarHeading: (heading) => {
			robot.intendedRadarTurnRate = angleDiff(robot.radarHeading, heading)
		},
		getRadarHeading: () => robot.radarHeading,
		setScanWidth: (degrees) => {
			robot.scanWidth = clamp(degrees, 1, config.physics.maxScanWidth)
		},
		getHealth: () => robot.health,
		getTick,
		arenaWidth: () => config.arena.width,
		arenaHeight: () => config.arena.height,
		robotCount: () => config.robots.length,
		distanceTo: (x, y) => Math.sqrt((robot.x - x) ** 2 + (robot.y - y) ** 2),
		bearingTo: (x, y) => {
			const absolute = normalizeAngle((Math.atan2(y - robot.y, x - robot.x) * 180) / Math.PI + 90)
			let relative = absolute - robot.heading
			if (relative > 180) relative -= 360
			if (relative < -180) relative += 360
			return relative
		},
		random: (max) => Math.floor(rng.nextFloat() * max),
		randomFloat: () => rng.nextFloat(),
		debugInt: () => {},
		debugFloat: () => {},
		debugAngle: () => {},
		setColor: () => {},
		setGunColor: () => {},
		setRadarColor: () => {},
		sin: Math.sin,
		cos: Math.cos,
		tan: Math.tan,
		atan2: Math.atan2,
		sqrt: Math.sqrt,
		abs: Math.abs,
		min: Math.min,
		max: Math.max,
		clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
		floor: Math.floor,
		ceil: Math.ceil,
		round: Math.round,
	}
}

function normalizeAngle(deg: number): number {
	const r = deg % 360
	return r < 0 ? r + 360 : r
}

function angleDiff(from: number, to: number): number {
	let diff = normalizeAngle(to) - normalizeAngle(from)
	if (diff > 180) diff -= 360
	if (diff < -180) diff += 360
	return diff
}

function clamp(x: number, lo: number, hi: number): number {
	return Math.min(Math.max(x, lo), hi)
}

/**
 * Swept line-segment vs circle intersection test.
 * Checks if the line segment from (ax, ay) to (bx, by) passes through
 * or within the circle centered at (cx, cy) with the given radius.
 *
 * Returns { hit, t } where t is the parameter along the segment (0=start, 1=end)
 * of the closest point on the segment to the circle center.
 */
export function lineSegmentIntersectsCircle(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	radius: number,
): { hit: boolean; t: number } {
	// Direction vector D = B - A
	const dx = bx - ax
	const dy = by - ay

	// Vector from A to circle center: F = A - C
	const fx = ax - cx
	const fy = ay - cy

	const dDotD = dx * dx + dy * dy

	// Degenerate case: segment has zero length (bullet didn't move)
	if (dDotD === 0) {
		const distSq = fx * fx + fy * fy
		return { hit: distSq <= radius * radius, t: 0 }
	}

	// t = clamp(-(F . D) / (D . D), 0, 1)
	const fDotD = fx * dx + fy * dy
	const t = Math.min(Math.max(-fDotD / dDotD, 0), 1)

	// Closest point on segment = A + t * D
	const closestX = ax + t * dx
	const closestY = ay + t * dy

	// Distance from closest point to circle center
	const distX = closestX - cx
	const distY = closestY - cy
	const distSq = distX * distX + distY * distY

	return { hit: distSq <= radius * radius, t }
}

/**
 * Check if an angle falls within a sweep arc from `from` to `to`.
 * The sweep is directional: it goes from `from` to `to`.
 * If from === to (no sweep), we still check a thin line (exact match).
 * All angles are in [0, 360) degrees.
 */
function isAngleInSweep(from: number, to: number, angle: number): boolean {
	// Normalize all angles to [0, 360)
	const f = normalizeAngle(from)
	const t = normalizeAngle(to)
	const a = normalizeAngle(angle)

	// If sweep is zero width, still do a thin-angle check
	// (needed when radar isn't turning)
	if (f === t) {
		// Exact match within a small tolerance
		const diff = Math.abs(a - f)
		return diff < 0.001 || Math.abs(diff - 360) < 0.001
	}

	// Determine the sweep direction: from -> to
	// We calculate the signed angular difference from f to t
	let sweepSize = t - f
	if (sweepSize < 0) sweepSize += 360

	// If sweep covers more than 180, treat it as going the short way around
	// (This handles the case where radar turned by up to maxRadarTurnRate)
	// Actually, for correctness, the sweep goes in the direction of smallest arc
	// unless the radar turned more than 180 (unlikely with typical maxRadarTurnRate)

	// Check if angle falls within the arc from f to t going in the sweep direction
	let angleFromStart = a - f
	if (angleFromStart < 0) angleFromStart += 360

	return angleFromStart <= sweepSize
}
