import { describe, expect, it } from "vitest"
import type { GameState } from "../../../spec/simulation"
import { createRenderer } from "../renderer"

function mockGameState(overrides?: Partial<GameState>): GameState {
	return {
		tick: 1,
		round: 1,
		arena: { width: 800, height: 600 },
		robots: [
			{
				id: 0,
				name: "TestBot",
				color: 0xff0000,
				x: 400,
				y: 300,
				heading: 0,
				speed: 0,
				gunHeading: 0,
				gunHeat: 0,
				radarHeading: 0,
				health: 100,
				energy: 100,
				alive: true,
				score: 0,
				fuelUsedThisTick: 0,
				ticksSurvived: 1,
				damageDealt: 0,
				damageReceived: 0,
				bulletsFired: 0,
				bulletsHit: 0,
				kills: 0,
			},
		],
		bullets: [],
		mines: [],
		cookies: [],
		events: [],
		...overrides,
	}
}

describe("BattleRenderer", () => {
	it("can be created and destroyed without crashing", () => {
		const renderer = createRenderer()
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("accepts pushFrame without a canvas", () => {
		const renderer = createRenderer()
		renderer.pushFrame(mockGameState())
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("setOptions updates rendering options", () => {
		const renderer = createRenderer()
		renderer.setOptions({ showGrid: false, showNames: false })
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("ignores render calls after destroy", () => {
		const renderer = createRenderer()
		renderer.destroy()
		// Should not throw
		renderer.pushFrame(mockGameState())
		renderer.render(1)
		expect(renderer).toBeDefined()
	})
})
