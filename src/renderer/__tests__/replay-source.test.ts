import { describe, expect, it } from "vitest"
import type { GameState } from "../../../spec/simulation"
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

describe("ReplaySource", () => {
	it("reports totalTicks as the number of frames", () => {
		const source = createReplaySource([makeFrame(0), makeFrame(1), makeFrame(2)])
		expect(source.totalTicks()).toBe(3)
	})

	it("starts at tick 0", () => {
		const source = createReplaySource([makeFrame(0), makeFrame(1)])
		expect(source.currentTick()).toBe(0)
	})

	it("hasNext returns true when frames remain", () => {
		const source = createReplaySource([makeFrame(0), makeFrame(1)])
		expect(source.hasNext()).toBe(true)
	})

	it("tick() returns frames in order and advances currentTick", () => {
		const frames = [makeFrame(0), makeFrame(1), makeFrame(2)]
		const source = createReplaySource(frames)

		expect(source.tick().tick).toBe(0)
		expect(source.currentTick()).toBe(1)

		expect(source.tick().tick).toBe(1)
		expect(source.currentTick()).toBe(2)

		expect(source.tick().tick).toBe(2)
		expect(source.currentTick()).toBe(3)
	})

	it("hasNext returns false after all frames consumed", () => {
		const source = createReplaySource([makeFrame(0)])
		expect(source.hasNext()).toBe(true)
		source.tick()
		expect(source.hasNext()).toBe(false)
	})

	it("handles empty frame list", () => {
		const source = createReplaySource([])
		expect(source.totalTicks()).toBe(0)
		expect(source.currentTick()).toBe(0)
		expect(source.hasNext()).toBe(false)
	})
})
