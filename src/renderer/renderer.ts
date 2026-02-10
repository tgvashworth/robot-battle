import { Application, Container, Graphics, Text, TextStyle } from "pixi.js"
import type { BattleRenderer, RenderOptions } from "../../spec/renderer"
import type { ArenaConfig, BulletState, GameState, RobotState } from "../../spec/simulation"
import { lerp, lerpAngle } from "./math"

const DEFAULT_OPTIONS: RenderOptions = {
	showGrid: true,
	showDamageNumbers: true,
	showScanArcs: true,
	showHealthBars: true,
	showNames: true,
	backgroundColor: 0x111118,
}

const ROBOT_WIDTH = 18
const ROBOT_LENGTH = 26
const GUN_LENGTH = 16
const GUN_WIDTH = 2
const RADAR_ARC_RADIUS = 150
const BULLET_RADIUS = 3
const HEALTH_BAR_WIDTH = 24
const HEALTH_BAR_HEIGHT = 3
const HEALTH_BAR_OFFSET_Y = 17
const NAME_OFFSET_Y = -19

const DEG_TO_RAD = Math.PI / 180

/** Convert game heading (0=north, clockwise) to canvas radians (0=east, counter-clockwise). */
function headingToRad(deg: number): number {
	return (deg - 90) * DEG_TO_RAD
}

interface RobotVisual {
	container: Container
	body: Graphics
	gun: Graphics
	radar: Graphics
	healthBarBg: Graphics
	healthBarFill: Graphics
	nameLabel: Text
}

interface BulletVisual {
	gfx: Graphics
}

/**
 * Creates a PixiJS v8 BattleRenderer.
 *
 * Layer hierarchy (bottom to top):
 *   - backgroundLayer: arena background, grid
 *   - entityLayer: robots, bullets
 *   - effectsLayer: scan arcs, explosions (future)
 *   - uiLayer: health bars, names, damage numbers (future)
 */
