import type {
	Battle,
	BattleResult,
	GameConfig,
	GameState,
	RobotAPI,
	RobotModule,
	RobotState,
	RoundResult,
	TickResult,
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
}

export function createBattle(config: GameConfig, robots: RobotModule[]): Battle {
	const rng = new PRNG(config.masterSeed)
	let tick = 0
	let round = 1
	let roundOver = false
	let battleOver = false
	const allRoundResults: RoundResult[] = []

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

	function snapshot(): GameState {
		return {
			tick,
			round,
			arena: config.arena,
			robots: internalRobots.map(snapshotRobot),
			bullets: [],
			mines: [],
			cookies: [],
			events: [],
		}
	}

	function doTick(): TickResult {
		tick++

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
			applyMovement(robot, config)
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

function applyMovement(robot: InternalRobot, config: GameConfig) {
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
	robot.x += Math.cos(rad) * robot.speed * 0.1
	robot.y += Math.sin(rad) * robot.speed * 0.1

	// Clamp to arena
	const r = config.physics.robotRadius
	robot.x = clamp(robot.x, r, config.arena.width - r)
	robot.y = clamp(robot.y, r, config.arena.height - r)

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
