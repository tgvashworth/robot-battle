import type { BattleRenderer, GameLoop, TickSource } from "../../spec/renderer"

/** Tick rate in Hz (ticks per second). */
const TICK_RATE = 30

/** Seconds per tick at normal speed. */
const SECONDS_PER_TICK = 1 / TICK_RATE

/** Maximum ticks consumed per frame (spiral-of-death prevention). */
const MAX_TICKS_PER_FRAME = 8

export interface GameLoopOptions {
	/** Injectable requestAnimationFrame for testing. Defaults to window.requestAnimationFrame. */
	requestAnimationFrame?: (callback: (time: number) => void) => number
	/** Injectable cancelAnimationFrame for testing. Defaults to window.cancelAnimationFrame. */
	cancelAnimationFrame?: (id: number) => void
}

/**
 * Create a GameLoop that bridges a TickSource to a BattleRenderer.
 *
 * Uses a fixed-timestep accumulator at 30 Hz. Real time is accumulated,
 * and ticks are consumed when enough time has passed. The renderer receives
 * an interpolation alpha on each animation frame.
 */
export function createGameLoop(
	tickSource: TickSource,
	renderer: BattleRenderer,
	options: GameLoopOptions = {},
): GameLoop {
	const raf = options.requestAnimationFrame ?? window.requestAnimationFrame.bind(window)
	const caf = options.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window)

	let running = false
	let paused = false
	let speed = 1
	let accumulator = 0
	let lastTimestamp = -1
	let rafId = 0

	function frame(timestamp: number) {
		if (!running) return

		if (lastTimestamp < 0) {
			lastTimestamp = timestamp
		}

		const deltaSeconds = (timestamp - lastTimestamp) / 1000
		lastTimestamp = timestamp

		if (!paused) {
			accumulator += deltaSeconds * speed

			// Clamp accumulator to prevent spiral of death
			const maxAccumulator = SECONDS_PER_TICK * MAX_TICKS_PER_FRAME
			if (accumulator > maxAccumulator) {
				accumulator = maxAccumulator
			}

			// Consume ticks
			while (accumulator >= SECONDS_PER_TICK && tickSource.hasNext()) {
				const state = tickSource.tick()
				renderer.pushFrame(state)
				accumulator -= SECONDS_PER_TICK
			}
		}

		// Compute interpolation alpha
		const alpha = accumulator / SECONDS_PER_TICK
		renderer.render(alpha)

		rafId = raf(frame)
	}

	return {
		start() {
			if (running) return
			running = true
			paused = false
			lastTimestamp = -1
			accumulator = 0
			rafId = raf(frame)
		},

		stop() {
			running = false
			if (rafId) {
				caf(rafId)
				rafId = 0
			}
		},

		setSpeed(multiplier: number) {
			speed = multiplier
		},

		pause() {
			paused = true
		},

		resume() {
			if (!paused) return
			paused = false
			// Reset timestamp to avoid time spike from pause duration
			lastTimestamp = -1
		},

		step() {
			if (!paused) return
			if (!tickSource.hasNext()) return
			const state = tickSource.tick()
			renderer.pushFrame(state)
			renderer.render(1)
		},

		isPaused(): boolean {
			return paused
		},

		getSpeed(): number {
			return speed
		},

		destroy() {
			running = false
			if (rafId) {
				caf(rafId)
				rafId = 0
			}
		},
	}
}
