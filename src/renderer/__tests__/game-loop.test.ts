import { describe, expect, it, vi } from "vitest"
import type { BattleRenderer } from "../../../spec/renderer"
import type { GameState } from "../../../spec/simulation"
import { createGameLoop } from "../game-loop"
import { createReplaySource } from "../replay-source"

function makeFrame(tick: number): GameState {
	return {
		tick,
		round: 1,
		arena: { width: 800, height: 600 },
		robots: [],
		bullets: [],
		mines: [],
		cookies: [],
		events: [],
	}
}

function makeFrames(count: number): GameState[] {
	return Array.from({ length: count }, (_, i) => makeFrame(i))
}

function mockRenderer(): BattleRenderer {
	return {
		ready: Promise.resolve(),
		init: vi.fn(),
		pushFrame: vi.fn(),
		render: vi.fn(),
		resize: vi.fn(),
		setOptions: vi.fn(),
		destroy: vi.fn(),
	}
}

/**
 * Creates a controllable mock rAF. Call the returned `fire(timestamp)` to
 * invoke the most recently registered callback.
 */
function mockRaf() {
	let callback: ((time: number) => void) | null = null
	let nextId = 1

	const requestAnimationFrame = vi.fn((cb: (time: number) => void) => {
		callback = cb
		const id = nextId
		nextId++
		return id
	})

	const cancelAnimationFrame = vi.fn()

	function fire(timestamp: number) {
		const cb = callback
		callback = null
		cb?.(timestamp)
	}

	return { requestAnimationFrame, cancelAnimationFrame, fire }
}

describe("GameLoop", () => {
	it("can be created, started, and destroyed", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(10))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		loop.destroy()
		expect(raf.cancelAnimationFrame).toHaveBeenCalled()
	})

	it("starts and requests animation frames", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(10))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		expect(raf.requestAnimationFrame).toHaveBeenCalledTimes(1)

		loop.destroy()
	})

	it("consumes ticks based on elapsed time at 30 Hz", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(100))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()

		// First frame: establishes timestamp baseline
		raf.fire(0)

		// 100ms later = ~3 ticks at 30Hz (33.33ms per tick)
		raf.fire(100)
		expect(renderer.pushFrame).toHaveBeenCalledTimes(3)

		// render is called each frame
		expect(renderer.render).toHaveBeenCalled()

		loop.destroy()
	})

	it("does not consume ticks when paused", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(100))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		raf.fire(0)

		loop.pause()
		expect(loop.isPaused()).toBe(true)

		// Even with time passing, no ticks should be consumed
		raf.fire(1000)
		expect(renderer.pushFrame).not.toHaveBeenCalled()

		// But render should still be called (for display)
		expect(renderer.render).toHaveBeenCalled()

		loop.destroy()
	})

	it("step() advances exactly one tick while paused", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(10))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		raf.fire(0)

		loop.pause()
		loop.step()

		expect(renderer.pushFrame).toHaveBeenCalledTimes(1)
		expect(renderer.render).toHaveBeenCalledWith(1)

		loop.destroy()
	})

	it("step() does nothing when not paused", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(10))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		loop.step()

		// Not paused, so step should be ignored
		expect(renderer.pushFrame).not.toHaveBeenCalled()

		loop.destroy()
	})

	it("setSpeed scales tick consumption rate", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(100))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.setSpeed(2)
		expect(loop.getSpeed()).toBe(2)

		loop.start()
		raf.fire(0)

		// 100ms at 2x speed = 200ms effective = ~6 ticks at 30Hz
		raf.fire(100)
		expect(renderer.pushFrame).toHaveBeenCalledTimes(6)

		loop.destroy()
	})

	it("clamps accumulator to prevent spiral of death", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(100))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		raf.fire(0)

		// Huge time jump (10 seconds) should be clamped to 8 ticks max
		raf.fire(10000)
		expect(renderer.pushFrame).toHaveBeenCalledTimes(8)

		loop.destroy()
	})

	it("resume does not cause time spike", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(100))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		raf.fire(0)

		loop.pause()
		// Simulate a long pause
		raf.fire(5000)

		loop.resume()
		expect(loop.isPaused()).toBe(false)

		// After resume, first frame re-establishes baseline
		raf.fire(5001)
		// Only ~0ms of effective time since resume reset the timestamp
		// The first frame after resume establishes a new baseline
		// then on the next frame actual delta is computed
		raf.fire(5035)
		// ~34ms = 1 tick at 30Hz
		expect(renderer.pushFrame).toHaveBeenCalledTimes(1)

		loop.destroy()
	})

	it("stop prevents further frame processing", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(100))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		raf.fire(0)

		loop.stop()

		// Firing rAF after stop should do nothing (callback exits early)
		raf.fire(100)
		expect(renderer.pushFrame).not.toHaveBeenCalled()

		loop.destroy()
	})

	it("calls render with interpolation alpha", () => {
		const raf = mockRaf()
		const source = createReplaySource(makeFrames(100))
		const renderer = mockRenderer()
		const loop = createGameLoop(source, renderer, {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		})

		loop.start()
		raf.fire(0)

		// 50ms = 1 tick (33.33ms) consumed + ~16.67ms remainder
		// alpha = 16.67 / 33.33 = ~0.5
		raf.fire(50)

		expect(renderer.render).toHaveBeenCalled()
		const lastRenderCall = renderer.render as ReturnType<typeof vi.fn>
		const alpha = lastRenderCall.mock.calls[lastRenderCall.mock.calls.length - 1]![0] as number
		expect(alpha).toBeGreaterThan(0)
		expect(alpha).toBeLessThan(1)

		loop.destroy()
	})
})
