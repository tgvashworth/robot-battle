import type { BattleRenderer, RenderOptions } from "../../spec/renderer"
import type { ArenaConfig, GameState } from "../../spec/simulation"

const DEFAULT_OPTIONS: RenderOptions = {
	showGrid: true,
	showDamageNumbers: true,
	showScanArcs: true,
	showHealthBars: true,
	showNames: true,
	backgroundColor: 0x111118,
}

/**
 * Minimal BattleRenderer skeleton.
 *
 * This does NOT yet initialize PixiJS. It's a structural placeholder that
 * demonstrates the interface contract and will be fleshed out when we add
 * real rendering.
 *
 * For now it tracks state and logs calls — enough to test integration.
 */
export function createRenderer(): BattleRenderer {
	let canvas: HTMLCanvasElement | null = null
	let arena: ArenaConfig | null = null
	let options = { ...DEFAULT_OPTIONS }
	let currentFrame: GameState | null = null
	let previousFrame: GameState | null = null
	let destroyed = false

	return {
		init(c, a) {
			canvas = c
			arena = a
		},

		pushFrame(state) {
			if (destroyed) return
			previousFrame = currentFrame
			currentFrame = state
		},

		render(alpha) {
			if (destroyed || !canvas || !currentFrame || !arena) return

			// For now: draw a simple 2D canvas representation
			// This will be replaced with PixiJS when we build the real renderer
			const ctx = canvas.getContext("2d")
			if (!ctx) return

			const frame = currentFrame
			ctx.fillStyle = `#${options.backgroundColor.toString(16).padStart(6, "0")}`
			ctx.fillRect(0, 0, canvas.width, canvas.height)

			// Draw robots as circles
			for (const robot of frame.robots) {
				if (!robot.alive) continue

				// Interpolate position if we have a previous frame
				let x = robot.x
				let y = robot.y
				if (previousFrame && alpha < 1) {
					const prev = previousFrame.robots.find((r) => r.id === robot.id)
					if (prev) {
						x = prev.x + (robot.x - prev.x) * alpha
						y = prev.y + (robot.y - prev.y) * alpha
					}
				}

				// Robot body
				ctx.fillStyle = `#${robot.color.toString(16).padStart(6, "0")}`
				ctx.beginPath()
				ctx.arc(x, y, 18, 0, Math.PI * 2)
				ctx.fill()

				// Gun line
				const gunRad = ((robot.gunHeading - 90) * Math.PI) / 180
				ctx.strokeStyle = "#ffffff"
				ctx.lineWidth = 2
				ctx.beginPath()
				ctx.moveTo(x, y)
				ctx.lineTo(x + Math.cos(gunRad) * 25, y + Math.sin(gunRad) * 25)
				ctx.stroke()

				// Name label
				if (options.showNames) {
					ctx.fillStyle = "#ffffff"
					ctx.font = "10px monospace"
					ctx.textAlign = "center"
					ctx.fillText(robot.name, x, y - 24)
				}

				// Health bar
				if (options.showHealthBars) {
					const barWidth = 30
					const barHeight = 3
					const barX = x - barWidth / 2
					const barY = y + 22
					ctx.fillStyle = "#333"
					ctx.fillRect(barX, barY, barWidth, barHeight)
					ctx.fillStyle = robot.health > 50 ? "#0f0" : robot.health > 25 ? "#ff0" : "#f00"
					ctx.fillRect(barX, barY, barWidth * (robot.health / 100), barHeight)
				}
			}
		},

		resize(width, height) {
			if (canvas) {
				canvas.width = width
				canvas.height = height
			}
		},

		setOptions(opts) {
			options = { ...options, ...opts }
		},

		destroy() {
			destroyed = true
			canvas = null
			arena = null
			currentFrame = null
			previousFrame = null
		},
	}
}
