import type {
	ArenaConfig,
	GameConfig,
	PhysicsConfig,
	ScoringConfig,
	SpawnConfig,
} from "../../spec/simulation"

export const DEFAULT_ARENA: ArenaConfig = {
	width: 800,
	height: 600,
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
	maxSpeed: 100,
	acceleration: 1.0,
	deceleration: 2.0,
	maxTurnRate: 10,
	turnRateSpeedFactor: 0.05,
	maxGunTurnRate: 20,
	gunHeatPerShot: 1.0,
	gunCooldownRate: 0.1,
	minFirePower: 1,
	maxFirePower: 5,
	maxRadarTurnRate: 45,
	defaultScanWidth: 10,
	maxScanWidth: 45,
	scanRange: Number.POSITIVE_INFINITY,
	bulletSpeedBase: 20,
	bulletSpeedPowerFactor: 3,
	bulletDamageBase: 4,
	bulletDamageBonus: 2,
	wallDamageSpeedFactor: 0.5,
	ramDamageBase: 2,
	ramDamageSpeedFactor: 0.1,
	mineDamage: 30,
	cookieHealth: 20,
	startEnergy: 100,
	energyRegenRate: 0.1,
	maxEnergy: 100,
	fireCostFactor: 1.0,
	startHealth: 100,
	maxHealth: 100,
	robotRadius: 18,
	bulletRadius: 3,
	cookieRadius: 10,
	mineRadius: 8,
	fuelPerTick: 10000,
}

export const DEFAULT_SPAWNS: SpawnConfig = {
	mineSpawnInterval: 200,
	mineMaxCount: 4,
	cookieSpawnInterval: 150,
	cookieMaxCount: 3,
	minSpawnDistanceFromRobot: 60,
	minRobotSpacing: 100,
}

export const DEFAULT_SCORING: ScoringConfig = {
	placementPoints: [3, 1],
}

export function createDefaultConfig(
	robots: GameConfig["robots"],
	overrides?: Partial<GameConfig>,
): GameConfig {
	return {
		arena: DEFAULT_ARENA,
		physics: DEFAULT_PHYSICS,
		spawns: DEFAULT_SPAWNS,
		scoring: DEFAULT_SCORING,
		robots,
		ticksPerRound: 2000,
		roundCount: 1,
		masterSeed: 12345,
		...overrides,
	}
}
