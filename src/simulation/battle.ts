import type {
	Battle,
	BattleResult,
	BulletFiredEvent,
	BulletState,
	BulletWallEvent,
	GameConfig,
	GameEvent,
	GameState,
	RobotAPI,
	RobotModule,
	RobotState,
	RoundResult,
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
	pendingBulletMiss: boolean
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

	// Initialize robots
	const internalRobots: InternalRobot[] = robots.map((module, i) => {
		const rc = config.robots[i]!
		return createInternalRobot(module, rc, i, config, rng)
	})

	// Give each robot its API and call init()
	for (const robot of internalRobots) {
		const api = createRobotAPI(robot, config)
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

		// Reset per-tick intents (speed persists)
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			robot.intendedTurnRate = 0
			robot.intendedGunTurnRate = 0
			robot.intendedRadarTurnRate = 0
			robot.intendedFire = 0
		}

		// Step 1: Move bullets
		for (const bullet of bullets) {
			const rad = (bullet.heading * Math.PI) / 180
			bullet.x += bullet.speed * Math.sin(rad)
			bullet.y -= bullet.speed * Math.cos(rad)
		}

		// Step 3: Remove bullets that exit arena bounds
		const survivingBullets: InternalBullet[] = []
		for (const bullet of bullets) {
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

		// Deliver wall hit callbacks before tick()
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.pendingWallHitBearing !== undefined) {
				robot.module.onWallHit(robot.pendingWallHitBearing)
				robot.pendingWallHitBearing = undefined
			}
		}

		// Deliver bullet miss callbacks before tick()
		for (const robot of internalRobots) {
			if (!robot.alive) continue
			if (robot.pendingBulletMiss) {
				robot.module.onBulletMiss()
				robot.pendingBulletMiss = false
			}
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
		const isOver = aliveCount <= 1 || tick >= config.ticksPerRound
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
		pendingBulletMiss: false,
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
	robot.pendingBulletMiss = false
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

	// Energy regen
	robot.energy = Math.min(config.physics.maxEnergy, robot.energy + config.physics.energyRegenRate)
}

function createRobotAPI(robot: InternalRobot, config: GameConfig): RobotAPI {
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
		setScanWidth: () => {},
		getHealth: () => robot.health,
		getTick: () => 0,
		arenaWidth: () => config.arena.width,
		arenaHeight: () => config.arena.height,
		robotCount: () => config.robots.length,
		distanceTo: (x, y) => Math.sqrt((robot.x - x) ** 2 + (robot.y - y) ** 2),
		bearingTo: (x, y) =>
			normalizeAngle((Math.atan2(y - robot.y, x - robot.x) * 180) / Math.PI + 90),
		random: (max) => Math.floor(Math.random() * max),
		randomFloat: () => Math.random(),
		debugInt: () => {},
		debugFloat: () => {},
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
