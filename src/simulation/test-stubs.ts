import type { RobotAPI, RobotModule } from "../../spec/simulation"

/**
 * Creates a RobotModule that does nothing. Useful as a baseline.
 */
export function createIdleBot(): RobotModule {
	return {
		init() {},
		tick() {},
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
 * Creates a RobotModule that spins and fires.
 */
export function createSpinBot(): RobotModule {
	let api: RobotAPI

	return {
		init(a) {
			api = a
		},
		tick() {
			api.setSpeed(30)
			api.setTurnRate(5)
			api.setGunTurnRate(10)
			if (api.getGunHeat() === 0 && api.getEnergy() > 5) {
				api.fire(1)
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
}

/**
 * Creates a RobotModule that drives straight east at max speed.
 * Useful for testing wall collisions.
 */
export function createWallSeekerBot(): RobotModule {
	let api: RobotAPI

	return {
		init(a) {
			api = a
		},
		tick() {
			api.setHeading(90) // East
			api.setSpeed(100) // Max speed
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
 * Creates a RobotModule that stands still and fires at power 3 every time the gun is cool.
 */
export function createStationaryShooterBot(): RobotModule {
	let api: RobotAPI

	return {
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
		onBulletMiss() {},
		onRobotDeath() {},
		destroy() {},
	}
}

/**
 * Creates a RobotModule that tracks scan targets.
 */
export function createTrackerBot(): RobotModule {
	let api: RobotAPI
	let lastScanBearing = 0
	let hasTarget = false

	return {
		init(a) {
			api = a
		},
		tick() {
			if (hasTarget) {
				api.setGunHeading(lastScanBearing)
				if (api.getGunHeat() === 0) {
					api.fire(2)
				}
			}
			api.setRadarTurnRate(15)
		},
		onScan(_distance, bearing) {
			lastScanBearing = bearing
			hasTarget = true
		},
		onScanned() {},
		onHit(_damage, bearing) {
			api.setTurnRate(-bearing > 0 ? 10 : -10)
			api.setSpeed(50)
		},
		onBulletHit() {},
		onWallHit() {
			api.setTurnRate(10)
		},
		onRobotHit() {},
		onBulletMiss() {},
		onRobotDeath() {},
		destroy() {},
	}
}