export function createRenderer(): BattleRenderer {
	let app: Application | null = null
	let canvas: HTMLCanvasElement | null = null
	let arena: ArenaConfig | null = null
	let options = { ...DEFAULT_OPTIONS }
	let currentFrame: GameState | null = null
	let previousFrame: GameState | null = null
	let destroyed = false
	let initialized = false
	let resolveReady: () => void
	const readyPromise = new Promise<void>((resolve) => {
		resolveReady = resolve
	})

	// Layers
	let backgroundLayer: Container | null = null
	let entityLayer: Container | null = null
	let effectsLayer: Container | null = null
	let uiLayer: Container | null = null

	// Visual object pools keyed by entity ID
	const robotVisuals = new Map<number, RobotVisual>()
	const bulletVisuals = new Map<number, BulletVisual>()

	// Background grid graphic
	let gridGraphic: Graphics | null = null

	function createRobotVisual(robot: RobotState): RobotVisual {
		const container = new Container()

		// Body circle
		const body = new Graphics()
		drawRobotBody(body, robot.color)
		container.addChild(body)

		// Gun turret line
		const gun = new Graphics()
		drawGunTurret(gun)
		container.addChild(gun)

		// Radar arc
		const radar = new Graphics()
		drawRadarArc(radar, robot.scanWidth)
		radar.visible = options.showScanArcs
		container.addChild(radar)

		// Health bar background
		const healthBarBg = new Graphics()
		healthBarBg.rect(
			-HEALTH_BAR_WIDTH / 2,
			HEALTH_BAR_OFFSET_Y,
			HEALTH_BAR_WIDTH,
			HEALTH_BAR_HEIGHT,
		)
		healthBarBg.fill(0x333333)
		healthBarBg.visible = options.showHealthBars

		// Health bar fill
		const healthBarFill = new Graphics()
		drawHealthBarFill(healthBarFill, robot.health)
		healthBarFill.visible = options.showHealthBars

		// Name label
		const nameLabel = new Text({
			text: robot.name,
			style: new TextStyle({
				fontFamily: "monospace",
				fontSize: 10,
				fill: 0xffffff,
				align: "center",
			}),
		})
		nameLabel.anchor.set(0.5, 1)
		nameLabel.y = NAME_OFFSET_Y
		nameLabel.visible = options.showNames

		// Health bars and names go on uiLayer, not entity container
		uiLayer!.addChild(healthBarBg)
		uiLayer!.addChild(healthBarFill)
		uiLayer!.addChild(nameLabel)

		entityLayer!.addChild(container)

		return { container, body, gun, radar, healthBarBg, healthBarFill, nameLabel }
	}

	function drawRobotBody(gfx: Graphics, color: number): void {
		gfx.clear()
		const hw = ROBOT_WIDTH / 2
		const hl = ROBOT_LENGTH / 2
		// Draw body rectangle centered at origin, "front" pointing up (negative Y)
		gfx.rect(-hw, -hl, ROBOT_WIDTH, ROBOT_LENGTH)
		gfx.fill(color)
		// Draw a lighter nose triangle to indicate front
		gfx.moveTo(-hw, -hl)
		gfx.lineTo(0, -hl - 4)
		gfx.lineTo(hw, -hl)
		gfx.closePath()
		gfx.fill(color)
	}

	function drawGunTurret(gfx: Graphics): void {
		gfx.clear()
		// Gun extends in +X direction; headingToRad rotates it to correct orientation
		gfx.moveTo(0, 0)
		gfx.lineTo(ROBOT_LENGTH / 2 + GUN_LENGTH, 0)
		gfx.stroke({ width: GUN_WIDTH + 1, color: 0xaaccdd })
	}

	function drawRadarArc(gfx: Graphics, scanWidth: number): void {
		gfx.clear()
		const halfSpan = (scanWidth / 2) * DEG_TO_RAD
		// Fill
		gfx.moveTo(0, 0)
		gfx.arc(0, 0, RADAR_ARC_RADIUS, -halfSpan, halfSpan)
		gfx.lineTo(0, 0)
		gfx.fill({ color: 0x00ff88, alpha: 0.15 })
		// Edge stroke
		gfx.moveTo(0, 0)
		gfx.arc(0, 0, RADAR_ARC_RADIUS, -halfSpan, halfSpan)
		gfx.lineTo(0, 0)
		gfx.stroke({ width: 1, color: 0x00ff88, alpha: 0.4 })
	}

	function drawHealthBarFill(gfx: Graphics, health: number): void {
		gfx.clear()
		const fillWidth = HEALTH_BAR_WIDTH * (health / 100)
		let color: number
		if (health > 50) {
			color = 0x00ff00
		} else if (health > 25) {
			color = 0xffff00
		} else {
			color = 0xff0000
		}
		gfx.rect(-HEALTH_BAR_WIDTH / 2, HEALTH_BAR_OFFSET_Y, fillWidth, HEALTH_BAR_HEIGHT)
		gfx.fill(color)
	}

	function createBulletVisual(bullet: BulletState): BulletVisual {
		const gfx = new Graphics()
		gfx.circle(0, 0, BULLET_RADIUS)
		gfx.fill(0xffff88)
		gfx.x = bullet.x
		gfx.y = bullet.y
		entityLayer!.addChild(gfx)
		return { gfx }
	}

	function drawGrid(): void {
		if (!gridGraphic || !arena) return
		gridGraphic.clear()
		if (!options.showGrid) {
			gridGraphic.visible = false
			return
		}
		gridGraphic.visible = true
		const step = 50
		for (let x = step; x < arena.width; x += step) {
			gridGraphic.moveTo(x, 0)
			gridGraphic.lineTo(x, arena.height)
		}
		for (let y = step; y < arena.height; y += step) {
			gridGraphic.moveTo(0, y)
			gridGraphic.lineTo(arena.width, y)
		}
		gridGraphic.stroke({ width: 1, color: 0x222233, alpha: 0.5 })
	}

	function updateRobotVisual(
		visual: RobotVisual,
		x: number,
		y: number,
		heading: number,
		gunHeading: number,
		radarHeading: number,
		scanWidth: number,
		health: number,
		alive: boolean,
	): void {
		visual.container.x = x
		visual.container.y = y
		visual.container.visible = alive

		// Rotate the entire container by body heading
		// Body is drawn with nose at -Y (up), game heading 0=north CW, PixiJS rotation CW
		visual.container.rotation = heading * DEG_TO_RAD

		// Gun rotation relative to body (container already rotated by body heading)
		visual.gun.rotation = headingToRad(gunHeading - heading)

		// Radar rotation relative to body
		visual.radar.rotation = headingToRad(radarHeading - heading)
		drawRadarArc(visual.radar, scanWidth)
		visual.radar.visible = alive && options.showScanArcs

		// Health bar position follows robot (not rotated — lives on uiLayer)
		visual.healthBarBg.x = x
		visual.healthBarBg.y = y
		visual.healthBarBg.visible = alive && options.showHealthBars
		visual.healthBarFill.x = x
		visual.healthBarFill.y = y
		visual.healthBarFill.visible = alive && options.showHealthBars
		if (alive) {
			drawHealthBarFill(visual.healthBarFill, health)
		}

		// Name label follows robot (not rotated)
		visual.nameLabel.x = x
		visual.nameLabel.y = y + NAME_OFFSET_Y
		visual.nameLabel.visible = alive && options.showNames
	}

	function interpolateRobot(
		prev: RobotState | undefined,
		curr: RobotState,
		alpha: number,
	): { x: number; y: number; heading: number; gunHeading: number; radarHeading: number } {
		if (!prev || alpha >= 1) {
			return {
				x: curr.x,
				y: curr.y,
				heading: curr.heading,
				gunHeading: curr.gunHeading,
				radarHeading: curr.radarHeading,
			}
		}
		return {
			x: lerp(prev.x, curr.x, alpha),
			y: lerp(prev.y, curr.y, alpha),
			heading: lerpAngle(prev.heading, curr.heading, alpha),
			gunHeading: lerpAngle(prev.gunHeading, curr.gunHeading, alpha),
			radarHeading: lerpAngle(prev.radarHeading, curr.radarHeading, alpha),
		}
	}

	function interpolateBullet(
		prev: BulletState | undefined,
		curr: BulletState,
		alpha: number,
	): { x: number; y: number } {
		if (!prev || alpha >= 1) {
			return { x: curr.x, y: curr.y }
		}
		return {
			x: lerp(prev.x, curr.x, alpha),
			y: lerp(prev.y, curr.y, alpha),
		}
	}

	/** Remove visuals for entities no longer present. */
	function cleanupStaleVisuals(frame: GameState): void {
		const activeRobotIds = new Set(frame.robots.map((r) => r.id))
		for (const [id, visual] of robotVisuals) {
			if (!activeRobotIds.has(id)) {
				visual.container.destroy({ children: true })
				visual.healthBarBg.destroy()
				visual.healthBarFill.destroy()
				visual.nameLabel.destroy()
				robotVisuals.delete(id)
			}
		}

		const activeBulletIds = new Set(frame.bullets.map((b) => b.id))
		for (const [id, visual] of bulletVisuals) {
			if (!activeBulletIds.has(id)) {
				visual.gfx.destroy()
				bulletVisuals.delete(id)
			}
		}
	}

	function applyOptions(): void {
		// Update visibility flags on all existing visuals
		for (const visual of robotVisuals.values()) {
			visual.radar.visible = options.showScanArcs
			visual.healthBarBg.visible = options.showHealthBars
			visual.healthBarFill.visible = options.showHealthBars
			visual.nameLabel.visible = options.showNames
		}
		drawGrid()
		if (app) {
			app.renderer.background.color = options.backgroundColor
		}
	}

	return {
		ready: readyPromise,

		init(c, a) {
			canvas = c
			arena = a

			app = new Application()

			// PixiJS v8: init is async, but we fire-and-forget here.
			// The renderer will start drawing once init resolves.
			app
				.init({
					canvas: c,
					width: a.width,
					height: a.height,
					backgroundColor: options.backgroundColor,
					antialias: true,
					// preference: "webgl" is default; falls back to webgpu or canvas
				})
				.then(() => {
					if (destroyed || !app) return
					initialized = true

					// Create layer hierarchy
					backgroundLayer = new Container()
					entityLayer = new Container()
					effectsLayer = new Container()
					uiLayer = new Container()

					backgroundLayer.label = "background"
					entityLayer.label = "entities"
					effectsLayer.label = "effects"
					uiLayer.label = "ui"

					app.stage.addChild(backgroundLayer)
					app.stage.addChild(entityLayer)
					app.stage.addChild(effectsLayer)
					app.stage.addChild(uiLayer)

					// Grid
					gridGraphic = new Graphics()
					backgroundLayer.addChild(gridGraphic)
					drawGrid()

					resolveReady()
				})
				.catch(() => {
					// PixiJS init can fail in test environments (no WebGL).
					// Resolve ready so awaiters don't hang forever.
					resolveReady()
				})
		},

		pushFrame(state) {
			if (destroyed) return
			previousFrame = currentFrame
			currentFrame = state
		},

		render(alpha) {
			if (destroyed || !currentFrame || !arena) return
			// If PixiJS hasn't initialized yet, skip rendering
			if (!initialized || !app || !entityLayer || !uiLayer) return

			const frame = currentFrame
			const prev = previousFrame

			// Clean up visuals for entities that no longer exist
			cleanupStaleVisuals(frame)

			// Render robots
			for (const robot of frame.robots) {
				let visual = robotVisuals.get(robot.id)
				if (!visual) {
					visual = createRobotVisual(robot)
					robotVisuals.set(robot.id, visual)
				}

				const prevRobot = prev?.robots.find((r) => r.id === robot.id)
				const interp = interpolateRobot(prevRobot, robot, alpha)

				updateRobotVisual(
					visual,
					interp.x,
					interp.y,
					interp.heading,
					interp.gunHeading,
					interp.radarHeading,
					robot.scanWidth,
					robot.health,
					robot.alive,
				)
			}

			// Render bullets
			for (const bullet of frame.bullets) {
				let visual = bulletVisuals.get(bullet.id)
				if (!visual) {
					visual = createBulletVisual(bullet)
					bulletVisuals.set(bullet.id, visual)
				}

				const prevBullet = prev?.bullets.find((b) => b.id === bullet.id)
				const interp = interpolateBullet(prevBullet, bullet, alpha)
				visual.gfx.x = interp.x
				visual.gfx.y = interp.y
			}

			// PixiJS auto-renders if autoStart is true (default).
			// For manual control, call app.render() if autoStart was false.
			app.render()
		},

		resize(width, height) {
			if (canvas) {
				canvas.width = width
				canvas.height = height
			}
			if (app && initialized) {
				app.renderer.resize(width, height)
			}
		},

		setOptions(opts) {
			options = { ...options, ...opts }
			if (initialized) {
				applyOptions()
			}
		},

		reset() {
			// Destroy all entity visuals but keep the PixiJS app and layers alive
			for (const visual of robotVisuals.values()) {
				visual.container.destroy({ children: true })
				visual.healthBarBg.destroy()
				visual.healthBarFill.destroy()
				visual.nameLabel.destroy()
			}
			robotVisuals.clear()

			for (const visual of bulletVisuals.values()) {
				visual.gfx.destroy()
			}
			bulletVisuals.clear()

			currentFrame = null
			previousFrame = null
		},

		destroy() {
			destroyed = true

			// Destroy all visuals
			for (const visual of robotVisuals.values()) {
				visual.container.destroy({ children: true })
				visual.healthBarBg.destroy()
				visual.healthBarFill.destroy()
				visual.nameLabel.destroy()
			}
			robotVisuals.clear()

			for (const visual of bulletVisuals.values()) {
				visual.gfx.destroy()
			}
			bulletVisuals.clear()

			// Destroy PixiJS app
			if (app) {
				try {
					app.destroy(false, { children: true })
				} catch {
					// Ignore errors during cleanup (can happen in test environments)
				}
				app = null
			}

			canvas = null
			arena = null
			currentFrame = null
			previousFrame = null
			backgroundLayer = null
			entityLayer = null
			effectsLayer = null
			uiLayer = null
			gridGraphic = null
			initialized = false
		},
	}
}
