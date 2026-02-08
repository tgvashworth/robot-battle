import { describe, expect, it } from "vitest"
import { Lexer, TokenKind } from "../compiler"
import { createRenderer } from "../renderer"
import { createBattle, createDefaultConfig, createSpinBot, createTrackerBot } from "../simulation"

/**
 * Integration test: demonstrates the full data flow.
 *
 * In the real system:
 *   source → Compiler → CompileResult (WASM) → RobotModule → Simulation → GameState → Renderer
 *
 * Here we use test stub RobotModules instead of compiled WASM, but the
 * simulation → renderer pipeline is real.
 */
describe("Data Flow Integration", () => {
	it("source → tokens (compiler stage 1)", () => {
		const source = `robot "IntegrationBot"

func tick() {
	setSpeed(50)
	setTurnRate(5)
}
`
		const tokens = new Lexer(source).tokenize()
		const meaningful = tokens.filter(
			(t) => t.kind !== TokenKind.Newline && t.kind !== TokenKind.EOF,
		)
		expect(meaningful[0]!.kind).toBe(TokenKind.Robot)
		expect(meaningful[1]!.value).toBe("IntegrationBot")
	})

	it("robots → simulation → GameState (simulation stage)", () => {
		const config = createDefaultConfig(
			[
				{ name: "SpinBot", color: 0xff0000 },
				{ name: "TrackerBot", color: 0x0000ff },
			],
			{ ticksPerRound: 50 },
		)
		const battle = createBattle(config, [createSpinBot(), createTrackerBot()])

		// Run the full round
		const roundResult = battle.runRound()
		const finalState = battle.getState()

		// Verify GameState shape
		expect(finalState.tick).toBe(50)
		expect(finalState.round).toBe(1)
		expect(finalState.arena.width).toBe(800)
		expect(finalState.robots).toHaveLength(2)
		expect(finalState.bullets).toEqual([])
		expect(finalState.mines).toEqual([])
		expect(finalState.cookies).toEqual([])

		// Verify round result
		expect(roundResult.reason).toBe("time_limit")
		expect(roundResult.placements).toHaveLength(2)

		battle.destroy()
	})

	it("GameState → renderer (rendering stage)", () => {
		const config = createDefaultConfig([
			{ name: "Bot1", color: 0xff0000 },
			{ name: "Bot2", color: 0x0000ff },
		])
		const battle = createBattle(config, [createSpinBot(), createSpinBot()])

		// Run a few ticks
		for (let i = 0; i < 5; i++) {
			battle.tick()
		}

		const state = battle.getState()

		// Create renderer and feed it the state
		const renderer = createRenderer()
		// Note: without a real canvas, render() is a no-op, but pushFrame works
		renderer.pushFrame(state)

		// The renderer accepts GameState without crashing.
		// In a browser environment it would draw to a canvas.
		renderer.destroy()
		battle.destroy()
	})

	it("full pipeline: compile check → battle → render-ready state", () => {
		// Step 1: Verify source tokenizes
		const source = `robot "PipelineBot"
var speed float = 50.0
func tick() {
	setSpeed(speed)
}
`
		const tokens = new Lexer(source).tokenize()
		expect(tokens.length).toBeGreaterThan(5)

		// Step 2: Create and run a battle (using test stubs for now)
		const config = createDefaultConfig(
			[
				{ name: "PipelineBot", color: 0x00ff00 },
				{ name: "Opponent", color: 0xff0000 },
			],
			{ ticksPerRound: 20 },
		)
		const battle = createBattle(config, [createSpinBot(), createSpinBot()])
		const result = battle.runRound()

		// Step 3: Get final state and verify it's render-ready
		const state = battle.getState()
		expect(state.robots.every((r) => typeof r.x === "number")).toBe(true)
		expect(state.robots.every((r) => typeof r.y === "number")).toBe(true)
		expect(state.robots.every((r) => typeof r.heading === "number")).toBe(true)

		// Step 4: Verify state survives serialization (critical for workers)
		const serialized = JSON.parse(JSON.stringify(state))
		expect(serialized.tick).toBe(state.tick)
		expect(serialized.robots[0].x).toBe(state.robots[0]!.x)

		expect(result.placements.length).toBe(2)

		battle.destroy()
	})
})
