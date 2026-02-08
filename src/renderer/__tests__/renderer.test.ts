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

function mockGameStateWithBullets(): GameState {
	return mockGameState({
		bullets: [
			{
				id: 100,
				ownerId: 0,
				x: 200,
				y: 150,
				heading: 45,
				speed: 15,
				power: 2,
			},
		],
	})
}

function mockGameStateTwoRobots(): GameState {
	return mockGameState({
		robots: [
			{
				id: 0,
				name: "Bot-A",
				color: 0xff0000,
				x: 100,
				y: 100,
				heading: 0,
				speed: 5,
				gunHeading: 45,
				gunHeat: 0,
				radarHeading: 90,
				health: 80,
				energy: 90,
				alive: true,
				score: 10,
				fuelUsedThisTick: 0,
				ticksSurvived: 50,
				damageDealt: 20,
				damageReceived: 20,
				bulletsFired: 5,
				bulletsHit: 2,
				kills: 0,
			},
			{
				id: 1,
				name: "Bot-B",
				color: 0x0000ff,
				x: 500,
				y: 400,
				heading: 180,
				speed: 3,
				gunHeading: 200,
				gunHeat: 1,
				radarHeading: 270,
				health: 60,
				energy: 70,
				alive: true,
				score: 5,
				fuelUsedThisTick: 0,
				ticksSurvived: 50,
				damageDealt: 10,
				damageReceived: 40,
				bulletsFired: 3,
				bulletsHit: 1,
				kills: 0,
			},
		],
	})
}

describe("BattleRenderer", () => {
	it("can be created and destroyed without crashing", () => {
		const renderer = createRenderer()
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("accepts pushFrame without init", () => {
		const renderer = createRenderer()
		renderer.pushFrame(mockGameState())
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("pushFrame stores the current frame and shifts previous", () => {
		const renderer = createRenderer()
		const frame1 = mockGameState({ tick: 1 })
		const frame2 = mockGameState({ tick: 2 })

		renderer.pushFrame(frame1)
		renderer.pushFrame(frame2)

		// No direct way to inspect internal state, but this verifies
		// the double-push pattern doesn't crash
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("render(1.0) after pushing a frame does not crash", () => {
		const renderer = createRenderer()
		renderer.pushFrame(mockGameState())
		// PixiJS won't be initialized (no real canvas), so render is a no-op
		// but it should not throw
		renderer.render(1.0)
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("pushing two frames and calling render(0.5) does not crash", () => {
		const renderer = createRenderer()
		const frame1 = mockGameState({ tick: 1 })
		const frame2 = mockGameState({ tick: 2 })

		renderer.pushFrame(frame1)
		renderer.pushFrame(frame2)
		renderer.render(0.5)

		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("render with bullets does not crash", () => {
		const renderer = createRenderer()
		renderer.pushFrame(mockGameStateWithBullets())
		renderer.render(1.0)
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("render with two robots does not crash", () => {
		const renderer = createRenderer()
		renderer.pushFrame(mockGameStateTwoRobots())
		renderer.render(1.0)
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("setOptions updates rendering options without crashing", () => {
		const renderer = createRenderer()
		renderer.setOptions({ showGrid: false, showNames: false })
		renderer.setOptions({ showHealthBars: false })
		renderer.setOptions({ showScanArcs: false })
		renderer.setOptions({ backgroundColor: 0x000000 })
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("destroy cleans up resources", () => {
		const renderer = createRenderer()
		renderer.pushFrame(mockGameState())
		renderer.destroy()
		// After destroy, operations should be no-ops
		renderer.pushFrame(mockGameState())
		renderer.render(1.0)
		expect(renderer).toBeDefined()
	})

	it("ignores render calls after destroy", () => {
		const renderer = createRenderer()
		renderer.destroy()
		// Should not throw
		renderer.pushFrame(mockGameState())
		renderer.render(1)
		expect(renderer).toBeDefined()
	})

	it("resize does not crash without init", () => {
		const renderer = createRenderer()
		renderer.resize(1024, 768)
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("handles multiple sequential frames without crashing", () => {
		const renderer = createRenderer()
		for (let i = 0; i < 10; i++) {
			renderer.pushFrame(mockGameState({ tick: i }))
			renderer.render(1.0)
		}
		expect(renderer).toBeDefined()
		renderer.destroy()
	})

	it("handles frame with dead robot", () => {
		const renderer = createRenderer()
		const frame = mockGameState({
			robots: [
				{
					id: 0,
					name: "DeadBot",
					color: 0xff0000,
					x: 400,
					y: 300,
					heading: 0,
					speed: 0,
					gunHeading: 0,
					gunHeat: 0,
					radarHeading: 0,
					health: 0,
					energy: 0,
					alive: false,
					score: 0,
					fuelUsedThisTick: 0,
					ticksSurvived: 50,
					damageDealt: 0,
					damageReceived: 100,
					bulletsFired: 0,
					bulletsHit: 0,
					kills: 0,
				},
			],
		})
		renderer.pushFrame(frame)
		renderer.render(1.0)
		expect(renderer).toBeDefined()
		renderer.destroy()
	})
})
